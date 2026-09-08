/**
 * VYREALM preset taxonomy.
 *
 * Higgsfield's defensible layer is not the models it rents — it is the named
 * control surface: 65 camera controls, speed ramps, colour looks, lighting
 * intents. Every one of those is a deterministic parameter bundle, which is
 * exactly the part that ports to a local FFmpeg pipeline unchanged. This
 * module is that vocabulary, as data.
 *
 * Names are transcribed from docs/research/HIGGSFIELD_FULL_SURFACE_2026-09-07.md
 * (which cites the public gallery pages it read). No preset name was invented
 * where the research recorded a real one. No code was copied — only the
 * taxonomy of control names.
 *
 * Deliberately NOT mirrored: camera names whose effect is optical or temporal
 * rather than positional — Fisheye, Focus Change, Low Shutter, Hyperlapse,
 * Timelapse Glam/Human/Landscape. A zoom/pan/roll bundle cannot honour those,
 * and shipping the name over an approximate body would be a silent lie about
 * what the render will contain. Lighting entries use standard cinematography
 * vocabulary because Higgsfield's own six lighting preset names are recorded
 * as UNVERIFIED in the research — inventing six names to fill that slot would
 * be worse than naming the real technique.
 *
 * `zoom` is a fractional scale delta across the beat, matching the convention
 * in format-render.mjs: 1.0 means a full 2x push, the hard ceiling. `panX`
 * and `panY` are fractions of the frame. validateAllPresets() enforces every
 * bound and throws PRESET_OUT_OF_RANGE rather than letting a bad bundle reach
 * the renderer.
 */

export const SCHEMA_VERSION = 1;

const fail = (code, message, extra = {}) => {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  Object.assign(error, extra);
  throw error;
};

export const EASINGS = Object.freeze(['linear', 'ease-in', 'ease-out', 'ease-in-out']);
export const CAMERA_CATEGORIES = Object.freeze(['basic', 'epic', 'handheld', 'product-orbit']);
export const TRANSITION_KINDS = Object.freeze(['cut', 'dissolve', 'wipe', 'flash', 'whip', 'zoom']);
export const KEY_DIRECTIONS = Object.freeze([
  'front', 'front-left', 'front-top', 'side-left', 'side-right', 'back', 'top', 'ambient'
]);

/* ------------------------------------------------------------------ */
/* Camera presets                                                      */
/* ------------------------------------------------------------------ */

/**
 * Defaults keep each entry to the fields that actually differ.
 *
 * Interop warning: four ids here also exist in format-library's CAMERA_MOVES
 * — static, handheld, tilt-up, tilt-down — and the tilt pair carries different
 * numbers there (zoom 0.02 / panY 0.08 vs zoom 0 / panY 0.1). They are real
 * move names, so renaming them to dodge the clash would be the dishonest fix.
 * Whoever wires these two tables together must namespace the lookup rather
 * than merge it, or a preset id will silently resolve to the other table's
 * values.
 */
const cam = (label, category, o) => Object.freeze({
  label, category, zoom: 0, panX: 0, panY: 0, rollDeg: 0, intensity: 1, jitter: 0, easing: 'ease-in-out', ...o
});

