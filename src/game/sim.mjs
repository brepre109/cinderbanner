#!/usr/bin/env node
// Headless AI-vs-AI battle simulator with rule invariants. No DOM, no three.js.
//   node src/game/sim.mjs [n=100] [seed=1] [A=cls,cls,...] [B=cls,cls,...] [roster=default|mirror|random|all|packed|randmirror] [verbose=1] [maxTicks=4000] [duel=1]
//        [jobs=8]                 fan the battles out over N worker processes (same seeds, same results, merged report)
//        [lvlNew=13] [lvlOld=10]  level test: the "new" side fields units at lvlNew, the other at lvlOld (progression §5.2)
//        [aiOld=path/to/ai.js]    AI A/B: the "old" side decides with that module's decide(), the new side with ./ai.js
//        [prog=1]                 both sides use progression.enemyOpts(cls, lvl) learned sets instead of full kits
// With lvlNew / aiOld set, the "new" side alternates A/B every 2 battles and the rosters every battle, so spawn side and
// roster both cancel out; the report prints the new side's win rate.
// `duel=1` runs a 1v1 class-vs-class arena instead (every ordered pair, n battles each) and prints the win matrix summary.
// Exits non-zero on any invariant violation. Prints win rate, round/turn counts, ability usage and per-class balance.
import { Engine, CLASSES, ABILITIES, STATUS, PACKED_CLASSES, KO_TURNS, hitChance, stat } from './rules.js';
import { decide } from './ai.js';
import { enemyOpts } from './progression.js';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
const JOBS = +(args.jobs || 1), START = +(args.start || 0), WORKER = !!args.worker;
const LVL_NEW = args.lvlNew != null ? +args.lvlNew : null, LVL_OLD = args.lvlOld != null ? +args.lvlOld : null, PROG = +(args.prog || 0);
const decideOld = args.aiOld ? (await import(new URL(args.aiOld, 'file://' + process.cwd() + '/').href)).decide : null;
const VARIANT = LVL_NEW != null || !!decideOld;
if (args.flags != null) globalThis.AI_FLAGS = args.flags;   // ai.js feature toggles for A/B work (letters, see ai.js FL)
const newSide = (i) => (Math.floor(i / 2) % 2 ? 'B' : 'A');
const N = +(args.n || 100), SEED = +(args.seed || 1), ROSTER = args.roster || 'default', VERBOSE = +(args.verbose || 0), MAX_TICKS = +(args.maxTicks || 4000);

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Map: the authored battlefield if it imports cleanly, else DESIGN §5.3's 12×12 flat-plus-two-heights prototype map.
async function loadMap() {
  try { const m = await import('../world/mapdata.js'); if (m.MAP?.at && m.MAP.spawns) return m.MAP; } catch (e) { if (VERBOSE) console.log('mapdata unavailable, using test map:', e.message); }
  const w = 12, d = 12; const tiles = []; for (let z = 0; z < d; z++) { const row = []; for (let x = 0; x < w; x++) { const h = (x >= 4 && x <= 7 && z >= 4 && z <= 7) ? 4 : (x >= 5 && x <= 6 && z >= 5 && z <= 6) ? 8 : 0; const t = (x === 2 && z >= 3 && z <= 8) ? 'w' : 'g'; row.push({ x, z, h, t, water: t === 'w', walk: t !== 'w' }); } tiles.push(row); }
  return { name: 'Proto', w, d, tiles, at: (x, z) => (x >= 0 && z >= 0 && x < w && z < d ? tiles[z][x] : null), spawns: { A: [[1, 10], [2, 10], [3, 10], [1, 9], [3, 9]], B: [[10, 1], [9, 1], [8, 1], [10, 2], [8, 2]] } };
}
// The shipped 5v5 (src/main.js). Override on the command line with A=knight,archer,... B=ninja,...
const DEFAULT = { A: (args.A || 'knight,archer,sorcerer,cleric,wyrmlancer').split(','), B: (args.B || 'ninja,warlock,gunner,skeleton,wyrm').split(',') };
for (const t of ['A', 'B']) for (const c of DEFAULT[t]) if (!CLASSES[c]) { console.error('unknown class in roster ' + t + ': ' + c); process.exit(2); }
function rosterFor(i, rng) {
  if (ROSTER === 'default') return i % 2 ? { A: DEFAULT.B, B: DEFAULT.A } : DEFAULT; // alternate sides so spawn advantage cancels out
  if (ROSTER === 'mirror') return { A: DEFAULT.A, B: DEFAULT.A };
  // randmirror: a random packed five fielded by BOTH sides — composition cancels, so only the AI (or level) differs
  if (ROSTER === 'randmirror') { const pool = PACKED_CLASSES; const t = Array.from({ length: 5 }, () => pool[Math.floor(rng() * pool.length)]); return { A: t, B: t.slice() }; }
  const pool = ROSTER === 'all' ? Object.keys(CLASSES).filter((k) => !CLASSES[k].monster) : ROSTER === 'packed' ? PACKED_CLASSES : Object.keys(CLASSES);
  const pick = () => Array.from({ length: 5 }, () => pool[Math.floor(rng() * pool.length)]);
  return { A: pick(), B: pick() };
}

