// The application chrome (PLAN §6.3): menubar, tool rail, options strip, dock, status bar, toasts,
// modal, and the pointer-gesture recogniser at the foot. It builds DOM and reads input events and
// nothing else — no document, no session, no three.js; every callback is handed in.
//
// IT MUST LOOK LIKE THE GAME. Not "like an editor": the same the genre window chrome the HUD uses, in the
// slate-blue key, because a tool that looks like a different product makes an author second-guess what
// they see in the viewport. That is editor.css's doing — this file writes the class names from its
// CLASS-NAME CONTRACT and adds no inline style a stylesheet could own.
//
// LAYOUT IS THREE CSS VARIABLES AND A CLASS. `html.ed-nodock` and `html.ed-norail` move --ed-dock and
// --ed-rail, and BOTH #ed's grid and the canvas's inset read those, so one classList toggle moves the
// docks and the canvas together. The canvas is #ed's SIBLING and is never reparented.

const D = typeof document !== 'undefined' ? document : null;
/** @returns {HTMLElement} */
export function h(tag, cls, ...kids) {
  const e = D.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) { if (k == null || k === false) continue; e.append(k.nodeType ? k : D.createTextNode(String(k))); }
  return e;
}
const clear = (e) => { while (e.firstChild) e.firstChild.remove(); return e; };

/** The boot card, under the same id editor.html created it with so the two never stack. Deliberately
 *  outside createShell: main.js prints stages BEFORE the shell exists, and a boot that dies in stage 1
 *  must still leave a legible card rather than a black rectangle. */
export function bootCard(head, body, kind = '') {
  if (!D) return null;
  let card = D.getElementById('ed-boot');
  if (!card) { card = h('div', 'ed-boot'); card.id = 'ed-boot'; (D.getElementById('ed') || D.body).append(card); }
  card.className = 'ed-boot ' + kind;
  clear(card).append(h('b', null, head), h('span', null, body));
  return card;
}
export function bootDone() { const c = D && D.getElementById('ed-boot'); if (c) c.remove(); }
/** A boot FAILURE card, under its OWN id. editor.html removes #ed-boot as soon as this module resolves,
 *  so writing a failure into it hands the author a white screen a frame later. A separate card is used. */
export function bootFail(head, body) {
  if (!D) return null;
  const old = D.getElementById('ed-boot');
  if (old) old.remove();
  let card = D.getElementById('ed-fail');
  if (!card) { card = h('div', 'ed-boot err'); card.id = 'ed-fail'; (D.getElementById('ed') || D.body).append(card); }
  clear(card).append(h('b', null, head), h('span', null, body));
  return card;
}

/** @param {{root?:HTMLElement, title?:string, subtitle?:string,
 *           on?:{tool?:Function, dock?:Function, rail?:Function, menu?:Function}}} [o] */
