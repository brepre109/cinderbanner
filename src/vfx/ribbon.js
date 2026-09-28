import * as THREE from 'three';
// Camera-facing additive ribbon along an arbitrary 3D polyline, with a draw-on reveal and a soft width profile.
// Used for the Protect/Haste helix and for magic swirls. Vertex colour carries the alpha ramp.
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
export class Ribbon {
  constructor(scene, pts, { color = 0x8ef0ff, core = 0xffffff, width = 0.16, life = 1.0, reveal = 0.35, hold = 0.45, renderOrder = 22, depthTest = true, coreWidth = 0.5 } = {}) {
    Object.assign(this, { scene, pts, width, life, reveal, hold, coreWidth, t: 0 });
    this.cGlow = new THREE.Color(color); this.cCore = new THREE.Color(core);
    const mk = () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest, side: THREE.DoubleSide, toneMapped: false });
    this.matGlow = mk(); this.matCore = mk();
    this.gGlow = new THREE.BufferGeometry(); this.gCore = new THREE.BufferGeometry();
    this.mGlow = new THREE.Mesh(this.gGlow, this.matGlow); this.mCore = new THREE.Mesh(this.gCore, this.matCore);
    for (const m of [this.mGlow, this.mCore]) { m.frustumCulled = false; m.renderOrder = renderOrder; scene.add(m); }
    this.fwd = new THREE.Vector3(-0.6, -0.5, -0.6).normalize();
  }
  // R7 (units/vfx): the ribbon used to rebuild fresh JS arrays AND fresh BufferAttributes every frame of its
  // reveal (two helices x 96 segments x ~70 frames per buff = ~280 GPU buffer re-creations per cast). The
  // buffers are now allocated ONCE for the full polyline and rewritten in place; the reveal is a draw range.
  alloc(geo) {
    const n = this.pts.length;
    const idx = new (n * 3 > 65535 ? Uint32Array : Uint16Array)(Math.max(0, n - 1) * 12);
    for (let i = 1, o = 0; i < n; i++) { const a = (i - 1) * 3, b = i * 3; for (let q = 0; q < 2; q++) { idx[o++] = a + q; idx[o++] = b + q; idx[o++] = a + q + 1; idx[o++] = a + q + 1; idx[o++] = b + q; idx[o++] = b + q + 1; } }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 9), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 9), 3).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);   // frustumCulled is off; never recomputed
  }
  build(frac) {
    const n = Math.max(2, Math.round(this.pts.length * frac));
    this.strip(this.gGlow, n, this.width, this.cGlow);
    this.strip(this.gCore, n, this.width * this.coreWidth, this.cCore);
  }
  strip(geo, count, width, color) {
    if (!geo.index) this.alloc(geo);
    const pts = this.pts, pa = geo.attributes.position, ca = geo.attributes.color, pos = pa.array, col = ca.array;
    for (let i = 0; i < count; i++) {
      const p = pts[i]; const d = tmp.subVectors(pts[Math.min(i + 1, count - 1)], pts[Math.max(i - 1, 0)]);
      if (d.lengthSq() < 1e-9) d.set(1, 0, 0); d.normalize();
      const perp = tmp2.crossVectors(d, this.fwd); if (perp.lengthSq() < 1e-9) perp.set(0, 1, 0); perp.normalize();
      const k = i / Math.max(1, count - 1);
      const hw = width * Math.min(1, Math.sin(k * Math.PI) * 3 + 0.2) * (p.w ?? 1);
      for (let v = 0; v < 3; v++) {
        const m = v - 1, c = v === 1 ? 1 : 0, o = (i * 3 + v) * 3;
        pos[o] = p.x + perp.x * hw * m; pos[o + 1] = p.y + perp.y * hw * m; pos[o + 2] = p.z + perp.z * hw * m;
        col[o] = color.r * c; col[o + 1] = color.g * c; col[o + 2] = color.b * c;
      }
    }
    pa.needsUpdate = true; ca.needsUpdate = true;
    geo.setDrawRange(0, Math.max(0, count - 1) * 12);
  }
  update(dt, cam) {
    this.t += dt;
    if (cam) this.fwd.setFromMatrixColumn(cam.matrixWorld, 2).negate().normalize();
    const k = this.t / this.life; if (k >= 1) return false;
    const rf = Math.min(1, this.t / this.reveal); this.build(rf * rf * (3 - 2 * rf) * 0.999 + 0.001);
    const a = k < this.hold ? Math.min(1, this.t / 0.08) : 1 - (k - this.hold) / (1 - this.hold);
    this.matGlow.opacity = a * 0.85; this.matCore.opacity = a;
    return true;
  }
  dispose() { for (const m of [this.mGlow, this.mCore]) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); } }
}
// helix of `turns` around a vertical axis at `at`, height h, radius r (optionally tapering)
export function helixPts(at, { turns = 2.4, h = 2.2, r = 0.75, r1 = r, segs = 90, phase = 0, dir = 1 } = {}) {
  const out = [];
  for (let i = 0; i <= segs; i++) { const k = i / segs; const a = phase + dir * k * turns * 6.2832; const rr = r + (r1 - r) * k;
    out.push({ x: at.x + Math.cos(a) * rr, y: at.y + k * h, z: at.z + Math.sin(a) * rr, w: 0.6 + 0.4 * Math.sin(k * Math.PI) }); }
  return out;
}
