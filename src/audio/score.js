// Battle score (round 7). Three original 16-bar themes on ONE grid (120 BPM, 4/4, 2 s bars) so the Sequencer can
// move between them on any bar line, plus a victory fanfare and a defeat cue. Idiom: late-1990s-style
// sequenced orchestra — ostinato low strings, sustained string pad, harp figuration, brass stabs and swells, horn
// or trumpet lead, timpani and military snare.
//
//   "Crossing at Hearthmoor" (scheduleBar)    D minor march. The tense theme's A block.
//   "Oath Beneath the Banner" (scheduleHeroic) F major -> D minor. The tense theme's B block: a trumpet tune over a
//        galloping 16th spiccato, horn swells, gran cassa. Ends on A7 so it hands back to the march's D minor.
//   "Evenfall Vigil" (scheduleSomber)       D minor lament; the calm bed while the field is quiet. Alternate passes
//        move the melody from violins to a solo horn and add a harp counter-line.
//   scheduleTense(bar)                      the rotation the Sequencer plays while the battle is hot:
//        march, oath, march (varied), oath (varied) ... = 128 bars (4 min 16 s) before an exact repeat.
//
// Pads are VOICE-LED (voiceLead below): each chord is re-voiced to move every voice by the smallest step from the
// previous chord, with the root doubled when a triad fills four voices — no parallel block chords jumping by
// register. Every theme thins from the top down as `intensity` (0..1) falls, so the same bars work as a quiet
// planning bed or a full tutti.
import { SEAT } from './synth.js';
export const BPM = 120, BEAT = 60 / BPM, BAR = BEAT * 4, S16 = BEAT / 4, LOOP_BARS = 16;

export const CH = {
  Dm: { bass: 38, pcs: [2, 5, 9] }, Bb: { bass: 46, pcs: [10, 2, 5] }, Gm: { bass: 43, pcs: [7, 10, 2] }, A: { bass: 45, pcs: [9, 1, 4] },
  A7: { bass: 45, pcs: [9, 1, 4, 7] }, F: { bass: 41, pcs: [5, 9, 0] }, C: { bass: 36, pcs: [0, 4, 7] }, Am: { bass: 45, pcs: [9, 0, 4] },
  CE: { bass: 40, pcs: [0, 4, 7], root: 0 }, Asus: { bass: 45, pcs: [9, 2, 4] }, Gm6: { bass: 43, pcs: [7, 10, 2, 4] },
  Bbadd: { bass: 46, pcs: [10, 2, 5, 0] }, Dsus: { bass: 38, pcs: [2, 7, 9] },
};
export const rootPc = (ch) => ch.root ?? ch.bass % 12;

// ---- voice leading: choose, for each chord, the n-note voicing in [lo, hi] closest to the previous voicing.
export function voiceLead(names, n, lo, hi, start, table = CH) {
  let prev = start; const out = [];
  for (const nm of names) {
    const ch = table[nm]; const cands = []; for (let m = lo; m <= hi; m++) if (ch.pcs.includes(m % 12)) cands.push(m);
    let best = null, bestCost = Infinity;
    const pick = (i, acc) => {
      if (acc.length === n) {
        const pcs = new Set(acc.map((m) => m % 12)); let cost = 0;
        for (const pc of ch.pcs) if (!pcs.has(pc)) cost += pc === (rootPc(ch) + 7) % 12 ? 3 : 40; // may omit only the fifth
        const counts = {}; acc.forEach((m) => { counts[m % 12] = (counts[m % 12] || 0) + 1; });
        for (const [pc, c] of Object.entries(counts)) if (c > 1 && +pc !== rootPc(ch)) cost += 6 * (c - 1);    // double the root
        for (let k = 1; k < n; k++) { const iv = acc[k] - acc[k - 1]; if (iv < 3) cost += 8; if (iv > 12) cost += 5; }
        for (let k = 0; k < n; k++) cost += Math.abs(acc[k] - prev[k]);
        if (cost < bestCost) { bestCost = cost; best = acc.slice(); }
        return;
      }
      for (let j = i; j < cands.length; j++) { acc.push(cands[j]); pick(j + 1, acc); acc.pop(); }
    };
    pick(0, []); out.push(best); prev = best;
  }
  return out;
}
// chord tones ascending from `from`, n of them (arpeggio material)
export function stack(ch, from, n) { const out = []; for (let m = from; out.length < n; m++) if (ch.pcs.includes(((m % 12) + 12) % 12)) out.push(m); return out; }

