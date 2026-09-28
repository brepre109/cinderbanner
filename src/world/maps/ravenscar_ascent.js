// "Ravenscar Ascent" — a 20x24 assault on a curtain wall, in the spirit of the genre's Ravenscar Castle.
// The ward stands 6h over the siege terrace and the ditch in front of it is VOID, not height.
//
// r10 REROUTE. The first cut crossed the ditch only at the postern at the far west end (39 steps for
// JUMP 2 against 21 of straight line), so the Knight, the mages and the Blademaster spent the battle
// walking. The low breach at x8 is now THE GATE STAIR and a second flight, THE SALLY STAIR, climbs
// under the east drum tower at x16-17: two tiles wide, terrace 6h -> 8h -> 10h -> ward 12h, every
// tread 2h. Measured (shots/maps/r10/routes.mjs, JUMP 2): 21-25 steps A->B over the Sally Stair,
// 25-29 over the Gate Stair, the postern still the long way round. The scoured breach at x14 stays
// a 10h express face for JUMP 5 (one step and the straighter line under the keep).
//
// WHY THE BREACHES ARE WHERE THE ARMIES MEET, and this is the load-bearing lesson of the rebuild.
// ai.js:147 picks the nearest enemy by MANHATTAN distance and then scores reachable tiles by
// |d - want|; it has no path metric. So an army pressed against a barrier whose only door lies
// sideways stands there forever -- the door is further away in the only distance the AI can measure.
// The first version of this map put three full-width ditches between the spawns with their gaps at
// opposite ends of the board, and 38 of 40 headless battles (src/game/sim.mjs n=40 seed=11) ended in
// stalemate resolution with the two sides frozen nine rows apart: 1.1 KOs and 5.9 hits per battle.
// The rule this map now keeps: A BARRIER IS WHERE THE FIGHT HAPPENS, so put the shortcut THERE. A
// shelf one tile below the wall is Manhattan distance ONE from the ward above it, so the 4h tier can
// stand on the breach and trade blows up the step while the 6h and 10h tiers vault it, and the
// approach to both breaches runs the same way the enemy does. Measured after, same command:
// 0/40 stalemates, 6.7 KOs, 26.4 hits, 10.6 rounds, 'all invariants held'. Seeds 1/3/5/7/11/17/23
// all hold every invariant, at 0-5% stalemates.
//
// Heights in h (1h = 0.25 world units, 4h = one tile width). RIVER 0, SHORE 2, BANK 4, TOWN 6,
// SHOULDER 8, UPPER 10, RIDGE 12, PEAK 14, CREST 18; void is parked below the cut by settle().
// Terraces step 2h; the base tier is 4h (JUMP 2). Surface legend: g grass, k turf, s beaten stone,
// r bare rock, d dirt track, w water, v VOID.
//
// ONE TILE FOR THE SCOURED BREACH IS NOT A STYLE CHOICE: report.js prices a face by cutting THAT ONE
// EDGE and re-flooding, so a parallel 10h step would make both worthless.
import { canvas } from '../canvas.js';
import { chasm } from '../primitives/chasm.js';
import { BLOCKING, footprint } from '../mapformat/propspec.js';

const W = 20, D = 24;
const RIVER = 0, SHORE = 2, BANK = 4, TOWN = 6, SHOULDER = 8, UPPER = 10, RIDGE = 12, PEAK = 14, CREST = 18;

const c = canvas({ mood: 'night', w: W, d: D, h: BANK, t: 'g', id: 'ravenscar_ascent', name: 'Ravenscar Ascent',
  seed: 3, baseTier: 4, tiers: [4, 10],
  blurb: 'A curtain wall over a void ditch. Two siege stairs and a postern for the many, a scoured breach for the few.',
  notes: '4h climbs the Gate Stair at x8-9 or the Sally Stair at x16-17 (both flights of 2h treads) or walks ' +
    'the postern at the west end. 10h drops into the gully and takes the scoured breach at x14.' });

