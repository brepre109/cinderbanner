// The generator's only source of randomness (PLAN §3.5). Every routine takes the rng EXPLICITLY —
// there is no module-level state and nothing here reads Math.random — because `?map=proc:4242` is a
// promise that two players on two machines get the same battlefield, and tools/checks/procgen.mjs
// proves it by hashing two generations of the same seed. A hidden global would break that the first
// time two archetypes were generated in a different order.
//
// mulberry32 is the same 32-bit generator the prototype used and is kept deliberately: it is four lines, has
// no state beyond one uint32, and its period (2^32) is thousands of times the number of draws a
// single map makes. Zero imports: this file runs under bare `node`.

/**
 * @param {number} seed any integer; coerced to uint32, so a negative or fractional seed is legal
 * @returns {() => number} a fresh stream in [0,1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A derived stream. Two sub-systems that draw from the SAME rng are coupled: adding one prop to
 *  decorate() would shift every later layout draw and change the whole map. streamOf gives each
 *  stage its own stream off one seed, so a change inside a stage stays inside it. */
export function streamOf(seed, tag) {
  let h = seed >>> 0;
  for (let i = 0; i < String(tag).length; i++) h = Math.imul(h ^ String(tag).charCodeAt(i), 0x01000193) >>> 0;
  return mulberry32(h);
}

/** Inclusive integer in [a,b]. Returns `a` when b < a rather than NaN: callers derive bounds from
 *  board extents, and a degenerate range is a small map, not a crash. */
export function ri(rng, a, b) {
  const lo = Math.ceil(a), hi = Math.floor(b);
  return hi <= lo ? lo : lo + Math.floor(rng() * (hi - lo + 1));
}

/** Float in [a,b). */
export function rf(rng, a, b) { return a + rng() * (b - a); }

/** True with probability p. */
export function chance(rng, p) { return rng() < p; }

/** One element. Null on an empty list — an archetype with an empty prop table decorates with
 *  nothing rather than throwing halfway through a candidate. */
export function pick(rng, arr) { return arr && arr.length ? arr[ri(rng, 0, arr.length - 1)] : null; }

/** Fisher-Yates, returning a NEW array. Non-mutating because the caller's list is usually a frozen
 *  vocabulary record and an in-place shuffle would make the second candidate differ from the first
 *  for reasons no seed explains. */
export function shuffle(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = ri(rng, 0, i); const t = out[i]; out[i] = out[j]; out[j] = t; }
  return out;
}

/**
 * Weighted choice over `[[value, weight], ...]` or `{value: weight}`. Non-positive weights are
 * dropped rather than clamped, so a vocabulary can switch a prop off with `0` and not merely make
 * it rare.
 * @returns {*} null when nothing has positive weight
 */
export function weighted(rng, table) {
  const rows = Array.isArray(table) ? table : Object.entries(table || {});
  let total = 0;
  for (const r of rows) if (r[1] > 0) total += r[1];
  if (!(total > 0)) return null;
  let t = rng() * total;
  for (const r of rows) { if (!(r[1] > 0)) continue; t -= r[1]; if (t <= 0) return r[0]; }
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i][1] > 0) return rows[i][0];   // float tail
  return null;
}

/** `n` distinct integers from [a,b], ascending. Used for waypoint and column choices where a repeat
 *  would silently collapse two features onto one tile. Returns fewer than n if the range is short. */
export function distinct(rng, a, b, n) {
  const pool = [];
  for (let v = Math.ceil(a); v <= Math.floor(b); v++) pool.push(v);
  return shuffle(rng, pool).slice(0, n).sort((p, q) => p - q);
}
