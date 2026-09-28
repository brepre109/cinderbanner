// "Greyspine Pass" -- Chapter II opener, a 22x20 mountain col. The Cinder Company climbs out of the
// south on the pass road and is met at the col by frost beasts and pass raiders.
//
// THE SHAPE. A bare-rock massif (the Greyspine, 20-22h) splits the pass up the middle, so the climb
// from the road camp (4h) to the col (16h) is two lanes that only rejoin at the top:
//   THE TOLL ROAD (west)  up the switchback shelves 6 -> 8 -> 10 -> 12h past the black tarn (a plank
//                         footbridge crosses it for the far-west file), over the wooden bridge that
//                         spans the gorge at 12h, through the ruined toll-gate on the 14h waystation
//                         shelf, onto the col.
//   THE CAIRN STAIR (east) a two-wide stone flight cut up the rock shoulder, 6h -> 14h in four 2h
//                         treads, onto the cairn shoulder and the col's east end.
// B holds the col: the high ground at the head of BOTH lanes, and the Greyspine's summit (20h) is a
// perch reachable only from the col (one 4h step), which is where raider archers want to stand.
// Every walkable step on the lanes is 2h; nothing on either road is more than 4h.
//
// Screen orientation at the default camera (yaw 45 deg): (0,0) is the top of the diamond (the far
// north rim), (21,19) the bottom (the road out to the south), (21,0) screen-right, (0,19) screen-left.
//
// Surface legend: k dark turf, g grass (sparse), d dirt road, s stone flags, b wood plank,
// r bare rock, w water, v VOID. No snow texture exists; the cold is rock, pine and a hard blue fill.
import { canvas } from '../canvas.js';
import { chasm } from '../primitives/chasm.js';
import { catwalk } from '../primitives/catwalk.js';
import { footprint, PROP_SPEC } from '../mapformat/propspec.js';

const W = 22, D = 20;
const ROAD = 4, H6 = 6, H8 = 8, H10 = 10, H12 = 12, SHELF = 14, COL = 16, CREST = 18, CRAG = 20, SPIRE = 22;

// R15 (review15 P9): the col where 'the snow is trampled' now reads as snow -- terrain.js SKINS.snow + the 'snow' light.
// Mood only; heights, letters, props and spawns are untouched.
const c = canvas({ mood: 'snow',
  w: W, d: D, h: ROAD, t: 'r', seed: 2201,
  id: 'greyspine_pass', name: 'Greyspine Pass', baseTier: 4, tiers: [4],
  blurb: 'A high col split by bare rock: the toll road and its gorge bridge, or the cairn stair up the shoulder.',
  notes: 'JUMP 2: the toll road over the tarn shelves and the gorge bridge (~18), or the cairn stair up the east shoulder (~18). B holds the col at the head of both.',
});

// =====================================================================================
// 1. The mountain, painted top-down: the rim, the col, the two crags that frame it.
// =====================================================================================
c.fill(0, 0, 21, 0, CREST, 'r');              // the north rim, the far side of the pass
c.fill(4, 1, 17, 4, COL, 'r');                // THE COL -- a saddle of rock and road
c.fill(5, 1, 16, 1, COL, 'k');                // the lee of the rim holds a little turf
c.fill(0, 0, 3, 3, CRAG, 'r');                // the west crag
c.fill(0, 4, 3, 4, CREST, 'r');               // ... stepping 4h down to the waystation shelf
c.fill(18, 0, 21, 3, CRAG, 'r');              // the east crag
c.fill(1, 1, 2, 2, 22, 'r');                  // ... and its tooth
c.fill(19, 1, 20, 1, 22, 'r');                // the east crag's tooth
c.fill(18, 4, 21, 5, COL, 'k');               // the east crag's foot, a turf ledge at col height
c.fill(4, 2, 5, 3, null, 'g'); c.fill(15, 2, 16, 4, null, 'g'); c.put(6, 4, null, 'g');   // thin grass in the saddle's lee
c.fill(10, 5, 13, 5, COL, 'r');               // the col's south lip under the Greyspine

