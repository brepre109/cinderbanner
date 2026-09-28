// The declarative param schema and its DOM compiler (PLAN §3.6, §6.1 rule 3). A tool DECLARES its
// options — `{k:'radius', type:'range', min:1, max:12, def:2}` — and the tool-options strip is
// generated from that record. Adding a brush is therefore one registry entry and ZERO UI code, which
// is the only thing that keeps an editor with thirty tools from becoming a four-thousand-line file
// of hand-wired inputs that drift out of step with the tools they drive.
//
// The file splits cleanly in two. normalizeSchema / defaultsOf / coerce are PURE and are what
// registry.js, the keymap and tools/checks use; they run under bare `node`. buildControls is the
// only DOM-touching part and it is guarded, so importing this module in node costs nothing and
// throws only if something actually asks for a control. No three.js anywhere.
//
// Markup is exactly src/editor/editor.css's contract: .ed-field > label + control, with .ed-input,
// .ed-select, .ed-range, .ed-check, .ed-swatch, .ed-seg > button.on. Nothing here invents a class.
import { LETTERS } from '../world/mapformat/schema.js';
import { PROP_SPEC } from '../world/mapformat/propspec.js';

const DOC = typeof document !== 'undefined' ? document : null;
export const CONTROL_TYPES = Object.freeze(['number', 'range', 'enum', 'toggle', 'colour', 'text', 'tile', 'prop']);
/** Strip swatches for the tile picker: each letter's approximate mean albedo, so the picker reads as
 *  the map does. Not authoritative — terrain.js owns the real palette — but stable and legible. */
export const TILE_SWATCH = Object.freeze({ g: '#5f8a3c', k: '#3d5c2c', d: '#9a7a4e', s: '#9a9a92',
  b: '#8a6438', r: '#7d7a73', S: '#cbb27a', w: '#2f6f9e', v: '#12141c' });

const num = (v, d) => (Number.isFinite(+v) ? +v : d);
const clamp = (v, lo, hi) => (lo != null && v < lo ? lo : hi != null && v > hi ? hi : v);

/**
 * Fill in one param record's defaults and refuse the ones that cannot work. Throwing here — at
 * define time, at module load — is deliberate: a tool with a malformed `enum` should fail on the
 * boot line that registered it, not silently render an empty dropdown three panels away.
 * @param {{k:string, type?:string, label?:string, def?:any, min?:number, max?:number, step?:number,
 *          enum?:Array, options?:Array, hint?:string, unit?:string, when?:(v:object)=>boolean}} p
 */
export function normalizeParam(p) {
  if (!p || !p.k) throw new TypeError('param: `k` is required');
  const type = p.type || (p.enum || p.options ? 'enum' : typeof p.def === 'boolean' ? 'toggle' : typeof p.def === 'string' ? 'text' : 'number');
  if (!CONTROL_TYPES.includes(type)) throw new TypeError(`param '${p.k}': unknown type '${type}'`);
  const opts = type === 'tile' ? Object.keys(LETTERS).map((c) => ({ v: c, label: LETTERS[c].label, swatch: TILE_SWATCH[c] }))
    : type === 'prop' ? Object.keys(PROP_SPEC).sort().map((t) => ({ v: t, label: t }))
      : (p.options || p.enum || []).map((o) => (o && typeof o === 'object' ? o : { v: o, label: String(o) }));
  if ((type === 'enum') && !opts.length) throw new TypeError(`param '${p.k}': enum needs options`);
  const out = { k: p.k, type, label: p.label || p.k, hint: p.hint || '', unit: p.unit || '',
    min: p.min ?? null, max: p.max ?? null, step: p.step ?? (type === 'number' || type === 'range' ? 1 : null),
    options: opts, when: typeof p.when === 'function' ? p.when : null,
    def: p.def !== undefined ? p.def : type === 'toggle' ? false : type === 'text' ? '' : type === 'colour' ? '#ffffff'
      : opts.length ? opts[0].v : clamp(0, p.min ?? null, p.max ?? null) };
  return Object.freeze(out);
}
/** @param {Array} params @returns {ReadonlyArray} */
export function normalizeSchema(params) {
  const out = (params || []).map(normalizeParam), seen = new Set();
  for (const p of out) { if (seen.has(p.k)) throw new TypeError(`param '${p.k}': duplicate key`); seen.add(p.k); }
  return Object.freeze(out);
}
export function defaultsOf(schema) {
  const out = {};
  for (const p of schema) out[p.k] = p.def;
  return out;
}
/**
 * Force a loose value bag onto the schema: numbers clamped to their range and snapped to `step`,
 * enums that are not in the list replaced by the default, toggles to booleans. Every value the UI
 * hands a tool goes through this, so `apply()` never has to defend itself, and so a params object
 * restored from a stale localStorage slot cannot poison a brush.
 */
