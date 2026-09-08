/**
 * VYREALM format library.
 *
 * Executable production recipes, not hook sentences. Each format states the
 * canvas, beat timings, which render route each beat needs, the caption
 * treatment and the audio bed, so the planner can turn a brief plus a shot
 * library into a concrete renderable plan.
 *
 * Every platform constant carries `source` and a confidence marker. Values
 * marked 'community-measured' are NOT published by the platform and must not
 * be shown to a user as official. A format is a creative hypothesis: nothing
 * here predicts reach.
 *
 * Companion research fetched 2026-09-07, URLs inside:
 *   docs/research/HIGGSFIELD_FULL_SURFACE_2026-09-07.md
 *   docs/research/REELS_ANIME_LOCAL_PIPELINES_2026-09-07.md
 *   docs/research/VIRAL_YOUTUBE_FORMATS_2026-09-07.md
 */

export const SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Platform specifications                                             */
/* ------------------------------------------------------------------ */

/**
 * safeArea values are pixel insets on the platform's reference canvas.
 * Meta publishes percentages for ADS on Reels (14% top / 35% bottom / 6%
 * sides) and nothing for organic. TikTok publishes no pixel safe zone at
 * all, only downloadable templates plus a note that the zone shrinks as
 * caption length grows. Community figures disagree by up to 4x, so they are
 * labelled as measured rather than documented.
 */
export const PLATFORM_SPECS = Object.freeze({
  'instagram-reels': {
    label: 'Instagram Reels',
    canvas: { width: 1080, height: 1920, fps: 30 },
    minSeconds: 3,
    maxSeconds: 180,
    maxSecondsNote: 'Uploads reach 3 minutes; Instagram states reels must be 3 minutes or less to be recommended.',
    apiCeilingSeconds: 900,
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioSampleRateHz: 48000,
    maxFileBytes: 300 * 1024 * 1024,
    fpsRange: [23, 60],
    safeArea: { top: 269, bottom: 672, left: 65, right: 65 },
    safeAreaConfidence: 'published-for-ads',
    safeAreaSource: 'https://www.facebook.com/business/ads-guide/update/video/instagram-reels',
    safeAreaOrganic: { top: 269, bottom: 340, left: 65, right: 160 },
    safeAreaOrganicConfidence: 'community-measured',
    penalties: ['low-resolution', 'visible-watermark', 'muted-audio', 'heavy-borders', 'majority-text', 'previously-posted'],
    penaltySource: 'https://about.instagram.com/blog/announcements/instagram-ranking-explained'
  },
  tiktok: {
    label: 'TikTok',
    canvas: { width: 1080, height: 1920, fps: 30 },
    minSeconds: 3,
    maxSeconds: 180,
    maxSecondsNote: 'Developer docs: all creators can post 3 minutes, some 5 or 10; API upload ceiling is 10 minutes.',
    apiCeilingSeconds: 600,
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioSampleRateHz: 48000,
    maxFileBytes: 4 * 1024 * 1024 * 1024,
    fpsRange: [23, 60],
    safeArea: { top: 160, bottom: 440, left: 80, right: 160 },
    safeAreaConfidence: 'community-measured',
    safeAreaSource: 'https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads',
    safeAreaNote: 'TikTok publishes no pixel safe zone. Verify against their template files before delivery.',
    penalties: ['visible-watermark', 'logo-or-qr', 'extremely-short-clip', 'static-image-only', 'unoriginal-reupload'],
    penaltySource: 'https://www.tiktok.com/community-guidelines/en/fyf-standards'
  },
  'youtube-shorts': {
    label: 'YouTube Shorts',
    canvas: { width: 1080, height: 1920, fps: 30 },
    minSeconds: 3,
    maxSeconds: 180,
    maxSecondsConfidence: 'unverified-this-session',
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioSampleRateHz: 48000,
    fpsRange: [24, 60],
    safeArea: { top: 160, bottom: 400, left: 60, right: 150 },
    safeAreaConfidence: 'community-measured',
    penalties: ['visible-watermark', 'reused-unmodified-content']
  },
  'youtube-long': {
    label: 'YouTube long-form',
    canvas: { width: 1920, height: 1080, fps: 24 },
    minSeconds: 30,
    minSecondsNote: 'Editorial floor for the 16:9 route, not a platform limit. YouTube imposes no minimum duration.',
    maxSeconds: 1800,
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioSampleRateHz: 48000,
    fpsRange: [24, 60],
    safeArea: { top: 40, bottom: 100, left: 60, right: 60 },
    safeAreaConfidence: 'convention',
    penalties: ['reused-unmodified-content']
  },
  'square-feed': {
    label: 'Square feed post',
    canvas: { width: 1080, height: 1080, fps: 30 },
    minSeconds: 3,
    maxSeconds: 180,
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioSampleRateHz: 48000,
    fpsRange: [23, 60],
    safeArea: { top: 60, bottom: 180, left: 60, right: 60 },
    safeAreaConfidence: 'convention',
    penalties: []
  }
});

export const PLATFORM_IDS = Object.freeze(Object.keys(PLATFORM_SPECS));

/* ------------------------------------------------------------------ */
/* Camera, grade and pacing vocabulary                                 */
/* ------------------------------------------------------------------ */

/**
 * Camera vocabulary. Each entry is a deterministic FFmpeg zoom/pan
 * instruction, not a model prompt keyword, so a composited beat renders the
 * same way every time. `intensity` scales the movement per second.
 */
export const CAMERA_MOVES = Object.freeze({
  static: { label: 'Static', zoom: 0, panX: 0, panY: 0, intensity: 0 },
  'push-in': { label: 'Push in', zoom: 0.08, panX: 0, panY: 0, intensity: 1 },
  'slow-push': { label: 'Slow push', zoom: 0.03, panX: 0, panY: 0, intensity: 0.5 },
  'pull-out': { label: 'Pull out', zoom: -0.08, panX: 0, panY: 0, intensity: 1 },
  'macro-push': { label: 'Macro push', zoom: 0.16, panX: 0, panY: 0, intensity: 1.6 },
  'crash-zoom': { label: 'Crash zoom', zoom: 0.34, panX: 0, panY: 0, intensity: 3 },
  'truck-left': { label: 'Truck left', zoom: 0.02, panX: -0.09, panY: 0, intensity: 1 },
  'truck-right': { label: 'Truck right', zoom: 0.02, panX: 0.09, panY: 0, intensity: 1 },
  'tilt-up': { label: 'Tilt up', zoom: 0.02, panX: 0, panY: -0.08, intensity: 1 },
  'tilt-down': { label: 'Tilt down', zoom: 0.02, panX: 0, panY: 0.08, intensity: 1 },
  'slow-pan': { label: 'Slow pan', zoom: 0.01, panX: 0.05, panY: 0, intensity: 0.5 },
  drift: { label: 'Drift', zoom: 0.04, panX: 0.03, panY: -0.02, intensity: 0.7 },
  parallax: { label: 'Parallax', zoom: 0.05, panX: 0.06, panY: 0, intensity: 1 },
  crane: { label: 'Crane', zoom: 0.06, panX: 0, panY: -0.1, intensity: 1.2 },
  orbit: { label: 'Orbit', zoom: 0.05, panX: 0.11, panY: -0.02, intensity: 1.3 },
  'orbit-reverse': { label: 'Orbit reverse', zoom: 0.05, panX: -0.11, panY: -0.02, intensity: 1.3 },
  handheld: { label: 'Handheld', zoom: 0.03, panX: 0.02, panY: 0.02, intensity: 1, jitter: 0.004 },
  shake: { label: 'Shake', zoom: 0.05, panX: 0, panY: 0, intensity: 1.5, jitter: 0.012 },
  snap: { label: 'Snap', zoom: 0.2, panX: 0, panY: 0, intensity: 4 },
  hold: { label: 'Hold', zoom: 0, panX: 0, panY: 0, intensity: 0 }
});

