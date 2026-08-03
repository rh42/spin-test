// The narrative runner. Beats are discrete and explicit: an index, next/back, one enter()
// each, never derived from scroll position.
//
// Two rules the beats are written against: nothing auto-advances, and past lines stay legible.
// A beat that says "look at me" is self-defeating if looking away costs you the next line.

import { makeSpinTest, slerp, mulberry32 } from './field.js';
import { createStage, PROBE_RADIUS } from './orb.js';
import { drawScatter, drawHist, drawField, histBinAt, clearChart, HIST, COLORS } from './charts.js';
import { beats as C, ui, gate as gateCopy, quips, sick, argument, fill } from './copy.js';

const $ = id => document.getElementById(id);
const fmt = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);
const pText = p => (p === 0 ? '< 0.001' : '= ' + p.toFixed(3));
const wait = ms => new Promise(r => setTimeout(r, ms));
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  || new URLSearchParams(location.search).get('motion') === 'off';

const test = makeSpinTest();
const vals = { observed: fmt(test.observed), n: test.N, pSpin: '—', pShuffle: '—' };
const NULL_N = 1000;
const spinNulls = [], shuffleNulls = [];

const stage = await createStage({
  container: $('stage'),      // full viewport, fixed, never moves
  slot: $('slot'),            // the grid cell the orbs are framed into
  basis: test.basis,
});

// Set on documentElement, not body: --paper is declared on :root, so var(--p) has to resolve
// there or every derived colour computes against the initial value. CSS owns the easing, so
// the tint still runs while the frame loop is suspended.
const setTint = p => document.documentElement.style.setProperty('--p', String(p));

// ── cancellation ────────────────────────────────────────────────────────────────────
// Every beat captures its token. Moving on rejects any pending gate with Cancelled, which
// unwinds the old beat instead of letting it write over the new one, so beat bodies read
// linearly with no live() checks in between.
class Cancelled extends Error {}
let token = 0, pending = null;
const live = t => t === token;

function gate(tok) {
  if (!live(tok)) return Promise.reject(new Cancelled());
  return new Promise((res, rej) => { pending = { res, rej }; armNudge(); })
    // A gate resolves in a microtask, so the beat can have moved on between the click
    // that released it and the continuation running. Re-check before writing anything.
    .then(() => { if (!live(tok)) throw new Cancelled(); });
}
function releaseGate() {
  if (!pending) return false;
  const p = pending; pending = null; disarmNudge(); p.res();
  return true;
}
function cancelGate() {
  if (!pending) return;
  const p = pending; pending = null; disarmNudge(); p.rej(new Cancelled());
}

// ── animations the reader can land ──────────────────────────────────────────────────
// A build or sweep is a stretch with no gate armed. A click there lands the animation rather
// than falling through to the next beat, which would skip the payoff it was waiting on.
let skip = null;
function animate(tok, dur, step) {
  if (prefersReduced) { step(1); return Promise.resolve(); }
  return new Promise(done => {
    let landed = false;
    const mine = () => { landed = true; };
    skip = mine;
    const t0 = performance.now();
    // Only ever retire its own handle: a cancelled beat can outlive its last frame, and
    // clearing the handle blindly would disarm whatever the new beat had already armed.
    const finish = () => { if (skip === mine) skip = null; done(); };
    (function f() {
      if (!live(tok)) return finish();
      const t = landed ? 1 : Math.min(1, (performance.now() - t0) / dur);
      step(t);
      t < 1 ? requestAnimationFrame(f) : finish();
    })();
  });
}

// ── the idle nudge ──────────────────────────────────────────────────────────────────
// The signal has to sit on the button itself: a caption in another corner is not connected to
// it by a reader who has not yet worked out that the page is waiting for them.
let nudgeTimer = null;
function armNudge() {
  clearTimeout(nudgeTimer);
  $('next').classList.remove('waiting');
  nudgeTimer = setTimeout(() => $('next').classList.add('waiting'), 9000);
}
function disarmNudge() { clearTimeout(nudgeTimer); $('next').classList.remove('waiting'); }

// ── presentation ────────────────────────────────────────────────────────────────────
function clearNarration() { $('narration').innerHTML = ''; }

// Past lines stay legible, but only the last few. #slot is the flex child that gives, so an
// unbounded stack never overflows, it eats the orbs. Three is enough to hold a thought.
const KEEP = 3;
function push(raw) {
  const box = $('narration');
  [...box.children].forEach(el => { el.classList.remove('in'); el.classList.add('past'); });
  const el = document.createElement('div');
  el.className = 'line';
  el.innerHTML = fill(raw, vals);
  box.appendChild(el);
  void el.offsetWidth;          // force layout so the transition has a start value to run from
  el.classList.add('in');

  [...box.children].slice(0, -KEEP).forEach(old => {
    if (old.classList.contains('gone')) return;
    old.classList.add('gone');
    // a timer rather than transitionend: under reduced motion the transition is ~0ms and
    // may never fire an event at all, which would leak the node
    setTimeout(() => old.remove(), 700);
  });
}

// Every field a beat narrates from, in the order the runners say them.
const NARRATED = ['brain', 'probe', 'after', 'last', 'browse'];

