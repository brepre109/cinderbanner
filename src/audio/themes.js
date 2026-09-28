// Campaign score (round 8): the music that lives OUTSIDE battle — title, world map, story, formation/shop,
// results and the defeat aftermath — plus the orchestral UI stingers (level up, JP, recruit, save).
//
// One leitmotif ties the whole game together: the "Echoes" motif, 5 - 1 - 2 - 3 (a dotted rise from the
// dominant, then a step up to the third). In D minor it is A D E F (title, story, defeat); in the major
// themes the same contour becomes C F G A (world map), F Bb C D (formation) and A D E F# (results, recruit).
// All music here is original.
//
//   title      "Cinderbanner"      D minor, 4/4, 72 BPM. 4-bar harp intro -> 16-bar theme (A: violins, or
//                                       flute/oboe on alternate passes; B: horn statement over full strings,
//                                       counter-melody, choir, timpani) -> 2-bar harp codetta -> loops to A.
//   worldmap   "Roads of the Southmarch"       F major, 6/8, dotted-quarter 60. Flute/oboe/clarinet over harp and
//                                       pizzicato; 2-bar intro -> 16-bar loop, two orchestrations (64 s cycle).
//   story      "Quiet Words" (sad)      D minor, 4/4, 60 BPM. 8 bars x 3 passes: pad+harp / + viola motif /
//                                       + flute motif.  mood 'tense': "Under the Surface" — D pedal against Eb,
//                                       tremolo violins, a timpani heartbeat, low clarinet.
//   formation  "Rest at the Waystone"   Bb major, 3/4, 108 BPM. Clarinet waltz over pizzicato oom-pah-pah.
//   results    "After the Field"        D major, 4/4, 80 BPM. A 3 s brass jingle (skipped when the battle's victory
//                                       fanfare just played) then an 8-bar horn/violin loop.
//   defeat     "Ashes"                  the battle defeat cue (unless it just played), then a slow D minor lament.
//
// Every theme is a pure function of (engine, bar index, bar start time) exactly like the battle score, so the
// same code drives live playback (ScenePlayer, a bar ahead of the clock) and offline bounces.
import { CH, voiceLead, stack } from './score.js';
import { defeat as defeatCue } from './score.js';

const X = {
  ...CH,
  D: { bass: 38, pcs: [2, 6, 9] }, G: { bass: 43, pcs: [7, 11, 2] }, Bm: { bass: 47, pcs: [11, 2, 6] }, Em7: { bass: 40, pcs: [4, 7, 11, 2] },
  Eb: { bass: 39, pcs: [3, 7, 10] }, Cm: { bass: 36, pcs: [0, 3, 7] }, F7: { bass: 41, pcs: [5, 9, 0, 3] }, Gm7: { bass: 43, pcs: [7, 10, 2, 5] },
  C7: { bass: 36, pcs: [0, 4, 7, 10] }, FA: { bass: 45, pcs: [5, 9, 0], root: 5 }, BbD: { bass: 38, pcs: [10, 2, 5], root: 10 },
  EbD: { bass: 38, pcs: [3, 7, 10], root: 3 }, GmD: { bass: 38, pcs: [7, 10, 2], root: 7 },
};
const SCALE = { F: [0, 2, 4, 5, 7, 9, 10], Bb: [10, 0, 2, 3, 5, 7, 9], D: [2, 4, 6, 7, 9, 11, 1] };
// move `steps` scale degrees from m (negative = down): diatonic thirds/sixths for duet lines
function dia(m, steps, pcs) { let x = m, k = Math.abs(steps); const dir = Math.sign(steps); while (k > 0) { x += dir; if (pcs.includes(((x % 12) + 12) % 12)) k--; } return x; }

