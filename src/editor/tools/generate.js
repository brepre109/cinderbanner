// GENERATORS AS BRUSHES (PLAN §6.7). Any primitive from src/world/primitives, or a whole procgen
// archetype, run INTO the current selection as ONE undoable transaction.
//
// This is the line between "the editor has a generate button" and "generation is an authoring
// tool". A primitive writes into a Canvas, not into a document — that is how procgen composes them
// — so the brush builds a Canvas from the live document, runs the primitive, and DIFFS the result
// back through the transaction. Three things fall out of that, none of which needed code here:
// the selection mask clips every cell the generator writes (Tx.setH already no-ops outside it),
// symmetry mirrors the whole generated shape, and Ctrl+Z takes the canyon back out in one step. So
// you generate a canyon, then hand-edit it, and both halves live in the same history.
//
// DECLARATIONS ARE RE-MEASURED, NEVER COPIED. A primitive declares the face it just cut, measured
// against the Canvas it wrote; if the mask clipped part of that shape the document's step is a
// different number, and copying the primitive's own `drop` would ship an assertion the terrain
// contradicts (validate.js contract.face-drop). Every declaration is therefore re-derived from the
// document AFTER the cells land, and one that no longer describes a real face is dropped with a
// count rather than written as a lie.
//
// Zero three.js and zero DOM.
import { defineGenerator } from '../registry.js';
import { PRIMITIVES, PRIMITIVE_IDS, defaultsOf as primitiveDefaults } from '../../world/primitives/index.js';
import { Canvas } from '../../world/canvas.js';
import { generate, ARCHETYPE_IDS } from '../../world/procgen/index.js';
import { SIZE_MIN, DEFAULTS } from '../../world/mapformat/schema.js';
import { ctxPoint, ctxRect } from './select.js';
import { inMask } from './props.js';
import { declareFace, declareChoke, declareRoute, declareRegion, declareAssist, declarePromise } from './design.js';

const ints = (s) => String(s ?? '').split(/[,\s]+/).map((v) => parseInt(v, 10)).filter(Number.isFinite);
const baseOf = (def) => def.design?.baseTier ?? DEFAULTS.baseTier;

/** A Canvas holding the live document. Declarations start EMPTY on purpose: whatever the primitive
 *  declares is then exactly the tail, with no diffing against the document's own design block. */
export function defToCanvas(def, seed = 1) {
  const c = new Canvas({ w: def.size.w, d: def.size.d, baseTier: baseOf(def),
    tiers: (def.design?.tiers || DEFAULTS.tiers).slice(), id: def.id, name: def.name, seed });
  for (let z = 0; z < c.d; z++) for (let x = 0; x < c.w; x++) { c.H[z][x] = def.grid.H[z][x]; c.T[z][x] = def.grid.T[z][x]; }
  c.props = (def.props || []).map((p) => ({ ...p }));
  c.spawns = { A: (def.spawns?.A || []).map((s) => [s[0], s[1]]), B: (def.spawns?.B || []).map((s) => [s[0], s[1]]) };
  for (const [x, z] of [...c.spawns.A, ...c.spawns.B]) c.protect(x, z);
  return c;
}

const okTile = (tx, t) => Array.isArray(t) && inMask(tx, t[0], t[1]);
/**
 * Write a declaration bundle through the design tools, re-measuring as it goes. Takes a Canvas or
 * any `{faces, chokes, routes, regions, assists, promises, waivers}` bag, which is what lets a
 * pasted procgen def and a run primitive share this one path.
 * @returns {{faces:number, chokes:number, routes:number, regions:number, assists:number, promises:number, dropped:number}}
 */
