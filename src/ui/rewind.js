// REWIND window (classic tactics Reborn's Chariot Tarot / Triangle Strategy): the list of the player's recent turn starts,
// newest first, each with its turn number, who acts and how both sides stood; a preview of the chosen moment (a frame
// captured when that turn opened, a minimap of where everyone stood, every unit's HP, and what has happened since).
// Enter rewinds, Esc backs out. The battle does the restoring (src/game/battle.js requestRewind / rewindNow); this
// module only picks the snapshot, captures the thumbnails and plays the rewind flourish. Campaign battle pages wire it
// from src/campaign/battlelink.js (it uses the campaign kit's windows and key stack).
import './rewind.css';
import { h, esc, win, menu, sfx, pushKeys, portrait } from '../campaign/kit.js';
import { keyLabel, keyToken, boundKeys } from './prefs.js';

const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0);
const strength = (list) => { const m = list.reduce((t, u) => t + u.maxHp, 0); return pct(list.reduce((t, u) => t + (u.ko ? 0 : u.hp), 0), m); };

/** Capture a small frame of the field when each recorded player turn opens (once its command menu is up). */
export function installRewindThumbs(g) {
  const { battle, ui } = g;
  // R18 (review17 #11): each recorded turn also learns what was DONE with it (the window's rows name the action:
  // 'Oathfire -> Brigand -64'). Written onto the snapshot object as the turn plays; reactions and later turns never count.
  let cur = null; const mine = (u) => cur && u && u.id === cur.unitId && !cur.ended;
  const at = (t) => (t && Number.isFinite(t.x) ? battle.units.find((v) => v.x === t.x && v.z === t.z && !v.removed) : null);
  battle.on('snapshot', ({ snapshot: s }) => { cur = s; });
  battle.on('moveEnd', ({ unit }) => { if (mine(unit)) cur.moved = true; });
  battle.on('abilityStart', (e) => { if (!mine(e.unit) || e.reaction || cur.act) return; const v = at(e.target); cur.act = { ab: e.ability?.name || 'Act', tgt: v ? (v === e.unit ? 'self' : v.name) : '' }; });
  battle.on('charge', (e) => { if (!mine(e.unit) || cur.act) return; const v = at(e.target); cur.act = { ab: e.ability?.name || 'Spell', tgt: v ? (v === e.unit ? 'self' : v.name) : '', charge: true }; });
  battle.on('damage', (e) => { if (!mine(e.unit) || !cur.act) return; cur.act.dmg = (cur.act.dmg || 0) + (e.amount || 0); if (!cur.act.tgt && e.victim) cur.act.tgt = e.victim.name; });
  battle.on('heal', (e) => { if (!mine(e.unit) || !cur.act) return; cur.act.heal = (cur.act.heal || 0) + (e.amount || 0); });
  battle.on('turnEnd', ({ unit }) => { if (mine(unit)) cur.ended = true; });
  const gl = g.renderer?.domElement || g.canvas || window.__GAME__?.renderer?.domElement; if (!gl) return;
  battle.on('snapshot', ({ snapshot: s }) => {
    let tries = 0;
    const poll = () => {
      if (!battle.history.includes(s) || s.thumb) return;
      if (battle.active?.id !== s.unitId || (!ui.menuItems && tries < 5)) { if (++tries < 60) setTimeout(poll, 100); return; }
      setTimeout(() => requestAnimationFrame(() => {   // queued after the frame loop's own callback: the drawing buffer is fresh
        try {
          const W = 480, H = Math.round(W * gl.height / Math.max(1, gl.width)); const c = document.createElement('canvas'); c.width = W; c.height = H;
          // draw a frame now, in this same task, so the drawing buffer is certainly the field's (no preserveDrawingBuffer)
          try { window.__GAME__?.render?.(); } catch (e) { /* capture hook optional */ }
          const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(gl, 0, 0, W, H);
          const d = x.getImageData(W >> 1, H >> 1, 8, 8).data; let lit = 0; for (let i = 0; i < d.length; i += 4) lit += d[i] + d[i + 1] + d[i + 2] + d[i + 3];
          if (lit > 0) s.thumb = c.toDataURL('image/jpeg', 0.72);
        } catch (e) { /* no readback (lost context, tainted): the minimap stands in */ }
      }), ui.menuItems ? 450 : 60);
    };
    setTimeout(poll, 300);
  });
}

