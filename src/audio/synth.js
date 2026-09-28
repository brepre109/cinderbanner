// Procedural WebAudio engine (round 7): works on a live AudioContext or an OfflineAudioContext (for bounces).
//
// Architecture — cheap voices, rich SECTIONS:
//  * Every orchestral section (pad strings, violins, violas, cello spiccato, bass, harp, brass, horn, trumpet,
//    choir, timpani, snare, cymbals) is a PERSISTENT chain built once: three seat inputs (L/C/R panners inside the
//    section's stereo spread) -> highpass -> lowpass -> optional formant/presence peak -> optional stereo ensemble
//    chorus (two LFO-modulated delay lines, one per channel, which is where the string vibrato and section
//    "shimmer" now come from) -> the music bus.
//  * A note is therefore tiny: oscillators (or one sample source from foundry.js) + one or two envelope gains
//    feeding a seat. No per-note biquads except where the articulation needs a filter envelope (brass bloom,
//    horn lead). Nothing ever connects a long-lived node INTO a short-lived one, so stopped voices are released
//    by the engine instead of being pinned by an always-running LFO (the round-6 leak).
//  * A voice budget (admit) drops decorative layers first when the scheduled density gets too high.
//  * Room: a generated stereo hall impulse with discrete early reflections and a frequency-dependent diffuse tail
//    (lows ring longest, highs die first), behind a pre-delay.
//  * Buses -> master -> glue compressor -> brickwall limiter -> trim -> mute -> destination.
import * as F from './foundry.js';
export const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// MONO on purpose: every voice source in the engine is mono and only panners/sections make stereo. A stereo noise
// buffer used to flip the channel count of whatever it fed (1 -> 2 -> 1), and Chrome re-creates biquad kernels
// and switches StereoPanner algorithms on such a flip — a click on every OTHER voice sharing that node.
function makeNoise(ac, sec = 2) {
  const b = ac.createBuffer(1, Math.floor(ac.sampleRate * sec), ac.sampleRate);
  for (let c = 0; c < 1; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  return b;
}
// Stereo hall impulse. Early reflections: 14 discrete, slightly low-passed taps per channel at DIFFERENT times
// per ear (that interaural difference is the width). Diffuse tail: three noise bands with their own T60
// (low 2.5 s, mid 2.0 s, high 0.8 s) so the tail darkens as it decays, faded in over the first 60 ms so the
// reflections read first.
function makeImpulse(ac, sec = 2.6) {
  const sr = ac.sampleRate, n = Math.floor(sr * sec); const b = ac.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c); let l1 = 0, l2 = 0, h1 = 0, prevRaw = 0;
    const kL = 1 - Math.exp(-2 * Math.PI * 450 / sr), kH = 1 - Math.exp(-2 * Math.PI * 3800 / sr);
    const dL = Math.exp(-6.9 / (2.5 * sr)), dM = Math.exp(-6.9 / (2.0 * sr)), dH = Math.exp(-6.9 / (0.8 * sr));
    let eL = 1, eM = 1, eH = 1;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      l1 += (w - l1) * kL; l2 += (l1 - l2) * kL;                 // low band (2-pole)
      h1 = 0.5 * (h1 + w - prevRaw); prevRaw = w;                // crude high band
      const hi = w - l2; const mid = hi - h1 * (1 - kH);
      const fade = Math.min(1, i / (sr * 0.06));
      d[i] = (l2 * eL * 1.6 + mid * eM * 0.55 + h1 * eH * 0.3) * fade * 0.5;
      eL *= dL; eM *= dM; eH *= dH;
    }
    // early reflections
    for (let k = 0; k < 14; k++) {
      const tms = 7 + k * 5.6 + (c ? 2.1 : 0) * ((k % 3) - 1) + Math.random() * 2.5;
      const at = Math.floor(tms * sr / 1000); const g = 0.55 * Math.exp(-k * 0.16) * (Math.random() > 0.5 ? 1 : -1);
      for (let j = 0; j < 12 && at + j < n; j++) d[at + j] += g * Math.exp(-j / 2.5) * 0.4;
    }
    d[0] = 0;
  }
  return b;
}

// Section definitions: seat (pan centre), width (L/R seat spread), filters, optional peak, chorus.
export const SEAT = { vln1: -0.62, vln2: -0.1, viola: 0.34, cello: 0.5, bass: 0.04, harp: -0.6, horn: -0.14, brass: 0.3, timp: 0.08, snare: -0.16, cym: 0.5, choir: 0 };
const SECT = {
  pad:   { pan: -0.08, width: 0.62, hp: 140, lp: 2100, q: 0.5, chorus: [0.7, 0.8] },
  vln:   { pan: -0.5, width: 0.26, hp: 260, lp: 5600, q: 0.5, peak: [2700, 2.2, 1.1], chorus: [0.65, 0.8] },
  viola: { pan: 0.32, width: 0.22, hp: 150, lp: 3200, q: 0.5, chorus: [0.7, 0.75] },
  cello: { pan: 0.46, width: 0.18, hp: 65, lp: 5200, q: 0.5 },
  bass:  { pan: 0.04, width: 0.06, hp: 38, lp: 520, q: 0.7 },
  pizz:  { pan: 0.2, width: 0.3, hp: 45, lp: 4200, q: 0.5 },
  harp:  { pan: -0.52, width: 0.28, hp: 110, lp: 9500, q: 0.5 },
  brass: { pan: 0.3, width: 0.2, hp: 85, lp: 14000, q: 0.5, peak: [1300, 2.5, 1.0] },
  horn:  { pan: -0.14, width: 0.1, hp: 100, lp: 9000, q: 0.5, peak: [1150, 4.5, 1.4] },
  tpt:   { pan: 0.14, width: 0.12, hp: 190, lp: 11000, q: 0.5, peak: [1550, 3.5, 1.2] },
  choir: { pan: 0, width: 0.5, hp: 160, lp: 5200, q: 0.5, formant: true, chorus: [0.6, 0.9] },
  timp:  { pan: 0.08, width: 0.1, hp: 32, lp: 9000, q: 0.5 },
  snare: { pan: -0.16, width: 0.12, hp: 110, lp: 15000, q: 0.5 },
  cym:   { pan: 0.45, width: 0.3, hp: 1800, lp: 18000, q: 0.5 },
  // round 8 woodwinds + glockenspiel. Winds are solo voices (no chorus); the body/formant peaks are what make a
  // flute read as a flute and an oboe as an oboe once the harmonic recipe (PeriodicWave, see WIND) is fixed.
  flute: { pan: -0.26, width: 0.08, hp: 240, lp: 9500, q: 0.5, peaks: [[850, 1.5, 1.0], [2400, 1.2, 1.4]] },
  oboe:  { pan: 0.12, width: 0.08, hp: 300, lp: 7400, q: 0.5, peaks: [[1150, 6.0, 2.4], [2950, 3.5, 2.6], [650, -3, 1.2]] },
  clar:  { pan: 0.28, width: 0.08, hp: 120, lp: 4800, q: 0.5, peaks: [[1450, 2.0, 1.4], [3000, -3, 1.0]] },
  glock: { pan: 0.22, width: 0.18, hp: 500, lp: 15000, q: 0.5 },
  // round 14 (Chapter II): tubular / great bells, celesta, and a pipe-organ pad (a gentle celeste chorus, no vibrato)
  bell:  { pan: 0.16, width: 0.42, hp: 55, lp: 12000, q: 0.5 },
  celesta: { pan: 0.3, width: 0.22, hp: 300, lp: 11000, q: 0.5 },
  organ: { pan: 0, width: 0.6, hp: 38, lp: 6200, q: 0.5, peaks: [[250, -2.5, 0.9], [1900, 1.5, 1.0]], chorus: [0.85, 0.45] },
};
// Pipe-organ registration (harmonic amplitudes): 8' principal + 4' octave + 2 2/3' twelfth + 2' fifteenth + mixture.
const ORGAN = [1, 0.62, 0.3, 0.42, 0.08, 0.2, 0.03, 0.16, 0.02, 0.05, 0, 0.05];
// Woodwind harmonic recipes (amplitude of harmonics 1..n) + articulation. Flute: nearly pure, a little 2nd;
// oboe: rich, strong upper partials (the formant peaks above make it nasal); clarinet: odd harmonics dominate.
const WIND = {
  flute: { h: [1, 0.32, 0.11, 0.05, 0.025, 0.012], a: 0.055, vib: 13, vibRate: 5.2, breath: 0.2, chiff: 0.5, gain: 0.1 },
  oboe:  { h: [1, 0.95, 0.9, 0.62, 0.55, 0.42, 0.33, 0.26, 0.2, 0.15, 0.11, 0.08], a: 0.03, vib: 9, vibRate: 5.6, breath: 0.05, chiff: 0.2, gain: 0.12 },
  clar:  { h: [1, 0.04, 0.72, 0.05, 0.46, 0.04, 0.3, 0.03, 0.18, 0.02, 0.11], a: 0.04, vib: 2, vibRate: 5.0, breath: 0.07, chiff: 0.25, gain: 0.1 },
};