export function declareAll(tx, bag) {
  const out = { faces: 0, chokes: 0, routes: 0, regions: 0, assists: 0, promises: 0, dropped: 0 };
  const base = baseOf(tx.def), H = tx.def.grid.H;
  for (const f of bag.faces || []) {
    // Below the base tier it is a step, not a shortcut: faceScan never reports it, so declaring it
    // would be a phantom face in every analysis run from here on.
    const drop = okTile(tx, f.from) && okTile(tx, f.to) ? Math.abs(H[f.from[1]][f.from[0]] - H[f.to[1]][f.to[0]]) : 0;
    if (drop <= base || !declareFace(tx, { ...f, fid: undefined })) { out.dropped++; continue; }
    out.faces++;
  }
  for (const [kind, list, fn] of [['chokes', bag.chokes, declareChoke], ['assists', bag.assists, declareAssist]])
    for (const rec of list || []) {
      const tiles = (rec.tiles || []).filter((t) => okTile(tx, t));
      if (tiles.length !== (rec.tiles || []).length || !fn(tx, { ...rec, tiles, cid: undefined, aid: undefined })) { out.dropped++; continue; }
      out[kind]++;
    }
  for (const r of bag.routes || []) {
    const via = (r.via || []).filter((t) => okTile(tx, t));
    if (via.length !== (r.via || []).length || !declareRoute(tx, { ...r, via, rid: undefined })) { out.dropped++; continue; }
    out.routes++;
  }
  for (const r of bag.regions || []) {
    const [x0, z0, x1, z1] = r.rect || [];
    if (!okTile(tx, [x0, z0]) || !okTile(tx, [x1, z1]) || !declareRegion(tx, { ...r, rgid: undefined })) { out.dropped++; continue; }
    out.regions++;
  }
  for (const p of bag.promises || []) { declarePromise(tx, p); out.promises++; }
  return out;
}

/**
 * Diff a Canvas back into the transaction: cells first, then the props and declarations it appended.
 * @param {object} tx open transaction @param {Canvas} c @param {{props:number}} mark counts taken BEFORE the run
 * @returns {{cells:number, props:number, decl:object}}
 */
export function applyCanvasDiff(tx, c, mark) {
  const def = tx.def;
  let cells = 0;
  for (let z = 0; z < c.d; z++) for (let x = 0; x < c.w; x++) {
    if (c.H[z][x] !== def.grid.H[z][x] && tx.setH(x, z, c.H[z][x])) cells++;
    if (c.T[z][x] !== def.grid.T[z][x] && tx.setT(x, z, c.T[z][x])) cells++;
  }
  let props = 0;
  for (const p of c.props.slice(mark.props)) {
    if (!inMask(tx, p.x, p.z)) continue;
    const q = { ...p }; delete q.pid;
    tx.addProp(q); props++;
  }
  return { cells, props, decl: declareAll(tx, c) };
}

// A primitive's `tile`/`rect`/`ints`/`list` fields have no widget, so they are typed as text and
// FALL BACK to the cursor and the selection — which is the whole point of a generator brush: you
// select the ground and the primitive fills it. When neither the box nor the cursor can answer a
// REQUIRED one, runPrimitive refuses by name below; these are the four types that can reach that,
// because every numeric field carries a widget default and can never arrive unset.
const NEED = Object.freeze({ tile: 'type "x,z" into it, or put the cursor on a tile',
  rect: 'type "x0,z0,x1,z1" into it, or select the ground first',
  ints: 'type a comma-separated list of indices', list: 'type a JSON array of records' });
function resolveField(fd, raw, ctx, def) {
  // A `from`/`to` pair takes the gesture's OWN two ends when the cursor has them, so a line drag
  // fills both boxes with different tiles instead of the same one twice.
  if (fd.type === 'tile') { const v = ints(raw); if (v.length >= 2) return [v[0], v[1]];
    const end = ctx && (fd.k === 'from' || fd.k === 'to') && ctx[fd.k];
    const p = ctxPoint(end ? { at: end } : ctx); return p ? [p.x, p.z] : undefined; }
  if (fd.type === 'rect') { const v = ints(raw); if (v.length >= 4) return v.slice(0, 4); return ctxRect(ctx, def) || undefined; }
  if (fd.type === 'ints') { const v = ints(raw); return v.length ? v : undefined; }
  if (fd.type === 'list') { try { const j = JSON.parse(raw); return Array.isArray(j) ? j : undefined; } catch { return undefined; } }
  return raw === '' || raw === null || raw === undefined ? undefined : raw;   // undefined: the primitive's own `?? fallback` decides
}

