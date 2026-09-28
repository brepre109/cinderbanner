// The terrain brushes (PLAN §6.7): raise, lower, set, smooth, terrace, ramp, cliff.
//
// Each one is a few lines of arithmetic over `tx.setH`, and that is the point. The Tx is the single
// mutation chokepoint (session.js), so the SELECTION write-mask, the SYMMETRY fan-out and the undo
// inverse are already applied to every cell written through it — not one brush below carries a line
// for any of the three. What a brush owns is its footprint (shape + radius), its arithmetic, and —
// for ramp and cliff — the LEGALITY of the terrain it lays.
//
// CLIFF is why this file exists. A jump shortcut is a piece of terrain AND a record in design.faces,
// and hand-authored maps rot precisely because those two halves get written in different places at
// different times. Here they are one gesture in one transaction: the crest is levelled so the drop
// is exact at every tile of it, an exact named tier is cut, the apron is graded back into the
// ground, and EVERY walkable edge of the new wall is declared. validate.js then proves an assertion
// the author made a second ago instead of re-deriving intent from geometry it cannot read.
//
// The ctx a record's apply(tx, ctx) is handed by the shell is read ONLY through select.js's at()
// and seg(): main.js's paint() passes picking.js's hover RECORD, a headless caller passes [x,z], and
// a rail click passes no cursor at all. `params` is already coerced by registry.paramsFor(), `alt`
// inverts a brush. Document reads go to `tx.def`; writes go to tx.*, never to it.
//
// Zero three.js and zero DOM: the harness drives every record below under bare `node`.
import { H_MIN, H_MAX, DEFAULTS, LETTERS } from '../../world/mapformat/schema.js';
import { HEIGHT_STEP } from '../../world/jumpgraph.js';
import { tierFor } from '../../world/canvas.js';
import { defineBrush, defineTool } from '../registry.js';
import { at, seg } from './select.js';

/** 'disc' at r=1 is the 5-tile plus, which is what a 1-radius Euclidean disc IS on a lattice; anyone
 *  wanting the 9-tile block asks for 'square'. */
export const SHAPES = Object.freeze(['disc', 'square', 'single']);
/** The drops the CLIFF tool offers. 4/6/10/14 are roster tiers (profiles.TIERS); 8 is here because
 *  it is the useful "nothing below 10 takes this" wall, and it declares tier 10 like any 8h step. */
export const CLIFF_DROPS = Object.freeze([4, 6, 8, 10, 14]);
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const clampH = (h) => Math.max(H_MIN, Math.min(H_MAX, Math.round(h)));
const quant = (h, q) => clampH(q > 1 ? Math.round(h / q) * q : h);
const baseTier = (tx) => (tx.def.design && tx.def.design.baseTier) || DEFAULTS.baseTier;
const inb = (tx, x, z) => x >= 0 && z >= 0 && x < tx.w && z < tx.d;
const walks = (tx, x, z) => { const L = LETTERS[tx.def.grid.T[z][x]]; return !!(L && L.walk); };
/** Record a tile AND everything symmetry fanned it onto: a tool that inspects what it just wrote
 *  must inspect the mirrored copies too, or half a symmetric edit goes unexamined. */
export function markFan(tx, set, x, z) { for (const [px, pz] of (tx.fan ? tx.fan(x, z) : [[x, z]])) set.add(px + ',' + pz); }
/** Undirected edge id, so a face is never declared twice with its ends swapped. */
const edgeKey = (a, b) => (a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? `${a[0]},${a[1]}|${b[0]},${b[1]}` : `${b[0]},${b[1]}|${a[0]},${a[1]}`);

/** Every tile a stamp of `shape`/`r` covers, z-major. A NULL centre — at() found no pointer — is an
 *  EMPTY footprint, which keeps a rail-fired brush off the map origin. @param {[number,number]|null} xz */
export function brushTiles(xz, shape, r) {
  if (!xz) return []; const [x, z] = xz;
  if (shape === 'single' || !(r > 0)) return [[x, z]];
  const out = [], rr = r * r;
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++)
    if (shape === 'square' || dx * dx + dz * dz <= rr) out.push([x + dx, z + dz]);
  return out;
}
/** Bresenham tile run, both ends inclusive — the ramp's spine and the cliff's crest. */
export function lineTiles(x0, z0, x1, z1) {
  const out = []; let x = x0, z = z0;
  const dx = Math.abs(x1 - x0), dz = -Math.abs(z1 - z0), sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
  let err = dx + dz;
  for (;;) { out.push([x, z]); if (x === x1 && z === z1) break; const e2 = 2 * err; if (e2 >= dz) { err += dz; x += sx; } if (e2 <= dx) { err += dx; z += sz; } }
  return out;
}

