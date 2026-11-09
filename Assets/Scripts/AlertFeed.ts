// T65: the official alert path. Pure logic, no Lens globals: Lens2Hud does the fetch and passes the reply here.
// The feed is the relay in the home dashboard (GET /alerts/hfc/), because oref answers Israeli addresses only.
// Off by default: an empty URL means no request at all. An empty area also means off, so a rocket alert in
// another part of the country cannot send the wearer to a shelter.
export const ALERT_POLL_S = 2;
/** A request with no answer for this long counts as failed, so one lost reply cannot stop the polling. */
export const ALERT_REQUEST_TIMEOUT_S = 10;

export type FeedResult = { raise: boolean; title: string; areas: string[]; note: string };

export function alertFeedUrl(base: string, area: string): string {
  const url = (base || "").trim(), a = (area || "").trim();
  if (!url || !a) return "";
  return url + (url.indexOf("?") >= 0 ? "&" : "?") + "area=" + encodeURIComponent(a);
}

export class AlertFeed {
  readonly url: string;
  readonly offReason: string;
  private lastId = "";
  private busySince = -1;
  private nextAt = 0;
  private state = "";

  constructor(base: string, area: string, hasInternet: boolean) {
    const b = (base || "").trim();
    this.offReason = !b ? "no alert URL" : !(area || "").trim() ? "no alert area" : !hasInternet ? "no Internet Module wired" : "";
    this.url = this.offReason ? "" : alertFeedUrl(b, area);
  }

  enabled(): boolean { return this.url !== ""; }

  /** True when the Lens must start a request now. Marks the request as started. */
  poll(now: number): boolean {
    if (!this.enabled()) return false;
    if (this.busySince >= 0 && now - this.busySince < ALERT_REQUEST_TIMEOUT_S) return false;
    if (this.busySince < 0 && now < this.nextAt) return false;
    this.busySince = now;
    this.nextAt = now + ALERT_POLL_S;
    return true;
  }

  private done(state: string, title = "", areas: string[] = [], raise = false): FeedResult {
    this.busySince = -1;
    const note = state !== this.state ? state : "";
    this.state = state;
    return { raise, title, areas, note };
  }

  /**
   * One request when one is due. fetcher is InternetModule.fetch. It can throw at once: the preview of a
   * mobile-type project says "API not available on the simulated platform". A failure gives a log line
   * and the next poll; it must not stop the HUD, and the siren path still works.
   */
  request(now: number, fetcher: (url: string) => Promise<any>, done: (r: FeedResult) => void) {
    if (!this.poll(now)) return;
    try {
      fetcher(this.url)
        .then((r: any) => r.text().then((b: string) => done(this.reply(r.status, b))))
        .catch((e: any) => done(this.fail("" + e)));
    } catch (e) {
      done(this.fail("" + e));
    }
  }

  private fail(why: string): FeedResult { return this.done("alert feed failed: " + why); }

  /** The answer to a request: HTTP status (0 = network error) and body. Only a real shelter alert raises. */
  reply(status: number, body: string): FeedResult {
    if (status !== 200) return this.done("alert feed failed: HTTP " + status);
    let j: any;
    try { j = JSON.parse(body); } catch (e) { return this.done("alert feed failed: reply is not JSON"); }
    if (!j || typeof j !== "object") return this.done("alert feed failed: reply is not an object");
    if (j.source === "error") return this.done("alert feed failed: the relay cannot read oref");
    if (j.active !== true) return this.done("alert feed ok: no alert for this area");
    const id = String(j.id || "");
    if (id && id === this.lastId) return this.done("alert feed ok: alert " + id + " is running");
    this.lastId = id;
    return this.done("alert feed ok: alert " + id + " is running", String(j.title || ""), Array.isArray(j.areas) ? j.areas.map(String) : [], true);
  }
}
