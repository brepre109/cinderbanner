import * as THREE from 'three';
// CUTAWAY (round 9, reshaped round 12): props standing between the lens and what the player is looking at are cut
// open, the way classic tactics Reborn / Triangle Strategy / XCOM open a roof over the acting unit. The ghost
// silhouettes still say "someone is back there"; the cutaway is what makes that someone PLAYABLE (their fields,
// their feet, the cursor tile) without rotating the camera.
//
// Done in the SHADER because the static props are merged into ~25 world-space batch meshes (props.js
// batchProps): there is no per-house object to hide. Every prop colour material gets an onBeforeCompile
// injection that tests each fragment against up to MAX_FOCI focus points.
//
// R12 (every blind A/B critic: 'hard dithered disc around the blast', 'a stage-flat sliver of wall left standing'):
// the cut is no longer a screen-space ELLIPSE with a stippled rim. It is a SECTION, decided per PROP:
//   - patchProps() stamps every prop vertex with its prop's footprint box (aCutBox = centre xz, half size xz) and
//     top (aCutTop), recovered from the per-prop meshes the batch was built from; instanced billboards derive the
//     same numbers from their instance matrix in the vertex stage;
//   - a prop is OPENED when its box is in front of the focus (view depth), overlaps it sideways on screen, and
//     reaches above the focus's feet line on screen -- i.e. when it can actually hide the focus;
//   - an opened prop is sliced by a horizontal plane at the focus's FEET height: everything of that prop above the
//     plane is discarded, everything below stays. The edge of the hole is therefore the building's own geometry
//     (a wall cut level with the floor the unit stands on, like an architectural section / a Sims walls-down
//     view), never a circle drawn across a roof, and never a sliver: the whole prop goes or none of it does;
//   - the fade is the plane SWEEPING down from the prop's top to the feet over FADE seconds, not a dither ramp,
//     so no stipple is ever on screen;
//   - a thin screen-constant ink line runs along the cut top of the surviving (vertical) wall stubs, and along the
//     side edge where a very long prop (a town wall) is only opened in a band around the focus;
//   - floors, decks, stair treads and the tile under the unit never cut (below the feet plane by construction);
//   - if the focus stands INSIDE a prop's footprint (a ruin, an arch, a deck) the prop-level decision is
//     meaningless, so those fragments fall back to a per-fragment test (in front, beside, above the feet line).
// Shadows are untouched by construction: the shadow pass renders props with three's own depth materials (or the
// billboards' customDepthMaterial), which never see this injection, so the cached shadow map is unaffected.
// The same test runs on the CPU (cutHides) so the unit ghosts (src/units/occlusion.js) know what the cut opened.
// NOTE: GLSL lives in plain strings below; never put a backtick in them (it would end the template literal).

export const MAX_FOCI = 4;
const FADE = 0.2;                         // seconds, 0 -> 1 (the section plane's sweep)
const SKIP_NAMES = new Set(['void_cap', 'rock_patina', 'decals', 'contact_shadows']);
const BAND_K = 1.4, BAND_ADD = 0.5;       // long props open only within |dx| < rx * BAND_K + BAND_ADD (view units)

const U = {
  uCutA: { value: Array.from({ length: MAX_FOCI }, () => new THREE.Vector4(0, 0, 0, 0)) },   // world centre xyz, strength
  uCutB: { value: Array.from({ length: MAX_FOCI }, () => new THREE.Vector4(1, 1, -99, 0)) }, // view radii x/y, feet y, max depth
  uCutDepth: { value: 0.35 },            // view units a prop's centre must be nearer the lens than the focus
  uCutSoft: { value: 0.22 },             // (unused since r12; kept so readers of cutaway.uniforms do not break)
  uCutRimW: { value: 1.25 },             // ink line width in SCREEN pixels
  uCutRim: { value: new THREE.Color(0.035, 0.03, 0.05) },   // ink: the cut edge reads as an outline, like the sprites' own
};
let epoch = 0;   // bumped by snap(): the ghosts snap their own fades on the same beat