// Raise and lower must move a tile ONCE per stroke, or a slow drag over the same tile lifts it by
// step per pointermove and the brush behaves like a lever instead of a chisel. The memo holds one
// stroke — only one is ever live — so it is a fixed two-field object rather than a growing cache.
let STROKE = { id: null, seen: null };
function once(tx, x, z) {
  const id = tx.strokeId;
  if (id == null) return true;                       // a discrete action repeats nothing
  if (STROKE.id !== id) STROKE = { id, seen: new Set() };
  const k = z * 4096 + x;
  if (STROKE.seen.has(k)) return false;
  STROKE.seen.add(k); return true;
}

/**
 * A quantised, WALKABLE height run of `n` tiles from h0 to h1: every value a multiple of `quantum`,
 * every consecutive step at or under `maxStep`. Returns null when the run is too short to climb
 * legally — which the ramp tool reports rather than papering over, because a ramp that ends in an
 * illegal step is exactly the bug the ramp tool exists to prevent.
 * @param {number} h0 @param {number} h1 @param {number} n
 * @param {{maxStep?:number, quantum?:number}} [o]
 * @returns {number[]|null}
 */
export function gradeRun(h0, h1, n, o = {}) {
  const q = o.quantum ?? HEIGHT_STEP, m = o.maxStep ?? DEFAULTS.baseTier;
  if (!(n >= 1)) return null;
  const a = quant(h0, q), b = quant(h1, q);
  if (Math.abs(b - a) > m * (n - 1)) return null;
  const out = [];
  for (let i = 0; i < n; i++) out.push(quant(a + ((b - a) * i) / (n - 1 || 1), q));
  out[0] = a; out[n - 1] = b;
  // Rounding each sample independently can widen one interior step past maxStep even when the raw
  // gradient is legal; clamp forwards, then CHECK rather than assume the run came out walkable.
  for (let i = 1; i < n - 1; i++) { const dv = out[i] - out[i - 1]; if (Math.abs(dv) > m) out[i] = out[i - 1] + Math.sign(dv) * m; }
  for (let i = 0; i < n - 1; i++) if (Math.abs(out[i + 1] - out[i]) > m) return null;
  return out;
}

// ---- shared param records ----------------------------------------------------------------------
const SHAPE = { k: 'shape', type: 'enum', enum: SHAPES, def: 'disc', label: 'brush' };
const RADIUS = { k: 'radius', type: 'range', min: 0, max: 12, def: 1, label: 'radius', unit: 'tiles' };
const STEP = { k: 'step', type: 'range', min: HEIGHT_STEP, max: 14, step: HEIGHT_STEP, def: HEIGHT_STEP, label: 'step', unit: 'h' };
const SURFACE = { k: 'surface', type: 'enum', label: 'surface',
  options: [{ v: 'keep', label: 'keep' }, ...Object.keys(LETTERS).filter((c) => LETTERS[c].walk).map((c) => ({ v: c, label: LETTERS[c].label }))], def: 'keep' };

/** raise / lower share one body; `sign` is the only difference, and Alt flips it. */
const bump = (sign) => (tx, ctx) => {
  const p = ctx.params, dir = ctx.alt ? -sign : sign;
  let n = 0;
  for (const [bx, bz] of brushTiles(at(ctx), p.shape, p.radius))
    if (inb(tx, bx, bz) && once(tx, bx, bz) && tx.setH(bx, bz, clampH(tx.def.grid.H[bz][bx] + dir * p.step))) n++;
  return { tiles: n };
};

export const RAISE = defineBrush({ id: 'height.raise', label: 'Raise', group: 'height', key: 'h', order: 10,
  tip: 'lift the stamp by one step; Alt lowers. One move per tile per stroke.', channels: ['heights'],
  params: [SHAPE, RADIUS, STEP], apply: bump(1) });

export const LOWER = defineBrush({ id: 'height.lower', label: 'Lower', group: 'height', key: 'j', order: 11,
  tip: 'drop the stamp by one step; Alt raises.', channels: ['heights'],
  params: [SHAPE, RADIUS, STEP], apply: bump(-1) });

