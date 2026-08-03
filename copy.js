// Every user-facing string. Keeping it that way is the whole prerequisite for a translation,
// and it costs nothing as long as nothing gets inlined elsewhere.
//
// Two voices, separated by place as much as by type:
//   brain — under the orb. mono, lowercase. narrates, jokes, makes the mistake.
//   paper — in the work column. sans, sentence case. states the method, owns the numbers.
//
// {tokens} are filled at runtime. Numbers are never hardcoded: the p-value the reader is
// told is the one they just watched being built.

// <var> carries the italics on r and p. It means what it says, and unlike <i> it does not
// collide with the bare <i> used as a colour swatch in the compare row.
export const ui = {
  next: 'next',
  back: '◂',
  narrator: 'myelin (me)',
  partner: 'receptor density',
  held: '· held still',
  axisNarrator: 'myelin →',
  axisPartner: 'receptor density ↑',
  again: 'start over',
  dragFake: 'turn me yourself · make your own fake',
  // Two wordings per affordance. A touch screen has no hover, and telling a phone reader
  // to hover something is the same as telling them the feature is not for them.
  probeHint: 'move over the cortex · the dots follow',
  probeHintTouch: 'drag on the cortex · the dots follow',
  browseHint: 'hover the crowd · meet the fake behind a bar',
  browseHintTouch: 'drag across the crowd · meet the fakes',
  shuffleNull: 'shuffles',
  spinNull: 'spins',

  // Stat labels. They live here like every other string, and they carry the <var> markup
  // that r and p need, so they cannot be assembled at the call site.
  observedR: 'observed <var>r</var>',
  atRest: '<var>r</var> · at rest',
  oneFake: '<var>r</var> · one fake',
  thisFake: '<var>r</var> · this fake',
  pShuffle: '<var>p</var> (shuffle)',
  pSpin: '<var>p</var> (spin)',
  wider: 'wider than shuffle',

  // What the piece is made of. Precise on purpose: the surface and its folding are real,
  // the two maps are not, and saying "real data" flatly would be claiming the maps too.
  source: 'Real cortex: fsLR 4k left hemisphere, HCP. The two maps are simulated, and built to be unrelated, which is how the piece can show you the answer the test should have given.',
  sourceTag: 'about the data',

  // The colophon, on the poster only. Whatever the button copies has to be what the reader
  // can see, so these three strings are both the display text and the clipboard payload.
  shareTitle: 'The Spin Test',
  shareBlurb: 'Why do two brain maps look correlated even when they’re not?',
  shareUrl: 'https://rh42.github.io/spin-test/',
  copy: 'copy',
  copyLabel: 'copy the title, description and link',
  copied: 'copied',
  copyFailed: 'select it and copy',
  // A byline, not a nav link. The piece carries no credit anywhere else, so this is the line
  // that answers who made it, and the link comes free.
  more: 'made by rh42 · rh42.github.io',
  moreHref: 'https://rh42.github.io/',
};

// Shown when the frame cannot hold the piece (media query in index.html). The page's own voice,
// not the narrator's: this is the one screen a reader can reach without having met the narrator,
// and a persona introducing itself while turning you away is two things to work out at once.
// Flat on purpose. It states the fact and points at the way out, and the cortex sits there
// being itself — which is a better thing to hand someone than a joke about the situation.
export const gate = {
  line: 'This site needs a bigger screen.',
  send: 'send it to yourself →',
  mailto: 'mailto:?subject=The%20Spin%20Test&body=https%3A%2F%2Frh42.github.io%2Fspin-test%2F',
};

