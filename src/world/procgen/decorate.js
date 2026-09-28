// Deterministic decoration (PLAN §3.5, §5.1 stage 10) — and the one pass that finishes invariant 1.
//
// Two jobs, in this order. First CLOSE THE SCENERY: every tile skeleton.js marked `block` is land
// with a real surface and a real height, and it is only unwalkable once a blocking prop stands on
// it. Leaving one tile open there is not a cosmetic slip, it is a hole in the tier proof — so the
// coverage sweep is asserted, not assumed. Second DRESS: walk-through billboards, shelf clutter and
// parapets, none of which can move a graph edge.
//
// WHAT closes each tile is compose.js's problem, not this file's: an independent draw per tile was
// correct and read as confetti. This module owns the machinery that makes any such choice SAFE —
// `owner`, so a tile is closed exactly once; safeFree, so no multi-tile run can be deleted into a
// shortcut; and the coverage assertion — and hands compose.js those three as a toolkit.
//
// Everything here is seeded and order-stable: no Set/Map iteration decides a placement, no Date, no
// Math.random. Zero three.js.
import { PROP_SPEC } from '../mapformat/propspec.js';
import { ri, rf, chance, weighted, pick } from './rng.js';
import { idx, isWalk, BASE_TIER, SkeletonError } from './skeleton.js';
import { lattice, compounds, closeByPatch } from './compose.js';

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const CENTRE = (v) => Math.floor(v) + 0.5;
const isLand = (c, i) => c.T[i] !== 'w' && c.T[i] !== 'v';

/**
 * @param {object} c canvas from buildSkeleton
 * @param {() => number} rng
 * @param {import('./vocab.js').Archetype} V
 * @returns {object} the same canvas, with c.props populated
 * @throws {SkeletonError} `gen.uncovered` when a scenery tile could not be closed
 */
export function decorate(c, rng, V) {
  const owner = new Int32Array(c.n).fill(-1);
  for (let n = 0; n < c.props.length; n++) for (const i of tilesOf(c, c.props[n])) if (i >= 0) owner[i] = n;
  // The toolkit compose.js works through. Passing it rather than importing these back the other way
  // keeps `owner` — the tile -> prop index map that makes free() O(1) — private to this module and
  // the two files free of a cycle.
  const tk = { free: (i) => free(c, owner, i), place: (p) => place(c, owner, p), safeFree: (t) => safeFree(c, t),
    span: (x, z, len, dir) => spanOf(c, x, z, len, dir) };
  const L = lattice(c, rng, V);
  landmarks(c, rng, V, owner);
  compounds(c, rng, V, tk, L);
  closeByPatch(c, rng, V, tk, L);
  assertClosed(c, owner);
  shelfClutter(c, rng, V);
  dressing(c, rng, V);
  parapets(c, rng, V);
  return c;
}

/** The tiles a prop CLOSES, in canvas index form. Mirrors mapformat/propspec.js footprint() exactly
 *  — including its NaN loop for a house with no w/d — because compile.js will read it that way. */
function tilesOf(c, p) {
  const s = PROP_SPEC[p.type];
  if (!s || !s.blocking) return [];
  const out = [];
  if (p.type === 'house' || p.type === 'tower') { for (let z = p.z; z < p.z + p.d; z++) for (let x = p.x; x < p.x + p.w; x++) out.push(idx(c, x, z)); return out; }
  if (p.type === 'fence' || p.type === 'ruin') { for (let i = 0; i < p.len; i++) out.push(p.dir === 'x' ? idx(c, p.x + i, p.z) : idx(c, p.x, p.z + i)); return out; }
  return [idx(c, Math.floor(p.x), Math.floor(p.z))];
}

/**
 * Would freeing `tiles` join two DIFFERENT benches at the base tier? validate.js deletes one prop at
 * a time (prop.blocks-only-route) and re-measures the road, so a run whose removal opens a rung is
 * an ERROR on an otherwise perfect map. skeleton.js's bridgeSeal already guarantees this for a
 * SINGLE tile; a multi-tile run can still chain two safe tiles into a bridge, which is exactly what
 * this union-find over the run and its walkable fringe rules out.
 */