// ============================================================ 1. the siege camp and its terrace
// Meadow 4h, terrace 6h, ramp head 10h: every tread inside the base tier's 4h budget, so the 4h
// class walks the whole approach and the ONLY thing on the board it cannot walk is the wall itself.
// A camp that needed a jump to leave would price the ladder twice and mean half as much.
c.fill(0, 21, 19, 23, BANK, 'g');                       // the meadow A musters on
c.fill(0, 19, 19, 20, TOWN, 'k');                       // THE SIEGE TERRACE, two rows, 6h under the ward
c.fill(0, 19, 2, 19, UPPER, 'd');                       // and the ramp head that carries it to the postern
c.fill(15, 21, 19, 23, SHORE, 'g');                     // the meadow falls away east to the beck
c.fill(3, 22, 6, 23, SHORE, 'g'); c.fill(4, 23, 6, 23, RIVER, 'w');   // the millpond in the camp
c.fill(13, 21, 14, 21, TOWN, 'k');                      // the gully head, running back into the meadow

// ==================================================== 2. the ditch, the postern and the two breaches
// Void, not height: rules.js walks the 4-neighbour grid one tile at a time, so nothing crosses a tile
// that is not there at ANY jump. A height wall would just be one more face the next tier up hops.
chasm(c, { rect: [0, 18, 19, 18], kind: 'hazard', note: 'the ditch: three crossings, and they are the ladder' });
c.fill(0, 18, 2, 18, RIDGE, 'd');                       // THE POSTERN — 3 tiles, and 12 steps out of the way
// THE GATE STAIR and THE SALLY STAIR (r10): two stone flights, two tiles wide, laid over the ditch where
// the old low breach was and under the east drum tower. Terrace 6h -> 8h -> 10h -> ward 12h, every
// tread 2h, so the JUMP-2 majority climbs straight into the ward instead of marching to the postern.
c.fill(8, 19, 9, 19, SHOULDER, 's'); c.fill(8, 18, 9, 18, UPPER, 's');
c.fill(16, 19, 17, 19, SHOULDER, 's'); c.fill(16, 18, 17, 18, UPPER, 's');
c.put(14, 18, SHORE, 'r');                              // THE SCOURED BREACH — the gully floor, 10h under it

// ======================================================================== 3. the ward and the keep
c.fill(0, 7, 19, 17, RIDGE, 's');                       // THE WARD — the drill yard behind the wall
c.fill(0, 7, 19, 8, PEAK, 's');                         // its upper terrace, 2h
c.fill(16, 13, 19, 16, PEAK, 's');                      // the east bastion
c.fill(3, 12, 7, 15, UPPER, 'k');                       // the cistern yard, 2h down
c.fill(4, 13, 6, 14, SHOULDER, 'w');                    // and the cistern itself
c.fill(0, 0, 19, 6, PEAK, 's');                         // the crown court
c.fill(6, 0, 12, 2, CREST, 's');                        // THE KEEP MOUND, 4h — high ground, not a face
c.fill(0, 0, 3, 1, PEAK, 'k'); c.fill(16, 0, 19, 1, PEAK, 'k');
c.fill(15, 9, 19, 12, UPPER, 'k');                      // the ward's east garden terrace, 2h down
c.fill(0, 11, 2, 12, UPPER, 'k');                       // and the strip under the west wall walk
c.fill(5, 3, 9, 5, PEAK, 'k');                          // the court's turf, in front of the keep mound

// Declared HERE and not beside the terrain that cuts them: declareFace MEASURES the drop off the
// grid at the moment it is called (canvas.js), so a face declared before the ward is filled in
// records the drop to the canvas's default height and mapcheck raises contract.face-drop.
c.declareFace({ fid: 'face_scour', from: [14, 17], to: [14, 18], kind: 'express', minTurnSaving: 1,
  note: 'THE SCOURED BREACH: the gully has cut (14,18) to SHORE 2, exactly 10h under the ward, and it lands under the keep' });

// Void bites: the diorama gets an outline instead of a border. Never orthogonally adjacent to water
// (settle() would repair such a tile back to grass and quietly re-open the ditch), never on a
// declared tile, and every one of them off the three routes -- a bite costs playfield and buys only
// silhouette, so it is spent on the rim.
for (const r of [[0, 23, 1, 23], [0, 22, 0, 22], [18, 23, 19, 23], [19, 21, 19, 22],
  [0, 0, 1, 0], [19, 0, 19, 0], [0, 9, 0, 10], [19, 9, 19, 10], [0, 5, 0, 5], [19, 5, 19, 5]])
  chasm(c, { rect: r, kind: 'scenery', note: 'rim bite' });

