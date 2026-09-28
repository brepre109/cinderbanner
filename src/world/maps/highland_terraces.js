// "Highland Terraces" — a 20x20 teaching map: one cut hillside, four shelves, and the short way up
// is the only way up unless you can jump.
//
// THE POINT OF THIS MAP. The hill stacks valley 4h, sheep terrace 8h, ridge terrace 12h and crown
// 14h, held apart by VOID gullies. The attackers camp at the gorge mouth (BANK 4), the defenders on
// the crown lip (PEAK 14), eleven tiles apart as the crow flies.
//
// r10 REROUTE. The first cut re-opened each gully at exactly one two-tile connector, so the JUMP-2
// majority (Knight, mages, Blademaster) walked a 54-step spiral to cover eleven tiles and arrived after
// the battle was over -- the hero Knight dealt single-digit damage here. The hill now has two roads:
//   THE PILGRIM STAIR  the gorge head dressed as five 2h treads of stone, gorge floor 4h -> crown 14h,
//                      five tiles wide at the top where it swallows the east end of the ridge road.
//                      11-13 steps. B holds its head: high ground worth taking, not a wall.
//   THE HERDERS' RAMP  an earthen ramp (4h -> 6h -> 8h) out of the valley onto the sheep terrace's
//                      east end, then the mid connector and the ridge road onto the stair's landing
//                      from the west. 17 steps, a separate lane that flanks the stair head.
// The old foot connector, the west crown stair and the cleft (now a 10h saddle, 4h under both
// summits) remain as the long way round. Every walkable step on the board is 4h or less, so the map
// no longer declares express faces or a tier ladder; the height it keeps is to fight over.
//
// Surface legend: g grass, k dark turf, d dirt road, s stone flags, r bare rock, w water, v VOID.
import { canvas } from '../canvas.js';
import { chasm } from '../primitives/chasm.js';
import { footprint, PROP_SPEC } from '../mapformat/propspec.js';

const BANK = 4, TOWN = 6, SHOULDER = 8, UPPER = 10, RIDGE = 12, PEAK = 14;

const c = canvas({ mood: 'alpine',
  w: 20, d: 20, h: BANK, t: 'g', seed: 1104,
  id: 'highland_terraces', name: 'Highland Terraces', baseTier: 4, tiers: [4],
  blurb: 'Four shelves of a cut hillside. The road spirals; the gullies do not forgive.',
  notes: 'Two roads up: the Pilgrim Stair straight out of the gorge (12 steps), and the herders\' ramp over the sheep and ridge terraces onto the head of the same stair (15).',
});

// =====================================================================================
// 1. The hillside, painted summit-first, before anything is cut out of it. THREE-tile shelves, not
//    two: a two-row terrace with any clutter on it is a one-tile corridor, and every tile of it
//    then reports hazard.choke1 — one KO'd body corks the only road on the map for three turns.
// =====================================================================================
c.fill(0, 0, 19, 1, UPPER, 'k');        // back shelf: the far side of the hill falling away
c.fill(0, 2, 19, 4, PEAK, 'k');         // the crown
c.fill(0, 6, 13, 8, RIDGE, 'k');        // the ridge terrace
c.fill(0, 10, 13, 12, SHOULDER, 'g');   // the sheep terrace
c.fill(0, 14, 19, 19, BANK, 'g');       // the valley
c.fill(16, 6, 19, 15, BANK, 'r');       // the gorge floor: a dead-end defile up the east edge

// Relief inside the shelves. Every one of these is a 2h or 4h move against its neighbours, so it is
// landscape and not a shortcut; the gullies below do all the gating on this map.
c.disc(4, 3, 2, UPPER, 'k');            // the corrie — a scooped basin in the crown
c.fill(3, 3, 4, 3, SHOULDER, 'w');      // the corrie tarn, banked 2h all round
c.fill(2, 0, 6, 0, PEAK, 'r');          // rock crest along the back shelf
c.fill(15, 0, 17, 1, PEAK, 'r');   // ... and the crest the summit shrine stands on
c.fill(2, 10, 5, 11, SHOULDER, 'k');    // the fold in the sheep terrace
c.fill(0, 16, 3, 17, TOWN, 'g');        // valley knolls — 2h and 4h, walkable, scenery
c.fill(11, 17, 14, 18, TOWN, 'g');
c.fill(8, 17, 9, 18, TOWN, 'g');
c.fill(4, 18, 5, 19, SHOULDER, 'k');    // the tump the chapel stands on

