// "Twin Span" -- a 24x24 gorge-and-river battlefield. The channel at x 11..12 is a void gorge in the
// north and a live river in the south.
//
// R10 REROUTE (balance): this map used to be a tier ladder -- the only JUMP-2 crossing was the low
// ford, a 44-50 step U against a 14-step straight line, while JUMP 5 vaulted a 10h face onto the High
// Bridge in 13. Knights and casters never arrived. Now every crossing is walkable at JUMP 2 (steps <= 4h):
//   THE HIGH ROAD    A's camp -> the quarry haul road down the Old Cut's north lip (x 10, 12 -> 8h) ->
//                    a 4h stair onto the abutment -> the High Bridge (8h) -> the east mound -> B. ~15 steps.
//   THE LOWER SPAN   down the Old Cut's 2h rings -> a stepped two-wide stone span over the gorge's south
//                    end (10h -> 8h) -> the east meadow -> B. ~20-23 steps.
//   THE BLUFF STAIR  the old 6h broken lip of the west bluff is a cut tread at 8h now, so the meadow,
//                    the mill and THE LOW FORD (four plank decks) are the long southern flank.
// The 10h abutment face and the 6h bluff lip are gone (a rock now stands on the strand tile under the
// abutment); a face that saves nothing is a validate error, so tiers is [4].
//
// HONEST LIMITATION: The engine has ONE walkable layer. A `deck` prop plus the derived DECKS grant flips
// `walk` on a water tile; it does not create a second tile identity, so nobody fights UNDER a span.
//
// Screen orientation at the default camera (yaw 45 deg): (0,0) is the top of the diamond, (23,23) the
// bottom, (23,0) screen-right, (0,23) screen-left.
import { canvas } from '../canvas.js';
import { cliffFace, stairFlight, catwalk, chasm } from '../primitives/index.js';

const W = 24, D = 24;
const RIVER = 0, SHORE = 2, BANK = 4, TOWN = 6, SHOULDER = 8, UPPER = 10, RIDGE = 12, PEAK = 14;

const c = canvas({ mood: 'overcast', w: W, d: D, h: BANK, t: 'g', id: 'twin_span', name: 'Twin Span', seed: 5,
  baseTier: 4, tiers: [4],
  blurb: 'Two spans over a gorge and a ford downriver: the high road, the lower span, and the long flank.',
  notes: 'JUMP 2: the High Bridge by the quarry haul road (15), the Lower Span out of the Old Cut (~18), or the ford (the long flank).' });

// =====================================================================================
// 1. West bank -- an upland camp above the Old Cut, the river's abandoned course
// =====================================================================================
c.fill(0, 0, 10, 11, RIDGE, 'k');                          // the upland, dark turf
c.fill(0, 0, 2, 2, PEAK, 'k'); c.fill(0, 3, 0, 5, PEAK, 'r');   // wooded crown and its rock buttress
c.fill(1, 1, 7, 3, RIDGE, 's');                            // the camp's flagged yard
c.fill(3, 6, 4, 9, RIDGE, 'd');                            // the yard track down to the quarry head

// THE OLD CUT: rings of 2h terrace measured in Manhattan distance from the strand tile (9,6). That
// tile is the only one in reach of the High Bridge's west abutment, and it sits exactly 10h below it.
for (let z = 2; z <= 11; z++) for (let x = 5; x <= 10; x++) {
  const h = SHORE + 2 * (Math.abs(x - 9) + Math.abs(z - 6));
  if (h < c.hAt(x, z)) c.put(x, z, h, h <= SHORE ? 'r' : h <= BANK ? 'S' : h <= TOWN ? 'd' : 'k');
}
// The abutment: ONE tile of RIDGE, walled off from the upland by the gorge on two sides and by the
// 10h drop on the third, so the only approach from the west is the declared vault below.
c.put(10, 7, null, 'v'); c.put(10, 6, RIDGE, 's');
// R10: THE HAUL ROAD. The quarry's north lip at x 10 is a flagged road down to a landing at SHOULDER 8
// (10,5), one 4h stair from the abutment -- the base tier's way onto the High Bridge.
for (let z = 1; z <= 4; z++) c.put(10, z, null, 's'); c.put(10, 5, SHOULDER, 's');

