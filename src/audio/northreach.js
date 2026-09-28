// Chapter II score (round 14): "The Hollow Crown". All original; late-1990s-style sequenced orchestra, now with bells
// (foundry.bell: tubular chime + cast great bell), celesta and a pipe organ (synth.organ). The "Echoes" leitmotif
// (5 - 1 - 2 - 3, a dotted rise from the dominant, then a step to the third) runs through every piece:
//
//   worldmap (north)  "The Northreach"        D dorian, 3/4, q = 78 (bar 2.31 s). 2-bar intro + 16-bar loop x 2
//        orchestrations (77 s cycle). Open-fifth cellos/basses, cold high string pad, celesta "snowfall" ostinato,
//        rolled harp, distant tubular bell tolls; solo horn states the motif (A D E F), violins answer; second pass
//        flute + celesta doubling, horn/violins in octaves with a soft choir. The dorian B natural (G major chord) is the chill.
//   battle (ch2)      calm "Cold Iron Vigil"  G minor lament (motif D G A Bb), clarinet / solo horn, bell every 4 bars.
//                     hot  "The Bell Tithe"   G minor march, bells on the downbeats, Neapolitan Ab in the B phrase ->
//                          "Crown of Frost"   Eb major -> G minor: trumpet tune over a gallop, ends on D7.
//        Same 120 BPM / 2 s grid as Chapter I, same Sequencer rules (hysteresis, 8-bar hold, heat-driven layers).
//   battle (boss)     "Knell of the Founder"  C minor, 144 BPM (bar 1.67 s), 2-bar great-bell intro + 16-bar loop.
//        3+3+2 driving 16th spiccato, tolling tubular bells on every downbeat, great bell on the phrase heads, choir,
//        big brass; B phrase gives the motif (G C D Eb) to choir + trumpets over the Neapolitan Db. Layers by intensity.
//   battle (final)    "The Great Bell"        D minor, 132 BPM (bar 1.82 s), 4-bar organ/great-bell intro + 16-bar loop.
//        The motif turned sinister (A D Eb F, flat second) on organ, low brass and choir; in the B phrase the horns
//        answer with the ORIGINAL motif (A D E F) against it: full tutti.
//   finalVictory      "The Bell Falls Silent" ~10 s: last toll, organ Bb -> D major, horns sing the motif in D major.
//
// Every battle function is (engine, bar, t0, { level, intensity, pass }) like score.js; the Sequencer in audio.js gets
// the bar length from FLAVOURS. Every layer thins as `intensity` falls.
import { voiceLead, stack } from './score.js';

const N = {
  Dm: { bass: 38, pcs: [2, 5, 9] }, G: { bass: 43, pcs: [7, 11, 2] }, Bb: { bass: 46, pcs: [10, 2, 5] }, F: { bass: 41, pcs: [5, 9, 0] },
  C: { bass: 36, pcs: [0, 4, 7] }, Asus: { bass: 45, pcs: [9, 2, 4] }, A: { bass: 45, pcs: [9, 1, 4] }, Am: { bass: 45, pcs: [9, 0, 4] },
  Gm: { bass: 43, pcs: [7, 10, 2] }, A7: { bass: 45, pcs: [9, 1, 4, 7] }, Eb: { bass: 39, pcs: [3, 7, 10] }, Cm: { bass: 36, pcs: [0, 3, 7] },
  D: { bass: 38, pcs: [2, 6, 9] }, D7: { bass: 38, pcs: [2, 6, 9, 0] }, Dsus: { bass: 38, pcs: [2, 7, 9] }, Ab: { bass: 44, pcs: [8, 0, 3] },
  Fm: { bass: 41, pcs: [5, 8, 0] }, Db: { bass: 37, pcs: [1, 5, 8] }, G7: { bass: 43, pcs: [7, 11, 2, 5] }, Bbm: { bass: 46, pcs: [10, 1, 5] },
  Cs7: { bass: 37, pcs: [1, 4, 7, 10] },
};
const S16 = (bar) => bar / 16;
const MIX = 0.85;   // boss / final trim: their tutti sits ~1.5 dB over the chapter rotation otherwise (measured r14)
const mel = (notes, t0, S, fn) => { for (const [s, len, m] of notes || []) fn(t0 + s * S, len * S, m, s); };
// split-bar progressions ('Asus|A'): per bar [{ ch, v, off, len }] (off/len as fractions of the bar)
function segments(prog, n, lo, hi, start) {
  const flat = []; prog.forEach((c, b) => { const parts = c.split('|'); parts.forEach((nm, h) => flat.push({ b, nm, off: h / parts.length, len: 1 / parts.length })); });
  const V = voiceLead(flat.map((x) => x.nm), n, lo, hi, start, N);
  const out = prog.map(() => []); flat.forEach((x, i) => out[x.b].push({ ch: N[x.nm], v: V[i], off: x.off, len: x.len })); return out;
}
// a chord's root as a pitch in [lo, lo + 12)
const rootIn = (ch, lo) => { const pc = (ch.root ?? ch.bass) % 12; let m = lo; while (((m % 12) + 12) % 12 !== pc) m++; return m; };