// Progressions may split a bar in two ('Gm|C'). segments() voice-leads the flattened chord list and returns, per
// bar, [{ ch, v (voicing), off, len }] with off/len as fractions of the bar.
function segments(prog, n, lo, hi, start) {
  const flat = []; prog.forEach((c, b) => { const parts = c.split('|'); parts.forEach((nm, h) => flat.push({ b, nm, off: h / parts.length, len: 1 / parts.length })); });
  const V = voiceLead(flat.map((x) => x.nm), n, lo, hi, start, X);
  const out = prog.map(() => []); flat.forEach((x, i) => out[x.b].push({ ch: X[x.nm], v: V[i], off: x.off, len: x.len })); return out;
}
// ---- shared layers -------------------------------------------------------------------------------------------
const bassL = (e, segs, t0, D, vel, o = {}) => segs.forEach((s) => e.contrabass(t0 + s.off * D, s.ch.bass, s.len * D - 0.05, vel, { attack: o.attack ?? 0.08 }));
const padL = (e, segs, t0, D, vel, o = {}) => segs.forEach((s) => s.v.forEach((m, i) => e.strings(t0 + s.off * D, m, s.len * D + (o.over ?? 0.1), vel, { sect: 'pad', attack: o.attack ?? 0.35, release: o.release ?? 0.5, gain: o.gain ?? 0.016, pan: -0.38 + i * 0.26, prio: o.prio ?? 1 })));
// harp figure: N slots per bar; each slot plays stack(chord at that slot, from, 8)[fig[i]]
function harpL(e, segs, t0, D, N, from, fig, vel, o = {}) {
  for (let i = 0; i < N; i++) {
    const x = i / N; const s = segs.find((g) => x >= g.off - 1e-6 && x < g.off + g.len - 1e-6) || segs[0];
    const k = fig[i % fig.length]; if (k == null || k < 0) continue;
    e.harp(t0 + i * D / N, stack(s.ch, from, 10)[k], vel * (i % (o.accent ?? 4) === 0 ? 1 : 0.72), { pan: (o.pan ?? -0.55) + (k / 9) * 0.35, prio: o.prio ?? 1, gain: o.gain });
  }
}
const mel = (notes, t0, S, fn) => { for (const [s, len, m] of notes || []) fn(t0 + s * S, len * S, m, s); };