const VERT_DECL = '\nattribute vec4 aCutBox; attribute vec2 aCutTop;\nvarying vec3 vCutWorld; varying vec4 vCutBox; varying vec2 vCutTop;\n';
// PERF r11: instanced billboards (props.js) carry their placement in instanceMatrix. R12: their box comes from it
// too (instances are re-sorted back-to-front on every turn, so a per-instance attribute would go stale).
const VERT_BODY = [
  '',
  '#ifdef USE_INSTANCING',
  '  vCutWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;',
  '  {',
  '    vec3 cb = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;',
  '    vec3 ct = (modelMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 1.0)).xyz;',
  '    float hw = 0.3 * length((modelMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);',
  '    vCutBox = vec4(cb.xz, hw, hw); vCutTop = vec2(ct.y, 2.0);',   // 2 = a billboard (R20 foliage rule, fragment test)
  '  }',
  '#else',
  '  vCutWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
  '  vCutBox = aCutBox; vCutTop = aCutTop;',
  '#endif',
  '',
].join('\n');
const FRAG_DECL = [
  '',
  'varying vec3 vCutWorld; varying vec4 vCutBox; varying vec2 vCutTop;',
  'uniform vec4 uCutA[' + MAX_FOCI + '];',
  'uniform vec4 uCutB[' + MAX_FOCI + '];',
  'uniform float uCutDepth; uniform float uCutRimW; uniform vec3 uCutRim;',
  '',
].join('\n');
// Runs first thing in main(): decides discard, and leaves cutRimAmt for the colour tint at the end.
const FRAG_TEST = [
  '',
  '  float cutRimAmt = 0.0;',
  '  {',
  '    vec3 cvp = (viewMatrix * vec4(vCutWorld, 1.0)).xyz;',
  '    vec3 cdx = dFdx(vCutWorld), cdy = dFdy(vCutWorld);',
  '    vec3 cn = cross(cdx, cdy);',
  '    float cVert = 1.0 - smoothstep(0.45, 0.75, abs(cn.y) / max(length(cn), 1e-6));',
  '    float cPx = max(fwidth(vCutWorld.y), 1e-5) * uCutRimW;',
  '    float cBandPx = max(fwidth(cvp.x), 1e-5) * uCutRimW;',
  '    vec3 axX = vec3(viewMatrix[0][0], viewMatrix[0][1], viewMatrix[0][2]);',
  '    vec3 axZ = vec3(viewMatrix[2][0], viewMatrix[2][1], viewMatrix[2][2]);',
  '    bool cBox = vCutTop.y > 0.5;',
  // R20 (review19 P5: a target standing IN a shrub): billboards (bushes, trees, barrels) open when they stand anywhere
  // in front of the focus's centre (a bush on the unit's own tile, a hand's breadth nearer the lens, counts) and when they
  // reach a fifth of the body up the screen (a bush that buried a hound's head never reached the old half-body line)
  '    bool cBill = vCutTop.y > 1.5;',
  '    float cMinDz = cBill ? -0.02 : uCutDepth;',
  '    bool cutIt = false;',
  '    for (int ci = 0; ci < ' + MAX_FOCI + '; ci++) {',
  '      vec4 A = uCutA[ci]; vec4 B = uCutB[ci];',
  '      if (A.w < 0.002) continue;',
  '      float feet = B.z;',
  '      if (vCutWorld.y < feet + 0.02) continue;',
  '      vec2 c = vCutWorld.xz; vec2 hs = vec2(0.0); float top = vCutWorld.y;',
  '      if (cBox && any(greaterThan(abs(A.xz - vCutBox.xy), vCutBox.zw - 0.3))) { c = vCutBox.xy; hs = vCutBox.zw; top = vCutTop.x; }',
  '      vec3 fv = (viewMatrix * vec4(A.x, feet, A.z, 1.0)).xyz;',
  '      vec3 cv = (viewMatrix * vec4(c.x, feet, c.y, 1.0)).xyz;',
  '      float eX = abs(axX.x) * hs.x + abs(axZ.x) * hs.y;',
  '      float eY = abs(axX.y) * hs.x + abs(axZ.y) * hs.y;',
  '      float cdz = cv.z - fv.z;',
  '      if (cdz < cMinDz || cdz > B.w) continue;',
  '      if (abs(cv.x - fv.x) > B.x + eX) continue;',
  '      if (cv.y + (top - feet) * viewMatrix[1][1] + eY < fv.y + (cBill ? 0.22 * B.y : min(0.5 * B.y, 0.9))) continue;',
  '      float ycut = feet + 0.02 + (1.0 - A.w) * (top - feet + 0.15);',
  '      if (vCutWorld.y <= ycut) { if (vCutWorld.y > ycut - cPx) cutRimAmt = max(cutRimAmt, A.w * cVert); continue; }',
  '      float band = abs(cvp.x - fv.x) - (B.x * ' + BAND_K.toFixed(2) + ' + ' + BAND_ADD.toFixed(2) + ');',
  '      if (band > 0.0) { if (band < cBandPx) cutRimAmt = max(cutRimAmt, A.w); continue; }',
  '      cutIt = true; break;',
  '    }',
  '    if (cutIt) discard;',
  '  }',
  '',
].join('\n');
const FRAG_TINT = '\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, uCutRim, 0.85 * cutRimAmt);\n';