export const SET = defineBrush({ id: 'height.set', label: 'Set', group: 'height', key: 'k', order: 12,
  tip: 'flatten the stamp to one height. Alt samples the tile under the cursor instead of writing.',
  channels: ['heights'],
  params: [SHAPE, RADIUS, { k: 'h', type: 'number', min: H_MIN, max: H_MAX, step: HEIGHT_STEP, def: DEFAULTS.h, label: 'height', unit: 'h' }],
  apply(tx, ctx) {
    const p = ctx.params, q = at(ctx);
    if (ctx.alt) return { sampled: q && inb(tx, q[0], q[1]) ? tx.def.grid.H[q[1]][q[0]] : null };   // eyedropper, writes nothing
    let n = 0;
    for (const [bx, bz] of brushTiles(q, p.shape, p.radius)) if (inb(tx, bx, bz) && tx.setH(bx, bz, clampH(p.h))) n++;
    return { tiles: n };
  } });

export const SMOOTH = defineBrush({ id: 'height.smooth', label: 'Smooth', group: 'height', key: 'l', order: 13,
  tip: 'pull each tile toward the mean of its 4 neighbours, then re-quantise.', channels: ['heights'],
  params: [SHAPE, RADIUS, { k: 'strength', type: 'range', min: 0.1, max: 1, step: 0.1, def: 0.5, label: 'strength' },
    { k: 'quantum', type: 'enum', enum: [HEIGHT_STEP, 2 * HEIGHT_STEP], def: HEIGHT_STEP, label: 'snap', unit: 'h' }],
  apply(tx, ctx) {
    const p = ctx.params, H = tx.def.grid.H;
    // Targets are read off the ORIGINAL grid for the whole stamp before anything is written, so the
    // result does not depend on the order the footprint happens to enumerate its tiles.
    const list = brushTiles(at(ctx), p.shape, p.radius).filter(([bx, bz]) => inb(tx, bx, bz));
    const want = list.map(([bx, bz]) => {
      let sum = H[bz][bx], k = 1;
      for (const [dx, dz] of NB) { const nx = bx + dx, nz = bz + dz; if (inb(tx, nx, nz)) { sum += H[nz][nx]; k++; } }
      return quant(H[bz][bx] + (sum / k - H[bz][bx]) * p.strength, p.quantum);
    });
    let n = 0;
    for (let i = 0; i < list.length; i++) if (tx.setH(list[i][0], list[i][1], want[i])) n++;
    return { tiles: n };
  } });

export const TERRACE = defineBrush({ id: 'height.terrace', label: 'Terrace', group: 'height', key: 'shift+h', order: 14,
  tip: 'snap the stamp onto the terrace lattice, so the board steps in one legible unit.', channels: ['heights'],
  params: [SHAPE, RADIUS, { k: 'terrace', type: 'enum', enum: [2, 4, 6], def: 4, label: 'terrace', unit: 'h' },
    { k: 'origin', type: 'number', min: H_MIN, max: H_MAX, step: 1, def: 0, label: 'origin', unit: 'h' }],
  apply(tx, ctx) {
    const p = ctx.params, H = tx.def.grid.H;
    let n = 0;
    for (const [bx, bz] of brushTiles(at(ctx), p.shape, p.radius)) if (inb(tx, bx, bz))
      if (tx.setH(bx, bz, clampH(p.origin + Math.round((H[bz][bx] - p.origin) / p.terrace) * p.terrace))) n++;
    return { tiles: n };
  } });

/** Perpendicular offsets for a `width`-wide ribbon around a run travelling along `axis`. */
const ribbon = (w, axis) => { const out = [], h = Math.floor((w - 1) / 2); for (let k = -h; k <= w - 1 - h; k++) out.push(axis === 'x' ? [0, k] : [k, 0]); return out; };

