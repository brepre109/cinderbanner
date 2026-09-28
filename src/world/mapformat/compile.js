// def -> MAP. The one function the whole toolchain is gated on: `compileMap(fromLegacy(wendford))`
// must deep-equal the MAP that src/world/mapdata.js builds today, tile for tile and flag for flag
// (PLAN §1). Every line below is a transcription of mapdata.js, not an improvement on it — if this
// file and mapdata.js ever disagree, mapdata.js is right and this is the bug.
//
// Pure and deterministic: `def` is never mutated, no Date/Math.random/iteration-order dependency,
// and the same def always yields a structurally identical MAP. Zero imports beyond schema.js, so
// this runs under bare `node` in tools/mapcheck.mjs.
import { LETTER_ALIAS } from './schema.js';

/**
 * What buildTerrain / buildProps / rules.js actually read off a compiled map (terrain.md §1,
 * props.md §1). Documentation, not a validator: it is here so a worker adding a MAP field has one
 * place to record it and one place to discover that `t.x`/`t.z`/`t.walk`/`t.deck` are never read by
 * terrain.js while `map.at` absolutely is — a plain data object without `.at` throws in the first
 * neighbour lookup.
 */
export const MAP_SHAPE = Object.freeze({
  map: Object.freeze(['name', 'w', 'd', 'tiles', 'props', 'spawns', 'at']),
  tile: Object.freeze(['x', 'z', 'h', 't', 'water', 'void', 'walk']),
  tileOptional: Object.freeze(['deck']),   // added ONLY on granted deck tiles, exactly as mapdata.js does
  mapOptional: Object.freeze(['brief', 'mood', 'deploy']),   // added only when def.brief carries text / def['x-'].mood is set (see compileMap)
  note: 'tiles is a full d x w rectangle indexed [z][x]; at(x,z) returns null off-map. See terrain.md §1.',
});

/** Prop types that clear walk on the tiles they stand on. Verbatim mapdata.js:28 — the order of the
 *  entries is the order of the shipped Set literal so a diff against it reads as a diff. */
export const BLOCKING = new Set(['house', 'tower', 'ruin', 'pillar', 'well', 'barrel', 'crate', 'cart', 'woodpile',
  'trough', 'lamp', 'signpost', 'hay', 'grave', 'oak', 'pine', 'rock', 'rock_small', 'fence', 'stall', 'palm',
  // R15 story dressing (maps owner; mirrors propspec.js)
  'tent', 'wagon', 'organ', 'belfry', 'cryptwall', 'campfire', 'brazier', 'candelabra', 'sarcophagus', 'pew', 'throne']);
const RECT_TYPES = new Set(['tent', 'wagon', 'organ', 'belfry']);   // R15: NW-corner rectangles like house/tower

/**
 * Tiles a prop blocks. Verbatim mapdata.js:30, including its sharp edges:
 *   - house/tower use p.w / p.d RAW, with no rot swap; omit either and `p.z + undefined` is NaN, the
 *     loop runs zero times and the prop silently blocks nothing (props.md §1).
 *   - fence/ruin walk `p.len` tiles along p.dir, where 'x' means +x and ANYTHING else means +z.
 *   - every other BLOCKING type floors its centre to one tile; a pillar at x:14.5 blocks tile 14.
 *   - everything else is walk-through and returns [].
 * @param {{type:string, x:number, z:number, [k:string]:any}} p
 * @returns {Array<[number, number]>}
 */
export function footprint(p) {
  if (p.type === 'house' || p.type === 'tower') { const out = []; for (let z = p.z; z < p.z + p.d; z++) for (let x = p.x; x < p.x + p.w; x++) out.push([x, z]); return out; }
  if (RECT_TYPES.has(p.type)) { const out = []; for (let z = p.z; z < p.z + p.d; z++) for (let x = p.x; x < p.x + p.w; x++) out.push([x, z]); return out; }
  if (p.type === 'fence' || p.type === 'ruin' || p.type === 'cryptwall') { const out = []; for (let i = 0; i < p.len; i++) out.push(p.dir === 'x' ? [p.x + i, p.z] : [p.x, p.z + i]); return out; }
  if (BLOCKING.has(p.type)) return [[Math.floor(p.x), Math.floor(p.z)]];
  return [];
}

/**
 * The walk grant implied by the map's `deck` props — the schema-level cure for the deck-prop /
 * DECKS desync props.md §3.15 calls "either alone is a bug".
 *
 * Rectangle per props.md §3.15: `len` tiles along `dir` and `w` tiles ACROSS it, from the NW corner
 * (x,z); dir 'x' spans +x, anything else spans +z; both extents default to 1. Emitted z-outer /
 * x-inner, which is the order the shipped `deckOver()` helper pushes, so a legacy DECKS array and
 * its derived twin compare element-for-element and not merely as sets.
 * @param {import('./schema.js').MapDef} def
 * @returns {Array<[number, number]>}
 */
export function derivedDecks(def) {
  const out = [];
  for (const p of (def.props || [])) {
    if (!p || p.type !== 'deck') continue;
    const len = p.len ?? 1, wid = p.w ?? 1;
    const lx = p.dir === 'x' ? len : wid, lz = p.dir === 'x' ? wid : len;
    for (let z = p.z; z < p.z + lz; z++) for (let x = p.x; x < p.x + lx; x++) out.push([x, z]);
  }
  return out;
}

