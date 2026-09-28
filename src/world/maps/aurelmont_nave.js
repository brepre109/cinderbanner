// "Aurelmont Cathedral" -- a 20x22 cathedral nave at the Crowning, the Chapter II finale (story node c8, The Hollow
// Crown: "Chancellor Maule rings the Great Bell over the Crowning."). Drawn as a classic interior: a diorama box in the
// dark with its roof cut away, the west and north walls standing full height (stained-glass lancets, vault ribs,
// crimson banners) and the south and east walls sectioned at the knee.
//
// THE SHAPE: the company comes in at the west doors (the south end of the grid) and climbs the church to the altar.
//   THE NAVE        4h  z13-20  pews either side of the carpet, piers down both arcades, tombs in the side aisles
//   THE ROOD SCREEN 6h  z12     a stone screen across the nave with three openings: the carpet and both aisles
//   THE CROSSING    8h  z9-11   open floor under the tower: room for the colossus to swing
//   THE CHOIR STEP 10h  z8
//   THE CHOIR      12h  z5-7    the canons' stalls either side
//   THE SANCTUARY  14h  z1-4    the organ (NW), the Great Bell's tower (NE), and the coronation dais (16h) with the
//                               throne and the old king's opened tomb: B's ground
// Every walking step is 2h (the terrace ladder climbs 12h over nine rows), so there is nothing to declare.
//
// Surface legend (cathedral skin): s marble checker, k crimson carpet, d worn limestone flags, v VOID.
import { canvas } from '../canvas.js';
import { footprint, PROP_SPEC } from '../mapformat/propspec.js';

const NAVE = 4, SCREEN = 6, CROSS = 8, STEP = 10, CHOIR = 12, SANCT = 14, DAIS = 16;
const W = 20, D = 22;

const c = canvas({ mood: 'cathedral', w: W, d: D, h: NAVE, t: 's', seed: 0xc8c8,
  id: 'aurelmont_nave', name: 'Aurelmont Cathedral', baseTier: 4, tiers: [4],
  blurb: 'The cathedral of Aurelmont at the Crowning. Up the nave, through the rood screen, under the Great Bell to the throne.',
  notes: 'An interior diorama, 12h of terraces from the west doors to the dais. The rood screen splits the nave into three ' +
    'lanes (the carpet and both aisles); the crossing is open floor for the colossus.',
});

// =====================================================================================
// 1. Terrain: the terrace ladder, the carpet, worn flags.
// =====================================================================================
c.fill(0, 0, W - 1, 4, SANCT, 's');
c.fill(8, 1, 11, 2, DAIS, 's');
c.fill(0, 5, W - 1, 7, CHOIR, 's');
c.fill(0, 8, W - 1, 8, STEP, 's');
c.fill(0, 9, W - 1, 11, CROSS, 's');
c.fill(0, 12, W - 1, 12, SCREEN, 's');
// the crimson carpet up the middle, from the west doors to the dais
c.fill(9, 1, 10, 20, null, 'k');
c.fill(7, 9, 12, 11, null, 'k'); c.fill(8, 10, 11, 10, null, 's'); c.fill(9, 10, 10, 10, null, 'k');   // the crossing's rosette
// the aisles' worn limestone
c.fill(1, 13, 3, 20, null, 'd'); c.fill(16, 13, 18, 20, null, 'd');

// Walking rows, protected before a single prop goes down.
c.protectRect(8, 3, 11, 20);                                   // the carpet, the choir and the crossing's centre
c.protectRect(6, 9, 13, 11); c.protectRect(1, 9, 3, 11); c.protectRect(16, 9, 18, 11);   // the crossing and its aisle ends
c.protectRect(1, 12, 3, 13); c.protectRect(16, 12, 18, 13);    // the aisle openings in the screen
c.protectRect(5, 3, 14, 4);                                    // the sanctuary before the dais

// =====================================================================================
// 2. Props.
// =====================================================================================
const P = (o) => {
  const p = c.prop(o);
  if (PROP_SPEC[p.type].coord !== 'edgeFree') {
    const fp = footprint(p);
    const hs = new Set(fp.map(([x, z]) => c.hAt(x, z)));
    if (hs.size > 1) throw new Error(`aurelmont_nave: ${p.type} at ${p.x},${p.z} straddles heights ${[...hs]}`);
    for (const [x, z] of fp) {
      if (!c.walkAt(x, z)) throw new Error(`aurelmont_nave: ${p.type} at ${p.x},${p.z} stands on ${c.tAt(x, z)} at ${x},${z}`);
      if (c.isProtected(x, z)) throw new Error(`aurelmont_nave: ${p.type} at ${p.x},${p.z} closes route tile ${x},${z}`);
    }
  }
  return p;
};
const at = (type, list, extra = {}) => { for (const [x, z] of list) P({ type, x: x + 0.5, z: z + 0.5, ...extra }); };
// a wall line laid as runs of equal height (a wall prop cannot straddle heights)
const wallLine = (fixed, from, to, alongX, o) => {
  const hAt = (i) => (alongX ? c.hAt(i, fixed) : c.hAt(fixed, i));
  let s = from;
  for (let i = from + 1; i <= to + 1; i++) {
    if (i <= to && hAt(i) === hAt(s)) continue;
    P({ type: 'cryptwall', x: alongX ? s : fixed, z: alongX ? fixed : s, len: i - s, dir: alongX ? 'x' : 'z', th: o.th, in: o.in, style: 'nave', door: -1 });
    s = i;
  }
};
for (let z = 1; z < D; z++) { c.put(0, z, c.hAt(1, z), null); c.put(W - 1, z, c.hAt(W - 2, z), null); }
for (let x = 0; x < W; x++) c.put(x, D - 1, c.hAt(x, D - 2), null);
wallLine(0, 0, W - 1, true, { th: 3.8, in: 1 });            // north: the east end behind the altar
wallLine(0, 1, D - 1, false, { th: 3.8, in: 1 });           // west: the clerestory side, full height
wallLine(D - 1, 1, W - 1, true, { th: 0.55, in: -1 });       // south: sectioned at the knee
wallLine(W - 1, 1, D - 2, false, { th: 0.55, in: -1 });      // east: sectioned at the knee

