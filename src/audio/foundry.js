// Sample foundry (round 7): short percussive / plucked instrument notes are synthesised ONCE in plain JS into
// mono AudioBuffers and then replayed with a 2-node voice (BufferSource -> Gain). This is how the PS1 score was
// actually made (a sample bank played by a sequencer), it is far cheaper on the audio thread than a per-note
// oscillator/biquad graph, and doing the DSP in JS lets us use real physical models that WebAudio nodes cannot
// express: Karplus-Strong strings with a fractional-delay tuner and a wooden soundboard, modal membranes for
// timpani/snare/bass drum, and inharmonic partial clouds for cymbals.
//
// Every buffer is cached per (AudioContext sample rate, kind, pitch, variant), generated lazily on first use
// (each costs well under 2 ms). All generators end with a short cosine fade so no buffer can click at its end,
// start from zero (no DC step) and are normalised to peak 1 so the score sets loudness with plain gains.
const CACHE = new Map();
const TAU = Math.PI * 2;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// Deterministic PRNG so a bounce is repeatable and variants are genuinely different takes.
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 * 2 - 1; }; }

// State-variable filter (Chamberlin/Simper TPT form): stable under per-sample cutoff sweeps.
function svf() {
  let ic1 = 0, ic2 = 0, lf = -1, lq = -1, a1 = 0, a2 = 0, a3 = 0, k = 1; const o = { lp: 0, bp: 0, hp: 0 };
  return (x, fc, q, sr) => {
    if (fc !== lf || q !== lq) { lf = fc; lq = q; const g = Math.tan(Math.PI * Math.min(fc, sr * 0.45) / sr); k = 1 / q; a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; }
    const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    o.lp = v2; o.bp = v1; o.hp = x - k * v1 - v2; return o;
  };
}
// Two-pole resonator (for bodies/soundboards): returns a function x -> y.
function reson(f, q, sr) {
  const w = TAU * f / sr, r = Math.exp(-w / (2 * q)), a1 = 2 * r * Math.cos(w), a2 = -r * r; let y1 = 0, y2 = 0;
  return (x) => { const y = (1 - r) * x + a1 * y1 + a2 * y2; y2 = y1; y1 = y; return y; };
}
// Exact KS tuning at the fundamental: the loop is N samples + a two-tap filter (weight b on the older tap) + a
// first-order allpass. Subtract the two-tap filter's true phase delay at w, then solve the allpass for the rest
// (C = sin(w(1-d)/2) / sin(w(1+d)/2) gives phase delay d exactly at w).
function apCoef(rest, b, w) {
  const tf = -Math.atan2(-b * Math.sin(w), b * Math.cos(w) + (1 - b)) / w; const d = rest - tf;
  return Math.sin(w * (1 - d) / 2) / Math.sin(w * (1 + d) / 2);
}
// PolyBLEP saw: band-limited, so high notes do not alias into audible fold-back.
function blep(t, dt) { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; }

function finish(d, sr, fadeMs = 12) {
  // remove DC, normalise to peak 1, cosine fade-out tail; first sample exactly 0
  let mean = 0; for (let i = 0; i < d.length; i++) mean += d[i]; mean /= d.length;
  let pk = 1e-9; for (let i = 0; i < d.length; i++) { d[i] -= mean; pk = Math.max(pk, Math.abs(d[i])); }
  const fade = Math.min(d.length >> 1, Math.floor(sr * fadeMs / 1000));
  const fin = Math.min(64, d.length >> 2);
  for (let i = 0; i < d.length; i++) {
    let v = d[i] / pk;
    if (i < fin) v *= i / fin;                                            // 1.5 ms fade-in: no step at t=0
    const j = d.length - 1 - i; if (j < fade) v *= 0.5 - 0.5 * Math.cos(Math.PI * j / fade);
    d[i] = v;
  }
  return d;
}

