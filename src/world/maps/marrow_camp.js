// "Marrow Camp" -- an 18x22 night camp on the open flats, two nights out from Hollin (story node b2, Marrow Flats:
// "Night camp on the open flats. Something is hunting the company." / "They want the cart. Circle it and hold.").
//
// THE SHAPE. Open ground, deliberately low: the whole fight is on a 4h plain with nothing above 12h, every step 2h, so
// there is no face to declare and nowhere to hide from the hounds. What height there is frames the camp:
//   THE CAMP       6h  x6-12 z14-19  a trodden rise: the company's wagon in the middle, tents and the cook fire round it
//   THE FLATS      4h                 open grass and dark turf, the road north the company came down
//   THE TOR        6-12h (NW)          a granite knuckle with a broken ring of standing stones: the deserters' archer post
//   THE HUMMOCK    6-8h (NE)           a pine hummock where the pack lies up, and the deserters' own fire
//   THE WASH       2h (E)              a dry shingle wash with a black pool in it, 2h under the flats
//   THE WEST RISE  6-8h (W)            a dead-oak bank that screens the camp's left
// A holds the wagon; B comes down from the north edge (the pack in front, the deserters behind, the archer on the tor).
//
// Surface legend: g grass, k dark turf, d dirt, s stone, r bare rock, S shingle, w water, v VOID.
import { canvas } from '../canvas.js';
import { chasm } from '../primitives/chasm.js';
import { footprint, PROP_SPEC } from '../mapformat/propspec.js';

const WASH = 2, FLAT = 4, RISE = 6, HIGH = 8, TOR = 10, CROWN = 12;
const W = 18, D = 22;

const c = canvas({ mood: 'campfire', w: W, d: D, h: FLAT, t: 'g', seed: 0xb2c4,
  id: 'marrow_camp', name: 'Marrow Camp', baseTier: 4, tiers: [4],
  blurb: 'A night camp on the open flats. The wagon in the middle, the fires round it, and the dark full of hounds.',
  notes: 'Open and low by design: every step is 2h, so the hounds come straight in. The camp rise gives the company 2h; ' +
    'the tor gives the deserters\' archer 6-8h over the flats. The wash and the west rise shape two flanks round the camp.',
});

// =====================================================================================
// 1. Terrain.
// =====================================================================================
// the flats: turf mottled into the grass so the plain is not one colour
for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (((x * 7 + z * 13) % 11) < 3) c.put(x, z, null, 'k');
// the tor (NW): concentric 2h rings of bare granite
c.fill(0, 0, 5, 6, RISE, 'k');
c.fill(0, 0, 4, 4, HIGH, 'r'); c.fill(0, 5, 2, 5, HIGH, 'r'); c.put(5, 1, HIGH, 'r'); c.put(4, 4, RISE, 'k');
c.fill(0, 0, 2, 2, TOR, 'r'); c.put(3, 0, TOR, 'r'); c.put(0, 3, TOR, 'r'); c.put(2, 2, HIGH, 'r');
c.fill(0, 0, 1, 0, CROWN, 'r'); c.put(0, 1, CROWN, 'r');
c.put(5, 6, FLAT, 'g'); c.put(0, 6, FLAT, 'k'); c.put(5, 5, FLAT, 'g'); c.put(4, 6, FLAT, 'g');
// the hummock (NE)
c.fill(13, 0, 17, 4, RISE, 'k');
c.fill(15, 0, 17, 2, HIGH, 'k'); c.put(14, 0, HIGH, 'k'); c.put(17, 3, HIGH, 'k'); c.put(15, 2, RISE, 'k');
c.put(13, 0, FLAT, 'g'); c.put(17, 4, FLAT, 'k');
c.put(13, 4, FLAT, 'g');
// the west rise
c.fill(0, 9, 3, 21, RISE, 'k');
c.fill(0, 12, 1, 18, HIGH, 'k'); c.put(2, 14, HIGH, 'k'); c.put(2, 15, HIGH, 'k'); c.put(1, 12, RISE, 'k');
c.put(3, 13, FLAT, 'g'); c.put(3, 19, FLAT, 'g'); c.put(3, 20, FLAT, 'g');
c.put(3, 9, FLAT, 'g'); c.put(3, 21, FLAT, 'g');
// the wash and its pool (E)
c.fill(14, 7, 16, 21, WASH, 'S');
c.fill(15, 10, 16, 12, 0, 'w');
c.put(14, 7, FLAT, 'k'); c.put(16, 21, FLAT, 'k');
c.fill(17, 5, 17, 21, FLAT, 'k');
// the camp rise, trodden bare
c.fill(6, 14, 12, 19, RISE, 'd');
for (const [x, z] of [[6, 14], [12, 14], [6, 19], [12, 19]]) c.put(x, z, FLAT, 'g');   // rounded corners
// the road north the company came down, and the path to the wash
c.line(10, 13, 10, 0, null, 'd'); c.line(9, 13, 9, 7, null, 'd');
c.line(13, 16, 14, 16, null, 'd');
// the outline: ragged rim bites so the plain is an island in the dark, not a ruled rectangle
for (const r of [[17, 21, 17, 21], [16, 21, 16, 21], [0, 21, 0, 21], [17, 0, 17, 0], [8, 21, 9, 21], [17, 12, 17, 13],
  [0, 7, 0, 7], [5, 0, 6, 0], [12, 0, 12, 0], [4, 21, 4, 21]])
  chasm(c, { rect: r, kind: 'scenery', note: 'rim bite: the flats running off into the dark' });

