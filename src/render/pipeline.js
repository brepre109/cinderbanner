import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';
import { GradeShader } from './post/grade.js';
// Renderer + frame composition. Owned by the lighting item.
// Stack: scene (linear HDR, MSAA where available, depth texture) → GTAO (reads that depth, so sprite cut-outs occlude
//        correctly) → bloom (threshold above lit diffuse white: only VFX / emissive lift) → grade (tonemap, shadow
//        gamma, the genre split-tone, painted dusk sky, aerial perspective, vignette) → SMAA where MSAA is unavailable.
// AA choice: MSAA smooths terrace/cliff geometry edges but never touches texels, so magnified pixel-art sprites keep their
// hard 2×2 stair-steps. The software GL in the capture harness reports 0 usable samples, so there we fall back to SMAA
// rather than ship an aliased frame (?aa=msaa|smaa|off overrides).
const q = new URLSearchParams(location.search);
// Renders the scene into its own MSAA + depth target, then copies the resolved colour into the composer's read buffer.
// Keeping the scene target out of the composer's ping-pong means its depth texture can be sampled by later passes
// (AO, grade) without ever being the framebuffer they write to.
class ScenePass extends Pass {
  // PERF r11: transparent + NoBlending draws exactly what the opaque copy drew (no blend, no OPAQUE define in the copy
  // shader), and gives the copy the same program key as the bloom pass's additive copy: one program, not two.
  // PERF r12: copyOut false (AO on) skips the copy: the AO pass reads the scene target's resolved colour itself (its own
  // first step is a NoBlending copy of its input into the write buffer, so the frame is bit-identical), which saves a
  // full-screen pass and leaves one of the composer's two half-float buffers never bound -- never allocated -- on the
  // MSAA path, where the grade draws straight to the canvas.
  constructor(scene, camera, target, copyOut = true) { super(); this.scene = scene; this.camera = camera; this.target = target; this.copyOut = copyOut; this.needsSwap = false; this.copy = ShaderMaterial_(CopyShader); this.copy.transparent = true; this.copy.blending = THREE.NoBlending; this.quad = new FullScreenQuad(this.copy); }
  render(renderer, writeBuffer, readBuffer) {
    renderer.setRenderTarget(this.target); renderer.clear(true, true, false); renderer.render(this.scene, this.camera);
    if (!this.copyOut) return;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer); this.copy.uniforms.tDiffuse.value = this.target.texture; this.quad.render(renderer);
  }
  setSize(w, h) { this.target.setSize(w, h); }
  dispose() { this.target.dispose(); this.copy.dispose(); this.quad.dispose(); }
}
// PERF r11: UnrealBloomPass builds one blur material per mip with KERNEL_RADIUS as a DEFINE (3,5,7,9,11), i.e. five
// programs for one shader. Same shader here with the radius as a uniform loop bound under a fixed maximum: the loop
// visits the same taps in the same order with the same coefficients, so the sums are the same; one program.
const BLUR_MAX = 11;
class OneProgramBloomPass extends UnrealBloomPass {
  _getSeparableBlurMaterial(kernelRadius) {
    const m = super._getSeparableBlurMaterial(kernelRadius);
    const co = m.uniforms.gaussianCoefficients.value.slice(); while (co.length < BLUR_MAX) co.push(0);
    m.uniforms.gaussianCoefficients.value = co; m.uniforms.kernelRadius = { value: kernelRadius };
    m.defines = { KERNEL_MAX: BLUR_MAX };
    m.fragmentShader = m.fragmentShader.replace('uniform float gaussianCoefficients[KERNEL_RADIUS];', 'uniform float gaussianCoefficients[KERNEL_MAX]; uniform int kernelRadius;')
      .replace('for( int i = 1; i < KERNEL_RADIUS; i ++ ) {', 'for( int i = 1; i < KERNEL_MAX; i ++ ) { if ( i >= kernelRadius ) break;');
    return m;
  }
}
// PERF r12: the AO and bloom passes run at `scale` x the composer size. Before, EffectComposer.addPass() called
// setSize(full device size) on both right after construction, so the half-resolution sizes passed to the constructors
// never applied (GTAO ran at full device res everywhere). The scale is now applied in setSize itself.
// ScaledGTAOPass also takes its colour input from the scene target (`source`) instead of the composer's read buffer.
// PERF r20: the AO normal is computed ONCE per frame. Stock GTAOPass with a depth-only G-buffer reconstructs the view
// normal from depth (9 depth fetches) at every pixel of the AO pass AND at the centre plus every one of the 14 taps of the
// Poisson denoise: ~165 depth fetches per pixel, the single biggest cost of the frame on an integrated GPU (1080p: ~20 ms).
// NormalFromDepthShader runs that exact reconstruction (the same code as three's computeNormalFromDepth, texel for
// texel: it is evaluated at the full-resolution depth texel, and the target is full resolution + nearest filtered, so
// every lookup lands on the texel the old code would have rebuilt) once per pixel into an 8-bit target; AO and denoise
// then read it with NORMAL_VECTOR_TYPE 1 (one fetch). Only difference: normals quantised to 8 bits per axis.
const NormalFromDepthShader = {
  uniforms: { tDepth: { value: null }, cameraProjectionMatrixInverse: { value: new THREE.Matrix4() } },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform highp sampler2D tDepth; uniform mat4 cameraProjectionMatrixInverse; varying vec2 vUv;
    #include <packing>
    vec3 getViewPosition(const in vec2 screenPosition, const in float depth) {
      vec4 clipSpacePosition = vec4(vec3(screenPosition, depth) * 2.0 - 1.0, 1.0);
      vec4 viewSpacePosition = cameraProjectionMatrixInverse * clipSpacePosition;
      return viewSpacePosition.xyz / viewSpacePosition.w;
    }
    float fetchDepth(const ivec2 uv) { return texelFetch(tDepth, uv.xy, 0).x; }
    void main() {
      vec2 size = vec2(textureSize(tDepth, 0));
      vec2 uv = vUv; ivec2 p = ivec2(uv * size);
      float c0 = fetchDepth(p);
      if (c0 >= 1.0) { gl_FragColor = vec4(0.5, 0.5, 0.5, 1.0); return; }   // void: a zero normal (the denoise gives it no weight)
      float l2 = fetchDepth(p - ivec2(2, 0)); float l1 = fetchDepth(p - ivec2(1, 0));
      float r1 = fetchDepth(p + ivec2(1, 0)); float r2 = fetchDepth(p + ivec2(2, 0));
      float b2 = fetchDepth(p - ivec2(0, 2)); float b1 = fetchDepth(p - ivec2(0, 1));
      float t1 = fetchDepth(p + ivec2(0, 1)); float t2 = fetchDepth(p + ivec2(0, 2));
      float dl = abs((2.0 * l1 - l2) - c0); float dr = abs((2.0 * r1 - r2) - c0);
      float db = abs((2.0 * b1 - b2) - c0); float dt = abs((2.0 * t1 - t2) - c0);
      vec3 ce = getViewPosition(uv, c0).xyz;
      vec3 dpdx = (dl < dr) ? ce - getViewPosition((uv - vec2(1.0 / size.x, 0.0)), l1).xyz : -ce + getViewPosition((uv + vec2(1.0 / size.x, 0.0)), r1).xyz;
      vec3 dpdy = (db < dt) ? ce - getViewPosition((uv - vec2(0.0, 1.0 / size.y)), b1).xyz : -ce + getViewPosition((uv + vec2(0.0, 1.0 / size.y)), t1).xyz;
      gl_FragColor = vec4(packNormalToRGB(normalize(cross(dpdx, dpdy))), 1.0);
    }`,
};
// PERF r20: stock OUTPUT.Default is two full-screen half-float passes (copy the colour, then a multiply-blend of the AO
// over it). One pass reading both does the same product: colour * mix(1, ao, intensity).
const AOApplyShader = {
  uniforms: { tDiffuse: { value: null }, tAO: { value: null }, intensity: { value: 1 } },
  vertexShader: NormalFromDepthShader.vertexShader,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform sampler2D tAO; uniform float intensity; varying vec2 vUv;
    void main() { vec4 c = texture2D(tDiffuse, vUv); vec3 ao = texture2D(tAO, vUv).rgb; gl_FragColor = vec4(c.rgb * mix(vec3(1.0), ao, intensity), c.a); }`,
};
// PERF r12: the AO and bloom passes run at `scale` x the composer size. Before, EffectComposer.addPass() called
// setSize(full device size) on both right after construction, so the half-resolution sizes passed to the constructors
// never applied (GTAO ran at full device res everywhere). The scale is now applied in setSize itself.
// ScaledGTAOPass also takes its colour input from the scene target (`source`) instead of the composer's read buffer.
// PERF r20: + the shared normal prepass and the fused apply above (?aonormals=live restores the per-tap reconstruction).
class ScaledGTAOPass extends GTAOPass {
  setSize(w, h) { const k = this.scale ?? 1; this.fullW = w; this.fullH = h; super.setSize(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))); this.nrmTarget?.setSize(w, h); }
  useNormalPrepass(depthTexture) {
    this.nrmTarget = new THREE.WebGLRenderTarget(this.fullW || this.width, this.fullH || this.height, { type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
    this.nrmMat = ShaderMaterial_(NormalFromDepthShader); this.nrmMat.uniforms.tDepth.value = depthTexture;
    this.setGBuffer(depthTexture, this.nrmTarget.texture);
  }
  useFusedApply() { this.applyMat = ShaderMaterial_(AOApplyShader); this.applyMat.blending = THREE.NoBlending; this.output = GTAOPass.OUTPUT.Off; }
  render(renderer, writeBuffer, readBuffer, dt, mask) {
    const src = this.source || readBuffer;
    if (this.nrmMat) { this.nrmMat.uniforms.cameraProjectionMatrixInverse.value.copy(this.camera.projectionMatrixInverse); renderer.setRenderTarget(this.nrmTarget); this._fsQuad.material = this.nrmMat; this._fsQuad.render(renderer); }
    super.render(renderer, writeBuffer, src, dt, mask);
    if (this.applyMat) {
      const u = this.applyMat.uniforms; u.tDiffuse.value = src.texture; u.tAO.value = this.pdRenderTarget.texture; u.intensity.value = this.blendIntensity;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this._fsQuad.material = this.applyMat; this._fsQuad.render(renderer);
    }
  }
  dispose() { super.dispose(); this.nrmTarget?.dispose(); this.nrmMat?.dispose(); this.applyMat?.dispose(); this.blendMaterial?.dispose(); }
}
class ScaledBloomPass extends OneProgramBloomPass {
  setSize(w, h) { const k = this.scale ?? 1; super.setSize(Math.max(2, Math.round(w * k)), Math.max(2, Math.round(h * k))); }
}
const ShaderMaterial_ = (shader) => new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(shader.uniforms), vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader, depthTest: false, depthWrite: false });
// ---- R20 graphics quality tiers ---------------------------------------------------------------------------------
// One knob per thing that costs fill rate on a small GPU. Every cap is a PIXEL BUDGET, so a tier changes nothing at a
// size already inside its budget: at 1100x620 (0.68 MP) Medium draws exactly High's frame (AO and bloom at full res,
// 4x MSAA); at 1920x1080 (2.07 MP) it runs the low-frequency passes at ~0.75 MP (AO's radius is in world units, so
// the occlusion looks the same, only its texels are bigger) and MSAA at 2x. Low also caps the 3D scene itself
// (canvas drawn below 1 CSS px, upscaled by the compositor; the DOM UI stays native), trims AO taps and halves the
// shadow map. `sceneMP` only ever lowers the pixel ratio; `dprMin` is the adaptive controller's floor.
export const GFX_KEY = 'cinderbanner.gfx';
export const GFX_TIERS = {
  high: { label: 'High', aoMP: Infinity, bloomMP: Infinity, msaa4MP: Infinity, msaa: 4, aoSamples: 14, pdSamples: 14, sceneMP: Infinity, dprMin: 1, shadow: 2048 },
  medium: { label: 'Medium', aoMP: 0.75, bloomMP: 0.75, msaa4MP: 1.0, msaa: 4, aoSamples: 14, pdSamples: 14, sceneMP: Infinity, dprMin: 0.8, shadow: 2048 },
  low: { label: 'Low', aoMP: 0.4, bloomMP: 0.4, msaa4MP: 0, msaa: 2, aoSamples: 9, pdSamples: 8, sceneMP: 1.1, dprMin: 0.6, shadow: 1024 },
};
const TIER_ORDER = ['low', 'medium', 'high'];
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };
/** The player's Graphics Quality choice: 'auto' | 'high' | 'medium' | 'low' (?gfx= overrides for one page). */
export function gfxPref() { const v = (q.get('gfx') || lsGet(GFX_KEY) || 'auto').toLowerCase(); return GFX_TIERS[v] || v === 'auto' ? v : 'auto'; }
/** Store the choice (the Options row calls this; it applies on the next battle load). Clears the Auto calibration. */
export function setGfxPref(v) { lsSet(GFX_KEY, v === 'auto' ? null : v); lsSet(GFX_KEY + '.cal', null); }
// Auto's first guess before any measurement, from the renderer string: integrated / mobile parts start at Medium.
const IGPU = /intel|mali|adreno|powervr|videocore|apple gpu|apple m\d(?!.*(pro|max|ultra))|radeon\(tm\) graphics|vega \d+ graphics|radeon graphics/i;