// =====================================================================================
// 2. The gullies. Cut across the whole hill, then re-opened at one connector each — that single
//    pair of tiles per shelf is what makes the base route a spiral instead of a straight climb,
//    and each one is declared a choke below, so the validator proves the seal BY DELETION.
// =====================================================================================
chasm(c, { rect: [0, 5, 13, 5], kind: 'hazard', note: 'the crown scarp, west of the Pilgrim Stair' });
chasm(c, { rect: [19, 5, 19, 5], kind: 'scenery', note: 'the crown scarp, east of the Pilgrim Stair' });
chasm(c, { rect: [10, 2, 13, 2], kind: 'scenery', note: 'the cleft that splits the summit: the base tier reaches the east crown only over the back shelf' });
chasm(c, { rect: [10, 4, 13, 4], kind: 'scenery', note: 'the south lip of the same cleft' });
// THE TRAMWAY. Four tiles of quarry bed at SHOULDER 8 laid along the floor of the cleft, 6h under
// both summits and walled by void north and south, so it is entered and left ONLY by the two 6h
// faces at its ends. It is the 6h tier's whole reason to exist on this map: the base tier walks the
// back shelf, a JUMP-3 unit steps down the west lip, along the bed and up the east lip.
c.fill(10, 3, 13, 3, UPPER, 'r');            // 4h under both summits: a walkable saddle, not a vault
chasm(c, { rect: [0, 9, 15, 9], kind: 'scenery', note: 'the middle gully, between the sheep terrace and the ridge terrace' });
chasm(c, { rect: [0, 13, 15, 13], kind: 'scenery', note: 'the foot gully, between the valley and the sheep terrace' });
chasm(c, { rect: [14, 10, 15, 12], kind: 'scenery', note: 'the west wall of the gorge: the defile climbs nothing' });

// The three connectors, in route order. Each sits at the UPPER shelf's height, so the step off the
// lower shelf is exactly 4h and the step onto the upper one is zero.
c.fill(6, 13, 7, 13, SHOULDER, 'd');    // valley -> sheep terrace
c.fill(12, 9, 13, 9, RIDGE, 'd');       // sheep terrace -> ridge terrace
c.fill(0, 5, 1, 5, PEAK, 's');          // ridge terrace -> crown (the old west stair)
// THE HERDERS' RAMP: the valley road climbs straight onto the east end of the sheep terrace, so the
// terrace road is a real second approach instead of a spiral. 4h -> 6h -> 8h, dirt, two wide.
c.fill(12, 13, 13, 13, TOWN, 'd');

// THE PILGRIM STAIR. The gorge head is dressed stone, five treads of 2h from the gorge floor (BANK 4)
// to the crown (PEAK 14), five tiles wide at the top where it swallows the east end of the ridge
// terrace (RIDGE 12 at z=6 is flush with the ridge road). It is the defenders' front door: B holds the
// head of a broad flight, the attackers climb it or come round over the terraces onto its landing.
c.fill(16, 9, 18, 9, TOWN, 's');
c.fill(14, 8, 18, 8, SHOULDER, 's');
c.fill(14, 7, 18, 7, UPPER, 's');
c.fill(14, 6, 18, 6, RIDGE, 's');
c.fill(14, 5, 18, 5, PEAK, 's');

// Void bites, so the diorama has an outline instead of a border. Never beside water (the earth face
// shows through the black cap) and never where one strands a walkable tile.
for (const r of [[0, 0, 1, 0], [19, 0, 19, 1], [0, 19, 1, 19], [6, 19, 7, 19], [15, 19, 16, 19],
  [19, 18, 19, 19], [19, 6, 19, 7], [19, 11, 19, 12], [12, 19, 13, 19], [0, 14, 0, 15]])
  chasm(c, { rect: r, kind: 'scenery', note: 'bite in the diorama outline' });

