// Campaign state logic shared by the shell screens and the battle page: new game, node availability, battle setup
// (who deploys, who they face, where) and the post-battle bookkeeping. No DOM here.
import { BATTLES, NODE, START_ROSTER, START_PARTY, START_FLORINS, START_ITEMS, HIRELINGS, CHAPTERS, TOWNS, ROADS, chOf, setChapter, CH2_START } from './data.js';
import { SAVE_VERSION, writeSave } from './save.js';
import * as PR from './progress.js';
import { ITEMS, ITEM_IDS, SLOT_NAME, invAdd, ensureEquip, planUpgrades, applyPlan, partyTier, enemyTier } from '../game/equipment.js';
import { difficulty } from '../ui/prefs.js';
import { autoSlots } from '../game/progression.js';

export function newGame() {
  const roster = []; const keyToId = {};
  for (const s of START_ROSTER) { const r = PR.newRecruit(s.cls, s.name, s.lvl); r.brv = s.brv ?? r.brv; r.key = s.key; if (s.hero) { r.hero = true; if (s.heroJob) PR.swearHero(r, s.heroJob, { jp: s.heroJp || 0 }); } if (s.gear && r.equip) Object.assign(r.equip, s.gear); roster.push(r); keyToId[s.key] = r.id; }
  for (const r of roster) ensureEquip(r);
  setChapter(1);
  const sv = { v: SAVE_VERSION, created: Date.now(), updated: Date.now(), playMs: 0, chapter: 1, florins: START_FLORINS, roster, inventory: { ...START_ITEMS },
    party: START_PARTY.map((k) => keyToId[k]).filter(Boolean), cleared: {}, seen: {}, at: 'hollin', hired: 0, current: null, last: null };
  writeSave(sv, { backup: false }); return sv;
}

export const isCleared = (sv, id) => (sv.cleared[id] || 0) > 0;
export function nodeState(sv, b) {
  if (!b.needs.every((n) => isCleared(sv, n))) return 'locked';
  if (b.kind === 'side') return isCleared(sv, b.id) ? 'repeat' : 'open';
  return isCleared(sv, b.id) ? 'cleared' : 'open';
}
// ---- chapters & regions (Chapter II): `ch` = the painted region a node sits on. sv.chapter = the furthest chapter entered.
export const visibleNodes = (sv, ch = null) => BATTLES.filter((b) => (ch == null || chOf(b) === ch) && chOf(b) <= (sv.chapter || 1) && nodeState(sv, b) !== 'locked');
export const nextStory = (sv, ch = null) => BATTLES.find((b) => b.kind === 'story' && (ch == null || chOf(b) === ch) && chOf(b) <= (sv.chapter || 1) && nodeState(sv, b) === 'open') || null;
/** Every story battle of chapter `ch` (default: the save's chapter) won. */
export const chapterDone = (sv, ch = sv.chapter || 1) => BATTLES.filter((b) => b.kind === 'story' && chOf(b) === ch).every((b) => isCleared(sv, b.id));
/** Region (chapter number) a node / town / road id sits on. */
export function regionOf(id) { const n = NODE[id] || TOWNS.find((t) => t.id === id) || ROADS.find((r) => r.id === id); return n ? chOf(n) : 1; }
export const visibleRoads = (sv, ch) => ROADS.filter((r) => chOf(r) === ch && (sv.chapter || 1) >= 2);
/** Chapter I is won and Chapter II has not been entered yet (a fresh finale, or a save completed before Chapter II existed). */
export const chapterPending = (sv) => (sv.chapter || 1) < CHAPTERS.length && chapterDone(sv, sv.chapter || 1);
/** Enter the next chapter: bump sv.chapter, pay the chapter's opening purse, move the banner to its first road. */
export function enterChapter(sv) {
  const n = (sv.chapter || 1) + 1; if (!CHAPTERS[n - 1]) return false;
  sv.chapter = n; setChapter(n);
  if (n === 2) { sv.florins += CH2_START.florins; for (const [id, c] of Object.entries(CH2_START.items)) invAdd(sv, id, c); sv.at = CHAPTERS[1].home; }
  writeSave(sv); return true;
}

export function partyRecords(sv) { const byId = new Map(sv.roster.map((r) => [r.id, r])); return sv.party.map((id) => byId.get(id)).filter(Boolean); }
export function avgLevel(recs) { return recs.length ? Math.round(recs.reduce((a, r) => a + r.lvl, 0) / recs.length) : 1; }