export const RAMP = defineTool({ id: 'height.ramp', label: 'Ramp', group: 'height', key: 'g', order: 20,
  cursor: 'line', coalesce: false, channels: ['heights', 'surfaces'],
  tip: 'drag from the low end to the high end: a graded slope, quantised so a base-tier unit walks it.',
  params: [{ k: 'width', type: 'range', min: 1, max: 8, def: 3, label: 'width', unit: 'tiles' },
    { k: 'maxStep', type: 'enum', enum: [2, 4, 6, 10], def: DEFAULTS.baseTier, label: 'max step', unit: 'h' }, SURFACE],
  apply(tx, ctx) {
    const p = ctx.params, [[ax, az], [bx, bz]] = seg(ctx) || [[-1, -1], [-1, -1]];
    if (!inb(tx, ax, az) || !inb(tx, bx, bz)) return { ok: false, reason: 'drag both ends of a ramp across the board' };
    const path = lineTiles(ax, az, bx, bz), H = tx.def.grid.H;
    const h0 = H[az][ax], h1 = H[bz][bx];
    const hs = gradeRun(h0, h1, path.length, { maxStep: p.maxStep, quantum: HEIGHT_STEP });
    // Refusing is the feature. A ramp that ends in an illegal step is an accidental express face,
    // which is exactly the fault this editor is built to make impossible to author by accident.
    if (!hs) return { ok: false, reason: `a ${Math.abs(h1 - h0)}h climb needs ${Math.ceil(Math.abs(h1 - h0) / p.maxStep) + 1} tiles at ${p.maxStep}h per step; this run is ${path.length}` };
    const axis = Math.abs(bx - ax) >= Math.abs(bz - az) ? 'x' : 'z', off = ribbon(p.width, axis);
    let n = 0;
    for (let i = 0; i < path.length; i++) for (const [dx, dz] of off) {
      const x = path[i][0] + dx, z = path[i][1] + dz;
      if (!inb(tx, x, z)) continue;
      if (tx.setH(x, z, hs[i])) n++;
      if (p.surface !== 'keep') tx.setT(x, z, p.surface);
    }
    return { ok: true, tiles: n, from: h0, to: h1, steps: path.length };
  } });

/** Which side of a crest the ground falls away on. 'auto' votes on the terrain that is already
 *  there; left/right are relative to walking the crest from the first click to the second. */
function fallSide(tx, crest, side) {
  const a = crest[0], b = crest[crest.length - 1];
  const dx = Math.sign(b[0] - a[0]) || (crest.length > 1 ? 0 : 1), dz = Math.sign(b[1] - a[1]);
  const L = [dz, -dx], R = [-dz, dx];
  if (side === 'left') return L;
  if (side === 'right') return R;
  let vote = 0;
  const H = tx.def.grid.H;
  for (const [x, z] of crest) {
    const l = inb(tx, x + L[0], z + L[1]) ? H[z + L[1]][x + L[0]] : Infinity;
    const r = inb(tx, x + R[0], z + R[1]) ? H[z + R[1]][x + R[0]] : Infinity;
    vote += l === r ? 0 : l < r ? 1 : -1;
  }
  return vote >= 0 ? L : R;                          // ties fall left, the documented default
}

export const CLIFF = defineTool({ id: 'height.cliff', label: 'Cliff', group: 'height', key: 'c', order: 21,
  cursor: 'line', coalesce: false, channels: ['heights', 'surfaces', 'design'],
  tip: 'drag along the crest: cuts an exact tier drop, grades the apron, and declares every face of it.',
  params: [{ k: 'drop', type: 'enum', enum: CLIFF_DROPS, def: 6, label: 'drop', unit: 'h' },
    { k: 'side', type: 'enum', enum: ['auto', 'left', 'right'], def: 'auto', label: 'falls' },
    { k: 'depth', type: 'range', min: 1, max: 8, def: 2, label: 'apron', unit: 'tiles' },
    { k: 'blend', type: 'range', min: 0, max: 8, def: 2, label: 'blend', unit: 'tiles' },
    { k: 'kind', type: 'enum', enum: ['express', 'gate', 'local', 'cosmetic', 'trap'], def: 'express', label: 'claim' },
    { k: 'floor', type: 'enum', options: Object.keys(LETTERS).filter((c) => LETTERS[c].walk).map((c) => ({ v: c, label: LETTERS[c].label })), def: 'r', label: 'foot' },
    { k: 'declare', type: 'toggle', def: true, label: 'declare faces' }],
  apply(tx, ctx) {
    const p = ctx.params, [[ax, az], [bx, bz]] = seg(ctx) || [[-1, -1], [-1, -1]];
    if (!inb(tx, ax, az) || !inb(tx, bx, bz)) return { ok: false, reason: 'drag both ends of a crest across the board' };
    const crest = lineTiles(ax, az, bx, bz), H = tx.def.grid.H, touched = new Set();
    const [px, pz] = fallSide(tx, crest, p.side);
    const top = clampH(H[az][ax]), low = clampH(top - p.drop);
    if (top - low !== p.drop) return { ok: false, reason: `a ${p.drop}h drop from ${top}h leaves the ${H_MIN}h floor` };
    const cut = (x, z, h) => { if (!inb(tx, x, z)) return false; markFan(tx, touched, x, z); tx.setH(x, z, h); if (!walks(tx, x, z)) tx.setT(x, z, p.floor); return true; };
    let anchor = null;
    for (const [cx, cz] of crest) {
      cut(cx, cz, top);                              // level the crest, or the drop is not exact along it
      for (let k = 1; k <= p.depth; k++) {
        if (!cut(cx + px * k, cz + pz * k, low)) break;
        if (k === 1 && !anchor) anchor = [[cx, cz], [cx + px, cz + pz]];
      }
      // Grade the far lip back into whatever was there, or the apron's own outer edge becomes a
      // second, undeclared step and the tool has traded one accidental express for another.
      if (p.blend > 0) {
        const ex = cx + px * (p.depth + p.blend), ez = cz + pz * (p.depth + p.blend);
        const hs = inb(tx, ex, ez) ? gradeRun(low, H[ez][ex], p.blend + 1, { maxStep: baseTier(tx) }) : null;
        if (hs) for (let k = 1; k <= p.blend; k++) cut(cx + px * (p.depth + k), cz + pz * (p.depth + k), hs[k]);
      }
    }
    const faces = p.declare ? declareCut(tx, touched, anchor, p) : [];
    return { ok: true, crest: crest.length, drop: p.drop, tier: tierFor(p.drop), faces: faces.length, fids: faces };
  } });

