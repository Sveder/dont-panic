// T64: the live sensor path, pure logic. No Lens globals, so node tests feed it fake sensor values.
// LiveSensors.ts passes the Spectacles GPS fixes and compass readings to LiveTracker. Hud.stepLive
// (HudLogic.ts) uses what read() returns in the same way as the recorded walk.
// Smoothing is the same as the replay track (lensbuild/export_replay.py): position = 4 s window,
// weight 1 / max(accuracy, 2)^2; heading = 0.5 s circular mean. The replay window is centred on t.
// A live window can only look back, so the live position lags about 2 s behind the user.

export const POS_WINDOW_S = 4;
export const HEAD_WINDOW_S = 0.5;
/** A fix with a worse accuracy (metres) does not move the position. Spectacles Navigation accuracy is "up to 20 m". */
export const POOR_ACCURACY_M = 40;
/** With no usable fix, the last smoothed position stays in use for this long. Status "weak". */
export const HOLD_S = 20;
/** A poor fix older than this is a lost signal, not a poor signal. */
export const FIX_STALE_S = 10;
/** No compass reading for this long = no compass. */
export const COMPASS_STALE_S = 3;
/** A position this far outside the street box (metres) is outside the map. About one GPS error. */
export const OUTSIDE_MARGIN_M = 30;

export type LiveStatus = "ok" | "weak" | "nofix" | "poor" | "outside" | "noroute";
export type CompassState = "ok" | "weak" | "none";
export type LiveInput = { status: LiveStatus; lat: number; lon: number; accuracyM: number; heading: number | null; compass: CompassState; pitch: number };

type Fix = { at: number; lat: number; lon: number; acc: number };
type Head = { at: number; deg: number; weak: boolean };

const usable = (v: number) => typeof v === "number" && isFinite(v);

export class LiveTracker {
  private fixes: Fix[] = [];
  private heads: Head[] = [];
  private held: { lat: number; lon: number; acc: number } | null = null;
  private lastGoodAt = -1e9;
  private lastPoorAt = -1e9;
  private lastPoorAcc = 0;

  /** One GPS fix at time now (seconds). Accuracy 0 or less means "unknown" and counts as poor. */
  onFix(lat: number, lon: number, accuracyM: number, now: number) {
    if (!usable(lat) || !usable(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return;
    if (!usable(accuracyM) || accuracyM <= 0 || accuracyM > POOR_ACCURACY_M) {
      this.lastPoorAt = now;
      this.lastPoorAcc = usable(accuracyM) ? accuracyM : 0;
      return;
    }
    this.fixes.push({ at: now, lat, lon, acc: accuracyM });
    this.lastGoodAt = now;
  }

  /** One compass reading (degrees, 0 = north, clockwise). weak = the sensor calls itself unreliable. */
  onHeading(deg: number, weak: boolean, now: number) {
    if (!usable(deg)) return;
    this.heads.push({ at: now, deg: ((deg % 360) + 360) % 360, weak });
  }

  private readPos(now: number): { status: LiveStatus; lat: number; lon: number; acc: number } {
    this.fixes = this.fixes.filter((f) => now - f.at <= POS_WINDOW_S);
    if (this.fixes.length) {
      let sw = 0, la = 0, lo = 0, ac = 0;
      for (const f of this.fixes) {
        const w = 1 / Math.pow(Math.max(f.acc, 2), 2);
        sw += w; la += f.lat * w; lo += f.lon * w; ac += f.acc * w;
      }
      this.held = { lat: la / sw, lon: lo / sw, acc: ac / sw };
      return { status: "ok", lat: this.held.lat, lon: this.held.lon, acc: this.held.acc };
    }
    if (this.held && now - this.lastGoodAt <= HOLD_S) return { status: "weak", lat: this.held.lat, lon: this.held.lon, acc: this.held.acc };
    if (now - this.lastPoorAt <= FIX_STALE_S) return { status: "poor", lat: 0, lon: 0, acc: this.lastPoorAcc };
    return { status: "nofix", lat: 0, lon: 0, acc: 0 };
  }

  private readHead(now: number): { heading: number | null; compass: CompassState } {
    this.heads = this.heads.filter((h, i) => now - h.at <= Math.max(COMPASS_STALE_S, HEAD_WINDOW_S) || i === this.heads.length - 1);
    const last = this.heads[this.heads.length - 1];
    if (!last || now - last.at > COMPASS_STALE_S) return { heading: null, compass: "none" };
    const win = this.heads.filter((h) => now - h.at <= HEAD_WINDOW_S);
    const use = win.length ? win : [last];
    let s = 0, c = 0;
    for (const h of use) { s += Math.sin((h.deg * Math.PI) / 180); c += Math.cos((h.deg * Math.PI) / 180); }
    return { heading: ((Math.atan2(s, c) * 180) / Math.PI + 360) % 360, compass: last.weak ? "weak" : "ok" };
  }

  /** What the sensors say at time now. pitch comes from the world camera (degrees, negative = down). */
  read(now: number, pitch = 0): LiveInput {
    const p = this.readPos(now), h = this.readHead(now);
    return { status: p.status, lat: p.lat, lon: p.lon, accuracyM: p.acc, heading: h.heading, compass: h.compass, pitch };
  }
}

/** Is the local point outside the street box of the area, with the margin? box = [xmin, zmin, xmax, zmax]. */
export function outsideBox(x: number, z: number, box: number[], margin = OUTSIDE_MARGIN_M): boolean {
  return x < box[0] - margin || z < box[1] - margin || x > box[2] + margin || z > box[3] + margin;
}

/** The plain line for the bottom chip, or "" when the sensors are fine. distM is used only when a route exists. */
export function sensorNotice(status: LiveStatus, compass: CompassState, stage: string, distM: number): string {
  const noWay = stage === "countdown" ? "enter a building or lie down" : "no route";
  if (status === "nofix") return `No GPS · ${noWay}`;
  if (status === "poor") return `Weak GPS · ${noWay}`;
  if (status === "outside") return `Outside the map · ${noWay}`;
  if (status === "noroute") return `No route · ${noWay}`;
  const m = Math.round(distM);
  if (compass === "none") return `No compass · ${m} m to the shelter`;
  if (status === "weak") return `Weak GPS · ${m} m`;
  if (compass === "weak") return `Weak compass · ${m} m`;
  return "";
}

/** Debug line for the live path (only with showDebug on). */
export function liveInfoLine(t: number, l: LiveInput): string {
  return `live ${l.status} t ${t.toFixed(1)} s  acc ${Math.round(l.accuracyM)} m  heading ${l.heading === null ? "-" : l.heading.toFixed(0) + "°"} (${l.compass})  pitch ${l.pitch.toFixed(0)}°`;
}
