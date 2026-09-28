import * as THREE from 'three';
import { facingFrom } from '../game/rules.js';
import { HSTEP } from '../core/config.js';
// Unit animation helpers (owned by the units item). battle.js calls these; they only touch UnitSprite state and the
// sprite root position, never rules or turn logic. All durations are scaled by `speed` (battle.speed).
// R11: every reaction (lunge, recoil, dodge, follow-through) now drives the sprite's OFFSET (s.off, applied to the
// billboard + contact shadow in UnitSprite.update), never root.position. root is the tile, full stop: a counter that
// starts while the recoil is still easing back, or two hits landing inside one recoil, can no longer bake a stale
// displacement into the unit's standing spot (the old tweens each captured `base = root.position` mid-flight).
const now = () => performance.now();
const raf = () => new Promise((r) => requestAnimationFrame(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeIn = (k) => k * k;
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const TILE_MS = 250;       // walk: ms per tile (2 steps per tile)
const TURN_MS = 40;        // turn-in-place beat when the path bends (held on the planted contact frame)
// Jump (height change of 2+ steps): crouch -> air -> land, the genre's hop. One-step changes stay inside the stride.
const CROUCH_MS = 60, AIR_MS = 200, AIR_PER_STEP = 25, LAND_MS = 80;
export const HITSTOP_MS = 75;   // impact freeze: attacker holds the contact frame, victim holds the white flash

async function tween(ms, fn) { const t0 = now(); for (;;) { const k = ms > 0 ? Math.min(1, (now() - t0) / ms) : 1; fn(k); if (k >= 1) return; await raf(); } }
/** Offset tween with ownership: a newer offset animation on the same sprite cancels this one (returns false). */
async function offTween(s, tok, ms, fn) { const t0 = now(); for (;;) { if (s._offTok !== tok) return false; const k = ms > 0 ? Math.min(1, (now() - t0) / ms) : 1; fn(k); if (k >= 1) return true; await raf(); } }
const claim = (s) => (s._offTok = (s._offTok || 0) + 1);
const hold = async (s, tok, ms) => { await sleep(ms); return s._offTok === tok; };

/** Walk a unit along `path` ([[x,z],...]) tile by tile: constant speed, a real 4-frame walk cycle driven off tile
 *  phase (UnitSprite.update reads `s.walk.phase` and picks WALK[floor(phase*4)%4] — contact / down / contact / up,
 *  i.e. two steps per tile), a turn beat on bends held on the planted contact frame, and on height changes of two
 *  steps or more the genre's hop: crouch (down frame, squash), a parabolic arc that clears the lip, a landing squash.
 *  s.walk.ground tells the sprite where the floor is under the body, so the contact shadow stays ON THE GROUND
 *  under a jump instead of riding up with the feet (bar 3: 'nothing floating').
 *  NOTHING here ever sets POSE.idle or POSE.recover while the unit is moving (rubric 6: no standing frame in a
 *  locomotion cycle).
 *  ctx: { speed, worldPos(x,z)->Vector3, onTile(x,z) } — onTile is called after each tile is entered (updates u.x/u.z). */
export async function walkPath(s, u, path, ctx) {
  const speed = ctx.speed || 1; const camYaw = ctx.camYaw || (() => 0);
  claim(s); s.off.set(0, 0, 0); s.squash = 0; s.lean = 0;
  let prevFacing = u.facing; let jumped = false;
  for (let i = 0; i < path.length; i++) {
    const [x, z] = path[i];
    const from = s.root.position.clone(); const to = ctx.worldPos(x, z);
    const f = facingFrom(u.x, u.z, x, z);
    const right = UnitSpriteRight(camYaw()); const dv = to.clone().sub(from).setY(0).normalize(); const dir = Math.sign(dv.dot(right)) || 1;
    if (f !== prevFacing && i > 0) { // turn on the planted foot: contact frame, a hair of squash, no idle pop
      u.facing = f; s.facing = f; s.walk = { phase: 0, dir, hop: 0, squash: -0.03, ground: from.y };
      await sleep(TURN_MS / speed);
    }
    u.facing = f; s.facing = f; prevFacing = f;
    const dh = to.y - from.y; const steps = Math.round(Math.abs(dh) / HSTEP);
    const first = i === 0, last = i === path.length - 1; jumped = steps >= 2;
    if (steps >= 2) {
      // --- the genre hop: crouch, arc, land ---
      await tween(CROUCH_MS / speed, (k) => { s.walk = { phase: 0.25, dir, hop: 0, squash: -0.09 * Math.sin(k * Math.PI * 0.5), ground: from.y, pose: 'walk1' }; });
      const air = (AIR_MS + AIR_PER_STEP * steps) / speed; const apex = 0.16 + Math.abs(dh) * 0.5;
      await tween(air, (k) => {
        s.root.position.lerpVectors(from, to, k);
        const hop = apex * 4 * k * (1 - k);
        s.walk = { phase: 0.75, dir, hop, squash: 0.05 * Math.sin(k * Math.PI), ground: k < 0.5 ? from.y : to.y, pose: 'walk3' };
      });
      ctx.onTile?.(x, z);
      await tween(LAND_MS / speed, (k) => { s.walk = { phase: 0.25, dir, hop: 0, squash: -0.11 * (1 - easeOut(k)), ground: to.y, pose: 'walk1' }; });
      continue;
    }
    const ms = (TILE_MS + (steps ? 50 : 0)) / speed;
    await tween(ms, (k) => {
      // ease only into the first and out of the last tile; constant speed in between (no skating, no per-tile bounce)
      const e = first && last ? easeInOut(k) : first ? (k < 0.35 ? k * k / 0.35 : k) : last ? (k > 0.65 ? 1 - (1 - k) * (1 - k) / 0.35 : k) : k;
      s.root.position.lerpVectors(from, to, e);
      // one-step change: a small step-up arc inside the stride (the genre does not hop a single step)
      const hop = steps ? Math.sin(e * Math.PI) * (0.07 + Math.abs(dh) * 0.4) : 0;
      // phase follows the EASED travel, not raw time, so the step frames stay locked to ground speed
      s.walk = { phase: e, dir, hop, squash: 0, ground: e < 0.5 ? from.y : to.y };
    });
    ctx.onTile?.(x, z);
  }
  // arrival: settle on the planted contact frame for a beat with a tiny squash, then stand
  if (!jumped) { s.walk = { phase: 0, dir: s.walk?.dir || 1, hop: 0, squash: -0.04, ground: s.root.position.y }; await sleep(35 / speed); }   // (a landing already settled it)
  s.walk = null; s.squash = 0; s.setPose('idle');
}
function UnitSpriteRight(yaw) { return new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)); }

