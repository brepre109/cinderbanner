// The ONE parameterised skeleton builder (PLAN §5.1). Everything an archetype changes is a value in
// vocab.js; the geometry below is written once and verified once.
//
// THE ARGUMENT THE WHOLE GENERATOR RESTS ON. The board is a switchback road — m terraces stacked in
// z, each a flat bench, joined end to end by alternating doors so the base tier must walk every one
// of them. A staging shelf runs the full depth beside them, sealed from the road by ONE wall column.
// The wall is opened in exactly k+1 places: the door onto bench 0, and k express faces whose drops
// are EXACTLY roster tiers. Face i opens onto the FAR end of bench f_i, so a 6h class re-joins the
// road two benches down, a 10h class four, a 14h class six — strictly further each time.
//
// Three invariants make that a proof rather than a hope:
//   1. Every non-road, non-staging tile is unwalkable — void, water, or land closed by a blocking
//      prop. The walkable set is exactly {shelf, benches, doors, landings}, so the gentleness sweep
//      has nothing to find and faceScan cannot discover a face we did not cut. Scenery carries all
//      the relief it likes because scenery is never a route.
//   2. Benches are separated by full-width bands, so there is no lateral path between two landings.
//      That IS PLAN §5.1's apron moat: a 6h class landing on bench 1 cannot walk sideways to bench
//      3's landing, it must take the road. the prototype hit this bug and patched it; here it is structural.
//   3. bridgeSeal() lifts any scenery tile that could link two DIFFERENT benches if its prop were
//      removed, so validate.js's prop.blocks-only-route counterfactual can never fire.
// Zero three.js; runs under bare `node`.
import { FORMAT, SCHEMA_VERSION, SIZE_MIN, SIZE_MAX, LETTERS } from '../mapformat/schema.js';
import { ri, chance, weighted } from './rng.js';
import { makeField, noise, smooth, terrace, clampField } from './field.js';
import { sculpt } from './scenery.js';

const LANE_THICK = 2;   // a 1-wide road makes every road tile a hazard.choke1; 2 is the floor
const MARGIN = 1;       // scenery rows kept outside the first and last bench
const MIN_LANES = 5;    // 5 benches = 2 faces = the shortest ladder worth generating
const MIN_RUN = 5;      // a bench shorter than this cannot seat B's five slots
const MIN_LAND = 2;     // the lowest bench; keeps void and water clear of schema.js's -8h floor
export const BASE_TIER = 4;   // design.baseTier: the climb 14 of 32 classes have (analysis/profiles.js)
const STAGE_REG = 100;  // region id of the shelf; benches use their own index

/** Thrown for a size/parameter combination no layout satisfies. `code` becomes a rejection-histogram
 *  key, so "this archetype never fits 20 deep" is a number in the report and not a mystery. */
export class SkeletonError extends Error {
  constructor(code, msg) { super(msg || code); this.code = code; }
}

const even = (v) => 2 * Math.round(v / 2);
const clampSize = (v) => Math.max(SIZE_MIN, Math.min(SIZE_MAX, v));
export const idx = (c, x, z) => (x >= 0 && z >= 0 && x < c.w && z < c.d ? z * c.w + x : -1);
export const isWalk = (c, i) => i >= 0 && !c.block[i] && !!(LETTERS[c.T[i]] && LETTERS[c.T[i]].walk);
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function makeCanvas(w, d) {
  return { w, d, n: w * d, H: new Int16Array(w * d), T: new Array(w * d).fill('g'),
    block: new Uint8Array(w * d),        // land that MUST be closed by a blocking prop (invariant 1)
    keep: new Uint8Array(w * d),         // walkable and load-bearing: decorate may never close it
    region: new Int16Array(w * d).fill(-1),
    props: [], spawns: { A: [], B: [] }, design: null, decks: { mode: 'auto', tiles: [] }, meta: {} };
}
const put = (c, x, z, h, t, o) => { const i = idx(c, x, z); if (i < 0) return; if (h != null) c.H[i] = h; if (t) c.T[i] = t;
  if (o) { c.block[i] = o.block ? 1 : 0; c.keep[i] = o.keep ? 1 : 0; c.region[i] = o.reg === undefined ? -1 : o.reg; } };