export function createShell(o = {}) {
  const root = o.root || D.getElementById('ed');
  const on = o.on || {};
  for (const n of [...root.children]) if (n.id !== 'ed-boot') n.remove();

  // ---- menubar -------------------------------------------------------------------------------
  const brand = h('div', 'ed-brand', o.title || 'MAP BUILDER');
  const badge = h('div', 'ed-badge');
  const menubar = h('div', 'ed-menubar', brand);
  const menuSpacer = h('div', 'ed-spacer');
  menubar.append(menuSpacer, badge);
  let openMenu = null;
  const closeMenus = () => { if (!openMenu) return; openMenu.btn.classList.remove('open'); openMenu.drop.remove(); openMenu = null; };

  function renderMenus(defs) {
    for (const n of [...menubar.querySelectorAll('.ed-menu')]) n.remove();
    for (const m of defs || []) {
      const btn = h('div', 'ed-menu', m.label);
      // mousedown, not click: click fires AFTER the document-level closer below, so a second press
      // on an open menu would close and instantly reopen it.
      btn.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const was = openMenu && openMenu.btn === btn;
        closeMenus();
        if (was) return;
        const drop = h('div', 'ed-dropdown');
        for (const it of (typeof m.items === 'function' ? m.items() : m.items) || []) {
          if (it === '-' || it.sep) { drop.append(h('div', 'ed-sep')); continue; }
          const row = h('div', 'ed-mi' + (it.disabled ? ' dim' : '') + (it.checked ? ' on' : ''), h('span', null, it.label));
          if (it.kbd) row.append(h('kbd', null, it.kbd));
          if (!it.disabled) row.addEventListener('mousedown', (e2) => { e2.preventDefault(); closeMenus(); (it.on || on.menu || (() => {}))(it.id, it); });
          drop.append(row);
        }
        drop.style.left = btn.offsetLeft + 'px'; root.append(drop);
        btn.classList.add('open'); openMenu = { btn, drop };
      });
      menubar.insertBefore(btn, menuSpacer);
    }
  }
  const offClose = () => closeMenus();
  D.addEventListener('mousedown', offClose);

  // ---- rail / strip / dock / scrub / status ---------------------------------------------------
  const rail = h('div', 'ed-rail');
  const strip = h('div', 'ed-strip');
  const dock = h('div', 'ed-dock');
  // THE ONE PLACE THIS FILE OVERRIDES editor.css, and only in the axis the stylesheet could not know
  // about: how MANY children there are. With forty tools and six panels the rail runs off the bottom
  // of the window and the last dock panel is unreachable; scrolling is a property of the count, not of
  // the skin. It clips the rail's tooltip, which is why setTools() also writes a plain `title`.
  rail.style.overflowY = 'auto'; rail.style.overflowX = 'hidden'; rail.style.flexWrap = 'nowrap';
  dock.style.overflowY = 'auto';
  const scrub = h('div', 'ed-scrubbar');
  const status = h('div', 'ed-status');
  // An empty cell occupying grid-area 'view'. Never drawn into; it exists so viewportRect() reads the
  // layout the browser actually computed rather than re-deriving four CSS variables in JS.
  const gauge = h('div', 'ed-view-gauge');
  gauge.style.cssText = 'grid-area:view;pointer-events:none';
  const toasts = h('div', 'ed-toasts');
  root.append(menubar, rail, strip, dock, gauge, scrub, status, toasts);

  // ---- status segments, addressed by key so a caller updates one without rebuilding the bar ----
  const stats = new Map();
  function stat(key, text, kind = '') {
    let s = stats.get(key);
    if (!s) {
      s = { el: h('div', 'ed-stat', h('span', null, key), h('b')) };
      s.b = s.el.querySelector('b'); stats.set(key, s);
      const sp = status.querySelector('.ed-spacer');
      if (sp) status.insertBefore(s.el, sp); else status.append(s.el);
    }
    s.el.className = 'ed-stat' + (kind ? ' ' + kind : '');
    s.b.textContent = String(text); return s.el;
  }
  /** Everything after this point in the status bar is right-aligned. */
  function statusSpacer() { if (!status.querySelector('.ed-spacer')) status.append(h('div', 'ed-spacer')); }

  // ---- dock panels ----------------------------------------------------------------------------
  const panels = new Map();
  function panel({ id, title, grow = false, collapsed = false, count = null }) {
    if (panels.has(id)) return panels.get(id);
    const caret = h('span', 'ed-caret', '▾');
    const counter = h('span', 'ed-count', count == null ? '' : String(count));
    const head = h('div', 'ed-panel-head', caret, h('span', null, title || id), counter);
    const body = h('div', 'ed-panel-body');
    const el = h('div', 'ed-panel' + (grow ? ' grow' : '') + (collapsed ? ' collapsed' : ''), head, body);
    // Flex children shrink by default, so in a column dock every panel squeezes and the last rows of
    // each vanish -- `.ed-layers`' sixth row was half a row tall. A non-`.grow` panel keeps its own
    // height; the dock scrolls instead.
    if (!grow) el.style.flexShrink = '0';
    head.addEventListener('click', () => el.classList.toggle('collapsed'));
    dock.append(el);
    const p = { id, el, head, body, title,
      setCount: (n) => { counter.textContent = n == null ? '' : String(n); return p; },
      setTitle: (t) => { head.childNodes[1].textContent = t; return p; },
      collapse: (v) => { el.classList.toggle('collapsed', v !== false); return p; },
      remove: () => { el.remove(); panels.delete(id); } };
    panels.set(id, p);
    return p;
  }

  // ---- tool rail ------------------------------------------------------------------------------
  let activeTool = null;
  function setTools(list, pick) {
    clear(rail);
    for (const t of list || []) {
      const btn = h('div', 'ed-tool', h('span', null, t.icon || (t.label || t.id).slice(0, 2)));
      btn.dataset.k = t.key || '';
      if (t.key) btn.append(h('span', 'k', t.key));
      const tip = t.tip || t.label || t.id;
      btn.setAttribute('data-tip', tip);
      btn.title = tip;                       // never clipped by the rail's scroll box; data-tip is
      if (!t.icon) btn.firstChild.textContent = String(t.label || t.id).replace(/[^A-Za-z0-9]+/g, ' ').split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
      btn.addEventListener('click', () => { setActiveTool(t.id); (pick || on.tool || (() => {}))(t.id, t); });
      btn._id = t.id; rail.append(btn);
    }
    setActiveTool(activeTool);
  }
  function setActiveTool(id) {
    activeTool = id;
    for (const b of rail.children) b.classList.toggle('on', b._id === id);
    return id;
  }

  // ---- feedback -------------------------------------------------------------------------------
  function toast(msg, kind = 'ok', ms = 3400) {
    const t = h('div', 'ed-toast' + (kind ? ' ' + kind : ''), msg);
    toasts.append(t);
    const kill = () => t.remove();
    t.addEventListener('click', kill);
    setTimeout(kill, ms);
    // Six is where the stack starts covering the status bar; the oldest goes, never the newest.
    while (toasts.children.length > 6) toasts.firstChild.remove();
    return t;
  }

  /** @param {{title?:string, body?:Node|string, buttons?:Array<{label:string, id?:string,
   *           kind?:string, value?:any}>, dismissable?:boolean}} spec
   *  @returns {Promise<any>} the chosen button's `value` (or id), or null when dismissed */
  function modal(spec = {}) {
    return new Promise((resolve) => {
      const bodyEl = h('div', 'ed-modal-body');
      bodyEl.append(spec.body && spec.body.nodeType ? spec.body : h('div', null, spec.body || ''));
      const foot = h('div', 'ed-modal-foot');
      const box = h('div', 'ed-modal', h('div', 'ed-modal-head', spec.title || ''), bodyEl, foot);
      const scrim = h('div', 'ed-scrim', box);
      let done = false;
      const close = (v) => { if (done) return; done = true; scrim.remove(); D.removeEventListener('keydown', esc, true); resolve(v); };
      // Capture phase, on the document: the keymap is on `window` in the bubble phase, so without
      // capture an Escape here would race whatever else claims it.
      const esc = (e) => { if (e.key === 'Escape' && spec.dismissable !== false) { e.stopPropagation(); e.preventDefault(); close(null); } };
      for (const b of spec.buttons || [{ label: 'OK', value: true, kind: 'primary' }]) {
        const btn = h('button', 'ed-btn' + (b.kind ? ' ' + b.kind : ''), b.label);
        btn.addEventListener('click', () => close(b.value !== undefined ? b.value : (b.id || b.label)));
        foot.append(btn);
      }
      scrim.addEventListener('mousedown', (e) => { if (e.target === scrim && spec.dismissable !== false) close(null); });
      D.addEventListener('keydown', esc, true); root.append(scrim); shell.openModal = close;
      const first = box.querySelector('input, select, textarea, .ed-btn.primary');
      if (first) first.focus();
    });
  }

  // ---- layout modes ---------------------------------------------------------------------------
  const html = D.documentElement;
  const mode = (cls, v) => { html.classList.toggle(cls, v === undefined ? !html.classList.contains(cls) : !v); return !html.classList.contains(cls); };

  const shell = {
    root, menubar, rail, strip, dock, scrub, status, toasts, brand, badge, gauge,
    h, clear, closeMenus, setMenus: renderMenus, panel, panels, setTools, setActiveTool, stat, statusSpacer, toast, modal,
    openModal: null,
    /** The canvas cell, in CSS pixels. main.js feeds this to pipeline.resize + camera.setAspect. */
    viewportRect() { const r = gauge.getBoundingClientRect(); return { x: r.left, y: r.top, width: Math.max(1, r.width), height: Math.max(1, r.height) }; },
    setBadge(text, kind = '') { badge.className = 'ed-badge' + (kind ? ' ' + kind : ''); badge.textContent = text; return badge; },
    setSubtitle(t) { brand.textContent = t; return brand; },
    /** @returns {boolean} whether the dock is now VISIBLE */
    showDock(v) { const r = mode('ed-nodock', v); if (on.dock) on.dock(r); return r; },
    showRail(v) { const r = mode('ed-norail', v); if (on.rail) on.rail(r); return r; },
    showScrub(v) { html.classList.toggle('ed-scrub', v === undefined ? !html.classList.contains('ed-scrub') : !!v); return html.classList.contains('ed-scrub'); },
    destroy() { D.removeEventListener('mousedown', offClose); closeMenus(); for (const n of [...root.children]) n.remove(); },
  };
  return shell;
}
/**
 * Pointer GESTURES on the viewport canvas — the layer that turns a registry record's `cursor` field
 * into the from/to/rect/poly its tool reads. Without it a 'drag-rect' tool is a rail button that
 * fires once with no rectangle, which is how 27 of the editor's 39 records shipped inert. `toTile`
 * maps a screen point to a tile and `on(phase, g)` is told what was drawn, so no document, session,
 * registry or three.js reaches this file. Phases: 'hover', 'start', 'move', 'end', 'cancel'.
 *
 * PAINT streams per move — it is the brush stroke, and the caller commits each dab. The other four
 * BANK a shape and report it once at 'end': a tool fired per move while its rectangle was still
 * growing would leave fifty undo entries for one drag. POLY is the only gesture whose state outlives
 * a button press — a press banks a vertex; a double-click, a right-click, a press back on the first
 * vertex or the caller's close() ends it.
 * @param {{canvas:HTMLElement, toTile:(ev:PointerEvent)=>({x:number,z:number}|null),
 *          kindOf:()=>(string|null), on:(phase:string, g:object)=>any}} o
 */
