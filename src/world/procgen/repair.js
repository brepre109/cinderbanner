// Repair before rejection (PLAN §3.5, §5.3). A candidate with three fixable faults is not a failed
// candidate, it is an unfinished one — and throwing it away costs a whole attempt to re-roll faults
// the validator has already told us how to mend.
//
// Most of the work is NOT done here: validate.js attaches an executable `fix(def) -> def` to roughly
// a third of its findings, and those fixes are pure and idempotent by contract, which is exactly
// what lets them be applied in any order and in bulk. This module is the policy layer — WHICH codes
// a generator is allowed to auto-mend without a human looking — plus the two repairs no single
// finding can express, because they need the whole board: seating a spawn somewhere legal, and
// cutting a stair flight through a base-tier severance.
//
// Every repair is recorded by code and lands in `gen.repairs`, so a map that needed mending says so
// on its own face rather than looking hand-authored. Zero three.js.
import { validateDef } from '../mapformat/validate.js';
import { compileMap } from '../mapformat/compile.js';
import { buildGraph, reachField } from '../jumpgraph.js';
import { H_MIN, H_MAX } from '../mapformat/schema.js';

/**
 * Codes a generator may mend unattended. The test for membership is "the fix restores an invariant
 * the renderer or the engine requires, and cannot change what the map MEANS": levelling a water
 * body or deleting an out-of-bounds prop qualifies; re-declaring a face's tier or its drop does not,
 * because that would let the generator quietly rewrite the design contract it is being judged
 * against and then pass. Those stay rejections.
 */
export const REPAIRABLE = Object.freeze(new Set([
  'shape.format', 'shape.version', 'shape.height-nan', 'shape.height-range', 'shape.height-noninteger',
  'shape.letter', 'water.mixed-height', 'water.above-land', 'void.touches-water', 'void.above-cut',
  'prop.unknown-type', 'prop.oob-unsafe', 'prop.oob-soft', 'prop.missing-wd', 'prop.coord-convention',
  'prop.h-units', 'prop.on-unwalkable', 'prop.footprint-overlap', 'prop.on-deck', 'prop.blocks-only-route',
  'deck.no-grant', 'deck.height-mismatch',
]));

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
const key = (x, z) => x + ',' + z;
const H_LO = H_MIN + 1, H_HI = H_MAX;   // schema.js's land floor is EXCLUSIVE, so stay one step inside

/**
 * @param {import('../mapformat/schema.js').MapDef} def
 * @param {Array<{code:string, severity:string, fix?:{apply:Function}, at?:Object}>} issues from validateDef
 * @returns {{def:import('../mapformat/schema.js').MapDef, applied:string[]}} a NEW document
 *
 * ROUNDS, not one pass. validate.js caps findings at 16 per code with a `meta.suppressed` tail, so a
 * twenty-tile water seam reports sixteen fixes and mends sixteen tiles; the seventeenth only becomes
 * visible once the first sixteen are gone. Each round re-validates, and a round that does not
 * strictly reduce the error count is ROLLED BACK — a repair pass that makes a map worse and returns
 * it is the one failure mode worse than rejecting the candidate outright.
 */
export function repair(def, issues = []) {
  let out = def, cur = issues, best = errorsOf(issues);
  const applied = [];
  for (let round = 0; round < 4; round++) {
    const step = onePass(out, cur);
    if (!step.applied.length) break;
    const v = validateDef(step.def), n = errorsOf(v.issues);
    if (n >= best) break;                       // no progress: keep the better document and stop
    out = step.def; cur = v.issues; best = n; applied.push(...step.applied);
    if (v.ok) break;
  }
  return { def: out, applied };
}
const errorsOf = (issues) => (issues || []).reduce((n, i) => n + (i && i.severity === 'error' ? 1 : 0), 0);

/** One round: every whitelisted executable fix, then the two board-wide repairs no single finding
 *  can express. Deletions run last — a fix written against the pre-repair document is a no-op once
 *  its target has moved, and deleting a prop is the edit most likely to move one. */
function onePass(def, issues) {
  let out = def; const applied = [];
  for (const it of [...issues].sort((a, b) => rank(a) - rank(b))) {
    if (!it || !it.fix || typeof it.fix.apply !== 'function' || !REPAIRABLE.has(it.code)) continue;
    try { const next = it.fix.apply(out); if (next && typeof next === 'object') { out = next; applied.push(it.code); } } catch { /* stale fix */ }
  }
  if (issues.some((i) => i && /^spawn\.(unwalkable|oob|dup|isolated)$/.test(i.code))) {
    const r = reseat(out); if (r) { out = r; applied.push('spawn.reseat'); }
  }
  for (let n = 0; n < 3 && issues.some((i) => i && i.code === 'contract.disconnect'); n++) {
    const r = stairFlight(out); if (!r) break; out = r; applied.push('contract.disconnect');
  }
  return { def: out, applied };
}
const rank = (i) => (i.fix && /oob|unknown-type|on-unwalkable|footprint-overlap|on-deck|blocks-only-route/.test(i.code) ? 1 : 0);

/** Move every spawn that cannot deploy to the nearest tile that can, keeping slot ORDER — main.js
 *  index-matches spawns[team][i] to roster[team][i], so a reseat that reorders the list silently
 *  redeploys the whole party. Returns null when the board has nowhere legal to put one. */
