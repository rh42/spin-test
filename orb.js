// The WebGL stage: two cortical surfaces, the sphere⇄cortex morph, the spin, the drag.
//
//   · two orbs, colour encoding which map (mako = the narrator, viridis = its partner)
//   · one matte look throughout, no glass and no bloom; see below
//   · a full-viewport transparent canvas. The orbs are framed into a DOM `slot` by moving a
//     camera rig, so they follow the grid columns without the canvas ever moving
//   · an oblique REST pose with a slow yaw oscillation around it. Beats hold still, so the
//     narrator has to rest somewhere recognisable: anterior left, superior up, ~22° off
//     pure lateral for depth
//   · positions and camera distance tween. One object being rearranged, never a cut

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { evalField, NARRATOR, PARTNER } from './field.js';

// ── one look, always ────────────────────────────────────────────────────────────────
// No night mode, no glass, no bloom. Specular buries the colormap, which is the one channel
// telling the two maps apart, and with bloom gone the canvas is genuinely transparent, so
// the page shows through everywhere. Time of day is a pure CSS tint (index.html), nothing on
// this side. Matte has to go further here than it would for a single orb: specular that
// merely dulls one ramp destroys the distinction between two.
const LOOK = {
  // Exactly zero, not merely small: three.js renders a whole extra transmission pass for any
  // material with transmission > 0, so 0.02 would look identical and cost a scene render.
  transmission: 0.00, roughness: 0.62, iridescence: 0.00, clearcoat: 0.06,
  envMapIntensity: 0.85, specularIntensity: 0.35,
  // Lighting for a bright room. The ambient stays light and neutral: anything dark or blue
  // sends surfaces turned away from the key colder than the page, which reads as grubby.
  exposure: 1.00, ambient: 2.10, ambientColor: 0x9aa0ad, key: 9, rim: 4.5,
  // What a dimmed "held still" map fades toward. Near paper, so it recedes into the page
  // instead of becoming the darkest thing on screen.
  paper: [0.94, 0.945, 0.95],
};

// A sphere seen off the optical axis projects to an ellipse, elongated by 1/cos(theta). The
// rig puts the orbs off-centre to follow the columns, so a wide lens visibly squashes them:
// at 45° the split and figure plans are 5.5% and 8.8% out of round, which shows immediately
// on the beats where they are literally spheres. 26° takes those to 1.8% and 2.8%.
const FOV = 26;

const MAKO_FULL = [
  [0.04,0.02,0.05],[0.10,0.07,0.16],[0.16,0.12,0.28],[0.21,0.18,0.40],
  [0.23,0.26,0.50],[0.22,0.35,0.55],[0.20,0.44,0.57],[0.20,0.53,0.58],
  [0.24,0.62,0.57],[0.36,0.71,0.55],[0.55,0.80,0.58],[0.78,0.89,0.70],
];
const VIRIDIS_FULL = [
  [0.267,0.005,0.329],[0.283,0.141,0.458],[0.254,0.265,0.530],[0.207,0.372,0.553],
  [0.164,0.471,0.558],[0.128,0.567,0.551],[0.135,0.659,0.518],[0.267,0.749,0.441],
  [0.478,0.821,0.318],[0.741,0.873,0.150],[0.993,0.906,0.144],
];

function rampAt(arr, t) {
  const x = Math.max(0, Math.min(1, t)) * (arr.length - 1);
  const i = Math.floor(x), f = x - i;
  const c0 = arr[i], c1 = arr[Math.min(i + 1, arr.length - 1)];
  return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
}

// Both colormaps were designed to sit on black, and their bottom quarter is essentially black
// to prove it. On paper that is a hole, not a low value. Resampling from `lo` upward keeps
// each ramp's shape and ordering (what a scientific colormap is *for*) while lifting the
// floor off the page. Mako is also cut at the top, where it runs to a pale green: with both
// ramps ending bright and green, the only thing telling the orbs apart is which is on top.
function slice(arr, lo, hi, n = 12) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(rampAt(arr, lo + (i / (n - 1)) * (hi - lo)));
  return out;
}
const MAKO = slice(MAKO_FULL, 0.34, 0.84);
const VIRIDIS = slice(VIRIDIS_FULL, 0.26, 1.0);

