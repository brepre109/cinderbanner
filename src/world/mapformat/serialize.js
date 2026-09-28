// Canonical text form. A map is stored as an ES MODULE, not as json, so it stays greppable, diffable
// and reviewable in git: `grep -n "type: 'deck'" src/world/maps/*.js` has to keep working. The layout
// is therefore load-bearing, not cosmetic — one H row and one T row and one prop per line means a
// one-tile edit is a one-line diff, and the fixed key order (schema.KEY_ORDER) means two saves of the
// same document are byte-identical, which is what makes the undo property test (hash equality after
// undo-all) and CI drift detection possible at all.
// parseDef reads that shape back with a small literal parser rather than eval/new Function: an editor
// under a CSP cannot call either, and a map file is data even though it is spelled as code.
// Zero three.js: runs under bare `node` for tools/mapcheck.mjs.
import { KEY_ORDER, DESIGN_KEY_ORDER, FORMAT, SCHEMA_VERSION, migrate } from './schema.js';
import { PROP_SPEC } from './propspec.js';

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const esc = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}'`;
const key = (k) => (IDENT.test(k) ? k : esc(k));           // 'x-' is the one key that needs quoting
// String(n) is the shortest round-tripping form of a JS double, so the text and the value stay in
// lockstep across any number of save/load cycles. -0 canonicalises to 0 on the first write.
const numOf = (n) => (Object.is(n, -0) ? '0' : String(n));
// EVERY number written into the file goes through num(), never through numOf(): String(NaN) is the
// bare token `NaN` and String(Infinity) is `Infinity`, and the literal parser below reads neither, so
// one poisoned height or baseTier would make stringifyDef write a save file parseDef cannot open. A
// non-finite number is written as null, which normalizeDef then repairs to the default and REPORTS —
// a lossy save that reads back beats a faithful one that does not.
const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? numOf(n) : 'null');
// The header is a // COMMENT, and a map's name is free text that lands in it. esc() cannot help here:
// a line terminator would close the comment and promote the rest of the name to source, so parseDef
// would read a document nobody wrote, with no error. \u2028/\u2029 are line terminators to a real ES
// module loader even though our own parser stops only at \n, so all four go.
const comment = (s) => String(s).replace(/[\r\n\u2028\u2029]+/g, ' ').slice(0, 120);
/** One-line literal. Everything it is used on (a prop, a design record, a pair list) is small by
 *  construction; the big grids get their own writers below. */
function lit(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return num(v);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return esc(v);
  if (Array.isArray(v)) return `[${v.map(lit).join(', ')}]`;
  const ks = Object.keys(v).filter((k) => v[k] !== undefined);
  return ks.length ? `{ ${ks.map((k) => `${key(k)}: ${lit(v[k])}`).join(', ')} }` : '{}';
}
// Long flat lists (deck grants, spawn tables, route waypoints) wrap instead of running to column 900.
function wrapList(items, pad, width = 108) {
  if (!items.length) return '[]';
  const parts = items.map(lit), lines = []; let cur = '';
  for (let i = 0; i < parts.length; i++) {
    const piece = parts[i] + (i === parts.length - 1 ? '' : ',');
    if (cur && `${cur} ${piece}`.length + pad.length > width) { lines.push(cur); cur = piece; } else cur = cur ? `${cur} ${piece}` : piece;
  }
  if (cur) lines.push(cur);
  return lines.length === 1 ? `[${lines[0]}]` : `[\n${lines.map((l) => pad + '  ' + l).join('\n')}\n${pad}]`;
}
// Field order inside a prop: identity, then the type's own PROP_SPEC order (so every house reads
// w,d,rot,storeys,... in the same columns), then anything the schema does not know, alphabetically.
function propKeys(p) {
  const s = PROP_SPEC[p.type], head = ['pid', 'type'].filter((k) => p[k] !== undefined);
  const own = (s ? s.fields.map((f) => f.k) : ['x', 'z']).filter((k) => p[k] !== undefined);
  const seen = new Set([...head, ...own]);
  return [...head, ...own, ...Object.keys(p).filter((k) => !seen.has(k) && p[k] !== undefined).sort()];
}
const DESIGN_PRIORITY = ['fid', 'cid', 'rid', 'rgid', 'aid', 'from', 'to', 'at', 'tiles', 'via', 'rect',
  'drop', 'tier', 'kind', 'dir', 'bridges', 'minSaving', 'minTurnSaving', 'savesTurns', 'code', 'why', 'note'];