const rect = (c, x0, z0, x1, z1, h, t, o) => { for (let z = Math.max(0, z0); z <= Math.min(c.d - 1, z1); z++) for (let x = Math.max(0, x0); x <= Math.min(c.w - 1, x1); x++) put(c, x, z, h, t, o); };

/**
 * @param {() => number} rng
 * @param {import('./vocab.js').Archetype} V
 * @param {{w?:number, d?:number}} [size] pin either extent, or neither and let the layout size itself
 * @returns {object} canvas — grids, spawns and the full design contract; decorate() closes the scenery
 * @throws {SkeletonError}
 */
export function buildSkeleton(rng, V, size = {}) {
  const P = V.palette;
  const stageW = Math.max(2, ri(rng, V.stageW[0], V.stageW[1]));
  const xWall = stageW, XA = stageW + 1;

  // ---- how many benches fit, and how many faces that pays for --------------------------------
  // The bench cap is a GAMEPLAY bound, not a geometric one: eight benches fit a 32-deep board and
  // would put thirty turns of marching before first contact. Depth past the cap becomes scenery.
  const capM = Math.max(MIN_LANES, ri(rng, V.benches[0], V.benches[1]) | 1);
  const roomFor = (s) => (size.d ? Math.floor((size.d - 2 * MARGIN + s) / (LANE_THICK + s)) : capM);
  let sepThick = ri(rng, V.sepThick[0], V.sepThick[1]), m = 0;
  for (let s = sepThick; s >= 1; s--) {
    const fit = Math.min(capM, roomFor(s));
    m = fit % 2 === 0 ? fit - 1 : fit;                    // ODD, so the last bench exits RIGHT — away
    if (m >= MIN_LANES) { sepThick = s; break; }          // from A, or B deploys on A's doorstep
  }
  if (m < MIN_LANES) throw new SkeletonError('gen.too-shallow', `d=${size.d} fits only ${m} bench(es)`);
  const odds = []; for (let j = 1; j <= m - 2; j += 2) odds.push(j);   // a face lands on a bench EXIT
  const k = Math.min(V.faces.length, odds.length);
  if (k < 2) throw new SkeletonError('gen.too-few-lanes', `${m} benches give ${k} face slot(s)`);
  const faceLanes = [];
  for (let i = 0; i < k; i++) { const j = odds[k === 1 ? 0 : Math.round((i * (odds.length - 1)) / (k - 1))];
    faceLanes.push(i && j <= faceLanes[i - 1] ? faceLanes[i - 1] + 2 : j); }
  if (faceLanes[k - 1] > m - 2) throw new SkeletonError('gen.face-spread', 'face benches ran past the last bench');
  const tiers = V.faces.slice(0, k).map((f) => f.tier);

  // ---- bench heights: fixed at the faces, interpolated between, even everywhere ---------------
  // The drop from the shelf onto bench f_i is EXACTLY tiers[i], so contract.face-drop is satisfied
  // by construction rather than by search — the single most common retry the prototype's loop paid for.
  const rel = new Array(m).fill(null); rel[0] = 0;
  faceLanes.forEach((j, i) => { rel[j] = -tiers[i]; });
  const lastFace = faceLanes[k - 1];
  for (let j = lastFace + 1; j < m; j++) rel[j] = rel[lastFace] - 2 * (j - lastFace);
  for (let a = 0; a < m; a++) { if (rel[a] === null) continue;
    let b = a + 1; while (b < m && rel[b] === null) b++; if (b >= m) break;
    for (let j = a + 1; j < b; j++) rel[j] = Math.min(rel[j - 1], even(rel[a] + ((rel[b] - rel[a]) * (j - a)) / (b - a)));
    a = b - 1; }
  const shift = MIN_LAND - Math.min(...rel), laneH = rel.map((v) => v + shift), HS = laneH[0];
  for (let j = 0; j + 1 < m; j++) if (Math.abs(laneH[j] - laneH[j + 1]) > 2 * BASE_TIER)
    throw new SkeletonError('gen.lane-step', `bench ${j}->${j + 1} steps ${Math.abs(laneH[j] - laneH[j + 1])}h; one door row cannot bridge it`);

  // ---- bench extents, and the board sized to them ---------------------------------------------
  // The door out of bench j must lie inside bench j+1 too, and consecutive doors alternate ends, so
  // making the odd bench span exactly its predecessor's run keeps every door legal with no search.
  // The board is then sized to the LAYOUT, not the layout to the board: a caller who pins w/d gets
  // the stack centred inside it, one who does not gets exactly the frame the benches need — the
  // difference between a map and a map with eight empty rows of filler underneath it.
  const per = LANE_THICK + sepThick, bx = new Array(m), room = size.w ? size.w - 2 - XA : V.laneLen[1];
  for (let j = 0; j < m; j++) bx[j] = j % 2 ? bx[j - 1] : XA + Math.min(room, ri(rng, V.laneLen[0], V.laneLen[1]));
  // An APRON, not a frame. Sizing the board to `bench stack + 1` produced exactly the rectangle on a
  // plate the catalogue does not have: no ground beyond the road for relief, a tarn or a bitten
  // outline to live in, so the silhouette could only ever be the bounding box. Three to six spare
  // rows and columns are the cheapest scenery there is, and they cost the route nothing — the benches
  // and the doors are unchanged, so every measured ladder number is identical.
  const w = size.w || clampSize(Math.max(...bx) + 1 + ri(rng, 3, 6));
  const need = 2 * MARGIN + m * per - sepThick, d = size.d || clampSize(need + ri(rng, 3, 6));
  const pad = MARGIN + Math.max(0, Math.floor((d - need) / 2)), zOf = (j) => pad + j * per;
  if (bx[m - 1] - XA < MIN_RUN - 1 || Math.max(...bx) > w - 2) throw new SkeletonError('gen.too-narrow', `${w} wide leaves a ${bx[m - 1] - XA + 1}-tile bench`);
  if (zOf(m - 1) + LANE_THICK > d - MARGIN) throw new SkeletonError('gen.too-shallow', `${m} benches do not fit ${d} deep`);
  const doorX = (j) => (j % 2 === 0 ? [bx[j] - 1, bx[j]] : [XA, XA + 1]);
  const c = makeCanvas(w, d);
  c.meta = { m, k, sepThick, per, pad, stageW, xWall, XA, bx, laneH, HS, faceLanes, tiers, zOf, doorX, V, bands: [] };

  // ---- 1. scenery: everything starts as unwalkable ground above the nearest bench --------------
  const f = makeField(w, d, 0);
  noise(f, rng, ri(rng, 4, 7), V.relief[1]); smooth(f, 1); terrace(f, 2); clampField(f, 0, V.relief[1]);
  const anchor = new Int16Array(d);
  for (let z = 0; z < d; z++) { let best = 0, bd = 1e9;
    for (let j = 0; j < m; j++) { const dz = Math.abs(z - (zOf(j) + 0.5)); if (dz < bd) { bd = dz; best = j; } } anchor[z] = laneH[best]; }
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++)
    put(c, x, z, anchor[z] + 2 + Math.max(0, f.H[z * w + x] - V.relief[0]), P.ridge, { block: 1 });

  // ---- 2. the shelf, and the wall that seals it from the road ----------------------------------
  rect(c, 0, pad, stageW - 1, d - 1 - pad, HS, P.stage, { reg: STAGE_REG });
  rect(c, xWall, pad, xWall, d - 1 - pad, HS, P.ridge, { block: 1 });
  rect(c, xWall, zOf(0), xWall, zOf(0) + LANE_THICK - 1, HS, P.road, { keep: 1, reg: STAGE_REG });
  for (const j of faceLanes) put(c, xWall, zOf(j), HS, P.stage, { keep: 1, reg: STAGE_REG });
  // The shelf tile IN FRONT of each opening is load-bearing too: let decorate drop a barrel there
  // and the door behind it becomes the one-tile choke a KO'd body corks for three turns.
  for (const j of [0, ...faceLanes]) for (let z = zOf(j); z < zOf(j) + (j ? 1 : LANE_THICK); z++) c.keep[idx(c, xWall - 1, z)] = 1;

  // ---- 3. benches, doors and bands --------------------------------------------------------------
  for (let j = 0; j < m; j++) rect(c, XA, zOf(j), bx[j], zOf(j) + LANE_THICK - 1, laneH[j], P.road, { keep: 1, reg: j });
  for (let j = 0; j + 1 < m; j++) {
    const z0 = zOf(j) + LANE_THICK, z1 = zOf(j) + per - 1, drop = Math.abs(laneH[j] - laneH[j + 1]);
    // Water standing more than baseTier below the bench above it is a bank nobody can take, and
    // validate.js says so (contract.gentleness). Deep bands therefore go void or blocked.
    let kind = weighted(rng, V.band) || 'blocked';
    if (kind === 'water' && drop > BASE_TIER) kind = 'blocked';
    const wH = Math.min(laneH[j], laneH[j + 1]);
    for (let z = z0; z <= z1; z++) for (let x = XA; x < w; x++)
      put(c, x, z, kind === 'water' ? wH : c.H[idx(c, x, z)], kind === 'void' ? 'v' : kind === 'water' ? 'w' : P.ridge, { block: kind === 'blocked' ? 1 : 0 });
    const [dxa, dxb] = doorX(j), deck = !!V.deckCrossing && kind === 'water';
    for (let z = z0; z <= z1; z++) { const t = (z - z0 + 1) / (sepThick + 1);
      rect(c, dxa, z, dxb, z, deck ? wH : even(laneH[j] + (laneH[j + 1] - laneH[j]) * t), deck ? 'w' : P.road, { keep: 1, reg: j }); }
    if (deck) c.props.push({ type: 'deck', x: dxa, z: z0, len: 2, w: sepThick, dir: 'x', h: wH, style: 'wood' });
    c.meta.bands.push({ kind, deck, z0, z1, drop });
    // A dead-end bay off one bench into a thick band: pure shape, at that bench's own height, and on
    // ONE side only, so two benches can never meet through it.
    if (sepThick > 1 && !deck && kind !== 'water' && chance(rng, V.alcoves)) {
      const up = chance(rng, 0.5), z = up ? z0 : z1, reg = up ? j : j + 1, hj = up ? laneH[j] : laneH[j + 1];
      const ax = ri(rng, XA + 1, Math.max(XA + 1, bx[j] - 5)), len = ri(rng, 2, 3);
      for (let x = ax; x <= Math.min(ax + len - 1, bx[j] - 2); x++) if (x < dxa - 1 || x > dxb + 1) put(c, x, z, hj, P.low, { reg });
    }
  }

  sculpt(c, rng, V);
  shoreline(c); scrubVoid(c); bridgeSeal(c); levelVoid(c);
  seatSpawns(c); c.design = contractOf(c, V);
  return c;
}