function build(sr, len, gen) { const d = new Float32Array(Math.max(1, Math.floor(len * sr))); gen(d, sr); finish(d, sr); const b = new AudioBuffer({ length: d.length, numberOfChannels: 1, sampleRate: sr }); b.copyToChannel(d, 0); return b; }
// Long, dark sounds (bells) are generated at HALF the context rate (the browser resamples on playback): their content
// sits far below the halved Nyquist (>= 11 kHz) and the build costs half as much. The cache key still carries the
// context rate so it is found again.
const HALF = (fn) => { fn.half = true; return fn; };
// Live play: a cache miss must never stall the scheduler tick (a cold bar could cost 100+ ms of JS on a slow
// machine). With deferral on (live AudioContext only), a miss queues the buffer for a background slice and
// returns null — the caller skips that one note — so the tick stays cheap. Offline renders always build inline.
let DEFER = false; const QUEUE = new Map(); let pumping = false;
export function setDeferred(on) { DEFER = !!on; }
// While deferral is on, allow cache misses to build INLINE for up to `ms` (the first bar of a new scene), then fall
// back to queueing: a scene start costs at most ~ms of JS even on a slow machine with a cold bank.
let INLINE_UNTIL = 0;
export function inlineFor(ms, fn) { INLINE_UNTIL = performance.now() + ms; try { return fn(); } finally { INLINE_UNTIL = 0; } }
function pump() {
  const t0 = performance.now();
  for (const [k, job] of QUEUE) { QUEUE.delete(k); if (!CACHE.has(k)) CACHE.set(k, build(job.gen.half ? job.sr / 2 : job.sr, job.len, job.gen)); if (performance.now() - t0 > 6) break; }
  if (QUEUE.size) setTimeout(pump, 15); else pumping = false;
}
function get(ac, key, len, gen, force = false) {
  const k = ac.sampleRate + ':' + key; let b = CACHE.get(k);
  if (b) return b;
  if (DEFER && !force && !(INLINE_UNTIL && performance.now() < INLINE_UNTIL) && !(globalThis.OfflineAudioContext && ac instanceof OfflineAudioContext)) {
    if (!QUEUE.has(k)) QUEUE.set(k, { sr: ac.sampleRate, len, gen });
    if (!pumping) { pumping = true; setTimeout(pump, 0); }
    return null;
  }
  b = build(gen.half ? ac.sampleRate / 2 : ac.sampleRate, len, gen); CACHE.set(k, b); return b;
}

// ---- Harp: extended Karplus-Strong. Bright felt-less pluck, tuned with a first-order allpass, the loop filter
// gets darker in the low register (longer, rounder bass strings), plus a spruce soundboard (two body modes).
export function harp(ac, m) {
  return get(ac, 'harp' + m, Math.min(1.5, 0.7 + (84 - m) * 0.025), (d, sr) => {
    // loop delay = N (line) + bright (two-tap loop filter: weight 'bright' sits on the older tap) + fr (allpass, kept in 0.1..1.1 where it is accurate)
    const bright = m > 76 ? 0.62 : 0.5;                                         // loop LP blend: higher = brighter
    const f = mtof(m), P = sr / f, N = Math.floor(P - bright - 0.1), C = apCoef(P - N, bright, TAU * f / sr);
    const r = rng(m * 7919 + 3); const buf = new Float32Array(N + 2); const lp = svf();
    // pluck position ~1/7 of the string: comb the excitation to shape the harmonic spectrum like a finger pluck
    const exc = new Float32Array(N + 2); for (let i = 0; i < N + 2; i++) exc[i] = lp(r(), Math.min(9000, f * 11), 0.7, sr).lp;
    const pp = Math.max(1, Math.round(N / 7)); for (let i = 0; i < N + 2; i++) buf[i] = exc[i] - (i >= pp ? exc[i - pp] : 0);
    const T60 = Math.max(0.9, 0.9 + (84 - m) * 0.035); const g = Math.pow(10, -3 / (T60 * f));
    const b1 = reson(210, 3, sr), b2 = reson(560, 4, sr);
    let idx = 0, apx = 0, apy = 0, prev = 0;
    for (let i = 0; i < d.length; i++) {
      const cur = buf[idx]; const nxt = buf[(idx + 1) % (N + 1)];
      let v = g * (bright * cur + (1 - bright) * nxt);
      const ap = C * v + apx - C * apy; apx = v; apy = ap; v = ap;             // fractional-delay tuner
      buf[idx] = v; idx = (idx + 1) % (N + 1);
      const s = cur; const body = b1(s) * 0.9 + b2(s) * 0.5;
      d[i] = s + body * 1.4 + (s - prev) * 0.15; prev = s;                        // a touch of finger "tick"
    }
  });
}

