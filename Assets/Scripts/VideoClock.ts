// T47: the clock that drives the replay. Pure logic (no Lens globals), tested in node:
//   node lensbuild/test/test_video_clock.cjs
// Modes:
//  - "lens"    seconds since the Lens start (getTime) x rate. Drifts against the preview video (rec3: up to 1.8 s
//              in 93 s). rate (input clockRate) corrects a measured drift: rate = video seconds / Lens seconds.
//  - "frames"  number of camera frames seen / fps. In the preview the camera input is the walk video, so one
//              new camera frame = one video frame, if the preview drops no frames.
//  - "stamp"   timestamp of the newest camera frame minus the first one (CameraFrame.timestampSeconds).
//  - "texture" the Video Texture time (useVideoTexture on). Falls back to "lens" while the time is 0.
// "frames" and "stamp" also fall back to "lens" until the first camera frame arrives.
// Between two camera frames the clock adds the time since the last frame (max one frame), so the HUD moves smoothly.

export type ClockMode = "lens" | "frames" | "stamp" | "texture";
export const CLOCK_MODES: ClockMode[] = ["lens", "frames", "stamp", "texture"];

export class VideoClock {
  mode: ClockMode;
  fps: number;
  rate: number;
  frames = 0;
  private t0 = -1;
  private firstStamp = -1;
  private lastStamp = -1;
  private lastFrameAt = -1;

  constructor(mode: string, fps = 30, rate = 1) {
    this.mode = (CLOCK_MODES.indexOf(mode as ClockMode) >= 0 ? mode : "lens") as ClockMode;
    this.fps = fps > 0 ? fps : 30;
    this.rate = rate > 0 ? rate : 1;
  }

  started(): boolean { return this.t0 >= 0; }

  start(now: number) { this.t0 = now; this.frames = 0; this.firstStamp = -1; this.lastStamp = -1; this.lastFrameAt = -1; }

  /** One new camera frame. now = getTime(), stamp = CameraFrame.timestampSeconds. */
  onFrame(now: number, stamp: number) {
    if (this.t0 < 0) return;
    this.frames++;
    if (this.firstStamp < 0) this.firstStamp = stamp;
    this.lastStamp = stamp;
    this.lastFrameAt = now;
  }

  lensTime(now: number): number { return this.t0 < 0 ? 0 : Math.max(0, now - this.t0) * this.rate; }

  private between(now: number): number {
    return Math.min(Math.max(0, now - this.lastFrameAt), 1 / this.fps);
  }

  framesTime(now: number): number {
    return this.frames === 0 ? this.lensTime(now) : (this.frames - 1) / this.fps + this.between(now);
  }

  stampTime(now: number): number {
    return this.frames === 0 ? this.lensTime(now) : (this.lastStamp - this.firstStamp) + this.between(now);
  }

  /** The replay time now. textureTime = VideoTextureProvider.currentTime (texture mode only). */
  time(now: number, textureTime = 0): number {
    if (this.t0 < 0) return 0;
    switch (this.mode) {
      case "frames": return this.framesTime(now);
      case "stamp": return this.stampTime(now);
      case "texture": return textureTime > 0 ? textureTime : this.lensTime(now);
      default: return this.lensTime(now);
    }
  }

  /** One log line with every clock, to measure the drift against the video. */
  report(now: number, textureTime = 0): string {
    return `[clock] mode ${this.mode} rate ${this.rate} lens ${this.lensTime(now).toFixed(2)} frames ${this.framesTime(now).toFixed(2)} (n ${this.frames}) ` +
      `stamp ${this.stampTime(now).toFixed(2)} texture ${textureTime.toFixed(2)}`;
  }
}
