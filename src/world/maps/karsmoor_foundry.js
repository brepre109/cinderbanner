// "Karsmoor Foundry" -- a 22x22 night battlefield: the Crown's Royal Bellfoundry on the mill-race.
// BOSS: Master Founder Ossian Vey rings his bell from the casting platform at the back of the works.
//
// THE BOARD, front (bottom of the diamond, high z) to back (top, low z):
//   THE RIVER QUAY  (z 17..21, 4h)  A musters inside the river gate, between the mill and the boathouse.
//   THE MILL-RACE   (z 15..16, water 0h) across the whole board, crossed twice:
//                   THE PLANK BRIDGE (x 6..7, wood decks on the water) and THE STONE BRIDGE (x 13..14, 4h).
//   THE WORKS YARD  (z 6..14, 4h flags) walled along the race. In its middle THE CASTING PIT, sunk in two
//                   2h rings to a rock floor at 0h, where the great bell mould stands; stacks, carts and
//                   crates on the flanks; and on the west THE GANTRY, a timber gallery at 8h (x 2..3).
//   THE KILN ROW    (z 0..5, 8h terraces) furnace houses and kiln stacks either side of
//   THE CASTING PLATFORM (x 8..13, z 0..5, 10h) -- 6h over the yard, reached from it by two stone flights
//                   (x 8..9 and x 12..13, treads 6h/8h) flanking the quench tank, or off the kiln terraces.
//
// THE LANES (JUMP 2, every step <= 4h):
//   yard floor  the stone bridge -> up the east side of the pit -> the east flight -> the platform.
//   west        the plank bridge -> up the west side of the pit -> the west flight.
//   gantry      the plank bridge -> the gantry stair -> the gallery at 8h -> the west kiln terrace -> the
//               platform's flank. Longer, but it is high ground all the way and overlooks the yard.
//
// Surfaces: g grass, k dark turf, d dirt/cinder, s stone flags, b plank, r bare rock, S shingle, w water,
// v void. Screen orientation at the default camera (yaw 45 deg): (0,0) is the top of the diamond, (21,21)
// the bottom, (21,0) screen-right, (0,21) screen-left.
import { canvas } from '../canvas.js';
import { catwalk, stairFlight, chasm } from '../primitives/index.js';
import { footprint, PROP_SPEC } from '../mapformat/propspec.js';

const W = 22, D = 22;
const FLOOR = 0, RIM = 2, YARD = 4, TREAD = 6, GANTRY = 8, KILN = 8, PLAT = 10;

const c = canvas({ mood: 'night', w: W, d: D, h: YARD, t: 's', seed: 0xb311, id: 'karsmoor_foundry', name: 'Karsmoor Foundry',
  author: 'hand', baseTier: 4, tiers: [4],
  blurb: 'The Royal Bellfoundry by night: a walled works yard over the mill-race, a sunken casting pit, and the Founder ringing his bell from the casting platform.',
  notes: 'JUMP 2: over the stone bridge and up the east flight (~22), over the plank bridge and up the west flight (~22), or along the timber gantry at 8h onto the kiln terrace (the high flank).' });

// =====================================================================================
// 1. The ground planes.
// =====================================================================================
c.fill(0, 17, 21, 21, YARD, 's');                        // the river quay
c.fill(0, 17, 21, 17, RIM, 'S');                         // its shingle strand
c.fill(1, 18, 3, 19, TREAD, 's');                        // the mill, on its plinth over the race
c.fill(16, 18, 20, 19, TREAD, 's');                      // the boathouse wharf
c.fill(0, 15, 21, 16, FLOOR, 'w');                       // THE MILL-RACE
c.fill(0, 14, 21, 14, RIM, 'S');                         // the yard-side strand, under the wall
c.fill(0, 6, 21, 13, YARD, 's');                         // THE WORKS YARD
c.fill(0, 0, 7, 5, KILN, 's'); c.fill(14, 0, 21, 5, KILN, 's');   // the kiln row
c.fill(0, 0, 7, 1, PLAT, 'r'); c.fill(14, 0, 21, 1, PLAT, 'r');   // and the kiln hearths behind it, 2h up
c.fill(8, 0, 13, 5, PLAT, 's');                          // THE CASTING PLATFORM

