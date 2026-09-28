// Campaign shell entry (src/main.js routes here for a bare URL or ?screen=). Pure DOM: title -> world map -> story ->
// formation -> [battle page] -> results -> story outro -> world map. Screens swap in place; only a battle is a page
// load (see battlelink.js). ?screen=<title|map|results|formation> is kept in the URL so a reload lands where you were.
import '../campaign/kit.css';
import './shell.css';
import { loadSave } from './save.js';
import { NODE } from './data.js';
import { loadProgression } from './progress.js';
import { h, clearKeys, fadeIn, fadeOut, blockKeys, audio, setScene } from './kit.js';

for (const id of ['gl', 'ui']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
const root = h('div', null); root.id = 'shell'; document.body.appendChild(root);

let cleanup = null; let current = null;
/** Swap to a screen module: fade out, tear the old one down, build the new one, fade in. */
export async function go(name, arg, { fade = true, url = true } = {}) {
  blockKeys(true);
  if (fade) await fadeOut(260);
  try { cleanup?.(); } catch (e) { console.warn('screen cleanup', e); }
  cleanup = null; clearKeys(); root.innerHTML = '';
  // QA #14: Formation opened for a battle keeps its destination in the URL (&node=), so a reload lands on the same sortie.
  const nodeQ = name === 'formation' && arg?.battle ? `&node=${encodeURIComponent(arg.battle)}` : '';
  if (url) { try { history.replaceState(null, '', location.pathname + (name === 'title' ? '' : `?screen=${name === 'story' ? 'map' : name}${nodeQ}`)); } catch { /* sandboxed */ } }
  // QA r12: a screen chunk that fails to load (a redeploy replaced the hashed file under an open tab) used to leave
  // the shell blank with every key blocked. Reload once into the same screen (the URL already names it) instead.
  let mod; try { mod = await SCREENS[name](); } catch (e) {
    console.warn('screen module failed to load; reloading', name, e);
    if (!sessionStorage.getItem('cinderbanner.reloaded')) { try { sessionStorage.setItem('cinderbanner.reloaded', '1'); } catch { /* ignore */ } location.reload(); return; }
    throw e;
  }
  try { sessionStorage.removeItem('cinderbanner.reloaded'); } catch { /* ignore */ }
  const scr = h('div', `k-screen s-${name}`); root.appendChild(scr);
  // show() may keep animating (story card, results tally) long after the screen is up, so the fade-in runs
  // alongside it rather than after it; the cleanup it resolves to is picked up whenever it arrives.
  const token = {}; current = token;
  const shown = Promise.resolve(mod.show(scr, arg, { go })).then((c) => { if (current === token) cleanup = c || null; else c?.(); }).catch((e) => console.error('screen', name, e));
  window.__SHELL__.screen = name;
  // QA r12: keys stay blocked through the fade-in. Mashing Enter through the last line of a story scene used to land one
  // press on the NEW screen as it faded up (Formation opened with the captain's command window already open, and the
  // R9 walk script's Formation steps then withdrew him from the party).
  if (fade) await fadeIn(360);
  blockKeys(false);
  await shown;
}
const SCREENS = {
  title: () => import('./screens/title.js'),
  map: () => import('./screens/worldmap.js'),
  story: () => import('./screens/story.js'),
  formation: () => import('./screens/formation.js'),
  results: () => import('./screens/results.js'),
  shop: () => import('./screens/shop.js'),
};

window.__SHELL__ = { screen: null, go, ready: false };
await loadProgression();
audio(); // start the fetch; setScene fires per screen
const q = new URLSearchParams(location.search); let want = q.get('screen') || 'title';
if (!SCREENS[want] || want === 'story') want = 'title';
const sv = loadSave();
if (want !== 'title' && !sv) want = 'title';
if (want === 'results' && (!sv.last || sv.last.outcome === 'retreat')) want = 'map';
const node = q.get('node'); const bootArg = want === 'formation' && node && NODE[node] ? { battle: node } : null;
await go(want, bootArg, { fade: true, url: false });
window.__SHELL__.ready = true;
export { setScene };
