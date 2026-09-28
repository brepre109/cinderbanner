// "The Aqueduct Span" -- a 24x20 dry gorge under a broken Roman aqueduct. The channel at x 10..12
// is cut 6h below both rims and walled with void on both faces.
//
// R10 REROUTE (balance): the map used to be a tier ladder whose JUMP-2 road ran 38-43 steps against
// a 14-step straight line, so the Knight and the casters never arrived. It now has THREE Jump-2 ways
// across, every step <= 4h:
//   THE MASON'S BRIDGE  (south, 2 wide) A's yard -> a two-bay stone span at SHOULDER 8 -> B's terrace. 15-18 steps.
//   THE QUARRY STAIR    (centre) A's yard -> the slipway -> the sand shelf -> two cut treads out of the
//                       gorge (0 -> 4 -> 8 -> 10) onto B's terrace lip, where the old 10h slip face was. 16-18 steps.
//   THE AQUEDUCT DECK   (north flank) the Mason's Stair switchback or the gorge's banked pier landing
//                       (now 4h) onto the causeway, the east rim and the Terrace Stair. The long flank.
// The two express faces (broken pier 6h, slip face 10h) are gone: once the bridge exists they saved
// nothing, and a declared face that saves nothing is a validate error. tiers is [4].
//
// JUMP MATHS. rules.js admits a step when |dh| <= jump * HEIGHT_STEP, in h, so JUMP 2 clears 4h.
// The apron moat (x 13 at z 5 and z 8) still keeps the deck from leaking onto the terrace lip.
//
// The deck is TERRAIN, not `deck` props: a deck prop grants walk at the WATER's height (props.md
// §3.15), which is RIVER 0 here. Both spans are built by the aqueduct primitive on `arch` piers.
//
// Screen orientation at the default camera (yaw 45 deg): (0,0) is the top of the diamond, (23,19)
// the bottom, (23,0) screen-right, (0,19) screen-left.
import { canvas } from '../canvas.js';
import { aqueduct, switchback, chasm } from '../primitives/index.js';
import { footprint, PROP_SPEC } from '../mapformat/propspec.js';

const W = 24, D = 20;
const RIVER = 0, SHORE = 2, BANK = 4, TOWN = 6, SHOULDER = 8, UPPER = 10, RIDGE = 12;

const c = canvas({ mood: 'noon', w: W, d: D, h: TOWN, t: 'g', id: 'aqueduct_span', name: 'Aqueduct Span', seed: 611,
  baseTier: 4, tiers: [4],
  blurb: 'A dry gorge under a fallen aqueduct: a new bridge, a quarry stair, and the old deck on the flank.',
  notes: 'JUMP 2: the Mason\'s Bridge (18) or the gorge and the Quarry Stair (18); the aqueduct deck is the long northern flank.' });

// =====================================================================================
// 1. The two rims. Both TOWN 6 by the catalogue, so every piece of relief on them is a 2h or 4h
//    swell -- landscape, never a shortcut. The gating on this map is done by void and by the two
//    declared faces, and by nothing else.
// =====================================================================================
c.fill(0, 0, 8, 19, TOWN, 'g');                    // the west rim, A's side
c.fill(14, 0, 23, 10, TOWN, 'g');                  // the east rim, north of the terrace gully
c.fill(0, 0, 4, 4, SHOULDER, 'k'); c.fill(0, 0, 2, 1, UPPER, 'k'); c.fill(3, 0, 4, 0, UPPER, 'r');   // the header upland
c.fill(0, 9, 3, 12, null, 'k'); c.fill(1, 10, 2, 11, BANK, 'w');   // THE CISTERN, banked 2h all round
c.fill(5, 16, 8, 19, null, 'k');                   // rough pasture south of A's yard
c.fill(19, 2, 22, 5, SHOULDER, 'k');               // the east knoll
c.fill(18, 7, 19, 7, BANK, 'w');                   // the farm pond, banked 2h
c.fill(14, 9, 23, 10, null, 'k');                  // the corn strip above the terrace scarp

