// "Saltglass Dunes" -- a 22x22 desert: a N-S rock-spire ridge splitting the caravan road from the
// dune field, a spring-fed oasis with a plank ford, and two vaults that skip the long way round.
//
// Heights are in h (1h = 0.25 world units, 4h = one tile width). Terraces step 2h; the base tier is
// 4h (JUMP 2), which 15 of the 32 classes field. JUMP MATHS (rules.js: |dh| <= jump * HEIGHT_STEP,
// HEIGHT_STEP 2): JUMP 2 clears 4h, JUMP 5 clears 10h, JUMP 7 clears 14h.
//
// RE-TIER NOTE, and the one place this file contradicts its brief. The brief says a 14h drop "needs
// jump 7, which no class has" and orders the SPIRE HOP re-tiered. That is false against the LIVE
// roster: profiles.js reads src/game/data.js and tiersFromRoster() returns [2,4,6,10,12,14,Inf],
// with t14 = {cockatrice (acrobat, jump 5+2), ninja (shinobi_stride, jump 5+2)} at climb 14. So 14h
// IS a roster tier, the SPIRE HOP stays at EXACTLY 14h, and nothing is re-tiered. Dropping it to
// 12h would only have handed the whole express to the Werewolf as well, for nothing.
//
// Surface legend: S sand, r bare rock, d dirt track, s beaten stone, k oasis turf, w water, v VOID.
//
// THE SHAPE OF THE FIGHT (R10 reroute) --------------------------------------------------------
// The first cut of this map walked the 4h tier 48-54 steps (South Gate, the whole west shore, the
// ford, back east to the Sabre cleft, west again) against a straight line of 29, and the campaign
// harness measured the result: JUMP-2 units never arrived. It now has two JUMP-2 roads of honest
// length, and B's camp stands on the dune crest between them instead of in the far north-west corner.
// The ridge (x=11, RIDGE 12) still runs the whole board with the GASH, a void fissure, at its foot.
//   NOTCH ROAD (main, 21 steps). North up the road plain, up THE WATCHMEN'S CUT -- two hewn treads,
//     6h -> 8h -> 10h, bridging the butte fissure at x 14..15 -- across the butte and west through
//     the NORTH NOTCH (11,2), down onto band N and B's camp.
//   GATE ROAD (flank, ~29 steps). South Gate (11,19..20), the gate ramp, north over THE CARAVAN
//     JETTY (a plank run across the oasis at x 8) and up the Sabre cleft (8..9,5) into B's camp.
//     The old west-shore plank ford still stands for the long flank.
// SPIRE HOP, 14h (JUMP 7: cockatrice, ninja). The crown (11,13) stands EXACTLY 14h over the dry
// hollow (12,13), and void at (11,12) and (11,14) cuts it out of the crest. The spine then runs the
// ridge's west shoulder at PEAK 14 straight to the cleft and B: 19 steps, one turn under the road.
// The old 10h SLIP FACE at (1,5) is closed (a boulder) -- with B off the north-west plateau it
// led nowhere, and a declared face that saves nothing is a decoration.
// WATER is a separate axis, not a rung: the oasis is open to terrain_walker/Float (treant,
// earthshaper) wherever it is wet, and design.tiers never mentions it, so the analyser prices the two
// independently and they are never conflated.
//
// WHY THE RIDGE IS HAND-CUT: cliffFace() writes ONE foot height along its whole run, and this scarp
// has four openings at four different heights (8h notch, 0h hollow, 6h gate). It is built by hand
// and the same job -- void everything that is not a declared opening -- is done explicitly.
import { canvas } from '../canvas.js';
import { catwalk } from '../primitives/catwalk.js';
import { chasm } from '../primitives/chasm.js';
import { ramp } from '../primitives/ramp.js';
import { stairFlight } from '../primitives/stairFlight.js';