// =============================================================================================================
// TITLE — "Cinderbanner" (main theme)
const T_INTRO = ['Dm', 'Bb', 'Gm', 'Asus|A'];
const T_BODY = ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'F', 'Gm|C', 'Asus|A', 'Bb', 'F', 'Gm', 'Dm', 'Bb', 'Gm6', 'A', 'Dm'];
const T_CODA = ['Bbadd', 'Asus|A'];
export const LEITMOTIF = [ // 8th-note slots in a 4/4 bar: [slot, length, midi]
  [[0, 3, 69], [3, 1, 74], [4, 4, 76]], [[0, 6, 77], [6, 1, 76], [7, 1, 74]], [[0, 4, 74], [4, 2, 67], [6, 2, 70]], [[0, 8, 69]],
  [[0, 3, 69], [3, 1, 74], [4, 4, 76]], [[0, 3, 77], [3, 1, 79], [4, 4, 81]], [[0, 4, 82], [4, 2, 81], [6, 2, 79]], [[0, 4, 77], [4, 4, 76]],
  [[0, 2, 74], [2, 2, 77], [4, 4, 82]], [[0, 6, 81], [6, 1, 79], [7, 1, 77]], [[0, 4, 79], [4, 2, 82], [6, 2, 81]], [[0, 6, 77], [6, 2, 76]],
  [[0, 3, 74], [3, 1, 76], [4, 4, 77]], [[0, 3, 79], [3, 1, 77], [4, 4, 76]], [[0, 4, 76], [4, 4, 73]], [[0, 8, 74]],
];
const T_CTR = [[[0, 4, 58], [4, 4, 62]], [[0, 4, 60], [4, 4, 57]], [[0, 4, 58], [4, 4, 55]], [[0, 4, 57], [4, 4, 53]], [[0, 4, 53], [4, 4, 55]], [[0, 4, 58], [4, 4, 52]], [[0, 4, 57], [4, 4, 55]], [[0, 8, 53]]];
const T_DYN = [0.8, 0.84, 0.88, 0.84, 0.86, 0.92, 0.98, 1.0, 1.0, 1.02, 1.06, 0.98, 1.02, 1.08, 1.1, 0.96];
function titleTheme() {
  const D = 4 * 60 / 72, S = D / 8, L = 1.55;
  const all = segments([...T_INTRO, ...T_BODY, ...T_CODA], 4, 53, 74, [57, 62, 65, 69]);
  const sI = all.slice(0, 4), sB = all.slice(4, 20), sC = all.slice(20);
  function intro(e, i, t0) {
    const g = sI[i], lv = L * (1.0 + i * 0.07);
    bassL(e, g, t0, D, 0.42 * lv, { attack: 0.5 });
    if (i >= 1) padL(e, g, t0, D, 0.7 * lv, { attack: i === 1 ? 1.6 : 0.5, gain: 0.013, release: 0.7 });
    harpL(e, g, t0, D, 8, 50, [0, 2, 4, 5, 6, 5, 4, 2], 0.62 * lv);
    if (i === 3) for (let k = 0; k < 6; k++) e.harp(t0 + 6 * S + k * S / 3, stack(X.A, 64, 6)[k], (0.3 + k * 0.06) * lv, { prio: 2 });
  }
  function body(e, k, t0, pass) {
    const g = sB[k], B = k >= 8, lv = L * T_DYN[k] * (B ? 0.86 : 1.2); const at = (s) => t0 + s * S;
    bassL(e, g, t0, D, (B ? 0.62 : 0.5) * lv, { attack: 0.12 });
    padL(e, g, t0, D, 0.74 * lv, { gain: B ? 0.019 : 0.02, attack: 0.3 });
    if (!B) harpL(e, g, t0, D, 8, 50, [0, 1, 2, 3, 4, 3, 2, 1], 0.68 * lv);
    else harpL(e, g, t0, D, 8, 57, [0, 2, 4, 6, 7, 6, 4, 2], 0.42 * lv, { prio: 2 });
    if (!B) {
      if (pass % 2 === 0) mel(LEITMOTIF[k], t0, S, (t, d, m) => e.strings(t, m, d - 0.03, 0.85 * lv, { sect: 'vln', attack: 0.1, release: 0.35, gain: 0.03 }));
      else mel(LEITMOTIF[k], t0, S, (t, d, m) => e.wind(t, m, d - 0.03, 0.85 * lv, { sect: k < 4 ? 'flute' : 'oboe' }));
    } else {
      mel(LEITMOTIF[k], t0, S, (t, d, m) => { e.horn(t, m - 12, d - 0.03, 0.92 * lv, { attack: 0.06, release: 0.25, gain: 0.13 }); e.strings(t, m, d - 0.03, 0.6 * lv, { sect: 'vln', attack: 0.07, release: 0.3, gain: 0.016, prio: 1 }); });
      mel(T_CTR[k - 8], t0, S, (t, d, m) => e.strings(t, m, d - 0.03, 0.7 * lv, { sect: 'viola', attack: 0.15, release: 0.3, gain: 0.02 }));
      if (k >= 12) e.choir(t0, g[0].v[2], D + 0.1, 0.7 * lv, { attack: 0.8 });
    }
    // percussion: roll + swell into the horn statement, soft downbeats in the B phrase
    if (k === 7) { for (let i = 0; i < 8; i++) e.timpani(at(4 + i * 0.5), 45, (0.2 + 0.6 * i / 7) * lv, { gain: 0.16 }); e.cymSwell(at(4), 4 * S - 0.04, 0.8 * lv); }
    if (k === 8) { e.timpani(t0, 38, 0.9 * lv); e.crash(t0, 0.5 * lv); e.bassDrum(t0, 0.4 * lv); }
    if (k === 12) e.timpani(t0, 38, 0.55 * lv);
    if (k === 14) { e.timpani(t0, 45, 0.6 * lv); for (let i = 0; i < 8; i++) e.timpani(at(4 + i * 0.5), 45, (0.15 + 0.4 * i / 7) * lv, { gain: 0.14 }); }
    if (k === 15) { e.timpani(t0, 38, 0.75 * lv); e.bassDrum(t0, 0.3 * lv); }
  }
  function coda(e, j, t0) {
    const g = sC[j], lv = L * (1.7 - j * 0.1);
    bassL(e, g, t0, D, 0.45 * lv, { attack: 0.3 });
    padL(e, g, t0, D, 0.66 * lv, { gain: 0.013, attack: 0.6, release: 0.8 });
    if (j === 0) { harpL(e, g, t0, D, 8, 55, [7, 6, 5, 4, 3, 2, 1, 0], 0.5 * lv); mel([[0, 3, 57], [3, 1, 62], [4, 2, 64], [6, 2, 65]], t0, S, (t, d, m) => e.horn(t, m, d - 0.03, 0.5 * lv, { attack: 0.1, release: 0.4, gain: 0.12 })); }
    else { harpL(e, g, t0, D, 8, 50, [0, 2, 4, 5, 6, 5, 4, 2], 0.6 * lv); mel([[0, 4, 76], [4, 4, 73]], t0, S, (t, d, m) => e.strings(t, m, d - 0.03, 0.55 * lv, { sect: 'vln', attack: 0.4, release: 0.3, gain: 0.02 })); }
  }
  return {
    name: 'title', key: 'D minor', dur: () => D,
    play(e, n, t0) {
      if (n < 4) return intro(e, n, t0);
      const k = (n - 4) % 18, pass = Math.floor((n - 4) / 18);
      return k < 16 ? body(e, k, t0, pass) : coda(e, k - 16, t0);
    },
  };
}