// ---- Pizzicato: KS with a heavy loop damping (the flesh of the finger stops the string) and a big wooden body.
export function pizz(ac, m) {
  return get(ac, 'pizz' + m, 0.75, (d, sr) => {
    const f = mtof(m), P = sr / f, N = Math.floor(P - 0.42 - 0.1), C = apCoef(P - N, 0.42, TAU * f / sr);
    const r = rng(m * 131 + 17); const buf = new Float32Array(N + 2); const lp = svf();
    for (let i = 0; i < N + 2; i++) buf[i] = lp(r(), f * 5, 0.6, sr).lp * 2;
    const g = Math.pow(10, -3 / (0.45 * f)); let idx = 0, apx = 0, apy = 0;
    const b1 = reson(Math.max(90, Math.min(260, f * 1.02)), 5, sr), b2 = reson(420, 3, sr), b3 = reson(980, 3, sr);
    for (let i = 0; i < d.length; i++) {
      const cur = buf[idx], nxt = buf[(idx + 1) % (N + 1)];
      let v = g * (0.42 * cur + 0.58 * nxt); const ap = C * v + apx - C * apy; apx = v; apy = ap; v = ap;
      buf[idx] = v; idx = (idx + 1) % (N + 1);
      d[i] = cur * 0.7 + b1(cur) * 2.2 + b2(cur) * 1.2 + b3(cur) * 0.6;
    }
  });
}

// ---- Spiccato / marcato string note (sampled): 3 detuned band-limited saws, bow-bite filter sweep, rosin
// scrape, and a violin-family body (air mode ~ 280 Hz, wood ~ 450 Hz, bridge hill ~ 2.5 kHz).
export function spicc(ac, m, len = 0.16, v = 0) {
  const tail = 0.12;
  return get(ac, `spc${m}:${len}:${v}`, len + tail, (d, sr) => {
    const f = mtof(m), r = rng(m * 31 + v * 977 + 5); const fl = svf(), nb = svf();
    const det = [-9, 1, 10].map((c) => f * 2 ** ((c + r() * 2) / 1200)); const ph = det.map(() => Math.abs(r())); const dts = det.map((x) => x / sr);
    const b1 = reson(285, 6, sr), b2 = reson(460, 5, sr), b3 = reson(2500, 1.4, sr);
    const nOn = Math.floor(len * sr), atk = 0.006 * sr;
    // multiplicative envelopes (no exp() per sample); the bow-bite cutoff is re-tuned every 16 samples
    const k50 = Math.exp(-1 / (0.05 * sr)), k14 = Math.exp(-1 / (0.014 * sr)), k35 = Math.exp(-1 / (0.035 * sr));
    let e50 = 1, e14 = 1, rel = 1, cut = 6500;
    for (let i = 0; i < d.length; i++) {
      let s = 0;
      for (let k = 0; k < 3; k++) { const dt = dts[k]; let p = ph[k] + dt; if (p >= 1) p -= 1; ph[k] = p; s += 2 * p - 1 - blep(p, dt); }
      let env; if (i < nOn) env = Math.min(1, i / atk) * (0.75 + 0.25 * e50); else { rel *= k35; env = (0.75 + 0.25 * e50) * rel; }
      if ((i & 15) === 0) cut = 2300 + 4200 * e50;
      const y = fl(s * env, cut, 0.8, sr).lp;
      const scrape = e14 > 1e-4 ? nb(r() * e14, 3100, 1.2, sr).bp * 1.1 : 0;
      e50 *= k50; e14 *= k14;
      d[i] = y + b1(y) * 0.8 + b2(y) * 0.6 + b3(y) * 0.5 + scrape;
    }
  });
}

