import * as THREE from 'three';
import { screenToTile } from '../render/camera.js';
import { ABILITIES, CLASSES, STATUS, REACTIONS, SUPPORTS, MOVEMENTS, COUNTER_REACTIONS, effectTiles, targetTiles, computeEffect, hitChance, stat, abilityInfo, abilityCT, abilityRange, weaponRange, isRanged, isShaped, facingFrom } from './rules.js';
import { SKILLSET } from './data.js';
import { threatCount, strikeZone, decide as aiDecide } from './ai.js';
import { prefs } from '../ui/prefs.js';   // Options: end-turn prompt, confirm actions
// Remapped keys arrive here as the keys below: src/ui/prefs.js re-dispatches them before this listener runs.
// Human controller for team A, in the classic tactics command idiom:
//   Menu: Move (becomes "Undo Move" after walking, until you act) / Act / Wait / Status / Auto-battle.
//   Act:  Attack / <primary skillset> / <secondary skillset>, each skillset a submenu with MP, range and CT.
//   Aim:  red target field, orange effect footprint, forecast plate (damage or heal, hit %, KO, back/side, high ground,
//         charge time, counter risk) and the turn strip re-forecast so you see where you land and when a charge fires.
//   End:  every turn ends on a facing pick — four ground arrows, arrows/WASD or the mouse, Enter/click to confirm.
// Keys: arrows/WASD move menus and the tile cursor (screen-relative at every camera yaw) · Enter/Space confirm ·
//       Esc/Backspace/X/right-click cancel (at the top menu: undo the move) · Tab cycle targets · 1-9 pick a command ·
//       F battle speed x1/x2/x4 · Q/E rotate and T tilt are the camera's (src/main.js).
// Cursor keys are screen-relative: camera.screenToTile maps screen up/right/down/left to a tile delta at the
// camera's current yaw stop. It owns the 8-stop rounding (and the tie-break at the dimetric stops); never
// re-derive it here, or the cursor and the editor's picking disagree at half the stops.
// Footprint tag for both menus. abilityInfo reports a shaped ability's reach in `area` and names the shape in
// `shape`, so a plus/rank/file/ring/line stops printing as the single tile `ab.area` claims it is.
const foot = (i) => (i.area ? ` A${i.area}${i.shape ? ' ' + i.shape : ''}` : '');
const SPEEDS = [1, 2, 4];
const ORD = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const faceTo = (u, x, z) => { const dx = x - u.x, dz = z - u.z; if (!dx && !dz) return null; return Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 1 : 3) : (dz >= 0 ? 0 : 2); };
export class PlayerController {
  constructor(battle, ui, overlay, camera, canvas) {
    Object.assign(this, { battle, ui, overlay, camera, canvas }); this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2(); this.hover = null; this.pick = null; this.cancel = null; this.cursor = null; this.busyTurn = null;
    canvas.addEventListener('mousemove', (e) => { this.mouse.set((e.clientX / canvas.clientWidth) * 2 - 1, -(e.clientY / canvas.clientHeight) * 2 + 1); this.updateHover(); });
    canvas.addEventListener('click', () => { if (this.pick && this.hover) this.pick(this.hover); else if (this.confirmFn) this.confirmFn(); });
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.cancel?.(); });
    // Registered before src/main.js's own keydown (the controller is built first), so a confirm on Space during a
    // player turn can stop the same key from also toggling auto-battle there.
    window.addEventListener('keydown', (e) => this.onKey(e));
    // Hold Shift: enemy (and AI) turns run x4 while it is held; released, or the player's own turn starts, and the
    // speed returns to whatever it was (unless something else -- F, the Options screen -- changed it meanwhile).
    window.addEventListener('keyup', (e) => { if (e.key === 'Shift') this.fastForward(false); });
    window.addEventListener('blur', () => this.fastForward(false));
    this.lastCmd = new Map();   // per unit: the ability-menu row last confirmed (the genre keeps the cursor per unit)
    ui.setSpeed?.(battle.speed || 1);
  }
  onKey(e) {
    const k = e.key; const menuOpen = !!this.ui.menuItems;
    if (k === 'Shift') { if (!e.repeat) this.fastForward(true); return; }
    if ((k === 'v' || k === 'V') && !e.repeat) { this.toggleHeat(); return; }
    if (k === 'f' || k === 'F') { this.fastForward(false); const i = SPEEDS.indexOf(this.battle.speed); this.battle.speed = SPEEDS[(i + 1) % SPEEDS.length] || 1; this.ui.setSpeed?.(this.battle.speed); this.ui.announce(`Battle speed ×${this.battle.speed}`); return; }
    if (k === 'Escape' || k === 'Backspace' || k === 'x' || k === 'X') { if (this.cancel) { e.preventDefault(); this.cancel(); } return; }
    if (k === 'Enter' || (k === ' ' && this.busyTurn)) {
      if (this.busyTurn) { e.preventDefault(); e.stopImmediatePropagation(); }
      if (menuOpen) { this.ui.menuConfirm(); return; } if (this.pick && this.cursor) { this.pick(this.cursor); return; } if (this.confirmFn) this.confirmFn(); return;
    }
    if (k === 'Tab' && this.pick && this.targets?.length) { // cycle the cursor through the valid targets
      e.preventDefault(); this.targetIdx = (this.targetIdx + (e.shiftKey ? -1 : 1) + this.targets.length) % this.targets.length;
      const t = this.targets[this.targetIdx]; this.moveCursor(t.x, t.z); return;
    }
    if (menuOpen && k >= '1' && k <= '9') { // number keys jump straight to a command
      const i = +k - 1; if (i < this.ui.menuItems.length) { e.preventDefault(); this.ui.menuMove(i - this.ui.menuSel); this.ui.menuConfirm(); } return;
    }
    const dir = k === 'ArrowUp' || k === 'w' || k === 'W' ? 0 : k === 'ArrowRight' || k === 'd' || k === 'D' ? 1 : k === 'ArrowDown' || k === 's' || k === 'S' ? 2 : k === 'ArrowLeft' || k === 'a' || k === 'A' ? 3 : -1;
    if (dir < 0) return;
    if (menuOpen) { if (dir === 0 || dir === 2) { e.preventDefault(); this.ui.menuMove(dir === 0 ? -1 : 1); } return; }
    if (this.pick || this.facingFn) {
      e.preventDefault(); const [dx, dz] = screenToTile(dir, this.camera.yawIndex);
      if (this.facingFn) { this.facingFn(dx === 1 ? 1 : dx === -1 ? 3 : dz === 1 ? 0 : 2); return; }
      const c = this.cursor || this.hover || { x: this.battle.active?.x ?? 0, z: this.battle.active?.z ?? 0 }; this.moveCursor(c.x + dx, c.z + dz);
    }
  }
  fastForward(on) {
    const b = this.battle;
    if (on) { if (this._ff || this.busyTurn || b.over) return; this._ff = { base: b.speed || 1 }; b.speed = this._ff.base * 4; this.ui.setSpeed?.(b.speed); return; }
    if (!this._ff) return; if (b.speed === this._ff.base * 4) b.speed = this._ff.base; this._ff = null; this.ui.setSpeed?.(b.speed);
  }
  // R15 wow #4: V toggles the threat heatmap: every tile any foe can walk to and strike next turn, by how many
  // (one foe: amber, two or more: red). Repainted at each of the player's decisions while it is on.
  toggleHeat(on = !this.heatOn) {
    this.heatOn = on; this.paintHeat();
    this.ui.announce(on ? 'Threat map on · V hides it' : 'Threat map off');
  }
  paintHeat() {
    const ov = this.overlay; if (!ov.setHeat) return;
    const E = this.battle.engine; const u = this.battle.active;
    if (!this.heatOn || !E || this.battle.over) { ov.setHeat(null); return; }
    const side = u && u.team === 'A' ? u : this.battle.units.find((o) => o.team === 'A' && !o.ko && !o.removed); if (!side) { ov.setHeat(null); return; }
    const n = new Map();
    for (const v of E.enemiesOf(side)) {
      if (v.ko || v.removed || v.statuses?.stop || v.statuses?.sleep) continue;
      let zn; try { zn = strikeZone(E, v); } catch (e) { continue; }
      const seen = new Set(); for (const t of [...(zn.walk || []), ...(zn.strike || [])]) { const k = `${t.x},${t.z}`; if (seen.has(k)) continue; seen.add(k); n.set(k, (n.get(k) || 0) + 1); }
    }
    ov.setHeat([...n].map(([k, c]) => { const [x, z] = k.split(',').map(Number); return { x, z, n: c }; }));
  }
  // End-Turn prompt (Options): only when the unit could still do something worth a turn: a usable ability with a
  // target in reach from here (or from a tile it may still walk to). The AI's own chooser answers that question.
  couldAct(u) {
    const E = this.battle.engine; if (u.acted || u.charging || !E.canAct(u)) return false;
    try { return !!aiDecide(u, E).ab; } catch (e) { return true; }
  }
  moveCursor(x, z) { const t = this.battle.map.at(x, z); if (!t) return; this.cursor = { x, z }; this.overlay.setCursor(x, z); this.onHover?.(this.cursor); }
  updateHover() {
    const terrain = this.battle.scene.getObjectByName('terrain'); if (!terrain) return; this.ray.setFromCamera(this.mouse, this.camera.cam);
    const hits = this.ray.intersectObjects(terrain.children, true).filter((h) => !h.object.name.includes('skirt'));
    if (!hits.length) { this.hover = null; if (!this.cursor) this.overlay.setCursor(null); return; }
    const p = hits[0].point; const n = hits[0].face?.normal || new THREE.Vector3(0, 1, 0); const x = Math.floor(p.x + n.x * -0.01), z = Math.floor(p.z + n.z * -0.01);
    const t = this.battle.map.at(x, z); if (!t) { this.hover = null; return; }
    if (!this.hover || this.hover.x !== x || this.hover.z !== z) { this.hover = { x, z }; this.cursor = { x, z }; this.overlay.setCursor(x, z); this.onHover?.(this.hover); }
  }
  pickTile = (valid) => new Promise((res) => {
    const ok = new Set(valid.map((t) => `${t.x},${t.z}`));
    // Tab cycles occupied tiles first (that is what a player actually aims at), then the rest
    const occupied = valid.filter((t) => this.unitAt(t.x, t.z)); this.targets = occupied.length ? occupied : valid; this.targetIdx = -1;
    const done = (v) => { this.pick = null; this.cancel = null; this.targets = null; res(v); };
    // R15 (review15 P12): a confirm outside the field used to be silently ignored. Buzz, flash, and say why.
    this.pick = (t) => { if (ok.has(`${t.x},${t.z}`)) done(t); else this.ui.refuse?.(valid.length ? 'Out of range: pick a tile inside the field.' : 'Nothing in range.', t); };
    this.cancel = () => done(null);
  });
  unitAt(x, z) { return this.battle.units.find((u) => !u.removed && !u.airborne && u.x === x && u.z === z); }
  // hover card for any unit under the cursor while no ability is being aimed
  showHoverCard(h) {
    const v = h ? this.unitAt(h.x, h.z) : null;
    if (v && v !== this.battle.active) this.ui.forecast({ target: v, ability: { name: `${CLASSES[v.cls].name} Lv ${v.lvl}${v.leader ? ' · Leader' : ''}` }, hit: null, status: this.statusLine(v) });
    else this.ui.forecast(null);
  }
  statusLine(v) { const st = Object.keys(v.statuses).filter((s) => STATUS[s] && !STATUS[s].mod).map((s) => STATUS[s].name); return st.length ? st.slice(0, 3).join(', ') : null; }
  // opts: { mem: key under which the confirmed row is remembered and re-selected next time, title, onSel } (ui.menu)
  menu(items, back = true, opts = {}) {
    const { mem, ...o } = opts; if (mem && this.lastCmd.has(mem)) o.selId = this.lastCmd.get(mem);
    return new Promise((r) => { this.ui.nextMenuOpts = o; this.ui.menu(items, r, o); this.cancel = () => { this.cancel = null; this.ui.closeMenu(); r({ id: back === true ? 'back' : back }); }; })
      .then((c) => { this.cancel = null; if (mem && c.id !== 'back') this.lastCmd.set(mem, c.id); return c; });
  }
  // Turn-strip preview (Engine.forecast plan): where the acting unit's next turn falls under the choice on screen.
  // label: names the plan in a caption cell ("Wait" / "next 3rd") so the dashed slot is explained, not just drawn.
  previewStrip(plan, label = null) {
    const E = this.battle.engine; const list = E.forecast(8, plan);
    // the caption counts turns until this unit's next one, looking further ahead than the 7 cells the strip shows
    let cap = null; if (label) { const long = E.forecast(24, plan); const i = long.findIndex((o) => o.next); cap = { k: label, v: i > 0 ? `${ORD(i)} +${long[i].tick}` : 'later' }; }
    this.ui.setTurnOrder(list, cap);
  }
  // CT reset of ending the turn after `cmd` from here: the genre's 0 / 20 / 40 (both / one / neither of move and act).
  resetIf(u, cmd) {
    const acted = u.acted || !!u.charging; const moved = u.moved;
    if (cmd === 'move') return (acted ? 0 : 20); if (cmd === 'act') return (moved ? 0 : 20);
    return moved && acted ? 0 : moved || acted ? 20 : 40;
  }
  waitReset(u) { const acted = u.acted || !!u.charging; return u.moved && acted ? 0 : u.moved || acted ? 20 : 40; }
  decided() { const E = this.battle.engine; return E.checkVictory().over; }
  // REWIND: the turn is waiting on the player (a menu, a tile pick, the facing arrows, the Status sheet), not on an
  // animation. Only then may a rewind abandon it.
  awaitingInput() { return !!(this.busyTurn && !this.battle.over && (this.ui.menuItems || this.pick || this.facingFn || this.confirmFn)); }
  // decide() races the turn against an abort: battle.requestRewind -> battle.abortInput -> the turn resolves as
  // { rewind: true }. Every input hook is dropped first, so the abandoned turn's pending prompt can never resolve later.
  async decide(u) {
    let abort = null; const aborted = new Promise((r) => { abort = r; });
    this.battle.abortInput = () => {
      if (!this.awaitingInput()) return false;
      this.pick = null; this.cancel = null; this.facingFn = null; this.confirmFn = null; this.targets = null; this.onHover = null; this.cursor = null;
      this.ui.closeMenu(); this.ui.forecast(null); this.ui.announce(''); this.overlay.clear(); this.overlay.showFacing(0, 0, null); this.overlay.setCursor(null); this.overlay.setHeat?.(null);
      this.busyTurn = null; abort({ rewind: true }); return true;
    };
    try { return await Promise.race([this.decideTurn(u), aborted]); } finally { this.battle.abortInput = null; }
  }
  async decideTurn(u) {
    this.fastForward(false);
    const b = this.battle, E = b.engine; this.busyTurn = u; this.cursor = { x: u.x, z: u.z }; this.onHover = (h) => this.showHoverCard(h);
    let result = { done: true };
    if (u.auto) { // auto-battle unit: a short window to take control back (Esc / right-click), otherwise the AI plays it
      this.ui.announce(`${u.name}: auto-battle (Esc to take control)`);
      const manual = await new Promise((res) => { const t = setTimeout(() => { this.cancel = null; res(false); }, 700 / (b.speed || 1)); this.cancel = () => { clearTimeout(t); this.cancel = null; res(true); }; });
      if (!manual) { this.busyTurn = null; this.onHover = null; return null; } u.auto = false; this.ui.announce(`${u.name}: manual`);
    }
    for (;;) {
      if (u.ko || this.decided()) break;
      this.overlay.clear(); this.overlay.showActive(u.x, u.z); this.overlay.showFacing(0, 0, null); if (this.heatOn) this.paintHeat();
      const canMove = E.canMove(u), canAct = E.canAct(u); const undo = u.moved && !u.acted && !u.charging && !!b.moveSnap;
      this.previewStrip({ reset: this.waitReset(u) });
      const items = [undo ? { label: 'Undo Move', id: 'undo' } : { label: 'Move', id: 'move', enabled: canMove }, { label: 'Act', id: 'act', enabled: canAct }, { label: 'Wait', id: 'wait' }, { label: 'Status', id: 'status' }, { label: 'Auto-battle', id: 'auto' }];
      // At the command menu, hovering another unit shows its card and, for an enemy, where it can walk next turn (red)
      // and the ring its weapon / skills reach beyond that (orange): together, every tile it can strike.
      this.onHover = (h) => { this.showHoverCard(h); this.overlay.clear(); this.overlay.showActive(u.x, u.z); const v = h && this.unitAt(h.x, h.z);
        if (v && !v.ko && E.teamOf(v) !== E.teamOf(u)) { const zn = strikeZone(E, v); this.overlay.showThreat(zn.walk, zn.strike); } };
      // the CT strip follows the highlighted command: Move / Act / Wait each show where this unit's next turn lands
      const onSel = (it) => { const id = it?.id === 'undo' ? 'wait' : it?.id; const lab = id === 'move' ? 'Move' : id === 'act' ? 'Act' : 'Wait'; this.previewStrip({ reset: this.resetIf(u, id === 'move' || id === 'act' ? id : 'wait') }, lab); };
      const choice = await this.menu(items, undo ? 'undo' : 'back', { onSel }); this.ui.announce(''); this.onHover = (h) => this.showHoverCard(h);
      if (choice.id === 'back') continue;
      if (choice.id === 'undo') { if (b.undoMove(u)) { this.cursor = { x: u.x, z: u.z }; this.ui.announce('Move undone'); } continue; }
      if (choice.id === 'auto') { u.auto = true; this.ui.announce(`${u.name}: auto-battle`); result = null; break; } // hand this and future turns to the AI (toggle with the same command later)
      if (choice.id === 'status') { await this.statusView(u); continue; }
      if (choice.id === 'wait') {
        // Ending a turn that could still act is usually a slip of the Enter key: ask once (the genre's "Is this OK?").
        if (prefs().endPrompt && this.couldAct(u)) {   // Options > Gameplay > End-Turn Prompt (R15: not when nothing was in reach)
          this.ui.announce(`${u.name} has not acted · end the turn anyway?`);
          const c = await this.menu([{ label: 'End Turn', id: 'endyes' }, { label: 'Keep Turn', id: 'endno' }], 'endno', { title: 'Not Acted' }); this.ui.announce('');
          if (c.id !== 'endyes') continue;
        }
        const f = await this.pickFacing(u, true); if (f == null) continue; result = { done: true, facing: f }; break;
      }
      if (choice.id === 'move') {
        const reach = E.reach(u); this.overlay.showMove(reach.tiles); this.ui.announce('Move · pick a tile');
        // QA r12 #18: a hand-played opening walked into the enemy's reach with nothing to hit (the AI prices exactly that).
        // The destination card now says how many foes could strike the tile next turn, before the player commits.
        this.onHover = (h) => { this.showHoverCard(h); this.overlay.clear(); this.overlay.showMove(reach.tiles); this.overlay.showActive(u.x, u.z);
          const inReach = reach.tiles.some((t) => t.x === h.x && t.z === h.z) || (h.x === u.x && h.z === u.z);
          if (inReach) { const p = reach.path(h.x, h.z); if (p && !reach.teleport) this.overlay.showArea(p.map(([x, z]) => ({ x, z }))); }
          const occ = this.unitAt(h.x, h.z); if (inReach && (!occ || occ === u)) { let n = 0; try { n = threatCount(E, u, h.x, h.z); } catch (e) { /* preview only */ } this.ui.forecast({ target: u, ability: { name: 'Move here' }, hit: null, danger: n }); } };
        const t = await this.pickTile(reach.tiles); this.onHover = (h) => this.showHoverCard(h); this.ui.forecast(null); this.overlay.clear(); this.ui.announce('');
        if (t) { await b.moveTo(u, t); this.cursor = { x: u.x, z: u.z }; this.camera.lookAt(b.worldPos(u.x, u.z, 0.6)); }
        if (u.moved && (u.acted || u.charging || !E.canAct(u))) { const f = await this.pickFacing(u, false); result = { done: true, facing: f }; break; }
        continue;
      }
      if (choice.id === 'act') {
        const acted = await this.actMenu(u);
        if (this.decided() || u.ko) break;
        if (acted && (u.moved || !E.canMove(u))) { const f = await this.pickFacing(u, false); result = { done: true, facing: f }; break; }
        continue;
      }
    }
    this.onHover = null; this.ui.forecast(null); this.overlay.clear(); this.overlay.showFacing(0, 0, null); this.overlay.setCursor(null); this.cursor = null; this.busyTurn = null;
    if (this.heatOn) this.overlay.setHeat?.(null);   // the map is a planning aid: it is off the field while the others move
    return result;
  }
  // Act: Attack + one row per skillset (the genre's command layout); returns true once an ability was used.
  async actMenu(u) {
    const E = this.battle.engine; const primary = CLASSES[u.cls].name;
    const sec = new Set(u.secondaryList || []);
    const prim = u.abilityList.filter((id) => id !== 'attack' && !ABILITIES[id].hidden && !sec.has(id));
    const second = u.abilityList.filter((id) => sec.has(id));
    for (;;) {
      const items = [{ label: 'Attack', id: 'attack', enabled: abilityInfo(u, 'attack').usable }];
      if (prim.length) items.push({ label: SKILLSET[u.cls] || primary, id: 'set:p' });
      if (second.length) items.push({ label: SKILLSET[u.secondary] || CLASSES[u.secondary]?.name || 'Skills', id: 'set:s' });
      const c = await this.menu(items, true, { mem: `${u.id}|act` }); if (c.id === 'back') return false;
      if (c.id === 'attack') { if (await this.aim(u, 'attack')) return true; continue; }
      const list = c.id === 'set:p' ? prim : second;
      for (;;) {
        const abs = list.map((id) => { const i = abilityInfo(u, id); return { label: i.item != null ? `${i.name} ×${i.item}` : i.name, id, mp: i.mp || null, enabled: i.usable, info: i }; });
        // R15 wow #4: hovering a skill previews the CT strip under it: where this unit's next turn lands and, for a
        // charged skill, the slot where it resolves (the dashed 'charge' cell), before anything is aimed.
        const onSel = (it) => { const ab = ABILITIES[it?.id]; if (!ab) return; const ct = abilityCT(u, ab); this.previewStrip({ reset: u.moved || E.canMove(u) ? 0 : 20, charge: ct || null }, ct ? `CT ${ct}` : 'Act'); };
        const a = await this.menu(abs, true, { mem: `${u.id}|${c.id}`, onSel }); if (a.id === 'back') break;
        if (await this.aim(u, a.id)) return true;
      }
      if (E.checkVictory().over) return false;
    }
  }
  // Target an ability: red field, footprint, forecast, strip preview. Returns true once it was used.
  async aim(u, id) {
    const b = this.battle, E = b.engine; const ab = ABILITIES[id]; let tiles = targetTiles(u, b.map, ab);
    // Dual-target (Swap / Clock Swap / Soul Trade): both picks must hold a live unit on the right
    // side, so the candidate list is unit-filtered up front and the second pick reuses it.
    if (ab.dual) { const team = E.teamOf(u); tiles = tiles.filter((s) => { const o = this.unitAt(s.x, s.z); return o && !o.ko && ((ab.dualTeam === 'allies') === (E.teamOf(o) === team)); }); }
    this.overlay.clear(); this.overlay.showActive(u.x, u.z); this.overlay.showTarget(tiles);
    const info = abilityInfo(u, id); const ct = abilityCT(u, ab);
    this.ui.announce(`${info.name} · R${info.range}${foot(info)}${info.ct ? ' CT' + info.ct : ''}${info.desc ? ' · ' + info.desc : ''}`);
    // Strip preview: acting now, the unit restarts at 0 if it has moved or still can, else 20; a charge is queued.
    this.previewStrip({ reset: u.moved || E.canMove(u) ? 0 : 20, charge: ct || null });
    // Aim from the unit's own tile: put the cursor on the nearest valid occupied target so the forecast is up at once.
    const occ = tiles.filter((t) => { const o = this.unitAt(t.x, t.z); return o && o !== u && !o.ko; });
    if (occ.length && !ab.self) { const pref = occ.filter((t) => { const o = this.unitAt(t.x, t.z); return (E.teamOf(o) === E.teamOf(u)) === !!(ab.ally || ab.kind === 'heal' || ab.kind === 'buff' || ab.kind === 'raise'); });
      const pool = pref.length ? pref : ab.kind === 'phys' || ab.kind === 'mag' || ab.kind === 'debuff' ? [{ x: u.x, z: u.z }] : occ; pool.sort((p, q) => (Math.abs(p.x - u.x) + Math.abs(p.z - u.z)) - (Math.abs(q.x - u.x) + Math.abs(q.z - u.z))); this.cursor = { ...pool[0] }; this.overlay.setCursor(pool[0].x, pool[0].z); }
    else if (tiles.length === 1) { this.cursor = { ...tiles[0] }; this.overlay.setCursor(tiles[0].x, tiles[0].z); }
    this.onHover = (h) => {
      this.overlay.clear(); this.overlay.showActive(u.x, u.z); this.overlay.showTarget(tiles);
      if (!tiles.some((t) => t.x === h.x && t.z === h.z)) { this.showHoverCard(h); return; }
      // The card has to be built from the SAME ctx Engine.resolve builds, or it quotes a number the engine was
      // never going to apply: victims() only walks a chain when it is handed a `hops` map, and computeEffect's
      // Pack Tactics / Duelist branch is gated on ctx.units.
      const hops = ab.chain ? new Map() : null;
      const base = ab.falloff ? { units: b.units, anchor: h } : { units: b.units };
      const vs = E.victims(u, ab, h, base, hops);
      const area = effectTiles(u, h, ab, b.map).concat(hops ? [...hops.keys()].map((o) => ({ x: o.x, z: o.z })) : []);
      if (area.length > 1 || isShaped(ab)) this.overlay.showArea(area);
      const v = vs.find((o) => o.x === h.x && o.z === h.z) || vs[0];
      if (v) this.ui.forecast(this.forecastFor(u, v, ab, hops, base, vs.length, ct));
      else this.ui.forecast({ target: u, ability: ab, hit: null, ct, status: 'No target' });
    };
    if (this.cursor) this.onHover(this.cursor);
    const aimHover = this.onHover;
    const t = await this.pickTile(tiles); this.onHover = (h) => this.showHoverCard(h); this.ui.forecast(null); this.overlay.clear(); this.overlay.showActive(u.x, u.z); this.ui.announce('');
    if (!t) return false;
    let tgt = t;
    if (ab.dual) { // second pick: the same side-filtered list, minus the first body
      const seconds = tiles.filter((s) => s.x !== t.x || s.z !== t.z);
      if (!seconds.length) return false;   // alone on the board: the card has no legal pair and is simply not cast
      this.ui.announce(`${info.name} · pick a second unit`); this.overlay.showTarget(seconds); this.onHover = null;
      tgt = await this.pickTile(seconds);
      this.onHover = (h) => this.showHoverCard(h);
      if (!tgt) { this.ui.announce(''); this.overlay.clear(); this.overlay.showActive(u.x, u.z); return false; }
      tgt = { x: t.x, z: t.z, second: { x: tgt.x, z: tgt.z } };
    }
    // Options > Gameplay > Confirm Actions: the genre's "Execute?" with the field, footprint and forecast still on screen.
    if (prefs().confirm) {
      this.cursor = { x: t.x, z: t.z }; this.overlay.setCursor(t.x, t.z); aimHover(t); const keepHover = this.onHover; this.onHover = null;
      this.ui.announce(`${info.name} · execute?`);
      const c = await this.menu([{ label: 'Execute', id: 'exec' }, { label: 'Cancel', id: 'no' }], 'no', { title: info.name });
      this.onHover = keepHover; this.ui.announce(''); this.ui.forecast(null); this.overlay.clear(); this.overlay.showActive(u.x, u.z);
      if (c.id !== 'exec') { this.cursor = { x: u.x, z: u.z }; return false; }
    }
    await b.useAbility(u, id, tgt); this.cursor = { x: u.x, z: u.z };
    return true;
  }
  forecastFor(u, v, ab, hops, base, nVictims, ct) {
    const E = this.battle.engine; const hop = hops && hops.get(v);
    const eff = computeEffect(u, v, ab, this.battle.map, hop ? { ...base, chainMul: Math.pow(ab.chain.falloff, hop) } : base);
    const hit = hitChance(u, v, ab, this.battle.map); const foe = E.teamOf(v) !== E.teamOf(u);
    const harmful = ab.kind === 'phys' || ab.kind === 'mag';
    const out = { target: v, dmg: eff.absorb ? 0 : eff.dmg, heal: eff.heal || (eff.absorb ? eff.heal : 0), hit, ability: ab, victims: nVictims, ct };
    if (harmful && foe) {
      out.ko = eff.dmg >= v.hp && !eff.absorb; if (eff.absorb) out.status = 'Absorbs!'; else if (eff.elemMul > 1) out.status = 'Weak!'; else if (eff.elemMul === 0) out.status = 'Immune'; out.side = ab.kind === 'phys' ? eff.side : null; out.height = eff.height;
      // Counter risk: the victim's reaction fires at BRV% if it is a counter-type answer to this kind of blow, the
      // victim survives, and the attacker stands in its reach.
      const melee = ab.kind === 'phys' && !isRanged(u, ab) && !isShaped(ab) && !(ab.area > 0);
      const r = v.reaction; const d = Math.abs(u.x - v.x) + Math.abs(u.z - v.z);
      const can = !out.ko && !v.charging && !Object.keys(v.statuses).some((s) => STATUS[s]?.noReact) && COUNTER_REACTIONS.has(r) && (
        ((r === 'counter') && ab.kind === 'phys' && d <= abilityRange(v, ABILITIES.counter_hit)) || (r === 'counter_tackle' && melee) || (r === 'riposte' && melee) ||
        (r === 'return_fire' && ab.kind === 'phys' && isRanged(u, ab) && d <= abilityRange(v, ABILITIES.return_shot)) || (r === 'magic_counter' && ab.kind === 'mag') || r === 'tidal_retort');
      if (can) out.counter = `${REACTIONS[r]?.name || 'Counter'} ${stat(v, 'brv')}%`;
      else if (['parry', 'reflex', 'blade_catch'].includes(r) && ab.kind === 'phys' && !out.ko) out.counter = `${REACTIONS[r].name} ${stat(v, 'brv')}%`;
    }
    const st = ab.status ? (typeof ab.status === 'string' ? { id: ab.status, chance: 100 } : ab.status) : ab.statuses ? { id: ab.statuses[0], chance: 100 } : null;
    if (st && STATUS[st.id] && foe && !out.status) out.status = `${STATUS[st.id].name} ${Math.round(hit * (st.chance ?? 100) / 100)}%`;
    return out;
  }
  // End-of-turn facing (genre convention): four arrows on the ground around the unit, the chosen one lit. Arrows/WASD are
  // screen-relative, the mouse points at a tile to face it, Enter/Space/click confirm. With `cancellable` (Wait),
  // Esc backs out to the menu (returns null); otherwise Esc confirms the current facing.
  pickFacing(u, cancellable) {
    return new Promise((res) => {
      const s = this.battle.spriteOf(u); const E = this.battle.engine; let f = u.facing;
      // default: face the nearest enemy (the direction most turns should end on)
      const e = E.enemiesOf(u).sort((a, b) => (Math.abs(a.x - u.x) + Math.abs(a.z - u.z)) - (Math.abs(b.x - u.x) + Math.abs(b.z - u.z)))[0];
      if (e) { const nf = faceTo(u, e.x, e.z); if (nf != null) f = nf; }
      const f0 = u.facing; const set = (nf) => { f = nf; u.facing = f; s.facing = f; this.overlay.showFacing(u.x, u.z, f); };
      set(f); this.previewStrip({ reset: this.waitReset(u) }, 'End');
      this.ui.announce('Facing · arrows or mouse, Enter to end turn');
      this.overlay.setCursor(null); this.cursor = null;
      const prevHover = this.onHover; this.onHover = (h) => { const nf = faceTo(u, h.x, h.z); if (nf != null) set(nf); };
      const done = (val) => { this.facingFn = null; this.confirmFn = null; this.cancel = null; this.pick = null; this.onHover = prevHover; this.overlay.showFacing(0, 0, null); this.ui.announce(''); res(val); };
      this.facingFn = (nf) => set(nf);
      this.pick = () => done(f);
      this.confirmFn = () => done(f);
      this.cancel = () => { if (cancellable) { u.facing = f0; s.facing = f0; done(null); } else done(f); };
    });
  }
  // Status window: full stats, statuses, ability set with costs, R/S/M slots. Closes on confirm/cancel/click.
  statusView(u) {
    const c = CLASSES[u.cls]; const st = Object.keys(u.statuses).map((s) => STATUS[s]?.name + (u.statuses[s] < 99 ? ` (${u.statuses[s]})` : '')).filter(Boolean).join(', ') || '—';
    const row = (k, v) => `<div style="display:flex;justify-content:space-between;gap:14px"><span>${k}</span><b>${v}</b></div>`;
    const abil = u.abilityList.filter((id) => !ABILITIES[id].hidden).map((id) => { const i = abilityInfo(u, id); return `<div style="display:flex;justify-content:space-between;gap:10px;opacity:${i.usable ? 1 : 0.55}"><span>${i.name}${i.item != null ? ' ×' + i.item : ''}</span><span>${i.mp ? i.mp + ' MP' : ''} R${i.range}${foot(i)}${i.ct ? ' CT' + i.ct : ''}</span></div>`; }).join('');
    const html = `<div style="min-width:260px"><div style="font-weight:700;font-size:16px">${u.name} <span style="opacity:.8">· ${c.name} Lv ${u.lvl}</span></div>
      ${row('HP', `${u.hp} / ${u.maxHp}`)}${row('MP', `${u.mp} / ${u.maxMp}`)}${row('CT', u.ct)}${row('ATK / DEF', `${stat(u, 'atk')} / ${stat(u, 'def')}`)}${row('MAG / RES', `${stat(u, 'mag')} / ${stat(u, 'res')}`)}
      ${row('SPD · MOVE · JUMP', `${stat(u, 'spd')} · ${stat(u, 'move')} · ${stat(u, 'jump')}`)}${row('EVA · BRV', `${stat(u, 'eva')}% · ${stat(u, 'brv')}`)}${row('Weapon range', weaponRange(u))}
      ${row('Status', st)}
      <div style="margin-top:6px;border-top:1px solid rgba(255,255,255,.3);padding-top:4px"><b>Abilities</b>${abil}</div>
      <div style="margin-top:4px">${row('Reaction', REACTIONS[u.reaction]?.name || '—')}${row('Support', SUPPORTS[u.support]?.name || '—')}${row('Movement', MOVEMENTS[u.movement]?.name || '—')}</div>
      <div style="margin-top:6px;opacity:.75;font-size:12px">${REACTIONS[u.reaction]?.desc || ''}</div><div style="opacity:.6;font-size:11px;margin-top:4px">Enter / Esc / click to close</div></div>`;
    this.ui.forecast(html);
    return new Promise((res) => { const done = () => { this.confirmFn = null; this.cancel = null; this.pick = null; this.ui.forecast(null); res(); }; this.confirmFn = done; this.cancel = done; this.pick = done; });
  }
}
