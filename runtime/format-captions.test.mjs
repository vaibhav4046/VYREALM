import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCueList, escapeDrawtext, buildCaptionFilter, captionEvidence } from './format-captions.mjs';
import { CAPTION_STYLES } from './format-library.mjs';

const REELS = { width: 1080, height: 1920, fps: 30 };
const REELS_SAFE = { top: 269, bottom: 672, left: 65, right: 65 };
const LONGFORM = { width: 1920, height: 1080, fps: 30 };
const LONGFORM_SAFE = { top: 60, bottom: 120, left: 96, right: 96 };

const SENTENCE = 'a deceptively simple sentence about extraordinarily long words and short ones too';

/** Split a filter fragment back into its drawtext entries. */
function entriesOf(filter) {
  return filter ? filter.split(/,(?=drawtext=)/) : [];
}

const fieldOf = (entry, name) => {
  const match = entry.match(new RegExp(`(?:^|:)${name}=([^:]*)`));
  return match ? match[1] : null;
};

/**
 * Evaluate a drawtext coordinate expression the way FFmpeg would.
 * text_w/text_h are substituted first so the bare w/h replacement cannot
 * chew through them.
 */
function evaluate(expr, { w, h, textW, textH }) {
  const substituted = expr
    .replaceAll('text_w', String(textW))
    .replaceAll('text_h', String(textH))
    .replace(/\bw\b/g, String(w))
    .replace(/\bh\b/g, String(h));
  return Function(`"use strict";return (${substituted})`)();
}

const codeOf = fn => {
  try { fn(); } catch (error) { return error.code; }
  return null;
};

/**
 * Evaluate an `enable` expression with FFmpeg's own comparison semantics, so a
 * change back to an inclusive window fails the overlap tests instead of the
 * assertion quietly re-implementing whatever the module emitted.
 */
function liveAt(entry, t) {
  const expr = fieldOf(entry, 'enable').replace(/^'|'$/g, '');
  const bool = v => (v ? 1 : 0);
  return Function('t', 'gte', 'lt', 'gt', 'lte', 'between', `"use strict";return (${expr})`)(
    t,
    (a, b) => bool(a >= b), (a, b) => bool(a < b), (a, b) => bool(a > b), (a, b) => bool(a <= b),
    (x, min, max) => bool(x >= min && x <= max)   // FFmpeg's between() is inclusive at BOTH ends
  ) !== 0;
}

/* ------------------------------------------------------------------ */
/* buildCueList                                                        */
/* ------------------------------------------------------------------ */

test('cues tile the beat exactly, with no gap and no overlap', () => {
  for (const id of ['karaoke-bold', 'single-line-center', 'top-statement', 'minimal-lower']) {
    const cues = buildCueList({ text: SENTENCE, durationSeconds: 7.5, style: id });
    assert.ok(cues.length > 1, `${id} should split into several cues`);
    assert.equal(cues[0].start, 0, `${id} must start at zero`);
    assert.equal(cues.at(-1).end, 7.5, `${id} must end exactly on the beat duration`);
    for (let i = 0; i < cues.length - 1; i++) {
      // Strict equality, not a tolerance: the boundary is carried forward by
      // reference, so any drift here is a real bug rather than float noise.
      assert.equal(cues[i].end, cues[i + 1].start, `${id} cue ${i} must hand straight over to ${i + 1}`);
      assert.ok(cues[i].end > cues[i].start, `${id} cue ${i} must have positive duration`);
    }
    const covered = cues.reduce((sum, cue) => sum + (cue.end - cue.start), 0);
    assert.ok(Math.abs(covered - 7.5) < 1e-9, `${id} cue durations must sum to the beat`);
  }
});

test('every word survives the split, in order', () => {
  const cues = buildCueList({ text: SENTENCE, durationSeconds: 6, style: 'karaoke-bold' });
  assert.equal(cues.map(cue => cue.text).join(' '), SENTENCE);
});