// ---- R19 weight profiles (roster.js motionForSheet -> UnitSprite.motion) -----------------------------------------
// Review 15/17 held Animation at 6: 'unit melee reads the same as before, a melee beat is hard to read at normal
// framing'. Measured causes (shots/anim19/before): (1) the HIT LANDED ON THE WIND-UP DRAWING — atlas col 2 ('attack')
// is the wind-up peak and col 3 ('attack2') the impact on nearly every sheet (footman thrust, titan club slam, wyrm
// breath, knight spark), but the contact frame was 'attack' and the impact drawing only showed on the follow-through;
// (2) a 0.42-tile lunge buried the attacker inside the victim, so the contact frame was one blob; (3) every class
// swung on the same 115/70/60 ms beat and a wyrm lunged like a footman; (4) the victim's reaction was a white flash on
// a near-idle frame with no body language. Every beat below is per profile; the body now LEANS (pivot roll in screen
// space) back on the wind-up, into the strike, and away from a blow it takes.
//   wind: anticipation ms, hold: the held wind-up peak, strike: the committed swing, pull/lunge: tiles along the
//   line, sq: squash at the peak (+ grows tall), lb/lf: lean back / forward (rad), rise: hop at the peak (tiles),
//   fol: follow-through hold on the impact frame, shake: camera shake on contact.
export const PROFILE = {
  light:  { wind: 75,  hold: 35,  strike: 45, pull: 0.10, lunge: 0.30, sq: 0.07, lb: 0.07, lf: 0.13, rise: 0,    fol: 40,  shake: 0.08 },
  normal: { wind: 110, hold: 65,  strike: 55, pull: 0.14, lunge: 0.30, sq: 0.10, lb: 0.09, lf: 0.15, rise: 0,    fol: 60,  shake: 0.12 },
  heavy:  { wind: 150, hold: 95,  strike: 65, pull: 0.18, lunge: 0.28, sq: 0.13, lb: 0.13, lf: 0.14, rise: 0,    fol: 110, shake: 0.20 },
  caster: { wind: 100, hold: 50,  strike: 55, pull: 0.08, lunge: 0.24, sq: 0.06, lb: 0.06, lf: 0.11, rise: 0,    fol: 50,  shake: 0.08 },
  float:  { wind: 120, hold: 60,  strike: 60, pull: 0.10, lunge: 0.30, sq: 0.06, lb: 0.08, lf: 0.14, rise: 0.06, fol: 60,  shake: 0.08 },
  beast:  { wind: 130, hold: 70,  strike: 110, pull: 0.14, lunge: 0.34, sq: -0.12, lb: 0.10, lf: 0.20, rise: 0.26, fol: 70, shake: 0.14, pounce: true },
  giant:  { wind: 220, hold: 120, strike: 70, pull: 0.10, lunge: 0.18, sq: 0.15, lb: 0.14, lf: 0.18, rise: 0.10, fol: 140, shake: 0.30, stomp: true },
  flyer:  { wind: 190, hold: 80,  strike: 75, pull: 0.08, lunge: 0.30, sq: 0.10, lb: 0.10, lf: 0.20, rise: 0.30, fol: 90,  shake: 0.22 },
};
export const profileOf = (s) => PROFILE[s?.motion] || PROFILE.normal;
/** Screen-space sign of a ground direction (+1 = toward screen-right), soft near the view axis. */
function screenSign(s, dir) { const y = s.camYaw || 0; return THREE.MathUtils.clamp((dir.x * Math.cos(y) - dir.z * Math.sin(y)) * 1.8, -1, 1); }