class Violations { constructor() { this.list = []; } add(battle, msg) { this.list.push(`battle ${battle}: ${msg}`); if (VERBOSE) console.log('VIOLATION', battle, msg); } }
const viol = new Violations();
const numOk = (v) => typeof v === 'number' && Number.isFinite(v);
function checkUnits(engine, b, where) {
  const seen = new Map();
  for (const u of engine.units) {
    for (const k of ['hp', 'maxHp', 'mp', 'maxMp', 'ct', 'x', 'z', 'koTurns', 'facing']) if (!numOk(u[k])) viol.add(b, `${where}: ${u.name}.${k} is ${u[k]}`);
    for (const k in u.mods) if (!numOk(u.mods[k]) || Math.abs(u.mods[k]) > 3) viol.add(b, `${where}: ${u.name}.mods.${k}=${u.mods[k]}`);
    if (u.hp < 0 || u.hp > u.maxHp) viol.add(b, `${where}: ${u.name} hp ${u.hp}/${u.maxHp}`);
    if (u.mp < 0 || u.mp > u.maxMp) viol.add(b, `${where}: ${u.name} mp ${u.mp}/${u.maxMp}`);
    if (u.ct < 0) viol.add(b, `${where}: ${u.name} ct ${u.ct}`);
    if (u.facing < 0 || u.facing > 3) viol.add(b, `${where}: ${u.name} facing ${u.facing}`);
    if (u.ko && u.hp !== 0) viol.add(b, `${where}: ${u.name} KO with hp ${u.hp}`); if (!u.ko && u.hp <= 0 && !u.removed) viol.add(b, `${where}: ${u.name} alive at 0 hp`);
    if (u.koTurns > KO_TURNS) viol.add(b, `${where}: ${u.name} koTurns ${u.koTurns}`); if (u.koTurns >= KO_TURNS && !u.removed) viol.add(b, `${where}: ${u.name} not removed after ${KO_TURNS} KO turns`);
    const t = engine.map.at(u.x, u.z); if (!t) viol.add(b, `${where}: ${u.name} off map at ${u.x},${u.z}`); else if (!t.walk && !(u.movement === 'terrain_walker' || u.statuses.float)) viol.add(b, `${where}: ${u.name} on unwalkable tile ${u.x},${u.z}`);
    for (const s in u.statuses) { if (!STATUS[s]) viol.add(b, `${where}: ${u.name} unknown status ${s}`); if (!numOk(u.statuses[s]) || u.statuses[s] <= 0) viol.add(b, `${where}: ${u.name} status ${s} counter ${u.statuses[s]}`); }
    if (u.statuses.haste && u.statuses.slow) viol.add(b, `${where}: ${u.name} has Haste and Slow`);
    if (!u.ko && !u.removed && !u.airborne) { const k = u.x + ',' + u.z; if (seen.has(k)) viol.add(b, `${where}: two live units on ${k}: ${seen.get(k)} + ${u.name}`); seen.set(k, u.name); }
    if (u.charging && (!numOk(u.charging.left) || !ABILITIES[u.charging.id])) viol.add(b, `${where}: ${u.name} bad charge`);
    for (const k of ['atk', 'def', 'mag', 'res', 'spd', 'move', 'jump', 'eva']) if (!numOk(stat(u, k))) viol.add(b, `${where}: ${u.name} stat ${k} NaN`);
  }
}
function checkEvents(engine, b, ev, actor) {
  for (const e of ev) {
    if (e.type === 'damage') { const v = e.victim; if (!numOk(e.amount) || e.amount < 0) viol.add(b, `damage amount ${e.amount}`); const cap = ((e.ability?.ct || 0) >= 4 ? 1.5 : 1.0) * v.maxHp; if (e.amount > cap + 1e-9) viol.add(b, `damage ${e.amount} exceeds cap ${cap} on ${v.name} (${e.ability?.name || e.source})`); }
    if (e.type === 'heal' && (!numOk(e.amount) || e.amount < 0)) viol.add(b, `heal amount ${e.amount}`);
    if (e.type === 'miss' && (e.chance < 0 || e.chance > 100)) viol.add(b, `hit% ${e.chance} out of range`);
    if (e.type === 'reaction' && e.unit === actor && !e.reaction.startsWith('absorb')) viol.add(b, `reaction by the acting unit ${actor.name}`);
    if (e.type === 'knockback') { const t = engine.map.at(e.to.x, e.to.z); const v = e.victim; if (!t || (!t.walk && !(v && (v.movement === 'terrain_walker' || v.statuses.float)))) viol.add(b, `knockback onto bad tile`); }
  }
}
// hit% clamp check over every attacker/target/ability pair at a moment in time
function checkHitClamp(engine, b) { const live = engine.alive(); for (const a of live) for (const v of live) for (const id of a.abilityList) { const h = hitChance(a, v, ABILITIES[id], engine.map); if (!numOk(h) || h < 0 || h > 100) viol.add(b, `hit% ${h} for ${a.name} ${id} → ${v.name}`); } }

