// The FROZEN MapDef vocabulary (PLAN §2). compile / validate / normalize / serialize / legacy, the
// analysers, procgen and the editor all code against these constants; none of them may invent a
// letter, a kind or a bound of its own. A change here is a SCHEMA_VERSION bump plus a MIGRATIONS
// entry, never an edit in place — maps on disk and in localStorage outlive the code that wrote them.
//
// Zero imports, deliberately: this module runs under bare `node` (tools/mapcheck.mjs) and inside the
// vite bundle, so it can never reach for three.js or for the game tables in src/game/data.js.

export const FORMAT = 'cinderbanner.mapdef';   // guards against parsing a the prototype json or a random object
export const SCHEMA_VERSION = 1;

// ^[a-z][a-z0-9_]{1,47}$ — the loader whitelist key, and the map's filename stem. Never
// interpolated into an import() specifier; mapregistry.js holds explicit import thunks instead.
export const ID_RE = /^[a-z][a-z0-9_]{1,47}$/;

// Extent. 8 is the smallest board two 5-unit rosters can deploy on. 48 is measured, not arbitrary:
// buildTerrain over the shipped 20x20 is ~50 ms steady-state, so 48x48 is ~290 ms per commit.
export const SIZE_MIN = 8, SIZE_WARN = 32, SIZE_MAX = 48;

// Height bounds, in h steps (rules.js HEIGHT_STEP = 2; terrain.js renders h * HSTEP 0.25).
// The two FLOOR values are terrain.js's hard geometry limits (terrain.md §3): below them the black
// skirt quad inverts and the bottom cap at Y(-8) punches up through the terrain / the water bed.
// They are EXCLUSIVE. H_MIN/H_MAX are the integer range the validator enforces, well inside them.
export const H_FLOOR_LAND = -8, H_FLOOR_WATER = -5.36;
export const H_MIN = -7, H_MAX = 60;

/**
 * Surface letters. This table is exactly what terrain.js accepts (terrain.md §2) — TOP_KEY is
 * {g,k,d,s,b,r,sand}, and 'w'/'v' are read as the t.water / t.void FLAGS, never as letters.
 * Nothing here is invented; an unlisted character is the WARNING `shape.letter`, not an error
 * (terrain.js falls back to the dirt top with no fringe and no spill; rules.js falls back to
 * EARTHSONG.g), so we report it and keep rendering.
 *
 *   engine   — the letter written onto MAP tiles. Only 'S' differs from its key (see LETTER_ALIAS).
 *   walk     — the BASE walk flag, before the DECKS grant and before the prop-footprint pass.
 *              Matches mapdata.js exactly: walk = (letter !== 'w' && !void).
 *   water    — sets t.water; terrain.js's water pass and rules.js's terrain_walker/Float key off it.
 *   void     — sets t.void; terrain.js's at() returns null for the tile, so it reads as off-map.
 *   earthsong — the EARTHSONG key the engine letter actually resolves to (src/game/data.js:356).
 *              'sand' has no row there, so sand silently grants the grass element; recorded here
 *              so the editor can show the truth rather than the intent.
 * @type {Readonly<Record<string, Readonly<{engine:string, walk:boolean, water:boolean, void:boolean, label:string, earthsong:string|null}>>>}
 */
export const LETTERS = Object.freeze({
  g: Object.freeze({ engine: 'g',    walk: true,  water: false, void: false, label: 'grass',            earthsong: 'g' }),
  k: Object.freeze({ engine: 'k',    walk: true,  water: false, void: false, label: 'dark grass/turf',  earthsong: 'k' }),
  d: Object.freeze({ engine: 'd',    walk: true,  water: false, void: false, label: 'dirt road',        earthsong: 'd' }),
  s: Object.freeze({ engine: 's',    walk: true,  water: false, void: false, label: 'stone flags',      earthsong: 's' }),
  b: Object.freeze({ engine: 'b',    walk: true,  water: false, void: false, label: 'wood plank',       earthsong: 'b' }),
  r: Object.freeze({ engine: 'r',    walk: true,  water: false, void: false, label: 'bare rock',        earthsong: 'r' }),
  S: Object.freeze({ engine: 'sand', walk: true,  water: false, void: false, label: 'sand/shingle',     earthsong: 'g' }),
  w: Object.freeze({ engine: 'w',    walk: false, water: true,  void: false, label: 'water',            earthsong: 'w' }),
  v: Object.freeze({ engine: 'v',    walk: false, water: false, void: true,  label: 'void',             earthsong: null }),
});

