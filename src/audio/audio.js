// Audio owner module (round 8). PUBLIC CONTRACT
//
// Campaign scenes (usable on ANY page, with or without a battle — import('./audio/audio.js') then setScene('title')):
//   setScene(name, opts?)   name ∈ 'title' | 'worldmap' | 'story' | 'formation' | 'battle' | 'results' | 'defeat'.
//       Crossfades (~1 s) to that scene's music. Idempotent (same scene again = no-op while it is playing). Safe
//       before any user gesture: the request is queued and the first click / key / touch anywhere starts it.
//       opts.mood for 'story': 'sad' (default) | 'tense'  (also accepted as setScene('story:tense') or
//       setScene('story', 'tense')). 'results' / 'defeat' right after a battle skip their own jingle and start
//       the loop when the battle's victory fanfare / defeat cue ends, so the two never double up.
//   uiSfx(name)             name ∈ 'cursor' | 'confirm' | 'cancel' | 'error' | 'open' | 'close' | 'save' |
//       'levelup' | 'jpgain' | 'recruit'. Returns true if it sounded (false before the first gesture).
//   setVolumes({ music, sfx }) / getVolumes()   0..1, persisted to localStorage 'cinderbanner.audio'.
//   getScene()              the requested scene name (or null).
//
// Battle (unchanged from round 7):
//   init(ctx) / initAudio(battle, opts?) — subscribes the battle bus (turnStart/moveStart/abilityStart/impact/
//     damage/ko/victory + charge/miss/reaction/knockback/status/raise/crystal/countdown) to SFX placed by the
//     unit's screen position, and drives the battle music's intensity. Idempotent per battle; called with a NEW
//     battle it moves the subscriptions over. If no scene was ever requested, init() selects 'battle' (the
//     standalone battle page behaves exactly as before).
//   audioControls — { setMaster, setMusic, setSfx, toggle } (setMusic/setSfx also persist).
//   window.__AUDIO__ — probe handle ({ ensure, play, engine, seq, offline, wav, setScene, uiSfx, ... }).
//
// Round 14 — Chapter II ("The Hollow Crown", src/audio/northreach.js). Selection needs no edits elsewhere:
//   setScene('worldmap', { region: 'north' | 'south' })  explicit; otherwise the region is read from the save exactly like
//       the map screen does it (min(save.chapter, region of save.at)), so Chapter II / a walk across the Greyspine road
//       (the screen re-calls setScene('worldmap') after moving the banner) crossfades to "The Northreach".
//   battle flavour: the campaign node (window.__CAMPAIGN__.node, else data.js NODE[?slot]) -> Chapter I node: the
//       Chapter I score, untouched; Chapter II final node: 'final'; a node with a boss entry or a leader objective:
//       'boss'; any other Chapter II node: 'ch2'. No node: a Chapter-II-only ?map= picks 'ch2' ('final' for the final
//       node's map); else Chapter I. Overrides: setScene('battle', { flavour }) or ?music=ch1|ch2|boss|final.
//   The victory cue after a 'final' battle is "The Bell Falls Silent" instead of the fanfare.
//
// Implementation: ONE AudioContext/Engine per page. Each scene's music plays on its own Engine "deck" (own section
// chains + fader) so a scene change is a real crossfade; the victory/defeat cue gets its own deck; UI stingers use
// a deck routed into the SFX bus (orchestral instruments that follow the SFX volume).
//
// Battle music (score.js): "Evenfall Vigil" (somber, default) and the tense rotation "Crossing at Hearthmoor" <->
// "Oath Beneath the Banner"; the Sequencer switches on bar lines from battle heat with hysteresis + an 8-bar hold.
// Campaign music (themes.js): title "Cinderbanner", world map "Roads of the Southmarch", story "Quiet Words" /
// "Under the Surface", formation "Rest at the Waystone", results "After the Field", defeat "Ashes".
import { Engine } from './synth.js';
import { scheduleBar, scheduleSomber, scheduleHeroic, scheduleTense, fanfare, defeat, BAR } from './score.js';
import { makeTheme, ScenePlayer, renderThemeInto, STINGERS } from './themes.js';
import * as FOUNDRY from './foundry.js';
import { FLAVOURS, northTheme, finalVictory } from './northreach.js';
import { NODE, TOWNS, ROADS, BATTLES, chOf } from '../campaign/data.js';
const SCHED = { somber: scheduleSomber, tense: scheduleTense, march: scheduleBar, heroic: scheduleHeroic };

const IMPACT = {
  slash: 'slash', bash: 'blunt', stone: 'blunt', shuriken: 'slash', arrow: 'arrowHit', jump: 'blunt',
  fire: 'fire', ice: 'ice', thunder: 'bolt', quake: 'quake', holy: 'holy', cure: 'cure', buff: 'buff', debuff: 'debuff',
};
const DUCK = {
  slash: [0.35, 0.25], blunt: [0.4, 0.3], arrowHit: [0.3, 0.2], fire: [0.6, 0.7], ice: [0.55, 0.7], bolt: [0.65, 0.6],
  quake: [0.65, 0.9], holy: [0.6, 1.0], cure: [0.4, 0.6], buff: [0.35, 0.5], debuff: [0.35, 0.5], ko: [0.5, 0.9],
  crystal: [0.45, 1.2], raise: [0.45, 1.0], parry: [0.3, 0.2],
};
// How hard each event pushes the musical intensity up (0..1 target, whichever is higher wins).
const HEAT = { abilityStart: 0.72, impact: 0.9, damage: 0.85, ko: 1, crystal: 1, victory: 1, moveStart: 0.55, turnStart: 0.5 };
const GOOD_STATUS = new Set(['focus', 'protect', 'shell', 'haste', 'regen', 'reraise', 'defend']);
const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : 0));

