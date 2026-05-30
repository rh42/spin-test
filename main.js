import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

// ----------------------------------------------------------------------------
//  THE FIELD — two smooth analytic maps on the sphere (functions, not buffers)
// ----------------------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(7);
const M = 16;
const basis = [];
for (let k = 0; k < M; k++) {
  let x = rng() * 2 - 1, y = rng() * 2 - 1, z = rng() * 2 - 1;
  const n = Math.hypot(x, y, z) || 1;
  basis.push({ u: new THREE.Vector3(x / n, y / n, z / n), f: 1 + Math.floor(rng() * 5),
               ph: rng() * Math.PI * 2, a: rng() * 2 - 1, c: rng() * 2 - 1 });
}
const MIX = 0.0;
const sqrtComp = Math.sqrt(1 - MIX * MIX);
function fieldB(v) {
  let s = 0;
  for (const b of basis) s += (MIX * b.a + sqrtComp * b.c) * Math.cos(b.f * v.dot(b.u) + b.ph);
  return s;
}

// ----------------------------------------------------------------------------
//  SAMPLING + correlation
// ----------------------------------------------------------------------------
const N = 256;
const sampleDirs = [];
const Avals = new Float64Array(N);
{
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const yy = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - yy * yy), th = golden * i;
    const d = new THREE.Vector3(Math.cos(th) * r, yy, Math.sin(th) * r);
    sampleDirs.push(d);
    let s = 0; for (const b of basis) s += b.a * Math.cos(b.f * d.dot(b.u) + b.ph);
    Avals[i] = s;
  }
}
const _qInv = new THREE.Quaternion();
const _tmp = new THREE.Vector3();
const Bvals = new Float64Array(N);
function correlationAt(q) {
  _qInv.copy(q).invert();
  let mA = 0, mB = 0;
  for (let i = 0; i < N; i++) {
    _tmp.copy(sampleDirs[i]).applyQuaternion(_qInv);
    Bvals[i] = fieldB(_tmp); mA += Avals[i]; mB += Bvals[i];
  }
  mA /= N; mB /= N;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < N; i++) { const xa = Avals[i] - mA, xb = Bvals[i] - mB; num += xa * xb; da += xa * xa; db += xb * xb; }
  return num / (Math.sqrt(da * db) || 1);
}
function randomQuaternion() {                 // Shoemake (1992): uniform on SO(3)
  const u1 = rng(), u2 = rng(), u3 = rng();
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  return new THREE.Quaternion(a * Math.sin(2 * Math.PI * u2), a * Math.cos(2 * Math.PI * u2),
                              b * Math.sin(2 * Math.PI * u3), b * Math.cos(2 * Math.PI * u3));
}

// ----------------------------------------------------------------------------
//  COLORMAPS — mako (landing) ↔ viridis (body), cross-blended by scroll
// ----------------------------------------------------------------------------
const MAKO = [
  [0.04,0.02,0.05],[0.10,0.07,0.16],[0.16,0.12,0.28],[0.21,0.18,0.40],
  [0.23,0.26,0.50],[0.22,0.35,0.55],[0.20,0.44,0.57],[0.20,0.53,0.58],
  [0.24,0.62,0.57],[0.36,0.71,0.55],[0.55,0.80,0.58],[0.78,0.89,0.70]
];
const VIRIDIS = [
  [0.267,0.005,0.329],[0.283,0.141,0.458],[0.254,0.265,0.530],[0.207,0.372,0.553],
  [0.164,0.471,0.558],[0.128,0.567,0.551],[0.135,0.659,0.518],[0.267,0.749,0.441],
  [0.478,0.821,0.318],[0.741,0.873,0.150],[0.993,0.906,0.144]
];
function rampAt(arr, t) {
  const x = t * (arr.length - 1), i = Math.floor(x), f = x - i;
  const c0 = arr[i], c1 = arr[Math.min(i + 1, arr.length - 1)];
  return [c0[0]+(c1[0]-c0[0])*f, c0[1]+(c1[1]-c0[1])*f, c0[2]+(c1[2]-c0[2])*f];
}