// Minimap of the field as the camera sees it (projected at the current yaw), units as team dots, the actor ringed.
function drawMap(cv, map, s, yaw = 0) {
  const W = cv.width, H = cv.height, x = cv.getContext('2d'); x.clearRect(0, 0, W, H);
  if (!map?.at) return;
  const w = map.w || 16, d = map.d || 16; const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const pr = (px, pz, hh) => { const cx = px - w / 2, cz = pz - d / 2; return [cx * cs - cz * sn, (cx * sn + cz * cs) * 0.5 - hh * 0.14]; };
  let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
  for (const [px, pz] of [[0, 0], [w, 0], [0, d], [w, d]]) { const [a, b] = pr(px, pz, 0); mnx = Math.min(mnx, a); mxx = Math.max(mxx, a); mny = Math.min(mny, b - 2.2); mxy = Math.max(mxy, b); }
  const k = Math.min((W - 12) / (mxx - mnx), (H - 12) / (mxy - mny)); const ox = W / 2 - ((mnx + mxx) / 2) * k, oy = H / 2 - ((mny + mxy) / 2) * k;
  const P = (px, pz, hh) => { const [a, b] = pr(px, pz, hh); return [ox + a * k, oy + b * k]; };
  const tiles = []; for (let z = 0; z < d; z++) for (let xx = 0; xx < w; xx++) { const t = map.at(xx, z); if (t && !t.void) tiles.push({ t, x: xx, z, depth: (xx + 0.5 - w / 2) * sn + (z + 0.5 - d / 2) * cs }); }
  tiles.sort((a, b) => a.depth - b.depth);
  const hs = tiles.map((o) => o.t.h || 0); const hmin = Math.min(...hs), hmax = Math.max(...hs, hmin + 1);
  for (const { t, x: tx, z: tz } of tiles) {
    const hh = t.h || 0; const f = (hh - hmin) / (hmax - hmin);
    const col = t.water ? `rgb(${60 + f * 20},${110 + f * 30},${150 + f * 30})` : !t.walk ? `rgb(${96 + f * 50},${90 + f * 46},${80 + f * 40})` : `rgb(${92 + f * 70},${118 + f * 60},${62 + f * 40})`;
    const c = [P(tx, tz, hh), P(tx + 1, tz, hh), P(tx + 1, tz + 1, hh), P(tx, tz + 1, hh)];
    x.beginPath(); x.moveTo(...c[0]); for (let i = 1; i < 4; i++) x.lineTo(...c[i]); x.closePath(); x.fillStyle = col; x.fill(); x.strokeStyle = 'rgba(20,16,10,.28)'; x.lineWidth = 1; x.stroke();
  }
  const css = getComputedStyle(document.documentElement); const tc = { A: css.getPropertyValue('--team-a').trim() || '#3d7be0', B: css.getPropertyValue('--team-b').trim() || '#d0412e' };
  const all = [...s.sides.A, ...s.sides.B].map((u) => ({ ...u, team: s.sides.A.includes(u) ? 'A' : 'B' }));
  all.sort((a, b) => ((a.x - w / 2) * sn + (a.z - d / 2) * cs) - ((b.x - w / 2) * sn + (b.z - d / 2) * cs));
  for (const u of all) {
    const t = map.at(u.x, u.z); const [px, py] = P(u.x + 0.5, u.z + 0.5, t?.h || 0); const r = Math.max(3, k * 0.36);
    if (u.id === s.unitId) { x.beginPath(); x.arc(px, py - r * 0.6, r + 4, 0, Math.PI * 2); x.strokeStyle = '#ffe08a'; x.lineWidth = 2; x.stroke(); }
    x.beginPath(); x.arc(px, py - r * 0.6, r, 0, Math.PI * 2); x.fillStyle = u.ko ? '#555' : tc[u.team]; x.fill(); x.lineWidth = 1.5; x.strokeStyle = '#10120f'; x.stroke();
    if (u.ko) { x.strokeStyle = '#eee'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(px - r * 0.6, py - r * 1.2); x.lineTo(px + r * 0.6, py); x.moveTo(px + r * 0.6, py - r * 1.2); x.lineTo(px - r * 0.6, py); x.stroke(); }
  }
}

