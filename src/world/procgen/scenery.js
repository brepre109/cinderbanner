// sculpt() — the ground a player LOOKS at, as opposed to the ground they walk on (PLAN §5.1 stage 1).
//
// skeleton.js proves the route; everything outside the road is scenery, and until this module existed
// that scenery was one formula: `anchor[z] + 2 + noise`. anchor is a step function of z, the noise is
// terraced to 2h and mostly clamps to zero, so the whole non-road surface resolved to two or three
// enormous flat plates with a perfectly rectangular outline and no standing water anywhere. Measured
// against the shipped catalogue that is not a stylistic gap, it is an order of magnitude: the hand
// maps put 19-39% of their border ring in void or water and every one of them has a body of water;
// the generator managed 1.5-8.3% and zero.
//
// Three passes, in this order, because each depends on the last:
//   knolls      relief WITH SHAPE — crests and hollows across the scenery mass, so the wall a bench
//               is cut into rises and falls along its length instead of ruling one horizon line.
//   sink        tarns and hollows: blobs of scenery given back to water or void. Placed away from
//               `keep` so shoreline() is free to cut their banks (it refuses to touch a route tile,
//               and a bank it may not cut is a contract.gentleness error), and water away from void
//               so props.md §5's void-touches-water rule has nothing to clean up.
//   scarp       bound every scenery height by its distance from the nearest fall, so a tall drop
//               comes out as treads instead of as one 22h slab.
//   silhouette  bite the outline. This is what `Archetype.edgeCut` buys: void chewed inward from the
//               border in coherent runs, never through the shelf, a route tile or a bank.
//
// Every pass writes ONLY scenery — `block` land that is not `keep` — so not one graph edge can move,
// which is why sculpting happens after the benches are cut and before the seal/level sweeps that
// close the map out. Zero three.js; runs under bare `node`.
import { ri, rf, chance } from './rng.js';
import { makeField, noise, terrace, ridge, clampField } from './field.js';
import { idx } from './skeleton.js';

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const MIN_SCENERY = 2;    // never sink scenery under the lowest bench; keeps void and water off the floor
const MAX_SCENERY = 40;   // well inside schema.js's 60h ceiling, with the knoll amplitude still to add

/** Scenery is exactly the land skeleton.js marked `block` and did not mark `keep`: unwalkable ground
 *  with a real surface, which is the only thing in this file that may be moved. */
export function sceneryMask(c) {
  const m = new Uint8Array(c.n);
  for (let i = 0; i < c.n; i++) if (c.block[i] && c.T[i] !== 'w' && c.T[i] !== 'v' && !c.keep[i]) m[i] = 1;
  return m;
}

/** Chebyshev distance to the nearest load-bearing tile, saturating at `cap`. The pond and the edge
 *  cut both need "far enough from the road that shoreline() may cut a bank here", and a saturating
 *  BFS answers that in one pass instead of a radius test per candidate. */
function keepDist(c, cap = 3) {
  const dist = new Int8Array(c.n).fill(cap);
  let front = [];
  for (let i = 0; i < c.n; i++) if (c.keep[i] || (c.T[i] !== 'w' && c.T[i] !== 'v' && !c.block[i])) { dist[i] = 0; front.push(i); }
  for (let step = 1; step <= cap && front.length; step++) {
    const next = [];
    for (const i of front) { const x = i % c.w, z = (i / c.w) | 0;
      for (const [dx, dz] of N4) { const j = idx(c, x + dx, z + dz);
        if (j >= 0 && dist[j] > step) { dist[j] = step; next.push(j); } } }
    front = next;
  }
  return dist;
}

/** @param {object} c canvas @param {() => number} rng @param {import('./vocab.js').Archetype} V */
export function sculpt(c, rng, V) {
  const mask = sceneryMask(c);
  knolls(c, rng, V, mask);
  const dist = keepDist(c);
  sink(c, rng, mask, dist, V.pools, true);
  sink(c, rng, mask, dist, V.hollows, false);
  silhouette(c, rng, V, mask, dist);
  scarp(c, rng, mask);
  waterFloor(c, mask);
}

