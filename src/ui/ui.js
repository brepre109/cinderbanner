import * as THREE from 'three';
import { CLASSES, ABILITIES, STATUS, REACTIONS, SUPPORTS, MOVEMENTS, stat, abilityInfo, weaponRange, weaponPower } from '../game/rules.js';
import { ITEMS, SLOTS, SLOT_NAME } from '../game/equipment.js';
import { iconHtml } from '../campaign/icons.js';
import { SKILLSET } from '../game/data.js';
import { prefs, onPrefs, palette, keyLabel, textRate, installKeyTranslator, menuFocused } from './prefs.js';
import { fitText } from './fit.js';
import { portraitUrl, preloadPortraits as preloadPacked } from '../units/portraits.js';   // R16 hand-framed busts
const PLATE = 'linear-gradient(180deg, #6b7590, #2c3247 70%, #1a1d2c)';   // the portrait plate ui.css paints under a bust
// HTML battle HUD in the genre idiom (parchment windows, bitmap-style bold serif, portrait status card,
// Hp/Mp/Ct ramps, hand-pointer command window, forecast card, hard-outlined damage numbers).
// Public API (used by battle.js / player.js): setActive, setUnitHp, setTurnOrder, announce, menu/menuMove/menuConfirm/closeMenu,
// forecast, popup, victory, title, update. Extras: bind(battle), setTheme('parchment'|'slate'), portrait(spriteName).

const fmt3 = (n) => String(Math.max(0, n | 0)).padStart(3, '0');
const pct = (a, b) => Math.max(0, Math.min(100, b > 0 ? (a / b) * 100 : 0));
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Pixel-art assets are authored as text grids and turned into SVG data URIs (no external files).
function pixelSvg(rows, palette, scale = 1) {
  const w = rows[0].length, h = rows.length; let rects = '';
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) { const c = palette[r[x]]; if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`; } });
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' width='${w * scale}' height='${h * scale}' shape-rendering='crispEdges'>${rects}</svg>`)}")`;
}
// the genre's white glove pointer (points right). ROUND-5: round 4's grid read as a blunt mitten in the 1:1
// crop review ('placeholder-grade, nearly featureless fill'). Rebuilt against ref06's cursor — pale
// ivory body, STEPPED dark outline, blue-gray shading along the lower edges, distinct index finger
// over a curled palm. Candidate A beat a longer-fingered B in a side-by-side vision check.
const HAND = pixelSvg([
  '......######...........',
  '.....#wwwwww#..........',
  '....#wwwwwwww#.........',
  '...#wwwwwwwwww#####....',
  '..#wwwwwwwwwwwwwwww###.',
  '..#wwwwwwwwwwwwwwwwwwww',
  '.#wwwwwwwwwwwwwwwwwwwww',
  '.#wwwwwwwwwwwwwwwwwwwwg',
  '.#wwwwwwwwwwwww#######.',
  '.#wwwwwwwwwww#.........',
  '.#wwwwwwwww##..........',
  '..#wwwwwwww#...........',
  '..#wwwwwww#............',
  '...#wwwww#.............',
  '....#gggg#.............',
  '....#ggg##.............',
  '.....###...............',
], { '#': '#2a2118', 'w': '#f7f3ea', 'g': '#7f93c4' });
const ICONS = {
  focus:      pixelSvg(['...##...', '..#rr#..', '.#rrrr#.', '#rrrrrr#', '##.rr.##', '...rr...', '...rr...', '...##...'], { '#': '#2a1010', 'r': '#ff6a4a' }),
  def_down:   pixelSvg(['#######.', '#pppp#..', '#ppp#...', '#pp#.#..', '#p#.#p#.', '##.#pp#.', '#.#ppp#.', '.######.'], { '#': '#2a1030', 'p': '#c98cff' }),
  immobilize: pixelSvg(['.##..##.', '#gg##gg#', '#g#gg#g#', '#gg##gg#', '.##..##.', '#gg##gg#', '#g#gg#g#', '.##..##.'], { '#': '#1a1a1a', 'g': '#c8c8c8' }),
  protect:    pixelSvg(['.######.', '#bbbbbb#', '#bwbbwb#', '#bbbbbb#', '#bbbbbb#', '.#bbbb#.', '..#bb#..', '...##...'], { '#': '#0c1d40', 'b': '#5aa0ff', 'w': '#dff0ff' }),
  haste:      pixelSvg(['#...#...', 'y#..y#..', 'yy#.yy#.', 'yyy#yyy#', 'yy#.yy#.', 'y#..y#..', '#...#...', '........'], { '#': '#3a2a00', 'y': '#ffe14a' }),
  slow:       pixelSvg(['########', '#vvvvvv#', '.#vvvv#.', '..#vv#..', '..#vv#..', '.#vvvv#.', '#vvvvvv#', '########'], { '#': '#22103a', 'v': '#9a6bff' }),
};

// ROUND-6 (finding 4, flagged 3x independently): the glossy radial-gradient disc beside the unit
// number read as an HTML radio button. Replaced with a faction crest — a dark badge plate carrying a
// hard-pixel chevron and bar, i.e. insignia with stepped edges, nothing circular, no radial glow.
const CREST_ROWS = [
  '############',
  '#....ll....#',
  '#...l..l...#',
  '#..l....l..#',
  '#.l......l.#',
  '#l........l#',
  '############',
  '#..........#',
  '#llllllllll#',
  '#..........#',
  '#..........#',
  '############',
];
// OPTIONS: the crest ink follows the team palette (src/ui/prefs.js); built once per palette.
const crestCache = new Map();
const CREST = new Proxy({}, { get: (_, team) => { const c = palette().css; const col = team === 'A' ? c.aHi : c.bHi; const k = team + col;
  if (!crestCache.has(k)) crestCache.set(k, pixelSvg(CREST_ROWS, { '#': '#141018', 'l': col })); return crestCache.get(k); } });

// One-line hint bar (keys as chips). DEV ONLY — CRITIQUE_R2 rank 3: this was minted with class
// `show` and nothing ever removed it, so it painted a keycap strip across the battlefield in 20 of
// 20 captures. It is now gated behind ?hud=debug (default OFF, so tools/shot.mjs never sees it) and
// toggled at runtime with H. It also lives at the bottom centre, below the diorama, never on the art.
const HINTS_OF = () => [[keyLabel('rotL'), keyLabel('rotR'), 'Rotate'], [keyLabel('tilt'), 'Tilt'], ['Space', 'Auto'], [keyLabel('help'), 'Keys'], ['Click', 'Select']]
  .map((g) => `<span class="g">${g.slice(0, -1).map((k) => `<kbd>${esc(k)}</kbd>`).join('')}${g[g.length - 1]}</span>`).join('');
