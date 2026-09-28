// The INTENT tools (PLAN §6.7). Spawn slots, faces, chokes, routes, regions, assists and promises —
// the records validate.js proves or refutes and analysis/report.js prices.
//
// This is the half of the editor that makes verticality reviewable. A height brush writes a 6h step;
// only a DECLARATION says the step is meant to be a jump-3 express that saves two turns, and only a
// declaration can be wrong. `node tools/mapcheck.mjs` then does the counterfactual — cut the edge,
// re-BFS, compare — so "this is an express" is a claim with a proof or a failing check behind it,
// never a comment in a map file. Authoring without these tools produces terrain; authoring with them
// produces terrain plus the argument for it.
//
// TWO RULES RUN THROUGH EVERY HELPER BELOW.
// 1. MEASURE, NEVER TAKE. A face's `drop` and `tier` are read off the grid the transaction is
//    writing into, exactly as Canvas.declareFace does, because validate.js checks drop against |dH|
//    to the step and a hand-passed number is a bug waiting for the next terrain tweak.
// 2. ONE TRANSACTION. Every declaration goes through Tx.declare(), so it undoes with the edit that
//    motivated it and a half-declared map cannot survive a Ctrl+Z.
//
// Zero three.js and zero DOM.
import { defineTool } from '../registry.js';
import { TIER_KINDS, REGION_KINDS, TEAMS, DEFAULTS, LETTERS } from '../../world/mapformat/schema.js';
import { NEIGH4 } from '../../world/mapformat/graph.js';
import { TIERS } from '../../world/analysis/profiles.js';
import { ctxPoint, ctxRect, ctxPoly, ctxTiles } from './select.js';
import { stampProp, pickPropAt } from './props.js';

const FINITE_TIERS = TIERS.filter(Number.isFinite);
const TIER_OPTS = FINITE_TIERS.map((t) => ({ v: t, label: `${t}h` }));
const TEAM_OPTS = TEAMS.map((t) => ({ v: t, label: `team ${t}` }));
const NOTE = { k: 'note', type: 'text', label: 'note', def: '', hint: 'the sentence the report quotes back' };
/** The roster tier a drop rounds UP to — identical to Canvas.tierFor and validate.js's tierFor, and
 *  read off the LIVE roster so a new class changes what a declaration means without an edit here. */
export const tierFor = (drop) => TIERS.find((t) => t >= drop) ?? Infinity;
const hAt = (def, x, z) => def.grid.H[z][x];
const walkAt = (def, x, z) => { const L = LETTERS[def.grid.T[z][x]]; return !!(L && L.walk); };
const inb = (def, x, z) => x >= 0 && z >= 0 && x < def.size.w && z < def.size.d;

/** First unused id of a design list — `face3`, `choke2`. Scanned rather than counted, so importing a
 *  map whose author numbered by hand cannot produce two records with the same id. */
export function nextId(def, list, idKey, prefix) {
  const used = new Set(((def.design || {})[list] || []).map((r) => r && r[idKey]));
  let n = used.size + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/**
 * Declare a vertical shortcut. `drop`/`tier` are measured, and the pair is checked for the shape
 * validate.js demands (contract.face-shape): orthogonally adjacent, in bounds, both walkable.
 * @returns {object|null} the FaceDef written, or null when the pair is not a face
 */
export function declareFace(tx, o) {
  const def = tx.def, [ax, az] = o.from, [bx, bz] = o.to;
  if (!inb(def, ax, az) || !inb(def, bx, bz)) return null;
  if (Math.abs(ax - bx) + Math.abs(az - bz) !== 1) return null;
  if (!walkAt(def, ax, az) || !walkAt(def, bx, bz)) return null;
  const drop = Math.abs(hAt(def, ax, az) - hAt(def, bx, bz));
  // `from` is the high side by convention (Canvas.declareFace), so a face reads the way an author
  // narrates the hop even though the rules' height test is symmetric.
  const hiFirst = hAt(def, ax, az) >= hAt(def, bx, bz);
  const rec = { fid: o.fid || nextId(def, 'faces', 'fid', 'face'),
    from: hiFirst ? [ax, az] : [bx, bz], to: hiFirst ? [bx, bz] : [ax, az],
    drop, tier: tierFor(drop), kind: o.kind || 'express',
    minTurnSaving: o.minTurnSaving ?? 1, note: o.note || '' };
  if (o.minSaving != null) rec.minSaving = o.minSaving;
  tx.declare('face', rec);
  return rec;
}
/** A claimed bottleneck. Proven later by deletion: remove the tiles, re-BFS at `tier`, require the
 *  far spawn set unreachable (contract.seal). */
export function declareChoke(tx, o) {
  const tiles = (o.tiles || []).filter(([x, z]) => inb(tx.def, x, z));
  if (!tiles.length) return null;
  const rec = { cid: o.cid || nextId(tx.def, 'chokes', 'cid', 'choke'), tiles: tiles.map(([x, z]) => [x, z]),
    tier: o.tier ?? (tx.def.design?.baseTier ?? DEFAULTS.baseTier), note: o.note || '' };
  tx.declare('choke', rec);
  return rec;
}
/** A travel claim per tier. The `via` waypoints are the assertion: they prove the long way round is
 *  still the long way round, so a switchback the generator optimised away fails route-detour. */
export function declareRoute(tx, o) {
  const via = (o.via || []).filter(([x, z]) => inb(tx.def, x, z));
  const rec = { rid: o.rid || nextId(tx.def, 'routes', 'rid', 'route'), tier: o.tier ?? (tx.def.design?.baseTier ?? DEFAULTS.baseTier),
    from: o.from || 'A', to: o.to || 'B', via: via.map(([x, z]) => [x, z]), note: o.note || '' };
  tx.declare('route', rec);
  return rec;
}
/** A named rectangle of intent. `scenery` is the load-bearing kind: it is the one exemption from the
 *  gentleness sweep, which is how a map carries dramatic relief with no accidental shortcut. */
export function declareRegion(tx, o) {
  const [x0, z0, x1, z1] = o.rect;
  const rec = { rgid: o.rgid || nextId(tx.def, 'regions', 'rgid', 'rg'), kind: o.kind || 'note',
    rect: [Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)], note: o.note || '' };
  tx.declare('region', rec);
  return rec;
}
/**
 * The `stairs` prop doing traversal work. FABLE has no ladder entity — the second tread is the whole
 * mechanism — so `bridges` is measured from the tile's own baseTier approaches: the lowest and
 * highest neighbour a unit can actually step between there. validate.js calls the assist useless
 * unless those two differ by more than baseTier, which is exactly the case where the tread matters.
 */
