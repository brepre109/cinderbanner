// Campaign progression (DESIGN §2.3 learning, §3 unlock tree, §5.2 power curve). Pure data + functions, no DOM:
// the campaign layer (src/campaign/**) keeps an array of these records between battles, turns each one into
// battle.addUnit() opts with unitOpts(), and feeds battle.summary() back through applyResults() afterwards.
//
// Record shape (plain JSON, safe to localStorage):
//   { id, name, cls, lvl, exp, brv,
//     jp:      { [cls]: spendable JP },          jpTotal: { [cls]: JP ever earned in that job (drives job level) },
//     jobLv:   { [cls]: 1..5 },                  learned: { [cls]: [abilityId | 'reaction:x' | 'support:x' | 'movement:x'] },
//     secondary: cls | null, reaction: id | null, support: id | null, movement: id | null,
//     equip:   { weapon, offhand, head, body, acc: itemId | null } }   (src/game/equipment.js; absent = a legacy unit)
//
// Job levels: a job is Lv 1 the moment the unit enters it; Lv 2-5 at 100 / 250 / 450 / 700 cumulative JP in that
// job, and 1000 JP marks it mastered (DESIGN's five thresholds, with entry as Lv 1 so "Footman Lv 2" means 100 JP).
// Action abilities are gated by job level (the signature is Lv 1 and is granted free on entering the job) and bought
// with JP. Every job's Reaction / Support / Movement is also bought here and equips on ANY job afterwards (genre convention).
import { CLASSES, ABILITIES, REACTIONS, SUPPORTS, MOVEMENTS, SKILLSET, LEVEL } from './data.js';
import { levelStats, MAX_LEVEL, makeUnit, stat, weaponPower, weaponRange } from './rules.js';
import { starterKit, enemyKit, ensureEquip, SLOTS } from './equipment.js';

export const JOB_THRESHOLDS = [100, 250, 450, 700];   // cumulative JP for job Lv 2, 3, 4, 5
export const JOB_MASTER = 1000;
export const EXP_PER_LEVEL = 100;
export const JP_PER_ACTION = 10;                        // DESIGN §2.3; x1.5 with JP Boost
export const SPILLOVER = 0.25;
// QA r12: per-battle ceilings. EXP and JP are paid per action, so a battle that drags (the Ravenscar playtest: a lone
// Oathknight on Regen against the fire-drinking Ash-Maw, 58 rounds) paid one soldier 568 EXP and 615 JP -- six levels
// in one fight. A normal battle pays 20-250 EXP (campaignsim), so the caps only ever bite on a stalemate grind.
export const EXP_CAP = 300, JP_CAP = 400;
// R15 (review15 P4): healing pays HEAL_PAY EXP and JP per HP restored (capped per battle), and a won battle lifts every
// deployed soldier to PARTICIPATION x the side's top earner (EXP and JP), KO'd or not.
// R18 (review17 P5): catch-up EXP. A company that plays only the story nodes (review17 went b1 -> b2 -> b3; the naive+nudge
// campaignsim on that path sat 4-5 levels under Chapter II's foes and won 15-60% first try) is pulled back toward the
// field: on a win every soldier below the foes' mean level by more than CATCHUP_FREE levels earns CATCHUP_EXP per level
// of the excess (capped). A company that also plays the side nodes is within a level of par and never sees it.
export const CATCHUP_FREE = 1, CATCHUP_EXP = 50, CATCHUP_CAP = 240;
export const HEAL_PAY = 0.12, HEAL_PAY_CAP = 60, PARTICIPATION = 0.4;                          // the genre: a quarter of every JP gain spills to allies who know the job

