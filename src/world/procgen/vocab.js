// The five archetypes as DATA (PLAN §3.5, §5.2). the prototype shipped three ~90%-identical archetype files
// whose RNG only touched prop scatter, so "procedural" meant one authored layout times four
// orientations; skeleton.js is the single parameterised builder and everything that distinguishes a
// Sundered Gorge from a Salt Causeway lives in one record below. Adding a sixth archetype is a new
// row here and NOT a new file — that is the whole point of the split, and the reason this module
// imports nothing but the schema's letter table.
//
// Every field is consumed. `faces[].tier` MUST be a live roster tier (analysis/profiles.js derives
// [2,4,6,10,12,14,Inf] from CLASSES/MOVEMENTS): validate.js requires a face's declared tier to equal
// its drop rounded up to a roster tier, so a 8h face would be filed as a 10h face and the promise
// would be measured for the wrong class. 6/10/12/14 are the four usable express tiers above the 4h
// base — 2h and 4h are inside the base tier and cannot be a shortcut for anyone.
import { LETTERS } from '../mapformat/schema.js';

/** Tiers a face may declare: strictly above DEFAULTS.baseTier (4h) and present in the live roster. */
export const FACE_TIERS = Object.freeze([6, 10, 12, 14]);

const face = (tier, savesTurns, note) => Object.freeze({ tier, minSaving: 6, minTurnSaving: 1, savesTurns, note });

// Shared prop tables. Named so an archetype reads as a recipe rather than a wall of literals; each
// is a weighted table for rng.weighted(). Types are exactly the props.js vocabulary transcribed in
// mapformat/propspec.js — the whole point is that a generated map is dressed from the same kit the
// shipped one is, so it reads as authored rather than as coloured blocks.
const RUNS = {                                  // multi-tile blockers: one prop closes many tiles
  wood: { fence: 5, ruin: 1, house: 2 },
  stone: { ruin: 6, house: 2, tower: 1 },
  wild: { fence: 2, ruin: 1 },
};
const SINGLES = {                               // one-tile blockers that finish a run's ragged end
  forest: { pine: 5, oak: 5, bush: 0, rock: 2, rock_small: 2, woodpile: 1, hay: 1 },
  rocky: { rock: 6, rock_small: 5, pine: 2, grave: 1, crate: 1 },
  ruined: { rock: 3, rock_small: 3, grave: 4, pillar: 3, woodpile: 2, crate: 1, barrel: 1 },
  marsh: { rock_small: 4, oak: 3, hay: 3, barrel: 1, crate: 1, woodpile: 2 },
};
const SCATTER = {                               // WALK-THROUGH dressing: never changes a graph edge
  forest: { tree: 5, bush: 6, flowers: 3 },
  rocky: { bush: 4, flowers: 2, tree: 1 },
  ruined: { bush: 3, flowers: 4, tree: 2 },
  marsh: { bush: 5, flowers: 5, tree: 2 },
};
const STAGE = {                                 // staging-block dressing: the camp the tiers leave from
  camp: { barrel: 3, crate: 3, cart: 2, woodpile: 2, hay: 2, lamp: 2, signpost: 1, well: 1, stall: 1 },
  shrine: { grave: 4, pillar: 3, lamp: 2, signpost: 1, well: 2, barrel: 1 },
};

/**
 * @typedef {Object} Archetype
 * @property {string} id             stable; `?map=proc:<seed>&g=<id>` and def.gen.generator use it
 * @property {string} name           display name -> def.name
 * @property {string} blurb          -> def.brief.blurb, shown pre-battle
 * @property {string} notes          -> def.brief.notes, joined with the MEASURED ladder numbers
 * @property {{road:string, stage:string, ridge:string, low:string, shore:string}} palette letters
 * @property {Object} band           weighted table: what separates two road terraces
 * @property {[number,number]} edgeCut  fraction of the border ring to chew away as void. A rectangle
 *                               is the one silhouette no landscape has; the shipped maps run 19-39%.
 * @property {number} pools      bodies of standing water to sink into the scenery
 * @property {number} hollows    blobs of scenery given back to VOID. Every other scenery tile must
 *                               carry a blocking prop, so these are the only negative space there is
 * @property {[number,number]} laneLen  road-run length in tiles; the base route is ~m of these
 * @property {[number,number]} benches   how many terraces to stack; forced ODD so the last exits right
 * @property {[number,number]} stageW   staging-block width
 * @property {[number,number]} sepThick rows between two road terraces
 * @property {[number,number]} relief   scenery amplitude above the terrace it borders
 * @property {Array<{tier:number, minSaving:number, minTurnSaving:number, savesTurns:number, note:string}>} faces
 * @property {number} chokes         how many road doors to DECLARE (each is seal-proven)
 * @property {boolean} deckCrossing  put one road crossing on a plank deck over live water
 * @property {number} alcoves        0..1 — how often a terrace grows a dead-end bay into the scenery
 * @property {{w:[number,number], d:[number,number]}} size
 * @property {number} pocketBudget   PLAN §5.3 criterion 14: tiles allowed outside the base component
 * @property {{runs:Object, singles:Object, scatter:Object, stage:Object, density:number, edge:number, runShare:number}} props
 *   runShare — how often a scenery chunk becomes ONE long ruin/fence rather than loose blockers
 */

