import * as THREE from 'three';
import { F } from './atlas.js';
import { paintCreature, warmStep, releaseCreature } from './summonart.js';
import { flashScale } from '../ui/prefs.js';   // OPTIONS hook (read-only): Flash Intensity tames the creature's white flashes
import { cineFull } from './cine.js';
// SUMMON16 -- the summon IS the creature. Every summon ability (data.js: pyrelord, frost_maiden, storm_elder, hearthling, gemfox,
// wyrm_sovereign) calls up a painted pixel-art creature (summonart.js) as a camera-facing billboard behind the target
// area: it ENTERS (Pyrelord climbs out of a burning crack, Frost Maiden thaws out of an ice crystal, Storm Elder arrives on a
// lightning strike, Hearthling floats down, Gemfox bounds in, Wyrm Sovereign descends out of a sky ring), performs an
// ATTACK GESTURE on its own frame (hurl / exhale / staff thrust / cheer / gem flare / Mega Flare breath), the
// elemental payload lands on every victim as its own staggered hit, and the creature EXITS. ~1.2 s to the first
// hit at speed 1 (plus the cinematic tier's 0.55 s gather beat), ~2.3 s overall; x2 compresses, x4 is a flash.
// Any key during the moment sends the creature away at once (the grade already skips on the same key).
//
// Also here: the PER-VICTIM RIPPLE for every multi-target spell (play() calls _ripple): the centre victim takes the
// main effect at the impact, each further victim gets its own pop + white body flash ~75 ms apart, so a clump of
// neighbours reads as N hits, not one blob. play() returns the ripple's end, so the numbers land after the last hit.

