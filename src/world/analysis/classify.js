// Shortcut-edge pricing and the taxonomy (PLAN §4.5) — where verticality becomes a number.
//
// A cliff is only worth what the detour around it costs. This module prices every edge the base
// tier CANNOT take against the base tier's own route length, so `routeGain` is "steps the long way
// round minus steps through the hole", and `turnGain` converts that into the unit a designer
// actually feels. the prototype declared faces and never priced them; here faces are DISCOVERED first
// (faceScan) and labelled second, which is why you cannot ship an accidental shortcut by
// forgetting to declare one.
//
// Two floods price the whole board: dA from team A and dB from team B, both at `baseClimb`. Every
// candidate edge (u,v) is then a constant-time query — dA[u] + 1 + dB[v]. The honest caveat, which
// the editor prints in its panel header rather than burying: this single-edge estimate undervalues
// two high edges taken IN SERIES, because both floods are on the base graph. analysis/ladder.js
// re-runs the real per-tier BFS and is the exact number.
//
// Zero three.js: runs under bare `node` for tools/mapcheck.mjs.
import { NO_EDGE, HEIGHT_STEP, reachField, turnsFor, climbToJump, blockEdges } from '../jumpgraph.js';
import { components } from '../mapformat/graph.js';
import { PROFILES, TIERS } from './profiles.js';

// rules.js:430 `if (drop > HEIGHT_STEP * 2 ...)` — knockback fall damage, 10% of max HP. An edge
// steeper than this is a hazard whether or not anyone can walk it (rules.md §3.11).
export const FALL_H = HEIGHT_STEP * 2;
/** PLAN §4.5 thresholds, named so the editor's legend and this file cannot drift. */
export const EXPRESS_STEPS = 6, EXPRESS_TURNS = 2;

/** Node ids from `[[x,z],...]`, an id array, or a single id. Out-of-bounds entries are dropped —
 *  a spawn outside the board is validate.js's error, not a reason for the analyser to throw. */
export function toNodes(g, spec) {
  if (spec == null) return [];
  if (typeof spec === 'number') return spec >= 0 && spec < g.n ? [spec] : [];
  const out = [];
  for (const s of spec) {
    if (typeof s === 'number') { if (s >= 0 && s < g.n) out.push(s); }
    else if (s && s.length >= 2) { const i = g.idx(s[0] | 0, s[1] | 0); if (i >= 0) out.push(i); }
  }
  return out;
}

/** Shortest step count from any A source to any B source at one climb, plus the flood that found
 *  it (so the caller can reconstruct the path without a second BFS). steps = Infinity if severed. */
export function spanDist(g, climb, water, srcA, srcB, out) {
  const res = reachField(g, { climb, water }, srcA, out || {});
  let steps = Infinity, at = -1;
  for (const b of srcB) { const dd = res.dist[b]; if (dd >= 0 && dd < steps) { steps = dd; at = b; } }
  return { steps, at, res };
}

/** The smallest climb the live roster actually fields that clears `drop`. A face's declared `tier`
 *  must equal this: a 5h drop is a 6h face, because no class has a 5h budget. */
export function tierOf(drop, tiers = TIERS) {
  for (const t of tiers) if (t >= drop) return t;
  return Infinity;
}

/** Order-insensitive identity of an edge, for matching a discovered face against a declared one.
 *  Faces are undirected: `from`/`to` in a MapDef record which way the author narrates the hop, not
 *  which way the rules admit it (rules.md §2: the height test is symmetric). */
export function faceKey(a, b) { return a < b ? `${a}:${b}` : `${b}:${a}`; }

/**
 * Every walkable-adjacent pair whose step exceeds `baseClimb` — the discovered faces of PLAN §4.5.
 * Both endpoints must be passable, so a cliff into void or open water is not a face: nothing can
 * stand on the far side at any tier.
 * @param {import('../jumpgraph.js').Graph} g
 * @param {number} baseClimb h budget of the base tier (design.baseTier)
 * @param {{water?:boolean, tiers?:number[]}} [opts]
 * @returns {Array<{e,a,b,from,to,hi,lo,x,z,dir,drop,need,tier,jump,fallDamage,key}>}
 */
export function faceScan(g, baseClimb, opts = {}) {
  const need = opts.water ? g.needW : g.need, tiers = opts.tiers || TIERS;
  const out = [];
  for (let a = 0; a < g.n; a++) {
    for (let dir = 0; dir < 2; dir++) {
      const e = 2 * a + dir, nd = need[e];
      if (nd >= NO_EDGE || nd <= baseClimb) continue;
      const b = dir === 0 ? a + 1 : a + g.w;
      const hiA = g.h[a] >= g.h[b];
      out.push({ e, a, b, from: g.xz(a), to: g.xz(b), hi: g.xz(hiA ? a : b), lo: g.xz(hiA ? b : a),
        x: a % g.w, z: (a / g.w) | 0, dir: dir === 0 ? 'x' : 'z', drop: nd, need: nd,
        tier: tierOf(nd, tiers), jump: climbToJump(nd), fallDamage: nd > FALL_H, key: faceKey(a, b) });
    }
  }
  out.sort((p, q) => q.drop - p.drop || p.a - q.a);
  return out;
}