// =====================================================================================
// 2. The gorge. x 9 and x 13 are the two faces, and they are VOID rather than tall: rules.js walks
//    the 4-neighbour grid one tile at a time, so nothing -- no jump, not even ignore_height --
//    crosses a tile that is not there. Height would gate a tier; void gates everybody, which is
//    what a 6h rim over a 2h shelf needs, because 6 - 2 = 4 and the base tier would walk straight in
//    at every tile of both banks.
// =====================================================================================
chasm(c, { rect: [9, 0, 9, 19], kind: 'scenery', note: 'the west gorge face, sheer for its whole length' });
chasm(c, { rect: [13, 0, 13, 19], kind: 'scenery', note: 'the east gorge face' });
c.fill(10, 0, 10, 19, SHORE, 'S');                 // the west sand shelf
c.fill(11, 0, 12, 19, RIVER, 'r');                 // the gorge floor
c.fill(12, 0, 12, 4, SHORE, 'S'); c.fill(11, 1, 11, 3, RIVER, 'w');   // what is left of the water it carried
c.fill(11, 13, 11, 19, RIVER, 'S'); c.fill(12, 13, 12, 19, null, 'v');   // the floor narrows southward
c.put(9, 15, BANK, 'd');                           // THE SLIPWAY: the one break in the west face
c.put(9, 2, BANK, 'd');                            // and the outfall path into the dead-end north bed

// =====================================================================================
// 3. The causeway, on `arch` piers. The aqueduct primitive writes the deck, springs an arch under
//    every second bay and caps both sides with a parapet course; the flank trench is off because
//    §2 already cut both faces to void and a second pass would have nothing left to cut.
// =====================================================================================
aqueduct(c, { x: 9, z: 6, len: 5, axis: 'x', h: SHOULDER, groundH: RIVER, width: 2, pierEvery: 2,
  r: 0.85, t: 's', parapet: true, trench: false,
  note: 'the causeway: five bays at 8h over a gorge floor at 0h, on three arch piers' });
// THE BROKEN SPAN. The northern two bays of the upstream row have fallen into the gorge, so the
// deck is a five-tile road with a two-tile hole in it and every crossing shuffles onto the
// downstream row. settle() parks the hole at the cut, so it falls to the diorama floor.
chasm(c, { rect: [11, 6, 12, 6], kind: 'hazard', note: 'THE BROKEN SPAN: two bays of the upstream row, fallen' });
// THE APRON MOAT, x 13 at z 5 and z 8 -- PLAN §7 asks for x 13, z 5..8, which is the abutment's own
// two rows as well and would sever the causeway it protects. These are the two tiles that actually
// do the work: they cut the east abutment off from B's terrace lip, whose UPPER 10 sits a walkable
// 2h above the deck. Proven in §8, not assumed.
chasm(c, { rect: [13, 5, 13, 5], kind: 'hazard', note: 'the apron moat, north lobe' });
chasm(c, { rect: [13, 8, 13, 8], kind: 'hazard', note: 'the apron moat, south lobe -- the tile that keeps 6h and 10h apart' });
// The rest of the deck's apron: nothing may stand within a legal step of the deck line except the
// one declared vault at 10,8, so both neighbouring rows are cut back to the shelf that carries it.
chasm(c, { rect: [10, 5, 12, 5], kind: 'scenery', note: 'the north apron: the deck is approached from the bed at one tile only' });
chasm(c, { rect: [11, 8, 12, 8], kind: 'scenery', note: 'the south apron, all but the pier landing' });
c.put(10, 8, BANK, 'd');                           // THE PIER LANDING: rubble banked 4h up to the deck line, the gorge's way onto the causeway

