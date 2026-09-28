// Height-field arithmetic (PLAN §3.5, §5.1 stage 1). A Field is a flat Int16Array of h steps plus
// its extent — the same unit grid.H uses, so nothing here ever converts and no rounding drifts.
//
// The load-bearing routine is erodeToStep(). PLAN §5.1's first stage says the base terrain must be
// GENTLE "by construction", not by rejection: if every walkable-adjacent pair is <= baseTier before
// a single face is placed, then the ONLY steps steeper than baseTier on the finished map are the
// ones the skeleton deliberately cut, and validate.js's contract.face-undeclared has nothing to
// find. A generator that instead relies on the validator to catch its own relief spends its whole
// attempt budget re-rolling terrain (the prototype's failure mode) rather than placing design.
//
// Every op takes an optional `mask` (Uint8Array, 1 = this tile is mine to touch) so relief can be
// shaped over the scenery without ever moving a route tile. Zero imports: runs under bare `node`.

/** @typedef {{w:number, d:number, H:Int16Array}} Field */

/** @param {number} w @param {number} d @param {number} [h0] @returns {Field} */
export function makeField(w, d, h0 = 0) {
  const H = new Int16Array(w * d);
  if (h0) H.fill(h0);
  return { w, d, H };
}
export const at = (f, x, z) => (x >= 0 && z >= 0 && x < f.w && z < f.d ? f.H[z * f.w + x] : null);
export const set = (f, x, z, h) => { if (x >= 0 && z >= 0 && x < f.w && z < f.d) f.H[z * f.w + x] = h; };
const inRect = (x, z, r) => x >= Math.min(r[0], r[2]) && x <= Math.max(r[0], r[2]) && z >= Math.min(r[1], r[3]) && z <= Math.max(r[1], r[3]);
const okMask = (mask, i) => !mask || mask[i] === 1;
const clampi = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Snap every masked height to a multiple of `step`, rounding to the nearer terrace. This is what
 *  turns a smooth noise field into the stepped plates the game's vocabulary is written in (2h
 *  terraces, 4h statements) and, incidentally, what makes long flat prop runs possible. */
export function terrace(f, step = 2, mask = null) {
  if (!(step > 0)) return f;
  for (let i = 0; i < f.H.length; i++) if (okMask(mask, i)) f.H[i] = Math.round(f.H[i] / step) * step;
  return f;
}

/** Flatten a rectangle to one height. The blunt instrument every other op is built on: a road bench,
 *  a courtyard floor, the ground under a house footprint. */
export function carve(f, rect, h, mask = null) {
  const [x0, z0, x1, z1] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
  for (let z = Math.max(0, z0); z <= Math.min(f.d - 1, z1); z++)
    for (let x = Math.max(0, x0); x <= Math.min(f.w - 1, x1); x++) { const i = z * f.w + x; if (okMask(mask, i)) f.H[i] = h; }
  return f;
}

/** Raise a linear crest: `amp` at the line, falling to 0 at `width` tiles away, added to whatever is
 *  there. Bresenham-free — the line is sampled, because a crest is a shape, not a pixel run. */
export function ridge(f, x0, z0, x1, z1, width = 3, amp = 6, mask = null) {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0)) * 2);
  const stamp = new Int16Array(f.w * f.d);
  for (let s = 0; s <= n; s++) {
    const t = s / n, cx = x0 + (x1 - x0) * t, cz = z0 + (z1 - z0) * t;
    for (let z = Math.max(0, Math.floor(cz - width)); z <= Math.min(f.d - 1, Math.ceil(cz + width)); z++)
      for (let x = Math.max(0, Math.floor(cx - width)); x <= Math.min(f.w - 1, Math.ceil(cx + width)); x++) {
        const k = Math.hypot(x - cx, z - cz) / width, v = k >= 1 ? 0 : Math.round(amp * (1 - k * k));
        const i = z * f.w + x; if (v > stamp[i]) stamp[i] = v;
      }
  }
  for (let i = 0; i < f.H.length; i++) if (stamp[i] && okMask(mask, i)) f.H[i] += stamp[i];
  return f;
}