// ==================================================================== 4. the declared design
c.declareRoute({ rid: 'rt_sally', tier: 4, from: 'A', to: 'B', via: [[16, 19], [16, 18], [16, 17]],
  note: 'the Sally Stair under the east drum tower, then north up the ward to the crown court; the Gate Stair at x8-9 is the second road, three steps longer' });
c.declareRoute({ rid: 'rt_scour', tier: 10, from: 'A', to: 'B', via: [[13, 19], [14, 19], [14, 18], [14, 17], [14, 7], [14, 5]],
  note: 'the scoured breach: down the gully and up 10h, and the gate is four rows away' });
c.declareRegion({ kind: 'staging', rect: [10, 21, 14, 23], note: "A: the siege camp under the wall" });
c.declareRegion({ kind: 'staging', rect: [14, 3, 17, 5], note: 'B: the crown court in front of the keep' });
c.declareRegion({ kind: 'road', rect: [0, 19, 2, 19], note: 'the terrace head above the postern' });
c.declareRegion({ kind: 'perch', rect: [16, 13, 19, 16], note: 'the east bastion: 2h over the ward it enfilades' });
c.declareRegion({ kind: 'scenery', rect: [0, 18, 19, 18], note: 'the ditch: its banks are steeper than a terrace by design' });

// ======================================================================== 5. props
// PLACEMENT LAW, and it is not a style note: a BLOCKING prop on the terrace row or on either breach
// approach turns the tile beside it into a cut vertex, and the symptom is not a broken prop -- it is
// a ladder that silently flattens and a contract.face-worthless error two files away. So the heavy
// furniture lives in the meadow (3 rows), the ward yard (7 rows) and the crown court (5 rows), and
// the wall lines are dressed with `wall`, `rail`, `gate`, `arch`, `tree`, `bush` and `flowers`,
// every one of which props.js renders full size and mapdata.js leaves WALKABLE.
const P = (p) => c.prop(p);
// --- the siege camp: the muster ground, the mill and the baggage train --------------------------
P({ type: 'house', x: 1, z: 21, w: 2, d: 2, rot: 1, storeys: 1, chimney: 'right', style: 'timber', roof: 'thatch' });
P({ type: 'house', x: 16, z: 21, w: 2, d: 2, rot: 3, storeys: 1, chimney: null, style: 'timber', barn: true, roof: 'brown' });
P({ type: 'house', x: 7, z: 22, w: 2, d: 1, rot: 0, storeys: 1, chimney: 'left', style: 'timber', roof: 'tile' });
// NOTHING BLOCKING ON z 19 OR z 20: the terrace and its tread are one row each, so a single barrel
// there is a wall across the only approach the 4h tier owns. Both rows carry rails and greenery only.
P({ type: 'well', x: 9.5, z: 21.5 }); P({ type: 'signpost', x: 5.5, z: 21.5 });
P({ type: 'cart', x: 11.5, z: 23.5, rot: 1 }); P({ type: 'cart', x: 15.5, z: 22.5, rot: 2 });
P({ type: 'woodpile', x: 0.5, z: 21.5 }); P({ type: 'hay', x: 13.5, z: 23.5 });
P({ type: 'barrel', x: 13.24, z: 23.26 }); P({ type: 'crate', x: 17.24, z: 23.26 });
P({ type: 'stall', x: 4.5, z: 21.5, rot: 2 }); P({ type: 'trough', x: 18.5, z: 22.5 });
P({ type: 'fence', x: 3, z: 8, len: 2, dir: 'x' }); P({ type: 'grave', x: 8.5, z: 21.5 });
P({ type: 'oak', x: 18.5, z: 21.5 }); P({ type: 'pine', x: 19.5, z: 20.5 });
for (const [x, z] of [[7, 21], [15, 20], [18, 19], [12, 23], [13, 20], [6, 20], [3, 19], [11, 19]]) P({ type: 'tree', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[3, 21], [7, 23], [16, 23], [2, 20], [12, 19], [9, 20], [6, 19]]) P({ type: 'bush', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[4, 22], [9, 23], [14, 22], [5, 19], [17, 20], [11, 20], [0, 20], [18, 20], [1, 19], [7, 19]]) P({ type: 'flowers', x: x + 0.5, z: z + 0.5 });

