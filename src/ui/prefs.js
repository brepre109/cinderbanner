// Player options: one versioned record in localStorage ('cinderbanner.options', independent of the campaign save, so New Game
// keeps them), the key bindings, the colour-blind palettes and the accessibility scales every module reads.
// PURE: no three.js, no campaign imports, safe to import from the battle HUD, the camera, the sprite shader setup and
// the VFX. DOM work (CSS variables, the battle-page key translator, the hint relabeller) only runs when a document
// exists. Every value here defaults to exactly what the game did before options existed, so a capture with default
// options is pixel-identical to one taken without this module.
//
// API: prefs() -> current options (cached); setPrefs(patch) -> saves, re-applies, notifies; onPrefs(fn) -> unsubscribe;
//      resetPrefs(section); shakeScale(); flashScale(); textRate(); palette(); keysFor(action); keyLabel(action);
//      actionOf(eventOrToken, groups); installKeyTranslator() (battle page); installHintRelabel(page).
const STORE_KEY = 'cinderbanner.options';

export const SPEEDS = [{ id: 'slow', label: 'Slow', v: 0.75 }, { id: 'normal', label: 'Normal', v: 1 }, { id: 'fast', label: 'Fast', v: 1.5 }, { id: 'fastest', label: 'Fastest', v: 2.2 }];
export const TEXT_SPEEDS = [{ id: 'slow', label: 'Slow', k: 0.55 }, { id: 'normal', label: 'Normal', k: 1 }, { id: 'fast', label: 'Fast', k: 1.9 }, { id: 'instant', label: 'Instant', k: 99 }];
export const UI_SCALES = [{ id: 'auto', label: 'Auto' }, { id: '100', label: '100%', z: 1 }, { id: '125', label: '125%', z: 1.25 }, { id: '150', label: '150%', z: 1.5 }];
export const TEXT_SIZES = [{ id: 'normal', label: 'Normal', k: 1 }, { id: 'large', label: 'Large', k: 1.25 }, { id: 'largest', label: 'Largest', k: 1.5 }];
// R15 difficulty (review15 P5). Applied to every campaign enemy by src/campaign/campaign.js enemiesFor / foeOpts and by
// src/game/campaignsim.mjs diff=: lvl is added to each foe's level (min 1), hp scales its max HP, and ai tunes team B's
// AI (src/game/ai.js reads globalThis.AI_TUNE): caution < 1 closes and commits sooner, blunder is the chance a turn
// takes a random worthwhile action instead of the best one. Normal is exactly the shipped game.
export const DIFFICULTIES = [
  { id: 'story', label: 'Story', lvl: -2, hp: 0.85, ai: { caution: 1, blunder: 0.3 }, desc: 'For the tale. Foes are two levels lower, frailer, and fight less sharply.' },
  { id: 'normal', label: 'Normal', lvl: 0, hp: 1, ai: null, desc: 'The intended balance.' },
  { id: 'hard', label: 'Hard', lvl: 1, hp: 1, ai: { caution: 0.8, blunder: 0 }, desc: 'Foes are a level higher and press every advantage.' },
];
export const difficulty = (id = prefs().difficulty) => DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[1];
// REWIND (battle.js): how many of the newest player turns the Rewind window offers. Story difficulty is always unlimited.
export const REWINDS = [{ id: 'off', label: 'Off', n: 0 }, { id: '5', label: '5 turns', n: 5 }, { id: '10', label: '10 turns', n: 10 }, { id: '20', label: '20 turns', n: 20 }, { id: 'unlimited', label: 'Unlimited', n: Infinity }];
export const rewindLimit = (o = prefs()) => (o.difficulty === 'story' ? Infinity : (REWINDS.find((r) => r.id === o.rewind) || REWINDS[2]).n);
export const FLASHES = [{ id: 'full', label: 'Full', k: 1 }, { id: 'reduced', label: 'Reduced', k: 0.4 }, { id: 'minimal', label: 'Minimal', k: 0.1 }];

