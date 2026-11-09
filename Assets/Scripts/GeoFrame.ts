// Local metre frame of the street model <-> WGS84.
// x = east (m), z = south (m), origin = (lat0, lon0) = start of the demo route in Tel Aviv.
// Same equirectangular transform as lensbuild/make_walkdata.py and streetdemo/scene.json.
import { region } from "./Region";

export type LatLon = { lat: number; lon: number };
export type XZ = { x: number; z: number };

// origin and scale come from the active walk area (Region.ts): kx = metres per degree of longitude
// at lat0, kz = metres per degree of latitude
export function toLocal(p: LatLon): XZ {
  const r = region();
  return { x: (p.lon - r.lon0) * r.kx, z: (r.lat0 - p.lat) * r.kz };
}

export function toLatLon(p: XZ): LatLon {
  const r = region();
  return { lat: r.lat0 - p.z / r.kz, lon: r.lon0 + p.x / r.kx };
}

/** Compass heading (deg, 0 = north, clockwise) -> unit vector in the local frame. */
export function headingToDir(deg: number): XZ {
  const r = (deg * Math.PI) / 180;
  return { x: Math.sin(r), z: -Math.cos(r) };
}

/** Unit vector in the local frame -> compass heading (deg). */
export function dirToHeading(d: XZ): number {
  const h = (Math.atan2(d.x, -d.z) * 180) / Math.PI;
  return (h + 360) % 360;
}
