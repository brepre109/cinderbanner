// canyon — COMPOUND: two rims, one floor, and N crossings each priced at a declared tier.
//
// The undercut is what makes a canyon a routing statement instead of a long cliff. A floor merely
// sitting 8h below its rims is an 8h face at every tile of both walls: `faceScan` discovers a
// hundred of them, `contract.face-undeclared` fires a hundred times, and every class at that tier
// crosses wherever it likes. So the wall foot is void along its whole length and the ONLY tiles
// that connect rim to floor are the ones a crossing punches through — which is exactly the set the
// primitive declares.
//
// A crossing's punched tile sits at `rimH - tier`, floored at the canyon floor. That single formula
// covers the whole ladder: tier == baseTier gives a bench the majority roster walks (declared as a
// choke, proven later by deletion), and any higher tier gives a step only that tier can take
// (declared as a face, priced later by a blocked-edge counterfactual).
import { chasm } from './chasm.js';
import { tierFor } from '../canvas.js';
const AX = (a) => (a === 'x' ? [1, 0] : [0, 1]);

/**
 * @param {import('../canvas.js').Canvas} c
 * @param {{rect:[number,number,number,number], axis?:'x'|'z', floorH:number, rimH?:number,
 *          floorT?:string, benchT?:string, wall?:number,
 *          crossings?:Array<{at:number, tier?:number, side?:'lo'|'hi'|'both', width?:number, note?:string}>,
 *          note?:string}} o
 *   rect  the FLOOR band. `axis` is the direction the gorge runs; the undercut columns are the
 *         `wall` tiles immediately outside the band on each side.
 *   rimH  defaults to the height already on the board just beyond the undercut.
 * @returns {{entry:[number,number], exit:[number,number], faces:object[], chokes:object[],
 *            floor:number[], crossings:Array<object>, region:object}}
 */
export function canyon(c, o) {
  const [x0, z0, x1, z1] = o.rect, axis = o.axis || 'z', wall = o.wall ?? 1;
  const [ax, az] = AX(axis), [px, pz] = AX(axis === 'x' ? 'z' : 'x');
  const runLo = axis === 'x' ? x0 : z0, runHi = axis === 'x' ? x1 : z1;
  const bandLo = axis === 'x' ? z0 : x0, bandHi = axis === 'x' ? z1 : x1;
  const at = (run, band) => [ax * run + px * band, az * run + pz * band];
  c.fill(x0, z0, x1, z1, o.floorH, o.floorT ?? 'r');
  const rimH = o.rimH ?? c.hAt(...at(Math.round((runLo + runHi) / 2), bandLo - wall - 1));
  if (rimH == null) throw new Error('canyon: rimH could not be read off the board — pass it explicitly');

  // Undercut both walls first; the crossings then punch back through it, which is one order of
  // operations instead of two lists to keep in step.
  for (const b of [bandLo - wall, bandHi + 1]) {
    const [cx0, cz0] = at(runLo, b), [cx1, cz1] = at(runHi, b + wall - 1);
    chasm(c, { rect: [cx0, cz0, cx1, cz1], void: true, kind: 'note', note: `canyon undercut, ${axis === 'x' ? 'z' : 'x'} = ${b}` });
  }
  const faces = [], chokes = [], made = [];
  for (const X of (o.crossings || [])) {
    const tier = X.tier ?? c.baseTier, width = X.width ?? 1;
    const ph = Math.max(o.floorH, rimH - tier), drop = rimH - ph;
    if (ph - o.floorH > c.baseTier) throw new Error(`canyon: a ${tier}h crossing lands ${ph - o.floorH}h over the floor, above baseTier ${c.baseTier}h`);
    for (const s of (X.side === 'lo' ? ['lo'] : X.side === 'hi' ? ['hi'] : ['lo', 'hi'])) {
      const b0 = s === 'lo' ? bandLo - wall : bandHi + 1, tiles = [];
      for (let k = 0; k < wall; k++) for (let i = 0; i < width; i++) {
        const [tx, tz] = at(X.at + i, b0 + k); c.put(tx, tz, ph, o.benchT ?? 's'); tiles.push([tx, tz]);
      }
      const [rx, rz] = at(X.at, s === 'lo' ? bandLo - wall - 1 : bandHi + wall + 1);
      const gate = drop > c.baseTier
        ? faces.push(c.declareFace({ from: [rx, rz], to: tiles[0], kind: 'express',
          note: X.note || `${s} rim, ${drop}h down onto the ${tier}h crossing` }))
        : chokes.push(c.declareChoke({ tiles, tier: tierFor(Math.max(drop, ph - o.floorH)),
          note: X.note || `${s} rim bench: the ${c.baseTier}h way in and out of the gorge` }));
      made.push({ at: X.at, side: s, tier, tiles, rim: [rx, rz], drop, gate });
    }
  }
  const region = c.declareRegion({ kind: 'road', rect: [x0, z0, x1, z1],
    note: o.note || `gorge floor at ${o.floorH}h under ${rimH}h rims, ${made.length} crossing(s)` });
  return { entry: at(runLo, Math.round((bandLo + bandHi) / 2)), exit: at(runHi, Math.round((bandLo + bandHi) / 2)),
    faces, chokes, floor: [x0, z0, x1, z1], crossings: made, region };
}