const RIVER = 0, SHORE = 2, BANK = 4, TOWN = 6, SHOULDER = 8, UPPER = 10, RIDGE = 12, PEAK = 14;

const c = canvas({ mood: 'desert-glare', w: 22, d: 22, h: BANK, t: 'S', id: 'saltglass_dunes', name: 'Saltglass Dunes',
  baseTier: 4, tiers: [4, 14], seed: 2, author: 'hand',
  blurb: 'A rock reef splits the caravan road from the dunes. Two doors, a spire hop, two plank fords.',
  notes: '4h: up the Watchmen\'s Cut and through the North Notch (21 steps / 7 turns), or South Gate and the caravan jetty (~29). 14h hops the spire at (12,13) and rides the spine (19 / 6).' });

// =====================================================================================
// 1. The caravan road, the north butte, and the watch platform
// =====================================================================================
c.fill(13, 0, 21, 3, UPPER, 'r');                  // the north butte, a wind-cut mesa of bare rock
c.fill(15, 0, 19, 2, RIDGE, 'r');
c.fill(13, 5, 21, 11, BANK, 'S');                  // the open road plain
c.fill(13, 5, 21, 6, TOWN, 'S');                   // its northern dune shoulder
c.fill(13, 12, 21, 21, TOWN, 'S');                 // the camp shelf
c.fill(13, 12, 15, 15, BANK, 'S');                 // the hollow the spire stands over
c.fill(13, 13, 14, 14, BANK, 'd');
c.line(19, 19, 14, 18, null, 'd'); c.line(14, 18, 13, 19, null, 'd');   // camp -> South Gate
c.line(16, 12, 16, 5, null, 'd'); c.line(16, 12, 15, 13, null, 'd');    // and north up the plain
c.fill(17, 15, 20, 18, TOWN, 's');                 // the camp's beaten floor
// The fissure under the butte, crossed only at the Watchmen's Cut (section 5). Stepped, because a ruled line across
// a board reads as a mistake and a stepped one reads as ground.
chasm(c, { rect: [13, 4, 17, 4], void: true, kind: 'scenery', note: 'the fissure under the north butte' });
chasm(c, { rect: [18, 3, 21, 3], void: true, kind: 'scenery', note: 'the fissure, stepped north' });
// The watch platform over the road, and the stair that is the only way onto it: a 6h break the base
// tier crosses because the stairs prop lays a second tread on the landing (props.md 3.2).
c.fill(18, 7, 21, 11, TOWN, 'S'); c.fill(19, 8, 21, 10, UPPER, 'r');
stairFlight(c, { x: 18, z: 9, dir: 'e', lowH: BANK, highH: UPPER, width: 2, t: 's',
  note: 'the watch stair: paired treads carry the 4h tier off the road plain onto the 10h platform' });

// =====================================================================================
// 2. The ridge, the Gash, and the two doors
// =====================================================================================
c.fill(11, 0, 11, 21, RIDGE, 'r');                 // the crest
c.fill(12, 0, 12, 21, RIDGE, 'v');                 // the GASH: the east foot is not ground at all
c.put(11, 2, SHOULDER, 'r'); c.put(12, 2, SHOULDER, 'r'); c.put(13, 2, UPPER, 'r');   // NORTH NOTCH
c.put(11, 13, PEAK, 'r');                          // the crown of the spire
c.put(12, 13, RIVER, 'S');                         // the dry hollow it stands over: 14h, exactly
c.put(11, 12, null, 'v'); c.put(11, 14, null, 'v');// and the crest is cut away either side of it
c.fill(11, 19, 11, 20, SHOULDER, 'd');             // SOUTH GATE, 2 wide
c.fill(12, 19, 13, 20, TOWN, 'd');