test('cues hold in proportion to word length', () => {
  // One long word against one short word, one word per cue via a custom style.
  const style = { id: 'one-word', wordsPerCue: 1, weight: 700, position: 'center', highlight: false };
  const [short, long] = buildCueList({ text: 'ab abcdefgh', durationSeconds: 10, style });
  assert.equal(short.end - short.start, 2, 'a 2-character word should hold 2 of 10 seconds');
  assert.equal(long.end - long.start, 8, 'an 8-character word should hold 8 of 10 seconds');
  assert.ok(long.end - long.start > short.end - short.start, 'the longer word must hold longer');

  // Proportional means proportional, not rounded-to-nearby: a 1:2 split of one
  // second lands on a third, and a boundary snapped to 0.33 would be a quiet lie.
  const [first, second] = buildCueList({ text: 'a bb', durationSeconds: 1, style });
  assert.equal(first.end, 1 / 3);
  assert.equal(second.start, 1 / 3);
});

test('a single word shorter than wordsPerCue becomes one cue over the whole beat', () => {
  const cues = buildCueList({ text: 'go', durationSeconds: 1.2, style: 'minimal-lower' });
  assert.equal(cues.length, 1);
  assert.deepEqual(cues[0], { start: 0, end: 1.2, text: 'go' });
});

test('empty and whitespace-only text produce no cues', () => {
  for (const text of ['', '   ', '\n\t  \n', ' \u00a0 ']) {
    assert.deepEqual(buildCueList({ text, durationSeconds: 5, style: 'karaoke-bold' }), [],
      `${JSON.stringify(text)} must yield no cues`);
  }
});

test('style none yields no cues at all', () => {
  assert.deepEqual(buildCueList({ text: SENTENCE, durationSeconds: 5, style: 'none' }), []);
  assert.equal(CAPTION_STYLES.none.wordsPerCue, 0, 'contract check: none declares zero words per cue');
});

test('a trailing partial cue still lands on the beat end', () => {
  // 7 words at 3 per cue leaves a 1-word tail.
  const cues = buildCueList({ text: 'one two three four five six seven', durationSeconds: 4, style: 'karaoke-bold' });
  assert.equal(cues.length, 3);
  assert.equal(cues.at(-1).text, 'seven');
  assert.equal(cues.at(-1).end, 4);
});

test('bad inputs are refused with codes, never silently approximated', () => {
  assert.equal(codeOf(() => buildCueList({ text: 'x', durationSeconds: 0, style: 'karaoke-bold' })), 'CAPTION_DURATION_INVALID');
  assert.equal(codeOf(() => buildCueList({ text: 'x', durationSeconds: -3, style: 'karaoke-bold' })), 'CAPTION_DURATION_INVALID');
  assert.equal(codeOf(() => buildCueList({ text: 'x', durationSeconds: NaN, style: 'karaoke-bold' })), 'CAPTION_DURATION_INVALID');
  assert.equal(codeOf(() => buildCueList({ text: 42, durationSeconds: 5, style: 'karaoke-bold' })), 'CAPTION_TEXT_INVALID');
  assert.equal(codeOf(() => buildCueList({ text: 'x', durationSeconds: 5, style: 'no-such-style' })), 'CAPTION_STYLE_UNKNOWN');
});

test('an inherited Object key is not a caption style', () => {
  // CAPTION_STYLES.constructor is truthy; spreading it yields a style with an
  // undefined wordsPerCue, which used to produce one empty-text cue instead of
  // an error - a garbage cue rather than a refusal.
  for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    assert.equal(codeOf(() => buildCueList({ text: 'x y z', durationSeconds: 5, style: key })),
      'CAPTION_STYLE_UNKNOWN', `${key} must not resolve to a style`);
  }
});

/* ------------------------------------------------------------------ */
/* escapeDrawtext                                                      */
/* ------------------------------------------------------------------ */

test('escapeDrawtext returns a quoted literal', () => {
  assert.equal(escapeDrawtext('HELLO'), "'HELLO'");
  assert.equal(escapeDrawtext(''), "''");
});

test('each dangerous character gets its measured escape', () => {
  // These exact sequences were verified against workers/tools/ffmpeg.exe by
  // rendering and counting lit pixels; weaker escapes DROP the character.
  assert.equal(escapeDrawtext('a:b'), "'a\\:b'", 'colon');
  assert.equal(escapeDrawtext('a,b'), "'a\\,b'", 'comma');
  assert.equal(escapeDrawtext('a[b'), "'a\\[b'", 'open bracket');
  assert.equal(escapeDrawtext('a]b'), "'a\\]b'", 'close bracket');
  assert.equal(escapeDrawtext('a\\b'), "'a\\\\\\\\b'", 'backslash needs four');
  assert.equal(escapeDrawtext('a%b'), "'a\\\\%b'", 'percent needs two');
  assert.equal(escapeDrawtext("a'b"), "'a'\\\\\\''b'", 'quote needs close/escape/reopen');
});

