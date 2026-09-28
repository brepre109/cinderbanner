// Typed-array grid-graph primitives. compile.js, validate.js and jumpgraph.js all flood, label and
// index the same w*d lattice; without one shared kernel each of them grows a private BFS with its
// own off-by-one at the east edge. Nothing here knows what a MapDef is — it is arithmetic over a
// node count and two callbacks.
//
// Zero imports, deliberately: this module runs under bare `node` (tools/mapcheck.mjs) as well as in
// the vite bundle, so it may never reach for three.js.
//
// Allocation discipline: every routine either writes into a caller-supplied buffer or allocates
// exactly one typed array. No string keys, no Array.shift, no per-node closures — the editor calls
// these on every stroke and a per-tile object would dominate the frame budget (PLAN §4.0).

/** Orthogonal steps, in the order mapdata.js and wendford_crossing.js walk them, so a port of any
 *  existing sweep visits tiles in the same sequence and produces the same tie-breaks.
 *  @type {ReadonlyArray<readonly [number, number]>} */
export const NEIGH4 = Object.freeze([
  Object.freeze([1, 0]), Object.freeze([-1, 0]), Object.freeze([0, 1]), Object.freeze([0, -1]),
]);

// Edge slots. An undirected grid has exactly two edges per node that are not duplicates of another
// node's: the one going east and the one going south. Storing them at 2*i and 2*i+1 gives every
// edge a dense integer id with no hashing, which is what makes jumpgraph's `need[]` sublevel-set
// trick (PLAN §4.1) a single array lookup.
export const EDGE_E = 0, EDGE_S = 1;

/** Node id of (x,z) on a w-wide grid. Row-major, matching MAP.tiles[z][x]. */
export function idx(w, x, z) { return z * w + x; }

/** Inverse of idx(). Returns a fresh pair; callers in hot loops should use `i % w` directly. */
export function xz(w, i) { const x = i % w; return [x, (i - x) / w]; }

/** Dense id of the east (dir 0) or south (dir 1) edge leaving node i. */
export function edgeIdx(i, dir) { return 2 * i + dir; }

/**
 * Visit every undirected edge of a w-wide, n-node grid exactly once as (a, b, edgeId, dir).
 * East edges are skipped on the last column and south edges on the last row — the two boundary
 * cases every hand-rolled copy of this loop gets wrong. `d` is derived as n/w, so a caller that
 * passes a ragged n simply gets fewer south edges rather than reading off the end.
 * @param {number} n number of nodes (w*d)
 * @param {number} w grid width
 * @param {(a:number, b:number, e:number, dir:number)=>void} fn
 */
export function forEachGridEdge(n, w, fn) {
  for (let i = 0; i < n; i++) {
    if (i % w !== w - 1) fn(i, i + 1, 2 * i + EDGE_E, EDGE_E);
    if (i + w < n) fn(i, i + w, 2 * i + EDGE_S, EDGE_S);
  }
}

/**
 * Unweighted multi-source BFS. `dist[i]` is the step count from the nearest source, -1 unreachable.
 *
 * The queue is a plain Int32Array of length n with a head and a tail and no modulo: a node is
 * enqueued only on the transition from -1 to a real distance, so at most n pushes ever happen and
 * the buffer cannot wrap. (The "ring" of PLAN §4.3 is the same object with the wrap proved away.)
 *
 * `neighbourFn` receives the node and a `visit` callback and calls it once per candidate
 * neighbour; admission rules (height, water, blocked tiles) live in the caller, not here. `visit`
 * is allocated once per ringBfs call, never per node.
 *
 * @param {number} n
 * @param {ArrayLike<number>} sources node ids; out-of-range and duplicate entries are ignored
 * @param {(i:number, visit:(j:number)=>void)=>void} neighbourFn
 * @param {Int16Array|Int32Array|number[]} [dist] scratch of length >= n, overwritten with -1 first
 * @param {{prev?:Int32Array, order?:Int32Array, queue?:Int32Array, maxDist?:number}} [opts]
 *        prev  — predecessor per node, -1 at sources and unreached (path reconstruction)
 *        order — receives node ids in BFS pop order; read only the first `dist`-reached entries
 *        queue — reusable Int32Array(n) scratch
 *        maxDist — stop expanding past this radius (the reach overlay's bounded flood)
 * @returns {Int16Array|Int32Array|number[]} the same `dist` buffer, for chaining
 */
export function ringBfs(n, sources, neighbourFn, dist, opts) {
  const o = opts || {};
  const D = dist || new Int16Array(n);
  const prev = o.prev || null, order = o.order || null;
  const q = o.queue && o.queue.length >= n ? o.queue : new Int32Array(n);
  const cap = typeof o.maxDist === 'number' ? o.maxDist : Infinity;
  for (let i = 0; i < n; i++) { D[i] = -1; if (prev) prev[i] = -1; }
  let head = 0, tail = 0;
  for (let s = 0; s < sources.length; s++) {
    const i = sources[s];
    if (i >= 0 && i < n && D[i] < 0) { D[i] = 0; q[tail++] = i; }
  }
  let seen = 0, cur = -1, nd = 0;
  const visit = (j) => { if (j >= 0 && j < n && D[j] < 0) { D[j] = nd; if (prev) prev[j] = cur; q[tail++] = j; } };
  while (head < tail) {
    cur = q[head++];
    if (order) order[seen] = cur;
    seen++;
    const dd = D[cur];
    if (dd >= cap) continue;          // reached but not expanded: the bounded flood's frontier
    nd = dd + 1;
    neighbourFn(cur, visit);
  }
  return D;
}

/**
 * Connected-component labels over the grid's undirected edges, filtered by `edgeOk`.
 *
 * label[i] is the SMALLEST node id in i's component, not an arbitrary root: union always keeps the
 * lower index, so labels are canonical and two runs at different thresholds can be compared
 * directly — which is exactly what requiredClimb()'s binary search over per-threshold label arrays
 * needs (PLAN §4.4). Union-find with union-by-lower-index and path halving; no recursion.
 *
 * @param {number} n
 * @param {(a:number, b:number, e:number, dir:number)=>boolean} edgeOk
 * @param {number} [w] grid width. Defaults to n — one row, i.e. a path graph — so the two-argument
 *        form in PLAN §3.1 stays legal and well-defined rather than guessing a shape.
 * @returns {Int32Array} labels, length n
 */
export function components(n, edgeOk, w = n) {
  const p = new Int32Array(n);
  for (let i = 0; i < n; i++) p[i] = i;
  const find = (i) => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; };
  forEachGridEdge(n, w, (a, b, e, dir) => {
    if (!edgeOk(a, b, e, dir)) return;
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (ra < rb) p[rb] = ra; else p[ra] = rb;
  });
  for (let i = 0; i < n; i++) p[i] = find(i);   // full compression, so label[i] is a direct read
  return p;
}
