// Small DOM kit for the campaign screens: classic-style windows and menus with the glove cursor, a keyboard focus stack,
// fades, portraits cropped from the unit sheets, and the audio hooks (audio module if it exports them, a tiny
// built-in blip synth otherwise). No three.js here, so the shell loads in a fraction of the battle's time.
import { portraitUrl } from '../units/portraits.js';
import { loadOptions } from './save.js';
import { prefs, actionOf, keyToken, setMenuFocus, installHintRelabel } from '../ui/prefs.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function h(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

export function pixelSvg(rows, palette) {
  const w = rows[0].length, hh = rows.length; let rects = '';
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) { const c = palette[r[x]]; if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`; } });
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${hh}' width='${w}' height='${hh}' shape-rendering='crispEdges'>${rects}</svg>`)}")`;
}
// Same glove as the battle HUD (src/ui/ui.js), so the pointer is one object across the whole game.
export const HAND = pixelSvg([
  '......######...........', '.....#wwwwww#..........', '....#wwwwwwww#.........', '...#wwwwwwwwww#####....', '..#wwwwwwwwwwwwwwww###.',
  '..#wwwwwwwwwwwwwwwwwwww', '.#wwwwwwwwwwwwwwwwwwwww', '.#wwwwwwwwwwwwwwwwwwwwg', '.#wwwwwwwwwwwww#######.', '.#wwwwwwwwwww#.........',
  '.#wwwwwwwww##..........', '..#wwwwwwww#...........', '..#wwwwwww#............', '...#wwwww#.............', '....#gggg#.............',
  '....#ggg##.............', '.....###...............',
], { '#': '#2a2118', w: '#f7f3ea', g: '#7f93c4' });
document.documentElement.style.setProperty('--k-hand', HAND);

// ---------------------------------------------------------------- focus stack (keyboard routing)
const stack = [];
export function pushKeys(fn) { stack.push(fn); return () => { const i = stack.lastIndexOf(fn); if (i >= 0) stack.splice(i, 1); }; }
export function clearKeys() { stack.length = 0; }
let keysBlocked = false; export const blockKeys = (v) => { keysBlocked = v; };
export function handleKey(e) {
  if (keysBlocked || !stack.length) return false;
  const top = stack[stack.length - 1];
  // a handler flagged .raw (Options' "press a key" capture) sees every key, mapped or not
  const k = normKey(e); if (!k && !top.raw) return false;
  if (top(k, e) !== false) { e.preventDefault(); return true; } return false;
}
window.addEventListener('keydown', handleKey);
export const hasKeyFocus = () => stack.length > 0;
setMenuFocus(hasKeyFocus);   // the battle page's key translator (src/ui/prefs.js) leaves keys alone while a window is up
// Chips naming a key in other modules' hints follow the player's bindings (no-op with default bindings).
installHintRelabel([...new URLSearchParams(location.search).keys()].every((k) => k === 'screen') ? 'shell' : 'battle');
/** Same page, new query: works under dev (/), a built dist (/index.html) and any sub-path. */
export const pageUrl = (qs) => location.pathname + qs;
// Menu keys follow the player's bindings (src/ui/prefs.js ACTIONS, groups nav + menu). Tab / Shift+Tab always page.
// A key re-dispatched by the battle page's translator is read by the key actually pressed (__cbOrig).
export function normKey(e) {
  const tok = e.__cbOrig || keyToken(e); if (!tok) return null;
  if (tok === 'Tab') return e.shiftKey ? 'prev' : 'next';
  return actionOf(tok, ['nav', 'menu']);
}

// ---------------------------------------------------------------- windows & menus
export function win(title, cls = '', inner = '') {
  const w = h('div', `k-win ${cls}${title ? ' k-titled' : ''}`);
  w.innerHTML = `${title ? `<div class="k-tab">${esc(title)}</div>` : ''}<div class="k-body">${inner}</div>`;
  return w;
}
/**
 * Vertical command list. items: [{id, label, right?, enabled?, hint?}]. Keys: up/down (wrap), ok, back.
 * Mouse: hover selects, click picks. Returns a controller {el, sel, set(i), destroy(), items}.
 */