// Each beat picks a stage plan and a time of day.
//
// cta — what the forward button says at the one press in the beat that starts something. Most
//   presses only reveal the next line, so the beat arms this just before the press that earns
//   it and `go` resets it. A verb left standing would name a move the button is not making.
//
// plan — four layouts, not eleven: 'overture' (the orb owns the grid), 'split' (orb left,
//   work right), 'reveal' (beat 5, the ruin takes the frame), 'figure' (beat 8, the chart
//   takes the frame).
//
// arrangement — 'side' or 'stacked', required on every beat showing both orbs. The split plan's
//   slot fits either almost equally well, so a stage left to measure re-decides when a line of
//   narration reflows under it and rearranges the pair mid-sentence. The stage still overrules a
//   declaration the slot cannot honour: below 900px nothing can stack in the band left over.
//
// tint — 0 first light, 1 full daylight. It only warms and lowers the paper, and it runs one
//   way across the opening: coming back down would make it a mode again. Spread over five
//   beats rather than two, so no single step is large enough to read as an event.
export const beats = [
  { // 0 · the object
    plan: 'overture', tint: 0,
    brain: ['hello'],
  },
  { // 1 · it's a map
    plan: 'overture', tint: 0.25,
    brain: [
      'i’m a brain map.',
      'myelin, say, how thickly wrapped each bit of me is.',
      // The one word a reader can be stopped by, and the argument rests on it. The tooltip
      // is a definition, not a joke: it is needed here, four beats before the term works.
      'notice how neighbors look alike? that’s not me being interesting. that’s me being '
        + '<em class="gloss" tabindex="0" data-tip="Smooth: things close together on the cortex tend to be alike, so any patch resembles its neighbors whether or not anything interesting is going on.">smooth</em>.',
    ],
  },
  { // 2 · the second map. Still full frame — there is nothing to analyse yet, so the work
    //     column would be empty. This is where the lights come up: the arrival of the
    //     second map is the reason the piece needs daylight.
    plan: 'overture', tint: 0.5, arrangement: 'side',
    brain: [
      'there’s another map of this same cortex. how much of some receptor sits in each patch.',
      'people want to know whether it lines up with me. structure against chemistry, that kind of thing.',
      'so. do we line up?',
    ],
  },
  { // 3 · measure it, and answer "compared to what?". The probe lights a patch of cortex and
    //     the dots that patch produced light with it, so moving one patch moves one clump.
    plan: 'split', tint: 0.75, arrangement: 'side',
    // Nothing else in the piece states that a dot is a *place* holding both maps at once, and
    // the probe, the packs, and beat 6 turning one map while the other is held all need it.
    // Named as the move first, because plotting two things against each other is something a
    // reader already knows how to picture, and the dot is then just what the move produces.
    // "on one axis / on the other" leaves the naming of each axis to its own label.
    brain: ['put us on a graph. each dot is one patch of cortex: my myelin on one axis, the receptor on the other.'],
    paper: 'Observed <var>r</var> = {observed}',
    probe: ['watch one patch of me.'],
    after: [
      '{n} dots, and they move in packs. nowhere near {n} independent opinions.',
      'is {observed} a lot? no idea. nothing to compare it to.',
    ],
    cta: 'shuffle it',
    paper2: 'A correlation is only large or small next to the correlations you get from maps that are not related. So make some maps you know are unrelated, and see how often they reach {observed}.',
    last: ['right. how do i fake an unrelated map?'],
  },
  { // 4 · the obvious null — let them have the win. the orb stays SMOOTH here on purpose;
    //     the snow is beat 5's reveal, and one frozen draw out of a thousand was never
    //     an honest picture of the build anyway.
    plan: 'split', tint: 1, arrangement: 'side',
    // One line, not two. The button that got the reader here says "shuffle it", so a gate
    // between the promise and the counter moving reads as the press having done nothing.
    // Beat 7 says its whole loop in one line for the same reason.
    brain: ['easy. shuffle my values around. break the link between place and number. do it a thousand times, see what <var>r</var> turns up by chance.'],
    paper: '<var>p</var> {pShuffle}',
    after: ['...oh.', 'that’s a real result. that’s a figure.'],
  },
  { // 5 · look at what you made — the reversal. The ruin takes the frame and the p-value it
    //     earned stays pinned beside it. Stacking in a slot this wide costs half again the
    //     camera distance, which would land the ruin a third smaller on the beat built for it.
    plan: 'reveal', tint: 1, arrangement: 'side',
    brain: [
      'hang on. look at me.',
      'no cortex has ever looked like that. i’m static. i’m television snow.',
      'i cleared a bar that no brain could get over. of course i cleared it.',
    ],
    paper: 'The <var>p</var>-value was computed correctly. The null was wrong. Every value that made it significant came from destroying the one thing real maps never lose.',
    truth: 'These two maps were built to have nothing in common: same smoothness, independent amplitudes, no relationship at all. The naive test called them a match.',
  },
  { // 6 · a fair fake. both go back to the sphere, because that is where the turning
    //     happens — but only one of them turns.
    plan: 'split', tint: 1, arrangement: 'side',
    brain: [
      'try again. blow us both back into balls. the sphere is where the turning happens.',
      'now leave the other one exactly where it is. and turn me.',
    ],
    cta: 'again, a thousand times',
    after: [
      'same values. same neighbors. same smoothness.',
      'i’m just facing a different way now, so nothing lines up on purpose any more.',
      'that’s a fake worth beating.',
    ],
  },
  { // 7 · a thousand — the climax
    plan: 'split', tint: 1, arrangement: 'side',
    // The loop said out loud, because the histogram building beside it is the "write it down"
    // and nothing else says so. It has to name the repetition for a reader who has not yet
    // worked out what a bar is.
    brain: ['turn me. measure. write it down. a thousand times.'],
    cta: 'compare them',
    paper: '<var>p</var> = {pSpin}',
    after: [
      '{observed} lands in the crowd.',
      'we look alike because i’m smooth. not because we’re related.',
    ],
    browse: ['every bar in there is a handful of me, facing some other way. have a look.'],
  },
  { // 8 · both nulls — the frame people screenshot. The two spans start equal, one grows,
    //     and the multiple counts up beside them, so 3.6× arrives as the result of watching.
    //     Printing the number over a picture that never showed it is the thing to avoid.
    plan: 'figure', tint: 1, arrangement: 'stacked',
    cta: 'count them',
    paper: 'Same maps. Same <var>r</var> = {observed}. Two nulls.',
    detail: 'That width is the method. It is the correlation that smoothness alone can manufacture, and shuffling threw it away.',
    truth: 'The maps were unrelated. Only one of these nulls got that right.',
  },
  { // 9 · the scale of it — the figure
    plan: 'overture', tint: 1,
    // One sentence, built a clause at a time as the field earns each one. {count} is whatever
    // the dots are showing at that instant, so the numbers are never written ahead of the
    // evidence for them.
    lead: 'Across 7,140 pairs of real brain maps,',
    naiveClause: ' the naive test counted <b>{count}</b> as real matches.',
    spinClause: ' The spin test counted <b>{count}</b>.',
    cite: 'Alexander-Bloch et al., 2018',
    citeHref: 'https://doi.org/10.1016/j.neuroimage.2018.05.070',
    brain: ['you just did that. twice. on one pair.'],
  },
  { // 10 · the poster
    plan: 'overture', tint: 1,
    thesis: 'Looking alike isn’t the same as being linked.',
  },
];