// =====================================================================================
// 2. The channel -- void gorge in the north, live river in the south, and they never touch
// =====================================================================================
// props.md §5: a void tile orthogonally adjacent to water shows its earth face through the black cap.
// So the gorge hands over to the river through a STAGGERED pair of rock stacks: (12,11)+(12,12) belong
// to the east bank, (11,13) to the west, and the two are diagonal to each other -- scenery, not a
// third crossing. Canvas.settle() parks every void tile below the cut for us.
chasm(c, { rect: [11, 0, 12, 5], kind: 'scenery', note: 'the gorge head, running off the north rim' });
c.fill(11, 6, 12, 7, SHOULDER, 's');                       // THE HIGH BRIDGE deck
chasm(c, { rect: [11, 8, 12, 12], kind: 'scenery', note: 'the gorge under the span' });
c.put(12, 11, SHORE, 'r'); c.put(12, 12, SHORE, 'r'); c.put(11, 13, SHORE, 'r');
// R10: THE LOWER SPAN -- a second, stepped stone span over the gorge's south end, from the Old Cut's
// bottom lip (10,10..11) down to the east meadow: 12/10 -> 10 -> 8 -> 4, every step <= 4h, 2 wide.
c.put(11, 10, UPPER, 's'); c.put(11, 11, UPPER, 's'); c.put(12, 10, SHOULDER, 's'); c.put(12, 11, SHOULDER, 's');
c.put(12, 13, RIVER, 'w'); c.fill(11, 14, 12, 23, RIVER, 'w');

// =====================================================================================
// 3. The west bluff -- the 6h express -- and the far-corner stair that prices it
// =====================================================================================
c.fill(0, 12, 10, 23, BANK, 'g');                          // the river meadow
c.fill(10, 13, 10, 23, SHORE, 'S'); c.fill(9, 17, 9, 21, SHORE, 'S');   // riverside shingle
c.fill(0, 19, 4, 23, TOWN, 'g'); c.fill(0, 21, 2, 23, SHOULDER, 'k');   // the south-west knoll
c.fill(5, 15, 6, 16, SHORE, 'w');                          // the mill pond, banked 2h all round
c.fill(0, 14, 2, 16, TOWN, 'g'); c.fill(5, 18, 8, 20, TOWN, 'g');       // two 2h swells in the meadow
c.fill(1, 16, 2, 16, null, 'k'); c.fill(5, 21, 8, 23, null, 'k');       // rough pasture off the road

// UPPER over BANK for six tiles with ONE break: cliffFace voids every foot outside the break, so the
// bluff is a 6h face at exactly one tile instead of six (the wall-of-expresses bug).
cliffFace(c, { x: 5, z: 11, len: 6, axis: 'x', base: BANK, top: UPPER, side: 1, breaks: [], parapet: false,
  t: 'k', footT: 'd', kind: 'express',
  note: 'the west bluff: 10h turf over the 4h meadow, sheer but for the Bluff Stair' });
// R10: THE BLUFF STAIR. The old broken lip (a 6h vault) is now a cut tread at SHOULDER 8, two wide,
// so the base tier comes off the upland here instead of only at the far-west Mill Stair.
c.put(8, 12, SHOULDER, 'd'); c.put(9, 12, SHOULDER, 'd');
// The base tier's only way down this bank, parked in the far corner on purpose: every step a JUMP-2
// unit spends walking west to it and back east again is what the broken lip above is worth.
stairFlight(c, { x: 1, z: 11, dir: 'n', lowH: BANK, highH: RIDGE, width: 2,
  note: 'the Mill Stair: two treads carry the 4h tier off the upland, at the far west corner' });
c.fill(0, 11, 0, 12, null, 'v'); c.fill(3, 11, 4, 12, null, 'v');   // fissures either side of the stair