// Modal bank with a pitch glide: each mode is a damped rotator (c, s) whose rotation is re-computed every 32
// samples while the glide is moving (and never again once it has settled) — ~2 multiply-adds per mode-sample.
function modal(d, sr, modes, glide0, glideT, attack) {
  const M = modes.map(([f, a, T]) => ({ f, a, dec: Math.exp(-6.9 / (T * sr)), c: 1, s: 0, cr: 1, sr: 0, e: a })); // sine phase: starts at 0
  let gl = glide0; const gd = Math.exp(-32 / (glideT * sr)); let settled = false;
  for (let i = 0; i < d.length; i++) {
    if ((i & 31) === 0 && !settled) { for (const m of M) { const w = TAU * m.f * (1 + gl) / sr; m.cr = Math.cos(w); m.sr = Math.sin(w); } gl *= gd; if (gl < 1e-5) settled = true; }
    let s = 0;
    for (const m of M) { if (m.e < 1e-5) continue; const c = m.c * m.cr - m.s * m.sr; m.s = m.c * m.sr + m.s * m.cr; m.c = c; m.e *= m.dec; s += m.s * m.e; }
    d[i] = s * Math.min(1, i / (attack * sr));
  }
}
// Glide-free modal bank, mode-outer (each mode is one tight typed loop that stops once it has decayed): ~4x faster
// than modal() for long rings. Sine phase, so every mode starts at 0.
function ring(d, sr, modes, attack) {
  const n = d.length;
  for (const [f, a, T] of modes) {
    const w = TAU * f / sr, dec = Math.exp(-6.9 / (T * sr)), cr = Math.cos(w) * dec, sn = Math.sin(w) * dec;
    let c = a, s = 0; const end = Math.min(n, Math.ceil(T * 1.7 * sr));    // 1.7 x T60 = -100 dB: nothing audible left
    for (let i = 0; i < end; i++) { const nc = c * cr - s * sn; s = c * sn + s * cr; c = nc; d[i] += s; }
  }
  const na = Math.max(1, attack * sr); for (let i = 0; i < na && i < n; i++) d[i] *= i / na;
}
// ---- Timpani: modal membrane (Rossing's measured ratios for a tuned kettle drum), felt-mallet contact
// (a raised-cosine force pulse, softer = longer), tension pitch glide on the attack, kettle air thump.
export function timpani(ac, m, v = 0) {
  return get(ac, `timp${m}:${v}`, 1.8, (d, sr) => {
    const f = mtof(m); const r = rng(m * 53 + v * 11 + 1);
    const modes = [[0.54, 0.5, 0.18], [1, 1, 1.9], [1.504, 0.55, 1.3], [1.742, 0.18, 0.7], [2.0, 0.34, 0.95], [2.245, 0.12, 0.5], [2.494, 0.2, 0.6], [2.8, 0.09, 0.4], [2.98, 0.1, 0.4]];
    modal(d, sr, modes.map(([rt, a, T]) => [f * rt, a, T]), 0.035, 0.05, 0.0015);
    // felt mallet: raised-cosine contact force + a short low-passed noise thump (first 80 ms only)
    const pulse = (0.004 + v * 0.001) * sr, lp = svf(), k = Math.exp(-1 / (0.01 * sr)); let e = 1;
    for (let i = 0; i < Math.min(d.length, 0.08 * sr); i++) { const hit = i < pulse ? 0.5 - 0.5 * Math.cos(TAU * i / pulse) : 0; d[i] += hit * 0.6 + lp(r() * e, 1600, 0.7, sr).lp * 0.9; e *= k; }
  });
}

