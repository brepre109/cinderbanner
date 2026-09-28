// Options window: reachable from the title, the world map command window and the in-battle pause menu. Four pages
// (Audio / Gameplay / Display / Controls) in one the genre window: page list on the left with the glove, the page's rows on
// the right, a description plate and key chips underneath. Every change applies live and persists at once
// (src/ui/prefs.js, localStorage 'cinderbanner.options'). Keyboard: up/down choose, left/right change, Enter toggles or
// rebinds, Q/E (or Tab) turn the page, Esc steps back out and closes. Mouse: everything is clickable (right-click a
// key slot clears it), a click outside or the Close plaque closes, so the window never needs a keyboard.
import { h, win, esc, sfx, pushKeys, applyVolumes } from './kit.js';
import * as P from '../ui/prefs.js';

const PAGES = [
  { id: 'audio', label: 'Audio' }, { id: 'gameplay', label: 'Gameplay' }, { id: 'display', label: 'Display' }, { id: 'controls', label: 'Controls' },
];
const onOff = [{ id: true, label: 'On' }, { id: false, label: 'Off' }];
function rowsFor(page) {
  if (page === 'audio') return [
    { id: 'music', label: 'Music', kind: 'vol', desc: 'Volume of the score, on every screen.' },
    { id: 'sfx', label: 'Sound Effects', kind: 'vol', desc: 'Volume of battle sounds and menu blips.' },
    { kind: 'reset', label: 'Restore Audio Defaults', page },
  ];
  if (page === 'gameplay') return [
    { id: 'difficulty', label: 'Difficulty', kind: 'choice', list: P.DIFFICULTIES, desc: 'Story: foes 2 levels lower and less ruthless. Normal: as designed. Hard: foes a level higher and bolder. Applies from the next battle.' },
    { id: 'rewind', label: 'Rewind', kind: 'choice', list: P.REWINDS, desc: 'How many past turns Rewind (R) keeps. Story difficulty: always unlimited.' },
    { id: 'speed', label: 'Battle Speed', kind: 'choice', list: P.SPEEDS, desc: 'How fast units walk, strike and cast. F cycles x1 / x2 / x4 on top of it in battle.' },
    { id: 'text', label: 'Message Speed', kind: 'choice', list: P.TEXT_SPEEDS, desc: 'Story typewriter speed and how long battle messages stay up.' },
    { id: 'endPrompt', label: 'End-Turn Prompt', kind: 'toggle', list: onOff, desc: 'Ask before Wait ends a turn in which the unit could still act.' },
    { id: 'confirm', label: 'Confirm Actions', kind: 'toggle', list: onOff, desc: 'Ask "Execute?" after picking a target, before the ability is used.' },
    { id: 'wrap', label: 'Cursor Wrap', kind: 'toggle', list: onOff, desc: 'Moving past the last row of a menu jumps back to the first.' },
    { id: 'autoRotate', label: 'Camera Auto-Rotate', kind: 'toggle', list: onOff, desc: 'Turn the camera during an ability when the target is hidden behind a roof or cliff.' },
    { kind: 'reset', label: 'Restore Gameplay Defaults', page },
  ];
  if (page === 'display') return [
    { id: 'uiScale', label: 'Interface Scale', kind: 'choice', list: P.UI_SCALES, desc: 'Size of the battle windows and dialogs. Auto: 100%, or 150% on screens 1700x950 and up.' },
    { id: 'textSize', label: 'Text Size', kind: 'choice', list: P.TEXT_SIZES, desc: 'Larger story text, battle guide line, damage numbers and help windows.' },
    { id: 'shake', label: 'Screen Shake', kind: 'pct', desc: 'Camera shake from heavy hits, KOs and big spells. 0% turns it off.' },
    { id: 'flash', label: 'Flash Intensity', kind: 'choice', list: P.FLASHES, desc: 'Screen flashes, flickering spell light and the white hit flash on units. Reduced / Minimal for light sensitivity.' },
    { id: 'palette', label: 'Team Colours', kind: 'choice', list: Object.entries(P.PALETTES).map(([id, p]) => ({ id, label: p.label })), desc: null },
    { kind: 'reset', label: 'Restore Display Defaults', page },
  ];
  const out = [];
  const head = (label) => out.push({ kind: 'head', label });
  head('Menus & Field'); for (const a of P.ACTIONS.filter((x) => x.group === 'nav')) out.push({ kind: 'key', id: a.id, label: a.label });
  head('Menus'); for (const a of P.ACTIONS.filter((x) => x.group === 'menu')) out.push({ kind: 'key', id: a.id, label: a.label });
  head('Battle'); for (const a of P.ACTIONS.filter((x) => x.group === 'battle')) out.push({ kind: 'key', id: a.id, label: a.label });
  out.push({ kind: 'reset', label: 'Restore Default Controls', page });
  return out;
}
const pickable = (r) => r.kind !== 'head';
const kbd = (t) => `<kbd>${esc(t)}</kbd>`;

