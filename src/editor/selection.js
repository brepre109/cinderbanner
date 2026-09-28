// The selection mask (PLAN §3.6, §6.7). One `Uint8Array` over the grid, full set algebra, and the
// selectors. Its real job is not marquee drawing: a selection is a WRITE MASK. Session's Tx no-ops
// every cell write outside it, so with a selection active EVERY brush is clipped to it without a
// line of code in any brush — smooth, terrace, ramp, water, void, a generator, all of them.
//
// The selector that earns its keep is BY-TIER: every tile reachable at jump tier N but NOT at the
// roster tier below it. That is literally "select what this jump unlocks", and it is the one place
// the verticality analysis and the editing surface meet. `wand` (flood on surface + height
// tolerance) and `by-height` are the ordinary ones; they are here so all six share one mask type.
//
// Zero three.js and zero DOM: the graph work goes through compile.js + jumpgraph.js, both of which
// run under bare `node`, so tools/checks can assert on a selection.
import { compileMap } from '../world/mapformat/compile.js';
import { buildGraph, reachField } from '../world/jumpgraph.js';
import { TIERS } from '../world/analysis/profiles.js';

export const MODES = Object.freeze(['replace', 'add', 'subtract', 'intersect', 'xor']);
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Selection {
  constructor(w, d, mask) {
    this.w = w | 0; this.d = d | 0; this.n = this.w * this.d;
    this.mask = mask && mask.length === this.n ? mask : new Uint8Array(this.n);
    this._count = -1;                        // lazily recounted; -1 means "ask again"
  }
  get count() { if (this._count < 0) { let c = 0; for (let i = 0; i < this.n; i++) if (this.mask[i]) c++; this._count = c; } return this._count; }
  get empty() { return this.count === 0; }
  /** The mask a Tx should be given: null when nothing is selected, because an empty mask would clip
   *  every write and make the editor look broken rather than look unselected. */
  get writeMask() { return this.count ? this.mask : null; }
  idx(x, z) { return x >= 0 && z >= 0 && x < this.w && z < this.d ? z * this.w + x : -1; }
  has(x, z) { const i = this.idx(x, z); return i >= 0 && this.mask[i] !== 0; }
  hasIndex(i) { return i >= 0 && i < this.n && this.mask[i] !== 0; }
  _dirty() { this._count = -1; return this; }

  /** @param {Uint8Array|Selection} other @param {'replace'|'add'|'subtract'|'intersect'|'xor'} mode */
  apply(other, mode = 'replace') {
    const b = other instanceof Selection ? other.mask : other, m = this.mask;
    if (!b || b.length !== this.n) throw new RangeError(`Selection.apply: mask is not ${this.w}x${this.d}`);
    if (mode === 'replace') m.set(b);
    else for (let i = 0; i < this.n; i++) {
      const x = m[i] !== 0, y = b[i] !== 0;
      m[i] = (mode === 'add' ? x || y : mode === 'subtract' ? x && !y : mode === 'intersect' ? x && y : x !== y) ? 1 : 0;
    }
    return this._dirty();
  }
  replace(o) { return this.apply(o, 'replace'); }
  add(o) { return this.apply(o, 'add'); }
  subtract(o) { return this.apply(o, 'subtract'); }
  intersect(o) { return this.apply(o, 'intersect'); }
  xor(o) { return this.apply(o, 'xor'); }
  none() { this.mask.fill(0); this._count = 0; return this; }
  all() { this.mask.fill(1); this._count = this.n; return this; }
  invert() { for (let i = 0; i < this.n; i++) this.mask[i] ^= 1; return this._dirty(); }
  set(x, z, on = true) { const i = this.idx(x, z); if (i >= 0) { this.mask[i] = on ? 1 : 0; this._dirty(); } return this; }

  /** Dilate by `n` orthogonal steps. */
  grow(n = 1) {
    for (let k = 0; k < n; k++) {
      const src = Uint8Array.from(this.mask);
      for (let z = 0; z < this.d; z++) for (let x = 0; x < this.w; x++) {
        if (src[z * this.w + x]) continue;
        for (const [dx, dz] of NB) { const j = this.idx(x + dx, z + dz); if (j >= 0 && src[j]) { this.mask[z * this.w + x] = 1; break; } }
      }
    }
    return this._dirty();
  }
  /** Erode by `n`. Off-board neighbours count as SELECTED, so a selection that runs to the map edge
   *  keeps its edge instead of retreating one tile per shrink — which is never what an author means. */
  shrink(n = 1) {
    for (let k = 0; k < n; k++) {
      const src = Uint8Array.from(this.mask);
      for (let z = 0; z < this.d; z++) for (let x = 0; x < this.w; x++) {
        if (!src[z * this.w + x]) continue;
        for (const [dx, dz] of NB) { const j = this.idx(x + dx, z + dz); if (j >= 0 && !src[j]) { this.mask[z * this.w + x] = 0; break; } }
      }
    }
    return this._dirty();
  }
  clone() { return new Selection(this.w, this.d, Uint8Array.from(this.mask)); }
  equals(o) { const b = o instanceof Selection ? o.mask : o; if (!b || b.length !== this.n) return false; for (let i = 0; i < this.n; i++) if ((this.mask[i] !== 0) !== (b[i] !== 0)) return false; return true; }
  bounds() {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let z = 0; z < this.d; z++) for (let x = 0; x < this.w; x++) if (this.mask[z * this.w + x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    return x1 < x0 ? null : { x0, z0, x1, z1 };
  }
  tiles() { const out = []; for (let z = 0; z < this.d; z++) for (let x = 0; x < this.w; x++) if (this.mask[z * this.w + x]) out.push([x, z]); return out; }
  forEach(fn) { for (let z = 0; z < this.d; z++) for (let x = 0; x < this.w; x++) if (this.mask[z * this.w + x]) fn(x, z, z * this.w + x); }
  /** Re-fit to a resized document, keeping whatever still overlaps. */
  resize(w, d) {
    const next = new Uint8Array(w * d);
    for (let z = 0; z < Math.min(d, this.d); z++) for (let x = 0; x < Math.min(w, this.w); x++) next[z * w + x] = this.mask[z * this.w + x];
    this.w = w; this.d = d; this.n = w * d; this.mask = next;
    return this._dirty();
  }
  static of(def, mask) { return new Selection(def.size.w, def.size.d, mask); }
}

// ---- selectors. Each returns a bare Uint8Array so it can be handed straight to sel.apply(m, mode),
// which is what makes Shift-add / Alt-subtract / Ctrl-intersect one code path for all six.
const blank = (def) => new Uint8Array(def.size.w * def.size.d);

export function selRect(def, x0, z0, x1, z1) {
  const w = def.size.w, d = def.size.d, m = blank(def);
  const ax = Math.max(0, Math.min(x0, x1)), bx = Math.min(w - 1, Math.max(x0, x1));
  const az = Math.max(0, Math.min(z0, z1)), bz = Math.min(d - 1, Math.max(z0, z1));
  for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) m[z * w + x] = 1;
  return m;
}
/** Screen lasso, already projected to TILE space by picking.js. Even-odd point-in-polygon against
 *  each tile's CENTRE, which is the only rule that keeps a lasso stable while the camera orbits. */