const HINTS = HINTS_OF();
// Key names in every hint follow the player's bindings (Options > Controls). K(id) = that action's first key.
const K = (id) => esc(keyLabel(id));
const DIRS = () => [K('left'), K('up'), K('down'), K('right')].join('');
const UPDN = () => K('up') + K('down');
const HUD_DEBUG = (() => { try { return new URLSearchParams(location.search).get('hud') === 'debug'; } catch (e) { return false; } })();
// PLAYTEST r9: a campaign battle (?slot=) is a real player at the keyboard, not a capture. Only there does the HUD
// carry the guide line (what the highlighted command does + the keys that work right now), the in-battle Status
// window's inspect key, and the see-through status card when the unit it describes stands behind it. The capture
// boot (tools/shot.mjs, no ?slot) renders exactly as before.
const GUIDE = (() => { try { const q = new URLSearchParams(location.search); return q.has('slot') || q.get('hud') === 'guide'; } catch (e) { return false; } })();
const CMD_HELP = {
  move: 'Walk first: opens the blue field of tiles this unit can reach.',
  undo: 'Take the step back. Allowed until you act.',
  act: 'Attack with your weapon or use a skill.',
  wait: 'End the turn and pick a facing. Idle turns come round sooner.',
  status: 'Full stats, abilities and support skills of this unit.',
  auto: 'Hand this unit to the AI. Esc at the start of its turn takes it back.',
  attack: 'Strike with the equipped weapon.',
  endyes: 'End the turn now and pick a facing. The unit has not acted.',
  endno: 'Go back to the command menu.',
};
const kbd = (k) => `<kbd>${k}</kbd>`;
const hold = (ms) => Math.round(ms / Math.min(3, textRate()));   // Message Speed scales how long a plate stays up
const chips = (list) => `<span class="keys">${list.map(([k, t]) => `<span class="g">${[].concat(k).map(kbd).join('')}${t}</span>`).join('')}</span>`;
const STAT_ROWS = [['atk', 'Atk'], ['def', 'Def'], ['mag', 'Mag'], ['res', 'Res'], ['spd', 'Spd'], ['eva', 'Eva'], ['move', 'Move'], ['jump', 'Jump']];
// Wyrmlancers / Ignore Height carry +100 jump. R18 (review17 P12): the bare '∞' was unexplained -- it reads 'Any' (any height).
const jumpTxt = (n) => (n >= 20 ? 'Any' : n);

export class UI {
  constructor(root, getCamera, getRenderer) {
    this.root = root; this.getCamera = getCamera; this.getRenderer = getRenderer;
    root.style.setProperty('--hand', HAND);
    root.innerHTML = `<div id="vignette"></div><div id="turn-order" class="win"></div><div id="announce" class="win"></div>
      <div id="unit-card" class="win"></div><div id="menu" class="win"></div><div id="forecast" class="win"></div>
      <div id="title" class="win"></div><div id="help" class="win${HUD_DEBUG ? ' show' : ''}">${HINTS}</div>
      <div id="objective" class="win"></div><div id="banner" class="win"></div><div id="status" class="win"></div><div id="keys" class="win"></div>`;
    this.el = Object.fromEntries(['turn-order', 'announce', 'unit-card', 'menu', 'forecast', 'title', 'help', 'objective', 'banner', 'status', 'keys'].map((id) => [id, root.querySelector('#' + id)]));
    this.guide = GUIDE; root.classList.toggle('guide', GUIDE); this._sticky = null; this._flash = null; this._menuHelp = ''; this._gsig = ''; this._frame = 0;
    this.el.status.addEventListener('click', () => this.closeStatus(true));
    this.el.forecast.addEventListener('click', () => { if (this.guide && this._fcId && !this.el.forecast.classList.contains('raw') && !this.statusOpen) { const v = this.unitById(this._fcId); if (v) this.openStatus(v); } });
    this.el.keys.addEventListener('click', () => this.toggleKeys(false));
    this.speed = 1; this.obj = null;
    this.popups = []; this.portraits = new Map(); this.battle = null; this._bound = false;
    // H toggles the hint bar back on in a normal session; it is never on by default (see HUD_DEBUG).
    // In a campaign battle H opens the full controls window instead, and I opens the Status window for the unit under
    // the cursor (or the acting unit). Registered in the CAPTURE phase so that while either window is up, Esc / Enter
    // close it and never also reach player.js (which would cancel the aim or confirm a command underneath).
    this._keys = (e) => {
      const k = e.key;
      if (this.statusOpen && !this.statusExternal) { // modal: nothing reaches the field underneath while it is up
        e.preventDefault(); e.stopImmediatePropagation();
        if (k === 'Escape' || k === 'Enter' || k === ' ' || k === 'i' || k === 'I' || k === 'Backspace' || k === 'x' || k === 'X') this.closeStatus();
        return;
      }
      if (this.keysOpen && (k === 'Escape' || k === 'Enter' || k === 'h' || k === 'H' || k === '?')) { e.preventDefault(); e.stopImmediatePropagation(); this.toggleKeys(false); return; }
      if (k === 'h' || k === 'H' || k === '?') { if (this.guide) { if (!e.repeat) this.toggleKeys(true); } else if (k !== '?') this.el.help.classList.toggle('show'); return; }
      if (this.guide && (k === 'i' || k === 'I') && !this.statusOpen && !e.repeat) {
        const b = this.battle || window.__GAME__?.battle; const P = window.__GAME__?.player; if (!b) return;
        const c = P?.cursor || P?.hover; const v = (c && b.units.find((o) => !o.removed && o.x === c.x && o.z === c.z && !o.airborne)) || b.active;
        if (v) { e.preventDefault(); e.stopImmediatePropagation(); this.openStatus(v); }
      }
    };
    // OPTIONS: remapped keys are re-dispatched as the keys the battle code listens for (src/ui/prefs.js). Installed
    // here, first, so it runs ahead of every other capture listener on the page (the UI is built before them all).
    installKeyTranslator();
    const keys0 = this._keys; this._keys = (e) => { if (menuFocused()) return; keys0(e); };   // a pause/options window has the keys
    window.addEventListener('keydown', this._keys, true);
    onPrefs(() => { if (this.keysOpen) this.toggleKeys(true); this.el.help.innerHTML = HINTS_OF(); this.renderGuide(); const b = this.battle || window.__GAME__?.battle; const id = this.el['unit-card'].dataset.id; const u = id && b?.units?.find((v) => v.id === id); if (u) this.renderCard(this.el['unit-card'], u); });
    // warm the faces so the first window does not flash a fallback font
    document.fonts?.load('24px "Cinder Pixel"'); document.fonts?.load('18px "Cinder Small"'); document.fonts?.load('52px "Cinder Display"');
  }
  // CRITIQUE_R2 rank 15b: `forecast` was fully built and styled and nothing on the bus ever called it,
  // so the HUD said nothing during the marquee moment (a spell mid-flight). the genre never leaves that band
  // empty during a cast. bind() is self-arming from update()
  // so no edit to src/main.js (integrator-owned) is needed.
  bind(battle) {
    if (this._bound) return; this._bound = true; this.battle = battle;
    const unitAt = (t) => t && battle.units.find((v) => v.x === t.x && v.z === t.z && v.hp > 0);
    const cast = (e) => {
      const v = unitAt(e.target) || e.unit; if (!v) return;
      this.forecast({ target: v, ability: e.ability, effect: true, hit: null });
    };
    battle.on('abilityStart', cast);
    battle.on('charge', cast);
    // the genre does not drop the target readout when the animation ends — the references all show
    // the victim's Hp/Mp/Ct window still up while the damage number is on screen. It is dropped by the
    // next turn (and, in interactive play, by player.js's own forecast(null) calls).
    battle.on('turnEnd', () => this.forecast(null));
    battle.on('turnStart', () => this.forecast(null));
    // keep the readout live while the spell lands
    battle.on('damage', (e) => { if (this._fcId === e.victim.id) this.forecastTarget(e.victim, { ...this._fcInfo, dmg: e.amount }); });
    battle.on('heal', (e) => { if (this._fcId === e.victim.id) this.forecastTarget(e.victim, { ...this._fcInfo, heal: e.amount }); });
  }
  setTheme(name) { this.root.classList.toggle('slate', name === 'slate'); }
  // ---- victory conditions (the genre ref04 "Conditions for Winning" banner + a compact standing plate) ----
  setObjective(o) { this.obj = o; this.renderObjective(); }
  setSpeed(x) { this.speed = x; this.renderObjective(); }
  renderObjective() {
    const el = this.el.objective; const o = this.obj || { win: 'Defeat all enemies!' };
    el.innerHTML = `<span class="lab">Win</span><span class="txt">${esc(o.win)}</span>${this.speed > 1 ? `<span class="spd">&times;${this.speed}</span>` : ''}`;
    el.classList.toggle('show', !!this.shown);
  }
  showObjective(v = true) { this.shown = v; this.renderObjective(); }
  objectiveBanner(o) {
    if (o) this.setObjective(o); const b = this.el.banner; const t = this.obj || { win: 'Defeat all enemies!' };
    b.innerHTML = `<div class="k">Conditions for Winning</div><div class="v">${esc(t.win)}</div>${t.lose ? `<div class="l">Defeat: ${esc(t.lose)}</div>` : ''}`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(this._bt); this._bt = setTimeout(() => { b.classList.remove('show'); this.showObjective(true); }, 2300);
  }

