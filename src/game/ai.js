// Role-aware greedy AI. Evaluates (order, tile, ability, target) over reachable tiles in both orders (Move→Act and Act→Move),
// scores damage/kills, friendly fire, statuses by target role, heals by urgency, raises, buffs by threat, debuffs, and position
// (high ground, exposure for casters, bodyguarding casters, retreat when hurt). Pure: works headlessly for src/game/sim.mjs.
import { ABILITIES, STATUS, CLASSES, MOVEMENTS, targetTiles, effectTiles, areaTiles, computeEffect, hitChance, stat, abilityMp, abilityCT, abilityRange, canUse, isRanged, chainTargets, isShaped, facingFrom, HEIGHT_STEP, weaponOf, statusImmune } from './rules.js';
import { STAT_MOD_STEP } from './data.js';   // rules.js consumes it but does not re-export it
const MOD_NAME = { atkMod: { up: 'focus', down: 'atk_down' }, magMod: { up: 'focus', down: 'atk_down' }, defMod: { up: 'bulwark', down: 'def_down' }, spdMod: { up: 'yell', down: 'spd_down' } };

const mdist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const REF_ATK = 40, REF_SPD = 8;      // T.atk.M / T.spd.M: the stat table's mid-tier attacker, the yardstick below
const isCaster = (u) => stat(u, 'mag') > stat(u, 'atk');
const isHealer = (u) => { if (u._healN !== u.abilityList.length) { u._healN = u.abilityList.length; u._heal = u.abilityList.some((id) => ABILITIES[id].kind === 'heal' && ABILITIES[id].power); } return u._heal; };
// A unit that does its damage from range wants the same standoff distance a caster does — otherwise the AI walks
// archers, gunners and apothecarys straight into melee and throws away their whole advantage.
const isSkirmisher = (u) => weaponOf(u).ranged || u.abilityList.some((id) => { const a = ABILITIES[id]; return (a.kind === 'phys' || a.kind === 'mag') && typeof a.range === 'number' && a.range >= 3; });
// Per-victim weights, computed once per scored action and threaded into statusValue. `ctrl` prices a turn stolen
// from THIS unit — a Stop on a fast 50-ATK wyrm is not the same purchase as a Stop on a Apothecary — and is damped as
// the clock stalls, so two control teams cannot lock each other down past the stall limit. `heals` is whether the
// victim's own side can still undo damage, which is the only thing Curse is for.
function victimWeights(engine, u, v, enemies, allies) {
  const side = engine.teamOf(v) === engine.teamOf(u) ? allies : enemies;
  const out = Math.max(stat(v, 'atk'), stat(v, 'mag')), tempo = stat(v, 'spd') / REF_SPD;
  const damp = 0.6 + 0.4 * caution(engine);
  return { ctrl: clamp((out / REF_ATK) * tempo, 0.6, 1.6) * damp, damp, out, heals: isHealer(v) || side.some(isHealer) };
}
// value of landing a status on an enemy, by the enemy's role
function statusValue(id, v, w = {}) {
  const caster = isCaster(v); const hp = v.hp / v.maxHp; const k = w.ctrl ?? 1;
  switch (id) {
    case 'sleep': return 60 * hp * k; case 'stop': return 90 * hp * k; case 'disable': return 45 * k; case 'immobilize': return (caster ? 12 : 30) * k;
    // Charm takes a turn AND hands it to the caster's side, so it is worth two turns of the victim's output, not one.
    case 'charm': return 1.6 * (w.out ?? stat(v, 'atk')) * (w.damp ?? 1);
    case 'silence': return silenceValue(v, w); case 'blind': return blindValue(v, w); case 'slow': return 40 * hp * k;
    // Poison ignores DEF and RES and ticks 10% of max HP on each of its three turns, so it is priced as the damage it
    // really does to a target healthy enough to take every tick — not as a single hit's worth (the old 2.2).
    case 'poison': return 0.1 * v.maxHp * 3 * hp;
    // Fear is a quarter of the victim's output over its next two turns plus the reaction it can no longer fire, and
    // on this roster the reaction half is the bigger one: Dragonheart, Reflex, Counter and Parry are the four most
    // frequently triggered abilities in the game (6.1k/4.9k/4.0k/3.8k fires over 1,800 battles).
    case 'fear': return (0.25 * (w.out ?? stat(v, 'atk')) * 2 + (v.reaction ? 16 : 0)) * (w.damp ?? 1);
    case 'def_down': return (caster ? 10 : 25) * k; case 'atk_down': return (caster ? 6 : 30) * k; case 'spd_down': return spdDownValue(v, w); case 'unarmed': return unarmedValue(v, w);
    // Curse is two denials, and neither is about the cursed unit's own output: half of every heal it receives (worth
    // nothing against a side with no healer) and BRV -20, which is one reaction in five that no longer fires.
    case 'curse': return 20 + (w.heals ? 34 : 0) + (v.reaction ? 12 : 0); default: return 10;
  }
}
// Blind halves accuracy on everything that rolls to hit — hitChance applies the 0.5 before it ever looks at the
// ability's kind, so a blinded Sorcerer misses half its spells exactly like a blinded Knight misses half its
// swings. The old flat 35/6 split had it backwards for casters. Worth half of the victim's next two turns, scaled
// by how much of its list is offence at all: blinding a Cleric is nearly free.
function blindValue(v, w) {
  const kit = v.abilityList.filter((id) => { const a = ABILITIES[id]; return a.kind === 'phys' || a.kind === 'mag'; });
  return 0.5 * (w.out ?? stat(v, 'atk')) * 2 * Math.max(0.15, kit.length / Math.max(1, v.abilityList.length)) * (w.damp ?? 1);
}
// Silence is worth the kit it closes: the share of the victim's abilities that cost MP, times what those abilities
// would have produced over two of the three turns it lasts. A silenced caster still swings a rod, which is why the
// caster branch is not the whole of `out`; a silenced Knight loses two rends and keeps everything that matters.
function silenceValue(v, w) {
  const paid = v.abilityList.filter((id) => abilityMp(v, ABILITIES[id]) > 0);
  return (w.out ?? stat(v, 'atk')) * 2 * (paid.length / Math.max(1, v.abilityList.length)) * (isCaster(v) ? 1 : 0.4) * (w.damp ?? 1);
}
// Disarm (R9: now 3 turns, data.js) takes ATK to half AND weapon power from 6 to
// 3 — about three quarters of a weapon kit's damage for the REST of the battle, which is why 40 flat had the Thief
// throwing its only real play away. Priced over a three-turn horizon against the share of the victim's list that
// swings a weapon at all, so stealing a Sorcerer's rod stays worth nothing.
function unarmedValue(v, w) {
  const kit = v.abilityList.filter((id) => ABILITIES[id].kind === 'phys');
  return 0.75 * stat(v, 'atk') * 3 * (kit.length / Math.max(1, v.abilityList.length)) * (w.damp ?? 1);
}
// Speed Rent is the one debuff a flat number gets backwards: -2 SPD costs a slow unit a third of its remaining turns
// and a fast one a fifth. Priced as the share of the next two turns it deletes times what those turns would produce
// (two, not the status's three, because the third rarely arrives before someone dies or the rent expires).
function spdDownValue(v, w) { return 2 * (2 / Math.max(2, stat(v, 'spd'))) * (w.out ?? stat(v, 'atk')) * (w.damp ?? 1); }
// A rend is worth the damage it moves, so it is priced against the fight in front of the unit rather than off a flat
// table: Armor Rent pays out once per physical ally that can reach the target, Weapon Rent once for the target's own
// swing. Without this the two are permanently 5 points apart and the greedy argmax only ever casts Weapon Rent.
function modDebuffValue(k, v, u, allies, w) {
  if (k !== 'defMod') return statusValue(MOD_NAME[k].down, v, w);
  const n = 1 + allies.filter((a) => stat(a, 'atk') >= stat(a, 'mag') && mdist(a, v) <= reachRadius(a)).length;
  return Math.min(3, n) * 12 * (w.ctrl ?? 1);
}
// A +1 ATK/MAG buff is worth the damage it will actually add: STAT_MOD_STEP of the beneficiary's own offence over the
// three turns Focus lasts, scaled by how much of that ally's kit even reads the stat. The tiers cannot tell us this —
// mag H and atk L are both 32, so a Cleric has as much "ATK" as a Sorcerer — but the ability list can.
function modBuffValue(k, v, threat) {
  if (k === 'spdMod') return 18;
  const want = k === 'magMod' ? 'mag' : 'phys';
  const kit = v.abilityList.filter((id) => ABILITIES[id].kind === 'phys' || ABILITIES[id].kind === 'mag');
  const share = kit.length ? kit.filter((id) => ABILITIES[id].kind === want).length / kit.length : 0.25;
  return stat(v, want === 'mag' ? 'mag' : 'atk') * STAT_MOD_STEP * 3 * Math.max(0.25, share) * (threat ? 0.6 : 1);
}
function buffValue(id, v, threat) {
  switch (id) {
    case 'protect': return (12 + threat * 10) * (isCaster(v) ? 0.8 : 1.1); case 'shell': return 8 + threat * 6; case 'haste': return 30 + (isCaster(v) ? 8 : 0); case 'regen': return 14;
    case 'reraise': return 25; case 'vanish': return threat ? 22 : 4; case 'float': return 4; case 'focus': return threat ? 4 : 10; case 'yell': return 18; case 'caution': case 'bulwark': return 6;
    case 'reflect': return 10 + threat * 8; case 'cover': return 0; case 'intimidate': return 0; default: return 8;
  }
}
const reachRadius = (e) => { if (e._reachTick === undefined || e._reachTick !== e.ct + ':' + e.mp) { const r = Math.max(1, ...e.abilityList.map((id) => { const ab = ABILITIES[id]; return ab.kind === 'phys' || ab.kind === 'mag' ? abilityRange(e, ab) || 1 : 0; })); e._reach = stat(e, 'move') + r; e._reachTick = e.ct + ':' + e.mp; } return e._reach; };
function threatAt(engine, u, x, z, enemies) { // enemies that could plausibly reach & hit this tile on their next turn
  let n = 0; for (const e of enemies) if (mdist(e, { x, z }) <= reachRadius(e)) n++; return n;
}
/** Foes of `u` that could plausibly reach and strike tile (x, z) on their next turn -- the AI's own exposure measure,
 *  exported for the player's Move preview (player.js) so the card and the AI agree on what "exposed" means. */
