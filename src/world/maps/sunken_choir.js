// "Sunken Choir" -- an 18x18 ruined abbey standing in its own flood. Three walls, two doors, one
// fallen course and one scarp: the west court, the drowned nave, the choir, and the APSE on its
// 14h platform in the south-east, which is the thing both sides are here for.
//
// WHY THIS MAP WAS REBUILT. The first Sunken Choir was four bays behind three doors whose z values
// stepped 6 -> 9 -> 4, so the base road walked three horseshoes. It measured beautifully -- 53
// steps, every promise kept, every choke sealed -- and it was unplayable: 40 of 40 AI battles ended
// in stalemate resolution and `node src/game/sim.mjs` exited 1 on the project's own invariant. The
// cause is measurable, not aesthetic. ai.js:150 approaches on MANHATTAN distance and nothing else,
// so a road that must first walk AWAY from the enemy is a local minimum the AI never leaves; and a
// stalemate is scored on KOs, not damage (rules.js:474 resets the stall counter on a KO, not a
// hit), so a ranged standoff across a wall is not a battle either. 46 of the old map's 143 walkable
// tiles were articulation tiles -- single tiles whose removal severed spawn A from spawn B -- so a
// KO'd body corked a third of the board. Every one of those numbers is a geometry fact, and the
// geometry is what changed.
//
// THE TWO RULES THIS LAYOUT IS BUILT ON.
//   1. The two rosters must be able to REACH each other. rules.js:132 inRange is Manhattan with no
//      vertical term, so two units on opposite lips of a 12h scarp are ADJACENT and fight. The
//      cloister walk runs due east from the west court, monotonically toward the apse, and dies
//      against that scarp at 13,15 -- so both rosters walk toward each other and trade from turn
//      one; since R10 the 4h tier climbs round it through the Sacristy Breach and the choir.
//   2. Every bay is at least three tiles across. The doors and the express landing are the only
//      one-tile chokes left on the board, and none of them is where the fighting happens.
//
// Heights are in h (1h = 0.25 world units, 4h = one tile). baseTier is 4h: rules.js allows a step
// when |dh| <= jump * HEIGHT_STEP, so JUMP 2 clears 4h and 14 of the 32 classes sit exactly there.
// The test is Math.abs, i.e. SYMMETRIC -- a 6h DESCENT is gated exactly like a 6h climb, which is
// what makes the fallen course below a two-way face and not a slide.
//
// R10 REROUTE. The first ladder here (4 / 6 / 12) priced a 38-step base road, and the campaign
// harness measured what that costs: a JUMP-2 hero walked 40+ tiles and arrived after the fight.
// The abbey now has three JUMP-2 roads, all of them walls that have given way rather than new
// architecture, and the 6h tier is retired because the fallen course is now a 2h sill:
//   4h  THE BREACH ROAD (main). East along the cloister walk, north through THE SACRISTY BREACH
//       (12,13) -- the south range burst at its east bay -- into the choir, and up the presbytery
//       step onto the apse. 18 steps against a straight line of 16.
//   4h  THE NAVE FLANK. Through THE CLOISTER DOOR (5,11), the west wall's second door, along the
//       nave's south bay, through the Choir Door and up the presbytery steps from the north. 22-24.
//   4h  THE FALLEN COURSE (9,13), now a rubble sill 2h over both floors, links the walk and the nave,
//       and the old north road through the West Door (5,2) is still there for anyone who wants it.
//  12h  THE APSE SCARP, (13,15) -> (14,15). Still the fighting line and still ONE tile (the arcade
//       has fallen at 14,14 and 14,16); a JUMP-6 class goes straight up and saves a turn.
//
// MEASURED (tools/mapcheck.mjs --map=sunken_choir, MOVE 3):
//     4h  JUMP 2   18 steps   6 turns   the breach road
//    12h  JUMP 6   14 steps   5 turns   -1, up the apse scarp
//
// WALLS ARE TERRAIN AT 12h UNDER `ruin` PROPS, not props alone. validate.js proves a blocking prop
// is not load-bearing by DELETING it and re-running the base flood; a prop-only wall fails that
// test, because lifting one course would open a second door. 12h is chosen: every floor a wall tile
// touches is at 6h or below, so a lifted course still leaves a 6h step and the counterfactual is a
// no-op. Each wall is declared `scenery`, the one region kind the gentleness sweep exempts.
//
// Surface letters: g grass, k dark turf, d dirt, s stone flags, S shingle, b plank, r bare rock,
// w water, v void. Screen orientation at the default camera (yaw 45 deg): (0,0) is the top of the
// diamond, (17,17) the bottom, (17,0) screen-right, (0,17) screen-left.
import { canvas } from '../canvas.js';
import { catwalk } from '../primitives/catwalk.js';
import { chasm } from '../primitives/chasm.js';
import { stairFlight } from '../primitives/stairFlight.js';
import { footprint, PROP_SPEC } from '../mapformat/propspec.js';

