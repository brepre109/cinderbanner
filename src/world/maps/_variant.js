// Node-specific VARIANTS of the shipped battlefields (R15, maps owner). A variant is the base map's document with a
// new id, a new mood (and so a new terrain skin and light) and, optionally, dressing swapped -- never its gameplay:
// heights, letters, spawns, decks, the design contract and every blocking footprint are the base map's, so a story
// node moved onto a variant plays exactly as it did on the base map. `swap` may only change a prop's TYPE/look
// between two props with the same footprint (e.g. a 2x2 watchtower for a 2x2 belfry); `drop` may only remove
// walk-through dressing (flowers, bushes, trees) -- both are asserted here, so a variant cannot quietly move a wall.
// Not a map itself: mapregistry.js never lists this file.
import { footprint } from '../mapformat/propspec.js';
import { FORMAT, SCHEMA_VERSION, DEFAULTS, LETTER_OF_ENGINE } from '../mapformat/schema.js';

const WALKTHROUGH = new Set(['flowers', 'bush', 'tree']);
const fpKey = (p) => JSON.stringify(footprint(p));

/**
 * @param {object} base  the base map's MapDef (a DEF export, or fromLegacy() of a legacy module)
 * @param {{id:string, name:string, mood:string, blurb?:string, notes?:string,
 *          drop?:string[], swap?:(p:object)=>object|null}} o
 */
export function variant(base, o) {
  const def = JSON.parse(JSON.stringify(base));
  def.id = o.id; def.name = o.name; def.analysis = null;
  def['x-'] = { ...(def['x-'] || {}), mood: o.mood };
  def.brief = { blurb: o.blurb ?? def.brief?.blurb ?? '', notes: o.notes ?? def.brief?.notes ?? '' };
  const drop = new Set(o.drop || []);
  for (const t of drop) if (!WALKTHROUGH.has(t)) throw new Error(`variant ${o.id}: may only drop walk-through dressing, not '${t}'`);
  const props = [];
  for (const p of def.props) {
    if (drop.has(p.type)) continue;
    const q = o.swap ? (o.swap(p) || p) : p;
    if (fpKey(q) !== fpKey(p)) throw new Error(`variant ${o.id}: swapping ${p.type} at ${p.x},${p.z} for ${q.type} changes its footprint`);
    props.push(q);
  }
  def.props = props;
  return def;
}

/**
 * A legacy map module (WENDFORD / PROPS / SPAWNS / DECKS) as a MapDef, for a variant of wendford_crossing.
 * NOT mapformat/legacy.js's fromLegacy: that module is bundled into the chunk that holds mapdata.js's top-level
 * await, so a map chunk that imports it deadlocks the boot (the loader awaits the map, the map awaits the loader).
 * Same transcription for every field the engine reads; decks are round-tripped as 'explicit'.
 */
export function fromLegacyLite(mod, id, name) {
  const src = mod.WENDFORD, { w, d } = src;
  const H = src.H.map((r) => r.slice());
  const T = src.T.map((r) => [...r].map((ch) => LETTER_OF_ENGINE[ch] ?? ch).join(''));
  return {
    format: FORMAT, version: SCHEMA_VERSION, id, name, author: DEFAULTS.author, size: { w, d }, grid: { H, T },
    props: (mod.PROPS || []).map((p, i) => ({ pid: 'p' + String(i + 1).padStart(3, '0'), ...p })),
    spawns: { A: mod.SPAWNS.A.map((s) => [s[0], s[1]]), B: mod.SPAWNS.B.map((s) => [s[0], s[1]]) },
    decks: { mode: 'explicit', tiles: (mod.DECKS || []).map((t) => [t[0], t[1]]) },
    design: { baseTier: DEFAULTS.baseTier, tiers: [DEFAULTS.baseTier], faces: [], chokes: [], routes: [], promises: [], regions: [], assists: [], waive: [] },
    brief: { blurb: '', notes: '' }, gen: null, analysis: null, 'x-': {},
  };
}