// Theme switching: >= TENSE_IN -> tense march; <= SOMBER_IN (and calm) -> somber vigil; between -> stay.
const TENSE_IN = 0.62, SOMBER_IN = 0.46, THEME_HOLD_BARS = 8;

// ---- levels (persisted: music + sfx) --------------------------------------------------------------------------
const STORE_KEY = 'cinderbanner.audio';
const LEVELS = { master: 1, music: 1, sfx: 1, muted: false };
try { const j = JSON.parse(globalThis.localStorage?.getItem(STORE_KEY) || 'null'); if (j && typeof j === 'object') { if (j.music != null) LEVELS.music = clamp01(j.music); if (j.sfx != null) LEVELS.sfx = clamp01(j.sfx); } } catch { /* storage blocked: defaults */ }
const persist = () => { try { globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify({ music: LEVELS.music, sfx: LEVELS.sfx })); } catch { /* storage blocked */ } };

// Module-level state so the API works before init/gesture, and probes can reach the live engine.
let ENGINE = null, SEQ = null, ROOT = null, AC_FAILED = false;

export const audioControls = {
  setMaster(v) { LEVELS.master = clamp01(v); ENGINE?.setMaster(LEVELS.master); return LEVELS.master; },
  setMusic(v) { LEVELS.music = clamp01(v); ENGINE?.setMusic(LEVELS.music); persist(); return LEVELS.music; },
  setSfx(v) { LEVELS.sfx = clamp01(v); ENGINE?.setSfx(LEVELS.sfx); persist(); return LEVELS.sfx; },
  toggle(m) {
    LEVELS.muted = m == null ? !LEVELS.muted : !!m;
    if (ENGINE) ENGINE.setMuted(LEVELS.muted);
    return LEVELS.muted;
  },
  get levels() { return { ...LEVELS }; },
};
export function setVolumes({ music, sfx } = {}) {
  if (music != null) { LEVELS.music = clamp01(music); ENGINE?.setMusic(LEVELS.music); }
  if (sfx != null) { LEVELS.sfx = clamp01(sfx); ENGINE?.setSfx(LEVELS.sfx); }
  persist(); return getVolumes();
}
export function getVolumes() { return { music: LEVELS.music, sfx: LEVELS.sfx }; }

export class Sequencer { // schedules one bar at a time, a little ahead of the clock, choosing the theme per bar
  // flavour: null = the Chapter I score (SCHED, 2 s bars); else a FLAVOURS key (own schedulers and bar length)
  constructor(engine, flavour = null) {
    this.e = engine; this.bar = 0; this.next = 0; this.timer = null; this.playing = false;
    this.flavour = FLAVOURS[flavour] ? flavour : null; this.F = FLAVOURS[flavour] || null; this.barLen = this.F?.bar ?? BAR;
    this.level = 1; this.intensity = 1; this.target = 1;
    this.theme = 'somber'; this.hold = 0; this.calm = true;
  }
  start(at = this.e.now() + 0.06) {
    this.stop(); this.playing = true; this.next = at; this.bar = 0; this.theme = 'somber'; this.hold = 0;
    this.e.music.gain.cancelScheduledValues(at); this.e.music.gain.setValueAtTime(1, at);
    this.tick(); this.timer = setInterval(() => this.tick(), 150);
  }
  setIntensity(v) { this.target = Math.max(0, Math.min(1, v)); }
  sched(theme) { return (this.F && this.F[theme]) || SCHED[theme]; }
  // Pure theme decision (also used by renderInto): hysteresis + minimum hold prevent flapping at the seams.
  pickTheme(target) {
    if (this.hold > 0) return this.theme;
    if (target >= TENSE_IN) return 'tense';
    if (target <= SOMBER_IN && this.calm) return 'somber';
    return this.theme;
  }
  scheduleOne(bar, t0, intensity) {
    const before = this.theme;
    this.theme = this.pickTheme(intensity);
    if (this.theme !== before) this.hold = THEME_HOLD_BARS; // a switch locks the new theme in for the phrase
    this.hold = Math.max(0, this.hold - 1);
    this.sched(this.theme)(this.e, bar, t0, { level: this.level, intensity });
    return this.theme;
  }
  tick() {
    if (!this.playing) return;
    const now = this.e.now();
    // If the tab was backgrounded the timer is throttled and `next` can fall far behind; resync to the grid
    // rather than dumping a burst of overdue bars into the graph all at once.
    if (this.next < now - 0.05) { const skipped = Math.ceil((now - this.next) / this.barLen); this.bar += skipped; this.next += skipped * this.barLen; }
    while (this.playing && this.next - now < 1.6) {
      // ease toward the target once per scheduled bar: layers arrive/leave on bar lines
      this.intensity += (this.target - this.intensity) * (this.target > this.intensity ? 0.6 : 0.22);
      this.scheduleOne(this.bar++, this.next, this.intensity);
      this.next += this.barLen;
    }
  }
  stop(fade = 0) {
    if (this.timer) clearInterval(this.timer); this.timer = null; this.playing = false;
    if (fade > 0) { const t = this.e.now(); this.e.music.gain.cancelScheduledValues(t); this.e.music.gain.setTargetAtTime(0.0001, t, fade / 3); }
  }
  // offline: lay down `seconds` of score from `t0`; theme = null lets heat pick (bounce demo), else forced.
  // On an OfflineAudioContext the bars are laid down INCREMENTALLY with suspend()/resume(), 1.6 s ahead of the
  // render clock exactly like the live timer does — so an offline bounce measures the same graph density (and
  // exercises the same voice budget) a player's machine sees, instead of thousands of pending nodes at once.
  renderInto(t0, seconds, intensity, theme = null) {
    this.hold = 0; const bars = []; for (let b = 0, t = t0; t < t0 + seconds; b++, t += this.barLen) bars.push([b, t]);
    const doBar = ([b, t]) => {
      const iv = intensity ? intensity(b) : this.intensity;
      this.target = iv;
      if (theme) { this.theme = theme; this.sched(theme)(this.e, b, t, { level: this.level, intensity: iv }); }
      else this.scheduleOne(b, t, iv);
    };
    const ac = this.e.ac;
    if (!(globalThis.OfflineAudioContext && ac instanceof OfflineAudioContext)) { bars.forEach(doBar); return; }
    const q = 128 / ac.sampleRate, end = ac.length / ac.sampleRate; let i = 0;
    const pump = () => {
      const now = ac.currentTime;
      while (i < bars.length && bars[i][1] - now < 1.6) doBar(bars[i++]);
      if (i < bars.length) { const at = Math.max(now + q, Math.ceil((bars[i][1] - 1.6) / q) * q); if (at < end - q) return ac.suspend(at).then(() => { pump(); ac.resume(); }); }
      return null;
    };
    pump();
  }
}

