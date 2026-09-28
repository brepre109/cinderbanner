#!/usr/bin/env node
// Headless campaign simulator (Chapter I, then Chapter II with the party Chapter I produced): plays the campaign's battles on their real maps with the party records built
// exactly as src/campaign/campaign.js + battlelink.js build them (newRecruit -> unitOpts / enemyOpts, spawns from the
// map, the hero flagged), feeds each result through progression.applyResults like finishBattle does, and reports win
// rate, rounds and unit turns per battle. Both sides are driven by ai.js (our "competent human" proxy).
//
//   node src/game/campaignsim.mjs [n=40] [seed=1] [only=b1,s1] [verbose=1] [trace=b1] [buy=1] [jobs=8]
//     n         campaigns to run (each campaign is the whole chapter in order; a lost story battle is retried,
//               like a player would, up to 5 times -- the table reports first-try win rate AND tries)
//     only      restrict the table to these nodes (the campaign still runs everything before them)
//     trace=id  print per-round positions/actions for that node (first campaign only)
//     buy=0     do not spend JP between battles (default 1: greedy buy of the cheapest available action)
//     order     battle order (default b1,s1,b2,b3,s2,b4,b5,b6,b7 then Chapter II c1,s3,c2,c3,s4,c4,s5,c5,c6,c7,c8)
//     ch=1|2    shorthand: only Chapter I's order, or Chapter II's (from a new game unless load= gives a post-Chapter-I roster)
//     save=f    after the last node in `order`, write every campaign's roster/party to f (JSON)
//     load=f    start each campaign from a roster saved by save= (cycled) instead of a new game, e.g.
//               save=/tmp/pre_b6.json order=b1,s1,b2,b3,s2,b4,b5   then   load=/tmp/pre_b6.json order=b6 n=200
//     gear=0    the pre-equipment game: no party kit, no enemy kit, no shopping (legacy units on both sides)
//     shop=0    equipment on, but the company never buys (starter kits, the chest and battle spoils only)
//     firstshop=1  also shop before the FIRST battle (default 0: the new-game flow goes straight from Formation into b1)
//     plvl=N    at the nodes in only= (every node without it), set the deployed five to Lv N first (review17 c5 at Lv 17: plvl=17 only=c5)
//     keep=1    never refresh the party with higher-level recruits;  swap=brannoc:pell  swap roster keys in the first battle's party
//     diff=story|normal|hard   the Options difficulty (src/ui/prefs.js DIFFICULTIES): foe level offset, foe HP, team B AI tune
//     naive=1   R15 'naive player' profile: never learns abilities, never shops, never opens Equip (starter kits; spoils
//               stay in the chest), keeps the starting five. The floor a story node has to hold for a casual player.
//     nudge=1   R16 with naive=1: the same player, but it accepts the SHOP NUDGE whenever the game shows one -- the
//               Formation/Depart 'Optimize from shop' prompt (from the second field on) and the defeat screen's advice
//               (before a retry) -- i.e. equipment.planUpgrades over every open shop + the chest, bought and worn.
//               R17: and the JP NUDGE -- Formation's 'Before you march' (2+ deployed soldiers with JP_NUDGE+ spendable
//               JP: 'Learn recommended for all', the whole company) and the defeat screen's 'Learn recommended' for the
//               deployed five before a retry (progression.recommendLearn / applyLearn). jpnudge=0 turns just this off.
//
// R10 equipment: the company starts with START_FLORINS and START_ITEMS, earns each node's florins (60% on a repeat) and spoils,
// and before every battle goes shopping like a sensible player: every open town's stock (src/campaign/data.js TOWNS),
// greedy on stat value per florins (weapons first), Optimize on the whole party, old gear sold. Enemies wear the level kit
// (progression.enemyOpts) and bosses their authored overrides. The table's `florins`/`kit` columns show what was spent.
import { Engine, CLASSES, ABILITIES, canUse, targetTiles } from './rules.js';
import { decide, pathField } from './ai.js';
import * as PR from './progression.js';
import { BATTLES, NODE, START_ROSTER, START_PARTY, START_FLORINS, START_ITEMS, TOWNS, CH2_START, objectiveFor } from '../campaign/data.js';
import * as EQ from './equipment.js';
import { loadMap } from '../world/mapdata.js';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { difficulty } from '../ui/prefs.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
const NAIVE = +(args.naive || 0); const NUDGE = +(args.nudge || 0); const DIFF = difficulty(args.diff || 'normal');
// R19 (review19 P1): the 'human-like' proxy. The shipped AI on team A plays far better than a person following the
// nudges (R18 claimed >=67% everywhere; the reviewer lost b2, b3 and b7 on Normal). human=<0..1> blurs team A's
// judgement: `noise` misprices each action by up to +-noise of itself (no perfect focus fire), `posNoise` blurs the
// position read (height, exposure, spacing), `facing` is the share of turns that end facing wherever the walk left
// the unit, `blunder` the share of turns spent on a random worthwhile action, `actMove` how often act-then-move is
// even considered, `caution` how much of the AI's threat avoidance survives. human=1 is the level calibrated against
// the reviewer's own results (shots/gameplay19/CALIBRATION.txt); hand=K hands the side back to the AI after K team-A
// turns, the reviewer's own 'hand turns, then Auto-battle' way of playing.
export const humanTune = (h) => (h > 0 ? { noise: 0.5 * h, posNoise: 9 * h, facing: 0.6 * h, blunder: 0.12 * h, actMove: 1 - 0.8 * Math.min(1, h), caution: 1 - 0.4 * Math.min(1, h) } : null);
const HUMAN = +(args.human || 0), HAND = +(args.hand || 0);
const TUNE_A = humanTune(HUMAN);
globalThis.AI_TUNE = (DIFF.ai || TUNE_A) ? { ...(DIFF.ai ? { B: DIFF.ai } : {}), ...(TUNE_A ? { A: TUNE_A } : {}) } : null;
const N = +(args.n || 40), SEED = +(args.seed || 1), VERBOSE = +(args.verbose || 0), BUY = args.buy == null ? (NAIVE ? 0 : 1) : +args.buy;
const TRACE = args.trace || null, ONLY = args.only ? args.only.split(',') : null, JOBS = +(args.jobs || 1);
const CH1 = 'b1,s1,b2,b3,s2,b4,b5,b6,b7', CH2 = 'c1,s3,c2,c3,s4,c4,s5,c5,c6,c7,c8';
const ORDER = (args.order || (args.ch === '1' ? CH1 : args.ch === '2' ? CH2 : `${CH1},${CH2}`)).split(',');
const RETRIES = +(args.retries || 5);
const PLVL = +(args.plvl || 0);   // R18 reviewer proxy: plvl=17 only=c5 fields the deployed five at exactly Lv 17 there (review17's hand-made c5 save)
const GEAR = args.gear == null ? 1 : +args.gear, SHOP = args.shop == null ? (NAIVE ? 0 : 1) : +args.shop;
const KEEP = +(args.keep || NAIVE), FIRSTSHOP = +(args.firstshop || 0);
const SWAP = args.swap ? args.swap.split(',').map((x) => x.split(':')) : null;   // swap=brannoc:pell (first battle's party, like shots/shell/walk.mjs)
const LONG = +(args.long || 0);   // long=150: trace the first battle that runs past 150 unit turns
let longShown = false;

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- campaign.js equivalents (that module imports the vite-only progress.js adapter, so it cannot load in node) ----
function newGame() {
  const roster = []; const keyToId = {};
  for (const s of START_ROSTER) { const r = PR.newRecruit(s.cls, s.name, s.lvl); r.brv = s.brv ?? r.brv; r.key = s.key; if (s.hero) { r.hero = true; if (s.heroJob && !args.nohero) PR.swearHero(r, s.heroJob, { jp: s.heroJp || 0 }); } if (s.gear && r.equip) Object.assign(r.equip, s.gear); if (!GEAR) delete r.equip; roster.push(r); keyToId[s.key] = r.id; }
  return { roster, party: START_PARTY.map((k) => keyToId[k]).filter(Boolean), cleared: {}, florins: START_FLORINS, inventory: GEAR ? { ...START_ITEMS } : {}, spent: 0 };
}
// ---- campaign.js shop / spoils equivalents (same data, same gates) ----
const cleared = (sv, n) => (sv.cleared[n] || 0) > 0;
function stockNow(sv) {
  const out = new Set();
  for (const t of TOWNS) { if (!(t.needs || []).every((n) => cleared(sv, n))) continue;
    for (const l of t.shop?.stock || []) if ((l.needs || []).every((n) => cleared(sv, n))) for (const id of EQ.ITEM_IDS) { const it = EQ.ITEMS[id]; if (!it.rare && l.tiers.includes(it.tier) && (!l.slots || l.slots.includes(it.slot))) out.add(id); } }
  return [...out];
}
function rollSpoils(b, first, rng) {
  const out = []; if (b.relic && first) out.push(b.relic);
  const pool = (b.spoils?.pool || []).slice(); for (let i = 0; i < (b.spoils?.n || 0) && pool.length; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  if (b.spoils?.rare && rng() < b.spoils.rare.chance) out.push(b.spoils.rare.id);
  return out;
}
// A sensible player before a battle: best upgrade per florins across the deployed five (weapons weighted up), buy, wear,
// repeat until nothing affordable helps; then Optimize everyone off the chest and sell what nobody wears (never a relic).
// The nudge (formation.js / results.js 'Optimize from shop'): campaign.upgradeAdvice -> applyPlan, same planner.
function acceptNudge(sv, party) { const a = EQ.planUpgrades(sv, party, stockNow(sv)); if (!a.plan.length) return 0; EQ.applyPlan(sv, party, a.plan); sv.spent += a.cost; sv.nudges = (sv.nudges || 0) + 1; return a.plan.length; }
const JPNUDGE = args.jpnudge == null ? 1 : +args.jpnudge;
function acceptJpNudge(recs) { let n = 0; for (const r of recs) n += PR.applyLearn(r); return n; }
const jpReminder = (party) => party.filter((r) => PR.spareJp(r) >= PR.JP_NUDGE).length >= 2;
function goShopping(sv, party, fresh = false) {
  if (NAIVE && !SHOP) { for (const r of party) { EQ.ensureEquip(r); EQ.fitEquip(sv, r); } if (NUDGE && !fresh) acceptNudge(sv, party); return; }
  for (const r of party) { EQ.ensureEquip(r); EQ.fitEquip(sv, r); EQ.optimize(sv, r); }
  if (!SHOP) return;
  const stock = stockNow(sv);
  for (let g = 0; g < 60; g++) {
    let best = null;
    for (const r of party) for (const s of EQ.SLOTS) {
      const cur = r.equip[s] ? EQ.itemValue(r.cls, r.equip[s], s) : 0;
      for (const id of stock) {
        const it = EQ.ITEMS[id]; if (it.price > sv.florins || (s === 'offhand' && it.slot === 'weapon')) continue;
        if (!EQ.canEquip(r.cls, r.support, id, s, s === 'offhand' ? r.equip.weapon : null)) continue;
        const gain = EQ.itemValue(r.cls, id, s) - cur; if (gain < 2) continue;
        const score = (gain * (s === 'weapon' ? 1.4 : 1)) / Math.sqrt(it.price);
        if (!best || score > best.score) best = { r, s, id, score };
      }
    }
    if (!best) break;
    EQ.buyItem(sv, best.id); sv.spent += EQ.ITEMS[best.id].price; EQ.equipItem(sv, best.r, best.s, best.id);
  }
  for (const r of party) EQ.optimize(sv, r);
  for (const id of Object.keys(sv.inventory)) if (!EQ.ITEMS[id].rare) EQ.sellItem(sv, id, EQ.invCount(sv, id));
}
const partyRecords = (sv) => { const m = new Map(sv.roster.map((r) => [r.id, r])); return sv.party.map((id) => m.get(id)).filter(Boolean); };
const avgLevel = (recs) => (recs.length ? Math.round(recs.reduce((a, r) => a + r.lvl, 0) / recs.length) : 1);
function enemiesFor(sv, b) {
  const base = b.kind === 'side' ? Math.max(1, avgLevel(partyRecords(sv))) : 0;
  return b.enemies.map(([cls, lvl, name, over]) => ({ cls, lvl: Math.max(1, Math.min(99, (b.kind === 'side' ? base + lvl : lvl) + (over?.lvlBonus || 0) + DIFF.lvl)), name: over?.name || name || CLASSES[cls].name, over: over || null }));
}
// A player spends JP between battles. R17 proxy: the value-based pick Formation's 'Learn recommended' makes
// (progression.recommendLearn: strongest affordable action, then R/S/M). learn=cheap restores the old cheapest-first.
const LEARN = args.learn || 'value';
function spendJp(r) { if (LEARN !== 'cheap') { PR.applyLearn(r); return; } for (let g = 0; g < 20; g++) { const l = PR.learnable(r).filter((x) => x.available).sort((a, b) => (a.kind === 'action' ? 0 : 1) - (b.kind === 'action' ? 0 : 1) || a.cost - b.cost); if (!l.length || !PR.buy(r, l[0].id)) break; } }
// A player fields recruits that out-level the weakest starter (the hero always stays).
function refreshParty(sv) {
  const inParty = new Set(sv.party);
  for (const r of sv.roster) {
    if (inParty.has(r.id)) continue; const cur = partyRecords(sv).filter((p) => !p.hero).sort((a, b) => a.lvl - b.lvl)[0];
    if (cur && r.lvl > cur.lvl) { sv.party[sv.party.indexOf(cur.id)] = r.id; inParty.delete(cur.id); inParty.add(r.id); }
  }
}

const maps = new Map();
async function mapFor(id) { if (!maps.has(id)) maps.set(id, await loadMap(id)); return maps.get(id); }

const OFFENCE = new Set(['phys', 'mag', 'debuff']);
export function hasTarget(engine, u) {
  const foes = engine.enemiesOf(u).filter((e) => !e.ko && !e.removed && !e.airborne && !e.statuses.vanish); if (!foes.length) return false;
  const tiles = [{ x: u.x, z: u.z }, ...(engine.canMove(u) ? engine.reach(u).tiles : [])];
  for (const id of u.abilityList) {
    const ab = ABILITIES[id]; if (!ab || ab.hidden || !OFFENCE.has(ab.kind) || !canUse(u, id).ok) continue; const a = ab.area || 0;
    for (const t of tiles) for (const tt of targetTiles({ ...u, x: t.x, z: t.z }, engine.map, ab)) if (foes.some((f) => Math.abs(f.x - tt.x) + Math.abs(f.z - tt.z) <= a)) return true;
  }
  return false;
}
// ---- one battle, the way battle.js drives the engine (advance -> beginTurn -> decide -> move/act -> endTurn) ----
export async function playBattle(map, party, foes, rng, { trace = false, node = null } = {}) {
  const engine = new Engine(map, { rng });
  const stats = new Map(); const st = (u) => { if (!stats.has(u.id)) stats.set(u.id, { kills: 0, dmg: 0, heal: 0, actions: 0, kos: 0 }); return stats.get(u.id); };
  party.forEach((r, i) => { const sp = map.spawns.A[i]; if (!sp) return; engine.addUnit('A', r.cls, sp[0], sp[1], r.name, { ...PR.unitOpts(r), recordId: r.id, leader: !!r.hero }); });
  foes.forEach((e, i) => { const sp = map.spawns.B[i]; if (!sp) return; const o = PR.enemyOpts(e.cls, e.lvl, e.over, !!GEAR); if (DIFF.hp !== 1) o.hpMul = (o.hpMul || 1) * DIFF.hp; engine.addUnit('B', e.cls, sp[0], sp[1], e.name, o); });
  // Chapter II objectives (campaign/data.js objectiveFor): Defeat <boss>, or the captain must not fall.
  if (node?.objective) engine.setObjective(objectiveFor(node, engine.units, party));
  const engaged = new Map(); let idleA = 0, turnsA = 0, clumpA = 0;   // R18: the round each A unit first strikes a foe; A turns spent without an action
  let contact = 0;   // R18: the round the two sides first trade a blow (damage or a miss across teams)
  const track = (ev) => { for (const e of ev) {
    if ((e.type === 'damage' || e.type === 'miss') && e.unit && e.victim && e.unit.team !== e.victim.team) { if (!contact) contact = engine.round || 1; if (e.unit.team === 'A' && !engaged.has(e.unit.id)) engaged.set(e.unit.id, engine.round || 1); }
    if (e.type === 'damage' && e.unit && e.victim && e.unit !== e.victim && e.unit.team !== e.victim.team) st(e.unit).dmg += e.amount;
    else if (e.type === 'ko') { st(e.victim).kos++; if (e.by && e.by.team !== e.victim.team) st(e.by).kills++; } } };
  let guard = 0; const log = [];
  const tr = (s) => { if (trace) log.push(s); };
  let lastRound = 0; let dFace = null;
  // R19 (review19 P6): 'player turns until first available target' -- team-A turns that begin with no foe any of the
  // unit's offensive actions can reach from any tile it can walk to this turn (the reviewer's 'move, no target').
  let openA = 0, openDone = false, turnA = 0;
  if (TUNE_A) globalThis.AI_TUNE = { ...(globalThis.AI_TUNE || {}), A: TUNE_A };
  while (!engine.over && guard++ < 6000) {
    const a = engine.advance(); if (!a) break;
    if (a.kind === 'crystal' || a.kind === 'countdown') continue;
    if (a.kind === 'charge') { const ev = engine.resolveCharge(a.unit); track(ev); tr(`   * ${a.unit.name} charge ${a.unit.charging?.id || ''} lands: ${ev.filter((e) => e.type === 'damage' || e.type === 'miss').map((e) => `${e.victim?.name}${e.type === 'miss' ? ' miss' : ' -' + e.amount}`).join(', ')}`); if (engine.checkVictory().over) break; continue; }
    const u = a.unit;
    if (trace && engine.round !== lastRound) { lastRound = engine.round; }
    track(engine.beginTurn(u));
    if (trace && engine.round !== lastRound) { lastRound = engine.round; tr(`-- round ${engine.round}: ` + engine.alive().map((o) => `${o.name}[${o.team}] ${o.hp}/${o.maxHp} @${o.x},${o.z}h${map.at(o.x, o.z).h}`).join(' | ')); }
    let desc = '';
    if (u.team === 'A' && !u.ko && !u.statuses.sleep) {
      turnA++; if (HAND && turnA > HAND && globalThis.AI_TUNE?.A) { const t = { ...globalThis.AI_TUNE }; delete t.A; globalThis.AI_TUNE = t; }
      if (!openDone) { if (hasTarget(engine, u)) openDone = true; else openA++; }
    }
    if (!u.ko && !u.statuses.sleep) {
      const d = decide(u, engine); dFace = d.facing;
      if (trace && process.env.DBG && engine.turn === +process.env.DBG) { const w = pathField(engine, u, engine.enemiesOf(u)); const r = engine.reach(u);
        console.log('DBG', u.name, u.x, u.z, 'walk here', w(u.x, u.z), 'cands', r.tiles.map((t) => `${t.x},${t.z}:${w(t.x, t.z)}`).join(' '), 'enemies', engine.enemiesOf(u).map((e) => `${e.name}@${e.x},${e.z}`).join(' '), 'pressure round', engine.round, 'stall', engine.stallTurns); }
      const mv = () => { if (d.tile && (d.tile.x !== u.x || d.tile.z !== u.z) && engine.canMove(u)) { const p = engine.reach(u).path(d.tile.x, d.tile.z); if (p) { track(engine.move(u, p)); desc += ` move->${u.x},${u.z}`; } } };
      const ac = () => { if (d.ab && engine.canAct(u)) { st(u).actions++; const ev = engine.act(u, d.ab, d.target); track(ev);
        const tgt = engine.units.find((o) => o.x === d.target.x && o.z === d.target.z && !o.removed);
        desc += ` ${d.ab}@${d.target.x},${d.target.z}${tgt ? '(' + tgt.name + ')' : ''}: ` + ev.filter((e) => e.type === 'damage' || e.type === 'miss' || e.type === 'heal' || e.type === 'charge').map((e) => e.type === 'charge' ? 'charging' : `${e.victim?.name}${e.type === 'miss' ? ' miss' : (e.type === 'heal' ? ' +' : ' -') + e.amount}`).join(','); } };
      if (d.order === 'act-move') { ac(); mv(); } else { mv(); ac(); }
      if (!d.ab) desc += ' (no action)';
      if (u.team === 'A') { turnsA++; if (!d.ab || d.ab === 'wait') idleA++; const L = engine.units.filter((o) => o.team === 'A' && !o.ko && !o.removed); for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) if (Math.abs(L[i].x - L[j].x) + Math.abs(L[i].z - L[j].z) === 1) clumpA++; }
    } else desc = u.ko ? ' KO' : ' asleep';
    track(engine.endTurn(u, { facing: dFace })); dFace = null;   // battle.js takeTurn: the AI's end-of-turn facing is applied
    tr(`  t${engine.turn} ${u.name}[${u.team}] ct-stall ${engine.stallTurns}:${desc}`);
    if (engine.checkVictory().over) break;
  }
  const units = {}; for (const u of engine.units) units[u.recordId ?? u.id] = { ...st(u), ko: u.ko || u.removed, team: u.team, cls: u.cls, lvl: u.lvl, name: u.name };
  const avg = (t) => { const l = engine.units.filter((u) => u.team === t); return l.reduce((s, u) => s + u.lvl, 0) / l.length; };
  return { open: openA, winner: engine.winner, timeout: engine.timeout, turns: engine.turn, rounds: engine.round, contact: contact || engine.round, engage: (() => { const A = engine.units.filter((u) => u.team === 'A'); return A.reduce((t, u) => t + (engaged.get(u.id) ?? engine.round), 0) / Math.max(1, A.length); })(), idle: turnsA ? idleA / turnsA : 0, clump: turnsA ? clumpA / turnsA : 0, ticks: engine.tick, enemyLvl: avg('B'), enemyLvlOf: { A: avg('B'), B: avg('A') }, units,
    koA: engine.units.filter((u) => u.team === 'A' && (u.ko || u.removed)).length, log };
}

