// Battlefield data. Maps are authored in ./maps/ (rect fills + prop list) as MapDef documents or as
// the legacy grid/prop module wendford_crossing.js still ships; mapformat/compile.js turns either
// into the MAP export every other system reads:
//   { name, w, d, tiles[z][x] = {x,z,h,t,water,void,walk[,deck]}, props, spawns, at(x,z) }
// Walk flags are final by the time MAP exists: deck props grant walk over water, then props that
// occupy a tile (houses, towers, ruins, trees, barrels...) clear it again, so the rules never see a
// tile the renderer later fills with a wall. Tiles typed 'v' are VOID -- bites out of the diorama's
// rectangle that keep a surface (so terrain still draws the cliff faces around them) but are never
// walkable and never water. All of that now lives in compile.js; this file only decides WHICH map.
//
// The active map is selected, not hardcoded. With no `?map=` -- and under bare `node`, where there
// is no `location` at all -- this is compileMap(fromLegacy(wendford)), which PLAN 1's gate proves
// deep-equal, tile for tile and key for key, to the MAP this file used to build inline. Every other
// branch is wrapped: a typo, a deleted localStorage slot or a module that throws on import falls
// back to the shipped map with a console.warn, because a bad URL must never white-screen the game.
//
// Top-level await is deliberate and was measured against the alternative of editing src/main.js:
// main.js is already a TLA module and sim.mjs already uses `await import()`, and those two are the
// only consumers of this file, so an async resolution is invisible to both and MAP stays a value
// importers use synchronously.
import { compileMap } from './mapformat/compile.js';
import { normalizeDef } from './mapformat/normalize.js';
import { parseDef } from './mapformat/serialize.js';
import { DEFAULT_MAP_ID, resolveSpec } from './mapregistry.js';

// Re-exported, not re-implemented: propspec.js is the single transcription of the props contract and
// is asserted against this file's former literals. Existing importers of `mapdata.js` see no change.
export { BLOCKING, footprint } from './mapformat/propspec.js';

/** localStorage key prefix the editor writes slots under (editor/storage.js, editor/playtest.js). */
export const SLOT_PREFIX = 'cinderbanner.mapdef.';
// Slot names are ours, not the map catalogue's: the editor's autosave ring and `__playtest` need
// leading underscores and digits. A key is not a path, so this bounds length and charset only.
const SLOT_RE = /^[A-Za-z0-9_.-]{1,64}$/;
/** The page's query string, or null off-DOM. Checked BEFORE any URLSearchParams/localStorage touch,
 *  which is what keeps `node src/game/sim.mjs` and tools/mapcheck.mjs on the authored map. */
function urlParams() {
  if (typeof location === 'undefined' || !location) return null;
  try { return new URLSearchParams(location.search || ''); } catch { return null; }
}

/** `local:<slot>` -- an editor document round-tripped through localStorage. Untrusted text, so it is
 *  the one branch that normalizes: parseDef gives structure, normalizeDef clamps it into the schema
 *  and REPORTS what it had to change instead of silently shipping a broken map. */
function loadSlot(slot) {
  if (!SLOT_RE.test(slot)) throw new Error(`bad slot name '${slot}'`);
  if (typeof localStorage === 'undefined') throw new Error('no localStorage here');
  const text = localStorage.getItem(SLOT_PREFIX + slot);
  if (!text) throw new Error(`slot '${slot}' is empty`);
  const { def, coercions } = normalizeDef(parseDef(text));
  if (coercions.length) console.warn(`mapdata: local:${slot} took ${coercions.length} coercion(s), first ${coercions[0].path}: ${coercions[0].why}`);
  return def;
}

/** `proc:<seed>` with `&g=<archetype>&w=&d=` -- the generator, imported lazily so the game never
 *  pays for procgen it does not use. generate() returns {def, attempts, rejections}. */
async function loadProc(seed, params) {
  // A LITERAL specifier, deliberately: a variable (or @vite-ignore) emits no chunk, so the built
  // game 404s on ?map=proc:<seed> and silently falls back to Wendford while dev works fine.
  const mod = await import('./procgen/index.js');
  if (typeof mod.generate !== 'function') throw new Error('procgen exports no generate()');
  // `&d=` with no value is Number('') === 0, which would hand the generator a zero-depth map; an
  // empty param means "unset", so it must read as absent and let generate() use its own default.
  const num = (k) => { const v = params && params.get(k); const n = v == null || v.trim() === '' ? NaN : Number(v); return Number.isFinite(n) ? n : undefined; };
  const out = mod.generate({ seed: Number(seed) || 0, archetype: (params && params.get('g')) || undefined, w: num('w'), d: num('d') });
  const def = out && out.def ? out.def : out;
  if (!def || typeof def !== 'object') throw new Error('generate() returned no def');
  return def;
}

/**
 * Spec -> MapDef, with the fallback. Order is PLAN 3.3: empty and the default id take the gate path
 * unwrapped (there is nothing to fall back TO if the shipped map itself fails to import, and pretending
 * otherwise would hand the game a map nobody authored); everything else is caught to Wendford.
 * @param {string} spec  '' | '<registry id>' | 'local:<slot>' | 'proc:<seed>'
 * @param {URLSearchParams|null} params  extra generator params off the page URL
 * @returns {Promise<object>} MapDef
 */
export async function resolveDef(spec, params = null) {
  const s = typeof spec === 'string' ? spec.trim() : '';
  if (!s || s === DEFAULT_MAP_ID) return resolveSpec(DEFAULT_MAP_ID);
  try {
    if (s.startsWith('local:')) return loadSlot(s.slice(6));
    if (s.startsWith('proc:')) return await loadProc(s.slice(5), params);
    return await resolveSpec(s);
  } catch (e) {
    console.warn(`mapdata: ?map=${s} failed (${(e && e.message) || e}); falling back to ${DEFAULT_MAP_ID}`);
    return resolveSpec(DEFAULT_MAP_ID);
  }
}

/** Compile a spec straight to a MAP. The editor's playtest and any future map picker use this;
 *  the module-level MAP below is exactly loadMap(the page's ?map=). */
export async function loadMap(spec = '', params = null) {
  return compileMap(await resolveDef(spec, params));
}

const PARAMS = urlParams();
/** The `?map=` that produced MAP ('' when the shipped map was served). */
export const ACTIVE_SPEC = (PARAMS && PARAMS.get('map')) || '';
/** The document MAP was compiled from -- the analysers and the editor need def and MAP together,
 *  and MAP itself must keep exactly the key set the engine has always seen. */
export const ACTIVE_DEF = await resolveDef(ACTIVE_SPEC, PARAMS);
export const MAP = compileMap(ACTIVE_DEF);
