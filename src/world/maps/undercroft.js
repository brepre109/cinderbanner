// "The Undercroft" -- a 20x20 vaulted crypt under Aurelmont, drawn the way the genre drew its interiors: a diorama box
// in a black void with the ceiling cut away, the two walls at the back of the default view standing full height
// (ossuary niches, pilasters, vault ribs springing into the room) and the two nearest the lens sectioned off at the
// knee. Story node c7: "Under the capital, the flooded crypts run to the cathedral stair." The gate-beast is chained
// on the landing before the cathedral door.
//
// THE SHAPE (A enters from the charnel stair in the south, B holds the landing in the north):
//   THE CHARNEL GALLERY  6h  x6-13 z16-18  where the company comes down from the city
//   THE CRYPT FLOOR      4h  z8-18          two rows of piers, tombs in the aisles; the west chantry (6-8h) holds the
//                                           founder's tomb, the east aisle is a flooded pit
//   THE FLOODED BAND     0h  z5-7           black water either side of three stairs that climb out of it:
//                                           the Great Stair x8-11 up the middle, the ossuary stairs x1-3 and x16-18
//   THE LANDING         10h  z1-4           before the cathedral portal: B's ground, the beast in the middle
// Every walking step is 2h, so nothing needs declaring; the heights are walls of black water, not cliffs.
//
// Surface legend (crypt skin): s crypt flagstone, k moss-slick stone, d grave earth, w black water, v VOID.
import { canvas } from '../canvas.js';
import { footprint, PROP_SPEC } from '../mapformat/propspec.js';

const POOL = 2, FLOOR = 4, RAISE = 6, TOMB = 8, LAND = 10;
const W = 20, D = 20;

const c = canvas({ mood: 'crypt', w: W, d: D, h: FLOOR, t: 's', seed: 0xc7c7,
  id: 'undercroft', name: 'The Undercroft', baseTier: 4, tiers: [4],
  blurb: 'The flooded crypts under Aurelmont. Three stairs climb out of black water to the cathedral door.',
  notes: 'An interior diorama: tall back walls (north, west), knee-high sectioned front walls (south, east). Three lanes ' +
    'to the landing: the Great Stair up the middle and the two ossuary stairs at the walls, each rising 2h a row out of the water.',
});

// =====================================================================================
// 1. Terrain.
// =====================================================================================
c.fill(0, 0, 19, 4, LAND, 's');                        // the landing (and the north wall's row)
c.fill(0, 5, 19, 7, POOL, 'w');                        // the flooded band
for (const [x0, x1] of [[0, 3], [8, 11], [16, 19]]) {  // three stairs out of it, 2h a row
  c.fill(x0, 7, x1, 7, RAISE, 's'); c.fill(x0, 6, x1, 6, TOMB, 's'); c.fill(x0, 5, x1, 5, LAND, 's');
}
c.fill(1, 10, 3, 12, RAISE, 's'); c.fill(1, 11, 2, 11, TOMB, 's');   // the west chantry and the founder's tomb
c.fill(15, 10, 17, 12, POOL, 'w');                     // the flooded east pit
c.fill(6, 16, 13, 19, RAISE, 's');                     // the charnel gallery (and its bit of the south wall)
// grave earth where the floor has been dug for burials, moss where the water seeps
for (const [x, z] of [[4, 14], [5, 14], [4, 15], [15, 16], [16, 16], [16, 15], [3, 17], [14, 9], [14, 13], [5, 9]]) c.put(x, z, null, 'd');
for (const [x, z] of [[4, 8], [7, 8], [12, 8], [15, 8], [14, 10], [14, 12], [18, 9], [1, 8], [18, 13], [8, 9], [11, 9]]) c.put(x, z, null, 'k');

// Walking rows, protected before a single prop goes down.
c.protectRect(8, 1, 11, 15);            // the Great Stair and the nave
c.protectRect(1, 5, 3, 9); c.protectRect(16, 5, 18, 9);   // the ossuary stairs and their feet
c.protectRect(4, 2, 15, 4);             // the landing's front
c.protectRect(7, 14, 12, 15);           // the gallery foot

// =====================================================================================
// 2. Props.
// =====================================================================================
const P = (o) => {
  const p = c.prop(o);
  if (PROP_SPEC[p.type].coord !== 'edgeFree') {
    const fp = footprint(p);
    const hs = new Set(fp.map(([x, z]) => c.hAt(x, z)));
    if (hs.size > 1) throw new Error(`undercroft: ${p.type} at ${p.x},${p.z} straddles heights ${[...hs]}`);
    for (const [x, z] of fp) {
      if (!c.walkAt(x, z)) throw new Error(`undercroft: ${p.type} at ${p.x},${p.z} stands on ${c.tAt(x, z)} at ${x},${z}`);
      if (c.isProtected(x, z)) throw new Error(`undercroft: ${p.type} at ${p.x},${p.z} closes route tile ${x},${z}`);
    }
  }
  return p;
};
const at = (type, list, extra = {}) => { for (const [x, z] of list) P({ type, x: x + 0.5, z: z + 0.5, ...extra }); };