// Enemy line-up for a node: story levels are authored, side levels float on the company's average.
// R15: the Options difficulty (src/ui/prefs.js DIFFICULTIES) shifts every foe's level, and tunes team B's AI for the
// battle page (ai.js reads globalThis.AI_TUNE; Normal clears it, so Normal is the shipped game exactly).
// R18 (review17 R3): 'Retry on Story' is a ONE-BATTLE override. It rides in sv.current ({ id, t, diff }) -- set by
// beginBattle(sv, id, { diff }) and dropped by finishBattle (victory, defeat or retreat), so the Options difficulty is
// never touched and the next battle is back on the player's own setting.
export const battleDiffId = (sv, b) => (sv?.current?.diff && sv.current.id === (b?.id ?? b) ? sv.current.diff : null);
export const battleDifficulty = (sv, b) => difficulty(battleDiffId(sv, b) || undefined);
export function enemiesFor(sv, b) {
  const base = b.kind === 'side' ? Math.max(1, avgLevel(partyRecords(sv).length ? partyRecords(sv) : sv.roster)) : 0;
  const d = battleDifficulty(sv, b); globalThis.AI_TUNE = d.ai ? { B: d.ai } : null;
  return b.enemies.map(([cls, lvl, name, over]) => ({ cls, lvl: Math.max(1, Math.min(99, (b.kind === 'side' ? base + lvl : lvl) + (over?.lvlBonus || 0) + d.lvl)),
    name: over?.name || name || PR.className(cls), over: over || null, boss: !!over, hpMul: d.hp }));
}
/** Opts for the battle page / campaignsim: the level kit, plus a boss's overrides (and the difficulty's HP scale). */
export const foeOpts = (e) => { const o = PR.enemyOpts(e.cls, e.lvl, e.over || null); if (e.hpMul && e.hpMul !== 1) o.hpMul = (o.hpMul || 1) * e.hpMul; return o; };

// ---- towns & shops ----
export const townOpen = (sv, t) => (t.needs || []).every((n) => isCleared(sv, n));
export const visibleTowns = (sv, ch = null) => TOWNS.filter((t) => (ch == null || chOf(t) === ch) && chOf(t) <= (sv.chapter || 1) && townOpen(sv, t));
/** Item ids on sale in town `t` right now (stock lines whose `needs` are cleared), in table order. */
export function shopStock(sv, t) {
  const lines = (t?.shop?.stock || []).filter((l) => (l.needs || []).every((n) => isCleared(sv, n)));
  return ITEM_IDS.filter((id) => { const it = ITEMS[id]; if (it.rare) return false;
    return lines.some((l) => l.tiers.includes(it.tier) && (!l.slots || l.slots.includes(it.slot))); });
}
/** Stock that is NOT yet on sale in `t` but will be, with what unlocks it (for the shop's "coming soon" line). */
export function shopNext(sv, t) {
  const l = (t?.shop?.stock || []).find((x) => !(x.needs || []).every((n) => isCleared(sv, n)));
  return l ? { tiers: l.tiers, needs: l.needs.filter((n) => !isCleared(sv, n)).map((n) => NODE[n]?.name || n) } : null;
}
// ---- SHOP NUDGE (R16) ----
// 'New wares' on the world map: what a town's shop sells now that it did not the last time the company walked in
// (sv.seen.wares[town] = the ids on the shelf at that visit -- inside `seen`, which save.validate keeps whole; a shop
// never visited counts everything as new).
export const waresSeen = (sv, t) => sv.seen?.wares?.[t.id] || null;
export function newWares(sv, t) { if (!t?.shop) return []; const seen = new Set(waresSeen(sv, t) || []); return shopStock(sv, t).filter((id) => !seen.has(id)); }
export function markWaresSeen(sv, t) { if (!t?.shop) return; sv.seen = { ...(sv.seen || {}), wares: { ...(sv.seen?.wares || {}), [t.id]: shopStock(sv, t) } }; }
/** Every open shop's shelf (all regions entered so far), with the town that sells each id (the current region's first). */
export function openStock(sv) {
  const from = new Map(); const here = regionOf(sv.at);
  const towns = visibleTowns(sv).filter((t) => t.shop).sort((a, b) => (chOf(a) === here ? 0 : 1) - (chOf(b) === here ? 0 : 1));
  for (const t of towns) for (const id of shopStock(sv, t)) if (!from.has(id)) from.set(id, t);
  return from;
}
/** What the quartermaster would buy and hand out for `party` right now: the planUpgrades() result plus the town to name. */
export function upgradeAdvice(sv, party = partyRecords(sv)) {
  const from = openStock(sv); for (const r of party) ensureEquip(r);
  const a = planUpgrades(sv, party, [...from.keys()]);
  const tally = new Map(); for (const id of a.bought) { const t = from.get(id); if (t) tally.set(t, (tally.get(t) || 0) + 1); }
  const town = [...tally].sort((x, y) => y[1] - x[1])[0]?.[0] || null;
  return { ...a, town, from };
}
/**
 * R18 (review17 P12): the Quartermaster's list as the player reads it -- ONE row per soldier and slot (the planner may
 * step a slot twice, chest piece then a shop piece; only the end state matters: 'Head: Felt Cap -> Iron Sallet'), the
 * soldier named once, the cost summed and its source said ('chest' or the florins). Returns row html for .qm-list.
 */