/**
 * Crests and hollows over the scenery mass. The field starts as the heights already there, so the
 * anchor stack is still felt; two or three sampled crests and one or two hollows are added on top and
 * the result is terraced back to the 2h vocabulary. Written back through the mask, so a bench, a door
 * and the shelf come out bit-identical.
 */
function knolls(c, rng, V, mask) {
  const f = makeField(c.w, c.d, 0), g = makeField(c.w, c.d, 0);
  for (let i = 0; i < c.n; i++) f.H[i] = c.H[i];
  const amp = V.relief[1], span = Math.max(c.w, c.d);
  // Crests are sampled end to end across the board rather than per row: one that runs diagonally over
  // three benches is the single most effective thing against the ruled-horizon read.
  for (let n = ri(rng, 2, 3); n > 0; n--) {
    const ax = ri(rng, 0, c.w - 1), az = ri(rng, 0, c.d - 1);
    const bx = ri(rng, 0, c.w - 1), bz = ri(rng, 0, c.d - 1);
    if (Math.hypot(bx - ax, bz - az) < span * 0.35) continue;
    ridge(f, ax, az, bx, bz, ri(rng, 2, 4), ri(rng, Math.max(2, amp - 2), amp + 4), mask);
  }
  for (let n = ri(rng, 1, 2); n > 0; n--) {
    const ax = ri(rng, 0, c.w - 1), az = ri(rng, 0, c.d - 1);
    ridge(g, ax, az, ri(rng, 0, c.w - 1), ri(rng, 0, c.d - 1), ri(rng, 2, 3), ri(rng, 2, amp), mask);
  }
  for (let i = 0; i < c.n; i++) if (mask[i]) f.H[i] -= g.H[i];
  terrace(f, 2, mask); clampField(f, MIN_SCENERY, MAX_SCENERY, mask);
  for (let i = 0; i < c.n; i++) if (mask[i]) c.H[i] = f.H[i];
}

/**
 * Step the scarps. Sinking a hollow next to a knoll leaves the whole difference standing as ONE slab,
 * and a 22h unbroken face is the single loudest tell that a board was generated — the shipped
 * catalogue tops out between 8h and 16h and always breaks a tall drop into treads.
 *
 * So the height a scenery tile may reach is bounded by how far it is from the nearest fall: FACE_MAX
 * at the lip, one TREAD more per ring inland, plus a coarse noise so the lip itself steps up and down
 * along its length rather than ruling one line. Math.min, never assignment — ground already lower
 * than its bound keeps every bit of the relief knolls() gave it.
 */
function scarp(c, rng, mask) {
  const FACE_MAX = 12, TREAD = 6;
  const dist = new Int16Array(c.n).fill(-1), base = new Int16Array(c.n);
  // Multi-source BFS out of every fall, each source carrying the level it falls TO. Void drops to the
  // black cap, which levelVoid() parks at the map's lowest land — and that is measured LATER, after
  // shoreline() has cut its banks, so it can only be lower than anything visible here. MIN_SCENERY is
  // the floor those passes are themselves clamped to, so anchoring on it bounds the face whatever
  // they do; measuring the current minimum instead is how a 12h cap produced an 18h wall.
  const zero = [];
  for (let i = 0; i < c.n; i++) {
    if (c.T[i] === 'v') { dist[i] = 0; base[i] = MIN_SCENERY; zero.push(i); }
    else if (c.T[i] === 'w') { dist[i] = 0; base[i] = c.H[i]; zero.push(i); }
  }
  // A tile ON the border is not a source, it is the thing that FACES one — it presents its full
  // height to the off-board drop. Seeding it at dist 0 excluded it from the cap below, which is how a
  // 12h bound still shipped an 18h wall along the outside of the board.
  let front = [];
  for (let x = 0; x < c.w; x++) for (const z of [0, c.d - 1]) { const i = idx(c, x, z); if (dist[i] < 0) { dist[i] = 1; base[i] = MIN_SCENERY; front.push(i); } }
  for (let z = 1; z < c.d - 1; z++) for (const x of [0, c.w - 1]) { const i = idx(c, x, z); if (dist[i] < 0) { dist[i] = 1; base[i] = MIN_SCENERY; front.push(i); } }
  for (const i of zero) { const x = i % c.w, z = (i / c.w) | 0;
    for (const [dx, dz] of N4) { const j = idx(c, x + dx, z + dz);
      if (j >= 0 && dist[j] < 0) { dist[j] = 1; base[j] = base[i]; front.push(j); } } }
  for (let step = 2; front.length; step++) {
    const next = [];
    for (const i of front) { const x = i % c.w, z = (i / c.w) | 0;
      for (const [dx, dz] of N4) { const j = idx(c, x + dx, z + dz);
        if (j < 0 || dist[j] >= 0) continue; dist[j] = step; base[j] = base[i]; next.push(j); } }
    front = next;
  }
  const j2 = makeField(c.w, c.d, 0); noise(j2, rng, 5, 4);
  for (let i = 0; i < c.n; i++) {
    if (!mask[i] || dist[i] < 1) continue;
    const cap = base[i] + FACE_MAX + TREAD * (dist[i] - 1) + 2 * Math.round(j2.H[i] / 2);
    if (c.H[i] > cap) c.H[i] = Math.max(MIN_SCENERY, 2 * Math.round(cap / 2));
  }
}