function inject(sh) {
  Object.assign(sh.uniforms, U);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + VERT_DECL)
    .replace('#include <project_vertex>', '#include <project_vertex>' + VERT_BODY);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + FRAG_DECL)
    .replace(/void\s+main\s*\(\s*\)\s*\{/, (m) => m + FRAG_TEST)
    .replace('#include <opaque_fragment>', '#include <opaque_fragment>' + FRAG_TINT);
}

const patched = new WeakSet();
function patchMaterial(m) {
  if (!m || patched.has(m) || m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return;
  if (!(m.isMeshLambertMaterial || m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshBasicMaterial)) return;
  if (m.transparent && !(m.alphaTest > 0)) return;   // contact shadows / decals: flat on the ground, never occlude
  if (!m.depthWrite) return;                          // ground decals (alpha-tested, no depth): never occlude either
  patched.add(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = inject;
  m.customProgramCacheKey = () => 'cutaway-v3|' + prevKey();
  m.needsUpdate = true;
}

// ---- per-prop boxes ------------------------------------------------------------------------------------------
// Every prop is one child group of the props root (props.js buildProps), whose 'merged' meshes are the per-prop
// geometry; batchProps concatenated those, in props.children order, into one world-space mesh per material bucket
// and hid the originals. The box of each prop is stamped onto its vertices in BOTH places: the originals (drawn
// under ?batch=off) and the batch, whose vertex runs are matched back to their source part by position (a part
// that was hidden before batching simply fails to match and is skipped, so the walk cannot drift).
const _bx = new THREE.Box3(), _v = new THREE.Vector3(), _m4 = new THREE.Matrix4();
export const propRecords = [];   // [{ group, box: {cx, cz, hx, hz, top}, parts: [mesh] }] -- also read by the ghosts
function boxAttrs(n, b) {
  const A = new Float32Array(n * 4), T = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { A[i * 4] = b.cx; A[i * 4 + 1] = b.cz; A[i * 4 + 2] = b.hx; A[i * 4 + 3] = b.hz; T[i * 2] = b.top; T[i * 2 + 1] = 1; }
  return [A, T];
}
function stampProps(props, batch) {
  propRecords.length = 0;
  if (!props) return;
  props.updateMatrixWorld(true);
  // Meshes mergeStatic left unmerged (non-zero renderOrder, custom depth: a chimney cap, a lamp) are stamped too --
  // unstamped, they fell back to the per-fragment test and were left standing as a lone post once their house
  // opened. Their geometry may be shared between props, so a shared one is cloned before it is stamped.
  const geoUse = new Map();
  props.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.geometry) geoUse.set(o.geometry, (geoUse.get(o.geometry) || 0) + 1); });
  for (const g of props.children) {
    const all = []; g.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && !o.userData.billboard && !SKIP_NAMES.has(o.name)) all.push(o); });
    const parts = all.filter((o) => o.name === 'merged');
    if (!all.length) continue;
    _bx.makeEmpty(); for (const o of all) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); _bx.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); }
    if (_bx.isEmpty()) continue;
    const b = { cx: (_bx.min.x + _bx.max.x) / 2, cz: (_bx.min.z + _bx.max.z) / 2, hx: (_bx.max.x - _bx.min.x) / 2, hz: (_bx.max.z - _bx.min.z) / 2, top: _bx.max.y, bottom: _bx.min.y };
    const rec = { group: g, box: b, parts };
    propRecords.push(rec);
    for (const o of all) {
      if (o.name !== 'merged' && geoUse.get(o.geometry) > 1) { geoUse.set(o.geometry, geoUse.get(o.geometry) - 1); o.geometry = o.geometry.clone(); }
      const n = o.geometry.attributes.position.count; const [A, T] = boxAttrs(n, b);
      o.geometry.setAttribute('aCutBox', new THREE.BufferAttribute(A, 4)); o.geometry.setAttribute('aCutTop', new THREE.BufferAttribute(T, 2));
    }
  }
  if (!batch) return;
  const recOf = new Map(); for (const r of propRecords) for (const o of r.parts) recOf.set(o, r);
  for (const m of batch.children) {
    if (m.name !== 'props_batch' || m.isInstancedMesh) continue;
    const P = m.geometry.attributes.position, n = P.count;
    const A = new Float32Array(n * 4), T = new Float32Array(n * 2);   // unmatched runs stay flag 0 -> per-fragment test
    let k = 0;
    const key = (o) => o.material === m.material && o.castShadow === m.castShadow && o.receiveShadow === m.receiveShadow && o.frustumCulled === m.frustumCulled;
    for (const g of props.children) for (const o of g.children) {
      if (k >= n) break;
      if (o.name !== 'merged' || !o.isMesh || !key(o)) continue;
      const pa = o.geometry.attributes.position; if (k + pa.count > n) continue;
      _v.fromBufferAttribute(pa, 0).applyMatrix4(o.matrixWorld);
      if (Math.abs(_v.x - P.getX(k)) + Math.abs(_v.y - P.getY(k)) + Math.abs(_v.z - P.getZ(k)) > 1e-3) continue;
      const r = recOf.get(o);
      if (r) { const b = r.box; for (let i = k; i < k + pa.count; i++) { A[i * 4] = b.cx; A[i * 4 + 1] = b.cz; A[i * 4 + 2] = b.hx; A[i * 4 + 3] = b.hz; T[i * 2] = b.top; T[i * 2 + 1] = 1; } }
      k += pa.count;
    }
    m.geometry.setAttribute('aCutBox', new THREE.BufferAttribute(A, 4)); m.geometry.setAttribute('aCutTop', new THREE.BufferAttribute(T, 2));
    m.userData.cutMatched = k / n;
  }
}