/** Cinema-style speed ramps. `curve` is applied to beat playback rate. */
export const SPEED_RAMPS = Object.freeze({
  linear: { label: 'Linear', curve: [1, 1] },
  'flash-in': { label: 'Flash in', curve: [2.4, 1] },
  'flash-out': { label: 'Flash out', curve: [1, 2.4] },
  'slow-mo': { label: 'Slow motion', curve: [0.45, 0.45] },
  'bullet-time': { label: 'Bullet time', curve: [1, 0.18, 1] },
  impact: { label: 'Impact', curve: [1, 0.3, 1.6] },
  'ramp-up': { label: 'Ramp up', curve: [0.7, 1.8] }
});

/** Deterministic colour grades, applied as FFmpeg filters. */
export const GRADES = Object.freeze({
  neutral: { label: 'Neutral', temperature: 0, contrast: 1, saturation: 1, grain: 0 },
  'warm-golden': { label: 'Warm golden', temperature: 0.18, contrast: 1.06, saturation: 1.1, grain: 0.02 },
  'cool-night': { label: 'Cool night', temperature: -0.2, contrast: 1.12, saturation: 0.92, grain: 0.04 },
  'high-contrast-noir': { label: 'High contrast noir', temperature: -0.05, contrast: 1.4, saturation: 0.1, grain: 0.06 },
  'anime-flat': { label: 'Anime flat', temperature: 0.04, contrast: 1.15, saturation: 1.25, grain: 0 },
  'clean-product': { label: 'Clean product', temperature: 0.02, contrast: 1.04, saturation: 1.05, grain: 0 },
  'film-vintage': { label: 'Film vintage', temperature: 0.12, contrast: 0.95, saturation: 0.85, grain: 0.09 }
});

export const PACING = Object.freeze({
  'single-shot': { label: 'Single shot', cutsPerMinute: 2 },
  calm: { label: 'Calm', cutsPerMinute: 8 },
  dynamic: { label: 'Dynamic', cutsPerMinute: 22 },
  chaotic: { label: 'Chaotic', cutsPerMinute: 48 }
});

/* ------------------------------------------------------------------ */
/* Hook patterns                                                       */
/* ------------------------------------------------------------------ */

/**
 * Structural opening patterns. `rule` describes what must happen on screen
 * in the opening seconds; the renderer decides pixels. `holdSeconds` is the
 * minimum the opening beat must occupy.
 */
export const HOOK_PATTERNS = Object.freeze({
  'cold-question': { label: 'Cold question', rule: 'Open on the subject mid-action while one question caption lands before any context.', holdSeconds: 1.2 },
  'false-start': { label: 'False start', rule: 'Begin as if the video already failed, then cut to the real opening.', holdSeconds: 1 },
  'end-first': { label: 'End first', rule: 'Show the final result in the opening frame, then rewind to the beginning.', holdSeconds: 1.5 },
  'impossible-image': { label: 'Impossible image', rule: 'Lead with the single most physically improbable frame in the piece.', holdSeconds: 1.2 },
  'direct-address': { label: 'Direct address', rule: 'Subject looks into lens and names the viewer situation in one clause.', holdSeconds: 1.4 },
  'countdown-tease': { label: 'Countdown tease', rule: 'State the count and promise the last item is the payoff.', holdSeconds: 1.3 },
  'before-after-flash': { label: 'Before/after flash', rule: 'Cut before and after within the first second, then explain.', holdSeconds: 1 },
  'mistake-warning': { label: 'Mistake warning', rule: 'Name the error the viewer is probably making right now.', holdSeconds: 1.3 },
  'myth-break': { label: 'Myth break', rule: 'State the common belief, then visibly contradict it.', holdSeconds: 1.5 },
  'in-medias-res': { label: 'In medias res', rule: 'Drop into the highest-tension moment with no setup.', holdSeconds: 1.2 },
  'pov-frame': { label: 'POV frame', rule: 'Establish first-person perspective in the opening caption and camera height.', holdSeconds: 1.2 },
  'sound-first': { label: 'Sound first', rule: 'Lead with a distinctive sound over a near-black frame, reveal on the beat.', holdSeconds: 1 },
  'number-claim': { label: 'Number claim', rule: 'Open on a concrete measured number tied to the outcome.', holdSeconds: 1.2 },
  'silent-open': { label: 'Silent open', rule: 'Kill all audio for the first beat so the caption carries it.', holdSeconds: 1 },
  'loop-seam': { label: 'Loop seam', rule: 'Open on the frame the video will end on, making the loop invisible.', holdSeconds: 1 },
  'threat-reveal': { label: 'Threat reveal', rule: 'Establish calm, then place one wrong detail in frame.', holdSeconds: 1.6 },
  'transformation-tease': { label: 'Transformation tease', rule: 'Show the subject beginning to change within the first beat.', holdSeconds: 1.2 },
  'spec-flyover': { label: 'Spec flyover', rule: 'Push across the product surface while one hard spec lands as caption.', holdSeconds: 1.4 },
  'contrast-cut': { label: 'Contrast cut', rule: 'Hard cut between two opposite images on the first beat.', holdSeconds: 0.9 },
  'process-open': { label: 'Process open', rule: 'Open inside the work already in progress, hands or tools first.', holdSeconds: 1.3 },
  'character-intro': { label: 'Character intro', rule: 'Frame the recurring character so identity reads in one frame.', holdSeconds: 1.4 },
  'stakes-line': { label: 'Stakes line', rule: 'State what is lost if the viewer stops watching.', holdSeconds: 1.3 },
  'demo-proof': { label: 'Demo proof', rule: 'Run the thing on screen before describing it.', holdSeconds: 1.5 },
  'quote-open': { label: 'Quote open', rule: 'Land a short attributed line as motion type over the first image.', holdSeconds: 1.4 },
  'scale-shift': { label: 'Scale shift', rule: 'Start extremely close, pull to reveal unexpected scale.', holdSeconds: 1.5 }
});

export const HOOK_IDS = Object.freeze(Object.keys(HOOK_PATTERNS));

