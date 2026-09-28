// Stamps: cut / copy / paste with PROP_SPEC-aware transforms (PLAN §6.7). A stamp carries every
// channel a region owns — heights, surfaces, the deck grant, props, spawn pins and the design
// declarations that live inside it — because a clipboard that drops half of them silently destroys
// authored work, which is exactly how the prototype's importer destroyed twinspan.json.
//
// The transforms are the sharp part. A prop's coordinate convention decides how it moves: an
// `nwInt` rectangle's corner must be recomputed from its far edge, a `tileCentre` sprite must KEEP
// its .5, a `floorCentre` prop is re-floored, an `edgeFree` wall is a raw world coordinate that must
// not be snapped at all, and rot/dir fields advance or swap. None of that is reimplemented here:
// propspec.transformProp() is the single source, and this file only maps the grid and routes the
// design records through the same planar transform so a rotated stamp's face still points at the
// tiles it names. selfTest() proves rot90^4 = identity on a stamp holding one prop of EVERY
// convention — the property that makes rotate and mirror trustworthy instead of merely plausible.
//
// Zero three.js and zero DOM: tools/checks runs the transforms under bare `node`.
import { transformProp, PROP_SPEC, propTiles } from '../world/mapformat/propspec.js';
import { deckTiles } from '../world/mapformat/compile.js';

export const OPS = Object.freeze(['rot90', 'mirrorX', 'mirrorZ', 'transpose']);
// design kind -> the tile-bearing fields to transform. `regions` carries a rect, everything else a
// point or a list of points; the assist's `dir` rides a fake stairs prop through transformProp so
// the n/s/e/w rotation table stays in exactly one file.
const DESIGN_PTS = Object.freeze({ face: ['from', 'to'], choke: ['tiles'], route: ['via'],
  assist: ['tiles'], waive: ['at'], region: ['rect'], promise: [] });
const LIST_OF = Object.freeze({ face: 'faces', choke: 'chokes', route: 'routes', region: 'regions',
  assist: 'assists', promise: 'promises', waive: 'waive' });
