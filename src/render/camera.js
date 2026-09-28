import * as THREE from 'three';
import { VIEW_TILES, HSTEP } from '../core/config.js';
import { shakeScale } from '../ui/prefs.js';   // OPTIONS hook (screen shake scale)
// the genre's dimetric "long lens": an orthographic camera at 30° (the exact 2:1 diamond) or 48° (overhead tilt),
// EIGHT yaw stops at 45° + k·45°. Parallel edges stay parallel; nothing converges.
// The EVEN stops (45/135/225/315) are the genre's four dimetric corners — the tile grid runs diagonally on screen and the
// terraces read as a diorama. The ODD stops (0/90/180/270) look straight down a row of tiles: the grid becomes
// screen-axis-aligned, which is flatter (see the round-5 capture in shots/camera/) but is what the 8-way request
// asks for, and it is the only orientation in which the arrow keys map EXACTLY onto the screen (screenToTile).
//
// Feel:
//  - yaw is an under-damped spring (fast turn, ~4% overshoot, settles in ~0.5 s) with a tiny pull-out during the turn
//  - pitch / zoom / focus are critically-damped springs (smooth start AND smooth stop — no exponential "snap-then-crawl")
//  - the SUBJECT (the acting unit, or whoever the aim names) has its FEET inside the R6 framing band
//    [SUBJ_BAND_LO, SUBJ_BAND_HI] = 0.55..0.70 at every preset and every (map, yaw, tilt) probe view —
//    a HARD band, clamped after cast containment (the round-5 interval/midpoint solve could overrule the
//    pin: measured on the r5 tree mid 1.06 / close 1.289 / high 0.92, i.e. the subject off the bottom or
//    pinned to the cards, and rot1 0.372 up in the third). Both the band and the chrome search below are
//    continuous functions of the scene, so there is no zoom or cast-span threshold at which the frame steps
//    (round-4 regression: the all-or-nothing containment slide moved the subject 0.223 of the frame between
//    zoom 1.700 and 1.725).
//  - HUD CHROME: the frame slides (never zooms) inside the band/overhang ranges to put the fewest unit hulls
//    behind the LIVE window rects cinematics measures (turn strip, announce, bottom cards, right rail —
//    whatever window the ui actually draws; no window, no keep-out); the subject's own overlap weighs 8x a
//    cast overlap. Round 5's menuLeft single-edge rule and the full-width y>0.726 band are subsumed by that
//    search (R6UI pinned #unit-card's box top to y450, so the box IS the ink it used to approximate).
//  - zoom 1 == "the diorama fills the frame width" (top and bottom crop, the way every the genre frame crops), solved from the real silhouette at every pitch, with the frame recipe's
//    reserved bands (CT strip on top, a sliver under the base) and *no* slack: the diorama runs off the left and
//    right edges and crops top and bottom, so the battlefield fills the frame instead of floating in black
//  - FRAME BOUNDS: sideways the visible frame is kept inside the diorama's screen-space silhouette — that
//    stops the lens panning off the map and keeps black out of the side corners. Vertically (round 6) the
//    subject's framing band wins over the silhouette bounds: above the skyline the grade paints the royal sky
//    plate the references carry (a reference capture), below the cut the overhang lands in the blue-black the skirt
//    already reads as (a reference capture), and the cost term picks the least-overhang point of the band. Where the
//    frame is larger than the diorama (zoom 1 fit) it is centred in the safe band and any leftover slack is
//    handed back to the subject, so frame.focusY still means something.
//  - dead-zone follow (lookAt(..., 'soft')) for units walking; 'travel' for turn changes
//  - HUD BANDS: the diorama is allowed to run under the windows (the genre does this in every frame), but the CAST is
//    not. frame.hudTop / frame.hudBottom are the bands the HUD actually paints over, so the containment band is
//    the band a unit can be SEEN in, not merely the viewport. They do not enter the zoom-1 fit, so reserving them
//    costs no board coverage.
//  - focus never sinks into terrain (height sampler) and never leaves the map
//  - shake is deterministic (noise on a clock, not Math.random) and is cleared by snap() so presets are repeatable
const DEG = THREE.MathUtils.degToRad;
export const PITCH = { low: DEG(30), high: DEG(48) };
const YAW0 = Math.PI / 4;
export const YAW_STOPS = 8;                       // 8-way rotate; 4 would restore the genre's dimetric-only set
const YAW_STEP = Math.PI * 2 / YAW_STOPS;
// Tile deltas for screen up/right/down/left, in rules.js's facing order (0=+z,1=+x,2=-z,3=-x).
export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
// Screen->tile for the cursor keys. Measured (not guessed): DIRS[j] lands at (stopYaw + j·90°) clockwise from
// screen-up, so the axis nearest "up" is j = dir - yawIndex/2, rounded. Two consequences:
//  - At an ODD (axis-aligned) stop yawIndex/2 is a half-integer and the rounding is EXACT: arrow-up walks the tile
//    row that runs straight up the screen. At an EVEN (dimetric) stop there is no exact answer and the tie is broken
//    the way the shipped yawIndex 0 always did — arrow-up takes the axis 45° CLOCKWISE of up (-z, up-and-right).
//  - The sign is NEGATIVE. Rising yaw rotates the board clockwise on screen, so the tile index must fall to follow
//    it; the pre-8-way `(dir + yawIndex) % 4` rose instead, which was a no-op at stops 0 and 2 (offset 0 and ±2 are
//    the same mod 4) and put arrow-up 180° wrong at the other two. Verified by projecting DIRS through
//    frameFraction() at every stop: at old yawIndex 1 arrow-up moved the cursor to screen 228°, i.e. down-left.
export function screenToTile(dir, yawIndex = 0) { return DIRS[(((dir - Math.round(yawIndex / 2)) % 4) + 4) % 4]; }
const ZOOM_MIN = 0.92, ZOOM_MAX = 3.6;   // 0.92 == the widest lens there is; at ZOOM_MIN the diorama still fills the frame width
// FIT_FILL: how much of the diorama's screen-space HEIGHT the zoom-1 frame must contain (CRITIQUE_R2 rank 6).
// < 1 means the top and bottom of the board are allowed to crop off-frame so the *width* fit can bind instead and
// the board runs edge to edge. Every the genre reference crops terrain off at least three edges; none floats a whole
// board in a gutter (a reference capture/_55/_03/_54/_19/_06). 0.60 makes the width term bind at BOTH pitch stops.
const FIT_FILL = 0.60;
// FIT_WIDE: the zoom at which the diorama's full WIDTH exactly fills the frame. At ZOOM_MIN the whole board is
// still reachable (nothing is ever unreachable); every preset above it crops the rim, which is what kills the
// gutter. Measured void (fraction of frame with no diorama in it) at yaw 0 / pitch 30, focus = map centre:
//   zoom 0.92 -> 35.6%   1.00 -> 27.5%   1.10 -> 19.8%   1.20 -> 15.2%   1.45 -> 14.8%   1.60 -> 9.8%
// so <20% needs the equivalent of zoom >= 1.1. Getting there means FIT_WIDE ~= 0.79, which also pulls `close`
// to 10.3 tiles and puts a 1.55-unit sprite at 27% of frame height — CRITIQUE_R2 integration bug 15 says that
// must wait until units halve the sprite-to-tile ratio. Drop FIT_WIDE to 0.79 the day that lands.
const FIT_WIDE = ZOOM_MIN;
// SUBJECT CONTAINMENT (round-3 regression: FIT_FILL's crop dropped the player's party off the BOTTOM edge at
// 'high' and 'mid'). The fill is what makes the board meet the side edges, so it stays; what changes is WHICH
// part of the board gets cropped: the frame SLIDES — never zooms, so the edge-to-edge fill is untouched — toward
// the band that holds the cast. The anchored subject's band is applied last, so containment can never break
// the promise the header makes about where the subject stands (round 6: containment is a PREFERENCE target
// inside the band now, and the chrome search arbitrates).
// Round 4 gated both of these on thresholds ("slide all the way or not at all", "give up if the cast is wider
// than SUBJECT_FIT"), which made the framing a STEP FUNCTION of zoom and of where the units happen to stand:
// measured on the shipped r4 build, the actor's foot y-fraction jumped 0.6404 -> 0.4167 between zoom 1.700 and
// 1.725 (138 px of a 620 px frame) and 0.6404 -> 0.4429 when one unit moved one tile. Both gates are gone. The
// slide is now a clamp, which is continuous everywhere, and the cast target degrades smoothly (when the cast is
// too tall for the band the target is the midpoint of the two impossible bounds, which equals the clamp exactly
// at the moment they cross).
const SUBJECT_SHIFT = 0.25;  // most of a containment slide a bandless frame may spend around its dioS position
const SUBJECT_PAD = 0.02;    // breathing room inside the safe band, so a contained unit never sits on the edge
// R6 FRAMING BAND (critic item 1): the subject's FEET land in [SUBJ_BAND_LO, SUBJ_BAND_HI] at EVERY preset
// and every probe view. Measured on the round-5 tree by shots/camera/_r5c_trace.mjs: mid 1.06, close 1.289
// (subject off the bottom edge), high 0.845/0.92, rot1 0.357/0.372 (upper third) — only wide was in band.
// 0.55..0.70 sits wholly inside the HUD-free zone: heads reach ~0.35 at the closest lens (clear of the
// turn strip), feet stop 0.026 above the bottom cards' ink at 0.726.
const SUBJ_BAND_LO = 0.55, SUBJ_BAND_HI = 0.70;
// R9 HORIZONTAL SUBJECT BAND (24-wide maps, twin_span / aqueduct_span): the vertical band above was hard, but the
// horizontal solve only ever tried to contain the WHOLE cast, and a cast spread over 24 tiles has its midpoint
// nowhere near the subject -- measured on twin_span melee 'mid': subject pair at x -0.06..-0.14, i.e. off the
// left edge, the frame full of empty bridge. The subject's feet now land in [SUBJ_X_LO, SUBJ_X_HI] at every
// preset, and like the vertical band it outranks the diorama side clamp (a little void at a map corner beats
// a frame without its subject).
const SUBJ_X_LO = 0.2, SUBJ_X_HI = 0.8;
// R9 FIELD KEEP-OUT: each highlighted move/target tile whose centre lands behind a HUD window costs this much in
// the chrome search (a unit hull costs 4, a subject hull 32), so the band slide lifts the acting unit's field
// clear of the bottom cards whenever the band allows it.
const FIELD_TILE_COST = 1.2;
// Top edge of where the bottom cards' ink sits, as a frame fraction (unit-card y450/620 at 1100x620 —
// R6UI height-pins the box so its top edge IS this line). Kept as documentation of the landing the
// cast-fit target aims for; the chrome keep-out itself is the live window rects in frame.chrome.
const HUD_SAFE_BOTTOM = 0.726;
// world units: half a sprite silhouette for the chrome-overlap hull (the packer's one-tile body budget).
const UNIT_HALF_W = 0.5;
const DIST = 40;
const SUBSTEP = 1 / 240;
const TURN_PULL = 0.055;                 // pull-out during a yaw turn, radians^-1 (0 at rest => presets are exact)
// critically/under damped spring step (semi-implicit Euler, substepped so any dt is stable)
function spring(x, v, target, omega, zeta, dt) {
  let t = dt;
  while (t > 0) { const h = Math.min(SUBSTEP, t); t -= h; const a = -2 * zeta * omega * v - omega * omega * (x - target); v += a * h; x += v * h; }
  return [x, v];
}
function noise(t, f, p) { return Math.sin(t * f + p) * 0.62 + Math.sin(t * f * 2.37 + p * 1.7) * 0.38; }
// monotone-chain convex hull of [x,y] points; the fit only ever needs the hull, so a 1600-point silhouette
// collapses to ~10 vertices and re-fitting every frame during a tilt is free.
function convexHull(pts) {
  if (pts.length < 4) return pts.slice();
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop(); return lo.concat(up);
}