// ----------------------------------------------------------------------------
//  SCENE
// ----------------------------------------------------------------------------
const sceneEl = document.getElementById('orb-layer');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));   // heat: cap DPR
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
sceneEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
const CAM_FAR = 9;
// Landing framing: ease the orb back on narrow windows so it clears the 380px
// right panel instead of sliding under it. Above ~1700px wide it's untouched
// (your full-screen Mac); below that it pulls back gradually, capped so it never
// shrinks to a dot. ORB_R is padded past the true 1.5 radius to cover the sphere's
// silhouette projecting larger than its centre plane, plus the bloom glow.
// z needed = ORB_R * H / ((2A - W) * tan(22.5°)), A = viewport width minus panel.
const PANEL_W = 380, ORB_R = 1.9, Z_CAP = 8.0;
function camNear() {
  const w = window.innerWidth, h = window.innerHeight;
  if (w <= 720) return w < 600 ? 7.2 : 5.2; // panel docks to bottom — no side clip
  const denom = (2 * (w - PANEL_W) - w) * 0.4142; // 0.4142 = tan(22.5°), FOV half-angle
  if (denom <= 0) return Z_CAP;
  return Math.min(Z_CAP, Math.max(5.2, ORB_R * h / denom));
}
// body resting framing (also the anchor the closer sinks away from)
function bodyZ()    { return (window.innerWidth / window.innerHeight) < 0.85 ? 7.8 : 6.2; }
function bodyLift() { return (window.innerWidth / window.innerHeight) < 0.85 ? 0.15 : 0.25; }
const CLOSER_SINK = 0.9;   // ending: how far the orb drops (camera looks up). ↑ = lower on screen
const CLOSER_ZOOM = 3.1;    // ending: how much the orb shrinks (camera pulls back). ↑ = smaller
camera.position.set(0, 0, CAM_FAR);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const key = new THREE.PointLight(0xfff0e0, 26, 0, 2); key.position.set(5, 3, 6);
const rim = new THREE.PointLight(0x8a6bff, 18, 0, 2); rim.position.set(-6, -2, -3);
const amb = new THREE.AmbientLight(0x3a3a52, 1.0);
scene.add(key, rim, amb);

// real left-hemisphere cortical surface: sphere + inflated, shared faces (1:1).
const brain = await fetch('./brain-export/brain.json').then(r => r.json());
const SPH_R = 1.5;
const bFaces = brain.faces, bSph = brain.sphere, bInf = brain.inflated;
const faceCount = bFaces.length / 3;
const spherePos = new Float32Array(faceCount * 9);     // non-indexed flat expansion
const inflatedPos = new Float32Array(faceCount * 9);
for (let f = 0; f < faceCount; f++) {
  for (let v = 0; v < 3; v++) {
    const vi = bFaces[f * 3 + v], o = (f * 3 + v) * 3;
    spherePos[o]   = bSph[vi*3]   * SPH_R; spherePos[o+1] = bSph[vi*3+1] * SPH_R; spherePos[o+2] = bSph[vi*3+2] * SPH_R;
    inflatedPos[o] = bInf[vi*3];           inflatedPos[o+1] = bInf[vi*3+1];       inflatedPos[o+2] = bInf[vi*3+2];
  }
}
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(spherePos.slice(), 3));
const geoPos = geo.attributes.position;
const colors = new Float32Array(faceCount * 9);

// synthetic map value per face, sampled from the field at the face's sphere direction
const faceT = new Float64Array(faceCount);
let vMin = Infinity, vMax = -Infinity;
const _c = new THREE.Vector3();
for (let f = 0; f < faceCount; f++) {
  const o = f * 9;
  _c.set((spherePos[o]+spherePos[o+3]+spherePos[o+6])/3,
         (spherePos[o+1]+spherePos[o+4]+spherePos[o+7])/3,
         (spherePos[o+2]+spherePos[o+5]+spherePos[o+8])/3).normalize();
  const val = fieldB(_c); faceT[f] = val;
  if (val < vMin) vMin = val; if (val > vMax) vMax = val;
}
for (let f = 0; f < faceCount; f++) faceT[f] = (faceT[f] - vMin) / (vMax - vMin || 1);

const permT = faceT.slice();                  // shuffled value→face mapping → "static"
function reshuffle() { for (let i = permT.length - 1; i > 0; i--) { const j = (Math.random()*(i+1))|0; const t = permT[i]; permT[i] = permT[j]; permT[j] = t; } }
let activeT = faceT;                           // which mapping paint() reads (faceT or permT)
const _col = new THREE.Color();
function paint(morph) {                       // 0 = mako, 1 = viridis
  for (let f = 0; f < faceCount; f++) {
    const t = activeT[f], m = rampAt(MAKO, t), v = rampAt(VIRIDIS, t);
    _col.setRGB(m[0]+(v[0]-m[0])*morph, m[1]+(v[1]-m[1])*morph, m[2]+(v[2]-m[2])*morph).convertSRGBToLinear();
    for (let k = 0; k < 3; k++) { const o = (f * 3 + k) * 3; colors[o]=_col.r; colors[o+1]=_col.g; colors[o+2]=_col.b; }
  }
  geo.attributes.color.needsUpdate = true;
}
geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
geo.computeVertexNormals();
paint(0);