// --- the curtain: `wall` traces both lips of the ditch and blocks nothing while doing it --------
P({ type: 'wall', x: 3, z: 19, len: 5, dir: 'x', h: UPPER, in: -1 });
P({ type: 'wall', x: 10, z: 19, len: 3, dir: 'x', h: UPPER, in: -1 });
P({ type: 'wall', x: 15, z: 19, len: 1, dir: 'x', h: UPPER, in: -1 }); P({ type: 'wall', x: 18, z: 19, len: 2, dir: 'x', h: UPPER, in: -1 });
P({ type: 'wall', x: 0, z: 17, len: 8, dir: 'x', h: RIDGE }); P({ type: 'wall', x: 10, z: 17, len: 4, dir: 'x', h: RIDGE });
P({ type: 'wall', x: 15, z: 17, len: 1, dir: 'x', h: RIDGE }); P({ type: 'wall', x: 18, z: 17, len: 2, dir: 'x', h: RIDGE });
P({ type: 'rail', x: 0, z: 19, len: 3, dir: 'x', h: UPPER, in: -1 });
for (const x of [8, 9, 16, 17]) { P({ type: 'stairs', x, z: 19, dir: 'n' }); P({ type: 'stairs', x, z: 18, dir: 'n' }); }   // the two flights
P({ type: 'arch', x: 14, z: 17.5, h: RIDGE, r: 0.9, dir: 'z' });      // and the scoured one
P({ type: 'gate', x: 1.5, z: 17.5, rot: 0, roof: 'slate' });          // the postern gate itself
P({ type: 'tower', x: 5, z: 16, w: 2, d: 2, th: 3.8 });               // the wall's drum towers,
P({ type: 'tower', x: 11, z: 16, w: 2, d: 2, th: 3.8 });              // set back off the fighting step
P({ type: 'tower', x: 17, z: 16, w: 2, d: 1, th: 3.4 });

// --- the ward: the drill yard left open, its edges built up ------------------------------------
P({ type: 'house', x: 1, z: 7, w: 2, d: 2, rot: 0, storeys: 2, chimney: 'left', style: 'stone', roof: 'slate', gable: 'stone' });
P({ type: 'house', x: 9, z: 12, w: 3, d: 2, rot: 2, storeys: 2, chimney: 'right', style: 'stone', roof: 'tile' });
P({ type: 'house', x: 5, z: 10, w: 2, d: 2, rot: 1, storeys: 1, chimney: null, style: 'stone', roof: 'brown' });
P({ type: 'ruin', x: 1, z: 10, len: 3, dir: 'x', th: 1.4 }); P({ type: 'ruin', x: 10, z: 8, len: 2, dir: 'x', th: 1.1 });
P({ type: 'pillar', x: 8.5, z: 9.5, h: 1.9 }); P({ type: 'pillar', x: 11.5, z: 9.5, h: 1.9 });
P({ type: 'well', x: 7.5, z: 11.5 }); P({ type: 'trough', x: 3.5, z: 16.5 });
P({ type: 'stall', x: 13.5, z: 14.5, rot: 3 }); P({ type: 'cart', x: 9.5, z: 15.5, rot: 0 });
P({ type: 'hay', x: 12.5, z: 15.5 }); P({ type: 'woodpile', x: 2.5, z: 13.5 });
P({ type: 'crate', x: 12.74, z: 12.26 }); P({ type: 'barrel', x: 12.24, z: 12.72 });
P({ type: 'lamp', x: 7.5, z: 16.5 }); P({ type: 'lamp', x: 19.5, z: 15.5 }); P({ type: 'grave', x: 13.5, z: 9.5 });
P({ type: 'rail', x: 3, z: 12, len: 5, dir: 'x' , h: UPPER }); P({ type: 'rail', x: 3, z: 16, len: 5, dir: 'x', h: UPPER, in: -1 });
P({ type: 'wall', x: 16, z: 13, len: 4, dir: 'x', h: PEAK }); P({ type: 'wall', x: 16, z: 9, len: 4, dir: 'x', h: PEAK, in: -1 });
for (const [x, z] of [[2, 9], [6, 16], [12, 11], [17, 12], [0, 13]]) P({ type: 'tree', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[3, 11], [10, 10], [15, 16], [8, 15], [1, 12], [18, 14]]) P({ type: 'bush', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[4, 16], [7, 10], [13, 16], [2, 15], [16, 15], [11, 14], [5, 9]]) P({ type: 'flowers', x: x + 0.5, z: z + 0.5 });

