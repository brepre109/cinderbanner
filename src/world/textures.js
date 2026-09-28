import * as THREE from 'three';
// Terrain texture registry (terrain owner). Every key maps to an ordered list of candidate files under /textures/;
// the first that loads wins, and a procedural canvas stands in until then so the game always renders.
// The painted set lives in /textures/p/ (64 texels per tile, see p/_paint.py); the older delivered set is the fallback.
// Every texture: nearest mag (pixel-art crisp), mipmapped min (no shimmer), repeat wrap, sRGB.
const FILES = {
  // tops
  g: ['p/grass', 'grass_top'], g2: ['p/grass2', 'grass_top'], k: ['p/grass_dark', 'grass_dark_top'],
  d: ['p/dirt', 'dirt_top'], d2: ['p/dirt2', 'dirt_top'], s: ['p/flag', 'cobble_top'],
  b: ['p/plank_top', 'bridge_plank'], r: ['p/rock_top', 'rock_cliff_side'], sand: ['p/sand', 'sand_top'], bed: ['p/bed', 'sand_top'],
  // sides
  stone_side: ['p/stone_side', 'stone_block_side'], rock_side: ['p/rock_side', 'rock_cliff_side'], earth_side: ['p/earth_side', 'earth_cliff_side'],
  // R15 interior walls (props.js cryptwall): the crypt's grimed ashlar, the nave's pale limestone and its trim
  crypt_wall: ['p/crypt_wall', 'p/stone_side'], nave_wall: ['p/nave_wall', 'p/stone_side'], nave_trim: ['p/nave_trim', 'p/rock_side'],
  wood_side: ['p/plank_side', 'wood_plank_side'], wood_top: ['p/plank_top', 'wood_plank_top'], roof: ['roof_tile'], plaster: ['plaster_wall'],
  // water + decals
  w: ['water'], ripple: ['p/ripple'], caustic: ['p/caustic'],
  fringe_grass: ['p/fringe_grass'], fringe_earth: ['p/fringe_earth'], spill_dirt: ['p/spill_dirt'], spill_sand: ['p/spill_sand'], spill_grass: ['p/spill_grass'],
  wetband: ['p/wetband'],
  // scatter decals: one stamp dropped on a fraction of tiles, random size/rotation, to break up big flats
  sc_pebbles: ['p/sc_pebbles'], sc_tufts: ['p/sc_tufts'], sc_weeds: ['p/sc_weeds'], sc_bare: ['p/sc_bare'], sc_moss: ['p/sc_moss'], sc_gravel: ['p/sc_gravel'],
  // R14 'ashfall' skin (terrain.js SKINS): the painted set re-hued to ash turf / peat / soot stone by p/_ash.py.
  // Only a map whose mood carries a skin ever requests these keys; each falls back to its shared painting.
  g_ash: ['p/grass_ash', 'p/grass'], g2_ash: ['p/grass2_ash', 'p/grass2'], k_ash: ['p/grass_dark_ash', 'p/grass_dark'],
  d_ash: ['p/dirt_ash', 'p/dirt'], d2_ash: ['p/dirt2_ash', 'p/dirt2'], s_ash: ['p/flag_ash', 'p/flag'], r_ash: ['p/rock_top_ash', 'p/rock_top'],
  bed_ash: ['p/bed_ash', 'p/bed'], stone_side_ash: ['p/stone_side_ash', 'p/stone_side'], rock_side_ash: ['p/rock_side_ash', 'p/rock_side'],
  earth_side_ash: ['p/earth_side_ash', 'p/earth_side'], fringe_grass_ash: ['p/fringe_grass_ash', 'p/fringe_grass'],
  fringe_earth_ash: ['p/fringe_earth_ash', 'p/fringe_earth'], spill_grass_ash: ['p/spill_grass_ash', 'p/spill_grass'],
  spill_dirt_ash: ['p/spill_dirt_ash', 'p/spill_dirt'], wetband_ash: ['p/wetband_ash', 'p/wetband'],
  sc_tufts_ash: ['p/sc_tufts_ash', 'p/sc_tufts'], sc_moss_ash: ['p/sc_moss_ash', 'p/sc_moss'], sc_weeds_ash: ['p/sc_weeds_ash', 'p/sc_weeds'], sc_bare_ash: ['p/sc_bare_ash', 'p/sc_bare'],
};
// R15 story skins (maps owner, public/textures/p/_r15skins.py): *_snow, *_crypt, *_nave. Same contract as the ashfall
// set: only a map whose mood carries the skin (terrain.js SKINS) requests these keys, and each falls back to its base.
const SKIN_SRC = { g: 'grass', g2: 'grass2', k: 'grass_dark', d: 'dirt', d2: 'dirt2', s: 'flag', r: 'rock_top', bed: 'bed',
  stone_side: 'stone_side', rock_side: 'rock_side', earth_side: 'earth_side', fringe_grass: 'fringe_grass', fringe_earth: 'fringe_earth',
  spill_grass: 'spill_grass', spill_dirt: 'spill_dirt', wetband: 'wetband', sc_tufts: 'sc_tufts', sc_moss: 'sc_moss', sc_weeds: 'sc_weeds', sc_bare: 'sc_bare' };
