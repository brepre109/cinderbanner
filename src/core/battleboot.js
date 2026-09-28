// The battle boot: the former body of src/main.js, moved here verbatim (import paths re-rooted) so main.js can route
// between this and the campaign shell. Campaign hooks are the `camp` lines only; with no ?slot they are all no-ops.
import * as THREE from 'three';
import { MAP } from '../world/mapdata.js';
import { buildTerrain } from '../world/terrain.js';
import { buildProps, batchProps } from '../world/props.js';
import { texturesReady } from '../world/textures.js';
import { BattleCamera, YAW_STOPS } from '../render/camera.js';
import { UI } from '../ui/ui.js';
import { TileOverlay } from '../ui/overlay.js';
import { VFX } from '../vfx/effects.js';
import { Battle } from '../game/battle.js';
import { PlayerController } from '../game/player.js';
import { HSTEP } from '../core/config.js';
import { createPipeline } from '../render/pipeline.js';
import { buildLighting } from '../render/lighting.js';
import { createCutaway, patchProps, unitFocus, tileFocus, fieldFocus } from '../render/cutaway.js';
import { preloadAtlases } from '../units/sprites.js';
import { spriteFor } from '../units/roster.js';
import { CLASSES } from '../game/data.js';

const q = new URLSearchParams(location.search);
const mark = (n) => { try { performance.mark('boot:' + n); } catch { /* old browsers */ } };
mark('start');
// Campaign battle (?battle=1&map=<id>&slot=<node>): the party, the enemy line-up, the result hand-off and the pause
// menu come from src/campaign/battlelink.js. Without ?slot this is null and the boot below is the demo/capture boot,
// unchanged (same roster, same names, same addUnit calls, same title).
const camp = q.has('slot') ? await import('../campaign/battlelink.js').then((m) => m.prepare(q)).catch((e) => { console.error('campaign battle setup failed', e); return null; }) : null;
const canvas = document.getElementById('gl');
const pipeline = createPipeline(canvas); const renderer = pipeline.renderer;
const scene = new THREE.Scene();
// 3rd arg (PERF r7): the pipeline already knows whether GL is software; lighting.js may use it instead of opening a
// second WebGL context just to read the renderer string (proposed patch in the r7 perf report; ignored until then).
const lighting = buildLighting(scene, MAP, { soft: pipeline.opts.soft, shadowRes: pipeline.opts.shadowRes });
const camera = new BattleCamera(innerWidth / innerHeight);
const ui = new UI(document.getElementById('ui'), () => camera.cam, () => renderer);
const overlay = new TileOverlay(scene, MAP);
const vfx = new VFX(scene);
mark('setup');
const terrain = buildTerrain(MAP); scene.add(terrain); mark('terrainBuilt');
// PERF r11: start linking programs NOW (see pipeline.precompile): only what the first frame draws, in scene order.
const drawn = (root) => { const out = []; root.traverseVisible((o) => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) out.push(o); }); return out; };
const precompile = (root) => { if (q.get('precompile') === 'off') return; try { pipeline.precompile(drawn(root), scene, camera.cam); } catch (e) { console.warn('precompile skipped', e); } };
precompile(terrain); mark('terrain');

const roster = camp ? camp.roster : { A: ['knight', 'archer', 'sorcerer', 'cleric', 'wyrmlancer'], B: ['ninja', 'chronomancer', 'apothecary', 'skeleton', 'wyrm'] };
const names = camp ? camp.names : { A: ['Aldric', 'Seren', 'Tobin', 'Ysolde', 'Orran'], B: ['Corvina', 'Malquor', 'Ludovic', 'Bone Walker', 'Wyrm'] };
// --- boot I/O: every independent fetch is STARTED here and awaited below, in the old order ---------------------
// The props manifest, the ten sprite sheets and the optional modules share nothing, but the old boot awaited them
// in a chain: props, then one atlas per unit inside the placement loop (battle.addUnit awaits loadAtlas before the
// caller can make the next unit), then two dynamic imports. Measured: a 1,298 ms atlas chain for 250 ms of network,
// with the optional modules' 42 kB not even requested until the very end. Starting the promises here overlaps all
// of it; awaiting them at exactly the old points keeps unit ids, tiles, scene-graph order and init order identical.
// spriteFor() is the same roster lookup rules.js resolves `spriteName` through, so the preload set can never drift
// from what addUnit asks for — a miss would only cost a cache-cold fetch, never a wrong sheet.
const propsP = buildProps(MAP);
// CLASSES[cls].sprite first: a job that borrows another class's sheet (the hero's Oathknight -> knight) resolves there.
const atlasP = preloadAtlases([...roster.A, ...roster.B].map((c) => CLASSES[c]?.sprite || spriteFor(c)));
// Optional modules owned by other items are wired here if present (camera cinematics, audio).
const optional = import.meta.glob(['../render/cinematics.js', '../audio/audio.js']);
const optionalP = Object.entries(optional).map(([path, load]) => [path, load().catch((e) => { console.error('optional module failed', path, e); return null; })]);