/**
 * Water two steps over the land beside it emits no side geometry and floats (validate.js
 * water.above-land), and shoreline() only ever cuts a bank the other way — DOWN, when land towers
 * over water. So the last word on every scenery tile is the surface of any channel it touches.
 */
function waterFloor(c, mask) {
  for (let i = 0; i < c.n; i++) {
    if (!mask[i]) continue;
    let floor = -32768; const x = i % c.w, z = (i / c.w) | 0;
    for (const [dx, dz] of N4) { const j = idx(c, x + dx, z + dz); if (j >= 0 && c.T[j] === 'w') floor = Math.max(floor, c.H[j]); }
    if (c.H[i] < floor) c.H[i] = floor;
  }
}

/**
 * Sink a blob of scenery. `wet` makes it standing water — sited on the LOWEST qualifying ground so it
 * reads as drainage rather than as a puddle parked on a hilltop, and cut two steps under the
 * shallowest tile it touches so the basin has a lip. Otherwise it is void: a hollow, which is the
 * only source of NEGATIVE SPACE this generator has.
 *
 * That is worth stating plainly, because it is the structural reason the scenery read as confetti and
 * no prop table could have fixed it. Every scenery tile must be closed by a blocking prop or the tier
 * proof has a hole in it, so the scenery is by construction a solid field of props — there is nowhere
 * for the eye to rest. A tile sunk to void or water needs no prop at all, and is the one way to buy
 * ground back.
 *
 * @param {number} count how many blobs to try to seat
 * @param {boolean} wet water rather than void
 */
function sink(c, rng, mask, dist, count, wet) {
  if (!count) return;
  // TWO POOLS MAY NOT SHARE A BANK. shoreline() cuts a bank down to suit the water beside it; where
  // two bodies at different surfaces touch the same tile it cuts to suit one and leaves the tile
  // standing under the other, which is validate.js's water.above-land. Three tiles of separation
  // makes that arrangement unconstructible instead of merely unlikely.
  let offWater = dilate(c, 'w', wet ? 2 : 1), offVoid = dilate(c, 'v', 1);
  for (let made = 0, tries = 0; made < count && tries < 60; tries++) {
    const cand = [];
    for (let i = 0; i < c.n; i++) if (mask[i] && dist[i] >= 2 && !offWater[i] && !offVoid[i]) cand.push(i);
    if (cand.length < 6) return;
    const seed = cand[ri(rng, 0, cand.length - 1)];
    const cx = seed % c.w, cz = (seed / c.w) | 0, rx = ri(rng, 1, 3), rz = ri(rng, 1, 3);
    const blob = [];
    let ok = true, lo = Infinity;
    for (let z = cz - rz; z <= cz + rz && ok; z++) for (let x = cx - rx; x <= cx + rx; x++) {
      if ((x - cx) * (x - cx) / (rx * rx) + (z - cz) * (z - cz) / (rz * rz) > 1) continue;
      const i = idx(c, x, z);
      // dist >= 2 is exactly "not orthogonally adjacent to a route tile", which is the precondition
      // shoreline() needs: it refuses to cut a bank out of a `keep` tile, and an uncut bank steeper
      // than baseTier is a contract.gentleness error.
      if (i < 0 || !mask[i] || dist[i] < 2 || offWater[i] || offVoid[i]) { ok = false; break; }
      blob.push(i); lo = Math.min(lo, c.H[i]);
    }
    if (!ok || blob.length < 4) continue;
    // The bed is also held at or under the LOWEST land the blob touches. Cutting purely relative to
    // the blob's own floor lets a basin on a shoulder stand two steps over the ground beside it, and
    // water standing over land emits no bank and floats.
    let rim = lo;
    if (wet) for (const i of blob) { const x = i % c.w, z = (i / c.w) | 0;
      for (const [dx, dz] of N4) { const j = idx(c, x + dx, z + dz);
        if (j >= 0 && c.T[j] !== 'v' && c.T[j] !== 'w') rim = Math.min(rim, c.H[j]); } }
    const bed = Math.max(MIN_SCENERY, Math.min(lo - 2, rim));
    for (const i of blob) { if (wet) c.H[i] = bed; c.T[i] = wet ? 'w' : 'v'; c.block[i] = 0; mask[i] = 0; }
    made++;
    offWater = dilate(c, 'w', wet ? 2 : 1); offVoid = dilate(c, 'v', 1);
  }
}

