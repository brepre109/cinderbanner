// steppedTower — a stack of concentric terraces whose risers are individually tiered, so one piece
// of terrain prices several classes at once: the lower risers are base-tier stairs anybody walks,
// and the last one is the tier that owns the crown.
//
// The crown is a PERCH, not a route: rules.js gives a unit on higher ground +10% accuracy and a
// ranged bonus, so a two-tile top that only 6h classes reach is a real tactical statement even
// though no path runs over it. analyseMap will report it as a pocket with its minimum tier, which
// is the legible form of exactly that statement.
//
// The final riser is declared once, at the nominated access side, and the tower footprint is a
// `scenery` region. That is the honest reading: a crown ring is the same drop on all four sides, so
// every class at its tier can take it from any side. Declaring one face per side would be four
// copies of one fact; pretending only the access side exists would be a lie the discovery pass in
// analysis/classify.js catches immediately.
const DIRV = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

/**
 * @param {import('../canvas.js').Canvas} c
 * @param {{x:number, z:number, size:number, base:number, risers?:number[], t?:string,
 *          crownT?:string, access?:'n'|'s'|'e'|'w', note?:string}} o
 *   x,z    NW corner of the footprint square.
 *   risers h per level, innermost last. Each level insets the square by one tile per riser.
 *   access which side the declared face for the FINAL riser sits on.
 * @returns {{entry:[number,number], exit:[number,number], faces:object[], chokes:[],
 *            levels:Array<{h:number, rect:number[]}>, region:object, crown:object}}
 */
export function steppedTower(c, o) {
  const risers = o.risers && o.risers.length ? o.risers.slice() : [c.baseTier, c.baseTier, 6];
  const size = o.size, acc = o.access || 'n';
  if (size < 2 * risers.length + 1) throw new Error(`steppedTower: size ${size} cannot carry ${risers.length} risers (needs ${2 * risers.length + 1})`);
  const levels = [];
  let h = o.base;
  for (let k = 0; k <= risers.length; k++) {
    const rect = [o.x + k, o.z + k, o.x + size - 1 - k, o.z + size - 1 - k];
    c.fill(rect[0], rect[1], rect[2], rect[3], h, k === risers.length ? (o.crownT ?? 's') : (o.t ?? 'r'));
    levels.push({ h, rect });
    h += risers[k] ?? 0;
  }
  const crown = levels[levels.length - 1], ring = levels[levels.length - 2];
  const last = risers[risers.length - 1];
  // The access pair: a crown edge tile and the ring tile immediately outside it on `access`.
  const [dx, dz] = DIRV[acc];
  const cxm = Math.round((crown.rect[0] + crown.rect[2]) / 2), czm = Math.round((crown.rect[1] + crown.rect[3]) / 2);
  const hi = [dx ? (dx > 0 ? crown.rect[2] : crown.rect[0]) : cxm, dz ? (dz > 0 ? crown.rect[3] : crown.rect[1]) : czm];
  const lo = [hi[0] + dx, hi[1] + dz];
  const faces = last > c.baseTier
    ? [c.declareFace({ from: hi, to: lo, kind: 'local',
      note: o.note || `the crown riser: ${last}h off the ${ring.h}h ring, the same on all four sides` })]
    : [];
  const region = c.declareRegion({ kind: 'scenery', rect: [o.x, o.z, o.x + size - 1, o.z + size - 1],
    note: `stepped tower, risers ${risers.join('/')}h — relief, not a route` });
  const crownRg = c.declareRegion({ kind: 'perch', rect: crown.rect,
    note: `crown at ${crown.h}h: +10% accuracy and the ranged bonus for whoever can climb ${last}h` });
  return { entry: lo, exit: [cxm, czm], faces, chokes: [], levels, region, crown: crownRg };
}
