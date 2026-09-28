// ledge — the canonical EXPRESS: a shelf running parallel to the low road, reachable from the high
// ground by exactly one declared vault.
//
// "Exactly one" is the entire mechanic and it is not something a height field expresses on its own.
// A shelf merely sitting 6h below a rim is a 6h face at EVERY tile of its long side: analyseMap
// discovers a wall of undeclared expresses, validate.js raises one `contract.face-undeclared` per
// tile, and the vault the author drew means nothing because there are twenty of them. So the shelf
// is ISOLATED — every approach steeper than baseTier, other than the declared vault, is cut to
// void — and what is left is a shelf you drop onto at one place and walk off at the other end.
//
// The rail is not decoration: `rail` is the prop props.js ships for a pier or quay lip, and a shelf
// with a visible edge reads as a place you can stand rather than a terracing accident.
const AX = (a) => (a === 'x' ? [1, 0] : [0, 1]);

/**
 * @param {import('../canvas.js').Canvas} c
 * @param {{x:number, z:number, len:number, axis?:'x'|'z', h:number, width?:number,
 *          from:[number,number], rail?:boolean, railSide?:1|-1, t?:string, isolate?:boolean,
 *          minTurnSaving?:number, note?:string}} o
 *   x,z    the first shelf tile; the shelf runs `len` tiles along `axis`, `width` across.
 *   from   the HIGH tile the vault leaves from. Must already carry its height and be orthogonally
 *          adjacent to a shelf tile — the face's drop is measured, never passed.
 *   railSide which perpendicular side the drop (and therefore the rail) is on.
 * @returns {{entry:[number,number], exit:[number,number], faces:object[], chokes:[],
 *            tiles:Array<[number,number]>, cut:Array<[number,number]>, region:object}}
 */
export function ledge(c, o) {
  const axis = o.axis || 'z', width = o.width ?? 1, len = o.len, t = o.t ?? 'r';
  const [ax, az] = AX(axis), [px, pz] = AX(axis === 'x' ? 'z' : 'x');
  const side = o.railSide ?? 1;
  const tiles = [];
  for (let i = 0; i < len; i++) for (let k = 0; k < width; k++) {
    const x = o.x + ax * i + px * k, z = o.z + az * i + pz * k;
    c.put(x, z, o.h, t); tiles.push([x, z]);
  }
  const [vx, vz] = o.from;
  const landing = tiles.find(([x, z]) => Math.abs(x - vx) + Math.abs(z - vz) === 1);
  if (!landing) throw new Error(`ledge: vault source ${vx},${vz} is not orthogonally adjacent to any shelf tile`);
  if (c.hAt(vx, vz) <= o.h) throw new Error(`ledge: vault source ${vx},${vz} is at ${c.hAt(vx, vz)}h, not above the ${o.h}h shelf`);
  // Isolate BEFORE declaring, so the face's own endpoints are already the only steep pair left and
  // the declaration describes the finished shape rather than the intended one.
  const cut = o.isolate === false ? [] : c.isolate(tiles, { except: [[vx, vz]] });
  const faces = [c.declareFace({ from: [vx, vz], to: landing, kind: 'express',
    minTurnSaving: o.minTurnSaving ?? 1,
    note: o.note || `the vault onto a ${len}-tile shelf at ${o.h}h; the shelf runs parallel to the low road` })];
  if (o.rail !== false) {
    // edgeFree: no snapping. The run line is the tile boundary on the drop side, and `h` is in
    // HEIGHT STEPS (props.md §6.9) — the surface the posts stand on, not a world Y.
    const rx = axis === 'x' ? o.x : o.x + (side > 0 ? width : 0);
    const rz = axis === 'x' ? o.z + (side > 0 ? width : 0) : o.z;
    c.prop({ type: 'rail', x: rx, z: rz, len, dir: axis, h: o.h });
  }
  const xs = tiles.map((p) => p[0]), zs = tiles.map((p) => p[1]);
  const region = c.declareRegion({ kind: 'perch', rect: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)],
    note: `express shelf: one declared vault on, ${cut.length} approach tile(s) cut to void` });
  c.protectTiles(tiles);
  return { entry: landing, exit: [o.x + ax * (len - 1), o.z + az * (len - 1)], faces, chokes: [], tiles, cut, region };
}
