import * as THREE from 'three';
import { SPRITE_H, TILE } from '../core/config.js';
import { registerSprite, attachScene, occStats } from './occlusion.js';
import { palette, onPrefs, flashScale } from '../ui/prefs.js';
import { motionForSheet } from './roster.js';   // R19 per-class motion profile (weight / body plan)   // OPTIONS hook (team palette, flash intensity)
// Billboarded unit sprites from /sprites/<name>.{png,json} packed by tools/pack_sprites.py.
// Atlas: 22 frames, row 0 = front view, row 1 = back view; every frame is registered on its own feet anchor.
// Poses (columns): 0 idle, 1 ready/guard, 2 attack wind-up, 3 impact/release, 4 cast/special, 5 recover,
//                  6 idle_b (breath), 7..10 walk0..walk3 (contact / down / contact / up) — the last five are built by
//                  the packer out of the drawn idle, because the source sheets carry no locomotion (CRITIQUE_R2 rank 9).
// Rendering: one shared texture per sheet with hand-built mip levels (each level is its own clean pixel-art render with a
// 1-px outline), sampled with the "pixel-art anti-aliasing" trick (texel edges are exactly one screen pixel wide at any
// magnification, mip chain for minification). No blur, no double scaling, hard alpha.
export const POSE = { idle: 0, ready: 1, attack: 2, attack2: 3, cast: 4, recover: 5, idleB: 6, walk0: 7, walk1: 8, walk2: 9, walk3: 10 };
export const WALK = [POSE.walk0, POSE.walk1, POSE.walk2, POSE.walk3];
const IDLE_PERIOD = 1.18;   // s — the two-frame breath cycle runs at ~0.85 Hz (the genre idles read at roughly this rate)
// R11 KO: a fall with WEIGHT in three wall-clock beats (scaled by battle speed): the knees BUCKLE (squash down on
// the recover frame), the body TOPPLES under gravity (ease-IN, it accelerates into the ground instead of the old
// ease-out float), and it BOUNCES once on landing. Flat at 240 (battle.js beat) + 130 + 300 = 670 ms at 1x, inside
// the round-6 'flat by 1000 ms' bar; fx_ko's thud is timed to that landing.
const KO_BUCKLE_MS = 130, KO_FALL_MS = 300, KO_BOUNCE_MS = 190, KO_RISE_MS = 420;
// --- scene-luminance key term (round-6 finding 1: 'runtime sprite lift/key term responsive to scene luminance')
// The sprites are unlit, so what decides whether a cast member survives the grade is how much light the SCENE
// around it gets: with the shipped rig (sun 5.4 / fill 0.22 / bounce 0.12 / hemi 0.16) the on-screen band lands
// where it should, but lighting.set({sun: ...}) or a darker map slice drops the GROUND without touching the
// sprites and the cast sinks into the cobble. This reads the live light rig off the scene graph (read-only —
// lighting.js owns the lights) and eases the gamma lift toward a floor as the rig dims, so the key term tracks
// scene luminance instead of being pinned to one round-5 exposure. It never INCREASES the exponent: a brighter
// rig can only relax the lift back toward the authored value (0.24), never crush a sprite.
const BASE_LIFT_GAMMA = 0.72;   // authored exponent (uLift.z) at the shipped rig
const KEY_REF = 4.60;           // scene-luma estimate of the reference rig the 78-band was authored against
                                // (sun 5.4/0xffd2a4 + fill/bounce/hemi at their shipped values, linear colour
                                // means). The live rig measures 4.01 (R6 probe readback) -> ratio 0.87 -> gain
                                // 1.15 -> gamma 0.209, i.e. the key term restores the band the dim rig lost.
const KEY_MAX = 1.45;           // how far a much dimmer rig may push the lift (0.24 -> 0.166, floored at 0.14)
let SCENE_FOR_KEY = null, KEY_AT = -1e9;
function keySceneLuma(root) {
  if (!SCENE_FOR_KEY) { let o = root; while (o.parent) o = o.parent; SCENE_FOR_KEY = o; }
  const s = SCENE_FOR_KEY; if (!s || !s.traverse) return null;
  let sun = 0, amb = 0;
  s.traverse((o) => {
    if (!o.isLight || !o.visible) return;
    // crude but honest irradiance proxy: key dominates (it is 5.4 against sub-0.25 ambients — lighting.js's own
    // ratio note), colored lights count at their channel mean.
    const i = o.intensity * ((o.color.r + o.color.g + o.color.b) / 3 || 1);
    if (o.isDirectionalLight) sun += i * (o.position.y > 0 ? 1 : 0.35);
    else if (o.isHemisphereLight) amb += i * 0.5;
    else if (o.isAmbientLight) amb += i;
    else if (o.isPointLight || o.isSpotLight) amb += i * 0.15;   // VFX kickers: noticed, not dominant
  });
  if (sun <= 0) return null;
  const est = sun + amb * 2.0;
  return est / KEY_REF;   // 1.0 at the shipped rig; <1 when the rig dims -> gain rises -> gamma eases down
}
function updateKey(s, u) {
  const now = performance.now();
  if (now - KEY_AT < 300) return; KEY_AT = now;
  const ratio = keySceneLuma(s.root);   // already KEY_REF-normalised: 1.0 at the reference rig
  if (ratio == null || !isFinite(ratio) || ratio <= 0.02) { u.uLift.value.z = Math.min(u.uLift.value.z, BASE_LIFT_GAMMA); return; }
  const gain = clamp(1.0 / ratio, 1.0, KEY_MAX);
  u.uLift.value.z = Math.max(0.55, BASE_LIFT_GAMMA / gain);
}
const atlasCache = new Map();
// QA hook (src/units/qa/units_check.mjs builds lineups / facing tables through it)
if (typeof window !== 'undefined') window.__UNITS__ = { loadAtlas: (n) => loadAtlas(n), UnitSprite: () => UnitSprite, POSE, WALK, occ: occStats };

function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
}
// R12 boot: the PNG is a vertical mip strip. It used to be sliced with one 2-D canvas drawImage per level, which the
// perf trace showed as ~2.5 s of GPU-process raster flush at boot (canvases are GPU-backed; every slice was a
// raster + readback), and every canvas stayed alive for the page's lifetime. Now: fetch -> createImageBitmap (decode
// off the main thread) -> one cropped ImageBitmap per level, each already FLIPPED (WebGL ignores UNPACK_FLIP_Y for
// ImageBitmap sources, so the flip three would have done happens here) and NOT premultiplied (a canvas stores
// premultiplied alpha, so the old path's partial-alpha edge texels went through a premultiply round trip; these
// arrive exactly as packed). The bitmaps are closed as soon as three has uploaded them (texture.onUpdate).
// ?atlas=canvas keeps the old path for an A/B.
const ATLAS_CANVAS = typeof location !== 'undefined' && new URLSearchParams(location.search).get('atlas') === 'canvas';
async function decodeLevels(name, levels) {
  if (!ATLAS_CANVAS && typeof createImageBitmap === 'function') {
    try {
      const blob = await (await fetch(`./sprites/${name}.png`)).blob();
      const opts = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
      const full = await createImageBitmap(blob, opts);
      const mips = await Promise.all(levels.map((l) => createImageBitmap(full, 0, l.y, l.w, l.h, { ...opts, imageOrientation: 'flipY' })));
      full.close?.();
      return { mips, bitmap: true };
    } catch (e) { console.warn('atlas: ImageBitmap path failed, using canvas', name, e); }
  }
  const img = await loadImage(`./sprites/${name}.png`);
  const mips = levels.map((l) => {
    const c = document.createElement('canvas'); c.width = l.w; c.height = l.h;
    c.getContext('2d').drawImage(img, 0, l.y, l.w, l.h, 0, 0, l.w, l.h); return c;
  });
  return { mips, bitmap: false };
}
export async function loadAtlas(name) {
  if (atlasCache.has(name)) return atlasCache.get(name);
  const p = (async () => {
    const meta = await (await fetch(`./sprites/${name}.json`)).json();
    const { mips, bitmap } = await decodeLevels(name, meta.levels);
    const texture = new THREE.Texture(mips[0]); texture.mipmaps = mips; texture.generateMipmaps = false;
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.anisotropy = 1;
    texture.colorSpace = THREE.SRGBColorSpace; texture.premultiplyAlpha = false; texture.flipY = !bitmap; texture.needsUpdate = true;
    texture.userData.size = [meta.levels[0].w, meta.levels[0].h];   // image dims survive the bitmaps being closed
    if (bitmap) texture.onUpdate = () => { texture.onUpdate = null; for (const m of mips) m.close?.(); texture.mipmaps = []; texture.image = { width: meta.levels[0].w, height: meta.levels[0].h }; };
    return { meta, texture, name };
  })();
  atlasCache.set(name, p); return p;
}
// Warm the cache for a whole roster in ONE parallel batch. battle.addUnit() awaits its unit's atlas before
// the caller can create the next unit, so a boot that places N units pays N SERIAL round trips: measured at
// 1,298 ms of chain for 250 ms of network over 10 sheets, and the roster grows with every class ported.
// loadAtlas memoises the PROMISE, not the result, so a call here and the addUnit call later share one fetch:
// the placement loop still runs in roster order and still awaits, it just resolves from a warm cache. A sheet
// that fails is swallowed HERE only so one bad name cannot cancel the batch — addUnit still awaits the same
// rejected promise and still throws exactly where it does today.
export function preloadAtlases(names) {
  return Promise.all([...new Set(names)].map((n) => loadAtlas(n).catch(() => null)));
}