/** Threat view for the HUD: `walk` = where foe `v` can walk next turn, `strike` = the extra tiles its reach (weapon or
 *  damaging skill range, from any tile it can stand on) covers. QA r12 #18: the old hover painted `walk` alone, so a
 *  player parked one tile outside it and was struck anyway. Height is ignored, as it is in threatCount. */
export function strikeZone(engine, v) {
  const walk = engine.reach(v).tiles.concat([{ x: v.x, z: v.z }]); const map = engine.map;
  const R = Math.max(1, ...v.abilityList.map((id) => { const ab = ABILITIES[id]; return ab && (ab.kind === 'phys' || ab.kind === 'mag') && !ab.hidden ? abilityRange(v, ab) || 1 : 0; }));
  const inWalk = new Set(walk.map((t) => t.x + ',' + t.z)); const strike = [];
  for (let z = 0; z < map.d; z++) for (let x = 0; x < map.w; x++) {
    if (inWalk.has(x + ',' + z)) continue; const t = map.at(x, z); if (!t || t.void) continue;
    for (const w of walk) if (Math.abs(w.x - x) + Math.abs(w.z - z) <= R) { strike.push({ x, z }); break; }
  }
  return { walk, strike, range: R };
}
export function threatCount(engine, u, x, z) { return threatAt(engine, u, x, z, engine.enemiesOf(u).filter((e) => !e.statuses.stop && !e.statuses.sleep)); }
// Dual-target scoring (swap / ctSwap / hpSwap): the pair IS the action, so this replaces the tile
// loop wholesale instead of layering over it. Every branch is self-gating — a pair that changes
// nothing scores <= 0 and the greedy argmax never spends the MP on it.
function dualScore(engine, u, ghost, ab, tt, enemies, allies) {
  const team = engine.teamOf(u); const range = abilityRange(u, ab);
  const at = (x, z) => engine.units.find((o) => !o.ko && !o.removed && !o.airborne && o.x === x && o.z === z) || null;
  const first = at(tt.x, tt.z); if (!first) return -Infinity;
  const ok = (o) => ((ab.dualTeam === 'allies') === (engine.teamOf(o) === team));
  if (!ok(first) || first.statuses.vanish || mdist(ghost, first) > range) return -Infinity;
  const side = [u, ...allies];
  const cx = side.reduce((s, o) => s + o.x, 0) / side.length, cz = side.reduce((s, o) => s + o.z, 0) / side.length;
  const outOf = (z) => Math.max(stat(z, 'atk'), stat(z, 'mag'));
  let best = -Infinity;
  for (const o of engine.units) {
    if (o === first || o.ko || o.removed || o.airborne || o.statuses.vanish || !ok(o) || mdist(ghost, o) > range) continue;
    let v = -Infinity;
    if (ab.dual === 'swap' && ab.dualTeam !== 'allies') {
      // Trade two foes' tiles: worth the drop in weight x distance from my side's centroid, i.e. the
      // heavier foe ends up on the far tile and the softer one on the near one. Floor 2 + coefficient
      // 6 so a mild but real advantage clears the MP cost — at 3x a same-role pair never did and
      // Swap went uncalled over 150 packed battles.
      const w = (z) => outOf(z) / REF_ATK;
      v = 2 + 6 * (w(first) - w(o)) * (mdist(o, { x: cx, z: cz }) - mdist(first, { x: cx, z: cz }));
    } else if (ab.dual === 'swap') {
      // Rescue Swap: both allies trade tiles — worth exactly the threat exposure the pair sheds.
      const expo = (z, x, zz) => threatAt(engine, z, x, zz, enemies) * (1.15 - z.hp / z.maxHp);
      v = 9 * ((expo(first, first.x, first.z) + expo(o, o.x, o.z)) - (expo(first, o.x, o.z) + expo(o, first.x, first.z)));
    } else if (ab.dual === 'ctSwap') {
      // The clock should flow toward whichever of the two produces more; signed like Quick's banked
      // term, so swapping two equal-output allies is worth nothing and never gets cast.
      v = ((o.ct - first.ct) / 100) * (outOf(first) - outOf(o)) * 1.1;
    } else if (ab.dual === 'hpSwap') {
      // Redistribution on the same curve kind-'heal' scores with, minus what the donor loses, and
      // never trade a partner down to a KO ledge.
      const hs = (z, from, to) => { const frac = from / z.maxHp; return (to - from) * (0.6 + (1 - frac) * 2.2) * (frac < 0.35 ? 1.4 : 1); };
      const na = Math.min(first.maxHp, o.hp), nb = Math.min(o.maxHp, first.hp);
      v = 0;
      if (na > first.hp) v += hs(first, first.hp, na); else v -= (first.hp - na) * 0.6;
      if (nb > o.hp) v += hs(o, o.hp, nb); else v -= (o.hp - nb) * 0.6;
      if (Math.min(na / first.maxHp, nb / o.maxHp) < 0.25) v -= 120;
    }
    best = Math.max(best, v);
  }
  return best;
}
// ---------------------------------------------------------------- R7: reading the victim's answer
// What swinging at `v` costs, from the reaction v will fire at BRV%: a nullifier (Parry, Reflex, Blade Catch, Arrow
// Guard, Catch) scales the value of the blow down; a counter (Counter, Counter Tackle, Riposte, Return Fire, Counter
// Flood, Magic Counter) comes back at the ghost for the damage computeEffect says it will do, and a counter that would
// KO the attacker is priced like the attacker's own death. Frightful Presence / Malediction cost their status.
// Dead victims do not react, so an overkill blow is never discounted. Cached per (tile, victim, answer) per decision.
const NULLIFY = { parry: (ab) => ab.kind === 'phys', reflex: (ab) => ab.kind === 'phys', blade_catch: (ab) => !!ab.weaponHit };
function reactionRisk(engine, u, ghost, v, ab, eff, hc, sctx) {
  if (!v.reaction || v.charging || v.airborne || eff.dmg >= v.hp || v === u) return null;
  for (const st in v.statuses) if (STATUS[st]?.noReact) return null;
  const r = v.reaction; const brv = stat(v, 'brv') / 100; const ranged = isRanged(ghost, ab);
  const melee = ab.kind === 'phys' && !ranged && !isShaped(ab) && !((ab.area || 0) > 0);
  if (NULLIFY[r]?.(ab) || (r === 'deflect_arrows' && ab.kind === 'phys' && ranged) || (r === 'catch' && ab.kind === 'phys' && ranged && (ab.thrown || ab.item))) return { nullify: brv };
  if (ab.kind !== 'phys' && ab.kind !== 'mag') return null;
  let cab = null; const d = mdist(ghost, v);
  if (r === 'counter' && ab.kind === 'phys' && d <= abilityRange(v, ABILITIES.counter_hit)) cab = ABILITIES.counter_hit;
  else if (r === 'counter_tackle' && melee) cab = ABILITIES.tackle;
  else if (r === 'riposte' && melee) cab = ABILITIES.riposte_hit;
  else if (r === 'return_fire' && ab.kind === 'phys' && ranged && d <= abilityRange(v, ABILITIES.return_shot)) cab = ABILITIES.return_shot;
  else if (r === 'tidal_retort') cab = ABILITIES.earthsong;
  else if (r === 'magic_counter' && ab.kind === 'mag' && v.abilityList.includes(ab.id) && abilityMp(v, ab) <= v.mp) cab = ab;
  else if ((r === 'frightful_presence' || r === 'malediction') && melee) return { cost: brv * hc * (r === 'malediction' ? 0.3 * u.maxHp * (u.hp / u.maxHp) : 0.5 * stat(u, 'atk')) };
  if (!cab) return null;
  const key = ghost.x + ',' + ghost.z + '|' + v.id + '|' + cab.id; let dmg = sctx.counterCache?.get(key);
  if (dmg === undefined) { const ce = computeEffect(v, ghost, cab, engine.map); dmg = ce.absorb ? 0 : ce.dmg * (hitChance(v, ghost, cab, engine.map) / 100); sctx.counterCache?.set(key, dmg); }
  const p = brv * hc;
  return { cost: p * (Math.min(dmg, u.hp) * 1.1 + (dmg >= u.hp ? 0.7 * u.maxHp : 0)) };
}
// Objective weight: the enemy leader is worth chasing, our own leader / protected units are worth covering.
const objectiveMul = (engine, v) => { const o = engine.objective; if (!o) return 1; if (v.leader) return 1.6; if (o.protect?.includes(v.id) || (v.recordId != null && o.protect?.includes(v.recordId))) return 1.35; return 1; };
function scoreAction(engine, u, ghost, ab, tt, enemies, allies, sctx = EMPTY_CTX) {
  if (ab.dual) { const v = dualScore(engine, u, ghost, ab, tt, enemies, allies); return v === -Infinity ? v : v - abilityMp(u, ab) * 0.35; }
  const map = engine.map; const team = engine.teamOf(u); let score = 0; let touched = 0;
  const tiles = effectTiles(ghost, tt, ab, map); if (!tiles.length) return -Infinity;
  // The scorer walks a `ghost` copy of the acting unit standing on a candidate tile, but engine.units still holds
  // the real body on the tile it is about to LEAVE. Reading occupants straight off engine.units therefore prices an
  // action against a self that will not be there when the ability resolves — and for the undead, whose dark spells
  // self-absorb, that scored as a free heal. Measured over 1,800 battles before this fix: dread_touch 7,957 casts
  // at 3.5 damage each and grave_bolt 3,435 at 3.6, i.e. ~11k of the game's actions resolving onto an empty tile
  // for nothing. `bodyAt` moves the acting unit to the ghost's address and hides it from its old one.
  const bodyAt = (x, z, ko) => {
    if (!ko && ghost.x === x && ghost.z === z) return u;
    return engine.units.find((o) => o.id !== u.id && !o.removed && (ko ? o.ko : !o.ko && !o.airborne) && o.x === x && o.z === z) || null;
  };
  // A chain's extra victims are not tiles the shape covers — they are found by walking outward from whoever is
  // standing on the anchor — so they are appended here as pseudo-tiles carrying their hop number. Without this a
  // Chain Frost prices as one single-target spell and the Battlemage never has a reason to cast it.
  if (ab.chain) {
    const p = bodyAt(tiles[0].x, tiles[0].z, false);
    if (p) for (const [i, cv] of chainTargets(engine.units, ghost, ab, p).entries()) tiles.push({ x: cv.x, z: cv.z, hop: i + 1 });
  }
  const ct = abilityCT(u, ab); const cost = abilityMp(u, ab);
  // The scorer must hand computeEffect the same context the Engine will: the roster (so Pack Tactics and Duelist can
  // count bodies around the ghost's tile) and the anchor (so a falloff blast is priced per ring, not per victim).
  const ectx = { units: engine.units, anchor: tt };
  for (const t of tiles) {
    const v = bodyAt(t.x, t.z, ab.kind === 'raise');
    if (!v) continue; if (v.statuses.vanish && v !== u) continue;
    const ally = engine.teamOf(v) === team; if (ab.enemyOnly && ally) continue; if (ab.allyOnly && !ally) continue; if (ab.ground && v.statuses.float) continue;
    const hc = hitChance(ghost, v, ab, map) / 100; if (hc <= 0 && !ab.ally) continue;
    const eff = computeEffect(ghost, v, ab, map, t.hop ? { ...ectx, chainMul: Math.pow(ab.chain.falloff, t.hop) } : ectx); touched++;
    const w = victimWeights(engine, u, v, enemies, allies);
    // Position riders, priced like knockback's flat nudge: pull repositions the victim INTO the
    // follow-up (and toward my line), scatter repositions it at random — both are utility, not damage.
    if (ab.pull && !ally && v !== u) score += 5;
    if (ab.scatter && !ally && v !== u) score += 8;
    if (ab.kind === 'phys' || ab.kind === 'mag') {
      if (ally || v === u) { if (eff.absorb) score += Math.min(eff.heal, v.maxHp - v.hp) * 0.6; else score -= eff.dmg * 1.6 + (eff.dmg >= v.hp ? 120 : 0); continue; }
      if (eff.absorb) { score -= Math.min(eff.heal, v.maxHp - v.hp); continue; }
      let val = Math.min(eff.dmg, v.hp) * hc; if (eff.dmg >= v.hp) val += 0.45 * v.maxHp * hc; if (isHealer(v)) val *= 1.5; else if (isCaster(v)) val *= 1.25; if (v.charging) val *= 1.15;
      // R7 focus fire: damage into an already-wounded body is worth more (it is closer to a turn deleted), and the
      // objective leader is worth more than anyone. Deterministic, so two AI units converge on the same victim.
      // R7 tempo: a kill on a unit whose turn is close deletes that turn outright, which is worth more than the same
      // kill on a unit that just acted.
      if (sctx.smart && FL('K') && eff.dmg >= v.hp) val += 0.25 * v.maxHp * hc * (Math.min(100, v.ct) / 100);
      if (sctx.smart) { val *= objectiveMul(engine, v); if (FL('F')) val *= 1 + 0.5 * (1 - v.hp / v.maxHp);
        const rr = FL('R') && reactionRisk(engine, u, ghost, v, ab, eff, hc, sctx); if (rr) { if (rr.nullify) val *= 1 - rr.nullify; if (rr.cost) val -= rr.cost; } }
      if (eff.selfHeal) val += Math.min(eff.selfHeal, u.maxHp - u.hp) * 0.8;
      // MP torn out is tempo denied, priced by what the victim can no longer pay for rather than by the raw number:
      // a drained Knight loses nothing, a drained Conjurer loses its turn. The MP kept is worth a fraction of a turn.
      if (ab.drainMp) { const taken = Math.min(ab.drainMp, v.mp);
        const gated = v.abilityList.filter((id) => { const c = abilityMp(v, ABILITIES[id]); return c > v.mp - taken && c <= v.mp; }).length;
        val += taken * (0.25 + 0.35 * Math.min(3, gated)) * hc + Math.min(taken, u.maxMp - u.mp) * 0.3; }
      // CT knocked off a clock is the same currency Speed Rent trades in: the share of the victim's next turn that
      // is deleted, times what that turn would have produced. A target that has barely banked any CT pays nothing,
      // which is exactly when Clock Hit should lose to a plain swing.
      if (ab.ctDmg) val += (Math.min(v.ct, ab.ctDmg) / 100) * w.out * 1.5 * w.damp * hc;
      // Backlash's recoil comes out of the one unit whose position the AI has just spent a whole turn choosing, so
      // it is charged above par — and a recoil that would KO the attacker is refused outright rather than discounted.
      // Priced off eff.dmg, not off what the victim can still lose: overkill is worthless as damage but the caster
      // still bleeds for all of it, which is exactly the trap a greedy scorer walks into at low HP.
      if (ab.recoil && eff.dmg) { const r = Math.max(1, Math.floor(eff.dmg * ab.recoil)); val -= r * (r >= u.hp ? 40 : 1.4) * hc; }
      score += val;
    } else if (ab.kind === 'heal') {
      if (!ally && v !== u) { if (eff.heal) score -= eff.heal; continue; }
      const missing = v.maxHp - v.hp; const h = Math.min(eff.heal, missing); const frac = v.hp / v.maxHp;
      if (pressure(engine) > 0.4 && frac > 0.5) continue; // the line is holding: stop topping people up and go win
      // R7 triage: a patient the enemy can reach next turn is worth more than one standing safe at the back.
      const tri = sctx.smart && FL('H') ? 1 + 0.15 * Math.min(3, threatAt(engine, v, v.x, v.z, enemies)) : 1;
      score += h * (0.6 + (1 - frac) * 2.2) * (frac < 0.35 ? 1.4 : 1) * tri;
      if (eff.mp) score += Math.min(eff.mp, v.maxMp - v.mp) * 0.6;
      const cured = ab.cureAll ? Object.keys(v.statuses).filter((s) => STATUS[s]?.neg && s !== 'unarmed') : (ab.cures || ab.cure || []).filter((s) => v.statuses[s]);
      for (const s of cured) score += statusValue(s, v, w) * 0.9;
    } else if (ab.kind === 'raise') { if (ally) score += 90 + 0.6 * v.maxHp * (isHealer(v) ? 1.3 : 1); }
    else if (ab.kind === 'buff') {
      if (!ally && v !== u) { score -= 30; continue; }
      const threat = threatAt(engine, v, v.x, v.z, enemies);
      const ids = ab.statuses || (ab.status ? [typeof ab.status === 'string' ? ab.status : ab.status.id] : []);
      for (const s of ids) if (!v.statuses[s]) score += buffValue(s, v, threat);
      // Cover / Intimidate are auras: worth exactly as much as the neighbours they affect
      if (ids.includes('cover')) { const hurt = allies.filter((a) => mdist(a, v) === 1 && threatAt(engine, a, a.x, a.z, enemies) && a.hp / a.maxHp < 0.75); score += hurt.length * 26 * (v.hp / v.maxHp); }
      if (ids.includes('intimidate')) score += enemies.filter((e) => mdist(e, v) <= 2).length * 16;
      // QA r12: each stacked point is worth less than the last (1/2, 1/3 ...). At full value an A2 party buff (Rallying
      // Oath) out-scored walking toward the enemy three turns running, and the hero stood on his spawn tile re-casting it.
      if (ab.mod) for (const k in ab.mod) { const cap = k === 'spdMod' ? 2 : 3; if (v.mods[k] < cap) score += modBuffValue(k, v, threat) / (1 + Math.max(0, v.mods[k])); }
    } else if (ab.kind === 'debuff') {
      if (ally || v === u) { score -= 40; continue; }
      const ids = ab.statuses || (ab.status ? [typeof ab.status === 'string' ? ab.status : ab.status.id] : []);
      for (const s of ids) if (!v.statuses[s] && !statusImmune(v, s) && !(s === 'stop' && v.charging)) score += (statusValue(s, v, w) + setupValue(sctx, s)) * hc;
      if (ab.dispel) score += Object.keys(v.statuses).filter((s) => STATUS[s]?.pos).length * 16 * hc;
      if (ab.mod) for (const k in ab.mod) { const cap = k === 'spdMod' ? 2 : 3; if (v.mods[k] > -cap) score += modDebuffValue(k, v, u, allies, w) * hc; }
      // Rancid Breath and friends: N ailments rolled separately, worth roughly the average ailment
      if (ab.randomStatuses) { const open = Object.keys(STATUS).filter((s) => STATUS[s].neg && !STATUS[s].mod && s !== 'unarmed' && !v.statuses[s] && !statusImmune(v, s)); score += open.slice(0, ab.randomStatuses).reduce((t, s) => t + statusValue(s, v, w), 0) * ((ab.statusChance ?? 50) / 100) * hc; }
      // Hex is only worth casting at a unit mid-charge, and then it is worth what that charge was going to do to
      // everyone it lands on: doubling the wait on a Wyrm Sovereign over three of my units is a different purchase from
      // doubling the wait on a CT-1 Purify. Measured over 200 battles a Warlock has a legal Hex target on 10% of its
      // turns, so the whole ability lives or dies on this number being the real one.
      if (ab.hex) {
        if (!v.charging) score -= 100;
        else { const cab = ABILITIES[v.charging.id] || {};
          const caught = Math.min(3, effectTiles(v, v.charging.target, cab, map).filter((t) => allies.concat([u]).some((a) => a.x === t.x && a.z === t.z)).length || 1);
          score += 24 + 10 * (v.charging.left || 0) + (cab.power || 0) * 1.5 * caught; }
      }
    } else if (ab.kind === 'special') {
      // Quick spends the caster's own turn to move an ally's clock to 100, so it is worth the DIFFERENCE between what
      // the two units do with a turn — not a flat bounty. At 35 flat it made Smile the Juggler's entire game the
      // moment its MP came down: 414 casts a run for zero damage, with Ring, Ball, Firebomb and File Break all
      // starved out of the same 24 MP pool and the class's win rate unmoved. `banked` is how much of a turn the
      // gift actually is (a unit already at CT 90 is being handed almost nothing).
      if (ab.quick) {
        if (ally && v !== u) { const banked = Math.max(0, 100 - v.ct) / 100;
          score += Math.max(0, banked * 1.2 * Math.max(stat(v, 'atk'), stat(v, 'mag')) - 0.8 * Math.max(stat(u, 'atk'), stat(u, 'mag'))) + (v.charging ? 25 : 0) + (isCaster(v) ? 6 : 0);
        } else score -= 40;
      }
      if (ab.steal && !ally) score += (v.statuses.unarmed ? 0 : statusValue('unarmed', v, w)) * hc;
      if (ab.pilfer && !ally) score += Object.keys(v.statuses).filter((s) => STATUS[s]?.pos).length * 20 * hc;
    }
    // secondary statuses on damaging abilities
    if ((ab.kind === 'phys' || ab.kind === 'mag') && !ally) {
      const st = ab.status ? (typeof ab.status === 'string' ? { id: ab.status, chance: 100 } : ab.status) : null;
      if (st && !v.statuses[st.id] && !statusImmune(v, st.id)) score += (statusValue(st.id, v, w) + setupValue(sctx, st.id)) * (st.chance / 100) * hc;
      if (ab.statuses) for (const sid of ab.statuses) if (!v.statuses[sid] && !statusImmune(v, sid)) score += (statusValue(sid, v, w) + setupValue(sctx, sid)) * hc;
      if (ab.mod) for (const k in ab.mod) { const cap = k === 'spdMod' ? 2 : 3; if (v.mods[k] > -cap) score += modDebuffValue(k, v, u, allies, w) * hc; }
      if (ab.knockback) score += 4;
    }
  }
  if (!touched) return -Infinity;
  if (ct > 0) { // charged: the target may walk away
    // R7: a victim that will not get a turn before the charge lands cannot walk out of it — its clock is part of the
    // pin, exactly like Stop or Sleep. (The old test discounted every charge at a unit that could not possibly move.)
    const late = (v) => sctx.smart && FL('C') && v.ct + stat(v, 'spd') * ct < 100;
    const pinned = tiles.every((t) => { const v = engine.units.find((o) => !o.ko && o.x === t.x && o.z === t.z); return !v || v.statuses.stop || v.statuses.sleep || v.statuses.immobilize || v.charging || late(v); });
    if (!pinned) score *= Math.max(0.45, 1 - 0.09 * ct);
    if (touched > 1) score *= 1.1;
  }
  score -= cost * 0.35; if (ab.item) score -= 6;
  // HP is not MP: a Blood Pact cast at 30% HP buys the same damage for a price that may be the battle. The penalty
  // is the HP paid, scaled up by how much of the caster's pool is already gone.
  if (ab.hpCost) score -= Math.max(1, Math.floor(u.maxHp * ab.hpCost)) * (0.9 + 1.4 * (1 - u.hp / u.maxHp));
  return score;
}
// Caution decays the longer nothing has died: two careful teams must not be able to circle each other forever.
// At stallTurns 0 the AI plays its full standoff game; by stallTurns 30 it is committed to closing.
// R9 stall breaker: the stall clock alone is not enough. It resets on ANY lost HP, so a battle that trickles 3-point
// hits (a disarmed Wyrmlancer's Jump, one Poison tick) while everyone else dithers at full caution never pressures
// anybody: measured on Wend Ford, 20+ rounds of a full-HP Knight and a hurt Archer hanging back from a 29-HP bandit.
// So pressure also rises with the ROUND count: from round 9 (the top of §5.2's 8-14 band) it climbs to full by round
// 14, and past that both sides fight like the clock has stalled -- close, stop topping up, stop retreating.
const pressure = (engine) => Math.min(1, Math.max(engine.stallTurns / 30, ((engine.round || 0) - 8) / 6));
// R15 difficulty (src/ui/prefs.js DIFFICULTIES): globalThis.AI_TUNE = { B: { caution, blunder } } scales one side's
// caution (Hard presses sooner) and lets a share of its turns take a random worthwhile action (Story). Unset = shipped AI.
let TUNE = null;
const caution = (engine) => Math.max(0, 1 - pressure(engine)) * (TUNE?.caution ?? 1);
// R9 anti-dither, per unit: a unit whose last turns ended without acting is not "holding a line", it is out of the
// fight. Measured on Wend Ford: a Wyrmlancer and an Archer each spent 8+ turns stepping along the rim of the bandits'
// threat radius and back, because every tile that led somewhere was a threatened tile. After one idle turn the
// unit's caution halves, after two it is gone and the unit commits to reaching a tile it can hit from.
const idleK = (u) => Math.max(0, 1 - 0.5 * (u.idle || 0));
// ---------------------------------------------------------------- per-decision context
const EMPTY_CTX = { exploit: null, smart: false };
// R7 feature switches, kept so each can be re-measured (sim.mjs flags=...). Measured on roster=randmirror, 500
// battles each vs the round-6 AI (src/game/sim.mjs aiOld=): C charge-pin 52.1%, K tempo-kill 52.1%, D dodge queued
// charges 53.2%, T tempo stay 53.1%, CKDT 58.6%, +A facing 58.0%, +R reaction risk 59.3% (shipped). Measured and
// left OFF: F wounded-focus multiplier (56.4% with CKDTA), L lethal-exposure retreat (56.0%), H triage (50.5% alone).
const AI_DEFAULT = 'CKDTAR';
const FL = (k) => (globalThis.AI_FLAGS ?? AI_DEFAULT).includes(k);
// Which ailments this unit's side is actually carrying a follow-up for. A status record says nothing about the
// combo it enables, so without this the AI lands a Necromancer's Poison only by accident and never because the
// Zombie beside it swings Salt the Wound at x1.8 into a poisoned target. Built once per decide(), not per candidate.
function exploitMap(u, allies) {
  let m = null;
  for (const a of [u, ...allies]) for (const id of a.abilityList) {
    const e = ABILITIES[id]?.exploit; if (!e) continue;
    (m = m || new Map()).set(e.status, Math.max(m.get(e.status) || 1, e.mult));
  }
  return m;
}
const setupValue = (sctx, id) => { const m = sctx.exploit; const mult = m && m.get(id); return mult ? 18 * (mult - 1) : 0; };
// A greedy argmax over near-identical options always collapses onto whichever one the ability list happens to name
// first. Fire, Blizzard and Thunder cost the same and score the same to the last decimal against a target with no
// elemental affinity, so over 500 battles the Sorcerer cast Blizzard 472 times and Thunder not once; Fireshot,
// Boltshot and Iceshot are the same story. This is a tie-break, not noise — deterministic (no engine.rng draw, so
// seeded sims stay reproducible) and bounded well under the gap between two options the scorer can actually tell
// apart, so it can only reorder options the scorer has already called equal.
const TIE_EPS = 0.75;
function tieBreak(u, id, turn) {
  let h = 2166136261; const k = u.id + '|' + id + '|' + turn;
  for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619); }
  // FNV alone ramps linearly when only the trailing digit changes, which reorders the tied options once every ~9
  // turns instead of every turn; the murmur3 finaliser is what actually avalanches the last character.
  h ^= h >>> 16; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * TIE_EPS;
}
// ---------------------------------------------------------------- R9: walking distance, not Manhattan
// Every "close the distance" term used to be Manhattan distance. On an authored map that is a lie wherever a wall,
// a cliff taller than the unit's JUMP or a river sits between the two lines: Wendford Crossing is a maze of terraces
// and props, and the Manhattan-closest tile is routinely a dead end. Measured on the Chapter I opener (Wend Ford,
// 200 AI-vs-AI battles): a knight parked four tiles from the last bandit for 100+ turns because every step that
// actually led round the wall was a step AWAY in Manhattan terms, and the bandit sat in its pocket casting Focus on
// itself for the same reason; p90 105 turns, max 424. This is a multi-source BFS out from every enemy under the
// acting unit's own walk rules (walkable or water-walkable, height step <= JUMP; bodies ignored, since they move),
// so field(x,z) is how many steps this unit really needs to stand on that enemy's tile (1 = adjacent).
export function pathField(engine, u, enemies, R = 1) {
  const map = engine.map; const jump = stat(u, 'jump') * HEIGHT_STEP; const water = u.movement === 'terrain_walker' || !!u.statuses.float;
  const team = engine.teamOf(u); const occ = new Map();
  for (const o of engine.units) if (o !== u && !o.removed && !o.airborne) occ.set(o.x + ',' + o.z, o);
  const walkable = (t) => t && (t.walk || (water && t.water));
  // Seeds are the FREE tiles beside an enemy (distance 1): a field seeded on the enemy's own tile runs straight through
  // the ally already standing in the only doorway, and the unit behind it reads "2 steps away" forever (measured:
  // a Monk and a Dread Knight idle for 40 rounds behind their own Knight on Ravenscar Ascent). Allies can be walked
  // through (reachable() allows it), live enemies cannot. If every enemy is boxed in, seed on the bodies instead.
  const D = new Map(); const q = [];
  const seed = (x, z, d) => { const k = x + ',' + z; if (!D.has(k)) { D.set(k, d); q.push([x, z]); } };
  // R > 1 (a ranged unit): every free tile within R (Manhattan, as inRange measures it) of an enemy is a firing
  // position, so field(x,z) is the steps to the nearest place this unit can SHOOT from.
  for (const e of enemies) { if (e.airborne) continue;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) { const m = Math.abs(dx) + Math.abs(dz); if (m < 1 || m > R) continue;
      const x = e.x + dx, z = e.z + dz; const o = occ.get(x + ',' + z); if (walkable(map.at(x, z)) && !o) seed(x, z, 1); } }
  if (!q.length) for (const e of enemies) if (!e.airborne) seed(e.x, e.z, 0);
  for (let i = 0; i < q.length; i++) {
    const [x, z] = q[i]; const t0 = map.at(x, z); const d = D.get(x + ',' + z) + 1;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, t = map.at(nx, nz); const k = nx + ',' + nz; if (D.has(k) || !walkable(t)) continue;
      if (Math.abs(t.h - t0.h) > jump) continue;
      const o = occ.get(k); if (o && engine.teamOf(o) !== team) continue;   // bodies too: reachable() never walks through an enemy, fallen or not
      D.set(k, d); q.push([nx, nz]);
    }
  }
  const manhattan = (x, z) => (enemies.length ? Math.min(...enemies.map((e) => Math.abs(e.x - x) + Math.abs(e.z - z))) : 99);
  // A tile the field never reached (the unit is on an island, or teleports) falls back to Manhattan, so the term
  // still orders tiles sensibly instead of flattening to a constant.
  return (x, z) => { if (u.movement === 'teleport') return manhattan(x, z); const v = D.get(x + ',' + z); return v ?? manhattan(x, z) + 8; };
}
function scorePos(engine, u, x, z, enemies, allies, hurtAlly, lineD = 99, pctx = null) {
  const map = engine.map; const t = map.at(x, z); let s = t.h * 0.7;
  if (pctx) {
    // R7: never end a turn inside a charged spell that is about to land on this tile (the violet field), and do not
    // park where the enemies that can reach this tile next turn would kill this unit between them.
    if (FL('D')) s -= pctx.danger.get(x + ',' + z) || 0;
    let inc = 0; const reachers = []; for (const e of enemies) if (mdist(e, { x, z }) <= reachRadius(e)) reachers.push(pctx.est.get(e.id) || 0);
    reachers.sort((a, b) => b - a); inc = (reachers[0] || 0) + (reachers[1] || 0);
    if (!FL('L')) inc = 0; else if (inc >= u.hp) s -= (14 + 10 * (1 - u.hp / u.maxHp)) * caution(engine) * idleK(u); else s -= (inc / Math.max(1, u.hp)) * 6 * caution(engine) * idleK(u);
  } const caster = isCaster(u) || isSkirmisher(u); const healer = isHealer(u);
  const threat = threatAt(engine, u, x, z, enemies); const hpFrac = u.hp / u.maxHp; const k = caution(engine) * idleK(u);
  const nearestE = enemies.length ? Math.min(...enemies.map((e) => mdist(e, { x, z }))) : 99;
  if (caster || healer) s -= k * (threat * (10 + (1 - hpFrac) * 14) + (nearestE <= 1 ? 12 : 0));
  else s -= k * threat * (2 + (1 - hpFrac) * 10);
  s -= (pctx?.walk ? pctx.walk(x, z) : nearestE) * 2 * (1 - k); // once the clock is stalling, closing the (walking) distance is itself worth points
  if (hpFrac < 0.35 && pressure(engine) < 0.4 && allies.some((a) => isHealer(a) || a.items?.potion || a.items?.greater_potion)) s += Math.min(nearestE, 6) * 4; // retreat when hurt, if someone can patch you up
  if (caster) s -= Math.max(0, 3 - nearestE) * 7 * k; // keep a firing lane open while there is still a fight to shape
  if (!caster && !healer) { // bodyguard: stand next to threatened casters, between them and the enemy
    for (const a of allies) if ((isCaster(a) || isHealer(a)) && mdist(a, { x, z }) === 1) { const th = threatAt(engine, a, a.x, a.z, enemies); if (th) s += 6; const e = enemies.sort((p, q) => mdist(p, a) - mdist(q, a))[0]; if (e && mdist(e, { x, z }) < mdist(e, a)) s += 4; }
  }
  // Arriving alone is how the fast melee classes die. Thief (MOVE 7), Ash Hound and Juggler all reach the enemy
  // line one or two turns ahead of the bodies that were meant to be beside them and are answered 1-v-5: measured
  // over 1,800 battles the Thief survives 7% of its games and the Hound 9%, against a roster median of 34%. A tile
  // closer to contact than the unit's own side's median is charged for, and caution() zeroes the charge as the
  // clock stalls so this can never be a reason for two lines to sit still. The taper is k SQUARED, not k: holding
  // the line only means anything while there IS a line advancing. Measured A/B at 12 seeds x 150 random-roster
  // battles, k^2 against k is 4.1% stalemates against 4.3% with every class's win rate unmoved — inside the
  // run-to-run spread (per-seed sd 1.5) either way, so this is chosen on the argument, not on the number.
  if (!caster && !healer) { const ahead = lineD - nearestE; if (ahead > 1) s -= (ahead - 1) * 6 * k * k; }
  if (healer && hurtAlly) s -= Math.max(0, mdist(hurtAlly, { x, z }) - 4) * 3;
  // R18 (review17 P2): do not clump. Every unit, not only casters, pays for each ally it would end its turn beside
  // (orthogonal) and a little for a diagonal one, more when the other side carries an area ability (Fire, Mending Light-shaped
  // knells, breath lines...): five bodies on 2x3 tiles was both an AoE gift and an unreadable blob on screen. Small
  // next to the bodyguard pull above (+6/+4), so a Knight still stands at a threatened mage's shoulder.
  { const o = pctx?.aoe ? 3.5 : 2; for (const a of allies) { const dx = Math.abs(a.x - x), dz = Math.abs(a.z - z); if (dx + dz === 1) s -= caster ? o + 1 : o; else if (dx === 1 && dz === 1) s -= 0.75; } }
  return s;
}
export function decide(u, engine) {
  TUNE = globalThis.AI_TUNE?.[u.team] || null;
  try { return decide0(u, engine); } finally { TUNE = null; }
}
function decide0(u, engine) {
  const map = engine.map; const enemies = engine.enemiesOf(u), allies = engine.alliesOf(u);
  const reach = engine.canMove(u) ? engine.reach(u) : { tiles: [], path: () => null };
  const here = { x: u.x, z: u.z, d: 0 }; const cands = [here, ...reach.tiles];
  const hurtAlly = allies.filter((a) => a.hp < a.maxHp * 0.6).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0] || null;
  // Where this unit's own side stands relative to contact, as a median over the live bodies on it (median, not
  // mean, so one already-committed skirmisher cannot drag the whole line forward).
  const dToE = (o) => (enemies.length ? Math.min(...enemies.map((e) => mdist(e, o))) : 99);
  const own = [u, ...allies].map(dToE).sort((a, b) => a - b); const lineD = own[Math.floor(own.length / 2)];
  const pctx = positionCtx(engine, u, enemies);
  const fireR = isCaster(u) || isSkirmisher(u) ? Math.max(1, ...u.abilityList.map((id) => { const ab = ABILITIES[id]; return (ab.kind === 'phys' || ab.kind === 'mag') && canUse(u, id).ok ? abilityRange(u, ab) || 0 : 0; })) : 1;
  pctx.walk = pathField(engine, u, enemies, fireR);   // steps to the nearest tile this unit can hit something from
  // R19 'human-like' proxy (campaignsim human=): posNoise blurs the position read (height, exposure, spacing are
  // judged by eye, not computed) with one fixed error per tile per decision, so the unit still commits to a tile.
  const posNoise = TUNE?.posNoise || 0;
  const posCache = new Map(); const pos = (x, z) => { const k = x + ',' + z; if (!posCache.has(k)) posCache.set(k, scorePos(engine, u, x, z, enemies, allies, hurtAlly, lineD, pctx) + (posNoise ? posNoise * (engine.rng() * 2 - 1) : 0)); return posCache.get(k); };
  const abilities = engine.canAct(u) ? u.abilityList.filter((id) => canUse(u, id).ok && !ABILITIES[id].hidden) : [];
  const sctx = { exploit: exploitMap(u, allies), smart: true, counterCache: new Map() };
  const tb = new Map();   // the tie-break separates abilities, not placements, so it is fixed for the whole decision: only tiles whose effect area touches a unit
  const interesting = engine.units.filter((o) => !o.removed && !o.airborne);
  const hotFor = new Map(); for (const id of abilities) { const a = ABILITIES[id].area || 0; if (!hotFor.has(a)) { const hot = new Set(); for (const o of interesting) for (const t of areaTiles(o.x, o.z, { area: a }, map)) hot.add(t.x + ',' + t.z); hotFor.set(a, hot); } }
  let best = { score: -Infinity, order: 'move-act', tile: here, ab: null, target: null };
  const blunder = TUNE?.blunder || 0; let alt = null, seen = 0;
  // R19 human-like proxy: `noise` misjudges each option's worth by up to +-noise of itself (no perfect focus fire, the
  // second-best target is often taken), `actMove` is how often a player thinks of acting BEFORE moving at all.
  const noise = TUNE?.noise || 0; const actMove = TUNE?.actMove ?? 1; const canActMove = actMove >= 1 || engine.rng() < actMove;
  // R7 tempo (§2.1): a turn that acts without moving restarts at CT 20 instead of 0, i.e. a fifth of a turn sooner.
  // Priced at a fifth of what a turn of this unit's offence is worth, so a pointless step is no longer free. Only on
  // turns that act: offered to the approach branch too it measured +3 rounds a battle of units declining to advance.
  const tempo = FL('T') ? 0.2 * 0.8 * Math.max(stat(u, 'atk'), stat(u, 'mag')) : 0;
  const bestPosTile = () => { let b = here, bs = -Infinity; for (const t of cands) { const s = pos(t.x, t.z); if (s > bs) { bs = s; b = t; } } return { tile: b, score: bs }; };
  for (const tile of cands) {
    const ghost = { ...u, x: tile.x, z: tile.z }; const p = pos(tile.x, tile.z); const atHome = tile === here;
    for (const id of abilities) {
      const ab = ABILITIES[id]; const tts = targetTiles(ghost, map, ab); const hot = hotFor.get(ab.area || 0);
      if (!tb.has(id)) tb.set(id, tieBreak(u, id, engine.turn));
      const e = tb.get(id);
      for (const tt of tts) {
        // A shaped footprint reaches past its anchor, so the anchor itself need not hold a body; and `hot` is built
        // from where the bodies are NOW, which does not include the tile this ghost is standing on, so a self-aimed
        // heal or absorb from a tile the unit is moving to has to be let through explicitly.
        if (!isShaped(ab) && !hot.has(tt.x + ',' + tt.z) && Math.abs(tt.x - tile.x) + Math.abs(tt.z - tile.z) > (ab.area || 0)) continue;
        let sa = scoreAction(engine, u, ghost, ab, tt, enemies, allies, sctx); if (sa === -Infinity || sa <= 0) continue;
        if (noise) sa *= 1 + noise * (engine.rng() * 2 - 1);
        if (blunder) { seen++; if (engine.rng() * seen < 1) alt = { order: 'move-act', tile, ab: id, target: tt }; }
        // move → act
        const s1 = sa + p + e + (atHome ? tempo : 0); if (s1 > best.score) best = { score: s1, order: 'move-act', tile, ab: id, target: tt };
        // act → move (act from the current tile, then reposition)
        if (atHome && reach.tiles.length && canActMove) { const bp = bestPosTile(); const s2 = sa + bp.score + 1.5 + e; if (s2 > best.score) best = { score: s2, order: 'act-move', tile: bp.tile, ab: id, target: tt }; }
      }
    }
  }
  if (alt && engine.rng() < blunder) best = { score: 0, ...alt };
  // R19 human-like proxy: `facing` is the share of turns that end facing wherever the walk left the unit.
  const face = (tile) => (TUNE?.facing && engine.rng() < TUNE.facing ? null : bestFacing(engine, u, tile, enemies, pctx));
  if (best.ab) { best.facing = face(best.tile); return best; }
  // nothing worth doing: approach (melee) or hold a firing position (ranged/caster), keeping height
  const e = enemies.sort((a, b) => mdist(a, u) - mdist(b, u))[0]; if (!e) return { order: 'move-act', tile: here, ab: null, target: null };
  // R9: close on WALKING distance to the nearest tile this unit can hit from (pathField, seeded at the unit's own
  // range), never on Manhattan distance to the enemy: on an authored map the Manhattan-closest tile is routinely a dead
  // end (an Archer sat six rounds in a river pocket on Wend Ford, 3 tiles "from" nobody it could shoot). A ranged unit
  // still prefers to arrive at its standoff distance rather than adjacent, while there is a fight to shape.
  const ranged = isCaster(u) || isRanged(u, ABILITIES.attack) || u.abilityList.some((id) => (ABILITIES[id].range || 0) >= 3);
  const want = ranged && pressure(engine) < 0.67 ? 3 : 1; let bt = here, bs = -Infinity; const walk = pctx.walk;
  for (const t of cands) {
    const w = walk(t.x, t.z);
    const s = -(w - 1) * 4.6 - (want > 1 ? Math.abs(mdist(t, e) - want) * 1.5 : 0) + pos(t.x, t.z) * (pressure(engine) >= 0.67 || (u.idle || 0) >= 2 ? 0.25 : 1);
    if (s > bs) { bs = s; bt = t; } }
  return { order: 'move-act', tile: bt, ab: null, target: null, facing: face(bt) };
}

