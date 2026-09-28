// "The Hollow Crown" -- a 22x22 cathedral close on the summit of the royal capital, at sunset, under
// the Great Bell. The Chapter II finale: the Chancellor and the bell-bound colossus wait on the porch.
//
// THE SHAPE. Four stone terraces climb north from the city gate, each 6h above the last, so every
// terrace lip is a real wall for the JUMP-2 majority and height is something you TAKE:
//   THE GATE COURT   4h   z17-21  A musters inside the city gate
//   THE LOWER CLOSE 10h   z12-16  the cloister garth (west), the close proper, the loggia foot (east)
//   THE UPPER CLOSE 16h   z7-11   the chapter garden, the colonnade, the chapter houses
//   THE PORCH       22h   z2-6    the cathedral porch and its 24h dais: B's ground; the west front at 24h
// Three ways up, each built of 2h treads so every walking step is <= 4h:
//   THE PROCESSIONAL  x9-12, three flights of two treads straight up the axis of the Great Bell.
//   THE CLOISTER WAY  (west) the almonry flight x5-6 into the garth, the garth stair and the west
//                     porch stair x6-7: a separate lane three tiles off the axis, landing on the porch
//                     beside the dais.
//   THE LOGGIA RAMP   (east) a walled ramp x16-17 rising 2h a row from the gate court to the porch's
//                     east wing, cut off from the terraces by void light-wells either side.
//
// WHY THE LIPS ARE LINED WITH BUILDINGS. The analyser (tools/mapcheck) treats every WALKABLE pair more
// than 4h apart as an undeclared express face. A cathedral close does not want forty little vaults, so
// the foot of every retaining wall carries blocking masonry -- the chapter houses, the almonry, the
// cloister arcade (pillar + tree), the pilasters of the porch colonnade -- and the only walkable edges
// across a lip are the treads. That is also what makes the three lanes real lanes.
//
// Surface legend: g grass, k dark turf, d dirt (worn flags), s stone flags, w water, v VOID.
import { canvas } from '../canvas.js';
import { chasm } from '../primitives/chasm.js';
import { footprint, PROP_SPEC } from '../mapformat/propspec.js';

const GATE = 4, LOW = 10, UP = 16, PORCH = 22, DAIS = 24, FRONT = 24;

const c = canvas({ mood: 'dusk',
  w: 22, d: 22, h: GATE, t: 's', seed: 2207,
  id: 'hollow_crown', name: 'The Hollow Crown', baseTier: 4, tiers: [4],
  blurb: 'The cathedral close under the Great Bell. Three terraces, three ways up, and the Crown waiting on the porch.',
  notes: 'The Processional climbs the middle (three flights of 2h treads); the Cloister Way climbs the west garth ' +
    'three tiles off the axis; the Loggia Ramp climbs the east flank 2h a row onto the porch wing beside B.',
});

// =====================================================================================
// 1. The terraces, painted as full-width bands; the lanes are cut into them afterwards.
// =====================================================================================
c.fill(0, 0, 21, 1, FRONT, 's');       // the west front the cathedral stands on
c.fill(0, 2, 21, 6, PORCH, 's');       // the porch
c.fill(0, 7, 21, 11, UP, 's');         // the upper close
c.fill(0, 12, 21, 16, LOW, 's');       // the lower close
c.fill(0, 17, 21, 21, GATE, 's');      // the gate court

c.fill(0, 12, 7, 16, LOW, 'g');        // the cloister garth
c.fill(3, 14, 4, 14, LOW - 2, 'w');    // the garth pool, 2h below its kerb
c.fill(0, 7, 4, 11, UP, 'k');          // the chapter garden
c.fill(18, 13, 21, 16, LOW, 'k');      // the sexton's yard behind the loggia

// The dais before the west door: 2h over the porch, broad enough for the colossus.
c.fill(8, 2, 13, 4, DAIS, 's');