// A scripted demo of every effect, used by the bounce so the critic can hear SFX + ducking against the score.
export function demoSfx(e, seq, t0 = 0) {
  const s = (name, t, ...a) => { e[name](t0 + t, ...a); const d = DUCK[name]; if (d) e.duck(d[0], d[1], t0 + t); };
  s('turnPing', 0.3); s('clockTick', 0.65, 3); s('clockTick', 0.9, 1);
  s('menuOpen', 1.0); s('cursor', 1.3); s('cursor', 1.5); s('cursor', 1.7); s('confirm', 2.0);
  ['g', 'g', 'd', 'd', 's', 's', 'b', 'w'].forEach((k, i) => s('footstep', 2.5 + i * 0.22, k));
  s('cancel', 4.5); s('menuOpen', 4.8); s('confirm', 5.2); s('whoosh', 5.55); s('slash', 5.7); s('hit', 5.75, 0.7);
  s('miss', 6.6); s('parry', 6.9); s('blunt', 7.2); s('arrowFly', 8.3); s('arrowHit', 8.55);
  s('chargeStart', 9.4); s('fire', 10.2); s('ice', 12.2); s('bolt', 14.2); s('quake', 15.4); s('holy', 17.0);
  s('cure', 18.6); s('buff', 19.6); s('statusTick', 19.9, false); s('debuff', 20.2); s('ko', 20.9); s('crystal', 21.7);
  s('turnPing', 23.4, true); s('hit', 23.9, 0.35); s('hit', 24.4, 1.1); s('healTick', 25.0); s('statusEnd', 25.5);
}

// Generate the foundry's sample bank in small idle slices after the first gesture so no scheduling tick ever
// pays for a cold buffer (each buffer is 0.3-3 ms of JS; one per slice).
export function prewarmTasks(ac) {
  const T = [];
  // order = first needed: harp (every theme), pizz + glock (world map / formation), timpani, then the battle
  // score (spiccato, snare, cymbals), then SFX
  for (let m = 48; m <= 105; m += 3) T.push(() => FOUNDRY.harp(ac, m));
  for (const m of [36, 38, 39, 40, 41, 43, 45, 46]) T.push(() => FOUNDRY.pizz(ac, m));
  for (let m = 72; m <= 99; m += 3) T.push(() => FOUNDRY.glock(ac, m));
  for (const m of [36, 38, 40, 41, 43, 45, 46]) T.push(() => FOUNDRY.timpani(ac, m, 0));
  for (let m = 53; m <= 70; m++) T.push(() => FOUNDRY.pizz(ac, m));
  for (let m = 48; m <= 90; m += 3) T.push(() => FOUNDRY.spicc(ac, m, 0.16, 0), () => FOUNDRY.spicc(ac, m, 0.16, 1), () => FOUNDRY.spicc(ac, m, 0.09, 0), () => FOUNDRY.spicc(ac, m, 0.09, 1));
  for (let v = 0; v < 4; v++) T.push(() => FOUNDRY.snare(ac, v));
  T.push(() => FOUNDRY.crash(ac, 0), () => FOUNDRY.crash(ac, 1), () => FOUNDRY.sizzle(ac, 0), () => FOUNDRY.sizzle(ac, 1), () => FOUNDRY.sizzle(ac, 2), () => FOUNDRY.bassDrum(ac), () => FOUNDRY.crackle(ac, 0), () => FOUNDRY.crackle(ac, 1), () => FOUNDRY.debris(ac), () => FOUNDRY.shards(ac));
  return T;
}
// Chapter II voices (bells, celesta), queued AHEAD of the rest of the bank when a Chapter II piece starts.
export function prewarmNorth(ac) {
  const T = [];
  for (const m of [48, 51, 54, 57]) T.push(() => FOUNDRY.bell(ac, m, 1));
  for (let m = 51; m <= 78; m += 3) T.push(() => FOUNDRY.bell(ac, m, 0));
  for (let m = 72; m <= 96; m += 3) T.push(() => FOUNDRY.celesta(ac, m));
  for (const m of [37, 39, 43, 44, 46]) T.push(() => FOUNDRY.timpani(ac, m, 0));
  return T;
}
// Live: foundry deferral is on, so each task below only QUEUES its buffer; foundry's own pump builds the queue in
// <= 6 ms setTimeout slices (anything the first bars already asked for is at the head of the queue).
function prewarm(ac) { try { for (const t of prewarmTasks(ac)) t(); } catch (err) { console.warn('audio prewarm', err); } }
// The FIRST bar of a scene may build its cold buffers inline (capped at 18 ms of JS), so the opening notes are not
// skipped while the background pump catches up; anything past the cap is queued as usual.
const inline = (fn) => FOUNDRY.inlineFor(18, fn);
// A Chapter II piece opens on a bell toll: its first bar may spend a little more (the long bell buffers, ~5-12 ms each).
const inlineNorth = (fn) => FOUNDRY.inlineFor(45, fn);