// ---------------------------------------------------------------- R7 positional context
// est: a rough per-enemy damage figure against THIS unit (its basic swing, or its MAG-driven spell if it is a caster),
// used to price lethal exposure. danger: tiles covered by a pending charged ability that would hurt this unit when it
// lands — an enemy's spell, or a friendly AoE that does not spare allies — priced at the damage it would do.
function positionCtx(engine, u, enemies) {
  const est = new Map(); const map = engine.map;
  for (const e of enemies) {
    let d = computeEffect(e, u, ABILITIES.attack, map).dmg;
    if (isCaster(e)) d = Math.max(d, Math.floor(stat(e, 'mag') * 14 / 6) - stat(u, 'res'));
    est.set(e.id, Math.max(1, d));
  }
  const danger = new Map(); const team = engine.teamOf(u);
  for (const c of engine.units) {
    if (!c.charging || c.ko || c.removed || c === u) continue; const ab = ABILITIES[c.charging.id]; if (!ab) continue;
    const foe = engine.teamOf(c) !== team; if (!(ab.kind === 'phys' || ab.kind === 'mag' || ab.kind === 'debuff')) continue;
    if (!foe && (ab.enemyOnly || ab.kind === 'debuff')) continue; if (foe && ab.allyOnly) continue;
    const dmg = ab.kind === 'debuff' ? 18 : Math.max(8, computeEffect(c, u, ab, map).dmg);
    for (const t of effectTiles(c, c.charging.target, ab, map)) { const k = t.x + ',' + t.z; danger.set(k, (danger.get(k) || 0) + dmg * (dmg >= u.hp ? 1.6 : 1)); }
  }
  // R18: does the other side carry anything that punishes a clump (an area or shaped footprint)?
  const aoe = enemies.some((e) => e.abilityList.some((id) => { const a = ABILITIES[id]; return a && (a.kind === 'phys' || a.kind === 'mag' || a.kind === 'debuff') && ((a.area || 0) >= 1 || isShaped(a)); }));
  return { est, danger, aoe };
}
// End-of-turn facing: turn the front toward where the damage will come from. Each enemy that can reach the tile next
// turn pushes by its estimated damage; a back exposure costs twice a side one (EVA is 0 from behind, halved from the side).
function bestFacing(engine, u, tile, enemies, pctx) {
  if (!tile || !enemies.length || !FL('A')) return null; let best = null, bs = Infinity;
  for (let f = 0; f < 4; f++) {
    let expo = 0;
    for (const e of enemies) { const d = mdist(e, tile); const w = (pctx?.est.get(e.id) || 10) / Math.max(1, d - reachRadius(e) + 2);
      const to = facingFrom(tile.x, tile.z, e.x, e.z); if (to == null) continue; const diff = (to - f + 4) % 4; expo += w * (diff === 0 ? 0 : diff === 2 ? 2 : 1); }
    if (expo < bs) { bs = expo; best = f; }
  }
  return best;
}
