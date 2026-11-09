// Replay of a recorded walk: position, heading and pitch at time t (seconds on the video clock).
// Pure logic, no Lens globals, so node tests can load it.
export type ReplayTrackT = { id: string; area: string; alert_s: number; alert_time_s: number; shelter: string; t: number[]; lat: number[]; lon: number[]; hdg: number[]; pit?: number[] };
export type ReplaySample = { lat: number; lon: number; heading: number; pitch: number; done: boolean };

/** Linear interpolation between samples; heading takes the short way round 360. Before the first sample: the first; after the last: the last, done = true. */
export function replayAt(tr: ReplayTrackT, t: number): ReplaySample {
  const n = tr.t.length;
  const pit = (i: number) => (tr.pit ? tr.pit[i] : 0);
  if (t <= tr.t[0]) return { lat: tr.lat[0], lon: tr.lon[0], heading: tr.hdg[0], pitch: pit(0), done: false };
  if (t >= tr.t[n - 1]) return { lat: tr.lat[n - 1], lon: tr.lon[n - 1], heading: tr.hdg[n - 1], pitch: pit(n - 1), done: true };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tr.t[m] <= t) lo = m; else hi = m; }
  const f = (t - tr.t[lo]) / (tr.t[hi] - tr.t[lo] || 1);
  let dh = tr.hdg[hi] - tr.hdg[lo];
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return {
    lat: tr.lat[lo] + (tr.lat[hi] - tr.lat[lo]) * f,
    lon: tr.lon[lo] + (tr.lon[hi] - tr.lon[lo]) * f,
    heading: (tr.hdg[lo] + dh * f + 360) % 360,
    pitch: pit(lo) + (pit(hi) - pit(lo)) * f,
    done: false,
  };
}