/** A flat top with a graded skirt: the mesa crown, the ruin platform, the town bench. */
export function plateau(f, cx, cz, rx, rz, h, skirt = 2, mask = null) {
  for (let z = 0; z < f.d; z++) for (let x = 0; x < f.w; x++) {
    const k = Math.max(Math.abs(x - cx) / Math.max(1, rx), Math.abs(z - cz) / Math.max(1, rz));
    if (k > 1 + skirt / Math.max(rx, rz)) continue;
    const i = z * f.w + x; if (!okMask(mask, i)) continue;
    const v = k <= 1 ? h : Math.round(h - (h - f.H[i]) * Math.min(1, (k - 1) * Math.max(rx, rz) / skirt));
    if (v > f.H[i]) f.H[i] = v;
  }
  return f;
}

/** Cut a channel `wide` tiles across along a polyline `course` ([[x,z],...]) down to `bedH`, and
 *  return the tiles it touched. The channel is the WATER SURFACE bed: callers paint 'w' over these
 *  and level the body, because terrain.js's strongest soft invariant is one h per connected body. */
export function river(f, course, wide = 2, bedH = 0, mask = null) {
  const hit = [];
  const seen = new Uint8Array(f.w * f.d);
  for (let s = 0; s + 1 < course.length; s++) {
    const [ax, az] = course[s], [bx, bz] = course[s + 1];
    const n = Math.max(1, Math.abs(bx - ax) + Math.abs(bz - az));
    for (let t = 0; t <= n; t++) {
      const cx = Math.round(ax + ((bx - ax) * t) / n), cz = Math.round(az + ((bz - az) * t) / n);
      const r = Math.floor(wide / 2);
      for (let z = cz - r; z <= cz + (wide - 1 - r); z++) for (let x = cx - r; x <= cx + (wide - 1 - r); x++) {
        if (x < 0 || z < 0 || x >= f.w || z >= f.d) continue;
        const i = z * f.w + x; if (!okMask(mask, i) || seen[i]) continue;
        seen[i] = 1; f.H[i] = bedH; hit.push([x, z]);
      }
    }
  }
  return hit;
}

/**
 * Clamp the field until every 4-adjacent MASKED pair differs by at most `maxStep`. Repeated
 * min-clamp sweeps, alternating direction so a single tall spike does not have to walk the whole
 * board one pass at a time. Converges: every sweep strictly lowers at least one tile or stops.
 * Only masked tiles are lowered, and only masked pairs are examined — an unmasked scenery crag
 * beside the road is left exactly as authored, because nothing can walk it.
 * @returns {number} sweeps used; `iter` means it hit the cap and the caller should reject
 */
export function erodeToStep(f, maxStep, mask = null, iter = 24) {
  const { w, d, H } = f;
  for (let pass = 0; pass < iter; pass++) {
    let moved = 0;
    const fwd = pass % 2 === 0;
    for (let k = 0; k < w * d; k++) {
      const i = fwd ? k : w * d - 1 - k;
      if (!okMask(mask, i)) continue;
      const x = i % w, z = (i / w) | 0;
      let lo = Infinity;
      if (x + 1 < w && okMask(mask, i + 1)) lo = Math.min(lo, H[i + 1]);
      if (x > 0 && okMask(mask, i - 1)) lo = Math.min(lo, H[i - 1]);
      if (z + 1 < d && okMask(mask, i + w)) lo = Math.min(lo, H[i + w]);
      if (z > 0 && okMask(mask, i - w)) lo = Math.min(lo, H[i - w]);
      if (lo !== Infinity && H[i] - lo > maxStep) { H[i] = lo + maxStep; moved++; }
    }
    if (!moved) return pass + 1;
  }
  return iter;
}

/** Box blur over masked tiles, rounded back to integer h. Unmasked neighbours still CONTRIBUTE —
 *  a bench beside a cliff should feel the cliff — they are simply never written. */
export function smooth(f, iters = 1, mask = null) {
  const { w, d } = f;
  for (let n = 0; n < iters; n++) {
    const src = f.H.slice();
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
      const i = z * w + x; if (!okMask(mask, i)) continue;
      let sum = src[i], cnt = 1;
      if (x + 1 < w) { sum += src[i + 1]; cnt++; } if (x > 0) { sum += src[i - 1]; cnt++; }
      if (z + 1 < d) { sum += src[i + w]; cnt++; } if (z > 0) { sum += src[i - w]; cnt++; }
      f.H[i] = Math.round(sum / cnt);
    }
  }
  return f;
}

