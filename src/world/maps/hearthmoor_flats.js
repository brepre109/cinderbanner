// "Hearthmoor Flats" — 16x16 of open rolling field, a diagonal river, two bridges, and NOTHING
// ABOVE THE BASE TIER. This map is the NEGATIVE CONTROL of the catalogue, and it is deliberate.
//
// Every other map in src/world/maps declares tiers above 4h and is judged on whether climbing higher
// actually gets a player there sooner. This one declares `tiers: [4]`, `faces: []` and
// `promises: []`, which asserts the opposite and much narrower thing: that the validator TOLERATES a
// map making no verticality claim. `contract.ladder` must not fire when there is no rung above the
// base to compare against, `ladder.flat` must not fire on a one-row ladder, and `analysis` must have
// nothing to refute. The reference project ended up with four maps like this by accident, every one
// of them a vertical map whose faces had quietly stopped mattering; we have exactly one, on purpose,
// and it is the baseline the other six read against.
//
// So the whole board is gentle by construction. Heights step 2h and never more: RIVER 0 water,
// SHORE 2 shingle, BANK 4 the field, TOWN 6 the two low rises, SHOULDER 8 the mill knoll. The
// steepest walkable pair anywhere is 4h — exactly baseTier, the budget 14 of the 32 classes carry —
// so faceScan discovers nothing and there is no face to declare. The river is a single unbroken
// course from the north-west corner to the south-east one, crossed twice: the two-plank catwalk over
// 7..8,7..8 on the ford road (A->B 19, the main route) and the stone mill bridge over 10..13,11..12
// downstream (27, the flank, in at the orchard's back gate). R10 opened the second crossing: one
// bridge made every fight a queue on the planks.
//
// Surface legend: g grass, k dark turf, d dirt road, s stone flags, b wood plank, S sand/shingle,
// w water, v VOID.
import { canvas } from '../canvas.js';
import { catwalk } from '../primitives/catwalk.js';
import { chasm } from '../primitives/chasm.js';
import { footprint, PROP_SPEC } from '../mapformat/propspec.js';

const RIVER = 0, SHORE = 2, BANK = 4, TOWN = 6, SHOULDER = 8;

const c = canvas({ mood: 'morning',
  w: 16, d: 16, h: BANK, t: 'g', seed: 811,
  id: 'hearthmoor_flats', name: 'Hearthmoor Flats', baseTier: 4, tiers: [4],
  blurb: 'Open pasture either side of a slow river. Two bridges, no cliffs, nothing to climb.',
  notes: 'The negative control: tiers [4], no faces, no promises. It exists to prove the validator tolerates a map that claims no verticality.',
});

// =====================================================================================
// 1. The rolling field. Two 2h rises, two 4h knolls, and shallow ground either side of the course.
//    Every neighbouring walkable pair on the board is 4h or less, which is baseTier, so faceScan
//    discovers nothing and there is nothing here to declare.
// =====================================================================================
c.fill(0, 0, 15, 15, BANK, 'g');
c.disc(3, 12, 3, TOWN, 'k');            // the south-west rise, over the near pasture
c.fill(1, 13, 3, 15, SHOULDER, 'k');    // the mill knoll — two 2h steps off the field
c.disc(12, 3, 3, TOWN, 'g');            // the north-east rise, over the orchard
c.fill(12, 0, 14, 1, SHOULDER, 'k');    // the orchard shoulder
c.fill(0, 5, 1, 7, TOWN, 'g');          // the west headland
c.fill(14, 8, 15, 10, TOWN, 'g');       // the east headland

// The river: ONE course, north-west corner to south-east, RIV[z] = [first x, last x] of water in
// row z. It runs straight for two rows at x=7..8 so the bridge can be two planks wide — a one-tile
// crossing is a route three KO'd bodies can cork, and hazard.choke1 says so per tile.
const RIV = [[0, 1], [1, 2], [2, 3], [3, 5], [4, 5], [5, 6], [6, 7], [7, 8],
  [7, 8], [8, 9], [9, 10], [10, 12], [11, 12], [12, 13], [13, 14], [14, 15]];