// =====================================================================================
// 3. The dune field: four bands, three barriers
// =====================================================================================
c.fill(0, 0, 10, 4, TOWN, 'S');                    // band N -- B's ground
c.fill(0, 0, 3, 1, BANK, 'S'); c.fill(0, 0, 2, 1, BANK, 'd');
c.put(1, 4, SHOULDER, 'S');                        // the shelf the slip landing steps down onto
c.fill(0, 5, 9, 5, RIDGE, 'r');                    // the SABRE CREST (boulders in section 5)
c.fill(8, 5, 9, 5, UPPER, 'r');                    // its one cleft, 2 wide, at the reef's east end
c.fill(8, 6, 8, 7, TOWN, 'S'); c.fill(9, 6, 9, 7, UPPER, 'r');   // the shoulder it is climbed by
c.put(9, 4, TOWN, 'S');
c.fill(0, 6, 7, 6, SHORE, 'S');                    // the scoured trough below the crest
c.fill(0, 7, 7, 7, BANK, 'S');                     // band M -- the dune shelf
c.fill(0, 8, 9, 8, SHORE, 'S');
c.fill(0, 9, 9, 13, RIVER, 'w');                   // THE OASIS
c.fill(0, 14, 9, 14, SHORE, 'S');
c.fill(0, 15, 9, 21, BANK, 'S');                   // band S -- the southern apron
c.fill(0, 18, 6, 21, TOWN, 'S');
c.fill(0, 8, 3, 8, SHORE, 'k'); c.fill(0, 14, 3, 14, SHORE, 'k');   // green under the palms
// The SPINE: the ridge's own west shoulder at PEAK 14, from the crown to the reef's east shoulder.
// Walled by the oasis on one side and by boulders on the other, and a dead end eastward, because
// the crown's only other exit is the 14h drop.
c.fill(10, 5, 10, 13, PEAK, 'r');
c.put(10, 4, UPPER, 'r'); c.put(10, 3, SHOULDER, 'r'); c.put(10, 2, TOWN, 'r');
c.put(10, 1, SHOULDER, 'S'); c.put(10, 0, SHOULDER, 'S');
c.fill(10, 14, 10, 21, SHOULDER, 'r');             // south of the crown it is a shoulder again
ramp(c, { from: [7, 19], to: [10, 19], width: 2, step: 2, t: 'd',
  note: 'the gate ramp: the apron climbs 4h onto the South Gate landing' });

// =====================================================================================
// 4. The ford -- the only 4h crossing of the oasis
// =====================================================================================
const ford = catwalk(c, { from: [0, 14], to: [0, 8], h: RIVER, w: 2, style: 'wood', rail: true,
  choke: false, note: 'the plank ford' });
// R10: the caravan jetty. A second plank run across the oasis at its east end, straight from the
// gate apron to the foot of the Sabre cleft, so the south road no longer walks the whole west shore.
catwalk(c, { from: [8, 14], to: [8, 8], h: RIVER, w: 1, style: 'wood', rail: true,
  choke: false, note: 'the caravan jetty: gate apron -> Sabre cleft' });

// =====================================================================================
// 5. Boulders -- the walls this map is actually built out of
// =====================================================================================
// rules.js reads a prop-closed tile as impassable at every JUMP, so a boulder is a wall no tier
// climbs and, unlike a height step, it raises no face at all: checkSeams only prices a pair when
// BOTH tiles walk. A wind-piled boulder field along a rock reef is also what a desert does with its
// own debris, so here the mechanism and the picture are the same object.
const ROCKS = ['rock', 'rock_small'];
let nb = 0;
const boulder = (x, z) => c.prop({ type: ROCKS[nb++ % 2], x: x + 0.5, z: z + 0.5 });
for (const x of [0, 1, 2, 3, 4, 5, 6, 7]) boulder(x, 5);           // the Sabre Crest: cleft at 8..9 (R10: (1,5) closed, the slip face is gone)
boulder(9, 8); boulder(10, 14);                                    // the spine's wall and its stop
for (const x of [13, 17]) boulder(x, 5);                           // scree under the butte fissure
// R10: THE WATCHMEN'S CUT. Two treads hewn down the butte's south lip bridge the fissure at x 14..15,
// so the road plain climbs 6h -> 8h -> 10h onto the butte and the North Notch becomes a real door.
c.fill(14, 4, 15, 4, SHOULDER, 'r');

