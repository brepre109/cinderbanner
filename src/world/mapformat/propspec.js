// Machine-readable transcription of the buildProps() contract (contracts/props.md, cross-checked line by
// line against src/world/props.js and src/world/mapdata.js). This is the SINGLE place a prop's coordinate
// convention, blocking rule and field list is written down: the editor's inspector is generated from
// PROP_SPEC and the stamp transforms are keyed on PROP_SPEC[t].coord. props.js validates nothing and
// silently drops an unrecognised type, so a mistake here is invisible at runtime — hence selfTest(),
// which re-derives BLOCKING from mapdata.js's list and re-proves rot90^4 = identity on every convention.
// Zero imports, deliberately: this module runs under bare `node` for tools/mapcheck.mjs.

export const SPRITE_MAX_W = 1.58;   // props.js:62 — every billboard is clamped to this world width

// Getting these wrong is props.md's stated most common authoring bug — hence snapCoord(), which every
// editor placement and every import goes through.
export const COORDS = Object.freeze({
  nwInt:       'integer tile index of the rectangle NW corner; the mesh centres itself, never add 0.5',
  tileCentre:  'tile-centre float (x.5/z.5) used RAW for position, floor()ed only for the height lookup',
  floorCentre: 'any float; props.js does Math.floor(x)+0.5, so 4, 4.2 and 4.5 all land on the same spot',
  edgeFree:    'free world coordinate on a tile boundary line; no snapping and no floor anywhere',
});

const f = (k, type, o = {}) => ({ k, type, label: o.label || k, def: 'def' in o ? o.def : null,
  min: o.min ?? null, max: o.max ?? null, enum: o.enum || null, units: o.units || null, req: !!o.req });

const XZ = {
  nwInt: () => [f('x', 'int', { req: true, label: 'NW tile x', units: 'tile' }), f('z', 'int', { req: true, label: 'NW tile z', units: 'tile' })],
  tileCentre: () => [f('x', 'number', { req: true, label: 'centre x (x.5)', units: 'tile' }), f('z', 'number', { req: true, label: 'centre z (z.5)', units: 'tile' })],
  floorCentre: () => [f('x', 'number', { req: true, label: 'centre x', units: 'tile' }), f('z', 'number', { req: true, label: 'centre z', units: 'tile' })],
  edgeFree: () => [f('x', 'number', { req: true, label: 'edge x (world)', units: 'world' }), f('z', 'number', { req: true, label: 'edge z (world)', units: 'world' })],
};
const ROOFS = ['tile', 'slate', 'brown', 'thatch'];
const DIRX = (def) => f('dir', 'enum', { enum: ['x', 'z'], def, label: 'axis' });

// The SPRITE / DECAL tables, verbatim from props.js:609-610. Order matters: the Nth prop of a type gets
// PNG list[(N-1) % list.length] — a per-type round robin over the whole props array, so inserting one
// oak reshuffles every later oak. `variants` is that list length.
const SPRITE = { oak: ['tree_oak_a', 'tree_oak_b'], pine: ['tree_pine', 'tree_pine_b'], rock: ['rock_large'],
  rock_small: ['rock_small'], bush: ['bush_a', 'bush_b'], well: ['well'], barrel: ['barrel'], crate: ['crate'],
  lamp: ['lamp_post'], signpost: ['signpost'], hay: ['hay_bale'], grave: ['grave_stone'],
  tree: ['tree_oak_a', 'tree_pine_b', 'tree_oak_b', 'tree_pine'], palm: ['tree_palm'] };
const DECAL = { flowers: ['flower_patch'] };
// Foliage takes the dark canopy tint plus per-instance scale/mirror jitter (props.md §4).
const FOLIAGE = new Set(['oak', 'pine', 'tree', 'bush']);
// `tree` and `bush` render full-size billboards but are NOT in mapdata.js's BLOCKING set.
const WALKTHROUGH_SPRITES = new Set(['tree', 'bush']);

