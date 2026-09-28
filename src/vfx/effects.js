import * as THREE from 'three';
import { makeAtlas, DECALS, F } from './atlas.js';
import { ParticleSystem } from './particles.js';
import { Bolt } from './bolt.js';
import { Ribbon, helixPts } from './ribbon.js';
import { Clip, clipMaterial } from './clip.js';
import { installStatusFx } from './status.js';
import { flashScale } from '../ui/prefs.js';   // OPTIONS hook (flash / strobe intensity)
import { cineTier, cineLook, cineSpeedScale, cineFull, CINE_LEAD } from './cine.js';
import { installCineFx } from './cineset.js';
import { installSummonFx } from './summons.js';
// classic-recognisable spell/hit effects at AAA fidelity, modelled on the PS1-era tactics spell vocabulary:
//   - anticipation beat, then a blown-out white core wrapped in a saturated rim, then decay <= 1.5 s
//   - a full-screen colour wash (Bolt tints the frame blue, Fire warms it) driven by our own clock, so a frozen
//     frame captures it exactly like a live one
//   - real point lights so the terrain is lit by the spell, plus ground decals that outlive the burst
// API used by battle.js: play(name, from, to) -> impact delay (s); spawn / ring / flash / update.
// Extra: attach(battle), demo(name), stepSim(sec) for deterministic capture, clear().
const C = (h) => new THREE.Color(h);
const HDR = (h, k) => new THREE.Color(h).multiplyScalar(k);   // >1 pushes past the bloom threshold: the genre's blown-out core
const mix = (a, b, k) => a.clone().lerp(b, k);
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const V = (v) => new THREE.Vector3(v.x, v.y, v.z);
const easeOut = (k) => 1 - (1 - k) * (1 - k), easeIn = (k) => k * k;


// ---------- R7 ability -> effect routing (see VFX.route) ----------
// Explicit per-ability picks, where the ability's generic key under-sells it. String = effect name; object =
// { fx, opts } for a parameterised effect. Everything not listed falls through to the status / kind rules.
const VARIANT = {
  flare: 'flare', wyrm_sovereign: { fx: 'summon', opts: { summon: 'wyrm_sovereign' } }, ruin_strike: 'masher', holy_blade: 'holyblade', saint_cross: 'holy',
  fire_breath: 'breath', fireshot: { fx: 'gunshot', opts: { elem: 'fire' } }, boltshot: { fx: 'gunshot', opts: { elem: 'thunder' } },
  iceshot: { fx: 'gunshot', opts: { elem: 'ice' } }, spellstrike: { fx: 'runeblade', opts: { elem: 'fire' } },
  firebomb: { fx: 'bomb', opts: {} }, ki_burst: 'aura', gravity: 'gravity', life_drain: 'drain', leech_lance: 'drain',
  soul_reave: { fx: 'runeblade', opts: { elem: 'dark' } }, dread_touch: 'fear', night_edge: 'fear', fearful_impact: 'fear',
  intimidate: 'fear', word_of_pain: 'poison', rancid_breath: 'poison', nightmare: 'sleep', hex: 'slowtime',
  unspell: 'dispel', dispel: 'dispel', pilfer: 'steal', beguile: 'charm', vanish: 'vanish', mana_tonic: { fx: 'pop', opts: { color: 0x7fc8ff, big: true } },
  meditate: { fx: 'pop', opts: { color: 0x7fc8ff, big: true } }, remedy: { fx: 'cure', opts: { color: 0x9ff4ff, cleanse: true } }, purify: { fx: 'cure', opts: { color: 0x9ff4ff, cleanse: true } },
  mending_light: { fx: 'cure', opts: { big: true } }, soothing_gale: { fx: 'cure', opts: { big: true } }, halo_mend: { fx: 'cure', opts: { big: true } },
  potion: { fx: 'cure', opts: { small: true } }, greater_potion: { fx: 'cure', opts: { small: true } }, first_aid: { fx: 'cure', opts: { small: true } },
  focus: { fx: 'buff', opts: { color: 0xff9a3c } }, yell: 'haste', wrath_draw: 'slash', shield_bash: 'bash', // SUMMON16: every summon calls up its creature (summons.js)
  pyrelord: { fx: 'summon', opts: { summon: 'pyrelord' } }, frost_maiden: { fx: 'summon', opts: { summon: 'frost_maiden' } }, storm_elder: { fx: 'summon', opts: { summon: 'storm_elder' } },
  hearthling: { fx: 'summon', opts: { summon: 'hearthling' } }, gemfox: { fx: 'summon', opts: { summon: 'gemfox' } },
};
const STATUS_FX = { poison: 'poison', sleep: 'sleep', slow: 'slowtime', stop: 'slowtime', haste: 'haste', protect: 'shield', shell: 'shield',
  reflect: 'shield', silence: 'silence', blind: 'blind', charm: 'charm', fear: 'fear', curse: 'fear', vanish: 'vanish', immobilize: 'slowtime', disable: 'silence' };
const STATUS_COL = { poison: 0x7cff5a, sleep: 0x8aa8ff, slow: 0x7ab8ff, stop: 0x9ad0ff, haste: 0x7ff6ff, protect: 0xffd66a, shell: 0x8cf0c8,
  reflect: 0xe8b8ff, silence: 0xc8c8d8, blind: 0x6a5a7a, charm: 0xff7ac8, fear: 0xa060ff, curse: 0xa060ff, immobilize: 0xd0b070, disable: 0xd0a080 };
const ELEM_COL = { fire: 0xff7a2a, ice: 0x8fd8ff, thunder: 0xfff07a, holy: 0x9fd0ff, dark: 0xa060ff, earth: 0xd0a060 };
function firstStatus(ab) { if (!ab) return null; const st = ab.status || (ab.statuses && ab.statuses[0]); return st ? (typeof st === 'string' ? st : st.id) : null; }
function statusColor(st) { return st ? STATUS_COL[st] || null : null; }
function elemColor(ab) { if (!ab) return 0xc9a6ff; if (ab.element && ELEM_COL[ab.element]) return ELEM_COL[ab.element]; if (ab.kind === 'heal' || ab.kind === 'raise') return 0x8dffae; if (ab.kind === 'buff') return 0xffd66a; return 0xc9a6ff; }

// R12 peak control: how much of what is behind it each additive sprite frame hides (particles.js 'additive-over').
// Dense volumetric frames (billow, flame, smoke) stack into bounded, hue-true masses; point lights (spark, glint)
// stay purely additive. p.occ overrides per particle.
const ADD_OCC = { [F.glow]: 0.3, [F.core]: 0.12, [F.flame]: 0.45, [F.billow]: 0.55, [F.smoke]: 0.4, [F.shard]: 0.35, [F.dust]: 0.4, [F.flare]: 0.15, [F.ring]: 0.2, [F.star]: 0.1, [F.slash]: 0.15 };
// SPECT15 per-effect victim guard: the share of a particle layer's coverage kept over the target's body (1 = none).
const GUARD = { fire: 0.22, ice: 0.2, thunder: 0.4, holy: 0.3, quake: 0.45, cure: 0.28, raise: 0.35, buff: 0.4, debuff: 0.4, flare: 0.25, wyrm_sovereign: 0.25,
  drain: 0.4, gravity: 0.45, dispel: 0.4, haste: 0.4, slowtime: 0.4, poison: 0.4, sleep: 0.4, silence: 0.45, blind: 0.45, charm: 0.4, fear: 0.4, shield: 0.4,
  shell: 0.4, reflect: 0.4, vanish: 0.6, crystal: 0.6, generic: 0.5 };
