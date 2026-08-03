// Canvas 2D scatter and histogram. No D3: these plots are simple enough that a charting
// dependency costs more than it saves, and going without keeps the site a static folder.
//
// They only appear once the dawn is up (beat 3 onward), so they are day-only, ink on cool
// grey. No frame and no fill, because a border around a chart is what makes a page look
// like a dashboard.

const DIM = '#5c6572', LINE = '#ccd2db';
const ACCENT = '#c2470f', SPIN = '#1f6d9e', SHUFFLE = '#6d3fae';
export const COLORS = { observed: ACCENT, spin: SPIN, shuffle: SHUFFLE };

function fit(cv) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return null;
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

// Hiding a canvas does not empty it. Every beat that puts a chart up and then waits before
// drawing into it would otherwise reveal the last beat's picture, so the runner wipes both
// on every switch. Device pixels, and the identity transform, because `fit` owns the dpr
// scaling and has not run yet on the canvas being cleared.
export function clearChart(cv) {
  const ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
}

// Dots are coloured by where they sit on the cortex, so a pack of neighbours is a pack of one
// colour. Longitude picks the hue and latitude the lightness, an actual colour wheel. Mapping
// xyz onto rgb instead sends most directions to the muddy middle of the cube.
export function locationColor(d) {
  const hue = ((Math.atan2(d[2], d[0]) / (Math.PI * 2)) + 1) % 1;
  const light = 33 + (d[1] * 0.5 + 0.5) * 28;
  return `hsl(${(hue * 360).toFixed(0)} 64% ${light.toFixed(0)}%)`;
}

// `probe` is a unit direction on the cortex plus the cosine of its radius. Dots inside it are
// the patch the reader is holding; everything else drops back. Moving the probe moves one
// clump, which is the only place in the piece "the dots travel in packs" is shown at all.
const inProbe = (d, p) => d[0] * p.x + d[1] * p.y + d[2] * p.z >= p.cos;