// --- material: MeshBasicMaterial (unlit, like the genre) + frame rect uniform + pixel-art AA sampling + white hit flash ---
const FRAG_SAMPLE = /* glsl */`
  vec2 fuv = uFrame.xy + vMapUv * uFrame.zw;
  vec2 pix = fuv * uTexSize;
  vec2 seam = floor(pix + 0.5);
  vec2 dudv = max(fwidth(pix), vec2(1e-4));
  vec2 uvAA = (seam + clamp((pix - seam) / dudv, -0.5, 0.5)) / uTexSize;
  vec2 lo = (uFrame.xy * uTexSize + 0.5) / uTexSize, hi = ((uFrame.xy + uFrame.zw) * uTexSize - 0.5) / uTexSize;
  vec2 ddx = dFdx(fuv), ddy = dFdy(fuv);
  uvAA = clamp(uvAA, lo, hi);
  vec4 sampledDiffuseColor = textureGrad(map, uvAA, ddx, ddy);
  float tppT = max(dudv.x, dudv.y);           // TRUE atlas texels per screen pixel (radii / texel floors)
  // R7: atlases are packed at 96 ppu (was 46). Every zoom GATE below (rim fade, interior band, lift ramp) was
  // measured at 46 ppu, so the gates read the legacy-equivalent density; the sampling RADII use the true one.
  float tpp = tppT * uTpScale;
  float rimHit = 0.0;
  // --- screen-space two-ply edge: inner near-black INK + outer TEAM ply -----------------------------------------
  // Inner ply = the genre outline drawn in SCREEN pixels, so the baked ink (which halves with every mip) never
  // drops below a pixel and the silhouette keeps its edge at 'wide'. Outer ply = the team colour: the round-5
  // mandate is that a stranger sorts friend from foe at a glance, and until now the field marking existed only
  // on OCCLUDED units (the ghost silhouette) -- a clear unit had no mark at all. Drawing both plies here means
  // every unit carries the identical marking clear or occluded, at every zoom.
  // uRimW = (tpp gate, inner ink px, INTERIOR team band px, outer team px). setTeam() arms it; 99 keeps it off.
  // Widths are screen-constant (radius = px * tpp atlas texels), floored at ~1 texel so a sub-texel radius
  // cannot smear through bilinear at 'close'.
  // R6: THREE changes vs round 5. (1) The team ply now also paints the ~1 px of BODY just inside the silhouette
  // (the uRimW.z branch below): two units measured ZERO team-rim pixels in the critic's 3 px boundary band with
  // an exterior-only ply — body-side pixels are guaranteed rasterised, so rim dominance can no longer fall to 0
  // for any sheet. (2) The exterior team ply is THINNER (1.55 -> 1.05 px, floor 1.5 -> 0.65 texel), TEAM_RIM is
  // desaturated, and the ply blends halfway to ink WHERE THE ART IS MAGNIFIED (close), because integration's crop
  // reads called even the desaturated pair a 'thick highly saturated electric-blue debug mask' at close — the
  // grade's cool split-tone re-saturates dark blues there. (3) The ink ply keeps its place so the outline still
  // separates at wide.
  if (sampledDiffuseColor.a < 0.5 && tpp > uRimW.x) {
    vec2 o1 = vec2(max(tppT * uRimW.y, 0.5)) / uTexSize;
    vec2 o2 = vec2(max(tppT * uRimW.w, 0.65)) / uTexSize;
    // Close-weighted team dim: the post-grade split-tone re-saturates dark blues, so even the desaturated
    // TEAM_RIM still read 'electric/debug-mask' at close (c2 crop review). Blend the ply partway to the ink
    // where art is magnified and run it pure from mid outward. Floor 0.70: at 0.45 the Wyrm's close rim fell
    // under the dominance probe's hue threshold (c8: auto_close/Wyrm rim=0) and my own 2-second test called
    // the dimmed ply 'too dark, blends into the ground' — the thickness cut (0.65/0.85 px) carries the
    // 'thick borders' complaint, not the hue.
    // R7: at 'close' the art is MAGNIFIED ~2.2x (a 50-texel knight at ~110 px, tpp ~0.45), and the alternating
    // ink/azure stair-steps of the two plies read as a jaggy debug outline (crop: shots/visual/r7/crops/
    // units_fire_close.png). A unit that big needs no team badge -- the genre marks none -- so the ply fades fully to
    // ink below tpp ~0.55 and is full team colour from ~0.95 (mid/wide, where the figure is small).
    vec3 teamCol = mix(uRim, uRim2, smoothstep(0.52, 0.95, tpp));
    float n1 = 0.0, n2 = 0.0;
    for (int i = 0; i < 8; i++) {
      vec2 d = i == 0 ? vec2(1.0, 0.0) : i == 1 ? vec2(-1.0, 0.0) : i == 2 ? vec2(0.0, 1.0)
             : i == 3 ? vec2(0.0, -1.0) : i == 4 ? vec2(0.72, 0.72) : i == 5 ? vec2(-0.72, -0.72)
             : i == 6 ? vec2(-0.72, 0.72) : vec2(0.72, -0.72);
      n1 = max(n1, textureGrad(map, clamp(uvAA + d * o1, lo, hi), ddx, ddy).a);
      if (uRimW.w > 0.0) n2 = max(n2, textureGrad(map, clamp(uvAA + d * o2, lo, hi), ddx, ddy).a);
    }
    if (n1 > 0.30) { sampledDiffuseColor = vec4(uRim, 1.0); rimHit = 1.0; }
    else if (uRimW.w > 0.0 && n2 > 0.30) { sampledDiffuseColor = vec4(teamCol, 1.0); rimHit = 1.0; }
  } else if (sampledDiffuseColor.a >= 0.5 && uRimW.z > 0.0 && tpp > max(uRimW.x, 0.62)) {   // R7: no body-side band when magnified
    // Interior team band: an opaque body pixel whose neighbourhood reaches OUTSIDE the silhouette within
    // uRimW.z screen px. Body pixels always rasterise, so this branch cannot silently vanish the way an
    // exterior-only ply can (round-6 finding: Ysolde and Ludovic measured zero team-rim pixels in all four frames).
    // Floor 0.8 texel, not 0.65: at magnification the outward tap lands BETWEEN texel centres, and at 0.65 the
    // bilinear still returns alpha ~0.35 (>= the 0.30 gate) so the band silently died at close (c3: skeleton rim 0).
    // 0.8 lands at alpha ~0.20 -> fires, and stays inside the outermost body texel so the band is exactly one
    // texel wide at every zoom.
    vec2 o0 = vec2(max(tppT * uRimW.z, 0.8)) / uTexSize;
    float mn = 1.0;
    for (int i = 0; i < 4; i++) {
      vec2 d = i == 0 ? vec2(1.0, 0.0) : i == 1 ? vec2(-1.0, 0.0) : i == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
      mn = min(mn, textureGrad(map, clamp(uvAA + d * o0, lo, hi), ddx, ddy).a);
    }
    if (mn < 0.30) { sampledDiffuseColor = vec4(mix(uRim, uRim2, smoothstep(0.52, 0.95, tpp)), 1.0); rimHit = 1.0; }
  }
  diffuseColor *= sampledDiffuseColor;
  // the genre draws its units at full paint brightness while the map is shaded, so the cast always sits on top of the
  // diorama (a reference capture puts its cast 18.3 luma above the ground). Our sprites are unlit (correct) but the scene
  // grade still crushes them into the cobble, so lift gain and saturation.
  // The lift RAMPS WITH tpp (CRITIQUE_R2 regression 9): at 'close' the art is at or above native resolution, so the
  // lift runs at its floor there and only reaches full strength where the sprite is genuinely small and the
  // silhouette needs the help. uLift.x is 1.0, so the gamma lift itself can never manufacture a blown pixel.
  {
    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
    // The ramp measured, not asserted: a human is ~0.86 tpp at 'close', ~1.5 at 'mid', ~3.6 at 'wide', so round 3's
    // smoothstep(0.45, 1.05) was pinned at ~1.0 in ALL THREE presets -- the "lift only under minification" comment
    // was false and the full lift ran at close, which is what clipped the knight's helmet (CRITIQUE_R2 regression 9).
    float ramp = mix(uLift.w, 1.0, smoothstep(uLiftT.x, uLiftT.y, tpp));
    vec3 c = diffuseColor.rgb;
    float l = dot(c, LUMA);
    float notInk = smoothstep(0.012, 0.055, l) * (1.0 - rimHit); // the ink (authored or screen-space) stays ink
    // a GAMMA lift, not a gain: pow(x, g) with g < 1 raises shadows and midtones hard and leaves 1.0 AT 1.0, so with
    // uLift.x == 1.0 the lift can never add a clipped pixel -- the helmet dome keeps its grey steps.
    vec3 lifted = min(pow(max(c, vec3(0.0)), vec3(uLift.z)) * uLift.x, vec3(1.0));
    c = mix(c, lifted, ramp * notInk);
    // Saturation is the other half of the genre read (a reference capture/_03: the cast is the most saturated thing on the map),
    // but a naive chroma boost is what actually CLIPPED our units -- it drives the strongest channel past 1.0 and the
    // hardware clamp then flattens the highlight. So roll the chroma back just far enough that the brightest channel
    // lands exactly on 1.0: hue and luminance are preserved and the boost can never add a blown pixel.
    vec3 sat = mix(vec3(dot(c, LUMA)), c, mix(1.0, uLift.y, ramp));
    float mx = max(max(sat.r, sat.g), sat.b);
    if (mx > 1.0) { float lm = dot(sat, LUMA); sat = mix(vec3(lm), sat, clamp((1.0 - lm) / max(mx - lm, 1e-4), 0.0, 1.0)); }
    diffuseColor.rgb = sat;
  }
`;
// A billboard is a vertical plane, so at a 30 deg pitch its head is ~0.85 world units FARTHER from the camera than
// its feet: per-pixel depth then puts one half of a unit in front of a wall and the other half behind it
// (CRITIQUE_R2 rank 8 / integration 7). The camera is orthographic, so NDC x/y do not depend on view z at all and the
// whole card can simply be depth-tested at its own ground point, biased a tenth of a tile toward the lens so it wins
// against the tile it is standing on without leaping in front of a wall it is genuinely behind.
// R6 (integration: 'character x573-650 simultaneously in front of and behind the same roof'): the SAME constant
// view-z is now also written to gl_FragDepth from the fragment stage. Vertex-interpolated clip z is mathematically
// constant across the card (orthographic w = 1), so the value does not change — but writing it per fragment makes
// the guarantee hold at the RASTER stage itself: no interpolation, no fixed-function depth tricks and no future
// pipeline pass can re-introduce a per-pixel gradient inside the card. `?flat=off` disables the whole flatten
// (vertex + fragment) as an A/B for the capture harness.
const FLAT_ON = typeof location !== 'undefined' && new URLSearchParams(location.search).get('flat') !== 'off';
const VERT_FLATTEN = /* glsl */`
  #include <project_vertex>
  {
    vec4 gv = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec4 fc = projectionMatrix * vec4(mvPosition.xy, gv.z + uGroundBias, mvPosition.w);
    vFlatZ = fc.z / max(fc.w, 1e-6);
    gl_Position = fc;
  }
`;
const VERT_PLAIN = /* glsl */`
  #include <project_vertex>
  {
    vec4 gv = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vFlatZ = (projectionMatrix * vec4(mvPosition.xy, gv.z + uGroundBias, mvPosition.w)).z;
  }
`;
const FRAG_FLATDEPTH = 'gl_FragDepth = vFlatZ * 0.5 + 0.5;';   // NDC z -> WINDOW depth [0,1]: gl_FragDepth takes
                                                                // window-space depth, and writing raw NDC made
                                                                // every card compare ~2x nearer than the terrain's
                                                                // rasterized (ndc*0.5+0.5) values — sprites pasted
                                                                // over facades and ghosts false-firing in the clear
                                                                // (R6Integration final sweep, findings 1-3).
