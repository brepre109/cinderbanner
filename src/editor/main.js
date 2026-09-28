// The map builder's entry point (PLAN §6.3, §6.10): a STAGED boot, the module wiring, the frame
// loop, and the two window handles.
//
// GUARDED BOOT. Every stage names itself INTO the page before it runs, so a failure leaves a card
// reading which stage died and its stack — never a white screen, the one failure mode that costs an
// hour because it looks identical whatever caused it. The card is editor.html's own #ed-boot.
//
// TWO HANDLES, ONE OBJECT. `window.__EDITOR__` is the editor's own API; `window.__GAME__` is the
// SAME object, which lets tools/shot.mjs capture /editor.html with no edit to shot.mjs: it waits on
// `.ready` and calls `.applyPreset(n)`, `.freeze()` and `.render()`, all here with game semantics.
//
// SIBLINGS LOAD THROUGH import.meta.glob, never a literal import. Brushes, tools, generators and
// panels are files other workers are writing right now; a static import of one that has not landed is
// a hard `vite build` failure that takes the GAME build with it, while a glob resolves to `{}` until
// the file exists. Each is awaited in its own try/catch: one broken plugin must not cost the editor.
import * as THREE from 'three';
import { HSTEP } from '../core/config.js';
import { YAW_STOPS } from '../render/camera.js';
import { blankDef } from '../world/mapformat/schema.js';
import { compileMap } from '../world/mapformat/compile.js';
import { resolveDef } from '../world/mapdata.js';
import { validateDef } from '../world/mapformat/validate.js';
import { hashDef } from '../world/mapformat/serialize.js';
import { Session } from './session.js';
import { byId, list, paramsFor } from './registry.js';
import { Selection } from './selection.js';
import { MODES as SYM_MODES, beginSymmetric } from './symmetry.js';
import { createViewport, RenderLadder } from './viewport.js';
import { TilePicker } from './picking.js';
import { createShell, createGestures, askText, issueList, keyTable, bootCard, bootFail, bootDone, h } from './ui/shell.js';
import { createLayers } from './ui/layers.js';
import { Keymap, bindingOf, labelOf } from './keymap.js';
import { Storage, listSlots, readSlot } from './storage.js';
import * as io from './io.js';
import * as playtest from './playtest.js';
import { copyStamp, cutStamp, pasteStamp } from './clipboard.js';

const Q = new URLSearchParams(location.search);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
/** src/main.js's screenshot presets, verbatim in yaw/pitch/zoom; only the focus is recentred. */
const PRESETS = { wide: { zoom: 0.95, pitch: 'low', yawIndex: 0 }, mid: { zoom: 1.5, pitch: 'low', yawIndex: 0 }, close: { zoom: 2.2, pitch: 'low', yawIndex: 0 },
  // rot1/rot2 keep their historic MEANING (a 90° and a 180° turn) across the move to eight 45° stops.
  high: { zoom: 1, pitch: 'high', yawIndex: 0 }, rot1: { zoom: 1, pitch: 'low', yawIndex: 2 }, rot2: { zoom: 1, pitch: 'low', yawIndex: 4 },
  ...Object.fromEntries(Array.from({ length: YAW_STOPS }, (_, i) => [`yaw${i}`, { zoom: 1, pitch: 'low', yawIndex: i }])) };
const STAGES = ['document', 'session', 'shell', 'viewport', 'ladder', 'picking', 'plugins', 'keymap', 'storage', 'loop'];
/** What the status bar tells an author to DO with the record they just armed, by its cursor. */
const CURSOR_HINT = { paint: 'drag to paint', click: 'click a tile', line: 'drag a line', 'drag-rect': 'drag a rectangle', poly: 'click points; dbl-click or Enter closes' };
let stage = 'boot';
const E = { ready: false, failed: false, stage, stages: STAGES };
window.__EDITOR__ = E;
window.__GAME__ = E;                                    // shot.mjs waits on THIS shape

/** Name the stage in the page, then run it. A throw is re-thrown carrying the stage, so whatever
 *  catches it — the card below, the console, a test — is told where it died. */
