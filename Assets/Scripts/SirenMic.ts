// T4: the microphone path of the siren detector. Every frame it reads the audio that arrived since the
// last frame, feeds SirenFeed (resample to 16 kHz + SirenDetector), prints the pitch once a second, and
// calls Lens2Hud.onSiren(conf) on a hit.
// Sources (input source):
//  - "mic": an Audio From Microphone asset (MicrophoneAudioProvider). On Spectacles this needs the
//    microphone permission. The editor has no microphone in our VM.
//  - "file": an Audio Track asset (data/audio/Civil_defense_siren_waver.ogg) read through the same
//    path, so the preview proves the detector without a microphone. Not played aloud.
import { SirenFeed } from "./SirenFeed";
import { Lens2Hud } from "./Lens2Hud";

@component
export class SirenMic extends BaseScriptComponent {
  @input @hint("mic or file") source: string = "mic";
  @input @allowUndefined @hint("Audio From Microphone asset") micAudio: AudioTrackAsset;
  @input @allowUndefined @hint("Editor fallback: the siren recording as an Audio Track asset") fileAudio: AudioTrackAsset;
  @input @hint("Seconds after the Lens start before the file fallback starts to read") fileStartAt: number = 3;
  @input hud: Lens2Hud;

  private mic: MicrophoneAudioProvider;
  private file: FileAudioTrackProvider;
  private buf: Float32Array;
  private feed: SirenFeed;
  private t0 = -1;
  private fileRead = 0;

  onAwake() {
    // T64: the live path always listens to the real microphone; a recording never raises a live alarm
    const src = this.hud && this.hud.isLive() ? "mic" : this.source;
    const asset = src === "file" ? this.fileAudio : this.micAudio;
    if (!asset) { print("[siren] no " + src + " audio asset; detector off"); return; }
    if (src === "file") {
      this.file = asset.control as FileAudioTrackProvider;
      this.feed = new SirenFeed(this.file.sampleRate);
      this.buf = new Float32Array(Math.max(this.file.maxFrameSize, Math.ceil(this.file.sampleRate * 0.25)));
    } else {
      this.mic = asset.control as MicrophoneAudioProvider;
      this.mic.sampleRate = 16000;
      this.feed = new SirenFeed(this.mic.sampleRate);
      this.buf = new Float32Array(this.mic.maxFrameSize);
    }
    print("[siren] source " + src + ", rate " + this.feed.inRate + " Hz, buffer " + this.buf.length);
    this.createEvent("OnStartEvent").bind(() => { this.t0 = getTime(); if (this.mic) this.mic.start(); });
    this.createEvent("UpdateEvent").bind(() => this.update());
    this.createEvent("OnDestroyEvent").bind(() => { if (this.mic) this.mic.stop(); });
  }

  private update() {
    if (!this.feed || this.t0 < 0) return;
    if (this.hud && this.hud.isStopped()) return; // T62: Stop ends the listening too
    let n = 0;
    if (this.mic) {
      n = this.mic.getAudioFrame(this.buf).x;
    } else {
      // The file is read at real time: the samples due since fileStartAt, at most one buffer a frame.
      const due = Math.floor((getTime() - this.t0 - this.fileStartAt) * this.file.sampleRate) - this.fileRead;
      if (due <= 0) return;
      n = this.file.getAudioBuffer(this.buf, Math.min(due, this.buf.length)).x;
      this.fileRead += n;
    }
    if (n <= 0) return;
    const hits = this.feed.push(this.buf, n);
    for (const l of this.feed.takeLines()) print(l);
    for (const h of hits) {
      print("[siren] DETECTED at t " + h.t.toFixed(1) + " s conf " + h.conf + " " + h.dir + " span " + h.span + " Hz");
      if (this.hud) this.hud.onSiren(h.conf);
    }
  }
}