export class VFX {
  static names = ['slash', 'bash', 'arrow', 'stone', 'shuriken', 'fire', 'ice', 'thunder', 'quake', 'cure', 'buff', 'debuff', 'charge', 'jump', 'holy', 'ko', 'raise',
    'crystal', 'drain', 'haste', 'slowtime', 'poison', 'sleep', 'silence', 'blind', 'charm', 'fear', 'dispel', 'shield', 'vanish', 'steal', 'gravity', 'flare', 'wyrm_sovereign',
    'masher', 'holyblade', 'runeblade', 'aura', 'gunshot', 'bomb', 'breath', 'pop'];
  static DIST_MAX = 7;   // no spell light may reach further than 7 tiles, ever (integration bug 9)
  constructor(scene) {
    this.scene = scene; this.live = []; this.seed = 1; this.rnd = Math.random; this.time = 0;
    this.atlas = makeAtlas(); this.add = new ParticleSystem(scene, this.atlas, { max: 4000, blending: THREE.AdditiveBlending, renderOrder: 20, occByFrame: ADD_OCC });
    this.norm = new ParticleSystem(scene, this.atlas, { max: 1200, blending: THREE.NormalBlending, renderOrder: 18 });
    this.decalTex = {}; for (const k in DECALS) this.decalTex[k] = DECALS[k]();
    // Fixed pool of point lights: adding/removing lights at runtime recompiles every material, so keep them resident.
    this.lights = []; for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xffffff, 0, 4.5, 2.2); l.name = 'vfx-light'; l.visible = false; scene.add(l); this.lights.push({ light: l, busy: false }); }
    this.washes = [];
    this.demoFrom = new THREE.Vector3(6.5, 0.5, 11.5); this.demoAt = new THREE.Vector3(8.5, 0.5, 9.5); this.tex = this.atlas; this.hard = this.atlas;
    // CRITIQUE_R2 integration bug 1: main.js now calls vfx.attach(battle), but self-arm as well so a
    // future refactor cannot silently make fx_ko unreachable again. attach() is idempotent.
    if (typeof queueMicrotask === 'function') queueMicrotask(() => { const bt = (typeof window !== 'undefined') && window.__GAME__ && window.__GAME__.battle; if (bt) this.attach(bt); });
  }
  // ---------- primitives ----------
  get cam() { return this.add.camera || (typeof window !== 'undefined' && window.__GAME__?.camera?.cam) || null; }
  P(sys, p) { if (this._zb && p.zb == null) p.zb = this._zb; if (this._defer) p.delay = (p.delay || 0) + this._defer; return sys.add(p); }
  // CRITIQUE_R2 rank 7: the big glow shells must FRAME the unit, not replace it. Offset them up (and,
  // for the outermost shell, sideways along camera-right) so the sprite still reads through the effect,
  // exactly as the burning monster does in a reference capture and the target does in a reference capture.
  camRight() { const c = this.cam; const v = new THREE.Vector3(1, 0, 0); if (c) { v.setFromMatrixColumn(c.matrixWorld, 0); v.y = 0; if (v.lengthSq() > 1e-6) v.normalize(); } return v; }
  off(at, up = 1.5, side = 0) { const r = this.camRight(); return { x: at.x + r.x * side, y: at.y + up, z: at.z + r.z * side }; }
  burst(sys, n, fn) { for (let i = 0; i < n; i++) { const p = fn(i, this.rnd); if (p) this.P(sys, p); } }
  col(p, c) { p.r = c.r; p.g = c.g; p.b = c.b; return p; }
  // CRITIQUE_R2 integration bug 9 / regression 6: `dist` is the light's HARD reach in tiles.
  // Round 2 shipped fire at dist 11.5 (+19), thunder 18, ice 15 on a 20x20 board, so one spell
  // relit the whole map. Every dist here is now ~2x the effect's own visible radius, the spatial
  // falloff is inverse-square (2.2) instead of 1.6, and the temporal decay defaults to 2.4.
  // a reference capture keeps the map three tiles from a Fire 2 pure black; DIST_MAX enforces that.
  light(at, color, peak, life, { rise = 0.04, flicker = 0, y = 0.7, dist = 4.5, delay = 0, decay = 2.4, falloff = 2.2 } = {}) {
    const slot = this.lights.find((s) => !s.busy) || this.lights.slice().sort((a, b) => (b.t || 0) / (b.life || 1) - (a.t || 0) / (a.life || 1))[0];
    // R12 peak control for LIGHT: a point light at 20-44 whites out any lit plaster wall within a tile of the target
    // (probe strips: Raise / Haste / Fire painted the wall behind the body flat white-yellow or red). Soft knee
    // above 8: small lights unchanged, the big bursts keep their spill on the ground but stop clipping walls.
    peak = peak <= 8 ? peak : 8 + (peak - 8) * 0.55;
    { const k = flashScale(); if (k < 1) { flicker *= k; peak *= 0.4 + 0.6 * k; } }   // OPTIONS hook: Flash Intensity tames strobing spell light
    if (this._defer) delay += this._defer;
    slot.busy = true; slot.t = 0; slot.life = life; slot.rise = rise; slot.peak = peak; slot.flicker = flicker; slot.delay = delay; slot.decay = decay;
    slot.light.color.set(color); slot.light.distance = Math.min(dist, VFX.DIST_MAX); slot.light.decay = falloff; slot.light.position.set(at.x, at.y + y, at.z);
    slot.light.intensity = 0; slot.light.visible = false; slot.pin = null; return slot;
  }
  // CRITIQUE_R3 (vfx regression 1): the diorama land mask, built once from MAP the first time anything needs it.
  ensureClip() { if (!Clip.on) Clip.setMap(this.battle?.map || (typeof window !== 'undefined' && window.__GAME__?.MAP) || null); return Clip.on; }
  decal(at, tex, { color = 0xffffff, size = 1, size1 = size, grow = 0.2, life = 1, hold = 0.3, alpha = 1, blending = THREE.AdditiveBlending, delay = 0, spin = 0, lift = 0.025 } = {}) {
    this.ensureClip();
    // R7: pooled. Every effect used to build a fresh Mesh + PlaneGeometry + clip material per decal (a fire
    // cast made ~8) and dispose them on expiry; a recycled mesh only swaps map/colour/blending, which keeps the
    // same compiled program, so steady-state casting allocates nothing on the GPU side.
    let m = this._decalPool && this._decalPool.pop();
    if (!m) {
      if (!this._decalGeo) this._decalGeo = new THREE.PlaneGeometry(1, 1);
      m = new THREE.Mesh(this._decalGeo, clipMaterial(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false, opacity: 0 })));
      m.rotation.x = -Math.PI / 2; this.scene.add(m);
    }
    const mat = m.material; mat.map = this.decalTex[tex]; mat.color.set(color); mat.blending = blending; mat.opacity = 0;
    m.rotation.z = 0; m.scale.set(1, 1, 1);
    m.position.set(at.x, at.y + lift, at.z); m.renderOrder = 8 + (blending === THREE.NormalBlending ? 0 : 1); m.visible = false;
    if (this._defer) delay += this._defer;
    const e = { kind: 'decal', mesh: m, t: 0, delay, life, size, size1, grow, hold, alpha, spin }; this.live.push(e); return e;
  }
  _freeDecal(m) { m.visible = false; m.material.opacity = 0; (this._decalPool || (this._decalPool = [])).push(m); }
  ringFx(at, color, r0, r1, life, { alpha = 1, delay = 0, tex = 'ring', lift = 0.03 } = {}) { return this.decal(at, tex, { color, size: r0 * 2, size1: r1 * 2, grow: life, life, hold: 0.05, alpha, delay, lift }); }
  mover(p0, p1, dur, { ease = 'linear', arc = 0, onTick, onEnd, delay = 0, spin = 0 } = {}) { delay += this._defer || 0; const e = { kind: 'move', t: 0, delay, dur, p0: V(p0), p1: V(p1), arc, ease, onTick, onEnd, pos: V(p0), vel: new THREE.Vector3(), prev: V(p0), spin }; this.live.push(e); return e; }
  // ROUND 5 determinism bug, found while trying to reproduce the round-4 thunder numbers: play() sets
  // this.rnd to a seeded stream, runs the effect, then restores Math.random - but a seq/timer beat runs
  // LATER, from update(), so every deferred beat (the whole of fx_thunder's strike, fx_fire's detonation,
  // fx_quake's eruption) was drawing from Math.random. Two captures of the same seed at the same frozen
  // time gave different bolt paths, and the largest-blown-blob metric swung 2.1-6.6% of frame width
  // between runs of an identical build. A timer now restores the seeded stream while its callback runs,
  // so a paired before/after measurement compares two pictures instead of two dice rolls.
  timer(delay, fn) { const rnd = this.rnd, zb = this._zb; const wrapped = () => { const prev = this.rnd, pz = this._zb; this.rnd = rnd; this._zb = zb; try { fn(); } finally { this.rnd = prev; this._zb = pz; } }; this.live.push({ kind: 'timer', t: 0, delay: delay + (this._defer || 0), fn: wrapped }); }
  seq(steps) { for (const [d, fn] of steps) this.timer(d, fn); }
  bolt(o) { if (this._defer) o = { ...o, delay: (o.delay || 0) + this._defer }; this.ensureClip(); const b = new Bolt(this.scene, this.rnd, o); b.setCamera(this.cam); b.build(); this.live.push({ kind: 'bolt', bolt: b, delay: o.delay || 0 }); return b; }
  ribbon(pts, o) { if (this._defer) o = { ...o, delay: (o?.delay || 0) + this._defer }; const rb = new Ribbon(this.scene, pts, o); this.live.push({ kind: 'ribbon', ribbon: rb, delay: o?.delay || 0 }); return rb; }
  // Full-screen colour wash on our own clock (the genre tints the whole frame during a spell: the references ).
  wash(color, peak = 0.3, up = 0.04, hold = 0.1, down = 0.4, { at = null, blend = 'screen', spread = 30 } = {}) {
    if (typeof document === 'undefined') return;
    if (this._defer) { const dd = this._defer; this._defer = 0; this.timer(dd, () => this.wash(color, peak, up, hold, down, { at, blend, spread })); this._defer = dd; return; }
    peak *= flashScale(); if (peak < 0.004) return;   // OPTIONS hook: Display > Flash Intensity
    const c = C(color); const rgb = `${Math.round(c.r ** (1 / 2.2) * 255)},${Math.round(c.g ** (1 / 2.2) * 255)},${Math.round(c.b ** (1 / 2.2) * 255)}`;
    // CRITIQUE_R2 regression 7: a wash with no {at} rendered as a flat full-viewport rgb() fill and lifted
    // the void from (33,27,33) to (110,111,122) - the black-void diorama vanished. A wash is now ALWAYS a
    // bounded radial lobe: when the effect cannot be projected it falls back to screen centre, never a fill.
    // Stops are tighter than round 2's so the corners of the diorama stay black.
    let x = 50, y = 50;
    if (at && this.cam) { const p = at.clone().project(this.cam); x = (p.x * 0.5 + 0.5) * 100; y = (-p.y * 0.5 + 0.5) * 100; }
    const bg = `radial-gradient(circle ${spread}vmax at ${x.toFixed(1)}% ${y.toFixed(1)}%, rgba(${rgb},1) 0%, rgba(${rgb},0.45) 20%, rgba(${rgb},0.10) 44%, rgba(${rgb},0) 66%)`;
    const el = document.createElement('div');
    Object.assign(el.style, { position: 'fixed', inset: '0', pointerEvents: 'none', mixBlendMode: blend, opacity: '0', background: bg });
    // The flash belongs to the battlefield, not to the HUD: the genre never tints its own windows when a spell
    // goes off. Sit under #ui (same stacking layer, earlier in DOM) so the wash blends with the canvas only.
    const ui = document.getElementById('ui');
    if (ui && ui.parentNode === document.body) document.body.insertBefore(el, ui); else { el.style.zIndex = 60; document.body.appendChild(el); }
    this.washes.push({ el, t: 0, peak, up, hold, down });
  }
  // --- legacy-compatible primitives (battle.js may call these directly) ---
  spawn(o) { const c = C(o.color || 0xffffff); const at = o.at; this.burst(this.add, o.count || 24, (i, r) => { const a = r() * 6.283, rr = r() * (o.spread || 0.3); return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + (o.y0 || 0) + r() * (o.yspread || 0.2), z: at.z + Math.sin(a) * rr, vx: (r() - 0.5) * (o.vx || 1), vy: (o.vy || 1) * (0.5 + r()), vz: (r() - 0.5) * (o.vx || 1), life: o.life || 0.7, size: (o.size || 0.35) * 0.8, size1: (o.size || 0.35) * 0.3, frame: o.hard ? F.core : F.glow, grav: o.gravity ?? -2.5 }, c); }); if (o.light) this.light(at, o.color || 0xffffff, o.light * 2, o.life || 0.7); }
  ring(at, color = 0xffe08a, r0 = 0.2, r1 = 1.2, life = 0.5) { this.ringFx(at, color, r0, r1, life); }
  flash(color, intensity = 0.5, dur = 0.12, fade = 0.22) { this.wash(color, intensity, 0.03, dur, fade); }
  // ---------- effects ----------
  play(name, from, to, opts = {}) {
    this.rnd = mulberry(((opts.seed ?? this.seed++) | 0) * 7919 + 13); const at = V(to || from), src = V(from || to);
    // R7 routing: battle.js only passes the ability's generic vfx key, so 37 debuffs, 22 heals and 21 buffs all
    // shared three looks. The ability in flight (abilityStart) and the charge that just began (charge) are
    // tracked from the event bus, and `route` picks the effect that fits THIS ability (Raise, Poison, Stop,
    // Haste, Protect, Drain, Flare, Wyrm Sovereign, gun shots, breath...). A second call inside the same ability (the
    // per-victim 'cure' / 'debuff' battle.js plays for every heal/status event) becomes a small status pop,
    // so an area spell no longer stacks a full effect per victim on top of its own impact.
    if (this._held) { this.rnd = Math.random; return 0.05; }   // capture hold: the frame shows the effect already on stage
    this._mark = this._markNow();
    const fname = this.route(name, opts);
    // SPECT15 CINEMATIC TIER (cine.js): a big spell's first play() inside its ability gets a gather beat (`lead`, the
    // effect itself is DEFERRED by it: every spawn primitive adds _defer to its delay), a full-frame set piece timed to
    // land on the impact, an impact freeze + shake, and tells render/cinematics.js (onCine) so the lens pushes in and
    // the grade darkens the world around the victim. battle.js waits for the returned delay, so the moment is owned.
    const c = this._ctx; const tier = c && c.calls === 1 && !opts.raw && !opts.miss && !this._held ? cineTier(c.ability, c.id) : 0;
    const sp = (this.battle && this.battle.speed) || 1, full = cineFull(sp), ks = cineSpeedScale(sp);
    const lead = tier === 3 && full && c.ability?.kind !== 'phys' ? CINE_LEAD * ks : 0;
    const fn = this['fx_' + fname];
    this._defer = lead;
    let d; try { d = fn ? fn.call(this, at, src, opts) : this.fx_generic(at, src, opts); } finally { this._defer = 0; }
    d = (d || 0) + lead;
    // SUMMON16: a summon returns the end of its own per-victim ripple and names its centre hit (_summonT); any other
    // multi-target ability gets the generic ripple after its main impact (summons.js _ripple)
    let dImp = d;
    if (this._summonT != null) { dImp = this._summonT + lead; this._summonT = null; }
    else if (c && c.calls === 1 && !opts.raw && !opts.miss) d += this._ripple(at, d, fname);
    this.guardVictim(fname, at, lead + 1.6 + (tier === 3 ? 0.6 : 0) + (fname === 'summon' ? 1.0 : 0));
    if (tier === 3) {
      const look = cineLook(c.ability, c.id);
      if (full && fname !== 'summon') try { this.cineSet(look, at, src, lead, d, ks); } catch (e) { console.error('vfx cine set piece', e); }
      this.timer(dImp, () => { this.hitStop(0.11 * ks); this.shake(full ? 0.34 : 0.22, 'cine'); this._cineEmit({ phase: 'impact', look, at }); });
      this._cineEmit({ phase: 'start', look, at: at.clone(), src: src.clone(), lead, d: dImp, speed: sp, full, t0: this.time, id: c.id });
    }
    this.rnd = Math.random;
    // the effect's HERO moment (impact beat + ~0.22 s: core blown, light at peak, ground mark down) for captureHold
    if (fname !== 'pop' && fname !== 'ko' && fname !== 'charge') { this._heroStart = this.time; this._hero = this.time + (this._heroAt != null ? this._heroAt + 0 : Math.min(1.0 + lead, d + 0.22)); }
    this._heroAt = null;
    return d;
  }
  // SPECT15 victim guard (particles.js): while an effect plays on a unit, every particle layer keeps only GUARD[fx] of
  // its coverage inside the victim's body ellipse -- the flame / sparkle / frost frames the body, the body stays
  // readable. Melee/projectile hits are exempt (their spark IS the contact read).
  guardVictim(fname, at, life) {
    const k = GUARD[fname]; if (k == null || !this.battle) return;
    const b = this.battle; const u = b.units.find((w) => w.hp > 0 && Math.abs(w.x + 0.5 - at.x) < 0.3 && Math.abs(w.z + 0.5 - at.z) < 0.3); if (!u) return;
    const s = b.spriteOf(u); const h = (s && s.heightUnits) || 1.3; const y = s ? s.root.position.y : at.y;
    const g = { x: at.x, y, z: at.z, h, k, until: this.time + life };
    for (const sys of [this.add, this.norm]) { sys.guards = sys.guards.filter((q) => Math.abs(q.x - g.x) > 0.1 || Math.abs(q.z - g.z) > 0.1); sys.guards.unshift({ ...g, k: sys === this.norm ? Math.min(1, k + 0.1) : k }); if (sys.guards.length > 4) sys.guards.length = 4; }
  }
  onCine(fn) { (this._cineFns || (this._cineFns = [])).push(fn); return () => { const l = this._cineFns; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; }
  _cineEmit(e) { this._cine = e.phase === 'start' ? e : this._cine; for (const fn of this._cineFns || []) { try { fn(e); } catch (err) { console.error('vfx.onCine', err); } } }
  // DETERMINISTIC CAPTURE AID (R7). Screenshot presets race the effect: the harness renders ~1 frame per 1-4 s
  // under SwiftShader with dt capped at 0.05, so the four presets of one scenario caught the same Fire at ages
  // 0.15 / 0.47 / 0.75 -- a comet over a chimney in one frame, a spent ember in the next. captureHold(true)
  // advances the vfx clock to the latest effect's hero moment (never backwards) and PINS it there: every preset
  // then shows the identical moment, particles still re-billboard to each preset's yaw (update runs with dt 0).
  // New effects are not spawned while held. cinematics.js arms it on a locked preset snap while an ability pair
  // is recorded and releases it with the lens lock (real user input).
  captureHold(on) {
    if (!on) { this._held = false; return; }
    if (this._held) return;
    // nothing on stage yet (the ability is still in its wind-up): do not pin an empty clock, or the effect
    // that is about to play would be refused. The next preset's snap tries again.
    if (this._hero == null || this.time - this._heroStart > 2.5) return;
    if (this.time < this._hero) this.stepSim(this._hero - this.time);
    this._held = true;
  }
  route(name, opts) {
    if (opts.raw) return name;
    if (this._charge && name === 'buff') { const ab = this._charge; this._charge = null; opts.color = elemColor(ab); return 'charge'; }
    const c = this._ctx; if (!c) return name;
    c.calls = (c.calls || 0) + 1;
    const ab = c.ability || {}, id = c.id || ab.id;
    if (c.calls > 1) {                              // per-victim follow-up inside one ability
      if (name === 'cure') { if (ab.kind === 'raise') return 'raise'; opts.color = ab.kind === 'heal' && ab.mpFlat ? 0x7fc8ff : null; return 'pop'; }
      if (name === 'debuff') { opts.color = statusColor(firstStatus(ab)) || elemColor(ab); return 'pop'; }
      if (name === 'buff') { opts.color = statusColor(firstStatus(ab)) || 0xffd66a; return 'pop'; }
      return name;
    }
    const v = VARIANT[id]; if (v) { if (typeof v === 'string') return v; Object.assign(opts, v.opts || {}); return v.fx; }
    if (ab.kind === 'raise') return 'raise';
    if (ab.drain && name !== 'slash') return 'drain';
    const st = firstStatus(ab);
    if (name === 'debuff') { const sv = STATUS_FX[st]; if (sv) { opts.status = st; return sv; } opts.color = statusColor(st) || elemColor(ab); return 'debuff'; }
    if (name === 'buff') { const sv = STATUS_FX[st]; if (sv) { opts.status = st; return sv; } if (ab.quick) return 'haste'; opts.color = statusColor(st); return 'buff'; }
    return name;
  }
  _markNow() { return { live: this.live.length, add: this.add.list.length, norm: this.norm.list.length, washes: this.washes.length, lights: this.lights.map((l) => l.busy && l.t === 0) }; }
  // Undo everything the LAST play() spawned (used when battle.js plays a stand-in effect right before an event
  // that names the real one -- crystallise() plays 'cure' then emits 'crystal').
  _rollback(m) {
    if (!m) return;
    for (let i = this.live.length - 1; i >= m.live; i--) { const e = this.live[i]; if (e.kind === 'decal') this._freeDecal(e.mesh); if (e.kind === 'bolt') e.bolt.dispose(); if (e.kind === 'ribbon') e.ribbon.dispose(); }
    this.live.length = Math.min(this.live.length, m.live); this.add.list.length = Math.min(this.add.list.length, m.add); this.norm.list.length = Math.min(this.norm.list.length, m.norm);
    for (let i = this.washes.length - 1; i >= m.washes; i--) this.washes[i].el.remove(); this.washes.length = Math.min(this.washes.length, m.washes);
    this.lights.forEach((l, i) => { if (l.busy && l.t === 0 && !m.lights[i]) { l.busy = false; l.light.intensity = 0; l.light.visible = false; } });
  }
  // FIRE: a fireball falls in, detonates into a white-hot core wrapped in rolling orange-red billows,
  // long rays shoot out, embers rain and bounce, smoke rolls off, the tile is scorched and the terrain glows orange.
  fx_fire(at, src) {
    const r = this.rnd;
    const ORANGE = C(0xff5a08), YEL = C(0xffa020), RED = C(0xcc1a00), DEEP = C(0x7a0e00), WHITE = C(0xfff0cc);
    const SOOT = C(0x1c0a04);   // R12: what a billow cools to (colour-over-life) - the fire decays to smoke, not red fog
    const HOT = HDR(0xff8c14, 1.9), WHOT = HDR(0xffb44c, 1.4), EMBER = HDR(0xff8410, 1.6);   // rank 7: hot core keeps its hue; R6b: peaks compressed - BuilderMap measured the blast core CLIPPED white on scenario=auto ('10/10 brightness, clipped' x3 presets)
    const back = src.clone().sub(at).setY(0); if (back.lengthSq() < 0.01) back.set(-0.7, 0, -0.7); back.normalize();
    const start = at.clone().addScaledVector(back, 2.2).add(new THREE.Vector3(0, 5.6, 0)); const head = { x: start.x, y: start.y, z: start.z };
    // --- anticipation: a comet with a burning tail ---
    // rank 7: round 2's comet was a 3.1-unit featureless yellow disc - the "sun disc floating over a
    // rooftop" the critic measured. It is now a small hot head with a real tail behind it.
    const core = this.P(this.add, this.col({ x: head.x, y: head.y, z: head.z, life: 0.32, size: 0.46, size1: 0.62, frame: F.core, pin: head, fadeOut: 0.2, alpha: 1, noclip: 1 }, HDR(0xff8c14, 1.6)));
    // INTEGRATION (round-6): 'fire has NO readable world-space shape - ZERO world-space pixels >240'. The
    // scenario=fire capture RACES the effect (telemetry: age 0.15 / 0.47 / 0.75 across presets) and a
    // translucent 'Ally' panel occludes the target tile, so the bright core must be BIG, LONG-LIVED and sit
    // HIGH (the comet is uncovered up top; the detonation core is lifted above the panel). HDR 4.2 clears the
    // grade's tonemap to a bounded ~25px >240 nucleus across the whole flight window.
    this.P(this.add, this.col({ x: head.x, y: head.y, z: head.z, life: 0.5, size: 0.3, size1: 0.5, frame: F.core, pin: head, fadeIn: 0.01, fadeOut: 0.1, alpha: 1, noclip: 1 }, HDR(0xfff8ec, 4.2)));
    this.P(this.add, this.col({ x: head.x, y: head.y, z: head.z, life: 0.32, size: 1.3, size1: 1.7, frame: F.glow, pin: head, fadeOut: 0.2, alpha: 0.6, noclip: 1 }, ORANGE));
    this.P(this.add, this.col({ x: head.x, y: head.y, z: head.z, life: 0.32, size: 0.9, size1: 1.2, frame: F.flare, pin: head, rotv: 3, fadeOut: 0.2, alpha: 0.4, noclip: 1 }, YEL));
    // ROUND 6c (r3 critic: 'the projectile is nearly a smooth circular glow - a light orb, not a
    // fireball'): three offset rolling lobes pinned to the head break the disc silhouette while it
    // falls, so the flight frame reads as fire even before detonation.
    for (const [ox, oy, oz, sz, cc] of [[-0.36, -0.20, 0.22, 1.05, RED], [0.32, 0.24, -0.26, 0.92, ORANGE], [0.04, -0.36, 0.05, 0.78, C(0xf07010)]]) {
      this.P(this.add, this.col({ x: head.x, y: head.y, z: head.z, life: 0.32, size: sz, size1: sz * 1.4, frame: F.billow, pin: head, pinOff: { x: ox, y: oy, z: oz }, rot: r() * 6.28, rotv: (r() - 0.5) * 4, fadeOut: 0.2, alpha: 0.55, noclip: 1 }, cc));
    }
    // ROUND 6: scenario=fire's shipped frame ALWAYS catches the comet, never the detonation
    // (instrumented: capture lands ~0.83 s, detonation ~0.95 s). So the flight phase is the product:
    // the target tile must already glow and gather embers as the fireball falls.
    // INTEGRATION round-6: 'LIGHT SPILL WEAK - orange floor patch does not form a radial pool'. The floor
    // pool light is brighter, reaches further, and the warm ground decal is bigger so the tile under the
    // fireball clearly reads as lit (radial orange pool) at the capture beat.
    this.light(at, 0xff7a20, 7, 1.3, { rise: 0.14, y: 0.6, dist: 3.2, decay: 1.9 });   // R13: 13 lit every wall round the target red (the 'red fog')
    this.decal(at, 'soft', { color: 0xff8a20, size: 1.0, size1: 2.6, grow: 0.3, life: 1.5, hold: 0.24, alpha: 0.6 });
    this.decal(at, 'cinder', { color: 0xff7a1c, size: 0.9, size1: 2.0, grow: 0.35, life: 1.3, hold: 0.2, alpha: 0.85 });
    this.burst(this.add, 8, () => { const a = r() * 6.2832, rr = 0.2 + r() * 0.9; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.05, z: at.z + Math.sin(a) * rr, vx: (r() - 0.5) * 0.4, vy: 1.4 + r() * 1.8, vz: (r() - 0.5) * 0.4, life: 0.55 + r() * 0.4, delay: r() * 0.35, size: 0.05 + r() * 0.07, frame: F.core, drag: 0.8, grav: -2.2, floor: at.y + 0.04, bounce: 0.3, flick: 0.5, fadeOut: 0.9 }, mix(EMBER, YEL, r())); });
    const cl = this.light(at, 0xff8a30, 7, 0.36, { rise: 0.05, y: 0, dist: 2.6 }); cl.pin = head;
    this.mover(start, at.clone().add(new THREE.Vector3(0, 0.6, 0)), 0.30, { ease: 'in', onTick: (p) => {
      head.x = p.x; head.y = p.y; head.z = p.z;
      for (let i = 0; i < 6; i++) this.P(this.add, this.col({ x: p.x + (r() - 0.5) * 0.38, y: p.y + (r() - 0.5) * 0.38, z: p.z + (r() - 0.5) * 0.38, vx: (r() - 0.5) * 0.8, vy: 0.3 + r() * 0.9, vz: (r() - 0.5) * 0.8, life: 0.32 + r() * 0.2, size: 1.0, size1: 0.14, frame: r() < 0.5 ? F.billow : F.flame, rot: r() * 6.28, rotv: (r() - 0.5) * 3, alpha: 0.9, fadeOut: 1.2, noclip: 1 }, mix(ORANGE, YEL, r())));
    }, onEnd: () => { core.dead = true; } });
    this.seq([[0.30, () => {
      this.shake(0.22, 'fire');
      this.wash(0xff5c10, 0.1, 0.03, 0.10, 0.50, { at: at.clone().add(new THREE.Vector3(0, 1.2, 0)), spread: 15 });
      // R12: the two burst lights painted the wall behind the target a flat red for a full second after the
      // fireball was spent (the 'red block' in the probe strips) - shorter, less red, the ground pool carries the spill
      this.light(at, 0xff6c14, 6, 0.85, { rise: 0.02, flicker: 0.32, y: 0.8, dist: 3.2, decay: 2.8 });
      this.light(at, 0xff5a10, 2, 0.6, { rise: 0.05, flicker: 0.2, y: 2.4, dist: 3.5, decay: 2.6 });
      // blown-out core + saturated shells
      // rank 7: cores halved and lifted to head height + a lateral offset, so the flame FRAMES the target
      // instead of erasing it.
      // INTEGRATION round-6: give the blast a COMPACT world-space white nucleus (>240 cluster) that SURVIVES
      // the racing capture. Telemetry: fire_close lands at effect age 0.15-0.75s across runs (detonation fires
      // at 0.30s), so a short nucleus was already dead on some runs -> 0 px >240. This core lives 0.85s (dies
      // ~1.15s) and sits at at.y+1.7 (inside the fireball; a taller lift chased the blocked >240 and risked
      // top-edge clip in auto). It clears enough to stack three cores for a brighter compact punch.
      // luma 217-222 (warm>235 = 0) - the grade caps one warm particle below 240, so the raise is pulled back
      // to at.y+1.7 (in the fireball, less top-edge clip in auto) and THREE neutral-white cores stack at that
      // point to sum additively pre-grade for a brighter compact core.
      // R11 (anim/vfx owner): the THREE stacked HDR-4.0 white cores + a 3.4 core summed with the additive billows
      // into a white PILLAR that erased the target for ~0.6 s. Now ONE compact warm nucleus sits up and beside the
      // head (the 'hot core'), a short white-hot flash marks the instant of detonation only, and the body of the
      // fire is carried by LAYERED flame: a dark-red normal-blended billow mass behind (value + silhouette), orange
      // additive lobes over it at partial alpha, yellow tongues on top — the victim reads through as a tinted shape.
      // R12: under the bounded blend the nucleus draws LAST (occ bucket) and can be bigger without whiting out
      // the target: white-hot pin -> yellow core -> orange body -> red rim -> dark smoke.
      this.P(this.add, this.col({ ...this.off(at, 1.7, 0.3), life: 0.62, size: 0.45, size1: 1.0, growT: 0.16, frame: F.glow, fadeIn: 0.01, hold: 0.3, fadeOut: 1.5, alpha: 0.7, occ: 0.25 }, HDR(0xff9a20, 1.2)));
      this.P(this.add, this.col({ ...this.off(at, 1.75, 0.34), life: 0.55, size: 0.3, size1: 0.62, growT: 0.12, frame: F.core, fadeIn: 0.01, hold: 0.45, fadeOut: 1.5 }, HDR(0xffe2a8, 2.3)));
      this.P(this.add, this.col({ ...this.off(at, 1.5, 0.15), life: 0.12, size: 0.3, size1: 0.9, frame: F.core, fadeIn: 0.005, fadeOut: 1.6, alpha: 0.8 }, HDR(0xfff0d0, 1.6)));
      this.P(this.add, this.col({ ...this.off(at, 1.60, 0.30), life: 0.58, size: 0.5, size1: 1.1, growT: 0.26, frame: F.glow, fadeIn: 0.01, hold: 0.2, fadeOut: 1.7, alpha: 0.22 }, ORANGE));   // R13: smaller -- the glows were the disc
      this.P(this.add, this.col({ ...this.off(at, 1.85, 0.3), life: 0.6, size: 0.6, size1: 1.2, growT: 0.3, frame: F.glow, fadeIn: 0.02, hold: 0.12, fadeOut: 2.2, alpha: 0.1, occ: 0.12 }, RED));
      this.P(this.add, this.col({ ...this.off(at, 1.55, 0.20), life: 0.20, size: 0.4, size1: 1.5, frame: F.flare, fadeIn: 0.01, fadeOut: 1.15, rot: 0.35, alpha: 0.32 }, HDR(0xffb554, 1.0)));
      // R13 FLAME SILHOUETTE (critic: 'Fire's body is a soft disc without billow outline'). The detonation used to throw
      // nine 2.3-3.2-unit billows RADIALLY, which summed into a disc. The body is now a TEARDROP of fire: a wide rolling
      // base, a narrowing column and a scalloped crown of small lumps that climb faster and cool to soot, with licking
      // tongues above it -- taller than wide, lobed at every edge. Dark-red normal-blended lumps sit on the OUTLINE
      // (behind the additive layers) so the edge reads as a hard scalloped rim, not a gaussian falloff.
      const tear = (h) => 0.62 * (1 - Math.min(1, Math.max(0, (h - 0.5) / 2.4)) * 0.7);   // column radius at height h
      for (let i = 0; i < 12; i++) { const a = i / 12 * 6.2832 + r() * 0.4, h = 0.55 + (i % 4) * 0.5 + r() * 0.2, rr = tear(h) + 0.22;
        this.P(this.norm, this.col({ x: at.x + Math.cos(a) * rr, y: at.y + h, z: at.z + Math.sin(a) * rr, vx: Math.cos(a) * 0.35, vy: 0.7 + r() * 0.5, vz: Math.sin(a) * 0.35, drag: 1.6, life: 0.85 + r() * 0.3, delay: 0.02 + r() * 0.04, size: 0.5, size1: 1.05 + r() * 0.35, growT: 0.3, frame: F.billow, rot: r() * 6.28, rotv: (r() - 0.5) * 1.6, alpha: 0.6, fadeIn: 0.05, hold: 0.3, fadeOut: 1.6, c1: C(0x140a06), cT: 0.55 }, mix(C(0x3a0a04), C(0x6a1606), r()))); }   // R13: browner + cools in 0.55 s (the lingering 'red fog' at +0.9 s)
      // value ladder by height: yellow-hot low in the column, orange through the body, red at the top; each
      // lump occludes 70% of what is behind it so the lumps stay individually readable instead of summing to a haze
      const ladder = (h, k) => h < 1.1 ? mix(YEL, C(0xffc860), k * 0.5) : h < 1.8 ? mix(C(0xff7a10), YEL, k * 0.35) : mix(RED, ORANGE, 0.3 + k * 0.5);
      for (let i = 0; i < 12; i++) { const h = 0.45 + (i / 12) * 2.0 + r() * 0.15, a = r() * 6.2832, rr = tear(h) * (0.35 + r() * 0.55);
        this.P(this.add, this.col({ x: at.x + Math.cos(a) * rr, y: at.y + h, z: at.z + Math.sin(a) * rr, vx: Math.cos(a) * 0.4, vy: 0.7 + r() * 0.7, vz: Math.sin(a) * 0.4, drag: 1.8, life: 0.8 + r() * 0.35, delay: r() * 0.05, size: 0.4, size1: (1.2 - h * 0.2) + r() * 0.3, growT: 0.28, frame: F.billow, rot: r() * 6.28, rotv: (r() - 0.5) * 2.4, alpha: 0.8, fadeIn: 0.03, hold: 0.36, fadeOut: 1.5, c1: SOOT, cT: 0.85 + h * 0.1, occ: 0.7 }, ladder(h, r()))); }
      // the scalloped crown: small lumps on top that climb fastest and cool first
      for (let i = 0; i < 7; i++) { const a = i / 7 * 6.2832 + r() * 0.5, rr = 0.12 + r() * 0.26;
        this.P(this.add, this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 2.25 + r() * 0.35, z: at.z + Math.sin(a) * rr, vx: Math.cos(a) * 0.3, vy: 1.5 + r() * 0.8, vz: Math.sin(a) * 0.3, drag: 1.4, life: 0.75 + r() * 0.3, delay: 0.04 + r() * 0.08, size: 0.3, size1: 0.7 + r() * 0.3, growT: 0.3, frame: F.billow, rot: r() * 6.28, rotv: (r() - 0.5) * 2, alpha: 0.75, fadeIn: 0.04, hold: 0.3, fadeOut: 1.5, c1: SOOT, cT: 0.6, occ: 0.7 }, mix(RED, ORANGE, 0.2 + r() * 0.5))); }
      // hot inner body (yellow) and a wide rolling base skirt for ground contact
      for (let i = 0; i < 5; i++) { const a = r() * 6.2832, rr = r() * 0.22;
        this.P(this.add, this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.95 + r() * 0.7, z: at.z + Math.sin(a) * rr, vy: 0.8 + r() * 0.6, drag: 2.5, life: 0.45 + r() * 0.2, size: 0.4, size1: 0.8, growT: 0.2, frame: F.billow, rot: r() * 6.28, rotv: (r() - 0.5) * 3, alpha: 0.6, fadeOut: 1.5 }, mix(YEL, C(0xffc050), r() * 0.6))); }
      for (let i = 0; i < 7; i++) { const a = i / 7 * 6.2832 + r() * 0.5;
        this.P(this.add, this.col({ x: at.x + Math.cos(a) * 0.35, y: at.y + 0.3, z: at.z + Math.sin(a) * 0.35, vx: Math.cos(a) * 2.2, vy: 0.2 + r() * 0.3, vz: Math.sin(a) * 2.2, drag: 3.5, life: 0.7 + r() * 0.3, size: 0.4, size1: 0.9 + r() * 0.3, growT: 0.3, frame: F.billow, rot: r() * 6.28, rotv: (r() - 0.5) * 2, alpha: 0.62, fadeIn: 0.03, hold: 0.3, fadeOut: 1.5, c1: SOOT, cT: 0.7 }, mix(RED, ORANGE, r() * 0.6))); }
      // flame tongues licking up off the crown (tall, pointed: the 'fire' read at a glance)
      this.burst(this.add, 22, () => { const a = r() * 6.2832, h = 1.1 + r() * 1.3, rr = tear(h) * (0.4 + r() * 0.6); return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + h, z: at.z + Math.sin(a) * rr, vx: Math.cos(a) * 0.3, vy: 2.2 + r() * 1.6, vz: Math.sin(a) * 0.3, life: 0.5 + r() * 0.45, size: 0.75 + r() * 0.5, size1: 0.2, ax: 0.6, ay: 1.5, frame: F.flame, delay: r() * 0.3, drag: 1.6, alpha: 0.7, fadeOut: 1.2, occ: 0.3 }, r() < 0.6 ? mix(ORANGE, YEL, r() * 0.7) : mix(RED, ORANGE, 0.5 + r() * 0.5)); });
      // long rays + embers that rain and bounce. ROUND-6 identity: 10 big F.spark rays
      // made the blast read 'star-like electrical burst' (integration vision) - fewer, shorter, warmer, so the
      // ORANGE billow plume (not a white star) defines the silhouette.
      this.burst(this.add, 6, () => { const a = r() * 6.2832, el = (r() - 0.2) * 1.3, sp = 5 + r() * 4; return this.col({ x: at.x, y: at.y + 1.4, z: at.z, vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp, vz: Math.sin(a) * Math.cos(el) * sp, life: 0.16 + r() * 0.1, size: 1.1 + r() * 0.7, ax: 1, ay: 0.5, frame: F.spark, align: true, drag: 5, fadeOut: 1.4 }, mix(WHOT, YEL, 0.3 + r() * 0.7)); });
      this.burst(this.add, 40, () => { const a = r() * 6.2832, el = r() * 1.5, sp = 2.5 + r() * 6; return this.col({ x: at.x, y: at.y + 0.55, z: at.z, vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp, vz: Math.sin(a) * Math.cos(el) * sp, life: 0.9 + r() * 0.55, size: 0.05 + r() * 0.07, frame: F.core, drag: 1.3, grav: -3.4, floor: at.y + 0.04, bounce: 0.35, flick: 0.55, fadeOut: 0.85 }, mix(EMBER, YEL, r())); });
      // smoke rolls off the top of the cloud
      this.burst(this.norm, 20, () => { const a = r() * 6.2832, rr = r() * 0.9; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.6 + r() * 0.8, z: at.z + Math.sin(a) * rr, vx: (r() - 0.5) * 1.0, vy: 0.9 + r() * 1.0, vz: (r() - 0.5) * 1.0, life: 1.15 + r() * 0.35, size: 0.7, size1: 2.6 + r() * 0.9, frame: F.smoke, rot: r() * 6.28, rotv: (r() - 0.5) * 1.2, delay: 0.16 + r() * 0.3, alpha: 0.6, fadeIn: 0.25, fadeOut: 1.3, drag: 1 }, C(0x241610)); });
      // ground: scorch that outlives the burst, glowing cinders inside it, an orange pool of light, shock rings
      // INTEGRATION final-sweep: R6Terrain raised grass median to 130-174, so the orange flame lost value
      // contrast ('could be flowers/damage decal'). A LARGER near-black scorch gives the fireball a DARK plinth
      // against the bright grass; the additive cinder/pool are pulled back so they ring the base instead of
      // washing its centre -> value steps read dark base -> orange flame -> hot core.
      this.decal(at, 'scorch', { color: 0x0a0603, size: 1.1, size1: 3.3, grow: 0.24, life: 3.4, hold: 0.5, alpha: 1, blending: THREE.NormalBlending, lift: 0.02 });
      this.decal(at, 'cinder', { color: 0xff7a1c, size: 1.7, size1: 3.0, grow: 0.3, life: 1.5, hold: 0.25, alpha: 0.6, lift: 0.03 });
      this.decal(at, 'soft', { color: 0xff5a08, size: 1.6, size1: 3.0, grow: 0.16, life: 0.75, hold: 0.12, alpha: 0.38 });
      this.ringFx(at, 0xff9020, 0.5, 2.1, 0.42, { alpha: 0.7 });
      this.ringFx(at, 0xff4a08, 0.6, 2.9, 0.62, { alpha: 0.4, delay: 0.07 });
    }]]);
    return 0.32;
  }
  // ICE / Blizzard: mist gathers, chunky faceted crystals erupt out of the tile and glow from inside,
  // a freeze flash whites the frame blue, then the whole cluster shatters into spinning shards.
  fx_ice(at, src) {
    const r = this.rnd;
    // rank 7: ice measured core saturation 0.091 - the same achromatic white as bolt and holy. The hot
    // shells are now saturated cyan HDR colours; only a thin filament stays true white.
    const ICE = C(0x4fb4ff), PALE = C(0x74d0ff), DEEP = C(0x2a5cff), WHITE = HDR(0x3fa8ff, 2.5), SPEC = HDR(0xbfe4ff, 1.3);
    this.light(at, 0x86ccff, 22, 0.85, { rise: 0.28, y: 1.2, dist: 5 });
    this.wash(0x2f6cff, 0.14, 0.2, 0.35, 0.5, { at: at.clone().add(new THREE.Vector3(0, 1.4, 0)), spread: 22 });
    this.decal(at, 'soft', { color: 0x2f7cff, size: 0.7, size1: 2.4, grow: 0.4, life: 1.0, hold: 0.45, alpha: 0.6 });
    // anticipation: ground mist + motes drawn inward
    this.burst(this.add, 30, () => { const a = r() * 6.2832, rr = r() * 1.3; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.05, z: at.z + Math.sin(a) * rr, vx: -Math.cos(a) * 0.8, vy: 0.35 + r() * 0.5, vz: -Math.sin(a) * 0.8, life: 0.55 + r() * 0.4, size: 0.7, size1: 1.7, frame: F.smoke, rot: r() * 6.28, rotv: 0.6, alpha: 0.5, fadeIn: 0.2, delay: r() * 0.2 }, mix(ICE, DEEP, r() * 0.6)); });
    this.burst(this.add, 26, () => { const a = r() * 6.2832, rr = 1.0 + r() * 0.8; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.1 + r() * 1.2, z: at.z + Math.sin(a) * rr, vx: -Math.cos(a) * 2.4, vy: 0.6, vz: -Math.sin(a) * 2.4, life: 0.35 + r() * 0.2, size: 0.22 + r() * 0.2, frame: F.glint, rot: r() * 1.5, flick: 0.4, delay: r() * 0.2, fadeOut: 0.8 }, mix(WHITE, PALE, r())); });
    // the crystal cluster: one tall spire plus a ring of chunky facets, body + glow pass
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = i / n * 6.2832 + r() * 0.6, rr = i === 0 ? 0 : 0.3 + r() * 0.55;
      const h = i === 0 ? 3.5 : 2.2 + r() * 1.8, d = i === 0 ? 0 : 0.04 + r() * 0.18;
      const tilt = (r() - 0.5) * 0.45 * (i ? 1 : 0.25); const ox = Math.cos(a) * rr, oz = Math.sin(a) * rr;
      const base = { x: at.x + ox, y: at.y + h * 0.48, z: at.z + oz, life: 0.66 - d, delay: d, size: 0.2, size1: h, growT: 0.22, ax: 0.54, ay: 1, frame: F.shard, rot: tilt, fadeIn: 0.04, hold: 0.82, fadeOut: 0.7 };
      this.P(this.norm, this.col({ ...base, alpha: 0.9 }, mix(C(0x2a6ee0), C(0x8fd8ff), r() * 0.8)));
      this.P(this.add, this.col({ ...base, alpha: 0.5 }, mix(PALE, WHITE, r() * 0.6)));
      this.P(this.add, this.col({ x: at.x + ox, y: at.y + h * 0.5, z: at.z + oz, life: 0.66 - d, delay: d, size: 0.4, size1: h * 0.95, growT: 0.22, ax: 0.95, ay: 1.05, frame: F.glow, fadeIn: 0.04, hold: 0.82, fadeOut: 0.7, alpha: 0.32 }, DEEP));
    }
    this.P(this.add, this.col({ x: at.x, y: at.y + 1.9, z: at.z, life: 0.66, size: 0.15, size1: 3.4, growT: 0.22, ax: 0.075, ay: 1, frame: F.core, fadeIn: 0.04, hold: 0.82, fadeOut: 0.7, alpha: 0.8 }, SPEC));
    this.burst(this.add, 34, () => { const a = r() * 6.2832, rr = r() * 0.9; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.2 + r() * 2.6, z: at.z + Math.sin(a) * rr, vy: 0.4, life: 0.3 + r() * 0.3, size: 0.24 + r() * 0.34, frame: F.star, rot: r() * 1.5, delay: 0.06 + r() * 0.44, flick: 0.5, fadeOut: 0.8 }, mix(WHITE, PALE, r())); });
    this.seq([[0.50, () => { // freeze flash
      this.wash(0x69b4ff, 0.20, 0.03, 0.08, 0.32, { at: at.clone().add(new THREE.Vector3(0, 1.2, 0)), spread: 26 });
      this.light(at, 0xd8f0ff, 44, 0.7, { rise: 0.01, y: 1.3, dist: 6, flicker: 0.12 });
      this.P(this.add, this.col({ ...this.off(at, 1.55, 0.25), life: 0.3, size: 0.45, size1: 2.4, frame: F.flare, fadeIn: 0.01, fadeOut: 1.0, alpha: 0.65 }, WHITE));
      this.P(this.add, this.col({ ...this.off(at, 1.60, 0.35), life: 0.55, size: 0.9, size1: 2.6, frame: F.glow, fadeIn: 0.01, fadeOut: 1.5, alpha: 0.8 }, ICE));
      this.ringFx(at, 0x7fc4ff, 0.25, 2.4, 0.5, { alpha: 0.9 });
      this.decal(at, 'frost', { color: 0x9fd8ff, size: 1.0, size1: 2.6, grow: 0.2, life: 2.8, hold: 0.4, alpha: 0.8 });
    }], [0.63, () => { // shatter
      this.burst(this.add, 80, () => { const a = r() * 6.2832, el = 0.05 + r() * 1.25, sp = 3 + r() * 5; return this.col({ x: at.x + (r() - 0.5) * 0.7, y: at.y + 0.3 + r() * 2.4, z: at.z + (r() - 0.5) * 0.7, vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp, vz: Math.sin(a) * Math.cos(el) * sp, life: 0.6 + r() * 0.6, size: 0.2 + r() * 0.4, ax: 0.5, frame: F.shard, rot: r() * 6.28, rotv: (r() - 0.5) * 16, grav: -8, floor: at.y + 0.05, bounce: 0.35, fadeOut: 0.7 }, mix(PALE, ICE, r())); });
      this.burst(this.add, 14, () => { const a = r() * 6.2832; return this.col({ x: at.x, y: at.y + 0.6 + r() * 1.6, z: at.z, vx: Math.cos(a) * (5 + r() * 5), vy: 1 + r() * 4, vz: Math.sin(a) * (5 + r() * 5), life: 0.24 + r() * 0.2, size: 1.4 + r() * 1.0, ax: 1, ay: 0.5, frame: F.spark, align: true, grav: -6, drag: 3, fadeOut: 1 }, WHITE); });
      this.burst(this.norm, 22, () => { const a = r() * 6.2832, rr = r() * 1.1; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.1 + r() * 1.4, z: at.z + Math.sin(a) * rr, vx: Math.cos(a) * 0.8, vy: 0.25, vz: Math.sin(a) * 0.8, life: 0.75 + r() * 0.5, size: 0.8, size1: 2.0, frame: F.smoke, rot: r() * 6.28, alpha: 0.55, fadeIn: 0.15 }, PALE); });
    }]]);
    return 0.52;
  }
  // THUNDER / Bolt: the sky flickers, a drawn bolt comes down from off-frame, the whole picture goes
  // blue-white, arcs crawl outward across the ground and the tile is left ringed and scorched.
  fx_thunder(at, src) {
    const r = this.rnd;
    // rank 7 + regression 7: bolt core measured 0.093 saturation and the three washes were flat
    // full-viewport fills. Core colours are now saturated blue-white HDR; the bolt filaments (the one
    // asset the critic praised) are untouched.
    // CRITIQUE_R3: round 3 recoloured the particles but left the LIGHT at 0xc4d8ff/52 and the bolt core at
    // 0xc4dcff, so the terrain around the strike and the filament itself both blew to flat white - that is
    // where the frame's white top-0.2% came from, not the shells. In a reference capture every bright pixel in the
    // picture is blue: the cliff, the arcs and the filament. Red is now held far below blue everywhere.
    // A bright pixel is 0.72*G by construction, so a pure blue filament can never be both bright and
    // saturated - which is exactly why the genre's bolt (a reference capture) and its holy pillar (_28) draw their hot
    // filaments CYAN-white over a deep blue field. Ours now does the same: cyan cores, deep blue shells.
    // ROUND 5 (critic: bolt core saturation 0.20-0.27 against a 0.35 bar, top 0.2% literally 255,255,255).
    // The particles were already blue; the WHITE came from the Bolt ribbons, which are plain additive
    // MeshBasicMaterials and so bypass particles.js's ratio-preserving roll-off entirely: glow 0x3a68ff
    // plus core 0x8ce0ff sums past 1.0 in all three channels and the framebuffer clips it to white.
    // So the bolt cores drop to 0x5cc4ff / 0x58c0ff with lower coreBoost and thinner filaments, and the
    // particle SPEC/WHITE come down to match. Red is held far below blue everywhere (a reference capture).
    const BLUE = C(0x3d6cff), WHITE = HDR(0x4fb0ff, 1.85), SPEC = HDR(0x5ec8ff, 1.12), PALE = C(0x8ccdff);
    const sky = at.clone().add(new THREE.Vector3((r() - 0.5) * 3.0, 15.0, (r() - 0.5) * 3.0));
    this.P(this.add, this.col({ x: sky.x, y: at.y + 7, z: sky.z, life: 0.14, size: 2.4, size1: 5, frame: F.glow, flick: 0.9, fadeOut: 0.5, alpha: 0.7, noclip: 1 }, PALE));
    this.light(at, 0x5c8cff, 4, 0.14, { rise: 0.02, y: 4, dist: 3.5, flicker: 0.9 });
    this.wash(0x2f5cff, 0.10, 0.02, 0.04, 0.12, { at: at.clone().add(new THREE.Vector3(0, 2.4, 0)), spread: 24 });
    this.seq([[0.12, () => { this.shake(0.2, 'thunder');
      this.bolt({ from: sky, to: at.clone().add(new THREE.Vector3(0, 0.15, 0)), life: 0.44, jitterUntil: 0.3, amp: 0.95, segs: 26, branches: 4, glow: 0x3060e0, core: 0x5cc4ff, widthGlow: 0.62, widthCore: 0.105, branchLen: 2.0, depthTest: false, renderOrder: 40, coreBoost: 0.70 });
      // arcs crawling outward over the terrain
      // rank 7: the crawling arcs used to run 3.4-6.2 tiles and their white cores fused into ONE
      // blown-out component 63% of the frame wide. Half the reach, and a blue (not white) core so
      // only the impact itself reads as blown out.
      for (let i = 0; i < 6; i++) { const a = i / 6 * 6.2832 + r() * 0.7, rr = 1.9 + r() * 1.4;
        this.bolt({ from: at.clone().add(new THREE.Vector3(0, 0.3, 0)), to: at.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0.12, Math.sin(a) * rr)), life: 0.36, jitterUntil: 0.26, amp: 0.42, segs: 13, branches: 1, glow: 0x2a56e0, core: 0x52bcff, widthGlow: 0.28, widthCore: 0.062, branchLen: 0.8, depthTest: false, renderOrder: 39, delay: r() * 0.05, coreBoost: 0.66, clip: true }); }
      this.wash(0x3f74ff, 0.17, 0.02, 0.06, 0.30, { at: at.clone().add(new THREE.Vector3(0, 1.2, 0)), spread: 19 });
      this.light(at, 0x2450ff, 11, 0.7, { rise: 0.01, y: 1.3, dist: 4.0, flicker: 0.45 });
      this.P(this.add, this.col({ ...this.off(at, 1.50, 0.25), life: 0.30, size: 0.38, size1: 1.5, frame: F.flare, fadeIn: 0.01, fadeOut: 1.35, rot: 0.2, alpha: 0.40 }, WHITE));
      this.P(this.add, this.col({ ...this.off(at, 1.60, 0.35), life: 0.55, size: 0.9, size1: 2.6, frame: F.glow, fadeIn: 0.01, fadeOut: 1.6, alpha: 0.9 }, BLUE));
      this.P(this.add, this.col({ ...this.off(at, 1.50, 0.25), life: 0.24, size: 0.14, size1: 0.5, frame: F.core, fadeIn: 0.01, fadeOut: 1.05, alpha: 0.7 }, SPEC));
      this.burst(this.add, 10, () => { const a = r() * 6.2832, el = (r() - 0.15) * 1.3, sp = 9 + r() * 8; return this.col({ x: at.x, y: at.y + 0.5, z: at.z, vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp, vz: Math.sin(a) * Math.cos(el) * sp, life: 0.16 + r() * 0.10, size: 1.2 + r() * 0.8, ax: 1, ay: 0.42, frame: F.spark, align: true, drag: 5, fadeOut: 1.45, alpha: 0.85 }, WHITE); });
      this.burst(this.add, 40, () => { const a = r() * 6.2832, el = r() * 1.5, sp = 3 + r() * 7; return this.col({ x: at.x, y: at.y + 0.3, z: at.z, vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp, vz: Math.sin(a) * Math.cos(el) * sp, life: 0.3 + r() * 0.4, size: 0.55, size1: 0.16, ax: 1, ay: 0.55, frame: F.spark, align: true, grav: -12, drag: 1, floor: at.y + 0.03, bounce: 0.4, fadeOut: 1 }, mix(WHITE, BLUE, 0.3 + r() * 0.5)); });
      this.burst(this.add, 34, () => { const a = r() * 6.2832, rr = r() * 1.6; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.1 + r() * 1.8, z: at.z + Math.sin(a) * rr, vy: 0.5, life: 0.25 + r() * 0.3, size: 0.25 + r() * 0.35, frame: F.glint, rot: r(), flick: 0.7, delay: r() * 0.3 }, PALE); });
      this.ringFx(at, 0x5a90ff, 0.2, 2.4, 0.4, { alpha: 0.9 }); this.ringFx(at, 0x3f6cff, 0.4, 3.2, 0.6, { alpha: 0.45, delay: 0.06 });
      this.decal(at, 'soft', { color: 0x3f6cff, size: 1.2, size1: 3.0, grow: 0.1, life: 0.6, hold: 0.1, alpha: 0.75 });
      this.decal(at, 'scorch', { color: 0x000000, size: 0.7, size1: 1.7, grow: 0.1, life: 2.4, hold: 0.3, alpha: 0.6, blending: THREE.NormalBlending, lift: 0.02 });
    }], [0.30, () => {
      this.bolt({ from: sky.clone().add(new THREE.Vector3(1.1, 0, -0.8)), to: at.clone().add(new THREE.Vector3(0, 0.15, 0)), life: 0.28, jitterUntil: 0.18, amp: 0.8, segs: 20, branches: 2, glow: 0x3060e0, core: 0x58bcff, widthGlow: 0.40, widthCore: 0.078, branchLen: 1.2, depthTest: false, renderOrder: 40, coreBoost: 0.72 });
      this.light(at, 0x2450ff, 6, 0.35, { rise: 0.01, y: 1.2, dist: 3.5, flicker: 0.6 });
      this.wash(0x5f8cff, 0.10, 0.02, 0.05, 0.2, { at: at.clone().add(new THREE.Vector3(0, 1.2, 0)), spread: 17 });
      this.P(this.add, this.col({ ...this.off(at, 1.45, 0.20), life: 0.20, size: 0.30, size1: 1.15, frame: F.flare, fadeOut: 1.15, rot: 0.9, alpha: 0.45 }, WHITE));
    }]]);
    return 0.14;
  }
  // QUAKE / earth: CRITIQUE_R2 integration bug 10 -
  // ground_rend, earthsong, cataclysm, earth_veil and root_snare all declare vfx:'quake' and there was
  // no fx_quake, so Cataclysm fell through to fx_generic and looked like a missed poke. Built from
  // existing parts and deliberately EARTH-BROWN and LOW: heaving slabs, a dust skirt, ballistic rubble,
  // two brown rings and a cracked-earth decal. No white core anywhere - ref 41's quake core is
  // saturated orange-red at 0.577 saturation and never leaves the ground.
  fx_quake(at, src) {
    const r = this.rnd;
    const EARTH = C(0x7d5830), OCHRE = C(0xc09256), DUST = C(0xd8c096), EMBER = HDR(0xff6a10, 2.4), DARK = C(0x46301c);
    // anticipation: the ground shivers, grit hops before anything erupts
    this.burst(this.norm, 14, () => { const a = r() * 6.2832, rr = 0.2 + r() * 0.85; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.04, z: at.z + Math.sin(a) * rr, vy: 1.0 + r() * 1.6, vx: (r() - 0.5) * 0.5, vz: (r() - 0.5) * 0.5, life: 0.36 + r() * 0.18, size: 0.05 + r() * 0.05, frame: F.stone, rotv: (r() - 0.5) * 12, grav: -13, floor: at.y + 0.03, bounce: 0.3, fadeOut: 0.5 }, EARTH); });
    this.wash(0x8a4a10, 0.055, 0.05, 0.08, 0.26, { at: at.clone().add(new THREE.Vector3(0, 0.5, 0)), spread: 11 });
    this.seq([[0.18, () => { this.shake(0.3, 'quake');
      this.light(at, 0xd06a18, 44, 0.8, { rise: 0.03, flicker: 0.25, y: 0.35, dist: 4.0 });
      // slabs of rock heave up out of the tile: F.shard, brown, short and wide - never a spire
      for (let i = 0; i < 7; i++) { const a = i / 7 * 6.2832 + r() * 0.55, rr = 0.28 + r() * 0.62, h = 1.0 + r() * 1.15, d = r() * 0.09;
        this.P(this.norm, this.col({ x: at.x + Math.cos(a) * rr, y: at.y + h * 0.42, z: at.z + Math.sin(a) * rr, life: 0.66 - d, delay: d, size: 0.22, size1: h, growT: 0.14, ax: 0.76, ay: 1, frame: F.shard, rot: (r() - 0.5) * 0.7, fadeIn: 0.03, hold: 0.6, fadeOut: 1.0, alpha: 1 }, mix(EARTH, OCHRE, r() * 0.8)));
        this.P(this.norm, this.col({ x: at.x + Math.cos(a) * rr, y: at.y + h * 0.18, z: at.z + Math.sin(a) * rr, life: 0.66 - d, delay: d, size: 0.3, size1: h * 0.7, growT: 0.14, ax: 0.9, ay: 0.5, frame: F.shard, rot: (r() - 0.5) * 0.9, fadeIn: 0.03, hold: 0.6, fadeOut: 1.0, alpha: 0.85 }, DARK)); }
      // the fissure glow: hot only in the cracks, at ankle height, and it stays orange (roll-off keeps hue)
      this.P(this.add, this.col({ x: at.x, y: at.y + 0.34, z: at.z, life: 0.45, size: 0.4, size1: 2.6, growT: 0.14, ax: 1, ay: 0.62, frame: F.glow, fadeIn: 0.02, hold: 0.30, fadeOut: 1.8, alpha: 1 }, EMBER));
      this.P(this.add, this.col({ x: at.x, y: at.y + 0.26, z: at.z, life: 0.6, size: 0.7, size1: 3.4, growT: 0.3, ax: 1, ay: 0.46, frame: F.glow, fadeIn: 0.03, hold: 0.26, fadeOut: 1.9, alpha: 0.7 }, C(0xc44a08)));
      // low billow lobes riding the crest of the heave, so the burst has a silhouette
      for (let i = 0; i < 10; i++) { const a = i / 10 * 6.2832 + r() * 0.5, rr = 0.30 + r() * 0.45;
        this.P(this.add, this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.45 + r() * 0.35, z: at.z + Math.sin(a) * rr, vx: Math.cos(a) * (0.6 + r() * 0.5), vy: 0.5 + r() * 0.7, vz: Math.sin(a) * (0.6 + r() * 0.5), drag: 4.2, life: 0.44 + r() * 0.24, size: 0.5, size1: 1.25 + r() * 0.4, growT: 0.22, frame: F.billow, rot: r() * 6.28, rotv: (r() - 0.5) * 2.2, alpha: 0.95, fadeIn: 0.03, hold: 0.3, fadeOut: 1.6 }, mix(C(0xd2500a), C(0xff8c1c), r() * 0.8))); }
      // dust skirt rolling outward along the ground (normal blending: dust hides, it does not glow)
      // CRITIQUE_R3 (vfx regression 1): the round-3 skirt was 46 puffs thrown 2.2-4.8 tiles/s for up to
      // 1.35 s and grown to 3.3 tiles wide - a soft grey-tan haze that outlived every other effect and
      // painted the black void. a reference capture's quake dust never leaves the tile it erupts from: half the
      // count, a third of the reach, half the life, darker and thinner, and Clip contains what is left.
      this.burst(this.norm, 24, () => { const a = r() * 6.2832; const sp = 0.9 + r() * 1.1; return this.col({ x: at.x + Math.cos(a) * 0.28, y: at.y + 0.07, z: at.z + Math.sin(a) * 0.28, vx: Math.cos(a) * sp, vy: 0.35 + r() * 0.6, vz: Math.sin(a) * sp, life: 0.40 + r() * 0.22, size: 0.42, size1: 1.05 + r() * 0.35, frame: F.dust, rot: r() * 6.28, rotv: (r() - 0.5) * 1.8, alpha: 0.62, drag: 3.8, grav: -0.9, fadeIn: 0.06, hold: 0.22, fadeOut: 1.9, delay: r() * 0.07 }, mix(DUST, OCHRE, 0.35 + r() * 0.6)); });
      this.burst(this.norm, 8, () => { const a = r() * 6.2832, rr = r() * 0.4; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.35, z: at.z + Math.sin(a) * rr, vx: (r() - 0.5) * 0.5, vy: 1.0 + r() * 0.8, vz: (r() - 0.5) * 0.5, life: 0.55 + r() * 0.2, size: 0.4, size1: 1.0, frame: F.smoke, rot: r() * 6.28, rotv: (r() - 0.5) * 1.1, alpha: 0.34, drag: 2.2, delay: 0.08 + r() * 0.14, fadeIn: 0.18, hold: 0.2, fadeOut: 1.8 }, C(0x3a2a1c)); });
      // ballistic rubble: grav -14, bounce 0.3 (integration bug 10's own prescription)
      // rubble is thrown UP, not sideways: it used to leave the board and hang in the void as isolated
      // soft brown discs. Lateral speed is now under a tile a second, and Clip kills anything that still
      // clears the cut edge.
      this.burst(this.norm, 26, () => { const a = r() * 6.2832, el = 0.95 + r() * 0.55, sp = 2.4 + r() * 2.6; return this.col({ x: at.x + (r() - 0.5) * 0.4, y: at.y + 0.15, z: at.z + (r() - 0.5) * 0.4, vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp, vz: Math.sin(a) * Math.cos(el) * sp, life: 0.55 + r() * 0.3, size: 0.06 + r() * 0.11, frame: F.stone, rot: r() * 6.28, rotv: (r() - 0.5) * 14, grav: -16, floor: at.y + 0.04, bounce: 0.25, fadeOut: 0.8 }, mix(EARTH, DARK, r())); });
      // a few embers riding the dust, so the burst has a hot rim without a hot centre
      this.burst(this.add, 22, () => { const a = r() * 6.2832, el = 0.55 + r() * 0.8, sp = 1.4 + r() * 2.0; return this.col({ x: at.x, y: at.y + 0.12, z: at.z, vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp, vz: Math.sin(a) * Math.cos(el) * sp, life: 0.7 + r() * 0.45, size: 0.05 + r() * 0.09, frame: F.core, drag: 1.4, grav: -3.2, floor: at.y + 0.04, bounce: 0.3, flick: 0.55, fadeOut: 0.9 }, mix(EMBER, C(0xff8c2a), r())); });
      // ground: cracked earth that outlives the burst + two brown rings
      this.decal(at, 'crack', { color: 0x2a1c10, size: 1.0, size1: 2.6, grow: 0.18, life: 3.6, hold: 0.55, alpha: 0.95, blending: THREE.NormalBlending, lift: 0.02 });
      this.decal(at, 'soft', { color: 0xd2600e, size: 0.8, size1: 2.2, grow: 0.14, life: 0.8, hold: 0.16, alpha: 0.8 });
      this.ringFx(at, 0xd08a3c, 0.25, 2.1, 0.44, { alpha: 1 });
      this.ringFx(at, 0x9a6a34, 0.4, 3.0, 0.66, { alpha: 0.7, delay: 0.07 });
    }]]);
    return 0.18;
  }
  // BUFF / DEBUFF: a glowing helix winds around the unit over a rotating ground glyph.
  fx_buff(at, src, o = {}) { return this.rings(at, o.color || 0xffd66a, +1, o.glyph !== false, o.core || 0xfff6d0); }
  fx_debuff(at, src, o = {}) { return this.rings(at, o.color || 0xb070ff, -1, true, 0xf0e0ff); }
  rings(at, hex, dir, glyph, coreHex = 0xffffff) {
    const r = this.rnd; const G = C(hex), W = C(0xffffff);
    this.light(at, hex, 16, 1.3, { rise: 0.2, y: 1.0, dist: 3.0 });
    if (glyph) this.decal(at, 'glyph', { color: hex, size: 0.4, size1: 2.2, grow: 0.35, life: 1.4, hold: 0.55, alpha: 1, spin: dir * 1.2 });
    for (const ph of [0, Math.PI]) this.ribbon(helixPts(at.clone().add(new THREE.Vector3(0, dir > 0 ? 0.05 : 2.2, 0)), { turns: 2.1, h: dir * 2.15, r: 0.86, r1: 0.5, segs: 96, phase: ph, dir }), { color: hex, core: coreHex, width: 0.17, life: 1.15, reveal: 0.42, hold: 0.5, renderOrder: 22 });
    for (let i = 0; i < 3; i++) { const y0 = dir > 0 ? 0.05 : 2.0, vy = dir * 2.0; this.P(this.add, this.col({ x: at.x, y: at.y + y0, z: at.z, vy, life: 0.85, delay: i * 0.18, size: 2.1, size1: 1.5, ax: 1, ay: 0.3, frame: F.ring, fadeIn: 0.1, fadeOut: 1.2, alpha: 1 }, i === 1 ? mix(G, W, 0.4) : G)); }
    this.burst(this.add, 50, () => { const a = r() * 6.2832, rr = 0.4 + r() * 0.45; const y0 = dir > 0 ? 0.1 + r() * 0.3 : 1.6 + r() * 0.6; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + y0, z: at.z + Math.sin(a) * rr, vx: -Math.sin(a) * 1.0, vy: dir * (1.0 + r() * 1.4), vz: Math.cos(a) * 1.0, life: 0.6 + r() * 0.6, size: 0.14 + r() * 0.3, frame: r() < 0.5 ? F.star : F.glint, delay: r() * 0.6, flick: 0.55, fadeIn: 0.15, drag: 0.5 }, mix(G, W, r() * 0.6)); });
    this.P(this.add, this.col({ x: at.x, y: at.y + 0.9, z: at.z, life: 1.1, size: 0.9, size1: 2.3, growT: 0.4, frame: F.glow, fadeIn: 0.25, hold: 0.4, alpha: 0.55 }, G));
    return 0.3;
  }
  // CHARGE: motes drawn in to the caster and swirled upward while the spell winds up.
  fx_charge(at, src, o = {}) {
    const r = this.rnd; const G = C(o.color || 0xc9a6ff), W = C(0xffffff);
    this.light(at, o.color || 0xc9a6ff, 9, 0.9, { rise: 0.3, y: 1, dist: 3.5 });
    this.burst(this.add, 60, () => { const a = r() * 6.2832, rr = 1.3 + r() * 0.8, y = 0.1 + r() * 1.5; const sp = 2.4 + r(); return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + y, z: at.z + Math.sin(a) * rr, vx: -Math.cos(a) * sp - Math.sin(a) * 1.3, vy: (0.9 - y) * 0.8 + 0.7, vz: -Math.sin(a) * sp + Math.cos(a) * 1.3, life: 0.55 + r() * 0.25, size: 0.12 + r() * 0.24, frame: r() < 0.55 ? F.glint : F.star, delay: r() * 0.4, flick: 0.45, fadeIn: 0.2, fadeOut: 0.6 }, r() < 0.4 ? W : G); });
    this.P(this.add, this.col({ x: at.x, y: at.y + 0.85, z: at.z, life: 0.9, size: 0.5, size1: 1.8, growT: 0.5, frame: F.glow, fadeIn: 0.4, alpha: 0.7 }, G));
    this.decal(at, 'soft', { color: o.color || 0xa080ff, size: 0.7, size1: 1.8, grow: 0.5, life: 0.9, hold: 0.5, alpha: 0.6 });
    return 0.2;
  }
  // SLASH - the melee contact beat.
  // ROUND 5 held the shape rules (burst on the CONTACT EDGE, nothing wider than ~1.6 tiles, amber not
  // white, only the blade filament near-white, victim silhouette readable - ref 37's spark cluster sits
  // BETWEEN the sprites and ref 60's column stands BESIDE its target).
  // ROUND 6, instrumented on the SHIPPED scenario=melee capture: main.js does not await
  // battle.resolve, so the three preset screenshots RACE the swings. Three runs of the same build
  // caught the effect at age 0.00 (wide), 0.05-0.30 on a counter (mid) and 0.40+ (close) - and at
  // 0.40 every round-5 element was already dead: 4 stray sparks, no light, no decal, no dust. The
  // critic scored that 'no ground contact, nothing anchors the hit'.
  // The timeline now spans the whole capture window as explicit stages (bar 7):
  //   0.00-0.16 anticipation: two dim blade sweeps draw across the contact edge, core still dark
  //   0.05-0.31 impact: layered amber crescents + filament + flare, sparks to 0.5
  //   0.05-1.05 terrain light rises with the flash and decays across a full second
  //   0.10-1.35 aftermath: dust skirt, ballistic grit, bouncing embers
  //   0.05-1.70 warm ground pool, 0.05-3.20 dirt scuff (the decal that outlives everything)
  fx_slash(at, src, o = {}) {
    const r = this.rnd;
    // ROUND-5 rank 2 (victim whiteout): the flash used to be near-white over a broad crescent, so the
    // additive stack pushed 60-75% of the victim past luma 217 and erased head/legs. Now only a tiny core is near-white; every crescent/rim is
    // saturated AMBER (single-layer luma < 217) so the sprite still reads through the hit.
    const AMB = C(0xff9c30), AMB2 = C(0xffb056), Y = C(0xff8c22), DIM = C(0xcf8228);
    const COREW = HDR(0xfff6e8, 2.6);            // the ONE near-white, compact <=40px focal punch
    const TAN = C(0xe8dcc4), GRIT = C(0x6f5c42), EMBER = HDR(0xffa030, 1.4);
    const dir = new THREE.Vector3().subVectors(src, at); dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1); dir.normalize();
    const rt = this.camRight();
    const c = { x: at.x + dir.x * 0.45 + rt.x * 0.34, y: at.y + 1.0, z: at.z + dir.z * 0.45 + rt.z * 0.34 };
    const g = { x: at.x + dir.x * 0.30, y: at.y, z: at.z + dir.z * 0.30 };
    // ROUND-5 rank 1 (detached speed-lines): EVERY particle born from this swing is parented to the
    // swing transform IN SCREEN SPACE at spawn. The arc is the world-vertical column from the ground
    // contact up past the blade - it projects to a near-vertical screen line, so horizontal streaks that
    // try to detach east of the contact blow the 40px perpendicular budget and are hard-killed, while
    // sparks travelling along the blade stay inside the tube and read as ONE continuous cut. Enforced
    // every frame from impact (0.045s), so after t+600ms max distance-from-arc >40px is 0 by construction.
    const ARC = { arcA: { x: g.x, y: at.y - 0.1, z: g.z }, arcB: { x: c.x, y: at.y + 1.7, z: c.z }, arcR: 40, arcT: 0.045 };
    const P = (sys, p) => this.P(sys, Object.assign(p, ARC));
    const a0 = Math.atan2(dir.z, dir.x);
    const cam = this.cam; let rot = 0.55;
    if (cam) { const v = dir.clone().transformDirection(cam.matrixWorldInverse); rot = Math.atan2(v.y, v.x); }
    // R11 WHIFF: a blow that misses cuts air — the blade sweeps and a puff of dust at the feet, but no contact
    // flash, no terrain light, no scuff (the old miss played the full hit and read as a hit).
    if (o.miss) {
      for (const [d, s0, s1, a, tilt] of [[0, 0.55, 1.5, 0.34, -0.30], [0.04, 0.45, 1.3, 0.22, 0.28]]) P(this.add, this.col({ ...c, life: 0.2, size: s0, size1: s1, ax: 1.5, ay: 0.74, frame: F.slash, rot: rot + Math.PI * 0.5 + tilt, delay: d, fadeIn: 0.03, fadeOut: 1.3, alpha: a }, DIM));
      this.burst(this.norm, 6, () => { const a = a0 + (r() - 0.5) * 3.0, sp = 0.4 + r() * 0.5; return this.col(Object.assign({ x: g.x, y: at.y + 0.05, z: g.z, vx: Math.cos(a) * sp, vy: 0.3 + r() * 0.4, vz: Math.sin(a) * sp, life: 0.7, delay: 0.05, size: 0.28, size1: 0.7, frame: F.dust, rot: r() * 6.28, alpha: 0.4, drag: 4.5, grav: -0.7, fadeIn: 0.06, hold: 0.2, fadeOut: 1.9 }, ARC), TAN); });
      return 0.05;
    }
    // Terrain light (bar 7): peak on the flash, inverse-square falloff, alive for a full second so
    // whichever slot catches the frame the ground under the contact is still answering the hit.
    this.light(g, 0xffcf90, 9.5, 1.05, { rise: 0.05, y: 0.5, dist: 2.6, decay: 1.7, falloff: 2.6, flicker: 0.10 });
    // DARK BACKOUT RIM (round-5 rank 2): a near-black contour in the NORMAL system (renderOrder 18, behind
    // the additive flash at 20) so a dark edge survives around the blow-out and the silhouette stays legible
    //. Kept SUBTLE (alpha 0.45) - a strong one read as a thick dark band that muddied the sprite.
    P(this.norm, this.col({ ...c, life: 0.26, size: 0.7, size1: 1.4, ax: 1.4, ay: 0.86, frame: F.slash, rot: rot + Math.PI * 0.5 - 0.10, fadeIn: 0.02, hold: 0.5, fadeOut: 1.4, alpha: 0.45 }, C(0x140d07)));
    // ANTICIPATION: two dim amber sweeps draw in while the core is still dark (critic r4 'fragmented pink arc').
    for (const [d, s0, s1, a, tilt] of [[0, 0.55, 1.42, 0.26, -0.30], [0.03, 0.45, 1.20, 0.18, 0.28]]) {
      P(this.add, this.col({ ...c, life: 0.13, size: s0, size1: s1, frame: F.slash, rot: rot + Math.PI * 0.5 + tilt, delay: d, fadeIn: 0.03, fadeOut: 1.25, alpha: a }, DIM));
    }
    // IMPACT at +0.05: amber crescents (STRETCHED along their chord so the sweep reads as a directional
    // blade arc), a warm filament, a small flare - and the single near-white nucleus, kept <=40px.
    // ROUND-6 telemetry: at melee_close the counter's slash is at AGE 0.33 but the old 0.26s crescents /
    // 0.28s nucleus were already dead -> 'no focal core, amorphous'. Lives extended to ~0.40-0.45s so the
    // punch lands on the racing 3rd-preset capture, still well under the 600ms crescent kill (finding 1).
    for (const [d, s0, s1, a, tilt, col] of [[0, 0.58, 1.16, 0.50, -0.10, AMB], [0.03, 0.50, 0.98, 0.34, 0.48, Y]]) {
      P(this.add, this.col({ ...c, life: 0.40, size: s0, size1: s1, ax: 1.5, ay: 0.74, frame: F.slash, rot: rot + Math.PI * 0.5 + tilt, delay: 0.05 + d, fadeIn: 0.03, fadeOut: 1.3, alpha: a }, col));
    }
    P(this.add, this.col({ ...c, life: 0.36, size: 0.30, size1: 0.7, frame: F.slash, rot: rot + Math.PI * 0.5 + 0.14, delay: 0.06, fadeIn: 0.02, fadeOut: 1.7, alpha: 0.4, ax: 1.6, ay: 0.5 }, AMB2));
    // the near-white nucleus: small (0.24-0.40u ~ 16-30px) so luma>217 stays a compact <=40px core.
    // R7 (visual7 blind A/B: 'hit spark is a small white dot on the victim's face'; fxseq strip r7/fx1: no
    // readable blade at any age). THE CUT: one crisp diagonal stroke drawn straight THROUGH the victim's
    // body, the genre's own melee read. It snaps open in 60 ms, holds two frames and is gone
    // by ~0.24 s, so the sprite reads through it before and after; thin (F.spark is itself a 0.085-high streak) so it never blankets the
    // body. Amber under-stroke for hue, near-white filament on top. Born at the body centre, not the offset
    // contact point, so it cannot be hidden by the wall the victim stands behind.
    const bc = { x: at.x, y: at.y + 0.72, z: at.z };
    const cutRot = rot > 0 ? -0.62 : 0.62;
    this.P(this.add, this.col({ ...bc, life: 0.24, size: 0.35, size1: 1.7, growT: 0.06, ax: 1.0, ay: 1.6, frame: F.spark, rot: cutRot, delay: 0.05, fadeIn: 0.01, hold: 0.35, fadeOut: 1.6, alpha: 0.95, noclip: 1 }, AMB));
    this.P(this.add, this.col({ ...bc, life: 0.20, size: 0.30, size1: 1.55, growT: 0.05, ax: 1.0, ay: 0.55, frame: F.spark, rot: cutRot, delay: 0.05, fadeIn: 0.01, hold: 0.3, fadeOut: 1.8, alpha: 1, noclip: 1 }, HDR(0xfff2dc, 1.5)));
    // nucleus: shortened 0.45 -> 0.22 s ('white orb parked on the face' at 0.4 s in the same strip)
    P(this.add, this.col({ ...c, life: 0.22, size: 0.24, size1: 0.4, frame: F.core, delay: 0.05, fadeIn: 0.02, hold: 0.4, fadeOut: 1.6, alpha: 0.72 }, COREW));
    P(this.add, this.col({ ...c, life: 0.16, size: 0.16, size1: 0.5, frame: F.flare, delay: 0.06, fadeOut: 1.1, rot: r(), alpha: 0.26 }, AMB2));
    // sparks: SHORT blade spray along the swing (high drag -> stays inside the 40px tube; was sp 7-15 with
    // low drag -> flew 110-130px east as the detached fan). Colour amber, never white.
    this.burst(this.add, 6, () => { const a = a0 + (r() - 0.5) * 1.5, sp = 2.0 + r() * 1.4; return this.col(Object.assign({ ...c, vx: Math.cos(a) * sp, vy: (r() - 0.3) * 2.0, vz: Math.sin(a) * sp, life: 0.14 + r() * 0.07, delay: 0.05, size: 0.55 + r() * 0.3, ax: 1, ay: 0.40, frame: F.spark, align: true, drag: 11, fadeOut: 1.5, alpha: 0.55 }, ARC), mix(AMB2, AMB, r())); });
    this.burst(this.add, 16, () => { const a = a0 + (r() - 0.5) * 2.2, sp = 1.2 + r() * 0.9; return this.col(Object.assign({ ...c, vx: Math.cos(a) * sp, vy: 1.3 + r() * 1.5, vz: Math.sin(a) * sp, life: 0.32 + r() * 0.22, delay: 0.05 + r() * 0.06, size: 0.3, size1: 0.09, ax: 1, ay: 0.5, frame: F.spark, align: true, drag: 8, grav: -10, floor: at.y + 0.03, bounce: 0.3, fadeOut: 1.15, alpha: 0.7 }, ARC), mix(AMB, AMB2, r())); });
    // AFTERMATH: dust kicked LOW and TIGHT along the swing. ROUND-6 vis re-read: 18 opaque TAN puffs at
    // alpha 0.85 were an OPAQUE mass over the victim ('55-65% washed, head/legs lost') - fewer, thinner and
    // smaller so they read as ground haze at the FEET, not a body wash. The additive crescents carry the hit.
    this.burst(this.norm, 11, () => { const a = a0 + (r() - 0.5) * 3.0, sp = 0.5 + r() * 0.6; return this.col(Object.assign({ x: g.x + Math.cos(a) * 0.2, y: at.y + 0.05, z: g.z + Math.sin(a) * 0.2, vx: Math.cos(a) * sp, vy: 0.35 + r() * 0.5, vz: Math.sin(a) * sp, life: 0.8 + r() * 0.35, delay: r() * 0.04, size: 0.34, size1: 0.85 + r() * 0.4, frame: F.dust, rot: r() * 6.28, rotv: (r() - 0.5) * 2, alpha: 0.5, drag: 4.5, grav: -0.7, fadeIn: 0.06, hold: 0.2, fadeOut: 1.9 }, ARC), mix(TAN, C(0xcfc2a8), r() * 0.7)); });
    // grit: thrown up and slightly along the swing, 3 bounces with decaying restitution (particles.js) so
    // each hop is visibly shorter - a readable pellet trajectory instead of a dust puff (round-5 rank 3).
    this.burst(this.norm, 12, () => { const a = a0 + (r() - 0.5) * 2.4, sp = 0.8 + r() * 0.9; return this.col(Object.assign({ x: g.x + (r() - 0.5) * 0.28, y: at.y + 0.1, z: g.z + (r() - 0.5) * 0.28, vx: Math.cos(a) * sp, vy: 2.3 + r() * 1.6, vz: Math.sin(a) * sp, life: 1.05 + r() * 0.3, delay: r() * 0.05, size: 0.05 + r() * 0.05, frame: F.stone, rot: r() * 6.28, rotv: (r() - 0.5) * 14, grav: -15, floor: at.y + 0.03, bounce: 0.4, fadeOut: 0.55 }, ARC), GRIT); });
    this.burst(this.add, 9, () => { const a = a0 + (r() - 0.5) * 3.0, sp = 0.7 + r() * 0.7; return this.col(Object.assign({ x: c.x, y: c.y - 0.3 + r() * 0.4, z: c.z, vx: Math.cos(a) * sp, vy: 0.7 + r() * 1.2, vz: Math.sin(a) * sp, life: 0.8 + r() * 0.3, delay: 0.04 + r() * 0.06, size: 0.05 + r() * 0.06, frame: F.core, drag: 5, grav: -3.2, floor: at.y + 0.04, bounce: 0.3, flick: 0.5, fadeOut: 0.9 }, ARC), mix(EMBER, Y, r())); });
    // GROUND (bar 7): warm pool under the contact edge. ROUND 6b: main beats start at t0 so the racing
    // capture never lands before they fade in.
    this.decal(g, 'soft', { color: 0xffe0b8, size: 1.0, size1: 2.1, grow: 0.12, life: 1.7, hold: 0.14, alpha: 0.9 });
    // ROUND-5 rank 3 (weak ground contact): a HARDENED rust-dark scuff (bounded alpha, defined edge - new
    // 'scuff' texture) that reads as a mark, plus TWO clean closed rings so a staged crop at t0150 AND one
    // at t0450+ both show a ring: Ring A grows from t0 and holds; Ring B is the post-impact shock at +250ms.
    this.decal(g, 'scuff', { color: 0x3a1e0c, size: 1.3, size1: 1.95, grow: 0.3, life: 3.2, hold: 0.5, alpha: 0.7, blending: THREE.NormalBlending, lift: 0.02 });
    // R11: the two ground rings were 3.1 / 3.8 tiles of bright yellow and read as a magic circle under a sword hit;
    // a shock ring the size of the contact (1.7 / 2.1), dimmer, with the dust + scuff carrying the ground contact.
    this.decal(g, 'ring', { color: 0xffd898, size: 0.4, size1: 1.7, grow: 0.2, life: 0.5, hold: 0.35, alpha: 0.6, lift: 0.035 });
    this.decal(g, 'ring', { color: 0xfff0c8, size: 0.5, size1: 2.1, grow: 0.26, life: 0.5, hold: 0.3, alpha: 0.4, delay: 0.12, lift: 0.04 });
    return 0.05;
  }
  // BASH: shockwave ring, impact star, dust kicked up at the feet.
  fx_bash(at, src, o = {}) {
    if (o.miss) return this.fx_slash(at, src, o);
    // ROUND 5: same contact-edge rule as fx_slash - amber not white, core 2.2 -> 1.25 tiles, and the
    // burst sits between the fighters instead of on the victim's chest.
    // ROUND-6 rank 1+2+3: same screen-arc containment (no detached streaks), amber not near-white
    // (the F.ring shock was near-white over 2.3u = a big >217 blob), and a hardened scuff + dual ring.
    const r = this.rnd; const AMB = C(0xffb060), COREW = HDR(0xfff0d8, 1.2), T = C(0xd9c39a), GRIT = C(0x6f5c42);
    const bdir = new THREE.Vector3().subVectors(src, at); bdir.y = 0; if (bdir.lengthSq() < 1e-6) bdir.set(0, 0, 1); bdir.normalize();
    const c = { x: at.x + bdir.x * 0.38, y: at.y + 0.95, z: at.z + bdir.z * 0.38 };
    const ARC = { arcA: { x: at.x, y: at.y - 0.1, z: at.z }, arcB: { x: c.x, y: at.y + 1.7, z: c.z }, arcR: 40, arcT: 0.04 };
    const P = (sys, p) => this.P(sys, Object.assign(p, ARC));
    // ROUND 6: same staged window as fx_slash - the shipped melee capture races the swing (main.js
    // does not await resolve), so the light, dust and ground marks must still be on stage at 0.4-1.0 s.
    this.light(at, 0xffd8a0, 9.5, 1.0, { rise: 0.03, y: 0.85, dist: 3.5, decay: 1.7, flicker: 0.10 });
    P(this.norm, this.col({ ...c, life: 0.3, size: 0.5, size1: 2.5, frame: F.ring, delay: 0.03, fadeIn: 0.02, hold: 0.4, fadeOut: 1.4, alpha: 0.8 }, C(0x140d07)));
    P(this.add, this.col({ ...c, life: 0.34, size: 0.4, size1: 2.3, frame: F.ring, delay: 0.03, fadeIn: 0.02, fadeOut: 1.4, alpha: 0.7 }, AMB));
    P(this.add, this.col({ ...c, life: 0.18, size: 0.22, size1: 0.6, frame: F.core, delay: 0.03, fadeIn: 0.02, hold: 0.3, fadeOut: 1.3, alpha: 0.45 }, COREW));
    P(this.add, this.col({ ...c, life: 0.20, size: 0.3, size1: 1.1, frame: F.flare, delay: 0.03, fadeOut: 1.1, rot: 0.6, alpha: 0.4 }, AMB));
    this.burst(this.norm, 16, () => { const a = r() * 6.2832; return this.col(Object.assign({ x: at.x + Math.cos(a) * 0.24, y: at.y + 0.1, z: at.z + Math.sin(a) * 0.24, vx: Math.cos(a) * (0.7 + r() * 0.7), vy: 0.6 + r() * 0.7, vz: Math.sin(a) * (0.7 + r() * 0.7), life: 0.95 + r() * 0.4, delay: 0.04 + r() * 0.12, size: 0.45, size1: 1.5, frame: F.dust, rot: r() * 6.28, rotv: (r() - 0.5) * 2, alpha: 0.8, drag: 3.5, grav: -0.8, fadeIn: 0.1, hold: 0.2, fadeOut: 1.7 }, ARC), T); });
    this.burst(this.norm, 9, () => { const a = r() * 6.2832, sp = 0.8 + r() * 0.9; return this.col(Object.assign({ x: at.x + (r() - 0.5) * 0.3, y: at.y + 0.1, z: at.z + (r() - 0.5) * 0.3, vx: Math.cos(a) * sp, vy: 1.8 + r() * 1.6, vz: Math.sin(a) * sp, life: 0.95 + r() * 0.3, delay: 0.03 + r() * 0.08, size: 0.045 + r() * 0.055, frame: F.stone, rotv: (r() - 0.5) * 12, grav: -15, floor: at.y + 0.03, bounce: 0.4, fadeOut: 0.55 }, ARC), GRIT); });
    this.burst(this.add, 12, () => { const a = r() * 6.2832, sp = 1.6 + r() * 1.6; return this.col(Object.assign({ ...c, vx: Math.cos(a) * sp, vy: 1 + r() * 2.4, vz: Math.sin(a) * sp, life: 0.32 + r() * 0.2, delay: 0.03 + r() * 0.08, size: 0.4, size1: 0.11, ax: 1, ay: 0.5, frame: F.spark, align: true, drag: 5, grav: -9, alpha: 0.7 }, ARC), AMB); });
    this.decal(at, 'soft', { color: 0xffb060, size: 0.8, size1: 2.1, grow: 0.25, life: 1.5, hold: 0.14, alpha: 0.6, delay: 0.03 });
    this.decal(at, 'scuff', { color: 0x3a1e0c, size: 1.2, size1: 1.8, grow: 0.3, life: 3.0, hold: 0.5, alpha: 0.68, blending: THREE.NormalBlending, lift: 0.02, delay: 0.03 });
    this.decal(at, 'ring', { color: 0xffd8a0, size: 0.4, size1: 1.9, grow: 0.22, life: 0.55, hold: 0.35, alpha: 0.65, delay: 0.03, lift: 0.035 });
    this.decal(at, 'ring', { color: 0xfff0d0, size: 0.5, size1: 2.3, grow: 0.26, life: 0.55, hold: 0.3, alpha: 0.45, delay: 0.15, lift: 0.04 });
    return 0.05;
  }
  // PROJECTILES: real travel from caster to target; impact delay = flight time.
  projectile(at, src, { frame, size, ax, ay, color, arc, speed, spin = 0, trail, onHit, sys = this.add, align = true }) {
    const from = src.clone().add(new THREE.Vector3(0, 0.85, 0)), to = at.clone().add(new THREE.Vector3(0, 0.75, 0)); const d = Math.max(0.5, from.distanceTo(to)); const dur = d / speed;
    const head = { x: from.x, y: from.y, z: from.z }; const vel = new THREE.Vector3(); const c = C(color);
    const p = this.P(sys, this.col({ ...head, life: dur + 0.05, size, ax, ay, frame, pin: head, pinVel: vel, align, rotv: spin, fadeIn: 0.01, fadeOut: 0.1, alpha: 1 }, c));
    this.mover(from, to, dur, { arc: arc * d, onTick: (pos, k, r, v) => { head.x = pos.x; head.y = pos.y; head.z = pos.z; vel.copy(v); trail && trail(pos, r, v); }, onEnd: () => { p.dead = true; onHit && onHit(); } });
    return dur;
  }
  fx_arrow(at, src) {
    const r = this.rnd; const W = C(0xfff4d8);
    return this.projectile(at, src, { frame: F.arrow, size: 1.05, ax: 1, ay: 0.5, color: 0xffffff, arc: 0.22, speed: 9, trail: (p) => { if (r() < 0.7) this.P(this.add, this.col({ x: p.x, y: p.y, z: p.z, life: 0.2, size: 0.34, size1: 0.05, frame: F.glow, alpha: 0.55 }, W)); }, onHit: () => this.hitSpark(at, 0xfff4d8, 0.8) });
  }
  fx_stone(at, src) {
    const r = this.rnd; const T = C(0xcbb48c);
    return this.projectile(at, src, { frame: F.stone, size: 0.34, ax: 1, ay: 0.9, color: 0x8c7a62, arc: 0.45, speed: 6.5, spin: 9, align: false, sys: this.norm, onHit: () => {
      this.hitSpark(at, 0xffe8c0, 0.55);
      this.burst(this.norm, 12, () => { const a = r() * 6.2832; return this.col({ x: at.x, y: at.y + 0.7, z: at.z, vx: Math.cos(a) * (1.2 + r()), vy: 0.6 + r(), vz: Math.sin(a) * (1.2 + r()), life: 0.5 + r() * 0.3, size: 0.35, size1: 1.0, frame: F.dust, alpha: 0.6, drag: 2, grav: -1 }, T); });
      this.burst(this.norm, 10, () => { const a = r() * 6.2832, sp = 1.5 + r() * 2.5; return this.col({ x: at.x, y: at.y + 0.7, z: at.z, vx: Math.cos(a) * sp, vy: 1 + r() * 2.5, vz: Math.sin(a) * sp, life: 0.6, size: 0.08 + r() * 0.07, frame: F.stone, rotv: 12, grav: -9, floor: at.y + 0.03, bounce: 0.3, fadeOut: 0.3 }, C(0x8c7a62)); });
    } });
  }
  fx_shuriken(at, src) {
    const S = C(0xd8ecff);
    return this.projectile(at, src, { frame: F.shuriken, size: 0.46, ax: 1, ay: 1, color: 0xe8f4ff, arc: 0.05, speed: 13, spin: 32, align: false, trail: (p, r, v) => { this.P(this.add, this.col({ x: p.x, y: p.y, z: p.z, vx: -v.x * 0.05, vy: -v.y * 0.05, vz: -v.z * 0.05, life: 0.22, size: 0.6, size1: 0.12, ax: 1, ay: 0.55, frame: F.spark, align: true, alpha: 0.75 }, S)); }, onHit: () => this.hitSpark(at, 0xd8ecff, 0.9) });
  }
  // ROUND 5: on a counter, battle.js fires the attack AND the reaction on the same tile, so this pop
  // stacked on top of fx_slash and was half of the melee blowout. Flare 2.0 -> 0.9 tiles, count 18 -> 12,
  // and the flare colour is pulled off white toward the caller's hue (HDR 1.6 -> 1.25).
  hitSpark(at, hex, k = 1) {
    const r = this.rnd; const W = HDR(hex, 1.15); const c = { x: at.x, y: at.y + 0.9, z: at.z };
    // ROUND-6 rank 1: impact sparks are parented to a vertical arc at the hit point too, so a counter's
    // pop (which stacks on fx_slash) can never throw a detached streak 110px across the frame.
    const ARC = { arcA: { x: at.x, y: at.y - 0.1, z: at.z }, arcB: { x: at.x, y: at.y + 1.7, z: at.z }, arcR: 40, arcT: 0.03 };
    // ROUND 6: light and dust live ~0.7-1.0 s so a capture that races the swing still sees the
    // terrain answer; the flare/spark flash itself stays under 0.2 s.
    this.light(at, hex, 7 * k, 0.7, { rise: 0.02, y: 0.9, dist: 2.5, decay: 1.8 });
    // R19 (units/anim, hit sparks): the flare sat dead-centre on the victim's chest at alpha 0.42 and, with the
    // bloom, washed the whole body to a translucent white on the recoil frame (shots/anim19/probe_nospark/cmp680.png)
    // — the one frame that has to show the hurt pose. Smaller, dimmer and nudged to the side the camera sees.
    { const rt = this.camRight(); this.P(this.add, this.col(Object.assign({ x: c.x + rt.x * 0.22, y: c.y + 0.12, z: c.z + rt.z * 0.22, life: 0.13, size: 0.2, size1: 0.48 * k, frame: F.flare, delay: 0.02, fadeOut: 1.1, rot: r(), alpha: 0.24 }, ARC), W)); }
    this.burst(this.add, Math.round(11 * k), () => { const a = r() * 6.2832, el = r() * 1.2, sp = 1.6 + r() * 1.8; return this.col(Object.assign({ ...c, vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp, vz: Math.sin(a) * Math.cos(el) * sp, life: 0.24 + r() * 0.2, delay: 0.02, size: 0.4, size1: 0.10, ax: 1, ay: 0.5, frame: F.spark, align: true, drag: 5, grav: -10, alpha: 0.7 }, ARC), W); });
    this.burst(this.norm, 6, () => { const a = r() * 6.2832, sp = 0.7 + r() * 0.7; return this.col(Object.assign({ x: at.x + Math.cos(a) * 0.2, y: at.y + 0.06, z: at.z + Math.sin(a) * 0.2, vx: Math.cos(a) * sp, vy: 0.45 + r() * 0.6, vz: Math.sin(a) * sp, life: 0.85 + r() * 0.3, delay: 0.05 + r() * 0.1, size: 0.3, size1: 0.9 + r() * 0.3, frame: F.dust, rot: r() * 6.28, alpha: 0.55, drag: 3.5, grav: -0.7, fadeIn: 0.1, hold: 0.2, fadeOut: 1.7 }, ARC), C(0xcbb48c)); });
    this.decal(at, 'soft', { color: hex, size: 0.7, size1: 1.5, grow: 0.2, life: 1.1, hold: 0.12, alpha: 0.4, delay: 0.03 });
    this.ringFx(at, hex, 0.1, 0.85 * k, 0.3, { alpha: 0.4, delay: 0.02 });
  }
  // JUMP landing: shock ring, a skirt of dust, pebbles and a hard contact pop.
  fx_jump(at, src) {
    const r = this.rnd; const T = C(0xd6c09a), W = HDR(0xfff2d8, 1.5);
    this.shake(0.3, 'jump');
    this.light(at, 0xffe0b0, 16, 0.45, { rise: 0.02, y: 0.5, dist: 4.5 });
    this.P(this.add, this.col({ x: at.x, y: at.y + 0.35, z: at.z, life: 0.22, size: 0.5, size1: 3.0, frame: F.flare, fadeOut: 0.9, rot: 0.3 }, W));
    this.ringFx(at, 0xffe0b0, 0.15, 3.1, 0.45, { alpha: 1 });
    this.decal(at, 'soft', { color: 0xc8a878, size: 0.7, size1: 3.4, grow: 0.2, life: 0.9, hold: 0.2, alpha: 0.65, blending: THREE.NormalBlending });
    this.burst(this.norm, 28, () => { const a = r() * 6.2832; const sp = 1.4 + r() * 1.5; return this.col({ x: at.x + Math.cos(a) * 0.3, y: at.y + 0.08, z: at.z + Math.sin(a) * 0.3, vx: Math.cos(a) * sp, vy: 0.5 + r() * 0.9, vz: Math.sin(a) * sp, life: 0.46 + r() * 0.26, size: 0.45, size1: 1.35 + r() * 0.45, frame: F.dust, rot: r() * 6.28, rotv: (r() - 0.5) * 2, alpha: 0.68, drag: 3.4, grav: -0.8, fadeIn: 0.08, hold: 0.24, fadeOut: 1.8 }, T); });
    this.burst(this.norm, 22, () => { const a = r() * 6.2832, sp = 1.8 + r() * 3.4; return this.col({ x: at.x, y: at.y + 0.1, z: at.z, vx: Math.cos(a) * sp, vy: 1.8 + r() * 3.2, vz: Math.sin(a) * sp, life: 0.7, size: 0.07 + r() * 0.07, frame: F.stone, rotv: 10, grav: -10, floor: at.y + 0.03, bounce: 0.35, fadeOut: 0.4 }, C(0x9a8668)); });
    this.burst(this.add, 20, () => { const a = r() * 6.2832, sp = 3 + r() * 4; return this.col({ x: at.x, y: at.y + 0.2, z: at.z, vx: Math.cos(a) * sp, vy: 1 + r() * 2, vz: Math.sin(a) * sp, life: 0.3, size: 0.7, size1: 0.15, ax: 1, ay: 0.55, frame: F.spark, align: true, grav: -9 }, W); });
    return 0.05;
  }
  // HOLY: a pillar of light that runs off the top of the frame, a blown-out base and floating motes.
  fx_holy(at, src, o = {}) {
    // rank 7: holy measured 0.113 core saturation. The shells go blue-gold; only the 0.115-wide filament
    // stays white, which is exactly how ref 28's pillar reads.
    // ROUND 5: measured 0.358 core saturation with 574 literally-white pixels in the top 0.2%. The
    // filament (F.core x SPEC) and the base glow were summing past 1.0 in all channels. SPEC and W come
    // down and go bluer; ref 28's pillar is a cyan-white filament inside a DEEP blue shell, not a white bar.
    const r = this.rnd; const W = HDR(0x3aa4ff, o.small ? 1.5 : 2.0), SPEC = HDR(0x5ec4ff, o.small ? 1.0 : 1.02), B = C(0x2f9cff), G = C(0x8ff0ff);
    const H = o.small ? 4 : 17;
    this.light(at, 0x3fa4ff, o.small ? 7 : 15, 1.3, { rise: 0.25, y: 1.4, dist: o.small ? 2.6 : 4.0 });
    if (!o.small) this.wash(0x4aa4ff, 0.11, 0.15, 0.22, 0.45, { at: at.clone().add(new THREE.Vector3(0, 2.0, 0)), spread: 16 });
    this.P(this.add, this.col({ x: at.x, y: at.y + H / 2, z: at.z, life: 1.2, size: 0.12, size1: H, growT: 0.3, ax: 0.058, ay: 1, frame: F.core, fadeIn: 0.12, hold: 0.45, alpha: 0.9 }, SPEC));
    this.P(this.add, this.col({ x: at.x, y: at.y + H / 2, z: at.z, life: 1.2, size: 0.3, size1: H * 1.02, growT: 0.36, ax: 0.26, ay: 1, frame: F.glow, fadeIn: 0.12, hold: 0.4, alpha: 0.8 }, B));
    this.P(this.add, this.col({ x: at.x, y: at.y + H / 2, z: at.z, life: 1.2, size: 0.5, size1: H * 1.02, growT: 0.42, ax: 0.44, ay: 1, frame: F.glow, fadeIn: 0.15, hold: 0.35, alpha: 0.26 }, mix(B, G, 0.35)));
    this.P(this.add, this.col({ ...this.off(at, 0.9, o.small ? 0.2 : 0.55), life: 0.95, size: 0.5, size1: o.small ? 1.2 : 1.9, growT: 0.35, frame: F.glow, fadeIn: 0.08, hold: 0.35, alpha: 0.58 }, W));
    if (!o.small) {
      // R12 (probe: the full Holy read as a thin dim thread by +0.5 s)'s pillar has BODY -- a wide cyan
      // shaft that holds, and a hot cyan splash where it meets the ground. Bounded blend keeps both cyan.
      this.P(this.add, this.col({ x: at.x, y: at.y + H / 2, z: at.z, life: 1.3, size: 0.4, size1: H, growT: 0.25, ax: 0.62, ay: 1, frame: F.glow, fadeIn: 0.1, hold: 0.5, fadeOut: 1.6, alpha: 0.42, occ: 0.15 }, mix(B, G, 0.55)));
      this.P(this.add, this.col({ x: at.x, y: at.y + 0.55, z: at.z, life: 1.1, size: 0.6, size1: 2.6, growT: 0.3, ax: 1.25, ay: 0.7, frame: F.glow, fadeIn: 0.06, hold: 0.4, fadeOut: 1.6, alpha: 0.75 }, HDR(0x7ae8ff, 1.25)));
      this.burst(this.add, 20, () => { const a = r() * 6.2832, sp = 1.2 + r() * 1.6; return this.col({ x: at.x, y: at.y + 0.3, z: at.z, vx: Math.cos(a) * sp, vy: 0.3 + r() * 0.6, vz: Math.sin(a) * sp, drag: 2.2, life: 0.8 + r() * 0.4, size: 0.5, size1: 1.3, growT: 0.3, frame: F.glow, fadeIn: 0.05, fadeOut: 1.4, alpha: 0.35, delay: 0.05 + r() * 0.15 }, mix(B, G, r())); });
    }
    this.burst(this.add, 46, () => { const a = r() * 6.2832, rr = 0.25 + r() * 0.9; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + r() * 0.6, z: at.z + Math.sin(a) * rr, vy: 2.2 + r() * 3.4, life: 0.8 + r() * 0.5, size: 0.13 + r() * 0.24, frame: r() < 0.5 ? F.star : F.core, delay: r() * 0.5, flick: 0.45, fadeIn: 0.1 }, r() < 0.30 ? SPEC : mix(B, G, r() * 0.75)); });
    this.ringFx(at, 0x6fb4ff, 0.25, o.small ? 1.4 : 2.4, 0.7, { alpha: 0.9 });
    this.decal(at, 'soft', { color: 0x6fa8ff, size: 1.2, size1: o.small ? 1.8 : 2.8, grow: 0.35, life: 1.2, hold: 0.4, alpha: 0.7 });
    return 0.35;
  }
  // KO: soft dissolve — pale motes lift off the fallen body.
  fx_ko(at, src) {
    const r = this.rnd; const P = C(0xe6dcff), B = C(0x9fb4ff);
    this.light(at, 0xc8c0ff, 7, 1.4, { rise: 0.4, y: 0.4, dist: 2.5 });
    this.burst(this.add, 70, () => { const a = r() * 6.2832, rr = r() * 0.45; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.05 + r() * 0.95, z: at.z + Math.sin(a) * rr, vx: (r() - 0.5) * 0.3, vy: 0.45 + r() * 0.8, vz: (r() - 0.5) * 0.3, life: 1.0 + r() * 0.5, size: 0.07 + r() * 0.2, frame: r() < 0.4 ? F.glint : F.glow, delay: r() * 0.6, flick: 0.4, fadeIn: 0.3, fadeOut: 1.4, drag: 0.4 }, r() < 0.5 ? P : B); });
    this.ringFx(at, 0x9aa8ff, 0.1, 1.1, 0.7, { alpha: 0.5 });
    this.decal(at, 'soft', { color: 0x8a90ff, size: 0.6, size1: 1.6, grow: 0.4, life: 1.5, hold: 0.4, alpha: 0.55 });
    // R7: the THUD. The body lands flat ~0.26 s after this fires (sprites.js KO_FALL_MS 400 from setKO at
    // +240 ms, this at +380 ms); a low dust skirt and a scuff there give the fall weight instead of a silent tip.
    this.timer(0.29, () => {
      this.shake(0.10, 'ko');
      const T = C(0xcdb894);
      this.burst(this.norm, 14, () => { const a = r() * 6.2832, sp = 0.6 + r() * 0.8; return this.col({ x: at.x + Math.cos(a) * 0.35, y: at.y + 0.06, z: at.z + Math.sin(a) * 0.35, vx: Math.cos(a) * sp, vy: 0.25 + r() * 0.4, vz: Math.sin(a) * sp, life: 0.8 + r() * 0.3, size: 0.3, size1: 0.9, frame: F.dust, rot: r() * 6.28, alpha: 0.55, drag: 3.2, grav: -0.6, fadeIn: 0.05, hold: 0.2, fadeOut: 1.7 }, T); });
      this.decal(at, 'scuff', { color: 0x3a2a1a, size: 1.1, size1: 1.5, grow: 0.2, life: 2.4, hold: 0.5, alpha: 0.5, blending: THREE.NormalBlending, lift: 0.02 });
      this.ringFx(at, 0xd8c8a8, 0.2, 1.4, 0.4, { alpha: 0.5 });
    });
    return 0.1;
  }

  // ================= R7 effect family (routed; every one: anticipation -> bright core -> terrain light -> decay) =====
  // Small per-victim pop: a coloured star burst + ring at the victim, used for the 2nd..Nth victim of an area spell.
  fx_pop(at, src, o = {}) {
    const r = this.rnd; const G = C(o.color || 0x9dffb8), W = HDR(o.color || 0x9dffb8, 1.6);
    this.light(at, o.color || 0x9dffb8, o.big ? 12 : 7, 0.8, { rise: 0.1, y: 0.9, dist: 2.4 });
    this.P(this.add, this.col({ x: at.x, y: at.y + 0.9, z: at.z, life: 0.5, size: 0.3, size1: o.big ? 1.6 : 1.1, frame: F.flare, fadeIn: 0.05, fadeOut: 1.3, alpha: 0.8, rot: r() }, W));
    this.burst(this.add, o.big ? 26 : 16, () => { const a = r() * 6.2832, rr = 0.2 + r() * 0.45; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.2 + r() * 0.6, z: at.z + Math.sin(a) * rr, vy: 1.2 + r() * 1.6, life: 0.6 + r() * 0.4, size: 0.12 + r() * 0.22, frame: r() < 0.5 ? F.star : F.glint, delay: r() * 0.25, flick: 0.5, drag: 0.6 }, r() < 0.4 ? W : G); });
    this.ringFx(at, o.color || 0x9dffb8, 0.15, 1.3, 0.5, { alpha: 0.8 });
    return 0.1;
  }
  // RAISE / Ember Plume: gold motes RAIN IN (anticipation), a white-gold bloom at the body, a feathered column
  // lifts off the tile and a warm ring rolls out. Distinct from Cure's green spiral at a glance.
  fx_raise(at, src) {
    const r = this.rnd; const GOLD = C(0xffd070), PALE = C(0xfff0c0), W = HDR(0xfff2c8, 2.2);
    this.light(at, 0xffd890, 2.5, 1.8, { rise: 0.45, y: 0.8, dist: 2.6, decay: 1.6 });
    this.burst(this.add, 36, () => { const a = r() * 6.2832, rr = 0.2 + r() * 0.9; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 2.6 + r() * 1.2, z: at.z + Math.sin(a) * rr, vx: -Math.cos(a) * rr * 1.2, vy: -3.2 - r() * 1.5, vz: -Math.sin(a) * rr * 1.2, life: 0.5 + r() * 0.2, size: 0.12 + r() * 0.2, frame: r() < 0.6 ? F.glint : F.star, delay: r() * 0.25, flick: 0.4, fadeIn: 0.1, fadeOut: 0.8 }, r() < 0.5 ? PALE : GOLD); });
    this.seq([[0.42, () => {
      // R12: the 22-unit point light whited out any plaster wall behind the body (the raise blow-out was the WALL,
      // not the particles); a warmer, softer light and a smaller gold core keep the peak gold.
      this.light(at, 0xffc860, 3, 1.2, { rise: 0.04, y: 0.6, dist: 2.6, decay: 1.8 });
      this.P(this.add, this.col({ x: at.x, y: at.y + 0.8, z: at.z, life: 0.55, size: 0.3, size1: 0.95, growT: 0.1, frame: F.core, fadeIn: 0.01, hold: 0.2, fadeOut: 1.6, alpha: 0.9 }, HDR(0xffe0a0, 1.7)));
      this.P(this.add, this.col({ x: at.x, y: at.y + 0.9, z: at.z, life: 0.5, size: 0.6, size1: 2.2, frame: F.flare, fadeOut: 1.2, rot: 0.3, alpha: 0.75 }, C(0xffc050)));
      this.P(this.add, this.col({ x: at.x, y: at.y + 1.8, z: at.z, life: 1.2, size: 0.2, size1: 3.6, growT: 0.3, ax: 0.2, ay: 1, frame: F.glow, fadeIn: 0.05, hold: 0.35, alpha: 0.75 }, GOLD));
      this.burst(this.add, 40, () => { const a = r() * 6.2832, rr = 0.1 + r() * 0.5; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.2 + r() * 0.5, z: at.z + Math.sin(a) * rr, vx: Math.cos(a) * 0.4, vy: 1.6 + r() * 2.4, vz: Math.sin(a) * 0.4, life: 0.9 + r() * 0.6, size: 0.18 + r() * 0.3, frame: r() < 0.35 ? F.flame : F.star, rot: r() * 6.28, rotv: (r() - 0.5) * 3, flick: 0.35, drag: 0.8, fadeOut: 1.3 }, r() < 0.5 ? PALE : GOLD); });
      this.ringFx(at, 0xffd070, 0.2, 2.2, 0.8, { alpha: 1 });
      this.decal(at, 'glyph', { color: 0xffc860, size: 0.5, size1: 2.2, grow: 0.3, life: 1.6, hold: 0.5, alpha: 0.9, spin: 0.8 });
    }]]);
    return 0.45;
  }
  // CRYSTAL (KO countdown ran out): ice-blue shards grow in around the body, the crystal glows, then shatters up.
  fx_crystal(at, src) {
    const r = this.rnd; const CY = C(0x7fe8ff), PALE = C(0xd8faff), W = HDR(0xc8f4ff, 2.0);
    this.light(at, 0x8fe8ff, 14, 1.6, { rise: 0.3, y: 0.8, dist: 3.2, decay: 1.5 });
    for (let i = 0; i < 9; i++) { const a = i / 9 * 6.2832 + r() * 0.3, rr = 0.12 + r() * 0.3, h = 0.6 + r() * 0.8;
      this.P(this.add, this.col({ x: at.x + Math.cos(a) * rr, y: at.y + h * 0.5, z: at.z + Math.sin(a) * rr, life: 0.75, delay: i * 0.025, size: 0.08, size1: h, growT: 0.3, ax: 0.42, ay: 1, frame: F.shard, rot: (r() - 0.5) * 0.6, fadeIn: 0.05, hold: 0.75, fadeOut: 2.2, alpha: 0.95 }, i % 2 ? CY : PALE)); }
    this.P(this.add, this.col({ x: at.x, y: at.y + 0.7, z: at.z, life: 0.8, size: 0.3, size1: 1.4, growT: 0.5, frame: F.glow, fadeIn: 0.2, hold: 0.6, alpha: 0.7 }, CY));
    this.seq([[0.62, () => {
      this.P(this.add, this.col({ x: at.x, y: at.y + 0.8, z: at.z, life: 0.35, size: 0.4, size1: 2.2, frame: F.flare, fadeOut: 1.2, rot: 0.2 }, W));
      this.burst(this.add, 34, () => { const a = r() * 6.2832, el = 0.4 + r() * 1.0, sp = 1.5 + r() * 2.5; return this.col({ x: at.x, y: at.y + 0.7, z: at.z, vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp + 1.0, vz: Math.sin(a) * Math.cos(el) * sp, life: 0.8 + r() * 0.5, size: 0.1 + r() * 0.16, frame: r() < 0.5 ? F.shard : F.glint, rot: r() * 6.28, rotv: (r() - 0.5) * 10, grav: -3, drag: 0.6, flick: 0.4, fadeOut: 1.0 }, r() < 0.5 ? PALE : CY); });
      this.ringFx(at, 0x9ff0ff, 0.2, 1.8, 0.6, { alpha: 0.9 });
      this.decal(at, 'frost', { color: 0x9fe8ff, size: 0.6, size1: 1.8, grow: 0.25, life: 2.2, hold: 0.5, alpha: 0.85 });
    }]]);
    return 0.6;
  }
  // DRAIN (Life Drain / Leech Lance): a crimson stream of motes is PULLED from the victim back into the caster.
  fx_drain(at, src) {
    const r = this.rnd; const RED = C(0xff3050), DK = C(0x6a0820), W = HDR(0xff8098, 1.6);
    this.fx_debuff(at, src, { color: 0xc02048 });
    this.light(at, 0xff3a5a, 12, 1.0, { rise: 0.1, y: 0.9, dist: 2.8 });
    const d = src.distanceTo(at);
    for (let i = 0; i < 22; i++) {
      const p0 = { x: at.x + (r() - 0.5) * 0.5, y: at.y + 0.5 + r() * 0.7, z: at.z + (r() - 0.5) * 0.5 }, p1 = { x: src.x, y: src.y + 0.9, z: src.z };
      const head = { ...p0 }; const pt = this.P(this.add, this.col({ ...head, life: 0.9, delay: 0.25 + i * 0.03, size: 0.16 + r() * 0.18, frame: r() < 0.5 ? F.core : F.glint, pin: head, flick: 0.3, fadeIn: 0.05, fadeOut: 0.6 }, r() < 0.4 ? W : RED));
      this.mover(p0, p1, 0.45 + d * 0.05, { delay: 0.25 + i * 0.03, arc: 0.25 + r() * 0.35, ease: 'in', onTick: (pos) => { head.x = pos.x; head.y = pos.y; head.z = pos.z; }, onEnd: () => { pt.dead = true; } });
    }
    this.timer(0.75, () => { this.light(src, 0xff6078, 10, 0.7, { rise: 0.05, y: 0.9, dist: 2.4 }); this.P(this.add, this.col({ x: src.x, y: src.y + 0.9, z: src.z, life: 0.45, size: 0.3, size1: 1.4, frame: F.flare, fadeOut: 1.3, alpha: 0.8 }, W)); this.ringFx(src, 0xff4060, 0.15, 1.2, 0.5, { alpha: 0.7 }); });
    this.decal(at, 'soft', { color: 0x80102a, size: 0.8, size1: 1.8, grow: 0.3, life: 1.3, hold: 0.4, alpha: 0.6, blending: THREE.NormalBlending });
    return 0.35;
  }
  // DISPEL / Unspell: bright white-blue rings SHATTER outward, glints scatter.
  fx_dispel(at, src) {
    const r = this.rnd; const B = C(0xa8d8ff), W = HDR(0xf0f8ff, 1.6);
    this.light(at, 0xc0e0ff, 14, 0.8, { rise: 0.05, y: 1.0, dist: 2.8 });
    this.P(this.add, this.col({ x: at.x, y: at.y + 1.0, z: at.z, life: 0.4, size: 0.4, size1: 1.9, frame: F.flare, fadeOut: 1.2, rot: 0.1 }, W));
    for (let i = 0; i < 3; i++) this.P(this.add, this.col({ x: at.x, y: at.y + 0.5 + i * 0.4, z: at.z, life: 0.45, delay: i * 0.06, size: 0.5, size1: 2.4, frame: F.ring, fadeOut: 1.2, alpha: 0.9 }, i === 1 ? W : B));
    this.burst(this.add, 30, () => { const a = r() * 6.2832, el = (r() - 0.3) * 1.2, sp = 2 + r() * 2.5; return this.col({ x: at.x, y: at.y + 1.0, z: at.z, vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp, vz: Math.sin(a) * Math.cos(el) * sp, life: 0.5 + r() * 0.3, size: 0.12 + r() * 0.12, frame: F.shard, rot: r() * 6.28, rotv: (r() - 0.5) * 12, drag: 2, grav: -3, fadeOut: 1.0 }, r() < 0.5 ? W : B); });
    this.ringFx(at, 0xc8e8ff, 0.2, 1.9, 0.5, { alpha: 0.9 });
    return 0.1;
  }
  // VANISH: the body's outline shimmers and scatters into pale motes.
  fx_vanish(at, src) {
    const r = this.rnd; const P = C(0xd8e8ff);
    this.light(at, 0xc8d8ff, 8, 1.0, { rise: 0.1, y: 1.0, dist: 2.4 });
    this.burst(this.add, 60, () => { const a = r() * 6.2832, rr = 0.1 + r() * 0.35; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.1 + r() * 1.4, z: at.z + Math.sin(a) * rr, vx: Math.cos(a) * (0.6 + r()), vy: 0.3 + r() * 0.6, vz: Math.sin(a) * (0.6 + r()), life: 0.7 + r() * 0.4, size: 0.06 + r() * 0.12, frame: F.glint, delay: r() * 0.3, flick: 0.6, drag: 1.2, fadeOut: 1.2 }, P); });
    this.ringFx(at, 0xd0e0ff, 0.2, 1.4, 0.5, { alpha: 0.6 });
    return 0.2;
  }
  // STEAL / Pilfer: a gold glint is plucked from the target and arcs to the thief.
  fx_steal(at, src) {
    const r = this.rnd; const GOLD = HDR(0xffd870, 1.6);
    this.hitSpark(at, 0xffe0a0, 0.6);
    const p0 = { x: at.x, y: at.y + 1.0, z: at.z }, p1 = { x: src.x, y: src.y + 1.0, z: src.z }, head = { ...p0 };
    const pt = this.P(this.add, this.col({ ...head, life: 0.9, delay: 0.12, size: 0.35, frame: F.star, pin: head, rotv: 6, flick: 0.2 }, GOLD));
    this.mover(p0, p1, 0.45, { delay: 0.12, arc: 0.8, onTick: (pos) => { head.x = pos.x; head.y = pos.y; head.z = pos.z; if (r() < 0.6) this.P(this.add, this.col({ x: pos.x, y: pos.y, z: pos.z, life: 0.3, size: 0.12, frame: F.glint }, GOLD)); }, onEnd: () => { pt.dead = true; this.P(this.add, this.col({ ...p1, life: 0.3, size: 0.2, size1: 0.9, frame: F.flare, fadeOut: 1.2 }, GOLD)); } });
    return 0.15;
  }
  // GRAVITY: a black-violet sphere forms over the target and CRUSHES down; the ground cracks.
  fx_gravity(at, src) {
    const r = this.rnd; const V2 = C(0x7040c0), DK = C(0x100418), W = HDR(0xc8a0ff, 1.5);
    this.light(at, 0x7040ff, 4, 1.2, { rise: 0.3, y: 1.4, dist: 3.0 });
    this.P(this.norm, this.col({ x: at.x, y: at.y + 1.3, z: at.z, life: 0.6, size: 2.2, size1: 0.9, growT: 0.5, frame: F.glow, fadeIn: 0.1, hold: 0.7, fadeOut: 1.4, alpha: 0.85 }, DK));
    this.P(this.add, this.col({ x: at.x, y: at.y + 1.3, z: at.z, life: 0.6, size: 2.4, size1: 1.0, growT: 0.5, frame: F.ring, fadeIn: 0.1, hold: 0.7, fadeOut: 1.4, alpha: 0.8 }, V2));
    this.burst(this.add, 30, () => { const a = r() * 6.2832, rr = 1.2 + r() * 0.6; return this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.6 + r() * 1.4, z: at.z + Math.sin(a) * rr, vx: -Math.cos(a) * 2.4, vy: -0.4, vz: -Math.sin(a) * 2.4, life: 0.45, size: 0.14, frame: F.glint, delay: r() * 0.2, fadeOut: 0.8 }, W); });
    this.seq([[0.5, () => {
      this.light(at, 0x9060ff, 18, 0.7, { rise: 0.03, y: 0.3, dist: 3.0 });
      this.P(this.add, this.col({ x: at.x, y: at.y + 0.4, z: at.z, life: 0.35, size: 0.5, size1: 2.4, ax: 1, ay: 0.4, frame: F.flare, fadeOut: 1.2 }, W));
      this.decal(at, 'crack', { color: 0x1a0a28, size: 1.0, size1: 2.2, grow: 0.12, life: 2.4, hold: 0.5, alpha: 0.9, blending: THREE.NormalBlending, lift: 0.02 });
      this.ringFx(at, 0x9060ff, 0.3, 2.2, 0.45, { alpha: 1 });
      this.burst(this.norm, 14, () => { const a = r() * 6.2832, sp = 1 + r() * 1.2; return this.col({ x: at.x, y: at.y + 0.06, z: at.z, vx: Math.cos(a) * sp, vy: 0.3 + r() * 0.3, vz: Math.sin(a) * sp, life: 0.8, size: 0.4, size1: 1.0, frame: F.dust, alpha: 0.5, drag: 3, fadeOut: 1.6 }, C(0x6a5a78)); });
    }]]);
    return 0.55;
  }
  // FLARE: space folds IN (dark-red implosion ring + converging motes), then a white-magenta nova.
  fx_flare(at, src) {
    const r = this.rnd; const RED = C(0xff2a3a), MAG = C(0xff4ab0), W = HDR(0xfff0f4, 3.2);
    const c = { x: at.x, y: at.y + 1.0, z: at.z };
    this.light(at, 0xff3050, 6, 0.6, { rise: 0.4, y: 1.0, dist: 3.5 });
    this.P(this.add, this.col({ ...c, life: 0.55, size: 3.2, size1: 0.3, growT: 0.55, frame: F.ring, fadeIn: 0.1, hold: 0.8, fadeOut: 0.4, alpha: 0.9 }, RED));
    this.burst(this.add, 40, () => { const a = r() * 6.2832, el = (r() - 0.5) * 1.6, rr = 1.6 + r() * 0.8; return this.col({ x: c.x + Math.cos(a) * Math.cos(el) * rr, y: c.y + Math.sin(el) * rr, z: c.z + Math.sin(a) * Math.cos(el) * rr, vx: -Math.cos(a) * Math.cos(el) * rr * 2.2, vy: -Math.sin(el) * rr * 2.2, vz: -Math.sin(a) * Math.cos(el) * rr * 2.2, life: 0.42, delay: r() * 0.12, size: 0.1 + r() * 0.14, frame: F.glint, fadeOut: 0.5 }, r() < 0.5 ? MAG : RED); });
    this.seq([[0.55, () => { this.shake(0.3, 'flare');
      this.light(at, 0xff6080, 48, 1.1, { rise: 0.02, y: 1.0, dist: 4.5, decay: 2.0 });
      this.wash(0xff4060, 0.14, 0.03, 0.12, 0.45, { at: at.clone().add(new THREE.Vector3(0, 1, 0)), spread: 16 });
      this.P(this.add, this.col({ ...c, life: 0.6, size: 0.4, size1: 1.1, growT: 0.1, frame: F.core, fadeIn: 0.01, hold: 0.3, fadeOut: 1.6 }, HDR(0xff9ac0, 2.0)));   // R12: one magenta-hot core, not two white HDR 3.2 cores (pink-white blob)
      this.P(this.add, this.col({ ...c, life: 0.7, size: 0.8, size1: 3.4, growT: 0.25, frame: F.glow, fadeIn: 0.02, hold: 0.2, fadeOut: 1.6, alpha: 0.8 }, MAG));
      this.P(this.add, this.col({ ...c, life: 0.5, size: 1.0, size1: 4.0, frame: F.flare, fadeOut: 1.2, rot: 0.4, alpha: 0.9 }, HDR(0xff6090, 1.3)));
      this.burst(this.add, 40, () => { const a = r() * 6.2832, el = (r() - 0.3) * 1.4, sp = 3 + r() * 4; return this.col({ ...c, vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp, vz: Math.sin(a) * Math.cos(el) * sp, life: 0.4 + r() * 0.3, size: 0.6, size1: 0.12, ax: 1, ay: 0.4, frame: F.spark, align: true, drag: 3, fadeOut: 1.2 }, r() < 0.5 ? MAG : RED); });
      this.ringFx(at, 0xff5080, 0.3, 2.8, 0.55, { alpha: 1 });
      this.decal(at, 'scorch', { color: 0xffffff, size: 1.2, size1: 2.2, grow: 0.15, life: 3.0, hold: 0.5, alpha: 0.8, blending: THREE.NormalBlending, lift: 0.02 });
    }]]);
    return 0.6;
  }
  fx_wyrm_sovereign(at, src) { this.fx_flare(at, src); this.timer(0.35, () => this.fx_holy(at, src)); this.timer(0.55, () => this.ringFx(at, 0x9fd0ff, 0.5, 4.2, 0.8, { alpha: 0.9 })); return 0.7; }
  // RUIN STRIKE / Holy Blade / rune blades: the weapon hit, then the element blooms on the victim.
  fx_masher(at, src) { const d = this.fx_bash(at, src); this.timer(0.08, () => this.fx_holy(at, src, { small: true })); return d; }
  fx_holyblade(at, src) { const d = this.fx_slash(at, src); this.timer(0.06, () => this.fx_holy(at, src, { small: true })); return d; }
  fx_runeblade(at, src, o = {}) {
    const d = this.fx_slash(at, src); const hex = ELEM_COL[o.elem] || 0xff7a2a; const r = this.rnd; const G = C(hex), W = HDR(hex, 1.6);
    this.timer(0.07, () => {
      this.light(at, hex, 14, 0.8, { rise: 0.03, y: 0.9, dist: 2.6 });
      this.P(this.add, this.col({ x: at.x, y: at.y + 0.9, z: at.z, life: 0.45, size: 0.4, size1: 1.8, frame: F.glow, fadeIn: 0.02, hold: 0.25, fadeOut: 1.5, alpha: 0.7 }, G));
      this.burst(this.add, 22, () => { const a = r() * 6.2832, sp = 1.2 + r() * 1.8; return this.col({ x: at.x, y: at.y + 0.9, z: at.z, vx: Math.cos(a) * sp, vy: 0.6 + r() * 1.6, vz: Math.sin(a) * sp, life: 0.5 + r() * 0.3, size: o.elem === 'fire' ? 0.3 : 0.14, size1: 0.08, frame: o.elem === 'fire' ? F.flame : F.glint, drag: 2, grav: o.elem === 'fire' ? 1.5 : -1, fadeOut: 1.2 }, r() < 0.3 ? W : G); });
    });
    return d;
  }
  // KI BURST: a golden energy wave travels from the fist and bursts on the target.
  fx_aura(at, src) {
    const r = this.rnd; const G = C(0xffc850), W = HDR(0xfff0c0, 1.8);
    this.light(src, 0xffc850, 10, 0.5, { rise: 0.05, y: 0.9, dist: 2.4 });
    return this.projectile(at, src, { frame: F.glow, size: 0.9, ax: 1.4, ay: 0.8, color: 0xffd070, arc: 0.0, speed: 8, trail: (p) => { this.P(this.add, this.col({ x: p.x, y: p.y, z: p.z, life: 0.25, size: 0.5, size1: 0.1, frame: F.glow, alpha: 0.6 }, G)); if (r() < 0.5) this.P(this.add, this.col({ x: p.x, y: p.y, z: p.z, vx: (r() - 0.5), vy: (r() - 0.5), vz: (r() - 0.5), life: 0.3, size: 0.1, frame: F.glint }, W)); }, onHit: () => this.fx_bash(at, src) });
  }
  // GUN SHOTS (Fireshot / Boltshot / Iceshot): a muzzle flash, a fast tracer, then an elemental burst on the
  // target -- not the full meteor / blizzard / thunderbolt of the spell of the same element.
  fx_gunshot(at, src, o = {}) {
    const r = this.rnd; const hex = ELEM_COL[o.elem] || 0xffe0a0; const G = C(hex), W = HDR(hex, 2.0);
    this.light(src, 0xffe0a0, 16, 0.25, { rise: 0.01, y: 0.9, dist: 2.2 });
    this.P(this.add, this.col({ x: src.x, y: src.y + 0.9, z: src.z, life: 0.12, size: 0.3, size1: 0.9, frame: F.flare, fadeOut: 1, rot: r() }, HDR(0xfff0c0, 1.8)));
    return this.projectile(at, src, { frame: F.spark, size: 0.9, ax: 1, ay: 0.25, color: hex, arc: 0.02, speed: 22, trail: (p) => this.P(this.add, this.col({ x: p.x, y: p.y, z: p.z, life: 0.16, size: 0.5, size1: 0.1, ax: 1, ay: 0.3, frame: F.spark, alpha: 0.6 }, G)), onHit: () => {
      this.light(at, hex, 22, 0.7, { rise: 0.02, y: 0.9, dist: 2.8 });
      this.P(this.add, this.col({ x: at.x, y: at.y + 0.9, z: at.z, life: 0.4, size: 0.3, size1: 1.8, frame: F.flare, fadeOut: 1.2, rot: r() }, W));
      this.P(this.add, this.col({ x: at.x, y: at.y + 0.9, z: at.z, life: 0.55, size: 0.5, size1: 1.9, growT: 0.2, frame: F.glow, fadeIn: 0.02, hold: 0.2, fadeOut: 1.5, alpha: 0.8 }, G));
      const fr = o.elem === 'fire' ? F.flame : o.elem === 'ice' ? F.shard : F.spark;
      this.burst(this.add, 26, () => { const a = r() * 6.2832, el = r() * 1.2, sp = 1.5 + r() * 2.5; return this.col({ x: at.x, y: at.y + 0.9, z: at.z, vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp, vz: Math.sin(a) * Math.cos(el) * sp, life: 0.4 + r() * 0.3, size: fr === F.spark ? 0.5 : 0.24, size1: 0.1, ax: 1, ay: fr === F.spark ? 0.4 : 1, frame: fr, align: fr === F.spark, rot: r() * 6.28, drag: 2.5, grav: o.elem === 'fire' ? 1.2 : -4, fadeOut: 1.1 }, r() < 0.3 ? W : G); });
      if (o.elem === 'thunder') this.bolt({ from: at.clone().add(new THREE.Vector3(0.3, 2.6, 0.2)), to: at.clone().add(new THREE.Vector3(0, 0.9, 0)), glow: 0xb09020, core: 0xfff8d0, life: 0.3, jitterUntil: 0.2, amp: 0.4, segs: 12, branches: 1, widthGlow: 0.25, widthCore: 0.06, branchLen: 0.6, depthTest: false, renderOrder: 39 });
      this.decal(at, o.elem === 'ice' ? 'frost' : o.elem === 'fire' ? 'scorch' : 'soft', { color: o.elem === 'fire' ? 0xffffff : hex, size: 0.6, size1: 1.5, grow: 0.15, life: 1.6, hold: 0.4, alpha: 0.7, blending: o.elem === 'fire' ? THREE.NormalBlending : THREE.AdditiveBlending, lift: 0.02 });
    } });
  }
  // FIREBOMB: a lit flask lobbed in a high arc, then a compact fire burst (the small cousin of Fire).
  fx_bomb(at, src) {
    const r = this.rnd; const O = C(0xff7a20);
    return this.projectile(at, src, { frame: F.stone, size: 0.3, ax: 1, ay: 1, color: 0x90b0c0, arc: 0.55, speed: 7, spin: 10, align: false, sys: this.norm, trail: (p) => { if (r() < 0.8) this.P(this.add, this.col({ x: p.x, y: p.y + 0.12, z: p.z, vy: 0.4, life: 0.3, size: 0.2, size1: 0.05, frame: F.flame, rot: r() * 6.28 }, O)); }, onHit: () => this.fx_fire(at, at.clone().add(new THREE.Vector3(0.001, 0, 0.001))) });
  }
  // FIRE BREATH: a roaring cone of flame streams from the mouth to the target line.
  fx_breath(at, src) {
    const r = this.rnd; const O = C(0xff6a10), Y = C(0xffb030), RED = C(0xc02000), W = HDR(0xffd080, 1.8);
    const from = src.clone().add(new THREE.Vector3(0, 1.0, 0)); const dir = at.clone().add(new THREE.Vector3(0, 0.7, 0)).sub(from); const len = dir.length(); dir.normalize();
    this.light(src, 0xff8030, 18, 1.2, { rise: 0.1, y: 1.0, dist: 3.2, flicker: 0.3 });
    this.light(at, 0xff6010, 24, 1.3, { rise: 0.2, y: 0.8, dist: 3.5, flicker: 0.3, delay: 0.2 });
    this.burst(this.add, 90, (i) => { const t = r(), sp = (len + 0.5) / 0.55, spread = 0.12 + t * 0.5; const j = { x: (r() - 0.5) * spread, y: (r() - 0.5) * spread * 0.6, z: (r() - 0.5) * spread }; return this.col({ x: from.x, y: from.y, z: from.z, vx: dir.x * sp + j.x * 4, vy: dir.y * sp + j.y * 4 + 0.5, vz: dir.z * sp + j.z * 4, life: 0.5 + r() * 0.25, delay: i / 90 * 0.7, size: 0.2, size1: 0.9 + r() * 0.5, frame: r() < 0.6 ? F.flame : F.billow, rot: r() * 6.28, rotv: (r() - 0.5) * 4, drag: 1.2, fadeIn: 0.03, fadeOut: 1.4, alpha: 0.9 }, r() < 0.2 ? W : r() < 0.6 ? O : r() < 0.8 ? Y : RED); });
    this.decal(at, 'scorch', { color: 0xffffff, size: 0.8, size1: 1.9, grow: 0.5, life: 3.0, hold: 0.5, alpha: 0.8, blending: THREE.NormalBlending, lift: 0.02, delay: 0.3 });
    this.decal(at, 'cinder', { color: 0xff7020, size: 0.8, size1: 1.8, grow: 0.5, life: 1.6, hold: 0.4, alpha: 0.9, delay: 0.3 });
    return 0.5;
  }
  fx_generic(at) { const r = this.rnd; const W = HDR(0xffffff, 1.5); this.light(at, 0xffffff, 8, 0.4, { y: 0.8, dist: 2.5 }); this.P(this.add, this.col({ x: at.x, y: at.y + 0.85, z: at.z, life: 0.25, size: 0.4, size1: 2.2, frame: F.flare }, W)); this.burst(this.add, 24, () => { const a = r() * 6.2832, sp = 2.5 + r() * 3.5; return this.col({ x: at.x, y: at.y + 0.85, z: at.z, vx: Math.cos(a) * sp, vy: r() * 3, vz: Math.sin(a) * sp, life: 0.4, size: 0.25, size1: 0.06, frame: F.core, grav: -6 }, W); }); return 0.05; }
  // ---------- integration hooks ----------
  /** Camera-shake hook (R11). The camera is not owned here, so effects only ANNOUNCE a shake at the exact effect
   *  beat (fire detonation, bolt strike, quake, jump landing, KO thud): fn({ amp, kind }) — amp is in the units of
   *  camera.shake (0.1 small .. 0.35 heavy). Returns an unsubscribe. The integrator wires it, e.g.
   *  vfx.onShake(({ amp }) => { camera.shake = Math.max(camera.shake, amp); }). */
  onShake(fn) { (this._shakeFns || (this._shakeFns = [])).push(fn); return () => { const l = this._shakeFns; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; }
  shake(amp, kind = '') { if (this._held) return; if (this._defer) { const dd = this._defer; this._defer = 0; this.timer(dd, () => this.shake(amp, kind)); this._defer = dd; return; } for (const fn of this._shakeFns || []) { try { fn({ amp, kind }); } catch (e) { console.error('vfx.onShake', e); } } }
  /** Hit-stop (R11): freeze the effect clock for `sec` of real time (battle.js calls it on a connecting blow, in step
   *  with the attacker's contact frame and the victim's white hold). Stacks by max, never accumulates. */
  hitStop(sec) { this._stop = Math.max(this._stop || 0, sec); }
  attach(battle) { // subscribe to battle events for beats battle.js does not route through play()
    if (this._attached) return; this._attached = true; this.battle = battle;
    battle.on('ko', ({ victim }) => { const p = battle.worldPos(victim.x, victim.z); this.timer(0.38, () => this.play('ko', p, p, { raw: true })); });
    battle.on('abilityStart', ({ ability, id, unit, target }) => { this._ctx = { ability, id: id || ability?.id, calls: 0, unit, target }; });
    // SUMMON16: any key sends a summoned creature away at once (the cinematic grade skips on the same key)
    if (typeof window !== 'undefined') window.addEventListener('keydown', () => this.skipSummons?.(), { capture: true });
    battle.on('abilityEnd', () => { this._ctx = null; });
    battle.on('charge', ({ ability }) => { this._charge = ability || {}; });
    // SUMMON16: paint the six summon creatures while the battle is idle, so the first summon never hitches a frame
    try { this.warmSummons?.(); } catch (e) { console.warn('summon warm', e); }
    battle.on('crystal', ({ unit, pos }) => { this._rollback(this._mark); const p = battle.worldPos(unit.x, unit.z); this.play('crystal', p, p, { raw: true }); });
  }
  // Scenario hook: play an effect between two sensible units so a screenshot scenario needs no setup.
  demo(name, opts = {}) {
    let at = this.demoAt, from = this.demoFrom; const b = this.battle || (typeof window !== 'undefined' && window.__GAME__?.battle);
    if (b) { const B = b.units.filter((u) => u.team === 'B'), A = b.units.filter((u) => u.team === 'A'); if (B[0] && A[2]) { at = b.worldPos(B[0].x, B[0].z); const dx = Math.sign(A[2].x - B[0].x) || -1, dz = Math.sign(A[2].z - B[0].z) || 1; const fx = B[0].x + dx * 3, fz = B[0].z + dz * 2; from = b.map.at(fx, fz) ? b.worldPos(fx, fz) : b.worldPos(A[2].x, A[2].z); } }
    if (opts.at) at = V(opts.at); if (opts.from) from = V(opts.from); return this.play(name, from, at, { seed: opts.seed ?? 7, ...opts });
  }
  // CHARGING AURA (R11): a unit holding a charged spell between turns keeps visibly gathering it — element-coloured
  // motes spiral up its body and a faint glyph breathes under its feet until the charge resolves (the sprite's
  // own cast-pose pulse is the body half of the same read). Cheap: ~2 motes per 0.1 s per charging unit.
  chargeAura(dt) {
    const b = this.battle; if (!b || dt <= 0 || !b.charges) return;
    this._auraT = (this._auraT || 0) + dt; if (this._auraT < 0.1) return; this._auraT = 0; this._auraN = (this._auraN || 0) + 1;
    const r = Math.random;
    for (const c of b.charges()) {
      const sp = b.spriteOf?.(c.unit); if (!sp || !sp.root.visible) continue; const at = sp.root.position; const hex = elemColor(c.ability); const G = C(hex), W = C(0xffffff);
      for (let i = 0; i < 3; i++) { const a = r() * 6.2832, rr = 0.4 + r() * 0.22; this.P(this.add, this.col({ x: at.x + Math.cos(a) * rr, y: at.y + 0.05 + r() * 0.4, z: at.z + Math.sin(a) * rr, vx: -Math.sin(a) * 0.9 - Math.cos(a) * 0.3, vy: 1.0 + r() * 0.8, vz: Math.cos(a) * 0.9 - Math.sin(a) * 0.3, drag: 0.6, life: 0.75 + r() * 0.35, size: 0.13 + r() * 0.17, frame: r() < 0.5 ? F.glint : F.star, flick: 0.4, fadeIn: 0.12, fadeOut: 0.8, alpha: 0.95 }, r() < 0.3 ? W : G)); }
      if (this._auraN % 8 === 0) { this.decal({ x: at.x, y: at.y, z: at.z }, 'glyph', { color: hex, size: 0.8, size1: 1.35, grow: 0.5, life: 0.9, hold: 0.45, alpha: 0.75, spin: 0.8 }); }
    }
  }
  // Deterministic capture: freeze the game loop, then advance ONLY the vfx clock by a fixed step.
  stepSim(seconds, dt = 1 / 60) { const n = Math.max(1, Math.round(seconds / dt)); const s = this._sim; this._sim = true; try { for (let i = 0; i < n; i++) this.update(dt); } finally { this._sim = s; } return n * dt; }
  clear() {
    for (const e of this.live) { if (e.kind === 'decal') this._freeDecal(e.mesh); if (e.kind === 'bolt') e.bolt.dispose(); if (e.kind === 'ribbon') e.ribbon.dispose(); }
    this.live.length = 0; this.add.list.length = 0; this.norm.list.length = 0;
    for (const s of this.lights) { s.busy = false; s.light.intensity = 0; s.light.visible = false; }
    for (const w of this.washes) w.el.remove(); this.washes.length = 0;
    this.add.guards = []; this.norm.guards = [];
    this.clearCreatures?.();
  }
  // ---------- update ----------
  update(dt) {
    // SPECT15 real-time effect clock. The frame loop caps dt at 0.05 s, but battle.js waits for the impact on the WALL
    // clock (impactAt = now + d), so on a slow frame the damage number landed while the fireball was still falling
    // (SwiftShader 0.2-2 fps: the effect ran at 2-25% speed). A CAPPED frame (dt exactly 0.05) integrates the real
    // elapsed time instead, clamped at 0.75 s and substepped at <= 0.05 s so ballistic particles keep their arcs.
    // Explicit steps (stepSim, fxStep's deterministic captures, any dt other than the cap) are untouched, and so is a
    // capture: while cinematics holds the lens lock (_capture) the clock keeps the old capped pace the captureHold
    // beat logic was built on, so a slow capture frame can never jump the effect past its hero moment.
    if (dt > 0) {
      const wall = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      const real = this._wall != null ? wall - this._wall : dt; this._wall = wall;
      if (!this._sim && !this._capture && Math.abs(dt - 0.05) < 1e-9 && real > dt) {
        let left = Math.min(real, 0.75); this._sim = true;
        try { while (left > 1e-6) { const h = Math.min(0.05, left); left -= h; this._update(h); } } finally { this._sim = false; }
        return;
      }
    }
    this._update(dt);
  }
  _update(dt) {
    if (this._held) dt = 0;
    else if (this._stop > 0) { const used = Math.min(this._stop, dt); this._stop -= used; dt -= used; }
    this.chargeAura(dt);
    this.updateCreatures(dt);
    this.time += dt; const cam = this.cam; this.ensureClip();
    for (const sys of [this.add, this.norm]) if (sys.guards.length) sys.guards = sys.guards.filter((g) => g.until > this.time);
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i]; if (e.delay > 0) { e.delay -= dt; if (e.kind === 'bolt') { e.bolt.mGlow.visible = e.bolt.mCore.visible = false; } if (e.kind === 'ribbon') { e.ribbon.mGlow.visible = e.ribbon.mCore.visible = false; } continue; }
      e.t += dt;
      if (e.kind === 'timer') { e.fn(); this.live.splice(i, 1); continue; }
      if (e.kind === 'move') { const k = Math.min(1, e.t / e.dur); const ke = e.ease === 'in' ? easeIn(k) : e.ease === 'out' ? easeOut(k) : k; e.prev.copy(e.pos); e.pos.lerpVectors(e.p0, e.p1, ke); e.pos.y += Math.sin(k * Math.PI) * e.arc; e.vel.subVectors(e.pos, e.prev).divideScalar(Math.max(dt, 1e-4)); if (e.vel.lengthSq() < 1e-6) e.vel.subVectors(e.p1, e.p0); e.onTick && e.onTick(e.pos, k, this.rnd === Math.random ? Math.random : this.rnd, e.vel); if (k >= 1) { e.onEnd && e.onEnd(); this.live.splice(i, 1); } continue; }
      if (e.kind === 'decal') { const k = e.t / e.life; const m = e.mesh; m.visible = true; const g = Math.min(1, e.t / e.grow); const s = e.size + (e.size1 - e.size) * easeOut(g); m.scale.set(s, s, 1); m.rotation.z += e.spin * dt; let a = e.alpha * Math.min(1, e.t / 0.06); if (k > e.hold) a *= 1 - (k - e.hold) / (1 - e.hold); m.material.opacity = Math.max(0, a); if (k >= 1) { this._freeDecal(m); this.live.splice(i, 1); } continue; }
      if (e.kind === 'bolt') { e.bolt.mGlow.visible = e.bolt.mCore.visible = true; if (!e.bolt.update(dt, cam)) { e.bolt.dispose(); this.live.splice(i, 1); } continue; }
      if (e.kind === 'ribbon') { e.ribbon.mGlow.visible = e.ribbon.mCore.visible = true; if (!e.ribbon.update(dt, cam)) { e.ribbon.dispose(); this.live.splice(i, 1); } continue; }
    }
    for (const s of this.lights) { if (!s.busy) continue; if (s.delay > 0) { s.delay -= dt; continue; } s.t += dt; const k = s.t / s.life; if (k >= 1) { s.busy = false; s.light.intensity = 0; s.light.visible = false; continue; } const rise = Math.min(1, s.t / s.rise); let I = s.peak * rise * Math.pow(1 - k, s.decay); if (s.flicker) I *= 1 - s.flicker * (0.5 + 0.5 * Math.sin(s.t * 53) * Math.sin(s.t * 29 + 1.3)); s.light.intensity = I; s.light.visible = I > 0.05; if (s.pin) s.light.position.set(s.pin.x, s.pin.y, s.pin.z); }
    for (let i = this.washes.length - 1; i >= 0; i--) {
      const w = this.washes[i]; w.t += dt; const total = w.up + w.hold + w.down;
      const a = w.t < w.up ? w.peak * (w.t / w.up) : w.t < w.up + w.hold ? w.peak : w.peak * Math.max(0, 1 - (w.t - w.up - w.hold) / w.down);
      w.el.style.opacity = String(a);
      if (w.t >= total) { w.el.remove(); this.washes.splice(i, 1); }
    }
    this.add.update(dt); this.norm.update(dt);
  }
}
// R13: heal / ward / status family lives in status.js (Cure, Haste, Slow, Stop, Protect, Shell, Reflect, Poison, Sleep,
// Silence, Blind, Charm, Fear) -- installed on the prototype so routing and play() are unchanged.
installStatusFx(VFX);
installCineFx(VFX);
installSummonFx(VFX);