// ---------------------------------------------------------------- team / field palettes
// teamA/teamB: the sprite team rim, ghost and field-edge ply (src/units/sprites.js TEAM_RIM; pre-compensated for the
// grade like the originals). fields: [wash, edge] per overlay kind (src/ui/overlay.js). css: HUD team marks.
// 'default' is byte-for-byte the shipped look. The others are built so the two SIDES and the move / strike fields
// differ in hue the viewer can see AND in value, never in red-vs-green alone.
export const PALETTES = {
  default: {
    label: 'Default', desc: 'Blue allies, red enemies.',
    teamA: 0x4787c9, teamB: 0xc0452f, op: 0,
    fields: { move: [0x18aeef, 0x65f2ff], target: [0xd8402f, 0xff9a80], area: [0xd8862a, 0xffc068], threat: [0xe0405a, 0xffb3bf], strike: [0xf08a3a, 0xffd3a8] },
    css: { a: '#3d7be0', b: '#d0412e', aHi: '#9fd8ff', bHi: '#ffab9a', aPlate: '#33406e', bPlate: '#5f2b2b', bTab: '#ffa898', bWho: '#ffb6a8', mv: '#4f8fe0', tg: '#d8503a', th: '#c8485c', st: '#e8904a', aw: '#cfe2ff' },
  },
  deutan: {
    label: 'Blue / Orange', desc: 'Deuteranopia and protanopia safe: blue allies, orange enemies, white area.',
    teamA: 0x2f7fd8, teamB: 0xe0860f, op: 0.02,
    fields: { move: [0x1f9ff0, 0x8fe0ff], target: [0xec8a12, 0xffd592], area: [0xd8d8e0, 0xffffff], threat: [0xe88a18, 0xffd8a0], strike: [0xe8d048, 0xfff2a8] },
    css: { a: '#2f86e8', b: '#f0981a', aHi: '#a8dcff', bHi: '#ffd08a', aPlate: '#2d3f73', bPlate: '#6a4414', bTab: '#ffc070', bWho: '#ffcf8a', mv: '#3f9cf0', tg: '#f0961e', th: '#e88a18', st: '#e8d048', aw: '#cfe2ff' },
  },
  tritan: {
    label: 'Cyan / Red', desc: 'Tritanopia safe: cyan allies, crimson enemies, white area.',
    teamA: 0x1fb0c4, teamB: 0xd8304a, op: 0.02,
    fields: { move: [0x12c0d2, 0x9ff4ff], target: [0xe02a48, 0xff9aae], area: [0xe0e0e0, 0xffffff], threat: [0xe02a48, 0xffa8b8], strike: [0xff78b4, 0xffc8e0] },
    css: { a: '#1fb8cc', b: '#e0304c', aHi: '#a8f4ff', bHi: '#ffa8b8', aPlate: '#15525a', bPlate: '#6a1626', bTab: '#ff9aae', bWho: '#ffb0bf', mv: '#22c4d6', tg: '#e8304e', th: '#e02a48', st: '#ff78b4', aw: '#c8f6ff' },
  },
  contrast: {
    label: 'High Contrast', desc: 'Saturated cyan against hot pink, yellow area, brighter fields.',
    teamA: 0x20c8ff, teamB: 0xff2a6a, op: 0.1,
    fields: { move: [0x00c8ff, 0xffffff], target: [0xff2048, 0xffffff], area: [0xffe000, 0xffffff], threat: [0xff2048, 0xffffff], strike: [0xffe000, 0xffffff] },
    css: { a: '#18c0ff', b: '#ff2a64', aHi: '#b8ecff', bHi: '#ffb0c8', aPlate: '#0e3a70', bPlate: '#7a0e30', bTab: '#ff8fb0', bWho: '#ffa8c0', mv: '#00c8ff', tg: '#ff2048', th: '#ff2048', st: '#ffe000', aw: '#d8f4ff' },
  },
};