function makeMaterial(texture, tpScale = 1) {
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: false, alphaTest: 0.5, side: THREE.DoubleSide, depthWrite: true });
  // uRim / uRim2 are LINEAR (the atlas is an sRGB texture, so `map` samples come back linear too):
  // inner ply ~sRGB #16171f ink, outer ply ~sRGB #363a44 half-ink.
  const u = {
    uFrame: { value: new THREE.Vector4(0, 0, 1, 1) }, uFlash: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) },
    uRim: { value: new THREE.Vector3(0.0075, 0.0080, 0.0125) }, uRim2: { value: new THREE.Vector3(0.0330, 0.0360, 0.0480) },
    // uRimW = (tpp gate, inner ink px, interior team px, outer team px); 99 on the gate keeps the edge OFF until
    // setTeam() arms it (a unit with no team gets no marking).
    uRimW: { value: new THREE.Vector4(99.0, 0.50, 0.0, 0.85) },
    // Round 5, SECOND pass — full rollback of this morning's lift bump. probe2 measured the lit-side cast at
    // on-screen med 206-221 (reference band ceiling: 184) and the map critics independently called the bodies
    // 'blown white / clipped-looking, little internal detail' on every r6/r2 preset. The premise for the bump
    // (the dark-side units needed more lift) was WRONG: the dark side's real problem was the occlusion-ghost
    // wash over cluster neighbours (fixed by render order, worth +27..+70 sep on its own, probe2 vs probe1),
    // not the grade. Back to the r4-proven constants; the wash fix and the pack-time conditioning now carry
    // the separation load.
    // Round 6 measured lift ramp: the mid preset sits at tpp ~0.84, BELOW uLiftT.x, so the ramp pinned to the
    // 0.60 floor there and every auto_mid unit measured sprMed 67-78 against the 78 bar (wide at ramp ~0.90
    // passed 78.7-91.6). Raising the floor to 0.86 was solved from the measured display-vs-scene slope of the
    // c3 table (~89 display units per scene-linear unit): mid +9..+12, close +8, wide +2..4 — with the highest
    // measured unit (melee_rot1 Aldric 114.8) still 70 under the 184 ceiling, so nothing can clip.
    uLift: { value: new THREE.Vector4(1.00, 1.20, 0.72, 0.86) }, uLiftT: { value: new THREE.Vector2(0.90, 1.50) },
    uGroundBias: { value: 0.10 },
    uTexSize: { value: new THREE.Vector2(...(texture.userData.size || [texture.image.width, texture.image.height])) },
    uTpScale: { value: tpScale },
  };
  mat.userData.u = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uGroundBias; varying float vFlatZ;')
      .replace('#include <project_vertex>', FLAT_ON ? VERT_FLATTEN : VERT_PLAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFlatZ; uniform vec4 uFrame; uniform float uFlash; uniform vec3 uTint; uniform vec3 uRim; uniform vec3 uRim2; uniform vec4 uRimW; uniform vec4 uLift; uniform vec2 uLiftT; uniform vec2 uTexSize; uniform float uTpScale;')
      .replace('#include <map_fragment>', FRAG_SAMPLE)
      .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n' + (FLAT_ON ? FRAG_FLATDEPTH + '\n' : '') + ' diffuseColor.rgb = mix(diffuseColor.rgb * uTint, vec3(1.0), uFlash);');
  };
  mat.customProgramCacheKey = () => 'unit-sprite-v22' + (FLAT_ON ? 'f' : '');
  return mat;
}