// =============================================================================================================
// "Crossing at Hearthmoor" — D minor march
const PROG = ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'F', 'Gm', 'A7', 'F', 'C', 'Dm', 'A', 'Bb', 'Gm', 'A7', 'Dm'];
const MEL = [
  [[0, 3, 69], [3, 1, 69], [4, 4, 74], [8, 4, 77], [12, 4, 76]],
  [[0, 6, 74], [6, 2, 72], [8, 4, 70], [12, 2, 69], [14, 2, 67]],
  [[0, 3, 67], [3, 1, 67], [4, 4, 70], [8, 4, 74], [12, 4, 79]],
  [[0, 2, 77], [2, 2, 76], [4, 2, 77], [6, 2, 76], [8, 8, 73]],
  [[0, 3, 69], [3, 1, 69], [4, 4, 74], [8, 4, 77], [12, 4, 81]],
  [[0, 6, 79], [6, 2, 77], [8, 4, 76], [12, 2, 77], [14, 2, 79]],
  [[0, 4, 81], [4, 2, 79], [6, 2, 77], [8, 4, 74], [12, 4, 70]],
  [[0, 4, 76], [4, 4, 73], [8, 8, 69]],
  [[0, 8, 72], [8, 4, 69], [12, 4, 72]],
  [[0, 6, 76], [6, 2, 74], [8, 4, 72], [12, 4, 67]],
  [[0, 4, 69], [4, 4, 74], [8, 6, 77], [14, 2, 76]],
  [[0, 8, 73], [8, 4, 76], [12, 4, 69]],
  [[0, 3, 70], [3, 1, 70], [4, 4, 74], [8, 4, 77], [12, 4, 82]],
  [[0, 6, 81], [6, 2, 79], [8, 4, 74], [12, 4, 79]],
  [[0, 4, 76], [4, 4, 77], [8, 4, 76], [12, 4, 73]],
  [[0, 12, 74], [12, 2, 69], [14, 2, 73]],
];
const CTR = [
  [[8, 4, 62], [12, 4, 64]], [[0, 4, 65], [4, 4, 62], [8, 8, 58]], [[0, 8, 58], [8, 4, 62], [12, 4, 64]], [[0, 8, 65], [8, 8, 64]],
  [[8, 4, 65], [12, 4, 67]], [[0, 4, 69], [4, 4, 65], [8, 8, 62]], [[0, 8, 62], [8, 4, 65], [12, 4, 67]], [[0, 8, 69], [8, 8, 64]],
  [[0, 8, 60], [8, 8, 65]], [[0, 8, 64], [8, 4, 60], [12, 4, 59]], [[0, 4, 57], [4, 4, 62], [8, 8, 65]], [[0, 8, 61], [8, 8, 64]],
  [[0, 4, 58], [4, 4, 62], [8, 8, 65]], [[0, 8, 62], [8, 4, 67], [12, 4, 65]], [[0, 8, 64], [8, 4, 61], [12, 4, 64]], [[0, 12, 62], [12, 4, 61]],
];
const STABS = [[6, 12], [12], [6, 12], [8, 12, 14], [6, 12], [12], [6, 12], [0, 2, 4, 6, 8, 12], [6, 12], [12], [6, 12], [8, 12, 14], [6, 12], [12], [0, 4, 8, 10, 12, 14], [0, 8]];
const OST = [0, 0, 7, 0, 0, 7, 0, 12];
const SNARE = [1, 0, 0.3, 0, 0.7, 0, 0.3, 0.35, 1, 0, 0.3, 0, 0.7, 0.3, 0.35, 0.5];
const HARP = [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0, 1];
const HARP_B = [0, 2, 4, 6, 7, 6, 4, 2, 1, 3, 5, 7, 6, 4, 2, 0];
const ROLL_BARS = new Set([3, 7, 11, 15]);
const DYN = [0.72, 0.72, 0.78, 0.9, 0.86, 0.96, 1.04, 1.14, 0.52, 0.7, 0.88, 1.02, 1.0, 1.1, 1.22, 0.94];
const BREATH = 8;
const MARCH_PAD = voiceLead(PROG, 4, 55, 76, [57, 62, 65, 69]);
const MARCH_STAB = voiceLead(PROG, 3, 62, 76, [62, 65, 69]);
const T = { pad: 0, bass: 0, harp: 0, lead: 0.12, timp: 0.22, counter: 0.3, ostinato: 0.34, snare: 0.4, stabs: 0.5, sizzle: 0.6, tremolo: 0.68, choir: 0.72, crash: 0.45 };