for (const sfx of ['snow', 'crypt', 'nave']) for (const [k, f] of Object.entries(SKIN_SRC)) FILES[`${k}_${sfx}`] = [`p/${f}_${sfx}`, `p/${f}`];
/** The base key a skinned key paints over ('g_snow' -> 'g'); identity for an unskinned key. */
export const skinBase = (k) => k.replace(/_(ash|snow|crypt|nave)$/, '');
// How many tiles one repeat of the texture spans along U (and V for tops). Sides are always 1 tile tall per repeat.
const SCALE = { g: 2, g2: 2, k: 2, d: 2, d2: 2, s: 2, sand: 2, r: 2, bed: 2, rock_side: 2, earth_side: 2, fringe_grass: 2, fringe_earth: 2, spill_dirt: 2, spill_sand: 2, spill_grass: 2, wetband: 2, ripple: 2, caustic: 2 };
export function texScale(key) { return SCALE[key] || SCALE[skinBase(key)] || 1; }   // skin keys inherit their base scale
const LINEAR = new Set(['ripple', 'caustic']);
const DATA = new Set(['ripple', 'caustic']);
const ALPHA_BASE = /^(fringe_|spill_|sc_|wetband)/;
const ALPHA = new Set(['fringe_grass', 'fringe_earth', 'spill_dirt', 'spill_sand', 'spill_grass', 'wetband',
  'sc_pebbles', 'sc_tufts', 'sc_weeds', 'sc_bare', 'sc_moss', 'sc_gravel',
  'fringe_grass_ash', 'fringe_earth_ash', 'spill_grass_ash', 'spill_dirt_ash', 'wetband_ash', 'sc_tufts_ash', 'sc_moss_ash', 'sc_weeds_ash', 'sc_bare_ash']);

