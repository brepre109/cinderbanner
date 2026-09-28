// The map whitelist. `?map=<id>` indexes THIS object and nothing else, so an id off the URL is never
// interpolated into an import() specifier and a crafted `?map=../../secret` resolves to no entry at
// all instead of a module path. Entries are thunks, so a map module is fetched only when it is asked
// for and the catalogue does not ride along in the game's first chunk.
//
// Deliberately NOT `import.meta.glob`: that is vite-only syntax. Under bare `node` it is a syntax
// error in whatever module holds it, `sim.mjs`'s `await import('../world/mapdata.js')` swallows the
// failure in its try/catch, and the simulator silently balances against its 12x12 prototype instead
// of the authored map -- a wrong answer that looks like a right one (rules.md 7.14).
//
// A map module may be either shape:
//   * the format's own `export const DEF` (hand-authored, procgen output, editor output), or
//   * the legacy `WENDFORD / PROPS / SPAWNS / DECKS` set that wendford_crossing.js ships today,
//     bridged by fromLegacy(). That bridge is what lets the shipped map stay untouched.
import { fromLegacy } from './mapformat/legacy.js';
import { migrate } from './mapformat/schema.js';

/** The map the loader falls back to on every failure, and the one it serves with no `?map=`. */
export const DEFAULT_MAP_ID = 'wendford_crossing';

// id -> () => Promise<module>. The key MUST equal the filename stem and the document's `def.id`;
// defOf asserts the second half of that so the registry cannot drift from the maps.
//
// ONE LINE PER MAP, AND IT IS COMMENTED OUT UNTIL THE MODULE EXISTS. That is not tidiness, it is the
// only shape rollup accepts: a dynamic import is bundled only when its specifier is a LITERAL, and a
// literal that does not resolve is a hard `Could not resolve "./maps/twin_span.js"` build failure --
// so a whitelist written ahead of its maps takes the whole build down. The two escapes both lose the
// chunk (a variable specifier, or `/* @vite-ignore */`), which is the bug tools/checks/procgen.mjs
// already watches mapdata.js for: no chunk means a 404 in production and a silent fallback here. So
// there is no third option. The id, the display name and the size stay declared in MAP_META below
// whatever the state of the file, and the author of src/world/maps/<id>.js UNCOMMENTS ONE LINE when
// it lands. tools/checks/catalogue.mjs reports every still-commented id on every run, so a map that
// exists on disk and was never wired up cannot go unnoticed.
export const REGISTRY = Object.freeze({
  wendford_crossing: () => import('./maps/wendford_crossing.js'),
  // PLAN §7 catalogue -- uncomment your map's line the moment src/world/maps/<id>.js exists:
  aqueduct_span: () => import('./maps/aqueduct_span.js'),
  saltglass_dunes: () => import('./maps/saltglass_dunes.js'),
  ravenscar_ascent: () => import('./maps/ravenscar_ascent.js'),
  sunken_choir: () => import('./maps/sunken_choir.js'),
  twin_span: () => import('./maps/twin_span.js'),
  highland_terraces: () => import('./maps/highland_terraces.js'),
  hearthmoor_flats: () => import('./maps/hearthmoor_flats.js'),
  // Chapter II (content owner)
  greyspine_pass: () => import('./maps/greyspine_pass.js'),
  ashfall_barrow: () => import('./maps/ashfall_barrow.js'),
  karsmoor_foundry: () => import('./maps/karsmoor_foundry.js'),
  hollow_crown: () => import('./maps/hollow_crown.js'),
  // R15 story battlefields (maps owner): bespoke maps + node-specific variants of the shipped ones
  marrow_camp: () => import('./maps/marrow_camp.js'),
  undercroft: () => import('./maps/undercroft.js'),
  aurelmont_nave: () => import('./maps/aurelmont_nave.js'),
  vesk_hollow: () => import('./maps/vesk_hollow.js'),
  rimewood: () => import('./maps/rimewood.js'),
  tithe_road: () => import('./maps/tithe_road.js'),
  kings_road: () => import('./maps/kings_road.js'),
  varg_shore: () => import('./maps/varg_shore.js'),
  watchtower_ruin: () => import('./maps/watchtower_ruin.js'),
});

/** @type {readonly string[]} ids that are LOADABLE right now, in registration order. */
export const MAP_IDS = Object.freeze(Object.keys(REGISTRY));

/**
 * What a picker draws BEFORE it imports anything. A map picker that had to await eight dynamic
 * imports to print eight rows would pull the whole catalogue into the first paint, which is exactly
 * what the thunks above exist to prevent -- so the label and the footprint are cached here beside
 * the thunk instead of read off the document.
 *
 * `size` is therefore a CACHE of `def.size`, in the same sense def.analysis caches the ladder, and
 * it drifts the same way: a map resized by its author leaves a stale number here with nothing to
 * catch it. tools/checks/catalogue.mjs is what catches it -- it imports every entry, compares, and
 * prints the corrected literal to paste back. `size: null` is the honest state for a map whose
 * module has not landed yet: the picker renders a dash rather than a fiction, and the check reports
 * the number to cache rather than a mismatch.
 * @type {ReadonlyArray<{id:string, name:string, size:{w:number,d:number}|null, pending:boolean}>}
 */