export function createPipeline(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  // Software GL (SwiftShader / llvmpipe in the headless capture harness) renders the full stack at ~4 s/frame, which makes
  // fixed-delay screenshots stale. On those renderers the same passes run at half resolution: the look is the same, the
  // frame costs a third. Real GPUs get the full-resolution stack.
  const gl = renderer.getContext(); const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const glName = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ''; const soft = q.get('gpu') === 'soft' || (q.get('gpu') !== 'hard' && /swiftshader|llvmpipe|softpipe/i.test(glName));
  // Tier: software GL (the capture harness) is always High -- every archived capture was judged on that frame.
  // Auto = a remembered calibration for this GPU and window size class if there is one, else the renderer-string guess;
  // battleboot calls calibrate() once during the warm-up to confirm it (pipeline.calibrate below).
  const pref = gfxPref();
  const calKey = GFX_KEY + '.cal';
  const sizeClass = () => (innerWidth * innerHeight > 1.4e6 ? 'L' : innerWidth * innerHeight > 0.9e6 ? 'M' : 'S');
  let cal = null; try { cal = JSON.parse(lsGet(calKey) || 'null'); } catch { cal = null; }
  const calHit = () => cal && cal.gl === glName && cal[sizeClass()] && GFX_TIERS[cal[sizeClass()]];
  let tierId = soft ? 'high' : pref !== 'auto' ? pref : calHit() ? cal[sizeClass()] : IGPU.test(glName) ? 'medium' : 'high';
  let tier = GFX_TIERS[tierId];
  // PERF r12: effective pixel ratio capped at 1.5 (was 2): at devicePixelRatio 2 the old cap made every full-screen
  // buffer 4x its CSS size (a 1080p window ~ 860 MB of render targets with 4x MSAA). ?dpr=<n> overrides the cap.
  // `dpr` below is the ratio in use; the adaptive resolution controller (tick) may lower it toward `dprMin`.
  // R20: the tier's scene budget (Low only) caps the ratio too, and can take it below 1 CSS px.
  const DPR_CAP = +q.get('dpr') > 0 ? +q.get('dpr') : 1.5;
  const devDpr = () => { const d = Math.min(typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1, DPR_CAP); const b = Math.sqrt(tier.sceneMP * 1e6 / Math.max(1, innerWidth * innerHeight)); return +q.get('dpr') > 0 ? d : Math.min(d, b); };
  let dprMax = devDpr(), dpr = dprMax;
  renderer.setPixelRatio(dpr); renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;            // the grade pass owns tone mapping (sprites stay unwashed)
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 1);
  // PERF r11: three's per-program error check (getProgramInfoLog + two getShaderInfoLog on first use) is a sync point
  // and a string copy per program at boot. Shader errors are a development concern: the vite dev server and ?debug keep it.
  renderer.debug.checkShaderErrors = !!import.meta.env?.DEV || q.has('debug');

  const aa = q.get('aa') || (soft ? 'smaa' : 'msaa');
  // PERF r12: samples/aoScale/bloomScale are now functions of the pixel ratio in use (see scaleFor): 4x MSAA at ratio
  // <= 1.25, 2x above (each sample of a half-float target is 8 bytes per device pixel; at ratio 1.5 two samples already
  // put more than one sample per CSS pixel edge than 4x does at ratio 1). AO and bloom run at CSS-pixel resolution
  // (scale 1/ratio) so their radii, noise and glow width look the same on every display; at ratio 1 that is scale 1,
  // i.e. exactly the old frame. Software GL keeps the full-resolution stack it has actually been drawing (and judged by)
  // all along: the old aoScale/bloomScale 0.5 for it never took effect (see ScaledGTAOPass).
  // R20: and each is further capped by the tier's pixel budget (GFX_TIERS).
  const opts = { post: q.get('post') !== 'off', ao: q.get('ao') !== 'off', bloom: q.get('bloom') !== 'off', aa, smaa: aa === 'smaa', soft, samples: 0, aoScale: 1, bloomScale: 1, glName, dpr, dprMax, tier: tierId, gfx: pref, shadowRes: soft ? 1024 : tier.shadow };
  function scaleFor(r) {
    opts.dpr = r; opts.dprMax = dprMax; opts.tier = tierId;
    const mp = Math.max(1, innerWidth * innerHeight) * r * r / 1e6;       // device megapixels of the scene target
    const cap = (budget) => Math.min(1, Math.sqrt(budget / mp));
    opts.samples = aa === 'msaa' && !soft ? (dprMax > 1.25 || mp > tier.msaa4MP ? Math.min(2, tier.msaa) : tier.msaa) : 0;   // by the DISPLAY's ratio: an adaptive drop never adds samples
    opts.aoScale = soft ? 1 : Math.min(1, 1 / r, cap(tier.aoMP)); opts.bloomScale = soft ? 1 : Math.min(1, 1 / r, cap(tier.bloomMP));
  }
  scaleFor(dpr);
  let composer = null, passes = null, size = { w: innerWidth, h: innerHeight }, stale = null;
  const px = (v) => Math.max(1, Math.floor(v * dpr));   // device pixels, rounded the way the canvas itself is
  // Grade overrides survive a composer rebuild. `resize()` drops the composer (the depth texture has to be
  // re-made), and the next render calls build(), which mints a NEW ShaderPass with the shader's DEFAULT uniforms.
  // Anything a console/sweep session had set was therefore silently reverted on the next resize — and puppeteer's
  // element screenshot fires exactly one resize, so every screenshot in a grade sweep captured the defaults. Found
  // in r5 when shadowGamma 1.45 -> 3.0 produced a byte-identical frame. Recorded here and re-applied in build().
  const gradeOverrides = {};
  function applyGrade(pass, u) {
    for (const k in u) { const v = pass.uniforms[k]; if (!v) continue; if (v.value?.set && typeof u[k] !== 'number') v.value.set(...[].concat(u[k])); else v.value = u[k]; }
  }

  // ---- per-frame grade wiring -----------------------------------------------------------------------
  // Two things the sky/haze cannot know statically, both published by lighting.js on scene.userData:
  //  · sunScreen — where the key light sits in SCREEN space. The backdrop's warm lobe has to swing with the
  //    camera or a 90° rotation reveals the sky as a sticker. Orthographic projection has no vanishing point,
  //    so a directional light has no finite screen position: we take its direction in view space and push the
  //    lobe out along that direction from screen centre, fading it out when the sun swings behind the camera.
  //  · depthCueRange — the aerial-perspective ramp, in depth-buffer units, fitted to the diorama's own bounds
  //    at the current zoom instead of hard-coded (the ortho near/far span 200 units for a 30-unit diorama, so a
  //    guessed constant range either does nothing or hazes everything).
  const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _p = new THREE.Vector3();
  function depthOf(p, camera) { return _v.copy(p).project(camera).z * 0.5 + 0.5; }
  // R7 map moods: lighting.js publishes the map's grade overrides on scene.userData.grade. They are applied ONCE
  // per (composer build, mood object) and the console overrides are re-applied on top, so setGrade() still wins.
  let moodApplied = null, clock = 0;
  function driveGrade(scene, camera, dt) {
    const u = passes?.grade?.uniforms; if (!u) return;
    const mg = scene.userData.grade || null;
    if (mg !== moodApplied) { moodApplied = mg; if (mg) applyGrade(passes.grade, mg); applyGrade(passes.grade, gradeOverrides); }
    if (u.time) { clock += dt || 0; u.time.value = clock; }
    u.aspect.value = size.w / size.h;
    const dir = scene.userData.sunDir;
    if (dir) {
      _v.copy(dir).transformDirection(camera.matrixWorldInverse);     // sun direction in view space
      const len = Math.hypot(_v.x, _v.y) || 1e-4;
      const behind = Math.max(0, -_v.z);                              // >0 when the sun is behind the camera
      u.sunScreen.value.set(0.5 + (_v.x / len) * 0.42, 0.5 + (_v.y / len) * 0.40);
      u.skyGlowAmt.value = 1.0 - 0.75 * behind;
    }
    const d = scene.userData.diorama;
    if (d) {
      camera.getWorldDirection(_f);
      const near = depthOf(_p.copy(_f).multiplyScalar(-d.radius * 0.45).add(d.center), camera);   // no per-frame clone() (PERF r7)
      const far = depthOf(_p.copy(_f).multiplyScalar(d.radius * 0.95).add(d.center), camera);
      if (far > near) u.depthCueRange.value.set(near, far);
    }
  }

  function makeTarget(w, h) {
    const depthTexture = new THREE.DepthTexture(px(w), px(h)); depthTexture.type = THREE.UnsignedIntType;
    return new THREE.WebGLRenderTarget(px(w), px(h), { type: THREE.HalfFloatType, samples: opts.aa === 'msaa' ? opts.samples : 0, depthTexture, depthBuffer: true, stencilBuffer: false });
  }
  function build(scene, camera) {
    const target = makeTarget(size.w, size.h);
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(px(size.w), px(size.h), { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false }));
    // PERF r12: the composer is sized in device pixels directly (ratio 1), so every pass gets the same integer size
    // as the canvas (at ratio 1.5 w * ratio is fractional; three's canvas floors it, the composer did not).
    composer.setPixelRatio(1); composer.setSize(px(size.w), px(size.h));
    passes = {};
    passes.render = new ScenePass(scene, camera, target, !opts.ao); composer.addPass(passes.render);
    if (opts.ao) {
      const ao = new ScaledGTAOPass(scene, camera, Math.round(px(size.w) * opts.aoScale), Math.round(px(size.h) * opts.aoScale));
      ao.scale = opts.aoScale; ao.source = target; ao.setSize(px(size.w), px(size.h));
      // PERF r12: the AO and its denoised copy are one value in [0,1] (vec4(vec3(ao), 1)): 8-bit targets, not half-float
      // (half the bytes and bandwidth; parity measured at the capture noise floor). ?aofmt=half restores them.
      if (q.get('aofmt') !== 'half') for (const rt of [ao.gtaoRenderTarget, ao.pdRenderTarget]) rt.texture.type = THREE.UnsignedByteType;
      // depth from the real scene render: alpha-tested sprites occlude as cut-outs
      if (q.get('aonormals') === 'live') ao.setGBuffer(target.depthTexture, undefined); else ao.useNormalPrepass(target.depthTexture);
      // AO is the one part of the stack the terrain's fixed emissive fill cannot resist (it multiplies the final
      // colour), so it carries most of the contact darkening: wall/ground junctions, under eaves, prop feet,
      // the inside corners of every terrace. Radius ~0.55 u ≈ half a tile — big enough to read, small enough
      // not to become a dirty smear across open cobble.
      ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.5, thickness: 0.9, scale: 1.15, samples: tier.aoSamples, distanceFallOff: 0.7, screenSpaceRadius: false });
      ao.updatePdMaterial({ lumaPhi: 8, depthPhi: 2.5, normalPhi: 3.5, radius: 3, radiusExponent: 1, rings: 2, samples: tier.pdSamples });
      ao.blendIntensity = 0.92; ao.output = GTAOPass.OUTPUT.Default; if (q.get('aoapply') !== 'split') ao.useFusedApply();
      passes.ao = ao; composer.addPass(ao);
    }
    if (opts.bloom) {
      // Threshold must sit above the HOTTEST non-VFX pixel in the scene. r2 ran 1.15, but the house-window emissive
      // texel already lands near 1.0 linear and lit stone goes past it, so bloom fired on the BUILDINGS and erased any
      // unit standing in front of a lit facade (CRITIQUE_R2 integration bug 6, and it is the whole story of
      // r2melee/melee_close.png). 1.6 is above the windows and below every additive VFX core. Strength 0.90 -> 0.45
      // because at 0.90 a spell core spreads to 63% of frame width (rank 7); the genre's Fire 2 spreads to 10%.
      const bloom = new ScaledBloomPass(new THREE.Vector2(px(size.w) * opts.bloomScale, px(size.h) * opts.bloomScale), 0.45, 0.55, 1.6);
      bloom.scale = opts.bloomScale; passes.bloom = bloom; composer.addPass(bloom);
    }
    const grade = new ShaderPass(GradeShader); grade.uniforms.tDepth.value = target.depthTexture; grade.uniforms.aspect.value = size.w / size.h;
    applyGrade(grade, gradeOverrides);
    passes.grade = grade; composer.addPass(grade);
    // MSAA is preferred (it smooths geometry edges without ever touching a magnified sprite texel), but the
    // software GL used by the capture harness gives us 0 samples — there the choice is SMAA or raw aliasing.
    if (opts.smaa) { passes.smaa = new SMAAPass(); composer.addPass(passes.smaa); }
  }
  function teardown(st) { for (const p of st.composer.passes) p.dispose?.(); st.composer.dispose(); }
  const adapt = { on: !soft && q.get('adaptive') !== 'off', last: 0, n: 0, ema: 16.7, over: 0, good: 0, wait: 20, dropped: false, probed: false };
  function setDpr(r) {
    if (Math.abs(r - dpr) < 1e-3) return;
    dpr = r; scaleFor(dpr); renderer.setPixelRatio(dpr); renderer.setSize(size.w, size.h);
    if (composer) { if (stale) teardown(stale); stale = { composer, passes }; composer = null; passes = null; }
    adapt.n = 0; adapt.over = 0; adapt.good = 0;
  }
  // R20: switch tier live (Auto's calibration and its runtime step-down; the Options row applies on the next load).
  // The composer is rebuilt on the next render like a resize; Low's AO tap counts are new programs (a one-off link).
  function setTier(id) {
    if (!GFX_TIERS[id] || id === tierId) return false;
    tierId = id; tier = GFX_TIERS[id]; dprMax = devDpr(); dpr = dprMax; adapt.dropped = false;
    scaleFor(dpr); renderer.setPixelRatio(dpr); renderer.setSize(size.w, size.h);
    if (composer) { if (stale) teardown(stale); stale = { composer, passes }; composer = null; passes = null; }
    adapt.n = 0; adapt.over = 0; adapt.good = 0; return true;
  }
  const saveCal = () => { if (soft || pref !== 'auto') return; const c = cal && cal.gl === glName ? cal : { gl: glName }; c[sizeClass()] = tierId; cal = c; lsSet(calKey, JSON.stringify(c)); };
  // GPU time of one frame: a timer query where the browser exposes one (GPU only, immune to CPU load), else a
  // blocking 1-pixel readback (CPU + GPU of the frame, taken as the minimum over a few frames).
  const tq = !soft ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
  async function timeFrames(draw, n) {
    const out = []; const px1 = new Uint8Array(4);
    for (let i = 0; i < n; i++) {
      if (tq) {
        const qq = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, qq); draw(); gl.endQuery(tq.TIME_ELAPSED_EXT);
        let t = 0; while (!gl.getQueryParameter(qq, gl.QUERY_RESULT_AVAILABLE) && t++ < 40) await new Promise((r) => setTimeout(r, 4));
        if (!gl.getParameter(tq.GPU_DISJOINT_EXT) && gl.getQueryParameter(qq, gl.QUERY_RESULT_AVAILABLE)) out.push(gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(qq);
      } else { const t0 = performance.now(); draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1); out.push(performance.now() - t0); await new Promise((r) => setTimeout(r, 0)); }
    }
    out.sort((a, b) => a - b); return out.length ? out[Math.floor((out.length - 1) / 3)] : NaN;   // lower third: warm, not the lucky best
  }
  return {
    renderer,
    get composer() { return composer; },
    get passes() { return passes; },
    opts,
    render(scene, camera, dt) {
      if (!opts.post) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.render(scene, camera); return; }
      if (!composer) { build(scene, camera); moodApplied = null; }
      passes.render.scene = scene; passes.render.camera = camera;
      if (passes.ao) { passes.ao.scene = scene; passes.ao.camera = camera; }
      driveGrade(scene, camera, dt);
      composer.render(dt);
      if (stale) { teardown(stale); stale = null; }
    },
    resize(w, h) {
      dprMax = devDpr(); if (dpr > dprMax || !adapt.dropped) dpr = dprMax;   // a display change resets the ratio (adaptive drops survive a window resize)
      scaleFor(dpr); size = { w, h }; renderer.setPixelRatio(dpr); renderer.setSize(w, h);
      // rebuilt (with a fresh depth texture) on the next render. PERF r12: the old composer is now actually freed --
      // EffectComposer.dispose() frees only its own two buffers, so every resize used to leak the scene target
      // (MSAA colour + depth + depth texture), both AO targets, the bloom chain and the SMAA targets. It is freed
      // AFTER the new stack's first frame, so the programs the two share are never released and re-linked.
      if (composer) { if (stale) teardown(stale); stale = { composer, passes }; composer = null; passes = null; }
    },
    // PERF r12 adaptive resolution: fed the frame loop's rAF timestamps. If the frame interval stays over budget
    // (EMA > 22 ms for ~1 s of frames) the pixel ratio steps down x0.85, never below dprMin (default 1: CSS pixels,
    // so pixel-art sprites are never drawn below native size; ?minres=<ratio> lowers it). Stepping back up is probed
    // after 20 s at display rate; a probe that goes over budget again doubles the wait. Off on software GL (the capture
    // harness) and with ?adaptive=off. Intervals over 100 ms (tab switch, a hitch) are ignored, not averaged in.
    tick(now) {
      if (!adapt.on) return;
      const ms = now - adapt.last; adapt.last = now;
      if (!(ms > 0 && ms < 100) || document.hidden) return;
      adapt.n++; adapt.ema = adapt.n < 20 ? ms : adapt.ema * 0.94 + ms * 0.06; if (adapt.n < 45) return;
      const dprMin = Math.min(dprMax, +q.get('minres') > 0 ? +q.get('minres') : tier.dprMin);
      // R20 Auto: over budget with the ratio already at this tier's floor -> the next tier down (remembered).
      if (adapt.ema > 22 && adapt.over > 120 && dpr <= dprMin + 1e-3 && pref === 'auto' && TIER_ORDER.indexOf(tierId) > 0) { setTier(TIER_ORDER[TIER_ORDER.indexOf(tierId) - 1]); saveCal(); return; }
      if (adapt.ema > 22) { adapt.good = 0; if (++adapt.over > 60 && dpr > dprMin + 1e-3) { if (adapt.probed) adapt.wait = Math.min(adapt.wait * 2, 640); adapt.probed = false; setDpr(Math.max(dprMin, dpr * 0.85)); adapt.dropped = true; } }
      else { adapt.over = 0; if (adapt.ema < 18.5 && dpr < dprMax - 1e-3 && ++adapt.good > adapt.wait * 60) { setDpr(Math.min(dprMax, dpr / 0.85)); adapt.probed = true; } }
    },
    get pixelRatio() { return dpr; },
    // PERF r11: build the composer (and so the scene pass's render target) before the first frame, so programs can
    // be requested against the exact target the scene pass will draw into (the target is part of a program's key:
    // a linear half-float target and the sRGB canvas are different programs).
    prepare(scene, camera) { if (opts.post && !composer) { build(scene, camera); moodApplied = null; } },
    // PERF r11: ISSUE the compile + link of every program `objects` will need in the scene pass, without waiting for
    // any of them. WebGL's compileShader/linkProgram are asynchronous commands (the GPU process works through them
    // while this thread carries on); only a query -- getProgramInfoLog, getUniformLocation, the first draw -- blocks.
    // So a batch issued here links while the boot builds props, decodes atlases and places units, and the warm-up
    // draw finds the programs ready instead of paying for all of them serially at the end. `objects` is an array of
    // meshes (only the ones that will actually be drawn: pooled, hidden meshes would queue links ahead of the ones
    // the first frame needs). Same program keys as a real draw: same scene (lights, shadows), same target.
    precompile(objects, scene, camera) {
      if (!objects.length) return;
      const prev = renderer.getRenderTarget(), tm = renderer.toneMapping;
      if (opts.post) { this.prepare(scene, camera); renderer.setRenderTarget(passes.render.target); } else renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const root = { traverse(fn) { for (let i = 0; i < objects.length; i++) fn(objects[i]); }, traverseVisible() {} };
      try { renderer.compile(root, camera, scene); } finally { renderer.setRenderTarget(prev); renderer.toneMapping = tm; }
    },
    // R20 Auto calibration, called once by the boot's warm-up with its own draw (dt 0). Skipped when the tier is fixed
    // (a player choice, ?gfx=, software GL) or remembered for this GPU + window size class. Budget: 11 ms of GPU per
    // frame (60 fps with room for the JS frame); over it steps down, far under it steps up, then the answer is stored.
    async calibrate(draw) {
      if (soft || pref !== 'auto' || !opts.post) return { tier: tierId, skipped: true };
      if (calHit()) { opts.cal = { tier: tierId, cached: true }; return opts.cal; }
      const log = []; const HI = +q.get('gfxbudget') || 11, LO = HI * 0.45;
      for (let step = 0; step < 3; step++) {
        draw(); const ms = await timeFrames(draw, tq ? 6 : 5); log.push([tierId, +ms.toFixed(2)]);
        if (!(ms > 0)) break;
        const i = TIER_ORDER.indexOf(tierId);
        if (ms > HI && i > 0) { setTier(TIER_ORDER[i - 1]); continue; }
        if (ms < LO && i < TIER_ORDER.length - 1 && !log.some(([t]) => t === TIER_ORDER[i + 1])) { setTier(TIER_ORDER[i + 1]); continue; }
        if (ms > HI && log.length > 1 && log[log.length - 2][1] <= HI) setTier(log[log.length - 2][0]);   // stepped up into a miss: back
        break;
      }
      draw(); saveCal(); opts.cal = { tier: tierId, method: tq ? 'timer' : 'readback', log }; return opts.cal;
    },
    setTier(id) { const ok = setTier(id); if (ok) saveCal(); return ok; },
    get tier() { return tierId; },
    // tuning hooks for the console / screenshots
    setPixelRatio(r) { setDpr(Math.max(0.25, Math.min(dprMax, r))); },
    setGrade(u) { Object.assign(gradeOverrides, u); if (passes?.grade) applyGrade(passes.grade, u); },
  };
}
