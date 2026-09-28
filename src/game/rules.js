// Pure rules (DESIGN.md §2): stats, damage, hit chance, movement search, the CT clock, statuses, reactions, supports,
// movement abilities and ability resolution. No DOM, no three.js — src/game/sim.mjs runs this headlessly in node.
// The Engine mutates unit state and returns plain event lists; src/game/battle.js replays those events as animation.
import { CLASSES, ABILITIES, STATUS, REACTIONS, SUPPORTS, MOVEMENTS, MOD_STATUS, EARTHSONG, WP, STAT_MOD_STEP, LEVEL, PACKED_CLASSES, EQUIP_SUPPORTS } from './data.js';
import { gearSummary, carryOf, WEAPON_TYPES } from './equipment.js';
export { CLASSES, ABILITIES, STATUS, REACTIONS, SUPPORTS, MOVEMENTS, EARTHSONG, WP, PACKED_CLASSES };

export const MOD_CAP = { atkMod: 3, magMod: 3, defMod: 3, spdMod: 2 };
export const KO_TURNS = 3;            // crystal countdown: KO'd unit is removed after 3 of its own turns
export const MP_START = 0.5, MP_REGEN = 0.1;
export const COUNTER_REACTIONS = new Set(['counter', 'counter_tackle', 'tidal_retort', 'riposte', 'return_fire', 'magic_counter', 'bestial_instinct']);
export const HEIGHT_STEP = 2;         // 2h = one tile of height (JUMP 1); attacker ≥ 2h above target → +10% damage

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const other = (team) => (team === 'A' ? 'B' : 'A');
// Charm flips a unit's side for exactly its own turn. Engine.teamOf is the authority; this is the same rule in a
// free function so the pure half of the file (computeEffect's ally/foe counts, chainTargets) can ask without an Engine.
const sideOf = (u) => (u.charmedTurn ? other(u.team) : u.team);
const mdist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);

// ---------------------------------------------------------------- units & stats
// Level growth (DESIGN §5.2, recalibrated). The class table is authored at LEVEL 10, so growth(10) is exactly 1 and an
// un-levelled unit is bit-identical to the tuned roster. §5.2's literal +0.75%/level made three levels worth 2% —
// level would have meant nothing in a campaign — so the slope is set where the headless sim measures a +3-level
// party winning ~3 battles in 4 (src/game/sim.mjs lvlA=13 lvlB=10). DEF/RES grow slower than the offence that
// subtracts them, so a veteran's hits land harder rather than both sides' soak cancelling out. SPD moves 1 per 4 levels (-2..+4).
export const GROWTH = { hp: 0.05, mp: 0.03, atk: 0.05, mag: 0.05, def: 0.02, res: 0.02 };
export const MAX_LEVEL = 99;
export function growth(lvl, k) { return Math.max(0.35, 1 + (GROWTH[k] || 0) * ((lvl ?? LEVEL) - LEVEL)); }
export function levelStats(cls, lvl = LEVEL) {
  const c = CLASSES[cls]; const out = {};
  for (const k of ['hp', 'mp', 'atk', 'def', 'mag', 'res']) out[k] = Math.max(1, Math.round(c[k] * growth(lvl, k)));
  out.spd = Math.max(1, c.spd + Math.max(-2, Math.min(4, Math.round((lvl - LEVEL) / 4)))); out.eva = c.eva;
  return out;
}
// Ability list for a unit: 'attack' first, then the primary set, then the secondary set, no repeats, unknown ids dropped.
// opts.abilities replaces the whole list; opts.learned narrows the primary set to what the unit has bought;
// opts.secondaryList appends the secondary job's learned set (progression.js builds both).
function buildAbilityList(c, opts) {
  const seen = new Set(); const out = [];
  const add = (id) => { if (ABILITIES[id] && !ABILITIES[id].hidden && !seen.has(id)) { seen.add(id); out.push(id); } };
  add('attack');
  if (opts.abilities) { for (const id of opts.abilities) add(id); return out; }
  for (const id of (opts.learned || c.abilities)) add(id);
  for (const id of (opts.secondaryList || [])) add(id);
  return out;
}
export function makeUnit(id, team, cls, x, z, name, opts = {}) {
  const c = CLASSES[cls]; if (!c) throw new Error('unknown class ' + cls);
  const rng = opts.rng || Math.random;
  const lvl = Math.max(1, Math.min(MAX_LEVEL, Math.round(opts.lvl ?? opts.level ?? LEVEL)));
  const base = levelStats(cls, lvl);
  // `in` rather than `??`: a progression record may equip NOTHING in a slot, which must not fall back to the class default.
  const pick = (k) => (k in opts ? (opts[k] || null) : c[k]);
  const support = pick('support');
  // Equipment (src/game/equipment.js). Absent opts.equip = the legacy unit (u.eq null): class weapon at WP 6, implicit shield.
  const eq = opts.equip ? gearSummary(opts.equip) : null;
  const mp0 = base.mp + (eq?.mp || 0);
  const maxMp = support === 'arcane_reservoir' ? Math.round(mp0 * 1.3) : mp0;
  // Boss overrides (campaign data -> progression.enemyOpts): a bigger body is authored as a multiplier on the levelled HP.
  const hp0 = Math.max(1, Math.round((base.hp + (eq?.hp || 0)) * (opts.hpMul || 1)));
  const abilityList = buildAbilityList(c, opts);
  // Items are a Apothecary's stock. Any unit carrying an item ability (a Apothecary, or anyone with Items as the secondary
  // set) is issued the Apothecary's stock for exactly those items; opts.items overrides.
  let items = opts.items ? { ...opts.items } : c.items ? { ...c.items } : null;
  if (!opts.items) for (const aid of abilityList) if (ABILITIES[aid].item) { items = items || {}; if (items[aid] == null) items[aid] = CLASSES.apothecary.items[aid] ?? 1; }
  const u = { id, team, cls, name: name || c.name, x, z, facing: team === 'A' ? 2 : 0, hp: hp0, maxHp: hp0, mp: Math.floor(maxMp * MP_START), maxMp,
    // the genre rolls initial CT, so the opening turns start immediately instead of after a dead run of ticks
    ct: Math.floor(rng() * 100), statuses: {}, mods: { atkMod: 0, magMod: 0, defMod: 0, spdMod: 0 }, ko: false, koTurns: 0, removed: false, charging: null, airborne: false,
    lvl, base, brv: Math.max(10, Math.min(97, opts.brv ?? c.brv)), moved: false, acted: false, movementUsed: false, charmedTurn: false, grants: [],
    spriteName: opts.sprite || c.sprite, height: c.height && opts.scale ? +(c.height * opts.scale).toFixed(2) : c.height, abilityList, reaction: pick('reaction'), support, movement: pick('movement'),
    secondary: opts.secondary || null, secondaryList: (opts.secondaryList || []).filter((a) => abilityList.includes(a)),
    recordId: opts.recordId ?? null, leader: false, idle: 0,   // idle: own turns in a row that ended without acting (ai.js commits after 2)
    weight: (EQUIP_SUPPORTS.has(support) ? 1 : 0) + (c.weight || 0) + (eq ? Math.max(0, eq.weight - carryOf(cls)) : 0), learned: [],  // §5.1.10 equip-permission supports carry their item's Weight; gear over the carry limit adds its own (§2.1)
    items, eq, equip: opts.equip ? { ...opts.equip } : null, boss: !!opts.boss };
  // Auto-statuses from gear (Saint's Charm = Reraise, Verdant Pendant = Regen, ...) are on from the first tick; 99 = never counts down.
  if (eq) for (const s of eq.auto) if (STATUS[s]) u.statuses[s] = 99;
  return u;
}
export function stat(u, k) {
  const c = u.base || CLASSES[u.cls]; const st = u.statuses, m = u.mods; const mv = MOVEMENTS[u.movement] || {}; const g = u.eq;
  switch (k) {
    case 'atk': { let v = (c.atk + (g?.atk || 0)) * (1 + m.atkMod * STAT_MOD_STEP); if (st.fear) v *= 0.75; if (st.unarmed) v *= 0.5; if (u.support === 'natures_blessing') v *= 1.08; return Math.max(1, Math.round(v)); }
    case 'mag': { let v = (c.mag + (g?.mag || 0)) * (1 + m.magMod * STAT_MOD_STEP); if (st.fear) v *= 0.75; if (u.support === 'arcane_focus') v *= 1.25; if (u.support === 'natures_blessing') v *= 1.08; return Math.max(1, Math.round(v)); }
    case 'def': { let v = (c.def + (g?.def || 0)) * (1 + m.defMod * STAT_MOD_STEP); if (st.protect) v *= 1.33; if (st.caution) v *= 1.33; if (u.support === 'defense_boost' || u.support === 'fortify') v *= 1.2; if (!g && (u.support === 'equip_shields' || CLASSES[u.cls].shield)) v += 2; return Math.round(v); }
    case 'res': { let v = c.res + (g?.res || 0); if (st.shell) v *= 1.33; return Math.round(v); }
    case 'spd': { let v = c.spd + (g?.spd || 0); if (st.haste) v *= 1.5; if (st.slow) v *= 0.5; v = Math.round(v) + m.spdMod; return clamp(v, 1, 20); }
    case 'move': { if (st.immobilize) return 0; return Math.max(0, CLASSES[u.cls].move + (mv.move || 0) + (u.moveBonus || 0) + (g?.move || 0)); }
    case 'jump': return CLASSES[u.cls].jump + (mv.jump || 0) + (st.float ? 1 : 0) + (g?.jump || 0);
    case 'eva': { if (st.sleep || st.stop) return 0; return c.eva + (u.support === 'nimble' ? 10 : 0) + (g ? g.eva : (u.support === 'equip_shields' || CLASSES[u.cls].shield ? 5 : 0)); }
    case 'brv': return clamp(u.brv - (st.curse ? 20 : 0), 0, 100);
    default: return c[k] ?? CLASSES[u.cls][k];
  }
}
// Natural weapons (fists, claws, fangs) are the body: an equipped unit of such a class with an empty hand still hits at WP 6.
const NATURAL = new Set(['fists', 'claw', 'fang']);
export function weaponPower(u) {
  if (u.statuses.unarmed) return 3;
  const g = u.eq;
  if (g) {
    const w = g.weapon;
    if (!w) { if (u.support === 'martial_arts') return 4 + Math.floor(stat(u, 'atk') / 16); if (!NATURAL.has(CLASSES[u.cls].weapon.type)) return 3; }
    const wp = w ? w.wp : WP;
    return u.support === 'doublehand' && !g.offhand ? Math.round(wp * 1.5) : wp;   // Doublehand: a free off hand on the grip
  }
  if (u.support === 'martial_arts') return 4 + Math.floor(stat(u, 'atk') / 16);
  if (u.support === 'doublehand') return Math.round(WP * 1.5);
  return WP;
}
/** The weapon a unit swings: {type, range, ranged}. Equipped units read their weapon slot (empty = a range-1 fist). */
export function weaponOf(u) {
  const g = u.eq; if (!g) return CLASSES[u.cls].weapon;
  if (!g.weapon) return NATURAL.has(CLASSES[u.cls].weapon.type) ? CLASSES[u.cls].weapon : { type: 'fists', range: 1 };
  const t = WEAPON_TYPES[g.weapon.type] || { range: 1 }; return { type: g.weapon.type, range: t.range + (g.range || 0), ranged: !!t.ranged };
}
export function weaponRange(u) { const w = weaponOf(u); if (u.statuses.unarmed) return 1; return w.range + (u.support === 'eye_for_distance' && w.type === 'gun' ? 1 : 0); }
/** Status immunity from the class (undead: Poison) or from gear (Warding Ribbon). */
export function statusImmune(v, id) { return CLASSES[v.cls].immune.includes(id) || !!v.eq?.immune.includes(id); }
// Tracker (§3 Hunter) adds its tile to the RESOLVED range, so it follows a weapon ability onto whatever the unit
// carries — but never to a range-1 ability, which would silently turn every melee kit into a reach kit.
export function abilityRange(u, ab) {
  const t = u.support === 'tracker' ? 1 : 0;
  if (ab.range === 'w') { const r = weaponRange(u); return r + (r > 1 ? t : 0); }
  if (ab.item && u.support === 'throw_item') return 4;
  return ab.range + (ab.range > 1 ? t : 0);
}
export function isRanged(u, ab) { return !!(ab.ranged || (ab.range === 'w' && weaponOf(u).ranged)); }
export function abilityCT(u, ab) { const ct = ab.ct || 0; return u.support === 'short_charge' ? Math.ceil(ct / 2) : ct; }
export function abilityMp(u, ab) { const mp = ab.mp || 0; return u.support === 'half_mp' ? Math.ceil(mp / 2) : mp; }
export function canUse(u, id) {
  const ab = ABILITIES[id]; if (!ab) return { ok: false, why: 'unknown' };
  if (abilityMp(u, ab) > u.mp) return { ok: false, why: 'MP' };
  if (u.statuses.silence && (ab.mp || 0) > 0) return { ok: false, why: 'Silence' };
  if (ab.item && (!u.items || !(u.items[id] > 0))) return { ok: false, why: 'none left' };
  // Blood Pact pays in HP. The gate is strict (`<=`), so the price can never be the caster's last point: paying it
  // must never be a way to KO yourself, which would hand the other side a free crystal.
  if (ab.hpCost && u.hp <= Math.floor(u.maxHp * ab.hpCost)) return { ok: false, why: 'HP' };
  return { ok: true };
}
export function facingFrom(ax, az, bx, bz) { const dx = bx - ax, dz = bz - az; if (dx === 0 && dz === 0) return null; if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 1 : 3; return dz >= 0 ? 0 : 2; }
export function relativeSide(att, tgt) { // 'front' | 'side' | 'back' from the target's perspective
  const toAtt = facingFrom(tgt.x, tgt.z, att.x, att.z); if (toAtt == null) return 'front';
  const diff = (toAtt - tgt.facing + 4) % 4; return diff === 0 ? 'front' : diff === 2 ? 'back' : 'side';
}
export function elementMul(v, element) {
  if (!element) return 1; const c = CLASSES[v.cls]; const g = v.eq;
  if (c.absorb.includes(element) || g?.absorb.includes(element)) return -1; if (c.immune.includes(element) || (element === 'earth' && v.statuses.float)) return 0;
  const gr = !!g?.resist.includes(element);
  if (c.weak.includes(element)) return gr ? 1 : 1.5; if (c.resist.includes(element) || gr) return 0.5; return 1;
}
export function geomancyFor(u, map) { const t = map.at(u.x, u.z); return EARTHSONG[t?.t] || EARTHSONG.g; }
export function isPhysical(ab) { return ab.kind === 'phys'; }
export function heightAdv(att, tgt, map) { return map.at(att.x, att.z).h - map.at(tgt.x, tgt.z).h; }