export function planRowsHtml(plan, { max = 9, esc = (t) => String(t) } = {}) {
  const key = (p) => `${p.rid ?? p.name}|${p.slot}`; const rows = new Map();
  for (const p of plan) { const k = key(p); const r = rows.get(k); if (r) { r.id = p.id; r.price += p.price || 0; } else rows.set(k, { name: p.name, rid: p.rid ?? p.name, slot: p.slot, from: p.from, id: p.id, price: p.price || 0 }); }
  const list = [...rows.values()]; let last = null; const out = [];
  // keep each soldier's rows together, in first-appearance order
  const order = []; for (const r of list) if (!order.includes(r.rid)) order.push(r.rid);
  const sorted = order.flatMap((id) => list.filter((r) => r.rid === id));
  for (const r of sorted.slice(0, max)) {
    const from = r.from && r.from !== r.id ? ITEMS[r.from]?.name : null; const slot = SLOT_NAME[r.slot] || r.slot;
    out.push(`<span class="qm-row"><span class="nm">${r.rid === last ? '' : esc(r.name)}</span><span class="it"><span class="k-dim">${esc(slot)}:</span> ${from ? `${esc(from)}<span class="k-dim">&rarr;</span>` : ''}<b>${esc(ITEMS[r.id]?.name || r.id)}</b></span><span class="g${r.price ? '' : ' chest'}">${r.price ? `${r.price.toLocaleString('en-US')} G` : 'from chest'}</span></span>`);
    last = r.rid;
  }
  if (sorted.length > max) out.push(`<span class="qm-row k-dim"><span></span><span>+${sorted.length - max} more</span><span></span></span>`);
  return out.join('');
}
export function applyAdvice(sv, advice, party = partyRecords(sv)) { const n = applyPlan(sv, party, advice.plan); writeSave(sv); return n; }
/** The party's worn tier against the tier the enemy kit carries at this node's levels (equipment.enemyTier). */
export function gearGap(sv, b, party = partyRecords(sv)) {
  const foes = enemiesFor(sv, b); const lv = Math.round(foes.reduce((t, e) => t + e.lvl, 0) / Math.max(1, foes.length));
  const mine = partyTier(party), theirs = enemyTier(lv); return { mine, theirs, behind: theirs - mine >= 0.75 };
}
/** Everything a campaign shop could stock over the chapter (campaignsim buys from this with the same gates). */
export const allTowns = () => TOWNS;

// ---- spoils ----
/** Item drops for a won battle: n distinct picks from the node's pool, the boss relic on a first clear, a rare roll. */
export function rollSpoils(b, firstClear, rng = Math.random) {
  const out = []; const sp = b?.spoils; if (!sp && !b?.relic) return out;
  if (b.relic && firstClear && ITEMS[b.relic]) out.push({ id: b.relic, rare: true, relic: true });
  const pool = (sp?.pool || []).filter((id) => ITEMS[id]);
  for (let i = 0; i < (sp?.n || 0) && pool.length; i++) out.push({ id: pool.splice(Math.floor(rng() * pool.length), 1)[0] });
  if (sp?.rare && ITEMS[sp.rare.id] && rng() < sp.rare.chance) out.push({ id: sp.rare.id, rare: true });
  return out;
}
export const recLevel = (sv, b) => Math.max(...enemiesFor(sv, b).map((e) => e.lvl));

