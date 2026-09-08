import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  planAudioSources,
  buildAudioFilter,
  silentTrackArgs,
  audioEvidence,
  duckRatio,
  DUCK_KEY_LEVEL_DB,
  SAMPLE_RATE,
  TRUE_PEAK_DBTP
} from './format-audio.mjs';
import { AUDIO_BEDS } from './format-library.mjs';

const KINDS = ['music', 'narration', 'ambience'];
const BED_IDS = Object.keys(AUDIO_BEDS);

/** FFmpeg inputs for exactly the streams a bed requires, starting at index 1 (0 is the video). */
const inputsFor = (bedId, start = 1) =>
  KINDS.filter(kind => AUDIO_BEDS[bedId][kind]).map((kind, offset) => ({ kind, index: start + offset }));

const pathsFor = bedId =>
  Object.fromEntries(KINDS.filter(kind => AUDIO_BEDS[bedId][kind]).map(kind => [`${kind}Path`, `C:/fake/${kind}.wav`]));

/** node:assert's throws() returns nothing, and every refusal here is checked by code. */
function thrown(fn) {
  try { fn(); } catch (error) { return error; }
  return assert.fail('expected a coded refusal, nothing was thrown');
}

const chainsOf = filter => filter.split(';');
const leadLabels = chain => (chain.match(/^(\[[^\]]+\])+/)?.[0] ?? '').match(/\[([^\]]+)\]/g)?.map(s => s.slice(1, -1)) ?? [];
const tailLabels = chain => (chain.match(/(\[[^\]]+\])+$/)?.[0] ?? '').match(/\[([^\]]+)\]/g)?.map(s => s.slice(1, -1)) ?? [];

/** Every label a chain consumes must be an input pad or a label some chain produces. */
function assertGraphWiring(filter) {
  const produced = new Set();
  for (const chain of chainsOf(filter)) {
    // A chain that is only labels would mean a stray token; every chain has a filter.
    assert.ok(chain.replace(/(^(\[[^\]]+\])+)|((\[[^\]]+\])+$)/g, '').length > 0, `empty chain in ${filter}`);
    for (const label of tailLabels(chain)) {
      assert.ok(!produced.has(label), `label ${label} produced twice`);
      produced.add(label);
    }
  }
  const consumed = new Set();
  for (const chain of chainsOf(filter)) {
    for (const label of leadLabels(chain)) {
      assert.ok(!consumed.has(label), `label ${label} consumed twice`);
      consumed.add(label);
      if (/^\d+:a$/.test(label)) continue;
      assert.ok(produced.has(label), `chain consumes undefined label ${label} in ${filter}`);
    }
  }
  assert.ok(produced.has('aout'), 'graph must produce [aout]');
  assert.ok(!consumed.has('aout'), '[aout] must be the terminal label');
  for (const label of produced) {
    if (label === 'aout') continue;
    assert.ok(consumed.has(label), `label ${label} is produced but never used`);
  }
}

test('every audio bed builds a wired graph that lands on its own target loudness', () => {
  assert.equal(BED_IDS.length, 5, `expected the five documented beds, got ${BED_IDS.join(', ')}`);
  for (const bedId of BED_IDS) {
    const bed = AUDIO_BEDS[bedId];
    const { filter, outLabel, inputArgs } = buildAudioFilter({ bed, inputs: inputsFor(bedId), durationSeconds: 12 });
    assert.equal(outLabel, 'aout', `${bedId} out label`);
    // Documented as empty for every bed, and callers splice it unconditionally.
    assert.deepEqual(inputArgs, [], `${bedId} inputArgs must be empty`);
    assert.ok(filter.includes(`loudnorm=I=${bed.targetLufs}:TP=${TRUE_PEAK_DBTP}:`), `${bedId} must normalise to ${bed.targetLufs} LUFS, got: ${filter}`);
    assert.ok(filter.endsWith('[aout]'), `${bedId} must end on [aout]`);
    assertGraphWiring(filter);
  }
});

