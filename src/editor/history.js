// The undo stack (PLAN §3.6, §6.2). It stores session.js patches and nothing else: it never reads
// the document, never knows what a tile is, and never inverts anything — session.revert() owns that.
// All this file decides is WHICH patches are one undo entry and WHEN old ones fall off the end.
//
// Coalescing is the reason a 500-tile drag is one Ctrl+Z and not five hundred. Consecutive commits
// carrying the same `strokeId` and the same `label` merge: cell maps union (first `old` wins, last
// `new` wins, and a cell driven back to its original value drops out entirely, so a stroke that
// scrubs back over itself leaves no residue), op lists concatenate, channels and bounds union.
//
// Two caps, because an unbounded stack on a 48x48 board with a smooth brush is a slow memory leak
// rather than a feature: 200 entries and 32 MB of estimated patch payload, oldest evicted first.
// Estimates, not measurements — there is no portable sizeof in JS — but they are conservative and
// what matters is that the number is monotone in the real cost.
//
// Zero three.js and zero DOM: tools/checks drives this under bare `node`.

export const MAX_ENTRIES = 200;
export const MAX_BYTES = 32 * 1024 * 1024;
// One Map entry holding a two-element array of small values: the entry itself, the array header and
// two slots. V8 is nearer 80 on a 64-bit build; 48 is the floor we bill at, deliberately low so the
// entry cap is what usually bites and the byte cap only catches genuinely enormous strokes.
const CELL_BYTES = 48;
const OP_OVERHEAD = 64;

/** Rough payload size of one patch, cached on it. Ops are billed by their JSON length because the
 *  records they carry (a prop, a design declaration, a whole-document snapshot) are plain data. */
export function patchBytes(p) {
  if (p._bytes !== undefined) return p._bytes;
  let n = 0;
  for (const ch of Object.keys(p.cells || {})) n += (p.cells[ch].size || 0) * CELL_BYTES;
  for (const op of p.ops || []) {
    n += OP_OVERHEAD;
    try { n += JSON.stringify(op.k === 'set' ? [op.o, op.n] : op.k === 'doc' ? [op.o, op.n] : op.rec ?? 0).length * 2; } catch { n += 256; }
  }
  return (p._bytes = n);
}

/** A doc-swap patch replaces the whole document, so merging one into a cell stroke would produce a
 *  patch that cannot be replayed forwards and reverted backwards in the same order. */
const hasDoc = (p) => (p.ops || []).some((o) => o.k === 'doc');

/** Same stroke, same tool. A null strokeId means "this commit stands alone" — which is what every
 *  discrete action (place a prop, declare a face, paste) leaves it as. */
export function canCoalesce(a, b) {
  return !!a && !!b && a.strokeId != null && a.strokeId === b.strokeId && a.label === b.label
    && !hasDoc(a) && !hasDoc(b);
}

/** Merge `b` into `a` in place. `a` keeps its label, strokeId and seq origin; `b` is discarded. */
export function coalesce(a, b) {
  for (const ch of Object.keys(b.cells || {})) {
    const src = b.cells[ch], dst = a.cells[ch] || (a.cells[ch] = new Map());
    for (const [i, ov] of src) {
      const e = dst.get(i);
      if (!e) dst.set(i, [ov[0], ov[1]]);            // copied, not aliased: b may be reused by a test
      else if (e[0] === ov[1]) dst.delete(i);        // scrubbed back to where it started
      else e[1] = ov[1];
    }
  }
  if (b.ops && b.ops.length) a.ops = (a.ops || []).concat(b.ops);
  const ac = new Set(a.channels || []);
  for (const c of b.channels || []) ac.add(c);
  a.channels = [...ac];
  a.bounds = unionBounds(a.bounds, b.bounds);
  a.seq = b.seq;
  a._bytes = undefined;
  return a;
}

export function unionBounds(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), z1: Math.max(a.z1, b.z1) };
}

export class History {
  /** @param {{maxEntries?:number, maxBytes?:number}} [opts] */
  constructor(opts = {}) {
    this.maxEntries = opts.maxEntries ?? MAX_ENTRIES;
    this.maxBytes = opts.maxBytes ?? MAX_BYTES;
    this.past = [];      // oldest first; past[past.length-1] is what undo() returns next
    this.future = [];    // newest first; future[0] is what redo() returns next
    this.bytes = 0;
    this.dropped = 0;    // entries evicted by a cap — the status bar shows "undo history trimmed"
  }
  get depth() { return this.past.length; }
  canUndo() { return this.past.length > 0; }
  canRedo() { return this.future.length > 0; }
  /** The entry undo() would return next, without consuming it (the editor titles its Undo menu item). */
  peek() { return this.past.length ? this.past[this.past.length - 1] : null; }
  peekRedo() { return this.future.length ? this.future[0] : null; }

  /**
   * Record a committed patch. A new commit INVALIDATES redo — the branch the user walked away from
   * is gone, which is the behaviour every editor has and the only one that keeps the stack a stack.
   * @returns {'coalesced'|'pushed'}
   */
  push(patch) {
    if (!patch) return 'pushed';
    this.future.length = 0;
    const top = this.peek();
    if (canCoalesce(top, patch)) {
      this.bytes -= patchBytes(top);
      coalesce(top, patch);
      this.bytes += patchBytes(top);
      this._trim();
      return 'coalesced';
    }
    this.past.push(patch);
    this.bytes += patchBytes(patch);
    this._trim();
    return 'pushed';
  }
  undo() {
    const p = this.past.pop();
    if (!p) return null;
    this.bytes -= patchBytes(p);
    this.future.unshift(p);
    return p;
  }
  redo() {
    const p = this.future.shift();
    if (!p) return null;
    this.past.push(p);
    this.bytes += patchBytes(p);
    return p;
  }
  clear() { this.past.length = 0; this.future.length = 0; this.bytes = 0; this.dropped = 0; }
  /** The status-bar readout: `undo 37 · redo 2 · 1.4 MB`. */
  stats() { return { depth: this.past.length, redo: this.future.length, bytes: this.bytes, dropped: this.dropped,
    maxEntries: this.maxEntries, maxBytes: this.maxBytes }; }

  // The oldest entry always goes first, and the last one standing never does: a stack that trimmed
  // itself to empty would make the very stroke you just drew un-undoable, which is worse than
  // holding one oversized patch. `future` is not billed — it only ever holds entries that were in
  // `past` a moment ago, and re-billing them on redo keeps one accounting rule instead of two.
  _trim() {
    while (this.past.length > 1 && (this.past.length > this.maxEntries || this.bytes > this.maxBytes)) {
      this.bytes -= patchBytes(this.past.shift());
      this.dropped++;
    }
  }
}