/* ------------------------------------------------------------------ */
/* Caption and audio treatments                                        */
/* ------------------------------------------------------------------ */

export const CAPTION_STYLES = Object.freeze({
  'karaoke-bold': { label: 'Karaoke bold', wordsPerCue: 3, weight: 800, position: 'lower-third', highlight: true },
  'single-line-center': { label: 'Single line centre', wordsPerCue: 5, weight: 700, position: 'center', highlight: false },
  'top-statement': { label: 'Top statement', wordsPerCue: 6, weight: 700, position: 'upper-third', highlight: false },
  'minimal-lower': { label: 'Minimal lower', wordsPerCue: 7, weight: 500, position: 'lower-third', highlight: false },
  none: { label: 'No burned captions', wordsPerCue: 0, weight: 0, position: 'none', highlight: false }
});

export const AUDIO_BEDS = Object.freeze({
  'music-drive': { label: 'Driving music bed', music: true, narration: false, ambience: false, duckDb: 0, targetLufs: -14 },
  'narration-music': { label: 'Narration over music', music: true, narration: true, ambience: false, duckDb: -12, targetLufs: -14 },
  'narration-clean': { label: 'Narration, no music', music: false, narration: true, ambience: true, duckDb: -6, targetLufs: -16 },
  'ambience-only': { label: 'Ambience and design only', music: false, narration: false, ambience: true, duckDb: 0, targetLufs: -16 },
  'silent-caption': { label: 'Silent, captions carry', music: false, narration: false, ambience: false, duckDb: 0, targetLufs: -20 }
});

/* ------------------------------------------------------------------ */
/* Formats                                                             */
/* ------------------------------------------------------------------ */

const V = ['instagram-reels', 'tiktok', 'youtube-shorts'];
const VS = [...V, 'square-feed'];
const H = ['youtube-long'];

/**
 * beat.route:
 *   'composite' - FFmpeg over existing library shots. Seconds to render.
 *   'neural'    - needs a generated shot. Minutes to tens of minutes.
 *   'either'    - planner picks by time budget.
 * beat.shot is a role name resolved against a supplied shot library.
 */