// =============================================================================================================
// WORLD MAP (north) — "The Northreach"
const W_PROG = ['Dm', 'Dm', 'G', 'Dm', 'Bb', 'F', 'C', 'Asus|A', 'Dm', 'Am', 'Bb', 'F', 'Gm', 'Bb', 'Asus', 'A'];
const W_MEL = [ // 8th slots, 6 per 3/4 bar
  [[0, 3, 69], [3, 1, 74], [4, 2, 76]], [[0, 5, 77], [5, 1, 76]], [[0, 2, 74], [2, 2, 71], [4, 2, 74]], [[0, 6, 69]],
  [[0, 3, 70], [3, 1, 74], [4, 2, 77]], [[0, 4, 72], [4, 2, 77]], [[0, 2, 79], [2, 2, 76], [4, 2, 72]], [[0, 3, 74], [3, 3, 73]],
  [[0, 3, 69], [3, 1, 74], [4, 2, 76]], [[0, 3, 72], [3, 1, 76], [4, 2, 81]], [[0, 4, 82], [4, 2, 81]], [[0, 6, 77]],
  [[0, 2, 79], [2, 2, 77], [4, 2, 74]], [[0, 3, 77], [3, 1, 76], [4, 2, 74]], [[0, 6, 74]], [[0, 4, 73], [4, 2, 76]],
];
const SNOW = [[5, 3, 4, 2, 3, 1], [4, 5, 3, 4, 2, 3]];
export function northTheme() {
  const D = 3 * 60 / 78, S = D / 6, L = 1.9;
  const all = segments(['Dm', 'Dm', ...W_PROG], 4, 57, 79, [62, 69, 74, 77]);
  const sI = all.slice(0, 2), sB = all.slice(2);
  const low = (e, g, t0, lv, a = 0.6) => g.forEach((s) => {
    const t = t0 + s.off * D, d = s.len * D;
    e.contrabass(t, s.ch.bass, d - 0.04, 0.42 * lv, { attack: a });
    const c = s.ch.bass + 12; e.strings(t, c, d + 0.05, 0.55 * lv, { sect: 'cello', attack: a, release: 0.6, gain: 0.02, bow: false });
    if (s.ch.pcs.includes((s.ch.bass + 7) % 12)) e.strings(t, c + 7, d + 0.05, 0.45 * lv, { sect: 'cello', attack: a + 0.1, release: 0.6, gain: 0.016, bow: false, prio: 2 });
  });
  const pad = (e, g, t0, lv, gain) => g.forEach((s) => s.v.forEach((m, i) => e.strings(t0 + s.off * D, m, s.len * D + 0.2, 0.6 * lv, { sect: i >= 2 ? 'vln' : 'pad', attack: 0.7, release: 0.8, gain: gain * (i >= 2 ? 0.7 : 1), pan: -0.45 + i * 0.3, bow: false, prio: 1 })));
  const snow = (e, g, t0, lv, fig) => { for (let i = 0; i < 6; i++) { const s = g.length > 1 && i >= 3 ? g[1] : g[0]; e.celesta(t0 + i * S, stack(s.ch, 74, 6)[fig[i]], (i === 0 ? 0.62 : 0.4) * lv, { prio: 2, pan: 0.15 + (fig[i] / 5) * 0.35 }); } };
  const roll = (e, g, t0, lv) => { const hs = stack(g[0].ch, 50, 7); hs.forEach((m, i) => e.harp(t0 + i * 0.045, m, (0.5 - i * 0.03) * lv, { prio: 1, gain: 0.08 })); };
  return {
    name: 'worldmap', region: 'north', key: 'D dorian', dur: () => D,
    play(e, n, t0) {
      if (n < 2) {
        const lv = L * (0.7 + n * 0.12); low(e, sI[n], t0, lv, 1.2);
        if (n === 0) e.bell(t0 + 0.05, 62, 0.45 * lv, { gain: 0.06, pan: 0.35 });
        snow(e, sI[n], t0, lv * 0.9, SNOW[0]); if (n === 1) pad(e, sI[n], t0, lv, 0.008);
        return;
      }
      const k = (n - 2) % 16, pass = Math.floor((n - 2) / 16) % 2, B = k >= 8, g = sB[k];
      const lv = L * (B ? 1 : 0.92) * (k === 15 ? 0.94 : 1);
      low(e, g, t0, lv);
      pad(e, g, t0, lv, B ? 0.011 : 0.009);
      if (pass === 1 || k >= 4) snow(e, g, t0, lv, SNOW[pass]);
      if (k % 4 === 0) roll(e, g, t0, lv); else if (k % 2 === 0) e.harp(t0 + 3 * S, stack(g[0].ch, 62, 4)[2], 0.34 * lv, { prio: 2, gain: 0.08 });
      // melody
      if (pass === 0) {
        if (!B) mel(W_MEL[k], t0, S, (t, d, m) => e.horn(t, m - 12, d - 0.03, 0.8 * lv, { attack: 0.08, release: 0.35, gain: 0.12 }));
        else {
          mel(W_MEL[k], t0, S, (t, d, m) => e.strings(t, m, d - 0.03, 0.72 * lv, { sect: 'vln', attack: 0.12, release: 0.4, gain: 0.02 }));
          mel(W_MEL[k], t0, S, (t, d, m) => e.horn(t, m - 12, d - 0.03, 0.45 * lv, { attack: 0.12, release: 0.35, gain: 0.1 }));
        }
      } else if (!B) {
        mel(W_MEL[k], t0, S, (t, d, m) => e.wind(t, m, d - 0.03, 0.8 * lv, { sect: 'flute' }));
        mel(W_MEL[k], t0, S, (t, d, m, s) => { if (d >= 2 * S) e.celesta(t, m + 12, 0.42 * lv, { prio: 2 }); });
      } else {
        mel(W_MEL[k], t0, S, (t, d, m) => { e.horn(t, m - 12, d - 0.03, 0.78 * lv, { attack: 0.07, release: 0.35, gain: 0.12 }); e.strings(t, m, d - 0.03, 0.62 * lv, { sect: 'vln', attack: 0.08, release: 0.35, gain: 0.018 }); });
        e.choir(t0, g[0].v[1], D + 0.2, 0.55 * lv, { attack: 0.9, release: 0.9 });
      }
      // distant bells: the phrase heads toll, softly (the tolling is what the Northreach fears)
      if (k === 0) e.bell(t0 + 0.02, 62, 0.5 * lv, { gain: 0.06, pan: 0.35 });
      if (k === 8) e.bell(t0 + 0.02, 57, 0.45 * lv, { gain: 0.06, pan: 0.35 });
      if (k === 12 && pass === 1) e.bell(t0 + 0.02, 55, 0.4 * lv, { gain: 0.055, great: true, pan: 0.1 });
      if (k === 7 || k === 15) for (let i = 0; i < 6; i++) e.timpani(t0 + 3 * S + i * S / 2, 45, (0.14 + 0.3 * i / 5) * lv, { gain: 0.14 });
      if (k === 0 && pass === 0) e.timpani(t0, 38, 0.35 * lv, { gain: 0.16 });
    },
  };
}