// ---- Chapter II selection (see header) ----
const qparam = (k) => { try { return new URLSearchParams(globalThis.location?.search || '').get(k); } catch { return null; } };
const FINAL_MAPS = new Set(BATTLES.filter((b) => chOf(b) >= 2 && b.final).map((b) => b.map));
const CH1_MAPS = new Set(BATTLES.filter((b) => chOf(b) < 2).map((b) => b.map));
const CH2_ONLY_MAPS = new Set(BATTLES.filter((b) => chOf(b) >= 2 && !CH1_MAPS.has(b.map)).map((b) => b.map));
const isBossNode = (b) => b?.objective?.leader != null || (Array.isArray(b?.enemies) && b.enemies.some((x) => Array.isArray(x) && x[3] && typeof x[3] === 'object'));
export function nodeFlavour(b) { if (!b || chOf(b) < 2) return null; if (b.final) return 'final'; return isBossNode(b) ? 'boss' : 'ch2'; }
function campaignNode() {
  try { const n = globalThis.window?.__CAMPAIGN__?.node; if (n && typeof n === 'object') return n; } catch { /* no campaign */ }
  const slot = qparam('slot'); return slot && NODE[slot] ? NODE[slot] : null;
}
export function battleFlavour(opts = {}) {
  const f = opts.flavour || qparam('music');
  if (f === 'ch1') return null; if (f && FLAVOURS[f]) return f;
  const node = campaignNode(); if (node) return nodeFlavour(node);
  const map = qparam('map'); if (map && FINAL_MAPS.has(map) && CH2_ONLY_MAPS.has(map)) return 'final';
  return map && CH2_ONLY_MAPS.has(map) ? 'ch2' : null;
}
const regionOfId = (id) => { const n = NODE[id] || TOWNS.find((t) => t.id === id) || ROADS.find((r) => r.id === id); return n ? chOf(n) : 1; };
export function worldRegion(opts = {}) {
  const r = opts.region; if (r === 'north' || r === 2 || r === '2') return 'north'; if (r === 'south' || r === 1 || r === '1') return 'south';
  try {
    const sv = JSON.parse(globalThis.localStorage?.getItem('cinderbanner.save.v1') || 'null');
    if (sv && typeof sv === 'object') return Math.min(Math.max(1, Math.floor(+sv.chapter || 1)), regionOfId(sv.at)) >= 2 ? 'north' : 'south';
  } catch { /* no storage / bad save: the Chapter I map */ }
  return 'south';
}

// =============================================================================================================
// SCENE DIRECTOR
const SCENES = new Set(['title', 'worldmap', 'story', 'formation', 'battle', 'results', 'defeat']);
const UI_SYNTH = { cursor: 'cursor', confirm: 'confirm', cancel: 'cancel', error: 'errorBuzz', open: 'menuOpen', close: 'menuClose' };
const UI_DUCK = { levelup: [0.5, 1.2], recruit: [0.5, 1.5], save: [0.25, 0.6], jpgain: [0.15, 0.3] };
let SCENE = null, SCENE_OPTS = {}, EXPLICIT = false;   // requested scene (may be queued until the AudioContext runs)
let ACTIVE = null;                                     // { key, name, deck, player | seq, t }
let CUE = null;                                        // { deck, start, end, kind } battle victory/defeat cue
let SFXD = null;                                       // stinger deck -> sfx bus
let BATTLE_HEAT = 0.5;                                 // intensity a fresh battle sequencer starts from
let BOUND = null;                                      // the battle binding (initAudio)
const warned = new Set(); const warnOnce = (k, msg) => { if (!warned.has(k)) { warned.add(k); console.warn(msg); } };
const gestureActive = () => !!globalThis.navigator?.userActivation?.isActive;

