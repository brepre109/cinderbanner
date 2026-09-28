// The jump-graph kernel (PLAN §4.1-§4.4). Everything the analysers, the editor overlays and the
// generator's acceptance loop ask about verticality is a query against ONE static edge array.
//
// The whole trick: rules.js admits a step iff `Math.abs(t.h - t0.h) <= jump * HEIGHT_STEP`, which
// is a THRESHOLD on a static per-edge weight. So every tier's subgraph is a sublevel set of one
// Int16Array, tier subgraphs are nested by construction (a higher climb only ever ADDS edges), and
// `d(2) >= d(4) >= d(6) >= ...` is a theorem rather than something to prove per map. We still
// assert it in analysis/ladder.js — as a self-check on THIS file, not on the map.
//
// Why not call rules.js reachable() live: it keys Maps by `${x},${z}` and re-sorts the whole open
// list on every dequeue (rules.js:168-170). A tier ladder is 5 sources x 7 tiers of unbounded
// floods per recompute. reachable() stays the CI parity oracle (tools parity test, PLAN §9.2);
// this is the loop. Zero three.js: runs under bare `node`.
import { HEIGHT_STEP } from '../game/rules.js';

export { HEIGHT_STEP };
// Sentinel for "no edge here". Int16Array max, so it can never collide with a real |dh| (schema
// bounds heights to -7..60, giving |dh| <= 67) and it survives `need <= climb` for any finite climb.
export const NO_EDGE = 32767;
const MAX_CLIMB = NO_EDGE - 1;                       // clamps Infinity so NO_EDGE stays excluded
// Schema bounds authored H to -7..60, but buildGraph takes any MAP, validated or not, and an
// unchecked h=40000 WRAPPED Int16 to -25536: a 40000h cliff became |dh|=2 and walked at climb 2h, a
// silent connectivity lie. Out-of-band heights are clamped to +-H_LIMIT and their tiles SEVERED
// (incident edges stay NO_EDGE), matching rules.js, whose ignore_height sentinel is jump 99 = 198h
// and so refuses the step as well. Rounding an in-band fraction is validate.js's business, not this.
export const H_LIMIT = 8192;

/** JUMP stat -> the h budget rules.js tests. `jump >= 99` is ignore_height's sentinel: unbounded. */
export function jumpToClimb(jump) { return jump >= 99 ? Infinity : jump * HEIGHT_STEP; }
/** h budget -> the minimum JUMP stat that clears it. This is the `need` of the task brief. */
export function climbToJump(climb) { return Number.isFinite(climb) ? Math.ceil(climb / HEIGHT_STEP) : Infinity; }

/**
 * @typedef {Object} Graph
 * @property {number} w @property {number} d @property {number} n            n = w*d
 * @property {Int16Array} h      height in h steps
 * @property {Uint8Array} pass   bit 0 = t.walk, bit 1 = t.water. 0 impassable, 1 land, 2 open
 *                               water, 3 a DECKED water tile (walkable AND still water).
 * @property {Int16Array} need   need[2i] = east edge i->i+1, need[2i+1] = south edge i->i+w.
 *                               |dh| when BOTH endpoints are land-passable, else NO_EDGE.
 * @property {Int16Array} needW  the same with water counted passable (terrain_walker / Float).
 * @property {number} clamped    tiles whose height was out of band (clamped AND severed); >0 means
 *                               an out-of-schema MAP whose graph is only an approximation.
 * @property {(x:number,z:number)=>number} idx
 * @property {(i:number)=>[number,number]} xz
 */

/**
 * One pass over the tiles, one pass over the edges. 48x48 = 2304 nodes / 4608 edges / ~40 KB.
 * Heights are ROUNDED to integers: grid.H is integral by schema (the rules unit, the terrace
 * vocabulary and the +10% cliff are all stated in even h), and Int16Array cannot hold anything
 * else. A fractional authored height would shift an edge weight, so validate.js owns that check.
 * @param {{w:number,d:number,at:(x:number,z:number)=>any,tiles?:any[][]}} MAP
 * @returns {Graph}
 */