// =============================================================================================================
// WORLD MAP — "Roads of the Southmarch" (F major, 6/8)
const W_PROG = ['F', 'CE', 'Dm', 'Bb', 'F', 'Gm7', 'C', 'C7', 'Bb', 'FA', 'Gm', 'Dm', 'Bb', 'C', 'Gm7|C', 'F|C7'];
const W_MEL = [ // 8th slots (6 per bar)
  [[0, 2, 72], [2, 1, 77], [3, 2, 79], [5, 1, 81]], [[0, 3, 79], [3, 2, 76], [5, 1, 72]], [[0, 2, 74], [2, 1, 77], [3, 2, 81], [5, 1, 79]], [[0, 5, 77], [5, 1, 74]],
  [[0, 2, 72], [2, 1, 77], [3, 2, 79], [5, 1, 81]], [[0, 3, 82], [3, 2, 81], [5, 1, 79]], [[0, 2, 79], [2, 1, 76], [3, 2, 77], [5, 1, 79]], [[0, 4, 79], [4, 2, 76]],
  [[0, 2, 77], [2, 1, 74], [3, 3, 82]], [[0, 2, 81], [2, 1, 79], [3, 3, 77]], [[0, 2, 79], [2, 1, 77], [3, 2, 74], [5, 1, 70]], [[0, 3, 74], [3, 3, 69]],
  [[0, 2, 74], [2, 1, 77], [3, 2, 82], [5, 1, 81]], [[0, 3, 79], [3, 3, 84]], [[0, 2, 82], [2, 1, 81], [3, 2, 79], [5, 1, 76]], [[0, 3, 77], [3, 3, 72]],
];
function worldTheme() {
  const D = 2.0, S = D / 6, L = 1.7;
  const all = segments(['F', 'F', ...W_PROG], 4, 53, 72, [53, 60, 65, 69]);
  const sI = all.slice(0, 2), sB = all.slice(2);
  const pizzL = (e, g, t0, lv) => g.forEach((s) => { const t = t0 + s.off * D; e.pizz(t, s.ch.bass, 0.9 * lv); if (s.len === 1) e.pizz(t0 + 3 * S, s.ch.bass + (s.ch.root != null ? 0 : 7), 0.62 * lv); });
  return {
    name: 'worldmap', key: 'F major', dur: () => D,
    play(e, n, t0) {
      if (n < 2) { const lv = L * 0.8; pizzL(e, sI[n], t0, lv); harpL(e, sI[n], t0, D, 6, 60, [0, 1, 2, 3, 2, 1], 0.5 * lv, { accent: 3 }); if (n === 1) padL(e, sI[n], t0, D, 0.6 * lv, { gain: 0.01, attack: 0.9 }); return; }
      const k = (n - 2) % 16, pass = Math.floor((n - 2) / 16) % 2, B = k >= 8, g = sB[k];
      const lv = L * (B ? 1 : 0.9);
      pizzL(e, g, t0, lv);
      if (B) bassL(e, g, t0, D, 0.28 * lv, { attack: 0.25 });
      harpL(e, g, t0, D, 6, 60, pass ? [0, 2, 1, 3, 2, 4] : [0, 1, 2, 3, 2, 1], 0.46 * lv, { accent: 3 });
      padL(e, g, t0, D, 0.62 * lv, { gain: B ? 0.012 : 0.009, attack: 0.5, release: 0.6 });
      const lead = pass === 0 ? 'flute' : (B ? 'flute' : 'oboe');
      mel(W_MEL[k], t0, S, (t, d, m) => e.wind(t, m, d - 0.025, 0.85 * lv, { sect: lead }));
      if (B) mel(W_MEL[k], t0, S, (t, d, m) => e.wind(t, dia(m, pass ? -5 : -2, SCALE.F), d - 0.025, 0.6 * lv, { sect: pass ? 'clar' : 'oboe', prio: 1 }));
      if (!B && pass === 1) e.strings(t0, g[0].v[3] + 12, D - 0.05, 0.45 * lv, { sect: 'vln', attack: 0.4, release: 0.5, gain: 0.011, prio: 2 });
      if (k === 7 || k === 15) { e.glock(t0 + 3 * S, 84, 0.5 * lv); e.glock(t0 + 4 * S, 81, 0.4 * lv); }
    },
  };
}

