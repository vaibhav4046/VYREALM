/**
 * VYREALM audio graph builder.
 *
 * Turns an AUDIO_BEDS entry plus the FFmpeg input indices a caller has lined
 * up into one filtergraph: music bed, narration, ambience, ducking and a
 * loudness landing. Pure string building, so a plan's audio can be checked
 * without spawning FFmpeg.
 *
 * WHY it refuses rather than approximates: a bed is a promise about what the
 * viewer will hear. Dropping the narration because nobody passed a file, or
 * quietly letting a short music track run out under the back half of the cut,
 * produces a file that looks finished and is not. Those cases throw a coded
 * error instead.
 *
 * Three honest limits, since this module never touches the media:
 *  - It cannot measure the sources. A narration longer than the plan is cut by
 *    the graph; probe the file first if that matters.
 *  - loudnorm here is single-pass, i.e. dynamic normalisation toward the
 *    target. It is not a measurement of delivered LUFS. Measure the rendered
 *    file if a number has to be stated.
 *  - Music and ambience both duck under narration; narration is the sidechain
 *    key and never ducks itself. Evidence reports `ducked` listing the layers
 *    the graph actually compresses, so read `ducked`, not `duckDb`, to know
 *    what happened: a bed declaring a duck with no voice present ducks nothing
 *    and reports an empty array rather than implying a reduction.
 */

import { AUDIO_BEDS } from './format-library.mjs';

export const SAMPLE_RATE = 48000;

/** True-peak ceiling for every bed. -1.5 dBTP leaves room for lossy platform re-encodes. */
export const TRUE_PEAK_DBTP = -1.5;

const KINDS = ['music', 'narration', 'ambience'];

/** Sources that play under the whole cut get looped; a short bed must not run out. */
const LOOPED = new Set(['music', 'ambience']);

/**
 * Layers that sit under the voice and duck while it is active.
 *
 * Ambience belongs here as much as music: AUDIO_BEDS['narration-clean'] pairs
 * narration with ambience and declares duckDb -6, so restricting this to music
 * left that bed's stated reduction unapplied while the evidence still reported
 * it. Narration itself is never ducked; it is the sidechain key.
 */
const DUCKABLE = ['music', 'ambience'];

function fail(code, message, extra = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return Object.assign(error, extra);
}

/** Keep float noise out of filter strings. */
const sec = value => String(Number(value.toFixed(3)));

function resolveBed(bed) {
  if (typeof bed === 'string') {
    const entry = AUDIO_BEDS[bed];
    if (!entry) throw fail('AUDIO_BED_UNKNOWN', `unknown audio bed ${bed}`);
    return { id: bed, entry };
  }
  if (!bed || typeof bed !== 'object') throw fail('AUDIO_BED_INVALID', 'bed must be an AUDIO_BEDS entry or its id');
  for (const kind of KINDS) {
    if (typeof bed[kind] !== 'boolean') throw fail('AUDIO_BED_INVALID', `bed.${kind} must be a boolean`);
  }
  if (!Number.isFinite(bed.duckDb) || bed.duckDb > 0) throw fail('AUDIO_BED_INVALID', 'bed.duckDb must be a number at or below 0');
  // loudnorm accepts I between -70 and -5; anything else builds a graph FFmpeg
  // rejects at render time, which is a refusal arriving too late to be useful.
  if (!Number.isFinite(bed.targetLufs) || bed.targetLufs < -70 || bed.targetLufs > -5) {
    throw fail('AUDIO_BED_INVALID', `bed.targetLufs must be between -70 and -5 LUFS, got ${bed.targetLufs}`);
  }
  // A plan carries { id, ...bed }, so the spread copy is identified by id, not identity.
  const id = (bed.id && AUDIO_BEDS[bed.id]) ? bed.id
    : (Object.keys(AUDIO_BEDS).find(key => AUDIO_BEDS[key] === bed) ?? null);
  return { id, entry: bed };
}

function assertDuration(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw fail('AUDIO_DURATION_INVALID', `durationSeconds must be a positive number, got ${durationSeconds}`);
  }
}

/**
 * Map inputs to kinds, refusing anything the bed cannot honour.
 * An extra stream is an error too: silently ignoring a supplied music file is
 * the same lie as silently dropping a required one.
 */