function safeFree(c, tiles) {
  const id = new Map(); const h = [], reg = [], up = [];
  const node = (i, r) => { let n = id.get(i); if (n === undefined) { n = h.length; id.set(i, n); h.push(c.H[i]); reg.push(r); up.push(n); } return n; };
  const find = (n) => { while (up[n] !== n) { up[n] = up[up[n]]; n = up[n]; } return n; };
  for (const i of tiles) node(i, -1);
  for (const i of tiles) { const x = i % c.w, z = (i / c.w) | 0;
    for (const [dx, dz] of N4) { const j = idx(c, x + dx, z + dz); if (j < 0 || id.has(j)) continue; if (isWalk(c, j)) node(j, c.region[j]); } }
  const keys = [...id.keys()];
  for (const i of keys) { const x = i % c.w, z = (i / c.w) | 0;
    for (const [dx, dz] of N4) { const j = idx(c, x + dx, z + dz);
      if (j < 0 || !id.has(j) || Math.abs(c.H[i] - c.H[j]) > BASE_TIER) continue;
      const a = find(id.get(i)), b = find(id.get(j)); if (a !== b) up[a] = b; } }
  const seen = new Map();
  for (const i of keys) { const n = id.get(i); if (reg[n] < 0) continue; const r = find(n);
    if (!seen.has(r)) seen.set(r, reg[n]); else if (seen.get(r) !== reg[n]) return false; }
  return true;
}

const free = (c, owner, i) => i >= 0 && c.block[i] && isLand(c, i) && owner[i] < 0;
const place = (c, owner, p) => { const n = c.props.length; c.props.push(p); for (const i of tilesOf(c, p)) if (i >= 0) owner[i] = n; return n; };

/** Houses, barns and towers on flat scenery: the silhouettes that make a generated hillside read as
 *  somewhere people live. Rectangles only, all one height (prop.footprint-step), never over a run
 *  that would bridge two benches. */
function landmarks(c, rng, V, owner) {
  // Loose buildings OUTSIDE the yards compounds() walls in. Two per board was a hamlet you had to
  // look for; the apron scenery.js opens up has room for a real skyline.
  const want = Math.max(2, Math.round((c.w * c.d) / 130));
  for (let tries = 0, made = 0; tries < want * 40 && made < want; tries++) {
    const type = weighted(rng, { house: 5, tower: 2 });
    const bw = type === 'tower' ? 2 : ri(rng, 2, 3), bd = type === 'tower' ? 2 : ri(rng, 2, 2);
    const x0 = ri(rng, 1, c.w - bw - 1), z0 = ri(rng, 1, c.d - bd - 1);
    const tiles = []; let h0 = null, ok = true;
    for (let z = z0; z < z0 + bd && ok; z++) for (let x = x0; x < x0 + bw && ok; x++) {
      const i = idx(c, x, z); if (!free(c, owner, i)) { ok = false; break; }
      if (h0 === null) h0 = c.H[i]; else if (c.H[i] !== h0) ok = false; tiles.push(i); }
    if (!ok || !safeFree(c, tiles)) continue;
    place(c, owner, type === 'tower' ? { type: 'tower', x: x0, z: z0, w: bw, d: bd, th: Math.round(rf(rng, 2.6, 4.2) * 10) / 10 }
      : { type: 'house', x: x0, z: z0, w: bw, d: bd, rot: ri(rng, 0, 3), storeys: chance(rng, 0.3) ? 2 : 1,
        style: pick(rng, ['timber', 'stone']), roof: pick(rng, ['tile', 'slate', 'brown', 'thatch']),
        chimney: pick(rng, [null, 'left', 'right']), barn: chance(rng, 0.25) });
    made++;
  }
}

/**
 * Invariant 1, asserted rather than assumed. compose.js chooses WHICH prop closes each scenery tile;
 * this is the check that it left none of them open, because a scenery tile with no blocker on it is
 * a walkable tile the tier proof never accounted for — a hole in the ladder, not a cosmetic slip.
 */
function assertClosed(c, owner) {
  for (let i = 0; i < c.n; i++) if (c.block[i] && isLand(c, i) && owner[i] < 0)
    throw new SkeletonError('gen.uncovered', `scenery tile ${i % c.w},${(i / c.w) | 0} left walkable`);
}
/** The tiles a `len`-long run along `dir` would claim, for safeFree. */
const spanOf = (c, x, z, len, dir) => { const out = []; for (let k = 0; k < len; k++) out.push(dir === 'z' ? idx(c, x, z + k) : idx(c, x + k, z)); return out; };

/**
 * The camp on the staging shelf. A blocking prop here is the one place decoration can genuinely
 * break the map, so each candidate is accepted only if the shelf STILL floods whole afterwards —
 * a 100-tile flood, cheap, and exact where a "keep two tiles clear" heuristic is merely hopeful.
 */
