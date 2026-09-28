import * as THREE from 'three';
import { CELLS } from './atlas.js';
import { Clip } from './clip.js';
// Instanced camera-facing billboard particles in WORLD units (works under the orthographic battle camera, unlike
// PointsMaterial whose size is pixels there). One draw call per blend mode. Sprite frame from the 4x4 atlas.
const VERT = /* glsl */`
attribute vec3 iPos; attribute vec2 iSize; attribute vec4 iColor; attribute float iRot; attribute float iFrame; attribute float iOcc; attribute float iBias;
varying vec2 vUv; varying vec4 vColor; varying float vOcc;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  mv.z += iBias;   // R13 view-space depth bias toward the camera (orthographic: no screen shift)
  float s = sin(iRot), c = cos(iRot);
  vec2 q = position.xy * iSize;
  mv.xy += vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  gl_Position = projectionMatrix * mv;
  float cells = ${CELLS}.0; float fx = mod(iFrame, cells), fy = floor(iFrame / cells);
  vUv = (uv + vec2(fx, cells - 1.0 - fy)) / cells;
  vColor = iColor; vOcc = iOcc;
}`;
// CRITIQUE_R2 rank 7: an over-1.0 additive sum used to clip per channel, so every hot core
// washed to achromatic white (measured core saturation 0.065-0.076 for ice, holy AND bolt).
// Ratio-preserving roll-off: keep the hue, compress only the magnitude, so Fire stays orange
// and Bolt stays blue at their brightest.
// R12 PEAK CONTROL (critic: 'the Fire core still blows out to white'). A plain additive stack is unbounded:
// twenty overlapping orange billows sum to (20, 7, 0.7), which the grade can only roll off to white. The
// additive system now blends ONE / ONE_MINUS_SRC_ALPHA with the colour premultiplied here and the alpha
// channel carrying only an OCCLUSION share (vOcc * coverage): each layer adds its light AND hides a fraction
// of what is behind it, so N layers of colour c converge to c / occ instead of N * c -- the peak of a dense
// stack is bounded by its brightest LAYER, keeps that layer's hue, and the bloom still carries the glow.
// occ 0 is exactly the old additive blend (sparks, glints and filaments keep it).
const FRAG = /* glsl */`
uniform sampler2D map; uniform float premul; varying vec2 vUv; varying vec4 vColor; varying float vOcc;
uniform vec4 guardA[4]; uniform float guardK[4];
void main() {
  vec4 t = texture2D(map, vUv);
  vec3 c = vColor.rgb * t.rgb;
  float m = max(max(c.r, c.g), c.b);
  if (m > 1.0) c = (c / m) * (1.0 + log(m) * 0.35);
  float a = t.a * vColor.a;
  // SPECT15 victim guard: inside the target's body ellipse (render-target px) every layer keeps only guardK of its
  // coverage, so the effect FRAMES the victim instead of erasing it. guardK 1.0 = no guard (the default).
  for (int i = 0; i < 4; i++) {
    if (guardK[i] < 0.999) {
      vec2 d = (gl_FragCoord.xy - guardA[i].xy) / guardA[i].zw;
      a *= mix(guardK[i], 1.0, smoothstep(0.7, 1.15, length(d)));
    }
  }
  if (a < 0.003) discard;
  gl_FragColor = premul > 0.5 ? vec4(c * a, a * vOcc) : vec4(c, a);
  #include <colorspace_fragment>
}`;

const hashPhase = (p) => { const v = p.x * 12.9898 + p.y * 78.233 + p.z * 37.719; return ((v % 6.2832) + 6.2832) % 6.2832; };