function indexInputs(entry, inputs) {
  if (!Array.isArray(inputs)) throw fail('AUDIO_INPUT_INVALID', 'inputs must be an array');
  const byKind = new Map();
  for (const input of inputs) {
    const kind = input?.kind;
    if (!KINDS.includes(kind)) throw fail('AUDIO_INPUT_INVALID', `unknown input kind ${JSON.stringify(kind ?? null)}`);
    if (!Number.isInteger(input.index) || input.index < 0) throw fail('AUDIO_INPUT_INVALID', `${kind} needs a non-negative integer FFmpeg input index`);
    if (byKind.has(kind)) throw fail('AUDIO_INPUT_INVALID', `${kind} supplied twice; one stream per kind`);
    if (!entry[kind]) throw fail('AUDIO_STREAM_NOT_IN_BED', `this bed does not use ${kind}`, { kind });
    byKind.set(kind, input.index);
  }
  const missing = KINDS.filter(kind => entry[kind] && !byKind.has(kind));
  if (missing.length) throw fail('AUDIO_SOURCE_MISSING', `bed requires ${missing.join(', ')}`, { missing });
  return byKind;
}

/**
 * Which sources this bed needs, and which of them the caller failed to supply.
 * A stream the bed does not use comes back null even when a path was offered,
 * so it is visible that the bed decided the mix, not the caller's intent.
 */
export function planAudioSources(bed, available = {}) {
  const { entry } = resolveBed(bed);
  const sources = { music: null, narration: null, ambience: null, missing: [] };
  for (const kind of KINDS) {
    if (!entry[kind]) continue;
    const path = available?.[`${kind}Path`] ?? null;
    if (path) sources[kind] = path;
    else sources.missing.push(kind);
  }
  return sources;
}

/*
 * Ducking maths. sidechaincompress reduces gain by
 * (level - threshold) * (1 - 1/ratio) while the key sits above threshold, so a
 * ratio can be solved for a wanted reduction once a key level is assumed. The
 * assumption below makes duckDb a target, not a measurement of the mix.
 */
export const DUCK_KEY_LEVEL_DB = -6; // where a normalised voice track tends to sit
const DUCK_THRESHOLD_DB = -30;  // low enough that speech is always over it
const DUCK_THRESHOLD_LINEAR = 10 ** (DUCK_THRESHOLD_DB / 20);
const FFMPEG_MAX_RATIO = 20; // sidechaincompress ratio range is 1..20
const DUCK_HEADROOM_DB = DUCK_KEY_LEVEL_DB - DUCK_THRESHOLD_DB;

/**
 * Compressor ratio that lands roughly `duckDb` of reduction under speech.
 * Requests beyond FFmpeg's supported range land on its ratio cap. The bed's
 * duckDb remains a target; delivered loudness is measured after encoding.
 */
export function duckRatio(duckDb) {
  if (!Number.isFinite(duckDb) || duckDb > 0) throw fail('AUDIO_BED_INVALID', `duckDb must be a number at or below 0, got ${duckDb}`);
  const reduction = Math.abs(duckDb);
  const ratio = reduction < DUCK_HEADROOM_DB ? DUCK_HEADROOM_DB / (DUCK_HEADROOM_DB - reduction) : Infinity;
  return Math.min(ratio, FFMPEG_MAX_RATIO);
}

/** Which layers actually duck under the voice in this mix. Empty when none do. */
function duckedKinds(entry, byKind) {
  if (!(entry.duckDb < 0) || !byKind.has('narration')) return [];
  return DUCKABLE.filter(kind => byKind.has(kind));
}

/**
 * Build the audio filtergraph.
 *
 * @param {object} args
 * @param {object|string} args.bed AUDIO_BEDS entry, a plan's `audio`, or a bed id.
 * @param {Array<{kind:'music'|'narration'|'ambience', index:number}>} args.inputs
 * @param {number} args.durationSeconds
 * @returns {{filter:string, outLabel:string, inputArgs:string[]}}
 *   `filter` is a -filter_complex graph ending in [outLabel]. `inputArgs` is
 *   empty for every bed today: the silent bed synthesises anullsrc inside the
 *   graph, because an input index cannot be derived here without knowing the
 *   caller's video inputs. It is returned so a caller can splice it in
 *   unconditionally.
 */
