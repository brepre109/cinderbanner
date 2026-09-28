// The object tools (PLAN §6.7): stamp, erase, scatter.
//
// THE STAMP'S FORM IS GENERATED FROM PROP_SPEC, not typed out here. props.js validates nothing and
// silently drops a prop it does not recognise, so a hand-written inspector that forgets `storeys` or
// spells `chimney` as `chimny` produces a house that renders wrong with no error anywhere. Emitting
// one control per PROP_SPEC field makes that class of bug impossible: every type the renderer
// supports is placeable with its real fields, and a field added to PROP_SPEC appears in the strip
// with no edit in this file.
//
// Field keys are QUALIFIED BY TYPE — 'deck.h', 'wall.h', 'pillar.h' — because the same name carries
// three different contracts across the catalogue (deck.h is a terrace step, pillar.h is a world-unit
// shaft) and one union key would have to pick one range and one default for all three. The `when`
// gate hides everything but the live type, so the strip shows a house's nine fields and a rock's one.
//
// Coordinates go through propspec.snapCoord() on every stamp, which is the cure for props.md's
// stated most common authoring bug: NW-corner integers for a rectangle, x.5/z.5 for a sprite, a raw
// world coordinate for a wall or rail on a tile boundary line.
//
// Zero three.js and zero DOM.
import { defineBrush, defineGenerator } from '../registry.js';
import { PROP_SPEC, snapCoord, propTiles } from '../../world/mapformat/propspec.js';
import { LETTERS } from '../../world/mapformat/schema.js';
import { mulberry32 } from '../../world/procgen/rng.js';
import { ctxPoint, ctxTiles } from './select.js';

export const PROP_TYPES = Object.freeze(Object.keys(PROP_SPEC).sort());
// PROP_SPEC field types name the DATA type; params.js names a widget. This is the one mapping
// between the two vocabularies (primitives/index.js says the same thing about its own schema).
const CTRL = Object.freeze({ int: 'number', number: 'number', bool: 'toggle', enum: 'enum', string: 'text' });
const optLabel = (v) => (v === null ? 'none' : String(v));
const key = (x, z) => x + ',' + z;

/** True when a tile is writable in this transaction — the SELECTION mask. Tx clips cell writes on
 *  its own, but addProp is a list op with no coordinate to clip, so every prop-placing tool asks. */
export function inMask(tx, x, z) {
  if (!tx.mask) return true;
  const w = tx.def.size.w, ix = Math.floor(x), iz = Math.floor(z);
  return ix >= 0 && iz >= 0 && ix < w && iz < tx.def.size.d && tx.mask[iz * w + ix] !== 0;
}

/** The stamp's parameter schema, one control per PROP_SPEC field. x/z are omitted: the cursor owns
 *  the coordinate and snapCoord owns its convention. @returns {Array<object>} */
export function propParamSchema() {
  const out = [{ k: 'type', type: 'prop', label: 'prop type', def: 'oak',
    hint: `${PROP_TYPES.length} types; the fields below follow the chosen one` }];
  for (const type of PROP_TYPES) for (const fd of PROP_SPEC[type].fields) {
    if (fd.k === 'x' || fd.k === 'z') continue;
    out.push({ k: `${type}.${fd.k}`, type: CTRL[fd.type] || 'text', label: fd.label || fd.k,
      min: fd.min, max: fd.max, unit: fd.units || '', def: fd.def,
      when: (v) => v.type === type,
      ...(fd.enum ? { options: fd.enum.map((e) => ({ v: e, label: optLabel(e) })) } : {}) });
  }
  return out;
}
/** Pull one type's fields back out of a flat value bag. The inverse of propParamSchema's key rule. */
export function propFieldsFrom(values) {
  const spec = PROP_SPEC[values.type], out = {};
  if (!spec) return out;
  for (const fd of spec.fields) {
    if (fd.k === 'x' || fd.k === 'z') continue;
    const v = values[`${values.type}.${fd.k}`];
    if (v !== undefined) out[fd.k] = v;
  }
  return out;
}

// Tile extent of a placement, for the in-bounds clamp below. Deliberately the AUTHORED rectangle
// (w/d, len along dir), not propspec's world extent: a clamp works on the corner the author moves.
function spanOf(type, f) {
  if (type === 'house' || type === 'tower') return [f.w ?? 1, f.d ?? 1];
  if (type === 'deck') return f.dir === 'x' ? [f.len ?? 1, f.w ?? 1] : [f.w ?? 1, f.len ?? 1];
  if (type === 'fence' || type === 'ruin') return f.dir === 'x' ? [f.len ?? 1, 1] : [1, f.len ?? 1];
  return [1, 1];
}