// Patch every prop colour material under the given roots (the props group and the props_batch group), and stamp
// the per-prop boxes the section test reads.
export function patchProps(props, batch, ...more) {
  for (const r of [props, batch, ...more]) r?.traverse?.((o) => {
    if (!o.isMesh || SKIP_NAMES.has(o.name)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) patchMaterial(m);
  });
  try { stampProps(props, batch); } catch (e) { console.warn('cutaway: prop boxes skipped', e); }
}

// ---- CPU mirror of the fragment test (the ghosts ask what the cut opened) --------------------------------------
// p: world point on a prop (or terrain: box null => never cut, terrain is not patched); box: a propRecords box.
// view: camera.matrixWorldInverse. Strength threshold 0.5: a half-swept section counts as open.
const _fv = new THREE.Vector3(), _cv = new THREE.Vector3(), _pv = new THREE.Vector3();
export function cutHides(px, py, pz, box, view) {
  const e = view.elements;
  const axXx = e[0], axXy = e[1], axZx = e[8], axZy = e[9], upY = e[5];
  for (let i = 0; i < MAX_FOCI; i++) {
    const A = U.uCutA.value[i], B = U.uCutB.value[i];
    if (A.w < 0.5) continue;
    const feet = B.z; if (py < feet + 0.02) continue;
    let cx = px, cz = pz, hx = 0, hz = 0, top = py;
    if (box && (Math.abs(A.x - box.cx) > box.hx - 0.3 || Math.abs(A.z - box.cz) > box.hz - 0.3)) { cx = box.cx; cz = box.cz; hx = box.hx; hz = box.hz; top = box.top; }
    _fv.set(A.x, feet, A.z).applyMatrix4(view); _cv.set(cx, feet, cz).applyMatrix4(view);
    const eX = Math.abs(axXx) * hx + Math.abs(axZx) * hz, eY = Math.abs(axXy) * hx + Math.abs(axZy) * hz;
    const dz = _cv.z - _fv.z;
    if (dz < U.uCutDepth.value || dz > B.w) continue;
    if (Math.abs(_cv.x - _fv.x) > B.x + eX) continue;
    if (_cv.y + (top - feet) * upY + eY < _fv.y + Math.min(0.5 * B.y, 0.9)) continue;
    const ycut = feet + 0.02 + (1 - A.w) * (top - feet + 0.15);
    if (py <= ycut) continue;
    _pv.set(px, py, pz).applyMatrix4(view);
    if (Math.abs(_pv.x - _fv.x) > B.x * BAND_K + BAND_ADD) continue;
    return true;
  }
  return false;
}
/** Strength (0..1) of the unit-shaped focus standing on world (x, z), if any: the ghosts rank those first. */
export function focusStrengthAt(x, z) {
  let s = 0;
  for (let i = 0; i < MAX_FOCI; i++) { const A = U.uCutA.value[i]; if (A.w > s && Math.abs(A.x - x) < 0.35 && Math.abs(A.z - z) < 0.35) s = A.w; }
  return s;
}
export function cutEpoch() { return epoch; }
/** Cheap signature of the published foci (the ghosts re-test when it changes). */
export function cutSignature() { let h = 0; for (let i = 0; i < MAX_FOCI; i++) { const A = U.uCutA.value[i], B = U.uCutB.value[i]; h += (A.x * 3.1 + A.y * 5.7 + A.z * 7.3 + B.z) * (i + 1) + Math.round(A.w * 8) * 101 * (i + 1); } return h; }