// #slot is the flex child that pays for narration growth, so an arriving sentence lifts and
// shrinks the orbs and an ageing one drops them back. That movement tracks sentence length
// and nothing the reader is being told, which is what makes it read as slack rather than as
// life. Reserving the tallest run a beat will ever hold at once holds the orbs still *inside*
// a beat while leaving them free to move between beats, where the movement means something.
//
// Measured live rather than declared: wrapping depends on the plan's type scale and on the
// width of the frame, so the only honest number is the one this frame produces.
let narrated = [];
function reserveNarration(n) {
  const box = $('narration');
  box.style.minHeight = '';
  if (n != null) narrated = NARRATED.flatMap(f => C[n][f] || []);
  if (narrated.length < 2) return;   // the CSS floor already covers a single line
  // Anything on screen is taken out of flow for the duration, so a re-measure after a resize
  // reads the same as the one at beat start.
  const showing = [...box.children];
  showing.forEach(el => { el.style.display = 'none'; });
  // KEEP + 1, not KEEP: pushing the line that puts the stack over the limit only *starts* the
  // oldest one collapsing, so for the length of that transition the box really does hold one
  // more than it keeps. Reserving the settled height instead would trade the drift for a
  // bounce, which is the same complaint with a shorter period.
  let tallest = 0;
  for (let i = 0; i < narrated.length; i++) {
    const window = narrated.slice(Math.max(0, i - KEEP), i + 1).map(raw => {
      const el = document.createElement('div');
      el.className = 'line in';
      el.style.visibility = 'hidden';
      el.innerHTML = fill(raw, vals);
      box.appendChild(el);
      return el;
    });
    tallest = Math.max(tallest, box.offsetHeight);
    window.forEach(el => el.remove());
  }
  showing.forEach(el => { el.style.display = ''; });
  if (tallest) box.style.minHeight = tallest + 'px';
}

// One click per line. The first line of a run lands with the beat; the rest wait.
async function say(lines, tok, { gateFirst = false } = {}) {
  if (!lines || !lines.length) return;
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 || gateFirst) await gate(tok);
    push(lines[i]);
  }
}

// `show` is how many of the blocks have been earned yet. The rest are still laid out, just
// invisible, so the column keeps its full height from the first frame and revealing a block
// cannot resize a chart sharing that column. Callers that omit it get everything they passed.
function paper(o) {
  const { claim, detail, truth, show } = o || {};   // callers pass null to clear
  const el = $('paper');
  if (!claim && !detail && !truth) { el.classList.remove('show'); el.innerHTML = ''; return; }
  el.innerHTML = [['claim', claim], ['detail', detail], ['truth', truth]]
    .filter(([, text]) => text)
    .map(([cls, text], i) =>
      `<div class="${cls}${show != null && i >= show ? ' pending' : ''}">${fill(text, vals)}</div>`)
    .join('');
  el.classList.add('show');
}

// label carries markup (the <var> on r and p), so it goes in as HTML. Every string
// reaching it comes from copy.js, never from anything a reader can type.
function setStat(label, value, tone = '') {
  $('statLabel').innerHTML = label;
  $('statValue').textContent = value;
  $('statValue').className = 'value ' + tone;
  $('stat').classList.toggle('show', !!label);
}

function compare(rows) {
  const el = $('compare');
  if (!rows) { el.classList.remove('show'); el.innerHTML = ''; return; }
  el.innerHTML = rows.map(r =>
    `<div><div class="k"><i style="background:${r.color}"></i>${r.k}</div><div class="v">${r.v}</div></div>`).join('');
  el.classList.add('show');
}

function legend(on, held = false) {
  $('legend').classList.toggle('show', on);
  $('legendHeld').textContent = held ? ui.held : '';
}

// mode: null clears it, 'figure' is the field and its sentence, 'poster' is the thesis alone.
// Both closing states have to be enterable from cold, not only by crossfading out of the one
// before: they are separate beats, so `back` and a seek can land on either.
function closer(mode, o = {}) {
  const { lead, cite, href } = o;
  const on = mode !== null;
  $('closer').classList.toggle('show', on);
  // The closer joins the column instead of floating over it; see body.closing in the styles.
  document.body.classList.toggle('closing', on);
  document.body.classList.toggle('finale', mode === 'poster');
  $('closer').classList.remove('leaving');
  $('closerLead').textContent = lead || '';
  $('closerCite').textContent = cite || '';
  $('closerCite').classList.remove('show');   // arrives with the finished sentence
  if (href) $('closerCite').href = href;
  $('colophon').classList.remove('show');
  aside(null);
  $('thesis').classList.remove('show');
  $('thesis').textContent = '';
  if (mode !== 'figure') $('field').classList.remove('show');
}

// The narrator's line, hung under the narrator itself. Everything the brain says on the
// closing beats goes through here, so the quips land where its other lines did.
// Distinct from `say` above, which feeds #narration under the orb on beats 0-8.
function aside(text) {
  $('closerBrain').textContent = text || '';
  $('closerBrain').classList.toggle('show', !!text);
  measureAside();
  placeAside();
}

// The box is positioned off the orb's projected sphere rather than pinned to a corner: the
// orb is a thumbnail on the figure, full-bleed on the poster and a band across the top in
// portrait, and a fixed corner is only near it by coincidence in one of those.
const ASIDE = { gap: 14, edge: 20, floor: 92 };  // floor clears the footer's controls
let asideW = 0, asideH = 0, asideX = -1, asideY = -1;
function measureAside() {
  asideW = $('closerBrain').offsetWidth;
  asideH = $('closerBrain').offsetHeight;
}
function placeAside() {
  const el = $('closerBrain');
  if (!el.classList.contains('show')) return;
  const o = stage.narratorRect();
  if (!o) return;
  // Clipped to the window before anything is measured off it. On the poster the sphere is
  // wider than the frame and its true bottom is below the fold, so the line has to hang off
  // what the reader can see rather than off geometry that is off-screen.
  const left = Math.max(o.cx - o.radius, 0), right = Math.min(o.cx + o.radius, innerWidth);
  const bottom = Math.min(o.cy + o.radius, innerHeight);
  const x = Math.min(Math.max((left + right) / 2 - asideW / 2, ASIDE.edge),
    innerWidth - asideW - ASIDE.edge);
  const y = Math.min(Math.max(bottom + ASIDE.gap, ASIDE.edge),
    innerHeight - ASIDE.floor - asideH);
  // Sub-pixel churn would write to the DOM on every frame of the ambient yaw for nothing.
  if (Math.abs(x - asideX) < 0.5 && Math.abs(y - asideY) < 0.5) return;
  asideX = x; asideY = y;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}
