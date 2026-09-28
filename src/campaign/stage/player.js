// Battle-map scene player: runs a STAGE script (src/campaign/data.js) with the real units on the loaded map -- walks
// (units/anim.js walkPath, the same stride the battle uses), facing, emote bubbles, camera moves, the genre dialogue windows
// anchored to the speaker, the boss nameplate, recruit banners, flashes and the finale tableau. Also plays the short
// in-battle lines (bark). Input: Enter / Space / click advance (the first press completes the typing), Esc skips the
// whole scene. A scene never changes the engine's positions: sprites walk on proxies and are put back on their tiles
// (and facings) when an intro ends. Auto mode (no player at the keys) advances lines on a timer.
import * as THREE from 'three';
import { facingFrom, HEIGHT_STEP } from '../../game/rules.js';
import { CLASSES } from '../../game/data.js';
import { walkPath } from '../../units/anim.js';
import { loadAtlas, UnitSprite } from '../../units/sprites.js';
import { spriteFor } from '../../units/roster.js';
import { CAST, BOSSES } from '../data.js';
import { h, esc, sleep, sfx, portraitEl, audio } from '../kit.js';
import { textRate } from '../../ui/prefs.js';
import { sceneCamera } from '../../render/cinematics.js';
import { setStageFoci, unitFocus } from '../../render/cutaway.js';
import './stage.css';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const md = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
const EMOTE = {
  '!': ['bang', '!'], '!!': ['bang', '!!'], '?': ['q', '?'], '...': ['', '&hellip;'],
  anger: ['', '<svg viewBox="0 0 24 24"><g fill="none" stroke="#d0281c" stroke-width="3.2" stroke-linecap="round"><path d="M3 9c4 0 6-2 6-6"/><path d="M15 3c0 4 2 6 6 6"/><path d="M21 15c-4 0-6 2-6 6"/><path d="M9 21c0-4-2-6-6-6"/></g></svg>'],
  note: ['', '<svg viewBox="0 0 24 24"><path d="M9 4v11.5a3.5 3.5 0 1 1-2-3.2V6l11-3v10.5a3.5 3.5 0 1 1-2-3.2V5.6L9 7.6" fill="#2a4aa8"/></svg>'],
};

/** Audio sting on the stinger deck of the battle's audio engine (window.__AUDIO__, public probe handle). Silent without it. */
export function sting(kind = 'boss') {
  try {
    const e = window.__AUDIO__?.engine; if (!e || e.ac.state === 'closed') return false;
    const t = e.now() + 0.02; const d = e.deck(e.sfx);
    if (kind === 'join') { audio().then((m) => m?.uiSfx?.('recruit')); return true; }
    if (kind === 'bell') { d.bell(t, 38, 1, { great: true }); d.bell(t + 0.02, 50, 0.7); d.timpani(t, 31, 0.9); d.cymSwell?.(t, 1.4, 0.5); e.duck(0.6, 2.2, t); return true; }
    if (kind === 'dread') { d.timpani(t, 33, 1); d.timpani(t + 0.42, 33, 0.8); d.brassChord(t + 0.1, [38, 45, 50, 51], 1.6, 0.8, { gain: 0.1, release: 0.5 }); d.choir?.(t + 0.1, 62, 1.6, 0.5); e.duck(0.5, 1.8, t); return true; }
    // boss: a hit on the timpani, a low brass stab that rises a tritone, a crash
    d.timpani(t, 38, 1); d.bassDrum(t, 0.9); d.brassChord(t, [38, 45, 50, 53], 0.35, 1, { gain: 0.12, release: 0.2 });
    d.brassChord(t + 0.38, [44, 50, 56, 59], 1.3, 1, { gain: 0.12, release: 0.6 }); d.timpani(t + 0.38, 44, 0.9); d.crash(t + 0.38, 0.8);
    e.duck(0.55, 1.6, t); return true;
  } catch (err) { console.warn('stage sting', err); return false; }
}

/**
 * R18: EVERY camera call the scene player makes goes through this one adapter -- now the camera owner's sceneCamera
 * (src/render/cinematics.js: frame() cuts without the screenshot lock and widens to a two-shot when the listener fits).
 * `cam` is the battle's camera rig (src/render/camera.js).
 *   yaw()                 current yaw (sprite facing / walk)       project(v)        THREE.Vector3 -> NDC (screen())
 *   zoom() / setZoom(z)   target zoom                               fit(pts, pad)     zoom that contains the world points
 *   frame(shot, cut)      shot = { key:[x,y,z], must, opt, at }: publish it to the stage hook and look at key (cut = no ease)
 *   hook(fn) / unhook()   install / remove the per-frame stage framing provider (chains the previous one)
 *   shake(v)              raise the shake to at least v
 */
export function stageCamera(cam) { return sceneCamera(cam); }   // R18: the camera owner's scene camera (src/render/cinematics.js), same interface