const W = 18, D = 18;
const RIVER = 0, SHORE = 2, BANK = 4, TOWN = 6, SHOULDER = 8, UPPER = 10, PEAK = 14, WALLH = 12;

const c = canvas({ mood: 'rain-dim',
  w: W, d: D, h: BANK, t: 's', id: 'sunken_choir', name: 'Sunken Choir', author: 'hand',
  baseTier: 4, tiers: [4, 12], seed: 0x5c402,
  blurb: 'A drowned abbey: three doors, two breaches, and a cloister walk that dies under the apse.',
  notes: '4h: along the cloister walk and through the Sacristy Breach (18), or the Cloister Door and the nave (22), or the old north road (38). JUMP 6 goes straight up the apse scarp.',
});

// =====================================================================================
// 1. The shell. Four rooms and a cloister walk, and every one of them at least three tiles across.
// =====================================================================================
c.fill(0, 0, 4, 17, BANK, 's');                       // the west court: narthex, cellarer's range, garth
c.fill(6, 0, 9, 12, SHORE, 'S');                      // the nave, one terrace below the court
c.fill(11, 0, 17, 12, TOWN, 's');                     // the choir
c.fill(14, 12, 17, 12, UPPER, 's');                   // the presbytery step, half way up to the apse
c.fill(14, 13, 17, 17, PEAK, 's');                    // THE APSE, on its platform
c.fill(5, 14, 13, 16, SHORE, 'S');                    // the cloister walk, along the south range

// The three walls. Wall tiles stand at 12h and carry a ruin apiece (section 4), so they are closed
// for every class at every tier; the two doors sit at the height of the room they open into, so
// stepping through is never more than 4h and the door is never the thing that gates -- the wall is.
c.fill(5, 0, 5, 13, WALLH, 's');                      // the west wall
c.fill(10, 0, 10, 13, WALLH, 's');                    // the rood screen
c.fill(6, 13, 9, 13, WALLH, 's'); c.fill(11, 13, 13, 13, WALLH, 's');   // the south range
c.put(5, 2, BANK, 'd');                               // the West Door
c.put(10, 10, TOWN, 'd');                             // the Choir Door
c.put(9, 13, BANK, 'r');                              // THE FALLEN COURSE: a rubble sill, 2h out of the walk and 2h down into the nave
c.put(12, 13, BANK, 'r');                             // THE SACRISTY BREACH: the south range burst at its east bay, walk -> choir
c.put(5, 11, BANK, 'd');                              // THE CLOISTER DOOR: the west wall's second door, court -> nave south bay

