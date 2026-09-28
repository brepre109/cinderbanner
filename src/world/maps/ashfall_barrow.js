// "Ashfall Barrow" -- a 22x20 bleak heath where the Crown's foundry is quarrying Bell-Stone out of
// an ancient giant-king's burial mound, and the dead it has woken stand guard over the dig.
//
// THE LAYOUT. The attackers (A) come in on the muddy drove track at the west edge, in a peat-cut
// hollow one terrace below the heath. The defenders (B) hold the STONE RING: a four-terrace grassy
// knoll in the east (heath 6h -> 8 -> 10 -> 12h crown) ringed by standing stones with three gaps.
// A black peat bog fills the middle of the heath, so the two sides meet by one of two lanes:
//   THE MOUND LANE (north)  the track forks north and runs along the foot of the two old barrows
//                           (the great barrow crowns at 12h -- the one high perch that looks down on
//                           the ring's west gate), then climbs the knoll's north-west flank.
//   THE PIT LANE (south)    the south fork enters the GIANT-KING'S BARROW by the diggers' west
//                           cutting, walks the plank bench round the quarry pit at 6h, and leaves by
//                           the east cutting onto the knoll's south-west gate. Under the bench the
//                           pit floor sits at 2h, and the barrow's stone door stands in the 8h face
//                           at the bottom -- low ground nobody should want to fight from.
// Every walkable step on the board is 4h or less; the height is there to fight over, not to gate.
//
// Surface legend: g grass, k dark turf, d dirt/mud, s stone flags, b plank, r bare rock, w water,
// v VOID. Screen orientation at the default camera: (0,0) top of the diamond, (21,19) bottom.
import { canvas } from '../canvas.js';
import { chasm } from '../primitives/chasm.js';
import { footprint, PROP_SPEC } from '../mapformat/propspec.js';

const W = 22, D = 20;
const FLOOR = 2, HOLLOW = 4, HEATH = 6, SKIRT = 8, SHOULDER = 10, CROWN = 12;

const c = canvas({ mood: 'ashfall',
  w: W, d: D, h: HEATH, t: 'k', seed: 0xa5f41, id: 'ashfall_barrow', name: 'Ashfall Barrow', author: 'hand',
  baseTier: 4, tiers: [4],
  blurb: 'A stone ring on a bleak heath, and a quarry cut into a giant-king\'s barrow. The dead keep the dig.',
  notes: 'Two lanes from the drove track to the stone ring: north along the barrows, or south through the diggers\' bench round the quarry pit.',
});

// =====================================================================================
// 1. The heath and its relief, painted high-to-low so later fills cut into earlier ones.
// =====================================================================================
// The heath is dark heather (k); thin grass comes through it in drifts, and bare mud where the
// diggers' carts have churned it. Two greens and a brown, never one flat green.
for (const [x, z, r] of [[12, 1, 1.6], [19, 2, 1.4], [5, 18, 1.5], [18, 17, 1.8], [20, 7, 1.2]])
  c.disc(x, z, r, null, 'g');
for (const [x, z, r] of [[4, 15, 1.2], [15, 16, 1.1], [13, 3, 0.8]]) c.disc(x, z, r, null, 'd');

// The peat-cut hollow at the west edge where the attackers make camp.
c.fill(0, 8, 4, 12, HOLLOW, 'g'); c.fill(0, 8, 0, 8, HOLLOW, 'k'); c.fill(3, 12, 4, 12, HOLLOW, 'k');

// Two old barrows north of the bog: the GREAT BARROW (12h crown) and a smaller one beside it.
c.disc(7.5, 3.5, 3.3, SKIRT, 'g'); c.disc(7.5, 3.5, 2.3, SHOULDER, 'g'); c.disc(7.5, 3.5, 1.2, CROWN, 'k');
c.disc(2.5, 4, 2.2, SKIRT, 'g'); c.disc(2.5, 4, 1.1, SHOULDER, 'k');

// THE STONE RING KNOLL, four terraces of grass.
c.disc(16.5, 9.5, 5.3, SKIRT, 'g'); c.disc(16.5, 9.5, 4.3, SHOULDER, 'k'); c.disc(16.5, 9.5, 3.3, CROWN, 'g');
c.disc(16.5, 9.5, 1.6, CROWN, 's');          // the ring's floor: old flags, sunk in the turf