export const CAMERA_PRESETS = Object.freeze({
  /* --- basic moves (Higgsfield "Basic Camera Control") --- */
  static: cam('Static', 'basic', { intensity: 0, easing: 'linear' }),
  'zoom-in': cam('Zoom In', 'basic', { zoom: 0.12 }),
  'zoom-out': cam('Zoom Out', 'basic', { zoom: -0.12 }),
  'dolly-in': cam('Dolly In', 'basic', { zoom: 0.1 }),
  'dolly-out': cam('Dolly Out', 'basic', { zoom: -0.1 }),
  'dolly-left': cam('Dolly Left', 'basic', { zoom: 0.02, panX: -0.09 }),
  'dolly-right': cam('Dolly Right', 'basic', { zoom: 0.02, panX: 0.09 }),
  'pan-left': cam('Pan Left', 'basic', { panX: -0.12 }),
  'pan-right': cam('Pan Right', 'basic', { panX: 0.12 }),
  'tilt-up': cam('Tilt Up', 'basic', { panY: -0.1 }),
  'tilt-down': cam('Tilt Down', 'basic', { panY: 0.1 }),
  'arc-left': cam('Arc Left', 'basic', { zoom: 0.04, panX: -0.11, rollDeg: -2 }),
  'arc-right': cam('Arc Right', 'basic', { zoom: 0.04, panX: 0.11, rollDeg: 2 }),
  overhead: cam('Overhead', 'basic', { zoom: 0.05, panY: 0.06 }),
  incline: cam('Incline', 'basic', { zoom: 0.03, panY: -0.05, rollDeg: 3 }),
  'jib-up': cam('Jib Up', 'basic', { zoom: 0.03, panY: -0.12, intensity: 1.1 }),
  'jib-down': cam('Jib Down', 'basic', { zoom: 0.03, panY: 0.12, intensity: 1.1 }),
  'crane-up': cam('Crane Up', 'basic', { zoom: 0.06, panY: -0.14, intensity: 1.2 }),
  'crane-down': cam('Crane Down', 'basic', { zoom: 0.06, panY: 0.14, intensity: 1.2 }),
  'dutch-angle': cam('Dutch Angle', 'basic', { zoom: 0.03, rollDeg: 12, intensity: 0.8 }),

  /* --- epic / dramatic (Higgsfield "Epic Camera Control") --- */
  'bullet-time': cam('Bullet Time', 'epic', { zoom: 0.08, panX: 0.18, intensity: 2.2, easing: 'ease-out' }),
  'crash-zoom-in': cam('Crash Zoom In', 'epic', { zoom: 0.45, intensity: 3.5, easing: 'ease-in' }),
  'crash-zoom-out': cam('Crash Zoom Out', 'epic', { zoom: -0.45, intensity: 3.5, easing: 'ease-in' }),
  'super-dolly-in': cam('Super Dolly In', 'epic', { zoom: 0.6, intensity: 2.4 }),
  'super-dolly-out': cam('Super Dolly Out', 'epic', { zoom: -0.6, intensity: 2.4 }),
  'dolly-zoom-in': cam('Dolly Zoom In', 'epic', { zoom: 0.3, panX: 0.02, intensity: 2 }),
  'dolly-zoom-out': cam('Dolly Zoom Out', 'epic', { zoom: -0.3, panX: -0.02, intensity: 2 }),
  'aerial-pullback': cam('Aerial Pullback', 'epic', { zoom: -0.7, panY: -0.1, intensity: 2.6, easing: 'ease-out' }),
  'fpv-drone': cam('FPV Drone', 'epic', { zoom: 0.28, panX: 0.08, panY: -0.06, rollDeg: 6, intensity: 2.8, jitter: 0.006, easing: 'ease-in' }),
  'hero-cam': cam('Hero Cam', 'epic', { zoom: 0.14, panY: -0.07, rollDeg: -3, intensity: 1.6 }),
  'car-chasing': cam('Car Chasing', 'epic', { zoom: 0.22, panX: 0.12, intensity: 2.4, jitter: 0.008, easing: 'linear' }),
  'road-rush': cam('Road Rush', 'epic', { zoom: 0.35, panY: 0.04, intensity: 3, jitter: 0.005, easing: 'ease-in' }),
  'robo-arm': cam('Robo Arm', 'epic', { zoom: 0.18, panX: 0.14, panY: -0.08, intensity: 2 }),
  'crane-over-the-head': cam('Crane Over The Head', 'epic', { zoom: 0.12, panY: -0.2, intensity: 1.8 }),
  'through-object-in': cam('Through Object In', 'epic', { zoom: 0.55, intensity: 3.2, easing: 'ease-in' }),
  'through-object-out': cam('Through Object Out', 'epic', { zoom: -0.55, intensity: 3.2, easing: 'ease-out' }),
  'earth-zoom-out': cam('Earth Zoom Out', 'epic', { zoom: -0.9, intensity: 4, easing: 'ease-in' }),
  'helicopter-shot': cam('Helicopter Shot', 'epic', { zoom: 0.08, panX: 0.16, panY: -0.05, rollDeg: 4, intensity: 1.8 }),
  'whip-pan': cam('Whip Pan', 'epic', { zoom: 0.05, panX: 0.42, intensity: 4.5, jitter: 0.004 }),
  'rapid-zoom-in': cam('Rapid Zoom In', 'epic', { zoom: 0.3, intensity: 3, easing: 'ease-in' }),
  'rapid-zoom-out': cam('Rapid Zoom Out', 'epic', { zoom: -0.3, intensity: 3, easing: 'ease-in' }),
  'flying-cam-transition': cam('Flying Cam Transition', 'epic', { zoom: 0.4, panX: 0.2, panY: -0.1, rollDeg: 8, intensity: 3.4, easing: 'ease-in' }),

  /* --- handheld / body-mounted --- */
  handheld: cam('Handheld', 'handheld', { zoom: 0.03, panX: 0.02, panY: 0.02, jitter: 0.004, easing: 'linear' }),
  snorricam: cam('Snorricam', 'handheld', { zoom: 0.04, rollDeg: 5, intensity: 1.2, jitter: 0.01, easing: 'linear' }),
  wiggle: cam('Wiggle', 'handheld', { zoom: 0.02, intensity: 1.4, jitter: 0.012, easing: 'linear' }),
  bts: cam('BTS', 'handheld', { zoom: 0.04, panX: 0.05, panY: 0.02, intensity: 1.2, jitter: 0.007, easing: 'linear' }),
  'buckle-up': cam('Buckle Up', 'handheld', { zoom: 0.06, panY: 0.04, intensity: 1.5, jitter: 0.011, easing: 'linear' }),
  'car-grip': cam('Car Grip', 'handheld', { zoom: 0.05, panX: 0.07, intensity: 1.7, jitter: 0.014, easing: 'linear' }),
  'head-tracking': cam('Head Tracking', 'handheld', { zoom: 0.04, panX: 0.06, intensity: 1.3, jitter: 0.005 }),
  pov: cam('POV', 'handheld', { zoom: 0.07, panX: 0.03, panY: 0.03, intensity: 1.6, jitter: 0.009, easing: 'linear' }),
  glam: cam('Glam', 'handheld', { zoom: 0.06, panY: -0.03, intensity: 0.9, jitter: 0.002, easing: 'ease-out' }),
  'eyes-in': cam('Eyes In', 'handheld', { zoom: 0.5, panY: -0.04, intensity: 3, jitter: 0.003, easing: 'ease-in' }),
  'mouth-in': cam('Mouth In', 'handheld', { zoom: 0.5, panY: 0.05, intensity: 3, jitter: 0.003, easing: 'ease-in' }),

  /* --- product orbit variants --- */
  '360-orbit': cam('360 Orbit', 'product-orbit', { zoom: 0.03, panX: 0.3, intensity: 1.6 }),
  '3d-rotation': cam('3D Rotation', 'product-orbit', { zoom: 0.04, panX: 0.22, rollDeg: 6, intensity: 1.5 }),
  'lazy-susan': cam('Lazy Susan', 'product-orbit', { zoom: 0.02, panX: 0.18, intensity: 1.2, easing: 'linear' }),
  'double-dolly': cam('Double Dolly', 'product-orbit', { zoom: 0.12, panX: 0.1, intensity: 1.8 }),
  'yoyo-zoom': cam('YoYo Zoom', 'product-orbit', { zoom: 0.16, intensity: 2 }),
  'object-pov': cam('Object POV', 'product-orbit', { zoom: 0.2, panY: 0.04, intensity: 1.9, jitter: 0.004, easing: 'ease-in' })
});

