import * as THREE from 'three';
import { HSTEP } from '../core/config.js';

// Tier-0 of the render ladder (PLAN 6.4): what you see WHILE the pointer is down.
//
// A true buildTerrain over the shipped 20x20 map is ~50 ms. That is fine once per stroke and
// fatal at 60 Hz, so a stroke paints into geometry that was allocated once at boot and is never
// resized, re-created or garbage: two buffers, two draw calls, one `needsUpdate` per pointermove.
// The prisms are deliberately NOT a preview of the final look — they are a legible, height-tinted
// block diagram of the cells the stroke has touched so far, sitting on top of the last true build.
// The truth arrives on release (tier 1), and it is the real renderer, so nothing here has to lie.
//
// Budget: 4096 tiles x 5 faces x 6 verts = 122,880 verts. position Float32 (1.47 MB) + color
// Uint8-normalised (0.37 MB) = ~1.84 MB resident, allocated in the constructor and held for the
// life of the editor. Colour as bytes rather than floats is the whole reason this fits the budget.

const FACES = 5, VPF = 6;                       // top + 4 walls; 2 triangles per face
// Mean albedo per surface letter, matched to textures.js's FALLBACK base colours so a ghost tile
// reads as the same material it is about to become. Mirrored deliberately: importing textures.js's
// private FALLBACK table would mean editing a forbidden file to export it.
const PALETTE = {
  g: [92, 132, 52], k: [66, 104, 44], d: [150, 112, 66], s: [142, 142, 150], b: [128, 92, 52],
  r: [150, 140, 116], sand: [204, 178, 120], S: [204, 178, 120], w: [52, 128, 208], v: [24, 24, 30],
};
const MISS = [150, 112, 66];                    // terrain.js's own fallback for an unknown letter: dirt

