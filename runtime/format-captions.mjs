/**
 * Burn platform-safe captions into a rendered beat.
 *
 * Everything here is a pure string builder. No FFmpeg process is spawned, so
 * the whole surface is testable without a render, and the caller owns when
 * the pixels get made.
 *
 * WHY the escaping looks paranoid: drawtext text passes through two parsers
 * (filtergraph, then the filter's own option reader) and a text expander. The
 * escape table below was not reasoned about, it was MEASURED against
 * workers/tools/ffmpeg.exe on 2026-09-07 by rendering each character and
 * counting lit pixels against a reference string. Findings that shaped it:
 *   - unquoted text cannot carry a colon at all (the filter description fails
 *     to parse), so the value is always emitted single-quoted;
 *   - inside quotes a single quote needs the close/escape/reopen form
 *     '\\\'' , and a backslash needs four backslashes; anything less is
 *     silently DROPPED rather than rejected;
 *   - a bare '%' is expanded: text '%{eif:1234:d}' renders as "1234". The
 *     '\\%' escape defeats that. A caption reading "100% off" that quietly
 *     became a frame counter is exactly the kind of silent lie this codebase
 *     refuses, so percent is escaped even though nothing crashes without it.
 *
 * Three approximations are declared rather than hidden:
 *   1. drawtext cannot select a font weight; CAPTION_STYLES.weight is
 *      rendered as a same-colour glyph outline (faux bold), not a real face.
 *   2. Text width is estimated from an average glyph advance, because the true
 *      width is only known inside FFmpeg. 0.66em clears natural caption text
 *      on every face measured here (10 Windows faces, 0.41-0.65em average),
 *      but a run of the widest glyphs ('WWWW' measures 0.94-1.04em) would
 *      still overflow. It is a working bound, not a proof.
 *   3. Line height is estimated at 1.2em, above the 1.16em worst case
 *      measured across those faces with accented capitals and descenders.
 * None of them degrades silently: a caption that cannot be drawn legibly
 * inside the safe area throws CAPTION_DOES_NOT_FIT instead of shrinking away.
 */

import { CAPTION_STYLES } from './format-library.mjs';

/** Caption cap height as a fraction of canvas height. */
const FONT_HEIGHT_RATIO = 0.055;
/**
 * Average glyph advance in em. Measured off Arial at fontsize 72 through
 * drawtext: 'PLACEMENT PROBE' spanned 701px over 15 chars (0.649em) and
 * 'SECOND CUE' 473px over 10 (0.657em). Rounded UP so the fit is safe.
 */
const GLYPH_ADVANCE_EM = 0.66;
/**
 * Upper bound on drawn line height in em. Measured through drawtext at
 * fontsize 100 across arial, segoe ui, times, impact, consolas, calibri:
 * worst case 1.16em (accented capitals plus descenders). Rounded UP.
 */
const LINE_HEIGHT_EM = 1.2;
/** Readability box padding, in em, applied on every side. */
const BOX_BORDER_EM = 0.3;
/** Below this a burned caption is not readable on any canvas. */
const MIN_FONT_PX = 14;
/** Share of a highlighted cue that renders as the accent hit. */
const ACCENT_SHARE = 0.45;
/** How much larger the accent draw is than the settled draw. */
const ACCENT_SCALE = 1.18;

const BASE_COLOR = 'white';
const ACCENT_COLOR = '0xFFD24A';
const BOX_COLOR = 'black@0.55';

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

/** Accepts a CAPTION_STYLES id or an already-resolved style object. */
function resolveStyle(style) {
  if (typeof style === 'string') {
    // hasOwn, not truthiness: 'constructor' and '__proto__' are inherited and
    // would otherwise resolve to a junk style with an undefined wordsPerCue.
    if (!Object.hasOwn(CAPTION_STYLES, style)) fail('CAPTION_STYLE_UNKNOWN', `no caption style ${style}`);
    return { id: style, ...CAPTION_STYLES[style] };
  }
  if (!style || typeof style !== 'object') fail('CAPTION_STYLE_UNKNOWN', 'style must be an id or a style object');
  if (typeof style.position !== 'string') fail('CAPTION_STYLE_UNKNOWN', 'style object needs a position');
  if (!Number.isInteger(style.wordsPerCue) || style.wordsPerCue < 0) {
    fail('CAPTION_STYLE_UNKNOWN', 'style object needs a non-negative integer wordsPerCue');
  }
  return { id: style.id ?? 'custom', ...style };
}

/**
 * Split text into cues that tile [0, durationSeconds] exactly.
 *
 * Time is shared out by word length so a long word holds longer than a short
 * one. Boundaries are carried forward by reference (each start IS the
 * previous end) rather than recomputed, so no float drift can open a gap.
 */
