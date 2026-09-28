import * as THREE from 'three';
import { activeMood, moodProps } from '../render/lighting.js';
import { HSTEP } from '../core/config.js';
import { tex } from './textures.js';

// Battlefield props: procedural architecture (houses, stairs, walls, bridges, fences) built from the painted
// tile textures, plus billboarded pixel-art sprites from /env (trees, barrels, well...) and flat decals.
// Everything is placed on the tile surface it belongs to; walk flags are decided in mapdata.js, not here.

const loader = new THREE.TextureLoader();
let manifest = null;
async function loadManifest() { if (manifest) return manifest; try { manifest = await (await fetch('./env/manifest.json')).json(); } catch { manifest = {}; } return manifest; }

// ---------- materials ----------
// Every prop material carries a painted fill (emissive = its own albedo x FILL) for the same reason terrain.js
// does: a face turned away from the key light must still read as painted plaster / stone / timber, never as a
// black silhouette. Without it a tower or a gable end in shadow is just a hole in the frame.
const MAT = {}, FILL = 0.36;
function mat(key, opts = {}) {
  const id = key + JSON.stringify(opts);
  if (!MAT[id]) { const t = tex(key).texture; MAT[id] = new THREE.MeshLambertMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: FILL, ...opts }); }
  return MAT[id];
}
// PERF r7: identical solid()/basic() materials are now one instance (keyed by colour + opts). Same program either
// way; sharing is what lets mergeStatic() below fold, e.g., every stall's goods into one draw.
// PERF r11: solids carry a 1x1 white map + emissiveMap. White decodes to exactly 1.0, so the colour is unchanged to the
// bit, but a solid now has the same program key as the textured mat() materials: one Lambert program instead of two.
const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE.colorSpace = THREE.SRGBColorSpace; WHITE.magFilter = WHITE.minFilter = THREE.NearestFilter; WHITE.needsUpdate = true;
const SOLID = {};
const solid = (color, opts = {}) => { const id = color + JSON.stringify(opts); return SOLID[id] || (SOLID[id] = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: FILL * 0.85, map: WHITE, emissiveMap: WHITE, ...opts })); };
const BASIC = {};
const basic = (color) => BASIC[color] || (BASIC[color] = new THREE.MeshBasicMaterial({ color }));
const TIMBER = solid(0x3d2a17), TIMBER_LIT = solid(0x55381f), SLATE = solid(0x2a2d36), GLASS = solid(0x1c2b45, { emissive: 0x0a1a33 });
const IRON = solid(0x30323a);

// ---------- geometry helpers ----------
// BoxGeometry with every face UV-scaled so a texture repeats once per `unit` world units (no stretching).
// Face order in BoxGeometry: +x, -x, +y, -y, +z, -z (4 verts each).
function texBox(w, h, d, unit = 1, uvOffset = [0, 0]) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / unit + uvOffset[0], uv.getY(k) * dims[f][1] / unit + uvOffset[1]); }
  return g;
}
function mesh(geo, material, x, y, z, shadow = true) { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; return m; }
function scaleUV(g, sx, sy) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy); return g; }
// A quad in 3D with explicit UV extents; normal from the winding (a,b,c,d counter-clockwise from the outside).
function quad(a, b, c, d, uw, vh, material) {
  const g = new THREE.BufferGeometry();
  const P = [a, b, c, a, c, d].flat(); const U = [[0, 0], [uw, 0], [uw, vh], [0, 0], [uw, vh], [0, vh]].flat();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, material); m.castShadow = true; m.receiveShadow = true; return m;
}
const SHADOW_MAT = {};
function contactShadow(rx, rz, opacity = 0.32) {
  const g = new THREE.CircleGeometry(1, 20); g.rotateX(-Math.PI / 2); g.scale(rx, 1, rz);
  const m = new THREE.Mesh(g, SHADOW_MAT[opacity] || (SHADOW_MAT[opacity] = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
  m.position.y = 0.01; m.renderOrder = 4; return m;
}

// ---------- sprites / decals ----------
// Deterministic per-instance hash: the mirror/scale jitter has to be identical on every reload or two
// screenshots of the same map are not comparable.
function phash(x, z, s = 0) { const h = Math.sin(x * 127.1 + z * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); }
// Foliage in the genre is a DARK silhouette that never out-values the grass under it (a reference capture, _36, _03) --
// but it is still unmistakably GREEN. Round 3 got the value right and threw the hue away: TINT 0.52/0.60/0.44
// and GLOW 0.30/0.37/0.25 are near-neutral multipliers (green only 15% over red), so measured canopy chroma
// fell to 22.5/20.8/22.3 (wide/high/rot1) against a reference capture's pine canopy at 45.5 -- desaturated grey-green
// mush. The source art is the other half of the problem: tree_pine.png's mean albedo is (81.5, 80.8, 34.6),
// i.e. khaki, R == G. So round 4 spends the budget on HUE: green is now ~5x red, with a little blue so the
// canopy is forest green rather than lime, and the level is set per species below rather than globally.
// Measured on the same tree, same frame, canopy mask taken from a flat-magenta repaint of the billboards:
//   canopy chroma (max-min, sRGB)  wide 26.9 -> 41.6   high 26.1 -> ~40   rot1 24.9 -> ~40
//   canopy L                       wide 36.2 -> 50.4, still 29 L BELOW the grass it stands on (79.4), so the
//   canopies never out-value the ground -- which is the round-2 failure this must not walk back into.
//   a reference capture's pine canopy (box 300,240-340,300) measures chroma 43.6 at L 41.0.
// TINT/GLOW are LINEAR multipliers on the painted albedo (Color.setRGB works in the linear working space).
// Per-SPECIES level. The six foliage PNGs are nowhere near a common value -- mean albedo luma is
// tree_pine 77.6, tree_pine_b 59.9, tree_oak_a 112.3, tree_oak_b 126.1, bush_a 104.5, bush_b 97.8, a 2.1x
// spread -- so one global tint either leaves the pines grey or turns the oaks into emerald stickers
// (which is exactly what happened the first time round 4 tried it). This pulls each sprite toward a common
// canopy value while leaving some species variation, and it scales TINT and GLOW together so the hue is
// identical across the map and only the level moves.
const FOLIAGE = new Set(['oak', 'pine', 'tree', 'bush']);
const LEAF_TINT = [0.15, 0.82, 0.26], LEAF_GLOW = [0.035, 0.80, 0.10];
const LEAF_LEVEL = { tree_pine: 1.16, tree_pine_b: 1.36, tree_oak_a: 0.76, tree_oak_b: 0.68, bush_a: 0.84, bush_b: 0.88 };
// A billboard is a disc of radius w/2 once it yaws to face the camera, so w <= 1.6 keeps every prop inside
// 0.3 tiles of overhang onto a neighbouring walkable tile (CRITIQUE_R2 rank 8, cross-owner half).
const SPRITE_MAX_W = 1.58;

// PERF r7: one texture fetch/upload per sprite NAME per build (was one per instance: 60 billboards -> 60 GPU
// textures for ~12 PNGs), and one material + shadow-depth material per (name, foliage) pair. Everything a single
// instance varies (mirror, size jitter, contact shadow) still happens in its own callback. The cache lives on the
// build (`bc`), never at module scope, so the editor's disposer still sees these as per-build resources.
function sharedTexture(bc, name, cb, aniso = 4) {
  const key = name + '|' + aniso; let e = bc.tex.get(key);
  if (!e) {
    e = { t: null, cbs: [] }; bc.tex.set(key, e);
    // PERF r11: buildProps() now resolves only once every sprite has landed (bc.pending), so the first frame, the
    // program warm-up and the first shadow bake all see the final billboards (a late sprite used to swap its
    // material to the map variant = a second program link, and bump the shadow cache, after 'ready').
    bc.pending.push(new Promise((done) => loader.load(`./env/${name}.png`, (t) => {
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.colorSpace = THREE.SRGBColorSpace; if (aniso !== 1) t.anisotropy = aniso;
      e.t = t; const cbs = e.cbs; e.cbs = []; for (const f of cbs) f(t); done();
    }, undefined, () => done())));
  }
  if (e.t) cb(e.t); else e.cbs.push(cb);
}
function billboardSprite(name, man, p, bc) {
  const info = man[name + '.png'] || {}; const heightTiles = info.heightTiles || 1;
  const g = new THREE.Group(); g.name = 'prop_' + name;
  const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0);
  const leafy = FOLIAGE.has(p && p.type);
  // Lambert, not Basic (CRITIQUE_R2 rank 11): an unlit prop takes no key, no shadow and no grade coupling,
  // which is exactly why the canopies read as highlighter stickers pasted onto a graded scene. The emissive
  // painted fill keeps the away-from-key side from collapsing to a hole, the same trick terrain.js uses.
  const mkey = name + (leafy ? '|leaf' : '');
  let S = bc.bill.get(mkey);
  if (!S) {
    const material = new THREE.MeshLambertMaterial({ transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: (leafy ? 1.0 : 0.34) * (leafy ? bc.leaf : bc.sprite) });
    if (leafy) { const k = LEAF_LEVEL[name] || 1; material.color.setRGB(LEAF_TINT[0] * k, LEAF_TINT[1] * k, LEAF_TINT[2] * k); material.emissive.setRGB(LEAF_GLOW[0] * k, LEAF_GLOW[1] * k, LEAF_GLOW[2] * k); }
    S = { material, depth: null }; bc.bill.set(mkey, S);
  }
  const material = S.material;
  const m = new THREE.Mesh(geo, material); m.visible = false; m.userData.billboard = true; m.castShadow = true; m.receiveShadow = false; m.renderOrder = 8; g.add(m);
  const px = p ? p.x : 0, pz = p ? p.z : 0, r = phash(px, pz, 3), r2 = phash(px, pz, 11);
  sharedTexture(bc, name, (t) => {
    if (!S.depth) {
      material.map = t; material.emissiveMap = t; material.needsUpdate = true;
      // the alpha cut must be honoured in the shadow pass, or a tree casts its whole bounding quad
      S.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: t, alphaTest: 0.5 });
      S.depth.side = THREE.DoubleSide;
    }
    m.customDepthMaterial = S.depth;
    const asp = t.image.width / t.image.height;
    // per-instance jitter (mirror + size): eight pines must be eight silhouettes, not one stamp in a row
    const sc = leafy ? 0.84 + 0.26 * r : 1, mir = leafy && r2 < 0.5 ? -1 : 1;
    let w = heightTiles * asp * sc, h = heightTiles * sc * (leafy ? 0.92 + 0.15 * r2 : 1);
    if (w > SPRITE_MAX_W) { h *= SPRITE_MAX_W / w; w = SPRITE_MAX_W; }
    m.scale.set(w * mir, h, 1); m.visible = true;
    g.add(contactShadow(Math.min(0.46, w * 0.30), Math.min(0.28, w * 0.18), 0.32));
    bc.onLoad();
  });
  return g;
}
function decalSprite(name, man, bc) {
  const info = man[name + '.png'] || {}; const size = info.heightTiles || 0.6;
  const g = new THREE.Group(); g.name = 'decal_' + name;
  let material = bc.decal.get(name);
  // R7: LIT (was MeshBasic). An unlit decal ignored the key, the cast shadows and every map mood, so the patch read
  // as a flat sticker at full value under a house's shadow or at night. Lambert + the same painted emissive fill the
  // billboards use keeps it readable on the away-from-key side while shadows and moods now land on it.
  if (!material) { material = new THREE.MeshLambertMaterial({ transparent: true, alphaTest: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, emissive: 0xffffff, emissiveIntensity: 0.30 * bc.leaf }); bc.decal.set(name, material); }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material); m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 3; m.position.y = 0.012; m.receiveShadow = true; g.add(m);
  // decals keep their own texture objects (default anisotropy, unlike billboards), so they are keyed apart
  sharedTexture(bc, name, (t) => { if (!material.map) { material.map = t; material.emissiveMap = t; material.needsUpdate = true; }
    const asp = t.image.width / t.image.height; m.scale.set(size * asp * 1.6, size * 1.6, 1); m.visible = true; bc.onLoad(); }, 1);
  return g;
}

// ---------- roofs ----------
// CRITIQUE_R2 rank 10 + regression 14: `mat('roof')` returned ONE cached material shared by all eight houses
// and the gate, so the whole north band was a single saturated-red mass and no per-house variation was
// possible. Roofs are now cloned per instance and re-tinted deterministically, in three families the way
// a reference capture's town does it (dark pantile, grey-blue slate, straw thatch).
let thatchTex = null;
function thatch() {
  if (thatchTex) return thatchTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  g.fillStyle = '#8a6f3c'; g.fillRect(0, 0, 64, 64);
  const straw = ['#a8894e', '#6f5729', '#9a7c42', '#5d4a24', '#b39a5e'];
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * 64, y = rnd() * 64, l = 3 + rnd() * 8;
    g.strokeStyle = straw[(i * 7 + Math.floor(y)) % straw.length]; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 2.4, y + l); g.stroke();
  }
  for (let y = 5; y < 64; y += 13) { g.fillStyle = 'rgba(0,0,0,0.26)'; g.fillRect(0, y, 64, 2); g.fillStyle = 'rgba(255,230,170,0.10)'; g.fillRect(0, y + 2, 64, 1); }
  thatchTex = new THREE.CanvasTexture(c); thatchTex.magFilter = THREE.NearestFilter;
  thatchTex.wrapS = thatchTex.wrapT = THREE.RepeatWrapping; thatchTex.colorSpace = THREE.SRGBColorSpace; return thatchTex;
}
// Grey-blue slate: a red pantile stamp cannot be multiplied into slate (multiplying can only take channels
// down), so the second and third roof families get their own painted textures.
let slateTex = null;
function slates() {
  if (slateTex) return slateTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
  let seed = 31; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  g.fillStyle = '#2b313b'; g.fillRect(0, 0, 64, 64);
  const pal = ['#4d5766', '#414b58', '#596473', '#39414d', '#4a5b60', '#525c69'];
  for (let row = 0, y = 0; y < 64; row++, y += 9) {
    const off = (row % 2) ? -8 : 0;
    for (let x = off; x < 64; x += 16) {
      g.fillStyle = pal[Math.floor(rnd() * pal.length)];
      g.fillRect(x + 1, y + 1, 14, 10);
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x + 1, y + 1, 14, 1);
      g.fillStyle = 'rgba(0,0,0,0.30)'; g.fillRect(x + 1, y + 9, 14, 2);
      if (rnd() < 0.12) { g.fillStyle = 'rgba(96,116,72,0.35)'; g.fillRect(x + 1 + rnd() * 8, y + 2 + rnd() * 5, 4, 3); } // moss
    }
  }
  slateTex = new THREE.CanvasTexture(c); slateTex.magFilter = THREE.NearestFilter;
  slateTex.wrapS = slateTex.wrapT = THREE.RepeatWrapping; slateTex.colorSpace = THREE.SRGBColorSpace; return slateTex;
}
// linear multipliers on the painted roof albedo. 'tile' pulls the round-2 saturated red back to dark maroon
// and 'brown' to a dark umber pantile; 'slate' and 'thatch' carry their own texture and only take the
// per-instance jitter.
const ROOF_TINT = { tile: [0.56, 0.58, 0.60], slate: [0.92, 0.94, 1.0], brown: [0.50, 0.66, 0.42], thatch: [0.60, 0.56, 0.48] };
function roofMaterial(p) {
  const style = ROOF_TINT[p.roof] ? p.roof : 'tile';
  const own = style === 'thatch' ? thatch() : style === 'slate' ? slates() : null;
  const base = own
    ? new THREE.MeshLambertMaterial({ map: own, emissive: 0xffffff, emissiveMap: own, emissiveIntensity: FILL })
    : mat('roof').clone();
  const T = ROOF_TINT[style], r = phash(p.x || 0, p.z || 0, 5), j = 0.84 + 0.30 * r;
  base.color.setRGB(T[0] * j, T[1] * j, T[2] * j);
  base.emissive.setRGB(T[0] * j * 0.9, T[1] * j * 0.9, T[2] * j * 0.9);
  base.userData.roofStyle = style;
  return base;
}