// Cached mirror of public/env/manifest.json (heightTiles + pixel aspect) so the editor can size a ghost
// without a fetch. The manifest stays authoritative; selfTest only asserts every SPRITE png is present.
export const SPRITE_MANIFEST = Object.freeze({
  barrel: { ht: 0.6, aspect: 45 / 58 }, bush_a: { ht: 0.7, aspect: 118 / 67 }, bush_b: { ht: 0.7, aspect: 90 / 67 },
  crate: { ht: 0.65, aspect: 58 / 62 }, flower_patch: { ht: 0.55, aspect: 82 / 53, decal: true }, well: { ht: 1.45, aspect: 112 / 154 },
  grave_stone: { ht: 0.8, aspect: 55 / 77 }, hay_bale: { ht: 0.8, aspect: 94 / 77 }, lamp_post: { ht: 2.0, aspect: 70 / 250 },
  rock_large: { ht: 1.2, aspect: 105 / 115 }, rock_small: { ht: 0.5, aspect: 47 / 48 }, signpost: { ht: 1.25, aspect: 88 / 134 },
  tree_oak_a: { ht: 2.0, aspect: 164 / 240 }, tree_oak_b: { ht: 2.0, aspect: 204 / 240 }, tree_pine: { ht: 2.8, aspect: 127 / 288 },
  tree_pine_b: { ht: 2.8, aspect: 112 / 252 }, tree_palm: { ht: 2.4, aspect: 168 / 224 } });

const spec = (o) => ({ coord: o.coord, blocking: !!o.blocking, unsafeAt: !!o.unsafeAt,
  heightUnits: o.heightUnits ?? null, footprintRule: o.fp, sprites: o.sprites || [],
  variants: (o.sprites || []).length, foliage: !!o.foliage, decal: !!o.decal,
  fields: [...XZ[o.coord](), ...(o.fields || [])], note: o.note || '' });