async function runBattle(i, map, rng) {
  const engine = new Engine(map, { rng, maxTicks: MAX_TICKS }); const r = rosterFor(i, rng);
  const ns = newSide(i);
  for (const team of ['A', 'B']) for (let k = 0; k < 5; k++) { const [x, z] = map.spawns[team][k]; const cls = r[team][k];
    const lvl = team === ns ? LVL_NEW : LVL_OLD; const o = PROG ? enemyOpts(cls, lvl ?? 10) : lvl != null ? { lvl } : {};
    engine.addUnit(team, cls, x, z, `${cls}${team}${k}`, o); }
  const pick = (u) => (decideOld && engine.teamOf(u) !== ns ? decideOld : decide);
  const stats = { turns: 0, charges: 0, reactions: 0, kos: 0, raises: 0, use: {}, dmgByCls: {}, killsByCls: {}, deathsByCls: {}, statusApplied: 0, misses: 0, hits: 0, moveAbility: 0, movementPerTurn: [] };
  const bump = (o, k, n = 1) => (o[k] = (o[k] || 0) + n);
  const consume = (ev, actor) => { checkEvents(engine, i, ev, actor); for (const e of ev) { if (e.type === 'damage' && e.unit) bump(stats.dmgByCls, e.unit.cls, e.amount); if (e.type === 'ko') { stats.kos++; bump(stats.deathsByCls, e.victim.cls); if (e.by) bump(stats.killsByCls, e.by.cls); } if (e.type === 'raise') stats.raises++; if (e.type === 'reaction') stats.reactions++; if (e.type === 'status' && e.applied) stats.statusApplied++; if (e.type === 'miss') stats.misses++; if (e.type === 'damage' && e.ability) stats.hits++; } };
  let guard = 0; let round = 0; const seenTurn = new Set(); let lastDec = null;
  while (!engine.over && guard++ < 5000) {
    const a = engine.advance(); if (!a) break;
    if (a.kind === 'crystal' || a.kind === 'countdown') { checkUnits(engine, i, a.kind); continue; }
    if (a.kind === 'charge') { const u = a.unit; const ev = engine.resolveCharge(u); consume(ev, u); stats.charges++; checkUnits(engine, i, 'charge'); if (engine.checkVictory().over) break; continue; }
    // a round is complete once every unit still standing has taken a turn (§5.2 targets 8-14 of these)
    const u = a.unit; stats.turns++; seenTurn.add(u.id);
    if (engine.alive().every((o) => seenTurn.has(o.id))) { seenTurn.clear(); round++; }
    const ev0 = engine.beginTurn(u); consume(ev0, u);
    if (!u.ko && !u.statuses.sleep) {
      const dec = pick(u)(u, engine); lastDec = dec; let movementEffects = 0;
      const doMove = () => { if (dec.tile && (dec.tile.x !== u.x || dec.tile.z !== u.z) && engine.canMove(u)) { const path = engine.reach(u).path(dec.tile.x, dec.tile.z); if (path) { const ev = engine.move(u, path); consume(ev, u); movementEffects += ev.filter((e) => e.source === 'Move-MP Up' || e.status === 'bulwark').length ? 1 : 0; } } };
      const doAct = () => { if (dec.ab && engine.canAct(u)) { bump(stats.use, dec.ab); const ev = engine.act(u, dec.ab, dec.target); consume(ev, u); } };
      if (dec.order === 'act-move') { doAct(); doMove(); } else { doMove(); doAct(); }
      if (movementEffects > 1) viol.add(i, `${u.name} triggered ${movementEffects} movement abilities in one turn`);
    }
    const ev1 = engine.endTurn(u, { facing: lastDec?.facing }); lastDec = null; consume(ev1, u); const te = ev1.find((e) => e.type === 'turnEnd');
    // CT reset (§2.1): 0 if the unit moved and acted, 20 if it did one, 40 if it waited — minus the gear tempo cost (§2.1)
    const acted = u.acted || !!u.charging;
    const want = te.skipped ? 0 : Math.max(0, (u.moved && acted ? 0 : (u.moved || acted) ? 20 : 40) - te.tempo);
    if (u.ct !== want) viol.add(i, `${u.name} ct=${u.ct} after turn, expected ${want} (moved ${u.moved} acted ${acted} tempo ${te.tempo} skipped ${te.skipped})`);
    checkUnits(engine, i, 'turn ' + stats.turns); if (stats.turns % 10 === 0) checkHitClamp(engine, i);
    if (engine.checkVictory().over) break;
  }
  if (VERBOSE && engine.timeout) console.log(`  STALEMATE battle ${i} rosters A[${r.A}] B[${r.B}] turns ${stats.turns} ticks ${engine.tick}`);
  if (VERBOSE && (engine.winner == null)) console.log('  survivors:', engine.alive().map((u) => `${u.name} ${u.hp}/${u.maxHp} mp${u.mp} @${u.x},${u.z} ${Object.keys(u.statuses).join('+')}`).join(' | '), '| KO:', engine.units.filter((u) => u.ko && !u.removed).map((u) => u.name).join(','));
  if (!engine.over) viol.add(i, `did not terminate (ticks ${engine.tick}, turns ${stats.turns})`);
  else if (engine.winner == null && !engine.timeout && !engine.mutual) viol.add(i, `draw / tick cap reached (ticks ${engine.tick}, turns ${stats.turns})`);
  stats.timeout = engine.timeout ? 1 : 0;
  const removedAlive = engine.units.filter((u) => u.removed && !u.ko); if (removedAlive.length) viol.add(i, 'removed unit not KO');
  return { i, winner: engine.winner, rounds: round + 1, ticks: engine.tick, roster: r, ...stats, winnerRoster: engine.winner ? r[engine.winner] : null, newSide: ns };
}