// The ONLY alias, applied in compileMap and inverted in stringifyDef. It exists because TOP_KEY's
// sand entry is the one multi-character engine letter and grid.T is one CHARACTER per tile; a
// sparse override map would be a second code path for a single case.
export const LETTER_ALIAS = Object.freeze({ S: 'sand' });
// Inverse, so serialize/legacy do not each hand-roll it and drift.
export const LETTER_OF_ENGINE = Object.freeze({ g: 'g', k: 'k', d: 'd', s: 's', b: 'b', r: 'r', sand: 'S', w: 'w', v: 'v' });

// design.faces[].kind — the shortcut taxonomy priced by analysis/classify.js (PLAN §4.5).
export const TIER_KINDS = Object.freeze(['gate', 'express', 'local', 'cosmetic', 'trap']);
// design.regions[].kind. 'scenery' is load-bearing: it is the one exemption from the gentleness
// sweep, which is how a map carries dramatic relief with zero risk of an accidental shortcut.
export const REGION_KINDS = Object.freeze(['staging', 'road', 'scenery', 'perch', 'hazard', 'note']);
// design.assists[].kind — FABLE has no ladder or rope entity; the `stairs` prop is the only aid.
export const ASSIST_KINDS = Object.freeze(['stairs']);
export const DECK_MODES = Object.freeze(['auto', 'explicit']);
export const TEAMS = Object.freeze(['A', 'B']);

export const DEFAULTS = Object.freeze({
  author: 'hand',
  size: Object.freeze({ w: 20, d: 20 }),
  h: 6,                 // TOWN in the Wendford vocabulary: mid-board, room to cut down and build up
  t: 'g',
  deckMode: 'auto',
  baseTier: 4,          // the roster majority: 15 of 32 classes sit at max |dh| = 4h
  tiers: Object.freeze([4, 6, 10]),
  spawnsPerTeam: 5,     // EXACTLY 5 — main.js index-matches spawns[team][i] to roster[team][i]
  teams: TEAMS,
});

// Canonical key order for stringifyDef/toJson. One place, so the serializer and any future
// migration write the same document shape and a one-tile edit stays a one-line diff.
export const KEY_ORDER = Object.freeze(['format', 'version', 'id', 'name', 'author', 'size', 'grid',
  'props', 'spawns', 'decks', 'design', 'brief', 'gen', 'analysis', 'x-']);
export const DESIGN_KEY_ORDER = Object.freeze(['baseTier', 'tiers', 'faces', 'chokes', 'routes',
  'promises', 'regions', 'assists', 'waive']);

/**
 * A blank, VALID document: full-size grids at one height and one letter, and five spawns per team
 * seated on opposite edges. Blank means empty of design, not empty of structure — a doc that fails
 * `spawn.count` the instant it is created would make every editor session open on a red panel.
 * @param {{w?:number, d?:number, h?:number, t?:string, id?:string, name?:string}} [o]
 * @returns {MapDef}
 */