// --- the walls. A wall prop cannot straddle heights, so each wall line is laid as runs of equal height; the wall
//     tiles take the height of the room tile beside them, so the wall stands on the floor it bounds. ---
const wallLine = (fixed, from, to, alongX, o) => {
  const hAt = (i) => (alongX ? c.hAt(i, fixed) : c.hAt(fixed, i));
  let s = from;
  for (let i = from + 1; i <= to + 1; i++) {
    if (i <= to && hAt(i) === hAt(s)) continue;
    const len = i - s, door = o.doorAt != null && o.doorAt >= s && o.doorAt <= i ? o.doorAt - s : -1;
    P({ type: 'cryptwall', x: alongX ? s : fixed, z: alongX ? fixed : s, len, dir: alongX ? 'x' : 'z', th: o.th, in: o.in, style: 'crypt', door });
    s = i;
  }
};
// wall tiles take their neighbour's height (the water band's wall tiles are dry, at the stair beside them)
for (let z = 1; z < D; z++) { c.put(0, z, c.hAt(1, z), 's'); c.put(W - 1, z, c.hAt(W - 2, z), 's'); }
for (let x = 0; x < W; x++) c.put(x, D - 1, c.hAt(x, D - 2), 's');
wallLine(0, 0, W - 1, true, { th: 3.4, in: 1, doorAt: 10 });           // north: the cathedral wall and its portal
wallLine(0, 1, D - 1, false, { th: 3.4, in: 1 });                      // west: full height
wallLine(D - 1, 1, W - 1, true, { th: 0.55, in: -1 });                  // south: sectioned at the knee
wallLine(W - 1, 1, D - 2, false, { th: 0.55, in: -1 });                 // east: sectioned at the knee

// --- stairs: every tread of the three flights, the gallery step and the chantry steps ---
for (const [x0, x1] of [[1, 3], [8, 11], [16, 18]]) for (let x = x0; x <= x1; x++) for (const z of [7, 6, 5]) P({ type: 'stairs', x, z, dir: 'n' });
for (let x = 7; x <= 12; x++) P({ type: 'stairs', x, z: 16, dir: 's' });
for (const z of [10, 11, 12]) P({ type: 'stairs', x: 3, z, dir: 'w' });

// --- the landing: the portal's guardian piers, braziers, the Choir's chains and offerings ---
at('pillar', [[7, 1], [12, 1]], { h: 2.3 });
at('brazier', [[5, 1], [14, 1]]);
at('candelabra', [[3, 1], [16, 1]]);
at('grave', [[1, 2], [18, 2]]); at('barrel', [[1, 4]]); at('crate', [[18, 4]]); at('rock_small', [[3, 4], [16, 4]]);
// --- the crypt floor: two rows of piers down the nave, tombs in the aisles ---
at('pillar', [[6, 9], [6, 12], [13, 9], [13, 12]], { h: 2.9 });
at('pillar', [[6, 15], [13, 15]], { h: 1.6 });
at('brazier', [[7, 8], [12, 8]]);
P({ type: 'sarcophagus', x: 4.5, z: 10.5, rot: 1 }); P({ type: 'sarcophagus', x: 4.5, z: 13.5, rot: 1 });
P({ type: 'sarcophagus', x: 15.5, z: 14.5, rot: 1 }); P({ type: 'sarcophagus', x: 17.5, z: 15.5, rot: 1 });
P({ type: 'sarcophagus', x: 1.5, z: 11.5, rot: 1 });                         // the founder, on the chantry
at('candelabra', [[1, 10], [1, 12]]);
at('grave', [[5, 16], [1, 15], [17, 17], [2, 17]]);
at('ruin', [[1, 13]], { len: 1, dir: 'z', th: 0.9 }); P({ type: 'ruin', x: 18, z: 11, len: 1, dir: 'z', th: 1.1 });
at('rock_small', [[14, 16], [5, 17], [16, 13], [3, 14]]); at('rock', [[18, 16]]);
at('barrel', [[15, 17]]); at('crate', [[14, 18]]);
// --- the gallery: the charnel stair's foot, bones stacked by the wall ---
at('grave', [[6, 18], [13, 18]]); at('rock_small', [[12, 18]]);

// =====================================================================================
// 3. Spawns, deploy room, contract. B's seat 0 (the gate-beast) is in the middle of the landing, open all round.
// =====================================================================================
// R18 (review17 P2/P8, gameplay): spaced seats -- no two allies side by side or on a diagonal -- and the lines
// moved toward each other (mean walk A->B about 13 steps, first contact by round 2). Was A [[9, 17], [10, 17], [8, 16], [11, 16], [10, 18]], B [[10, 2], [8, 3], [12, 3], [6, 2], [14, 2]].
c.seat('A', [[10, 15], [12, 16], [8, 15], [12, 14], [10, 17]]);
c.seat('B', [[10, 2], [10, 4], [12, 4], [8, 2], [12, 2]]);
c.declareRegion({ kind: 'staging', rect: [7, 16, 12, 18], note: 'A: the charnel gallery' });
c.declareRegion({ kind: 'staging', rect: [6, 1, 14, 4], note: 'B: the landing before the cathedral portal' });
c.declareRoute({ rid: 'great-stair', tier: 4, from: 'A', to: 'B', note: 'the Great Stair out of the water (the ossuary stairs at the walls are the 24-step flanks)' });
for (const r of [[4, 5, 7, 7], [12, 5, 15, 7], [15, 10, 17, 12]]) c.declareRegion({ kind: 'scenery', rect: r, note: 'black water: the flooded crypt, a drop not a bank' });

export const DEF = c.toDef();
DEF['x-'].deploy = { A: [[9, 17], [10, 17], [8, 16], [11, 16], [10, 18], [9, 16], [10, 16], [8, 17], [11, 17]] };
