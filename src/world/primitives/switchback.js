// switchback — the deliberate detour, and the most load-bearing primitive in the vocabulary.
//
// A shortcut is only worth what the long way costs. Every express face on a map is priced as
// `turns(long) - turns(short)`, so a map whose base tier can walk more or less straight at the
// vault produces `contract.face-worthless` no matter how dramatic the cliff looks. The switchback
// is what puts real distance in the denominator: N legs the base tier must walk end to end, each
// one reachable only from the free end of the last.
//
// The legs are separated by a VOID divider, not by height. Height cannot do this job: a riser above
// baseTier between two walkable legs is an undeclared face that any higher tier hops, and a riser
// at or below baseTier is a straight climb that nobody bothers to walk around. Void is absolute —
// rules.js steps the 4-neighbour grid one tile at a time, so no jump, however large, crosses a tile
// that is not there. terrain.js reads a void tile as off-map and draws the neighbours' cliff faces
// down to the diorama floor, so the divider renders as the fissure it is.
const AX = (a) => (a === 'x' ? [1, 0] : [0, 1]);

/**
 * @param {import('../canvas.js').Canvas} c
 * @param {{rect:[number,number,number,number], legs?:number, rise?:number, base?:number,
 *          axis?:'x'|'z', width?:number, t?:string, dividerT?:string, isolate?:boolean,
 *          descend?:boolean, note?:string}} o
 *   rect   [x0,z0,x1,z1]; legs run the full extent along `axis` and stack along the other.
 *   base   height of leg 0. Leg k sits at base + k*rise, or base - k*rise when `descend`.
 *   descend stack downhill instead of uphill. The mouths are fixed by geometry — leg 0's free end
 *          is always at the rect's low corner — so this is how a caller aims the LOW mouth at the
 *          gorge it descends into rather than at the rim it left.
 *   rise   h gained per leg, default baseTier — the largest a connector may cost.
 *   isolate cut every approach onto the legs except the two mouths (default true). Off only when
 *          the caller has already walled the block in.
 * @returns {{entry:[number,number], exit:[number,number], faces:[], chokes:[],
 *            tiles:Array<[number,number]>, legs:Array<Array<[number,number]>>, region:object,
 *            route:Array<[number,number]>}}
 */
export function switchback(c, o) {
  const [x0, z0, x1, z1] = o.rect, axis = o.axis || 'x';
  const legs = o.legs ?? 3, width = o.width ?? 1, rise = o.rise ?? c.baseTier;
  const t = o.t ?? 'd', dividerT = o.dividerT ?? 'v';
  const [ax, az] = AX(axis), [px, pz] = AX(axis === 'x' ? 'z' : 'x');
  const runLo = axis === 'x' ? x0 : z0, runHi = axis === 'x' ? x1 : z1;
  const stackLo = axis === 'x' ? z0 : x0, stackHi = axis === 'x' ? z1 : x1;
  const need = legs * width + (legs - 1);
  if (stackHi - stackLo + 1 < need) throw new Error(`switchback: ${legs} legs of width ${width} need ${need} rows across the rect, which offers ${stackHi - stackLo + 1}`);
  if (rise > c.baseTier) throw new Error(`switchback: rise ${rise}h is above baseTier ${c.baseTier}h — the connector would be a face, not a climb`);
  const base = o.base ?? c.hAt(runLo * ax + stackLo * px, runLo * az + stackLo * pz) ?? 0;
  const dh = o.descend ? -rise : rise, hOf = (k) => base + k * dh;

  const at = (run, stack) => [ax * run + px * stack, az * run + pz * stack];
  const tiles = [], legTiles = [], route = [];
  for (let k = 0; k < legs; k++) {
    const h = hOf(k), s0 = stackLo + k * (width + 1), leg = [];
    for (let s = s0; s < s0 + width; s++) for (let r = runLo; r <= runHi; r++) {
      const [x, z] = at(r, s); c.put(x, z, h, t); leg.push([x, z]); tiles.push([x, z]);
    }
    legTiles.push(leg);
    // The connector: one tile punched through the divider at alternating ends, sitting at the UPPER
    // leg's height so the step off the lower leg is exactly `rise` and the step onto the upper is 0.
    // The connector is as wide as the legs it joins: a 2-wide switchback pinched to one tile at
    // every turn is a route three KO'd bodies can cork, and `hazard.choke1` says so per corner.
    if (k + 1 < legs) {
      const hi = k % 2 === 0, ds = s0 + width;
      for (let r = runLo; r <= runHi; r++) { const [vx, vz] = at(r, ds); c.put(vx, vz, base, dividerT); }
      for (let j = 0; j < width; j++) {
        const [cx, cz] = at(hi ? runHi - j : runLo + j, ds);
        c.put(cx, cz, hOf(k + 1), t); tiles.push([cx, cz]); legTiles[k].push([cx, cz]);
        if (j === 0) route.push([cx, cz]);
      }
    }
  }
  // Mouths: leg 0's free end is the end its connector is NOT at, and likewise for the last leg.
  const mouth0 = runLo, mouthN = legs > 1 ? ((legs - 2) % 2 === 0 ? runLo : runHi) : runHi;
  const entry = at(mouth0, stackLo), exit = at(mouthN, stackLo + (legs - 1) * (width + 1));
  const out = (run) => (run === runLo ? -1 : 1);
  const beyond = ([x, z], run) => [x + ax * out(run), z + az * out(run)];
  if (o.isolate !== false) c.isolate(tiles, { all: true, except: [beyond(entry, mouth0), beyond(exit, mouthN)] });
  const region = c.declareRegion({ kind: 'road', rect: [x0, z0, x1, z1],
    note: o.note || `${legs}-leg switchback: the ${c.baseTier}h tier walks ${legs} full legs to ${o.descend ? 'lose' : 'gain'} ${(legs - 1) * rise}h` });
  route.unshift(entry); route.push(exit);
  return { entry, exit, faces: [], chokes: [], tiles, legs: legTiles, region, route };
}
