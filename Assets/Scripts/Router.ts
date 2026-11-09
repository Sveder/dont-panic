// Walk-graph router: snap the user to the nearest street edge, Dijkstra to ALL shelters,
// pick the shortest walk. Pure logic, no scene objects. Units: metres in the local street frame.
import { region } from "./Region";
import { XZ } from "./GeoFrame";

export type Shelter = { id: number; name: string; x: number; z: number; node: number; door: XZ };
export type Route = { shelter: Shelter; length: number; points: XZ[]; cum: number[]; computedAt: number; reason: string; snapD: number };

type Edge = { a: number; b: number; len: number };

function projT(p: XZ, a: XZ, b: XZ): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-9) return 0;
  return Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
}
const lerp = (a: XZ, b: XZ, t: number): XZ => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const dist = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);

export class Router {
  nodes: XZ[] = [];
  edges: Edge[] = [];
  adj: { to: number; len: number }[][] = [];
  shelters: Shelter[] = [];

  constructor() {
    const WALK_DATA = region();
    this.nodes = WALK_DATA.nodes.map((n: number[]) => ({ x: n[0], z: n[1] }));
    for (const [a, b] of WALK_DATA.edges) this.edges.push({ a, b, len: dist(this.nodes[a], this.nodes[b]) });
    // attach every shelter to the graph: split its nearest edge at the projection ("door" on the street)
    for (const s of WALK_DATA.shelters) {
      const p = { x: s.x, z: s.z };
      const snap = this.snap(p);
      const e = this.edges[snap.edge];
      const id = this.nodes.length;
      this.nodes.push(snap.point);
      this.edges.splice(snap.edge, 1, { a: e.a, b: id, len: dist(this.nodes[e.a], snap.point) }, { a: id, b: e.b, len: dist(snap.point, this.nodes[e.b]) });
      this.shelters.push({ id: s.id, name: s.name, x: s.x, z: s.z, node: id, door: snap.point });
    }
    this.adj = this.nodes.map(() => []);
    for (const e of this.edges) {
      this.adj[e.a].push({ to: e.b, len: e.len });
      this.adj[e.b].push({ to: e.a, len: e.len });
    }
    print(`[router] graph ${this.nodes.length} nodes, ${this.edges.length} edges, ${this.shelters.length} shelters`);
  }

  /** Nearest point on any edge. */
  snap(p: XZ): { edge: number; t: number; point: XZ; d: number } {
    let best = { edge: 0, t: 0, point: p, d: Infinity };
    for (let i = 0; i < this.edges.length; i++) {
      const a = this.nodes[this.edges[i].a], b = this.nodes[this.edges[i].b];
      const t = projT(p, a, b);
      const q = lerp(a, b, t);
      const d = dist(p, q);
      if (d < best.d) best = { edge: i, t, point: q, d };
    }
    return best;
  }

  /** Shortest walk from p to any shelter. */
  route(p: XZ, reason: string): Route | null {
    const s = this.snap(p);
    const e = this.edges[s.edge];
    const n = this.nodes.length;
    const D = new Array(n).fill(Infinity);
    const prev = new Array(n).fill(-1);
    const done = new Array(n).fill(false);
    D[e.a] = s.t * e.len;
    D[e.b] = (1 - s.t) * e.len;
    for (;;) {
      let u = -1, du = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && D[i] < du) { du = D[i]; u = i; }
      if (u < 0) break;
      done[u] = true;
      for (const { to, len } of this.adj[u]) if (du + len < D[to]) { D[to] = du + len; prev[to] = u; }
    }
    let best: Shelter | null = null;
    for (const sh of this.shelters) if (!best || D[sh.node] < D[best.node]) best = sh;
    if (!best || D[best.node] === Infinity) return null;
    const chain: number[] = [];
    for (let v = best.node; v >= 0; v = prev[v]) chain.unshift(v);
    // off the street graph (in a plot, a yard): the route starts with a straight leg from the user to the street
    const offGraph = s.d > 9; // more than a street half-width: pavements lie up to ~8 m from the centre line
    const pts: XZ[] = offGraph ? [p, s.point] : [s.point];
    for (const v of chain) pts.push(this.nodes[v]);
    // drop repeated points (user exactly on a node)
    const clean: XZ[] = [];
    for (const q of pts) if (!clean.length || dist(clean[clean.length - 1], q) > 0.05) clean.push(q);
    if (clean.length === 1) clean.push(best.door);
    const cum = [0];
    for (let i = 1; i < clean.length; i++) cum.push(cum[i - 1] + dist(clean[i - 1], clean[i]));
    return { shelter: best, length: cum[cum.length - 1], points: clean, cum, computedAt: getTime(), reason, snapD: offGraph ? 0 : s.d };
  }
}