export function buildAudioFilter({ bed, inputs = [], durationSeconds } = {}) {
  const { entry } = resolveBed(bed);
  assertDuration(durationSeconds);
  const byKind = indexInputs(entry, inputs);

  const dur = sec(durationSeconds);
  const head = `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`;
  // atrim caps a branch and apad fills it: together they pin every branch to
  // exactly durationSeconds whatever the source length turns out to be.
  const fit = `atrim=duration=${dur},asetpts=N/SR/TB,apad=whole_dur=${dur}`;
  // Derived from the stamped duration, not the raw one: a duration that rounds
  // up at 3dp would otherwise leave the buffer a few samples short of the trim.
  const loopSamples = Math.ceil(Number(dur) * SAMPLE_RATE);

  const ducked = duckedKinds(entry, byKind);
  // Resolved once, before any string is built: a malformed duckDb refuses the
  // whole graph rather than half-building it.
  const ratio = ducked.length ? Number(duckRatio(entry.duckDb).toFixed(3)) : null;
  const chains = [];

  for (const kind of KINDS) {
    if (!byKind.has(kind)) continue;
    const steps = [head];
    // aloop repeats the cut's worth of samples it buffers, so a bed shorter
    // than the cut repeats instead of falling silent under the back half. The
    // buffer costs duration * 48000 * 8 bytes, i.e. ~690 MB for a 30-minute cut.
    if (LOOPED.has(kind)) steps.push(`aloop=loop=-1:size=${loopSamples}`);
    steps.push(fit);
    // The narration feeds both the mix and the music compressor key.
    const forked = kind === 'narration' && ducked.length > 0;
    if (forked) steps.push('asplit=2');
    const out = forked
      ? '[narration][narration_key]'
      : `[${kind}]`;
    chains.push(`[${byKind.get(kind)}:a]${steps.join(',')}${out}`);
  }

  const mixLabels = [];
  for (const kind of KINDS) {
    if (!byKind.has(kind)) continue;
    if (!ducked.includes(kind)) { mixLabels.push(kind); continue; }
    // Not a static volume drop: that holds the bed down through the pauses
    // between phrases and reads as a mixing mistake. Keying the reduction off
    // the voice lets the bed lift back between lines, the way a fader ride
    // would, and it tracks a narration whose timing nobody measured here.
    chains.push(`[${kind}][narration_key]sidechaincompress=threshold=${DUCK_THRESHOLD_LINEAR.toFixed(6)}:ratio=${ratio}:attack=20:release=250:makeup=1:level_sc=1[${kind}_ducked]`);
    mixLabels.push(`${kind}_ducked`);
  }

  let mixLabel;
  if (mixLabels.length === 0) {
    // A silent bed still gets a real stream: a file with no audio track behaves
    // differently on every platform than one carrying silence.
    mixLabel = 'mix';
    chains.push(`anullsrc=channel_layout=stereo:sample_rate=${SAMPLE_RATE},${fit}[mix]`);
  } else if (mixLabels.length === 1) {
    mixLabel = mixLabels[0];
  } else {
    mixLabel = 'mix';
    // normalize=0 sums instead of dividing by input count, so the ducking sets
    // the balance rather than the number of streams; loudnorm's true-peak
    // limiter catches whatever that sums to.
    chains.push(`${mixLabels.map(label => `[${label}]`).join('')}amix=inputs=${mixLabels.length}:duration=longest:normalize=0[mix]`);
  }

  chains.push(`[${mixLabel}]loudnorm=I=${entry.targetLufs}:TP=${TRUE_PEAK_DBTP}:LRA=11,${fit}[aout]`);

  return { filter: chains.join(';'), outLabel: 'aout', inputArgs: [] };
}

/** FFmpeg input args for a standalone silent track, for beds that legitimately have no audio. */
export function silentTrackArgs(durationSeconds, sampleRate = SAMPLE_RATE) {
  assertDuration(durationSeconds);
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw fail('AUDIO_SAMPLE_RATE_INVALID', `sampleRate must be an integer between 8000 and 192000, got ${sampleRate}`);
  }
  return ['-f', 'lavfi', '-t', sec(durationSeconds), '-i', `anullsrc=channel_layout=stereo:sample_rate=${sampleRate}`];
}

/** What the audio graph actually contains. Refuses to describe a mix that could not be built. */
export function audioEvidence({ bed, inputs = [], durationSeconds } = {}) {
  const { id, entry } = resolveBed(bed);
  assertDuration(durationSeconds);
  const byKind = indexInputs(entry, inputs);
  const ducked = duckedKinds(entry, byKind);
  if (ducked.length) duckRatio(entry.duckDb);
  return {
    schemaVersion: 1,
    bedId: id,
    streams: KINDS.filter(kind => byKind.has(kind)).map(kind => ({ kind, inputIndex: byKind.get(kind) })),
    targetLufs: entry.targetLufs,
    duckDb: entry.duckDb,
    // duckDb is the bed's target; `ducked` is the layers the graph actually
    // applies it to. They disagree for 'narration-clean', whose ambience does
    // not duck, so reporting duckDb alone would claim a duck that never runs.
    ducked,
    durationSeconds
  };
}
