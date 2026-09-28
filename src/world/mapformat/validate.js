// The validator (PLAN §3.1, §6.9): the one place a map is judged. Every finding carries a STABLE code (CI diffs
// finding sets by code, so a code is an API), a severity, a message naming the exact tile or prop and its numbers,
// `at`/`where` anchors the editor flies the camera to, and — for roughly a third of them — an executable
// `fix(def) -> def` that is PURE (clones, never mutates) and IDEMPOTENT (a second apply changes nothing), which is
// what lets the issues panel offer "Apply all" and lets procgen's repair pass run fixes in any order.
//
// NOTHING THROWS: a validator that dies on a malformed document is useless exactly when it is needed, so the shape
// gate returns early on a document too broken to compile and any later failure becomes `shape.compile-failed`.
// Findings are CAPPED per code with a `meta.suppressed` tail — a 48x48 grid of garbage would otherwise emit
// thousands of identical rows and bury the one that matters. Zero three.js: this runs under bare `node` in
// tools/mapcheck.mjs and judges a map against the LIVE roster tiers, never against a copied table that can rot.
import { FORMAT, SCHEMA_VERSION, ID_RE, SIZE_MIN, SIZE_MAX, SIZE_WARN, H_MIN, H_MAX, H_FLOOR_LAND, H_FLOOR_WATER, LETTERS, TEAMS, DEFAULTS } from './schema.js';
import { PROP_SPEC, footprint, snapCoord } from './propspec.js';
import { compileMap, deckTiles, derivedDecks } from './compile.js';
import { NEIGH4 } from './graph.js';
import { buildGraph, reachField, blockNodes, blockEdges, turnsFor, NO_EDGE, HEIGHT_STEP } from '../jumpgraph.js';
import { TIERS, slowestMoveAtTier } from '../analysis/profiles.js';

// Severity IS the contract. `error` = broken at runtime (a throw inside buildProps, a spawn that cannot deploy,
// teams that cannot reach each other) or an assertion the author wrote that is demonstrably false. `warn` = it
// renders and plays, but not as intended. `info` = a fact worth surfacing. `strict:true` promotes every warn to an
// error, which is the gate a shipping map must pass.
const BY_SEV = {
  error: `shape.format shape.version shape.id shape.size-range shape.rows shape.rowlen shape.height-nan shape.height-range
    shape.height-floor-land shape.height-floor-water shape.compile-failed water.above-land void.touches-water prop.unknown-type
    prop.oob-unsafe prop.missing-wd prop.blocks-only-route deck.no-grant spawn.count spawn.dup spawn.oob spawn.unwalkable
    contract.disconnect contract.face-shape contract.face-drop contract.face-impossible contract.face-undeclared contract.seal
    contract.promise import.throws`,
  warn: `shape.size-large shape.height-noninteger shape.letter water.mixed-height void.above-cut prop.oob-soft prop.coord-convention
    prop.h-units prop.on-unwalkable prop.footprint-overlap prop.footprint-step prop.on-deck prop.variant-churn deck.no-prop
    deck.not-over-water deck.step deck.height-mismatch spawn.isolated contract.face-tier contract.face-worthless contract.gentleness
    contract.ladder contract.route-detour contract.assist-useless hazard.choke1 design.no-high-ground design.orphan design.surface-unreachable`,
  info: 'shape.height-parity hazard.fall design.pocket meta.suppressed',
};
/** code -> 'error'|'warn'|'info'. Frozen; adding or moving a code here is a public API change. */
export const ISSUE_CODES = Object.freeze(Object.fromEntries(Object.entries(BY_SEV).flatMap(([s, l]) => l.split(/\s+/).filter(Boolean).map((k) => [k, s]))));

const E = 'error', W = 'warn', CAP = 16, int = (v) => Number.isInteger(v), key = (x, z) => x + ',' + z, fx = (label, apply) => ({ label, apply });
const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
// A fix that no longer matches the shape it was written for is a NO-OP, never a throw: the panel may apply a stale
// fix after an unrelated edit, and losing a repair beats losing the document.
const edit = (def, fn) => { const d = clone(def); try { fn(d); } catch { /* stale fix */ } return d; };
const tierFor = (drop) => TIERS.find((t) => t >= drop) ?? Infinity, MAX_TIER = Math.max(...TIERS.filter(Number.isFinite));
const takersOf = (drop) => (Number.isFinite(tierFor(drop)) ? `every ${tierFor(drop)}h class takes it` : `no class in the roster can climb it (the highest finite tier is ${MAX_TIER}h)`);   // past the top finite tier tierFor is Infinity, which asserts the OPPOSITE of a number: not every class, but none.
const setH = (def, x, z, v) => edit(def, (o) => { o.grid.H[z][x] = v; });
const setLetter = (def, x, z, ch) => edit(def, (o) => { const r = o.grid.T[z]; if (typeof r === 'string') o.grid.T[z] = r.slice(0, x) + ch + r.slice(x + 1); else r[x] = ch; });
const setFace = (def, fid, patch) => edit(def, (o) => { const f = (((o.design || {}).faces) || []).find((q) => q && q.fid === fid); if (f) Object.assign(f, patch); });
const nearBy = (c, i, fn) => NEIGH4.map(([dx, dz]) => fn((i % c.w) + dx, ((i / c.w) | 0) + dz));   // the four orthogonal neighbours of node i
// pid, not index: an editor reorder is exactly what this fix must survive. A pid-less prop is matched by index AND
// type/x/z, so a second apply cannot delete an innocent neighbour.
const delProp = (p, n) => fx('Delete the prop', (o) => edit(o, (m) => { if (!Array.isArray(m.props)) return;
  const i = p && p.pid ? m.props.findIndex((q) => q && q.pid === p.pid) : (p && m.props[n] && m.props[n].type === p.type && m.props[n].x === p.x && m.props[n].z === p.z ? n : -1);
  if (i >= 0) m.props.splice(i, 1); }));