function ensureEngine() {
  if (ENGINE) { if (ENGINE.ac.state === 'suspended') ENGINE.ac.resume().catch(() => {}); return ENGINE; }
  if (AC_FAILED) return null;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) { AC_FAILED = true; return null; }
  try {
    const ac = new AC({ latencyHint: 'interactive' });
    FOUNDRY.setDeferred(true); const e = new Engine(ac);
    e.setMaster(LEVELS.master); e.setMusic(LEVELS.music); e.setSfx(LEVELS.sfx); e.setMuted(LEVELS.muted);
    ENGINE = e; SFXD = e.deck(e.sfx);
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    if (SCENE) startScene(SCENE, SCENE_OPTS);
    prewarm(ac);
  } catch (err) { AC_FAILED = true; console.warn('audio init failed', err); }
  return ENGINE;
}
// resolve a request into what will actually play: Chapter I keys are unchanged ('battle', 'worldmap', 'story:sad' ...)
function resolveScene(name, o) {
  if (name === 'battle') { const flavour = battleFlavour(o); return { key: flavour ? 'battle:' + flavour : 'battle', flavour }; }
  if (name === 'worldmap') { const north = worldRegion(o) === 'north'; return { key: north ? 'worldmap:north' : 'worldmap', north }; }
  return { key: name + (name === 'story' ? ':' + (o.mood === 'tense' ? 'tense' : 'sad') : '') };
}
const isPlaying = (a) => !!(a && (a.player?.playing || a.seq?.playing));

function retire(a, fade = 1.1) {
  if (!a || !ENGINE) return;
  a.player?.stop(); a.seq?.stop(); if (a.seq && SEQ === a.seq) SEQ = null;
  const t = ENGINE.now(); const g = a.deck.fader.gain;
  if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
  g.setTargetAtTime(0.0001, t, fade / 4);
  // everything the retired deck already scheduled (<= one bar + 1.6 s lookahead) plays into a closed fader, then
  // the deck's section chains are stopped and disconnected
  setTimeout(() => a.deck.dispose(), (fade + 7) * 1000);
}

function startScene(name, opts = {}, force = false) {
  const e = ENGINE; if (!e) return;
  const R = resolveScene(name, opts); const key = R.key;
  if (!force && ACTIVE && ACTIVE.key === key && isPlaying(ACTIVE)) return;
  if (R.flavour || R.north) { try { for (const t of prewarmNorth(e.ac)) t(); } catch (err) { console.warn('audio prewarm', err); } }
  const inl = R.flavour || R.north ? inlineNorth : inline;
  const now = e.now(); const had = isPlaying(ACTIVE);
  if (ACTIVE) retire(ACTIVE, 1.1);
  let at = now + (had ? 0.5 : 0.08), o = opts;
  const after = name === 'results' || name === 'defeat';
  if (CUE && after && now < CUE.end + 4) { at = Math.max(at, CUE.end - 0.25); o = { ...opts, skipIntro: true }; }
  else if (CUE) { retire(CUE, 0.8); CUE = null; }
  const deck = e.deck();
  if (name === 'battle') {
    const seq = new Sequencer(deck, R.flavour); seq.intensity = seq.target = BATTLE_HEAT;
    inl(() => seq.start(at)); SEQ = seq; ACTIVE = { key, name, deck, seq, t: now, flavour: R.flavour };
  } else {
    const th = R.north ? northTheme() : makeTheme(name, o); const p = new ScenePlayer(deck, th);
    p.start(at, { inline: inl }); ACTIVE = { key, name, deck, player: p, t: now };
  }
}
// The battle's own end cues (victory fanfare / defeat) on a dedicated deck, so the following results/defeat scene
// can let them finish instead of cutting them in a crossfade.
function playCue(kind) {
  const e = ENGINE; if (!e) return;
  if (ACTIVE && (ACTIVE.name === 'results' || ACTIVE.name === 'defeat') && e.now() - ACTIVE.t < 2) return; // shell already moved on
  SEQ?.stop(0.35);
  if (CUE) retire(CUE, 0.3);
  const fin = kind === 'victory' && (ACTIVE?.flavour ?? battleFlavour()) === 'final';
  const d = e.deck(); const t = e.now() + 0.45; const dur = (fin ? finalVictory : kind === 'victory' ? fanfare : defeat)(d, t);
  CUE = { deck: d, start: t, end: t + dur, kind };
}

let ARMED = false;
function arm() {
  if (ARMED || typeof window === 'undefined') return; ARMED = true;
  const go = () => { ensureEngine(); };
  for (const ev of ['pointerdown', 'keydown', 'click', 'touchend']) window.addEventListener(ev, go, { capture: true, passive: true });
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'm' && ev.key !== 'M') return;
    const tg = ev.target; if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName || ''))) return;
    const muted = audioControls.toggle(); BOUND?.ui?.announce?.(muted ? 'Sound off' : 'Sound on');
  });
  const cancelKeys = new Set(['Escape', 'Backspace', 'x', 'X']);
  window.addEventListener('keydown', (ev) => { if (cancelKeys.has(ev.key) && BOUND?.player?.cancel) playNow('cancel'); }, true);
  window.__AUDIO_DIRECTOR__ = { setScene, uiSfx, getScene, getVolumes, setVolumes, state: () => ({ scene: SCENE, active: ACTIVE?.key ?? null, flavour: ACTIVE?.flavour ?? null, playing: isPlaying(ACTIVE), ctx: ENGINE?.ac.state ?? 'none', cue: CUE ? { kind: CUE.kind, end: CUE.end } : null, t: ENGINE?.now() ?? 0 }) };
}