export function scheduleBar(e, bar, t0, opts = {}) {
  const b = ((bar % LOOP_BARS) + LOOP_BARS) % LOOP_BARS;
  const pass = opts.pass ?? Math.floor(bar / LOOP_BARS);
  const ch = CH[PROG[b]]; const B = b >= 8;
  const intensity = opts.intensity ?? 1;
  const lvl = (opts.level ?? 1) * DYN[b] * (0.62 + 0.38 * intensity);
  const on = (k) => intensity >= T[k];
  const at = (slot) => t0 + slot * S16;
  const breath = b === BREATH; const varyA = pass % 2 === 1; const bigPass = pass % 4 === 3;

  // foundation: contrabass (every other pass the A-section bass is pizzicato)
  if (breath) e.contrabass(t0, ch.bass, BAR - 0.05, 0.5 * lvl);
  else if (varyA && !B) { for (const s of [0, 4, 8, 10, 12]) e.pizz(at(s), ch.bass, (s % 8 === 0 ? 1 : 0.7) * lvl); e.contrabass(t0, ch.bass, BAR - 0.05, 0.45 * lvl); }
  else e.contrabass(t0, ch.bass, BAR - 0.05, 0.82 * lvl);
  // spiccato cello ostinato
  if (on('ostinato') && !breath) for (let i = 0; i < 8; i++) e.stacStrings(at(i * 2), ch.bass + 12 + OST[i], (i % 2 ? 0.68 : 0.95) * lvl);
  // voice-led string pad (B section adds the octave shimmer)
  const pad = MARCH_PAD[b];
  pad.forEach((m, i) => e.strings(t0, m, BAR + 0.08, 0.8 * lvl, { sect: 'pad', pan: SEAT.vln2 + (i - 1.5) * 0.3, oct: B && i === 3 ? 0.2 : 0, attack: 0.18, gain: 0.026 }));
  if (B && on('choir')) e.choir(t0, pad[3] - 12, BAR + 0.1, (bigPass ? 1 : 0.8) * lvl);
  // tremolo violins on the dominant bars
  if (ROLL_BARS.has(b) && on('tremolo')) for (let i = 0; i < 16; i++) e.stacStrings(at(i), pad[3] + 12, (0.45 + 0.55 * i / 15) * lvl, { dur: 0.085, gain: 0.017, sect: 'vln', prio: 2 });
  // harp 16ths
  const hs = stack(ch, 62, 8); const fig = varyA ? HARP_B : HARP;
  fig.forEach((k, i) => e.harp(at(i), hs[k], (i % 4 === 0 ? 0.95 : 0.6) * lvl, { pan: SEAT.harp + (k / 7) * 0.4, prio: i % 2 ? 2 : 1 }));
  if ((b === 0 || b === 8) && on('sizzle')) for (let i = 0; i < 8; i++) e.harp(at(i * 2), hs[i] + 12, 0.5 * lvl, { gain: 0.055, prio: 2 });
  // brass stabs: voice-led close triad over the root
  if (on('stabs') && !breath) { const stab = MARCH_STAB[b]; for (const s of STABS[b]) { const long = (b === 7 || b === 15) && s === 12; e.brassChord(at(s), [ch.bass + 12, ...stab], long ? 0.45 : 0.13, (s % 4 === 0 ? 1 : 0.8) * lvl, { gain: 0.11 }); } }
  // lead horn (+ violins an octave up in the B section and on loud passes)
  if (on('lead')) for (const [s, len, m] of MEL[b]) {
    const dur = len * S16 - 0.03;
    e.horn(at(s), m, dur, (s % 4 === 0 ? 1 : 0.85) * lvl);
    if (B || bigPass) e.strings(at(s), m + 12, dur, 0.55 * lvl, { sect: 'vln', attack: 0.05, release: 0.13, gain: 0.017, prio: 1 });
  }
  if (on('counter')) for (const [s, len, m] of CTR[b]) e.strings(at(s), m, len * S16 - 0.03, 0.62 * lvl, { sect: 'viola', attack: 0.09, release: 0.18, gain: 0.021 });
  // percussion
  if (on('timp') && !breath) { e.timpani(at(0), ch.bass, 1 * lvl); e.timpani(at(8), ch.bass, 0.72 * lvl); if (b % 4 === 1) e.timpani(at(6), ch.bass + 7, 0.5 * lvl); }
  if (ROLL_BARS.has(b)) {
    if (on('timp')) for (let i = 0; i < 8; i++) e.timpani(at(12 + i * 0.5), ch.bass, (0.25 + 0.75 * i / 7) * lvl, { gain: 0.2 });
    if (on('snare')) { for (let i = 0; i < 8; i++) e.snare(at(12 + i * 0.5), (0.4 + 0.6 * i / 7) * lvl); SNARE.slice(0, 12).forEach((v, i) => v && e.snare(at(i), v * lvl)); }
  } else if (on('snare') && !breath) SNARE.forEach((v, i) => v && e.snare(at(i), v * lvl));
  if (on('sizzle') && !breath) for (let i = 0; i < 4; i++) e.sizzle(at(i * 4 + 2), (i % 2 ? 0.65 : 1) * lvl, { gain: 0.024 });
  if ((b === 0 || b === 8) && on('crash')) e.crash(at(0), (bigPass ? 1.1 : 0.9) * lvl);
  if ((b === 7 || b === 15) && on('sizzle')) e.cymSwell(at(8), BAR / 2 - 0.05, 0.9 * lvl);
}

