// lens2 HUD logic: what the HUD shows at video time t. Pure logic, no Lens globals except
// print/getTime through Router, so node tests can run it (lensbuild/test/test_lens2_hud.cjs).
// Inputs: the replayed walk (GPS + where the camera looked), the Ramat Gan street graph, Shelter 30.
// Screen frame: x, y in -1..1 (0,0 = centre, +x right, +y up). Arrow angle in deg, 0 = straight up
// (= ahead), positive = clockwise (to the right).
import { REPLAY_TRACK } from "./ReplayTrack";
import { replayAt, ReplayTrackT } from "./Replay";
import { Router, Route, along, pointAt } from "./Router";
import { toLocal, dirToHeading, XZ } from "./GeoFrame";
import { region, setRegion, areaAt } from "./Region";
import { LiveInput, LiveStatus, outsideBox, sensorNotice } from "./LivePath";

export const HFOV = 66; // Pixel 9 main camera, 16:9 crop
export const VFOV = 2 * (Math.atan(Math.tan((HFOV * Math.PI) / 360) * (9 / 16)) * 180) / Math.PI; // ~39.6
export const ARRIVE_M = 5; // "GO INSIDE" when the shelter is this close (straight line)
export const LAST_LEG_M = 8; // route left below this: the street part is done, aim at the shelter itself
export const STAY_S = 600; // stay countdown after the alert countdown ends (Home Front Command: 10 minutes)
export const WALK_MPS = 1.2; // walking pace with two children (T29); T32 kids mode may lower it
export const COVER_HYST_S = 3; // take-cover mode ends only when the walk fits with this margin (no flicker)
/** T64: arrival on live GPS. The radius grows with the GPS accuracy, up to this many metres; ARRIVE_M is too small for a 20 m error. */
export const LIVE_ARRIVE_MAX_M = 15;
/** T64: the live path starts with this header and no recorded samples. alert_time_s is the area alert time (Ramat Gan). */
export const LIVE_HEADER: ReplayTrackT = { id: "live", area: "Ramat Gan", alert_s: -1, alert_time_s: 90, shelter: "", t: [], lat: [], lon: [], hdg: [] };
/** Home Front Command instruction when no shelter is reachable in the alert time (T29). */
export const HFC_COVER = "NOT IN TIME · Go into the nearest building: stairwell or inner room. No building: lie down, cover your head";
/** T62 (two label lines in every state): the short form of HFC_COVER for the bottom chip. */
export const COVER_CHIP = "Not in time · enter a building or lie down";

/** T62: the bottom chip, one line: "33 m · you make it". The walk time is gone; "you make it" already says it. */
export function timeLine(distM: number, makeIt: boolean): string {
  return `${Math.round(distM)} m · ${makeIt ? "you make it" : "not in time"}`;
}