/** terrain.md §4: water standing 2h or more over adjacent land emits no bank and the slab floats.
 *  Scenery beside a channel is unwalkable, so it can simply be cut down into a shore. */
function shoreline(c) {
  for (let z = 0; z < c.d; z++) for (let x = 0; x < c.w; x++) { const i = idx(c, x, z); if (c.T[i] !== 'w') continue;
    for (const [dx, dz] of N4) { const j = idx(c, x + dx, z + dz);
      if (j < 0 || c.T[j] === 'w' || c.T[j] === 'v' || c.keep[j]) continue;
      if (c.H[j] > c.H[i] + BASE_TIER) { c.H[j] = c.H[i] + 2; c.T[j] = c.meta.V.palette.shore; } } }
}
/** props.md §5: void orthogonally adjacent to water shows its earth face through the black cap.
 *  Three passes, exactly as the shipped map does it, turning the offending void back into shore. */
function scrubVoid(c) {
  for (let pass = 0; pass < 3; pass++) { let hit = 0;
    for (let z = 0; z < c.d; z++) for (let x = 0; x < c.w; x++) { const i = idx(c, x, z); if (c.T[i] !== 'v') continue;
      for (const [dx, dz] of N4) { const j = idx(c, x + dx, z + dz);
        if (j >= 0 && c.T[j] === 'w') { c.T[i] = c.meta.V.palette.shore; c.H[i] = c.H[j] + 2; c.block[i] = 1; hit++; break; } } }
    if (!hit) break; }
}
/**
 * Invariant 3. A scenery tile is dangerous exactly when it sits within baseTier of walkable tiles on
 * TWO different benches: delete the prop closing it — which validate.js's prop.blocks-only-route
 * check does, one prop at a time — and the road gains a rung it never designed. Lifting the tile
 * clear of both approaches makes that counterfactual impossible instead of merely unlikely.
 */
