// T64: reads the Spectacles location and compass APIs and feeds LiveTracker (LivePath.ts).
// Written against the Lens Studio 5.24.1 typings (Support/StudioLib.d.ts) and the Spectacles Location guide.
// A node test runs this file with a fake GeoLocation. It has not run on a real device.
// The require line declares the GPS permission (RawLocationModule). Lens Studio then lists "GPS - Precise" in
// Project Settings > Spectacles. Without the declaration, snapOS denies the location calls.
require("LensStudio:RawLocationModule");
import { LiveTracker, LiveInput } from "./LivePath";

/** Seconds between two position requests (the Spectacles Location guide uses 1 s). */
export const POLL_S = 1;
/** A request with no answer for this long no longer blocks the next one. */
export const REQUEST_TIMEOUT_S = 5;

export class LiveSensors {
  readonly tracker = new LiveTracker();
  error = "";
  private service: LocationService | null = null;
  private inFlight = false;
  private askedAt = -1e9;
  private lastStamp = NaN;

  /** Creates the LocationService. On failure the HUD stays on "No GPS" and error says why. */
  start() {
    try {
      this.service = GeoLocation.createLocationService();
      this.service.accuracy = GeoLocationAccuracy.Navigation;
      this.service.onNorthAlignedOrientationUpdate.add((q: quat, acc: CompassTrackingData.Accuracy) => this.onOrientation(q, acc));
      print("[live] LocationService started, accuracy Navigation");
    } catch (e) {
      this.service = null;
      this.fail("" + e);
    }
  }

  private onOrientation(q: quat, acc: CompassTrackingData.Accuracy) {
    if (acc === CompassTrackingData.Accuracy.NoContact) return;
    this.tracker.onHeading(GeoLocation.getNorthAlignedHeading(q), acc === CompassTrackingData.Accuracy.Unreliable, getTime());
  }

  private fail(msg: string) {
    if (msg !== this.error) print("[live] location error: " + msg);
    this.error = msg;
  }

  /** Call every frame. Asks for a new position once per POLL_S, one request at a time. */
  poll(now: number) {
    if (!this.service) return;
    if (this.inFlight && now - this.askedAt < REQUEST_TIMEOUT_S) return;
    if (now - this.askedAt < POLL_S) return;
    this.askedAt = now;
    this.inFlight = true;
    this.service.getCurrentPosition(
      (p: GeoPosition) => {
        this.inFlight = false;
        this.error = "";
        // The Location guide compares timestamps: the same timestamp is the same fix, not a new one.
        const stamp = p.timestamp ? p.timestamp.getTime() : NaN;
        if (stamp === this.lastStamp) return;
        this.lastStamp = stamp;
        this.tracker.onFix(p.latitude, p.longitude, p.horizontalAccuracy, getTime());
      },
      (err: string) => {
        this.inFlight = false;
        this.fail(err);
      },
    );
  }

  read(now: number, pitch: number): LiveInput {
    return this.tracker.read(now, pitch);
  }
}