export function menu(host, items, { onPick, onBack, onMove, sel = 0, cls = '', keys = true, wrap = prefs().wrap } = {}) {
  const el = h('div', `k-menu ${cls}`); host.appendChild(el);
  const m = { el, items, sel: -1, destroy: null };
  const rows = items.map((it, i) => {
    const r = h('div', `k-item${it.enabled === false ? ' dim' : ''}${it.cls ? ' ' + it.cls : ''}`, `<span class="l">${it.html ?? esc(it.label)}</span>${it.right != null ? `<span class="r">${it.right}</span>` : ''}`);
    r.addEventListener('mouseenter', () => { if (m.sel !== i) { m.set(i); sfx('cursor'); } });
    r.addEventListener('click', (e) => { e.stopPropagation(); m.set(i); pick(); });
    el.appendChild(r); return r;
  });
  const pick = () => { const it = items[m.sel]; if (!it) return; if (it.enabled === false) { sfx('buzz'); return; } sfx(it.sound || 'confirm'); onPick?.(it, m.sel); };
  m.set = (i) => { if (!rows.length) return; i = Math.max(0, Math.min(rows.length - 1, i)); if (m.sel >= 0) rows[m.sel]?.classList.remove('sel'); m.sel = i; rows[i].classList.add('sel'); rows[i].scrollIntoView?.({ block: 'nearest' }); onMove?.(items[i], i); };
  m.move = (d) => { if (!rows.length) return; let i = m.sel + d; if (wrap) i = (i + rows.length) % rows.length; m.set(i); sfx('cursor'); };
  m.pick = pick;
  m.set(Math.min(sel, rows.length - 1));
  const off = keys ? pushKeys((k) => { if (k === 'up') m.move(-1); else if (k === 'down') m.move(1); else if (k === 'ok') pick(); else if (k === 'back') { if (onBack) { sfx('cancel'); onBack(); } } else return false; }) : () => {};
  m.destroy = () => { off(); el.remove(); };
  m.release = off;
  return m;
}

// ---------------------------------------------------------------- fades & navigation
let fader = null;
function fadeEl() { if (!fader) { fader = h('div', 'k-fade'); document.body.appendChild(fader); } return fader; }
export async function fadeOut(ms = 380) { const f = fadeEl(); f.style.transition = `opacity ${ms}ms ease-in`; f.classList.add('on'); await sleep(ms + 30); }
export async function fadeIn(ms = 420) { const f = fadeEl(); f.classList.add('on'); f.style.transition = 'none'; void f.offsetWidth; f.style.transition = `opacity ${ms}ms ease-out`; f.classList.remove('on'); await sleep(ms); }
export async function navigate(url, ms = 420) { blockKeys(true); await fadeOut(ms); location.href = url; }