test('loudnorm appears exactly once and carries the bed target, not a shared default', () => {
  const targets = new Set();
  for (const bedId of BED_IDS) {
    const { filter } = buildAudioFilter({ bed: bedId, inputs: inputsFor(bedId), durationSeconds: 8 });
    assert.equal(filter.match(/loudnorm=/g).length, 1, `${bedId} must normalise once`);
    targets.add(filter.match(/loudnorm=I=(-?[\d.]+)/)[1]);
  }
  // -14, -16 and -20 are all in the library; a single value would mean the bed was ignored.
  assert.ok(targets.size >= 3, `beds must keep distinct targets, saw ${[...targets].join(', ')}`);
});

test('music-only bed mixes nothing and ducks nothing', () => {
  const { filter } = buildAudioFilter({ bed: 'music-drive', inputs: [{ kind: 'music', index: 1 }], durationSeconds: 10 });
  assert.ok(filter.includes('[1:a]'), 'music input must be consumed');
  assert.ok(!filter.includes('sidechaincompress'), 'no narration means no ducking');
  assert.ok(!filter.includes('amix'), 'a single stream needs no mixer');
  assert.ok(filter.includes('aloop=loop=-1'), 'a short music bed must loop, not run out');
  assertGraphWiring(filter);
});

test('narration over music ducks with sidechaincompress keyed off the voice', () => {
  const bedId = 'narration-music';
  const { filter } = buildAudioFilter({ bed: bedId, inputs: inputsFor(bedId), durationSeconds: 15 });
  assert.ok(filter.includes('sidechaincompress'), `expected a duck stage, got: ${filter}`);
  assert.ok(filter.includes('asplit=2[narration][narration_key]'), 'narration must feed both the mix and the key');
  assert.match(filter, /\[music\]\[narration_key\]sidechaincompress/, 'the music is compressed, keyed by the narration');
  assert.ok(filter.includes('amix=inputs=2'), 'ducked music and narration must be mixed');
  assert.ok(filter.includes('normalize=0'), 'amix must sum, not divide by stream count');
  assertGraphWiring(filter);
});

/**
 * This bed is the reason ambience is duckable at all. It pairs narration with
 * ambience and no music, so while DUCKABLE was music-only its declared -6 dB
 * went unapplied while the evidence still advertised it — a stated reduction
 * the graph never performed, across seven formats.
 */
test('narration-clean ducks its ambience under the voice, delivering the stated duckDb', () => {
  const bedId = 'narration-clean';
  assert.equal(AUDIO_BEDS[bedId].music, false, 'guard: this bed has no music, so ambience is the only thing to duck');
  assert.ok(AUDIO_BEDS[bedId].duckDb < 0, 'guard: the bed states a duck target');
  const { filter } = buildAudioFilter({ bed: bedId, inputs: inputsFor(bedId), durationSeconds: 15 });
  assert.ok(filter.includes('sidechaincompress'), `the declared duck must reach the graph, got: ${filter}`);
  assert.ok(filter.includes('[ambience_ducked]'), 'ambience is the layer that ducks');
  assert.ok(filter.includes('asplit'), 'narration must fork to provide the sidechain key');
  assert.ok(filter.includes('amix=inputs=2'), 'narration and ducked ambience still mix');
  assert.ok(!filter.includes('[narration_ducked]'), 'the voice is the key and must never duck itself');
  assertGraphWiring(filter);
});

test('duck ratio grows with the requested reduction and stays inside FFmpeg range', () => {
  assert.ok(duckRatio(-12) > duckRatio(-6), 'a deeper duck needs a harder ratio');
  for (const db of [0, -3, -6, -12, -18, -24, -40]) {
    const ratio = duckRatio(db);
    assert.ok(ratio >= 1 && ratio <= 20, `ratio ${ratio} for ${db} dB is outside FFmpeg's 1..20`);
  }
  assert.equal(duckRatio(0), 1, 'no requested reduction means no compression');
});