export const FORMATS = Object.freeze({
  'cold-open-question': { label: 'Cold open question', niche: 'general', platforms: V, seconds: 15, hook: 'cold-question', captions: 'karaoke-bold', audio: 'narration-music', grade: 'neutral', pacing: 'dynamic', beats: [
    { at: 0, dur: 1.2, role: 'hook', shot: 'hero', motion: 'push-in', route: 'either' },
    { at: 1.2, dur: 5.3, role: 'context', shot: 'broll-a', motion: 'drift', route: 'composite' },
    { at: 6.5, dur: 5.5, role: 'turn', shot: 'hero', motion: 'hold', route: 'either' },
    { at: 12, dur: 3, role: 'payoff', shot: 'broll-b', motion: 'pull-out', route: 'composite' }
  ] },
  'false-start-loop': { label: 'False start loop', niche: 'general', platforms: V, seconds: 12, hook: 'false-start', captions: 'single-line-center', audio: 'music-drive', grade: 'neutral', pacing: 'dynamic', beats: [
    { at: 0, dur: 1, role: 'false-start', shot: 'broll-a', motion: 'shake', route: 'composite' },
    { at: 1, dur: 5, role: 'real-open', shot: 'hero', motion: 'push-in', route: 'either' },
    { at: 6, dur: 5, role: 'build', shot: 'broll-b', motion: 'drift', route: 'composite' },
    { at: 11, dur: 1, role: 'loop-seam', shot: 'broll-a', motion: 'shake', route: 'composite' }
  ] },
  'transformation-reveal': { label: 'Transformation reveal', niche: 'general', platforms: VS, seconds: 15, hook: 'transformation-tease', captions: 'karaoke-bold', audio: 'music-drive', grade: 'warm-golden', pacing: 'dynamic', beats: [
    { at: 0, dur: 1.2, role: 'hook', shot: 'before', motion: 'hold', route: 'composite' },
    { at: 1.2, dur: 6.8, role: 'process', shot: 'process', motion: 'drift', route: 'either' },
    { at: 8, dur: 7, role: 'reveal', shot: 'after', motion: 'push-in', route: 'either' }
  ] },
  'before-after-split': { label: 'Before/after split', niche: 'general', platforms: VS, seconds: 10, hook: 'before-after-flash', captions: 'top-statement', audio: 'music-drive', grade: 'clean-product', pacing: 'dynamic', beats: [
    { at: 0, dur: 1, role: 'flash', shot: 'after', motion: 'hold', route: 'composite' },
    { at: 1, dur: 4, role: 'before', shot: 'before', motion: 'drift', route: 'composite' },
    { at: 5, dur: 5, role: 'after', shot: 'after', motion: 'push-in', route: 'composite' }
  ] },
  'numbered-listicle': { label: 'Numbered listicle', niche: 'general', platforms: V, seconds: 30, hook: 'countdown-tease', captions: 'karaoke-bold', audio: 'narration-music', grade: 'neutral', pacing: 'dynamic', beats: [
    { at: 0, dur: 1.3, role: 'hook', shot: 'hero', motion: 'push-in', route: 'either' },
    { at: 1.3, dur: 6.9, role: 'item-1', shot: 'broll-a', motion: 'drift', route: 'composite' },
    { at: 8.2, dur: 6.9, role: 'item-2', shot: 'broll-b', motion: 'drift', route: 'composite' },
    { at: 15.1, dur: 6.9, role: 'item-3', shot: 'broll-c', motion: 'drift', route: 'composite' },
    { at: 22, dur: 8, role: 'payoff', shot: 'hero', motion: 'pull-out', route: 'either' }
  ] },
  'satisfying-loop': { label: 'Satisfying loop', niche: 'general', platforms: VS, seconds: 8, hook: 'loop-seam', captions: 'none', audio: 'ambience-only', grade: 'neutral', pacing: 'calm', beats: [
    { at: 0, dur: 4, role: 'cycle-a', shot: 'loop', motion: 'orbit', route: 'either' },
    { at: 4, dur: 4, role: 'cycle-b', shot: 'loop', motion: 'orbit-reverse', route: 'composite' }
  ] },
  'pov-immersion': { label: 'POV immersion', niche: 'story', platforms: V, seconds: 15, hook: 'pov-frame', captions: 'single-line-center', audio: 'ambience-only', grade: 'cool-night', pacing: 'calm', beats: [
    { at: 0, dur: 1.2, role: 'hook', shot: 'pov', motion: 'handheld', route: 'either' },
    { at: 1.2, dur: 7.8, role: 'explore', shot: 'pov', motion: 'drift', route: 'composite' },
    { at: 9, dur: 6, role: 'turn', shot: 'hero', motion: 'push-in', route: 'either' }
  ] },
  'micro-horror-turn': { label: 'Micro-horror turn', niche: 'story', platforms: V, seconds: 15, hook: 'threat-reveal', captions: 'minimal-lower', audio: 'ambience-only', grade: 'cool-night', pacing: 'calm', beats: [
    { at: 0, dur: 1.6, role: 'calm', shot: 'hero', motion: 'hold', route: 'either' },
    { at: 1.6, dur: 7.4, role: 'wrong-detail', shot: 'broll-a', motion: 'slow-push', route: 'composite' },
    { at: 9, dur: 4.5, role: 'reveal', shot: 'hero', motion: 'snap', route: 'either' },
    { at: 13.5, dur: 1.5, role: 'cut-to-black', shot: 'black', motion: 'hold', route: 'composite' }
  ] },
  'story-narrative-30': { label: 'Story narrative 30s', niche: 'story', platforms: V, seconds: 30, hook: 'in-medias-res', captions: 'karaoke-bold', audio: 'narration-music', grade: 'film-vintage', pacing: 'dynamic', beats: [
    { at: 0, dur: 1.2, role: 'hook', shot: 'hero', motion: 'push-in', route: 'either' },
    { at: 1.2, dur: 8.8, role: 'setup', shot: 'broll-a', motion: 'drift', route: 'composite' },
    { at: 10, dur: 10, role: 'complication', shot: 'broll-b', motion: 'handheld', route: 'composite' },
    { at: 20, dur: 10, role: 'resolution', shot: 'hero', motion: 'pull-out', route: 'either' }
  ] },
  'text-story-scroll': { label: 'Text story scroll', niche: 'story', platforms: V, seconds: 20, hook: 'quote-open', captions: 'single-line-center', audio: 'music-drive', grade: 'neutral', pacing: 'calm', beats: [
    { at: 0, dur: 1.4, role: 'hook', shot: 'texture', motion: 'drift', route: 'composite' },
    { at: 1.4, dur: 9.6, role: 'body', shot: 'texture', motion: 'slow-pan', route: 'composite' },
    { at: 11, dur: 9, role: 'turn', shot: 'hero', motion: 'push-in', route: 'either' }
  ] },
  'anime-character-intro': { label: 'Anime character intro', niche: 'anime', platforms: V, seconds: 12, hook: 'character-intro', captions: 'top-statement', audio: 'music-drive', grade: 'anime-flat', pacing: 'dynamic', beats: [
    { at: 0, dur: 1.4, role: 'hook', shot: 'anime-hero', motion: 'hold', route: 'neural' },
    { at: 1.4, dur: 5.6, role: 'establish', shot: 'anime-bg', motion: 'parallax', route: 'composite' },
    { at: 7, dur: 5, role: 'turn-to-camera', shot: 'anime-hero', motion: 'push-in', route: 'neural' }
  ] },
  'anime-action-beat': { label: 'Anime action beat', niche: 'anime', platforms: V, seconds: 10, hook: 'impossible-image', captions: 'none', audio: 'music-drive', grade: 'anime-flat', pacing: 'chaotic', beats: [
    { at: 0, dur: 1.2, role: 'hook', shot: 'anime-action', motion: 'snap', route: 'neural' },
    { at: 1.2, dur: 4.3, role: 'impact', shot: 'anime-action', motion: 'shake', route: 'composite' },
    { at: 5.5, dur: 4.5, role: 'aftermath', shot: 'anime-bg', motion: 'drift', route: 'composite' }
  ] },
  'anime-short-film': { label: 'Anime short film', niche: 'anime', platforms: H, seconds: 90, hook: 'scale-shift', captions: 'minimal-lower', audio: 'narration-music', grade: 'anime-flat', pacing: 'calm', beats: [
    { at: 0, dur: 6, role: 'establish', shot: 'anime-bg', motion: 'slow-push', route: 'composite' },
    { at: 6, dur: 24, role: 'act-1', shot: 'anime-hero', motion: 'drift', route: 'neural' },
    { at: 30, dur: 30, role: 'act-2', shot: 'anime-action', motion: 'handheld', route: 'neural' },
    { at: 60, dur: 30, role: 'act-3', shot: 'anime-hero', motion: 'pull-out', route: 'neural' }
  ] },
  'cinematic-trailer-30': { label: 'Cinematic trailer 30s', niche: 'cinematic', platforms: H, seconds: 30, hook: 'impossible-image', captions: 'minimal-lower', audio: 'music-drive', grade: 'high-contrast-noir', pacing: 'dynamic', beats: [
    { at: 0, dur: 1.2, role: 'hook', shot: 'hero', motion: 'push-in', route: 'either' },
    { at: 1.2, dur: 8.8, role: 'world', shot: 'establish', motion: 'crane', route: 'composite' },
    { at: 10, dur: 10, role: 'escalate', shot: 'broll-a', motion: 'handheld', route: 'either' },
    { at: 20, dur: 10, role: 'title', shot: 'hero', motion: 'pull-out', route: 'composite' }
  ] },
  'cinematic-trailer-60': { label: 'Cinematic trailer 60s', niche: 'cinematic', platforms: H, seconds: 60, hook: 'sound-first', captions: 'minimal-lower', audio: 'music-drive', grade: 'high-contrast-noir', pacing: 'dynamic', beats: [
    { at: 0, dur: 4, role: 'sound-open', shot: 'black', motion: 'hold', route: 'composite' },
    { at: 4, dur: 14, role: 'world', shot: 'establish', motion: 'crane', route: 'composite' },
    { at: 18, dur: 18, role: 'characters', shot: 'hero', motion: 'push-in', route: 'neural' },
    { at: 36, dur: 16, role: 'escalate', shot: 'broll-a', motion: 'handheld', route: 'either' },
    { at: 52, dur: 8, role: 'title', shot: 'black', motion: 'hold', route: 'composite' }
  ] },
  'establishing-mood': { label: 'Establishing mood piece', niche: 'cinematic', platforms: VS, seconds: 15, hook: 'scale-shift', captions: 'none', audio: 'ambience-only', grade: 'film-vintage', pacing: 'calm', beats: [
    { at: 0, dur: 1.5, role: 'macro', shot: 'texture', motion: 'slow-push', route: 'composite' },
    { at: 1.5, dur: 7.5, role: 'pull', shot: 'establish', motion: 'pull-out', route: 'either' },
    { at: 9, dur: 6, role: 'settle', shot: 'hero', motion: 'hold', route: 'either' }
  ] },
  'product-proof-15': { label: 'Product proof 15s', niche: 'product', platforms: VS, seconds: 15, hook: 'demo-proof', captions: 'karaoke-bold', audio: 'narration-music', grade: 'clean-product', pacing: 'dynamic', beats: [
    { at: 0, dur: 1.5, role: 'hook', shot: 'product', motion: 'push-in', route: 'composite' },
    { at: 1.5, dur: 6.5, role: 'problem', shot: 'broll-a', motion: 'drift', route: 'composite' },
    { at: 8, dur: 7, role: 'proof', shot: 'product', motion: 'orbit', route: 'composite' }
  ] },
  'product-hero-orbit': { label: 'Product hero orbit', niche: 'product', platforms: VS, seconds: 10, hook: 'spec-flyover', captions: 'top-statement', audio: 'music-drive', grade: 'clean-product', pacing: 'calm', beats: [
    { at: 0, dur: 1.4, role: 'hook', shot: 'product', motion: 'macro-push', route: 'composite' },
    { at: 1.4, dur: 8.6, role: 'orbit', shot: 'product', motion: 'orbit', route: 'composite' }
  ] },
  'ugc-testimonial': { label: 'UGC testimonial', niche: 'product', platforms: V, seconds: 20, hook: 'direct-address', captions: 'karaoke-bold', audio: 'narration-clean', grade: 'neutral', pacing: 'calm', beats: [
    { at: 0, dur: 1.4, role: 'hook', shot: 'talking-head', motion: 'handheld', route: 'composite' },
    { at: 1.4, dur: 9.6, role: 'story', shot: 'talking-head', motion: 'handheld', route: 'composite' },
    { at: 11, dur: 5, role: 'proof', shot: 'product', motion: 'push-in', route: 'composite' },
    { at: 16, dur: 4, role: 'close', shot: 'talking-head', motion: 'hold', route: 'composite' }
  ] },
  'unboxing-reveal': { label: 'Unboxing reveal', niche: 'product', platforms: V, seconds: 20, hook: 'end-first', captions: 'karaoke-bold', audio: 'narration-music', grade: 'clean-product', pacing: 'dynamic', beats: [
    { at: 0, dur: 1.5, role: 'end-first', shot: 'product', motion: 'hold', route: 'composite' },
    { at: 1.5, dur: 8.5, role: 'open', shot: 'process', motion: 'handheld', route: 'composite' },
    { at: 10, dur: 10, role: 'reveal', shot: 'product', motion: 'orbit', route: 'composite' }
  ] },
  'product-launch-film': { label: 'Product launch film', niche: 'product', platforms: H, seconds: 90, hook: 'stakes-line', captions: 'minimal-lower', audio: 'narration-music', grade: 'clean-product', pacing: 'calm', beats: [
    { at: 0, dur: 6, role: 'hook', shot: 'product', motion: 'macro-push', route: 'composite' },
    { at: 6, dur: 24, role: 'problem', shot: 'broll-a', motion: 'drift', route: 'composite' },
    { at: 30, dur: 30, role: 'solution', shot: 'product', motion: 'orbit', route: 'composite' },
    { at: 60, dur: 30, role: 'proof', shot: 'broll-b', motion: 'push-in', route: 'either' }
  ] },
  'tech-spec-flyover': { label: 'Tech spec flyover', niche: 'tech', platforms: VS, seconds: 15, hook: 'spec-flyover', captions: 'top-statement', audio: 'music-drive', grade: 'clean-product', pacing: 'dynamic', beats: [
    { at: 0, dur: 1.4, role: 'hook', shot: 'product', motion: 'macro-push', route: 'composite' },
    { at: 1.4, dur: 6.6, role: 'spec-a', shot: 'product', motion: 'slow-pan', route: 'composite' },
    { at: 8, dur: 7, role: 'spec-b', shot: 'broll-a', motion: 'drift', route: 'composite' }
  ] },
  'ai-model-demo': { label: 'AI model demo', niche: 'tech', platforms: VS, seconds: 20, hook: 'demo-proof', captions: 'karaoke-bold', audio: 'narration-clean', grade: 'neutral', pacing: 'dynamic', beats: [
    { at: 0, dur: 1.5, role: 'run-it', shot: 'screen', motion: 'hold', route: 'composite' },
    { at: 1.5, dur: 8.5, role: 'input', shot: 'screen', motion: 'slow-push', route: 'composite' },
    { at: 10, dur: 10, role: 'output', shot: 'hero', motion: 'push-in', route: 'either' }
  ] },
  'tech-review-longform': { label: 'Tech review long-form', niche: 'tech', platforms: H, seconds: 600, hook: 'number-claim', captions: 'minimal-lower', audio: 'narration-clean', grade: 'neutral', pacing: 'calm', beats: [
    { at: 0, dur: 20, role: 'hook', shot: 'product', motion: 'macro-push', route: 'composite' },
    { at: 20, dur: 100, role: 'context', shot: 'talking-head', motion: 'hold', route: 'composite' },
    { at: 120, dur: 180, role: 'test-1', shot: 'screen', motion: 'hold', route: 'composite' },
    { at: 300, dur: 180, role: 'test-2', shot: 'broll-a', motion: 'drift', route: 'composite' },
    { at: 480, dur: 120, role: 'verdict', shot: 'talking-head', motion: 'hold', route: 'composite' }
  ] },
  'explainer-diagram': { label: 'Explainer with diagram', niche: 'education', platforms: VS, seconds: 30, hook: 'myth-break', captions: 'karaoke-bold', audio: 'narration-clean', grade: 'neutral', pacing: 'dynamic', beats: [
    { at: 0, dur: 1.5, role: 'myth', shot: 'texture', motion: 'hold', route: 'composite' },
    { at: 1.5, dur: 12.5, role: 'diagram', shot: 'diagram', motion: 'slow-push', route: 'composite' },
    { at: 14, dur: 16, role: 'truth', shot: 'hero', motion: 'push-in', route: 'either' }
  ] },
  'tutorial-15s': { label: 'Tutorial in 15s', niche: 'education', platforms: V, seconds: 15, hook: 'end-first', captions: 'karaoke-bold', audio: 'narration-clean', grade: 'neutral', pacing: 'chaotic', beats: [
    { at: 0, dur: 1.5, role: 'result', shot: 'after', motion: 'hold', route: 'composite' },
    { at: 1.5, dur: 4.5, role: 'step-1', shot: 'process', motion: 'hold', route: 'composite' },
    { at: 6, dur: 4.5, role: 'step-2', shot: 'process', motion: 'hold', route: 'composite' },
    { at: 10.5, dur: 4.5, role: 'step-3', shot: 'after', motion: 'push-in', route: 'composite' }
  ] },
  'tutorial-longform': { label: 'Tutorial long-form', niche: 'education', platforms: H, seconds: 480, hook: 'stakes-line', captions: 'minimal-lower', audio: 'narration-clean', grade: 'neutral', pacing: 'calm', beats: [
    { at: 0, dur: 20, role: 'hook', shot: 'after', motion: 'hold', route: 'composite' },
    { at: 20, dur: 60, role: 'overview', shot: 'talking-head', motion: 'hold', route: 'composite' },
    { at: 80, dur: 160, role: 'part-1', shot: 'screen', motion: 'hold', route: 'composite' },
    { at: 240, dur: 160, role: 'part-2', shot: 'screen', motion: 'hold', route: 'composite' },
    { at: 400, dur: 80, role: 'recap', shot: 'talking-head', motion: 'hold', route: 'composite' }
  ] },
  'myth-vs-fact': { label: 'Myth versus fact', niche: 'education', platforms: V, seconds: 20, hook: 'myth-break', captions: 'top-statement', audio: 'narration-music', grade: 'neutral', pacing: 'dynamic', beats: [
    { at: 0, dur: 1.5, role: 'myth', shot: 'broll-a', motion: 'hold', route: 'composite' },
    { at: 1.5, dur: 8.5, role: 'why-believed', shot: 'broll-b', motion: 'drift', route: 'composite' },
    { at: 10, dur: 10, role: 'fact', shot: 'hero', motion: 'push-in', route: 'either' }
  ] },
  'mistake-warning': { label: 'Mistake warning', niche: 'education', platforms: V, seconds: 15, hook: 'mistake-warning', captions: 'karaoke-bold', audio: 'narration-clean', grade: 'neutral', pacing: 'dynamic', beats: [
    { at: 0, dur: 1.3, role: 'warning', shot: 'hero', motion: 'push-in', route: 'either' },
    { at: 1.3, dur: 6.7, role: 'wrong-way', shot: 'process', motion: 'hold', route: 'composite' },
    { at: 8, dur: 7, role: 'right-way', shot: 'after', motion: 'push-in', route: 'composite' }
  ] },
  'music-video-loop': { label: 'Music video loop', niche: 'music', platforms: VS, seconds: 15, hook: 'sound-first', captions: 'none', audio: 'music-drive', grade: 'film-vintage', pacing: 'dynamic', beats: [
    { at: 0, dur: 1, role: 'downbeat', shot: 'black', motion: 'hold', route: 'composite' },
    { at: 1, dur: 7, role: 'verse', shot: 'hero', motion: 'drift', route: 'either' },
    { at: 8, dur: 7, role: 'chorus', shot: 'broll-a', motion: 'orbit', route: 'composite' }
  ] },
  'day-in-life': { label: 'Day in the life', niche: 'lifestyle', platforms: V, seconds: 30, hook: 'process-open', captions: 'minimal-lower', audio: 'narration-music', grade: 'warm-golden', pacing: 'dynamic', beats: [
    { at: 0, dur: 1.3, role: 'hook', shot: 'process', motion: 'handheld', route: 'composite' },
    { at: 1.3, dur: 12.7, role: 'morning', shot: 'broll-a', motion: 'drift', route: 'composite' },
    { at: 14, dur: 10, role: 'work', shot: 'broll-b', motion: 'handheld', route: 'composite' },
    { at: 24, dur: 6, role: 'close', shot: 'hero', motion: 'pull-out', route: 'either' }
  ] },
  'behind-the-scenes': { label: 'Behind the scenes', niche: 'lifestyle', platforms: V, seconds: 20, hook: 'process-open', captions: 'minimal-lower', audio: 'ambience-only', grade: 'warm-golden', pacing: 'calm', beats: [
    { at: 0, dur: 1.3, role: 'hook', shot: 'process', motion: 'handheld', route: 'composite' },
    { at: 1.3, dur: 10.7, role: 'work', shot: 'process', motion: 'drift', route: 'composite' },
    { at: 12, dur: 8, role: 'result', shot: 'after', motion: 'push-in', route: 'composite' }
  ] },
  'reaction-commentary': { label: 'Reaction commentary', niche: 'commentary', platforms: V, seconds: 25, hook: 'contrast-cut', captions: 'karaoke-bold', audio: 'narration-clean', grade: 'neutral', pacing: 'dynamic', beats: [
    { at: 0, dur: 0.9, role: 'contrast', shot: 'broll-a', motion: 'snap', route: 'composite' },
    { at: 0.9, dur: 11.1, role: 'clip', shot: 'broll-a', motion: 'hold', route: 'composite' },
    { at: 12, dur: 13, role: 'take', shot: 'talking-head', motion: 'handheld', route: 'composite' }
  ] },
  'quote-card-motion': { label: 'Quote card in motion', niche: 'commentary', platforms: VS, seconds: 10, hook: 'quote-open', captions: 'single-line-center', audio: 'music-drive', grade: 'neutral', pacing: 'calm', beats: [
    { at: 0, dur: 1.4, role: 'quote', shot: 'texture', motion: 'slow-push', route: 'composite' },
    { at: 1.4, dur: 8.6, role: 'attribution', shot: 'hero', motion: 'drift', route: 'either' }
  ] },
  'documentary-chapter': { label: 'Documentary chapter', niche: 'documentary', platforms: H, seconds: 300, hook: 'number-claim', captions: 'minimal-lower', audio: 'narration-music', grade: 'film-vintage', pacing: 'calm', beats: [
    { at: 0, dur: 15, role: 'hook', shot: 'establish', motion: 'crane', route: 'composite' },
    { at: 15, dur: 105, role: 'context', shot: 'broll-a', motion: 'drift', route: 'composite' },
    { at: 120, dur: 120, role: 'evidence', shot: 'broll-b', motion: 'slow-push', route: 'composite' },
    { at: 240, dur: 60, role: 'conclusion', shot: 'hero', motion: 'pull-out', route: 'either' }
  ] },
  'what-if-micro-doc': { label: 'What-if micro documentary', niche: 'documentary', platforms: V, seconds: 25, hook: 'cold-question', captions: 'karaoke-bold', audio: 'narration-music', grade: 'cool-night', pacing: 'dynamic', beats: [
    { at: 0, dur: 1.2, role: 'question', shot: 'establish', motion: 'slow-push', route: 'composite' },
    { at: 1.2, dur: 11.8, role: 'model', shot: 'diagram', motion: 'drift', route: 'composite' },
    { at: 13, dur: 12, role: 'consequence', shot: 'hero', motion: 'push-in', route: 'either' }
  ] }
});

