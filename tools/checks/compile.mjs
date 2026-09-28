// PLAN §9.1, the gate the whole toolchain rests on: compileMap(fromLegacy(wendford)) must deep-equal
// the MAP the engine has always been handed. If that fails, every map in the catalogue is compiled by
// something other than what the game reads, and no downstream analysis means anything.
//
// The reference is not a golden JSON blob and not mapdata.js's own output (which now calls compileMap
// and would be comparing the compiler with itself). It is the PREVIOUS mapdata.js builder, transcribed
// verbatim below from commit c131136 and run against the map module's own legacy exports — an
// INDEPENDENT second implementation, which is the only kind of reference a compile-identity test can
// use. Order matters and is preserved exactly: grid -> deck grant -> prop-footprint blocking, so a
// deck tile under a blocking prop is re-closed rather than left walkable.
//
// The second half is round-trip stability: stringifyDef -> parseDef -> stringifyDef byte-identical,
// hashDef stable across it, and the JSON path landing on the same bytes as the module path. That is
// serialize.js's own selfTest, run here against REAL corpus documents rather than a blank def.

const LEGACY_MAP = 'src/world/maps/wendford_crossing.js';

// mapdata.js @ c131136, verbatim. Kept as the assertion target and nothing else: if compile.js ever
// has to change, this is the statement of what the engine used to see, and the diff is the review.
const HISTORIC_BLOCKING = new Set(['house', 'tower', 'ruin', 'pillar', 'well', 'barrel', 'crate', 'cart', 'woodpile',
  'trough', 'lamp', 'signpost', 'hay', 'grave', 'oak', 'pine', 'rock', 'rock_small', 'fence', 'stall']);
function historicFootprint(p) {
  if (p.type === 'house' || p.type === 'tower') { const out = []; for (let z = p.z; z < p.z + p.d; z++) for (let x = p.x; x < p.x + p.w; x++) out.push([x, z]); return out; }
  if (p.type === 'fence' || p.type === 'ruin') { const out = []; for (let i = 0; i < p.len; i++) out.push(p.dir === 'x' ? [p.x + i, p.z] : [p.x, p.z + i]); return out; }
  if (HISTORIC_BLOCKING.has(p.type)) return [[Math.floor(p.x), Math.floor(p.z)]];
  return [];
}
function historicMap(mod) {
  const src = mod.WENDFORD;
  const MAP = { name: src.name, w: src.w, d: src.d, tiles: [], props: mod.PROPS, spawns: mod.SPAWNS };
  for (let z = 0; z < MAP.d; z++) {
    const row = [];
    for (let x = 0; x < MAP.w; x++) {
      const t = src.T[z][x], h = src.H[z][x], vd = t === 'v';
      row.push({ x, z, h, t, water: t === 'w', void: vd, walk: t !== 'w' && !vd });
    }
    MAP.tiles.push(row);
  }
  for (const [x, z] of (mod.DECKS || [])) { const t = MAP.tiles[z]?.[x]; if (t) { t.walk = true; t.deck = true; } }
  MAP.at = (x, z) => (x >= 0 && z >= 0 && x < MAP.w && z < MAP.d) ? MAP.tiles[z][x] : null;
  for (const p of MAP.props) for (const [x, z] of historicFootprint(p)) { const t = MAP.at(x, z); if (t) t.walk = false; }
  return MAP;
}

