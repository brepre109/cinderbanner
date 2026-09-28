import * as THREE from 'three';
import { F } from './atlas.js';
import { HSTEP } from '../core/config.js';
// SPECT15 FULL-FRAME SET PIECES for the cinematic tier (see cine.js). Installed on the VFX prototype like status.js.
// cineSet(look, at, src, lead, d, ks): spawned at play() time, all beats relative to NOW, so the climax lands on the
// impact at `d` (lead = the gather beat the effect itself was deferred by; ks = 1 / battle speed). Each piece spans
// the frame along the camera's right axis (~11-13 tiles at the pushed-in play lens) so the spell reads as owning the
// screen -- the genre's full-screen Bolt / Ice 2 / Fire 3 -- while the victim stays readable: walls and
// shafts sit BEHIND the target (away from the lens) and the particle guard keeps the body clear.
const C = (h) => new THREE.Color(h);
const HDR = (h, k) => new THREE.Color(h).multiplyScalar(k);
const mix = (a, b, k) => a.clone().lerp(b, k);

export function installCineFx(VFX) {
  const P = VFX.prototype;
  // ground point `off` tiles along camera-right and `dep` tiles along the view (+ = away from the lens) from `at`;
  // null when it falls off the board or into a void tile (nothing strikes the black void)
  P._cineGround = function (at, right, back, off, dep = 0) {
    const x = at.x + right.x * off + back.x * dep, z = at.z + right.z * off + back.z * dep;
    const m = this.battle?.map; if (!m) return new THREE.Vector3(x, at.y, z);
    const t = m.at(Math.floor(x), Math.floor(z)); if (!t || t.void) return null;
    return new THREE.Vector3(x, t.h * HSTEP, z);
  };
  P.cineSet = function (look, at, src, lead, d, ks = 1) {
    const r = this.rnd; const right = this.camRight();
    // 'back' = horizontal direction away from the lens
    const cam = this.cam; const back = new THREE.Vector3(0, 0, -1); if (cam) { back.setFromMatrixColumn(cam.matrixWorld, 2).negate(); back.y = 0; if (back.lengthSq() > 1e-6) back.normalize(); }
    const T = d;                                      // impact, seconds from now
    const span = 6.2;                                 // half-width of the piece along camera-right, tiles
    const pts = (n, dep = 0, jit = 0.6) => { const out = []; for (let i = 0; i < n; i++) { const off = -span + (2 * span) * (i + 0.5) / n + (r() - 0.5) * jit; const g = this._cineGround(at, right, back, off, dep + (r() - 0.5) * jit); if (g) out.push([off, g]); } return out; };
    const at0 = (s) => Math.max(0, s);
    if (look === 'thunder') {
      const BL = C(0x3d6cff), W = HDR(0x5ec8ff, 1.3);
      // the storm gathers: far, thin bolts flicker at the frame edges during the lead
      for (const [k, off] of [[0.3, -span * 0.85], [0.62, span * 0.8]]) { const g = this._cineGround(at, right, back, off, 2.5); if (g && lead > 0) this.bolt({ from: g.clone().add(new THREE.Vector3((r() - 0.5) * 2, 13, 0)), to: g.clone().add(new THREE.Vector3(0, 0.1, 0)), life: 0.16, jitterUntil: 0.12, amp: 0.7, segs: 18, branches: 1, glow: 0x2a4ac0, core: 0x4a90e0, widthGlow: 0.3, widthCore: 0.05, depthTest: false, renderOrder: 38, coreBoost: 0.5, delay: lead * k }); }
      // the strike: bolts across the whole frame, staggered into the impact
      const strikes = pts(6, 1.4, 1.2);
      strikes.forEach(([off, g], i) => {
        const dl = at0(T - 0.08 + (i % 3) * 0.035);
        this.bolt({ from: g.clone().add(new THREE.Vector3((r() - 0.5) * 2.5, 14, (r() - 0.5) * 2.5)), to: g.clone().add(new THREE.Vector3(0, 0.12, 0)), life: 0.34, jitterUntil: 0.24, amp: 0.9, segs: 22, branches: 2, glow: 0x3060e0, core: 0x58c0ff, widthGlow: 0.5, widthCore: 0.085, branchLen: 1.6, depthTest: false, renderOrder: 39, coreBoost: 0.66, delay: dl });
        this.ringFx(g, 0x4a80ff, 0.2, 1.5, 0.4, { alpha: 0.75, delay: dl + 0.02 });
        this.decal(g, 'scorch', { color: 0x000000, size: 0.5, size1: 1.1, grow: 0.1, life: 1.8, hold: 0.3, alpha: 0.5, blending: THREE.NormalBlending, lift: 0.02, delay: dl + 0.02 });
        this.light(g, 0x3060ff, 5, 0.35, { rise: 0.01, y: 1.0, dist: 3, flicker: 0.6, delay: dl });
      });
      // a fork that runs across the frame above the victim
      const a0 = at.clone().addScaledVector(right, -span - 1.5).add(new THREE.Vector3(0, 3.4, 0)).addScaledVector(back, 1.5), a1 = at.clone().addScaledVector(right, span + 1.5).add(new THREE.Vector3(0, 2.6, 0)).addScaledVector(back, 1.5);
      this.bolt({ from: a0, to: a1, life: 0.3, jitterUntil: 0.22, amp: 1.3, segs: 40, branches: 6, glow: 0x3060e0, core: 0x5cc4ff, widthGlow: 0.5, widthCore: 0.08, branchLen: 1.4, depthTest: false, renderOrder: 39, coreBoost: 0.6, delay: at0(T - 0.02) });
      this.burst(this.add, 40, () => { const o = (r() - 0.5) * 2 * span, g = this._cineGround(at, right, back, o, (r() - 0.5) * 3) || at; return this.col({ x: g.x, y: g.y + 0.2 + r() * 2.5, z: g.z, vy: 0.4, life: 0.3 + r() * 0.3, size: 0.2 + r() * 0.3, frame: F.glint, rot: r(), flick: 0.7, delay: at0(T - 0.05) + r() * 0.3 }, r() < 0.5 ? W : BL); });
    } else if (look === 'ice') {
      const ICE = C(0x4fb4ff), PALE = C(0x9fdcff), DEEP = C(0x2a5cff), W = HDR(0x7fd0ff, 1.4);
      // snow and glints drift down across the frame during the gather
      this.burst(this.add, 70, () => { const o = (r() - 0.5) * 2 * span, dep = (r() - 0.5) * 6; const x = at.x + right.x * o + back.x * dep, z = at.z + right.z * o + back.z * dep; return this.col({ x, y: at.y + 2.5 + r() * 4, z, vx: right.x * 0.4, vy: -1.2 - r() * 1.2, vz: right.z * 0.4, life: 1.1 + r() * 0.6, delay: r() * Math.max(0.2, lead + 0.3), size: 0.08 + r() * 0.16, frame: r() < 0.6 ? F.glint : F.star, rot: r() * 3, rotv: 2, flick: 0.3, fadeIn: 0.2, fadeOut: 1.2, noclip: 1 }, r() < 0.4 ? W : PALE); });
      // the FROST SWEEP: a line of ice spikes erupts from the caster's side of the frame through the victim and on
      const side = Math.sign(((src.x - at.x) * right.x + (src.z - at.z) * right.z)) || -1;
      const line = pts(15, 0.9, 0.4).sort((p, q) => side * (q[0] - p[0]));
      const t0 = at0(T - 0.42), t1 = at0(T + 0.06);
      line.forEach(([off, g], i) => {
        const dl = t0 + (t1 - t0) * i / Math.max(1, line.length - 1); const near = Math.abs(off) < 0.9;
        if (near) return;   // the victim's own cluster is fx_ice's
        for (let j = 0; j < 2; j++) {
          const h = 0.9 + r() * 1.3, ox = (r() - 0.5) * 0.5, oz = (r() - 0.5) * 0.5, tilt = (r() - 0.5) * 0.5;
          const base = { x: g.x + ox, y: g.y + h * 0.46, z: g.z + oz, life: 0.9, delay: dl + j * 0.03, size: 0.15, size1: h, growT: 0.12, ax: 0.5, ay: 1, frame: F.shard, rot: tilt, fadeIn: 0.03, hold: 0.7, fadeOut: 1.0 };
          this.P(this.norm, this.col({ ...base, alpha: 0.9 }, mix(C(0x2a6ee0), C(0x8fd8ff), r() * 0.8)));
          this.P(this.add, this.col({ ...base, alpha: 0.45 }, mix(PALE, W, r() * 0.6)));
        }
        this.decal(g, 'frost', { color: 0x9fd8ff, size: 0.6, size1: 1.6, grow: 0.15, life: 2.2, hold: 0.4, alpha: 0.75, delay: dl });
        this.burst(this.add, 4, () => ({ ...this.col({ x: g.x, y: g.y + 0.3, z: g.z, vx: (r() - 0.5) * 2, vy: 1 + r() * 2, vz: (r() - 0.5) * 2, life: 0.4, delay: dl, size: 0.2, frame: F.star, fadeOut: 1 }, W) }));
      });
      // shatter at the impact: shards burst across the frame
      this.burst(this.add, 40, () => { const o = (r() - 0.5) * 2 * span, g = this._cineGround(at, right, back, o, 0.9) || at; const a = r() * 6.2832, sp = 2 + r() * 4; return this.col({ x: g.x, y: g.y + 0.6 + r() * 1.2, z: g.z, vx: Math.cos(a) * sp, vy: 1 + r() * 3, vz: Math.sin(a) * sp, life: 0.5 + r() * 0.5, delay: at0(T + 0.08) + r() * 0.1, size: 0.14 + r() * 0.26, ax: 0.5, frame: F.shard, rot: r() * 6.28, rotv: (r() - 0.5) * 14, grav: -8, fadeOut: 0.8 }, mix(PALE, ICE, r())); });
      this.light(at, 0x7fbfff, 8, 0.9, { rise: 0.3, y: 1.4, dist: 5, delay: at0(T - 0.4) });
      void DEEP;
    } else if (look === 'fire') {
      const O = C(0xff6a10), Y = C(0xffb030), RED = C(0xc02000), EMB = HDR(0xff8410, 1.5);
      // embers lift off the ground across the frame while the spell gathers
      this.burst(this.add, 50, () => { const o = (r() - 0.5) * 2 * span, g = this._cineGround(at, right, back, o, (r() - 0.5) * 4); if (!g) return null; return this.col({ x: g.x, y: g.y + 0.05, z: g.z, vx: (r() - 0.5) * 0.4, vy: 0.8 + r() * 1.6, vz: (r() - 0.5) * 0.4, life: 0.8 + r() * 0.6, delay: r() * Math.max(0.2, lead), size: 0.05 + r() * 0.07, frame: F.core, drag: 0.6, flick: 0.5, fadeOut: 0.9 }, mix(EMB, Y, r())); });
      // THE FIRE WALL: flame columns sweep across the frame just BEHIND the victim, then fall to cinders
      const side = Math.sign(((src.x - at.x) * right.x + (src.z - at.z) * right.z)) || -1;
      const wall = pts(16, 1.25, 0.3).sort((p, q) => side * (q[0] - p[0]));
      const t0 = at0(T - 0.34), t1 = at0(T + 0.04);
      wall.forEach(([off, g], i) => {
        const dl = t0 + (t1 - t0) * i / Math.max(1, wall.length - 1);
        for (let j = 0; j < 3; j++) { const h = 0.4 + j * 0.7 + r() * 0.3; this.P(this.add, this.col({ x: g.x + (r() - 0.5) * 0.4, y: g.y + h, z: g.z + (r() - 0.5) * 0.4, vy: 1.6 + r() * 1.4, life: 0.7 + r() * 0.35, delay: dl + r() * 0.06, size: 0.9 + r() * 0.5, size1: 0.25, ax: 0.6, ay: 1.5, frame: F.flame, drag: 1.4, alpha: 0.75, fadeOut: 1.2, occ: 0.35 }, j === 0 ? mix(Y, O, r() * 0.5) : mix(O, RED, r() * 0.7))); }
        this.P(this.add, this.col({ x: g.x, y: g.y + 0.7, z: g.z, vy: 0.9, drag: 1.5, life: 0.8, delay: dl, size: 0.6, size1: 1.4, growT: 0.25, frame: F.billow, rot: r() * 6.28, rotv: (r() - 0.5) * 2, alpha: 0.7, fadeIn: 0.04, hold: 0.3, fadeOut: 1.5, c1: C(0x1c0a04), cT: 0.7, occ: 0.6 }, mix(RED, O, r() * 0.6)));
        this.decal(g, 'cinder', { color: 0xff7a1c, size: 0.7, size1: 1.3, grow: 0.2, life: 1.4, hold: 0.25, alpha: 0.7, delay: dl });
      });
      this.light(at.clone().addScaledVector(back, 1.2).addScaledVector(right, -2.5 * side), 0xff6a14, 7, 0.9, { rise: 0.1, y: 1.0, dist: 4, flicker: 0.3, delay: t0 });
      this.light(at.clone().addScaledVector(back, 1.2).addScaledVector(right, 2.5 * side), 0xff6a14, 7, 0.9, { rise: 0.1, y: 1.0, dist: 4, flicker: 0.3, delay: t0 + 0.15 });
    } else if (look === 'holy' || look === 'wyrm_sovereign' || look === 'flare' || look === 'dark') {
      const hot = look === 'flare' ? 0xff4a8a : look === 'dark' ? 0x9a5aff : 0x5ab4ff;
      const G = C(hot), W = HDR(look === 'flare' ? 0xff9ac0 : look === 'dark' ? 0xc8a0ff : 0x8fe0ff, 1.25);
      // implosion: a frame-wide ring contracts onto the victim over the lead, motes are drawn in from the edges
      this.P(this.add, this.col({ x: at.x, y: at.y + 1.0, z: at.z, life: Math.max(0.3, lead + 0.1), size: 13, size1: 0.6, growT: Math.max(0.3, lead + 0.1), frame: F.ring, fadeIn: 0.15, hold: 0.85, fadeOut: 0.5, alpha: 0.55, noclip: 1 }, G));
      this.burst(this.add, 50, () => { const a = r() * 6.2832, rr = 5 + r() * 2.5; const c = { x: at.x, y: at.y + 1, z: at.z }; return this.col({ x: c.x + Math.cos(a) * rr, y: c.y + (r() - 0.3) * 3, z: c.z + Math.sin(a) * rr, vx: -Math.cos(a) * rr / Math.max(0.35, lead + 0.1), vy: 0, vz: -Math.sin(a) * rr / Math.max(0.35, lead + 0.1), life: Math.max(0.35, lead + 0.1), delay: r() * 0.12, size: 0.12 + r() * 0.16, frame: F.glint, flick: 0.3, fadeOut: 0.4, noclip: 1 }, r() < 0.4 ? W : G); });
      // light shafts fall across the frame onto a ring around the victim, sequentially, into the impact
      const shafts = pts(7, 1.8, 1.0).filter(([off]) => Math.abs(off) > 1.1);
      shafts.forEach(([, g], i) => {
        const dl = at0(T - 0.3 + i * 0.045);
        this.P(this.add, this.col({ x: g.x, y: g.y + 7, z: g.z, life: 0.55, delay: dl, size: 0.2, size1: 14, growT: 0.12, ax: 0.07, ay: 1, frame: F.glow, fadeIn: 0.05, hold: 0.3, fadeOut: 1.4, alpha: 0.85, noclip: 1 }, W));
        this.P(this.add, this.col({ x: g.x, y: g.y + 7, z: g.z, life: 0.6, delay: dl, size: 0.4, size1: 14, growT: 0.15, ax: 0.22, ay: 1, frame: F.glow, fadeIn: 0.05, hold: 0.25, fadeOut: 1.5, alpha: 0.4, occ: 0.12, noclip: 1 }, G));
        this.ringFx(g, hot, 0.2, 1.3, 0.5, { alpha: 0.8, delay: dl + 0.05 });
      });
      // the nova: radial rays across the frame at the impact
      this.burst(this.add, 26, () => { const a = r() * 6.2832, el = (r() - 0.3) * 0.9, sp = 14 + r() * 8; return this.col({ x: at.x, y: at.y + 1.1, z: at.z, vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp, vz: Math.sin(a) * Math.cos(el) * sp, life: 0.34 + r() * 0.16, delay: at0(T), size: 3.4 + r() * 2, ax: 1, ay: 0.12, frame: F.spark, align: true, drag: 2.5, fadeOut: 1.3, alpha: 0.8, noclip: 1 }, r() < 0.5 ? W : G); });
      this.ringFx(at, hot, 0.5, 5.2, 0.7, { alpha: 0.85, delay: at0(T) });
    } else if (look === 'quake') {
      const EARTH = C(0x7d5830), OCHRE = C(0xc09256), DARK = C(0x46301c), DUST = C(0xd8c096);
      // the ground shivers across the frame during the gather
      this.burst(this.norm, 40, () => { const o = (r() - 0.5) * 2 * span, g = this._cineGround(at, right, back, o, (r() - 0.5) * 4); if (!g) return null; return this.col({ x: g.x, y: g.y + 0.04, z: g.z, vy: 1 + r() * 1.5, life: 0.35, delay: r() * Math.max(0.2, lead), size: 0.05 + r() * 0.05, frame: F.stone, rotv: 10, grav: -13, floor: g.y + 0.03, bounce: 0.3, fadeOut: 0.5 }, EARTH); });
      // slabs erupt in rings rolling outward from the victim
      for (const [rad, n, k] of [[1.6, 7, 0], [3.0, 10, 1], [4.4, 13, 2]]) {
        for (let i = 0; i < n; i++) {
          const a = i / n * 6.2832 + r() * 0.3; const x = at.x + Math.cos(a) * rad, z = at.z + Math.sin(a) * rad; const t = this.battle?.map?.at(Math.floor(x), Math.floor(z)); if (!t || t.void) continue;
          const g = new THREE.Vector3(x, t.h * HSTEP, z); const h = 0.7 + r() * 0.8, dl = at0(T - 0.12 + k * 0.09);
          this.P(this.norm, this.col({ x: g.x, y: g.y + h * 0.42, z: g.z, life: 0.8, delay: dl, size: 0.2, size1: h, growT: 0.1, ax: 0.8, ay: 1, frame: F.shard, rot: (r() - 0.5) * 0.7, fadeIn: 0.03, hold: 0.6, fadeOut: 1.0 }, mix(EARTH, OCHRE, r() * 0.8)));
          this.P(this.norm, this.col({ x: g.x, y: g.y + 0.2, z: g.z, vx: Math.cos(a) * 1.2, vy: 0.4, vz: Math.sin(a) * 1.2, life: 0.6, delay: dl, size: 0.4, size1: 1.1, frame: F.dust, rot: r() * 6.28, alpha: 0.55, drag: 3, fadeOut: 1.6 }, mix(DUST, OCHRE, r())));
        }
        this.ringFx(at, 0xd08a3c, rad - 0.4, rad + 0.6, 0.4, { alpha: 0.7, delay: at0(T - 0.12 + k * 0.09) });
      }
      void DARK;
    }
  };
}