// =============================================================================================================
// CHAPTER II BATTLE (120 BPM, 2 s bars)
export const CH2_BAR = 2;
// ---- "The Bell Tithe" (G minor march)
const A_PROG = ['Gm', 'Eb', 'Cm', 'D', 'Gm', 'Bb', 'Cm', 'D7', 'Eb', 'Bb', 'Cm', 'Gm', 'Ab', 'Cm', 'D', 'D7'];
const A_MEL = [
  [[0, 3, 62], [3, 1, 67], [4, 4, 69], [8, 8, 70]], [[0, 4, 70], [4, 4, 67], [8, 4, 63], [12, 4, 67]],
  [[0, 3, 63], [3, 1, 67], [4, 4, 72], [8, 6, 75], [14, 2, 74]], [[0, 4, 74], [4, 4, 72], [8, 8, 66]],
  [[0, 3, 62], [3, 1, 67], [4, 4, 69], [8, 4, 70], [12, 4, 74]], [[0, 6, 77], [6, 2, 75], [8, 4, 74], [12, 4, 70]],
  [[0, 4, 72], [4, 2, 70], [6, 2, 72], [8, 4, 75], [12, 4, 72]], [[0, 8, 69], [8, 4, 66], [12, 4, 62]],
  [[0, 3, 67], [3, 1, 70], [4, 4, 75], [8, 8, 79]], [[0, 4, 77], [4, 4, 74], [8, 8, 70]],
  [[0, 3, 72], [3, 1, 75], [4, 4, 79], [8, 6, 75], [14, 2, 74]], [[0, 8, 74], [8, 4, 70], [12, 4, 67]],
  [[0, 4, 72], [4, 4, 75], [8, 8, 80]], [[0, 4, 79], [4, 4, 75], [8, 4, 72], [12, 4, 75]],
  [[0, 6, 74], [6, 2, 72], [8, 4, 69], [12, 4, 66]], [[0, 8, 66], [8, 4, 69], [12, 4, 72]],
];
const A_DYN = [0.8, 0.82, 0.86, 0.94, 0.86, 0.94, 1.0, 1.1, 0.9, 0.94, 1.0, 1.02, 1.06, 1.1, 1.16, 1.0];
const A_PAD = voiceLead(A_PROG, 4, 55, 74, [58, 62, 67, 70], N);
const A_STAB = voiceLead(A_PROG, 3, 60, 75, [62, 67, 70], N);
const A_OST = [0, 0, 7, 0, 0, 7, 0, 12];
const A_SNARE = [1, 0, 0.3, 0.3, 0.7, 0, 0.3, 0, 1, 0, 0.3, 0.3, 0.7, 0.3, 0.4, 0.5];
const AT = { pad: 0, bass: 0, bells: 0, lead: 0.12, timp: 0.2, ostinato: 0.3, counter: 0.34, snare: 0.4, stabs: 0.48, crash: 0.45, sizzle: 0.6, choir: 0.66, great: 0.7 };
export function scheduleTithe(e, bar, t0, opts = {}) {
  const b = ((bar % 16) + 16) % 16, pass = opts.pass ?? Math.floor(bar / 16), ch = N[A_PROG[b]], B = b >= 8;
  const intensity = opts.intensity ?? 1; const lvl = (opts.level ?? 1) * A_DYN[b] * (0.62 + 0.38 * intensity);
  const on = (k) => intensity >= AT[k]; const S = S16(CH2_BAR); const at = (s) => t0 + s * S; const cad = b === 7 || b === 15;
  const bell = rootIn(ch, 60);
  if (pass % 2 && !B) { for (const s of [0, 4, 8, 12]) e.pizz(at(s), ch.bass, (s === 0 ? 1 : 0.7) * lvl); e.contrabass(t0, ch.bass, CH2_BAR - 0.05, 0.45 * lvl); }
  else e.contrabass(t0, ch.bass, CH2_BAR - 0.05, 0.8 * lvl);
  if (on('ostinato')) for (let i = 0; i < 8; i++) e.stacStrings(at(i * 2), ch.bass + 12 + A_OST[i], (i % 2 ? 0.66 : 0.95) * lvl);
  A_PAD[b].forEach((m, i) => e.strings(t0, m, CH2_BAR + 0.08, 0.76 * lvl, { sect: 'pad', pan: -0.4 + i * 0.26, attack: 0.2, gain: 0.025 }));
  // bells: the Crown's toll on the downbeat of every other bar, answered a fourth below on the dominant bars
  if (on('bells') && b % 2 === 0) e.bell(at(0), bell, (b % 4 === 0 ? 0.9 : 0.7) * lvl, { gain: 0.085 });
  if (on('bells') && (b === 3 || b === 11)) { e.bell(at(0), 62, 0.75 * lvl, { gain: 0.08 }); e.bell(at(8), 57, 0.6 * lvl, { gain: 0.075 }); }
  if (on('great') && (b === 0 || b === 8)) e.bell(at(0), 55, 0.8 * lvl, { great: true, gain: 0.07 });
  if (on('stabs')) for (const s of cad ? [0, 4, 8, 10, 12, 14] : [6, 12]) e.brassChord(at(s), [ch.bass + 12, ...A_STAB[b]], s === 12 && cad ? 0.4 : 0.13, (s % 4 === 0 ? 1 : 0.8) * lvl, { gain: 0.11 });
  if (on('lead')) for (const [s, len, m] of A_MEL[b]) {
    const dur = len * S - 0.03; e.horn(at(s), m, dur, (s % 4 === 0 ? 1 : 0.85) * lvl);
    if (B || pass % 4 === 3) e.strings(at(s), m + 12, dur, 0.52 * lvl, { sect: 'vln', attack: 0.05, release: 0.13, gain: 0.017 });
  }
  if (on('counter') && B) e.strings(t0, A_PAD[b][1], CH2_BAR - 0.05, 0.6 * lvl, { sect: 'viola', attack: 0.12, release: 0.2, gain: 0.02 });
  if (on('choir') && B) e.choir(t0, A_PAD[b][2], CH2_BAR + 0.1, 0.8 * lvl);
  const tp = [43, 38].filter((m) => ch.pcs.includes(m % 12));
  if (on('timp') && tp.length) { e.timpani(at(0), tp[0], lvl); e.timpani(at(8), tp[tp.length - 1], 0.72 * lvl); }
  if (cad) {
    if (on('timp')) for (let i = 0; i < 8; i++) e.timpani(at(8 + i), 38, (0.25 + 0.7 * i / 7) * lvl, { gain: 0.19 });
    if (on('snare')) for (let i = 0; i < 8; i++) e.snare(at(8 + i), (0.4 + 0.6 * i / 7) * lvl);
    if (on('sizzle')) e.cymSwell(at(8), CH2_BAR / 2 - 0.05, 0.9 * lvl);
  } else if (on('snare')) A_SNARE.forEach((v, i) => v && e.snare(at(i), v * lvl));
  if (on('sizzle') && !cad) for (let i = 0; i < 4; i++) e.sizzle(at(i * 4 + 2), (i % 2 ? 0.65 : 1) * lvl, { gain: 0.024 });
  if ((b === 0 || b === 8) && on('crash')) e.crash(at(0), 0.9 * lvl);
}
// ---- "Crown of Frost" (Eb major -> G minor gallop)
const F_PROG = ['Eb', 'Bb', 'Cm', 'Gm', 'Ab', 'Eb', 'F', 'Bb', 'Cm', 'Ab', 'Eb', 'Bb', 'Cm', 'Ab', 'D', 'D7'];
const F_MEL = [
  [[0, 3, 70], [3, 1, 70], [4, 4, 75], [8, 3, 77], [11, 1, 79], [12, 4, 77]], [[0, 6, 74], [6, 2, 75], [8, 4, 77], [12, 4, 70]],
  [[0, 3, 72], [3, 1, 74], [4, 4, 75], [8, 4, 79], [12, 4, 77]], [[0, 8, 74], [8, 4, 70], [12, 4, 67]],
  [[0, 3, 72], [3, 1, 72], [4, 4, 75], [8, 4, 80], [12, 4, 79]], [[0, 6, 79], [6, 2, 77], [8, 4, 75], [12, 4, 79]],
  [[0, 4, 77], [4, 4, 81], [8, 4, 84], [12, 4, 81]], [[0, 8, 82], [8, 4, 77], [12, 4, 74]],
  [[0, 3, 75], [3, 1, 75], [4, 4, 79], [8, 4, 84], [12, 4, 79]], [[0, 6, 80], [6, 2, 79], [8, 4, 75], [12, 4, 72]],
  [[0, 3, 75], [3, 1, 77], [4, 4, 79], [8, 4, 82], [12, 4, 84]], [[0, 8, 86], [8, 4, 82], [12, 4, 77]],
  [[0, 4, 84], [4, 4, 79], [8, 4, 75], [12, 4, 79]], [[0, 4, 80], [4, 4, 77], [8, 4, 72], [12, 4, 75]],
  [[0, 8, 78], [8, 4, 74], [12, 4, 72]], [[0, 6, 74], [6, 2, 72], [8, 8, 66]],
];
const F_DYN = [0.84, 0.86, 0.9, 0.92, 0.9, 0.96, 1.02, 1.08, 0.92, 0.96, 1.02, 1.12, 1.04, 1.08, 1.14, 1.0];
const F_PAD = voiceLead(F_PROG, 4, 53, 74, [55, 58, 63, 67], N);
const F_HORN = voiceLead(F_PROG, 3, 58, 72, [58, 63, 67], N);
const GALLOP = [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15];
const FT = { pad: 0, bass: 0, bells: 0, lead: 0.1, harp: 0.15, timp: 0.2, gallop: 0.3, horns: 0.35, snare: 0.4, bd: 0.45, crash: 0.45, doubling: 0.55, sizzle: 0.6, choir: 0.7 };
export function scheduleFrost(e, bar, t0, opts = {}) {
  const b = ((bar % 16) + 16) % 16, pass = opts.pass ?? Math.floor(bar / 16), ch = N[F_PROG[b]], B = b >= 8;
  const intensity = opts.intensity ?? 1; const lvl = (opts.level ?? 1) * F_DYN[b] * (0.62 + 0.38 * intensity);
  const on = (k) => intensity >= FT[k]; const S = S16(CH2_BAR); const at = (s) => t0 + s * S; const cad = b === 7 || b === 15; const vary = pass % 2 === 1;
  const cel = ch.bass + 12;
  e.contrabass(t0, ch.bass, CH2_BAR / 2 - 0.04, 0.85 * lvl); e.contrabass(at(8), ch.bass + (cad ? 0 : 7), CH2_BAR / 2 - 0.04, 0.7 * lvl);
  if (on('gallop')) GALLOP.forEach((s, i) => e.stacStrings(at(s), cel + (i % 3 === 0 ? 0 : (s >= 8 && vary ? 7 : 12)), (i % 3 === 0 ? 0.95 : 0.62) * lvl, { dur: 0.085 }));
  F_PAD[b].forEach((m, i) => e.strings(t0, m, CH2_BAR + 0.08, 0.72 * lvl, { sect: 'pad', pan: -0.4 + i * 0.26, attack: 0.2, gain: 0.024 }));
  if (on('horns')) {
    const hv = F_HORN[b];
    if (!B) { e.brassChord(t0, hv, CH2_BAR / 2 - 0.05, 0.8 * lvl, { gain: 0.1, sub: false }); e.brassChord(at(8), hv, CH2_BAR / 2 - 0.05, 0.75 * lvl, { gain: 0.09, sub: false }); }
    else for (const s of cad ? [0, 4, 8, 12] : [2, 6, 10, 14]) e.brassChord(at(s), [cel, ...hv], 0.14, (cad ? 1 : 0.8) * lvl, { gain: 0.1 });
  }
  if (on('lead')) for (const [s, len, m] of F_MEL[b]) {
    const dur = len * S - 0.03; e.horn(at(s), m, dur, (s % 4 === 0 ? 1 : 0.86) * lvl, { sect: 'tpt' });
    if (on('doubling') && (B || vary)) e.strings(at(s), m + 12, dur, 0.5 * lvl, { sect: 'vln', attack: 0.04, release: 0.12, gain: 0.016 });
    else if (vary) e.horn(at(s), m - 12, dur, 0.55 * lvl, { gain: 0.11 });
  }
  // bells: a frozen chime on the phrase heads; the chime doubles the tune's long notes in the B phrase
  if (on('bells') && b % 4 === 0) e.bell(at(0), rootIn(ch, 62), 0.8 * lvl, { gain: 0.08 });
  if (on('bells') && B && b % 4 !== 0) for (const [s, len, m] of F_MEL[b]) if (len >= 6) e.bell(at(s), m - 12, 0.5 * lvl, { gain: 0.06, prio: 1 });
  if (on('harp')) { const hs = stack(ch, 60, 8); if (cad) for (let i = 0; i < 16; i++) e.harp(at(i), hs[i % 8] + (i >= 8 ? 12 : 0), 0.6 * lvl, { prio: 2 }); else for (let i = 0; i < 8; i++) e.harp(at(i * 2), hs[i], (i % 4 === 0 ? 0.9 : 0.6) * lvl, { prio: 2 }); }
  if (B && on('choir')) e.choir(t0, F_PAD[b][2], CH2_BAR + 0.1, 0.8 * lvl);
  const tp = [43, 38].filter((m) => ch.pcs.includes(m % 12));
  if (on('timp') && tp.length) { e.timpani(at(0), tp[0], lvl); e.timpani(at(8), tp[tp.length - 1], 0.7 * lvl); }
  if (on('timp') && !tp.length) e.timpani(at(0), ch.bass, 0.8 * lvl);
  if (cad && on('timp')) for (let i = 0; i < 8; i++) e.timpani(at(8 + i), 38, (0.3 + 0.6 * i / 7) * lvl, { gain: 0.18 });
  if (on('bd') && b % 4 === 0) e.bassDrum(at(0), 0.6 * lvl);
  if (on('snare')) {
    for (const [s, v] of [[0, 1], [3, 0.35], [4, 0.8], [6, 0.4], [8, 0.9], [11, 0.35], [12, 0.8], [14, 0.45], [15, 0.5]]) e.snare(at(s), v * lvl);
    if (cad) for (let i = 0; i < 8; i++) e.snare(at(8 + i), (0.4 + 0.6 * i / 7) * lvl);
  }
  if (on('sizzle')) for (let i = 0; i < 4; i++) e.sizzle(at(i * 4 + 2), 0.8 * lvl, { gain: 0.022 });
  if ((b === 0 || b === 8) && on('crash')) e.crash(at(0), lvl);
  if (cad && on('sizzle')) e.cymSwell(at(8), CH2_BAR / 2 - 0.05, 0.9 * lvl);
}
// ---- "Cold Iron Vigil" (G minor, the calm bed)
const V_PROG = ['Gm', 'Gm', 'Eb', 'Eb', 'Cm', 'Cm', 'Dsus', 'D', 'Bb', 'Bb', 'F', 'Gm', 'Eb', 'Cm', 'D', 'D'];
const V_MEL = [
  [[0, 6, 62], [6, 2, 67], [8, 8, 69]], [[0, 16, 70]], [[0, 8, 70], [8, 8, 67]], [[0, 16, 67]],
  [[0, 6, 63], [6, 2, 67], [8, 8, 72]], [[0, 8, 75], [8, 8, 74]], [[0, 16, 69]], [[0, 8, 66], [8, 8, 69]],
  [[0, 6, 65], [6, 2, 70], [8, 8, 72]], [[0, 16, 74]], [[0, 8, 72], [8, 8, 69]], [[0, 16, 70]],
  [[0, 8, 67], [8, 8, 70]], [[0, 8, 75], [8, 8, 72]], [[0, 16, 69]], [[0, 8, 66], [8, 8, 62]],
];
const V_DYN = [0.9, 0.88, 0.92, 0.9, 0.94, 0.92, 0.96, 1.0, 0.98, 0.94, 0.96, 0.92, 0.9, 0.94, 1.0, 0.86];
const V_PAD = voiceLead(V_PROG, 4, 53, 74, [55, 62, 67, 70], N);
const VT = { pad: 0, bass: 0, bells: 0, harp: 0.18, lead: 0.15, celesta: 0.25, choir: 0.32, timp: 0.55 };
export function scheduleColdVigil(e, bar, t0, opts = {}) {
  const b = ((bar % 16) + 16) % 16, pass = opts.pass ?? Math.floor(bar / 16), ch = N[V_PROG[b]];
  const intensity = opts.intensity ?? 1; const lvl = (opts.level ?? 1) * V_DYN[b] * (0.68 + 0.32 * intensity) * 1.9;
  const on = (k) => intensity >= VT[k]; const S = S16(CH2_BAR); const at = (s) => t0 + s * S; const alt = pass % 2 === 1;
  e.contrabass(t0, ch.bass, CH2_BAR - 0.06, (b === 15 ? 0.45 : 0.6) * lvl, { attack: 0.12 });
  V_PAD[b].forEach((m, i) => e.strings(t0, m, CH2_BAR + 0.16, 0.72 * lvl, { sect: 'pad', attack: 0.5, release: 0.55, gain: 0.017, pan: -0.38 + i * 0.26 }));
  if (on('lead')) for (const [s, len, m] of V_MEL[b]) {
    const dur = len * S - 0.04;
    if (alt) e.horn(at(s), m - 12, dur, 0.42 * lvl, { attack: 0.12, release: 0.3, gain: 0.12 });
    else e.wind(at(s), m - 12, dur, 0.7 * lvl, { sect: 'clar', attack: 0.08, release: 0.3 });
  }
  if (on('bells') && b % 4 === 0) e.bell(at(0), rootIn(ch, 55), 0.55 * lvl, { gain: 0.055, great: b === 0 });
  if (on('celesta') && b % 2 === 1) { const hs = stack(ch, 79, 3); e.celesta(at(4), hs[2], 0.4 * lvl, { prio: 2 }); e.celesta(at(10), hs[1], 0.32 * lvl, { prio: 2 }); }
  if (on('choir')) e.choir(t0, V_PAD[b][1] + 12, CH2_BAR + 0.1, 0.62 * lvl);
  if (on('harp')) { const hs = stack(ch, 55, 4); [0, 4, 8, 12].forEach((s, i) => e.harp(at(s), hs[i], (i === 0 ? 0.5 : 0.3) * lvl, { gain: 0.075 })); }
  if ((b === 0 || b === 8) && on('timp')) e.timpani(t0, ch.bass === 43 ? 43 : 38, 0.5 * lvl);
  if (b === 15 && on('timp')) for (let i = 0; i < 8; i++) e.timpani(at(8 + i), 38, (0.18 + 0.5 * i / 7) * lvl, { gain: 0.14 });
}
export function scheduleCh2Tense(e, bar, t0, opts = {}) {
  const block = Math.floor(bar / 16); const pass = Math.floor(block / 2);
  return (block % 2 === 0 ? scheduleTithe : scheduleFrost)(e, bar, t0, { ...opts, pass });
}