test('a missing required source throws AUDIO_SOURCE_MISSING and names what is missing', () => {
  const error = thrown(() => buildAudioFilter({ bed: 'narration-music', inputs: [{ kind: 'music', index: 1 }], durationSeconds: 15 }));
  assert.equal(error.code, 'AUDIO_SOURCE_MISSING');
  assert.match(error.message, /AUDIO_SOURCE_MISSING: bed requires narration/);
  assert.deepEqual(error.missing, ['narration']);

  for (const bedId of BED_IDS) {
    const required = inputsFor(bedId);
    if (!required.length) continue;
    for (const dropped of required) {
      const partial = required.filter(input => input !== dropped);
      const err = thrown(() => buildAudioFilter({ bed: bedId, inputs: partial, durationSeconds: 9 }));
      assert.equal(err.code, 'AUDIO_SOURCE_MISSING', `${bedId} without ${dropped.kind}`);
      assert.deepEqual(err.missing, [dropped.kind]);
    }
  }
});

test('a stream the bed does not use is refused rather than dropped', () => {
  const error = thrown(() => buildAudioFilter({ bed: 'music-drive', inputs: [{ kind: 'music', index: 1 }, { kind: 'narration', index: 2 }], durationSeconds: 10 }));
  assert.equal(error.code, 'AUDIO_STREAM_NOT_IN_BED');
  assert.equal(error.kind, 'narration');
});

test('malformed inputs and durations are refused with codes', () => {
  const bed = 'music-drive';
  const ok = [{ kind: 'music', index: 1 }];
  assert.equal(thrown(() => buildAudioFilter({ bed, inputs: [{ kind: 'stinger', index: 1 }], durationSeconds: 5 })).code, 'AUDIO_INPUT_INVALID');
  assert.equal(thrown(() => buildAudioFilter({ bed, inputs: [{ kind: 'music', index: -1 }], durationSeconds: 5 })).code, 'AUDIO_INPUT_INVALID');
  assert.equal(thrown(() => buildAudioFilter({ bed, inputs: [{ kind: 'music', index: 1.5 }], durationSeconds: 5 })).code, 'AUDIO_INPUT_INVALID');
  assert.equal(thrown(() => buildAudioFilter({ bed, inputs: [...ok, { kind: 'music', index: 2 }], durationSeconds: 5 })).code, 'AUDIO_INPUT_INVALID');
  assert.equal(thrown(() => buildAudioFilter({ bed, inputs: ok, durationSeconds: 0 })).code, 'AUDIO_DURATION_INVALID');
  assert.equal(thrown(() => buildAudioFilter({ bed, inputs: ok, durationSeconds: NaN })).code, 'AUDIO_DURATION_INVALID');
  assert.equal(thrown(() => buildAudioFilter({ bed: 'no-such-bed', inputs: [], durationSeconds: 5 })).code, 'AUDIO_BED_UNKNOWN');
  assert.equal(thrown(() => buildAudioFilter({ bed: { music: 'yes' }, inputs: [], durationSeconds: 5 })).code, 'AUDIO_BED_INVALID');

  // loudnorm only accepts I between -70 and -5; a target outside that builds a
  // graph FFmpeg rejects, so it has to be refused here rather than at render.
  const custom = { music: false, narration: false, ambience: false, duckDb: 0, targetLufs: -3 };
  assert.equal(thrown(() => buildAudioFilter({ bed: custom, inputs: [], durationSeconds: 5 })).code, 'AUDIO_BED_INVALID');
  assert.equal(thrown(() => buildAudioFilter({ bed: { ...custom, targetLufs: -90 }, inputs: [], durationSeconds: 5 })).code, 'AUDIO_BED_INVALID');
  assert.ok(buildAudioFilter({ bed: { ...custom, targetLufs: -16 }, inputs: [], durationSeconds: 5 }).filter.includes('loudnorm=I=-16'));
});