const props = await propsP; scene.add(props); mark('propsBuilt');
// PERF r7: every static prop mesh folded into one draw per material (props.js batchProps). The props group keeps its
// per-prop meshes (hidden) for anything that reads it; ?batch=off draws those instead.
const propsBatch = q.get('batch') !== 'off' ? batchProps(props) : null; if (propsBatch) scene.add(propsBatch);
// R9 cutaway: prop colour materials get the shader cut (src/render/cutaway.js); shadow/depth passes are untouched.
const cutaway = createCutaway({ enabled: q.get('cut') !== 'off' }); patchProps(props, propsBatch);
precompile(props); if (propsBatch) precompile(propsBatch); mark('props');
const battle = new Battle({ map: MAP, scene, camera, vfx, ui, overlay });
vfx.attach?.(battle); // CRITIQUE_R2 integration bug 1: without this fx_ko/fx_raise/fx_charge never play
camera.lookAt(new THREE.Vector3(8, 1.2, 8), true);

await atlasP; mark('atlases'); // every sheet the loop below needs is now in atlasCache; the loop itself is unchanged
for (const team of ['A', 'B']) for (let i = 0; i < roster[team].length; i++) {
  const sp = MAP.spawns[team][i]; if (!sp) break; const [x, z] = sp;
  const u = await battle.addUnit(team, roster[team][i], x, z, names[team][i], camp?.opts[team][i]); camp?.placed(team, i, u);
}
mark('units');
const player = new PlayerController(battle, ui, overlay, camera, canvas);
const ctx = { battle, camera, ui, overlay, vfx, scene, renderer, pipeline, lighting, MAP, player, canvas };
// init() still runs here, serially, in glob order, before `ready` — cinematics' init is what gives camera.js its
// bounds, fit points and HUD bands, so a frame captured before it has run is framed differently. Only the module
// FETCH moved (above); the init contract is untouched.
for (const [path, p] of optionalP) { try { const m = await p; await m?.init?.(ctx); } catch (e) { console.error('optional module failed', path, e); } }
// Cutaway foci, read from live state every frame (nothing here writes to battle/ui/player): the acting unit (the HUD's
// named unit first, like cinematics' subject), the tile cursor (with whoever stands on it) and the ability pair.
// No actor, no cursor, no pair (pure capture presets) => no focus => the diorama is drawn whole.
const cutUnitAt = (x, z) => battle.units.find((u) => u.x === x && u.z === z && u.hp > 0) || null;
const cutOut = [];   // PERF r11: reused every frame (the cutaway copies what it needs out of it)
cutaway.setProvider(() => {
  const out = cutOut; out.length = 0;
  const id = document.getElementById('unit-card')?.dataset?.id;
  const act = (id && battle.units.find((u) => u.id === id && u.hp > 0)) || (battle.active && battle.active.hp > 0 ? battle.active : null);
  if (act) out.push(unitFocus(battle, act, 'actor'));
  const fld = fieldFocus(overlay, act ? battle.spriteOf(act)?.root.position : null); if (fld) out.push(fld);
  if (overlay.cursor.visible) {
    const c = overlay.cursor.position; const u = cutUnitAt(Math.floor(c.x), Math.floor(c.z));
    out.push(u && u !== act ? unitFocus(battle, u, 'cursor', 1.2) : tileFocus(c, 'cursor'));
  }
  // Deployment: the whole company is the subject, so open whatever stands in front of the deploy line.
  if (window.__CAMPAIGN__?.deploying) { let n = 0; for (const u of battle.units) if (u.team === 'A' && u.hp > 0 && u !== act && n < 3 && !out.some((f) => f.pos.distanceTo(unitFocus(battle, u, 'dep' + n).pos) < 0.3)) out.push(unitFocus(battle, u, 'dep' + n++)); }
  const pr = window.__CINE__?.state?.pair;
  if (pr) for (const [u, k] of [[pr.target, 'target'], [pr.actor, 'pairA']]) if (u && u !== act && u.hp > 0 && !out.some((f) => f.key === 'cursor' && f.pos.distanceTo(unitFocus(battle, u, k).pos) < 0.3)) out.push(unitFocus(battle, u, k));
  return out;
});
// R9 field keep-out: the camera's HUD-chrome search also counts highlighted move/target tiles behind a window, and
// a field that appears/changes during live play re-solves the current aim (springs ease it) so the acting unit's
// range is lifted clear of the bottom cards. Captured presets re-solve on their own snap.
const fieldPts = () => { const o = []; for (const k of overlay.group.children) if (k.renderOrder === 3 && k.isMesh) o.push([k.position.x, k.position.y, k.position.z]); return o; };
camera.setFieldPoints(fieldPts);
let fieldN = -1, fieldSx = NaN;   // PERF r11: two numbers, not a signature string built every frame
camera.addTicker(() => {
  const k = overlay.group.children; let n = 0, sx = 0; for (const c of k) if (c.renderOrder === 3) { n++; sx += c.position.x * 31 + c.position.z; }
  if (n === fieldN && sx === fieldSx) return; fieldN = n; fieldSx = sx;
  if (n && camera._aim && !window.__CINE__?.state?.locked) camera.lookAt(camera._aim.clone());
});
const mode = q.get('mode') || 'play';
if (mode === 'play') battle.controller = (u) => u.team === 'A' ? player.decide(u) : null;
// Rewind in non-campaign play (campaign battles wire their own through battlelink, with pause-menu + defeat offers).
if (mode === 'play' && !camp) import('../campaign/kit.css').then(() => import('../campaign/battle.css')).then(() => import('../ui/rewind.js')).then(({ openRewind, installRewindThumbs, rewindFx }) => import('../ui/prefs.js').then(({ rewindLimit }) => {
  battle.rewindLimit = rewindLimit(); try { installRewindThumbs(window.__GAME__ || { battle, renderer, camera, ui }); } catch { /* thumbnails optional */ }
  let open = false;
  window.addEventListener('keydown', async (e) => {
    if ((e.key !== 'r' && e.key !== 'R') || e.repeat || e.ctrlKey || e.metaKey || e.altKey || open) return;
    if (!player.awaitingInput?.() || !battle.rewindTargets().length || battle.rewindLimit === 0) return;
    e.preventDefault(); e.stopImmediatePropagation(); open = true;
    let s = null; try { s = await openRewind({ battle, camera }); } finally { open = false; }
    if (s) { await rewindFx(s); battle.requestRewind(s); }
  }, true);
})).catch((e) => console.warn('rewind unavailable', e));