export function drawScatter(cv, { fixed, spun, dirs, n, labelX, labelY, reveal = 1, probe = null }) {
  const f = fit(cv); if (!f) return;
  const { ctx, w, h } = f;
  const pad = 34, top = 12, right = 12, bottom = 30;
  let aLo = Infinity, aHi = -Infinity, bLo = Infinity, bHi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (fixed[i] < bLo) bLo = fixed[i]; if (fixed[i] > bHi) bHi = fixed[i];
    if (spun[i] < aLo) aLo = spun[i]; if (spun[i] > aHi) aHi = spun[i];
  }
  const sx = v => pad + ((v - aLo) / ((aHi - aLo) || 1)) * (w - pad - right);
  const sy = v => (h - bottom) - ((v - bLo) / ((bHi - bLo) || 1)) * (h - bottom - top);

  ctx.strokeStyle = LINE; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, top); ctx.lineTo(pad, h - bottom); ctx.lineTo(w - right, h - bottom);
  ctx.stroke();
  ctx.fillStyle = DIM; ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.fillText(labelX, w - right - ctx.measureText(labelX).width, h - bottom + 17);
  ctx.save(); ctx.translate(13, top + 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText(labelY, -ctx.measureText(labelY).width, 0); ctx.restore();

  // Two passes so brushed dots are never buried under the ones they were picked out of. They
  // go accent, not their location colour: uniform reads as "this is the set", and it matches
  // the warm patch lit on the cortex beside it.
  const shown = Math.floor(n * reveal);
  ctx.globalAlpha = probe ? 0.2 : 0.82;
  for (let i = 0; i < shown; i++) {
    if (probe && inProbe(dirs[i], probe)) continue;
    ctx.fillStyle = locationColor(dirs[i]);
    ctx.beginPath(); ctx.arc(sx(spun[i]), sy(fixed[i]), 2.8, 0, Math.PI * 2); ctx.fill();
  }
  if (probe) {
    ctx.globalAlpha = 1; ctx.fillStyle = ACCENT;
    for (let i = 0; i < shown; i++) {
      if (!inProbe(dirs[i], probe)) continue;
      ctx.beginPath(); ctx.arc(sx(spun[i]), sy(fixed[i]), 3.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// The bar geometry lives here, so the reverse map does too: the beat runner only ever
// needs to know "the reader is over bin 23", not where bin 23 is.
export const HIST = { pad: 20, top: 24, right: 12, bottom: 28, bins: 41 };

export function histBinAt(cv, clientX) {
  const r = cv.getBoundingClientRect();
  const f = (clientX - r.left - HIST.pad) / (r.width - HIST.pad - HIST.right);
  if (f < 0 || f >= 1) return null;
  return Math.floor(f * HIST.bins);
}

// One dot per pair of real brain maps, and the only place the piece leaves its own two maps.
// 7,140 is not a quantity a sentence can deliver; watching 5,331 light up and all but 35 go
// out is the same fact as a picture. `rank` is a fixed shuffled ordering, so the lit ones
// scatter through the field instead of filling a block, and the count stays exact.
export function drawField(cv, { total, rank, lit, restAlpha = 0.16 }) {
  const f = fit(cv); if (!f) return;
  const { ctx, w, h } = f;
  const cols = Math.max(1, Math.round(w / Math.sqrt((w * h) / total)));
  const rows = Math.ceil(total / cols);
  const gx = w / cols, gy = Math.min(gx, h / rows);
  const r = Math.max(0.85, Math.min(gx, gy) * 0.32);
  const y0 = (h - rows * gy) / 2 + gy / 2;

  for (const pass of [0, 1]) {
    ctx.fillStyle = pass ? ACCENT : DIM;
    ctx.globalAlpha = pass ? 1 : restAlpha;
    if (ctx.globalAlpha <= 0.01) continue;
    ctx.beginPath();
    for (let i = 0; i < total; i++) {
      if ((rank[i] < lit) !== !!pass) continue;
      const x = (i % cols) * gx + gx / 2, y = y0 + Math.floor(i / cols) * gy;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function drawHist(cv, { sets, observed, hover = null, spans = null }) {
  const f = fit(cv); if (!f) return;
  const { ctx, w, h } = f;
  const { pad, top, right, bins } = HIST;
  const bottom = HIST.bottom + (spans ? 20 : 0);   // room under the tick row for the spans
  const sx = v => pad + ((v + 1) / 2) * (w - pad - right);
  let peak = 1;
  const counted = sets.map(s => {
    const c = new Array(bins).fill(0);
    for (const v of s.values) {
      let i = Math.floor((v + 1) / 2 * bins);
      if (i < 0) i = 0; if (i >= bins) i = bins - 1;
      c[i]++;
    }
    peak = Math.max(peak, ...c);
    return c;
  });

  ctx.strokeStyle = LINE; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, h - bottom); ctx.lineTo(w - right, h - bottom); ctx.stroke();
  ctx.fillStyle = DIM; ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.fillText('−1', pad - 6, h - bottom + 16);
  ctx.fillText('0', sx(0) - 3, h - bottom + 16);
  ctx.fillText('+1', w - right - 12, h - bottom + 16);

  const bw = (w - pad - right) / bins;
  counted.forEach((c, si) => {
    ctx.fillStyle = sets[si].color;
    ctx.globalAlpha = sets.length > 1 ? 0.66 : 0.92;
    for (let i = 0; i < bins; i++) {
      const bh = (c[i] / peak) * (h - bottom - top);
      if (bh > 0) ctx.fillRect(pad + i * bw + 0.5, (h - bottom) - bh, Math.max(0.5, bw - 1), bh);
    }
  });
  ctx.globalAlpha = 1;

  // The bar the reader is holding. Solid rather than outlined, because at this bar width
  // an outline is most of the bar.
  if (hover && counted[hover.set]) {
    const c = counted[hover.set][hover.bin] || 0;
    const bh = (c / peak) * (h - bottom - top);
    if (bh > 0) {
      ctx.fillStyle = ACCENT;
      ctx.fillRect(pad + hover.bin * bw + 0.5, (h - bottom) - bh, Math.max(1.5, bw - 1), bh);
    }
  }

  // ± one standard deviation, drawn under the axis as a plain span. The width of a null is
  // the whole method, and a number in a sentence is not a width — this is.
  if (spans) {
    spans.forEach((s, i) => {
      const y = h - bottom + 26 + i * 10;
      ctx.strokeStyle = s.color; ctx.lineWidth = 3.5; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(sx(-s.half), y); ctx.lineTo(sx(s.half), y); ctx.stroke();
    });
  }

  if (observed != null) {
    const ox = sx(observed);
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ox, top - 10); ctx.lineTo(ox, h - bottom); ctx.stroke();
    ctx.fillStyle = ACCENT;
    const t = 'observed';
    ctx.fillText(t, Math.min(ox + 6, w - right - ctx.measureText(t).width), top - 3);
  }
}
