// The clamp-everything importer. normalizeDef() is the ONE door every read comes through — a file, a
// paste, a localStorage slot, a the prototype json, a hand-edited module someone got wrong — and it must never
// throw, because the alternative is an editor that opens on a white screen instead of on a repairable
// map. Every change is REPORTED and unknown top-level keys are kept verbatim under `x-`: the prototype's
// sanitizeMap() silently dropped `decks` and destroyed twinspan.json on round trip, and an importer
// that discards without saying so is a data-loss bug. Zero three.js — runs under bare `node`.
import { FORMAT, SCHEMA_VERSION, SIZE_MIN, SIZE_MAX, LETTERS, LETTER_OF_ENGINE, DEFAULTS, ID_RE, H_MIN,
  H_MAX, TIER_KINDS, REGION_KINDS, ASSIST_KINDS, DECK_MODES, TEAMS, KEY_ORDER, DESIGN_KEY_ORDER,
  blankDef, migrate } from './schema.js';
import { PROP_SPEC } from './propspec.js';
import { toPlain } from './serialize.js';   // the definition of "a document the toolchain can save"
// A 48x48 grid of garbage would otherwise emit 2304 identical records; the tail is summarised instead.
const MAX_COERCIONS = 400;
const brief = (v) => {
  const t = typeof v;
  if (v === undefined || v === null || t === 'number' || t === 'boolean') return v === undefined ? null : v;
  if (t === 'string') return v.length > 60 ? `${v.slice(0, 57)}...` : v;
  try { return Array.isArray(v) ? `[${v.length} items]` : t === 'object' ? `{${Object.keys(v).slice(0, 4).join(',')}}` : String(t); } catch { return '{object}'; }
};
function reporter() {
  const list = []; let dropped = 0;
  return { list, note(path, from, to, why) { if (list.length < MAX_COERCIONS) list.push({ path, from: brief(from), to: brief(to), why }); else dropped++; },
    close() { if (dropped) list.push({ path: '$', from: `${dropped} more`, to: null, why: `coercion list capped at ${MAX_COERCIONS}` }); return list; } };
}
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null));
// One malformed subtree must not cost the rest of the document.
const safe = (R, path, fn) => { try { fn(); } catch (e) { R.note(path, 'threw', 'section skipped', String((e && e.message) || e)); } };
/** @param {any} input anything at all — a MapDef, a JSON string, a the prototype map, null, a number
 *  @returns {{def:import('./schema.js').MapDef, coercions:Array<{path:string,from:any,to:any,why:string}>}} */
