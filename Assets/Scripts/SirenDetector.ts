// Siren detector (T30, port of lensbuild/siren_detect.py, T3). Pure logic, no Lens globals, so a
// node test runs it (lensbuild/test/test_siren_detector.cjs). The same constants and the same steps
// as the Python prototype; read the doc string there for the method and the measured numbers.
// Input: 100 ms frames of 16 kHz mono audio, samples -1..1 (Float32Array of 1600).
// The microphone wiring on Spectacles (MicrophoneAudioProvider) is T4 (VM).

export const SAMPLE_RATE = 16000;
export const FRAME_S = 0.1;
export const FRAME_N = Math.round(SAMPLE_RATE * FRAME_S); // 1600 samples
export const FFT_SIZE = 4096;
export const BAND_LO_HZ = 300;
export const BAND_HI_HZ = 1200;
export const MIN_RMS = 0.003;
export const TONAL_MIN = 0.04;
export const SMOOTH_FRAMES = 5;
export const HOLD_TOL_HZ = 12;
export const BACK_TOL_HZ = 30;
export const MAX_HOLD_FRAMES = 10;
export const MAX_GAP_FRAMES = 2;
export const MIN_SWEEP_HZ = 200;
export const FULL_SWEEP_HZ = 220;
export const FULL_TONAL = 0.08;
export const MIN_SWEEP_S = 0.8;
export const MAX_SWEEP_S = 8.0;
export const DETECT_CONF = 0.7;

export type SirenHit = { t: number; conf: number; dir: "rise" | "fall"; span: number; secs: number };

type Run = {
  start: number; lo: number; hi: number; first: number; anchor: number; dir: number; hold: number;
  path: number; share: number; n: number; fired: boolean;
};

/** In-place radix-2 FFT (re, im of length FFT_SIZE). */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function median(v: number[]): number {
  const s = v.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export class SirenDetector {
  t = 0;
  /** Smoothed pitch of the last tonal frame (Hz), for the per-second log line. */
  last = 0;
  gap = 0;
  private raw: number[] = [];
  private run: Run | null = null;
  private re = new Float64Array(FFT_SIZE);
  private im = new Float64Array(FFT_SIZE);
  private win: Float64Array | null = null;

  /** Pitch (Hz) and tonal share of one frame; pitch 0 when the frame is not tonal. */
  framePitch(frame: ArrayLike<number>): [number, number] {
    const n = frame.length;
    let e = 0;
    for (let i = 0; i < n; i++) e += frame[i] * frame[i];
    if (Math.sqrt(e / n) < MIN_RMS) return [0, 0];
    if (!this.win || this.win.length !== n) {
      this.win = new Float64Array(n);
      for (let i = 0; i < n; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)); // numpy hanning
    }
    const re = this.re, im = this.im;
    re.fill(0); im.fill(0);
    for (let i = 0; i < n && i < FFT_SIZE; i++) re[i] = frame[i] * this.win[i];
    fft(re, im);
    const binHz = SAMPLE_RATE / FFT_SIZE;
    let total = 0, best = -1, bestP = 0;
    for (let k = 0; k <= FFT_SIZE / 2; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      total += p;
      const f = k * binHz;
      if (f >= BAND_LO_HZ && f <= BAND_HI_HZ && p > bestP) { bestP = p; best = k; }
    }
    if (best < 0) return [0, 0];
    const share = bestP / (total + 1e-12);
    return share >= TONAL_MIN ? [best * binHz, share] : [0, share];
  }

  private startRun(p: number, share: number) {
    this.run = { start: this.t, lo: p, hi: p, first: p, anchor: p, dir: 0, hold: 0, path: 0, share, n: 1, fired: false };
  }

  /** Feed one 100 ms frame. Returns a hit or null. */
  step(frame: ArrayLike<number>): SirenHit | null {
    const [pRaw, share] = this.framePitch(frame);
    this.t += FRAME_S;
    this.raw.push(pRaw);
    if (this.raw.length > SMOOTH_FRAMES) this.raw.shift();
    const voiced = this.raw.filter((v) => v > 0);
    const p = pRaw > 0 && voiced.length * 2 > this.raw.length ? median(voiced) : 0;
    const run = this.run;
    if (p === 0) {
      this.gap++;
      if (run && this.gap > MAX_GAP_FRAMES) this.run = null;
      return null;
    }
    this.gap = 0;
    if (!run) {
      this.startRun(p, share);
      this.last = p;
      return null;
    }
    run.path += Math.abs(p - this.last);
    this.last = p;
    const d = p - run.anchor;
    if (Math.abs(d) < HOLD_TOL_HZ) {
      run.hold++;
      if (run.hold > MAX_HOLD_FRAMES) { this.startRun(p, share); return null; }
    } else {
      const s = d > 0 ? 1 : -1;
      if (run.dir === 0) run.dir = s;
      if (s !== run.dir && Math.abs(d) > BACK_TOL_HZ) { this.startRun(p, share); return null; }
      if (s === run.dir) { run.anchor = p; run.hold = 0; }
    }
    run.lo = Math.min(run.lo, p);
    run.hi = Math.max(run.hi, p);
    run.share += share;
    run.n++;
    const span = run.hi - run.lo;
    const secs = this.t - run.start;
    if (run.fired || span < MIN_SWEEP_HZ || secs < MIN_SWEEP_S || secs > MAX_SWEEP_S) return null;
    const conf = Math.min(1, span / FULL_SWEEP_HZ)
      * Math.min(1, run.share / run.n / FULL_TONAL)
      * Math.min(1, Math.abs(p - run.first) / Math.max(1, run.path));
    if (conf < DETECT_CONF) return null;
    run.fired = true;
    const r1 = (x: number) => Math.round(x * 10) / 10;
    return { t: r1(this.t), conf: Math.round(conf * 100) / 100, dir: run.dir > 0 ? "rise" : "fall", span: Math.floor(span), secs: r1(secs) };
  }

  /** Feed a longer buffer (any length); keeps the remainder for the next call. Returns all hits. */
  private rest: number[] = [];
  push(samples: ArrayLike<number>): SirenHit[] {
    const hits: SirenHit[] = [];
    for (let i = 0; i < samples.length; i++) {
      this.rest.push(samples[i]);
      if (this.rest.length === FRAME_N) {
        const h = this.step(this.rest);
        if (h) hits.push(h);
        this.rest = [];
      }
    }
    return hits;
  }
}