// THE GIANT-KING'S BARROW, south of the bog, and the quarry the foundry has cut into it.
c.disc(10.5, 15.5, 4.6, SKIRT, 'g'); c.disc(10.5, 15.5, 3.6, SHOULDER, 'g');
c.fill(8, 12, 13, 15, HEATH, 'r');          // the bench: the first cut, at heath level
c.fill(9, 13, 12, 15, FLOOR, 'd');          // the pit floor, down at the barrow door
c.fill(9, 16, 12, 16, SHOULDER, 'r');       // the cut face over the door: 8h of bare rock
c.fill(6, 13, 7, 14, HEATH, 'd');           // the west cutting: heath -> bench
c.fill(14, 12, 15, 13, SKIRT, 'd'); c.put(14, 13, HEATH, 'd');   // the east cutting, 6 -> 8 -> the ring's south-west gate
c.fill(8, 12, 13, 12, HEATH, 'b');          // the plank walkway along the bench's north side
c.fill(8, 13, 8, 15, HEATH, 'b'); c.fill(13, 13, 13, 15, HEATH, 'b');
// Ladders off the bench to the floor: a 4h tread each, dressed with stairs props in section 4.
c.put(10, 13, HOLLOW, 'r'); c.put(12, 14, HOLLOW, 'r');

// The bog: black peat water between the barrows and the dig, banked in dark turf.
c.disc(8.5, 9, 2.8, HOLLOW, 'k');
c.fill(6, 8, 10, 10, HOLLOW, 'w'); c.put(11, 9, HOLLOW, 'w'); c.put(8, 7, HOLLOW, 'w');
c.put(6, 8, HOLLOW, 'k'); c.put(10, 8, HOLLOW, 'k');
// The spoil heap: what the foundry has hauled out of the barrow, tipped on the heath east of the dig.
c.disc(17.5, 16, 1.3, SKIRT, 'r'); c.put(17, 16, SHOULDER, 'r');
// Bare rock breaking the heather: low tors, one terrace up, so the heath is not a billiard table.
for (const [x0, z0, x1, z1] of [[19, 4, 20, 5], [1, 1, 2, 1], [20, 16, 20, 17], [4, 17, 4, 17]]) c.fill(x0, z0, x1, z1, SKIRT, 'r');
// Churned mud where the carts turn: at the fork, at both cuttings and along the barrow's foot.
for (const [x, z] of [[4, 11], [6, 11], [4, 7], [6, 12], [14, 14], [16, 13], [13, 16], [15, 15]]) if (c.hAt(x, z) <= HEATH) c.put(x, z, null, 'd');
// A second peat pool behind the attackers' camp.
c.disc(2, 16.5, 1.3, HOLLOW, 'k'); c.fill(1, 16, 2, 17, HOLLOW, 'w');

// The drove track: in from the west edge through the camp, forking north (the mound lane) and south
// (the pit lane). Painted with a null height so it lies on whatever the relief made.
c.line(0, 10, 5, 10, null, 'd');
c.line(5, 10, 5, 7, null, 'd'); c.line(5, 7, 12, 7, HEATH, 'd'); c.line(12, 7, 13, 6, null, 'd');
c.line(5, 10, 5, 13, null, 'd'); c.put(5, 13, HEATH, 'd');
c.put(5, 8, HEATH, 'd'); c.put(5, 9, HEATH, 'd');

// Void bites in the diorama outline. Never beside water and never stranding a tile.
for (const r of [[0, 0, 1, 0], [0, 1, 0, 1], [20, 0, 21, 0], [21, 1, 21, 1], [0, 19, 1, 19], [0, 18, 0, 18],
  [20, 19, 21, 19], [21, 18, 21, 18], [14, 0, 15, 0], [0, 5, 0, 6], [21, 15, 21, 16], [5, 19, 6, 19], [16, 19, 17, 19],
  [21, 4, 21, 4]])
  chasm(c, { rect: r, kind: 'scenery', note: 'bite in the diorama outline' });

// =====================================================================================
// 2. The walking rows, protected before a single prop lands.
// =====================================================================================
c.protectRect(0, 9, 5, 11); c.protectRect(5, 7, 13, 7); c.protectRect(5, 8, 5, 13);   // track and forks
c.protectRect(6, 13, 7, 14); c.protectRect(8, 12, 15, 12); c.protectRect(13, 13, 15, 13);   // the pit lane
c.protectRect(12, 6, 14, 8);                                          // north-west gate approach
c.protectRect(15, 8, 18, 11);                                         // the ring's floor
c.protect(10, 13); c.protect(12, 14); c.protectRect(9, 14, 12, 14);   // ladders and the floor lane