// ---- duel mode: a 1v1 arena for every ordered class pair (DESIGN §5.3 balance matrix) ----
async function runDuel(map, rng, ca, cb) {
  const engine = new Engine(map, { rng, maxTicks: 1200, stallLimit: 40 });
  engine.addUnit('A', ca, map.spawns.A[0][0], map.spawns.A[0][1], ca + 'A');
  engine.addUnit('B', cb, map.spawns.B[0][0], map.spawns.B[0][1], cb + 'B');
  let guard = 0; let lastDuel = null;
  while (!engine.over && guard++ < 2000) {
    const a = engine.advance(); if (!a) break;
    if (a.kind === 'crystal' || a.kind === 'countdown') continue;
    if (a.kind === 'charge') { engine.resolveCharge(a.unit); if (engine.checkVictory().over) break; continue; }
    const u = a.unit; engine.beginTurn(u);
    if (!u.ko && !u.statuses.sleep) {
      const d = decide(u, engine); lastDuel = d;
      const mv = () => { if (d.tile && (d.tile.x !== u.x || d.tile.z !== u.z) && engine.canMove(u)) { const p = engine.reach(u).path(d.tile.x, d.tile.z); if (p) engine.move(u, p); } };
      const ac = () => { if (d.ab && engine.canAct(u)) engine.act(u, d.ab, d.target); };
      if (d.order === 'act-move') { ac(); mv(); } else { mv(); ac(); }
    }
    engine.endTurn(u, { facing: lastDuel?.facing }); lastDuel = null;
    if (engine.checkVictory().over) break;
  }
  return engine.winner;
}
if (+(args.duel || 0)) {
  const map = await loadMap(); const pool = ROSTER === 'all' ? Object.keys(CLASSES).filter((k) => !CLASSES[k].monster) : ROSTER === 'packed' ? PACKED_CLASSES : Object.keys(CLASSES);
  const per = Math.max(1, +(args.n || 4)); const wins = {}, games = {}; const t = Date.now();
  for (const a of pool) { wins[a] = 0; games[a] = 0; }
  let seedN = SEED * 104729;
  for (const a of pool) for (const b of pool) { if (a === b) continue;
    for (let k = 0; k < per; k++) { const w = await runDuel(map, mulberry32(seedN++), a, b); games[a]++; games[b]++; if (w === 'A') wins[a]++; else if (w === 'B') wins[b]++; } }
  const rows = pool.map((c) => ({ c, pct: 100 * wins[c] / Math.max(1, games[c]) })).sort((x, y) => y.pct - x.pct);
  console.log(`\n== duel matrix: ${pool.length} classes x ${per} battles per ordered pair, ${((Date.now() - t) / 1000).toFixed(0)}s ==`);
  for (const r of rows) console.log(`${r.c.padEnd(13)} ${r.pct.toFixed(0).padStart(3)}%  ${'#'.repeat(Math.round(r.pct / 2))}`);
  // A 1v1 arena flatters damage dealers and punishes pure support (Apothecary, Chronomancer, Cleric have nothing to
  // win a duel WITH), so the gate here is a regression band, not DESIGN §5.3's phase-3 parity target.
  const outliers = rows.filter((r) => r.pct >= 85 || r.pct <= 12);
  console.log(`\nspread ${rows[rows.length - 1].pct.toFixed(0)}%-${rows[0].pct.toFixed(0)}%, median ${rows[Math.floor(rows.length / 2)].pct.toFixed(0)}%`);
  if (outliers.length) { console.log('outliers (>=85% or <=12%): ' + outliers.map((r) => `${r.c} ${r.pct.toFixed(0)}%`).join(', ')); process.exit(1); }
  console.log('no class outside the 12-85% duel band'); process.exit(0);
}
const map = await loadMap(); const t0 = Date.now(); let results = [];
if (WORKER) {
  for (let i = START; i < START + N; i++) { const rng = mulberry32(SEED * 7919 + i); results.push(await runBattle(i, map, rng)); }
  process.send({ results: results.map((r) => ({ ...r, winnerRoster: r.winnerRoster ? r.winner : null })), viol: viol.list }, () => process.exit(0));
} else if (JOBS > 1) {
  const per = Math.ceil(N / JOBS); const me = fileURLToPath(import.meta.url);
  const parts = await Promise.all(Array.from({ length: JOBS }, (_, j) => new Promise((res, rej) => {
    const start = j * per, n = Math.min(per, N - start); if (n <= 0) return res({ results: [], viol: [] });
    const argv = process.argv.slice(2).filter((a) => !/^(jobs|n|start)=/.test(a)).concat([`n=${n}`, `start=${start}`, 'worker=1']);
    const c = fork(me, argv, { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }); let got = null;
    c.on('message', (m) => { got = m; }); c.on('exit', (code) => (got ? res(got) : rej(new Error('worker ' + j + ' exited ' + code))));
  })));
  for (const p of parts) { results.push(...p.results); viol.list.push(...p.viol); }
  results.sort((a, b) => a.i - b.i);
  // the roster objects did not survive the IPC hop by identity; winnerRoster is re-derived from the winner
  for (const r of results) r.winnerRoster = r.winner ? r.roster[r.winner] : null;
} else for (let i = 0; i < N; i++) { const rng = mulberry32(SEED * 7919 + i); results.push(await runBattle(i, map, rng)); }
if (WORKER) await new Promise(() => {});
const wins = { A: 0, B: 0, draw: 0 }; for (const r of results) wins[r.winner || 'draw']++;
const avg = (k) => (results.reduce((s, r) => s + r[k], 0) / results.length).toFixed(1);
const use = {}; const dmg = {}, kills = {}, deaths = {}, rosterWins = {}, rosterGames = {};
for (const r of results) { for (const k in r.use) use[k] = (use[k] || 0) + r.use[k]; for (const k in r.dmgByCls) dmg[k] = (dmg[k] || 0) + r.dmgByCls[k]; for (const k in r.killsByCls) kills[k] = (kills[k] || 0) + r.killsByCls[k]; for (const k in r.deathsByCls) deaths[k] = (deaths[k] || 0) + r.deathsByCls[k];
  for (const t of ['A', 'B']) for (const c of r.roster[t]) { rosterGames[c] = (rosterGames[c] || 0) + 1; if (r.winner === t) rosterWins[c] = (rosterWins[c] || 0) + 1; } }
