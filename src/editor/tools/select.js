// The selection tools (PLAN §6.7) — six selectors as registry records, and the CONTEXT READERS the
// other three tool files share.
//
// Nothing here writes to the document, so nothing here opens a transaction: a selection is a write
// MASK, not an edit, and pushing "changed the marquee" onto the undo stack would bury the terrain
// edits an author actually wants to step back through. That is why every record below is a `tool`
// with run(), never a brush with apply().
//
// BY-TIER is the one that earns the rail slot. selection.js already computes "every tile reachable
// at climb N but not at the roster tier below it"; the record here just names the tier, the seed and
// the team, so "select what a jump-4 unit unlocks" is a click rather than a script.
//
// The ctx* readers live here because all four tool files need them and there is no shared editor
// context type: the shell (a sibling's file) hands each record whatever its cursor produced, and a
// record that guesses one field name would break the day the shell spells it differently. Each
// reader accepts every spelling the chassis actually produces — {x,z}, [x,z], from/to, rect — and
// returns null rather than throwing, because a tool fired with no cursor is a no-op, not a crash.
//
// Zero three.js and zero DOM: tools/checks drives these under bare `node`.
import { defineTool } from '../registry.js';
import { Selection, MODES, selRect, selLasso, selWand, selByHeight, selBySurface, selByTier, tierBelow } from '../selection.js';
import { TIERS } from '../../world/analysis/profiles.js';

const FINITE_TIERS = TIERS.filter(Number.isFinite);
const flo = (v) => Math.floor(v);

/** The tile under the cursor. Accepts {x,z}, [x,z] or a picker hover record. @returns {{x:number,z:number}|null} */
export function ctxPoint(ctx) {
  const c = ctx || {};
  for (const p of [c.at, c.tile, c.hover, c.point, c.to, c.from]) {
    if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0])) return { x: flo(p[0]), z: flo(p[1]) };
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) return { x: flo(p.x), z: flo(p.z) };
  }
  return null;
}
/** ctxPoint in the ARRAY spelling height.js and surface.js brush with, and a gesture's two ends (a
 *  click is a zero-length drag). Both take a ctx OR a bare point, and both return NULL when there is
 *  no pointer at all — a record fired from the rail with no cursor is a no-op, and a brush that fell
 *  back to 0,0 instead would silently dab at the map origin on every click of its rail button. */
export function at(v) { const p = ctxPoint(v && (Array.isArray(v) || Number.isFinite(v.x)) ? { at: v } : v); return p ? [p.x, p.z] : null; }
export function seg(ctx) { const c = ctx || {}, a = at(c.from) || at(c.a) || at(c), b = at(c.to) || at(c.b) || a; return a && b ? [a, b] : null; }
/** The live Selection under EVERY spelling the chassis uses: main.js names it `sel` on the plugin
 *  ctx, a headless caller passes `selection`, and a session carries its own. A reader that knew one
 *  name left every region tool — choke, scatter, the generators' rect fallback — blind to the
 *  marquee the author had just drawn. */
export function ctxLiveSel(ctx) {
  const c = ctx || {};
  for (const s of [c.selection, c.sel, c.session && c.session.selection]) if (s instanceof Selection) return s;
  return null;
}
/** The drag rectangle as [x0,z0,x1,z1], falling back to from/to, then to the live selection's
 *  bounds, then to the single cursor tile. Clamped to the board. */
