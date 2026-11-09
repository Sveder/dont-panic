// lens2 walk areas. The replay stays on the Ramat Gan demo walk (WalkDataRG.ts, OSM streets around walk 884c).
// T66: the live path can also use central Tel Aviv (WalkDataTLV.ts). Hud.stepLive selects the area with areaAt().
// Router and GeoFrame read the area through region(), like in the old lens.
import { WALK_DATA_RG } from "./WalkDataRG";
import { WALK_DATA_TLV } from "./WalkDataTLV";
import { OUTSIDE_MARGIN_M, outsideBox } from "./LivePath";

export type WalkArea = {
  lat0: number; lon0: number; kx: number; kz: number; box: number[]; margin: number;
  start: number[]; startHeading: number[]; nodes: number[][]; edges: number[][];
  shelters: { id: number; name: string; lat: number; lon: number; x: number; z: number }[];
};

export const AREAS: WalkArea[] = [WALK_DATA_RG as WalkArea, WALK_DATA_TLV as WalkArea];

let active: WalkArea = AREAS[0];
export function region(): WalkArea { return active; }
export function setRegion(d: WalkArea) { active = d; }

/** The nearest area (box centre) that holds this position, with the outside-the-map margin. Null when no area holds it. */
export function areaAt(lat: number, lon: number): WalkArea | null {
  let best: WalkArea | null = null, bestD = Infinity;
  for (const a of AREAS) {
    const x = (lon - a.lon0) * a.kx, z = (a.lat0 - lat) * a.kz;
    if (outsideBox(x, z, a.box, OUTSIDE_MARGIN_M)) continue;
    const d = Math.hypot(x - (a.box[0] + a.box[2]) / 2, z - (a.box[1] + a.box[3]) / 2);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}