/** @type {ReadonlyArray<Archetype>} */
export const ARCHETYPES = Object.freeze([
  Object.freeze({
    id: 'highlands', name: 'Howling Heights',
    blurb: 'Terraced pasture stacked up a shoulder of the moor, stitched by one drovers\' road.',
    notes: 'The road switches back across every terrace. The high vaults drop off the shared byre onto the road further down the hill.',
    palette: { road: 'd', stage: 'k', ridge: 'k', low: 'g', shore: 'g' },
    band: { blocked: 5, void: 1 }, edgeCut: [0.22, 0.32], pools: 2, hollows: 1,
    laneLen: [5, 8], benches: [5, 7], stageW: [3, 4], sepThick: [1, 2], relief: [2, 6],
    faces: [face(6, 2, 'the sheepfold step: 6h classes drop a terrace and skip the whole west switchback'),
      face(10, 4, 'the scarp: 10h classes take the byre wall straight onto the mid road'),
      face(14, 6, 'the crag: only a 14h climb clears the head wall onto the last terrace')],
    chokes: 2, deckCrossing: false, alcoves: 0.55,
    size: { w: [16, 22], d: [22, 30] }, pocketBudget: 0,
    props: { runs: RUNS.wood, singles: SINGLES.forest, scatter: SCATTER.forest, stage: STAGE.camp, density: 0.55, edge: 0.35, runShare: 0.3 },
  }),
  Object.freeze({
    id: 'gorge', name: 'Sundered Gorge',
    blurb: 'A dry chasm system where the only continuous footing is a ledge road cut into the rock.',
    notes: 'Every terrace is islanded by void. The vaults leap the chasm from the shared shelf onto ledges further along the road.',
    palette: { road: 'r', stage: 's', ridge: 'r', low: 'r', shore: 'S' },
    band: { void: 6, blocked: 2 }, edgeCut: [0.20, 0.30], pools: 1, hollows: 3,
    laneLen: [5, 8], benches: [5, 7], stageW: [3, 4], sepThick: [1, 2], relief: [3, 7],
    faces: [face(6, 2, 'the pier stub: 6h classes hop the bed shelf and skip the west abutment'),
      face(10, 4, 'the slip face: 10h classes take the fallen slab down to the second ledge'),
      face(14, 6, 'the chimney: a 14h drop straight onto the last ledge')],
    chokes: 3, deckCrossing: false, alcoves: 0.35,
    size: { w: [16, 22], d: [22, 30] }, pocketBudget: 0,
    props: { runs: RUNS.stone, singles: SINGLES.rocky, scatter: SCATTER.rocky, stage: STAGE.camp, density: 0.45, edge: 0.5, runShare: 0.28 },
  }),
  Object.freeze({
    id: 'ruins', name: 'Fallen Chancel',
    blurb: 'Stepped courts of a collapsed abbey; each cross-wall is pierced by exactly one door.',
    notes: 'The processional route walks every court in turn. The collapsed pillars are the only way to skip a door.',
    palette: { road: 's', stage: 's', ridge: 'k', low: 'g', shore: 'S' },
    band: { blocked: 7, void: 1 }, edgeCut: [0.24, 0.34], pools: 1, hollows: 2,
    laneLen: [5, 8], benches: [5, 7], stageW: [3, 4], sepThick: [1, 1], relief: [2, 5],
    faces: [face(6, 2, 'the broken transept: 6h classes drop into the nave and skip the west door'),
      face(10, 4, 'the fallen pillar: a 10h drop lands in the choir, two doors down'),
      face(12, 5, 'the belfry stair: only a 12h climb reaches the last court directly')],
    chokes: 3, deckCrossing: false, alcoves: 0.5,
    size: { w: [16, 22], d: [20, 28] }, pocketBudget: 0,
    props: { runs: RUNS.stone, singles: SINGLES.ruined, scatter: SCATTER.ruined, stage: STAGE.shrine, density: 0.6, edge: 0.55, runShare: 0.5 },
  }),
  Object.freeze({
    id: 'mesa', name: 'Crown Mesa',
    blurb: 'A banded tableland; the road is the one graded ascent and everything else is scarp.',
    notes: 'The scarps are unclimbable by the marching tier. Each vault leaves the same crown pocket and lands a band lower.',
    palette: { road: 'd', stage: 'r', ridge: 'r', low: 'S', shore: 'S' },
    band: { blocked: 4, void: 3 }, edgeCut: [0.20, 0.30], pools: 1, hollows: 2,
    laneLen: [6, 10], benches: [5, 5], stageW: [3, 4], sepThick: [1, 2], relief: [4, 8],
    faces: [face(6, 2, 'the north vault off the crown pocket'),
      face(12, 5, 'the east vault: a 12h drop clean past the maze turn')],
    chokes: 2, deckCrossing: false, alcoves: 0.4,
    size: { w: [18, 24], d: [20, 26] }, pocketBudget: 0,
    props: { runs: RUNS.stone, singles: SINGLES.rocky, scatter: SCATTER.rocky, stage: STAGE.camp, density: 0.4, edge: 0.45, runShare: 0.3 },
  }),
  Object.freeze({
    id: 'causeway', name: 'Salt Causeway',
    blurb: 'Reclaimed salt flats: raised causeways over standing water, joined by plank crossings.',
    notes: 'The channels are uncrossable at every tier; the crossings are the road. The bluff faces are the only way off it.',
    palette: { road: 'b', stage: 'S', ridge: 'g', low: 'S', shore: 'S' },
    band: { water: 6, blocked: 2 }, edgeCut: [0.24, 0.34], pools: 1, hollows: 1,
    laneLen: [5, 8], benches: [5, 7], stageW: [3, 4], sepThick: [1, 1], relief: [2, 5],
    faces: [face(6, 2, 'the south bluff: 6h classes drop off the sea wall onto the second causeway'),
      face(10, 4, 'the abutment: a 10h climb down the old lock onto the third causeway'),
      face(14, 6, 'the sluice tower: a 14h drop onto the last causeway')],
    chokes: 2, deckCrossing: true, alcoves: 0.45,
    size: { w: [16, 22], d: [20, 28] }, pocketBudget: 0,
    props: { runs: RUNS.wood, singles: SINGLES.marsh, scatter: SCATTER.marsh, stage: STAGE.camp, density: 0.5, edge: 0.4, runShare: 0.35 },
  }),
]);