/** Seeded value noise on a coarse lattice, bilinearly interpolated and added. The only stochastic
 *  op in this file; `rng` is passed in so the caller owns reproducibility. */
export function noise(f, rng, cell = 5, amp = 4, mask = null) {
  const gw = Math.ceil(f.w / cell) + 2, gh = Math.ceil(f.d / cell) + 2, g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng() * 2 - 1;
  const lerp = (a, b, t) => a + (b - a) * (t * t * (3 - 2 * t));
  for (let z = 0; z < f.d; z++) for (let x = 0; x < f.w; x++) {
    const i = z * f.w + x; if (!okMask(mask, i)) continue;
    const gx = x / cell, gz = z / cell, x0 = Math.floor(gx), z0 = Math.floor(gz), tx = gx - x0, tz = gz - z0;
    const v = lerp(lerp(g[z0 * gw + x0], g[z0 * gw + x0 + 1], tx), lerp(g[(z0 + 1) * gw + x0], g[(z0 + 1) * gw + x0 + 1], tx), tz);
    f.H[i] += Math.round(v * amp);
  }
  return f;
}

/** Bite `count` blobs out of the masked area and return their tiles. The caller decides what a bite
 *  MEANS — void for a gorge, water for a marsh — because props.md §5 forbids void orthogonally
 *  adjacent to water and only the caller knows which of the two it is placing. */
export function voidBite(f, rng, mask, count = 3, rMin = 2, rMax = 4) {
  const cand = [];
  for (let i = 0; i < f.H.length; i++) if (okMask(mask, i)) cand.push(i);
  if (!cand.length) return [];
  const out = [], taken = new Uint8Array(f.H.length);
  for (let n = 0; n < count; n++) {
    const c = cand[Math.floor(rng() * cand.length)], cx = c % f.w, cz = (c / f.w) | 0;
    const rx = rMin + Math.floor(rng() * (rMax - rMin + 1)), rz = rMin + Math.floor(rng() * (rMax - rMin + 1));
    for (let z = cz - rz; z <= cz + rz; z++) for (let x = cx - rx; x <= cx + rx; x++) {
      if (x < 0 || z < 0 || x >= f.w || z >= f.d) continue;
      const i = z * f.w + x; if (!okMask(mask, i) || taken[i]) continue;
      if ((x - cx) * (x - cx) / (rx * rx) + (z - cz) * (z - cz) / (rz * rz) > 1) continue;
      taken[i] = 1; out.push([x, z]);
    }
  }
  return out;
}

/** Clamp every masked height into [lo,hi]. The last line of defence before the schema's own bounds:
 *  schema.js refuses land at or below -8h (terrain.js's skirt quad inverts there) and above 60h. */
export function clampField(f, lo, hi, mask = null) {
  for (let i = 0; i < f.H.length; i++) if (okMask(mask, i)) f.H[i] = clampi(f.H[i], lo, hi);
  return f;
}

/** The steepest masked 4-adjacent step, with the pair that produced it. erodeToStep's postcondition,
 *  asserted rather than assumed — skeleton.js rejects a candidate whose base terrain is not gentle
 *  instead of shipping it and letting validate.js discover the accident. */
export function maxStep(f, mask = null) {
  let best = 0, at2 = null;
  for (let z = 0; z < f.d; z++) for (let x = 0; x < f.w; x++) {
    const i = z * f.w + x; if (!okMask(mask, i)) continue;
    if (x + 1 < f.w && okMask(mask, i + 1)) { const v = Math.abs(f.H[i] - f.H[i + 1]); if (v > best) { best = v; at2 = [[x, z], [x + 1, z]]; } }
    if (z + 1 < f.d && okMask(mask, i + f.w)) { const v = Math.abs(f.H[i] - f.H[i + f.w]); if (v > best) { best = v; at2 = [[x, z], [x, z + 1]]; } }
  }
  return { step: best, at: at2 };
}

export { inRect };