function bridgeSeal(c) {
  for (let i = 0; i < c.n; i++) {
    if (!c.block[i] || c.T[i] === 'v' || c.T[i] === 'w') continue;
    const x = i % c.w, z = (i / c.w) | 0; const regs = new Set(); let hi = -32768;
    for (const [dx, dz] of N4) { const j = idx(c, x + dx, z + dz);
      if (j < 0 || !isWalk(c, j) || Math.abs(c.H[i] - c.H[j]) > BASE_TIER) continue;
      regs.add(c.region[j]); if (c.H[j] > hi) hi = c.H[j]; }
    if (regs.size > 1) c.H[i] = hi + BASE_TIER + 2;
  }
}
/** void.above-cut: terrain.js parks the black cap at the map's lowest land, so a void tile above it
 *  floats as a shelf. One pass, once every land height is final. */
function levelVoid(c) {
  let cut = Infinity;
  for (let i = 0; i < c.n; i++) if (c.T[i] !== 'w' && c.T[i] !== 'v') cut = Math.min(cut, c.H[i]);
  c.meta.cutH = cut = Number.isFinite(cut) ? cut : 0;
  for (let i = 0; i < c.n; i++) if (c.T[i] === 'v') c.H[i] = cut;
}

/** A on the shelf beside the door, B hand-seated at the far end of the last bench. PLAN §5.1 stage
 *  9 keeps the prototype's comment verbatim: an automatic far-spawn picker leaks onto mid-route tiles and
 *  compresses the ladder, so B is placed by the layout that knows where the road ends. */