export function buildGraph(MAP) {
  const w = MAP.w | 0, d = MAP.d | 0, n = w * d;
  const h = new Int16Array(n), pass = new Uint8Array(n), oob = new Uint8Array(n);
  let clamped = 0;
  const at = typeof MAP.at === 'function' ? MAP.at : (x, z) => MAP.tiles[z][x];
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const t = at(x, z), i = z * w + x;
      if (!t) continue;                              // pass stays 0; void tiles land here too
      const r = Math.round(t.h), ok = Number.isFinite(r) && r <= H_LIMIT && r >= -H_LIMIT;
      h[i] = ok ? r : r > 0 ? H_LIMIT : r < 0 ? -H_LIMIT : 0;    // NaN and +-Infinity land here too
      if (!ok) { oob[i] = 1; clamped++; }            // counted so validate.js can name the offending map
      pass[i] = (t.walk ? 1 : 0) | (t.water ? 2 : 0);
    }
  }
  const need = new Int16Array(2 * n).fill(NO_EDGE);
  const needW = new Int16Array(2 * n).fill(NO_EDGE);
  // Weights are symmetric (|dh| and passability both are), so one slot serves both directions.
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const i = z * w + x, p = pass[i];
      if (p === 0 || oob[i]) continue;               // off-map, void, prop-closed, or out-of-band height
      if (x + 1 < w && pass[i + 1] !== 0 && !oob[i + 1]) {
        const dh = Math.abs(h[i] - h[i + 1]);
        needW[2 * i] = dh;                           // water-capable: any non-zero pass is footing
        if ((p & 1) && (pass[i + 1] & 1)) need[2 * i] = dh;   // land: both sides carry t.walk
      }
      if (z + 1 < d && pass[i + w] !== 0 && !oob[i + w]) {
        const dh = Math.abs(h[i] - h[i + w]);
        needW[2 * i + 1] = dh;
        if ((p & 1) && (pass[i + w] & 1)) need[2 * i + 1] = dh;
      }
    }
  }
  return { w, d, n, h, pass, need, needW, clamped, _cc: null, _ccW: null,
    idx: (x, z) => (x >= 0 && z >= 0 && x < w && z < d ? z * w + x : -1),
    xz: (i) => [i % w, (i / w) | 0] };
}

// ---------------------------------------------------------------------------- reachability
// FIFO BFS over a preallocated Int32Array ring. Uniform edge cost 1, so plain BFS returns exactly
// what rules.js's Dijkstra does. No Array.shift, no string keys, no per-call allocation when the
// caller hands in scratch. `dist` is any integer typed array so reachField and tierDist share it.
function bfs(g, climb, water, sources, dist, prev, q) {
  const need = water ? g.needW : g.need, w = g.w, n = g.n;
  const cap = Number.isFinite(climb) ? Math.min(climb, MAX_CLIMB) : MAX_CLIMB;
  dist.fill(-1); prev.fill(-1);
  let head = 0, tail = 0;
  for (const s of sources) if (s >= 0 && s < n && dist[s] === -1) { dist[s] = 0; q[tail++] = s; }
  while (head < tail) {
    const i = q[head++], nd = dist[i] + 1, x = i % w;
    let j;
    if (x + 1 < w && need[2 * i] <= cap && dist[j = i + 1] === -1) { dist[j] = nd; prev[j] = i; q[tail++] = j; }
    if (x > 0 && need[2 * (i - 1)] <= cap && dist[j = i - 1] === -1) { dist[j] = nd; prev[j] = i; q[tail++] = j; }
    if (i + w < n && need[2 * i + 1] <= cap && dist[j = i + w] === -1) { dist[j] = nd; prev[j] = i; q[tail++] = j; }
    if (i - w >= 0 && need[2 * (i - w) + 1] <= cap && dist[j = i - w] === -1) { dist[j] = nd; prev[j] = i; q[tail++] = j; }
  }
  return { dist, prev };
}

const asSources = (s) => (typeof s === 'number' ? [s] : s);

/**
 * Unbounded flood at one climb. dist[i] = steps from the nearest source, -1 unreachable;
 * prev[i] = the predecessor node, -1 at a source and at unreachable tiles.
 * NOTE the one deliberate divergence from rules.js: an edge needs BOTH endpoints passable, so a
 * flood seeded on an impassable tile (a unit standing under a prop, which the engine never
 * produces) stays empty where reachable() would let it step off. Sources are expected walkable.
 * @param {Graph} g
 * @param {{climb?:number, water?:boolean}} opts
 * @param {ArrayLike<number>|number} sources node ids
 * @param {{dist?:Int16Array, prev?:Int32Array, q?:Int32Array}} [out] reusable scratch
 */
