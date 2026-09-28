// Movement profiles derived from the LIVE roster (PLAN §4.2). Nothing here is a hardcoded
// representative-class table: every number is read out of src/game/data.js through the same
// arithmetic rules.js `stat()` uses, so a gameplay owner adding a class updates the analyser for
// free. The bug this prevents is concrete — a hardcoded {tier:2, cls:'treant'} probe picks a
// terrain_walker, and its 2h flood then silently walks across every river on the board.
//
// Units: `jump` is the JUMP stat; `climb` is the height budget in h that rules.js actually tests
// (`|dh| <= jump * HEIGHT_STEP`). jumpgraph.js weighs edges in h, so climb is the currency here.
// Zero three.js: this module runs under bare `node` for tools/mapcheck.mjs.
import { CLASSES, MOVEMENTS } from '../../game/data.js';
import { HEIGHT_STEP } from '../../game/rules.js';

// MOVEMENTS.ignore_height is `jump: 99` — a sentinel, not a number to multiply. Anything at or
// above it clears every cliff on any legal board, so it is the Infinity tier, exactly as PLAN
// §4.2 lists it ([2,4,6,10,12,14,Infinity]).
export const UNBOUNDED_JUMP = 99;
// Excluded from PROFILES entirely: rules.js:163 short-circuits teleport to a Manhattan disc that
// ignores connectivity AND jump, so it is not a routing tier and cannot be BFS'd.
export const TELEPORT_MOVEMENT = 'teleport';

const ZERO = Object.freeze({ jump: 0, move: 0, water: false });

/**
 * The MOVEMENTS rows that actually shift a profile, as {jump, move, water} deltas. Read from the
 * live table rather than listed: today that is jump_plus2/acrobat/ignore_height/shinobi_stride/
 * float_move (jump), the six Move +1 flavours and move_plus2 (move), and terrain_walker (water).
 * `water` is deliberately NOT float_move — rules.js:161 crosses water for `terrain_walker` or the
 * Float STATUS only; float_move is jump-only flavour.
 * @type {Readonly<Record<string, Readonly<{jump:number, move:number, water:boolean}>>>}
 */
export const MOVEMENT_MODS = Object.freeze(buildMods());
function buildMods() {
  const out = {};
  for (const id of Object.keys(MOVEMENTS)) {
    const m = MOVEMENTS[id];
    const jump = m.jump || 0, move = m.move || 0, water = id === 'terrain_walker';
    if (jump || move || water) out[id] = Object.freeze({ jump, move, water });
  }
  return out;
}
// The Float status, the one non-MOVEMENTS source of both (rules.js:41 jump +1, :161 water).
export const STATUS_FLOAT_MOD = Object.freeze({ jump: 1, move: 0, water: true });

/** h budget for a JUMP stat. Mirrors rules.js:174 `Math.abs(t.h - t0.h) > jump * HEIGHT_STEP`. */
export function climbOf(jump) { return jump >= UNBOUNDED_JUMP ? Infinity : jump * HEIGHT_STEP; }
/** Bucket key. Water splits the tier because a water-crosser at the same climb routes differently. */
export function tierIdOf(climb, water) { return 't' + (Number.isFinite(climb) ? climb : 'INF') + (water ? 'w' : ''); }

/**
 * One class's profile, with the movement ability and the Float status modelled as OPTIONAL
 * modifiers. This is the single implementation of the stat arithmetic; CLASS_PROFILES is just
 * this called over the roster, and the parity probe in tools builds its units from it.
 * `moveBonus` is excluded from the baseline on purpose (PLAN §4.2): it is engine-owned per turn.
 * @param {string} clsId
 * @param {{movement?:string, float?:boolean, moveBonus?:number}} [opts]
 */