/** Attack wind-up: anticipation (guard frame, pull back and lean back) → the HELD wind-up peak ('attack') → the
 *  committed strike → CONTACT on the impact drawing ('attack2'). Resolves at the moment the hit should land and
 *  leaves the attacker on the contact frame, displaced (s.off) — battle.js then plays the impact and the hit-stop
 *  while the attacker simply stays there; call attackRecover() afterwards for the follow-through. `dir` = unit
 *  vector from attacker to target on the ground. opts.ranged: a bow / gun / thrown attack (draw, aim hold, release
 *  with recoil instead of a lunge). opts.onStomp(k): a giant's slam hits the ground (battle.js adds dust + shake). */
export async function attackWindup(s, ab, dir, speed = 1, opts = {}) {
  const magic = ab.kind === 'mag' || ab.kind === 'heal' || ab.kind === 'raise' || ab.kind === 'buff';
  const ranged = !magic && (opts.ranged || ab.ranged);
  const melee = ab.kind === 'phys' && !ranged;
  const tok = claim(s); s.walk = null; s.lean = 0; s.hop = 0; s._dir = dir.clone(); s._strike = null;
  const O = (d) => s.off.copy(dir).multiplyScalar(d);
  const P = profileOf(s); const sx = screenSign(s, dir); const L = (a) => { s.lean = -a * sx; };   // + = toward the target
  const contact = ab.pose === 'cast' ? 'cast' : 'attack2';
  if (magic) { // gather (guard frame, rise, lean back) → channel (the charged drawing, swell) → release (impact drawing)
    s.setPose('ready');
    await offTween(s, tok, 150 / speed, (k) => { const e = easeOut(k); s.squash = 0.04 * e; O(-0.04 * e); L(-0.05 * e); });
    s.setPose('attack');
    await offTween(s, tok, 190 / speed, (k) => { s.squash = 0.04 + 0.03 * Math.sin(k * Math.PI); L(-0.05 + 0.02 * k); });
    s.setPose('attack2'); s.squash = -0.04; O(0.05); L(0.07);
    s._strike = { kind: 'magic', P }; await sleep(60 / speed); s.squash = 0; return;
  }
  if (ranged) { // draw → aim (hold still on the full draw: the tension beat) → release with a kick back
    s.setPose('ready');
    await offTween(s, tok, 140 / speed, (k) => { const e = easeOut(k); O(-0.07 * e); s.squash = 0.05 * e; L(-0.04 * e); });
    s.setPose('attack');
    if (!(await hold(s, tok, 110 / speed))) return;
    s.setPose('attack2');
    await offTween(s, tok, 55 / speed, (k) => { O(-0.07 - 0.06 * easeOut(k)); s.squash = 0.05 * (1 - k) - 0.03 * k; L(-0.04 - 0.05 * easeOut(k)); });
    s._strike = { kind: 'ranged', P }; s.squash = 0; return;
  }
  // --- melee / close physical: anticipation → held peak → strike → contact ---
  // a big body already reaches across the tile edge, so it travels less (a wyrm's 0.30 buried the victim)
  const reach = THREE.MathUtils.clamp(1.45 / (s.heightUnits || 1.4), 0.55, 1);
  const pull = melee ? P.pull : 0.05, lunge = (melee ? P.lunge : 0.08) * reach;
  s.setPose('ready');
  await offTween(s, tok, P.wind * 0.45 / speed, (k) => { const e = easeOut(k); O(-pull * 0.6 * e); s.squash = P.sq * 0.5 * e; L(-P.lb * 0.5 * e); });
  s.setPose('attack');   // the wind-up PEAK drawing (club overhead, blade cocked, breath drawn)
  await offTween(s, tok, P.wind * 0.55 / speed, (k) => { const e = easeOut(k); O(-pull * (0.6 + 0.4 * e)); s.squash = P.sq * (0.5 + 0.5 * e); L(-P.lb * (0.5 + 0.5 * e)); s.hop = P.rise * e; });
  if (!(await hold(s, tok, P.hold / speed))) return;   // the HOLD: the read that a blow is coming
  opts.onStrike?.();   // the effect's own lead-in (~50 ms) runs with the swing
  if (P.pounce) { // beast: the crouch springs into a leap that lands on the contact
    s.setPose('attack');
    await offTween(s, tok, P.strike / speed, (k) => { const e = easeInOut(k); O(-pull + (pull + lunge) * e); s.hop = P.rise * 4 * e * (1 - e) + 0.02; s.squash = 0.08 * Math.sin(k * Math.PI) - 0.12 * (1 - k) * (k < 0.2 ? 1 : 0); L(P.lf * (e < 0.5 ? 0.4 : 1)); });
    s.hop = 0; s.squash = -0.10;
  } else {
    await offTween(s, tok, P.strike / speed, (k) => { const e = easeIn(k); O(-pull + (pull + lunge) * e); s.squash = P.sq * (1 - k) - 0.05 * k; L(-P.lb + (P.lb + P.lf) * e); s.hop = P.rise * (1 - e); if (k > 0.55) s.setPose(contact); });
    s.hop = 0; s.squash = P.stomp ? -0.15 : -0.04;
  }
  s.setPose(contact); L(P.lf);
  if (P.stomp) opts.onStomp?.(1);
  s._strike = { kind: 'melee', lunge, pose: contact, P };
}
/** Follow-through and return (non-blocking): hold the impact drawing with a short overshoot (longer for heavy
 *  bodies), the recover frame back to the tile with the lean easing out, then idle. opts.miss: the blow found
 *  nothing, so the follow-through carries further and the body stumbles forward. */