// =====================================================================================
// 4. THE MASON'S STAIR -- the anti-shortcut. Three legs the base tier walks end to end, each
//    reachable only from the free end of the last, and the whole block sealed by isolate() except
//    at its two mouths. This is the denominator every saving below is measured against: without it
//    the west rim is a straight nine-tile walk and both vaults are worth nothing.
// =====================================================================================
chasm(c, { rect: [0, 13, 5, 13], kind: 'scenery', note: 'the Fault: the west rim is split, and the Stair is the only way over it' });
switchback(c, { rect: [6, 8, 7, 12], axis: 'x', legs: 3, width: 1, rise: 2, base: TOWN, t: 'd',
  note: 'the Mason\'s Stair: three legs, 6h to 10h, cut into the rim and walled by fissures' });
chasm(c, { rect: [8, 11, 8, 11], kind: 'scenery', note: 'the last tile of the Fault, so the Stair has no pocket beside it' });

// =====================================================================================
// 5. B's terrace and the Terrace Stair. The terrace stands 4h over the east rim, which is a legal
//    base-tier step -- so the scarp at z 11 is void for its whole length but two tiles. Those two
//    are the base tier's only way up, they are declared a choke, and they are the reason the slip
//    face is worth five turns instead of one.
// =====================================================================================
c.fill(13, 12, 23, 19, UPPER, 'g');
c.fill(20, 16, 23, 19, RIDGE, 'k');                // the south-east downs, one 2h terrace higher
c.fill(13, 12, 15, 14, null, 'k');
chasm(c, { rect: [13, 11, 15, 11], kind: 'scenery', note: 'the terrace scarp, west half' });
chasm(c, { rect: [18, 11, 23, 11], kind: 'scenery', note: 'the terrace scarp, east half' });
c.fill(16, 11, 17, 11, TOWN, 'd');                 // THE TERRACE STAIR

// =====================================================================================
// 5b. R10: the two southern crossings, both Jump-2, both 18 steps spawn to spawn.
//   THE QUARRY STAIR -- two cut treads out of the gorge floor onto B's terrace lip (0 -> 4 -> 8 -> 10),
//   reached from A's yard down the slipway. It replaces the old 10h slip face at the same spot.
//   THE MASON'S BRIDGE -- a new two-bay stone span at SHOULDER 8 from A's rim (6h) to the terrace (10h)
//   over the southern gorge, whose tail below it has fallen away to the void.
// =====================================================================================
c.put(12, 12, BANK, 's'); c.put(12, 13, BANK, 's');          // the lower tread, cut from the floor
c.put(13, 12, SHOULDER, 's'); c.put(13, 13, SHOULDER, 's');  // the upper tread, cut into the terrace lip
chasm(c, { rect: [10, 16, 11, 16], kind: 'scenery', note: 'the gorge tail falls away under the Mason\'s Bridge' });
chasm(c, { rect: [10, 19, 11, 19], kind: 'scenery', note: 'the gorge tail, south of the bridge' });
aqueduct(c, { x: 9, z: 17, len: 4, axis: 'x', h: SHOULDER, groundH: RIVER, width: 2, pierEvery: 2,
  r: 0.8, t: 's', parapet: true, trench: false,
  note: 'the Mason\'s Bridge: a two-bay stone span at 8h from A\'s rim to B\'s terrace' });

// Bites out of the rectangle so the diorama has an outline rather than a border. None may touch
// water: settle() would quietly convert them back to grass and the bite would vanish.
for (const r of [[0, 0, 0, 0], [22, 0, 23, 0], [23, 3, 23, 4], [0, 18, 1, 19], [6, 19, 7, 19],
  [14, 0, 15, 0], [23, 9, 23, 10], [22, 19, 23, 19], [16, 19, 17, 19]])
  chasm(c, { rect: r, kind: 'scenery', note: 'bite in the diorama outline' });