stage.onFrame(placeAside);
// The reservation is a measurement, so it goes stale the moment the column changes width.
addEventListener('resize', () => { reserveNarration(null); measureAside(); placeAside(); });

// ── the colophon ────────────────────────────────────────────────────────────────────
// The button copies exactly what it displays, so the payload is built from the same strings
// the reader is looking at.
const sharePayload = () => `${ui.shareTitle}\n${ui.shareBlurb}\n${ui.shareUrl}`;
$('shareTitle').textContent = ui.shareTitle;
$('shareBlurb').textContent = ui.shareBlurb;
$('shareUrl').textContent = ui.shareUrl;
$('shareAct').textContent = ui.copy;
$('shareAct').setAttribute('aria-label', ui.copyLabel);
$('moreLink').textContent = ui.more;
$('moreLink').href = ui.moreHref;
$('closerSource').textContent = ui.source;
let copyReset = null;
$('shareAct').addEventListener('click', async () => {
  clearTimeout(copyReset);
  try {
    await navigator.clipboard.writeText(sharePayload());
    $('shareAct').textContent = ui.copied;
    $('share').classList.add('done');
  } catch {
    // Denied permission or an insecure origin. The text is already on screen, so the
    // fallback is to say so rather than to fail silently.
    $('shareAct').textContent = ui.copyFailed;
  }
  copyReset = setTimeout(() => {
    $('shareAct').textContent = ui.copy;
    $('share').classList.remove('done');
  }, 2400);
});