// ---------------------------------------------------------------- sprites & portraits
const sheetCache = new Map();
async function sheet(name) {
  if (!sheetCache.has(name)) sheetCache.set(name, (async () => {
    const meta = await (await fetch(`./sprites/${name}.json`)).json();
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('sheet ' + name)); img.src = `./sprites/${name}.png`; });
    return { meta, img };
  })());
  return sheetCache.get(name);
}
function frameRect(meta, i = 0) { const f = meta.frames?.[i]; return f ? { x: f.x, y: f.y, w: f.w, h: f.h } : { x: 0, y: 0, w: meta.cellW, h: meta.cellH }; }
function trimmed(img, r) {
  const c = document.createElement('canvas'); c.width = r.w; c.height = r.h; const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h); const d = g.getImageData(0, 0, r.w, r.h).data;
  let x0 = r.w, x1 = 0, y0 = r.h, y1 = 0;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (d[(y * r.w + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { c, x0, x1, y0, y1 };
}
const portraitCache = new Map();
/** Head-and-shoulders crop of the front idle frame, 96x96 data URL (same recipe as the battle status card). */
export function portrait(spriteName) {
  if (!portraitCache.has(spriteName)) portraitCache.set(spriteName, (async () => {
    // Hand-framed bust from public/portraits (tools/pack_portraits.py); the atlas crop below is the fallback.
    const pre = portraitUrl(spriteName); if (pre) { const ok = await new Promise((r) => { const i = new Image(); i.onload = () => r(true); i.onerror = () => r(false); i.src = pre; }); if (ok) return pre; }
    const { meta, img } = await sheet(spriteName); const t = trimmed(img, frameRect(meta, 0));
    if (t.x1 <= t.x0) throw new Error('empty frame');
    // Frame the head and shoulders: the width comes from the top 40% of the silhouette only, so a spear, a tail or
    // a cape flaring out lower down cannot shrink the face to a full-body thumbnail.
    const bh = t.y1 - t.y0 + 1; const g2 = t.c.getContext('2d'); const yEnd = t.y0 + Math.round(bh * 0.4);
    const d = g2.getImageData(0, t.y0, t.c.width, Math.max(1, yEnd - t.y0)).data; let hx0 = t.c.width, hx1 = 0;
    for (let y = 0; y < yEnd - t.y0; y++) for (let x = 0; x < t.c.width; x++) if (d[(y * t.c.width + x) * 4 + 3] > 40) { if (x < hx0) hx0 = x; if (x > hx1) hx1 = x; }
    if (hx1 < hx0) { hx0 = t.x0; hx1 = t.x1; }
    const bw = hx1 - hx0 + 1; const side = Math.max(8, Math.round(Math.max(bw * 1.05, bh * 0.46)));
    const sx = Math.round(hx0 + bw / 2 - side / 2), sy = Math.max(0, Math.round(t.y0 - side * 0.05));
    const out = document.createElement('canvas'); out.width = 96; out.height = 96; const og = out.getContext('2d');
    if (side >= 96) { og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high'; og.drawImage(t.c, sx, sy, side, side, 0, 0, 96, 96); }
    else { const k = Math.ceil(96 / side); const big = document.createElement('canvas'); big.width = side * k; big.height = side * k; const bg = big.getContext('2d'); bg.imageSmoothingEnabled = false;
      bg.drawImage(t.c, sx, sy, side, side, 0, 0, side * k, side * k); og.imageSmoothingEnabled = false; const off = Math.round((side * k - 96) / 2); og.drawImage(big, off, Math.round(off * 0.4), 96, 96, 0, 0, 96, 96); }
    return out.toDataURL();
  })().catch((e) => { console.warn('portrait', spriteName, e); return null; }));
  return portraitCache.get(spriteName);
}
/** Portrait element that fills in asynchronously. */
export function portraitEl(spriteName, cls = 'k-portrait', initial = '?') {
  const e = h('div', `${cls} empty`); e.dataset.init = initial;
  if (spriteName) portrait(spriteName).then((u) => { if (u) { e.style.backgroundImage = `url(${u})`; e.classList.remove('empty'); } });
  return e;
}
const bodyCache = new Map();
/** Full-body front idle frame, trimmed, as a data URL plus its size (for map tokens / formation figures). */
export function bodySprite(spriteName, frame = 0) {
  const key = spriteName + '#' + frame;
  if (!bodyCache.has(key)) bodyCache.set(key, (async () => {
    const { meta, img } = await sheet(spriteName); const t = trimmed(img, frameRect(meta, frame));
    const w = t.x1 - t.x0 + 1, hh = t.y1 - t.y0 + 1; const c = document.createElement('canvas'); c.width = w; c.height = hh;
    c.getContext('2d').drawImage(t.c, t.x0, t.y0, w, hh, 0, 0, w, hh); return { url: c.toDataURL(), w, h: hh };
  })().catch(() => null));
  return bodyCache.get(key);
}

// ---------------------------------------------------------------- audio hooks
const audioMods = import.meta.glob('../audio/audio.js');
let AUDIO = null; let audioP = null;
export function audio() {
  if (!audioP) { const load = Object.values(audioMods)[0]; audioP = (load ? load() : Promise.resolve(null)).then((m) => { AUDIO = m; applyVolumes(); return m; }).catch((e) => { console.warn('audio module failed', e); return null; }); }
  return audioP;
}
export function applyVolumes(o = loadOptions()) {
  if (!AUDIO) return;
  try { if (AUDIO.setVolumes) AUDIO.setVolumes({ music: o.music / 10, sfx: o.sfx / 10 }); else { const c = AUDIO.audioControls; c?.setMusic?.(o.music / 10); c?.setSfx?.(o.sfx / 10); } } catch (e) { console.warn(e); }
}
export async function setScene(name) { const m = await audio(); try { m?.setScene?.(name); } catch (e) { console.warn('setScene', e); } }

let ac = null; let lastBlip = 0;
function blip(kind) {
  const vol = prefs().sfx / 10; if (vol <= 0) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume();
    const now = ac.currentTime; const P = { cursor: [[1320, 0.035, 'square', 0.05]], confirm: [[880, 0.05, 'square', 0.06], [1320, 0.08, 'square', 0.06]], cancel: [[660, 0.05, 'square', 0.05], [440, 0.07, 'square', 0.05]],
      buzz: [[140, 0.12, 'sawtooth', 0.06]], page: [[990, 0.04, 'triangle', 0.08]], levelup: [[784, 0.08, 'square', 0.05], [988, 0.08, 'square', 0.05], [1175, 0.08, 'square', 0.05], [1568, 0.22, 'square', 0.05]], text: [[1760, 0.012, 'square', 0.018]] }[kind];
    if (!P) return; let t = now;
    for (const [f, d, type, g] of P) { const o = ac.createOscillator(), gn = ac.createGain(); o.type = type; o.frequency.value = f; gn.gain.setValueAtTime(g * vol, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(gn).connect(ac.destination); o.start(t); o.stop(t + d + 0.02); t += d * 0.9; }
  } catch { /* no audio device: silent */ }
}
export function sfx(kind) {
  const n = performance.now(); if (kind === 'cursor' && n - lastBlip < 30) return; lastBlip = n;
  if (AUDIO?.uiSfx && (kind === 'cursor' || kind === 'confirm' || kind === 'cancel')) { try { AUDIO.uiSfx(kind); return; } catch { /* fall through */ } }
  blip(kind);
}

/** Modal choice: resolves with the picked item id, or null on Back. */
export function dialog(title, text, items, { sel = 0, cls = '', ovCls = '' } = {}) {
  return new Promise((res) => {
    const ov = h('div', `k-overlay${ovCls ? ' ' + ovCls : ''}`); const w = win(title, `k-dialog ${cls}`, text ? `<p>${text}</p>` : ''); ov.appendChild(w); (document.getElementById('shell') || document.body).appendChild(ov);
    const done = (v) => { m.destroy(); ov.remove(); res(v); };
    const m = menu(w.querySelector('.k-body'), items, { sel, onPick: (it) => done(it.id), onBack: () => done(null) });
    ov.addEventListener('click', (e) => { if (e.target === ov) { sfx('cancel'); done(null); } });
  });
}