test('a string containing every escape character at once', () => {
  const nasty = "a\\b:c'd%e,f[g]h";
  const escaped = escapeDrawtext(nasty);
  assert.equal(escaped, "'a\\\\\\\\b\\:c'\\\\\\''d\\\\%e\\,f\\[g\\]h'");

  // Reconstructing the original proves nothing was dropped or duplicated.
  const body = escaped.slice(1, -1);
  const decoded = body
    .replaceAll("'\\\\\\''", "\u0000")   // quote placeholder first
    .replaceAll('\\\\\\\\', '\u0001')    // then backslash
    .replaceAll('\\\\%', '%')
    .replaceAll('\\:', ':')
    .replaceAll('\\,', ',')
    .replaceAll('\\[', '[')
    .replaceAll('\\]', ']')
    .replaceAll('\u0000', "'")
    .replaceAll('\u0001', '\\');
  assert.equal(decoded, nasty, 'escaping must be lossless');
});

test('percent is never left bare, so drawtext cannot expand a caption', () => {
  // Unescaped, text '%{eif:1234:d}' renders as "1234" - measured, not assumed.
  const escaped = escapeDrawtext('%{eif:1234:d} and 100% off');
  assert.ok(!/(^|[^\\])%/.test(escaped), `every percent must be escaped: ${escaped}`);
  assert.ok(escaped.includes('\\\\%{eif'), 'the expansion opener must be defused');
});

test('quote-heavy and boundary strings survive', () => {
  assert.equal(escapeDrawtext("'"), "''\\\\\\'''", 'a lone quote');
  assert.equal(escapeDrawtext('\\'), "'\\\\\\\\'", 'a lone backslash');
  assert.equal(escapeDrawtext('end\\'), "'end\\\\\\\\'", 'a trailing backslash must not eat the closing quote');
  assert.ok(escapeDrawtext("it's o'clock").startsWith("'it'"), 'repeated quotes');
  assert.equal(escapeDrawtext('café — 20€'), "'café — 20€'", 'unicode passes through untouched');
  assert.equal(escapeDrawtext('a=b;c'), "'a=b;c'", 'equals and semicolon are literal inside quotes');
});

test('escapeDrawtext refuses a non-string', () => {
  assert.equal(codeOf(() => escapeDrawtext(null)), 'CAPTION_TEXT_INVALID');
  assert.equal(codeOf(() => escapeDrawtext(7)), 'CAPTION_TEXT_INVALID');
});

/* ------------------------------------------------------------------ */
/* buildCaptionFilter                                                  */
/* ------------------------------------------------------------------ */

const cuesFor = style => buildCueList({ text: SENTENCE, durationSeconds: 8, style });

test('every cue gets its own enable window', () => {
  const cues = cuesFor('single-line-center');
  const filter = buildCaptionFilter({ cues, style: 'single-line-center', canvas: REELS, safeArea: REELS_SAFE, fontFile: null });
  const entries = entriesOf(filter);
  assert.equal(entries.length, cues.length);
  entries.forEach((entry, i) => {
    assert.equal(fieldOf(entry, 'enable'),
      `'gte(t,${Number(cues[i].start.toFixed(3))})*lt(t,${Number(cues[i].end.toFixed(3))})'`);
  });
});

test('exactly one cue is live on the frame that lands on a shared boundary', () => {
  // FFmpeg's between() is inclusive at both ends, so an inclusive window makes
  // neighbouring cues BOTH draw on the boundary frame. Verified in ffmpeg
  // 8.1.1: two cues handing over at t=1.0 on a 30fps grid rendered 15163 lit
  // pixels there against 8685 and 11164 for each cue alone.
  const cues = [{ start: 0, end: 1, text: 'AAAA' }, { start: 1, end: 2, text: 'BBBB' }];
  const entries = entriesOf(buildCaptionFilter({ cues, style: 'minimal-lower', canvas: REELS, safeArea: REELS_SAFE }));
  for (const t of [0, 0.5, 0.9999, 1, 1.5, 1.9999]) {
    assert.equal(entries.filter(entry => liveAt(entry, t)).length, 1, `exactly one cue may draw at t=${t}`);
  }
  assert.equal(entries.filter(entry => liveAt(entry, 2)).length, 0, 'nothing draws once the last cue has ended');
});

