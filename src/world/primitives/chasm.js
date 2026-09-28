// chasm — a bite taken out of the board.
//
// void:true is the strong form: terrain.js reads a void tile as off-map, so its neighbours emit the
// same cliff face and black skirt the outer rim gets, and rules.js can never step onto it at any
// jump. That makes a void chasm the only ABSOLUTE separator in the vocabulary — height gates a
// tier, void gates everyone — which is why the switchback and the ledge both build on it.
//
// Two contracts come with it, both from props.md §5, and both are enforced here rather than left to
// the validator: void sits at or below the cut height (its black cap is drawn at h + 0.03, so a
// void tile above the surrounding cliff bottoms floats as a visible shelf), and void is never
// orthogonally adjacent to water (the tile's earth face shows through the black cap). The final
// parking happens in Canvas.settle(), because cutH is a property of the FINISHED board; what this
// primitive does is refuse the tiles that would break the water rule and say which they were.
import { VOID_DROP } from '../canvas.js';

/**
 * @param {import('../canvas.js').Canvas} c
 * @param {{rect:[number,number,number,number], void?:boolean, floor?:number, t?:string,
 *          kind?:string, note?:string}} o
 *   void   default true. false carves a dry sunken bed at `floor` instead — a walkable gorge floor.
 *   floor  required when void is false; the bed height in h.
 * @returns {{entry:null, exit:null, faces:[], chokes:[], tiles:Array<[number,number]>,
 *            refused:Array<[number,number]>, region:object}}
 */
export function chasm(c, o) {
  const [x0, z0, x1, z1] = o.rect, isVoid = o.void !== false;
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), az = Math.min(z0, z1), bz = Math.max(z0, z1);
  const tiles = [], refused = [];
  // The current cut, so a caller that reads H back straight away sees a parked tile. settle() does
  // this again over the finished board; doing it twice is free and doing it never is a floating cap.
  let cut = Infinity;
  for (let z = 0; z < c.d; z++) for (let x = 0; x < c.w; x++) {
    const t = c.T[z][x]; if (t !== 'w' && t !== 'v') cut = Math.min(cut, c.H[z][x]);
  }
  if (!Number.isFinite(cut)) cut = 0;
  for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) {
    if (!c.inb(x, z)) continue;
    if (isVoid && c.neighbours(x, z).some(([nx, nz]) => c.tAt(nx, nz) === 'w')) { refused.push([x, z]); continue; }
    if (isVoid) c.put(x, z, cut - VOID_DROP, 'v');
    else c.put(x, z, o.floor, o.t ?? 'r');
    tiles.push([x, z]);
  }
    // 'scenery' is the sweep exemption, and a void bite does not need it — void pairs are already
  // exempt. A DRY bed does not get it by default: its walls are real walkable steps and the author
  // should declare them or terrace them, not have them quietly waived.
  const region = c.declareRegion({ kind: o.kind || (isVoid ? 'scenery' : 'note'), rect: [ax, az, bx, bz],
    note: o.note || (isVoid ? `void bite parked at ${cut - VOID_DROP}h, ${refused.length} tile(s) refused beside water` : `sunken bed at ${o.floor}h`) });
  return { entry: null, exit: null, faces: [], chokes: [], tiles, refused, region };
}
