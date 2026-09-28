// ONE binding table (PLAN §6.11). Every shortcut in the editor is a row below and nowhere else: the
// help overlay, the menu `kbd` hints and the dispatcher all read this array, so a shortcut cannot be
// documented as one thing and bound as another. That is the entire reason the table is data and the
// dispatcher is eight lines.
//
// TWO CLASSES OF DUPLICATE, TWO REACTIONS. A collision inside BINDINGS is a bug in THIS file and
// throws at module load — loud, immediate, before a single frame. A collision between BINDINGS and a
// registry record's own `key` hint belongs to whoever wrote that record, in a file this worker does
// not own, so it is a console.warn and the registry hint loses. Booting a whole editor face-down
// because a sibling's brush claimed 'b' would be the wrong trade.
//
// CAMERA KEYS ARE THE GAME'S, DELIBERATELY: q / e rotate, t toggles pitch, +/- and the wheel zoom,
// exactly as src/main.js binds them. An author who learns the camera here already knows it in play.
// Zero DOM at module scope; attach() is what touches a window.
import { keyHints } from './registry.js';

/** Modifier order in a chord string. Fixed, so 'shift+ctrl+z' can never be written by accident. */
const MOD_ORDER = ['ctrl', 'alt', 'shift'];
/** Typing targets swallow everything except Escape — a shortcut that fires while an author is
 *  naming a map is worse than a shortcut that does not fire. */
const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;

/**
 * The table. `action` is the verb main.js dispatches; `arg` is its one parameter; `group` is the
 * help overlay's section. `id` (optional) names a registry record to run instead of a verb.
 * @type {ReadonlyArray<{chord:string, action:string, arg?:any, label:string, group:string}>}
 */
