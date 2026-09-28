// The plugin registry (PLAN §6.1 rule 3). Brushes, tools, generators and panels are RECORDS, not
// code the shell knows about: the tool rail, the options strip, the menus, the keymap, the layer
// locking and the dirty-channel scheduling are all generated from what a record declares. Adding a
// tool is one `defineBrush({...})` in one file and zero edits anywhere else — which is the only
// discipline that stops an editor with thirty tools from becoming four thousand lines of shell.
//
// Ids are unique GLOBALLY, not per kind, because everything downstream addresses a record by id
// alone: the keymap binds 'height.raise', a menu item names it, a saved workspace restores it, and
// window.__EDITOR__.run(id, params) drives it from a headless test. Two records sharing an id would
// make every one of those ambiguous, so define() refuses at module-load time.
//
// Zero three.js and zero DOM: a record's `apply` sees only a Tx and a context. Panels carry a
// `mount` that touches the DOM, but registering one does not call it.
import { normalizeSchema, defaultsOf, coerce } from './params.js';

export const KINDS = Object.freeze(['brush', 'tool', 'generator', 'panel']);
// How the viewport interprets pointer input for a record. The picking layer reads this; nothing
// else does. 'paint' is the per-move stroke, and it is the only one that coalesces by default.
export const CURSORS = Object.freeze(['paint', 'line', 'drag-rect', 'poly', 'click', 'none']);

const REG = new Map(KINDS.map((k) => [k, new Map()]));
const BY_ID = new Map();

/**
 * @param {'brush'|'tool'|'generator'|'panel'} kind
 * @param {{id:string, label?:string, group?:string, icon?:string, tip?:string, key?:string,
 *          params?:Array, channels?:string[], cursor?:string, coalesce?:boolean, order?:number,
 *          when?:(ctx:object)=>boolean, apply?:(tx:object, ctx:object)=>any,
 *          run?:(session:object, ctx:object)=>any, mount?:(host:any, ctx:object)=>any}} rec
 * @returns {Readonly<object>} the frozen record, so a caller can keep a direct handle
 */
export function define(kind, rec) {
  if (!REG.has(kind)) throw new TypeError(`define: unknown kind '${kind}'`);
  if (!rec || typeof rec.id !== 'string' || !rec.id) throw new TypeError(`define(${kind}): id is required`);
  if (BY_ID.has(rec.id)) throw new Error(`define(${kind}): duplicate id '${rec.id}' (already a ${BY_ID.get(rec.id).kind})`);
  if (rec.cursor && !CURSORS.includes(rec.cursor)) throw new TypeError(`define(${rec.id}): unknown cursor '${rec.cursor}'`);
  // The one structural requirement per kind. Everything else is optional and defaulted, so a record
  // stays a few lines; what a record MUST have is the entry point its host will call.
  const needs = kind === 'panel' ? 'mount' : kind === 'tool' ? null : 'apply';
  if (needs && typeof rec[needs] !== 'function') throw new TypeError(`define(${rec.id}): ${kind} needs ${needs}()`);
  if (kind === 'tool' && typeof rec.run !== 'function' && typeof rec.apply !== 'function') throw new TypeError(`define(${rec.id}): tool needs run() or apply()`);
  const params = normalizeSchema(rec.params);
  const out = Object.freeze({
    ...rec, kind, id: rec.id, label: rec.label || rec.id, group: rec.group || kind,
    icon: rec.icon || '', tip: rec.tip || '', key: rec.key || null, order: rec.order ?? 100,
    params, defaults: Object.freeze(defaultsOf(params)),
    channels: Object.freeze([...(rec.channels || [])]),
    cursor: rec.cursor || (kind === 'brush' ? 'paint' : 'click'),
    // A stroke coalesces into one undo entry; a discrete action does not. Painting is a stroke,
    // stamping a prop is not — so the default follows the cursor rather than the kind.
    coalesce: rec.coalesce ?? (rec.cursor || (kind === 'brush' ? 'paint' : 'click')) === 'paint',
    when: rec.when || null,
  });
  REG.get(kind).set(out.id, out);
  BY_ID.set(out.id, out);
  return out;
}

export const defineBrush = (rec) => define('brush', rec);
export const defineTool = (rec) => define('tool', rec);
export const defineGenerator = (rec) => define('generator', rec);
export const definePanel = (rec) => define('panel', rec);

/** By id, regardless of kind — the form the keymap and window.__EDITOR__.run() use. */
export function byId(id) { return BY_ID.get(id) || null; }
export function get(kind, id) { const m = REG.get(kind); return (m && m.get(id)) || null; }
export function has(id) { return BY_ID.has(id); }
/** Records of one kind, in declared `order` then label — the order the rail and menus render in. */
export function list(kind, filter) {
  const m = REG.get(kind);
  if (!m) throw new TypeError(`list: unknown kind '${kind}'`);
  let out = [...m.values()];
  if (filter && filter.group) out = out.filter((r) => r.group === filter.group);
  if (filter && filter.ctx) out = out.filter((r) => !r.when || r.when(filter.ctx));
  return out.sort((a, b) => (a.order - b.order) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}
/** Distinct groups of a kind, in first-declared order — the rail's separators come from this. */
export function groups(kind) {
  const seen = [];
  for (const r of list(kind)) if (!seen.includes(r.group)) seen.push(r.group);
  return seen;
}
export function all() { return [...BY_ID.values()]; }
/** Every record's key hint, for keymap.js's boot-time duplicate assert. */
export function keyHints() { return all().filter((r) => r.key).map((r) => ({ id: r.id, key: r.key })); }
/** Coerce a loose value bag against a record's own schema. The ONE place a tool's params are made
 *  safe, so `apply()` never defends itself and a stale saved workspace cannot poison a brush. */
export function paramsFor(rec, values) { return coerce(rec.params, values); }
/** Test-only: drop every record. Module-scope define() calls run once per import, so a test that
 *  re-imports must reset rather than collide. */
export function reset() { for (const m of REG.values()) m.clear(); BY_ID.clear(); }
