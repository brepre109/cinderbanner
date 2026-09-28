// Deterministic headless capture: vite build → static serve → presets/scenarios → PNGs.
// usage: node tools/shot.mjs <outDir> [presets=wide,mid,close,high,rot1] [scenario=] [w=1100] [h=620]
//        [page=/index.html] [ready=<window expr>] [outname=<prefix>] [mode=ai] [dist=] [nobuild=1] [keep=1]
// page/ready/outname exist so the SECOND entry point (/editor.html) is captured by this same
// harness: the static server already serves any file in dist, the editor publishes a
// __GAME__-shaped handle so the preset loop is unchanged, and outname keeps an editor run from
// overwriting a game run's wide.png in a shared out dir. All three default to today's behaviour.
import { launchBrowser } from './browser.mjs';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http'; import path from 'node:path';
// Split on the FIRST '=' only: identical for every existing arg (none has '=' in its value) and
// it is what lets ready= carry a real expression, e.g. ready=window.__EDITOR__.ready===true.
// A bare flag still maps to undefined (falsy), exactly as `'nobuild'.split('=')` did.
const args = Object.fromEntries(process.argv.slice(3).map((a) => { const i = a.indexOf('='); return i < 0 ? [a, undefined] : [a.slice(0, i), a.slice(i + 1)]; }));
const OUT = process.argv[2] || 'shots/latest'; const PRESETS = (args.presets || 'wide,mid,close,high,rot1').split(','); const SCEN = args.scenario || ''; const W = +(args.w || 1100), H = +(args.h || 620);
const DIST = args.dist || `.cache/dist-${process.pid}`;
const PAGE = args.page ? (args.page.startsWith('/') ? args.page : '/' + args.page) : '/';
const READY = args.ready
  ? (args.ready.includes('.') || args.ready.includes('(') ? args.ready : `window.${args.ready} && window.${args.ready}.ready === true`)
  : 'window.__GAME__ && window.__GAME__.ready === true';
// Filename prefix. Default '' keeps today's `${SCEN}_${preset}.png`; outname=editor gives
// `editor_wide.png` next to it. A trailing '_' the caller already typed is not doubled.
const NAME = args.outname ? (args.outname.endsWith('_') ? args.outname : args.outname + '_') : '';
mkdirSync(OUT, { recursive: true });
if (!args.nobuild) execSync(`npx vite build --outDir ${DIST} --logLevel error`, { stdio: 'inherit' });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(DIST, p); if (existsSync(f) && statSync(f).isFile()) { s.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream'); s.end(readFileSync(f)); } else { s.statusCode = 404; s.end(); } }).listen(0);
const port = srv.address().port;
const browser = await launchBrowser({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--hide-scrollbars', `--window-size=${W},${H}`] });
try {
  const page = await browser.newPage(); page.setDefaultTimeout(120000); await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (e) => errors.push('PAGEERROR ' + e)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}${PAGE}${PAGE.includes('?') ? '&' : '?'}mode=${args.mode || 'ai'}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(READY);
  await new Promise((r) => setTimeout(r, 1200));
  if (SCEN) { await page.evaluate(async (s) => { await window.__GAME__.scenario(s); }, SCEN); await new Promise((r) => setTimeout(r, 150)); }
  for (const p of PRESETS) {
    // presets=none: one plain screenshot with no camera call, for a page that has no __GAME__
    // camera handle to drive (a boot-failure card, a pure-DOM smoke of /editor.html).
    if (p !== 'none') await page.evaluate((n) => { window.__GAME__.applyPreset(n); }, p);
    await new Promise((r) => setTimeout(r, SCEN ? 60 : 400));
    // Freeze, then force one explicit render: while frozen frame() does not draw, so without
    // this the screenshot returns the stale pre-freeze frame (CRITIQUE_R2 integration bug 3).
    if (SCEN) await page.evaluate(() => { window.__GAME__.freeze(true); window.__GAME__.render?.(); });
    const png = `${OUT}/${NAME}${SCEN ? SCEN + '_' : ''}${p === 'none' ? 'shot' : p}.png`;
    await page.screenshot({ path: png }); console.log('captured', png);
    if (SCEN) await page.evaluate(() => window.__GAME__.freeze(false));
  }
  if (errors.length) console.log('PAGE ERRORS:\n' + errors.slice(0, 20).join('\n'));
} finally { await browser.close(); srv.close(); if (!args.keep) execSync(`rm -rf ${DIST}`); }