function recKeys(r) {
  const head = DESIGN_PRIORITY.filter((k) => r[k] !== undefined);
  return [...head, ...Object.keys(r).filter((k) => !head.includes(k) && r[k] !== undefined).sort()];
}
const objLine = (o, ks) => `{ ${ks.map((k) => `${key(k)}: ${lit(o[k])}`).join(', ')} }`;

/**
 * Deterministic ES-module source for a MapDef. Same document in, same bytes out, always.
 * @param {import('./schema.js').MapDef} def
 * @returns {string}
 */
export function stringifyDef(def) {
  const d = toPlain(def) || {}, L = [];   // one defensive copy: see toPlain — the writer must be total
  L.push(`// ${comment(d.name || d.id || 'untitled')} — id '${comment(d.id || 'untitled')}'. ${FORMAT} v${comment(d.version ?? SCHEMA_VERSION)}, content hash ${hashDef(d)}.`);
  L.push('// Written by stringifyDef(). Hand-edit freely: one H row, one T row and one prop per line,');
  L.push('// so a one-tile change is a one-line diff. Key order is fixed by schema.KEY_ORDER.');
  L.push('export const DEF = {');
  for (const k of KEY_ORDER) {
    if (k === 'grid') { L.push(...gridBlock(d.grid)); continue; }
    if (k === 'props') { L.push(...listBlock('props', d.props, (p) => objLine(p, propKeys(p)))); continue; }
    if (k === 'spawns') { L.push(...spawnBlock(d.spawns)); continue; }
    if (k === 'decks') { L.push(...decksBlock(d.decks)); continue; }
    if (k === 'design') { L.push(...designBlock(d.design)); continue; }
    if (k === 'brief') { L.push(...briefBlock(d.brief)); continue; }
    L.push(`  ${key(k)}: ${lit(d[k] === undefined ? null : d[k])},`);
  }
  L.push('};');
  L.push('export default DEF;');
  return L.join('\n') + '\n';
}
// H is written as aligned columns: a terrace reads as a shape in the file, and a diff of a height
// edit lines up under the tile it changed. T rows are already fixed width by construction.
function gridBlock(g) {
  const H = Array.isArray(g?.H) ? g.H : [], T = Array.isArray(g?.T) ? g.T : [];
  let w = 1;
  for (const row of H) for (const v of (row || [])) w = Math.max(w, num(v).length);
  const out = ['  grid: {', '    // H[z][x] — integer height in h steps (rules.js HEIGHT_STEP = 2; render is h * 0.25).', '    H: ['];
  for (const row of H) out.push(`      [${(row || []).map((v) => num(v).padStart(w)).join(', ')}],`);
  out.push('    ],', "    // T[z][x] — one letter per tile: g k d s b r S(sand) w(water) v(void).", '    T: [');
  for (const row of T) out.push(`      ${esc(row)},`);
  out.push('    ],', '  },');
  return out;
}
function listBlock(name, list, render, indent = '  ') {
  const arr = Array.isArray(list) ? list : [];
  if (!arr.length) return [`${indent}${key(name)}: [],`];
  return [`${indent}${key(name)}: [`, ...arr.map((v) => `${indent}  ${render(v)},`), `${indent}],`];
}
// ORDER IS SIGNIFICANT: main.js index-matches spawns[team][i] to roster[team][i], so slot 0 is where
// the first class deploys. The comment ships with the map so nobody reorders these by accident.
function spawnBlock(sp) {
  const out = ['  // 5 per team, ORDER SIGNIFICANT: slot i deploys roster[team][i].', '  spawns: {'];
  for (const t of ['A', 'B']) out.push(`    ${t}: ${wrapList(Array.isArray(sp?.[t]) ? sp[t] : [], '    ')},`);
  out.push('  },');
  return out;
}
function decksBlock(dk) {
  const mode = dk?.mode ?? 'auto', tiles = Array.isArray(dk?.tiles) ? dk.tiles : [];
  if (mode === 'auto' && !tiles.length) return ["  decks: { mode: 'auto', tiles: [] },"];
  return ['  decks: {', `    mode: ${esc(mode)},`, `    tiles: ${wrapList(tiles, '    ')},`, '  },'];
}
function designBlock(ds) {
  const d = ds || {}, out = ['  design: {'];
  // `?? 4` only for an ABSENT baseTier: a present-but-unwritable one (toPlain has already turned a NaN
  // into null) is written as null so the file is a fixed point — hashDef canonicalises both to null,
  // and normalizeDef repairs the null back to the default with a coercion the author can see.
  out.push(`    baseTier: ${num(d.baseTier === undefined ? 4 : d.baseTier)},`);
  out.push(`    tiers: ${lit(Array.isArray(d.tiers) ? d.tiers : [])},`);
  for (const k of DESIGN_KEY_ORDER.slice(2)) out.push(...listBlock(k, d[k], (r) => objLine(r, recKeys(r)), '    '));
  out.push('  },');
  return out;
}
function briefBlock(b) {
  return ['  brief: {', `    blurb: ${esc(b?.blurb ?? '')},`, `    notes: ${esc(b?.notes ?? '')},`, '  },'];
}