// --- occlusion silhouette ("ghost") ----------------------------------------------------------------------------
// A unit standing behind a house, a tower, a parapet or a cliff shoulder is simply GONE on this map: the props are
// opaque, the camera turns only in fixed yaw stops and the player cannot dolly around a roof. Every tactics game
// that ships a 3-D board solves this the same way -- XCOM, Fire Emblem: Three Houses, classic tactics Reborn all punch a
// flat team-coloured shape through the obstruction -- so the piece stays findable without making the obstruction
// transparent (which would break the diorama read this project is built on).
// The shape is a SECOND mesh on the same geometry and the same `uFrame` UNIFORM OBJECT as the sprite, so it tracks
// the atlas animation for free with no per-frame copy to go stale; setFrame() mirrors its scale/position so the
// silhouette cannot drift off the body.
// The "am I occluded?" test is the depth buffer, not a raycast: the ghost renders with depthFunc GreaterDepth and
// depthWrite off, i.e. only where something already in the buffer is NEARER than the unit. Both meshes run the same
// VERT_FLATTEN with the same uGroundBias uniform, so the ghost's depth is bit-identical to the sprite's -- where the
// sprite drew, the test is EQUAL, not greater, and the ghost is discarded. An unoccluded unit therefore costs zero
// pixels, with no CPU visibility query anywhere.
// Colours are not a hue pair: red/green colour blindness leaves blue-vs-red readable, but protanopia darkens red
// hard, so the two also differ in VALUE (azure sits at ~2x the relative luminance of the enemy red) and the rim ply
// gives each one a bright edge that survives on a busy thatch roof.
// Authored DARKER and LESS saturated than they render: the ghost is toneMapped:false and the post grade lifts
// it, so #5bc8ff/#ff3b2a measured (0,220,255)/(255,6,7) on screen -- near-primary, and it read as a debug
// overlay rather than part of the board. These pre-compensate. The VALUE gap survives (azure ~2x the enemy
// red's relative luminance), which is what keeps the pair readable under protanopia.
// Round 5 FINAL: Map's r11 critics still read the fill as a 'giant opaque royal-blue billboard' even at alpha
// 0.16, because the grade's shadow-side split-tone is exactly where these silhouettes live (dark roofs) and it
// pushes every dark pixel blue: authored (85,115,150) rendered (33,93,170) there. The crop reviewer prescribed
// the fix: 'keep the silhouettes, let the building show through, restrained TEAM-COLOUR OUTLINE'. So the FILL
// goes neutral warm-grey (both teams, value-leaning A lighter for the protanopia gap) and ALL team hue moves
// to the rims — the field edge already carries TEAM_RIM and the ghost rim below stays team-tinted.
export const TEAM_SILHOUETTE = { A: 0x6e665f, B: 0x5e5651 };
// R6: pre-compensation for the grade. Integration's close-ply complaint ('electric-blue debug mask') is handled
// by the close-weighted ink-mix dim in FRAG_SAMPLE (tpp ramp), NOT by dulling the hue everywhere: the first R6
// desaturation (0x3f6db0/0xab4b33) measured fine in rim COUNTS but my own 2-second test then failed Malquor,
// Ludovic and Bone Walker for 'team outline too dark, blends into the ground at wide' — where the dim ramp is
// off and the ply must carry separation alone. Full-strength pair restored; close stays quiet via the ramp.
export const TEAM_RIM = { A: 0x4787c9, B: 0xc0452f };
// ---- OPTIONS hook (options/accessibility owner): colour-blind team palettes. TEAM_RIM follows Display > Team Colours
// (src/ui/prefs.js; its 'default' entry is exactly the pair above), and live units re-arm their rims and ghosts. ----
{ const apply = () => { const p = palette(); TEAM_RIM.A = p.teamA; TEAM_RIM.B = p.teamB; };
  apply(); onPrefs(() => { apply(); for (const s of globalThis.window?.__GAME__?.battle?.sprites?.values?.() || []) if (s.team) s.setTeam(s.team); }); }
const RIM_MIX = 0.25;                // how far the ghost edge ply is pulled toward white: at 0.32 the crop
                                     // review still called it 'white outline symbols'; 0.25 keeps the ply
                                     // recognisably TEAM-coloured, which now carries the whole team read for
                                     // occluded units (the fill is neutral since the final round-5 pass).
// R12 (units12, every blind critic: 'big dithered team-colour silhouette of the Wyrm with a thin rim reads as a
// debug overlay and dominates the frame'): the ghost is now QUIET BUT FINDABLE --
//   * a 1-px team-colour RIM at partial alpha is the whole signal; the fill is a faint alpha wash, not a
//     dither (no stipple anywhere on screen);
//   * rim and fill are one mesh / one draw (the fill is too faint for the old rim-under-fill ordering to matter);
//   * strength (alpha) comes from src/units/occlusion.js: 0 (mesh invisible, no draw) unless 30 %+ of the body
//     is hidden, ramping to full at 60 %, and non-focus units run at ~60 % of a focus unit's strength;
//   * big bodies ghost only their upper part (head and shoulders) with a soft bottom edge, so a monster behind a
//     roof can never paint a wing-span-sized shape over the board.
const RIM_PX = 1.0;                  // edge ply width in SCREEN pixels
const RIM_ALPHA = 0.78;              // rim alpha at full strength
const FILL_ALPHA = 0.10;             // fill wash alpha at full strength
const GHOST_FILL_K = 0.70;           // fill = TEAM_RIM x this (linear)
// Depth margin, in view units, added ON TOP of the sprite's own ground bias -- i.e. how much nearer than the unit an
// occluder has to be before it counts as "in the way". The failure it exists for is the ADJACENT-TILE TERRACE LIP:
// with no margin, a ninja standing in the clear threw a detached red flag (his trailing scarf) and a red blob (his
// back foot) onto the step in front of him, because that step's near edge is a few tenths of a unit nearer than his
// own ground point. Swept at 0 / 0.5 / 0.85 / 1.3 / 2.0 against that exact frame and against a knight behind a house
// roof (shots/units/ghost/sheet_lip.png, sheet_house.png): the lip noise is gone at 1.3 and the house silhouette is
// pixel-for-pixel the same at every value, because a house puts the unit 2+ diagonal tiles back.
// Scale check: one diagonal tile of ground is 1.414*cos(pitch) view units -- 1.22 at pitch 30, 0.95 at pitch 48 --
// so 1.30 reads as "the obstruction has to be about a tile in front of you". The cost is the honest one: a
// shoulder-height parapet on the very next tile is below the margin and gets no silhouette. It also barely hides a
// unit, which is why this is the right side of the trade.
const GHOST_PUSH = 1.30;
// Same flatten as the sprite plus that margin. It also keeps the "unit is visible => ghost is culled" guarantee: the
// ghost is now strictly NEARER than the sprite, so wherever the sprite wrote depth the GreaterDepth test still fails.
const VERT_GHOST = /* glsl */`
  #include <project_vertex>
  {
    vec4 gv = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec4 fc = projectionMatrix * vec4(mvPosition.xy, gv.z + uGroundBias + uGhostPush, mvPosition.w);
    vFlatZ = fc.z / max(fc.w, 1e-6);
    gl_Position = fc;
  }
`;
const VERT_GHOST_PLAIN = /* glsl */`
  #include <project_vertex>
  {
    vec4 gv = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vFlatZ = (projectionMatrix * vec4(mvPosition.xy, gv.z + uGroundBias + uGhostPush, mvPosition.w)).z;
  }
`;
const FRAG_GHOST = /* glsl */`
  // R7 ('busy scribble' review): ONE closed shape per unit -- the art alpha is dilated by ~1.3 screen px so the
  // gaps inside a silhouette seal and only the outer contour survives (a clean cut-out, like a shadow puppet).
  // R12: the opaque ordered-dither fill is gone (it was the 'debug overlay' every critic named); what is drawn is
  // a 1 px rim just OUTSIDE the closed mask plus a faint alpha wash inside it, both scaled by uGhostA.
  vec2 fuv = uFrame.xy + vMapUv * uFrame.zw;
  vec2 pix = fuv * uTexSize;
  vec2 seam = floor(pix + 0.5);
  vec2 dudv = max(fwidth(pix), vec2(1e-4));
  vec2 uvAA = (seam + clamp((pix - seam) / dudv, -0.5, 0.5)) / uTexSize;
  vec2 lo = (uFrame.xy * uTexSize + 0.5) / uTexSize, hi = ((uFrame.xy + uFrame.zw) * uTexSize - 0.5) / uTexSize;
  vec2 ddx = dFdx(fuv), ddy = dFdy(fuv);
  uvAA = clamp(uvAA, lo, hi);
  float tpp = max(dudv.x, dudv.y);
  float a = textureGrad(map, uvAA, ddx, ddy).a;
  vec2 o1 = vec2(max(tpp * 1.3, 0.9)) / uTexSize;                  // closing radius (fill)
  vec2 o2 = vec2(max(tpp * (1.3 + uGhostRim.w), 1.6)) / uTexSize;  // rim outer radius
  float m1 = a, m2 = a;
  for (int i = 0; i < 8; i++) {
    vec2 d = i == 0 ? vec2(1.0, 0.0) : i == 1 ? vec2(-1.0, 0.0) : i == 2 ? vec2(0.0, 1.0)
           : i == 3 ? vec2(0.0, -1.0) : i == 4 ? vec2(0.71, 0.71) : i == 5 ? vec2(-0.71, -0.71)
           : i == 6 ? vec2(-0.71, 0.71) : vec2(0.71, -0.71);
    m1 = max(m1, textureGrad(map, clamp(uvAA + d * o1, lo, hi), ddx, ddy).a);
    m2 = max(m2, textureGrad(map, clamp(uvAA + d * o2, lo, hi), ddx, ddy).a);
  }
  bool inFill = m1 > 0.35;
  bool onRim = !inFill && m2 > 0.35;
  // R12: one pass, alpha-blended: rim at RIM_ALPHA, a faint fill wash, both scaled by the occlusion strength;
  // below uGhostClip.x (card-local v) the ghost fades out over uGhostClip.y (head-and-shoulders cap).
  float on = onRim ? ${RIM_ALPHA.toFixed(3)} : (inFill ? ${FILL_ALPHA.toFixed(3)} : 0.0);
  on *= uGhostA * smoothstep(uGhostClip.x - uGhostClip.y, uGhostClip.x, vMapUv.y);
  diffuseColor = vec4(onRim ? uGhostRim.rgb : uGhost, on);
`;
// The ghost shares uFrame / uTexSize / uGroundBias with the sprite material by REFERENCE (Object.assign copies the
// uniform objects, not their values), which is what keeps the two in lockstep with no update() work.
function makeGhostMaterial(texture, shared) {
  // ROUND-5 FIX (the 'opaque red mass over the struck unit', vfx critics + shots/units/_probe.py interiors):
  // the ghost used to render in the TRANSPARENT pass, i.e. AFTER every unit sprite had written depth. In a
  // cluster the nearer unit's body stores depth, the farther unit's ghost passes GreaterDepth against it, and
  // the team fill painted straight over the neighbour's art -- measured at 50-90 % team-red covering enemy
  // interiors in scenario=auto and covering the melee victim at impact. Depth alone can never tell a roof
  // from a body, and the scene target has no stencil buffer (pipeline.js stencilBuffer:false, other owner).
  // The fix is render ORDER: transparent:false puts the ghost in the OPAQUE pass at renderOrder 5, strictly
  // between the world (terrain/props, renderOrder 0, already depth-resolved) and the unit sprites
  // (renderOrder 10, not yet drawn). The GreaterDepth test therefore runs against a UNIT-FREE depth buffer:
  // walls/roofs still trigger the silhouette, another unit's body can no longer trigger it, and any ghost
  // painted where a visible unit stands is simply drawn over by that unit a moment later in the same pass.
  // Blending still works because the world has already been drawn when the ghost blends over it, and
  // depthWrite stays off so the sprites and the depth texture are unaffected.
  const mat = new THREE.MeshBasicMaterial({
    map: texture, transparent: false, side: THREE.DoubleSide,
    depthTest: true, depthFunc: THREE.GreaterDepth, depthWrite: false, toneMapped: false,
    // R7: CustomBlending, not NormalBlending — three.js silently swaps NormalBlending to NoBlending on any
    // transparent:false material, which drew every ghost as an opaque full-quad card. alphaTest discards the
    // empty part of the frame.
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    alphaTest: 0.004,
  });
  const u = {
    uGhost: { value: new THREE.Color(TEAM_SILHOUETTE.A) },
    uGhostRim: { value: new THREE.Vector4(1, 1, 1, RIM_PX) },
    uGhostA: { value: 0 },                                  // strength, written by occlusion.js
    uGhostClip: { value: new THREE.Vector2(-1, 0.05) },      // card-local v below which the ghost fades out
    uGhostPush: { value: GHOST_PUSH },
  };
  mat.userData.u = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uGroundBias; uniform float uGhostPush; varying float vFlatZ;')
      .replace('#include <project_vertex>', FLAT_ON ? VERT_GHOST : VERT_GHOST_PLAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFlatZ; uniform vec4 uFrame; uniform vec2 uTexSize; uniform vec3 uGhost; uniform vec4 uGhostRim; uniform float uGhostA; uniform vec2 uGhostClip; uniform float uTpScale;')
      .replace('#include <map_fragment>', FRAG_GHOST)
      .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n' + (FLAT_ON ? FRAG_FLATDEPTH : ''));
  };
  mat.customProgramCacheKey = () => 'unit-ghost-v10' + (FLAT_ON ? 'f' : '');
  return mat;
}