export function setScene(name, opts = {}) {
  if (typeof opts === 'string') opts = { mood: opts };
  const [nm, mood] = String(name).split(':');
  if (!SCENES.has(nm)) { warnOnce('scene:' + name, `audio: unknown scene "${name}"`); return false; }
  const o = { ...(opts || {}) }; if (mood) o.mood = mood;
  SCENE = nm; SCENE_OPTS = o; EXPLICIT = true; arm();
  // Try to start right away: inside a gesture this is allowed; outside one (e.g. a page reached by navigating
  // within the site) Chrome may still allow it — if not, the context waits suspended and the first gesture resumes it.
  if (!ENGINE) ensureEngine(); else startScene(nm, o);
  return true;
}
export function getScene() { return SCENE; }

let lastCursor = -1;
function playNow(name, ...a) { const e = ENGINE; if (!e) return; const t = e.now() + 0.01; e[name]?.(t, ...a); const d = DUCK[name]; if (d) e.duck(d[0], d[1], t); }
export function uiSfx(name) {
  arm();
  if (!ENGINE && gestureActive()) ensureEngine();
  const e = ENGINE; if (!e || e.ac.state === 'closed') return false;
  const t = e.now() + 0.01;
  if (UI_SYNTH[name]) {
    if (name === 'cursor') { if (t - lastCursor < 0.03) return true; lastCursor = t; }
    e[UI_SYNTH[name]](t); return true;
  }
  const st = STINGERS[name];
  if (!st) { warnOnce('sfx:' + name, `audio: unknown uiSfx "${name}"`); return false; }
  const dur = st(SFXD, t); const dk = UI_DUCK[name]; if (dk) e.duck(dk[0], Math.min(dk[1], dur), t);
  return true;
}

