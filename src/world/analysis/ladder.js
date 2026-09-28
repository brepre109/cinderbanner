// The tier ladder, choke seals and pockets (PLAN §4.6, §4.7) — the per-tier truth that
// analysis/classify.js only estimates.
//
// The unit is TURNS, not steps. This is the one improvement on the prototype's `d2 > d3 > d4 > d5` that
// changes what a designer builds: a Knight (MOVE 3) and a Ninja (MOVE 4) convert the same 8-step
// saving into 3 turns and 2. `turns(d, move) = ceil((d - 1) / move)`, the -1 because you attack
// from an adjacent tile so the last step is never taken. Every acceptance number is quoted for the
// SLOWEST class that can take the tier, because a promise that only the fastest class keeps is not
// a promise.
//
// `monotone` is NOT a design assertion: tier subgraphs are sublevel sets of one need[] array and so
// are nested by construction, which makes `d(2) >= d(4) >= d(6)` a theorem. We assert it as a
// self-check on jumpgraph.js — a false here means a bug in need[], not a bad map. The design
// assertion lives in verifyPromises().
//
// Zero three.js: runs under bare `node`.
import { buildGraph, reachField, turnsFor, pathOf, climbToJump, blockNodes, NO_EDGE, tierField }
  from '../jumpgraph.js';
import { PROFILES, TIERS, slowestMoveAtTier, fastestMoveAtTier } from './profiles.js';
import { toNodes, spanDist } from './classify.js';

export { turnsFor };   // PLAN §3.2 lists turnsFor on ladder.js; jumpgraph.js owns the definition.

const asGraph = (g) => (g && g.need ? g : buildGraph(g));
const cmp = (x, y) => (x === y ? 0 : x < y ? -1 : 1);
/** Ascending, de-duplicated, with the base tier always the first row: a ladder that omits its own
 *  floor has nothing to measure a saving against. */
function tierList(baseClimb, tiers) {
  const s = new Set([baseClimb, ...(tiers && tiers.length ? tiers : TIERS)]);
  return [...s].filter((t) => t >= baseClimb).sort(cmp);
}

/**
 * Corner-to-corner routing per tier: steps, turns at both ends of the tier's MOVE range, and the
 * share of the walkable board the tier can stand on.
 *
 * Accepts `ladder(g, ctx)` (PLAN §4.6) or `ladder(MAP, def, profiles)` (the wave brief) — a MAP is
 * compiled to a Graph on the way in.
 * @returns {{rows, monotone, violations, drops, tiers, walkable, baseClimb}}
 */
export function ladder(gOrMap, ctxOrDef = {}, profilesArg) {
  const g = asGraph(gOrMap);
  const isDef = !!(ctxOrDef && ctxOrDef.design);
  const ctx = isDef ? defCtx(g, ctxOrDef, profilesArg) : ctxOrDef;
  const water = !!ctx.water, profiles = ctx.profiles || PROFILES;
  const baseClimb = ctx.baseClimb ?? 4;
  const srcA = toNodes(g, ctx.srcA), srcB = toNodes(g, ctx.srcB);
  const tiers = tierList(baseClimb, ctx.tiers);
  let walkable = 0;
  for (let i = 0; i < g.n; i++) if (g.pass[i] & 1) walkable++;
  const rows = [];
  for (const climb of tiers) {
    const { steps, at, res } = spanDist(g, climb, water, srcA, srcB);
    let area = 0;
    for (let i = 0; i < g.n; i++) if (res.dist[i] >= 0) area++;
    const slow = slowestMoveAtTier(climb), fast = fastestMoveAtTier(climb);
    rows.push({ tier: climb, climb, jump: climbToJump(climb), label: tierLabel(climb),
      steps, connected: Number.isFinite(steps), area, areaFrac: walkable ? area / walkable : 0,
      slowestMove: slow, fastestMove: fast,
      turnsBySlowest: turnsFor(steps, slow), turnsByFastest: turnsFor(steps, fast),
      routeTiles: at >= 0 ? pathOf(g, res, at) : null, dist: res.dist });
  }
  // Self-check on need[]: steps must never grow and turns must never grow as the climb rises.
  const violations = [];
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1], q = rows[i];
    if (cmp(q.steps, p.steps) > 0) violations.push({ code: 'ladder.steps-grew', fromTier: p.tier, toTier: q.tier, from: p.steps, to: q.steps });
    if (cmp(q.turnsBySlowest, p.turnsBySlowest) > 0) violations.push({ code: 'ladder.turns-grew', fromTier: p.tier, toTier: q.tier, from: p.turnsBySlowest, to: q.turnsBySlowest });
  }
  return { rows, monotone: violations.length === 0, violations, drops: dropsOf(g, rows, water),
    tiers, walkable, baseClimb, profiles };
}
const tierLabel = (c) => (Number.isFinite(c) ? `${c}h` : 'any') + (Number.isFinite(c) ? ` (JUMP ${climbToJump(c)})` : '');