// =============================================================================================================
// BOSS — "Knell of the Founder" (C minor, 144 BPM)
export const BOSS_BAR = 4 * 60 / 144;
const K_PROG = ['Cm', 'Cm', 'Ab', 'G', 'Cm', 'Fm', 'Db', 'G7', 'Fm', 'Cm', 'Ab', 'Eb', 'Fm', 'Db', 'G', 'G7'];
const K_MEL = [
  [[0, 3, 67], [3, 1, 72], [4, 4, 74], [8, 8, 75]], [[0, 4, 75], [4, 4, 74], [8, 4, 72], [12, 4, 67]],
  [[0, 3, 68], [3, 1, 72], [4, 4, 75], [8, 6, 77], [14, 2, 75]], [[0, 8, 74], [8, 4, 71], [12, 4, 67]],
  [[0, 3, 67], [3, 1, 72], [4, 4, 74], [8, 4, 75], [12, 4, 79]], [[0, 6, 80], [6, 2, 79], [8, 4, 77], [12, 4, 72]],
  [[0, 4, 77], [4, 4, 80], [8, 4, 73], [12, 4, 77]], [[0, 8, 74], [8, 4, 71], [12, 4, 65]],
  [[0, 8, 77], [8, 4, 80], [12, 4, 84]], [[0, 8, 79], [8, 4, 75], [12, 4, 72]],
  [[0, 4, 75], [4, 4, 80], [8, 8, 84]], [[0, 8, 82], [8, 4, 79], [12, 4, 75]],
  [[0, 4, 77], [4, 4, 80], [8, 4, 84], [12, 4, 80]], [[0, 8, 85], [8, 4, 80], [12, 4, 77]],
  [[0, 8, 79], [8, 4, 74], [12, 4, 71]], [[0, 4, 74], [4, 4, 77], [8, 4, 74], [12, 4, 71]],
];
const K_DYN = [0.9, 0.9, 0.94, 1.0, 0.92, 0.96, 1.0, 1.1, 0.96, 0.98, 1.02, 1.06, 1.04, 1.1, 1.14, 1.08];
const K_PAD = voiceLead(K_PROG, 4, 55, 75, [60, 63, 67, 72], N);
const K_OST = [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0, 0, 12, 8, 7];       // 3+3+2 accents over 16ths
const K_ACC = new Set([0, 3, 6, 8, 11, 14]);
const KT = { pad: 0, bass: 0, bells: 0, ostinato: 0.15, lead: 0.2, timp: 0.2, choir: 0.35, stabs: 0.42, bd: 0.45, crash: 0.45, snare: 0.55, great: 0.5, doubling: 0.6, sizzle: 0.66, answer: 0.5 };
function bossIntro(e, i, t0, lvl) {
  const S = S16(BOSS_BAR), at = (s) => t0 + s * S;
  e.bell(at(0), 48, 1.0 * lvl, { great: true, gain: 0.1 }); e.bell(at(8), 55, 0.8 * lvl, { great: true, gain: 0.08 });
  e.contrabass(t0, 36, BOSS_BAR - 0.05, 0.8 * lvl, { attack: 0.3 });
  e.brassChord(t0, i ? [43, 48, 55, 60] : [48, 55, 60], BOSS_BAR - 0.08, (0.55 + i * 0.3) * lvl, { gain: 0.1 });
  e.choir(t0, i ? 67 : 63, BOSS_BAR + 0.1, (0.55 + i * 0.25) * lvl, { attack: 0.5 }); e.choir(t0, 60, BOSS_BAR + 0.1, (0.5 + i * 0.25) * lvl, { attack: 0.5 });
  for (let k = 0; k < 8; k++) e.timpani(at(8 + k), i ? 43 : 36, (0.2 + 0.6 * k / 7) * lvl * (i ? 1 : 0.6), { gain: 0.2 });
  if (i) { for (let k = 0; k < 8; k++) e.snare(at(8 + k), (0.3 + 0.6 * k / 7) * lvl); e.cymSwell(at(8), BOSS_BAR / 2 - 0.05, lvl); }
}
export function scheduleKnell(e, bar, t0, opts = {}) {
  const intensity = opts.intensity ?? 1;
  if (bar < 2) return bossIntro(e, bar, t0, (opts.level ?? 1) * MIX * (0.7 + 0.3 * intensity));
  bar -= 2;
  const b = ((bar % 16) + 16) % 16, pass = Math.floor(bar / 16), ch = N[K_PROG[b]], B = b >= 8;
  const lvl = (opts.level ?? 1) * MIX * K_DYN[b] * (0.62 + 0.38 * intensity);
  const on = (k) => intensity >= KT[k]; const S = S16(BOSS_BAR); const at = (s) => t0 + s * S; const cad = b === 7 || b === 15;
  const bl = ch.bass;
  // foundation: bass on the 3+3+2 accents
  for (const [s, d] of [[0, 6], [6, 6], [12, 4]]) e.contrabass(at(s), bl, d * S - 0.04, (s === 0 ? 0.9 : 0.72) * lvl);
  if (on('ostinato')) for (let i = 0; i < 16; i++) e.stacStrings(at(i), bl + 12 + K_OST[i], (K_ACC.has(i) ? 0.95 : 0.55) * lvl, { dur: 0.085, prio: K_ACC.has(i) ? 1 : 2 });
  K_PAD[b].forEach((m, i) => e.strings(t0, m, BOSS_BAR + 0.08, 0.74 * lvl, { sect: 'pad', pan: -0.4 + i * 0.26, attack: 0.15, gain: 0.024 }));
  // the knell: a tubular bell on every downbeat (root), the answer a fifth below on beat 3 once the fight heats up
  if (on('bells')) e.bell(at(0), rootIn(ch, 60), (b % 4 === 0 ? 0.95 : 0.72) * lvl, { gain: 0.085 });
  if (on('answer') && !cad) e.bell(at(8), rootIn(ch, 60) - 5 < 55 ? rootIn(ch, 60) + 7 : rootIn(ch, 60) - 5, 0.55 * lvl, { gain: 0.07, prio: 1 });
  if (on('great') && (b === 0 || b === 8)) e.bell(at(0), 48, 0.9 * lvl, { great: true, gain: 0.09 });
  if (on('choir')) { const v = K_PAD[b]; if (!B) { e.choir(t0, v[2], BOSS_BAR + 0.1, 0.8 * lvl, { attack: 0.25 }); e.choir(t0, v[3], BOSS_BAR + 0.1, 0.7 * lvl, { attack: 0.25 }); } else mel(K_MEL[b], t0, S, (t, d, m) => e.choir(t, m - 12, d + 0.05, 0.9 * lvl, { attack: 0.06, release: 0.3 })); }
  if (on('stabs')) for (const s of cad ? [0, 3, 6, 8, 10, 12, 14] : [0, 6, 12]) e.brassChord(at(s), [bl + 12, ...K_PAD[b].slice(1).map((m) => m)], 0.14, (s === 0 ? 1 : 0.82) * lvl, { gain: 0.1 });
  if (on('lead')) for (const [s, len, m] of K_MEL[b]) {
    const dur = len * S - 0.03;
    if (!B) { e.horn(at(s), m - 12, dur, (s % 4 === 0 ? 1 : 0.86) * lvl, { gain: 0.14 }); if (pass % 2) e.horn(at(s), m, dur, 0.7 * lvl, { sect: 'tpt' }); }
    else { e.horn(at(s), m, dur, (s % 4 === 0 ? 1 : 0.88) * lvl, { sect: 'tpt' }); e.horn(at(s), m - 12, dur, 0.75 * lvl, { gain: 0.12 }); }
    if (on('doubling') && B) e.strings(at(s), m + 12, dur, 0.5 * lvl, { sect: 'vln', attack: 0.04, release: 0.12, gain: 0.016 });
  }
  const tp = [36, 43].filter((m) => ch.pcs.includes(m % 12));
  if (on('timp')) { for (const s of [0, 6, 12]) e.timpani(at(s), tp.length ? tp[s === 6 ? tp.length - 1 : 0] : bl, (s === 0 ? 1 : 0.7) * lvl); }
  if (cad && on('timp')) for (let i = 0; i < 8; i++) e.timpani(at(8 + i), 43, (0.3 + 0.65 * i / 7) * lvl, { gain: 0.19 });
  if (on('bd') && b % 2 === 0) e.bassDrum(at(0), 0.6 * lvl);
  if (on('snare')) { if (cad) for (let i = 0; i < 8; i++) e.snare(at(8 + i), (0.4 + 0.6 * i / 7) * lvl); else for (const [s, v] of [[4, 0.8], [12, 0.8], [14, 0.4], [15, 0.5]]) e.snare(at(s), v * lvl); }
  if (on('sizzle')) for (let i = 0; i < 4; i++) e.sizzle(at(i * 4 + 2), 0.8 * lvl, { gain: 0.022 });
  if ((b === 0 || b === 8) && on('crash')) e.crash(at(0), lvl);
  if (cad && on('sizzle')) e.cymSwell(at(8), BOSS_BAR / 2 - 0.05, 0.9 * lvl);
}