RIV.forEach(([x0, x1], z) => {
  c.fill(x0, z, x1, z, RIVER, 'w');
  c.put(x0 - 1, z, SHORE, 'S'); c.put(x1 + 1, z, SHORE, 'S');          // the shingle either side
  // A one-tile strand turns a bank into a row-per-row staircase of 2h walls. The strand widens to
  // two on a seeded half of the rows, so the water's edge reads as silt rather than as masonry.
  for (const x of [x0 - 2, x1 + 2]) {
    if (c.hAt(x, z) === null) continue;
    if (c.ri(0, 1)) c.put(x, z, SHORE, 'S'); else if (c.hAt(x, z) > BANK) c.put(x, z, BANK, 'g');
  }
  for (const x of [x0 - 3, x1 + 3]) if (c.hAt(x, z) > BANK) c.put(x, z, BANK, 'g');
});
// Slack water and a couple of spits, so the banks are not two ruled lines. Each of these stays
// inside the shingle band: a TOWN 6 tile beside RIVER 0 water is a 6h bank and a gentleness warning.
c.put(3, 2, RIVER, 'w'); c.put(9, 10, RIVER, 'w'); c.put(13, 15, RIVER, 'w');
c.put(2, 1, SHORE, 'S'); c.put(6, 5, SHORE, 'S'); c.put(11, 10, SHORE, 'S'); c.put(14, 13, SHORE, 'S');

// The ford road and its plank bridge, the direct crossing.
c.disc(6, 12, 2, TOWN, 'k'); c.fill(2, 6, 4, 8, BANK, 'k'); c.fill(11, 8, 13, 9, BANK, 'k');
c.line(3, 14, 6, 9, null, 'd'); c.line(6, 9, 6, 7, null, 'd');
c.line(9, 7, 9, 5, null, 'd'); c.line(9, 5, 12, 2, null, 'd');
// The mill track: off the mill bridge, up the east headland and in at the orchard's back gate.
c.line(14, 11, 14, 5, null, 'd'); c.line(15, 5, 15, 3, null, 'd'); c.put(10, 12, null, 'd'); c.put(9, 13, null, 'd');
const span = catwalk(c, { from: [6, 7], to: [9, 7], h: RIVER, w: 2, style: 'wood', rail: true,
  choke: false, tier: 4, note: 'the plank bridge: the ford road\'s crossing of the Hearthmoor' });
// THE MILL BRIDGE, downstream. A stone span two wide over the bend at 10..13,11..12, carrying the
// mill track from the south pasture to the east headland. It is the flank: a second lane across the
// river of the same length class as the ford road (A->B 19 by the ford, 20 by the mill bridge), so
// a party held at the planks can swing south instead of queueing on one crossing.
const mill = catwalk(c, { from: [9, 11], to: [14, 11], h: RIVER, w: 2, style: 'stone', rail: true,
  choke: false, tier: 4, note: 'the mill bridge: the downstream crossing, the flank to the ford road' });

// Void bites, so the diorama has an outline instead of a border. Never orthogonally adjacent to
// water — the void's earth face would show through the black cap — which on a board whose river
// runs corner to corner keeps every bite in the two DRY quarters.
for (const r of [[15, 0, 15, 1], [14, 0, 14, 0], [0, 14, 1, 15], [0, 13, 0, 13],
  [5, 15, 6, 15], [15, 9, 15, 10], [6, 0, 7, 0], [0, 3, 0, 3]])
  chasm(c, { rect: r, kind: 'scenery', note: 'bite in the diorama outline' });

// =====================================================================================
// 2. The walking rows. Protected before a single prop lands, for the same reason as every other map
//    in this directory: one barrel on the bridge approach and the only crossing is sealed.
// =====================================================================================
c.protectTiles(span.tiles); c.protectTiles(mill.tiles); c.protectRect(9, 11, 9, 12); c.protectRect(14, 5, 14, 12); c.protectRect(15, 3, 15, 5); c.protectRect(6, 7, 9, 8); c.protectRect(6, 9, 6, 12);
c.protectRect(3, 12, 5, 13); c.protect(4, 14); c.protect(4, 15); c.protectRect(9, 3, 9, 7); c.protectRect(10, 2, 14, 3); c.protectRect(13, 1, 14, 1);