// =============================================================================================================
// STORY — "Quiet Words" (sad), "Under the Surface" (tense); DEFEAT loop — "Ashes" (lament)
const MOODS = {
  sad: { bpm: 60, L: 2.8, prog: ['Dm', 'Bbadd', 'Gm', 'A', 'Dm', 'Gm6', 'Bb', 'Asus|A'] },
  tense: { bpm: 60, L: 2.4, prog: ['Dm', 'EbD', 'Dm', 'EbD', 'GmD', 'EbD', 'Asus|A7', 'A7'] },
  lament: { bpm: 54, L: 3.3, prog: ['Dm', 'GmD', 'Bbadd', 'A', 'Dm', 'Bb', 'Gm6', 'Asus|A'] },
};
const FRAG = [[[0, 3, 57], [3, 1, 62], [4, 4, 64]], [[0, 8, 65]], [[0, 4, 62], [4, 4, 58]], [[0, 8, 57]], [[0, 3, 57], [3, 1, 62], [4, 4, 64]], [[0, 6, 65], [6, 2, 64]], [[0, 8, 62]], [[0, 4, 62], [4, 4, 61]]];
const T_FRAG = [[[0, 3, 57], [3, 1, 62], [4, 4, 65]], [[0, 6, 63], [6, 2, 62]], [[0, 8, 57]], [[0, 4, 58], [4, 4, 55]], [[0, 3, 58], [3, 1, 62], [4, 4, 67]], [[0, 6, 67], [6, 2, 65]], [[0, 4, 64], [4, 4, 61]], [[0, 8, 57]]];
function storyTheme(mood = 'sad', { lead = 0 } = {}) {
  const M = MOODS[mood] || MOODS.sad; const D = 4 * 60 / M.bpm, S = D / 8, L = M.L;
  const sg = segments(M.prog, 4, 53, 72, [57, 62, 65, 69]);
  return {
    name: mood === 'lament' ? 'defeat' : 'story', mood, key: 'D minor', dur: () => D, lead,
    play(e, n, t0) {
      if (n < lead) { defeatCue(e, t0); return; }                         // defeat scene: the cue, then the lament
      n -= lead; const k = n % 8, pass = Math.floor(n / 8) % 3, g = sg[k], lv = L * (k === 7 ? 0.9 : 1);
      if (mood === 'tense') {
        e.contrabass(t0, k >= 6 ? 45 : 38, D - 0.06, 0.45 * lv, { attack: 0.3 });
        padL(e, g, t0, D, 0.66 * lv, { gain: 0.011, attack: 1.0, release: 0.9, over: 0.3 });
        harpL(e, g, t0, D, 8, 50, [0, 2, 1, 3, 0, 2, 1, 3], 0.4 * lv, { accent: 2, prio: 1 });
        for (let i = 0; i < 16; i++) e.stacStrings(t0 + i * S / 2, g[g.length > 1 && i >= 8 ? 1 : 0].v[3] + 12, (0.25 + 0.2 * Math.sin(Math.PI * i / 15)) * lv, { dur: 0.085, gain: 0.012, sect: 'vln', prio: 2 });
        e.timpani(t0, 38, 0.4 * lv, { gain: 0.15 }); e.timpani(t0 + S, 38, 0.26 * lv, { gain: 0.15 });
        if (pass === 1) mel(T_FRAG[k], t0, S, (t, d, m) => e.wind(t, m, d - 0.04, 0.5 * lv, { sect: 'clar', attack: 0.09, release: 0.3 }));
        if (pass === 2) mel(T_FRAG[k], t0, S, (t, d, m) => e.strings(t, m, d - 0.04, 0.7 * lv, { sect: 'viola', attack: 0.3, release: 0.5, gain: 0.02 }));
        return;
      }
      bassL(e, g, t0, D, 0.38 * lv, { attack: 0.6 });
      padL(e, g, t0, D, 0.7 * lv, { gain: 0.012, attack: 1.1, release: 1.0, over: 0.3 });
      if (mood === 'lament') harpL(e, g, t0, D, 4, 50, [0, 2, 1, 3], 0.36 * lv, { accent: 2 });
      else if (pass === 2) harpL(e, g, t0, D, 8, 55, [0, 1, 2, 3, 4, 3, 2, 1], 0.34 * lv);
      else harpL(e, g, t0, D, 4, 55, [0, 1, 2, 3], 0.4 * lv);
      if (pass === 1) mel(FRAG[k], t0, S, (t, d, m) => mood === 'lament' ? e.horn(t, m, d - 0.05, 0.5 * lv, { attack: 0.14, release: 0.5, gain: 0.11 }) : e.strings(t, m, d - 0.05, 0.75 * lv, { sect: 'viola', attack: 0.3, release: 0.6, gain: 0.03 }));
      if (pass === 2) {
        if (mood === 'lament') e.choir(t0, g[0].v[2], D + 0.2, 0.6 * lv, { attack: 1.0, release: 1.0 });
        else mel(FRAG[k], t0, S, (t, d, m) => e.wind(t, m + 12, d - 0.05, 0.4 * lv, { sect: 'flute', attack: 0.1, release: 0.3 }));
      }
    },
  };
}