// ---------- architecture ----------
// Half-timbered / stone house. Local frame: ridge along x, front (door) on +z. Footprint w x d tiles, rotated by rot*90°.
function house(p, map) {
  const g = new THREE.Group(); g.name = 'house';
  const hTile = map.at(p.x, p.z).h; const y0 = hTile * HSTEP;
  const rot = p.rot || 0; const lw = rot % 2 ? p.d : p.w, ld = rot % 2 ? p.w : p.d; // local dims
  const storeys = p.storeys || 1; const stoneGround = p.style === 'stone' || storeys === 2;
  const plinthH = 0.3, floorH = p.barn ? 1.85 : 1.28, jetty = 0.07;
  const plaster = mat('plaster'), stone = mat('stone_side'), roofM = roofMaterial(p), planks = mat('wood_side'), planksV = mat('wood_top');
  g.userData.stoneGable = p.gable === 'stone';
  const inset = 0.08; // walls sit inside the footprint so eaves and plinth overhang the tile edge
  const W = lw - inset * 2, Dd = ld - inset * 2;
  // plinth
  g.add(mesh(texBox(lw - 0.02, plinthH, ld - 0.02, 1.0), stone, 0, plinthH / 2, 0));
  let y = plinthH;
  for (let s = 0; s < storeys; s++) {
    const isStone = s === 0 && stoneGround; const ex = s > 0 ? jetty : 0; // upper storey jetties out
    const ww = W + ex * 2, dd = Dd + ex * 2;
    const body = mesh(texBox(ww, floorH, dd, isStone ? 1.0 : 0.78, [0, 0.02]), isStone ? stone : plaster, 0, y + floorH / 2, 0);
    g.add(body);
    if (!isStone) { // timber frame: corner posts, studs, sill and top plate
      for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(mesh(new THREE.BoxGeometry(0.11, floorH, 0.11), TIMBER, cx * ww / 2, y + floorH / 2, cz * dd / 2));
      const studs = (len, axis) => { const n = Math.max(1, Math.round(len / 0.78)); for (let i = 1; i < n; i++) { const o = -len / 2 + len * i / n; for (const sgn of [-1, 1]) { const m = axis === 'x' ? mesh(new THREE.BoxGeometry(0.08, floorH, 0.06), TIMBER, o, y + floorH / 2, sgn * dd / 2) : mesh(new THREE.BoxGeometry(0.06, floorH, 0.08), TIMBER, sgn * ww / 2, y + floorH / 2, o); g.add(m); } } };
      studs(ww, 'x'); studs(dd, 'z');
      // diagonal braces: the half-timber signature. Two per long face, mirrored, sill-to-plate.
      const brace = (len, axis) => {
        const bl = Math.hypot(len * 0.34, floorH - 0.2), ang = Math.atan2(floorH - 0.2, len * 0.34);
        for (const sgn of [-1, 1]) for (const dir of [-1, 1]) {
          const geo = new THREE.BoxGeometry(0.075, bl, 0.055);
          const m = axis === 'x' ? mesh(geo, TIMBER, dir * len * 0.28, y + floorH / 2, sgn * dd / 2)
                                 : mesh(geo, TIMBER, sgn * ww / 2, y + floorH / 2, dir * len * 0.28);
          if (axis === 'x') m.rotation.z = dir * ang - dir * Math.PI / 2; else { m.rotation.y = Math.PI / 2; m.rotation.x = -dir * ang + dir * Math.PI / 2; }
          g.add(m);
        }
      };
      brace(ww, 'x'); brace(dd, 'z');
      g.add(mesh(new THREE.BoxGeometry(ww + 0.06, 0.1, dd + 0.06), TIMBER, 0, y + 0.05, 0));
      g.add(mesh(new THREE.BoxGeometry(ww + 0.06, 0.1, dd + 0.06), TIMBER, 0, y + floorH - 0.05, 0));
    } else if (s === 0 && storeys > 1) { // jetty brackets under the overhang
      for (const [cx, cz] of [[-0.5, 1], [0, 1], [0.5, 1], [-0.5, -1], [0, -1], [0.5, -1]]) g.add(mesh(new THREE.BoxGeometry(0.1, 0.16, 0.14), TIMBER, cx * ww * 0.8, y + floorH - 0.08, cz * (dd / 2 + jetty / 2)));
    }
    // openings: door on the front of the ground floor, windows elsewhere
    const zf = dd / 2 + 0.005; // front face
    if (s === 0) {
      const doorW = p.barn ? 0.9 : 0.56, doorH = p.barn ? 1.25 : 0.98, dx = p.barn ? 0 : -ww * 0.18;
      g.add(mesh(texBox(doorW, doorH, 0.05, 0.5), planksV, dx, y + doorH / 2, zf + 0.01));
      g.add(mesh(new THREE.BoxGeometry(0.07, doorH + 0.06, 0.09), TIMBER_LIT, dx - doorW / 2 - 0.03, y + doorH / 2, zf + 0.02));
      g.add(mesh(new THREE.BoxGeometry(0.07, doorH + 0.06, 0.09), TIMBER_LIT, dx + doorW / 2 + 0.03, y + doorH / 2, zf + 0.02));
      g.add(mesh(new THREE.BoxGeometry(doorW + 0.2, 0.08, 0.1), TIMBER_LIT, dx, y + doorH + 0.03, zf + 0.02));
      g.add(mesh(texBox(doorW + 0.3, 0.07, 0.34, 1), stone, dx, plinthH - 0.035 + 0.07, zf + 0.17, false)); // doorstep
      if (!p.barn) window_(g, ww * 0.25, y + 0.62, zf, 'z', planks);
      else { const hay = mesh(new THREE.BoxGeometry(0.4, 0.3, 0.3), solid(0xc9a24a), ww * 0.3, y + 0.15, zf + 0.15); g.add(hay); }
    } else {
      window_(g, -ww * 0.22, y + 0.58, zf, 'z', planks); window_(g, ww * 0.22, y + 0.58, zf, 'z', planks);
    }
    // side windows (+x face) so the visible corner reads
    if (!p.barn) window_(g, ww / 2 + 0.005, y + 0.6, dd * (s ? -0.2 : 0.18), 'x', planks);
    y += floorH;
  }
  // roof: two slabs with real thickness, tiles running down the slope, eaves overhanging the walls
  const topW = W + (storeys > 1 ? jetty * 2 : 0), topD = Dd + (storeys > 1 ? jetty * 2 : 0);
  // eave 0.32 -> 0.20: at 0.32 the roof of a 2x2 house overhung the neighbouring walkable tile by 0.42 tiles
  // and sliced any sprite standing there in half (CRITIQUE_R2 rank 8 / integration 7).
  const eave = 0.20, rise = topD * 0.52 + 0.25, thick = 0.09;
  const halfD = topD / 2 + eave, L = topW + eave * 2 + 0.06, slope = Math.hypot(halfD, rise), ang = Math.atan2(rise, halfD);
  for (const sgn of [1, -1]) {
    const geo = texBox(L, thick, slope + 0.05, 0.62); // top face gets the tiles (L x slope)
    const slab = new THREE.Mesh(geo, [planks, planks, roofM, planks, planks, planks]); slab.castShadow = true; slab.receiveShadow = true; slab.userData.roofSlab = true;
    slab.position.set(0, y + rise / 2 + thick * 0.5, sgn * halfD / 2); slab.rotation.x = sgn * ang; g.add(slab);
  }
  g.add(mesh(new THREE.BoxGeometry(L + 0.04, 0.09, 0.2), SLATE, 0, y + rise + thick * 0.6, 0)); // ridge cap
  // eaves: a fascia board along each gutter line plus rafter tails poking out under it
  for (const sgn of [1, -1]) {
    const fy = y - eave * Math.tan(ang) * 0 + thick * 0.5, fz = sgn * halfD;
    g.add(mesh(texBox(L, 0.11, 0.07, 0.5), planks, 0, fy + 0.02, fz + sgn * 0.02));
    const n = Math.max(3, Math.round(L / 0.55));
    for (let i = 0; i <= n; i++) g.add(mesh(new THREE.BoxGeometry(0.07, 0.06, 0.24), TIMBER, -L / 2 + L * i / n, fy + 0.1, fz - sgn * 0.08));
  }
  // gable ends (plaster with timber trim) flush with the end walls. p.gable==='stone' builds a full masonry
  // gable carried up past the tiles with a stepped coping on the rake -- one house in the town has to break
  // the roof-line rhythm or the whole band is one stamp (CRITIQUE_R2 rank 10).
  const stoneGable = p.gable === 'stone';
  for (const sgn of [1, -1]) {
    const shape = new THREE.Shape(); shape.moveTo(-topD / 2, 0); shape.lineTo(topD / 2, 0); shape.lineTo(0, rise); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: stoneGable ? 0.14 : 0.06, bevelEnabled: false }); scaleUV(geo, 1 / 0.78, 1 / 0.78); geo.rotateY(Math.PI / 2);
    const gb = mesh(geo, stoneGable || (stoneGround && storeys === 1) ? stone : plaster, sgn * topW / 2 - (sgn > 0 ? (stoneGable ? 0.14 : 0.06) : 0), y, 0); g.add(gb);
    if (stoneGable) {
      // crow-stepped coping: five blocks climbing each rake, and a stack finial on the apex
      const steps = 5;
      for (let i = 0; i < steps; i++) for (const dir of [-1, 1]) {
        const f = (i + 0.5) / steps, bz = dir * (topD / 2) * (1 - f), by = rise * f;
        g.add(mesh(texBox(0.2, 0.13, topD / steps / 2 + 0.1, 0.4), stone, sgn * (topW / 2 + 0.02), y + by + 0.05, bz));
      }
      g.add(mesh(texBox(0.24, 0.2, 0.24, 0.4), stone, sgn * (topW / 2 + 0.02), y + rise + 0.08, 0));
    } else {
      const tie = mesh(new THREE.BoxGeometry(0.08, 0.08, topD), TIMBER, sgn * (topW / 2 + 0.01), y + 0.04, 0); g.add(tie);
      const king = mesh(new THREE.BoxGeometry(0.08, rise - 0.1, 0.08), TIMBER, sgn * (topW / 2 + 0.01), y + rise / 2, 0); g.add(king);
    }
  }
  // chimney through the roof
  if (p.chimney) {
    const cx = (p.chimney === 'left' ? -1 : 1) * (topW / 2 - 0.45); const ch = rise + 0.55;
    g.add(mesh(texBox(0.36, ch, 0.36, 0.7), stone, cx, y + ch / 2, 0.28));
    g.add(mesh(new THREE.BoxGeometry(0.44, 0.08, 0.44), SLATE, cx, y + ch + 0.04, 0.28));
  }
  // place: rotate around the footprint centre
  g.rotation.y = rot * Math.PI / 2;
  g.position.set(p.x + p.w / 2, y0, p.z + p.d / 2);
  g.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; } });
  return g;
}
function window_(g, x, y, z, axis, planks) {
  const w = 0.4, h = 0.42; const along = axis === 'z';
  const add = (geo, m, ox, oy, oz) => g.add(mesh(geo, m, along ? x + ox : x + oz, y + oy, along ? z + oz : z + ox, false));
  add(new THREE.BoxGeometry(along ? w : 0.05, h, along ? 0.05 : w), GLASS, 0, 0, 0.012);
  add(new THREE.BoxGeometry(along ? 0.04 : 0.06, h, along ? 0.06 : 0.04), TIMBER, 0, 0, 0.03);
  add(new THREE.BoxGeometry(along ? w : 0.06, 0.04, along ? 0.06 : w), TIMBER, 0, 0, 0.03);
  add(new THREE.BoxGeometry(along ? w + 0.12 : 0.05, 0.05, along ? 0.05 : w + 0.12), TIMBER, 0, h / 2 + 0.02, 0.025);
  add(new THREE.BoxGeometry(along ? w + 0.16 : 0.12, 0.06, along ? 0.12 : w + 0.16), TIMBER_LIT, 0, -h / 2 - 0.02, 0.05);
  for (const s of [-1, 1]) add(texBox(along ? 0.15 : 0.04, h + 0.04, along ? 0.04 : 0.15, 0.4), planks, s * (w / 2 + 0.1), 0, 0.03);
}