export const BINDINGS = Object.freeze([
  // ---- file
  { chord: 'ctrl+n', action: 'file.new', label: 'New map…', group: 'File' },
  { chord: 'ctrl+o', action: 'file.import', label: 'Import module or JSON…', group: 'File' },
  { chord: 'ctrl+s', action: 'file.save', label: 'Save to slot', group: 'File' },
  { chord: 'ctrl+shift+s', action: 'file.saveAs', label: 'Save as… (slot name)', group: 'File' },
  { chord: 'ctrl+e', action: 'file.exportModule', label: 'Export ES module', group: 'File' },
  { chord: 'ctrl+shift+e', action: 'file.exportJson', label: 'Export JSON', group: 'File' },
  { chord: 'ctrl+shift+m', action: 'file.writeMaps', label: 'Write to src/world/maps/', group: 'File' },
  // ---- the headline: play the map you are editing, in the real game
  { chord: 'ctrl+enter', action: 'playtest.run', label: 'Playtest in the game', group: 'File' },
  // ---- edit
  { chord: 'ctrl+z', action: 'edit.undo', label: 'Undo', group: 'Edit' },
  { chord: 'ctrl+shift+z', action: 'edit.redo', label: 'Redo', group: 'Edit' },
  { chord: 'ctrl+y', action: 'edit.redo', label: 'Redo (alt)', group: 'Edit' },
  { chord: 'ctrl+c', action: 'edit.copy', label: 'Copy selection', group: 'Edit' },
  { chord: 'ctrl+x', action: 'edit.cut', label: 'Cut selection', group: 'Edit' },
  { chord: 'ctrl+v', action: 'edit.paste', label: 'Paste stamp', group: 'Edit' },
  { chord: 'm', action: 'edit.symmetry', label: 'Cycle symmetry mode', group: 'Edit' },
  // ---- selection
  { chord: 'ctrl+a', action: 'sel.all', label: 'Select all', group: 'Selection' },
  { chord: 'ctrl+d', action: 'sel.none', label: 'Deselect', group: 'Selection' },
  { chord: 'ctrl+i', action: 'sel.invert', label: 'Invert selection', group: 'Selection' },
  { chord: '.', action: 'sel.grow', label: 'Grow selection', group: 'Selection' },
  { chord: ',', action: 'sel.shrink', label: 'Shrink selection', group: 'Selection' },
  // ---- brush
  { chord: '[', action: 'brush.size', arg: -1, label: 'Brush smaller', group: 'Brush' },
  { chord: ']', action: 'brush.size', arg: 1, label: 'Brush bigger', group: 'Brush' },
  { chord: 'shift+[', action: 'brush.size', arg: -4, label: 'Brush much smaller', group: 'Brush' },
  { chord: 'shift+]', action: 'brush.size', arg: 4, label: 'Brush much bigger', group: 'Brush' },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ chord: String(n), action: 'tool.slot', arg: n - 1,
    label: `Tool ${n}`, group: 'Brush' })),
  // ---- camera (src/main.js's bindings, verbatim)
  { chord: 'q', action: 'cam.rotate', arg: 1, label: 'Rotate camera left', group: 'Camera' },
  { chord: 'e', action: 'cam.rotate', arg: -1, label: 'Rotate camera right', group: 'Camera' },
  { chord: 't', action: 'cam.pitch', label: 'Toggle pitch (30° / 48°)', group: 'Camera' },
  { chord: '=', action: 'cam.zoom', arg: 1.2, label: 'Zoom in', group: 'Camera' },
  { chord: '+', action: 'cam.zoom', arg: 1.2, label: 'Zoom in', group: 'Camera' },
  { chord: '-', action: 'cam.zoom', arg: 1 / 1.2, label: 'Zoom out', group: 'Camera' },
  { chord: 'f', action: 'cam.frame', label: 'Frame the whole map', group: 'Camera' },
  // ---- layers: alt+N shows/hides, ctrl+alt+N locks. Index order is layers.js's LAYERS.
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ chord: `alt+${n}`, action: 'layer.visible', arg: n - 1,
    label: `Toggle layer ${n} visibility`, group: 'Layers' })),
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ chord: `ctrl+alt+${n}`, action: 'layer.lock', arg: n - 1,
    label: `Toggle layer ${n} lock`, group: 'Layers' })),
  // ---- view / shell
  { chord: 'f9', action: 'view.dock', label: 'Show/hide the side dock', group: 'View' },
  { chord: 'f10', action: 'view.rail', label: 'Show/hide the tool rail', group: 'View' },
  { chord: '?', action: 'help.keys', label: 'This list', group: 'View' },
  { chord: 'escape', action: 'ui.cancel', label: 'Close overlay / cancel gesture', group: 'View' },
  // A polygon has no natural end — the lasso and the route tool bank vertices until something says
  // stop. Enter is that something, alongside a double-click and a right-click on the canvas.
  { chord: 'enter', action: 'ui.commit', label: 'Close the polygon being drawn', group: 'View' },
]);

/** Fail at module load rather than at the keystroke: two rows on one chord means one is dead code
 *  and no amount of testing the live one will ever reveal it. */
function assertUnique(rows) {
  const seen = new Map(), dup = [];
  for (const b of rows) {
    // Same chord AND same action is a deliberate alias row (ctrl+y is redo twice over); same chord
    // with a DIFFERENT action is the collision this assert exists for.
    const prev = seen.get(b.chord);
    if (prev && prev.action !== b.action) dup.push(`'${b.chord}' is both ${prev.action} and ${b.action}`);
    else if (!prev) seen.set(b.chord, b);
  }
  if (dup.length) throw new Error(`keymap: duplicate binding(s) — ${dup.join('; ')}`);
  return seen;
}
const STATIC = assertUnique(BINDINGS);

/** Canonical chord text from parts. Exported because the menubar prints hints with it. */
export function chordOf({ ctrl = false, alt = false, shift = false, key = '' }) {
  const mods = MOD_ORDER.filter((m) => ({ ctrl, alt, shift })[m]);
  return [...mods, String(key).toLowerCase()].join('+');
}

/** A key event's chord candidates, best first. Two are produced because a physical digit under Alt
 *  reports a symbol as `key` on several layouts, so alt+1 must also be findable through `code`. */