// =====================================================================================
// 2. The three lanes. Each flight is two 2h treads laid into a 6h lip.
// =====================================================================================
const flight = (x0, x1, zLow, hLow) => {   // treads at zLow (hLow+2) and zLow-1 (hLow+4), climbing north
  c.fill(x0, zLow, x1, zLow, hLow + 2, 's');
  c.fill(x0, zLow - 1, x1, zLow - 1, hLow + 4, 's');
  for (let x = x0; x <= x1; x++) { c.protect(x, zLow); c.protect(x, zLow - 1); }
};
// THE PROCESSIONAL -- four wide, straight up the axis of the Great Bell.
flight(9, 12, 17, GATE); flight(9, 12, 12, LOW); flight(9, 12, 7, UP);
// THE CLOISTER WAY -- the almonry flight (x5-6), the garth stair and the west porch stair (x6-7).
flight(5, 6, 17, GATE); flight(6, 7, 12, LOW); flight(6, 7, 7, UP);
// THE LOGGIA RAMP -- x16-17, 2h a row from the gate court (z17 = 6h) to the porch wing (z9 = 22h).
for (let z = 17, h = GATE + 2; z >= 9; z--, h += 2) { c.fill(16, z, 17, z, h, 's'); c.protect(16, z); c.protect(17, z); }
c.fill(16, 2, 21, 8, PORCH, 's');      // the east porch wing the ramp lands on
c.fill(19, 9, 21, 11, PORCH, 's');     // and the bell-ringers' bastion over the sexton's yard
// The loggia's light-wells: void either side of the ramp, so it is entered at its foot and left at its
// head, and nowhere does a ramp tile sit 6h over a terrace it could be vaulted from.
chasm(c, { rect: [15, 12, 15, 16], kind: 'scenery', note: 'the loggia light-well west of the ramp (lower close)' });
chasm(c, { rect: [15, 9, 15, 10], kind: 'scenery', note: 'the loggia light-well west of the ramp (upper close)' });
chasm(c, { rect: [18, 9, 18, 13], kind: 'scenery', note: 'the east light-well under the porch wing' });
chasm(c, { rect: [19, 12, 21, 12], kind: 'scenery', note: 'the drop from the bastion to the sexton\'s yard' });

// =====================================================================================
// 3. The outline: the close stands on the summit, so the rim drops straight to the city.
// =====================================================================================
for (const r of [[0, 0, 2, 0], [19, 0, 21, 0], [0, 21, 1, 21], [20, 21, 21, 21], [0, 20, 0, 20],
  [21, 18, 21, 19], [0, 9, 0, 10], [21, 5, 21, 6], [21, 14, 21, 15], [0, 16, 0, 17], [7, 21, 7, 21], [14, 21, 15, 21]])
  chasm(c, { rect: r, kind: 'scenery', note: 'rim bite: the parapet over the city' });

// Lawns and planted beds, so the stone reads as a close and not a quarry. Painted round the rim bites.
const paint = (x0, z0, x1, z1, t) => { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (c.tAt(x, z) !== 'v') c.put(x, z, null, t); };
paint(13, 9, 14, 11, 'g');      // the dean's lawn on the upper close
paint(0, 18, 3, 21, 'g');       // the almonry garden inside the gate
paint(18, 18, 21, 21, 'k');     // the lodge garden
paint(0, 2, 2, 6, 'k'); paint(19, 2, 21, 4, 'k');   // the porch's planted corners
paint(19, 9, 21, 11, 'k');      // the bastion garden

// Walking rows, protected before a single prop goes down.
c.protectRect(9, 17, 12, 21); c.protectRect(9, 13, 12, 16); c.protectRect(9, 8, 12, 11); c.protectRect(9, 2, 12, 6);
c.protectRect(5, 18, 16, 20);                                           // the gate court cross-walk
c.protectRect(5, 13, 7, 15);                                            // the garth walk
c.protectRect(6, 8, 7, 10); c.protectRect(6, 5, 8, 6);                  // the chapter garden walk and porch stair head
c.protectRect(16, 5, 17, 18); c.protectRect(13, 5, 15, 6);              // ramp and its head

// =====================================================================================
// 4. Props.
// =====================================================================================
const P = (o) => {
  const p = c.prop(o);
  if (PROP_SPEC[p.type].coord !== 'edgeFree') {
    const [ax, az] = [Math.floor(p.x), Math.floor(p.z)];
    if (!c.walkAt(ax, az)) throw new Error(`hollow_crown: ${p.type} at ${p.x},${p.z} stands on ${c.tAt(ax, az)}`);
  }
  const fp = footprint(p);
  const hs = new Set(fp.map(([x, z]) => c.hAt(x, z)));
  if (hs.size > 1) throw new Error(`hollow_crown: ${p.type} at ${p.x},${p.z} straddles heights ${[...hs]}`);
  for (const [x, z] of fp) {
    if (!c.walkAt(x, z)) throw new Error(`hollow_crown: ${p.type} at ${p.x},${p.z} stands on ${c.tAt(x, z)} at ${x},${z}`);
    if (c.isProtected(x, z)) throw new Error(`hollow_crown: ${p.type} at ${p.x},${p.z} closes route tile ${x},${z}`);
  }
  return p;
};
const at = (type, list, extra = {}) => { for (const [x, z] of list) P({ type, x: x + 0.5, z: z + 0.5, ...extra }); };