// The quench tank, under the platform's lip: the front face of the platform stands in water, so the
// only ways up from the yard are the two flights either side of it (and the kiln terraces).
c.fill(10, 6, 11, 7, RIM, 'w');
stairFlight(c, { x: 8, z: 7, dir: 'n', lowH: YARD, highH: PLAT, width: 2, rise: 2, t: 's',
  note: 'the west flight: two 2h treads off the yard onto the casting platform' });
stairFlight(c, { x: 12, z: 7, dir: 'n', lowH: YARD, highH: PLAT, width: 2, rise: 2, t: 's',
  note: 'the east flight' });

// THE CASTING PIT: two 2h rings down to a rock floor at 0h. The mould stands on the centre tile.
c.fill(8, 9, 12, 12, RIM, 'd');
c.fill(9, 10, 11, 11, FLOOR, 'r');

// THE GANTRIES: timber galleries along both side walls at 8h, off the kiln terraces, each with a stair
// down to the yard at its south end so the bridges feed them.
c.fill(2, 6, 3, 11, GANTRY, 'b'); c.fill(2, 12, 3, 12, TREAD, 'b');
c.fill(18, 6, 19, 11, GANTRY, 'b'); c.fill(18, 12, 19, 12, TREAD, 'b');

// THE STONE BRIDGE: masonry carried straight across the race at yard height.
c.fill(13, 14, 14, 17, YARD, 's');
// THE PLANK BRIDGE: wood decks on the water, a 2h step down off either strand.
catwalk(c, { from: [6, 14], to: [6, 17], w: 2, h: FLOOR, style: 'wood', choke: false,
  note: 'the plank bridge over the mill-race: the west lane' });

// =====================================================================================
// 2. Paint: cinder roads worn into the flags, slag and rock round the kilns, turf only outside the wall.
// =====================================================================================
for (let z = 8; z <= 13; z++) { c.put(13, z, null, 'd'); c.put(7, z, null, 'd'); }
c.fill(6, 13, 7, 13, null, 'd'); c.fill(13, 18, 14, 20, null, 'd'); c.fill(6, 18, 12, 20, null, 'd');
c.fill(0, 20, 3, 21, null, 'k'); c.fill(19, 20, 21, 21, null, 'k'); c.fill(0, 18, 0, 19, null, 'k');
c.fill(14, 6, 17, 7, null, 'd'); c.fill(4, 6, 6, 7, null, 'd'); c.fill(15, 11, 17, 13, null, 'd');
c.fill(0, 2, 1, 5, null, 'r'); c.fill(20, 2, 21, 5, null, 'r'); c.fill(6, 2, 7, 3, null, 'd'); c.fill(14, 2, 15, 3, null, 'd');
c.fill(0, 6, 1, 8, null, 'r'); c.fill(20, 11, 21, 13, null, 'r'); c.fill(4, 11, 5, 13, null, 'd');
c.fill(8, 12, 12, 12, null, 'r');

// Rim bites: an outline, not a border. None touch water (settle() would fill them back in).
for (const r of [[0, 13, 0, 13], [21, 0, 21, 0], [0, 21, 1, 21], [20, 21, 21, 21], [21, 7, 21, 8],
  [21, 18, 21, 18], [16, 21, 17, 21], [5, 21, 5, 21], [21, 21, 21, 21]]) chasm(c, { rect: r, kind: 'scenery' });

