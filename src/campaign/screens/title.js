// Title screen: painted dusk backdrop with a slow push-in and rising embers, the logo, and New Game / Continue / Options.
import titleImg from '../assets/title.jpg';
import { h, win, menu, dialog, sfx, setScene, esc } from '../kit.js';
import { loadSave, eraseSave } from '../save.js';
import { newGame } from '../campaign.js';
import { BATTLES, CHAPTER } from '../data.js';
import { openOptions } from '../options.js';

export async function show(el, _arg, { go }) {
  setScene('title');
  el.innerHTML = `<div class="t-bg" style="background-image:url(${titleImg})"></div><canvas class="t-embers"></canvas><div class="t-shade"></div>
    <div class="t-logo"><div class="t-of">A Tale of the Southmarch</div><div class="t-name"><span class="b">Cinderbanner</span><span class="f">Cinderbanner</span></div>
    <div class="t-rule"><i></i><b></b><i></i></div><div class="t-sub">Chapter ${CHAPTER.roman} &middot; ${esc(CHAPTER.name)}</div></div>
    <div class="k-hint t-hint"><kbd>&uarr;</kbd><kbd>&darr;</kbd>Select<kbd>Enter</kbd>Confirm</div>`;
  const stopEmbers = embers(el.querySelector('.t-embers'));
  const sv = loadSave();
  const w = win(null, 't-menu'); el.appendChild(w);
  let m = null;
  const build = () => {
    m?.destroy(); const save = loadSave();
    const done = save ? BATTLES.filter((b) => b.kind === 'story' && save.cleared[b.id]).length : 0;
    const story = BATTLES.filter((b) => b.kind === 'story').length;
    m = menu(w.querySelector('.k-body'), [
      { id: 'continue', label: 'Continue', enabled: !!save, right: save ? `${done}/${story}` : '' },
      { id: 'new', label: 'New Game' },
      { id: 'options', label: 'Options' },
    ], { sel: save ? 0 : 1, onPick: pick });
  };
  const pick = async (it) => {
    if (it.id === 'continue') { m.release(); return go('map'); }
    if (it.id === 'new') {
      if (loadSave()) {
        m.release();
        const r = await dialog('New Game', 'Begin a new chronicle? The current save will be overwritten.', [{ id: 'yes', label: 'Begin anew' }, { id: 'no', label: 'Cancel' }], { sel: 1 });
        if (r !== 'yes') return build();
      }
      eraseSave(); const s = newGame(); m.release();
      const first = BATTLES[0];
      return go('story', { battle: first.id, lines: first.intro, then: 'formation', prologue: true, save: s });
    }
    if (it.id === 'options') { m.release(); await openOptions(); build(); }
  };
  build();
  void sv;
  return () => { stopEmbers(); m?.destroy(); };
}

// Drifting ember motes over the backdrop: cheap additive dots on a 2D canvas, half-res.
function embers(cv) {
  const g = cv.getContext('2d'); let W = 0, H = 0, raf = 0, last = performance.now();
  const fit = () => { W = cv.width = Math.ceil(innerWidth / 2); H = cv.height = Math.ceil(innerHeight / 2); };
  fit(); addEventListener('resize', fit);
  const P = Array.from({ length: 70 }, () => spawn(true));
  function spawn(any) { return { x: Math.random(), y: any ? Math.random() : 1.05, v: 0.012 + Math.random() * 0.03, s: 0.5 + Math.random() * 1.6, ph: Math.random() * 6.28, w: 0.3 + Math.random() * 0.8, life: 0.4 + Math.random() * 0.6 }; }
  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; g.clearRect(0, 0, W, H); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < P.length; i++) {
      const p = P[i]; p.y -= p.v * dt; p.ph += dt * p.w * 2; p.x += Math.sin(p.ph) * 0.0006;
      if (p.y < -0.05) P[i] = spawn(false);
      const a = Math.max(0, Math.min(1, (1 - p.y) * 1.4)) * p.life * (0.6 + 0.4 * Math.sin(p.ph * 3));
      const x = p.x * W, y = p.y * H, r = p.s * 2.2;
      const grd = g.createRadialGradient(x, y, 0, x, y, r * 2.4); grd.addColorStop(0, `rgba(255,200,120,${a})`); grd.addColorStop(0.35, `rgba(255,120,40,${a * 0.55})`); grd.addColorStop(1, 'rgba(255,80,20,0)');
      g.fillStyle = grd; g.fillRect(x - r * 2.4, y - r * 2.4, r * 4.8, r * 4.8);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(raf); removeEventListener('resize', fit); };
}