// The roads, painted last so no fill can wipe them, and laid on the tiles the 4h flood actually
// walks rather than where the author imagines the road goes.
for (let x = 4; x <= 8; x++) c.put(x, 15, null, 'd');
for (let z = 12; z <= 15; z++) c.put(8, z, null, 'd');
for (let z = 6; z <= 8; z++) c.put(5, z, null, 'd');
for (let x = 5; x <= 8; x++) c.put(x, 6, null, 's');
c.put(4, 6, null, 'd'); c.put(4, 7, null, 'd');
for (let x = 14; x <= 17; x++) c.put(x, 7, null, 's');
for (let z = 7; z <= 10; z++) c.put(16, z, null, 'd');
for (let z = 12; z <= 15; z++) c.put(16, z, null, 'd');
for (let x = 17; x <= 19; x++) c.put(x, 15, null, 'd');
for (let z = 16; z <= 18; z++) c.put(8, z, null, 'd');
for (let x = 14; x <= 17; x++) c.put(x, 13, null, 'd');

// =====================================================================================
// 6. The walking rows. Every tile of the base road and of both express approaches joins the canvas
//    avoid set BEFORE a prop is placed, and P() refuses to close one -- two sprites on the wrong
//    tiles seal the Terrace Stair and the map reports contract.disconnect.
// =====================================================================================
c.protectRect(4, 15, 8, 15); c.protectRect(8, 12, 8, 15);          // A's lane and the Stair mouth
c.protectRect(4, 6, 8, 6); c.protectRect(5, 6, 5, 8); c.protect(4, 7); c.protect(8, 7);
c.protectRect(10, 8, 10, 19); c.protectRect(11, 9, 12, 12);        // the bed, both express approaches
c.protectRect(9, 15, 9, 15); c.protectRect(14, 6, 17, 7);
c.protectRect(16, 7, 16, 15); c.protectRect(17, 15, 19, 15);       // the east lane and the Stair
c.protectRect(13, 12, 15, 12);
c.protectRect(8, 15, 8, 18); c.protectRect(13, 15, 13, 18); c.protectRect(12, 12, 17, 13); c.protectRect(17, 14, 18, 14);   // the two southern crossings