// =====================================================================================
// 3. Protection: the lanes, the flights, the bridges, the camps.
// =====================================================================================
c.protectRect(8, 18, 13, 20);                            // A's muster
c.protectRect(6, 17, 7, 18); c.protectRect(13, 14, 14, 18);   // the bridge heads
c.protectRect(6, 13, 7, 14); c.protectRect(7, 8, 7, 13); c.protectRect(13, 8, 13, 13);
c.protectRect(8, 6, 9, 8); c.protectRect(12, 6, 13, 8);  // the flights and their feet
c.protectRect(8, 2, 13, 4); c.protectRect(8, 5, 9, 5); c.protectRect(12, 5, 13, 5);   // the platform floor and flight heads
c.protectRect(2, 5, 3, 13); c.protectRect(4, 12, 6, 13); // the west gantry and its stair
c.protectRect(18, 5, 19, 13); c.protectRect(14, 12, 17, 13);   // the east gantry and its stair
c.protectRect(2, 3, 7, 4); c.protectRect(14, 3, 19, 4);  // the kiln terrace walks

const faults = [];
const P = (o) => {
  const p = c.prop(o);
  if (PROP_SPEC[p.type].coord !== 'edgeFree') {
    const [ax, az] = [Math.floor(p.x), Math.floor(p.z)];
    if (!c.walkAt(ax, az)) faults.push(`${p.type} at ${p.x},${p.z} stands on ${c.tAt(ax, az)}`);
  }
  const fp = footprint(p);
  if (fp.length > 1 && new Set(fp.map(([x, z]) => c.hAt(x, z))).size > 1) faults.push(`${p.type} at ${p.x},${p.z} straddles heights`);
  for (const [x, z] of fp) {
    if (!c.walkAt(x, z)) faults.push(`${p.type} at ${p.x},${p.z} stands on ${c.tAt(x, z)} at ${x},${z}`);
    else if (c.isProtected(x, z)) faults.push(`${p.type} at ${p.x},${p.z} closes route tile ${x},${z}`);
  }
  return p;
};

// =====================================================================================
// 4. Props. The six LIT lamps come first: lighting.js lights only the first six lamp props.
// =====================================================================================
for (const p of [
  { type: 'lamp', x: 10.5, z: 5.5 },                                         // the platform's lip, over the quench tank
  { type: 'lamp', x: 12.5, z: 12.5 },                                        // the pit
  { type: 'lamp', x: 5.5, z: 14.5 }, { type: 'lamp', x: 15.5, z: 14.5 },     // the two bridge heads
  { type: 'lamp', x: 14.5, z: 20.5 },                                        // the river gate
  { type: 'lamp', x: 5.5, z: 5.5 },                                          // the west kiln door
]) P(p);