export function declareAssist(tx, o) {
  const def = tx.def, base = def.design?.baseTier ?? DEFAULTS.baseTier;
  const tiles = (o.tiles || []).filter(([x, z]) => inb(def, x, z) && walkAt(def, x, z));
  if (!tiles.length) return null;
  let lowH = Infinity, highH = -Infinity;
  for (const [x, z] of tiles) {
    const h = hAt(def, x, z);
    for (const [dx, dz] of NEIGH4) {
      const nx = x + dx, nz = z + dz;
      if (!inb(def, nx, nz) || !walkAt(def, nx, nz)) continue;
      const nh = hAt(def, nx, nz);
      if (Math.abs(nh - h) > base) continue;
      if (nh < lowH) lowH = nh; if (nh > highH) highH = nh;
    }
  }
  if (!Number.isFinite(lowH)) { lowH = hAt(def, tiles[0][0], tiles[0][1]); highH = lowH; }
  const rec = { aid: o.aid || nextId(def, 'assists', 'aid', 'assist'), kind: 'stairs',
    tiles: tiles.map(([x, z]) => [x, z]), dir: o.dir || 'n', bridges: { lowH, highH }, note: o.note || '' };
  tx.declare('assist', rec);
  return rec;
}
/** Acceptance stated in TURNS, the design-facing unit, verified against the SLOWEST class in the
 *  tier. Carries no id: the schema addresses a promise by index. */
export function declarePromise(tx, o) {
  const rec = { from: o.from || 'A', to: o.to || 'B', tier: o.tier ?? DEFAULTS.baseTier, savesTurns: o.savesTurns ?? 1 };
  tx.declare('promise', rec);
  return rec;
}
/** Seat one deploy slot. ORDER IS SIGNIFICANT: main.js index-matches spawns[team][i] to
 *  roster[team][i], so a slot is a class and this is a move, never an append. */
export function setSpawnSlot(tx, team, slot, x, z) {
  if (!TEAMS.includes(team) || slot < 0 || slot >= DEFAULTS.spawnsPerTeam) return false;
  if (!inb(tx.def, x, z)) return false;
  return tx.setSpawn(team, slot, x, z);
}

// ---- records ------------------------------------------------------------------------------------
// Declarations are `tool` records with apply(): they write, so they are transactional, but they are
// discrete acts rather than strokes and must never coalesce into the brush that preceded them.
const tool = (rec) => { const out = defineTool({ group: 'design', channels: ['design'], coalesce: false, ...rec,
  apply(tx, ctx = {}) { return rec.run2(tx, ctx, { ...out.defaults, ...(ctx.params || {}) }); } }); return out; };

tool({ id: 'design.spawn', label: 'Spawn slot', key: 'shift+s', order: 30, cursor: 'click', channels: ['spawns'],
  tip: 'Seat one deploy slot. Five per team, and slot i is roster[team][i] — a class, not a pin.',
  params: [{ k: 'team', type: 'enum', label: 'team', options: TEAM_OPTS, def: 'A' },
    { k: 'slot', type: 'enum', label: 'slot', options: [0, 1, 2, 3, 4].map((i) => ({ v: i, label: `${i + 1}` })), def: 0 }],
  run2(tx, ctx, p) { const q = ctxPoint(ctx); return q ? setSpawnSlot(tx, p.team, p.slot, q.x, q.z) : false; } });

