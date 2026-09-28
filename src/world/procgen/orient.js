// All EIGHT dihedral presentations of a verified map (PLAN §3.5, §5.3). the prototype shipped four and left
// the other four on the table with a comment saying so; taking them is free.
//
// WHY THIS IS SAFE AND WHY IT MUST RUN LAST. Transpose and the two mirrors are isometries of the
// 4-neighbour grid metric and they preserve height exactly, so every quantity the acceptance loop
// measured — each BFS distance, each face's |dh|, each choke seal, each promise in turns, the whole
// ladder — holds identically after the transform. Verify once, ship eight. Applying an orientation
// BEFORE verification would merely verify eight times as slowly for the same answer.
//
// Props go through mapformat/propspec.js transformProp(), which is the single transcription of the
// three coordinate conventions plus the rot/dir/chimney/wall-side bookkeeping, and whose own
// selfTest() proves rot90^4 === identity on one prop of every convention. Nothing here re-derives
// any of that. Zero three.js.
import { transformProp } from '../mapformat/propspec.js';

/** The eight elements of D4, each as a word in the primitive ops propspec.js implements. Order is
 *  the API: `gen.orient` records the index, so a map is reproducible from its seed and this table. */
export const ORIENTS = Object.freeze([
  Object.freeze({ id: 0, name: 'as generated', ops: Object.freeze([]) }),
  Object.freeze({ id: 1, name: 'quarter turn', ops: Object.freeze(['rot90']) }),
  Object.freeze({ id: 2, name: 'half turn', ops: Object.freeze(['rot90', 'rot90']) }),
  Object.freeze({ id: 3, name: 'three-quarter turn', ops: Object.freeze(['rot90', 'rot90', 'rot90']) }),
  Object.freeze({ id: 4, name: 'mirrored east-west', ops: Object.freeze(['mirrorX']) }),
  Object.freeze({ id: 5, name: 'mirrored north-south', ops: Object.freeze(['mirrorZ']) }),
  Object.freeze({ id: 6, name: 'transposed', ops: Object.freeze(['transpose']) }),
  Object.freeze({ id: 7, name: 'anti-transposed', ops: Object.freeze(['transpose', 'rot90', 'rot90']) }),
]);

/** Tile map for one primitive op on a W x D board. Identical to propspec.js's tBox on a 1x1 box —
 *  it has to be, or a prop and the ground under it would part company. */
function tileMap(op, W, D) {
  if (op === 'rot90') return (x, z) => [D - 1 - z, x];
  if (op === 'mirrorX') return (x, z) => [W - 1 - x, z];
  if (op === 'mirrorZ') return (x, z) => [x, D - 1 - z];
  if (op === 'transpose') return (x, z) => [z, x];
  throw new Error(`orient: unknown op '${op}'`);
}
const swaps = (op) => op === 'rot90' || op === 'transpose';
const pair = (mp) => (p) => (Array.isArray(p) && p.length >= 2 ? mp(p[0], p[1]) : p);
const pairs = (list, f) => (Array.isArray(list) ? list.map(f) : list);

/**
 * Apply one primitive op to a whole document. Pure — the input is never mutated.
 * @param {import('../mapformat/schema.js').MapDef} def
 * @param {'rot90'|'mirrorX'|'mirrorZ'|'transpose'} op
 */