// ---------------------------------------------------------------- key bindings
// Tokens: a letter is its upper-case character, ' ' is 'Space', everything else is KeyboardEvent.key.
// group 'nav' is shared by every menu and the battle field; 'menu' only exists in the shell's windows and 'battle'
// only on the battle page, so a 'menu' key may repeat a 'battle' key (Q pages a menu and rotates the camera) but a
// 'nav' key may not repeat anything. canon: the key the rest of the battle page's code listens for (the translator
// below re-dispatches a remapped key as its action's canon, so hard-coded listeners follow the player's bindings).
export const ACTIONS = [
  { id: 'up', group: 'nav', label: 'Up', keys: ['ArrowUp', 'W'], canon: 'ArrowUp' },
  { id: 'down', group: 'nav', label: 'Down', keys: ['ArrowDown', 'S'], canon: 'ArrowDown' },
  { id: 'left', group: 'nav', label: 'Left', keys: ['ArrowLeft', 'A'], canon: 'ArrowLeft' },
  { id: 'right', group: 'nav', label: 'Right', keys: ['ArrowRight', 'D'], canon: 'ArrowRight' },
  { id: 'ok', group: 'nav', label: 'Confirm', keys: ['Enter', 'Space', 'Z'], canon: 'Enter', need: true },
  { id: 'back', group: 'nav', label: 'Cancel / Back', keys: ['Escape', 'Backspace', 'X'], canon: 'Escape', need: true },
  { id: 'prev', group: 'menu', label: 'Previous page', keys: ['Q', 'PageUp'], canon: 'PageUp' },
  { id: 'next', group: 'menu', label: 'Next page', keys: ['E', 'PageDown'], canon: 'PageDown' },
  { id: 'rotL', group: 'battle', label: 'Rotate left', keys: ['Q'], canon: 'q' },
  { id: 'rotR', group: 'battle', label: 'Rotate right', keys: ['E'], canon: 'e' },
  { id: 'tilt', group: 'battle', label: 'Tilt camera', keys: ['T'], canon: 't' },
  { id: 'zoomIn', group: 'battle', label: 'Zoom in', keys: ['=', '+'], canon: '+' },
  { id: 'zoomOut', group: 'battle', label: 'Zoom out', keys: ['-'], canon: '-' },
  { id: 'target', group: 'battle', label: 'Next target', keys: ['Tab'], canon: 'Tab' },
  { id: 'status', group: 'battle', label: 'Unit status', keys: ['I'], canon: 'i' },
  { id: 'speed', group: 'battle', label: 'Battle speed', keys: ['F'], canon: 'f' },
  { id: 'ffwd', group: 'battle', label: 'Fast-forward (hold)', keys: ['Shift'], canon: 'Shift' },
  { id: 'threat', group: 'battle', label: 'Threat map (toggle)', keys: ['V'], canon: 'v' },
  { id: 'help', group: 'battle', label: 'Controls window', keys: ['H', '?'], canon: 'h' },
  { id: 'pause', group: 'battle', label: 'Pause menu', keys: ['P', 'F1'], canon: 'p' },
  { id: 'rewind', group: 'battle', label: 'Rewind', keys: ['R'], canon: 'r' },
];
export const ACTION = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
export const SLOTS = 3;
// Keys the browser or a fixed command owns: never bindable (1-9 pick a command, M toggles sound, Tab pages menus).
export const RESERVED = new Set(['F5', 'F11', 'F12', 'Meta', 'Control', 'Alt', 'AltGraph', 'CapsLock', 'ContextMenu', 'OS', 'Dead', 'Unidentified', 'M', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
const conflictGroups = (g) => (g === 'nav' ? ['nav', 'menu', 'battle'] : [g, 'nav']);

export function keyToken(e) {
  const k = typeof e === 'string' ? e : e?.key; if (!k) return null;
  if (k === ' ' || k === 'Spacebar') return 'Space';
  if (k.length === 1) return k.toUpperCase();
  return k;
}
const LABELS = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Backspace: 'Bksp', PageUp: 'PgUp', PageDown: 'PgDn', Delete: 'Del', Insert: 'Ins', Control: 'Ctrl', ' ': 'Space' };
export const tokenLabel = (t) => LABELS[t] || t;

// ---------------------------------------------------------------- storage
const DEFAULTS = { v: 2, music: 8, sfx: 8, speed: 'normal', text: 'normal', endPrompt: true, confirm: false, wrap: true, autoRotate: true,
  uiScale: 'auto', textSize: 'normal', shake: 100, flash: 'full', palette: 'default', difficulty: 'normal', rewind: '10', keys: {} };
export const SECTIONS = { audio: ['music', 'sfx'], gameplay: ['speed', 'text', 'endPrompt', 'confirm', 'wrap', 'autoRotate', 'rewind'], display: ['uiScale', 'textSize', 'shake', 'flash', 'palette'], controls: ['keys'] };
export const defaults = () => JSON.parse(JSON.stringify(DEFAULTS));

function store() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const oneOf = (list, v, d) => (list.some((s) => s.id === v) ? v : d);
const int = (v, lo, hi, d) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
/** Repairs any stored record (hand-edited, older, truncated) into a complete, valid one. Never throws. */
export function sanitize(o) {
  const src = isObj(o) ? o : {}; const out = defaults();
  out.music = int(src.music ?? out.music, 0, 10, DEFAULTS.music); out.sfx = int(src.sfx ?? out.sfx, 0, 10, DEFAULTS.sfx);
  out.difficulty = oneOf(DIFFICULTIES, src.difficulty, 'normal'); out.rewind = oneOf(REWINDS, String(src.rewind ?? '10'), '10');
  out.speed = oneOf(SPEEDS, src.speed, 'normal'); out.text = oneOf(TEXT_SPEEDS, src.text, 'normal');
  for (const k of ['endPrompt', 'confirm', 'wrap', 'autoRotate']) if (typeof src[k] === 'boolean') out[k] = src[k];
  out.uiScale = oneOf(UI_SCALES, String(src.uiScale ?? 'auto'), 'auto'); out.textSize = oneOf(TEXT_SIZES, src.textSize, 'normal');
  out.shake = int(src.shake ?? 100, 0, 100, 100); out.shake -= out.shake % 10;
  out.flash = oneOf(FLASHES, src.flash, 'full'); out.palette = PALETTES[src.palette] ? src.palette : 'default';
  if (isObj(src.keys)) for (const [id, list] of Object.entries(src.keys)) {
    if (!ACTION[id] || !Array.isArray(list)) continue;
    const l = list.slice(0, SLOTS).map((t) => (typeof t === 'string' && t && !RESERVED.has(t) ? t : null));
    while (l.length < SLOTS) l.push(null); out.keys[id] = l;
  }
  return out;
}
let cache = null;
export function prefs() {
  if (cache) return cache;
  let raw = null; const s = store(); try { const t = s?.getItem(STORE_KEY); raw = t ? JSON.parse(t) : null; } catch { raw = null; }
  cache = sanitize(raw); return cache;
}
const subs = new Set();
export function onPrefs(fn) { subs.add(fn); return () => subs.delete(fn); }
function publish(prev) { applyDisplay(); for (const fn of [...subs]) { try { fn(cache, prev); } catch (e) { console.warn('prefs subscriber', e); } } }
/** Merge a patch, persist, re-apply the display state and tell every subscriber (live apply). */
export function setPrefs(patch) {
  const prev = prefs(); cache = sanitize({ ...prev, ...patch, keys: patch.keys ?? prev.keys });
  const s = store(); try { s?.setItem(STORE_KEY, JSON.stringify(cache)); } catch { /* full or blocked storage: live only */ }
  publish(prev); return cache;
}
export function resetPrefs(section) {
  const d = defaults(); const keys = SECTIONS[section] || Object.keys(DEFAULTS); const patch = {};
  for (const k of keys) patch[k] = d[k]; return setPrefs(patch);
}
// Another tab changed the options (a second window on the title screen): follow it.
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === STORE_KEY) { const prev = cache; cache = null; prefs(); publish(prev); } });