/** Per-type contract; frozen below, after the sprite rows are generated. @type {Record<string,object>} */
export const PROP_SPEC = {
  // ---- NW-corner integer rectangles ------------------------------------------------------------
  house: spec({ coord: 'nwInt', blocking: true, unsafeAt: true, heightUnits: null, fp: 'rect w x d',
    note: 'map.at(x,z).h is unguarded — an out-of-bounds NW corner THROWS inside buildProps',
    fields: [f('w', 'int', { req: true, min: 1, max: 8, def: 1, units: 'tile' }), f('d', 'int', { req: true, min: 1, max: 8, def: 1, units: 'tile' }),
      f('rot', 'int', { min: 0, max: 3, def: 0, label: 'yaw (rot*90deg); door faces +z/+x/-z/-x' }),
      f('storeys', 'enum', { enum: [1, 2], def: 1 }), f('style', 'enum', { enum: ['timber', 'stone'], def: 'timber' }),
      f('roof', 'enum', { enum: ROOFS, def: 'tile' }), f('gable', 'enum', { enum: [null, 'stone'], def: null }),
      f('chimney', 'enum', { enum: [null, 'left', 'right'], def: null }), f('barn', 'bool', { def: false })] }),
  tower: spec({ coord: 'nwInt', blocking: true, heightUnits: 'world', fp: 'rect w x d',
    note: 'no rot field: the doorway always faces +z. w/d default to 2 in the MESH but footprint() reads them raw',
    fields: [f('w', 'int', { req: true, min: 1, max: 6, def: 2, units: 'tile' }), f('d', 'int', { req: true, min: 1, max: 6, def: 2, units: 'tile' }),
      f('th', 'number', { min: 0.5, max: 8, def: 3.2, units: 'world', label: 'shaft height' })] }),
  deck: spec({ coord: 'nwInt', blocking: false, heightUnits: 'h', fp: 'none — the DECKS grant does the rules work',
    note: 'author the prop AND the matching decks.tiles grant; either alone is a bug (props.md 3.15)',
    fields: [f('len', 'int', { min: 1, max: 32, def: 1, units: 'tile', label: 'length along dir' }),
      f('w', 'int', { min: 1, max: 16, def: 1, units: 'tile', label: 'width across dir' }), DIRX('z'),
      f('h', 'int', { def: 0, units: 'h', label: 'height of the water tiles below' }),
      f('style', 'enum', { enum: ['stone', 'wood'], def: 'stone' })] }),
  stairs: spec({ coord: 'nwInt', blocking: false, unsafeAt: true, fp: 'none — the tile IS the stair and stays walkable',
    note: 'adds the second tread so ONE tile bridges a 2h terrace break; map.at(x,z).h is unguarded',
    fields: [f('dir', 'enum', { enum: ['n', 's', 'e', 'w'], def: 'n', label: 'direction of ASCENT' })] }),
  ruin: spec({ coord: 'nwInt', blocking: true, heightUnits: 'world', fp: 'len tiles along dir',
    fields: [f('len', 'int', { req: true, min: 1, max: 24, def: 1, units: 'tile' }), DIRX('z'),
      f('th', 'number', { min: 0.3, max: 5, def: 1.4, units: 'world', label: 'intact height' })] }),
  fence: spec({ coord: 'nwInt', blocking: true, fp: 'len tiles along dir',
    fields: [f('len', 'int', { req: true, min: 1, max: 24, def: 1, units: 'tile' }), DIRX('x')] }),

  // ---- tile-centre floats (position used raw) ---------------------------------------------------
  stall: spec({ coord: 'tileCentre', blocking: true, unsafeAt: true, fp: '1 tile floor(x),floor(z)',
    note: 'map.at(floor(x),floor(z)).h is unguarded',
    fields: [f('rot', 'int', { min: 0, max: 3, def: 0, label: 'yaw; the open counter side is local +z' })] }),

  // ---- floored-then-recentred ------------------------------------------------------------------
  pillar: spec({ coord: 'floorCentre', blocking: true, heightUnits: 'world', fp: '1 tile',
    fields: [f('h', 'number', { min: 0.3, max: 4, def: 1.2, units: 'world', label: 'shaft height' })] }),
  cart: spec({ coord: 'floorCentre', blocking: true, fp: '1 tile',
    fields: [f('rot', 'int', { min: 0, max: 3, def: 0, label: 'yaw; shafts point local +x' })] }),
  woodpile: spec({ coord: 'floorCentre', blocking: true, fp: '1 tile', note: 'no rot: the stack always runs along z' }),
  trough: spec({ coord: 'floorCentre', blocking: true, fp: '1 tile', note: 'no rot: long axis always along x' }),
  gate: spec({ coord: 'floorCentre', blocking: false, fp: 'none — deliberately walk-through so it frames the lane',
    fields: [f('rot', 'int', { min: 0, max: 3, def: 0, label: 'yaw; the span runs along local x' }),
      f('roof', 'enum', { enum: ROOFS, def: 'brown' })] }),

  // ---- R15 story dressing (maps owner): camp, crypt and cathedral furniture ------------------------
  // NW-corner rectangles (footprint = w x d like house/tower; RECT_TYPES below).
  tent: spec({ coord: 'nwInt', blocking: true, fp: 'rect w x d',
    fields: [f('w', 'int', { req: true, min: 1, max: 3, def: 1, units: 'tile' }), f('d', 'int', { req: true, min: 1, max: 3, def: 1, units: 'tile' }),
      f('rot', 'int', { min: 0, max: 3, def: 0, label: 'yaw; the door flap faces +z/+x/-z/-x' }),
      f('style', 'enum', { enum: ['canvas', 'striped', 'command'], def: 'canvas' })] }),
  wagon: spec({ coord: 'nwInt', blocking: true, fp: 'rect w x d', note: 'covered wagon; the long axis runs along the longer of w/d',
    fields: [f('w', 'int', { req: true, min: 1, max: 2, def: 2, units: 'tile' }), f('d', 'int', { req: true, min: 1, max: 2, def: 1, units: 'tile' }),
      f('rot', 'int', { min: 0, max: 3, def: 0, label: 'yaw; the shafts point +x (or +z when d > w)' }),
      f('cover', 'enum', { enum: ['canvas', 'tithe', 'none'], def: 'canvas' })] }),
  organ: spec({ coord: 'nwInt', blocking: true, heightUnits: 'world', fp: 'rect w x d',
    fields: [f('w', 'int', { req: true, min: 1, max: 6, def: 3, units: 'tile' }), f('d', 'int', { req: true, min: 1, max: 3, def: 1, units: 'tile' }),
      f('th', 'number', { min: 1, max: 8, def: 3.6, units: 'world', label: 'tallest pipe' })] }),
  belfry: spec({ coord: 'nwInt', blocking: true, heightUnits: 'world', fp: 'rect w x d',
    fields: [f('w', 'int', { req: true, min: 2, max: 5, def: 3, units: 'tile' }), f('d', 'int', { req: true, min: 2, max: 5, def: 3, units: 'tile' }),
      f('th', 'number', { min: 1, max: 9, def: 5, units: 'world', label: 'shaft height below the bell chamber' })] }),
  // A crypt / nave wall running len tiles along dir (footprint like ruin); th its height in world units.
  cryptwall: spec({ coord: 'nwInt', blocking: true, heightUnits: 'world', fp: 'len tiles along dir',
    fields: [f('len', 'int', { req: true, min: 1, max: 24, def: 1, units: 'tile' }), DIRX('x'),
      f('th', 'number', { min: 0.3, max: 8, def: 3, units: 'world', label: 'wall height' }),
      f('in', 'enum', { enum: [1, -1], def: 1, label: 'which side faces the room (+1 = +z/+x)' }),
      f('style', 'enum', { enum: ['crypt', 'nave'], def: 'crypt' }),
      f('door', 'int', { min: -1, max: 24, def: -1, label: 'tile joint (0..len) carrying a great portal; -1 none' })] }),
  // Single-tile furniture.
  campfire: spec({ coord: 'floorCentre', blocking: true, fp: '1 tile', note: 'lit: lighting.js adds a warm point light under a lamps mood' }),
  brazier: spec({ coord: 'floorCentre', blocking: true, fp: '1 tile', note: 'lit: iron fire-bowl on a tripod' }),
  candelabra: spec({ coord: 'floorCentre', blocking: true, fp: '1 tile', note: 'lit: a standing iron candle tree' }),
  sarcophagus: spec({ coord: 'floorCentre', blocking: true, fp: '1 tile',
    fields: [f('rot', 'int', { min: 0, max: 3, def: 0, label: 'yaw; the effigy lies along local x' })] }),
  throne: spec({ coord: 'floorCentre', blocking: true, fp: '1 tile',
    fields: [f('rot', 'int', { min: 0, max: 3, def: 0, label: 'yaw; the seat faces +z' })] }),
  pew: spec({ coord: 'floorCentre', blocking: true, fp: '1 tile',
    fields: [f('rot', 'int', { min: 0, max: 3, def: 0, label: 'yaw; the seat faces +z' })] }),

  // ---- edge / free world coordinates ------------------------------------------------------------
  wall: spec({ coord: 'edgeFree', blocking: false, heightUnits: 'h', fp: 'none — sits on a tile edge',
    fields: [f('len', 'number', { req: true, min: 0.5, max: 48, def: 1, units: 'tile' }), DIRX('x'),
      f('h', 'int', { req: true, def: 0, units: 'h', label: 'terrace top the wall caps' }),
      f('in', 'enum', { enum: [1, -1], def: 1, label: 'which side of the line the body is pulled onto' })] }),
  arch: spec({ coord: 'edgeFree', blocking: false, heightUnits: 'h', fp: 'none — a flat fake-hole quad',
    note: 'shipped but unused in wendford_crossing',
    fields: [f('h', 'int', { req: true, def: 0, units: 'h', label: 'springing line' }),
      f('r', 'number', { min: 0.1, max: 3, def: 0.7, units: 'world', label: 'arch radius' }),
      DIRX('z'), f('flip', 'bool', { def: false, label: 'face the other way along dir' })] }),
  rail: spec({ coord: 'edgeFree', blocking: false, heightUnits: 'h', fp: 'none — sits on a tile edge',
    fields: [f('len', 'number', { req: true, min: 0.5, max: 48, def: 1, units: 'tile' }), DIRX('x'),
      f('h', 'int', { req: true, def: 0, units: 'h', label: 'surface the rail stands on' })] }),
};