// ---- Snare: two membrane modes + stick click + wire rattle (band-passed noise whose envelope trails the head).
// Four takes: round-robin so a roll never machine-guns.
export function snare(ac, v = 0) {
  return get(ac, 'snr' + v, 0.42, (d, sr) => {
    const r = rng(9001 + v * 313); const w = svf(), c = svf(); let p1 = 0, p2 = 0, p3 = 0;
    const f0 = 186 * (1 + v * 0.012);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      p1 += TAU * f0 * (1 + 0.25 * Math.exp(-t / 0.01)) / sr; p2 += TAU * f0 * 1.59 / sr; p3 += TAU * f0 * 2.14 / sr;
      const head = (Math.sin(p1) * 0.9 + Math.sin(p2) * 0.45 + Math.sin(p3) * 0.25) * Math.exp(-t / 0.045);
      const n = r();
      const wires = w(n, 4200, 0.55, sr).bp * (Math.exp(-t / 0.075) * 0.9 + Math.exp(-t / 0.02) * 0.6) * 1.6;
      const click = c(n, 6500, 1.2, sr).hp * Math.exp(-t / 0.0025) * 1.4;
      d[i] = head * 0.7 + wires + click;
    }
  });
}

// ---- Gran cassa (orchestral bass drum): deep modal thud for heroic downbeats and the defeat cue.
export function bassDrum(ac) {
  return get(ac, 'bd', 2.0, (d, sr) => {
    const r = rng(77); const lp = svf();
    modal(d, sr, [[46, 1, 1.4], [72, 0.5, 0.7], [101, 0.3, 0.45], [131, 0.18, 0.3]], 0.12, 0.04, 0.003);
    const k = Math.exp(-1 / (0.012 * sr)); let e = 1;
    for (let i = 0; i < Math.min(d.length, 0.1 * sr); i++) { d[i] += lp(r() * e, 700, 0.7, sr).lp * 0.7; e *= k; }
  });
}

// ---- Glockenspiel (round 8): steel bar, free-free modes (1 : 2.76 : 5.40 : 8.93), hard brass mallet = a short
// bright contact click. Used by the pastoral/formation themes and the level-up / JP / save stingers.
export function glock(ac, m) {
  return get(ac, 'glk' + m, 1.7, (d, sr) => {
    const f = mtof(m); const r = rng(m * 97 + 11); const lp = svf();
    const modes = [[1, 1, 1.5], [2.756, 0.3, 0.55], [5.404, 0.12, 0.2], [8.933, 0.05, 0.09]].filter(([k]) => f * k < sr * 0.45);
    modal(d, sr, modes.map(([k, a, T]) => [f * k, a, T]), 0, 0.01, 0.0008);
    const k = Math.exp(-1 / (0.0016 * sr)); let e = 1;
    for (let i = 0; i < Math.min(d.length, 0.02 * sr); i++) { d[i] += lp(r() * e, 7000, 0.8, sr).lp * 0.35; e *= k; }
  });
}

