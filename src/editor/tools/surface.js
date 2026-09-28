// The surface brushes (PLAN §6.7): paint, water, void, deck.
//
// Painting a letter is one call to `tx.setT`, and if that were all a surface brush had to do this
// file would be forty lines. It is not, because three of the nine letters carry an invariant that is
// a property of the FINISHED board and cannot be seen from the tile under the cursor:
//
//   water  one height per CONNECTED BODY. terrain.js emits no side geometry between two water tiles,
//          so a body spanning two heights leaves an open seam with the bed visible through it
//          (terrain.md §4, validate's water.mixed-height). Extending a body therefore RE-LEVELS it,
//          down to its own minimum, exactly as canvas.settle() does — never up, or the body ends up
//          standing over its own bank.
//   void   never orthogonally adjacent to water: the void's earth face shows through the black cap
//          (props.md §5, validate's void.touches-water). Painted void that lands beside water is
//          repaired back to land at the neighbouring land height, the repair sweeping to a fixed
//          point because fixing one tile exposes the one behind it. Void that survives is parked at
//          cutH - VOID_DROP so its cap falls to the diorama floor instead of floating as a shelf.
//   deck   the prop and the walk grant are ONE gesture. props.md §3.15 calls either alone a bug: a
//          bridge nobody can cross, or units walking on open water. Placing one without the other
//          is not possible through this tool.
//
// Every write goes through the Tx, so the selection mask, the symmetry fan-out and undo are already
// handled. The settle sweeps track the tiles they touched THROUGH the fan-out (`mark` below), which
// is what makes them correct under mirror symmetry: a mirrored write lands on the mirrored body, and
// that body is then levelled on its own terms rather than inheriting its twin's height.
//
// The cursor is read through select.js's at()/seg(), exactly as height.js reads it — a stamp centre
// or a gesture's two ends, NULL when the record was fired with no pointer. Zero three.js, zero DOM.
import { LETTERS } from '../../world/mapformat/schema.js';
import { VOID_DROP } from '../../world/canvas.js';
import { defineBrush, defineTool } from '../registry.js';
import { brushTiles, markFan, SHAPES } from './height.js';
import { at, seg } from './select.js';

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const KEY = (x, z) => x + ',' + z;
const inb = (tx, x, z) => x >= 0 && z >= 0 && x < tx.w && z < tx.d;
const tAt = (tx, x, z) => (inb(tx, x, z) ? tx.def.grid.T[z][x] : null);
const walks = (tx, x, z) => { const L = LETTERS[tAt(tx, x, z)]; return !!(L && L.walk); };
const keys = (set) => [...set].map((k) => k.split(',').map(Number));
/** The touched set dilated by one tile — the neighbourhood a rule about ADJACENCY has to look at. */
function grown(tx, set) {
  const out = new Set(set);
  for (const [x, z] of keys(set)) for (const [dx, dz] of NB) if (inb(tx, x + dx, z + dz)) out.add(KEY(x + dx, z + dz));
  return out;
}

/** The connected 4-adjacent water body containing (x,z); `seen` is shared across calls in one sweep. */
export function waterBody(tx, x, z, seen) {
  const out = [], st = [[x, z]];
  seen.add(KEY(x, z));
  while (st.length) {
    const [cx, cz] = st.pop(); out.push([cx, cz]);
    for (const [dx, dz] of NB) { const nx = cx + dx, nz = cz + dz;
      if (tAt(tx, nx, nz) === 'w' && !seen.has(KEY(nx, nz))) { seen.add(KEY(nx, nz)); st.push([nx, nz]); } }
  }
  return out;
}

/**
 * Level every water body that the stroke touched to a single height — its own minimum. Iterated to a
 * fixed point because the fan-out of a levelling write lands on the mirrored body, which then has to
 * be levelled on its own minimum in turn; four passes is a bound, not a hope (a mirror composes at
 * most twice and quad symmetry at most four times).
 * @returns {number} cells written
 */
export function settleWater(tx, touched) {
  const H = tx.def.grid.H;
  let wrote = 0;
  for (let pass = 0; pass < 4; pass++) {
    const seen = new Set(); let any = 0;
    for (const [x, z] of keys(touched)) {
      if (tAt(tx, x, z) !== 'w' || seen.has(KEY(x, z))) continue;
      const body = waterBody(tx, x, z, seen), lo = Math.min(...body.map(([bx, bz]) => H[bz][bx]));
      for (const [bx, bz] of body) if (H[bz][bx] !== lo) { markFan(tx, touched, bx, bz); if (tx.setH(bx, bz, lo)) any++; }
    }
    wrote += any;
    if (!any) break;
  }
  return wrote;
}