// Two-tread stone stair on one tile: the tile sits 1h above the low neighbour (that riser is terrain) and this
// block adds the second tread (+1h) on the uphill half. dir = direction of ascent: 'n' (-z), 's' (+z), 'e' (+x), 'w' (-x).
function stairs(p, map) {
  const t = map.at(p.x, p.z); const y = t.h * HSTEP; const stone = mat('stone_side'), cobble = mat('s');
  const g = new THREE.Group(); g.name = 'stairs';
  const along = p.dir === 'n' || p.dir === 's'; // ascent along z?
  const sgn = (p.dir === 's' || p.dir === 'e') ? 1 : -1; // +1: ascends toward +axis
  // treads: the terrain top is tread 0 (downhill third); tread 1 at +0.5h, tread 2 at +1h (uphill third, flush with the upper tile)
  const treads = [[1 / 3, 0.5], [2 / 3, 1.0]];
  for (const [start, hh] of treads) {
    const len = 1 - start; const height = hh * HSTEP + 0.08;
    const geo = texBox(along ? 1.0 : len, height, along ? len : 1.0, 1);
    const m = new THREE.Mesh(geo, [stone, stone, cobble, stone, stone, stone]); m.castShadow = true; m.receiveShadow = true;
    const c = sgn > 0 ? start + len / 2 : 1 - start - len / 2; // centre along the ascent axis
    m.position.set(p.x + (along ? 0.5 : c), y + height / 2 - 0.08, p.z + (along ? c : 0.5)); g.add(m);
    // nosing line so each step edge reads at 1x
    const edge = sgn > 0 ? start : 1 - start;
    const lip = new THREE.Mesh(new THREE.BoxGeometry(along ? 1.0 : 0.03, 0.025, along ? 0.03 : 1.0), SLATE);
    lip.position.set(p.x + (along ? 0.5 : edge), y + hh * HSTEP + 0.012, p.z + (along ? edge : 0.5)); g.add(lip);
  }
  const lip0 = new THREE.Mesh(new THREE.BoxGeometry(along ? 1.0 : 0.03, 0.025, along ? 0.03 : 1.0), SLATE);
  lip0.position.set(p.x + (along ? 0.5 : (sgn > 0 ? 0.015 : 0.985)), y + 0.012, p.z + (along ? (sgn > 0 ? 0.015 : 0.985) : 0.5)); g.add(lip0);
  return g;
}
// Low stone parapet along a tile edge, starting at edge point (x,z) and running len tiles along dir.
function wall(p) {
  const stone = mat('stone_side'); const hgt = 0.34, th = 0.16;
  const along = p.dir === 'x';
  const g = new THREE.Group(); g.name = 'wall';
  const body = mesh(texBox(along ? p.len : th, hgt, along ? th : p.len, 0.75), stone, p.x + (along ? p.len / 2 : th / 2 * (p.side || 1) * 0), p.h * HSTEP + hgt / 2, p.z + (along ? 0 : p.len / 2));
  // pull the wall in so it sits on the terrace rather than overhanging the drop
  if (along) body.position.z = p.z - th / 2 * (p.in ?? 1); else body.position.x = p.x - th / 2 * (p.in ?? 1);
  g.add(body);
  const cap = mesh(texBox(along ? p.len + 0.04 : th + 0.08, 0.06, along ? th + 0.08 : p.len + 0.04, 0.5), stone, body.position.x, p.h * HSTEP + hgt + 0.03, body.position.z); g.add(cap);
  return g;
}
// Dark arch opening on a bridge face (fakes the span under a stone bridge).
function arch(p) {
  const g = new THREE.Group(); g.name = 'arch';
  const r = p.r || 0.7; const y = p.h * HSTEP;
  const hole = new THREE.Mesh(new THREE.CircleGeometry(r, 24, 0, Math.PI), basic(0x05060a));
  const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.13, 24, 1, 0, Math.PI), mat('stone_side'));
  scaleUV(ring.geometry, 2, 2);
  for (const m of [hole, ring]) { m.position.set(p.x, y - 0.02, p.z); if (p.dir === 'z') m.rotation.y = p.flip ? Math.PI : 0; else m.rotation.y = p.flip ? -Math.PI / 2 : Math.PI / 2; m.position[p.dir === 'z' ? 'z' : 'x'] += (p.flip ? -1 : 1) * 0.015; m.renderOrder = 2; g.add(m); }
  return g;
}
// Wooden rail along an edge (footbridge / pier), posts + one rail.
function rail(p) {
  const g = new THREE.Group(); g.name = 'rail'; const planks = mat('wood_side'); const along = p.dir === 'x'; const y = p.h * HSTEP;
  for (let i = 0; i <= p.len * 2; i++) { const o = i / 2; g.add(mesh(new THREE.BoxGeometry(0.07, 0.62, 0.07), TIMBER, along ? p.x + o : p.x, y + 0.31, along ? p.z : p.z + o)); }
  g.add(mesh(texBox(along ? p.len : 0.05, 0.07, along ? 0.05 : p.len, 0.5), planks, along ? p.x + p.len / 2 : p.x, y + 0.56, along ? p.z : p.z + p.len / 2));
  g.add(mesh(texBox(along ? p.len : 0.05, 0.05, along ? 0.05 : p.len, 0.5), planks, along ? p.x + p.len / 2 : p.x, y + 0.3, along ? p.z : p.z + p.len / 2));
  return g;
}
// Post-and-rail fence occupying tiles (x,z).. along dir; sits on each tile's own surface.
function fence(p, map) {
  const g = new THREE.Group(); g.name = 'fence'; const planks = mat('wood_side'); const along = p.dir === 'x';
  const pts = [];
  for (let i = 0; i <= p.len; i++) { const tx = along ? p.x + i : p.x, tz = along ? p.z : p.z + i; const t = map.at(Math.min(tx, along ? p.x + p.len - 1 : tx), Math.min(tz, along ? tz : p.z + p.len - 1)); pts.push([tx + (along ? 0 : 0.5), (t ? t.h : 0) * HSTEP, tz + (along ? 0.5 : 0)]); }
  for (let i = 0; i < pts.length; i++) { const [x, y, z] = pts[i]; g.add(mesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), TIMBER_LIT, x + (along ? (i === 0 ? 0.06 : i === pts.length - 1 ? -0.06 : 0) : 0), y + 0.4, z + (along ? 0 : (i === 0 ? 0.06 : i === pts.length - 1 ? -0.06 : 0)))); }
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0, z0] = pts[i], [x1, y1, z1] = pts[i + 1]; const len = Math.hypot(x1 - x0, z1 - z0, y1 - y0);
    for (const ry of [0.62, 0.32]) { const r = mesh(texBox(len, 0.07, 0.05, 0.5), planks, (x0 + x1) / 2, (y0 + y1) / 2 + ry, (z0 + z1) / 2); r.rotation.y = along ? 0 : Math.PI / 2; r.rotation.z = along ? -Math.atan2(y1 - y0, x1 - x0) : 0; g.add(r); }
  }
  return g;
}

// Market stall: four posts, a striped canvas awning and a plank counter. Occupies one tile.
let stripeTex = null;
function stripes() {
  if (stripeTex) return stripeTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 16; const g = c.getContext('2d');
  for (let x = 0; x < 64; x++) { g.fillStyle = (x >> 3) % 2 ? '#c8402e' : '#e9dcc4'; g.fillRect(x, 0, 1, 16); }
  g.fillStyle = 'rgba(0,0,0,0.18)'; for (let x = 0; x < 64; x += 8) g.fillRect(x, 0, 1, 16);
  stripeTex = new THREE.CanvasTexture(c); stripeTex.magFilter = THREE.NearestFilter; stripeTex.wrapS = stripeTex.wrapT = THREE.RepeatWrapping; stripeTex.colorSpace = THREE.SRGBColorSpace; return stripeTex;
}
let CLOTH = null;
// Reverse the winding and the normals of a (possibly indexed) geometry: the same surface seen from its other side.
function flipFaces(geo) {
  if (geo.index) { const a = geo.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } geo.index.needsUpdate = true; }
  const n = geo.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return geo;
}
function stall(p, map) {
  const t = map.at(Math.floor(p.x), Math.floor(p.z)); const y = t.h * HSTEP; const g = new THREE.Group(); g.name = 'stall';
  const planks = mat('wood_side'); const cloth = CLOTH || (CLOTH = new THREE.MeshLambertMaterial({ map: stripes(), emissiveMap: stripes() }));
  const w = 0.92, d = 0.8, hFront = 1.35, hBack = 1.6;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(mesh(new THREE.BoxGeometry(0.07, sz > 0 ? hFront : hBack, 0.07), TIMBER_LIT, sx * w / 2, (sz > 0 ? hFront : hBack) / 2, sz * d / 2));
  g.add(mesh(texBox(w + 0.1, 0.07, d * 0.55, 0.5), planks, 0, 0.72, d * 0.1)); // counter
  g.add(mesh(texBox(w + 0.1, 0.62, d * 0.5, 0.5), planks, 0, 0.36, d * 0.12)); // counter front
  const awn = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.36, Math.hypot(d + 0.3, hBack - hFront + 0.1)), cloth); awn.geometry.attributes.uv.array.forEach((v, i, arr) => { if (i % 2 === 0) arr[i] *= 3; });
  awn.rotation.x = -Math.PI / 2 + Math.atan2(hBack - hFront + 0.1, d + 0.3); awn.position.set(0, (hFront + hBack) / 2 + 0.05, 0.04); awn.castShadow = true; g.add(awn);
  // PERF r11: the awning was one DoubleSide plane with a map-only material -- a program of its own. It is now two
  // coincident FrontSide planes (the underside wound and lit the other way, exactly what DoubleSide's gl_FrontFacing
  // flip did) with a black-emissive emissiveMap (adds 0, as before), i.e. the same program as every textured prop.
  // The shadow pass draws a FrontSide material's back faces, which for the pair is both sides, as DoubleSide did.
  const under = new THREE.Mesh(flipFaces(awn.geometry.clone()), cloth); under.rotation.copy(awn.rotation); under.position.copy(awn.position); under.castShadow = true; g.add(under);
  // goods: a couple of crates of colour on the counter
  g.add(mesh(new THREE.BoxGeometry(0.22, 0.14, 0.18), solid(0xb5442c), -0.25, 0.83, 0.05)); g.add(mesh(new THREE.BoxGeometry(0.2, 0.12, 0.16), solid(0x6d9a3a), 0.2, 0.82, 0.02)); g.add(mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), solid(0xd8b452), 0.0, 0.84, -0.12));
  g.rotation.y = (p.rot || 0) * Math.PI / 2; g.position.set(p.x, y, p.z);
  return g;
}

// ---------- ruins, tower and yard clutter ----------
// Deterministic wobble so ruins look collapsed rather than randomised on every reload.
function wob(i, s = 0) { const h = Math.sin((i * 12.9898 + s * 78.233) * 43758.5453); return h - Math.floor(h); }

// Round watchtower, broken off at the top. Footprint p.w x p.d tiles (2x2), p.th = shaft height in world units.
function tower(p, map) {
  const t = map.at(p.x, p.z); const y0 = (t ? t.h : 0) * HSTEP;
  const g = new THREE.Group(); g.name = 'tower';
  const R = 0.45 * Math.min(p.w || 2, p.d || 2), Hh = p.th || 3.2;
  const stone = mat('stone_side'), rock = mat('rock_side');
  const cyl = (rt, rb, h, seg = 16) => { const geo = new THREE.CylinderGeometry(rt, rb, h, seg, 1); scaleUV(geo, 2 * Math.PI * rb, h); return geo; };
  g.add(mesh(cyl(R * 1.1, R * 1.24, 0.36, 16), rock, 0, 0.18, 0));                 // battered plinth
  g.add(mesh(cyl(R * 0.95, R * 1.06, Hh, 16), stone, 0, 0.36 + Hh / 2, 0));        // shaft
  const top = 0.36 + Hh;
  // string course two thirds up, so the height is countable
  g.add(mesh(cyl(R * 1.04, R * 1.04, 0.09, 16), rock, 0, 0.36 + Hh * 0.62, 0));
  // hollow crown: dark interior disc ringed by broken merlons of uneven height
  const cap = new THREE.Mesh(new THREE.CircleGeometry(R * 0.84, 16), basic(0x090a0e));
  cap.rotation.x = -Math.PI / 2; cap.position.y = top - 0.14; cap.renderOrder = 2; g.add(cap);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2, hh = 0.08 + wob(i, 3) * 0.5;
    const b = mesh(texBox(R * 0.42, hh, 0.19, 0.5), stone, Math.cos(a) * R * 0.88, top - 0.14 + hh / 2, Math.sin(a) * R * 0.88);
    b.rotation.y = -a; g.add(b);
  }
  // doorway (dark) with a stone lintel, facing +z
  const dw = 0.4, dh = 0.78, zf = R * 0.99;
  const door = new THREE.Mesh(new THREE.PlaneGeometry(dw, dh), basic(0x06070b));
  door.position.set(0, 0.36 + dh / 2, zf); g.add(door);
  g.add(mesh(texBox(dw + 0.22, 0.1, 0.14, 0.4), rock, 0, 0.36 + dh + 0.05, zf - 0.02));
  for (const [ax, ay, az] of [[0, 1.5, 1], [-1, 2.2, 0.2], [0.6, 2.6, -0.8]]) { // arrow slits
    const sl = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.34), basic(0x06070b));
    const a = Math.atan2(az, ax * 0 + 1) + (ax < 0 ? Math.PI / 2 : 0);
    sl.position.set(Math.sin(a) * R * 0.99, 0.36 + ay, Math.cos(a) * R * 0.99); sl.rotation.y = a; g.add(sl);
  }
  // rubble skirt
  for (let i = 0; i < 6; i++) { const a = wob(i, 9) * Math.PI * 2, r = R * (1.00 + wob(i, 4) * 0.18);
    g.add(mesh(texBox(0.2 + wob(i, 5) * 0.14, 0.13, 0.18, 0.4), rock, Math.cos(a) * r, 0.07, Math.sin(a) * r)); }
  g.add(contactShadow(R * 1.2, R * 1.2, 0.34));
  g.position.set(p.x + (p.w || 2) / 2, y0, p.z + (p.d || 2) / 2);
  return g;
}

// A collapsed masonry wall running len tiles along dir; p.th is the intact height.
function ruin(p, map) {
  const g = new THREE.Group(); g.name = 'ruin';
  const along = p.dir === 'x', rock = mat('rock_side'), stone = mat('stone_side');
  const th = 0.36, base = p.th || 1.4, segs = p.len * 3, sl = 1 / 3;
  const prof = [1, 0.9, 0.72, 0.44, 0.3, 0.58, 0.84, 1, 0.66, 0.36, 0.26, 0.52];
  for (let i = 0; i < segs; i++) {
    const off = (i + 0.5) * sl;
    const tx = along ? Math.floor(p.x + i * sl) : p.x, tz = along ? p.z : Math.floor(p.z + i * sl);
    const t = map.at(tx, tz); const y = (t ? t.h : 0) * HSTEP;
    const hh = Math.max(0.14, base * prof[i % prof.length]);
    const cx = along ? p.x + off : p.x + 0.5, cz = along ? p.z + 0.5 : p.z + off;
    const m = new THREE.Mesh(texBox(along ? sl + 0.005 : th, hh, along ? th : sl + 0.005, 0.62), i % 3 === 1 ? stone : rock);
    m.position.set(cx, y + hh / 2, cz); m.castShadow = true; m.receiveShadow = true; g.add(m);
    if (i % 4 === 0) g.add(mesh(texBox(along ? sl : th + 0.06, 0.06, along ? th + 0.06 : sl, 0.4), stone, cx, y + hh + 0.03, cz)); // surviving coping
  }
  // spilled blocks at the foot
  for (let i = 0; i < p.len * 2; i++) {
    const off = wob(i, 2) * p.len, side = wob(i, 6) > 0.5 ? 1 : -1;
    const tx = along ? Math.floor(p.x + off) : p.x, tz = along ? p.z : Math.floor(p.z + off);
    const t = map.at(tx, tz); if (!t) continue; const y = t.h * HSTEP;
    const bx = along ? p.x + off : p.x + 0.5 + side * (th / 2 + 0.16), bz = along ? p.z + 0.5 + side * (th / 2 + 0.16) : p.z + off;
    const b = mesh(texBox(0.24, 0.15, 0.2, 0.4), rock, bx, y + 0.075, bz); b.rotation.y = wob(i, 8) * 1.2; g.add(b);
  }
  return g;
}