/** The control schema for one primitive, built from its declared `schema`. */
export function primitiveParams(id) {
  const out = [];
  for (const fd of PRIMITIVES[id].schema) {
    const b = { k: fd.k, label: fd.label || fd.k, unit: fd.units || '' };
    if (fd.type === 'tile') out.push({ ...b, type: 'text', def: '', hint: 'x,z — empty takes the cursor tile' });
    else if (fd.type === 'rect') out.push({ ...b, type: 'text', def: '', hint: 'x0,z0,x1,z1 — empty takes the selection bounds' });
    else if (fd.type === 'ints') out.push({ ...b, type: 'text', def: (fd.def || []).join(', '), hint: 'comma separated' });
    else if (fd.type === 'list') out.push({ ...b, type: 'text', def: JSON.stringify(fd.def || []), hint: 'JSON array of records' });
    else if (fd.type === 'bool') out.push({ ...b, type: 'toggle', def: !!fd.def });
    else if (fd.type === 'string') out.push({ ...b, type: 'text', def: fd.def ?? '' });
    else if (fd.type === 'enum') out.push({ ...b, type: 'enum', def: fd.def ?? null,
      // A field with no default means "leave this channel alone"; the option carries that meaning
      // into the strip instead of pretending the first letter is a default.
      options: (fd.def === null ? [{ v: null, label: '(leave alone)' }] : []).concat(fd.enum.map((e) => ({ v: e, label: String(e) }))) });
    else out.push({ ...b, type: 'number', min: fd.min, max: fd.max, def: fd.def ?? (fd.req ? (fd.min ?? 0) : null) });
  }
  if (!out.some((p) => p.k === 'seed')) out.push({ k: 'seed', type: 'number', label: 'seed', def: 1, min: 0,
    hint: 'the canvas rng a jittering primitive draws from' });
  return out;
}

/**
 * Run one primitive into the transaction.
 * @returns {{id:string, result:any, cells:number, props:number, decl:object}}
 */
export function runPrimitive(tx, id, values = {}, ctx = {}) {
  const rec = PRIMITIVES[id];
  if (!rec) throw new Error(`runPrimitive: unknown primitive '${id}' (have: ${PRIMITIVE_IDS.join(', ')})`);
  const params = primitiveDefaults(id);
  for (const fd of rec.schema) { const v = resolveField(fd, values[fd.k], ctx, tx.def); if (v !== undefined) params[fd.k] = v; }
  // Refuse by NAME rather than letting the primitive destructure an unset param: `const [vx, vz] =
  // o.from` on undefined throws "undefined is not iterable" from inside ledge/catwalk/ramp, several
  // frames below the field the author actually has to fill, and the toast then names the wrong thing.
  const gap = rec.schema.filter((fd) => fd.req && params[fd.k] === undefined);
  if (gap.length) throw new Error(`${id}: ${gap.map((fd) => `'${fd.label || fd.k}' is empty — ${NEED[fd.type] || 'type a value'}`).join('; ')}`);
  const c = defToCanvas(tx.def, values.seed ?? 1);
  const mark = { props: c.props.length };
  const result = rec.fn(c, params);
  return { id, result, ...applyCanvasDiff(tx, c, mark) };
}

/** Paste a whole generated document into the transaction at an offset — the selection form of the
 *  procgen brush. Spawns are NOT pasted: the document's own five slots per team are the author's. */