// Extension point: waves 3-5 ADD checks rather than editing this file. fn(ctx) reads the context validateDef builds
// and calls ctx.add(); a throwing check becomes one finding, so a broken extension cannot pass for a clean map.
const CHECKS = [];
/** @param {(ctx:Object)=>void} fn @returns {()=>void} unregister handle */
export function registerCheck(fn) {
  if (typeof fn !== 'function') throw new TypeError('registerCheck: fn must be a function'); CHECKS.push(fn); return () => { const i = CHECKS.indexOf(fn); if (i >= 0) CHECKS.splice(i, 1); };
}

/**
 * @param {import('./schema.js').MapDef} def
 * @param {{strict?:boolean, prev?:Object, importError?:string}} [opts] strict — promote warnings to errors; prev —
 *   the pre-edit document, which enables prop.variant-churn; importError — what a map module threw at import time
 *   (rules.md §7.14: an asserting module makes sim.mjs silently sim a 12x12 prototype, so the throw must surface
 *   as a finding rather than as a crash).
 * @returns {{ok:boolean, errors:Object[], warnings:Object[], infos:Object[], issues:Object[], stats:Object}}
 */
export function validateDef(def, opts = {}) {
  const issues = [], counts = Object.create(null), over = Object.create(null), strict = !!opts.strict;
  const add = (code, msg, at, fix) => {
    const n = counts[code] = (counts[code] || 0) + 1;
    if (n > CAP) { over[code] = (over[code] || 0) + 1; return; }
    const sev = ISSUE_CODES[code] || W, tile = at && at.tile;
    issues.push({ code, severity: strict && sev === W ? E : sev, msg, at: at || null, where: tile ? { x: tile[0], z: tile[1] } : null, ...(fix ? { fix } : {}) });
  };
  const c = { def, opts, strict, add, issues };
  if (opts.importError) add('import.throws', `the map module threw at import: ${opts.importError}`, null);
  if (gateShape(c)) {
    try { c.MAP = compileMap(def, { keepPid: true }); c.g = buildGraph(c.MAP); } catch (err) { add('shape.compile-failed', String((err && err.message) || err), null); }
    if (c.g) { context(c); for (const fn of [checkSeams, checkProps, checkDecks, checkSpawns, checkReach, checkContract, ...CHECKS]) { try { fn(c); } catch (err) { add('shape.compile-failed', `check ${fn.name || 'anon'} threw: ${err && err.message}`, null); } } }
  }
  for (const code of Object.keys(over)) add('meta.suppressed', `${over[code]} further '${code}' finding(s) not listed`, null);
  const errors = issues.filter((i) => i.severity === E), warnings = issues.filter((i) => i.severity === W);
  return { ok: errors.length === 0, errors, warnings, infos: issues.filter((i) => i.severity === 'info'), issues, stats: { counts, capped: over, checks: CHECKS.length } };
}

// Identity and grid rectangularity. Returns false when the document cannot be compiled at all, in which case NO
// later check runs: they all index MAP.tiles[z][x] and would report a cascade derived from the one real fault.
function gateShape(c) {
  const { def, add } = c; if (!def || typeof def !== 'object') { add('shape.format', 'the document is not an object', null); return false; }
  if (def.format !== FORMAT) add('shape.format', `format '${def.format}' is not '${FORMAT}'`, null, fx(`Set format to ${FORMAT}`, (d) => edit(d, (o) => { o.format = FORMAT; })));
  if (!int(def.version) || def.version < 1 || def.version > SCHEMA_VERSION) add('shape.version', `version ${def.version} is not 1..${SCHEMA_VERSION}`, null, fx(`Set version to ${SCHEMA_VERSION}`, (d) => edit(d, (o) => { o.version = SCHEMA_VERSION; })));
  if (typeof def.id !== 'string' || !ID_RE.test(def.id)) add('shape.id', `id '${def.id}' does not match ${ID_RE}; it is the loader whitelist key and must equal the filename stem`, null);
  const { w, d } = def.size || {}, H = def.grid && def.grid.H, T = def.grid && def.grid.T;
  if (!int(w) || !int(d) || w < SIZE_MIN || d < SIZE_MIN || w > SIZE_MAX || d > SIZE_MAX) { add('shape.size-range', `size ${w}x${d} is outside ${SIZE_MIN}..${SIZE_MAX}`, null); return false; }
  if (w > SIZE_WARN || d > SIZE_WARN) add('shape.size-large', `${w}x${d} is above the ${SIZE_WARN} editor threshold: roughly ${Math.round(w * d * 0.125)} ms of buildTerrain per commit`, null);
  if (!Array.isArray(H) || !Array.isArray(T)) { add('shape.rows', 'grid.H and grid.T must both be arrays', null); return false; }
  if (H.length !== d || T.length !== d) { add('shape.rows', `grid has ${H.length} H rows and ${T.length} T rows; size.d is ${d}`, null); return false; }
  let ragged = 0;
  for (let z = 0; z < d; z++) { const hr = H[z], tr = T[z];
    if (!hr || hr.length !== w || !tr || tr.length !== w) { ragged++; add('shape.rowlen', `row ${z} is H=${hr ? hr.length : 'missing'} T=${tr ? tr.length : 'missing'} wide; size.w is ${w}`, { tile: [0, z] }); continue; }
    for (let x = 0; x < w; x++) { const h = hr[x], ch = tr[x], L = LETTERS[ch], cl = Math.max(H_MIN, Math.min(H_MAX, h)), at = { tile: [x, z] }; if (!L) add('shape.letter', `unknown surface '${ch}' at ${x},${z}: renders as dirt with no fringe and earthsong falls back to grass`, at, fx("Paint as grass 'g'", (o) => setLetter(o, x, z, 'g')));
      if (typeof h !== 'number' || !Number.isFinite(h)) { add('shape.height-nan', `height at ${x},${z} is ${h}`, at, fx('Set to 0h', (o) => setH(o, x, z, 0))); continue; }
      if (h < H_MIN || h > H_MAX) add('shape.height-range', `height ${h} at ${x},${z} is outside ${H_MIN}..${H_MAX}`, at, fx(`Clamp to ${cl}h`, (o) => setH(o, x, z, cl)));
      else if (L && L.water ? h <= H_FLOOR_WATER : h <= H_FLOOR_LAND) add(L && L.water ? 'shape.height-floor-water' : 'shape.height-floor-land', `${L && L.water ? 'water' : 'land'} at ${x},${z} sits at ${h}h, at or below the floor where terrain.js's skirt quad inverts`, at); if (!int(h)) add('shape.height-noninteger', `height ${h} at ${x},${z} is not an integer h step`, at, fx(`Round to ${Math.round(h)}h`, (o) => setH(o, x, z, Math.round(h)))); else if (h % 2 !== 0) add('shape.height-parity', `height ${h} at ${x},${z} is odd; the terrace vocabulary steps by 2h`, at);
    } } return ragged === 0;
}