const C = (h) => new THREE.Color(h);
const HDR = (h, k) => new THREE.Color(h).multiplyScalar(k);
const mix = (a, b, k) => a.clone().lerp(b, k);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const EASE = { lin: (k) => k, out: (k) => 1 - (1 - k) * (1 - k), in: (k) => k * k, io: (k) => (k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k)), back: (k) => { const s = 1.70158; k -= 1; return k * k * ((s + 1) * k + s) + 1; } };

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// pixel-art sampling (texel-snapped, one-pixel AA seam like the unit sprites), ground reveal, per-texel dissolve
// with a hot edge, element tint, white flash. Output is opaque: the figure is a solid sprite like the units.
const FRAG = /* glsl */`
uniform sampler2D map; uniform vec2 uTex; uniform vec4 uFrame; uniform float uReveal, uDissolve, uFlash, uBright, uGlow, uAlpha, uLift;
uniform vec3 uEdge, uTint;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  if (vUv.y < uReveal) discard;
  vec2 fuv = uFrame.xy + vUv * uFrame.zw;
  vec2 pix = fuv * uTex; vec2 seam = floor(pix + 0.5); vec2 dudv = max(fwidth(pix), vec2(1e-4));
  vec2 uvAA = (seam + clamp((pix - seam) / dudv, -0.5, 0.5)) / uTex;
  vec4 t = texture2D(map, uvAA);
  if (uGlow > 0.5) {
    float a = t.a * uAlpha; if (a < 0.004) discard;
    gl_FragColor = vec4(t.rgb * uTint * a, 0.0);
    #include <colorspace_fragment>
    return;
  }
  if (t.a < 0.5) discard;
  float h = hash(floor(pix / 2.0));
  if (h < uDissolve) discard;
  vec3 c = pow(t.rgb, vec3(2.2));
  c *= uTint * uBright;
  { float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c *= 1.0 + uLift * (1.0 - smoothstep(0.15, 0.6, l)); }
  float e = uDissolve > 0.001 ? 1.0 - smoothstep(0.0, 0.14, h - uDissolve) : 0.0;
  c = mix(c, uEdge, e);
  c = mix(c, vec3(1.0), uFlash);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const TEX = {};
function textures(key) {
  if (TEX[key]) return TEX[key];
  const art = paintCreature(key); if (!art) return null;
  const mk = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.premultiplyAlpha = false; t.needsUpdate = true; return t; };
  TEX[key] = { art, body: mk(art.atlas), glow: mk(art.glow), refs: 0, timer: 0 }; return TEX[key];
}
// PERF r12: a creature kind's textures and canvases live only while one is on stage (+5 s, so a multi-creature cast
// or an immediate recast reuses them); they were kept for the whole page before. ~0.7-2.7 MB of canvas + texture each.
function retain(key) { const T = TEX[key]; if (T) { T.refs++; clearTimeout(T.timer); T.timer = 0; } }
function release(key) {
  const T = TEX[key]; if (!T || --T.refs > 0) return;
  clearTimeout(T.timer);
  T.timer = setTimeout(() => { if (TEX[key] !== T || T.refs > 0) return; delete TEX[key]; T.body.dispose(); T.glow.dispose(); releaseCreature(key); }, 5000);
}

// One creature on stage: a body quad (opaque, drawn after the terrain and before the unit sprites, no depth test --
// the genre paints its summons over the map, and the units still stand in front of them) + an additive halo quad.
class Creature {
  constructor(vfx, key, anchor, { mirror = false, scale = 1, delay = 0, push = 1.2 } = {}) {
    this.push = push;   // the quad is slid this far toward the lens (orthographic: no screen shift) so terrain at its feet never clips it and units behind it are hidden by it
    const T = textures(key); this.ok = !!T; if (!T) return; retain(key);
    this.vfx = vfx; this.key = key; this.art = T.art; this.t = -delay; this.dead = false;
    const a = T.art; const wU = a.cellW / a.ppu * scale, hU = a.cellH / a.ppu * scale;
    this.wU = wU; this.hU = hU; this.figH = a.h / a.ppu * scale;
    const geo = new THREE.PlaneGeometry(wU, hU); geo.translate(0, hU / 2 - (a.pad + 2) / a.ppu * scale, 0);
    const uni = () => ({ map: { value: null }, uTex: { value: new THREE.Vector2(a.atlas.width, a.atlas.height) }, uFrame: { value: new THREE.Vector4(0, 0, 1 / a.frames, 1) },
      uReveal: { value: 0 }, uDissolve: { value: 0 }, uFlash: { value: 0 }, uBright: { value: 0.95 }, uGlow: { value: 0 }, uAlpha: { value: 1 }, uLift: { value: 0 }, uEdge: { value: C(a.aura).multiplyScalar(2.2) }, uTint: { value: new THREE.Color(1, 1, 1) } });
    const ub = uni(); ub.map.value = T.body;
    this.body = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: ub, vertexShader: VERT, fragmentShader: FRAG, transparent: false, depthTest: true, depthWrite: true, side: THREE.DoubleSide, toneMapped: false }));
    this.body.renderOrder = 7; this.body.frustumCulled = false; this.body.name = 'vfx-summon';
    const ug = uni(); ug.map.value = T.glow; ug.uGlow.value = 1; ug.uAlpha.value = 0.6; ug.uTint.value = C(a.aura).multiplyScalar(0.9);
    // the halo renders in the OPAQUE pass just before the body (renderOrder 6 < 7): the body then covers it, so it only
    // rims the silhouette, and the unit sprites (renderOrder 10) still draw over both
    const gm = new THREE.ShaderMaterial({ uniforms: ug, vertexShader: VERT, fragmentShader: FRAG, transparent: false, depthTest: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    gm.blending = THREE.CustomBlending; gm.blendEquation = THREE.AddEquation; gm.blendSrc = THREE.OneFactor; gm.blendDst = THREE.OneFactor;
    this.glow = new THREE.Mesh(geo, gm); this.glow.renderOrder = 6; this.glow.frustumCulled = false; this.glow.name = 'vfx-summon-glow';
    this.body.visible = this.glow.visible = false;
    vfx.scene.add(this.glow); vfx.scene.add(this.body);
    this.anchor = anchor.clone(); this.mirror = mirror ? -1 : 1; this.scale = 1;
    // animated state
    this.s = { x: 0, y: 0, frame: 0, reveal: 0, dissolve: 1, flash: 0, glow: 0.6, sq: 1, bright: 0.95 };
    this.tw = []; this.ev = [];
  }
  // tween a state key: from (null = current at start) -> to over [t0, t0 + dur]
  to(key, to, t0, dur, ease = 'out', from = null) { this.tw.push({ key, to, t0, dur, ease, from, started: false }); return this; }
  at(t, fn) { this.ev.push({ t, fn }); this.ev.sort((p, q) => p.t - q.t); return this; }
  frame(t, i) { return this.at(t, () => { this.s.frame = i; }); }
  skip() { if (this.skipped || this.dead) return; this.skipped = true; this.tw = []; this.ev = []; const d0 = this.s.dissolve; this.to('dissolve', 1, this.t, 0.14, 'lin', Math.min(d0, 1)); this.to('glow', 0, this.t, 0.14, 'lin'); this.at(this.t + 0.15, () => this.kill()); }
  kill() { if (this.dead) return; this.dead = true; this.vfx.scene.remove(this.body); this.vfx.scene.remove(this.glow); this.body.material.dispose(); this.glow.material.dispose(); this.body.geometry.dispose(); release(this.key); }
  update(dt, cam) {
    if (this.dead) return false;
    this.t += dt; const t = this.t; if (t < 0) return true;
    while (this.ev.length && this.ev[0].t <= t) { const e = this.ev.shift(); try { e.fn(); } catch (err) { console.error('summon event', err); } }
    for (let i = this.tw.length - 1; i >= 0; i--) {
      const w = this.tw[i]; if (t < w.t0) continue;
      if (!w.started) { w.started = true; if (w.from == null) w.from = this.s[w.key]; }
      const k = w.dur > 0 ? clamp01((t - w.t0) / w.dur) : 1; this.s[w.key] = w.from + (w.to - w.from) * EASE[w.ease](k);
      if (k >= 1) this.tw.splice(i, 1);
    }
    if (this.dead) return false;
    const s = this.s, a = this.art;
    const vis = s.dissolve < 0.999 && s.reveal < 0.999;
    this.body.visible = vis; this.glow.visible = vis && s.glow > 0.01;
    if (!cam) return true;
    const right = this._r || (this._r = new THREE.Vector3()), up = this._u || (this._u = new THREE.Vector3());
    right.setFromMatrixColumn(cam.matrixWorld, 0); up.setFromMatrixColumn(cam.matrixWorld, 1);
    const toCam = this._z || (this._z = new THREE.Vector3()); toCam.setFromMatrixColumn(cam.matrixWorld, 2).normalize();
    // FRAME FIT: the cinematic push-in frames the victim, so a tall creature standing behind it would lose its head
    // off the top of the screen. Whatever part of the figure would leave the top 8% of the frame is slid down the
    // screen (orthographic: a pure screen shift), eased so a changing lens never makes it jump.
    let fit = 0, fitX = 0;
    if (cam.isOrthographicCamera) {
      const top = this.anchor.clone().addScaledVector(up, s.y + this.figH * s.sq).project(cam);
      const worldPerNdc = (cam.top - cam.bottom) / (2 * (cam.zoom || 1)); fit = Math.min(0, (0.84 - top.y) * worldPerNdc);
      // and sideways: the figure's centre stays inside the middle 76% of the width
      const mid = this.anchor.clone().addScaledVector(up, s.y + this.figH * 0.5).project(cam); const wpx = (cam.right - cam.left) / (2 * (cam.zoom || 1));
      fitX = (mid.x > 0.76 ? 0.76 - mid.x : mid.x < -0.76 ? -0.76 - mid.x : 0) * wpx;
    }
    this.fitX = this.fitX == null ? fitX : this.fitX + (fitX - this.fitX) * Math.min(1, dt * 10);
    this.fitY = this.fitY == null ? fit : this.fitY + (fit - this.fitY) * Math.min(1, dt * 10);
    // feet anchored in the world; x/y offsets are screen-space (camera right / camera up), in world units
    const p = this.anchor.clone().addScaledVector(toCam, this.push).addScaledVector(right, s.x * this.mirror + this.fitX).addScaledVector(up, s.y + this.fitY);   // s.x is in ART space (- = toward the target)
    for (const m of [this.body, this.glow]) {
      m.position.copy(p); m.quaternion.copy(cam.quaternion);
      m.scale.set(this.mirror * (2 - s.sq), s.sq, 1);
      const u = m.material.uniforms; const f = Math.round(s.frame) % a.frames;
      u.uFrame.value.set(f / a.frames, 0, 1 / a.frames, 1); u.uReveal.value = s.reveal; u.uDissolve.value = Math.max(0, s.dissolve);
    }
    // the spell grade (render/post/grade.js, read-only here) pulls everything below its luma knee toward a dark tint;
    // the creature is the spell, so it is lifted by the same amount and reads as a luminous apparition over the map
    const gu = (typeof window !== 'undefined' && window.__GAME__?.pipeline?.passes?.grade?.uniforms) || null; const amt = gu?.spellAmt ? gu.spellAmt.value : 0;
    const ub = this.body.material.uniforms; ub.uFlash.value = clamp01(s.flash) * (0.35 + 0.65 * flashScale()); ub.uBright.value = s.bright; ub.uLift.value = 1.8 * amt;
    this.glow.material.uniforms.uAlpha.value = s.glow * (1 - clamp01(s.dissolve)) * (1 - s.reveal * 0.8);
    return true;
  }
  // world point of a pixel in the CURRENT frame's art space (x from centre, y up from the feet), honouring mirror
  px(x, y, cam) {
    const a = this.art; const k = 1 / a.ppu; const s = this.s;
    const right = new THREE.Vector3(), up = new THREE.Vector3(), tc = new THREE.Vector3();
    if (cam) { right.setFromMatrixColumn(cam.matrixWorld, 0); up.setFromMatrixColumn(cam.matrixWorld, 1); tc.setFromMatrixColumn(cam.matrixWorld, 2).normalize(); } else { right.set(1, 0, 0); up.set(0, 1, 0); }
    return this.anchor.clone().addScaledVector(tc, this.push + 0.3).addScaledVector(right, (s.x + x * k * (2 - s.sq)) * this.mirror + (this.fitX || 0)).addScaledVector(up, s.y + (this.fitY || 0) + y * k * s.sq);
  }
}

// ---- summon roster: which painted creature, element look, and the anchor/lift per creature ----
// w/h/ppu: the painted figure's size in art pixels (summonart.js DEFS, mirrored here so the camera can plan the shot
// without painting the art first); figure width = w/ppu, height = h/ppu world units.
const SUMMON = {
  pyrelord: { art: 'pyrelord', look: 'fire', back: 0.3, side: 2.3, lift: 0, w: 184, h: 200, ppu: 70 },
  frost_maiden: { art: 'frost_maiden', look: 'ice', back: 0.3, side: 2.2, lift: 0.25, w: 150, h: 204, ppu: 64 },
  storm_elder: { art: 'storm_elder', look: 'thunder', back: 0.3, side: 2.3, lift: 0.1, w: 160, h: 206, ppu: 74 },
  hearthling: { art: 'hearthling', look: 'cure', back: -0.7, side: 1.6, push: 1.8, lift: 1.1, w: 88, h: 92, ppu: 72 },
  gemfox: { art: 'gemfox', look: 'reflect', back: -0.7, side: 1.5, push: 1.8, lift: 0, w: 104, h: 84, ppu: 76 },
  wyrm_sovereign: { art: 'wyrm_sovereign', look: 'wyrm_sovereign', back: 0.6, side: 2.8, lift: 1.1, w: 280, h: 216, ppu: 80 },
};
export const SUMMON_IDS = Object.keys(SUMMON);

// ---- R18 SUMMON SHOT PLAN (review17 P4: Pyrelord rose over empty pews with its victims off-frame; Wyrm Sovereign was cut in half
// by the 1920 frame edge and its breath landed off-screen) ----------------------------------------------------------
// Victims of a summon at `at` (world point): every living unit within the ability's area, centre first. The same rule
// the effect uses (P._victims), as a pure function the camera can call at abilityStart, before the effect exists.
export function summonVictims(battle, ability, caster, at) {
  if (!battle || !ability) return [];
  const area = ability.area || 0; const tx = Math.floor(at.x), tz = Math.floor(at.z); const out = [];
  for (const u of battle.units) {
    if (!(u.hp > 0)) continue; const dd = Math.abs(u.x - tx) + Math.abs(u.z - tz); if (dd > area) continue;
    if (caster && ability.enemyOnly && u.team === caster.team) continue;
    if (caster && ability.allyOnly && u.team !== caster.team) continue;
    out.push({ u, dd, p: battle.worldPos(u.x, u.z) });
  }
  out.sort((p, q) => p.dd - q.dd || p.u.x - q.u.x || p.u.z - q.u.z);
  return out;
}
// Where the creature stands, and the world points the frame must hold (the creature's figure + every victim), as ONE
// pure function of (target, caster, victims, map, lens yaw/pitch). fx_summon places the creature with it and
// cinematics frames with it, so the lens is solved for the creature that will actually appear.
//   ground(at, right, back, off, dep) -> Vector3|null : the board's ground point (vfx._cineGround), null off the board
// Side: behind the target area on the side AWAY from the caster (the hurl reads across the victims) -- unless the other
// side makes the whole shot (victims + figure, along the screen's width) clearly narrower, which is what lets a big
// figure (Wyrm Sovereign, 3.5 tiles of wings) and a spread-out area share one frame instead of one of them leaving it.
export function summonPlan(id, at, src, victims, ground, yaw, pitch) {
  const S = SUMMON[id]; if (!S) return null;
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), back = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const figW = S.w / S.ppu, figH = S.h / S.ppu;
  const away = -(Math.sign((src.x - at.x) * right.x + (src.z - at.z) * right.z) || -1);
  let e1 = 0, e0 = 0;   // victims' extent along camera-right, + and - side
  for (const v of victims || []) { const d = (v.p.x - at.x) * right.x + (v.p.z - at.z) * right.z; if (d > e1) e1 = d; if (-d > e0) e0 = -d; }
  const span = (sd) => { const off = sd * S.side; return Math.max(e1, off + figW / 2) - Math.min(-e0, off - figW / 2); };
  const first = span(-away) < span(away) - 0.6 ? -away : away;
  let anchor = null, side = first;
  for (const [sd, bk] of [[first, S.back], [-first, S.back], [first, S.back + 0.8], [-first, S.back + 0.8], [0, S.back + 1.2], [first, -0.6]]) {
    const g = ground ? ground(at, right, back, sd * S.side, bk) : null;
    if (g && g.y > at.y - 1.0 && g.y < at.y + 1.6) { anchor = g; side = sd || first; break; }
  }
  if (!anchor) anchor = at.clone().addScaledVector(back, S.back);
  anchor.y = Math.max(anchor.y, at.y) + S.lift;
  // frame points: the billboard faces the lens, so its height runs along the camera's UP axis (orthographic: a world
  // point anchor + up*h lands exactly where the figure's pixel row h is drawn)
  const cp = Math.cos(pitch), sp = Math.sin(pitch), up = new THREE.Vector3(-sp * Math.sin(yaw), cp, -sp * Math.cos(yaw));
  const pts = [];
  for (const k of [-0.5, 0.5]) for (const h of [0, figH * 0.96]) { const q = anchor.clone().addScaledVector(right, k * figW).addScaledVector(up, h); pts.push([q.x, q.y, q.z]); }
  return { anchor, side, figW, figH, pts, S };
}

export function installSummonFx(VFX) {
  const P = VFX.prototype;

  // ---- victims of the ability in flight, predicted from its area (centre first, then by distance) ----
  P._victims = function (at) {
    const b = this.battle, c = this._ctx; if (!b || !c || !c.ability) return [];
    if ((c.ability.area || 0) < 1) return [];
    return summonVictims(b, c.ability, c.unit, at);
  };
  P._rippleStep = function () { const sp = (this.battle && this.battle.speed) || 1; return 0.075 / Math.max(1, Math.sqrt(sp)); };
  // one victim's own hit: a white body flash (the sprite), a hot core + element rim, sparks, a ground ring
  P.victimPop = function (v, hex, { delay = 0, kind = 'hit' } = {}) {
    const r = this.rnd; const at = v.p; const G = C(hex), W = HDR(0xffffff, 1.6);
    const sp = v.u ? this.battle?.spriteOf?.(v.u) : null; const hgt = (sp && sp.heightUnits) || 1.1; const cy = at.y + hgt * 0.55;
    this.timer(delay, () => { if (kind === 'hit') sp?.hitFlash?.(90, 0.55); else if (sp) sp.flash = Math.max(sp.flash || 0, 0.3 * flashScale()); });
    this.P(this.add, this.col({ x: at.x, y: cy, z: at.z, life: 0.2, delay, size: 0.3, size1: 1.3, growT: 0.08, frame: F.flare, rot: r() * 3, fadeIn: 0.01, fadeOut: 1.4, alpha: 0.95, occ: 0.05 }, W));
    this.P(this.add, this.col({ x: at.x, y: cy, z: at.z, life: 0.34, delay, size: 0.6, size1: 1.9, growT: 0.14, frame: F.glow, fadeIn: 0.01, fadeOut: 1.3, alpha: 0.7 }, G));
    this.burst(this.add, kind === 'hit' ? 12 : 8, () => { const a = r() * 6.2832, el = (r() - 0.2) * 1.2, s = 2.2 + r() * 2.6; return this.col({ x: at.x, y: cy, z: at.z, vx: Math.cos(a) * Math.cos(el) * s, vy: Math.sin(el) * s + (kind === 'hit' ? 0 : 1.5), vz: Math.sin(a) * Math.cos(el) * s, life: 0.28 + r() * 0.2, delay, size: kind === 'hit' ? 0.7 : 0.25, ay: kind === 'hit' ? 0.14 : 1, frame: kind === 'hit' ? F.spark : F.star, align: kind === 'hit', drag: 2, fadeOut: 1.2 }, r() < 0.4 ? W : G); });
    this.ringFx(at, hex, 0.2, 1.1, 0.4, { alpha: 0.85, delay });
  };
  // the ripple for a generic multi-target spell (play() calls this after the main effect; returns the extra wait)
  P._ripple = function (at, d, fname) {
    const c = this._ctx; const ab = c?.ability; if (!ab || (ab.area || 0) < 1) return 0;
    const vs = this._victims(at); if (vs.length < 2) return 0;
    const step = this._rippleStep(); const kind = ab.kind === 'heal' || ab.kind === 'buff' || ab.kind === 'raise' ? 'soft' : 'hit';
    const hex = ab.kind === 'heal' ? 0x8dffae : ab.kind === 'buff' ? 0xffd66a : ({ fire: 0xff7a2a, ice: 0x8fd8ff, thunder: 0xfff07a, holy: 0x9fd0ff, dark: 0xa060ff, earth: 0xd0a060 }[ab.element] || 0xe8d0ff);
    // the centre victim takes the main effect at d; everyone else pops after it, one at a time
    let i = 0; for (const v of vs) { if (Math.abs(v.p.x - at.x) < 0.3 && Math.abs(v.p.z - at.z) < 0.3) continue; i++; this.victimPop(v, hex, { delay: d + i * step, kind }); }
    void fname; return i * step;
  };

  // ---- small per-element strikes used for the non-centre victims of a summon ----
  P._strike = function (look, v, dl, src, big = false) {
    const r = this.rnd; const at = v.p;
    if (look === 'fire') {
      const O = C(0xff6a10), Y = C(0xffb030), RED = C(0xc02000);
      this.P(this.add, this.col({ x: at.x, y: at.y + 0.7, z: at.z, life: 0.3, delay: dl, size: 0.4, size1: 1.6, growT: 0.1, frame: F.core, fadeIn: 0.01, fadeOut: 1.4 }, HDR(0xffa040, 1.6)));
      this.burst(this.add, 16, () => this.col({ x: at.x + (r() - 0.5) * 0.6, y: at.y + 0.2 + r() * 0.6, z: at.z + (r() - 0.5) * 0.6, vx: (r() - 0.5) * 1.2, vy: 1.6 + r() * 2, vz: (r() - 0.5) * 1.2, drag: 1.4, life: 0.5 + r() * 0.3, delay: dl + r() * 0.05, size: 0.8 + r() * 0.5, size1: 0.2, frame: r() < 0.5 ? F.flame : F.billow, rot: r() * 6, rotv: (r() - 0.5) * 3, alpha: 0.85, fadeOut: 1.2, c1: C(0x1c0a04), cT: 0.6 }, mix(O, r() < 0.5 ? Y : RED, r())));
      this.decal(at, 'cinder', { color: 0xff7a1c, size: 0.6, size1: 1.5, grow: 0.2, life: 1.3, hold: 0.25, alpha: 0.8, delay: dl });
    } else if (look === 'ice') {
      const PALE = C(0x9fdcff);
      const nS = big ? 9 : 5; if (big) { this.light(at, 0x7fbfff, 7, 0.9, { rise: 0.1, y: 1.2, dist: 4, delay: dl }); this.P(this.add, this.col({ x: at.x, y: at.y + 0.9, z: at.z, life: 0.35, delay: dl + 0.42, size: 0.5, size1: 3, frame: F.flare, fadeIn: 0.01, fadeOut: 1.4, alpha: 0.9 }, HDR(0xc8f0ff, 1.5))); }
      for (let j = 0; j < nS; j++) { const a = j / nS * 6.2832 + r(), rr = 0.25 + r() * 0.2, h = (big ? 1.0 : 0.7) + r() * 0.7; const base = { x: at.x + Math.cos(a) * rr, y: at.y + h * 0.45, z: at.z + Math.sin(a) * rr, life: 0.7, delay: dl + j * 0.02, size: 0.12, size1: h, growT: 0.1, ax: 0.5, ay: 1, frame: F.shard, rot: Math.cos(a) * 0.4, fadeIn: 0.02, hold: 0.55, fadeOut: 1.2 }; this.P(this.norm, this.col({ ...base, alpha: 0.9 }, mix(C(0x2a6ee0), C(0x8fd8ff), r()))); this.P(this.add, this.col({ ...base, alpha: 0.4 }, PALE)); }
      this.burst(this.add, 16, () => { const a = r() * 6.2832, s = 1.5 + r() * 3; return this.col({ x: at.x, y: at.y + 0.8, z: at.z, vx: Math.cos(a) * s, vy: 1 + r() * 2.5, vz: Math.sin(a) * s, grav: -7, life: 0.5, delay: dl + 0.45, size: 0.12 + r() * 0.15, frame: F.shard, rot: r() * 6, rotv: 12, fadeOut: 1 }, PALE); });
      this.decal(at, 'frost', { color: 0x9fd8ff, size: 0.5, size1: 1.4, grow: 0.15, life: 1.8, hold: 0.4, alpha: 0.75, delay: dl });
    } else if (look === 'thunder') {
      this.bolt({ from: at.clone().add(new THREE.Vector3((r() - 0.5) * 1.5, 11, (r() - 0.5) * 1.5)), to: at.clone().add(new THREE.Vector3(0, 0.1, 0)), life: 0.3, jitterUntil: 0.22, amp: 0.7, segs: 20, branches: 2, glow: 0x3060e0, core: 0x9ad8ff, widthGlow: 0.42, widthCore: 0.08, depthTest: false, renderOrder: 39, coreBoost: 0.7, delay: dl });
      this.decal(at, 'scorch', { color: 0x000000, size: 0.5, size1: 1.0, grow: 0.1, life: 1.6, hold: 0.3, alpha: 0.5, blending: THREE.NormalBlending, lift: 0.02, delay: dl });
      this.burst(this.add, 14, () => { const a = r() * 6.2832, s = 2 + r() * 3; return this.col({ x: at.x, y: at.y + 0.3, z: at.z, vx: Math.cos(a) * s, vy: 1 + r() * 3, vz: Math.sin(a) * s, life: 0.3, delay: dl, size: 0.2, frame: F.glint, flick: 0.6, fadeOut: 1 }, HDR(0x9ad8ff, 1.3)); });
    } else if (look === 'wyrm_sovereign') {
      this.P(this.add, this.col({ x: at.x, y: at.y + 5, z: at.z, life: 0.45, delay: dl, size: 0.3, size1: 10, growT: 0.1, ax: 0.1, ay: 1, frame: F.glow, fadeIn: 0.03, hold: 0.3, fadeOut: 1.5, alpha: 0.9, noclip: 1 }, HDR(0x9fd0ff, 1.3)));
      this.P(this.add, this.col({ x: at.x, y: at.y + 0.8, z: at.z, life: 0.5, delay: dl + 0.05, size: 0.5, size1: 2.6, growT: 0.15, frame: F.core, fadeIn: 0.01, fadeOut: 1.4, alpha: 0.9 }, HDR(0xb0a0ff, 1.5)));
      this.burst(this.add, 16, () => { const a = r() * 6.2832, el = (r() - 0.2) * 1, s = 6 + r() * 5; return this.col({ x: at.x, y: at.y + 0.8, z: at.z, vx: Math.cos(a) * Math.cos(el) * s, vy: Math.sin(el) * s, vz: Math.sin(a) * Math.cos(el) * s, life: 0.3, delay: dl + 0.05, size: 1.4, ax: 1, ay: 0.12, frame: F.spark, align: true, drag: 2.5, fadeOut: 1.2 }, HDR(0xc0b0ff, 1.2)); });
      this.ringFx(at, 0x9fb0ff, 0.3, 2.0, 0.5, { alpha: 0.9, delay: dl + 0.05 });
    } else if (look === 'cure') {
      this.burst(this.add, 18, () => { const a = r() * 6.2832, rr = r() * 0.5; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 2.4 + r() * 0.8, z: at.z + Math.sin(a) * rr, vy: -2.4 - r(), life: 0.7, delay: dl - 0.4 + r() * 0.15, size: 0.18 + r() * 0.16, frame: r() < 0.5 ? F.star : F.glint, flick: 0.3, fadeOut: 1, fadeIn: 0.15 }, r() < 0.4 ? HDR(0xffffff, 1.3) : C(0x9dffbe)); });
      this.decal(at, 'glyph', { color: 0x9dffbe, size: 0.6, size1: 1.3, grow: 0.3, life: 0.9, hold: 0.4, alpha: 0.7, spin: 1.2, delay: dl - 0.2 });
    } else if (look === 'reflect') {
      if (this.fx_reflect) this.timer(Math.max(0, dl), () => this.fx_reflect(at, src, { status: 'reflect' }));
    }
  };

  // ---- the summon itself ----
  P.fx_summon = function (at, src, o = {}) {
    const id = o.summon; const S = SUMMON[id]; if (!S) return this.fx_generic(at, src, o);
    const r = this.rnd; const sp = (this.battle && this.battle.speed) || 1; const full = cineFull(sp);
    const K = full ? (sp > 1.2 ? 0.72 : 1) : 0.32;          // timeline scale (x4: a flash of the creature, then the hit)
    const cam = this.cam;
    // the lens may still be mid-turn toward its framing stop (cinematics auto-rotate): stage against the yaw it is
    // turning TO, so the creature lands beside the target in the frame the player will actually see. R18: placement is
    // summonPlan() -- the same pure function cinematics framed the shot with at abilityStart.
    let yaw = 0, pitch = 0.52;
    { const cm = typeof window !== 'undefined' ? window.__GAME__?.camera : null; if (cm && Number.isFinite(cm.targetYaw)) { yaw = cm.targetYaw; pitch = cm.targetPitch; } else if (cam) { const r0 = this.camRight(); yaw = Math.atan2(-r0.z, r0.x); } }
    const vs = this._victims(at);
    const plan = summonPlan(id, at, src, vs, this._cineGround ? (a, r0, b0, off, dep) => this._cineGround(a, r0, b0, off, dep) : null, yaw, pitch);
    const anchor = plan.anchor, side = plan.side;
    if (!vs.length) vs.push({ u: null, dd: 0, p: at.clone() });
    const step = this._rippleStep();
    const cr = new Creature(this, S.art, anchor, { mirror: side < 0, delay: this._defer || 0, push: S.push || 12 });
    if (!cr.ok) return this.fx_generic(at, src, o);
    (this._creatures || (this._creatures = [])).push(cr);
    const W = HDR(0xffffff, 1.5);
    // R20 (review19 P3: the creature was gone ~2.5 s after the cast, Wyrm Sovereign on screen ~0.5 s at 1920): the creature holds
    // its pose over the victims after the last hit before it exits, so it is on screen long enough to read (x4: a flash).
    const HOLD = 0.55 * K;
    const look = S.look; let T;   // T = centre victim's hit, seconds after the (deferred) start
    const hand = (x, y) => cr.px(x, y, this.cam);
    const flash = (t, k = 1) => cr.at(t, () => { cr.s.flash = 0.85 * k; cr.to('flash', 0, cr.t, 0.18, 'out'); });
    if (id === 'pyrelord') {
      // a burning crack opens, the demon CLIMBS out of it (reveal from the ground line), roars with a fireball
      // gathering over his head, then hurls it: Hellfire lands on every victim in turn
      const tRise = 0.08 * K, tRoar = 0.55 * K, tHurl = 0.86 * K; T = 1.12 * K;
      this.decal(anchor, 'cinder', { color: 0xff6a14, size: 0.8, size1: 3.2, grow: 0.35 * K, life: 2.2 * K + 0.6, hold: 0.6, alpha: 0.95 });
      this.decal(anchor, 'soft', { color: 0xff5a10, size: 1.5, size1: 4.0, grow: 0.4, life: 2.0 * K + 0.5, hold: 0.5, alpha: 0.55 });
      this.light(anchor, 0xff6a14, 7, 1.9 * K + 0.4, { rise: 0.2, y: 1.6, dist: 5, flicker: 0.35, decay: 1.3 });
      cr.s.reveal = 1; cr.s.dissolve = 0; cr.s.y = -0.2; cr.s.glow = 0.8;
      cr.to('reveal', 0, tRise, 0.44 * K, 'out').to('y', 0, tRise, 0.5 * K, 'out');
      // flame column that he rises through
      this.burst(this.add, 60, (i) => { const a = r() * 6.2832, rr = 0.3 + r() * 1.1; return this.col({ x: anchor.x + Math.cos(a) * rr, y: anchor.y + 0.1, z: anchor.z + Math.sin(a) * rr, vx: (r() - 0.5) * 0.6, vy: 2.5 + r() * 3.5, vz: (r() - 0.5) * 0.6, drag: 1.2, life: 0.5 + r() * 0.4, delay: tRise * 0.5 + (i / 60) * 0.5 * K, size: 0.9 + r() * 0.8, size1: 0.25, ax: 0.7, ay: 1.3, frame: F.flame, rot: (r() - 0.5) * 0.4, alpha: 0.8, fadeOut: 1.2, occ: 0.35, noclip: 1 }, mix(C(0xff7a14), C(r() < 0.5 ? 0xffc040 : 0xc02000), r())); });
      this.burst(this.add, 40, () => { const a = r() * 6.2832, rr = r() * 1.6; return this.col({ x: anchor.x + Math.cos(a) * rr, y: anchor.y + 0.1, z: anchor.z + Math.sin(a) * rr, vx: (r() - 0.5), vy: 2 + r() * 3, vz: (r() - 0.5), life: 1 + r() * 0.6, delay: r() * 1.4 * K, size: 0.06 + r() * 0.06, frame: F.core, flick: 0.5, drag: 0.5, fadeOut: 1, noclip: 1 }, HDR(0xff9020, 1.6)); });
      cr.frame(tRoar, 1); flash(tRoar, 0.5); cr.to('sq', 1.04, tRoar, 0.12, 'out').to('sq', 1, tRoar + 0.14, 0.2, 'io');
      // the fireball over his raised hands
      const ball = { x: 0, y: 0, z: 0 }; const hb = () => { const p = hand(0, 190); ball.x = p.x; ball.y = p.y; ball.z = p.z; };
      cr.at(tRoar, () => { hb();
        this.P(this.add, this.col({ x: 0, y: 0, z: 0, pin: ball, life: tHurl - tRoar + 0.05, size: 0.3, size1: 1.3, growT: tHurl - tRoar, frame: F.core, fadeIn: 0.05, hold: 0.9, fadeOut: 0.3, noclip: 1 }, HDR(0xffb040, 1.8)));
        this.P(this.add, this.col({ x: 0, y: 0, z: 0, pin: ball, life: tHurl - tRoar + 0.05, size: 0.6, size1: 2.4, growT: tHurl - tRoar, frame: F.billow, rotv: 4, fadeIn: 0.05, hold: 0.9, fadeOut: 0.3, alpha: 0.8, noclip: 1 }, C(0xff5a10)));
        this.burst(this.add, 24, () => { const a = r() * 6.2832, rr = 1.2 + r(); return this.col({ x: ball.x + Math.cos(a) * rr, y: ball.y + (r() - 0.5) * rr, z: ball.z + Math.sin(a) * rr, vx: -Math.cos(a) * rr / 0.3, vy: 0, vz: -Math.sin(a) * rr / 0.3, life: 0.3, delay: r() * 0.2 * K, size: 0.12, frame: F.core, fadeOut: 0.5, noclip: 1 }, HDR(0xffa030, 1.5)); });
      });
      cr.frame(tHurl, 2); flash(tHurl, 0.7); cr.to('x', -0.25, tHurl, 0.08, 'out').to('x', 0, tHurl + 0.1, 0.3, 'io');
      // hurled fireballs: one per victim, landing on its own beat
      vs.forEach((v, i) => {
        const land = T + i * step, fly = land - tHurl;
        cr.at(tHurl, () => { const s0 = hand(-80, 96); const head = { x: s0.x, y: s0.y, z: s0.z };
          this.P(this.add, this.col({ x: 0, y: 0, z: 0, pin: head, life: fly, size: 0.8, frame: F.core, noclip: 1 }, HDR(0xffb040, 1.7)));
          this.mover(s0, v.p.clone().add(new THREE.Vector3(0, 0.6, 0)), fly, { ease: 'in', arc: 0.6, onTick: (p, k, rr) => { head.x = p.x; head.y = p.y; head.z = p.z; for (let j = 0; j < 3; j++) this.P(this.add, this.col({ x: p.x + (rr() - 0.5) * 0.3, y: p.y + (rr() - 0.5) * 0.3, z: p.z + (rr() - 0.5) * 0.3, vy: 0.6, life: 0.3, size: 0.9, size1: 0.15, frame: F.billow, rot: rr() * 6, alpha: 0.85, fadeOut: 1.2, noclip: 1 }, mix(C(0xff6a10), C(0xffb030), rr()))); } });
        });
        if (i === 0) this.timer(land, () => { this.fx_fire(v.p, anchor); });   // the full Fire detonation on the centre (its own comet is the hurled ball)
        else this._strike('fire', v, land, anchor);
        this.victimPop(v, 0xff7a2a, { delay: land });
      });
      this.timer(T, () => this.ringFx(at, 0xff6a14, 0.4, 3.6, 0.6, { alpha: 0.9 }));
      // exit: sinks back into the crack
      const tOut = T + (vs.length - 1) * step + HOLD + 0.3 * K; cr.to('reveal', 1, tOut, 0.35 * K, 'in').to('y', -0.4, tOut, 0.35 * K, 'in'); cr.at(tOut + 0.36 * K, () => cr.kill());
    } else if (id === 'frost_maiden') {
      // an ice crystal grows around the anchor, SHATTERS, she is standing inside it; arms spread (the air freezes),
      // then she exhales Diamond Dust along her extended arm and ice erupts on each victim
      const tCr = 0, tShat = 0.36 * K, tSpread = 0.58 * K, tBlow = 0.84 * K; T = 1.12 * K;
      const PALE = C(0x9fdcff), ICE = C(0x4fb4ff), WI = HDR(0xc8f0ff, 1.4);
      for (let j = 0; j < 9; j++) { const a = j / 9 * 6.2832 + r() * 0.3, rr = 0.35 + r() * 0.25, h = 2.4 + r() * 1.4; const base = { x: anchor.x + Math.cos(a) * rr, y: anchor.y + h * 0.45, z: anchor.z + Math.sin(a) * rr, life: tShat - tCr + 0.02, delay: tCr + j * 0.012, size: 0.2, size1: h, growT: 0.22 * K, ax: 0.42, ay: 1, frame: F.shard, rot: Math.cos(a) * 0.25, fadeIn: 0.02, hold: 0.95, fadeOut: 0.3, noclip: 1 }; this.P(this.norm, this.col({ ...base, alpha: 0.85 }, mix(C(0x2a6ee0), C(0x8fd8ff), r()))); this.P(this.add, this.col({ ...base, alpha: 0.45 }, PALE)); }
      this.light(anchor, 0x7fbfff, 7, 1.9 * K + 0.4, { rise: 0.2, y: 1.8, dist: 5, decay: 1.3 });
      this.decal(anchor, 'frost', { color: 0x9fd8ff, size: 1.0, size1: 3.4, grow: 0.4 * K, life: 2.4 * K + 0.5, hold: 0.6, alpha: 0.85 });
      cr.s.dissolve = 1; cr.to('dissolve', 0, tShat - 0.04, 0.14 * K, 'out'); flash(tShat, 1);
      this.timer(tShat, () => {
        this.burst(this.add, 44, () => { const a = r() * 6.2832, s = 2 + r() * 4; return this.col({ x: anchor.x, y: anchor.y + 0.6 + r() * 2.4, z: anchor.z, vx: Math.cos(a) * s, vy: 0.5 + r() * 3, vz: Math.sin(a) * s, grav: -7, life: 0.6 + r() * 0.4, size: 0.14 + r() * 0.3, ax: 0.5, frame: F.shard, rot: r() * 6, rotv: (r() - 0.5) * 14, fadeOut: 0.9, noclip: 1 }, mix(PALE, ICE, r())); });
        this.P(this.add, this.col({ x: anchor.x, y: anchor.y + 1.8, z: anchor.z, life: 0.3, size: 1, size1: 4.5, frame: F.flare, fadeIn: 0.01, fadeOut: 1.4, alpha: 0.8, noclip: 1 }, WI));
      });
      // snow swirl around her while she is on stage
      this.burst(this.add, 50, () => { const a = r() * 6.2832; return this.col({ x: 0, y: 0, z: 0, orbit: { cx: anchor.x, cz: anchor.z, cy: anchor.y + 0.1 + r() * 0.4, r: 0.8 + r() * 0.7, w: 3 + r() * 2, phase: a, vy: 1.6 + r() * 1.4 }, life: 0.9 + r() * 0.5, delay: tShat + r() * 0.6 * K, size: 0.08 + r() * 0.12, frame: r() < 0.6 ? F.glint : F.star, flick: 0.3, fadeOut: 1, noclip: 1 }, r() < 0.4 ? WI : PALE); });
      cr.frame(tSpread, 1); cr.to('y', 0.15, tSpread, 0.3 * K, 'io');
      cr.frame(tBlow, 2); flash(tBlow, 0.5);
      vs.forEach((v, i) => {
        const land = T + i * step;
        // the Diamond Dust stream: glints flowing from her palm to this victim
        cr.at(tBlow, () => { const s0 = hand(-66, 128); const d = v.p.clone().add(new THREE.Vector3(0, 0.8, 0)).sub(s0); const fly = Math.max(0.12, land - tBlow - 0.02);
          this.burst(this.add, 26, () => { const k0 = r() * 0.25; return this.col({ x: s0.x + d.x * k0, y: s0.y + d.y * k0, z: s0.z + d.z * k0, vx: d.x / fly, vy: d.y / fly, vz: d.z / fly, life: fly * (0.7 + r() * 0.35), delay: r() * 0.12 * K, size: 0.1 + r() * 0.2, frame: r() < 0.5 ? F.glint : F.star, rot: r() * 3, rotv: 6, flick: 0.3, fadeOut: 0.6, noclip: 1 }, r() < 0.5 ? WI : PALE); });
        });
        this._strike('ice', v, land - 0.25, anchor, i === 0);   // her own ice, not fx_ice's giant crystal: she stays the subject
        this.victimPop(v, 0x8fd8ff, { delay: land });
      });
      const tOut = T + (vs.length - 1) * step + HOLD + 0.32 * K; cr.to('dissolve', 1, tOut, 0.35 * K, 'in'); cr.at(tOut + 0.36 * K, () => cr.kill());
      this.burst(this.add, 30, () => this.col({ x: anchor.x + (r() - 0.5) * 1.2, y: anchor.y + 0.3 + r() * 2.6, z: anchor.z + (r() - 0.5) * 1.2, vx: (r() - 0.5) * 0.6, vy: 0.4 + r() * 0.8, life: 0.8, delay: tOut + r() * 0.3 * K, size: 0.1 + r() * 0.14, frame: F.star, flick: 0.4, fadeOut: 1, noclip: 1 }, PALE));
    } else if (id === 'storm_elder') {
      // a storm cloud gathers, a bolt strikes the anchor and the sage is standing in the flash; he raises his staff
      // (the orb crackles), then brings it down: judgement bolts fall on each victim in turn
      const tArrive = 0.22 * K, tRaise = 0.5 * K, tJudge = 0.8 * K; T = 1.02 * K;
      const cloudY = anchor.y + 4.6;
      this.burst(this.norm, 26, () => { const a = r() * 6.2832, rr = r() * 3.2; return this.col({ x: anchor.x + Math.cos(a) * rr, y: cloudY + (r() - 0.5) * 0.6, z: anchor.z + Math.sin(a) * rr, vx: -Math.cos(a) * 0.4, vz: -Math.sin(a) * 0.4, life: 2.0 * K + 0.3, delay: r() * 0.2, size: 1.6 + r() * 1.4, frame: F.smoke, rot: r() * 6, rotv: 0.3, alpha: 0.75, fadeIn: 0.25, hold: 0.7, fadeOut: 1.2, noclip: 1 }, mix(C(0x141a30), C(0x2a3458), r())); });
      this.bolt({ from: anchor.clone().add(new THREE.Vector3(0.3, 12, -0.2)), to: anchor.clone().add(new THREE.Vector3(0, 0.1, 0)), life: 0.3, jitterUntil: 0.2, amp: 0.8, segs: 24, branches: 3, glow: 0x3060e0, core: 0xb0e0ff, widthGlow: 0.6, widthCore: 0.1, depthTest: false, renderOrder: 39, coreBoost: 0.8, delay: tArrive - 0.04 });
      this.light(anchor, 0x6a9aff, 8, 1.8 * K + 0.3, { rise: 0.04, y: 2, dist: 5, flicker: 0.5, decay: 1.4, delay: tArrive - 0.04 });
      this.decal(anchor, 'scorch', { color: 0x000000, size: 0.8, size1: 1.8, grow: 0.1, life: 2.2, hold: 0.5, alpha: 0.5, blending: THREE.NormalBlending, lift: 0.02, delay: tArrive });
      this.ringFx(anchor, 0x6a9aff, 0.3, 2.6, 0.5, { alpha: 0.9, delay: tArrive });
      cr.s.dissolve = 1; cr.to('dissolve', 0, tArrive - 0.02, 0.1 * K, 'out'); flash(tArrive, 1);
      cr.frame(tRaise, 1); flash(tRaise, 0.35); cr.to('y', 0.12, tRaise, 0.2 * K, 'out');
      // crackle on the orb
      cr.at(tRaise + 0.02, () => { const o0 = hand(-18, 212); for (let j = 0; j < 4; j++) this.bolt({ from: o0.clone(), to: o0.clone().add(new THREE.Vector3((r() - 0.5) * 1.8, 0.3 + r() * 1.2, (r() - 0.5) * 1.8)), life: 0.16, jitterUntil: 0.14, amp: 0.25, segs: 8, branches: 0, glow: 0x3060e0, core: 0xb0e0ff, widthGlow: 0.18, widthCore: 0.04, depthTest: false, renderOrder: 39, coreBoost: 0.7, delay: j * 0.06 * K });
        this.P(this.add, this.col({ ...o0, life: (tJudge - tRaise) + 0.2, size: 0.5, size1: 1.4, growT: 0.25, frame: F.core, fadeIn: 0.03, hold: 0.8, fadeOut: 0.4, noclip: 1 }, HDR(0x9ad8ff, 1.6))); });
      cr.frame(tJudge, 2); flash(tJudge, 0.6); cr.to('y', 0, tJudge, 0.15, 'out');
      cr.at(tJudge, () => { const o0 = hand(-76, 116); this.bolt({ from: o0, to: new THREE.Vector3(anchor.x, cloudY, anchor.z), life: 0.25, jitterUntil: 0.2, amp: 0.5, segs: 18, branches: 1, glow: 0x3060e0, core: 0xb0e0ff, widthGlow: 0.3, widthCore: 0.06, depthTest: false, renderOrder: 39, coreBoost: 0.7 }); });
      vs.forEach((v, i) => {
        const land = T + i * step;
        if (i === 0) this.timer(Math.max(0, land - 0.14), () => this.fx_thunder(v.p, anchor)); else this._strike('thunder', v, land, anchor);
        this.victimPop(v, 0xfff07a, { delay: land });
      });
      const tOut = T + (vs.length - 1) * step + HOLD + 0.3 * K; cr.to('dissolve', 1, tOut, 0.3 * K, 'in'); cr.at(tOut + 0.31 * K, () => cr.kill());
    } else if (id === 'hearthling') {
      // floats down on a sparkle puff, bobbing; throws its arms up ("kupo!") and the pom-pom flares; healing
      // sparkles rain on each ally in turn; then it floats away and pops
      const tIn = 0, tCheer = 0.48 * K; T = 0.86 * K;
      cr.s.dissolve = 0; cr.s.y = 3.2; cr.to('y', 0, tIn, 0.42 * K, 'out');
      this.P(this.add, this.col({ x: anchor.x, y: anchor.y + 3.6, z: anchor.z, life: 0.35, size: 0.4, size1: 2.2, frame: F.flare, fadeOut: 1.3, alpha: 0.9, noclip: 1 }, HDR(0xffd0e8, 1.4)));
      this.burst(this.add, 20, () => { const a = r() * 6.2832, s = 1 + r() * 2; return this.col({ x: anchor.x, y: anchor.y + 3.6, z: anchor.z, vx: Math.cos(a) * s, vy: (r() - 0.5) * 2, vz: Math.sin(a) * s, drag: 2, life: 0.6, size: 0.2 + r() * 0.2, frame: F.star, flick: 0.3, fadeOut: 1, noclip: 1 }, r() < 0.5 ? HDR(0xffffff, 1.3) : C(0xffb0d0)); });
      for (let j = 0; j < 6; j++) cr.to('y', (j % 2 ? 0 : 0.12), 0.42 * K + j * 0.16 * K, 0.16 * K, 'io');
      cr.frame(tCheer, 1); flash(tCheer, 0.4); cr.to('sq', 1.08, tCheer, 0.08, 'out').to('sq', 1, tCheer + 0.1, 0.2, 'io');
      cr.at(tCheer, () => { const pp = hand(5, 86); this.P(this.add, this.col({ ...pp, life: 0.5, size: 0.3, size1: 1.6, frame: F.flare, fadeOut: 1.2, noclip: 1 }, HDR(0xff6a8a, 1.6)));
        this.burst(this.add, 10, () => this.col({ x: pp.x + (r() - 0.5), y: pp.y, z: pp.z + (r() - 0.5), vy: 1 + r(), life: 0.8, size: 0.25, frame: F.heart, fadeOut: 1, noclip: 1 }, C(0xff8ab0))); });
      vs.forEach((v, i) => { const land = T + i * step; if (i === 0) this.timer(Math.max(0, land - 0.3), () => this.fx_cure(v.p, anchor, { big: true })); else this._strike('cure', v, land, anchor); this.victimPop(v, 0x8dffae, { delay: land, kind: 'soft' }); });
      const tOut = T + (vs.length - 1) * step + HOLD + 0.35 * K; cr.frame(tOut - 0.1, 2); cr.to('y', 2.6, tOut, 0.4 * K, 'in').to('dissolve', 1, tOut + 0.2 * K, 0.2 * K, 'in'); cr.at(tOut + 0.41 * K, () => cr.kill());
    } else if (id === 'gemfox') {
      // bounds in on an arc from the side, sits; lifts its head and the forehead ruby FLARES; a ray from the gem
      // to each ally raises its Reflect ward in turn; hops out
      const tLand = 0.36 * K, tGem = 0.5 * K; T = 0.84 * K;
      cr.s.dissolve = 0; cr.s.x = 2.4; cr.s.y = 0; cr.to('x', 0, 0, tLand, 'lin'); cr.at(0, () => {});
      for (const [t0, h] of [[0, 1.2]]) { cr.to('y', h, t0, tLand * 0.5, 'out'); cr.to('y', 0, t0 + tLand * 0.5, tLand * 0.5, 'in'); }
      cr.to('sq', 0.86, tLand, 0.06, 'out').to('sq', 1, tLand + 0.07, 0.15, 'back');
      cr.frame(tGem, 1); flash(tGem, 0.3);
      const gem = () => hand(-15, 58);
      cr.at(tGem, () => { const g = gem(); this.P(this.add, this.col({ ...g, life: 0.6, size: 0.3, size1: 2.4, growT: 0.18, frame: F.flare, rotv: 2, fadeIn: 0.02, fadeOut: 1.2, noclip: 1 }, HDR(0xff4a6a, 1.8)));
        this.burst(this.add, 12, (j) => { const a = j / 12 * 6.2832; return this.col({ ...g, life: 0.4, size: 1.6, ax: 1, ay: 0.1, rot: a, frame: F.spark, fadeOut: 1.2, alpha: 0.8, noclip: 1 }, HDR(0xff8aa0, 1.3)); });
        this.light(g, 0xff4a6a, 6, 0.8, { y: 0, dist: 4 }); });
      vs.forEach((v, i) => { const land = T + i * step;
        cr.at(Math.max(tGem + 0.05, land - 0.18), () => { const g = gem(); const d = v.p.clone().add(new THREE.Vector3(0, 0.8, 0)).sub(g); this.burst(this.add, 14, (j) => { const k0 = j / 14; return this.col({ x: g.x + d.x * k0, y: g.y + d.y * k0, z: g.z + d.z * k0, life: 0.22, delay: k0 * 0.12, size: 0.35, frame: F.glint, fadeOut: 1, noclip: 1 }, HDR(0xff9ab0, 1.4)); }); });
        this._strike('reflect', v, land - 0.1, anchor); this.victimPop(v, 0xffa0c0, { delay: land, kind: 'soft' }); });
      const tOut = T + (vs.length - 1) * step + HOLD + 0.3 * K; cr.frame(tOut, 2); cr.to('x', 2.6, tOut, 0.3 * K, 'in').to('y', 0.8, tOut, 0.15 * K, 'out').to('dissolve', 1, tOut + 0.15 * K, 0.15 * K, 'in'); cr.at(tOut + 0.31 * K, () => cr.kill());
    } else if (id === 'wyrm_sovereign') {
      // a ring opens in the sky, the dragon king DESCENDS through it wings high, rears back while energy implodes
      // into his jaws, then MEGA FLARE: a beam from the maw to the target, the nova, and a blast on every victim
      const tDesc = 0, tRear = 0.52 * K, tFlare = 0.92 * K; T = 1.2 * K;
      cr.s.dissolve = 0.9; cr.s.y = 4.5; cr.to('y', 0, tDesc, 0.5 * K, 'out').to('dissolve', 0, tDesc, 0.3 * K, 'out');
      this.P(this.add, this.col({ x: anchor.x, y: anchor.y + 5.5, z: anchor.z, life: 1.2 * K + 0.3, size: 2, size1: 7.5, growT: 0.4, frame: F.ring, fadeIn: 0.1, hold: 0.6, fadeOut: 1, alpha: 0.7, noclip: 1 }, C(0x6a8cff)));
      this.burst(this.add, 40, () => { const a = r() * 6.2832, rr = 3 + r() * 1.5; return this.col({ x: anchor.x + Math.cos(a) * rr, y: anchor.y + 5.5 + (r() - 0.5), z: anchor.z + Math.sin(a) * rr, vy: -3 - r() * 3, life: 0.8, delay: r() * 0.5 * K, size: 0.1 + r() * 0.15, frame: F.glint, flick: 0.3, fadeOut: 1, noclip: 1 }, HDR(0xa0c0ff, 1.3)); });
      this.burst(this.norm, 18, () => { const a = r() * 6.2832, rr = 0.8 + r() * 2.5; return this.col({ x: anchor.x + Math.cos(a) * rr, y: anchor.y - S.lift + 0.1, z: anchor.z + Math.sin(a) * rr, vx: Math.cos(a) * 2, vz: Math.sin(a) * 2, drag: 1.5, life: 1, delay: 0.3 * K, size: 0.8, size1: 1.8, frame: F.dust, rot: r() * 6, alpha: 0.45, fadeOut: 1.4 }, C(0xb0a890)); });
      cr.frame(tRear, 1); cr.to('y', 0.3, tRear, 0.3 * K, 'out');
      const maw = () => hand(-24, 176);
      const core = { x: 0, y: 0, z: 0 };
      cr.at(tRear + 0.05, () => { const m = maw(); core.x = m.x; core.y = m.y; core.z = m.z;
        this.P(this.add, this.col({ x: 0, y: 0, z: 0, pin: core, life: tFlare - tRear, size: 0.2, size1: 1.2, growT: tFlare - tRear, frame: F.core, fadeIn: 0.05, hold: 0.9, fadeOut: 0.2, noclip: 1 }, HDR(0xc0d0ff, 2)));
        this.burst(this.add, 40, () => { const a = r() * 6.2832, el = (r() - 0.5) * 2, rr = 2 + r() * 1.5, dur = 0.25 + r() * 0.1; return this.col({ x: core.x + Math.cos(a) * Math.cos(el) * rr, y: core.y + Math.sin(el) * rr, z: core.z + Math.sin(a) * Math.cos(el) * rr, vx: -Math.cos(a) * Math.cos(el) * rr / dur, vy: -Math.sin(el) * rr / dur, vz: -Math.sin(a) * Math.cos(el) * rr / dur, life: dur, delay: r() * (tFlare - tRear - 0.3) , size: 0.14, frame: F.glint, fadeOut: 0.4, noclip: 1 }, HDR(0x9ab0ff, 1.4)); });
      });
      cr.frame(tFlare, 2); flash(tFlare, 0.6); cr.to('x', 0.2, tFlare, 0.1, 'out').to('x', 0, tFlare + 0.12, 0.3, 'io');
      // the beam: a dense stream of stretched sparks + a fat glow core from maw to target
      cr.at(tFlare, () => { const m = hand(-92, 128); const tgt = at.clone().add(new THREE.Vector3(0, 0.8, 0)); const d = tgt.clone().sub(m); const L = d.length(); const dur = Math.max(0.1, T - tFlare);
        for (let j = 0; j < 14; j++) { const k0 = (j + 0.5) / 14; this.P(this.add, this.col({ x: m.x + d.x * k0, y: m.y + d.y * k0, z: m.z + d.z * k0, vx: d.x * 0.001, vy: d.y * 0.001, vz: d.z * 0.001, life: dur + 0.25, delay: k0 * dur * 0.8, size: L / 10, ax: 1, ay: 0.32, frame: F.glow, align: true, fadeIn: 0.04, hold: 0.6, fadeOut: 1, alpha: 0.9, noclip: 1 }, HDR(0x8fe0ff, 1.3))); }
        this.burst(this.add, 60, () => { const k0 = r(); return this.col({ x: m.x + d.x * k0 * 0.2, y: m.y + d.y * k0 * 0.2, z: m.z + d.z * k0 * 0.2, vx: d.x / dur * (0.9 + r() * 0.2) + (r() - 0.5) * 2, vy: d.y / dur + (r() - 0.5) * 2, vz: d.z / dur + (r() - 0.5) * 2, life: dur * (0.8 + r() * 0.3), delay: r() * dur * 0.6, size: 1.2, ax: 1, ay: 0.14, frame: F.spark, align: true, fadeOut: 0.8, noclip: 1 }, r() < 0.5 ? HDR(0xffffff, 1.4) : HDR(0xb090ff, 1.3)); });
        this.light(m, 0x8fb0ff, 7, dur + 0.3, { y: 0, dist: 4 });
      });
      vs.forEach((v, i) => { const land = T + i * step; if (i === 0) this.timer(Math.max(0, land - 0.55), () => this.fx_flare(v.p, anchor)); else this._strike('wyrm_sovereign', v, land - 0.05, anchor); this.victimPop(v, 0xb0a0ff, { delay: land }); });
      this.timer(T, () => { this.ringFx(at, 0x9fd0ff, 0.5, 5, 0.8, { alpha: 0.9 }); this.wash(0xb0c0ff, 0.12, 0.03, 0.12, 0.5, { at: at.clone().add(new THREE.Vector3(0, 1, 0)), spread: 22 }); });
      const tOut = T + (vs.length - 1) * step + HOLD + 0.35 * K; cr.to('y', 4, tOut, 0.45 * K, 'in').to('dissolve', 1, tOut + 0.1 * K, 0.35 * K, 'in'); cr.at(tOut + 0.46 * K, () => cr.kill());
    }
    this._summonT = T;                                                // play(): the centre hit (impact freeze / grade flash); no second ripple
    // capture beat: the attack gesture with the payload in flight / landing
    this._heroAt = (this._defer || 0) + T - 0.04;
    return T + (vs.length - 1) * step;
  };

  P.updateCreatures = function (dt) {
    const L = this._creatures; if (!L || !L.length) return;
    const cam = this.cam;
    for (let i = L.length - 1; i >= 0; i--) if (!L[i].update(dt, cam)) L.splice(i, 1);
  };
  P.clearCreatures = function () { for (const c of this._creatures || []) c.kill(); if (this._creatures) this._creatures.length = 0; };
  P.skipSummons = function () { for (const c of this._creatures || []) c.skip(); };
  // warm the paint + textures + shader programs off the critical path (the first summon would otherwise stall a frame)
  // one creature frame per idle slice; stops by itself once the roster is painted
  // R20 (review19 P10: the first Pyrelord / Wyrm Sovereign cast still hitched 200-267 ms on the real iGPU): the creatures a unit on
  // the field can actually summon are warmed FIRST and ALL THE WAY -- frames painted (one per idle slice), then the atlas
  // + halo composite (one slice), the two textures uploaded (renderer.initTexture) and the creature shader program linked
  // (renderer.compile on a two-mesh scratch scene) -- starting ~1.2 s after the battle is up, and those textures are kept
  // resident while the battle lasts. The rest of the roster is only painted, later, as before.
  P.warmSummons = function () {
    if (typeof window === 'undefined') return;
    const idle = window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 1500 }) : (fn) => setTimeout(fn, 200);
    const present = () => {
      const b = this.battle; const out = [];
      for (const u of b?.units || []) { if (u.removed) continue; for (const a of u.abilityList || []) { const S = SUMMON[a]; if (S && !out.includes(S.art)) out.push(S.art); } }
      return out;
    };
    const full = (key) => {
      const T = textures(key); if (!T) return;
      if (!T.pinned) { T.pinned = true; retain(key); }   // resident for the battle: an exit + recast never repaints
      const R = window.__GAME__?.renderer; if (!R) return;
      try { R.initTexture?.(T.body); R.initTexture?.(T.glow); } catch (e) { /* older three: first draw uploads */ }
      try {
        const cam = this.cam || window.__GAME__?.camera?.cam; if (!cam) return;
        const tmp = new THREE.Scene(); const cr = new Creature({ scene: tmp }, key, new THREE.Vector3(), {});
        if (cr.ok) { cr.body.visible = cr.glow.visible = true; R.compile(tmp, cam); cr.kill(); }
      } catch (e) { console.warn('summon precompile', e); }
    };
    let keys = null, done = new Set();
    const step = () => {
      let more = false;
      try {
        if (!keys) keys = present();
        const need = keys.filter((k) => !done.has(k));
        if (need.length) {
          if (warmStep(need)) more = true;                              // frames of the summons in play first
          else { full(need[0]); done.add(need[0]); more = true; }       // then one creature's composite+upload+compile per slice
        } else more = warmStep();                                        // the rest of the roster: paint only
      } catch (e) { console.warn('summon warm', e); return; }
      if (more) idle(step);
    };
    // a summon being CHARGED (ct 4) that nobody was known to carry (a scenario, a borrowed skill) is warmed now: its cast
    // is at least one turn away
    this.battle?.on?.('charge', ({ id }) => { const S = SUMMON[id]; if (!S || done.has(S.art)) return; if (!keys) keys = present(); if (!keys.includes(S.art)) keys.push(S.art); idle(step); });
    // attach() runs before the units are placed: look for conjurers once the battle is up
    const kick = (tries) => { if (!this.battle?.units?.length && tries < 30) { setTimeout(() => kick(tries + 1), 400); return; } keys = present(); if (keys.length) idle(step); else setTimeout(() => idle(step), 8800); };
    setTimeout(() => kick(0), 1200);
  };
}
