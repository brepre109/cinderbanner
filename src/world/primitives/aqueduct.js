// aqueduct — COMPOUND: a raised causeway on `arch` piers, with a collapsed span as the tier-gated
// crossing. First and only user of the `arch` prop, which props.js has shipped unused since day one.
//
// The causeway is a road in the air: the base tier can walk its whole length, and a broken span is
// the one place it cannot. The gap tile is dropped to within baseTier of the ground, so the break
// is simultaneously (a) a barrier ALONG the causeway that only tierFor(h - gapH) classes step over
// and (b) the one place a unit on the ground can get UP onto it. One piece of terrain, two
// different sentences depending on which way you are travelling — which is what a broken bridge
// actually is, and what makes it worth more than a cliff of the same height.
//
// The flanks are trenched (a `chasm` down each side) for the same reason a ledge is isolated: a
// causeway whose long sides are merely 8h above walkable ground is an 8h face at every tile of both
// sides, and the gap stops meaning anything.
import { chasm } from './chasm.js';
const AX = (a) => (a === 'x' ? [1, 0] : [0, 1]);

/**
 * @param {import('../canvas.js').Canvas} c
 * @param {{x:number, z:number, len:number, axis?:'x'|'z', h:number, groundH:number, width?:number,
 *          broken?:number[], gapH?:number, pierEvery?:number, r?:number, t?:string, gapT?:string,
 *          parapet?:boolean, trench?:boolean, note?:string}} o
 *   x,z        the first causeway tile.
 *   broken     indices along the run whose span has fallen in.
 *   pierEvery  arch spacing in tiles (default 2 — one pier per bay).
 * @returns {{entry:[number,number], exit:[number,number], faces:object[], chokes:[],
 *            tiles:Array<[number,number]>, gaps:Array<[number,number]>, region:object}}
 */
export function aqueduct(c, o) {
  const axis = o.axis || 'x', width = o.width ?? 1, len = o.len;
  const [ax, az] = AX(axis), [px, pz] = AX(axis === 'x' ? 'z' : 'x');
  const broken = new Set(o.broken || []);
  const gapH = o.gapH ?? Math.min(o.groundH + c.baseTier, o.h - 2);
  if (o.h - gapH <= 0) throw new Error(`aqueduct: the causeway at ${o.h}h is not above its gap at ${gapH}h`);
  const tiles = [], gaps = [];
  for (let i = 0; i < len; i++) {
    const fallen = broken.has(i);
    for (let k = 0; k < width; k++) {
      const x = o.x + ax * i + px * k, z = o.z + az * i + pz * k;
      c.put(x, z, fallen ? gapH : o.h, fallen ? (o.gapT ?? 'r') : (o.t ?? 's'));
      tiles.push([x, z]);
      if (fallen && k === 0) gaps.push([x, z]);
    }
  }
  // Piers and parapets. `arch` and `wall` are both edgeFree and both take h in HEIGHT STEPS: the
  // arch springs from its `h`, so it sits a bay below the deck, and the parapet caps the deck.
  const archDir = axis === 'x' ? 'z' : 'x';
  for (let i = 0; i < len; i += (o.pierEvery ?? 2)) {
    if (broken.has(i)) continue;
    c.prop({ type: 'arch', x: o.x + ax * i + (axis === 'x' ? 0.5 : 0), z: o.z + az * i + (axis === 'x' ? 0 : 0.5),
      h: Math.max(o.groundH, o.h - 4), r: o.r ?? 0.7, dir: archDir, flip: false });
  }
  if (o.parapet !== false) for (const s of [0, width]) {
    const wx = axis === 'x' ? o.x : o.x + s, wz = axis === 'x' ? o.z + s : o.z;
    c.prop({ type: 'wall', x: wx, z: wz, len, dir: axis, h: o.h, in: s === 0 ? -1 : 1 });
  }
  if (o.trench !== false) for (const s of [-1, width]) {
    for (let i = 0; i < len; i++) {
      if (broken.has(i) || broken.has(i - 1) || broken.has(i + 1)) continue;   // leave the gap's ground approach
      const [tx, tz] = [o.x + ax * i + px * s, o.z + az * i + pz * s];
      if (Math.abs((c.hAt(tx, tz) ?? o.h) - o.h) > c.baseTier) chasm(c, { rect: [tx, tz, tx, tz], void: true, kind: 'note' });
    }
  }
  const faces = [];
  for (const [gx, gz] of gaps) for (const [nx, nz] of [[gx - ax, gz - az], [gx + ax, gz + az]]) {
    if (!c.inb(nx, nz) || c.hAt(nx, nz) !== o.h) continue;
    faces.push(c.declareFace({ from: [nx, nz], to: [gx, gz], kind: 'express',
      note: o.note || `the broken span: ${o.h - gapH}h down into the rubble, and the only way up onto the aqueduct` }));
  }
  const region = c.declareRegion({ kind: 'road', rect: [Math.min(o.x, o.x + ax * (len - 1)), Math.min(o.z, o.z + az * (len - 1)),
    Math.max(o.x + ax * (len - 1) + px * (width - 1), o.x), Math.max(o.z + az * (len - 1) + pz * (width - 1), o.z)],
    note: `${len}-tile causeway at ${o.h}h on ${Math.ceil(len / (o.pierEvery ?? 2))} arch pier(s), ${gaps.length} broken span(s)` });
  return { entry: [o.x, o.z], exit: [o.x + ax * (len - 1), o.z + az * (len - 1)], faces, chokes: [], tiles, gaps, region };
}