// =============================================================================================================
// FORMATION / SHOP — "Rest at the Waystone" (Bb major, 3/4 waltz)
const F_PROG = ['Bb', 'Gm', 'Eb', 'F', 'Bb', 'Gm', 'Cm', 'F7', 'Eb', 'BbD', 'Cm', 'F', 'Gm', 'Eb', 'F7', 'Bb'];
const F_MEL = [ // 8th slots (6 per bar)
  [[0, 2, 65], [2, 2, 70], [4, 2, 72]], [[0, 6, 74]], [[0, 2, 75], [2, 2, 74], [4, 2, 70]], [[0, 4, 72], [4, 2, 69]],
  [[0, 2, 65], [2, 2, 70], [4, 2, 72]], [[0, 4, 74], [4, 2, 79]], [[0, 2, 79], [2, 2, 77], [4, 2, 75]], [[0, 6, 72]],
  [[0, 2, 70], [2, 2, 75], [4, 2, 79]], [[0, 4, 77], [4, 2, 74]], [[0, 2, 75], [2, 2, 72], [4, 2, 67]], [[0, 6, 69]],
  [[0, 2, 70], [2, 2, 74], [4, 2, 79]], [[0, 4, 79], [4, 1, 77], [5, 1, 75]], [[0, 2, 74], [2, 2, 72], [4, 2, 69]], [[0, 6, 70]],
];
function formationTheme() {
  const D = 3 * 60 / 108, S = D / 6, L = 1.7;
  const sg = segments(F_PROG, 4, 53, 72, [58, 62, 65, 70]);
  return {
    name: 'formation', key: 'Bb major', dur: () => D,
    play(e, n, t0) {
      const k = n % 16, pass = Math.floor(n / 16) % 2, B = k >= 8, g = sg[k], s = g[0]; const lv = L;
      e.pizz(t0, s.ch.bass, 0.85 * lv);
      for (const sl of [2, 4]) for (const m of [s.v[1], s.v[2]]) e.pizz(t0 + sl * S, m, 0.36 * lv, { prio: 1 });
      if (B || pass) harpL(e, g, t0, D, 6, 62, [0, 1, 2, 3, 2, 1], 0.34 * lv, { accent: 6, prio: 2 });
      padL(e, g, t0, D, 0.6 * lv, { gain: B ? 0.009 : 0.007, attack: 0.5, release: 0.5 });
      mel(F_MEL[k], t0, S, (t, d, m) => e.wind(t, pass ? m + 12 : m, d - 0.03, 0.85 * lv, { sect: pass ? 'flute' : 'clar' }));
      if (pass && B) mel(F_MEL[k], t0, S, (t, d, m) => e.wind(t, dia(m, -2, SCALE.Bb), d - 0.03, 0.55 * lv, { sect: 'clar', prio: 1 }));
      if (k % 4 === 3) e.glock(t0 + 4 * S, s.v[3] + 12, 0.38 * lv);
    },
  };
}