// Roads, painted last so no fill can wipe them.
c.line(16, 15, 7, 15, null, 'd'); c.line(12, 14, 12, 12, null, 'd'); c.line(7, 15, 7, 13, null, 'd');
c.line(2, 17, 6, 17, null, 'd');
c.fill(1, 7, 7, 7, RIDGE, 'd'); c.fill(7, 8, 13, 8, RIDGE, 'd'); c.fill(0, 6, 1, 6, RIDGE, 'd');
c.put(7, 7, RIDGE, 'd'); c.fill(2, 11, 7, 11, SHOULDER, 'd'); c.fill(7, 12, 12, 12, SHOULDER, 'd');
c.put(12, 11, SHOULDER, 'd'); c.put(12, 10, SHOULDER, 'd'); c.fill(4, 6, 6, 6, RIDGE, 's');

// =====================================================================================
// 3. The walking rows. Every tile of the base route and of both express approaches goes into the
//    canvas avoid set BEFORE a single prop is placed, and P() refuses to close one. This is not
//    belt and braces: the first pass of this map put a lamp at 8,14 and a trough at 5,14 and
//    walled the foot connector off from the valley — contract.disconnect, from two sprites.
// =====================================================================================
c.protectRect(0, 7, 13, 7); c.protectRect(0, 6, 1, 6); c.protect(13, 6);          // the ridge road
c.protectRect(12, 8, 13, 9);                                                      // and its mouth
c.protectRect(0, 11, 13, 11); c.protect(12, 10); c.protectRect(6, 12, 7, 13);     // the sheep track
c.protectRect(7, 14, 7, 15); c.protectRect(8, 15, 18, 15);                        // the valley road
c.protectRect(17, 6, 17, 14); c.protectRect(14, 5, 16, 6);                        // the gorge
c.protectRect(0, 4, 9, 4); c.protectRect(0, 5, 1, 5); c.protectRect(14, 2, 14, 4);
c.protectRect(8, 1, 14, 1); c.protectRect(9, 2, 9, 3);                            // the crown circuit
c.protectRect(16, 14, 18, 15); c.protectRect(6, 2, 8, 3);                         // the two spawn files
c.protectRect(13, 8, 13, 11); c.protect(6, 14);
c.protectRect(12, 12, 13, 14); c.protectRect(14, 5, 18, 9); c.protectRect(16, 10, 18, 10);   // the ramp and the stair                                   // the connectors' second lane