export class Ghost {
  /**
   * @param {THREE.Scene} scene  the ghost adds itself and stays hidden until the first flush
   * @param {{capacity?:number}} [opts] tiles the buffers can hold; over that, extra tiles are dropped
   */
  constructor(scene, { capacity = 4096 } = {}) {
    this.capacity = capacity;
    const verts = capacity * FACES * VPF;
    this.pos = new Float32Array(verts * 3);
    this.col = new Uint8Array(verts * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3, true).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    // polygonOffset because the ghost sits exactly on top of the stale true build it is correcting;
    // toneMapped:false because the grade pass owns tone mapping and a UI overlay must not be graded.
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.86,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false,
      side: THREE.DoubleSide, depthWrite: false });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'ghost'; this.mesh.renderOrder = 5; this.mesh.frustumCulled = false;
    this.mesh.visible = false; this.mesh.matrixAutoUpdate = false;

    this.linePos = new Float32Array(capacity * 4 * 2 * 3);
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    lgeo.setDrawRange(0, 0);
    this.lineMat = new THREE.LineBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.9,
      depthTest: false, toneMapped: false });
    this.lines = new THREE.LineSegments(lgeo, this.lineMat);
    this.lines.name = 'ghost_ring'; this.lines.renderOrder = 6; this.lines.frustumCulled = false;
    this.lines.visible = false; this.lines.matrixAutoUpdate = false;

    this.n = 0; this.ln = 0;                    // write cursors, in VERTICES
    // Three's addUpdateRange() allocates a {start,count} record per call and WebGLAttributes clears
    // the list after each upload — one object per attribute per pointermove. These three are pushed
    // back in instead, which is what makes the in-stroke path allocate literally nothing.
    this._ranges = [{ start: 0, count: 0 }, { start: 0, count: 0 }, { start: 0, count: 0 }];
    this.scene = scene; scene.add(this.mesh); scene.add(this.lines);
  }

  /** Reset the write cursors. Cheap enough to call on every pointermove; touches no GPU state. */
  begin() { this.n = 0; this.ln = 0; return this; }

  /** One quad -> 6 verts. All-scalar arguments on purpose: no Vector3, no array, no allocation. */
  _quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, r, g, b) {
    const P = this.pos, C = this.col;
    let i = this.n * 3;
    P[i] = ax; P[i + 1] = ay; P[i + 2] = az; P[i + 3] = bx; P[i + 4] = by; P[i + 5] = bz;
    P[i + 6] = cx; P[i + 7] = cy; P[i + 8] = cz; P[i + 9] = ax; P[i + 10] = ay; P[i + 11] = az;
    P[i + 12] = cx; P[i + 13] = cy; P[i + 14] = cz; P[i + 15] = dx; P[i + 16] = dy; P[i + 17] = dz;
    for (let k = 0; k < 6; k++) { const j = i + k * 3; C[j] = r; C[j + 1] = g; C[j + 2] = b; }
    this.n += VPF;
  }

  /**
   * Write one tile as an extruded prism. `hBase` is where the stroke STARTED, so a raise draws the
   * column of rock it is adding and a lower draws the column it is cutting — the delta is the thing
   * the author is actually reasoning about.
   * @param {number} x @param {number} z  integer tile
   * @param {number} h  new height in h steps  @param {string} letter surface letter
   * @param {number} [hBase] height to extrude down/up from; defaults to 2h below
   */
  tile(x, z, h, letter, hBase) {
    if (this.n + FACES * VPF > this.capacity * FACES * VPF) return;
    const base = PALETTE[letter] || MISS;
    // Height tint: brightness rises with absolute h so a stroke reads as relief, not as a flat wash.
    const f = Math.min(1.45, Math.max(0.40, 0.62 + 0.045 * h));
    const r = Math.min(255, base[0] * f) | 0, g = Math.min(255, base[1] * f) | 0, b = Math.min(255, base[2] * f) | 0;
    const s = 0.72, rs = (r * s) | 0, gs = (g * s) | 0, bs = (b * s) | 0;   // walls read darker, as in terrain.js
    const y = h * HSTEP, y0 = (hBase === undefined ? h - 2 : hBase) * HSTEP;
    const x1 = x + 1, z1 = z + 1;
    this._quad(x, y, z, x, y, z1, x1, y, z1, x1, y, z, r, g, b);
    this._quad(x, y0, z, x, y, z, x1, y, z, x1, y0, z, rs, gs, bs);
    this._quad(x1, y0, z1, x1, y, z1, x, y, z1, x, y0, z1, rs, gs, bs);
    this._quad(x, y0, z1, x, y, z1, x, y, z, x, y0, z, rs, gs, bs);
    this._quad(x1, y0, z, x1, y, z, x1, y, z1, x1, y0, z1, rs, gs, bs);
  }

  /** One ring segment in world coordinates, at height `h`. */
  edge(x0, z0, x1, z1, h) {
    if (this.ln + 2 > this.capacity * 4 * 2) return;
    const L = this.linePos; let i = this.ln * 3; const y = h * HSTEP + 0.02;
    L[i] = x0; L[i + 1] = y; L[i + 2] = z0; L[i + 3] = x1; L[i + 4] = y; L[i + 5] = z1;
    this.ln += 2;
  }

  /** The brush footprint outline: all four edges of one tile. `mask` bits 1/2/4/8 = -z/+x/+z/-x. */
  ring(x, z, h, mask = 15) {
    if (mask & 1) this.edge(x, z, x + 1, z, h);
    if (mask & 2) this.edge(x + 1, z, x + 1, z + 1, h);
    if (mask & 4) this.edge(x + 1, z + 1, x, z + 1, h);
    if (mask & 8) this.edge(x, z + 1, x, z, h);
  }

  /** Mark [0, count) dirty on one attribute without minting a range record. */
  _upload(attr, slot, count) {
    const r = this._ranges[slot]; r.count = count;
    const list = attr.updateRanges;
    if (list.length !== 1 || list[0] !== r) { list.length = 0; list.push(r); }
    attr.needsUpdate = true;
  }

  /** Publish the cursors to the GPU: one partial upload per buffer, sized to what was written. */
  flush() {
    const a = this.mesh.geometry.attributes;
    this._upload(a.position, 0, this.n * 3);
    this._upload(a.color, 1, this.n * 3);
    this.mesh.geometry.setDrawRange(0, this.n);
    this.mesh.visible = this.n > 0;
    this._upload(this.lines.geometry.attributes.position, 2, this.ln * 3);
    this.lines.geometry.setDrawRange(0, this.ln);
    this.lines.visible = this.ln > 0;
    return this;
  }

  /** Hide without clearing: the truth build has landed and the ghost is no longer the better answer. */
  hide() { this.n = 0; this.ln = 0; this.mesh.visible = false; this.lines.visible = false; return this; }

  get active() { return this.mesh.visible || this.lines.visible; }

  dispose() {
    this.scene.remove(this.mesh); this.scene.remove(this.lines);
    this.mesh.geometry.dispose(); this.mat.dispose();
    this.lines.geometry.dispose(); this.lineMat.dispose();
  }
}
