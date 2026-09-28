// Campaign persistence: one versioned save slot in localStorage plus a rolling backup, and the player's options.
// Every read is defensive: a missing, truncated or hand-edited save never throws out of here. A save that fails
// validation is copied aside (cinderbanner.save.corrupt) and the backup is tried; if that fails too the game simply has
// no save (Continue greys out) instead of crashing on boot.

// v2 (R10): equipment. A shared item inventory (sv.inventory = { itemId: count not worn }) and per-record `equip`
// (src/game/equipment.js). The storage key keeps its historical name; the version lives inside the save.
import { ITEMS, starterKit, ensureEquip, fitEquip } from '../game/equipment.js';
import { swearHero, HERO_JOBS } from '../game/progression.js';
import { START_ROSTER, CHAPTERS, setChapter } from './data.js';
import { ABILITIES } from '../game/data.js';
export const SAVE_VERSION = 2;
const KEY = 'cinderbanner.save.v1', BAK = 'cinderbanner.save.v1.bak', BAD = 'cinderbanner.save.corrupt';

function store() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }
function readJSON(key) { const s = store(); if (!s) return null; try { const t = s.getItem(key); return t ? JSON.parse(t) : null; } catch { return undefined; } }

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
/** Structural check + repair of a parsed save. Returns the save or null when it is not salvageable. */
export function validate(sv) {
  if (!isObj(sv) || typeof sv.v !== 'number' || !Array.isArray(sv.roster)) return null;
  if (sv.v > SAVE_VERSION) return null;                     // from a newer build: refuse rather than mangle
  const roster = sv.roster.filter((r) => isObj(r) && typeof r.id === 'string' && typeof r.cls === 'string' && typeof r.name === 'string');
  if (!roster.length) return null;
  // ---- migrations (each step keeps every field it does not know about) ----
  if (sv.v < 2) {
    // v1 -> v2: nobody owned anything, so nothing can be lost. Every soldier is issued the kit a recruit of their job
    // arrives with today (the job's tier-1 weapon, its shield, tier-1 body armour) and the company chest starts empty.
    sv.inventory = isObj(sv.inventory) ? sv.inventory : {};
    for (const r of roster) if (!isObj(r.equip)) { r.equip = starterKit(r.cls, r.support); if (r.hero) r.equip.acc = 'oath_signet'; }   // the captain's signet, as a new game issues it
    sv.migratedFrom = sv.migratedFrom || sv.v;
  }
  const inventory = {};
  if (isObj(sv.inventory)) for (const [id, n] of Object.entries(sv.inventory)) { const c = Math.floor(+n); if (ITEMS[id] && c > 0) inventory[id] = Math.min(99, c); }
  for (const r of roster) {
    r.lvl = Math.max(1, Math.min(99, Math.floor(+r.lvl || 1))); r.exp = Math.max(0, Math.floor(+r.exp || 0));
    r.brv = Math.max(30, Math.min(90, Math.floor(+r.brv || 60)));
    for (const k of ['jp', 'jobLv', 'learned']) if (!isObj(r[k])) r[k] = {};
    // drop learned ids that no longer exist (R12 renamed the Oathknight signature Emberbrand -> Oathfire)
    for (const [cls, l] of Object.entries(r.learned)) if (Array.isArray(l)) r.learned[cls] = l.filter((id) => typeof id === 'string' && (id.includes(':') || ABILITIES[id])); else r.learned[cls] = [];
    // a hand-edited or damaged equip map is repaired slot by slot (unknown ids dropped), never discarded whole
    if (isObj(r.equip)) ensureEquip(r); else r.equip = starterKit(r.cls, r.support);
    // R12: the captain's hero job. A save from before it existed still holds Aldric as a plain Knight: he swears the
    // Ember Oath on load (the job, its R/S/M and the starting JP a new game gives), and moves into it if he is still a
    // Knight. Additive, so the save version does not change; a hero who already has the job is left exactly as he is.
    if (r.hero) { const st = START_ROSTER.find((s) => s.hero && (s.key === r.key || s.name === r.name)) || START_ROSTER.find((s) => s.hero);
      const job = st?.heroJob; if (job && HERO_JOBS.has(job) && r.jobLv[job] == null) { swearHero(r, job, { jp: st.heroJp || 0, wear: r.cls === 'knight' }); fitEquip({ inventory }, r); } }
  }
  const ids = new Set(roster.map((r) => r.id));
  // Chapter II: sv.chapter is the furthest chapter ENTERED (1 or 2). A save that finished Chapter I before Chapter II existed
  // keeps chapter 1 here; the world map notices the finished chapter and plays the transition (campaign.chapterPending).
  const chapter = Math.max(1, Math.min(CHAPTERS.length, Math.floor(+sv.chapter || 1)));
  setChapter(chapter);
  return {
    v: SAVE_VERSION, created: +sv.created || Date.now(), updated: +sv.updated || Date.now(), playMs: +sv.playMs || 0,
    chapter, florins: Math.max(0, Math.floor(+sv.florins || 0)), roster, inventory,
    party: (Array.isArray(sv.party) ? sv.party : []).filter((id) => ids.has(id)).slice(0, 5),
    cleared: isObj(sv.cleared) ? sv.cleared : {}, seen: isObj(sv.seen) ? sv.seen : {},
    at: typeof sv.at === 'string' ? sv.at : 'hollin', hired: +sv.hired || 0,
    current: isObj(sv.current) ? sv.current : null, last: isObj(sv.last) ? sv.last : null,
    ...(sv.migratedFrom ? { migratedFrom: sv.migratedFrom } : {}),
  };
}

export function loadSave() {
  const main = readJSON(KEY);
  if (main == null) return null;                              // no save at all (or no storage)
  const ok = main === undefined ? null : validate(main);
  if (ok) return ok;
  const s = store(); try { s?.setItem(BAD, s.getItem(KEY) || ''); } catch { /* full storage: nothing to keep */ }
  console.warn('campaign: save failed validation; trying backup');
  const bak = readJSON(BAK); const okb = bak ? validate(bak) : null;
  if (okb) { writeSave(okb, { backup: false }); return okb; }
  return null;
}
export function hasSave() { return !!loadSave(); }

export function writeSave(sv, { backup = true } = {}) {
  const s = store(); if (!s) return false;
  sv.updated = Date.now();
  try {
    if (backup) { const prev = s.getItem(KEY); if (prev) s.setItem(BAK, prev); }
    s.setItem(KEY, JSON.stringify(sv)); return true;
  } catch (e) { console.warn('campaign: save failed', e); return false; }
}
export function eraseSave() { const s = store(); try { s?.removeItem(KEY); s?.removeItem(BAK); } catch { /* ignore */ } }

// ---- options (independent of the save: New Game keeps them) ----
// The record, its defaults and its repair live in src/ui/prefs.js (pure; the battle HUD, camera and VFX read it too).
// Same storage key as always ('cinderbanner.options'), so options saved by older builds carry over.
import { SPEEDS, prefs, setPrefs, speedValue } from '../ui/prefs.js';
export { SPEEDS, speedValue };
export function loadOptions() { return { ...prefs() }; }
export function saveOptions(o) { setPrefs(o); }