// =============================================================================================================
// "Oath Beneath the Banner" — F major, turning to D minor; the heroic block of the tense rotation.
const H_PROG = ['F', 'CE', 'Dm', 'Bb', 'Gm', 'C', 'F', 'A', 'Bb', 'C', 'Am', 'Dm', 'Gm', 'Bb', 'Gm6', 'A7'];
const H_MEL = [
  [[0, 3, 72], [3, 1, 72], [4, 4, 77], [8, 3, 79], [11, 1, 81], [12, 4, 79]],
  [[0, 6, 76], [6, 2, 77], [8, 4, 79], [12, 4, 72]],
  [[0, 3, 74], [3, 1, 76], [4, 4, 77], [8, 4, 81], [12, 4, 79]],
  [[0, 8, 77], [8, 2, 74], [10, 2, 72], [12, 4, 70]],
  [[0, 3, 70], [3, 1, 72], [4, 4, 74], [8, 4, 79], [12, 4, 82]],
  [[0, 6, 81], [6, 2, 79], [8, 4, 76], [12, 4, 79]],
  [[0, 4, 77], [4, 4, 81], [8, 4, 84], [12, 4, 81]],
  [[0, 8, 85], [8, 4, 81], [12, 4, 76]],
  [[0, 3, 77], [3, 1, 77], [4, 4, 82], [8, 4, 81], [12, 4, 79]],
  [[0, 6, 79], [6, 2, 77], [8, 4, 76], [12, 4, 72]],
  [[0, 3, 76], [3, 1, 77], [4, 4, 79], [8, 4, 81], [12, 4, 84]],
  [[0, 8, 86], [8, 4, 84], [12, 4, 81]],
  [[0, 4, 82], [4, 4, 79], [8, 4, 74], [12, 4, 79]],
  [[0, 4, 77], [4, 4, 74], [8, 4, 70], [12, 4, 74]],
  [[0, 8, 79], [8, 4, 77], [12, 4, 76]],
  [[0, 6, 76], [6, 2, 73], [8, 8, 69]],
];
const H_DYN = [0.82, 0.86, 0.9, 0.94, 0.9, 0.96, 1.02, 1.1, 0.9, 0.96, 1.02, 1.12, 1.04, 1.08, 1.14, 1.0];
const H_PAD = voiceLead(H_PROG, 4, 53, 74, [57, 60, 65, 69]);
const H_HORN = voiceLead(H_PROG, 3, 58, 72, [60, 65, 69]);
const GALLOP = [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15];
const HT = { pad: 0, bass: 0, lead: 0.1, harp: 0.15, timp: 0.2, gallop: 0.3, horns: 0.35, snare: 0.4, bd: 0.45, crash: 0.45, doubling: 0.55, sizzle: 0.6, choir: 0.7 };