function seatSpawns(c) {
  const { zOf, stageW, bx, m } = c.meta, A = [], B = [], bz = zOf(m - 1);
  for (let z = zOf(0); z < zOf(0) + 3 && A.length < 5; z++) for (let x = 0; x < stageW && A.length < 5; x++) A.push([x, z]);
  for (let z = bz; z < bz + LANE_THICK && B.length < 5; z++) for (let x = bx[m - 1]; x > bx[m - 1] - 3 && B.length < 5; x--) B.push([x, z]);
  if (A.length < 5 || B.length < 5) throw new SkeletonError('gen.spawn-room', `seated ${A.length}/${B.length} spawns`);
  c.spawns = { A, B };
  for (const [x, z] of [...A, ...B]) c.keep[idx(c, x, z)] = 1;
}

/** Everything the map ASSERTS about itself, emitted at authoring time so validate.js, the analysis
 *  ladder and the editor's panels all get the design intent for free (PLAN §3.4's declaration sink). */
function contractOf(c, V) {
  const { m, sepThick, per, pad, zOf, doorX, bx, XA, xWall, laneH, faceLanes, tiers, stageW } = c.meta;
  const bandTiles = (j) => { const [a, b] = doorX(j), out = [];
    for (let z = zOf(j) + LANE_THICK; z <= zOf(j) + LANE_THICK + sepThick - 1; z++) for (let x = a; x <= b; x++) out.push([x, z]); return out; };
  const faces = faceLanes.map((j, i) => ({ fid: `face_${tiers[i]}h`, from: [xWall, zOf(j)], to: [XA, zOf(j)],
    drop: tiers[i], tier: tiers[i], kind: 'express', minSaving: V.faces[i].minSaving, minTurnSaving: V.faces[i].minTurnSaving, note: V.faces[i].note }));
  const chokes = [];
  for (let j = 0; j < Math.min(V.chokes, m - 1); j++) chokes.push({ cid: `door_${j}`, tiles: bandTiles(j), tier: BASE_TIER,
    note: `the only ${BASE_TIER}h crossing between bench ${j} and bench ${j + 1}` });
  // Waypoints on the column the road ACTUALLY uses: the door tile nearer the next bench's exit is
  // one step shorter, so naming the other one would make the route measure longer than the path.
  const via = []; for (let j = 0; j + 1 < m; j++) via.push([j % 2 === 0 ? bx[j] - 1 : XA + 1, zOf(j) + LANE_THICK]);
  const routes = [{ rid: 'long_road', tier: BASE_TIER, from: 'A', to: 'B', via,
    note: `the marching road: ${m} benches, ${m - 1} doors, no shortcut at ${BASE_TIER}h` },
  ...faceLanes.map((j, i) => ({ rid: `express_${tiers[i]}h`, tier: tiers[i], from: 'A', to: 'B', via: [[XA, zOf(j)]], note: V.faces[i].note }))];
  const regions = [{ rgid: 'staging', kind: 'staging', rect: [0, pad, stageW - 1, c.d - 1 - pad], note: 'every express leaves from here' }];
  for (let j = 0; j < m; j++) regions.push({ rgid: `bench_${j}`, kind: 'road', rect: [XA, zOf(j), bx[j], zOf(j) + LANE_THICK - 1], note: `bench ${j} at ${laneH[j]}h` });
  for (let j = 0; j + 1 < m; j++) regions.push({ rgid: `band_${j}`, kind: 'scenery', rect: [XA, zOf(j) + LANE_THICK, c.w - 1, zOf(j) + per - 1], note: 'apron: no lateral route between two landings' });
  // The margins carry the knolls, the tarn and the bitten outline, and a bank out there is 'scenery'
  // in exactly the sense REGION_KINDS defines: unwalkable ground exempt from the gentleness sweep.
  // Declaring it is what lets scenery.js shape relief without every crest becoming a validator finding.
  regions.push({ rgid: 'outer_north', kind: 'scenery', rect: [0, 0, c.w - 1, Math.max(0, pad - 1)], note: 'margin: knolls, water and the bitten outline' });
  regions.push({ rgid: 'outer_south', kind: 'scenery', rect: [0, Math.min(c.d - 1, c.d - pad), c.w - 1, c.d - 1], note: 'margin: knolls, water and the bitten outline' });
  regions.push({ rgid: 'outer_east', kind: 'scenery', rect: [Math.min(c.w - 1, Math.max(...bx) + 1), 0, c.w - 1, c.d - 1], note: 'beyond the road runs: scenery only' });
  // A stairs assist earns its declaration only where the second tread bridges a step no single door
  // row could: two approaches more than baseTier apart (validate.js contract.assist-useless).
  const assists = [];
  if (sepThick === 1) for (let j = 0; j + 1 < m; j++) { const drop = Math.abs(laneH[j] - laneH[j + 1]);
    if (drop <= BASE_TIER || c.meta.bands[j].deck) continue;
    const tiles = bandTiles(j);
    assists.push({ aid: `stair_${j}`, kind: 'stairs', tiles, dir: 'n', bridges: { lowH: laneH[j + 1], highH: laneH[j] },
      note: `paired stairs carry the ${BASE_TIER}h road down the ${drop}h step` });
    for (const [x, z] of tiles) c.props.push({ type: 'stairs', x, z, dir: 'n' }); }
  return { baseTier: BASE_TIER, tiers: tiers.slice(), faces, chokes, routes,
    promises: tiers.map((t, i) => ({ from: 'A', to: 'B', tier: t, savesTurns: V.faces[i].savesTurns })),
    regions, assists, waive: [] };
}