// =====================================================================================
// 2. The flood. One body at RIVER 0, so the "sunken" half of the name is literal: the nave floor
//    survives as shingle margins round the water, and the margins are the road.
// =====================================================================================
c.fill(7, 4, 7, 9, RIVER, 'w');                       // the drowned centre aisle
// The plank. catwalk cuts the span to live water AND derives the walk grant from the deck rectangle,
// so the props.md 3.15 desync ("either alone is a bug") cannot happen here. It is a convenience, not
// a route: the nave is a ring and both margins already reach both ends.
catwalk(c, { from: [6, 7], to: [8, 7], h: RIVER, w: 1, style: 'wood', choke: false,
  note: 'the plank over the flooded nave, laid where the pulpitum steps used to be' });

// =====================================================================================
// 3. What has fallen in. Void is the only cut every class honours, so these are the shapes that
//    actually decide the road -- and each one is cut where it costs the map no width.
// =====================================================================================
chasm(c, { rect: [13, 4, 14, 7], note: 'the choir floor fell into the crypt: the road walks round it, north or south' });
chasm(c, { rect: [14, 14, 14, 14] }); chasm(c, { rect: [14, 16, 14, 16] });
// ^ the apse arcade, fallen in two bays. THIS IS THE CONTRACT: with them standing, the walk would
//   face the platform across three 12h steps and analysis/report.js would price each of the three
//   at a saving of nothing, because cutting one leaves the other two.
chasm(c, { rect: [0, 0, 1, 0] }); chasm(c, { rect: [0, 17, 1, 17] });   // bites in the diorama outline
chasm(c, { rect: [5, 17, 9, 17] }); chasm(c, { rect: [11, 17, 13, 17] });
chasm(c, { rect: [16, 0, 17, 0] }); chasm(c, { rect: [6, 0, 6, 0] });
chasm(c, { rect: [10, 17, 10, 17] }); chasm(c, { rect: [4, 17, 4, 17] });

// Turf through the flags: the roof went first and thirty summers of grass came up through the
// paving. It is also the only thing that keeps four rooms of bare stone reading as four rooms.
c.fill(1, 2, 2, 4, BANK, 'k'); c.fill(0, 8, 1, 10, BANK, 'k'); c.fill(1, 14, 3, 16, BANK, 'g');
c.fill(3, 0, 4, 1, BANK, 'd'); c.fill(3, 2, 4, 12, BANK, 'd'); c.fill(4, 13, 4, 16, BANK, 'd');
c.fill(6, 1, 9, 2, SHORE, 'S'); c.fill(9, 3, 9, 12, SHORE, 'd');
c.fill(11, 9, 13, 11, TOWN, 'd'); c.fill(14, 9, 14, 11, TOWN, 'd');
c.fill(11, 0, 12, 2, TOWN, 'k'); c.fill(15, 1, 17, 3, TOWN, 'k'); c.fill(15, 8, 17, 11, TOWN, 'k');
c.fill(5, 15, 13, 15, SHORE, 'b'); c.fill(15, 14, 17, 16, PEAK, 'k');   // the walk's boards, the apse garth

// The presbytery steps, so the two-tread climb onto the apse reads as masonry rather than terrain.
const steps = stairFlight(c, { x: 15, z: 12, dir: 's', lowH: TOWN, highH: PEAK, width: 3, t: 's',
  note: 'the presbytery steps: two treads carry the 4h tier off the choir floor onto the apse' });
if (steps.assist) steps.assist.aid = 'assist_presbytery_steps';