async function runCampaign(ci) {
  const rng = mulberry32(SEED * 7919 + ci * 104729);
  const sv = LOADED ? structuredClone(LOADED[ci % LOADED.length]) : newGame(); const rows = [];
  sv.florins ??= START_FLORINS; sv.inventory ??= {}; sv.spent ??= 0;
  for (const id of ORDER) {
    const b = NODE[id]; if (!b) throw new Error('unknown node ' + id);
    // Entering Chapter II (campaign.enterChapter): the Crown's last payment and the quartermaster's chest.
    if ((b.ch || 1) >= 2 && (sv.chapter || 1) < 2) { sv.chapter = 2; sv.florins += CH2_START.florins; if (GEAR) for (const [iid, c] of Object.entries(CH2_START.items)) EQ.invAdd(sv, iid, c); }
    if (BUY) for (const r of sv.roster) spendJp(r);
    if (!KEEP) refreshParty(sv);
    // First battle of a new game: New Game -> story -> Formation -> Depart goes straight into b1, so the company has not
    // seen a shop (nor opened Equip). Parity r13: shopping here was worth 20 points of b1 win rate the player never had.
    const fresh = !Object.values(sv.cleared).some(Boolean);
    if (SWAP && fresh) for (const [out, inn] of SWAP) { const o = sv.roster.find((r) => r.key === out), n = sv.roster.find((r) => r.key === inn); const i = o ? sv.party.indexOf(o.id) : -1; if (i >= 0 && n) sv.party[i] = n.id; }
    for (const r of sv.roster) { if (GEAR) EQ.ensureEquip(r); else delete r.equip; }
    const map = await mapFor(b.map); let tries = 0; let first = null; let res;
    const party = partyRecords(sv).slice(0, 5);
    if (PLVL && (!ONLY || ONLY.includes(id))) for (const r of party) r.lvl = PLVL; const plv = avgLevel(party); const foes = enemiesFor(sv, b).slice(0, 5);
    if (NUDGE && NAIVE && JPNUDGE && jpReminder(party)) { acceptJpNudge(sv.roster); sv.jpNudges = (sv.jpNudges || 0) + 1; }
    if (GEAR && NUDGE && NAIVE) goShopping(sv, party, fresh); else if (GEAR && !(fresh && !FIRSTSHOP)) goShopping(sv, party);
    const kit = GEAR ? party.map((r) => EQ.SLOTS.reduce((t, s) => t + (EQ.ITEMS[r.equip[s]]?.tier || 0), 0)).reduce((a, c) => a + c, 0) / party.length : 0;
    const elv = Math.max(...foes.map((f) => f.lvl));
    do {
      tries++;
      res = await playBattle(map, party, foes, rng, { node: b, trace: (TRACE === id && ci === 0 && tries === 1) || (LONG && !longShown) });
      if (LONG && res.turns < LONG) res.log = []; else if (LONG) longShown = true;
      if (res.log.length) console.log(`\n==== trace ${id} (${b.name}) ====\n` + res.log.join('\n'));
      if (!first) first = res;
      // the defeat screen's advice: gear behind the enemy tier -> Optimize from shop before the retry
      if (NUDGE && NAIVE && JPNUDGE && res.winner !== 'A' && party.some((r) => PR.spareJp(r) > 0)) acceptJpNudge(party);
      if (NUDGE && NAIVE && GEAR && res.winner !== 'A' && EQ.partyTier(party) <= EQ.enemyTier(Math.round(foes.reduce((t, f) => t + f.lvl, 0) / foes.length)) - 0.75) acceptNudge(sv, party);
    } while (res.winner !== 'A' && b.kind === 'story' && tries < RETRIES);
    rows.push({ id, name: b.name, plv, florins: sv.florins, spent: sv.spent || 0, kit, plvs: party.map((r) => r.lvl).join('/'), elv, emean: foes.reduce((s, f) => s + f.lvl, 0) / foes.length, won: first.winner === 'A' ? 1 : 0, open: first.open, timeout: first.timeout ? 1 : 0, rounds: first.rounds, contact: first.contact, engage: first.engage, idle: first.idle, clump: first.clump, turns: first.turns, tries, koA: first.koA, cleared: res.winner === 'A' ? 1 : 0,
      per: Object.values(first.units).map((x) => ({ k: `${x.team}:${x.name}(${x.cls}${x.team === "B" ? " " + x.lvl : ""})`, dmg: x.dmg, kills: x.kills, ko: x.ko ? 1 : 0 })) });
    if (res.winner === 'A') { PR.applyResults(sv.roster, { ...res, enemyLvl: res.enemyLvl, catchup: b.kind === 'story' });
      const firstClear = !sv.cleared[id]; sv.florins += firstClear ? b.florins : Math.round(b.florins * 0.6);
      if (GEAR) for (const d of rollSpoils(b, firstClear, rng)) EQ.invAdd(sv, d);
      sv.cleared[id] = 1;
      if (b.recruit && !sv.roster.some((r) => r.key === b.recruit.key)) { const r = PR.newRecruit(b.recruit.cls, b.recruit.name, b.recruit.lvl); r.key = b.recruit.key; sv.roster.push(r); }
    }
  }
  if (args.save) rows.sv = sv;
  return rows;
}
// load= takes a campaignsim save= file (an array of companies), OR a real game save (shots/review19/save_*.json: one
// company object), OR a localStorage dump ({"cinderbanner.save.v1": "<json>"}) -- so a reviewer's exact party can be replayed.
function loadCompanies(f) {
  let d = JSON.parse(readFileSync(f, 'utf8')); if (d && !Array.isArray(d) && typeof d['cinderbanner.save.v1'] === 'string') d = JSON.parse(d['cinderbanner.save.v1']);
  const l = Array.isArray(d) ? d : [d];
  return l.map((sv) => ({ ...sv, cleared: { ...(sv.cleared || {}) }, spent: sv.spent || 0, inventory: sv.inventory || {} }));
}
const LOADED = args.load ? loadCompanies(args.load) : null;