// --- treads: every flight carries its stairs (lower tread, upper tread and the landing lip), and so
//     does every ramp tile, so the three lanes read at a glance ---
const treads = (xs, zLow) => { for (const x of xs) for (const z of [zLow, zLow - 1, zLow - 2]) P({ type: 'stairs', x, z, dir: 'n' }); };
treads([9, 10, 11, 12], 17); treads([9, 10, 11, 12], 12); treads([9, 10, 11, 12], 7);
treads([5, 6], 17); treads([6, 7], 12); treads([6, 7], 7);
for (let z = 9; z <= 17; z++) for (const x of [16, 17]) P({ type: 'stairs', x, z, dir: 'n' });
for (const x of [9, 10, 11, 12]) P({ type: 'stairs', x, z: 4, dir: 'n' });   // the dais step

// --- the west front: the Great Bell tower on the axis, flanking towers, the nave houses ---
P({ type: 'tower', x: 9, z: 0, w: 4, d: 2, th: 6.5 });                 // THE GREAT BELL
P({ type: 'tower', x: 5, z: 0, w: 2, d: 2, th: 4.4 });
P({ type: 'tower', x: 15, z: 0, w: 2, d: 2, th: 4.4 });
P({ type: 'house', x: 3, z: 0, w: 2, d: 2, rot: 0, storeys: 2, style: 'stone', roof: 'slate', gable: 'stone' });
P({ type: 'house', x: 17, z: 0, w: 2, d: 2, rot: 0, storeys: 2, style: 'stone', roof: 'slate', gable: 'stone' });
P({ type: 'house', x: 7, z: 0, w: 2, d: 1, rot: 0, storeys: 1, style: 'stone', roof: 'slate' });
P({ type: 'house', x: 13, z: 0, w: 2, d: 1, rot: 0, storeys: 1, style: 'stone', roof: 'slate' });
P({ type: 'arch', x: 11, z: 2, h: FRONT, r: 1.1, dir: 'x' });          // the west door under the bell

// --- the porch: a colonnade either side of the dais, lamps at the dais corners ---
at('pillar', [[1, 3], [3, 3], [5, 3], [15, 3], [18, 3], [20, 3]], { h: 2.2 });
at('pillar', [[7, 2], [14, 2]], { h: 2.6 });
at('lamp', [[8, 4], [13, 4]]);
P({ type: 'wall', x: 8, z: 5, len: 1, dir: 'x', h: DAIS });
P({ type: 'wall', x: 13, z: 5, len: 1, dir: 'x', h: DAIS });
at('grave', [[2, 2], [19, 2]]);
at('barrel', [[1, 5]]); at('crate', [[20, 5]]);
at('flowers', [[4, 5], [2, 4], [17, 5], [19, 4], [0, 2], [21, 3]]);

// --- the upper close: pilasters and chapter houses at the foot of the porch wall ---
P({ type: 'house', x: 0, z: 7, w: 3, d: 1, rot: 0, storeys: 2, style: 'stone', roof: 'slate', gable: 'stone', chimney: 'left' });
at('pillar', [[3, 7], [4, 7], [5, 7], [8, 7], [13, 7]], { h: 1.5 });
P({ type: 'house', x: 14, z: 7, w: 2, d: 2, rot: 3, storeys: 2, style: 'stone', roof: 'slate', gable: 'stone', chimney: 'right' });
at('well', [[2, 9]]);
at('grave', [[3, 10], [4, 11]]);
at('tree', [[4, 9], [0, 11]]); at('bush', [[2, 11], [8, 11], [13, 11]]);
at('flowers', [[3, 8], [1, 10], [5, 9], [14, 10], [8, 9]]);
at('lamp', [[8, 8], [13, 9]]);
at('barrel', [[20, 9]]); at('crate', [[21, 10]]); at('hay', [[19, 11]]);
P({ type: 'rail', x: 19, z: 12, len: 3, dir: 'x', h: PORCH, in: -1 });   // the bastion parapet

// --- the cloister garth: the arcade under the upper close wall, graves, the pool ---
at('pillar', [[1, 12], [3, 12], [5, 12], [8, 12]], { h: 1.5 });
at('oak', [[0, 12], [4, 12]]); at('pine', [[2, 12]]);
P({ type: 'house', x: 13, z: 12, w: 2, d: 1, rot: 0, storeys: 1, style: 'stone', roof: 'slate', chimney: 'left' });
at('grave', [[1, 15], [2, 13], [1, 13]]);
at('tree', [[7, 16], [0, 14]]); at('bush', [[4, 15], [2, 16], [8, 13]]);
at('flowers', [[3, 15], [4, 13], [5, 14], [3, 16], [0, 15], [7, 14]]);
P({ type: 'rail', x: 3, z: 14, len: 2, dir: 'x', h: LOW });              // the pool kerb
P({ type: 'rail', x: 3, z: 15, len: 2, dir: 'x', h: LOW, in: -1 });
at('lamp', [[8, 16], [13, 16]]);
at('barrel', [[14, 13]]); at('crate', [[13, 15]]);