// =====================================================================================
// 4. East bank -- a river meadow under a walled plateau
// =====================================================================================
c.fill(13, 0, 23, 23, BANK, 'g');
c.fill(13, 0, 23, 3, UPPER, 'k'); c.fill(20, 0, 23, 1, RIDGE, 'k');     // the plateau and its knoll
c.fill(14, 1, 18, 2, UPPER, 's');                          // the watch-post yard
c.fill(17, 17, 23, 23, TOWN, 'g'); c.fill(19, 19, 23, 23, SHOULDER, 'g');
c.fill(21, 21, 23, 23, UPPER, 'k');                        // the south-east downs, 2h terraces
c.fill(18, 9, 22, 12, TOWN, 'g'); c.fill(20, 10, 22, 12, SHOULDER, 'k');   // the corn shelf
c.fill(18, 13, 21, 16, null, 'k'); c.fill(14, 8, 15, 10, null, 'k');    // meadow rough
c.fill(13, 13, 13, 17, null, 'S'); c.fill(13, 20, 13, 23, null, 'S');   // the east strand
// The east abutment is a stepped mound the base tier CAN walk, so the high road has an exit. A JUMP-2
// unit that climbs it and crosses west arrives on (10,6) and is stuck there: the 10h drop into the
// Old Cut is one-way for anyone under JUMP 5, which is why the span is not a crossing for the 4h tier.
c.put(13, 5, SHOULDER, 's'); c.put(13, 7, SHOULDER, 's'); c.put(14, 6, SHOULDER, 's');
c.put(13, 6, RIDGE, 's');

// The plateau's south edge is an APRON, not a lip: TOWN 6 for one row, so the fall to the meadow is
// two 4h/2h steps and no face. The east bank's express is not here -- it never was worth anything
// once both camps came south of the rim, and a declared face that saves nothing is a decoration
// (contract.face-worthless). The plateau keeps its watch-post yard and its silhouette and stops
// pretending to gate anything.
c.fill(13, 4, 21, 4, TOWN, 'g');
chasm(c, { rect: [22, 3, 23, 4], kind: 'scenery', note: 'the quarried notch in the east rim' });

// =====================================================================================
// 5. The low ford, and the ragged outline
// =====================================================================================
catwalk(c, { from: [10, 18], to: [13, 18], w: 2, h: RIVER, style: 'wood', choke: false,
  note: 'the low ford: four plank decks on the water, the long southern flank' });

// THE ROAD, painted last so nothing overwrites it, and laid on the tiles the 4h flood actually walks
// (analysis/ladder.js routeTiles) rather than where the author imagines the road goes.
for (let z = 2; z <= 8; z++) c.put(4, z, null, 'd');
for (const [x, z] of [[3, 8], [3, 9], [2, 9], [2, 10], [2, 13]]) c.put(x, z, null, 'd');
for (let x = 2; x <= 9; x++) c.put(x, 13, null, 'd');
for (let z = 13; z <= 16; z++) c.put(9, z, null, 'd');
for (let x = 14; x <= 16; x++) c.put(x, 18, null, 'd');
for (let z = 10; z <= 18; z++) c.put(16, z, null, 'd');
for (let z = 7; z <= 10; z++) c.put(17, z, null, 'd');
for (let x = 18; x <= 20; x++) c.put(x, 7, null, 'd');
for (let z = 4; z <= 6; z++) c.put(20, z, null, 'd');
for (let x = 17; x <= 19; x++) c.put(x, 3, null, 'd');

// Bites out of the rectangle so the diorama has an outline rather than a border. None of them may
// touch water: settle() would quietly convert them back to grass and the bite would vanish.
for (const r of [[0, 0, 0, 1], [23, 0, 23, 1], [23, 9, 23, 11], [0, 17, 0, 18],
  [6, 23, 7, 23], [0, 23, 1, 23], [22, 23, 23, 23]]) chasm(c, { rect: r, kind: 'scenery' });