// --- contact shadow ------------------------------------------------------------------------------------------
// the genre draws a small, dark, hard-cored ellipse right under the feet (a reference capture, _54, _55) and it is the single
// thing that plants a billboard on a diorama. Round 2 drew it as an ADDITIVE-ALPHA dark quad that the overlay's
// active-tile plate then painted over, so it darkened the deck by 0.66 where the genre sits at 0.39-0.51.
// It is now a MULTIPLY: the texture carries the multiplier itself (dark core -> white rim), so the shadow cannot be
// out-valued by whatever is drawn under it and it darkens texture instead of replacing it.
let shadowTex = null;
// R6: the shadow read 'not visible at wide / 50-85 px off the figure' (integration). Two real causes measured
// with the noshadow A/B probe (shots/units/r6/c1: wide ratio 0.84-0.96 = 4-16 % darkening, close 0.49):
// (a) CanvasTexture mips averaged the 0.05 core out to near-white at minification, and (b) the blob was capped
// at r 0.52 world units, i.e. ~6 px at wide — smaller than one mip footgun away from vanishing. The texture now
// renders mip-free with linear filtering (the quad is screen-space small; a crisp core beats a blurry one) and
// the radius floor/ceiling both come up. SHADOW_TINT now runs near-neutral (0.96): the grade's cool split-tone
// supplies the shade's blue itself, and the integration target is rgb(0.40, 0.40, 0.46) ON SCREEN, not authored.
const SHADOW_CORE = 0.036;          // multiply factor at the core. c3 measured on-screen R ~0.36 at 0.035 (target
                                    // 0.40); the 0.045 round made the 2-second test read 'contact shadow missing/
                                    // indistinct' on robed units, so core goes back down and the FLOOR below buys
                                    // the coverage instead
const SHADOW_TINT = 0.96;           // blue lift: c3 measured on-screen (R,G,B)=(0.36,0.43,0.69) with the old 1.31
                                    // authored tint — the grade's cool split-tone ALREADY pushes shade blue ~1.4x,
                                    // so authoring another 1.3x doubled it to 0.69 against the 0.46 target. Near-
                                    // neutral authored + grade's own cool = lands (0.40,~0.44,~0.48).
function getShadowTex() {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const v = Math.round(SHADOW_CORE * 255), vb = Math.min(255, Math.round(SHADOW_CORE * SHADOW_TINT * 255));
  const m = Math.round(255 - (255 - v) * 0.42), mb = Math.round(255 - (255 - vb) * 0.42);
  const grd = g.createRadialGradient(32, 32, 1, 32, 32, 32);
  grd.addColorStop(0, `rgb(${v},${v},${vb})`); grd.addColorStop(0.88, `rgb(${v},${v},${vb})`);
  grd.addColorStop(0.95, `rgb(${m},${m},${mb})`); grd.addColorStop(1, 'rgb(255,255,255)');
  g.fillStyle = 'rgb(255,255,255)'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  shadowTex = new THREE.CanvasTexture(c); shadowTex.colorSpace = THREE.NoColorSpace;
  shadowTex.generateMipmaps = false; shadowTex.minFilter = THREE.LinearFilter; shadowTex.magFilter = THREE.LinearFilter;
  return shadowTex;
}
function makeShadowMaterial() {
  const m = new THREE.MeshBasicMaterial({
    map: getShadowTex(), transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
  });
  const u = { uFade: { value: 1 } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFade;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = mix(vec3(1.0), diffuseColor.rgb, uFade);');
  };
  m.customProgramCacheKey = () => 'unit-shadow-v1';
  return m;
}

