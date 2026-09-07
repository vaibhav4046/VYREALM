import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CAMERA_PRESETS,
  SPEED_RAMPS,
  LOOK_PRESETS,
  TRANSITIONS,
  LIGHTING_PRESETS,
  EASINGS,
  buildEasingExpression,
  resolvePreset,
  presetCounts,
  validateAllPresets,
  SCHEMA_VERSION
} from './format-presets.mjs';

const FFMPEG = process.env.VYRELUM_FFMPEG ||
  join(dirname(dirname(fileURLToPath(import.meta.url))), 'workers/tools/ffmpeg.exe');

/**
 * Evaluate one of our easing expressions in JS.
 *
 * The whitelist is half the point: the expressions must stay pure arithmetic
 * over `on`, because anything else (a comma, a function call) is what breaks
 * an unquoted filtergraph. If this regex ever fails, the expression is no
 * longer safe to paste into a filter option, whatever the maths says.
 */
function evaluateEasing(expression, on) {
  assert.match(expression, /^[0-9on()+\-*/. ]+$/, `not pure arithmetic over on: ${expression}`);
  const js = expression.replace(/\bon\b/g, `(${on})`);
  return Function(`"use strict";return (${js});`)();
}

const NEAR = 1e-9;

test('tables meet the declared minimum counts', () => {
  const counts = presetCounts();
  assert.equal(counts.cameras, Object.keys(CAMERA_PRESETS).length);
  assert.ok(counts.cameras >= 40, `cameras ${counts.cameras}`);
  assert.ok(counts.ramps >= 8, `ramps ${counts.ramps}`);
  assert.ok(counts.looks >= 20, `looks ${counts.looks}`);
  assert.ok(counts.transitions >= 12, `transitions ${counts.transitions}`);
  assert.ok(counts.lighting >= 8, `lighting ${counts.lighting}`);
});

test('camera categories cover basic, epic, handheld and product-orbit', () => {
  const seen = new Set(Object.values(CAMERA_PRESETS).map(entry => entry.category));
  for (const category of ['basic', 'epic', 'handheld', 'product-orbit']) {
    assert.ok(seen.has(category), `missing category ${category}`);
  }
});

test('validateAllPresets passes on the shipped data and returns evidence', () => {
  const evidence = validateAllPresets();
  assert.equal(evidence.schemaVersion, SCHEMA_VERSION);
  assert.equal(
    evidence.checked,
    Object.keys(CAMERA_PRESETS).length + Object.keys(SPEED_RAMPS).length +
    Object.keys(LOOK_PRESETS).length + Object.keys(TRANSITIONS).length +
    Object.keys(LIGHTING_PRESETS).length
  );
  assert.deepEqual(
    { cameras: evidence.cameras, ramps: evidence.ramps, looks: evidence.looks, transitions: evidence.transitions, lighting: evidence.lighting },
    presetCounts()
  );
});

test('easing curves run 0 to 1 and never go backwards', () => {
  const frames = 60;
  for (const easing of EASINGS) {
    const expression = buildEasingExpression(easing, frames);
    assert.ok(Math.abs(evaluateEasing(expression, 0)) < NEAR, `${easing} does not start at 0`);
    assert.ok(Math.abs(evaluateEasing(expression, frames) - 1) < NEAR, `${easing} does not end at 1`);

    let previous = -Infinity;
    for (let on = 0; on <= frames; on += 1) {
      const value = evaluateEasing(expression, on);
      assert.ok(value >= previous - NEAR, `${easing} goes backwards at on=${on}`);
      assert.ok(value >= -NEAR && value <= 1 + NEAR, `${easing} leaves 0..1 at on=${on}: ${value}`);
      previous = value;
    }
  }
});