/* ------------------------------------------------------------------ */
/* Speed ramps                                                         */
/* ------------------------------------------------------------------ */

/**
 * Playback-rate keyframes, evenly spaced across the beat. 1 is real time,
 * below 1 is slow motion. Cinema Studio's "Auto" ramp is not mirrored: it
 * means "the engine picks", and there is no engine here doing the picking.
 */
export const SPEED_RAMPS = Object.freeze({
  linear: { label: 'Linear', curve: [1, 1] },
  'flash-in': { label: 'Flash In', curve: [2.4, 1] },
  'flash-out': { label: 'Flash Out', curve: [1, 2.4] },
  'slow-mo': { label: 'Slow-mo', curve: [0.45, 0.45] },
  'bullet-time': { label: 'Bullet Time', curve: [1, 0.18, 1] },
  impact: { label: 'Impact', curve: [1, 0.3, 1.6] },
  'ramp-up': { label: 'Ramp Up', curve: [0.7, 1.8] },
  'fast-sprint': { label: 'Fast Sprint', curve: [1, 2.6, 1.4] },
  hyperlapse: { label: 'Hyperlapse', curve: [4, 4] }
});

/* ------------------------------------------------------------------ */
/* Colour looks                                                        */
/* ------------------------------------------------------------------ */

/**
 * temperature/tint are -1..1 shifts, contrast/saturation/gain are multipliers,
 * lift is an additive black-level offset, grain and vignette are 0..1 amounts.
 */