// Everything the rule bodies share, computed once: spawn node sets, the base-tier flood, the deck grant, and the
// declared design turned into O(1) lookups. c.span(climb, from, to) is the A->B distance every contract rule uses.
function context(c) {
  const { def, g } = c, D = c.design = def.design || {}, w = c.w = g.w, d = c.d = g.d;
  c.base = int(D.baseTier) ? D.baseTier : DEFAULTS.baseTier; c.tiers = (Array.isArray(D.tiers) ? D.tiers : []).filter((t) => typeof t === 'number');
  c.i = (x, z) => (x >= 0 && z >= 0 && x < w && z < d ? z * w + x : -1); c.walkable = (i) => i >= 0 && (g.pass[i] & 1) === 1;
  c.grant = new Set(deckTiles(def).map(([x, z]) => key(x, z))); c.src = {};
  for (const t of TEAMS) c.src[t] = (def.spawns && Array.isArray(def.spawns[t]) ? def.spawns[t] : []).map((s) => (Array.isArray(s) ? c.i(s[0], s[1]) : -1)).filter((i) => c.walkable(i));
  c.dA = c.src.A.length ? reachField(g, { climb: c.base }, c.src.A).dist : null; c.D0 = c.dA && c.src.B.length ? Math.min(...c.src.B.map((i) => (c.dA[i] < 0 ? Infinity : c.dA[i]))) : Infinity;
  c.waived = new Set((Array.isArray(D.waive) ? D.waive : []).map((v) => (v && Array.isArray(v.at) ? key(v.at[0], v.at[1]) + '|' + v.code : '')));
  c.scenery = new Set(); c.faceEdges = new Map();
  for (const r of (Array.isArray(D.regions) ? D.regions : [])) { if (!r || r.kind !== 'scenery' || !Array.isArray(r.rect)) continue; const [x0, z0, x1, z1] = r.rect;
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) c.scenery.add(key(x, z)); }
  for (const f of (Array.isArray(D.faces) ? D.faces : [])) { if (!f || !Array.isArray(f.from) || !Array.isArray(f.to)) continue;
    const a = c.i(f.from[0], f.from[1]), b = c.i(f.to[0], f.to[1]); if (a >= 0 && b >= 0) c.faceEdges.set(Math.min(a, b) + ':' + Math.max(a, b), f); }
  c.span = (climb, from = 'A', to = 'B') => (c.src[from] && c.src[from].length && c.src[to] && c.src[to].length ? spanOn(c, g, climb, from, to) : Infinity);
}
/** Steps from one spawn set to the nearest tile of another over ANY graph (blocked counterfactuals included). */
function spanOn(c, g2, climb, from = 'A', to = 'B') {
  const dist = reachField(g2, { climb }, c.src[from]).dist, m = Math.min(...c.src[to].map((i) => (dist[i] < 0 ? Infinity : dist[i]))); return Number.isFinite(m) ? m : Infinity;
}
/** Connected 4-adjacent region from a seed under a predicate; `seen` is shared across calls. */
function flood(c, start, ok, seen) {
  const st = [start], out = []; seen[start] = 1;
  while (st.length) { const i = st.pop(); out.push(i); for (const j of nearBy(c, i, c.i)) if (j >= 0 && !seen[j] && ok(j)) { seen[j] = 1; st.push(j); } } return out;
}

