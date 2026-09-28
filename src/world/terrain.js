import * as THREE from 'three';
import { HSTEP } from '../core/config.js';
import { skinBase, tex, texScale } from './textures.js';

// Battlefield terrain (terrain owner). classic-style hand-painted terraces:
//  - tops: 4x4 vertex grid per tile so lips, cliff-base contact shadow and path wear live in narrow bands;
//    per-tile hue/value tint + per-tile texture rotation kills visible repetition
//  - walls: UV in tile units (masonry courses = height steps), inside-corner AO, base darkening, lip highlight,
//    grass/earth overhang fringe glued to the top edge
//  - junction spill decals (dirt→grass, sand→dirt, grass→stone) so material edges are ragged, not ruled
//  - water: sloped bed (shallow at the bank, deep mid-channel) + a custom unlit shader that reads the bed depth
//    per vertex: transparent and pale over the shallows, saturated blue over the deep, two scrolling ripple layers
//    at different rates, sparse specular glints, caustics on the shallow bed, and a wiggly foam waterline that
//    eats the 90-degree tile corners so the river stops reading as a rectangular cut-out
//  - scatter: pebble / tuft / worn-earth / moss stamps dropped on a fraction of tiles (random size + dihedral),
//    plus a damp wetband decal on every land tile that touches water
//  - diorama: textured cliffs down to the map's lowest level, black skirt + black cap below it
// Lighting-agnostic fill: every painted surface adds a fraction of its own albedo as emissive (aFill attribute) so
// walls facing away from the key still read as painted rock rather than black.

const Y = (h) => h * HSTEP;
function hash(x, z, s = 0) { let h = (x * 374761393 + z * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
const lerp = (a, b, t) => a + (b - a) * t;

class Batch {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.fill = []; this.amb = []; }
  vert(p, n, uv, c, f, m) { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]); this.col.push(c[0], c[1], c[2]); this.fill.push(f); this.amb.push(m); }
  // a,b,c,d counter-clockwise seen from outside; cols are [r,g,b] per corner
  quad(a, b, c, d, n, uvs, cols, fill, amb = 0) {
    const P = [a, b, c, a, c, d], U = [uvs[0], uvs[1], uvs[2], uvs[0], uvs[2], uvs[3]], C = [cols[0], cols[1], cols[2], cols[0], cols[2], cols[3]];
    for (let i = 0; i < 6; i++) this.vert(P[i], n, U[i], C[i], fill, amb);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFill', new THREE.Float32BufferAttribute(this.fill, 1));
    g.setAttribute('aAmb', new THREE.Float32BufferAttribute(this.amb, 1));
    return g;
  }
}

// Lambert + painted fill: emissive = albedo * vertexColour * aFill, so form shading comes from the vertex bands
// and the texture, and the sun only adds on top. Robust to whatever the lighting owner does with the key light.
// R4 regression 1 (molten ground plane). The painted set was authored for a 2.55-intensity key; under round 3's
// 5.1 warm key plus the grade's +36% saturation and its per-channel shadow gamma, the warm tops (dirt, sand and the
// dirt/bare/gravel stamps that sit on grass) leave the pipeline at B/R 0.10-0.25 where every the genre reference measures
// 0.30-0.88 -- i.e. as lava. Trim those albedos at the source: pull a fraction of their chroma out and take a little
// value off, per key. Cool and neutral surfaces (grass, stone, rock, water bed) are untouched.
const TONE = {
  d: [0.30, 0.86], d2: [0.30, 0.86], sand: [0.10, 0.50],   // R7: sand 0.80 -> 0.50 (it blew out to pink-white; no wendford tile uses it)
  spill_dirt: [0.32, 0.84], spill_sand: [0.16, 0.56], sc_bare: [0.34, 0.82], sc_gravel: [0.26, 0.88],
  fringe_earth: [0.30, 0.86], earth_side: [0.20, 0.94],
  g: [0.14, 0.96], g2: [0.14, 0.96], k: [0.12, 0.97],
};
// R5 regression (a), the texture half of wall crush. Mapping the crushed pixels back to their source shows they
// are not whole faces: they are the deep mortar joints of the side paintings (rock_side linear min 0.014,
// earth_side 0.009) landing on a face whose shade multiplier is ~0.3, plus the two deliberate contact rows.
// the genre never paints a black joint -- in a reference capture and a reference capture the darkest mortar in a shadowed cliff still
// reads as dark grey-brown with the block edges intact. TOE lifts the albedo's black point in LINEAR space
// (x -> lo + (1-lo)x, so 1.0 stays 1.0) and GAIN takes the mean back down, which multiplies the darkest joint
// by ~3 and the block faces by ~1.05. Sides only; tops and decals are untouched.
const EMIS_TRIM = new Set(['sand', 'spill_sand']);
const TOE_LIFT = { rock_side: [0.030, 0.955], earth_side: [0.030, 0.955], stone_side: [0.026, 0.965], wood_side: [0.022, 0.972] };
// PERF r11: ONE program for every painted surface (two with the alpha cut). The per-key trims used to be baked into the
// GLSL as literals, so the ~11 painted keys on a map compiled ~11 near-identical Lambert programs (the costliest
// thing a battle boot does). They are uniforms now. The expressions are unchanged and exact at the neutral values:
// mix(x, y, 0.0) * 1.0 == x and (0.0 + x * 1.0) * 1.0 == x in IEEE float, so an untrimmed key renders bit-identically
// to its old untrimmed program, and the sand-only fill trim is a uniform branch (uTone.w) instead of a separate program.
function paintedMaterial(key, opts = {}) {
  const t = tex(key).texture;
  const mat = new THREE.MeshLambertMaterial({ map: t, vertexColors: true, emissive: 0xffffff, emissiveMap: t, ...opts });
  const base = SKIN_BASE(key);   // a skin key (R14) takes its base painting's trims
  const [dsat, gain] = TONE[key] || TONE[base] || [0, 1];
  const [toeLo, toeGain] = TOE_LIFT[key] || TOE_LIFT[base] || [0, 1];
  const emisTrim = EMIS_TRIM.has(key) && (dsat > 0 || gain !== 1);
  const uTone = { value: new THREE.Vector4(dsat, gain, toeLo, emisTrim ? 1 : 0) }, uToeGain = { value: toeGain };
  mat.userData.tone = uTone.value;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTone = uTone; sh.uniforms.uToeGain = uToeGain;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFill; varying float vFill;\nattribute float aAmb; varying float vAmb;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFill = aFill;\nvAmb = aAmb;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFill;\nvarying float vAmb;\nuniform vec4 uTone; uniform float uToeGain;')
      // TONE trim (uTone.xy = desaturate, gain) then the side TOE lift (uTone.z = black-point lift, uToeGain)
      .replace('#include <map_fragment>', '#include <map_fragment>\nfloat _al = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(_al), uTone.x) * uTone.y;\ndiffuseColor.rgb = (vec3(uTone.z) + diffuseColor.rgb * (1.0 - uTone.z)) * uToeGain;')
      // R4 regression 1 (molten ground plane): the fill is AMBIENT BOUNCE, not a second copy of the albedo.
      // Emitting saturated albedo doubled the chroma of every warm top under the round-3 key and turned dirt,
      // sand and dry grass into lava. Desaturate the fill 55% toward its own luminance: the value hierarchy
      // (top fill >> wall fill) is untouched because the mix is luminance-preserving, only the chroma goes.
      // R7: sand only (uTone.w) -- the painted fill samples the RAW texture, so the TONE trim never reached it, and
      // pale sand (mean luma 0.55 linear vs dirt 0.20) emitted 2.7x dirt's fill and rolled off to pink-white.
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (uTone.w > 0.5) { float _el = dot(totalEmissiveRadiance, vec3(0.2126, 0.7152, 0.0722)); totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(_el), uTone.x) * uTone.y; }\nvec3 pFill = totalEmissiveRadiance * (vColor.rgb * vFill + vAmb);\nfloat pFillL = dot(pFill, vec3(0.2126, 0.7152, 0.0722));\ntotalEmissiveRadiance = mix(pFill, vec3(pFillL), 0.55);')
      // R4 regression 1, the other half: HIGHLIGHT ROLL-OFF TOWARD A COOL WHITE. The rig hands the grade a
      // radiance whose blue is ~7% of its red (key 0xffd2a4 = linear B/R 0.375), and the grade's per-channel
      // shadow gamma (1.45), +36% saturation and warm highTint then take what is left, so lit terrain leaves the
      // pipe at B/R 0.10-0.25 where every the genre reference measures 0.30-0.88 -- i.e. as lava. Bright terrain therefore
      // rolls toward a cool neutral (0.84, 0.97, 1.55) whose luminance is 0.987 of the original, so the top-vs-wall
      // value hierarchy is untouched to within 1.3% and only the hot end changes hue. Mid and dark paint is intact.
      .replace('#include <opaque_fragment>', 'float _ol = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));\noutgoingLight = mix(outgoingLight, vec3(_ol) * vec3(0.82, 0.96, 1.66), smoothstep(0.16, 1.05, _ol) * 0.72);\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => 'painted-v2';
  return mat;
}