export const MAP_META = Object.freeze([
  meta('wendford_crossing', 'Wendford Crossing', 20, 20),
  meta('aqueduct_span', 'Aqueduct Span', 24, 20),
  meta('saltglass_dunes', 'Saltglass Dunes', 22, 22),
  meta('ravenscar_ascent', 'Ravenscar Ascent', 20, 24),
  meta('sunken_choir', 'Sunken Choir', 18, 18),
  meta('twin_span', 'Twin Span', 24, 24),
  meta('highland_terraces', 'Highland Terraces', 20, 20),
  meta('hearthmoor_flats', 'Hearthmoor Flats', 16, 16),
  meta('greyspine_pass', 'Greyspine Pass', 22, 20),
  meta('ashfall_barrow', 'Ashfall Barrow', 22, 20),
  meta('karsmoor_foundry', 'Karsmoor Foundry', 22, 22),
  meta('hollow_crown', 'The Hollow Crown', 22, 22),
  meta('marrow_camp', 'Marrow Camp', 18, 22),
  meta('undercroft', 'The Undercroft', 20, 20),
  meta('aurelmont_nave', 'Aurelmont Cathedral', 20, 22),
  meta('vesk_hollow', 'Vesk Hollow', 20, 20),
  meta('rimewood', 'Rimewood', 20, 20),
  meta('tithe_road', 'The Tithe Road', 24, 20),
  meta('kings_road', 'The King\'s Road', 20, 24),
  meta('varg_shore', 'Gaol Shore', 16, 16),
  meta('watchtower_ruin', 'Watchtower Ruin', 16, 16),
]);
function meta(id, name, w, d) {
  return Object.freeze({ id, name, size: w == null ? null : Object.freeze({ w, d }),
    // A picker draws a pending map greyed out rather than hiding it: "Twin Span, not built yet" is
    // information, and a row that silently disappears from a catalogue is not.
    pending: !Object.prototype.hasOwnProperty.call(REGISTRY, id) });
}

/** @type {readonly string[]} every id the catalogue claims, loadable or not. */
export const CATALOGUE_IDS = Object.freeze(MAP_META.map((m) => m.id));
/** @type {readonly string[]} catalogue ids whose REGISTRY line is still commented out. */
export const PENDING_IDS = Object.freeze(MAP_META.filter((m) => m.pending).map((m) => m.id));

/** Metadata for one id, or null. The editor's Open dialog indexes by id, not by list position. */
export function metaOf(id) { return MAP_META.find((m) => m.id === id) || null; }

/** hasOwnProperty, not `id in REGISTRY` -- `?map=constructor` must not find Object.prototype's. */
export function hasMap(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(REGISTRY, id);
}

/**
 * Turn a module namespace into a MapDef. Exported separately from resolveSpec so the editor can
 * feed it an already-imported module without going through the registry.
 * @param {object} mod  a map module namespace
 * @param {string} id   the registry key it was fetched under
 * @returns {object} MapDef
 */
export function defOf(mod, id) {
  if (mod && mod.DEF && typeof mod.DEF === 'object') {
    const def = migrate(mod.DEF);   // migrate clones, so the module's constant is never mutated
    if (def.id !== id) throw new Error(`mapregistry: '${id}' exports DEF with id '${def.id}'`);
    return def;
  }
  // Legacy shape. fromLegacy validates the grid dimensions and throws with a specific message, which
  // is what the loader prints; it is never repaired here, because a hand-authored map that no longer
  // matches its own declared size is a bug to fix, not a document to clamp.
  if (mod && mod.WENDFORD) return fromLegacy(mod, { id });
  throw new Error(`mapregistry: '${id}' exports neither DEF nor a legacy WENDFORD set`);
}

/**
 * Resolve a REGISTRY id to its MapDef. Registry ids only: `local:` and `proc:` are the loader's
 * branches (mapdata.js) and are refused here by name rather than by falling through to "unknown id",
 * so a mistyped scheme reports what it actually was.
 * @param {string} spec
 * @returns {Promise<object>} MapDef
 */
export async function resolveSpec(spec) {
  const id = typeof spec === 'string' ? spec.trim() : '';
  if (id.includes(':')) throw new Error(`mapregistry: '${id}' is a scheme spec, not a registry id`);
  // A catalogued-but-unregistered id gets its own message. "not a registered map" would be true and
  // useless: the id is spelled correctly, it is in the catalogue, and the fix is one commented line.
  if (!hasMap(id)) {
    if (PENDING_IDS.includes(id)) throw new Error(`mapregistry: '${id}' is in the catalogue but its REGISTRY line is still commented out -- uncomment it in src/world/mapregistry.js`);
    throw new Error(`mapregistry: '${id}' is not a registered map (have: ${MAP_IDS.join(', ')})`);
  }
  // The catalogue is written before the maps are: seven entries above name modules that authors are
  // still writing, and a whitelist that only listed the files already on disk would have to be
  // edited once per landing. So a missing module is a normal state, and the only thing that must not
  // happen is losing WHICH id failed -- node's own "Cannot find module '.../maps/twin_span.js'" is
  // legible, vite's browser-side "Failed to fetch dynamically imported module" is not, and mapdata.js
  // prints whatever this throws before falling back to Wendford.
  let mod;
  try { mod = await REGISTRY[id](); }
  catch (e) { throw new Error(`mapregistry: '${id}' failed to import (${(e && e.message) || e})`); }
  return defOf(mod, id);
}
