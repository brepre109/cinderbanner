// cliffFace — a run of terrain that states, in the mesh and in the design contract at once, "you do
// not climb here; you climb THERE".
//
// The `wall` parapet along the top of every tile except the declared breaks is the VISUAL statement
// and nothing more: PROP_SPEC.wall is `blocking:false` and `coord:'edgeFree'`, so it clears no tile
// and rules.js reads the whole run as walkable pairs stepping `top - base`. A parapet cannot gate.
//
// The gate is terrain. Every foot tile outside a break is cut to void, which is the only cut rules.js
// honours for every class (canvas.isolate's own note). Without it a 6h run is a 6h face at EVERY
// tile: faceScan discovers the lot and analyseMap emits one `contract.face-undeclared` error per
// tile — "declare it or flatten it" — so the region the run declares is refuted by the analyser that
// reads it. A scenery region does not save it: validate.js's `exempt` honours scenery, report.js's
// face scan does not.
//   gate:true (default) — isolate the run: only the feet that actually form a >baseTier step are
//                    cut, and only outside the breaks. Legal steps, water, existing void and the
//                    board edge are left exactly as the caller left them.
//   undercut:true  — the blunt form: void the whole foot line between breaks whether or not it
//                    stepped. What a canyon rim wants when the foot must read as a drop everywhere.
//   gate:false     — the caller has already handled the foot (water, void, off-board, or a step
//                    inside baseTier). Nothing is cut and nothing is claimed.
// Either way the break tiles carry declared faces, so the edges the author meant are the edges the
// validator proves.
import { tierFor } from '../canvas.js';
const AX = (a) => (a === 'x' ? [1, 0] : [0, 1]);

/**
 * @param {import('../canvas.js').Canvas} c
 * @param {{x:number, z:number, len:number, axis?:'x'|'z', base:number, top:number, side?:1|-1,
 *          breaks?:number[], t?:string, footT?:string, parapet?:boolean, undercut?:boolean,
 *          gate?:boolean, kind?:string, foot?:boolean, note?:string}} o
 *   x,z    the first TOP tile of the run.
 *   side   which perpendicular side the foot lies on (+1 default).
 *   breaks indices along the run, 0-based, where the parapet is missing and a face is declared.
 * @returns {{entry:[number,number], exit:[number,number], faces:object[], chokes:[],
 *            tiles:Array<[number,number]>, foot:Array<[number,number]>, cut:Array<[number,number]>,
 *            region:object|null}}
 */
export function cliffFace(c, o) {
  const axis = o.axis || 'x', side = o.side ?? 1, len = o.len, drop = o.top - o.base;
  const breaks = new Set(o.breaks || []);
  const [ax, az] = AX(axis), [px, pz] = AX(axis === 'x' ? 'z' : 'x');
  // The assertion this primitive exists to make. A cliff whose drop is not a roster tier is either
  // a step the base tier takes anyway (nothing is gated) or one no class can climb (a wall wearing
  // a face's clothes); both are authoring mistakes, and both are silent without this line.
  if (tierFor(drop) !== drop) throw new Error(`cliffFace: a ${drop}h drop is not a roster tier — the nearest above it is ${tierFor(drop)}h`);

  const tiles = [], foot = [], faces = [];
  for (let i = 0; i < len; i++) {
    const x = o.x + ax * i, z = o.z + az * i;
    const fx = x + px * side, fz = z + pz * side;
    c.put(x, z, o.top, o.t ?? null); tiles.push([x, z]);
    if (o.foot !== false) c.put(fx, fz, o.base, o.footT ?? null);
    foot.push([fx, fz]);
    if (breaks.has(i)) {
      faces.push(c.declareFace({ from: [x, z], to: [fx, fz], kind: o.kind || 'express',
        note: o.note || `break ${i} of a ${len}-tile ${drop}h cliff` }));
    } else if (o.parapet !== false) {
      // wall is edgeFree and takes h in HEIGHT STEPS: it caps the terrace top, so h is `top`, and
      // the run line sits on the boundary between the top tile and its foot.
      c.prop({ type: 'wall', x: axis === 'x' ? x : x + (side > 0 ? 1 : 0), z: axis === 'x' ? z + (side > 0 ? 1 : 0) : z,
        len: 1, dir: axis, h: o.top, in: side > 0 ? 1 : -1 });
    }
  }
  if (o.undercut) {
    for (let i = 0; i < len; i++) if (!breaks.has(i)) { const [fx, fz] = foot[i]; c.put(fx, fz, null, 'v'); }
  }
  // `except` is the break feet, so the declared vaults survive the cut and everything else does not.
  // Run AFTER the undercut: a tile already void is not walkable and isolate skips it.
  const cut = o.gate === false ? [] : c.isolate(tiles, { except: breaks.size ? [...breaks].filter((i) => i >= 0 && i < len).map((i) => foot[i]) : [] });
  const region = o.undercut ? null : c.declareRegion({ kind: 'scenery',
    rect: [Math.min(o.x, foot[len - 1][0]), Math.min(o.z, foot[len - 1][1]), Math.max(o.x + ax * (len - 1), foot[0][0]), Math.max(o.z + az * (len - 1), foot[0][1])],
    note: `${drop}h cliff run: ${breaks.size} declared break(s), ${cut.length} approach tile(s) cut to void` });
  return { entry: [o.x, o.z], exit: [o.x + ax * (len - 1), o.z + az * (len - 1)], faces, chokes: [], tiles, foot, cut, region };
}