for (const p of [
  // --- the casting platform: the bell frame at the back, the Founder's ground in front ---
  { type: 'tower', x: 10, z: 0, w: 2, d: 1, th: 2.6 },
  { type: 'gate', x: 10.5, z: 1.5, rot: 0, roof: 'slate' }, { type: 'gate', x: 11.5, z: 1.5, rot: 0, roof: 'slate' },   // the bell frame
  { type: 'pillar', x: 8.5, z: 0.5, h: 2.4 }, { type: 'pillar', x: 13.5, z: 0.5, h: 2.4 },
  { type: 'pillar', x: 9.5, z: 0.5, h: 1.2 }, { type: 'pillar', x: 12.5, z: 0.5, h: 1.2 },
  { type: 'crate', x: 8.5, z: 1.5 }, { type: 'barrel', x: 13.5, z: 1.5 },
  { type: 'wall', x: 8, z: 6, len: 2, dir: 'x', h: PLAT, in: -1 }, { type: 'wall', x: 12, z: 6, len: 2, dir: 'x', h: PLAT, in: -1 },
  { type: 'rail', x: 10, z: 6, len: 2, dir: 'x', h: PLAT },
  // --- the west kiln row: two kiln stacks and the founders' house on the hearth terrace ---
  { type: 'tower', x: 0, z: 0, w: 2, d: 2, th: 3.8 },
  { type: 'house', x: 2, z: 0, w: 3, d: 2, rot: 0, storeys: 2, style: 'stone', roof: 'slate', gable: 'stone', chimney: 'right' },
  { type: 'tower', x: 5, z: 0, w: 2, d: 2, th: 3.6 },
  { type: 'barrel', x: 7.5, z: 0.5 }, { type: 'crate', x: 7.5, z: 1.5 },
  { type: 'woodpile', x: 0.5, z: 3.5 }, { type: 'woodpile', x: 0.5, z: 4.5 }, { type: 'crate', x: 1.5, z: 5.5 },
  { type: 'cart', x: 6.5, z: 5.5, rot: 0 }, { type: 'barrel', x: 7.5, z: 5.5 },
  // --- the east kiln row ---
  { type: 'house', x: 14, z: 0, w: 3, d: 2, rot: 0, storeys: 2, style: 'stone', roof: 'slate', gable: 'stone', chimney: 'left' },
  { type: 'tower', x: 19, z: 0, w: 2, d: 2, th: 3.9 }, { type: 'tower', x: 17, z: 0, w: 2, d: 2, th: 3.0 },
  { type: 'woodpile', x: 21.5, z: 3.5 }, { type: 'woodpile', x: 21.5, z: 4.5 }, { type: 'crate', x: 18.5, z: 2.5 },
  { type: 'barrel', x: 19.5, z: 2.5 }, { type: 'hay', x: 16.5, z: 2.5 },
  { type: 'barrel', x: 14.5, z: 5.5 }, { type: 'crate', x: 15.5, z: 5.5 }, { type: 'lamp', x: 16.5, z: 5.5 },
  // --- the gantries: rails on the yard side, stairs at the foot ---
  { type: 'rail', x: 4, z: 6, len: 6, dir: 'z', h: GANTRY }, { type: 'rail', x: 18, z: 6, len: 6, dir: 'z', h: GANTRY },
  { type: 'rail', x: 2, z: 6, len: 6, dir: 'z', h: GANTRY }, { type: 'rail', x: 20, z: 6, len: 6, dir: 'z', h: GANTRY },
  { type: 'stairs', x: 2, z: 12, dir: 'n' }, { type: 'stairs', x: 3, z: 12, dir: 'n' },
  { type: 'stairs', x: 18, z: 12, dir: 'n' }, { type: 'stairs', x: 19, z: 12, dir: 'n' },
  { type: 'barrel', x: 0.5, z: 9.5 }, { type: 'crate', x: 1.5, z: 9.5 }, { type: 'woodpile', x: 0.5, z: 11.5 },
  { type: 'crate', x: 0.5, z: 7.5 },
  { type: 'barrel', x: 21.5, z: 6.5 }, { type: 'woodpile', x: 20.5, z: 9.5 }, { type: 'woodpile', x: 20.5, z: 10.5 },
  { type: 'barrel', x: 20.5, z: 12.5 },
  // --- the pit: the bell mould (a squat drum on the rock floor) and the posts of its hoist frame ---
  { type: 'tower', x: 10, z: 10, w: 1, d: 1, th: 1.1 },
  { type: 'pillar', x: 8.5, z: 9.5, h: 1.6 }, { type: 'pillar', x: 12.5, z: 9.5, h: 1.6 },
  { type: 'pillar', x: 8.5, z: 12.5, h: 1.6 },
  { type: 'rock_small', x: 11.5, z: 11.5 },
  // --- the yard: the west stacks ---
  { type: 'crate', x: 4.5, z: 8.5 }, { type: 'crate', x: 5.5, z: 8.5 }, { type: 'barrel', x: 4.5, z: 9.5 },
  { type: 'cart', x: 5.5, z: 10.5, rot: 1 }, { type: 'woodpile', x: 6.5, z: 7.5 },
  // --- the yard: the east store yard and its barn ---
  { type: 'house', x: 15, z: 9, w: 2, d: 2, rot: 3, storeys: 1, style: 'stone', roof: 'brown', chimney: 'right', barn: true },
  { type: 'woodpile', x: 17.5, z: 9.5 }, { type: 'woodpile', x: 17.5, z: 10.5 },
  { type: 'stall', x: 16.5, z: 6.5, rot: 2 }, { type: 'trough', x: 15.5, z: 7.5 }, { type: 'crate', x: 17.5, z: 7.5 },
  { type: 'cart', x: 14.5, z: 10.5, rot: 1 }, { type: 'barrel', x: 16.5, z: 11.5 }, { type: 'crate', x: 17.5, z: 11.5 },
  // --- the yard wall along the race, gapped at both bridges ---
  { type: 'wall', x: 0, z: 14, len: 6, dir: 'x', h: YARD, in: -1 }, { type: 'wall', x: 8, z: 14, len: 5, dir: 'x', h: YARD, in: -1 },
  { type: 'wall', x: 15, z: 14, len: 7, dir: 'x', h: YARD, in: -1 },
  { type: 'rail', x: 13, z: 14, len: 4, dir: 'z', h: YARD }, { type: 'rail', x: 15, z: 14, len: 4, dir: 'z', h: YARD },
  // --- the quay: the mill on its plinth, the boathouse on its wharf, the river gate ---
  { type: 'house', x: 1, z: 18, w: 3, d: 2, rot: 0, storeys: 2, style: 'timber', roof: 'thatch', chimney: 'left' },
  { type: 'house', x: 17, z: 18, w: 3, d: 2, rot: 0, storeys: 1, style: 'timber', roof: 'brown', barn: true },
  { type: 'gate', x: 10.5, z: 21.5, rot: 0, roof: 'slate' },
  { type: 'fence', x: 6, z: 21, len: 4, dir: 'x' }, { type: 'fence', x: 12, z: 21, len: 4, dir: 'x' },
  { type: 'crate', x: 4.5, z: 18.5 }, { type: 'barrel', x: 5.5, z: 18.5 }, { type: 'crate', x: 4.5, z: 19.5 },
  { type: 'cart', x: 15.5, z: 20.5, rot: 1 },
  { type: 'hay', x: 20.5, z: 18.5 }, { type: 'lamp', x: 7.5, z: 20.5 }, { type: 'well', x: 3.5, z: 20.5 },
  { type: 'signpost', x: 6.5, z: 20.5 },
  { type: 'bush', x: 2.5, z: 21.5 }, { type: 'bush', x: 19.5, z: 20.5 }, { type: 'pine', x: 0.5, z: 20.5 }, { type: 'pine', x: 21.5, z: 20.5 },
  { type: 'bush', x: 0.5, z: 18.5 },
]) P(p);
if (faults.length) throw new Error(`karsmoor_foundry: ${faults.length} misplaced prop(s):\n  ` + faults.join('\n  '));