// =====================================================================================
// 2. The west lane -- the toll road. Shelves of 2h, south to north, with the tarn and the gorge.
// =====================================================================================
c.fill(0, 5, 9, 6, SHELF, 'k');               // the waystation shelf
c.fill(0, 9, 9, 9, H12, 'k');                 // the gorge's south lip
c.fill(0, 10, 9, 12, H10, 'k');               // the tarn shelf, pines
c.fill(0, 13, 9, 13, H8, 'k');
c.fill(0, 13, 4, 13, H10, 'k');               // the tarn's south bank
c.fill(0, 14, 9, 14, H6, 'g');
c.fill(1, 10, 3, 12, H8, 'w');                // THE BLACK TARN, banked 2-4h all round
// the gorge: two rows of void right across the west lane, the wooden bridge the only way over it
chasm(c, { rect: [0, 7, 6, 8], kind: 'scenery', note: 'the gorge, west of the bridge' });
chasm(c, { rect: [9, 7, 9, 12], kind: 'scenery', note: 'the gorge, east of the bridge, bending south down the Greyspine\'s west foot' });
c.fill(7, 7, 8, 8, H12, 'b');                 // THE GORGE BRIDGE: two planks wide, two long, at the lip height
// the tarn footbridge: plank decks over the water from the 8h shelf to the gorge lip (the far-west file)
catwalk(c, { from: [2, 13], to: [2, 9], w: 1, h: H8, style: 'wood', choke: false,
  note: 'the tarn footbridge: a plank walk over the black water, the far-west file' });

// =====================================================================================
// 3. The Greyspine -- the bare-rock massif that splits the pass.
// =====================================================================================
c.fill(10, 6, 13, 12, CRAG, 'r');
// Its crown, stepped 2h at a time so the summit is a shaped peak and not a flat box lid.
for (const [x, z, h] of [[11, 7, 22], [12, 7, 22], [10, 8, 22], [12, 8, 22], [10, 9, 22], [12, 10, 24],
  [11, 8, 24], [11, 9, 24], [12, 9, 24], [11, 10, 22], [12, 11, 22], [10, 12, 18]]) c.put(x, z, h, null);
c.fill(10, 10, 11, 11, null, 'k'); c.put(12, 7, null, 'k'); c.put(10, 7, null, 'k');   // turf pockets
c.fill(10, 12, 12, 12, 18, 'k');              // a pine ledge on its south face, so the front is not one sheer slab
c.fill(10, 14, 13, 14, H6, 'r');              // the scree fan at its foot
// The Greyspine is walled in void on three sides: its summit is a perch reached ONLY from the col
// (one 4h step off the col's south lip), never a third lane and never an undeclared face.
chasm(c, { rect: [10, 13, 13, 13], kind: 'scenery', note: 'the crevasse at the Greyspine\'s south foot' });
chasm(c, { rect: [13, 6, 13, 12], kind: 'scenery', note: 'the crevasse between the Greyspine and the cairn stair' });

// =====================================================================================
// 4. The east lane -- the cairn stair and the shoulder.
// =====================================================================================
c.fill(14, 5, 17, 5, COL, 'r');
c.fill(14, 6, 21, 9, SHELF, 'r');             // the cairn shoulder
c.fill(17, 6, 20, 7, SHELF, 'k');             // a turf pocket in it
c.fill(16, 10, 21, 13, COL, 'k');             // the pine shelf east of the stair, 2h over the shoulder
c.fill(17, 14, 21, 14, H12, 'r');             // its scree apron
chasm(c, { rect: [16, 11, 16, 14], kind: 'scenery', note: 'the cleft east of the cairn stair' });
chasm(c, { rect: [17, 14, 17, 14], kind: 'scenery', note: 'the cleft mouth' });
// THE CAIRN STAIR: 6 -> 8 -> 10 -> 12 -> 14h, two wide, walled by the Greyspine and the pine shelf.
c.fill(14, 14, 15, 14, H6, 's');
c.fill(14, 13, 15, 13, H8, 's');
c.fill(14, 12, 15, 12, H10, 's');
c.fill(14, 11, 15, 11, H12, 's');
c.fill(14, 10, 15, 10, SHELF, 's');

// =====================================================================================
// 5. The road camp in the south, and the scree either side of it.
// =====================================================================================
c.fill(0, 15, 21, 19, ROAD, 'r');
c.fill(3, 15, 17, 17, ROAD, 'g');             // the camp meadow -- the last grass below the pass
c.fill(0, 15, 2, 19, H6, 'k');                // the west knoll, pines
c.fill(0, 17, 1, 19, H8, 'k');
c.fill(18, 15, 21, 16, H8, 'r');              // the east scree
c.fill(18, 17, 21, 19, H6, 'r');

