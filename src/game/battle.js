import * as THREE from 'three';
import { HSTEP } from '../core/config.js';
import { ABILITIES, CLASSES, STATUS, REACTIONS, Engine, KO_TURNS, stat, facingFrom, effectTiles, isRanged, weaponOf } from './rules.js';
import { decide } from './ai.js';
import { loadAtlas, UnitSprite } from '../units/sprites.js';
import { walkPath, attackWindup, attackRecover, hitReact, evadeReact, HITSTOP_MS, profileOf } from '../units/anim.js';
import { stompDust } from '../vfx/unitfx.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Battle: presentation wrapper around the pure rules Engine (src/game/rules.js). The engine owns the CT clock, turn state,
// statuses, reactions and ability resolution and returns event lists; this class replays them as sprite/vfx/ui/camera beats.
// Movement/attack animation timing (moveAlong, pose calls, KO pose) belongs to the units item — see src/units/anim.js.
// Split an ability's inner events into per-victim groups (one engine applyHit each): the victim's own beats plus
// what rides on its hit for the caster (drain heal, Backlash recoil and its KO, Mana Burn MP, a reaction's status).
function victimGroups(inner, att) {
  const out = []; let cur = null;
  for (const e of inner) {
    const k = e.type === 'reaction' ? e.unit : (e.victim || e.unit || null);
    const rides = cur && cur.key && cur.key !== att && k === att && (e.source || e.drain || e.type === 'ko' || e.type === 'mp' || e.type === 'statusEnd' || (e.type === 'status' && (e.stolenFrom || e.unit !== att)));
    if (!cur || (k && k !== cur.key && !rides)) { cur = { key: k, ev: [] }; out.push(cur); }
    cur.ev.push(e);
  }
  return out;
}
export class Battle {
  constructor({ map, scene, camera, vfx, ui, overlay }) {
    Object.assign(this, { map, scene, camera, vfx, ui, overlay }); this.units = []; this.sprites = new Map(); this.phase = 'idle'; this.log = []; this.speed = 1; this.auto = false; this.busy = false; this.over = false;
    this.engine = new Engine(map, { units: this.units }); this.unitGroup = new THREE.Group(); this.unitGroup.name = 'units'; scene.add(this.unitGroup);
    this.listeners = new Map(); this.controller = null; this.active = null;
    this.stats = new Map(); this.winner = null; this.objective = this.engine.setObjective({ type: 'rout' }); this._chargeSig = ''; this.moveSnap = null;
    // REWIND: one snapshot per player-side turn start (newest last); snapshotExtra: other modules' state riding along
    // (registerSnapshot). rewindLimit: how many of the newest turns are offered (Infinity = unlimited; the page sets it).
    this.history = []; this.snapshotExtra = new Map(); this._rewindTo = null; this.rewindLimit = 10; this.abortInput = null;
  }
  // ---- objective (SHELL): { type: 'rout' } = defeat all enemies; { type: 'leader', leaderId } = the leader's side
  // loses when that unit falls (leaderId: a unit id or a progression recordId). Optional protect: [ids] — any of those
  // units falling loses the battle for its side (the genre's "Aldric falls" defeat). Call after the units are added.
  setObjective(o = { type: 'rout' }) {
    this.objective = this.engine.setObjective(o); const L = this.engine.leader();
    this.ui.setObjective?.(this.objectiveText(), L);
    return this.objective;
  }
  objectiveText() {
    const L = this.engine.leader(); const keep = this.engine.protected().filter((u) => u.team === 'A').map((u) => u.name);
    const win = L && L.team === 'B' ? `Defeat ${L.name}!` : 'Defeat all enemies!';
    const lose = L && L.team === 'A' ? `${L.name} falls` : keep.length ? `${keep.join(' or ')} falls` : 'All allies fall';
    return { win, lose };
  }
  // ---- battle record for progression.applyResults (src/game/progression.js) ----
  statOf(u) { if (!this.stats.has(u.id)) this.stats.set(u.id, { kills: 0, dmg: 0, heal: 0, actions: 0, kos: 0 }); return this.stats.get(u.id); }
  track(events) {
    for (const e of events) {
      if (e.type === 'damage' && e.unit && e.victim && e.unit !== e.victim && e.unit.team !== e.victim.team) this.statOf(e.unit).dmg += e.amount;
      // QA r12: a unit's own Regen tick is not healing it did (the results card read "1178 healed" for an Oathknight on a Verdant Pendant)
      else if ((e.type === 'heal' || e.type === 'raise') && e.unit && e.victim && e.unit.team === e.victim.team && !e.absorb && !(e.source === 'Regen' && e.unit === e.victim)) this.statOf(e.unit).heal += e.amount || 0;
      else if (e.type === 'ko') { this.statOf(e.victim).kos++; if (e.by && e.by.team !== e.victim.team) this.statOf(e.by).kills++; }
    }
  }
  summary() {
    const avg = (t) => { const l = this.units.filter((u) => u.team === t); return l.length ? l.reduce((a, u) => a + (u.lvl || 10), 0) / l.length : null; };
    const units = {};
    for (const u of this.units) { const s = this.statOf(u); units[u.recordId ?? u.id] = { ...s, ko: u.ko || u.removed, crystal: u.removed, team: u.team, cls: u.cls, lvl: u.lvl, name: u.name, unitId: u.id, recordId: u.recordId ?? null, hp: u.hp, maxHp: u.maxHp }; }
    return { winner: this.winner, over: this.over, turns: this.engine.turn, rounds: this.engine.round, ticks: this.engine.tick, objective: { ...this.objective }, enemyLvl: avg('B'), enemyLvlOf: { A: avg('B'), B: avg('A') }, units };
  }
  get time() { return this.engine.tick; }   // clock ticks (the UI clock shows tick/10 "h")
  get turn() { return this.engine.turn; }
  // Event bus so camera / audio / vfx / ui modules can react without editing this file.
  on(evt, fn) { if (!this.listeners.has(evt)) this.listeners.set(evt, []); this.listeners.get(evt).push(fn); return () => this.off(evt, fn); }
  off(evt, fn) { const l = this.listeners.get(evt); if (l) l.splice(l.indexOf(fn), 1); }
  emit(evt, data) { for (const fn of this.listeners.get(evt) || []) { try { fn(data); } catch (e) { console.error('listener', evt, e); } } }
  worldPos(x, z, lift = 0) { return new THREE.Vector3(x + 0.5, this.map.at(x, z).h * HSTEP + lift, z + 0.5); }
  async addUnit(team, cls, x, z, name, opts) {
    const u = this.engine.addUnit(team, cls, x, z, name, opts);
    const atlas = await loadAtlas(u.spriteName); const s = new UnitSprite(atlas, { height: u.height ? u.height : undefined });
    s.setTeam(u.team);   // team colour for the occlusion silhouette (units/sprites.js); the sprite owns everything else about it
    s.root.position.copy(this.worldPos(x, z)); s.facing = u.facing; this.unitGroup.add(s.root); this.sprites.set(u.id, s);
    return u;
  }
  spriteOf(u) { return this.sprites.get(u.id); }
  turnOrder(n = 8) { return this.engine.forecast(n); }
  // Per-unit field badges for the UI/overlay layer: the genre draws a small numbered disc over charging units and over
  // KO'd bodies counting down to the crystal (see a reference capture, a reference capture). Returns plain data, no three.js.
  badges() {
    const out = [];
    for (const u of this.units) {
      if (u.removed) continue;
      if (u.ko) out.push({ unit: u, kind: 'crystal', text: String(Math.max(1, KO_TURNS - u.koTurns)), tone: 'danger' });
      else if (u.charging) out.push({ unit: u, kind: 'charge', text: String(Math.max(0, u.charging.left)), tone: 'charge', ability: ABILITIES[u.charging.id] });
      const st = Object.keys(u.statuses).filter((s) => STATUS[s] && !STATUS[s].mod);
      if (st.length) out.push({ unit: u, kind: 'status', statuses: st.map((s) => ({ id: s, name: STATUS[s].name, neg: !!STATUS[s].neg, turns: u.statuses[s] >= 99 ? null : u.statuses[s] })) });
    }
    return out;
  }
  // Charge queue for the timeline UI: which tile each charging ability will land on, and in how many ticks.
  charges() { return this.units.filter((u) => u.charging && !u.ko && !u.removed).map((u) => ({ unit: u, id: u.charging.id, ability: ABILITIES[u.charging.id], target: { ...u.charging.target }, left: u.charging.left, total: u.charging.total })); }
  // ---- turn flow ----
  async run() { while (!this.over) { await this.step(); if (!this.auto) break; } }
  async step() {
    if ((this.over && !this._rewindTo) || this.busy) return; this.busy = true;
    try {
      if (this._rewindTo) { const s = this._rewindTo; this._rewindTo = null; await this.restoreSnapshot(s); return; }
      const a = this.engine.advance(); if (!a) { if (this.engine.over) this.checkVictory(); return; }
      if (a.kind === 'charge') { await this.resolveCharge(a.unit); this.checkVictory(); return; }
      if (a.kind === 'countdown') { const s = this.spriteOf(a.unit); s.koBeat?.(a.left); this.ui.popup(this.worldPos(a.unit.x, a.unit.z, 0.9), String(a.left), 'status'); this.emit('countdown', { unit: a.unit, left: a.left }); await sleep(260 / this.speed); return; }
      if (a.kind === 'crystal') { await this.crystallise(a.unit); this.checkVictory(); return; }
      if (a.unit.team === 'A') this.recordTurn(a.unit);
      await this.takeTurn(a.unit);
      if (this._rewindTo) { const s = this._rewindTo; this._rewindTo = null; await this.restoreSnapshot(s); return; }
      this.checkVictory();
    } finally { this.busy = false; }
  }
  async takeTurn(u) {
    this.active = u; this.moveSnap = null; const ev0 = this.engine.beginTurn(u); this.emit('turnStart', { unit: u });
    if (this.engine.turn === 1) { const o = this.objectiveText(); this.ui.objectiveBanner?.(o); }
    this.ui.setActive(u); this.ui.setTurnOrder(this.turnOrder());
    this.camera.lookAt(this.worldPos(u.x, u.z, 0.6)); this.overlay.showActive(u.x, u.z);
    await this.play(ev0.filter((e) => e.type !== 'turnStart'));
    await sleep(350 / this.speed);
    if (u.ko) { /* died to poison at turn start */ }
    else if (u.statuses.sleep) { this.ui.announce(`${u.name} is asleep`); await sleep(400 / this.speed); }
    else {
      let decision = null;
      if (this.controller && !u.charmedTurn) decision = await this.controller(u);
      // REWIND picked while this turn waited on the player: the turn is abandoned whole (no endTurn, no facing); step()
      // restores the snapshot right after this returns.
      if (decision?.rewind) { this.overlay.clear(); this.ui.setActive(null); this.active = null; this.moveSnap = null; this.endFacing = null; return; }
      if (u.charmedTurn) this.ui.announce(`${u.name} is charmed`);
      if (!decision) { decision = decide(u, this.engine); await this.playDecision(u, decision); }
      else if (!decision.done) await this.playDecision(u, decision);
      if (decision.facing != null) this.endFacing = decision.facing;
    }
    await this.play(this.engine.endTurn(u, { facing: this.endFacing })); this.endFacing = null;
    this.spriteOf(u).facing = u.facing; this.emit('turnEnd', { unit: u });
    this.overlay.clear(); this.ui.setActive(null); this.active = null;
    await sleep(120 / this.speed);
  }
  async playDecision(u, d) {
    const act = async () => { if (d.ab && this.engine.canAct(u)) await this.useAbility(u, d.ab, d.target); };
    const move = async () => { if (d.tile && (d.tile.x !== u.x || d.tile.z !== u.z) && this.engine.canMove(u)) await this.moveTo(u, d.tile); };
    if (d.order === 'act-move') { await act(); await move(); } else { await move(); await act(); }
  }
  // Move: the engine commits the destination (movement abilities fire here); the walk animation then re-applies the tiles.
  async moveTo(u, tile) {
    const reach = this.engine.reach(u); const path = reach.path(tile.x, tile.z); if (!path) return false;
    const sx = u.x, sz = u.z;
    const snap = { x: u.x, z: u.z, facing: u.facing, mp: u.mp, movementUsed: u.movementUsed, grants: u.grants.slice(), defMods: Object.fromEntries(this.engine.alliesOf(u).map((a) => [a.id, a.mods.defMod])) };
    const ev = this.engine.move(u, path); u.x = sx; u.z = sz;
    // Undo is offered only when the walk touched nobody else in a way that cannot be put back (Fell Approach's
    // poison, Menacing Advance's CT); a Bulwark grant is reverted by Engine.undoMove.
    this.moveSnap = ev.some((e) => (e.victim && e.victim !== u && e.status !== 'bulwark') || e.type === 'ct') ? null : snap;
    if (reach.teleport) { const s = this.spriteOf(u); this.vfx.play('buff', this.worldPos(sx, sz), this.worldPos(sx, sz)); await sleep(160 / this.speed); s.root.position.copy(this.worldPos(tile.x, tile.z)); u.x = tile.x; u.z = tile.z; this.vfx.play('buff', s.root.position, s.root.position); this.emit('moveStart', { unit: u, path: [] }); this.emit('moveEnd', { unit: u }); }
    else await this.moveAlong(u, path);
    u.x = tile.x; u.z = tile.z; this.ui.setActive(u);
    await this.play(ev.filter((e) => e.type !== 'move')); return true;
  }
  async moveAlong(u, path) { // animation timing lives in units/anim.js (walk cycle, hop on height change, turn beat)
    const s = this.spriteOf(u); this.emit('moveStart', { unit: u, path });
    await walkPath(s, u, path, { speed: this.speed, camYaw: () => this.camera.yawNow, worldPos: (x, z) => this.worldPos(x, z), onTile: (x, z) => { u.x = x; u.z = z; this.ui.setActive(u); } });
    this.emit('moveEnd', { unit: u });
  }
  // Undo the move made this turn (player only, before acting). Returns true when the unit is back on its tile.
  undoMove(u) {
    if (!this.moveSnap || !this.engine.undoMove(u, this.moveSnap)) return false;
    this.moveSnap = null; const s = this.spriteOf(u); s.root.position.copy(this.worldPos(u.x, u.z)); s.facing = u.facing;
    this.ui.setActive(u); this.camera.lookAt(this.worldPos(u.x, u.z, 0.6)); this.emit('undoMove', { unit: u }); return true;
  }
  async useAbility(u, id, target) {
    const ab = ABILITIES[id]; if (!ab) return; const s = this.spriteOf(u);
    this.moveSnap = null; this.statOf(u).actions++;
    const ev = this.engine.act(u, id, target); s.facing = u.facing;
    const ch = ev.find((e) => e.type === 'charge');
    if (ch) { // charge: announce and queue on the target tile
      s.setPose('cast'); this.ui.announce(`${u.name} begins ${ab.name}`); this.overlay.showTarget(ch.tiles); this.emit('charge', { unit: u, ability: ab, id, target, ct: ch.ct });
      this.vfx.play('buff', this.worldPos(u.x, u.z), this.worldPos(u.x, u.z)); await sleep(650 / this.speed); s.setPose('idle'); this.overlay.clear(); // sprite stays in the charging loop via setCharging (update)
      if (ab.jumpAttack) { const from = s.root.position.clone(); const t0 = performance.now(); await new Promise((res) => { const tick = () => { const k = Math.min(1, (performance.now() - t0) / 300); s.root.position.copy(from); s.root.position.y += 7 * k * k; if (k < 1) requestAnimationFrame(tick); else res(); }; tick(); }); s.root.visible = false; }
      this.ui.setActive(u); return;
    }
    await this.play(ev);
  }
  async resolveCharge(u) {
    const c = u.charging; const ab = ABILITIES[c.id]; const s = this.spriteOf(u);
    this.ui.setActive(u); this.camera.lookAt(this.worldPos(c.target.x, c.target.z, 0.6)); await sleep(250 / this.speed);
    const ev = this.engine.resolveCharge(u);
    const land = ev.find((e) => e.type === 'land');
    if (land) { // wyrmlancer: drop from above onto the landing tile
      s.root.visible = true; const to = this.worldPos(land.to.x, land.to.z); s.root.position.set(to.x, to.y + 6, to.z); const from = s.root.position.clone(); const t0 = performance.now();
      await new Promise((res) => { const tick = () => { const k = Math.min(1, (performance.now() - t0) / 350); s.root.position.lerpVectors(from, to, k * k); s.setPose('attack'); if (k < 1) requestAnimationFrame(tick); else res(); }; tick(); });
      this.camera.shake = 0.35; s.facing = u.facing;
    }
    await this.play(ev.filter((e) => e.type !== 'land')); this.ui.setActive(null);
  }
  // Direct resolution (used by screenshot scenarios): resolve an ability now, ignoring MP/CT.
  async resolve(u, ab, target, id) { const ev = this.engine.resolve(u, ab, target, { id: id || ab.id }); await this.play(ev); }
  // ---- event replay: turns engine events into animation beats ----
  async play(events) {
    this.track(events); let i = 0;
    while (i < events.length) {
      const e = events[i];
      if (e.type === 'abilityStart') { const end = events.findIndex((x, j) => j > i && x.type === 'abilityEnd' && x.unit === e.unit && x.reaction === e.reaction); const j = end < 0 ? events.length : end; await this.playAbility(e, events.slice(i + 1, j)); i = j + 1; continue; }
      await this.playEvent(e); i++;
    }
  }
  async playAbility(start, inner) {
    const u = start.unit, ab = start.ability, target = start.target, id = start.id; const s = this.spriteOf(u);
    const label = start.earthsong ? start.earthsong.name : ab.name;
    this.ui.announce(start.reaction ? `${REACTIONS[u.reaction]?.name || label}!` : ab.name === 'Attack' ? '' : label);
    this.emit('abilityStart', { unit: u, ability: ab, id, target, reaction: start.reaction });
    this.overlay.showTarget(start.tiles);
    s.facing = u.facing;
    // Animation timing (units item, R11). A basic weapon Attack with a bow / gun is a SHOT: draw-aim-release and a
    // projectile, not a 0.4-tile lunge plus a sword slash on a victim four tiles away.
    const wpn = ab.range === 'w' && ab.kind === 'phys' && isRanged(u, ab) ? weaponOf(u).type : null;
    const fx = wpn && ab.vfx === 'slash' ? (wpn === 'gun' ? 'gunshot' : wpn === 'bow' ? 'arrow' : 'stone') : ab.vfx;
    // The effect fires as the blow STARTS its swing (melee: onStrike) or on the release frame (spells, shots), and the
    // victim reacts when the effect says it lands — so the flash, recoil and number sit on the contact frame.
    const whiff = !inner.some((e) => e.type === 'damage' || e.type === 'heal' || e.type === 'status' || e.type === 'raise') && inner.some((e) => e.type === 'miss');
    let impactAt = 0, sched = null; const groups = victimGroups(inner, u);
    const fire = () => { if (impactAt) return; const nc = this.vfx._creatures?.length || 0;
      const d = this.vfx.play(fx, this.worldPos(u.x, u.z), this.worldPos(target.x, target.z), whiff ? { miss: true } : undefined); impactAt = performance.now() + d * 1000;
      if (groups.length > 1) try { sched = this.hitSchedule(target, ab, groups, d || 0, (this.vfx._creatures?.length || 0) > nc, whiff); } catch (e) { console.warn('hitSchedule', e); sched = null; }
      this.emit('impact', { unit: u, ability: ab, id, target }); };
    { const dir = this.worldPos(target.x, target.z).sub(s.root.position).setY(0); if (dir.lengthSq() > 0) dir.normalize(); await attackWindup(s, ab, dir, this.speed, { ranged: !!(ab.ranged || wpn), onStrike: fire, onStomp: () => stompDust(this.vfx, s.root.position.clone().addScaledVector(dir, 0.3), Math.min(1.6, (s.heightUnits || 1.4) / 1.4)) }); } // anticipation → strike → contact frame (units/anim.js)
    fire();
    if (ab.kind === 'phys' && (ab.mult || 0) >= 1) this.camera.shake = profileOf(s).shake;   // R19: a giant's slam shakes harder than a dagger
    // CONTACT. A multi-target effect hits its victims one at a time (the VFX ripple: centre first, then by distance,
    // vfx._rippleStep apart), so the centre victim reacts on the main impact and each further one on its own hit.
    const centreAt = sched ? impactAt - sched.extra * 1000 : impactAt;
    await sleep(Math.max(0, centreAt - performance.now()));
    // Hit-stop: a connecting physical blow freezes both fighters (attacker on the contact frame, victim held white) and
    // the effect clock for ~75 ms; then the attacker follows through while the victim's knock plays out.
    const hit = inner.some((e) => e.type === 'damage' && !e.source); const stop = hit && ab.kind === 'phys' ? HITSTOP_MS / this.speed : 0;
    if (stop) this.vfx.hitStop?.(stop / 1000); this._stop = stop;
    let delay = 0;
    // group the victim events so the sub-beats for one victim land together
    const count = (e) => { if (e.type === 'damage' || e.type === 'heal' || e.type === 'miss') delay += 60; };
    if (!sched) for (const e of inner) { await this.playEvent(e, u); count(e); }
    else {
      // Each victim's beats run on their own slot, so one victim's Mana Shield / knockback beat never pushes the next
      // victim off its hit; all of them are awaited here, so nothing is left in flight past abilityEnd (rewind-safe).
      // The ripple's pops are on the effect clock, which the hit-stop froze: later hits slide by the stop too.
      const t0 = performance.now(); const beats = [];
      for (const g of sched.order) {
        const at = centreAt + (g.slot > 0 ? stop : 0) + g.slot * sched.step * 1000;
        if (at <= t0 + 1) { for (const e of g.ev) { await this.playEvent(e, u); count(e); } continue; }   // on the impact: in order, now
        beats.push((async () => { await sleep(at - performance.now()); for (const e of g.ev) { await this.playEvent(e, u); count(e); } })());
      }
      await Promise.all(beats);
    }
    this._stop = 0; const miss = !hit && inner.some((e) => e.type === 'miss');
    await sleep(stop + 40 / this.speed); attackRecover(s, this.speed, { miss }); await sleep((380 + delay) / this.speed); this.overlay.clear(); this.emit('abilityEnd', { unit: u, ability: ab, id, reaction: start.reaction });
  }
  /** When each victim group of a multi-target ability lands, matched to the VFX ripple (vfx/summons.js): the centre
   *  victim on the main impact, every further one ~_rippleStep() later in _victims() order (distance from the target
   *  tile, then x, then z); a summon lands on its victims in that order from its first hit. Returns
   *  { order: [{ slot, ev }] (play order), step (s), extra (s: how far the VFX's returned duration runs past the centre
   *  hit) } or null (one victim: everything on the impact, as before). Presentation only: the engine already resolved. */
  hitSchedule(target, ab, groups, d, summoned, whiff) {
    const V = this.vfx; const step = typeof V?._rippleStep === 'function' ? V._rippleStep() : 0.075 / Math.max(0.25, this.speed);
    const tx = target.x, tz = target.z; const dd = (o) => Math.abs(o.x - tx) + Math.abs(o.z - tz);
    let vl = []; try { vl = typeof V?._victims === 'function' ? V._victims(this.worldPos(tx, tz)) || [] : []; } catch (e) { vl = []; }
    const rippled = !whiff && (summoned || ((ab.area || 0) >= 1 && vl.length >= 2));
    const vslot = new Map(); let j = 0; vl.forEach((v, i) => { if (!v.u) return; if (summoned) vslot.set(v.u, i); else vslot.set(v.u, dd(v.u) === 0 ? 0 : ++j); });
    const extra = !rippled ? 0 : summoned ? Math.max(0, (vl.length || 1) - 1) * step : j * step;
    const keyed = groups.filter((g) => g.key); const keys = [...new Set(keyed.map((g) => g.key))];
    keys.sort((a, b) => dd(a) - dd(b) || a.x - b.x || a.z - b.z);
    const slotOf = new Map(); let last = 0, rank = 0;
    for (const k of keys) {
      if (!rippled) { slotOf.set(k, rank++); continue; }                 // no per-victim VFX hits: a plain stagger
      if (vslot.has(k)) last = vslot.get(k);                            // exactly on its own VFX pop
      slotOf.set(k, last);                                              // (a victim the VFX skipped shares its neighbour's)
    }
    const order = groups.map((g, i) => ({ slot: g.key ? slotOf.get(g.key) : 0, ev: g.ev, i })).sort((a, b) => a.slot - b.slot || a.i - b.i);
    return { order, step, extra };
  }
  async playEvent(e, attacker) {
    const v = e.victim || e.unit; const vs = v ? this.spriteOf(v) : null; const pos = v ? this.worldPos(v.x, v.z, 1.3) : null;
    const dirFrom = (from) => (from && v ? this.worldPos(v.x, v.z).sub(this.worldPos(from.x, from.z)).setY(0).normalize() : new THREE.Vector3(0, 0, 1));
    switch (e.type) {
      case 'miss': this.ui.popup(pos, 'Miss', 'miss'); evadeReact(vs, dirFrom(e.unit), this.speed, { camRight: new THREE.Vector3(Math.cos(this.camera.yawNow || 0), 0, -Math.sin(this.camera.yawNow || 0)) }); this.emit('miss', { unit: e.unit, victim: v }); break;
      case 'damage':
        this.emit('damage', { unit: e.unit, victim: v, amount: e.amount, source: e.source, ability: e.ability });
        this.ui.popup(pos, String(e.amount), 'dmg');
        if (e.source) { vs.flash = 0.2; } else hitReact(vs, dirFrom(e.unit !== v ? e.unit : null), this.speed, { heavy: e.amount >= v.maxHp * 0.25, stop: this._stop || 0 });
        if (e.elemMul > 1) this.ui.popup(this.worldPos(v.x, v.z, 1.75), 'Weak', 'status'); if (e.elemMul === 0) this.ui.popup(this.worldPos(v.x, v.z, 1.75), 'Immune', 'status');
        this.ui.setUnitHp(v); break;
      case 'heal': this.ui.popup(pos, String(e.amount), 'heal'); if (e.source) this.ui.popup(this.worldPos(v.x, v.z, 1.7), e.source, 'status'); if (!e.drain && !e.source) this.vfx.play('cure', pos, this.worldPos(v.x, v.z)); this.emit('heal', { unit: e.unit, victim: v, amount: e.amount }); this.ui.setUnitHp(v); break;
      case 'mp': if (e.source !== undefined && e.amount > 0) { this.ui.popup(this.worldPos(v.x, v.z, 1.5), `+${e.amount} MP`, 'status'); this.ui.setUnitHp(v); } break;
      case 'raise': vs.setKO(false, this.speed); vs.root.visible = true; this.ui.popup(pos, String(e.amount), 'heal'); this.vfx.play('cure', pos, this.worldPos(v.x, v.z)); this.emit('raise', { unit: e.unit, victim: v }); this.ui.setUnitHp(v); break;
      case 'reraise': vs.setKO(false, this.speed); this.ui.popup(pos, 'Reraise', 'status'); this.ui.popup(this.worldPos(v.x, v.z, 1.0), String(e.amount), 'heal'); this.vfx.play('cure', pos, this.worldPos(v.x, v.z)); this.emit('raise', { unit: v, victim: v, reraise: true }); break;
      case 'status':
        if (e.applied) { this.ui.popup(this.worldPos(v.x, v.z, 1.7), e.mod ? `${e.name} ${e.value > 0 ? '+' : ''}${e.value}` : e.name, 'status'); if (e.status !== 'bulwark' && !STATUS[e.status]?.pos) this.vfx.play('debuff', pos, this.worldPos(v.x, v.z)); this.emit('status', { unit: e.unit, victim: v, status: e.status, applied: true }); }
        else if (e.why) this.ui.popup(this.worldPos(v.x, v.z, 1.7), e.why === 'immune' ? 'Immune' : e.why === 'cancelled' ? `${e.name} cancelled` : 'Resisted', 'status');
        this.ui.setUnitHp(v); break;
      case 'statusEnd': this.ui.setUnitHp(v); this.emit('statusEnd', { unit: v, status: e.status }); break;
      case 'reaction': this.ui.popup(this.worldPos(v.x, v.z, 1.9), e.name, 'reaction'); this.ui.announce(`${e.name}!`); this.emit('reaction', { unit: v, reaction: e.reaction, name: e.name, nullified: !!e.nullified }); if (e.nullified) evadeReact(vs, dirFrom(attacker), this.speed); await sleep(140 / this.speed); break;
      case 'knockback': { const from = vs.root.position.clone(), to = this.worldPos(e.to.x, e.to.z); const t0 = performance.now(); await new Promise((res) => { const tick = () => { const k = Math.min(1, (performance.now() - t0) / (180 / this.speed)); vs.root.position.lerpVectors(from, to, k); vs.root.position.y += Math.sin(k * Math.PI) * 0.15; if (k < 1) requestAnimationFrame(tick); else res(); }; tick(); }); this.emit('knockback', { unit: e.unit, victim: v, from: e.from, to: e.to }); break; }
      case 'ko': setTimeout(() => vs.setKO(true, this.speed), 240 / this.speed); this.ui.announce(`${v.name} falls`); this.emit('ko', { victim: v, by: e.by }); this.ui.setUnitHp(v); break;
      case 'quick': this.ui.popup(this.worldPos(v.x, v.z, 1.7), 'Quick', 'status'); this.vfx.play('buff', pos, this.worldPos(v.x, v.z)); break;
      case 'move': case 'charge': case 'land': case 'turnStart': case 'turnEnd': case 'abilityEnd': break;
      default: break;
    }
  }
  async crystallise(u) { // KO countdown ran out: the body becomes a crystal and leaves the field
    const s = this.spriteOf(u); const p = this.worldPos(u.x, u.z, 0.3); this.ui.announce(`${u.name} crystallises`);
    s.crystallize?.(this.speed); this.vfx.play('cure', p, this.worldPos(u.x, u.z)); this.emit('crystal', { unit: u, pos: p }); await sleep(420 / this.speed); s.root.visible = false;
  }
  checkVictory() {
    const r = this.engine.checkVictory(); if (!r.over || this.over) return;
    this.over = true; const team = r.winner;               // null == a genuine draw; `|| 'B'` used to hand it to B,
    this.winner = team; this.auto = false;
    this.ui.victory(team, { leader: !!r.leader, fallen: r.fallen?.name || (r.leader ? this.engine.leader()?.name : null), objective: this.objectiveText() });   // so a player on A lost a battle they had actually drawn
    this.emit('victory', { team, timeout: !!r.timeout, mutual: !!r.mutual, leader: !!r.leader, protect: !!r.protect, summary: this.summary() });
  }
  update(dt) {
    // Charged abilities stay marked on the field until they resolve (the genre paints the queued tiles every turn).
    const ch = this.charges(); const sig = ch.map((c) => `${c.unit.id}:${c.target.x},${c.target.z}:${c.left}`).join('|');
    if (sig !== this._chargeSig) { this._chargeSig = sig; this.overlay.showCharges?.(ch.map((c) => ({ ...c, tiles: effectTiles(c.unit, c.target, c.ability, this.map) }))); }
    for (const u of this.units) { const s = this.spriteOf(u); if (!s) continue; s.facing = u.facing; s.setCharging(!!u.charging); s.setWounded?.(!u.ko && u.hp > 0 && u.hp <= u.maxHp * 0.2); if (u.removed && s.root.visible) s.root.visible = false; s.update(this.camera.yawNow, dt); } }
  busyUnit(u) { return this.active === u; }