const look = (label, o) => Object.freeze({
  label, temperature: 0, tint: 0, contrast: 1, saturation: 1, lift: 0, gain: 1, grain: 0, vignette: 0, ...o
});

export const LOOK_PRESETS = Object.freeze({
  realistic: look('Realistic', {}),
  movie: look('Movie', { temperature: 0.06, contrast: 1.14, saturation: 0.96, lift: 0.02, vignette: 0.18 }),
  noir: look('Noir', { temperature: -0.06, contrast: 1.42, saturation: 0.05, lift: -0.03, grain: 0.07, vignette: 0.34 }),
  'hallway-noir': look('Hallway Noir', { temperature: -0.14, contrast: 1.3, saturation: 0.42, lift: -0.02, grain: 0.05, vignette: 0.4 }),
  'cold-vision': look('Cold Vision', { temperature: -0.32, tint: -0.08, contrast: 1.16, saturation: 0.86, vignette: 0.2 }),
  ultraviolet: look('Ultraviolet', { temperature: -0.2, tint: 0.34, contrast: 1.2, saturation: 1.3, gain: 1.04, vignette: 0.24 }),
  toxic: look('Toxic', { temperature: -0.1, tint: -0.36, contrast: 1.18, saturation: 1.24, vignette: 0.16 }),
  lava: look('Lava', { temperature: 0.38, tint: 0.08, contrast: 1.24, saturation: 1.22, gain: 1.06, vignette: 0.26 }),
  marble: look('Marble', { temperature: -0.04, contrast: 1.08, saturation: 0.62, lift: 0.04, gain: 1.08 }),
  'two-color': look('Two Color', { temperature: 0.22, tint: -0.22, contrast: 1.3, saturation: 1.18, vignette: 0.22 }),
  overexposed: look('Overexposed', { temperature: 0.08, contrast: 0.88, saturation: 0.8, lift: 0.12, gain: 1.24 }),
  'static-glow': look('Static Glow', { temperature: 0.05, contrast: 0.94, saturation: 0.9, lift: 0.08, gain: 1.12, grain: 0.1 }),
  'nicotine-glow': look('Nicotine Glow', { temperature: 0.26, tint: -0.1, contrast: 1.04, saturation: 0.88, lift: 0.05, grain: 0.06 }),
  'clouded-dream': look('Clouded Dream', { temperature: 0.04, tint: 0.06, contrast: 0.86, saturation: 0.78, lift: 0.1, gain: 1.06 }),
  'foggy-morning': look('Foggy Morning', { temperature: -0.08, contrast: 0.82, saturation: 0.7, lift: 0.12, gain: 1.02 }),
  'rainy-day': look('Rainy Day', { temperature: -0.16, tint: -0.04, contrast: 0.96, saturation: 0.74, lift: 0.04, vignette: 0.14 }),
  'night-beach': look('Night Beach', { temperature: -0.26, contrast: 1.18, saturation: 0.84, lift: -0.02, vignette: 0.3 }),
  'sunset-beach': look('Sunset Beach', { temperature: 0.3, tint: 0.06, contrast: 1.06, saturation: 1.16, gain: 1.04, vignette: 0.12 }),
  'green-editorial': look('Green Editorial', { temperature: -0.06, tint: -0.28, contrast: 1.12, saturation: 1.04, vignette: 0.16 }),
  'quiet-luxury': look('Quiet Luxury', { temperature: 0.08, contrast: 1.02, saturation: 0.82, lift: 0.03, gain: 1.02 }),
  japandi: look('Japandi', { temperature: 0.1, tint: -0.04, contrast: 0.98, saturation: 0.76, lift: 0.05, gain: 1.04 }),
  geominimal: look('Geominimal', { contrast: 1.1, saturation: 0.68, gain: 1.06 }),
  grunge: look('Grunge', { temperature: -0.04, tint: -0.06, contrast: 1.22, saturation: 0.72, lift: 0.04, grain: 0.14, vignette: 0.28 }),
  'indie-sleaze': look('Indie Sleaze', { temperature: 0.02, contrast: 1.28, saturation: 1.06, lift: 0.06, gain: 1.14, grain: 0.16, vignette: 0.2 }),
  '90s-grain': look('90s Grain', { temperature: 0.12, contrast: 0.98, saturation: 0.88, lift: 0.05, grain: 0.2 }),
  '90s-editorial': look('90s Editorial', { temperature: 0.06, contrast: 1.16, saturation: 0.82, grain: 0.12, vignette: 0.18 }),
  '2000s-cam': look('2000s Cam', { temperature: 0.14, tint: -0.06, contrast: 1.1, saturation: 1.12, grain: 0.15, vignette: 0.22 }),
  y2k: look('Y2K', { temperature: 0.1, tint: 0.12, contrast: 1.14, saturation: 1.28, gain: 1.08, grain: 0.08 }),
  '2049': look('2049', { temperature: 0.34, tint: 0.1, contrast: 1.2, saturation: 0.9, lift: 0.02, vignette: 0.32 }),
  cctv: look('CCTV', { temperature: -0.12, contrast: 1.34, saturation: 0.24, lift: 0.06, grain: 0.24, vignette: 0.3 }),
  iphone: look('iPhone', { temperature: 0.02, contrast: 1.06, saturation: 1.14, gain: 1.02 }),
  'digital-camera': look('Digital Camera', { temperature: 0.04, contrast: 1.02, saturation: 1.06, grain: 0.05 }),
  '35mm-film': look('35mm Film', { temperature: 0.1, contrast: 1.08, saturation: 0.94, lift: 0.03, grain: 0.09, vignette: 0.14 }),
  '8mm-film': look('8mm Film', { temperature: 0.24, tint: -0.08, contrast: 1.12, saturation: 0.8, lift: 0.07, grain: 0.26, vignette: 0.3 }),
  'dv-camcorder': look('DV Camcorder', { temperature: -0.06, tint: 0.04, contrast: 1.2, saturation: 1.08, lift: 0.05, grain: 0.18, vignette: 0.16 })
});

