// The whole analysis in one object, and the ASCII table a designer actually reads (PLAN §4.8).
//
// analyseMap() is deliberately tolerant: it takes a MAP alone (spawns come off MAP.spawns) or a
// MAP plus its def (which adds the design contract — declared faces, chokes, promises). Nothing
// here throws on a broken map; a map that cannot route is a REPORT, not an exception, because the
// editor calls this on every stroke and a mid-edit map is broken by definition.
//
// `analysis` on the returned object is exactly the def.analysis cache shape of PLAN §2, with every
// Infinity written as null so it survives JSON. `hash` is hashDef(def), which excludes the cache —
// so a terrain edit that moves the ladder without refreshing the cache shows up as a hash mismatch
// in review. That is the drift detector, and it only works because the hash is taken of the
// AUTHORED document, never of the numbers below it.
//
// Zero three.js: runs under bare `node` — tools/mapcheck.mjs imports analyseMap from here.
import { buildGraph, requiredClimb, climbToJump } from '../jumpgraph.js';
import { hashDef } from '../mapformat/serialize.js';
import { PROFILES, TIERS } from './profiles.js';
import { classifyEdges, faceScan, faceSaving, faceKey, toNodes } from './classify.js';
import { ladder, sealProof, pockets, verifyPromises } from './ladder.js';

const fin = (v) => (Number.isFinite(v) ? v : null);
const num = (v) => (v === Infinity ? '∞' : v === -Infinity ? '-∞' : v == null ? '-' : String(v));
const pct = (f) => `${(f * 100).toFixed(0)}%`;

/**
 * @param {object} MAP compiled map (or a Graph — buildGraph is idempotent on one)
 * @param {object} [def] the MapDef; supplies design.baseTier/tiers/faces/chokes/promises
 * @returns {Analysis}
 */
export function analyseMap(MAP, def = null) {
  const t0 = Date.now();
  const g = MAP && MAP.need ? MAP : buildGraph(MAP);
  const d = (def && def.design) || {};
  const baseClimb = d.baseTier ?? 4;
  const tiers = d.tiers && d.tiers.length ? d.tiers : TIERS.filter((t) => Number.isFinite(t));
  const spawns = (def && def.spawns) || MAP.spawns || {};
  const srcA = toNodes(g, spawns.A), srcB = toNodes(g, spawns.B);
  const ctx = { baseClimb, tiers, srcA, srcB, profiles: PROFILES };
  const timings = {};
  const t1 = Date.now();
  const lad = ladder(g, ctx); timings.ladder = Date.now() - t1;
  const t2 = Date.now();
  const shortcuts = classifyEdges(g, ctx); timings.classify = Date.now() - t2;
  const t3 = Date.now();
  const discovered = faceScan(g, baseClimb, { tiers });
  const declared = (d.faces || []).map((f) => withKey(g, f));
  const declKeys = new Set(declared.map((f) => f.key));
  const foundKeys = new Set(discovered.map((f) => f.key));
  const undeclared = discovered.filter((f) => !declKeys.has(f.key));
  const phantom = declared.filter((f) => !foundKeys.has(f.key));      // declared but not a real face
  const faceSavings = {};
  for (const f of declared) {
    if (f.a < 0 || f.b < 0) continue;
    faceSavings[f.fid || `${f.a}:${f.b}`] = faceSaving(g, { ...f, need: f.drop }, ctx);
  }
  timings.faces = Date.now() - t3;
  const t4 = Date.now();
  const seals = (d.chokes || []).map((c) => ({ cid: c.cid || null, ...sealProof(g, c, { ...ctx, climb: c.tier ?? baseClimb }) }));
  const pk = pockets(g, { ...ctx, climb: baseClimb });
  timings.seals = Date.now() - t4;
  const promises = verifyPromises(lad, d.promises || []);
  const requiredClimbAB = srcA.length && srcB.length ? requiredClimb(g, srcA[0], srcB[0]) : Infinity;
  timings.total = Date.now() - t0;
  const a = { id: def?.id || null, name: MAP.name || def?.name || 'map', w: g.w, d: g.d,
    baseClimb, tiers, spawns: { A: srcA.length, B: srcB.length },
    ladder: lad, drops: lad.drops, shortcuts,
    faces: { declared, discovered, undeclared, phantom, savings: faceSavings },
    seals, pockets: pk, promises, requiredClimbAB, requiredJumpAB: climbToJump(requiredClimbAB),
    hash: def ? safeHash(def) : null, timings, violations: [] };
  a.violations = violationsOf(a);
  a.analysis = cacheOf(a);
  return a;
}