// DESIGN §3 "Unlock Req" column. {lv} pairs are job levels; Paladin's requirement is mastery of 2 Knight actions.
// The four the prototype-port classes have no row in §3; their gates follow the job they grew out of.
export const UNLOCKS = {
  footman: [], apothecary: [],
  knight: [['footman', 2]], archer: [['footman', 2]], monk: [['knight', 2]], cleric: [['apothecary', 2]], sorcerer: [['apothecary', 2]],
  chronomancer: [['sorcerer', 2]], thief: [['archer', 2]], earthshaper: [['monk', 2]], wyrmlancer: [['thief', 2]],
  ninja: [['archer', 3], ['thief', 3], ['earthshaper', 2]], blademaster: [['knight', 3], ['monk', 2], ['wyrmlancer', 1]],
  conjurer: [['chronomancer', 2]], mystic: [['cleric', 2]], paladin: [['knight', 'learned2']],
  battlemage: [['sorcerer', 2], ['cleric', 2]], beastsage: [['sorcerer', 1], ['cleric', 1]], gunner: [['apothecary', 2]],
  juggler: [['thief', 2]], assassin: [['ninja', 2], ['thief', 3]], dreadknight: [['knight', 3]], runesword: [['knight', 2], ['sorcerer', 1]],
  warlock: [['mystic', 2], ['sorcerer', 2]],
  guardian: [['knight', 2], ['footman', 3]], hunter: [['archer', 3]], blacksmith: [['footman', 3], ['knight', 2]], necromancer: [['warlock', 2], ['mystic', 2]],
  // R12 hero job: only the company's sworn captain (record.hero) ever sees it, and he holds it from the first battle.
  oathknight: [['hero', 1]],
  // Chapter II: the Bellwarden, the Crown's exorcist order, learned from a Cleric who has touched the dark arts.
  bellwarden: [['cleric', 3], ['mystic', 1]],
};
export const HERO_JOBS = new Set(Object.keys(CLASSES).filter((k) => CLASSES[k].hero));
// Jobs a human unit can hold: the non-monster classes that exist in data.js with a packed sprite sheet.
export const JOBS = Object.keys(CLASSES).filter((k) => !CLASSES[k].monster && CLASSES[k].packed && UNLOCKS[k]);