// Broken column on a stepped plinth.
function pillar(p, map) {
  const x = Math.floor(p.x), z = Math.floor(p.z); const t = map.at(x, z); const y = (t ? t.h : 0) * HSTEP;
  const g = new THREE.Group(); g.name = 'pillar';
  const stone = mat('stone_side'), rock = mat('rock_side'); const hh = p.h || 1.2, R = 0.17;
  g.add(mesh(texBox(0.54, 0.13, 0.54, 0.5), rock, 0, 0.065, 0));
  g.add(mesh(texBox(0.42, 0.1, 0.42, 0.4), stone, 0, 0.18, 0));
  const shaft = new THREE.CylinderGeometry(R * 0.9, R, hh, 10); scaleUV(shaft, 2 * Math.PI * R, hh);
  g.add(mesh(shaft, stone, 0, 0.23 + hh / 2, 0));
  const cap = mesh(new THREE.CylinderGeometry(R * 0.86, R * 0.92, 0.13, 10), rock, 0.03, 0.23 + hh + 0.05, 0.02);
  cap.rotation.z = 0.2; g.add(cap);                                   // sheared-off top
  g.add(mesh(texBox(0.2, 0.12, 0.17, 0.4), rock, 0.3, 0.06, -0.26));  // a fallen drum beside it
  g.add(contactShadow(0.34, 0.34, 0.3));
  g.position.set(x + 0.5, y, z + 0.5);
  return g;
}

// Two-wheeled hand cart.
function cart(p, map) {
  const x = Math.floor(p.x), z = Math.floor(p.z); const t = map.at(x, z); const y = (t ? t.h : 0) * HSTEP;
  const g = new THREE.Group(); g.name = 'cart'; const planks = mat('wood_side');
  const bw = 0.84, bd = 0.5, bedY = 0.42;
  g.add(mesh(texBox(bw, 0.09, bd, 0.45), planks, 0, bedY, 0));
  for (const s of [-1, 1]) g.add(mesh(texBox(bw, 0.24, 0.06, 0.4), planks, 0, bedY + 0.16, s * bd / 2));
  g.add(mesh(texBox(0.06, 0.26, bd, 0.4), planks, -bw / 2, bedY + 0.17, 0));
  for (const s of [-1, 1]) {
    const wz = s * (bd / 2 + 0.055);
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.045, 6, 14), TIMBER); w.position.set(0.06, 0.26, wz); w.castShadow = true; g.add(w);
    for (let k = 0; k < 3; k++) { const sp = mesh(new THREE.BoxGeometry(0.46, 0.05, 0.045), TIMBER_LIT, 0.06, 0.26, wz); sp.rotation.z = k * Math.PI / 3; g.add(sp); }
    g.add(mesh(new THREE.BoxGeometry(0.55, 0.06, 0.06), TIMBER_LIT, 0.42, bedY - 0.03, s * bd * 0.3)); // shafts
  }
  g.add(mesh(texBox(0.3, 0.2, 0.3, 0.35), mat('wood_top'), -0.16, bedY + 0.14, 0)); // a sack of grain in the bed
  g.add(contactShadow(0.5, 0.32, 0.3));
  g.rotation.y = (p.rot || 0) * Math.PI / 2; g.position.set(x + 0.5, y, z + 0.5);
  return g;
}

// Stacked cordwood.
function woodpile(p, map) {
  const x = Math.floor(p.x), z = Math.floor(p.z); const t = map.at(x, z); const y = (t ? t.h : 0) * HSTEP;
  const g = new THREE.Group(); g.name = 'woodpile'; const bark = mat('wood_side'), end = mat('wood_top');
  const rows = [4, 4, 3, 2], L = 0.78, R = 0.085;
  for (let r = 0; r < rows.length; r++) for (let i = 0; i < rows[r]; i++) {
    const geo = new THREE.CylinderGeometry(R, R, L, 8); scaleUV(geo, 2 * Math.PI * R, L); geo.rotateZ(Math.PI / 2);
    const m = new THREE.Mesh(geo, [bark, end, end]); m.castShadow = true; m.receiveShadow = true;
    m.position.set(wob(r * 5 + i, 1) * 0.05, R + r * R * 1.72, (i - (rows[r] - 1) / 2) * R * 2.1 + (r % 2 ? R : 0));
    g.add(m);
  }
  g.add(mesh(new THREE.BoxGeometry(0.07, 0.62, 0.07), TIMBER, 0.02, 0.31, rows[0] * R * 1.05 + 0.07));
  g.add(mesh(new THREE.BoxGeometry(0.07, 0.62, 0.07), TIMBER, 0.02, 0.31, -(rows[0] * R * 1.05 + 0.07)));
  g.add(contactShadow(0.46, 0.44, 0.32));
  g.position.set(x + 0.5, y, z + 0.5);
  return g;
}

// Plank water trough.
function trough(p, map) {
  const x = Math.floor(p.x), z = Math.floor(p.z); const t = map.at(x, z); const y = (t ? t.h : 0) * HSTEP;
  const g = new THREE.Group(); g.name = 'trough'; const planks = mat('wood_side');
  const w = 0.82, d = 0.4, h = 0.3;
  g.add(mesh(texBox(w, 0.06, d, 0.4), planks, 0, 0.12, 0));
  for (const s of [-1, 1]) { g.add(mesh(texBox(w, h, 0.06, 0.4), planks, 0, 0.12 + h / 2, s * d / 2)); g.add(mesh(texBox(0.06, h, d, 0.4), planks, s * w / 2, 0.12 + h / 2, 0)); }
  const water = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, d - 0.1), basic(0x2e5f86));
  water.rotation.x = -Math.PI / 2; water.position.y = 0.12 + h * 0.78; g.add(water);
  for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.09, 0.12, 0.09), TIMBER, s * (w / 2 - 0.06), 0.06, 0));
  g.add(contactShadow(0.46, 0.26, 0.3));
  g.position.set(x + 0.5, y, z + 0.5);
  return g;
}

// Timber road gate: two posts, a lintel and a shingled cap. Walk-through, so it frames the lane.
function gate(p, map) {
  const x = Math.floor(p.x), z = Math.floor(p.z); const t = map.at(x, z); const y = (t ? t.h : 0) * HSTEP;
  const g = new THREE.Group(); g.name = 'gate'; const planks = mat('wood_side'), roofM = roofMaterial({ x: p.x, z: p.z, roof: p.roof || 'brown' }), stone = mat('stone_side');
  // span 1.9 -> 1.05: at 1.9 both posts stood a third of a tile inside the neighbouring lane tiles and cut
  // any sprite walking through in half (CRITIQUE_R2 rank 8).
  const span = 1.05, ph = 2.1;
  for (const s of [-1, 1]) {
    g.add(mesh(texBox(0.28, 0.24, 0.34, 0.5), stone, s * span / 2, 0.12, 0));
    g.add(mesh(texBox(0.19, ph, 0.19, 0.5), planks, s * span / 2, 0.24 + ph / 2, 0));
    g.add(mesh(new THREE.BoxGeometry(0.34, 0.1, 0.1), TIMBER, s * (span / 2 - 0.2), 0.24 + ph - 0.16, 0)); // brackets
  }
  g.add(mesh(texBox(span + 0.26, 0.19, 0.22, 0.5), planks, 0, 0.24 + ph + 0.1, 0));
  const cap = new THREE.Mesh(texBox(span + 0.34, 0.09, 0.46, 0.55), [planks, planks, roofM, planks, planks, planks]);
  cap.position.set(0, 0.24 + ph + 0.24, 0); cap.castShadow = true; g.add(cap);
  g.rotation.y = (p.rot || 0) * Math.PI / 2; g.position.set(x + 0.5, y, z + 0.5);
  return g;
}

// A bridge deck CARRIED OVER THE WATER as a prop (CRITIQUE_R2 rank 14). Round 2 built its two crossings by
// overwriting the river with SHORE tiles, which dammed one continuous course into three closed ponds and left
// columns 4, 9 and 10 with zero water. The tiles under a deck stay RIVER/'w' in the map; mapdata.js grants them
// walk from the map's DECKS list, and this prop lays the walking surface just clear of the water surface
// (terrain draws that at Y(h)+0.015) so the river runs on underneath.
// p: { x, z, len, dir:'x'|'z', w (tiles across), h (tile height), style:'stone'|'wood' }
function deck(p, map) {
  const g = new THREE.Group(); g.name = 'deck';
  const along = p.dir === 'x';
  const len = p.len || 1, across = p.w || 1;
  const y = (p.h || 0) * HSTEP;                 // water tile top
  const top = y + 0.05, th = 0.13;              // deck surface, just proud of the water
  const lx = along ? len : across, lz = along ? across : len;      // deck extent in tiles
  const cx = p.x + lx / 2, cz = p.z + lz / 2;
  const stoneStyle = p.style !== 'wood';
  const planks = mat('wood_side'), flags = mat('s'), side = mat('stone_side');
  // the deck slab: flagstones on a stone bridge, planks on a footbridge
  const slabGeo = texBox(lx - 0.06, th, lz - 0.06, stoneStyle ? 1.0 : 0.5);
  const slab = new THREE.Mesh(slabGeo, stoneStyle ? [side, side, flags, side, side, side] : [planks, planks, planks, planks, planks, planks]);
  slab.position.set(cx, top - th / 2, cz); slab.castShadow = true; slab.receiveShadow = true; g.add(slab);
  // piers / trestles dropping into the channel, so the deck is standing on something
  const piers = stoneStyle ? 2 : len;
  for (let i = 0; i < piers; i++) {
    const f = (i + 0.5) / piers, pl = stoneStyle ? 0.42 : 0.14, pw = stoneStyle ? (across - 0.3) : 0.14;
    const px = along ? p.x + len * f : cx, pz2 = along ? cz : p.z + len * f;
    const gg = texBox(along ? pl : pw, 0.5, along ? pw : pl, 0.6);
    g.add(mesh(gg, stoneStyle ? side : TIMBER, px, top - th - 0.22, pz2));
    if (stoneStyle) { // cutwater: a wedge on the upstream face
      const cw = mesh(texBox(along ? pl * 0.7 : 0.26, 0.42, along ? 0.26 : pl * 0.7, 0.6), side,
        along ? px : cx - (across / 2) * 0.72, top - th - 0.25, along ? cz - (across / 2) * 0.72 : pz2);
      cw.rotation.y = Math.PI / 4; g.add(cw);
    }
  }
  // edges: a low stone kerb, or plank rails with posts
  for (const sgn of [-1, 1]) {
    const ex = along ? cx : cx + sgn * (lx / 2 - 0.06), ez = along ? cz + sgn * (lz / 2 - 0.06) : cz;
    if (stoneStyle) {
      g.add(mesh(texBox(along ? lx : 0.16, 0.42, along ? 0.16 : lz, 0.7), side, ex, top + 0.21, ez));
      g.add(mesh(texBox(along ? lx + 0.05 : 0.22, 0.07, along ? 0.22 : lz + 0.05, 0.5), side, ex, top + 0.45, ez));
      for (const e2 of [-1, 1]) {   // end pillars, so the span reads as a bridge and not as a quay
        const ox = along ? cx + e2 * (lx / 2 - 0.1) : ex, oz = along ? ez : cz + e2 * (lz / 2 - 0.1);
        g.add(mesh(texBox(0.26, 0.62, 0.26, 0.5), side, ox, top + 0.31, oz));
        g.add(mesh(texBox(0.32, 0.08, 0.32, 0.4), side, ox, top + 0.66, oz));
      }
    } else {
      const n = len * 2;
      for (let i = 0; i <= n; i++) { const o = -((along ? lx : lz) / 2) + (along ? lx : lz) * i / n;
        g.add(mesh(new THREE.BoxGeometry(0.07, 0.6, 0.07), TIMBER, along ? cx + o : ex, top + 0.3, along ? ez : cz + o)); }
      for (const ry of [0.54, 0.3]) g.add(mesh(texBox(along ? lx : 0.05, 0.06, along ? 0.05 : lz, 0.5), planks, ex, top + ry, ez));
    }
  }
  return g;
}

// ---------- bare-rock patina (R5) ----------
// The map's bare-rock tops ('r') were the brightest surface in the whole frame. Measured on
// shots/map/r5_before_m with the terrain_r mesh repainted flat magenta as an exact mask: rock tops ran
// mean L 149.5 / 146.5 / 157.9 with max 250.7 / 254.3 / 255.0 (wide / high / rot1) and 1746 pixels over
// L=235, while the rock CLIFF faces (terrain_rock_side) topped out at 167 and grass sat at L 81. The
// brightest pixel in the map frame was an empty rock shelf. Two things stack to cause it: p/rock_top.png
// has the highest albedo of any top texture in the set (mean L 153.9 against grass_dark's 85.9), and every
// bare-rock tile on this map stands on the map's highest terraces, where terrain's tileTint() adds another
// ~8% for height. Round 3 hid these shelves by cutting the void bites two and three tiles deep, which cost
// 18 walkable tiles; round 4 got the playfield back and the blowout came back with it.
//
// So this treats the MATERIAL rather than the playfield: a weathering pass laid over the rock tops --
// lichen blotches and a dark mineral wash -- MULTIPLIED into the already-lit surface (the same
// DstColor x Zero blend units/sprites.js uses for its contact shadow) so it scales the light instead of
// replacing it. A flat unlit veil would LIGHTEN the rock that sits in shadow and flatten the terrace read;
// a multiply keeps every lighting cue and only takes the top off the highlights. Walk flags are untouched:
// this mesh is decoration with depthWrite off, and it is not in BLOCKING.
// PATINA_CEIL is the BRIGHTEST linear multiplier the wash ever applies; the mottle only ever goes DOWN from
// it. A mottle centred on a mean was measured to fail: at mean 0.40 the noise still peaked at 0.68, and the
// hottest texel of the rock albedo survived at L 236.4 (shots/map/r5_t2). Clamping the ceiling instead of the
// mean is what takes the top off the highlight without crushing the whole shelf to grass value.
// The texture is authored in LINEAR (colorSpace NoColorSpace, so a byte IS the multiplier) because the scene
// renders to a HalfFloat linear target with tone mapping owned by the grade pass (pipeline.js:36) -- an sRGB
// texture here would be silently gamma-decoded a second time.
const PATINA_CEIL = 0.52;
let patinaTex = null;
function patinaTexture() {
  if (patinaTex) return patinaTex;
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N), D = img.data;
  // tileable value noise: the lattice wraps at period P so the stamp has no seam when it repeats
  const vh = (i, j, s) => { const h = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); };
  const noise = (u, v, P, s) => {
    const fx = u * P, fz = v * P, x0 = Math.floor(fx), z0 = Math.floor(fz);
    let tx = fx - x0, tz = fz - z0; tx = tx * tx * (3 - 2 * tx); tz = tz * tz * (3 - 2 * tz);
    const H = (i, j) => vh(((i % P) + P) % P, ((j % P) + P) % P, s);
    const a = H(x0, z0), b = H(x0 + 1, z0), d = H(x0, z0 + 1), e = H(x0 + 1, z0 + 1);
    return a + (b - a) * tx + (d - a) * tz + (a - b - d + e) * tx * tz;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const broad = noise(u, v, 3, 1), mid = noise(u, v, 6, 2), fine = noise(u, v, 16, 3);
    // lichen: the darkest quarter of the broad field goes another step down and olive, so the rock breaks
    // into patches the way a reference capture's stone does instead of reading as one evenly dimmed slab
    const lich = Math.max(0, 0.42 - broad) * 1.6;
    const mot = broad * 0.55 + mid * 0.30 + fine * 0.15;          // 0..1, how weathered this texel is
    let m = PATINA_CEIL * (1 - 0.50 * (1 - mot)) - lich * 0.13;
    m = Math.max(0.16, Math.min(PATINA_CEIL, m));
    // mineral, not neutral: rock_top.png is warm (150,140,116), so the wash cools it toward grey-green
    const i = (y * N + x) * 4;
    D[i] = Math.round(255 * Math.min(1, m * 0.94));
    D[i + 1] = Math.round(255 * Math.min(1, m * (1.0 + lich * 0.10)));
    D[i + 2] = Math.round(255 * Math.min(1, m * 1.07));
    D[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  patinaTex = new THREE.CanvasTexture(c);
  patinaTex.magFilter = THREE.LinearFilter; patinaTex.minFilter = THREE.LinearMipmapLinearFilter;
  patinaTex.wrapS = patinaTex.wrapT = THREE.RepeatWrapping;
  patinaTex.colorSpace = THREE.NoColorSpace;   // the byte value is the linear multiplier, not a colour
  patinaTex.anisotropy = 4;
  return patinaTex;
}
// One quad per bare-rock tile top, UV window dihedrally transformed per tile (4 rotations x mirror) off a
// deterministic hash so five adjacent shelf tiles never share the stamp phase -- the same trick terrain.js
// uses on its own rock tops, and the reason the wash does not read as one repeated blotch.
function rockPatina(map) {
  const P = [], UV = [];
  const dih = (k, u, v) => { if (k & 4) u = 1 - u; switch (k & 3) { case 1: return [1 - v, u]; case 2: return [1 - u, 1 - v]; case 3: return [v, 1 - u]; default: return [u, v]; } };
  for (let z = 0; z < map.d; z++) for (let x = 0; x < map.w; x++) {
    const t = map.tiles[z][x];
    if (!t || t.t !== 'r' || t.void || t.water) continue;
    // 0.009 sits above terrain's own flat decals (lifted 0.004-0.006) and below a prop's contact shadow
    const y = t.h * HSTEP + 0.009, k = Math.floor(phash(x, z, 23) * 8) & 7;
    const c = [[x, z], [x, z + 1], [x + 1, z + 1], [x + 1, z]];
    const uv = [dih(k, 0, 0), dih(k, 0, 1), dih(k, 1, 1), dih(k, 1, 0)];
    for (const i of [0, 1, 2, 0, 2, 3]) { P.push(c[i][0], y, c[i][1]); UV.push(uv[i][0], uv[i][1]); }
  }
  if (!P.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: patinaTexture(), transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
  }));
  m.name = 'rock_patina'; m.castShadow = false; m.receiveShadow = false; m.renderOrder = 2;
  return m;
}