export function profileFor(clsId, opts = {}) {
  const c = CLASSES[clsId];
  if (!c) return null;
  const movement = opts.movement ?? c.movement;
  const mod = MOVEMENT_MODS[movement] || ZERO;
  const float = !!opts.float;
  const jump = (c.jump || 0) + mod.jump + (float ? STATUS_FLOAT_MOD.jump : 0);
  const move = Math.max(0, (c.move || 0) + mod.move + (opts.moveBonus || 0));
  const water = mod.water || float;
  const climb = climbOf(jump);
  return Object.freeze({
    cls: clsId, name: c.name, movement, float, jump, climb, move,
    water, canWater: water,                       // `canWater` is the task-facing alias of `water`
    ignoreHeight: jump >= UNBOUNDED_JUMP,
    teleport: movement === TELEPORT_MOVEMENT,
    tier: tierIdOf(climb, water),
  });
}

/** Every class, keyed by class id. @type {Readonly<Record<string, ReturnType<typeof profileFor>>>} */
export const CLASS_PROFILES = Object.freeze(Object.fromEntries(
  Object.keys(CLASSES).map((id) => [id, profileFor(id)])));

/** The class record, not the tier bucket — see tierProfileOf() for that. */
export function profileOf(clsId) { return CLASS_PROFILES[clsId] || null; }

const byClimb = (a, b) => (a.climb === b.climb ? (a.water === b.water ? 0 : a.water ? 1 : -1)
  : a.climb < b.climb ? -1 : 1);                  // Infinity - Infinity is NaN; compare, never subtract

/**
 * Tier buckets: one row per distinct (climb, water) pair in the roster, teleport excluded.
 * `move` is the SLOWEST move in the bucket because every acceptance number in PLAN §4.7 is stated
 * for the worst class in the tier; `moveMax` is kept so the ladder can print both ends.
 * @type {ReadonlyArray<{id:string,label:string,climb:number,water:boolean,move:number,moveMax:number,classes:string[]}>}
 */
export const PROFILES = Object.freeze(buildProfiles());
function buildProfiles() {
  const by = new Map();
  for (const p of Object.values(CLASS_PROFILES)) {
    if (p.teleport) continue;
    let b = by.get(p.tier);
    if (!b) by.set(p.tier, b = { id: p.tier, label: '', climb: p.climb, water: p.water, move: p.move, moveMax: p.move, classes: [] });
    b.classes.push(p.cls);
    if (p.move < b.move) b.move = p.move;
    if (p.move > b.moveMax) b.moveMax = p.move;
  }
  const out = [...by.values()].sort(byClimb);
  for (const b of out) {
    b.classes.sort();
    b.label = `${Number.isFinite(b.climb) ? b.climb + 'h' : 'any'}${b.water ? ' water' : ''} · MOVE ${b.move}${b.moveMax !== b.move ? '–' + b.moveMax : ''} · ${b.classes.length} cls`;
    Object.freeze(b.classes); Object.freeze(b);
  }
  return out;
}

/**
 * The distinct climbs the live roster actually fields, ascending. On the shipped 32 classes this
 * is [2,4,6,10,12,14,Infinity]; a map's design.tiers is a subset it chooses to design for.
 */
export function tiersFromRoster() {
  const s = new Set();
  for (const p of Object.values(CLASS_PROFILES)) if (!p.teleport) s.add(p.climb);
  return [...s].sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
}
export const TIERS = Object.freeze(tiersFromRoster());

// A class enjoys a tier-t route iff its own climb reaches t, so "the classes at tier t" is
// {climb >= t}, not {climb === t} — the slowest of THOSE is what decides whether a step saving
// survives the conversion into turns. Falls back to the roster floor when t is above every tier.
function movesAtTier(t) {
  const out = PROFILES.filter((p) => p.climb >= t);
  return (out.length ? out : PROFILES).map((p) => [p.move, p.moveMax]);
}
/** Worst MOVE among the classes that can take a tier-t route. Used by every promise check. */
export function slowestMoveAtTier(t) { return Math.min(...movesAtTier(t).map((m) => m[0])); }
/** Best MOVE among them — the other end of the ladder's turn range. */
export function fastestMoveAtTier(t) { return Math.max(...movesAtTier(t).map((m) => m[1])); }
/** The bucket a class sits in, or null for the excluded teleport class. */
export function tierProfileOf(clsId) {
  const p = CLASS_PROFILES[clsId];
  return p && !p.teleport ? PROFILES.find((b) => b.id === p.tier) || null : null;
}