export const FORMAT_IDS = Object.freeze(Object.keys(FORMATS));

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const ROUTES = new Set(['composite', 'neural', 'either']);

/** Throws on the first structural problem. Returns the format when valid. */
export function validateFormat(id, format = FORMATS[id]) {
  const fail = message => { throw new RangeError(`format ${id}: ${message}`); };
  if (!format || typeof format !== 'object') fail('missing definition');
  if (!Array.isArray(format.beats) || format.beats.length === 0) fail('needs at least one beat');
  if (!HOOK_PATTERNS[format.hook]) fail(`unknown hook ${format.hook}`);
  if (!CAPTION_STYLES[format.captions]) fail(`unknown caption style ${format.captions}`);
  if (!AUDIO_BEDS[format.audio]) fail(`unknown audio bed ${format.audio}`);
  if (!GRADES[format.grade]) fail(`unknown grade ${format.grade}`);
  if (!PACING[format.pacing]) fail(`unknown pacing ${format.pacing}`);
  if (!Array.isArray(format.platforms) || format.platforms.length === 0) fail('needs platforms');
  for (const platform of format.platforms) {
    const spec = PLATFORM_SPECS[platform];
    if (!spec) fail(`unknown platform ${platform}`);
    if (format.seconds < spec.minSeconds) fail(`${format.seconds}s is below ${platform} minimum ${spec.minSeconds}s`);
    if (format.seconds > spec.maxSeconds) fail(`${format.seconds}s exceeds ${platform} maximum ${spec.maxSeconds}s`);
  }
  let cursor = 0;
  for (const [index, beat] of format.beats.entries()) {
    if (!(beat.dur > 0)) fail(`beat ${index} needs a positive duration`);
    if (Math.abs(beat.at - cursor) > 1e-6) fail(`beat ${index} starts at ${beat.at}s, expected ${cursor}s; beats must tile with no gap or overlap`);
    if (!CAMERA_MOVES[beat.motion]) fail(`beat ${index} unknown camera move ${beat.motion}`);
    if (!ROUTES.has(beat.route)) fail(`beat ${index} unknown route ${beat.route}`);
    if (typeof beat.shot !== 'string' || !beat.shot) fail(`beat ${index} needs a shot role`);
    cursor += beat.dur;
  }
  if (Math.abs(cursor - format.seconds) > 1e-6) fail(`beats total ${cursor}s but format declares ${format.seconds}s`);
  const opening = format.beats[0];
  const required = Math.min(HOOK_PATTERNS[format.hook].holdSeconds, format.seconds);
  if (opening.dur + 1e-6 < required) fail(`opening beat ${opening.dur}s is shorter than hook hold ${required}s`);
  return format;
}