// ---------------------------------------------------------------- scalars other modules read every frame (cheap)
export const speedValue = (o = prefs()) => (SPEEDS.find((s) => s.id === o.speed) || SPEEDS[1]).v;
export const shakeScale = () => prefs().shake / 100;
export const flashScale = () => (FLASHES.find((f) => f.id === prefs().flash) || FLASHES[0]).k;
/** Message speed multiplier: 1 = the shipped typewriter / plate timing; bigger is faster. */
export const textRate = () => (TEXT_SPEEDS.find((t) => t.id === prefs().text) || TEXT_SPEEDS[1]).k;
export const palette = (id = prefs().palette) => PALETTES[id] || PALETTES.default;
export function uiZoom() {
  const s = prefs().uiScale; const f = UI_SCALES.find((u) => u.id === s);
  if (f?.z) return f.z;
  return typeof innerWidth !== 'undefined' && innerWidth >= 1700 && innerHeight >= 950 ? 1.5 : 1;
}

// ---------------------------------------------------------------- bindings
export function keysFor(id, o = prefs()) {
  const a = ACTION[id]; if (!a) return [];
  const l = o.keys[id] || a.keys; const out = l.slice(0, SLOTS); while (out.length < SLOTS) out.push(null); return out;
}
export const boundKeys = (id, o) => keysFor(id, o).filter(Boolean);
export const isDefaultBinding = (id, o = prefs()) => { const a = ACTION[id]; const cur = boundKeys(id, o); return cur.length === a.keys.length && cur.every((k, i) => k === a.keys[i]); };
export const bindingsDefault = (o = prefs()) => ACTIONS.every((a) => isDefaultBinding(a.id, o));
/** The action a key token performs among `groups` under the player's bindings (or the defaults with def=true). */
export function actionOf(tok, groups = ['nav', 'battle'], def = false) {
  if (tok && typeof tok === 'object') tok = tok.__cbOrig || keyToken(tok);
  if (!tok) return null; const o = prefs();
  for (const a of ACTIONS) { if (!groups.includes(a.group)) continue; const l = def ? a.keys : boundKeys(a.id, o); if (l.includes(tok)) return a.id; }
  return null;
}
/** Display label of an action's first bound key ('Q', 'Esc', the arrow glyph), or '—' when it has none. */
export function keyLabel(id, i = 0) { const l = boundKeys(id); return l.length ? tokenLabel(l[Math.min(i, l.length - 1)]) : '—'; }
/** Which action (other than `id`, in a group that clashes with id's) already holds `tok`. */
export function conflictOf(id, tok, o = prefs()) {
  const g = conflictGroups(ACTION[id].group);
  for (const a of ACTIONS) if (a.id !== id && g.includes(a.group) && boundKeys(a.id, o).includes(tok)) return a.id;
  return null;
}
/**
 * Bind `tok` to action `id` in slot `slot`. A key already used by a clashing action is SWAPPED: it gets the key this
 * slot held before (or loses it when the slot was empty). Returns { ok, msg, swapped } without saving when refused.
 */
