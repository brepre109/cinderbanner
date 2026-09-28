// The authoring canvas (PLAN §3.4) — the mutable board every primitive writes into, and the
// DECLARATION SINK that is the whole point of the vocabulary.
//
// A hand-authored map file builds H/T with `fill`/`put` and then, separately, hand-writes a
// `design` block describing what it meant. Those two halves rot apart: the terrain edit lands, the
// declaration does not, and the validator has to re-derive intent from geometry it cannot read.
// Here a primitive that cuts a 6h step DECLARES that face in the same call that writes the height,
// so `validateDef` proves an assertion the author actually made and `analyseMap` prices a shortcut
// the author actually intended. Intent is an OUTPUT of authoring, not an archaeology problem.
//
// Zero three.js by construction (PLAN §3.4 / house rule 4): this file, everything under
// primitives/ and everything under procgen/ runs under bare `node` for tools/mapcheck.mjs.
import { FORMAT, SCHEMA_VERSION, DEFAULTS, LETTERS } from './mapformat/schema.js';
import { PROP_SPEC, snapCoord } from './mapformat/propspec.js';
import { NEIGH4 } from './mapformat/graph.js';
import { TIERS } from './analysis/profiles.js';

// props.md §5: void must sit at or below the lowest land so the drop runs to the black skirt in one
// fall instead of stepping onto a visible shelf. The shipped map uses CUT = RIVER - 2; so do we.
export const VOID_DROP = 2;
/** The roster tier a drop rounds UP to. Identical to validate.js's `tierFor`, and deliberately read
 *  off the live roster rather than a copied [4,6,10] table that can rot. */
export const tierFor = (drop) => TIERS.find((t) => t >= drop) ?? Infinity;

