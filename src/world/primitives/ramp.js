// ramp — the BASE-TIER climb. The one primitive whose whole contract is that everybody can use it.
//
// Heights are quantised to `step` rather than linearly interpolated because the terrace vocabulary
// is stated in even h (2h risers, 4h statements) and a linear ramp over an odd run emits fractional
// heights: terrain.js renders them fine, but they break `shape.height-parity`, the "terraces step by
// 2h" reading, and — because rules.js tests |dh| against an integer budget — they move a step across
// a tier boundary for no visible reason. Quantising also makes the failure loud: if the quantised
// profile ever puts two consecutive treads more than baseTier apart, the ramp is not a ramp and we
// throw here rather than shipping a climb the majority roster cannot take.
const AX = (a) => (a === 'x' ? [1, 0] : [0, 1]);

/**
 * @param {import('../canvas.js').Canvas} c
 * @param {{from:[number,number], to:[number,number], width?:number, step?:number, t?:string,
 *          fromH?:number, toH?:number, note?:string}} o
 *   from/to  the two ENDS of the run, inclusive; the dominant axis picks the run direction.
 *   width    tiles across the run, laid on the +perpendicular side of the from->to line.
 *   step     the riser quantum in h (default 2 — the terrace unit, not the tier).
 * @returns {{entry:[number,number], exit:[number,number], faces:[], chokes:[],
 *            tiles:Array<[number,number]>, region:object, profile:number[]}}
 */
export function ramp(c, o) {
  const [x0, z0] = o.from, [x1, z1] = o.to, width = o.width ?? 2, step = o.step ?? 2, t = o.t ?? 'd';
  const axis = Math.abs(x1 - x0) >= Math.abs(z1 - z0) ? 'x' : 'z';
  const [ax, az] = AX(axis), [px, pz] = AX(axis === 'x' ? 'z' : 'x');
  const n = Math.abs(axis === 'x' ? x1 - x0 : z1 - z0) + 1;
  const sgn = (axis === 'x' ? x1 - x0 : z1 - z0) < 0 ? -1 : 1;
  const h0 = o.fromH ?? c.hAt(x0, z0), h1 = o.toH ?? c.hAt(x1, z1);
  if (h0 == null || h1 == null) throw new Error('ramp: from/to are off the board');

  const profile = [], tiles = [];
  for (let i = 0; i < n; i++) {
    // Round to the quantum, then pin the ends: an unpinned last tread lands short of the landing it
    // is supposed to meet, and the caller's own terrain then steps the difference.
    const raw = h0 + ((h1 - h0) * i) / Math.max(1, n - 1);
    const h = i === 0 ? h0 : i === n - 1 ? h1 : Math.round(raw / step) * step;
    profile.push(h);
    for (let k = 0; k < width; k++) {
      const x = x0 + ax * sgn * i + px * k, z = z0 + az * sgn * i + pz * k;
      c.put(x, z, h, t); tiles.push([x, z]);
    }
  }
  for (let i = 1; i < profile.length; i++) {
    const d = Math.abs(profile[i] - profile[i - 1]);
    if (d > c.baseTier) throw new Error(`ramp: tread ${i} steps ${d}h, above baseTier ${c.baseTier}h — ` +
      `${n} tiles cannot carry ${Math.abs(h1 - h0)}h at step ${step}; lengthen the run or lower the climb`);
  }
  const rx = [x0, x0 + ax * sgn * (n - 1) + px * (width - 1)], rz = [z0, z0 + az * sgn * (n - 1) + pz * (width - 1)];
  const region = c.declareRegion({ kind: 'road', rect: [Math.min(...rx), Math.min(...rz), Math.max(...rx), Math.max(...rz)],
    note: o.note || `base-tier ramp ${h0}h -> ${h1}h over ${n} tiles` });
  return { entry: [x0, z0], exit: [x1, z1], faces: [], chokes: [], tiles, region, profile };
}