test('every branch is pinned to the exact plan duration', () => {
  // 1.0006 stamps as 1.001: the loop buffer must cover the rounded trim window,
  // not the raw duration, or the tail of the cut falls out of the loop.
  for (const durationSeconds of [8, 12.5, 1.333, 1.0006]) {
    const bedId = 'narration-music';
    const { filter } = buildAudioFilter({ bed: bedId, inputs: inputsFor(bedId), durationSeconds });
    const stamp = String(Number(durationSeconds.toFixed(3)));
    const trims = filter.match(/atrim=duration=[\d.]+/g);
    const pads = filter.match(/apad=whole_dur=[\d.]+/g);
    assert.equal(trims.length, 3, 'music, narration and the output are each trimmed');
    assert.equal(pads.length, 3, 'and each padded back up');
    for (const trim of trims) assert.equal(trim, `atrim=duration=${stamp}`);
    for (const pad of pads) assert.equal(pad, `apad=whole_dur=${stamp}`);
    // A loop buffer smaller than the cut could not cover it.
    const loopSize = Number(filter.match(/aloop=loop=-1:size=(\d+)/)[1]);
    assert.ok(loopSize >= Number(stamp) * SAMPLE_RATE, `loop buffer ${loopSize} cannot cover the ${stamp}s trim window`);
  }
});

test('the silent bed still carries a real silent stream', () => {
  const bed = AUDIO_BEDS['silent-caption'];
  assert.deepEqual([bed.music, bed.narration, bed.ambience], [false, false, false], 'guard: silent bed has no sources');
  const { filter } = buildAudioFilter({ bed: 'silent-caption', inputs: [], durationSeconds: 7 });
  assert.ok(filter.includes('anullsrc='), `silence must be synthesised, got: ${filter}`);
  assert.ok(filter.includes(`loudnorm=I=${bed.targetLufs}`), 'the silent bed still declares its target');
  assert.ok(!filter.includes(':a]'), 'no file inputs are consumed');
  assertGraphWiring(filter);
});

test('silentTrackArgs synthesises a standalone silent input', () => {
  assert.deepEqual(silentTrackArgs(6), ['-f', 'lavfi', '-t', '6', '-i', `anullsrc=channel_layout=stereo:sample_rate=${SAMPLE_RATE}`]);
  assert.deepEqual(silentTrackArgs(2.5, 44100).slice(-1), ['anullsrc=channel_layout=stereo:sample_rate=44100']);
  assert.equal(silentTrackArgs(2.5, 44100)[3], '2.5');
  assert.equal(thrown(() => silentTrackArgs(0)).code, 'AUDIO_DURATION_INVALID');
  assert.equal(thrown(() => silentTrackArgs(5, 100)).code, 'AUDIO_SAMPLE_RATE_INVALID');
});

test('planAudioSources reports what the bed needs and what is absent', () => {
  for (const bedId of BED_IDS) {
    const bed = AUDIO_BEDS[bedId];
    const full = planAudioSources(bed, pathsFor(bedId));
    assert.deepEqual(full.missing, [], `${bedId} with every path supplied`);
    for (const kind of KINDS) {
      assert.equal(Boolean(full[kind]), bed[kind], `${bedId} ${kind} presence must follow the bed`);
    }
    const empty = planAudioSources(bedId, {});
    assert.deepEqual(empty.missing, KINDS.filter(kind => bed[kind]), `${bedId} with nothing supplied`);
  }
});

test('planAudioSources will not smuggle in a stream the bed does not use', () => {
  const sources = planAudioSources('music-drive', { musicPath: 'a.wav', narrationPath: 'b.wav', ambiencePath: 'c.wav' });
  assert.equal(sources.music, 'a.wav');
  assert.equal(sources.narration, null, 'this bed has no narration, so none is planned');
  assert.equal(sources.ambience, null);
  assert.deepEqual(sources.missing, []);
});