/* ------------------------------------------------------------------ */
/* Transitions                                                         */
/* ------------------------------------------------------------------ */

/**
 * `xfadeName` is the literal FFmpeg xfade transition, so the render layer can
 * pass it straight through. A hard cut has none, by definition. Only names
 * whose mechanism xfade can actually perform are listed: the VFX-style named
 * transitions in the research (Raven, Melt, Smoke, Splash...) need generated
 * pixels, and mapping those onto a pixelize wipe would sell a name we cannot
 * render.
 *
 * Known duplicate: `flash-in` and `flash-out` both resolve to fadewhite at the
 * same duration, so today they render identically — xfade has no directional
 * flash. They are kept as separate intents for the caller, not as a promise of
 * two different pictures. Anything picking a transition for its LOOK should
 * treat the (xfadeName, durationSeconds) pair as the identity, not the id.
 */
export const TRANSITIONS = Object.freeze({
  cut: { label: 'Cut', kind: 'cut', durationSeconds: 0 },
  dissolve: { label: 'Dissolve', kind: 'dissolve', durationSeconds: 0.5, xfadeName: 'dissolve' },
  'cross-fade': { label: 'Cross Fade', kind: 'dissolve', durationSeconds: 0.4, xfadeName: 'fade' },
  'fade-black': { label: 'Fade To Black', kind: 'dissolve', durationSeconds: 0.6, xfadeName: 'fadeblack' },
  'fade-white': { label: 'Fade To White', kind: 'dissolve', durationSeconds: 0.5, xfadeName: 'fadewhite' },
  pixelize: { label: 'Pixelize', kind: 'dissolve', durationSeconds: 0.4, xfadeName: 'pixelize' },
  'flash-in': { label: 'Flash In', kind: 'flash', durationSeconds: 0.18, xfadeName: 'fadewhite' },
  'flash-out': { label: 'Flash Out', kind: 'flash', durationSeconds: 0.18, xfadeName: 'fadewhite' },
  'column-wipe': { label: 'Column Wipe', kind: 'wipe', durationSeconds: 0.45, xfadeName: 'vertopen' },
  'wipe-left': { label: 'Wipe Left', kind: 'wipe', durationSeconds: 0.4, xfadeName: 'wipeleft' },
  'wipe-right': { label: 'Wipe Right', kind: 'wipe', durationSeconds: 0.4, xfadeName: 'wiperight' },
  'wipe-up': { label: 'Wipe Up', kind: 'wipe', durationSeconds: 0.4, xfadeName: 'wipeup' },
  'wipe-down': { label: 'Wipe Down', kind: 'wipe', durationSeconds: 0.4, xfadeName: 'wipedown' },
  'circle-open': { label: 'Circle Open', kind: 'wipe', durationSeconds: 0.5, xfadeName: 'circleopen' },
  'circle-close': { label: 'Circle Close', kind: 'wipe', durationSeconds: 0.5, xfadeName: 'circleclose' },
  'radial-sweep': { label: 'Radial Sweep', kind: 'wipe', durationSeconds: 0.5, xfadeName: 'radial' },
  'whip-left': { label: 'Whip Left', kind: 'whip', durationSeconds: 0.22, xfadeName: 'smoothleft' },
  'whip-right': { label: 'Whip Right', kind: 'whip', durationSeconds: 0.22, xfadeName: 'smoothright' },
  'whip-blur': { label: 'Whip Blur', kind: 'whip', durationSeconds: 0.25, xfadeName: 'hblur' },
  'crash-zoom': { label: 'Crash Zoom', kind: 'zoom', durationSeconds: 0.3, xfadeName: 'zoomin' }
});