// The renderer invariants (terrain.md §4/§5, props.md §5) plus the one sweep that prices relief. An undeclared step
// above baseTier between two WALKABLE tiles is an accidental express any higher-JUMP class can take —
// `contract.face-undeclared`. The same step with water or a prop-closed tile on the far side is a bank nobody can
// take, so it is only `contract.gentleness`. Pairs involving VOID are exempt from both: terrain.js's at() returns
// null for a void tile, so the step is the diorama rim, not a route. Both honour waive and `scenery` regions.
function checkSeams(c) {
  const { g, MAP, add, base } = c;
  let cut = Infinity, high = 0; const seen = new Uint8Array(g.n);
  for (let z = 0; z < c.d; z++) for (let x = 0; x < c.w; x++) {
    const t = MAP.tiles[z][x], i = c.i(x, z);
    if (!t.water && !t.void) cut = Math.min(cut, t.h);
    if (t.water && !seen[i]) {                       // one connected body per pass, checked for a common h
      const body = flood(c, i, (j) => MAP.tiles[(j / c.w) | 0][j % c.w].water, seen), h0 = g.h[body[0]], odd = body.find((j) => g.h[j] !== h0);
      if (odd !== undefined) add('water.mixed-height', `water body of ${body.length} tiles spans ${h0}h and ${g.h[odd]}h; the tile at ${odd % c.w},${(odd / c.w) | 0} leaves a seam no side geometry closes`, { tile: [odd % c.w, (odd / c.w) | 0] }, fx(`Level the body to ${h0}h`, (o) => edit(o, (m) => { for (const j of body) m.grid.H[(j / c.w) | 0][j % c.w] = h0; })));
    }
    for (const [dx, dz] of NEIGH4) {
      const nx = x + dx, nz = z + dz, j = c.i(nx, nz); if (j < 0 || j < i) continue;                  // each undirected pair exactly once
      const u = MAP.tiles[nz][nx], dh = Math.abs(t.h - u.h);
      if (t.water !== u.water && !t.void && !u.void) { const wt = t.water ? t : u, lt = t.water ? u : t; if (lt.h <= wt.h - 2) add('water.above-land', `water at ${wt.x},${wt.z} (${wt.h}h) stands over land at ${lt.x},${lt.z} (${lt.h}h): no bank is emitted and the slab floats`, { tile: [wt.x, wt.z] }, fx(`Lower the water to ${lt.h}h`, (o) => setH(o, wt.x, wt.z, lt.h))); }
      if (t.void !== u.void && (t.water || u.water)) { const v = t.void ? t : u; add('void.touches-water', `void at ${v.x},${v.z} is orthogonally adjacent to water: its earth face shows through the black cap`, { tile: [v.x, v.z] }, fx('Fill with grass', (o) => setLetter(o, v.x, v.z, 'g'))); }
      if (c.walkable(i) && c.walkable(j)) { high = Math.max(high, dh); if (dh > 2 * HEIGHT_STEP) add('hazard.fall', `${dh}h walkable step between ${x},${z} and ${nx},${nz} takes knockback fall damage`, { tile: [x, z] }); if (dh > base && !c.faceEdges.has(i + ':' + j) && !exempt(c, x, z, nx, nz, 'contract.face-undeclared')) add('contract.face-undeclared', `undeclared ${dh}h face between ${x},${z} and ${nx},${nz}: ${takersOf(dh)}`, { tile: [x, z] }, declareFace(x, z, nx, nz, dh));
      } else if (dh > base && !t.void && !u.void && (t.water || u.water) && !exempt(c, x, z, nx, nz, 'contract.gentleness')) add('contract.gentleness', `${dh}h bank between ${x},${z} and ${nx},${nz} is steeper than baseTier ${base}h`, { tile: [x, z] });
    } }
  c.cutH = cut = Number.isFinite(cut) ? cut : 0;     // all-water or all-void: terrain.js's isFinite guard
  for (let z = 0; z < c.d; z++) for (let x = 0; x < c.w; x++) { const t = MAP.tiles[z][x]; if (t.void && t.h > cut) add('void.above-cut', `void at ${x},${z} sits at ${t.h}h, above the cut level ${cut}h: its black cap floats as a shelf`, { tile: [x, z] }, fx(`Drop to ${cut}h`, (o) => setH(o, x, z, cut))); }
  if (high < HEIGHT_STEP) add('design.no-high-ground', `no walkable step anywhere reaches ${HEIGHT_STEP}h: the +10% height bonus, the ranged +range rule and gunslingers_perch never fire`, null);
}
const exempt = (c, x, z, nx, nz, code) => c.scenery.has(key(x, z)) || c.scenery.has(key(nx, nz)) || c.waived.has(key(x, z) + '|' + code) || c.waived.has(key(nx, nz) + '|' + code);
/** The one-click "declare as express" of PLAN §4.5. Idempotent by fid: a second apply finds it already there. */
const declareFace = (x, z, nx, nz, dh) => fx('Declare as an express face', (o) => edit(o, (d) => { const fid = `face_${x}_${z}_${nx}_${nz}`, t = tierFor(dh);   // t is Infinity above every finite tier, and JSON writes that as null, so the field is omitted below rather than written unreadable — absent already means tierFor(drop) to every reader.
  d.design = d.design || {}; d.design.faces = Array.isArray(d.design.faces) ? d.design.faces : [];
  if (!d.design.faces.some((f) => f && f.fid === fid)) d.design.faces.push({ fid, from: [x, z], to: [nx, nz], drop: dh, ...(Number.isFinite(t) ? { tier: t } : {}), kind: 'express', minTurnSaving: 1, note: 'declared by validate.js' }); }));