export function createGestures({ canvas, toTile, kindOf, on }) {
  let drag = null, poly = [];                      // the drag in flight; the vertices poly has banked
  const P = (t) => [t.x, t.z];
  // A drag-rect that never left its start tile reports NO rect, so ctxRect falls back to the live
  // selection: firing a generator with a marquee up must fill the marquee, not the one tile clicked.
  const shape = (kind, a, b) => (kind === 'line' ? { from: P(a), to: P(b) }
    : kind === 'drag-rect' ? (a.x === b.x && a.z === b.z ? {} : { rect: [a.x, a.z, b.x, b.z] }) : {});
  const emit = (phase, kind, ev, g) => { try { on(phase, { kind, event: ev, ...g }); } catch (e) { console.error('[gesture]', phase, kind, e); } };
  const close = (ev) => { const p = poly; poly = []; if (p.length) emit('end', 'poly', ev, { poly: p.map(P), from: P(p[0]), to: P(p[p.length - 1]), tile: p[p.length - 1] }); return p.length; };
  const cancel = (ev) => { const had = poly.length || drag; poly = []; if (drag) { emit('cancel', drag.kind, ev, { tile: drag.b }); drag = null; } return !!had; };
  canvas.addEventListener('contextmenu', (ev) => { if (poly.length) { ev.preventDefault(); close(ev); } });
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const kind = kindOf(), t = kind && kind !== 'none' ? toTile(ev) : null;
    if (!t) return;                                // no armed record, or a press off the board
    if (kind === 'poly') {
      const f = poly[0];
      if (ev.detail > 1 || (f && f.x === t.x && f.z === t.z && poly.length >= 2)) return void close(ev);
      poly.push(t); return void emit('move', kind, ev, { poly: poly.map(P), tile: t });
    }
    drag = { kind, a: t, b: t };
    try { canvas.setPointerCapture(ev.pointerId); } catch { /* a synthetic event has no capture */ }
    emit('start', kind, ev, { tile: t, ...shape(kind, t, t) });
    if (kind === 'paint') emit('move', kind, ev, { tile: t });
  });
  canvas.addEventListener('pointermove', (ev) => {
    const t = toTile(ev);
    if (!drag) return void emit('hover', kindOf() || 'none', ev, { tile: t, ...(poly.length ? { poly: poly.map(P) } : {}) });
    if (t) drag.b = t;                             // off-board mid-drag: the last good tile stands
    emit('move', drag.kind, ev, { tile: drag.b, ...shape(drag.kind, drag.a, drag.b) });
  });
  canvas.addEventListener('pointerup', (ev) => { if (!drag) return; const d = drag; drag = null; emit('end', d.kind, ev, { tile: d.b, ...shape(d.kind, d.a, d.b) }); });
  canvas.addEventListener('pointercancel', cancel);
  return { close, cancel, get pending() { return poly.length; } };
}
/** The OK button's value: a sentinel no typed answer can equal, so an empty box still reads as
 *  'the author pressed OK' rather than as 'the author dismissed the modal'. */