// ---- reading back -------------------------------------------------------------------------------
// A literal parser, not eval: it accepts exactly what stringifyDef writes (and plain JSON, which is a
// subset) — objects, arrays, numbers, single/double-quoted strings, true/false/null, bare identifier
// keys, trailing commas and // and /* */ comments. Anything else is a SyntaxError with an offset,
// which is what the editor's import panel shows.
function ws(st) {
  const s = st.s;
  for (;;) {
    while (st.i < s.length && /\s/.test(s[st.i])) st.i++;
    if (s[st.i] === '/' && s[st.i + 1] === '/') { while (st.i < s.length && s[st.i] !== '\n') st.i++; continue; }
    if (s[st.i] === '/' && s[st.i + 1] === '*') { const e = s.indexOf('*/', st.i + 2); st.i = e < 0 ? s.length : e + 2; continue; }
    return;
  }
}
const fail = (st, msg) => { throw new SyntaxError(`${msg} at offset ${st.i}`); };
function value(st) {
  ws(st);
  const s = st.s, c = s[st.i];
  if (c === undefined) fail(st, 'unexpected end of input');
  if (c === '{') return object(st);
  if (c === '[') return array(st);
  if (c === "'" || c === '"') return string(st);
  if (s.startsWith('true', st.i)) { st.i += 4; return true; }
  if (s.startsWith('false', st.i)) { st.i += 5; return false; }
  if (s.startsWith('null', st.i)) { st.i += 4; return null; }
  if (s.startsWith('undefined', st.i)) { st.i += 9; return null; }
  const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(st.i));
  if (m) { st.i += m[0].length; return Number(m[0]); }
  return fail(st, `unexpected character '${c}'`);
}
function object(st) {
  st.i++; const out = {};
  for (;;) {
    ws(st);
    if (st.s[st.i] === '}') { st.i++; return out; }
    let k;
    const c = st.s[st.i];
    if (c === "'" || c === '"') k = string(st);
    else { const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(st.s.slice(st.i)); if (!m) fail(st, 'expected a key'); k = m[0]; st.i += m[0].length; }
    ws(st);
    if (st.s[st.i] !== ':') fail(st, "expected ':'");
    st.i++;
    out[k] = value(st);
    ws(st);
    if (st.s[st.i] === ',') { st.i++; continue; }
    if (st.s[st.i] === '}') { st.i++; return out; }
    fail(st, "expected ',' or '}'");
  }
}
function array(st) {
  st.i++; const out = [];
  for (;;) {
    ws(st);
    if (st.s[st.i] === ']') { st.i++; return out; }
    out.push(value(st));
    ws(st);
    if (st.s[st.i] === ',') { st.i++; continue; }
    if (st.s[st.i] === ']') { st.i++; return out; }
    fail(st, "expected ',' or ']'");
  }
}
const ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
function string(st) {
  const q = st.s[st.i++]; let out = '';
  while (st.i < st.s.length) {
    const c = st.s[st.i++];
    if (c === q) return out;
    if (c !== '\\') { out += c; continue; }
    const e = st.s[st.i++];
    if (e === 'u') { out += String.fromCharCode(parseInt(st.s.slice(st.i, st.i + 4), 16)); st.i += 4; }
    else out += (ESCAPES[e] ?? e);
  }
  return fail(st, 'unterminated string');
}
// Skip whatever module preamble precedes the literal (`export const DEF =`). ws() runs before every
// step, so comments are stepped over rather than scanned into; the preamble contains no strings.
function rootOf(text) {
  const st = { s: text, i: 0 };
  for (;;) { ws(st); const c = st.s[st.i]; if (c === undefined || c === '{' || c === '[') return st; st.i++; }
}