test('a highlighted cue never draws its accent and settled pass on the same frame', () => {
  const cues = [{ start: 0, end: 2, text: 'HIT ME' }, { start: 2, end: 4, text: 'AGAIN' }];
  const entries = entriesOf(buildCaptionFilter({ cues, style: 'karaoke-bold', canvas: REELS, safeArea: REELS_SAFE }));
  assert.equal(entries.length, 4);
  // 0.9 and 2.9 are the accent/settled handovers, 2 is the cue handover.
  for (const t of [0, 0.89, 0.9, 1.99, 2, 2.9, 3.99]) {
    assert.equal(entries.filter(entry => liveAt(entry, t)).length, 1, `exactly one draw may be live at t=${t}`);
  }
});

test('no cues means no fragment', () => {
  assert.equal(buildCaptionFilter({ cues: [], style: 'karaoke-bold', canvas: REELS, safeArea: REELS_SAFE }), '');
});

test('style none with cues is refused rather than silently dropping them', () => {
  const cues = [{ start: 0, end: 1, text: 'ignored' }];
  assert.equal(codeOf(() => buildCaptionFilter({ cues, style: 'none', canvas: REELS, safeArea: REELS_SAFE })),
    'CAPTION_STYLE_DRAWS_NOTHING');
});

test('placement respects the safe area on 1080x1920 and 1920x1080', () => {
  const canvases = [
    ['1080x1920', REELS, REELS_SAFE],
    ['1920x1080', LONGFORM, LONGFORM_SAFE]
  ];
  const positions = [
    ['lower-third', 'minimal-lower'],
    ['center', 'single-line-center'],
    ['upper-third', 'top-statement']
  ];

  for (const [label, canvas, safe] of canvases) {
    for (const [position, styleId] of positions) {
      assert.equal(CAPTION_STYLES[styleId].position, position, `contract check: ${styleId} sits ${position}`);
      const cues = buildCueList({ text: SENTENCE, durationSeconds: 8, style: styleId });
      const entry = entriesOf(buildCaptionFilter({ cues, style: styleId, canvas, safeArea: safe, fontFile: null }))[0];
      const box = Number(fieldOf(entry, 'boxborderw'));
      const yExpr = fieldOf(entry, 'y');
      const xExpr = fieldOf(entry, 'x');

      // The identity must hold for ANY measured text height, so probe two.
      for (const textH of [40, 137]) {
        const y = evaluate(yExpr, { w: canvas.width, h: canvas.height, textW: 0, textH });
        const boxTop = y - box;
        const boxBottom = y + textH + box;
        assert.ok(boxTop >= safe.top - 1e-9,
          `${label} ${position}: box top ${boxTop} must clear the ${safe.top}px top inset`);
        assert.ok(boxBottom <= canvas.height - safe.bottom + 1e-9,
          `${label} ${position}: box bottom ${boxBottom} must stay above the ${safe.bottom}px bottom inset`);
        if (position === 'lower-third') {
          assert.equal(boxBottom, canvas.height - safe.bottom, `${label}: lower third must sit ON the bottom inset`);
        }
        if (position === 'upper-third') {
          assert.equal(boxTop, safe.top, `${label}: upper third must sit ON the top inset`);
        }
        if (position === 'center') {
          assert.equal(y + textH / 2, canvas.height / 2, `${label}: centre must be the canvas midline`);
        }
      }

      // Horizontal: probe an empty run and the widest run that can be fitted.
      const widest = canvas.width - safe.left - safe.right - 2 * box;
      for (const textW of [0, widest / 2, widest]) {
        const x = evaluate(xExpr, { w: canvas.width, h: canvas.height, textW, textH: 40 });
        assert.ok(x - box >= safe.left - 1e-9,
          `${label} ${position}: box left ${x - box} must clear the ${safe.left}px inset`);
        assert.ok(x + textW + box <= canvas.width - safe.right + 1e-9,
          `${label} ${position}: box right ${x + textW + box} must clear the ${safe.right}px inset`);
      }
    }
  }
});