/**
 * Compile a MapDef into the MAP object every runtime system reads.
 *
 * Order of operations is load-bearing and matches mapdata.js exactly:
 *   1. base flags from the letter:  water = t==='w', void = t==='v', walk = t!=='w' && !void
 *   2. the DECK grant sets walk = true AND deck = true, while t / water stay 'w' / true
 *   3. the prop footprint pass clears walk — AFTER the grant, so a blocking prop on a deck re-closes it
 * Swap 2 and 3 and the shipped bridges become impassable.
 *
 * @param {import('./schema.js').MapDef} def
 * @param {{keepPid?:boolean, decks?:Array<[number,number]>}} [opts]
 *        keepPid — keep the editor-owned `pid` on MAP.props. Default false: pid is document
 *                  metadata, and MAP.props must stay byte-comparable with the shipped PROPS array.
 *        decks   — override the grant list entirely (the editor's deck brush previews with it).
 * @returns {{name:string, w:number, d:number, tiles:Object[][], props:Object[], spawns:Object, at:Function}}
 */
export function compileMap(def, opts = {}) {
  const w = def.size.w, d = def.size.d;
  const H = def.grid.H, T = def.grid.T;
  const props = (def.props || []).map((p) => copyProp(p, opts.keepPid === true));
  const spawns = copySpawns(def.spawns);
  const MAP = { name: def.name, w, d, tiles: [], props, spawns };
  for (let z = 0; z < d; z++) {
    const hRow = H[z], tRow = T[z];
    // A grid narrower or shorter than the declared size is a caller bug — normalizeDef and
    // validate.js both guarantee exact d rows of w — but the unguarded version failed twice over:
    // a MISSING row died as `Cannot read properties of undefined (reading '0')` with no clue which
    // row, and a merely SHORT row never threw at all, quietly emitting h:undefined / t:undefined
    // tiles that first surface as NaN edge weights inside jumpgraph. Name the row instead.
    // Length, not type, is checked: T rows are strings in the schema but the legacy bridge also
    // hands over arrays of engine names, and tRow[x] reads both.
    if (!hRow || hRow.length < w || !tRow || tRow.length < w) {
      throw new Error(`compileMap: grid row ${z} is not ${w} wide (H=${hRow ? hRow.length : 'missing'}, T=${tRow ? tRow.length : 'missing'}) — normalize or validate the def first`);
    }
    const row = [];
    for (let x = 0; x < w; x++) {
      // 'S' is the schema's single-character stand-in for terrain.js's one multi-character TOP_KEY
      // entry, 'sand'. It is the ONLY alias; every other letter reaches the engine unchanged, and an
      // unknown one is passed through so terrain.js's dirt fallback (a warning, not a crash) still
      // renders — schema.js LETTER_ALIAS / LETTERS.
      const ch = tRow[x], t = LETTER_ALIAS[ch] || ch, vd = t === 'v';
      row.push({ x, z, h: hRow[x], t, water: t === 'w', void: vd, walk: t !== 'w' && !vd });
    }
    MAP.tiles.push(row);
  }
  // Bridge decks: the tile stays WATER so terrain keeps drawing the river running under the span,
  // but the deck prop lays a walking surface over it, so the rules must see walkable ground.
  const grant = opts.decks || deckTiles(def);
  for (const [x, z] of grant) { const t = MAP.tiles[z]?.[x]; if (t) { t.walk = true; t.deck = true; } }

  MAP.at = (x, z) => (x >= 0 && z >= 0 && x < MAP.w && z < MAP.d) ? MAP.tiles[z][x] : null;

  for (const p of MAP.props) for (const [x, z] of footprint(p)) { const t = MAP.at(x, z); if (t) t.walk = false; }

  // Player-facing text, attached only when the map actually carries some. An always-present empty
  // `brief` would put a key on MAP that today's shipped map does not have, and MAP equality with
  // mapdata.js is the gate this whole toolchain rests on.
  const brief = def.brief;
  if (brief && (brief.blurb || brief.notes)) MAP.brief = { blurb: brief.blurb || '', notes: brief.notes || '' };
  // Lighting mood (R7 maps): read from the schema's free `x-` namespace, attached ONLY when declared, for the
  // same reason as `brief` -- the shipped map declares none (it IS the default 'dusk' look) and keeps its key set.
  const mood = def['x-'] && def['x-'].mood;
  if (typeof mood === 'string' && mood) MAP.mood = mood;
  // R15 deploy zone (maps owner; read by src/ui/deploy.js as MAP.deploy.A): extra tiles the company may deploy on
  // beyond its five spawns. Same rule as mood -- attached only when declared, copied, never aliased.
  const dep = def['x-'] && def['x-'].deploy;
  if (dep && Array.isArray(dep.A)) MAP.deploy = { A: dep.A.filter((t) => Array.isArray(t)).map((t) => [t[0], t[1]]) };
  return MAP;
}

/** The grant list a def resolves to: derived from the deck props under mode 'auto' (desync
 *  impossible), or the hand-tuned list under 'explicit'. A missing `decks` block means no grant. */
export function deckTiles(def) {
  const dk = def.decks;
  if (!dk) return [];
  if (dk.mode === 'explicit') return (dk.tiles || []).map((t) => [t[0], t[1]]);
  return derivedDecks(def);
}

// Props reach MAP as shallow copies: props.js only ever reads them, but sharing the def's objects
// would let a downstream mutation (an editor stroke, a prop-blocking experiment) write through into
// the document. `pid` is dropped unless asked for — see compileMap's opts.
function copyProp(p, keepPid) {
  const out = {};
  for (const k in p) { if (k === 'pid' && !keepPid) continue; out[k] = p[k]; }
  return out;
}

// Spawn pairs are copied, not aliased, for the same reason — and because main.js index-matches
// spawns[team][i] to roster[team][i], so a mutated pair silently redeploys a class.
function copySpawns(s) {
  const out = {};
  for (const team of Object.keys(s || {})) out[team] = (s[team] || []).map((p) => [p[0], p[1]]);
  return out;
}
