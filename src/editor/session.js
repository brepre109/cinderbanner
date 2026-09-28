// THE SINGLE MUTATION CHOKEPOINT (PLAN §6.1, §6.2). Nothing in the editor writes to the document
// except through a Transaction, and every write a Transaction makes records its own inverse as it
// goes, so a brush cannot get undo wrong — a brush never writes an inverse, and there is exactly one
// place, revert(), where a patch plays forwards or backwards. The reference editor failed for the
// opposite reason: every brush owned its mutation, so there was nowhere to hang undo and undo was
// never added. Two rules then ride along free: a SELECTION is a write mask (writes outside it no-op,
// so every brush is a region operation with no line in the brush), and SYMMETRY is a fan-out (setH
// writes 1, 2 or 4 cells in one Tx, so a mirrored edit is ONE undo entry, not four that come apart).
// commit() publishes DIRTY CHANNELS so the ladder rebuilds terrain, props or nothing. Zero three.js
// and zero DOM: tools/checks runs this under bare `node`.
import { hashDef } from '../world/mapformat/serialize.js';
import { deckTiles } from '../world/mapformat/compile.js';
import { History } from './history.js';

/** The seven dirty channels. Consumers subscribe to 'change' and read `channels`. */
export const CH = Object.freeze({ H: 'heights', T: 'surfaces', DECK: 'decks', PROP: 'props', SPAWN: 'spawns', DESIGN: 'design', META: 'meta' });
export const CHANNELS = Object.freeze(Object.values(CH));// design kind -> its list in def.design and the id key it is addressed by. `promises` and `waive`
// carry no id, so removePromise/removeWaive take an index (see _indexOf).
const DESIGN_LISTS = Object.freeze({ face: 'faces', choke: 'chokes', route: 'routes', region: 'regions', assist: 'assists', promise: 'promises', waive: 'waive' });
const ID_KEY = Object.freeze({ faces: 'fid', chokes: 'cid', routes: 'rid', regions: 'rgid', assists: 'aid' });
const cp = (v) => (v === null || typeof v !== 'object' ? v : typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
// Path walk for the generic `set` op. Every path used below is rooted in a field blankDef() guarantees.
const at = (o, p) => { let v = o; for (let i = 0; i < p.length - 1; i++) v = v[p[i]]; return v; };
const rd = (o, p) => { const c = at(o, p); return c && c[p[p.length - 1]]; };
const wr = (o, p, v) => { const c = at(o, p); if (c) c[p[p.length - 1]] = v; };
// decks.tiles is a SET stored as an array, and hashDef sees array ORDER — so an undo and a redo that
// rebuilt the same set in a different order would hash differently and the CI drift test would fire
// on a document nobody changed. The list is kept canonically sorted (z-major, the order derivedDecks
// emits) by the one writer both the Tx and revert() go through.
const deckKey = (t, w) => t[1] * w + t[0];
const deckSorted = (l, w) => [...l].sort((a, b) => deckKey(a, w) - deckKey(b, w));
function deckSet(l, x, z, w, on) {
  const k = l.findIndex((t) => t[0] === x && t[1] === z);
  if (!on) { if (k >= 0) l.splice(k, 1); return; }
  if (k < 0) { let i = 0; while (i < l.length && deckKey(l[i], w) < z * w + x) i++; l.splice(i, 0, [x, z]); }
}
// Channel of a path: by its root field, with an unknown root counting as metadata.
const chanOf = (p) => (p[0] === 'design' ? CH.DESIGN : p[0] === 'props' ? CH.PROP : p[0] === 'spawns' ? CH.SPAWN : p[0] === 'decks' ? CH.DECK : p[0] === 'grid' ? CH.H : CH.META);
let PID = 0;
/** Stable handle for a prop across reorders (schema.js PropDef). props.js ignores unknown fields. */
export function newPid() { return 'p' + String(++PID).padStart(3, '0'); }

class Tx {   // brushes see ONLY this
  constructor(session, label, opts) {
    const o = opts || {};
    this.s = session; this.def = session.doc; this.w = this.def.size.w; this.d = this.def.size.d; this.open = true;
    this.mask = o.mask || null;        // Uint8Array(w*d), non-zero = writable (a Selection's mask)
    this.fan = o.fanOut || null;       // (x,z)  -> [[x,z],...]  symmetry fan-out
    this.fanProp = o.fanProp || null;  // (prop) -> [prop,...]
    this.p = { label: label || 'edit', strokeId: o.strokeId ?? null, ops: [], channels: new Set(), bounds: null, cells: { heights: new Map(), surfaces: new Map(), decks: new Map() } };
  }
  get label() { return this.p.label; }
  get bounds() { return this.p.bounds; } get strokeId() { return this.p.strokeId; }
  get channels() { return [...this.p.channels]; }
  get empty() { const c = this.p.cells; return !this.p.ops.length && !c.heights.size && !c.surfaces.size && !c.decks.size; }
  _in(x, z) { return x >= 0 && z >= 0 && x < this.w && z < this.d && (!this.mask || this.mask[z * this.w + x] !== 0); }   // the selection write mask
  _pts(x, z) { return this.fan ? this.fan(x, z) : [[x, z]]; }                                                              // the symmetry fan-out
  _mark(ch, x, z) {
    this.p.channels.add(ch);
    const b = this.p.bounds;
    if (!b) { this.p.bounds = { x0: x, z0: z, x1: x, z1: z }; return; }
    if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (z < b.z0) b.z0 = z; if (z > b.z1) b.z1 = z;
  }
  // First touch keeps the ORIGINAL value, a later touch only advances the new one, and a cell driven
  // back to where it started DROPS OUT — which is what makes hashDef(def) after undo-all exactly
  // equal to the starting hash rather than merely equivalent to it.
  _cell(ch, i, x, z, o, n, put) {
    this._guard();
    if (o === n) return false;
    const m = this.p.cells[ch], e = m.get(i);
    if (!e) m.set(i, [o, n]); else if (e[0] === n) m.delete(i); else e[1] = n;
    put(); this._mark(ch, x, z); return true;
  }
  /** Integer h steps — the rules unit. A non-finite value is refused, never written as NaN. */
  setH(x, z, v) {
    if (!Number.isFinite(v)) return false;
    const val = Math.round(v), H = this.def.grid.H;
    let any = false;
    for (const [px, pz] of this._pts(x, z)) if (this._in(px, pz))
      any = this._cell(CH.H, pz * this.w + px, px, pz, H[pz][px], val, () => { H[pz][px] = val; }) || any;
    return any;
  }
  // One schema letter (g k d s b r S w v). T rows are strings, so a write rebuilds the row.
  setT(x, z, letter) {
    const ch = String(letter)[0], T = this.def.grid.T;
    if (!ch) return false;
    let any = false;
    for (const [px, pz] of this._pts(x, z)) if (this._in(px, pz))
      any = this._cell(CH.T, pz * this.w + px, px, pz, T[pz][px], ch, () => { T[pz] = T[pz].slice(0, px) + ch + T[pz].slice(px + 1); }) || any;
    return any;
  }
  setHeight(x, z, v) { return this.setH(x, z, v); } setSurface(x, z, l) { return this.setT(x, z, l); }
  // Hand-painting a grant contradicts decks.mode 'auto', which DERIVES the list from the deck props,
  // so the first painted tile flips to 'explicit' and seeds the list with what auto produced — as
  // STRUCTURAL ops, which revert() replays before any cell, so the seed lands before the deltas.
  setDeckTile(x, z, on) {
    const dk = this.def.decks;
    if (!this._deckReady) {
      if (dk.mode !== 'explicit') { this.setField(['decks', 'mode'], 'explicit'); this.setField(['decks', 'tiles'], deckSorted(deckTiles(this.def), this.w)); }
      else this.setField(['decks', 'tiles'], deckSorted(dk.tiles || [], this.w));
      this._deckReady = true;
    }
    const l = this.def.decks.tiles, n = on ? 1 : 0;
    let any = false;
    for (const [px, pz] of this._pts(x, z)) if (this._in(px, pz))
      any = this._cell(CH.DECK, pz * this.w + px, px, pz, l.some((t) => t[0] === px && t[1] === pz) ? 1 : 0, n, () => deckSet(l, px, pz, this.w, n)) || any;
    return any;
  }
  // ---- generic field / list ops. Four verbs — set a field, insert into a list, delete from one,
  // move within one — plus `doc`, a whole-doc swap. Everything public compiles down to these.
  _op(op) { this._guard(); this.p.ops.push(op); this.p.channels.add(op.ch); return op; }
  _apply(op, dir) {
    if (op.k === 'set') return wr(this.def, op.path, cp(dir < 0 ? op.o : op.n));
    if (op.k === 'doc') { const s = dir < 0 ? op.o : op.n; for (const k of Object.keys(this.def)) delete this.def[k]; return void Object.assign(this.def, cp(s)); }
    const l = rd(this.def, op.path);
    if (op.k === 'mov') { const f = dir > 0 ? op.from : op.to, t = dir > 0 ? op.to : op.from; return void l.splice(t, 0, l.splice(f, 1)[0]); }
    if ((op.k === 'ins') === (dir > 0)) l.splice(op.index, 0, cp(op.rec)); else l.splice(op.index, 1);
  }
  // Write one field. `path` is rooted at the document: ['design','baseTier'], ['name'], ...
  setField(path, v, ch) {
    const o = rd(this.def, path);
    if (JSON.stringify(o) === JSON.stringify(v)) return false;   // a write of the same value is not an edit
    this._apply(this._op({ k: 'set', path, o: cp(o), n: cp(v), ch: ch || chanOf(path) }), 1); return true;
  }
  setDesign(k, v) { return this.setField(['design', k], v, CH.DESIGN); } setMeta(k, v) { return this.setField([k], v, CH.META); }
  // ORDER IS SIGNIFICANT: main.js index-matches spawns[team][i] to roster[team][i], so a slot is a
  // class, not a pin — hence a slot index rather than an append.
  setSpawn(team, slot, x, z) {
    const t = this.def.spawns[team];
    if (!t || slot < 0 || slot >= t.length) throw new RangeError(`setSpawn: no slot ${team}[${slot}]`);
    const ok = this.setField(['spawns', team, slot], [x | 0, z | 0], CH.SPAWN);
    if (ok) this._mark(CH.SPAWN, x | 0, z | 0);
    return ok;
  }
  _insert(path, rec, index, ch) {
    const n = rd(this.def, path).length, i = index == null || index > n ? n : Math.max(0, index | 0);
    this._apply(this._op({ k: 'ins', path, index: i, rec: cp(rec), ch: ch || chanOf(path) }), 1); return i;
  }
  _removeAt(path, index, ch) {
    const list = rd(this.def, path);
    if (index < 0 || index >= list.length) return false;
    this._apply(this._op({ k: 'del', path, index, rec: cp(list[index]), ch: ch || chanOf(path) }), 1); return true;
  }
  _indexOf(path, id) { const k = ID_KEY[path[path.length - 1]]; return typeof id === 'number' ? id : k ? rd(this.def, path).findIndex((r) => r && r[k] === id) : -1; }
  // ORDER IS SEMANTIC: props.js round-robins a type's PNG variants over this array, so an insert in
  // the middle reshuffles every later prop of that type — hence the explicit index and reorderProp.
  addProp(p, index) {
    const rec = { ...p }, out = [];
    if (!rec.pid) rec.pid = newPid();
    for (const q of (this.fanProp ? this.fanProp(rec) : [rec])) {   // symmetry mirrors the placement
      const r = q === rec ? rec : { ...q, pid: newPid() };
      this._insert(['props'], r, index === undefined ? undefined : index + out.length, CH.PROP);
      this._mark(CH.PROP, Math.floor(r.x), Math.floor(r.z));
      out.push(r.pid);
    }
    return out.length === 1 ? out[0] : out;
  }
  removeProp(pid) {
    const i = this.def.props.findIndex((p) => p.pid === pid);
    if (i < 0) return false;
    this._mark(CH.PROP, Math.floor(this.def.props[i].x), Math.floor(this.def.props[i].z));
    return this._removeAt(['props'], i, CH.PROP);
  }
  updateProp(pid, patch) {
    const i = this.def.props.findIndex((p) => p.pid === pid);
    if (i < 0) return false;
    let any = false;
    for (const k of Object.keys(patch)) if (k !== 'pid') any = this.setField(['props', i, k], patch[k], CH.PROP) || any;
    if (any) this._mark(CH.PROP, Math.floor(this.def.props[i].x), Math.floor(this.def.props[i].z));
    return any;
  }
  moveProp(pid, x, z) { return this.updateProp(pid, { x, z }); }  reorderProp(pid, to) {
    const from = this.def.props.findIndex((p) => p.pid === pid), t = Math.max(0, Math.min(this.def.props.length - 1, to | 0));
    if (from < 0 || t === from) return false;
    this._apply(this._op({ k: 'mov', path: ['props'], from, to: t, ch: CH.PROP }), 1); return true;
  }
  // Whole-doc snapshot — resize, generator rewrites, paste-over-everything. SEALS its Tx for the
  // same replay-order reason as the decks note above: it is the only write the Tx may make.
  replaceDoc(next) {
    if (!this.empty) throw new Error('Tx.replaceDoc: must be the only write in its transaction');
    this._apply(this._op({ k: 'doc', o: cp(this.def), n: cp(next), ch: CH.META }), 1);
    for (const c of CHANNELS) this.p.channels.add(c);
    this.w = this.def.size.w; this.d = this.def.size.d; this.sealed = true;
    this.p.bounds = { x0: 0, z0: 0, x1: this.w - 1, z1: this.d - 1 }; return true;
  }
  _guard() { if (!this.open || this.sealed) throw new Error(this.open ? 'Tx: sealed by replaceDoc' : 'Tx: write after commit/abort'); }
  commit() { return this.s.commit(this); } abort() { return this.s.abort(this); }
}
// addFace/removeFace, addChoke, addRoute, addRegion, addAssist, addPromise, addWaive — generated, so
// a new design list is one DESIGN_LISTS entry. declare(kind, rec) is the same thing addressed by
// name, which is what the primitives vocabulary and the design tools use to avoid hard-coding one.
for (const [kind, list] of Object.entries(DESIGN_LISTS)) {
  const C = kind[0].toUpperCase() + kind.slice(1), path = ['design', list];
  Tx.prototype['add' + C] = function (rec, index) { return this._insert(path, rec, index, CH.DESIGN); };
  Tx.prototype['remove' + C] = function (id) { const i = this._indexOf(path, id); return i >= 0 && this._removeAt(path, i, CH.DESIGN); };
}
const dkind = (k) => { if (!DESIGN_LISTS[k]) throw new RangeError(`declare: unknown kind '${k}'`); return k[0].toUpperCase() + k.slice(1); };
Tx.prototype.declare = function (kind, rec) { return this['add' + dkind(kind)](rec); };
Tx.prototype.undeclare = function (kind, id) { return this['remove' + dkind(kind)](id); };

export class Session {
  /** @param {import('../world/mapformat/schema.js').MapDef} def taken by reference, mutated in place */
  constructor(def, opts = {}) {
    this.doc = def;
    this.history = opts.history || new History(opts);
    this._tx = null; this._subs = new Map(); this._seq = 0;
    this._dirty = { channels: new Set(), bounds: null };
    this._view = opts.guard === false ? null : guardView(def);
    // Resume the pid counter past the loaded document, or the first stamp collides with an existing
    // prop and updateProp/removeProp start hitting the wrong record.
    for (const p of def.props || []) { const m = /^p(\d+)$/.exec(p.pid || ''); if (m) PID = Math.max(PID, +m[1]); }
  }
  // Read-only view: assignment throws in the tool that tried it, not three commits later when undo
  // replays a hole. Hot read loops use `session.doc` and pay nothing.
  get def() { return this._view || this.doc; }
  get w() { return this.doc.size.w; } get d() { return this.doc.size.d; }
  hash() { return hashDef(this.doc); }         // the undo property test's oracle
  /** @param {{strokeId?:string|number, mask?:Uint8Array, fanOut?:Function, fanProp?:Function}} [opts] */
  begin(label, opts) {
    if (this._tx) throw new Error(`Session.begin('${label}'): '${this._tx.label}' is still open`);
    return (this._tx = new Tx(this, label, opts));
  }
  // begin + run + commit, aborting on a throw — the form every tool and every test should use.
  edit(label, fn, opts) {
    const tx = this.begin(label, opts);
    try { fn(tx); } catch (e) { this.abort(tx); throw e; }
    return this.commit(tx);
  }
  commit(tx) {
    if (!tx || tx !== this._tx || !tx.open) throw new Error('Session.commit: not the open transaction');
    tx.open = false; this._tx = null;
    if (tx.empty) return null;                       // a stroke that changed nothing is not history
    const patch = tx.p;
    patch.seq = ++this._seq; patch.channels = [...patch.channels];
    this.history.push(patch); this._publish('change', patch, 'commit');
    return patch;
  }
  abort(tx) {
    if (!tx || tx !== this._tx) throw new Error('Session.abort: not the open transaction');
    tx.open = false; this._tx = null;
    if (tx.empty) return false;
    this.revert(tx.p, -1);
    this._publish('change', { ...tx.p, channels: [...tx.p.channels] }, 'abort'); return true;
  }
  // Play a patch backwards (dir -1) or forwards (dir +1) — the ONE place inverses are applied.
  // STRUCTURE BEFORE CELLS on redo, the exact mirror on undo: an op can be a precondition for a cell
  // (decks.mode flipping to 'explicit' before tiles are painted onto the list) but never the
  // reverse, so ops-then-cells reproduces any interleaving a transaction actually built.
  revert(patch, dir) {
    const w = this.doc.size.w, G = this.doc.grid, ops = patch.ops;
    const ctx = { def: this.doc, _apply: Tx.prototype._apply };
    if (dir > 0) for (const op of ops) ctx._apply(op, 1);
    for (const ch of [CH.H, CH.T, CH.DECK]) {
      const m = patch.cells[ch];
      if (!m || !m.size) continue;
      for (const [i, ov] of m) {
        const v = dir < 0 ? ov[0] : ov[1], x = i % w, z = (i - x) / w;
        if (ch === CH.H) G.H[z][x] = v;
        else if (ch === CH.T) G.T[z] = G.T[z].slice(0, x) + v + G.T[z].slice(x + 1);
        else deckSet(this.doc.decks.tiles, x, z, w, v);
      }
    }
    if (dir < 0) for (let i = ops.length - 1; i >= 0; i--) ctx._apply(ops[i], -1);
  }
  undo() { return this._step('undo', -1); } redo() { return this._step('redo', 1); }
  canUndo() { return this.history.canUndo(); } canRedo() { return this.history.canRedo(); }
  _step(evt, dir) {
    if (this._tx) throw new Error(`Session.${evt}: a transaction is open`);
    const p = this.history[evt]();
    if (p) { this.revert(p, dir); this._publish('change', p, evt); }
    return p;
  }
  // 'change' fires on commit, abort, undo and redo with {channels, bounds, patch, cause}; 'dirty'
  // carries the accumulated set drainDirty() has not yet consumed.
  on(evt, fn) { const l = this._subs.get(evt) || []; l.push(fn); this._subs.set(evt, l); return () => this.off(evt, fn); }
  off(evt, fn) { const l = this._subs.get(evt), i = l ? l.indexOf(fn) : -1; if (i >= 0) l.splice(i, 1); }
  // A listener that throws must not take the commit — and therefore the document — down with it.
  emit(evt, payload) { for (const fn of (this._subs.get(evt) || []).slice()) { try { fn(payload); } catch (e) { console.error(`[session] ${evt} listener threw`, e); } } }
  _publish(evt, patch, cause) {
    const channels = patch.channels || [], b = patch.bounds, D = this._dirty;
    for (const c of channels) D.channels.add(c);
    if (b) D.bounds = D.bounds ? { x0: Math.min(D.bounds.x0, b.x0), z0: Math.min(D.bounds.z0, b.z0), x1: Math.max(D.bounds.x1, b.x1), z1: Math.max(D.bounds.z1, b.z1) } : { ...b };
    this.emit(evt, { channels, bounds: b, patch, cause, label: patch.label, strokeId: patch.strokeId });
    this.emit('dirty', { channels: [...D.channels], bounds: D.bounds });   // one per change, coalesced by drain
  }
  // Consume the accumulated dirty set. The render ladder calls this once per frame.
  drainDirty() {
    const out = { channels: [...this._dirty.channels], bounds: this._dirty.bounds };
    this._dirty.channels.clear(); this._dirty.bounds = null; return out;
  }
}
// Dev guard: a lazy Proxy tree, cached per object so identity stays stable across reads, refusing
// every write. One WeakMap lookup per read, and opt-out with `{guard:false}`.
function guardView(root) {
  const cache = new WeakMap();
  const no = (k) => { throw new TypeError(`session.def is read-only: use session.begin() to write '${String(k)}'`); };
  const trap = { get: (t, k) => wrap(Reflect.get(t, k)), set: (t, k) => no(k), deleteProperty: (t, k) => no(k) };
  const wrap = (o) => { if (o === null || typeof o !== 'object') return o; const p = cache.get(o) || new Proxy(o, trap); cache.set(o, p); return p; };
  return wrap(root);
}