// Props: every rule here transcribes a way props.js throws or fails SILENTLY (props.md §6). Nothing validates a
// prop at runtime — an unknown type produces no mesh and no console message — so this pass is the only reader.
function checkProps(c) {
  const { def, add, MAP } = c;
  const props = Array.isArray(def.props) ? def.props : [], owner = new Map(), multi = new Set();
  props.forEach((p, n) => {
    const at = { prop: (p && p.pid) || `#${n}`, index: n, tile: p && [Math.floor(p.x), Math.floor(p.z)] }; const spec = p && typeof p.type === 'string' ? PROP_SPEC[p.type] : null;
    if (!spec) { add('prop.unknown-type', `props[${n}] type '${p && p.type}' is unknown: props.js drops it silently — no mesh, no message`, at, delProp(p, n)); return; }
    const ix = spec.coord === 'nwInt' ? p.x : Math.floor(p.x), iz = spec.coord === 'nwInt' ? p.z : Math.floor(p.z); const t = Number.isFinite(ix) && Number.isFinite(iz) ? MAP.at(ix, iz) : null; if (!t && spec.coord !== 'edgeFree') add(spec.unsafeAt ? 'prop.oob-unsafe' : 'prop.oob-soft', `${p.type} at ${p.x},${p.z} has no tile under its anchor${spec.unsafeAt ? ' — buildProps reads map.at(x,z).h unguarded and THROWS' : ', so it falls back to h=0'}`, at, delProp(p, n));
    if ((p.type === 'house' || p.type === 'tower') && (!int(p.w) || !int(p.d))) add('prop.missing-wd', `${p.type} at ${p.x},${p.z} has w=${p.w} d=${p.d}: footprint() reads them raw and the NaN loop blocks nothing`, at, fx('Set the missing extent to 2', (o) => edit(o, (m) => { const q = m.props[n]; if (q && q.type === p.type) { if (!int(q.w)) q.w = 2; if (!int(q.d)) q.d = 2; } })));
    // Only the two conventions that MISPLACE the mesh: an nwInt rectangle off the integer lattice sits half a tile
    // out, and a tileCentre sprite on an integer lands on the tile CORNER. A tileCentre prop jittered inside its own
    // tile (the market clutter does this deliberately) is placed exactly where it was authored, so it is not a fault.
    const off = Number.isFinite(p.x) && Number.isFinite(p.z) && (spec.coord === 'nwInt' ? !int(p.x) || !int(p.z) : spec.coord === 'tileCentre' && (int(p.x) || int(p.z)));
    if (off) { const [sx, sz] = snapCoord(p.type, p.x, p.z); add('prop.coord-convention', `${p.type} takes the ${spec.coord} convention but sits at ${p.x},${p.z}; it belongs at ${sx},${sz}`, at, fx(`Snap to ${sx},${sz}`, (o) => edit(o, (m) => { const q = m.props[n]; if (q && q.type === p.type) { const s = snapCoord(q.type, q.x, q.z); q.x = s[0]; q.z = s[1]; } }))); }
    if (spec.heightUnits === 'h' && p.h !== undefined && !int(p.h)) add('prop.h-units', `${p.type} at ${p.x},${p.z} has h=${p.h}; wall/arch/rail/deck take h in HEIGHT STEPS, not world units`, at, fx(`Round to ${Math.round(p.h)}h`, (o) => edit(o, (m) => { const q = m.props[n]; if (q && q.type === p.type && Number.isFinite(q.h)) q.h = Math.round(q.h); })));
    if (t && spec.coord !== 'edgeFree' && p.type !== 'deck' && p.type !== 'gate' && (t.void || (t.water && !c.grant.has(key(ix, iz))))) add('prop.on-unwalkable', `${p.type} at ${p.x},${p.z} stands on ${t.void ? 'void' : 'open water'}`, at, delProp(p, n));
    let h0 = null; const fp = footprint(p); if (fp.length > 1) multi.add(n);
    for (const [x, z] of fp) {
      const u = Number.isFinite(x) && Number.isFinite(z) ? MAP.at(x, z) : null; if (!u) continue;
      const cell = { ...at, tile: [x, z] }, prior = owner.get(key(x, z)); if (h0 === null) h0 = u.h;
      else if (u.h !== h0) { add('prop.footprint-step', `${p.type} at ${p.x},${p.z} spans ${h0}h and ${u.h}h: the mesh sits at its NW tile height and the rest floats`, cell); h0 = u.h; } if (c.grant.has(key(x, z))) add('prop.on-deck', `${p.type} at ${p.x},${p.z} re-closes granted deck tile ${x},${z} — the prop pass runs after the grant`, cell, delProp(p, n));
      // Only when a MULTI-tile footprint is involved: two jittered barrels flooring to one tile block it once and
      // read as a cluttered market stall, but a house over a well is two meshes interpenetrating.
      if (prior !== undefined) { if (fp.length > 1 || multi.has(prior)) add('prop.footprint-overlap', `${p.type} at ${p.x},${p.z} and props[${prior}] both claim tile ${x},${z}`, cell, delProp(p, n)); } else owner.set(key(x, z), n);
    } });
  // props.js hands the Nth prop of a type PNG list[(N-1) % list.length], so a reorder swaps the sprite on every
  // later prop of that type. Counted by pid across an edit, which is the whole reason pid exists.
  const ord = (l) => { const s = Object.create(null), m = new Map(); for (const p of l) if (p && p.pid && PROP_SPEC[p.type]) m.set(p.pid, [p.type, (s[p.type] = (s[p.type] || 0) + 1) - 1]); return m; };
  if (c.opts.prev && Array.isArray(c.opts.prev.props)) { const a = ord(c.opts.prev.props), b = ord(props); let n = 0; for (const [pid, [ty, k]] of b) { const q = a.get(pid), v = PROP_SPEC[ty].variants; if (q && v > 1 && q[0] === ty && q[1] % v !== k % v) n++; } if (n) add('prop.variant-churn', `${n} prop(s) changed sprite variant because the props array was reordered`, null); }
}