/**
 * Declare EVERY face the cut created, not just the wall the author dragged. Declaring one face per
 * crest tile leaves the two ENDS of the apron — where the excavated floor meets untouched ground —
 * as raw steps, i.e. exactly the contract.face-undeclared rot this tool exists to abolish. So the
 * sweep is over GEOMETRY, not over the gesture: every orthogonal pair of walkable tiles the
 * transaction touched whose step now exceeds baseTier is a vaultable edge, declared with its own
 * MEASURED drop. Scanning written cells also makes symmetry free — the mirrored wall is in
 * `touched` because every write was recorded through the fan-out.
 *
 * ONE face carries the claim; the rest get zero savings floors. Not a dodge: contract.face-worthless
 * prices a face by DELETING its edge and re-routing, so seven tiles of an eight-tile wall provably
 * save nothing alone and would each report a warning the author cannot act on. The claim belongs to
 * the wall, and the wall states it once — at the tile where the drag began.
 * @returns {string[]} the fids declared, the claim-bearing one first
 */
function declareCut(tx, touched, anchor, p) {
  const H = tx.def.grid.H, base = baseTier(tx), cand = [];
  const seen = new Set((tx.def.design.faces || []).map((f) => edgeKey(f.from, f.to)));
  for (const k of touched) {
    const [x, z] = k.split(',').map(Number);
    for (const [dx, dz] of NB) {
      const nx = x + dx, nz = z + dz;
      if (!inb(tx, nx, nz)) continue;
      const ek = edgeKey([x, z], [nx, nz]);
      if (seen.has(ek)) continue;
      const drop = Math.abs(H[z][x] - H[nz][nx]);
      if (drop <= base || !walks(tx, x, z) || !walks(tx, nx, nz)) continue;
      seen.add(ek);
      const hiFirst = H[z][x] >= H[nz][nx];          // `from` is the high side by convention
      cand.push({ ek, from: hiFirst ? [x, z] : [nx, nz], to: hiFirst ? [nx, nz] : [x, z], drop });
    }
  }
  const ai = anchor ? cand.findIndex((c) => c.ek === edgeKey(anchor[0], anchor[1])) : -1;
  if (ai > 0) cand.unshift(cand.splice(ai, 1)[0]);
  const out = [];
  for (const c of cand) {
    const lead = out.length === 0, fid = `face_${c.from[0]}_${c.from[1]}_${c.to[0]}_${c.to[1]}`;
    tx.declare('face', { fid, from: c.from, to: c.to, drop: c.drop, tier: tierFor(c.drop),
      kind: lead ? p.kind : 'local', minSaving: lead ? 1 : 0, minTurnSaving: lead ? 1 : 0,
      note: lead ? `${p.drop}h cliff cut by height.cliff` : `wall of ${out[0]}` });
    out.push(fid);
  }
  return out;
}

/** Every record this file registers, in rail order — what a headless harness iterates. */
export const HEIGHT_TOOLS = Object.freeze([RAISE, LOWER, SET, SMOOTH, TERRACE, RAMP, CLIFF]);