/** mm:ss, never negative (same as lens/Assets/Scripts/StayTimer.ts clock). */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? "0" : ""}${r}`;
}

/**
 * Alert sequence stage (T46, Michael 7/11 18:00):
 * none = no alarm yet; countdown = the area alert time runs (Ramat Gan 90 s);
 * stay = the alert time is over, "Stay in the shelter" counts 10 minutes; leave = the 10 minutes are over.
 * A new alarm restarts the sequence from countdown.
 */
/** T62 (Michael 9/11): line 1 is the red card, with the countdown in it. Same words for the feed and the siren path. */
export function alertLine(secondsLeft: number): string {
  return `ROCKET ALERT · ${secondsLeft} s`;
}
/** T30: the view flashes this long after an alarm starts (2 flashes a second), for a user who cannot hear the siren. */
export const FLASH_S = 4;
/** T30: one siren sounds about 1-1.5 minutes and gives many detections; a detection this soon after an alarm is the same siren. */
export const SIREN_DEBOUNCE_S = 120;
export type AlarmSource = "" | "feed" | "siren";

export type Stage = "none" | "countdown" | "stay" | "leave";
// T52: the arrow texture (lensbuild/make_arrow.py) has its tip straight up at rotation 0.
// arrowDeg is clockwise from straight ahead (90 = right); a ScreenTransform z rotation is
// counter-clockwise, so the screen rotation is the rest angle minus arrowDeg.
/** T56: the debug line at the bottom of the view. Empty unless showDebug is on, so a demo never shows it. */
export function infoLine(showDebug: boolean, t: number, heading: number, pitch: number): string {
  if (!showDebug) return "";
  return `replay walk 884c  t ${t.toFixed(1)} s  heading ${heading.toFixed(0)}°  pitch ${pitch.toFixed(0)}°`;
}

export const ARROW_REST_DEG = 0;
export function arrowScreenRotDeg(arrowDeg: number): number {
  return ARROW_REST_DEG - arrowDeg;
}
export const CORNER_MIN_M = 8; // the arrow aims at the next route corner at least this far ahead
export const MARKER_MAX_M = 150;

export type HudState = {
  t: number; heading: number; pitch: number;
  alert: boolean; flash: boolean; viewFlash: boolean; source: AlarmSource; alertLine: string; secondsLeft: number; stayLeft: number; phase: "walk" | "alert" | "arrived";
  stage: Stage; stayClock: string; alarmAt: number; alarms: number;
  distM: number; etaS: number; arrowDeg: number; turnAround: boolean; makeIt: boolean; takeCover: boolean; timeLine: string;
  marker: { visible: boolean; x: number; y: number; size: number };
  shelter: string; replans: number;
  /** T64: guide = the arrow may show (a route and a heading exist). notice = the plain sensor line, "" when fine. bearingDeg = compass bearing to the shelter. */
  guide: boolean; notice: string; sensor: LiveStatus | ""; bearingDeg: number;
};

const wrap = (a: number) => ((a + 540) % 360) - 180;
const bearing = (from: XZ, to: XZ) => dirToHeading({ x: to.x - from.x, z: to.z - from.z });

export class Hud {
  tr: ReplayTrackT;
  router: Router;
  route: Route | null = null;
  lastPlan = -99;
  replans = 0;
  arrow: number | null = null;
  arrivedAt: number | null = null;
  lastT = -1;
  shelterXZ: XZ;
  /** Alarm start times (track seconds). The first one is the recorded alert; addAlarm adds more. */
  alarms: number[];
  /** Stay countdown length; 600 s on the real Lens, shorter in a preview demo. */
  stayS = STAY_S;
  /** Walking pace for the time check, m/s. */
  paceMps = WALK_MPS;
  /** Alarm times that came from the siren detector (T30); the others came from the feed or the recording. */
  sirenAlarms: number[] = [];
  private lastAlarm = -1;
  private cover = false;
  /** T64: display field of view for the pin. The replay keeps the camera values of the walk video. */
  hfov = HFOV;
  vfov = VFOV;

  constructor(tr: ReplayTrackT = REPLAY_TRACK as ReplayTrackT) {
    this.tr = tr;
    this.router = new Router();
    const s = this.router.shelters[0];
    this.shelterXZ = { x: s.x, z: s.z };
    this.alarms = [this.tr.alert_s];
  }

  /** A new alarm at track time t restarts the sequence (countdown, then the stay countdown). */
  addAlarm(t: number) {
    if (this.alarms.indexOf(t) < 0) this.alarms.push(t);
    this.alarms.sort((a, b) => a - b);
  }

  /** No alarm at all; the next one must come from sirenHeard or addAlarm (siren-only demo). */
  clearAlarms() { this.alarms = []; this.sirenAlarms = []; }

  /**
   * T30: the microphone siren detector heard a siren at track time t. Starts the alert sequence with
   * source 'siren', unless an alarm started less than SIREN_DEBOUNCE_S before (the same siren).
   * Returns true when a new alarm started.
   */
  sirenHeard(t: number, conf = 1): boolean {
    const last = this.alarmAt(t);
    if (last >= 0 && t - last < SIREN_DEBOUNCE_S) return false;
    this.addAlarm(t);
    this.sirenAlarms.push(t);
    print(`[siren] heard at t ${t.toFixed(1)} conf ${conf.toFixed(2)}: alarm starts`);
    return true;
  }

  /**
   * T65: the official feed reported a shelter alert at track time t. Same sequence and same debounce as a siren,
   * so one attack that the microphone and the feed both report starts one alarm. Returns true when a new alarm started.
   */
  feedAlert(t: number, title = ""): boolean {
    const last = this.alarmAt(t);
    if (last >= 0 && t - last < SIREN_DEBOUNCE_S) return false;
    this.addAlarm(t);
    print(`[feed] official alert at t ${t.toFixed(1)} (${title}): alarm starts`);
    return true;
  }

  /** The latest alarm at or before t, or -1. */
  alarmAt(t: number): number {
    let a = -1;
    for (const x of this.alarms) if (x <= t) a = x;
    return a;
  }

  /** Target the arrow aims at: the next route corner at least CORNER_MIN_M ahead, else the door. */
  corner(r: Route, s: number): XZ {
    for (let i = 1; i < r.points.length; i++) if (r.cum[i] >= s + CORNER_MIN_M) return r.points[i];
    return r.points[r.points.length - 1];
  }

  /** T64: the pin uses this field of view (degrees). Live mode reads it from the world camera. */
  setFov(vfovDeg: number, aspect: number) {
    this.vfov = vfovDeg;
    this.hfov = (2 * Math.atan(Math.tan((vfovDeg * Math.PI) / 360) * aspect) * 180) / Math.PI;
  }

  /** The recorded walk at track time t. */
  step(t: number): HudState {
    return this.stepAt(t, replayAt(this.tr, t), null);
  }

  /** T64: the live sensors at time t. Same path as the replay; a sensor problem gives a plain line and no arrow. */
  stepLive(t: number, l: LiveInput): HudState {
    return this.stepAt(t, { lat: l.lat, lon: l.lon, heading: l.heading === null ? 0 : l.heading, pitch: l.pitch }, l);
  }

  /** T66: live only. A position outside the active area moves the Lens to the area that holds it. The replay never comes here. */
  private pickArea(lat: number, lon: number) {
    const here = toLocal({ lat, lon });
    if (!outsideBox(here.x, here.z, region().box)) return;
    const a = areaAt(lat, lon);
    if (!a || a === region()) return;
    setRegion(a);
    this.router = new Router();
    const s = this.router.shelters[0];
    this.shelterXZ = { x: s.x, z: s.z };
    this.route = null; this.arrow = null; this.arrivedAt = null; this.lastPlan = -99;
  }

  private stepAt(t: number, smp: { lat: number; lon: number; heading: number; pitch: number }, live: LiveInput | null): HudState {
    if (live && (live.status === "ok" || live.status === "weak")) this.pickArea(smp.lat, smp.lon);
    const p = toLocal({ lat: smp.lat, lon: smp.lon });
    let sensor: LiveStatus | "" = live ? live.status : "";
    if (live && (sensor === "ok" || sensor === "weak") && outsideBox(p.x, p.z, region().box)) sensor = "outside";
    const hasPos = !live || sensor === "ok" || sensor === "weak";
    const hasHeading = !live || live.heading !== null;
    const dt = this.lastT < 0 || t < this.lastT ? 1 : t - this.lastT;
    if (t < this.lastT) { this.arrivedAt = null; this.arrow = null; this.lastPlan = -99; }
    this.lastT = t;
    const alertS = this.alarmAt(t), alertTime = this.tr.alert_time_s;
    if (alertS !== this.lastAlarm) { this.arrivedAt = null; this.lastAlarm = alertS; this.cover = false; } // new alarm: new sequence
    const st: HudState = {
      t, heading: smp.heading, pitch: smp.pitch, alert: alertS >= 0, flash: false, viewFlash: false,
      source: alertS < 0 ? "" : this.sirenAlarms.indexOf(alertS) >= 0 ? "siren" : "feed", alertLine: "", secondsLeft: alertTime, stayLeft: this.stayS,
      stage: "none", stayClock: clock(this.stayS), alarmAt: alertS, alarms: this.alarms.filter((x) => x <= t).length,
      phase: "walk", distM: 0, etaS: 0, arrowDeg: 0, turnAround: false, makeIt: true, takeCover: false, timeLine: "",
      marker: { visible: false, x: 0, y: 0, size: 0 }, shelter: this.tr.shelter, replans: this.replans,
      guide: false, notice: "", sensor, bearingDeg: 0,
    };
    if (!st.alert) return st;
    const since = t - alertS;
    st.flash = since < FLASH_S && Math.floor(since * 4) % 2 === 0;
    st.viewFlash = st.flash; // T30: the whole view flashes with the card, for a user who cannot hear the siren
    st.secondsLeft = Math.max(0, Math.ceil(alertTime - since));
    st.alertLine = alertLine(st.secondsLeft);
    st.stayLeft = Math.max(0, Math.ceil(this.stayS - Math.max(0, since - alertTime)));
    st.stage = since < alertTime ? "countdown" : st.stayLeft > 0 ? "stay" : "leave";
    st.stayClock = clock(st.stayLeft);
    if (live && !hasPos) return this.noPosition(st, sensor as LiveStatus, live);
    // re-plan from the smoothed position once a second: a wrong turn gives a new route by itself
    if (!this.route || t - this.lastPlan >= 1) {
      const r = this.router.route(p, live ? "live" : "replay");
      if (r) { this.route = r; this.replans++; }
      this.lastPlan = t;
    }
    const r = this.route;
    if (!r) return live ? this.noPosition(st, "noroute", live) : st;
    this.shelterXZ = { x: r.shelter.x, z: r.shelter.z }; // the shelter choice comes from the route
    if (live) st.shelter = r.shelter.name;
    const a = along(r, p);
    // the route ends at the shelter's street point; the shelter itself can sit off the street (a yard),
    // so the distance shown is never less than the straight line, and arrival uses the straight line
    const left = Math.max(0, r.length - a.s);
    const straight = Math.hypot(this.shelterXZ.x - p.x, this.shelterXZ.z - p.z);
    st.distM = Math.max(left, straight);
    const arriveM = live ? Math.max(ARRIVE_M, Math.min(LIVE_ARRIVE_MAX_M, live.accuracyM)) : ARRIVE_M;
    if (this.arrivedAt === null && straight < arriveM) this.arrivedAt = t;
    st.phase = this.arrivedAt !== null ? "arrived" : "alert";
    // T29: walk time against the alert time left. Take cover when the shelter is out of reach;
    // leave that mode only when the walk fits again with a margin, so the HUD does not flicker.
    st.etaS = st.distM / this.paceMps;
    st.makeIt = st.etaS <= st.secondsLeft;
    if (st.phase === "arrived" || st.stage !== "countdown") this.cover = false;
    else if (!this.cover && !st.makeIt) this.cover = true;
    else if (this.cover && st.etaS <= st.secondsLeft - COVER_HYST_S) this.cover = false;
    st.takeCover = this.cover;
    st.timeLine = timeLine(st.distM, !this.cover);
    st.bearingDeg = bearing(p, this.shelterXZ);
    if (live) st.notice = sensorNotice(sensor as LiveStatus, live.compass, st.stage, st.distM);
    st.guide = hasHeading;
    if (!hasHeading) { this.arrow = null; st.replans = this.replans; return st; } // no compass: the distance is true, a direction is not
    // arrow: bearing to the next corner minus where the camera looks; smoothed (~0.15 s)
    const lastLeg = left < LAST_LEG_M;
    const from = lastLeg || a.d >= 12 ? p : pointAt(r, a.s).p; // on the route, so GPS side error does not swing the arrow
    const target = lastLeg ? this.shelterXZ : this.corner(r, a.s);
    const rel = wrap(bearing(from, target) - smp.heading);
    const k = 1 - Math.exp(-dt / 0.15);
    this.arrow = this.arrow === null ? rel : wrap(this.arrow + wrap(rel - this.arrow) * k);
    st.arrowDeg = this.arrow;
    st.turnAround = Math.abs(this.arrow) > 120;
    // shelter marker on the video: bearing minus heading over the HFOV, pitch for the vertical
    const relS = wrap(bearing(p, this.shelterXZ) - smp.heading);
    if (Math.abs(relS) < this.hfov / 2 && straight < MARKER_MAX_M) {
      const x = Math.tan((relS * Math.PI) / 180) / Math.tan((this.hfov * Math.PI) / 360);
      // the door is at eye level minus ~0.3 m; looking down (pitch < 0) moves it up on screen
      const elev = (Math.atan2(-0.3, Math.max(straight, 1)) * 180) / Math.PI;
      const y = Math.tan(((elev - smp.pitch) * Math.PI) / 180) / Math.tan((this.vfov * Math.PI) / 360);
      // keep the pin under the alert card (top 0.73) and above the guide panel; size grows as he gets close
      st.marker = { visible: Math.abs(y) < 1, x, y: Math.max(-0.45, Math.min(0.45, y)), size: Math.max(0.14, Math.min(0.34, 9 / Math.max(straight, 1))) };
    }
    st.replans = this.replans;
    return st;
  }

  /** T64: no usable position. The alert and the countdowns go on; no arrow, no pin, no invented distance. */
  private noPosition(st: HudState, sensor: LiveStatus, live: LiveInput): HudState {
    this.route = null;
    this.arrow = null;
    this.lastPlan = -99; // plan at once when the position comes back
    st.sensor = sensor;
    st.phase = this.arrivedAt !== null ? "arrived" : "alert";
    st.notice = sensorNotice(sensor, live.compass, st.stage, 0);
    return st;
  }
}

// ---------------------------------------------------------------------------------------------
// T57: HUD readability. Every HUD line is bold, bright, full opacity, with a dark outline and (for
// lines with no panel image behind them) a dark plate with padding. The Spectacles display is
// additive: thin, dark-red or grey text almost disappears over a bright street. Lens2Hud applies
// this table to the Text components on awake, so the scene file keeps no style of its own.
export type RGBA = [number, number, number, number];
export type TextStyle = {
  size: number; weight: number; color: RGBA; outline: number;
  plate: RGBA | null; // null = the line already sits on a panel image
  padX: number; padY: number; // plate padding (BackgroundSettings margins; VM: 0.6 gave ~1 px, so the unit is small)
};
export const HUD_STYLE: { [k: string]: TextStyle } = {
  alert:  { size: 40, weight: 700, color: [1, 1, 1, 1], outline: 0.18, plate: null, padX: 0, padY: 0 }, // T62: was 46
  alertLong: { size: 30, weight: 700, color: [1, 1, 1, 1], outline: 0.18, plate: null, padX: 0, padY: 0 }, // T62: the stay and leave lines
  chip:   { size: 30, weight: 700, color: [1, 1, 1, 1], outline: 0.15, plate: null, padX: 0, padY: 0 }, // T62: one line, was 40 + 32 on two
  marker: { size: 30, weight: 700, color: [1, 1, 1, 1], outline: 0.2, plate: [0, 0, 0, 0.75], padX: 5, padY: 2 }, // T62: was 34, padding 8, 3
  inside: { size: 30, weight: 800, color: [1, 1, 1, 1], outline: 0.18, plate: null, padX: 0, padY: 0 }, // T62: was 34 on two lines
};
/** T62 layout, screen units -1..1 (Michael 9/11, design page items 1-3). Scene.scene holds these values; the test compares them.
 * Fractions of the view: card x 0.31-0.69, y 0.08-0.155; chip x 0.27-0.73, y 0.84-0.915; GO INSIDE x 0.35-0.65, same y. */
export const ALERT_CARD = { left: -0.38, bottom: 0.69, right: 0.38, top: 0.84 };
export const CHIP_PANEL = { left: -0.46, bottom: -0.83, right: 0.46, top: -0.68 };
export const INSIDE_PANEL = { left: -0.3, bottom: -0.83, right: 0.3, top: -0.68 };
/** Line 1 (the card) per stage. */
export function cardLine(stage: Stage, secondsLeft: number, stayClock: string): string {
  if (stage === "leave") return "YOU CAN LEAVE THE SHELTER";
  if (stage === "stay") return `STAY IN THE SHELTER · ${stayClock}`;
  return alertLine(secondsLeft);
}
export type Chip = { text: string; tone: "white" | "red" | "amber"; plate: "guide" | "inside" | "none" };
/**
 * T62: line 2 (the bottom chip). The card and the chip are the only two label lines, in every state.
 * Inside the shelter the stay and leave text is on the card, so the chip is off.
 */
export function chipLine(s: { phase: string; stage: string; takeCover: boolean; turnAround: boolean; timeLine: string; distM: number; notice?: string }): Chip {
  if (s.phase === "arrived") return s.stage === "countdown" ? { text: "GO INSIDE", tone: "white", plate: "inside" } : { text: "", tone: "white", plate: "none" };
  if (s.stage === "leave") return { text: "", tone: "white", plate: "none" };
  if (s.takeCover) return { text: COVER_CHIP, tone: "red", plate: "guide" };
  if (s.turnAround) return { text: "TURN AROUND", tone: "amber", plate: "guide" };
  if (s.notice) return { text: s.notice, tone: "amber", plate: "guide" }; // T64: a sensor problem, live path only
  if (s.stage === "stay") return { text: `${Math.round(s.distM)} m to the shelter`, tone: "white", plate: "guide" };
  return { text: s.timeLine, tone: "white", plate: "guide" };
}
/** Measured in the T57 frames: mixed case 0.49, capitals 0.55 pixel per character per size unit (1536 x 864). */
export function textWidthPx(line: string, size: number): number {
  const perChar = line === line.toUpperCase() ? 0.55 : 0.49;
  return line.length * size * perChar;
}

/** Colours that change with the state (were inline in Lens2Hud). Bright, never dark red. */
export const HUD_RED: RGBA = [1, 0.42, 0.36, 1]; // "not in time" on the dark panel
export const HUD_GREEN: RGBA = [0.35, 0.95, 0.65, 1];
export const HUD_AMBER: RGBA = [1, 0.78, 0.25, 1];

/** WCAG relative luminance of an sRGB colour (0..1 channels). */
export function luminance(c: RGBA | number[]): number {
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
/** A plate with alpha a over a background: the colour the eye sees behind the text. */
export function over(plate: RGBA, bg: number[]): number[] {
  return [0, 1, 2].map((i) => plate[i] * plate[3] + bg[i] * (1 - plate[3]));
}
export function contrast(a: number[], b: number[]): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Pin label: approximate half width in screen units (-1..1 across), from the text length and size.
 * Measured in the VM: 'Shelter 30' at size 30 (thin) = 0.175 wide; bold + plate padding adds ~40 %. */
export const LABEL_W_PER_CHAR_SIZE = 0.00082;
export function labelHalfWidth(text: string, size: number): number {
  return (text.length * size * LABEL_W_PER_CHAR_SIZE) / 2;
}
/** T62: the label box, screen units = view fractions x 0.10-0.90, y 0.20-0.80. It stays clear of the card and the chip. */
export const LABEL_BOX = { left: -0.8, bottom: -0.6, right: 0.8, top: 0.6 };
export const LABEL_HALF_H = 0.05;
export const LABEL_GAP = 0.015;
/** T62: label centre: right of the pin, left of it when the right side has no room, always inside LABEL_BOX. */
export function labelPos(pinX: number, pinY: number, pinHalfW: number, halfW: number): { x: number; y: number } {
  let x = pinX + pinHalfW + LABEL_GAP + halfW;
  if (x + halfW > LABEL_BOX.right) x = pinX - pinHalfW - LABEL_GAP - halfW;
  x = Math.max(LABEL_BOX.left + halfW, Math.min(LABEL_BOX.right - halfW, x));
  const y = Math.max(LABEL_BOX.bottom + LABEL_HALF_H, Math.min(LABEL_BOX.top - LABEL_HALF_H, pinY));
  return { x, y };
}

// ---------------------------------------------------------------------------------------------
// T62: Stop button (Michael 9/11). View fractions: 72 px circle (on the 864 px high view) at x 0.80, y 0.865, 0.5 s hold.
export const STOP = { x: 0.8, y: 0.865, px: 72, viewW: 1536, viewH: 864, holdS: 0.5 };
export const STOP_ANCHORS = {
  left: 2 * STOP.x - 1 - STOP.px / STOP.viewW, bottom: 1 - 2 * STOP.y - STOP.px / STOP.viewH,
  right: 2 * STOP.x - 1 + STOP.px / STOP.viewW, top: 1 - 2 * STOP.y + STOP.px / STOP.viewH,
};
/** A touch at view fractions (x, y from the top left) is on the button. A finger gets 1.3 times the radius. */
export function onStop(x: number, y: number): boolean {
  const dx = (x - STOP.x) * STOP.viewW, dy = (y - STOP.y) * STOP.viewH;
  return Math.hypot(dx, dy) <= (STOP.px / 2) * 1.3;
}
/** Press on the button, keep it down for holdS. A press elsewhere or a short click does nothing. */
export class StopHold {
  private since = -1;
  press(x: number, y: number, t: number) { this.since = onStop(x, y) ? t : -1; }
  move(x: number, y: number) { if (!onStop(x, y)) this.since = -1; }
  release() { this.since = -1; }
  /** True once, when the hold is long enough. */
  done(t: number): boolean {
    if (this.since < 0 || t - this.since < STOP.holdS) return false;
    this.since = -1;
    return true;
  }
}