console.log(`\n== sim: ${N} battles, roster=${ROSTER}, seed=${SEED}, map=${map.name}, ${((Date.now() - t0) / 1000).toFixed(1)}s ==`);
if (VARIANT) { const dec = results.filter((r) => r.winner); const w = dec.filter((r) => r.winner === r.newSide).length;
  console.log(`VARIANT (${LVL_NEW != null ? `lvl ${LVL_NEW} vs ${LVL_OLD ?? 10}` : ''}${decideOld ? ` new AI vs ${args.aiOld}` : ''}): new side wins ${w}/${dec.length} decided (${(100 * w / Math.max(1, dec.length)).toFixed(1)}%), draws ${results.length - dec.length}`); }
if (ROSTER === 'default') { let dWins = 0; for (const r of results) if (String(r.winnerRoster) === String(DEFAULT.A)) dWins++; console.log(`side A wins ${wins.A}, side B wins ${wins.B}, draws ${wins.draw} | roster [${DEFAULT.A.join(',')}] wins ${dWins}/${N - wins.draw} (${(100 * dWins / Math.max(1, N - wins.draw)).toFixed(0)}%) vs [${DEFAULT.B.join(',')}]`); }
else console.log(`A wins ${wins.A}, B wins ${wins.B}, draws ${wins.draw}`);
const timeouts = results.filter((r) => r.timeout).length; if (timeouts) console.log(`stalemate resolutions (no KO for 80 turns): ${timeouts} (${(100 * timeouts / N).toFixed(0)}%)`);
console.log(`avg rounds ${avg('rounds')} (target 8–14), avg unit turns ${avg('turns')} (target 60–110), avg ticks ${avg('ticks')}, KOs ${avg('kos')}, raises ${avg('raises')}, charges ${avg('charges')}, reactions ${avg('reactions')}, statuses ${avg('statusApplied')}, hit/miss ${avg('hits')}/${avg('misses')}`);
console.log('ability use: ' + Object.entries(use).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('class      games  win%  dmg/game  kills  deaths');
for (const c of Object.keys(rosterGames).sort()) console.log(`${c.padEnd(10)} ${String(rosterGames[c]).padStart(5)}  ${(100 * (rosterWins[c] || 0) / rosterGames[c]).toFixed(0).padStart(4)}  ${((dmg[c] || 0) / rosterGames[c]).toFixed(0).padStart(8)}  ${String(kills[c] || 0).padStart(5)}  ${String(deaths[c] || 0).padStart(6)}`);
const fielded = new Set(); for (const r of results) for (const t of ['A', 'B']) for (const c of r.roster[t]) fielded.add(c);
const unused = Object.keys(ABILITIES).filter((k) => !ABILITIES[k].hidden && !use[k] && [...fielded].some((c) => CLASSES[c].abilities.includes(k)));
if (unused.length) console.log(`never used by the AI (of ${fielded.size} classes fielded): ` + unused.join(', '));
if (timeouts > N * 0.05) viol.add('-', `${timeouts} stalemates > 5% of battles`);
if (viol.list.length) { console.log(`\n${viol.list.length} INVARIANT VIOLATIONS`); for (const v of viol.list.slice(0, 40)) console.log('  ' + v); process.exit(1); }
console.log('all invariants held'); process.exit(0);