// =====================================================================================
// 6. Declarations -- what this map ASSERTS, for analysis/report.js to prove or refute
// =====================================================================================
c.declareRegion({ kind: 'staging', rect: [4, 1, 9, 2], note: 'the west camp on the upland, at the head of the Old Cut' });
c.declareRegion({ kind: 'staging', rect: [14, 8, 16, 9], note: 'the east farm, below the plateau and under the bridge head' });
c.declareRegion({ kind: 'road', rect: [11, 6, 12, 7], note: 'the High Bridge deck at 8h' });
c.declareRegion({ kind: 'road', rect: [11, 10, 12, 11], note: 'the Lower Span, stepped 10h -> 8h' });
c.declareRoute({ rid: 'high_road', tier: 4, from: 'A', to: 'B', via: [[10, 4], [12, 6]],
  note: 'the haul road down the quarry lip -> the abutment stair -> the High Bridge -> the east mound' });
c.declareRoute({ rid: 'lower_span', tier: 4, from: 'A', to: 'B', via: [],
  note: 'down the Old Cut terraces -> the Lower Span -> the east meadow' });

// R18 (review17 P2/P8, gameplay): spaced seats -- no two allies side by side or on a diagonal -- and the lines
// moved toward each other (mean walk A->B about 13 steps, first contact by round 2). Was A [[7, 1], [8, 1], [9, 1], [7, 2], [8, 2]], B [[14, 8], [15, 8], [14, 9], [15, 9], [16, 9]].
c.seat('A', [[7, 0], [9, 0], [10, 2], [6, 2], [8, 2]]);
c.seat('B', [[14, 8], [16, 5], [16, 9], [16, 7], [18, 7]]);

