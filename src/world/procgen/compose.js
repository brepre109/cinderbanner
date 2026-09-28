// compose.js — the scenery as ARCHITECTURE rather than as a noise field (PLAN §5.1 stage 10).
//
// decorate.js has to close every scenery tile: a tile left open is a hole in the tier proof, not a
// cosmetic slip. Closing them one at a time with an independently drawn prop is correct and it looks
// exactly like what it is — a pine beside a boulder beside a gravestone beside a woodpile, at even
// spacing, over the whole surface. The gate's words for it were "50 identical ruin blocks sprinkled
// as even confetti", and the diagnosis is right: the vocabulary was never the problem, the DRAW was.
// Every choice was independent, so nothing agreed with its neighbour and no shape ever emerged.
//
// So every choice here is made per PATCH and not per tile. A coarse lattice fixes, for each block of
// ground, one material, one wall orientation and one wall height; the closer then sweeps ALONG that
// orientation, so a patch resolves into a stand of pines, or a boulder field, or a run of wall
// heading north rather than the same east-west stub repeated for six rows. compounds() goes further
// and spends a patch on a walled yard with a building in it, which is the only thing on the board
// that produces an enclosure — a room, a gateway and an inside.
//
// Nothing here can move a graph edge: it only ever chooses WHICH blocking prop closes a tile that
// skeleton.js already marked unwalkable, and every multi-tile run is put through the caller's
// safeFree union-find first. Zero three.js.
import { PROP_SPEC } from '../mapformat/propspec.js';
import { ri, rf, chance, weighted, pick } from './rng.js';
import { idx } from './skeleton.js';

const CELL = 5;              // patch size; ~one stand of trees or one wall run at this board scale
const RUN_MAX = 7;           // a longer ruin or fence reads as a ruled line, not as a wall
const CENTRE = (v) => Math.floor(v) + 0.5;

/**
 * The coarse lattice. One draw per patch, reused by every tile inside it, which is the entire
 * mechanism: `wall` patches resolve into long oriented runs at a shared height, `ground` patches into
 * a single repeated material. `th` is drawn once per patch too — jittering the intact height of every
 * ruin independently is what turned a wall into a row of broken teeth.
 * @returns {{cell:number, at:(x:number,z:number)=>object}}
 */
export function lattice(c, rng, V) {
  const gw = Math.ceil(c.w / CELL) + 1, gh = Math.ceil(c.d / CELL) + 1, P = [];
  for (let n = 0; n < gw * gh; n++) {
    const runType = weighted(rng, V.props.runs);
    P.push({
      single: weighted(rng, V.props.singles) || 'rock',
      run: runType === 'fence' ? 'fence' : 'ruin',
      dir: chance(rng, 0.42) ? 'z' : 'x',
      th: Math.round(rf(rng, 0.7, 1.8) * 10) / 10,
      // A wall patch keeps its long runs; a ground patch is loose material. The archetype's runShare
      // now decides how much of the BOARD is built rather than how often a chunk happens to be long.
      wall: chance(rng, V.props.runShare),
    });
  }
  return { cell: CELL, at: (x, z) => P[Math.floor(z / CELL) * gw + Math.floor(x / CELL)] };
}

/**
 * Walled yards. A rectangle of level scenery is outlined with four runs and given a building and a
 * gateway, which is the one structure on the board with an inside — the gate's "no rooms, no
 * enclosure, no focal point" in one pass. The outline runs ARE the closing props for their tiles, so
 * a compound costs nothing extra; it just spends the props the closer would have spent anyway on a
 * shape instead of on gravel.
 * @param {{free:Function, place:Function, safeFree:Function, span:Function}} tk decorate.js's toolkit
 */
export function compounds(c, rng, V, tk, L) {
  const want = Math.max(1, Math.round((c.w * c.d) / 300));
  for (let made = 0, tries = 0; made < want && tries < want * 60; tries++) {
    const bw = ri(rng, 5, 7), bd = ri(rng, 4, 5);
    const x0 = ri(rng, 1, c.w - bw - 1), z0 = ri(rng, 1, c.d - bd - 1);
    const tiles = []; let h0 = null, ok = true;
    for (let z = z0; z < z0 + bd && ok; z++) for (let x = x0; x < x0 + bw && ok; x++) {
      const i = idx(c, x, z);
      if (!tk.free(i)) { ok = false; break; }
      if (h0 === null) h0 = c.H[i]; else if (c.H[i] !== h0) ok = false;
      tiles.push(i);
    }
    if (!ok || !tk.safeFree(tiles)) continue;
    const P = L.at(x0, z0), kind = P.run;
    // One side loses its middle tile to a gateway: the run stops short, a single blocker closes the
    // gap tile so the wall is still sealed, and a walk-through `gate` frames it. gate has no
    // footprint, so it can stand on the closed tile without a prop.footprint-overlap finding.
    const gx = x0 + (bw >> 1);
    tk.place({ type: kind, x: x0, z: z0, len: bw, dir: 'x', ...(kind === 'ruin' ? { th: P.th } : {}) });
    tk.place({ type: kind, x: x0, z: z0 + bd - 1, len: gx - x0, dir: 'x', ...(kind === 'ruin' ? { th: P.th } : {}) });
    tk.place({ type: kind, x: gx + 1, z: z0 + bd - 1, len: x0 + bw - gx - 1, dir: 'x', ...(kind === 'ruin' ? { th: P.th } : {}) });
    tk.place({ type: 'woodpile', x: CENTRE(gx), z: CENTRE(z0 + bd - 1) });
    tk.place({ type: 'gate', x: CENTRE(gx), z: CENTRE(z0 + bd - 1), rot: 0, roof: pick(rng, ['tile', 'slate', 'brown']) });
    for (const x of [x0, x0 + bw - 1]) tk.place({ type: kind, x, z: z0 + 1, len: bd - 2, dir: 'z', ...(kind === 'ruin' ? { th: P.th } : {}) });
    yardFill(c, rng, V, tk, L, x0 + 1, z0 + 1, x0 + bw - 2, z0 + bd - 2, h0);
    made++;
  }
}