export function initAudio(battle, opts = {}) {
  if (!battle) return ROOT;
  if (ROOT && ROOT.battle === battle) return ROOT;     // idempotent: glob init(ctx) + explicit wiring cannot double-subscribe
  if (ROOT) ROOT.unbind();                              // a new battle on the same page: move the subscriptions over
  if (!(globalThis.AudioContext || globalThis.webkitAudioContext)) return null;
  arm();
  const ui = opts.ui || battle.ui, overlay = opts.overlay || battle.overlay;
  const player = opts.player, canvas = opts.canvas;
  const listeners = [];
  BOUND = { battle, ui, player };

  const play = playNow;
  // ---- screen placement: project the actor's world tile to NDC x -> pan; edge sources sit a touch quieter.
  //      "if available": no camera / no worldPos / projection failure -> null -> centered playback.
  const placeOf = (u) => {
    try {
      const cam = battle.camera?.cam;
      if (!u || u.x == null || !cam) return null;
      const v = battle.worldPos(u.x, u.z, 1.15);
      v.project(cam);
      if (!Number.isFinite(v.x)) return null;
      const x = Math.max(-1, Math.min(1, v.x));
      return { pan: x * 0.8, gain: 1 - 0.2 * Math.abs(x) };
    } catch { return null; }
  };
  const playAt = (name, u, ...a) => {
    const engine = ENGINE; if (!engine) return;
    const t = engine.now() + 0.01;
    engine.at(placeOf(u), () => { engine[name]?.(t, ...a); });
    const d = DUCK[name]; if (d) engine.duck(d[0], d[1], t);
  };

  // ---- musical intensity: a heat value that events push up and time pulls back down ----
  // `blood` is sticky: turnStart recomputes `floor` from the alive count, which may not drop on a KO (rules
  // keep ko'd bodies in the unit list), so without this the somber->tense calm gate could reopen mid-battle.
  let heat = 0.45, floor = 0.42, heatRaf = 0, blood = false;
  const bump = (v) => { heat = Math.max(heat, v); };
  const heatTick = () => {
    heat += (floor - heat) * 0.012;                       // ~4 s glide back to the floor
    BATTLE_HEAT = Math.max(floor, Math.min(1, heat));
    if (SEQ) { SEQ.setIntensity(BATTLE_HEAT); SEQ.calm = !blood && floor <= SOMBER_IN; }
    heatRaf = requestAnimationFrame(heatTick);
  };
  heatRaf = requestAnimationFrame(heatTick);

  // ---- battle bus (required set: turnStart/moveStart/abilityStart/impact/damage/ko/victory; extras below) ----
  const on = (evt, fn) => listeners.push(battle.on(evt, fn));
  const alive = () => battle.units?.filter?.((u) => !u.dead && !u.removed).length ?? 10;
  on('turnStart', ({ unit }) => { playAt('turnPing', unit, unit?.team === 'B'); bump(HEAT.turnStart); floor = Math.min(0.8, 0.42 + (10 - alive()) * 0.05); });
  // footsteps follow the walk animation: poll the unit's tile every frame between moveStart and moveEnd
  const walking = new Map();
  on('moveStart', ({ unit }) => {
    bump(HEAT.moveStart);
    if (!ENGINE || walking.has(unit.id)) return;
    let lx = unit.x, lz = unit.z; const st = { raf: 0 };
    const tick = () => {
      if (unit.x !== lx || unit.z !== lz) {
        lx = unit.x; lz = unit.z; const tile = battle.map?.at?.(lx, lz); const engine = ENGINE;
        engine?.at(placeOf(unit), () => engine.footstep(engine.now() + 0.005, tile?.t || 'g', unit.height > 1.4 ? 1.2 : 0.9));
      }
      st.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick); walking.set(unit.id, st);
  });
  on('moveEnd', ({ unit }) => { const st = walking.get(unit.id); if (!st) return; cancelAnimationFrame(st.raf); walking.delete(unit.id); });
  on('charge', ({ unit }) => playAt('chargeStart', unit));
  on('countdown', ({ unit, left }) => playAt('clockTick', unit, left));   // AT-clock tick (urgency rises as left falls)
  on('miss', ({ victim }) => playAt('miss', victim));
  on('reaction', ({ nullified }) => play('parry', nullified ? 1 : 0.7));
  on('knockback', ({ victim }) => playAt('thud', victim, 0.8, 160, 60, 0.1));
  on('status', ({ victim, status }) => playAt('statusTick', victim, GOOD_STATUS.has(status)));
  on('raise', ({ victim }) => playAt('raise', victim));
  // regen / drain / item heals: the payload does not say which, so a heal with no ability impact in the last
  // 0.7 s gets the small tick (Cure and friends already sounded on 'impact')
  let lastImpact = -1e9;
  on('heal', ({ victim }) => { if (performance.now() - lastImpact > 700) playAt('healTick', victim); });
  on('statusEnd', ({ unit }) => playAt('statusEnd', unit));
  on('crystal', ({ unit }) => { playAt('crystal', unit); bump(HEAT.crystal); });
  on('abilityStart', ({ unit, ability }) => {
    bump(HEAT.abilityStart); if (!ENGINE) return;
    if (ability.kind === 'mag' || ability.kind === 'heal' || ability.kind === 'raise' || ability.kind === 'buff' || ability.kind === 'debuff') playAt('chargeStart', unit);
    else if (ability.ranged) playAt('arrowFly', unit);
    else if (ability.jumpAttack) playAt('whoosh', unit, 300, 1400, 0.25, 0.8);
    else playAt('whoosh', unit);
  });
  on('impact', ({ ability, target, unit }) => {
    bump(HEAT.impact); lastImpact = performance.now();
    const n = IMPACT[ability.vfx] || (ability.kind === 'phys' ? 'slash' : 'buff');
    playAt(n, target || unit);
  });
  on('damage', ({ amount, victim }) => { bump(HEAT.damage); playAt('hit', victim, Math.min(1, 0.4 + amount / Math.max(1, victim.maxHp))); });
  on('ko', ({ victim }) => { playAt('ko', victim); bump(HEAT.ko); floor = Math.min(0.85, floor + 0.06); blood = true; if (SEQ) SEQ.calm = false; }); // blood spilled: march stays
  // victory carries the winning team: the player side is 'A'; a B win or a draw (team null) gets the defeat cue
  on('victory', ({ team } = {}) => playCue(team === 'A' ? 'victory' : 'defeat'));

  // ---- UI wrappers (the ui owner keeps the file; we decorate the instance once, guarded so a renamed API degrades
  //      to silence instead of a console error that tools/shot.mjs would flag as a PAGE ERROR) ----
  if (ui && !ui.__cbAudio && typeof ui.menuMove === 'function' && typeof ui.menuConfirm === 'function' && typeof ui.menu === 'function') {
    ui.__cbAudio = true;
    const mm = ui.menuMove.bind(ui), mc = ui.menuConfirm.bind(ui), mo = ui.menu.bind(ui);
    ui.menuMove = (d, ...rest) => { const before = ui.menuSel; mm(d, ...rest); if (ui.menuItems && ui.menuSel !== before) play('cursor'); };
    ui.menuConfirm = () => { const it = ui.menuItems?.[ui.menuSel]; if (it && it.enabled !== false) play('confirm'); mc(); };
    ui.menu = (items, cb, ...rest) => { play('menuOpen'); return mo(items, cb, ...rest); };   // pass every argument through (ui.menu grew an opts arg)
  }
  if (overlay && !overlay.__cbAudio && typeof overlay.setCursor === 'function') {
    overlay.__cbAudio = true;
    const sc = overlay.setCursor.bind(overlay); let lx = null, lz = null, last = 0;
    overlay.setCursor = (x, z) => { sc(x, z); if (x != null && (x !== lx || z !== lz)) { lx = x; lz = z; const n = performance.now(); if (n - last > 45) { last = n; play('tileCursor'); } } };
  }
  if (canvas && !canvas.__cbAudio) { canvas.__cbAudio = true; canvas.addEventListener('contextmenu', () => { if (BOUND?.player?.cancel) play('cancel'); }, true); }

  // Scene: a page that never asked for one (the standalone battle / capture page) gets the battle music as before.
  if (!EXPLICIT) { SCENE = 'battle'; SCENE_OPTS = {}; if (ENGINE) startScene('battle'); }
  else if (SCENE === 'battle' && ENGINE && !isPlaying(ACTIVE)) startScene('battle', SCENE_OPTS, true);

  const api = {
    battle, ensure: ensureEngine, play, place: placeOf, bounce: renderBounce,
    get engine() { return ENGINE; }, get seq() { return SEQ; },
    controls: audioControls, setScene, uiSfx, setVolumes, getVolumes, getScene,
    offline: { sfx: renderSfxOffline, loop: renderLoopOffline, victory: renderVictoryOffline, defeat: renderDefeatOffline, scene: renderSceneOffline, stinger: renderStingerOffline },
    wav: encodeWav,
    setIntensity(v) { floor = v; heat = Math.max(heat, v); SEQ?.setIntensity(v); },
    setMuted(m) { audioControls.toggle(!!m); },
    unbind() {
      listeners.splice(0).forEach((off) => { try { off?.(); } catch { /* bus gone */ } });
      for (const st of walking.values()) cancelAnimationFrame(st.raf); walking.clear();
      if (heatRaf) cancelAnimationFrame(heatRaf); heatRaf = 0;
      if (BOUND?.battle === battle) BOUND = null;
      if (ROOT === api) { ROOT = null; window.__AUDIO__ = undefined; }
    },
    dispose() { api.unbind(); if (ACTIVE?.seq) { retire(ACTIVE, 0.3); ACTIVE = null; } },
  };
  ROOT = api; window.__AUDIO__ = api; return api;
}