export class BattleCamera {
  constructor(aspect) {
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -60, 140);
    this.yawIndex = 0; this.yaw = this.targetYaw = YAW0; this.yawVel = 0;
    this.pitchMode = 'low'; this.pitch = this.targetPitch = PITCH.low; this.pitchVel = 0;
    this.zoom = this.targetZoom = 1; this.zoomVel = 0;
    this.focus = new THREE.Vector3(8, 1, 8); this.targetFocus = this.focus.clone(); this.focusVel = new THREE.Vector3();
    this.shake = 0; this.shakeClock = 0; this.time = 0;
    // diorama bounds (world units); refined by cinematics.init from MAP. Default = a 16×16 map, heights 0..3 + props.
    this.bounds = { min: new THREE.Vector3(0, -1.0, 0), max: new THREE.Vector3(16, 12 * HSTEP + 2.6, 16) };
    // frame recipe, fractions of the viewport: reserved bands (CT strip up top, a sliver of base below) and where the
    // subject sits. Small bands on purpose — the genre lets the battlefield run right up to (and behind) the windows.
    // focusY 0.69 (round 5, was 0.625): the frame's reference line, and the centre of the R6 framing band —
    // round 6 clamps the subject's FEET into [0.55, 0.70] (SUBJ_BAND_LO/HI), which brackets it, so the body
    // centre sits at ~0.48..0.61 across close..wide — lower-middle third with headroom above toward the
    // action (bar item 9; the references put the acting cluster at y 0.52..0.70). Round 5's claim that the feet
    // land exactly ON 0.69 at every preset is retired: containment could overrule it (measured 0.372..1.289
    // on the r5 tree) and the honest shipped promise is the band.
    // hudTop / hudBottom: the bands the HUD paints over, measured (not guessed) — BuilderUI's round-5b
    // keep-out union (turn strip y8..101; unit-card y450..) and this module's _r5hud.mjs differencing probe.
    // chrome: live rects ([x0,y0,x1,y1] frame fractions) of the shown windows cinematics measures — the
    // round-6 replacement for the single menuLeft edge. Re-probe after any ui layout change.
    this.frame = { top: 0.03, bottom: 0.012, side: 0.006, focusY: 0.69, hudTop: 0.1645, hudBottom: 0.274, chrome: [] };
    this.deadZone = { x: 0.19, y: 0.15 }; // half-extents, fraction of the frame, for 'soft' follow
    this.edgePad = 0.1;                   // world units of the silhouette the frame may overhang when bounded.
    // 0.6 let the frame hang 0.6 units past the rim, which measured as a 2.3%-of-frame-width black gutter on the
    // side the focus clamp pinned against at yaw 1 (CRITIQUE_R2 rank 6a). Keep it token-small.
    this.tickers = new Set(); this.snapListeners = new Set();
    this._subjectId = null;               // id of the unit the last solve pinned (set by the anchor callback)
    this._right = new THREE.Vector3(); this._up = new THREE.Vector3(); this._dir = new THREE.Vector3();
    this.heightAt = null;                 // optional (x,z) => ground y, so the focus never sinks into a cliff
    this._prepFit();
    this.setAspect(aspect); this.update(0);
  }
  // ---- setup ----
  setAspect(a) { this.aspect = a; this._fitCache = null; this._applyFrustum(); }
  setBounds(min, max) { this.bounds.min.copy(min); this.bounds.max.copy(max); this._prepFit(); this._applyFrustum(); }
  // optional point cloud (Vector3[] or [x,y,z][]) that replaces the bbox corners for the fit — tile tops + prop tops
  setFitPoints(points) { this.fitPoints = points ? points.map((p) => (p.isVector3 ? [p.x, p.y, p.z] : p)) : null; this._prepFit(); this._applyFrustum(); }
  setFrame(opts) { Object.assign(this.frame, opts); this._fitCache = null; this._applyFrustum(); }
  setHeightSampler(fn) { this.heightAt = fn; }
  // optional () => [[x,y,z], ...]: the cast the frame should contain (unit feet AND heads).
  setSubjectPoints(fn) { this._subjectPts = fn || null; }
  // optional (fx,fy,fz) => [x,y,z]|null: the FEET of the one unit this frame is about, given where the lens is
  // aimed. Its feet are clamped into the R6 framing band [0.55, 0.70] at every preset and probe view; the
  // cost term picks the least-overhang point of that band against the diorama silhouette (sky above the
  // skyline, blue-black past the cut).
  setSubjectAnchor(fn) { this._anchorPt = fn || null; }
  // optional () => [[x,y,z], ...]: tile centres of the highlighted move/target field (R9 field keep-out).
  setFieldPoints(fn) { this._fieldPts = fn || null; }
  // R12 ABILITY STAGE (critic: 'the action is pushed into the lower-right under the HUD cards'). Optional
  // () => stage|null. While a stage is returned, _clampFocus frames IT instead of running the subject band:
  //   stage = { key: [x,y,z], must: [[x,y,z]...], opt: [[x,y,z]...], at: [ax, ay] }
  // key lands at (ax, ay) of the FREE RECT (the frame minus the HUD windows, freeRect()); every `must` point
  // (target body, AoE tiles, the effect's top) is then slid inside the free rect, and the `opt` points (the
  // caster) too when that does not push a must point out. A pure function of the stage + lens, so captures
  // stay deterministic; the diorama side clamp only bends it by a bounded amount (a little void at a map
  // edge beats an effect played under a status card).
  setStageFn(fn) { this._stageFn = fn || null; }
  // The part of the frame no HUD window paints over, [x0, y0, x1, y1] in frame fractions: below the lowest
  // top-docked window, above the highest bottom-docked window (frame.chrome = live rects from cinematics).
  // R18: `chrome` overrides the live rects (cinematics plans a summon against the rect the HUD leaves while it is faded).
  freeRect(chrome = null) {
    const fr = this.frame; let y0 = Math.max(fr.top, 0.02), y1 = 1 - Math.max(fr.bottom, 0.02), x0 = 0.03, x1 = 0.97;
    const side = [];
    for (const r of chrome || fr.chrome || []) {
      const cy = (r[1] + r[3]) / 2;
      if (cy < 0.3 && r[3] < 0.45) y0 = Math.max(y0, r[3]);
      else if (cy > 0.62 && r[1] > 0.45) y1 = Math.min(y1, r[1]);
      else side.push(r);
    }
    // SPECT15: a window docked to a SIDE in the middle band (the deployment roster, a tall right rail) narrows the
    // rect instead of being ignored -- the 1920x1080 deploy frame put the company under the roster panel. Only
    // while enough width is left to frame a group (>= 45% of the frame).
    for (const r of side) {
      if (r[3] - r[1] < 0.12 || r[3] < y0 + 0.05 || r[1] > y1 - 0.05) continue;
      if (r[0] > 0.5 && r[0] - x0 >= 0.45) x1 = Math.min(x1, r[0] - 0.01);
      else if (r[2] < 0.5 && x1 - r[2] >= 0.45) x0 = Math.max(x0, r[2] + 0.01);
    }
    if (y1 - y0 < 0.25) { const m = (y0 + y1) / 2; y0 = m - 0.125; y1 = m + 0.125; }
    return [x0, y0, x1, y1];
  }
  // Zoom at which the `pts` world points span at most (free rect - pad) at the TARGET yaw/pitch; Infinity
  // when there is nothing to contain. Used by cinematics to pull in (single target) or out (area) so the
  // whole stage fits.
  zoomToContain(pts, pad = 0.05, rect = null) {
    if (!pts || !pts.length) return Infinity;
    const pitch = this.targetPitch, yaw = this.targetYaw, cp = Math.cos(pitch), sp = Math.sin(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
    let s0 = Infinity, s1 = -Infinity, x0 = Infinity, x1 = -Infinity;
    for (const p of pts) {
      const sv = cp * p[1] - sp * (p[0] * sy + p[2] * cy), xv = p[0] * cy - p[2] * sy;
      if (sv < s0) s0 = sv; if (sv > s1) s1 = sv; if (xv < x0) x0 = xv; if (xv > x1) x1 = xv;
    }
    const R = rect || this.freeRect(), fh = Math.max(0.1, R[3] - R[1] - 2 * pad), fw = Math.max(0.1, R[2] - R[0] - 2 * pad);
    const hh0 = this._fitHalfHeight(pitch);
    // span / (2 * hh) <= fh  and  spanX / (2 * hh * aspect) <= fw ; zoom = hh0 / hh
    const hhNeed = Math.max((s1 - s0) / (2 * fh), (x1 - x0) / (2 * fw * this.aspect), 1e-3);
    return hh0 / hhNeed;
  }
  addTicker(fn) { this.tickers.add(fn); return () => this.tickers.delete(fn); }
  onSnap(fn) { this.snapListeners.add(fn); return () => this.snapListeners.delete(fn); }
  // ---- commands ----
  rotate(dir) { this.yawIndex = (this.yawIndex + dir + YAW_STOPS) % YAW_STOPS; this.targetYaw += dir * YAW_STEP; this._clampFocus(this.targetFocus); }
  togglePitch() { this.setPitch(this.pitchMode === 'low' ? 'high' : 'low'); }
  // tilting must not resize the world: keep the apparent scale, the way the genre's tilt toggle does. (Presets that set
  // targetPitch directly bypass this on purpose — 'high' is meant to be a whole-diorama high-angle frame.)
  setPitch(mode, preserveScale = true) {
    const before = this._fitHalfHeight(this.targetPitch);
    this.pitchMode = PITCH[mode] ? mode : 'low'; this.targetPitch = PITCH[this.pitchMode];
    if (preserveScale) { const after = this._fitHalfHeight(this.targetPitch); if (before > 0 && after > 0) this.targetZoom = THREE.MathUtils.clamp(this.targetZoom * after / before, ZOOM_MIN, ZOOM_MAX); }
    this._clampFocus(this.targetFocus);
  }
  setZoom(z) { this.targetZoom = THREE.MathUtils.clamp(z, ZOOM_MIN, ZOOM_MAX); this._clampFocus(this.targetFocus); }
  // mode: 'travel' (default) — go there; 'soft' — dead-zone follow: only move as much as needed to keep v inside the zone
  lookAt(v, immediate = false, mode = 'travel') {
    this._focusExplicit = true;   // an aim was named; snap listeners must not silently replace it (see snap())
    // Remember the point the CALLER named. The subject anchor is looked up from this, never from targetFocus:
    // _clampFocus moves targetFocus (sometimes several units, to hold the frame on the diorama), and snap() then
    // clamps a second time — so an anchor read off targetFocus vanished on the second pass and the containment
    // slide ran unbounded. Measured on that bug: 'wide' put the actor at 0.4197 instead of 0.582.
    this._aim = this._aim ? this._aim.copy(v) : v.clone();
    if (mode === 'soft' && !immediate) this._softFollow(v); else this._clampFocus(this.targetFocus.copy(v));
    if (immediate) { this.focus.copy(this.targetFocus); this.focusVel.set(0, 0, 0); }
  }
  // deterministic view for presets: { yawIndex, pitch:'low'|'high', zoom, focus }
  applyView({ yawIndex, pitch, zoom, focus } = {}) {
    if (yawIndex != null) { this.yawIndex = ((yawIndex % YAW_STOPS) + YAW_STOPS) % YAW_STOPS; this.targetYaw = YAW0 + this.yawIndex * YAW_STEP; this.yaw = this.targetYaw; }
    if (pitch) this.setPitch(pitch);
    if (zoom != null) this.setZoom(zoom);
    if (focus) this.lookAt(focus);
  }
  snap() {
    this.yaw = this.targetYaw; this.yawVel = 0; this.pitch = this.targetPitch; this.pitchVel = 0; this.zoom = this.targetZoom; this.zoomVel = 0;
    this.shake = 0; this.shakeClock = 0;
    // Listeners are told whether this focus was NAMED by the caller (a preset / a scenario's aim) or is just
    // wherever the lens happened to be. A listener that re-aims an explicitly named focus makes the frame depend
    // on when the snap happened, which is how round 3 shipped two different 'close' frames for one command.
    const info = { focusExplicit: !!this._focusExplicit };
    for (const fn of this.snapListeners) { try { fn(info); } catch (e) { console.error('camera snap listener', e); } }
    this._focusExplicit = false;
    this._clampFocus(this.targetFocus);
    this.focus.copy(this.targetFocus); this.focusVel.set(0, 0, 0);
    this.update(0);
  }
  // R18 CUT: jump every spring to its target NOW, without the snap listeners -- a scene cut / a live hard cut, not a
  // capture. snap() tells cinematics a capture preset ran, and cinematics then PINS the lens until real user input
  // (the lens lock); a staged scene that cut with snap() froze the whole intro on its first shot (review17 P3: Ossian
  // Vey spoke four lines off-screen -- measured: the lens never moved after the prelude's cut).
  cut() {
    this.yaw = this.targetYaw; this.yawVel = 0; this.pitch = this.targetPitch; this.pitchVel = 0; this.zoom = this.targetZoom; this.zoomVel = 0;
    this._clampFocus(this.targetFocus);
    this.focus.copy(this.targetFocus); this.focusVel.set(0, 0, 0);
    this.update(0);
  }
  // ---- per frame ----
  update(dt) {
    // SPECT15 REAL-TIME SPRINGS. The frame loop hands every consumer min(0.05, frame time), but the battle is
    // sequenced on the WALL clock (sleep(ms), walkPath's performance.now()), so on a slow frame the lens used to
    // advance 0.05 s while the actor walked a whole tile: measured under SwiftShader at 0.2-0.45 fps the camera
    // integrated 1-4% of real time and the actor/target sat at the frame edge or under the cards in ~40% of all
    // live frames (shots/spect15/base). The springs are substepped (any dt is stable), so a play frame integrates
    // the real elapsed time, clamped at 0.75 s (a stall, a hidden tab, an unfreeze). dt <= 0 (snap / capture
    // paths) is untouched, and the first call after a pause measures from the pause, not from the last frame.
    if (dt > 0) {
      const wall = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      const real = this._wall != null ? wall - this._wall : dt; this._wall = wall;
      if (real > dt) dt = Math.min(real, 0.75);
    } else if (dt === 0) this._wall = null;
    this.time += dt;
    if (dt > 0) this._focusExplicit = false;   // only survives to the snap() in the same tick that named it
    for (const fn of this.tickers) { try { fn(dt); } catch (e) { console.error('camera ticker', e); } }
    if (dt > 0) {
      [this.yaw, this.yawVel] = spring(this.yaw, this.yawVel, this.targetYaw, 12.5, 0.72, dt);          // slight overshoot settle
      [this.pitch, this.pitchVel] = spring(this.pitch, this.pitchVel, this.targetPitch, 8.5, 0.85, dt);
      [this.zoom, this.zoomVel] = spring(this.zoom, this.zoomVel, this.targetZoom, 8.5, 1.0, dt);
      for (const k of ['x', 'y', 'z']) [this.focus[k], this.focusVel[k]] = spring(this.focus[k], this.focusVel[k], this.targetFocus[k], 9.5, 1.0, dt);
      // Ground floor EVERY frame: the spring path from A to B can pass over a ridge taller than either
      // endpoint (measured: an ability pull-in dipped focus 0.227 below terrain mid-flight even though
      // both endpoints were clamped). The floor is a continuous clamp against the tile the focus is
      // currently over, so the aim never sinks into a cliff at any instant — and it is inert while locked
      // (snap focus is already clamped at its own xz), so captures do not move.
      // SPECT15: lifted ALONG THE VIEW RAY (orthographic: the image does not move), not straight up -- a vertical
      // raise shifted the drawn frame by up to a tile step mid-travel, dropping the subject under the cards.
      if (this.heightAt) {
        const cp0 = Math.cos(this.pitch), sp0 = Math.sin(this.pitch) || 1e-3, sy0 = Math.sin(this.yaw), cy0 = Math.cos(this.yaw);
        for (let i = 0; i < 6; i++) {
          const g = this.heightAt(this.focus.x, this.focus.z); if (g == null || this.focus.y >= g + 0.15) break;
          const t = (g + 0.15 - this.focus.y) / sp0 + 0.05; this.focus.x += sy0 * cp0 * t; this.focus.y += sp0 * t; this.focus.z += cy0 * cp0 * t;
        }
      }
      if (Math.abs(this.yaw - this.targetYaw) < 1e-4 && Math.abs(this.yawVel) < 1e-3) { this.yaw = this.targetYaw; this.yawVel = 0; }
    }
    this._applyFrustum();
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this._dir.set(sy * cp, sp, cy * cp); this._right.set(cy, 0, -sy); this._up.set(-sp * sy, cp, -sp * cy);
    this.cam.position.copy(this.focus).addScaledVector(this._dir, DIST);
    this.cam.lookAt(this.focus);
    // a yaw turn breathes out a few percent and settles back; exactly zero once the turn has landed
    const zoomEff = this.zoom / (1 + TURN_PULL * Math.abs(this.yaw - this.targetYaw));
    // offset focus: subject sits below centre (lower-middle third)
    const frameH = (this.cam.top - this.cam.bottom) / zoomEff;
    this.cam.position.addScaledVector(this._up, (this.frame.focusY - 0.5) * frameH);
    if (this.shake > 0) {
      this.shakeClock += dt; const t = this.shakeClock, a = this.shake * shakeScale();   // OPTIONS hook: Display > Screen Shake (0-100%)
      this.cam.position.addScaledVector(this._right, noise(t, 43, 0.3) * a).addScaledVector(this._up, noise(t, 37, 2.1) * a * 0.7);
      this.shake *= Math.pow(0.012, dt); if (this.shake < 0.004) this.shake = 0;
    }
    this.cam.zoom = zoomEff; this.cam.updateProjectionMatrix();
  }
  get yawNow() { return this.yaw; }
  get stopYaw() { return YAW0 + this.yawIndex * YAW_STEP; }
  // ---- framing helpers ----
  // where a world point lands in the frame: {x,y} in 0..1 from top-left (uses the *target* state so callers can plan)
  frameFraction(v, useTarget = true) {
    const yaw = useTarget ? this.targetYaw : this.yaw, pitch = useTarget ? this.targetPitch : this.pitch, zoom = useTarget ? this.targetZoom : this.zoom, f = useTarget ? this.targetFocus : this.focus;
    const cp = Math.cos(pitch), sp = Math.sin(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
    const dx = v.x - f.x, dy = v.y - f.y, dz = v.z - f.z;
    const sx = dx * cy - dz * sy, syy = -sp * (dx * sy + dz * cy) + cp * dy;
    const hh = this._fitHalfHeight(pitch) / zoom, hw = hh * this.aspect;
    return { x: 0.5 + sx / (2 * hw), y: this.frame.focusY - syy / (2 * hh) };
  }
  _softFollow(v) {
    const fr = this.frameFraction(v); const zx = this.deadZone.x, zy = this.deadZone.y; const f = this.targetFocus;
    // a walking unit is followed inside a dead zone, so the subject anchor is a BAND here, not a pin
    const hh = this._fitHalfHeight(this.targetPitch) / this.targetZoom, hw = hh * this.aspect;
    const sy = Math.sin(this.targetYaw), cy = Math.cos(this.targetYaw), sp = Math.sin(this.targetPitch);
    // R18: the dead zone is also clipped to the HUD-free rect -- the old symmetric zone let a walker's feet drift to
    // y 0.84 (measured live: the actor walking under the unit card, whose top is y 0.726 at 1100x620)
    const R = this.freeRect(), F = this.frame.focusY;
    let xLo = Math.max(0.5 - zx, R[0] + 0.07), xHi = Math.min(0.5 + zx, R[2] - 0.07);
    let yLo = Math.max(F - zy, R[1] + 0.2), yHi = Math.min(F + zy, R[3] - 0.03);
    if (xHi < xLo) xLo = xHi = (xLo + xHi) / 2; if (yHi < yLo) yLo = yHi = (yLo + yHi) / 2;
    const ex = fr.x < xLo ? fr.x - xLo : fr.x > xHi ? fr.x - xHi : 0, ey = fr.y < yLo ? fr.y - yLo : fr.y > yHi ? fr.y - yHi : 0;
    if (ex) { const d = ex * 2 * hw; f.x += d * cy; f.z += d * -sy; }
    if (ey) { const d = -ey * 2 * hh / sp; f.x += d * -sy; f.z += d * -cy; } // move along the ground away/toward the lens
    f.y += (v.y - f.y) * 0.5; this._clampFocus(f, false);
  }
  // Keep the focus on the map and out of the ground, keep the frame's SIDES inside the diorama's screen-space
  // silhouette, pin the subject's feet into the framing band, and clear unit hulls out of the HUD windows.
  // Vertically the band may overhang the silhouette (sky/blue-black zones, least-overhang cost) — see FRAME
  // BOUNDS in the header. Larger frame than diorama => centred exactly.
  _clampFocus(f, pinSubject = true) {
    const b = this.bounds, inset = 0.5;
    f.x = THREE.MathUtils.clamp(f.x, b.min.x + inset, b.max.x - inset);
    f.z = THREE.MathUtils.clamp(f.z, b.min.z + inset, b.max.z - inset);
    const g = this.heightAt ? this.heightAt(f.x, f.z) : null;
    f.y = THREE.MathUtils.clamp(f.y, g != null ? g + 0.15 : Math.max(0, b.min.y), (g != null ? g : b.max.y) + 3.2);
    // --- frame bounds, in screen axes ---
    const pitch = this.targetPitch, yaw = this.targetYaw;
    const fit = this._fitFor(pitch); const hh = fit.hh / this.targetZoom, hw = hh * this.aspect;
    const cp = Math.cos(pitch), sp = Math.sin(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
    const k = ((Math.round((yaw - YAW0) / YAW_STEP) % YAW_STOPS) + YAW_STOPS) % YAW_STOPS; const H = this._hull[k]; if (!H) return f;
    const dx = f.x - this._fitCX, dz = f.z - this._fitCZ;
    // horizontal: keep [sx-hw, sx+hw] inside [-ex, ex]
    const sx = dx * cy - dz * sy; const ex = this._exK[k], exP = ex + this.edgePad;
    let nsx = hw * (1 - 2 * this.frame.side) >= ex ? 0 : THREE.MathUtils.clamp(sx, -exP + hw, exP - hw);
    // vertical: S = cp*y - sp*u along the screen-up axis; the hull gives the diorama's [Mdn, Mup]
    let Mup = -Infinity, Mdn = Infinity;
    for (const p of H) { const s = cp * p[1] - sp * p[0]; if (s > Mup) Mup = s; if (s < Mdn) Mdn = s; }
    const F = this.frame.focusY, up = F * 2 * hh, dn = (1 - F) * 2 * hh;
    const U = F - this.frame.top, D = 1 - this.frame.bottom - F, bandH = (U + D) * 2 * hh;
    // The CAST's band is the part of the frame the HUD does not paint over. The diorama's band above is not:
    // the genre runs terrain under its windows in every reference frame, and reserving the HUD there would open a
    // gutter of void instead. screenS(): the screen-up coordinate of a world point, the axis every clamp works in.
    const UH = F - Math.max(this.frame.top, this.frame.hudTop), DH = 1 - Math.max(this.frame.bottom, this.frame.hudBottom) - F;
    const S = cp * f.y - sp * (dx * sy + dz * cy);
    const screenS = (p) => cp * p[1] - sp * ((p[0] - this._fitCX) * sy + (p[2] - this._fitCZ) * cy);
    // frame bigger than the board: centre it in the safe band, but hand the leftover slack back to the subject so
    // frame.focusY still means something (CRITIQUE_R2 rank 6b: the centred branch used to discard focusY entirely).
    // frame smaller: keep the frame on the map.
    let dioLo, dioHi;
    if (bandH >= Mup - Mdn - 1e-6) {
      const centred = (Mup + Mdn) / 2 - (U - D) * hh;
      const slack = (bandH - (Mup - Mdn)) / 2;
      dioLo = centred - slack; dioHi = centred + slack;
    } else { dioLo = Mdn - this.edgePad + dn; dioHi = Mup + this.edgePad - up; }
    const dioS = (v) => THREE.MathUtils.clamp(v, dioLo, dioHi);
    // --- subject anchor: the acting unit's FEET land in the R6 framing band ---
    // frameFraction() maps a world point to y = focusY - (screenS(p) - S) / (2*hh), so the nS that puts the
    // subject's feet at y is nS = aS - (focusY - y) * 2hh: SUBJ_BAND_LO maps to aS - (F-LO)*2hh, SUBJ_BAND_HI
    // to aS - (F-HI)*2hh. The chrome search below ranges exactly over that interval; the diorama silhouette
    // enters only as the overhang cost, so the band can bend the frame into the sky/blue-black zones but
    // never sideways off the map. (Round 4's twin defects — aim points lifted 0.6 above
    // ground putting close's feet 0.077 below focusY, and the containment slide moving them anywhere — are
    // still fixed by solving in S-space from the anchor rather than from the aim point.)
    const A0 = this._aim || f;
    const AP = this._anchorPt ? this._anchorPt(A0.x, A0.y, A0.z) : null;
    const aS = AP ? screenS(AP) : 0;
    const twoHh = 2 * hh;
    // a named aim pins the subject; a soft follow starts from the raw focus (its dead zone already tracks
    // the subject) — either way the band clamp inside the search decides where the subject lands.
    const base = AP && pinSubject ? aS : S;
    let nS = dioS(base);
    // --- cast containment, subject band, HUD-chrome search (round 6) ---
    // The cast wants the HUD-free band (fits: keep the current position inside the interval; crossed: the
    // midpoint — one continuous function through the crossing, so no zoom or cast-span threshold steps the
    // frame; r2 measured a 0.3626-frame step when a raw clamp owned that branch). The SUBJECT band then
    // takes precedence over the cast target (R6 critic item 1: feet in 0.55..0.70 at EVERY preset — the r5
    // solve let the interval/midpoint overrule the pin and shipped mid 1.06 / close 1.289 / high 0.92 /
    // rot1 0.372). Finally the frame slides inside the band (subject anchored) to minimise unit-hull
    // overlaps against chrome: frame.chrome holds the LIVE window rects cinematics measures — turn strip,
    // announce, bottom cards, right rail, whatever window the ui draws (round-5's menuLeft single-edge rule
    // is subsumed here). Subject overlaps weigh 8x cast overlaps, and
    // with no overlap at all the solve returns exactly the containment target (deterministic: fixed 17x17
    // grid, target/endpoint candidates scanned first).
    const ST = pinSubject && this._stageFn ? this._stageFn() : null;
    if (ST && ST.key) {
      // --- R12 ability stage (see setStageFn) ---
      const R = ST.rect || this.freeRect(), pad = ST.pad != null ? ST.pad : 0.035;
      const sxOf = (p) => (p[0] - this._fitCX) * cy - (p[2] - this._fitCZ) * sy;
      const ax = R[0] + (R[2] - R[0]) * (ST.at ? ST.at[0] : 0.5), ay = R[1] + (R[3] - R[1]) * (ST.at ? ST.at[1] : 0.45);
      // aim: key at (ax, ay).  y = F - (screenS(p) - nS)/2hh  =>  nS = screenS(key) - (F - ay)*2hh
      let tS = screenS(ST.key) - (F - ay) * twoHh, tX = sxOf(ST.key) - (ax - 0.5) * 2 * hw;
      // the diorama clamp may bend the aim, but only by a bounded void allowance (0 at the whole-board lens,
      // 12% of the frame once the lens is close enough that a sliver of void reads as the diorama's edge)
      const allow = THREE.MathUtils.clamp((this.targetZoom - 1.1) / 0.5, 0, 1) * 0.12;
      if (hw * (1 - 2 * this.frame.side) < ex) tX = THREE.MathUtils.clamp(tX, -exP + hw - allow * 2 * hw, exP - hw + allow * 2 * hw);
      else tX = THREE.MathUtils.clamp(tX, -allow * 2 * hw, allow * 2 * hw);
      tS = THREE.MathUtils.clamp(tS, dioLo - (allow + 0.08) * twoHh, dioHi + (allow + 0.08) * twoHh);
      // ...but never so far that the key leaves the central band of the free rect (x 0.3..0.7, y 0.25..0.62 of it):
      // at a board corner / the whole-board lens the side clamp used to park an area spell at x 0.84 of the frame
      {
        const kS = screenS(ST.key), kx = sxOf(ST.key);
        tX = THREE.MathUtils.clamp(tX, kx - (R[0] + (R[2] - R[0]) * 0.7 - 0.5) * 2 * hw, kx - (R[0] + (R[2] - R[0]) * 0.3 - 0.5) * 2 * hw);
        tS = THREE.MathUtils.clamp(tS, kS - (F - (R[1] + (R[3] - R[1]) * 0.25)) * twoHh, kS - (F - (R[1] + (R[3] - R[1]) * 0.62)) * twoHh);
      }
      // containment intervals for the frame offset, in S (vertical) and X, from a point set
      const need = (pts) => {
        let sLo = -Infinity, sHi = Infinity, xLo = -Infinity, xHi = Infinity;
        for (const p of pts) {
          const s = screenS(p), xv = sxOf(p);
          // y(p) in [R1+pad, R3-pad]  <=>  nS in [s - (F - R1 - pad)*2hh, s - (F - R3 + pad)*2hh]
          sLo = Math.max(sLo, s - (F - R[1] - pad) * twoHh); sHi = Math.min(sHi, s - (F - R[3] + pad) * twoHh);
          // x(p) in [R0+pad, R2-pad]  <=>  nx in [xv - (R2 - pad - 0.5)*2hw, xv - (R0 + pad - 0.5)*2hw]
          xLo = Math.max(xLo, xv - (R[2] - pad - 0.5) * 2 * hw); xHi = Math.min(xHi, xv - (R[0] + pad - 0.5) * 2 * hw);
        }
        if (sLo > sHi) sLo = sHi;   // too tall for the free rect: keep the FEET in (the effect's top may crop), never centre them under the cards
        if (xLo > xHi) { const m = (xLo + xHi) / 2; xLo = xHi = m; }
        return { sLo, sHi, xLo, xHi };
      };
      const M = need([ST.key, ...(ST.must || [])]);
      nS = THREE.MathUtils.clamp(tS, M.sLo, M.sHi); nsx = THREE.MathUtils.clamp(tX, M.xLo, M.xHi);
      if (ST.opt && ST.opt.length) {
        // the caster joins the shot only if it fits while the key stays in the central band of the free rect
        // (x 0.28..0.72, y 0.25..0.62 of it); a half-pull that leaves the caster cropped AND the effect
        // off-centre is worse than either, so it is all or nothing.
        const kS = screenS(ST.key), kx = sxOf(ST.key);
        const bS0 = kS - (F - (R[1] + (R[3] - R[1]) * 0.25)) * twoHh, bS1 = kS - (F - (R[1] + (R[3] - R[1]) * 0.62)) * twoHh;
        const bX0 = kx - (R[0] + (R[2] - R[0]) * 0.72 - 0.5) * 2 * hw, bX1 = kx - (R[0] + (R[2] - R[0]) * 0.28 - 0.5) * 2 * hw;
        const O = need(ST.opt);
        const s0 = Math.max(O.sLo, M.sLo, bS0), s1 = Math.min(O.sHi, M.sHi, bS1), x0 = Math.max(O.xLo, M.xLo, bX0), x1 = Math.min(O.xHi, M.xHi, bX1);
        if (s0 <= s1 && x0 <= x1) { nS = THREE.MathUtils.clamp(nS, s0, s1); nsx = THREE.MathUtils.clamp(nsx, x0, x1); }
        else if (!ST.deploy) {
          // R18 TWO-SHOT: a listener / caster that cannot join while the key holds the central band may still join with
          // the key anywhere inside the free rect (speaker at one side of the frame, listener at the other -- the genre's
          // two-shot) -- never above 0.42 of the rect, so the speech window keeps the room over the speaker's head; deploy keeps the strict rule (the company stays centred, foes are a bonus)
          const rS0 = kS - (F - (R[1] + (R[3] - R[1]) * 0.42)) * twoHh, rS1 = kS - (F - (R[3] - 0.08)) * twoHh;
          const rX0 = kx - (R[2] - 0.1 - 0.5) * 2 * hw, rX1 = kx - (R[0] + 0.1 - 0.5) * 2 * hw;
          const t0 = Math.max(O.sLo, M.sLo, rS0), t1 = Math.min(O.sHi, M.sHi, rS1), u0 = Math.max(O.xLo, M.xLo, rX0), u1 = Math.min(O.xHi, M.xHi, rX1);
          if (t0 <= t1 && u0 <= u1) { nS = THREE.MathUtils.clamp(nS, t0, t1); nsx = THREE.MathUtils.clamp(nsx, u0, u1); }
        }
      }
      this._stageSolved = { key: ST.key, R };
    }
    const SP = !(ST && ST.key) && this._subjectPts && this._subjectPts();
    if (SP && SP.length) {
      let smin = Infinity, smax = -Infinity, xlo = Infinity, xhi = -Infinity;
      for (const p of SP) {
        const sv = screenS(p); if (sv < smin) smin = sv; if (sv > smax) smax = sv;
        const xv = (p[0] - this._fitCX) * cy - (p[2] - this._fitCZ) * sy; if (xv < xlo) xlo = xv; if (xv > xhi) xhi = xv;
      }
      const bandW = (1 - 2 * this.frame.side) * 2 * hw;
      const vLo = smax - (UH - SUBJECT_PAD) * twoHh, vHi = smin + (DH - SUBJECT_PAD) * twoHh;
      const nSCast = vHi >= vLo ? THREE.MathUtils.clamp(nS, vLo, vHi) : (vLo + vHi) / 2;
      const padW = SUBJECT_PAD * 2 * hw, hLo = xhi - bandW / 2 + padW, hHi = xlo + bandW / 2 - padW;
      let nsxWant = hHi >= hLo ? THREE.MathUtils.clamp(nsx, hLo, hHi) : (hLo + hHi) / 2;
      nsxWant = THREE.MathUtils.clamp(nsxWant, nsx - SUBJECT_SHIFT * 2 * hw, nsx + SUBJECT_SHIFT * 2 * hw);
      // vertical range (see the block below for the band-wins rule and the measured states behind it).
      let rLo = dioLo, rHi = dioHi;
      if (AP) {
        // The band IS the range: both silhouette bounds yield to it and the overhang cost below picks the
        // least-overhang band point. TOP overhang shows the grade's royal sky plate (the backdrop a reference capture
        // carries over its plateau); BOTTOM overhang lands in the blue-black under-horizon zone the black
        // skirt already reads as (a reference capture's true black under the cut). Measured states needing each side:
        // top — auto rot1 (2.5 world), melee wide (0.16), maps yaw2 spawns (subject high on the board);
        // bottom — maps spawns on ravenscar/sunken/wendford at yaw5..7, where the subject stands ~1.7 world
        // above the hull bottom and the probe's own 0.75 feet gate is unreachable without the frame's
        // bottom edge crossing the cut. Default-map PRESETS never approach that bound (measured diag lows:
        // wide 0.375, mid 0.013, close -0.447, high 0.161, rot1 0.553), so no capture grows a bottom gutter.
        rLo = aS - (F - SUBJ_BAND_LO) * twoHh;
        rHi = aS - (F - SUBJ_BAND_HI) * twoHh;
      }
      const nTgt = THREE.MathUtils.clamp(nSCast, rLo, rHi);
      // horizontal range: exactly the old final clamp (frame inside the diorama sideways).
      const xWide = hw * (1 - 2 * this.frame.side) >= ex;
      const xLo = xWide ? 0 : -exP + hw, xHi = xWide ? 0 : exP - hw;
      let xLo2 = xLo, xHi2 = xHi;
      if (AP) {
        // subject feet x in [SUBJ_X_LO, SUBJ_X_HI]: x = 0.5 + (ax - nx) / (2hw)  =>  nx in [ax - (HI-0.5)2hw, ax - (LO-0.5)2hw]
        const ax = (AP[0] - this._fitCX) * cy - (AP[2] - this._fitCZ) * sy;
        const bLo = ax - (SUBJ_X_HI - 0.5) * 2 * hw, bHi = ax - (SUBJ_X_LO - 0.5) * 2 * hw;
        if (bLo > xHi2 || bHi < xLo2) { const edge = bLo > xHi2 ? bLo : bHi; xLo2 = xHi2 = edge; }   // band wins over the side clamp
        else { xLo2 = Math.max(xLo2, bLo); xHi2 = Math.min(xHi2, bHi); }
      }
      const xTgt = THREE.MathUtils.clamp(nsxWant, xLo2, xHi2);
      // hull data per cast member, from the [feet, head] pairs cinematics builds:
      // [screenS(feet), screenS(head), feet screen-x, isSubject]
      const units = [];
      for (let i = 0; i + 1 < SP.length; i += 2) {
        const pf = SP[i], ph = SP[i + 1];
        units.push([screenS(pf), screenS(ph), (pf[0] - this._fitCX) * cy - (pf[2] - this._fitCZ) * sy,
          !!(AP && Math.abs(pf[0] - AP[0]) < 1e-6 && Math.abs(pf[1] - AP[1]) < 1e-6 && Math.abs(pf[2] - AP[2]) < 1e-6)]);
      }
      const halfW = UNIT_HALF_W / (2 * hw);
      // chrome = the LIVE rects of shown windows only. The round-5 full-width y>0.726 band is dropped: with
      // #name-card deleted and #unit-card's box height-pinned to top>=y450 (R6UI's round-6 contract), the
      // bottom cards' boxes ARE the ink, they no longer span the full width, and between turns the card is
      // hidden — there is no ink to clear where no window is drawn. The cast-fit target above still prefers
      // the cast's bottom at 0.706 as a framing preference, so the y>0.726 landing survives as a preference
      // rather than a keep-out against a window that is not there.
      const rects = this.frame.chrome || [];
      const FP = this._fieldPts ? this._fieldPts() || [] : [];
      const field = FP.map((p) => [screenS(p), (p[0] - this._fitCX) * cy - (p[2] - this._fitCZ) * sy]);
      const fieldHits = (nn, nx) => {
        let n = 0;
        for (const t of field) {
          const y = F - (t[0] - nn) / twoHh, x = 0.5 + (t[1] - nx) / (2 * hw);
          for (let ri = 0; ri < rects.length; ri++) { const r = rects[ri]; if (x > r[0] && x < r[2] && y > r[1] && y < r[3]) { n++; break; } }
        }
        return n;
      };
      const cost = (nn, nx) => {
        let v = 0, area = 0;                       // v = hulls hit (subject x8); area = overlap in frame^2
        for (const u of units) {
          const yF = F - (u[0] - nn) / twoHh, yH = F - (u[1] - nn) / twoHh;
          const xc = 0.5 + (u[2] - nx) / (2 * hw);
          const x0 = xc - halfW, x1 = xc + halfW;
          let hit = false;
          for (let ri = 0; ri < rects.length; ri++) {
            const r = rects[ri];
            const ox = Math.min(x1, r[2]) - Math.max(x0, r[0]);
            if (ox <= 0) continue;
            const oy = Math.min(yF, r[3]) - Math.max(yH, r[1]);
            if (oy <= 0) continue;
            hit = true; area += ox * oy;
          }
          if (hit) v += u[3] ? 8 : 1;
        }
        // Edge straddles (R6IntegrationFix sweep): a sprite PARTIALLY cut by the left/right frame edge or
        // sheared by the top edge 'reads as floating or unfinished crop' (fire_close top-left x70-335);
        // fully inside and fully outside are both free — only the out-of-frame portion of a crossing hull
        // costs. Horizontal straddles clear via the x-solve (huge slack at close zoom); top straddles clear
        // by sitting lower in the band (or by sliding the unit fully off sideways). The BOTTOM crop is the
        // the genre idiom (references crop terrain and feet at the bottom edge) and is never penalised.
        let strad = 0;
        for (const u of units) {
          const yF = F - (u[0] - nn) / twoHh, yH = F - (u[1] - nn) / twoHh;
          const xc = 0.5 + (u[2] - nx) / (2 * hw);
          const x0 = xc - halfW, x1 = xc + halfW;
          if (x0 < 0 && x1 > 0) strad += -x0;
          else if (x0 < 1 && x1 > 1) strad += x1 - 1;
          if (yH < 0 && yF > 0) strad += -yH;
        }
        let b = 0;
        if (AP) { const yS = F - (aS - nn) / twoHh; b = Math.max(0, SUBJ_BAND_LO - yS, yS - SUBJ_BAND_HI); }
        // overhang cost: how far the frame's top has climbed past the diorama's silhouette (there the grade
        // paints the royal plate) or its bottom has dropped past the cut (blue-black under-horizon zone).
        // Weight 10 keeps the least-overhang band point winning the tie-break against the containment
        // target (dn ≤ 1), while a real chrome violation (4) is still worth up to 0.4 of frame overhang.
        const over = (nn > dioHi ? nn - dioHi : nn < dioLo ? dioLo - nn : 0) / twoHh;
        // weight 10000 on b: the range is the band itself, so b ≡ 0 there; it only bites if a future caller
        // widens the range, and then the nearest-to-band point must beat any tie-break/violation trade.
        // ... and an AREA term (R6UI's occlusion probe measures hard pixels): among equally-many hull hits
        // pick the point that buries the least ink — 10 * frame^2 outranks the dn/dx tie-break (a 0.1 frame^2
        // burial = 68k px weighs 1.0) but never the hull count itself (one cast hit = 4).
        return 10000 * b + 10 * over + 4 * v + 10 * area + 10 * strad + Math.abs(nn - nTgt) / Math.max(rHi - rLo, 1e-6) + Math.abs(nx - xTgt) / Math.max(xHi2 - xLo2, 1e-6) + FIELD_TILE_COST * fieldHits(nn, nx);
      };
      const NS = 17, NX = 17;
      const cand = [[nTgt, xTgt], [nTgt, xHi2], [nTgt, xLo2]];
      for (let i = 0; i <= NS; i++) for (let j = 0; j <= NX; j++) cand.push([rLo + (rHi - rLo) * i / NS, xLo2 + (xHi2 - xLo2) * j / NX]);
      let best = cand[0], bestC = Infinity;
      for (const cd of cand) { const c = cost(cd[0], cd[1]); if (c < bestC) { bestC = c; best = cd; } }
      nS = best[0]; nsx = best[1];
    }
    const ds = nS - S, dsx = nsx - sx;
    if (ds || dsx) {
      const e = ds / (sp || 1e-3);          // move along the ground away from / toward the lens
      f.x += dsx * cy + e * -sy; f.z += dsx * -sy + e * -cy;
      f.x = THREE.MathUtils.clamp(f.x, b.min.x - 6, b.max.x + 6); f.z = THREE.MathUtils.clamp(f.z, b.min.z - 6, b.max.z + 6);
      // The band/dio solve moves focus ALONG THE GROUND, and it was solved against the OLD tile: on an
      // ability pull-in the slide can land the aim several tiles onto a higher cliff, leaving focus.y
      // below the new ground (measured: -0.226 under terrain mid-pull). Re-clamp y against the tile the
      // focus actually ended on — never inside a cliff (bar 9). The raise is small, bounded by one tile
      // step, and continuous (a clamp), so the band solution only shifts by cp*dy.
      // SPECT15: the plain subject solve lifts along the view ray too. The vertical raise below was measured pushing
      // the actor's feet from the band to y 0.73-0.99 (under the unit card) on greyspine_pass, whose cliffs put the
      // band's solved aim inside a higher tile; a raise along the ray leaves the image exactly where it was solved.
      if (this.heightAt) {
        // R12 stage: lift the focus out of the ground ALONG THE VIEW RAY (orthographic: the image does not move),
        // not straight up -- a vertical raise shifted the solved frame (measured: a Fire target pushed from its
        // solved spot to y 0.743, under the cards, on saltglass_dunes).
        for (let i = 0; i < 6; i++) {
          const g = this.heightAt(f.x, f.z); if (g == null || f.y >= g + 0.15) break;
          const t = (g + 0.15 - f.y) / (sp || 1e-3) + 0.05; f.x += sy * cp * t; f.y += sp * t; f.z += cy * cp * t;
        }
      } else {
        const g2 = this.heightAt ? this.heightAt(f.x, f.z) : null;
        if (g2 != null) { const yMin = g2 + 0.15, yMax = g2 + 3.2; if (f.y < yMin) f.y = Math.min(yMin, yMax); }
      }
    }
    return f;
  }
  // ---- fit: zoom 1 == the whole diorama, framed inside the safe bands with no slack ----
  _prepFit() {
    const b = this.bounds;
    const pts = this.fitPoints || [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z]);
    this._fitCX = (b.min.x + b.max.x) / 2; this._fitCZ = (b.min.z + b.max.z) / 2;
    this._hull = []; this._exK = []; this._ex = 0;
    // One hull and one half-width per STOP. _ex (the width the zoom-1 fit uses) stays the max over every stop, so
    // zoom 1 means the same lens at all eight; on a square map the 45° stops dominate it exactly as before.
    for (let k = 0; k < YAW_STOPS; k++) {
      const yaw = YAW0 + k * YAW_STEP, sy = Math.sin(yaw), cy = Math.cos(yaw); const uy = []; let ex = 0;
      for (const p of pts) {
        const x = p[0] - this._fitCX, z = p[2] - this._fitCZ;
        const sx = Math.abs(x * cy - z * sy); if (sx > ex) ex = sx;
        uy.push([x * sy + z * cy, p[1]]);
      }
      this._exK.push(ex); this._ex = Math.max(this._ex, ex); this._hull.push(convexHull(uy));
    }
    this._fitCache = null;
  }
  // { hh, cy } for a pitch: hh = half-height of the zoom-1 frame; cy = the world height of the fit anchor that
  // centres the diorama inside the safe band (so frame.focusY costs nothing in a whole-map view).
  _fitFor(pitch) {
    const key = pitch.toFixed(4) + '|' + this.aspect.toFixed(4);
    if (this._fitCache && this._fitCache.key === key) return this._fitCache;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    let Mup = -Infinity, Mdn = Infinity;
    for (const H of this._hull) for (const p of H) { const s = cp * p[1] - sp * p[0]; if (s > Mup) Mup = s; if (s < Mdn) Mdn = s; }
    if (!isFinite(Mup)) { Mup = 1; Mdn = -1; }
    const F = this.frame, U = F.focusY - F.top, D = 1 - F.focusY - F.bottom;
    // Width fit is measured at ZOOM_MIN, so even the widest legal lens still meets the side edges; the height
    // requirement is scaled by FIT_FILL so it stops out-voting the width fit on a 16:9 frame.
    const hh = Math.max((Mup - Mdn) / (2 * (U + D)) * FIT_FILL, this._ex * FIT_WIDE / ((1 - 2 * F.side) * this.aspect), VIEW_TILES * 0.18);
    const bandC = 0.5 + (F.top - F.bottom) / 2;                    // centre of the safe band, frame fraction
    const cyw = (4 * hh * (bandC - F.focusY) + Mup + Mdn) / (2 * cp); // world y of the anchor
    this._fitCache = { key, hh, cy: cyw }; return this._fitCache;
  }
  _fitHalfHeight(pitch) { return this._fitFor(pitch).hh; }
  // the point the zoom-1 fit is centred on (look here to see the whole diorama)
  fitCenter(pitch = this.targetPitch) { return new THREE.Vector3(this._fitCX, this._fitFor(pitch).cy, this._fitCZ); }
  _applyFrustum() {
    const hh = this._fitHalfHeight(this.pitch); const a = this.aspect;
    if (this.cam.top !== hh || this.cam.right !== hh * a) { this.cam.left = -hh * a; this.cam.right = hh * a; this.cam.top = hh; this.cam.bottom = -hh; this.cam.updateProjectionMatrix(); }
  }
}