const clamp = THREE.MathUtils.clamp;
const easeOutC = (k) => 1 - Math.pow(1 - k, 3);
// Global kill switch for occlusion silhouettes (?ghost=off, or a cinematic that wants the clean diorama).
let SILHOUETTES = typeof location !== 'undefined' && new URLSearchParams(location.search).get('ghost') === 'off' ? false : true;
export function setSilhouettesEnabled(on) { SILHOUETTES = !!on; }
export function silhouettesEnabled() { return SILHOUETTES; }
// Facing: 0=+z, 1=+x, 2=-z, 3=-x (rules.facingFrom). The camera yaw decides which row is shown and whether to mirror.
// R18 (review17 P2, gameplay): stacked-sprite stagger. Two units a tile apart along the camera's view line (the
// diagonal neighbour at two of the four stops, or the tile straight behind) project onto the same screen column and
// read as one body with two heads. Every live sprite is kept here; ~30 times a second the set is solved in screen
// space (x along screen-right, depth along the view ray) and each body in an overlapping pair is eased up to
// STAGGER_MAX tiles sideways, away from its partner -- a few pixels at the default zoom, the ±6 px review17 asked
// for. Walking, KO'd and hidden bodies are left alone, and the offset is visual only (root stays on the tile).
const STAGGER = new Set(); const STAGGER_MAX = 0.14 * TILE, STAGGER_W = 0.5 * TILE, STAGGER_D = 2.2 * TILE; let staggerAt = -1e9;
const _sr = new THREE.Vector3();
function solveStagger(camYaw, nowMs) {
  if (nowMs - staggerAt < 33) return; staggerAt = nowMs;
  const c = Math.cos(camYaw), sn = Math.sin(camYaw); const L = [];
  for (const s of STAGGER) { s.stagT = 0; if (!s.root.visible || !s.root.parent || s.walk || s.ko) continue; const p = s.root.position; L.push({ s, x: p.x * c - p.z * sn, d: p.x * sn + p.z * c, y: p.y, w: s.bodyW || 0.7, cap: STAGGER_MAX }); }
  // R19 (anim19 blind critics, twice: 'the ninja stands directly above the wyrm and reads as riding its head'): the
  // overlap test and the push both scale with the pair's BODY widths. Two humans keep the R18 numbers exactly
  // (0.5-tile window, 0.14 cap); a human on a wyrm's view line gets a wider window and up to twice the push, most of
  // it applied to the SMALL body (the big one barely moves -- a monster sliding sideways reads as a glitch).
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    const a = L[i], b = L[j]; const dx = b.x - a.x; const big = Math.max(a.w, b.w) / 0.85;
    const W = STAGGER_W * Math.max(1, (a.w + b.w) / 1.7);
    if (Math.abs(dx) >= W || Math.abs(b.d - a.d) > STAGGER_D * Math.max(1, big * 0.8) || Math.abs(b.d - a.d) < 0.3 * TILE) continue;
    const cap = STAGGER_MAX * Math.min(2, Math.max(1, big)); const push = Math.min(cap, (W - Math.abs(dx)) * 0.5); const dir = dx !== 0 ? Math.sign(dx) : (a.d > b.d ? 1 : -1);
    const ka = big > 1.15 ? 2 * b.w / (a.w + b.w) : 1, kb = big > 1.15 ? 2 * a.w / (a.w + b.w) : 1;   // the smaller body takes more of it
    a.s.stagT -= push * dir * ka; b.s.stagT += push * dir * kb;
    if (big > 1.15) { a.cap = Math.max(a.cap, cap * ka); b.cap = Math.max(b.cap, cap * kb); }
  }
  for (const o of L) o.s.stagT = Math.max(-o.cap, Math.min(o.cap, o.s.stagT));
}