/** Canvas -> MapDef. Rows are copied out as plain arrays and strings because that is the frozen
 *  schema shape (grid.T is one CHARACTER per tile so a one-tile edit is a one-line diff), and pids
 *  are stamped in array order — which is also props.js's sprite round-robin order. */
export function canvasToDef(c, V, o = {}) {
  const H = [], T = [];
  for (let z = 0; z < c.d; z++) { const r = [], s = [];
    for (let x = 0; x < c.w; x++) { r.push(c.H[z * c.w + x]); s.push(c.T[z * c.w + x]); } H.push(r); T.push(s.join('')); }
  return { format: FORMAT, version: SCHEMA_VERSION, id: o.id || 'proc_map', name: o.name || V.name,
    author: `procgen:${V.id}`, size: { w: c.w, d: c.d }, grid: { H, T },
    props: c.props.map((p, i) => ({ pid: `p${String(i + 1).padStart(3, '0')}`, ...p })),
    spawns: { A: c.spawns.A.map((s) => [s[0], s[1]]), B: c.spawns.B.map((s) => [s[0], s[1]]) },
    decks: { mode: 'auto', tiles: [] }, design: c.design,
    brief: { blurb: V.blurb, notes: o.notes || V.notes }, gen: o.gen || null, analysis: null, 'x-': {} };
}
