// The bridge between the shipped map modules ({ WENDFORD, PROPS, SPAWNS, DECKS }) and the MapDef
// document. It exists so the format can be adopted without rewriting a single authored map: the
// gate `compileMap(fromLegacy(wendford))` deep-equals today's MAP (PLAN §1) is only meaningful
// because fromLegacy is a lossless transcription and not a re-authoring.
//
// Deliberately read-only about the map module: wendford_crossing.js is not edited, so everything
// here works from its EXISTING exports.
import { FORMAT, SCHEMA_VERSION, DEFAULTS, ID_RE, LETTER_OF_ENGINE, LETTER_ALIAS } from './schema.js';
import { derivedDecks } from './compile.js';

/**
 * Transcribe a legacy map module into a MapDef.
 *
 * Lossless for everything the engine reads. What it does NOT invent: `design` comes out empty
 * (every list `[]`) because an authored map's shortcut, choke and route claims are design intent
 * that nobody wrote down — synthesising them here would manufacture assertions the map has never
 * been checked against.
 *
 * `tiers` is the base rung ALONE, not DEFAULTS.tiers. A declared tier is not a description, it is
 * the assertion validate.js reads in `contract.ladder` and catalogue.mjs in `catalogue.ladder-tie`:
 * climbing to it must reach the far spawn in strictly fewer turns than the rung below. Copying the
 * roster ladder [4,6,10] in put that claim in the mouth of every bridged map, and wendford_crossing
 * — the flat control map, whose 6h and 10h subgraphs walk the same 10 steps as its 4h one — then
 * failed a contract it had never signed. One rung asserts only that the map is walkable at base,
 * which is the most a transcription can honestly say; a map that does reward JUMP declares its
 * ladder in a native DEF, where the claim is authored and proved rather than inherited.
 *
 * `decks.mode` is 'auto' when the module's DECKS list is exactly what its `deck` props imply,
 * 'explicit' otherwise; `tiles` is round-tripped either way, so a hand-tuned list is never
 * silently dropped.
 *
 * @param {{WENDFORD:{name:string,w:number,d:number,H:number[][],T:(string|string[])[]},
 *          PROPS?:Object[], SPAWNS?:Object, DECKS?:Array<[number,number]>}} mod
 * @param {{id?:string, author?:string, name?:string}} [opts]
 * @returns {import('./schema.js').MapDef}
 */
export function fromLegacy(mod, opts = {}) {
  const src = mod && (mod.WENDFORD || mod.MAP_SRC);
  if (!src || typeof src !== 'object') throw new TypeError('fromLegacy: module has no WENDFORD export');
  const w = src.w, d = src.d;
  if (!Number.isInteger(w) || !Number.isInteger(d) || w < 1 || d < 1) throw new Error(`fromLegacy: bad size ${w}x${d}`);
  if (!Array.isArray(src.H) || src.H.length !== d) throw new Error(`fromLegacy: H has ${src.H && src.H.length} rows, expected ${d}`);
  if (!Array.isArray(src.T) || src.T.length !== d) throw new Error(`fromLegacy: T has ${src.T && src.T.length} rows, expected ${d}`);

  const name = opts.name ?? src.name ?? 'Untitled';
  const id = opts.id ?? slugify(name);
  if (!ID_RE.test(id)) throw new Error(`fromLegacy: id '${id}' does not match ${ID_RE}`);

  const H = [], T = [];
  for (let z = 0; z < d; z++) {
    const hr = src.H[z], tr = src.T[z];
    if (!hr || hr.length !== w) throw new Error(`fromLegacy: H row ${z} has ${hr && hr.length} cells, expected ${w}`);
    if (!tr || tr.length !== w) throw new Error(`fromLegacy: T row ${z} has ${tr && tr.length} cells, expected ${w}`);
    const hrow = new Array(w), trow = new Array(w);
    for (let x = 0; x < w; x++) { hrow[x] = hr[x]; trow[x] = toSchemaLetter(tr[x], x, z); }
    H.push(hrow); T.push(trow.join(''));
  }

  // pid is assigned here, not authored: p001.. in array order. Array order is already semantic
  // (props.js round-robins sprite variants over it), so index-derived ids are stable for exactly as
  // long as the order is, which is the same guarantee the renderer already lives under.
  const props = (mod.PROPS || []).map((p, i) => ({ pid: 'p' + String(i + 1).padStart(3, '0'), ...p }));

  const spawns = {};
  for (const team of DEFAULTS.teams) spawns[team] = ((mod.SPAWNS || {})[team] || []).map((s) => [s[0], s[1]]);

  const tiles = (mod.DECKS || []).map((t) => [t[0], t[1]]);
  const probe = { props };
  const mode = samePairs(tiles, derivedDecks(probe)) ? 'auto' : 'explicit';

  return {
    format: FORMAT,
    version: SCHEMA_VERSION,
    id,
    name,
    author: opts.author ?? DEFAULTS.author,
    size: { w, d },
    grid: { H, T },
    props,
    spawns,
    decks: { mode, tiles },
    design: { baseTier: DEFAULTS.baseTier, tiers: [DEFAULTS.baseTier], faces: [], chokes: [],
      routes: [], promises: [], regions: [], assists: [], waive: [] },
    brief: { blurb: '', notes: '' },
    gen: null,
    analysis: null,
    'x-': {},
  };
}