/** Tiles within `r` steps of a surface letter. Both sink() and silhouette() need "keep clear of the
 *  water" and "keep clear of the void" as a lookup rather than as a radius test per candidate. */
function dilate(c, letter, r) {
  const n = new Uint8Array(c.n);
  let front = [];
  for (let i = 0; i < c.n; i++) if (c.T[i] === letter) { n[i] = 1; front.push(i); }
  for (let step = 0; step < r && front.length; step++) {
    const next = [];
    for (const i of front) { const x = i % c.w, z = (i / c.w) | 0;
      for (const [dx, dz] of N4) { const j = idx(c, x + dx, z + dz); if (j >= 0 && !n[j]) { n[j] = 1; next.push(j); } } }
    front = next;
  }
  return n;
}

/**
 * Chew the outline. A rectangle is the one silhouette no landscape has, and the shipped maps spend
 * 19-39% of their border ring on void to avoid it. Bites are RUNS along the edge with a depth that
 * varies tile to tile — a per-tile coin toss produces a dotted fringe, which reads as damage rather
 * than as coastline — and every one of them is refused over water, over a bank, and anywhere within
 * two tiles of a route.
 */
function silhouette(c, rng, V, mask, dist) {
  const [lo, hi] = V.edgeCut || [0, 0];
  if (!(hi > 0)) return;
  const ring = 2 * c.w + 2 * Math.max(0, c.d - 2);
  const want = Math.round(ring * rf(rng, lo, hi));
  const wet = dilate(c, 'w', 1);
  let cut = 0;
  // Four edges, each walked from a random offset so the same corner is not always the ragged one.
  const edges = [['z', 0, 1], ['z', c.d - 1, -1], ['x', 0, 1], ['x', c.w - 1, -1]];
  for (let pass = 0; pass < 3 && cut < want; pass++) {
    for (const [axis, line, inward] of edges) {
      const len = axis === 'z' ? c.w : c.d;
      for (let s = ri(rng, 0, len - 1), n = 0; n < len && cut < want; ) {
        const run = ri(rng, 2, 5);
        const deep = ri(rng, 1, 3);
        for (let k = 0; k < run && n < len; k++, n++) {
          const t = (s + n) % len;
          const depth = Math.max(1, deep - (chance(rng, 0.4) ? 1 : 0));
          for (let q = 0; q < depth; q++) {
            const x = axis === 'z' ? t : line + inward * q, z = axis === 'z' ? line + inward * q : t;
            const i = idx(c, x, z);
            if (i < 0 || !mask[i] || wet[i] || dist[i] < 2) break;   // stop this bite, keep the run going
            c.T[i] = 'v'; c.block[i] = 0; mask[i] = 0; if (q === 0) cut++;
          }
        }
      }
    }
  }
}
