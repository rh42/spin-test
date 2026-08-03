// Pure maths for the spin test: smooth fields on a sphere, correlations, and the two nulls.
// No DOM and no three.js, so node can import it and check the numbers copy.js quotes.

const TAU = Math.PI * 2;

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Which coefficient of the shared basis each map reads. Both are sums of the same plane waves
// at the same frequencies and phases, so identical smoothness, but with independent
// amplitudes. The maps are unrelated by construction, which is the whole point of the piece.
//
// Named for their role in the method, not for what the copy calls them: one map spins and one
// is held still, and that never changes, whereas the labels have already moved once. Whatever
// they are called on screen lives in copy.js — today NARRATOR is "myelin" and PARTNER is
// "receptor density". A relabel is a copy.js edit and should stay one.
export const NARRATOR = 'c';   // rendered from beat 0, and the map that spins
export const PARTNER  = 'a';   // arrives at beat 2, held still

export function makeBasis(seed = 7, M = 16) {
  const rng = mulberry32(seed);
  const basis = [];
  for (let k = 0; k < M; k++) {
    const x = rng() * 2 - 1, y = rng() * 2 - 1, z = rng() * 2 - 1;
    const n = Math.hypot(x, y, z) || 1;
    basis.push({
      ux: x / n, uy: y / n, uz: z / n,
      f: 1 + Math.floor(rng() * 5), ph: rng() * TAU,
      a: rng() * 2 - 1, c: rng() * 2 - 1,
    });
  }
  return basis;
}

export function evalField(basis, coef, x, y, z) {
  let s = 0;
  for (const b of basis) s += b[coef] * Math.cos(b.f * (x * b.ux + y * b.uy + z * b.uz) + b.ph);
  return s;
}

// Fibonacci lattice — near-uniform points on the sphere, so no region is over-sampled.
export function sampleDirs(N = 256) {
  const golden = Math.PI * (3 - Math.sqrt(5)), out = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i;
    out.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return out;
}

// Shoemake (1992): uniform on SO(3). Sampling Euler angles uniformly would clump
// rotations near the poles and quietly narrow the null.
export function randomQuaternion(rng) {
  const u1 = rng(), u2 = rng(), u3 = rng();
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  return [a * Math.sin(TAU * u2), a * Math.cos(TAU * u2), b * Math.sin(TAU * u3), b * Math.cos(TAU * u3)];
}

export function quatMatrix(q) {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

export function conj(q) { return [-q[0], -q[1], -q[2], q[3]]; }

export function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let c = b.slice();
  if (d < 0) { d = -d; c = [-b[0], -b[1], -b[2], -b[3]]; }
  if (d > 0.9995) {
    const o = a.map((v, i) => v + (c[i] - v) * t), n = Math.hypot(...o);
    return o.map(v => v / n);
  }
  const th = Math.acos(d), s = Math.sin(th);
  const w0 = Math.sin((1 - t) * th) / s, w1 = Math.sin(t * th) / s;
  return a.map((v, i) => v * w0 + c[i] * w1);
}

export function pearson(A, B, n) {
  let mA = 0, mB = 0;
  for (let i = 0; i < n; i++) { mA += A[i]; mB += B[i]; }
  mA /= n; mB /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = A[i] - mA, xb = B[i] - mB;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  return num / (Math.sqrt(da * db) || 1);
}

export function makeSpinTest({ seed = 7, N = 256, nullSeed = 20180530 } = {}) {
  const basis = makeBasis(seed);
  const dirs = sampleDirs(N);
  const fixed = new Float64Array(N);          // the partner, never moves
  const spun = new Float64Array(N);           // the narrator, re-read after each rotation
  for (let i = 0; i < N; i++) {
    const d = dirs[i];
    fixed[i] = evalField(basis, PARTNER, d[0], d[1], d[2]);
  }

  // Rotating the sampling directions by q⁻¹ is the same as rotating the map by q, and
  // avoids touching the 8000-face geometry to get a number.
  function correlationAt(q) {
    const m = quatMatrix(conj(q));
    for (let i = 0; i < N; i++) {
      const d = dirs[i];
      spun[i] = evalField(basis, NARRATOR,
        m[0] * d[0] + m[1] * d[1] + m[2] * d[2],
        m[3] * d[0] + m[4] * d[1] + m[5] * d[2],
        m[6] * d[0] + m[7] * d[1] + m[8] * d[2]);
    }
    return pearson(fixed, spun, N);
  }

  const IDENTITY = [0, 0, 0, 1];
  const observed = correlationAt(IDENTITY);
  const atRest = Float64Array.from(spun);     // the narrator's values in true alignment

  // One stream per null, not one shared. The reader can reach the beats in any order and the
  // quoted p-values must not change, so neither null may depend on the other's draw count.
  const spinRng = mulberry32(nullSeed);
  const shuffleRng = mulberry32(nullSeed ^ 0x9e3779b9);
  const scratch = new Float64Array(N);

  // The fair fake: rotate, keeping every neighbour a neighbour.
  function spinOnce() {
    const q = randomQuaternion(spinRng);
    return { q, r: correlationAt(q) };
  }

  // The wrong fake: scatter the values across locations. Destroys the smoothness, so the
  // null collapses to near-zero and almost anything clears it.
  function shuffleOnce() {
    scratch.set(atRest);
    for (let i = N - 1; i > 0; i--) {
      const j = (shuffleRng() * (i + 1)) | 0;
      const t = scratch[i]; scratch[i] = scratch[j]; scratch[j] = t;
    }
    return pearson(fixed, scratch, N);
  }

  const pValue = nulls => nulls.filter(v => Math.abs(v) >= Math.abs(observed)).length / (nulls.length || 1);

  // The single fake shown at the "a fair fake" beat, on its own stream so demonstrating it
  // never disturbs either null. Median |r| of a few candidates, not the first draw: the first
  // draw is honest but lands near zero often enough to teach that fakes are feeble, which is
  // the opposite of the point.
  const exampleRng = mulberry32(nullSeed ^ 0x5bf03635);
  function exampleSpin(k = 15) {
    const cands = [];
    for (let i = 0; i < k; i++) {
      const q = randomQuaternion(exampleRng);
      cands.push({ q, r: correlationAt(q) });
    }
    cands.sort((a, b) => Math.abs(a.r) - Math.abs(b.r));
    const pick = cands[k >> 1];
    correlationAt(IDENTITY);            // leave `spun` back at rest for the caller
    return pick;
  }

  // `spun` is live: it holds whatever correlationAt() last wrote, so the scatter can be
  // drawn straight after a call without copying 256 doubles every frame.
  return {
    basis, dirs, N, observed, IDENTITY, fixed, spun, atRest,
    correlationAt, spinOnce, shuffleOnce, pValue, exampleSpin,
  };
}