export function reachField(g, opts, sources, out = {}) {
  const n = g.n;
  const dist = out.dist && out.dist.length === n ? out.dist : new Int16Array(n);
  const prev = out.prev && out.prev.length === n ? out.prev : new Int32Array(n);
  const q = out.q && out.q.length === n ? out.q : new Int32Array(n);
  return bfs(g, opts && opts.climb !== undefined ? opts.climb : Infinity, !!(opts && opts.water), asSources(sources), dist, prev, q);
}

/** The task-facing wrapper: step distances for a JUMP STAT rather than an h budget. -1 = unreachable. */
export function tierDist(g, sources, jump, opts = {}) {
  return bfs(g, jumpToClimb(jump), !!opts.water, asSources(sources), new Int32Array(g.n), new Int32Array(g.n), new Int32Array(g.n)).dist;
}

/**
 * TURNS, not steps — the number a player feels (PLAN §4.6). The -1 is because you attack from an
 * adjacent tile, so the last step of a path is never actually taken. Unreachable and MOVE 0 are
 * Infinity, never 0: a saving computed against 0 turns is a lie.
 */
export function turnsFor(dist, move) {
  if (!Number.isFinite(dist) || dist < 0 || !(move > 0)) return Infinity;
  return Math.max(0, Math.ceil((dist - 1) / move));
}

/** Reconstruct the shortest path a reachField result found, as [[x,z],...] from source to target. */
export function pathOf(g, res, target) {
  if (!res || !res.dist || target < 0 || target >= g.n || res.dist[target] < 0) return null;
  const out = [];
  for (let i = target; i >= 0; i = res.prev[i]) out.push(g.xz(i));
  return out.reverse();
}

/** The distinct finite edge weights present, ascending — a map's real, as-built tier vocabulary. */
export function tiersOfGraph(g, opts = {}) {
  const need = opts.water ? g.needW : g.need, s = new Set();
  for (let e = 0; e < need.length; e++) if (need[e] < NO_EDGE) s.add(need[e]);
  return [...s].sort((a, b) => a - b);
}

/**
 * The editor's heatmap and the pocket report, in one ascending sweep.
 * Overloaded: tierField(g, profiles, sources) per PLAN §4.3, or tierField(g, sources) which
 * derives its tiers from the graph's own edge weights and so needs no roster.
 *
 * `byTier` is keyed by profile id AND by climb, because water is a second axis and PROFILES really
 * does field two tiers at climb 6 (t6 land, t6w Earthshaper) — keying on the number alone silently
 * overwrote one with the other. The numeric key resolves to the FIRST profile at that climb, and
 * the list sorts land before water, so `byTier.get(6)` is the land flood a caller expects.
 * `minClimb[i]`: the smallest climb that reaches i. -1 = no supplied tier reaches it; NO_EDGE =
 * only the unbounded (ignore_height) tier does. `minJump` is the same in JUMP stats, `minTier` is
 * the index into the returned `tiers` list, and `minTurns` uses that profile's MOVE (-1 when the
 * caller supplied no move).
 * @param {Graph} g
 */
export function tierField(g, profiles, sources) {
  if (sources === undefined) { sources = profiles; profiles = tiersOfGraph(g).map((c) => ({ id: 't' + c, climb: c, water: false, move: 0 })); }
  const list = [...profiles].sort((a, b) => (a.climb === b.climb ? (a.water === b.water ? 0 : a.water ? 1 : -1) : a.climb < b.climb ? -1 : 1));
  const n = g.n, src = asSources(sources);
  const byTier = new Map();
  const minClimb = new Int16Array(n).fill(-1), minJump = new Int16Array(n).fill(-1);
  const minTurns = new Int16Array(n).fill(-1), minTier = new Int16Array(n).fill(-1);
  const q = new Int32Array(n), prev = new Int32Array(n);
  for (let k = 0; k < list.length; k++) {
    const p = list[k], dist = new Int16Array(n);
    bfs(g, p.climb, !!p.water, src, dist, prev, q);
    if (p.id !== undefined) byTier.set(p.id, dist);
    if (!byTier.has(p.climb)) byTier.set(p.climb, dist);
    const cs = Number.isFinite(p.climb) ? p.climb : NO_EDGE;
    const js = Number.isFinite(p.climb) ? climbToJump(p.climb) : NO_EDGE;
    for (let i = 0; i < n; i++) {
      if (dist[i] < 0 || minClimb[i] !== -1) continue;   // nesting: first tier to reach i is the min
      minClimb[i] = cs; minJump[i] = js; minTier[i] = k;
      const t = turnsFor(dist[i], p.move);
      minTurns[i] = Number.isFinite(t) ? t : -1;
    }
  }
  return { byTier, minClimb, minJump, minTurns, minTier, tiers: list };
}