// =====================================================================================
// 4. Masonry, and the guard that keeps it off the road. Every wall tile carries a ruin, which is
//    what makes the closure survive validate.js's delete-the-prop test; every other prop is checked
//    against the protected route BEFORE it lands. That guard is not belt and braces: the first
//    dressing pass of this rebuild stood the crossing tower at 11,6 and a row of graves down the
//    choir's east bays, and cut the whole north choir -- 26 tiles -- off the base flood.
//    `design.orphan`, from furniture.
// =====================================================================================
c.protectRect(2, 0, 4, 13); c.protectRect(2, 14, 4, 17);          // the court's two lanes
c.protect(5, 2); c.protectRect(6, 1, 9, 2);                       // the West Door and the nave's north bay
c.protectRect(6, 4, 6, 12); c.protectRect(8, 3, 9, 12); c.protectRect(6, 11, 9, 11);
c.protect(10, 10); c.protectRect(11, 9, 14, 11);                  // the Choir Door and the choir lane
c.protectRect(11, 0, 17, 2); c.protectRect(12, 3, 12, 8); c.protectRect(11, 8, 17, 8);
c.protectRect(14, 12, 17, 13);                                    // the presbytery step and the apse lip
c.protectRect(5, 15, 13, 15); c.protectRect(5, 14, 9, 14);        // the walk's board lane and its north row
c.protect(9, 13); c.protect(14, 15);
c.protectRect(12, 11, 12, 14); c.protectRect(4, 11, 6, 11);        // the breach lane and the Cloister Door                              // the fallen course and the scarp landing
c.protectRect(0, 14, 2, 15); c.protectRect(15, 15, 17, 15);       // the two camps
c.protect(15, 16); c.protect(16, 14);

const faults = [];
const P = (o) => {
  const p = c.prop(o);
  // Two different questions. EVERY prop must stand on real ground -- `bush`, `tree` and `flowers`
  // are walk-through, so footprint() is empty for them and a reed planted in the flood would
  // otherwise pass unremarked. Only a BLOCKING footprint may not land on a protected tile. Faults
  // are COLLECTED, not thrown one at a time: a dressing pass moves twenty props, and a first-fault
  // throw turns that into twenty edit-and-run cycles.
  if (PROP_SPEC[p.type].coord !== 'edgeFree') {
    const [ax, az] = [Math.floor(p.x), Math.floor(p.z)];
    if (!c.walkAt(ax, az)) faults.push(`${p.type} at ${p.x},${p.z} stands on ${c.tAt(ax, az)} at ${ax},${az}`);
  }
  for (const [x, z] of footprint(p)) {
    if (!c.walkAt(x, z)) faults.push(`${p.type} at ${p.x},${p.z} stands on ${c.tAt(x, z)} at ${x},${z}`);
    else if (c.isProtected(x, z)) faults.push(`${p.type} at ${p.x},${p.z} closes route tile ${x},${z}`);
  }
  return p;
};
// The walls themselves are placed WITHOUT P(): a ruin on a wall tile IS the wall, and closing it is
// the whole point. Runs are broken into courses of different thickness so the three parapets read
// as masonry in three states of collapse rather than as three ruled lines.
const course = (x, z, len, dir, th) => c.prop({ type: 'ruin', x, z, len, dir, th });
course(5, 0, 2, 'z', 1.3); course(5, 3, 4, 'z', 1.5); course(5, 7, 4, 'z', 1.1); course(5, 12, 2, 'z', 0.8);
course(10, 0, 4, 'z', 1.4); course(10, 4, 3, 'z', 1.6); course(10, 7, 3, 'z', 1.0); course(10, 11, 3, 'z', 1.2);
course(6, 13, 3, 'x', 1.3); course(11, 13, 1, 'x', 0.9); course(13, 13, 1, 'x', 1.3);