// =====================================================================================
// 4. Props. Drystone country: every shelf lip carries a retaining wall and every gully edge a rail
//    — both edgeFree and non-blocking, so they read as masonry without ever closing a tile. The
//    blocking clutter sits on the SHOULDER rows of each three-row shelf, never the walking row.
// =====================================================================================
const P = (o) => {
  const p = c.prop(o);
  // Two different questions. EVERY prop must stand on real ground — `bush` and `tree` are
  // walk-through, so footprint() is empty for them and a reed billboard planted in the river would
  // otherwise pass unremarked. Only a BLOCKING footprint may not land on a protected tile.
  if (PROP_SPEC[p.type].coord !== 'edgeFree') {
    const [ax, az] = [Math.floor(p.x), Math.floor(p.z)];
    if (!c.walkAt(ax, az)) throw new Error(`highland_terraces: ${p.type} at ${p.x},${p.z} stands on ${c.tAt(ax, az)} at ${ax},${az}`);
  }
  for (const [x, z] of footprint(p)) {
    if (!c.walkAt(x, z)) throw new Error(`highland_terraces: ${p.type} at ${p.x},${p.z} stands on ${c.tAt(x, z)} at ${x},${z}`);
    if (c.isProtected(x, z)) throw new Error(`highland_terraces: ${p.type} at ${p.x},${p.z} closes route tile ${x},${z}`);
  }
  return p;
};
// --- the crown: the summit shrine on the east horn, the corrie tarn on the west ---
P({ type: 'tower', x: 17, z: 2, w: 2, d: 2, th: 3.8 });
P({ type: 'ruin', x: 15, z: 0, len: 2, dir: 'z', th: 1.5 });
P({ type: 'pillar', x: 16.5, z: 2.5, h: 1.5 }); P({ type: 'pillar', x: 19.5, z: 3.5, h: 1.1 });
P({ type: 'grave', x: 16.5, z: 3.5 }); P({ type: 'grave', x: 19.5, z: 2.5 });
P({ type: 'oak', x: 1.5, z: 2.5 }); P({ type: 'rock', x: 4.5, z: 2.5 }); P({ type: 'rock_small', x: 5.5, z: 2.5 });
P({ type: 'bush', x: 2.5, z: 2.5 }); P({ type: 'bush', x: 6.5, z: 2.5 });
P({ type: 'flowers', x: 5.5, z: 4.5 }); P({ type: 'flowers', x: 2.5, z: 4.5 }); P({ type: 'flowers', x: 18.5, z: 4.5 });
for (const [x, z] of [[3, 2], [7, 4], [1, 3], [15, 3], [18, 2]]) P({ type: 'bush', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[4, 4], [9, 3], [19, 4]]) P({ type: 'tree', x: x + 0.5, z: z + 0.5 });
P({ type: 'lamp', x: 0.5, z: 2.5 });                                   // beside the crown stair head
P({ type: 'wall', x: 0, z: 5, len: 2, dir: 'x', h: PEAK, in: -1 });     // its parapet, over the moat
P({ type: 'rail', x: 6, z: 5, len: 4, dir: 'x', h: PEAK });
P({ type: 'rail', x: 9, z: 2, len: 3, dir: 'z', h: PEAK });            // the cleft's west lip
// --- the back shelf: the treeline on the far side of the hill ---
for (const [x, z] of [[2, 0], [4, 0], [7, 0], [8, 0], [17, 0]]) P({ type: 'pine', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[6, 0], [18, 1], [18, 0]]) P({ type: 'rock', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[3, 1], [5, 1], [16, 1]]) P({ type: 'bush', x: x + 0.5, z: z + 0.5 });
P({ type: 'rock_small', x: 0.5, z: 1.5 }); P({ type: 'flowers', x: 7.5, z: 1.5 });
for (const [x, z] of [[8, 1], [10, 1], [14, 1], [1, 1], [6, 1]]) P({ type: 'tree', x: x + 0.5, z: z + 0.5 });
// --- the ridge terrace: a wayside halt under the crown scarp ---
P({ type: 'house', x: 3, z: 6, w: 2, d: 1, rot: 0, storeys: 1, style: 'stone', roof: 'slate', chimney: 'right' });
P({ type: 'cart', x: 6.5, z: 6.5, rot: 0 }); P({ type: 'barrel', x: 7.24, z: 6.28 }); P({ type: 'crate', x: 7.72, z: 6.76 });
P({ type: 'woodpile', x: 9.5, z: 6.5 }); P({ type: 'hay', x: 11.5, z: 6.5 }); P({ type: 'trough', x: 10.5, z: 6.5 });
P({ type: 'signpost', x: 5.5, z: 6.5 }); P({ type: 'lamp', x: 2.5, z: 6.5 }); P({ type: 'stall', x: 8.5, z: 6.5, rot: 2 });
P({ type: 'bush', x: 12.5, z: 6.5 }); P({ type: 'flowers', x: 6.5, z: 8.5 }); P({ type: 'flowers', x: 3.5, z: 8.5 });
P({ type: 'flowers', x: 0.5, z: 8.5 }); P({ type: 'flowers', x: 11.5, z: 8.5 }); P({ type: 'wall', x: 0, z: 8, len: 3, dir: 'x', h: RIDGE, in: -1 });
for (const [x, z] of [[2, 7], [5, 8], [8, 7], [11, 7], [13, 7], [1, 8], [7, 6], [0, 7]]) P({ type: 'bush', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[4, 7], [9, 7], [12, 8], [2, 8], [10, 7], [6, 7]]) P({ type: 'flowers', x: x + 0.5, z: z + 0.5 });
P({ type: 'wall', x: 1, z: 6, len: 12, dir: 'x', h: RIDGE, in: -1 });  // the uphill retaining course
P({ type: 'rail', x: 0, z: 9, len: 12, dir: 'x', h: RIDGE });          // the lip over the middle gully
P({ type: 'stairs', x: 12, z: 9, dir: 'n' }); P({ type: 'stairs', x: 13, z: 9, dir: 'n' });
// --- the sheep terrace: pens, a herder's barn and the water trough ---
P({ type: 'house', x: 8, z: 10, w: 2, d: 1, rot: 2, storeys: 1, style: 'timber', roof: 'thatch', barn: true });
P({ type: 'fence', x: 1, z: 10, len: 3, dir: 'x' });
P({ type: 'trough', x: 5.5, z: 10.5 }); P({ type: 'hay', x: 11.5, z: 10.5 }); P({ type: 'woodpile', x: 10.5, z: 10.5 });
P({ type: 'rock', x: 0.5, z: 10.5 }); P({ type: 'oak', x: 7.5, z: 10.5 });
P({ type: 'flowers', x: 4.5, z: 12.5 }); P({ type: 'flowers', x: 1.5, z: 12.5 }); P({ type: 'flowers', x: 12.5, z: 12.5 });
for (const [x, z] of [[3, 11], [6, 10], [9, 11], [12, 11], [2, 12], [8, 12]]) P({ type: 'bush', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[1, 11], [5, 12], [7, 10], [11, 11], [13, 12]]) P({ type: 'flowers', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[4, 11], [10, 11]]) P({ type: 'tree', x: x + 0.5, z: z + 0.5 });
P({ type: 'rail', x: 0, z: 13, len: 6, dir: 'x', h: SHOULDER });
P({ type: 'rail', x: 8, z: 13, len: 4, dir: 'x', h: SHOULDER });
P({ type: 'stairs', x: 12, z: 13, dir: 'n' }); P({ type: 'stairs', x: 13, z: 13, dir: 'n' });
P({ type: 'stairs', x: 6, z: 13, dir: 'n' }); P({ type: 'stairs', x: 7, z: 13, dir: 'n' });
P({ type: 'gate', x: 6.5, z: 12.5, rot: 0 }); P({ type: 'gate', x: 12.5, z: 8.5, rot: 1 });
// --- the Pilgrim Stair: treads on the central lane, a lamp at its foot, the shrine's ruin beside it ---
for (let z = 6; z <= 9; z++) { P({ type: 'stairs', x: 16, z, dir: 'n' }); P({ type: 'stairs', x: 17, z, dir: 'n' }); }
P({ type: 'wall', x: 14, z: 9, len: 2, dir: 'x', h: SHOULDER, in: 1 });   // the stair's west landing over the gully
P({ type: 'lamp', x: 19.5, z: 9.5 });
P({ type: 'grave', x: 19.5, z: 8.5 });
// --- the gorge: a defile of bare rock below the stair ---
for (const [x, z] of [[18, 12]]) P({ type: 'rock', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[18, 11]]) P({ type: 'rock_small', x: x + 0.5, z: z + 0.5 });
P({ type: 'bush', x: 19.5, z: 13.5 }); P({ type: 'pine', x: 19.5, z: 10.5 });
P({ type: 'cart', x: 16.5, z: 13.5, rot: 1 }); P({ type: 'barrel', x: 19.26, z: 14.74 }); P({ type: 'crate', x: 19.7, z: 14.2 });
P({ type: 'signpost', x: 15.5, z: 16.5 }); P({ type: 'lamp', x: 16.5, z: 12.5 });
// --- the valley hamlet at the foot of the hill ---
P({ type: 'house', x: 1, z: 16, w: 3, d: 1, rot: 2, storeys: 2, chimney: 'left', style: 'timber', roof: 'thatch' });
P({ type: 'house', x: 11, z: 17, w: 2, d: 1, rot: 3, storeys: 2, chimney: 'left', style: 'stone', roof: 'slate', gable: 'stone' });
P({ type: 'house', x: 13, z: 17, w: 2, d: 1, rot: 1, storeys: 1, chimney: 'right', style: 'timber', roof: 'tile' });
P({ type: 'house', x: 8, z: 17, w: 2, d: 1, rot: 0, storeys: 1, chimney: 'right', style: 'timber', roof: 'tile' });
P({ type: 'house', x: 18, z: 17, w: 2, d: 1, rot: 0, storeys: 1, style: 'timber', barn: true, roof: 'brown' });
P({ type: 'tower', x: 4, z: 18, w: 2, d: 2, th: 3.4 });                // the chapel on the tump
P({ type: 'ruin', x: 2, z: 19, len: 2, dir: 'x', th: 1.2 });
P({ type: 'grave', x: 6.5, z: 18.5 }); P({ type: 'grave', x: 6.5, z: 16.5 }); P({ type: 'pillar', x: 3.5, z: 18.5, h: 1.0 });
P({ type: 'well', x: 10.5, z: 19.5 }); P({ type: 'stall', x: 10.5, z: 16.5, rot: 2 }); P({ type: 'stall', x: 12.5, z: 16.5, rot: 0 });
P({ type: 'cart', x: 8.5, z: 16.5, rot: 3 }); P({ type: 'trough', x: 5.5, z: 16.5 });
P({ type: 'barrel', x: 13.26, z: 16.24 }); P({ type: 'crate', x: 13.74, z: 16.72 }); P({ type: 'woodpile', x: 4.5, z: 14.5 });
P({ type: 'hay', x: 15.5, z: 17.5 }); P({ type: 'hay', x: 16.7, z: 17.24 }); P({ type: 'crate', x: 16.2, z: 17.76 });
P({ type: 'fence', x: 17, z: 19, len: 2, dir: 'x' });
P({ type: 'gate', x: 7.5, z: 14.5, rot: 0 });                          // the lane onto the foot connector
P({ type: 'lamp', x: 9.5, z: 16.5 }); P({ type: 'lamp', x: 11.5, z: 19.5 });
P({ type: 'oak', x: 2.5, z: 15.5 }); P({ type: 'oak', x: 16.5, z: 17.5 }); P({ type: 'oak', x: 0.5, z: 16.5 });
P({ type: 'pine', x: 0.5, z: 18.5 }); P({ type: 'pine', x: 8.5, z: 19.5 }); P({ type: 'pine', x: 19.5, z: 10.5 });
P({ type: 'bush', x: 3.5, z: 15.5 }); P({ type: 'bush', x: 14.5, z: 16.5 }); P({ type: 'bush', x: 13.5, z: 16.5 });
P({ type: 'rock', x: 5.5, z: 15.5 }); P({ type: 'rock_small', x: 11.5, z: 19.5 });
P({ type: 'flowers', x: 2.5, z: 15.5 }); P({ type: 'flowers', x: 11.5, z: 16.5 }); P({ type: 'flowers', x: 18.5, z: 19.5 });
P({ type: 'flowers', x: 10.5, z: 18.5 }); P({ type: 'flowers', x: 3.5, z: 16.5 });