// `classifyEdges(g, MAP, ctx)` (the wave brief) and `classifyEdges(g, ctx)` (PLAN §4.5) are the
// same call; MAP carries nothing this module needs that the Graph does not already hold.
const ctxOf = (b, c) => (b && (b.tiles || typeof b.at === 'function') ? c || {} : b || {});

/**
 * Price and label every shortcut edge. PLAN §4.5, with the taxonomy in the table there.
 *
 * @param {import('../jumpgraph.js').Graph} g
 * @param {{baseClimb?:number, srcA?, srcB?, profiles?, water?:boolean, tiers?:number[]}} ctx
 * @returns {Array<Shortcut>} sorted by turn saving, then step saving, then steepness
 *   Shortcut = { a,b,x,z,dir,need,jump,tier, localDetour, routeGain, dShort, D0,
 *                turnGain:{[profileId]:number}, maxTurnGain, eligible:[id],
 *                kind:'gate'|'express'|'local'|'cosmetic'|'trap', fallDamage, strands, estimate }
 */
export function classifyEdges(g, b, c) {
  const ctx = ctxOf(b, c);
  const water = !!ctx.water, baseClimb = ctx.baseClimb ?? 4;
  const profiles = ctx.profiles || PROFILES;
  const srcA = toNodes(g, ctx.srcA), srcB = toNodes(g, ctx.srcB);
  const need = water ? g.needW : g.need;
  const dA = reachField(g, { climb: baseClimb, water }, srcA);
  const dB = reachField(g, { climb: baseClimb, water }, srcB);
  let D0 = Infinity;
  for (const a of srcA) { const dd = dB.dist[a]; if (dd >= 0 && dd < D0) D0 = dd; }
  // Base-tier component labels, so the per-candidate detour BFS runs only for the edges whose
  // endpoints are already base-connected; the rest are Infinity by construction.
  const lab = components(g.n, (u, v, e) => need[e] <= baseClimb, g.w);
  const scratch = { dist: new Int16Array(g.n), prev: new Int32Array(g.n), q: new Int32Array(g.n) };
  const bcache = new Map();               // one bridge pass per distinct need value, this graph only
  const bridges = (t) => { let r = bcache.get(t); if (!r) bcache.set(t, r = bridgesAt(g, need, t)); return r; };
  const out = [];
  for (const f of faceScan(g, baseClimb, { water, tiers: ctx.tiers })) {
    const a = f.a, v = f.b;
    const via = (du, dv) => (du < 0 || dv < 0 ? Infinity : du + 1 + dv);
    const dShort = Math.min(via(dA.dist[a], dB.dist[v]), via(dA.dist[v], dB.dist[a]));
    // A shortcut that does not join A to B at all earns 0, never -Infinity: it is useless, not
    // harmful, and a negative gain would sort above a genuine cosmetic edge.
    const routeGain = !Number.isFinite(dShort) ? 0 : Number.isFinite(D0) ? D0 - dShort : Infinity;
    const localDetour = lab[a] !== lab[v] ? Infinity
      : reachField(g, { climb: baseClimb, water }, [a], scratch).dist[v];
    // PLAN §4.5 uses `localDetour === Infinity` as the gate test. That proxy over-fires badly: a
    // lone 6h pillar in an open field has FOUR edges whose endpoints are base-disconnected, and
    // calling all four "the only connector" is the opposite of useful — delete any one and the
    // other three still stand. The label is decided instead by the exact cut test at the edge's own
    // tier, with a two-tile floor on the region opened: a bridge onto a single ledge tile is a
    // perch, not a gate, and saying "gate" about it buries the real gates in the panel.
    const bi = bridges(f.need);
    const side = bi.cut[f.e];
    const isGate = side > 0 && Math.min(side, bi.comp[a] - side) >= 2;
    const turnGain = {}; const eligible = [];
    let maxTurnGain = 0;
    for (const p of profiles) {
      if (p.climb < f.need || (water && !p.water)) continue;   // this class cannot take the edge
      const tg = turnsFor(D0, p.move) - turnsFor(dShort, p.move);
      const val = Number.isNaN(tg) ? 0 : tg;                   // Infinity - Infinity
      turnGain[p.id] = val; eligible.push(p.id);
      if (val > maxTurnGain) maxTurnGain = val;
    }
    const kind = isGate ? 'gate'
      : routeGain >= EXPRESS_STEPS || maxTurnGain >= EXPRESS_TURNS ? 'express'
        : routeGain >= 1 ? 'local'
          : f.fallDamage ? 'trap' : 'cosmetic';
    out.push({ ...f, localDetour, routeGain, dShort, D0, turnGain, maxTurnGain, eligible, kind,
      // The region this edge opens, when it is the only way in: what a `gate` actually gates.
      cutSize: side > 0 ? Math.min(side, bi.comp[a] - side) : 0,
      // Edge weights are |dh| and therefore symmetric: whatever climbs down can climb back up, so
      // no walkable edge strands anyone by itself (rules.md §2). The real one-way move is a
      // KNOCKBACK fall, and it strands only where this edge is also the sole connector.
      strands: isGate && f.fallDamage, estimate: true });
  }
  // cmp, not subtraction: two gates both score Infinity and Infinity - Infinity is NaN, which
  // makes the comparator inconsistent and the table order depend on the engine's sort.
  out.sort((p, q) => cmp(q.maxTurnGain, p.maxTurnGain) || cmp(q.routeGain, p.routeGain) || q.need - p.need || p.a - q.a);
  return out;
}
const cmp = (x, y) => (x === y ? 0 : x < y ? -1 : 1);   // Infinity - Infinity is NaN; never subtract