/**
 * Read a MapDef from module source, JSON text, or an object. Migrates when it can; a document that is
 * not a MapDef at all is returned as parsed, because normalizeDef() is the layer that repairs it and
 * throwing here would lose the very content the author wants to fix.
 * @param {string|object} input @returns {object}
 */
export function parseDef(input) {
  const raw = typeof input === 'string' ? value(rootOf(input)) : input;
  if (!raw || typeof raw !== 'object') throw new SyntaxError('parseDef: document is not an object');
  try { return migrate(raw); } catch { return raw; }
}
/** FNV-1a (32-bit) over a key-sorted canonical form. `analysis` is excluded — it is a derived cache
 *  whose own `hash` field is this value, so including it would be self-referential. Everything else,
 *  `x-` included, is content: the undo property test hashes a document to prove it came back. */
export function hashDef(def) {
  const src = toPlain(def) || {}; delete src.analysis;
  const s = JSON.stringify(canon(src));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = canon(v[k]); return o; }
  return typeof v === 'number' && !Number.isFinite(v) ? null : v;
}
/** JSON form for localStorage and the editor clipboard. Keys are written in KEY_ORDER so a slot diff
 *  reads the same way a module diff does. */
export function toJson(def) {
  const d = toPlain(def) || {}, out = {};
  for (const k of KEY_ORDER) if (d[k] !== undefined) out[k] = d[k];
  for (const k of Object.keys(d)) if (!(k in out)) out[k] = d[k];
  return JSON.stringify(out, null, 2);
}
export function fromJson(text) { return parseDef(JSON.parse(text)); }

/** Deep copy restricted to what this writer — and JSON — can actually express. A cycle, a runaway
 *  nesting depth, a function and a non-finite number all become null; `undefined` stays undefined so
 *  that absent optional fields stay ABSENT (propKeys/lit skip them); '__proto__' is never carried as
 *  a key. Every entry point above starts with one of these, so no document can make stringifyDef,
 *  hashDef or toJson throw: a def the toolchain cannot save is as lossy as a def with fields dropped,
 *  and an editor's live object graph is cyclic by construction. normalizeDef() also runs its input
 *  through this, so a normalized def is plain before any writer ever sees it.
 *  Depth 256 is a runaway stop, not a schema bound — a real MapDef nests six deep. */
export function toPlain(v, seen = new Set(), depth = 0) {
  const t = typeof v;
  if (v === null || t === 'string' || t === 'boolean' || t === 'undefined') return v;
  if (t === 'number') return Number.isFinite(v) ? v : null;
  if (t !== 'object' || seen.has(v) || depth > 256) return null;
  const out = Array.isArray(v) ? [] : {};
  seen.add(v);
  for (const k of Object.keys(v)) if (k !== '__proto__') out[k] = toPlain(v[k], seen, depth + 1);
  seen.delete(v);
  return out;
}

/** @returns {string[]} failures; empty means text form and value form still agree. */
export function selfTest(def) {
  const bad = [], a = stringifyDef(def);
  const b = stringifyDef(parseDef(a));
  if (a !== b) { const i = [...a].findIndex((c, n) => c !== b[n]); bad.push(`round trip not byte-stable at offset ${i}: ${JSON.stringify(a.slice(i, i + 60))} vs ${JSON.stringify(b.slice(i, i + 60))}`); }
  if (hashDef(def) !== hashDef(parseDef(a))) bad.push('hashDef did not survive the round trip');
  if (stringifyDef(fromJson(toJson(def))) !== a) bad.push('json round trip diverged from the module round trip');
  return bad;
}
if (typeof process !== 'undefined' && process.argv?.[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { blankDef } = await import('./schema.js');
  const bad = selfTest(blankDef({ w: 12, d: 10, id: 'probe', name: 'Probe' }));
  console.log(bad.length ? bad.join('\n') : 'serialize OK — module round trip byte-stable, hash stable');
  process.exit(bad.length ? 1 : 0);
}