// Black caps over the VOID tiles: they hide the terrain top that terrain.js still draws there and drop a skirt to
// the diorama floor, so the cliff faces around a bite read exactly like the ones on the outer rim.
function voidCaps(map) {
  const P = []; const push = (a, b, c, d) => { P.push(...a, ...b, ...c, ...a, ...c, ...d); };
  const yBot = -8 * HSTEP, e = 0.008;
  for (let z = 0; z < map.d; z++) for (let x = 0; x < map.w; x++) {
    const t = map.tiles[z][x]; if (!t || !t.void) continue;
    const y = t.h * HSTEP + 0.03;
    push([x, y, z], [x, y, z + 1], [x + 1, y, z + 1], [x + 1, y, z]);
    const vd = (dx, dz) => { const q = map.at(x + dx, z + dz); return q && q.void; };
    if (!vd(1, 0)) push([x + 1 - e, y, z], [x + 1 - e, y, z + 1], [x + 1 - e, yBot, z + 1], [x + 1 - e, yBot, z]);
    if (!vd(-1, 0)) push([x + e, y, z + 1], [x + e, y, z], [x + e, yBot, z], [x + e, yBot, z + 1]);
    if (!vd(0, 1)) push([x + 1, y, z + 1 - e], [x, y, z + 1 - e], [x, yBot, z + 1 - e], [x + 1, yBot, z + 1 - e]);
    if (!vd(0, -1)) push([x, y, z + e], [x + 1, y, z + e], [x + 1, yBot, z + e], [x, yBot, z + e]);
  }
  if (!P.length) return null;
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }));
  m.name = 'void_cap'; m.castShadow = false; m.receiveShadow = false; m.renderOrder = 1;
  return m;
}

// ---------- R15 story dressing (maps owner): camp, crypt and cathedral furniture ----------
// Every builder here follows the house rules above: painted fill on every material, contact shadow under anything
// that stands on the ground, geometry sitting on its own tile surface, no per-frame work (props are batched).
// Flames are additive unlit meshes (transparent, so mergeStatic leaves them alone); the LIGHT they cast is added by
// lighting.js (LIT_PROPS) when the map's mood asks for lamps.
const FLAME = {};
const flameMat = (color, opacity = 0.9) => FLAME[color + '|' + opacity] || (FLAME[color + '|' + opacity] = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
function flame(g, x, y, z, s = 1) {
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.16 * s, 0.52 * s, 7, 1, true), flameMat(0xff6a1c, 0.85)); outer.position.set(x, y + 0.26 * s, z);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.09 * s, 0.34 * s, 6, 1, true), flameMat(0xffd27a, 0.95)); inner.position.set(x + 0.01 * s, y + 0.18 * s, z);
  const tongue = new THREE.Mesh(new THREE.ConeGeometry(0.07 * s, 0.36 * s, 5, 1, true), flameMat(0xff8a2a, 0.8)); tongue.position.set(x - 0.07 * s, y + 0.2 * s, z + 0.05 * s); tongue.rotation.z = 0.35;
  for (const m of [outer, inner, tongue]) { m.castShadow = false; m.receiveShadow = false; m.renderOrder = 5; g.add(m); }
}
function glowDisc(g, r, y, color = 0xff7a28, opacity = 0.32) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), flameMat(color, opacity)); m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 4; m.castShadow = false; g.add(m);
}
const surfY = (map, x, z) => { const t = map.at(Math.floor(x), Math.floor(z)); return (t ? t.h : 0) * HSTEP; };

// Stained glass: a leaded lancet of jewel colours, painted once. Emissive (lit from outside), so it reads in the dark nave.
let glassTex = null;
function stainedGlass() {
  if (glassTex) return glassTex;
  const c = document.createElement('canvas'); c.width = 32; c.height = 96; const g = c.getContext('2d');
  let seed = 91; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pal = ['#b8242c', '#2a4fb8', '#d8a82c', '#2a8a5a', '#7a2a9a', '#c85a1c', '#3a78c8'];
  for (let y = 0; y < 96; y += 8) for (let x = 0; x < 32; x += 8) { g.fillStyle = pal[Math.floor(rnd() * pal.length)]; g.fillRect(x, y, 8, 8); }
  // a rose / figure medallion in the middle
  g.fillStyle = '#e8c870'; g.beginPath(); g.arc(16, 40, 9, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#b8242c'; g.beginPath(); g.arc(16, 40, 5, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#141008'; g.lineWidth = 1.4;
  for (let y = 0; y <= 96; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(32, y); g.stroke(); }
  for (let x = 0; x <= 32; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 96); g.stroke(); }
  g.beginPath(); g.arc(16, 40, 9, 0, Math.PI * 2); g.stroke();
  glassTex = new THREE.CanvasTexture(c); glassTex.magFilter = THREE.NearestFilter; glassTex.colorSpace = THREE.SRGBColorSpace; return glassTex;
}
let GLASSWIN = null;
const glassWin = () => GLASSWIN || (GLASSWIN = new THREE.MeshBasicMaterial({ map: stainedGlass(), toneMapped: false, color: 0xd8c8b0 }));
// A lancet (rectangle + pointed head) as a flat shape, w wide and h tall, springing at the base.
function lancetGeo(w, h) {
  const s = new THREE.Shape(); const r = w / 2, sp = h - w * 0.9;
  s.moveTo(-r, 0); s.lineTo(r, 0); s.lineTo(r, sp); s.quadraticCurveTo(r, sp + w * 0.62, 0, h); s.quadraticCurveTo(-r, sp + w * 0.62, -r, sp); s.lineTo(-r, 0);
  const geo = new THREE.ShapeGeometry(s, 6);
  const uv = geo.attributes.uv, pos = geo.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + r) / w, pos.getY(i) / h);
  return geo;
}

// A-frame camp tent. Local frame: ridge along x, the door flap on +z; footprint w x d rotated by rot like house().
const CANVAS = { canvas: 0xcbb994, striped: 0xd8cdb4, command: 0x3b4d86 };
let TENT_STRIPE = null;
function tent(p, map) {
  const g = new THREE.Group(); g.name = 'tent';
  const rot = p.rot || 0, alongX = (p.w || 1) >= (p.d || 1), lw = Math.max(p.w || 1, p.d || 1), ld = Math.min(p.w || 1, p.d || 1);
  const y0 = surfY(map, p.x, p.z);
  const style = CANVAS[p.style] ? p.style : 'canvas', big = style === 'command';
  const cloth = style === 'striped' ? (TENT_STRIPE || (TENT_STRIPE = new THREE.MeshLambertMaterial({ map: stripes(), emissive: 0xffffff, emissiveMap: stripes(), emissiveIntensity: FILL })))
    : solid(CANVAS[style]);
  const trim = style === 'command' ? solid(0xc8a040) : solid(0x8a7a5a);
  const L = lw - 0.14, a = ld / 2 - 0.08, hR = (big ? 1.45 : 1.05) + 0.12 * (ld - 1);
  const slope = Math.hypot(a, hR - 0.06), ang = Math.atan2(hR - 0.06, a);
  for (const s of [-1, 1]) {
    const pl = mesh(texBox(L, 0.035, slope, 0.5), cloth, 0, 0.06 + (hR - 0.06) / 2, s * a / 2);
    pl.rotation.x = s * ang; g.add(pl);
    g.add(mesh(new THREE.BoxGeometry(L + 0.02, 0.05, 0.05), trim, 0, 0.06, s * a));                 // hem
    for (const e of [-1, 1]) { // guy ropes to stakes
      const sx = e * (L / 2 - 0.1), rope = mesh(new THREE.BoxGeometry(0.018, 0.018, 0.5), TIMBER, sx, hR * 0.45, s * (a + 0.2)); rope.rotation.x = s * 0.9; g.add(rope);
      g.add(mesh(new THREE.BoxGeometry(0.04, 0.12, 0.04), TIMBER_LIT, sx, 0.05, s * (a + 0.36)));
    }
  }
  // gable ends: the back closed, the front with a dark open flap and the flap tied back
  const tri = (w, h) => { const sh = new THREE.Shape(); sh.moveTo(-w, 0); sh.lineTo(w, 0); sh.lineTo(0, h); sh.lineTo(-w, 0); return new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false }); };
  const back = mesh(tri(a, hR), cloth, -L / 2, 0.04, 0); back.rotation.y = Math.PI / 2; g.add(back);
  const front = mesh(tri(a, hR), cloth, L / 2 - 0.03, 0.04, 0); front.rotation.y = Math.PI / 2; g.add(front);
  const hole = new THREE.Mesh(new THREE.ShapeGeometry((() => { const sh = new THREE.Shape(); sh.moveTo(-a * 0.55, 0); sh.lineTo(a * 0.55, 0); sh.lineTo(0, hR * 0.72); sh.lineTo(-a * 0.55, 0); return sh; })()), basic(0x0b0806));
  hole.rotation.y = Math.PI / 2; hole.position.set(L / 2 + 0.005, 0.05, 0); hole.renderOrder = 1; g.add(hole);
  const flap = mesh(texBox(0.03, hR * 0.66, a * 0.5, 0.5), cloth, L / 2 + 0.04, 0.05 + hR * 0.33, a * 0.42); flap.rotation.x = -0.25; g.add(flap);
  // poles and ridge
  for (const e of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.06, hR + 0.18, 0.06), TIMBER_LIT, e * (L / 2 + 0.02), (hR + 0.18) / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(L + 0.12, 0.06, 0.06), TIMBER, 0, hR + 0.02, 0));
  if (big) { // the captain's pennant
    g.add(mesh(new THREE.BoxGeometry(0.04, 0.9, 0.04), TIMBER, L / 2 + 0.02, hR + 0.5, 0));
    const pen = mesh(new THREE.BoxGeometry(0.02, 0.22, 0.42), solid(0xa8242c), L / 2 + 0.02, hR + 0.8, 0.22); g.add(pen);
  }
  g.add(contactShadow(L / 2 + 0.12, a + 0.12, 0.3));
  // local frame: ridge along x, flap at +x. The ridge runs along the footprint's long side; rot >= 2 puts the flap at
  // the far end of it (rot 0/1 -> the +x or +z end, rot 2/3 -> the -x or -z end).
  const flip = rot >= 2;
  g.rotation.y = alongX ? (flip ? Math.PI : 0) : (flip ? Math.PI / 2 : -Math.PI / 2);
  g.position.set(p.x + p.w / 2, y0, p.z + p.d / 2);
  return g;
}

