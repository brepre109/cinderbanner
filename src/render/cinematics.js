import * as THREE from 'three';
import { HSTEP } from '../core/config.js';
import { PITCH, YAW_STOPS } from './camera.js';
import { prefs, flashScale } from '../ui/prefs.js';   // OPTIONS hooks (camera auto-rotate on ability, flash intensity)
import { CINE_TINT, CINE_HOLD, CINE_RELEASE, cineSpeedScale, cineTier } from '../vfx/cine.js';
import { ABILITIES } from '../game/rules.js';   // read-only: the probe/capture API looks abilities up by id
import { SUMMON_IDS, summonPlan, summonVictims } from '../vfx/summons.js';
// Battle cinematics: listens to the battle event bus and drives BattleCamera.
//  - fits the lens to the real diorama silhouette (zoom 1 == whole map, both tilts, all four rotations, no slack)
//  - gameplay zoom is much closer than the diorama view (the genre shows ~12 tiles across, never the whole board)
//  - turnStart: smooth focus travel to the actor at gameplay zoom
//  - moveStart..moveEnd: dead-zone follow of the walking sprite
//  - abilityStart: pull-in on the actor↔target midpoint; abilityEnd: pull-out back to the actor
//  - damage/ko: a short shake scaled by how heavy the hit was
//  - victory: slow pull-out over the field
// Everything is target-based (one write per event, springs do the motion) so a preset + snap() always wins and
// screenshots stay deterministic; snap() also cancels any pending pull-out timer.
//
// SNAP POLICY (why presets frame well, and why they repeat): a caller that names a focus owns it. A hardcoded
// preset point that lands on empty ground is retargeted on snap to the subject (the HUD-named actor, then
// battle.active, else the first living unit) — a pure function of the battle state and the unit positions,
// with no dependence on timers. See the camera.onSnap block below for the determinism defect this replaced.
// World units visible top-to-bottom during play. CRITIQUE_R2 rank 6c measured the old 10.6 as ~18.8 tiles across a
// 16:9 frame (the comment that claimed 12.5 was wrong) where the genre shows ~7. 8.5 == ~15.1 tiles across; the critique
// asks for ~6.5 (~11.5 tiles) but only AFTER the sprite/tile ratio lands (integration bug 15), so 8.5 for now.
// R7: 8.5 -> 7.4. The sprite/tile ratio landed in round 5 (pack_sprites CAST_SCALE 0.78 == the genre's 0.79 sprite-
// heights per tile), which was the precondition the note above set; and the atlases are now packed at 96 ppu,
// so a closer play lens magnifies nothing (tpp stays >= 1 down to zoom ~2.3). ~13 tiles across a 16:9 frame.
const VIEW_H = 7.4;
const PULL_MELEE = 1.34, PULL_RANGED = 1.18;
// HUD BANDS, in CSS pixels — the bands the HUD's own ink actually covers, so the camera can keep the CAST out
// from behind the windows while still letting the DIORAMA run under them (which is what the genre does: a reference capture,
// _54 and _06 all run terrain behind the status window). Measured, not guessed: the round-5b keep-out union
// (BuilderUI's shots/ui/_measure_r5_keepout.py over 8 cases + this module's _r5hud.mjs differencing probe).
// At 1100x620 the ink runs y=8..101 at the top (turn-order strip; the old clock is gone) and y=450..619 at the
// bottom-left (unit card; right-side blocks start higher) — so the full-width bands are 102 px top and 170 px
// bottom. The right rail (#menu / aiming #forecast) reaches up to y=352 but only while shown; that is not a
// full-width band (it would open a gutter of void) — cinematics measures every shown window's LIVE rect into
// frame.chrome (round 6; replaces round 5's menuLeft edge) and camera.js's chrome search slides the frame so
// the fewest unit hulls land behind them, subject overlaps weighing 8x cast overlaps. The panels are sized in
// CSS px, so these divide by the live viewport height. Round 4 reserved frame.bottom = 0.012 = 7 px, which is
// why four party members were captured entirely behind the status card; round 5 measured them at y=0.84..1.03
// AGAIN because the anchor band could overrule the containment interval; round 6 measured the SUBJECT itself
// at y up to 1.289 off-frame bottom — camera.js now clamps the subject into the hard [0.55, 0.70] band first,
// chrome second, no-void last. Re-probe after any ui change.
const HUD_TOP_PX = 102, HUD_BOTTOM_PX = 170;
// Right-rail reach: while the aiming forecast or the command menu is up, the bottom-right block reaches
// above the bottom band (keep-out: forecast x645+ y352+, menu x707+ y352+ at 1100x620). syncChrome below
// publishes those elements' LIVE rects as frame.chrome whenever they show or hide (0 rects = nothing up).

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const NEAR = 1.9;                       // world units: "this aim is already on someone" / "this unit is the subject"

// R18 SCENE CAMERA API for the staged-scene player (src/campaign/stage/player.js). Same surface as its stageCamera()
// adapter, so wiring it is one line there:   export function stageCamera(cam) { return sceneCamera(cam); }
// Differences from the adapter's placeholder body:
//   frame(shot, cut)  a CUT is camera.cut() -- springs jump to target WITHOUT the capture lock (snap() pinned the lens for
//                     the rest of the intro: review17 P3); a shot with a listener (`opt`) eases out to a two-shot when
//                     the pair fits at >= 0.7x the requested zoom
//   speak(speaker, listener, zoom)  frame a line: speaker (and listener) = arrays of [x,y,z] body points (feet, head),
//                     the speaker's body at the upper-middle of the picture, the listener in the shot when it fits
// All shots go through the stage hook the scene installs with hook(fn); cinematics' own framing (aim, abilities,
// deploy) resumes as soon as unhook() runs.
// the widest a two-shot may ease out to: 0.7x the requested lens, or 0.85x the battle's play lens when that is wider
// (a boss across the yard still reads at play zoom; past that the scene cuts to the speaker alone)
const twoShotMin = (cam) => Math.min(cam.targetZoom * 0.7, (cam.playZoom || cam.targetZoom) * 0.85);
export function sceneCamera(cam) {
  let prev = null, hooked = false, own = null;
  const V = (k) => new THREE.Vector3(k[0], k[1], k[2]);
  const twoShot = (shot) => {
    if (!shot || !shot.opt || !shot.opt.length) return;
    const zAll = cam.zoomToContain([shot.key, ...(shot.must || []), ...shot.opt], 0.05);
    if (zAll < cam.targetZoom - 1e-3 && zAll >= twoShotMin(cam)) cam.setZoom(zAll);
  };
  const api = {
    yaw: () => cam.yawNow,
    project: (v) => v.clone().project(cam.cam),
    zoom: () => cam.targetZoom,
    setZoom: (z) => cam.setZoom(z),
    fit: (pts, pad = 0.1) => cam.zoomToContain(pts, pad),
    frame(shot, cut = false) { if (!shot || !shot.key) return; twoShot(shot); cam.lookAt(V(shot.key), cut); if (cut) (cam.cut ? cam.cut() : cam.snap?.()); },
    hook(fn) { if (hooked) return; hooked = true; prev = cam._stageFn || null; own = () => fn() || (prev ? prev() : null); cam.setStageFn?.(own); },
    unhook() { if (!hooked) return; hooked = false; if (cam._stageFn === own) cam.setStageFn?.(prev); prev = null; own = null; },
    shake(v) { cam.shake = Math.max(cam.shake || 0, v); },
    // R20 (review19 P4): turn to the nearest dimetric stop from which terrain / other bodies do not hide `u` (the speaker
    // of an in-battle line; `other` = a second body that should read too). Props are left to the roof cutaway. Returns
    // the turn in stops (0 = none), so the caller can turn back with rotate(-k) when the line is over.
    reveal(u, other = null) {
      const C = typeof window !== 'undefined' ? window.__CINE__ : null; if (!u || !C?.bestYawOffset || C.state?.locked) return 0;
      let k = 0; try { k = C.bestYawOffset(other || u, u, cam.yawIndex, cam.targetPitch, { props: false }); } catch { k = 0; }
      if (k) cam.rotate(k); return k;
    },
    rotate(k) { if (k) cam.rotate(k); },
    speak(speaker, listener = null, zoom = null) {
      if (!speaker || !speaker.length) return null;
      const n = speaker.length; const key = [0, 0, 0]; for (const q of speaker) for (let i = 0; i < 3; i++) key[i] += q[i] / n;
      const shot = { key, must: speaker, opt: listener && listener.length ? listener : [], at: [0.5, 0.6] };
      if (zoom) cam.setZoom(zoom);
      api.frame(shot, false); return shot;
    },
  };
  return api;
}

