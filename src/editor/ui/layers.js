// Channel visibility and locks (PLAN §6.3). Six rows, two toggles each, and both toggles mean
// something a caller can act on rather than something the panel merely remembers:
//
//   THE EYE is a render request. main.js hands `visible()` to whatever draws that channel — the
//   props group is a real three.js Object3D and toggles directly; the spawn/design/overlay draws
//   belong to sibling modules and read the same predicate.
//   THE LOCK is a WRITE BAN, and it is enforced at the one place writes happen. A registry record
//   declares `channels`; main.js refuses to run a record whose channels intersect a locked layer.
//   That is why locking is a property of the CHANNEL and not of the tool: a lock the author sets on
//   "props" holds for every tool that has ever touched a prop, including ones written after it.
//
// DECKS RIDE WITH SURFACES. session.js has a seventh channel, `decks`, which is a per-tile grant
// painted with the same gesture and read by the same eye as the surface letters; giving it a row of
// its own would let an author lock surfaces and still repaint the map's walkability by accident.
// `meta` has no row at all — renaming a map is not a layer.

/** Row order is the keymap's index order: Alt+1..Alt+6 show/hide, Ctrl+Alt+1..6 lock. */
export const LAYERS = Object.freeze([
  { id: 'heights', label: 'Heights', channels: ['heights'], glyph: 'H' },
  { id: 'surfaces', label: 'Surfaces', channels: ['surfaces', 'decks'], glyph: 'T' },
  { id: 'props', label: 'Props', channels: ['props'], glyph: 'P' },
  { id: 'spawns', label: 'Spawns', channels: ['spawns'], glyph: 'S' },
  { id: 'design', label: 'Design', channels: ['design'], glyph: 'D' },
  { id: 'overlays', label: 'Overlays', channels: [], glyph: 'O' },
]);
export const LAYER_IDS = Object.freeze(LAYERS.map((l) => l.id));
const STORE_KEY = 'cinderbanner.editor.layers';
const D = typeof document !== 'undefined' ? document : null;
const h = (tag, cls, text) => { const e = D.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** channel name -> layer id. Built once; `meta` is deliberately absent, so it is never lockable. */
const OWNER = new Map();
for (const l of LAYERS) for (const c of l.channels) OWNER.set(c, l.id);

/**
 * @param {{onChange?:(id:string, state:object)=>void, persist?:boolean}} [o]
 */
export function createLayers(o = {}) {
  const onChange = o.onChange || null;
  const persist = o.persist !== false;
  const state = new Map(LAYERS.map((l) => [l.id, { visible: true, locked: false }]));
  const rows = new Map();

  // A stored state is a convenience, never a contract: a key from an older build that names a layer
  // this one dropped is ignored rather than repaired, and an unreadable one costs nothing.
  if (persist && typeof localStorage !== 'undefined') {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      for (const [id, v] of Object.entries(saved)) if (state.has(id) && v && typeof v === 'object')
        state.set(id, { visible: v.visible !== false, locked: !!v.locked });
    } catch { /* fall back to all-visible, all-unlocked */ }
  }
  const save = () => { if (!persist || typeof localStorage === 'undefined') return; try { localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(state))); } catch { /* quota is storage.js's problem, not the panel's */ } };

  const el = h('div', 'ed-layers');
  for (const l of LAYERS) {
    const eye = h('span', 'eye', '◉');       // ◉ shown / ○ hidden
    const lock = h('span', 'lock', '•');     // • open / ▪ locked
    const nm = h('span', 'nm', l.label);
    const tail = h('span', 'ed-num', l.glyph);
    const row = h('div', 'ed-layer');
    row.append(eye, lock, nm, tail);
    eye.title = `Show/hide ${l.label} (Alt+${LAYER_IDS.indexOf(l.id) + 1})`;
    lock.title = `Lock ${l.label} against edits (Ctrl+Alt+${LAYER_IDS.indexOf(l.id) + 1})`;
    eye.addEventListener('click', (e) => { e.stopPropagation(); api.toggleVisible(l.id); });
    lock.addEventListener('click', (e) => { e.stopPropagation(); api.toggleLock(l.id); });
    el.append(row);
    rows.set(l.id, { row, eye, lock, nm });
  }

  function paint(id) {
    const s = state.get(id), r = rows.get(id);
    if (!r) return;
    r.eye.textContent = s.visible ? '◉' : '○';
    r.eye.classList.toggle('on', s.visible);
    r.lock.textContent = s.locked ? '▪' : '•';
    r.lock.classList.toggle('on', s.locked);
    r.row.classList.toggle('off', !s.visible);
  }
  function set(id, patch, quiet) {
    const s = state.get(id);
    if (!s) return null;
    Object.assign(s, patch);
    paint(id); save();
    if (!quiet && onChange) { try { onChange(id, api.state()); } catch (e) { console.error('[layers] onChange threw', e); } }
    return s;
  }

  const api = {
    el, LAYERS, ids: LAYER_IDS,
    /** @returns {boolean} true when nothing hides this layer. Unknown ids read as visible: a caller
     *  asking about a channel with no row (meta) must not be told to hide it. */
    visible: (id) => { const s = state.get(id); return s ? s.visible : true; },
    locked: (id) => { const s = state.get(id); return s ? s.locked : false; },
    setVisible: (id, v) => set(id, { visible: !!v }),
    setLocked: (id, v) => set(id, { locked: !!v }),
    toggleVisible: (id) => set(id, { visible: !api.visible(id) }),
    toggleLock: (id) => set(id, { locked: !api.locked(id) }),
    /** Index form, for the Alt+N bindings. Out of range is a no-op, not a throw. */
    byIndex: (i) => LAYER_IDS[i] || null,
    toggleVisibleAt: (i) => (LAYER_IDS[i] ? api.toggleVisible(LAYER_IDS[i]) : null),
    toggleLockAt: (i) => (LAYER_IDS[i] ? api.toggleLock(LAYER_IDS[i]) : null),
    /** Is this session.js CH channel behind a lock? */
    channelLocked: (ch) => { const id = OWNER.get(ch); return id ? api.locked(id) : false; },
    /**
     * The gate main.js puts in front of every registry record.
     * @param {string[]} channels the record's declared channels
     * @returns {{ok:boolean, blocked:string[]}} blocked names the LAYERS, not the channels, because
     *   that is what the author sees in the panel and what the refusal toast has to name.
     */
    allow(channels) {
      const blocked = [];
      for (const ch of channels || []) { const id = OWNER.get(ch); if (id && api.locked(id) && !blocked.includes(id)) blocked.push(id); }
      return { ok: blocked.length === 0, blocked };
    },
    state: () => Object.fromEntries([...state].map(([k, v]) => [k, { ...v }])),
    setState(next) { for (const [id, v] of Object.entries(next || {})) if (state.has(id)) set(id, { visible: v.visible !== false, locked: !!v.locked }, true); return api.state(); },
    unlockAll() { for (const id of LAYER_IDS) set(id, { locked: false }, true); if (onChange) onChange('*', api.state()); return api.state(); },
    showAll() { for (const id of LAYER_IDS) set(id, { visible: true }, true); if (onChange) onChange('*', api.state()); return api.state(); },
    /** Menu rows for the View menu, so the menubar and the panel cannot disagree. */
    menuItems: (kind = 'visible') => LAYERS.map((l, i) => ({
      id: `layer.${kind}.${l.id}`, label: (kind === 'lock' ? 'Lock ' : '') + l.label,
      checked: kind === 'lock' ? api.locked(l.id) : api.visible(l.id),
      kbd: kind === 'lock' ? `Ctrl Alt ${i + 1}` : `Alt ${i + 1}`,
      on: () => (kind === 'lock' ? api.toggleLock(l.id) : api.toggleVisible(l.id)),
    })),
    mount(host) { host.append(el); return api; },
  };
  for (const id of LAYER_IDS) paint(id);
  return api;
}