export function blankDef(o = {}) {
  const w = o.w ?? DEFAULTS.size.w, d = o.d ?? DEFAULTS.size.d;
  const h = o.h ?? DEFAULTS.h, t = o.t ?? DEFAULTS.t;
  const row = String(t).repeat(w);
  // Centred five-wide files, clamped so an 8-wide board still seats both teams in bounds.
  const x0 = Math.max(0, Math.min(w - 5, Math.floor(w / 2) - 2));
  const seat = (z) => [0, 1, 2, 3, 4].map((i) => [x0 + i, z]);
  return {
    format: FORMAT, version: SCHEMA_VERSION,
    id: o.id ?? 'untitled', name: o.name ?? 'Untitled', author: DEFAULTS.author,
    size: { w, d },
    grid: { H: Array.from({ length: d }, () => new Array(w).fill(h)), T: Array.from({ length: d }, () => row) },
    props: [],
    spawns: { A: seat(d - 2), B: seat(1) },
    decks: { mode: DEFAULTS.deckMode, tiles: [] },
    design: { baseTier: DEFAULTS.baseTier, tiers: DEFAULTS.tiers.slice(), faces: [], chokes: [],
      routes: [], promises: [], regions: [], assists: [], waive: [] },
    brief: { blurb: '', notes: '' },
    gen: null,
    analysis: null,
    'x-': {},
  };
}

/**
 * MIGRATIONS[n] lifts a version-n document to n+1. Numbers are never reused, and a migration must
 * not mutate its input — migrate() clones first, but a migration that returns a shared subobject
 * would still alias. Empty at v1: there is nothing older than the first format.
 * @type {Record<number, (def:MapDef)=>MapDef>}
 */
export const MIGRATIONS = {};

/**
 * Lift a document to SCHEMA_VERSION. Pure: the argument is never mutated.
 * Throws rather than guessing — a document whose format is wrong is not a map, and one from the
 * future cannot be down-converted by code that has never seen its fields.
 * @param {MapDef} def
 * @returns {MapDef}
 */
export function migrate(def) {
  if (!def || typeof def !== 'object') throw new TypeError('migrate: not an object');
  if (def.format !== FORMAT) throw new Error(`migrate: format '${def.format}' is not '${FORMAT}'`);
  let v = def.version;
  if (!Number.isInteger(v) || v < 1) throw new Error(`migrate: version '${def.version}' is not a positive integer`);
  if (v > SCHEMA_VERSION) throw new Error(`migrate: version ${v} is newer than this build (${SCHEMA_VERSION})`);
  let out = clone(def);
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (typeof step !== 'function') throw new Error(`migrate: no MIGRATIONS[${v}]`);
    out = step(out);
    if (out.version !== v + 1) out.version = v + 1;   // a migration that forgets to stamp is still a migration
    v = out.version;
  }
  return out;
}

// structuredClone is in node >= 17 and every browser we target; the JSON path is the belt-and-braces
// fallback and is only ever reached on a plain-data document, which a MapDef always is.
function clone(o) {
  return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o));
}

// ---------------------------------------------------------------------------------------------
// Types. Every worker codes against these; they are the JSDoc form of PLAN §2 and nothing more.
// ---------------------------------------------------------------------------------------------
/** @typedef {{w:number, d:number}} MapSize */
/** H[z][x] integer h steps, d rows of w; T[z][x] one letter per tile, d strings of length w.
 *  @typedef {{H:number[][], T:string[]}} MapGrid */
/** A verbatim props.js descriptor plus the editor-owned `pid`. props.js ignores unknown fields, so
 *  pid rides along and gives undo, the inspector and issue anchoring a stable handle across
 *  reorders. ARRAY ORDER IS SEMANTIC: props.js round-robins multi-PNG sprite variants over it.
 *  @typedef {{pid?:string, type:string, x:number, z:number, [k:string]:any}} PropDef */
/** Exactly 5 per team, ORDER SIGNIFICANT: slot i deploys roster[team][i].
 *  @typedef {{A:Array<[number,number]>, B:Array<[number,number]>}} SpawnTable */
/** The walk grant over live water. 'auto' derives tiles from every type:'deck' prop rectangle at
 *  compile time, which kills the prop/grant desync at the schema level. `tiles` is always
 *  round-tripped even when unused. @typedef {{mode:'auto'|'explicit', tiles:Array<[number,number]>}} DeckGrant */