/** Validates every format. Returns the ids checked. */
export function validateAllFormats() {
  return FORMAT_IDS.map(id => { validateFormat(id); return id; });
}

/* ------------------------------------------------------------------ */
/* Planning                                                            */
/* ------------------------------------------------------------------ */

const NICHE_HINTS = [
  [/anime|manga|cel[- ]?shad|2d animation/, 'anime'],
  [/product|unboxing|advert|brand|ecommerce|ugc/, 'product'],
  [/gadget|benchmark|spec|laptop|gpu|app|software|model demo|api/, 'tech'],
  [/explain|teach|tutorial|how to|lesson|myth/, 'education'],
  [/documentary|history|investigation|what if/, 'documentary'],
  [/song|music|beat|track|album/, 'music'],
  [/vlog|routine|day in|lifestyle|morning/, 'lifestyle'],
  [/reaction|commentary|review of|hot take/, 'commentary'],
  [/film|trailer|cinematic|movie/, 'cinematic'],
  [/story|character|narrative|horror/, 'story']
];

/** Best-effort niche guess from a brief. Falls back to 'general'. */
export function inferNiche(brief) {
  const text = String(brief ?? '').toLowerCase();
  for (const [pattern, niche] of NICHE_HINTS) if (pattern.test(text)) return niche;
  return 'general';
}