// ---------------------------------------------------------------------------- required climb
/**
 * Per-threshold union-find (PLAN §4.4). The distinct values in need[] are few (6-25 on a real
 * map); sort them, union incrementally, snapshot the labels at each threshold. This deliberately
 * REPLACES Kruskal + Euler tour + sparse-table LCA: same exact minimax answer on a 400-2300 node
 * grid, a tenth of the bug surface.
 */
export function climbComponents(g, opts = {}) {
  const need = opts.water ? g.needW : g.need, w = g.w, n = g.n;
  const thresholds = tiersOfGraph(g, opts);
  const order = [];
  for (let e = 0; e < need.length; e++) if (need[e] < NO_EDGE) order.push(e);
  order.sort((a, b) => need[a] - need[b]);
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const levels = [];
  let k = 0;
  for (const t of thresholds) {
    while (k < order.length && need[order[k]] <= t) {
      const e = order[k++], a = e >> 1, b = (e & 1) ? a + w : a + 1;
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }
    const lab = new Int32Array(n);
    for (let i = 0; i < n; i++) lab[i] = find(i);
    levels.push(lab);
  }
  return { levels, thresholds };
}

function componentsOf(g, opts = {}) {
  const key = opts.water ? '_ccW' : '_cc';
  if (!g[key]) g[key] = climbComponents(g, opts);
  return g[key];
}

/**
 * Minimax edge weight along the best path a -> b: the smallest climb, in h, that connects them at
 * all. Infinity when no tier does. Accepts either a climbComponents() result or a Graph (whose
 * components are then built once and cached on it). Binary search is valid because the label
 * arrays are nested by construction.
 */
export function requiredClimb(cc, a, b, opts = {}) {
  if (a === b) return 0;
  const c = cc && cc.need ? componentsOf(cc, opts) : cc;
  const { levels, thresholds } = c;
  let lo = 0, hi = levels.length - 1, ans = Infinity;
  if (!levels.length || levels[hi][a] !== levels[hi][b]) return Infinity;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (levels[m][a] === levels[m][b]) { ans = thresholds[m]; hi = m - 1; } else lo = m + 1;
  }
  return ans;
}
/** The same answer in JUMP stats — the "who can take this route" query classify.js asks. */
export function requiredJump(cc, a, b, opts) { return climbToJump(requiredClimb(cc, a, b, opts)); }

// ---------------------------------------------------------------------------- edge surgery
/** The edge slot joining two orthogonally adjacent nodes, or -1. Wrap-safe at the row seam. */
export function edgeIndex(g, a, b) {
  const w = g.w;
  if (b === a + 1 && a % w !== w - 1) return 2 * a;
  if (a === b + 1 && b % w !== w - 1) return 2 * b;
  if (b === a + w) return 2 * a + 1;
  if (a === b + w) return 2 * b + 1;
  return -1;
}
/**
 * The counterfactual for faceSaving() and sealProof(): a shallow clone with those edges cut in
 * BOTH graphs and both directions. Cheap (two Int16Array copies) and leaves the original intact,
 * so the caller can re-flood without an undo step.
 */
export function blockEdges(g, pairs) {
  const need = Int16Array.from(g.need), needW = Int16Array.from(g.needW);
  for (const [a, b] of pairs) {
    const e = edgeIndex(g, a, b);
    if (e >= 0) { need[e] = NO_EDGE; needW[e] = NO_EDGE; }
  }
  return { ...g, need, needW, _cc: null, _ccW: null };
}
/** Same, for whole tiles: sealProof deletes a choke's tiles and re-BFSes. */
export function blockNodes(g, nodes) {
  const pass = Uint8Array.from(g.pass);
  for (const i of nodes) if (i >= 0 && i < g.n) pass[i] = 0;
  const need = Int16Array.from(g.need), needW = Int16Array.from(g.needW);
  for (const i of nodes) {
    for (const [a, b] of [[i, i + 1], [i - 1, i], [i, i + g.w], [i - g.w, i]]) {
      const e = edgeIndex(g, a, b);
      if (e >= 0 && a >= 0 && b < g.n) { need[e] = NO_EDGE; needW[e] = NO_EDGE; }
    }
  }
  return { ...g, pass, need, needW, _cc: null, _ccW: null };
}