export function scheduleHeroic(e, bar, t0, opts = {}) {
  const b = ((bar % LOOP_BARS) + LOOP_BARS) % LOOP_BARS;
  const pass = opts.pass ?? Math.floor(bar / LOOP_BARS);
  const ch = CH[H_PROG[b]]; const B = b >= 8; const intensity = opts.intensity ?? 1;
  const lvl = (opts.level ?? 1) * H_DYN[b] * (0.62 + 0.38 * intensity);
  const on = (k) => intensity >= HT[k]; const at = (slot) => t0 + slot * S16;
  const vary = pass % 2 === 1; const cad = b === 7 || b === 15;
  const bass = ch.bass, cel = ch.bass + 12;

  // foundation: bass on the half notes, root then fifth (inversions and cadences repeat the bass note instead)
  e.contrabass(t0, bass, BAR / 2 - 0.04, 0.85 * lvl);
  e.contrabass(at(8), bass + (cad || ch.root != null ? 0 : 7), BAR / 2 - 0.04, 0.7 * lvl);
  // galloping spiccato (cellos): the long of each gallop on the bass note, the two shorts on the octave (the
  // repeat pass answers with the fifth in the second half of the bar)
  if (on('gallop')) GALLOP.forEach((s, i) => e.stacStrings(at(s), cel + (i % 3 === 0 ? 0 : (s >= 8 && vary && ch.root == null ? 7 : 12)), (i % 3 === 0 ? 0.95 : 0.62) * lvl, { dur: 0.085 }));
  // voice-led pad
  H_PAD[b].forEach((m, i) => e.strings(t0, m, BAR + 0.08, 0.72 * lvl, { sect: 'pad', pan: -0.4 + i * 0.26, attack: 0.2, gain: 0.024 }));
  // horns: warm half-note swells in the A half, punchy off-beat stabs in the B half
  if (on('horns')) {
    const hv = H_HORN[b];
    if (!B) { e.brassChord(t0, hv, BAR / 2 - 0.05, 0.8 * lvl, { sect: 'brass', gain: 0.1, sub: false }); e.brassChord(at(8), hv, BAR / 2 - 0.05, 0.75 * lvl, { sect: 'brass', gain: 0.09, sub: false }); }
    else for (const s of cad ? [0, 4, 8, 12] : [2, 6, 10, 14]) e.brassChord(at(s), [cel, ...hv], 0.14, (cad ? 1 : 0.8) * lvl, { gain: 0.1 });
  }
  // trumpet lead (+ violins an octave up from the B section / on repeat passes)
  if (on('lead')) for (const [s, len, m] of H_MEL[b]) {
    const dur = len * S16 - 0.03;
    e.horn(at(s), m, dur, (s % 4 === 0 ? 1 : 0.86) * lvl, { sect: 'tpt' });
    if (on('doubling') && (B || vary)) e.strings(at(s), m + 12, dur, 0.5 * lvl, { sect: 'vln', attack: 0.04, release: 0.12, gain: 0.016 });
    else if (vary) e.horn(at(s), m - 12, dur, 0.55 * lvl, { gain: 0.11 });               // horn in octaves on the repeat
  }
  // harp: rising 8th arpeggio (16ths on the cadence bars)
  if (on('harp')) { const hs = stack(ch, 60, 8); if (cad) for (let i = 0; i < 16; i++) e.harp(at(i), hs[i % 8] + (i >= 8 ? 12 : 0), 0.6 * lvl, { prio: 2 }); else for (let i = 0; i < 8; i++) e.harp(at(i * 2), hs[i], (i % 4 === 0 ? 0.9 : 0.6) * lvl, { pan: SEAT.harp + i * 0.05 }); }
  // choir in the B half at full intensity
  if (B && on('choir')) e.choir(t0, H_PAD[b][2], BAR + 0.1, 0.8 * lvl);
  // percussion
  // timpani are tuned to the tonic and dominant (D and A) like a real pair; they only play when the chord has them
  const tp = [38, 45].filter((m) => ch.pcs.includes(m % 12));
  if (on('timp') && tp.length) { e.timpani(at(0), tp[0], lvl); e.timpani(at(8), tp[tp.length - 1], 0.7 * lvl); }
  if (cad && on('timp')) for (let i = 0; i < 8; i++) e.timpani(at(8 + i), 45, (0.3 + 0.6 * i / 7) * lvl, { gain: 0.18 });
  if (on('bd') && b % 4 === 0) e.bassDrum(at(0), 0.6 * lvl);
  if (on('snare')) {
    // march with a ruff (two grace 32nds) into beats 2 and 4
    for (const [s, v] of [[0, 1], [3, 0.35], [4, 0.8], [6, 0.4], [8, 0.9], [11, 0.35], [12, 0.8], [14, 0.45], [15, 0.5]]) e.snare(at(s), v * lvl);
    for (const s of [3.5, 11.5]) e.snare(at(s), 0.3 * lvl, { prio: 2 });
    if (cad) for (let i = 0; i < 8; i++) e.snare(at(8 + i), (0.4 + 0.6 * i / 7) * lvl);
  }
  if (on('sizzle')) for (let i = 0; i < 4; i++) e.sizzle(at(i * 4 + 2), 0.8 * lvl, { gain: 0.022 });
  if ((b === 0 || b === 8) && on('crash')) e.crash(at(0), lvl);
  if (cad && on('sizzle')) e.cymSwell(at(8), BAR / 2 - 0.05, 0.9 * lvl);
}