// ---- focus driver ----------------------------------------------------------------------------------------------
// A focus: { key, pos: Vector3 (world, the ellipse centre), rx, ry (view-space radii), feet (world y) }.
// Slots keep their key across frames so each fades on its own; a vanished key fades out at its last position.
export function createCutaway(opts = {}) {
  const slots = Array.from({ length: MAX_FOCI }, () => ({ key: null, s: 0, want: 0, pos: new THREE.Vector3(), rx: 1, ry: 1, feet: -99, depth: 4.5 }));
  let enabled = opts.enabled !== false, manual = null, provider = null;
  // PERF r11: runs every frame, so it is written without Sets, slices or filtered copies; same choices as before:
  // a focus keeps its slot by key, else takes the first free slot that is empty or faded out, else the free slot
  // with the least strength ('free' = not taken this pass and not holding a key that is still in the list).
  const inList = (list, key) => { for (let j = 0; j < list.length; j++) if (list[j].key === key) return true; return false; };
  function assign(list) {
    // Only the first MAX_FOCI foci count: an extra focus must not 'hold' a slot by key, or with >MAX_FOCI foci no slot
    // is ever free and sl stayed null (review17 R1 page error). Slices only in that rare case.
    if (list.length > MAX_FOCI) list = list.slice(0, MAX_FOCI);
    for (const sl of slots) if (sl.key && !inList(list, sl.key)) sl.want = 0;
    let taken = 0;
    const n = Math.min(list.length, MAX_FOCI);
    for (let fi = 0; fi < n; fi++) {
      const f = list[fi]; let sl = null;
      for (const x of slots) if (x.key === f.key) { sl = x; break; }
      if (!sl) for (let i = 0; i < MAX_FOCI; i++) { const x = slots[i]; if (!(taken & (1 << i)) && !inList(list, x.key) && (!x.key || x.s <= 0.001)) { sl = x; break; } }
      if (!sl) for (let i = 0; i < MAX_FOCI; i++) { const x = slots[i]; if (!(taken & (1 << i)) && !inList(list, x.key) && (!sl || x.s < sl.s)) sl = x; }
      if (!sl) continue;
      taken |= 1 << slots.indexOf(sl);
      if (sl.key !== f.key) { sl.key = f.key; sl.s = 0; }
      sl.want = 1; sl.pos.copy(f.pos); sl.rx = f.rx || 1; sl.ry = f.ry || 1; sl.feet = f.feet ?? -99; sl.depth = f.depth || 4.5;
    }
  }
  function publish() {
    for (let i = 0; i < MAX_FOCI; i++) {
      const sl = slots[i];
      if (sl.s <= 0.001 && sl.want === 0) sl.key = null;
      U.uCutA.value[i].set(sl.pos.x, sl.pos.y, sl.pos.z, enabled ? sl.s * sl.s * (3 - 2 * sl.s) : 0);
      U.uCutB.value[i].set(sl.rx, sl.ry, sl.feet, sl.depth);
    }
  }
  const merged = [];
  function gather() {
    if (!enabled) return [];
    const base = manual ? manual : provider ? provider() || [] : [];
    if (manual) return base;
    // R20: the scene player's speaker (first: a line owns the roof) and, at the command menu, the actor's neighbours
    // (after the page's own foci, into whatever slots are left)
    let pre = null, post = null;
    try { pre = stageFociFn ? stageFociFn() : null; post = menuFoci(); } catch (e) { pre = post = null; }
    if (!(pre && pre.length) && !(post && post.length)) return base;
    merged.length = 0;
    const near = (f) => { for (const o of merged) if (o.key === f.key || o.pos.distanceTo(f.pos) < 0.3) return true; return false; };
    for (const f of pre || []) if (!near(f)) merged.push(f);
    for (const f of base) if (!near(f)) merged.push(f);
    for (const f of post || []) if (merged.length < MAX_FOCI && !near(f)) merged.push(f);
    return merged;
  }
  const api = {
    uniforms: U,
    get enabled() { return enabled; },
    setEnabled(v) { enabled = !!v; publish(); },
    // Explicit foci override the provider. Accepts Vector3s (default radii) or focus objects; null returns control.
    setFocus(list) { manual = list ? list.map((f, i) => (f.isVector3 ? { key: 'm' + i, pos: f, rx: 1.1, ry: 1.3, feet: f.y - 0.8 } : { key: f.key || 'm' + i, ...f })) : null; },
    setProvider(fn) { provider = fn; },
    update(dt) {
      assign(gather());
      const k = dt > 0 ? dt / FADE : 0;
      for (const sl of slots) sl.s = sl.want ? Math.min(1, sl.s + k) : Math.max(0, sl.s - k);
      publish();
    },
    // Captures: jump every fade to its end state (called by presets/scenarios so frames are deterministic).
    snap() { assign(gather()); for (const sl of slots) sl.s = sl.want; publish(); epoch++; },
    get foci() { return slots.filter((s) => s.key).map((s) => ({ key: s.key, s: s.s, pos: s.pos.toArray(), rx: s.rx, ry: s.ry, feet: s.feet })); },
  };
  return api;
}