// Covered wagon on four wheels; long axis = the longer of w/d, shafts forward (+ along it, or - when rot >= 2).
function wagon(p, map) {
  const g = new THREE.Group(); g.name = 'wagon';
  const y0 = surfY(map, p.x, p.z), alongX = (p.w || 2) >= (p.d || 1), Lt = Math.max(p.w || 2, p.d || 1);
  const planks = mat('wood_side'), L = Lt - 0.24, W = 0.72, bedY = 0.48, sgn = (p.rot || 0) >= 2 ? -1 : 1;
  const cover = p.cover === 'none' ? null : p.cover === 'tithe' ? solid(0x4a3434) : solid(0xcdbd98);
  g.add(mesh(texBox(L, 0.1, W, 0.45), planks, 0, bedY, 0));
  for (const s of [-1, 1]) g.add(mesh(texBox(L, 0.26, 0.06, 0.4), planks, 0, bedY + 0.17, s * W / 2));
  for (const s of [-1, 1]) g.add(mesh(texBox(0.06, 0.26, W, 0.4), planks, s * L / 2, bedY + 0.17, 0));
  for (const ex of [-1, 1]) for (const s of [-1, 1]) {
    const wx = ex * (L / 2 - 0.3), wz = s * (W / 2 + 0.06), R = ex > 0 ? 0.28 : 0.34;
    const w = new THREE.Mesh(new THREE.TorusGeometry(R, 0.045, 6, 16), TIMBER); w.position.set(wx, R, wz); w.castShadow = true; g.add(w);
    for (let k = 0; k < 3; k++) { const sp = mesh(new THREE.BoxGeometry(R * 1.9, 0.045, 0.04), TIMBER_LIT, wx, R, wz); sp.rotation.z = k * Math.PI / 3; g.add(sp); }
  }
  g.add(mesh(new THREE.BoxGeometry(L - 0.4, 0.06, 0.06), TIMBER, 0, 0.3, 0));                      // axle tree
  for (const s of [-1, 1]) { const sh = mesh(new THREE.BoxGeometry(0.75, 0.06, 0.06), TIMBER_LIT, sgn * (L / 2 + 0.3), bedY - 0.08, s * 0.22); sh.rotation.z = sgn * -0.25; g.add(sh); }
  if (cover) {
    const hood = new THREE.CylinderGeometry(W / 2 + 0.05, W / 2 + 0.05, L * 0.86, 12, 1, true, 0, Math.PI);
    scaleUV(hood, 2, 2); hood.rotateZ(Math.PI / 2);
    const m = mesh(hood, cover, 0, bedY + 0.3, 0); m.material = cover; g.add(m);
    const under = new THREE.Mesh(flipFaces(hood.clone()), cover); under.position.copy(m.position); under.castShadow = true; g.add(under);
    for (const k of [-0.45, 0, 0.45]) { const hoop = new THREE.Mesh(new THREE.TorusGeometry(W / 2 + 0.06, 0.02, 4, 12, Math.PI), TIMBER); hoop.rotation.y = Math.PI / 2; hoop.position.set(k * L * 0.86, bedY + 0.3, 0); g.add(hoop); }
    const endc = new THREE.Mesh(new THREE.CircleGeometry(W / 2 + 0.03, 12, 0, Math.PI), basic(0x0c0907)); endc.rotation.y = -Math.PI / 2 * sgn; endc.position.set(-sgn * L * 0.43, bedY + 0.3, 0); g.add(endc);
  } else {
    for (let i = 0; i < 3; i++) g.add(mesh(texBox(0.34, 0.22, 0.3, 0.35), i % 2 ? mat('wood_top') : planks, -0.4 + i * 0.4, bedY + 0.16, (i - 1) * 0.12));
  }
  g.add(contactShadow(L / 2 + 0.15, W / 2 + 0.18, 0.3));
  g.rotation.y = alongX ? 0 : Math.PI / 2;
  g.position.set(p.x + (p.w || 2) / 2, y0, p.z + (p.d || 1) / 2);
  return g;
}

// Camp fire: a ring of stones, crossed logs, a bed of embers and a live flame.
function campfire(p, map) {
  const x = Math.floor(p.x), z = Math.floor(p.z), y = surfY(map, x, z);
  const g = new THREE.Group(); g.name = 'campfire'; const rock = mat('rock_side'), bark = mat('wood_side');
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + 0.2; const b = mesh(texBox(0.15 + wob(i, 3) * 0.06, 0.1 + wob(i, 5) * 0.05, 0.13, 0.4), rock, Math.cos(a) * 0.33, 0.05, Math.sin(a) * 0.33); b.rotation.y = -a; g.add(b); }
  for (let i = 0; i < 4; i++) { const geo = new THREE.CylinderGeometry(0.05, 0.055, 0.5, 6); scaleUV(geo, 0.3, 0.5); const lg = mesh(geo, bark, 0, 0.1, 0); lg.rotation.set(Math.PI / 2 - 0.5, i * Math.PI / 2 + 0.4, 0); lg.position.set(Math.cos(i * Math.PI / 2 + 0.4) * 0.1, 0.1, -Math.sin(i * Math.PI / 2 + 0.4) * 0.1); g.add(lg); }
  const coals = mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.05, 10), solid(0x5a1a08, { emissive: 0xff5010, emissiveIntensity: 0.9 }), 0, 0.03, 0); g.add(coals);
  flame(g, 0, 0.08, 0, 1.25);
  glowDisc(g, 0.85, 0.02, 0xff6a20, 0.12);
  // a log seat beside it
  const seat = new THREE.CylinderGeometry(0.09, 0.09, 0.6, 7); scaleUV(seat, 0.5, 0.6); seat.rotateZ(Math.PI / 2);
  const s = mesh(seat, bark, 0.05, 0.09, 0.48); s.rotation.y = 0.3; g.add(s);
  g.add(contactShadow(0.42, 0.42, 0.34));
  g.position.set(x + 0.5, y, z + 0.5);
  return g;
}

// Iron fire-bowl on a tripod (crypt / cathedral light).
function brazier(p, map) {
  const x = Math.floor(p.x), z = Math.floor(p.z), y = surfY(map, x, z);
  const g = new THREE.Group(); g.name = 'brazier';
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; const leg = mesh(new THREE.BoxGeometry(0.05, 0.8, 0.05), IRON, Math.cos(a) * 0.16, 0.38, Math.sin(a) * 0.16); leg.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); g.add(leg); }
  const bowl = new THREE.CylinderGeometry(0.3, 0.14, 0.2, 12, 1, true); const b = mesh(bowl, IRON, 0, 0.82, 0); g.add(b);
  const inner = new THREE.Mesh(flipFaces(bowl.clone()), IRON); inner.position.copy(b.position); g.add(inner);
  const rim = mesh(new THREE.TorusGeometry(0.3, 0.025, 4, 14), IRON, 0, 0.92, 0); rim.rotation.x = Math.PI / 2; g.add(rim);
  g.add(mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 12), solid(0x5a1a08, { emissive: 0xff5010, emissiveIntensity: 1.0 }), 0, 0.88, 0));
  flame(g, 0, 0.9, 0, 1.1);
  glowDisc(g, 0.7, 0.02, 0xff7a28, 0.09);
  g.add(contactShadow(0.3, 0.3, 0.3));
  g.position.set(x + 0.5, y, z + 0.5);
  return g;
}

// A standing iron candle tree: three arms of tall church candles.
function candelabra(p, map) {
  const x = Math.floor(p.x), z = Math.floor(p.z), y = surfY(map, x, z);
  const g = new THREE.Group(); g.name = 'candelabra'; const wax = solid(0xe8dcc0, { emissive: 0xffe0a8, emissiveIntensity: 0.55 });
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + 0.5; const f = mesh(new THREE.BoxGeometry(0.04, 0.05, 0.3), IRON, Math.cos(a) * 0.12, 0.03, Math.sin(a) * 0.12); f.rotation.y = -a + Math.PI / 2; g.add(f); }
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.045, 1.35, 6), IRON, 0, 0.68, 0));
  g.add(mesh(new THREE.BoxGeometry(0.62, 0.035, 0.035), IRON, 0, 1.2, 0));
  g.add(mesh(new THREE.BoxGeometry(0.035, 0.035, 0.36), IRON, 0, 1.08, 0));
  for (const [cx, cy, cz] of [[-0.3, 1.22, 0], [0.3, 1.22, 0], [0, 1.37, 0], [0, 1.1, -0.18], [0, 1.1, 0.18]]) {
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 6), wax, cx, cy + 0.1, cz));
    flame(g, cx, cy + 0.2, cz, 0.32);
  }
  glowDisc(g, 0.55, 0.02, 0xffb050, 0.07);
  g.add(contactShadow(0.2, 0.2, 0.3));
  g.position.set(x + 0.5, y, z + 0.5);
  return g;
}

// Stone sarcophagus with a carved effigy on the lid. Local frame: long axis x.
function sarcophagus(p, map) {
  const x = Math.floor(p.x), z = Math.floor(p.z), y = surfY(map, x, z);
  const g = new THREE.Group(); g.name = 'sarcophagus'; const stone = mat('stone_side'), rock = mat('rock_side');
  g.add(mesh(texBox(0.94, 0.12, 0.62, 0.5), rock, 0, 0.06, 0));                          // plinth
  g.add(mesh(texBox(0.84, 0.42, 0.5, 0.5), stone, 0, 0.12 + 0.21, 0));                     // chest
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) g.add(mesh(new THREE.BoxGeometry(0.2, 0.26, 0.02), SLATE, -0.26 + i * 0.26, 0.34, s * 0.255));   // carved panels
  g.add(mesh(texBox(0.92, 0.08, 0.58, 0.5), rock, 0, 0.58, 0));                             // lid
  const eff = solid(0x9a968c);
  g.add(mesh(new THREE.BoxGeometry(0.52, 0.09, 0.22), eff, 0.02, 0.665, 0));               // the effigy's body
  g.add(mesh(new THREE.BoxGeometry(0.14, 0.11, 0.16), eff, -0.3, 0.675, 0));               // head on a cushion
  g.add(mesh(new THREE.BoxGeometry(0.1, 0.06, 0.26), eff, -0.36, 0.64, 0));
  g.add(mesh(new THREE.BoxGeometry(0.34, 0.03, 0.05), solid(0x6a665c), 0.05, 0.72, 0));    // a sword on the breast
  g.add(contactShadow(0.56, 0.4, 0.34));
  g.rotation.y = (p.rot || 0) * Math.PI / 2; g.position.set(x + 0.5, y, z + 0.5);
  return g;
}

// A cathedral pew: seat, backrest and carved ends. Seat faces local +z.
function pew(p, map) {
  const x = Math.floor(p.x), z = Math.floor(p.z), y = surfY(map, x, z);
  const g = new THREE.Group(); g.name = 'pew'; const planks = mat('wood_side'), dark = solid(0x3a2414);
  g.add(mesh(texBox(0.94, 0.06, 0.34, 0.5), planks, 0, 0.36, 0.04));
  g.add(mesh(texBox(0.94, 0.42, 0.05, 0.5), planks, 0, 0.6, -0.14));
  g.add(mesh(new THREE.BoxGeometry(0.96, 0.05, 0.08), dark, 0, 0.83, -0.14));
  for (const s of [-1, 1]) g.add(mesh(texBox(0.06, 0.78, 0.44, 0.5), planks, s * 0.46, 0.39, -0.02));
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.04, 0.12), dark, 0, 0.22, 0.12));             // kneeler
  g.add(contactShadow(0.52, 0.3, 0.28));
  g.rotation.y = (p.rot || 0) * Math.PI / 2; g.position.set(x + 0.5, y, z + 0.5);
  return g;
}

// The coronation throne: a gilded high-backed chair on a step, crimson cushion and back panel. Seat faces local +z.
function throne(p, map) {
  const x = Math.floor(p.x), z = Math.floor(p.z), y = surfY(map, x, z);
  const g = new THREE.Group(); g.name = 'throne'; const gilt = solid(0xc89a3a, { emissiveIntensity: 0.55 }), red = solid(0x8a1c24), stone = mat('nave_trim');
  g.add(mesh(texBox(0.9, 0.12, 0.84, 0.5), stone, 0, 0.06, 0));
  g.add(mesh(new THREE.BoxGeometry(0.66, 0.36, 0.56), gilt, 0, 0.3, 0.04));
  g.add(mesh(new THREE.BoxGeometry(0.58, 0.08, 0.5), red, 0, 0.52, 0.06));
  g.add(mesh(new THREE.BoxGeometry(0.66, 1.3, 0.1), gilt, 0, 0.77, -0.25));
  g.add(mesh(new THREE.BoxGeometry(0.46, 0.9, 0.02), red, 0, 0.8, -0.195));
  for (const s of [-1, 1]) { g.add(mesh(new THREE.BoxGeometry(0.08, 0.3, 0.5), gilt, s * 0.33, 0.62, 0.05)); g.add(mesh(new THREE.ConeGeometry(0.06, 0.2, 6), gilt, s * 0.3, 1.52, -0.25)); }
  g.add(mesh(new THREE.ConeGeometry(0.1, 0.3, 6), gilt, 0, 1.56, -0.25));
  g.add(contactShadow(0.45, 0.42, 0.32));
  g.rotation.y = (p.rot || 0) * Math.PI / 2; g.position.set(x + 0.5, y, z + 0.5);
  return g;
}

// A pipe organ against a wall: a panelled case and a symmetric rank of tin pipes. Front faces +z.
function organ(p, map) {
  const g = new THREE.Group(); g.name = 'organ';
  const y0 = surfY(map, p.x, p.z), W = p.w - 0.1, D = p.d - 0.1, th = p.th || 3.6;
  const planks = mat('wood_side'), dark = solid(0x3a2414), tin = solid(0xb4b2aa, { emissiveIntensity: 0.5 }), gilt = solid(0xc8a040);
  g.add(mesh(texBox(W, 1.0, D, 0.5), planks, 0, 0.5, 0));
  g.add(mesh(new THREE.BoxGeometry(W + 0.06, 0.08, D + 0.06), dark, 0, 1.02, 0));
  g.add(mesh(new THREE.BoxGeometry(W * 0.4, 0.06, 0.2), solid(0xe8e0cc), 0, 0.82, D / 2 + 0.08));   // keyboard
  g.add(mesh(texBox(W, th * 0.9, 0.12, 0.5), planks, 0, 1.0 + th * 0.45, -D / 2 + 0.06));             // back case
  const n = Math.max(7, Math.round(W * 5)) | 1, step = W / n;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n, e = Math.abs(u - 0.5) * 2;
    const tower = 0.5 + 0.5 * Math.cos(e * Math.PI * 1.5) ** 2;           // tall at the ends and the middle
    const ph = 0.9 + (th - 1.2) * (0.35 + 0.65 * tower);
    const r = step * 0.38, px = -W / 2 + (i + 0.5) * step;
    g.add(mesh(new THREE.CylinderGeometry(r, r, ph, 8), tin, px, 1.06 + ph / 2, 0.05));
    const foot = mesh(new THREE.ConeGeometry(r, 0.14, 8), tin, px, 1.06 - 0.02, 0.05); foot.rotation.x = Math.PI; g.add(foot);
    g.add(mesh(new THREE.BoxGeometry(r * 1.2, 0.07, 0.02), basic(0x0a0a0c), px, 1.3, 0.05 + r));    // pipe mouth
  }
  g.add(mesh(new THREE.BoxGeometry(W + 0.1, 0.1, 0.2), gilt, 0, 1.0 + th * 0.9 + 0.05, -D / 2 + 0.1)); // gilt cornice
  g.add(contactShadow(W / 2 + 0.1, D / 2 + 0.15, 0.3));
  g.position.set(p.x + p.w / 2, y0, p.z + p.d / 2);
  return g;
}