function defCtx(g, def, profiles) {
  const d = def.design || {};
  return { baseClimb: d.baseTier ?? 4, tiers: d.tiers, profiles,
    srcA: def.spawns?.A, srcB: def.spawns?.B };
}

/**
 * Which edges produced each saving. "Tiers not ordered" is useless feedback; "the 6h row got 9
 * steps shorter and it spent them at (11,9)->(11,10), a 6h face" tells you which face stopped
 * mattering when you flatten it.
 */
function dropsOf(g, rows, water) {
  const need = water ? g.needW : g.need, out = [];
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1], q = rows[i];
    const dSteps = Number.isFinite(p.steps) && Number.isFinite(q.steps) ? p.steps - q.steps
      : Number.isFinite(q.steps) ? Infinity : 0;
    if (!(dSteps > 0)) continue;
    const viaEdges = [];
    const path = q.routeTiles || [];
    for (let k = 1; k < path.length; k++) {
      const a = g.idx(path[k - 1][0], path[k - 1][1]), b = g.idx(path[k][0], path[k][1]);
      const e = b === a + 1 ? 2 * a : a === b + 1 ? 2 * b : b === a + g.w ? 2 * a + 1 : 2 * b + 1;
      if (need[e] > p.tier && need[e] < NO_EDGE)
        viaEdges.push({ from: path[k - 1], to: path[k], need: need[e], jump: climbToJump(need[e]) });
    }
    out.push({ fromTier: p.tier, toTier: q.tier, dSteps,
      dTurns: turnsFor(p.steps, q.slowestMove) - turnsFor(q.steps, q.slowestMove), viaEdges });
  }
  return out;
}

/**
 * PLAN §4.7. `turnsAt(baseTier) - turnsAt(tier) >= savesTurns`, both measured with
 * slowestMoveAtTier(tier): the same worst-case class walking the long road and then the short one.
 * Measuring the base row with the BASE tier's slowest move would compare two different classes and
 * could manufacture a saving out of a MOVE difference.
 */
export function verifyPromises(lad, promises = [], opts = {}) {
  const base = lad.rows[0];
  const out = [];
  for (const pr of promises) {
    const row = lad.rows.find((r) => r.tier === pr.tier) || null;
    const move = slowestMoveAtTier(pr.tier);
    const b = turnsFor(base.steps, move), t = row ? turnsFor(row.steps, move) : Infinity;
    const measured = Number.isFinite(b) && Number.isFinite(t) ? b - t : Number.isFinite(t) ? Infinity : -Infinity;
    const need = pr.savesTurns ?? 1;
    out.push({ promise: pr, tier: pr.tier, move, requiredTurns: need, measuredTurns: measured,
      baseSteps: base.steps, tierSteps: row ? row.steps : Infinity,
      ok: measured >= need, margin: measured - need,
      why: row ? null : `no ladder row at tier ${pr.tier}` });
  }
  return out;
}

/**
 * Proof by deletion (PLAN §4.6). Remove the choke's tiles, re-flood at `climb`, require every B
 * spawn unreachable. the prototype returned a bare 'seal' string; a failing seal here returns the
 * COUNTEREXAMPLE — the escaping path and the tile on it that walked past the choke.
 * `vacuous` means the spawns were already severed at this climb, so the deletion proved nothing.
 */