export function selLasso(def, poly) {
  const w = def.size.w, d = def.size.d, m = blank(def);
  if (!poly || poly.length < 3) return m;
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const px = x + 0.5, pz = z + 0.5; let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
    }
    if (inside) m[z * w + x] = 1;
  }
  return m;
}
/** Magic wand: 4-connected flood from (x,z) over tiles within `heightTol` h of the seed and, when
 *  `surface` is on, carrying the same letter. Tolerance is on the SEED, not on each step, so a long
 *  gentle ramp does not walk the whole board one tolerated step at a time. */
export function selWand(def, x, z, opts = {}) {
  const w = def.size.w, d = def.size.d, m = blank(def);
  if (x < 0 || z < 0 || x >= w || z >= d) return m;
  const tol = opts.heightTol ?? 0, sameT = opts.surface !== false;
  const h0 = def.grid.H[z][x], t0 = def.grid.T[z][x];
  const q = [z * w + x];
  m[q[0]] = 1;
  for (let head = 0; head < q.length; head++) {
    const i = q[head], cx = i % w, cz = (i - cx) / w;
    for (const [dx, dz] of NB) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= w || nz >= d) continue;
      const j = nz * w + nx;
      if (m[j] || Math.abs(def.grid.H[nz][nx] - h0) > tol || (sameT && def.grid.T[nz][nx] !== t0)) continue;
      m[j] = 1; q.push(j);
    }
  }
  return m;
}
export function selByHeight(def, lo, hi) {
  const w = def.size.w, m = blank(def);
  for (let z = 0; z < def.size.d; z++) for (let x = 0; x < w; x++) { const h = def.grid.H[z][x]; if (h >= lo && h <= hi) m[z * w + x] = 1; }
  return m;
}
/** @param {string|string[]} letters schema letters, e.g. 'w' or ['g','k'] */
export function selBySurface(def, letters) {
  const set = new Set(typeof letters === 'string' ? [...letters] : letters), w = def.size.w, m = blank(def);
  for (let z = 0; z < def.size.d; z++) for (let x = 0; x < w; x++) if (set.has(def.grid.T[z][x])) m[z * w + x] = 1;
  return m;
}
export function selByRegion(def, rgid) {
  const r = (def.design?.regions || []).find((g) => g.rgid === rgid);
  return r ? selRect(def, r.rect[0], r.rect[1], r.rect[2], r.rect[3]) : blank(def);
}

