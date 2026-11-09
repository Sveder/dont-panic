// T4: pure glue between a Lens audio source and SirenDetector. No Lens globals, so a node test runs it
// (lensbuild/test/test_siren_feed.cjs). It resamples any input rate to 16 kHz (box average over each
// output step, which is also the low-pass), feeds the detector, and makes one pitch log line a second.
import { SirenDetector, SirenHit, SAMPLE_RATE } from "./SirenDetector";

export class SirenFeed {
  det = new SirenDetector();
  inRate: number;
  private step: number;     // input samples per output sample
  private pos = 0;          // input position of the next output sample's end
  private acc = 0;
  private accN = 0;
  private inIdx = 0;
  private out: number[] = [];
  private lastLineT = -1;
  /** One line a second: "[siren] t 12.0 s pitch 640 Hz" (pitch 0 = no tone). */
  lines: string[] = [];

  constructor(inRate: number) {
    this.inRate = inRate > 0 ? inRate : SAMPLE_RATE;
    this.step = this.inRate / SAMPLE_RATE;
    this.pos = this.step;
  }

  /** Feed n samples (default all) at the input rate. Returns the detector hits. */
  push(samples: ArrayLike<number>, n: number = samples.length): SirenHit[] {
    const out = this.out;
    for (let i = 0; i < n; i++) {
      this.acc += samples[i];
      this.accN++;
      this.inIdx++;
      if (this.inIdx >= this.pos) {
        out.push(this.acc / this.accN);
        this.acc = 0; this.accN = 0;
        this.pos += this.step;
      }
    }
    this.out = [];
    if (!out.length) return [];
    const hits = this.det.push(out);
    const t = this.det.t;
    if (t - this.lastLineT >= 1) {
      this.lastLineT = Math.floor(t);
      this.lines.push("[siren] t " + t.toFixed(1) + " s pitch " + Math.round(this.det.gap === 0 ? this.det.last : 0) + " Hz");
    }
    return hits;
  }

  /** Take the pending log lines. */
  takeLines(): string[] { const l = this.lines; this.lines = []; return l; }
}