const OK = '\u0000ok';
/** A one-field prompt whose Enter is the primary button: an author naming a slot should not have to
 *  reach for the mouse. @returns {Promise<string|null>} the trimmed text, or null when cancelled */
export async function askText(shell, title, label, value) {
  const input = h('input', 'ed-input'); input.type = 'text'; input.value = value || '';
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && shell.openModal) shell.openModal(OK); });
  const r = await shell.modal({ title, body: h('div', 'ed-field', h('label', null, label), input),
    buttons: [{ label: 'Cancel', value: null }, { label: 'OK', kind: 'primary', value: OK }] });
  return r === OK ? input.value.trim() : r;
}
/** validate.js / mapcheck issues as severity-classed rows, for a modal body. */
export const issueList = (issues) => { const l = h('div', 'ed-list'); for (const i of issues) l.append(h('div', `ed-row ${i.severity}`, h('span', 'code', i.code + (i.where ? ` ${i.where.x},${i.where.z}` : '')), h('span', 'msg', i.msg))); if (!issues.length) l.append(h('div', 'ed-hint', 'nothing to report')); return l; };
/** keymap.rows() as one table per group - the Help overlay's whole body. */
export const keyTable = (rows) => rows.reduce((w, g) => { const t = h('table', 'ed-table');
  for (const k of g.keys) t.append(h('tr', null, h('td', 'num', k.keys), h('td', null, k.label)));
  return w.append(h('div', 'ed-modal-head', g.group), t) || w; }, h('div'));