function reseat(def) {
  const MAP = compileMap(def), g = buildGraph(MAP), base = (def.design && def.design.baseTier) || 4;
  const taken = new Set(), out = clone(def);
  const ok = (x, z) => { const t = MAP.at(x, z); if (!t || !t.walk || taken.has(key(x, z))) return false;
    return N4.some(([dx, dz]) => { const u = MAP.at(x + dx, z + dz); return u && u.walk && Math.abs(u.h - t.h) <= base; }); };
  for (const team of ['A', 'B']) {
    const list = Array.isArray(out.spawns && out.spawns[team]) ? out.spawns[team] : [];
    for (let s = 0; s < list.length; s++) {
      const p = Array.isArray(list[s]) ? list[s] : [0, 0];
      if (ok(p[0], p[1])) { taken.add(key(p[0], p[1])); continue; }
      const seat = nearestFree(g, MAP, p, ok);
      if (!seat) return null;
      list[s] = seat; taken.add(key(seat[0], seat[1]));
    }
  }
  return out;
}
/** Chebyshev spiral out from a tile until `ok` accepts one. Bounded by the board, so it terminates. */
function nearestFree(g, MAP, from, ok) {
  const x0 = Math.round(from[0]) || 0, z0 = Math.round(from[1]) || 0;
  for (let r = 0; r <= Math.max(g.w, g.d); r++)
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = x0 + dx, z = z0 + dz; if (ok(x, z)) return [x, z];
    }
  return null;
}

/**
 * PLAN §5.3's named repair: a base-tier severance is mended by cutting a stair flight at the
 * SHALLOWEST step on the frontier — the pair of tiles where the two sides come closest in height.
 *
 * The edit LIFTS THE WHOLE SEVERED COMPONENT rather than the one tile at the frontier. A uniform
 * shift preserves every internal step of that component exactly, so it cannot manufacture a new
 * undeclared face inside the region it is rescuing; moving the single frontier tile instead punches
 * a notch in whichever bench it belonged to and trades one error for three. The `stairs` props and
 * the matching design.assist are emitted with it, so the map documents the repair instead of
 * carrying an unexplained step. Returns null when the two sides never touch at all — a gap across
 * void or open water is not something a flight of stairs can cross.
 */
function stairFlight(def) {
  const MAP = compileMap(def), g = buildGraph(MAP), base = (def.design && def.design.baseTier) || 4;
  const nodes = (list) => (Array.isArray(list) ? list : []).map((s) => g.idx(s[0], s[1])).filter((i) => i >= 0 && (g.pass[i] & 1));
  const srcA = nodes(def.spawns && def.spawns.A), srcB = nodes(def.spawns && def.spawns.B);
  if (!srcA.length || !srcB.length) return null;
  const from = reachField(g, { climb: base }, srcA).dist;
  if (srcB.every((i) => from[i] >= 0)) return null;                     // not actually severed
  // The frontier is A's component against everything ELSE walkable, not against B's component: a
  // severance is usually a third island wedged between the two, and insisting on a tile B already
  // reaches would find no pair at all and mend nothing.
  // A DECLARED face is the shallowest frontier step on most of these maps, and it is the last edge
  // to touch: it is the deliberate one-way drop the whole ladder is built on, not a severance.
  const faces = new Set();
  for (const f of ((def.design && def.design.faces) || [])) { if (!f || !f.from || !f.to) continue;
    const a = g.idx(f.from[0], f.from[1]), b = g.idx(f.to[0], f.to[1]); faces.add(Math.min(a, b) + ':' + Math.max(a, b)); }
  let best = null;
  for (let i = 0; i < g.n; i++) {
    if (from[i] < 0 || !(g.pass[i] & 1)) continue;
    const x = i % g.w, z = (i / g.w) | 0;
    for (const [dx, dz] of N4) { const j = g.idx(x + dx, z + dz);
      if (j < 0 || from[j] >= 0 || !(g.pass[j] & 1) || faces.has(Math.min(i, j) + ':' + Math.max(i, j))) continue;
      const step = Math.abs(g.h[i] - g.h[j]);
      if (!best || step < best.step) best = { i, j, step, a: [x, z], b: [x + dx, z + dz] };
    } }
  if (!best || best.step <= base) return null;
  const island = reachField(g, { climb: base }, [best.j]).dist;         // the severed side, whole
  const delta = (g.h[best.i] > g.h[best.j] ? 1 : -1) * (best.step - base);
  const out = clone(def);
  for (let i = 0; i < g.n; i++) { if (island[i] < 0) continue;
    const x = i % g.w, z = (i / g.w) | 0;
    out.grid.H[z][x] = Math.max(H_LO, Math.min(H_HI, out.grid.H[z][x] + delta)); }
  const hi = g.h[best.i] > g.h[best.j] ? best.a : best.b, lo = g.h[best.i] > g.h[best.j] ? best.b : best.a;
  const dir = hi[1] < lo[1] ? 'n' : hi[1] > lo[1] ? 's' : hi[0] > lo[0] ? 'e' : 'w';
  out.props = [...(out.props || []), { pid: `pr_stair_${lo[0]}_${lo[1]}`, type: 'stairs', x: lo[0], z: lo[1], dir }];
  out.design = out.design || {};
  out.design.assists = [...(out.design.assists || []),
    { aid: `repair_stair_${lo[0]}_${lo[1]}`, kind: 'stairs', tiles: [lo, hi], dir,
      bridges: { lowH: out.grid.H[lo[1]][lo[0]], highH: out.grid.H[hi[1]][hi[0]] },
      note: `procgen repair: the ${best.step}h severance at ${lo[0]},${lo[1]} was the shallowest step on the frontier; its whole side moved ${delta}h` }];
  return out;
}