export class UnitSprite {
  constructor(atlas, opts = {}) {
    this.atlas = atlas; const { meta, texture } = atlas; this.meta = meta;
    this.heightUnits = opts.height || meta.unitH || SPRITE_H;
    // world units per level-0 texel. The height budget is the intent; the SILHOUETTE-MASS budget is the guarantee —
    // no unit's body may be wider than one tile, or two units on adjacent tiles interpenetrate (CRITIQUE_R2 rank 8).
    // The packer already enforces this; the second term keeps a roster `height` override from undoing it.
    // The packer already sized this sheet against ITS OWN class budget (tools/pack_sprites.py `sil_cap`), so the
    // engine clamp exists only to stop a roster `height` override from re-inflating the mass past that budget.
    // It must use the sheet's own budget, NOT a global tile budget: a global 1.0-tile clamp here would shrink a
    // 1.8-tile wyrm back to human size and undo the packer's scale hierarchy.
    const silTex = meta.silW || meta.coreW || meta.bodyW;
    const silBudget = meta.silBudget || TILE;
    this.k = Math.min(this.heightUnits / meta.refH, silBudget / silTex);
    const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0); // pivot at the feet
    this.material = makeMaterial(texture, (meta.ppuLegacy || meta.ppu || 46) / (meta.ppu || 46)); this.u = this.material.userData.u;
    this.mesh = new THREE.Mesh(geo, this.material); this.mesh.castShadow = false; this.mesh.receiveShadow = false; this.mesh.frustumCulled = false; this.mesh.renderOrder = 10;
    // Ghost: same geometry, same pivot, so it inherits every lean / squash / bob the sprite gets, and it never
    // reaches the shadow map (castShadow false). It renders in the OPAQUE pass at renderOrder 5 -- strictly
    // after the world (0..4), before the sprites (10) -- so its GreaterDepth test sees unit-free depth; the
    // long note in makeGhostMaterial explains why that is what stops a cluster from washing itself in team fill.
    this.ghostMaterial = makeGhostMaterial(texture, this.u); this.gu = this.ghostMaterial.userData.u;
    this.ghost = new THREE.Mesh(geo, this.ghostMaterial);
    this.ghost.castShadow = false; this.ghost.receiveShadow = false; this.ghost.frustumCulled = false;
    // Opaque pass, after the world (0) and before the sprites (10) -- see makeGhostMaterial.
    // R12: one ghost mesh (rim + faint fill in one pass), invisible -- no draw -- unless occlusion.js finds the
    // unit meaningfully hidden. The old second 'ghostRim' mesh is gone.
    this.ghost.renderOrder = 5; this.ghost.visible = false;
    this.ghostOn = false; this.team = null; this.silhouetteAllowed = false;
    this.pivot = new THREE.Group(); this.pivot.add(this.mesh); this.pivot.add(this.ghost);   // lean / squash / bob / KO lie-down
    this.bill = new THREE.Group(); this.bill.add(this.pivot);    // billboard yaw
    this.root = new THREE.Group(); this.root.add(this.bill);     // ground position (tile centre)
    // contact shadow: sized on the CORE width (torso+legs), not the bbox, so a raised sword never widens the shadow.
    // the genre's patch is ~0.45 tiles across (a reference capture/_54); round 2's was ~0.94.
    const cw = (meta.coreW || meta.bodyW) * this.k;
    // Round-5 second pass: 0.34 measured 19% darkening at 'wide' (probe4: shadow 47.7 vs ground 59.2 -- the
    // critics: 'no clearly separated contact shadows'). the genre's patch is small (0.45 tiles) but reads because
    // it is nearly black against grass; ours lost its core to minification. R6: the mip-free core plus a wider
    // cap (0.60) is what carries the wide preset now — measured target: on-screen shadowed/unshadowed ratio
    // ~0.40 red/green, ~0.46 blue at every zoom.
    const r = clamp(cw * 0.46, 0.30, 0.60); this.shadowR = r; this.shadowOpacity = 1; this.bodyW = cw;   // bodyW: R19 stagger
    const sg = new THREE.PlaneGeometry(2, 2); sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, makeShadowMaterial());
    this.shadowU = this.shadow.material.userData.u;
    // R6: polygonOffset -2 lost the depth fight on slightly tilted tile tops, which clipped the FAR half of the
    // blob and pushed the visible centroid 8-12 px toward the camera (c3: Corvina dx -11.5, Wyrm dy +9.2 against
    // the <=8 px bar). -6/-6 wins those surfaces; the z half-extent trims 0.74 -> 0.66 so the visible near-ring
    // sits closer under the feet anchor without shrinking the core the critics asked to keep dark.
    this.shadow.scale.set(r, 1, r * 0.66); this.shadow.position.y = 0.02; this.shadow.renderOrder = 5; this.shadow.frustumCulled = false; this.root.add(this.shadow);
    this.facing = 0; this.pose = 0; this.mirror = false; this.row = 0; this.frame = -1;
    // R11 idle desync: every unit breathes on its own period (±13 %) as well as its own phase, so a line of
    // soldiers never inhales in unison.
    this.idlePeriod = IDLE_PERIOD * (0.87 + Math.random() * 0.26);
    this.off = new THREE.Vector3();   // reaction offset (lunge / recoil / dodge) — anim.js drives it, root stays on the tile
    this.flashUntil = 0; this.flashPeak = 0; this.wounded = false; this.koLeft = null; this.koBeatAt = -1e9; this.crystAt = 0; this.crystSpeed = 1; this.riseAt = 0; this.koSpeed = 1;
    this.t = Math.random() * 10; this.flash = 0; this.hop = 0; this.lean = 0; this.walk = null; this.charging = false; this.ko = false; this.koT = 0; this.koAt = 0; this.squash = 0;
    this.setFrame(0, 0, false);
    this.stag = 0; this.stagT = 0; STAGGER.add(this);
    // R19: motion profile (roster.js motionForSheet) + turn-in-place state. A facing change used to be a one-frame pop;
    // it now plays a quick edge-on squeeze (the body narrows and opens out on the new side), the genre's turn read.
    this.motion = motionForSheet(atlas.name); this.camYaw = 0; this._lastFacing = this.facing; this.turnAt = -1e9;
    registerSprite(this);
  }
  setFrame(row, col, mirror) {
    const { meta } = this; const i = row * meta.cols + col; const f = meta.frames[i]; if (!f) return;
    this.row = row; this.mirror = mirror;
    if (i !== this.frame) { this.frame = i; this.u.uFrame.value.set(f.x / meta.atlasW, 1 - (f.y + f.h) / meta.atlasH, f.w / meta.atlasW, f.h / meta.atlasH); }
    const sgn = mirror ? -1 : 1, k = this.k;
    this.mesh.scale.set(f.w * k * sgn, f.h * k, 1);
    this.mesh.position.set(-(f.ax - f.w / 2) * k * sgn, -f.ay * k, 0);
    // The ghost must take the SAME per-frame anchor/mirror transform or the silhouette slides off the body on any
    // frame whose anchor differs from the idle's (every walk and attack frame does).
    this.ghost.scale.copy(this.mesh.scale); this.ghost.position.copy(this.mesh.position);
  }
  /** Team marking: colour for the occlusion silhouette AND arm the always-on field edge (inner ink + outer
   *  team ply). team: 'A' | 'B' | null (null / unknown disables both). */
  setTeam(team) {
    this.team = team; const hex = TEAM_SILHOUETTE[team];
    this.ghostOn = hex !== undefined;
    if (!this.ghostOn) { this.u.uRimW.value.set(99.0, 0.50, 0.0, 0.85); return; }
    // R7: the dithered fill carries the team HUE (a dimmed TEAM_RIM); half its pixels are the roof, so the
    // checker reads as a tinted glass cut-out, not the old neutral-grey card.
    this.gu.uGhost.value.setHex(TEAM_RIM[team]).multiplyScalar(GHOST_FILL_K);
    // The ghost rim derives from TEAM_RIM, NOT TEAM_SILHOUETTE: the fill went neutral in the final pass and
    // deriving the rim from it silently stripped the team hue off occluded units (Map's r12 critic read the
    // outline as 'muted peach' instead of team azure/rust).
    const rim = new THREE.Color(TEAM_RIM[team]).lerp(new THREE.Color(0xffffff), RIM_MIX);
    this.gu.uGhostRim.value.set(rim.r, rim.g, rim.b, RIM_PX);
    // Field edge: its own punchier team colour (TEAM_RIM) so the thin ply still reads as TEAM at 1x after
    // the grade, while the ghost fill stays on the muted TEAM_SILHOUETTE. Both pre-compensated by hand.
    // z = the R6 interior band (body-side team px); w = the exterior team ply.
    const tc = new THREE.Color(TEAM_RIM[team]);
    this.u.uRim2.value.set(tc.r, tc.g, tc.b);
    this.u.uRimW.value.set(0.45, 0.50, 0.65, 0.85);
  }
  /** Kill switch for the effect on this unit (debug / a mode that wants the clean diorama). */
  setSilhouette(on) { this.ghostOn = !!on && TEAM_SILHOUETTE[this.team] !== undefined; }
  setPose(p) { this.pose = typeof p === 'string' ? POSE[p] : p; }
  setCharging(v) { this.charging = !!v; }
  /** KO on/off. speed = battle speed (the fall and the rise scale with it). Off = the revive RISE (animated). */
  setKO(v, speed = 1) {
    if (this.ko === !!v) return; this.ko = !!v; this.koSpeed = speed || 1; this.koLeft = null;
    if (this.ko) { this.koT = 0; this.koAt = performance.now(); this.riseAt = 0; }
    else { this.koT = 1; this.riseAt = performance.now(); this.setPose('recover'); }
  }
  /** Hold the white hit flash at `peak` for `ms` (the hit-stop), then let it decay. */
  hitFlash(ms, peak = 0.45) { peak *= flashScale(); /* OPTIONS hook: Display > Flash Intensity */ this.flashUntil = performance.now() + ms; this.flashPeak = peak; this.flash = Math.max(this.flash, peak); }
  /** KO countdown beat (battle.js 'countdown'): the body twitches and pales; on the last count it keeps blinking. */
  koBeat(left) { this.koLeft = left; this.koBeatAt = performance.now(); }
  /** Crystallise (battle.js, KO countdown ran out): the body whitens and sinks into its crystal instead of popping out. */
  crystallize(speed = 1) { this.crystAt = performance.now(); this.crystSpeed = speed || 1; }
  /** Critical HP (the genre's kneel): hunched, slower heavier breathing on the recover frame. */
  setWounded(v) { this.wounded = !!v; }
  /** Screen-right unit vector on the ground for the current camera yaw (used for lean direction). */
  static screenRight(camYaw) { return new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw)); }
  update(camYaw, dt) {
    this.t += dt; this.camYaw = camYaw;
    updateKey(this, this.u);   // scene-luminance key term (throttled inside; read-only over the light rig)
    // camera sits at focus + (sin(yaw), *, cos(yaw)); a unit whose facing points toward the camera shows its front.
    const fx = [0, 1, 0, -1][this.facing], fz = [1, 0, -1, 0][this.facing];
    const toCam = fx * Math.sin(camYaw) + fz * Math.cos(camYaw);
    const toRight = fx * Math.cos(camYaw) - fz * Math.sin(camYaw);
    const row = toCam >= 0 ? 0 : 1;
    // atlas art faces / thrusts screen-right; mirror when the unit faces screen-left.
    const mirror = toRight < 0;
    // --- frame selection. Locomotion and the idle breath are FRAME cycles, never a transform on a static frame
    // (CRITIQUE_R2 rank 9: 16 consecutive captures of the old idle were pixel-identical), and the walk NEVER
    // references POSE.idle or POSE.recover — a standing frame inside a locomotion cycle is the definition of skating.
    let pose = this.pose; const nowMs = performance.now();
    if (this.facing !== this._lastFacing) { if (!this.ko) this.turnAt = nowMs; this._lastFacing = this.facing; }
    const M = this.motion;
    const rising = !this.ko && this.riseAt && (nowMs - this.riseAt) < KO_RISE_MS / this.koSpeed;
    if (!rising && this.riseAt) { this.riseAt = 0; if (this.pose === POSE.recover) this.pose = pose = POSE.idle; }
    const idleP = this.idlePeriod * (this.wounded ? 1.45 : 1);
    if (this.ko || rising) pose = POSE.recover;
    else if (this.walk && M === 'float') pose = (this.t % idleP) < idleP * 0.5 ? POSE.idle : POSE.idleB;   // a ghost glides, it has no legs to scissor
    else if (this.walk) pose = this.walk.pose ? POSE[this.walk.pose] : WALK[((Math.floor(this.walk.phase * 4) % 4) + 4) % 4];
    else if (this.charging && (pose === POSE.idle || pose === POSE.idleB)) pose = POSE.cast;
    else if (pose === POSE.idle && this.wounded) pose = POSE.recover;
    else if (pose === POSE.idle) pose = (this.t % idleP) < idleP * 0.5 ? POSE.idle : POSE.idleB;
    this.setFrame(row, pose, mirror);
    this.bill.rotation.y = camYaw;
    // --- pivot animation ---
    const P = this.pivot; let fade = 1; let air = 0;
    // reaction offset: moves the body AND its contact shadow together (root stays on the tile)
    this.bill.position.copy(this.off);
    solveStagger(camYaw, nowMs); this.stag += (this.stagT - this.stag) * Math.min(1, dt * 8 || (dt === 0 ? 1 : 0));
    if (this.stag) { _sr.set(Math.cos(camYaw), 0, -Math.sin(camYaw)).multiplyScalar(this.stag); this.bill.position.add(_sr); }
    const koPose = (e, lift = 0) => {
      // KO: topple sideways and come to rest on the tile. The billboard STAYS FACING THE CAMERA and is rolled 90 deg
      // about the screen axis, which is the 2-D trick the genre's lying frames read as (a reference capture): the body is fully
      // legible on its side instead of collapsing into a foreshortened smear the way a ground-plane lay-down does.
      // A small backward tilt puts it into the ground plane, and the pivot slides so the body centres on its own tile.
      const side = mirror ? -1 : 1; // fall away from the direction faced
      P.rotation.set(-0.30 * e, 0, side * Math.PI / 2 * e);
      P.position.set(side * this.heightUnits * 0.42 * e, 0.12 * e + lift, 0.02 * e);
    };
    if (this.ko) {
      // Wall clock, not integrated dt (R6: the capture harness renders ~1 frame per 1-4 s, so a dt-integrated fall
      // was still upright at '1400 ms'). Buckle -> gravity topple -> one bounce.
      const el = (nowMs - this.koAt) * this.koSpeed; let e = 0, sq = 0, lift = 0;
      if (el < KO_BUCKLE_MS) { const k = el / KO_BUCKLE_MS; sq = -0.13 * Math.sin(k * Math.PI * 0.5); }
      else if (el < KO_BUCKLE_MS + KO_FALL_MS) { const k = (el - KO_BUCKLE_MS) / KO_FALL_MS; e = k * k; sq = -0.13 * (1 - k); }
      else if (el < KO_BUCKLE_MS + KO_FALL_MS + KO_BOUNCE_MS) { const k = (el - KO_BUCKLE_MS - KO_FALL_MS) / KO_BOUNCE_MS; e = 1 - 0.09 * Math.sin(k * Math.PI); lift = 0.05 * Math.sin(k * Math.PI); }
      else e = 1;
      this.koT = Math.min(1, el / (KO_BUCKLE_MS + KO_FALL_MS)); koPose(e, lift);
      P.scale.set(1 - sq * 0.4, 1 + sq, 1);
      // countdown beat: a twitch (small lift) as the number ticks
      const beat = nowMs - this.koBeatAt; if (beat < 260) P.position.y += 0.05 * Math.sin(beat / 260 * Math.PI);
      fade = 1 - 0.45 * e;
      if (this.crystAt) { const k = Math.min(1, (nowMs - this.crystAt) * this.crystSpeed / 400); P.scale.x *= 1 - 0.6 * k * k; P.scale.y *= 1 - 0.85 * k * k; this.flash = Math.max(this.flash, 0.5 * k); fade *= 1 - k; }
    } else if (rising) {
      // revive: roll back up off the deck (ease-out), a small hop as the feet find the tile
      const k = (nowMs - this.riseAt) * this.koSpeed / KO_RISE_MS; const e = 1 - easeOutC(Math.min(1, k / 0.75));
      koPose(e, k > 0.7 ? Math.sin((k - 0.7) / 0.3 * Math.PI) * 0.07 : 0); P.scale.set(1, 1, 1);
      fade = 1 - 0.45 * e;
    } else if (this.walk) {
      const w = this.walk; // {phase 0..1 per tile, dir (+1 screen-right / -1), hop, squash, ground, pose?}
      // The body's rise and fall is IN THE FRAMES (pack_sprites.py WALK_CYCLE bobs the torso above the hip while the
      // soles stay planted); the hop (height change) and the crouch / landing squash are the only transforms.
      let sq = w.squash || 0, hop = w.hop, lean = w.pose ? 0 : -w.dir * 0.07;
      // R19 body plans: a giant lands every footfall (a squash on each contact), a beast bounds (a gallop hop per
      // step), a ghost glides a hand off the ground with a slow bob and a steeper lean.
      const ph = w.phase || 0;
      if (M === 'giant' && !w.pose) { const c = Math.abs(Math.cos(ph * Math.PI * 2)); sq += -0.045 * Math.pow(c, 6); lean *= 0.6; }
      else if (M === 'beast' && !w.pose) { hop += 0.07 * Math.abs(Math.sin(ph * Math.PI * 2)); lean *= 1.4; }
      else if (M === 'float') { hop += 0.14 + 0.03 * Math.sin(this.t * 3.2); lean = -w.dir * 0.12; }
      P.position.set(0, hop, 0);
      P.rotation.set(0, 0, lean);   // lean into the direction of travel (not in the air)
      P.scale.set(1 - sq * 0.5, 1 + sq, 1);
      air = hop + (w.ground != null ? this.root.position.y - w.ground : 0);
    } else if (this.charging) {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 5.5);
      P.position.set(0, this.hop + (M === 'float' ? 0.14 : 0), 0); P.rotation.set(0, 0, 0); P.scale.set(1 + pulse * 0.02, 1 + pulse * 0.03, 1);
      this.u.uFlash.value = Math.max(this.flash, pulse * 0.16);
      air = this.hop;
    } else {
      // The idle breath is the idle/idle_b FRAME PAIR selected above — that is the animation. The sub-pixel rise
      // below only keeps the hold between the two frames from being a dead freeze.
      // `squash` is the anticipation hook anim.js drives during a wind-up (the silhouette must GROW before a strike).
      // Wounded (critical HP): hunched (a small crouch + a forward lean) with a slower, deeper breath.
      const wd = this.wounded && this.pose === POSE.idle;
      const settled = this.pose === POSE.idle || this.pose === POSE.idleB;   // no idle flavour on top of an action
      // R19 class idles: giants and beasts HEAVE (the chest swells on a slower breath), casters' robes sway, ghosts
      // hover and bob a hand off the ground (the contact shadow shrinks under them).
      const big = M === 'giant' || M === 'beast' || M === 'flyer';
      const bp = idleP * (M === 'giant' ? 1.35 : 1);
      const ph = Math.sin(this.t * (2 * Math.PI / bp));
      const br = (wd ? 0.022 : 0.012) * ph;
      let sq = this.squash + (wd ? -0.05 + 0.015 * ph : 0);
      let lean = this.lean + (wd ? (mirror ? 0.06 : -0.06) : 0);
      let hover = 0;
      if (settled && big) sq += 0.022 * ph;
      if (settled && M === 'caster') lean += 0.018 * Math.sin(this.t * (2 * Math.PI / (idleP * 1.9)));
      if (M === 'float') hover = 0.14 + 0.045 * Math.sin(this.t * 2.6);
      P.position.set(0, this.hop + br + hover, 0); P.rotation.set(0, 0, lean); P.scale.set(1 - sq * (big ? 0.8 : 0.5), 1 + sq, 1);
      air = this.hop + hover;
    }
    { const tk = (nowMs - this.turnAt) / 110; if (tk >= 0 && tk < 1 && !this.ko) P.scale.x *= 0.42 + 0.58 * easeOutC(tk); }   // R19 turn squeeze
    air = Math.max(0, air); fade *= 1 / (1 + air * 2.5);
    if (nowMs < this.flashUntil) this.flash = Math.max(this.flash, this.flashPeak);
    else if (this.flash > 0) { this.flash = Math.max(0, this.flash - dt * 6.0); }
    // Flash PEAK (round 5): the map critics caught full-white silhouettes in auto frames, and after the 0.80
    // pass the melee reads still said 'nearly washed into white — shorten the peak'. 0.65 keeps an classic-style
    // white kick (the darkest 35% of the art stays) and it returns within ~30 ms of the impact.
    if (!this.charging) this.u.uFlash.value = Math.min(0.65, this.flash * 2.0);
    // KO tint; on the LAST count the body blinks (the genre's 'about to crystallise' read), and each beat pales it briefly
    let tint = this.ko ? 0.72 : 1;
    if (this.ko && this.koLeft != null) {
      const beat = nowMs - this.koBeatAt; if (beat < 260) tint += 0.35 * Math.sin(beat / 260 * Math.PI);
      if (this.koLeft <= 1) tint *= 0.62 + 0.38 * (Math.sin(nowMs / 1000 * Math.PI * 2 * 2.2) > 0 ? 1 : 0);
    }
    this.u.uTint.value.setScalar(tint);
    this.shadowU.uFade.value = fade * this.shadowOpacity;
    // the contact shadow stays ON THE GROUND under a hop (walk.ground) and shrinks as the body rises off it
    const sr = this.shadowR * (1 / (1 + air * 0.5)) * (this.ko ? 1.35 : 1);
    this.shadow.scale.set(sr, 1, sr * 0.66);
    this.shadow.position.set(this.bill.position.x, 0.02 + (this.walk && this.walk.ground != null ? this.walk.ground - this.root.position.y : 0), this.bill.position.z);   // R18: bill = off + stagger
    // A body on the floor is not a piece the player has to find, and a crystallised / removed unit is not on the
    // board at all (battle.update clears root.visible for those), so neither gets a silhouette. Everything else is
    // left to the depth test, which draws nothing at all when the unit is in the clear.
    // The ghost's visibility and strength are decided per render by occlusion.js (it needs the camera).
    this.silhouetteAllowed = SILHOUETTES && this.ghostOn && !this.ko;
    if (!this.silhouetteAllowed) this.ghost.visible = false;
    attachScene(this.root);
  }
}
