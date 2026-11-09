// lens2: the HUD on top of Michael's walk video. No 3D geometry.
// Two ways to show the video (input useVideoTexture):
//  - false (default): the walk video is the Preview camera input (Preview > Multimedia > walk884c.mp4).
//    The Lens draws only the HUD over the camera, like on Spectacles. Clock = seconds since the Lens start.
//  - true: the walk video plays as a Video Texture on the full-screen 'Video Background' image.
//    Clock = the video time. (In our Windows VM the Video Texture stays on frame 1; on a real PC it plays.)
// T47: input clockMode picks the replay clock (VideoClock.ts): "lens" (getTime, drifts against the preview
// video), "frames" (camera frames / fps; camera = the walk video in the preview), "stamp" (camera frame
// timestamps). useVideoTexture on = "texture". A [clock] line every 10 s logs every clock for a drift check.
// Every frame the script asks HudLogic what the HUD shows at that time (replayed GPS + where the camera
// looked) and moves the screen objects.
// T64: input source. "replay" (default) = all of the above. "live" = the Spectacles GPS and compass (LiveSensors.ts);
// no video, no recorded track, and the alarm comes from the microphone (SirenMic) or demoSirenAt.
import { Hud, LIVE_HEADER, HudState, HFC_COVER, arrowScreenRotDeg, infoLine, HUD_STYLE, HUD_RED, HUD_AMBER, TextStyle, RGBA, labelHalfWidth, labelPos, cardLine, chipLine, StopHold } from "./HudLogic";
import { VideoClock } from "./VideoClock";
import { LiveSensors } from "./LiveSensors";
import { AlertFeed } from "./AlertFeed";
import { liveInfoLine } from "./LivePath";

@component
export class Lens2Hud extends BaseScriptComponent {
  @input @hint("T64: replay = the recorded walk and the video (default). live = the Spectacles GPS and compass") source: string = "replay";
  @input useVideoTexture: boolean = false;
  @input video: Texture;
  @input videoBackground: SceneObject;
  @input @hint("T47 replay clock: lens | frames | stamp (texture when Use Video Texture is on)") clockMode: string = "lens";
  @input @hint("Frames per second of the walk video (frames clock)") videoFps: number = 30;
  @input @hint("Lens clock correction: video seconds per Lens second (1 = none). Measure with the timecode video, see README") clockRate: number = 1;
  @input @allowUndefined @hint("Device Camera Texture: the preview video frames drive the frames/stamp clock") cameraTexture: Texture;
  @input @allowUndefined siren: AudioComponent;
  @input arrow: SceneObject;
  @input alertCard: SceneObject;
  @input alertText: Text;
  @input panel: SceneObject;
  @input timeText: Text;
  @input marker: SceneObject;
  @input markerText: Text;
  @input insidePanel: SceneObject;
  @input insideText: Text;
  @input @allowUndefined infoText: Text;
  @input @hint("T56: show the replay debug line (t, heading, pitch) at the bottom. Off for every demo") showDebug: boolean = false;
  @input @allowUndefined @hint("T30: full-screen image that flashes red when an alarm starts (for a user who cannot hear the siren)") viewFlash: SceneObject;
  @input @hint("Seconds the video is shifted against the walk track (track t = video t + offset)") offset: number = 0;
  @input @hint("Stay in the shelter countdown, seconds. 600 on the real Lens; set e.g. 20 to see the end in a preview") staySeconds: number = 600;
  @input @hint("Walking pace for the time check, m/s (1.2 = with two children)") paceMps: number = 1.2;
  @input @hint("Demo: alert time in seconds instead of the area time (e.g. 20 shows the take-cover line). -1 = area time") demoAlertTime: number = -1;
  @input @hint("Demo (T30): no recorded alert; the siren path raises the alarm at this track time, as if the microphone heard it. -1 = off") demoSirenAt: number = -1;
  @input @hint("T62: true = the alarm time recorded in the track starts the alert. false (default) = only the siren detector (SirenMic) raises the alarm") recordedAlarm: boolean = false;
  @input @allowUndefined @hint("T62: Stop button image, shown from the alert on") stopButton: SceneObject;
  @input @hint("Demo: a second alarm at this track time restarts the sequence. -1 = off") demoSecondAlarmAt: number = -1;
  @input @hint("T65: URL of the alert relay, for example http://<server>/alerts/hfc/ . Empty (default) = no official alert path and no network request") alertUrl: string = "";
  @input @hint("T65: Home Front Command area name prefixes, comma separated, for example: תל אביב. Empty = the official alert path stays off") alertArea: string = "";
  // Not a require(): a require declares the internet permission in every build, and Snap blocks internet together with microphone or GPS in a published Lens.
  @input @allowUndefined @hint("T65: add an Internet Module asset and wire it here to use the official alert path. See the README about the permission limit") internetModule: InternetModule;