export function chordsOf(ev) {
  const key = String(ev.key || '');
  const lower = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  // Shift is IMPLIED by a punctuation symbol ('?' is already shift+'/'), so carrying it as well
  // would make the table read 'shift+?' and never match what a US and a UK layout both send.
  const punct = key.length === 1 && !/[a-z0-9]/i.test(key);
  const out = [chordOf({ ctrl: ev.ctrlKey || ev.metaKey, alt: ev.altKey, shift: ev.shiftKey && !punct, key: lower })];
  const code = /^(?:Digit|Key)(.)$/.exec(ev.code || '');
  if (code) {
    const c = chordOf({ ctrl: ev.ctrlKey || ev.metaKey, alt: ev.altKey, shift: ev.shiftKey, key: code[1] });
    if (c !== out[0]) out.push(c);
  }
  return out;
}

/** action -> its FIRST binding. The menubar prints its labels and `kbd` hints through this, so a
 *  menu item and its shortcut can never drift apart: there is one table and the menu reads it. */
const BY_ACTION = new Map();
for (const b of BINDINGS) if (!BY_ACTION.has(b.action)) BY_ACTION.set(b.action, b);
export function bindingOf(action) { return BY_ACTION.get(action) || null; }

/** Pretty form for a `kbd` element: 'ctrl+shift+z' -> 'Ctrl Shift Z'. */
export function labelOf(chord) {
  return String(chord).split('+').map((p) => (p === '' ? '+' : p[0].toUpperCase() + p.slice(1))).join(' ');
}

export class Keymap {
  /**
   * @param {{dispatch:(action:string, arg:any, ev:KeyboardEvent)=>any,
   *          run?:(id:string, ev:KeyboardEvent)=>any, enabled?:()=>boolean}} o
   *   `run` fires for a registry record's own `key` hint; without it those rows are simply not bound.
   */
  constructor({ dispatch, run = null, enabled = null }) {
    this.dispatch = dispatch; this.run = run; this.enabled = enabled;
    this.map = new Map(STATIC);
    this.hints = [];
    this._off = null;
    this.adopt(keyHints());
  }
  /** Merge registry `key` hints. Late, and after every record is defined, so plugin load order does
   *  not decide who wins — the static table always does. */
  adopt(hints) {
    for (const h of hints || []) {
      const chord = String(h.key || '').toLowerCase();
      if (!chord) continue;
      const prev = this.map.get(chord);
      if (prev) { console.warn(`[keymap] '${chord}' is already ${prev.action || prev.id}; ignoring the hint from '${h.id}'`); continue; }
      const row = { chord, action: 'tool.run', arg: h.id, id: h.id, label: h.id, group: 'Tools' };
      this.map.set(chord, row); this.hints.push(row);
    }
    return this;
  }
  lookup(chord) { return this.map.get(chord) || null; }
  /** @returns {boolean} whether the event was consumed */
  handle(ev) {
    if (this.enabled && !this.enabled()) return false;
    const t = ev.target;
    const typing = t && (TYPING.test(t.tagName || '') || t.isContentEditable);
    if (typing && ev.key !== 'Escape') return false;
    for (const c of chordsOf(ev)) {
      const b = this.map.get(c);
      if (!b) continue;
      ev.preventDefault();
      try {
        if (b.action === 'tool.run' && this.run) this.run(b.arg, ev);
        else this.dispatch(b.action, b.arg, ev);
      } catch (e) { console.error(`[keymap] ${b.action}(${b.arg}) threw`, e); }
      return true;
    }
    return false;
  }
  attach(target = window) {
    const on = (ev) => this.handle(ev);
    target.addEventListener('keydown', on);
    this._off = () => target.removeEventListener('keydown', on);
    return this;
  }
  detach() { if (this._off) this._off(); this._off = null; return this; }
  /** Grouped rows for the help overlay, in table order with registry hints last. */
  rows() {
    const by = new Map();
    for (const b of [...BINDINGS, ...this.hints]) {
      const g = b.group || 'Other';
      if (!by.has(g)) by.set(g, []);
      by.get(g).push({ chord: b.chord, keys: labelOf(b.chord), label: b.label });
    }
    return [...by.entries()].map(([group, keys]) => ({ group, keys }));
  }
}