// =============================================================================================================
// FINAL — "The Great Bell" (D minor, 132 BPM)
export const FINAL_BAR = 4 * 60 / 132;
const G_PROG = ['Dm', 'Eb', 'Dm', 'A7', 'Gm', 'Eb', 'Bb', 'A', 'Dm', 'Bbm', 'F', 'Cs7', 'Gm', 'Eb', 'A', 'A7'];
const G_MEL = [ // the sinister motif: A D Eb F
  [[0, 3, 69], [3, 1, 74], [4, 4, 75], [8, 8, 77]], [[0, 4, 79], [4, 4, 77], [8, 4, 75], [12, 4, 70]],
  [[0, 3, 69], [3, 1, 74], [4, 4, 75], [8, 4, 77], [12, 4, 81]], [[0, 8, 79], [8, 4, 76], [12, 4, 73]],
  [[0, 3, 67], [3, 1, 70], [4, 4, 74], [8, 8, 79]], [[0, 6, 82], [6, 2, 79], [8, 4, 75], [12, 4, 79]],
  [[0, 4, 77], [4, 4, 74], [8, 4, 70], [12, 4, 74]], [[0, 12, 73], [12, 4, 76]],
  [[0, 6, 74], [6, 2, 77], [8, 8, 81]], [[0, 6, 77], [6, 2, 73], [8, 8, 70]],
  [[0, 4, 72], [4, 4, 77], [8, 8, 81]], [[0, 8, 82], [8, 4, 79], [12, 4, 76]],
  [[0, 6, 79], [6, 2, 74], [8, 8, 70]], [[0, 4, 75], [4, 4, 79], [8, 8, 82]],
  [[0, 8, 81], [8, 4, 76], [12, 4, 73]], [[0, 4, 76], [4, 4, 79], [8, 4, 76], [12, 4, 73]],
];
const G_HORN = [ // the ORIGINAL motif (A D E F), the company's answer in the B phrase
  [[0, 3, 57], [3, 1, 62], [4, 4, 64], [8, 8, 65]], [[0, 16, 65]], [[0, 3, 60], [3, 1, 65], [4, 4, 67], [8, 8, 69]], [[0, 16, 67]],
  [[0, 3, 62], [3, 1, 67], [4, 4, 69], [8, 8, 70]], [[0, 16, 70]], [[0, 8, 69], [8, 8, 73]], [[0, 8, 76], [8, 8, 73]],
];
const G_DYN = [0.9, 0.94, 0.96, 1.04, 0.94, 1.0, 1.04, 1.12, 1.0, 1.02, 1.06, 1.12, 1.06, 1.1, 1.16, 1.08];
const G_PAD = voiceLead(G_PROG, 4, 55, 76, [57, 62, 65, 69], N);
const G_ORG = voiceLead(G_PROG, 3, 57, 74, [62, 65, 69], N);
const GT = { pad: 0, bass: 0, organ: 0, bells: 0, lead: 0.12, timp: 0.2, ostinato: 0.25, choir: 0.35, stabs: 0.45, bd: 0.45, crash: 0.45, horns: 0.3, snare: 0.55, sizzle: 0.65, doubling: 0.6 };
function finalIntro(e, i, t0, lvl) {
  const S = S16(FINAL_BAR), at = (s) => t0 + s * S;
  const chords = [[38, 50, 57, 62, 65], [38, 51, 58, 63, 67], [38, 50, 58, 62, 65], [33, 45, 57, 61, 64, 67]];
  e.organ(at(0), chords[i], FINAL_BAR + 0.02, (0.75 + i * 0.08) * lvl, { gain: 0.085, attack: i ? 0.05 : 0.2, release: 0.2 });
  if (i < 3) e.bell(at(0), i === 1 ? 51 : 50, (1 - i * 0.1) * lvl, { great: true, gain: 0.1 });
  if (i === 1 || i === 3) e.bell(at(8), 57, 0.7 * lvl, { gain: 0.075 });
  const m = [[[0, 6, 57], [6, 2, 62], [8, 8, 63]], [[0, 16, 65]], [[0, 6, 57], [6, 2, 62], [8, 4, 63], [12, 4, 65]], [[0, 8, 64], [8, 8, 61]]][i];
  mel(m, t0, S, (t, d, x) => { e.brass(t, x - 12, d - 0.03, 0.8 * lvl, { gain: 0.08 }); e.choir(t, x, d + 0.05, 0.7 * lvl, { attack: 0.15, release: 0.4 }); });
  e.contrabass(t0, i === 3 ? 33 : 38, FINAL_BAR - 0.04, 0.8 * lvl, { attack: 0.2 });
  if (i === 3) { for (let k = 0; k < 16; k++) e.timpani(at(k), 45, (0.2 + 0.75 * k / 15) * lvl, { gain: 0.2 }); for (let k = 0; k < 8; k++) e.snare(at(8 + k), (0.3 + 0.65 * k / 7) * lvl); e.cymSwell(at(4), FINAL_BAR * 0.75 - 0.05, lvl); }
  else e.timpani(at(0), 38, 0.8 * lvl);
}
export function scheduleGreatBell(e, bar, t0, opts = {}) {
  const intensity = opts.intensity ?? 1;
  if (bar < 4) return finalIntro(e, bar, t0, (opts.level ?? 1) * MIX * (0.72 + 0.28 * intensity));
  bar -= 4;
  const b = ((bar % 16) + 16) % 16, pass = Math.floor(bar / 16), ch = N[G_PROG[b]], B = b >= 8;
  const lvl = (opts.level ?? 1) * MIX * G_DYN[b] * (0.62 + 0.38 * intensity);
  const on = (k) => intensity >= GT[k]; const S = S16(FINAL_BAR); const at = (s) => t0 + s * S; const cad = b === 7 || b === 15;
  const bl = ch.bass;
  e.contrabass(t0, bl, FINAL_BAR / 2 - 0.04, 0.9 * lvl); e.contrabass(at(8), bl, FINAL_BAR / 2 - 0.04, 0.75 * lvl);
  // organ: full chords over a 16' pedal (loud in the A phrase, under the tutti in B)
  e.organ(t0, [bl, ...G_ORG[b]], FINAL_BAR + 0.02, (B ? 0.6 : 0.85) * lvl, { gain: 0.075, attack: 0.05, release: 0.15 });
  if (on('ostinato')) for (let i = 0; i < 8; i++) e.stacStrings(at(i * 2), bl + 12 + [0, 12, 0, ch === N.Dm ? 13 : 12, 0, 12, 0, 7][i], (i % 2 ? 0.66 : 0.95) * lvl);   // over D minor the b9 (Eb) creeps into the ostinato
  if (on('ostinato') && intensity >= 0.7) for (let i = 0; i < 8; i++) e.stacStrings(at(i * 2 + 1), bl + 24, 0.5 * lvl, { dur: 0.085, sect: 'viola', prio: 2 });
  G_PAD[b].forEach((m, i) => e.strings(t0, m, FINAL_BAR + 0.08, 0.7 * lvl, { sect: 'pad', pan: -0.4 + i * 0.26, attack: 0.15, gain: 0.022 }));
  // bells: the Great Bell tolls every other bar in A, tubular bells ring the tune's heads
  if (on('bells') && ((!B && b % 2 === 0) || b === 8 || b === 12)) e.bell(at(0), b === 4 || b === 12 ? 55 : 50, 0.9 * lvl, { great: true, gain: 0.09 });
  if (on('bells') && B) for (const [s, len, m] of G_MEL[b]) if (s === 0) e.bell(at(0), m - 12, 0.6 * lvl, { gain: 0.07 });
  if (on('lead')) for (const [s, len, m] of G_MEL[b]) {
    const dur = len * S - 0.03;
    if (!B) { e.brass(at(s), m - 12, dur, (s % 4 === 0 ? 1 : 0.86) * lvl, { gain: 0.09 }); if (on('choir')) e.choir(at(s), m, dur + 0.05, 0.75 * lvl, { attack: 0.08, release: 0.3 }); }
    else { e.horn(at(s), m, dur, (s % 4 === 0 ? 1 : 0.88) * lvl, { sect: 'tpt' }); if (on('choir')) e.choir(at(s), m - 12, dur + 0.05, 0.85 * lvl, { attack: 0.06, release: 0.3 }); }
    if (on('doubling') && (B || pass % 2)) e.strings(at(s), m + 12, dur, 0.5 * lvl, { sect: 'vln', attack: 0.04, release: 0.12, gain: 0.016 });
  }
  if (B && on('horns')) mel(G_HORN[b - 8], t0, S, (t, d, m) => e.horn(t, m, d - 0.03, 0.95 * lvl, { gain: 0.14 }));
  if (on('stabs') && !B) for (const s of cad ? [0, 4, 8, 10, 12, 14] : [6, 14]) e.brassChord(at(s), [bl + 12, ...G_ORG[b]], 0.14, (s % 4 === 0 ? 1 : 0.8) * lvl, { gain: 0.1 });
  if (on('stabs') && B) for (const s of [2, 6, 10, 14]) e.brassChord(at(s), G_ORG[b], 0.13, 0.75 * lvl, { gain: 0.08, sub: false });
  const tp = [38, 45].filter((m) => ch.pcs.includes(m % 12));
  if (on('timp')) { if (tp.length) { e.timpani(at(0), tp[0], lvl); e.timpani(at(8), tp[tp.length - 1], 0.72 * lvl); } else e.timpani(at(0), bl, 0.85 * lvl); }
  if (cad && on('timp')) for (let i = 0; i < 8; i++) e.timpani(at(8 + i), 45, (0.3 + 0.65 * i / 7) * lvl, { gain: 0.19 });
  if (on('bd') && b % 4 === 0) e.bassDrum(at(0), 0.7 * lvl);
  if (on('snare')) { if (cad) for (let i = 0; i < 8; i++) e.snare(at(8 + i), (0.4 + 0.6 * i / 7) * lvl); else for (const [s, v] of [[4, 0.8], [7, 0.3], [12, 0.8], [14, 0.4], [15, 0.5]]) e.snare(at(s), v * lvl); }
  if (on('sizzle')) for (let i = 0; i < 4; i++) e.sizzle(at(i * 4 + 2), 0.8 * lvl, { gain: 0.022 });
  if ((b === 0 || b === 8) && on('crash')) e.crash(at(0), lvl);
  if (cad && on('sizzle')) e.cymSwell(at(8), FINAL_BAR / 2 - 0.05, 0.9 * lvl);
}