/**
 * Bridges of the subgraph at climb <= c, with the size of the region each bridge splits off.
 * `cut[e] > 0` iff deleting edge e disconnects its endpoints at that climb; the value is the node
 * count on the subtree side, and `comp[i]` is i's whole component size, so the smaller side is
 * min(cut[e], comp[a] - cut[e]).
 *
 * Iterative Tarjan low-link, one pass per DISTINCT need value rather than one union-find per
 * candidate edge: on a 48x48 board that is ~20 passes instead of ~1000, which is the difference
 * between the editor analysing a stroke and dropping frames. No recursion — a 2304-node grid path
 * would blow the stack.
 */
function bridgesAt(g, need, c) {
  const n = g.n, w = g.w;
  const disc = new Int32Array(n).fill(-1), low = new Int32Array(n), sz = new Int32Array(n);
  const cut = new Int32Array(2 * n), comp = new Int32Array(n);
  const st = new Int32Array(n + 1), pe = new Int32Array(n + 1), ni = new Int8Array(n + 1), seen = new Int32Array(n);
  let timer = 0;
  for (let s0 = 0; s0 < n; s0++) {
    if (disc[s0] !== -1) continue;
    let sp = 0, cnt = 0;
    st[0] = s0; pe[0] = -1; ni[0] = 0; disc[s0] = low[s0] = timer++; sz[s0] = 1; seen[cnt++] = s0;
    while (sp >= 0) {
      const u = st[sp];
      if (ni[sp] < 4) {
        const k = ni[sp]++;
        const v = k === 0 ? (u % w !== w - 1 ? u + 1 : -1) : k === 1 ? (u % w !== 0 ? u - 1 : -1)
          : k === 2 ? (u + w < n ? u + w : -1) : u - w;
        if (v < 0) continue;
        const e = k === 0 ? 2 * u : k === 1 ? 2 * v : k === 2 ? 2 * u + 1 : 2 * v + 1;
        if (need[e] > c || e === pe[sp]) continue;          // NO_EDGE fails this, so does the parent
        if (disc[v] === -1) { disc[v] = low[v] = timer++; sz[v] = 1; seen[cnt++] = v; st[++sp] = v; pe[sp] = e; ni[sp] = 0; }
        else if (disc[v] < low[u]) low[u] = disc[v];
      } else {
        const e = pe[sp--];
        if (sp < 0) break;
        const p = st[sp];
        if (low[u] < low[p]) low[p] = low[u];
        sz[p] += sz[u];
        if (low[u] > disc[p]) cut[e] = sz[u];
      }
    }
    for (let i = 0; i < cnt; i++) comp[seen[i]] = cnt;
  }
  return { cut, comp };
}

/**
 * COUNTERFACTUAL PROOF that a declared face earns its keep (PLAN §4.5). the prototype's ordering check can
 * pass by luck — a tier that got shorter for some unrelated reason looks identical to a tier that
 * used the face. Here the face's edge is cut in both directions and the tier BFS re-run: `saving`
 * is the difference the face itself makes, and a declared face whose saving is 0 is a decoration
 * the author believes is a mechanic.
 * @param {{a:number,b:number,need?:number,tier?:number}} face a faceScan record or {a,b}
 * @returns {{with:number, without:number, saving:number, turns:Object, climb:number, sealed:boolean}}
 */
export function faceSaving(g, face, ctx = {}) {
  const water = !!ctx.water, profiles = ctx.profiles || PROFILES;
  const srcA = toNodes(g, ctx.srcA), srcB = toNodes(g, ctx.srcB);
  const climb = ctx.climb ?? face.tier ?? face.need ?? (ctx.baseClimb ?? 4);
  const withD = spanDist(g, climb, water, srcA, srcB).steps;
  const withoutD = spanDist(blockEdges(g, [[face.a, face.b]]), climb, water, srcA, srcB).steps;
  const turns = {};
  for (const p of profiles) {
    if (p.climb < climb || (water && !p.water)) continue;
    const t = turnsFor(withoutD, p.move) - turnsFor(withD, p.move);
    turns[p.id] = Number.isNaN(t) ? 0 : t;
  }
  return { with: withD, without: withoutD,
    saving: Number.isFinite(withD) ? (Number.isFinite(withoutD) ? withoutD - withD : Infinity) : 0,
    turns, climb, sealed: !Number.isFinite(withoutD) };
}