export function ctxRect(ctx, def) {
  const c = ctx || {}, W = def.size.w, D = def.size.d;
  const cl = (r) => [Math.max(0, Math.min(r[0], r[2])), Math.max(0, Math.min(r[1], r[3])),
    Math.min(W - 1, Math.max(r[0], r[2])), Math.min(D - 1, Math.max(r[1], r[3]))].map(flo);
  if (Array.isArray(c.rect) && c.rect.length === 4) return cl(c.rect);
  const a = Array.isArray(c.from) ? { x: c.from[0], z: c.from[1] } : c.from, b = Array.isArray(c.to) ? { x: c.to[0], z: c.to[1] } : c.to;
  if (a && b && Number.isFinite(a.x) && Number.isFinite(b.x)) return cl([a.x, a.z, b.x, b.z]);
  const sel = ctxLiveSel(c), bb = sel && sel.count ? sel.bounds() : null;
  if (bb) return cl([bb.x0, bb.z0, bb.x1, bb.z1]);
  const p = ctxPoint(c);
  return p ? cl([p.x, p.z, p.x, p.z]) : null;
}
/** The lasso / route polygon as [[x,z],...] in TILE space (picking.js projects it before we see it). */
export function ctxPoly(ctx) {
  const c = ctx || {}, p = c.poly || c.points || c.path;
  if (!Array.isArray(p)) return [];
  return p.map((q) => (Array.isArray(q) ? [flo(q[0]), flo(q[1])] : [flo(q.x), flo(q.z)])).filter((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]));
}
/** The set-algebra mode: an explicit ctx.mode, else the modifier keys the chassis passes through. */
export function ctxMode(ctx) {
  const c = ctx || {};
  if (MODES.includes(c.mode)) return c.mode;
  const e = c.event || c;
  if (e.ctrlKey || e.metaKey) return e.shiftKey ? 'intersect' : 'subtract';
  if (e.altKey) return 'subtract';
  if (e.shiftKey) return 'add';
  return 'replace';
}
/** The tiles a region tool should act on: the live selection when there is one, else the drag rect,
 *  else the single hovered tile. The order matters — a tool must honour an explicit selection over
 *  whatever the pointer happens to be doing. @returns {Array<[number,number]>} */
export function ctxTiles(ctx, def) {
  const sel = ctxLiveSel(ctx);
  if (sel && sel.count) return sel.tiles();
  const r = ctxRect(ctx, def);
  if (!r) return [];
  const out = [];
  for (let z = r[1]; z <= r[3]; z++) for (let x = r[0]; x <= r[2]; x++) out.push([x, z]);
  return out;
}
/** The Selection a record should write into, created against `def` when the shell has none yet. */
export function ctxSelection(ctx, def) {
  const s = ctxLiveSel(ctx);
  return s && s.n === def.size.w * def.size.d ? s : Selection.of(def);
}

/**
 * One dispatcher for all six selectors, so the records below, the keymap and a headless test share
 * one spelling. Returns a bare Uint8Array — the form Selection.apply() takes for every mode.
 * @param {import('../../world/mapformat/schema.js').MapDef} def
 * @param {'rect'|'lasso'|'wand'|'height'|'surface'|'tier'} kind
 * @param {object} o selector options; see each branch
 * @returns {Uint8Array}
 */
export function selectMask(def, kind, o = {}) {
  if (kind === 'rect') { const r = o.rect; return selRect(def, r[0], r[1], r[2], r[3]); }
  if (kind === 'lasso') return selLasso(def, o.poly || []);
  if (kind === 'wand') return selWand(def, o.x, o.z, { heightTol: o.heightTol ?? 0, surface: o.surface !== false });
  if (kind === 'height') return selByHeight(def, o.lo ?? -Infinity, o.hi ?? Infinity);
  if (kind === 'surface') return selBySurface(def, o.letters ?? 'g');
  if (kind === 'tier') return selByTier(def, { tier: o.tier ?? (def.design?.baseTier ?? 4), team: o.team || 'A',
    from: o.from || null, only: o.only !== false, water: !!o.water });
  throw new RangeError(`selectMask: unknown selector '${kind}'`);
}
/** selectMask + apply, which is the whole body of every record's run(). @returns {Selection} */
export function runSelect(sel, def, kind, o, mode = 'replace') { return sel.apply(selectMask(def, kind, o), mode); }

// ---- records ------------------------------------------------------------------------------------
const defOf = (session, ctx) => (session && session.doc) || (ctx && ctx.def) || null;
// Every record is the same four lines — read the doc, read the cursor, run the selector, apply it —
// so a selector that needs no options is a record with no `apply` body worth reading.
const sel = (rec) => {
  // `out` is captured, not `rec`: the DEFAULTS a record runs on are the ones registry.js derived
  // from the schema, so a record fired from the keymap with no options strip behaves identically to
  // one fired from the strip with every control untouched.
  const out = defineTool({ group: 'select', ...rec,
    run(session, ctx = {}) {
      const def = defOf(session, ctx);
      if (!def) return null;
      const s = ctxSelection(ctx, def), o = rec.opts(ctx, def, { ...out.defaults, ...(ctx.params || {}) });
      return o ? runSelect(s, def, rec.sel, o, ctxMode(ctx)) : s;
    } });
  return out;
};