  private hud: Hud;
  private vp: VideoTextureProvider;
  private clock: VideoClock;
  private lastClockLog = -10;
  private sirenOn = false;
  private lastLog = -10;
  private lastAlarm = -1;
  private lastStage = "";

  private sensors: LiveSensors;
  private worldCam: Camera = null;
  private liveStart = 0;
  private lastSensor = "";

  private stopHold = new StopHold();
  private stopped = false;
  private feed: AlertFeed;

  onAwake() {
    this.hud = this.isLive() ? new Hud(LIVE_HEADER) : new Hud();
    this.hud.stayS = this.staySeconds;
    this.hud.paceMps = this.paceMps;
    if (this.demoAlertTime > 0) this.hud.tr = Object.assign({}, this.hud.tr, { alert_time_s: this.demoAlertTime });
    if (this.isLive() || this.demoSirenAt >= 0 || !this.recordedAlarm) this.hud.clearAlarms();
    if (this.demoSecondAlarmAt >= 0) this.hud.addAlarm(this.demoSecondAlarmAt);
    this.feed = new AlertFeed(this.alertUrl, this.alertArea, !!this.internetModule);
    print("[feed] official alert path " + (this.feed.enabled() ? "on: " + this.feed.url : "off: " + this.feed.offReason));
    this.createEvent("UpdateEvent").bind(() => this.update());
    // T62: touch in the phone-type project, a mouse press in the preview. This project has no SIK package, so no pinch yet.
    this.createEvent("TouchStartEvent").bind((e: TouchStartEvent) => { const p = e.getTouchPosition(); if (this.stopButton && this.stopButton.enabled) this.stopHold.press(p.x, p.y, getTime()); });
    this.createEvent("TouchMoveEvent").bind((e: TouchMoveEvent) => { const p = e.getTouchPosition(); this.stopHold.move(p.x, p.y); });
    this.createEvent("TouchEndEvent").bind(() => this.stopHold.release());
    this.applyStyles();
    this.show(false, false, false, false);
    if (this.infoText) this.infoText.getSceneObject().enabled = this.showDebug;
    this.videoBackground.enabled = this.useVideoTexture && !this.isLive();
    if (this.isLive()) { this.startLive(); return; }
    print("[lens2] Lens2Hud awake, track " + this.hud.tr.id + ", shelter " + this.hud.tr.shelter + ", video " + (this.useVideoTexture ? "texture" : "camera input"));
    this.clock = new VideoClock(this.useVideoTexture ? "texture" : this.clockMode, this.videoFps, this.clockRate);
    print("[lens2] clock " + this.clock.mode + (this.cameraTexture ? "" : " (no camera texture wired: frames/stamp use the Lens clock)"));
    if (!this.useVideoTexture) {
      this.clock.start(getTime());
      if (this.cameraTexture) {
        // onNewFrame exists only on Spectacles (snapOS). In a mobile-type preview the getter throws:
        // "API not available on the simulated platform", so the clock falls back to the Lens clock.
        try {
          const cp = this.cameraTexture.control as CameraTextureProvider;
          cp.onNewFrame.add((f: CameraFrame) => this.clock.onFrame(getTime(), f.timestampSeconds));
        } catch (e) {
          print("[lens2] camera onNewFrame not available here (" + e + "): clock uses the Lens clock x clockRate");
        }
      }
      return;
    }
    this.vp = this.video.control as VideoTextureProvider;
    this.vp.setOnReady(() => { this.vp.play(1); this.clock.start(getTime()); print("[lens2] video ready, playing, duration " + this.vp.duration.toFixed(1) + " s"); });
    this.vp.setOnFinish(() => print("[lens2] video finished"));
    if (this.vp.getStatus() === VideoStatus.Unloaded) this.vp.load(false);
    else { this.vp.play(1); this.clock.start(getTime()); }
  }

  /** T64: true when the HUD reads the real sensors. SirenMic reads this too. */
  isLive(): boolean { return this.source === "live"; }

  /** T64: start the sensors; the pin uses the field of view of the world camera. */
  private startLive() {
    this.liveStart = getTime();
    this.worldCam = this.findWorldCamera();
    if (this.worldCam) this.hud.setFov((this.worldCam.fov * 180) / Math.PI, this.worldCam.aspect);
    this.sensors = new LiveSensors();
    this.sensors.start();
    print("[live] source live, " + this.hud.router.shelters.length + " shelters, field of view " + this.hud.hfov.toFixed(0) + " x " + this.hud.vfov.toFixed(0) + " deg" + (this.worldCam ? "" : " (no perspective camera found: pitch 0)"));
  }