const actionsOf = (cls) => CLASSES[cls].abilities.filter((id) => id !== 'attack' && ABILITIES[id] && !ABILITIES[id].hidden);
const round10 = (v) => Math.max(10, Math.round(v / 10) * 10);
export function jobLevelFor(total) { let lv = 1; for (const t of JOB_THRESHOLDS) if (total >= t) lv++; return lv; }
// Job level an ability needs: the signature (first in the list) is Lv 1, the rest spread evenly up to Lv 5.
function lvReqFor(cls, id) { const list = actionsOf(cls); const i = list.indexOf(id); return i < 0 ? 1 : Math.min(5, 1 + Math.floor((i * 5) / list.length)); }
function costFor(cls, id) {
  const ab = ABILITIES[id]; const lv = lvReqFor(cls, id);
  return round10(50 + 60 * (lv - 1) + (ab.mp || 0) * 2 + (ab.ct || 0) * 5 + (ab.area || 0) * 20);
}
const SLOT_COST = { reaction: 200, support: 300, movement: 250 };
const SLOT_LV = { reaction: 2, support: 3, movement: 3 };
const slotName = (slot, id) => (slot === 'reaction' ? REACTIONS : slot === 'support' ? SUPPORTS : MOVEMENTS)[id]?.name || id;
const slotDesc = (slot, id) => (slot === 'reaction' ? REACTIONS : slot === 'support' ? SUPPORTS : MOVEMENTS)[id]?.desc || '';
let seq = 0;
const newId = () => `r${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

function ensureJob(r, cls) {
  r.jp[cls] ??= 0; r.jpTotal ??= {}; r.jpTotal[cls] ??= 0; r.jobLv[cls] ??= 1; r.learned[cls] ??= [];
  const sig = actionsOf(cls)[0]; if (sig && !r.learned[cls].includes(sig)) r.learned[cls].push(sig);   // signature: free, job Lv 1
}

// ---------------------------------------------------------------- records
export function newRecruit(cls, name, lvl = 1) {
  if (!CLASSES[cls] || CLASSES[cls].monster) throw new Error('newRecruit: not a job ' + cls);
  const c = CLASSES[cls];
  const r = { id: newId(), name: name || c.name, cls, lvl: Math.max(1, Math.min(MAX_LEVEL, lvl | 0 || 1)), exp: 0, brv: c.brv,
    jp: {}, jpTotal: {}, jobLv: {}, learned: {}, secondary: null, reaction: null, support: null, movement: null };
  ensureJob(r, cls);
  // A recruit arrives trained in its own job: its R/S/M are known and equipped, so a fresh unit fights the way the
  // class was balanced. Everything else in the job, and every other job, is earned.
  for (const slot of ['reaction', 'support', 'movement']) { const id = c[slot]; if (id) { r.learned[cls].push(`${slot}:${id}`); r[slot] = id; } }
  // Veterans recruited above Lv 1 bring JP proportional to their level, all in their own job (spendable).
  if (r.lvl > 1) { const bonus = (r.lvl - 1) * 40; r.jp[cls] += bonus; r.jpTotal[cls] += bonus; r.jobLv[cls] = jobLevelFor(r.jpTotal[cls]); }
  // ...and arrives carrying its job's tier-1 weapon (plus shield) and tier-1 body armour (equipment.starterKit).
  r.equip = starterKit(cls, r.support);
  return r;
}

// R12: make a record the company's sworn captain in his hero job. The Knight he was stays learned (it is where he came
// from, and the Paladin / Blademaster / Dread Knight branches still grow out of it); the Oathknight's R/S/M are known and
// worn. Idempotent: an old save's Aldric gains the job on load (src/campaign/save.js) without losing anything.
export function swearHero(r, cls = [...HERO_JOBS][0], { wear = true, jp = 0 } = {}) {
  if (!cls || !CLASSES[cls]) return r; r.hero = true;
  const fresh = r.jobLv[cls] == null; ensureJob(r, cls);
  if (fresh && jp > 0) { r.jp[cls] += jp; r.jpTotal[cls] += jp; r.jobLv[cls] = jobLevelFor(r.jpTotal[cls]); }
  if (fresh) for (const slot of ['reaction', 'support', 'movement']) { const id = CLASSES[cls][slot]; if (id && !r.learned[cls].includes(`${slot}:${id}`)) r.learned[cls].push(`${slot}:${id}`); }
  if (wear && r.cls !== cls) { const was = r.cls; r.cls = cls; if (r.secondary === cls) r.secondary = null;
    if (fresh) { for (const slot of ['reaction', 'support', 'movement']) r[slot] = CLASSES[cls][slot] || r[slot];
      // his old job's learned actions ride along as the secondary set, so nothing he bought is out of reach
      if (!r.secondary && was && actionsOf(was).some((id) => (r.learned[was] || []).includes(id))) r.secondary = was; } }
  return r;
}

// Opts for battle.addUnit(team, record.cls, x, z, record.name, unitOpts(record)).
export function unitOpts(r) {
  // The signature (first action) is free the moment a unit enters a job, so it is always in the set -- even for a record
  // saved before a rename of that signature (R12: the Oathknight's Emberbrand became Oathfire).
  const order = (cls) => actionsOf(cls).filter((id, i) => (i === 0 && r.jobLv?.[cls] != null) || (r.learned[cls] || []).includes(id));
  const sec = r.secondary && r.secondary !== r.cls && order(r.secondary).length ? r.secondary : null;
  const o = { recordId: r.id, lvl: r.lvl, brv: r.brv, learned: order(r.cls), secondary: sec, secondaryList: sec ? order(sec) : [],
    reaction: r.reaction || null, support: r.support || null, movement: r.movement || null };
  if (r.equip) o.equip = { ...r.equip };   // a record from before equipment existed stays a legacy unit
  return o;
}

// Opts for an enemy of class `cls` at level `lvl`: a learned set that widens with level (the signature at Lv 1,
// a new ability every 3 levels), R/S/M phasing in by Lv 4, and from Lv 8 a secondary set out of the job it was
// promoted from. Monsters always field their whole kit.
//
// Equipment: `gear` (default true) issues the level's kit (equipment.enemyKit: tier 1 to Lv 4, 2 to Lv 7, 3 from Lv 8).
// sim.mjs's prog=1 passes nothing and so fights equipped too; pass gear=false for the pre-equipment enemy.
// `over` is a campaign boss override (src/campaign/data.js enemies[i][3]): { learned, equip (merged over the kit),
// hpMul, sprite, scale, reaction, support, movement, secondary, secondaryList, brv }. lvlBonus is applied by the caller.
export function enemyOpts(cls, lvl = LEVEL, over = null, gear = true) {
  const c = CLASSES[cls]; if (!c) throw new Error('enemyOpts: unknown class ' + cls);
  lvl = Math.max(1, Math.min(MAX_LEVEL, lvl | 0 || 1));
  let o;
  if (c.monster) o = { lvl };
  else {
    const all = actionsOf(cls); const k = Math.min(all.length, 1 + Math.floor(lvl / 3));
    o = { lvl, learned: all.slice(0, k), reaction: lvl >= 2 ? c.reaction : null, support: lvl >= 3 ? c.support : null, movement: lvl >= 4 ? c.movement : null, secondary: null, secondaryList: [] };
    const from = (UNLOCKS[cls] || [])[0]?.[0];
    if (lvl >= 8 && from) { const s = actionsOf(from).slice(0, Math.min(actionsOf(from).length, Math.floor(lvl / 4))); if (s.length) { o.secondary = from; o.secondaryList = s; } }
  }
  if (over) for (const k of ['learned', 'reaction', 'support', 'movement', 'secondary', 'secondaryList', 'brv', 'hpMul', 'sprite', 'scale']) if (over[k] !== undefined) o[k] = Array.isArray(over[k]) ? over[k].slice() : over[k];
  if (gear) { const kit = enemyKit(cls, lvl, o.support ?? c.support); if (kit || over?.equip) o.equip = { ...(kit || {}), ...(over?.equip || {}) }; }
  if (over) o.boss = true;
  return o;
}

// ---------------------------------------------------------------- post-battle
// summary = battle.summary(): { winner, turns, enemyLvl?, units: { [recordId||unitId]: { kills, dmg, heal, actions, ko, team, lvl } } }
// EXP (genre convention): each action is worth 10 + (enemy level - own level), clamped 1..50; each kill is worth that again.
// A deployed unit on the winning side gets +10 for the victory. 100 EXP per level, carried over.
// JP: 10 per action (+50% with JP Boost equipped) + 5 per kill, into the current job. SPILLOVER of every gain goes to
// every other record that has already been in that job, deployed or not.
export function applyResults(records, summary) {
  const byId = new Map(records.map((r) => [r.id, r])); const out = new Map();
  const units = summary?.units || {};
  const row = (r) => { if (!out.has(r.id)) out.set(r.id, { id: r.id, name: r.name, cls: r.cls, expGained: 0, levelsGained: 0, jpGained: 0, spill: 0, jobLevelsGained: 0, unlocked: [], lvl: r.lvl, jobLv: r.jobLv[r.cls] }); return out.get(r.id); };
  const before = new Map(records.map((r) => [r.id, new Set(jobsFor(r).filter((j) => j.unlocked).map((j) => j.cls))]));
  const gainJp = (r, cls, n, res, spill) => {
    ensureJob(r, cls); const lv0 = r.jobLv[cls];
    r.jp[cls] += n; r.jpTotal[cls] += n; r.jobLv[cls] = jobLevelFor(r.jpTotal[cls]);
    if (cls === r.cls) { if (spill) res.spill += n; else res.jpGained += n; res.jobLevelsGained += r.jobLv[cls] - lv0; }
  };
  const spills = []; const sideMean = new Map();
  for (const t of ['A', 'B']) { const l = Object.entries(units).filter(([k, x]) => x.team === t && byId.has(k)).map(([k]) => byId.get(k).lvl); if (l.length) sideMean.set(t, l.reduce((a, b) => a + b, 0) / l.length); }
  // R15 support pay: heals and buffs are actions like any other, but a Cleric's turn that saves a life was worth one
  // swing's EXP while the Lancer beside her banked kills on top. Healing done now pays EXP and JP of its own (HEAL_PAY
  // per point, capped), and on a win every soldier who took the field is lifted to a PARTICIPATION floor of the top
  // earner's haul (review15 P4: Seren +0 JP in a won battle, mages Lv 2 while the Lancer reached Lv 6).
  const pay = [];
  for (const [key, s] of Object.entries(units)) {
    const r = byId.get(key); if (!r) continue; const res = row(r);
    const enemyLvl = summary.enemyLvlOf?.[s.team] ?? summary.enemyLvl ?? r.lvl; const diff = enemyLvl - r.lvl; const per = Math.max(1, Math.min(50, 10 + Math.round(diff)));
    const won = summary.winner && s.team === summary.winner;
    // R10 catch-up: a soldier who took the field below the side's mean level gets +12 EXP per level of gap on a win.
    // Slow jobs (a SPD-L Knight acts ~2/3 as often) otherwise fall behind, and a level behind means fewer turns again.
    const mean = sideMean.get(s.team) ?? r.lvl; const lag = won ? Math.max(0, Math.round(mean - r.lvl)) * 12 : 0;
    const healPay = Math.min(HEAL_PAY_CAP, Math.round((s.heal || 0) * HEAL_PAY));
    const exp = Math.min(EXP_CAP, per * ((s.actions || 0) + (s.kills || 0)) + healPay + (won ? 10 : 0)) + lag;
    const boost = r.support === 'jp_boost' ? 1.5 : 1;
    const jp = Math.min(JP_CAP, Math.round((JP_PER_ACTION * (s.actions || 0) + 5 * (s.kills || 0) + healPay) * boost));
    pay.push({ r, res, s, won, exp, jp, boost });
  }
  for (const t of ['A', 'B']) {
    const side = pay.filter((p) => p.s.team === t && p.won); if (!side.length) continue;
    const topE = Math.max(...side.map((p) => p.exp)), topJ = Math.max(...side.map((p) => p.jp));
    for (const p of side) { p.exp = Math.max(p.exp, Math.round(topE * PARTICIPATION)); p.jp = Math.max(p.jp, Math.round(topJ * PARTICIPATION * p.boost)); }
  }
  // Story nodes only: a side node's foes are scaled ABOVE the company on purpose (campaign.enemiesFor: avg + offset), so
  // finishBattle passes catchup: b.kind === 'story' (summary.catchup === false skips it).
  if (summary.catchup !== false) for (const p of pay) if (p.won) { const gap = (summary.enemyLvlOf?.[p.s.team] ?? summary.enemyLvl ?? p.r.lvl) - p.r.lvl - CATCHUP_FREE; if (gap > 0) p.exp += Math.min(CATCHUP_CAP, Math.round(gap * CATCHUP_EXP)); }
  for (const { r, res, exp, jp } of pay) {
    res.expGained = exp; r.exp += exp;
    while (r.exp >= EXP_PER_LEVEL && r.lvl < MAX_LEVEL) { r.exp -= EXP_PER_LEVEL; r.lvl++; res.levelsGained++; }
    if (r.lvl >= MAX_LEVEL) r.exp = Math.min(r.exp, EXP_PER_LEVEL - 1);
    if (jp > 0) { gainJp(r, r.cls, jp, res, false); spills.push([r, r.cls, jp]); }
  }
  for (const [src, cls, jp] of spills) {
    const n = Math.floor(jp * SPILLOVER); if (!n) continue;
    for (const r of records) if (r !== src && r.jobLv[cls] != null) { const res = row(r); gainJp(r, cls, n, res, true); }
  }
  for (const r of records) {
    if (!out.has(r.id)) continue; const res = out.get(r.id);
    res.lvl = r.lvl; res.jobLv = r.jobLv[r.cls];
    res.unlocked = jobsFor(r).filter((j) => j.unlocked && !before.get(r.id).has(j.cls)).map((j) => j.cls);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------- jobs
function reqMet(r, [cls, lv]) {
  if (cls === 'hero') return !!r.hero;
  if (lv === 'learned2') return actionsOf(cls).filter((id) => (r.learned[cls] || []).includes(id)).length >= 2;
  return (r.jobLv[cls] ?? 0) >= lv;
}
export function jobsFor(r) {
  return JOBS.filter((cls) => !HERO_JOBS.has(cls) || r.hero || r.jobLv[cls] != null).map((cls) => {
    const reqs = UNLOCKS[cls].map(([rc, lv]) => (rc === 'hero' ? { cls: rc, name: 'Sworn captain', lv: null, learned: null, met: reqMet(r, [rc, lv]), text: 'The Ember Oath' }
      : { cls: rc, name: CLASSES[rc].name, lv: lv === 'learned2' ? null : lv, learned: lv === 'learned2' ? 2 : null, met: reqMet(r, [rc, lv]),
      text: lv === 'learned2' ? `Learn 2 ${CLASSES[rc].name} abilities` : `${CLASSES[rc].name} Lv ${lv}` }));
    return { cls, name: CLASSES[cls].name, role: CLASSES[cls].role, skillset: SKILLSET[cls] || CLASSES[cls].name, current: r.cls === cls,
      unlocked: r.jobLv[cls] != null || reqs.every((q) => q.met), jobLv: r.jobLv[cls] ?? 0, jp: r.jp[cls] ?? 0, reqs,
      mastered: (r.jpTotal?.[cls] ?? 0) >= JOB_MASTER };
  });
}
export function setJob(r, cls) {
  const j = jobsFor(r).find((x) => x.cls === cls); if (!j || !j.unlocked) return false;
  if (r.cls === cls) return true;
  r.cls = cls; ensureJob(r, cls);
  if (r.secondary === cls) r.secondary = null;
  return true;
}
export function setSecondary(r, cls) {
  if (cls == null) { r.secondary = null; return true; }
  if (cls === r.cls || !actionsOf(cls).some((id) => (r.learned[cls] || []).includes(id))) return false;
  r.secondary = cls; return true;
}
// slot: 'reaction' | 'support' | 'movement'; id null unequips. Any job's learned R/S/M may be equipped.
export function equip(r, slot, id) {
  if (!SLOT_COST[slot]) return false;
  if (id == null) { r[slot] = null; return true; }
  if (!Object.values(r.learned).some((l) => l.includes(`${slot}:${id}`))) return false;
  r[slot] = id; return true;
}
export function equippable(r) {
  const out = { secondary: [], reaction: [], support: [], movement: [] };
  for (const [cls, l] of Object.entries(r.learned)) {
    if (cls !== r.cls && actionsOf(cls).some((id) => l.includes(id))) out.secondary.push({ cls, name: SKILLSET[cls] || CLASSES[cls].name });
    for (const e of l) { const [slot, id] = e.split(':'); if (id && out[slot]) out[slot].push({ id, name: slotName(slot, id), desc: slotDesc(slot, id), from: cls }); }
  }
  return out;
}

// ---------------------------------------------------------------- the JP shop (current job)
export function learnable(r, cls = r.cls) {
  ensureJob(r, cls); const lv = r.jobLv[cls]; const have = r.learned[cls]; const jp = r.jp[cls];
  const acts = actionsOf(cls).map((id) => { const ab = ABILITIES[id]; const lvReq = lvReqFor(cls, id); const cost = costFor(cls, id); const learned = have.includes(id);
    return { id, kind: 'action', name: ab.name, desc: ab.desc || '', cost, learned, lvReq, available: !learned && lv >= lvReq && jp >= cost, mp: ab.mp || 0 }; });
  const c = CLASSES[cls]; const rsm = [];
  for (const slot of ['reaction', 'support', 'movement']) {
    const sid = c[slot]; if (!sid) continue; const id = `${slot}:${sid}`; const learned = have.includes(id); const lvReq = SLOT_LV[slot];
    const cost = sid === 'jp_boost' ? 150 : SLOT_COST[slot];
    rsm.push({ id, kind: slot, name: slotName(slot, sid), desc: slotDesc(slot, sid), cost, learned, lvReq, available: !learned && lv >= lvReq && jp >= cost });
  }
  return acts.concat(rsm);
}
export function buy(r, abilityId, cls = r.cls) {
  const it = learnable(r, cls).find((x) => x.id === abilityId); if (!it || !it.available) return false;
  r.jp[cls] -= it.cost; r.learned[cls].push(abilityId); return true;
}

// ---------------------------------------------------------------- helpers for menus
// Menu stats are read off a real unit built from the record (so supports, movement and every piece of gear count exactly as
// they will in battle). `equip` overrides the record's own gear, which is how the Equip / Shop compare views ask "what if".
export function recordStats(r, equip) {
  const o = unitOpts(r); if (equip !== undefined) o.equip = equip ? { ...equip } : undefined;
  let u; try { u = makeUnit('rec', 'A', r.cls, 0, 0, r.name, { ...o, rng: () => 0 }); } catch { const s = levelStats(r.cls, r.lvl); return { ...s, move: CLASSES[r.cls].move, jump: CLASSES[r.cls].jump, brv: r.brv }; }
  const out = { hp: u.maxHp, mp: u.maxMp, brv: r.brv, wp: weaponPower(u), range: weaponRange(u), weight: u.weight };
  for (const k of ['atk', 'def', 'mag', 'res', 'spd', 'eva', 'move', 'jump']) out[k] = stat(u, k);
  return out;
}
export { ensureEquip, SLOTS as EQUIP_SLOTS };
export function skillsetName(cls) { return SKILLSET[cls] || CLASSES[cls]?.name || cls; }

// ---------------------------------------------------------------- R17 JP NUDGE
// A casual player never opens Learn Abilities (campaignsim naive=1: every soldier fights the whole campaign on its
// signature). Formation flags the JP, offers 'Learn recommended' per soldier and for the whole company, and asks once
// at Depart ('Before you march') when two or more soldiers sit on JP_NUDGE+ of it. The picks come from a simple value
// heuristic: the job's strongest affordable action first (again and again while the JP lasts), then its R/S/M.
export const JP_NUDGE = 100;
/** Rough worth of one action for the heuristic: payload x bodies it reaches, discounted by MP and charge time. */
export function actionValue(id) {
  const ab = ABILITIES[id]; if (!ab) return 0;
  const area = ab.area || 0; const bodies = Math.min(3.4, 1 + area * 1.2 + (ab.line ? 1.2 : 0) + (ab.chain ? 1.4 : 0) + (ab.cone ? 1.2 : 0));
  let v;
  if (ab.kind === 'phys') v = (ab.mult || 1) * 10 * (ab.hits ? Math.min(ab.hits, 4) * 0.75 : 1);
  else if (ab.kind === 'mag') v = (ab.power || 8) * 0.9 * (ab.falloff ? 0.85 : 1);
  else if (ab.kind === 'heal') v = (ab.power || 5) * 0.8 + (ab.cureAll || (ab.cures || ab.cure || []).length ? 3 : 0);
  else if (ab.kind === 'raise') v = 30;
  else v = 7;
  if (ab.status || ab.statuses || ab.mod) v += 3;
  if (ab.kind === 'raise') return v * (area ? 1.3 : 1) / (1 + (ab.mp || 0) / 60);
  return (v * bodies) / (1 + (ab.mp || 0) / 40 + (ab.ct || 0) / 8);
}
const RSM_ORDER = { reaction: 0, support: 1, movement: 2 };
/** What 'Learn recommended' would buy for r in its current job, in order: [{ id, kind, name, cost }]. Pure (works on a copy). */
export function recommendLearn(r) {
  const t = structuredClone(r); const picks = [];
  for (let g = 0; g < 24; g++) {
    const av = learnable(t).filter((x) => x.available); if (!av.length) break;
    const acts = av.filter((x) => x.kind === 'action').sort((a, b) => actionValue(b.id) - actionValue(a.id) || a.cost - b.cost);
    const it = acts[0] || av.sort((a, b) => RSM_ORDER[a.kind] - RSM_ORDER[b.kind] || a.cost - b.cost)[0];
    if (!buy(t, it.id)) break; picks.push({ id: it.id, kind: it.kind, name: it.name, cost: it.cost });
  }
  return picks;
}
/** Buy the picks (recommendLearn's list) and fill any empty R/S/M slot; returns the number learned. */
export function applyLearn(r, picks = recommendLearn(r)) { let n = 0; for (const p of picks) if (buy(r, p.id)) n++; autoSlots(r); return n; }
/** Unspent JP in the current job, if something is learnable with it right now (else 0). */
export function spareJp(r) { try { return learnable(r).some((x) => x.available) ? (r.jp?.[r.cls] ?? 0) : 0; } catch (e) { return 0; } }
// Sensible defaults for an empty slot: the current job's own pick if known, else the first known from this list.
const SLOT_PREF = {
  reaction: ['counter', 'regenerate', 'reflex_tonic', 'parry', 'dragonheart', 'mana_shield', 'deflect_arrows', 'reflex', 'aegis', 'spell_ward', 'magic_counter', 'mp_restore', 'caution'],
  support: ['fortify', 'defense_boost', 'healing_boost', 'arcane_focus', 'concentrate', 'martial_arts', 'doublehand', 'equip_shields', 'equip_heavy', 'half_mp', 'jp_boost'],
  movement: ['move_plus1', 'move_plus2', 'pilgrims_step', 'vanguard', 'fleet_foot', 'jump_plus2', 'ignore_height'],
};
/** Fill an empty Reaction / Support / Movement slot with the best one the unit knows (recruits arrive ready to fight). */
export function autoSlots(r) {
  const known = equippable(r); let n = 0;
  for (const slot of ['reaction', 'support', 'movement']) {
    if (r[slot]) continue; const ids = known[slot].map((e) => e.id); if (!ids.length) continue;
    const own = CLASSES[r.cls]?.[slot]; const pick = (own && ids.includes(own)) ? own : SLOT_PREF[slot].find((x) => ids.includes(x)) || ids[0];
    if (equip(r, slot, pick)) n++;
  }
  return n;
}