export function bindKey(id, slot, tok) {
  const o = prefs(); const a = ACTION[id]; if (!a) return { ok: false, msg: 'Unknown action.' };
  if (RESERVED.has(tok)) return { ok: false, msg: `${tokenLabel(tok)} is reserved${tok === 'M' ? ' (sound on / off)' : /^[1-9]$/.test(tok) ? ' (pick a command)' : ''}.` };
  const keys = Object.fromEntries(ACTIONS.map((x) => [x.id, keysFor(x.id, o).slice()]));
  const mine = keys[id]; const old = mine[slot];
  if (old === tok) return { ok: true, msg: '' };
  const clash = conflictOf(id, tok, o); let msg = `${a.label}: ${tokenLabel(tok)}.`;
  if (clash) {
    const theirs = keys[clash]; const j = theirs.indexOf(tok);
    // the displaced key takes over the old one, unless that would clash in turn (Q is both a menu and a battle key)
    const g = conflictGroups(ACTION[clash].group);
    const busy = old && (theirs.includes(old) || ACTIONS.some((x) => x.id !== clash && x.id !== id && g.includes(x.group) && keys[x.id].includes(old)));
    theirs[j] = old && !busy ? old : null;
    if (ACTION[clash].need && !theirs.some(Boolean)) return { ok: false, msg: `${tokenLabel(tok)} is ${ACTION[clash].label}'s only key.` };
    msg = `${tokenLabel(tok)} moved from ${ACTION[clash].label}${theirs[j] ? ` (now ${tokenLabel(theirs[j])})` : ''}.`;
  }
  const dup = mine.indexOf(tok); if (dup >= 0) mine[dup] = null;
  mine[slot] = tok;
  setPrefs({ keys: compactKeys(keys) }); return { ok: true, msg, swapped: clash };
}
export function clearKey(id, slot) {
  const o = prefs(); const a = ACTION[id]; const mine = keysFor(id, o).slice(); if (!mine[slot]) return { ok: true, msg: '' };
  if (a.need && mine.filter(Boolean).length <= 1) return { ok: false, msg: `${a.label} needs at least one key.` };
  const keys = Object.fromEntries(ACTIONS.map((x) => [x.id, keysFor(x.id, o).slice()])); keys[id][slot] = null;
  setPrefs({ keys: compactKeys(keys) }); return { ok: true, msg: `${a.label}: slot cleared.` };
}
// Only actions that differ from their defaults are stored.
function compactKeys(keys) {
  const out = {};
  for (const a of ACTIONS) { const l = keys[a.id]; const d = a.keys.slice(0, SLOTS); while (d.length < SLOTS) d.push(null); if (l.some((k, i) => k !== d[i])) out[a.id] = l; }
  return out;
}