// =====================================================================================
// 7. Props. Roman country: the aqueduct's masonry on the gorge, a farm on the east rim, a mason's
//    yard at A. `wall` and `rail` are edgeFree and non-blocking, so a parapet reads as masonry
//    without ever closing a tile; every corner keeps `tree`/`bush`, which are walk-through, because
//    a blocking sprite in a corner strands the tiles behind it (design.orphan, 21 of them once).
// =====================================================================================
const P = (o) => {
  const p = c.prop(o);
  // Two questions. EVERY prop must stand on real ground -- `bush` and `tree` are walk-through, so
  // footprint() is empty and a billboard planted in the gorge would otherwise pass unremarked. Only
  // a BLOCKING footprint may not land on a protected tile.
  if (PROP_SPEC[p.type].coord !== 'edgeFree') {
    const [ax, az] = [Math.floor(p.x), Math.floor(p.z)];
    if (!c.walkAt(ax, az)) throw new Error(`aqueduct_span: ${p.type} at ${p.x},${p.z} stands on ${c.tAt(ax, az)} at ${ax},${az}`);
  }
  for (const [x, z] of footprint(p)) {
    if (!c.walkAt(x, z)) throw new Error(`aqueduct_span: ${p.type} at ${p.x},${p.z} stands on ${c.tAt(x, z)} at ${x},${z}`);
    if (c.isProtected(x, z)) throw new Error(`aqueduct_span: ${p.type} at ${p.x},${p.z} closes route tile ${x},${z}`);
  }
  return p;
};
// --- the causeway: the piers the aqueduct primitive did not spring, and the fallen bay ---
P({ type: 'arch', x: 9.5, z: 8, h: BANK, r: 0.85, dir: 'z', flip: true }); P({ type: 'arch', x: 12.5, z: 8, h: BANK, r: 0.85, dir: 'z', flip: true });
P({ type: 'arch', x: 10.5, z: 6, h: BANK, r: 0.7, dir: 'z' }); P({ type: 'arch', x: 12.5, z: 6, h: BANK, r: 0.8, dir: 'z' });
P({ type: 'arch', x: 10.5, z: 8, h: BANK, r: 0.8, dir: 'z', flip: true }); P({ type: 'arch', x: 11.5, z: 8, h: BANK, r: 0.7, dir: 'z', flip: true });
P({ type: 'wall', x: 5, z: 6, len: 4, dir: 'x', h: TOWN, in: -1 }); P({ type: 'wall', x: 14, z: 7, len: 4, dir: 'x', h: TOWN, in: 1 });
P({ type: 'arch', x: 5.5, z: 6, h: SHORE, r: 0.6, dir: 'z' }); P({ type: 'arch', x: 7.5, z: 6, h: SHORE, r: 0.6, dir: 'z' });
P({ type: 'arch', x: 15.5, z: 7, h: SHORE, r: 0.6, dir: 'z', flip: true }); P({ type: 'arch', x: 17.5, z: 7, h: SHORE, r: 0.6, dir: 'z', flip: true }); P({ type: 'arch', x: 13.5, z: 6, h: SHOULDER - 2, r: 0.6, dir: 'z' });
P({ type: 'rail', x: 9, z: 6, len: 5, dir: 'x', h: SHOULDER });
P({ type: 'wall', x: 9, z: 6, len: 2, dir: 'z', h: SHOULDER, in: -1 }); P({ type: 'wall', x: 14, z: 6, len: 2, dir: 'z', h: SHOULDER, in: 1 });
// --- the west abutment and the ramp foot ---
P({ type: 'signpost', x: 8.5, z: 4.5 }); P({ type: 'ruin', x: 7, z: 3, len: 2, dir: 'x', th: 1.5 });
P({ type: 'pillar', x: 6.5, z: 4.5, h: 1.6 }); P({ type: 'pillar', x: 8.5, z: 4.5, h: 1.2 });
P({ type: 'cart', x: 3.5, z: 6.5, rot: 1 }); P({ type: 'woodpile', x: 1.5, z: 4.5 }); P({ type: 'barrel', x: 7.26, z: 4.74 }); P({ type: 'crate', x: 7.74, z: 4.26 });
P({ type: 'rock', x: 4.5, z: 4.5 }); P({ type: 'bush', x: 7.5, z: 3.5 }); P({ type: 'flowers', x: 6.5, z: 4.5 });
// --- the north-west upland: the header house and its cistern ---
P({ type: 'house', x: 0, z: 2, w: 2, d: 2, rot: 2, storeys: 2, chimney: 'right', style: 'stone', roof: 'slate', gable: 'stone' });
P({ type: 'tower', x: 3, z: 1, w: 2, d: 2, th: 4.0 }); P({ type: 'wall', x: 0, z: 5, len: 5, dir: 'x', h: SHOULDER, in: -1 });
P({ type: 'rail', x: 1, z: 10, len: 2, dir: 'z', h: TOWN }); P({ type: 'rail', x: 3, z: 10, len: 2, dir: 'z', h: TOWN });
P({ type: 'well', x: 3.5, z: 11.5 }); P({ type: 'flowers', x: 0.5, z: 9.5 }); P({ type: 'stall', x: 2.5, z: 8.5, rot: 2 }); P({ type: 'gate', x: 4.5, z: 5.5, rot: 0 });
P({ type: 'pine', x: 1.5, z: 0.5 }); P({ type: 'pine', x: 2.5, z: 0.5 }); P({ type: 'oak', x: 0.5, z: 6.5 });
P({ type: 'oak', x: 2.5, z: 7.5 }); P({ type: 'bush', x: 1.5, z: 6.5 }); P({ type: 'bush', x: 3.5, z: 12.5 });
P({ type: 'rock', x: 5.5, z: 2.5 }); P({ type: 'bush', x: 0.5, z: 12.5 });
P({ type: 'flowers', x: 2.5, z: 12.5 }); P({ type: 'flowers', x: 0.5, z: 8.5 }); P({ type: 'grave', x: 2.5, z: 7.5 });
P({ type: 'rock_small', x: 5.5, z: 14.5 });
// --- the Mason's Stair: rails on every leg lip, and the fissures spilling rubble ---
P({ type: 'rail', x: 6, z: 9, len: 2, dir: 'x', h: TOWN }); P({ type: 'rail', x: 6, z: 11, len: 2, dir: 'x', h: SHOULDER });
P({ type: 'rail', x: 6, z: 13, len: 2, dir: 'x', h: UPPER }); P({ type: 'wall', x: 6, z: 8, len: 2, dir: 'x', h: TOWN, in: -1 });
P({ type: 'lamp', x: 5.5, z: 9.5 }); P({ type: 'signpost', x: 7.5, z: 14.5 }); P({ type: 'bush', x: 4.5, z: 14.5 });
// --- A's yard on the south rim: a mason's camp, tents and stone waiting to go up the Stair ---
P({ type: 'house', x: 2, z: 16, w: 3, d: 2, rot: 0, storeys: 1, chimney: 'left', style: 'timber', roof: 'thatch' });
P({ type: 'house', x: 6, z: 17, w: 2, d: 1, rot: 0, storeys: 1, style: 'timber', barn: true, roof: 'brown' });
P({ type: 'house', x: 0, z: 15, w: 1, d: 1, rot: 3, storeys: 2, chimney: 'right', style: 'stone', roof: 'tile' });
P({ type: 'stall', x: 3.5, z: 14.5, rot: 2 }); P({ type: 'stall', x: 6.5, z: 14.5, rot: 0 });
P({ type: 'cart', x: 2.5, z: 14.5, rot: 3 }); P({ type: 'woodpile', x: 3.5, z: 14.5 });
P({ type: 'hay', x: 5.5, z: 14.5 }); P({ type: 'trough', x: 4.5, z: 18.5 });
P({ type: 'barrel', x: 7.26, z: 18.74 }); P({ type: 'crate', x: 7.74, z: 18.26 });
P({ type: 'fence', x: 21, z: 5, len: 2, dir: 'x' }); P({ type: 'gate', x: 7.5, z: 15.5, rot: 0 });
P({ type: 'well', x: 1.5, z: 17.5 }); P({ type: 'lamp', x: 4.5, z: 14.5 }); P({ type: 'lamp', x: 8.5, z: 19.5 });
P({ type: 'oak', x: 0.5, z: 14.5 }); P({ type: 'tree', x: 3.5, z: 18.5 }); P({ type: 'tree', x: 5.5, z: 19.5 });
P({ type: 'bush', x: 1.5, z: 12.5 }); P({ type: 'bush', x: 5.5, z: 17.5 });
P({ type: 'flowers', x: 6.5, z: 18.5 }); P({ type: 'flowers', x: 7.5, z: 18.5 }); P({ type: 'flowers', x: 4.5, z: 16.5 });
// --- the gorge floor: quarried blocks that never made it up, and the dry channel bed ---
P({ type: 'bush', x: 11.5, z: 4.5 });
P({ type: 'bush', x: 10.5, z: 4.5 }); P({ type: 'bush', x: 10.5, z: 1.5 }); P({ type: 'rock_small', x: 11.5, z: 15.5 });
P({ type: 'pillar', x: 11.5, z: 0.5, h: 1.4 }); P({ type: 'bush', x: 10.5, z: 0.5 });
P({ type: 'cart', x: 11.5, z: 14.5, rot: 0 }); P({ type: 'bush', x: 12.5, z: 2.5 });
P({ type: 'bush', x: 10.5, z: 3.5 }); P({ type: 'bush', x: 11.5, z: 9.5 });
P({ type: 'bush', x: 12.5, z: 4.5 }); P({ type: 'flowers', x: 11.5, z: 13.5 }); P({ type: 'flowers', x: 12.5, z: 3.5 });
P({ type: 'bush', x: 12.5, z: 0.5 });
// --- the east rim: a farm above the gorge, and the corn strip along the terrace scarp ---
P({ type: 'house', x: 20, z: 6, w: 3, d: 2, rot: 2, storeys: 2, chimney: 'left', style: 'timber', roof: 'tile' });
P({ type: 'ruin', x: 14, z: 3, len: 2, dir: 'z', th: 1.4 }); P({ type: 'pillar', x: 15.5, z: 3.5, h: 1.2 });
P({ type: 'ruin', x: 17, z: 1, len: 2, dir: 'x', th: 1.9 }); P({ type: 'pillar', x: 18.5, z: 3.5, h: 1.7 });
P({ type: 'tower', x: 20, z: 2, w: 2, d: 2, th: 3.6 });
P({ type: 'fence', x: 17, z: 5, len: 2, dir: 'x' }); P({ type: 'fence', x: 17, z: 2, len: 2, dir: 'x' });
P({ type: 'rail', x: 18, z: 7, len: 2, dir: 'z' , h: TOWN }); P({ type: 'rail', x: 20, z: 7, len: 2, dir: 'z', h: TOWN });
P({ type: 'cart', x: 19.5, z: 9.5, rot: 2 }); P({ type: 'hay', x: 21.5, z: 9.5 });
P({ type: 'trough', x: 14.5, z: 8.5 }); P({ type: 'woodpile', x: 20.5, z: 5.5 }); P({ type: 'well', x: 19.5, z: 2.5 });
P({ type: 'stall', x: 22.5, z: 3.5, rot: 1 }); P({ type: 'gate', x: 16.5, z: 5.5, rot: 0 });
P({ type: 'barrel', x: 17.26, z: 4.74 }); P({ type: 'crate', x: 17.74, z: 4.26 });
P({ type: 'lamp', x: 20.5, z: 8.5 }); P({ type: 'signpost', x: 15.5, z: 10.5 });
P({ type: 'tree', x: 16.5, z: 2.5 }); P({ type: 'tree', x: 22.5, z: 5.5 }); P({ type: 'tree', x: 23.5, z: 1.5 });
P({ type: 'tree', x: 23.5, z: 7.5 }); P({ type: 'bush', x: 14.5, z: 1.5 }); P({ type: 'bush', x: 18.5, z: 3.5 });
P({ type: 'bush', x: 22.5, z: 10.5 }); P({ type: 'rock', x: 14.5, z: 5.5 }); P({ type: 'bush', x: 18.5, z: 0.5 });
P({ type: 'flowers', x: 21.5, z: 4.5 }); P({ type: 'flowers', x: 19.5, z: 3.5 }); P({ type: 'flowers', x: 14.5, z: 10.5 });
P({ type: 'flowers', x: 20.5, z: 0.5 });
// --- the Terrace Stair and B's terrace: the scarp lip, the shrine, and B's camp ---
P({ type: 'rail', x: 14, z: 12, len: 2, dir: 'x', h: UPPER });
P({ type: 'stairs', x: 12, z: 12, dir: 'e' }); P({ type: 'stairs', x: 12, z: 13, dir: 'e' }); P({ type: 'stairs', x: 13, z: 12, dir: 'e' }); P({ type: 'stairs', x: 13, z: 13, dir: 'e' }); P({ type: 'rail', x: 18, z: 12, len: 6, dir: 'x', h: UPPER });
P({ type: 'wall', x: 16, z: 12, len: 2, dir: 'x', h: UPPER, in: -1 });
P({ type: 'gate', x: 16.5, z: 12.5, rot: 0 }); P({ type: 'lamp', x: 15.5, z: 5.5 });
P({ type: 'house', x: 16, z: 17, w: 2, d: 2, rot: 2, storeys: 2, chimney: 'right', style: 'stone', roof: 'slate', gable: 'stone' });
P({ type: 'house', x: 14, z: 16, w: 2, d: 1, rot: 0, storeys: 1, style: 'timber', roof: 'thatch', chimney: 'left' });
P({ type: 'house', x: 21, z: 13, w: 2, d: 2, rot: 3, storeys: 1, style: 'timber', barn: true, roof: 'brown' });
P({ type: 'tower', x: 22, z: 17, w: 2, d: 2, th: 3.4 });
P({ type: 'ruin', x: 20, z: 19, len: 2, dir: 'x', th: 1.6 }); P({ type: 'pillar', x: 18.5, z: 18.5, h: 1.3 });
P({ type: 'grave', x: 21.5, z: 18.5 }); P({ type: 'grave', x: 22.5, z: 16.5 });
P({ type: 'cart', x: 15.5, z: 18.5, rot: 1 }); P({ type: 'hay', x: 20.5, z: 17.5 });
P({ type: 'trough', x: 14.5, z: 18.5 }); P({ type: 'woodpile', x: 20.5, z: 13.5 }); P({ type: 'well', x: 18.5, z: 13.5 });
P({ type: 'stall', x: 15.5, z: 17.5, rot: 2 }); P({ type: 'barrel', x: 21.26, z: 15.26 }); P({ type: 'crate', x: 21.74, z: 15.74 });
P({ type: 'lamp', x: 18.5, z: 16.5 }); P({ type: 'signpost', x: 18.5, z: 12.5 });
P({ type: 'tree', x: 15.5, z: 12.5 }); P({ type: 'tree', x: 19.5, z: 17.5 }); P({ type: 'tree', x: 23.5, z: 15.5 });
P({ type: 'tree', x: 23.5, z: 12.5 }); P({ type: 'tree', x: 14.5, z: 19.5 });
P({ type: 'bush', x: 13.5, z: 16.5 }); P({ type: 'bush', x: 18.5, z: 19.5 }); P({ type: 'bush', x: 22.5, z: 13.5 });
P({ type: 'rock', x: 13.5, z: 14.5 }); P({ type: 'rock_small', x: 23.5, z: 16.5 });
P({ type: 'flowers', x: 15.5, z: 13.5 }); P({ type: 'flowers', x: 18.5, z: 18.5 }); P({ type: 'flowers', x: 22.5, z: 14.5 });
P({ type: 'flowers', x: 16.5, z: 15.5 });