// ---------------------------------------------------------------- hit chance & effect
export function hitChance(att, tgt, ab, map) {
  const friendly = ab.kind === 'heal' || ab.kind === 'buff' || ab.kind === 'raise' || (ab.kind === 'special' && ab.quick) || ab.self;
  if (friendly) return 100;
  if (tgt.statuses.sleep) return 100;
  let acc = ab.acc ?? 100;
  if (isPhysical(ab) && !ab.ignoreEva && att.support !== 'concentrate') {
    const eva = stat(tgt, 'eva'); const side = relativeSide(att, tgt);
    acc -= side === 'front' ? eva : side === 'side' ? eva / 2 : 0;
  }
  if (att.support === 'trickster' && (ab.kind === 'debuff' || ab.status || ab.statuses || ab.randomStatuses)) acc += 20;
  if (att.statuses.blind) acc *= 0.5;
  return clamp(Math.round(acc), 0, 100);
}
export function computeEffect(att, tgt, ab, map, ctx = {}) {
  const res = { dmg: 0, heal: 0, mp: 0, raise: false, absorb: false, elemMul: 1, side: relativeSide(att, tgt), height: 0, hits: 1 };
  const dh = heightAdv(att, tgt, map); res.height = dh;
  const heightMul = dh >= HEIGHT_STEP ? 1.1 : 1;
  let element = ab.element; if (ab.earthsong) element = geomancyFor(att, map).element;
  // An elemental weapon (Flame Rod, Emberbrand) lends its element to the plain Attack; gear that strengthens an element adds 25%.
  if (!element && ab.id === 'attack' && att.eq?.element && !att.statuses.unarmed) element = att.eq.element;
  const boost = element && att.eq?.strengthen.includes(element) ? 1.25 : 1;
  const cap = (d) => Math.min(d, Math.floor(tgt.maxHp * ((ab.ct || 0) >= 4 ? 1.5 : 1.0)));
  const finish = (d) => {
    if (boost !== 1) d = Math.floor(d * boost);
    let mul = elementMul(tgt, element); res.elemMul = mul;
    if (mul < 0) { res.absorb = true; res.heal = Math.floor(d); return; }
    d = Math.floor(d * mul); if (tgt.charging) d = Math.floor(d * 1.25);
    if (d > 0 && mul > 0) d = Math.max(1, d);
    res.dmg = cap(d);
  };
  // Per-victim scaling decided OUTSIDE the damage formula: a chain's falloff per hop (ctx.chainMul, set by
  // Engine.resolve) and a blast's edge falloff (measured from the anchor tile ctx.anchor). Both default to 1, so an
  // ability that carries neither key — every ability that shipped before this tranche — takes the identical path.
  const spread = (ctx.chainMul || 1) * (ab.falloff && ctx.anchor && mdist(tgt, ctx.anchor) > 0 ? ab.falloff : 1);
  const scale = (d) => (spread === 1 ? d : Math.max(1, Math.floor(d * spread)));
  if (ab.kind === 'phys') {
    let mult = ab.mult || 1; if (ab.dragonMult && CLASSES[tgt.cls].dragon) mult = ab.dragonMult;
    // Conditional multipliers. Each reads only att/tgt (or ctx.units for the two that count neighbours), so ai.js
    // scores them for free: it ranks candidates by calling computeEffect itself and therefore already knows an
    // Opening Gambit is worth 1.8x into an untouched enemy. They multiply, which is how the prototype stacks them too.
    if (ab.opener && tgt.hp >= tgt.maxHp) mult *= ab.opener;
    if (ab.exploit && tgt.statuses[ab.exploit.status]) mult *= ab.exploit.mult;
    if (ab.execute && tgt.hp <= tgt.maxHp * ab.execute.threshold) mult *= ab.execute.mult;
    if (ab.blood && att.hp * 2 < att.maxHp) mult *= ab.blood;
    // Pack Tactics / Duelist read the crowd around the two units, which the damage formula otherwise never sees.
    // Without ctx.units they are inert rather than wrong: a forecast that cannot count bodies quotes the floor.
    if ((ab.allyBonus || ab.duelist) && ctx.units) {
      // Compared by id, not identity: ai.js scores from a `ghost` copy of the attacker standing on a candidate
      // tile, and an identity test would count the real unit still sitting on its old tile as a second body.
      const near = (o, same) => ctx.units.filter((p) => p.id !== o.id && !p.ko && !p.removed && !p.airborne && (sideOf(p) === sideOf(o)) === same && mdist(p, o) === 1).length;
      if (ab.allyBonus) mult *= 1 + Math.min(ab.allyBonus.cap, ab.allyBonus.per * near(att, true));
      if (ab.duelist && near(att, false) <= 1 && near(tgt, false) <= 1) mult *= ab.duelist;   // a clean 1v1: neither fighter has a second opponent on them
    }
    if (att.support === 'assassinate' && res.side === 'back') mult *= 1.5;
    // `pierce` removes soak before it is subtracted, never after: a piercing hit on a soft target is a normal hit,
    // not a bonus, so it floors at 0 DEF rather than turning leftover pierce into damage. `trueDamage` removes all
    // of it, which also removes Protect/Shell — those live inside stat('def')/stat('res'), not beside them.
    const wp = ab.wp ?? weaponPower(att); const atk = stat(att, 'atk'), def = ab.trueDamage ? 0 : Math.max(0, stat(tgt, 'def') - (ab.pierce?.def || 0));
    let d = ab.fixedDmg ? Math.floor(ab.fixedDmg * heightMul) - def : Math.floor(atk * wp / 6 * mult * heightMul) - def;
    if (ab.bonusPower) d += Math.max(1, Math.floor(stat(att, 'mag') * ab.bonusPower / 6) - stat(tgt, 'res'));
    d = Math.max(1, d);
    // Multi-hit soaks DEF once per swing, so Tri Strike is three small hits and not one x1.8 hit. That is the whole
    // trade: it beats one big swing against soft targets and loses badly to armour.
    if (ab.hits > 1) { res.hits = ab.hits; d *= ab.hits; }
    // Dual Wield: the legacy unit swings its one weapon twice; an equipped unit needs a real second weapon in the off hand.
    const off = att.eq ? (att.eq.offhand?.slot === 'weapon' ? att.eq.offhand.wp : 0) : wp;
    if (ab.id === 'attack' && att.support === 'dual_wield' && !att.statuses.unarmed && off) { const d2 = Math.max(1, Math.floor(atk * off / 6 * 0.5 * heightMul) - def); d += d2; res.hits = 2; }
    finish(scale(d));
  } else if (ab.kind === 'mag') {
    if (ab.pctDmg) { res.dmg = cap(Math.floor(tgt.maxHp * ab.pctDmg)); res.elemMul = 1; }
    else { let d = Math.floor(stat(att, 'mag') * ab.power / 6 * heightMul) - (ab.trueDamage ? 0 : Math.max(0, stat(tgt, 'res') - (ab.pierce?.res || 0))); d = Math.max(1, d); finish(scale(d)); }
  } else if (ab.kind === 'heal') {
    // heal conversions: `heal` is a flat amount (alias of `flat`), and a the prototype record may carry only
    // `mult` — the prototype heals as MAG x mult where this tree heals off `power`. Both forms resolve here,
    // so a record ported field-for-field can never silently heal 0.
    if (ab.flat || ab.heal) res.heal = Math.floor(ab.flat ?? ab.heal); else if (ab.pct) res.heal = Math.floor(tgt.maxHp * ab.pct); else if (ab.power) res.heal = Math.floor(stat(att, 'mag') * ab.power / 6);
    else if (ab.mult) res.heal = Math.round(stat(att, 'mag') * ab.mult);
    if (ab.id === 'soothing_gale') res.heal = att.hp;
    if (att.support === 'healing_boost') res.heal = Math.floor(res.heal * 1.25);
    if (tgt.statuses.curse) res.heal = Math.floor(res.heal * 0.5);
    if (ab.mpFlat) res.mp = ab.mpFlat; if (ab.mpPct) res.mp = Math.floor(tgt.maxMp * ab.mpPct);
  } else if (ab.kind === 'raise') { res.raise = true; res.heal = Math.max(1, Math.floor(tgt.maxHp * ab.pct * (tgt.statuses.curse ? 0.5 : 1))); }
  if (ab.drain && res.dmg) res.selfHeal = Math.floor(res.dmg * ab.drain);
  return res;
}