/* ------------------------------------------------------------------ */
/* Lighting intents                                                    */
/* ------------------------------------------------------------------ */

/**
 * These describe the intent a shot should be lit or relit toward; nothing
 * here relights existing footage on its own. `contrastRatio` is key:fill.
 */
export const LIGHTING_PRESETS = Object.freeze({
  'high-key': { label: 'High Key', keyDirection: 'front', contrastRatio: 2, colorTempK: 5600 },
  'low-key': { label: 'Low Key', keyDirection: 'side-right', contrastRatio: 8, colorTempK: 3600 },
  rembrandt: { label: 'Rembrandt', keyDirection: 'front-left', contrastRatio: 4, colorTempK: 5200 },
  butterfly: { label: 'Butterfly', keyDirection: 'front-top', contrastRatio: 3, colorTempK: 5600 },
  split: { label: 'Split', keyDirection: 'side-left', contrastRatio: 8, colorTempK: 4800 },
  'rim-backlight': { label: 'Rim Backlight', keyDirection: 'back', contrastRatio: 6, colorTempK: 6500 },
  'top-light': { label: 'Top Light', keyDirection: 'top', contrastRatio: 5, colorTempK: 5000 },
  'golden-hour': { label: 'Golden Hour', keyDirection: 'side-left', contrastRatio: 3, colorTempK: 3200 },
  'overcast-soft': { label: 'Overcast Soft', keyDirection: 'ambient', contrastRatio: 1.5, colorTempK: 6500 },
  practical: { label: 'Practical', keyDirection: 'front-left', contrastRatio: 3, colorTempK: 2900 },
  'neon-mixed': { label: 'Neon Mixed', keyDirection: 'side-right', contrastRatio: 5, colorTempK: 8000 },
  moonlight: { label: 'Moonlight', keyDirection: 'back', contrastRatio: 6, colorTempK: 9000 },
  firelight: { label: 'Firelight', keyDirection: 'front-left', contrastRatio: 5, colorTempK: 1900 }
});