export function openOptions({ onSpeed, page: startPage } = {}) {
  return new Promise((res) => {
    const ov = h('div', 'k-overlay k-opt-ov'); const w = win('Options', 'k-options'); ov.appendChild(w); (document.getElementById('shell') || document.body).appendChild(ov);
    const body = w.querySelector('.k-body');
    body.innerHTML = `<div class="op-grid"><div class="k-menu op-pages"></div><div class="op-pane"><div class="op-rows"></div><i class="op-more up"></i><i class="op-more dn"></i></div></div>
      <div class="op-desc"><span class="t"></span></div><div class="op-foot"><span class="op-keys"></span><button class="op-close" type="button">Close</button></div>`;
    const pagesEl = body.querySelector('.op-pages'), rowsEl = body.querySelector('.op-rows'), descEl = body.querySelector('.op-desc .t'), keysEl = body.querySelector('.op-keys');
    const moreUp = body.querySelector('.op-more.up'), moreDn = body.querySelector('.op-more.dn');
    let pg = Math.max(0, PAGES.findIndex((p) => p.id === startPage)); let pane = 'pages'; let rows = rowsFor(PAGES[pg].id);
    let sel = rows.findIndex(pickable); let slot = 0; let capture = null; let msg = null; let msgT = 0;
    const o = () => P.prefs();

    const say = (t, bad = false) => { msg = t ? { t, bad } : null; clearTimeout(msgT); if (t) msgT = setTimeout(() => { msg = null; paintDesc(); }, 2600); paintDesc(); };
    const paintDesc = () => {
      const r = rows[sel]; let t = '';
      if (capture) t = `Press a key for ${P.ACTION[capture.id].label} (slot ${capture.slot + 1}).  Esc cancels, Delete clears.`;
      else if (msg) t = msg.t;
      else if (pane === 'pages') t = { audio: 'Music and sound volume.', gameplay: 'Speeds, prompts and camera behaviour.', display: 'Interface size, text, motion, flashes and colour-blind team colours.', controls: 'Rebind every battle and menu key. A key already in use is swapped over.' }[PAGES[pg].id];
      else if (r?.kind === 'palette' || r?.id === 'palette') t = P.palette().desc;
      else if (r?.kind === 'key') t = `${P.ACTION[r.id].label}: Enter rebinds the highlighted slot, Delete or right-click clears it.`;
      else if (r?.kind === 'reset') t = 'Put every option on this page back the way the game ships.';
      else t = r?.desc || '';
      descEl.textContent = t; descEl.parentElement.classList.toggle('bad', !!(msg?.bad && !capture)); descEl.parentElement.classList.toggle('cap', !!capture);
      const L = (id) => kbd(P.keyLabel(id));
      keysEl.innerHTML = capture ? `${kbd('Esc')}Cancel` : pane === 'pages'
        ? `${L('up')}${L('down')}Page ${L('ok')}Open ${L('back')}Close`
        : `${L('up')}${L('down')}Choose ${L('left')}${L('right')}Change ${L('prev')}${L('next')}Page ${L('back')}Back`;
    };
    const paintPages = () => {
      pagesEl.innerHTML = PAGES.map((p, i) => `<div class="k-item${i === pg ? ' cur' : ''}${i === pg && pane === 'pages' ? ' sel' : ''}" data-i="${i}"><span class="l">${esc(p.label)}</span></div>`).join('');
      pagesEl.querySelectorAll('.k-item').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const i = +el.dataset.i; if (capture) endCapture(); if (i !== pg) { setPage(i); sfx('cursor'); } pane = 'pages'; paint(); }));
    };
    const value = (r, i) => {
      const cur = o()[r.id];
      if (r.kind === 'vol') return `<span class="k-vol op-pips">${Array.from({ length: 10 }, (_, j) => `<i class="${j < cur ? 'on' : ''}" data-v="${j + 1}"></i>`).join('')}</span><b class="k-num">${cur}</b>`;
      if (r.kind === 'pct') return `<span class="k-vol op-pips">${Array.from({ length: 10 }, (_, j) => `<i class="${j < cur / 10 ? 'on' : ''}" data-v="${(j + 1) * 10}"></i>`).join('')}</span><b class="k-num op-pct">${cur}%</b>`;
      if (r.kind === 'choice') { const it = r.list.find((x) => String(x.id) === String(cur)) || r.list[0]; const k = r.list.indexOf(it);
        return `<span class="k-arrows${k > 0 ? '' : ' off'}" data-d="-1">&#9664;</span><b class="op-ch">${esc(it.label)}</b><span class="k-arrows${k < r.list.length - 1 ? '' : ' off'}" data-d="1">&#9654;</span>`; }
      if (r.kind === 'toggle') return r.list.map((x) => `<span class="op-tg${cur === x.id ? ' on' : ''}" data-t="${x.id}">${x.label}</span>`).join('');
      if (r.kind === 'key') return P.keysFor(r.id).map((t, j) => `<span class="op-key${i === sel && pane === 'rows' && j === slot ? ' at' : ''}${capture && capture.id === r.id && capture.slot === j ? ' cap' : ''}${t ? '' : ' none'}" data-s="${j}">${t ? esc(P.tokenLabel(t)) : '&mdash;'}</span>`).join('');
      return '';
    };
    const paintRows = () => {
      const st = rowsEl.scrollTop;
      rowsEl.className = `op-rows k-menu small p-${PAGES[pg].id}`;
      rowsEl.innerHTML = rows.map((r, i) => r.kind === 'head' ? `<div class="op-head">${esc(r.label)}</div>`
        : `<div class="k-item op-r ${r.kind}${i === sel && pane === 'rows' ? ' sel' : ''}${r.kind === 'key' && !P.isDefaultBinding(r.id) ? ' changed' : ''}" data-i="${i}"><span class="l">${esc(r.label)}</span><span class="v">${value(r, i)}</span></div>`).join('')
        + (PAGES[pg].id === 'display' ? swatches() : '');
      rowsEl.scrollTop = st;
      rowsEl.querySelectorAll('.op-r').forEach((el) => {
        const i = +el.dataset.i; const r = rows[i];
        el.addEventListener('mouseenter', () => { if (capture) return; if (sel !== i || pane !== 'rows') { sel = i; pane = 'rows'; sfx('cursor'); paint(); } });
        el.addEventListener('click', (e) => {
          e.stopPropagation(); if (capture && !(r.kind === 'key' && e.target.closest('.op-key'))) { endCapture(); paint(); return; }
          sel = i; pane = 'rows';
          const pip = e.target.closest('.op-pips i'); if (pip) { const v = +pip.dataset.v; const now = o()[r.id]; set({ [r.id]: r.kind === 'vol' && v === now ? 0 : r.kind === 'pct' && v === now ? 0 : v }); sfx('cursor'); return; }
          const ar = e.target.closest('.k-arrows'); if (ar) { adjust(+ar.dataset.d); return; }
          const tg = e.target.closest('.op-tg'); if (tg) { const v = tg.dataset.t === 'true'; if (o()[r.id] !== v) { set({ [r.id]: v }); sfx('cursor'); } return; }
          const ks = e.target.closest('.op-key'); if (ks) { slot = +ks.dataset.s; startCapture(r.id, slot); return; }
          if (r.kind === 'choice') { const rect = el.getBoundingClientRect(); adjust(e.clientX > rect.left + rect.width * 0.7 ? 1 : -1); return; }
          activate();
        });
        el.addEventListener('contextmenu', (e) => { const ks = e.target.closest('.op-key'); if (!ks || r.kind !== 'key') return; e.preventDefault(); e.stopPropagation(); sel = i; pane = 'rows'; slot = +ks.dataset.s; if (capture) endCapture(); clear(); });
      });
      const s = rowsEl.querySelector('.op-r.sel'); if (s) { const top = s.offsetTop, bot = top + s.offsetHeight; if (top < rowsEl.scrollTop + 4) rowsEl.scrollTop = top - 30; else if (bot > rowsEl.scrollTop + rowsEl.clientHeight - 4) rowsEl.scrollTop = bot - rowsEl.clientHeight + 8; }
      paintMore();
    };
    const paintMore = () => { moreUp.classList.toggle('on', rowsEl.scrollTop > 2); moreDn.classList.toggle('on', rowsEl.scrollTop + rowsEl.clientHeight < rowsEl.scrollHeight - 2); };
    rowsEl.addEventListener('scroll', paintMore);
    rowsEl.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });
    const swatches = () => {
      const c = P.palette().css;
      const sw = (col, lab, cls = '') => `<span class="op-sw ${cls}"><i style="background:${col}"></i>${lab}</span>`;
      return `<div class="op-swatch"><div class="op-sw-row"><b>Units</b>${sw(c.a, 'Ally', 'team')}${sw(c.b, 'Enemy', 'team')}</div>
        <div class="op-sw-row"><b>Tiles</b>${sw(c.mv, 'Move')}${sw(c.tg, 'Target')}${sw('#' + P.palette().fields.area[0].toString(16).padStart(6, '0'), 'Area')}${sw(c.th, 'Threat')}${sw(c.st, 'Reach')}</div></div>`;
    };
    const paint = () => { paintPages(); paintRows(); paintDesc(); };
    const setPage = (i) => { pg = (i + PAGES.length) % PAGES.length; rows = rowsFor(PAGES[pg].id); sel = rows.findIndex(pickable); slot = 0; rowsEl.scrollTop = 0; msg = null; };
    const set = (patch) => { P.setPrefs(patch); if ('music' in patch || 'sfx' in patch) applyVolumes(P.prefs()); onSpeed?.(P.prefs()); paint(); };
    const adjust = (d) => {
      const r = rows[sel]; if (!r) return; const cur = o()[r.id];
      if (r.kind === 'vol') { const v = Math.max(0, Math.min(10, cur + d)); if (v === cur) return; set({ [r.id]: v }); }
      else if (r.kind === 'pct') { const v = Math.max(0, Math.min(100, cur + d * 10)); if (v === cur) return; set({ [r.id]: v }); }
      else if (r.kind === 'choice') { const k = r.list.findIndex((x) => String(x.id) === String(cur)); const n = Math.max(0, Math.min(r.list.length - 1, k + d)); if (n === k) { sfx('buzz'); return; } set({ [r.id]: r.list[n].id }); }
      else if (r.kind === 'toggle') { set({ [r.id]: !cur }); }
      else if (r.kind === 'key') { const n = Math.max(0, Math.min(P.SLOTS - 1, slot + d)); if (n === slot) return; slot = n; paint(); }
      else return;
      sfx('cursor');
    };
    const activate = () => {
      const r = rows[sel]; if (!r) return;
      if (r.kind === 'reset') { P.resetPrefs(r.page); applyVolumes(P.prefs()); onSpeed?.(P.prefs()); sfx('confirm'); say('Defaults restored.'); paint(); return; }
      if (r.kind === 'key') { startCapture(r.id, slot); return; }
      if (r.kind === 'toggle') { adjust(1); return; }
      if (r.kind === 'choice') { const k = r.list.findIndex((x) => String(x.id) === String(o()[r.id])); set({ [r.id]: r.list[(k + 1) % r.list.length].id }); sfx('cursor'); return; }
      if (r.kind === 'vol' || r.kind === 'pct') adjust(1);
    };
    const startCapture = (id, s) => { capture = { id, slot: s }; P.setCapturing(true); sfx('confirm'); paint(); };
    const endCapture = () => { capture = null; P.setCapturing(false); };
    const clear = () => { const r = rows[sel]; if (r?.kind !== 'key') return; const x = P.clearKey(r.id, slot); if (x.msg) say(x.msg, !x.ok); sfx(x.ok ? 'cancel' : 'buzz'); paint(); };
    const move = (d) => {
      const n = rows.length; let i = sel;
      for (let step = 0; step < n; step++) { i += d; if (i < 0 || i >= n) { if (!P.prefs().wrap) return; i = (i + n) % n; } if (pickable(rows[i])) break; }
      if (i === sel) return; sel = i; sfx('cursor'); paint();
    };
    const close = () => { if (capture) endCapture(); clearTimeout(msgT); off(); ov.remove(); sfx('cancel'); res(P.prefs()); };
    const onKey = (k, e) => {
      if (capture) {
        const key = e?.key; if (!key) return true;
        if (key === 'Escape') { endCapture(); sfx('cancel'); paint(); return true; }
        if (key === 'Delete') { endCapture(); clear(); return true; }
        const tok = P.keyToken(e); const { id, slot: s } = capture; endCapture();
        const x = P.bindKey(id, s, tok); sfx(x.ok ? 'confirm' : 'buzz'); if (x.msg) say(x.msg, !x.ok); paint(); return true;
      }
      if (!k) { if (e?.key === 'Delete' && pane === 'rows' && rows[sel]?.kind === 'key') { clear(); return true; } return false; }
      if (k === 'prev' || k === 'next') { setPage(pg + (k === 'next' ? 1 : -1)); sfx('page'); paint(); return true; }
      if (pane === 'pages') {
        if (k === 'up' || k === 'down') { const d = k === 'up' ? -1 : 1; const n = pg + d; if ((n < 0 || n >= PAGES.length) && !P.prefs().wrap) return true; setPage(n); sfx('cursor'); paint(); }
        else if (k === 'ok' || k === 'right') { pane = 'rows'; sfx('confirm'); paint(); }
        else if (k === 'back') close();
        return true;
      }
      if (k === 'up') move(-1); else if (k === 'down') move(1);
      else if (k === 'left') { if (rows[sel]?.kind === 'key' && slot === 0) { pane = 'pages'; sfx('cancel'); paint(); } else adjust(-1); }
      else if (k === 'right') adjust(1);
      else if (k === 'ok') activate();
      else if (k === 'back') { pane = 'pages'; sfx('cancel'); paint(); }
      return true;
    };
    onKey.raw = true;   // capture needs every key (kit.handleKey passes unmapped keys to raw handlers)
    const off = pushKeys(onKey);
    body.querySelector('.op-close').addEventListener('click', (e) => { e.stopPropagation(); close(); });
    w.addEventListener('click', (e) => { if (capture && !e.target.closest('.op-key')) { endCapture(); paint(); } });
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    ov.addEventListener('contextmenu', (e) => { if (e.target === ov) { e.preventDefault(); close(); } });
    paint();
  });
}