// ---------------------------------------------------------------- DOM: display state + palette CSS variables
let lastApplied = '';
export function applyDisplay() {
  if (typeof document === 'undefined') return; const o = prefs(); const r = document.documentElement; const p = palette();
  r.dataset.uiscale = o.uiScale; r.dataset.textsize = o.textSize; r.dataset.palette = o.palette; r.dataset.flash = o.flash;
  const z = uiZoom(); const modal = o.uiScale === 'auto' ? '' : String(Math.max(1, Math.min(z, (innerHeight - 40) / 560, (innerWidth - 40) / 800)).toFixed(3));
  const sig = `${o.palette}|${modal}`; if (sig === lastApplied) return; lastApplied = sig;
  const set = (k, v) => r.style.setProperty(k, v);
  for (const [k, v] of Object.entries(p.css)) set(`--team-${k}`, v);
  if (modal) set('--k-modal-zoom', modal); else r.style.removeProperty('--k-modal-zoom');
}
if (typeof window !== 'undefined') { applyDisplay(); window.addEventListener('resize', () => { lastApplied = ''; applyDisplay(); }); }

// ---------------------------------------------------------------- battle page: key translator
// Code on the battle page (player.js, battleboot.js's camera keys, battlelink.js's pause key, deploy.js) listens for
// fixed keys. Rather than teach every owner the bindings, the HUD installs ONE capture listener ahead of all of them
// (the UI is constructed before the controller, the pause gate and the deploy phase exist): a key the player moved
// is swallowed and re-dispatched as its action's canonical key, and a default key the player took away from an action
// is swallowed. With default bindings every key passes through untouched. Synthetic events carry __cbOrig (the key
// actually pressed) and __cbAction; kit.js's menus read the original so their own bindings still apply.
let menuFocus = () => false; let capturing = false;
/** kit.js reports whether one of its windows has the keyboard (those map keys themselves, from the raw key). */
export const setMenuFocus = (fn) => { menuFocus = fn; };
export const menuFocused = () => { try { return !!menuFocus(); } catch { return false; } };
/** Options' "press a key" capture: the translator stands aside while it is up. */
export const setCapturing = (v) => { capturing = !!v; };
export const isCapturing = () => capturing;
let translating = false;
export function installKeyTranslator(target = typeof window !== 'undefined' ? window : null) {
  if (!target || translating) return; translating = true;
  const handle = (e) => {
    if (e.__cbOrig || capturing || menuFocus()) return;
    const tag = e.target?.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tok = keyToken(e); if (!tok) return;
    const mine = actionOf(tok, ['nav', 'battle']); const def = actionOf(tok, ['nav', 'battle'], true);
    if (mine === def) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!mine) return;
    const a = ACTION[mine];
    const ev = new KeyboardEvent(e.type, { key: a.canon, code: '', shiftKey: e.shiftKey && a.canon !== 'Shift' ? e.shiftKey : a.canon === 'Shift', repeat: e.repeat, bubbles: true, cancelable: true, composed: true });
    Object.defineProperty(ev, '__cbOrig', { value: tok }); Object.defineProperty(ev, '__cbAction', { value: mine });
    (e.target || target).dispatchEvent(ev);
  };
  target.addEventListener('keydown', handle, true); target.addEventListener('keyup', handle, true);
}