// ---- Bells (round 14, Chapter II). `m` is the PERCEIVED strike pitch.
// v 0 = tubular bell (orchestral chime): a free-free tube whose strong modes 4/5/6 sit near 2 : 3 : 4.17 of the strike
//       note, so the ear hears a virtual pitch an octave below them (Rossing); modes 3/7/8 (1.21 / 5.56 / 7.14) are the
//       metallic, inharmonic colour. Brass hammer = a short bright contact noise.
// v 1 = great bell (cast church bell): hum 0.5, prime 1, MINOR-third tierce 1.19, quint 1.5, nominal 2, superquint 2.5,
//       octave nominal 4, each low mode a DOUBLET (two modes a fraction of a hertz apart: the slow "wah" beating of an
//       asymmetric casting), long hum. Iron clapper = a heavy low-passed thump.
// Long tails get an explicit 0.6 s cosine fade inside the generator (on top of finish()'s end fade) so a truncated
// hum can never step at the buffer end. Cost ~ modes x samples rotator steps (~5-9 ms per buffer), built once.
export function bell(ac, m, v = 0) {
  const len = v ? 5.5 : 4.4;
  return get(ac, `bell${m}:${v}`, len, HALF((d, sr) => {
    const f = mtof(m); const r = rng(m * 191 + v * 7 + 3);
    const spec = v
      ? [[0.5, 0.5, 6.5], [0.5015, 0.28, 6.0], [1, 0.75, 4.2], [1.0022, 0.4, 4.0], [1.19, 0.6, 3.4], [1.1935, 0.3, 3.1], [1.5, 0.22, 2.4], [2, 0.7, 2.2], [2.004, 0.3, 2.0], [2.51, 0.3, 1.4], [2.67, 0.14, 1.1], [3.01, 0.12, 0.9], [4.02, 0.1, 0.6], [5.37, 0.05, 0.35]]
      : [[1, 0.2, 2.8], [1.212, 0.3, 2.6], [2, 1, 3.6], [2.004, 0.25, 3.2], [2.994, 0.75, 3.0], [4.173, 0.5, 2.2], [5.556, 0.28, 1.5], [7.136, 0.14, 0.9], [8.9, 0.07, 0.55]];
    ring(d, sr, spec.filter(([k]) => f * k < sr * 0.45).map(([k, a, T]) => [f * k, a, T]), v ? 0.004 : 0.0012);
    const lp = svf(); const k = Math.exp(-1 / ((v ? 0.012 : 0.0025) * sr)); let e = 1;
    for (let i = 0; i < Math.min(d.length, 0.06 * sr); i++) { d[i] += lp(r() * e, v ? 1400 : 6500, 0.8, sr)[v ? 'lp' : 'bp'] * (v ? 0.9 : 0.5); e *= k; }
    const fl = Math.floor(0.6 * sr); for (let i = 0; i < fl; i++) d[d.length - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fl);
  }));
}
// ---- Celesta (round 14): felt hammer on a steel plate over a tuned wooden resonator -> almost a pure fundamental
// with a weak octave and a glassy 4th-ish partial; soft attack, ~1.3 s ring. The "snow" of the Northreach map.
export function celesta(ac, m) {
  return get(ac, 'cel' + m, 1.7, (d, sr) => {
    const f = mtof(m); const r = rng(m * 61 + 29); const lp = svf();
    const modes = [[1, 1, 1.35], [1.0012, 0.25, 1.2], [2, 0.08, 0.5], [3.99, 0.06, 0.22], [5.93, 0.02, 0.1]].filter(([k]) => f * k < sr * 0.45);
    ring(d, sr, modes.map(([k, a, T]) => [f * k, a, T]), 0.0025);
    const k = Math.exp(-1 / (0.003 * sr)); let e = 1;
    for (let i = 0; i < Math.min(d.length, 0.02 * sr); i++) { d[i] += lp(r() * e, 3200, 0.7, sr).lp * 0.25; e *= k; }
  });
}

// ---- Cymbals: a cloud of inharmonic partials (the metal) plus high-passed noise (the wash), each with its own decay.
function metal(d, sr, seed, { n = 48, lo = 380, hi = 11000, T = 1.6, wash = 0.8, washT = 1.2, attack = 0.002, hpf = 3000 }) {
  const r = rng(seed); const P = [];
  // each partial is a recursive rotator (c, s) *= (cos w, sin w) * decay: two multiply-adds per sample, no sin()
  for (let k = 0; k < n; k++) {
    const f = lo * (hi / lo) ** ((k + 0.5 + r() * 0.5) / n); const Tk = T * (0.35 + 0.65 * Math.abs(r())) * (4000 / (f + 2000));
    const dec = Math.exp(-6.9 / (Tk * sr)); const w = TAU * f / sr; const ph = Math.abs(r()) * TAU;
    P.push({ c: Math.cos(ph), s: Math.sin(ph), cr: Math.cos(w) * dec, sr: Math.sin(w) * dec, a: (0.4 + 0.6 * Math.abs(r())) / Math.sqrt(k + 1), live: true });
  }
  const h = svf(); const wd = Math.exp(-6.9 / (washT * sr)); let we = wash;
  for (let i = 0; i < d.length; i++) {
    let s = 0;
    for (let k = 0; k < P.length; k++) { const p = P[k]; if (!p.live) continue; const c = p.c * p.cr - p.s * p.sr; p.s = p.c * p.sr + p.s * p.cr; p.c = c; s += c * p.a; if ((i & 1023) === 0 && c * c + p.s * p.s < 1e-7) p.live = false; }
    const ns = h(r(), hpf, 0.6, sr).hp * we; we *= wd;
    d[i] = (s * 0.35 + ns) * Math.min(1, i / (attack * sr));
  }
}
export function crash(ac, v = 0) { return get(ac, 'crash' + v, 2.4, (d, sr) => metal(d, sr, 4242 + v, { n: 36, T: 1.9, washT: 2.1, wash: 1.1, attack: 0.0015 })); }
export function sizzle(ac, v = 0) { return get(ac, 'siz' + v, 0.35, (d, sr) => metal(d, sr, 555 + v * 9, { n: 40, lo: 2500, hi: 13000, T: 0.25, washT: 0.18, wash: 0.9, hpf: 6500 })); }
export function susCym(ac) { return get(ac, 'sus', 2.6, (d, sr) => metal(d, sr, 808, { n: 36, lo: 500, hi: 12000, T: 2.6, washT: 2.8, wash: 1.0, attack: 0.003, hpf: 4000 })); }