// =====================================================================================
// 3. Props. A working river valley: the mill on the south knoll, the farm on the north rise, hay
//    and hurdles on the pasture between, willows and reeds along both banks.
// =====================================================================================
const P = (o) => {
  const p = c.prop(o);
  // Two different questions. EVERY prop must stand on real ground — `bush` and `tree` are
  // walk-through, so footprint() is empty for them and a reed billboard planted in the river would
  // otherwise pass unremarked. Only a BLOCKING footprint may not land on a protected tile.
  if (PROP_SPEC[p.type].coord !== 'edgeFree') {
    const [ax, az] = [Math.floor(p.x), Math.floor(p.z)];
    if (!c.walkAt(ax, az)) throw new Error(`hearthmoor_flats: ${p.type} at ${p.x},${p.z} stands on ${c.tAt(ax, az)} at ${ax},${az}`);
  }
  for (const [x, z] of footprint(p)) {
    if (!c.walkAt(x, z)) throw new Error(`hearthmoor_flats: ${p.type} at ${p.x},${p.z} stands on ${c.tAt(x, z)} at ${x},${z}`);
    if (c.isProtected(x, z)) throw new Error(`hearthmoor_flats: ${p.type} at ${p.x},${p.z} closes route tile ${x},${z}`);
  }
  return p;
};
// --- the mill on the south-west knoll ---
P({ type: 'tower', x: 2, z: 14, w: 2, d: 2, th: 3.0 });
P({ type: 'house', x: 1, z: 13, w: 2, d: 1, rot: 2, storeys: 1, chimney: 'right', style: 'stone', roof: 'slate' });
P({ type: 'house', x: 1, z: 10, w: 2, d: 2, rot: 0, storeys: 2, chimney: 'left', style: 'timber', roof: 'thatch' });
P({ type: 'cart', x: 7.5, z: 15.5, rot: 1 }); P({ type: 'barrel', x: 4.26, z: 10.74 }); P({ type: 'crate', x: 4.72, z: 10.24 });
P({ type: 'woodpile', x: 3.5, z: 10.5 }); P({ type: 'hay', x: 2.5, z: 12.5 }); P({ type: 'trough', x: 5.5, z: 11.5 });
P({ type: 'well', x: 3.5, z: 9.5 }); P({ type: 'fence', x: 6, z: 13, len: 2, dir: 'x' });
P({ type: 'lamp', x: 7.5, z: 12.5 }); P({ type: 'oak', x: 1.5, z: 9.5 }); P({ type: 'oak', x: 0.5, z: 7.5 });
P({ type: 'bush', x: 0.5, z: 12.5 }); P({ type: 'flowers', x: 2.5, z: 11.5 }); P({ type: 'flowers', x: 4.5, z: 14.5 });
P({ type: 'grave', x: 1.5, z: 12.5 }); P({ type: 'pillar', x: 0.5, z: 6.5, h: 1.1 });
// --- the farm on the north-east shoulder ---
P({ type: 'house', x: 12, z: 0, w: 2, d: 1, rot: 0, storeys: 1, chimney: 'left', style: 'timber', roof: 'thatch' });
P({ type: 'house', x: 11, z: 4, w: 2, d: 2, rot: 2, storeys: 2, chimney: 'right', style: 'stone', roof: 'tile', gable: 'stone' });
P({ type: 'house', x: 13, z: 4, w: 2, d: 1, rot: 3, storeys: 1, style: 'timber', barn: true, roof: 'brown' });
P({ type: 'stall', x: 13.5, z: 5.5, rot: 2 }); P({ type: 'cart', x: 15.5, z: 13.5, rot: 0 });
P({ type: 'hay', x: 15.5, z: 2.5 }); P({ type: 'hay', x: 10.24, z: 5.74 }); P({ type: 'crate', x: 10.76, z: 5.28 });
P({ type: 'woodpile', x: 15.5, z: 6.5 }); P({ type: 'trough', x: 10.5, z: 1.5 });
P({ type: 'fence', x: 8, z: 1, len: 2, dir: 'x' }); P({ type: 'well', x: 13.5, z: 5.5 });
P({ type: 'signpost', x: 7.5, z: 2.5 }); P({ type: 'lamp', x: 12.5, z: 6.5 });
P({ type: 'oak', x: 15.5, z: 7.5 }); P({ type: 'oak', x: 11.5, z: 8.5 }); P({ type: 'pine', x: 15.5, z: 8.5 });
P({ type: 'bush', x: 13.5, z: 8.5 }); P({ type: 'flowers', x: 10.5, z: 3.5 }); P({ type: 'flowers', x: 12.5, z: 2.5 });
P({ type: 'pillar', x: 8.5, z: 2.5, h: 1.3 }); P({ type: 'grave', x: 7.5, z: 3.5 });
// --- the crossing and the two banks ---
P({ type: 'lamp', x: 5.5, z: 7.5 }); P({ type: 'signpost', x: 10.5, z: 7.5 });
P({ type: 'gate', x: 6.5, z: 10.5, rot: 0 });
P({ type: 'rock', x: 2.5, z: 5.5 }); P({ type: 'rock', x: 8.5, z: 12.5 }); P({ type: 'rock_small', x: 7.5, z: 4.5 });
P({ type: 'rock_small', x: 12.5, z: 9.5 }); P({ type: 'bush', x: 8.5, z: 5.5 }); P({ type: 'bush', x: 8.5, z: 10.5 });
P({ type: 'bush', x: 2.5, z: 6.5 }); P({ type: 'bush', x: 12.5, z: 14.5 });
P({ type: 'oak', x: 3.5, z: 7.5 }); P({ type: 'oak', x: 9.5, z: 15.5 }); P({ type: 'pine', x: 5.5, z: 1.5 });
P({ type: 'pine', x: 15.5, z: 12.5 }); P({ type: 'hay', x: 7.5, z: 11.5 }); P({ type: 'woodpile', x: 11.5, z: 14.5 });
P({ type: 'flowers', x: 5.5, z: 8.5 }); P({ type: 'flowers', x: 10.5, z: 9.5 }); P({ type: 'flowers', x: 7.5, z: 9.5 });
P({ type: 'flowers', x: 2.5, z: 3.5 }); P({ type: 'flowers', x: 14.5, z: 11.5 }); P({ type: 'flowers', x: 6.5, z: 13.5 });
// bush and tree are the two sprite types mapdata.js does NOT block, so the reeds and willows dress
// both banks without closing a tile of the approach to the one bridge.
for (const [x, z] of [[2, 3], [8, 6], [5, 9], [8, 12], [11, 14], [1, 2], [10, 6], [10, 13], [6, 4], [9, 13]])
  P({ type: 'bush', x: x + 0.5, z: z + 0.5 });