// The bell tower: a square stone shaft, an open bell chamber on four piers with the great bronze bell in it, and a
// slate spire. th = shaft height (world units) below the chamber.
function belfry(p, map) {
  const g = new THREE.Group(); g.name = 'belfry';
  const y0 = surfY(map, p.x, p.z), W = p.w - 0.16, D = p.d - 0.16, th = p.th || 5;
  const stone = mat('stone_side'), rock = mat('rock_side');
  g.add(mesh(texBox(W + 0.12, 0.4, D + 0.12, 1), rock, 0, 0.2, 0));
  g.add(mesh(texBox(W, th, D, 1), stone, 0, 0.4 + th / 2, 0));
  for (const f of [0.35, 0.7]) g.add(mesh(texBox(W + 0.08, 0.1, D + 0.08, 0.5), rock, 0, 0.4 + th * f, 0));      // string courses
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(mesh(texBox(0.3, th, 0.3, 0.5), rock, sx * (W / 2 + 0.02), 0.4 + th / 2, sz * (D / 2 + 0.02)));   // buttresses
  // slit windows and the door
  for (const k of [0.45, 0.8]) { const sl = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.5), basic(0x06070b)); sl.position.set(0, 0.4 + th * k, D / 2 + 0.005); g.add(sl); }
  const dr = new THREE.Mesh(lancetGeo(0.55, 1.05), basic(0x06070b)); dr.position.set(0, 0.4, D / 2 + 0.006); g.add(dr);
  // the bell chamber
  const cy = 0.4 + th, ch = 1.9;
  g.add(mesh(texBox(W + 0.1, 0.14, D + 0.1, 0.5), rock, 0, cy + 0.07, 0));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(mesh(texBox(0.34, ch, 0.34, 0.5), stone, sx * (W / 2 - 0.12), cy + ch / 2, sz * (D / 2 - 0.12)));
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.4, ch - 0.1), basic(0x07080c)); back.position.set(0, cy + ch / 2, -D / 2 + 0.3); g.add(back);
  const back2 = new THREE.Mesh(new THREE.PlaneGeometry(D - 0.4, ch - 0.1), basic(0x07080c)); back2.rotation.y = Math.PI / 2; back2.position.set(-W / 2 + 0.3, cy + ch / 2, 0); g.add(back2);
  g.add(mesh(texBox(W + 0.14, 0.2, D + 0.14, 0.5), rock, 0, cy + ch + 0.1, 0));
  // the great bell: a lathed bronze profile hung from a timber headstock
  const prof = [[0.02, 0], [0.62, 0], [0.66, 0.06], [0.56, 0.2], [0.44, 0.5], [0.4, 0.82], [0.34, 0.98], [0.02, 1.02]].map(([r, h]) => new THREE.Vector2(r * Math.min(W, D) * 0.42, h * 1.15));
  const bellG = new THREE.LatheGeometry(prof, 18); bellG.scale(1, 1, 1);
  const bronze = solid(0x8c6a2a, { emissive: 0x3a2a10, emissiveIntensity: 0.9 });
  const bell = mesh(bellG, bronze, 0, cy + ch - 1.45, 0); g.add(bell);
  g.add(mesh(new THREE.BoxGeometry(W - 0.3, 0.14, 0.16), TIMBER, 0, cy + ch - 0.22, 0));
  g.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), IRON, 0, cy + ch - 1.5, 0));             // clapper
  // spire
  const spH = Math.max(W, D) * 1.15, sp = new THREE.ConeGeometry(Math.hypot(W, D) / 2 + 0.08, spH, 4, 1); sp.rotateY(Math.PI / 4); scaleUV(sp, 3, 3);
  g.add(mesh(sp, roofMaterial({ x: p.x, z: p.z, roof: 'slate' }), 0, cy + ch + 0.2 + spH / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), solid(0xc8a040), 0, cy + ch + 0.2 + spH + 0.3, 0));
  g.add(mesh(new THREE.BoxGeometry(0.34, 0.06, 0.06), solid(0xc8a040), 0, cy + ch + 0.2 + spH + 0.42, 0));
  g.add(contactShadow(W / 2 + 0.3, D / 2 + 0.3, 0.36));
  g.position.set(p.x + p.w / 2, y0, p.z + p.d / 2);
  return g;
}

// A crypt or nave wall occupying len tiles along dir. The body stands on the OUTER half of its tiles, the room side
// (in = +1 -> +z / +x) carries pilasters at every tile joint and, per bay, an arched ossuary niche (crypt) or a
// stained-glass lancet with a banner between (nave). Vault ribs spring from each pilaster toward the room, so the
// diorama reads as a vaulted interior with its ceiling cut away.
function cryptwall(p, map) {
  const g = new THREE.Group(); g.name = 'cryptwall';
  const along = p.dir === 'x', inn = p.in ?? 1, th = p.th || 3, nave = p.style === 'nave';
  const body = mat(nave ? 'nave_wall' : 'crypt_wall'), trim = mat(nave ? 'nave_trim' : 'rock_side');
  const T = 0.5;             // body from the outer edge to T into the tile
  const P = (u, v, h) => (along ? [p.x + u, h, p.z + 0.5 + v] : [p.x + 0.5 + v, h, p.z + u]);
  const add = (geo, m, u, v, h, ry = 0) => { const [x, y, z] = P(u, v, h); const o = mesh(geo, m, x, y, z); o.rotation.y = ry; g.add(o); return o; };
  const box = (lu, lh, lv) => (along ? texBox(lu, lh, lv, 0.75) : texBox(lv, lh, lu, 0.75));
  const faceRy = along ? (inn > 0 ? 0 : Math.PI) : (inn > 0 ? Math.PI / 2 : -Math.PI / 2);
  const vBody = -inn * (0.5 - T / 2);   // the body's centre line, on the outer half of the tile
  for (let i = 0; i < p.len; i++) {
    const tx = along ? p.x + i : p.x, tz = along ? p.z : p.z + i; const t = map.at(tx, tz); const y = (t ? t.h : 0) * HSTEP;
    const u = i + 0.5;
    add(box(1.0, th, T), body, u, vBody, y + th / 2);
    add(box(1.02, 0.22, T + 0.1), trim, u, vBody + inn * 0.05, y + 0.11);                                  // plinth
    if (th > 1.2) add(box(1.04, 0.14, T + 0.16), trim, u, vBody + inn * 0.08, y + th - 0.07);            // cornice
    const face = vBody + inn * (T / 2 + 0.006);
    if (th > 1.6) {
      if (nave) {
        const wh = Math.min(th - 0.9, 2.6), ww = 0.44;
        const w = new THREE.Mesh(lancetGeo(ww, wh), glassWin()); const [x, yy, z] = P(u, face, y + (th - wh) * 0.55); w.position.set(x, yy, z); w.rotation.y = faceRy; w.renderOrder = 1; g.add(w);
        const fr = new THREE.Mesh(lancetGeo(ww + 0.12, wh + 0.08), trim); const [fx, fy, fz] = P(u, face - inn * 0.004, y + (th - wh) * 0.55 - 0.04); fr.position.set(fx, fy, fz); fr.rotation.y = faceRy; g.add(fr);
      } else {
        const nh = Math.min(1.25, th * 0.42), nw = 0.52;
        const n = new THREE.Mesh(lancetGeo(nw, nh), basic(0x08070a)); const [x, yy, z] = P(u, face, y + 0.36); n.position.set(x, yy, z); n.rotation.y = faceRy; n.renderOrder = 1; g.add(n);
        const bone = solid(0xc8bea4);
        for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(0.11, 0.1, 0.1), bone, u - 0.15 + k * 0.15, face + inn * 0.02, y + 0.42 + (k % 2) * 0.02);   // skulls in the niche
        add(new THREE.BoxGeometry(0.42, 0.05, 0.06), bone, u, face + inn * 0.02, y + 0.36);
        const n2 = new THREE.Mesh(lancetGeo(nw * 0.8, nh * 0.7), basic(0x08070a)); const [x2, y2, z2] = P(u, face, y + 0.36 + nh + 0.25); n2.position.set(x2, y2, z2); n2.rotation.y = faceRy; n2.renderOrder = 1; if (th > 2.4) g.add(n2);
      }
    }
    // pilaster + rib at the joint before this bay (and after the last); the portal joint carries the door instead
    for (const j of (i === p.len - 1 ? [i, i + 1] : [i])) {
      if (j === p.door) continue;
      const tj = map.at(along ? Math.min(p.x + j, p.x + p.len - 1) : p.x, along ? p.z : Math.min(p.z + j, p.z + p.len - 1)); const yj = (tj ? tj.h : 0) * HSTEP;
      add(box(0.24, th, T + 0.26), trim, j, vBody + inn * 0.13, yj + th / 2);
      if (th > 1.6 && j > 0 && j < p.len) {
        // quarter arc springing vertically off the pilaster face and turning into the room at the wall head
        const R = Math.min(1.1, th * 0.4), rib = new THREE.TorusGeometry(R, 0.07, 5, 10, Math.PI / 2); rib.rotateZ(Math.PI / 2);
        const m = add(rib, trim, j, vBody + inn * (T / 2 + 0.13 + R), yj + th - R);
        m.rotation.y = along ? -inn * Math.PI / 2 : (inn > 0 ? 0 : Math.PI);
      }
      if (nave && th > 1.6 && j % 2 === 1 && j < p.len) { // a crimson banner hung on alternate pilasters
        const bnr = add(new THREE.PlaneGeometry(0.3, 1.1), solid(0x8a1c22), j, vBody + inn * (T / 2 + 0.27), yj + th - 1.0, faceRy);
        bnr.castShadow = true; add(new THREE.BoxGeometry(0.34, 0.05, 0.05), solid(0xc8a040), j, vBody + inn * (T / 2 + 0.28), yj + th - 0.43);
      }
    }
  }
  // the great portal: a tall pointed doorway into the dark, a moulded frame, and two steps up to its sill
  if (Number.isInteger(p.door) && p.door >= 0 && p.door <= p.len) {
    const j = p.door, tj = map.at(along ? Math.min(p.x + j, p.x + p.len - 1) : p.x, along ? p.z : Math.min(p.z + j, p.z + p.len - 1)); const yj = (tj ? tj.h : 0) * HSTEP;
    const dh = Math.min(th - 0.3, 2.4), dw = 1.3, face = vBody + inn * (T / 2 + 0.01);
    const fr = new THREE.Mesh(lancetGeo(dw + 0.3, dh + 0.2), trim); const [fx, fy, fz] = P(j, face, yj); fr.position.set(fx, fy, fz); fr.rotation.y = faceRy; g.add(fr);
    const hole = new THREE.Mesh(lancetGeo(dw, dh), basic(0x050407)); const [hx, hy, hz] = P(j, face + inn * 0.012, yj); hole.position.set(hx, hy, hz); hole.rotation.y = faceRy; hole.renderOrder = 1; g.add(hole);
    for (const s of [-1, 1]) add(box(0.3, dh + 0.3, T + 0.34), trim, j + s * (dw / 2 + 0.2), vBody + inn * 0.17, yj + (dh + 0.3) / 2);
    add(box(dw + 0.5, 0.08, 0.3), trim, j, face + inn * 0.15, yj + 0.04);
  }
  return g;
}

const SPRITE = { oak: ['tree_oak_a', 'tree_oak_b'], pine: ['tree_pine', 'tree_pine_b'], rock: ['rock_large'], rock_small: ['rock_small'], bush: ['bush_a', 'bush_b'], well: ['well'], barrel: ['barrel'], crate: ['crate'], lamp: ['lamp_post'], signpost: ['signpost'], hay: ['hay_bale'], grave: ['grave_stone'], tree: ['tree_oak_a', 'tree_pine_b', 'tree_oak_b', 'tree_pine'], palm: ['tree_palm'] };
const DECAL = { flowers: ['flower_patch'] };

// ---------- static merge (PERF r7) ----------
// A house was ~70 meshes (studs, braces, rafters, window frames...) but only ~8 materials, and every mesh was its
// own draw in the colour pass AND the shadow pass: the props group alone was 1,100 meshes / ~2,000 draws a frame.
// mergeStatic() folds each prop group's plain opaque meshes into one mesh per (material, shadow flags), baking the
// child transform into the vertices. The prop GROUP is untouched (name, transform, userData.prop), so editor
// picking (walks hit.object up to userData.prop) and cinematics' per-child fit still work. Anything with per-object
// behaviour is left as it was: billboards, transparent / alpha-tested / custom-depth meshes, non-zero renderOrder,
// mirrored transforms, and nested groups.
// Each merged geometry's boundingBox is set to the UNION of the old per-child world AABBs (in group space), so
// Box3.setFromObject(group) -- cinematics.js's camera fit -- returns exactly what it returned before the merge
// (prop groups only ever rotate by multiples of 90 deg about y, which maps AABBs to AABBs exactly).
const _mm = new THREE.Matrix4(), _nm = new THREE.Matrix3(), _v3 = new THREE.Vector3(), _bx = new THREE.Box3();
function mergeStatic(g) {
  const buckets = new Map();
  for (const o of [...g.children]) {
    if (!o.isMesh || o.children.length || o.userData.billboard || o.renderOrder !== 0 || o.customDepthMaterial || o.customDistanceMaterial) continue;
    const geo = o.geometry; if (!geo.attributes.position || !geo.attributes.normal || !geo.attributes.uv || geo.morphAttributes.position) continue;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => !m || m.transparent || m.alphaTest > 0 || m.vertexColors)) continue;
    o.updateMatrix(); if (o.matrix.determinant() <= 0) continue;
    const groups = Array.isArray(o.material) ? (geo.groups.length ? geo.groups : [{ start: 0, count: Infinity, materialIndex: 0 }]) : [{ start: 0, count: Infinity, materialIndex: 0 }];
    if (!geo.boundingBox) geo.computeBoundingBox();
    _bx.copy(geo.boundingBox).applyMatrix4(o.matrix);
    for (const gr of groups) {
      const mt = mats[gr.materialIndex]; if (!mt) continue;
      const key = mt.uuid + (o.castShadow ? 'C' : 'c') + (o.receiveShadow ? 'R' : 'r') + (o.frustumCulled ? 'F' : 'f') + (o.visible ? 'V' : 'v');
      let b = buckets.get(key);
      if (!b) { b = { mt, cast: o.castShadow, recv: o.receiveShadow, cull: o.frustumCulled, vis: o.visible, parts: [], n: 0, box: new THREE.Box3() }; buckets.set(key, b); }
      const idx = geo.index, total = idx ? idx.count : geo.attributes.position.count;
      const start = gr.start, end = Math.min(total, gr.start + gr.count);
      if (end > start) { b.parts.push({ o, geo, start, end }); b.n += end - start; }
      b.box.union(_bx);
    }
    o.userData._merged = true;
  }
  if (!buckets.size) return;
  for (const o of [...g.children]) if (o.userData._merged) { g.remove(o); }
  for (const b of buckets.values()) {
    const P = new Float32Array(b.n * 3), N = new Float32Array(b.n * 3), U = new Float32Array(b.n * 2); let k = 0;
    for (const { o, geo, start, end } of b.parts) {
      _mm.copy(o.matrix); _nm.getNormalMatrix(_mm);
      const pa = geo.attributes.position, na = geo.attributes.normal, ua = geo.attributes.uv, idx = geo.index;
      for (let i = start; i < end; i++, k++) {
        const vi = idx ? idx.getX(i) : i;
        _v3.fromBufferAttribute(pa, vi).applyMatrix4(_mm); P[k * 3] = _v3.x; P[k * 3 + 1] = _v3.y; P[k * 3 + 2] = _v3.z;
        _v3.fromBufferAttribute(na, vi).applyMatrix3(_nm).normalize(); N[k * 3] = _v3.x; N[k * 3 + 1] = _v3.y; N[k * 3 + 2] = _v3.z;
        U[k * 2] = ua.getX(vi); U[k * 2 + 1] = ua.getY(vi);
      }
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(P, 3)); mg.setAttribute('normal', new THREE.BufferAttribute(N, 3)); mg.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    mg.computeBoundingSphere(); mg.boundingBox = b.box.clone();
    const m = new THREE.Mesh(mg, b.mt); m.name = 'merged'; m.castShadow = b.cast; m.receiveShadow = b.recv; m.frustumCulled = b.cull; m.visible = b.vis;
    g.add(m);
  }
  // source geometries were per-mesh (never cached), so they can go now instead of waiting for GC
  const live = new Set(); for (const o of g.children) if (o.geometry) live.add(o.geometry);
  for (const b of buckets.values()) for (const { geo } of b.parts) if (!live.has(geo)) geo.dispose();
}