function withKey(g, f) {
  const a = f.from ? g.idx(f.from[0], f.from[1]) : -1, b = f.to ? g.idx(f.to[0], f.to[1]) : -1;
  return { ...f, a, b, key: faceKey(a, b), drop: f.drop ?? 0 };
}
function safeHash(def) { try { return hashDef(def); } catch { return null; } }

/** Everything a designer must fix, in one list, severity-coded like validate.js's issues so the
 *  editor's Issues panel and mapcheck can render analysis findings beside schema findings. */
function violationsOf(a) {
  const v = [];
  for (const x of a.ladder.violations) v.push({ code: x.code, severity: 'error', at: null,
    msg: `tier ${num(x.fromTier)}h -> ${num(x.toTier)}h got WORSE (${num(x.from)} -> ${num(x.to)}); this is a bug in jumpgraph need[], not the map` });
  for (const f of a.faces.undeclared) v.push({ code: 'contract.face-undeclared', severity: 'error', at: f.hi,
    msg: `undeclared ${f.drop}h face ${JSON.stringify(f.from)}->${JSON.stringify(f.to)} (JUMP ${f.jump}); declare it or flatten it` });
  for (const f of a.faces.phantom) v.push({ code: 'contract.face-phantom', severity: 'error', at: f.from || null,
    msg: `declared face ${f.fid || ''} is not a >${a.baseClimb}h step between two walkable tiles` });
  for (const [fid, s] of Object.entries(a.faces.savings)) {
    if (!(s.saving > 0)) v.push({ code: 'contract.face-worthless', severity: 'error', at: null,
      msg: `face ${fid} saves ${num(s.saving)} steps at ${num(s.climb)}h — a decoration, not a mechanic` });
  }
  for (const s of a.seals) {
    if (!s.sealed) v.push({ code: 'contract.choke-leaks', severity: 'error', at: s.leak,
      msg: `choke ${s.cid || ''} does not seal at ${num(s.climb)}h — the flood escaped past ${JSON.stringify(s.leak)} in ${num(s.steps)} steps` });
    else if (s.vacuous) v.push({ code: 'contract.choke-vacuous', severity: 'warn', at: null,
      msg: `choke ${s.cid || ''} "seals" only because the spawns were already severed at ${num(s.climb)}h` });
  }
  for (const p of a.promises) if (!p.ok) v.push({ code: 'contract.promise-unmet', severity: 'error', at: null,
    msg: `promise tier ${num(p.tier)}h: ${num(p.measuredTurns)} turns saved, ${num(p.requiredTurns)} required (MOVE ${p.move})` });
  if (!a.ladder.rows[0].connected) v.push({ code: 'ladder.base-severed', severity: 'error', at: null,
    msg: `the base tier (${a.baseClimb}h) cannot walk A to B at all` });
  const flat = a.ladder.rows.every((r) => r.steps === a.ladder.rows[0].steps);
  if (flat && a.ladder.rows.length > 1) v.push({ code: 'ladder.flat', severity: 'warn', at: null,
    msg: `every tier walks the same ${num(a.ladder.rows[0].steps)} steps — this map does not reward JUMP` });
  return v;
}

/** The def.analysis cache of PLAN §2, JSON-safe. */
function cacheOf(a) {
  const ladderTurns = {}, ladderSteps = {}, faceSavings = {};
  for (const r of a.ladder.rows) {
    const k = Number.isFinite(r.tier) ? String(r.tier) : 'inf';
    ladderTurns[k] = fin(r.turnsBySlowest); ladderSteps[k] = fin(r.steps);
  }
  for (const [fid, s] of Object.entries(a.faces.savings))
    faceSavings[fid] = { steps: fin(s.saving), turns: Object.fromEntries(Object.entries(s.turns).map(([k, v]) => [k, fin(v)])) };
  return { ladderTurns, ladderSteps, faceSavings,
    pockets: a.pockets.map((p) => ({ tier: fin(p.tier), tiles: p.size, at: p.at, note: p.note })),
    hash: a.hash };
}

// ---------------------------------------------------------------------------- CLI table
function table(headers, rows) {
  if (!rows.length) return `  ${headers.join('  ')}\n  (none)`;
  const cells = [headers, ...rows].map((r) => r.map((v) => String(v ?? '')));
  const wid = headers.map((_, i) => Math.max(...cells.map((r) => [...r[i]].length)));
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
  const line = (r) => '  ' + r.map((v, i) => pad(v, wid[i])).join('  ').trimEnd();
  return [line(cells[0]), '  ' + wid.map((n) => '-'.repeat(n)).join('  '), ...cells.slice(1).map(line)].join('\n');
}

/** The compact report. Designed to be read in a terminal beside the map file, so every row is one
 *  line and every number carries its unit. */
