// Pre-battle DEPLOYMENT (classic tactics formation phase). Campaign battles only: battlelink.js awaits
// runDeployment() between the opening fade and battle.run(). The capture boot (tools/shot.mjs, ?mode=ai, ?scenario)
// never calls it, so those frames are unchanged.
//
// The map is shown with the enemy line-up in place and the company's deploy tiles lit blue: the map's A spawns plus
// any tiles it declares (MAP.deploy.A / MAP.deployA) plus up to four free tiles beside the spawns that are no nearer
// the enemy than the front of the spawn block (so a free pick can never gain a turn of approach). The player
//   - picks a unit (roster window, 1-9, or clicking it on the field) and drops it on a blue tile (swap when taken),
//   - inspects any unit (hover / Tab through the foes -> card + its walk field, I -> the full Status window),
//   - rotates / tilts / zooms as in battle (Q E T + -, the camera's keys), then Begins.
// The roster opens on "Begin Battle", so Enter at once keeps the default placement. Every ally faces the nearest
// enemy on entry and again after every drop.
// Driver API: window.__CAMPAIGN__.deploy = { active, begin(), place(unitId, x, z), tiles }.
import { screenToTile } from '../render/camera.js';
import { CLASSES, facingFrom } from '../game/rules.js';
import { strikeZone } from '../game/ai.js';
import { deployTiles, spreadDefault } from './deployzone.js';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const kbd = (k) => `<kbd>${k}</kbd>`;
const chip = (keys, t) => `<span class="g">${[].concat(keys).map(kbd).join('')}${t}</span>`;
const md = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
const key = (t) => `${t.x},${t.z}`;

// R15: the zone and the default layout live in deployzone.js (pure, node-testable).
export { deployTiles } from './deployzone.js';
export function faceFoes(battle, list) {
  const foes = battle.units.filter((o) => o.team !== 'A' && !o.ko && !o.removed);
  for (const u of list) {
    const e = foes.slice().sort((a, b) => md(a, u) - md(b, u))[0]; if (!e) continue;
    const f = facingFrom(u.x, u.z, e.x, e.z); if (f != null) { u.facing = f; const s = battle.spriteOf(u); if (s) s.facing = f; }
  }
}