// =============================================================================================================
// "Evenfall Vigil" — D minor lament (the calm bed).
const SCH = ['Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'Gm', 'Asus', 'A', 'F', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A', 'A'];
const SOM_MEL = [
  [[0, 16, 74]], [[0, 8, 74], [8, 8, 72]], [[0, 16, 70]], [[0, 8, 70], [8, 8, 69]],
  [[0, 16, 74]], [[0, 8, 74], [8, 8, 72]], [[0, 16, 69]], [[0, 8, 69], [8, 8, 68]],
  [[0, 16, 77]], [[0, 8, 77], [8, 8, 76]], [[0, 16, 76]], [[0, 8, 74], [8, 8, 72]],
  [[0, 16, 70]], [[0, 8, 69], [8, 8, 67]], [[0, 16, 69]], [[0, 8, 69], [8, 8, 74]],
];
// harp counter-line for alternate passes: a slow 8th-note figure that fills the long melody notes
const SOM_HCTR = [[62, 65, 69, 74], [62, 65, 69, 72], [58, 62, 65, 70], [58, 62, 65, 69], [55, 58, 62, 67], [55, 58, 62, 70], [57, 62, 64, 69], [57, 61, 64, 67], [60, 65, 69, 72], [60, 65, 69, 76], [60, 64, 67, 72], [62, 65, 69, 74], [58, 62, 65, 70], [55, 58, 62, 67], [57, 61, 64, 69], [57, 61, 64, 67]];
const SOM_DYN = [0.9, 0.88, 0.92, 0.9, 0.94, 0.92, 0.96, 1.0, 0.98, 0.94, 0.96, 0.92, 0.9, 0.94, 1.0, 0.86];
const SOM_PAD = voiceLead(SCH, 4, 53, 74, [57, 62, 65, 69]);
const SOM_T = { pad: 0, bass: 0, harp: 0.18, lead: 0.15, choir: 0.32, timp: 0.55 };