export function attackRecover(s, speed = 1, opts = {}) {
  const st = s._strike; s._strike = null; const tok = claim(s); const dir = s._dir || new THREE.Vector3();
  const P = st?.P || profileOf(s);
  const from = s.off.clone(); s.squash = 0; s.hop = 0;
  const go = async () => {
    if (st && st.kind === 'melee') {
      s.setPose(st.pose || 'attack2');
      const over = opts.miss ? 0.16 : 0.06; const l0 = s.lean;
      if (!(await offTween(s, tok, (opts.miss ? 110 : 70) / speed, (k) => { const e = easeOut(k); s.off.copy(from).addScaledVector(dir, over * e); s.lean = l0 * (1 + (opts.miss ? 0.5 : 0.15) * e); s.squash = -0.04 * (1 - k); }))) return;
      if (!(await hold(s, tok, (opts.miss ? 90 : P.fol) / speed))) return;
    }
    s.setPose('recover'); const f2 = s.off.clone(); const l1 = s.lean;
    if (!(await offTween(s, tok, (220 + (P === PROFILE.heavy || P === PROFILE.giant ? 60 : 0)) / speed, (k) => { const e = easeInOut(k); s.off.copy(f2).multiplyScalar(1 - e); s.lean = l1 * (1 - e); }))) return;
    s.off.set(0, 0, 0); s.lean = 0; s.setPose('idle');
  };
  go();
}
/** Victim reaction: the impact pops the body (white flash, recoil frame, a small instant shove, squash, and the
 *  upper body snapped BACK away from the blow — the hurt pose the drawn sheets do not have) and HOLDS there for the
 *  hit-stop; then the knock slides out, hangs, and eases back upright. Scaled down for big monsters so a wyrm
 *  shrugs where a footman staggers. opts: { heavy, stop (ms, unscaled by speed here — pass it already scaled) }. */