const TOP_KEY = { g: 'g', k: 'k', d: 'd', s: 's', b: 'b', r: 'r', sand: 'sand' };
const ROTATES = new Set(['sand', 'r', 'bed']); // grass/dirt rely on the smooth vertex tint instead: mirroring a tile window makes a checker
// top:  bright enough to hold the round-3 value hierarchy (2.0x the wall) without over-driving warm albedo
// fringe: the cliff-lip moss sits BETWEEN the two planes -- above the rock it hangs on (R4 regression 2, the
//        black tar drip, was 0.30) but strictly below the top it hangs from. R5: at 0.50 it was the brightest
//        band in the frame at the lip, so ~32% of junction samples read the lower side BRIGHTER than the grass
//        and the terrace edge inverted exactly where it has to read. Bracketed at 0.40: wall 0.22 < fringe 0.40
//        < top 0.44, which is the ref_55 order and cannot invert whatever the per-face shade does.
const FILL = { top: 0.44, wall: 0.165, bed: 0.30, fringe: 0.34, spill: 0.26 };
// FLAT ambient (aAmb): sky bounce does not care which way a wall faces, but the painted fill did -- it is emitted
// as albedo * vColor * aFill and vColor carries the whole directional face shade, so a wall turned away from the
// key got ~2% of its own albedo as 'ambient' and went black. Splitting the wall's 0.22 into 0.165 shaded + 0.052
// flat leaves a FULLY LIT face within 0.5% of where it was (0.93*0.165+0.052 = 0.2055 vs 0.93*0.22 = 0.2046) and
// multiplies a fully shaded one by 1.6 -- a proportional lift, so the masonry keeps (in fact gains) its display
// contrast instead of being compressed the way a black-point raise would compress it.
const AMB = { wall: 0.052, fringe: 0.030 };
// R5 wall floor. The painted fill is AMBIENT BOUNCE, but it is emitted as albedo * vColor * aFill and vColor
// carries the full directional face shade -- which stacks orientation (0.42) x jitter (0.82) x base gradient
// (0.78) x contact row (0.72) x inside-corner (0.64) down to 0.10, so a shadowed wall corner got ~2% of its
// own albedo as ambient and crushed to black, taking every masonry joint with it (contrast scales with the
// multiplier). A soft floor -- sqrt(f^2 + FLOOR^2), not a clamp, so nothing bands -- lifts 0.10 to 0.31 while
// leaving a fully lit face within 4%; WGAIN then takes that 4% back so the wall MEAN is unchanged and only the
// crushed tail moves. This is the whole of regression (a): recover the shadow detail, do not re-lift the walls.
const WFLOOR = 0.30, WGAIN = 0.93;
const softFloor = (f) => Math.sqrt(f * f + WFLOOR * WFLOOR) * WGAIN;
const TS = [0, 0.14, 0.86, 1];      // top grid: outer bands hold lip / contact / AO
const WU = [0, 0.18, 0.82, 1];      // wall columns: outer bands hold inside-corner AO
// R4: the moss spill is a NARROW ragged band over the lip (ref_55), not half the cliff face. At 0.25 it covered a
// whole height step, so the darker rock never got close enough to the grass for the terrace edge to read.
const FRINGE_H = 0.16, SPILL_W = 0.375;
// junction spill: which material creeps onto which (A -> B at equal height)
const SPILL = { 'd>g': 'spill_dirt', 'd>k': 'spill_dirt', 'sand>g': 'spill_sand', 'sand>k': 'spill_sand', 'sand>d': 'spill_sand', 'g>s': 'spill_grass', 'k>s': 'spill_grass', 'g>d': 'spill_grass' };
const FRINGE = { g: 'fringe_grass', k: 'fringe_grass', d: 'fringe_earth', sand: 'fringe_earth' };

