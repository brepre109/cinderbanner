// stairFlight — an ANTI-shortcut. It exists so the base tier can cross a break that would otherwise
// be a face, which is what keeps the express faces meaningful: if the majority roster simply cannot
// get up the hill, every vault reads as a gate and the ladder collapses into "who can move at all".
//
// The engine has no ladder or rope entity. The engine's only traversal aid is the `stairs` prop, whose
// second tread lets ONE tile bridge a 2h terrace break (props.md §3.2). So a flight is TERRAIN — a
// run of landings each within baseTier of the last — with a stairs prop on every landing to say so
// in the mesh. The declared assist is what lets validate.js prove it: a stair tile with two
// baseTier approaches more than baseTier apart is the second tread actually doing the work.
const DIRV = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

/**
 * @param {import('../canvas.js').Canvas} c
 * @param {{x:number, z:number, dir?:'n'|'s'|'e'|'w', lowH:number, highH:number, width?:number,
 *          rise?:number, t?:string, note?:string}} o
 *   x,z    the FIRST landing, one step up-slope from the low ground.
 *   dir    direction of ASCENT (props.md's own vocabulary for the prop).
 *   width  landings laid side by side across the ascent; the shipped map pairs them across a lane.
 *   rise   h per landing, default baseTier — the largest step every landing may cost.
 * @returns {{entry:[number,number], exit:[number,number], faces:[], chokes:[],
 *            tiles:Array<[number,number]>, assist:object|null, props:object[]}}
 */
export function stairFlight(c, o) {
  const dir = o.dir || 'n', v = DIRV[dir];
  if (!v) throw new Error(`stairFlight: dir '${o.dir}' is not one of n/s/e/w`);
  const width = o.width ?? 2, rise = o.rise ?? c.baseTier, t = o.t ?? 's';
  const [px, pz] = v[0] === 0 ? [1, 0] : [0, 1];                       // across the ascent
  const span = o.highH - o.lowH;
  if (span <= 0) throw new Error(`stairFlight: highH ${o.highH} is not above lowH ${o.lowH}`);
  // Landings strictly between the two grounds. A break inside baseTier needs none, and we build one
  // anyway so the flight still reads as steps in the mesh — but we do NOT declare an assist for it,
  // because a declaration the validator would refute is worse than no declaration at all.
  const treads = Math.max(1, Math.ceil(span / rise) - 1);
  const step = span / (treads + 1);
  const tiles = [], props = [];
  for (let i = 0; i < treads; i++) {
    const h = o.lowH + Math.round((step * (i + 1)) / 2) * 2;           // even h: the terrace unit
    for (let k = 0; k < width; k++) {
      const x = o.x + v[0] * i + px * k, z = o.z + v[1] * i + pz * k;
      c.put(x, z, h, t); tiles.push([x, z]);
      props.push(c.prop({ type: 'stairs', x, z, dir }));
    }
  }
  // The two grounds the flight joins. Written, not assumed: an assist whose approaches are whatever
  // the caller happened to leave there is exactly the declaration that rots.
  for (let k = 0; k < width; k++) {
    c.put(o.x - v[0] + px * k, o.z - v[1] + pz * k, o.lowH, null);
    c.put(o.x + v[0] * treads + px * k, o.z + v[1] * treads + pz * k, o.highH, null);
  }
  const entry = [o.x - v[0], o.z - v[1]], exit = [o.x + v[0] * treads, o.z + v[1] * treads];
  const assist = span > c.baseTier
    ? c.declareAssist({ kind: 'stairs', tiles, dir, bridges: { lowH: o.lowH, highH: o.highH },
      note: o.note || `paired stairs carry the ${c.baseTier}h tier from ${o.lowH}h to ${o.highH}h` })
    : null;
  c.protectTiles([entry, exit]);
  return { entry, exit, faces: [], chokes: [], tiles, assist, props };
}
