import * as THREE from 'three';
import { F } from './atlas.js';
import { helixPts } from './ribbon.js';
// R13 HEAL / WARD / STATUS family. Installed onto VFX.prototype by effects.js (installStatusFx).
// Critique going in: Cure read as a faint green glow at the feet, Haste was gone by +0.5 s, Protect and Shell were
// the same gold ellipse, and most debuffs were a tinted puff. the genre marks every one of these with a SHAPE you can
// name from across the room, so each effect here is built round one signature silhouette:
//   Cure      green-white stars spiral DOWN onto the body inside a soft column, the body glows, motes rise after
//   Raise     (effects.js) gold rain + feathered column          Purify/Remedy  white-cyan cleansing crosses rise
//   Haste     a cyan clock spinning fast over the head + speed streaks and climbing rings
//   Slow      a blue clock turning lazily, rings SINK down the body       Stop  a grey-cyan hourglass + frozen shards
//   Protect   gold hexagon plates fly in and lock into a shell            Shell a teal bubble dome with bands
//   Reflect   lilac mirror panes orbit the body                           Poison green/violet bubbles boil + pop
//   Sleep     Z glyphs drift up off the head                              Silence a 'mute' sign clamps over the head
//   Blind     an ink band wraps the eyes                                  Charm  hearts spiral up, one big heart
//   Fear/Curse a violet skull rises out of dark tendrils
// Timing contract (captureHold pins play() return + 0.22 s): every effect peaks at ~0.45-0.6 s and keeps a tail to
// ~1.5 s. Peak light is kept low (<= 9) -- the walls behind a target clip long before the particles do.
const C = (h) => new THREE.Color(h);
const HDR = (h, k) => new THREE.Color(h).multiplyScalar(k);
const mix = (a, b, k) => a.clone().lerp(b, k);
const up = (at, y) => at.clone().add(new THREE.Vector3(0, y, 0));

