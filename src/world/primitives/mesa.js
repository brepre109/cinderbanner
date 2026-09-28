// mesa — COMPOUND: a crown plateau ringed by an apron moat, with one landing per declared tier.
//
// The moat is the part that is easy to leave out and fatal to leave out. Put two landings at
// different heights on the same ring and a 6h class that vaults onto the low landing simply WALKS
// round to the high one; both tiers then reach everything, the ladder flattens, and the map's
// vertical statement is a decoration. The apron is a void ring between the landings, so a landing
// is a dead end apart from the crown above it — the tiers stay separate because the geometry keeps
// them separate, not because we hoped nobody would notice.
import { chasm } from './chasm.js';

const SIDE = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

/**
 * @param {import('../canvas.js').Canvas} c
 * @param {{rect:[number,number,number,number], base:number, crownH:number,
 *          landings?:Array<{side:'n'|'s'|'e'|'w', at?:number, tier:number, note?:string}>,
 *          t?:string, crownT?:string, moat?:boolean, note?:string}} o
 *   rect     the whole mesa footprint. The crown is that rect inset by 2; the ring between them is
 *            the apron. `base` is the apron height, `crownH` the plateau.
 *   landings one per tier the mesa designs for; `at` is the coordinate along that side, defaulting
 *            to the middle. The landing sits at crownH - tier, so the vault onto the crown is
 *            exactly `tier` and the step up from the apron is what is left.
 * @returns {{entry:[number,number], exit:[number,number], faces:object[], chokes:[],
 *            crown:number[], landings:Array<object>, region:object}}
 */
export function mesa(c, o) {
  const [x0, z0, x1, z1] = o.rect, landings = o.landings || [{ side: 'n', tier: 6 }];
  const crown = [x0 + 2, z0 + 2, x1 - 2, z1 - 2];
  if (crown[2] < crown[0] || crown[3] < crown[1]) throw new Error(`mesa: ${x1 - x0 + 1}x${z1 - z0 + 1} is too small to hold a crown inside its apron`);
  c.fill(x0, z0, x1, z1, o.base, o.t ?? 'r');
  c.fill(crown[0], crown[1], crown[2], crown[3], o.crownH, o.crownT ?? 'k');
  // The apron: the one-tile ring between the footprint edge and the crown, cut to void so nothing
  // travels laterally from one landing to the next.
  const ring = [x0 + 1, z0 + 1, x1 - 1, z1 - 1];
  if (o.moat !== false) for (const r of [[ring[0], ring[1], ring[2], ring[1]], [ring[0], ring[3], ring[2], ring[3]],
    [ring[0], ring[1], ring[0], ring[3]], [ring[2], ring[1], ring[2], ring[3]]]) chasm(c, { rect: r, void: true, kind: 'note' });

  const faces = [], seats = [];
  for (const L of landings) {
    const [dx, dz] = SIDE[L.side], h = o.crownH - L.tier;
    if (h - o.base > c.baseTier) throw new Error(`mesa: a ${L.tier}h landing on the ${L.side} side sits ${h - o.base}h over the apron, above baseTier ${c.baseTier}h`);
    // The landing tile on the ring, and the crown tile it vaults onto.
    const mid = dx ? Math.round((ring[1] + ring[3]) / 2) : Math.round((ring[0] + ring[2]) / 2);
    const at = L.at ?? mid;
    const lx = dx ? (dx > 0 ? ring[2] : ring[0]) : at, lz = dz ? (dz > 0 ? ring[3] : ring[1]) : at;
    c.put(lx, lz, h, o.t ?? 'r');
    faces.push(c.declareFace({ from: [lx - dx, lz - dz], to: [lx, lz], kind: 'express',
      note: L.note || `the ${L.side} landing: ${L.tier}h onto the crown, ${h - o.base}h up off the apron` }));
    seats.push({ side: L.side, tier: L.tier, tile: [lx, lz], outside: [lx + dx, lz + dz] });
  }
  const region = c.declareRegion({ kind: 'perch', rect: crown,
    note: o.note || `crown at ${o.crownH}h, ${landings.length} landing(s) separated by the apron moat` });
  return { entry: seats[0].outside, exit: [Math.round((crown[0] + crown[2]) / 2), Math.round((crown[1] + crown[3]) / 2)],
    faces, chokes: [], crown, landings: seats, region };
}