// =====================================================================================
// 6. Void bites -- the diorama gets an outline, not a border
// =====================================================================================
// Never orthogonally adjacent to water: the oasis laps x=0 from z=9 to z=13, so the west edge is
// bitten well south of it. settle() parks every one of these at cutH - 2.
for (const r of [[20, 0, 21, 0], [21, 1, 21, 1], [20, 21, 21, 21], [21, 19, 21, 20],
  [0, 21, 1, 21], [0, 20, 0, 20], [6, 21, 7, 21], [0, 0, 0, 0], [18, 21, 18, 21]])
  chasm(c, { rect: r, void: true, kind: 'scenery', note: 'a bite out of the rectangle' });

// =====================================================================================
// 7. Props -- the caravan halt, the oasis, the butte, and B's camp
// =====================================================================================
// A's camp: a walled caravanserai on the beaten floor, its goods stacked against the walls. Nothing
// blocking sits on a spawn seat, on the 4h road, or on the watch stair's own two grounds.
c.prop({ type: 'house', x: 18, z: 17, w: 3, d: 2, rot: 0, storeys: 2, style: 'stone', roof: 'brown', chimney: 'right' });
c.prop({ type: 'house', x: 19, z: 14, w: 2, d: 2, rot: 3, storeys: 1, style: 'stone', roof: 'slate', gable: 'stone' });
c.prop({ type: 'house', x: 15, z: 20, w: 3, d: 2, rot: 2, storeys: 1, style: 'stone', barn: true, roof: 'thatch' });
c.prop({ type: 'tower', x: 20, z: 12, w: 2, d: 2, th: 3.6 });
c.prop({ type: 'well', x: 16.5, z: 18.5 });
c.prop({ type: 'stall', x: 15.5, z: 18.5, rot: 1 }); c.prop({ type: 'stall', x: 14.5, z: 12.5, rot: 3 });
c.prop({ type: 'cart', x: 15.5, z: 17.5, rot: 1 }); c.prop({ type: 'cart', x: 20.5, z: 20.5, rot: 0 });
c.prop({ type: 'barrel', x: 17.26, z: 13.74 }); c.prop({ type: 'crate', x: 17.72, z: 13.24 });
c.prop({ type: 'crate', x: 19.5, z: 13.5 }); c.prop({ type: 'barrel', x: 19.5, z: 12.5 });
c.prop({ type: 'hay', x: 13.5, z: 12.5 }); c.prop({ type: 'woodpile', x: 20.5, z: 19.5 });
c.prop({ type: 'trough', x: 18.5, z: 20.5 }); c.prop({ type: 'lamp', x: 16.5, z: 17.5 });
c.prop({ type: 'lamp', x: 16.5, z: 19.5 }); c.prop({ type: 'signpost', x: 14.5, z: 15.5 });
c.prop({ type: 'gate', x: 13.5, z: 20.5, rot: 0, roof: 'brown' });
c.prop({ type: 'wall', x: 18, z: 16, len: 3, dir: 'x', h: TOWN });
c.prop({ type: 'wall', x: 21, z: 14, len: 5, dir: 'z', h: TOWN, in: -1 });
c.prop({ type: 'fence', x: 17, z: 12, len: 2, dir: 'x' });
// The road plain and its watch platform.
c.prop({ type: 'ruin', x: 14, z: 8, len: 3, dir: 'z', th: 1.2 });   // a fallen wayhouse
c.prop({ type: 'pillar', x: 15.5, z: 7.5, h: 1.3 }); c.prop({ type: 'pillar', x: 15.5, z: 10.5, h: 0.9 });
c.prop({ type: 'signpost', x: 15.5, z: 9.5 }); c.prop({ type: 'rock', x: 13.5, z: 7.5 });
c.prop({ type: 'rock_small', x: 18.5, z: 6.5 }); c.prop({ type: 'rock', x: 19.5, z: 5.5 });
c.prop({ type: 'stairs', x: 14, z: 4, dir: 'n' }); c.prop({ type: 'stairs', x: 15, z: 4, dir: 'n' });
c.prop({ type: 'rail', x: 19, z: 8, len: 3, dir: 'x', h: UPPER });
c.prop({ type: 'lamp', x: 20.5, z: 9.5 }); c.prop({ type: 'crate', x: 21.5, z: 8.5 });
// The north butte: an abandoned watch-post over the fissure. (13,2) stays clear -- it is the only
// tile the North Notch opens onto, and a boulder there would make the second door a lie.
c.prop({ type: 'tower', x: 16, z: 0, w: 2, d: 2, th: 4.2 });
c.prop({ type: 'ruin', x: 13, z: 0, len: 2, dir: 'z', th: 1.6 });
c.prop({ type: 'ruin', x: 18, z: 0, len: 2, dir: 'x', th: 1.1 });
c.prop({ type: 'pillar', x: 17.5, z: 3.5, h: 1.5 }); c.prop({ type: 'pillar', x: 20.5, z: 2.5, h: 1.1 });
c.prop({ type: 'grave', x: 19.5, z: 2.5 }); c.prop({ type: 'grave', x: 16.5, z: 3.5 });
c.prop({ type: 'rock', x: 21.5, z: 2.5 }); c.prop({ type: 'rock', x: 15.5, z: 3.5 });
// The crest: spires along the rock, and a gate frame standing in the South Gate.
for (const [x, z, h] of [[11.5, 0.5, 1.8], [11.5, 5.5, 2.2], [11.5, 8.5, 1.6], [11.5, 16.5, 2.0], [11.5, 21.5, 1.7]])
  c.prop({ type: 'pillar', x, z, h });
