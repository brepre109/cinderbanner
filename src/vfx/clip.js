import * as THREE from 'three';
// DIORAMA CLIP (CRITIQUE_R3, vfx regression 1).
// fx_quake's dust skirt and its ballistic rubble drifted off the board and painted a soft grey-tan haze
// across the black void - the single most recognisable the genre read, and the thing lighting spent round 3
// restoring. In every reference (a reference capture's huge Fire, _41's quake, _46's Fire 2) the void stays pure
// black no matter how big the effect is: the genre's effects are drawn INSIDE the diorama's silhouette.
//
// So: one land mask, built once from MAP, in world XZ (tile x spans [x, x+1], centre x+0.5).
//   - particles    -> CPU coverage fade in ParticleSystem.update (per instance, so a puff fades as a
//                     whole instead of being sliced by a plane), and a hard kill once the centre is off
//                     the board, which is what "kill rubble that leaves the board" means.
//   - ground decals -> per-fragment mask in the shader (they are flat on the ground, so a hard cut at
//                     the diorama edge is exactly right).
//   - ground bolts  -> opt-in per-fragment mask (the sky bolt must NOT be clipped: it is above the board).
export const Clip = {
  on: false, w: 0, d: 0, grid: null, tex: null,
  setMap(map) {
    if (!map || !map.w || !map.d || this.on) return this.on;
    const w = map.w, d = map.d; const g = new Float32Array(w * d);
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) { const t = map.at ? map.at(x, z) : null; g[z * w + x] = (t && !t.void) ? 1 : 0; }
    this.w = w; this.d = d; this.grid = g;
    // texture carries a 1-tile zero border so ClampToEdge cannot smear land outward
    const W = w + 2, D = d + 2; const data = new Uint8Array(W * D);
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) data[(z + 1) * W + (x + 1)] = g[z * w + x] * 255;
    const t = new THREE.DataTexture(data, W, D, THREE.RedFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    this.tex = t; this.texParam = new THREE.Vector4(W, D, 0, 0); this.on = true; return true;
  },
  // If the battlefield is ever swapped at runtime, call Clip.reset() and the next effect rebuilds the mask.
  reset() { if (this.tex) this.tex.dispose(); this.tex = null; this.grid = null; this.on = false; },
  // bilinear land value at a world XZ; 1 solid ground, 0 void
  at(wx, wz) {
    if (!this.on) return 1;
    const u = wx - 0.5, v = wz - 0.5;               // tile-centre index space
    const x0 = Math.floor(u), z0 = Math.floor(v), fx = u - x0, fz = v - z0;
    const g = this.grid, w = this.w, d = this.d;
    const s = (x, z) => (x < 0 || z < 0 || x >= w || z >= d) ? 0 : g[z * w + x];
    const a = s(x0, z0), b = s(x0 + 1, z0), c = s(x0, z0 + 1), e = s(x0 + 1, z0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + e * fx) * fz;
  },
  // coverage of a billboard of half-width r standing at (wx,wz): centre weighted double, four offsets once
  cover(wx, wz, r) {
    if (!this.on) return 1;
    const c = this.at(wx, wz);
    if (c <= 0.02) return 0;                         // centre is off the board -> gone
    if (r <= 0.05) return c;
    const k = (c * 2 + this.at(wx + r, wz) + this.at(wx - r, wz) + this.at(wx, wz + r) + this.at(wx, wz - r)) / 6;
    return k < 0.02 ? 0 : k;
  },
};

// Per-fragment diorama mask for a MeshBasicMaterial (ground decals, ground bolts).
export function clipMaterial(mat) {
  if (!Clip.on || !mat || mat.userData.clipped) return mat;
  mat.userData.clipped = true;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uClipTex = { value: Clip.tex };
    sh.uniforms.uClipDim = { value: Clip.texParam };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vClipW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvClipW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uClipTex;\nuniform vec4 uClipDim;\nvarying vec3 vClipW;')
      .replace('#include <colorspace_fragment>', '\tgl_FragColor.a *= texture2D(uClipTex, (vClipW.xz + vec2(1.0)) / uClipDim.xy).r;\n#include <colorspace_fragment>');
  };
  mat.needsUpdate = true;
  return mat;
}