// What has happened since snapshot s, against the live units: falls, raises, big HP swings (the three that matter most).
function sinceThen(s, units) {
  const now = new Map(units.map((u) => [u.id, u])); const out = [];
  for (const t of ['A', 'B']) for (const o of s.sides[t]) {
    const u = now.get(o.id); if (!u) continue; const ko = !!(u.ko || u.removed);
    if (ko && !o.ko) out.push({ w: 1000, html: `<span class="${t === 'A' ? 'bad' : 'good'}">${esc(o.name)} fell</span>` });
    else if (!ko && o.ko) out.push({ w: 900, html: `<span class="${t === 'A' ? 'good' : 'bad'}">${esc(o.name)} rose</span>` });
    else if (!ko) { const dh = u.hp - o.hp; if (Math.abs(dh) >= Math.max(8, o.maxHp * 0.1)) out.push({ w: Math.abs(dh) / o.maxHp * 100, html: `<span class="${(dh < 0) === (t === 'A') ? 'bad' : 'good'}">${esc(o.name)} ${dh > 0 ? '+' : ''}${dh} HP</span>` }); }
  }
  for (const u of units) if (!s.sides.A.some((o) => o.id === u.id) && !s.sides.B.some((o) => o.id === u.id) && !u.removed) out.push({ w: 800, html: `<span class="bad">${esc(u.name)} joined the foe</span>` });
  return out.sort((a, b) => b.w - a.w).slice(0, 3).map((o) => o.html);
}

/** What the turn in snapshot s did, as one short line ('Oathfire → Brigand −64', 'Moved, waited', 'This turn'). */
export function actionLine(s, live = false) {
  const a = s.act;
  if (a) return `${a.ab}${a.charge ? ' (charge)' : ''}${a.tgt ? ` → ${a.tgt}` : ''}${a.dmg ? ` −${a.dmg}` : a.heal ? ` +${a.heal}` : ''}`;
  if (live || !s.ended) return 'This turn';
  return s.moved ? 'Moved, waited' : 'Waited';
}

/**
 * Open the Rewind window. Resolves with the chosen snapshot, or null on Esc / Back.
 * opts: { battle, camera, title, note } -- note: a line under the list (defeat: "the line broke on turn N").
 */
