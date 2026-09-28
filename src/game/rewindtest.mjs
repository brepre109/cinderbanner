#!/usr/bin/env node
// REWIND determinism test (node, no DOM): Engine.snapshot() -> play on -> Engine.restore() -> the same choices must give
// a bit-identical state and event stream, the snapshot must survive being restored twice, units added after it (a boss
// phase summon) must leave the roster, surviving units must keep their object identity, and a restored battle must
// finish exactly as the original did.
//   node src/game/rewindtest.mjs [n=24] [seed=1] [verbose=1]
// Exits non-zero on any failure.
import { Engine, CLASSES, PACKED_CLASSES, makeRng } from './rules.js';
import { decide } from './ai.js';
import { enemyOpts } from './progression.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
const N = +(args.n || 24), SEED = +(args.seed || 1), VERBOSE = +(args.verbose || 0);
let MAP = null; try { MAP = (await import('../world/mapdata.js')).MAP; } catch (e) { /* fall back below */ }
if (!MAP?.at) { const w = 12, d = 12; const tiles = []; for (let z = 0; z < d; z++) { const row = []; for (let x = 0; x < w; x++) row.push({ x, z, h: (x >= 4 && x <= 7 && z >= 4 && z <= 7) ? 4 : 0, t: 'g', water: false, walk: true }); tiles.push(row); }
  MAP = { w, d, tiles, at: (x, z) => (x >= 0 && z >= 0 && x < w && z < d ? tiles[z][x] : null), spawns: { A: [[1, 10], [2, 10], [3, 10], [1, 9], [3, 9]], B: [[10, 1], [9, 1], [8, 1], [10, 2], [8, 2]] } }; }

const fails = []; const fail = (i, m) => { fails.push(`battle ${i}: ${m}`); if (VERBOSE) console.log('FAIL', i, m); };
// Event stream as plain comparable text (units by id).
const evText = (ev) => ev.map((e) => [e.type, e.unit?.id, e.victim?.id, e.amount, e.status, e.applied, e.name, e.to && `${e.to.x},${e.to.z}`, e.id].filter((x) => x != null).join(':')).join('|');
const stateText = (E) => { const s = E.snapshot(); delete s.logLen; return JSON.stringify(s, (k, v) => (k === 'eq' || k === 'base' ? undefined : v)); };

function build(i) {
  const rng = makeRng(SEED * 7919 + i * 104729); const E = new Engine(MAP, { rng });
  const pool = (i % 3 === 0 ? Object.keys(CLASSES).filter((k) => !CLASSES[k].monster) : PACKED_CLASSES).filter((k) => k !== 'oathknight');
  for (const team of ['A', 'B']) for (let k = 0; k < 5; k++) { const [x, z] = MAP.spawns[team][k]; const cls = pool[Math.floor(rng() * pool.length)]; E.addUnit(team, cls, x, z, `${cls}${team}${k}`, enemyOpts(cls, 8 + (k % 4))); }
  if (i % 4 === 1) E.setObjective({ type: 'leader', leaderId: E.units[7].id });
  return E;
}
// One step of battle.js's loop: returns { a, ev } with a = what advance() handed out (null when over).
function step(E) {
  const a = E.advance(); if (!a) return { a: null, ev: '' };
  if (a.kind === 'countdown' || a.kind === 'crystal') return { a, ev: `${a.kind}:${a.unit.id}` };
  if (a.kind === 'charge') { const ev = E.resolveCharge(a.unit); E.checkVictory(); return { a, ev: evText(ev) }; }
  return { a, ev: playTurn(E, a.unit) };
}
function playTurn(E, u) {
  const out = [evText(E.beginTurn(u))];
  let face = null;
  if (!u.ko && !u.statuses.sleep) {
    const d = decide(u, E); face = d.facing;
    const mv = () => { if (d.tile && (d.tile.x !== u.x || d.tile.z !== u.z) && E.canMove(u)) { const p = E.reach(u).path(d.tile.x, d.tile.z); if (p) out.push(evText(E.move(u, p))); } };
    const ac = () => { if (d.ab && E.canAct(u)) out.push(evText(E.act(u, d.ab, d.target))); };
    if (d.order === 'act-move') { ac(); mv(); } else { mv(); ac(); }
  }
  out.push(evText(E.endTurn(u, { facing: face }))); E.checkVictory();
  return out.join('#');
}
// Advance to the start of the k-th unit turn (the snapshot point battle.js uses: advance() has handed out a turn).
function toTurnStart(E, k, trace) {
  for (let g = 0; g < 4000 && !E.over; g++) {
    const a = E.advance(); if (!a) return null;
    if (a.kind === 'turn' && E.turn + 1 >= k) return a.unit;
    if (a.kind === 'countdown' || a.kind === 'crystal') { trace?.push(`${a.kind}:${a.unit.id}`); continue; }
    if (a.kind === 'charge') { const ev = E.resolveCharge(a.unit); E.checkVictory(); trace?.push(evText(ev)); continue; }
    const t = playTurn(E, a.unit); trace?.push(t);   // (not trace?.push(playTurn(...)): ?. would skip the call)
  }
  return null;
}
function playOn(E, first, turns) {
  const t = [playTurn(E, first)]; for (let g = 0; g < turns && !E.over; g++) { const { a, ev } = step(E); if (!a) break; t.push(ev); } return t.join('\n');
}
function finish(E) { const t = []; for (let g = 0; g < 6000 && !E.over; g++) { const { a, ev } = step(E); if (!a) break; t.push(ev); } return { trace: t.join('\n'), winner: E.winner, turn: E.turn, tick: E.tick }; }