window.addEventListener('keydown', (e) => { if (e.key === 'q') camera.rotate(camera.yawIndex % 2 ? 1 : 2); if (e.key === 'e') camera.rotate(camera.yawIndex % 2 ? -1 : -2); /* the genre's four dimetric views: 90-degree turns between even stops */ if (e.key === 't') camera.togglePitch(); if (e.key === ' ' && !camp) { battle.auto = !battle.auto; if (battle.auto) battle.run(); } if (e.key === '=' || e.key === '+') camera.setZoom(camera.targetZoom * 1.2); if (e.key === '-') camera.setZoom(camera.targetZoom / 1.2); });
window.addEventListener('wheel', (e) => camera.setZoom(camera.targetZoom * (e.deltaY < 0 ? 1.1 : 0.9)));
window.addEventListener('resize', () => { pipeline.resize(innerWidth, innerHeight); camera.setAspect(innerWidth / innerHeight); });

// ---- PERF r7: static-scene bookkeeping, done once instead of every frame --------------------------------------
// Billboards: the list is collected once (the props group is built once per boot) instead of a 1,100-node
// props.traverse() per frame. Everything else under props is static, so its local matrices are composed once and
// matrixAutoUpdate is switched off; billboards keep auto-update because their yaw follows the camera.
const billboards = [];
props.updateMatrixWorld(true);
props.traverse((o) => { if (o.userData.billboard) billboards.push(o); else if (o !== props) o.matrixAutoUpdate = false; });
// Cached shadow map. The only shadow casters are terrain (static) and props (static except billboard yaw and
// sprites landing), and lighting.update() only drifts intensities, so the depth pass is re-rendered only when
// something it depends on changes: camera yaw (billboards turn), the key light / its shadow frustum (setSun,
// refit), a props sprite landing (props.userData.version) or the visible caster set. ?shadows=live restores
// per-frame updates; anything that moves a caster by other means can call __GAME__.invalidateShadows().
const shadowLive = q.get('shadows') === 'live';
const keyLight = lighting.sun;
if (!shadowLive && keyLight) renderer.shadowMap.autoUpdate = false;
// PERF r11: the same signature as before, kept as 18 numbers compared in place (it was a ~150-char template string
// and a fresh traverse closure every frame). NaN never equals itself, so invalidateShadows() is a fill(NaN).
const shadowSig = new Float64Array(18).fill(NaN), sigNow = new Float64Array(18);
let casters = 0; const countCaster = (o) => { if (o.castShadow && (o.isMesh || o.isPoints || o.isLine)) casters++; };
function syncShadows() {
  if (shadowLive || !keyLight) return;
  const sc = keyLight.shadow.camera, sp = keyLight.position, tp = keyLight.target.position; casters = 0;
  scene.traverseVisible(countCaster);
  const a = sigNow; a[0] = camera.yawNow; a[1] = sp.x; a[2] = sp.y; a[3] = sp.z; a[4] = tp.x; a[5] = tp.y; a[6] = tp.z;
  a[7] = sc.left; a[8] = sc.right; a[9] = sc.top; a[10] = sc.bottom; a[11] = sc.near; a[12] = sc.far; a[13] = keyLight.shadow.mapSize.x;
  a[14] = keyLight.castShadow ? 1 : 0; a[15] = props.userData.version; a[16] = casters; a[17] = 0;
  let changed = false; for (let i = 0; i < 18; i++) if (a[i] !== shadowSig[i]) { changed = true; shadowSig[i] = a[i]; }
  if (changed) renderer.shadowMap.needsUpdate = true;
}
// Billboards are yawed HERE, right before every draw (frame, warm-up, render(), fxStep), so the shadow map can never
// be baked with a billboard at a stale yaw: the warm-up draw happens before the first frame() ever turned them.
// PERF r11: the drawn billboards are instanced in propsBatch (props.js batchBillboards); the hidden per-prop originals
// keep their yaw too, for anything that reads the props group.
const updateBillboards = propsBatch?.userData.updateBillboards;
// dt === 0 is the frozen/capture path (render(), fxStep, warm-up): battle.update() does not run there, so a preset or
// ability camera that changed yaw would leave the unit cards edge-on (invisible, shadows still drawn) and on the
// wrong facing row. Re-pose every unit sprite for the current yaw with a zero time step.
function draw(dt) { cutaway.update(dt); const yaw = camera.yawNow; for (let i = 0; i < billboards.length; i++) billboards[i].rotation.y = yaw; if (!dt && typeof battle !== 'undefined' && battle?.sprites) for (const s of battle.sprites.values()) s.update(yaw, 0); if (updateBillboards) { camera.cam.updateMatrixWorld(); updateBillboards(yaw, camera.cam); } syncShadows(); pipeline.render(scene, camera.cam, dt); }

