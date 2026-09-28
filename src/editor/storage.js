// Named localStorage slots, the autosave ring, the heartbeat and crash recovery (PLAN §6.8).
//
// THE PREFIX IS NOT OURS TO CHOOSE. src/world/mapdata.js already reads `?map=local:<slot>` out of
// `SLOT_PREFIX + slot`, so it is imported rather than retyped: a slot this file writes is a slot the
// GAME can load, which is the entire mechanism playtest.js rides on. Retyping the string would work
// until the day mapdata.js changed it, and then playtest would fail silently by loading Wendford.
//
// WHY A RING AND NOT ONE AUTOSAVE KEY. A single rolling autosave overwrites the good copy with the
// bad one the moment an author does something they regret and then leaves the tab open; eight keys
// mean the last eight snapshots are all recoverable, and every one of them is a real `local:__autoN`
// the game and the editor can open by name with no import path.
//
// THE HEARTBEAT IS THE ONLY WAY TO KNOW A TAB DIED. There is no 'crashed' event; there is only a
// clean exit that clears `open`, and its absence. So the session record carries `open:true` plus a
// timestamp refreshed on a timer, `beforeunload` clears it, and a boot that finds `open:true` knows
// the previous session did not get to say goodbye.
import { SLOT_PREFIX } from '../world/mapdata.js';
import { toJson, parseDef, hashDef } from '../world/mapformat/serialize.js';
import { normalizeDef } from '../world/mapformat/normalize.js';

export { SLOT_PREFIX };
/** Editor bookkeeping lives OUTSIDE the slot prefix: a meta record under it would list as a map. */
export const META_KEY = 'cinderbanner.editor.session';
export const RING = 8;
export const AUTO_PREFIX = '__auto';
export const PLAYTEST_SLOT = '__playtest';
/** mapdata.js's own slot rule. A key is not a path; this bounds length and charset only. */
export const SLOT_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const HEARTBEAT_MS = 4000;

const LS = () => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };
/** @returns {boolean} whether slots can be read and written here at all (private mode, node, CSP). */
export function available() { const s = LS(); if (!s) return false; try { s.setItem('cinderbanner.probe', '1'); s.removeItem('cinderbanner.probe'); return true; } catch { return false; } }
export function slotKey(name) { if (!SLOT_RE.test(name)) throw new Error(`bad slot name '${name}'`); return SLOT_PREFIX + name; }
export const isAuto = (name) => name.startsWith(AUTO_PREFIX);
const now = () => Date.now();
const readJson = (s, k) => { try { const t = s.getItem(k); return t ? JSON.parse(t) : null; } catch { return null; } };

/** Every slot on this origin, newest first. `at`/`id`/`name` are read out of the document itself so
 *  a picker can label a slot without the caller parsing eight of them. */
export function listSlots() {
  const s = LS();
  if (!s) return [];
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (!k || !k.startsWith(SLOT_PREFIX)) continue;
    const name = k.slice(SLOT_PREFIX.length), text = s.getItem(k) || '';
    let doc = null;
    try { doc = JSON.parse(text); } catch { /* a hand-edited slot still lists, it just has no label */ }
    out.push({ name, bytes: text.length, auto: isAuto(name),
      id: (doc && doc.id) || null, label: (doc && doc.name) || name,
      at: (doc && doc['x-'] && doc['x-'].savedAt) || 0 });
  }
  return out.sort((a, b) => b.at - a.at || (a.name < b.name ? -1 : 1));
}

export function readSlotText(name) { const s = LS(); return s ? s.getItem(slotKey(name)) : null; }

/** Untrusted text: parse, then NORMALIZE, and hand back what had to be repaired. A slot is the one
 *  input path that survives a schema change and a hand edit, so it is never trusted as-is. */
export function readSlot(name) {
  const text = readSlotText(name);
  if (!text) return null;
  const { def, coercions } = normalizeDef(parseDef(text));
  return { def, coercions };
}

/**
 * Write a document to a named slot, stamping `x-.savedAt` so listSlots can order without a side
 * table. On a full quota the AUTOSAVE RING is evicted oldest-first and the write retried — losing an
 * old snapshot to save the live document is the right trade and the only one this can make.
 * @returns {{ok:boolean, bytes:number, evicted:string[], error?:string}}
 */
export function writeSlot(name, def) {
  const s = LS();
  if (!s) return { ok: false, bytes: 0, evicted: [], error: 'no localStorage on this origin' };
  const key = slotKey(name);
  const stamped = { ...def, 'x-': { ...(def['x-'] || {}), savedAt: now(), hash: hashDef(def) } };
  const text = toJson(stamped);
  const evicted = [];
  for (let attempt = 0; attempt < RING + 1; attempt++) {
    try { s.setItem(key, text); return { ok: true, bytes: text.length, evicted }; }
    catch (e) {
      // DOMException name is the only portable signal; Safari's code is 22, Firefox's is 1014.
      const quota = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
      if (!quota) return { ok: false, bytes: 0, evicted, error: String((e && e.message) || e) };
      const victim = listSlots().filter((r) => r.auto && r.name !== name).sort((a, b) => a.at - b.at)[0];
      if (!victim) return { ok: false, bytes: 0, evicted, error: 'localStorage is full and no autosave is left to evict' };
      s.removeItem(SLOT_PREFIX + victim.name); evicted.push(victim.name);
    }
  }
  return { ok: false, bytes: 0, evicted, error: 'localStorage is full' };
}

export function deleteSlot(name) { const s = LS(); if (s) s.removeItem(slotKey(name)); return !!s; }