/**
 * Place one prop. The coordinate is SNAPPED to the type's convention and, for the NW-corner
 * rectangles, the corner is pulled back so the far edge stays on the board — house, stairs and stall
 * read `map.at(x,z).h` unguarded inside buildProps and THROW on an off-map tile (PROP_SPEC.unsafeAt).
 * @param {object} tx an open Session transaction
 * @returns {string|string[]|null} the new pid(s), or null when the mask clipped the placement
 */
export function stampProp(tx, type, x, z, fields = {}) {
  const spec = PROP_SPEC[type];
  if (!spec) throw new Error(`stampProp: unknown type '${type}' — props.js would drop it silently`);
  let [sx, sz] = snapCoord(type, x, z);
  if (spec.coord === 'nwInt') {
    const [lx, lz] = spanOf(type, fields);
    sx = Math.max(0, Math.min(tx.def.size.w - lx, sx));
    sz = Math.max(0, Math.min(tx.def.size.d - lz, sz));
  }
  if (!inMask(tx, sx, sz)) return null;
  return tx.addProp({ type, ...fields, x: sx, z: sz });
}

/** The prop under a tile, LAST first: props render in array order, so the last one drawn is the one
 *  an author means when they click a pile. Geometry, not footprint — a gate blocks nothing and is
 *  still the thing under the cursor. @returns {object|null} */
export function pickPropAt(def, x, z, match) {
  const list = def.props || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (match && p.type !== match) continue;
    if (propTiles(p).some((t) => t[0] === x && t[1] === z)) return p;
  }
  return null;
}
/** Erase the prop under a tile. @returns {string|null} the pid removed */
export function eraseAt(tx, x, z, match) {
  const p = pickPropAt(tx.def, x, z, match);
  if (!p || !inMask(tx, p.x, p.z)) return null;
  return tx.removeProp(p.pid) ? p.pid : null;
}

/** `"oak:3, pine:2, rock"` -> weighted entries. An unknown type is DROPPED rather than thrown: the
 *  mix is a text field an author types into, and a typo should cost that entry, not the stroke. */
export function parseMix(text) {
  const out = [];
  for (const part of String(text || '').split(/[,\n]/)) {
    const m = /^\s*([a-z_]+)\s*(?::\s*([0-9.]+))?\s*$/.exec(part);
    if (!m || !PROP_SPEC[m[1]]) continue;
    const wgt = m[2] === undefined ? 1 : +m[2];
    if (wgt > 0) out.push({ type: m[1], weight: wgt });
  }
  return out;
}

/**
 * Tiles decoration must never touch. The same rule Canvas keeps as its `avoid` set (PLAN §5.10),
 * re-derived from the finished document because the editor does not have the Canvas that built it:
 * spawn seats, declared face endpoints, choke tiles, route waypoints, assist tiles, and the
 * staging/road regions — the two region kinds that exist precisely to stay clear.
 * @returns {Set<string>} 'x,z' keys
 */
export function avoidSet(def) {
  const out = new Set(), D = def.design || {};
  const add = (t) => { if (Array.isArray(t)) out.add(key(t[0], t[1])); };
  for (const team of ['A', 'B']) for (const s of def.spawns?.[team] || []) add(s);
  for (const f of D.faces || []) { add(f.from); add(f.to); }
  for (const c of D.chokes || []) (c.tiles || []).forEach(add);
  for (const r of D.routes || []) (r.via || []).forEach(add);
  for (const a of D.assists || []) (a.tiles || []).forEach(add);
  for (const r of D.regions || []) {
    if (r.kind !== 'staging' && r.kind !== 'road') continue;
    const [x0, z0, x1, z1] = r.rect || [0, 0, -1, -1];
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) out.add(key(x, z));
  }
  return out;
}

/**
 * Fill a tile set with a weighted mix under a min-spacing rule. Deterministic from `seed`: the same
 * selection and the same seed produce the same scatter, so an author can re-roll on purpose and
 * never by accident.
 *
 * Spacing is CHEBYSHEV, not Euclidean — a diagonal pair of oaks reads as touching in an isometric
 * view, so the square neighbourhood is the honest one.
 * @param {object} tx open transaction
 * @param {{tiles:Array<[number,number]>, mix:Array<{type:string,weight:number}>, spacing?:number,
 *          density?:number, seed?:number, avoid?:Set<string>, water?:boolean}} o
 * @returns {{placed:Array<object>, skipped:number}}
 */