// props.md §3.15: the deck PROP is the visible surface, the decks grant is the rules-visible walk permission, and
// either alone is a bug — a bridge nobody can cross, or units walking on open water.
function checkDecks(c) {
  const { def, add, MAP, base } = c;
  const rect = new Set(derivedDecks(def).map(([x, z]) => key(x, z))), mode = def.decks && def.decks.mode; if (mode !== undefined && mode !== 'auto' && mode !== 'explicit') add('deck.no-grant', `decks.mode '${mode}' is neither 'auto' nor 'explicit'`, null);
  for (const k of rect) if (!c.grant.has(k)) { const [x, z] = k.split(',').map(Number); add('deck.no-grant', `a deck prop covers ${x},${z} but decks.tiles does not grant it: the span is uncrossable`, { tile: [x, z] }, fx("Switch decks.mode to 'auto'", (o) => edit(o, (m) => { m.decks = m.decks || { tiles: [] }; m.decks.mode = 'auto'; }))); }
  for (const k of c.grant) {
    const [x, z] = k.split(',').map(Number), t = MAP.at(x, z); if (!t) continue;
    if (!rect.has(k)) add('deck.no-prop', `${x},${z} is granted walkable but no deck prop spans it: units walk on open water`, { tile: [x, z] }); if (!t.water) add('deck.not-over-water', `the deck grant at ${x},${z} is on ${t.void ? 'void' : 'dry land'}, where it grants nothing`, { tile: [x, z] });
    const shore = NEIGH4.map(([dx, dz]) => MAP.at(x + dx, z + dz)).filter((u) => u && u.walk && !c.grant.has(key(u.x, u.z))); if (shore.length && shore.every((u) => Math.abs(u.h - t.h) > base)) add('deck.step', `deck tile ${x},${z} at ${t.h}h is more than baseTier ${base}h from every shore approach`, { tile: [x, z] });
  } for (const p of (Array.isArray(def.props) ? def.props : [])) { if (!p || p.type !== 'deck' || !int(p.h)) continue; const t = MAP.at(p.x, p.z);
    if (t && t.water && t.h !== p.h) add('deck.height-mismatch', `deck at ${p.x},${p.z} declares h=${p.h} over ${t.h}h water: the span floats`, { prop: p.pid || 'deck', tile: [p.x, p.z] }, fx(`Set h to ${t.h}`, (o) => edit(o, (m) => { const q = (m.props || []).find((r) => r && r.type === 'deck' && r.x === p.x && r.z === p.z); if (q) q.h = t.h; }))); } }

// Spawns are index-matched to roster slots by main.js, so a missing or duplicated pin silently redeploys a class.
function checkSpawns(c) {
  const { def, add, MAP, base } = c; const seen = new Map();
  for (const team of TEAMS) {
    const list = def.spawns && Array.isArray(def.spawns[team]) ? def.spawns[team] : []; if (list.length !== DEFAULTS.spawnsPerTeam) add('spawn.count', `team ${team} has ${list.length} spawns, not ${DEFAULTS.spawnsPerTeam}: main.js index-matches slot i to roster[${team}][i]`, { spawn: [team, list.length] });
    list.forEach((s, slot) => {
      const at = { spawn: [team, slot], tile: Array.isArray(s) ? [s[0], s[1]] : undefined }; if (!Array.isArray(s) || !int(s[0]) || !int(s[1])) { add('spawn.oob', `${team}[${slot}] is not an integer tile pair`, at); return; }
      const [x, z] = s, t = MAP.at(x, z), prior = seen.get(key(x, z)); if (!t) { add('spawn.oob', `${team}[${slot}] at ${x},${z} is off-map: map.at returns null and battle.worldPos throws`, at); return; }
      if (prior) add('spawn.dup', `${team}[${slot}] at ${x},${z} duplicates ${prior}`, at); else seen.set(key(x, z), `${team}[${slot}]`); if (!t.walk) { add('spawn.unwalkable', `${team}[${slot}] at ${x},${z} is ${t.void ? 'void' : t.water ? 'open water' : 'closed by a prop footprint'}`, at); return; }
      if (!NEIGH4.some(([dx, dz]) => { const u = MAP.at(x + dx, z + dz); return u && u.walk && Math.abs(u.h - t.h) <= base; })) add('spawn.isolated', `${team}[${slot}] at ${x},${z} cannot take a single step at baseTier ${base}h`, at);
    }); }
}