async function step(name, fn) {
  stage = E.stage = name;
  bootCard('Map Builder', `stage ${STAGES.indexOf(name) + 1}/${STAGES.length}: ${name}...`);
  try { return await fn(); } catch (err) { throw Object.assign(new Error(`boot stage '${name}': ${(err && err.message) || err}`), { stage: name, cause: err }); }
}

/** `?new=WxD` beats `?map=`; with neither, a blank board — an editor that opens on someone else's
 *  map teaches an author to close a document before they can start one. */
async function openingDocument() {
  const nw = /^(\d+)\s*[xX*]\s*(\d+)$/.exec(Q.get('new') || '');
  if (nw) return blankDef({ w: +nw[1], d: +nw[2], id: 'untitled', name: `Untitled ${nw[1]}x${nw[2]}` });
  const spec = Q.get('map');                            // mapdata.js owns id / local: / proc: and the fallback
  if (spec) return resolveDef(spec, Q);
  return blankDef({ w: 20, d: 20, id: 'untitled', name: 'Untitled' });
}

async function boot() {
  const canvas = document.getElementById('gl');
  if (!canvas) throw new Error('editor.html has no #gl canvas');

  const def = await step('document', openingDocument);
  const recovery = Storage.recover();          // read BEFORE Storage.start() rearms `open`
  const session = await step('session', () => new Session(def));
  const sel = new Selection(session.w, session.d);
  // `armed` is the RECORD the pointer drives, not an id: which cursor to collect, which channels to
  // gate and whether to coalesce are all fields on it. `gest` is assigned in the pointer stage below
  // but declared here, because pickTool() already runs during `plugins`.
  let symmetry = 'none', brushSize = 1, armed = null, gest = null, clip = null, stroke = null;

  const shell = await step('shell', () => createShell({ title: 'MAP BUILDER', on: { dock: () => onResize(), rail: () => onResize() } }));
  const layers = createLayers({ onChange: () => applyLayers() });
  shell.panel({ id: 'layers', title: 'Layers' }).body.append(layers.el);
  const slotList = shell.panel({ id: 'doc', title: 'Document' }).body;  // the always-there dock pair
  // Seeded HERE, not after boot: the plugins stage calls pickTool(), which writes the real tool
  // name into this bar, and a seeding pass afterwards would overwrite it with the placeholder.
  shell.statusSpacer(); for (const [k, v] of [['tool', '-'], ['size', '-'], ['brush', 1], ['sym', 'none'], ['sel', 0], ['undo', 0], ['tile', '-'], ['gest', '-'], ['auto', '-']]) shell.stat(k, v);
  // buildLighting fits its shadow camera to the map's real box, so the viewport gets the REAL compiled
  // map. `ladder`/`picker` are pre-nulled `let` deliberately: RenderLadder's ctor runs its first build
  // synchronously and calls onBuild from INSIDE the `new`, where a `const` would still be in its TDZ.
  let ladder = null, picker = null;
  const vp = await step('viewport', () => createViewport({ canvas, map: compileMap(session.doc) }));
  ladder = await step('ladder', () => new RenderLadder({ scene: vp.scene, session, lighting: vp.lighting, camera: vp.camera, onBuild: (map, what) => { if (picker) picker.setMap(map); if (what === 'terrain' && !E.ready) vp.fit(map); applyLayers(); } }));
  picker = await step('picking', () => new TilePicker({ canvas, camera: vp.camera, scene: vp.scene, map: ladder.map }));

  // Context every plugin, brush and panel is handed. Read-only except `session`, the editor's one
  // writable thing, which itself refuses writes outside a Tx.
  const ctx = { session, get def() { return session.def; }, get map() { return ladder && ladder.map; }, get MAP() { return ladder && ladder.map; },
    scene: vp.scene, camera: vp.camera, pipeline: vp.pipeline, lighting: vp.lighting, canvas, ladder, picker, shell, layers,
    // BOTH names, deliberately: `selection` is what tools/select.js's readers look for, `sel` is what
    // the panels and __EDITOR__ say. One live object, so a selector's write IS the marquee the next
    // tool honours; naming it only `sel` made all six selectors fill a throwaway and return it.
    sel, selection: sel,
    io, playtest, storage: null, editor: E, toast: (m, k) => shell.toast(m, k),
    get symmetry() { return symmetry; }, get brushSize() { return brushSize; }, get activeTool() { return armed && armed.id; } };
  E.ctx = ctx;                                            // the handle a headless driver reaches for

  let keymapHints = [];                                   // the rail's records, for __EDITOR__.tools()
  await step('plugins', async () => {
    const mods = { ...import.meta.glob('/src/editor/brushes/*.js'), ...import.meta.glob('/src/editor/tools/*.js'),
      ...import.meta.glob('/src/editor/generators/*.js'), ...import.meta.glob('/src/editor/panels/*.js') };
    for (const path of Object.keys(mods).sort())
      try { const m = await mods[path](); await (m.init && m.init(ctx)); } catch (e) { console.error('[editor] plugin failed', path, e); shell.toast(`plugin ${path.split('/').pop()} failed`, 'err'); }
    const tools = keymapHints = [...list('brush'), ...list('tool'), ...list('generator')];
    shell.setTools(tools.map((r) => ({ id: r.id, label: r.label, icon: r.icon, key: r.key, tip: r.tip })), (id) => pickTool(id));
    for (const p of list('panel'))
      try { p.mount(shell.panel({ id: p.id, title: p.label, grow: !!p.grow }).body, ctx); } catch (e) { console.error('[editor] panel failed', p.id, e); }
    if (tools.length) pickTool(tools[0].id);
    return tools.length;
  });
  // ---- actions. Every keystroke and every menu item lands here and nowhere else.
  const A = {
    'file.new': async () => { const s = await askText(shell, 'New map', 'Width x Depth', '20x20'); const m = /^(\d+)\s*[xX*]\s*(\d+)$/.exec(s || ''); if (m) swap(blankDef({ w: +m[1], d: +m[2], id: 'untitled', name: `Untitled ${m[1]}x${m[2]}` }), 'new map'); },
    'file.import': async () => { const f = await io.pickFile(); if (!f) return; try { const r = io.importText(f.text); swap(r.def, `import ${f.name}`); shell.toast(`imported ${f.name}${r.coercions.length ? ` (${r.coercions.length} repair(s))` : ''}`, r.coercions.length ? 'warn' : 'ok'); } catch (e) { shell.toast(String((e && e.message) || e), 'err'); } },
    'file.save': () => { const r = storage.save(storage.slot || io.suggestId(session.def)); shell.toast(r.ok ? `saved to slot '${r.slot}'` : `save failed: ${r.error}`, r.ok ? 'ok' : 'err'); refreshDoc(); },
    'file.saveAs': async () => { const n = await askText(shell, 'Save as', 'Slot name', storage.slot || io.suggestId(session.def)); if (n) { storage.slot = n; A['file.save'](); } },
    'file.exportModule': async () => { const ok = await io.copyText(io.exportModule(session.def)); shell.toast(ok ? 'ES module copied to the clipboard' : 'clipboard refused; use Write to src/world/maps', ok ? 'ok' : 'warn'); },
    'file.exportJson': async () => { const ok = await io.copyText(io.exportJson(session.def)); shell.toast(ok ? 'JSON copied to the clipboard' : 'clipboard refused', ok ? 'ok' : 'warn'); },
    'file.writeMaps': async () => { const id = await askText(shell, 'Write to src/world/maps', 'Map id (filename stem)', io.suggestId(session.def)); if (!id) return; const r = await io.saveMap(session.def, { id }); shell.toast(r.ok ? `${r.via === 'dev' ? 'wrote ' + r.path : 'downloaded ' + r.path} (${r.bytes} B)` : `write failed: ${r.error}`, r.ok ? 'ok' : 'err'); },
    // Design findings do not block the run but ARE reported: an author must never wonder whether the
    // map they are playing passed or was merely allowed through.
    'playtest.run': () => { const r = playtest.run(session.def), notes = (r.errors || []).length + (r.warnings || []).length;
      if (!r.ok) return void shell.modal({ title: `Playtest blocked: ${r.error}`, body: issueList(r.blocking || r.errors || []), buttons: [{ label: 'Close', value: null }] });
      shell.toast(r.blocked ? `popup blocked - open ${r.url}` : `playing local:${r.slot} (${r.hash})${notes ? ` - ${notes} design note(s)` : ''}`, r.blocked ? 'warn' : 'ok'); },
    'edit.undo': () => { const p = session.undo(); shell.toast(p ? `undo ${p.label}` : 'nothing to undo', p ? 'ok' : 'warn'); refreshDoc(); },
    'edit.redo': () => { const p = session.redo(); shell.toast(p ? `redo ${p.label}` : 'nothing to redo', p ? 'ok' : 'warn'); refreshDoc(); },

    // clipboard.js does the work: the selection is the area, the cursor is the landing tile, and each
    // of the three is ONE Tx — one Ctrl+Z — with sel.writeMask clipping it like a brush. It reads
    // session.doc, never .def: .def is the dev-guard Proxy and copyStamp structuredClones each prop.
    'edit.copy': () => { clip = sel.count ? copyStamp(session.doc, { mask: sel.mask }) : null; shell.toast(clip ? `copied ${clip.w}x${clip.d}` : 'select an area to copy', clip ? 'ok' : 'warn'); },
    'edit.cut': () => { if (!sel.count) return void shell.toast('select an area to cut', 'warn'); session.edit('cut', (tx) => { clip = cutStamp(tx, session.doc, { mask: sel.mask }); }, { mask: sel.writeMask }); shell.toast(`cut ${clip.w}x${clip.d}`); refreshDoc(); },
    'edit.paste': () => { if (!clip) return void shell.toast('the clipboard is empty', 'warn'); const t = picker.hover, x = t ? t.x : clip.origin.x, z = t ? t.z : clip.origin.z; session.edit('paste', (tx) => pasteStamp(tx, clip, x, z), { mask: sel.writeMask }); shell.toast(`pasted ${clip.w}x${clip.d} at ${x},${z}`); refreshDoc(); },
    'edit.symmetry': () => { symmetry = SYM_MODES[(SYM_MODES.indexOf(symmetry) + 1) % SYM_MODES.length]; shell.stat('sym', symmetry); shell.toast(`symmetry: ${symmetry}`); },
    'sel.all': () => { sel.all(); afterSel(); }, 'sel.none': () => { sel.none(); afterSel(); }, 'sel.invert': () => { sel.invert(); afterSel(); },
    'sel.grow': () => { sel.grow(1); afterSel(); }, 'sel.shrink': () => { sel.shrink(1); afterSel(); }, 'brush.size': (n) => { brushSize = Math.max(1, Math.min(16, brushSize + n)); shell.stat('brush', brushSize); },
    'tool.slot': (i) => { const t = [...list('brush'), ...list('tool')][i]; if (t) pickTool(t.id); },
    'cam.rotate': (d) => vp.camera.rotate(d), 'cam.pitch': () => vp.camera.togglePitch(), 'cam.frame': () => { if (ladder.map) vp.fit(ladder.map); },
    'cam.zoom': (f) => vp.camera.setZoom(vp.camera.targetZoom * f), 'layer.visible': (i) => layers.toggleVisibleAt(i), 'layer.lock': (i) => layers.toggleLockAt(i),
    'view.dock': () => { shell.showDock(); onResize(); }, 'view.rail': () => { shell.showRail(); onResize(); },
    'help.keys': () => shell.modal({ title: 'Keyboard', body: keyTable(keymap.rows()), buttons: [{ label: 'Close', value: null, kind: 'primary' }] }),
    'ui.cancel': () => { if (shell.openModal) shell.openModal(null); else if (gest && gest.cancel()) shell.stat('gest', '-'); else shell.closeMenus(); },
    'ui.commit': () => { if (gest && gest.close()) shell.stat('gest', '-'); },
    'map.validate': () => { const r = validateDef(session.def); shell.modal({ title: `${r.errors.length} error(s), ${r.warnings.length} warning(s)`, body: issueList(r.issues.slice(0, 60)), buttons: [{ label: 'Close', value: null }] }); },
  };
  const dispatch = (action, arg) => { const fn = A[action]; if (!fn) return console.warn('[editor] no action', action); return fn(arg); };
  /** Run a registry record by id. The LOCK GATE is here, once, so every tool obeys it. */
  function run(id, values, gctx) {
    const rec = byId(id);
    if (!rec) return void shell.toast(`no tool '${id}'`, 'warn');
    const gate = layers.allow(rec.channels);
    if (!gate.ok) return void shell.toast(`${rec.label} is blocked: ${gate.blocked.join(', ')} locked`, 'warn');
    const p = { ...ctx, ...(gctx || {}), params: paramsFor(rec, { ...rec.defaults, ...(values || {}), size: brushSize }) };
    try { if (typeof rec.run === 'function') return rec.run(session, p);       // a selector, not an edit
      return session.edit(rec.label, (tx) => rec.apply(tx, p), { mask: sel.writeMask });
    } catch (e) { console.error('[editor]', id, 'threw', e); shell.toast(`${rec.label}: ${(e && e.message) || e}`, 'err'); return null; }
  }
  /** Rail click, keymap or __EDITOR__.pickTool. A record with a cursor ARMS and waits for the gesture
   *  it declared; only cursor 'none' fires on the spot. Firing a 'drag-rect' record on the rail
   *  click, with no rectangle to hand it, is what left 27 of the 39 registered tools inert. */
  function pickTool(id) {
    const rec = byId(id);
    if (!rec) return null;
    shell.setActiveTool(id); if (gest) gest.cancel(); shell.stat('gest', '-');
    if (rec.cursor === 'none') { armed = null; shell.stat('tool', rec.label); return run(id); }
    armed = rec; shell.stat('tool', `${rec.label} - ${CURSOR_HINT[rec.cursor] || rec.cursor}`);
    return id;
  }

  /** Whole-document replacement, THROUGH the session so it is one undo entry like everything else. */
  function swap(next, label) {
    session.edit(label || 'replace document', (tx) => tx.replaceDoc(next));
    sel.resize(session.w, session.d); sel.none(); ladder.rebuildAll(); if (ladder.map) vp.fit(ladder.map); refreshDoc();
  }
  const afterSel = () => shell.stat('sel', sel.count);   // a selector's write is not a session change
  /** The eye column, applied to the scene objects this file owns. */
  function applyLayers() { if (ladder && ladder.props) ladder.props.visible = layers.visible('props'); }
  const keymap = await step('keymap', () => new Keymap({ dispatch, run: (id) => pickTool(id) }).attach(window));
  // The wheel is not a chord, so it is bound here rather than in the table, with the game's factors.
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); vp.camera.setZoom(vp.camera.targetZoom * (e.deltaY < 0 ? 1.1 : 0.9)); }, { passive: false });
  // ---- pointer. ui/shell.js's recogniser collects whatever the ARMED record's `cursor` declares;
  // this file only says what each shape MEANS. It stands down while a plugin owns the canvas through
  // `__EDITOR__.pointerOwner`, because two drivers on one canvas is a double-apply.
  const brushCells = (x, z) => { const out = [], r = Math.floor((brushSize - 1) / 2); for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) out.push([x + dx, z + dz]); return out; };
  /** A gesture in every spelling the tool files read. `tile` is an ARRAY that also carries the
   *  picker's fields: tools/height.js indexes it [0]/[1] and tools/select.js reads .x/.z, and one
   *  object answering both beats a convention two other workers' files must agree on. No tile is
   *  invented — off the board the fields are absent and the tool no-ops instead of dabbing at 0,0. */
  const geom = (g) => { const t = g.tile, a = t ? Object.assign([t.x, t.z], t) : null;
    return { ...g, tile: a, at: a, hover: a, x: t && t.x, z: t && t.z, cells: t ? brushCells(t.x, t.z) : [] }; };
  const hint = (g) => (g.rect ? `rect ${Math.abs(g.rect[2] - g.rect[0]) + 1}x${Math.abs(g.rect[3] - g.rect[1]) + 1}` : g.poly ? `poly ${g.poly.length} pt` : g.from ? `line ${g.from} - ${g.to}` : '-');
  gest = createGestures({ canvas, toTile: (ev) => picker.setPointer(ev).pick(ev),
    kindOf: () => (E.pointerOwner || !armed ? null : armed.cursor),
    on(phase, g) {
      if (g.tile) shell.stat('tile', `${g.tile.x},${g.tile.z} h${g.tile.h}`);
      if (g.kind === 'paint') return void paint(phase, g);
      if (phase === 'hover' || !armed) return;
      shell.stat('gest', phase === 'end' || phase === 'cancel' ? '-' : hint(g));
      if (phase !== 'end') return;   // ONE fire per gesture: per-move would be fifty undo entries
      run(armed.id, null, geom(g)); afterSel(); refreshDoc();
    } });
  /** One brush dab per move, in its own transaction, coalesced into one undo entry by strokeId. */
  function paint(phase, g) {
    const rec = armed;
    if (phase === 'start') { if (g.tile) { picker.beginStroke(); ladder.beginStroke(); stroke = 'p' + Date.now(); } return; }
    if (!stroke || !rec || !rec.apply) return;
    if (phase !== 'move') { stroke = null; picker.endStroke(); ladder.endStroke(); return void refreshDoc(); }  // release: the truth is owed
    const gate = layers.allow(rec.channels);
    if (!gate.ok) { stroke = null; return void shell.toast(`${gate.blocked.join(', ')} locked`, 'warn'); }
    if (!g.tile) return;
    try { const tx = beginSymmetric(session, rec.label, { mode: symmetry, mask: sel.writeMask, strokeId: rec.coalesce ? stroke : null });
      rec.apply(tx, { ...ctx, ...geom(g), params: paramsFor(rec, { ...rec.defaults, size: brushSize }) }); session.commit(tx); }
    catch (e) { console.error('[editor] brush threw', e); stroke = null; }
  }
  const storage = await step('storage', () => new Storage({ session, onEvent: (e) => { if (e.kind.endsWith('failed')) shell.toast(`${e.kind}: ${e.error}`, 'err'); shell.stat('auto', e.slot || '-'); } }).start());
  ctx.storage = storage;  // the plugin ctx is built before the storage stage; this is the one late field
  // NOT hashDef here: a coalescing stroke commits once per pointermove and hashDef stringifies the
  // whole document. refreshDoc() refreshes the badge at stroke end, where it costs nothing.
  session.on('change', () => { shell.stat('undo', session.history.depth); shell.stat('sel', sel.count); });

  // ---- menus. Labels and hints come out of the ONE binding table, so a menu item and its key can
  // never disagree; only the grouping lives here.
  const mi = (action, over) => { const b = bindingOf(action) || {}; return { id: action, label: (over && over.label) || b.label || action, kbd: b.chord ? labelOf(b.chord) : '', on: () => dispatch(action, b.arg), ...(over || {}) }; };
  shell.setMenus([
    { label: 'File', items: () => [mi('file.new'), mi('file.import'), '-', mi('file.save'), mi('file.saveAs'), '-', mi('file.exportModule'), mi('file.exportJson'), mi('file.writeMaps'), '-', mi('playtest.run', { label: 'Playtest in the game' })] },
    { label: 'Edit', items: () => [mi('edit.undo', { disabled: !session.canUndo() }), mi('edit.redo', { disabled: !session.canRedo() }), '-', mi('edit.copy'), mi('edit.cut'), mi('edit.paste'), '-', mi('edit.symmetry', { label: `Symmetry: ${symmetry}` })] },
    { label: 'Select', items: () => [mi('sel.all'), mi('sel.none'), mi('sel.invert'), '-', mi('sel.grow'), mi('sel.shrink')] },
    { label: 'View', items: () => [mi('view.dock'), mi('view.rail'), mi('cam.frame'), '-', ...layers.menuItems('visible'), '-', ...layers.menuItems('lock')] },
    { label: 'Map', items: () => [{ id: 'map.validate', label: 'Validate...', kbd: '', on: () => dispatch('map.validate') }, '-', ...listSlots().slice(0, 8).map((s) => ({ id: 'slot.' + s.name, label: `Open slot: ${s.label}`, on: () => { const r = readSlot(s.name); if (r) swap(r.def, `open ${s.name}`); } }))] },
    { label: 'Help', items: () => [mi('help.keys')] },
  ]);
  function refreshDoc() {
    // The size is a status-bar fact, not part of the name: blankDef already calls a new map
    // "Untitled 16x16", so appending it here read "Untitled 16x16 16x16".
    const d = session.def;
    shell.setSubtitle(d.name); shell.stat('size', `${d.size.w}x${d.size.d}`); document.title = `${d.name} - Map Builder`; shell.setBadge(hashDef(session.doc), 'ok');
    shell.clear(slotList).append(h('div', 'ed-kv', h('span', 'k', 'id'), h('span', 'v', d.id), h('span', 'k', 'slot'), h('span', 'v', storage && storage.slot ? storage.slot : '-'), h('span', 'k', 'props'), h('span', 'v', String(d.props.length))));
  }

  // ---- frame loop. terrain.userData.update and the billboard sweep are NOT optional: they make the
  // editor viewport the same picture the game draws (water shader, tree facing).
  function onResize() { const r = shell.viewportRect(); vp.resize(r.width, r.height); }
  window.addEventListener('resize', onResize); onResize();
  let last = performance.now(), frozen = false;
  const frame = (t) => {
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (!frozen) { ladder.tick(t);
      if (ladder.terrain && ladder.terrain.userData.update) ladder.terrain.userData.update(t / 1000);
      if (ladder.props) ladder.props.traverse((o) => { if (o.userData.billboard) o.rotation.y = vp.camera.yawNow; });
      vp.render(dt); }
    requestAnimationFrame(frame);
  };
  await step('loop', () => requestAnimationFrame(frame));

  Object.assign(E, {          // ---- the two handles
    ready: true, stage: 'ready', session, shell, layers, keymap, storage, ladder, viewport: vp, picker, sel, io, playtest,
    scene: vp.scene, camera: vp.camera, pipeline: vp.pipeline, renderer: vp.pipeline.renderer, lighting: vp.lighting,
    get def() { return session.def; }, get MAP() { return ladder.map; }, get map() { return ladder.map; },
    run, dispatch, pickTool, swap, gestures: gest, tools: () => keymapHints, hash: () => hashDef(session.doc),
    armedTool: () => armed, clipboard: () => clip,   // live: Object.assign would snapshot a getter
    /** Direct session access, for a headless test driving the editor with no pointer. */
    edit(label, fn) { return session.edit(label, fn, { mask: sel.writeMask }); },
    // __GAME__ surface, with the game's own preset semantics recentred on THIS map.
    applyPreset(n) { const m = ladder.map; if (!m) return; const maxH = m.tiles.flat().reduce((a, q) => Math.max(a, q.h), 0) * HSTEP;
      vp.camera.applyView({ ...(PRESETS[n] || PRESETS.wide), focus: V(m.w / 2, maxH * 0.45, m.d / 2) }); vp.camera.snap(); },
    settle() { vp.camera.snap(); }, freeze(v) { frozen = !!v; if (!v) last = performance.now(); },
    render() { vp.pipeline.render(vp.scene, vp.camera.cam, 0); }, fxStep(dt = 0) { vp.render(dt); },
    async scenario() { return null; },   // the editor has no battle to pose
  });
  refreshDoc(); bootDone();

  // Recovery is offered AFTER the shell exists and lands as an ordinary undoable replaceDoc, so an
  // author who accepts it by reflex can Ctrl+Z back out. Deliberately the last thing boot does:
  // `ready` is already true, so a test never waits on a modal nobody will answer.
  if (recovery.found) {
    E.recovery = recovery;
    shell.modal({ title: 'Recover unsaved work?', body: `The last session ended without closing. An autosave from ${new Date(recovery.at || Date.now()).toLocaleTimeString()} is in slot '${recovery.slot}' (${recovery.label}).`,
      buttons: [{ label: 'Discard', value: false }, { label: 'Recover', kind: 'primary', value: true }] }).then((take) => { Storage.clearRecovery(); if (take) { swap(recovery.def, `recover ${recovery.slot}`); shell.toast(`recovered from ${recovery.slot}`, 'ok'); } });
  }
  return E;
}

try { await boot(); } catch (err) {
  // A CARD, not a rethrow, and bootFail rather than bootCard: editor.html's own catch would replace
  // this with a vaguer message, and it removes the #ed-boot element it captured as soon as this
  // module resolves — which would take a card written into that element with it.
  E.failed = true; E.error = String((err && err.stack) || err);
  bootFail('Map Builder failed', `${(err && err.message) || err}\n\n${(err && err.cause && err.cause.stack) || (err && err.stack) || ''}`);
  console.error('[editor] boot failed at stage', stage, err);
}