/**
 * Emit a MapDef as a legacy map-module source string — the inverse direction, for exporting a
 * built map into the shape mapdata.js already imports. `pid` is dropped (it is a document concept,
 * not an engine one) and fromLegacy re-derives it from array order, so def -> module -> def is a
 * fixed point for every field the engine reads.
 *
 * H and T get one row per line so a one-tile edit stays a one-line diff, which is the same reason
 * PLAN §2 requires it of stringifyDef.
 * @param {import('./schema.js').MapDef} def
 * @returns {string}
 */
export function toLegacyModule(def) {
  const { w, d } = def.size;
  const L = [];
  L.push(`// ${def.name} — generated from the MapDef '${def.id}' by mapformat/legacy.js. Edit the def, not this file.`);
  L.push(`// ${w}x${d}. Heights are in h (1h = 0.25 world units); surface letters are terrain.js TOP_KEY entries.`);
  L.push(`const W = ${w}, D = ${d};`);
  L.push('');
  L.push('const H = [');
  for (const row of def.grid.H) L.push(`  [${row.join(',')}],`);
  L.push('];');
  // Rows are emitted as arrays of letters, not strings, whenever any tile compiles to the one
  // multi-character engine letter ('sand'); mapdata.js reads T[z][x], for which both forms work.
  const engine = def.grid.T.map((row) => Array.from(row, (ch) => LETTER_ALIAS[ch] || ch));
  const multi = engine.some((row) => row.some((c) => c.length > 1));
  L.push('const T = [');
  for (const row of engine) L.push(multi ? `  [${row.map(str).join(',')}],` : `  ${str(row.join(''))}.split(''),`);
  L.push('];');
  L.push('');
  L.push('export const PROPS = [');
  for (const p of def.props || []) L.push(`  ${objLit(p, 'pid')},`);
  L.push('];');
  L.push('');
  L.push('export const SPAWNS = {');
  for (const team of Object.keys(def.spawns || {})) L.push(`  ${team}: [${(def.spawns[team] || []).map(pair).join(', ')}],`);
  L.push('};');
  L.push('');
  L.push('// Tiles a bridge deck makes walkable even though the map still calls them water.');
  L.push(`export const DECKS = [${deckList(def).map(pair).join(', ')}];`);
  L.push('');
  L.push(`export const WENDFORD = { name: ${str(def.name)}, w: W, d: D, H, T };`);
  return L.join('\n') + '\n';
}

// The grant a def actually resolves to. Imported lazily-by-shape rather than from compile.js's
// deckTiles so this module keeps one import edge; 'auto' is the same derivation.
function deckList(def) {
  const dk = def.decks;
  if (!dk) return [];
  return dk.mode === 'explicit' ? (dk.tiles || []) : derivedDecks(def);
}

// One engine letter -> one schema letter. 'sand' is the only multi-character engine letter and the
// only alias (schema.js LETTER_ALIAS). An unrecognised SINGLE character is passed through verbatim:
// the schema calls it the warning `shape.letter`, not an error, and dropping it here would silently
// repaint a tile. Anything else has no representation in a one-char-per-tile grid, so it throws.
function toSchemaLetter(cell, x, z) {
  const c = String(cell);
  const mapped = LETTER_OF_ENGINE[c];
  if (mapped) return mapped;
  if (c.length === 1) return c;
  throw new Error(`fromLegacy: tile [${x},${z}] letter '${c}' is not a known engine letter and is not one character`);
}

function samePairs(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  return true;
}

// 'Wendford Crossing' -> 'wendford_crossing'. Only ever a default; callers pass opts.id when the
// filename stem and the display name disagree, and ID_RE is enforced by fromLegacy either way.
function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

const pair = (p) => `[${p[0]}, ${p[1]}]`;
const str = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Object literal in the source's own key order, so an exported prop reads like a hand-authored one.
function objLit(o, skipKey) {
  const parts = [];
  for (const k in o) {
    if (k === skipKey) continue;
    parts.push(`${IDENT.test(k) ? k : str(k)}: ${val(o[k])}`);
  }
  return `{ ${parts.join(', ')} }`;
}

function val(v) {
  if (typeof v === 'string') return str(v);
  if (Array.isArray(v)) return `[${v.map(val).join(', ')}]`;
  if (v && typeof v === 'object') return objLit(v, null);
  return String(v);
}