let last = performance.now(); let frozen = false;
// dt cap stays 0.05 s: camera/vfx integrate real time themselves; raising this (tried 0.25) lets the battle clock
// outrun the capture harness on software GL, so spell:<id> captures miss their beat. At 60 fps it never binds.
function frame(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; if (!frozen) { pipeline.tick?.(now); camera.update(dt); terrain.userData.update?.(now / 1000); battle.update(dt); vfx.update(dt); overlay.update(dt); ui.update(); lighting.update(now / 1000); draw(dt); } requestAnimationFrame(frame); }

// ---- first-frame warm-up: the first frame is drawn BEFORE `ready` is published ------------------------------
// three.js links a program the first time it draws a material and parses that program's uniform table on first
// use, so the first frame() was one unbreakable main-thread task: measured here at 1,153-3,919 ms (5.1-6.2 s on
// the profiled machine, 1,836 ms of it getUniforms across 68 programs). It ran AFTER `window.__GAME__.ready` went
// true, so ready promised a capturable frame 3.8-7.2 s before one existed and every screenshot in this project
// was racing it. Drawing that frame here costs the same milliseconds but moves them to the honest side of the
// gate: 4 interleaved cold loads per arm, medians -- first task after ready 2,049 ms -> 53 ms, ready -> two
// painted frames 4,614 ms -> 62 ms, nav -> two painted frames 6,229 ms -> 5,130 ms.
// renderer.compileAsync() is deliberately NOT the default. It only links off-thread where the driver has
// KHR_parallel_shader_compile; swiftshader does not, and its compile() walks scene.traverse (not traverseVisible),
// so it linked 71 programs where the frame draws 43 -- every pooled vfx/overlay mesh that is off screen -- and
// pushed nav -> two painted frames to 12,021 ms, twice the head of this branch. Where the extension IS present
// the link is free and those pooled materials are warm before they first fire, so the path stays, gated on the
// extension and forceable with ?warm=compile|render for the next boot-time measurement.
async function warmPrograms() {
  if ((q.get('warm') || (renderer.extensions.has('KHR_parallel_shader_compile') ? 'compile' : 'render')) === 'compile') {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    // One slice per scene branch (per prop for the 1,100-mesh props group), so no slice owns the thread;
    // compileAsync(obj, cam, scene) takes its lights from the target scene, giving the same program the
    // whole-scene call would. Then the uniform tables, eight per slice: getUniforms() caches on the program.
    const branches = [];
    for (const child of scene.children) { if (child.children.length > 24) branches.push(...child.children); else branches.push(child); }
    for (const b of branches) { await renderer.compileAsync(b, camera.cam, scene); await tick(); }
    const progs = renderer.info.programs || [];
    for (let i = 0; i < progs.length; i++) { progs[i].getUniforms(); if ((i & 7) === 7) await tick(); }
  }
  // The post stack's fullscreen passes are only compiled by a real render, so this is the step that makes the
  // gate honest -- and it is exactly the draw frame() would have done, at the same camera, with dt 0.
  draw(0);
  // R20 graphics Auto: confirm (or pick) the quality tier on this GPU with a few real frames of this map, before ready.
  try { await pipeline.calibrate?.(() => draw(0)); } catch (e) { console.warn('gfx calibration skipped', e); }
}
if (camp) ui.title(camp.title, camp.subtitle); else ui.title(MAP.name, 'CINDERBANNER');
// Raised before the warm-up, so its 2,200 ms timer keeps the same relation to the first capture that it had when
// the first frame blocked the thread for about as long. No capture can be byte-compared here (UnitSprite seeds
// its idle clock with Math.random(), and water/foliage run off the wall clock), so it was measured against the
// harness's own noise floor: two HEAD runs differ by mean |d| 0.61-1.18 per channel, HEAD vs this branch by
// 0.35-1.30, over wide/mid/close/high built from one tree state (shots/perf/p2-ctl-head1|head2|mine1).
precompile(scene); mark('modules');
// PERF r11: terrain/prop textures are no longer pre-painted with a procedural stand-in (textures.js); they were requested
// at buildTerrain() and have long landed by now, but the first frame must never draw one before it has.
await texturesReady(); mark('textures');
try { await warmPrograms(); } catch (e) { console.warn('program warm-up skipped', e); }
mark('warm');
requestAnimationFrame(frame);