// =============================================================================================================
// RESULTS — jingle, then "After the Field" (D major)
const R_PROG = ['D', 'Bm', 'G', 'A', 'D', 'G', 'Em7|A', 'D'];
const R_MEL = [[[0, 3, 69], [3, 1, 74], [4, 4, 76]], [[0, 6, 78], [6, 2, 76]], [[0, 4, 74], [4, 2, 71], [6, 2, 74]], [[0, 8, 76]], [[0, 3, 69], [3, 1, 74], [4, 4, 76]], [[0, 3, 78], [3, 1, 79], [4, 4, 81]], [[0, 4, 79], [4, 4, 76]], [[0, 8, 74]]];
export function resultsJingle(e, t0) {
  for (let i = 0; i < 3; i++) { e.horn(t0 + i * 0.13, 69, 0.1, 0.85, { sect: 'tpt' }); e.snare(t0 + i * 0.13, 0.45); }
  e.brassChord(t0 + 0.4, [50, 62, 66, 69], 0.3, 0.85, { gain: 0.12 }); e.horn(t0 + 0.4, 74, 0.3, 0.95, { sect: 'tpt' }); e.timpani(t0 + 0.4, 38, 0.7);
  e.brassChord(t0 + 0.8, [49, 61, 64, 69], 0.3, 0.85, { gain: 0.12 }); e.horn(t0 + 0.8, 76, 0.3, 0.95, { sect: 'tpt' }); e.timpani(t0 + 0.8, 45, 0.7);
  const t = t0 + 1.2;
  e.brassChord(t, [50, 62, 66, 69, 74], 1.5, 1, { gain: 0.13, release: 0.25 }); e.horn(t, 78, 1.5, 1, { sect: 'tpt', release: 0.3 }); e.horn(t, 69, 1.5, 0.75, { release: 0.3 });
  e.contrabass(t, 38, 1.6, 0.8); e.timpani(t, 38, 1); e.bassDrum(t, 0.4); e.crash(t, 0.6);
  [62, 66, 69, 74, 78, 81, 86, 90].forEach((m, i) => e.harp(t + 0.03 + i * 0.05, m, 0.7, { prio: 0 }));
  [74, 78].forEach((m) => e.strings(t, m, 1.5, 0.8, { sect: 'vln', attack: 0.05, release: 0.4, gain: 0.018 }));
  return 3.2;
}
function resultsTheme({ lead = 1 } = {}) {
  const D = 3.0, S = D / 8, L = 1.7;
  const sg = segments(R_PROG, 4, 54, 74, [57, 62, 66, 69]);
  return {
    name: 'results', key: 'D major', lead, dur: (n) => (n < lead ? 3.2 : D),
    play(e, n, t0) {
      if (n < lead) { resultsJingle(e, t0); return; }
      n -= lead; const k = n % 8, pass = Math.floor(n / 8) % 2, g = sg[k], lv = L * (k >= 4 ? 1 : 0.92);
      bassL(e, g, t0, D, 0.45 * lv, { attack: 0.2 });
      padL(e, g, t0, D, 0.7 * lv, { gain: 0.014, attack: 0.5, release: 0.6 });
      harpL(e, g, t0, D, 8, 57, [0, 1, 2, 3, 4, 3, 2, 1], 0.42 * lv);
      if (pass === 0) mel(R_MEL[k], t0, S, (t, d, m) => e.horn(t, m - 12, d - 0.04, 0.82 * lv, { attack: 0.07, release: 0.3, gain: 0.12 }));
      else {
        mel(R_MEL[k], t0, S, (t, d, m) => e.strings(t, m, d - 0.04, 0.75 * lv, { sect: 'vln', attack: 0.1, release: 0.35, gain: 0.018 }));
        if (k >= 4) mel(R_MEL[k], t0, S, (t, d, m) => e.wind(t, dia(m, 2, SCALE.D), d - 0.04, 0.5 * lv, { sect: 'flute', prio: 1 }));
      }
      if (k === 0 && pass === 0) e.timpani(t0, 38, 0.45 * lv);
      if (k === 7) e.glock(t0 + 4 * S, 86, 0.35 * lv);
    },
  };
}

// ---- scene registry ------------------------------------------------------------------------------------------
// opts: { mood } for story ('sad' | 'tense'), { skipIntro } for results/defeat (the battle already played the cue).
export function makeTheme(scene, opts = {}) {
  switch (scene) {
    case 'title': return titleTheme();
    case 'worldmap': return worldTheme();
    case 'story': return storyTheme(opts.mood === 'tense' ? 'tense' : 'sad');
    case 'formation': return formationTheme();
    case 'results': return resultsTheme({ lead: opts.skipIntro ? 0 : 1 });
    case 'defeat': { const th = storyTheme('lament', { lead: opts.skipIntro ? 0 : 1 }); const d0 = th.dur; th.dur = (n) => (n < th.lead ? 10.5 : d0(n)); return th; }
    default: return null;
  }
}