// =====================================================================================
// 5. Spawns and the design contract. Measured for the JUMP-2 majority (shots/maps/r10/routes.mjs):
//    A -> B up the Pilgrim Stair 12-15 steps, and over the herders' ramp, the sheep terrace, the
//    mid connector and the ridge road onto the stair's landing 15-18 -- two separate lanes, both
//    under 1.6x the straight line. Every walkable step on the board is 4h or less.
// =====================================================================================
// R18 (review17 P2/P8, gameplay): spaced seats -- no two allies side by side or on a diagonal -- and the lines
// moved toward each other (mean walk A->B about 13 steps, first contact by round 2). Was A [[16, 14], [17, 14], [18, 14], [17, 15], [18, 15]], B [[14, 4], [15, 4], [16, 4], [17, 4], [18, 4]].
c.seat('A', [[14, 14], [12, 14], [16, 14], [16, 16], [18, 14]]);   // the camp at the gorge mouth
c.seat('B', [[14, 4], [12, 6], [14, 6], [16, 4], [16, 6]]);        // the crown lip, at the head of the stair

c.declareRegion({ kind: 'staging', rect: [16, 14, 18, 15], note: 'A: the camp at the gorge mouth' });
c.declareRegion({ kind: 'staging', rect: [14, 4, 18, 4], note: 'B: the crown lip over the Pilgrim Stair' });
c.declareRoute({ rid: 'pilgrim_stair', tier: 4, from: 'A', to: 'B', via: [[17, 9]],
  note: 'gorge floor -> the Pilgrim Stair -> crown' });

export const DEF = c.toDef();