export function buildCueList({ text, durationSeconds, style }) {
  const resolved = resolveStyle(style);
  if (typeof text !== 'string') fail('CAPTION_TEXT_INVALID', `text must be a string, got ${typeof text}`);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    fail('CAPTION_DURATION_INVALID', `durationSeconds must be a positive finite number, got ${durationSeconds}`);
  }
  if (resolved.position === 'none' || resolved.wordsPerCue === 0) return [];

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks = [];
  for (let i = 0; i < words.length; i += resolved.wordsPerCue) {
    chunks.push(words.slice(i, i + resolved.wordsPerCue));
  }

  const weigh = chunk => chunk.reduce((sum, word) => sum + word.length, 0);
  const total = chunks.reduce((sum, chunk) => sum + weigh(chunk), 0);

  let start = 0;
  let carried = 0;
  return chunks.map((chunk, index) => {
    carried += weigh(chunk);
    const end = index === chunks.length - 1 ? durationSeconds : (durationSeconds * carried) / total;
    const cue = { start, end, text: chunk.join(' ') };
    start = end;
    return cue;
  });
}

/**
 * Escape text for a drawtext `text=` value and RETURN IT QUOTED.
 *
 * The quotes are part of the return value on purpose. The single-quote escape
 * sequence is only valid inside a quoted string, and an unquoted value cannot
 * carry a colon at all, so handing back a bare body would be a loaded gun.
 * Drop the result straight in: `text=${escapeDrawtext(line)}`.
 */
export function escapeDrawtext(text) {
  if (typeof text !== 'string') fail('CAPTION_TEXT_INVALID', `text must be a string, got ${typeof text}`);
  let out = "'";
  for (const ch of text) {
    if (ch === "'") out += "'\\\\\\''";      // close, escaped quote, reopen
    else if (ch === '\\') out += '\\\\\\\\'; // survives both parser levels
    else if (ch === '%') out += '\\\\%';     // defeats drawtext text expansion
    else if (ch === ':' || ch === ',' || ch === '[' || ch === ']') out += `\\${ch}`;
    else out += ch;
  }
  return out + "'";
}

/** Trim to millisecond precision; shared boundaries stay identical, so no gap opens. */
const stamp = seconds => Number(seconds.toFixed(3));

/** Shared by the filter builder and the evidence reader: no cue, no claim. */
function assertCues(cues) {
  if (!Array.isArray(cues)) fail('CAPTION_CUES_INVALID', 'cues must be an array');
  for (const [index, cue] of cues.entries()) {
    if (typeof cue?.text !== 'string' || !cue.text) fail('CAPTION_CUES_INVALID', `cue ${index} has no text`);
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end <= cue.start) {
      fail('CAPTION_CUES_INVALID', `cue ${index} has invalid timing ${cue.start}..${cue.end}`);
    }
  }
}

function assertCanvas(canvas, safeArea) {
  const okBox = v => Number.isFinite(v) && v > 0;
  if (!canvas || !okBox(canvas.width) || !okBox(canvas.height)) {
    fail('CAPTION_CANVAS_INVALID', 'canvas needs positive width and height');
  }
  const okInset = v => Number.isFinite(v) && v >= 0;
  if (!safeArea || !['top', 'bottom', 'left', 'right'].every(k => okInset(safeArea[k]))) {
    fail('CAPTION_SAFE_AREA_INVALID', 'safeArea needs non-negative top, bottom, left and right insets');
  }
  const span = canvas.width - safeArea.left - safeArea.right;
  const height = canvas.height - safeArea.top - safeArea.bottom;
  if (span <= 0 || height <= 0) {
    fail('CAPTION_SAFE_AREA_INVALID', `insets leave no room: ${span}x${height} inside ${canvas.width}x${canvas.height}`);
  }
  return span;
}

/**
 * One drawtext entry. `x` centres on the SAFE AREA, not the canvas, because
 * TikTok and Shorts inset the right edge further than the left for their UI
 * rail; centring on the canvas would push text under it.
 */
function drawtextEntry({ text, size, color, position, safeArea, span, weight, fontFile, from, to }) {
  const box = Math.round(size * BOX_BORDER_EM);
  const anchor = {
    'lower-third': `h-${safeArea.bottom + box}-text_h`,
    'upper-third': `${safeArea.top + box}`,
    center: '(h-text_h)/2'
  }[position];
  if (anchor === undefined) fail('CAPTION_STYLE_UNKNOWN', `no placement for position ${position}`);

  // Faux weight: drawtext selects no font face weight, so a same-colour
  // outline is the only lever. 400 is regular, hence the offset.
  const stroke = Math.round(size * 0.03 * Math.max(0, (weight - 400)) / 400);

  const parts = [];
  if (fontFile) parts.push(`fontfile=${escapeDrawtext(String(fontFile).replace(/\\/g, '/'))}`);
  parts.push(
    `text=${escapeDrawtext(text)}`,
    `fontsize=${size}`,
    `fontcolor=${color}`,
    'box=1',
    `boxcolor=${BOX_COLOR}`,
    `boxborderw=${box}`
  );
  if (stroke > 0) parts.push(`borderw=${stroke}`, `bordercolor=${color}`);
  parts.push(
    `x=${safeArea.left + box}+(${span - 2 * box}-text_w)/2`,
    `y=${anchor}`,
    // Half-open [from, to), NOT between(): between() is inclusive at BOTH
    // ends, so two cues sharing a boundary both draw on the frame that lands
    // exactly on it. Verified against ffmpeg 8.1.1: adjacent cues at t=1.0s
    // on a 30fps frame grid rendered 15163 lit pixels against 8685 and 11164
    // for the cues alone, i.e. both strings on one frame.
    `enable='gte(t,${stamp(from)})*lt(t,${stamp(to)})'`
  );
  return `drawtext=${parts.join(':')}`;
}