export function runDeployment(g, { sfx = () => {}, hooks = {} } = {}) {
  const { battle, camera, ui, overlay, player } = g; const map = battle.map;
  const allies = battle.units.filter((u) => u.team === 'A' && !u.removed);
  const foes = battle.units.filter((u) => u.team !== 'A' && !u.removed);
  const tiles = deployTiles(map, battle.units, allies.length); const tileSet = new Set(tiles.map(key));
  const unitAt = (x, z) => battle.units.find((u) => !u.removed && u.x === x && u.z === z) || null;
  let sel = allies.length;           // row index; allies.length == "Begin Battle"
  let held = null; let cur = { x: allies[0]?.x ?? 0, z: allies[0]?.z ?? 0 }; let foeIdx = -1, tileIdx = -1; let done = false;
  let resolveDone; const finished = new Promise((r) => { resolveDone = r; });

  // R15 (review15 P7): open with the company spread over the zone (a tile between neighbours where it has room),
  // not packed shoulder to shoulder on the spawn block.
  for (const m of spreadDefault(allies, tiles, map)) { m.unit.x = m.x; m.unit.z = m.z; }
  // Sprites follow the logical tiles. Re-synced after a beat and again at Begin: a skipped staged intro can still be
  // settling its actors onto the spawn block when the deployment opens.
  const syncSprites = () => { if (held) return; for (const u of allies) { const s = battle.spriteOf(u); if (s) s.root.position.copy(battle.worldPos(u.x, u.z)); } window.__GAME__?.invalidateShadows?.(); };
  syncSprites(); setTimeout(syncSprites, 700); setTimeout(syncSprites, 1600);
  faceFoes(battle, allies);
  // R15 (review15 P2): the roster and the strip must never open on letter placeholders.
  ui.preloadPortraits?.(battle.units)?.then?.(() => { if (!done) { renderPanel(); ui.setTurnOrder(battle.turnOrder()); } });
  // ---- windows ----
  const root = ui.root;
  const panel = document.createElement('div'); panel.id = 'deploy'; panel.className = 'win';
  const tip = document.createElement('div'); tip.id = 'deploy-tip'; tip.className = 'win';
  root.appendChild(panel); root.appendChild(tip);
  const rowHtml = (u, i) => {
    const c = CLASSES[u.cls];
    return `<div class="item${i === sel ? ' sel' : ''}${u === held ? ' held' : ''}" data-i="${i}">${ui.portraitDiv(u, 'pic')}<span class="n">${esc(u.name)}${u.leader ? '<i class="ldr">L</i>' : ''}</span><span class="j">${u === held ? '<b>Placing</b>' : `${esc(c?.name || u.cls)} <em>Lv${u.lvl}</em>`}</span></div>`;
  };
  const renderPanel = () => {
    panel.innerHTML = `<div class="tab">Deployment</div>${allies.map(rowHtml).join('')}<div class="sep"></div>
      <div class="item begin${sel === allies.length ? ' sel' : ''}" data-i="${allies.length}"><span class="n">Begin Battle</span></div>`;
    panel.querySelectorAll('.item').forEach((el) => {
      el.onmouseenter = () => { if (!held) select(+el.dataset.i, false); };
      el.onclick = (e) => { e.stopPropagation(); const i = +el.dataset.i; if (held) { held = null; player.cancel = null; renderPanel(); } select(i, false); confirmRow(); };
    });
  };
  const renderTip = () => {
    const t = held
      ? `Place <b>${esc(held.name)}</b> on a blue tile (a unit there swaps).`
      : sel === allies.length ? 'Deploy your company on the blue tiles, then begin.' : `Pick up <b>${esc(allies[sel].name)}</b>, then choose a blue tile.`;
    const keys = held
      ? [chip(['&larr;', '&uarr;', '&darr;', '&rarr;'], 'Tile'), chip('Tab', 'Next tile'), chip('Enter', 'Place'), chip('Esc', 'Back')]
      : [chip(['&uarr;', '&darr;'], 'Choose'), chip('Enter', sel === allies.length ? 'Begin' : 'Pick up'), chip('Tab', 'Foes'), chip('I', 'Status'), chip(['Q', 'E'], 'Rotate')];
    tip.innerHTML = `<span class="t">${t}</span><span class="keys">${keys.join('')}</span>`;
  };
  // ---- field ----
  const paint = (hover) => {
    overlay.clear(); overlay.show(tiles, 'move');
    overlay.show(foes.filter((u) => !u.ko).map((u) => ({ x: u.x, z: u.z })), 'target');
    const v = hover && unitAt(hover.x, hover.z);
    if (v && v.team !== 'A' && !v.ko) { const zn = strikeZone(battle.engine, v); overlay.showThreat(zn.walk, zn.strike); }
    if (held) overlay.show([{ x: held.x, z: held.z }], 'area');
  };
  // follow: 'soft' keeps a stepped cursor in view; true re-aims on the tile (a jump: Tab, a roster row)
  const setCursor = (x, z, follow = true) => {
    if (!map.at(x, z)) return; cur = { x, z }; player.cursor = { ...cur }; overlay.setCursor(x, z);
    if (follow) camera.lookAt(battle.worldPos(x, z, 0.6), false, follow === 'soft' ? 'soft' : 'travel');
    onHover(cur);
  };
  // The status card names the unit under the cursor (ally or foe). It is also the camera's framing subject
  // (cinematics' anchor follows #unit-card), so inspecting a foe brings the lens to it. While a unit is held the card
  // stays on it and a hovered unit gets the right-hand card instead.
  const onHover = (h) => {
    if (done) return; cur = { x: h.x, z: h.z }; paint(h);
    const v = unitAt(h.x, h.z);
    if (held) { ui.setActive(held); if (v && v !== held) player.showHoverCard(h); else ui.forecast(null); return; }
    ui.forecast(null); if (v) ui.setActive(v);
  };
  const select = (i, follow = true) => {
    i = Math.max(0, Math.min(allies.length, i)); if (i !== sel) sfx('cursor'); sel = i;
    const u = allies[sel]; if (u) { ui.setActive(u); setCursor(u.x, u.z, follow); } else { ui.setActive(null); ui.forecast(null); paint(null); }
    // selection is a class toggle, never a rebuild: rebuilding the row under the mouse would re-fire mouseenter
    panel.querySelectorAll('.item').forEach((el) => el.classList.toggle('sel', +el.dataset.i === sel)); renderTip();
  };
  const place = (u, x, z) => {
    if (!u || !tileSet.has(`${x},${z}`)) return false;
    const other = unitAt(x, z); if (other && other.team !== 'A') return false;
    const from = { x: u.x, z: u.z }; if (other === u) return true;
    const put = (w, t) => {
      w.x = t.x; w.z = t.z; const s = battle.spriteOf(w); if (!s) return;
      const to = battle.worldPos(t.x, t.z); const t0 = performance.now();
      const drop = () => { const k = Math.min(1, (performance.now() - t0) / 150); s.root.position.copy(to); s.root.position.y += 0.45 * (1 - k) * (1 - k); if (k < 1 && !done) requestAnimationFrame(drop); else s.root.position.copy(to); };
      drop();
    };
    put(u, { x, z }); if (other) put(other, from);
    faceFoes(battle, allies); window.__GAME__?.invalidateShadows?.();
    return true;
  };
  const pickUp = (u) => { held = u; sel = allies.indexOf(u); sfx('confirm'); ui.setActive(u); tileIdx = tiles.findIndex((t) => t.x === u.x && t.z === u.z); setCursor(u.x, u.z); renderPanel(); renderTip(); player.cancel = cancelHeld; };
  const drop = (t) => {
    if (!held) return;
    if (!place(held, t.x, t.z)) { sfx('buzz'); return; }
    sfx('confirm'); const u = held; held = null; player.cancel = null; sel = allies.indexOf(u); paint(cur); renderPanel(); renderTip(); ui.setActive(u);
  };
  const cancelHeld = () => { if (!held) return; const u = held; held = null; player.cancel = null; sfx('cancel'); select(allies.indexOf(u)); };
  const confirmRow = () => { if (sel === allies.length) return begin(); pickUp(allies[sel]); };
  // mouse: player.js owns the canvas listeners; while deploying its hover goes to onHover and a click to onClick
  const onClick = (t) => {
    if (done || ui.statusOpen) return;
    if (held) return drop(t);
    const v = unitAt(t.x, t.z);
    if (v && v.team === 'A') pickUp(v); else if (v) { sfx('confirm'); ui.openStatus(v); }
  };
  player.onHover = onHover; player.pick = onClick; player.cancel = null; player.cursor = { ...cur };
  // ---- keys: capture phase, after battlelink's (pause menu) and ui.js's (Status / Keys windows) own handlers ----
  const onKey = (e) => {
    if (done || ui.statusOpen || ui.keysOpen || window.__CAMPAIGN__?.paused) return;
    const k = e.key; const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    const dir = k === 'ArrowUp' || k === 'w' || k === 'W' ? 0 : k === 'ArrowRight' || k === 'd' || k === 'D' ? 1 : k === 'ArrowDown' || k === 's' || k === 'S' ? 2 : k === 'ArrowLeft' || k === 'a' || k === 'A' ? 3 : -1;
    if (dir >= 0) {
      stop();
      if (held) { const [dx, dz] = screenToTile(dir, camera.yawIndex); setCursor(cur.x + dx, cur.z + dz, 'soft'); sfx('cursor'); }
      else if (dir === 0 || dir === 2) select((sel + (dir === 0 ? -1 : 1) + allies.length + 1) % (allies.length + 1));
      return;
    }
    if (k === 'Enter' || k === ' ') { stop(); if (e.repeat) return; if (held) drop(cur); else confirmRow(); return; }
    if (k === 'Escape' || k === 'Backspace' || k === 'x' || k === 'X') { if (held) { stop(); cancelHeld(); } return; }  // Esc with nothing held: the pause menu
    if (k === 'Tab') {
      stop();
      if (held) { tileIdx = (tileIdx + (e.shiftKey ? -1 : 1) + tiles.length) % tiles.length; setCursor(tiles[tileIdx].x, tiles[tileIdx].z); sfx('cursor'); return; }
      const live = foes.filter((u) => !u.ko); if (!live.length) return;
      foeIdx = (foeIdx + (e.shiftKey ? -1 : 1) + live.length) % live.length; const v = live[foeIdx]; setCursor(v.x, v.z); sfx('cursor'); return;
    }
    if (k >= '1' && k <= '9') { const i = +k - 1; if (i < allies.length) { stop(); held = null; select(i); pickUp(allies[i]); } }
  };
  window.addEventListener('keydown', onKey, true);

  function begin() {
    if (done) return; held = null; syncSprites(); done = true; sfx('confirm'); clearInterval(watch);
    window.removeEventListener('keydown', onKey, true);
    panel.classList.remove('show'); tip.classList.remove('show'); setTimeout(() => { panel.remove(); tip.remove(); }, 220);
    if (player.onHover === onHover) player.onHover = null; if (player.pick === onClick) player.pick = null; if (player.cancel === cancelHeld) player.cancel = null;
    player.cursor = null; overlay.clear(); overlay.setCursor(null); ui.forecast(null); ui.setActive(null);
    faceFoes(battle, allies); hooks.onBegin?.();
    resolveDone({ tiles, placed: allies.map((u) => ({ id: u.id, recordId: u.recordId ?? null, x: u.x, z: u.z })) });
  }
  // A driver that hands team A to the AI (controller = null) mid-deployment is not a player: begin at once.
  const watch = setInterval(() => { if (!battle.controller) begin(); }, 250);

  // ---- open: frame both lines, lay out the windows ----
  // Open on the enemy line (the whole of it when the lens allows), then travel to the company after a beat unless
  // the player has already taken the cursor somewhere.
  const centre = (list) => { const p = list.map((u) => battle.worldPos(u.x, u.z, 0.6)); const c = p.reduce((a, v) => a.add(v), p[0].clone().multiplyScalar(0)).multiplyScalar(1 / p.length); return { c, pts: p.map((v) => [v.x, v.y, v.z]) }; };
  const all = centre(battle.units.filter((u) => !u.removed)); const zAll = camera.zoomToContain(all.pts, 0.1);
  if (Number.isFinite(zAll)) camera.setZoom(Math.min(camera.targetZoom, zAll));
  const live = foes.filter((u) => !u.ko);
  if (live.length) { const ec = centre(live).c; const lead = live.slice().sort((a, b) => battle.worldPos(a.x, a.z).distanceTo(ec) - battle.worldPos(b.x, b.z).distanceTo(ec))[0]; ui.setActive(lead); camera.lookAt(ec); } else camera.lookAt(all.c);
  let touched = false; const touch = () => { touched = true; }; window.addEventListener('keydown', touch, { capture: true, once: true });
  setTimeout(() => { window.removeEventListener('keydown', touch, true); if (!done && !touched && allies.length) { ui.setActive(null); camera.lookAt(centre(allies).c); } }, 1900);
  ui.setTurnOrder(battle.turnOrder()); ui.setObjective?.(battle.objectiveText()); ui.showObjective?.(true);
  renderPanel(); renderTip(); paint(null);
  requestAnimationFrame(() => { panel.classList.add('show'); tip.classList.add('show'); });
  const api = { get active() { return !done; }, begin, place: (id, x, z) => place(battle.units.find((u) => u.id === id), x, z), tiles, finished };
  return api;
}