  // ---- REWIND (classic tactics Reborn's Chariot Tarot / Triangle Strategy) ----------------------------------------------
  // A snapshot is the rules engine (units, clock, counters, objective, the RNG's state), the battle record (stats) and
  // every registered extra, taken at the START of a player-side turn. Restoring one abandons everything after it: the
  // history is cut back, the record is the restored one (results and EXP only ever see the final timeline), and every
  // visual (sprites, overlay, strip, VFX, camera) is re-derived from the restored state.
  /** Other modules put state into snapshots: save() -> structured-cloneable data, load(data) puts it back. */
  registerSnapshot(key, { save, load }) { this.snapshotExtra.set(key, { save, load }); return () => this.snapshotExtra.delete(key); }
  snapshot(u = null) {
    const extra = {}; for (const [k, r] of this.snapshotExtra) { try { extra[k] = structuredClone(r.save()); } catch (e) { console.warn('snapshot extra', k, e); } }
    const side = (t) => this.units.filter((o) => o.team === t && !o.removed).map((o) => ({ id: o.id, name: o.name, cls: o.cls, hp: o.ko ? 0 : o.hp, maxHp: o.maxHp, ko: !!o.ko, x: o.x, z: o.z, sprite: o.spriteName, charging: !!o.charging, leader: !!o.leader }));
    return { engine: this.engine.snapshot(), stats: structuredClone([...this.stats]), extra, turn: this.engine.turn + 1, round: this.engine.round, tick: this.engine.tick,
      unitId: u?.id ?? null, name: u?.name ?? '', cls: u?.cls ?? null, sprite: u?.spriteName ?? null, team: u?.team ?? null, at: Date.now(), sides: { A: side('A'), B: side('B') }, thumb: null };
  }
  recordTurn(u) {
    // Never the same turn twice (a restore re-enters the turn it restored and records it afresh).
    const s = this.snapshot(u); const last = this.history[this.history.length - 1]; if (last && last.turn >= s.turn) this.history = this.history.filter((h) => h.turn < s.turn);
    this.history.push(s); const cap = Number.isFinite(this.rewindLimit) ? Math.max(1, this.rewindLimit) + 2 : 400; if (this.history.length > cap) this.history.splice(0, this.history.length - cap);
    this.emit('snapshot', { snapshot: s, unit: u }); return s;
  }
  /** The turns the player may go back to, newest first (the current turn's own start included). */
  rewindTargets() { const l = this.history.slice().reverse(); return Number.isFinite(this.rewindLimit) ? l.slice(0, Math.max(0, this.rewindLimit)) : l; }
  /** Go back to snapshot s. Applied now when the player's turn is waiting on input (the turn is abandoned), else at the
   *  next turn boundary (never mid-animation). Returns 'now' | 'queued' | false. */
  requestRewind(s) {
    if (!s || !this.history.includes(s)) return false;
    this._rewindTo = s;
    try { if (this.abortInput?.()) return 'now'; } catch (e) { console.warn('abortInput', e); }
    return 'queued';
  }
  /** From outside the turn loop (a lost battle, the loop has ended): restore now and hand back; the caller restarts run(). */
  async rewindNow(s) {
    for (let i = 0; i < 200 && this.busy; i++) await sleep(25);
    if (this.busy) return this.requestRewind(s);
    this.busy = true; try { await this.restoreSnapshot(s); } finally { this.busy = false; } return 'now';
  }
  async restoreSnapshot(s) {
    const i = this.history.indexOf(s); if (i >= 0) this.history.length = i;   // the new timeline starts here; this turn re-records itself
    const { removed, added } = this.engine.restore(s.engine);
    this.stats = new Map(structuredClone(s.stats));
    for (const [k, r] of this.snapshotExtra) if (k in s.extra) { try { r.load(structuredClone(s.extra[k])); } catch (e) { console.warn('restore extra', k, e); } }
    this.over = !!this.engine.over; this.winner = this.engine.winner ?? null; this.active = null; this.moveSnap = null; this.endFacing = null;
    for (const u of added) { try { const sp = new UnitSprite(await loadAtlas(u.spriteName), { height: u.height || undefined }); sp.setTeam(u.team); this.unitGroup.add(sp.root); this.sprites.set(u.id, sp); } catch (e) { console.warn('rewind sprite', e); } }
    this.resync(removed, s);
    const unit = this.units.find((u) => u.id === s.unitId) || null;
    this.emit('rewind', { turn: s.turn, unit, snapshot: s, removed });
  }
  /** Re-derive every visual from the (restored) rules state. */
  resync(removed = [], s = null) {
    for (const u of removed) { const sp = this.sprites.get(u.id); if (sp && !this.units.some((o) => o.id === u.id)) { this.unitGroup.remove(sp.root); sp.root.visible = false; this.sprites.delete(u.id); } }
    const now = performance.now();
    for (const u of this.units) {
      const sp = this.spriteOf(u); if (!sp) continue;
      sp.walk = null; sp.off?.set?.(0, 0, 0); sp.hop = 0; sp.lean = 0; sp.squash = 0; sp.flash = 0; sp.flashUntil = 0; sp.koBeatAt = -1e9; sp.crystAt = 0; sp.riseAt = 0; sp.koSpeed = 1;
      sp.ko = !!u.ko && !u.removed; sp.koAt = sp.ko ? now - 1e5 : 0; sp.koT = sp.ko ? 1 : 0; sp.koLeft = sp.ko ? Math.max(1, KO_TURNS - u.koTurns) : null;
      if (sp.pivot) { sp.pivot.rotation.set(0, 0, 0); sp.pivot.position.set(0, 0, 0); sp.pivot.scale.set(1, 1, 1); }
      sp.setPose('idle'); sp.facing = u.facing; sp.setCharging(!!u.charging); sp.setWounded?.(!u.ko && u.hp > 0 && u.hp <= u.maxHp * 0.2);
      sp.root.position.copy(this.worldPos(u.x, u.z)); sp.root.visible = !u.removed && !u.airborne;
      if (sp.root.parent !== this.unitGroup) this.unitGroup.add(sp.root);
    }
    // effects in flight belong to the abandoned timeline
    const V = this.vfx;
    try { if (V?.clear) V.clear(); else if (V?._rollback) { V._rollback({ live: 0, add: 0, norm: 0, washes: 0, lights: (V.lights || []).map(() => false) }); for (const l of V.lights || []) { l.busy = false; if (l.light) { l.light.intensity = 0; l.light.visible = false; } } } } catch (e) { console.warn('rewind vfx', e); }
    const O = this.overlay; O.clear(); O.showFacing?.(0, 0, null); O.setCursor?.(null); O.setHeat?.(null); O.showCharges?.([]); this._chargeSig = '';
    const U = this.ui;
    try {
      U.closeMenu?.(); U.forecast?.(null); U.setActive?.(null); U.announce?.('');
      for (const p of U.popups || []) p.el?.remove(); if (U.popups) U.popups.length = 0;
      U.el?.title?.classList.remove('show', 'victory'); U.showObjective?.(true);
      for (const u of this.units) U.setUnitHp?.(u);
      U.setTurnOrder?.(this.turnOrder());
    } catch (e) { console.warn('rewind ui', e); }
    const next = s ? this.units.find((u) => u.id === s.unitId) : null;
    if (next) { this.camera.lookAt(this.worldPos(next.x, next.z, 0.6)); this.overlay.showActive(next.x, next.z); }
    try { window.__GAME__?.invalidateShadows?.(); window.__GAME__?.cutaway?.snap?.(); } catch (e) { /* capture hooks optional */ }
  }
}