export class ParticleSystem {
  constructor(scene, atlas, { max = 1500, blending = THREE.AdditiveBlending, renderOrder = 20, occ = 0, occByFrame = null } = {}) {
    this.occByFrame = occByFrame;
    this.max = max; this.list = []; this.blending = blending;
    const base = new THREE.PlaneGeometry(1, 1); const geo = new THREE.InstancedBufferGeometry(); geo.index = base.index; geo.setAttribute('position', base.getAttribute('position')); geo.setAttribute('uv', base.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aFrame = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aOcc = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iOcc', this.aOcc);
    this.aBias = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage); geo.setAttribute('iBias', this.aBias);
    // additive systems use the bounded 'additive-over' blend (see FRAG); default occlusion per sprite frame is
    // set by the caller via p.occ, else `occ` (constructor option)
    const addLike = blending === THREE.AdditiveBlending; this.occ = addLike ? occ : 0;
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iSize', this.aSize); geo.setAttribute('iColor', this.aCol); geo.setAttribute('iRot', this.aRot); geo.setAttribute('iFrame', this.aFrame); geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: atlas }, premul: { value: addLike ? 1 : 0 }, guardA: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 1, 1)) }, guardK: { value: [1, 1, 1, 1] } }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true, blending, side: THREE.DoubleSide, toneMapped: false });
    if (addLike) {
      mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation;
      mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
      mat.blendSrcAlpha = THREE.ZeroFactor; mat.blendDstAlpha = THREE.OneFactor;
    }
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = renderOrder; this.mesh.name = 'vfx-particles'; scene.add(this.mesh);
    this.camera = null; this._sz = new THREE.Vector2((typeof window !== 'undefined' ? window.innerWidth : 1100), (typeof window !== 'undefined' ? window.innerHeight : 620));
    this.vpW = this._sz.x; this.vpH = this._sz.y;
    this.mesh.onBeforeRender = (r, s, cam) => { this.camera = cam; r.getSize(this._sz); this.vpW = this._sz.x; this.vpH = this._sz.y; this._applyGuards(r, cam, mat); };
    // SPECT15 victim guards: [{ x, y, z, h, k }] world feet + body height + coverage kept inside the body ellipse.
    // Set by VFX (guardVictim); projected here into the CURRENT render target's pixels, every draw.
    this.guards = []; this._gv = new THREE.Vector3(); this._gr = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
  }
  // ROUND-5 rank 1 (detached speed-lines): a particle can carry `arcA/arcB/arcR` - a world-space
  // segment approximating the SWING (feet-to-blade contact, which projects to a near-vertical screen
  // line) and a screen-pixel radius. Once its age passes `arcT`, a particle whose CENTRE strays further
  // than arcR px from that segment is hard-killed. distance-to-segment <= distance-to-any-point-on-it,
  // so culling to a segment GUARANTEES the acceptance bar 'max distance from swing arc > 40px = 0'.
  // Horizontal streaks that detach east of the contact cross the perpendicular budget and die; sparks
  // that travel ALONG the blade stay inside the tube and read as one continuous slash, not a gap.
  _arcKill(p, cam) {
    const W = this.vpW, H = this.vpH; if (!W || !H) return false;
    const a = this._v.set(p.arcA.x, p.arcA.y, p.arcA.z).project(cam);
    const ax = (a.x * 0.5 + 0.5) * W, ay = (0.5 - a.y * 0.5) * H;
    const b = this._v2.set(p.arcB.x, p.arcB.y, p.arcB.z).project(cam);
    const bx = (b.x * 0.5 + 0.5) * W, by = (0.5 - b.y * 0.5) * H;
    const q = this._v3.set(p.x, p.y, p.z).project(cam);
    const px = (q.x * 0.5 + 0.5) * W, py = (0.5 - q.y * 0.5) * H;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = L2 > 1e-6 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + t * dx - px, ey = ay + t * dy - py;
    return (ex * ex + ey * ey) > p.arcR * p.arcR;
  }
  // ROUND 5 determinism: the flicker phase used to be Math.random(), so a seeded capture at a frozen
  // clock still shimmered differently on every run and small blob/brightness metrics moved between two
  // captures of the SAME build. Derived from the particle's own spawn position instead: same scatter to
  // the eye, identical between runs.
  // p: {x,y,z, vx,vy,vz, life, delay, size, size1, ax, ay, growT, r,g,b, alpha, fadeIn, fadeOut, rot, rotv, frame, drag, grav, align, flick, pin, spin}
  add(p) { if (this.list.length >= this.max) this.list.shift(); p.age = 0; p.delay = p.delay || 0; p.vx = p.vx || 0; p.vy = p.vy || 0; p.vz = p.vz || 0; if (p.size1 == null) p.size1 = p.size; if (p.ax == null) p.ax = 1; if (p.ay == null) p.ay = 1; if (p.alpha == null) p.alpha = 1; if (p.fadeIn == null) p.fadeIn = 0.08; if (p.fadeOut == null) p.fadeOut = 1.5; p.rot = p.rot || 0; p.rotv = p.rotv || 0; p.frame = p.frame || 0; p.drag = p.drag || 0; p.grav = p.grav || 0; p.flick = p.flick || 0; p.phase = hashPhase(p); this.list.push(p); return p; }
  update(dt) {
    const cam = this.camera; const L = this.list; let n = 0;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.age += dt; if (p.age >= p.life || p.dead) { L.splice(i, 1); continue; }
      if (p.pin) { p.x = p.pin.x + (p.pinOff ? p.pinOff.x : 0); p.y = p.pin.y + (p.pinOff ? p.pinOff.y : 0); p.z = p.pin.z + (p.pinOff ? p.pinOff.z : 0); }
      else {
        if (p.grav) p.vy += p.grav * dt; if (p.drag) { const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; p.vz *= d; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.floor != null && p.y < p.floor) { // ROUND-5 rank 3: grit needs READABLE bounce arcs - 3 hits with decaying restitution so each hop is visibly shorter, then it settles (was a single 0.3 bounce that read as dust, not a pellet).
          p.y = p.floor; p.bounces = (p.bounces || 0) + 1;
          const e = (p.bounce || 0) * Math.pow(0.6, p.bounces - 1);
          if (p.bounces > 3 || e < 0.03) { p.vy = 0; p.vx *= 0.5; p.vz *= 0.5; }
          else { p.vy = -p.vy * e; p.vx *= 0.7; p.vz *= 0.7; }
        }
      }
      // R13: o.dr shrinks/grows the radius over life (a heal spiral closes IN onto the body), o.r0 floors it; o.ay accelerates the climb/fall
      if (p.orbit) { const o = p.orbit; const a = o.phase + o.w * p.age; const rr = o.dr ? Math.max(o.r0 || 0, o.r + o.dr * p.age) : o.r; p.x = o.cx + Math.cos(a) * rr; p.z = o.cz + Math.sin(a) * rr; p.y = o.cy + o.vy * p.age + (o.ay ? 0.5 * o.ay * p.age * p.age : 0); }
      p.rot += p.rotv * dt;
      // swing-arc containment (see _arcKill). Enforced every frame the particle is alive past arcT.
      if (p.arcA && cam && p.age >= (p.arcT || 0) && this._arcKill(p, cam)) { L.splice(i, 1); continue; }
    }
    const pos = this.aPos.array, siz = this.aSize.array, col = this.aCol.array, rot = this.aRot.array, frm = this.aFrame.array, occ = this.aOcc.array, bia = this.aBias.array;
    const OF = this.occByFrame, O0 = this.occ;
    // Draw order matters under the bounded blend (a later layer hides part of an earlier one): heavy volumetric
    // layers first, glows next, hot cores / sparks last, so the nucleus sits ON the flame instead of under it.
    // Three stable buckets (occ >= 0.4 | 0.2..0.4 | < 0.2); purely additive systems (occ 0) keep list order.
    // R13: no per-frame closures/arrays -- the three occlusion buckets are an index loop over a static table
    const nPass = this.occ || OF ? 3 : 1;
    for (let pass = 0; pass < nPass; pass++) for (let li = 0; li < L.length; li++) {
      const p = L[li];
      if (p.delay > 0) continue; if (nPass > 1) { const o = p.occ != null ? p.occ : OF && OF[p.frame] != null ? OF[p.frame] : O0; if (pass === 0 ? o < 0.4 : pass === 1 ? (o < 0.2 || o >= 0.4) : o >= 0.2) continue; }
      const k = p.age / p.life;
      const gk = p.growT ? Math.min(1, p.age / p.growT) : k; const ge = 1 - (1 - gk) * (1 - gk);
      const s = p.size + (p.size1 - p.size) * ge;
      let a = p.alpha; if (k < p.fadeIn) a *= k / p.fadeIn; const fo = p.hold != null ? Math.max(0, (k - p.hold) / (1 - p.hold)) : k; a *= Math.pow(1 - fo, p.fadeOut);
      if (p.flick) a *= 1 - p.flick * (0.5 + 0.5 * Math.sin(p.age * 47 + p.phase) * Math.sin(p.age * 31 + p.phase * 2));
      // CRITIQUE_R3 (vfx regression 1): contain every particle inside the diorama. A puff fades as a whole
      // (per-instance coverage, never sliced by a plane) and anything whose centre leaves the board dies -
      // that is the dust haze and the ballistic rubble that were painting the black void.
      if (Clip.on && !p.noclip) { const cv = Clip.cover(p.x, p.z, s * p.ax * 0.5); if (cv <= 0) { p.dead = true; continue; } a *= cv; }
      let r = p.rot; if (p.align && cam) { const v = this._v.set(p.vx, p.vy, p.vz); if (p.pin && p.pinVel) v.copy(p.pinVel); v.transformDirection(cam.matrixWorldInverse); r = Math.atan2(v.y, v.x) + p.rot; }
      pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z; siz[n * 2] = s * p.ax; siz[n * 2 + 1] = s * p.ay;
      // R12 colour-over-life: p.c1 = {r,g,b} the particle cools toward (by age/life, or age/cT), so a billow can
      // go orange -> deep red -> soot instead of holding a flat saturated red until it fades (the 'red fog').
      let cr = p.r, cg = p.g, cb = p.b;
      if (p.c1) { const kc = p.cT ? Math.min(1, p.age / p.cT) : k; cr += (p.c1.r - cr) * kc; cg += (p.c1.g - cg) * kc; cb += (p.c1.b - cb) * kc; } col[n * 4] = cr; col[n * 4 + 1] = cg; col[n * 4 + 2] = cb; col[n * 4 + 3] = a; rot[n] = r; frm[n] = p.frame; bia[n] = p.zb || 0; occ[n] = p.occ != null ? p.occ : OF && OF[p.frame] != null ? OF[p.frame] : O0; n++;
    }
    this.mesh.geometry.instanceCount = n; this.mesh.visible = n > 0;
    if (n) { this.aPos.needsUpdate = true; this.aSize.needsUpdate = true; this.aCol.needsUpdate = true; this.aRot.needsUpdate = true; this.aFrame.needsUpdate = true; this.aOcc.needsUpdate = true; this.aBias.needsUpdate = true; this.aPos.addUpdateRange(0, n * 3); }
  }
  _applyGuards(r, cam, mat) {
    const G = this.guards, A = mat.uniforms.guardA.value, K = mat.uniforms.guardK.value;
    for (let i = 0; i < 4; i++) K[i] = 1;
    if (!G.length || !cam) return;
    const rt = r.getRenderTarget(); const W = rt ? rt.width : this._sz.x * r.getPixelRatio(), H = rt ? rt.height : this._sz.y * r.getPixelRatio();
    const right = this._gr.setFromMatrixColumn(cam.matrixWorld, 0); right.y = 0; if (right.lengthSq() > 1e-6) right.normalize();
    const px = (x, y, z) => { const v = this._gv.set(x, y, z).project(cam); return [(v.x * 0.5 + 0.5) * W, (v.y * 0.5 + 0.5) * H]; };
    for (let i = 0; i < Math.min(4, G.length); i++) {
      const g = G[i]; const f = px(g.x, g.y, g.z), hd = px(g.x, g.y + g.h, g.z), sd = px(g.x + right.x * 0.42, g.y + g.h * 0.5, g.z + right.z * 0.42);
      const cx = (f[0] + hd[0]) / 2, cy = (f[1] + hd[1]) / 2;
      const ry = Math.max(4, Math.hypot(hd[0] - f[0], hd[1] - f[1]) * 0.62), rx = Math.max(4, Math.hypot(sd[0] - cx, sd[1] - cy) * 1.25);
      A[i].set(cx, cy, rx, ry); K[i] = g.k;
    }
  }
  get count() { return this.list.length; }
}