// Victory after the final battle — "The Bell Falls Silent" (~10.5 s). Returns its duration.
export function finalVictory(e, t0) {
  const Q = 0.6;
  e.bell(t0, 50, 0.9, { great: true, gain: 0.1 }); e.organ(t0, [34, 46, 53, 58, 62], 4 * Q, 0.7, { gain: 0.08, attack: 0.4, release: 0.6 });
  e.timpani(t0, 38, 0.6); e.contrabass(t0, 34, 4 * Q, 0.6, { attack: 0.3 });
  [[46, 50, 53, 58]].forEach((v) => v.forEach((m, i) => e.strings(t0, m + 12, 4 * Q, 0.7, { sect: 'pad', attack: 0.6, release: 0.5, gain: 0.02, pan: -0.36 + i * 0.24 })));
  // the motif in D major on the horns (A D E F#), strings swell under it
  const t1 = t0 + 2 * Q;
  mel([[0, 1.5, 57], [1.5, 0.5, 62], [2, 2, 64], [4, 4, 66]], t1, Q, (t, d, m) => e.horn(t, m, d - 0.03, 0.9, { attack: 0.06, release: 0.3, gain: 0.13 }));
  e.brassChord(t1 + 4 * Q, [45, 57, 61, 64], 2 * Q, 0.75, { gain: 0.1, release: 0.3 });
  const t2 = t1 + 6 * Q; // the D major tutti
  e.brassChord(t2, [50, 62, 66, 69, 74], 3.6, 1, { gain: 0.13, release: 0.5 }); e.horn(t2, 78, 3.4, 1, { sect: 'tpt', release: 0.5 }); e.horn(t2, 69, 3.4, 0.8, { release: 0.5 });
  e.organ(t2, [38, 50, 57, 62, 66, 69], 3.6, 0.7, { gain: 0.07, attack: 0.1, release: 0.8 });
  e.contrabass(t2, 38, 3.6, 0.8); e.timpani(t2, 38, 1); e.bassDrum(t2, 0.5); e.crash(t2, 0.8);
  e.choir(t2, 62, 3.5, 0.9, { attack: 0.3, release: 0.9 }); e.choir(t2, 66, 3.5, 0.75, { attack: 0.3, release: 0.9 }); e.choir(t2, 69, 3.5, 0.7, { attack: 0.3, release: 0.9 });
  [74, 78].forEach((m) => e.strings(t2, m, 3.4, 0.8, { sect: 'vln', attack: 0.08, release: 0.6, gain: 0.018 }));
  [62, 66, 69, 74, 78, 81, 86, 90].forEach((m, i) => e.harp(t2 + 0.03 + i * 0.05, m, 0.75, { prio: 0 }));
  [74, 78, 81, 86].forEach((m, i) => e.bell(t2 + 0.4 + i * 0.32, m - 12, 0.6, { gain: 0.06 }));
  [86, 90, 93].forEach((m, i) => e.celesta(t2 + 0.2 + i * 0.12, m, 0.5, { prio: 0 }));
  for (let i = 0; i < 6; i++) e.timpani(t2 + 2.4 + i * 0.1, 38, 0.3 + 0.4 * i / 5, { gain: 0.16 });
  e.timpani(t2 + 3.05, 38, 0.9); e.bassDrum(t2 + 3.05, 0.4);
  return t2 - t0 + 4.8;
}

// Battle "flavours": the Sequencer's calm / hot schedulers and its bar length.
export const FLAVOURS = {
  ch2: { bar: CH2_BAR, somber: scheduleColdVigil, tense: scheduleCh2Tense, tithe: scheduleTithe, frost: scheduleFrost, vigil: scheduleColdVigil },
  boss: { bar: BOSS_BAR, somber: scheduleKnell, tense: scheduleKnell, knell: scheduleKnell, sticky: true },
  final: { bar: FINAL_BAR, somber: scheduleGreatBell, tense: scheduleGreatBell, greatbell: scheduleGreatBell, sticky: true },
};
export const NORTH_INFO = { worldmap: { intro: 2, loopBars: 16, bar: 3 * 60 / 78 }, boss: { intro: 2, loopBars: 16, bar: BOSS_BAR }, final: { intro: 4, loopBars: 16, bar: FINAL_BAR } };