const faults = [];
const P = (o) => {
  const p = c.prop(o);
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

// =====================================================================================
// 3. The stone ring: standing stones round the crown lip, tall and short, gaps to the west,
//    north-west and south-west where the two lanes arrive.
// =====================================================================================
{
  const cx = 16.5, cz = 9.5, stones = [];
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const dx = x + 0.5 - cx, dz = z + 0.5 - cz, r = Math.hypot(dx, dz);
    if (r < 2.5 || r > 3.3 || c.hAt(x, z) !== CROWN) continue;
    stones.push({ x, z, a: Math.atan2(dz, dx) * 180 / Math.PI });
  }
  stones.sort((p, q) => p.a - q.a);
  const gap = (a) => [[-160, -130], [165, 180], [-180, -170], [120, 150]].some(([lo, hi]) => a >= lo && a <= hi);
  let i = 0;
  for (const s of stones) {
    if (gap(s.a) || c.isProtected(s.x, s.z)) continue;
    if (i++ % 3 === 2) continue;
    P({ type: 'pillar', x: s.x + 0.5, z: s.z + 0.5, h: [2.2, 1.5, 2.6, 1.1, 1.9][i % 5] });
  }
}
P({ type: 'grave', x: 16.5, z: 7.5 });                       // the altar stone, north side of the ring

// =====================================================================================
// 4. Dressing.
// =====================================================================================
for (const p of [
  // --- the great barrow and its little sister: grave markers, a toppled ring of kerb stones ---
  { type: 'grave', x: 7.5, z: 3.5 }, { type: 'grave', x: 6.5, z: 3.5 }, { type: 'pillar', x: 8.5, z: 2.5, h: 1.3 },
  { type: 'grave', x: 2.5, z: 3.5 }, { type: 'grave', x: 3.5, z: 4.5 },
  { type: 'rock', x: 5.5, z: 1.5 }, { type: 'rock_small', x: 10.5, z: 4.5 }, { type: 'pillar', x: 10.5, z: 2.5, h: 0.9 },
  { type: 'pillar', x: 4.5, z: 5.5, h: 0.7 }, { type: 'ruin', x: 6, z: 1, len: 2, dir: 'x', th: 0.8 },
  { type: 'pine', x: 3.5, z: 1.5 },
  // --- the bog: a drowned stone (no green scrub anywhere: the heath is dead under the ash) ---
  { type: 'rock_small', x: 11.5, z: 10.5 },
  { type: 'rock', x: 7.5, z: 11.5 },
  // --- the quarry: scaffold, ladders, spoil and the diggers' kit ---
  { type: 'stairs', x: 10, z: 13, dir: 'n' }, { type: 'stairs', x: 12, z: 14, dir: 'e' },
  { type: 'rail', x: 9, z: 13, len: 1, dir: 'x', h: HEATH }, { type: 'rail', x: 11, z: 13, len: 2, dir: 'x', h: HEATH },
  { type: 'rail', x: 9, z: 13, len: 3, dir: 'z', h: HEATH }, { type: 'rail', x: 13, z: 13, len: 1, dir: 'z', h: HEATH },
  { type: 'crate', x: 9.5, z: 15.5 }, { type: 'barrel', x: 11.26, z: 15.26 }, { type: 'barrel', x: 11.74, z: 15.72 },
  { type: 'woodpile', x: 8.5, z: 15.5 }, { type: 'cart', x: 13.5, z: 15.5, rot: 1 }, { type: 'crate', x: 8.5, z: 14.5 },
  { type: 'lamp', x: 13.5, z: 14.5 }, { type: 'gate', x: 8.5, z: 12.5, rot: 1, roof: 'brown' },
  { type: 'gate', x: 13.5, z: 12.5, rot: 1, roof: 'brown' }, { type: 'rock_small', x: 12.5, z: 13.5 },
  // the barrow door at the foot of the cut face: an arch in the 8h face, flanked by the jamb stones
  { type: 'arch', x: 11, z: 16, h: FLOOR, r: 0.8, dir: 'z', flip: true },
  { type: 'pillar', x: 9.5, z: 16.5, h: 1.6 }, { type: 'pillar', x: 12.5, z: 16.5, h: 1.6 },
  { type: 'ruin', x: 10, z: 16, len: 2, dir: 'x', th: 0.5 },
  // the rest of the barrow: its crown stones and the diggers' camp on its flank
  { type: 'grave', x: 8.5, z: 18.5 }, { type: 'grave', x: 13.5, z: 17.5 }, { type: 'rock', x: 7.5, z: 16.5 },
  { type: 'woodpile', x: 6.5, z: 15.5 }, { type: 'crate', x: 6.5, z: 12.5 }, { type: 'barrel', x: 7.5, z: 12.5 },
  { type: 'cart', x: 4.5, z: 14.5, rot: 0 }, { type: 'signpost', x: 4.5, z: 12.5 },
  { type: 'house', x: 2, z: 13, w: 2, d: 1, rot: 0, storeys: 1, style: 'timber', roof: 'thatch', barn: true },
  { type: 'lamp', x: 7.5, z: 11.5 }, { type: 'fence', x: 15, z: 14, len: 2, dir: 'x' },
  // --- the ring knoll's flanks ---
  { type: 'rock', x: 19.5, z: 5.5 }, { type: 'rock_small', x: 12.5, z: 10.5 }, 
  { type: 'grave', x: 19.5, z: 13.5 }, { type: 'rock_small', x: 13.5, z: 4.5 }, 
  // --- the open heath ---
  { type: 'pine', x: 17.5, z: 1.5 }, { type: 'pine', x: 11.5, z: 0.5 }, { type: 'rock', x: 19.5, z: 16.5 },
  { type: 'pine', x: 20.5, z: 14.5 }, { type: 'rock_small', x: 17.5, z: 16.5 },
  { type: 'pine', x: 3.5, z: 17.5 }, { type: 'rock', x: 1.5, z: 13.5 }, 
  { type: 'pillar', x: 3.5, z: 7.5, h: 1.4 }, { type: 'grave', x: 1.5, z: 7.5 }, { type: 'signpost', x: 4.5, z: 8.5 },
  // the spoil heap and the barrow-field beyond it
  { type: 'rock', x: 17.5, z: 16.5 }, { type: 'rock_small', x: 18.5, z: 15.5 }, { type: 'crate', x: 16.5, z: 15.5 },
  { type: 'cart', x: 15.5, z: 17.5, rot: 0 }, { type: 'grave', x: 19.5, z: 18.5 }, { type: 'grave', x: 12.5, z: 18.5 },
  { type: 'pillar', x: 19.5, z: 11.5, h: 0.8 }, { type: 'pine', x: 20.5, z: 8.5 }, { type: 'rock_small', x: 21.5, z: 11.5 },
  { type: 'grave', x: 13.5, z: 2.5 }, { type: 'pillar', x: 16.5, z: 3.5, h: 1.2 }, { type: 'rock', x: 10.5, z: 0.5 },
  { type: 'rock_small', x: 19.5, z: 0.5 }, { type: 'rock', x: 0.5, z: 2.5 },
  { type: 'grave', x: 4.5, z: 16.5 }, { type: 'rock_small', x: 3.5, z: 18.5 }, 
  // (no wildflowers: nothing blooms under the foundry's ash -- the three flower patches were cut in R14)
]) P(p);
if (faults.length) throw new Error(`ashfall_barrow: ${faults.length} misplaced prop(s):\n  ` + faults.join('\n  '));