// ---------------------------------------------------------------- geometry
export function unitAt(units, x, z) { return units.find((u) => !u.ko && !u.removed && !u.airborne && u.x === x && u.z === z) || units.find((u) => u.ko && !u.removed && u.x === x && u.z === z); }
export function liveUnitAt(units, x, z) { return units.find((u) => !u.ko && !u.removed && !u.airborne && u.x === x && u.z === z); }
export function inRange(ax, az, ah, bx, bz, bh, r, ranged, minR = 1) {
  const d = Math.abs(ax - bx) + Math.abs(az - bz); const rr = r + (ranged && ah > bh ? Math.floor((ah - bh) / HEIGHT_STEP) : 0); return d >= minR && d <= rr;
}
export function targetTiles(u, map, ab) {
  const out = []; const r = abilityRange(u, ab);
  if (ab.self || r === 0) return [{ x: u.x, z: u.z }];
  if (ab.line) { for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let i = 1; i <= ab.line; i++) { const t = map.at(u.x + dx * i, u.z + dz * i); if (t) out.push({ x: t.x, z: t.z }); } return out; }
  const h = map.at(u.x, u.z).h; const ranged = isRanged(u, ab);
  // minRange: the prototype's minimum-distance field. inRange has always taken a minR; nothing passed it,
  // so a record that refuses point-blank targeting could not be expressed. Default 1 = every shipped record.
  for (let z = 0; z < map.d; z++) for (let x = 0; x < map.w; x++) { const t = map.at(x, z); if (inRange(u.x, u.z, h, x, z, t.h, r, ranged, ab.minRange || 1)) out.push({ x, z }); }
  return out;
}
export function areaTiles(cx, cz, ab, map) { const out = []; const a = ab.area || 0; for (let z = cz - a; z <= cz + a; z++) for (let x = cx - a; x <= cx + a; x++) if (map.at(x, z) && Math.abs(x - cx) + Math.abs(z - cz) <= a) out.push({ x, z }); return out; }
export function lineTiles(u, target, ab, map) {
  const dx = Math.sign(target.x - u.x), dz = Math.sign(target.z - u.z); const out = []; if ((dx !== 0 && dz !== 0) || (dx === 0 && dz === 0)) return out;
  for (let i = 1; i <= ab.line; i++) { const t = map.at(u.x + dx * i, u.z + dz * i); if (t) out.push({ x: t.x, z: t.z }); } return out;
}
// Tile-anchored shapes. Each is a filter over the same diamond `areaTiles` already walks, so nothing about the
// existing area maths moves: an ability that carries none of these keys still goes down the areaTiles branch and
// every shipped ability carries none. All four are axis-aligned on the WORLD grid, not on the caster's facing.
// the prototype's cone and T shapes stay cut on COST, not on capability: the direction is already here — effectTiles is
// handed the caster `u` and lineTiles derives its axis from `u` on the line branch; shapeTiles just discards `u`.
// Adding them is a signature change (shapeTiles would take `u` too, and effectTiles would pass it) plus one more
// dirs table, and no shipped ability record carries a cone/T key, so it would land as dead code in the middle of
// a balance pass. Do not read this comment as "the engine cannot do direction" — it can.
export function shapeTiles(cx, cz, ab, map) {
  const out = []; const push = (x, z) => { const t = map.at(x, z); if (t) out.push({ x: t.x, z: t.z }); };
  const n = ab.cross || ab.row || ab.column || ab.ring;
  if (ab.ring) { for (let z = cz - n; z <= cz + n; z++) for (let x = cx - n; x <= cx + n; x++) if (Math.abs(x - cx) + Math.abs(z - cz) === n) push(x, z); return out; }
  push(cx, cz);   // cross/row/column all include the anchor itself
  const dirs = ab.cross ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : ab.row ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
  for (const [dx, dz] of dirs) for (let i = 1; i <= n; i++) push(cx + dx * i, cz + dz * i);
  return out;
}
// True for every ability whose footprint is not a plain diamond around the anchor. Callers use it where they used to
// test `ab.line` alone: the AI's "does this tile's diamond touch anyone" prefilter, and the single-target tests for
// Reflect and for what counts as a melee blow.
export const isShaped = (ab) => !!(ab.line || ab.cross || ab.row || ab.column || ab.ring);
// How far a shape reaches from its anchor, and what the shape is. Only abilityInfo needs these: a shaped ability
// carries `area: 0`, so the menu quoted the diamond radius and reported a 9-tile plus as a single-tile hit.
export const shapeReach = (ab) => ab.line || ab.cross || ab.row || ab.column || ab.ring || 0;
export const shapeName = (ab) => (ab.line ? 'line' : ab.cross ? 'plus' : ab.row ? 'rank' : ab.column ? 'file' : ab.ring ? 'ring' : null);
export function effectTiles(u, target, ab, map) { return ab.line ? lineTiles(u, target, ab, map) : isShaped(ab) ? shapeTiles(target.x, target.z, ab, map) : areaTiles(target.x, target.z, ab, map); }
// Chain arcs: primary -> nearest unhit FOE within `range`, repeated `jumps` times, each hop worth x`falloff`.
// It lives here rather than in effectTiles because a hop is chosen by where the bodies are, and effectTiles only
// sees the map. Pure and deterministic — ties go to the earlier unit in `units`, so a seeded sim replays exactly.
// Returns the hops in order; the caller maps hop i to falloff^(i+1).
export function chainTargets(units, u, ab, primary) {
  const out = []; const seen = new Set([primary]); const mine = sideOf(u); let cur = primary;
  for (let j = 0; j < ab.chain.jumps; j++) {
    let next = null, best = Infinity;
    for (const o of units) {
      if (o.ko || o.removed || o.airborne || seen.has(o) || o.statuses.vanish || sideOf(o) === mine) continue;
      const d = mdist(cur, o); if (d > ab.chain.range || d >= best) continue;
      best = d; next = o;
    }
    if (!next) break;
    seen.add(next); out.push(next); cur = next;
  }
  return out;
}

// Dijkstra over tiles honouring MOVE, JUMP, water and occupancy. Allies are passable; enemies block unless Spirit Walk.
// Movement abilities: Teleport (any tile within MOVE), Terrain Walker (water), Pilgrim's Step / Unyielding Step (+1 conditional).
export function reachable(u, map, units, teamOf = (o) => o.team) {
  const mv = MOVEMENTS[u.movement] || {}; const myTeam = teamOf(u);
  let move = stat(u, 'move'); const jump = stat(u, 'jump'); const key = (x, z) => `${x},${z}`;
  const occ = new Map(); for (const o of units) if (!o.removed && !o.airborne && o !== u) occ.set(key(o.x, o.z), o);
  // Rampart Aura: an enemy Runesword seals the tiles around itself against movement (§3.23)
  const sealed = new Set();
  for (const o of units) if (!o.ko && !o.removed && o.support === 'rampart_aura' && teamOf(o) !== myTeam)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) sealed.add(key(o.x + dx, o.z + dz));
  const dist = new Map(); const prev = new Map(); dist.set(key(u.x, u.z), 0);
  const water = u.movement === 'terrain_walker' || u.statuses.float;
  const bonus = (u.movement === 'pilgrims_step' || u.movement === 'unyielding_step') && move > 0 ? 1 : 0;
  if (u.movement === 'teleport' && move > 0) {
    const tiles = [];
    for (let z = 0; z < map.d; z++) for (let x = 0; x < map.w; x++) { const t = map.at(x, z); const d = Math.abs(x - u.x) + Math.abs(z - u.z); if (d === 0 || d > move || !t.walk || occ.has(key(x, z))) continue; tiles.push({ x, z, d }); }
    return { tiles, path: (x, z) => (tiles.some((t) => t.x === x && t.z === z) ? [[x, z]] : null), teleport: true };
  }
  const open = [[0, u.x, u.z]];
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]); const [d, x, z] = open.shift(); if (d > dist.get(key(x, z))) continue;
    const t0 = map.at(x, z);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, t = map.at(nx, nz); if (!t) continue; if (!t.walk && !(water && t.water)) continue;
      if (Math.abs(t.h - t0.h) > jump * HEIGHT_STEP) continue;
      if (sealed.has(key(nx, nz))) continue;
      const o = occ.get(key(nx, nz));
      if (o && teamOf(o) !== myTeam && u.movement !== 'spirit_walk' && !(u.movement === 'beast_path' && CLASSES[o.cls].monster)) continue;
      const nd = d + 1; if (nd > move + bonus) continue;
      if (nd < (dist.get(key(nx, nz)) ?? Infinity)) { dist.set(key(nx, nz), nd); prev.set(key(nx, nz), [x, z]); open.push([nd, nx, nz]); }
    }
  }
  const allies = units.filter((o) => !o.ko && !o.removed && o !== u && teamOf(o) === myTeam);
  const h0 = map.at(u.x, u.z).h;
  const tiles = []; for (const [k, d] of dist) {
    const [x, z] = k.split(',').map(Number); if (occ.has(k) || d === 0) continue;
    if (d > move) { // conditional +1
      if (u.movement === 'pilgrims_step' && !allies.some((a) => Math.abs(a.x - x) + Math.abs(a.z - z) === 1)) continue;
      if (u.movement === 'unyielding_step' && map.at(x, z).h !== h0) continue;
    }
    tiles.push({ x, z, d });
  }
  const ok = new Set(tiles.map((t) => key(t.x, t.z)));
  return { tiles, path: (x, z) => { let k = key(x, z); if (!ok.has(k)) return null; const p = []; while (k !== key(u.x, u.z)) { const [px, pz] = k.split(',').map(Number); p.unshift([px, pz]); const pr = prev.get(k); k = key(pr[0], pr[1]); } return p; } };
}