/**
 * Resolve one format for one platform into a renderable plan.
 *
 * Unresolved shot roles are reported in `missingShotRoles` and flip
 * `renderable` to false rather than being silently substituted, so a caller
 * can never ship a plan whose media does not exist.
 */
export function buildProductionPlan({ formatId, platform, brief = '', shots = {}, seed = 0, format: override = null } = {}) {
  const format = override ? validateFormat(formatId, override) : validateFormat(formatId);
  const spec = PLATFORM_SPECS[platform];
  if (!spec) throw new RangeError(`unknown platform ${platform}`);
  if (!format.platforms.includes(platform)) throw new RangeError(`format ${formatId} does not target ${platform}`);
  const organic = platform === 'instagram-reels' && spec.safeAreaOrganic;
  const missing = [];
  const timeline = format.beats.map((beat, index) => {
    const asset = shots[beat.shot] ?? null;
    if (!asset && beat.shot !== 'black') missing.push(beat.shot);
    return {
      index,
      startSeconds: beat.at,
      durationSeconds: beat.dur,
      role: beat.role,
      shotRole: beat.shot,
      assetId: asset?.assetId ?? null,
      motion: beat.motion,
      camera: CAMERA_MOVES[beat.motion],
      route: beat.route === 'either' ? 'composite' : beat.route
    };
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    formatId,
    formatLabel: format.label,
    niche: format.niche,
    platform,
    platformLabel: spec.label,
    canvas: spec.canvas,
    durationSeconds: format.seconds,
    hook: { id: format.hook, ...HOOK_PATTERNS[format.hook] },
    captionStyle: { id: format.captions, ...CAPTION_STYLES[format.captions] },
    audio: { id: format.audio, ...AUDIO_BEDS[format.audio] },
    grade: { id: format.grade, ...GRADES[format.grade] },
    pacing: { id: format.pacing, ...PACING[format.pacing] },
    safeArea: organic ? spec.safeAreaOrganic : spec.safeArea,
    safeAreaConfidence: organic ? spec.safeAreaOrganicConfidence : spec.safeAreaConfidence,
    platformPenalties: spec.penalties,
    timeline,
    neuralBeats: timeline.filter(beat => beat.route === 'neural').length,
    missingShotRoles: [...new Set(missing)],
    renderable: missing.length === 0,
    brief: String(brief).slice(0, 6000),
    seed,
    disclaimer: 'A format is a production hypothesis. It does not predict reach.'
  };
}

const round3 = value => Math.round(value * 1000) / 1000;

/**
 * Stretch or compress a format to a target duration, scaling every beat
 * proportionally. The opening beat is never scaled below its hook hold, and
 * the final beat absorbs rounding so the beats still tile exactly.
 *
 * This is how the library reaches evidence-aligned durations without
 * hand-authoring a second copy of every recipe.
 */
export function retimeFormat(formatId, targetSeconds, format = FORMATS[formatId]) {
  validateFormat(formatId, format);
  const target = Number(targetSeconds);
  if (!(target > 0)) throw new RangeError(`retime target must be positive, got ${targetSeconds}`);
  const hold = HOOK_PATTERNS[format.hook].holdSeconds;
  if (target < hold) throw new RangeError(`cannot retime ${formatId} to ${target}s; hook needs ${hold}s`);

  const scale = target / format.seconds;
  const beats = [];
  let cursor = 0;
  for (const [index, beat] of format.beats.entries()) {
    const last = index === format.beats.length - 1;
    let dur = last ? round3(target - cursor) : round3(beat.dur * scale);
    if (index === 0 && dur < hold) dur = round3(hold);
    if (!last && cursor + dur >= target) dur = round3(Math.max(0.1, target - cursor - 0.1));
    beats.push({ ...beat, at: round3(cursor), dur });
    cursor = round3(cursor + dur);
  }
  const drift = round3(target - cursor);
  if (Math.abs(drift) > 1e-9) {
    const tail = beats[beats.length - 1];
    tail.dur = round3(tail.dur + drift);
  }
  const retimed = { ...format, seconds: target, beats, retimedFrom: formatId, retimedFromSeconds: format.seconds };
  return validateFormat(`${formatId}@${target}s`, retimed);
}

/** Midpoint of the best observed view band for a platform, or null. */
export function evidenceOptimalSeconds(platform) {
  const evidence = DURATION_EVIDENCE[platform];
  if (!evidence) return null;
  const [low, high] = evidence.bestForViews;
  return Math.round((low + high) / 2);
}

/**
 * Cross formats with their platforms to produce many distinct plans.
 * Deterministic: identical inputs give identical ordering.
 *
 * With `includeEvidenceRetimes`, each format that falls in a platform's
 * weak duration band also yields a variant retimed into that platform's
 * best observed band, so the library offers an evidence-aligned option
 * rather than only the folklore-length one.
 */
export function expandVariants({ brief = '', niches = null, platforms = null, shots = {}, limit = 120, seed = 0, includeEvidenceRetimes = false } = {}) {
  const wantNiche = niches && niches.length ? new Set(niches) : null;
  const wantPlatform = platforms && platforms.length ? new Set(platforms) : null;
  const variants = [];
  for (const formatId of FORMAT_IDS) {
    const format = FORMATS[formatId];
    if (wantNiche && !wantNiche.has(format.niche)) continue;
    for (const platform of format.platforms) {
      if (wantPlatform && !wantPlatform.has(platform)) continue;
      if (variants.length >= limit) return variants;
      variants.push(buildProductionPlan({ formatId, platform, brief, shots, seed: seed + variants.length }));

      if (!includeEvidenceRetimes) continue;
      const target = evidenceOptimalSeconds(platform);
      const spec = PLATFORM_SPECS[platform];
      if (!target || target === format.seconds) continue;
      if (target < spec.minSeconds || target > spec.maxSeconds) continue;
      const probe = buildProductionPlan({ formatId, platform, brief, shots });
      if (!lintPlan(probe).some(w => w.code === 'WEAK_DURATION_BAND')) continue;
      if (variants.length >= limit) return variants;
      let retimed;
      try { retimed = retimeFormat(formatId, target); } catch { continue; }
      const plan = buildProductionPlan({ formatId, platform, brief, shots, seed: seed + variants.length, format: retimed });
      plan.variantOf = formatId;
      plan.variantReason = `retimed ${format.seconds}s -> ${target}s into the best observed band for ${spec.label}`;
      variants.push(plan);
    }
  }
  return variants;
}

/** How many distinct format-platform pairs the library can currently emit. */
export function countVariants({ niches = null, platforms = null } = {}) {
  return expandVariants({ niches, platforms, limit: Number.MAX_SAFE_INTEGER }).length;
}

/* ------------------------------------------------------------------ */
/* Duration evidence and plan linting                                  */
/* ------------------------------------------------------------------ */

/**
 * Observed duration/performance bands from the largest public datasets.
 *
 * These are SECONDARY (Socialinsider, ~6M posts per platform, Jan-Jun 2026),
 * not platform-published, and they are correlations across brand accounts,
 * not causal tests. They are recorded because they contradict the common
 * "algorithm favours 7-15 second videos" advice, which has no primary source
 * on either platform. Do not present these as guarantees.
 */
export const DURATION_EVIDENCE = Object.freeze({
  'instagram-reels': {
    source: 'https://www.socialinsider.io/blog/instagram-reels-length/',
    sampleSize: '~6M Instagram Reels from brand accounts, Jan-Jun 2026',
    confidence: 'secondary-correlational',
    bestForViews: [45, 60],
    bestForEngagement: [45, 60],
    weakBands: [[1, 30], [180, 1800]],
    note: 'The 1-30s band was the weakest measured for both views and engagement.'
  },
  tiktok: {
    source: 'https://www.socialinsider.io/blog/how-long-are-tiktok-videos/',
    sampleSize: '~6M TikTok videos, Jan-Jun 2026',
    confidence: 'secondary-correlational',
    bestForViews: [120, 180],
    bestForEngagement: [15, 30],
    weakBands: [[0, 15]],
    note: 'Engagement peaks at 15-30s but the 0-15s band had the lowest median views in the study.'
  },
  'youtube-shorts': {
    source: 'Paddy Galloway 5,400-Short study; Colin and Samir data (secondary, converging)',
    sampleSize: 'unstated',
    confidence: 'secondary-weak',
    bestForViews: [34, 43],
    bestForEngagement: [34, 43],
    weakBands: [],
    note: 'Multiple independent secondary analyses converge on a 34-43s default.'
  }
});

/**
 * Check a production plan against documented platform penalties and the
 * duration evidence above. Returns warnings; it never mutates the plan and
 * never blocks. Severity 'penalty' cites a platform-published rule;
 * 'evidence' cites the correlational duration data.
 */
export function lintPlan(plan) {
  const warnings = [];
  const spec = PLATFORM_SPECS[plan.platform];
  if (!spec) return warnings;

  const mutedBeds = new Set(['silent-caption']);
  if (mutedBeds.has(plan.audio.id) && spec.penalties.includes('muted-audio')) {
    warnings.push({
      severity: 'penalty',
      code: 'MUTED_AUDIO',
      message: `${spec.label} documents reduced visibility for muted reels; audio bed "${plan.audio.id}" produces no audio.`,
      source: spec.penaltySource
    });
  }

  if (plan.captionStyle.id !== 'none' && spec.penalties.includes('majority-text')) {
    const textHeavy = plan.timeline.every(beat => beat.shotRole === 'texture' || beat.shotRole === 'black');
    if (textHeavy) {
      warnings.push({
        severity: 'penalty',
        code: 'MAJORITY_TEXT',
        message: `${spec.label} documents reduced visibility for reels that are majority text; every beat in this plan is a text or blank plate.`,
        source: spec.penaltySource
      });
    }
  }

  const evidence = DURATION_EVIDENCE[plan.platform];
  if (evidence) {
    for (const [low, high] of evidence.weakBands) {
      if (plan.durationSeconds > low && plan.durationSeconds <= high) {
        warnings.push({
          severity: 'evidence',
          code: 'WEAK_DURATION_BAND',
          message: `${plan.durationSeconds}s sits in the ${low}-${high}s band, the weakest measured for ${spec.label}. Best observed: ${evidence.bestForViews[0]}-${evidence.bestForViews[1]}s.`,
          source: evidence.source,
          confidence: evidence.confidence
        });
        break;
      }
    }
  }

  return warnings;
}

/**
 * Publishing gate. YouTube's spam policy prohibits "using automated tools or
 * AI to churn out high volumes of similar content with minimal changes", and
 * Instagram makes accounts that mostly repost ineligible for recommendations.
 * A batch of near-identical variants is therefore a policy hazard, so this
 * library deliberately produces PLANS ONLY and refuses to describe a batch as
 * publish-ready. Publishing stays a separate, explicit, human action.
 */
export function assertNotBulkPublishable(variants) {
  if (!Array.isArray(variants)) throw new TypeError('variants array required');
  return {
    planCount: variants.length,
    publishReady: false,
    reason: 'Format variants are production plans, not approved uploads. Each output needs human review, a distinct creative edit, and its own publishing decision.',
    policy: [
      'https://support.google.com/youtube/answer/2801973',
      'https://creators.instagram.com/blog/rewarding-original-creators-on-instagram'
    ]
  };
}