  // ---- portraits: crop of the unit's front idle frame (row 0, col 0), head-and-shoulders, cached as a data URL ----
  // R15 (review15 P2): a portrait still loading (or one whose load failed: a slow fetch under load, an aborted decode)
  // left its letter placeholder in the turn strip and the deployment roster for the whole battle, because a failure was
  // cached as null for good. Now: every in-flight load is a promise (preloadPortraits awaits them before the field is
  // shown), a failure is retried twice, and a resolved face is patched into EVERY node that carries its data-portrait,
  // wherever it is in the document (the deploy roster, a strip rebuilt mid-load).
  // R16: hand-framed busts (public/portraits via src/units/portraits.js) come first; the atlas crop below is the fallback
  // for a sheet with no packed portrait.
  preloadPortraits(units, timeout = 6000) {
    const list = (units || []).filter(Boolean);
    const packed = preloadPacked(list, { sizes: [96, 48], timeout });
    const names = [...new Set(list.filter((u) => !portraitUrl(u)).map((u) => u.spriteName).filter(Boolean))];
    names.forEach((n) => this.portrait(n));
    const all = Promise.all([packed, ...names.map((n) => this._pload?.get(n) || null)]);
    return Promise.race([all, new Promise((r) => setTimeout(r, timeout))]);
  }
  portrait(name, attempt = 0) {
    if (this.portraits.has(name) && (this.portraits.get(name) || this._pload?.has(name) || this._pfail?.has(name))) return this.portraits.get(name);
    this.portraits.set(name, null); this._pload ??= new Map();
    const job = (async () => {
      try {
        const meta = await (await fetch(`./sprites/${name}.json`)).json();
        const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('image failed')); img.src = `./sprites/${name}.png`; });
        // frame 0 = front idle. New packed atlases carry per-frame rects; the old grid format carries cellW/cellH.
        const f0 = meta.frames?.[0]; const fx = f0?.x ?? 0, fy = f0?.y ?? 0, fw = f0?.w ?? meta.cellW, fh = f0?.h ?? meta.cellH;
        const c = document.createElement('canvas'); c.width = fw; c.height = fh; const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, fx, fy, fw, fh, 0, 0, fw, fh); const d = g.getImageData(0, 0, fw, fh).data;
        let x0 = fw, x1 = 0, y0 = fh, y1 = 0;
        for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) if (d[(y * fw + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (x1 <= x0) throw new Error('empty frame');
        // head-and-shoulders crop that fills the frame: square the width of the body, anchored at the top of
        // the silhouette, blown up at an integer nearest-neighbour factor and centre-cropped back to 96.
        const bh = y1 - y0 + 1, bw = x1 - x0 + 1;
        const side = Math.max(8, Math.round(Math.max(bw * 1.02, bh * 0.46)));
        const sx = Math.round(x0 + bw / 2 - side / 2), sy = Math.max(0, Math.round(y0 - side * 0.05));
        const out = document.createElement('canvas'); out.width = 96; out.height = 96; const og = out.getContext('2d');
        if (side >= 96) { // big sprite (monsters): fit the crop into the frame
          og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high'; og.drawImage(c, sx, sy, side, side, 0, 0, 96, 96);
        } else {          // small sprite: nearest-neighbour at an integer factor, then centre-crop back to 96
          const k = Math.ceil(96 / side);
          const big = document.createElement('canvas'); big.width = side * k; big.height = side * k;
          const bg = big.getContext('2d'); bg.imageSmoothingEnabled = false;
          bg.drawImage(c, sx, sy, side, side, 0, 0, side * k, side * k);
          og.imageSmoothingEnabled = false; const off = Math.round((side * k - 96) / 2);
          og.drawImage(big, off, Math.round(off * 0.4), 96, 96, 0, 0, 96, 96);
        }
        const url = `url(${out.toDataURL()})`; this.portraits.set(name, url); this._pload.delete(name);
        document.querySelectorAll(`[data-portrait="${CSS.escape(name)}"]`).forEach((el) => { el.style.backgroundImage = url; el.classList.remove('empty'); });
      } catch (e) {
        this._pload.delete(name); console.warn('portrait', name, String(e && e.stack || e));
        if (attempt >= 2) (this._pfail ??= new Set()).add(name);
        else { await new Promise((r) => setTimeout(r, 700 * (attempt + 1))); this.portraits.delete(name); this.portrait(name, attempt + 1); return this._pload.get(name); }
      }
    })();
    this._pload.set(name, job);
    return null;
  }
  portraitDiv(u, cls = 'portrait') {
    const init = esc((u.name || '?').trim()[0] || '?').toUpperCase();
    // the packed PNG is transparent: layer it over the plate gradient ui.css draws (a bare url() would replace it);
    // the turn strip and the deploy list ('pic') take the 48px bust
    const packed = portraitUrl(u, cls === 'portrait' ? 96 : 48);
    if (packed) return `<div class="${cls} ${u.team}" data-init="${init}" style="background-image:url(${packed}), ${PLATE}"></div>`;
    const url = this.portrait(u.spriteName);
    return `<div class="${cls} ${u.team}${url ? '' : ' empty'}" data-portrait="${u.spriteName}" data-init="${init}" style="${url ? `background-image:${url}` : ''}"></div>`;
  }

  // ---- active unit: ONE dense framed status window (ROUND-6, finding 3) -----------------------------------
  // The round-5 split — a chromeless portrait+gauges block floating bottom-left AND a separate
  // framed name/job card bottom-right — read as 'status info split': portrait and Hp/Mp/Ct sat on
  // raw battlefield pixels while the ally card carried text but no gauges and a glossy radio dot.
  // the genre ref06 keeps portrait + gauges + Lv/Exp + Resolve inside one dense khaki window; both
  // blocks are merged into #unit-card here and #name-card no longer exists.
  setActive(u) {
    const c = this.el['unit-card'];
    if (!u) { c.classList.remove('show'); c.dataset.id = ''; return; }
    this.renderCard(c, u); c.classList.add('show');
  }
  setUnitHp(u) { if (this.el['unit-card'].dataset.id === u.id) this.renderCard(this.el['unit-card'], u); if (this._fcId === u.id) this.forecastTarget(u, this._fcInfo); }
  renderCard(c, u) {
    c.dataset.id = u.id;
    const st = Object.keys(u.statuses).map((s) => ICONS[s] ? `<i class="sticon" title="${STATUS[s]?.name || s}" style="background-image:${ICONS[s]}"></i>` : '').join('');
    const b = this.battle || window.__GAME__?.battle; const cls = CLASSES[u.cls];
    // unit ids run on across teams (A0-A4, B5-B9): number within the unit's own side, so a foe reads 01/05, not 06/05
    const side = b?.units?.filter((v) => v.team === u.team) || []; const total = side.length || 5;
    const idx = side.indexOf(u) >= 0 ? side.indexOf(u) + 1 : (parseInt(u.id.slice(1), 10) || 0) + 1;
    c.innerHTML = `<div class="tab ${u.team === 'B' ? 'enemy' : ''}">${u.team === 'A' ? 'Ally' : 'Enemy'}</div>
      ${this.portraitDiv(u)}<div class="info">
      <div class="nm"><span class="crest" style="background-image:${CREST[u.team]}"></span><span class="no">${fmt3(idx).slice(1)}<span class="sep">/</span>${fmt3(total).slice(1)}</span><b>${esc(u.name)}</b></div>
      <div class="job"><span class="jn">${esc(cls.name)}${u.leader ? ' <span class="ldr">Leader</span>' : ''}</span>${u.charging
        ? `<span class="top charging">Charging ${esc(ABILITIES[u.charging.id]?.name || '')}</span>`
        : `<span class="top">Lv.<em>${u.lvl}</em>&nbsp;&nbsp;Mv.<em>${stat(u, 'move')}</em>&nbsp;&nbsp;Jmp.<em>${jumpTxt(stat(u, 'jump'))}</em></span>`}</div>
      ${this.bar('Hp', u.hp, u.maxHp, u.hp / u.maxHp < 0.25 ? 'hp low' : 'hp')}
      ${this.bar('Mp', u.mp, u.maxMp, 'mp')}
      ${this.bar('Ct', u.ct, 100, 'ct')}
      <div class="bf"><span>Resolve <b>${u.brv ?? cls.brv ?? 70}</b></span><span>Atk <b>${stat(u, 'atk')}</b></span><span>Mag <b>${stat(u, 'mag')}</b></span><span>Spd <b>${stat(u, 'spd')}</b></span><span class="statuses">${st}</span></div></div>`;
    fitText(c.querySelectorAll('.nm b, .job .jn'), { min: 0.7 });
  }
  bar(label, cur, max, cls) {
    return `<div class="srow"><span class="lab">${label}</span><div class="ramp ${cls}"><i style="width:${pct(cur, max)}%"></i></div><span class="num">${fmt3(cur)}<small>${fmt3(max)}</small></span></div>`;
  }

  // ---- turn order strip ----
  // caption (optional, {k, v}): a narrow last cell naming the plan the strip previews ("Wait" / "next: 3rd").
  setTurnOrder(list, caption = null) {
    const t = this.el['turn-order'];
    // ROUND-6 (finding 6): cap at 7 cells — an eighth cell pushed three-character '+15' labels
    // against the bottom border — and carry NO title plaque: ref06's CT strip has none, and the
    // 'Order' tab was one of the fieldset/legend interrupts the critic named.
    // o.next = the acting unit's NEXT turn under the plan being previewed (player.js passes Engine.forecast(n, plan)),
    // o.charge = a charged ability resolving (o.planned: the one being aimed right now). Both are marked, not hidden.
    list = list.slice(0, 7);
    // R18 (review17 P12): player.js captions 'Move' / '7th +17' read as cryptic; spelled out as 'Next: 7th' / 'in 17 ticks'
    if (caption) { const m = /^(\d+(?:st|nd|rd|th)) \+(\d+)$/.exec(String(caption.v)); if (m) caption = { ...caption, v: `Next: ${m[1]}`, v2: `in ${m[2]} tick${m[2] === '1' ? '' : 's'}` }; }
    t.innerHTML = list.map((o, i) => `<div class="slot ${o.unit.team}${i === 0 ? ' now' : ''}${o.next ? ' next' : ''}${o.charge ? ' charge' : ''}${o.planned ? ' planned' : ''}" title="${esc(o.unit.name)}">${this.portraitDiv(o.unit, 'pic')}<span>${i === 0 ? 'AT' : o.tick ? '+' + o.tick : '·'}</span></div>`).join('') + (caption ? `<div class="cap">${esc(caption.k)}<small>${esc(caption.v)}</small>${caption.v2 ? `<small class="k2">${esc(caption.v2)}</small>` : ''}</div>` : '');
    t.classList.toggle('capt', !!caption); t.classList.add('show');
  }

  announce(text) {
    const a = this.el.announce;
    if (!this.guide) { if (!text) { a.classList.remove('show'); return; } a.textContent = text; a.classList.add('show'); clearTimeout(this._at); this._at = setTimeout(() => a.classList.remove('show'), hold(1400)); return; }
    // Guide mode: an instruction ("Move · pick a tile", an ability being aimed, the facing pick) stays up for as long
    // as it applies -- it used to vanish after 1.4 s, before a new player had read it. Event lines ("Seren falls",
    // "Battle speed x2") flash over it for 1.6 s and then the instruction comes back.
    clearTimeout(this._at);
    if (!text) { this._sticky = null; this._flash = null; }
    else if (/ · /.test(text)) { this._sticky = this.phrase(text); this._flash = null; }
    else { this._flash = text; this._at = setTimeout(() => { this._flash = null; this.renderGuide(); }, hold(1600)); }
    this.renderGuide();
  }
  // Player.js's terse prompts, said the way a manual would say them. Anything unrecognised passes through verbatim.
  phrase(t) {
    if (/^Move · pick a tile/.test(t)) return 'Move: pick a tile in the blue field.';
    if (/^Facing · /.test(t)) return 'Facing: attacks from behind hit hardest, so face the enemy.';
    // aiming line from player.aim(): "Fire · R4 A1 CT2 · SP 10 fire" -> "Fire: pick a target (range 4, area 1, charge 2). Power 10 fire."
    const m = /^(.+?) · R(\d+)(?: A(\d+)(?: (\w+))?)?(?: CT(\d+))?(?: · (.*))?$/.exec(t);
    if (m) {
      const [, name, r, a, shape, ct, desc] = m; const bits = [`range ${r}`, a ? `area ${a}${shape ? ' ' + shape : ''}` : null, ct ? `charge ${ct}` : null].filter(Boolean).join(', ');
      const d = String(desc || '').replace(/\bSP (\d+)/g, 'power $1').replace(/\bWP\b/g, 'weapon power');
      return `${name}: pick a target (${bits}).${d ? ' ' + d.charAt(0).toUpperCase() + d.slice(1) + (/[.!]$/.test(d) ? '' : '.') : ''}`;
    }
    return t;
  }
  guideKeys() {
    const P = window.__GAME__?.player; const g = [];
    const moving = /^Move/.test(this._sticky || '');
    if (P?.facingFn) return chips([[DIRS(), 'Turn'], [K('ok'), 'End turn'], [K('back'), 'Back']]);
    if (P?.pick) { g.push([DIRS(), moving ? 'Pick tile' : 'Aim']); if (!moving && P.targets?.length > 1) g.push([K('target'), 'Next target']); g.push([K('ok'), 'Confirm'], [K('back'), 'Cancel']); return chips(g); }
    if (!this.menuItems) return '';
    g.push([UPDN(), 'Choose'], [K('ok'), 'OK']); if (this.menuTitle !== 'Menu' || this.menuItems.some((i) => i.id === 'undo')) g.push([K('back'), this.menuTitle === 'Menu' ? 'Undo move' : 'Back']);
    g.push([K('status'), 'Status'], [K('help'), 'Keys']);
    return chips(g);
  }
  renderGuide() {
    const a = this.el.announce; const P = window.__GAME__?.player;
    const busy = P?.facingFn || P?.pick || this.menuItems;
    const txt = this._flash || this._sticky || (this.menuItems ? this._menuHelp : '');
    this._gsig = this.guideSig();
    if (!txt || this.statusOpen) { a.classList.remove('show'); return; }
    a.innerHTML = `<span class="t">${esc(txt)}</span>${busy && !this._flash ? this.guideKeys() : ''}`;
    a.classList.toggle('flash', !!this._flash); a.classList.add('show');
  }
  guideSig() { const P = window.__GAME__?.player; return `${!!this.menuItems}|${!!P?.pick}|${!!P?.facingFn}|${P?.targets?.length || 0}|${this.statusOpen}`; }
  // help line for the highlighted command / ability
  helpFor(it) {
    if (!it) return '';
    const u = this.battle?.active || window.__GAME__?.battle?.active;
    if (it.id === 'set:p' || it.id === 'set:s') { const cls = it.id === 'set:p' ? u?.cls : u?.secondary; return `${SKILLSET[cls] || CLASSES[cls]?.name || it.label}: ${it.id === 'set:p' ? 'this job' : 'the secondary'}'s skills.`; }
    if (u && ABILITIES[it.id] && it.id !== 'attack') {
      try {
        const i = abilityInfo(u, it.id);
        const bits = [i.mp ? `${i.mp} Mp` : null, `Range ${i.range}`, i.area ? `Area ${i.area}${i.shape ? ' ' + i.shape : ''}` : null, i.ct ? `Charge ${i.ct}` : null].filter(Boolean).join(', ');
        const desc = String(i.desc || '').replace(/\bSP (\d+)/g, 'power $1').replace(/\bWP\b/g, 'weapon power').replace(/\bCT\b/g, 'charge');
        return `${i.name} (${bits}). ${desc.charAt(0).toUpperCase()}${desc.slice(1)}${!i.usable && i.why ? ` [${i.why}]` : ''}`.trim();
      } catch (e) { /* unknown id: fall through */ }
    }
    if (it.id === 'attack' && u) return `Attack (Range ${weaponRange(u)}): strike with the equipped weapon.`;
    return CMD_HELP[it.id] || '';
  }
  // R15 (review15 P12): a confirm the field refuses (Enter on a tile outside the blue / red field) used to do nothing
  // at all. Now: the error buzz, the cursor tile flashes red, and the guide line says why.
  refuse(msg = 'Out of range: pick a tile inside the field.', tile = null) {
    try { window.__AUDIO_DIRECTOR__?.uiSfx?.('error'); } catch (e) { /* audio optional */ }
    const ov = window.__GAME__?.overlay; if (tile && ov?.flashBad) ov.flashBad(tile.x, tile.z);
    if (this.guide) { this.announce(msg); clearTimeout(this._at); this._at = setTimeout(() => { this._flash = null; this.renderGuide(); }, hold(2600)); } else { const a = this.el.announce; a.textContent = msg; a.classList.add('show'); clearTimeout(this._at); this._at = setTimeout(() => a.classList.remove('show'), 1200); }
  }
  unitById(id) { const b = this.battle || window.__GAME__?.battle; return b?.units?.find((o) => o.id === id) || null; }

  // ---- Status window (any unit, any time in a campaign battle; also the Menu's Status command) ----------------------
  openStatus(u, external = false) {
    const w = this.el.status; this.statusOpen = u.id; this.statusExternal = external;
    const c = CLASSES[u.cls];
    const ally = u.team === 'A'; const s = (k) => stat(u, k);
    const sts = Object.keys(u.statuses || {}).filter((k) => STATUS[k]).map((k) => `<i class="${STATUS[k].bad || /poison|slow|stop|sleep|blind|silence|down|immob|disable|charm|doom|berserk/i.test(k) ? 'bad' : 'good'}">${esc(STATUS[k].name)}${u.statuses[k] < 99 ? ` ${u.statuses[k]}` : ''}</i>`).join('');
    const sec = new Set(u.secondaryList || []);
    const abl = (u.abilityList || []).filter((id) => ABILITIES[id] && !ABILITIES[id].hidden).map((id) => {
      const i = abilityInfo(u, id);
      return `<div class="ab${i.usable ? '' : ' off'}"><span class="n">${sec.has(id) ? '<small>2</small>' : ''}${esc(i.name)}${i.item != null ? ` &times;${i.item}` : ''}</span><span class="m">${i.mp ? `${i.mp}<small>Mp</small>` : ''}</span><span class="r">R${i.range}${i.area ? ` A${i.area}` : ''}${i.ct ? ` <em>CT${i.ct}</em>` : ''}</span></div>`;
    }).join('');
    const slot = (lab, tbl, id) => `<div class="sl"><span class="k">${lab}</span><b>${esc(tbl[id]?.name || '—')}</b>${tbl[id]?.desc ? `<span class="d">${esc(tbl[id].desc)}</span>` : ''}</div>`;
    w.className = `win${ally ? '' : ' foe'}`;
    w.innerHTML = `<div class="tab${ally ? '' : ' enemy'}">Status &middot; ${ally ? 'Ally' : 'Enemy'}</div>
      <div class="hd">${this.portraitDiv(u)}<div class="id"><div class="nm">${esc(u.name)}${u.leader ? ' <span class="ldr">Leader</span>' : ''}</div>
        <div class="jb">${esc(c.name)}${u.secondary ? ` <span class="k2">/ ${esc(SKILLSET[u.secondary] || CLASSES[u.secondary]?.name || '')}</span>` : ''}</div>
        <div class="lv">Lv.<b>${u.lvl}</b>  Resolve <b>${u.brv ?? c.brv ?? 70}</b>  Wpn range <b>${weaponRange(u)}</b></div>
        ${this.bar('Hp', u.hp, u.maxHp, u.hp / u.maxHp < 0.25 ? 'hp low' : 'hp')}${this.bar('Mp', u.mp, u.maxMp, 'mp')}${this.bar('Ct', u.ct, 100, 'ct')}</div></div>
      <div class="grid">${STAT_ROWS.map(([k, l]) => `<div class="st"><span>${l}</span><b>${k === 'jump' ? jumpTxt(s(k)) : k === 'eva' ? s(k) + '%' : s(k)}</b></div>`).join('')}</div>
      ${sts ? `<div class="sts">${sts}</div>` : ''}
      <div class="cols"><div class="abl"><div class="h">Abilities</div>${abl || '<div class="ab off">None</div>'}</div>
        <div class="rsm">${slot('Reaction', REACTIONS, u.reaction)}${slot('Support', SUPPORTS, u.support)}${slot('Movement', MOVEMENTS, u.movement)}${u.equip ? `<div class="gear">${SLOTS.map((g) => { const it = ITEMS[u.equip[g]]; return `<div class="gr">${it ? iconHtml(it.id, 'sm') : '<i class="k-ico sm empty"></i>'}<span class="k">${SLOT_NAME[g] === 'Accessory' ? 'Acc' : SLOT_NAME[g]}</span><b>${esc(it ? it.name : '—')}</b></div>`; }).join('')}<div class="gr wp"><span class="k">Weapon Power</span><b>${weaponPower(u)}</b></div></div>` : ''}</div></div>
      <div class="foot">${u.charging ? `Charging ${esc(ABILITIES[u.charging.id]?.name || '')} &middot; ` : ''}${u.ko ? 'KO &middot; ' : ''}Enter / Esc / click to close</div>`;
    w.classList.remove('show'); void w.offsetWidth; w.classList.add('show');
    this.renderGuide();
  }
  closeStatus(fromClick = false) {
    if (!this.statusOpen) return;
    if (this.statusExternal) { if (fromClick) { const P = window.__GAME__?.player; (P?.confirmFn || P?.cancel)?.(); } return; } // player.js owns this one; its done() calls forecast(null)
    this.statusOpen = null; this.el.status.classList.remove('show'); this.renderGuide();
  }
  toggleKeys(v) {
    this.keysOpen = v; const w = this.el.keys;
    const row = (k, t) => `<div class="kr"><span class="kk">${[].concat(k).map(kbd).join('')}</span><span>${t}</span></div>`;
    if (v) w.innerHTML = `<div class="tab">Controls</div><div class="kg">
      <div class="kc"><b>Commands</b>${row([K('up'), K('down')], 'Choose')}${row(K('ok'), 'Confirm')}${row(K('back'), 'Back &middot; Undo move')}${row('1-9', 'Pick a command')}
        <b>Field</b>${row([K('left'), K('up'), K('down'), K('right')], 'Move the cursor')}${row('Mouse', 'Point and click')}${row(K('target'), 'Next target')}${row('Right-click', 'Cancel')}</div>
      <div class="kc"><b>Camera</b>${row([K('rotL'), K('rotR')], 'Rotate')}${row(K('tilt'), 'Tilt')}${row([K('zoomIn'), K('zoomOut')], 'Zoom (or wheel)')}
        <b>Battle</b>${row(K('status'), 'Status of the unit under the cursor')}${row(K('threat'), 'Threat map: where foes can strike')}${row(K('speed'), 'Speed x1 / x2 / x4')}${row(K('ffwd'), 'Hold: fast-forward enemy turns')}${row(K('pause'), 'Pause menu')}${row(K('rewind'), 'Rewind to an earlier turn')}${row(K('help'), 'This window')}</div></div>
      <div class="kf">Rebind any key in Options &middot; Controls</div>`;
    w.classList.toggle('show', v);
  }

  // ---- command / ability window ----
  // opts (optional): title -- the plaque text; selId -- the row to open on (the per-unit command memory, player.js),
  // ignored when that row is missing or disabled; onSel(item) -- told whenever the highlighted row changes.
  // audio.js wraps ui.menu as (items, cb) and drops a third argument, so callers may also stage opts in nextMenuOpts.
  menu(items, onPick, opts) { // items: [{label, mp, enabled, id}]
    opts = opts || this.nextMenuOpts || {}; this.nextMenuOpts = null;
    const m = this.el.menu;
    // ROUND-6 (finding 4): the genre command window always carries Move/Act/Wait/Status/Auto-battle
    // (ref06/ref54). Gameplay already passes all five in real turns, but a reduced base list (the
    // capture scenario passes three) rendered a half-empty window. Base command menus — identified
    // by having move/act/wait and no mp rows / Back — are merged to the canonical set; ability
    // submenus stay the caller's list verbatim. The callback contract is unchanged: injected rows
    // carry their canonical ids, which player.decide() already handles.
    const BASE = [['move', 'Move'], ['act', 'Act'], ['wait', 'Wait'], ['status', 'Status'], ['auto', 'Auto-battle']];
    const isAct = items.some((i) => i.mp != null || i.id === 'back');
    if (!isAct && items.some((i) => i.id === 'move' || i.id === 'act' || i.id === 'wait')) {
      const byId = new Map(items.map((i) => [i.id, i]));
      // 'Undo Move' (player.js, after walking) occupies Move's row, as in classic tactics.
      items = [...BASE.map(([id, label]) => byId.get(id) || (id === 'move' && byId.get('undo')) || { label, id }), ...items.filter((i) => !BASE.some(([bid]) => bid === i.id) && i.id !== 'undo')];
    }
    this.menuItems = items; this.menuSel = Math.max(0, items.findIndex((i) => i.enabled !== false)); this.onPick = onPick;
    // after a move the useful next command is Act, not Undo Move (which the old default put under Enter)
    if (items[0]?.id === 'undo') { const ai = items.findIndex((i) => i.id === 'act' && i.enabled !== false); if (ai >= 0) this.menuSel = ai; }
    if (opts.selId != null) { const si = items.findIndex((i) => i.id === opts.selId && i.enabled !== false && i.id !== 'undo'); if (si >= 0) this.menuSel = si; }
    this.onMenuSel = opts.onSel || null;
    this.menuTitle = opts.title || this.titleFor(items, isAct);
    m.innerHTML = `<div class="tab">${esc(this.menuTitle)}</div>` + items.map((it, i) => `<div class="item ${it.enabled === false ? 'dim' : ''} ${i === this.menuSel ? 'sel' : ''}" data-i="${i}">${esc(it.label)}${it.mp ? `<span class="mp">${it.mp} Mp</span>` : ''}</div>`).join('');
    m.style.minWidth = `${Math.max(132, 10 * this.menuTitle.length + 34)}px`; // a long skillset plaque ("Black Magicks") wrapped onto the first row
    m.querySelectorAll('.item').forEach((el) => { el.onmouseenter = () => this.menuMove(+el.dataset.i - this.menuSel); el.onclick = () => this.menuConfirm(); });
    m.classList.remove('show'); void m.offsetWidth; m.classList.add('show'); // restart the ease-in
    if (this.guide) { this._menuHelp = this.helpFor(items[this.menuSel]); this.renderGuide(); }
    try { this.onMenuSel?.(items[this.menuSel]); } catch (e) { console.warn('menu onSel', e); }
  }
  // Window plaque: 'Menu' for the command list, 'Act' for Attack + skillsets, the skillset's own name for its spells.
  titleFor(items, isAct) {
    if (items.some((i) => i.id === 'move' || i.id === 'undo' || i.id === 'wait')) return 'Menu';
    if (items.some((i) => i.id === 'attack' || String(i.id).startsWith('set:'))) return 'Act';
    const u = this.battle?.active || window.__GAME__?.battle?.active; const first = items.find((i) => ABILITIES[i.id]);
    if (u && first) { const cls = (u.secondaryList || []).includes(first.id) ? u.secondary : u.cls; return SKILLSET[cls] || CLASSES[cls]?.name || 'Act'; }
    return isAct ? 'Act' : 'Menu';
  }
  menuMove(d) {
    if (!this.menuItems) return; const n = this.menuSel + d;
    if ((n < 0 || n >= this.menuItems.length) && Math.abs(d) === 1 && !prefs().wrap) return;   // Options > Cursor Wrap off: stop at the ends
    this.menuSel = (n + this.menuItems.length) % this.menuItems.length; this.el.menu.querySelectorAll('.item').forEach((el, i) => el.classList.toggle('sel', i === this.menuSel));
    if (this.guide) { this._menuHelp = this.helpFor(this.menuItems[this.menuSel]); this.renderGuide(); }
    try { this.onMenuSel?.(this.menuItems[this.menuSel]); } catch (e) { console.warn('menu onSel', e); }
  }
  menuConfirm() { const it = this.menuItems?.[this.menuSel]; if (!it || it.enabled === false) return; const cb = this.onPick; this.closeMenu(); cb?.(it); }
  closeMenu() { this.el.menu.classList.remove('show'); this.menuItems = null; this.onPick = null; this.onMenuSel = null; if (this.guide) this.renderGuide(); }

  // ---- forecast: accepts raw html (legacy) or {target, dmg, heal, hit, ability} for the full the genre target card ----
  forecast(arg) {
    const f = this.el.forecast;
    if (!arg) { f.classList.remove('show'); this._fcId = null; if (this.statusExternal) { this.statusExternal = false; this.statusOpen = null; this.el.status.classList.remove('show'); this.renderGuide(); } return; }
    // player.js's Status command hands over a hand-built raw-html sheet; show the real Status window instead.
    if (typeof arg === 'string' && /click to close/.test(arg)) { const u = this.battle?.active || window.__GAME__?.battle?.active; if (u) { f.classList.remove('show'); this._fcId = null; this.openStatus(u, true); return; } }
    if (typeof arg === 'string') { f.classList.add('raw'); f.classList.remove('self'); f.innerHTML = arg; }
    else { f.classList.remove('raw'); this.forecastTarget(arg.target, arg); }
    f.classList.add('show');
  }
  forecastTarget(v, info = {}) {
    this._fcId = v.id; this._fcInfo = info; const f = this.el.forecast;
    // the genre prints the outcome above the readout: "-408Hp 100%" / "Silence 44%"
    const eff = info.dmg ? `<span class="big">-${fmt3(info.dmg)}</span>Hp`
      : info.heal ? `<span class="big up">+${fmt3(info.heal)}</span>Hp`
      : info.ability?.name ? `<span class="ab">${info.effect ? 'Effect: ' : ''}${esc(info.ability.name)}</span>` : '';
    const many = info.victims > 1 ? `<span class="hit">&times;${info.victims}</span>` : '';
    const who = `<div class="who ${v.team === 'B' ? 'enemy' : ''}">${v.team === 'A' ? 'Ally' : 'Enemy'} &middot; ${esc(v.name)}${CLASSES[v.cls].name.toLowerCase() === String(v.name).toLowerCase() ? '' : ' &middot; ' + esc(CLASSES[v.cls].name)}</div>`;
    const head = `<div class="eff">${eff}${info.hit != null ? `<span class="hit">${info.hit}%</span>` : ''}${many}</div>`;
    // Tactical riders the number alone does not say: KO, facing, height, charge time, and the counter it may draw.
    const tags = [];
    if (info.ko) tags.push('<i class="ko">KO</i>');
    if (info.side === 'back') tags.push('<i class="good">Back</i>'); else if (info.side === 'side') tags.push('<i>Side</i>');
    if (info.height >= 2) tags.push('<i class="good">High ground</i>');
    if (info.ct) tags.push(`<i class="ct">Charge ${info.ct}</i>`);
    if (info.status) tags.push(`<i>${esc(info.status)}</i>`);
    if (info.counter) tags.push(`<i class="bad">${esc(info.counter)}</i>`);
    // Move preview (player.js): how many foes could reach and strike this tile on their next turn (the AI's own measure).
    if (info.danger != null) tags.push(info.danger ? `<i class="bad">${info.danger > 1 ? `${info.danger} foes` : '1 foe'} can strike here</i>` : '<i class="good">Out of enemy reach</i>');
    // Friendly fire: the focused target is an ally, or (area / shaped spells) the footprint also catches allies --
    // the plate only ever described the unit under the cursor, so a Fire that would scorch your own Wyrmlancer said nothing.
    const actor = this.battle?.active;
    if (actor && info.ability && (info.dmg > 0 || info.ability.kind === 'mag' || info.ability.kind === 'phys') && !info.effect) {
      let mates = v !== actor && v.team === actor.team ? 1 : 0;
      try {
        const b = this.battle, c = window.__GAME__?.player?.cursor;
        if (c && info.victims > 1 && b?.engine?.victims) mates = b.engine.victims(actor, info.ability, c, { units: b.units }).filter((o) => o !== actor && o.team === actor.team).length;
      } catch (e) { /* forecast helpers are best-effort */ }
      if (mates) tags.unshift(`<i class="ko">${mates > 1 ? `Hits ${mates} allies!` : 'Hits an ally!'}</i>`);
    }
    const tagHtml = tags.length ? `<div class="tags">${tags.join('')}</div>` : '';
    // ROUND-4 REGRESSION (integrator): the same unit was printed TWICE in one frame -- portrait and
    // Hp/Mp/Ct block bottom-left as the actor, and the identical portrait and Hp/Mp/Ct block
    // bottom-right as the forecast subject. It happens whenever the forecast's subject IS the acting
    // unit: a counter or reaction that comes back at the actor, or a self-cast. the genre prints one window
    // per unit, never the same face in both corners; when they collide we keep the caster card whole
    // and collapse the mirrored card to the effect line, which is the part the caster card cannot say.
    const dup = this.el['unit-card'].classList.contains('show') && this.el['unit-card'].dataset.id === v.id;
    f.classList.toggle('self', dup);
    f.innerHTML = dup ? `${head}${tagHtml}${who}` : `${head}${tagHtml}${who}
      ${this.bar('Hp', v.hp, v.maxHp, v.hp / v.maxHp < 0.25 ? 'hp low' : 'hp')}
      ${this.bar('Mp', v.mp, v.maxMp, 'mp')}
      ${this.bar('Ct', v.ct, 100, 'ct')}
      ${this.portraitDiv(v)}`;
    fitText(f.querySelector('.who'), { min: 0.7 });
  }

  popup(worldPos, text, kind) {
    const el = document.createElement('div'); el.className = 'popup ' + (kind || ''); el.textContent = kind === 'miss' && /^miss$/i.test(text) ? 'Missed!' : text;
    this.root.appendChild(el); this.popups.push({ el, pos: worldPos.clone(), t: 0 }); setTimeout(() => { el.remove(); this.popups = this.popups.filter((p) => p.el !== el); }, 1100);
  }
  // team === null is a DRAW: both sides wiped in one resolution (a charged blast that took its own caster
  // out alongside the last enemy). It used to arrive here as 'B' and read as a Defeat the player had not had.
  victory(team, info = {}) { const t = this.el.title; t.classList.toggle('victory', team === 'A');
    const head = team === 'A' ? 'Victory' : team === 'B' ? 'Defeat' : 'Draw';
    let sub = team === 'A' ? 'THE FIELD IS OURS' : team === 'B' ? 'THE LINE HAS BROKEN' : 'NO ONE HOLDS THE FIELD';
    if (info.fallen) sub = `${String(info.fallen).toUpperCase()} HAS FALLEN`;
    this.showObjective(false); this.el.banner.classList.remove('show');
    t.innerHTML = `${head}<small>${sub}</small>`; clearTimeout(this._tt); t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); }
  title(main, sub, ms = 2200) { const t = this.el.title; t.classList.remove('victory'); t.innerHTML = `${esc(main)}<small>${esc(sub)}</small>`; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), ms); }

  // A bottom window turns see-through while the acting unit or the tile cursor sits behind it (the party often
  // deploys along the bottom edge, under the status card): the genre slides its windows away; we let the field show through.
  peek(b) {
    const G = window.__GAME__; if (!G || !b) return; const cam = this.getCamera(); const r = this.getRenderer(); const w = r.domElement.clientWidth, h = r.domElement.clientHeight;
    const pts = []; const v = new THREE.Vector3();
    const u = b.active; const s = u && b.spriteOf?.(u);
    if (s?.root) { v.copy(s.root.position); v.y += 0.6; v.project(cam); pts.push([(v.x + 1) / 2 * w, (1 - v.y) / 2 * h]); }
    const c = G.overlay?.cursor; if (c?.visible) { v.copy(c.position); v.project(cam); pts.push([(v.x + 1) / 2 * w, (1 - v.y) / 2 * h]); }
    for (const el of [this.el['unit-card'], this.el.forecast, this.el.announce]) {
      if (!el.classList.contains('show') || el.classList.contains('raw')) { el.classList.remove('peek'); continue; }
      const R = el.getBoundingClientRect(); const hit = pts.some(([x, y]) => x > R.left - 8 && x < R.right + 8 && y > R.top - 20 && y < R.bottom);
      el.classList.toggle('peek', hit);
    }
  }
  // R18 (review17 R4): the help line (#announce, top centre) used to run over the boss mechanic plate (.sg-hint, top left,
  // src/campaign/stage/director.js) while moving / aiming. When the plate is up beside it, the help line re-centres in
  // the space to the plate's right (and wraps narrower), so both stay whole.
  yieldAnnounce() {
    const a = this.el.announce; const hEl = document.querySelector('.sg-hint'); let want = '';
    if (a.classList.contains('show') && hEl && hEl.style.opacity !== '0' && !document.body.classList.contains('k-cine')) {
      const hr = hEl.getBoundingClientRect(); const ar = a.getBoundingClientRect();
      if (hr.width && ar.height && ar.top < hr.bottom + 6 && ar.bottom > hr.top - 6) {
        const z = parseFloat(getComputedStyle(this.root).zoom) || 1; const l = hr.right + 12, avail = innerWidth - l - 16;
        want = `${Math.round((l + avail / 2) / z)}|${Math.round(avail / z)}`;
      }
    }
    if (want === (this._yield || '')) return; this._yield = want;
    if (!want) { a.style.left = ''; a.style.maxWidth = ''; return; }
    const [c, w] = want.split('|'); a.style.left = `${c}px`; a.style.maxWidth = `min(680px, ${w}px)`;
  }
  update() {
    const b = this.battle || window.__GAME__?.battle;
    if (b && !this._bound && b.on) this.bind(b); // self-arm the bus listeners (forecast) without touching main.js
    if (this.guide) { if (this.guideSig() !== this._gsig) this.renderGuide(); if ((++this._frame & 3) === 0) { this.peek(b); this.yieldAnnounce(); } }
    // R15 (integrator): while a big-spell cinematic plays (src/vfx/cine.js sets window.__CINE__.cine.e) the HUD windows
    // fade out fully with a short ease (ui.css #ui.cine; R18: to 0, was ~20%) so the spell owns the screen, and come back after.
    { const c = !!window.__CINE__?.cine?.e; if (c !== this._cine) { this._cine = c; this.root.classList.toggle('cine', c); document.body.classList.toggle('k-cine', c); } }
    // R15 (review15 P8): while a tile field is up (move / aim / facing) the Field Manual folds to its plaque (kit.css)
    { const P = window.__GAME__?.player; const pk = !!(P?.pick || P?.facingFn) && !window.__CAMPAIGN__?.deploying; if (pk !== this._picking) { this._picking = pk; document.body.classList.toggle('k-picking', pk); } }
    if (!this.popups.length) return; const cam = this.getCamera(); const r = this.getRenderer(); const w = r.domElement.clientWidth, h = r.domElement.clientHeight; const v = new THREE.Vector3();
    const z = parseFloat(getComputedStyle(this.root).zoom) || 1; // #ui is zoomed x1.5 on large screens (ui.css)
    for (const p of this.popups) { v.copy(p.pos).project(cam); p.el.style.left = ((v.x + 1) / 2 * w / z) + 'px'; p.el.style.top = ((1 - v.y) / 2 * h / z) + 'px'; }
  }
}