  /** The perspective camera at the scene root: its forward direction gives the pitch. */
  private findWorldCamera(): Camera {
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++) {
      const c = global.scene.getRootObject(i).getComponent("Component.Camera") as Camera;
      if (c && c.type === Camera.Type.Perspective) return c;
    }
    return null;
  }

  /** Camera pitch in degrees, negative = looking down. */
  private livePitch(): number {
    if (!this.worldCam) return 0;
    const f = this.worldCam.getSceneObject().getTransform().back; // a camera looks along its local -Z
    return (Math.asin(Math.max(-1, Math.min(1, f.y))) * 180) / Math.PI;
  }

  /** Seconds on the HUD clock: the video clock with its offset, or the time since the Lens start in live mode. */
  private hudTime(): number {
    return this.isLive() ? getTime() - this.liveStart : this.videoTime() + this.offset;
  }

  /** T57: bold, bright, outlined text; a dark plate with padding where no panel image sits behind the line. */
  private styleText(t: Text, st: TextStyle, plateOn: boolean = true) {
    if (!t) return;
    t.size = st.size;
    try { t.weight = st.weight; } catch (e) { /* font without a weight axis: the outline still thickens it */ }
    t.textFill.color = rgba(st.color);
    t.outlineSettings.enabled = st.outline > 0;
    t.outlineSettings.size = st.outline;
    t.outlineSettings.fill.color = new vec4(0, 0, 0, 1);
    const bg = t.backgroundSettings;
    bg.enabled = plateOn && st.plate !== null;
    if (st.plate) {
      bg.fill.color = rgba(st.plate);
      bg.cornerRadius = 0.4;
      bg.margins = Rect.create(st.padX, st.padX, st.padY, st.padY);
    }
  }

  private applyStyles() {
    this.styleText(this.alertText, HUD_STYLE.alert);
    this.styleText(this.timeText, HUD_STYLE.chip);
    this.styleText(this.markerText, HUD_STYLE.marker);
    this.styleText(this.insideText, HUD_STYLE.inside);
  }

  /** T30: the microphone siren detector (T4) calls this on a detection. */
  onSiren(conf: number) {
    if (this.stopped) return;
    this.hud.sirenHeard(this.hudTime(), conf);
  }

  /** T65: one request to the alert relay when one is due. */
  private pollFeed() {
    this.feed.request(getTime(), (u: string) => this.internetModule.fetch(u), (r) => {
      if (r.note) print("[feed] " + r.note);
      if (r.raise && !this.stopped) this.hud.feedAlert(this.hudTime(), r.title + " · " + r.areas.join(", "));
    });
  }

  private videoTime(): number {
    if (!this.clock || !this.clock.started()) return 0;
    const now = getTime(), tex = this.vp ? this.vp.currentTime : 0;
    if (now - this.lastClockLog >= 10) { this.lastClockLog = now; print(this.clock.report(now, tex)); }
    return this.clock.time(now, tex);
  }

  private show(alert: boolean, guide: boolean, marker: boolean, inside: boolean) {
    this.alertCard.enabled = alert;
    this.arrow.enabled = guide;
    this.panel.enabled = guide;
    this.marker.enabled = marker;
    this.insidePanel.enabled = inside;
  }

  /** T62: true after the Stop button. SirenMic stops reading the audio. */
  isStopped(): boolean { return this.stopped; }

  /** T62: Stop = HUD off, siren off, timers stopped. */
  private stopAll() {
    this.stopped = true;
    this.show(false, false, false, false);
    if (this.viewFlash) this.viewFlash.enabled = false;
    if (this.stopButton) this.stopButton.enabled = false;
    if (this.siren && this.sirenOn) this.siren.stop(false);
    this.sirenOn = false;
    print("[lens2] Stop button: HUD off, siren off, timers stopped");
  }

  private update() {
    if (this.stopped) return;
    if (this.stopHold.done(getTime())) { this.stopAll(); return; }
    this.pollFeed();
    const t = this.hudTime();
    if (this.demoSirenAt >= 0 && t >= this.demoSirenAt && this.hud.sirenAlarms.length === 0) this.hud.sirenHeard(this.demoSirenAt, 1);
    let s: HudState;
    if (this.isLive()) {
      const now = getTime();
      this.sensors.poll(now);
      const l = this.sensors.read(now, this.livePitch());
      s = this.hud.stepLive(t, l);
      if (l.status !== this.lastSensor) { this.lastSensor = l.status; print("[live] " + liveInfoLine(t, l) + (this.sensors.error ? " error: " + this.sensors.error : "")); }
      if (this.infoText && this.showDebug) this.infoText.text = liveInfoLine(t, l);
    } else {
      s = this.hud.step(t);
      if (this.infoText && this.showDebug) this.infoText.text = infoLine(true, t, s.heading, s.pitch);
    }
    if (this.viewFlash) this.viewFlash.enabled = s.viewFlash;
    if (this.stopButton) this.stopButton.enabled = s.alert;
    if (!s.alert) { this.show(false, false, false, false); this.sirenOn = false; return; }
    if (s.alarmAt !== this.lastAlarm) { this.lastAlarm = s.alarmAt; this.sirenOn = false; print(`[lens2] alarm ${s.alarms} at t ${s.alarmAt.toFixed(1)} source ${s.source}: sequence starts`); }
    if (s.stage !== this.lastStage) { this.lastStage = s.stage; print(`[lens2] t ${t.toFixed(1)} stage ${s.stage} stay ${s.stayClock}`); }
    if (!this.sirenOn && this.siren && s.stage === "countdown") { this.siren.play(1); this.sirenOn = true; }
    const arrived = s.phase === "arrived";
    this.show(true, !arrived, s.marker.visible, arrived);
    this.arrow.enabled = !arrived && s.guide; // T64: no route or no compass = no arrow
    // alert card: flashes for the first 4 s
    // T46: the card follows the sequence: alert countdown, then the 10-minute stay, then "you can leave"
    const card = this.alertCard.getComponent("Component.Image") as Image;
    this.alertText.text = cardLine(s.stage, s.secondsLeft, s.stayClock);
    this.alertText.size = s.stage === "countdown" ? HUD_STYLE.alert.size : HUD_STYLE.alertLong.size;
    if (card) {
      if (s.stage === "leave") card.mainPass.baseColor = new vec4(0.1, 0.55, 0.3, 0.85);
      else if (s.stage === "stay") card.mainPass.baseColor = new vec4(0.85, 0.5, 0.08, 0.8);
      else card.mainPass.baseColor = new vec4(0.8, 0.08, 0.12, s.flash ? 0.95 : 0.75);
    }
    // T62: line 2. The guide chip and the GO INSIDE plate use the same place and never show together.
    const chip = chipLine(s);
    this.panel.enabled = chip.plate === "guide";
    this.insidePanel.enabled = chip.plate === "inside";
    if (chip.plate === "guide") {
      this.timeText.text = chip.text;
      this.timeText.textFill.color = rgba(chip.tone === "red" ? HUD_RED : chip.tone === "amber" ? HUD_AMBER : HUD_STYLE.chip.color);
    } else if (chip.plate === "inside") {
      this.insideText.text = chip.text;
    }
    if (!arrived && s.guide) {
      // arrow fixed in view; rotates toward the next route corner relative to where the camera looks
      const st = this.arrow.getComponent("Component.ScreenTransform") as ScreenTransform;
      st.rotation = quat.fromEulerAngles(0, 0, (arrowScreenRotDeg(s.arrowDeg) * Math.PI) / 180);
    }
    if (s.marker.visible) {
      const mt = this.marker.getComponent("Component.ScreenTransform") as ScreenTransform;
      const h = s.marker.size, halfW = (h * 9) / 16 / 2, halfH = h / 2;
      const pinY = s.marker.y + 0.39 * h; // pin tip on the door
      mt.anchors.setCenter(new vec2(s.marker.x, pinY));
      mt.anchors.setSize(new vec2(halfW * 2, h));
      this.markerText.text = s.shelter;
      // T62: the label sits right of the pin inside LABEL_BOX; the pin itself keeps the true direction.
      // The label is a child of the pin, so its anchors are in pin half sizes.
      const lt = this.markerText.getSceneObject().getComponent("Component.ScreenTransform") as ScreenTransform;
      if (lt) {
        const p = labelPos(s.marker.x, pinY, halfW, labelHalfWidth(s.shelter, HUD_STYLE.marker.size));
        lt.anchors.setCenter(new vec2((p.x - s.marker.x) / halfW, (p.y - pinY) / halfH));
      }
    }
    if (t - this.lastLog >= 5) {
      this.lastLog = t;
      print(`[lens2] t ${t.toFixed(1)} ${s.phase} dist ${Math.round(s.distM)} arrow ${Math.round(s.arrowDeg)} hdg ${Math.round(s.heading)} marker ${s.marker.visible ? s.marker.x.toFixed(2) + "," + s.marker.y.toFixed(2) : "-"} left ${s.secondsLeft} eta ${Math.round(s.etaS)}${s.takeCover ? " TAKE COVER" : ""}`);
      if (s.takeCover && s.stage === "countdown") print("[lens2] take cover: " + HFC_COVER);
    }
  }
}

function rgba(c: RGBA): vec4 {
  return new vec4(c[0], c[1], c[2], c[3]);
}
