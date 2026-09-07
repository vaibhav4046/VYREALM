import assert from 'node:assert/strict';
import test from 'node:test';
import { beatFilter, assertRenderable } from './format-render.mjs';
import { CAMERA_MOVES, GRADES } from './format-library.mjs';

const base = { grade: 'neutral', width: 1080, height: 1920, fps: 30, durationSeconds: 5 };

test('every camera move produces a filter chain', () => {
  for (const move of Object.keys(CAMERA_MOVES)) {
    const filter = beatFilter({ ...base, move });
    assert.ok(filter.includes('zoompan='), `${move} must zoompan`);
    assert.ok(filter.includes('format=yuv420p'), `${move} must end in a playable pixel format`);
  }
});

test('frame rate is converted before zoompan', () => {
  // zoompan with d=1 emits one output frame per INPUT frame; its fps option
  // only labels the stream. Without a prior fps filter a 24fps source yields
  // 0.8x the requested duration.
  const filter = beatFilter({ ...base, move: 'push-in' });
  assert.ok(filter.startsWith('fps=30'), `chain must start with fps conversion, got: ${filter.slice(0, 40)}`);
  assert.ok(filter.indexOf('fps=30') < filter.indexOf('zoompan='), 'fps must precede zoompan');
});

test('push-in zoom increases and pull-out zoom decreases over the beat', () => {
  const frames = base.fps * base.durationSeconds;
  const pushIn = beatFilter({ ...base, move: 'push-in' });
  const pullOut = beatFilter({ ...base, move: 'pull-out' });

  const zoomOf = filter => filter.match(/z='([^']+)'/)[1];
  const evaluate = (expr, on) => {
    const replaced = expr.replaceAll('on', String(on));
    // Expressions are of the form  1+0.08*on/150  or  1.08-0.08*on/150
    return Function(`"use strict";return (${replaced})`)();
  };

  const inStart = evaluate(zoomOf(pushIn), 0);
  const inEnd = evaluate(zoomOf(pushIn), frames);
  assert.ok(inEnd > inStart, `push-in must grow: ${inStart} -> ${inEnd}`);

  const outStart = evaluate(zoomOf(pullOut), 0);
  const outEnd = evaluate(zoomOf(pullOut), frames);
  assert.ok(outEnd < outStart, `pull-out must shrink: ${outStart} -> ${outEnd}`);
  assert.ok(outEnd >= 1, 'zoompan requires zoom >= 1');
  assert.ok(outStart > 1, 'pull-out must start wider than 1.0, otherwise it is static');
});

test('a static hold does not drift', () => {
  const filter = beatFilter({ ...base, move: 'hold' });
  const zoom = filter.match(/z='([^']+)'/)[1];
  assert.ok(!zoom.includes('on'), `hold must not vary with frame index, got ${zoom}`);
});

test('grades with grain and temperature add their filters', () => {
  const vintage = beatFilter({ ...base, move: 'hold', grade: 'film-vintage' });
  assert.ok(vintage.includes('noise='), 'film-vintage declares grain');
  assert.ok(vintage.includes('colorbalance='), 'film-vintage declares temperature');

  const neutral = beatFilter({ ...base, move: 'hold', grade: 'neutral' });
  assert.ok(!neutral.includes('noise='), 'neutral declares no grain');
  assert.ok(!neutral.includes('colorbalance='), 'neutral declares no temperature shift');
});

test('every declared grade is renderable', () => {
  for (const grade of Object.keys(GRADES)) {
    assert.doesNotThrow(() => beatFilter({ ...base, move: 'hold', grade }), `grade ${grade}`);
  }
});

test('unknown camera move and grade are rejected', () => {
  assert.throws(() => beatFilter({ ...base, move: 'barrel-roll' }), /unknown camera move/);
  assert.throws(() => beatFilter({ ...base, move: 'hold', grade: 'technicolor' }), /unknown grade/);
});

test('a plan with an unresolved shot role is refused before FFmpeg runs', () => {
  const plan = { timeline: [{ shotRole: 'hero', motion: 'hold', durationSeconds: 2, role: 'a' }] };
  assert.throws(() => assertRenderable(plan, {}), /PLAN_NOT_RENDERABLE/);
});

test('a plan referencing a missing file is refused', () => {
  const plan = { timeline: [{ shotRole: 'hero', motion: 'hold', durationSeconds: 2, role: 'a' }] };
  assert.throws(
    () => assertRenderable(plan, { hero: { path: 'C:/definitely/not/here.mp4' } }),
    /missing file/
  );
});

test('a black beat needs no source asset', () => {
  const plan = { timeline: [{ shotRole: 'black', motion: 'hold', durationSeconds: 2, role: 'a' }] };
  assert.doesNotThrow(() => assertRenderable(plan, {}));
});

test('an empty plan is refused', () => {
  assert.throws(() => assertRenderable({ timeline: [] }, {}), /PLAN_EMPTY/);
});