// Walking rows, protected before a single prop goes down.
c.protectRect(9, 0, 10, 13);          // the road
c.protectTiles([[8, 15], [9, 15], [10, 15], [11, 15], [8, 16], [11, 16], [8, 17], [9, 17], [10, 17], [11, 17]]);   // the ring round the wagon
c.protectRect(13, 15, 16, 17);        // the path down to the wash
c.protectRect(6, 7, 13, 12);          // the killing ground in front of the camp

// =====================================================================================
// 2. Props.
// =====================================================================================
const P = (o) => {
  const p = c.prop(o);
  if (PROP_SPEC[p.type].coord !== 'edgeFree') {
    const fp = footprint(p);
    const hs = new Set(fp.map(([x, z]) => c.hAt(x, z)));
    if (hs.size > 1) throw new Error(`marrow_camp: ${p.type} at ${p.x},${p.z} straddles heights ${[...hs]}`);
    for (const [x, z] of fp) {
      if (!c.walkAt(x, z)) throw new Error(`marrow_camp: ${p.type} at ${p.x},${p.z} stands on ${c.tAt(x, z)} at ${x},${z}`);
      if (c.isProtected(x, z)) throw new Error(`marrow_camp: ${p.type} at ${p.x},${p.z} closes route tile ${x},${z}`);
    }
    const [ax, az] = [Math.floor(p.x), Math.floor(p.z)];
    if (!c.walkAt(ax, az)) throw new Error(`marrow_camp: ${p.type} at ${p.x},${p.z} stands on ${c.tAt(ax, az)}`);
  }
  return p;
};
const at = (type, list, extra = {}) => { for (const [x, z] of list) P({ type, x: x + 0.5, z: z + 0.5, ...extra }); };