// =====================================================================================
// 5. The dressing. Nothing here is scatter. Blocking props are confined to the tiles the protect
//    pass left open -- the court's west range, the nave's two dry bays, the choir's four corners,
//    the walk's south row and the apse garth -- and everything that reads as ground cover is a
//    NON-blocking type (bush, tree, flowers, rail, wall, arch), which is what lets an abbey this
//    dense stay an abbey you can fight in.
// =====================================================================================
for (const p of [
  // --- the west court: the abbot's lodging, the cellarer's range and the gate tower, all on x 0..1
  //     so the court keeps two clear lanes and no single tile is ever stranded behind a wall ---
  { type: 'house', x: 0, z: 2, w: 2, d: 3, rot: 1, storeys: 2, style: 'stone', roof: 'slate', gable: 'stone', chimney: 'right' },
  { type: 'house', x: 0, z: 6, w: 2, d: 2, rot: 1, storeys: 1, style: 'stone', roof: 'brown', barn: true },
  { type: 'tower', x: 0, z: 11, w: 2, d: 2, th: 3.2 },
  { type: 'well', x: 1.5, z: 9.5 }, { type: 'grave', x: 0.5, z: 9.5 }, { type: 'grave', x: 0.5, z: 8.5 },
  { type: 'cart', x: 1.5, z: 13.5, rot: 1 }, { type: 'woodpile', x: 0.5, z: 13.5 },
  { type: 'hay', x: 1.5, z: 16.5 }, { type: 'barrel', x: 0.24, z: 16.26 }, { type: 'crate', x: 0.72, z: 16.74 },
  { type: 'lamp', x: 1.5, z: 5.5 }, { type: 'signpost', x: 1.5, z: 8.5 }, { type: 'oak', x: 0.5, z: 5.5 },
  { type: 'rail', x: 2, z: 1, len: 12, dir: 'z', h: 4 },              // the court's kerb along the road
  { type: 'wall', x: 0, z: 1, len: 2, dir: 'x', h: 4, in: 1 },
  { type: 'bush', x: 2.5, z: 6.5 }, { type: 'bush', x: 3.5, z: 10.5 }, { type: 'bush', x: 3.5, z: 16.5 },
  { type: 'tree', x: 2.5, z: 4.5 }, { type: 'tree', x: 3.5, z: 15.5 }, { type: 'tree', x: 2.5, z: 12.5 },
  { type: 'flowers', x: 2.5, z: 3.5 }, { type: 'flowers', x: 3.5, z: 7.5 }, { type: 'flowers', x: 2.5, z: 9.5 },
  { type: 'flowers', x: 4.5, z: 5.5 }, { type: 'flowers', x: 3.5, z: 13.5 }, { type: 'flowers', x: 2.5, z: 16.5 },
  { type: 'flowers', x: 4.5, z: 11.5 }, { type: 'flowers', x: 0.5, z: 15.5 }, { type: 'flowers', x: 4.5, z: 16.5 },
  // --- the two doors, arched on both faces so each wall reads as pierced, not merely gapped ---
  { type: 'arch', x: 5, z: 2.5, h: 6, r: 0.72, dir: 'x', flip: true }, { type: 'arch', x: 6, z: 2.5, h: 6, r: 0.72, dir: 'x' },
  { type: 'arch', x: 5, z: 11.5, h: 6, r: 0.72, dir: 'x', flip: true }, { type: 'arch', x: 6, z: 11.5, h: 6, r: 0.72, dir: 'x' },
  { type: 'arch', x: 10, z: 10.5, h: 8, r: 0.72, dir: 'x', flip: true }, { type: 'arch', x: 11, z: 10.5, h: 8, r: 0.72, dir: 'x' },
  // --- the nave: the arcade that carried the roof, sheared to four heights so the run reads as a
  //     colonnade and not a wall, and a quay rail down the flood's west lip ---
  { type: 'pillar', x: 7.5, z: 0.5, h: 1.6 }, { type: 'pillar', x: 7.5, z: 3.5, h: 1.1 },
  { type: 'pillar', x: 7.5, z: 12.5, h: 1.4 }, { type: 'pillar', x: 7.5, z: 10.5, h: 0.8 },
  { type: 'grave', x: 6.5, z: 3.5 }, { type: 'rock', x: 8.5, z: 0.5 }, { type: 'rock_small', x: 7.5, z: 12.5 },
  { type: 'rail', x: 7, z: 4, len: 6, dir: 'z', h: 2 }, { type: 'rail', x: 8, z: 4, len: 6, dir: 'z', h: 2 },
  { type: 'bush', x: 6.5, z: 5.5 }, { type: 'bush', x: 9.5, z: 6.5 }, { type: 'bush', x: 6.5, z: 10.5 },
  { type: 'tree', x: 6.5, z: 12.5 }, { type: 'tree', x: 9.5, z: 11.5 },
  { type: 'flowers', x: 6.5, z: 3.5 }, { type: 'flowers', x: 6.5, z: 7.5 }, { type: 'flowers', x: 9.5, z: 9.5 },
  { type: 'flowers', x: 6.5, z: 9.5 }, { type: 'flowers', x: 9.5, z: 4.5 }, { type: 'flowers', x: 8.5, z: 11.5 },
  // --- the choir: the crossing tower where it came down, two bays of arcade, the crypt lip ---
  { type: 'tower', x: 16, z: 6, w: 2, d: 2, th: 2.8 },
  { type: 'pillar', x: 11.5, z: 3.5, h: 1.7 }, { type: 'pillar', x: 11.5, z: 5.5, h: 1.3 },
  { type: 'pillar', x: 11.5, z: 7.5, h: 1.5 }, { type: 'pillar', x: 15.5, z: 3.5, h: 0.9 },
   { type: 'pillar', x: 15.5, z: 9.5, h: 1.0 },
  { type: 'rail', x: 13, z: 4, len: 4, dir: 'z', h: 6 }, { type: 'rail', x: 15, z: 4, len: 4, dir: 'z', h: 6 },
  { type: 'grave', x: 17.5, z: 3.5 }, { type: 'grave', x: 11.5, z: 12.5 }, { type: 'grave', x: 16.5, z: 9.5 },
  { type: 'barrel', x: 17.24, z: 9.26 }, { type: 'crate', x: 17.72, z: 9.74 }, { type: 'woodpile', x: 15.5, z: 5.5 },
  { type: 'stall', x: 17.5, z: 10.5, rot: 3 }, { type: 'stairs', x: 12, z: 13, dir: 'n' }, { type: 'stairs', x: 9, z: 13, dir: 'n' },
  { type: 'bush', x: 13.5, z: 3.5 }, { type: 'bush', x: 16.5, z: 2.5 }, { type: 'bush', x: 12.5, z: 9.5 },
  { type: 'tree', x: 17.5, z: 1.5 }, { type: 'tree', x: 11.5, z: 10.5 }, { type: 'oak', x: 17.5, z: 5.5 },
  { type: 'flowers', x: 16.5, z: 3.5 }, { type: 'flowers', x: 15.5, z: 10.5 }, { type: 'flowers', x: 12.5, z: 6.5 },
  { type: 'flowers', x: 13.5, z: 10.5 },  { type: 'flowers', x: 11.5, z: 1.5 },
  // --- the cloister walk and its south range: roofless, boards laid over the silt ---
  { type: 'ruin', x: 5, z: 16, len: 2, dir: 'x', th: 0.9 },
  { type: 'pillar', x: 8.5, z: 16.5, h: 1.2 }, { type: 'pillar', x: 11.5, z: 16.5, h: 0.8 },
  { type: 'pillar', x: 13.5, z: 16.5, h: 1.4 }, { type: 'pillar', x: 12.5, z: 16.5, h: 1.0 },
  { type: 'rail', x: 5, z: 14, len: 4, dir: 'x', h: 2 }, { type: 'rail', x: 10, z: 14, len: 2, dir: 'x', h: 2 }, { type: 'grave', x: 13.5, z: 14.5 },
  { type: 'bush', x: 9.5, z: 16.5 }, { type: 'bush', x: 12.5, z: 15.5 }, { type: 'tree', x: 7.5, z: 15.5 },
  { type: 'flowers', x: 7.5, z: 16.5 }, { type: 'flowers', x: 10.5, z: 16.5 }, { type: 'flowers', x: 6.5, z: 14.5 },
   { type: 'flowers', x: 10.5, z: 14.5 }, { type: 'flowers', x: 5.5, z: 15.5 },
  // --- the apse: the platform the east half is worth holding ---
  { type: 'house', x: 16, z: 16, w: 2, d: 1, rot: 0, storeys: 1, style: 'stone', roof: 'tile', chimney: 'left' },
  { type: 'well', x: 17.5, z: 14.5 },
  { type: 'ruin', x: 14, z: 17, len: 1, dir: 'x', th: 1.4 },
  { type: 'oak', x: 15.5, z: 14.5 },
  { type: 'wall', x: 14, z: 13, len: 4, dir: 'x', h: 14, in: -1 },   // the apse-step parapet
  { type: 'rail', x: 14, z: 15, len: 3, dir: 'z', h: 14 },
  { type: 'bush', x: 16.5, z: 13.5 }, { type: 'tree', x: 17.5, z: 16.5 },
  { type: 'flowers', x: 15.5, z: 13.5 }, { type: 'flowers', x: 16.5, z: 15.5 }, { type: 'flowers', x: 17.5, z: 17.5 },
]) P(p);
if (faults.length) throw new Error(`sunken_choir: ${faults.length} misplaced prop(s):\n  ` + faults.join('\n  '));