// =====================================================================================
// 5. Declarations and spawns.
// =====================================================================================
c.declareRegion({ kind: 'staging', rect: [8, 18, 12, 20], note: 'A: the river quay inside the river gate' });
c.declareRegion({ kind: 'scenery', rect: [10, 6, 11, 7], note: 'the quench tank under the platform lip: a water-filled face, not a climb' });
c.declareRegion({ kind: 'perch', rect: [8, 0, 13, 5], note: 'the casting platform: 6h over the yard, two flights up' });
c.declareRegion({ kind: 'perch', rect: [2, 6, 3, 11], note: 'the timber gantry at 8h over the west yard' });
c.declareRoute({ rid: 'road_stone_bridge', tier: 4, from: 'A', to: 'B', via: [[13, 15], [13, 10], [13, 7]],
  note: 'the stone bridge, the east side of the pit, the east flight' });
c.declareRoute({ rid: 'road_plank_bridge', tier: 4, from: 'A', to: 'B', via: [],
  note: 'the plank bridge, the west side of the pit, the west flight' });

// ORDER IS SIGNIFICANT: index 0 of B is the boss seat, dead centre of the casting platform.
// R18 (review17 P2/P8, gameplay): spaced seats -- no two allies side by side or on a diagonal -- and the lines
// moved toward each other (mean walk A->B about 13 steps, first contact by round 2). Was A [[10, 19], [9, 19], [11, 19], [10, 20], [11, 20]], B [[10, 2], [9, 3], [12, 3], [11, 4], [10, 4]].
c.seat('A', [[8, 17], [6, 17], [10, 17], [8, 19], [12, 17]]);
c.seat('B', [[10, 4], [8, 6], [12, 6], [11, 8], [9, 8]]);

export const DEF = c.toDef();