test('audioEvidence records the real mix and refuses an impossible one', () => {
  const bedId = 'narration-music';
  const evidence = audioEvidence({ bed: { id: bedId, ...AUDIO_BEDS[bedId] }, inputs: inputsFor(bedId), durationSeconds: 15 });
  assert.deepEqual(evidence, {
    schemaVersion: 1,
    bedId,
    streams: [{ kind: 'music', inputIndex: 1 }, { kind: 'narration', inputIndex: 2 }],
    targetLufs: -14,
    duckDb: -12,
    ducked: ['music'],
    durationSeconds: 15
  });

  const silent = audioEvidence({ bed: 'silent-caption', inputs: [], durationSeconds: 7 });
  assert.deepEqual(silent.streams, []);
  assert.equal(silent.targetLufs, -20);
  assert.deepEqual(silent.ducked, []);

  // The bed asks for -6 dB and ambience delivers it: evidence must name the layer.
  const clean = audioEvidence({ bed: 'narration-clean', inputs: inputsFor('narration-clean'), durationSeconds: 15 });
  assert.equal(clean.duckDb, -6, 'guard: this bed states a duck target');
  assert.deepEqual(clean.ducked, ['ambience'], 'ambience ducks, so evidence must say so');
  const cleanFilter = buildAudioFilter({ bed: 'narration-clean', inputs: inputsFor('narration-clean'), durationSeconds: 15 }).filter;
  assert.equal(cleanFilter.includes('sidechaincompress'), clean.ducked.length > 0, 'evidence must agree with the graph');

  const error = thrown(() => audioEvidence({ bed: bedId, inputs: [{ kind: 'music', index: 1 }], durationSeconds: 15 }));
  assert.equal(error.code, 'AUDIO_SOURCE_MISSING', 'evidence must not describe a mix that cannot be built');
});

/* ------------------------------------------------------------------ */
/* Real FFmpeg: the strings above are only worth what FFmpeg accepts.  */
/* ------------------------------------------------------------------ */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const FFMPEG = process.env.VYRELUM_FFMPEG || join(root, 'workers/tools/ffmpeg.exe');
const FFPROBE = process.env.VYRELUM_FFPROBE || join(root, 'workers/tools/ffprobe.exe');
const haveFfmpeg = existsSync(FFMPEG) && existsSync(FFPROBE);

function renderGraph(filter, inputArgs, outPath) {
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...inputArgs,
    '-filter_complex', filter, '-map', '[aout]', '-c:a', 'pcm_s16le', outPath], { stdio: 'pipe' });
  const out = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outPath], { encoding: 'utf8' });
  return Number(String(out).trim());
}

/** mean_volume over one window. volumedetect reports on stderr, not stdout. */
function meanVolume(file, start, end) {
  const run = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-af', `atrim=start=${start}:end=${end},volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' });
  const found = /mean_volume: (-?[\d.]+) dB/.exec(`${run.stdout}${run.stderr}`);
  assert.ok(found, `no mean_volume in ffmpeg output: ${run.stderr}`);
  return Number(found[1]);
}

/**
 * The ratio is derived from an assumed key level, so a graph that is wired
 * correctly can still duck by the wrong amount. Only a render shows which.
 */
