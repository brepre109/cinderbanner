// THE HEADLINE FEATURE (PLAN §6.8): one click and the map under the cursor is running in the real
// game — the real terrain build, the real props, the real rules, the real camera — not a preview.
//
// The whole round trip is three moves and each one already existed before this file did:
//   1. validateDef()      refuse to ship a document the compiler will reject. A playtest that opens
//                         on Wendford because the map failed to load is the single most confusing
//                         failure this feature can have, so it is made impossible up front.
//   2. storage.writeSlot  into `__playtest`, under the SLOT_PREFIX that mapdata.js already reads.
//   3. window.open('/?map=local:__playtest')  and mapdata.js's own `local:` branch does the rest.
//
// SYNCHRONOUS ON PURPOSE. Every step above is synchronous, so run() can be called straight out of a
// click handler and `window.open` still counts as user-initiated. An `await` anywhere in here —
// even an await of an already-resolved promise — moves the open into a later task and every popup
// blocker on earth kills it. That is why validation is not "improved" by making it async.
//
// A NAMED WINDOW, not a fresh tab per run: `cinderbanner_playtest` is reused, so an author who plays a map
// eleven times ends with one game tab rather than eleven.
import { validateDef } from '../world/mapformat/validate.js';
import { hashDef } from '../world/mapformat/serialize.js';
import { writeSlot, readSlot, PLAYTEST_SLOT } from './storage.js';

export { PLAYTEST_SLOT };
export const WINDOW_NAME = 'cinderbanner_playtest';

/** The URL the game is opened at. Rooted at '/' because index.html is the site root under both the
 *  dev server and a built dist, and a relative './' would resolve against /editor.html. */
export function playtestUrl(slot = PLAYTEST_SLOT, extra = null) {
  const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
  const u = new URL('./', base);   // relative: the game may be served under a sub-path (GitHub Pages)
  u.searchParams.set('map', `local:${slot}`);
  for (const [k, v] of Object.entries(extra || {})) u.searchParams.set(k, String(v));
  return u.toString();
}

// WHAT BLOCKS A PLAYTEST IS NARROWER THAN WHAT validateDef CALLS AN ERROR, and the difference is
// the whole usability of this feature. validate.js grades by DESIGN law: an undeclared 10h face is
// an error there because the author asserted a ladder the map does not deliver. But such a map
// compiles, loads and plays perfectly — and a designer halfway through cutting a cliff has a dozen
// of them at all times. Blocking on those would mean the headline feature refuses to run for most
// of the session it exists to serve.
//
// So the gate is: does the map LOAD? `shape.*` means compileMap throws or the grid is ragged, and
// mapdata.js's `local:` branch would silently fall back to Wendford — the single most confusing
// outcome this feature can produce. `spawn.*` means a unit cannot be placed and Battle throws.
// `prop.unknown-type` and `prop.oob-unsafe` throw inside buildProps. Everything else is a design
// finding: the author is TOLD, and plays anyway.
const BLOCKS = (code) => /^(shape|spawn)\./.test(code) || code === 'prop.unknown-type' || code === 'prop.oob-unsafe' || code === 'import.throws';

/**
 * @returns {{ok:boolean, blocking:Array, errors:Array, warnings:Array, issues:Array}}
 *   `blocking` is what stops the run; `errors` is validate.js's full error list, so a caller can
 *   still show the design failures it chose not to enforce.
 */
export function precheck(def) {
  const r = validateDef(def, { strict: false });
  const blocking = r.errors.filter((i) => BLOCKS(i.code));
  return { ok: blocking.length === 0, blocking, errors: r.errors, warnings: r.warnings, issues: r.issues };
}

/**
 * Write the slot and prove it reads back. The read-back is not paranoia: localStorage silently
 * refuses a write that overruns quota on some engines, and the failure mode of NOT checking is the
 * game loading the PREVIOUS playtest — an author debugging an edit that "did nothing".
 * @returns {{ok:boolean, slot:string, hash:string, bytes:number, error?:string, evicted?:string[]}}
 */
export function commit(def, slot = PLAYTEST_SLOT) {
  const hash = hashDef(def);
  const w = writeSlot(slot, def);
  if (!w.ok) return { ok: false, slot, hash, bytes: 0, error: w.error, evicted: w.evicted };
  let back = null;
  try { back = readSlot(slot); } catch (e) { return { ok: false, slot, hash, bytes: w.bytes, error: `slot did not read back: ${(e && e.message) || e}` }; }
  if (!back) return { ok: false, slot, hash, bytes: w.bytes, error: 'slot read back empty' };
  // writeSlot stamps `x-.savedAt`, so the stored hash is expected to differ from the live one; what
  // must match is the document MINUS that stamp, which is what re-hashing the original `x-` gives.
  const backHash = hashDef({ ...back.def, 'x-': def['x-'] || {} });
  if (backHash !== hash) return { ok: false, slot, hash, bytes: w.bytes, error: `slot round trip changed the document (${hash} -> ${backHash})` };
  return { ok: true, slot, hash, bytes: w.bytes, evicted: w.evicted, coercions: back.coercions };
}

/**
 * The click. Call it from a handler; do not await anything before it.
 * @param {object} def the live document (session.def is fine — it is only read)
 * @param {{slot?:string, open?:boolean, force?:boolean, extra?:object, target?:string}} [o]
 *   open:false  — commit the slot and return the URL without opening anything (headless tests)
 *   force:true  — run despite validation errors, for an author deliberately testing a broken map
 * @returns {{ok:boolean, url:string, slot:string, hash?:string, blocked?:boolean,
 *            win?:Window|null, errors?:Array, warnings?:Array, error?:string}}
 */
export function run(def, o = {}) {
  const slot = o.slot || PLAYTEST_SLOT;
  const url = playtestUrl(slot, o.extra);
  const v = precheck(def);
  if (!v.ok && !o.force) return { ok: false, url, slot, blocking: v.blocking, errors: v.errors, warnings: v.warnings, error: `${v.blocking.length} issue(s) would stop the map loading` };
  const c = commit(def, slot);
  if (!c.ok) return { ok: false, url, slot, blocking: v.blocking, errors: v.errors, warnings: v.warnings, error: c.error };
  const rest = { blocking: v.blocking, errors: v.errors, warnings: v.warnings };
  if (o.open === false) return { ok: true, url, slot, hash: c.hash, win: null, ...rest };
  let win = null;
  try { win = window.open(url, o.target || WINDOW_NAME); } catch { win = null; }
  // A blocked popup is a success with a caveat, not a failure: the slot IS written and the URL IS
  // valid, so the shell shows it as a link the author can click themselves.
  if (win && typeof win.focus === 'function') { try { win.focus(); } catch { /* cross-origin focus */ } }
  return { ok: true, url, slot, hash: c.hash, win, blocked: !win, ...rest };
}

/** Reload an already-open playtest window in place — the tight loop: edit, Ctrl+Enter, look. */
export function refresh(def, o = {}) {
  const r = run(def, { ...o, open: false });
  if (!r.ok) return r;
  let win = null;
  try { win = window.open(r.url, o.target || WINDOW_NAME); } catch { win = null; }
  return { ...r, win, blocked: !win };
}