// ── the closer's field ──────────────────────────────────────────────────────────────
// The study's own numbers, one dot per pair. `rank` is a seeded shuffle, so the lit dots
// scatter through the field instead of filling it corner-first, and the count stays exact.
const PAIRS = 7140, NAIVE = 5331, SPIN_MATCHES = 35;
const rank = (() => {
  const a = Uint16Array.from({ length: PAIRS }, (_, i) => i);
  const rng = mulberry32(20180530);
  for (let i = PAIRS - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
})();
let fieldLit = 0, fieldRest = 0.16;
function fieldNow(lit = fieldLit, rest = fieldRest) {
  fieldLit = lit; fieldRest = rest;
  drawField($('field'), { total: PAIRS, rank, lit, restAlpha: rest });
}
new ResizeObserver(() => $('closer').classList.contains('show') && fieldNow()).observe($('field'));

// Two hint slots, because the two things a reader can pick up live in different columns:
// `hint` sits under the orb, `chartHint` under the chart.
function hint(text) {
  $('hint').textContent = text || '';
  $('hint').classList.toggle('show', !!text);
}
function chartHint(text) {
  $('readoutHint').textContent = text || '';
  $('readoutHint').classList.toggle('show', !!text);
}
// Which wording an affordance gets. A phone has no hover to offer.
const coarse = matchMedia('(hover: none)').matches;
const wording = (mouse, touch) => (coarse ? touch : mouse);

// ── the probe ───────────────────────────────────────────────────────────────────────
// One direction on the cortex, shared by orb and scatter: the orb lights the patch, the
// scatter picks out the dots that patch produced. A pack of dots moving as one is what
// smoothness *is*, and no colormap was going to say that.
let probe = null;
const PROBE_COS = Math.cos(PROBE_RADIUS);  // the same cap the orb lights, so the sets agree
function moveProbe(d) {
  probe = d;
  stage.setProbe(d);
  if (chart) chart();
}

// charts are CSS-sized, so they have to be redrawn whenever their box changes
let chart = null;
function readout(kind) {
  $('readout').classList.toggle('empty', kind === null);
  $('scatter').classList.toggle('hidden', kind !== 'scatter');
  $('hist').classList.toggle('hidden', kind !== 'hist');
  // Wiped, not just hidden. Beats raise their chart and then wait — beat 4 puts the histogram
  // up two lines before its first bar — so the canvas would show whatever was last painted
  // into it. Arriving at beat 4 from beat 8 that is both nulls and their spans, sitting under
  // a counter reading 0: a picture of the answer above the question that earns it.
  clearChart($('scatter')); clearChart($('hist'));
  if (kind === null) chart = null;
}
// The chart's backing store is sized from its CSS box, and that box now shrinks with the
// column as well as with the window — so the same observer the closer's field uses.
new ResizeObserver(() => chart && chart()).observe($('readout'));
function scatterNow(reveal = 1) {
  chart = () => drawScatter($('scatter'), {
    fixed: test.fixed, spun: test.spun, dirs: test.dirs, n: test.N,
    labelX: ui.axisNarrator, labelY: ui.axisPartner, reveal,
    probe: probe && { x: probe[0], y: probe[1], z: probe[2], cos: PROBE_COS },
  });
  chart();
}
let histSets = [], histHover = null, histSpans = null;
function histNow(sets = histSets, spans = histSpans) {
  histSets = sets; histSpans = spans;
  chart = () => drawHist($('hist'), {
    sets: histSets, observed: test.observed, hover: histHover, spans: histSpans,
  });
  chart();
}
new ResizeObserver(() => chart && chart()).observe($('readout'));

// ── the nulls ───────────────────────────────────────────────────────────────────────
// spinQs runs alongside spinNulls, keeping the rotation behind each r. 32KB for a thousand
// quaternions, and it turns the histogram into a thousand fakes you can pick one out of.
let lastQ = [0, 0, 0, 1];        // the rotation behind the most recent spin draw
const spinQs = [];
const draw = kind => {
  if (kind !== 'spin') return test.shuffleOnce();
  const s = test.spinOnce(); lastQ = s.q; spinQs.push(s.q); return s.r;
};
const store = kind => (kind === 'spin' ? spinNulls : shuffleNulls);

// Finish a null immediately. Called before any beat that quotes a p-value, so clicking
// through a build can never leave the payoff reading "the spin null is —× wider".
function completeNull(kind) {
  const s = store(kind);
  while (s.length < NULL_N) s.push(draw(kind));
  return s;
}

// A batch per frame, so the crowd visibly accumulates. Re-entering a finished beat redraws
// instead of re-rolling, so the numbers stay put; a click lands the whole thousand at once.
function buildNull({ kind, tok, onFrame }) {
  const s = store(kind);
  if (s.length >= NULL_N) { onFrame(s); return Promise.resolve(); }
  return new Promise(done => {
    let landed = false;
    const mine = () => { landed = true; };
    skip = mine;
    const finish = () => { if (skip === mine) skip = null; done(); };
    (function step() {
      if (!live(tok)) return finish();
      const batch = (prefersReduced || landed) ? NULL_N : Math.min(14, 2 + Math.floor(s.length / 26));
      for (let i = 0; i < batch && s.length < NULL_N; i++) s.push(draw(kind));
      onFrame(s);
      if (s.length < NULL_N) requestAnimationFrame(step); else finish();
    })();
  });
}

// ── browsing the crowd ──────────────────────────────────────────────────────────────
// Hovering a bar turns the narrator to a rotation that actually landed there, making the bar
// and the fake behind it one object instead of a crowd you can only look at.
const BROWSABLE = new Set([7, 8]);
let binCache = null, held = null;

function spinBins() {
  if (binCache && binCache.n === spinNulls.length) return binCache.map;
  const map = Array.from({ length: HIST.bins }, () => []);
  for (let i = 0; i < spinNulls.length; i++) {
    const b = Math.max(0, Math.min(HIST.bins - 1, Math.floor((spinNulls[i] + 1) / 2 * HIST.bins)));
    map[b].push(i);
  }
  binCache = { n: spinNulls.length, map };
  return map;
}

function releaseHold() {
  if (!held) return;
  stage.setSpin(held.q);
  setStat(held.label, held.value, held.tone);
  held = null; histHover = null;
  if (chart) chart();
}

const spinSet = () => histSets.findIndex(s => s.color === COLORS.spin);

function holdBar(si, bin) {
  const inBin = spinBins()[bin];
  if (!inBin || !inBin.length) { releaseHold(); return false; }
  // The draw nearest the middle of the bar, so nudging the pointer one pixel along does
  // not swap the orb for a different rotation out of the same bar.
  const mid = (bin + 0.5) / HIST.bins * 2 - 1;
  const pick = inBin.reduce((a, b) => (Math.abs(spinNulls[b] - mid) < Math.abs(spinNulls[a] - mid) ? b : a));
  if (!held) {
    held = {
      q: stage.getSpin(),
      label: $('statLabel').innerHTML,
      value: $('statValue').textContent,
      tone: $('statValue').className.replace('value', '').trim(),
    };
  }
  stage.setSpin(spinQs[pick]);
  setStat(ui.thisFake, fmt(spinNulls[pick]), 'warm');
  histHover = { set: si, bin };
  if (chart) chart();
  return true;
}

$('hist').addEventListener('pointermove', e => {
  if (!BROWSABLE.has(beat) || spinNulls.length < NULL_N) return;
  const si = spinSet(); if (si < 0) return;
  const bin = histBinAt($('hist'), e.clientX);
  if (bin === null) { releaseHold(); return; }
  holdBar(si, bin);
});
$('hist').addEventListener('pointerleave', releaseHold);

// Nobody hovers a histogram unprompted, so the piece does it once itself: three bars, the orb
// snapping to a different fake at each, then the hint. The demo is the affordance.
async function browseDemo(tok) {
  const si = spinSet(); if (si < 0) return;
  const sorted = [...spinNulls].sort((a, b) => a - b);
  const binOf = v => Math.max(0, Math.min(HIST.bins - 1, Math.floor((v + 1) / 2 * HIST.bins)));
  const stops = [0.08, 0.5, 0.9]
    .map(q => binOf(sorted[Math.floor(q * (sorted.length - 1))]))
    .filter((b, i, a) => a.indexOf(b) === i);
  await animate(tok, 2600, t => holdBar(si, stops[Math.min(stops.length - 1, Math.floor(t * stops.length))]));
  if (live(tok)) releaseHold();
}

const sd = a => {
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};

function settleNumbers() {
  completeNull('shuffle'); completeNull('spin');
  vals.pShuffle = pText(test.pValue(shuffleNulls));
  vals.pSpin = test.pValue(spinNulls).toFixed(3);
  // The width ratio is not cached here: beat 8 counts it up from the two spreads it is
  // already drawing, and a second copy of a number is a second chance to disagree.
}

// Turn the narrator by hand so r moves while the reader watches. Scatter and number come from
// the same call, which is the only place "rotation changes the pairing" is visible at all.
async function spinReveal(q, tok, dur = 2000) {
  const from = [0, 0, 0, 1];
  await animate(tok, dur, t => {
    const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const qi = slerp(from, q, e);
    stage.setSpin(qi);
    setStat(ui.oneFake, fmt(test.correlationAt(qi)), 'warm');
    scatterNow(1);
  });
}

// Run the probe once by machine before handing it over, or a reader who never hovers gets
// told the dots travel in packs over a picture that still isn't showing it.
async function probeSweep(tok, dur = 4200) {
  const at = stage.probeLoop();
  // Most of a turn, not all of it: a full loop ends exactly where it started, and a probe
  // back at its origin reads as nothing having happened.
  await animate(tok, dur, t => moveProbe(at(t * 0.85)));
}

// ── the beats ───────────────────────────────────────────────────────────────────────
const BEATS = [
  async tok => { // 0 · the object
    stage.setPaired(false); stage.showPartner(false); stage.setCortexTarget(0);
    stage.setAmbient(true); stage.setDragEnabled(false);
    await say(C[0].brain, tok);
  },

  async tok => { // 1 · it's a map
    stage.setPaired(false); stage.showPartner(false); stage.setCortexTarget(1);
    await say(C[1].brain, tok);
  },

  async tok => { // 2 · the second map — the column opens with it
    stage.setPaired(true); stage.showPartner(true); stage.setCortexTarget(1);
    stage.dimPartner(false); legend(true);
    await say(C[2].brain, tok);
  },

  async tok => { // 3 · measure it — everything downstream leans on this beat
    stage.setPaired(true); stage.showPartner(true); stage.setCortexTarget(1);
    stage.dimPartner(false); legend(true);
    test.correlationAt(test.IDENTITY);
    readout('scatter');
    setStat(ui.observedR, fmt(test.observed), 'warm');
    await say(C[3].brain, tok);

    await animate(tok, 1300, p => scatterNow(p));

    await say(C[3].probe, tok, { gateFirst: true });
    await probeSweep(tok);
    if (!live(tok)) throw new Cancelled();
    stage.setProbeEnabled(true);
    hint(wording(ui.probeHint, ui.probeHintTouch));
    await say(C[3].after, tok, { gateFirst: true });
    await gate(tok);
    paper({ claim: C[3].paper2 });
    await say(C[3].last, tok, { gateFirst: true });
  },

  async tok => { // 4 · the obvious null — let them have the win.
    // The orb stays smooth. The snow belongs to beat 5, and a single frozen draw was
    // never an honest picture of a thousand different shuffles anyway.
    stage.setPaired(true); stage.showPartner(true); stage.setCortexTarget(1);
    stage.dimPartner(false); legend(true);
    readout('hist');
    // The ruler before the crowd: axis, and the observed line already marked, with nothing
    // standing on it. The counter reading 0 then has an empty frame to count into, and the
    // bars grow toward a mark that was placed before they existed.
    histNow([{ values: [], color: COLORS.shuffle }]);
    setStat(ui.shuffleNull, '0', 'counting');
    await say(C[4].brain, tok);

    await buildNull({
      kind: 'shuffle', tok,
      onFrame: s => {
        histNow([{ values: s, color: COLORS.shuffle }]);
        setStat(ui.shuffleNull, String(s.length), 'counting');
      },
    });
    if (!live(tok)) throw new Cancelled();

    vals.pShuffle = pText(test.pValue(shuffleNulls));
    setStat(ui.pShuffle, vals.pShuffle.replace('= ', ''), 'warm');
    paper({ claim: C[4].paper });
    await wait(prefersReduced ? 0 : 500);
    await say(C[4].after, tok, { gateFirst: true });
  },

  async tok => { // 5 · look at what you made — the reversal.
    // The cut: the orb turns to snow on arrival, and the p-value stays on screen beside
    // it. The number says significant, the object says nonsense, in one frame.
    stage.setPaired(true); stage.showPartner(true); stage.setCortexTarget(1);
    stage.dimPartner(false); legend(true);
    stage.setShuffled(true);
    readout(null);
    // The beat is the contradiction between this number and the object beside it, so it has
    // to be here even for a reader who seeked in and never watched beat 4 build it.
    if (vals.pShuffle === '—') vals.pShuffle = pText(test.pValue(completeNull('shuffle')));
    setStat(ui.pShuffle, vals.pShuffle.replace('= ', ''), 'warm');
    await say(C[5].brain, tok);
    await gate(tok);
    paper({ claim: C[5].paper, truth: C[5].truth });
  },

  async tok => { // 6 · a fair fake — both to the sphere, but only one turns
    stage.setPaired(true); stage.showPartner(true);
    stage.setCortexTarget(0); stage.dimPartner(true); stage.setAmbient(false);
    stage.resetSpin(); legend(true, true);
    test.correlationAt(test.IDENTITY);
    readout('scatter'); scatterNow(1);
    setStat(ui.atRest, fmt(test.observed), 'warm');
    await say(C[6].brain, tok);

    await gate(tok);
    const { q } = test.exampleSpin();
    await spinReveal(q, tok);
    if (!live(tok)) throw new Cancelled();
    // Hand the rotation over here. This is the moment the fake is being explained, which is
    // where the reader most wants to make one.
    stage.setDragEnabled(true);
    hint(ui.dragFake);
    await say(C[6].after, tok, { gateFirst: true });
  },

  async tok => { // 7 · a thousand — the climax
    stage.setPaired(true); stage.showPartner(true);
    stage.setCortexTarget(0); stage.dimPartner(true); stage.setAmbient(false);
    legend(true, true);
    readout('hist');
    histNow([{ values: [], color: COLORS.spin }]);
    setStat(ui.spinNull, '0', 'counting');
    await say(C[7].brain, tok);

    await buildNull({
      kind: 'spin', tok,
      onFrame: s => {
        histNow([{ values: s, color: COLORS.spin }]);
        setStat(ui.spinNull, String(s.length), 'counting');
        stage.setSpin(lastQ);
      },
    });
    if (!live(tok)) throw new Cancelled();

    vals.pSpin = test.pValue(spinNulls).toFixed(3);
    setStat(ui.pSpin, vals.pSpin, 'warm');
    stage.resetSpin(); stage.setAmbient(true);
    paper({ claim: C[7].paper });
    await wait(prefersReduced ? 0 : 500);
    await say(C[7].after, tok, { gateFirst: true });

    // The crowd is built; now show that it can be taken apart again.
    await gate(tok);
    await say(C[7].browse, tok);
    await browseDemo(tok);
    if (!live(tok)) throw new Cancelled();
    chartHint(wording(ui.browseHint, ui.browseHintTouch));
  },

  async tok => { // 8 · both nulls — the frame people screenshot
    stage.setPaired(true); stage.showPartner(true); stage.setCortexTarget(1);
    stage.dimPartner(false); stage.setAmbient(true); stage.resetSpin();
    legend(true);
    settleNumbers();
    readout('hist');
    const sets = [
      { values: shuffleNulls, color: COLORS.shuffle },
      { values: spinNulls, color: COLORS.spin },
    ];
    // Both spans arrive at the shuffle null's width — equal, and visibly so — so the chart
    // is already the right height when the growth starts and nothing jumps under it.
    const halfShuffle = sd(shuffleNulls), halfSpin = sd(spinNulls);
    histNow(sets, [
      { half: halfShuffle, color: COLORS.shuffle },
      { half: halfShuffle, color: COLORS.spin },
    ]);
    setStat('');
    compare([
      { k: `${shuffleNulls.length} ${ui.shuffleNull}`, v: `<var>p</var> ${vals.pShuffle}`, color: COLORS.shuffle },
      { k: `${spinNulls.length} ${ui.spinNull}`, v: `<var>p</var> = ${vals.pSpin}`, color: COLORS.spin },
    ]);
    // All three blocks are laid out now and revealed one at a time, so the histogram keeps
    // one height for the whole beat. The growth below is the only motion worth watching.
    paper({ claim: C[8].paper, detail: C[8].detail, truth: C[8].truth, show: 1 });

    // The width *is* the method, so it gets shown. Both spans start at the shuffle null's
    // width, the spin one grows out of it, and the multiple counts up alongside.
    await gate(tok);
    setStat(ui.wider, '1.0×', 'warm');
    await animate(tok, 1600, t => {
      const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const half = halfShuffle + (halfSpin - halfShuffle) * e;
      histNow(sets, [
        { half: halfShuffle, color: COLORS.shuffle },
        { half, color: COLORS.spin },
      ]);
      setStat(ui.wider, (half / (halfShuffle || 1)).toFixed(1) + '×', 'warm');
    });
    if (!live(tok)) throw new Cancelled();
    chartHint(wording(ui.browseHint, ui.browseHintTouch));

    await gate(tok);
    paper({ claim: C[8].paper, detail: C[8].detail, truth: C[8].truth, show: 2 });
    await gate(tok);
    paper({ claim: C[8].paper, detail: C[8].detail, truth: C[8].truth, show: 3 });
  },

  async (tok, { back }) => { // 9 · the scale of it — the figure
    stage.setPaired(false); stage.showPartner(false); stage.setCortexTarget(1);
    stage.setAmbient(true); legend(false);
    readout(null); setStat(''); compare(null);
    closer('figure', { lead: C[9].lead, cite: C[9].cite, href: C[9].citeHref });
    $('field').classList.add('show');

    // The sentence grows a clause at a time, and the number inside the clause is whatever
    // the dots are showing. Everything here comes from copy.js, never from a reader.
    const clause = (raw, n) =>
      $('closerLead').innerHTML = C[9].lead + (raw ? fill(raw, { count: n.toLocaleString() }) : '');

    // Arriving from the poster, the figure is something the reader has already watched.
    // Replaying the count would make `back` a way of starting the beat over rather than
    // returning to it, so it lands finished.
    if (back) {
      fieldNow(SPIN_MATCHES, 0.12);
      clause(C[9].naiveClause, NAIVE);
      $('closerLead').innerHTML += fill(C[9].spinClause, { count: SPIN_MATCHES.toLocaleString() });
      $('closerCite').classList.add('show');
      aside(C[9].brain[0]);
      return;
    }

    fieldNow(0, 0.22);

    // lit: the naive test's verdict, arriving as a count you watch reach 5,331. No press in
    // front of it: the lead sentence and the field answering it are one thought, and a gate
    // between them reads as the beat having stalled rather than as a beat.
    await wait(prefersReduced ? 0 : 900);
    if (!live(tok)) throw new Cancelled();
    await animate(tok, 1500, t => {
      const lit = Math.round(NAIVE * t);
      fieldNow(lit, 0.22);
      clause(C[9].naiveClause, lit);
    });
    if (!live(tok)) throw new Cancelled();
    const naiveDone = $('closerLead').innerHTML;

    // and then out: the same field under the right null, all but thirty-five
    await gate(tok);
    await animate(tok, 1700, t => {
      // the ghost field stays faintly visible: thirty-five has to read as thirty-five
      // *out of* seven thousand, and an empty frame is just thirty-five dots
      const lit = Math.round(NAIVE + (SPIN_MATCHES - NAIVE) * t);
      fieldNow(lit, 0.22 - 0.10 * t);
      $('closerLead').innerHTML = naiveDone + fill(C[9].spinClause, { count: lit.toLocaleString() });
    });
    if (!live(tok)) throw new Cancelled();
    $('closerCite').classList.add('show');

    // The brain gets the second-to-last word, from its own corner, so the line is obviously
    // the thumbnail speaking and not a caption on the figure.
    await gate(tok);
    aside(C[9].brain[0]);
  },

  async (tok, { back }) => { // 10 · the poster
    stage.setPaired(false); stage.showPartner(false); stage.setCortexTarget(1);
    stage.setAmbient(true); legend(false);
    readout(null); setStat(''); compare(null);

    // The two compositions have nothing to tween between, so the text crosses over dark and
    // only the orb travels, carried by #slot going from thumbnail to most of the screen. Only
    // when coming off the figure: any other arrival has nothing on screen left to fade.
    const fromFigure = !back && document.body.classList.contains('closing')
      && !document.body.classList.contains('finale');
    if (fromFigure) {
      aside(null);
      $('closer').classList.add('leaving');
      if (!prefersReduced) await wait(360);
      if (!live(tok)) throw new Cancelled();
    }
    closer('poster');
    $('thesis').textContent = C[10].thesis;
    requestAnimationFrame(() => $('thesis').classList.add('show'));

    // Still an object to hold, but unannounced: turning it changes nothing here, and an
    // invitation to an action with no payoff is worse than letting the reader find it.
    // The quips are the reward, and they only exist for someone who pokes it anyway.
    stage.setDragEnabled(true);
    await wait(prefersReduced ? 0 : 900);
    if (!live(tok)) throw new Cancelled();
    $('colophon').classList.add('show');
  },
];

// ── drag + poke ─────────────────────────────────────────────────────────────────────
// Keep spinning the narrator by hand and it starts to complain.
let dragged = 0;
const SICK_AT = [70, 170, 300];
// The two closing beats. They share the closer between them, so each has to know the other
// exists: the poster fades out of the figure, and the figure lands finished when the reader
// comes back to it from the poster.
const LAST = BEATS.length - 1, FIGURE = LAST - 1;
stage.onDrag(q => {
  if (beat === 6) {
    // beat 6 is showing the scatter, so the reader turning the orb rearranges the dots
    // under their own hand — the pairing changing with the rotation, as a verb.
    setStat(ui.oneFake, fmt(test.correlationAt(q)), 'warm');
    scatterNow(1);
    return;
  }
  if (beat !== LAST) return;
  const i = SICK_AT.indexOf(++dragged);
  if (i >= 0) flash(sick[i]);
});

// Both callers are gated to the poster, where the brain already has a box under the orb. A
// second line floating elsewhere in the page would be the same voice coming from two places.
function flash(line) {
  aside(line);
  clearTimeout(quipTimer);
  quipTimer = setTimeout(() => aside(null), 3400);
}

stage.onProbe(d => { if (beat === 3) moveProbe(d); });

let pokes = 0, quipTimer = null;
stage.onPoke(() => {
  if (beat === 0) { advance(); return; }
  // The poster only: on the figure the brain is delivering its line, and a quip there
  // interrupts the argument with a joke.
  if (beat !== LAST) return;
  flash(quips[Math.min(pokes++, quips.length - 1)]);
});

// ── navigation ──────────────────────────────────────────────────────────────────────
let beat = -1, restart = false;

function advance(viaKey = false) {
  if (skip) { skip(); return; }   // something is building — land it, don't leave the beat
  if (releaseGate()) return;      // a line is waiting — reveal it before moving on
  // Starting over throws the whole piece away, so it is the one move the keyboard does not
  // get. Otherwise a reader still pressing at the end wipes the thesis off by momentum.
  if (restart) { if (!viaKey) go(0); return; }
  go(beat + 1);
}

function go(n, { back = false } = {}) {
  if (n < 0 || n >= BEATS.length) return;
  cancelGate();
  skip = null;                    // the old beat's animation dies with its token
  token++;
  beat = n;

  // on <body>: header and footer are grid siblings of .app and the background sits behind
  // all three, so plan and time of day have to be readable above the whole tree.
  document.body.dataset.plan = C[n].plan;
  stage.setArrangement(C[n].arrangement);
  setTint(C[n].tint);
  clearNarration();
  reserveNarration(n);
  paper(null); compare(null); readout(null); setStat('');
  legend(false);
  // The closing beats hand the closer between them: clearing it here would wipe the figure
  // the poster fades out of. Each of them sets its own mode on entry.
  if (n < FIGURE) closer(null);
  $('thesis').classList.remove('show');
  hint(null); chartHint(null);
  // Every mode the stage can be put into is switched off here, not switched back on by the
  // beats that don't want it. The reader can arrive at any beat from either direction.
  stage.setDragEnabled(false);
  stage.setProbeEnabled(false); probe = null;
  stage.setShuffled(false);       // only beat 5 wants the snow; arriving anywhere else clears it
  stage.setAmbient(true);
  // dropped, not released: the beat being entered sets its own orientation and restoring the
  // browsed one would fight it. The rotation must still reset, or leaving on a browsed bar
  // strands the narrator in an arbitrary fake for the rest of the piece.
  held = null; histHover = null; histSets = []; histSpans = null;
  stage.resetSpin();
  $('hist').classList.toggle('browsable', BROWSABLE.has(n));

  $('back').disabled = n === 0;
  // Never disabled by which beat you are on: disabling it on entering the last beat locks
  // the reader out of the four gates before the ending it would be guarding.
  restart = false;
  setCta(null);
  paintProgress();

  const tok = token;
  BEATS[n](tok, { back })
    // The body resolving means no lines are left, so the next press is the one that moves
    // the piece: the only moment the button may name something more specific than "next".
    // On the last beat the only forward move left is to run it again.
    .then(() => {
      if (!live(tok)) return;
      armNudge();
      if (n === BEATS.length - 1) { restart = true; setCta(ui.again, 'restart'); }
      else setCta(C[n].cta);
    })
    .catch(e => { if (!(e instanceof Cancelled)) throw e; });
}

function setCta(text, mode = '') {
  $('next').textContent = text || ui.next;
  $('next').dataset.mode = mode;
}

function paintProgress() {
  $('progressFill').style.width = ((beat + 1) / BEATS.length * 100).toFixed(2) + '%';
  $('progress').setAttribute('aria-valuenow', String(beat + 1));
  $('progress').setAttribute('aria-valuemax', String(BEATS.length));
}

$('next').addEventListener('click', () => advance());
// Space is this piece's forward key, so at the end it arrives as momentum: a reader still
// pressing wipes the thesis off. Enter is not bound to anything, so pressing it on a button
// the reader has focused is deliberate, and it stays the keyboard's way to start over.
$('next').addEventListener('keydown', e => { if (restart && e.key === ' ') e.preventDefault(); });
$('back').addEventListener('click', () => go(beat - 1, { back: true }));
// The masthead is the way home, which on a page that never scrolls means beat 0. Both nulls
// are cached, so returning re-reads the same numbers instead of re-rolling them.
$('home').addEventListener('click', e => { e.preventDefault(); go(0); });
// Seeking: the bar is continuous, so x maps straight onto a beat.
$('progress').addEventListener('click', e => {
  const r = $('progress').getBoundingClientRect();
  const f = (e.clientX - r.left) / r.width;
  go(Math.max(0, Math.min(BEATS.length - 1, Math.floor(f * BEATS.length))));
});
addEventListener('keydown', e => {
  if (e.key === 'Escape') { $('sheet').classList.remove('show'); return; }
  if ($('sheet').classList.contains('show')) return;
  // Arrows are page navigation and never a control's own key, so they read the same wherever
  // focus is sitting. Space and Enter do belong to a focused control: leave those to the
  // button, which reports its keyboard origin through the click handler above.
  if (e.key === 'ArrowRight') { e.preventDefault(); advance(true); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); go(beat - 1, { back: true }); return; }
  if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
  if (e.key === ' ') { e.preventDefault(); advance(true); }
});