/** @type {readonly string[]} */
export const ARCHETYPE_IDS = Object.freeze(ARCHETYPES.map((a) => a.id));

/** Look one up. Unknown ids resolve to null, never to a default: `?map=proc:7&g=typo` must report a
 *  bad archetype rather than silently hand the player a different battlefield. */
export function archetypeOf(id) { return ARCHETYPES.find((a) => a.id === id) || null; }

/** Structural self-check, run by the sweep and cheap enough to run anywhere. Catches the two edits
 *  that break the whole contract silently: a palette letter terrain.js does not know, and a face
 *  tier the roster does not field (which validate.js would re-file under a different class). */
export function checkVocab() {
  const bad = [];
  for (const a of ARCHETYPES) {
    for (const [k, ch] of Object.entries(a.palette)) if (!LETTERS[ch]) bad.push(`${a.id}: palette.${k} '${ch}' is not a schema letter`);
    if (LETTERS[a.palette.road] && !LETTERS[a.palette.road].walk) bad.push(`${a.id}: palette.road '${a.palette.road}' is not walkable`);
    let prev = 0;
    for (const f of a.faces) {
      if (!FACE_TIERS.includes(f.tier)) bad.push(`${a.id}: face tier ${f.tier} is not one of ${FACE_TIERS.join('/')}`);
      if (f.tier <= prev) bad.push(`${a.id}: face tiers must ascend, got ${f.tier} after ${prev}`);
      prev = f.tier;
    }
    if (a.faces.length < 2) bad.push(`${a.id}: fewer than two faces cannot make a ladder`);
    if (a.band.water && a.band.void) bad.push(`${a.id}: void and water bands can end up adjacent; props.md §5 forbids it`);
    // `outer` used to sit here documented and unread, and the silhouette stayed a rectangle for as
    // long as nobody checked. A field the record carries and nothing consumes is worse than no field.
    const [lo, hi] = a.edgeCut || [];
    if (!(lo >= 0 && hi >= lo && hi <= 0.6)) bad.push(`${a.id}: edgeCut must be [lo,hi] within 0..0.6, got ${JSON.stringify(a.edgeCut)}`);
    for (const k of ['pools', 'hollows']) if (!Number.isInteger(a[k]) || a[k] < 0) bad.push(`${a.id}: ${k} must be a non-negative integer, got ${a[k]}`);
  }
  return bad;
}