export function installStatusFx(VFX) {
  const P = VFX.prototype;

  // Over-the-head status icon: pops in with an overshoot (size -> size1 over growT), bobs, holds, fades.
  P.icon = function (at, frame, color, { y = 2.15, size = 1.0, delay = 0.12, life = 1.35, rot = 0, rotv = 0, alpha = 1, occ = 0.2, vy = 0.12, side = 0 } = {}) {
    const o = this.off(at, y, side); const col = color.isColor ? color : C(color);
    // Read on ANY background: a dark soft backing, the glyph itself in NORMAL blend (an additive-only cyan clock
    // vanished into a lit plaster window: cyan + near-white = white), and a thin additive copy on top for the glow.
    this.P(this.norm, this.col({ ...o, vy, life: life * 0.95, delay, size: size * 0.3, size1: size * 1.3, growT: 0.14, frame: F.glow, fadeIn: 0.05, hold: 0.5, fadeOut: 1.5, alpha: 0.75 * alpha, zb: 2.2 }, mix(col, C(0x000000), 0.88)));
    this.P(this.norm, this.col({ ...o, vy, life, delay, size: size * 0.2, size1: size, growT: 0.16, frame, rot, rotv, fadeIn: 0.04, hold: 0.6, fadeOut: 1.6, alpha: 0.95 * alpha, zb: 2.25 }, mix(col, C(0xffffff), 0.1)));
    this.P(this.add, this.col({ ...o, vy, life: life * 0.9, delay, size: size * 1.9, size1: size * 1.35, growT: 0.14, frame: F.glow, fadeIn: 0.05, hold: 0.45, fadeOut: 1.4, alpha: 0.14 * alpha, occ: 0.1, zb: 2.2 }, col));
    return this.P(this.add, this.col({ ...o, vy, life, delay, size: size * 0.2, size1: size, growT: 0.16, frame, rot, rotv, fadeIn: 0.04, hold: 0.6, fadeOut: 1.6, alpha: 0.45 * alpha, occ, zb: 2.3 }, col));
  };
  // soft light on the body (sprites are unlit; this is the 'the unit is glowing' read)
  P.bodyGlow = function (at, color, { alpha = 0.5, life = 1.3, delay = 0.1, size = 1.5, y = 0.8 } = {}) {
    this.P(this.add, this.col({ x: at.x, y: at.y + y, z: at.z, life, delay, size: size * 0.6, size1: size, growT: 0.3, ax: 0.8, ay: 1.2, frame: F.glow, fadeIn: 0.2, hold: 0.4, fadeOut: 1.5, alpha, occ: 0.18 }, color));
  };

  // ---------------- CURE ----------------
  // o.big (Mending Light / Soothing Gale / Hearthling): two counter-rotating streams, a taller column, a second ring.
  // o.small (Potion / First Aid): half the stars, no column.   o.cleanse (Purify / Remedy): white-cyan crosses rise.
  P.fx_cure = function (at, src, o = {}) {
    const g = at;
    const r = this.rnd; const big = !!o.big, small = !!o.small;
    const hex = o.color || 0x46ff8a;
    const G = C(hex), MINT = mix(C(hex), C(0xe0fff0), 0.55), W = HDR(o.color || 0xd4ffe6, 1.45), DEEP = mix(C(hex), C(0x00a050), 0.4);
    this.light(g, hex, big ? 6 : 5, 1.5, { rise: 0.35, y: 1.0, dist: 3.0, decay: 1.6 });
    if (!small) this.wash(hex, big ? 0.1 : 0.07, 0.25, 0.3, 0.6, { at: up(at, 1.0), spread: 14 });
    // anticipation (0-0.4 s): stars appear in a crown ABOVE the head and spiral down, closing in onto the body
    const N = small ? 10 : big ? 30 : 20, streams = big ? 2 : 1;
    for (let i = 0; i < N; i++) {
      const s = i % streams ? -1 : 1, k = i / N;
      this.P(this.add, this.col({ x: at.x, y: at.y + 3, z: at.z, orbit: { cx: at.x, cy: at.y + 2.7 + (i % 3) * 0.22, cz: at.z, r: 0.95 + (i % 2) * 0.15, dr: -1.3, r0: 0.18, w: s * (4.2 + (i % 3) * 0.5), phase: k * 6.2832 * 2, vy: -3.2, ay: 1.6 }, life: 0.8, delay: k * 0.38, size: (i % 3 === 0 ? 0.62 : 0.4) + r() * 0.2, frame: F.star, rot: r() * 0.4, rotv: 1.5, flick: 0.2, fadeIn: 0.1, hold: 0.55, fadeOut: 1.4, alpha: 1, occ: 0.05 }, i % 2 ? W : MINT));
      // a comet tail for every other star
      if (i % 2 === 0) this.P(this.add, this.col({ x: at.x, y: at.y + 3, z: at.z, orbit: { cx: at.x, cy: at.y + 2.78 + (i % 3) * 0.22, cz: at.z, r: 1.0 + (i % 2) * 0.15, dr: -1.3, r0: 0.2, w: s * (4.2 + (i % 3) * 0.5), phase: k * 6.2832 * 2 - 0.35, vy: -3.2, ay: 1.6 }, life: 0.75, delay: k * 0.38 + 0.03, size: 0.18, frame: F.glint, flick: 0.3, fadeIn: 0.1, hold: 0.5, fadeOut: 1.4, alpha: 0.8 }, G));
    }
    // falling sparkle rain onto the body
    this.burst(this.add, small ? 14 : big ? 44 : 28, () => { const a = r() * 6.2832, rr = r() * (big ? 0.85 : 0.6); return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 2.2 + r() * 1.2, z: at.z + Math.sin(a) * rr, vy: -1.2 - r() * 1.4, life: 0.6 + r() * 0.4, delay: 0.05 + r() * 0.55, size: 0.1 + r() * 0.2, frame: r() < 0.4 ? F.star : F.glint, rot: r(), flick: 0.5, fadeIn: 0.15, fadeOut: 1.2, drag: 0.3 }, r() < 0.5 ? W : MINT); });
    if (!small) {
      // the soft column: a mint shaft with a pale core line
      const H = big ? 3.8 : 3.0;
      this.P(this.add, this.col({ x: at.x, y: at.y + H / 2, z: at.z, life: 1.45, delay: 0.05, size: 0.5, size1: H, growT: 0.35, ax: big ? 0.5 : 0.4, ay: 1, frame: F.glow, fadeIn: 0.2, hold: 0.45, fadeOut: 1.5, alpha: 0.5, occ: 0.22 }, G));
      this.P(this.add, this.col({ x: at.x, y: at.y + H / 2, z: at.z, life: 1.35, delay: 0.12, size: 0.3, size1: H * 0.95, growT: 0.4, ax: 0.1, ay: 1, frame: F.glow, fadeIn: 0.2, hold: 0.4, fadeOut: 1.5, alpha: 0.55, occ: 0.1 }, MINT));
    }
    this.bodyGlow(at, MINT, { alpha: big ? 0.6 : 0.5, delay: 0.25, life: 1.3 });
    // arrival bloom (~0.4 s): a soft mint flare on the chest, ring rolls out on the ground
    this.timer(0.38, () => {
      this.P(this.add, this.col({ x: at.x, y: at.y + 0.95, z: at.z, life: 0.55, size: 0.4, size1: big ? 2.3 : 1.8, growT: 0.14, frame: F.flare, fadeIn: 0.03, hold: 0.2, fadeOut: 1.4, alpha: 0.85, rot: 0.2, occ: 0.12 }, W));
      this.ringFx(g, o.color || 0x9dffc0, 0.25, big ? 2.3 : 1.7, 0.7, { alpha: 0.9 });
      if (big) this.ringFx(g, hex, 0.2, 1.6, 0.8, { alpha: 0.6, delay: 0.12 });
      // cleanse: white-cyan crosses lift off the body (Purify / Remedy); plain heals get a few small green crosses
      const nP = o.cleanse ? 7 : small ? 2 : 4;
      this.burst(this.add, nP, (i) => { const a = i / nP * 6.2832 + r(), rr = 0.3 + r() * 0.3; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.6 + r() * 0.6, z: at.z + Math.sin(a) * rr, vy: 0.7 + r() * 0.5, life: 1.0 + r() * 0.3, delay: i * 0.06, size: o.cleanse ? 0.34 : 0.24, size1: o.cleanse ? 0.26 : 0.18, frame: F.plus, fadeIn: 0.12, hold: 0.4, fadeOut: 1.5, drag: 0.6, alpha: 0.95, occ: 0.15 }, o.cleanse ? HDR(0xe8fbff, 1.2) : mix(G, W, 0.5)); });
    });
    // tail (0.6-1.7 s): small motes keep rising off the healed body
    this.burst(this.add, small ? 10 : 22, () => { const a = r() * 6.2832, rr = 0.15 + r() * 0.45; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.1 + r() * 0.8, z: at.z + Math.sin(a) * rr, vy: 0.6 + r() * 0.8, life: 0.7 + r() * 0.5, delay: 0.55 + r() * 0.5, size: 0.08 + r() * 0.12, frame: F.glint, flick: 0.5, fadeIn: 0.2, fadeOut: 1.2, drag: 0.3 }, r() < 0.5 ? W : G); });
    this.decal(g, 'soft', { color: o.color || 0x3ce07a, size: 0.8, size1: big ? 2.8 : 2.2, grow: 0.45, life: 1.7, hold: 0.45, alpha: 0.7 });
    return 0.32;
  };

  // ---------------- clocks: HASTE / SLOW / STOP ----------------
  // HASTE / Quick / Yell: a cyan clock spins FAST over the head, speed streaks and rings race up the body.
  P.fx_haste = function (at, src, o = {}) {
    const g = at;
    const r = this.rnd; const hex = o.color || 0x6ff0ff; const CY = C(hex), W = HDR(0xe8ffff, 1.3), GOLD = C(0xffe28a);
    this.light(g, hex, 6, 1.4, { rise: 0.1, y: 1.0, dist: 3.0, decay: 1.6 });
    this.decal(g, 'glyph', { color: hex, size: 0.5, size1: 2.1, grow: 0.25, life: 1.6, hold: 0.55, alpha: 0.9, spin: 7.0 });
    this.icon(at, F.clock, C(0x22c4f4), { y: 2.2, size: 1.1, delay: 0.1, life: 1.5, rotv: -14 });   // deeper cyan: must read over a lit window too
    // the clock's hands trail: two afterimages lagging the spin
    for (let i = 1; i <= 2; i++) this.P(this.add, this.col({ ...this.off(at, 2.2), vy: 0.12, life: 1.3, delay: 0.14, size: 0.2, size1: 1.05, growT: 0.16, frame: F.clock, rot: i * 0.35, rotv: -14, fadeIn: 0.05, hold: 0.5, fadeOut: 1.6, alpha: 0.28 / i, zb: 2.2 }, CY));
    this.burst(this.add, 40, () => { const a = r() * 6.2832, rr = 0.3 + r() * 0.4; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + r() * 0.5, z: at.z + Math.sin(a) * rr, vy: 4.8 + r() * 3, life: 0.3 + r() * 0.2, size: 0.7 + r() * 0.5, size1: 0.2, ax: 1, ay: 0.14, frame: F.spark, align: true, delay: r() * 1.0, fadeOut: 1.3, alpha: 0.85 }, r() < 0.3 ? W : r() < 0.2 ? GOLD : CY); });
    for (let i = 0; i < 5; i++) this.P(this.add, this.col({ x: at.x, y: at.y + 0.1, z: at.z, vy: 3.0, life: 0.55, delay: 0.05 + i * 0.2, size: 1.7, size1: 0.9, ax: 1, ay: 0.3, frame: F.ring, fadeOut: 1.3, alpha: 0.75 }, i % 2 ? W : CY));
    this.bodyGlow(at, CY, { alpha: 0.35, life: 1.3 });
    return 0.28;
  };
  // SLOW / Hex / Immobilize: a blue clock turning LAZILY, heavy rings sink down the body, drowsy motes fall.
  P.fx_slowtime = function (at, src, o = {}) {
    const g = at;
    if (o.status === 'stop') return this.fx_stoptime(g, src, o);
    const r = this.rnd; const hex = o.color || 0x5a86ff; const B = C(hex), PALE = C(0xc8dcff), W = HDR(0xc8dcff, 1.2);
    this.light(g, hex, 6, 1.5, { rise: 0.25, y: 1.0, dist: 3.0, decay: 1.6 });
    this.decal(g, 'glyph', { color: hex, size: 2.4, size1: 1.8, grow: 1.0, life: 1.7, hold: 0.6, alpha: 0.9, spin: -0.8 });
    this.icon(at, F.clock, mix(B, PALE, 0.35), { y: 2.2, size: 1.05, delay: 0.08, life: 1.6, rotv: -1.2, vy: -0.05 });
    for (let i = 0; i < 4; i++) this.P(this.add, this.col({ x: at.x, y: at.y + 2.0, z: at.z, vy: -1.3, drag: 0.6, life: 1.0, delay: 0.05 + i * 0.22, size: 1.1, size1: 1.7, ax: 1, ay: 0.3, frame: F.ring, fadeIn: 0.15, fadeOut: 1.3, alpha: 0.75 }, i % 2 ? PALE : B));
    this.burst(this.add, 26, () => { const a = r() * 6.2832, rr = 0.3 + r() * 0.5; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 1.6 + r() * 0.8, z: at.z + Math.sin(a) * rr, vy: -0.5 - r() * 0.4, life: 1.1 + r() * 0.4, delay: r() * 0.6, size: 0.1 + r() * 0.14, frame: F.glint, flick: 0.3, fadeIn: 0.2, fadeOut: 1.3 }, r() < 0.4 ? W : B); });
    this.bodyGlow(at, B, { alpha: 0.35, life: 1.4 });
    return 0.3;
  };
  // STOP: time freezes -- a grey-cyan hourglass hangs over the head, a ring of ice-still shards locks round the body.
  P.fx_stoptime = function (at, src, o = {}) {
    const g = at;
    const r = this.rnd; const B = C(0x9fc4e8), PALE = C(0xe4f0ff), W = HDR(0xe8f4ff, 1.3);
    this.light(g, 0xa8c8f0, 6, 1.5, { rise: 0.1, y: 1.0, dist: 3.0, decay: 1.6 });
    this.decal(g, 'ring', { color: 0xc8e0ff, size: 3.0, size1: 1.3, grow: 0.35, life: 1.4, hold: 0.5, alpha: 0.9 });
    this.decal(g, 'glyph', { color: 0x9fc4e8, size: 1.8, size1: 1.8, grow: 0.1, life: 1.6, hold: 0.6, alpha: 0.7, spin: 0 });
    this.icon(at, F.hourglass, mix(B, PALE, 0.5), { y: 2.2, size: 0.95, delay: 0.08, life: 1.6 });
    this.P(this.add, this.col({ x: at.x, y: at.y + 0.9, z: at.z, life: 0.3, delay: 0.3, size: 0.4, size1: 1.9, frame: F.flare, fadeOut: 1.3, alpha: 0.7, rot: 0.2 }, W));
    for (let i = 0; i < 14; i++) { const a = i / 14 * 6.2832; this.P(this.add, this.col({ x: at.x + Math.cos(a) * 0.62, y: at.y + 0.25 + (i % 4) * 0.42, z: at.z + Math.sin(a) * 0.62, life: 1.4, delay: 0.1 + i * 0.02, size: 0.05, size1: 0.3, growT: 0.25, ax: 0.6, ay: 1, frame: F.shard, rot: a, fadeIn: 0.1, hold: 0.6, fadeOut: 1.8, alpha: 0.9 }, i % 2 ? B : PALE)); }
    this.bodyGlow(at, PALE, { alpha: 0.4, life: 1.5 });
    return 0.3;
  };

  // ---------------- wards: PROTECT / SHELL / REFLECT ----------------
  P.fx_shield = function (at, src, o = {}) {
    const g = at;
    if (o.status === 'shell') return this.fx_shell(g, src, o);
    if (o.status === 'reflect') return this.fx_reflect(g, src, o);
    // PROTECT: gold hexagon plates fly in from all round and lock into a shell, flash once, hold, fade.
    const r = this.rnd; const hex = o.color || 0xffc848; const G = C(hex), W = HDR(0xfff0c0, 1.25);
    this.light(g, hex, 3, 1.5, { rise: 0.25, y: 1.0, dist: 3.0, decay: 1.6 });
    this.decal(g, 'glyph', { color: hex, size: 0.4, size1: 2.1, grow: 0.3, life: 1.6, hold: 0.55, alpha: 0.9, spin: 1.0 });
    const cx = at.x, cy = at.y + 0.85, cz = at.z;
    for (let i = 0; i < 20; i++) {
      const el = ((i % 4) - 1.5) * 0.52, a = i / 20 * 6.2832 * 2 + (i % 2) * 0.4, R = 0.98;   // a cage the body reads THROUGH
      const p1 = { x: cx + Math.cos(a) * Math.cos(el) * R, y: cy + Math.sin(el) * R * 1.25, z: cz + Math.sin(a) * Math.cos(el) * R };
      const p0 = { x: cx + Math.cos(a) * 2.0, y: cy + Math.sin(el) * 2.0 + 0.6, z: cz + Math.sin(a) * 2.0 };
      const head = { ...p0 };
      // R13: the plates are OPAQUE-ish amber in normal blend with an additive gold rim on top -- an additive-only plate
      // vanished against the lit plaster wall that stands behind most ally targets
      this.P(this.norm, this.col({ ...head, life: 1.45, delay: i * 0.018, size: 0.5, size1: 0.42, frame: F.hex, pin: head, fadeIn: 0.06, hold: 0.55, fadeOut: 1.6, alpha: 0.7 }, C(i % 3 ? 0x8a4c08 : 0xb07018)));
      this.P(this.add, this.col({ ...head, life: 1.45, delay: i * 0.018, size: 0.5, size1: 0.42, frame: F.hex, pin: head, fadeIn: 0.06, hold: 0.55, fadeOut: 1.6, alpha: 0.6, occ: 0 }, i % 3 ? G : mix(G, C(0xffffff), 0.35)));
      this.mover(p0, p1, 0.3, { delay: i * 0.018, ease: 'out', onTick: (pos) => { head.x = pos.x; head.y = pos.y; head.z = pos.z; } });
    }
    this.timer(0.34, () => {
      this.P(this.add, this.col({ x: cx, y: cy, z: cz, life: 0.35, size: 1.6, size1: 2.6, frame: F.hex, fadeOut: 1.4, alpha: 0.5, occ: 0.1 }, W));
      this.P(this.add, this.col({ x: cx, y: cy, z: cz, life: 0.35, size: 0.4, size1: 1.8, frame: F.flare, fadeOut: 1.3, alpha: 0.6 }, W));
      this.burst(this.add, 18, () => { const a = r() * 6.2832, el = (r() - 0.5) * 2; return this.col({ x: cx + Math.cos(a) * 0.75, y: cy + el * 0.6, z: cz + Math.sin(a) * 0.75, vy: 0.4 + r() * 0.4, life: 0.6 + r() * 0.5, delay: r() * 0.4, size: 0.1 + r() * 0.14, frame: F.glint, flick: 0.5 }, W); });
    });
    return 0.32;
  };
  // SHELL: a teal bubble dome swells round the unit, three bands of light circle it, glints skate the surface.
  P.fx_shell = function (at, src, o = {}) {
    const g = at;
    const r = this.rnd; const T = C(0x4cf0c8), PALE = C(0xc8fff0), W = HDR(0xd8fff4, 1.25);
    this.light(g, 0x4cf0c8, 7, 1.5, { rise: 0.25, y: 1.0, dist: 3.0, decay: 1.6 });
    this.decal(g, 'ring', { color: 0x4cf0c8, size: 0.4, size1: 1.9, grow: 0.3, life: 1.6, hold: 0.55, alpha: 0.8 });
    this.P(this.add, this.col({ x: at.x, y: at.y + 0.85, z: at.z, life: 1.5, delay: 0.05, size: 0.3, size1: 2.05, growT: 0.3, ax: 0.92, ay: 1.08, frame: F.bubble, fadeIn: 0.05, hold: 0.55, fadeOut: 1.6, alpha: 0.95, occ: 0.15 }, T));
    this.P(this.add, this.col({ x: at.x, y: at.y + 0.85, z: at.z, life: 1.4, delay: 0.08, size: 0.3, size1: 2.0, growT: 0.3, ax: 0.92, ay: 1.08, frame: F.glow, fadeIn: 0.1, hold: 0.45, fadeOut: 1.6, alpha: 0.28, occ: 0.1 }, T));
    for (const [ph, h] of [[0, 0.35], [2.1, 0.85], [4.2, 1.35]]) this.ribbon(helixPts(up(at, h), { turns: 1.0, h: 0.0001, r: 0.82, segs: 64, phase: ph, dir: 1 }), { color: 0x3cd8b0, core: 0xd8fff4, width: 0.07, life: 1.35, reveal: 0.4, hold: 0.55, renderOrder: 22 });
    this.burst(this.add, 22, () => { const a = r() * 6.2832, el = (r() - 0.5) * 2.2; return this.col({ x: at.x, y: at.y + 0.85, z: at.z, orbit: { cx: at.x, cy: at.y + 0.85 + Math.sin(el) * 0.8, cz: at.z, r: Math.cos(el * 0.5) * 0.9, w: 3 * (r() < 0.5 ? 1 : -1), phase: a, vy: 0 }, life: 0.8 + r() * 0.5, delay: 0.2 + r() * 0.5, size: 0.12 + r() * 0.14, frame: F.glint, flick: 0.4, fadeIn: 0.1 }, r() < 0.5 ? W : PALE); });
    this.timer(0.34, () => this.P(this.add, this.col({ x: at.x, y: at.y + 0.85, z: at.z, life: 0.3, size: 1.7, size1: 2.4, ax: 0.92, ay: 1.08, frame: F.bubble, fadeOut: 1.4, alpha: 0.7 }, W)));
    return 0.32;
  };
  // REFLECT: lilac mirror panes orbit the unit, a prism flare glances off them.
  P.fx_reflect = function (at, src, o = {}) {
    const g = at;
    const r = this.rnd; const L = C(0xd8a8ff), PALE = C(0xf4e8ff), W = HDR(0xf4e8ff, 1.3), CY = C(0x9fe8ff);
    this.light(g, 0xd0a8ff, 7, 1.5, { rise: 0.2, y: 1.0, dist: 3.0, decay: 1.6 });
    this.decal(g, 'glyph', { color: 0xc090ff, size: 0.4, size1: 2.0, grow: 0.3, life: 1.6, hold: 0.55, alpha: 0.85, spin: -1.6 });
    for (let i = 0; i < 8; i++) this.P(this.add, this.col({ x: at.x, y: at.y + 0.9, z: at.z, orbit: { cx: at.x, cy: at.y + 0.45 + (i % 2) * 0.75, cz: at.z, r: 1.6, dr: -2.8, r0: 0.78, w: 2.6, phase: i / 8 * 6.2832, vy: 0 }, life: 1.45, delay: i * 0.02, size: 0.2, size1: 0.62, growT: 0.3, ax: 0.62, ay: 1, frame: F.shard, fadeIn: 0.06, hold: 0.55, fadeOut: 1.6, alpha: 0.9, occ: 0.25 }, i % 2 ? L : PALE));
    this.timer(0.36, () => {
      this.P(this.add, this.col({ x: at.x, y: at.y + 1.0, z: at.z, life: 0.4, size: 0.4, size1: 2.2, frame: F.flare, rot: 0.3, fadeOut: 1.3, alpha: 0.7 }, W));
      this.burst(this.add, 14, () => { const a = r() * 6.2832; return this.col({ x: at.x, y: at.y + 1.0, z: at.z, vx: Math.cos(a) * 2.6, vy: (r() - 0.3) * 1.5, vz: Math.sin(a) * 2.6, life: 0.3 + r() * 0.2, size: 0.7, size1: 0.2, ax: 1, ay: 0.14, frame: F.spark, align: true, drag: 3, fadeOut: 1.2 }, r() < 0.5 ? CY : L); });
    });
    this.bodyGlow(at, L, { alpha: 0.35, delay: 0.3 });
    return 0.32;
  };

  // ---------------- debuffs ----------------
  // POISON: green/violet bubbles boil up off the body and POP; a sickly miasma and puddle.
  P.fx_poison = function (at, src) {
    const g = at;
    const r = this.rnd; const G = C(0x7cff4a), V2 = C(0xb060ff), W = HDR(0xd8ffb0, 1.2);
    this.light(g, 0x7cff5a, 6, 1.5, { rise: 0.2, y: 0.6, dist: 2.8, decay: 1.6 });
    this.decal(g, 'soft', { color: 0x2a6a14, size: 0.6, size1: 2.0, grow: 0.4, life: 2.0, hold: 0.5, alpha: 0.8, blending: THREE.NormalBlending });
    this.decal(g, 'soft', { color: 0x6a2aa0, size: 0.5, size1: 1.4, grow: 0.5, life: 1.6, hold: 0.4, alpha: 0.5 });
    this.burst(this.norm, 14, () => { const a = r() * 6.2832, rr = r() * 0.45; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.3 + r() * 0.8, z: at.z + Math.sin(a) * rr, vy: 0.3 + r() * 0.4, life: 1.2 + r() * 0.4, size: 0.45, size1: 1.1, frame: F.smoke, rot: r() * 6.28, rotv: (r() - 0.5), alpha: 0.4, delay: r() * 0.3, fadeIn: 0.25, fadeOut: 1.6, drag: 1 }, r() < 0.5 ? C(0x2c5a1a) : C(0x3a1a52)); });
    // bubbles: grow as they rise, then pop into a ring of droplets
    this.burst(this.add, 26, () => { const a = r() * 6.2832, rr = 0.15 + r() * 0.45, big = r() < 0.35; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.2 + r() * 0.9, z: at.z + Math.sin(a) * rr, vx: (r() - 0.5) * 0.25, vy: 0.5 + r() * 0.7, vz: (r() - 0.5) * 0.25, life: 0.55 + r() * 0.5, delay: r() * 1.0, size: 0.08, size1: big ? 0.5 : 0.28, growT: 0.5, frame: F.bubble, fadeIn: 0.08, hold: 0.7, fadeOut: 3, alpha: 1, occ: 0.15 }, r() < 0.62 ? G : V2); });
    this.burst(this.add, 18, () => { const a = r() * 6.2832; return this.col({ x: at.x + Math.cos(a) * 0.3, y: at.y + 1.1 + r() * 0.6, z: at.z + Math.sin(a) * 0.3, vx: Math.cos(a) * 1.2, vy: 0.6 + r(), vz: Math.sin(a) * 1.2, grav: -4, life: 0.4, delay: 0.3 + r() * 0.7, size: 0.1, frame: F.core, fadeOut: 1 }, r() < 0.6 ? G : V2); });
    this.icon(at, F.bubble, mix(G, V2, 0.25), { y: 2.1, size: 0.75, delay: 0.1, life: 1.4 });
    this.bodyGlow(at, mix(G, V2, 0.3), { alpha: 0.4 });
    return 0.3;
  };
  // SLEEP / Nightmare: Z glyphs float up off the head, a violet haze settles DOWN, the body dims blue.
  P.fx_sleep = function (at, src) {
    const g = at;
    const r = this.rnd; const B = C(0x8aa0ff), V2 = C(0xc8a0ff), W = HDR(0xe8e4ff, 1.1);
    this.light(g, 0x8aa8ff, 5, 1.6, { rise: 0.4, y: 1.2, dist: 2.6, decay: 1.6 });
    const R = this.camRight();
    for (let i = 0; i < 3; i++) { const o = this.off(at, 1.75 + i * 0.05, 0.1 + i * 0.12); this.P(this.add, this.col({ ...o, vx: R.x * 0.32, vz: R.z * 0.32, vy: 0.55, life: 1.3, delay: 0.05 + i * 0.2, size: 0.15, size1: 0.45 + i * 0.16, growT: 0.3, frame: F.zee, rot: -0.2 + i * 0.1, fadeIn: 0.1, hold: 0.5, fadeOut: 1.5, alpha: 1, occ: 0.2 }, i === 1 ? W : mix(B, V2, i * 0.5))); }
    this.burst(this.add, 20, () => { const a = r() * 6.2832, rr = 0.3 + r() * 0.5; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 1.9 + r() * 0.6, z: at.z + Math.sin(a) * rr, vx: -Math.cos(a) * 0.25, vy: -0.7 - r() * 0.4, vz: -Math.sin(a) * 0.25, life: 1.1 + r() * 0.4, size: 0.1 + r() * 0.16, frame: r() < 0.5 ? F.star : F.glint, delay: r() * 0.4, flick: 0.3, fadeIn: 0.3, fadeOut: 1.4, drag: 0.8 }, r() < 0.4 ? W : r() < 0.5 ? B : V2); });
    this.burst(this.norm, 8, () => { const a = r() * 6.2832, rr = r() * 0.4; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 1.8, z: at.z + Math.sin(a) * rr, vy: -0.5, life: 1.3, size: 0.5, size1: 1.2, frame: F.smoke, rot: r() * 6.28, alpha: 0.3, delay: r() * 0.3, fadeIn: 0.3, fadeOut: 1.6, drag: 0.8 }, C(0x302850)); });
    this.bodyGlow(at, B, { alpha: 0.4, life: 1.5 });
    return 0.3;
  };
  // SILENCE / Disable: a 'mute' sign clamps down over the head, grey rings close in, a muffled puff.
  P.fx_silence = function (at, src, o = {}) {
    const g = at;
    const r = this.rnd; const G = C(o.color || 0xd0d0e8), W = HDR(0xf4f4ff, 1.1);
    this.light(g, 0xc0c0e0, 5, 1.2, { rise: 0.1, y: 1.3, dist: 2.4 });
    for (let i = 0; i < 3; i++) this.P(this.add, this.col({ ...this.off(at, 1.35), life: 0.45, delay: i * 0.1, size: 2.0, size1: 0.5, frame: F.ring, fadeIn: 0.05, hold: 0.3, fadeOut: 1.2, alpha: 0.8 }, i === 1 ? W : G));
    this.icon(at, F.mute, mix(G, C(0xff8080), 0.25), { y: 2.1, size: 0.85, delay: 0.25, life: 1.35 });
    this.burst(this.norm, 10, () => { const a = r() * 6.2832; return this.col({ x: at.x + Math.cos(a) * 0.3, y: at.y + 1.25, z: at.z + Math.sin(a) * 0.3, vx: Math.cos(a) * 0.4, vy: 0.3, vz: Math.sin(a) * 0.4, life: 0.9, size: 0.3, size1: 0.8, frame: F.smoke, alpha: 0.4, delay: 0.3 + r() * 0.1, fadeIn: 0.1, fadeOut: 1.5, drag: 1 }, C(0x8a8a9c)); });
    return 0.3;
  };
  // BLIND: an ink band wraps across the eyes and a black cloud swallows the head; dim violet sparks die inside.
  P.fx_blind = function (at, src) {
    const g = at;
    const r = this.rnd;
    this.light(g, 0x8070a0, 4, 1.2, { rise: 0.1, y: 1.3, dist: 2.2 });
    this.burst(this.norm, 16, () => { const a = r() * 6.2832, rr = r() * 0.3; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 1.2 + r() * 0.35, z: at.z + Math.sin(a) * rr, vx: Math.cos(a) * 0.4, vy: 0.1 + r() * 0.2, vz: Math.sin(a) * 0.4, life: 1.2 + r() * 0.4, size: 0.4, size1: 1.0, frame: F.smoke, rot: r() * 6.28, rotv: (r() - 0.5), alpha: 0.7, delay: r() * 0.2, fadeIn: 0.1, hold: 0.4, fadeOut: 1.5, drag: 1.5 }, r() < 0.5 ? C(0x140c1c) : C(0x30223e)); });
    // the blindfold: a flattened ink band at eye level, and a violet ribbon swirling round it
    this.P(this.norm, this.col({ ...this.off(at, 1.35), life: 1.4, delay: 0.1, size: 0.3, size1: 1.35, growT: 0.25, ax: 1.4, ay: 0.32, frame: F.smoke, fadeIn: 0.06, hold: 0.5, fadeOut: 1.6, alpha: 0.95 }, C(0x0c0612)));
    this.ribbon(helixPts(up(at, 1.05), { turns: 1.6, h: 0.55, r: 0.55, r1: 0.4, segs: 60, phase: 0, dir: 1 }), { color: 0x6030a0, core: 0xc8a0ff, width: 0.08, life: 1.2, reveal: 0.4, hold: 0.5, renderOrder: 22 });
    this.burst(this.add, 12, () => { const a = r() * 6.2832; return this.col({ x: at.x, y: at.y + 1.3, z: at.z, vx: Math.cos(a) * 1.2, vy: (r() - 0.5), vz: Math.sin(a) * 1.2, life: 0.4, size: 0.12, frame: F.glint, delay: 0.1 + r() * 0.4, flick: 0.5, drag: 2 }, C(0xb0a0ff)); });
    return 0.3;
  };
  // CHARM / Beguile: pink hearts spiral up the body, one big heart pulses over the head.
  P.fx_charm = function (at, src) {
    const g = at;
    const r = this.rnd; const Pk = C(0xff6ac0), W = HDR(0xffd0ec, 1.25);
    this.light(g, 0xff7ac8, 6, 1.4, { rise: 0.15, y: 1.0, dist: 2.8, decay: 1.6 });
    this.burst(this.add, 12, (i) => this.col({ x: at.x, y: at.y + 0.6, z: at.z, orbit: { cx: at.x, cy: at.y + 0.1 + (i % 4) * 0.2, cz: at.z, r: 0.6, dr: -0.15, w: 3.2, phase: i / 12 * 6.283, vy: 1.0 }, life: 1.1, delay: i * 0.04, size: 0.2 + r() * 0.12, frame: F.heart, rot: (r() - 0.5) * 0.4, flick: 0.1, fadeIn: 0.1, hold: 0.4, fadeOut: 1.3, occ: 0.2 }, i % 3 ? Pk : W));
    this.icon(at, F.heart, mix(Pk, W, 0.2), { y: 2.15, size: 0.8, delay: 0.2, life: 1.3 });
    this.timer(0.55, () => this.P(this.add, this.col({ ...this.off(at, 2.15), life: 0.35, size: 0.8, size1: 1.3, frame: F.heart, fadeOut: 2, alpha: 0.5 }, W)));
    this.decal(g, 'soft', { color: 0xff6ab8, size: 0.8, size1: 1.8, grow: 0.3, life: 1.4, hold: 0.4, alpha: 0.6 });
    this.bodyGlow(at, Pk, { alpha: 0.35 });
    return 0.3;
  };
  // FEAR / Curse / dark touch: violet-black tendrils rise and a violet skull lifts out of them over the head.
  P.fx_fear = function (at, src) {
    const g = at;
    const r = this.rnd; const V2 = C(0xa060ff), DK = C(0x1e0830), W = HDR(0xd8b0ff, 1.15);
    this.light(g, 0x9050ff, 6, 1.4, { rise: 0.15, y: 0.8, dist: 2.8, decay: 1.6 });
    for (const ph of [0, 2.1, 4.2]) this.ribbon(helixPts(up(at, 0.05), { turns: 1.2, h: 1.9, r: 0.7, r1: 0.15, segs: 48, phase: ph, dir: 1 }), { color: 0x6020b0, core: 0xc890ff, width: 0.12, life: 1.2, reveal: 0.4, hold: 0.45, renderOrder: 22 });
    this.burst(this.norm, 14, () => { const a = r() * 6.2832, rr = r() * 0.5; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.3 + r() * 0.8, z: at.z + Math.sin(a) * rr, vy: 0.4 + r() * 0.4, life: 1.2, size: 0.35, size1: 0.9, frame: F.smoke, alpha: 0.5, delay: r() * 0.3, fadeIn: 0.15, fadeOut: 1.6, drag: 1 }, DK); });
    this.P(this.norm, this.col({ ...this.off(at, 2.15), vy: 0.15, life: 1.35, delay: 0.14, size: 1.6, size1: 1.2, growT: 0.2, frame: F.glow, fadeIn: 0.1, hold: 0.5, fadeOut: 1.5, alpha: 0.55 }, C(0x12041c)));
    this.icon(at, F.skull, mix(V2, W, 0.35), { y: 2.15, size: 0.85, delay: 0.18, life: 1.35 });
    this.decal(g, 'glyph', { color: 0x8040d0, size: 0.4, size1: 1.9, grow: 0.3, life: 1.5, hold: 0.5, alpha: 0.85, spin: -1.4 });
    this.bodyGlow(at, V2, { alpha: 0.3 });
    return 0.3;
  };
  // R13 DEPTH BIAS. Most ally targets stand against a wall or under an eave; half of a ward cage, the icon over the
  // head and the back of every spiral went INSIDE that geometry and were depth-culled (Protect showed 3 plates of 20,
  // Haste's clock sat inside the roof). Every particle these effects spawn carries a view-space depth bias toward the
  // camera (particles.js iBias): the battle camera is orthographic, so the bias never moves anything on screen and
  // survives a Q/E rotation mid-effect; a sprite genuinely in front still hides it.
  for (const k of ['fx_cure', 'fx_haste', 'fx_slowtime', 'fx_stoptime', 'fx_shield', 'fx_shell', 'fx_reflect', 'fx_poison', 'fx_sleep', 'fx_silence', 'fx_blind', 'fx_charm', 'fx_fear']) {
    const f = P[k];
    P[k] = function (...a) { const prev = this._zb; this._zb = 0.75; try { return f.apply(this, a); } finally { this._zb = prev; } };
  }
}