// =====================================================================================
// 5. Spawns and declarations.
// =====================================================================================
// R18 (review17 P2/P8, gameplay): spaced seats -- no two allies side by side or on a diagonal -- and the lines
// moved toward each other (mean walk A->B about 13 steps, first contact by round 2). Was A [[1, 10], [2, 10], [1, 9], [2, 11], [0, 10]], B [[16, 9], [17, 9], [16, 10], [17, 10], [15, 10]].
c.seat('A', [[2, 9], [4, 6], [2, 5], [4, 9], [2, 7]]);          // the drove camp in the hollow
c.seat('B', [[16, 9], [14, 7], [14, 9], [14, 11], [12, 9]]);      // inside the stone ring

c.declareRegion({ kind: 'staging', rect: [0, 9, 2, 11], note: 'A: the drove camp in the peat hollow' });
c.declareRegion({ kind: 'staging', rect: [15, 9, 17, 10], note: 'B: the floor of the stone ring' });
c.declareRegion({ kind: 'scenery', rect: [9, 16, 12, 16], note: 'the cut face over the barrow door: 8h of quarried rock, closed by the door stones' });
c.declareRegion({ kind: 'perch', rect: [14, 6, 19, 13], note: 'the stone ring knoll: 12h crown over a 6h heath' });
// The mound lane (north fork, along the barrows, up the knoll's north-west flank) is 19 steps against
// the pit lane's 18, so it is not declared: validate.js would report its via as a detour. routes.mjs
// measures it as the second distinct lane.
c.declareRoute({ rid: 'pit_lane', tier: 4, from: 'A', to: 'B', via: [[11, 12]], note: 'south fork, the diggers\' bench round the quarry pit' });

export const DEF = c.toDef();