export function scheduleSomber(e, bar, t0, opts = {}) {
  const b = ((bar % LOOP_BARS) + LOOP_BARS) % LOOP_BARS;
  const pass = opts.pass ?? Math.floor(bar / LOOP_BARS);
  const ch = CH[SCH[b]]; const intensity = opts.intensity ?? 1;
  const lvl = (opts.level ?? 1) * SOM_DYN[b] * (0.68 + 0.32 * intensity) * 1.9; // the vigil sits ~5 dB under the march, not 13
  const on = (k) => intensity >= SOM_T[k]; const at = (slot) => t0 + slot * S16;
  const alt = pass % 2 === 1;

  e.contrabass(t0, ch.bass, BAR - 0.06, (b === 15 ? 0.45 : 0.6) * lvl, { attack: 0.12 });
  SOM_PAD[b].forEach((m, i) => e.strings(t0, m, BAR + 0.16, 0.72 * lvl, { sect: 'pad', attack: 0.5, release: 0.55, gain: 0.017, pan: -0.38 + i * 0.26 }));
  if (on('lead')) for (const [s, len, m] of SOM_MEL[b]) {
    const dur = len * S16 - 0.04;
    if (alt) e.horn(at(s), m - 12, dur, 0.42 * lvl, { attack: 0.12, release: 0.3, gain: 0.12 });          // solo horn
    else { e.strings(at(s), m, dur, 0.8 * lvl, { sect: 'vln', attack: 0.24, release: 0.42, gain: 0.018 }); if (pass % 4 === 2) e.strings(at(s), m + 12, dur, 0.3 * lvl, { sect: 'vln', attack: 0.3, release: 0.4, gain: 0.009, prio: 2 }); }
  }
  if (on('choir')) e.choir(t0, SOM_PAD[b][1] + 12, BAR + 0.1, 0.7 * lvl);
  if (on('harp')) {
    if (alt) SOM_HCTR[b].concat(SOM_HCTR[b].slice(1, 3).reverse()).concat([SOM_HCTR[b][3] + 12, SOM_HCTR[b][2] + 12]).forEach((m, i) => e.harp(at(i * 2), m, (i === 0 ? 0.55 : 0.34) * lvl, { gain: 0.07, pan: SEAT.harp + (i % 4) * 0.12, prio: 2 }));
    else { const hs = stack(ch, 60, 4); [0, 4, 8, 12].forEach((s, i) => e.harp(at(s), hs[i], (i === 0 ? 0.5 : 0.3) * lvl, { gain: 0.075 })); }
  }
  if ((b === 0 || b === 8) && on('timp')) e.timpani(t0, ch.bass, 0.5 * lvl);
  if (b === 15 && on('timp')) for (let i = 0; i < 8; i++) e.timpani(at(8 + i), ch.bass, (0.18 + 0.5 * i / 7) * lvl, { gain: 0.14 });
}

// The rotation used while the battle is hot: march / oath alternate every 16 bars. `pass` for each theme counts
// its own repeats so their internal variations advance too.
export function scheduleTense(e, bar, t0, opts = {}) {
  const block = Math.floor(bar / LOOP_BARS); const pass = Math.floor(block / 2);
  return (block % 2 === 0 ? scheduleBar : scheduleHeroic)(e, bar, t0, { ...opts, pass });
}