/**
 * Build a comma-joinable filter fragment drawing each cue in its own window.
 *
 * Font size is fitted to the safe area in both axes: capped at a share of the
 * canvas height, then shrunk until the widest cue plus its readability box
 * fits between the left and right insets AND the drawn line plus that box fits
 * the vertical room the chosen position can actually reach. If that lands
 * below MIN_FONT_PX the caption is refused rather than burned unreadably.
 */
export function buildCaptionFilter({ cues, style, canvas, safeArea, fontFile }) {
  const resolved = resolveStyle(style);
  if (!Array.isArray(cues)) fail('CAPTION_CUES_INVALID', 'cues must be an array');
  if (cues.length === 0) return '';
  if (resolved.position === 'none') {
    fail('CAPTION_STYLE_DRAWS_NOTHING', `style ${resolved.id} draws nothing but ${cues.length} cues were supplied`);
  }
  assertCues(cues);

  const span = assertCanvas(canvas, safeArea);
  const longest = Math.max(...cues.map(cue => cue.text.length));
  // Solve size * (advance*chars + 2*boxPadding) <= span for size.
  const byWidth = span / (GLYPH_ADVANCE_EM * longest + 2 * BOX_BORDER_EM);
  // Vertical room the readability box may occupy. An edge-anchored caption can
  // use the whole safe height; a centred one is pinned to the CANVAS midline,
  // so it only gets the window that is symmetric about that line - otherwise a
  // lopsided safe area would put a perfectly legible caption outside it.
  const vertical = resolved.position === 'center'
    ? canvas.height - 2 * Math.max(safeArea.top, safeArea.bottom)
    : canvas.height - safeArea.top - safeArea.bottom;
  const byHeight = Math.min(canvas.height * FONT_HEIGHT_RATIO, vertical / (LINE_HEIGHT_EM + 2 * BOX_BORDER_EM));
  // The accent draw is the larger one, so it is what has to fit.
  const headroom = resolved.highlight ? ACCENT_SCALE : 1;
  const size = Math.floor(Math.min(byWidth, byHeight) / headroom);
  if (size < MIN_FONT_PX) {
    const bound = byWidth <= byHeight
      ? `the widest cue is ${longest} characters and the safe width is ${span}px`
      : `${resolved.position} placement leaves ${vertical}px of safe height`;
    fail('CAPTION_DOES_NOT_FIT',
      `${bound}, so the caption needs ${size}px type, below the ${MIN_FONT_PX}px floor`);
  }

  const common = { position: resolved.position, safeArea, span, weight: resolved.weight ?? 400, fontFile };
  const entries = [];
  for (const cue of cues) {
    if (!resolved.highlight) {
      entries.push(drawtextEntry({ ...common, text: cue.text, size, color: BASE_COLOR, from: cue.start, to: cue.end }));
      continue;
    }
    // Karaoke here is a cue-onset accent, not a per-word wipe: a word-level
    // wipe needs glyph advances that only FFmpeg knows at draw time. The two
    // windows are half-open and share a boundary, so exactly one of them is
    // live on any frame and the cue is never drawn twice over itself.
    const hit = cue.start + (cue.end - cue.start) * ACCENT_SHARE;
    entries.push(drawtextEntry({
      ...common, text: cue.text, size: Math.round(size * ACCENT_SCALE), color: ACCENT_COLOR, from: cue.start, to: hit
    }));
    entries.push(drawtextEntry({ ...common, text: cue.text, size, color: BASE_COLOR, from: hit, to: cue.end }));
  }
  return entries.join(',');
}

/**
 * What was actually burned. `coverage` is the share of the caption timeline
 * that carries a cue, so a list with holes reports below 1 instead of
 * pretending the beat was captioned end to end.
 */
export function captionEvidence({ cues, style }) {
  const resolved = resolveStyle(style);
  // Same gate as the filter builder: an unreadable cue list must not be turned
  // into a plausible-looking measurement (a backwards cue would report
  // negative seconds and negative coverage).
  assertCues(cues);

  const totalSeconds = cues.reduce((sum, cue) => sum + (cue.end - cue.start), 0);
  const lastEnd = cues.length ? Math.max(...cues.map(cue => cue.end)) : 0;

  return {
    schemaVersion: 1,
    cueCount: cues.length,
    wordsPerCue: resolved.wordsPerCue,
    style: resolved.id,
    totalSeconds: Number(totalSeconds.toFixed(3)),
    coverage: lastEnd > 0 ? Number((totalSeconds / lastEnd).toFixed(4)) : 0
  };
}