export function hitReact(s, dir, speed = 1, opts = {}) {
  const tok = claim(s); s.walk = null; s.setPose('recover'); s.hitFlash(opts.stop || 50 / speed, 0.14);   // uFlash = 2x: a ~28 % white kick held through the stop, never a white cut-out
  const mass = THREE.MathUtils.clamp(1.45 / (s.heightUnits || 1.4), 0.45, 1.0);
  const dist = (opts.heavy ? 0.34 : 0.25) * mass, pop = 0.08 * mass;
  const sx = screenSign(s, dir); const tilt = (opts.heavy ? 0.26 : 0.17) * mass;   // lean AWAY from the attacker
  const lean = (a) => { s.lean = -a * sx; };
  s.off.copy(dir).multiplyScalar(pop); s.squash = -0.09; lean(tilt * 0.7);
  (async () => {
    if (opts.stop && !(await hold(s, tok, opts.stop))) return;
    if (!(await offTween(s, tok, 85 / speed, (k) => { const e = easeOut(k); s.off.copy(dir).multiplyScalar(pop + (dist - pop) * e); s.squash = -0.09 * (1 - k); lean(tilt * (0.7 + 0.3 * e)); s.hop = opts.heavy ? 0.06 * Math.sin(k * Math.PI) : 0; }))) return;
    s.hop = 0; if (!(await hold(s, tok, 60 / speed))) return;
    if (!(await offTween(s, tok, 230 / speed, (k) => { const e = easeInOut(k); s.off.copy(dir).multiplyScalar(dist * (1 - e)); lean(tilt * (1 - e) - 0.03 * Math.sin(e * Math.PI)); }))) return;
    s.off.set(0, 0, 0); s.squash = 0; s.lean = 0; if (!s.ko) s.setPose('idle');
  })();
}
/** Miss: a sidestep out of the blow's line (guard frame, a small hop across, hold, step back). */
export function evadeReact(s, dir, speed = 1, opts = {}) {
  const tok = claim(s); s.walk = null; s.setPose('ready');
  const side = new THREE.Vector3(-dir.z, 0, dir.x); if (opts.camRight && side.dot(opts.camRight) < 0) side.negate();
  const d = side.multiplyScalar(0.30).addScaledVector(dir, 0.08);
  const sx = opts.camRight ? (Math.sign(d.dot(opts.camRight)) || 1) : 1;   // lean INTO the sidestep, in screen space
  (async () => {
    if (!(await offTween(s, tok, 120 / speed, (k) => { const e = easeOut(k); s.off.copy(d).multiplyScalar(e); s.hop = Math.sin(k * Math.PI) * 0.07; s.lean = -0.10 * e * sx; }))) return;
    s.hop = 0; if (!(await hold(s, tok, 200 / speed))) return;
    if (!(await offTween(s, tok, 200 / speed, (k) => { const e = easeInOut(k); s.off.copy(d).multiplyScalar(1 - e); s.lean = -0.10 * (1 - e) * sx; }))) return;
    s.off.set(0, 0, 0); s.lean = 0; s.hop = 0; if (!s.ko) s.setPose('idle');
  })();
}