let all = [];
const t0 = Date.now();
if (args.worker) {
  const start = +args.start; for (let c = start; c < start + N; c++) all.push(await runCampaign(c));
  process.send({ all, svs: all.map((r) => r.sv) }, () => process.exit(0)); await new Promise(() => {});
} else if (JOBS > 1) {
  const per = Math.ceil(N / JOBS); const me = fileURLToPath(import.meta.url);
  const parts = await Promise.all(Array.from({ length: JOBS }, (_, j) => new Promise((res, rej) => {
    const start = j * per, n = Math.min(per, N - start); if (n <= 0) return res({ all: [] });
    const argv = process.argv.slice(2).filter((a) => !/^(jobs|n|start|trace)=/.test(a)).concat([`n=${n}`, `start=${start}`, 'worker=1']);
    const c = fork(me, argv, { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }); let got = null;
    c.on('message', (m) => { got = m; }); c.on('exit', (code) => (got ? res(got) : rej(new Error('worker exited ' + code))));
  })));
  for (const p of parts) { p.all.forEach((r, i) => { r.sv = p.svs?.[i]; }); all.push(...p.all); }
} else for (let c = 0; c < N; c++) all.push(await runCampaign(c));

if (args.save) writeFileSync(args.save, JSON.stringify(all.map((r) => r.sv)));
const by = new Map(); for (const rows of all) for (const r of rows) { if (!by.has(r.id)) by.set(r.id, []); by.get(r.id).push(r); }
const pct = (l, k, q) => { const v = l.map((r) => r[k]).sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(q * v.length))]; };
const m = (l, k) => l.reduce((s, r) => s + r[k], 0) / l.length;
console.log(`\n== campaign sim: ${all.length} campaigns, seed ${SEED}, buy=${BUY}, ${((Date.now() - t0) / 1000).toFixed(1)}s ==`);
console.log(`gear=${GEAR} shop=${SHOP} difficulty=${DIFF.id}${HUMAN ? ` HUMAN-LIKE team A (human=${HUMAN}${HAND ? `, AI after ${HAND} turns` : ''})` : ''}${NAIVE ? ' NAIVE player (no learning, no shop, no Equip, starting five)' : ''}${NAIVE && NUDGE ? ` + accepts the shop nudge${JPNUDGE ? ' and the JP nudge' : ''}` : ''}`);
console.log('node  battle               party lvl        enemy max/mean  win%  open  timeout%  rounds  contact engage idle% clump  turns  tries  party KOs  turns p90/max  kit tier  spent  florins left');
for (const [id, l] of by) {
  if (ONLY && !ONLY.includes(id)) continue; const b = NODE[id];
  const plvs = [...new Set(l.map((r) => r.plvs))]; const plv = m(l, 'plv');
  console.log(`${id.padEnd(5)} ${b.name.padEnd(20)} ${plv.toFixed(1).padStart(4)} (${plvs[0]}${plvs.length > 1 ? '..' : ''})`.padEnd(49) + ` ${String(Math.max(...l.map((r) => r.elv))).padStart(3)}/${m(l, 'emean').toFixed(1).padEnd(6)} ${(100 * m(l, 'won')).toFixed(0).padStart(4)}  ${m(l, 'open').toFixed(1).padStart(4)}  ${(100 * m(l, 'timeout')).toFixed(0).padStart(7)}  ${m(l, 'rounds').toFixed(1).padStart(6)}  ${m(l, 'contact').toFixed(1).padStart(7)} ${m(l, 'engage').toFixed(1).padStart(6)} ${(100 * m(l, 'idle')).toFixed(0).padStart(5)} ${m(l, 'clump').toFixed(2).padStart(5)}  ${m(l, 'turns').toFixed(0).padStart(5)}  ${m(l, 'tries').toFixed(2).padStart(5)}  ${m(l, 'koA').toFixed(1).padStart(5)}      ${String(pct(l, 'turns', 0.9) + '/' + Math.max(...l.map((r) => r.turns))).padEnd(13)}  ${m(l, 'kit').toFixed(1).padStart(8)}  ${m(l, 'spent').toFixed(0).padStart(5)}  ${m(l, 'florins').toFixed(0).padStart(8)}`);
}
if (args.detail) for (const [id, l] of by) {
  if (ONLY && !ONLY.includes(id)) continue; const agg = new Map();
  for (const r of l) for (const p of r.per) { const a = agg.get(p.k) || { dmg: 0, kills: 0, ko: 0, n: 0 }; a.dmg += p.dmg; a.kills += p.kills; a.ko += p.ko; a.n++; agg.set(p.k, a); }
  console.log(`  ${id}: ` + [...agg].map(([k, a]) => `${k} dmg ${(a.dmg / a.n).toFixed(0)} kills ${(a.kills / a.n).toFixed(2)} ko ${(100 * a.ko / a.n).toFixed(0)}%`).join('\n       '));
}
if (VERBOSE) console.log(JSON.stringify(all[0], null, 0));