/**
 * Undo every void-beside-water the stroke created, canvas.settle()'s repair applied at paint time:
 * the void becomes `bank` at the LOWEST neighbouring land height, so the result is a shore rather
 * than a new step. Swept to a fixed point — repairing one tile uncovers the void behind it.
 *
 * The scan is the touched set GROWN BY ONE, because the rule is broken from either side: painting
 * void beside a river and painting a river beside existing void are the same fault, and a sweep
 * that only looked at the tiles it wrote would fix the first and miss the second entirely.
 * @returns {number} cells repaired
 */
export function repairVoid(tx, touched, bank = 'g') {
  const H = tx.def.grid.H;
  let fixed = 0;
  for (let pass = 0; pass < 4; pass++) {
    let any = 0;
    for (const [x, z] of keys(grown(tx, touched))) {
      if (tAt(tx, x, z) !== 'v') continue;
      const wet = NB.map(([dx, dz]) => [x + dx, z + dz]).find(([nx, nz]) => tAt(tx, nx, nz) === 'w');
      if (!wet) continue;
      const land = NB.map(([dx, dz]) => [x + dx, z + dz]).filter(([nx, nz]) => walks(tx, nx, nz)).map(([nx, nz]) => H[nz][nx]);
      markFan(tx, touched, x, z);
      tx.setT(x, z, bank); tx.setH(x, z, land.length ? Math.min(...land) : H[wet[1]][wet[0]]);
      any++;
    }
    fixed += any;
    if (!any) break;
  }
  return fixed;
}

/** Park the stroke's surviving void at cutH - VOID_DROP: below every land tile on the board, so the
 *  black cap runs to the diorama floor in one fall (validate's void.above-cut). */
export function parkVoid(tx, touched) {
  const H = tx.def.grid.H, T = tx.def.grid.T;
  let cut = Infinity;
  for (let z = 0; z < tx.d; z++) for (let x = 0; x < tx.w; x++) { const t = T[z][x]; if (t !== 'w' && t !== 'v') cut = Math.min(cut, H[z][x]); }
  if (!Number.isFinite(cut)) cut = 0;                 // all water / all void: terrain.js's own guard
  let n = 0;
  for (const [x, z] of keys(touched)) if (tAt(tx, x, z) === 'v' && tx.setH(x, z, cut - VOID_DROP)) n++;
  return n;
}

/** The one body every letter brush shares: stamp the letter, then run whatever invariant that letter
 *  owes the renderer. Water and void differ from paint only in which letter is locked. */
function stamp(tx, ctx, letter, bank) {
  const p = ctx.params, touched = new Set();
  let n = 0;
  for (const [bx, bz] of brushTiles(at(ctx), p.shape, p.radius)) {
    if (!inb(tx, bx, bz)) continue;
    markFan(tx, touched, bx, bz);
    if (tx.setT(bx, bz, letter)) n++;
  }
  const levelled = settleWater(tx, touched);
  const repaired = repairVoid(tx, touched, bank);
  const parked = parkVoid(tx, touched);
  return { tiles: n, levelled, repaired, parked };
}

const SHAPE = { k: 'shape', type: 'enum', enum: SHAPES, def: 'disc', label: 'brush' };
const RADIUS = { k: 'radius', type: 'range', min: 0, max: 12, def: 1, label: 'radius', unit: 'tiles' };
const BANK = { k: 'bank', type: 'enum', options: Object.keys(LETTERS).filter((c) => LETTERS[c].walk).map((c) => ({ v: c, label: LETTERS[c].label })), def: 'g', label: 'bank' };

export const PAINT = defineBrush({ id: 'surface.paint', label: 'Paint', group: 'surface', key: 'a', order: 30,
  tip: 'write a surface letter. Water and void keep their invariants here too; Alt samples instead.',
  channels: ['surfaces', 'heights'],
  params: [SHAPE, RADIUS, { k: 'tile', type: 'tile', def: 'g', label: 'surface' }, BANK],
  apply(tx, ctx) {
    const q = at(ctx);
    if (ctx.alt) return { sampled: q && tAt(tx, q[0], q[1]) };  // eyedropper, writes nothing
    return stamp(tx, ctx, ctx.params.tile, ctx.params.bank);
  } });