/* ------------------------------------------------------------------ */
/* Resolution, easing, validation                                      */
/* ------------------------------------------------------------------ */

const REGISTRIES = Object.freeze({
  camera: CAMERA_PRESETS,
  ramp: SPEED_RAMPS,
  look: LOOK_PRESETS,
  transition: TRANSITIONS,
  lighting: LIGHTING_PRESETS
});

/**
 * Easing over `frames`, in terms of zoompan's `on` output frame index
 * normalised to 0..1. Matches the expression convention already used by
 * format-render.mjs (`...*on/${frames}`) so the two compose.
 *
 * Every returned expression is a single parenthesised arithmetic term that
 * contains NO filtergraph metacharacter (no comma, colon, quote, bracket or
 * backslash). That is a hard contract, not a nicety: a comma inside an
 * unquoted filter option splits the filterchain, so the obvious piecewise
 * `if(lt(t,0.5),...)` form of ease-in-out only survives inside quotes.
 * ease-in-out is therefore the comma-free smoothstep 3t^2-2t^3, which has the
 * same endpoints and monotonicity and embeds anywhere.
 *
 * Note the inherited off-by-one: zoompan's `on` runs 0..frames-1, so the beat
 * reaches 1-1/frames rather than 1. That is format-render.mjs's convention and
 * is matched deliberately; diverging here would desynchronise the two.
 */
export function buildEasingExpression(easing, frames) {
  if (!EASINGS.includes(easing)) {
    fail('UNKNOWN_EASING', `${easing}; valid: ${EASINGS.join(', ')}`, { easing, validEasings: [...EASINGS] });
  }
  if (!Number.isInteger(frames) || frames < 1) {
    fail('INVALID_FRAME_COUNT', `frames must be a positive integer, got ${frames}`, { frames });
  }
  const t = `(on/${frames})`;
  if (easing === 'linear') return t;
  if (easing === 'ease-in') return `(${t}*${t})`;
  if (easing === 'ease-out') return `(1-(1-${t})*(1-${t}))`;
  return `(${t}*${t}*(3-2*${t}))`;
}

/** Look one preset up. Never guesses; an unknown id names the valid ones. */
export function resolvePreset(kind, id) {
  const table = Object.hasOwn(REGISTRIES, kind) ? REGISTRIES[kind] : undefined;
  if (!table) {
    fail('UNKNOWN_PRESET_KIND', `${kind}; valid kinds: ${Object.keys(REGISTRIES).join(', ')}`,
      { kind, validKinds: Object.keys(REGISTRIES) });
  }
  if (typeof id !== 'string' || !Object.hasOwn(table, id)) {
    fail('UNKNOWN_PRESET', `no ${kind} preset "${id}"; valid ids: ${Object.keys(table).join(', ')}`,
      { kind, id, validIds: Object.keys(table) });
  }
  return table[id];
}

/** Table sizes, for the evidence record. */
export function presetCounts(registries = REGISTRIES) {
  return {
    cameras: Object.keys(registries.camera).length,
    ramps: Object.keys(registries.ramp).length,
    looks: Object.keys(registries.look).length,
    transitions: Object.keys(registries.transition).length,
    lighting: Object.keys(registries.lighting).length
  };
}

const RANGES = Object.freeze({
  camera: { zoom: [-1, 1], panX: [-0.5, 0.5], panY: [-0.5, 0.5], rollDeg: [-30, 30], intensity: [0, 5], jitter: [0, 0.05] },
  ramp: {},
  look: { temperature: [-1, 1], tint: [-1, 1], contrast: [0.5, 2], saturation: [0, 2], lift: [-0.3, 0.3], gain: [0.5, 1.5], grain: [0, 0.3], vignette: [0, 1] },
  transition: { durationSeconds: [0, 2] },
  lighting: { contrastRatio: [1, 16], colorTempK: [1500, 12000] }
});

const MINIMUM_COUNTS = Object.freeze({ cameras: 40, ramps: 8, looks: 20, transitions: 12, lighting: 8 });