// --- the crown court: the keep, the chapel and the ground B holds -------------------------------
P({ type: 'tower', x: 8, z: 0, w: 3, d: 3, th: 4.6 });
P({ type: 'house', x: 2, z: 3, w: 3, d: 2, rot: 2, storeys: 2, chimney: 'left', style: 'stone', roof: 'slate', gable: 'stone' });
P({ type: 'house', x: 17, z: 4, w: 2, d: 2, rot: 3, storeys: 2, chimney: 'right', style: 'stone', roof: 'tile' });
P({ type: 'ruin', x: 4, z: 5, len: 3, dir: 'x', th: 1.3 }); P({ type: 'ruin', x: 12, z: 5, len: 2, dir: 'x', th: 1.6 });
P({ type: 'pillar', x: 6.5, z: 3.5, h: 1.7 }); P({ type: 'pillar', x: 12.5, z: 3.5, h: 1.7 });
P({ type: 'gate', x: 10.5, z: 5.5, rot: 0, roof: 'slate' });
P({ type: 'grave', x: 4.5, z: 1.5 }); P({ type: 'grave', x: 5.5, z: 1.5 }); P({ type: 'grave', x: 13.5, z: 1.5 });
P({ type: 'lamp', x: 13.5, z: 4.5 }); P({ type: 'barrel', x: 18.26, z: 2.24 }); P({ type: 'crate', x: 18.74, z: 2.76 });
P({ type: 'well', x: 9.5, z: 4.5 }); P({ type: 'woodpile', x: 4.5, z: 6.5 });
P({ type: 'wall', x: 6, z: 3, len: 7, dir: 'x' , h: CREST, in: -1 }); P({ type: 'rail', x: 0, z: 6, len: 19, dir: 'x', h: PEAK, in: -1 });
P({ type: 'oak', x: 1.5, z: 2.5 }); P({ type: 'pine', x: 18.5, z: 0.5 }); P({ type: 'rock', x: 3.5, z: 0.5 });
for (const [x, z] of [[15, 0], [11, 4], [0, 4]]) P({ type: 'tree', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[2, 0], [13, 3], [7, 4], [17, 1]]) P({ type: 'bush', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[3, 2], [14, 5], [8, 4], [18, 3], [5, 4]]) P({ type: 'flowers', x: x + 0.5, z: z + 0.5 });

