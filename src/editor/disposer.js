// Rebuild disposal for the editor's real-renderer viewport (PLAN 6.5).
//
// The two builders we drive have OPPOSITE ownership rules, and getting this wrong is what kills
// every "edit with the shipping renderer" tool:
//   · terrain.js  -> paintedMaterial() takes its map/emissiveMap from textures.js's module-level
//     cache, whose `image` is hot-swapped in place when the painted PNG lands. The material is
//     fresh per build, the TEXTURE is not. Disposing it throws away the upload every other mesh
//     and every future build is sharing.
//   · props.js    -> a module-scope TextureLoader mints a FRESH THREE.Texture per billboard per
//     build (line 94) plus a MeshDepthMaterial carrying the same map (line 98). Wendford's 119
//     props are 60 billboards and 10 decals, so "dispose geometry and material only, never
//     textures" leaks 70 textures + 60 depth materials on EVERY commit — and the shipped map is
//     the small one. props.js ALSO holds a module-level material cache (MAT, the `solid()` constants,
//     thatch()/slates()) that is shared exactly like the terrain textures.
//
// So the discriminator cannot be a rule about KIND (texture vs material); it has to be a rule
// about OWNERSHIP. Two sources of truth, neither of them a mirrored hardcoded list:
//   1. textures.js's own key list, imported. tex() is idempotent and cached, so tex(k).texture is
//      byte-identically the object a later buildTerrain will hold.
//   2. observed sharing. Any resource that shows up under two DIFFERENT built roots came from a
//      module-level cache by definition — nothing per-build can be in two builds at once. One
//      pass of retain() per build is enough to learn props.js's MAT cache without importing it.
// Everything else is per-build and must go, or renderer.info.memory climbs until the context dies.
import { TEXTURE_NAMES, tex } from '../world/textures.js';

/** Roots currently installed in the scene. A resource reachable from any of them is off limits. */
const live = new Set();
/** resource -> the first root that showed it. Cleared as roots die, so this never grows unbounded. */
const owner = new Map();
/** Resources proven shared by appearing under two roots. Bounded by the module caches (~100). */
const sharedForever = new Set();
const stats = { textures: 0, geometries: 0, materials: 0, kept: 0, roots: 0 };

let SHARED_TEX = null;
/** textures.js's whole cache, materialised once. Lazy: importing this file must not fetch 35 PNGs. */
function sharedTextures() {
  if (SHARED_TEX) return SHARED_TEX;
  SHARED_TEX = new Set();
  for (const k of Object.keys(TEXTURE_NAMES)) {
    try { SHARED_TEX.add(tex(k).texture); } catch { /* no DOM: nothing to protect either */ }
  }
  return SHARED_TEX;
}
/** True for a texture owned by textures.js. Exported for the HUD/regression harness. */
export function isSharedTexture(t) { return sharedTextures().has(t); }

/** Every material an object can hold. `customDepthMaterial` is the one people miss — a plain
 *  `o.material.dispose()` traverse leaves it AND its map alive, which is precisely props.js's leak. */
function* materialsOf(o) {
  const m = o.material;
  if (Array.isArray(m)) { for (const s of m) if (s) yield s; } else if (m) yield m;
  if (o.customDepthMaterial) yield o.customDepthMaterial;
  if (o.customDistanceMaterial) yield o.customDistanceMaterial;
}
/** Every texture a material holds, found by scanning slots rather than a fixed list of three:
 *  map/emissiveMap/alphaMap covers what we build today, but a future prop with a normalMap must
 *  not silently start leaking. ShaderMaterial (the water surface) exposes none this way, which is
 *  correct — its uRipple/uCaustic uniforms are textures.js's and must never be touched. */
function* texturesOf(m) {
  for (const k in m) { const v = m[k]; if (v && v.isTexture) yield v; }
}
function resources(root, out) {
  root.traverse((o) => {
    if (!(o.isMesh || o.isSprite || o.isLine || o.isPoints)) return;
    if (o.geometry) out.add(o.geometry);
    for (const m of materialsOf(o)) { out.add(m); for (const t of texturesOf(m)) out.add(t); }
  });
  return out;
}

/**
 * Register a freshly built root as installed. Call this BEFORE disposing the root it replaces —
 * "swap before you drop" is not only about black frames, it is what teaches this module which
 * materials the two builds share.
 * @param {THREE.Object3D} root
 * @returns {THREE.Object3D} root, for chaining
 */
export function retain(root) {
  if (!root) return root;
  live.add(root);
  for (const r of resources(root, new Set())) {
    const o = owner.get(r);
    if (o === undefined) owner.set(r, root);
    else if (o !== root) sharedForever.add(r);
  }
  return root;
}

/**
 * Dispose exactly the per-rebuild half of a built root. Safe to call on a root that was never
 * retained (a late `buildProps` resolve that lost its generation race).
 * @param {THREE.Object3D} root  a `terrain` or `props` group, already removed from the scene
 * @returns {{textures:number, geometries:number, materials:number, kept:number}} this call's counts
 */
export function disposeBuilt(root) {
  const before = { t: stats.textures, g: stats.geometries, m: stats.materials, k: stats.kept };
  if (!root) return { textures: 0, geometries: 0, materials: 0, kept: 0 };
  live.delete(root);
  const keep = new Set(sharedTextures());
  for (const r of sharedForever) keep.add(r);
  for (const other of live) resources(other, keep);
  for (const r of resources(root, new Set())) {
    owner.delete(r);                       // this root is dead; whoever survives re-registers it
    if (keep.has(r)) { stats.kept++; continue; }
    r.dispose();
    if (r.isTexture) stats.textures++; else if (r.isBufferGeometry) stats.geometries++; else stats.materials++;
  }
  root.clear();
  stats.roots++;
  return { textures: stats.textures - before.t, geometries: stats.geometries - before.g,
           materials: stats.materials - before.m, kept: stats.kept - before.k };
}

/** Cumulative counters, for the HUD and the flat-over-200-commits regression assertion. */
export function disposeStats() { return { ...stats, live: live.size, tracked: owner.size, shared: sharedForever.size }; }