// ---- R20 extra foci -----------------------------------------------------------------------------------------
// setStageFoci(fn): the staged-scene player (src/campaign/stage/player.js) publishes the unit speaking a line; those
// foci go FIRST (review19 P4: Malquor spoke from inside a stone block, the cut was held by the page's other foci).
let stageFociFn = null;
export function setStageFoci(fn) { stageFociFn = fn || null; }
// COMMAND MENU (review19 P5: a house covered two allies while Ysolde's command menu was up; the cut only followed the
// actor): while the player's command menu is open, the two units nearest the actor (<= 4 tiles) are foci too. A prop
// opens only if it actually crosses one of them, so this costs nothing where nothing is hidden.
function menuFoci() {
  if (typeof window === 'undefined') return null;
  const G = window.__GAME__; const b = G?.battle, pl = G?.player, ui = G?.ui;
  const act = pl?.busyTurn; if (!b || !act || act.hp <= 0 || pl.pick) return null;
  if (!ui?.el?.menu?.classList?.contains('show')) return null;
  const out = []; const cand = [];
  for (const u of b.units) { if (u === act || u.hp <= 0 || u.removed) continue; const d = Math.abs(u.x - act.x) + Math.abs(u.z - act.z); if (d <= 4) cand.push([d, u]); }
  cand.sort((p, q) => p[0] - q[0]);
  for (let i = 0; i < cand.length && out.length < 2; i++) out.push(unitFocus(b, cand[i][1], 'menu' + out.length));
  return out;
}