function shelfClutter(c, rng, V) {
  const { stageW, zOf, m } = c.meta, blocked = new Uint8Array(c.n);
  const spawn = new Set(c.spawns.A.map((s) => idx(c, s[0], s[1])));
  const cells = [];
  for (let z = 1; z < c.d - 1; z++) for (let x = 0; x < stageW; x++) { const i = idx(c, x, z); if (isWalk(c, i) && !c.keep[i] && !spawn.has(i)) cells.push(i); }
  const want = Math.round(cells.length * 0.16 * V.props.density);
  for (let n = 0, tries = 0; n < want && tries < cells.length * 3; tries++) {
    const i = cells[ri(rng, 0, cells.length - 1)];
    if (blocked[i]) continue;
    blocked[i] = 1;
    if (!shelfWhole(c, blocked, idx(c, c.spawns.A[0][0], c.spawns.A[0][1]))) { blocked[i] = 0; continue; }
    const t = weighted(rng, V.props.stage) || 'barrel';
    const jx = PROP_SPEC[t].coord === 'nwInt' ? Math.floor(i % c.w) : Math.floor(i % c.w) + 0.5;
    const jz = PROP_SPEC[t].coord === 'nwInt' ? Math.floor(i / c.w) : Math.floor(i / c.w) + 0.5;
    c.props.push({ type: t, x: jx, z: jz, ...(t === 'stall' || t === 'cart' ? { rot: ri(rng, 0, 3) } : {}), ...(t === 'pillar' ? { h: Math.round(rf(rng, 0.8, 1.8) * 10) / 10 } : {}) });
    n++;
  }
  void zOf; void m;
}
/** Does every walkable shelf tile still reach the first A spawn with `blocked` closed? */
function shelfWhole(c, blocked, seed) {
  const { stageW } = c.meta, seen = new Uint8Array(c.n), st = [seed]; seen[seed] = 1; let n = 1, want = 0;
  for (let z = 0; z < c.d; z++) for (let x = 0; x <= stageW; x++) { const i = idx(c, x, z); if (isWalk(c, i) && !blocked[i]) want++; }
  while (st.length) { const i = st.pop(), x = i % c.w, z = (i / c.w) | 0;
    for (const [dx, dz] of N4) { const j = idx(c, x + dx, z + dz);
      if (j < 0 || seen[j] || blocked[j] || !isWalk(c, j) || (j % c.w) > stageW || Math.abs(c.H[i] - c.H[j]) > BASE_TIER) continue;
      seen[j] = 1; n++; st.push(j); } }
  return n >= want;
}

/** Walk-through billboards. `tree`, `bush` and `flowers` are the three types mapdata.js's BLOCKING
 *  set does NOT contain, so they can be scattered anywhere on land without touching a single graph
 *  edge — which is why the density can be generous. */
function dressing(c, rng, V) {
  const dressed = new Uint8Array(c.n);
  const budget = Math.round(c.w * c.d * 0.10 * V.props.density);
  for (let n = 0, tries = 0; n < budget && tries < budget * 8; tries++) {
    const i = ri(rng, 0, c.n - 1);
    if (dressed[i] || !isLand(c, i) || c.keep[i]) continue;
    dressed[i] = 1;
    const t = weighted(rng, V.props.scatter) || 'bush';
    c.props.push({ type: t, x: CENTRE(i % c.w) + rf(rng, -0.22, 0.22), z: CENTRE((i / c.w) | 0) + rf(rng, -0.22, 0.22) });
    n++;
  }
}

/** Parapets and rails: edgeFree props with no footprint at all, so they are free of every rule in
 *  validate.js except their own units. They cap the terrace lip along a chasm or a channel, which
 *  is the read that tells a player at a glance which edge is a fall and which is a step. */
function parapets(c, rng, V) {
  const { m, zOf, XA, bx, doorX, laneH, bands } = c.meta;
  for (let j = 0; j + 1 < m; j++) {
    const b = bands[j]; if (!b || (b.kind !== 'void' && b.kind !== 'water')) continue;
    if (!chance(rng, V.props.edge)) continue;
    const [da, db] = doorX(j), z = zOf(j) + 2;
    for (const [x0, x1] of [[XA, da - 1], [db + 1, bx[j]]]) {
      const len = x1 - x0 + 1; if (len < 2) continue;
      c.props.push({ type: 'wall', x: x0, z, len, dir: 'x', h: laneH[j], in: 1 });
    }
    if (b.deck) c.props.push({ type: 'rail', x: da, z: b.z0, len: 2, dir: 'x', h: Math.min(laneH[j], laneH[j + 1]) });
  }
  // The one user of the shipped-but-unused `arch` type: a gateway over a door, where the terrace
  // above it is tall enough for the springing line to read.
  for (let j = 0; j + 1 < m; j++) if (chance(rng, V.props.edge * 0.4)) {
    const [da] = doorX(j);
    c.props.push({ type: 'arch', x: da, z: zOf(j) + 2 + 0.5, h: Math.max(laneH[j], laneH[j + 1]), r: Math.round(rf(rng, 0.5, 0.9) * 10) / 10, dir: 'x', flip: false });
  }
}