// Plays a theme a bar at a time, 1.6 s ahead of the audio clock (the battle Sequencer's scheme).
export class ScenePlayer {
  constructor(e, theme) { this.e = e; this.th = theme; this.n = 0; this.next = 0; this.timer = null; this.playing = false; }
  start(at = this.e.now() + 0.06, { inline } = {}) {
    this.playing = true; this.next = at; this.n = 0;
    if (inline) inline(() => this.tick()); else this.tick();
    this.timer = setInterval(() => this.tick(), 150);
  }
  tick() {
    if (!this.playing) return;
    const now = this.e.now();
    while (this.next < now - 0.05) { this.next += this.th.dur(this.n); this.n++; }   // throttled tab: resync to the grid
    while (this.playing && this.next - now < 1.6) { this.th.play(this.e, this.n, this.next); this.next += this.th.dur(this.n); this.n++; }
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.playing = false; }
}
// Offline: lay down `seconds` of a theme from t0, incrementally (suspend/resume) like the live player.
export function renderThemeInto(e, theme, t0, seconds) {
  const bars = []; for (let n = 0, t = t0; t < t0 + seconds; t += theme.dur(n), n++) bars.push([n, t]);
  const ac = e.ac; const doBar = ([n, t]) => theme.play(e, n, t);
  if (!(globalThis.OfflineAudioContext && ac instanceof OfflineAudioContext)) { bars.forEach(doBar); return bars.length; }
  const q = 128 / ac.sampleRate, end = ac.length / ac.sampleRate; let i = 0;
  const pump = () => {
    const now = ac.currentTime;
    while (i < bars.length && bars[i][1] - now < 1.6) doBar(bars[i++]);
    if (i < bars.length) { const at = Math.max(now + q, Math.ceil((bars[i][1] - 1.6) / q) * q); if (at < end - q) return ac.suspend(at).then(() => { pump(); ac.resume(); }); }
    return null;
  };
  pump(); return bars.length;
}
// loop length in bars/seconds after the intro (for seam checks)
export const THEME_INFO = {
  title: { intro: 4, loopBars: 18, bar: 4 * 60 / 72 },
  worldmap: { intro: 2, loopBars: 16, bar: 2 },
  story: { intro: 0, loopBars: 8, bar: 4 },
  formation: { intro: 0, loopBars: 16, bar: 5 / 3 },
  results: { intro: 1, introDur: 3.2, loopBars: 8, bar: 3 },
  defeat: { intro: 1, introDur: 10.5, loopBars: 8, bar: 4 * 60 / 54 },
};

// =============================================================================================================
// UI STINGERS (orchestral, on a deck routed to the SFX bus so they follow the sfx volume). Return durations.
export const STINGERS = {
  levelup(d, t) {
    [74, 78, 81, 86].forEach((m, i) => { d.glock(t + i * 0.07, m + 12, 0.7, { prio: 0 }); d.harp(t + i * 0.07, m, 0.7, { prio: 0 }); });
    const u = t + 0.3;
    d.brassChord(u, [62, 66, 69, 74], 0.62, 0.85, { gain: 0.1, release: 0.25 }); d.horn(u, 81, 0.62, 0.9, { sect: 'tpt', release: 0.3 });
    d.glock(u, 98, 0.8, { prio: 0 }); d.glock(u + 0.1, 93, 0.5, { prio: 0 }); d.timpani(u, 38, 0.6); d.sizzle(u, 0.8);
    [74, 78].forEach((m) => d.strings(u, m + 12, 0.7, 0.7, { sect: 'vln', attack: 0.03, release: 0.3, gain: 0.016 }));
    return 1.6;
  },
  jpgain(d, t) { d.glock(t, 88, 0.8, { prio: 0 }); d.glock(t + 0.075, 93, 0.85, { prio: 0 }); d.harp(t + 0.075, 81, 0.5, { prio: 0 }); return 0.8; },
  recruit(d, t) {
    mel([[0, 1.5, 57], [1.5, 0.5, 62], [2, 2, 64], [4, 6, 66]], t, 0.11, (at, dur, m) => d.horn(at, m, dur - 0.02, 0.85, { attack: 0.03, release: 0.3, gain: 0.12 }));
    const u = t + 0.44;
    [57, 62, 66, 69].forEach((m, i) => d.strings(u, m, 0.9, 0.75, { sect: 'pad', attack: 0.08, release: 0.5, gain: 0.02, pan: -0.38 + i * 0.26 }));
    [50, 57, 62, 66, 69, 74, 78].forEach((m, i) => d.harp(u + i * 0.045, m, 0.65, { prio: 0 }));
    d.contrabass(u, 38, 0.9, 0.6); d.timpani(u, 38, 0.55); d.glock(u + 0.35, 90, 0.4, { prio: 0 });
    return 2.0;
  },
  save(d, t) {
    [81, 85, 88].forEach((m, i) => d.glock(t + i * 0.09, m, 0.55 + i * 0.08, { prio: 0 }));
    d.harp(t + 0.18, 69, 0.5, { prio: 0 }); d.harp(t + 0.2, 76, 0.45, { prio: 0 });
    d.strings(t + 0.18, 81, 0.6, 0.5, { sect: 'vln', attack: 0.05, release: 0.35, gain: 0.012 });
    return 1.2;
  },
};