// sphere ⇄ cortex morph. cortexAmt: 0 = sphere, 1 = cortical surface.
// (avoiding "inflate" on purpose — it's ambiguous: the sphere is arguably the
//  more-inflated form, even though FreeSurfer names the brain surface "inflated".)
let cortexAmt = 0, cortexTarget = 0;
function setCortex(t) {
  const arr = geoPos.array;
  for (let i = 0; i < arr.length; i++) arr[i] = spherePos[i] + (inflatedPos[i] - spherePos[i]) * t;
  geoPos.needsUpdate = true;
}

const material = new THREE.MeshPhysicalMaterial({
  vertexColors: true, flatShading: true,
  transmission: 0.85, thickness: 1.5, ior: 1.45, roughness: 0.4, metalness: 0.0,
  iridescence: 0.15, iridescenceIOR: 1.6, clearcoat: 0.6, clearcoatRoughness: 0.25,
  specularIntensity: 1.0, attenuationColor: new THREE.Color(0x8a6bff), attenuationDistance: 3.4,
  envMapIntensity: 1.4
});
const orb = new THREE.Mesh(geo, material);
scene.add(orb);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.8, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

let needsRender = true;                        // render-on-demand flag
let morphP = -1;
function resize() {
  const w = sceneEl.clientWidth, h = sceneEl.clientHeight;
  renderer.setSize(w, h); composer.setSize(w, h); bloom.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));  // half-res bloom: cheap, still soft
  camera.aspect = w / h; camera.updateProjectionMatrix();
  needsRender = true; morphP = -1;             // force re-frame (handles device rotation)
}
window.addEventListener('resize', resize); resize();