test('text is centred on the safe area, not the canvas, when insets are lopsided', () => {
  // Shorts-style rail: 60px left, 150px right. Canvas centre is 540; the safe
  // centre is 60 + (1080-60-150)/2 = 495.
  const safe = { top: 160, bottom: 400, left: 60, right: 150 };
  const cues = [{ start: 0, end: 2, text: 'RAIL TEST' }];
  const entry = entriesOf(buildCaptionFilter({ cues, style: 'minimal-lower', canvas: REELS, safeArea: safe }))[0];
  const box = Number(fieldOf(entry, 'boxborderw'));
  const textW = 200;
  const x = evaluate(fieldOf(entry, 'x'), { w: 1080, h: 1920, textW, textH: 40 });
  assert.equal(x + textW / 2, 495, 'text midpoint must be the safe-area midpoint, not 540');
  assert.ok(x + textW + box <= 1080 - 150, 'must not slide under the right-hand rail');
});

test('font size scales with canvas height', () => {
  const cues = [{ start: 0, end: 2, text: 'SHORT' }];
  const small = buildCaptionFilter({ cues, style: 'minimal-lower', canvas: { width: 540, height: 960, fps: 30 }, safeArea: { top: 40, bottom: 40, left: 30, right: 30 } });
  const large = buildCaptionFilter({ cues, style: 'minimal-lower', canvas: REELS, safeArea: REELS_SAFE });
  assert.ok(Number(fieldOf(entriesOf(large)[0], 'fontsize')) > Number(fieldOf(entriesOf(small)[0], 'fontsize')),
    'a taller canvas must get bigger type');
});

test('a cue too wide for the safe area is refused, not shrunk into illegibility', () => {
  const cues = [{ start: 0, end: 2, text: 'x'.repeat(400) }];
  assert.equal(codeOf(() => buildCaptionFilter({ cues, style: 'minimal-lower', canvas: REELS, safeArea: REELS_SAFE })),
    'CAPTION_DOES_NOT_FIT');
});

test('the type is fitted to the safe height, not just the canvas height', () => {
  const cues = [{ start: 0, end: 2, text: 'SHORT' }];
  const sizeIn = safeArea => Number(fieldOf(
    entriesOf(buildCaptionFilter({ cues, style: 'minimal-lower', canvas: REELS, safeArea }))[0], 'fontsize'));

  const band = 160;
  const tight = { top: 880, bottom: 1920 - 880 - band, left: 65, right: 65 };
  const tightSize = sizeIn(tight);
  assert.ok(tightSize < sizeIn(REELS_SAFE), `${tightSize}px must be smaller than the roomy fit`);
  // 1.2em is the module's measured upper bound on drawn line height.
  const drawn = tightSize * 1.2 + 2 * Math.round(tightSize * 0.3);
  assert.ok(drawn <= band, `the drawn box (${drawn}px) must fit the ${band}px safe band`);
});

test('a safe band too short for legible type is refused, not overflowed', () => {
  const cues = [{ start: 0, end: 2, text: 'SHORT' }];
  const safeArea = { top: 945, bottom: 950, left: 65, right: 65 };  // a 25px band
  assert.equal(codeOf(() => buildCaptionFilter({ cues, style: 'minimal-lower', canvas: REELS, safeArea })),
    'CAPTION_DOES_NOT_FIT');
});

test('a centred caption is refused when the canvas midline is outside the safe area', () => {
  // Bottom-heavy overlay: the safe band is [0,520], but a centred caption is
  // pinned to the 960 midline, so it cannot be drawn inside the safe area at
  // any size. An edge-anchored style takes the same safe area happily.
  const safeArea = { top: 0, bottom: 1400, left: 65, right: 65 };
  const cues = [{ start: 0, end: 2, text: 'CENTRED' }];
  assert.equal(codeOf(() => buildCaptionFilter({ cues, style: 'single-line-center', canvas: REELS, safeArea })),
    'CAPTION_DOES_NOT_FIT');
  const lower = entriesOf(buildCaptionFilter({ cues, style: 'minimal-lower', canvas: REELS, safeArea }))[0];
  const box = Number(fieldOf(lower, 'boxborderw'));
  const y = evaluate(fieldOf(lower, 'y'), { w: 1080, h: 1920, textW: 0, textH: 120 });
  assert.equal(y + 120 + box, 520, 'the lower third still sits on the bottom inset');
});