// ---- Test / screenshot API ----
let scenarioFocus = null; // set by scenario(); presets must not clobber a scenario's aim (CRITIQUE_R2 integration bug 3)
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// Every preset states yawIndex, pitch AND zoom explicitly so it cannot inherit state from the
// preset that ran before it (CRITIQUE_R2 integration bug 2: `close` after `high` rendered at 48deg).
// Preset aims are authored for the 16x16 default map; SX/SZ scale them so 24-wide maps (twin_span, aqueduct_span)
// are framed on their own centre instead of cropped off one corner. Identical values on a 16x16 map.
const SX = (MAP.w || 16) / 16, SZ = (MAP.d || 16) / 16;
const presets = {
  wide: { yawIndex: 0, pitch: 'low', zoom: 0.95, focus: V(8 * SX, 1.2, 8 * SZ) },
  mid: { yawIndex: 0, pitch: 'low', zoom: 1.8, focus: V(6 * SX, 1, 12 * SZ) },   // R8: sprites are 2x density now, so the cast can be framed larger
  close: { yawIndex: 0, pitch: 'low', zoom: 2.4, focus: V(4.5 * SX, 1.2, 13.5 * SZ) },
  high: { yawIndex: 0, pitch: 'high', zoom: 1, focus: V(8 * SX, 1, 8 * SZ) },
  // rot1/rot2 are 90° and 180° from `wide`, as they have been for the whole capture history. The camera now has
  // eight stops, so those turns are indices 2 and 4; naming 1 and 2 would silently redefine every archived
  // blind-comparison frame as a 45°/90° turn.
  rot1: { yawIndex: 2, pitch: 'low', zoom: 1, focus: V(8 * SX, 1, 8 * SZ) },
  rot2: { yawIndex: 4, pitch: 'low', zoom: 1, focus: V(8 * SX, 1, 8 * SZ) },
  // yaw0..yaw7: one preset per stop, same lens and aim, so an 8-way rotate can be judged as a strip. Even indices
  // are the dimetric corners (rot1 === yaw2, rot2 === yaw4); odd ones are the new axis-aligned stops.
  ...Object.fromEntries(Array.from({ length: YAW_STOPS }, (_, i) => [`yaw${i}`, { yawIndex: i, pitch: 'low', zoom: 1, focus: V(8 * SX, 1, 8 * SZ) }])),
};