function sideKey(t, drop) {
  if (t.t === 's') return 'stone_side';
  if (t.t === 'b') return 'wood_side';
  if (t.t === 'r') return 'rock_side';
  return drop >= 4 ? 'rock_side' : 'earth_side';
}
// dihedral transform k (0..7) of local tile coords: 4 rotations x mirror
function dih(k, x, y) { if (k & 4) x = 1 - x; switch (k & 3) { case 1: return [1 - y, x]; case 2: return [1 - x, 1 - y]; case 3: return [y, 1 - x]; default: return [x, y]; } }
// per-tile tint: value break-up in patches, slight warm/cool hue drift, higher terraces a touch lighter
// smooth lattice noise over the map (period P tiles) so tint patches cross tile borders instead of outlining them
function smoothNoise(x, z, P, seed) {
  const fx = (x + 0.5) / P, fz = (z + 0.5) / P, x0 = Math.floor(fx), z0 = Math.floor(fz);
  let tx = fx - x0, tz = fz - z0; tx = tx * tx * (3 - 2 * tx); tz = tz * tz * (3 - 2 * tz);
  const a = hash(x0, z0, seed), b = hash(x0 + 1, z0, seed), c = hash(x0, z0 + 1, seed), d = hash(x0 + 1, z0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}
function tileTint(t, x, z) {
  // three scales of value break-up: meadow-wide bands (13 tiles), patches (3.5 / 7), then per-tile grain.
  // The broad octave is what stops a 10x6 lawn reading as one stamp repeated.
  const broad = smoothNoise(x, z, 13, 8);
  const patch = smoothNoise(x, z, 3.5, 3) * 0.6 + smoothNoise(x, z, 7, 4) * 0.4;
  const v = 0.845 + broad * 0.135 + patch * 0.155 + (hash(x, z, 1) - 0.5) * 0.035 + (t.h - 4) * 0.008;
  const hs = (smoothNoise(x, z, 5, 2) - 0.5) * (t.t === 'g' || t.t === 'k' ? 0.18 : 0.08)
    + (smoothNoise(x, z, 11, 6) - 0.5) * 0.10 + (hash(x, z, 2) - 0.5) * 0.025;
  return [v * (1 - hs * 0.7), v * (1 + hs * 0.25), v * (1 + hs)];
}
// which painted variant a tile uses: a smooth field, dithered per tile so the boundary between the two
// grass (or dirt) paintings is a ragged mix, never a ruled line along a tile edge
function variant(x, z, seed) { return smoothNoise(x, z, 4.5, seed) + (hash(x, z, seed + 40) - 0.5) * 0.34 > 0.5; }
// scatter table: [decal key, probability]; rolled once per tile against hash(x,z,41)
const SCATTER = {
  g: [['sc_tufts', 0.30], ['sc_pebbles', 0.13], ['sc_bare', 0.11]],
  g2: [['sc_tufts', 0.30], ['sc_pebbles', 0.13], ['sc_bare', 0.11]],
  k: [['sc_tufts', 0.24], ['sc_moss', 0.12], ['sc_pebbles', 0.08]],
  d: [['sc_weeds', 0.20], ['sc_pebbles', 0.18], ['sc_gravel', 0.16]],
  d2: [['sc_weeds', 0.20], ['sc_pebbles', 0.18], ['sc_gravel', 0.16]],
  sand: [['sc_pebbles', 0.16], ['sc_gravel', 0.10]],
  s: [['sc_moss', 0.09], ['sc_pebbles', 0.07]],
  r: [['sc_gravel', 0.22], ['sc_moss', 0.12]],
};
const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
// every alpha-cut overlay laid flat on a surface: spill junctions, cliff-lip fringes, scatter stamps, wet shore
const DECAL = (k) => k.startsWith('fringe') || k.startsWith('spill') || k.startsWith('sc_') || k.startsWith('wetband');
// R14 per-mood terrain SKINS. A mood may repaint the ground with its own texture set: every batch key found in the
// skin is swapped for its skinned key at batch time (geometry, UVs, tints, scatter rolls are untouched). A map whose
// mood has no skin takes the `!skin` path, so its batches, materials and programs are exactly what they were.
//   ashfall (Ashfall Barrow): ash-dusted dead turf, peat-black mud, soot-grey barrow stone, a black peat bog.
const SKINS = {
  ashfall: {
    keys: { g: 'g_ash', g2: 'g2_ash', k: 'k_ash', d: 'd_ash', d2: 'd2_ash', s: 's_ash', r: 'r_ash', bed: 'bed_ash',
      stone_side: 'stone_side_ash', rock_side: 'rock_side_ash', earth_side: 'earth_side_ash',
      fringe_grass: 'fringe_grass_ash', fringe_earth: 'fringe_earth_ash', spill_grass: 'spill_grass_ash', spill_dirt: 'spill_dirt_ash',
      wetband: 'wetband_ash', sc_tufts: 'sc_tufts_ash', sc_moss: 'sc_moss_ash', sc_weeds: 'sc_weeds_ash', sc_bare: 'sc_bare_ash' },
    // peat water: brown-black, the crests a dull pewter instead of sky blue
    water: { shallow: 0x55523f, mid: 0x2f3029, deep: 0x17191a, crest: 0x828276, foam: 0xa09e92 },
  },
};
// R15 story skins (maps owner): the same swap for the snow, crypt and cathedral moods (public/textures/p/_r15skins.py).
const skinKeys = (sfx) => Object.fromEntries(['g', 'g2', 'k', 'd', 'd2', 's', 'r', 'bed', 'stone_side', 'rock_side', 'earth_side', 'fringe_grass',
  'fringe_earth', 'spill_grass', 'spill_dirt', 'wetband', 'sc_tufts', 'sc_moss', 'sc_weeds', 'sc_bare'].map((k) => [k, `${k}_${sfx}`]));
//   snow (Greyspine, the Northreach nodes): snowfield, slush roads, frosted flags; steel-grey ice-cold water
SKINS.snow = { keys: skinKeys('snow'), water: { shallow: 0x8aa4b6, mid: 0x46627a, deep: 0x22364a, crest: 0xd2e2ec, foam: 0xf0f6fa } };
//   crypt (The Undercroft): grimed flagstone, grave earth, black-green standing water
SKINS.crypt = { keys: skinKeys('crypt'), water: { shallow: 0x587060, mid: 0x2c4238, deep: 0x14221c, crest: 0x86a090, foam: 0x9cb0a4 } };
//   cathedral (Aurelmont): marble checker floor, crimson carpet on the dark-turf letter, pale limestone
SKINS.cathedral = { keys: skinKeys('nave'), water: { shallow: 0x5a7a8a, mid: 0x2e4c60, deep: 0x16283a, crest: 0x9ab8c8, foam: 0xc8dce4 } };
const SKIN_BASE = skinBase;

export function buildTerrain(map) {
  const group = new THREE.Group(); group.name = 'terrain';
  const batches = new Map();
  const skin = SKINS[map.mood] || null, skinKeys = skin ? skin.keys : null;
  const B = !skin ? (key) => { if (!batches.has(key)) batches.set(key, new Batch()); return batches.get(key); }
    : (key) => { key = skinKeys[key] || key; if (!batches.has(key)) batches.set(key, new Batch()); return batches.get(key); };
  let cutH = Infinity; for (const row of map.tiles) for (const t of row) if (!t.water && !t.void) cutH = Math.min(cutH, t.h);
  if (!isFinite(cutH)) cutH = 0;
  // rank 12: a VOID tile is a bite out of the diorama, not a surface. Treating it as off-map here is what
  // makes the cliff face around a bite run to the black skirt in one drop -- and it is the real cause of the
  // stray dotted line: before this, every void tile got a full painted dirt top at CUT height, which the
  // props void cap then covered except for a 1px rim that read as an orange stipple hanging in the void.
  const at = (x, z) => { const t = map.at(x, z); return t && t.void ? null : t; };
  const land = (n) => n && !n.water;
  const higher = (n, h) => land(n) && n.h > h;
  const lower = (n, h) => !n || n.water || n.h < h;
  // the 4 wall directions: normal, edge endpoints a->b (CCW from outside), tangent axis
  const SIDES = [
    { nx: 1, nz: 0, n: [1, 0, 0], a: (x, z) => [x + 1, z + 1], b: (x, z) => [x + 1, z], tan: 'z' },
    { nx: -1, nz: 0, n: [-1, 0, 0], a: (x, z) => [x, z], b: (x, z) => [x, z + 1], tan: 'z' },
    { nx: 0, nz: 1, n: [0, 0, 1], a: (x, z) => [x, z + 1], b: (x, z) => [x + 1, z + 1], tan: 'x' },
    { nx: 0, nz: -1, n: [0, 0, -1], a: (x, z) => [x + 1, z], b: (x, z) => [x, z], tan: 'x' },
  ];
  // R4: no vertical plane may reach 1.0 -- a top face's own factor is 1.00-1.07, so a wall at 1.15 (round 3)
  // out-valued the plane it holds up and the terrace edge disappeared exactly at the lip. The 1.9x spread
  // between the two camera-visible orientations that made cliff corners readable is kept (0.96 / 0.56).
  // R5: 0.42 -> 0.48 on the away-facing orientation. That face is where every crushed interior pixel lives;
  // the spread that makes cliff corners readable is 0.88/0.48 = 1.83x, still far past the 1.14x of round 2.
  const faceShade = (s) => s.nx === -1 ? 0.88 : s.nx === 1 ? 0.55 : s.nz === 1 ? 0.78 : 0.48;

  for (let z = 0; z < map.d; z++) for (let x = 0; x < map.w; x++) {
    const t = map.tiles[z][x];
    if (t.water || t.void) continue;
    const top = Y(t.h), tint = tileTint(t, x, z);
    let key = TOP_KEY[t.t] || 'd';
    if (key === 'g') { if (variant(x, z, 9)) key = 'g2'; } else if (key === 'd' && variant(x, z, 12)) key = 'd2';
    const sc = texScale(key), rot = ROTATES.has(key) ? Math.floor(hash(x, z, 7) * 4) * 2 : 0; // mirrors + 180 only: brush direction stays put
    const W = at(x - 1, z), E = at(x + 1, z), N = at(x, z - 1), S = at(x, z + 1);
    const NW = at(x - 1, z - 1), NE = at(x + 1, z - 1), SW = at(x - 1, z + 1), SE = at(x + 1, z + 1);
    // ---- top surface: 3x3 quads
    const V = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      let f = 1;
      const onW = i === 0, onE = i === 3, onN = j === 0, onS = j === 3;
      const edgeFlags = [[onW, W], [onE, E], [onN, N], [onS, S]];
      let aoN = 0, lipN = 0;
      for (const [on, nb] of edgeFlags) if (on) { if (higher(nb, t.h)) aoN++; else if (lower(nb, t.h)) lipN++; }
      if (aoN === 0) { // diagonal-only AO at outer corners
        const diag = onW && onN ? NW : onE && onN ? NE : onW && onS ? SW : onE && onS ? SE : null;
        if (diag && higher(diag, t.h)) f *= 0.84;
      }
      f *= aoN ? (aoN === 2 ? 0.58 : 0.68) : 1;
      f *= 1 + lipN * 0.22;   // R4: the terrace edge is a LIGHT/dark pair -- lit lip above, contact line below.
      //                       R5: 0.16 -> 0.22, the grass half of the junction fix (see FILL.fringe).
      const [lx, ly] = dih(rot, TS[i], TS[j]);
      V.push({ p: [x + TS[i], top, z + TS[j]], uv: [(x + lx) / sc, (z + ly) / sc], c: mul(tint, f) });
    }
    const vi = (i, j) => V[j * 4 + i];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const a = vi(i, j), b = vi(i, j + 1), c = vi(i + 1, j + 1), d = vi(i + 1, j);
      B(key).quad(a.p, b.p, c.p, d.p, [0, 1, 0], [a.uv, b.uv, c.uv, d.uv], [a.c, b.c, c.c, d.c], FILL.top);
    }
    // ---- junction spill decals from equal-height neighbours
    for (const s of SIDES) {
      const nb = at(x + s.nx, z + s.nz); if (!land(nb) || nb.h !== t.h) continue;
      const dk = SPILL[`${nb.t}>${t.t}`]; if (!dk) continue;
      const a = s.a(x, z), b = s.b(x, z), in_ = [-s.nx * SPILL_W, -s.nz * SPILL_W];
      const ntint = mul(tileTint(nb, x + s.nx, z + s.nz), 0.98), yy = top + 0.004;
      const u = (p) => (s.tan === 'z' ? p[1] : p[0]) / texScale(dk);
      // quad a -> b -> b+in -> a+in is CCW seen from above; shared edge at v=1, ragged inner end at v=0
      const a2 = [a[0] + in_[0], a[1] + in_[1]], b2 = [b[0] + in_[0], b[1] + in_[1]];
      B(dk).quad([a[0], yy, a[1]], [b[0], yy, b[1]], [b2[0], yy, b2[1]], [a2[0], yy, a2[1]], [0, 1, 0],
        [[u(a), 1], [u(b), 1], [u(b2), 0], [u(a2), 0]], [ntint, ntint, ntint, ntint], FILL.spill);
    }
    // ---- damp shoreline band on the land side of every water border (kills the ruled water/land cut)
    for (const s of SIDES) {
      const nb = at(x + s.nx, z + s.nz); if (!nb || !nb.water) continue;
      const a = s.a(x, z), b = s.b(x, z), W_ = 0.38, in_ = [-s.nx * W_, -s.nz * W_], yy = top + 0.005;
      const u = (p) => (s.tan === 'z' ? p[1] : p[0]) / texScale('wetband');
      const a2 = [a[0] + in_[0], a[1] + in_[1]], b2 = [b[0] + in_[0], b[1] + in_[1]];
      const wt = mul(tint, 1.0);
      B('wetband').quad([a[0], yy, a[1]], [b[0], yy, b[1]], [b2[0], yy, b2[1]], [a2[0], yy, a2[1]], [0, 1, 0],
        [[u(a), 1], [u(b), 1], [u(b2), 0], [u(a2), 0]], [wt, wt, wt, wt], FILL.spill);
    }
    // ---- scatter stamp: one decal on a fraction of tiles, random size, position and dihedral
    const table = SCATTER[key];
    if (table) {
      let roll = hash(x, z, 41);
      for (const [dk, pr] of table) {
        if (roll < pr) {
          const sz = 0.46 + hash(x, z, 42) * 0.36;
          const m = (1 - sz) * 0.5, cx = x + m + hash(x, z, 43) * (1 - sz - m), cz = z + m + hash(x, z, 44) * (1 - sz - m);
          const k = Math.floor(hash(x, z, 45) * 8), yy = top + 0.006, dc = mul(tint, 0.99);
          const P = (i, j) => { const [lx, ly] = dih(k, i, j); return { p: [cx + i * sz, yy, cz + j * sz], uv: [lx, 1 - ly] }; };
          const q0 = P(0, 0), q1 = P(0, 1), q2 = P(1, 1), q3 = P(1, 0);
          B(dk).quad(q0.p, q1.p, q2.p, q3.p, [0, 1, 0], [q0.uv, q1.uv, q2.uv, q3.uv], [dc, dc, dc, dc], FILL.spill);
          break;
        }
        roll -= pr;
      }
    }
    // ---- walls
    for (const s of SIDES) {
      const nb = at(x + s.nx, z + s.nz);
      const edge = !nb;
      let bottomH = nb ? (nb.water ? nb.h - 2 : nb.h) : Math.min(cutH, t.h);
      const a = s.a(x, z), b = s.b(x, z);
      const uOf = (p) => (s.tan === 'z' ? p[1] : p[0]);
      if (edge && t.h > cutH || !edge && bottomH < t.h) {
        const drop = t.h - bottomH, sk = sideKey(t, drop), su = texScale(sk);
        const y0 = Y(bottomH), y1 = top, dropW = y1 - y0;
        // inside corners: the tile beyond each end of this wall (in front of us, along the wall) stands higher than the floor
        const floorH = nb ? (nb.water ? nb.h - 2 : nb.h) : cutH;
        const tanA = s.tan === 'z' ? [0, a[1] - (z + 0.5) > 0 ? 1 : -1] : [a[0] - (x + 0.5) > 0 ? 1 : -1, 0];
        const frontX = x + s.nx, frontZ = z + s.nz;
        const tA = at(frontX + tanA[0], frontZ + tanA[1]), tB = at(frontX - tanA[0], frontZ - tanA[1]);
        const concA = land(tA) && tA.h > floorH, concB = land(tB) && tB.h > floorH;
        // rank 13: per-face stamp phase + value jitter. Without these, V is raw world Y (so every
        // height step draws the identical masonry course) and U is raw world position (so the stamp
        // repeats every 2 tiles at one phase forever). Offsets are quantised to the 64-texel tile grid.
        const jU = Math.floor(hash(x, z, 17 + s.nx * 3 + s.nz * 7) * 8) / 8;
        const jV = Math.floor(hash(x, z, 18 + s.nx * 5 + s.nz * 11) * 16) / 16;
        // R4: 4x8 phases still left the three-lobe cobble motif reading at one handedness everywhere. Mirroring
        // U (and V) per face is what actually breaks the autocorrelation: negating the coord under RepeatWrapping
        // is an exact flip, so the stamp keeps its pixel grid but changes its shape.
        const mU = hash(x, z, 21 + s.nx * 7 + s.nz * 3) < 0.5 ? -1 : 1;
        const mV = hash(x, z, 22 + s.nx * 9 + s.nz * 5) < 0.5 ? -1 : 1;
        const shade = faceShade(s) * (0.82 + hash(x, z, 19 + s.nx * 2 + s.nz * 13) * 0.36);
        // ref_55: no two stone columns share a value. A per-face warm/cool nudge on top of the value jitter.
        const hj = (hash(x, z, 23 + s.nx * 11 + s.nz * 2) - 0.5) * 0.13;
        const wallTint = [tint[0] * (1 + hj), tint[1], tint[2] * (1 - hj)];
        // R5 phase lock, the half r4 missed. jU/mU/jV/mV vary the stamp BETWEEN faces, but V itself was raw
        // world Y, so (a) every face on the map shared one global vertical phase grid whose period is exactly
        // one texture repeat = 1 world unit = 4 height steps, and (b) inside a single tall face V was a linear
        // ramp, so a 2-unit drop drew its own pattern twice, pixel for pixel. Both are fixed here:
        //   - V is FACE-RELATIVE (py - y0), so there is no global phase to lock to;
        //   - vSc gives each face its own vertical period (0.80-1.30 of a repeat per unit), so no two faces
        //     share a pitch and the population autocorrelation has no common peak to build;
        //   - the face is cut into extra horizontal bands whose V boundaries are warped off the linear ramp,
        //     so the mapping is piecewise-linear with a different slope per band and cannot self-repeat.
        // Same hash family as jU/jV, so the result is still deterministic per face.
        const vSc = 0.80 + Math.floor(hash(x, z, 24 + s.nx * 3 + s.nz * 5) * 5) / 5 * 0.50;
        const yLip = y1 - Math.min(0.07, dropW * 0.25), yBase = y0 + Math.min(0.1, dropW * 0.3);
        const nMid = Math.max(1, Math.min(3, Math.round(dropW / 0.42)));
        const rows = [y0, yBase];
        for (let i = 1; i < nMid; i++) rows.push(lerp(yBase, yLip, i / nMid));
        rows.push(yLip, y1);
        const last = rows.length - 1;
        const vAmt = Math.min(0.13, dropW * 0.22);
        // interior band boundaries only: the base and the lip keep their true V so the contact line and the
        // course under the fringe stay put. Value jitter on the same boundaries reads as rock strata (ref_54)
        // and is the second thing that flattens the vertical autocorrelation -- what is measured is LUMA.
        const vOf = rows.map((py, ri) => (py - y0) * vSc + jV
          + (ri === 0 || ri === last ? 0 : (hash(x, z, 60 + ri * 7 + s.nx * 2 + s.nz * 3) - 0.5) * 2 * vAmt));
        const sJit = (ri) => ri === 0 || ri === last ? 1
          : 1 + (hash(x, z, 70 + ri * 11 + s.nx * 5 + s.nz * 2) - 0.5) * 0.22;
        const gradLo = drop >= 4 ? 0.82 : 0.92;
        const P = (ci, ri) => {
          const u = WU[ci], py = rows[ri];
          const px = a[0] + (b[0] - a[0]) * u, pz = a[1] + (b[1] - a[1]) * u;
          let f = shade * lerp(gradLo, 1, (py - y0) / Math.max(1e-3, dropW)) * sJit(ri);
          if (ci === 0 && concA) f *= 0.70; if (ci === 3 && concB) f *= 0.70;
          // R4 junction: round 3 put a *highlight* on the wall's top row, so on a sun-facing terrace the
          // brightest band in the frame sat immediately under the grass and the lip read as one continuous
          // value. the genre (ref_51, ref_55) puts a dark contact line there instead: the shaded underside of the lip.
          if (ri === 0) f *= 0.86; if (ri === last) f *= 0.58;
          f = softFloor(f);
          return { p: [px, py, pz], uv: [mU * ((uOf(a) + (uOf(b) - uOf(a)) * u) / su + jU), mV * vOf[ri]], c: mul(wallTint, f) };
        };
        for (let ri = 0; ri < last; ri++) for (let ci = 0; ci < 3; ci++) {
          const q0 = P(ci, ri), q1 = P(ci + 1, ri), q2 = P(ci + 1, ri + 1), q3 = P(ci, ri + 1);
          B(sk).quad(q0.p, q1.p, q2.p, q3.p, s.n, [q0.uv, q1.uv, q2.uv, q3.uv], [q0.c, q1.c, q2.c, q3.c], FILL.wall, AMB.wall);
        }
        // overhang fringe on the top edge
        const fk = FRINGE[t.t];
        if (fk && dropW >= 0.2) {
          const o = 0.006, fa = [a[0] + s.nx * o, a[1] + s.nz * o], fb = [b[0] + s.nx * o, b[1] + s.nz * o];
          // R4 regression 2 (black tar drip): the fringe is grass/moss ROLLED OVER the lip, so (a) its normal
          // leans ~39 deg up and it catches the key like a top face instead of a shaded wall, and (b) its value
          // is blended most of the way back toward the top plane rather than inheriting the wall's shade outright.
          // Target from a reference capture, measured: moss band 0.6-11.1 luma ABOVE the rock immediately below it.
          // Two stacked rows, not one: the top ~0.06 units is the KEYLINE -- the shaded underside of the lip, which
          // is what makes the terrace edge readable where a bright moss band alone would sit at the grass's own
          // value and the edge would vanish (the junction failure). Body stays well above the rock.
          const fn = [s.n[0] * 0.62, 0.78, s.n[2] * 0.62];
          const fs = texScale(fk), yb = y1 - Math.min(FRINGE_H, dropW);
          // R5: 0.65/1.34 put the moss band ABOVE the grass it hangs from on every lit orientation, which is
          // where the junction inverted. 0.42/1.06 keeps it clearly above the rock (2.0x on the darkest face,
          // 1.2x on the brightest) and clearly below the top. Keyline a touch taller so it survives at wide.
          const fbase = mul(tint, lerp(faceShade(s), 1.0, 0.42) * 1.06);
          const yk = y1 - Math.min(0.055, (y1 - yb) * 0.38);
          const fRows = [yb, yk, y1], fCol = [mul(fbase, 0.86), fbase, mul(fbase, 0.38)];
          const vAt = (y) => 1 - (y1 - y) / FRINGE_H;
          for (let fi = 0; fi < 2; fi++) {
            const ylo = fRows[fi], yhi = fRows[fi + 1], clo = fCol[fi], chi = fCol[fi + 1];
            B(fk).quad([fa[0], ylo, fa[1]], [fb[0], ylo, fb[1]], [fb[0], yhi, fb[1]], [fa[0], yhi, fa[1]], fn,
              [[uOf(a) / fs, vAt(ylo)], [uOf(b) / fs, vAt(ylo)], [uOf(b) / fs, vAt(yhi)], [uOf(a) / fs, vAt(yhi)]],
              [clo, clo, chi, chi], FILL.fringe, AMB.fringe);
          }
        }
      }
      if (edge) { // black diorama cut below the lowest level
        const yc = Y(Math.min(cutH, t.h));
        B('skirt').quad([a[0], Y(-8), a[1]], [b[0], Y(-8), b[1]], [b[0], yc, b[1]], [a[0], yc, a[1]], s.n, [[0, 0], [1, 0], [1, 1], [0, 1]], [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], 0);
      }
    }
  }
  // ---- water: a chamfer distance-to-bank field drives everything (bed slope, colour ramp, foam contour)
  const SUB = 4;                       // sub-quads per water tile
  const DEEP_R = 0.95;                 // tiles from the bank at which the bed reaches full depth
  const BED_SHALLOW = 0.055, BED_DEEP = 0.52;
  const dist = [];
  for (let z = 0; z < map.d; z++) { const row = new Array(map.w); for (let x = 0; x < map.w; x++) row[x] = map.tiles[z][x].water ? 1e3 : 0; dist.push(row); }
  const dRaw = (x, z) => (x < 0 || z < 0 || x >= map.w || z >= map.d) ? 1e3 : dist[z][x];
  for (let z = 0; z < map.d; z++) for (let x = 0; x < map.w; x++)
    dist[z][x] = Math.min(dist[z][x], dRaw(x - 1, z) + 1, dRaw(x, z - 1) + 1, dRaw(x - 1, z - 1) + 1.41, dRaw(x + 1, z - 1) + 1.41);
  for (let z = map.d - 1; z >= 0; z--) for (let x = map.w - 1; x >= 0; x--)
    dist[z][x] = Math.min(dist[z][x], dRaw(x + 1, z) + 1, dRaw(x, z + 1) + 1, dRaw(x + 1, z + 1) + 1.41, dRaw(x - 1, z + 1) + 1.41);
  // off-map reads as open water, so the river keeps running past the diorama cut instead of foaming along it
  const distAt = (px, pz) => {
    const fx = px - 0.5, fz = pz - 0.5, x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
    const g = (x, z) => (x < 0 || z < 0 || x >= map.w || z >= map.d) ? DEEP_R + 1 : dist[z][x];
    return lerp(lerp(g(x0, z0), g(x0 + 1, z0), tx), lerp(g(x0, z0 + 1), g(x0 + 1, z0 + 1), tx), tz);
  };
  const depth01 = (px, pz) => { const u = (distAt(px, pz) - 0.5) / DEEP_R; return u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u); };

  const water = new Batch(); const wdepth = [];
  for (let z = 0; z < map.d; z++) for (let x = 0; x < map.w; x++) {
    const t = map.tiles[z][x]; if (!t.water) continue;
    // rank 2(e): the surface sits 0.11 BELOW the land top, so every bordering land tile emits a real
    // bank face. the genre never lets water touch a grass top directly.
    const surf = Y(t.h) - 0.11, floor = surf - BED_DEEP - 0.03;
    const bt = tileTint(t, x, z), sc = texScale('bed'), rot = Math.floor(hash(x, z, 7) * 8);
    // bed: shelves up to the bank, sinks mid-channel, and goes darker + bluer with depth so the gradient
    // is real geometry the water shader can read, not a painted-on vignette
    const bedV = (i, j) => {
      const px = x + i / SUB, pz = z + j / SUB, dd = depth01(px, pz);
      const [ux, uy] = dih(rot, i / SUB, j / SUB);
      const f = 0.95 - dd * 0.46;
      return { p: [px, surf - (BED_SHALLOW + (BED_DEEP - BED_SHALLOW) * dd), pz], uv: [(x + ux) / sc, (z + uy) / sc],
        c: [bt[0] * f * (1 - dd * 0.26), bt[1] * f * (1 - dd * 0.10), bt[2] * f * (1 + dd * 0.14)] };
    };
    for (let j = 0; j < SUB; j++) for (let i = 0; i < SUB; i++) {
      const a = bedV(i, j), b = bedV(i, j + 1), c = bedV(i + 1, j + 1), d = bedV(i + 1, j);
      B('bed').quad(a.p, b.p, c.p, d.p, [0, 1, 0], [a.uv, b.uv, c.uv, d.uv], [a.c, b.c, c.c, d.c], FILL.bed);
    }
    // surface: flat, but every vertex carries its shore distance so the shader can fade the waterline
    // along a noisy contour instead of the tile square
    const wv = (i, j) => ({ p: [x + i / SUB, surf, z + j / SUB], uv: [x + i / SUB, z + j / SUB], d: depth01(x + i / SUB, z + j / SUB) });
    for (let j = 0; j < SUB; j++) for (let i = 0; i < SUB; i++) {
      const a = wv(i, j), b = wv(i, j + 1), c = wv(i + 1, j + 1), d = wv(i + 1, j);
      water.quad(a.p, b.p, c.p, d.p, [0, 1, 0], [a.uv, b.uv, c.uv, d.uv], [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]], 0);
      wdepth.push(a.d, b.d, c.d, a.d, c.d, d.d);
    }
    for (const s of SIDES) if (!at(x + s.nx, z + s.nz)) {   // blue cross-section where the river leaves the diorama
      const a = s.a(x, z), b = s.b(x, z);
      water.quad([a[0], floor, a[1]], [b[0], floor, b[1]], [b[0], surf, b[1]], [a[0], surf, a[1]], s.n,
        [[a[0] + a[1], floor], [b[0] + b[1], floor], [b[0] + b[1], surf], [a[0] + a[1], surf]], [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]], 0);
      wdepth.push(1, 1, 1, 1, 1, 1);
      B('skirt').quad([a[0], Y(-8), a[1]], [b[0], Y(-8), b[1]], [b[0], floor, b[1]], [a[0], floor, a[1]], s.n, [[0, 0], [1, 0], [1, 1], [0, 1]], [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], 0);
    }
  }
  for (const [key, batch] of batches) {
    let mat;
    // PERF r11: DoubleSide like the bottom cap below, so the two black materials share one program (the skirt's inner
    // faces sit under the terrain and behind the cap, never in view).
    if (key === 'skirt') mat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
    // fringe needs a low cut to survive as a BAND (rank 12); scatter/spill stamps do not -- at 0.22 their soft
    // warm halo texels became fully opaque and scattered orange patches across the grass (R4 regression 1).
    else if (DECAL(key)) mat = paintedMaterial(key, { alphaTest: key.startsWith('fringe') ? 0.22 : 0.42 });
    else mat = paintedMaterial(key);
    const m = new THREE.Mesh(batch.geometry(), mat); m.name = 'terrain_' + key;
    m.receiveShadow = key !== 'skirt';
    // decals lie a few thousandths above the surface: if they cast, they shadow themselves and read as black tiles
    m.castShadow = !(key === 'skirt' || DECAL(key));
    if (DECAL(key)) m.renderOrder = 1;
    group.add(m);
  }
  // bottom cap so the diorama reads as a solid island in the void
  const cap = new THREE.Mesh(new THREE.PlaneGeometry(map.w, map.d), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }));
  cap.rotation.x = Math.PI / 2; cap.position.set(map.w / 2, Y(-8), map.d / 2); group.add(cap);
  // water surface
  const wgeo = water.geometry(); wgeo.setAttribute('aDepth', new THREE.Float32BufferAttribute(wdepth, 1));
  const wmat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uRipple: { value: tex('ripple').texture }, uCaustic: { value: tex('caustic').texture },
      uShallow: { value: new THREE.Color(skin?.water?.shallow ?? 0x6f9aa4) }, uMid: { value: new THREE.Color(skin?.water?.mid ?? 0x3a6f96) },
      uDeep: { value: new THREE.Color(skin?.water?.deep ?? 0x1e3f60) }, uCrest: { value: new THREE.Color(skin?.water?.crest ?? 0x8fb6c4) },
      uFoam: { value: new THREE.Color(skin?.water?.foam ?? 0xc8d8dc) },
      // rank 2(a): key-light coupling. Without it the surface is fully unlit and holds daylight
      // values while the rest of the map sits at dusk. Fed from the rig in group.userData.update.
      uLight: { value: new THREE.Color(1, 1, 1) },
    },
    vertexShader: `attribute float aDepth; varying vec2 vUv; varying float vD;
      void main() { vUv = uv; vD = aDepth; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime; uniform sampler2D uRipple, uCaustic; uniform vec3 uShallow, uMid, uDeep, uCrest, uFoam, uLight;
      varying vec2 vUv; varying float vD;
      void main() {
        vec2 p = vUv;                                  // world tile coordinates
        vec3 r1 = texture2D(uRipple, p * 0.30  + vec2( 0.020,  0.012) * uTime).rgb;   // fast layer
        vec3 r2 = texture2D(uRipple, p * 0.63  + vec2(-0.016,  0.031) * uTime).rgb;   // faster, finer
        vec3 r3 = texture2D(uRipple, p * 0.115 + vec2( 0.006, -0.004) * uTime).rgb;   // slow swell / patch mask
        float swell = r1.r * 0.55 + r3.b * 0.45;

        // depth ramp: teal over the shelf, saturated the genre blue mid-channel, navy in the deep
        vec3 col = mix(uShallow, uMid, smoothstep(0.02, 0.44, vD));
        col = mix(col, uDeep, smoothstep(0.42, 0.98, vD));
        col *= 0.88 + 0.24 * swell;
        col *= uLight;                                 // couple the ramp to the key BEFORE any additive term
        vec3 crestC = uCrest * uLight, foamC = uFoam * uLight;

        // crests are travelling LINES, not noise blobs: two sine families warped by the noise field,
        // which is what reads as water rather than as fog on a blue plane
        float w1 = sin((p.x *  0.86 + p.y * 0.51) *  6.6 + uTime * 1.50 + (r1.r - 0.5) * 4.2);
        float w2 = sin((p.x * -0.55 + p.y * 0.84) * 10.5 - uTime * 2.20 + (r3.b - 0.5) * 3.4);
        // gate the crest lines behind a slow drifting mask so ripples come and go in patches instead of
        // covering the whole surface in a regular net
        float crest = smoothstep(0.86, 1.00, w1) * smoothstep(0.42, 0.86, r3.r)
                    + smoothstep(0.95, 1.00, w2) * smoothstep(0.58, 0.92, r1.g) * 0.55;
        crest = clamp(crest, 0.0, 1.0);
        col = mix(col, crestC, crest * (0.26 + 0.30 * vD));

        // sparse hard specular glints riding the crest lines
        float glint = smoothstep(0.9930, 1.0, w1) * smoothstep(0.62, 0.95, r2.r)
                    + smoothstep(0.9960, 1.0, w2) * smoothstep(0.68, 0.97, r2.b);
        col += vec3(0.78, 0.94, 1.0) * uLight * glint * 0.30;   // rank 2(c): was 1.25 -> cracked-glass scratches

        // caustics: tight bright veins, only where the bed is close enough to catch them
        float ca = texture2D(uCaustic, p * 0.66 + vec2( 0.011, 0.008) * uTime).r
                 * texture2D(uCaustic, p * 0.91 + vec2(-0.009, 0.013) * uTime).r;
        float caw = pow(ca, 1.6) * (1.0 - smoothstep(0.04, 0.30, vD));
        col += crestC * caw * 0.07;                             // rank 2(c): was 0.22

        // waterline: a noisy contour, so the square tile edge never shows
        float wob  = (r3.g - 0.5) * 0.34 + (r1.r - 0.5) * 0.10;
        float edge = smoothstep(-0.02, 0.13, vD + wob);
        float foam = (1.0 - smoothstep(0.0, 0.13, vD + wob)) * edge;
        col = mix(col, foamC, foam * 0.80);

        float alpha = mix(0.24, 0.93, smoothstep(0.0, 0.60, vD));
        alpha = max(alpha, caw * 0.30 + crest * 0.35 + glint);
        alpha = mix(0.30, alpha, edge);                         // rank 2(e)/regression 4: alpha FLOOR, not a fade to zero
        alpha = max(alpha, foam * 0.9 * edge);
        col = min(col, vec3(0.62));                             // rank 2(d): hard ceiling, no blow-past-1.0
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
  const wmesh = new THREE.Mesh(wgeo, wmat); wmesh.name = 'water'; wmesh.renderOrder = 2; group.add(wmesh);
  // rank 2(a): find the rig's key (the one shadow-casting directional) and feed its colour x intensity in,
  // normalised against the round-3 target sun intensity so the water tracks the grade instead of ignoring it.
  let keyLight = null;
  const cl = (v) => Math.min(1.1, Math.max(0.35, v));
  group.userData.update = (t) => {
    wmat.uniforms.uTime.value = t;
    if (!keyLight && group.parent) group.parent.traverse((o) => { if (!keyLight && o.isDirectionalLight && o.castShadow) keyLight = o; });
    if (keyLight) {
      const k = keyLight.intensity / 3.4, c = keyLight.color, u = wmat.uniforms.uLight.value;
      u.setRGB(cl(lerp(1, c.r * k, 0.65)), cl(lerp(1, c.g * k, 0.65)), cl(lerp(1, c.b * k, 0.65)));
    }
  };
  return group;
}
export function surfaceY(map, x, z) { const t = map.at(x, z); return t ? t.h * HSTEP : 0; }