export function normalizeDef(input) {
  const R = reporter();
  let raw = {};
  safe(R, '$', () => {
    let v = input;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { R.note('$', 'string', '{}', 'not parseable JSON — use parseDef() for module source'); v = {}; } }
    if (isObj(v)) raw = toPlain(v); else R.note('$', v, '{}', 'document is not an object');   // plain copy: saveable output
  });
  // Lift an older schema version first, so the field passes below only ever see current-shaped data.
  safe(R, 'version', () => {
    if (raw.format === FORMAT && Number.isInteger(raw.version) && raw.version > 0 && raw.version < SCHEMA_VERSION) {
      const up = migrate(raw); R.note('version', raw.version, up.version, 'migrated to the current schema'); raw = up;
    }
  });
  const def = blankDef();
  // size runs before grid/props/spawns: every later pass clamps against def.size, so a bad extent
  // must be settled first or a 48-row import would be silently truncated to the default 20.
  const passes = [['identity', identity], ['size', size], ['grid', grid], ['props', props], ['spawns', spawns],
    ['decks', decks], ['design', design], ['brief', brieftext], ['gen', provenance], ['x-', extras]];
  for (const [name, fn] of passes) safe(R, name, () => fn(def, raw, R));
  return { def, coercions: R.close() };
}
// gen is provenance (a map is reproducible from its seed alone), analysis a regenerable cache.
function provenance(def, raw, R) {
  def.gen = isObj(raw.gen) ? { ...raw.gen } : null; def.analysis = isObj(raw.analysis) ? { ...raw.analysis } : null;
  if (raw.gen !== undefined && raw.gen !== null && def.gen === null) R.note('gen', raw.gen, null, 'gen must be an object or null');
}
function identity(def, raw, R) {
  if (raw.format !== FORMAT) R.note('format', raw.format, FORMAT, 'not a cinderbanner.mapdef document');
  if (raw.version !== SCHEMA_VERSION) R.note('version', raw.version, SCHEMA_VERSION, 'stamped to this build');
  def.format = FORMAT; def.version = SCHEMA_VERSION;
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (ID_RE.test(id)) def.id = id;
  else { def.id = slug(id); R.note('id', raw.id, def.id, 'id must match ^[a-z][a-z0-9_]{1,47}$ and equal the filename stem'); }
  const nm = typeof raw.name === 'string' ? raw.name.replace(/[\r\n\u2028\u2029\t]+/g, ' ').slice(0, 120) : '';
  if (nm.trim()) { def.name = nm; if (nm !== raw.name) R.note('name', raw.name, nm, 'name is a single-line display string, 120 chars'); }
  else if (raw.name !== undefined) R.note('name', raw.name, def.name, 'name must be a non-empty string');
  if (typeof raw.author === 'string' && raw.author) def.author = raw.author.slice(0, 60);   // provenance only
}
// Filename-stem safe. Never interpolated into an import() specifier (mapregistry holds explicit thunks),
// but a '../' surviving into a localStorage slot key would still be a footgun.
function slug(s) {
  let out = String(s || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!out) return 'untitled';
  out = (/^[a-z]/.test(out) ? out : `m_${out}`).slice(0, 48).replace(/_+$/, '');
  return out.length >= 2 ? out : `${out}_map`;   // ID_RE needs 2..48 chars, so a 1-char stem is padded
}
// Size is inferred from the grid when missing or absurd: a the prototype-shaped import carries its extent only
// in the row counts, and a wrong `size` here would truncate the whole map below.
function size(def, raw, R) {
  const s = isObj(raw.size) ? raw.size : {};
  const rows = Array.isArray(raw?.grid?.H) ? raw.grid.H : (Array.isArray(raw?.grid?.T) ? raw.grid.T : []);
  const guessD = rows.length, guessW = rows.reduce((m, r) => Math.max(m, typeof r === 'string' ? r.length : (Array.isArray(r) ? r.length : 0)), 0);
  for (const [k, guess] of [['w', guessW], ['d', guessD]]) {
    let v = fin(s[k]);
    if (v === null || !Number.isInteger(v) || v < SIZE_MIN || v > SIZE_MAX) {
      const from = s[k];
      v = clamp(Math.round(v ?? guess) || DEFAULTS.size[k], SIZE_MIN, SIZE_MAX);
      R.note(`size.${k}`, from, v, from === undefined ? `absent — inferred from the grid, clamped to ${SIZE_MIN}..${SIZE_MAX}` : `outside ${SIZE_MIN}..${SIZE_MAX}`);
    }
    def.size[k] = v;
  }
  const b = blankDef({ w: def.size.w, d: def.size.d }); def.grid = b.grid; def.spawns = b.spawns;   // blank grids and spawn seats reshaped to the settled extent
}
function grid(def, raw, R) {
  const { w: W, d: D } = def.size, g = isObj(raw.grid) ? raw.grid : {}, H = Array.isArray(g.H) ? g.H : [], T = Array.isArray(g.T) ? g.T : [];
  if (!Array.isArray(g.H)) R.note('grid.H', g.H, `${D} flat rows`, `H must be ${D} rows of ${W} integers`);
  else if (H.length !== D) R.note('grid.H.length', H.length, D, 'row count did not match size.d');
  if (!Array.isArray(g.T)) R.note('grid.T', g.T, `${D} rows of '${DEFAULTS.t}'`, `T must be ${D} rows of ${W} letters`);
  else if (T.length !== D) R.note('grid.T.length', T.length, D, 'row count did not match size.d');
  for (let z = 0; z < D; z++) {
    const hr = Array.isArray(H[z]) ? H[z] : null, out = new Array(W);
    if (H.length && !hr) R.note(`grid.H[${z}]`, H[z], `${W}x${DEFAULTS.h}`, 'row is not an array');
    else if (hr && hr.length !== W) R.note(`grid.H[${z}].length`, hr.length, W, 'row length did not match size.w');
    for (let x = 0; x < W; x++) {
      let v = hr ? fin(hr[x]) : null;
      if (v === null) { if (hr && hr[x] !== undefined) R.note(`grid.H[${z}][${x}]`, hr[x], DEFAULTS.h, 'height is not a finite number'); v = DEFAULTS.h; }
      if (!Number.isInteger(v)) { const r = Math.round(v); R.note(`grid.H[${z}][${x}]`, v, r, 'heights are integers in h steps (the rules unit)'); v = r; }
      if (v < H_MIN || v > H_MAX) { const c = clamp(v, H_MIN, H_MAX); R.note(`grid.H[${z}][${x}]`, v, c, `outside the renderable range ${H_MIN}..${H_MAX}`); v = c; }
      out[x] = v;
    }
    def.grid.H[z] = out; def.grid.T[z] = letters(T[z], z, W, R);
  }
}
// A T row may arrive as a string (canonical) or as an array of letters or ENGINE names ('sand'), which
// is what a legacy/the prototype-shaped document holds. Anything unmapped becomes the default surface: keeping
// the character would ship a silent visual bug (terrain.js draws dirt, rules.js falls back to
// EARTHSONG.g) instead of a reported coercion.
function letters(row, z, W, R) {
  let chars = [];
  if (typeof row === 'string') chars = [...row];
  else if (Array.isArray(row)) chars = row.map((c) => (typeof c === 'string' ? (LETTER_OF_ENGINE[c] || c) : ''));
  else if (row !== undefined) R.note(`grid.T[${z}]`, row, `${W}x'${DEFAULTS.t}'`, 'row is not a string or array');
  if (chars.length && chars.length !== W) R.note(`grid.T[${z}].length`, chars.length, W, 'row length did not match size.w');
  const out = new Array(W);
  for (let x = 0; x < W; x++) {
    const c = chars[x];
    if (typeof c === 'string' && LETTERS[c]) { out[x] = c; continue; }
    if (c !== undefined && c !== '') R.note(`grid.T[${z}][${x}]`, c, DEFAULTS.t, 'unknown surface letter');
    out[x] = DEFAULTS.t;
  }
  return out.join('');
}
// Props keep their array ORDER (props.js round-robins sprite variants over it, so a reorder reshuffles
// every later multi-variant sprite) and keep an unknown `type` (validate.js reports prop.unknown-type;
// deleting it would throw away a fixable typo). Coordinates are snapped to the type's convention and
// clamped in bounds — house/stairs/stall read map.at(x,z).h with NO null guard and THROW otherwise.
function props(def, raw, R) {
  const { w: W, d: D } = def.size, src = Array.isArray(raw.props) ? raw.props : [];
  if (raw.props !== undefined && !Array.isArray(raw.props)) R.note('props', raw.props, '[]', 'props must be an array');
  const seen = new Set(); def.props = [];
  for (let i = 0; i < src.length; i++) {
    const p = src[i], path = `props[${i}]`;
    if (!isObj(p) || typeof p.type !== 'string' || !p.type) { R.note(path, p, null, 'dropped: not an object with a string type'); continue; }
    const q = { pid: p.pid, ...p }, s = PROP_SPEC[p.type];   // pid first, matching stringifyDef
    if (typeof q.pid !== 'string' || !q.pid || seen.has(q.pid)) { const was = q.pid; q.pid = `p${String(i + 1).padStart(3, '0')}`; R.note(`${path}.pid`, was, q.pid, was ? 'duplicate prop id' : 'props need a stable id for undo and issue anchoring'); }
    seen.add(q.pid);
    let x = fin(p.x) ?? 0, z = fin(p.z) ?? 0;
    if (fin(p.x) === null || fin(p.z) === null) R.note(`${path}.x/z`, [p.x, p.z], [x, z], 'coordinates must be finite numbers');
    if (s) { for (const fd of s.fields) if (fd.k !== 'x' && fd.k !== 'z') field(q, fd, `${path}.${fd.k}`, R); }
    [q.x, q.z] = place(s, x, z, W, D);
    if (q.x !== x || q.z !== z) R.note(`${path}.x/z`, [x, z], [q.x, q.z], s ? `snapped to the '${s.coord}' convention and clamped in bounds` : 'clamped in bounds');
    def.props.push(q);
  }
}
// snap + clamp in one step, so a house can never land on a tile corner and a sprite never on a tile
// edge. edgeFree (wall/arch/rail) is genuinely unsnapped: its value is a world coordinate on a
// boundary line, and x === W is the legal far edge.
function place(s, x, z, W, D) {
  const c = s ? s.coord : 'tileCentre';
  if (c === 'edgeFree') return [clamp(x, 0, W), clamp(z, 0, D)];
  const tx = clamp(Math.floor(x), 0, W - 1), tz = clamp(Math.floor(z), 0, D - 1);
  return c === 'nwInt' ? [tx, tz] : [tx + 0.5, tz + 0.5];
}
// One PROP_SPEC field. Absent optional fields stay absent (a prop written out with every default
// spelled in would bury the one field the author actually set); absent REQUIRED ones are filled,
// because props.js reads them raw and produces NaN geometry or a silent no-op footprint.
function field(q, fd, path, R) {
  const v = q[fd.k];
  if (v === undefined || v === null) {
    if (fd.req && fd.def !== null) { q[fd.k] = fd.def; R.note(path, v, fd.def, 'required by props.js — absent yields NaN geometry'); }
    return;
  }
  if (fd.type === 'bool') { if (typeof v !== 'boolean') { q[fd.k] = !!v; R.note(path, v, !!v, 'expected a boolean'); } return; }
  if (fd.type === 'enum') { if (!fd.enum.includes(v)) { q[fd.k] = fd.def; R.note(path, v, fd.def, `not one of ${JSON.stringify(fd.enum)}`); } return; }
  let n = fin(v);
  if (n === null) { q[fd.k] = fd.def ?? 0; R.note(path, v, q[fd.k], 'expected a number'); return; }
  if (fd.type === 'int' && !Number.isInteger(n)) { const r = Math.round(n); R.note(path, n, r, 'must be an integer'); n = r; }
  if (fd.min !== null && n < fd.min) { R.note(path, n, fd.min, `below the minimum ${fd.min}`); n = fd.min; }
  if (fd.max !== null && n > fd.max) { R.note(path, n, fd.max, `above the maximum ${fd.max}`); n = fd.max; }
  q[fd.k] = n;
}
// EXACTLY 5 per team and ORDER IS SIGNIFICANT: main.js index-matches spawns[team][i] to roster[team][i],
// so slot 0 is where the Knight stands. A short table is padded from the blank layout rather than left
// short (battle.worldPos would throw on a missing pin); a long one is truncated, and both are reported —
// the prototype silently FIFO-evicted the 6th spawn and never said so.
function spawns(def, raw, R) {
  const { w: W, d: D } = def.size, src = isObj(raw.spawns) ? raw.spawns : {}, N = DEFAULTS.spawnsPerTeam;
  if (raw.spawns !== undefined && !isObj(raw.spawns)) R.note('spawns', raw.spawns, 'blank layout', 'spawns must be an object keyed by team');
  for (const team of TEAMS) {
    const fallback = def.spawns[team], list = Array.isArray(src[team]) ? src[team] : null;
    if (src[team] !== undefined && !list) R.note(`spawns.${team}`, src[team], 'blank layout', 'team spawn table must be an array');
    if (!list) continue;
    if (list.length !== N) R.note(`spawns.${team}.length`, list.length, N, `exactly ${N} slots — slot i deploys roster[${team}][i]`);
    const out = [];   // padded from the blank layout, truncated past N; both reported
    for (let i = 0; i < N; i++) {
      const pt = pair(list[i], W, D);
      if (!pt) { out.push([...fallback[i]]); if (list[i] !== undefined) R.note(`spawns.${team}[${i}]`, list[i], fallback[i], 'not an in-bounds [x,z] pair'); continue; }
      if (pt.moved) R.note(`spawns.${team}[${i}]`, list[i], pt.xz, 'clamped in bounds');
      out.push(pt.xz);
    }
    def.spawns[team] = out;
  }
}
const pair = (v, W, D) => {
  if (!Array.isArray(v) || v.length < 2) return null;
  const a = fin(v[0]), b = fin(v[1]);
  if (a === null || b === null) return null;
  const x = clamp(Math.round(a), 0, W - 1), z = clamp(Math.round(b), 0, D - 1);
  return { xz: [x, z], moved: x !== a || z !== b };
};function decks(def, raw, R) {
  const { w: W, d: D } = def.size, src = isObj(raw.decks) ? raw.decks : {};
  if (raw.decks !== undefined && !isObj(raw.decks)) R.note('decks', raw.decks, def.decks, 'decks must be {mode, tiles}');
  def.decks.mode = DECK_MODES.includes(src.mode) ? src.mode : DEFAULTS.deckMode;   // 'auto' derives tiles at compile time
  if (src.mode !== undefined && def.decks.mode !== src.mode) R.note('decks.mode', src.mode, def.decks.mode, `not one of ${JSON.stringify(DECK_MODES)}`);
  def.decks.tiles = tiles(src.tiles, 'decks.tiles', W, D, R);   // always round-tripped, never dropped
}
function tiles(v, path, W, D, R) {
  if (!Array.isArray(v)) { if (v !== undefined) R.note(path, v, '[]', 'expected an array of [x,z] pairs'); return []; }
  const out = [];
  for (let i = 0; i < v.length; i++) {   // a bad pair is dropped, never silently zeroed
    const pt = pair(v[i], W, D);
    if (!pt) { R.note(`${path}[${i}]`, v[i], null, 'dropped: not an [x,z] pair'); continue; }
    if (pt.moved) R.note(`${path}[${i}]`, v[i], pt.xz, 'clamped in bounds');
    out.push(pt.xz);
  }
  return out;
}
// Design records are shape-clamped only. Whether a face's `drop` really equals |dH|, whether a choke
// actually seals and whether a route is really a shortest path are validate.js's job — normalize's is
// to guarantee those checks get a well-formed record instead of a crash.
const DESIGN_SHAPE = {
  faces: { id: 'fid', pt: ['from', 'to'], int: ['drop', 'tier', 'minSaving', 'minTurnSaving'], enums: { kind: TIER_KINDS }, str: ['note'] },
  chokes: { id: 'cid', pts: ['tiles'], int: ['tier'], str: ['note'] },
  routes: { id: 'rid', pts: ['via'], int: ['tier'], team: ['from', 'to'], str: ['note'] },
  promises: { int: ['tier', 'savesTurns'], team: ['from', 'to'] },
  regions: { id: 'rgid', rect: ['rect'], enums: { kind: REGION_KINDS }, str: ['note'] },
  assists: { id: 'aid', pts: ['tiles'], enums: { kind: ASSIST_KINDS }, str: ['dir', 'note'] },
  waive: { pt: ['at'], str: ['code', 'why'] },
};
function design(def, raw, R) {
  const { w: W, d: D } = def.size, src = isObj(raw.design) ? raw.design : {};
  if (raw.design !== undefined && !isObj(raw.design)) R.note('design', raw.design, def.design, 'design must be an object');
  const bt = fin(src.baseTier);
  if (bt !== null && Number.isInteger(bt) && bt > 0) def.design.baseTier = bt;
  else if (src.baseTier !== undefined) R.note('design.baseTier', src.baseTier, def.design.baseTier, 'baseTier is a positive integer in h steps');
  if (Array.isArray(src.tiers)) {
    const t = [...new Set(src.tiers.map(fin).filter((n) => n !== null && Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
    if (t.length !== src.tiers.length) R.note('design.tiers', src.tiers, t, 'tiers are unique ascending positive integers');
    def.design.tiers = t.length ? t : DEFAULTS.tiers.slice();
  } else if (src.tiers !== undefined) R.note('design.tiers', src.tiers, def.design.tiers, 'tiers must be an array');
  // DESIGN_KEY_ORDER[0..1] are baseTier/tiers, handled above; the rest are all record arrays.
  for (const key of DESIGN_KEY_ORDER.slice(2)) {
    const shape = DESIGN_SHAPE[key], list = Array.isArray(src[key]) ? src[key] : [];
    if (src[key] !== undefined && !Array.isArray(src[key])) R.note(`design.${key}`, src[key], '[]', 'expected an array');
    def.design[key] = list.map((rec, i) => record(rec, shape, `design.${key}[${i}]`, key, i, W, D, R)).filter(Boolean);
  }
}
function record(rec, shape, path, key, i, W, D, R) {
  if (!isObj(rec)) { R.note(path, rec, null, 'dropped: not an object'); return null; }
  const q = { ...rec };                                        // unknown keys ride along untouched
  if (shape.id && (typeof q[shape.id] !== 'string' || !q[shape.id])) { const was = q[shape.id]; q[shape.id] = `${key.slice(0, 2)}${i + 1}`; R.note(`${path}.${shape.id}`, was, q[shape.id], 'design records need a stable id'); }
  for (const k of shape.pt || []) { const pt = pair(q[k], W, D); if (!pt) { R.note(`${path}.${k}`, q[k], null, 'dropped record: not an [x,z] pair'); return null; } q[k] = pt.xz; }
  for (const k of shape.pts || []) q[k] = tiles(q[k], `${path}.${k}`, W, D, R);
  for (const k of shape.int || []) { if (q[k] === undefined) continue; const n = fin(q[k]); if (n === null) { R.note(`${path}.${k}`, q[k], undefined, 'expected an integer'); delete q[k]; } else q[k] = Math.round(n); }
  for (const k of shape.team || []) { if (!TEAMS.includes(q[k])) { R.note(`${path}.${k}`, q[k], TEAMS[0], `must be one of ${JSON.stringify(TEAMS)}`); q[k] = TEAMS[0]; } }
  for (const k of shape.str || []) { if (q[k] === undefined) continue; if (typeof q[k] !== 'string') { R.note(`${path}.${k}`, q[k], String(q[k]), 'expected a string'); q[k] = String(q[k]); } }
  for (const [k, allowed] of Object.entries(shape.enums || {})) { if (!allowed.includes(q[k])) { R.note(`${path}.${k}`, q[k], allowed[0], `not one of ${JSON.stringify(allowed)}`); q[k] = allowed[0]; } }
  for (const k of shape.rect || []) {
    const r = Array.isArray(q[k]) ? q[k].map(fin) : null;
    if (!r || r.length < 4 || r.some((n) => n === null)) { R.note(`${path}.${k}`, q[k], null, 'dropped record: rect must be [x0,z0,x1,z1]'); return null; }
    const xs = [clamp(Math.round(r[0]), 0, W - 1), clamp(Math.round(r[2]), 0, W - 1)].sort((a, b) => a - b);
    const zs = [clamp(Math.round(r[1]), 0, D - 1), clamp(Math.round(r[3]), 0, D - 1)].sort((a, b) => a - b);
    q[k] = [xs[0], zs[0], xs[1], zs[1]];
  }
  if (key === 'assists' && !isObj(q.bridges)) { if (q.bridges !== undefined) R.note(`${path}.bridges`, q.bridges, null, 'bridges must be {lowH, highH}'); q.bridges = null; }
  return q;
}
function brieftext(def, raw, R) {
  const b = isObj(raw.brief) ? raw.brief : {};
  if (raw.brief !== undefined && !isObj(raw.brief)) R.note('brief', raw.brief, def.brief, 'brief must be {blurb, notes}');
  for (const k of ['blurb', 'notes']) {
    if (b[k] === undefined) continue;
    if (typeof b[k] === 'string') def.brief[k] = b[k];
    else { def.brief[k] = String(b[k]); R.note(`brief.${k}`, b[k], def.brief[k], 'expected a string'); }
  }
}
// The direct fix for the prototype's sanitizeMap(): anything the schema does not know is KEPT, under 'x-', and
// written back out by stringifyDef. Reported, because a preserved-but-inert field is still a surprise.
// Kept from the toPlain() copy taken at the door, never by reference from the caller's object.
function extras(def, raw, R) {
  const keep = isObj(raw['x-']) ? { ...raw['x-'] } : {};
  for (const k of Object.keys(raw)) {
    if (KEY_ORDER.includes(k)) continue;
    keep[k] = raw[k];
    R.note(k, raw[k], `x-.${k}`, 'unknown top-level key preserved verbatim, not dropped');
  }
  def['x-'] = keep;
}