export function sealProof(g0, choke, ctx = {}) {
  const g = asGraph(g0), water = !!ctx.water, climb = ctx.climb ?? choke?.tier ?? 4;
  const srcA = toNodes(g, ctx.srcA), srcB = toNodes(g, ctx.srcB);
  const tiles = toNodes(g, choke?.tiles || choke);
  const before = spanDist(g, climb, water, srcA, srcB);
  const cut = new Set(tiles);
  const liveA = srcA.filter((i) => !cut.has(i)), liveB = srcB.filter((i) => !cut.has(i));
  const gCut = blockNodes(g, tiles);
  const after = spanDist(gCut, climb, water, liveA, liveB);
  if (Number.isFinite(after.steps)) {
    const path = pathOf(gCut, after.res, after.at) || [];
    // The leak tile: the first step of the bypass that runs alongside the choke, else the midpoint.
    let leak = path.length ? path[path.length >> 1] : null;
    for (const [x, z] of path) {
      const near = [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]].some(([a, b]) => cut.has(g.idx(a, b)));
      if (near) { leak = [x, z]; break; }
    }
    return { sealed: false, climb, tiles: tiles.length, leak, leakPath: path, steps: after.steps,
      vacuous: false, note: `flood escaped in ${after.steps} steps` };
  }
  return { sealed: true, climb, tiles: tiles.length, leak: null, leakPath: null, steps: Infinity,
    vacuous: !Number.isFinite(before.steps),
    note: Number.isFinite(before.steps) ? null : 'spawns were already severed at this climb' };
}

/**
 * Regions only a higher tier can enter (PLAN §4.6). Every walkable tile outside the base-tier
 * component, grouped into connected patches and labelled with the MINIMUM tier that reaches it —
 * "this ledge is Ninja-only, 6 tiles". `tier: null` is worse news: nothing in the roster reaches it
 * at all, so the patch is dead board.
 */
export function pockets(g0, ctx = {}) {
  const g = asGraph(g0), water = !!ctx.water, climb = ctx.climb ?? ctx.baseClimb ?? 4;
  const srcA = toNodes(g, ctx.srcA);
  const tiers = tierList(climb, ctx.tiers);
  const base = reachField(g, { climb, water }, srcA);
  const tf = tierField(g, tiers.map((c) => ({ id: 't' + c, climb: c, water, move: slowestMoveAtTier(c) })), srcA);
  const seen = new Uint8Array(g.n), out = [], stack = [];
  for (let i = 0; i < g.n; i++) {
    if (seen[i] || !(g.pass[i] & 1) || base.dist[i] >= 0) continue;
    const key = tf.minClimb[i];
    const tiles = [];
    stack.push(i); seen[i] = 1;
    while (stack.length) {                                  // flood the patch at its own tier
      const j = stack.pop(); tiles.push(g.xz(j));
      const x = j % g.w;
      for (const k of [x + 1 < g.w ? j + 1 : -1, x > 0 ? j - 1 : -1, j + g.w < g.n ? j + g.w : -1, j - g.w])
        if (k >= 0 && k < g.n && !seen[k] && (g.pass[k] & 1) && base.dist[k] < 0 && tf.minClimb[k] === key)
          { seen[k] = 1; stack.push(k); }
    }
    // tierField encodes "reached only by the unbounded ignore_height tier" as NO_EDGE and "no
    // supplied tier reaches it" as -1. The first is a legible design statement; the second is dead board.
    const reach = key === -1 ? null : key === NO_EDGE ? Infinity : key;
    out.push({ tier: reach, jump: reach === null ? null : climbToJump(reach), tiles,
      size: tiles.length, at: tiles[0],
      note: reach === null ? 'unreachable at every roster tier'
        : !Number.isFinite(reach) ? 'ignore_height classes only (Wyrmlancer, Wyrm, Behemoth)'
          : `reachable from ${reach}h (JUMP ${climbToJump(reach)})` });
  }
  out.sort((a, b) => b.size - a.size || a.at[1] - b.at[1] || a.at[0] - b.at[0]);
  return out;
}