// Connectivity is the one thing that makes a map unplayable rather than merely wrong, so contract.disconnect is an
// error; the pockets, orphans, chokes and route-owning props below all read off the same handful of floods.
function checkReach(c) {
  const { g, add, base, MAP } = c; if (!c.src.A.length || !c.src.B.length) return;     // spawn.count / spawn.unwalkable already said so
  if (!Number.isFinite(c.D0)) add('contract.disconnect', `the two spawn sets are not connected at baseTier ${base}h`, { tile: g.xz(c.src.A[0]) });
  const open = reachField(g, { climb: Infinity, water: true }, [...c.src.A, ...c.src.B]).dist; const seen = new Uint8Array(g.n), pocket = new Map(), memo = new Map();
  const reachAt = (t) => { if (!memo.has(t)) memo.set(t, reachField(g, { climb: t }, c.src.A).dist); return memo.get(t); };
  for (let i = 0; i < g.n; i++) { if (!c.walkable(i) || seen[i]) continue;
    if (open[i] < 0) { const grp = flood(c, i, (j) => c.walkable(j) && open[j] < 0, seen); add('design.orphan', `${grp.length} walkable tile(s) around ${i % c.w},${(i / c.w) | 0} are cut off from both spawns at every roster tier`, { tile: g.xz(i) }); continue; }
    seen[i] = 1; if (c.dA && c.dA[i] < 0) { const s = String(TIERS.find((k) => reachAt(k)[i] >= 0) ?? Infinity); if (!pocket.has(s)) pocket.set(s, []); pocket.get(s).push(i); }
  }
  for (const [climb, list] of pocket) add('design.pocket', `${list.length} tile(s) from ${list[0] % c.w},${(list[0] / c.w) | 0} are reachable only at ${climb}h or above`, { tile: g.xz(list[0]) });
  // A painted, non-ambient surface no base-tier unit can stand on: the art and the earthsong element it grants are
  // both unreachable. Ambient = the commonest walkable letter, so a grass field never trips this and a marooned
  // six-tile stone dais always does.
  const tally = new Map(), seenS = new Uint8Array(g.n); for (let z = 0; z < c.d; z++) for (let x = 0; x < c.w; x++) { const t = MAP.tiles[z][x]; if (t.walk) tally.set(t.t, (tally.get(t.t) || 0) + 1); }
  const ambient = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (ambient && c.dA) for (let i = 0; i < g.n; i++) { const x = i % c.w, z = (i / c.w) | 0, t = MAP.tiles[z][x]; if (seenS[i] || !t.walk || t.t === ambient[0]) continue;
    const patch = flood(c, i, (j) => { const u = MAP.tiles[(j / c.w) | 0][j % c.w]; return u.walk && u.t === t.t; }, seenS); if (patch.length >= 2 && patch.every((j) => c.dA[j] < 0)) add('design.surface-unreachable', `the ${patch.length}-tile '${t.t}' patch at ${x},${z} cannot be reached at baseTier ${base}h`, { tile: [x, z] });
  }
  if (!Number.isFinite(c.D0)) return;
  // One-tile chokes and props that own the only route are both counterfactuals over the base-tier shortest path,
  // so the cost is bounded by the path (tens of tiles), never by the size of the map.
  const res = reachField(g, { climb: base }, c.src.A), path = [], srcSet = new Set([...c.src.A, ...c.src.B]); const goal = c.src.B.reduce((b, i) => (res.dist[i] >= 0 && (b < 0 || res.dist[i] < res.dist[b]) ? i : b), -1); for (let i = goal; i >= 0; i = res.prev[i]) path.push(i);
  for (const i of path) if (!srcSet.has(i) && !Number.isFinite(spanOn(c, blockNodes(g, [i]), base))) add('hazard.choke1', `${i % c.w},${(i / c.w) | 0} is a one-tile choke on the only ${base}h route: a KO'd body corks it for three turns`, { tile: g.xz(i) }); const near = new Set(path.flatMap((i) => nearBy(c, i, key)));
  (Array.isArray(c.def.props) ? c.def.props : []).forEach((p, n) => {
    if (!p || !PROP_SPEC[p.type] || !PROP_SPEC[p.type].blocking) return;
    const fp = footprint(p).filter(([x, z]) => c.i(x, z) >= 0); if (!fp.length || !fp.some(([x, z]) => near.has(key(x, z)) || c.grant.has(key(x, z)))) return;
    const d2 = spanOn(c, buildGraph(compileMap({ ...c.def, props: c.def.props.filter((_, m) => m !== n) })), base); if (d2 < c.D0) add('prop.blocks-only-route', `removing ${p.type} at ${p.x},${p.z} shortens the ${base}h route from ${c.D0} to ${d2} steps`, { prop: p.pid || `#${n}`, index: n, tile: [Math.floor(p.x), Math.floor(p.z)] }, delProp(p, n));
  }); }