tool({ id: 'design.face', label: 'Declare face', key: 'shift+f', order: 31, cursor: 'line',
  tip: 'Drag across one cliff edge. The drop and the tier are measured off the terrain, never typed.',
  params: [{ k: 'kind', type: 'enum', label: 'kind', options: TIER_KINDS.map((k) => ({ v: k, label: k })), def: 'express' },
    { k: 'minTurnSaving', type: 'number', label: 'must save', min: 0, max: 8, def: 1, unit: 'turns' },
    { k: 'minSaving', type: 'number', label: 'must save', min: 0, max: 40, def: 1, unit: 'steps' }, NOTE],
  run2(tx, ctx, p) {
    // A 'line' cursor hands over from/to; a poly or a drag both degrade to their two ends. The rect
    // reader sorts its corners, which is harmless here because declareFace re-orders by HEIGHT.
    const pair = (v) => (Array.isArray(v) ? [Math.floor(v[0]), Math.floor(v[1])] : v && Number.isFinite(v.x) ? [Math.floor(v.x), Math.floor(v.z)] : null);
    const poly = ctxPoly(ctx);
    let from = pair(ctx.from), to = pair(ctx.to);
    if (!from || !to) { from = poly.length >= 2 ? poly[0] : null; to = poly.length >= 2 ? poly[poly.length - 1] : null; }
    if (!from || !to) { const r = ctxRect(ctx, tx.def); from = r && [r[0], r[1]]; to = r && [r[2], r[3]]; }
    return from && to ? declareFace(tx, { from, to, kind: p.kind, minTurnSaving: p.minTurnSaving, minSaving: p.minSaving, note: p.note }) : null;
  } });

tool({ id: 'design.choke', label: 'Declare choke', order: 32, cursor: 'drag-rect',
  tip: 'The selection (or the drag rect) is the bottleneck. mapcheck deletes it and re-floods to prove the seal.',
  params: [{ k: 'tier', type: 'enum', label: 'seals at', options: TIER_OPTS, def: 4 }, NOTE],
  run2(tx, ctx, p) { return declareChoke(tx, { tiles: ctxTiles(ctx, tx.def), tier: p.tier, note: p.note }); } });

tool({ id: 'design.route', label: 'Declare route', order: 33, cursor: 'poly',
  tip: 'Click the waypoints the path must go through at this tier.',
  params: [{ k: 'tier', type: 'enum', label: 'tier', options: TIER_OPTS, def: 4 },
    { k: 'from', type: 'enum', label: 'from', options: TEAM_OPTS, def: 'A' },
    { k: 'to', type: 'enum', label: 'to', options: TEAM_OPTS, def: 'B' }, NOTE],
  run2(tx, ctx, p) { const via = ctxPoly(ctx); return via.length ? declareRoute(tx, { via, tier: p.tier, from: p.from, to: p.to, note: p.note }) : null; } });

tool({ id: 'design.region', label: 'Declare region', order: 34, cursor: 'drag-rect',
  tip: "Name a rectangle. 'scenery' is the one kind the gentleness sweep exempts; staging and road also keep decoration off.",
  params: [{ k: 'kind', type: 'enum', label: 'kind', options: REGION_KINDS.map((k) => ({ v: k, label: k })), def: 'staging' }, NOTE],
  run2(tx, ctx, p) { const r = ctxRect(ctx, tx.def); return r ? declareRegion(tx, { rect: r, kind: p.kind, note: p.note }) : null; } });

tool({ id: 'design.assist', label: 'Declare assist', order: 35, cursor: 'click', channels: ['design', 'props'],
  tip: 'A stairs prop carrying the base tier over a 2h break. Stamps the prop when the tile has none.',
  params: [{ k: 'dir', type: 'enum', label: 'ascent', options: ['n', 's', 'e', 'w'].map((d) => ({ v: d, label: d })), def: 'n' },
    { k: 'place', type: 'toggle', label: 'stamp the stairs prop', def: true }, NOTE],
  run2(tx, ctx, p) {
    const q = ctxPoint(ctx);
    if (!q) return null;
    if (p.place && !pickPropAt(tx.def, q.x, q.z, 'stairs')) stampProp(tx, 'stairs', q.x, q.z, { dir: p.dir });
    return declareAssist(tx, { tiles: [[q.x, q.z]], dir: p.dir, note: p.note });
  } });

tool({ id: 'design.promise', label: 'Declare promise', order: 36, cursor: 'none',
  tip: 'Acceptance in TURNS for the slowest class in the tier — the number a designer actually feels.',
  params: [{ k: 'tier', type: 'enum', label: 'tier', options: TIER_OPTS, def: 6 },
    { k: 'from', type: 'enum', label: 'from', options: TEAM_OPTS, def: 'A' },
    { k: 'to', type: 'enum', label: 'to', options: TEAM_OPTS, def: 'B' },
    { k: 'savesTurns', type: 'number', label: 'saves', min: 0, max: 20, def: 1, unit: 'turns' }],
  run2(tx, ctx, p) { return declarePromise(tx, { from: p.from, to: p.to, tier: p.tier, savesTurns: p.savesTurns }); } });

export const DESIGN_TOOL_IDS = Object.freeze(['design.spawn', 'design.face', 'design.choke',
  'design.route', 'design.region', 'design.assist', 'design.promise']);