/** A declared vertical shortcut edge. `from`/`to` are orthogonally adjacent walkable tiles; `drop`
 *  is validated to equal |dH| EXACTLY; `tier` is `drop` rounded up to a roster tier.
 *  @typedef {{fid:string, from:[number,number], to:[number,number], drop:number, tier:number,
 *             kind:'gate'|'express'|'local'|'cosmetic'|'trap', minSaving?:number,
 *             minTurnSaving?:number, note?:string}} FaceDef */
/** A claimed bottleneck, proven by deletion: remove `tiles`, re-BFS at `tier`, require the far spawn
 *  set unreachable. @typedef {{cid:string, tiles:Array<[number,number]>, tier:number, note?:string}} ChokeDef */
/** A travel claim per tier, verified as a shortest path. `via` waypoints assert the path really does
 *  go the long way round, so a switchback the generator optimised away is a failure, not a shrug.
 *  @typedef {{rid:string, tier:number, from:'A'|'B', to:'A'|'B', via:Array<[number,number]>, note?:string}} RouteDef */
/** Acceptance stated in TURNS, not steps: turns(d, move) = ceil((d - 1) / move), the -1 because you
 *  attack from an adjacent tile. @typedef {{from:'A'|'B', to:'A'|'B', tier:number, savesTurns:number}} PromiseDef */
/** rect is [x0,z0,x1,z1] inclusive. @typedef {{rgid:string, kind:'staging'|'road'|'scenery'|'perch'|'hazard'|'note',
 *             rect:[number,number,number,number], note?:string}} RegionDef */
/** A declared `stairs` prop doing traversal work: its second tread lets ONE tile bridge a 2h terrace
 *  break that would otherwise be a 4h step. @typedef {{aid:string, kind:'stairs',
 *             tiles:Array<[number,number]>, dir:string, bridges:{lowH:number, highH:number}, note?:string}} AssistDef */
/** A reviewed exemption from the gentleness sweep. Every entry states its reason.
 *  @typedef {{at:[number,number], code:string, why:string}} WaiverDef */
/** @typedef {{baseTier:number, tiers:number[], faces:FaceDef[], chokes:ChokeDef[], routes:RouteDef[],
 *             promises:PromiseDef[], regions:RegionDef[], assists:AssistDef[], waive:WaiverDef[]}} DesignDef */
/** Player-facing text, copied onto MAP by compileMap so the shell can show a pre-battle card.
 *  @typedef {{blurb:string, notes:string}} BriefDef */
/** Provenance, null on hand-authored maps: enough to reproduce the map from its seed alone.
 *  @typedef {{generator:string, seed:number, attempt:number, orient:number, params:Object,
 *             repairs?:string[]}} GenDef */
/** CACHE ONLY — regenerated on demand, never trusted, but committed so CI can diff it. `hash` is
 *  FNV-1a over the canonical serialization of everything above `analysis`.
 *  @typedef {{ladderTurns:Record<string,number>, ladderSteps:Record<string,number>,
 *             faceSavings:Object, pockets:Array<Object>, hash:string}} AnalysisCache */
/** A validator finding. Shape owned by validate.js; repeated here because every panel and every
 *  check function in tools/mapcheck.mjs consumes it.
 *  @typedef {{code:string, severity:'error'|'warn'|'info', msg:string, at?:Object,
 *             fix?:{label:string, apply:(def:MapDef)=>MapDef}}} MapIssue */
/**
 * @typedef {Object} MapDef
 * @property {'cinderbanner.mapdef'} format
 * @property {number} version
 * @property {string} id            must match ID_RE and equal the filename stem
 * @property {string} name
 * @property {string} author        'hand' | 'procgen:<archetype>' | 'editor'
 * @property {MapSize} size
 * @property {MapGrid} grid
 * @property {PropDef[]} props
 * @property {SpawnTable} spawns
 * @property {DeckGrant} decks
 * @property {DesignDef} design
 * @property {BriefDef} brief
 * @property {GenDef|null} gen
 * @property {AnalysisCache|null} analysis
 * @property {Object} x-            unknown keys preserved VERBATIM by normalizeDef and written back
 *                                  by stringifyDef. An importer that drops unknown fields is a
 *                                  data-loss bug; ours reports and keeps.
 */