export function formatReport(a) {
  const o = [];
  o.push(`MAP  ${a.name}  ${a.w}x${a.d}  base ${a.baseClimb}h  A->B needs ${num(a.requiredClimbAB)}h (JUMP ${num(a.requiredJumpAB)})  hash ${a.hash || '-'}`);
  o.push('', 'LADDER  (turns = ceil((steps-1)/MOVE); MOVE is the slowest class that can take the tier)');
  o.push(table(['tier', 'jump', 'steps', 'turns', 'fast', 'MOVE', 'area', 'conn'], a.ladder.rows.map((r) => [
    num(r.tier) + 'h', num(r.jump), num(r.steps), num(r.turnsBySlowest), num(r.turnsByFastest),
    `${r.slowestMove}-${r.fastestMove}`, pct(r.areaFrac), r.connected ? 'yes' : 'NO'])));
  o.push(`  monotone: ${a.ladder.monotone ? 'yes' : 'NO — ' + a.ladder.violations.map((v) => v.code).join(', ')}`);
  for (const dr of a.drops)
    o.push(`  drop ${num(dr.fromTier)}h -> ${num(dr.toTier)}h: -${num(dr.dSteps)} steps, -${num(dr.dTurns)} turns` +
      (dr.viaEdges.length ? `  via ${dr.viaEdges.map((e) => `${JSON.stringify(e.from)}->${JSON.stringify(e.to)} ${e.need}h`).join(', ')}` : '  via (no new edge on the path)'));
  o.push('', `SHORTCUTS  ${a.shortcuts.length} edge(s) above ${a.baseClimb}h, sorted by turn saving (single-edge ESTIMATE; the ladder above is exact)`);
  o.push(table(['at', 'dir', 'need', 'jump', 'kind', 'gain', 'detour', 'turns', 'profiles'],
    a.shortcuts.slice(0, 24).map((s) => [`${s.x},${s.z}`, s.dir, s.need + 'h', num(s.jump),
      s.kind === 'gate' ? `gate(${s.cutSize})` : s.kind,
      num(s.routeGain), num(s.localDetour), num(s.maxTurnGain), s.eligible.join(' ') || '-'])));
  if (a.shortcuts.length > 24) o.push(`  ... ${a.shortcuts.length - 24} more`);
  o.push('', `FACES  ${a.faces.declared.length} declared, ${a.faces.discovered.length} discovered, ${a.faces.undeclared.length} undeclared, ${a.faces.phantom.length} phantom`);
  const fs = Object.entries(a.faces.savings);
  if (fs.length) o.push(table(['fid', 'climb', 'with', 'without', 'saving', 'seals'],
    fs.map(([k, s]) => [k, num(s.climb) + 'h', num(s.with), num(s.without), num(s.saving), s.sealed ? 'yes' : ''])));
  o.push('', 'SEALS');
  o.push(table(['choke', 'climb', 'tiles', 'sealed', 'leak'], a.seals.map((s) =>
    [s.cid || '-', num(s.climb) + 'h', s.tiles, s.sealed ? (s.vacuous ? 'vacuous' : 'yes') : 'NO', s.leak ? JSON.stringify(s.leak) : '-'])));
  o.push('', `POCKETS  ${a.pockets.length} region(s) the ${a.baseClimb}h tier cannot enter`);
  o.push(table(['at', 'tiles', 'tier', 'note'], a.pockets.slice(0, 12).map((p) =>
    [JSON.stringify(p.at), p.size, p.tier === null ? '-' : num(p.tier) + 'h', p.note])));
  if (a.promises.length) {
    o.push('', 'PROMISES');
    o.push(table(['tier', 'MOVE', 'base', 'tier steps', 'saved', 'required', 'margin', 'ok'], a.promises.map((p) =>
      [num(p.tier) + 'h', p.move, num(p.baseSteps), num(p.tierSteps), num(p.measuredTurns), num(p.requiredTurns), num(p.margin), p.ok ? 'yes' : 'NO'])));
  }
  o.push('', `FINDINGS  ${a.violations.filter((v) => v.severity === 'error').length} error(s), ${a.violations.filter((v) => v.severity === 'warn').length} warning(s)`);
  for (const v of a.violations) o.push(`  ${v.severity.toUpperCase().padEnd(5)} ${v.code}${v.at ? ' ' + JSON.stringify(v.at) : ''}  ${v.msg}`);
  o.push('', `  analysed in ${a.timings.total} ms (ladder ${a.timings.ladder}, classify ${a.timings.classify}, faces ${a.timings.faces}, seals ${a.timings.seals})`, '');
  return o.join('\n');
}