export async function init(ctx) {
  const { battle, camera, MAP } = ctx; if (!battle || !camera) return;
  // ---- bounds + silhouette: what the lens must contain ----
  // Only what is actually VISIBLE counts. Tile tops (plus head room for a unit) and the cliff faces come from MAP;
  // every prop contributes its real world bounding box straight out of the scene graph, so houses, towers, arches
  // and ruins can grow without the camera guessing. Billboard props (trees, rocks, barrels) are still loading their
  // textures at init, so their height comes from the same env manifest props.js used — the group name carries the
  // sprite name. The black skirt under the diorama is an unlit black mesh against a dark sky: counting it just
  // pushed the whole battlefield into the middle of the frame with a band of nothing top and bottom, so it is
  // deliberately excluded.
  let hMin = Infinity, hMax = -Infinity;
  for (const row of MAP.tiles) for (const t of row) { hMin = Math.min(hMin, t.h); hMax = Math.max(hMax, t.h); }
  const baseY = hMin * HSTEP - 0.18;
  const pts = []; const HEAD = 0.6;      // head room over every tile so a unit standing at the rim still reads
  for (const row of MAP.tiles) for (const t of row) {
    const y = t.h * HSTEP; for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) pts.push([t.x + dx, y + HEAD, t.z + dz]);
    if (t.x === 0 || t.z === 0 || t.x === MAP.w - 1 || t.z === MAP.d - 1) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) pts.push([t.x + dx, baseY, t.z + dz]);
  }
  let topY = hMax * HSTEP + 1.2;
  const man = await fetch('./env/manifest.json').then((r) => r.json()).catch(() => ({}));
  const propGroup = ctx.scene && ctx.scene.getObjectByName ? ctx.scene.getObjectByName('props') : null;
  if (propGroup) {
    propGroup.updateMatrixWorld(true);
    const bb = new THREE.Box3(), wp = new THREE.Vector3();
    for (const child of propGroup.children) {
      bb.makeEmpty(); bb.setFromObject(child); if (bb.isEmpty() || !isFinite(bb.max.y)) continue;
      let top = bb.max.y, x0 = bb.min.x, x1 = bb.max.x, z0 = bb.min.z, z1 = bb.max.z;
      if (child.name && child.name.startsWith('prop_')) {         // billboard: texture may not have landed yet
        const h = man[child.name.slice(5) + '.png'] && man[child.name.slice(5) + '.png'].heightTiles;
        child.getWorldPosition(wp); const w = 0.5 * (h || 1);
        if (h) { top = Math.max(top, wp.y + h); x0 = wp.x - w; x1 = wp.x + w; z0 = wp.z - w; z1 = wp.z + w; }
      }
      if (top > hMax * HSTEP + 14) continue;                       // something exotic; do not let it own the frame
      topY = Math.max(topY, top);
      // Clamp the footprint to the map. A prop's own bbox is only as wide as its texture is loaded, so an
      // unclamped x/z made the horizontal fit depend on network timing: two identical runs measured _ex
      // 14.14 and 14.50, i.e. two different framings for the same preset. Props contribute HEIGHT; the
      // silhouette's width is the board, which is fixed. (Deterministic presets, CRITIQUE_R2 rank 6.)
      const cx0 = clamp(x0, 0, MAP.w), cx1 = clamp(x1, 0, MAP.w), cz0 = clamp(z0, 0, MAP.d), cz1 = clamp(z1, 0, MAP.d);
      for (const x of [cx0, cx1]) for (const z of [cz0, cz1]) pts.push([x, top, z]);
    }
  }
  camera.setBounds(new THREE.Vector3(0, baseY, 0), new THREE.Vector3(MAP.w, topY, MAP.d));
  camera.setFitPoints(pts);
  camera.setHeightSampler((x, z) => { const t = MAP.at(Math.floor(THREE.MathUtils.clamp(x, 0, MAP.w - 1)), Math.floor(THREE.MathUtils.clamp(z, 0, MAP.d - 1))); return t ? t.h * HSTEP : 0; });
  const GAMEPLAY_ZOOM = Math.round(2 * camera._fitHalfHeight(PITCH.low) / VIEW_H * 100) / 100;

  // Aim just above the FEET, not the chest: frame.focusY is a promise about where the unit STANDS (CRITIQUE_R2
  // rank 6b). The old 0.7 lift pushed the feet ~0.09 of the frame below focusY at play zooms, which is most of
  // why the measured foot fraction never matched the header's claim.
  const pos = (u, lift = 0.2) => battle.worldPos(u.x, u.z, lift);
  const spritePos = (u) => { const s = battle.spriteOf(u); return s ? s.root.position.clone().add(new THREE.Vector3(0, 0.2, 0)) : pos(u); };
  // LENS LOCK. snap() is only ever called by a screenshot preset / the test API, never by play. While the lock
  // holds the lens is PINNED: cinematics re-asserts the snapped yaw/pitch/zoom/focus every frame and zeroes shake,
  // so nothing can move the frame between the preset and the screenshot — not an ability that was already in
  // flight, not a counter-attack, not `src/game/battle.js`'s direct `camera.shake =` / `camera.lookAt(...)` writes,
  // which bypass this module's event handlers entirely.
  //
  // Round 3 expired the lock on a 5 s wall clock. Under swiftshader a capture run spends 10-30 s between presets,
  // so the lock was routinely dead by the time the next preset ran: an instrumented run showed the melee attack's
  // COUNTER-ATTACK firing `abilityStart` 12.9 s after the 'wide' snap, re-aiming the lens and re-zooming it to
  // 2.345 while a screenshot was pending. Whether that landed before or after a given screenshot is pure race.
  // The lock now has no clock at all: it is released by real user input (a key, the wheel, a pointer) or by an
  // explicit unlock(), neither of which a headless capture ever produces.
  camera.playZoom = GAMEPLAY_ZOOM;
  const state = { follow: null, pullTimer: null, subject: null, zoomBase: GAMEPLAY_ZOOM, locked: false, lockedAt: -1e9, lock: null, pair: null, yawOff: 0 };
  const locked = () => state.locked;
  const release = () => { state.locked = false; state.lock = null; ctx.vfx?.captureHold?.(false); if (ctx.vfx) ctx.vfx._capture = false; };
  // R18: capture phase -- the scene player / menus stop keydown propagation, and a bubbling listener then never heard
  // the Enter that should have ended a lock
  if (typeof window !== 'undefined') for (const ev of ['keydown', 'wheel', 'pointerdown']) window.addEventListener(ev, release, { passive: true, capture: true });
  // Tickers run at the TOP of camera.update(), before the springs and before shake is applied, so re-asserting
  // here wins over anything written since the last frame. snap() ends with update(0), which is where the pinned
  // state is captured — after the frame-bounds clamp has had the last word on the focus.
  camera.addTicker(() => {
    if (!state.locked) return;
    camera.shake = 0; camera.shakeClock = 0;
    if (!state.lock) { state.lock = { y: camera.targetYaw, p: camera.targetPitch, z: camera.targetZoom, f: camera.targetFocus.clone() }; return; }
    const L = state.lock;
    camera.targetYaw = camera.yaw = L.y; camera.yawVel = 0;
    camera.targetPitch = camera.pitch = L.p; camera.pitchVel = 0;
    camera.targetZoom = camera.zoom = L.z; camera.zoomVel = 0;
    camera.targetFocus.copy(L.f); camera.focus.copy(L.f); camera.focusVel.set(0, 0, 0);
  });
  const clearTimer = () => { if (state.pullTimer) { if (typeof state.pullTimer === 'function') state.pullTimer(); else clearTimeout(state.pullTimer); state.pullTimer = null; } };
  const stopFollow = () => { if (state.follow) { state.follow(); state.follow = null; } };
  const mark = (v) => { state.subject = v.clone(); return v; };
  const nearestUnit = (p) => {
    let best = null, bd = Infinity;
    for (const u of battle.units) { if (u.hp <= 0) continue; const q = pos(u); const d = q.distanceToSquared(p); if (d < bd) { bd = d; best = q; } }
    return best;
  };
  // ---- R7: OCCLUSION-AWARE YAW for abilities ----------------------------------------------------------------
  // The yaw stops are fixed and the props are opaque, so an ability aimed at a unit standing behind a house was
  // played out behind its roof (scenario=fire framed the target under the thatch; the occlusion ghost was all
  // the critic saw). For the actor/target pair we test each candidate yaw by casting rays from points on both
  // bodies TOWARD THE LENS (orthographic: one direction for the whole frame) against the props, and by marching
  // the same rays over the terrain height field for cliffs. The play lens turns (eased, via the yaw spring) to the
  // nearest stop that clears the target and turns back after the pull-out; the capture lens (locked presets)
  // applies the same pure function of battle state, so screenshots stay deterministic. ?cineyaw=off disables.
  const YAW_AID = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('cineyaw') === 'off');
  const occ = { ray: new THREE.Raycaster(), dir: new THREE.Vector3(), o: new THREE.Vector3(), right: new THREE.Vector3(), list: null };
  const occluders = () => {
    if (occ.list) return occ.list;
    const g = ctx.scene && ctx.scene.getObjectByName ? ctx.scene.getObjectByName('props') : null;
    occ.list = [];
    // Only solid meshes: billboard props (trees/rocks/barrels) are small and see-through at the edges, and a
    // Sprite needs a raycaster camera. A house/tower/wall is what hides a unit.
    if (g) g.traverse((o) => { if (o.isMesh && !o.isSprite && o.geometry) occ.list.push(o); });
    return occ.list;
  };
  const terrainBlocks = (o, d) => {
    for (let t = 0.7; t < 14; t += 0.25) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (x < 0 || z < 0 || x > MAP.w || z > MAP.d) return false;
      const t0 = MAP.at(Math.floor(x), Math.floor(z)); if (t0 && t0.h * HSTEP > y + 0.04) return true;
    }
    return false;
  };
  // fraction of sample points on unit u hidden from the lens at (yaw, pitch)
  // R20: opts.props === false leaves the props out (the roof cutaway opens those; only terrain and bodies need a turn)
  const hiddenFrac = (u, yaw, pitch, opts = null) => {
    const p = pos(u, 0); const s = battle.spriteOf(u); const h = (s && s.heightUnits) || 1.1;
    const cp = Math.cos(pitch); occ.dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp); occ.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    occ.ray.camera = camera.cam; occ.ray.far = 30; const list = opts && opts.props === false ? [] : occluders();
    // other units standing between this one and the lens (a skeleton in front of the Fire target hid it whole)
    const sp = Math.sin(pitch), upx = -sp * Math.sin(yaw), upy = cp, upz = -sp * Math.cos(yaw);
    const blockers = [];
    for (const v of battle.units) {
      if (v === u || v.hp <= 0 || v.removed) continue; const b = pos(v, 0);
      const vs = battle.spriteOf(v); if (vs && !vs.root.visible) continue;
      blockers.push([b, ((vs && vs.heightUnits) || 1.1)]);
    }
    let hid = 0, n = 0;
    for (const fy of [0.2, 0.5, 0.85]) for (const sx of [-0.22, 0, 0.22]) {
      n++; occ.o.set(p.x, p.y + fy * h, p.z).addScaledVector(occ.right, sx * h * 0.6);
      if (terrainBlocks(occ.o, occ.dir)) { hid++; continue; }
      occ.ray.set(occ.o, occ.dir); if (list.length && occ.ray.intersectObjects(list, false).length) { hid++; continue; }
      for (const [b, hv] of blockers) {
        const dx = occ.o.x - b.x, dy = occ.o.y - b.y, dz = occ.o.z - b.z;
        if (-(dx * occ.dir.x + dy * occ.dir.y + dz * occ.dir.z) < 0.25) continue;             // not nearer the lens
        const scx = dx * occ.right.x + dz * occ.right.z, scy = dx * upx + dy * upy + dz * upz;
        if (Math.abs(scx) < hv * 0.30 && scy > -0.1 && scy < hv * upy) { hid += 0.7; break; }
      }
    }
    return Math.min(1, hid / n);
  };
  const YAW0 = Math.PI / 4, YSTEP = Math.PI * 2 / YAW_STOPS;
  // Best yaw-stop OFFSET (in stops, relative to baseIndex) for an actor/target pair. Target visibility weighs
  // double; a turn costs a little so ties keep the player's view; 0 when the current stop already reads.
  const bestYawOffset = (actor, target, baseIndex = camera.yawIndex, pitch = camera.targetPitch, opts = null) => {
    if (!actor || !target) return 0;
    const score = (k) => { const yaw = YAW0 + ((baseIndex + k + YAW_STOPS) % YAW_STOPS) * YSTEP; return 2 * hiddenFrac(target, yaw, pitch, opts) + (actor === target ? 0 : hiddenFrac(actor, yaw, pitch, opts)) + 0.06 * Math.abs(k); };
    const s0 = score(0); if (s0 <= 0.25) return 0;
    let best = 0, bs = s0;
    // Only land on the dimetric (even) stops: an axis-aligned stop reads as a flat top-down board, not the genre.
    for (const k of [1, -1, 2, -2, 3, -3, 4]) { if ((baseIndex + k) % 2) continue; const sc = score(k); if (sc < bs - 0.2) { bs = sc; best = k; } }
    return best;
  };
  const unitAt = (t) => (t ? battle.units.find((u) => u.x === t.x && u.z === t.z && u.hp > 0) || battle.units.find((u) => u.x === t.x && u.z === t.z) || null : null);
  camera.setZoom(GAMEPLAY_ZOOM); camera.lookAt(camera.fitCenter());

  const applyHudBands = () => {
    const h = (typeof window !== 'undefined' && window.innerHeight) || 620;
    const w = (typeof window !== 'undefined' && window.innerWidth) || 1100;
    camera.setFrame({ hudTop: clamp(HUD_TOP_PX / h, 0, 0.3), hudBottom: clamp(HUD_BOTTOM_PX / h, 0, 0.42) });
    syncChrome(w, h);
  };
  // LIVE CHROME RECTS (round 6, replaces round 5's single menuLeft edge). Every shown HUD window under #ui
  // is measured — including the bottom cards: R6UI's round-6 contract pins #unit-card's box top to >= y450
  // at 1100x620 (box == ink, R6UI deleted #name-card), so the box is a true keep-out when it is shown and
  // simply absent between turns (no window, no ink, no keep-out). Rects are [x0, y0, x1, y1] in frame
  // fractions, re-published whenever the set changes: windows show and hide with play state (turn strip,
  // command menu/forecast), and any future window under #ui is picked up automatically — no id list to
  // keep in sync with the ui owner. #announce is skipped with the popups: it is the transient ability-name
  // plaque (~1.2 s) that the genre itself prints over the field, not part of the critic's keep-out
  // list (bottom cards / right rail / centre panel), and counting it forced a false-positive trade at
  // 'high' (four enemies pinned between the plaque and the turn strip with no legal escape).
  // camera.js weighs a subject overlap 8x a cast overlap and slides the frame (never zooms it) until the
  // count bottoms out.
  const CHROME_SKIP = ['announce', 'name-card', 'title', 'vignette', 'flash'];   // SPECT15: the guide line (#help) is HUD ink too
  const CINE_HIDDEN = ['unit-card', 'forecast', 'turn-order', 'announce', 'menu', 'objective'];   // ui.css #ui.cine
  let chromeKey = '';
  const syncChrome = (w, h) => {
    const rects = [], cineRects = [];
    if (typeof document !== 'undefined') {
      const vis = (el) => { const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && +cs.opacity >= 0.05; };
      const root = document.getElementById('ui');
      // R18: while a big-spell cinematic plays the ui fades these windows OUT (ui.css #ui.cine: opacity 0, hidden); their
      // 'show' layout boxes must not keep the free rect small while nothing is drawn there (review17 P4 summons)
      const cineOut = root && root.classList.contains('cine') ? CINE_HIDDEN : null;
      if (root) for (const el of root.children) {
        if (el.classList.contains('popup') || CHROME_SKIP.includes(el.id)) continue;  // damage text rides over units by design
        const hid = CINE_HIDDEN.includes(el.id);
        if (cineOut && hid) continue;
        // R9: a window that has been SHOWN but is still fading/sliding in (the unit card right after setActive)
        // is measured by its settled layout box, so a capture snapped during the fade still keeps the actor's
        // field out from under it (the old test skipped it until opacity >= 0.05, and the solve never re-ran).
        let r;
        if (!vis(el)) {
          if (!el.classList.contains('show') || !el.offsetParent) continue;
          const pr = el.offsetParent.getBoundingClientRect();
          r = { left: pr.left + el.offsetLeft, top: pr.top + el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
          r.right = r.left + r.width; r.bottom = r.top + r.height;
        } else r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        if (r.width >= w * 0.9 && r.height >= h * 0.9) continue;                      // fullscreen overlays carry no keep-out
        const rr = [+(r.left / w).toFixed(4), +(r.top / h).toFixed(4), +(r.right / w).toFixed(4), +(r.bottom / h).toFixed(4)];
        rects.push(rr); if (!hid) cineRects.push(rr);
      }
      // R18 SCENE LETTERBOX: a staged scene's black bars (stage.css .sg-bar, 9vh each) are keep-outs like any window, so
      // the speaker is framed inside the picture, not under a bar
      if (document.body.classList.contains('sg-bars-on')) for (const el of document.querySelectorAll('.sg-bar')) {
        const r = el.getBoundingClientRect(); if (r.height < 4 || r.bottom <= 0 || r.top >= h) continue;
        const rr = [0, +(Math.max(0, r.top) / h).toFixed(4), 1, +(Math.min(h, r.bottom) / h).toFixed(4)]; rects.push(rr); cineRects.push(rr);
      }
    }
    state.cineChrome = cineRects;
    const key = JSON.stringify(rects);
    if (key !== chromeKey) {
      chromeKey = key; camera.setFrame({ chrome: rects });
      // R9: a window that opens or closes in LIVE play (unit card after turnStart, command menu, forecast) re-solves
      // the current aim, so the actor and its field slide clear of it; the old solve only ran at lookAt time and
      // kept whatever chrome existed then. Springs ease the slide; captures (locked) are untouched.
      // R12: a window that opens mid-ability (the forecast card lands after abilityStart) shrinks the free rect,
      // so the stage lens pulls out if the effect no longer fits it
      if (!state.locked && state.stageFit) state.stageFit();
      if (!state.locked && !state.follow && camera._aim) camera.lookAt(camera._aim.clone());
    }
  };
  camera.addTicker(() => syncChrome((typeof window !== 'undefined' && window.innerWidth) || 1100, (typeof window !== 'undefined' && window.innerHeight) || 620));
  applyHudBands();
  if (typeof window !== 'undefined') window.addEventListener('resize', applyHudBands);

  // The frame must contain the cast, not just the board: feet AND head of every living unit. camera.js slides the
  // frame (never zooms it, so the edge-to-edge fill survives) until they are inside the safe band, and gives up if
  // the cast is too spread out to fit — which is exactly when the shot is a close-up and should stay one.
  // WHO THE FRAME IS ABOUT (round 6): the HUD's named unit, then battle.active, then the FIRST LIVING UNIT.
  // The third rung matters for the probes: _r5c_maps measures `battle.active ?? units.find(hp>0)` on maps
  // where no turn ever runs, so the camera must anchor the very unit the probe measures. Round 5's
  // nearest-to-aim fallback anchored whoever stood by the map centre while the probe read Aldric at spawn —
  // the two disagreed, the cast-midpoint solve placed Aldric wherever the cast fell, and 24/128 (map,view)
  // feet checks missed the band. Every rung is a pure function of battle state, so two identical capture
  // runs anchor the same unit; camera.js clamps its FEET into [0.55, 0.70].
  const activeUnit = () => {
    // The HUD's named unit FIRST: scenarios (menu/fire/melee) pose their actor through ui.setActive without
    // necessarily moving battle.active, and the AT mark the critics track follows the card. Auto battles keep
    // the card empty between turns, so battle.active is the live fallback there.
    const el = typeof document !== 'undefined' && document.getElementById('unit-card');
    const id = el && el.dataset && el.dataset.id;
    const named = id ? battle.units.find((u) => u.id === id && u.hp > 0) || null : null;
    if (named) return named;
    if (battle.active && battle.active.hp > 0) return battle.active;
    return battle.units.find((u) => u.hp > 0) || null;
  };
  // THE SUBJECT. The anchor is the ACTOR first, whatever the distance to the aim: the critics track the
  // AT-marked unit, and round 5's trace showed the nearest-to-aim rule choosing a mid-map unit while the
  // actor stood elsewhere — two different "subjects" in one frame. With no actor (idle / probe states) the
  // first living unit is both deterministic and the unit the maps probe measures. Every real aim (turnStart
  // / scenarioFocus / ability pull) names the actor anyway, so this only decides who is pinned when a
  // hardcoded preset point (wide/high/rot aim at the map centre) is the caller's aim.
  camera.setSubjectAnchor(() => {
    // R7: while an ability pair is on stage, the anchor is whichever of actor / target sits LOWER in the frame,
    // so the band [0.55, 0.70] keeps BOTH above the bottom cards (the other one is higher by construction).
    // Round 6 anchored the actor alone, and a target nearer the lens landed under the unit card.
    const pr = state.pair;
    if (pr && pr.actor && pr.target && pr.actor.hp > 0 && (locked() || pr.live)) {
      const pa = pos(pr.actor, 0), pt = pos(pr.target, 0);
      // a pair too far apart for one frame (a 12-tile Fire) frames the TARGET: that is where the effect plays
      const low = pa.distanceTo(pt) > 4.5 || camera.frameFraction(pt).y > camera.frameFraction(pa).y ? pr.target : pr.actor;
      camera._subjectId = low.id; const p = low === pr.target ? pt : pa; return [p.x, p.y, p.z];
    }
    const act = activeUnit();
    camera._subjectId = act ? act.id : null;   // frozen while the lens is locked: the trace/probes measure
    if (!act) return null;                      // exactly the unit this solve pinned, even if the HUD's
    // R18: a WALKING actor is anchored where its sprite is, not on the tile the engine already moved it to (the band
    // clamp chased the tile and let the drawn sprite walk under the unit card)
    const sp0 = battle.spriteOf(act); const p = sp0 && sp0.walk ? sp0.root.position : pos(act, 0);   // chain flips mid-capture (the auto scenario's last turn
    return [p.x, p.y, p.z];                     // unwinding under the first preset)
  });

  // ---- R12 ABILITY STAGE -------------------------------------------------------------------------------------
  // Blind A/B loss (units12 fire_mid): the Fire played in the lower-right corner half under the target card while
  // the idle party owned the upper-left. While an ability pair is on stage the camera now frames the EFFECT: the
  // target's body centre sits a little above the middle of the HUD-free rectangle (camera.freeRect(), measured
  // from the live window rects), the effect's full height and every AoE tile are held inside that rectangle, and
  // the caster is pulled in too whenever that does not push the target out. Pure function of battle state.
  const FX_TOP = { fire: 2.7, ice: 3.3, thunder: 2.9, holy: 3.1, quake: 1.9, cure: 2.5, buff: 2.3, debuff: 2.3, jump: 2.4 };
  const STAGE_AT = [0.5, 0.42];
  const WITH_ACTOR = 0.5;   // x zoomBase: the widest lens an ability shot eases out to so its caster stays in it
  // ---- R18 SUMMON SHOT (review17 P4: Pyrelord faced empty pews, Wyrm Sovereign was cut in half at 1920 and breathed off-screen) --
  // A summon is framed on the WHOLE moment: every victim's body and the creature's figure, planned with the same pure
  // function the effect places the creature with (vfx/summons.js summonPlan), against the rect the HUD leaves while
  // the cinematic has it faded out. key = the centre of that set, so the creature and the victims share the frame.
  const summonIdOf = (pr) => { const id = pr?.id || pr?.ability?.id; return id && SUMMON_IDS.includes(id) ? id : null; };
  // before the cinematic fades the HUD the shot keeps clear of the live windows; once it has, the faded rect
  const summonRect = () => (cine.e ? camera.freeRect(state.cineChrome || []) : camera.freeRect());
  const summonShot = (pr) => {
    const id = summonIdOf(pr); if (!id || !pr.actor) return null;
    const tt = pr.tile || pr.target; if (!tt) return null;
    const ab = pr.ability || ABILITIES[id]; if (!ab) return null;
    const at = battle.worldPos(tt.x, tt.z, 0), src = battle.worldPos(pr.actor.x, pr.actor.z, 0);
    const vs = (ab.area || 0) >= 1 ? summonVictims(battle, ab, pr.actor, at) : [];
    const k = `${id}|${tt.x},${tt.z}|${pr.actor.x},${pr.actor.z}|${camera.targetYaw.toFixed(3)}|${camera.targetPitch.toFixed(3)}|${vs.map((v) => v.u.id).join(',')}`;
    if (!state.sumShot || state.sumShot.k !== k) {
      const ground = ctx.vfx?._cineGround ? (a, r, b, o, d) => ctx.vfx._cineGround(a, r, b, o, d) : null;
      const plan = summonPlan(id, at, src, vs, ground, camera.targetYaw, camera.targetPitch); if (!plan) return null;
      const must = []; const list = vs.length ? vs : [{ u: pr.target && pr.target.id ? pr.target : null, p: at }];
      for (const v of list) { const h = (v.u && battle.spriteOf(v.u)?.heightUnits) || 1.2; must.push([v.p.x, v.p.y, v.p.z], [v.p.x, v.p.y + h + 0.15, v.p.z]); }
      must.push(...plan.pts);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const q of must) for (let i = 0; i < 3; i++) { if (q[i] < lo[i]) lo[i] = q[i]; if (q[i] > hi[i]) hi[i] = q[i]; }
      state.sumShot = { k, key: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], must, plan };
    }
    const S = state.sumShot; return { key: S.key, must: S.must, opt: [], at: [0.5, 0.5], rect: summonRect(), pad: 0.03, summon: id };
  };
  const stagePts = (pr) => {
    { const ss = summonShot(pr); if (ss) return ss; }
    // SPECT15 TWO-BEAT: a pair too far apart for one frame (a 6-tile Charge Shot, a long Fire) opens on the ACTOR for
    // the wind-up, and cuts to the target stage on the release ('impact'); review15 saw 'Effect: Chargeshot' with the
    // gunner off-screen and KOs land off-frame.
    if (pr.beat === 'actor' && pr.actor) {
      const A = battle.worldPos(pr.actor.x, pr.actor.z, 0); const ah = (battle.spriteOf(pr.actor)?.heightUnits) || 1.2;
      return { key: [A.x, A.y + Math.min(0.75, ah * 0.55), A.z], must: [[A.x, A.y, A.z], [A.x, A.y + ah + 0.3, A.z]], opt: [], at: STAGE_AT };
    }
    const tu = pr.target && pr.target.id ? pr.target : null;
    const tt = pr.tile || (tu ? { x: tu.x, z: tu.z } : null); if (!tt) return null;
    const T = battle.worldPos(tt.x, tt.z, 0);
    const ts = tu ? battle.spriteOf(tu) : null; const h = (ts && ts.heightUnits) || 1.2;
    const ab = pr.ability || {}; const top = Math.max(h + 0.15, FX_TOP[ab.vfx] || 2.2);
    const must = [[T.x, T.y, T.z], [T.x, T.y + top, T.z]];
    // SPECT15: a cinematic-tier spell is framed on its VICTIM (the set piece spans the frame anyway); holding every
    // tile of an A2/A3 area in frame pulled the lens out until the spell was a speck at the board edge
    const a = cineTier(ab, pr.id || ab.id) === 3 ? 0 : pr.area != null ? pr.area : (ab.area || 0);
    if (a > 0) for (const [dx, dz] of [[a, 0], [-a, 0], [0, a], [0, -a]]) {
      const x = clamp(tt.x + dx, 0, MAP.w - 1), z = clamp(tt.z + dz, 0, MAP.d - 1); const tl = MAP.at(x, z);   // tips past the board edge clamp onto it
      const y = tl && !tl.void ? tl.h * HSTEP : T.y; const q = battle.worldPos(tt.x, tt.z, 0);
      must.push([q.x + (x - tt.x) + Math.sign(dx) * 0.5, Math.min(y, T.y + 3), q.z + (z - tt.z) + Math.sign(dz) * 0.5]);
    }
    const opt = [];
    const ac = pr.actor;
    if (ac && ac !== tu && !ab.self && (ac.x !== tt.x || ac.z !== tt.z)) {
      const A = battle.worldPos(ac.x, ac.z, 0); const as = battle.spriteOf(ac); const ah = (as && as.heightUnits) || 1.2;
      opt.push([A.x, A.y, A.z], [A.x, A.y + ah, A.z]);
    }
    // R18: attacker AND target together whenever the pair fits a moderately wider lens (abilityStart decides withActor)
    if (pr.withActor && opt.length) return { key: [T.x, T.y + Math.min(0.75, h * 0.55), T.z], must: must.concat(opt), opt: [], at: STAGE_AT };
    return { key: [T.x, T.y + Math.min(0.75, h * 0.55), T.z], must, opt, at: STAGE_AT };
  };
  // R18: a summon creature still on stage (entering, gesturing, exiting) holds the ability shot -- the lens used to pull
  // back to the caster on the effect's hero beat while the creature was still performing (measured on aurelmont_nave)
  const creatureOn = () => !!ctx.vfx?._creatures?.some((c) => !c.dead);
  const stageActive = () => { const pr = state.pair; return !!(pr && pr.actor && pr.actor.hp > 0 && (locked() || pr.live)); };
  // SPECT15 DEPLOY STAGE (review15 P1: the 1920x1080 deploy frame cut the company off the left edge). While the
  // campaign's deployment is up and the aim is on the company's side of the board, the frame is about the WHOLE
  // company + its deploy zone: key = the company's centroid, must = every ally's feet and head and every deploy
  // tile, opt = the two nearest foes. The lens zooms out just enough for the must set to fit the HUD-free rect
  // (which now also clears the side-docked roster panel). Tab-inspecting a foe (aim far from the zone) falls back
  // to the normal subject framing.
  const deployStage = () => {
    if (typeof window === 'undefined' || !window.__CAMPAIGN__?.deploying) return null;
    const allies = battle.units.filter((u) => u.team === 'A' && !u.removed && u.hp > 0); if (!allies.length) return null;
    const ov = ctx.overlay; const moveMat = ov?.mats?.move?.a; const must = [], zone = [];
    if (ov && moveMat) for (const k of ov.group.children) if (k.isMesh && k.material === moveMat && k.renderOrder === 3) zone.push([k.position.x, k.position.y, k.position.z]);
    let cx = 0, cy = 0, cz = 0;
    for (const u of allies) { const p = pos(u, 0); const h = (battle.spriteOf(u)?.heightUnits) || 1.3; must.push([p.x, p.y, p.z], [p.x, p.y + h, p.z]); cx += p.x; cy += p.y; cz += p.z; }
    for (const z of zone) must.push(z);
    const n = allies.length; const key = [cx / n, cy / n + 0.5, cz / n];
    const aim = camera._aim; if (aim) { let near = false; for (const q of must) if (Math.hypot(q[0] - aim.x, q[2] - aim.z) < 2.6) { near = true; break; } if (!near) return null; }
    const foes = battle.units.filter((u) => u.team !== 'A' && !u.removed && u.hp > 0).map((u) => pos(u, 0)).sort((a, b) => Math.hypot(a.x - key[0], a.z - key[2]) - Math.hypot(b.x - key[0], b.z - key[2])).slice(0, 2);
    return { key, must, opt: foes.map((p) => [p.x, p.y, p.z]), at: [0.5, 0.5], deploy: true };
  };
  // ---- R18 AIM CAM (review17 P1 / wow #4: every live aim frame lost the blind A/B -- the target at the frame edge or
  // under the target card, because nothing framed the CURSOR: the solve kept the actor in its band and let the cursor
  // drift) ----------------------------------------------------------------------------------------------------------
  // While the player picks a tile (ability aim: red field; move: blue field) the frame is about the actor AND the cursor
  // tile (with whoever stands on it): both are held inside the HUD-free rect (below the turn strip, above the unit card
  // and the forecast/target card, which the free rect already excludes), the lens pushes in when they are close (an
  // adjacent melee aim fills the frame) and pulls out when they are not; when they cannot share a frame the CURSOR
  // wins and the actor joins only if it fits. Re-solved on every cursor step (springs ease it). Read-only on the
  // player/overlay: player.pick (a tile pick is open), overlay.cursorTile, the target field's material.
  const AIM_IN = 1.36, AIM_OUT = 0.8;   // x zoomBase: the push-in cap for a close pair; the widest the aim may pull out
  const aimNow = () => {
    const pl = ctx.player, ov = ctx.overlay;
    if (!pl || !pl.pick || !pl.busyTurn || !ov || !ov.cursor || !ov.cursor.visible || !ov.cursorTile) return null;
    if (typeof window !== 'undefined' && window.__CAMPAIGN__?.deploying) return null;
    const actor = pl.busyTurn; if (!actor || actor.hp <= 0 || actor.removed) return null;
    const tm = ov.mats?.target?.a; let aim = false;
    if (tm) for (const k of ov.group.children) if (k.material === tm) { aim = true; break; }
    return { actor, x: ov.cursorTile.x, z: ov.cursorTile.z, aim };
  };
  const aimStage = () => (state.aimShot && aimNow() ? state.aimShot : null);
  const buildAim = (a) => {
    const T = battle.worldPos(a.x, a.z, 0); const tu = unitAt({ x: a.x, z: a.z });
    const th = tu && !tu.removed ? ((battle.spriteOf(tu)?.heightUnits) || 1.2) + 0.15 : 0.9;
    const A = pos(a.actor, 0); const ah = ((battle.spriteOf(a.actor)?.heightUnits) || 1.2) + 0.15;
    const tP = [[T.x, T.y, T.z], [T.x, T.y + th, T.z]], aP = [[A.x, A.y, A.z], [A.x, A.y + ah, A.z]];
    const self = a.x === a.actor.x && a.z === a.actor.z;
    const both = self ? tP : tP.concat(aP);
    const zAll = camera.zoomToContain(both, 0.06);
    const zb = state.zoomBase; const zMax = a.aim && tu && !self ? zb * AIM_IN : zb;
    const fits = zAll >= zb * AIM_OUT;
    let z = fits ? Math.min(zAll, zMax) : Math.min(zb, camera.zoomToContain(tP, 0.06));
    z = clamp(z, zb * AIM_OUT, zMax);
    const src = fits ? both : tP;
    const key = [0, 0, 0]; for (const q of src) for (let i = 0; i < 3; i++) key[i] += q[i] / src.length;
    return { shot: { key, must: src, opt: fits ? [] : aP, at: [0.5, 0.5], aim: true }, z };
  };
  let aimSig = '', aimIdle = 0;
  camera.addTicker((dt) => {
    if (locked()) return;
    const a = stageActive() ? null : aimNow();
    if (!a) {
      if (state.aimShot) {
        // the pick closed: a confirm is followed by abilityStart (which owns the lens); a cancel returns to the actor
        aimIdle += dt; if (aimIdle < 0.3 && !stageActive()) return;
        state.aimShot = null; aimSig = '';
        if (!stageActive() && !state.follow) { const u = ctx.player?.busyTurn || battle.active; if (u && u.hp > 0) { camera.setZoom(state.zoomBase); camera.lookAt(mark(pos(u))); } }
      }
      return;
    }
    aimIdle = 0;
    const sig = `${a.actor.id}|${a.x},${a.z}|${a.aim}|${camera.yawIndex}|${camera.pitchMode}|${chromeKey}`;
    if (sig === aimSig) return; aimSig = sig;
    const { shot, z } = buildAim(a);
    // dead zone: a cursor step that leaves everything the shot must hold comfortably inside the free rect at the lens the
    // player is already looking through does not move the lens (a mouse-hover aim would otherwise chase its own cursor)
    if (state.aimShot && Math.abs(z - camera.targetZoom) <= camera.targetZoom * 0.04) {
      const R = camera.freeRect(); const m = 0.07; let inside = true;
      for (const q of shot.must) { const f = camera.frameFraction(new THREE.Vector3(q[0], q[1], q[2])); if (f.x < R[0] + m || f.x > R[2] - m || f.y < R[1] + m || f.y > R[3] - m) { inside = false; break; } }
      if (inside) return;
    }
    state.aimShot = shot; stopFollow();
    if (Math.abs(z - camera.targetZoom) > camera.targetZoom * 0.04) camera.setZoom(z);
    camera.lookAt(new THREE.Vector3(shot.key[0], shot.key[1], shot.key[2]));
  });
  const ownStageFn = () => (stageActive() ? stagePts(state.pair) : aimStage() || deployStage());
  camera.setStageFn?.(ownStageFn);
  // R18 SCENE TWO-SHOT (review17 P3 / wow #1): a staged scene publishes { key, must: speaker, opt: listener } through the
  // stage hook; the listener used to join only if it happened to fit at the speaker's zoom. When the pair fits at no
  // less than 0.7x that zoom, the lens eases out to hold both (the genre's over-the-shoulder two-shot); otherwise the speaker
  // alone. Watches whatever shot a foreign hook (the scene player) returns, so it needs no call from the scene.
  let sceneSeen = null;
  camera.addTicker(() => {
    if (locked() || !camera._stageFn || camera._stageFn === ownStageFn) { sceneSeen = null; return; }
    let sh = null; try { sh = camera._stageFn(); } catch { sh = null; }
    if (!sh || sh === sceneSeen || sh.deploy || sh.aim || sh.summon) { if (!sh) sceneSeen = null; return; }
    sceneSeen = sh;
    if (sh.opt && sh.opt.length && sh.key) {
      const zAll = camera.zoomToContain([sh.key, ...(sh.must || []), ...sh.opt], 0.05);
      if (zAll < camera.targetZoom - 1e-3 && zAll >= twoShotMin(camera)) { camera.setZoom(zAll); if (camera._aim) camera.lookAt(camera._aim.clone()); }
    }
  });
  let depWas = false;
  camera.addTicker(() => {
    const st = deployStage(); const on = !!st;
    if (on && !locked()) { const z = camera.zoomToContain([st.key, ...st.must], 0.04); if (Number.isFinite(z) && z < camera.targetZoom - 1e-3) camera.setZoom(Math.max(z, 0.92)); if (!depWas && camera._aim) camera.lookAt(camera._aim.clone()); }
    depWas = on;
  });
  // zoom for a stage: pull in for one target, out for an area, never so close the target's effect crops,
  // and bring the caster in when it costs at most a modest pull-out from the preferred lens
  const stageZoom = (pr, zPref) => {
    const st = stagePts(pr); if (!st || !camera.zoomToContain) return zPref;
    const zMust = camera.zoomToContain([st.key, ...st.must], st.pad != null ? st.pad : 0.05, st.rect || null);
    if (st.summon) return Math.min(zPref, zMust, state.zoomBase * 1.5);   // R18: the whole summon shot, never tighter than it fits
    const zAll = st.opt.length ? camera.zoomToContain([st.key, ...st.must, ...st.opt]) : Infinity;
    let z = Math.min(zPref, zMust);
    if (zAll < z && zAll >= Math.min(z, state.zoomBase) * 0.82) z = zAll;
    return z;
  };

  state.stageFit = () => { if (!stageActive() || state.cinePushed) return;   // SPECT15: a cinematic push-in owns the lens until release
    const z = stageZoom(state.pair, camera.targetZoom); if (z < camera.targetZoom - 1e-3) camera.setZoom(z); };

  camera.setSubjectPoints(() => {
    const out = [];
    for (const u of battle.units) {
      if (u.hp <= 0) continue;
      const p = battle.worldPos(u.x, u.z, 0);
      const h = (battle.spriteOf(u) && battle.spriteOf(u).heightUnits) || 1.5;
      out.push([p.x, p.y, p.z], [p.x, p.y + h, p.z]);
    }
    return out;
  });

  // SNAP POLICY — determinism first. A caller that NAMES a focus means it: main.js passes a scenario's aim through
  // applyPreset (`scenarioFocus`) precisely so a preset stops clobbering it. Round 3 overrode that aim whenever
  // targetZoom >= SUBJECT_ZOOM with a subject solve built from state.subject / battle.active / a 380 ms pull-out
  // timer — all of which depend on WHEN the preset happened to run, so two identical `node tools/shot.mjs` runs
  // produced a 'close' frame translated by 27 x 14 px. Now: a named aim that already frames a unit is left alone,
  // and the fallback (a hardcoded preset point sitting on empty ground) is a pure function of that point and the
  // unit positions. Same command, same frame, whatever the battle was doing.
  //
  // ROUND 5, both gates removed / re-targeted:
  //  - the `targetZoom < SUBJECT_ZOOM` early-return left wide/high/rot1 un-anchored, so the diorama presets
  //    framed whoever happened to stand at the map centre (or nobody): the actor read as dead-centre or sat
  //    behind the status card. The anchor is now the actor at EVERY zoom, and its feet are clamped into the
  //    hard [0.55, 0.70] band at every preset (bar 9: lower-middle third at all four rotations + the tilt).
  //  - `unitNear(camera.targetFocus)` tested the CLAMPED focus while the anchor resolves at the RAW aim; when
  //    the frame-bounds clamp had walked focus away from the preset point, the early-return fired with an
  //    anchor of null (measured: 'mid' anchored nothing). It now tests the condition the anchor actually
  //    depends on — an existing subject.
  const unitNear = (p) => battle.units.some((u) => u.hp > 0 && pos(u).distanceTo(p) <= NEAR);
  camera.onSnap((info) => {
    syncChrome((typeof window !== 'undefined' && window.innerWidth) || 1100, (typeof window !== 'undefined' && window.innerHeight) || 620);
    // R18 (review17 P3): a staged scene that CUTS (stage/player.js camTo(..., immediate) -> snap) is not a capture. The
    // capture lock pinned the lens from the intro's first cut until a key reached this module, and the scene player
    // swallows its keys: Ossian Vey delivered four lines off-screen while the lens held the company (measured: the lens
    // never moved after the prelude). While a scene has hooked the stage provider, a snap is a cut and never locks.
    if (camera._stageFn && camera._stageFn !== ownStageFn) { clearTimer(); stopFollow(); return; }
    clearTimer(); stopFollow(); state.locked = true; state.lockedAt = performance.now(); state.lock = null; if (ctx.vfx) ctx.vfx._capture = true;
    // CAPTURE AID (R7): a preset snapped while an ability pair is recorded (scenario=fire / melee / auto) turns to
    // the nearest yaw stop from which the TARGET is not behind a roof or cliff -- a pure function of the preset's
    // yaw and the unit/prop positions, so the same command still gives the same frame. No pair (menu, plain
    // presets) => the preset's own yaw, untouched.
    if (YAW_AID && state.pair) {
      const k = bestYawOffset(state.pair.actor, state.pair.target);
      if (k) camera.applyView({ yawIndex: camera.yawIndex + k });
    }
    if (state.pair && !state.pair.live) ctx.vfx?.captureHold?.(true);
    // R12: a staged capture keeps the preset's lens unless the stage (an area spell, the effect's height) does
    // not fit the HUD-free rectangle at it, then it pulls out just enough.
    if (stageActive()) { const z = stageZoom(state.pair, camera.targetZoom); if (z < camera.targetZoom - 1e-3) { camera.setZoom(z); camera.zoom = camera.targetZoom; } }
    const subjectExists = !!activeUnit() || unitNear(camera._aim || camera.targetFocus);
    if (info && info.focusExplicit && subjectExists) return;   // the caller's aim already frames (or IS) someone
    const s = nearestUnit(camera.targetFocus);
    if (s) camera.lookAt(s);
  });

  battle.on('turnStart', ({ unit }) => { if (!locked()) state.pair = null; if (locked()) return; clearTimer(); stopFollow(); state.locked = false; camera.setZoom(state.zoomBase); camera.lookAt(mark(pos(unit))); });
  battle.on('moveStart', ({ unit }) => {
    if (locked()) return;
    stopFollow(); state.locked = false; camera.setZoom(state.zoomBase);
    state.follow = camera.addTicker(() => camera.lookAt(spritePos(unit), false, 'soft'));
  });
  battle.on('moveEnd', ({ unit }) => { if (locked()) return; stopFollow(); camera.lookAt(mark(pos(unit))); });
  battle.on('abilityStart', ({ unit, ability, target, reaction, id }) => {
    const tu = ability?.self ? unit : unitAt(target) || unit;
    const tile = ability?.self ? { x: unit.x, z: unit.z } : target ? { x: target.x, z: target.z } : { x: unit.x, z: unit.z };
    if (!reaction || !state.pair) state.pair = { actor: unit, target: tu, tile, ability, id, live: !locked() };
    state.aimShot = null;
    if (locked()) {
      // R18: a capture lens (spell:<summon> scenarios) snapped BEFORE the summon was cast, so it framed the caster/target
      // only; the summon shot is a pure function of the pair and the lens yaw, so the pinned lens is re-solved to it
      // (still deterministic: same command, same frame)
      // R20 (review19 P3): the old lock is dropped BEFORE the re-solve. cut() runs update(0), whose lock ticker re-asserted
      // the stale pinned lens (the caster) over the summon shot and then re-captured it: Pyrelord rose over empty pews with
      // its victim at projected y -150 in every spell:<summon> capture made on a running battle.
      if (!reaction && summonIdOf(state.pair)) {
        const st = stagePts(state.pair);
        if (st) { state.lock = null; const z = stageZoom(state.pair, state.zoomBase * 1.12); if (Number.isFinite(z)) camera.setZoom(z); camera.lookAt(new THREE.Vector3(st.key[0], st.key[1], st.key[2])); state.lock = null; camera.cut(); }
      }
      return;
    }
    clearTimer(); stopFollow(); state.locked = false;
    // turn to a stop that shows the target (eased by the yaw spring); remembered so the pull-out turns back
    // OPTIONS hook: Gameplay > Camera Auto-Rotate (prefs().autoRotate) gates the turn below
    if (YAW_AID && prefs().autoRotate && !reaction && !state.yawOff) { const k = bestYawOffset(unit, tu); if (k) { camera.rotate(k); state.yawOff = k; } }
    const a = pos(unit), t = target ? battle.worldPos(target.x, target.z, 0.2) : a; const dist = a.distanceTo(t);
    const ranged = ability?.ranged || ability?.kind === 'mag' || dist > 2.5;
    // R12: single target pulls in, an area spell pulls OUT until every tile of it (and the caster, when it is
    // close enough to cost little) fits the HUD-free rectangle; the stage solve in camera.js places it.
    const area = ability?.area || 0;
    const zPref = cineTier(ability) === 3 ? state.zoomBase * 1.12 : state.zoomBase * (area >= 2 ? 0.95 : area === 1 ? (ranged ? 1.12 : PULL_MELEE) : ranged ? 1.24 : PULL_MELEE);
    let zS = stageZoom(state.pair, zPref);
    { const st = stagePts(state.pair); const zAll = st && st.opt.length && camera.zoomToContain ? camera.zoomToContain([st.key, ...st.must, ...st.opt]) : Infinity;
      if (!reaction && st && st.opt.length && zS <= zAll + 1e-3) state.pair.withActor = true;   // the lens already holds both
      else if (!reaction && st && st.opt.length && zS > zAll + 1e-3) {
        // R18 (review17 P1): the attacker stays in the shot with its target whenever the pair fits a lens no wider than
        // WITH_ACTOR x the play lens (measured live: two-beat cuts and a caster left under the objective plate were most
        // of the off-frame samples); only a pair farther apart than that opens on the actor and cuts on the release
        if (zAll >= Math.max(state.zoomBase * WITH_ACTOR, 1.0)) { state.pair.withActor = true; zS = zAll; }
        else if (dist > 3.5) state.pair.beat = 'actor';
      } }
    camera.setZoom(zS); camera.lookAt(mark(state.pair.beat === 'actor' ? a : t));
    // Watchdog: if abilityEnd never arrives (a starved frame loop, a swallowed event), the pull still
    // ends — worst case the lens settles ~1.3 s early, which reads as part of the pull-out. abilityEnd
    // below clears this timer and re-arms the normal 380 ms one, so the common path is unchanged.
    // R18: 2.6 s -> 4.5 s and held while the effect is still before its hero beat or a summon creature is on stage (on a
    // slow frame loop the watchdog fired mid-ability: measured live, the lens left a target that was still being hit)
    { let wd = 4.5 / (battle.speed || 1), cap = 9; const fxBusy = () => { const fx = ctx.vfx; return creatureOn() || !!(fx && fx._hero != null && fx.time < fx._hero + 0.3); };
      const stop = camera.addTicker((dt) => { wd -= dt; cap -= dt; if (wd > 0 || (fxBusy() && cap > 0)) return; stop(); if (state.pullTimer === stop) state.pullTimer = null; if (state.pair) state.pair.live = false; camera.setZoom(state.zoomBase); if (state.yawOff) { camera.rotate(-state.yawOff); state.yawOff = 0; } camera.lookAt(camera._aim || pos(unit)); }); state.pullTimer = stop; }
  });
  battle.on('impact', () => { const pr = state.pair; if (!pr || pr.beat !== 'actor') return; pr.beat = 'target'; if (locked() || !pr.live) return; const tt = pr.tile || pr.target; if (tt) camera.lookAt(mark(battle.worldPos(tt.x, tt.z, 0.2))); });
  // Spell/landing shake comes from the effect's own beat (detonation, thunder, quake, jump landing, KO thud) via
  // vfx.onShake, not from 'impact', which fires ~0.3 s before a fireball actually lands.
  ctx.vfx?.onShake?.(({ amp }) => { if (locked()) return; camera.shake = Math.max(camera.shake, Math.min(0.4, amp)); });
  battle.on('damage', ({ victim, amount }) => { if (locked()) return; const frac = victim?.maxHp ? amount / victim.maxHp : 0; if (frac >= 0.22) camera.shake = Math.max(camera.shake, 0.18 + Math.min(0.22, frac * 0.35)); });
  // R18: a KO during an ability holds the shot ~1 s longer (the victim's fall was cut by the pull-out: measured live, the
  // KO'd unit left the frame while it was still going down)
  battle.on('ko', () => { if (locked()) return; camera.shake = Math.max(camera.shake, 0.34); if (stageActive()) state.koHold = 1.0; });
  battle.on('abilityEnd', ({ unit, reaction }) => {
    clearTimer(); if (locked()) return;                        // a preset owns the lens right now: do not re-zoom it
    // R12: the pull-out waits for the effect's own aftermath (hero beat + 0.5 s on the EFFECT clock), not just a
    // wall-clock 380 ms: abilityEnd lands ~0.5 s after impact, so the lens used to leave while the Fire was still
    // at full burn. Counted in camera dt, so it stays in step with the effect however slow the frame loop is.
    const fx = ctx.vfx; const tail = fx && fx._hero != null ? Math.max(0, fx._hero + 0.5 - fx.time) : 0;
    let left = Math.max(0.38 / (battle.speed || 1), tail), cap = 6;
    const stop = camera.addTicker((dt) => {
      left -= dt; cap -= dt; state.koHold = Math.max(0, (state.koHold || 0) - dt); if (left > 0 || ((creatureOn() || state.koHold > 0) && cap > 0)) return; stop(); if (state.pullTimer === stop) state.pullTimer = null;
      if (state.pair) state.pair.live = false;
      camera.setZoom(state.zoomBase); if (state.yawOff) { camera.rotate(-state.yawOff); state.yawOff = 0; } camera.lookAt(mark(pos(unit)));
    });
    state.pullTimer = stop;
  });
  battle.on('victory', () => { if (locked()) return; clearTimer(); stopFollow(); state.subject = null; camera.setZoom(1.0); camera.lookAt(camera.fitCenter()); });
  // ---- SPECT15 CINEMATIC TIER: camera push-in + grade shift around a big spell (vfx/cine.js decides the tier) ----
  // vfx.onCine 'start' arrives from play() (the gather beat begins), 'impact' on the hit. The grade timeline runs on
  // the EFFECT clock (vfx.time), so a capture held at the effect's hero beat shows exactly that beat's grade, and a
  // live moment stays in step with the effect however slow the frame loop is. Any key skips the rest of the moment.
  const cine = { e: null, skipAt: null, pushed: false };
  const gradeU = () => ctx.pipeline?.passes?.grade?.uniforms || null;
  let gradeLive = false;
  ctx.vfx?.onCine?.((e) => {
    if (e.phase === 'start') {
      cine.e = e; cine.skipAt = null; cine.pushed = false; state.cinePushed = false;
      // push in on the victim (the stage keeps it inside the HUD-free rect); an area that no longer fits crops
      // at the edges, the victim never does -- the moment is about the target, the field comes back at release
      const sst = !locked() && stageActive() && summonIdOf(state.pair) ? stagePts(state.pair) : null;
      if (sst) {
        // R18: a summon's moment is the creature AND its victims: fit that set in the HUD-faded rect (in or out)
        const z = Math.min(camera.zoomToContain([sst.key, ...sst.must], sst.pad, sst.rect), state.zoomBase * 1.5);
        if (Number.isFinite(z) && Math.abs(z - camera.targetZoom) > 1e-3) { cine.pushed = z > camera.targetZoom; state.cinePushed = cine.pushed; camera.setZoom(z); camera.lookAt(new THREE.Vector3(sst.key[0], sst.key[1], sst.key[2])); }
      } else if (!locked() && e.full) {
        const tu = unitAt({ x: Math.floor(e.at.x), z: Math.floor(e.at.z) }); const h = (tu && battle.spriteOf(tu)?.heightUnits) || 1.3;
        let zFit = camera.zoomToContain([[e.at.x, e.at.y, e.at.z], [e.at.x, e.at.y + Math.max(h + 0.4, 2.2), e.at.z]], 0.08);
        if (stageActive() && state.pair.withActor) { const st = stagePts(state.pair); if (st) zFit = Math.min(zFit, camera.zoomToContain([st.key, ...st.must], 0.05)); }
        const z = Math.min(camera.targetZoom * 1.24, state.zoomBase * 1.5, zFit);
        if (z > camera.targetZoom + 1e-3) { camera.setZoom(z); cine.pushed = true; state.cinePushed = true; }
      }
    }
  });
  if (typeof window !== 'undefined') window.addEventListener('keydown', () => { if (cine.e && cine.skipAt == null && ctx.vfx) cine.skipAt = ctx.vfx.time; }, { capture: true });
  const cineTick = () => {
    const U0 = gradeU(); const fx = ctx.vfx; if (!fx) return;
    const U = U0 && U0.spellAmt ? U0 : { spellAmt: { value: 0 }, spellFlash: { value: 0 }, spellTint: { value: new THREE.Color() }, spellCenter: { value: new THREE.Vector2() }, spellRadius: { value: new THREE.Vector2() } };   // post=off: timeline only
    const e = cine.e;
    if (!e) { if (gradeLive) { U.spellAmt.value = 0; U.spellFlash.value = 0; gradeLive = false; } return; }
    const ks = cineSpeedScale(e.speed); const t = fx.time - e.t0, tImp = e.d, tEnd = tImp + (CINE_HOLD + CINE_RELEASE) * ks + 0.1;
    let amt; const rampUp = Math.max(0.08, Math.min(0.22, e.lead + 0.05));
    if (t < rampUp) amt = t / rampUp; else if (t < tImp + CINE_HOLD * ks) amt = 1; else amt = Math.max(0, 1 - (t - tImp - CINE_HOLD * ks) / (CINE_RELEASE * ks));
    if (cine.skipAt != null) amt *= Math.max(0, 1 - (fx.time - cine.skipAt) / 0.12);
    let flash = t >= tImp ? Math.max(0, 1 - (t - tImp) / (0.3 * Math.max(0.6, ks))) : 0; flash *= flashScale();
    if (cine.skipAt != null && fx.time > cine.skipAt) flash = 0;
    if (t > tEnd || t < -0.05 || (cine.skipAt != null && fx.time - cine.skipAt > 0.15)) {
      cine.e = null; state.cinePushed = false; U.spellAmt.value = 0; U.spellFlash.value = 0; gradeLive = false; return;
    }
    const tint = CINE_TINT[e.look] || CINE_TINT.holy;
    U.spellTint.value.setRGB(tint[0], tint[1], tint[2]);
    U.spellAmt.value = amt * (e.full ? 0.8 : 0.5); U.spellFlash.value = flash;
    // keep-lit ellipse on the victim's body, from the lens state this frame is drawn with
    const tu = unitAt({ x: Math.floor(e.at.x), z: Math.floor(e.at.z) }); const h = (tu && battle.spriteOf(tu)?.heightUnits) || 1.3;
    const f0 = camera.frameFraction(new THREE.Vector3(e.at.x, e.at.y, e.at.z), false), f1 = camera.frameFraction(new THREE.Vector3(e.at.x, e.at.y + h, e.at.z), false);
    const ry = clamp(Math.abs(f0.y - f1.y) * 0.95, 0.06, 0.4); const asp = camera.aspect || 1.77;
    U.spellCenter.value.set((f0.x + f1.x) / 2, 1 - (f0.y + f1.y) / 2); U.spellRadius.value.set(ry * 0.8 / asp * 1.6, ry);
    gradeLive = true;
  };
  camera.addTicker(cineTick);

  const api = {
    state, unlock: release, cine, setGameplayZoom(z) { state.zoomBase = z; camera.playZoom = z; camera.setZoom(z); },
    // Capture aid for main.js scenarios (integrator): name the pair BEFORE the first snap so even the very first
    // preset frames the target clear of roofs. focusPair(actor, target) records the pair; bestYawOffset(a, t)
    // is the pure yaw pick (stops relative to the current yawIndex); hiddenFrac(u, yaw, pitch) the probe.
    focusPair(actor, target, ability = null) { const tu = target && target.id ? target : unitAt(target) || actor; state.pair = { actor, target: tu, tile: target && target.id == null && target.x != null ? { x: target.x, z: target.z } : { x: tu.x, z: tu.z }, ability, live: false }; },
    stageRect: () => camera.freeRect?.(),
    // R12 capture aid for spell scenarios (ice / bolt / cure ...): a deterministic caster/target pair for an ability
    // (first living A unit; nearest enemy -- or ally for heal/buff/raise -- to `want` tiles away). Pure function of
    // the unit positions. Returns { caster, target } or null.
    pickPair(ab, want = 4) {
      const alive = battle.units.filter((u) => u.hp > 0); const As = alive.filter((u) => u.team === 'A'), Bs = alive.filter((u) => u.team === 'B');
      const ally = ab && (ab.ally || ab.kind === 'heal' || ab.kind === 'buff' || ab.kind === 'raise');
      let best = null, bs = Infinity;
      for (const c of As) for (const t of ally ? As : Bs) { if (t === c) continue; const s = Math.abs(Math.abs(c.x - t.x) + Math.abs(c.z - t.z) - want) + (c.x + c.z) * 0.001; if (s < bs) { bs = s; best = { caster: c, target: t }; } }
      return best;
    },
    clearPair() { state.pair = null; },
    bestYawOffset, hiddenFrac, ABILITIES,
  };
  if (typeof window !== 'undefined') window.__CINE__ = api;   // so a determinism probe can see/poke the drama state
  return api;
}