c.prop({ type: 'gate', x: 11.5, z: 19.5, rot: 1, roof: 'slate' });
c.prop({ type: 'wall', x: 11, z: 18, len: 1, dir: 'x', h: RIDGE });
c.prop({ type: 'wall', x: 11, z: 21, len: 1, dir: 'x', h: RIDGE, in: -1 });
c.prop({ type: 'rock_small', x: 13.5, z: 12.5 });
// The oasis: palms set back off both rims, and a caravan halt on the south shore. The rim rows
// themselves stay clear -- the 4h road runs the length of the north rim.
// R7: real palms (were oaks and pines -- a temperate wood in a desert). Same tiles, same blocking footprint.
for (const [x, z] of [[3.5, 7.5], [5.5, 7.5], [2.5, 16.5], [4.5, 18.5], [8.5, 16.5]]) c.prop({ type: 'palm', x, z });
for (const [x, z] of [[7.5, 7.5], [0.5, 16.5], [6.5, 20.5]]) c.prop({ type: 'palm', x, z });
// Scrub only at the water's edge; the wildflower meadows are gone from the sand (bush/flowers never block).
for (const [x, z] of [[1.5, 8.5], [6.5, 8.5], [2.5, 14.5]])
  c.prop({ type: 'bush', x, z });
for (const [x, z] of [[3.5, 14.5]])
  c.prop({ type: 'flowers', x, z });