export class Stage {
  /** g: the battle page handles ({ battle, camera, ui }); opts: { sv, lines, node } */
  constructor(g, { sv = null, node = null } = {}) {
    this.g = g; this.b = g.battle; this.cam = stageCamera(g.camera); this.sv = sv; this.node = node;
    this.extras = new Map(); this.proxies = new Map(); this.pending = new Set(); this.speakerLast = null;
    this.skipping = false; this.active = false; this.mode = null; this._skipWaiters = new Set(); this._adv = null;
    this.root = null; this.anchors = new Set(); this.raf = 0;
  }
  // no player at the keys: lines advance on a timer (a capture driver can set window.__STAGE_HOLD__ to wait for Enter)
  get auto() { return !this.b.controller && !window.__STAGE_HOLD__; }
  // ------------------------------------------------------------ actors
  rec(key) { const c = CAST[key]; return this.sv?.roster?.find((r) => r.key === key || (!r.key && c && r.name === c.name)) || null; }
  unitFor(key) {
    const c = CAST[key]; if (!c) return null; const U = this.b.units;
    const foe = U.find((u) => u.team === 'B' && u.name === c.name && !u.removed);
    if (c.foe && foe) return foe;
    const r = this.rec(key); const mine = r ? U.find((u) => u.team === 'A' && u.recordId === r.id && !u.removed) : null;
    return mine || foe || null;
  }
  /** { key, u, s, p, extra } or null when the character is not on the field. */
  actor(key) {
    if (key && typeof key === 'object') return key;
    if (this.extras.has(key)) return this.extras.get(key);
    const u = this.unitFor(key); if (!u) return null; return this.actorOfUnit(u, key);
  }
  actorOfUnit(u, key = null) {
    const s = this.b.spriteOf(u); if (!s) return null;
    if (!this.proxies.has(u.id)) {
      const home = { x: u.x, z: u.z, facing: u.facing };
      this.proxies.set(u.id, { home, p: { x: u.x, z: u.z, get facing() { return u.facing; }, set facing(v) { if (v != null) u.facing = v; } } });
    }
    const pr = this.proxies.get(u.id);
    return { key: key || this.keyOfUnit(u), u, s, p: pr.p, home: pr.home, extra: false };
  }
  keyOfUnit(u) {
    if (u.team === 'A') { const r = this.sv?.roster?.find((x) => x.id === u.recordId); if (r?.key) return r.key; }
    return Object.keys(CAST).find((k) => CAST[k].name === u.name) || null;
  }
  group(name) {
    if (name === 'party' || name === 'foes' || name === 'all') {
      const t = name === 'party' ? 'A' : name === 'foes' ? 'B' : null;
      return this.b.units.filter((u) => (!t || u.team === t) && !u.ko && !u.removed).map((u) => this.actorOfUnit(u)).filter(Boolean);
    }
    const a = this.actor(name); return a ? [a] : [];
  }
  alive(a) { return a && (a.extra || (!a.u.ko && !a.u.removed)); }
  centroid(list) { if (!list.length) return null; let x = 0, z = 0; for (const a of list) { x += a.p.x; z += a.p.z; } return { x: x / list.length, z: z / list.length }; }
  spot(t) { // actor key | group | {x,z} -> {x,z}
    if (!t) return null; if (typeof t === 'object' && 'x' in t && !('p' in t)) return t;
    if (typeof t === 'object' && t.p) return t.p;
    return this.centroid(this.group(t));
  }
  // ------------------------------------------------------------ tiles
  tile(x, z) { return this.b.map.at(x, z); }
  occupied(x, z, except = null) {
    for (const u of this.b.units) { if (u.removed) continue; const a = this.proxies.get(u.id)?.p || u; if (a === except) continue; if (a.x === x && a.z === z) return true; }
    for (const e of this.extras.values()) if (e.p !== except && e.visible !== false && e.p.x === x && e.p.z === z) return true;
    return false;
  }
  walkable(x, z) { const t = this.tile(x, z); return !!(t && t.walk && !t.void); }
  step1(from, to) { const a = this.tile(from.x, from.z), b = this.tile(to.x, to.z); return !!(a && b && Math.abs(a.h - b.h) <= 4 * HEIGHT_STEP); }
  /** BFS path (list of [x,z], start excluded) from p to goal; occupied tiles are walls except the goal. */
  path(p, goal, { through = false } = {}) {
    const key = (x, z) => x + ',' + z; const prev = new Map([[key(p.x, p.z), null]]); const q = [[p.x, p.z]];
    while (q.length) {
      const [x, z] = q.shift(); if (x === goal.x && z === goal.z) break;
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz, k = key(nx, nz); if (prev.has(k) || !this.walkable(nx, nz) || !this.step1({ x, z }, { x: nx, z: nz })) continue;
        if (!through && !(nx === goal.x && nz === goal.z) && this.occupied(nx, nz, p)) continue;
        prev.set(k, [x, z]); q.push([nx, nz]);
      }
    }
    if (!prev.has(key(goal.x, goal.z))) return null;
    const out = []; let c = [goal.x, goal.z]; while (c && !(c[0] === p.x && c[1] === p.z)) { out.unshift(c); c = prev.get(key(c[0], c[1])); }
    return out;
  }
  /** Free tiles by walking distance from p: [{x,z,d}] (BFS through free walkable tiles). */
  ring(p, maxD = 6) {
    const key = (x, z) => x + ',' + z; const seen = new Set([key(p.x, p.z)]); const out = []; let fr = [[p.x, p.z]];
    for (let d = 1; d <= maxD && fr.length; d++) {
      const nx = [];
      for (const [x, z] of fr) for (const [dx, dz] of DIRS) {
        const a = x + dx, c = z + dz, k = key(a, c); if (seen.has(k) || !this.walkable(a, c) || !this.step1({ x, z }, { x: a, z: c })) continue; seen.add(k);
        if (this.occupied(a, c)) continue; out.push({ x: a, z: c, d }); nx.push([a, c]);
      }
      fr = nx;
    }
    return out;
  }
  /**
   * R18 (review17 #2) BLOCKING: `n` standing marks around `focal` ({x,z}) for a staged scene -- free walkable tiles, at
   * least `gap` tiles of air between any two marks and between a mark and anyone else standing there (Chebyshev >= gap+1),
   * nearest the focal point and on its level first. Actors in `ignore` (the ones about to take the marks) do not block.
   * Relaxes the gap (then the level) rather than returning fewer marks than asked, when the ground is tight.
   */
  marks(focal, n, { gap = 1, ignore = [], maxD = 7, claimed = [] } = {}) {
    if (n <= 0 || !focal) return [];
    const fx = Math.round(focal.x), fz = Math.round(focal.z); const skip = new Set(ignore.map((a) => a?.p).filter(Boolean));
    const others = [];
    for (const u of this.b.units) { if (u.removed || u.ko) continue; const q = this.proxies.get(u.id)?.p || u; if (!skip.has(q)) others.push({ x: q.x, z: q.z }); }
    for (const e of this.extras.values()) if (e.visible !== false && !skip.has(e.p)) others.push({ x: e.p.x, z: e.p.z });
    const h0 = this.tile(fx, fz)?.h ?? null;
    // every walkable tile reachable from the focal area (steps the scene can walk), with its cost
    const cand = [];
    for (let z = fz - maxD; z <= fz + maxD; z++) for (let x = fx - maxD; x <= fx + maxD; x++) {
      if (!this.walkable(x, z)) continue; if (others.some((o) => o.x === x && o.z === z)) continue;
      const t = this.tile(x, z); const dh = h0 == null ? 0 : Math.abs(t.h - h0) / HEIGHT_STEP;
      cand.push({ x, z, c: Math.hypot(x - focal.x, z - focal.z) + Math.min(4, dh) * 0.6 + (t.water ? 3 : 0) });
    }
    cand.sort((a, b) => a.c - b.c);
    const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
    for (let g = gap; g >= 0; g--) {
      const out = [...claimed.map((c) => ({ x: c.x, z: c.z, fixed: true }))];
      for (const c of cand) {
        if (out.length - claimed.length >= n) break;
        if (out.some((o) => cheb(o, c) < g + 1)) continue;
        if (g && others.some((o) => cheb(o, c) < g + 1)) continue;
        out.push(c);
      }
      const got = out.filter((o) => !o.fixed);
      if (got.length >= n || g === 0) return got.map(({ x, z }) => ({ x, z }));
    }
    return [];
  }
  /** Give each actor in `list` a mark (nearest actor to nearest mark, greedy), leader first. [{a, m}] */
  assign(list, marks) {
    const free = [...marks]; const out = [];
    for (const a of list) { if (!free.length) break; let bi = 0; for (let i = 1; i < free.length; i++) if (md(free[i], a.p) < md(free[bi], a.p)) bi = i; out.push({ a, m: free.splice(bi, 1)[0] }); }
    return out;
  }
  away(p, from, n, claimed = null) { // greedy n steps that increase the distance from `from`
    const out = []; let cur = { x: p.x, z: p.z };
    for (let i = 0; i < n; i++) {
      let best = null, bd = md(cur, from);
      for (const [dx, dz] of DIRS) {
        const t = { x: cur.x + dx, z: cur.z + dz }; if (!this.walkable(t.x, t.z) || !this.step1(cur, t) || this.occupied(t.x, t.z, p) || claimed?.has(t.x + ',' + t.z)) continue;
        const d = md(t, from) + (Math.abs(this.tile(t.x, t.z).h - this.tile(cur.x, cur.z).h) > 2 * HEIGHT_STEP ? -0.6 : 0);
        if (d > bd) { bd = d; best = t; }
      }
      if (!best) break; out.push([best.x, best.z]); cur = best;
    }
    return out;
  }
  // ------------------------------------------------------------ motion
  wp(x, z, lift = 0) { return this.b.worldPos(x, z, lift); }
  track(pr) { this.pending.add(pr); pr.finally(() => this.pending.delete(pr)); return pr; }
  async walk(a, path, speed = 1) {
    if (!a || !path?.length || !this.alive(a)) return;
    if (this.skipping) { const [x, z] = path[path.length - 1]; this.place(a, x, z); return; }
    const info = { key: a.key, from: [a.p.x, a.p.z], path: path.map((t) => t.join(',')).join(' ') }; (this.walking ||= new Set()).add(info);
    const home = a.home ? { ...a.home } : null; const sess = this.session;
    const walk = walkPath(a.s, a.p, path, { speed, camYaw: () => this.cam.yaw(), worldPos: (x, z) => this.wp(x, z), onTile: (x, z) => { a.p.x = x; a.p.z = z; } })
      .catch((e) => console.warn('stage walk', e))
      // a walk that outlives its scene (skipped, or capped on a slow machine) must not leave the sprite mid-walk or
      // turned: once it lands, a restored unit is put back on its engine tile and facing
      .then(() => { if (a.u && home && this.restoredSession === sess) this.snapUnit(a.u, home.facing); });
    (this.rawWalks ||= new Set()).add(walk); walk.finally(() => this.rawWalks.delete(walk));
    // a walk can never hold a scene hostage: past its budget the sprite is simply put on its last tile
    let to = 0; const cap = new Promise((r) => { to = setTimeout(() => { console.warn('stage walk overran', JSON.stringify(info)); r(); }, 4000 + path.length * 2000); });
    const pr = Promise.race([walk, cap]).finally(() => { clearTimeout(to); this.walking.delete(info); });
    await this.track(pr);
    const [x, z] = path[path.length - 1]; a.p.x = x; a.p.z = z;
  }
  place(a, x, z) { a.p.x = x; a.p.z = z; a.s.root.position.copy(this.wp(x, z)); a.s.walk = null; }
  face(a, t) { if (!a || !this.alive(a)) return; const s = this.spot(t); if (!s) return; const f = facingFrom(a.p.x, a.p.z, Math.round(s.x), Math.round(s.z)); if (f != null) { a.p.facing = f; if (a.extra) a.s.facing = f; } }
  head(a) { const s = a.s; const hgt = Math.max(1.35, (s.heightUnits || 1.5) * 1.02); const v = s.root.position.clone(); v.y += hgt; return v; }
  screen(v) { const p = this.cam.project(v); return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight, on: p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05 }; }
  /** Frame `t` (actor key / actor / group / {x,z}) through the camera's stage hook: the subject's body lands at
   *  `at` of the HUD-free rect with its feet and head inside it; `with` (a listener) joins the shot when it fits. */
  camTo(t, zoom = null, immediate = false, { with: other = null, at = [0.5, 0.6] } = {}) {
    let list = []; let pt = null;
    if (t && typeof t === 'object' && 'x' in t && !('p' in t)) pt = t; else list = (typeof t === 'object' && t?.p) ? [t] : this.group(t);
    list = list.filter((a) => a && (this.alive(a) || a.u?.ko));
    const body = (a, dest = false) => { const d = dest ? (this._marks?.get(a) || a.home) : null; const x = d ? d.x : a.p.x, z = d ? d.z : a.p.z; const f = this.wp(x, z); const hh = Math.max(1.2, (a.s.heightUnits || 1.4)); return [[f.x, f.y, f.z], [f.x, f.y + hh, f.z]]; };
    let pts = []; if (pt) { const f = this.wp(Math.round(pt.x), Math.round(pt.z)); f.x = pt.x + 0.5; f.z = pt.z + 0.5; pts = [[f.x, f.y, f.z], [f.x, f.y + 1.2, f.z]]; }
    for (const a of list) pts.push(...body(a, this._dest));
    if (!pts.length) return;
    const n = pts.length; const key = [pts.reduce((s0, p) => s0 + p[0], 0) / n, pts.reduce((s0, p) => s0 + p[1], 0) / n, pts.reduce((s0, p) => s0 + p[2], 0) / n];
    const o = other ? this.actor(other) : null; const opt = o && o !== list[0] && this.alive(o) ? body(o) : [];
    let z = zoom || (list.length > 1 || pt ? 1.65 : Math.max(this.cam.zoom(), 1.95));
    if (list.length > 1) z = Math.max(0.95, Math.min(z, this.cam.fit(pts, 0.1)));
    this.shot = { key, must: pts, opt, at };
    this.cam.setZoom(z);
    // window.__STAGE_SNAP__: capture drivers on software GL (~1 fps, and the camera springs clamp dt) cut instead of easing
    const cut = immediate || this.skipping || !!window.__STAGE_SNAP__;
    this.cam.frame(this.shot, cut);
  }
  // ------------------------------------------------------------ extras (characters who are not in the battle)
  async spawn(key, x, z, team = 'A') {
    const c = CAST[key]; const r = this.rec(key); const cls = r?.cls || c?.cls; if (!cls) return null;
    const name = CLASSES[cls]?.sprite || spriteFor(cls);
    const atlas = await loadAtlas(name); const s = new UnitSprite(atlas, {}); s.setTeam(team);
    s.root.position.copy(this.wp(x, z)); this.b.unitGroup.add(s.root);
    const e = { key, s, p: { x, z, facing: 0 }, extra: true, team, visible: true, spriteName: name };
    this.extras.set(key, e); return e;
  }
  dropExtras() { for (const e of this.extras.values()) { this.b.unitGroup.remove(e.s.root); } this.extras.clear(); }
  // ------------------------------------------------------------ session
  begin(mode) {
    this.active = true; this.mode = mode; this.skipping = false; this.speakerLast = null; this.session = (this.session || 0) + 1;
    this.root = h('div', 'sg-root'); document.body.appendChild(this.root);
    this.catcher = h('div', 'sg-catch'); document.body.appendChild(this.catcher);
    this.catcher.addEventListener('click', (e) => { e.stopPropagation(); this.advance(); });
    this.catcher.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
    if (mode === 'scene') {
      document.body.classList.add('sg-scene');
      this.bars = [h('div', 'sg-bar t'), h('div', 'sg-bar b')]; for (const b of this.bars) document.body.appendChild(b);
      requestAnimationFrame(() => document.body.classList.add('sg-bars-on'));
      this.hintRow = h('div', 'sg-hint-row', `<kbd>Enter</kbd>Next<kbd>Esc</kbd>Skip`); this.root.appendChild(this.hintRow);
      this.zoom0 = this.cam.zoom();
    }
    this.hookCam();
    // R20: the speaking unit (and a bark's focus) own the roof cutaway first, alive or fallen
    this._spk = null; this._foc = null;
    setStageFoci(() => {
      const out = []; const sp = this._spk?.u, fo = this._foc;
      if (sp && !sp.removed) out.push(unitFocus(this.b, sp, 'stageSpk'));
      if (fo && !fo.removed && fo !== sp) out.push(unitFocus(this.b, fo, 'stageFoc'));
      return out;
    });
    let last = performance.now();
    const tick = (now) => {
      if (!this.active) return; const dt = Math.min(0.05, (now - last) / 1000); last = now;
      for (const e of this.extras.values()) { e.s.facing = e.p.facing; e.s.update(this.cam.yaw(), dt); }
      for (const fn of this.anchors) fn();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  async end() {
    if (!this.active) return;
    if (this.mode === 'scene') {
      document.body.classList.remove('sg-bars-on'); document.body.classList.remove('sg-scene');
      const bars = this.bars; setTimeout(() => bars?.forEach((b) => b.remove()), 500);
    }
    this.anchors.clear(); cancelAnimationFrame(this.raf); this.active = false; setStageFoci(null); this._spk = this._foc = null;
    this.shot = null; this.cam.unhook();
    if (this._plate) { const p = this._plate; this._plate = null; p.remove(); }
    this.root?.remove(); this.catcher?.remove(); this.root = null; this.catcher = null; this._adv = null;
  }
  /** Frame through the camera's stage hook (camera.setStageFn) while a scene is up; the previous hook is chained. */
  hookCam() { this.cam.hook(() => this.shot); }
  advance() { const f = this._adv; if (f) f(); }
  skip() { if (!this.active || this.skipping) return; this.skipping = true; sfx('cancel'); for (const f of this._skipWaiters) f(); this._skipWaiters.clear(); this.advance(); }
  wait(ms) { if (this.skipping || ms <= 0) return Promise.resolve(); return new Promise((r) => { const t = setTimeout(() => { this._skipWaiters.delete(f); r(); }, ms); const f = () => { clearTimeout(t); r(); }; this._skipWaiters.add(f); }); }
  /** Resolves on advance (or skip, or after `autoMs` in auto mode). */
  waitAdvance(autoMs = 0) {
    if (this.skipping) return Promise.resolve();
    return new Promise((r) => { let t = 0; const done = () => { clearTimeout(t); if (this._adv === done) this._adv = null; r(); }; this._adv = done; if (autoMs) t = setTimeout(done, autoMs); });
  }
  // ------------------------------------------------------------ windows
  anchor(el, a, { free = false } = {}) {
    let side = null;
    const place = () => {
      if (!el.isConnected) { this.anchors.delete(place); return; }
      const W = el.offsetWidth, H = el.offsetHeight; const bar = this.mode === 'scene' ? innerHeight * 0.09 : 0;
      if (free || !a || !this.alive(a) && !a.u?.ko) { el.style.left = `${Math.round((innerWidth - W) / 2)}px`; el.style.top = `${Math.round(innerHeight - bar - H - 26)}px`; el.classList.add('free'); return; }
      const hd = this.screen(this.head(a)); const ft = this.screen(a.s.root.position);
      if (!hd.on) { el.style.left = `${Math.round((innerWidth - W) / 2)}px`; el.style.top = `${Math.round(innerHeight - bar - H - 26)}px`; el.classList.add('free'); return; }
      el.classList.remove('free');
      if (!side) side = hd.y - H - 30 > bar + 8 ? 'above' : 'below'; el.classList.toggle('above', side === 'above'); el.classList.toggle('below', side === 'below');
      let top = side === 'above' ? hd.y - H - 22 : ft.y + 22; top = Math.max(bar + 6, Math.min(innerHeight - bar - H - 6, top));
      let left = Math.max(10, Math.min(innerWidth - W - 10, hd.x - W * 0.32));
      // R18 (review17 R2): the docked boss nameplate is a keep-out -- the window drops below it, or steps right of it
      // (the name tab rides ~20px above the window's box, so it counts too)
      const kr = this.keepOut(); if (kr && left < kr.right + 6 && left + W > kr.left - 6 && top - 22 < kr.bottom + 4 && top + H > kr.top - 6) {
        if (kr.bottom + 26 + H <= innerHeight - bar - 6) top = kr.bottom + 26; else left = Math.min(innerWidth - W - 10, kr.right + 8);
      }
      el.style.left = `${Math.round(left)}px`; el.style.top = `${Math.round(top)}px`;
      el.style.setProperty('--tx', `${Math.round(Math.max(22, Math.min(W - 22, hd.x - left)))}px`);
    };
    this.anchors.add(place); place(); return () => this.anchors.delete(place);
  }
  /** Screen rect the speech windows must not cover (the docked boss nameplate), or null. */
  keepOut() { const p = this._plate; if (!p || !p.isConnected || !p.classList.contains('dock') || p.classList.contains('out')) return null; const r = p.getBoundingClientRect(); return r.width ? r : null; }
  typeInto(box, t, text) {
    // the unrevealed rest of the line is laid out (invisible) from the first frame, so the window never grows or reflows
    let n = 0, timer = 0, fin = false, blip = 0; t.innerHTML = '<span class="v"></span><span class="g" style="visibility:hidden"></span>';
    const V = t.firstChild, G = t.lastChild; G.textContent = text;
    const show = (m) => { V.textContent = text.slice(0, m); G.textContent = text.slice(m); };
    return new Promise((res) => {
      const done = () => { if (fin) return; fin = true; clearInterval(timer); show(text.length); box.classList.add('done'); res(); };
      const step = 2 * textRate(); if (step >= 60 || this.skipping) { done(); return; }
      timer = setInterval(() => { if (this.skipping) return done(); n += step; const m = Math.floor(n); show(m); if (m - blip >= 6) { blip = m; sfx('text'); } if (m >= text.length) done(); }, 22);
      this._adv = done;
    });
  }
  async say(who, text, { bark = false } = {}) {
    if (this.skipping) return;
    const c = CAST[who] || { name: who }; const a = this.actor(who);
    const foe = !!(a?.u ? a.u.team === 'B' : c.foe);
    const sprite = a?.u?.spriteName || a?.spriteName || (c.cls ? (CLASSES[c.cls]?.sprite || spriteFor(c.cls)) : null);
    // R18 (review17 R2): the nameplate had the screen to itself (plate()); it now docks to the top-left corner for the
    // line that follows, and the speech window keeps clear of it (anchor keepOut) -- never stamped over the text.
    if (this._plate && !this._plate.classList.contains('dock')) this._plate.classList.add('dock', this.mode === 'scene' ? 'lb' : 'nb');
    const box = h('div', `k-win sg-say${foe ? ' foe' : ''}${bark ? ' bark' : ''}${sprite ? '' : ' noface'}`);
    box.innerHTML = `<div class="k-tab">${esc(a?.u?.name && a.u.team === 'B' ? a.u.name : c.name)}</div><div class="sg-txt"></div><i class="sg-more"></i><i class="sg-tail"></i>`;
    if (sprite) box.prepend(portraitEl(sprite, `k-portrait${foe ? ' enemy' : ''}`, (c.name || '?')[0]));
    this.root.appendChild(box); const off = this.anchor(box, a && (this.alive(a) || a.u?.ko) ? a : null);
    // the battle's roof cutaway opens around battle.active: between turns (always, here) the speaker borrows it
    const prevAct = this.b.active; if (a?.u && !a.u.removed) this.b.active = a.u;
    const prevSpk = this._spk; if (a?.u) this._spk = a;
    sfx('page');
    await this.typeInto(box, box.querySelector('.sg-txt'), text);
    await this.waitAdvance(this.auto ? 900 + text.length * 32 : 0);
    off(); box.remove(); this.b.active = prevAct; this._spk = prevSpk; if (this._plate) this._dropPlate?.(); if (!this.skipping) await sleep(90);
  }
  async narr(text) {
    if (this.skipping) return;
    const box = h('div', 'k-win slate sg-narr', '<div class="sg-txt"></div><i class="sg-more"></i>'); this.root.appendChild(box); sfx('page');
    await this.typeInto(box, box.querySelector('.sg-txt'), text);
    await this.waitAdvance(this.auto ? 1100 + text.length * 30 : 0); box.remove(); await this.wait(120);
  }
  emote(who, kind) {
    const a = this.actor(who); if (!a || this.skipping) return;
    const [cls, glyph] = EMOTE[kind] || ['', esc(kind)];
    const el = h('div', `sg-emote ${cls}`, glyph); this.root.appendChild(el);
    const place = () => { const p = this.screen(this.head(a)); el.style.left = `${Math.round(p.x)}px`; el.style.top = `${Math.round(p.y)}px`; };
    const fn = () => { if (!el.isConnected) this.anchors.delete(fn); else place(); }; this.anchors.add(fn); place();
    sfx(kind === '?' || kind === '...' ? 'cursor' : 'confirm');
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, 1150);
  }
  async plate(who) {
    const cfg = Object.values(BOSSES).find((x) => x.key === who); const a = this.actor(who); const c = CAST[who];
    const name = (a?.u?.name) || c?.name || who; if (this.skipping) return;
    const el = h('div', 'sg-plate', `<small>${esc(cfg?.title || '')}</small><b>${esc(name)}</b>`); (this.root || document.body).appendChild(el);
    sting('boss'); this.cam.shake(0.18);
    // the plate stays up through the next line (say() docks it, and takes it down at the line's end), or 6 s when nobody speaks
    this._plate = el; const drop = () => { if (!el.isConnected || el.classList.contains('out')) return; el.classList.add('out'); setTimeout(() => el.remove(), 380); if (this._plate === el) this._plate = null; };
    this._dropPlate = drop; setTimeout(() => { if (!el.classList.contains('dock')) drop(); }, this.skipping ? 0 : 6000);   // docked: the line's end takes it down
    await this.wait(1700);
  }
  async join(who) {
    if (this.skipping) return; const c = CAST[who]; const r = this.rec(who); const cls = r?.cls || c?.cls;
    const el = h('div', 'k-win sg-join', `<div><small>New companion</small><div class="t">${esc(c?.name || who)} joins!</div></div>`);
    if (cls) el.prepend(portraitEl(CLASSES[cls]?.sprite || spriteFor(cls), 'k-portrait', (c?.name || '?')[0]));
    this.root.appendChild(el); sting('join'); const a = this.actor(who); if (a) this.b.vfx?.play?.('buff', a.s.root.position.clone(), a.s.root.position.clone());
    await this.waitAdvance(this.auto ? 2200 : window.__STAGE_HOLD__ ? 0 : 2600); el.classList.add('out'); setTimeout(() => el.remove(), 320);
  }
  flash(color = '#fff') { if (this.skipping) return; const f = h('div', 'sg-flash'); f.style.background = color; document.body.appendChild(f); setTimeout(() => f.remove(), 800); }
  // ------------------------------------------------------------ script
  lineOf(i) { return this.lines?.[i] || null; }
  async line(i) {
    const L = this.lineOf(i); if (!L) return; const [who, text] = L;
    if (who === 'narrator') return this.narr(text);
    const a = this.actor(who);
    if (a && this.alive(a)) {
      const lis = this.speakerLast && this.speakerLast !== who ? this.actor(this.speakerLast) : null;
      if (lis && this.alive(lis) && md(a.p, lis.p) <= 9) this.face(a, lis);
      else this.face(a, a.u?.team === 'B' ? 'party' : 'foes');
      const sc = this.screen(this.head(a)); const moved = this._framed !== who && !this._camHeld; this._camHeld = false;
      if (moved || !sc.on || sc.x < innerWidth * 0.15 || sc.x > innerWidth * 0.85 || sc.y < innerHeight * 0.3 || sc.y > innerHeight * 0.8) { this.camTo(a, null, false, { with: lis }); this._framed = who; await this.wait(500); }
    }
    this.speakerLast = who;
    await this.say(who, text);
  }
  async op(o) {
    if (this.skipping) return;
    const [k, ...a] = o;
    switch (k) {
      case 'arrive': return this.arrive();
      case 'line': return this.line(a[0]);
      case 'say': this.speakerLast = a[0]; return this.say(a[0], a[1]);
      case 'narr': return this.narr(typeof a[0] === 'number' ? this.lineOf(a[0])?.[1] || '' : a[0]);
      case 'cam': this.camTo(a[0], a[1] || null); this._framed = typeof a[0] === 'string' ? a[0] : null; this._camHeld = true; return this.wait(700);
      case 'wait': return this.wait(a[0]);
      case 'shake': this.cam.shake(a[0] || 0.25); return this.wait(250);
      case 'flash': this.flash(a[0]); return this.wait(200);
      case 'face': { for (const x of this.group(a[0])) this.face(x, a[1]); return this.wait(180); }
      case 'emote': this.emote(a[0], a[1]); return this.wait(700);
      case 'step': return this.stepOp(a[0], a[1], a[2] ?? 1);
      case 'enter': return this.enter(a[0], a[1], a[2]);
      case 'exit': return this.exit(a[0]);
      case 'join': return this.join(a[0]);
      case 'plate': return this.plate(a[0]);
      case 'sting': sting(a[0]); return this.wait(300);
      case 'pose': { const x = this.actor(a[0]); if (x && this.alive(x)) { x.s.setPose(a[1]); setTimeout(() => x.s.setPose('idle'), a[2] || 900); } return this.wait(Math.min(a[2] || 900, 500)); }
      case 'fx': { const x = this.actor(a[1]); if (x) { const p = x.s.root.position.clone(); this.b.vfx?.play?.(a[0], p, p); } return this.wait(600); }
      case 'kneel': return this.kneel(a[0]);
      case 'tableau': return this.tableau(a[0], a[1]);
      case 'par': return Promise.all(a.map((x) => this.op(x)));
      default: console.warn('stage: unknown op', k);
    }
  }
  /** Run a scene: { script, lines, restore } */
  async run(script, { lines = [], restore = true } = {}) {
    this.lines = lines; this.begin('scene');
    try {
      for (const o of script) { if (this.skipping) break; await this.op(o); }
      if (!this.skipping) await this.wait(300);
    } catch (e) { console.error('stage scene failed', e); }
    if (this.skipping) { const bl = h('div', 'sg-black'); document.body.appendChild(bl); void bl.offsetWidth; bl.classList.add('on'); await sleep(260); this._black = bl; }
    await Promise.allSettled([...this.pending]);
    if (this.skipping && this.rawWalks?.size) await Promise.race([Promise.allSettled([...this.rawWalks]), sleep(1500)]);
    if (restore) this.restore();
    if (this._black) { const bl = this._black; this._black = null; bl.classList.remove('on'); setTimeout(() => bl.remove(), 500); }
    await this.end();
  }
  // ------------------------------------------------------------ composite ops
  /** Before the cover fades: move the company back along their approach so 'arrive' can walk them in. */
  prelude(script, lines = []) {
    if (script?.[0]?.[0] !== 'arrive') return; this._arr = []; this.hookCam();
    const party = this.group('party'); const foes = this.centroid(this.group('foes')) || { x: this.b.map.w / 2, z: this.b.map.d / 2 };
    // R18 BLOCKING: the company walks in to spaced marks around where it deployed (one tile of air between any two),
    // not back onto the packed deployment tiles; restore() puts everyone back on their real tiles when the scene ends.
    const c0 = this.centroid(party); const mk = this.assign(party, this.marks(c0, party.length, { ignore: party }));
    const markOf = new Map(mk.map(({ a, m }) => [a, m]));
    const claimed = new Set([...party.map((a) => a.p.x + ',' + a.p.z), ...mk.map(({ m }) => m.x + ',' + m.z)]);
    for (const a of party) {
      const m = markOf.get(a) || a.home;
      const back = this.away(m, foes, 3, claimed); const start = back.length ? back[back.length - 1] : [a.p.x, a.p.z];
      claimed.add(start[0] + ',' + start[1]);
      const path = back.length ? [...back.slice(0, -1).reverse(), [m.x, m.z]] : (m.x === a.p.x && m.z === a.p.z ? [] : this.path(a.p, m, { through: true }) || []);
      this.place(a, start[0], start[1]); this.face(a, m); if (path.length) this._arr.push({ a, path, m });
    }
    this._marks = markOf;
    // R18 BLOCKING (integrator, review17 P3): a foe who SPEAKS in the scene (a line, the nameplate, a step or a pose) and
    // stands more than 6 tiles from the company is set on a spaced mark ~4-5 tiles out on his own side, so speaker and
    // listener fit one two-shot (Vey used to talk from across the foundry, the listener off-frame on most lines).
    const talk = new Set([...(lines || []).map((l) => l?.[0]), ...script.filter((o) => ['plate', 'step', 'pose', 'emote', 'cam'].includes(o[0])).map((o) => o[1])].filter((k) => typeof k === 'string'));
    const c1 = this.centroid(mk.map(({ m }) => ({ p: m }))) || c0; const partyMarks = mk.map(({ m }) => m);
    for (const f of this.group('foes')) {
      if (!talk.has(f.key) || md(f.p, c1) <= 6) continue;
      const dx = f.p.x - c1.x, dz = f.p.z - c1.z, L = Math.hypot(dx, dz) || 1; const want = { x: c1.x + dx / L * 4.5, z: c1.z + dz / L * 4.5 };
      const m = this.marks(want, 1, { ignore: [f], claimed: partyMarks, maxD: 4 })[0];
      if (m && md(m, c1) < md(f.p, c1)) { this.place(f, m.x, m.z); this.face(f, c1); partyMarks.push(m); }
    }
    this._dest = true; this.camTo('party', 1.75, true); this._dest = false;
  }
  async arrive() {
    const party = this.group('party'); if (!this._arr) this.prelude([['arrive']]);
    this._dest = true; this.camTo('party', 1.75); this._dest = false;
    const walks = (this._arr || []).map(({ a, path }, i) => sleep(i * 140).then(() => this.walk(a, path)));
    this._arr = null; await Promise.all(walks); this._marks = null;
    for (const a of party) this.face(a, 'foes');
    await this.wait(250);
  }
  async stepOp(who, toward, n) {
    const list = this.group(who); const T = this.spot(toward); if (!T || !list.length) return;
    const goal = { x: Math.round(T.x), z: Math.round(T.z) }; const jobs = [];
    for (const a of list) {
      if (!this.alive(a)) continue; let path;
      if (n < 0) path = this.away(a.p, goal, -n);
      else { const full = this.path(a.p, goal, { through: true }) || []; path = full.slice(0, Math.min(n, Math.max(0, full.length - 2))); while (path.length && this.occupied(...path[path.length - 1], a.p)) path.pop(); }
      if (path.length) jobs.push(this.walk(a, path).then(() => this.face(a, n < 0 ? a.p : goal)));
    }
    await Promise.all(jobs);
    for (const a of list) if (n < 0) this.face(a, goal);
  }
  async enter(key, near, team) {
    const N = this.actor(near) || this.group('party')[0]; if (!N) return;
    let a = this.actor(key);
    const other = this.centroid(this.group(N.u?.team === 'B' ? 'party' : 'foes'));
    if (!a) {
      const ring = this.ring(N.p, 6); if (!ring.length) return;
      const far = ring.filter((t) => t.d >= 4); const pool = far.length ? far : ring;
      pool.sort((p, q) => (other ? md(q, other) - md(p, other) : 0) || q.d - p.d);
      const st = pool[0]; a = await this.spawn(key, st.x, st.z, team || (CAST[key]?.foe ? 'B' : 'A')); if (!a) return;
    }
    // R18 BLOCKING: the newcomer stops two tiles from `near` (one tile of air), on the side it came from
    const reach = new Set(this.ring(N.p, 4).map((t) => t.x + ',' + t.z));
    const opts = this.marks(N.p, 6, { ignore: [a] }).filter((m) => reach.has(m.x + ',' + m.z) && md(m, N.p) >= 2);
    const near1 = opts.sort((p, q) => md(p, a.p) - md(q, a.p) + (md(p, N.p) - md(q, N.p)) * 0.5)[0] || this.ring(N.p, 3).sort((p, q) => p.d - q.d || md(p, a.p) - md(q, a.p))[0];
    this.camTo({ x: (N.p.x + a.p.x) / 2, z: (N.p.z + a.p.z) / 2 });
    if (near1) { const path = this.path(a.p, near1); if (path) await this.walk(a, path); }
    this.face(a, N); this.face(N, a); await this.wait(200);
  }
  async exit(key) {
    const a = this.actor(key); if (!a || !a.extra) return;
    const from = this.centroid(this.group('party')) || a.p; const path = this.away(a.p, from, 4);
    if (path.length) await this.walk(a, path);
    a.visible = false; a.s.root.visible = false;
  }
  async kneel(who) {
    const a = this.actor(who); if (!a || a.extra) return;
    const u = a.u; if (u.ko || u.removed || u.hp <= 0) this.revive(a, 0.1); else u.hp = Math.min(u.hp, Math.max(1, Math.floor(u.maxHp * 0.1)));
    this.speakerLast = null; await this.wait(700);
  }
  /** Stand a fallen / crystallised unit back up (scenes after the battle only; the result has already been saved). */
  revive(a, frac = 0.25) {
    const u = a.u, s = a.s; u.ko = false; u.removed = false; u.hp = Math.max(1, Math.floor(u.maxHp * frac)); u.koTurns = 0;
    s.crystAt = 0; s.root.visible = true; s.setKO(false, 1);
  }
  reviveParty() { for (const u of this.b.units) if (u.team === 'A' && (u.ko || u.removed)) { const a = this.actorOfUnit(u); if (a) this.revive(a); } }
  async tableau(title, sub) {
    const hr = this.sv?.roster?.find((r) => r.hero); const hero = this.b.units.find((u) => u.team === 'A' && hr && u.recordId === hr.id && !u.ko) || this.b.units.find((u) => u.team === 'A' && !u.ko);
    const H = hero ? this.actorOfUnit(hero) : null;
    if (H) {
      this.camTo(H, 1.9); const others = this.group('party').filter((a) => a !== H);
      const spots = this.assign(others, this.marks(H.p, others.length, { ignore: others, claimed: [H.p] })).reduce((o, { a, m }) => { o[others.indexOf(a)] = m; return o; }, []);
      await Promise.all(others.map((a, i) => { const t = spots[i]; if (!t) return null; const path = this.path(a.p, t); return path && path.length <= 12 ? sleep(i * 120).then(() => this.walk(a, path)).then(() => this.face(a, H)) : null; }));
      this.face(H, 'foes'); await this.wait(500);
      this.cam.setZoom(0.95); await this.wait(2400);
    }
    const bl = h('div', 'sg-black'); document.body.appendChild(bl); void bl.offsetWidth; bl.classList.add('on'); await this.wait(900);
    const card = h('div', 'sg-card', `<div><small>${esc(sub || '')}</small>${esc(title || '')}</div>`); document.body.appendChild(card);
    this._tableau = [bl, card];
    await this.waitAdvance(this.auto ? 2600 : 5200);
  }
  snapUnit(u, facing = null) {
    const s = this.b.spriteOf(u); if (!s || u.ko || u.removed) return;
    s.root.position.copy(this.wp(u.x, u.z)); s.walk = null; s.setPose('idle'); if (facing != null) u.facing = facing; s.facing = u.facing;
  }
  /** Put every real unit back on its engine tile and facing; drop the extras. */
  restore() {
    this.restoredSession = this.session;
    for (const [id, pr] of this.proxies) {
      const u = this.b.units.find((x) => x.id === id); if (!u) continue; const s = this.b.spriteOf(u);
      if (!u.ko && !u.removed) { s.root.position.copy(this.wp(u.x, u.z)); s.walk = null; s.setPose('idle'); }
      u.facing = pr.home.facing; pr.p.x = u.x; pr.p.z = u.z;
    }
    this.proxies.clear(); this.dropExtras();
    if (this.zoom0) this.cam.setZoom(this.zoom0);
  }
  // ------------------------------------------------------------ in-battle lines
  /** A short exchange mid-battle: no letterbox, the HUD stays; lines = [[who, text]]. opts.focus: actor key/unit. */
  async bark(lines, { focus = null, before = null } = {}) {
    this.lines = lines; this.begin('bark');
    // R20 (review19 P4 / RG2): a line is a SCENE beat. The stale cards go (a charged spell resolves without a turnEnd, so its
    // 'Effect: Blizzard' card was still up while Malquor spoke), the speaker owns the roof cutaway for the whole exchange
    // (battleboot's cutaway provider reads the unit card first, then battle.active), and when terrain or a wall hides
    // the speaker from this yaw stop the lens turns to the nearest dimetric stop that shows them (turned back after).
    try { this.g.ui?.forecast?.(null); this.g.ui?.setActive?.(null); } catch { /* ui */ }
    document.body.classList.add('sg-barking');
    const prevAct = this.b.active; let turned = 0;
    try {
      const f = focus ? (focus.id ? this.actorOfUnit(focus) : this.actor(focus)) : this.actor(lines[0]?.[0]);
      const sp = this.actor(lines.find(([w]) => w !== 'narrator')?.[0]) || f;
      if (f?.u && !f.u.removed) this.b.active = f.u;
      this._foc = f?.u || null;
      if (f) {
        turned = this.cam.reveal?.(f.u || null, sp && sp !== f ? sp.u : null) || 0;
        // the speaker (when it is not the focus, e.g. Seren crying out for a fallen Aldric) shares the shot when it fits
        this.camTo(f, null, false, { with: sp && sp !== f ? sp : null }); await this.wait(turned ? 650 : 420);
      }
      if (before) await before(this);
      for (const [who, text] of lines) {
        if (this.skipping) break; const a = this.actor(who);
        if (a && this.alive(a) && f && a !== f && md(a.p, f.p) <= 8) { this.face(a, f); }
        // a speaker other than the focus who is off the picture (or behind the cards) gets the lens for the line
        if (a && a !== f && this.alive(a) && !this.skipping) { const sc = this.screen(this.head(a)); if (!sc.on || sc.x < innerWidth * 0.1 || sc.x > innerWidth * 0.9 || sc.y < innerHeight * 0.22 || sc.y > innerHeight * 0.78) { this.camTo(a, null, false, { with: f }); await this.wait(420); } }
        if (who === 'narrator') await this.narr(text); else await this.say(who, text, { bark: true });
      }
    } catch (e) { console.error('stage bark failed', e); }
    if (turned) this.cam.rotate?.(-turned);
    this.b.active = prevAct; document.body.classList.remove('sg-barking');
    // a bark only turns heads for the conversation: facing is game state (back attacks), so it is put back
    for (const [id, pr] of this.proxies) { const u = this.b.units.find((x) => x.id === id); if (u) u.facing = pr.home.facing; }
    this.proxies.clear(); await this.end();
  }
}
export { THREE };