// Focus shapes for the things a player looks at. `battle` is the Battle; heights come from the sprite.
// PERF r11: the provider calls these every frame; each key gets one reused focus object (the cutaway copies the
// values into its slots, so nothing holds on to it). Note: the returned object is overwritten by the next call
// with the same key.
const _foc = new Map();
function focusObj(key) { let f = _foc.get(key); if (!f) { f = { key, pos: new THREE.Vector3(), rx: 1, ry: 1, feet: 0, depth: 4.5 }; _foc.set(key, f); } return f; }
export function unitFocus(battle, u, key, scale = 1) {
  const s = battle.spriteOf(u); const p = s ? s.root.position : battle.worldPos(u.x, u.z);
  const h = (s && s.heightUnits) || 1.5;
  // R18 (review17 P9: a staged scene opened the hut BESIDE the speakers into a black hollow box): the sideways reach is
  // the body's own half-width plus a hand's breadth (0.4 x height, at least 0.55), not a flat 1.05 -- with the prop's
  // screen half-extent added in the shader, 1.05 opened any house whose EDGE came within a tile of the unit's centre,
  // i.e. houses that hid nothing. A prop now opens only when its box actually crosses the silhouette.
  const f = focusObj(key); f.pos.set(p.x, p.y + h * 0.5, p.z); f.rx = Math.max(0.55, h * 0.4) * scale; f.ry = (h * 0.5 + 0.55) * scale; f.feet = p.y - 0.02; f.depth = 3.6 + h; return f;
}
export function tileFocus(pos, key, scale = 1) {
  // a tile (cursor / selected target): centre lifted so a unit standing on it is inside, ellipse wide enough to
  // show the neighbouring tiles of a field
  const f = focusObj(key); f.pos.set(pos.x, pos.y + 0.6, pos.z); f.rx = 1.45 * scale; f.ry = 1.3 * scale; f.feet = pos.y - 0.06; f.depth = 3.5; return f;
}
// The highlighted move/target field (TileOverlay fills, renderOrder 3): one ellipse over the part of the field
// nearest the actor (or the whole field), so a Move range that runs behind a house is readable before the
// cursor ever goes there. Read-only on the overlay; cached on the fill count + first tile.
const _fc = { key: '', f: null };
export function fieldFocus(overlay, near) {
  const kids = overlay?.group?.children; if (!kids || !kids.length) { _fc.key = ''; return null; }
  let n = 0, key = '';
  const pts = [];
  for (const k of kids) if (k.renderOrder === 3 && k.isMesh) { pts.push(k.position); n++; }
  if (!n) { _fc.key = ''; return null; }
  key = n + '|' + pts[0].x + ',' + pts[0].z + '|' + pts[n - 1].x + ',' + pts[n - 1].z + '|' + (near ? near.x.toFixed(2) + ',' + near.z.toFixed(2) : '');
  if (key === _fc.key) return _fc.f;
  // centre: the field's centroid, pulled halfway to the actor so the ellipse stays on the part the player reads
  const c = new THREE.Vector3(); let ymin = Infinity; for (const p of pts) { c.add(p); ymin = Math.min(ymin, p.y); } c.multiplyScalar(1 / n);
  if (near) { c.x = (c.x + near.x) / 2; c.z = (c.z + near.z) / 2; }
  let ext = 0; for (const p of pts) ext = Math.max(ext, Math.hypot(p.x - c.x, p.z - c.z));
  const r = Math.min(2.6, Math.max(1.4, ext * 0.8));
  _fc.key = key; _fc.f = { key: 'field', pos: new THREE.Vector3(c.x, ymin + 0.7, c.z), rx: r, ry: r * 0.7 + 0.4, feet: ymin - 0.06, depth: 2.6 };
  return _fc.f;
}