const oneOf = (kind, id, field, value, allowed) => {
  if (!allowed.includes(value)) {
    fail('PRESET_INVALID_ENUM', `${kind} ${id}.${field} = ${value}; valid: ${allowed.join(', ')}`,
      { kind, id, field, value });
  }
};

const SHAPE_CHECKS = Object.freeze({
  camera: (id, entry) => {
    oneOf('camera', id, 'category', entry.category, CAMERA_CATEGORIES);
    oneOf('camera', id, 'easing', entry.easing, EASINGS);
  },
  ramp: (id, entry) => {
    if (!Array.isArray(entry.curve) || entry.curve.length < 2) {
      fail('PRESET_INVALID_CURVE', `ramp ${id} needs at least two rate keyframes`, { id });
    }
    for (const rate of entry.curve) {
      if (!Number.isFinite(rate) || rate <= 0 || rate > 8) {
        fail('PRESET_OUT_OF_RANGE', `ramp ${id} rate ${rate} outside 0 (exclusive) to 8`, { kind: 'ramp', id, value: rate });
      }
    }
  },
  look: () => {},
  transition: (id, entry) => {
    oneOf('transition', id, 'kind', entry.kind, TRANSITION_KINDS);
    const needsXfade = entry.kind !== 'cut';
    if (needsXfade && (typeof entry.xfadeName !== 'string' || !entry.xfadeName)) {
      fail('PRESET_MISSING_XFADE', `transition ${id} is a ${entry.kind} and needs an xfadeName`, { id });
    }
    if (!needsXfade && entry.xfadeName !== undefined) {
      fail('PRESET_UNEXPECTED_XFADE', `transition ${id} is a cut and must not carry an xfadeName`, { id });
    }
    if (needsXfade && entry.durationSeconds <= 0) {
      fail('PRESET_OUT_OF_RANGE', `transition ${id} duration must be positive for kind ${entry.kind}`,
        { kind: 'transition', id, field: 'durationSeconds', value: entry.durationSeconds });
    }
    if (!needsXfade && entry.durationSeconds !== 0) {
      fail('PRESET_OUT_OF_RANGE', `transition ${id} is a cut and must have duration 0`,
        { kind: 'transition', id, field: 'durationSeconds', value: entry.durationSeconds });
    }
  },
  lighting: (id, entry) => oneOf('lighting', id, 'keyDirection', entry.keyDirection, KEY_DIRECTIONS)
});

/**
 * Range and shape check across every table. Takes the registries as an
 * argument so a caller (or a test) can validate a candidate set before it is
 * frozen into the library. Returns evidence; throws a coded Error on the
 * first violation rather than quietly clamping a bad value.
 */
export function validateAllPresets(registries = REGISTRIES) {
  let checked = 0;
  for (const [kind, bounds] of Object.entries(RANGES)) {
    const table = registries[kind];
    if (!table || typeof table !== 'object') {
      fail('PRESET_KIND_MISSING', `no ${kind} table supplied`, { kind });
    }
    for (const [id, entry] of Object.entries(table)) {
      if (!entry || typeof entry.label !== 'string' || !entry.label.trim()) {
        fail('PRESET_LABEL_MISSING', `${kind} ${id} has no label`, { kind, id });
      }
      for (const [field, [min, max]] of Object.entries(bounds)) {
        const value = entry[field];
        if (!Number.isFinite(value)) {
          fail('PRESET_FIELD_MISSING', `${kind} ${id}.${field} is not a finite number`, { kind, id, field, value });
        }
        if (value < min || value > max) {
          fail('PRESET_OUT_OF_RANGE', `${kind} ${id}.${field} = ${value}, allowed ${min}..${max}`, { kind, id, field, value });
        }
      }
      SHAPE_CHECKS[kind](id, entry);
      checked += 1;
    }
  }
  const counts = presetCounts(registries);
  for (const [key, minimum] of Object.entries(MINIMUM_COUNTS)) {
    if (counts[key] < minimum) {
      fail('PRESET_TABLE_TOO_SMALL', `${key} has ${counts[key]}, contract needs ${minimum}`,
        { table: key, count: counts[key], minimum });
    }
  }
  return { schemaVersion: SCHEMA_VERSION, checked, ...counts };
}