function applyOp(def, op) {
  const W = def.size.w, D = def.size.d, mp = tileMap(op, W, D);
  const nw = swaps(op) ? D : W, nd = swaps(op) ? W : D;
  const H = Array.from({ length: nd }, () => new Array(nw).fill(0));
  const T = Array.from({ length: nd }, () => new Array(nw).fill('g'));
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const [a, b] = mp(x, z); H[b][a] = def.grid.H[z][x]; T[b][a] = def.grid.T[z][x];
  }
  const P = pair(mp), d0 = def.design || {};
  // A rect is two opposite corners, and a reflection swaps which is which — so re-derive min/max
  // rather than mapping [x0,z0,x1,z1] elementwise, which silently produces inverted rectangles.
  const rect = (r) => { if (!Array.isArray(r) || r.length < 4) return r;
    const [a, b] = mp(r[0], r[1]), [c, e] = mp(r[2], r[3]);
    return [Math.min(a, c), Math.min(b, e), Math.max(a, c), Math.max(b, e)]; };
  return { ...def, size: { w: nw, d: nd },
    grid: { H, T: T.map((row) => row.join('')) },
    props: (def.props || []).map((p) => transformProp(p, op, W, D)),
    spawns: { A: pairs(def.spawns && def.spawns.A, P), B: pairs(def.spawns && def.spawns.B, P) },
    decks: { ...(def.decks || { mode: 'auto' }), tiles: pairs((def.decks && def.decks.tiles) || [], P) },
    design: { ...d0,
      faces: pairs(d0.faces, (f) => ({ ...f, from: P(f.from), to: P(f.to) })),
      chokes: pairs(d0.chokes, (k) => ({ ...k, tiles: pairs(k.tiles, P) })),
      routes: pairs(d0.routes, (r) => ({ ...r, via: pairs(r.via, P) })),
      regions: pairs(d0.regions, (r) => ({ ...r, rect: rect(r.rect) })),
      assists: pairs(d0.assists, (a) => ({ ...a, tiles: pairs(a.tiles, P), dir: turnDir(a.dir, op) })),
      waive: pairs(d0.waive, (v) => ({ ...v, at: P(v.at) })) },
    analysis: null };                                  // a cache measured in the old frame is a lie
}
// n = -z, s = +z, e = +x, w = -x — the same table propspec.js uses for the stairs prop, repeated
// here for the ASSIST's own `dir`, which is design data rather than a prop field.
const DIRS = { rot90: { n: 'e', e: 's', s: 'w', w: 'n' }, mirrorX: { n: 'n', s: 's', e: 'w', w: 'e' },
  mirrorZ: { n: 's', s: 'n', e: 'e', w: 'w' }, transpose: { n: 'w', s: 'e', e: 's', w: 'n' } };
const turnDir = (dir, op) => (DIRS[op] && DIRS[op][dir]) || dir;

/**
 * Present a verified map in one of the eight dihedral frames.
 * @param {import('../mapformat/schema.js').MapDef} def
 * @param {number} t index into ORIENTS; anything else is taken mod 8, so `seed % 8` is a legal call
 * @returns {import('../mapformat/schema.js').MapDef} a new document; `def` is untouched
 */
export function orient(def, t) {
  const o = ORIENTS[((t | 0) % ORIENTS.length + ORIENTS.length) % ORIENTS.length];
  let out = def;
  for (const op of o.ops) out = applyOp(out, op);
  if (out === def) out = { ...def, analysis: null };    // identity still owes the caller a copy
  out.gen = out.gen ? { ...out.gen, orient: o.id, orientName: o.name } : null;
  return out;
}

/** The eight frames are DISTINCT and each is an involution-closed presentation of the same board.
 *  Proved on the document itself rather than asserted: an orientation table that quietly contains a
 *  duplicate ships four presentations while claiming eight. @returns {string[]} failures */
export function selfTest(def) {
  const bad = [], seen = new Map();
  for (const o of ORIENTS) {
    const q = orient(def, o.id);
    const key = q.size.w + 'x' + q.size.d + '|' + q.grid.T.join('/') + '|' + q.grid.H.map((r) => r.join(',')).join('/');
    if (seen.has(key)) bad.push(`orient ${o.id} (${o.name}) is identical to ${seen.get(key)}`); else seen.set(key, o.name);
    if (q.grid.H.length !== q.size.d || q.grid.H[0].length !== q.size.w) bad.push(`orient ${o.id}: grid is ${q.grid.H[0].length}x${q.grid.H.length}, size says ${q.size.w}x${q.size.d}`);
    for (const team of ['A', 'B']) for (const [x, z] of q.spawns[team] || [])
      if (x < 0 || z < 0 || x >= q.size.w || z >= q.size.d) bad.push(`orient ${o.id}: spawn ${team} ${x},${z} left the board`);
    for (const f of (q.design.faces || [])) if (Math.abs(f.from[0] - f.to[0]) + Math.abs(f.from[1] - f.to[1]) !== 1)
      bad.push(`orient ${o.id}: face ${f.fid} is no longer an adjacent pair`);
  }
  return bad;
}