sel({ id: 'select.rect', label: 'Rect select', sel: 'rect', key: 'r', order: 10, cursor: 'drag-rect',
  tip: 'Drag a rectangle. Shift adds, Alt subtracts, Ctrl+Shift intersects.',
  opts: (ctx, def) => { const r = ctxRect(ctx, def); return r ? { rect: r } : null; } });

sel({ id: 'select.lasso', label: 'Lasso select', sel: 'lasso', order: 11, cursor: 'poly',
  tip: 'Free polygon; tiles are tested at their CENTRE so the marquee holds while the camera orbits.',
  opts: (ctx) => { const p = ctxPoly(ctx); return p.length >= 3 ? { poly: p } : null; } });

sel({ id: 'select.wand', label: 'Magic wand', sel: 'wand', key: 'w', order: 12, cursor: 'click',
  tip: 'Flood from the clicked tile over one surface, within a height tolerance measured on the SEED.',
  params: [{ k: 'heightTol', type: 'range', label: 'height tolerance', min: 0, max: 12, def: 0, unit: 'h' },
    { k: 'surface', type: 'toggle', label: 'same surface', def: true }],
  opts: (ctx, def, p) => { const q = ctxPoint(ctx); return q ? { ...q, heightTol: p.heightTol, surface: p.surface } : null; } });

sel({ id: 'select.height', label: 'By height', sel: 'height', order: 13, cursor: 'click',
  tip: 'Every tile in an h band. Click a tile to centre the band on it.',
  params: [{ k: 'band', type: 'range', label: 'band ±', min: 0, max: 24, def: 0, unit: 'h' },
    { k: 'lo', type: 'number', label: 'low', def: 0, unit: 'h' }, { k: 'hi', type: 'number', label: 'high', def: 0, unit: 'h' }],
  // A click re-centres the band on the tile under it; with no click the two explicit bounds stand,
  // which is what makes the record usable from the keymap with no pointer at all.
  opts: (ctx, def, p) => { const q = ctxPoint(ctx);
    const h = q ? def.grid.H[q.z][q.x] : null;
    return h === null ? { lo: Math.min(p.lo, p.hi), hi: Math.max(p.lo, p.hi) } : { lo: h - p.band, hi: h + p.band }; } });

sel({ id: 'select.surface', label: 'By surface', sel: 'surface', order: 14, cursor: 'click',
  tip: 'Every tile carrying one schema letter. Click to take the letter from the tile under the cursor.',
  params: [{ k: 't', type: 'tile', label: 'surface', def: 'g' }, { k: 'fromCursor', type: 'toggle', label: 'letter under cursor', def: true }],
  opts: (ctx, def, p) => { const q = p.fromCursor ? ctxPoint(ctx) : null;
    return { letters: q ? def.grid.T[q.z][q.x] : p.t }; } });

sel({ id: 'select.tier', label: 'By tier', sel: 'tier', key: 'shift+t', order: 15, cursor: 'click',
  tip: 'What a jump tier UNLOCKS: reachable at this climb and not at the roster tier below it.',
  params: [{ k: 'tier', type: 'enum', label: 'climb', options: FINITE_TIERS.map((t) => ({ v: t, label: `${t}h` })), def: 4 },
    { k: 'team', type: 'enum', label: 'seed', options: [{ v: 'A', label: 'team A' }, { v: 'B', label: 'team B' }], def: 'A' },
    { k: 'only', type: 'toggle', label: 'delta only (else whole reach)', def: true },
    { k: 'water', type: 'toggle', label: 'may cross water', def: false },
    { k: 'fromCursor', type: 'toggle', label: 'seed from the clicked tile', def: false }],
  opts: (ctx, def, p) => { const q = p.fromCursor ? ctxPoint(ctx) : null;
    return { tier: p.tier, team: p.team, only: p.only, water: p.water, from: q ? [q.x, q.z] : null }; } });

/** The roster tier a by-tier delta is measured AGAINST, re-exported so a panel can label the record
 *  "4h -> 6h" without importing selection.js for one function. */
export { tierBelow };
export const SELECT_IDS = Object.freeze(['select.rect', 'select.lasso', 'select.wand', 'select.height', 'select.surface', 'select.tier']);