// =====================================================================================
// 6. Declarations -- what the geometry above is FOR, in the form the analyser can refute
// =====================================================================================
c.declareRegion({ kind: 'scenery', rect: [5, 0, 5, 13], note: 'the west wall: 12h of masonry standing in the flood' });
c.declareRegion({ kind: 'scenery', rect: [10, 0, 10, 13], note: 'the rood screen' });
c.declareRegion({ kind: 'scenery', rect: [6, 13, 13, 13], note: 'the south range wall, fallen to rubble in one bay' });
c.declareRegion({ kind: 'perch', rect: [14, 13, 17, 17], note: 'the apse platform: 12h over the cloister walk, two treads down to the choir' });
c.declareRegion({ kind: 'staging', rect: [0, 13, 2, 16], note: 'the west court, where the attackers form up' });
c.declareRegion({ kind: 'staging', rect: [15, 14, 17, 16], note: 'the apse garth, where the defenders hold' });

c.declareFace({ from: [13, 15], to: [14, 15], fid: 'face_apse_scarp', kind: 'express', minTurnSaving: 1,
  note: 'THE APSE SCARP: 12h straight off the end of the cloister walk onto the platform. It is the map fighting line as well as its top tier -- inRange is Manhattan, so the 4h tier trades across it from below while only JUMP 6 climbs it.' });