// Structural diff down to the first few mismatches. `at` is a function on both sides and is compared
// by behaviour (below), never by identity; everything else must match key for key and value for value.
function diff(a, b, path, out, cap) {
  if (out.length >= cap) return out;
  if (a === b) return out;
  if (typeof a === 'function' || typeof b === 'function') return out;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    out.push(`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(`${path}: array/object mismatch`); return out; }
  const ka = Object.keys(a), kb = Object.keys(b);
  for (const k of new Set([...ka, ...kb])) {
    if (k === 'at') continue;
    if (!(k in a)) { out.push(`${path}.${k}: missing on the compiled MAP`); continue; }
    if (!(k in b)) { out.push(`${path}.${k}: extra on the compiled MAP (${JSON.stringify(a[k])})`); continue; }
    diff(a[k], b[k], `${path}.${k}`, out, cap);
    if (out.length >= cap) return out;
  }
  return out;
}

export function register(registerCheck, api) {
  registerCheck({
    id: 'compile.gate',
    scope: 'property',
    title: 'compileMap(fromLegacy(wendford)) deep-equals the historical MAP',
    fn: async (ctx) => {
      const { compileMap, fromLegacy } = ctx.core;
      if (!compileMap || !fromLegacy) return { code: 'compile.skipped', severity: 'info', msg: 'compile.js or legacy.js is not present' };
      const mod = await api.opt(LEGACY_MAP);
      if (!mod || !mod.WENDFORD) return { code: 'compile.skipped', severity: 'info', msg: `${LEGACY_MAP} exports no WENDFORD set` };
      const want = historicMap(mod), got = compileMap(fromLegacy(mod, { id: 'wendford_crossing' }));
      const out = [];
      for (const line of diff(got, want, 'MAP', [], 8)) out.push({ code: 'compile.identity', severity: 'error', msg: line });
      // at() outside the rectangle must be null, never a stub tile: rules.js does `if (!t) continue`
      // on every neighbour, and a stub would let a unit walk off the board (PLAN §9.1).
      for (const [x, z] of [[-1, 0], [0, -1], [got.w, 0], [0, got.d], [got.w, got.d], [-1, -1]]) {
        if (got.at(x, z) !== null) out.push({ code: 'compile.at-oob', severity: 'error', msg: `MAP.at(${x},${z}) returned a tile instead of null` });
      }
      let walk = 0, deck = 0;
      for (const row of got.tiles) for (const t of row) { if (t.walk) walk++; if (t.deck) deck++; }
      out.push({ code: 'compile.gate-ok', severity: 'info', msg: `${got.w}x${got.d}, ${got.props.length} props, ${walk} walkable, ${deck} deck-granted tiles match the historical builder` });
      return out;
    },
  });

  registerCheck({
    id: 'compile.roundtrip',
    scope: 'map',
    title: 'stringifyDef/parseDef/hashDef round-trip stability',
    fn: async (entry) => {
      if (!entry.def) return { code: 'compile.skipped', severity: 'info', msg: `${entry.id} has no def` };
      const S = await import(new URL('../../src/world/mapformat/serialize.js', import.meta.url).href);
      const out = [];
      for (const line of S.selfTest(entry.def)) out.push({ code: 'compile.roundtrip', severity: 'error', msg: `${entry.id}: ${line}` });
      // Two hops, not one: a writer that loses a field on the FIRST pass and is stable afterwards
      // still round-trips byte-for-byte from the second hop on, and selfTest alone would call it clean.
      const once = S.parseDef(S.stringifyDef(entry.def));
      if (S.hashDef(entry.def) !== S.hashDef(once)) out.push({ code: 'compile.roundtrip', severity: 'error', msg: `${entry.id}: hash changed on the first module round trip (${S.hashDef(entry.def)} -> ${S.hashDef(once)}); a field was dropped or coerced by the writer` });
      out.push({ code: 'compile.roundtrip-ok', severity: 'info', msg: `${entry.id}: hash ${S.hashDef(entry.def)}, ${S.stringifyDef(entry.def).length} bytes of module source` });
      return out;
    },
  });

  // Compiling a document twice must give the same MAP, and compiling must not write through into the
  // document: compileMap copies props and spawn pairs for exactly that reason, and an editor stroke
  // that mutated MAP.props would otherwise corrupt the def it came from with no visible symptom.
  registerCheck({
    id: 'compile.pure',
    scope: 'map',
    title: 'compileMap is deterministic and never mutates the def',
    fn: (entry, ctx) => {
      const { compileMap } = ctx.core;
      if (!compileMap || !entry.def) return { code: 'compile.skipped', severity: 'info', msg: 'no compiler or no def' };
      const before = JSON.stringify(entry.def);
      const a = compileMap(entry.def), b = compileMap(entry.def);
      const out = [];
      for (const line of diff(a, b, 'MAP', [], 4)) out.push({ code: 'compile.nondeterministic', severity: 'error', msg: `${entry.id}: two compiles of one def differ at ${line}` });
      if (JSON.stringify(entry.def) !== before) out.push({ code: 'compile.mutates-def', severity: 'error', msg: `${entry.id}: compileMap wrote through into the document` });
      if (a.props.length && entry.def.props.length && a.props[0] === entry.def.props[0]) out.push({ code: 'compile.aliases-props', severity: 'error', msg: `${entry.id}: MAP.props[0] is the def's own object, so a downstream mutation writes into the document` });
      return out;
    },
  });
}