// Billboards and the one decal share a field shape, so they are generated. The only authorable extra is
// `y`, an additive world-unit lift on top of the tile surface. props.js reads no rot/scale/variant.
for (const [type, pngs] of [...Object.entries(SPRITE), ...Object.entries(DECAL)]) {
  PROP_SPEC[type] = spec({ coord: 'tileCentre', blocking: !WALKTHROUGH_SPRITES.has(type) && !DECAL[type],
    fp: DECAL[type] || WALKTHROUGH_SPRITES.has(type) ? 'none' : '1 tile floor(x),floor(z)',
    heightUnits: 'world', sprites: pngs, foliage: FOLIAGE.has(type), decal: !!DECAL[type],
    fields: [f('y', 'number', { min: -4, max: 8, def: 0, units: 'world', label: 'lift above the tile surface' })],
    note: DECAL[type] ? 'flat ground quad, unlit, 1.6x oversized' : `${pngs.length} PNG variant(s), round-robined per type over the props array in order` });
}
Object.freeze(PROP_SPEC);

/** Types that clear `walk` on their footprint. DERIVED from PROP_SPEC; selfTest proves it equals
 *  the literal set in mapdata.js:28. @type {Set<string>} */
export const BLOCKING = new Set(Object.keys(PROP_SPEC).filter((t) => PROP_SPEC[t].blocking));