export function openRewind({ battle, camera = null, title = 'Rewind', note = '' }) {
  return new Promise((res) => {
    const list = battle.rewindTargets(); const cur = battle.engine.turn;
    const ov = h('div', 'k-overlay rw-overlay'); const w = win(title, 'rw-win'); ov.appendChild(w); document.body.appendChild(ov);
    const lim = battle.rewindLimit; const kept = Number.isFinite(lim) ? `${list.length} of the last ${lim} turns` : `${list.length} turns · unlimited`;
    w.querySelector('.k-body').innerHTML = `<div class="rw-cols"><div class="rw-left"><div class="rw-list"></div><div class="rw-kept k-small k-dim">${esc(kept)}${note ? ` &middot; ${esc(note)}` : ''}</div></div>
      <div class="rw-right"><div class="rw-shot"><canvas class="rw-map" width="576" height="324"></canvas><img class="rw-thumb" alt=""><div class="rw-cap"></div><canvas class="rw-inset" width="150" height="96"></canvas></div>
        <div class="rw-sides"><div class="rw-side A"><div class="rw-sh k-small">Allies</div><div class="rw-units"></div></div><div class="rw-side B"><div class="rw-sh k-small">Foes</div><div class="rw-units"></div></div></div>
        <div class="rw-since k-small"></div></div></div>
      <div class="rw-hint k-small"><kbd>&uarr;</kbd><kbd>&darr;</kbd>Turn<kbd>${esc(keyLabel('rewind'))}</kbd>Hold: play back<kbd>Enter</kbd>Rewind<kbd>${esc(keyLabel('back'))}</kbd>Back</div>`;
    const scrubCap = h('div', 'rw-scrubcap'); ov.appendChild(scrubCap);
    const body = w.querySelector('.k-body'); const mapCv = body.querySelector('.rw-map'), inset = body.querySelector('.rw-inset'), img = body.querySelector('.rw-thumb'), cap = body.querySelector('.rw-cap');
    const yaw = camera?.yawNow ?? 0;
    const sideHtml = (l, s) => l.map((u) => `<div class="rw-u${u.ko ? ' ko' : ''}${u.id === s.unitId ? ' act' : ''}"><span class="n">${esc(u.name)}</span><span class="rw-bar"><i style="width:${u.ko ? 0 : pct(u.hp, u.maxHp)}%"></i></span><span class="v">${u.ko ? 'KO' : u.hp}</span></div>`).join('');
    const preview = (s) => {
      if (!s) return;
      if (s.thumb) { img.src = s.thumb; img.style.display = ''; mapCv.style.display = 'none'; inset.style.display = ''; drawMap(inset, battle.map, s, yaw); }
      else { img.style.display = 'none'; img.removeAttribute('src'); mapCv.style.display = ''; inset.style.display = 'none'; drawMap(mapCv, battle.map, s, yaw); }
      const ago = cur - s.turn + 1;
      cap.innerHTML = `<span class="w"><b>Turn ${s.turn}</b> &middot; ${esc(s.name)} &middot; ${esc(actionLine(s, s === list[0]))}</span><span class="ago">${ago <= 1 ? 'this turn' : `${ago - 1} turn${ago > 2 ? 's' : ''} ago`} &middot; Round&nbsp;${s.round || 1}</span>`;
      body.querySelector('.rw-side.A .rw-units').innerHTML = sideHtml(s.sides.A, s); body.querySelector('.rw-side.B .rw-units').innerHTML = sideHtml(s.sides.B, s);
      const since = sinceThen(s, battle.units); body.querySelector('.rw-since').innerHTML = since.length ? `<span class="k-dim">Undone:</span> ${since.join(' &middot; ')}` : '<span class="k-dim">Nothing decisive has happened since.</span>';
    };
    const items = list.map((s, i) => ({ id: i, s, cls: 'rw-row', html: `<span class="rw-pic" data-sp="${esc(s.sprite || '')}"></span><span class="rw-t"><span class="rw-l1"><b>T${s.turn}</b> ${esc(s.name)}</span><span class="rw-who">${esc(actionLine(s, i === 0))}</span></span>`,
      right: `<span class="rw-str"><span class="rw-mini A"><i style="width:${strength(s.sides.A)}%"></i></span><span class="rw-mini B"><i style="width:${strength(s.sides.B)}%"></i></span></span>` }));
    let m = null;
    // ---- R18 wow #3 (Chariot scrub): HOLD the rewind key and the field plays backwards -- every unit glides to where it
    // stood at each older recorded turn start, one turn at a time, the list following along; release to look at the
    // moment reached, Enter to go back to it. Sprites only (the rules state is untouched); put back on close.
    const B = battle; const spr = (id) => { const u = B.units.find((v) => v.id === id); return u ? { u, s: B.spriteOf?.(u) } : null; };
    let scrub = null, tween = 0; const moved = new Set();
    const poseAt = (snap, ms) => {
      cancelAnimationFrame(tween); const jobs = [];
      for (const o of [...snap.sides.A, ...snap.sides.B]) { const r = spr(o.id); if (!r?.s?.root || r.u.removed) continue; const to = B.worldPos(o.x, o.z); jobs.push({ r: r.s.root, from: r.s.root.position.clone(), to }); moved.add(o.id); }
      const t0 = performance.now(); const tick = () => { const k = Math.min(1, (performance.now() - t0) / ms); const e = k * k * (3 - 2 * k); for (const j of jobs) j.r.position.lerpVectors(j.from, j.to, e); if (k < 1) tween = requestAnimationFrame(tick); };
      tick();
    };
    const putBack = () => { cancelAnimationFrame(tween); for (const id of moved) { const r = spr(id); if (r?.s?.root && !r.u.removed) r.s.root.position.copy(B.worldPos(r.u.x, r.u.z)); } moved.clear(); };
    const scrubLabel = (s2) => { scrubCap.innerHTML = `<span class="rw-ff">&#9664;&#9664;</span><b>Turn ${s2.turn}</b> ${esc(s2.name)} &middot; ${esc(actionLine(s2, s2 === list[0]))}`; };
    const stepScrub = () => { if (!scrub) return; const i = Math.min(items.length - 1, m.sel + (scrub.first ? 0 : 1)); scrub.first = false; if (i !== m.sel) { m.set(i); sfx('cursor'); } poseAt(list[i], 330); scrubLabel(list[i]); if (i >= items.length - 1) ov.classList.add('scrub-end'); };
    const startScrub = () => { if (scrub || !items.length) return; scrub = { first: true }; ov.classList.add('scrub'); sfx('page'); stepScrub(); scrub.t = setInterval(stepScrub, 380); };
    const stopScrub = () => { if (!scrub) return; clearInterval(scrub.t); scrub = null; ov.classList.remove('scrub', 'scrub-end'); };
    const isRw = (e) => { const t = keyToken(e); return !!t && boundKeys('rewind').includes(t); };
    const onUp = (e) => { if (isRw(e)) stopScrub(); };
    addEventListener('keyup', onUp, true); addEventListener('blur', stopScrub);
    const done = (v) => { stopScrub(); removeEventListener('keyup', onUp, true); removeEventListener('blur', stopScrub); if (!v) putBack(); else cancelAnimationFrame(tween); off(); m?.destroy(); ov.classList.add('out'); setTimeout(() => ov.remove(), 160); res(v); };
    m = menu(body.querySelector('.rw-list'), items, { keys: false, cls: 'small rw-menu', onMove: (it) => preview(it.s), onPick: (it) => done(it.s) });
    body.querySelectorAll('.rw-pic').forEach((e) => { const sp = e.dataset.sp; if (sp) portrait(sp).then((u) => { if (u) e.style.backgroundImage = `url(${u})`; }); });
    const keyFn = (k, e) => { if (e && isRw(e)) { if (!e.repeat) startScrub(); return; } if (!k) return false; if (scrub) return; if (k === 'up') m.move(-1); else if (k === 'down') m.move(1); else if (k === 'ok') m.pick(); else if (k === 'back') { sfx('cancel'); done(null); } else if (k === 'prev') m.set(0); else if (k === 'next') m.set(items.length - 1); else return false; };
    keyFn.raw = true; const off = pushKeys(keyFn);
    ov.addEventListener('click', (e) => { if (e.target === ov) { sfx('cancel'); done(null); } });
    if (!items.length) { body.querySelector('.rw-list').innerHTML = '<div class="k-small k-dim rw-empty">No turn to return to yet.</div>'; }
    window.__REWIND__ = { get open() { return ov.isConnected; }, get sel() { return m?.sel; }, list, pick: (i) => { m?.set(i); m?.pick(); }, close: () => done(null), scrub: startScrub, unscrub: stopScrub, get scrubbing() { return !!scrub; } };
  });
}

/** The flourish while the field is put back: a sepia sweep turning backwards and the turn it lands on. */
export function rewindFx(s, ms = 900) {
  const fx = h('div', 'rw-fx', `<div class="rw-dial"></div><div class="rw-fxt"><small>Rewind</small>Turn ${s.turn}<span>${esc(s.name)}</span></div>`);
  document.body.appendChild(fx); sfx('page');
  setTimeout(() => fx.classList.add('out'), ms - 260); setTimeout(() => fx.remove(), ms + 80);
  return new Promise((r) => setTimeout(r, Math.round(ms * 0.45)));
}