// --- the rood screen across the nave, three openings ---
P({ type: 'cryptwall', x: 4, z: 12, len: 4, dir: 'x', th: 1.3, in: 1, style: 'nave', door: -1 });
P({ type: 'cryptwall', x: 12, z: 12, len: 4, dir: 'x', th: 1.3, in: 1, style: 'nave', door: -1 });

// --- stairs: the screen steps, the choir step, the sanctuary step and the dais ---
for (const x of [1, 2, 3, 8, 9, 10, 11, 16, 17, 18]) P({ type: 'stairs', x, z: 12, dir: 'n' });
for (let x = 6; x <= 13; x++) P({ type: 'stairs', x, z: 8, dir: 'n' });
for (let x = 7; x <= 12; x++) P({ type: 'stairs', x, z: 4, dir: 'n' });
for (let x = 8; x <= 11; x++) P({ type: 'stairs', x, z: 2, dir: 'n' });

// --- the sanctuary: the organ, the Great Bell's tower, the throne and the old king's opened tomb ---
P({ type: 'organ', x: 1, z: 1, w: 4, d: 1, th: 3.6 });
P({ type: 'belfry', x: 15, z: 1, w: 3, d: 3, th: 5.4 });
P({ type: 'throne', x: 9.5, z: 1.5, rot: 0 });
P({ type: 'sarcophagus', x: 10.5, z: 1.5, rot: 0 });
at('candelabra', [[8, 1], [11, 1]]);
at('candelabra', [[6, 5], [13, 5]]);
at('pillar', [[5, 2], [14, 2]], { h: 2.2 });
// --- the choir stalls ---
for (const z of [5, 6, 7]) { P({ type: 'pew', x: 4.5, z: z + 0.5, rot: 1 }); P({ type: 'pew', x: 15.5, z: z + 0.5, rot: 3 }); }
at('grave', [[1, 6], [18, 6]]);
// --- the crossing: braziers at the tower piers ---
at('brazier', [[4, 9], [15, 9]]);
at('pillar', [[5, 11], [14, 11]], { h: 3.4 });
// --- the nave: the arcades, the pews, the aisle tombs ---
at('pillar', [[4, 13], [15, 13], [4, 16], [15, 16], [4, 19], [15, 19]], { h: 3.4 });
for (const z of [14, 15, 17, 18]) for (const x of [5, 6, 7, 12, 13, 14]) P({ type: 'pew', x: x + 0.5, z: z + 0.5, rot: 2 });
P({ type: 'sarcophagus', x: 2.5, z: 14.5, rot: 1 }); P({ type: 'sarcophagus', x: 17.5, z: 17.5, rot: 1 });
at('grave', [[2, 17], [17, 14], [1, 20], [18, 20]]);

// =====================================================================================
// 3. Spawns, deploy room, contract. B: Maule before the throne, the colossus in the open sanctuary below the dais.
// =====================================================================================
// R18 (review17 P2/P8, gameplay): spaced seats -- no two allies side by side or on a diagonal -- and the lines
// moved toward each other (mean walk A->B about 13 steps, first contact by round 2). Was A [[9, 19], [10, 19], [8, 20], [11, 20], [10, 20]], B [[10, 2], [9, 4], [6, 4], [13, 4], [10, 6]].
c.seat('A', [[8, 18], [10, 17], [8, 20], [12, 19], [10, 19]]);
c.seat('B', [[10, 2], [9, 4], [8, 6], [11, 4], [11, 6]]);
c.declareRegion({ kind: 'staging', rect: [8, 19, 11, 20], note: 'A: inside the west doors' });
c.declareRegion({ kind: 'staging', rect: [6, 2, 13, 4], note: 'B: the dais and the sanctuary before it' });
c.declareRoute({ rid: 'processional', tier: 4, from: 'A', to: 'B', note: 'up the carpet, through the screen, over the crossing and the choir to the dais' });

export const DEF = c.toDef();
DEF['x-'].deploy = { A: [[9, 19], [10, 19], [8, 20], [11, 20], [10, 20], [9, 20], [8, 19], [11, 19], [12, 20]] };