// =====================================================================================
// 8. Spawns and the design contract. Every claim here is PROVEN by tools/mapcheck.mjs, not
//    asserted -- the two promises are checked against the SLOWEST class that fields the tier.
// =====================================================================================
// R18 (review17 P2/P8, gameplay): spaced seats -- no two allies side by side or on a diagonal -- and the lines
// moved toward each other (mean walk A->B about 13 steps, first contact by round 2). Was A [[4, 15], [5, 15], [6, 15], [5, 16], [6, 16]], B [[18, 15], [19, 15], [20, 15], [19, 16], [20, 16]].
c.seat('A', [[5, 15], [7, 16], [8, 14], [5, 17], [8, 18]]);        // the mason's yard on the south rim
c.seat('B', [[18, 15], [17, 13], [17, 11], [16, 15], [19, 13]]);   // B's camp on the terrace

c.declareRegion({ kind: 'staging', rect: [4, 14, 7, 16], note: 'A: the mason\'s yard at the foot of the Stair' });
c.declareRegion({ kind: 'staging', rect: [18, 14, 20, 16], note: 'B: the terrace camp above the Quarry Stair' });
c.declareRegion({ kind: 'scenery', rect: [10, 0, 12, 4], note: 'the dead-end north bed: the causeway severs its own channel' });

c.declareRoute({ rid: 'masons_bridge', tier: 4, from: 'A', to: 'B', via: [[8, 17], [13, 17]],
  note: 'A\'s yard -> the Mason\'s Bridge at 8h -> B\'s terrace: the direct road, 2 wide' });
c.declareRoute({ rid: 'quarry_stair', tier: 4, from: 'A', to: 'B', via: [],
  note: 'A\'s yard -> the slipway -> the gorge shelf -> the Quarry Stair -> the terrace lip road' });

export const DEF = c.toDef();