const FALLBACK = {
  g: [[92, 132, 52], [118, 160, 66], [74, 112, 46]], g2: [[104, 128, 56], [130, 156, 70], [82, 104, 44]], d2: [[142, 106, 62], [166, 128, 80], [116, 86, 50]], caustic: [[0, 0, 0], [90, 90, 90], [0, 0, 0]], k: [[66, 104, 44], [84, 124, 52], [52, 84, 38]],
  d: [[150, 112, 66], [172, 134, 84], [124, 92, 54]], s: [[142, 142, 150], [178, 178, 186], [104, 104, 116]],
  b: [[128, 92, 52], [156, 116, 70], [96, 66, 38]], sand: [[204, 178, 120], [222, 198, 140], [176, 150, 98]], bed: [[96, 108, 90], [120, 130, 110], [70, 80, 66]],
  w: [[52, 128, 208], [96, 172, 232], [36, 96, 176]], stone_side: [[126, 130, 146], [170, 174, 190], [86, 90, 108]],
  rock_side: [[150, 140, 116], [190, 178, 150], [84, 76, 64]], r: [[150, 140, 116], [190, 178, 150], [84, 76, 64]], earth_side: [[132, 96, 60], [160, 122, 80], [98, 70, 44]],
  wood_side: [[118, 82, 46], [146, 106, 62], [88, 60, 34]], wood_top: [[128, 92, 52], [156, 116, 70], [96, 66, 38]],
  roof: [[140, 74, 58], [172, 96, 74], [104, 52, 42]], plaster: [[226, 214, 186], [240, 232, 208], [190, 176, 150]],
  ripple: [[0, 0, 0], [255, 255, 255], [0, 0, 0]],
};
function hash(x, y, s = 0) { let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967295; }
function procedural(key) {
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const id = g.createImageData(S, S); const p = id.data;
  if (ALPHA.has(key) || ALPHA_BASE.test(key)) { g.putImageData(id, 0, 0); return new THREE.CanvasTexture(c); } // fully transparent until the decal arrives
  const [base, lit, dark] = FALLBACK[key] || FALLBACK.d;
  const blocky = /stone|plank|roof|wood|^s$|^b$/.test(key);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let n = hash(x >> 2, y >> 2, 1) * 0.6 + hash(x >> 1, y >> 1, 2) * 0.4;
    let col = n > 0.62 ? lit : n < 0.32 ? dark : base;
    if (blocky) { const bw = 32, bh = key.includes('plank') || key.includes('wood') ? 8 : 16; const sh = ((y / bh) | 0) % 2 ? bw / 2 : 0; if ((x + sh) % bw === 0 || y % bh === 0) col = dark; else if ((x + sh) % bw === 1 || y % bh === 1) col = lit; }
    const i = (y * S + x) * 4; p[i] = col[0]; p[i + 1] = col[1]; p[i + 2] = col[2]; p[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return new THREE.CanvasTexture(c);
}
const cache = new Map();
const loader = new THREE.TextureLoader();
function setup(t, key) {
  t.magFilter = LINEAR.has(key) ? THREE.LinearFilter : THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  // ripple/caustic are data fields the water shader reads, not colour: leave them linear so the noise stays linear
  t.colorSpace = DATA.has(key) ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  return t;
}
// PERF r11: the procedural stand-in is painted only when every candidate file has FAILED. It used to be painted (a
// 64x64 canvas, per-pixel JS) and uploaded for every key at every boot, then replaced by the PNG a moment later: ~40
// canvases and ~40 throwaway GPU uploads per battle. The texture object is still handed out at once (materials hold
// it); it gets its image when the file lands. texturesReady() resolves once every requested key has an image
// (painted or procedural), and the battle awaits it before its first frame, so no frame ever shows a missing image.
const pending = [];
export function tex(key) {
  if (cache.has(key)) return cache.get(key);
  const t = setup(new THREE.Texture(), key);
  const holder = { texture: t, loaded: null };
  cache.set(key, holder);
  // Try the painted candidates in order; set the image on the existing texture object (materials already hold it).
  const names = FILES[key] || [key];
  pending.push(new Promise((done) => {
    const fallback = () => { const c = procedural(key); t.image = c.image; t.needsUpdate = true; done(); };
    const tryLoad = (i) => { if (i >= names.length) { fallback(); return; } loader.load(`./textures/${names[i]}.png`, (img) => { t.image = img.image; t.needsUpdate = true; holder.loaded = names[i]; done(); }, undefined, () => tryLoad(i + 1)); };
    try { tryLoad(0); } catch { fallback(); }
  }));
  return holder;
}
/** Resolves when every texture requested so far has its image (the painted file, or the procedural stand-in). */
export function texturesReady() { return Promise.all(pending); }
export const TEXTURE_NAMES = FILES;