const cp = (v) => (v === null || typeof v !== 'object' ? v : typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/** The planar tile map, identical to propspec's tBox on a 1x1 box — the two MUST agree or a rotated
 *  house lands one tile off its own terrace. `W`/`D` are the dims BEFORE the transform. */
export function mapPoint(op, x, z, W, D) {
  if (op === 'rot90') return [D - 1 - z, x];
  if (op === 'mirrorX') return [W - 1 - x, z];
  if (op === 'mirrorZ') return [x, D - 1 - z];
  return [z, x];                                   // transpose
}
const swapsDims = (op) => op === 'rot90' || op === 'transpose';

/**
 * @typedef {Object} Stamp
 * @property {number} w @property {number} d
 * @property {number[][]} H     h steps, [z][x]
 * @property {string[]} T       one letter per tile, [z]
 * @property {number[][]} deck  1 where the source tile carried a deck grant
 * @property {number[][]} mask  1 where the stamp actually covers a tile (a lasso copy is ragged)
 * @property {Array<object>} props   local coordinates, pid stripped
 * @property {Array<{team:string, slot:number, x:number, z:number}>} spawns
 * @property {Array<{kind:string, rec:object}>} design
 * @property {{x:number, z:number}} origin  where it was copied from, for paste-in-place
 */

/**
 * Copy a rectangle (or a ragged selection) out of a document.
 * @param {import('../world/mapformat/schema.js').MapDef} def
 * @param {{rect?:number[], mask?:Uint8Array, props?:boolean, spawns?:boolean, design?:boolean}} area
 */
export function copyStamp(def, area = {}) {
  const W = def.size.w, D = def.size.d;
  const r = area.rect || boundsOfMask(area.mask, W, D) || [0, 0, W - 1, D - 1];
  const x0 = Math.max(0, Math.min(r[0], r[2])), z0 = Math.max(0, Math.min(r[1], r[3]));
  const x1 = Math.min(W - 1, Math.max(r[0], r[2])), z1 = Math.min(D - 1, Math.max(r[1], r[3]));
  const w = x1 - x0 + 1, d = z1 - z0 + 1;
  const st = { w, d, H: [], T: [], deck: [], mask: [], props: [], spawns: [], design: [], origin: { x: x0, z: z0 } };
  const grant = new Set(deckTiles(def).map(([x, z]) => z * W + x));
  for (let z = 0; z < d; z++) {
    const hr = [], dr = [], mr = [];
    let tr = '';
    for (let x = 0; x < w; x++) {
      const sx = x0 + x, sz = z0 + z, i = sz * W + sx;
      hr.push(def.grid.H[sz][sx]); tr += def.grid.T[sz][sx];
      dr.push(grant.has(i) ? 1 : 0); mr.push(area.mask ? (area.mask[i] ? 1 : 0) : 1);
    }
    st.H.push(hr); st.T.push(tr); st.deck.push(dr); st.mask.push(mr);
  }
  const inside = (x, z) => x >= 0 && z >= 0 && x < w && z < d && st.mask[z][x] === 1;
  if (area.props !== false) for (const p of def.props || []) {
    if (!inside(Math.floor(p.x) - x0, Math.floor(p.z) - z0)) continue;
    const q = cp(p); delete q.pid; q.x = p.x - x0; q.z = p.z - z0;
    st.props.push(q);
  }
  if (area.spawns) for (const team of Object.keys(def.spawns || {}))
    (def.spawns[team] || []).forEach((s, slot) => { if (inside(s[0] - x0, s[1] - z0)) st.spawns.push({ team, slot, x: s[0] - x0, z: s[1] - z0 }); });
  if (area.design !== false) for (const [kind, list] of Object.entries(LIST_OF))
    for (const rec of (def.design?.[list] || [])) { const loc = localiseRec(kind, rec, x0, z0, inside); if (loc) st.design.push({ kind, rec: loc }); }
  return st;
}
function boundsOfMask(mask, W, D) {
  if (!mask) return null;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (mask[z * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return x1 < x0 ? null : [x0, z0, x1, z1];
}
// A declaration is captured only when EVERY tile it names is inside the stamp. A half-copied choke
// would paste as a claim about tiles the author never selected, and the validator would then prove
// it false — a confusing failure with no visible cause.
function localiseRec(kind, rec, x0, z0, inside) {
  const out = cp(rec), fields = DESIGN_PTS[kind] || [];
  for (const f of fields) {
    const v = rec[f];
    if (!v) return null;
    if (f === 'rect') { const a = [v[0] - x0, v[1] - z0], b = [v[2] - x0, v[3] - z0]; if (!inside(...a) || !inside(...b)) return null; out.rect = [a[0], a[1], b[0], b[1]]; continue; }
    const pts = typeof v[0] === 'number' ? [v] : v;
    const moved = pts.map(([x, z]) => [x - x0, z - z0]);
    if (moved.some(([x, z]) => !inside(x, z))) return null;
    out[f] = typeof v[0] === 'number' ? moved[0] : moved;
  }
  return out;
}

/** One quarter turn / reflection of a whole stamp. Pure: the input is never mutated. */
export function transformStamp(st, op) {
  if (!OPS.includes(op)) throw new RangeError(`transformStamp: unknown op '${op}'`);
  const W = st.w, D = st.d, w = swapsDims(op) ? D : W, d = swapsDims(op) ? W : D;
  const H = Array.from({ length: d }, () => new Array(w).fill(0));
  const T = Array.from({ length: d }, () => new Array(w).fill('g'));
  const deck = Array.from({ length: d }, () => new Array(w).fill(0));
  const mask = Array.from({ length: d }, () => new Array(w).fill(0));
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const [nx, nz] = mapPoint(op, x, z, W, D);
    H[nz][nx] = st.H[z][x]; T[nz][nx] = st.T[z][x]; deck[nz][nx] = st.deck[z][x]; mask[nz][nx] = st.mask[z][x];
  }
  return { ...st, w, d, H, T: T.map((r) => r.join('')), deck, mask,
    props: st.props.map((p) => transformProp(p, op, W, D)),
    spawns: st.spawns.map((s) => { const [x, z] = mapPoint(op, s.x, s.z, W, D); return { ...s, x, z }; }),
    design: st.design.map((e) => ({ kind: e.kind, rec: transformRec(e.kind, e.rec, op, W, D) })) };
}
function transformRec(kind, rec, op, W, D) {
  const out = cp(rec);
  for (const f of DESIGN_PTS[kind] || []) {
    const v = rec[f];
    if (!v) continue;
    if (f === 'rect') {
      const a = mapPoint(op, v[0], v[1], W, D), b = mapPoint(op, v[2], v[3], W, D);
      out.rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      continue;
    }
    out[f] = typeof v[0] === 'number' ? mapPoint(op, v[0], v[1], W, D) : v.map(([x, z]) => mapPoint(op, x, z, W, D));
  }
  // The assist's ascent direction rides a throwaway `stairs` prop so the n/s/e/w rotation table
  // stays in propspec and cannot drift from the one the real stairs prop uses.
  if (rec.dir && 'nsew'.includes(rec.dir)) out.dir = transformProp({ type: 'stairs', x: 0, z: 0, dir: rec.dir }, op, W, D).dir;
  return out;
}
export const rot90 = (st) => transformStamp(st, 'rot90');
export const mirrorX = (st) => transformStamp(st, 'mirrorX');
export const mirrorZ = (st) => transformStamp(st, 'mirrorZ');
export const transpose = (st) => transformStamp(st, 'transpose');
/** Raise or lower the whole stamp. Prop heights in H STEPS move with it; world-unit heights (a
 *  tower's `th`, a pillar's shaft) are lengths, not elevations, and must not. */
export function offsetH(st, n) {
  return { ...st, H: st.H.map((r) => r.map((h) => h + n)),
    props: st.props.map((p) => (PROP_SPEC[p.type]?.heightUnits === 'h' && typeof p.h === 'number' ? { ...p, h: p.h + n } : { ...p })) };
}

/**
 * Write a stamp into the document at (x,z). Everything goes through the Tx, so a paste is one undo
 * entry and is clipped by any active selection exactly like a brush stroke.
 * @param {object} tx an open session Tx
 * @param {Stamp} st
 * @param {{heights?:boolean, surfaces?:boolean, decks?:boolean, props?:boolean, spawns?:boolean, design?:boolean}} [opts]
 */
export function pasteStamp(tx, st, x, z, opts = {}) {
  const o = { heights: true, surfaces: true, decks: true, props: true, spawns: false, design: true, ...opts };
  for (let sz = 0; sz < st.d; sz++) for (let sx = 0; sx < st.w; sx++) {
    if (!st.mask[sz][sx]) continue;
    const tx0 = x + sx, tz0 = z + sz;
    if (o.heights) tx.setH(tx0, tz0, st.H[sz][sx]);
    if (o.surfaces) tx.setT(tx0, tz0, st.T[sz][sx]);
    if (o.decks && st.deck[sz][sx]) tx.setDeckTile(tx0, tz0, true);
  }
  if (o.props) for (const p of st.props) tx.addProp({ ...p, x: p.x + x, z: p.z + z });
  if (o.spawns) for (const s of st.spawns) tx.setSpawn(s.team, s.slot, s.x + x, s.z + z);
  if (o.design) for (const e of st.design) tx.declare(e.kind, offsetRec(e.kind, e.rec, x, z));
  return st;
}
function offsetRec(kind, rec, x, z) {
  const out = cp(rec);
  for (const f of DESIGN_PTS[kind] || []) {
    const v = rec[f];
    if (!v) continue;
    if (f === 'rect') { out.rect = [v[0] + x, v[1] + z, v[2] + x, v[3] + z]; continue; }
    out[f] = typeof v[0] === 'number' ? [v[0] + x, v[1] + z] : v.map(([px, pz]) => [px + x, pz + z]);
  }
  return out;
}

/** Cut = copy, then erase. Heights and letters go to a stated floor rather than to nothing (there is
 *  no such thing as an absent tile), and props whose ANCHOR was captured are removed; spawns never
 *  are, because a team is required to have exactly five and a cut cannot leave four. */
export function cutStamp(tx, def, area, fill = {}) {
  const st = copyStamp(def, area);
  const h = fill.h ?? 0, t = fill.t || 'g', ox = st.origin.x, oz = st.origin.z;
  const anchors = new Set();
  for (let z = 0; z < st.d; z++) for (let x = 0; x < st.w; x++) {
    if (!st.mask[z][x]) continue;
    anchors.add((oz + z) * def.size.w + (ox + x));
    tx.setH(ox + x, oz + z, h); tx.setT(ox + x, oz + z, t);
    if (st.deck[z][x]) tx.setDeckTile(ox + x, oz + z, false);
  }
  for (const p of [...(def.props || [])]) if (anchors.has(Math.floor(p.z) * def.size.w + Math.floor(p.x))) tx.removeProp(p.pid);
  return st;
}

/** Tiles a pasted stamp would touch, for the ghost preview and for the "does this fit" check. */
export function stampTiles(st, x, z) {
  const out = [];
  for (let sz = 0; sz < st.d; sz++) for (let sx = 0; sx < st.w; sx++) if (st.mask[sz][sx]) out.push([x + sx, z + sz]);
  for (const p of st.props) for (const [px, pz] of propTiles({ ...p, x: p.x + x, z: p.z + z })) out.push([px, pz]);
  return out;
}

/** @returns {string[]} failures; empty means rotate and mirror are exact. */
export function selfTest() {
  const bad = [], eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const st = sampleStamp();
  let q = st;
  for (let i = 0; i < 4; i++) q = rot90(q);
  if (!eq(q, st)) bad.push(`rot90^4 != identity: ${firstDiff(q, st)}`);
  for (const op of ['mirrorX', 'mirrorZ', 'transpose']) {
    const r = transformStamp(transformStamp(st, op), op);
    if (!eq(r, st)) bad.push(`${op}^2 != identity: ${firstDiff(r, st)}`);
  }
  if (!eq(offsetH(offsetH(st, 4), -4), st)) bad.push('offsetH(+4) then offsetH(-4) != identity');
  const t2 = rot90(rot90(st)), mm = mirrorZ(mirrorX(st));
  if (!eq(t2.H, mm.H)) bad.push('rot90^2 != mirrorX+mirrorZ on the height grid');
  return bad;
}
/** One prop of EVERY coordinate convention, on a non-square stamp, plus a design record of every
 *  tile-bearing shape — the only sample that can actually catch a convention bug. */
function sampleStamp() {
  const w = 6, d = 4;
  const st = { w, d, H: [], T: [], deck: [], mask: [], origin: { x: 0, z: 0 },
    props: [
      { type: 'house', x: 1, z: 1, w: 2, d: 1, rot: 2, chimney: 'right' },   // nwInt rectangle
      { type: 'stairs', x: 4, z: 0, dir: 'n' },                              // nwInt + n/s/e/w
      { type: 'oak', x: 0.5, z: 2.5 },                                       // tileCentre, .5 preserved
      { type: 'stall', x: 3.5, z: 3.5, rot: 1 },                             // tileCentre + rot
      { type: 'pillar', x: 5.5, z: 1.5, h: 1.2 },                            // floorCentre
      { type: 'cart', x: 2.5, z: 3.5, rot: 3 },                              // floorCentre + rot
      { type: 'wall', x: 1, z: 3, len: 3, dir: 'x', h: 6, in: 1 },           // edgeFree + in
      { type: 'arch', x: 5, z: 2.5, h: 4, r: 0.7, dir: 'z', flip: false },   // edgeFree + dir/flip
      { type: 'rail', x: 0, z: 1, len: 2, dir: 'z', h: 0 },
      { type: 'deck', x: 2, z: 2, len: 2, w: 1, dir: 'z', h: 0, style: 'stone' }],
    spawns: [{ team: 'A', slot: 0, x: 1, z: 0 }],
    design: [
      { kind: 'face', rec: { fid: 'f1', from: [2, 1], to: [2, 2], drop: 6, tier: 6, kind: 'express' } },
      { kind: 'choke', rec: { cid: 'c1', tiles: [[3, 1], [3, 2]], tier: 4 } },
      { kind: 'route', rec: { rid: 'r1', tier: 4, from: 'A', to: 'B', via: [[0, 0], [5, 3]] } },
      { kind: 'region', rec: { rgid: 'g1', kind: 'scenery', rect: [0, 0, 2, 1] } },
      { kind: 'assist', rec: { aid: 'a1', kind: 'stairs', tiles: [[4, 0]], dir: 'n', bridges: { lowH: 6, highH: 8 } } },
      { kind: 'waive', rec: { at: [5, 0], code: 'contract.gentleness', why: 'crag' } }] };
  for (let z = 0; z < d; z++) {
    st.H.push(Array.from({ length: w }, (_, x) => 2 * ((x * 3 + z * 7) % 5)));
    st.T.push('gkdsbr'.slice(0, w));
    st.deck.push(Array.from({ length: w }, (_, x) => (x === 2 && z >= 2 ? 1 : 0)));
    st.mask.push(new Array(w).fill(1));
  }
  return st;
}
function firstDiff(a, b) {
  const A = JSON.stringify(a), B = JSON.stringify(b), i = [...A].findIndex((c, n) => c !== B[n]);
  return `at ${i}: ${A.slice(Math.max(0, i - 40), i + 40)} vs ${B.slice(Math.max(0, i - 40), i + 40)}`;
}
if (typeof process !== 'undefined' && process.argv?.[1] && import.meta.url === `file://${process.argv[1]}`) {
  const bad = selfTest();
  console.log(bad.length ? bad.join('\n') : 'clipboard OK — rot90^4, mirrorX^2, mirrorZ^2, transpose^2 and offsetH are exact');
  process.exit(bad.length ? 1 : 0);
}