/** Position of the user along a route polyline: arc length of the nearest point, and distance to it. */
export function along(r: Route, p: XZ): { s: number; d: number; dir: XZ } {
  let best = { s: 0, d: Infinity, dir: { x: 0, z: 1 } };
  for (let i = 0; i < r.points.length - 1; i++) {
    const a = r.points[i], b = r.points[i + 1];
    const t = projT(p, a, b);
    const q = lerp(a, b, t);
    const d = dist(p, q);
    if (d < best.d) {
      const l = dist(a, b) || 1;
      best = { s: r.cum[i] + t * l, d, dir: { x: (b.x - a.x) / l, z: (b.z - a.z) / l } };
    }
  }
  return best;
}

/** Point and unit direction at arc length s. */
export function pointAt(r: Route, s: number): { p: XZ; dir: XZ } {
  s = Math.min(Math.max(0, s), r.length);
  for (let i = 0; i < r.points.length - 1; i++) {
    if (s <= r.cum[i + 1] || i === r.points.length - 2) {
      const a = r.points[i], b = r.points[i + 1];
      const l = r.cum[i + 1] - r.cum[i] || 1;
      const t = Math.min(1, (s - r.cum[i]) / l);
      return { p: lerp(a, b, t), dir: { x: (b.x - a.x) / l, z: (b.z - a.z) / l } };
    }
  }
  return { p: r.points[0], dir: { x: 0, z: 1 } };
}

/** Next turn after arc length s: compares the heading 6 m before and 6 m after each vertex. */
export function nextTurn(r: Route, s: number): { at: number; dir: string } | null {
  for (let i = 1; i < r.points.length - 1; i++) {
    const at = r.cum[i];
    if (at < s + 1) continue;
    const a = pointAt(r, at - 6).p, v = r.points[i], b = pointAt(r, at + 6).p;
    const d1 = { x: v.x - a.x, z: v.z - a.z }, d2 = { x: b.x - v.x, z: b.z - v.z };
    const l1 = Math.hypot(d1.x, d1.z), l2 = Math.hypot(d2.x, d2.z);
    if (l1 < 0.5 || l2 < 0.5) continue;
    const cos = (d1.x * d2.x + d1.z * d2.z) / (l1 * l2);
    if (cos > Math.cos((40 * Math.PI) / 180)) continue;
    const cy = d1.z * d2.x - d1.x * d2.z; // y of d1 x d2; frame x east, y up, z south
    return { at, dir: cos < -0.7 ? "around" : cy > 0 ? "left" : "right" };
  }
  return null;
}

// Wrong-turn rule. The 1 s timer re-plans quietly, so a walk into a wrong street only makes the
// route longer. When the remaining length grows more than `margin` m above the best length seen
// for this shelter, the user went the wrong way: report it once and start a new best.
export type WrongTurnState = { shelterId: number; best: number };
export function wrongTurn(s: WrongTurnState, shelterId: number, length: number, margin: number): boolean {
  if (s.shelterId !== shelterId) { s.shelterId = shelterId; s.best = length; return false; }
  if (length < s.best) { s.best = length; return false; }
  if (length > s.best + margin) { s.best = length; return true; }
  return false;
}