// ---- SFX textures: long-tail granular content that used to be dozens of little per-grain node graphs.
export function crackle(ac, v = 0) {
  return get(ac, 'crk' + v, 1.2, (d, sr) => {
    const r = rng(1234 + v); const f = svf();
    let next = 0; let amp = 0, cf = 3000;
    for (let i = 0; i < d.length; i++) {
      if (i >= next) { amp = 0.3 + 0.7 * Math.abs(r()); cf = 2200 + 5000 * Math.abs(r()); next = i + Math.floor(sr * (0.012 + 0.05 * Math.abs(r()))); }
      amp *= 0.9975; const t = i / d.length;
      d[i] = f(r(), cf, 2.8, sr).bp * amp * (1 - t);
    }
  });
}
export function debris(ac) {
  return get(ac, 'deb', 1.3, (d, sr) => {
    const r = rng(4321); const f = svf(); let next = 0, amp = 0, cf = 1500;
    for (let i = 0; i < d.length; i++) {
      if (i >= next) { amp = 0.4 + 0.6 * Math.abs(r()); cf = 700 + 2800 * Math.abs(r()); next = i + Math.floor(sr * (0.02 + 0.07 * Math.abs(r()))); }
      amp *= 0.9985; d[i] = f(r(), cf, 2, sr).bp * amp * (1 - i / d.length);
    }
  });
}
export function shards(ac) {
  return get(ac, 'shd', 0.9, (d, sr) => {
    const r = rng(999);
    for (let k = 0; k < 14; k++) { // each shard: a damped rotator started at its own time
      const i0 = Math.floor(Math.abs(r()) * 0.35 * sr), f = 3800 + Math.abs(r()) * 6800, T = 0.02 + Math.abs(r()) * 0.05, a = 0.4 + 0.6 * Math.abs(r());
      const w = TAU * f / sr, dec = Math.exp(-1 / (T * sr)), cr = Math.cos(w) * dec, sn = Math.sin(w) * dec; let c = a, s = 0;
      for (let i = i0; i < d.length && c * c + s * s > 1e-8; i++) { d[i] += s; const nc = c * cr - s * sn; s = c * sn + s * cr; c = nc; }
    }
  });
}

// Pitched banks are generated every 3 semitones and transposed by playbackRate (at most +-1 semitone, below
// what the ear hears as a timbre shift on a pluck/short bow): a third of the memory and generation time.
export function bank(fn, ac, m, ...a) { const base = 3 * Math.round(m / 3); return { buf: fn(ac, base, ...a), rate: 2 ** ((m - base) / 12) }; }

export function cacheSize() { let n = 0; for (const b of CACHE.values()) n += b.length * 4; return { buffers: CACHE.size, bytes: n }; }