// =============================================================================================================
// Victory fanfare (D major): three pickups, a held tonic, a climb, a crash on the top note, harp glissando.
export function fanfare(e, t0) {
  const chord = (t, notes, d, v = 0.9) => { e.brassChord(t, notes.slice(0, 4), d, v, { gain: 0.14, release: 0.18 }); notes.forEach((m, i) => e.strings(t, m + 12, d + 0.3, 0.85, { sect: 'vln', pan: -0.6 + i * 0.3, attack: 0.03, gain: 0.02 })); };
  for (let i = 0; i < 3; i++) { e.horn(t0 + i * 0.16, 69, 0.11, 0.9, { sect: 'tpt' }); e.snare(t0 + i * 0.16, 0.8); }
  chord(t0 + 0.48, [50, 62, 66, 69], 0.5); e.horn(t0 + 0.48, 74, 0.46, 1, { sect: 'tpt' }); e.timpani(t0 + 0.48, 38, 1); e.contrabass(t0 + 0.48, 38, 0.5); e.crash(t0 + 0.48, 0.5);
  e.horn(t0 + 1.02, 76, 0.22, 0.95, { sect: 'tpt' }); e.horn(t0 + 1.26, 78, 0.22, 1, { sect: 'tpt' }); e.snare(t0 + 1.02, 0.6); e.snare(t0 + 1.26, 0.7);
  chord(t0 + 1.5, [45, 57, 61, 64], 0.48); e.horn(t0 + 1.5, 79, 0.46, 1, { sect: 'tpt' }); e.timpani(t0 + 1.5, 45, 0.9); e.contrabass(t0 + 1.5, 45, 0.48);
  for (let i = 0; i < 8; i++) e.snare(t0 + 1.5 + i * 0.06, 0.35 + 0.6 * i / 7);
  e.cymSwell(t0 + 1.5, 0.48, 0.9);
  chord(t0 + 2.0, [50, 62, 66, 69, 78], 2.2, 1); e.horn(t0 + 2.0, 81, 2.1, 1, { sect: 'tpt' }); e.horn(t0 + 2.0, 74, 2.1, 0.8); e.timpani(t0 + 2.0, 38, 1); e.bassDrum(t0 + 2.0, 0.5); e.crash(t0 + 2.0, 1); e.contrabass(t0 + 2.0, 38, 2.2);
  e.choir(t0 + 2.05, 62, 2.1, 0.9); e.choir(t0 + 2.05, 66, 2.1, 0.7);
  const hs = [62, 66, 69, 74, 78, 81, 86, 90]; for (let i = 0; i < 16; i++) e.harp(t0 + 2.05 + i * 0.06, hs[i % 8], 0.85, { prio: 0 });
  e.timpani(t0 + 3.0, 38, 0.6); e.timpani(t0 + 3.5, 38, 0.8);
  for (let i = 0; i < 6; i++) e.sizzle(t0 + 2.0 + i * 0.25, 0.6);
  return 4.4;
}

// Defeat cue ("The Banner Falls", D minor, ~8 s): a slow i - iv6 - V - i cadence under a falling solo horn,
// muffled timpani heartbeat, the choir on the last chord and a low harp roll. No snare, no brass stabs.
export function defeat(e, t0) {
  const Q = 0.75; // slow quarter (80 BPM)
  const chords = [[0, 3, [50, 57, 62, 65], 38], [3, 2, [50, 58, 62, 67], 46], [5, 2, [49, 57, 64, 67], 45], [7, 5, [50, 57, 62, 65], 38]];
  for (const [q, len, notes, bass] of chords) {
    const t = t0 + q * Q, d = len * Q;
    notes.forEach((m, i) => e.strings(t, m, d + 0.1, 0.8, { sect: 'pad', attack: q === 0 ? 0.8 : 0.3, release: q === 7 ? 1.4 : 0.5, gain: 0.02, pan: -0.36 + i * 0.24 }));
    e.contrabass(t, bass, d, 0.62, { attack: 0.2 });
  }
  const mel = [[0, 1.5, 69], [1.5, 0.5, 67], [2, 1, 65], [3, 1, 67], [4, 1, 70], [5, 1.5, 69], [6.5, 0.5, 67], [7, 5, 62]];
  for (const [q, len, m] of mel) e.horn(t0 + q * Q, m, len * Q - 0.04, 0.72, { attack: 0.1, release: q === 7 ? 1.2 : 0.25, gain: 0.13 });
  for (const q of [0, 3, 5]) e.timpani(t0 + q * Q, q === 5 ? 45 : 38, 0.45, { gain: 0.16 });
  for (let i = 0; i < 12; i++) e.timpani(t0 + 6 * Q + i * 0.0625, 45, 0.2 + 0.35 * Math.sin(Math.PI * i / 11), { gain: 0.12 });
  e.bassDrum(t0 + 7 * Q, 0.4); e.timpani(t0 + 7 * Q, 38, 0.7);
  e.choir(t0 + 7 * Q, 62, 5 * Q, 0.75, { attack: 0.6, release: 1.2 }); e.choir(t0 + 7 * Q, 57, 5 * Q, 0.6, { attack: 0.8, release: 1.2 });
  [74, 69, 65, 62, 57, 53, 50].forEach((m, i) => e.harp(t0 + 7 * Q + 0.1 + i * 0.09, m, 0.5 - i * 0.04, { prio: 0 }));
  return 12 * Q + 1.5;
}