// --- the camp: the company's wagon, its tents, the cook fire and the baggage ---
P({ type: 'wagon', x: 9, z: 16, w: 2, d: 1, rot: 0, cover: 'canvas' });
P({ type: 'tent', x: 6, z: 17, w: 2, d: 1, rot: 0, style: 'canvas' });
P({ type: 'tent', x: 12, z: 15, w: 1, d: 2, rot: 0, style: 'striped' });
P({ type: 'tent', x: 7, z: 19, w: 2, d: 1, rot: 2, style: 'command' });
P({ type: 'wagon', x: 11, z: 18, w: 1, d: 2, rot: 2, cover: 'none' });
at('campfire', [[7, 15]]);
at('crate', [[6, 16], [12, 17]]); at('barrel', [[10, 19], [9, 18]]); at('hay', [[6, 15]]);
at('woodpile', [[12, 19]]);
// --- the deserters' fire on the hummock, and the pack's lie-up ---
at('campfire', [[14, 3]]);
at('cart', [[16, 3]], { rot: 1 }); at('crate', [[13, 1]]); at('barrel', [[17, 3]]);
at('pine', [[15, 0], [17, 1], [16, 0]]); at('bush', [[14, 1], [13, 3]]);
// --- the tor: a broken ring of standing stones round the crown ---
at('pillar', [[1, 1]], { h: 1.3 }); at('pillar', [[3, 1]], { h: 1.0 }); at('pillar', [[1, 3]], { h: 0.8 }); at('pillar', [[3, 4]], { h: 1.1 });
at('rock', [[0, 2], [4, 0], [5, 5]]); at('rock_small', [[2, 4], [4, 6], [0, 5], [5, 2]]);
at('grave', [[2, 3]]);
// --- the west rise: dead oaks and brush on the bank ---
at('oak', [[0, 10], [1, 14], [0, 19], [2, 12]]); at('pine', [[0, 16]]);
at('bush', [[2, 10], [3, 15], [2, 19], [1, 20], [3, 18]]); at('rock', [[3, 12]]); at('rock_small', [[2, 17]]);
// --- the wash: shingle, rocks, reeds at the pool ---
at('rock', [[14, 9], [16, 14]]); at('rock_small', [[14, 12], [15, 18], [16, 8], [14, 20]]);
at('bush', [[17, 8], [17, 15], [17, 18], [14, 13]]);
// --- the flats: a milestone and a dead tree on the road, brush scattered over the plain ---
at('signpost', [[11, 4]]); at('oak', [[7, 5]]); at('tree', [[12, 9]]);
at('bush', [[5, 8], [13, 11], [4, 13], [7, 2], [12, 6], [5, 11], [8, 20], [13, 20]]);
at('rock_small', [[5, 10], [11, 2], [4, 16], [8, 4]]); at('rock', [[5, 13]]);
at('flowers', [[3, 7], [11, 11], [6, 12], [13, 8], [4, 18]]);

// =====================================================================================
// 3. Spawns, deploy room and the contract. A rings the wagon; B comes down from the north edge: the two hounds in
//    front, the deserter and the camp thief behind them, the deserter archer on the tor.
// =====================================================================================
// R18 (review17 P2/P8, gameplay): spaced seats -- no two allies side by side or on a diagonal -- and the lines
// moved toward each other (mean walk A->B about 13 steps, first contact by round 2). Was A [[9, 15], [10, 15], [8, 16], [11, 16], [10, 17]], B [[10, 3], [12, 5], [8, 2], [11, 1], [3, 3]].
c.seat('A', [[11, 13], [11, 15], [9, 15], [13, 15], [11, 17]]);
c.seat('B', [[10, 3], [12, 3], [9, 0], [11, 1], [8, 2]]);
c.declareRegion({ kind: 'staging', rect: [8, 15, 11, 17], note: 'A: the ring round the wagon' });
c.declareRegion({ kind: 'staging', rect: [8, 1, 12, 5], note: 'B: the north edge of the flats, where the road comes in' });
c.declareRoute({ rid: 'road', tier: 4, from: 'A', to: 'B', via: [[10, 9]], note: 'straight up the road across the open flats' });

export const DEF = c.toDef();
// Deploy room (src/ui/deploy.js reads MAP.deploy.A): the whole trodden ring round the wagon.
DEF['x-'].deploy = { A: [[9, 15], [10, 15], [8, 16], [11, 16], [10, 17], [8, 15], [11, 15], [8, 17], [9, 17]] };