export function coerce(schema, values = {}) {
  const out = {};
  for (const p of schema) {
    const v = values[p.k];
    if (v === undefined) { out[p.k] = p.def; continue; }
    if (p.type === 'toggle') out[p.k] = !!v;
    else if (p.type === 'number' || p.type === 'range') {
      const n = clamp(num(v, p.def), p.min, p.max);
      out[p.k] = p.step ? Math.round(n / p.step) * p.step : n;
    } else if (p.type === 'text' || p.type === 'colour') out[p.k] = String(v);
    else out[p.k] = p.options.some((o) => o.v === v) ? v : p.def;
  }
  return out;
}
/** Which params are live given the current values — `when` gates a field on another field. */
export function visible(schema, values) { return schema.filter((p) => !p.when || p.when(values)); }

// ---- DOM ---------------------------------------------------------------------------------------
const el = (tag, cls, txt) => { const n = DOC.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };

/**
 * Compile a schema into a live control group.
 * @param {ReadonlyArray} schema from normalizeSchema()
 * @param {object} values current values (coerced on the way in)
 * @param {(k:string, v:any, all:object)=>void} onChange fired on every edit, after coercion
 * @param {{compact?:boolean}} [opts]
 * @returns {{el:HTMLElement, get:()=>object, set:(v:object)=>void, refresh:()=>void, destroy:()=>void}}
 */
export function buildControls(schema, values, onChange, opts = {}) {
  if (!DOC) throw new Error('buildControls: no document — this is the DOM half of params.js');
  const state = coerce(schema, values);
  const root = el('div', 'ed-params');
  const fields = new Map();
  const emit = (k) => { if (onChange) onChange(k, state[k], state); refresh(); };
  const setVal = (k, v) => { const c = coerce(schema, { ...state, [k]: v }); state[k] = c[k]; emit(k); };
  for (const p of schema) {
    const f = el('div', 'ed-field');
    if (p.type !== 'toggle') f.append(el('label', null, p.unit ? `${p.label} (${p.unit})` : p.label));
    const ctl = control(p, state, setVal);
    f.append(ctl.el);
    if (p.hint && !opts.compact) f.append(el('span', 'ed-hint', p.hint));
    fields.set(p.k, { f, ctl });
    root.append(f);
  }
  // `when` gates a field on another field's value, so a brush can carry a mode switch without the
  // strip growing a second row of controls that only apply half the time.
  function refresh() {
    const live = new Set(visible(schema, state).map((p) => p.k));
    for (const [k, { f, ctl }] of fields) { f.classList.toggle('ed-hide', !live.has(k)); ctl.sync(state[k]); }
  }
  refresh();
  return { el: root, get: () => ({ ...state }), refresh,
    set: (v) => { Object.assign(state, coerce(schema, { ...state, ...v })); refresh(); },
    destroy: () => { root.remove(); fields.clear(); } };
}