test('the duck really pulls the bed down under speech, by roughly the bed target', { skip: haveFfmpeg ? false : `ffmpeg not at ${FFMPEG}` }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'vyrealm-duck-'));
  try {
    const seconds = 6;
    const fmt = `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`;
    const tone = hz => ['-f', 'lavfi', '-t', String(seconds), '-i', `sine=frequency=${hz}:sample_rate=${SAMPLE_RATE}`];
    // The module's own duck stage, lifted out of the graph it built.
    const duckChain = buildAudioFilter({
      bed: 'narration-music',
      inputs: [{ kind: 'music', index: 0 }, { kind: 'narration', index: 1 }],
      durationSeconds: seconds
    }).filter.split(';').find(chain => chain.includes('sidechaincompress'));
    assert.ok(duckChain, 'narration-music must contain a duck stage to measure');

    // Key: silent for the first half, then lifted to the speech level the ratio assumes.
    const key = `${fmt},volume=18dB,volume=0:enable='lt(t,${seconds / 2})'`;
    const keyFile = join(dir, 'key.wav');
    execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...tone(880), '-af', key, '-c:a', 'pcm_s16le', keyFile], { stdio: 'pipe' });
    const keyLevel = meanVolume(keyFile, seconds / 2 + 0.5, seconds - 0.2);
    // Guard the probe before blaming the module: a key far off -6 dBFS measures
    // the test's own calibration, not the duck.
    assert.ok(Math.abs(keyLevel - DUCK_KEY_LEVEL_DB) < 1.5, `probe miscalibrated: key is ${keyLevel} dB, the ratio assumes ${DUCK_KEY_LEVEL_DB}`);

    const out = join(dir, 'ducked.wav');
    execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...tone(220), ...tone(880),
      '-filter_complex', `[0:a]${fmt}[music];[1:a]${key}[narration_key];${duckChain}`,
      '-map', '[music_ducked]', '-c:a', 'pcm_s16le', out], { stdio: 'pipe' });

    const idle = meanVolume(out, 0.5, seconds / 2 - 0.2);
    const under = meanVolume(out, seconds / 2 + 0.5, seconds - 0.2);
    const reduction = idle - under;
    const target = Math.abs(AUDIO_BEDS['narration-music'].duckDb);
    // Wide band: the soft knee and RMS detection put the real figure a little
    // over the target. A miswired key or an inverted ratio lands near 0.
    assert.ok(reduction > target - 4 && reduction < target + 6,
      `duck moved the music ${reduction.toFixed(2)} dB (idle ${idle}, under key ${under}); the bed asks for ${target}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FFmpeg accepts the graph and returns exactly the requested duration', { skip: haveFfmpeg ? false : `ffmpeg not at ${FFMPEG}` }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'vyrealm-audio-'));
  try {
    const durationSeconds = 5;

    // Music deliberately shorter than the cut, to prove the loop covers it.
    const sources = [
      '-f', 'lavfi', '-t', '2', '-i', `sine=frequency=220:sample_rate=${SAMPLE_RATE}`,
      '-f', 'lavfi', '-t', '3', '-i', `sine=frequency=440:sample_rate=${SAMPLE_RATE}`
    ];
    const ducked = buildAudioFilter({
      bed: 'narration-music',
      inputs: [{ kind: 'music', index: 0 }, { kind: 'narration', index: 1 }],
      durationSeconds
    });
    const duckedSeconds = renderGraph(ducked.filter, [...sources, ...ducked.inputArgs], join(dir, 'ducked.wav'));
    assert.ok(Math.abs(duckedSeconds - durationSeconds) < 0.02, `ducked mix ran ${duckedSeconds}s, wanted ${durationSeconds}s`);

    const silent = buildAudioFilter({ bed: 'silent-caption', inputs: [], durationSeconds });
    const silentSeconds = renderGraph(silent.filter, silent.inputArgs, join(dir, 'silent.wav'));
    assert.ok(Math.abs(silentSeconds - durationSeconds) < 0.02, `silent bed ran ${silentSeconds}s, wanted ${durationSeconds}s`);

    // And the standalone silence args are a usable input on their own.
    const standalone = buildAudioFilter({ bed: 'ambience-only', inputs: [{ kind: 'ambience', index: 0 }], durationSeconds });
    const ambienceSeconds = renderGraph(standalone.filter, [...silentTrackArgs(3), ...standalone.inputArgs], join(dir, 'ambience.wav'));
    assert.ok(Math.abs(ambienceSeconds - durationSeconds) < 0.02, `ambience bed ran ${ambienceSeconds}s, wanted ${durationSeconds}s`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
