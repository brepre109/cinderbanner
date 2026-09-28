// catwalk — a walkable span carried over live water.
//
// props.md §3.15 states the trap plainly: the `deck` PROP is the visible surface and the DECKS
// grant is the rules-visible walk permission, and either alone is a bug — a bridge nobody can
// cross, or units walking on open water. The Canvas answers that at the schema level (decks.mode is
// 'auto', so the grant is derived from the deck rectangle at compile time and cannot desync), which
// leaves this primitive one real job: make sure the span is actually approachable.
//
// Both approach tiles are FORCED into [h, h + baseTier]. Below h and the water stands over its own
// bank (terrain.js emits no bank face and the slab floats); more than baseTier above and
// `deck.step` fires because no shore tile is within a base-tier step of the deck — a bridge the
// majority roster can see and cannot board.
const AX = (a) => (a === 'x' ? [1, 0] : [0, 1]);
const cl = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * @param {import('../canvas.js').Canvas} c
 * @param {{from:[number,number], to:[number,number], h?:number, w?:number, style?:'stone'|'wood',
 *          rail?:boolean, water?:boolean, choke?:boolean, tier?:number, note?:string}} o
 *   from/to  the two SHORE tiles. The span is every tile strictly between them.
 *   w        span width across the run.
 *   water    cut the span tiles to live water at `h` (default true). false decks a dry gap.
 * @returns {{entry:[number,number], exit:[number,number], faces:[], chokes:object[],
 *            tiles:Array<[number,number]>, deck:object, choke:object|null}}
 */
export function catwalk(c, o) {
  const [x0, z0] = o.from, [x1, z1] = o.to, h = o.h ?? 0, wid = o.w ?? 1;
  const axis = Math.abs(x1 - x0) >= Math.abs(z1 - z0) ? 'x' : 'z';
  const [ax, az] = AX(axis), [px, pz] = AX(axis === 'x' ? 'z' : 'x');
  const sgn = (axis === 'x' ? x1 - x0 : z1 - z0) < 0 ? -1 : 1;
  const len = Math.abs(axis === 'x' ? x1 - x0 : z1 - z0) - 1;
  if (len < 1) throw new Error('catwalk: the two shores are adjacent — there is nothing to span');
  const tiles = [];
  for (let i = 1; i <= len; i++) for (let k = 0; k < wid; k++) {
    const x = x0 + ax * sgn * i + px * k, z = z0 + az * sgn * i + pz * k;
    if (o.water !== false) c.put(x, z, h, 'w'); else c.put(x, z, h, 'b');
    tiles.push([x, z]);
  }
  // NW corner of the deck rectangle, in the span's own direction of travel: for sgn -1 the first
  // spanned tile is the SOUTH/EAST end, and a deck authored from there would run off the board.
  const n0 = tiles.reduce((b, p) => (p[0] < b[0] || (p[0] === b[0] && p[1] < b[1]) ? p : b), tiles[0]);
  const deck = c.deck(n0[0], n0[1], { len, w: wid, dir: axis, h, style: o.style || 'stone' });
  if (o.rail !== false) for (const s of [0, wid]) {
    const rx = axis === 'x' ? n0[0] : n0[0] + s, rz = axis === 'x' ? n0[1] + s : n0[1];
    c.prop({ type: 'rail', x: rx, z: rz, len, dir: axis, h });
  }
  for (const [sx, sz] of [o.from, o.to]) {
    const cur = c.hAt(sx, sz);
    for (let k = 0; k < wid; k++) c.put(sx + px * k, sz + pz * k, cl(cur, h, h + c.baseTier), null);
  }
  const choke = o.choke === false ? null : c.declareChoke({ tiles, tier: o.tier ?? c.baseTier,
    note: o.note || `the ${len}x${wid} ${o.style || 'stone'} span: the only ${o.tier ?? c.baseTier}h crossing here` });
  c.protectTiles([o.from, o.to]);
  return { entry: [x0, z0], exit: [x1, z1], faces: [], chokes: choke ? [choke] : [], tiles, deck, choke };
}
