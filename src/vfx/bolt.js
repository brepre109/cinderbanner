import * as THREE from 'three';
import { clipMaterial } from './clip.js';
// Drawn lightning: a jagged polyline rebuilt every few frames, rendered as two camera-facing additive ribbons
// (wide soft blue glow + thin white core). Vertex colour does the alpha: black edges add nothing.
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
export class Bolt {
  constructor(scene, rnd, { from, to, life = 0.38, jitterUntil = 0.26, amp = 0.55, segs = 18, branches = 3, glow = 0x5c8cff, core = 0xf4faff, widthGlow = 0.42, widthCore = 0.11, branchLen = 1.6, depthTest = true, renderOrder = 21, coreBoost = 1.2, clip = false }) {
    Object.assign(this, { scene, rnd, from: from.clone(), to: to.clone(), life, jitterUntil, amp, segs, branches, widthGlow, widthCore, branchLen, coreBoost, t: 0, next: 0 });
    this.cGlow = new THREE.Color(glow); this.cCore = new THREE.Color(core);
    this.matGlow = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest, side: THREE.DoubleSide, toneMapped: false });
    this.matCore = this.matGlow.clone();
    // CRITIQUE_R3 (vfx regression 1): ground arcs are clipped to the diorama; the bolt from the sky is NOT
    // (it lives above the board and the genre's bolts always come down out of frame - a reference capture).
    if (clip) { clipMaterial(this.matGlow); clipMaterial(this.matCore); }
    this.gGlow = new THREE.BufferGeometry(); this.gCore = new THREE.BufferGeometry();
    this.mGlow = new THREE.Mesh(this.gGlow, this.matGlow); this.mCore = new THREE.Mesh(this.gCore, this.matCore);
    for (const m of [this.mGlow, this.mCore]) { m.frustumCulled = false; m.renderOrder = renderOrder; scene.add(m); }
    this.right = new THREE.Vector3(0.7071, 0, -0.7071); this.fwd = new THREE.Vector3(-0.6, -0.5, -0.6).normalize();
  }
  setCamera(cam) { if (!cam) return; this.right.setFromMatrixColumn(cam.matrixWorld, 0).normalize(); this.fwd.setFromMatrixColumn(cam.matrixWorld, 2).negate().normalize(); }
  path(a, b, segs, amp) { // points with perpendicular (screen-plane) jitter, pinched at both ends
    const dir = tmp.subVectors(b, a); const len = dir.length(); dir.normalize(); const perp = tmp2.crossVectors(dir, this.fwd).normalize().clone();
    const pts = []; let off = 0;
    for (let i = 0; i <= segs; i++) { const k = i / segs; const env = Math.sin(k * Math.PI) ** 0.6; off += (this.rnd() - 0.5) * amp * 2; off *= 0.65; const p = new THREE.Vector3().lerpVectors(a, b, k).addScaledVector(perp, off * env * (0.4 + len * 0.08)); pts.push(p); }
    return pts;
  }
  build() {
    const main = this.path(this.from, this.to, this.segs, this.amp);
    const polylines = [{ pts: main, w: 1 }];
    for (let b = 0; b < this.branches; b++) { const i = 2 + Math.floor(this.rnd() * (main.length - 6)); const p0 = main[i]; const dirDown = new THREE.Vector3().subVectors(this.to, this.from).normalize(); const side = new THREE.Vector3().crossVectors(dirDown, this.fwd).normalize().multiplyScalar((this.rnd() < 0.5 ? -1 : 1) * this.branchLen * (0.5 + this.rnd())); const p1 = p0.clone().add(side).addScaledVector(dirDown, this.branchLen * (0.4 + this.rnd() * 0.8)); polylines.push({ pts: this.path(p0, p1, 7, this.amp * 0.7), w: 0.5 }); }
    this.ribbon(this.gGlow, polylines, this.widthGlow, this.cGlow); this.ribbon(this.gCore, polylines, this.widthCore, this.cCore);
  }
  ribbon(geo, polylines, width, color) {
    const pos = [], col = [], idx = []; let base = 0;
    for (const { pts, w } of polylines) {
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]; const d = tmp.subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize(); const perp = tmp2.crossVectors(d, this.fwd).normalize();
        const taper = Math.min(1, Math.sin(i / (pts.length - 1) * Math.PI) * 2.5 + 0.15); const hw = width * w * taper;
        for (const [m, c] of [[-1, 0], [0, 1], [1, 0]]) { pos.push(p.x + perp.x * hw * m, p.y + perp.y * hw * m, p.z + perp.z * hw * m); col.push(color.r * c, color.g * c, color.b * c); }
        if (i > 0) { const a = base + (i - 1) * 3, b = base + i * 3; for (let k = 0; k < 2; k++) idx.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1); }
      }
      base += pts.length * 3;
    }
    geo.setIndex(idx); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeBoundingSphere();
  }
  update(dt, cam) {
    this.t += dt; this.setCamera(cam);
    if (this.t < this.jitterUntil && this.t >= this.next) { this.build(); this.next = this.t + 0.045; }
    const k = this.t / this.life; const fade = this.t < this.jitterUntil ? 1 : Math.max(0, 1 - (this.t - this.jitterUntil) / (this.life - this.jitterUntil));
    const strobe = this.t < this.jitterUntil ? 0.75 + 0.25 * Math.sin(this.t * 90) : 1;
    this.matGlow.opacity = fade * strobe; this.matCore.opacity = Math.min(1, fade * this.coreBoost) * strobe;
    return k < 1;
  }
  dispose() { for (const m of [this.mGlow, this.mCore]) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); } }
}