// One control per type. Each returns {el, sync(v)} — sync is what makes `set()` and `when` work
// without rebuilding the DOM, which matters because the strip is rebuilt on every tool switch and
// a rebuild mid-drag would drop the pointer capture.
function control(p, state, setVal) {
  const v0 = state[p.k];
  if (p.type === 'toggle') {
    const lab = el('label', 'ed-check'), box = DOC.createElement('input');
    box.type = 'checkbox'; box.checked = !!v0;
    box.addEventListener('change', () => setVal(p.k, box.checked));
    lab.append(box, el('span', null, p.label));
    return { el: lab, sync: (v) => { box.checked = !!v; } };
  }
  // A range and a colour each need two elements. They go into the field as SIBLINGS, via a fragment,
  // rather than inside a nested .ed-field — the class contract's fields are a flat list, and a
  // panel that counts .ed-field to lay out the strip must not see one field as two.
  if (p.type === 'range') {
    const frag = DOC.createDocumentFragment(), r = DOC.createElement('input'), out = el('span', 'ed-num');
    r.type = 'range'; r.className = 'ed-range';
    if (p.min != null) r.min = p.min; if (p.max != null) r.max = p.max; if (p.step) r.step = p.step;
    r.value = v0; out.textContent = v0;
    r.addEventListener('input', () => setVal(p.k, +r.value));
    frag.append(r, out);
    return { el: frag, sync: (v) => { r.value = v; out.textContent = v; } };
  }
  if (p.type === 'number') {
    const n = DOC.createElement('input');
    n.type = 'number'; n.className = 'ed-input'; n.value = v0;
    if (p.min != null) n.min = p.min; if (p.max != null) n.max = p.max; if (p.step) n.step = p.step;
    n.addEventListener('change', () => setVal(p.k, n.value));
    return { el: n, sync: (v) => { if (DOC.activeElement !== n) n.value = v; } };
  }
  if (p.type === 'colour') {
    const frag = DOC.createDocumentFragment(), c = DOC.createElement('input'), sw = el('i', 'ed-swatch');
    c.type = 'color'; c.className = 'ed-input'; c.value = v0; sw.style.background = v0;
    c.addEventListener('input', () => { sw.style.background = c.value; setVal(p.k, c.value); });
    frag.append(sw, c);
    return { el: frag, sync: (v) => { c.value = v; sw.style.background = v; } };
  }
  if (p.type === 'text') {
    const t = DOC.createElement('input');
    t.type = 'text'; t.className = 'ed-input'; t.value = v0;
    t.addEventListener('change', () => setVal(p.k, t.value));
    return { el: t, sync: (v) => { if (DOC.activeElement !== t) t.value = v; } };
  }
  // tile is the one picker worth spelling as buttons: it is chosen constantly, its options are nine,
  // and a colour swatch per letter is the whole point. Everything else with options is a select.
  if (p.type === 'tile' || (p.type === 'enum' && p.options.length <= 6 && p.options.every((o) => String(o.label).length <= 8))) {
    const seg = el('div', 'ed-seg'), btns = new Map();
    for (const o of p.options) {
      const b = el('button', null, p.type === 'tile' ? o.v : o.label);
      b.title = o.label;
      if (o.swatch) { const sw = el('i', 'ed-swatch'); sw.style.background = o.swatch; b.prepend(sw); }
      b.addEventListener('click', () => setVal(p.k, o.v));
      btns.set(o.v, b); seg.append(b);
    }
    return { el: seg, sync: (v) => { for (const [k, b] of btns) b.classList.toggle('on', k === v); } };
  }
  const sel = el('select', 'ed-select');
  for (const o of p.options) { const op = el('option', null, o.label); op.value = String(o.v); sel.append(op); }
  sel.value = String(v0);
  // Option values arrive back from the DOM as strings; map through the option list so a numeric
  // enum (storeys: [1,2]) does not hand a brush the string '2'.
  sel.addEventListener('change', () => setVal(p.k, (p.options.find((o) => String(o.v) === sel.value) || { v: p.def }).v));
  return { el: sel, sync: (v) => { sel.value = String(v); } };
}