test('each easing bends the way its name claims', () => {
  const frames = 100;
  const at = (easing, on) => evaluateEasing(buildEasingExpression(easing, frames), on);

  // linear is exactly progress, at any frame count.
  assert.ok(Math.abs(at('linear', 25) - 0.25) < NEAR);
  assert.ok(Math.abs(evaluateEasing(buildEasingExpression('linear', 30), 15) - 0.5) < NEAR);

  // ease-in starts slow: behind linear everywhere in between.
  assert.ok(at('ease-in', 50) < 0.5 - 0.05, `ease-in mid ${at('ease-in', 50)}`);
  // ease-out starts fast: ahead of linear.
  assert.ok(at('ease-out', 50) > 0.5 + 0.05, `ease-out mid ${at('ease-out', 50)}`);
  // ease-in-out is an S: symmetric about the midpoint, slow at both ends.
  assert.ok(Math.abs(at('ease-in-out', 50) - 0.5) < NEAR, `ease-in-out mid ${at('ease-in-out', 50)}`);
  assert.ok(at('ease-in-out', 20) < 0.2, `ease-in-out should lag early: ${at('ease-in-out', 20)}`);
  assert.ok(at('ease-in-out', 80) > 0.8, `ease-in-out should lead late: ${at('ease-in-out', 80)}`);
  assert.ok(Math.abs(at('ease-in-out', 20) + at('ease-in-out', 80) - 1) < NEAR, 'ease-in-out is not symmetric');
});

test('easing expressions carry no filtergraph metacharacter', () => {
  // A comma in an unquoted filter option splits the filterchain; a colon
  // splits options. Either one turns a valid graph into a parse error, so the
  // expressions must be safe to paste anywhere, not just inside quotes.
  for (const easing of EASINGS) {
    const expression = buildEasingExpression(easing, 48);
    for (const forbidden of [',', ':', "'", '"', '\\', '[', ']', ';', '=']) {
      assert.ok(!expression.includes(forbidden),
        `${easing} contains ${JSON.stringify(forbidden)}: ${expression}`);
    }
    assert.ok(expression.includes(`on/48`), `${easing} is not normalised over frames: ${expression}`);
  }
});

test('buildEasingExpression refuses a bad easing or frame count', () => {
  assert.throws(() => buildEasingExpression('bounce', 30), error => error.code === 'UNKNOWN_EASING');
  assert.throws(() => buildEasingExpression('linear', 0), error => error.code === 'INVALID_FRAME_COUNT');
  assert.throws(() => buildEasingExpression('linear', -30), error => error.code === 'INVALID_FRAME_COUNT');
  assert.throws(() => buildEasingExpression('linear', 12.5), error => error.code === 'INVALID_FRAME_COUNT');
  // seconds passed where frames belong stays undetectable by design, but a
  // non-number must not sneak through as a string concatenation.
  assert.throws(() => buildEasingExpression('linear', '60'), error => error.code === 'INVALID_FRAME_COUNT');
});

test('resolvePreset returns the entry and throws UNKNOWN_PRESET for a bad id', () => {
  assert.equal(resolvePreset('camera', 'whip-pan'), CAMERA_PRESETS['whip-pan']);
  assert.equal(resolvePreset('lighting', 'rembrandt'), LIGHTING_PRESETS.rembrandt);

  assert.throws(
    () => resolvePreset('camera', 'moon-shot'),
    error => error.code === 'UNKNOWN_PRESET' && error.validIds.includes('whip-pan')
  );
  assert.throws(() => resolvePreset('lens', 'anamorphic'), error => error.code === 'UNKNOWN_PRESET_KIND');
});

test('prototype keys resolve as neither a preset nor a preset kind', () => {
  // Object.prototype members are reachable by name on any plain object; if
  // either lookup falls through to one, resolvePreset returns something that
  // is not a preset at all instead of throwing.
  for (const key of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__', 'length']) {
    assert.throws(() => resolvePreset('camera', key), error => error.code === 'UNKNOWN_PRESET', `id ${key}`);
    assert.throws(() => resolvePreset(key, 'name'), error => error.code === 'UNKNOWN_PRESET_KIND', `kind ${key}`);
  }
});