c.prop({ type: 'stall', x: 5.5, z: 16.5, rot: 0 }); c.prop({ type: 'cart', x: 3.5, z: 17.5, rot: 2 });
c.prop({ type: 'trough', x: 6.5, z: 16.5 }); c.prop({ type: 'barrel', x: 7.26, z: 16.74 });
c.prop({ type: 'crate', x: 7.72, z: 16.24 }); c.prop({ type: 'lamp', x: 2.5, z: 16.5 });
c.prop({ type: 'hay', x: 8.5, z: 18.5 }); c.prop({ type: 'woodpile', x: 0.5, z: 17.5 });
c.prop({ type: 'fence', x: 6, z: 17, len: 3, dir: 'x' });
// The dune field and B's plateau.
c.prop({ type: 'house', x: 4, z: 0, w: 2, d: 2, rot: 0, storeys: 1, style: 'stone', roof: 'brown' });
c.prop({ type: 'ruin', x: 6, z: 1, len: 2, dir: 'z', th: 1.4 });
c.prop({ type: 'pillar', x: 8.5, z: 2.5, h: 1.2 }); c.prop({ type: 'pillar', x: 7.5, z: 2.5, h: 1.6 });
c.prop({ type: 'grave', x: 9.5, z: 1.5 }); c.prop({ type: 'signpost', x: 0.5, z: 4.5 });
c.prop({ type: 'lamp', x: 0.5, z: 2.5 }); 

c.prop({ type: 'rock', x: 8.5, z: 1.5 }); c.prop({ type: 'rock_small', x: 6.5, z: 0.5 });
c.prop({ type: 'rock', x: 1.5, z: 17.5 }); c.prop({ type: 'rock_small', x: 8.5, z: 20.5 });

c.prop({ type: 'palm', x: 1.5, z: 20.5 });

// =====================================================================================
// 8. The declared design -- every claim below is proven by tools/mapcheck.mjs, not asserted
// =====================================================================================
c.declareFace({ fid: 'spire_hop', from: [11, 13], to: [12, 13], kind: 'express', minTurnSaving: 1,
  note: 'THE SPIRE HOP: the dry hollow (12,13) at RIVER 0 stands exactly 14h under the crown, which the void either side keeps to itself' });
c.declareRoute({ rid: 'notch_road', tier: BANK, from: 'A', to: 'B', via: [[16, 6], [14, 4], [13, 2], [11, 2]],
  note: 'the main 4h road: north up the road plain, the Watchmen\'s Cut onto the butte, west through the North Notch to B' });
c.declarePromise({ from: 'A', to: 'B', tier: 14, savesTurns: 1 });
c.declareRegion({ kind: 'scenery', rect: [0, 8, 10, 14], note: 'the oasis and its banks: the spine and the scarp fall straight into the water, so those banks are steeper than a terrace by design' });
c.declareRegion({ kind: 'perch', rect: [13, 0, 21, 3], note: 'the north butte: the main road crosses it, up the Watchmen\'s Cut and out through the North Notch' });
c.declareRegion({ kind: 'perch', rect: [10, 5, 10, 13], note: 'the spine: PEAK 14, entered off the crown or up the reef shoulder, and a dead end eastward' });
c.declareRegion({ kind: 'perch', rect: [19, 8, 21, 10], note: 'the watch platform over the road plain' });
c.declareRegion({ kind: 'staging', rect: [16, 14, 19, 17], note: "A's camp" });
c.declareRegion({ kind: 'staging', rect: [7, 3, 9, 4], note: "B's camp on the dune crest, between the Sabre cleft and the North Notch" });

// ORDER IS SIGNIFICANT: main.js index-matches spawns[team][i] to roster[team][i].
// R18 (review17 P2/P8, gameplay): spaced seats -- no two allies side by side or on a diagonal -- and the lines
// moved toward each other where the contract allows. Was A [[16, 15], [17, 15], [18, 15], [16, 16], [17, 16]], B [[7, 3], [8, 3], [9, 3], [7, 4], [8, 4]].
c.seat('A', [[13, 11], [15, 11], [15, 13], [13, 13], [15, 15]]);
c.seat('B', [[7, 3], [9, 2], [11, 2], [9, 4], [11, 4]]);

export const DEF = c.toDef();