const key = (x, z) => x + ',' + z;
const cl = (v, a, b) => (v < a ? a : v > b ? b : v);
// mulberry32: 32 bits of state, one multiply-xor round. Inlined rather than imported from
// procgen/rng.js because a Canvas must be constructible before procgen exists (and it is six lines).
function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Canvas {
  /**
   * @param {{w?:number, d?:number, h?:number, t?:string, id?:string, name?:string, author?:string,
   *          baseTier?:number, tiers?:number[], seed?:number, blurb?:string, notes?:string,
   *          gen?:object|null}} [o]
   */
  constructor(o = {}) {
    const w = this.w = o.w ?? DEFAULTS.size.w, d = this.d = o.d ?? DEFAULTS.size.d;
    this.ground = o.h ?? DEFAULTS.h;
    this.baseTier = o.baseTier ?? DEFAULTS.baseTier;
    this.tiers = (o.tiers ?? DEFAULTS.tiers).slice();
    this.H = Array.from({ length: d }, () => new Array(w).fill(this.ground));
    this.T = Array.from({ length: d }, () => new Array(w).fill(o.t ?? DEFAULTS.t));
    this.props = []; this.spawns = { A: [], B: [] };
    this.faces = []; this.chokes = []; this.routes = []; this.promises = [];
    this.regions = []; this.assists = []; this.waivers = [];
    /** Tiles decoration may never touch: every declared face endpoint, choke tile, route waypoint,
     *  staging/road region and spawn seat lands here as it is declared (PLAN §5.10), so
     *  procgen's scatter cannot obstruct a route the analyser already proved. @type {Set<string>} */
    this.avoid = new Set();
    this.meta = { id: o.id ?? 'untitled', name: o.name ?? 'Untitled', author: o.author ?? DEFAULTS.author,
      blurb: o.blurb ?? '', notes: o.notes ?? '', gen: o.gen ?? null, mood: o.mood ?? null };
    this.seed = o.seed ?? 1; this.rnd = mulberry32(this.seed);
    this._np = 0; this._nid = Object.create(null);
  }

  // ---------------------------------------------------------------------------- grid
  inb(x, z) { return x >= 0 && z >= 0 && x < this.w && z < this.d; }
  hAt(x, z) { return this.inb(x, z) ? this.H[z][x] : null; }
  tAt(x, z) { return this.inb(x, z) ? this.T[z][x] : null; }
  /** True when the LETTER walks — before props and the deck grant, i.e. exactly schema LETTERS.walk. */
  walkAt(x, z) { const L = LETTERS[this.tAt(x, z)]; return !!(L && L.walk); }
  /** Write height and/or letter. Either may be null to leave that channel alone; out of bounds is a
   *  silent no-op, which is what lets a primitive run off the board edge without a guard per call. */
  put(x, z, h = null, t = null) {
    if (!this.inb(x, z)) return this;
    if (h !== null) this.H[z][x] = h;
    if (t !== null) this.T[z][x] = t;
    return this;
  }
  /** Filled rectangle, corners in any order, clamped to the board. */
  fill(x0, z0, x1, z1, h = null, t = null) {
    const ax = cl(Math.min(x0, x1), 0, this.w - 1), bx = cl(Math.max(x0, x1), 0, this.w - 1);
    const az = cl(Math.min(z0, z1), 0, this.d - 1), bz = cl(Math.max(z0, z1), 0, this.d - 1);
    for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) this.put(x, z, h, t);
    return this;
  }
  /** Rectangle OUTLINE — the one-tile ring. Terrace lips, parapet courses and apron moats are rings,
   *  and doing them as four fills is where an off-by-one corner gets written twice. */
  rect(x0, z0, x1, z1, h = null, t = null) {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), az = Math.min(z0, z1), bz = Math.max(z0, z1);
    this.fill(ax, az, bx, az, h, t); this.fill(ax, bz, bx, bz, h, t);
    this.fill(ax, az, ax, bz, h, t); this.fill(bx, az, bx, bz, h, t);
    return this;
  }
  /** Bresenham line — roads, river courses and switchback connectors. */
  line(x0, z0, x1, z1, h = null, t = null) {
    let x = x0, z = z0; const dx = Math.abs(x1 - x0), dz = -Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1; let err = dx + dz;
    for (;;) { this.put(x, z, h, t); if (x === x1 && z === z1) break;
      const e2 = 2 * err; if (e2 >= dz) { err += dz; x += sx; } if (e2 <= dx) { err += dx; z += sz; } }
    return this;
  }
  /** Filled disc, Euclidean — knoll crowns and crater floors. r is a radius in tiles, inclusive. */
  disc(cx, cz, r, h = null, t = null) {
    const rr = r * r;
    for (let z = Math.ceil(cz - r); z <= Math.floor(cz + r); z++)
      for (let x = Math.ceil(cx - r); x <= Math.floor(cx + r); x++)
        if ((x - cx) * (x - cx) + (z - cz) * (z - cz) <= rr) this.put(x, z, h, t);
    return this;
  }
  /** Every walkable in-bounds neighbour of a tile, as [x,z] pairs. */
  neighbours(x, z) { return NEIGH4.map(([dx, dz]) => [x + dx, z + dz]).filter(([nx, nz]) => this.inb(nx, nz)); }

  // ---------------------------------------------------------------------------- props / spawns / decks
  /**
   * Append a prop, stamped with a `pid` and SNAPPED to its own coordinate convention. Snapping here
   * is the cure for props.md §6.3, the most common authoring bug: a house authored at x:4.5 sits
   * half a tile out, a sprite at x:4 lands on the tile corner. edgeFree types are left alone —
   * their value is a real world coordinate on a tile boundary, not a lattice point.
   */
  prop(p) {
    const spec = PROP_SPEC[p.type];
    if (!spec) throw new Error(`Canvas.prop: unknown type '${p.type}' — props.js would drop it silently`);
    const q = { pid: 'p' + String(++this._np).padStart(3, '0'), ...p };
    if (spec.coord !== 'edgeFree') { const [x, z] = snapCoord(p.type, p.x, p.z); q.x = x; q.z = z; }
    this.props.push(q); return q;
  }
  /** A `deck` prop AND nothing else: decks.mode is 'auto', so the walk grant is DERIVED from this
   *  rectangle at compile time and the props.md §3.15 desync ("either alone is a bug") cannot occur. */
  deck(x, z, { len = 1, w = 1, dir = 'z', h = 0, style = 'stone' } = {}) {
    return this.prop({ type: 'deck', x, z, len, w, dir, h, style });
  }
  /** Seat a team. ORDER IS SIGNIFICANT: main.js index-matches spawns[team][i] to roster[team][i]. */
  seat(team, tiles) {
    this.spawns[team] = tiles.map(([x, z]) => [x, z]);
    for (const [x, z] of tiles) this.protect(x, z);
    return this;
  }

  // ---------------------------------------------------------------------------- avoid set
  protect(x, z) { this.avoid.add(key(x, z)); return this; }
  protectTiles(tiles) { for (const [x, z] of tiles) this.protect(x, z); return this; }
  protectRect(x0, z0, x1, z1) {
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.protect(x, z);
    return this;
  }
  isProtected(x, z) { return this.avoid.has(key(x, z)); }

  /**
   * Cut every approach onto `tiles` that the primitive did not declare, by converting the offending
   * neighbour to void. This is what makes "reachable only by a declared vault" true rather than
   * hopeful: a shelf whose long side is merely 6h below a rim is a 6h face at EVERY tile of that
   * side, so the analyser reports a wall of undeclared expresses and the ledge means nothing.
   * Void is the only cut that holds for every class — rules.js walks the 4-neighbour grid one tile
   * at a time, so nothing, not even ignore_height, steps over a void tile.
   * @param {Array<[number,number]>} tiles the shelf/leg block being isolated
   * @param {{except?:Array<[number,number]>, all?:boolean}} [o] `except` names the tiles that MAY
   *   keep their approach (the vault, the switchback's two mouths). `all` cuts EVERY undeclared
   *   approach, legal step or not: a switchback whose legs sit exactly baseTier below the rim they
   *   are cut into is walkable straight down from the rim, and the detour it exists to impose
   *   evaporates. Height alone cannot tell those two cases apart, so the primitive says which it is.
   * @returns {Array<[number,number]>} the tiles converted to void
   */
  isolate(tiles, o = {}) {
    const own = new Set(tiles.map(([x, z]) => key(x, z)));
    const keep = new Set((o.except || []).map(([x, z]) => key(x, z)));
    const cut = [];
    for (const [x, z] of tiles) for (const [nx, nz] of this.neighbours(x, z)) {
      if (own.has(key(nx, nz)) || keep.has(key(nx, nz)) || !this.walkAt(nx, nz)) continue;
      if (!o.all && Math.abs(this.H[nz][nx] - this.H[z][x]) <= this.baseTier) continue;   // a legal step; leave it
      this.T[nz][nx] = 'v'; cut.push([nx, nz]);
    }
    return cut;
  }

  // ---------------------------------------------------------------------------- the declaration sink
  _id(prefix, hint) { const n = (this._nid[prefix] = (this._nid[prefix] || 0) + 1); return `${prefix}${n}${hint ? '_' + hint : ''}`; }
  /**
   * A vertical shortcut edge. `drop` and `tier` are MEASURED off the grid the primitive just wrote,
   * never taken from the caller: validate.js checks drop against |dH| exactly, so a hand-passed
   * number is a bug waiting for a terrain tweak. `from` is the high side by convention.
   * @param {{from:[number,number], to:[number,number], fid?:string, kind?:string, minSaving?:number,
   *          minTurnSaving?:number, note?:string}} o
   */
  declareFace(o) {
    const [ax, az] = o.from, [bx, bz] = o.to, drop = Math.abs(this.hAt(ax, az) - this.hAt(bx, bz));
    const f = { fid: o.fid || this._id('face', `${ax}_${az}`), from: [ax, az], to: [bx, bz], drop,
      tier: tierFor(drop), kind: o.kind || 'express', minTurnSaving: o.minTurnSaving ?? 1, note: o.note || '' };
    if (o.minSaving != null) f.minSaving = o.minSaving;
    this.faces.push(f); this.protect(ax, az); this.protect(bx, bz); return f;
  }
  /** A bottleneck, proven later by deletion. Its tiles join the avoid set: a barrel scattered into a
   *  1-wide door would seal the map with no declaration anywhere saying so. */
  declareChoke(o) {
    const c = { cid: o.cid || this._id('choke'), tiles: o.tiles.map(([x, z]) => [x, z]),
      tier: o.tier ?? this.baseTier, note: o.note || '' };
    this.chokes.push(c); this.protectTiles(c.tiles); return c;
  }
  /** A named rectangle of intent. `scenery` is the one kind the gentleness sweep exempts, so it is
   *  how a primitive states "this relief is a backdrop"; `staging` and `road` additionally protect
   *  their tiles from decoration, because that is exactly what those two kinds are FOR. */
  declareRegion(o) {
    const [x0, z0, x1, z1] = o.rect;
    const r = { rgid: o.rgid || this._id('rg'), kind: o.kind || 'note', rect: [x0, z0, x1, z1], note: o.note || '' };
    this.regions.push(r);
    if (r.kind === 'staging' || r.kind === 'road') this.protectRect(x0, z0, x1, z1);
    return r;
  }
  /** A travel claim per tier. `via` waypoints are what prove the long way round is still the long
   *  way round — a switchback the generator flattened shows up as contract.route-detour. */
  declareRoute(o) {
    const r = { rid: o.rid || this._id('route'), tier: o.tier ?? this.baseTier, from: o.from || 'A',
      to: o.to || 'B', via: (o.via || []).map(([x, z]) => [x, z]), note: o.note || '' };
    this.routes.push(r); this.protectTiles(r.via); return r;
  }
  /** The `stairs` prop doing traversal work. The engine has no ladder entity; the second tread is the
   *  whole mechanism, so the intent has to be declared for the validator to prove it bridges. */
  declareAssist(o) {
    const a = { aid: o.aid || this._id('assist'), kind: o.kind || 'stairs',
      tiles: o.tiles.map(([x, z]) => [x, z]), dir: o.dir || 'n', bridges: { lowH: o.bridges.lowH, highH: o.bridges.highH },
      note: o.note || '' };
    this.assists.push(a); this.protectTiles(a.tiles); return a;
  }
  /** Acceptance in TURNS — the design-facing number, verified against the SLOWEST class in the tier. */
  declarePromise(o) {
    const p = { from: o.from || 'A', to: o.to || 'B', tier: o.tier, savesTurns: o.savesTurns ?? 1 };
    this.promises.push(p); return p;
  }
  /** A reviewed exemption. Every entry states a reason; an unexplained waiver is how a real fault
   *  hides for a release. */
  waive(x, z, code, why) { this.waivers.push({ at: [x, z], code, why }); return this; }

  // ---------------------------------------------------------------------------- output
  /**
   * Enforce the three renderer invariants a primitive cannot see locally, because each is a property
   * of the FINISHED board (terrain.md §4/§5, props.md §5):
   *   1. one h per connected water body — water-water borders emit no side geometry, so a mixed body
   *      leaves an open seam with the bed visible through it. Levelled DOWN, never up, so the body
   *      can never end up standing over its own bank.
   *   2. no void orthogonally adjacent to water — the void's earth face shows through the black cap.
   *      Converted back to grass at the neighbouring land height, three passes, exactly as the
   *      shipped map does, because one pass leaves the tile behind the one it just fixed.
   *   3. every void parked at cutH - 2, below the lowest land, so the black cap falls to the diorama
   *      floor instead of floating as a shelf.
   */
  settle() {
    const isW = (x, z) => this.tAt(x, z) === 'w', isV = (x, z) => this.tAt(x, z) === 'v';
    const seen = new Set();
    for (let z = 0; z < this.d; z++) for (let x = 0; x < this.w; x++) {
      if (!isW(x, z) || seen.has(key(x, z))) continue;
      const body = [], st = [[x, z]]; seen.add(key(x, z));
      while (st.length) { const [cx, cz] = st.pop(); body.push([cx, cz]);
        for (const [nx, nz] of this.neighbours(cx, cz)) if (isW(nx, nz) && !seen.has(key(nx, nz))) { seen.add(key(nx, nz)); st.push([nx, nz]); } }
      const lo = Math.min(...body.map(([bx, bz]) => this.H[bz][bx]));
      for (const [bx, bz] of body) this.H[bz][bx] = lo;
    }
    for (let pass = 0; pass < 3; pass++) for (let z = 0; z < this.d; z++) for (let x = 0; x < this.w; x++) {
      if (!isV(x, z)) continue;
      const wet = this.neighbours(x, z).find(([nx, nz]) => isW(nx, nz));
      if (!wet) continue;
      const land = this.neighbours(x, z).filter(([nx, nz]) => this.walkAt(nx, nz)).map(([nx, nz]) => this.H[nz][nx]);
      this.T[z][x] = 'g'; this.H[z][x] = land.length ? Math.min(...land) : this.H[wet[1]][wet[0]];
    }
    let cut = Infinity;
    for (let z = 0; z < this.d; z++) for (let x = 0; x < this.w; x++) if (!isW(x, z) && !isV(x, z)) cut = Math.min(cut, this.H[z][x]);
    if (!Number.isFinite(cut)) cut = 0;                       // all water / all void: terrain.js's own guard
    for (let z = 0; z < this.d; z++) for (let x = 0; x < this.w; x++) if (isV(x, z)) this.H[z][x] = cut - VOID_DROP;
    return this;
  }

  /** The finished document. settle() runs first, so a Canvas def satisfies the renderer invariants by
   *  construction and the validator's remaining job is the DESIGN contract. @returns {import('./mapformat/schema.js').MapDef} */
  toDef() {
    this.settle();
    const m = this.meta;
    return {
      format: FORMAT, version: SCHEMA_VERSION, id: m.id, name: m.name, author: m.author,
      size: { w: this.w, d: this.d },
      grid: { H: this.H.map((r) => r.slice()), T: this.T.map((r) => r.join('')) },
      props: this.props.map((p) => ({ ...p })),
      spawns: { A: this.spawns.A.map((s) => [s[0], s[1]]), B: this.spawns.B.map((s) => [s[0], s[1]]) },
      decks: { mode: 'auto', tiles: [] },
      design: { baseTier: this.baseTier, tiers: this.tiers.slice(), faces: this.faces, chokes: this.chokes,
        routes: this.routes, promises: this.promises, regions: this.regions, assists: this.assists, waive: this.waivers },
      brief: { blurb: m.blurb, notes: m.notes },
      gen: m.gen, analysis: null, 'x-': m.mood ? { mood: m.mood } : {},   // mood: render/lighting.js MOODS
    };
  }

  // ---------------------------------------------------------------------------- seeded rng
  /** Integer in [a,b]. Every primitive that jitters takes the canvas rng so one seed reproduces the
   *  whole board — a primitive calling Math.random is an unreproducible map. */
  ri(a, b) { return a + Math.floor(this.rnd() * (b - a + 1)); }
  pick(list) { return list[Math.floor(this.rnd() * list.length)]; }
  /** In-place Fisher-Yates from the canvas rng — the deterministic shuffle procgen's scatter needs. */
  shuffle(list) { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(this.rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; }
}

/** Convenience for a one-liner map module: `const c = canvas({w:24,d:20}); ...; export const DEF = c.toDef();` */
export function canvas(o) { return new Canvas(o); }