// Roads, painted last so no fill can wipe them.
c.fill(10, 17, 11, 19, null, 'd');            // the road up from the south
c.line(4, 16, 17, 16, null, 'd');             // the camp road
c.fill(7, 13, 8, 15, null, 'd'); c.fill(7, 9, 8, 12, null, 'd');       // the toll road
c.fill(7, 5, 8, 6, null, 'd'); c.fill(7, 2, 14, 4, null, 'd');         // the waystation and the col
c.fill(14, 15, 15, 15, null, 'd'); c.fill(14, 5, 15, 9, null, 'd');     // the stair foot and the shoulder path
c.fill(9, 2, 12, 3, null, 's');               // the flagged saddle B stands on

// Void bites, so the diorama has an outline instead of a border. None beside the tarn.
for (const r of [[0, 19, 0, 19], [21, 0, 21, 1], [0, 0, 0, 0], [21, 18, 21, 19], [16, 19, 17, 19],
  [5, 19, 6, 19], [21, 10, 21, 11], [9, 0, 10, 0], [14, 0, 14, 0], [0, 14, 0, 14]])
  chasm(c, { rect: r, kind: 'scenery', note: 'bite in the diorama outline' });

// =====================================================================================
// 6. The walking rows. Protected BEFORE a single prop is placed.
// =====================================================================================
c.protectRect(4, 16, 17, 16); c.protectRect(7, 15, 15, 15); c.protectRect(9, 17, 12, 17); // the camp
c.protectRect(7, 9, 8, 14); c.protectRect(7, 5, 8, 8);          // the toll road and the bridge
c.protectRect(2, 9, 2, 13); c.protectRect(2, 9, 6, 9);          // the footbridge file
c.protectRect(6, 2, 15, 4); c.protectRect(4, 3, 17, 3);          // the col
c.protectRect(14, 5, 15, 15);                                   // the cairn stair and the shoulder path

// =====================================================================================
// 7. Props.
// =====================================================================================
const P = (o) => {
  const p = c.prop(o);
  if (PROP_SPEC[p.type].coord !== 'edgeFree') {
    const [ax, az] = [Math.floor(p.x), Math.floor(p.z)];
    if (!c.walkAt(ax, az)) throw new Error(`greyspine_pass: ${p.type} at ${p.x},${p.z} stands on ${c.tAt(ax, az)} at ${ax},${az}`);
  }
  for (const [x, z] of footprint(p)) {
    if (!c.walkAt(x, z)) throw new Error(`greyspine_pass: ${p.type} at ${p.x},${p.z} stands on ${c.tAt(x, z)} at ${x},${z}`);
    if (c.isProtected(x, z)) throw new Error(`greyspine_pass: ${p.type} at ${p.x},${p.z} closes route tile ${x},${z}`);
  }
  return p;
};
const at = (type, list, extra = {}) => { for (const [x, z] of list) P({ type, x: x + 0.5, z: z + 0.5, ...extra }); };

// Rocks are cairns and spill, not confetti: the bare-rock surface already reads as scree, so a
// billboard boulder goes only where it marks something (a cairn, a lip, the foot of a face).
// --- the col: a cairn line along the rim and the lone signpost at the saddle ---
P({ type: 'signpost', x: 13.5, z: 1.5 });
at('rock', [[4, 1], [17, 1]]);
at('rock_small', [[15, 1], [6, 1]]);
at('pine', [[5, 1], [19, 4], [21, 5], [16, 1]]);
at('bush', [[8, 1], [20, 4], [11, 1]]);
// --- the crags: wind-bent pines on the high rock ---
at('rock', [[3, 3], [19, 2]]); at('pine', [[3, 1], [0, 3], [21, 2], [20, 0]]);

// --- the waystation: a ruined toll-house and watch tower on the 14h shelf, the gate on the bridge head ---
P({ type: 'tower', x: 0, z: 5, w: 2, d: 2, th: 3.2 });
P({ type: 'ruin', x: 3, z: 5, len: 3, dir: 'x', th: 1.4 });
P({ type: 'wall', x: 2, z: 5, len: 2, dir: 'z', h: SHELF, in: 1 });   // the toll-house's broken west course
P({ type: 'gate', x: 7.5, z: 6.5, rot: 0 });
P({ type: 'pillar', x: 9.5, z: 6.5, h: 1.2 }); P({ type: 'pillar', x: 6.5, z: 5.5, h: 0.8 });
P({ type: 'wall', x: 0, z: 7, len: 7, dir: 'x', h: SHELF, in: -1 });   // the parapet over the gorge
P({ type: 'lamp', x: 6.5, z: 6.5 });
at('barrel', [[5, 6]]); at('crate', [[4, 6]]); at('woodpile', [[9, 5]]);