/** Tiles a prop clears `walk` on. VERBATIM behaviour of mapdata.js:30 — including the NaN loop when
 *  a house/tower omits w/d (which silently blocks nothing), because compile.js must reproduce
 *  today's MAP bit for bit. Do not "fix" it here; validate.js reports it as prop.missing-wd. */
/** R15 NW-corner rectangle props beside house/tower (kept separate so those two stay verbatim). */
export const RECT_TYPES = new Set(['tent', 'wagon', 'organ', 'belfry']);
export function footprint(p) {
  if (p.type === 'house' || p.type === 'tower') { const out = []; for (let z = p.z; z < p.z + p.d; z++) for (let x = p.x; x < p.x + p.w; x++) out.push([x, z]); return out; }
  if (RECT_TYPES.has(p.type)) { const out = []; for (let z = p.z; z < p.z + p.d; z++) for (let x = p.x; x < p.x + p.w; x++) out.push([x, z]); return out; }
  if (p.type === 'fence' || p.type === 'ruin' || p.type === 'cryptwall') { const out = []; for (let i = 0; i < p.len; i++) out.push(p.dir === 'x' ? [p.x + i, p.z] : [p.x, p.z + i]); return out; }
  if (BLOCKING.has(p.type)) return [[Math.floor(p.x), Math.floor(p.z)]];
  return [];
}

// World extent [x0, z0, lx, lz] of a prop's occupied rectangle, in world units. Degenerate (lx or lz
// zero) for the edge props and for points; that is deliberate and the box transforms handle it.
function extent(p) {
  const s = PROP_SPEC[p.type], n = (v, d) => (Number.isFinite(v) ? v : d);
  if (p.type === 'house' || p.type === 'tower') return [p.x, p.z, n(p.w, 1), n(p.d, 1)];
  if (RECT_TYPES.has(p.type)) return [p.x, p.z, n(p.w, 1), n(p.d, 1)];
  if (p.type === 'deck') { const L = n(p.len, 1), A = n(p.w, 1); return p.dir === 'x' ? [p.x, p.z, L, A] : [p.x, p.z, A, L]; }
  if (p.type === 'fence' || p.type === 'ruin' || p.type === 'cryptwall') { const L = n(p.len, 1); return p.dir === 'x' ? [p.x, p.z, L, 1] : [p.x, p.z, 1, L]; }
  if (p.type === 'stairs') return [p.x, p.z, 1, 1];
  if (p.type === 'wall' || p.type === 'rail') { const L = n(p.len, 1); return p.dir === 'x' ? [p.x, p.z, L, 0] : [p.x, p.z, 0, L]; }
  if (s && s.coord === 'edgeFree') return [p.x, p.z, 0, 0];          // arch: a point on a face
  return [Math.floor(p.x), Math.floor(p.z), 1, 1];                    // every centred single-tile prop
}

/** Every tile the prop's GEOMETRY overlaps, blocking or not — the editor's hit/overlay set and the
 *  "did a height edit move the ground under this prop" test. Differs from footprint() on purpose:
 *  a deck covers its whole rectangle, a gate and a bush cover their tile, and an edge prop (wall,
 *  rail) straddles the boundary line, so BOTH adjacent tile rows are returned (the wall's cap course
 *  is 0.08 wider than its body on each side, and rail posts are centred on the line). */
export function propTiles(p) {
  const [x0, z0, lx, lz] = extent(p), out = [], seen = new Set();
  const push = (x, z) => { const k = x + ',' + z; if (!seen.has(k)) { seen.add(k); out.push([x, z]); } };
  const x1 = Math.ceil(x0 + lx) - 1, z1 = Math.ceil(z0 + lz) - 1, xa = Math.floor(x0), za = Math.floor(z0);
  for (let z = za; z <= Math.max(za, z1); z++) for (let x = xa; x <= Math.max(xa, x1); x++) push(x, z);
  if (lz === 0 && lx > 0) for (let x = xa; x <= x1; x++) push(x, za - 1);   // wall/rail along x: both rows
  if (lx === 0 && lz > 0) for (let z = za; z <= z1; z++) push(xa - 1, z);   // ... and both columns
  return out;
}