// --- the east ward: the garden terrace and the bastion, dressed but never walled ---------------
// BLOCKING props are spent sparingly from here on and the reason is measured, not aesthetic: the
// same dressing laid down with houses, carts and barrels instead of hedges took the headless
// stalemate rate from 0/40 to 10/40 on seed 7, because every extra CLOSED tile is one more pocket a
// pair of survivors can lose each other in for eighty turns. Density is bought with `tree`, `bush`, `flowers`, `wall` and
// `rail`, all of which props.js renders full size and mapdata.js leaves walkable.
P({ type: 'house', x: 17, z: 9, w: 2, d: 2, rot: 3, storeys: 1, chimney: 'right', style: 'stone', roof: 'brown' });
P({ type: 'rail', x: 15, z: 9, len: 4, dir: 'z', h: UPPER }); P({ type: 'rail', x: 15, z: 13, len: 5, dir: 'x', h: UPPER, in: -1 });
P({ type: 'wall', x: 15, z: 17, len: 1, dir: 'x', h: RIDGE, in: -1 }); P({ type: 'wall', x: 18, z: 17, len: 2, dir: 'x', h: RIDGE, in: -1 });
for (const [x, z] of [[16, 12], [19, 12], [18, 16], [15, 11], [18, 13]]) P({ type: 'tree', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[19, 13], [15, 12], [17, 12], [19, 8], [16, 16], [16, 8], [18, 12]]) P({ type: 'bush', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[18, 11], [16, 10], [19, 14], [15, 10], [17, 8], [18, 17], [17, 13], [19, 11], [16, 11]]) P({ type: 'flowers', x: x + 0.5, z: z + 0.5 });
// --- and the rest of the yard, which a drill ground earns by being mostly empty ----------------
P({ type: 'rail', x: 0, z: 11, len: 3, dir: 'x', h: UPPER }); P({ type: 'rail', x: 3, z: 13, len: 3, dir: 'z', h: UPPER, in: -1 });
P({ type: 'wall', x: 8, z: 9, len: 5, dir: 'x', h: PEAK, in: -1 }); P({ type: 'arch', x: 10, z: 9, h: PEAK, r: 0.8, dir: 'x' });
for (const [x, z] of [[13, 12], [1, 12], [5, 12], [12, 10], [7, 8], [4, 10], [11, 15]]) P({ type: 'tree', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[9, 16], [4, 11], [6, 9], [13, 8], [2, 12], [9, 14], [12, 16], [2, 16], [14, 12]]) P({ type: 'bush', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[10, 16], [6, 11], [12, 14], [3, 9], [13, 9], [8, 9], [1, 14], [4, 17], [7, 17], [0, 16], [10, 11], [5, 16]]) P({ type: 'flowers', x: x + 0.5, z: z + 0.5 });
// --- the crown court, dressed up to the keep ---------------------------------------------------
P({ type: 'rail', x: 6, z: 0, len: 3, dir: 'z', h: CREST }); P({ type: 'rail', x: 13, z: 0, len: 3, dir: 'z', h: CREST, in: -1 });
P({ type: 'wall', x: 0, z: 3, len: 5, dir: 'x', h: PEAK }); P({ type: 'wall', x: 15, z: 3, len: 5, dir: 'x', h: PEAK });
for (const [x, z] of [[19, 6], [4, 4], [10, 3], [8, 5], [1, 5]]) P({ type: 'tree', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[6, 5], [16, 6], [11, 2], [9, 3], [18, 5], [3, 5], [12, 6]]) P({ type: 'bush', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[7, 3], [12, 2], [2, 6], [17, 3], [5, 2], [10, 5], [14, 1], [7, 5], [19, 4], [5, 0]]) P({ type: 'flowers', x: x + 0.5, z: z + 0.5 });
// --- and the camp, which a siege fills up -------------------------------------------------------
P({ type: 'rail', x: 3, z: 22, len: 4, dir: 'x', h: SHORE, in: -1 });
for (const [x, z] of [[2, 19], [6, 21], [12, 23]]) P({ type: 'bush', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[10, 20], [15, 19], [4, 20], [8, 20], [13, 23], [19, 19], [12, 20], [3, 20], [10, 23], [1, 20]]) P({ type: 'flowers', x: x + 0.5, z: z + 0.5 });

// ===================================================================================== 6. spawns
// ORDER IS SIGNIFICANT: main.js index-matches spawns[team][i] to roster[team][i].
// R18 (review17 P2/P8, gameplay): spaced seats -- no two allies side by side or on a diagonal -- and the lines
// moved toward each other where the contract allows. Was A [[11, 22], [12, 22], [13, 22], [12, 21], [13, 21]], B [[14, 4], [15, 4], [16, 4], [15, 3], [16, 3]].
c.seat('A', [[12, 21], [10, 19], [14, 21], [12, 19], [14, 19]]);   // the captain (slot 0) in the back rank: c6 is 'Aldric must not fall'
c.seat('B', [[14, 6], [15, 8], [17, 8], [13, 8], [16, 6]]);

// The regression this map suffered three times before it shipped: a blocking prop dropped onto a
// route row severs the approach, and what you see is not a broken prop -- it is a flattened ladder
// and an error two files away. So the module refuses to load with a declared tile closed, in the
// same spirit as wendford_crossing's waterPerColumn() check: the assertion lives beside the thing
// it protects.
{
  const shut = new Set();
  for (const p of c.props) if (BLOCKING.has(p.type)) for (const [x, z] of footprint(p)) shut.add(x + ',' + z);
  const must = [...c.faces.flatMap((f) => [f.from, f.to]), ...c.chokes.flatMap((k) => k.tiles),
    ...c.routes.flatMap((r) => r.via), ...c.assists.flatMap((a) => a.tiles),
    ...c.spawns.A, ...c.spawns.B];
  const bad = must.filter(([x, z]) => shut.has(x + ',' + z));
  if (bad.length) throw new Error(`ravenscar_ascent: a blocking prop closes declared tile(s) ${JSON.stringify(bad)}`);
}

export const DEF = c.toDef();