// Angular radius of the probe's cap. Exported because the scatter has to brush exactly the
// dots this lights on the cortex — two constants that must agree is one constant.
export const PROBE_RADIUS = 0.44;

const SPH_R = 1.5;
const easeInOut = t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
const damp = (cur, goal, k) => cur + (goal - cur) * k;
// Damping rates are quoted for 60fps and converted against real elapsed time, so the motion
// lands identically at 30Hz, 144Hz or throttled. dt is capped so a long stall settles.
const rate = (r, dt) => 1 - Math.pow(1 - r, Math.min(dt, 0.25) * 60);

export async function createStage({ container, slot, basis, meshUrl = './brain-export/brain.json' }) {
  const brain = await fetch(meshUrl).then(r => r.json());
  const faces = brain.faces, bSph = brain.sphere, bInf = brain.inflated;
  const faceCount = faces.length / 3;

  // Non-indexed expansion: a distinct vertex per face corner, so flat shading reads as
  // real facets rather than a smoothed blob.
  const spherePos = new Float32Array(faceCount * 9);
  const inflatedPos = new Float32Array(faceCount * 9);
  for (let f = 0; f < faceCount; f++) {
    for (let v = 0; v < 3; v++) {
      const vi = faces[f * 3 + v], o = (f * 3 + v) * 3;
      spherePos[o] = bSph[vi*3] * SPH_R; spherePos[o+1] = bSph[vi*3+1] * SPH_R; spherePos[o+2] = bSph[vi*3+2] * SPH_R;
      inflatedPos[o] = bInf[vi*3]; inflatedPos[o+1] = bInf[vi*3+1]; inflatedPos[o+2] = bInf[vi*3+2];
    }
  }

  // Where each face sits on the sphere, as a unit direction, in the map's own frame: rest,
  // ambient and spin are mesh transforms and never touch it. That is what lets a raycast hit
  // become a direction the field code recognises.
  const faceDir = new Float32Array(faceCount * 3);
  for (let f = 0; f < faceCount; f++) {
    const o = f * 9;
    const x = (spherePos[o] + spherePos[o+3] + spherePos[o+6]) / 3;
    const y = (spherePos[o+1] + spherePos[o+4] + spherePos[o+7]) / 3;
    const z = (spherePos[o+2] + spherePos[o+5] + spherePos[o+8]) / 3;
    const n = Math.hypot(x, y, z) || 1;
    faceDir[f*3] = x / n; faceDir[f*3+1] = y / n; faceDir[f*3+2] = z / n;
  }

  // Per-face map values, sampled at the face's direction on the sphere, normalised to 0..1.
  function faceValues(coef) {
    const out = new Float64Array(faceCount);
    let lo = Infinity, hi = -Infinity;
    for (let f = 0; f < faceCount; f++) {
      const v = evalField(basis, coef, faceDir[f*3], faceDir[f*3+1], faceDir[f*3+2]);
      out[f] = v; if (v < lo) lo = v; if (v > hi) hi = v;
    }
    for (let f = 0; f < faceCount; f++) out[f] = (out[f] - lo) / (hi - lo || 1);
    return out;
  }
  const narratorT = faceValues(NARRATOR);
  const partnerT = faceValues(PARTNER);
  const shuffledT = narratorT.slice();

  // Genuinely transparent: nothing in the pipeline forces alpha to 1, so the page's tint
  // shows through the canvas everywhere.
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  // ACES crushes and desaturates shadows to hold HDR highlights, which a colormap cannot
  // afford when the shadow end is carrying map values. Nothing here is HDR anyway.
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = LOOK.exposure;
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // far has to clear the deepest the rig ever pulls back to. A slot squeezed to a hundred
  // pixels puts the camera past 100, and the orb is not small there, it is gone.
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.PointLight(0xfff0e0, LOOK.key, 0, 2); key.position.set(5, 3, 6);
  const rim = new THREE.PointLight(0x8a6bff, LOOK.rim, 0, 2); rim.position.set(-6, -2, -3);
  const amb = new THREE.AmbientLight(LOOK.ambientColor, LOOK.ambient);
  scene.add(amb);
  // key and rim go on the rig, not in the scene (see makeOrb): lights at fixed world positions
  // would rake across the orbs as the rig slides between plans, lighting a beat by its column.

  let dirty = true;
  let cortexAmt = 0, cortexTarget = 0;
  let paired = false, ambient = true;
  let spinAnim = null;
  // ?motion=off forces the same path as the OS setting, so the reduced-motion path is
  // something a reader can ask for and a developer can actually check.
  const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    || new URLSearchParams(location.search).get('motion') === 'off';

  function material() {
    return new THREE.MeshPhysicalMaterial({
      vertexColors: true, flatShading: true, transparent: true,
      transmission: LOOK.transmission, thickness: 1.5, ior: 1.45,
      roughness: LOOK.roughness, metalness: 0.0,
      iridescence: LOOK.iridescence, iridescenceIOR: 1.6,
      clearcoat: LOOK.clearcoat, clearcoatRoughness: 0.25,
      specularIntensity: LOOK.specularIntensity,
      attenuationColor: new THREE.Color(0x8a6bff), attenuationDistance: 3.4,
      envMapIntensity: LOOK.envMapIntensity,
    });
  }

  // Both orbs always show the same surface at the same morph position, so they share one
  // position and one normal attribute and recomputing normals happens once. Only colour is
  // per-orb.
  const posAttr = new THREE.BufferAttribute(spherePos.slice(), 3);
  const baseGeo = new THREE.BufferGeometry();
  baseGeo.setAttribute('position', posAttr);
  baseGeo.computeVertexNormals();
  const normAttr = baseGeo.attributes.normal;

  // Everything visible hangs off one rig, so framing the orbs into a column is a single
  // translation rather than per-orb bookkeeping.
  const rig = new THREE.Group();
  scene.add(rig);
  rig.add(key, rim);          // lighting travels with the orbs; see the note where they are made
  const rigPos = new THREE.Vector3(), rigGoal = new THREE.Vector3();

  function makeOrb(values, ramp) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', posAttr);
    geo.setAttribute('normal', normAttr);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(faceCount * 9), 3));
    const mesh = new THREE.Mesh(geo, material());
    rig.add(mesh);
    const orb = {
      mesh, geo, values, ramp, dim: 0,
      // the colours the map has when nothing is lit, so the probe can be lifted off again
      // without repainting eight thousand faces from the colormap every pointermove
      base: new Float32Array(faceCount * 9), hot: [],
      pos: new THREE.Vector3(), goal: new THREE.Vector3(),
    };
    paint(orb, values);
    return orb;
  }

  const _col = new THREE.Color();
  // `dim` lerps vertex colours toward the page instead of touching opacity, which does not
  // behave with transmission. Toward paper, not black: on a light page a map faded to black
  // is the most prominent thing on screen, which is the opposite of subordinate.
  function paint(orb, values, dim = orb.dim) {
    orb.dim = dim;
    const g = LOOK.paper;
    for (let f = 0; f < faceCount; f++) {
      const c = rampAt(orb.ramp, values[f]);
      _col.setRGB(
        c[0] + (g[0] - c[0]) * dim,
        c[1] + (g[1] - c[1]) * dim,
        c[2] + (g[2] - c[2]) * dim,
      ).convertSRGBToLinear();
      for (let k = 0; k < 3; k++) {
        const o = (f * 3 + k) * 3;
        orb.base[o] = _col.r; orb.base[o+1] = _col.g; orb.base[o+2] = _col.b;
      }
    }
    orb.geo.attributes.color.array.set(orb.base);
    orb.hot.length = 0;
    applyProbe(orb);
  }

  // ── the probe ─────────────────────────────────────────────────────────────────────
  // A patch of cortex lit under the pointer. A spotlight, not a decal: the colormap stays
  // visible underneath, because the patch has to read as part of *this map* for the brushed
  // dots in the scatter to mean anything. Warm, to match those dots.
  //
  // Only faces inside the cap are written and the previous cap is remembered, so a
  // pointermove costs a few hundred float writes instead of seventy-two thousand.
  const GLOW = new THREE.Color(1.0, 0.62, 0.30).convertSRGBToLinear();
  let probeDir = null;
  const probeCos = Math.cos(PROBE_RADIUS);

  function applyProbe(orb) {
    const arr = orb.geo.attributes.color.array;
    for (const f of orb.hot) { const o = f * 9; for (let i = 0; i < 9; i++) arr[o+i] = orb.base[o+i]; }
    orb.hot.length = 0;
    if (probeDir) {
      const [px, py, pz] = probeDir;
      for (let f = 0; f < faceCount; f++) {
        const d = faceDir[f*3] * px + faceDir[f*3+1] * py + faceDir[f*3+2] * pz;
        if (d < probeCos) continue;
        const t = (d - probeCos) / (1 - probeCos);
        const w = t * t * (3 - 2 * t) * 0.86;     // smoothstep, so the patch has no rim
        orb.hot.push(f);
        for (let k = 0; k < 3; k++) {
          const o = (f * 3 + k) * 3;
          arr[o]   = orb.base[o]   + (GLOW.r - orb.base[o])   * w;
          arr[o+1] = orb.base[o+1] + (GLOW.g - orb.base[o+1]) * w;
          arr[o+2] = orb.base[o+2] + (GLOW.b - orb.base[o+2]) * w;
        }
      }
    }
    orb.geo.attributes.color.needsUpdate = true;
    dirty = true;
  }

  function setProbe(dir) {
    probeDir = dir;
    applyProbe(narrator); applyProbe(partner);
  }

  const narrator = makeOrb(narratorT, MAKO);
  const partner = makeOrb(partnerT, VIRIDIS);
  let narratorShuffled = false;
  let guestScale = 0.0001, guestGoal = 0.0001;
  partner.mesh.scale.setScalar(guestScale);
  partner.mesh.visible = false;

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  composer.addPass(new OutputPass());

  function setCortex(t) {
    const arr = posAttr.array;
    for (let i = 0; i < arr.length; i++) arr[i] = spherePos[i] + (inflatedPos[i] - spherePos[i]) * t;
    posAttr.needsUpdate = true;
    baseGeo.computeVertexNormals();
    normAttr.needsUpdate = true;
    dirty = true;
  }

  // ── orientation ───────────────────────────────────────────────────────────────────
  // The mesh ships anterior-left / superior-up / lateral-to-camera (make_brain_json.py).
  // REST turns it ~22° off pure lateral for depth; AMBIENT sweeps slowly around that, so the
  // orb keeps moving without leaving a view a neuroimager would recognise.
  const UP = new THREE.Vector3(0, 1, 0);
  const restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, 0.38, 0, 'XYZ'));
  const AMBIENT_SWEEP = 0.24, AMBIENT_PERIOD = 17000;
  const ambientQ = new THREE.Quaternion();
  const spinQ = new THREE.Quaternion();
  const _q = new THREE.Quaternion(), _out = new THREE.Quaternion();
  let ambientPhase = 0;

  function applyOrientation() {
    _out.copy(ambientQ).multiply(restQ).multiply(spinQ);
    narrator.mesh.quaternion.copy(_out);
    _out.copy(ambientQ).multiply(restQ);          // the guest never receives the spin
    partner.mesh.quaternion.copy(_out);
    dirty = true;
  }

  function setSpin(q) { spinQ.set(q[0], q[1], q[2], q[3]); applyOrientation(); }

  // ── framing ───────────────────────────────────────────────────────────────────────
  const R = 1.62;                         // covers the sphere (1.5) and the inflated cortex (1.4)
  const TAN = Math.tan((FOV * Math.PI / 180) / 2);
  let camZ = 8, camZGoal = 8, firstLayout = true;
  // The canvas is fixed at inset 0, so its box is the viewport. Kept from the last layout so
  // that projecting a position costs no DOM read — narratorRect runs inside the frame loop.
  let vw = 0, vh = 0;

  // Whether the pair stacks is staged, not measured: the slot's aspect wanders as narration
  // reflows under it, and a rule reading the box rearranges the orbs mid-line. The beat's
  // declaration is a preference worth this factor in the fit comparison below — it wins
  // wherever both arrangements nearly fit, and loses where the slot cannot hold it.
  let arrangement = null;
  const PREFERENCE = 1.3;

  // How much air to leave around the framed radius, when something other than a beat is posing
  // the stage. null means the defaults below, which every beat uses.
  let frameMargin = null;

  // Under reduced motion there are no frames to tween in, so every beat has to arrive
  // already finished rather than drifting toward its goal.
  function settleNow() {
    narrator.pos.copy(narrator.goal); narrator.mesh.position.copy(narrator.pos);
    partner.pos.copy(partner.goal); partner.mesh.position.copy(partner.pos);
    guestScale = guestGoal; partner.mesh.scale.setScalar(guestScale);
    partner.mesh.visible = guestScale > 0.01;
    camZ = camZGoal; camera.position.set(0, 0, camZ); camera.lookAt(0, 0, 0);
    rigPos.copy(rigGoal); rig.position.copy(rigPos);
    dirty = true;
  }

  function layout() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    vw = w; vh = h;
    renderer.setSize(w, h); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();

    // The slot is the region of the *page* the orbs should occupy — a grid cell, so it
    // moves when the beat changes its plan. The canvas itself never moves.
    const cr = container.getBoundingClientRect();
    const sr = (slot || container).getBoundingClientRect();
    const fw = Math.max(0.05, sr.width / w), fh = Math.max(0.05, sr.height / h);

    // How far back the camera has to sit to frame a box of this half-size inside the slot.
    // Comparing the two arrangements through it asks the only question that matters — which
    // one leaves the orbs bigger — in the same maths that then does the framing.
    const fit = (hx, hy) => Math.max(hy / (TAN * fh), hx / (TAN * camera.aspect * fw));
    const STACK_OFF = R * 1.12, ROW_OFF = R * 1.3;

    let halfX = R, halfY = R;
    if (!paired) {
      narrator.goal.set(0, 0, 0);
      partner.goal.set(0, 0, 0);
    } else {
      // Stack, never tile. Below 900px the work column lays itself under the stage, leaving
      // a wide short band where stacking costs more than double the camera distance — that
      // is the case no beat may declare its way into.
      const bias = arrangement === 'stacked' ? PREFERENCE
        : arrangement === 'side' ? 1 / PREFERENCE : 1;
      if (fit(R, STACK_OFF + R) < fit(ROW_OFF + R, R) * bias) {
        narrator.goal.set(0, STACK_OFF, 0);
        partner.goal.set(0, -STACK_OFF, 0);
        halfY = STACK_OFF + R;
      } else {
        narrator.goal.set(-ROW_OFF, 0, 0);
        partner.goal.set(ROW_OFF, 0, 0);
        halfX = ROW_OFF + R;
      }
    }
    // The lone narrator gets much more air than the pair: beats 0/1/9 are the cinematic
    // ones and a single orb crowding its frame is what makes a page look like a widget.
    const margin = frameMargin ?? (paired ? 1.16 : 1.44);
    camZGoal = Math.max(halfY / (TAN * fh), halfX / (TAN * camera.aspect * fw)) * margin;

    // Put the rig where the slot is. A lateral offset at fixed depth does not change
    // projected size, so this only ever moves the orbs, never rescales them.
    const cx = (sr.left + sr.width / 2 - cr.left) / w * 2 - 1;
    const cy = -(((sr.top + sr.height / 2 - cr.top) / h) * 2 - 1);
    const halfWorldY = camZGoal * TAN, halfWorldX = halfWorldY * camera.aspect;
    rigGoal.set(cx * halfWorldX, cy * halfWorldY, 0);

    if (firstLayout) { firstLayout = false; settleNow(); }
    else if (prefersReduced) settleNow();
    dirty = true;
  }

  // The slot's box changes whenever the beat changes its plan or the surrounding layout
  // reflows — text wrapping, a chart appearing — and none of that fires a window resize.
  new ResizeObserver(layout).observe(container);
  if (slot) new ResizeObserver(layout).observe(slot);
  addEventListener('resize', layout);

  // The narrator's bounding sphere, projected to viewport pixels. The camera looks down -Z
  // from (0,0,camZ) unrotated, so this is the same pair of divisions layout() frames with.
  // Live values, not goals: a caller anchoring to it follows the glide instead of jumping to
  // where the orb will end up.
  function narratorRect() {
    if (!vw || !vh) return null;
    const halfY = TAN * camZ, halfX = halfY * camera.aspect;
    return {
      cx: ((rigPos.x + narrator.pos.x) / halfX * 0.5 + 0.5) * vw,
      cy: (-(rigPos.y + narrator.pos.y) / halfY * 0.5 + 0.5) * vh,
      // SPH_R, not R: R carries framing margin, and hanging a line off that puts a gap under
      // the orb that nothing on screen accounts for. The cortex does not fill its sphere
      // either, so some air is left over on the beats where it is not a ball.
      radius: (SPH_R / halfY) * (vh / 2),
    };
  }

  // ── drag ──────────────────────────────────────────────────────────────────────────
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = false, lastX = 0, lastY = 0, moved = 0, dragEnabled = false, probeEnabled = false;
  const pokeCbs = [], dragCbs = [], probeCbs = [], frameCbs = [];
  function cast(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const targets = [narrator.mesh].concat(partner.mesh.visible ? [partner.mesh] : []);
    return ray.intersectObjects(targets, false)[0] || null;
  }
  // A hit's faceIndex reads back through faceDir into the map's own frame, the frame the field
  // is sampled in. True only while the narrator is unspun, and probing only happens there. Off
  // the surface the probe holds its last patch, so crossing between orbs doesn't strobe.
  renderer.domElement.addEventListener('pointermove', e => {
    // `down && dragEnabled`, not just `down`: on a touch screen pointermove only fires with a
    // finger down, so bailing on `down` alone hides the probe from every device without hover.
    if (down && dragEnabled) return;
    if (!probeEnabled && !dragEnabled) return;
    const hit = cast(e);
    // The canvas is the whole viewport, so a cursor set on it is a cursor over the entire
    // page. It has to follow the surface, not the mode: `cast` is the same test pointerdown
    // uses, so the hand appears exactly where a press would actually take hold.
    if (dragEnabled) container.classList.toggle('grabbable', !!hit);
    if (!probeEnabled) return;
    container.classList.toggle('probing', !!hit);
    if (!hit) return;
    const f = hit.faceIndex;
    const dir = [faceDir[f*3], faceDir[f*3+1], faceDir[f*3+2]];
    setProbe(dir);
    probeCbs.forEach(cb => cb(dir));
  });
  renderer.domElement.addEventListener('pointerdown', e => {
    if (!cast(e)) { down = false; return; }
    down = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
    if (dragEnabled) container.classList.add('grabbing');
  });
  renderer.domElement.addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY; moved += Math.hypot(dx, dy);
    if (dragEnabled && moved > 4) {
      _q.setFromEuler(new THREE.Euler(dy * 0.006, dx * 0.006, 0, 'XYZ'));
      spinQ.premultiply(_q);
      applyOrientation();
      dragCbs.forEach(cb => cb([spinQ.x, spinQ.y, spinQ.z, spinQ.w]));
      e.preventDefault();
    }
  }, { passive: false });
  addEventListener('pointerup', () => {
    if (down && moved < 5) pokeCbs.forEach(cb => cb());
    down = false; container.classList.remove('grabbing');
  });

  // ── frame loop ────────────────────────────────────────────────────────────────────
  let tick = 0, lastNow = performance.now();
  (function loop(now) {
    requestAnimationFrame(loop);
    tick++;
    const dt = Math.max(0, (now - lastNow) / 1000); lastNow = now;
    const k = r => (prefersReduced ? 1 : rate(r, dt));

    if (Math.abs(cortexAmt - cortexTarget) > 0.001) {
      cortexAmt = damp(cortexAmt, cortexTarget, k(0.08));
      if (Math.abs(cortexAmt - cortexTarget) <= 0.001) cortexAmt = cortexTarget;
      setCortex(cortexAmt);
    }

    // the rig glides between slots, so changing plan reads as the camera panning across
    // one scene rather than as a cut to a new slide
    if (rigPos.distanceToSquared(rigGoal) > 1e-6) {
      rigPos.lerp(rigGoal, k(0.10));
      rig.position.copy(rigPos);
      dirty = true;
    }

    // positions and distance tween, so a beat change reads as the same object moving
    for (const orb of [narrator, partner]) {
      if (orb.pos.distanceToSquared(orb.goal) > 1e-6) {
        orb.pos.lerp(orb.goal, k(0.11));
        orb.mesh.position.copy(orb.pos);
        dirty = true;
      }
    }
    if (Math.abs(guestScale - guestGoal) > 1e-4) {
      guestScale = damp(guestScale, guestGoal, k(0.12));
      partner.mesh.scale.setScalar(guestScale);
      partner.mesh.visible = guestScale > 0.01;
      dirty = true;
    }
    if (Math.abs(camZ - camZGoal) > 1e-3) {
      camZ = damp(camZ, camZGoal, k(0.09));
      dirty = true;
    }
    camera.position.set(0, 0, camZ);
    camera.lookAt(0, 0, 0);

    if (spinAnim) {
      const t = Math.min(1, (now - spinAnim.t0) / spinAnim.dur);
      setSpin(spinAnim.at(easeInOut(t)));
      if (t >= 1) { spinAnim.done && spinAnim.done(); spinAnim = null; }
    }
    if (ambient && !down && !prefersReduced) {
      ambientPhase = (now % AMBIENT_PERIOD) / AMBIENT_PERIOD;
      ambientQ.setFromAxisAngle(UP, Math.sin(ambientPhase * Math.PI * 2) * AMBIENT_SWEEP);
      applyOrientation();
    }

    key.position.set(Math.cos(tick * 0.0016) * 6, 3, Math.sin(tick * 0.0016) * 6);
    // Anchored page elements move on the frames the orbs do, which is what `dirty` already
    // marks. Before the render, so a subscriber's DOM write lands in the same paint.
    if (dirty) {
      frameCbs.forEach(cb => cb());
      composer.render();
      dirty = false;
    }
  })(performance.now());

  layout();
  applyOrientation();

  // Where the camera is, in the narrator's own frame. The probe's demo path is built from it
  // so the sweep runs across whatever face is turned toward the reader.
  const _front = new THREE.Vector3(), _inv = new THREE.Quaternion();
  function frontLocal() {
    _inv.copy(narrator.mesh.quaternion).invert();
    return _front.set(0, 0, 1).applyQuaternion(_inv).clone();
  }

  return {
    faceCount,
    layout,
    onPoke: cb => pokeCbs.push(cb),
    onDrag: cb => dragCbs.push(cb),
    onProbe: cb => probeCbs.push(cb),
    onFrame: cb => frameCbs.push(cb),
    narratorRect,
    setProbe,
    setProbeEnabled(on) {
      probeEnabled = on;
      if (!on) { container.classList.remove('probing'); setProbe(null); }
    },
    // A closed loop of probe directions across the visible face, snapshotted at call time
    // so the slow ambient yaw cannot drag the path around underneath the sweep.
    probeLoop(radius = 0.66) {
      const f = frontLocal();
      const a = Math.abs(f.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const u = new THREE.Vector3().crossVectors(f, a).normalize();
      const v = new THREE.Vector3().crossVectors(f, u).normalize();
      const cf = Math.cos(radius), sf = Math.sin(radius);
      return t => {
        const c = Math.cos(t * Math.PI * 2) * sf, s = Math.sin(t * Math.PI * 2) * sf;
        return [f.x * cf + u.x * c + v.x * s, f.y * cf + u.y * c + v.y * s, f.z * cf + u.z * c + v.z * s];
      };
    },
    // The hand is put on by the hover test above, not here: switching drag on does not mean
    // the pointer is over anything grabbable, and switching it off has to take the hand back.
    setDragEnabled(on) { dragEnabled = on; if (!on) container.classList.remove('grabbable'); },
    setAmbient(on) { ambient = on; },
    showPartner(on) { guestGoal = on ? 1 : 0.0001; if (prefersReduced) settleNow(); dirty = true; },
    setPaired(on) { paired = on; layout(); },
    // 'stacked', 'side', or null to let the slot decide. Every beat showing both orbs names
    // one: the undeclared case is a fallback, not a mode the piece actually travels through.
    setArrangement(a) { arrangement = a || null; layout(); },
    // Overrides the framing air. Beats never touch it — they want the cinematic margin. The
    // gate does: it is the one screen where the cortex is the whole composition rather than
    // an illustration standing in a column, so it wants to overfill its box, not sit inside
    // it. null puts the defaults back.
    setFrameMargin(m) { frameMargin = (m == null ? null : m); layout(); },
    // Land the camera where it has just been sent, with no glide. Crossing the gate's media
    // query moves the rig between two framings that are nothing like each other, and damping
    // between them plays a second-long dive through the cortex that reads as a fault. Call it
    // after posing, never during a beat: inside the piece the glide is the point.
    settle() { settleNow(); },
    dimPartner(on) {
      const d = on ? 0.42 : 0;
      if (partner.dim !== d) paint(partner, partnerT, d);
    },
    setCortexTarget(t, immediate = false) {
      cortexTarget = t;
      if (immediate || prefersReduced) { cortexAmt = t; setCortex(t); }
    },
    setShuffled(on) {
      if (on) {
        for (let i = shuffledT.length - 1; i > 0; i--) {
          const j = (Math.random() * (i + 1)) | 0;
          const t = shuffledT[i]; shuffledT[i] = shuffledT[j]; shuffledT[j] = t;
        }
      }
      if (on !== narratorShuffled || on) { narratorShuffled = on; paint(narrator, on ? shuffledT : narratorT, 0); }
    },
    setSpin,
    getSpin: () => [spinQ.x, spinQ.y, spinQ.z, spinQ.w],
    resetSpin() { spinQ.identity(); applyOrientation(); },
    spinTo(q, dur = 900) {
      const from = spinQ.clone();
      const to = new THREE.Quaternion(q[0], q[1], q[2], q[3]);
      if (prefersReduced) { setSpin(q); return Promise.resolve(); }
      return new Promise(done => {
        spinAnim = {
          t0: performance.now(), dur, done,
          at: t => { const o = from.clone().slerp(to, t); return [o.x, o.y, o.z, o.w]; },
        };
      });
    },
  };
}