/** Canonical placement for a type. The editor calls this on every stamp so a house can never land at
 *  x:4.5 and an oak can never land at x:4 (props.md's most common authoring bug, validate.js's
 *  prop.coord-convention). edgeFree is returned untouched: its value is a real world coordinate. */
export function snapCoord(type, x, z) {
  const c = PROP_SPEC[type] ? PROP_SPEC[type].coord : 'tileCentre';
  if (c === 'nwInt') return [Math.floor(x), Math.floor(z)];
  if (c === 'edgeFree') return [x, z];
  return [Math.floor(x) + 0.5, Math.floor(z) + 0.5];    // tileCentre and floorCentre share one canon
}

// ---- stamp transforms -------------------------------------------------------------------------
// One planar map, applied to the world-space box. rot90 is the quarter turn that sends +x -> +z and
// +z -> -x on a W x D board, producing a D x W board; callers MUST pass the pre-transform dims, so
// four rot90s alternate (W,D),(D,W),(W,D),(D,W) and land back on the identity.
export const OPS = Object.freeze(['rot90', 'mirrorX', 'mirrorZ', 'transpose']);
function tBox(op, x0, z0, lx, lz, W, D) {
  if (op === 'rot90') return [D - (z0 + lz), x0, lz, lx];
  if (op === 'mirrorX') return [W - (x0 + lx), z0, lx, lz];
  if (op === 'mirrorZ') return [x0, D - (z0 + lz), lx, lz];
  return [z0, x0, lz, lx];                                             // transpose (a reflection)
}
// yaw index: rot r faces +z,+x,-z,-x. rot90 turns a facing one step the way the board turns.
const ROT = { rot90: (r) => (r + 3) % 4, mirrorX: (r) => (4 - r) % 4, mirrorZ: (r) => (6 - r) % 4, transpose: (r) => [1, 0, 3, 2][r] };
// n = -z, s = +z, e = +x, w = -x. Same map as ROT, spelled in the stairs/arch vocabulary.
const NSEW = { rot90: { n: 'e', e: 's', s: 'w', w: 'n' }, mirrorX: { n: 'n', s: 's', e: 'w', w: 'e' },
  mirrorZ: { n: 's', s: 'n', e: 'e', w: 'w' }, transpose: { n: 'w', s: 'e', e: 's', w: 'n' } };
const SWAPS_AXES = { rot90: true, transpose: true, mirrorX: false, mirrorZ: false };
// A reflection swaps handedness, so a chimney on the left of the ridge ends up on the right.
const REFLECTS = { rot90: false, mirrorX: true, mirrorZ: true, transpose: true };
// props.js reads an arch as dir 'z' -> faces +/-z, anything else -> +/-x, with `flip` picking the sign.
// Round-tripping through a facing letter is what makes rot90^4 exact; it also canonicalises an absent
// `flip` to an explicit false and an absent `dir` to 'x', which is the same arch props.js would build.
const archFace = (p) => (p.dir === 'z' ? (p.flip ? 'n' : 's') : (p.flip ? 'w' : 'e'));
const archBack = (fc) => (fc === 'n' || fc === 's' ? { dir: 'z', flip: fc === 'n' } : { dir: 'x', flip: fc === 'w' });

/**
 * Transform one prop for a stamp rotate/mirror. Pure — returns a new object, never mutates `p`.
 * @param {object} p prop descriptor
 * @param {'rot90'|'mirrorX'|'mirrorZ'|'transpose'} op
 * @param {number} W board width BEFORE the transform
 * @param {number} D board depth BEFORE the transform
 */