// ----------------------------------------------------------------------------
//  HISTOGRAM (D3)
// ----------------------------------------------------------------------------
const observedR = correlationAt(new THREE.Quaternion());
document.getElementById('obsR').textContent = observedR.toFixed(2);
const HW = 320, HH = 220, hm = { t: 26, r: 8, b: 24, l: 8 };
const svg = d3.select('#hist').attr('viewBox', `0 0 ${HW} ${HH}`);
const x = d3.scaleLinear().domain([-1, 1]).range([hm.l, HW - hm.r]);
const y = d3.scaleLinear().range([HH - hm.b, hm.t]);
const binner = d3.bin().domain([-1, 1]).thresholds(x.ticks(40));
const barsG = svg.append('g');
svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${HH - hm.b})`)
   .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format('+.1f')));
svg.append('text').attr('class', 'lbl-null').attr('x', hm.l + 2).attr('y', hm.t - 14).text('1000 random spins');
const obsLine = svg.append('line').attr('class', 'obs-line')
   .attr('x1', x(observedR)).attr('x2', x(observedR)).attr('y1', hm.t).attr('y2', HH - hm.b);
svg.append('text').attr('class', 'lbl-obs').attr('text-anchor', 'middle')
   .attr('x', x(observedR)).attr('y', hm.t - 4).text('observed');
const nulls = [];
function drawHist() {
  const bins = binner(nulls);
  y.domain([0, d3.max(bins, d => d.length) || 1]);
  barsG.selectAll('rect').data(bins).join('rect').attr('class', 'bar')
    .attr('x', d => x(d.x0) + 0.5).attr('width', d => Math.max(0, x(d.x1) - x(d.x0) - 1))
    .attr('y', d => y(d.length)).attr('height', d => (HH - hm.b) - y(d.length));
  obsLine.raise();
  const exceed = nulls.filter(v => Math.abs(v) >= Math.abs(observedR)).length;
  document.getElementById('pVal').textContent = (exceed / nulls.length).toFixed(3);
  document.getElementById('nSpin').textContent = nulls.length;
}

// ----------------------------------------------------------------------------
//  STATE MACHINE: deep → approaching → settled → running → done
// ----------------------------------------------------------------------------
let state = 'deep';
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const hintEl = document.getElementById('hint');
const descendEl = document.getElementById('descend');
const floatR = document.getElementById('floatR');
const floatB = floatR.querySelector('b');
const panel = document.getElementById('panel');
const idleAxis = new THREE.Vector3(0.25, 1, 0.08).normalize();
let dragging = false, frameTick = 0;

function setHint(t) { hintEl.textContent = t; hintEl.classList.toggle('hidden', !t); }
function setCursor(cls) { sceneEl.classList.remove('pokeable','grabbable','grabbing'); if (cls) sceneEl.classList.add(cls); }

let approach = null;
function startApproach() {
  setCursor(null); setHint('');
  if (prefersReduced) { camera.position.z = camNear(); camera.lookAt(0,0,0); settle(); return; }
  state = 'approaching';
  approach = { start: performance.now(), from: camera.position.z, dur: 1400 };
}
function settle() {
  state = 'settled'; setCursor('grabbable');
  setHint('poke me to start'); floatR.classList.add('show'); needsRender = true;
}

const MAX_SPINS = 1000, SAVOR = 42;
const fromQ = new THREE.Quaternion();
let toQ = new THREE.Quaternion();
let slerpT = 1, dwell = 0, fast = false, luckHintShown = false;
function cadence() { return fast ? { step: 0.16, dwell: 0 } : { step: 0.05, dwell: 5 }; }
function nextJump() { fromQ.copy(orb.quaternion); toQ = randomQuaternion(); slerpT = 0; }
function startRun() { state = 'running'; setCursor('grabbable'); setHint('1000 random spins'); panel.classList.add('show'); nextJump(); }
const verdictEl = document.getElementById('verdict');
function finishRun() {
  state = 'done'; setHint(''); descendEl.classList.add('show');
  const pv = nulls.filter(v => Math.abs(v) >= Math.abs(observedR)).length / nulls.length;
  const read = pv > 0.1
      ? 'Orange landed deep in the crowd. A match this size is just the brain being smooth — not a real link.'
      : pv < 0.02
      ? "Orange broke from the crowd. Smoothness alone can't fake this one — something's actually there."
      : 'Orange sits at the edge of the crowd. Borderline — smoothness explains most of it.';
  verdictEl.innerHTML = read + ' <span class="method"><a href="https://doi.org/10.1016/j.neuroimage.2018.05.070" target="_blank" rel="noopener">Alexander-Bloch et al., 2018</a>: a null that keeps the smoothness and breaks the alignment, so the match has something honest to beat.</span>';
  verdictEl.classList.add('show');
}
function ease(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }
function addSamples(n) {                       // blitz fill (orb decoupled, whirring)
  for (let k = 0; k < n && nulls.length < MAX_SPINS; k++) nulls.push(correlationAt(randomQuaternion()));
  floatB.textContent = nulls[nulls.length - 1].toFixed(2);
  drawHist();
  if (!luckHintShown && nulls.length >= 60) { setHint('how often does it match by luck?'); luckHintShown = true; }
  if (nulls.length >= MAX_SPINS) finishRun();
}

// ----------------------------------------------------------------------------
//  MORPH — scroll drives frosted/dark/mako → clear/light/viridis
// ----------------------------------------------------------------------------
const bkDark = document.getElementById('bk-dark');
const bkLight = document.getElementById('bk-light');
const ui = document.getElementById('ui');
const arrival = document.getElementById('arrival');
const lerp = (a, b, t) => a + (b - a) * t;
function applyMorph(p) {
  if (Math.abs(p - morphP) < 0.002) return;
  morphP = p; needsRender = true;
  if (p > 0.01 && (state === 'deep' || state === 'approaching')) {   // scroll skips ceremony
    camera.position.z = camNear(); camera.lookAt(0, 0, 0); settle();
  }
  if (state !== 'deep' && state !== 'approaching') {                 // body framing: pull back, slight lift
    camera.position.z = lerp(camNear(), bodyZ(), p);
    camera.lookAt(0, -bodyLift() * p, 0);
  }
  bkDark.style.opacity = 1 - p;
  bkLight.style.opacity = p;
  material.transmission = lerp(0.85, 0.05, p);
  material.roughness    = lerp(0.40, 0.55, p);
  material.iridescence  = lerp(0.15, 0.0, p);
  material.clearcoat    = lerp(0.60, 0.15, p);
  material.envMapIntensity = lerp(1.4, 1.05, p);
  bloom.strength = lerp(0.35, 0.0, p);
  bloom.enabled = p < 0.5;                       // perf: skip the whole bloom pass in the light body (strength≈0 there anyway)
  renderer.toneMappingExposure = lerp(1.1, 1.0, p);
  amb.intensity = lerp(1.0, 1.7, p);
  paint(p);
  ui.style.opacity = (1 - p).toFixed(3);
  ui.style.visibility = p > 0.92 ? 'hidden' : 'visible';
  
  arrival.classList.toggle('show', p >= 0.55 && !bodyRevealed);

  if (panel.classList.contains('show')) {              // panel leaves early + slides, not a slow dim
    if (p > 0.04) {
      const pf = Math.min(1, p / 0.45);                // fully gone by ~45% down
      panel.style.transition = 'none';
      panel.style.opacity = (1 - pf).toFixed(3);
      panel.style.transform = `translateX(${(pf * 60).toFixed(1)}px)`;
    } else { panel.style.transition = ''; panel.style.opacity = ''; panel.style.transform = ''; }
  }
}

// ----------------------------------------------------------------------------
//  THE TOY — real · shuffle · spin (gated on the poke-reveal in the body)
// ----------------------------------------------------------------------------
const toy = document.getElementById('toy');
const toymsg = document.getElementById('toymsg');
const introEl = document.getElementById('intro');
const toggleBtns = [...document.querySelectorAll('#toggles button')];
let bodyRevealed = false, bodyMode = 'real', spinTried = false;
const MODE_MSG = {
  real:    "i'm a brain map. neighbours match — but that's just me being smooth, not meaning.",
  shuffle: "shuffle me and i'm static — no brain looks like this. a fake this dumb proves nothing.",
  spin:    "blow me back into a ball and spin me — still me, just turned. now see if we still line up. that's a fake worth beating."
};
function setMode(m) {
  bodyMode = m;
  if (m === 'spin') spinTried = true;
  tabsTried.add(m); bodyActivity();                   // track exploration + reset the idle hint
  toggleBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  toymsg.textContent = MODE_MSG[m];
    if (m === 'spin') {
    cortexTarget = 0;
    activeT = faceT;
    paint(morphP);
  } else {
    cortexTarget = 1;
    activeT = (m === 'shuffle') ? (reshuffle(), permT) : faceT;
    paint(morphP);
  }
  needsRender = true;
}

// the brain's monologue: poked one line at a time, then it cedes the floor to the toy.
const INTRO_LINES = [
  "i'm a brain map.",
  "people wanna know if i line up with another map of me — where the myelin is, how thick i am, that kind of thing.",
  "fair. catch: i'm smooth, so even nonsense lines up a little.",
];
let introStep = 0, introSeen = false;
function advanceIntro() {
  if (introStep >= INTRO_LINES.length) { handoff(); return; }   // all lines read → next poke hands off
  [...introEl.children].forEach(el => { el.classList.remove('in'); el.classList.add('past'); });
  const line = document.createElement('div');
  line.className = 'intro-line';
  line.textContent = INTRO_LINES[introStep++];
  introEl.appendChild(line);
  requestAnimationFrame(() => line.classList.add('in'));
  needsRender = true;
}
function handoff() {
  introSeen = true; endingUnlocked = true;            // body earned → descent to the ending opens
  introEl.classList.add('gone');
  setTimeout(() => { introEl.innerHTML = ''; introEl.classList.remove('gone'); introStep = 0; }, 600);
  toy.classList.add('show'); setMode('real');         // voice continues in the toggle copy
}
function resetIntro() {
  introEl.innerHTML = ''; introEl.classList.remove('gone'); introStep = 0;
}
function revealBody() {
  bodyRevealed = true;
  arrival.classList.remove('show');
  cortexTarget = 1; activeT = faceT; paint(morphP); needsRender = true;   // poke → it becomes the cortex
  if (introSeen) { endingUnlocked = true; toy.classList.add('show'); setMode('real'); }   // repeat visit: skip the monologue
  else advanceIntro();                                                    // first time: the brain starts talking
}
function hideToy() {
  bodyRevealed = false; bodyMode = 'real';
  endingUnlocked = false;                                                     // re-gate: body is a stable stop on every descent
  arrival.classList.remove('show');
  toy.classList.remove('show'); resetIntro();
  extraPoke = 0; clearTimeout(quipTimer); quipEl.classList.remove('show');   // reset the easter egg
  clearTimeout(bodyIdleTimer); bodydown.classList.remove('show');            // and the down-hint
  activeT = faceT; paint(morphP);
}
toggleBtns.forEach(b => b.addEventListener('click', e => { e.stopPropagation(); setMode(b.dataset.mode); }));

// The closer lives in the otherwise-dead second viewport of scroll. As you descend
// into it the orb recedes and the toy leaves, so the bare thesis owns the screen.
// Stays locked until the spin's been tried — no conclusion until you've seen it done.
const closer = document.getElementById('closer');
const colophon = document.getElementById('colophon');
let lastCloserP = 0;
function updateCloser(sy) {
  const h = window.innerHeight;
  const cp = Math.min(1, Math.max(0, (sy - h) / (h * 0.55)));      // everyone gets the ending, spin or not
  if (cp === 0 && lastCloserP === 0) return;                       // idle on the landing/upper body — nothing to do
  lastCloserP = cp;
  closer.style.opacity = cp.toFixed(3);
  toy.style.opacity = cp > 0 ? (1 - cp).toFixed(3) : '';
  if (cp > 0) {                                                    // orb sinks + shrinks (no fade) so the thesis up top reads deliberate
    const e = cp * cp * (3 - 2 * cp);            // smoothstep
    camera.position.z = bodyZ() + CLOSER_ZOOM * e;
    camera.lookAt(0, lerp(-bodyLift(), CLOSER_SINK, e), 0);
    needsRender = true;
  } else {                                                        // leaving the closer → restore body framing once
    camera.position.z = bodyZ(); camera.lookAt(0, -bodyLift(), 0); needsRender = true;
  }
  const sigP = Math.min(1, Math.max(0, (sy - h * 1.35) / (h * 0.45)));   // colophon trails in at the very bottom
  colophon.style.opacity = sigP.toFixed(3);
  colophon.style.pointerEvents = sigP > 0.5 ? 'auto' : 'none';
}

// poke the orb after the toy's up (and you're not in the closer) and it gets mouthy.
// a couple of freebie pokes first, then it works through a small bank and bows out —
// so casual taps stay quiet and only persistent pokers find it.
const quipEl = document.getElementById('quip');
const QUIPS = [
  "still here?",
  "you again. fine.",
  "this is the third time. i’m keeping count. i’m a brain, counting’s free.",
  "i’m not a fidget toy.",
  "poke me again and i'm billing your PI.",
  "this is objectification with extra steps.",
  "Alexander-Bloch never poked me this much.",
  "okay now YOU'RE the one p-hacking.",
  "we’re done here. go pet a dog.",
];
const GOODBYE = "go pet a dog.";
// the descent to the ending stays locked until the body's been earned (monologue done,
// toggles up). then a shy down-arrow surfaces once all three tabs are tried and the user
// idles ~2s — so the scrollbar isn't the only clue there's more below.
const bodydown = document.getElementById('bodydown');
const tabsTried = new Set();
let endingUnlocked = false, bodyIdleTimer = null;
function maybeShowDown() {
  if (endingUnlocked && tabsTried.size === 3 && morphP >= 0.5 && lastCloserP < 0.05)
    bodydown.classList.add('show');
}
function bodyActivity() {                              // any poke/tab/scroll hides the hint and re-arms it
  bodydown.classList.remove('show');
  clearTimeout(bodyIdleTimer);
  bodyIdleTimer = setTimeout(maybeShowDown, 2000);
}

let extraPoke = 0, quipTimer = null;
function showQuip(text, ms = 3400) {
  quipEl.textContent = text;
  quipEl.classList.add('show');
  clearTimeout(quipTimer);
  quipTimer = setTimeout(() => quipEl.classList.remove('show'), ms);
}
function pokeQuip() {
  const i = extraPoke++ - 2;            // 2 freebie pokes, then the bank
  if (i < 0) return;
  if (i < QUIPS.length) showQuip(QUIPS[i]);          // the escalating bank
  else if (i < QUIPS.length + 3) showQuip(GOODBYE);  // then it says goodbye three times
  // after that, poking does nothing — it's done with you
}

// drag-spin it hard for a couple of seconds and it gets queasy, then rights itself.
const wobbleAxis = new THREE.Vector3(1, 0, 0.35).normalize();
const SICK = [                                   // add your own lines here, picked at random
  "ok. ok. i'm gonna be sick.",
  "whoa — okay, that's plenty.",
  "i can see the back of my own head.",
];
let dragAccum = 0, lastDragT = 0, nausea = false, nauseaStart = 0;
function startNausea() {
  nausea = true; nauseaStart = performance.now(); dragAccum = 0;
  showQuip(SICK[(Math.random() * SICK.length) | 0], 2600);
}

// ----------------------------------------------------------------------------
//  LOOP — render-on-demand, 30fps idle / 60fps active, pause when hidden
// ----------------------------------------------------------------------------
let visible = !document.hidden, modalOpen = false;
document.addEventListener('visibilitychange', () => { visible = !document.hidden; lastT = performance.now(); needsRender = true; });
let lastT = performance.now(), prevSY = -1;

function animate(now) {
  requestAnimationFrame(animate);
  if (!visible || modalOpen) return;     // modal open → freeze the orb so its live render
                                         // doesn't force the backdrop-blur to recompute (text-selection lag)

  const sy = window.scrollY;
  const scrolling = Math.abs(sy - prevSY) > 0.5; prevSY = sy;
  const hi = dragging || scrolling || state === 'approaching' || (state === 'running' && !prefersReduced);
  if (!hi && (now - lastT) < 42) return;       // ~24fps when idle, 60 when active (perf: idle orb spin is the heat)
  lastT = now;
  frameTick++;

  applyMorph(Math.min(1, Math.max(0, sy / window.innerHeight)));
  updateCloser(sy);
  const inBody = morphP >= 0.5;
  if (!inBody && (cortexTarget !== 0 || bodyRevealed)) {           // landing is always the bare sphere
    cortexTarget = 0; arrival.textContent = 'poke me again'; if (bodyRevealed) hideToy();
  }
  if (Math.abs(cortexAmt - cortexTarget) > 0.001) {
    cortexAmt += (cortexTarget - cortexAmt) * 0.08;
    if (Math.abs(cortexAmt - cortexTarget) <= 0.001) cortexAmt = cortexTarget;
    setCortex(cortexAmt); needsRender = true;
  }
  const a = frameTick * 0.0016;
  key.position.set(Math.cos(a) * 6, 3, Math.sin(a) * 6);
  const idle = prefersReduced ? 0 : 1;
  let living = false;

  if (state === 'approaching') {
    const t = Math.min(1, (performance.now() - approach.start) / approach.dur);
    camera.position.z = approach.from + (camNear() - approach.from) * ease(t);
    camera.lookAt(0, 0, 0); orb.rotateOnWorldAxis(idleAxis, 0.0022);
    if (t >= 1) settle(); living = true;
  } else if (state === 'running') {
    if (inBody) {
      // scrolled away mid-spin → freeze (no advance, no render); resumes on scroll-up
    } else if (prefersReduced) {
      if (frameTick % 2 === 0) addSamples(14);                  // no orb motion; SVG updates itself
    } else if (nulls.length < SAVOR) {                          // savour: coupled hypnotic glides
      const { step, dwell: dw } = cadence();
      if (slerpT < 1) { slerpT = Math.min(1, slerpT + step); orb.quaternion.slerpQuaternions(fromQ, toQ, ease(slerpT)); if (slerpT >= 1) dwell = dw; }
      else if (dwell > 0) { dwell--; }
      else { const r = correlationAt(orb.quaternion); nulls.push(r); floatB.textContent = r.toFixed(2); drawHist(); nextJump(); }
      living = true;
    } else {                                                    // blitz: whirr + fast fill to 1000
      orb.rotateOnWorldAxis(idleAxis, 0.03);                 // slower whirr
      addSamples(Math.min(10, 1 + Math.floor((nulls.length - SAVOR) / 30)));
      living = true;
    }
  } else if (!inBody) {                                         // landing idle (deep/settled/done) stays alive
    if (!dragging) orb.rotateOnWorldAxis(idleAxis, (state === 'done' ? 0.0016 : 0.0019) * idle);
    if (state !== 'deep' && frameTick % 6 === 0) floatB.textContent = correlationAt(orb.quaternion).toFixed(2);
    if (idle) living = true;
  }
  // in the body at rest: nothing renders until scroll/drag dirties it
  if (inBody && bodyRevealed && bodyMode === 'spin' && !dragging && !prefersReduced && lastCloserP < 0.05) {
    orb.rotateOnWorldAxis(idleAxis, 0.01); living = true;          // spin mode whirs on the sphere
  }
  // at the ending: whatever they landed on (sphere OR brain) turns slowly on its own, undraggable
  if (lastCloserP > 0.05 && !prefersReduced) {
    orb.rotateOnWorldAxis(idleAxis, 0.0035); living = true;
  }

  if (nausea) {                                       // queasy wobble that decays back to upright
    const dt = (performance.now() - nauseaStart) / 1000;
    if (dt >= 2.2) nausea = false;
    else { orb.rotateOnWorldAxis(wobbleAxis, Math.sin(dt * 22) * 0.05 * (1 - dt / 2.2)); living = true; }
  }
  if (dragging) living = true;
  if (living) needsRender = true;
  if (needsRender) { composer.render(); needsRender = false; }
}
requestAnimationFrame(animate);

// ----------------------------------------------------------------------------
//  POINTER — raycast-gated: only the orb is draggable/clickable.
//  Off-orb touches fall through to page scroll (mobile-safe).
// ----------------------------------------------------------------------------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downOnOrb = false, lastX = 0, lastY = 0, moveDist = 0;
function hitsOrb(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.intersectObject(orb, false).length > 0;
}
const canDrag = () => state === 'settled' || state === 'running' || state === 'done';

renderer.domElement.addEventListener('pointerdown', e => {
  if (!hitsOrb(e)) { downOnOrb = false; return; }   // let the page scroll
  downOnOrb = true; moveDist = 0; lastX = e.clientX; lastY = e.clientY;
  if (canDrag()) setCursor('grabbing');
});
renderer.domElement.addEventListener('pointermove', e => {
  if (downOnOrb) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY; moveDist += Math.hypot(dx, dy);
    if (canDrag() && lastCloserP < 0.35 && moveDist > 4) {    // no dragging once it's settling into the ending
      dragging = true;
      const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(dy * 0.006, dx * 0.006, 0, 'XYZ'));
      orb.quaternion.premultiply(dq);
      e.preventDefault();                            // stop touch-scroll while rotating the orb
      const nowT = performance.now();                // build up to motion sickness on sustained fast spinning
      if (nowT - lastDragT > 220) dragAccum = 0;     // a pause settles its stomach
      lastDragT = nowT; dragAccum += Math.hypot(dx, dy);
      if (dragAccum > 1200 && !nausea) startNausea();
    }
    return;
  }
  // hover: the hand cursor appears only over the orb
  if (e.pointerType === 'touch') return;
  if (hitsOrb(e)) setCursor(state === 'deep' ? 'pokeable' : canDrag() ? 'grabbable' : null);
  else setCursor(null);
}, { passive: false });
window.addEventListener('pointerup', () => {
  const wasClick = downOnOrb && moveDist < 5;
  if (wasClick) {
    if (morphP >= 0.5) {                                              // body: poke reveals, then drives the monologue
      if (!bodyRevealed) revealBody();
      else if (!toy.classList.contains('show')) advanceIntro();       // toggles take over once shown
      else if (lastCloserP < 0.05) pokeQuip();                        // toy's up & not in the closer → quips
      bodyActivity();                                                 // any body poke re-arms the down-hint
    }
    else if (state === 'deep') startApproach();
    else if (state === 'settled' && morphP < 0.4) startRun();         // spin belongs to the landing
    else if (state === 'running') fast = !fast;
  }
  downOnOrb = false; dragging = false;
  if (canDrag()) setCursor('grabbable');
});
window.addEventListener('scroll', () => {
  if (state === 'deep') { window.scrollTo(0, 0); return; }
  const h = window.innerHeight;
  if (!endingUnlocked && window.scrollY > h) { window.scrollTo(0, h); return; }   // hold at the body until earned
  bodyActivity();                                                                 // scrolling hides the down-hint
}, { passive: false });
// space shouldn't fling the landing out of its ceremony by accident; once in the
// body it scrolls normally again. buttons/inputs keep their keyboard activation.
window.addEventListener('keydown', e => {
  if (e.code !== 'Space' || morphP >= 0.5) return;
  const t = e.target;
  if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  e.preventDefault();
}, { passive: false });
// ----------------------------------------------------------------------------
//  DOOR
// ----------------------------------------------------------------------------
const modal = document.getElementById('modal');
function openModal()  { modalOpen = true;  modal.classList.add('show');  document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden'; }
function closeModal() { modalOpen = false; modal.classList.remove('show'); document.documentElement.style.overflow = ''; document.body.style.overflow = ''; lastT = performance.now(); needsRender = true; }
document.getElementById('door').addEventListener('click', e => { e.stopPropagation(); openModal(); });
document.getElementById('modalClose').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
