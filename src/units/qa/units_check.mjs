// Units QA: facing/mirror assertions from the camera's real matrices + deterministic close-up captures.
// usage: node src/units/qa/units_check.mjs <outDir> [w=1100 h=620] [nobuild=1 dist=path]
import { launchBrowser } from '../../../tools/browser.mjs';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http'; import path from 'node:path';
const args = Object.fromEntries(process.argv.slice(3).map((a) => a.split('=')));
const OUT = process.argv[2] || 'shots/units/qa'; const W = +(args.w || 1100), H = +(args.h || 620);
const DIST = args.dist || `.cache/dist-units-${process.pid}`;
mkdirSync(OUT, { recursive: true });
if (!args.nobuild) execSync(`npx vite build --outDir ${DIST} --logLevel error`, { stdio: 'inherit' });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(DIST, p); if (existsSync(f) && statSync(f).isFile()) { s.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream'); s.end(readFileSync(f)); } else { s.statusCode = 404; s.end(); } }).listen(0);
const port = srv.address().port;
const browser = await launchBrowser({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--hide-scrollbars', `--window-size=${W},${H}`] });
let failures = 0;
try {
  const page = await browser.newPage(); page.setDefaultTimeout(120000); await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (e) => errors.push('PAGEERROR ' + e)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', (r) => errors.push('REQFAIL ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${port}/?mode=ai`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__GAME__ && window.__GAME__.ready === true');
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => { const G = window.__GAME__; G.freeze(true); window.__QA_RENDER = (dt = 0.016) => { G.battle.update(dt); window.__LINE_TICK?.(); G.camera.update(0); G.pipeline.render(G.scene, G.camera.cam, dt); }; });
  const render = () => page.evaluate(() => window.__QA_RENDER());
  const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('captured', `${OUT}/${name}.png`); };
  // ---- 1. facing table: expected row/mirror derived from the camera matrices, not from the sprite's own yaw math ----
  const table = await page.evaluate(() => {
    const G = window.__GAME__; const b = G.battle; const u = b.units[0]; const s = b.spriteOf(u); const out = [];
    for (let yi = 0; yi < 4; yi++) {
      G.camera.applyView({ yawIndex: yi }); G.camera.snap();
      const cam = G.camera.cam; cam.updateMatrixWorld();
      const e = cam.matrixWorld.elements; const right = { x: e[0], z: e[2] }; // camera local +X in world
      const toCam = { x: cam.position.x - G.camera.focus.x, z: cam.position.z - G.camera.focus.z };
      for (let f = 0; f < 4; f++) {
        u.facing = f; b.update(0);
        const fx = [0, 1, 0, -1][f], fz = [1, 0, -1, 0][f];
        const front = fx * toCam.x + fz * toCam.z > 0; const facesRight = fx * right.x + fz * right.z > 0;
        const expRow = front ? 0 : 1, expMirror = !facesRight;
        out.push({ yawIndex: yi, facing: f, row: s.row, mirror: s.mirror, expRow, expMirror, ok: s.row === expRow && s.mirror === expMirror });
      }
    }
    return out;
  });
  for (const r of table) { if (!r.ok) failures++; console.log(`${r.ok ? 'PASS' : 'FAIL'} yaw${r.yawIndex} facing${r.facing}: row ${r.row} (exp ${r.expRow}) mirror ${r.mirror} (exp ${r.expMirror})`); }
  // ---- 2. on-screen sprite height per zoom (for atlas sizing) ----
  const heights = await page.evaluate(() => {
    const G = window.__GAME__; const b = G.battle; const u = b.units[0]; const s = b.spriteOf(u); const out = {};
    for (const z of [0.95, 1.5, 2.2]) {
      G.camera.applyView({ yawIndex: 0, zoom: z, focus: s.root.position.clone() }); G.camera.snap(); const cam = G.camera.cam;
      const p0 = s.root.position.clone().project(cam), p1 = s.root.position.clone().add(new (s.root.position.constructor)(0, s.heightUnits, 0)).project(cam);
      out[z] = Math.abs(p1.y - p0.y) / 2 * innerHeight;
    }
    return out;
  });
  console.log('sprite (1.55u) screen height px by zoom:', JSON.stringify(heights));
  // ---- 3. visual: attack thrust toward a target at each yaw (4 units in a row, facing 0..3, impact pose) ----
  await page.evaluate(() => {
    const G = window.__GAME__; const b = G.battle; const A = b.units.filter((u) => u.team === 'A');
    // pick the flattest 5-tile run near the middle of the map so the bench is not cut in half by a terrace
    let best = null;
    for (let z = 1; z < G.MAP.d - 1; z++) for (let x = 1; x < G.MAP.w - 5; x++) {
      const hs = []; let ok = true;
      for (let i = 0; i < 5; i++) { const t = G.MAP.at(x + i, z); if (!t || t.solid === false) { ok = false; break; } hs.push(t.h); }
      if (!ok) continue;
      const spread = Math.max(...hs) - Math.min(...hs);
      const d = Math.abs(x + 2 - G.MAP.w / 2) + Math.abs(z - G.MAP.d / 2);
      // flat first, then as high as possible (a rooftop terrace is not hidden behind houses), then near the middle
      const score = spread * 1000 - hs[2] * 40 + d;
      if (!best || score < best.score) best = { x, z, score };
    }
    const cx = (best ? best.x + 2 : Math.floor(G.MAP.w / 2)), cz = best ? best.z : Math.floor(G.MAP.d / 2);
    A.forEach((u, i) => { u.x = cx - 2 + i; u.z = cz; u.facing = i % 4; const s = b.spriteOf(u); s.root.position.copy(b.worldPos(u.x, u.z)); s.setPose('attack2'); });
    for (const u of b.units.filter((v) => v.team === 'B')) b.spriteOf(u).root.visible = false;
    window.__QA = { cx, cz };
  });
  for (let yi = 0; yi < 4; yi++) {
    await page.evaluate((yi) => { const G = window.__GAME__; const b = G.battle; const { cx, cz } = window.__QA; G.camera.applyView({ yawIndex: yi, zoom: 2.0, focus: b.worldPos(cx, cz, 0.6) }); G.camera.snap(); }, yi);
    await render(); await shot(`facing_yaw${yi}`);
  }
  // ---- 4. states: idle / walk mid-step / charge / KO / hit-flash, then the same bench at all three preset zooms ----
  await page.evaluate(() => {
    const G = window.__GAME__; const b = G.battle; const A = b.units.filter((u) => u.team === 'A'); const { cx, cz } = window.__QA;
    A.forEach((u, i) => { u.facing = 0; const s = b.spriteOf(u); s.setPose('idle'); s.walk = null; s.setCharging(false); s.setKO(false); s.flash = 0; });
    b.spriteOf(A[1]).walk = { phase: 0.3, dir: 1, hop: 0 }; b.spriteOf(A[1]).setPose('recover');
    b.spriteOf(A[2]).setCharging(true);
    b.spriteOf(A[3]).setKO(true); b.spriteOf(A[3]).koAt = performance.now() - 1000;   // wall-clock fall: pre-advance so the static shot shows the FLAT pose
    if (A[4]) b.spriteOf(A[4]).flash = 0.3;
    G.camera.applyView({ yawIndex: 0, zoom: 2.2, focus: b.worldPos(cx, cz, 0.6) }); G.camera.snap();
    for (let i = 0; i < 40; i++) b.update(0.03);
  });
  await render(); await shot('states_idle_walk_charge_ko');
  // separation check: the same five units at the wide / mid / close preset zooms (does the ink rim hold at 1x?)
  await page.evaluate(() => { const G = window.__GAME__; const b = G.battle; const A = b.units.filter((u) => u.team === 'A'); A.forEach((u) => { const s = b.spriteOf(u); s.setKO(false); s.setCharging(false); s.walk = null; s.flash = 0; s.setPose('idle'); }); for (let i = 0; i < 40; i++) b.update(0.03); });
  for (const [tag, z] of [['wide', 0.95], ['mid', 1.5], ['close', 2.2]]) {
    await page.evaluate((z) => { const G = window.__GAME__; const b = G.battle; const { cx, cz } = window.__QA; G.camera.applyView({ yawIndex: 0, zoom: z, focus: b.worldPos(cx, cz, 0.6) }); G.camera.snap(); }, z);
    await render(); await shot(`bench_${tag}`);
  }
  // studio: same five units with the terrain hidden, so sprite craft (silhouette, ink rim, contact shadow, KO pose)
  // can be judged without the map churning underneath between rounds.
  await page.evaluate(() => {
    const G = window.__GAME__; const b = G.battle; const A = b.units.filter((u) => u.team === 'A'); const { cx, cz } = window.__QA;
    window.__HIDDEN = []; G.scene.traverse((o) => { if (o.parent === G.scene && o !== b.unitGroup && o.visible) { o.visible = false; window.__HIDDEN.push(o); } });
    A.forEach((u, i) => { const s = b.spriteOf(u); s.root.visible = true; s.setPose('idle'); s.walk = null; s.setCharging(false); s.setKO(false); s.flash = 0; });
    b.spriteOf(A[1]).walk = { phase: 0.3, dir: 1, hop: 0 }; b.spriteOf(A[1]).setPose('recover');
    b.spriteOf(A[2]).setCharging(true);
    b.spriteOf(A[3]).setKO(true); b.spriteOf(A[3]).koAt = performance.now() - 1000;   // wall-clock fall: pre-advance so the static shot shows the FLAT pose
    if (A[4]) { b.spriteOf(A[4]).setPose('attack2'); }
    G.camera.applyView({ yawIndex: 0, zoom: 2.4, focus: b.worldPos(cx, cz, 0.5) }); G.camera.snap();
    for (let i = 0; i < 40; i++) b.update(0.03);
  });
  await render(); await shot('studio_states');
  await page.evaluate(() => { const G = window.__GAME__; for (const o of window.__HIDDEN) o.visible = true; const b = G.battle; b.units.filter((u) => u.team === 'A').forEach((u) => { const s = b.spriteOf(u); s.setKO(false); s.setCharging(false); s.walk = null; s.setPose('idle'); }); for (let i = 0; i < 20; i++) b.update(0.03); });
  // feet closeup on real terrain: contact shadow + planting check (the thing that most often reads as "floating")
  await page.evaluate(() => {
    const G = window.__GAME__; const b = G.battle; const A = b.units.filter((u) => u.team === 'A'); const { cx, cz } = window.__QA;
    A.forEach((u, i) => { const s = b.spriteOf(u); s.root.visible = true; s.setPose('idle'); s.walk = null; s.setCharging(false); s.setKO(false); });
    G.camera.applyView({ yawIndex: 0, zoom: 3.6, focus: b.worldPos(cx, cz, 0.25) }); G.camera.snap();
    for (let i = 0; i < 10; i++) b.update(0.016);
  });
  await render(); await shot('feet_closeup');
  // pose strip: one class, all six atlas columns, front row then back row
  await page.evaluate(() => {
    const G = window.__GAME__; const b = G.battle; const A = b.units.filter((u) => u.team === 'A'); const { cx, cz } = window.__QA;
    A.forEach((u, i) => { u.facing = 0; const s = b.spriteOf(u); s.setPose(i); });
    G.camera.applyView({ yawIndex: 0, zoom: 2.4, focus: b.worldPos(cx, cz, 0.6) }); G.camera.snap(); for (let i = 0; i < 5; i++) b.update(0.016);
  });
  await render(); await shot('poses_front');
  // ---- 5. lineup of every sheet in the roster (uses the __UNITS__ hook) ----
  const roster = readFileSync('src/units/roster.js', 'utf8'); const sheets = [...roster.matchAll(/sprite:\s*'([^']+)'((?:\s*,\s*\w+:\s*[\d.]+)*)/g)].map((m) => { const o = Object.fromEntries([...(m[2] || '').matchAll(/(\w+):\s*([\d.]+)/g)].map((k) => [k[1], +k[2]])); return { name: m[1], h: o.height }; });
  await page.evaluate(async (sheets) => {
    const G = window.__GAME__; const b = G.battle; const U = window.__UNITS__; const { cx, cz } = window.__QA;
    for (const u of b.units) b.spriteOf(u).root.visible = false;
    window.__LINE = [];
    const cols = 6; const x0 = Math.max(0, cx - 3), z0 = Math.max(1, cz - 3);
    for (let i = 0; i < sheets.length; i++) {
      const atlas = await U.loadAtlas(sheets[i].name); const S = U.UnitSprite(); const s = new S(atlas, { height: sheets[i].h });
      const x = x0 + (i % cols), z = z0 + Math.floor(i / cols) * 2; s.root.position.copy(b.worldPos(Math.min(x, G.MAP.w - 1), Math.min(z, G.MAP.d - 1))); s.facing = i % 2 ? 1 : 0; b.unitGroup.add(s.root); window.__LINE.push(s);
    }
    const tick = () => { for (const s of window.__LINE) s.update(G.camera.yawNow, 0.016); }; tick(); window.__LINE_TICK = tick;
    G.camera.applyView({ yawIndex: 0, zoom: 1.35, focus: b.worldPos(x0 + 3, z0 + 5, 0.6) }); G.camera.snap(); tick();
  }, sheets);
  await render(); await shot('lineup_front');
  await page.evaluate(() => { for (const s of window.__LINE) s.facing = (s.facing + 2) % 4; });
  await render(); await shot('lineup_back');
  if (errors.length) console.log('PAGE ERRORS:\n' + errors.slice(0, 20).join('\n'));
  console.log(failures ? `FACING FAILURES: ${failures}` : 'FACING: all 16 cases pass');
} finally { await browser.close(); srv.close(); if (!args.keep) execSync(`rm -rf ${DIST}`); }
process.exit(failures ? 1 : 0);