// --- the loggia and the sexton's yard ---
P({ type: 'arch', x: 16, z: 14.5, h: LOW, r: 0.7, dir: 'z' });
P({ type: 'house', x: 19, z: 13, w: 2, d: 1, rot: 0, storeys: 1, style: 'stone', roof: 'slate', chimney: 'right' });
at('woodpile', [[21, 13]]); at('cart', [[19, 16]], { rot: 1 }); at('hay', [[18, 16]]);
at('bush', [[18, 14]]); at('flowers', [[19, 15], [21, 16]]);

// --- the gate court: the almonry and the lodge under the lower close wall, the city gate ---
P({ type: 'house', x: 1, z: 17, w: 3, d: 1, rot: 0, storeys: 2, style: 'stone', roof: 'slate', chimney: 'left' });
at('well', [[4, 17]]); at('barrel', [[7, 17]]); at('lamp', [[8, 17], [13, 17]]);
at('stall', [[14, 17]], { rot: 0 }); at('crate', [[15, 17]]);
P({ type: 'house', x: 18, z: 17, w: 3, d: 1, rot: 0, storeys: 2, style: 'timber', roof: 'slate', chimney: 'right' });
at('hay', [[21, 17]]);
P({ type: 'gate', x: 10.5, z: 21.5, rot: 0, roof: 'slate' });
at('stall', [[2, 19]], { rot: 1 }); at('stall', [[19, 19]], { rot: 3 });
at('cart', [[18, 21]], { rot: 0 });
at('barrel', [[1, 18], [20, 18]]); at('crate', [[2, 18]]); at('hay', [[17, 21]]);
at('lamp', [[4, 21], [16, 21]]); at('signpost', [[8, 21]]);
at('tree', [[1, 19], [20, 20]]); at('bush', [[3, 20], [13, 21], [4, 19]]);
at('flowers', [[2, 20], [18, 19], [6, 21], [15, 19], [17, 19], [3, 21], [12, 21]]);

// --- the parapet over the city, and the planted corners of the porch and the close ---
P({ type: 'rail', x: 0, z: 2, len: 5, dir: 'z', h: PORCH });
P({ type: 'rail', x: 22, z: 7, len: 2, dir: 'z', h: PORCH, in: -1 });
P({ type: 'rail', x: 22, z: 9, len: 3, dir: 'z', h: PORCH, in: -1 });
P({ type: 'rail', x: 0, z: 11, len: 1, dir: 'z', h: UP });
P({ type: 'rail', x: 0, z: 12, len: 4, dir: 'z', h: LOW });
P({ type: 'rail', x: 2, z: 22, len: 5, dir: 'x', h: GATE, in: -1 });
P({ type: 'rail', x: 8, z: 22, len: 2, dir: 'x', h: GATE, in: -1 });
P({ type: 'rail', x: 12, z: 22, len: 2, dir: 'x', h: GATE, in: -1 });
P({ type: 'rail', x: 16, z: 22, len: 4, dir: 'x', h: GATE, in: -1 });
at('tree', [[0, 4], [21, 2], [20, 10], [14, 10]]);
at('pillar', [[18, 8]], { h: 2.2 });   // the ramp head's gate pier
at('bush', [[0, 6], [2, 5], [21, 4], [19, 3], [13, 10], [21, 9]]);
at('flowers', [[1, 6], [20, 2], [13, 9], [20, 11], [6, 4], [15, 5], [18, 6], [3, 6]]);

// =====================================================================================
// 5. Spawns and the contract. A inside the city gate; B on the dais before the west door
//    (seat 0 central with open tiles all round, for the colossus).
// =====================================================================================
c.seat('A', [[10, 19], [11, 19], [9, 19], [12, 19], [10, 20]]);
c.seat('B', [[10, 3], [11, 4], [9, 4], [12, 3], [11, 5]]);

c.declareRegion({ kind: 'staging', rect: [9, 19, 12, 20], note: 'A: inside the city gate at the foot of the Processional' });
c.declareRegion({ kind: 'staging', rect: [9, 3, 12, 5], note: 'B: the dais before the west door' });
c.declareRoute({ rid: 'processional', tier: 4, from: 'A', to: 'B', via: [[11, 12]],
  note: 'the Processional: three flights straight up the axis of the Great Bell' });

export const DEF = c.toDef();