$('textToggle').addEventListener('click', () => $('sheet').classList.add('show'));
$('sheetClose').addEventListener('click', () => $('sheet').classList.remove('show'));
$('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('sheet').classList.remove('show'); });

// ── static strings ──────────────────────────────────────────────────────────────────
$('argument').innerHTML = argument.map(([h, p]) => `<h3>${h}</h3><p>${p}</p>`).join('');
$('legendNarrator').textContent = ui.narrator;
$('legendPartner').textContent = ui.partner;
$('next').textContent = ui.next;
$('back').textContent = ui.back;
$('gateLine').textContent = gateCopy.line;
$('gateSend').textContent = gateCopy.send;
$('gateSend').href = gateCopy.mailto;

// ── the gate ────────────────────────────────────────────────────────────────────────
// Two ways this fits: side by side (both columns) or stacked (wide enough to read, tall
// enough for the orbs *and* the work under them). Anything else gets the orb and an apology.
// The test is the frame, not the device: iPad mini fits at 744×1133 and at 1133×744, a phone
// fits neither way.
const GATE_Q = matchMedia(
  '(max-width: 599px), (max-height: 479px), (max-width: 899px) and (max-height: 799px)');

// Inside the surface rather than looking at it. At this margin the visible window is about a
// fifth of the cortex across, so nothing the ambient sweep does can bring an edge into frame
// and there is no silhouette to place — which is the point, because placing it is what could
// never be made to hold at more than one aspect. Measured, not derived, and the same number
// covers portrait and landscape: the fit already divides by the aspect on the side that binds.
const GATE_MARGIN = 0.15;

function applyGate() {
  const on = GATE_Q.matches;
  document.body.classList.toggle('gated', on);
  if (!on) {
    stage.setFrameMargin(null);
    // go() poses the stage synchronously before its first await, so by the time it returns the
    // camera has its beat's framing to land on.
    go(beat < 0 ? 0 : beat);
    stage.settle();
    return;
  }
  // Gated: no beat runs, so the stage is posed by hand — the cortex, turning, and draggable,
  // because a thing to turn is better company than a message on its own.
  //
  // The cortex and not beat 0's sphere. The social card shows the folded surface, so by the
  // time anyone reaches this screen the shape is not news, and a sphere here would be hiding
  // something already given away. What stays hidden either way is the morph between them,
  // which is the actual opening and happens only at beat 1. Nothing is spent by sitting still.
  cancelGate(); skip = null; token++;
  // immediate: the gate is arrived at, never travelled to. Letting the surface tween in would
  // play the unfold on the one screen that must not spend it, to a reader who has no idea yet
  // that it means anything.
  stage.setPaired(false); stage.showPartner(false); stage.setCortexTarget(1, true);
  stage.setShuffled(false); stage.setAmbient(true);
  stage.resetSpin(); stage.setProbeEnabled(false); stage.setDragEnabled(true);
  // Landed, not glided. The two framings are nothing like each other — a beat sits well back
  // from a whole cortex, this sits inside one — and damping between them plays a dive through
  // the surface every time the window crosses the query, in both directions.
  stage.setFrameMargin(GATE_MARGIN);
  stage.settle();
}
GATE_Q.addEventListener('change', applyGate);
applyGate();