test('range validation catches an injected out-of-range preset', () => {
  const doctored = {
    camera: { ...CAMERA_PRESETS, 'warp-drive': { ...CAMERA_PRESETS['zoom-in'], zoom: 4 } },
    ramp: SPEED_RAMPS,
    look: LOOK_PRESETS,
    transition: TRANSITIONS,
    lighting: LIGHTING_PRESETS
  };
  assert.throws(
    () => validateAllPresets(doctored),
    error => error.code === 'PRESET_OUT_OF_RANGE' && error.id === 'warp-drive' && error.field === 'zoom'
  );

  const badLook = {
    ...doctored,
    camera: CAMERA_PRESETS,
    look: { ...LOOK_PRESETS, blown: { ...LOOK_PRESETS.realistic, saturation: 9 } }
  };
  assert.throws(() => validateAllPresets(badLook), error => error.code === 'PRESET_OUT_OF_RANGE' && error.field === 'saturation');

  const badRamp = {
    ...doctored,
    camera: CAMERA_PRESETS,
    ramp: { ...SPEED_RAMPS, stalled: { label: 'Stalled', curve: [1, 0] } }
  };
  assert.throws(() => validateAllPresets(badRamp), error => error.code === 'PRESET_OUT_OF_RANGE' && error.id === 'stalled');

  // A missing table is a coded refusal, not a crash or a silent zero count.
  assert.throws(() => validateAllPresets({ ...doctored, camera: undefined }), error => error.code === 'PRESET_KIND_MISSING');
});

test('every transition that needs an xfade has one, and cuts do not', () => {
  for (const [id, entry] of Object.entries(TRANSITIONS)) {
    if (entry.kind === 'cut') {
      assert.equal(entry.xfadeName, undefined, `${id} is a cut but carries an xfadeName`);
      assert.equal(entry.durationSeconds, 0, `${id} is a cut with a non-zero duration`);
      continue;
    }
    assert.equal(typeof entry.xfadeName, 'string', `${id} (${entry.kind}) has no xfadeName`);
    assert.ok(entry.xfadeName.length > 0, `${id} has an empty xfadeName`);
    assert.ok(entry.durationSeconds > 0, `${id} has a non-positive duration`);
  }
});

test('every shipped xfadeName exists in the real FFmpeg build', t => {
  // The whole honesty claim of TRANSITIONS is that each name renders. A typo
  // or an invented name would only surface mid-render, one clip at a time, so
  // ask the binary that will run it.
  if (!existsSync(FFMPEG)) {
    t.skip(`ffmpeg not found at ${FFMPEG} — xfade names UNVERIFIED in this run`);
    return;
  }
  const help = execFileSync(FFMPEG, ['-hide_banner', '-h', 'filter=xfade'], { encoding: 'utf8' });
  const section = help.slice(help.indexOf('set cross fade transition'));
  const known = new Set(
    section.split('\n')
      .map(line => /^\s{5}(\S+)\s+-?\d+\s/.exec(line)?.[1])
      .filter(Boolean)
  );
  assert.ok(known.size > 20, `parsed only ${known.size} xfade names — parser is wrong, not the data`);
  assert.ok(known.has('dissolve') && known.has('wipeleft'), 'xfade name parse looks wrong');

  for (const [id, entry] of Object.entries(TRANSITIONS)) {
    if (entry.kind === 'cut') continue;
    assert.ok(known.has(entry.xfadeName), `transition ${id} names xfade "${entry.xfadeName}", which this FFmpeg does not have`);
  }
});

test('easing expressions survive an unquoted filtergraph', t => {
  // The strictest embedding: straight into a filter option with no quotes.
  // This is what a comma would break, and it is the real parser saying so.
  if (!existsSync(FFMPEG)) {
    t.skip(`ffmpeg not found at ${FFMPEG} — filtergraph safety UNVERIFIED in this run`);
    return;
  }
  for (const easing of EASINGS) {
    const expression = buildEasingExpression(easing, 30);
    const filter = `zoompan=z=1+0.5*${expression}:d=1:s=64x64,setsar=1,format=yuv420p`;
    execFileSync(FFMPEG, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=30:duration=0.1',
      '-vf', filter, '-frames:v', '2', '-f', 'null', '-'
    ], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
  }
});

test('speed ramp curves are playback rates, never zero or negative', () => {
  for (const [id, entry] of Object.entries(SPEED_RAMPS)) {
    assert.ok(Array.isArray(entry.curve) && entry.curve.length >= 2, `${id} curve too short`);
    for (const rate of entry.curve) assert.ok(rate > 0 && rate <= 8, `${id} rate ${rate}`);
  }
});