// --- the gorge bridge: rails, and the dark arch under the planks ---
P({ type: 'rail', x: 7, z: 7, len: 2, dir: 'z', h: H12 });
P({ type: 'rail', x: 9, z: 7, len: 2, dir: 'z', h: H12 });
P({ type: 'arch', x: 9, z: 8, h: 8, r: 0.72, dir: 'x' });

// --- the tarn shelf: pines on the dark turf round the black water ---
at('pine', [[0, 10], [4, 11], [5, 12], [0, 12], [6, 10], [9, 13], [4, 13]]);
at('rock', [[5, 10], [0, 9]]);
at('bush', [[3, 13], [6, 12], [1, 13]]);
P({ type: 'wall', x: 0, z: 9, len: 2, dir: 'x', h: H12, in: 1 });
P({ type: 'wall', x: 3, z: 9, len: 4, dir: 'x', h: H12, in: 1 });
P({ type: 'stairs', x: 7, z: 9, dir: 'n' }); P({ type: 'stairs', x: 8, z: 9, dir: 'n' });
P({ type: 'stairs', x: 7, z: 13, dir: 'n' }); P({ type: 'stairs', x: 8, z: 13, dir: 'n' });
at('pine', [[0, 13], [6, 14], [1, 14]]);

// --- the Greyspine: bare rock, stunted pines in its turf pockets ---
at('pine', [[10, 10], [12, 11], [10, 12], [12, 12]]);
at('rock', [[11, 6]]); at('rock_small', [[11, 12]]);
at('bush', [[10, 11]]);
at('rock', [[10, 14], [13, 14]]);

// --- the cairn stair: treads, and the shoulder cairns ---
for (let z = 10; z <= 13; z++) { P({ type: 'stairs', x: 14, z, dir: 'n' }); P({ type: 'stairs', x: 15, z, dir: 'n' }); }
at('rock', [[16, 6], [19, 8]]); at('rock_small', [[16, 9]]);
at('pine', [[18, 6], [20, 6], [21, 8]]);
at('grave', [[17, 7]]);                                       // a traveller's marker
at('bush', [[19, 7]]);
// --- the pine shelf east of the stair ---
at('pine', [[17, 10], [19, 10], [18, 12], [20, 12], [19, 14]]);
at('rock', [[17, 12]]); at('bush', [[18, 13], [20, 11]]);

// --- the road camp: the company's gear, the road signpost, the last pines below the pass ---
P({ type: 'cart', x: 5.5, z: 17.5, rot: 0 }); at('crate', [[3, 17]]); at('barrel', [[4, 18]]);
P({ type: 'woodpile', x: 13.5, z: 18.5 }); at('hay', [[15, 18]]); at('barrel', [[12, 18]]);
P({ type: 'lamp', x: 8.5, z: 17.5 }); P({ type: 'lamp', x: 13.5, z: 17.5 });
P({ type: 'signpost', x: 9.5, z: 18.5 });
at('rock', [[3, 15], [17, 15], [7, 19]]);
at('rock_small', [[16, 17]]);
at('bush', [[6, 18], [14, 17], [18, 18], [4, 15]]);
at('pine', [[0, 16], [1, 18], [2, 15], [20, 17], [21, 15], [19, 19]]);
at('rock', [[19, 15]]);

// =====================================================================================
// 8. Spawns and declarations.
// =====================================================================================
// R18 (review17 P2/P8, gameplay): spaced seats -- no two allies side by side or on a diagonal -- and the lines
// moved toward each other (mean walk A->B about 13 steps, first contact by round 2). Was A [[9, 16], [10, 16], [11, 16], [12, 16], [13, 16]], B [[9, 2], [10, 2], [11, 2], [12, 2], [10, 3]].
c.seat('A', [[10, 15], [12, 15], [14, 17], [14, 15], [16, 15]]);   // the road camp below the pass
c.seat('B', [[9, 2], [10, 4], [12, 3], [14, 3], [12, 5]]);         // the flagged saddle of the col

c.declareRegion({ kind: 'staging', rect: [9, 16, 13, 16], note: 'A: the road camp below the pass' });
c.declareRegion({ kind: 'staging', rect: [9, 2, 12, 3], note: 'B: the col' });
c.declareRegion({ kind: 'road', rect: [7, 7, 8, 8], note: 'the gorge bridge, planks at 12h' });
c.declareRoute({ rid: 'toll_road', tier: 4, from: 'A', to: 'B', via: [],
  note: 'the switchback shelves -> the gorge bridge -> the toll-gate -> the col' });
c.declareRoute({ rid: 'cairn_stair', tier: 4, from: 'A', to: 'B', via: [],
  note: 'the cairn stair up the shoulder -> the col east end' });

export const DEF = c.toDef();