// Game-only second stage (main.js calls it; the editor does not): folds the per-prop 'merged' meshes of EVERY prop
// into one mesh per (material, shadow flags) in world space -- ~200 draws -> ~25. The per-prop meshes stay in the
// props group, hidden, so everything that reads the props group is unchanged: raycasts and Box3.setFromObject do
// not look at `visible`, so editor-style picking and cinematics' per-prop camera fit see exactly what they saw
// before. The batch is returned as a separate group ('props_batch') to be added to the scene NEXT to props, never
// inside it (a map-wide child there would widen the camera fit). Only valid while props are static.
export function batchProps(props) {
  props.updateMatrixWorld(true);
  const buckets = new Map();
  for (const g of props.children) for (const o of g.children) {
    if (o.name !== 'merged' || !o.visible) continue;
    const mt = o.material, key = mt.uuid + (o.castShadow ? 'C' : 'c') + (o.receiveShadow ? 'R' : 'r') + (o.frustumCulled ? 'F' : 'f');
    let b = buckets.get(key);
    if (!b) { b = { mt, cast: o.castShadow, recv: o.receiveShadow, cull: o.frustumCulled, parts: [], n: 0 }; buckets.set(key, b); }
    b.parts.push(o); b.n += o.geometry.attributes.position.count;
  }
  const out = new THREE.Group(); out.name = 'props_batch';
  for (const b of buckets.values()) {
    const P = new Float32Array(b.n * 3), N = new Float32Array(b.n * 3), U = new Float32Array(b.n * 2); let k = 0;
    for (const o of b.parts) {
      _mm.copy(o.matrixWorld); _nm.getNormalMatrix(_mm);
      const pa = o.geometry.attributes.position, na = o.geometry.attributes.normal, ua = o.geometry.attributes.uv;
      for (let i = 0; i < pa.count; i++, k++) {
        _v3.fromBufferAttribute(pa, i).applyMatrix4(_mm); P[k * 3] = _v3.x; P[k * 3 + 1] = _v3.y; P[k * 3 + 2] = _v3.z;
        _v3.fromBufferAttribute(na, i).applyMatrix3(_nm).normalize(); N[k * 3] = _v3.x; N[k * 3 + 1] = _v3.y; N[k * 3 + 2] = _v3.z;
        U[k * 2] = ua.getX(i); U[k * 2 + 1] = ua.getY(i);
      }
      o.visible = false;
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(P, 3)); mg.setAttribute('normal', new THREE.BufferAttribute(N, 3)); mg.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    mg.computeBoundingSphere(); mg.computeBoundingBox();
    const m = new THREE.Mesh(mg, b.mt); m.name = 'props_batch'; m.castShadow = b.cast; m.receiveShadow = b.recv; m.frustumCulled = b.cull;
    m.matrixAutoUpdate = false; out.add(m);
  }
  batchBillboards(props, out);
  batchContactShadows(props, out);
  batchDecals(props, out);
  out.matrixAutoUpdate = false; out.updateMatrixWorld(true);
  return out;
}

// ---------- billboard instancing (PERF r11) ----------
// Every billboard was its own mesh, and a transparent DoubleSide material is drawn in TWO passes by three (back faces,
// then front faces): ravenscar_ascent's 101 sprites were ~200 of its ~480 colour draws, plus one shadow draw each.
// Billboards that share a material (= one sprite sheet, one foliage flag) become one InstancedMesh; all of them face
// the same yaw, so the instance matrices are recomposed only when the camera turns (update(), called per draw).
// forceSinglePass: a single plane only ever shows one side, so the back/front split draws nothing extra -- the
// DOUBLE_SIDED program flips the normal with gl_FrontFacing exactly as the FLIP_SIDED back pass did.
// Mirrored instances: the old mesh had scale.x < 0 (three flips the winding for a negative determinant). An instance
// cannot flip winding, so a mirror is a half turn instead: R_y(yaw + PI) puts every vertex where the mirror put it
// (the quad lies in z = 0), and the side the lens sees is the back face, which DoubleSide lights with the same normal.
// Instances are kept in back-to-front order for the current view, as three's per-object transparent sort had them.
// The originals stay in the props group, hidden (like the static batch), for everything that reads it.
const _q = new THREE.Quaternion(), _yAxis = new THREE.Vector3(0, 1, 0), _sc = new THREE.Vector3(), _ps = new THREE.Vector3(), _lm = new THREE.Matrix4(), _fw = new THREE.Vector3();
function batchBillboards(props, out) {
  const groups = new Map();
  props.traverse((o) => {
    if (!o.userData.billboard || !o.isMesh || !o.visible || !o.parent?.visible) return;
    const key = o.material.uuid + '|' + (o.customDepthMaterial?.uuid || '') + '|' + o.castShadow + o.receiveShadow + o.renderOrder;
    let g = groups.get(key); if (!g) { g = []; groups.set(key, g); } g.push(o);
  });
  const batches = [];
  for (const list of groups.values()) {
    const src = list[0];
    const im = new THREE.InstancedMesh(src.geometry.clone(), src.material, list.length);
    im.name = 'billboards'; im.castShadow = src.castShadow; im.receiveShadow = src.receiveShadow; im.renderOrder = src.renderOrder;
    im.customDepthMaterial = src.customDepthMaterial; im.matrixAutoUpdate = false;
    im.userData.billboards = list.map((o) => ({ parent: o.parent.matrixWorld, pos: o.position.clone(), sx: Math.abs(o.scale.x), sy: o.scale.y, sz: o.scale.z, flip: o.scale.x < 0 ? Math.PI : 0, key: 0 }));
    src.material.forceSinglePass = true;
    for (const o of list) o.visible = false;
    out.add(im); batches.push(im);
  }
  let lastYaw = NaN, lx = NaN, ly = NaN, lz = NaN;
  // yaw: the billboards' facing (camera.yawNow); cam: the view camera, for the back-to-front order
  out.userData.updateBillboards = (yaw, cam) => {
    if (!batches.length) return;
    cam.matrixWorld.extractBasis(_ps, _sc, _fw);   // _fw = camera +z (toward the lens)
    if (yaw === lastYaw && Math.abs(_fw.x - lx) < 1e-6 && Math.abs(_fw.y - ly) < 1e-6 && Math.abs(_fw.z - lz) < 1e-6) return;
    lastYaw = yaw; lx = _fw.x; ly = _fw.y; lz = _fw.z;
    for (const im of batches) {
      const L = im.userData.billboards;
      for (const b of L) { _ps.copy(b.pos).applyMatrix4(b.parent); b.key = _ps.x * lx + _ps.y * ly + _ps.z * lz; }
      L.sort((a, b) => a.key - b.key);   // farthest from the lens first
      for (let i = 0; i < L.length; i++) {
        const b = L[i];
        _lm.compose(b.pos, _q.setFromAxisAngle(_yAxis, yaw + b.flip), _sc.set(b.sx, b.sy, b.sz)).premultiply(b.parent);
        im.setMatrixAt(i, _lm);
      }
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.computeBoundingBox();
    }
  };
}

// Ground decals (flower patches): one draw each (ravenscar_ascent: 63 of its ~185 colour draws). Static and flat, so
// one world-space mesh per material. They are transparent at renderOrder 3, the same bucket as the overlay's field
// fills, where three sorted each decal against each fill by depth -- so a flower patch in front of a move tile was
// drawn over its tint and one behind it under. The batch is one object and cannot interleave, so it is placed just
// under the fills (2.99): a flower patch is always tinted by a field laid on its tile, never pasted over it. Within
// the batch the patches are laid far-to-near for the default view (they are flat on the ground and rarely touch).
function batchDecals(props, out) {
  const groups = new Map();
  props.traverse((o) => {
    if (!o.isMesh || !o.parent?.name?.startsWith('decal_')) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    let g = groups.get(o.material); if (!g) { g = []; groups.set(o.material, g); } g.push(o);
  });
  for (const [mt, list] of groups) {
    list.sort((a, b) => (a.parent.position.x + a.parent.position.z) - (b.parent.position.x + b.parent.position.z));
    let n = 0; for (const o of list) n += o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2); let k = 0;
    for (const o of list) {
      _nm.getNormalMatrix(o.matrixWorld);
      const pa = o.geometry.attributes.position, na = o.geometry.attributes.normal, ua = o.geometry.attributes.uv, idx = o.geometry.index, cnt = idx ? idx.count : pa.count;
      for (let i = 0; i < cnt; i++, k++) {
        const vi = idx ? idx.getX(i) : i;
        _v3.fromBufferAttribute(pa, vi).applyMatrix4(o.matrixWorld); P[k * 3] = _v3.x; P[k * 3 + 1] = _v3.y; P[k * 3 + 2] = _v3.z;
        _v3.fromBufferAttribute(na, vi).applyMatrix3(_nm).normalize(); N[k * 3] = _v3.x; N[k * 3 + 1] = _v3.y; N[k * 3 + 2] = _v3.z;
        U[k * 2] = ua.getX(vi); U[k * 2 + 1] = ua.getY(vi);
      }
      o.visible = false;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, mt); m.name = 'decals'; m.renderOrder = 2.99; m.castShadow = false; m.receiveShadow = list[0].receiveShadow; m.matrixAutoUpdate = false;
    out.add(m);
  }
}

// Contact shadows (the black ellipses under sprites and yard props): renderOrder 4, transparent, depthWrite off, one
// draw each. They are static and flat, and every one is black at the same opacity per material, so the blend
// dst * (1 - a) is commutative: one world-space mesh per material draws exactly what the separate meshes drew,
// in any order. Originals hidden, as above.
function batchContactShadows(props, out) {
  const shadowMats = new Set(Object.values(SHADOW_MAT));
  const groups = new Map();
  props.traverse((o) => {
    if (!o.isMesh || !shadowMats.has(o.material)) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    let g = groups.get(o.material); if (!g) { g = []; groups.set(o.material, g); } g.push(o);
  });
  for (const [mt, list] of groups) {
    let n = 0; for (const o of list) n += o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count;
    const P = new Float32Array(n * 3); let k = 0;
    for (const o of list) {
      const pa = o.geometry.attributes.position, idx = o.geometry.index, cnt = idx ? idx.count : pa.count;
      for (let i = 0; i < cnt; i++, k++) { _v3.fromBufferAttribute(pa, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); P[k * 3] = _v3.x; P[k * 3 + 1] = _v3.y; P[k * 3 + 2] = _v3.z; }
      o.visible = false;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, mt); m.name = 'contact_shadows'; m.renderOrder = 4; m.castShadow = false; m.receiveShadow = false; m.matrixAutoUpdate = false;
    out.add(m);
  }
}

export async function buildProps(map) {
  const group = new THREE.Group(); group.name = 'props';
  const man = await loadManifest();
  const counters = {};
  const pick = (list, type) => { counters[type] = (counters[type] || 0); const n = list[counters[type] % list.length]; counters[type]++; return n; };
  // per-build sprite caches; `version` ticks whenever a sprite lands (its shadow caster changes), so a caller that
  // caches the shadow map (main.js) knows to redraw it
  group.userData.version = 0;
  const mp = moodProps(map);   // R7: per-mood self-light of billboards (1 / 1 on the default map)
  const bc = { tex: new Map(), bill: new Map(), decal: new Map(), leaf: mp.leaf, sprite: mp.sprite, onLoad: () => { group.userData.version++; }, pending: [] };
  // R7 night mood: the window glass glows warm (lit interiors) instead of reflecting a dusk sky. GLASS is shared at
  // module scope, so it is set on EVERY build -- an editor that loads a day map after a night one resets it.
  const night = activeMood(map) === 'night';
  GLASS.color.set(night ? 0x6a4a20 : 0x1c2b45); GLASS.emissive.set(night ? 0xffb050 : 0x0a1a33); GLASS.emissiveIntensity = night ? 2.4 : FILL * 0.85;
  for (const p of map.props) {
    let obj = null;
    switch (p.type) {
      case 'house': obj = house(p, map); break;
      case 'stairs': obj = stairs(p, map); break;
      case 'wall': obj = wall(p); break;
      case 'arch': obj = arch(p); break;
      case 'rail': obj = rail(p); break;
      case 'fence': obj = fence(p, map); break;
      case 'stall': obj = stall(p, map); break;
      case 'tower': obj = tower(p, map); break;
      case 'ruin': obj = ruin(p, map); break;
      case 'pillar': obj = pillar(p, map); break;
      case 'cart': obj = cart(p, map); break;
      case 'woodpile': obj = woodpile(p, map); break;
      case 'trough': obj = trough(p, map); break;
      case 'gate': obj = gate(p, map); break;
      case 'deck': obj = deck(p, map); break;
      case 'tent': obj = tent(p, map); break;
      case 'wagon': obj = wagon(p, map); break;
      case 'campfire': obj = campfire(p, map); break;
      case 'brazier': obj = brazier(p, map); break;
      case 'candelabra': obj = candelabra(p, map); break;
      case 'sarcophagus': obj = sarcophagus(p, map); break;
      case 'pew': obj = pew(p, map); break;
      case 'throne': obj = throne(p, map); break;
      case 'organ': obj = organ(p, map); break;
      case 'belfry': obj = belfry(p, map); break;
      case 'cryptwall': obj = cryptwall(p, map); break;
      default: {
        const t = map.at(Math.floor(p.x), Math.floor(p.z)); const y = (t ? t.h : 0) * HSTEP + (p.y || 0);
        if (DECAL[p.type]) { obj = decalSprite(pick(DECAL[p.type], p.type), man, bc); obj.position.set(p.x, y, p.z); }
        else if (SPRITE[p.type]) { obj = billboardSprite(pick(SPRITE[p.type], p.type), man, p, bc); obj.position.set(p.x, y, p.z); }
      }
    }
    if (obj) { if (!obj.name.startsWith('prop_') && !obj.name.startsWith('decal_')) mergeStatic(obj); obj.userData.prop = p; group.add(obj); }
  }
  const caps = voidCaps(map); if (caps) group.add(caps);
  const patina = rockPatina(map); if (patina) group.add(patina);
  await Promise.all(bc.pending);
  return group;
}