export function hire(sv) {
  const pick = HIRELINGS[sv.hired % HIRELINGS.length]; if (sv.florins < pick.cost || sv.roster.length >= 16) return null;
  const n = Math.floor(sv.hired / HIRELINGS.length); const name = pick.names[n % pick.names.length] + (n >= pick.names.length ? ` ${Math.floor(n / pick.names.length) + 1}` : '');
  const r = PR.newRecruit(pick.cls, name, Math.max(1, avgLevel(sv.roster) - 1)); try { autoSlots(r); } catch (e) { /* stand-in record */ } sv.florins -= pick.cost; sv.hired++; sv.roster.push(r);
  if (sv.party.length < 5) sv.party.push(r.id);
  writeSave(sv); return r;
}
export const nextHire = (sv) => HIRELINGS[sv.hired % HIRELINGS.length];

// ---- battle hand-off ----
export function beginBattle(sv, id, { diff = null } = {}) { sv.current = { id, t: Date.now(), ...(diff ? { diff } : {}) }; sv.at = id; writeSave(sv); }

/** Called by the battle page when the field is decided. outcome: 'victory' | 'defeat' | 'retreat'. */
export function finishBattle(sv, id, outcome, summary) {
  const b = NODE[id]; const res = { id, outcome, t: Date.now(), turns: summary?.turns || 0, rounds: summary?.rounds || 0, units: [], florins: 0, recruits: [], firstClear: false, stats: {}, ...(battleDiffId(sv, id) ? { diff: battleDiffId(sv, id) } : {}) };
  // PLAYTEST r9: what each soldier actually did (the results screen used to show only EXP/JP, so a player could not
  // tell who carried the fight or who fell).
  for (const [k, u] of Object.entries(summary?.units || {})) if (u && (u.team === 'A' || u.team == null)) res.stats[k] = { kills: u.kills || 0, dmg: u.dmg || 0, heal: u.heal || 0, ko: !!(u.ko || u.kos) };
  if (outcome === 'victory' && b) {
    const deployed = partyRecords(sv); const e = enemiesFor(sv, b);
    // catchup: catch-up EXP only on story battles (grinding side battles must not also pay it).
    const sum = { ...summary, catchup: b.kind === 'story', enemyLvl: summary?.enemyLvl ?? Math.round(e.reduce((a, x) => a + x.lvl, 0) / e.length) };
    try { res.units = PR.applyResults(sv.roster, sum) || []; } catch (err) { console.warn('applyResults failed', err); }
    // keep the deployed order, and show deployed units even if the summary missed one
    const order = new Map(deployed.map((r, i) => [r.id, i]));
    // QA r12: applyResults also returns a row for every benched soldier who took SPILLOVER JP from a deployed ally of the
    // same job (Wren sat out the Old Aqueduct and still got a "+0 EXP, +0 JP (+41)" row), which pushed a sixth row out
    // of the Company Report at 1100x620. The spill is still banked; the report lists only the soldiers who fought.
    const fought = new Set(Object.entries(summary?.units || {}).filter(([, u]) => u && (u.team === 'A' || u.team == null)).map(([k]) => k));
    res.units = res.units.filter((u) => order.has(u.id) || fought.has(u.id));
    res.units.sort((a, b2) => (order.get(a.id) ?? 99) - (order.get(b2.id) ?? 99));
    res.firstClear = !isCleared(sv, id);
    res.florins = res.firstClear ? b.florins : Math.round(b.florins * 0.6);
    sv.florins += res.florins;
    res.drops = rollSpoils(b, res.firstClear); for (const d of res.drops) invAdd(sv, d.id, 1);
    sv.cleared[id] = (sv.cleared[id] || 0) + 1;
    if (b.recruit && res.firstClear && !sv.roster.some((r) => r.key === b.recruit.key)) {
      const r = PR.newRecruit(b.recruit.cls, b.recruit.name, b.recruit.lvl); r.key = b.recruit.key; if (b.recruit.brv) r.brv = b.recruit.brv; try { autoSlots(r); } catch (e) { /* stand-in record */ }
      sv.roster.push(r); res.recruits.push({ id: r.id, name: r.name, cls: r.cls, lvl: r.lvl });
    }
  }
  sv.playMs += Math.max(0, Date.now() - (sv.current?.t || Date.now()));
  sv.current = null; sv.last = res; writeSave(sv); return res;
}