for (const [x, z] of [[3, 8], [12, 7], [7, 12], [14, 6], [2, 11], [9, 3]]) P({ type: 'tree', x: x + 0.5, z: z + 0.5 });
// =====================================================================================
// 4. Spawns and the (deliberately thin) design contract. tiers [4] means the ladder is ONE row, so
//    contract.ladder has nothing to compare and ladder.flat has nothing to call flat. The only
//    machine-checked claim on this map is that the ford road is the shortest crossing.
// =====================================================================================
// R18 (review17 P2/P8, gameplay): spaced seats -- no two allies side by side or on a diagonal -- and the lines
// moved toward each other (mean walk A->B about 13 steps, first contact by round 2). Was A [[3, 12], [4, 12], [5, 12], [4, 13], [5, 13]], B [[12, 2], [13, 2], [14, 2], [13, 1], [14, 1]].
c.seat('A', [[4, 12], [6, 12], [6, 10], [5, 14], [8, 13]]);        // the south-west pasture
c.seat('B', [[11, 2], [10, 4], [13, 3], [9, 2], [11, 0]]);        // the north-east orchard
c.declareRegion({ kind: 'road', rect: [5, 6, 10, 8], note: 'the ford road and its two approaches' });
c.declareRoute({ rid: 'the_ford', tier: 4, from: 'A', to: 'B', via: [[7, 7]],
  note: 'south-west pasture -> the plank bridge -> north-east orchard; the mill bridge downstream is the flank' });

export const DEF = c.toDef();