// ---------------------------------------------------------------- key hints outside the HUD
// The shell screens, the pause button and the field manual print their keys as <kbd> chips in other modules. With
// non-default bindings, a chip that names a default key is rewritten to the key that now does that job (and restored
// when the bindings go back). The HUD (#ui) and the Options window render their own labels and are skipped.
const HINT_MAP = {
  shell: { Esc: 'back', Enter: 'ok', '↑': 'up', '↓': 'down', '←': 'left', '→': 'right', Q: 'prev', E: 'next' },
  battle: { Esc: 'back', Enter: 'ok', '↑': 'up', '↓': 'down', '←': 'left', '→': 'right', Q: 'rotL', E: 'rotR', T: 'tilt', I: 'status', F: 'speed', V: 'threat', H: 'help', P: 'pause', R: 'rewind', Tab: 'target', Shift: 'ffwd' },
};
let relabelOn = false;
export function installHintRelabel(page) {
  if (relabelOn || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return; relabelOn = true;
  const map = HINT_MAP[page] || HINT_MAP.shell;
  const skip = (el) => el.closest?.('#ui, .k-options');
  const fix = (kb) => {
    if (skip(kb)) return;
    const orig = kb.dataset.k0 ?? kb.textContent.trim(); const id = map[orig]; if (!id) return;
    const want = isDefaultBinding(id) ? orig : keyLabel(id);
    if (kb.textContent !== want) { kb.dataset.k0 = orig; kb.textContent = want; }
  };
  const sweep = (root) => { if (root.nodeType !== 1) return; if (root.tagName === 'KBD') fix(root); else root.querySelectorAll?.('kbd').forEach(fix); };
  const run = () => sweep(document.body);
  const mo = new MutationObserver((recs) => {
    if (bindingsDefault() && !document.querySelector('kbd[data-k0]')) return;
    for (const r of recs) { if (r.target.nodeType === 1 && r.target.closest?.('#ui')) continue; r.addedNodes.forEach(sweep); if (r.type === 'characterData' || r.target.tagName === 'KBD') sweep(r.target.parentElement || r.target); }
  });
  const start = () => { mo.observe(document.body, { childList: true, subtree: true }); run(); };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start, { once: true });
  onPrefs(run);
}