export class Engine {
  constructor(ac, { master = 0.6, trim = 0.92 } = {}) {
    this.ac = ac; this.noise = makeNoise(ac, 2); this.muted = false;
    // Probe contract: count every AudioNode this engine creates (shots/audio/probe.mjs asserts growth).
    this.nodes = 0; this.lv = { master: 1, music: 1, sfx: 1 }; this._baseMaster = master;
    this.ends = []; this.rr = 0; this.dropped = 0;
    const g = (v) => { this.nodes++; const n = ac.createGain(); n.gain.value = v; return n; };
    this.master = g(master);
    this.comp = new DynamicsCompressorNode(ac, { threshold: -20, knee: 16, ratio: 2, attack: 0.012, release: 0.22 });
    this.limiter = new DynamicsCompressorNode(ac, { threshold: -5, knee: 0.5, ratio: 20, attack: 0.0006, release: 0.05 });
    this.nodes += 2;
    this.trim = g(trim); this.muteGain = g(1);
    // Pin the whole bus to EXPLICIT stereo. Otherwise the channel count of the master chain flips between 1 and 2
    // as mono voices (oscillators) and stereo voices (noise, panned sections) start and stop, and Chrome's
    // DynamicsCompressor / Convolver reset their internal state on every flip — an audible click (measured: a
    // 0.03 step exactly when a stereo noise burst ended under a mono sine).
    for (const n of [this.master, this.comp, this.limiter, this.trim]) { n.channelCountMode = 'explicit'; n.channelCount = 2; n.channelInterpretation = 'speakers'; }
    this.master.connect(this.comp); this.comp.connect(this.limiter); this.limiter.connect(this.trim); this.trim.connect(this.muteGain); this.muteGain.connect(ac.destination);
    this.verbPre = new DelayNode(ac, { delayTime: 0.022, maxDelayTime: 0.2 });
    this.verb = ac.createConvolver(); this.verb.buffer = makeImpulse(ac); this.nodes += 2;
    this.verbHp = this.filt('highpass', 220, 0.5); this.verbLp = this.filt('lowpass', 7500, 0.5);
    this.verbReturn = g(0.62);
    for (const n of [this.verbPre, this.verb]) { n.channelCountMode = 'explicit'; n.channelCount = 2; }
    this.verbPre.connect(this.verb); this.verb.connect(this.verbHp); this.verbHp.connect(this.verbLp); this.verbLp.connect(this.verbReturn); this.verbReturn.connect(this.master);
    // music bus EQ: HP -> low shelf -> low-mid scoop -> presence -> air -> duck -> level -> master (+ reverb send)
    this.music = g(1); this.duckGain = g(1); this.musicLevel = g(1);
    this.musicHp = this.filt('highpass', 40, 0.7);
    this.musicLow = this.filt('lowshelf', 110); this.musicLow.gain.value = -1.5;
    this.musicMud = this.filt('peaking', 240, 0.9); this.musicMud.gain.value = -2.5;
    this.musicPres = this.filt('peaking', 2600, 0.85); this.musicPres.gain.value = 2.0;
    this.musicAir = this.filt('highshelf', 8000); this.musicAir.gain.value = 2.5;
    this.music.connect(this.musicHp); this.musicHp.connect(this.musicLow); this.musicLow.connect(this.musicMud); this.musicMud.connect(this.musicPres); this.musicPres.connect(this.musicAir); this.musicAir.connect(this.duckGain); this.duckGain.connect(this.musicLevel); this.musicLevel.connect(this.master);
    this.musicVerb = g(0.36); this.musicLevel.connect(this.musicVerb); this.musicVerb.connect(this.verbPre);
    // sfx bus (never ducked, its own smaller send)
    this.sfx = g(1); this.sfxHp = this.filt('highpass', 34, 0.6); this.sfxTone = this.filt('highshelf', 6000); this.sfxTone.gain.value = 1.5; this.sfxLevel = g(1);
    const stereo = (n) => { n.channelCountMode = 'explicit'; n.channelCount = 2; n.channelInterpretation = 'speakers'; return n; };
    stereo(this.sfx); stereo(this.music); this.stereo = stereo;
    this.sfx.connect(this.sfxHp); this.sfxHp.connect(this.sfxTone); this.sfxTone.connect(this.sfxLevel); this.sfxLevel.connect(this.master);
    this.sfxVerb = g(0.22); this.sfxLevel.connect(this.sfxVerb); this.sfxVerb.connect(this.verbPre);
    this.sects = {}; this.lfos = []; this._waves = {};
  }
  // A DECK is a lightweight view of this engine with its own section chains feeding its own fader, so two pieces
  // of music can overlap for a crossfade (or a stinger can ride the sfx bus with orchestral instruments) without
  // sharing (and cutting) each other's sections. Everything else (noise, reverb, buses, foundry) is shared.
  // dispose() stops the section LFOs so a finished deck is fully collectable.
  deck(dest = this.music) {
    const d = Object.create(this);
    d.sects = {}; d.lfos = []; d.ends = [];
    // node / drop counters stay on the parent so probes reading engine.nodes / engine.dropped see every deck
    for (const k of ['nodes', 'dropped']) Object.defineProperty(d, k, { get: () => this[k], set: (v) => { this[k] = v; } });
    d.music = this.stereo(this.gain(1)); d.fader = this.stereo(this.gain(1)); d.music.connect(d.fader); d.fader.connect(dest);
    d.dispose = () => { for (const o of d.lfos) { try { o.stop(); } catch { /* already stopped */ } } d.lfos = []; try { d.fader.disconnect(); } catch { /* ok */ } d.sects = {}; };
    return d;
  }
  now() { return this.ac.currentTime; }
  setMuted(m) { this.muted = m; const t = this.now(); this.muteGain.gain.cancelScheduledValues(t); this.muteGain.gain.setTargetAtTime(m ? 0 : 1, t, 0.03); }
  setMaster(v) { this.lv.master = clamp(v, 0, 1); this.master.gain.setTargetAtTime(this._baseMaster * this.lv.master, this.now(), 0.04); }
  setMusic(v) { this.lv.music = clamp(v, 0, 1); this.musicLevel.gain.setTargetAtTime(this.lv.music, this.now(), 0.04); }
  setSfx(v) { this.lv.sfx = clamp(v, 0, 1); this.sfxLevel.gain.setTargetAtTime(this.lv.sfx, this.now(), 0.04); }
  duck(amount = 0.5, hold = 0.3, t = this.now()) {
    const p = this.duckGain.gain; p.cancelScheduledValues(t); p.setTargetAtTime(1 - amount, t, 0.02); p.setTargetAtTime(1, t + hold, 0.35);
  }
  // ---- building blocks ----
  osc(type, f, t, stop, detune = 0) { this.nodes++; const o = new OscillatorNode(this.ac, { type, frequency: f, detune }); o.start(t); o.stop(stop); return o; }
  noiseSrc(t, stop, rate = 1) { this.nodes++; const s = this.ac.createBufferSource(); s.buffer = this.noise; s.loop = true; s.playbackRate.value = rate; s.loopStart = Math.random() * 1.5; s.start(t, s.loopStart); s.stop(stop); return s; }
  filt(type, f, q = 0.7) { this.nodes++; const b = this.ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  // Default intrinsic value 0: a bare gain() is always an ENVELOPE, and must be silent before its first automation
  // event. (With the WebAudio default of 1, a source whose start frame rounds one frame earlier than the envelope's
  // setValueAtTime passed one sample at unity — a measured 0.01-0.19 spike on noise-based SFX.)
  gain(v = 0) { this.nodes++; const n = this.ac.createGain(); n.gain.value = v; return n; }
  pan(v) { this.nodes++; return new StereoPannerNode(this.ac, { pan: clamp(v, -1, 1) }); }
  // AHDSR: attack ramp (clamped inside the note so a short note can never leave a ramp "stuck" open), decay to
  // sustain, exponential release from t+dur. Returns the time the voice is inaudible (stop time).
  env(p, t, peak, { a = 0.01, d = 0.2, s = 1, r = 0.1 } = {}, dur = 0.2) {
    a = Math.min(a, Math.max(0.003, dur * 0.8));
    p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(peak, t + a); if (s < 1) p.setTargetAtTime(peak * s, t + a, d / 3); p.setTargetAtTime(0.0001, t + dur, r / 3); return t + dur + r * 2.6;
  }
  // Voice budget. weight ~ oscillators; prio 0 = never drop (bass, lead, sfx), 1 = normal, 2 = decoration.
  admit(t, end, weight = 1, prio = 1) {
    if (this.ends.length > 48) { const now = this.now(); this.ends = this.ends.filter((e) => e[0] > now); }
    let live = 0; for (const e of this.ends) if (e[0] > t && e[1] <= t + 0.05) live += e[2];
    const cap = prio === 0 ? Infinity : prio === 1 ? 260 : 170;
    if (live + weight > cap) { this.dropped++; return false; }
    this.ends.push([end, t, weight]); return true;
  }
  // Persistent section chain (lazy).
  sect(name) {
    let s = this.sects[name]; if (s) return s;
    const c = SECT[name]; const ac = this.ac;
    const sum = this.gain(1);
    const ins = [-1, 0, 1].map((k) => { const i = this.gain(1); const p = this.pan(c.pan + k * c.width); i.connect(p); p.connect(sum); return i; });
    const hp = this.filt('highpass', c.hp, 0.6); const lp = this.filt('lowpass', c.lp, c.q); sum.connect(hp); hp.connect(lp);
    let tail = lp;
    if (c.formant) { // vowel "ah" (open) formants in parallel, summed back
      const fsum = this.gain(1);
      for (const [f, q, gg] of [[730, 5, 1], [1090, 6, 0.7], [2440, 5, 0.35], [3400, 4, 0.12]]) { const b = this.filt('bandpass', f, q); const bg = this.gain(gg * 2.2); tail.connect(b); b.connect(bg); bg.connect(fsum); }
      tail = fsum;
    }
    for (const pkd of c.peaks || (c.peak ? [c.peak] : [])) { const pk = this.filt('peaking', pkd[0], pkd[2]); pk.gain.value = pkd[1]; tail.connect(pk); tail = pk; }
    const out = this.gain(1);
    if (c.chorus) {
      // stereo ensemble: dry + two independently modulated delay lines (one per channel). Fast LFO ~ bowing
      // vibrato (~7 cents), slow LFO ~ section drift. Rates differ per section so sections never pulse together.
      const [dry, wet] = c.chorus; const dg = this.gain(dry); tail.connect(dg); dg.connect(out);
      const sp = new ChannelSplitterNode(ac, { numberOfOutputs: 2 }); const mg = new ChannelMergerNode(ac, { numberOfInputs: 2 }); this.nodes += 2;
      tail.connect(sp); const wg = this.gain(wet); mg.connect(wg); wg.connect(out);
      const seed = Object.keys(this.sects).length;
      for (let ch = 0; ch < 2; ch++) {
        const dl = new DelayNode(ac, { delayTime: 0.012 + ch * 0.004, maxDelayTime: 0.05 }); this.nodes++;
        for (const [rate, depth] of [[4.6 + ch * 0.55 + seed * 0.13, 0.00022], [0.19 + ch * 0.07 + seed * 0.02, 0.0016]]) {
          this.nodes++; const o = new OscillatorNode(ac, { type: 'sine', frequency: rate }); const dg2 = this.gain(depth); o.connect(dg2); dg2.connect(dl.delayTime); o.start(); this.lfos.push(o);
        }
        sp.connect(dl, ch); dl.connect(mg, 0, ch);
      }
    } else tail.connect(out);
    out.connect(this.music);
    s = this.sects[name] = { ins, out, pan: c.pan, width: c.width }; return s;
  }
  // Pick seat weights from a desired pan: returns [[input, weight], ...] across the section's L/C/R seats.
  seats(sec, pan) {
    const x = clamp(((pan ?? sec.pan) - sec.pan) / Math.max(0.05, sec.width), -1, 1);
    return x < 0 ? [[sec.ins[0], -x], [sec.ins[1], 1 + x]] : [[sec.ins[1], 1 - x], [sec.ins[2], x]];
  }
  // Sample voice: BufferSource -> Gain -> seat. 2 nodes. Stops itself when the buffer ends.
  smp(buf, t, gain, sectName, { pan, rate = 1, prio = 1, dest } = {}) {
    if (!buf) return;                                        // still being generated (foundry deferral): skip this note
    const end = t + buf.duration / rate; if (!this.admit(t, end, 1, prio)) return;
    this.nodes++; const s = new AudioBufferSourceNode(this.ac, { buffer: buf, playbackRate: rate });
    const g = this.gain(gain); s.connect(g);
    if (dest) g.connect(dest); else { const sec = this.sect(sectName); const [[i0, w0], [i1, w1]] = this.seats(sec, pan); g.connect(w0 >= w1 ? i0 : i1); }
    s.start(t);
  }
  // AT/CT clock tick
  clockTick(t, left = 3, vel = 1) {
    const f = 1560 + Math.max(0, 4 - left) * 260;
    const n = this.noiseSrc(t, t + 0.05); const bp = this.filt('bandpass', 3400, 2.2); const g = this.gain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.2 * vel, t + 0.002); g.gain.setTargetAtTime(0.0001, t + 0.006, 0.013);
    n.connect(bp); bp.connect(g); g.connect(this.sfx);
    const o = this.osc('triangle', f, t, t + 0.07); const og = this.gain();
    og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.13 * vel, t + 0.004); og.gain.setTargetAtTime(0.0001, t + 0.012, 0.016);
    o.connect(og); og.connect(this.sfx);
  }
  // Route ONE synchronous SFX call through a per-event pan/gain pair (screen placement).
  at(place, fn) {
    if (!place) { fn(); return; }
    const g = this.stereo(this.gain(place.gain ?? 1)); const p = this.pan(place.pan ?? 0);
    g.connect(p); p.connect(this.sfx);
    const real = this.sfx; this.sfx = g;
    try { fn(); } finally { this.sfx = real; }
  }

  // ======================= orchestral instruments =======================
  // Section strings (legato): 4 detuned saws split over two seats, bow-hair noise on the attack. Vibrato and
  // ensemble shimmer come from the section chorus. o.sect picks the section ('pad' dark, 'vln' bright, 'viola').
  strings(t, m, dur, vel = 0.8, o = {}) {
    const name = o.sect || 'pad'; const f = mtof(m); const a = o.attack ?? 0.22, r = o.release ?? 0.4;
    const end = t + dur + r * 2.6; if (!this.admit(t, end, o.oct ? 5 : 4, o.prio ?? 1)) return;
    const sec = this.sect(name); const peak = (o.gain ?? 0.03) * vel * 1.25;
    const x = clamp(((o.pan ?? sec.pan) - sec.pan) / Math.max(0.05, sec.width), -1, 1);
    const gL = this.gain(), gR = this.gain();
    this.env(gL.gain, t, peak * (1 - 0.6 * x), { a, d: 0.6, s: 0.85, r }, dur); this.env(gR.gain, t, peak * (1 + 0.6 * x), { a, d: 0.6, s: 0.85, r }, dur);
    (o.detunes || [-12, -4, 5, 13]).forEach((d, i) => { const s = this.osc('sawtooth', f, t, end, d + (Math.random() - 0.5) * 3); s.connect(i % 2 ? gR : gL); });
    if (o.oct) { const s = this.osc('sawtooth', f * 2, t, end, 4); const og = this.gain(o.oct); s.connect(og); og.connect(gL); og.connect(gR); }
    gL.connect(sec.ins[0]); gR.connect(sec.ins[2]);
    // bow: a breath of rosin noise that swells with the attack and is gone once the tone speaks
    if (o.bow !== false && vel > 0.25) {
      const n = this.noiseSrc(t, t + a + 0.25); const bp = this.filt('bandpass', Math.min(6000, f * 5), 0.9); const ng = this.gain();
      const bpk = peak * (a < 0.1 ? 0.55 : 0.3); ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(bpk, t + Math.max(0.01, a * 0.4)); ng.gain.setTargetAtTime(0.0001, t + a * 0.6, 0.05);
      n.connect(bp); bp.connect(ng); ng.connect(sec.ins[1]);
    }
  }
  // Marcato / spiccato: sampled (foundry.spicc) — 2 nodes per note.
  stacStrings(t, m, vel = 0.8, o = {}) {
    const len = (o.dur ?? 0.13) > 0.1 ? 0.16 : 0.09;
    const { buf, rate } = F.bank(F.spicc, this.ac, Math.round(m), len, this.rr++ % 2);
    this.smp(buf, t, (o.gain ?? 0.028) * vel * 3.5, o.sect || 'cello', { pan: o.pan, prio: o.prio ?? 1, rate });
  }
  // Contrabass (+ quiet octave cello doubling for pitch definition).
  contrabass(t, m, dur, vel = 0.8, o = {}) {
    const f = mtof(m); const end = t + dur + 0.16 * 2.6; if (!this.admit(t, end, 4, 0)) return;
    const sec = this.sect('bass'); const g = this.gain(); this.env(g.gain, t, (o.gain ?? 0.046) * vel * 1.15, { a: o.attack ?? 0.03, d: 0.5, s: 0.8, r: 0.16 }, dur);
    for (const d of [-6, 5]) this.osc('sawtooth', f, t, end, d).connect(g);
    const c = this.osc('sine', f, t, end); const cg = this.gain(0.6); c.connect(cg); cg.connect(g);
    const up = this.osc('sawtooth', f * 2, t, end, 3); const ug = this.gain(0.22); up.connect(ug); ug.connect(g);
    g.connect(sec.ins[1]);
  }
  pizz(t, m, vel = 0.8, o = {}) { this.smp(F.pizz(this.ac, Math.round(m)), t, (o.gain ?? 0.13) * vel * 2.0, 'pizz', { pan: o.pan, prio: o.prio ?? 1 }); }
  harp(t, m, vel = 0.8, o = {}) { const { buf, rate } = F.bank(F.harp, this.ac, Math.round(m)); this.smp(buf, t, (o.gain ?? 0.1) * vel * 2.1, 'harp', { pan: o.pan, prio: o.prio ?? 1, rate }); }
  // Brass section chord: all notes share one filter whose envelope does the brass "bloom" (fast for stabs,
  // a slow crescendo swell for long notes), plus an air rasp on the attack. Octave-down square under the root.
  brassChord(t, notes, dur, vel = 1, o = {}) {
    const name = o.sect || 'brass'; const rel = o.release ?? 0.09; const end = t + dur + rel * 2.6;
    if (!this.admit(t, end, notes.length * 2 + 1, o.prio ?? 1)) return;
    const sec = this.sect(name); const g = this.gain(); const lp = this.filt('lowpass', 500, 1.1);
    const swell = dur > 0.6; const top = 2200 + vel * 3800;
    if (swell) { lp.frequency.setValueAtTime(600, t); lp.frequency.linearRampToValueAtTime(top * 0.9, t + dur * 0.55); lp.frequency.setTargetAtTime(top * 0.6, t + dur * 0.6, dur * 0.3); }
    else { lp.frequency.setValueAtTime(450, t); lp.frequency.linearRampToValueAtTime(top, t + 0.04); lp.frequency.setTargetAtTime(1200 + vel * 1600, t + 0.045, 0.12); }
    const peak = (o.gain ?? 0.07) * vel * 1.25 / Math.sqrt(notes.length);
    if (swell) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak * 0.55, t + 0.06); g.gain.linearRampToValueAtTime(peak, t + dur * 0.6); g.gain.setTargetAtTime(0.0001, t + dur, rel / 3); }
    else this.env(g.gain, t, peak, { a: 0.014, d: 0.25, s: 0.72, r: rel }, dur);
    notes.forEach((m, k) => { const f = mtof(m); for (const d of [-7, 6]) this.osc('sawtooth', f, t, end, d + (Math.random() - 0.5) * 4).connect(lp); if (k === 0 && o.sub !== false) { const sq = this.osc('square', f / 2, t, end); const sg = this.gain(0.18); sq.connect(sg); sg.connect(lp); } });
    const n = this.noiseSrc(t, t + 0.08); const nb = this.filt('bandpass', 3000, 1.0); const ng = this.gain(0.02 * vel); ng.gain.setTargetAtTime(0.0001, t + 0.004, 0.016); n.connect(nb); nb.connect(ng);
    const [[i0, w0], [i1, w1]] = this.seats(sec, o.pan); const dst = w0 >= w1 ? i0 : i1; lp.connect(g); g.connect(dst); ng.connect(dst);
  }
  brass(t, m, dur, vel = 1, o = {}) { this.brassChord(t, [m], dur, vel, { sub: true, ...o, gain: (o.gain ?? 0.07) }); }
  // Lead horn / trumpet: filter bloom on the attack, a per-note vibrato LFO that fades in after the attack (the
  // LFO stops with the note: no leak), formant from the section peak. o.sect 'tpt' for the brighter trumpet.
  horn(t, m, dur, vel = 1, o = {}) {
    const f = mtof(m); const rel = o.release ?? 0.13; const end = t + dur + rel * 2.6; if (!this.admit(t, end, 5, 0)) return;
    const tpt = o.sect === 'tpt'; const sec = this.sect(tpt ? 'tpt' : 'horn'); const g = this.gain();
    const lp = this.filt('lowpass', 800, 0.9); const top = (tpt ? 3400 : 2000) + vel * (tpt ? 3000 : 2200);
    lp.frequency.setValueAtTime(top * 0.35, t); lp.frequency.linearRampToValueAtTime(top, t + 0.05 + (tpt ? 0 : 0.03)); lp.frequency.setTargetAtTime(top * 0.8, t + 0.1, 0.2);
    this.env(g.gain, t, (o.gain ?? 0.135) * vel * (tpt ? 0.8 : 1), { a: o.attack ?? (tpt ? 0.025 : 0.04), d: 0.3, s: 0.82, r: rel }, dur);
    const lfo = this.osc('sine', 5.1 + Math.random() * 0.5, t, end); const vg = this.gain(0); lfo.connect(vg);
    if (dur > 0.3) { vg.gain.setValueAtTime(0, t + 0.22); vg.gain.linearRampToValueAtTime(tpt ? 9 : 7, t + Math.min(dur, 0.6)); }
    const oscs = [this.osc('sawtooth', f, t, end, -4), this.osc('sawtooth', f, t, end, 4)];
    if (tpt) oscs.push(this.osc('square', f, t, end, 2)); else oscs.push(this.osc('triangle', f, t, end));
    oscs.forEach((x, i) => { vg.connect(x.detune); if (i === 2) { const cg = this.gain(tpt ? 0.35 : 0.8); x.connect(cg); cg.connect(lp); } else x.connect(lp); });
    lp.connect(g); const [[i0, w0], [i1, w1]] = this.seats(sec, o.pan); g.connect(w0 >= w1 ? i0 : i1);
  }
  timpani(t, m, vel = 1, o = {}) { this.smp(F.timpani(this.ac, Math.round(m), 0), t, (o.gain ?? 0.22) * vel * 2.3, 'timp', { pan: o.pan, prio: o.prio ?? 0 }); }
  bassDrum(t, vel = 1, o = {}) { this.smp(F.bassDrum(this.ac), t, (o.gain ?? 0.3) * vel, 'timp', { pan: o.pan, prio: 0 }); }
  snare(t, vel = 1, o = {}) { this.smp(F.snare(this.ac, this.rr++ % 4), t, (o.gain ?? 0.125) * vel * 2.2, 'snare', { pan: o.pan, prio: o.prio ?? 1 }); }
  crash(t, vel = 1, o = {}) { this.smp(F.crash(this.ac, this.rr++ % 2), t, (o.gain ?? 0.075) * vel * 4.5, 'cym', { pan: o.pan, prio: 1 }); }
  sizzle(t, vel = 1, o = {}) { this.smp(F.sizzle(this.ac, this.rr++ % 3), t, (o.gain ?? 0.03) * vel * 2.4, 'cym', { pan: o.pan, prio: 2 }); }
  // Cymbal swell (rolled suspended cymbal) into a downbeat: filtered noise crescendo.
  cymSwell(t, dur = 1.2, vel = 1, o = {}) {
    if (!this.admit(t, t + dur + 0.6, 2, 2)) return;
    const sec = this.sect('cym'); const n = this.noiseSrc(t, t + dur + 0.6); const hp = this.filt('bandpass', 7000, 0.5); const g = this.gain(); const peak = (o.gain ?? 0.055) * vel;
    hp.frequency.setValueAtTime(3500, t); hp.frequency.exponentialRampToValueAtTime(8500, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + dur); g.gain.setTargetAtTime(0.0001, t + dur, 0.12);
    n.connect(hp); hp.connect(g); g.connect(sec.ins[2]);
  }
  // Woodwind (round 8): one PeriodicWave oscillator with a vibrato LFO that fades in after the attack, plus a
  // breath: band-passed noise that "chiffs" on the tongued attack and then sits under the tone as air. 7 nodes.
  wind(t, m, dur, vel = 0.8, o = {}) {
    const kind = o.sect || 'flute'; const W = WIND[kind]; const f = mtof(m); const rel = o.release ?? 0.12;
    const end = t + dur + rel * 2.6; if (!this.admit(t, end, 3, o.prio ?? 0)) return;
    const sec = this.sect(kind); const peak = (o.gain ?? W.gain) * vel;
    let wave = this._waves[kind];
    if (!wave) { const re = new Float32Array(W.h.length + 1), im = new Float32Array(W.h.length + 1); W.h.forEach((a, i) => { im[i + 1] = a; }); wave = this._waves[kind] = this.ac.createPeriodicWave(re, im, { disableNormalization: false }); }
    this.nodes++; const x = new OscillatorNode(this.ac, { frequency: f }); x.setPeriodicWave(wave); x.start(t); x.stop(end);
    const g = this.gain(); this.env(g.gain, t, peak, { a: o.attack ?? W.a, d: 0.25, s: 0.88, r: rel }, dur);
    // expressive swell on long notes: a gentle messa di voce after the attack
    if (dur > 0.9) { g.gain.setTargetAtTime(peak * 1.06, t + (o.attack ?? W.a) + 0.05, dur * 0.3); g.gain.setTargetAtTime(peak * 0.9, t + dur * 0.6, dur * 0.2); g.gain.setTargetAtTime(0.0001, t + dur, rel / 3); }
    if (dur > 0.28 && W.vib > 0) {
      const lfo = this.osc('sine', W.vibRate + Math.random() * 0.4, t, end); const vg = this.gain(0); lfo.connect(vg); vg.connect(x.detune);
      vg.gain.setValueAtTime(0, t + 0.16); vg.gain.linearRampToValueAtTime(W.vib, t + Math.min(dur, 0.55));
    }
    x.connect(g);
    const [[i0, w0], [i1, w1]] = this.seats(sec, o.pan); const dst = w0 >= w1 ? i0 : i1; g.connect(dst);
    if (vel > 0.15) {
      const n = this.noiseSrc(t, end); const bp = this.filt('bandpass', Math.min(7000, f * (kind === 'flute' ? 2.2 : 3)), kind === 'flute' ? 1.1 : 2.2); const ng = this.gain();
      ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(peak * W.chiff, t + 0.012); ng.gain.setTargetAtTime(peak * W.breath, t + 0.02, 0.04); ng.gain.setTargetAtTime(0.0001, t + dur, rel / 3);
      n.connect(bp); bp.connect(ng); ng.connect(dst);
    }
  }
  glock(t, m, vel = 0.8, o = {}) { const { buf, rate } = F.bank(F.glock, this.ac, Math.round(m)); this.smp(buf, t, (o.gain ?? 0.06) * vel * 2, 'glock', { pan: o.pan, prio: o.prio ?? 1, rate }); }
  // ---- round 14 ----
  // Bell: v 0 tubular chime, o.great -> the cast great bell (v 1). Sampled (foundry.bell), banked every 3 semitones.
  bell(t, m, vel = 0.8, o = {}) { const { buf, rate } = F.bank(F.bell, this.ac, Math.round(m), o.great ? 1 : 0); this.smp(buf, t, (o.gain ?? 0.09) * vel * 2, 'bell', { pan: o.pan, prio: o.prio ?? 0, rate }); }
  celesta(t, m, vel = 0.8, o = {}) { const { buf, rate } = F.bank(F.celesta, this.ac, Math.round(m)); this.smp(buf, t, (o.gain ?? 0.07) * vel * 2, 'celesta', { pan: o.pan, prio: o.prio ?? 1, rate }); }
  // Pipe organ chord: per pipe one PeriodicWave oscillator (principal chorus) + a +7 cent celeste rank; the lowest note
  // also gets a 16' (octave-down) rank. Wind "chiff" on the attack; organ envelopes are flat (no decay), ~70 ms speech.
  organ(t, notes, dur, vel = 0.8, o = {}) {
    const rel = o.release ?? 0.35; const end = t + dur + rel * 2.6;
    if (!this.admit(t, end, notes.length * 2 + 1, o.prio ?? 1)) return;
    const sec = this.sect('organ'); let wave = this._waves.organ;
    if (!wave) { const re = new Float32Array(ORGAN.length + 1), im = new Float32Array(ORGAN.length + 1); ORGAN.forEach((a, i) => { im[i + 1] = a; }); wave = this._waves.organ = this.ac.createPeriodicWave(re, im); }
    const peak = (o.gain ?? 0.05) * vel / Math.sqrt(notes.length); const g = this.gain();
    this.env(g.gain, t, peak, { a: o.attack ?? 0.07, d: 0.2, s: 1, r: rel }, dur);
    const mk = (f, det, amp) => { this.nodes++; const x = new OscillatorNode(this.ac, { frequency: f, detune: det }); x.setPeriodicWave(wave); x.start(t); x.stop(end); if (amp === 1) x.connect(g); else { const a = this.gain(amp); x.connect(a); a.connect(g); } };
    notes.forEach((m, k) => { const f = mtof(m); mk(f, 0, 1); mk(f, 7, 0.55); if (k === 0 && o.pedal !== false) mk(f / 2, -2, 0.7); });
    const [[i0, w0], [i1, w1]] = this.seats(sec, o.pan); const dst = w0 >= w1 ? i0 : i1; g.connect(dst);
    if (vel > 0.2) { const n = this.noiseSrc(t, t + 0.12); const bp = this.filt('bandpass', Math.min(6000, mtof(notes[notes.length - 1]) * 4), 1.4); const ng = this.gain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(peak * 0.35, t + 0.015); ng.gain.setTargetAtTime(0.0001, t + 0.03, 0.025); n.connect(bp); bp.connect(ng); ng.connect(dst); }
  }
  // Choir "ah": three detuned saws per note into the choir section's shared formant bank.
  choir(t, m, dur, vel = 0.7, o = {}) {
    const f = mtof(m); const r = o.release ?? 0.6; const end = t + dur + r * 2.6; if (!this.admit(t, end, 3, o.prio ?? 1)) return;
    const sec = this.sect('choir'); const peak = (o.gain ?? 0.026) * vel * 0.75;
    const gs = [0, 1, 2].map(() => { const gg = this.gain(); this.env(gg.gain, t, peak, { a: o.attack ?? 0.4, d: 0.5, s: 0.9, r }, dur); return gg; });
    [-13, -1, 12].forEach((d, i) => { const x = this.osc('sawtooth', f, t, end, d + (Math.random() - 0.5) * 4); x.connect(gs[i]); gs[i].connect(sec.ins[i]); });
  }

  // ======================= sound effects (all on the sfx bus) =======================
  smpSfx(buf, t, gain, { rate = 1, pan = 0, lp = 0 } = {}) {
    if (!buf) return;
    this.nodes++; const s = new AudioBufferSourceNode(this.ac, { buffer: buf, playbackRate: rate }); const g = this.gain(gain); let n = s;
    if (lp) { const f = this.filt('lowpass', lp, 0.7); s.connect(f); n = f; }
    if (pan) { const p = this.pan(pan); n.connect(g); g.connect(p); p.connect(this.sfx); } else { n.connect(g); g.connect(this.sfx); }
    s.start(t);
  }
  blip(t, f = 2200, dur = 0.035, vel = 1, type = 'square') { const g = this.gain(); const lp = this.filt('lowpass', 6200); const o = this.osc(type, f, t, t + dur + 0.1); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.15 * vel, t + 0.003); g.gain.setTargetAtTime(0.0001, t + dur, 0.012); o.connect(lp); lp.connect(g); g.connect(this.sfx); }
  // Menu cursor: a short two-partial "tock" (glass-bead feel) — soft enough to be spammed by held arrows.
  cursor(t) { this.blip(t, 1975, 0.022, 0.62, 'triangle'); this.blip(t + 0.004, 3951, 0.012, 0.22, 'sine'); }
  tileCursor(t) { this.blip(t, 1480, 0.016, 0.38, 'triangle'); }
  // Confirm: rising perfect fifth + a bright bell partial.
  confirm(t) { this.blip(t, 1319, 0.04, 0.7, 'triangle'); this.blip(t + 0.055, 1976, 0.08, 0.85, 'triangle'); this.blip(t + 0.055, 3951, 0.05, 0.25, 'sine'); }
  cancel(t) { const g = this.gain(); const o = this.osc('triangle', 1100, t, t + 0.25); o.frequency.exponentialRampToValueAtTime(560, t + 0.11); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.14, t + 0.004); g.gain.setTargetAtTime(0.0001, t + 0.06, 0.03); o.connect(g); g.connect(this.sfx); }
  menuClose(t) { const n = this.noiseSrc(t, t + 0.2); const bp = this.filt('bandpass', 4200, 2.5); bp.frequency.exponentialRampToValueAtTime(800, t + 0.09); const g = this.gain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + 0.01); g.gain.setTargetAtTime(0.0001, t + 0.05, 0.03); n.connect(bp); bp.connect(g); g.connect(this.sfx); this.blip(t + 0.015, 1175, 0.03, 0.45, 'triangle'); }
  // "not allowed": two short low reedy buzzes, a flat second apart (unmistakable, not harsh).
  errorBuzz(t) { for (const [dt, f] of [[0, 233], [0.09, 220]]) { const o = this.osc('sawtooth', f, t + dt, t + dt + 0.2); const lp = this.filt('lowpass', 1400, 1.2); const g = this.gain(); g.gain.setValueAtTime(0.0001, t + dt); g.gain.linearRampToValueAtTime(0.12, t + dt + 0.005); g.gain.setTargetAtTime(0.0001, t + dt + 0.06, 0.015); o.connect(lp); lp.connect(g); g.connect(this.sfx); } }
  menuOpen(t) { const n = this.noiseSrc(t, t + 0.2); const bp = this.filt('bandpass', 900, 2.5); bp.frequency.exponentialRampToValueAtTime(4600, t + 0.09); const g = this.gain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.08, t + 0.01); g.gain.setTargetAtTime(0.0001, t + 0.05, 0.03); n.connect(bp); bp.connect(g); g.connect(this.sfx); this.blip(t + 0.02, 1568, 0.03, 0.4, 'triangle'); }
  // Turn ping: player units get a bright rising fourth, enemy units a lower, darker falling minor third.
  turnPing(t, enemy = false) {
    if (enemy) { this.blip(t, 988, 0.06, 0.5, 'sine'); this.blip(t + 0.09, 831, 0.1, 0.55, 'sine'); this.blip(t + 0.09, 1661, 0.05, 0.12, 'triangle'); }
    else { this.blip(t, 1175, 0.06, 0.55, 'sine'); this.blip(t + 0.09, 1568, 0.1, 0.62, 'sine'); this.blip(t + 0.09, 3136, 0.06, 0.2, 'sine'); }
  }
  footstep(t, terrain = 'g', vel = 1) {
    const r = 0.9 + Math.random() * 0.2;
    const p = { g: [850, 0.05, 0.42, 'lowpass'], k: [700, 0.05, 0.42, 'lowpass'], d: [520, 0.06, 0.56, 'lowpass'], s: [2600, 0.04, 0.46, 'bandpass'], r: [2200, 0.04, 0.46, 'bandpass'], b: [380, 0.09, 0.6, 'lowpass'], w: [1400, 0.16, 0.5, 'bandpass'] }[terrain] || [850, 0.05, 0.42, 'lowpass'];
    const n = this.noiseSrc(t, t + 0.4, r); const f = this.filt(p[3], p[0] * r, p[3] === 'bandpass' ? 1.4 : 0.8); const g = this.gain(); const peak = p[2] * vel;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.006); g.gain.setTargetAtTime(0.0001, t + 0.012, p[1] / 2.2); n.connect(f); f.connect(g); g.connect(this.sfx);
    const gr = this.noiseSrc(t, t + 0.08, r); const gh = this.filt('highpass', terrain === 's' || terrain === 'r' ? 5000 : 3000); const gg = this.gain(); this._pulse(gg, t, peak * (terrain === 'b' ? 0.12 : 0.25), 0.014, 0.001); gr.connect(gh); gh.connect(gg); gg.connect(this.sfx);
    if (terrain === 'b') { const o = this.osc('sine', 140 * r, t, t + 0.3); const og = this.gain(); og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.16 * vel, t + 0.004); og.gain.setTargetAtTime(0.0001, t + 0.005, 0.035); o.connect(og); og.connect(this.sfx); }
    if (terrain === 's' || terrain === 'r') { const o = this.osc('square', 3400 * r, t, t + 0.05); const og = this.gain(); og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.045 * vel, t + 0.002); og.gain.setTargetAtTime(0.0001, t + 0.003, 0.006); o.connect(og); og.connect(this.sfx); }
  }
  // Every one-shot below starts its envelope from ~0 with a ramp (no clicks) — rules for this whole section.
  _pulse(g, t, peak, tau, a = 0.002) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(0.0001, t + a, tau); }
  thud(t, vel = 1, f0 = 190, f1 = 70, tau = 0.09) { const o = this.osc('sine', f0, t, t + 0.6); o.frequency.exponentialRampToValueAtTime(f1, t + 0.06); const g = this.gain(); this._pulse(g, t, 0.45 * vel, tau); o.connect(g); g.connect(this.sfx); const n = this.noiseSrc(t, t + 0.3); const lp = this.filt('lowpass', 520); const ng = this.gain(); this._pulse(ng, t, 0.32 * vel, 0.028); n.connect(lp); lp.connect(ng); ng.connect(this.sfx); }
  whoosh(t, f0 = 5500, f1 = 1200, dur = 0.09, vel = 1) { const n = this.noiseSrc(t, t + dur + 0.3); const bp = this.filt('bandpass', f0, 1.2); bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur); const g = this.gain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.3 * vel, t + dur * 0.35); g.gain.setTargetAtTime(0.0001, t + dur * 0.7, dur * 0.3); n.connect(bp); bp.connect(g); g.connect(this.sfx); }
  // Blade: whoosh, then a metallic ring (4 inharmonic partials) and flesh thud on contact.
  slash(t, vel = 1) { this.whoosh(t, 6500, 1300, 0.1, vel); const at = t + 0.07; for (const [f, g0, tau] of [[2150, 0.1, 0.1], [3390, 0.08, 0.08], [5230, 0.06, 0.06], [7900, 0.035, 0.04]]) { const o = this.osc('sine', f * (0.97 + Math.random() * 0.06), at, at + 0.7); const g = this.gain(); this._pulse(g, at, g0 * vel, tau, 0.003); const p = this.pan((Math.random() - 0.5) * 0.5); o.connect(g); g.connect(p); p.connect(this.sfx); } this.thud(at, 0.5 * vel, 150, 60, 0.05); }
  blunt(t, vel = 1) { this.thud(t, vel, 220, 55, 0.13); this.whoosh(Math.max(this.now(), t - 0.05), 900, 300, 0.07, 0.6 * vel); const n = this.noiseSrc(t, t + 0.09); const bp = this.filt('bandpass', 1800, 0.9); const g = this.gain(); this._pulse(g, t, 0.16 * vel, 0.02); n.connect(bp); bp.connect(g); g.connect(this.sfx); }
  arrowFly(t, vel = 1) { const n = this.noiseSrc(t, t + 0.5); const bp = this.filt('bandpass', 900, 6); bp.frequency.setValueAtTime(900, t); bp.frequency.exponentialRampToValueAtTime(4800, t + 0.22); const g = this.gain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.2 * vel, t + 0.05); g.gain.setTargetAtTime(0.0001, t + 0.2, 0.03); const p = this.pan(-0.35); n.connect(bp); bp.connect(g); g.connect(p); p.connect(this.sfx); }
  arrowHit(t, vel = 1) { this.thud(t, 0.7 * vel, 300, 90, 0.05); const o = this.osc('sawtooth', 1200, t, t + 0.3); o.frequency.exponentialRampToValueAtTime(400, t + 0.12); const bp = this.filt('bandpass', 1400, 4); const g = this.gain(); this._pulse(g, t, 0.08 * vel, 0.05); o.connect(bp); bp.connect(g); g.connect(this.sfx); const n = this.noiseSrc(t, t + 0.06); const hp = this.filt('highpass', 4000); const ng = this.gain(); this._pulse(ng, t, 0.12 * vel, 0.012); n.connect(hp); hp.connect(ng); ng.connect(this.sfx); }
  // Fire: ignition whoosh -> roaring mid body -> sub bloom, then a sampled crackle bed (was 26 per-grain graphs).
  fire(t, vel = 1) {
    this.whoosh(t, 320, 3000, 0.28, 0.9 * vel);
    const n = this.noiseSrc(t, t + 1.6); const lp = this.filt('lowpass', 280, 1.4); const g = this.gain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.42 * vel, t + 0.12); g.gain.setTargetAtTime(0.0001, t + 0.35, 0.26); n.connect(lp); lp.connect(g); g.connect(this.sfx);
    const s = this.osc('sine', 62, t, t + 1.2); s.frequency.exponentialRampToValueAtTime(38, t + 0.9); const sg = this.gain(); sg.gain.setValueAtTime(0.0001, t); sg.gain.linearRampToValueAtTime(0.28 * vel, t + 0.06); sg.gain.setTargetAtTime(0.0001, t + 0.3, 0.22); s.connect(sg); sg.connect(this.sfx);
    const r = this.noiseSrc(t, t + 1.2); const rb = this.filt('bandpass', 700, 0.7); rb.frequency.setValueAtTime(1400, t); rb.frequency.exponentialRampToValueAtTime(320, t + 0.9); const rg = this.gain(); rg.gain.setValueAtTime(0.0001, t); rg.gain.linearRampToValueAtTime(0.26 * vel, t + 0.08); rg.gain.setTargetAtTime(0.0001, t + 0.28, 0.24); r.connect(rb); rb.connect(rg); rg.connect(this.sfx);
    this.smpSfx(F.crackle(this.ac, 0), t + 0.08, 0.2 * vel, { pan: -0.25 }); this.smpSfx(F.crackle(this.ac, 1), t + 0.12, 0.17 * vel, { pan: 0.3, rate: 1.1 });
  }
  ice(t, vel = 1) {
    for (let i = 0; i < 6; i++) { const at = t + i * 0.045; const f = [2350, 3520, 4700, 5880, 7050, 8230][i] * (0.995 + Math.random() * 0.01); const o = this.osc('sine', f, at, at + 1.2); const g = this.gain(); g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.085 * vel, at + 0.01); g.gain.setTargetAtTime(0.0001, at + 0.02, 0.22); const p = this.pan((i % 2 ? 1 : -1) * 0.45); o.connect(g); g.connect(p); p.connect(this.sfx); }
    const n = this.noiseSrc(t, t + 1.2); const hp = this.filt('highpass', 7000); const g = this.gain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12 * vel, t + 0.3); g.gain.setTargetAtTime(0.0001, t + 0.4, 0.15); n.connect(hp); hp.connect(g); g.connect(this.sfx);
    const sh = t + 0.5; const b = this.noiseSrc(sh, sh + 0.4); const bh = this.filt('highpass', 3200); const bg = this.gain(); this._pulse(bg, sh, 0.3 * vel, 0.04, 0.003); b.connect(bh); bh.connect(bg); bg.connect(this.sfx);
    this.smpSfx(F.shards(this.ac), sh + 0.02, 0.14 * vel, { pan: 0.2 }); this.smpSfx(F.shards(this.ac), sh + 0.06, 0.1 * vel, { pan: -0.3, rate: 1.19 });
    this.thud(sh, 0.35 * vel, 160, 70, 0.06);
  }
  bolt(t, vel = 1) {
    const c = this.noiseSrc(t, t + 0.1); const ch = this.filt('highpass', 2500); const cg = this.gain(); this._pulse(cg, t, 0.55 * vel, 0.01, 0.001); c.connect(ch); ch.connect(cg); cg.connect(this.sfx);
    for (const [f, g0] of [[58, 0.26], [87, 0.17]]) { const o = this.osc('sawtooth', f, t, t + 0.6); const bp = this.filt('bandpass', 900, 1.5); const g = this.gain(); this._pulse(g, t, g0 * vel, 0.09, 0.004); o.connect(bp); bp.connect(g); g.connect(this.sfx); }
    const n = this.noiseSrc(t + 0.03, t + 1.4); const lp = this.filt('lowpass', 190, 1); const g = this.gain(); g.gain.setValueAtTime(0.0001, t + 0.03); g.gain.linearRampToValueAtTime(0.42 * vel, t + 0.07); g.gain.setTargetAtTime(0.0001, t + 0.15, 0.24); n.connect(lp); lp.connect(g); g.connect(this.sfx);
    for (let i = 0; i < 3; i++) { const at = t + i * 0.018; const k = this.noiseSrc(at, at + 0.09); const kb = this.filt('bandpass', 3800 + i * 2200, 1.1); const kg = this.gain(); this._pulse(kg, at, (0.34 - i * 0.09) * vel, 0.014, 0.001); const p = this.pan((i - 1) * 0.4); k.connect(kb); kb.connect(kg); kg.connect(p); p.connect(this.sfx); }
    const s = this.osc('sine', 54, t + 0.03, t + 1); const sg = this.gain(); this._pulse(sg, t + 0.03, 0.24 * vel, 0.18, 0.01); s.connect(sg); sg.connect(this.sfx);
  }
  // Cure: a rising major-9 bell arpeggio with sparkle air.
  cure(t, vel = 1) {
    [72, 76, 79, 84, 88, 91].forEach((m, i) => { const at = t + i * 0.07; const o = this.osc('sine', mtof(m), at, at + 1.6); const o2 = this.osc('triangle', mtof(m + 12), at, at + 1.6); const g = this.gain(); g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.1 * vel, at + 0.01); g.gain.setTargetAtTime(0.0001, at + 0.05, 0.35); const g2 = this.gain(0.3); o2.connect(g2); g2.connect(g); o.connect(g); const p = this.pan(-0.45 + i * 0.18); g.connect(p); p.connect(this.sfx); });
    const n = this.noiseSrc(t, t + 1.5); const bp = this.filt('bandpass', 6500, 2); const g = this.gain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 * vel, t + 0.4); g.gain.setTargetAtTime(0.0001, t + 0.5, 0.3); n.connect(bp); bp.connect(g); g.connect(this.sfx);
  }
  // Small regen / drain heal tick: two soft bell notes (quieter than Cure so it is information, not an event).
  healTick(t, vel = 1) { [84, 91].forEach((m, i) => { const at = t + i * 0.06; const o = this.osc('sine', mtof(m), at, at + 0.9); const g = this.gain(); g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.06 * vel, at + 0.008); g.gain.setTargetAtTime(0.0001, at + 0.03, 0.18); o.connect(g); g.connect(this.sfx); }); }
  holy(t, vel = 1) {
    const sw = this.noiseSrc(t, t + 1.6); const bp = this.filt('bandpass', 3000, 0.8); bp.frequency.setValueAtTime(1200, t); bp.frequency.exponentialRampToValueAtTime(7000, t + 0.55); const sg = this.gain(); sg.gain.setValueAtTime(0.0001, t); sg.gain.linearRampToValueAtTime(0.16 * vel, t + 0.5); sg.gain.setTargetAtTime(0.0001, t + 0.56, 0.28); sw.connect(bp); bp.connect(sg); sg.connect(this.sfx);
    [69, 76, 81, 88, 93].forEach((m, i) => { const at = t + 0.5 + i * 0.02; const f = mtof(m); for (const [r, gg, tau] of [[1, 0.09, 0.9], [2.76, 0.035, 0.45], [5.4, 0.018, 0.25]]) { const o = this.osc('sine', f * r, at, at + 2.6); const g = this.gain(); this._pulse(g, at, gg * vel, tau, 0.004); const p = this.pan((i - 2) * 0.28); o.connect(g); g.connect(p); p.connect(this.sfx); } });
    this.thud(t + 0.5, 0.5 * vel, 140, 55, 0.14);
  }
  quake(t, vel = 1) {
    const n = this.noiseSrc(t, t + 1.8); const lp = this.filt('lowpass', 120, 1.2); const g = this.gain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5 * vel, t + 0.22); g.gain.setTargetAtTime(0.0001, t + 0.55, 0.35); n.connect(lp); lp.connect(g); g.connect(this.sfx);
    const s = this.osc('sine', 46, t, t + 1.6); s.frequency.exponentialRampToValueAtTime(28, t + 1.2); const sg = this.gain(); sg.gain.setValueAtTime(0.0001, t); sg.gain.linearRampToValueAtTime(0.3 * vel, t + 0.15); sg.gain.setTargetAtTime(0.0001, t + 0.5, 0.3); s.connect(sg); sg.connect(this.sfx);
    this.smpSfx(F.debris(this.ac), t + 0.1, 0.28 * vel, { pan: -0.2 }); this.smpSfx(F.debris(this.ac), t + 0.25, 0.2 * vel, { pan: 0.35, rate: 0.85 });
  }
  buff(t, vel = 1) {
    const o = this.osc('sine', 660, t, t + 0.6); o.frequency.exponentialRampToValueAtTime(1980, t + 0.3); const g = this.gain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.11 * vel, t + 0.05); g.gain.setTargetAtTime(0.0001, t + 0.3, 0.08); o.connect(g); g.connect(this.sfx);
    [1568, 2093, 2637, 3136].forEach((f, i) => { const at = t + 0.28 + i * 0.06; const b = this.osc('sine', f, at, at + 1); const bg = this.gain(); bg.gain.setValueAtTime(0.0001, at); bg.gain.linearRampToValueAtTime(0.075 * vel, at + 0.005); bg.gain.setTargetAtTime(0.0001, at + 0.02, 0.25); const p = this.pan(-0.3 + i * 0.2); b.connect(bg); bg.connect(p); p.connect(this.sfx); });
  }
  debuff(t, vel = 1) {
    const o = this.osc('triangle', 1400, t, t + 0.8); o.frequency.exponentialRampToValueAtTime(220, t + 0.5); const g = this.gain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.13 * vel, t + 0.04); g.gain.setTargetAtTime(0.0001, t + 0.45, 0.08); o.connect(g); g.connect(this.sfx);
    const w = this.osc('sawtooth', 110, t, t + 0.9); const wg = this.gain(); wg.gain.setValueAtTime(0.0001, t); wg.gain.linearRampToValueAtTime(0.09 * vel, t + 0.03); const lfo = this.osc('sine', 9, t, t + 0.9); const lg = this.gain(50); lfo.connect(lg); lg.connect(w.detune); const lp = this.filt('lowpass', 600); wg.gain.setTargetAtTime(0.0001, t + 0.4, 0.1); w.connect(lp); lp.connect(wg); wg.connect(this.sfx);
  }
  chargeStart(t, vel = 1) { for (let i = 0; i < 5; i++) { const at = t + i * 0.05; const o = this.osc('sine', 880 * (1 + i * 0.25), at, at + 0.5); o.frequency.exponentialRampToValueAtTime(880 * (1 + i * 0.25) * 1.5, at + 0.2); const g = this.gain(); g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.055 * vel, at + 0.01); g.gain.setTargetAtTime(0.0001, at + 0.05, 0.12); const p = this.pan((i - 2) * 0.18); o.connect(g); g.connect(p); p.connect(this.sfx); } }
  miss(t, vel = 1) { this.whoosh(t, 3600, 900, 0.16, 0.5 * vel); const o = this.osc('triangle', 900, t + 0.05, t + 0.4); o.frequency.exponentialRampToValueAtTime(500, t + 0.25); const g = this.gain(); this._pulse(g, t + 0.05, 0.055 * vel, 0.05, 0.01); o.connect(g); g.connect(this.sfx); }
  parry(t, vel = 1) { for (const [f, g0, tau] of [[1850, 0.13, 0.13], [2780, 0.1, 0.11], [4420, 0.07, 0.09], [6100, 0.05, 0.07], [8400, 0.03, 0.05]]) { const o = this.osc('sine', f * (0.98 + Math.random() * 0.04), t, t + 0.9); const g = this.gain(); this._pulse(g, t, g0 * vel, tau, 0.001); const p = this.pan((Math.random() - 0.5) * 0.6); o.connect(g); g.connect(p); p.connect(this.sfx); } const n = this.noiseSrc(t, t + 0.1); const hp = this.filt('highpass', 3000); const ng = this.gain(); this._pulse(ng, t, 0.24 * vel, 0.012, 0.001); n.connect(hp); hp.connect(ng); ng.connect(this.sfx); }
  crystal(t, vel = 1) { [84, 88, 91, 96, 100, 103, 108].forEach((m, i) => { const at = t + i * 0.09; const o = this.osc('sine', mtof(m), at, at + 2.5); const o2 = this.osc('sine', mtof(m) * 2.76, at, at + 1); const g = this.gain(); g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.085 * vel, at + 0.006); g.gain.setTargetAtTime(0.0001, at + 0.03, 0.6); const g2 = this.gain(); this._pulse(g2, at, 0.2, 0.1, 0.004); o2.connect(g2); g2.connect(g); o.connect(g); const p = this.pan(Math.sin(i * 1.7) * 0.55); g.connect(p); p.connect(this.sfx); }); const n = this.noiseSrc(t, t + 2); const bp = this.filt('bandpass', 9000, 3); const g = this.gain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.04 * vel, t + 0.5); g.gain.setTargetAtTime(0.0001, t + 0.7, 0.4); n.connect(bp); bp.connect(g); g.connect(this.sfx); }
  raise(t, vel = 1) { const o = this.osc('sine', 330, t, t + 1.4); o.frequency.exponentialRampToValueAtTime(2640, t + 0.9); const g = this.gain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09 * vel, t + 0.1); g.gain.setTargetAtTime(0.0001, t + 0.85, 0.15); o.connect(g); g.connect(this.sfx); [62, 66, 69, 74].forEach((m, i) => { const at = t + 0.7 + i * 0.05; const a = this.osc('triangle', mtof(m + 12), at, at + 2); const ag = this.gain(); ag.gain.setValueAtTime(0.0001, at); ag.gain.linearRampToValueAtTime(0.065 * vel, at + 0.05); ag.gain.setTargetAtTime(0.0001, at + 0.3, 0.4); const p = this.pan((i - 1.5) * 0.3); a.connect(ag); ag.connect(p); p.connect(this.sfx); }); this.cure(t + 0.75, 0.6 * vel); }
  statusTick(t, good = true, vel = 1) { const f = good ? [1175, 1760] : [1175, 784]; this.blip(t, f[0], 0.05, 0.5 * vel, 'triangle'); this.blip(t + 0.08, f[1], 0.09, 0.55 * vel, 'triangle'); }
  statusEnd(t, vel = 1) { this.blip(t, 1568, 0.03, 0.3 * vel, 'triangle'); this.blip(t + 0.05, 1175, 0.05, 0.25 * vel, 'triangle'); }
  // Damage hit: body thump + crunch, both scaled by how much of the victim's HP it took; a heavy hit (>= 0.5)
  // adds a low boom and a short bright ring so a big number FEELS big.
  hit(t, vel = 1) {
    const v = clamp(vel, 0.2, 1.3);
    this.thud(t, 0.45 * v, 170, 60, 0.05 + 0.04 * v);
    const n = this.noiseSrc(t, t + 0.12); const bp = this.filt('bandpass', 1300 + 800 * v, 0.9); const g = this.gain(); this._pulse(g, t, 0.13 * v, 0.018 + 0.01 * v, 0.001); n.connect(bp); bp.connect(g); g.connect(this.sfx);
    if (v >= 0.75) { const o = this.osc('sine', 90, t, t + 0.6); o.frequency.exponentialRampToValueAtTime(42, t + 0.25); const og = this.gain(); this._pulse(og, t, 0.3 * v, 0.12, 0.004); o.connect(og); og.connect(this.sfx);
      const r = this.osc('triangle', 2637, t + 0.01, t + 0.5); const rg = this.gain(); this._pulse(rg, t + 0.01, 0.035 * v, 0.07, 0.002); r.connect(rg); rg.connect(this.sfx); }
  }
  ko(t, vel = 1) { const o = this.osc('triangle', 520, t, t + 0.9); o.frequency.exponentialRampToValueAtTime(95, t + 0.55); const g = this.gain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18 * vel, t + 0.03); g.gain.setTargetAtTime(0.0001, t + 0.5, 0.06); o.connect(g); g.connect(this.sfx); this.thud(t + 0.58, 0.9 * vel, 130, 45, 0.15); const n = this.noiseSrc(t + 0.58, t + 0.85); const lp = this.filt('bandpass', 900, 0.8); const ng = this.gain(); this._pulse(ng, t + 0.58, 0.14 * vel, 0.05); n.connect(lp); lp.connect(ng); ng.connect(this.sfx); }
}