let checks = 0;
for (let i = 0; i < N; i++) {
  const E = build(i); const at = 6 + (i % 9) * 3;
  const u = toTurnStart(E, at); if (!u) { if (VERBOSE) console.log(`battle ${i}: over before turn ${at}`); continue; }
  const idsBefore = E.units.map((o) => o); const S = E.snapshot(); const s0 = stateText(E);
  // 1) play on K turns; a boss-phase style summon half way
  const K = 6 + (i % 5);
  const t1 = playOn(E, u, K); if (i % 2 === 0 && !E.over) E.addUnit('B', 'skeleton', ...freeTile(E), 'Summoned', enemyOpts('skeleton', 8));
  const t1b = playOn2(E, 4); const f1 = stateText(E); const n1 = E.units.length;
  // 2) restore: the state is the snapshot's, byte for byte; the summon is gone; the survivors are the same objects
  const r = E.restore(S); checks++;
  if (stateText(E) !== s0) fail(i, 'restored state differs from the snapshot');
  if (E.units.length !== idsBefore.length || E.units.some((o, k) => o !== idsBefore[k])) fail(i, 'unit identity/order not preserved');
  if (i % 2 === 0 && n1 > idsBefore.length && r.removed.length !== n1 - idsBefore.length) fail(i, `summon not removed (${r.removed.length})`);
  // 3) the clock hands out the very same turn again
  const a = E.advance(); if (!a || a.kind !== 'turn' || a.unit !== u) fail(i, `advance after restore gave ${a?.kind} ${a?.unit?.id}, want turn ${u.id}`);
  // 4) same choices -> same everything
  const t2 = playOn(E, u, K); if (i % 2 === 0 && !E.over) E.addUnit('B', 'skeleton', ...freeTile(E), 'Summoned', enemyOpts('skeleton', 8));
  const t2b = playOn2(E, 4); const f2 = stateText(E);
  if (t1 !== t2 || t1b !== t2b) fail(i, 'event stream differs after restore'); if (f1 !== f2) fail(i, 'final state differs after restore');
  // 5) restore the same snapshot a second time (it must not have been mutated) and finish the battle both ways
  E.restore(S); if (stateText(E) !== s0) fail(i, 'second restore differs (snapshot mutated)');
  E.advance(); const endA = finish2(E, u);
  E.restore(S); E.advance(); const endB = finish2(E, u);
  if (endA.trace !== endB.trace || endA.winner !== endB.winner || endA.turn !== endB.turn) fail(i, `finish differs: ${endA.winner}/${endA.turn} vs ${endB.winner}/${endB.turn}`);
  if (!endA.over) fail(i, 'restored battle did not finish');
  checks += 4;
  if (VERBOSE) console.log(`battle ${i}: snapshot at turn ${at} (${u.name}), +${K} turns, finished turn ${endA.turn} winner ${endA.winner}`);
}
function playOn2(E, turns) { const t = []; for (let g = 0; g < turns && !E.over; g++) { const { a, ev } = step(E); if (!a) break; t.push(ev); } return t.join('\n'); }
function finish2(E, u) { const first = playTurn(E, u); const r = finish(E); return { ...r, trace: first + '\n' + r.trace, over: E.over }; }
function freeTile(E) { for (let z = 0; z < MAP.d; z++) for (let x = MAP.w - 1; x >= 0; x--) { const t = MAP.at(x, z); if (t?.walk && !E.units.some((o) => !o.removed && o.x === x && o.z === z)) return [x, z]; } return [0, 0]; }

// RNG: state round-trips
{ const r = makeRng(42); r(); r(); const st = r.getState(); const a = [r(), r(), r()]; r.setState(st); const b = [r(), r(), r()]; checks++; if (a.join() !== b.join()) fails.push('rng state does not round-trip'); }

console.log(`rewind test: ${N} battles, ${checks} checks, ${fails.length} failures`);
if (fails.length) { for (const f of fails.slice(0, 20)) console.log('  ' + f); process.exit(1); }
console.log('OK');