c.declareRoute({ rid: 'road_breach', tier: 4, from: 'A', to: 'B', via: [[12, 13], [14, 12]],
  note: 'the main road: east along the cloister walk, north through the Sacristy Breach into the choir, up the presbytery step onto the apse' });
c.declarePromise({ from: 'A', to: 'B', tier: 12, savesTurns: 1 });

// R18 (review17 P2/P8, gameplay): spaced seats -- no two allies side by side or on a diagonal -- and the lines
// moved toward each other where the contract allows. Was A [[0, 14], [1, 14], [2, 14], [1, 15], [0, 15]], B [[15, 15], [16, 15], [17, 15], [15, 16], [16, 14]].
c.seat('A', [[2, 11], [4, 10], [4, 12], [4, 14], [2, 14]]);
c.seat('B', [[15, 15], [17, 11], [17, 13], [15, 13], [15, 11]]);

// R7 dressing: a drowned nave in the rain is not a wildflower meadow. The flower decals survive only on living turf
// (g/k); on flags, planks, shingle and the mud floor they read as green stickers. Decals never block, so the walk
// graph and every design promise above are untouched.
c.props = c.props.filter((p) => p.type !== 'flowers' || /[gk]/.test(c.T[Math.floor(p.z)][Math.floor(p.x)]));
export const DEF = c.toDef();