export function transformProp(p, op, W, D) {
  if (!OPS.includes(op)) throw new Error(`transformProp: unknown op '${op}'`);
  const q = { ...p }, s = PROP_SPEC[p.type];
  const [nx, nz, nlx, nlz] = tBox(op, ...extent(p), W, D);
  if (!s) { [q.x, q.z] = [nx, nz]; return q; }                          // unknown type: move it, keep it
  if (s.coord === 'tileCentre' || s.coord === 'floorCentre') {
    const [cx, cz] = tBox(op, ...snapCoord(p.type, p.x, p.z), 0, 0, W, D);   // snap FIRST: a value on a
    [q.x, q.z] = snapCoord(p.type, cx, cz);      // tile boundary is ambiguous under D - Z and lands short
  } else { q.x = nx; q.z = nz; }
  if (p.type === 'house' || p.type === 'tower' || RECT_TYPES.has(p.type)) { q.w = nlx; q.d = nlz; }
  if (typeof p.rot === 'number') q.rot = ROT[op](((p.rot % 4) + 4) % 4);
  if (p.type === 'stairs') q.dir = NSEW[op][p.dir] || p.dir;
  else if (p.type === 'arch') Object.assign(q, archBack(NSEW[op][archFace(p)]));
  else if (s.fields.some((fd) => fd.k === 'dir') && SWAPS_AXES[op]) q.dir = p.dir === 'x' ? 'z' : 'x';
  // The wall body is pulled th/2 onto one side of its line; a flip across that axis swaps the side.
  if (p.type === 'cryptwall') { const along = p.dir === 'x'; const flip = op === 'rot90' ? along : (op === 'mirrorX' ? !along : (op === 'mirrorZ' ? along : false)); q.in = flip ? -(p.in ?? 1) : (p.in ?? 1); }
  if (p.type === 'wall') { const along = p.dir === 'x'; const flip = op === 'rot90' ? along : (op === 'mirrorX' ? !along : (op === 'mirrorZ' ? along : false)); if (flip) q.in = -(p.in ?? 1); else q.in = p.in ?? 1; }
  if (p.type === 'house' && p.chimney && REFLECTS[op]) q.chimney = p.chimney === 'left' ? 'right' : 'left';
  return q;
}

// ---- self test ---------------------------------------------------------------------------------
// mapdata.js:28 verbatim. Held here ONLY as the assertion target: BLOCKING is derived from PROP_SPEC.
const MAPDATA_BLOCKING = ['house', 'tower', 'ruin', 'pillar', 'well', 'barrel', 'crate', 'cart', 'woodpile',
  'trough', 'lamp', 'signpost', 'hay', 'grave', 'oak', 'pine', 'rock', 'rock_small', 'fence', 'stall', 'palm',
  // R15 story dressing (maps owner)
  'tent', 'wagon', 'organ', 'belfry', 'cryptwall', 'campfire', 'brazier', 'candelabra', 'sarcophagus', 'pew', 'throne'];

