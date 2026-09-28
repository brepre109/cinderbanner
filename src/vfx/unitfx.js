import * as THREE from 'three';
import { F } from './atlas.js';
// R19 (units/animation item): body-driven ground contact, spawned by the ANIMATION rather than by an ability's
// effect — a giant's slam lands its own feet on the board (dust skirt + grit + a low shock ring + shake) even when
// the ability's effect is a plain slash on the victim. Built on the VFX instance's public primitives only.
const C = (h) => new THREE.Color(h);
/** Stomp: `at` = world point on the ground under the attacker, `k` = body size factor (~1 human, 1.5 giant). */
export function stompDust(vfx, at, k = 1) {
  if (!vfx || typeof vfx.burst !== 'function') return;
  const r = vfx.rnd; const T = C(0xcdb994), GRIT = C(0x6f5c42);
  vfx.burst(vfx.norm, Math.round(14 * k), () => { const a = r() * 6.2832, sp = (0.9 + r() * 0.8) * k; return vfx.col({ x: at.x + Math.cos(a) * 0.3 * k, y: at.y + 0.06, z: at.z + Math.sin(a) * 0.3 * k, vx: Math.cos(a) * sp, vy: 0.25 + r() * 0.45, vz: Math.sin(a) * sp, life: 0.9 + r() * 0.4, size: 0.34 * k, size1: (0.9 + r() * 0.4) * k, frame: F.dust, rot: r() * 6.28, rotv: (r() - 0.5) * 2, alpha: 0.6, drag: 4, grav: -0.6, fadeIn: 0.05, hold: 0.2, fadeOut: 1.8 }, T); });
  vfx.burst(vfx.norm, Math.round(8 * k), () => { const a = r() * 6.2832, sp = 0.7 + r() * 0.9; return vfx.col({ x: at.x + (r() - 0.5) * 0.4, y: at.y + 0.08, z: at.z + (r() - 0.5) * 0.4, vx: Math.cos(a) * sp, vy: 1.6 + r() * 1.4, vz: Math.sin(a) * sp, life: 0.9 + r() * 0.3, size: 0.05 + r() * 0.05, frame: F.stone, rot: r() * 6.28, rotv: (r() - 0.5) * 12, grav: -14, floor: at.y + 0.03, bounce: 0.35, fadeOut: 0.55 }, GRIT); });
  vfx.decal?.(at, 'ring', { color: 0xd8c8a0, size: 0.5 * k, size1: 2.0 * k, grow: 0.25, life: 0.45, hold: 0.2, alpha: 0.45, lift: 0.035 });
  vfx.decal?.(at, 'scuff', { color: 0x3a1e0c, size: 0.9 * k, size1: 1.3 * k, grow: 0.2, life: 2.2, hold: 0.5, alpha: 0.5, blending: THREE.NormalBlending, lift: 0.02 });
  vfx.shake?.(0.22 * k, 'stomp');
}