// ---------------------------------------------------------------- the engine
// Seedable, serializable RNG (mulberry32, the same generator the sims use). The battle page's Engine draws from one of
// these instead of Math.random so REWIND (Engine.snapshot / restore, battle.js) can put the dice back exactly where they
// were: restore a turn, make the same choices, get the same rolls. getState/setState is the whole state (one int).
export function makeRng(seed = (Math.random() * 4294967296) >>> 0) {
  let a = seed | 0;
  const f = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.getState = () => a; f.setState = (v) => { a = v | 0; }; f.seed = seed >>> 0;
  return f;
}
// Unit fields that are immutable during a battle and may hold shared tables (u.eq keeps references into ITEMS):
// snapshots keep these by reference instead of deep-copying them.
const SNAP_SHARED = new Set(['eq', 'base']);
const cloneVal = (k, v) => (SNAP_SHARED.has(k) || v === null || typeof v !== 'object' ? v : structuredClone(v));
function cloneUnit(u) { const o = {}; for (const k of Object.keys(u)) o[k] = cloneVal(k, u[k]); return o; }

export class Engine {
  constructor(map, opts = {}) {
    this.map = map; this.rng = opts.rng || makeRng(opts.seed); this.units = opts.units || []; this.tick = 0; this.turn = 0; this.round = 0; this._roundSeen = new Set(); this.over = false; this.winner = null; this.log = [];
    this.maxTicks = opts.maxTicks || 4000; this.reactionDepth = 0; this.stallTurns = 0; this.stallLimit = opts.stallLimit || 80; this.timeout = false; this.mutual = false;
  }
  addUnit(team, cls, x, z, name, opts = {}) { const u = makeUnit(`${team}${this.units.length}`, team, cls, x, z, name, { rng: this.rng, ...opts }); this.units.push(u); return u; }
  alive() { return this.units.filter((u) => !u.ko && !u.removed); }
  teamOf(u) { return sideOf(u); }
  enemiesOf(u) { const t = this.teamOf(u); return this.units.filter((o) => !o.ko && !o.removed && this.teamOf(o) !== t && o !== u); }
  alliesOf(u) { const t = this.teamOf(u); return this.units.filter((o) => !o.ko && !o.removed && this.teamOf(o) === t && o !== u); }
  roll(pct) { return this.rng() * 100 < pct; }
  reach(u) { return reachable(u, this.map, this.units, (o) => this.teamOf(o)); }
  canMove(u) { return !u.moved && stat(u, 'move') > 0 && !u.statuses.immobilize; }
  canAct(u) { return !u.acted && !u.statuses.disable && !u.charging; }
  // ---- clock: returns {kind:'turn'|'charge'|'crystal'|'countdown', unit} and advances ticks as needed
  advance() {
    for (let guard = 0; guard < 4000; guard++) {
      if (this.over) return null;
      const fire = this.units.filter((u) => u.charging && !u.ko && !u.removed && u.charging.left <= 0).sort((a, b) => a.charging.queuedAt - b.charging.queuedAt)[0];
      if (fire) return { kind: 'charge', unit: fire };
      const ready = this.units.filter((u) => !u.ko && !u.removed && u.ct >= 100 && !u.statuses.stop).sort((a, b) => b.ct - a.ct || stat(b, 'spd') - stat(a, 'spd') || (a.team === 'A' ? -1 : 1));
      if (ready.length) return { kind: 'turn', unit: ready[0] };
      const dead = this.units.find((u) => u.ko && !u.removed && u.ct >= 100);
      if (dead) { dead.ct = 0; dead.koTurns++; if (dead.koTurns >= KO_TURNS) { dead.removed = true; dead.statuses = {}; return { kind: 'crystal', unit: dead }; } return { kind: 'countdown', unit: dead, left: KO_TURNS - dead.koTurns }; }
      // The tick cap is the safety net under the 80-turn stall clock, and it is a TIMEOUT like any other:
      // resolve it the way the stalemate branch does (the healthier side holds the field) and mark it, so a
      // capped battle is a reported timeout rather than an un-terminated draw. It stays visible -- sim.mjs
      // counts timeouts and fails the run if they exceed 5%, which is what catches real non-termination.
      if (this.tick >= this.maxTicks) { const t = this.totalHp(); this.over = true; this.timeout = true;
        this.winner = t.A === t.B ? null : t.A > t.B ? 'A' : 'B'; return null; }
      this.tick++;
      for (const u of this.units) {
        if (u.removed) continue;
        if (u.statuses.stop) { u.statuses.stop--; if (u.statuses.stop <= 0) delete u.statuses.stop; continue; } // CT frozen
        u.ct += u.ko ? Math.max(1, CLASSES[u.cls].spd) : stat(u, 'spd');
        if (u.charging) u.charging.left--;
      }
    }
    return null;
  }
  // ---- turn start: MP regen, poison/regen ticks, bulwark grants expire, sleep/charm handling
  beginTurn(u) {
    const ev = []; this.turn++; this.activeUnit = u;
    // Rounds (§5.2's 8-14): a round closes once every unit still standing has taken a turn in it; `turn` counts unit turns.
    if (this.round === 0 || this.alive().every((o) => this._roundSeen.has(o.id))) { this.round++; this._roundSeen.clear(); } this._roundSeen.add(u.id); this._hpBefore = this.totalHp(); u.moved = false; u.acted = false; u.movementUsed = false; u.charmedTurn = !!u.statuses.charm; u.turnStart = { x: u.x, z: u.z };
    for (const id of u.grants) { const a = this.units.find((o) => o.id === id); if (a && a.statuses.bulwark) { delete a.statuses.bulwark; a.mods.defMod = 0; } } u.grants = [];
    // conditional Move bonuses that are decided at turn start (§3.19 Gunslinger's Perch, §3.23 Vanguard)
    u.moveBonus = 0;
    if (u.movement === 'vanguard' && this.alliesOf(u).some((a) => mdist(a, u) <= 2)) u.moveBonus = 1;
    if (u.movement === 'gunslingers_perch') { const hs = this.units.filter((o) => !o.ko && !o.removed).map((o) => this.map.at(o.x, o.z).h); if (this.map.at(u.x, u.z).h >= Math.min(...hs) + HEIGHT_STEP * 2) u.moveBonus = 1; }
    const regen = Math.floor(u.maxMp * MP_REGEN); if (regen && u.mp < u.maxMp) { u.mp = Math.min(u.maxMp, u.mp + regen); ev.push({ type: 'mp', unit: u, amount: regen }); }
    if (u.statuses.regen) { const h = Math.floor(u.maxHp * 0.1); u.hp = Math.min(u.maxHp, u.hp + h); ev.push({ type: 'heal', unit: u, victim: u, amount: h, source: 'Regen' }); }
    if (u.statuses.poison) { const d = Math.max(1, Math.floor(u.maxHp * 0.1)); u.hp = Math.max(0, u.hp - d); ev.push({ type: 'damage', unit: u, victim: u, amount: d, source: 'Poison' }); if (u.hp <= 0) this.knockOut(u, null, ev); }
    ev.push({ type: 'turnStart', unit: u, skip: u.ko ? 'ko' : u.statuses.sleep ? 'sleep' : null });
    return ev;
  }
  // ---- movement
  move(u, path) {
    const ev = []; if (!path || !path.length) return ev;
    const [ex, ez] = path[path.length - 1]; if (unitAt(this.units, ex, ez)) throw new Error('move onto occupied tile');
    const from = { x: u.x, z: u.z }; ev.push({ type: 'move', unit: u, path, from });
    let px = u.x, pz = u.z; for (const [x, z] of path) { const f = facingFrom(px, pz, x, z); if (f != null) u.facing = f; px = x; pz = z; }
    u.x = ex; u.z = ez; u.moved = true; u.movedTiles = path.length;
    // Fell Approach (§3.24): every enemy walked past takes one Poison tick
    if (u.movement === 'fell_approach') { const seen = new Set(); for (const [x, z] of path) for (const e of this.enemiesOf(u)) if (Math.abs(e.x - x) + Math.abs(e.z - z) === 1 && !seen.has(e.id)) { seen.add(e.id); this.applyStatus(e, 'poison', 2, ev, u); } }
    // Menacing Advance (§3.22): enemies adjacent at the end of the move lose 10 CT
    if (u.movement === 'menacing_advance') for (const e of this.enemiesOf(u)) if (mdist(e, u) === 1) { e.ct = Math.max(0, e.ct - 10); ev.push({ type: 'ct', unit: u, victim: e, amount: -10, source: 'Menacing Advance' }); }
    if (!u.movementUsed) { // one movement-ability effect per turn (§5.1.4)
      if (u.movement === 'move_mp_up') { const g = 3 * path.length; u.mp = Math.min(u.maxMp, u.mp + g); u.movementUsed = true; ev.push({ type: 'mp', unit: u, amount: g, source: 'Move-MP Up' }); }
      if (u.movement === 'bulwark_advance') { for (const a of this.alliesOf(u)) if (mdist(a, u) === 1 && !a.statuses.bulwark) { a.statuses.bulwark = 99; a.mods.defMod = clamp(a.mods.defMod + 2, -3, 3); u.grants.push(a.id); u.movementUsed = true; ev.push({ type: 'status', unit: u, victim: a, status: 'bulwark', name: 'Bulwark', applied: true }); } }
    }
    return ev;
  }
  // ---- acting
  act(u, id, target) {
    const ab = ABILITIES[id]; const ev = []; if (!ab) return ev;
    const cost = abilityMp(u, ab); u.mp = Math.max(0, u.mp - cost); u.acted = true;
    // Blood Pact: the HP price is paid on commitment, like MP, not on impact — so it is spent even if every victim
    // evades. canUse() has already refused the cast that would take the last point, hence no KO check here.
    // The Math.max(1,...) clamp keeps the caster alive, but only canUse() checks it can AFFORD the cost --
    // act() re-checks here so a direct Engine.act (a test, a script, a future caller) cannot produce the
    // contradiction fuzzing found: a KO'd unit sitting at hp 1.
    if (ab.hpCost) { const h = Math.max(1, Math.floor(u.maxHp * ab.hpCost));
      if (u.hp <= h) return ev;                                  // cannot pay: the ability does not happen
      u.hp -= h; ev.push({ type: 'damage', unit: u, victim: u, amount: h, source: ab.name }); }
    if (ab.item && u.items) u.items[id] = Math.max(0, (u.items[id] || 0) - 1);
    if (u.statuses.vanish && !ab.self) delete u.statuses.vanish;
    if (!ab.self) { const f = facingFrom(u.x, u.z, target.x, target.z); if (f != null) u.facing = f; }
    const ct = abilityCT(u, ab);
    if (ct > 0) {
      u.charging = { id, target: { x: target.x, z: target.z }, left: ct, total: ct, queuedAt: this.tick * 1000 + this.turn, mpPaid: cost };
      if (ab.jumpAttack) u.airborne = true;
      ev.push({ type: 'charge', unit: u, ability: ab, id, target: { ...target }, tiles: effectTiles(u, target, ab, this.map), ct });
      return ev;
    }
    if (u.support === 'doublecast' && ab.kind === 'mag' && (ab.ct || 0) <= 1) { // §3.17: two CT ≤1 spells in one action for MP ×1.5
      const extra = Math.ceil(cost * 0.5);
      if (u.mp >= extra) { u.mp -= extra; return ev.concat(this.resolve(u, ab, target, { id }), this.resolve(u, ab, target, { id, second: true })); }
    }
    return ev.concat(this.resolve(u, ab, target, { id }));
  }
  resolveCharge(u) {
    const c = u.charging; u.charging = null; if (!c) return []; const ab = ABILITIES[c.id]; const ev = [];
    if (ab.jumpAttack) { // land on the target tile if free, else the nearest free tile
      u.airborne = false; let land = null;
      for (let r = 0; r <= 8 && !land; r++) for (const t of areaTiles(c.target.x, c.target.z, { area: r }, this.map)) { if (Math.abs(t.x - c.target.x) + Math.abs(t.z - c.target.z) !== r) continue; const tile = this.map.at(t.x, t.z); if (tile && tile.walk && !unitAt(this.units, t.x, t.z)) { land = t; break; } }
      if (!land) land = { x: u.x, z: u.z }; ev.push({ type: 'land', unit: u, from: { x: u.x, z: u.z }, to: land, target: c.target }); u.x = land.x; u.z = land.z;
      const f = facingFrom(u.x, u.z, c.target.x, c.target.z); if (f != null) u.facing = f;
    }
    return ev.concat(this.resolve(u, ab, c.target, { id: c.id, charged: true, mpPaid: c.mpPaid }));
  }
  victims(u, ab, target, ctx = {}, hops = null) {
    const tiles = effectTiles(u, target, ab, this.map); const team = this.teamOf(u); const out = [];
    for (const t of tiles) {
      const v = ab.kind === 'raise' ? this.units.find((o) => o.ko && !o.removed && o.x === t.x && o.z === t.z) : liveUnitAt(this.units, t.x, t.z);
      if (!v) continue; if (v.statuses.vanish && v !== u) continue;
      if (ab.jumpAttack && v === u) continue;   // the target stepped off its tile and the Wyrmlancer landed there: a whiff, not a self-hit
      const ally = this.teamOf(v) === team;
      if (ab.enemyOnly && ally) continue; if (ab.allyOnly && !ally) continue; if (ab.ground && v.statuses.float) continue;
      if (ab.kind === 'raise' && ally === false) continue;
      out.push(v);
    }
    // The arc is drawn from the unit the caster actually hit, so it is resolved here (where the roster is) rather
    // than in effectTiles (which only sees the map). hops is null for every ability without a `chain` record.
    if (ab.chain && hops && out.length) for (const [i, v] of chainTargets(this.units, u, ab, out[0]).entries()) { out.push(v); hops.set(v, i + 1); }
    return out;
  }
  resolve(u, ab, target, ctx = {}) {
    const ev = []; const id = ctx.id || ab.id;
    // ---- pre-beat displacements (teleport-hit / blink / dash), ported from the prototype's applyAbility ----
    // Their knockback events are pushed BEFORE abilityStart, so battle.js plays them as standalone
    // beats: the caster relocates first and the windup then starts from the new tile. Every event
    // type used here already exists — no presentation file has to change for the port.
    // A unit may only be placed where it could stand: water is ground only for Terrain Walker / Float (sim invariant
    // 'on unwalkable tile' — a swap once parked a Thief on the water tile its Float partner had been hovering over).
    const canStand = (o, x, z) => { const t = this.map.at(x, z); return !!t && (t.walk || (t.water && (o.movement === 'terrain_walker' || !!o.statuses.float))); };
    if (ab.teleportHit) { const v = liveUnitAt(this.units, target.x, target.z);
      if (v && v !== u && canStand(u, v.x, v.z) && canStand(v, u.x, u.z)) { const a = { x: u.x, z: u.z }, b = { x: v.x, z: v.z };
        u.x = b.x; u.z = b.z; v.x = a.x; v.z = a.z;
        ev.push({ type: 'knockback', unit: u, victim: u, from: a, to: b }, { type: 'knockback', unit: u, victim: v, from: b, to: a });
        target = a;   // the prototype swaps the two before shaping, so the strike follows the victim to its new tile
      } }
    if (ab.blink) { const t = this.map.at(target.x, target.z);
      if (t && t.walk && !unitAt(this.units, target.x, target.z) && (u.x !== target.x || u.z !== target.z)) {
        const from = { x: u.x, z: u.z }; u.x = target.x; u.z = target.z;
        ev.push({ type: 'knockback', unit: u, victim: u, from, to: { x: u.x, z: u.z } }); } }
    if (ab.dash) { const dest = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: target.x + dx, z: target.z + dz }))
        .find((t) => { const m = this.map.at(t.x, t.z); return m && m.walk && !unitAt(this.units, t.x, t.z); });
      if (dest && (u.x !== dest.x || u.z !== dest.z)) { const from = { x: u.x, z: u.z }; u.x = dest.x; u.z = dest.z;
        ev.push({ type: 'knockback', unit: u, victim: u, from, to: { x: u.x, z: u.z } }); } }
    const tiles = effectTiles(u, target, ab, this.map);
    ev.push({ type: 'abilityStart', unit: u, ability: ab, id, target: { ...target }, tiles, reaction: !!ctx.reaction, earthsong: ab.earthsong ? geomancyFor(u, this.map) : null });
    // ---- dual: two units picked in range (the prototype's early-out: no shape footprint, no hit roll) ----
    if (ab.dual) {
      const a = liveUnitAt(this.units, target.x, target.z);
      const b = target.second ? liveUnitAt(this.units, target.second.x, target.second.z) : null;
      const team = this.teamOf(u); const range = abilityRange(u, ab); const h0 = this.map.at(u.x, u.z).h;
      const inR = (o) => inRange(u.x, u.z, h0, o.x, o.z, this.map.at(o.x, o.z).h, range, isRanged(u, ab));
      const sideOk = (o) => (ab.dualTeam === 'allies' ? this.teamOf(o) === team : this.teamOf(o) !== team);
      if (a && b && a !== b && sideOk(a) && sideOk(b) && !a.statuses.vanish && !b.statuses.vanish && inR(a) && inR(b)) {
        if (ab.dual === 'swap' && canStand(a, b.x, b.z) && canStand(b, a.x, a.z)) {
          const pa = { x: a.x, z: a.z }, pb = { x: b.x, z: b.z };
          a.x = pb.x; a.z = pb.z; b.x = pa.x; b.z = pa.z;
          ev.push({ type: 'knockback', unit: u, victim: a, from: pa, to: pb }, { type: 'knockback', unit: u, victim: b, from: pb, to: pa });
        } else if (ab.dual === 'ctSwap') {
          const c = a.ct; a.ct = b.ct; b.ct = c;
          ev.push({ type: 'quick', unit: u, victim: a }, { type: 'quick', unit: u, victim: b });
        } else if (ab.dual === 'hpSwap') {
          const ha = a.hp, hb = b.hp, na = Math.min(a.maxHp, hb), nb = Math.min(b.maxHp, ha);
          a.hp = na; b.hp = nb;
          // Neither side can reach 0 here: both donors hand over a live unit's hp (>= 1), clamped by their own max.
          if (na !== ha) ev.push(na > ha ? { type: 'heal', unit: u, victim: a, amount: na - ha, source: ab.name } : { type: 'damage', unit: u, victim: a, amount: ha - na, source: ab.name });
          if (nb !== hb) ev.push(nb > hb ? { type: 'heal', unit: u, victim: b, amount: nb - hb, source: ab.name } : { type: 'damage', unit: u, victim: b, amount: hb - nb, source: ab.name });
        }
      }
      ev.push({ type: 'abilityEnd', unit: u, ability: ab, id, reaction: !!ctx.reaction });
      return ev;
    }
    // ---- pull: drag bodies within radius toward the anchor BEFORE the blast (inside the beat, so
    // the slide plays between windup and impact numbers: cast, drag, crush). Steps honour walkability
    // and occupancy exactly as the prototype's does and stop at the edge of the area-1 diamond it feeds. ----
    if (ab.pull) {
      const { radius = 3, steps = 99 } = ab.pull;
      for (const o of this.units) {
        if (o === u || o.ko || o.removed || o.airborne || o.statuses.vanish || o.movement === 'unyielding_step') continue;
        const d0 = Math.abs(o.x - target.x) + Math.abs(o.z - target.z);
        if (d0 === 0 || d0 > radius) continue;
        let nx = o.x, nz = o.z;
        for (let s = 0; s < steps; s++) {
          if (Math.abs(target.x - nx) + Math.abs(target.z - nz) <= 1) break;
          const dx = Math.sign(target.x - nx), dz = Math.sign(target.z - nz);
          const opts = Math.abs(target.x - nx) >= Math.abs(target.z - nz) ? [[nx + dx, nz], [nx, nz + dz]] : [[nx, nz + dz], [nx + dx, nz]];
          let moved = false;
          for (const [mx, mz] of opts) { const t = this.map.at(mx, mz); if (t && t.walk && !unitAt(this.units, mx, mz)) { nx = mx; nz = mz; moved = true; break; } }
          if (!moved) break;
        }
        if (nx !== o.x || nz !== o.z) { const from = { x: o.x, z: o.z }; o.x = nx; o.z = nz; ev.push({ type: 'knockback', unit: u, victim: o, from, to: { x: nx, z: nz } }); }
      }
    }
    // Anchor travels in ctx only for abilities that price a victim by its distance from it; chainMul only for
    // a chained hop. Everything else passes the caller's ctx object through untouched, as before.
    const base = ab.falloff ? { ...ctx, anchor: target } : ctx;
    const hops = ab.chain ? new Map() : null;
    const vs = this.victims(u, ab, target, base, hops); const post = [];
    for (const v of vs) {
      const hop = hops && hops.get(v);
      const c = hop ? { ...base, chainMul: Math.pow(ab.chain.falloff, hop) } : base;
      this.applyHit(u, this.redirect(u, v, ab, c, ev), ab, c, ev, post);
    }
    ev.push({ type: 'abilityEnd', unit: u, ability: ab, id, reaction: !!ctx.reaction });
    for (const fn of post) fn(); // counters run after the whole action has been applied (§2.3), one level deep
    return ev;
  }
  canReact(v, ctx, att) {
    if (ctx.reaction || this.reactionDepth > 0) return false; if (!v.reaction || v.ko || v.removed || v.charging || v.airborne) return false;
    // A unit never reacts to its OWN ability. Gravity (area 1, not enemyOnly) and the other self-inclusive
    // AoEs catch their caster, and the caster's Mana Shield / Counter then answered its own damage -- which
    // sim.mjs flags as 'reaction by the acting unit' and which reads as nonsense in play. 20% of battles on a
    // Time-Mage-heavy roster before this guard.
    if (att && v === att) return false;
    for (const s in v.statuses) if (STATUS[s]?.noReact) return false;
    // Shadow Step (§3.21): no counter-type reaction against an attack made after moving 3+ tiles
    if (att && att.movement === 'shadow_step' && (att.movedTiles || 0) >= 3 && COUNTER_REACTIONS.has(v.reaction)) return false;
    return this.roll(stat(v, 'brv'));
  }
  // Cover (§3.16) and the Guardian reaction: an adjacent protector eats a blow aimed at a squishier ally.
  redirect(u, v, ab, ctx, ev) {
    if (ctx.reaction || ctx.redirected) return v;
    if (ab.kind !== 'phys' && ab.kind !== 'mag') return v;
    if (this.teamOf(v) === this.teamOf(u)) return v;
    for (const a of this.alliesOf(v)) {
      if (a === u || a.ko || a.removed || a.airborne || mdist(a, v) !== 1) continue;
      if (a.statuses.cover) { ev.push({ type: 'reaction', unit: a, reaction: 'cover', name: 'Cover', covering: v }); return a; }
      if (a.reaction === 'guardian' && this.canReact(a, ctx, u)) { ev.push({ type: 'reaction', unit: a, reaction: 'guardian', name: REACTIONS.guardian.name, covering: v }); return a; }
    }
    return v;
  }
  react(v, name, ev, extra = {}) { ev.push({ type: 'reaction', unit: v, reaction: name, name: REACTIONS[name]?.name || name, ...extra }); }
  applyHit(u, v, ab, ctx, ev, post) {
    const cost = ctx.mpPaid ?? abilityMp(u, ab);
    if (ab.kind === 'mag' && cost > 0 && v.reaction === 'absorb_mp' && v !== u && this.canReact(v, ctx, u)) { v.mp = Math.min(v.maxMp, v.mp + cost); this.react(v, 'absorb_mp', ev, { amount: cost }); }
    // Reflect (§3.14 Gemfox): a single-target enemy spell bounces back at its caster. Gated on
    // ctx.reaction like every other reaction — without it, a counter-chain landing on a unit that
    // carries Reflect pushed a reaction event whose unit was the ACTING unit (sim invariant
    // 'reaction by the acting unit', packed seed 2 battle 43).
    if (ab.kind === 'mag' && (ab.area || 0) === 0 && !isShaped(ab) && !ab.chain && v.statuses.reflect && v !== u && !ctx.reflected && !ctx.reaction && this.teamOf(v) !== this.teamOf(u)) {
      ev.push({ type: 'reaction', unit: v, reaction: 'reflect', name: 'Reflect', reflected: true });
      this.applyHit(u, u, ab, { ...ctx, reflected: true }, ev, post); return;
    }
    const hc = hitChance(u, v, ab, this.map); const hit = this.roll(hc);
    if (!hit) { ev.push({ type: 'miss', unit: u, victim: v, ability: ab, chance: hc }); return; }
    const harmful = (ab.kind === 'phys' || ab.kind === 'mag' || ab.kind === 'debuff' || ab.kind === 'special') && v !== u;
    const melee = ab.kind === 'phys' && !isRanged(u, ab) && !isShaped(ab) && (ab.area || 0) === 0;
    // nullifying reactions fire before damage
    if (harmful && (ab.kind === 'phys' || ab.kind === 'mag') && this.canReact(v, ctx, u)) {
      const r = v.reaction;
      if ((r === 'parry' && ab.kind === 'phys') || (r === 'blade_catch' && ab.weaponHit) || (r === 'deflect_arrows' && ab.kind === 'phys' && isRanged(u, ab)) || (r === 'reflex' && ab.kind === 'phys')
        || (r === 'catch' && ab.kind === 'phys' && isRanged(u, ab) && (ab.thrown || ab.item))) { this.react(v, r, ev, { nullified: true }); return; }
      if (r === 'spell_ward' && ab.kind === 'mag') { ctx = { ...ctx, halve: true }; this.react(v, r, ev); }
      if (r === 'aegis' && ab.kind === 'phys') { ctx = { ...ctx, halve: true }; this.react(v, r, ev); }   // Guardian: halves rather than nullifies, so it is not a second Parry
    }
    // ctx.units is what lets Pack Tactics and Duelist count the bodies around the two fighters. It is added here
    // (not stored on ctx by the caller) so every entry point into applyHit — act, resolveCharge, a reaction — gets it.
    const eff = computeEffect(u, v, ab, this.map, ctx.units ? ctx : { ...ctx, units: this.units });
    if (ctx.halve) eff.dmg = Math.floor(eff.dmg / 2);
    let damaged = false;
    if (eff.absorb) { v.hp = Math.min(v.maxHp, v.hp + eff.heal); ev.push({ type: 'heal', unit: u, victim: v, amount: eff.heal, absorb: true }); }
    else if (eff.dmg > 0 && (ab.kind === 'phys' || ab.kind === 'mag')) {
      let dmg = eff.dmg;
      if (v.reaction === 'mana_shield' && v.mp > 0 && this.canReact(v, ctx, u)) { const fromMp = Math.min(v.mp, dmg); v.mp -= fromMp; dmg -= fromMp; this.react(v, 'mana_shield', ev, { amount: fromMp }); }
      v.hp = Math.max(0, v.hp - dmg); damaged = true;
      ev.push({ type: 'damage', unit: u, victim: v, amount: dmg, ability: ab, side: eff.side, elemMul: eff.elemMul, hits: eff.hits, height: eff.height });
      if (v.statuses.sleep) { delete v.statuses.sleep; ev.push({ type: 'statusEnd', unit: v, status: 'sleep', name: 'Sleep' }); }
      if (v.statuses.charm) { delete v.statuses.charm; v.charmedTurn = false; ev.push({ type: 'statusEnd', unit: v, status: 'charm', name: 'Charm' }); }
      if (eff.selfHeal && u.hp > 0 && !u.ko) { const h = Math.min(eff.selfHeal, u.maxHp - u.hp); u.hp += h; ev.push({ type: 'heal', unit: u, victim: u, amount: h, drain: true }); }
      // Backlash: the recoil is a share of the damage actually landed (after Mana Shield ate its part), and it can
      // kill — that is the ability. It is applied before the victim's response reactions so a dead attacker cannot
      // then be countered, which is the same order a KO'd attacker already gets everywhere else.
      if (ab.recoil && !u.ko && u !== v) {
        const r = Math.max(1, Math.floor(dmg * ab.recoil)); u.hp = Math.max(0, u.hp - r);
        ev.push({ type: 'damage', unit: u, victim: u, amount: r, source: ab.name });   // self-inflicted, so it reads like the Poison tick, not like a hit from the victim
        if (u.hp <= 0 && !u.ko) this.knockOut(u, v, ev);
      }
    }
    if (ab.kind === 'heal' && !eff.absorb) {
      if (eff.heal) { const h = Math.min(eff.heal, v.maxHp - v.hp); v.hp += h; ev.push({ type: 'heal', unit: u, victim: v, amount: h }); }
      if (eff.mp) { const m = Math.min(eff.mp, v.maxMp - v.mp); v.mp += m; ev.push({ type: 'mp', unit: v, amount: m, source: ab.name }); }
      const cure = ab.cureAll ? Object.keys(v.statuses).filter((s) => STATUS[s]?.neg && s !== 'unarmed') : (ab.cures || ab.cure || []).filter((s) => v.statuses[s]);
      for (const s of cure) this.removeStatus(v, s, ev);
    }
    if (eff.raise) { v.ko = false; v.koTurns = 0; v.hp = eff.heal; v.ct = 0; v.statuses = {}; v.mods = { atkMod: 0, magMod: 0, defMod: 0, spdMod: 0 }; ev.push({ type: 'raise', unit: u, victim: v, amount: eff.heal });
      if (v.eq) for (const s of v.eq.auto) if (s !== 'reraise' && STATUS[s]) v.statuses[s] = 99; }   // "always" gear statuses come back with the unit
    // statuses / stat mods carried by the ability
    // Learn (§3.18): a Beastsage that survives a monster ability keeps it
    if (v.support === 'learn' && CLASSES[u.cls].monster && !ab.hidden && ab.id !== 'attack' && !v.abilityList.includes(ab.id) && !v.learned.includes(ab.id)) {
      v.learned.push(ab.id); v.abilityList.push(ab.id); ev.push({ type: 'learn', unit: v, ability: ab, id: ab.id });
    }
    // Mana Burn: MP torn out and kept, capped by what the victim actually holds — a dry target gives nothing.
    if (ab.drainMp && v !== u) { const m = Math.min(v.mp, ab.drainMp); if (m > 0) { v.mp -= m; u.mp = Math.min(u.maxMp, u.mp + m); ev.push({ type: 'mp', unit: u, amount: m, source: ab.name }); } }
    // Clock Hit: CT knocked off the victim's clock, never below 0 and never taking more than is on it. The 'ct'
    // event already exists for Menacing Advance, so battle.js and the UI read this with no new vocabulary.
    if (ab.ctDmg && v !== u && !v.ko) { const c = Math.min(v.ct, ab.ctDmg); if (c > 0) { v.ct -= c; ev.push({ type: 'ct', unit: u, victim: v, amount: -c, source: ab.name }); } }
    if (ab.hex && v.charging) { v.charging.left = Math.min(20, v.charging.left * 2); v.charging.total = Math.min(20, v.charging.total * 2); ev.push({ type: 'status', unit: u, victim: v, status: 'hex', name: 'Hex', applied: true }); }
    const stList = ab.statuses ? ab.statuses.map((s) => ({ id: s, chance: 100 })) : ab.status ? [typeof ab.status === 'string' ? { id: ab.status, chance: 100 } : ab.status] : [];
    if (ab.randomStatuses) { // Rancid Breath: N distinct ailments, each at statusChance
      const pool = Object.keys(STATUS).filter((k) => STATUS[k].neg && !STATUS[k].mod && k !== 'unarmed' && !v.statuses[k]);
      for (let i = 0; i < ab.randomStatuses && pool.length; i++) stList.push({ id: pool.splice(Math.floor(this.rng() * pool.length), 1)[0], chance: ab.statusChance ?? 50 });
    }
    if (ab.earthsong) { const g = geomancyFor(u, this.map); stList.push({ id: g.status, chance: 50, turns: g.turns }); }
    // A weapon's on-hit rider (Viper Kris: Poison 25%) rides the plain Attack only, and only a blow that landed.
    if (ab.id === 'attack' && u.eq?.onHit && v !== u && !u.statuses.unarmed && damaged && !v.statuses[u.eq.onHit.status]) stList.push({ id: u.eq.onHit.status, chance: u.eq.onHit.chance });
    for (const s of stList) if ((s.chance ?? 100) >= 100 || this.roll(s.chance)) this.applyStatus(v, s.id, s.turns, ev, u);
    if (ab.mod && !v.ko) for (const k in ab.mod) this.applyMod(v, k, ab.mod[k], ev, u);
    if (ab.dispel) { for (const s of Object.keys(v.statuses)) if (STATUS[s]?.pos) this.removeStatus(v, s, ev); for (const k in v.mods) if (v.mods[k] > 0) v.mods[k] = 0; }
    if (ab.quick) { v.ct = 100; ev.push({ type: 'quick', unit: u, victim: v }); }
    if (ab.steal === 'weapon' && !v.statuses.unarmed) { v.statuses.unarmed = STATUS.unarmed.turns; ev.push({ type: 'status', unit: u, victim: v, status: 'unarmed', name: 'Disarmed', applied: true }); }
    if (ab.pilfer) { const s = Object.keys(v.statuses).find((k) => STATUS[k]?.pos); if (s) { const t = v.statuses[s]; delete v.statuses[s]; u.statuses[s] = t; ev.push({ type: 'status', unit: u, victim: u, status: s, name: STATUS[s].name, applied: true, stolenFrom: v }); } }
    if (ab.knockback && !v.ko && v.hp > 0) this.knockback(u, v, ab, ev);
    if (ab.scatter && !v.ko && v.hp > 0) this.scatter(u, v, ev);
    // KO + reraise
    if (v.hp <= 0 && !v.ko) this.knockOut(v, u, ev);
    // response reactions (after damage), never chaining
    if (damaged && !v.ko && v !== u && this.canReact(v, ctx, u)) {
      const r = v.reaction;
      if (r === 'regenerate' && !v.statuses.regen) { this.applyStatus(v, 'regen', 3, ev, v); this.react(v, r, ev); }
      else if (r === 'mp_restore') { const m = Math.min(v.maxMp - v.mp, Math.floor(v.maxMp * 0.2)); v.mp += m; this.react(v, r, ev, { amount: m }); }
      else if (r === 'reflex_tonic' && v.items?.potion > 0) { v.items.potion--; const h = Math.min(40, v.maxHp - v.hp); v.hp += h; this.react(v, r, ev, { amount: h }); ev.push({ type: 'heal', unit: v, victim: v, amount: h }); }
      else if (r === 'caution') { v.statuses.caution = 1; this.react(v, r, ev); }
      else if (r === 'dragonheart' && v.hp < v.maxHp * 0.25 && !v.statuses.reraise) { v.statuses.reraise = 99; this.react(v, r, ev); ev.push({ type: 'status', unit: v, victim: v, status: 'reraise', name: 'Reraise', applied: true }); }
      else if (r === 'shadowstep' && melee && !v.statuses.vanish) { v.statuses.vanish = 99; this.react(v, r, ev); ev.push({ type: 'status', unit: v, victim: v, status: 'vanish', name: 'Vanish', applied: true }); }
      else if ((r === 'counter' || r === 'counter_tackle') && ab.kind === 'phys' && !u.ko && !u.airborne) {
        const cab = r === 'counter' ? ABILITIES.counter_hit : ABILITIES.tackle; const cr = abilityRange(v, cab);
        if (mdist(u, v) <= cr && (r === 'counter_tackle' ? melee : true)) { this.react(v, r, ev); post.push(() => { this.reactionDepth++; try { ev.push(...this.resolve(v, cab, { x: u.x, z: u.z }, { reaction: true, id: cab.id })); } finally { this.reactionDepth--; } }); }
      }
      else if (r === 'magic_counter' && ab.kind === 'mag' && v.abilityList.includes(ab.id) && abilityMp(v, ab) <= v.mp && !u.ko) {
        this.react(v, r, ev); post.push(() => { v.mp -= abilityMp(v, ab); this.reactionDepth++; try { ev.push(...this.resolve(v, ab, { x: u.x, z: u.z }, { reaction: true, id: ab.id })); } finally { this.reactionDepth--; } });
      }
      else if (r === 'tidal_retort' && !u.ko) { this.react(v, r, ev); post.push(() => { this.reactionDepth++; try { ev.push(...this.resolve(v, ABILITIES.earthsong, { x: u.x, z: u.z }, { reaction: true, id: 'earthsong' })); } finally { this.reactionDepth--; } }); }
      else if (r === 'riposte' && melee && !u.ko && mdist(u, v) <= abilityRange(v, ABILITIES.riposte_hit)) { this.react(v, r, ev); post.push(() => { this.reactionDepth++; try { ev.push(...this.resolve(v, ABILITIES.riposte_hit, { x: u.x, z: u.z }, { reaction: true, id: 'riposte_hit' })); } finally { this.reactionDepth--; } }); }
      else if (r === 'return_fire' && ab.kind === 'phys' && isRanged(u, ab) && !u.ko && mdist(u, v) <= abilityRange(v, ABILITIES.return_shot)) { this.react(v, r, ev); post.push(() => { this.reactionDepth++; try { ev.push(...this.resolve(v, ABILITIES.return_shot, { x: u.x, z: u.z }, { reaction: true, id: 'return_shot' })); } finally { this.reactionDepth--; } }); }
      else if (r === 'frightful_presence' && melee && !u.ko) { this.react(v, r, ev); this.applyStatus(u, 'fear', null, ev, v); }
      else if (r === 'malediction' && melee && !u.ko) { this.react(v, r, ev); this.applyStatus(u, 'poison', null, ev, v); }
      else if (r === 'bestial_instinct' && CLASSES[u.cls].monster && !u.ko) {
        const pool = v.abilityList.concat(v.learned).filter((id) => ABILITIES[id] && ABILITIES[id].kind === 'mag' && abilityMp(v, ABILITIES[id]) <= v.mp && !ABILITIES[id].ct);
        if (pool.length) { const cab = ABILITIES[pool[Math.floor(this.rng() * pool.length)]]; this.react(v, r, ev); post.push(() => { v.mp -= abilityMp(v, cab); this.reactionDepth++; try { ev.push(...this.resolve(v, cab, { x: u.x, z: u.z }, { reaction: true, id: cab.id })); } finally { this.reactionDepth--; } }); }
      }
    }
  }
  knockback(u, v, ab, ev) {
    if (v.movement === 'unyielding_step') return;
    const ox = u.x, oz = u.z; let dx = Math.sign(v.x - ox), dz = Math.sign(v.z - oz);
    if (dx !== 0 && dz !== 0) { if (Math.abs(v.x - ox) >= Math.abs(v.z - oz)) dz = 0; else dx = 0; }
    if (dx === 0 && dz === 0) return;
    const nx = v.x + dx, nz = v.z + dz; const nt = this.map.at(nx, nz), ct = this.map.at(v.x, v.z);
    if (!nt || !nt.walk || unitAt(this.units, nx, nz) || nt.h > ct.h + HEIGHT_STEP) return;
    const from = { x: v.x, z: v.z }; v.x = nx; v.z = nz; ev.push({ type: 'knockback', unit: u, victim: v, from, to: { x: nx, z: nz } });
    const drop = ct.h - nt.h; const mv = MOVEMENTS[v.movement] || {};
    if (drop > HEIGHT_STEP * 2 && !mv.noFall) { const d = Math.max(1, Math.floor(v.maxHp * 0.1)); v.hp = Math.max(0, v.hp - d); ev.push({ type: 'damage', unit: u, victim: v, amount: d, source: 'Fall' }); }
  }
  // Scatter Shot (the prototype moveUnit:'scatter'): the victim is flung to a random free adjacent tile —
  // direction is the rng's, so a seeded sim replays exactly. Same walkability + occupancy gate as
  // a knockback step; no fall damage (the step is level-flat by construction).
  scatter(u, v, ev) {
    if (v.movement === 'unyielding_step') return;
    const free = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: v.x + dx, z: v.z + dz }))
      .filter((t) => { const m = this.map.at(t.x, t.z); return m && m.walk && !unitAt(this.units, t.x, t.z); });
    if (!free.length) return;
    const to = free[Math.floor(this.rng() * free.length)];
    const from = { x: v.x, z: v.z }; v.x = to.x; v.z = to.z;
    ev.push({ type: 'knockback', unit: u, victim: v, from, to });
  }
  knockOut(v, by, ev) {
    if (v.statuses.reraise) { delete v.statuses.reraise; v.hp = Math.max(1, Math.floor(v.maxHp * 0.25)); ev.push({ type: 'reraise', victim: v, amount: v.hp }); return; }
    v.ko = true; v.hp = 0; v.koTurns = 0; v.charging = null; v.airborne = false; v.statuses = {}; v.mods = { atkMod: 0, magMod: 0, defMod: 0, spdMod: 0 }; v.charmedTurn = false;
    ev.push({ type: 'ko', victim: v, by });
  }
  applyStatus(v, id, turns, ev, src) {
    const d = STATUS[id]; if (!d || v.ko) return false;
    if (statusImmune(v, id)) { ev.push({ type: 'status', unit: src, victim: v, status: id, name: d.name, applied: false, why: 'immune' }); return false; }
    if (id === 'stop') { if (v.statuses.stop || (v.charging && (ABILITIES[v.charging.id].ct || 0) >= 6)) { ev.push({ type: 'status', unit: src, victim: v, status: id, name: d.name, applied: false, why: 'resisted' }); return false; } }
    if (d.cancels && v.statuses[d.cancels]) { this.removeStatus(v, d.cancels, ev); ev.push({ type: 'status', unit: src, victim: v, status: id, name: d.name, applied: false, why: 'cancelled' }); return false; }
    if (d.mod) { this.applyMod(v, d.mod, d.neg ? -1 : 1, ev, src); return true; }
    const n = turns ?? d.turns;
    v.statuses[id] = id === 'stop' ? n * Math.ceil(100 / Math.max(1, stat(v, 'spd'))) : n; // Stop counts clock ticks
    ev.push({ type: 'status', unit: src, victim: v, status: id, name: d.name, applied: true });
    return true;
  }
  applyMod(v, key, delta, ev, src) {
    const cap = MOD_CAP[key] || 3; const before = v.mods[key]; v.mods[key] = clamp(before + delta, -cap, cap);
    const names = MOD_STATUS[key] || MOD_STATUS.atkMod; const st = delta > 0 ? names.up : names.down, opp = delta > 0 ? names.down : names.up;
    if (v.mods[key] === 0) { delete v.statuses[st]; delete v.statuses[opp]; } else { v.statuses[st] = STATUS[st].turns; if (Math.sign(v.mods[key]) !== Math.sign(delta)) delete v.statuses[st]; else delete v.statuses[opp]; }
    ev.push({ type: 'status', unit: src, victim: v, status: st, name: STATUS[st].name, applied: v.mods[key] !== before, mod: key, value: v.mods[key] });
  }
  removeStatus(v, s, ev) { if (!(s in v.statuses)) return; delete v.statuses[s]; const d = STATUS[s]; if (d?.mod) v.mods[d.mod] = 0; ev.push({ type: 'statusEnd', unit: v, status: s, name: d?.name || s }); }
  // ---- turn end: CT reset (0 / 20 / 40), duration countdown, facing
  endTurn(u, opts = {}) {
    const ev = []; const acted = u.acted || !!u.charging;
    u.idle = acted ? 0 : (u.idle || 0) + 1;
    u.ct = u.moved && acted ? 0 : (u.moved || acted) ? 20 : 40;
    // Tempo cost of gear (§2.1, classic tactics): each point of Weight over the carry limit is one extra tick before the next turn
    const weight = u.movement === 'heavy_stride' ? 0 : (u.weight || 0);
    const base = u.ct; const tempo = weight ? weight * stat(u, 'spd') : 0;
    if (tempo) u.ct = Math.max(0, u.ct - tempo);
    const skipped = u.ko ? 'ko' : u.statuses.sleep ? 'sleep' : null;
    if (skipped) u.ct = 0; // skipped turns never bank CT
    // Intimidate aura (§3.22): enemies that end a turn beside a Dread Knight lose 1 ATK, stacking to 3
    if (!u.ko) for (const e of this.enemiesOf(u)) if (e.statuses.intimidate && mdist(e, u) === 1 && u.mods.atkMod > -MOD_CAP.atkMod) this.applyMod(u, 'atkMod', -1, ev, e);
    for (const s of Object.keys(u.statuses)) { const d = STATUS[s]; if (!d || d.frozen || s === 'bulwark') continue; if (u.statuses[s] >= 99) continue; u.statuses[s]--; if (u.statuses[s] <= 0) this.removeStatus(u, s, ev); }
    if (u.statuses.charm) this.removeStatus(u, 'charm', ev);
    u.charmedTurn = false;
    if (!u.ko) {
      if (opts.facing != null) u.facing = opts.facing;
      else { const e = this.enemiesOf(u).sort((a, b) => mdist(a, u) - mdist(b, u))[0]; const f = e ? facingFrom(u.x, u.z, e.x, e.z) : null; if (f != null) u.facing = f; }
    }
    this.activeUnit = null; const after = this.totalHp(); this.stallTurns = this.progressed(this._hpBefore, after) ? 0 : this.stallTurns + 1;
    ev.push({ type: 'turnEnd', unit: u, ct: u.ct, reset: base, tempo, skipped }); return ev;
  }
  // Did this turn move the battle toward an end? Only a NEW casualty or real damage counts. The old test
  // was `ko changed`, which a RAISE also satisfies -- so a Necromancer cycling animate_dead pinned stallTurns
  // at 0 forever and the 80-turn stalemate resolution could never fire (one battle ran 1,093 turns to the
  // 4,000-tick cap). Raising is the opposite of progress, so it must not reset the clock.
  // R9: "someone lost HP" was not progress either. A lone Cleric curing herself for 16-32 a turn against a Risen
  // Captain hitting her for 32-35 lost HP every other turn, so the clock never reached the limit and the Chapter I
  // finale ran 758 unit turns to the tick cap. Progress now means a side's standing HP (sum of hp/maxHp over its live
  // units) reaching a NEW LOW -- damage that is healed back and dealt again is a loop, not a battle moving on.
  progressed(before, after) {
    if (after.ko > before.ko || after.gone > before.gone) { this.lowWater = { A: Math.min(after.A, this.lowWater?.A ?? after.A), B: Math.min(after.B, this.lowWater?.B ?? after.B) }; return true; }   // someone fell or crystallised
    const low = this.lowWater || (this.lowWater = { A: before.A, B: before.B }); let p = false;
    for (const t of ['A', 'B']) if (after[t] < low[t] - 0.02) { low[t] = after[t]; p = true; }   // a new low by at least 2% of one unit
    return p;
  }
  totalHp() { const t = { A: 0, B: 0, ko: 0, gone: 0 }; for (const u of this.units) { if (u.removed) { t.gone++; continue; } if (u.ko) t.ko++; else t[u.team] += u.hp / u.maxHp; } return t; }
  checkVictory() {
    const alive = (t) => this.units.some((u) => u.team === t && !u.ko && !u.removed);
    if (this.stallTurns >= this.stallLimit && alive('A') && alive('B')) { // stalemate: nobody has lost HP for stallLimit turns → the healthier side holds the field
      const t = this.totalHp(); this.over = true; this.timeout = true; this.winner = t.A === t.B ? null : t.A > t.B ? 'A' : 'B'; return { over: true, winner: this.winner, timeout: true };
    }
    // Both sides wiped in one resolution -- a self-inclusive AoE or a charged blast that KO'd its own
    // caster alongside the last enemy. That is a legitimate DRAW, distinct from exhausting the tick cap,
    // so it is flagged for callers that must tell the two apart (sim.mjs's invariant, battle.js's banner).
    if (!alive('A') && !alive('B')) { this.over = true; this.winner = null; this.mutual = true; return { over: true, winner: null, mutual: true }; }
    // Objective 'leader' (battle.setObjective): the leader's side loses the moment its leader is down, whoever is left
    // standing. A leader on side A is a "protect" condition; on side B it is the genre's "Defeat <boss>!".
    const L = this.leader();
    if (L && (L.ko || L.removed)) { this.over = true; this.winner = other(L.team); return { over: true, winner: this.winner, leader: true }; }
    const P = this.protected().find((u) => u.ko || u.removed);
    if (P) { this.over = true; this.winner = other(P.team); return { over: true, winner: this.winner, protect: true, fallen: P }; }
    if (!alive('A') || !alive('B')) { this.over = true; this.winner = alive('A') ? 'A' : 'B'; return { over: true, winner: this.winner }; }
    return { over: false };
  }
  setObjective(o) {
    this.objective = o && o.type === 'leader' ? { type: 'leader', leaderId: o.leaderId } : { type: 'rout' };
    if (o?.protect?.length) this.objective.protect = o.protect.slice();
    const L = this.leader(); for (const u of this.units) u.leader = u === L; return this.objective;
  }
  byId(id) { return this.units.find((u) => u.id === id || (u.recordId != null && u.recordId === id)) || null; }
  leader() { const id = this.objective?.type === 'leader' ? this.objective.leaderId : null; return id == null ? null : this.byId(id); }
  protected() { return (this.objective?.protect || []).map((id) => this.byId(id)).filter(Boolean); }
  // Undo a move before acting (classic tactics). Only legal while the unit has not acted and the move changed
  // nothing but the mover itself; snap is what battle.js captured before Engine.move.
  undoMove(u, snap) {
    if (!snap || u.acted || u.charging || !u.moved) return false;
    Object.assign(u, { x: snap.x, z: snap.z, facing: snap.facing, moved: false, movedTiles: 0, mp: snap.mp, movementUsed: snap.movementUsed });
    for (const id of u.grants) { const a = this.units.find((o) => o.id === id); if (a && a.statuses.bulwark) { delete a.statuses.bulwark; a.mods.defMod = snap.defMods?.[id] ?? 0; } }
    u.grants = snap.grants.slice(); return true;
  }
  // ---- REWIND (classic tactics's Chariot Tarot): the whole rules state as plain data, and back. Taken at a turn boundary
  // (battle.js: after advance() hands out a turn, before beginTurn), so a restore followed by advance() hands out the very
  // same turn again. Units are restored IN PLACE (sprites, the UI and the stage director hold unit references); a unit
  // that did not exist at snapshot time (a boss phase summon) is dropped from the roster and returned in `removed`.
  snapshot() {
    const cl = (v) => (v == null || typeof v !== 'object' ? v : structuredClone(v));
    return { v: 1, units: this.units.map(cloneUnit), tick: this.tick, turn: this.turn, round: this.round, roundSeen: [...this._roundSeen], over: this.over, winner: this.winner,
      stallTurns: this.stallTurns, timeout: this.timeout, mutual: this.mutual, lowWater: cl(this.lowWater), hpBefore: cl(this._hpBefore), active: this.activeUnit?.id ?? null,
      objective: cl(this.objective), reactionDepth: this.reactionDepth, rng: typeof this.rng.getState === 'function' ? this.rng.getState() : null, logLen: this.log.length };
  }
  restore(s) {
    const byId = new Map(this.units.map((u) => [u.id, u])); const keep = new Set(); const added = [];
    const out = s.units.map((su) => {
      let u = byId.get(su.id); if (!u) { u = {}; added.push(u); } keep.add(u);
      for (const k of Object.keys(u)) if (!(k in su)) delete u[k];
      for (const k of Object.keys(su)) u[k] = cloneVal(k, su[k]);
      return u;
    });
    const removed = this.units.filter((u) => !keep.has(u));
    this.units.length = 0; this.units.push(...out);
    Object.assign(this, { tick: s.tick, turn: s.turn, round: s.round, over: s.over, winner: s.winner, stallTurns: s.stallTurns, timeout: s.timeout, mutual: s.mutual, reactionDepth: s.reactionDepth || 0 });
    this._roundSeen = new Set(s.roundSeen); this.lowWater = s.lowWater ? { ...s.lowWater } : undefined; if (!s.lowWater) delete this.lowWater;
    this._hpBefore = s.hpBefore ? { ...s.hpBefore } : undefined; this.activeUnit = s.active ? this.units.find((u) => u.id === s.active) || null : null;
    this.objective = s.objective ? structuredClone(s.objective) : this.objective;
    if (s.rng != null && typeof this.rng.setState === 'function') this.rng.setState(s.rng);
    if (this.log.length > (s.logLen ?? this.log.length)) this.log.length = s.logLen;
    return { removed, added };
  }
  // Forecast the next n actors (turns and charge resolutions) without mutating state.
  // `plan` previews a choice the active unit has not made yet (the turn strip's "where do I land" readout):
  // { reset: 0|20|40 } is the CT it will restart from, { charge: ctTicks } queues a charged ability's resolution.
  // Without a plan the active unit is assumed to both move and act (reset 0), as before.
  forecast(n = 8, plan = null) {
    const act = this.activeUnit;
    const sim = this.units.filter((u) => !u.removed).map((u) => ({ u, ct: u.ct, spd: stat(u, 'spd'), ko: u.ko, stop: u.statuses.stop || 0, left: u.charging ? u.charging.left : null, koTurns: u.koTurns })); const out = [];
    if (act && plan) { const s = sim.find((x) => x.u === act); if (s) { if (plan.charge) { s.left = plan.charge; s.planned = true; } } }
    for (let g = 0; g < 400 && out.length < n; g++) {
      const f = sim.find((s) => s.left != null && s.left <= 0 && !s.ko); if (f) { out.push({ unit: f.u, tick: g, charge: true, planned: !!f.planned }); f.left = null; continue; }
      const r = sim.filter((s) => !s.ko && s.ct >= 100 && !s.stop).sort((a, b) => b.ct - a.ct || b.spd - a.spd); if (r.length) { const me = r[0].u === act; out.push({ unit: r[0].u, tick: g, next: me && g > 0 }); r[0].ct = me ? (plan?.reset ?? 0) : 20; continue; }
      for (const s of sim) { if (s.ko) { s.ct += s.spd; if (s.ct >= 100) { s.ct = 0; s.koTurns++; if (s.koTurns >= KO_TURNS) s.ko = 'gone'; } continue; } if (s.stop) { s.stop--; continue; } s.ct += s.spd; if (s.left != null) s.left--; }
    }
    return out;
  }
}
export function tickStatuses() {} // legacy no-op (durations are handled by Engine.endTurn)
// `area` was `ab.area || 0`, which is 0 for every SHAPED ability: cross_cut, holy_cross, rank_break, file_break and
// halo_mend cover 3-9 tiles and the eight `line` abilities cover 3-6, yet all thirteen printed as single-tile hits.
// It stays a NUMBER (player.js tests it for truthiness and concatenates it; nothing in src/ui reads it at all) and
// now carries the shape's reach, with `shape` naming what that reach means — null for a plain diamond, so an
// unshaped ability reports exactly what it always did.
export function abilityInfo(u, id) { const ab = ABILITIES[id]; const use = canUse(u, id); return { id, name: ab.name, mp: abilityMp(u, ab), range: abilityRange(u, ab), area: isShaped(ab) ? shapeReach(ab) : (ab.area || 0), shape: shapeName(ab), ct: abilityCT(u, ab), desc: ab.desc || '', usable: use.ok, why: use.why, item: ab.item ? (u.items?.[id] ?? 0) : null }; }