/** The roster tier immediately below `climb`, or -1 when `climb` is already the lowest. TIERS comes
 *  from the LIVE class table, so a new class changes what by-tier means without an edit here. */
export function tierBelow(climb) {
  let best = -1;
  for (const t of TIERS) if (t < climb && t > best) best = t;
  return best;
}

/**
 * BY-TIER — the verticality-aware selector. Every walkable tile reachable from `sources` at climb
 * `tier` but NOT at the roster tier below it: exactly the ground a jump upgrade buys, and exactly
 * the set an author wants to paint, decorate or delete when a shortcut turns out to be free.
 *
 * `only:false` drops the exclusion and selects everything the tier reaches, which is the reach
 * overlay's set rather than the delta.
 * @param {import('../world/mapformat/schema.js').MapDef} def
 * @param {{tier:number, from?:[number,number]|Array<[number,number]>, team?:'A'|'B', prev?:number,
 *          water?:boolean, only?:boolean, map?:object, graph?:object}} opts
 */
export function selByTier(def, opts = {}) {
  const w = def.size.w, m = blank(def);
  const g = opts.graph || buildGraph(opts.map || compileMap(def));
  const src = seedNodes(def, opts, w);
  if (!src.length) return m;
  const tier = opts.tier ?? (def.design?.baseTier ?? 4), water = !!opts.water;
  const hi = reachField(g, { climb: tier, water }, src).dist;
  const prev = opts.prev ?? tierBelow(tier);
  const lo = opts.only === false || prev < 0 ? null : reachField(g, { climb: prev, water }, src).dist;
  for (let i = 0; i < g.n; i++) if (hi[i] >= 0 && (!lo || lo[i] < 0)) m[i] = 1;
  return m;
}
// A cursor tile if the caller has one (by-tier is a click tool), else the team's whole spawn file —
// which is the set every ladder number in the analysis is quoted against.
function seedNodes(def, opts, w) {
  const pts = opts.from ? (typeof opts.from[0] === 'number' ? [opts.from] : opts.from) : (def.spawns?.[opts.team || 'A'] || []);
  return pts.filter((p) => p && p[0] >= 0 && p[1] >= 0 && p[0] < w && p[1] < def.size.d).map((p) => p[1] * w + p[0]);
}