/** The session record: what a boot reads to decide whether the last tab died mid-edit. */
export function readMeta() { const s = LS(); return s ? readJson(s, META_KEY) : null; }
function writeMeta(patch) {
  const s = LS();
  if (!s) return null;
  const next = { ...(readJson(s, META_KEY) || {}), ...patch };
  try { s.setItem(META_KEY, JSON.stringify(next)); } catch { /* meta is a convenience, never a blocker */ }
  return next;
}

export class Storage {
  /**
   * @param {{session:object, everyMs?:number, ring?:number, onEvent?:(e:object)=>void}} o
   *   `session` is editor/session.js — subscribed to for the dirty flag, never written to.
   */
  constructor({ session, everyMs = HEARTBEAT_MS, ring = RING, onEvent = null }) {
    this.session = session; this.everyMs = everyMs; this.ring = ring; this.onEvent = onEvent;
    this.slot = null;                 // the named slot Ctrl+S goes to, once chosen
    this.dirty = false; this.index = 0; this.lastAuto = 0; this.lastHash = null;
    this._timer = null; this._off = null; this._unload = null;
  }
  _say(e) { if (this.onEvent) { try { this.onEvent(e); } catch (err) { console.error('[storage] listener threw', err); } } }

  /** Arm the heartbeat and the unload hook. Idempotent. */
  start() {
    if (this._timer || !available()) return this;
    const m = readMeta() || {};
    this.index = Number.isInteger(m.ring) ? m.ring : 0;
    this.lastHash = this.session ? this.session.hash() : null;
    writeMeta({ open: true, t: now(), ring: this.index, slot: this.slot, hash: this.lastHash });
    if (this.session && typeof this.session.on === 'function') this._off = this.session.on('change', () => { this.dirty = true; });
    this._timer = setInterval(() => this.beat(), this.everyMs);
    // `beforeunload` is what separates a clean exit from a crash. pagehide covers the mobile/bfcache
    // path where beforeunload never fires; both write the same record, so a double fire is harmless.
    this._unload = () => this.close();
    if (typeof window !== 'undefined') { window.addEventListener('beforeunload', this._unload); window.addEventListener('pagehide', this._unload); }
    return this;
  }
  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    if (this._off) this._off();
    this._off = null;
    if (this._unload && typeof window !== 'undefined') { window.removeEventListener('beforeunload', this._unload); window.removeEventListener('pagehide', this._unload); }
    this._unload = null;
    return this;
  }
  /** One heartbeat: refresh the timestamp, and autosave if the document actually moved. A hash
   *  compare rather than the dirty flag alone, so an edit-then-undo does not burn a ring entry. */
  beat() {
    if (!this.session) return null;
    const hash = this.session.hash();
    writeMeta({ open: true, t: now(), ring: this.index, slot: this.slot, hash });
    if (!this.dirty || hash === this.lastHash) return null;
    return this.autosave(hash);
  }
  /** Write the next ring entry. @returns {{ok:boolean, slot:string, evicted:string[], error?:string}} */
  autosave(hash = null) {
    const name = AUTO_PREFIX + (this.index % this.ring);
    const res = writeSlot(name, this.session.def);
    if (res.ok) {
      this.index = (this.index + 1) % this.ring;
      this.dirty = false; this.lastAuto = now(); this.lastHash = hash || this.session.hash();
      writeMeta({ ring: this.index, autosavedAt: this.lastAuto, hash: this.lastHash, open: true, t: now() });
    }
    this._say({ kind: res.ok ? 'autosave' : 'autosave-failed', slot: name, ...res });
    return { ...res, slot: name };
  }
  /** Explicit save to a named slot. Clears dirty and records the slot as the session's home. */
  save(name = this.slot) {
    if (!name) return { ok: false, slot: null, evicted: [], error: 'no slot chosen' };
    const res = writeSlot(name, this.session.def);
    if (res.ok) { this.slot = name; this.dirty = false; this.lastHash = this.session.hash(); writeMeta({ slot: name, savedAt: now(), hash: this.lastHash, open: true, t: now() }); }
    this._say({ kind: res.ok ? 'save' : 'save-failed', slot: name, ...res });
    return { ...res, slot: name };
  }
  /** Clean exit: the ABSENCE of this is what crash recovery detects, so it runs on unload and on
   *  dispose, and it takes one last autosave with it when there is anything unsaved to take. */
  close() {
    if (this.dirty && this.session) { try { this.autosave(); } catch { /* an unload is not the place to throw */ } }
    writeMeta({ open: false, t: now(), closedAt: now() });
    return this;
  }
  dispose() { this.stop(); this.close(); return this; }

  /**
   * Boot-time crash check. `open:true` in the record means the previous tab never ran close(), so
   * the newest ring entry is work nobody chose to discard.
   * @returns {{found:boolean, why?:string, slot?:string, at?:number, def?:object, hash?:string}}
   */
  static recover() {
    if (!available()) return { found: false, why: 'no localStorage' };
    const m = readMeta();
    if (!m || m.open !== true) return { found: false, why: m ? 'last session exited cleanly' : 'no previous session' };
    const newest = listSlots().filter((r) => r.auto).sort((a, b) => b.at - a.at)[0];
    if (!newest) return { found: false, why: 'no autosave to recover' };
    let read = null;
    try { read = readSlot(newest.name); } catch (e) { return { found: false, why: `autosave '${newest.name}' is unreadable: ${(e && e.message) || e}` }; }
    if (!read) return { found: false, why: `autosave '${newest.name}' is empty` };
    return { found: true, slot: newest.name, at: newest.at, def: read.def, hash: m.hash || null,
      coercions: read.coercions, label: newest.label };
  }
  /** Mark the crash record consumed, so declining recovery once does not re-offer on every reload. */
  static clearRecovery() { writeMeta({ open: false, t: now(), recoveredAt: now() }); }
}