// main.js / battleboot.js entry (awaits m.init(ctx)): thin adapter, same singleton.
export function init(ctx) {
  try { return initAudio(ctx?.battle, ctx || {}); } catch (err) { console.warn('audio init failed', err); return null; }
}

// ---- offline bounce: seconds of music (+ optional scripted SFX) rendered to a WAV Uint8Array ----
// Standalone (no game ctx) so the bounce harness can render it in a blank page. The default intensity ramp
// starts in the somber vigil and climbs across TENSE_IN into the march, so one bounce demos both loops.
export async function renderBounce(seconds = 20, { sfx = true, sampleRate = 44100, intensity = null } = {}) {
  const oac = new OfflineAudioContext(2, Math.ceil(sampleRate * seconds), sampleRate);
  const e = new Engine(oac); const s = new Sequencer(e);
  const ramp = intensity === null ? (bar) => Math.min(1, 0.42 + bar * 0.1) : (typeof intensity === 'function' ? intensity : () => intensity);
  s.renderInto(0.05, seconds + 1, ramp);
  if (sfx) demoSfx(e, s, 0);
  const buf = await oac.startRendering(); return encodeWav(buf);
}

// ---- round-6 offline measurement API (probe: shots/audio/probe.mjs) ------------------------------------------
// Each renders one thing through the REAL Engine chain (master -> comp -> limiter -> trim) so the measured
// peak/RMS/duration is what a player would hear, not a pre-mix sketch.
export async function renderSfxOffline(name, { seconds = 2, sampleRate = 44100, args = [] } = {}) {
  const oac = new OfflineAudioContext(2, Math.max(1, Math.ceil(sampleRate * seconds)), sampleRate);
  const e = new Engine(oac);
  if (typeof e[name] !== 'function') throw new Error('unknown sfx: ' + name);
  e[name](0.03, ...args);
  return oac.startRendering();
}
export async function renderLoopOffline(theme, { seconds = 16, intensity = 0.85, sampleRate = 44100, flavour = null } = {}) {
  const oac = new OfflineAudioContext(2, Math.ceil(sampleRate * seconds), sampleRate);
  const e = new Engine(oac); const s = new Sequencer(e, flavour);
  if (!(s.F?.[theme] || SCHED[theme])) throw new Error('unknown theme: ' + theme);
  // intensity may be a number or a function of the bar index (a heat ramp)
  s.renderInto(0.05, seconds, typeof intensity === 'function' ? intensity : () => intensity, theme);
  return oac.startRendering();
}
export async function renderVictoryOffline({ seconds = 6, sampleRate = 44100, final = false } = {}) {
  const oac = new OfflineAudioContext(2, Math.ceil(sampleRate * seconds), sampleRate);
  const e = new Engine(oac); (final ? finalVictory : fanfare)(e, 0.05);
  return oac.startRendering();
}
export async function renderDefeatOffline({ seconds = 11, sampleRate = 44100 } = {}) {
  const oac = new OfflineAudioContext(2, Math.ceil(sampleRate * seconds), sampleRate);
  const e = new Engine(oac); defeat(e, 0.05);
  return oac.startRendering();
}

export function encodeWav(buf) {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate; const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c)); let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, v < 0 ? v * 32768 : v * 32767, true); o += 2; }
  return new Uint8Array(out.buffer);
}

// round 8: a campaign scene (or 'battle' = the tense rotation) / a UI sound, through the real Engine chain.
export async function renderSceneOffline(scene, { seconds = 40, sampleRate = 44100, opts = {} } = {}) {
  if (scene === 'battle') return renderLoopOffline('tense', { seconds, sampleRate, intensity: opts.intensity ?? 0.85, flavour: opts.flavour ?? null });
  const oac = new OfflineAudioContext(2, Math.ceil(sampleRate * seconds), sampleRate);
  const e = new Engine(oac); const d = e.deck(); const th = scene === 'worldmap' && worldRegion(opts) === 'north' ? northTheme() : makeTheme(scene, opts);
  if (!th) throw new Error('unknown scene: ' + scene);
  renderThemeInto(d, th, 0.05, seconds);
  return oac.startRendering();
}
export async function renderStingerOffline(name, { seconds = 2.2, sampleRate = 44100 } = {}) {
  const oac = new OfflineAudioContext(2, Math.ceil(sampleRate * seconds), sampleRate);
  const e = new Engine(oac);
  if (UI_SYNTH[name]) e[UI_SYNTH[name]](0.03); else if (STINGERS[name]) STINGERS[name](e.deck(e.sfx), 0.03); else throw new Error('unknown ui sfx: ' + name);
  return oac.startRendering();
}