export const WATER = defineBrush({ id: 'surface.water', label: 'Water', group: 'surface', key: 's', order: 31,
  tip: 'flood water. Every connected body is re-levelled to its own lowest tile as it grows.',
  channels: ['surfaces', 'heights'],
  params: [SHAPE, RADIUS, BANK],
  apply(tx, ctx) { return stamp(tx, ctx, 'w', ctx.params.bank); } });

export const VOID = defineBrush({ id: 'surface.void', label: 'Void', group: 'surface', key: 'd', order: 32,
  tip: 'cut the board away. Void that lands beside water is repaired to a bank; the rest is parked below the cut.',
  channels: ['surfaces', 'heights'],
  params: [SHAPE, RADIUS, BANK],
  apply(tx, ctx) { return stamp(tx, ctx, 'v', ctx.params.bank); } });

export const DECK = defineTool({ id: 'surface.deck', label: 'Deck', group: 'surface', key: 'b', order: 33,
  cursor: 'drag-rect', coalesce: false, channels: ['props', 'decks'],
  tip: 'drag a span across water: the deck prop and the walk grant it needs, in one transaction.',
  params: [{ k: 'style', type: 'enum', enum: ['stone', 'wood'], def: 'stone', label: 'style' },
    { k: 'grant', type: 'enum', options: [{ v: 'doc', label: 'follow doc' }, { v: 'explicit', label: 'explicit' }], def: 'doc', label: 'grant' }],
  apply(tx, ctx) {
    const p = ctx.params, g = seg(ctx), H = tx.def.grid.H;
    if (!g) return { ok: false, reason: 'drag a deck span across the water' };
    const [[ax, az], [bx, bz]] = g;
    const x0 = Math.max(0, Math.min(ax, bx)), x1 = Math.min(tx.w - 1, Math.max(ax, bx));
    const z0 = Math.max(0, Math.min(az, bz)), z1 = Math.min(tx.d - 1, Math.max(az, bz));
    // The span is shrunk to the water inside the drag, because a grant on a dry tile grants nothing
    // and reports deck.not-over-water. Shrinking is the forgiving half; the all-water check below is
    // the strict half, since a span with a dry hole in it would still grant that hole.
    let wx0 = Infinity, wz0 = Infinity, wx1 = -Infinity, wz1 = -Infinity;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (tAt(tx, x, z) === 'w') {
      wx0 = Math.min(wx0, x); wz0 = Math.min(wz0, z); wx1 = Math.max(wx1, x); wz1 = Math.max(wz1, z);
    }
    if (!Number.isFinite(wx0)) return { ok: false, reason: 'a deck spans water; this drag covers none' };
    const hs = new Set();
    for (let z = wz0; z <= wz1; z++) for (let x = wx0; x <= wx1; x++) {
      if (tAt(tx, x, z) !== 'w') return { ok: false, reason: `${x},${z} inside the span is dry land: the grant there would be deck.not-over-water` };
      hs.add(H[z][x]);
    }
    // props.md §3.15 / validate's deck.height-mismatch: the prop's h IS the height of the water under
    // it. A mixed body cannot state one, and the water brush already knows how to level one.
    if (hs.size !== 1) return { ok: false, reason: `the water under this span spans ${hs.size} heights; level the body first (water.mixed-height)` };
    const h = [...hs][0], lx = wx1 - wx0 + 1, lz = wz1 - wz0 + 1, dir = lx >= lz ? 'x' : 'z';
    const pid = tx.addProp({ type: 'deck', x: wx0, z: wz0, len: dir === 'x' ? lx : lz, w: dir === 'x' ? lz : lx, dir, h, style: p.style });
    // Under decks.mode 'auto' the grant is DERIVED from this rectangle at compile time, which is the
    // schema's own cure for the desync — re-stating it by hand would flip the document to 'explicit'
    // and give up that guarantee for nothing. Under 'explicit' the tiles must be written, and a
    // caller can force that either way. Either path leaves compileMap() walking the span.
    const explicit = p.grant === 'explicit' || (tx.def.decks && tx.def.decks.mode === 'explicit');
    let granted = 0;
    if (explicit) for (let z = wz0; z <= wz1; z++) for (let x = wx0; x <= wx1; x++) if (tx.setDeckTile(x, z, true)) granted++;
    return { ok: true, pid, rect: [wx0, wz0, wx1, wz1], h, dir, granted, mode: explicit ? 'explicit' : 'auto' };
  } });

/** Every record this file registers, in rail order — what a headless harness iterates. */
export const SURFACE_TOOLS = Object.freeze([PAINT, WATER, VOID, DECK]);