test('every entry carries a readability backing', () => {
  for (const id of ['karaoke-bold', 'single-line-center', 'top-statement', 'minimal-lower']) {
    const filter = buildCaptionFilter({ cues: cuesFor(id), style: id, canvas: REELS, safeArea: REELS_SAFE });
    for (const entry of entriesOf(filter)) {
      assert.ok(entry.includes('box=1'), `${id} entry must set box=1`);
      assert.match(fieldOf(entry, 'boxcolor'), /@0?\.\d+$/, `${id} box must be semi-transparent`);
      assert.ok(Number(fieldOf(entry, 'boxborderw')) > 0, `${id} box must have padding`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Highlight                                                           */
/* ------------------------------------------------------------------ */

test('a highlight style emits more drawtext entries than a plain one', () => {
  const cues = [{ start: 0, end: 1, text: 'ONE' }, { start: 1, end: 2, text: 'TWO' }];
  const plain = entriesOf(buildCaptionFilter({ cues, style: 'single-line-center', canvas: REELS, safeArea: REELS_SAFE }));
  const karaoke = entriesOf(buildCaptionFilter({ cues, style: 'karaoke-bold', canvas: REELS, safeArea: REELS_SAFE }));
  assert.equal(CAPTION_STYLES['karaoke-bold'].highlight, true, 'contract check');
  assert.equal(CAPTION_STYLES['single-line-center'].highlight, false, 'contract check');
  assert.ok(karaoke.length > plain.length, `${karaoke.length} highlighted entries vs ${plain.length} plain`);
  assert.equal(karaoke.length, plain.length * 2, 'one accent draw plus one settled draw per cue');
});

test('the accent draw is larger and a different colour, and the two never overlap', () => {
  const cues = [{ start: 0, end: 2, text: 'HIT ME' }];
  const [accent, settled] = entriesOf(buildCaptionFilter({ cues, style: 'karaoke-bold', canvas: REELS, safeArea: REELS_SAFE }));
  assert.ok(Number(fieldOf(accent, 'fontsize')) > Number(fieldOf(settled, 'fontsize')), 'accent must be larger');
  assert.notEqual(fieldOf(accent, 'fontcolor'), fieldOf(settled, 'fontcolor'), 'accent must be a different colour');

  const window = entry => fieldOf(entry, 'enable').match(/gte\(t,([\d.]+)\)\*lt\(t,([\d.]+)\)/).slice(1).map(Number);
  const [accentFrom, accentTo] = window(accent);
  const [settledFrom, settledTo] = window(settled);
  assert.equal(accentFrom, 0);
  assert.equal(accentTo, settledFrom, 'the accent must hand over to the settled draw with no hole');
  assert.equal(settledTo, 2, 'the pair must cover the whole cue');
});

test('the accent draw also fits inside the safe width', () => {
  const cues = buildCueList({ text: SENTENCE, durationSeconds: 8, style: 'karaoke-bold' });
  const entries = entriesOf(buildCaptionFilter({ cues, style: 'karaoke-bold', canvas: REELS, safeArea: REELS_SAFE }));
  const widest = Math.max(...cues.map(cue => cue.text.length));
  for (const entry of entries) {
    const size = Number(fieldOf(entry, 'fontsize'));
    const box = Number(fieldOf(entry, 'boxborderw'));
    // 0.66em is the measured average advance the module fits against.
    const estimated = size * 0.66 * widest + 2 * box;
    assert.ok(estimated <= REELS.width - REELS_SAFE.left - REELS_SAFE.right + 1,
      `estimated ${estimated}px must fit the 950px safe width`);
  }
});

/* ------------------------------------------------------------------ */
/* Fonts                                                               */
/* ------------------------------------------------------------------ */

test('no font file means no fontfile parameter', () => {
  const cues = [{ start: 0, end: 1, text: 'DEFAULT FONT' }];
  for (const fontFile of [null, undefined, '']) {
    const filter = buildCaptionFilter({ cues, style: 'minimal-lower', canvas: REELS, safeArea: REELS_SAFE, fontFile });
    assert.ok(!filter.includes('fontfile='), `${JSON.stringify(fontFile)} must omit fontfile so FFmpeg picks its default`);
    assert.ok(filter.includes('drawtext='), 'the entry must still be built');
  }
});

test('a font file is escaped, and a Windows path is normalised', () => {
  const cues = [{ start: 0, end: 1, text: 'CUSTOM FONT' }];
  const filter = buildCaptionFilter({
    cues, style: 'minimal-lower', canvas: REELS, safeArea: REELS_SAFE,
    fontFile: 'C:\\Users\\me\\fonts\\Inter-Bold.ttf'
  });
  // The drive colon MUST be escaped or the filter description fails to parse.
  assert.ok(filter.includes("fontfile='C\\:/Users/me/fonts/Inter-Bold.ttf'"), filter.slice(0, 120));
  assert.ok(!filter.includes('\\\\Users'), 'backslashes are normalised away rather than double-escaped');
});

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

test('evidence describes what was burned', () => {
  const cues = buildCueList({ text: SENTENCE, durationSeconds: 8, style: 'karaoke-bold' });
  const evidence = captionEvidence({ cues, style: 'karaoke-bold' });
  assert.deepEqual(Object.keys(evidence).sort(),
    ['coverage', 'cueCount', 'schemaVersion', 'style', 'totalSeconds', 'wordsPerCue']);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.cueCount, cues.length);
  assert.equal(evidence.wordsPerCue, CAPTION_STYLES['karaoke-bold'].wordsPerCue);
  assert.equal(evidence.style, 'karaoke-bold');
  assert.equal(evidence.totalSeconds, 8);
  assert.equal(evidence.coverage, 1, 'exactly tiled cues cover the whole timeline');
});

test('evidence reports a hole instead of claiming full coverage', () => {
  const gapped = [{ start: 0, end: 1, text: 'one' }, { start: 3, end: 4, text: 'two' }];
  const evidence = captionEvidence({ cues: gapped, style: 'minimal-lower' });
  assert.equal(evidence.totalSeconds, 2);
  assert.equal(evidence.coverage, 0.5, '2 seconds of cue across a 4 second span');
});

test('evidence refuses a cue list it cannot honestly measure', () => {
  // A backwards cue used to be summed straight into the report: -4 seconds of
  // caption and -4 coverage, a measurement of something that cannot happen.
  const style = 'minimal-lower';
  assert.equal(codeOf(() => captionEvidence({ cues: [{ start: 5, end: 1, text: 'backwards' }], style })), 'CAPTION_CUES_INVALID');
  assert.equal(codeOf(() => captionEvidence({ cues: [{ start: 0, end: NaN, text: 'nan' }], style })), 'CAPTION_CUES_INVALID');
  assert.equal(codeOf(() => captionEvidence({ cues: [{ start: 0, end: 1 }], style })), 'CAPTION_CUES_INVALID');
  assert.equal(codeOf(() => captionEvidence({ cues: 'not an array', style })), 'CAPTION_CUES_INVALID');
});

test('evidence for no captions is empty, not fabricated', () => {
  const evidence = captionEvidence({ cues: [], style: 'none' });
  assert.equal(evidence.cueCount, 0);
  assert.equal(evidence.totalSeconds, 0);
  assert.equal(evidence.coverage, 0);
  assert.equal(evidence.wordsPerCue, 0);
});

/* ------------------------------------------------------------------ */
/* Contract sweep                                                      */
/* ------------------------------------------------------------------ */

test('every declared caption style round-trips through the whole module', () => {
  for (const id of Object.keys(CAPTION_STYLES)) {
    const cues = buildCueList({ text: SENTENCE, durationSeconds: 9, style: id });
    const filter = buildCaptionFilter({ cues, style: id, canvas: REELS, safeArea: REELS_SAFE, fontFile: null });
    const evidence = captionEvidence({ cues, style: id });
    if (CAPTION_STYLES[id].position === 'none') {
      assert.equal(cues.length, 0, `${id} draws nothing`);
      assert.equal(filter, '');
      assert.equal(evidence.coverage, 0);
      continue;
    }
    assert.ok(cues.length > 0, `${id} must produce cues`);
    assert.ok(filter.startsWith('drawtext='), `${id} must produce a joinable fragment`);
    assert.equal(evidence.coverage, 1, `${id} must cover the beat`);
    assert.equal(evidence.cueCount, cues.length);
  }
});

test('a resolved plan.captionStyle object works as well as an id', () => {
  const fromPlan = { id: 'karaoke-bold', ...CAPTION_STYLES['karaoke-bold'] };
  const byObject = buildCueList({ text: SENTENCE, durationSeconds: 8, style: fromPlan });
  const byId = buildCueList({ text: SENTENCE, durationSeconds: 8, style: 'karaoke-bold' });
  assert.deepEqual(byObject, byId);
  assert.equal(captionEvidence({ cues: byObject, style: fromPlan }).style, 'karaoke-bold');
});