export function pasteDef(tx, src, x0, z0) {
  let cells = 0;
  for (let z = 0; z < src.size.d; z++) for (let x = 0; x < src.size.w; x++) {
    if (tx.setH(x0 + x, z0 + z, src.grid.H[z][x])) cells++;
    if (tx.setT(x0 + x, z0 + z, src.grid.T[z][x])) cells++;
  }
  let props = 0;
  for (const p of src.props || []) {
    const q = { ...p, x: p.x + x0, z: p.z + z0 }; delete q.pid;
    if (!inMask(tx, q.x, q.z)) continue;
    tx.addProp(q); props++;
  }
  const off = (t) => [t[0] + x0, t[1] + z0], D = src.design || {};
  const bag = { faces: (D.faces || []).map((f) => ({ ...f, from: off(f.from), to: off(f.to) })),
    chokes: (D.chokes || []).map((c) => ({ ...c, tiles: (c.tiles || []).map(off) })),
    routes: (D.routes || []).map((r) => ({ ...r, via: (r.via || []).map(off) })),
    regions: (D.regions || []).map((r) => ({ ...r, rect: [...off([r.rect[0], r.rect[1]]), ...off([r.rect[2], r.rect[3]])] })),
    assists: (D.assists || []).map((a) => ({ ...a, tiles: (a.tiles || []).map(off) })), promises: [] };
  return { cells, props, decl: declareAll(tx, bag) };
}

// ---- records ------------------------------------------------------------------------------------
// One record per primitive, generated from the registry. A primitive added under src/world/primitives
// appears in the palette with its own form and needs no edit here — the same rule PROP_SPEC gives
// the stamp tool.
for (const id of PRIMITIVE_IDS) {
  const rec = PRIMITIVES[id];
  const out = defineGenerator({ id: `gen.${id}`, label: rec.label, group: 'generate', order: 40, cursor: 'drag-rect',
    channels: ['heights', 'surfaces', 'props', 'design'], tip: rec.role, params: primitiveParams(id),
    apply(tx, ctx = {}) { return runPrimitive(tx, id, { ...out.defaults, ...(ctx.params || {}) }, ctx); } });
}

export const PROCGEN = defineGenerator({ id: 'gen.procgen', label: 'Procgen archetype', group: 'generate', order: 49, cursor: 'drag-rect',
  channels: ['heights', 'surfaces', 'props', 'design', 'spawns', 'meta'],
  tip: 'Run the full acceptance loop and drop the result into the selection, or over the whole document.',
  params: [{ k: 'archetype', type: 'enum', label: 'archetype', def: '',
    options: [{ v: '', label: 'any' }, ...ARCHETYPE_IDS.map((a) => ({ v: a, label: a }))] },
    { k: 'seed', type: 'number', label: 'seed', def: 1, min: 0 },
    { k: 'target', type: 'enum', label: 'into', def: 'selection',
      options: [{ v: 'selection', label: 'the selection' }, { v: 'document', label: 'the whole document' }] },
    { k: 'tiers', type: 'text', label: 'tiers', def: '', hint: 'narrow the archetype, e.g. 6, 10' },
    { k: 'attempts', type: 'number', label: 'attempts', def: 240, min: 1, max: 2000 }],
  apply(tx, ctx = {}) {
    const p = { ...PROCGEN.defaults, ...(ctx.params || {}) }, def = tx.def;
    const tiers = ints(p.tiers);
    const opts = { seed: p.seed ?? 1, attempts: p.attempts, ...(p.archetype ? { archetype: p.archetype } : {}), ...(tiers.length ? { tiers } : {}) };
    if (p.target === 'document') {
      const g = generate({ ...opts, w: def.size.w, d: def.size.d });
      // The slot's identity is the author's, not the generator's: everything else is replaced.
      tx.replaceDoc({ ...g.def, id: def.id, name: def.name });
      return { archetype: g.archetype, attempts: g.attempts, target: 'document' };
    }
    const r = ctxRect(ctx, def);
    if (!r) return null;
    const w = r[2] - r[0] + 1, d = r[3] - r[1] + 1;
    if (w < SIZE_MIN || d < SIZE_MIN) throw new Error(`gen.procgen: the selection is ${w}x${d}; the generator's minimum board is ${SIZE_MIN}x${SIZE_MIN}`);
    const g = generate({ ...opts, w, d });
    return { archetype: g.archetype, attempts: g.attempts, target: 'selection', ...pasteDef(tx, g.def, r[0], r[1]) };
  } });

export const GENERATE_TOOL_IDS = Object.freeze([...PRIMITIVE_IDS.map((id) => `gen.${id}`), 'gen.procgen']);