/** Inside the yard: a house or tower against the back wall, then the rest closed with the patch's
 *  own material so the court reads as one place. */
function yardFill(c, rng, V, tk, L, x0, z0, x1, z1, h0) {
  const bw = Math.min(3, x1 - x0 + 1), bd = Math.min(2, z1 - z0 + 1);
  if (bw >= 2 && bd >= 2) {
    const hx = ri(rng, x0, x1 - bw + 1), tiles = [];
    for (let z = z0; z < z0 + bd; z++) for (let x = hx; x < hx + bw; x++) tiles.push(idx(c, x, z));
    if (tiles.every((i) => tk.free(i) && c.H[i] === h0) && tk.safeFree(tiles)) {
      if (chance(rng, 0.35)) tk.place({ type: 'tower', x: hx, z: z0, w: Math.min(2, bw), d: Math.min(2, bd), th: Math.round(rf(rng, 3.4, 5.2) * 10) / 10 });
      else tk.place({ type: 'house', x: hx, z: z0, w: bw, d: bd, rot: ri(rng, 0, 3), storeys: chance(rng, 0.45) ? 2 : 1,
        style: pick(rng, ['timber', 'stone']), roof: pick(rng, ['tile', 'slate', 'brown', 'thatch']),
        chimney: pick(rng, [null, 'left', 'right']), barn: chance(rng, 0.3) });
    }
  }
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { const i = idx(c, x, z); if (tk.free(i)) single(c, rng, V, tk, L, x, z); }
}

/**
 * The general closer. Two sweeps, one per orientation, each serving only the patches that asked for
 * it, then a mop-up so the coverage assertion in decorate.js still holds. Runs stop at a patch
 * boundary as well as at a height change, which is what keeps a wall the length of one building
 * rather than the length of the board.
 */
export function closeByPatch(c, rng, V, tk, L) {
  for (const dir of ['z', 'x']) {
    const outerN = dir === 'x' ? c.d : c.w, innerN = dir === 'x' ? c.w : c.d;
    for (let a = 0; a < outerN; a++) {
      let b = 0;
      while (b < innerN) {
        const x = dir === 'x' ? b : a, z = dir === 'x' ? a : b, i = idx(c, x, z), P = L.at(x, z);
        if (!tk.free(i) || P.dir !== dir || !P.wall) { b++; continue; }
        let len = 1;
        while (len < RUN_MAX && b + len < innerN) {
          const nx = dir === 'x' ? b + len : a, nz = dir === 'x' ? a : b + len, j = idx(c, nx, nz);
          if (!tk.free(j) || c.H[j] !== c.H[i] || L.at(nx, nz) !== P) break;
          len++;
        }
        while (len > 1 && !tk.safeFree(tk.span(x, z, len, dir))) len = len >> 1;
        if (len > 1) tk.place({ type: P.run, x, z, len, dir, ...(P.run === 'ruin' ? { th: P.th } : {}) });
        else single(c, rng, V, tk, L, x, z);
        b += len;
      }
    }
  }
  for (let z = 0; z < c.d; z++) for (let x = 0; x < c.w; x++) if (tk.free(idx(c, x, z))) single(c, rng, V, tk, L, x, z);
}

/** One loose blocker, usually of the PATCH's material. Two adjacent tiles now agree, which is the
 *  whole difference between a stand of pines and a scatter of everything — but a stand of pines with
 *  NOTHING else in it is its own kind of tell, so a quarter of the draws still come from the
 *  archetype's full table and salt the patch with boulders. */
function single(c, rng, V, tk, L, x, z) {
  const t = (chance(rng, 0.25) ? weighted(rng, V.props.singles) : null) || L.at(x, z).single;
  tk.place({ type: t, x: CENTRE(x), z: CENTRE(z),
    ...(PROP_SPEC[t].fields.some((fd) => fd.k === 'h') ? { h: Math.round(rf(rng, 0.6, 1.8) * 10) / 10 } : {}) });
}