// Published in one assignment, after the warm-up: `ready === true` means the atlases are in, the optional modules
// have init'd, every program is linked and one frame has actually been drawn — i.e. the next frame is capturable.
// tools/shot.mjs, src/units/qa/units_check.mjs and the editor harness all gate on it, so it may only ever get
// stricter, never looser.
window.__GAME__ = {
  ready: true, battle, camera, scene, renderer, pipeline, lighting, ui, vfx, overlay, MAP, player, cutaway,
  applyPreset(n) { const v = presets[n] || presets.wide; camera.applyView({ ...v, focus: scenarioFocus || v.focus }); camera.snap(); cutaway.snap(); },
  settle(sec = 1) { camera.snap(); },
  freeze(v) { frozen = v; if (!v) last = performance.now(); },
  // While frozen, frame() does not render, so a capture would return the stale pre-step frame.
  render() { cutaway.snap(); draw(0); },   // capture path: the cutaway fade is at its end state, never mid-ramp
  invalidateShadows() { shadowSig.fill(NaN); },
  // Advance the effect clock to an exact time and render it: deterministic mid-effect captures.
  fxStep(dt = 0) { if (dt) { vfx.update(dt); overlay.update(dt); ui.update(); } draw(dt); },
  async step() { await battle.step(); },
  async scenario(name) { // deterministic demo states for screenshots
    const A = battle.units.filter((u) => u.team === 'A'), B = battle.units.filter((u) => u.team === 'B');
    scenarioFocus = null;
    if (name === 'menu') { ui.setActive(A[0]); ui.setTurnOrder(battle.turnOrder()); overlay.showActive(A[0].x, A[0].z); const r = (await import('../game/rules.js')).reachable(A[0], MAP, battle.units); overlay.showMove(r.tiles); ui.menu([{ label: 'Move', id: 'move' }, { label: 'Act', id: 'act' }, { label: 'Wait', id: 'wait' }], () => {}); scenarioFocus = battle.worldPos(A[0].x, A[0].z, 0.6); camera.lookAt(scenarioFocus); camera.snap(); }
    // spell:<abilityId> -- any ability on a deterministic caster/target pair (cinematics.pickPair), staged like 'fire'.
    if (name.startsWith('spell:')) { const SPELL_ALIAS = { ice: 'blizzard', bolt: 'thunder', lightning: 'thunder' }; const id = SPELL_ALIAS[name.slice(6)] || name.slice(6); const AB = (await import('../game/rules.js')).ABILITIES[id]; const p = AB && window.__CINE__?.pickPair?.(AB); if (p) { const t = { x: p.target.x, z: p.target.z }; ui.setActive(p.caster); ui.setTurnOrder(battle.turnOrder()); scenarioFocus = battle.worldPos(t.x, t.z, 0.6); camera.lookAt(scenarioFocus); camera.snap(); vfx._hero = null; battle.resolve(p.caster, AB, t, id); for (let i = 0; i < 80 && vfx._hero == null; i++) await new Promise((r) => setTimeout(r, 50)); await new Promise((r) => setTimeout(r, 120)); } }   // wait for the effect's hero beat, not a fixed sleep (wind-ups vary per spell)
    if (name === 'fire') { const t = { x: B[0].x, z: B[0].z }; ui.setActive(A[2]); ui.setTurnOrder(battle.turnOrder()); scenarioFocus = battle.worldPos(t.x, t.z, 0.6); camera.lookAt(scenarioFocus); camera.snap(); battle.resolve(A[2], (await import('../game/rules.js')).ABILITIES.fire, t, 'fire'); await new Promise((r) => setTimeout(r, 900)); }
    if (name === 'melee') { A[0].x = B[3].x; A[0].z = B[3].z + 1; battle.spriteOf(A[0]).root.position.copy(battle.worldPos(A[0].x, A[0].z)); ui.setActive(A[0]); ui.setTurnOrder(battle.turnOrder()); scenarioFocus = battle.worldPos(A[0].x, A[0].z, 0.6); camera.lookAt(scenarioFocus); camera.setZoom(1.8); camera.snap(); battle.resolve(A[0], (await import('../game/rules.js')).ABILITIES.attack, { x: B[3].x, z: B[3].z }, 'attack'); await new Promise((r) => setTimeout(r, 240)); }
    // R9 cutaway capture: Move selection with the cursor parked on the reachable tile that the props hide most
    // (a ray from the tile toward the lens against the prop meshes, deterministic). Shows the actor, field and
    // cursor cutaways together; ?cut=off gives the same frame without them for an A/B.
    if (name === 'cursor') {
      const u = A[0]; ui.setActive(u); ui.setTurnOrder(battle.turnOrder()); overlay.showActive(u.x, u.z);
      const r = (await import('../game/rules.js')).reachable(u, MAP, battle.units); overlay.showMove(r.tiles);
      const meshes = []; props.traverse((o) => { if (o.isMesh && !o.userData.billboard) meshes.push(o); });
      const ray = new THREE.Raycaster(); const dir = new THREE.Vector3(Math.sin(camera.stopYaw) * Math.cos(camera.targetPitch), Math.sin(camera.targetPitch), Math.cos(camera.stopYaw) * Math.cos(camera.targetPitch));
      let best = r.tiles[0], bs = -1;
      for (const t of r.tiles) { let hid = 0; for (const h of [0.1, 0.6, 1.1]) { ray.set(battle.worldPos(t.x, t.z, h), dir); if (ray.intersectObjects(meshes, false).length) hid++; } const sc = hid * 10 - (Math.abs(t.x - u.x) + Math.abs(t.z - u.z)); if (sc > bs) { bs = sc; best = t; } }
      overlay.setCursor(best.x, best.z); scenarioFocus = battle.worldPos(u.x, u.z, 0.6); camera.lookAt(scenarioFocus); camera.snap();
    }
    if (name === 'auto') { battle.auto = true; battle.speed = 4; battle.run(); await new Promise((r) => setTimeout(r, 6000)); battle.auto = false; }
    cutaway.snap();
  },
};
camp?.attach({ battle, camera, ui, overlay, player, canvas, freeze: (v) => window.__GAME__.freeze(v) });
if (q.get('auto')) { battle.auto = true; battle.speed = parseFloat(q.get('speed') || '1'); battle.run(); }