export function scatterInto(tx, o) {
  const def = tx.def, mix = (o.mix || []).filter((m) => PROP_SPEC[m.type]);
  const out = { placed: [], skipped: 0 };
  if (!mix.length || !o.tiles || !o.tiles.length) return out;
  const rnd = mulberry32((o.seed ?? 1) >>> 0);
  const spacing = Math.max(0, o.spacing ?? 2), avoid = o.avoid || new Set();
  const taken = new Set();
  for (const p of def.props || []) for (const t of propTiles(p)) taken.add(key(t[0], t[1]));
  const total = mix.reduce((s, m) => s + m.weight, 0);
  const pickType = () => { let r = rnd() * total; for (const m of mix) if ((r -= m.weight) <= 0) return m.type; return mix[mix.length - 1].type; };
  // Shuffle first, then walk: a per-tile probability test biases towards the top-left corner because
  // the spacing rule rejects everything downstream of an early hit.
  const cand = o.tiles.filter(([x, z]) => {
    const L = LETTERS[def.grid.T[z][x]];
    if (!L || (!L.walk && !o.water) || avoid.has(key(x, z)) || taken.has(key(x, z))) return false;
    return inMask(tx, x, z);
  });
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  const want = Math.round(cand.length * Math.max(0, Math.min(1, o.density ?? 0.25)));
  const placed = [];
  for (const [x, z] of cand) {
    if (placed.length >= want) break;
    if (placed.some(([px, pz]) => Math.max(Math.abs(px - x), Math.abs(pz - z)) < spacing)) { out.skipped++; continue; }
    const type = pickType(), pid = stampProp(tx, type, x, z, {});
    if (!pid) { out.skipped++; continue; }
    placed.push([x, z]); out.placed.push({ pid, type, x, z });
  }
  return out;
}

// ---- records ------------------------------------------------------------------------------------
// Each record is captured so its apply() can merge the schema's own DEFAULTS under whatever the
// options strip passes: a record fired from the keymap with no strip must behave identically to one
// fired with every control untouched.
export const STAMP = defineBrush({ id: 'prop.stamp', label: 'Stamp prop', group: 'props', key: 'p', order: 20,
  cursor: 'click', coalesce: false, channels: ['props'],
  tip: 'Place one prop with its real PROP_SPEC fields, snapped to its own coordinate convention.',
  params: propParamSchema(),
  apply(tx, ctx = {}) {
    const p = ctxPoint(ctx), v = { ...STAMP.defaults, ...(ctx.params || {}) };
    if (!p || !PROP_SPEC[v.type]) return null;
    return stampProp(tx, v.type, p.x, p.z, propFieldsFrom(v));
  } });

export const ERASE = defineBrush({ id: 'prop.erase', label: 'Erase prop', group: 'props', key: 'shift+p', order: 21,
  cursor: 'paint', channels: ['props'],
  tip: 'Remove the prop under the cursor — the topmost one, by rendered geometry rather than footprint.',
  params: [{ k: 'match', type: 'enum', label: 'only type', def: '',
    options: [{ v: '', label: 'any type' }, ...PROP_TYPES.map((t) => ({ v: t, label: t }))] }],
  apply(tx, ctx = {}) {
    const p = ctxPoint(ctx);
    return p ? eraseAt(tx, p.x, p.z, (ctx.params && ctx.params.match) || null) : null;
  } });

export const SCATTER = defineGenerator({ id: 'prop.scatter', label: 'Scatter props', group: 'props', order: 22,
  cursor: 'click', channels: ['props'],
  tip: 'Fill the selection with a weighted mix, min-spaced, keeping off spawns, faces, chokes, routes and staging.',
  params: [{ k: 'mix', type: 'text', label: 'mix', def: 'oak:3, pine:2, bush:2, rock_small:1',
    hint: 'type:weight, comma separated' },
    { k: 'density', type: 'range', label: 'density', min: 0, max: 100, def: 25, unit: '%' },
    { k: 'spacing', type: 'range', label: 'min spacing', min: 0, max: 8, def: 2, unit: 'tile' },
    { k: 'seed', type: 'number', label: 'seed', def: 1, min: 0 },
    { k: 'respectAvoid', type: 'toggle', label: 'keep off declared tiles', def: true },
    { k: 'water', type: 'toggle', label: 'allow water and void', def: false }],
  apply(tx, ctx = {}) {
    const v = { ...SCATTER.defaults, ...(ctx.params || {}) };
    return scatterInto(tx, { tiles: ctxTiles(ctx, tx.def), mix: parseMix(v.mix), spacing: v.spacing,
      density: (v.density ?? 25) / 100, seed: v.seed, water: v.water,
      avoid: v.respectAvoid === false ? new Set() : avoidSet(tx.def) });
  } });

export const PROP_TOOL_IDS = Object.freeze(['prop.stamp', 'prop.erase', 'prop.scatter']);