/** @returns {string[]} failures; empty means the transcription still matches props.js/mapdata.js. */
export function selfTest() {
  const bad = [], eq = (a, b) => JSON.stringify(a) === JSON.stringify(b), want = [...MAPDATA_BLOCKING].sort();
  if (!eq(want, [...BLOCKING].sort())) bad.push(`BLOCKING drift vs mapdata.js: missing ${want.filter((t) => !BLOCKING.has(t))}, extra ${[...BLOCKING].filter((t) => !MAPDATA_BLOCKING.includes(t))}`);
  for (const t of Object.keys(PROP_SPEC)) {
    const s = PROP_SPEC[t];
    if (!COORDS[s.coord]) bad.push(`${t}: bad coord '${s.coord}'`);
    if (s.variants !== s.sprites.length) bad.push(`${t}: variants != sprites.length`);
    if (!s.fields.some((fd) => fd.k === 'x') || !s.fields.some((fd) => fd.k === 'z')) bad.push(`${t}: no x/z field`);
    for (const png of s.sprites) if (!SPRITE_MANIFEST[png]) bad.push(`${t}: ${png} missing from SPRITE_MANIFEST`);
  }
  for (const t of ['house', 'stairs', 'stall']) if (!PROP_SPEC[t].unsafeAt) bad.push(`${t}: unsafeAt must be true (map.at().h is unguarded)`);
  // rot90^4 = identity on a non-square board, one prop of every convention and every directional form.
  const sample = [
    { type: 'house', x: 4, z: 4, w: 3, d: 2, rot: 2, chimney: 'right' }, { type: 'tower', x: 2, z: 18, w: 2, d: 2, th: 3.4 },
    { type: 'deck', x: 9, z: 13, len: 2, w: 2, dir: 'z', h: 0, style: 'stone' }, { type: 'stairs', x: 9, z: 10, dir: 'n' },
    { type: 'stairs', x: 3, z: 6, dir: 'w' }, { type: 'ruin', x: 0, z: 16, len: 2, dir: 'z', th: 1.5 }, { type: 'oak', x: 4.5, z: 10.5 },
    { type: 'fence', x: 6, z: 17, len: 2, dir: 'x' }, { type: 'flowers', x: 7.5, z: 11.5 }, { type: 'stall', x: 5.5, z: 6.5, rot: 2 },
    { type: 'pillar', x: 14.5, z: 5.5, h: 1.5 }, { type: 'cart', x: 8.5, z: 17.5, rot: 1 }, { type: 'gate', x: 9.5, z: 3.5, rot: 0 },
    { type: 'wall', x: 4, z: 10, len: 5, dir: 'x', h: 6, in: 1 }, { type: 'wall', x: 4, z: 4, len: 2, dir: 'z', h: 8, in: -1 },
    { type: 'arch', x: 11, z: 6.5, h: 8, r: 0.7, dir: 'z', flip: false }, { type: 'rail', x: 9, z: 13, len: 2, dir: 'z', h: 0 },
    { type: 'arch', x: 3, z: 2.5, h: 4, dir: 'x', flip: true }];
  const W = 24, D = 20;
  for (const p of sample) {
    let q = p;
    for (let i = 0; i < 4; i++) q = transformProp(q, 'rot90', i % 2 ? D : W, i % 2 ? W : D);
    if (!eq(q, p)) bad.push(`rot90^4 != identity for ${p.type}: ${JSON.stringify(q)}`);
    for (const op of ['mirrorX', 'mirrorZ', 'transpose']) {
      const dims = op === 'transpose' ? [D, W] : [W, D];
      const r = transformProp(transformProp(p, op, W, D), op, dims[0], dims[1]);
      if (!eq(r, p)) bad.push(`${op}^2 != identity for ${p.type}: ${JSON.stringify(r)}`);
    }
    // a transformed prop must stay inside the (possibly swapped) board
    const t = transformProp(p, 'rot90', W, D), [tx, tz, tlx, tlz] = extent(t);
    if (tx < 0 || tz < 0 || tx + tlx > D || tz + tlz > W) bad.push(`rot90 put ${p.type} out of bounds: ${JSON.stringify(t)}`);
    if (PROP_SPEC[p.type].coord !== 'edgeFree') {
      const [sx, sz] = snapCoord(p.type, p.x, p.z);
      if (sx !== p.x || sz !== p.z) bad.push(`sample ${p.type} is not on its own convention (${p.x},${p.z} -> ${sx},${sz})`);
    }
  }
  // An off-convention author value is CANONICALISED by the first transform and byte-stable from then
  // on — the same contract as arch.flip and wall.in. wendford_crossing has exactly one: cart at 8,17.
  let c = { type: 'cart', x: 8, z: 17, rot: 1 };
  for (let i = 0; i < 4; i++) c = transformProp(c, 'rot90', i % 2 ? D : W, i % 2 ? W : D);
  if (!eq(c, { type: 'cart', x: 8.5, z: 17.5, rot: 1 })) bad.push(`rot90^4 misplaced an off-grid cart: ${JSON.stringify(c)}`);
  // footprint() parity with the shipped rules on the shapes mapdata.js special-cases
  if (!eq(footprint({ type: 'house', x: 1, z: 2, w: 2, d: 2 }), [[1, 2], [2, 2], [1, 3], [2, 3]])) bad.push('footprint(house) drift');
  if (!eq(footprint({ type: 'fence', x: 6, z: 17, len: 2, dir: 'x' }), [[6, 17], [7, 17]])) bad.push('footprint(fence) drift');
  if (!eq(footprint({ type: 'ruin', x: 0, z: 16, len: 2, dir: 'z' }), [[0, 16], [0, 17]])) bad.push('footprint(ruin) drift');
  if (!eq(footprint({ type: 'pillar', x: 14.5, z: 5.5 }), [[14, 5]])) bad.push('footprint(pillar) drift');
  if (footprint({ type: 'house', x: 1, z: 2 }).length !== 0) bad.push('footprint(house without w/d) must NaN-loop to empty');
  for (const t of ['bush', 'tree', 'flowers', 'deck', 'gate', 'stairs', 'wall', 'arch', 'rail'])
    if (footprint({ type: t, x: 1, z: 1, len: 2, dir: 'x' }).length) bad.push(`${t} must not block`);
  return bad;
}

if (typeof process !== 'undefined' && process.argv?.[1] && import.meta.url === `file://${process.argv[1]}`) {
  const bad = selfTest();
  console.log(bad.length ? bad.join('\n') : `propspec OK — ${Object.keys(PROP_SPEC).length} types, ${BLOCKING.size} blocking`);
  process.exit(bad.length ? 1 : 0);
}
