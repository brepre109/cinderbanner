// Mirror / quad symmetry, applied INSIDE the transaction (PLAN §6.7). The fan-out is not a
// post-process that copies half a map onto the other half: it is two functions handed to
// Session.begin(), so `tx.setH(x,z,v)` writes one, two or four cells and the whole mirrored edit is
// ONE patch and therefore ONE undo entry. A mirrored edit that undoes in pieces is worse than no
// symmetry at all — you would fix half a map and be unable to get back.
//
// Symmetry composes with the selection mask for free: the Tx clips each fanned-out cell against the
// mask independently, so mirroring into an unselected quadrant simply writes nothing there.
//
// Zero three.js and zero DOM. The prop fan-out routes through propspec.transformProp, so a mirrored
// house keeps its chimney on the correct side of the ridge and a mirrored wall keeps its body on
// the correct side of its line.
import { transformProp } from '../world/mapformat/propspec.js';

export const MODES = Object.freeze(['none', 'mirrorX', 'mirrorZ', 'quad', 'diagonal']);
export const LABELS = Object.freeze({ none: 'Off', mirrorX: 'Mirror X', mirrorZ: 'Mirror Z',
  quad: 'Quad', diagonal: 'Diagonal' });
// The ops each mode applies to the ORIGINAL cell, in addition to writing it. Composed left to right.
const OPS = Object.freeze({ none: [], mirrorX: [['mirrorX']], mirrorZ: [['mirrorZ']],
  quad: [['mirrorX'], ['mirrorZ'], ['mirrorX', 'mirrorZ']], diagonal: [['transpose']] });

/** A transpose maps (x,z) -> (z,x), which only lands back on the board when it is square. */
export function supports(mode, w, d) { return mode !== 'diagonal' || w === d; }

const pt = (op, x, z, w, d) => (op === 'mirrorX' ? [w - 1 - x, z] : op === 'mirrorZ' ? [x, d - 1 - z] : [z, x]);

/**
 * Every tile one edit at (x,z) should touch, the original first and duplicates removed — the centre
 * column of a mirror-X board maps to itself, and writing it twice would record its own new value as
 * the "old" one on the second touch and break undo.
 * @returns {Array<[number,number]>}
 */
export function mirrorPoints(mode, x, z, w, d) {
  const out = [[x, z]], seen = new Set([x + ',' + z]);
  if (!supports(mode, w, d)) return out;
  for (const chain of OPS[mode] || []) {
    let px = x, pz = z;
    for (const op of chain) [px, pz] = pt(op, px, pz, w, d);
    const k = px + ',' + pz;
    if (px >= 0 && pz >= 0 && px < w && pz < d && !seen.has(k)) { seen.add(k); out.push([px, pz]); }
  }
  return out;
}

/** The `fanOut` callback Session.begin() takes. Returns null for 'none' so the Tx keeps its fast path. */
export function makeFanOut(mode, w, d) {
  if (mode === 'none' || !OPS[mode] || !supports(mode, w, d)) return null;
  return (x, z) => mirrorPoints(mode, x, z, w, d);
}

/**
 * The `fanProp` callback. A mirrored prop is not a translated prop: transformProp re-derives the NW
 * corner from the far edge, swaps w/d on a transpose, advances rot, flips a wall's `in` side and
 * moves a chimney across the ridge. Duplicates are dropped by position AND type, so a prop sitting
 * on a symmetry axis is placed once.
 */
export function makeFanProp(mode, w, d) {
  if (mode === 'none' || !OPS[mode] || !supports(mode, w, d)) return null;
  return (p) => {
    const out = [p], seen = new Set([key(p)]);
    for (const chain of OPS[mode]) {
      let q = p, cw = w, cd = d;
      for (const op of chain) { q = transformProp(q, op, cw, cd); if (op === 'transpose') { const t = cw; cw = cd; cd = t; } }
      const k = key(q);
      if (!seen.has(k)) { seen.add(k); out.push(q); }
    }
    return out;
  };
}
const key = (p) => `${p.type}@${p.x},${p.z}`;

/**
 * Open a transaction with symmetry (and optionally a selection mask) already installed. The form
 * every symmetry-aware tool should use, because it is the only one that cannot forget to pass both.
 * @param {import('./session.js').Session} session
 * @param {string} label
 * @param {{mode?:string, mask?:Uint8Array, strokeId?:string|number, props?:boolean}} [opts]
 *        props — fan props out too. Default true; a tool that places one prop deliberately (a spawn
 *                marker, a unique landmark) passes false and keeps the cell mirroring.
 */
export function beginSymmetric(session, label, opts = {}) {
  const mode = opts.mode || 'none', w = session.w, d = session.d;
  return session.begin(label, { strokeId: opts.strokeId, mask: opts.mask,
    fanOut: makeFanOut(mode, w, d), fanProp: opts.props === false ? null : makeFanProp(mode, w, d) });
}

/** Fan a whole tile list out — for the overlay that shows an author where a stroke will land. */
export function fanOutTiles(mode, tiles, w, d) {
  const out = [], seen = new Set();
  for (const [x, z] of tiles) for (const [px, pz] of mirrorPoints(mode, x, z, w, d)) {
    const k = px + ',' + pz;
    if (!seen.has(k)) { seen.add(k); out.push([px, pz]); }
  }
  return out;
}