// Nothing follows the thesis. A beat after it (a sandbox, "okay. your turn.") makes the toy
// the ending instead, and the orb stays draggable anyway once the thesis has landed.

// Escalating replies if the reader keeps poking the orb.
export const quips = [
  'oh. hello again.',
  'most people stop at the p-value.',
  'i don’t mind this. i’ve had a long day.',
  'a thousand rotations. every one of them meant nothing. on purpose.',
  'i was never the interesting one. i was just smooth.',
  'Alexander-Bloch never poked me this much.',
  'careful. this is roughly how p-hacking starts.',
  'if you find something real in me, use the right null.',
  'go on. someone out there has a figure to check.',
];

export const sick = [
  'ok. ok. i’m gonna be sick.',
  'whoa. okay, that’s plenty.',
  'i can see the back of my own head.',
];

// Text-only path, for readers who want the argument without the ceremony.
export const argument = [
  ['The problem', 'The cortex is spatially smooth: neighboring regions resemble each other simply for being neighbors. So any two cortical maps overlap to some degree whether or not they are genuinely related, and a plain correlation cannot separate a real relationship from shared smoothness.'],
  ['The method', 'Measure the correlation between the two maps as they truly sit on the cortex. Then hold one map fixed and rotate the other to a random orientation on the sphere. The rotation preserves each map’s internal smoothness but destroys their anatomical alignment. Re-measure, and repeat about a thousand times to build a null distribution: the correlations that smoothness alone can produce.'],
  ['Why not just shuffle', 'Shuffling values across locations also breaks the alignment, but it destroys the smoothness at the same time. The resulting null is far too narrow, so almost any observed correlation clears it. A null model has to keep everything about the map except the thing being tested.'],
  ['Reading the result', 'If the observed correlation falls inside the spin null, smoothness alone accounts for it and there is no evidence of a real relationship. If it stands clear, smoothness cannot explain it.'],
];

export function fill(str, vals) {
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
}