// Everything the author ASSERTED, proven or refuted: a choke by deletion, a face by a blocked-edge counterfactual,
// a promise in TURNS for the slowest class in its tier, a route by its own waypoints. Never by inspection.
function checkContract(c) {
  const { design: D, add, g, base } = c; for (const f of (Array.isArray(D.faces) ? D.faces : [])) {
    if (!f || !Array.isArray(f.from) || !Array.isArray(f.to)) { add('contract.face-shape', `face '${f && f.fid}' has no from/to pair`, { face: f && f.fid }); continue; } const [ax, az] = f.from, [bx, bz] = f.to, a = c.i(ax, az), b = c.i(bx, bz), at = { face: f.fid, tile: [ax, az] };
    if (a < 0 || b < 0 || Math.abs(ax - bx) + Math.abs(az - bz) !== 1 || !c.walkable(a) || !c.walkable(b)) { add('contract.face-shape', `face '${f.fid}' ${ax},${az} -> ${bx},${bz} is not an orthogonally adjacent pair of in-bounds walkable tiles`, at); continue; } const drop = Math.abs(g.h[a] - g.h[b]);
    if (f.drop !== drop) add('contract.face-drop', `face '${f.fid}' declares drop ${f.drop} but the terrain steps ${drop}h`, at, fx(`Set drop to ${drop}`, (o) => setFace(o, f.fid, { drop, tier: tierFor(drop) }))); if (drop > MAX_TIER) add('contract.face-impossible', `face '${f.fid}' is a ${drop}h step; the highest finite roster tier is ${MAX_TIER}h, so only ignore_height clears it`, at);
    else if (f.tier !== tierFor(drop)) add('contract.face-tier', `face '${f.fid}' declares tier ${f.tier}; ${drop}h rounds up to the roster tier ${tierFor(drop)}h`, at, fx(`Set tier to ${tierFor(drop)}`, (o) => setFace(o, f.fid, { tier: tierFor(drop) })));
    const climb = Number.isFinite(f.tier) ? f.tier : tierFor(drop), on = c.span(climb), off = c.src.A.length && c.src.B.length ? spanOn(c, blockEdges(g, [[a, b]]), climb) : Infinity; const steps = (Number.isFinite(off) ? off : NO_EDGE) - (Number.isFinite(on) ? on : NO_EDGE), move = slowestMoveAtTier(climb), turns = turnsFor(off, move) - turnsFor(on, move);
    if (steps < (f.minSaving ?? 1) && !(turns >= (f.minTurnSaving ?? 1))) add('contract.face-worthless', `face '${f.fid}' saves ${steps} step(s) and ${Number.isFinite(turns) ? turns : 0} turn(s) at ${climb}h, below its declared floor`, at);
  } for (const k of (Array.isArray(D.chokes) ? D.chokes : [])) {
    if (!k || !Array.isArray(k.tiles) || !k.tiles.length || !c.src.A.length || !c.src.B.length) continue;
    const nodes = k.tiles.map((t) => (Array.isArray(t) ? c.i(t[0], t[1]) : -1)).filter((i) => i >= 0), climb = Number.isFinite(k.tier) ? k.tier : base; const dist = reachField(blockNodes(g, nodes), { climb }, c.src.A).dist, hit = c.src.B.find((i) => dist[i] >= 0);
    if (hit !== undefined) add('contract.seal', `choke '${k.cid}' does not seal at ${climb}h: with its ${nodes.length} tile(s) deleted the flood still reaches ${g.xz(hit)}, leaking past ${leak(c, dist, new Set(nodes))}`, { choke: k.cid, tile: k.tiles[0] });
  } let prev = null;                                   // the ladder: steps must fall, and a declared tier must earn its place
  for (const t of [...new Set([base, ...c.tiers])].sort((a, b) => a - b)) { const steps = c.span(t);
    if (!Number.isFinite(steps)) { if (t !== base) add('contract.ladder', `declared tier ${t}h does not connect the spawn sets at all`, null); continue; }   // the base rung is contract.disconnect's job
    if (prev && steps > prev.steps) add('contract.ladder', `tier ${t}h walks ${steps} steps against ${prev.t}h's ${prev.steps}: tier subgraphs are nested, so this is a bug in need[], not in the map`, null);
    else if (prev && t !== base && steps === prev.steps) add('contract.ladder', `declared tier ${t}h delivers nothing over ${prev.t}h: both walk ${steps} steps (${turnsFor(steps, slowestMoveAtTier(t))} turns at MOVE ${slowestMoveAtTier(t)})`, null);
    prev = { t, steps }; } for (const p of (Array.isArray(D.promises) ? D.promises : [])) {
    if (!p || !Number.isFinite(p.tier)) continue; const from = p.from || 'A', to = p.to || 'B', move = slowestMoveAtTier(p.tier);
    const t0 = turnsFor(c.span(base, from, to), slowestMoveAtTier(base)), t1 = turnsFor(c.span(p.tier, from, to), move), got = Number.isFinite(t0) && Number.isFinite(t1) ? t0 - t1 : 0; if (got < (p.savesTurns || 0)) add('contract.promise', `${from}->${to} at ${p.tier}h promises ${p.savesTurns} turn(s) but saves ${got} (${t0} -> ${t1} turns at MOVE ${move}); margin ${got - (p.savesTurns || 0)}`, null);
  } for (const r of (Array.isArray(D.routes) ? D.routes : [])) {
    if (!r || !Number.isFinite(r.tier)) continue; const via = (Array.isArray(r.via) ? r.via : []).map((v) => (Array.isArray(v) ? c.i(v[0], v[1]) : -1)), at = { route: r.rid, tile: (r.via && r.via[0]) || undefined };
    if (via.some((i) => !c.walkable(i))) { add('contract.route-detour', `route '${r.rid}' has a via waypoint that is off-map or unwalkable`, at); continue; }
    const stops = [c.src[r.from || 'A'] || [], ...via.map((i) => [i]), c.src[r.to || 'B'] || []].filter((s) => s.length); let sum = 0, broken = false;
    for (let k = 0; k + 1 < stops.length; k++) { const dist = reachField(g, { climb: r.tier }, stops[k]).dist, m = Math.min(...stops[k + 1].map((i) => (dist[i] < 0 ? Infinity : dist[i]))); if (!Number.isFinite(m)) { broken = true; break; } sum += m; } const direct = c.span(r.tier, r.from || 'A', r.to || 'B');
    if (broken) add('contract.route-detour', `route '${r.rid}' is broken at ${r.tier}h: a leg between its waypoints is unreachable`, at);
    else if (via.length && sum > direct) add('contract.route-detour', `route '${r.rid}' walks ${sum} steps through its waypoints but the ${r.tier}h shortest path is ${direct}: the detour was optimised away`, at); }
  // A stairs assist earns its declaration only if some stair tile has two baseTier approaches whose heights differ
  // by MORE than baseTier — that is the second tread actually doing the traversal work.
  for (const a of (Array.isArray(D.assists) ? D.assists : [])) {
    if (!a || !Array.isArray(a.tiles)) continue; const useful = a.tiles.some((tl) => { const i = Array.isArray(tl) ? c.i(tl[0], tl[1]) : -1; if (!c.walkable(i)) return false;
      const hs = nearBy(c, i, c.i).filter((j) => c.walkable(j) && Math.abs(g.h[j] - g.h[i]) <= base).map((j) => g.h[j]); return hs.some((u) => hs.some((v) => Math.abs(u - v) > base)); });
    if (!useful) add('contract.assist-useless', `assist '${a.aid}' bridges nothing: no stair tile has two baseTier approaches more than ${base}h apart`, { assist: a.aid, tile: a.tiles[0] }); }
}
/** The counterexample a failed seal owes its author: the reachable tile nearest the choke that the escaping flood
 *  actually used, rather than the prototype's bare 'seal' string. */
function leak(c, dist, set) {
  let best = -1; for (let i = 0; i < dist.length; i++) if (dist[i] >= 0 && !set.has(i) && nearBy(c, i, c.i).some((j) => set.has(j)) && (best < 0 || dist[i] < dist[best])) best = i; return best < 0 ? 'the map edge' : `${best % c.w},${(best / c.w) | 0}`;
}