// =====================================================================================
// 7. Props
// =====================================================================================
for (const p of [
  // --- the west camp on the RIDGE-12 upland ---
  { type: 'house', x: 1, z: 1, w: 3, d: 2, rot: 2, storeys: 2, chimney: 'right', style: 'stone', roof: 'slate', gable: 'stone' },
  { type: 'house', x: 2, z: 4, w: 2, d: 2, rot: 0, storeys: 1, chimney: 'left', style: 'timber', roof: 'thatch' },
  { type: 'house', x: 6, z: 3, w: 2, d: 1, rot: 0, storeys: 1, style: 'timber', barn: true, roof: 'brown' },
  { type: 'tower', x: 0, z: 2, w: 1, d: 2, th: 3.6 },
  { type: 'well', x: 2, z: 3 }, { type: 'stall', x: 1, z: 3, rot: 2 }, { type: 'gate', x: 4, z: 4, rot: 0 },
  { type: 'cart', x: 0, z: 6, rot: 1 }, { type: 'woodpile', x: 7, z: 9 }, { type: 'trough', x: 2, z: 7 },
  { type: 'barrel', x: 7, z: 4 }, { type: 'crate', x: 7.3, z: 4.3 }, { type: 'hay', x: 6, z: 5 },
  { type: 'lamp', x: 3, z: 3 }, { type: 'lamp', x: 3, z: 7 }, { type: 'signpost', x: 0, z: 10 },
  { type: 'pine', x: 2, z: 0 }, { type: 'pine', x: 1, z: 0 }, { type: 'rock_small', x: 0, z: 4 },
  { type: 'rock_small', x: 0, z: 5 }, { type: 'oak', x: 2, z: 8 }, { type: 'oak', x: 2, z: 6 },
  { type: 'bush', x: 4, z: 6 }, { type: 'bush', x: 1, z: 8 }, { type: 'flowers', x: 4, z: 3 },
  { type: 'flowers', x: 4, z: 8 }, { type: 'fence', x: 6, z: 10, len: 2, dir: 'x' },
  // --- the Old Cut: a worked quarry stepping down to the strand ---
  { type: 'ruin', x: 0, z: 7, len: 2, dir: 'z', th: 1.3 }, { type: 'pillar', x: 8, z: 5, h: 1.5 },
  { type: 'pillar', x: 7, z: 7, h: 1.1 }, { type: 'woodpile', x: 8, z: 9 }, { type: 'cart', x: 7, z: 5, rot: 0 },
  { type: 'rock', x: 8, z: 3 }, { type: 'rock_small', x: 8, z: 8 },
  { type: 'rock', x: 9, z: 6 }, { type: 'bush', x: 6, z: 6 }, { type: 'flowers', x: 8, z: 6 },
  { type: 'flowers', x: 7, z: 8 }, { type: 'grave', x: 6, z: 9 },
  // --- the High Bridge: parapets, and the arch quads that hollow the piers out ---
  { type: 'wall', x: 11, z: 6, len: 2, dir: 'x', h: SHOULDER, in: -1 },
  { type: 'wall', x: 11, z: 8, len: 2, dir: 'x', h: SHOULDER, in: 1 },
  { type: 'arch', x: 11.5, z: 6, h: 4, r: 0.72, dir: 'z', flip: true },
  { type: 'arch', x: 12.5, z: 6, h: 4, r: 0.72, dir: 'z', flip: true },
  { type: 'arch', x: 11.5, z: 8, h: 4, r: 0.72, dir: 'z' }, { type: 'arch', x: 12.5, z: 8, h: 4, r: 0.72, dir: 'z' },
  { type: 'arch', x: 10.5, z: 7, h: 4, r: 0.6, dir: 'z' }, { type: 'arch', x: 13.5, z: 5, h: 4, r: 0.6, dir: 'z', flip: true },
  { type: 'wall', x: 10, z: 6, len: 1, dir: 'z', h: RIDGE, in: -1 },
  { type: 'wall', x: 11, z: 6, len: 1, dir: 'z', h: RIDGE, in: 1 },
  { type: 'lamp', x: 13, z: 7 },
  { type: 'stairs', x: 10, z: 5, dir: 's' }, { type: 'stairs', x: 10, z: 3, dir: 'n' }, { type: 'lamp', x: 10, z: 0 },
  // --- R10: the Lower Span's parapets and piers, and the Bluff Stair's treads ---
  { type: 'wall', x: 11, z: 10, len: 1, dir: 'x', h: UPPER, in: -1 }, { type: 'wall', x: 12, z: 10, len: 1, dir: 'x', h: SHOULDER, in: -1 },
  { type: 'wall', x: 11, z: 12, len: 1, dir: 'x', h: UPPER, in: 1 }, { type: 'wall', x: 12, z: 12, len: 1, dir: 'x', h: SHOULDER, in: 1 },
  { type: 'arch', x: 11.5, z: 10, h: 4, r: 0.6, dir: 'z', flip: true }, { type: 'arch', x: 12.5, z: 12, h: 2, r: 0.6, dir: 'z' },
  { type: 'stairs', x: 12, z: 10, dir: 'w' }, { type: 'stairs', x: 12, z: 11, dir: 'w' },
  { type: 'stairs', x: 8, z: 12, dir: 'n' }, { type: 'stairs', x: 9, z: 12, dir: 'n' },
  { type: 'wall', x: 5, z: 12, len: 3, dir: 'x', h: UPPER, in: 1 }, { type: 'wall', x: 10, z: 12, len: 1, dir: 'x', h: UPPER, in: 1 },
  // --- the Mill Stair, the mill pond and the meadow farms ---
  { type: 'house', x: 3, z: 15, w: 2, d: 2, rot: 3, storeys: 2, chimney: 'right', style: 'timber', roof: 'tile' },
  { type: 'house', x: 6, z: 19, w: 2, d: 1, rot: 0, storeys: 1, chimney: 'left', style: 'timber', barn: true, roof: 'thatch' },
  { type: 'rail', x: 5, z: 15, len: 2, dir: 'z', h: BANK }, { type: 'woodpile', x: 2, z: 15 },
  { type: 'fence', x: 2, z: 20, len: 3, dir: 'x' }, { type: 'trough', x: 7, z: 18 },
  { type: 'hay', x: 7, z: 21 }, { type: 'cart', x: 5, z: 19, rot: 3 }, { type: 'barrel', x: 6, z: 22 },
  { type: 'signpost', x: 10, z: 14 }, { type: 'lamp', x: 10, z: 16 },
  { type: 'oak', x: 2, z: 18 }, { type: 'oak', x: 1, z: 19 }, { type: 'bush', x: 9, z: 14 },
  { type: 'rock', x: 10, z: 21 }, { type: 'rock_small', x: 10, z: 14 }, { type: 'flowers', x: 9, z: 16 },
  { type: 'flowers', x: 11, z: 13 },
  // --- the south-west knoll: a burnt chapel over the ford road ---
  { type: 'ruin', x: 0, z: 21, len: 2, dir: 'z', th: 1.8 }, { type: 'ruin', x: 1, z: 21, len: 2, dir: 'x', th: 1.1 },
  { type: 'pillar', x: 2, z: 22, h: 1.4 }, { type: 'grave', x: 1, z: 22 }, { type: 'grave', x: 2, z: 23 },
  { type: 'pine', x: 0, z: 19 }, { type: 'oak', x: 3, z: 22 }, { type: 'rock', x: 0, z: 20 },
  { type: 'bush', x: 4, z: 23 }, { type: 'flowers', x: 3, z: 19 },
  // --- the east watch-post on the plateau ---
  { type: 'house', x: 13, z: 0, w: 2, d: 2, rot: 2, storeys: 2, chimney: 'left', style: 'stone', roof: 'slate' },
  { type: 'tower', x: 18, z: 1, w: 2, d: 1, th: 4.2 },
  { type: 'house', x: 21, z: 0, w: 2, d: 1, rot: 0, storeys: 1, style: 'timber', roof: 'tile' },
  { type: 'gate', x: 15, z: 3, rot: 0 }, { type: 'stall', x: 22, z: 6, rot: 1 },
  { type: 'barrel', x: 20, z: 1 }, { type: 'crate', x: 20.35, z: 1.3 }, { type: 'lamp', x: 14, z: 3 },
  { type: 'grave', x: 21, z: 1 }, { type: 'grave', x: 22, z: 1 }, { type: 'pillar', x: 22, z: 2, h: 1.2 },
  { type: 'pine', x: 23, z: 2 }, { type: 'oak', x: 23, z: 5 }, { type: 'bush', x: 19, z: 3 },
  { type: 'flowers', x: 17, z: 3 },
  // --- the east meadow: a working farm between the plateau and the downs ---
  { type: 'house', x: 18, z: 10, w: 2, d: 2, rot: 2, storeys: 1, chimney: 'right', style: 'timber', roof: 'tile' },
  { type: 'house', x: 13, z: 14, w: 2, d: 2, rot: 0, storeys: 1, style: 'timber', barn: true, roof: 'brown' },
  { type: 'fence', x: 14, z: 10, len: 2, dir: 'x' }, { type: 'cart', x: 16, z: 8, rot: 2 },
  { type: 'hay', x: 21, z: 11 }, { type: 'woodpile', x: 20, z: 10 }, { type: 'trough', x: 15, z: 13 },
  { type: 'barrel', x: 22, z: 8 }, { type: 'crate', x: 22.4, z: 8.4 }, { type: 'stall', x: 18, z: 16, rot: 0 },
  { type: 'oak', x: 21, z: 14 }, { type: 'oak', x: 22, z: 12 }, { type: 'oak', x: 20, z: 16 },
  { type: 'oak', x: 22, z: 15 }, { type: 'bush', x: 14, z: 15 }, { type: 'rock', x: 13, z: 12 },
  { type: 'rock_small', x: 14, z: 16 }, { type: 'flowers', x: 13, z: 9 }, { type: 'flowers', x: 15, z: 16 },
  // --- the south-east downs and their wayside shrine ---
  { type: 'house', x: 17, z: 18, w: 2, d: 2, rot: 3, storeys: 2, chimney: 'right', style: 'stone', roof: 'brown' },
  { type: 'ruin', x: 21, z: 21, len: 2, dir: 'x', th: 1.6 }, { type: 'pillar', x: 21, z: 22, h: 1.3 },
  { type: 'pillar', x: 19, z: 21, h: 0.9 }, { type: 'grave', x: 22, z: 22 },
  { type: 'fence', x: 14, z: 20, len: 2, dir: 'x' }, { type: 'cart', x: 15, z: 21, rot: 1 },
  { type: 'hay', x: 16, z: 22 }, { type: 'trough', x: 14, z: 22 }, { type: 'well', x: 18, z: 21 },
  { type: 'pine', x: 19, z: 20 }, { type: 'pine', x: 19, z: 23 }, { type: 'oak', x: 19, z: 18 },
  { type: 'oak', x: 17, z: 22 }, { type: 'rock', x: 23, z: 19 }, { type: 'bush', x: 19, z: 17 },
  { type: 'flowers', x: 20, z: 18 }, { type: 'flowers', x: 22, z: 16 },
  // --- second dressing pass: the empty quarters the first pass left bare ---
  { type: 'house', x: 21, z: 17, w: 2, d: 2, rot: 2, storeys: 1, chimney: 'left', style: 'timber', roof: 'thatch' },
  { type: 'fence', x: 18, z: 14, len: 2, dir: 'x' }, { type: 'woodpile', x: 22, z: 11 },
  { type: 'oak', x: 19, z: 15 }, { type: 'pine', x: 23, z: 18 },
  { type: 'bush', x: 20, z: 14 }, { type: 'bush', x: 18, z: 16 }, { type: 'flowers', x: 19, z: 16 },
  { type: 'flowers', x: 21, z: 12 }, { type: 'rock_small', x: 23, z: 15 }, { type: 'signpost', x: 17, z: 6 },
  { type: 'bush', x: 16, z: 19 }, { type: 'flowers', x: 15, z: 16 }, { type: 'rock', x: 14, z: 17 },
  // --- the east camp, dressed once it became a camp: a farmyard between the plateau apron and the
  //     corn shelf, kept to non-blocking types so the roster has room to form up in it ---
  { type: 'flowers', x: 14, z: 7 }, { type: 'flowers', x: 16, z: 7 }, { type: 'flowers', x: 15, z: 10 },
  { type: 'flowers', x: 17, z: 5 }, { type: 'flowers', x: 19, z: 6 }, { type: 'flowers', x: 13, z: 6 },
  { type: 'bush', x: 15, z: 5 }, { type: 'bush', x: 18, z: 6 }, { type: 'bush', x: 14, z: 11 },
  { type: 'tree', x: 19, z: 4 }, { type: 'tree', x: 16, z: 5 }, { type: 'tree', x: 13, z: 10 },
  { type: 'rail', x: 15, z: 4, len: 5, dir: 'x', h: 6 },              // the apron kerb under the plateau
  // --- the west meadow swells, the mill leat and the ford apron ---
  { type: 'oak', x: 0, z: 13 }, { type: 'bush', x: 0, z: 16 }, { type: 'rock', x: 0, z: 15 },
  { type: 'flowers', x: 3, z: 17 }, { type: 'flowers', x: 6, z: 18 }, { type: 'bush', x: 8, z: 21 },
  { type: 'rock_small', x: 9, z: 22 }, { type: 'barrel', x: 7, z: 15 }, { type: 'crate', x: 7.35, z: 15.4 },
  { type: 'grave', x: 1, z: 20 }, { type: 'pine', x: 5, z: 23 }, { type: 'oak', x: 7, z: 16 },
  // --- the gorge lips: rock spill so the black channel is not a bare slot ---
  { type: 'rock_small', x: 13, z: 3 }, { type: 'rock', x: 13, z: 8 },
  { type: 'rock_small', x: 12, z: 12 }, { type: 'bush', x: 10, z: 2 }, { type: 'bush', x: 13, z: 9 },
]) c.prop(p);

export const DEF = c.toDef();
