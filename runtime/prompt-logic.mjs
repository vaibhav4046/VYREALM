// Prompt logic for Wan2.2 TI2V-5B Q4 at 1024x576.
//
// Two jobs. (1) Name the constructions this model is documented or measured to
// break on, so the caller is warned before spending 1568 s on a shot. (2) Emit
// the prompt in the section order the vendor's own rewriter actually emits.
//
// Evidence: docs/research/WAN22_PROMPT_LEVERS.md (vendor system prompt, vendor
// negative prompt, ComfyUI 5B template, our own TASKS.md failures) and
// docs/research/AI_VIDEO_FAILURE_TAXONOMY.md (latent geometry: 32x spatial
// compression means a sub-32px face is under one latent token wide).
//
// Hard rule: this module never deletes or rewrites the user's brief. A trigger
// produces a warning plus a reframe the caller may take or ignore.

const failure = (code, message) => Object.assign(new Error(message), { code });

// PROVISIONAL DEFAULT, NOT A MEASUREMENT. No per-trigger failure rate has ever
// been measured on this pipeline, so these weights are an ordering heuristic and
// riskScore is not a probability. Only the shape is defensible, and it is stated
// rather than tuned: HIGH_TRIGGERS_TO_SATURATE high-risk triggers reach the 1.0
// cap, and a medium trigger counts a third of a high. Replace with measured
// accept/reject rates per trigger once the shot log carries them.
const HIGH_TRIGGERS_TO_SATURATE = 3;
export const RISK_WEIGHTS = Object.freeze({
  high: 1 / HIGH_TRIGGERS_TO_SATURATE,
  medium: 1 / (HIGH_TRIGGERS_TO_SATURATE * 3),
});
export const DYNAMIC_DEGREES = Object.freeze(['static', 'moderate', 'high']);

// Every pattern is case-insensitive and non-global (a /g regex carries
// lastIndex between calls and would silently skip matches).
export const FAILURE_TRIGGERS = Object.freeze([
  {
    id: 'readable-text',
    risk: 'high',
    pattern: /\b(?:readable|legible)\s+(?:text|writing|sign|signage|label)\b|\b(?:text|writing|lettering|caption|subtitle|slogan|inscription)\s+(?:on|that reads|reading|saying)\b|\bthat reads\b|\bwritten in\b|\b(?:signage|billboard|shopfront|storefront|newspaper|menu|number ?plate|licen[cs]e plate|name ?tag|neon sign|street sign)\b/i,
    why: 'The vendor guide states text renders approximately, and at 1024x576 a glyph sits inside a 32x32-pixel latent cell. Requested lettering comes back as garbled strokes.',
    reframe: 'Ask for illegible texture instead ("a sign with worn, unreadable lettering") and composite all in-piece text in post.',
  },
  {
    id: 'close-up-hands',
    risk: 'high',
    pattern: /\b(?:close[- ]?up|macro)\b[^.]{0,40}\b(?:hand|hands|finger|fingers|palm)\b|\b(?:hand|hands|fingers)\b[^.]{0,30}\bfill the frame\b|\bhands? (?:tying|typing|threading|weaving|knitting|sewing|shuffling|braiding|buttoning)\b|\bhandshake\b|\bshaking hands\b|\bfingers? (?:interlace|intertwine|interlock)/i,
    why: 'The vendor negative prompt spends four of its twenty-eight slots on hands (extra fingers, badly drawn hands, malformed limbs, fused fingers). Hands as subject is the single worst-defended composition.',
    reframe: 'Keep hands out of the frame or below the waist of a medium shot; carry the beat on the face or on an object the hand has already placed.',
  },
  {
    id: 'crowd',
    risk: 'high',
    pattern: /\b(?:crowd|crowds|crowded|packed|throng|bustling|swarm|swarming|mob|many people|lots of people|dozens of people|sea of (?:people|faces)|(?:distant|background|passing) people)\b|\bbusy(?: [\w-]+){0,3} (?:street|market|square|bar|restaurant|platform|station|sidewalk|pavement)\b/i,
    why: 'The vendor negative prompt actively suppresses 背景人很多 ("many people in the background"). Asking for the content the model authors chose to suppress fights the sampler.',
    reframe: 'Cap it at "a few figures in the middle distance" and use shallow depth of field so the background is a bokeh field rather than modelled people.',
  },
  {
    id: 'fast-complex-action',
    risk: 'high',
    pattern: /\b(?:sprints?|sprinting|chases?|chasing|fights?|fighting|punch(?:es|ing)?|kick(?:s|ing)|explosion|explodes|somersault|backflip|parkour|stampede|break[- ]?danc(?:e|ing))\b|(?<!\b(?:waves?|surf|sea|water|rain|thunder|storm)\s)\b(?:crash(?:es|ing)?|shatter(?:s|ing)?)\b|\bruns?\s+(?:toward|towards|through|across|away|into)\b|\brunning\s+(?:toward|towards|through|across|away|into)\b/i,
    why: 'VBench-2.0 Motion Rationality never exceeds 38.51% on any model, and our own shot 3 collapsed a two-beat action to its first beat. Limb-heavy motion also drives the duplicated-limb failures.',
    reframe: 'Generate the moment before or after the action (a braced stance, a settling aftermath) and let editing imply the violence.',
  },
  {
    id: 'multi-beat-action',
    risk: 'high',
    pattern: /\band then\b|,\s*then\b|\bthen (?:she|he|they|it)\b|\bbefore (?:turning|walking|running|stepping|opening|closing|reaching)\b|\bafter (?:turning|walking|standing|sitting|opening)\b/i,
    why: 'MEASURED on our own output: "duck and enter shelter" returned only the duck. Matches the vendor guide warning about long or complex action sequences.',
    reframe: 'One action verb per shot. Split the second beat into its own generation, or use a facial-expression arc, which is the one multi-beat form the vendor examples treat as safe.',
  },
  {
    id: 'scene-cut',
    risk: 'high',
    pattern: /\b(?:cut(?:s|ting)? to|cross[- ]?fade to|smash cut|jump cut|montage|intercut|scene change|we cut|then we see|second shot|another shot of)\b/i,
    why: 'The model does not cut. One generation is one continuous shot; VBench-2.0 Complex Plot sits at 10-12% for every model tested.',
    reframe: 'Split the brief into one shot per generation and assemble on the timeline, where the edit list also gives the quality gate its true cut positions.',
  },
  {
    id: 'lip-sync-dialogue',
    risk: 'high',
    pattern: /\blip[- ]?sync\w*\b|\b(?:says?|saying|whispers?|shouts?),?\s*["'“]|\bmouths the words\b|\bspeaks the line\b|\bdialogue\b|\brecit(?:es|ing)\b/i,
    why: 'The vendor guide lists lip-synced dialogue to specific words as unreliable, and there is no audio conditioning in this pipeline to align to.',
    reframe: 'Describe an expression arc with no named words ("his expression shifts from guarded to a small smile") and lay the line under it in the mix.',
  },
  {
    id: 'named-real-person',
    risk: 'high',
    pattern: /\b(?:celebrity|celebrities|famous (?:actor|actress|singer|politician|athlete|person)|look[- ]?alike|deepfake|impersonat(?:e|es|ing|ion)|real[- ]life (?:actor|celebrity))\b/i,
    why: 'The vendor guide lists named real people as rejected or inconsistent, and hosted models block them outright. Note honestly: a bare proper noun is not detectable by regex, so this only catches explicit framing.',
    reframe: 'Describe the person by build, age range, wardrobe and bearing instead of by identity.',
  },
  {
    id: 'extreme-close-up',
    risk: 'medium',
    pattern: /\b(?:extreme close[- ]?up|macro (?:shot|lens)|tight close[- ]?up on (?:the )?(?:eye|iris|lips|mouth|teeth|hand))\b/i,
    why: 'Two vendor negative slots defend the face (badly drawn face, disfigured). At 1024x576 we hold 576 latent tokens against the native 880, so fine facial structure is resolved at 65.5% of the tuned capacity.',
    reframe: 'Default to a medium or medium close-up shot. The vendor rewriter defaults to Medium shot and never emits an extreme close-up.',
  },
  {
    id: 'distant-small-face',
    risk: 'medium',
    pattern: /\b(?:tiny|small|distant|far[- ]?off|far[- ]away)\s+(?:figure|figures|person|people|face|faces|silhouette)\b|\bfigures? in the (?:far )?distance\b|\b(?:aerial|drone|satellite|extreme wide)\s+(?:shot|view)\b/i,
    why: 'Spatial compression is 32x. A face narrower than 32 pixels is under one latent token wide and cannot be represented at all, which is a geometric precondition rather than a taste judgement.',
    reframe: 'Either bring the subject in until the face is at least 32 pixels wide, or commit to silhouettes and drop faces from the shot entirely.',
  },
  {
    id: 'walking-locomotion',
    risk: 'medium',
    pattern: /\b(?:walks|walking)\b(?! (?:stick|cane|pace|distance|frame))|\b(?:strolls?|strolling|march(?:es|ing)|wanders?|wandering|steps? (?:forward|toward|towards)|approaches the camera)\b/i,
    why: 'The vendor negative prompt spends a slot on 倒着走 (walking backwards), and our shot 2 tracked from behind despite a front-facing request. Locomotion direction relative to the lens is weakly controlled.',
    reframe: 'Prefer a stationary or turning subject. If travel is required, keep the camera static and let the subject cross the frame laterally.',
  },
  {
    id: 'camera-relative-facing',
    risk: 'medium',
    pattern: /\b(?:faces? (?:the )?camera|facing (?:the )?camera|turns to (?:face )?(?:the )?camera|front[- ]facing|looks (?:directly )?(?:in)?to (?:the )?(?:camera|lens)|towards? the lens)\b/i,
    why: 'MEASURED on our own output: a front-facing request produced a back-tracking shot. Facing is not reliably obeyed when phrased as an instruction to the motion model.',
    reframe: 'Encode facing as a state in the subject clause ("a woman facing the lens") so the keyframe fixes it, rather than asking the motion stage to turn her.',
  },
  {
    id: 'open-sky-exposure',
    risk: 'medium',
    pattern: /\b(?:sky|skies|sunlight|sunbeam|bright sun|midday sun|sunrise|sunset|overexposed)\b/i,
    why: 'The vendor rewriter carries an explicit rule to rewrite any sky mention to an azure-blue sky to avoid blowing the exposure, and 过曝 (overexposure) holds a negative-prompt slot.',
    reframe: 'Say "azure blue sky" or move to overcast or practical light. Our own sample already runs 13.6% chroma-clipped pixels.',
  },
  {
    id: 'mood-prose',
    risk: 'medium',
    pattern: /\b(?:atmospheric|a sense of|full of (?:tension|longing|hope|dread)|evok(?:es|ing)|cinematic feel|emotionally (?:charged|resonant)|melanchol(?:y|ic)|dreamlike vibe|vibes?)\b/i,
    why: 'The vendor rewriter bans literary mood description outright ("不要输出关于氛围、感觉等文学描写"). It consumes encoder tokens without conditioning any pixel.',
    reframe: 'Replace the mood word with the physical cause of it: the light source, the weather, the posture.',
  },
  {
    id: 'negation-in-prompt',
    risk: 'medium',
    pattern: /\bno (?:text|watermark|logo|people|blur)\b|\bwithout (?:any )?(?:text|watermark|distortion|blur|people)\b|\bavoid \w+|\bdon'?t (?:show|include)\b|\bnot blurry\b/i,
    why: 'Negation in a positive prompt conditions on the very token it is trying to exclude. Every one of these terms already lives in the negative prompt.',
    reframe: 'Delete the negation from the brief; NEGATIVE_PROMPT already carries text, subtitles, watermark and blur.',
  },
  {
    id: 'explicit-stillness',
    risk: 'medium',
    pattern: /\b(?:motionless|unmoving|perfectly still|stands still|stays still|frozen in place|static (?:shot|frame|image)|no movement|nothing moves|freeze[- ]frame|holds? (?:her|his|their) pose)\b/i,
    why: 'Three of the vendor negative prompt slots defend against a still output (静态, 静止, 静止不动的画面). Asking for stillness lands squarely in the dominant 5B failure.',
    reframe: 'Hold the subject still but add ambient motion the model can spend energy on: rain, steam, drifting smoke, hair, fabric.',
  },
].map(t => Object.freeze(t)));

// Ambient/environmental motion, counted to decide dynamic degree. Global on
// purpose: we want every occurrence, and it is re-created per call by match().
const HIGH_DYNAMIC_CUE_COUNT = 4;
const MOTION_CUES = /\b(?:turns?|turning|walks?|walking|runs?|running|moves?|moving|drifts?|drifting|sways?|swaying|ripples?|rippling|flutters?|fluttering|billows?|billowing|falls?|falling|rises?|rising|blows?|blowing|flickers?|flickering|rain|snow|smoke|steam|wind|splash(?:es)?|breathes?|breathing|nods?|nodding|reach(?:es|ing)?|lifts?|lifting|push(?:es|ing)?|pulls?|pulling|glanc(?:e|es|ing)|blinks?|blinking|steps?|stepping)\b/gi;

export function analyseBrief(brief) {
  if (typeof brief !== 'string' || !brief.trim()) throw failure('BRIEF_REQUIRED', 'analyseBrief needs a non-empty brief string');
  const triggers = [];
  for (const t of FAILURE_TRIGGERS) {
    const hit = brief.match(t.pattern);
    if (hit) triggers.push({ id: t.id, risk: t.risk, why: t.why, reframe: t.reframe, matched: hit[0] });
  }
  const cues = new Set((brief.match(MOTION_CUES) || []).map(w => w.toLowerCase()));
  const has = id => triggers.some(t => t.id === id);
  // PROVISIONAL DEFAULT, NOT A MEASUREMENT. Distinct-cue count is a proxy for
  // how much motion the sampler is being asked for; it has not been correlated
  // against the measured dynamic degree the output detectors produce. Zero cues
  // and an explicit-stillness trigger are the only two non-arbitrary edges here.
  const dynamicDegree = has('fast-complex-action') || cues.size >= HIGH_DYNAMIC_CUE_COUNT ? 'high'
    : has('explicit-stillness') || cues.size === 0 ? 'static'
      : 'moderate';
  const riskScore = Math.min(1, Number(triggers.reduce((sum, t) => sum + RISK_WEIGHTS[t.risk], 0).toFixed(3)));
  return { triggers, riskScore, dynamicDegree };
}

// Closed vocabularies, copied from the vendor rewriter so the builder never
// invents a term the encoder was not tuned on.
export const SHOT_ROLES = Object.freeze({
  // 'detail' deliberately resolves to a medium close-up, never a close-up:
  // small structure is where 65.5% latent capacity hurts most.
  establishing: Object.freeze({ shotSize: 'Wide shot', composition: 'Center composition', shootingAngle: null }),
  hero: Object.freeze({ shotSize: 'Medium shot', composition: 'Center composition', shootingAngle: null }),
  reaction: Object.freeze({ shotSize: 'Medium close-up shot', composition: 'Balanced composition', shootingAngle: 'Over-the-shoulder shot' }),
  detail: Object.freeze({ shotSize: 'Medium close-up shot', composition: 'Center composition', shootingAngle: null }),
  closer: Object.freeze({ shotSize: 'Wide shot', composition: 'Symmetrical composition', shootingAngle: 'Low angle shot' }),
});

// The closed aesthetic vocabulary, transcribed from WAN22_PROMPT_LEVERS.md rule
// 12 (which reads it out of [REPO-SYS]). Exported so the test can prove that
// every tag this module emits is a member; a near-miss like "Low angle" or
// "Warm tone" is a token the encoder was never tuned on, which is the whole
// reason the vendor publishes a closed list.
export const AESTHETIC_VOCABULARY = Object.freeze({
  time: Object.freeze(['Day time', 'Night time', 'Dawn time', 'Sunrise time']),
  lightSource: Object.freeze(['Daylight', 'Artificial lighting', 'Moonlight', 'Practical lighting', 'Firelight', 'Fluorescent lighting', 'Overcast lighting', 'Sunny lighting']),
  lightIntensity: Object.freeze(['Soft lighting', 'Hard lighting']),
  lightAngle: Object.freeze(['Top lighting', 'Side lighting', 'Underlighting', 'Edge lighting']),
  tone: Object.freeze(['Warm colors', 'Cool colors', 'Mixed colors']),
  shotSize: Object.freeze(['Medium shot', 'Wide shot', 'Medium close-up shot', 'Close-up shot']),
  composition: Object.freeze(['Center composition', 'Balanced composition', 'Left-heavy composition', 'Right-heavy composition', 'Symmetrical composition']),
  shootingAngle: Object.freeze(['Over-the-shoulder shot', 'Low angle shot', 'High angle shot', 'Dutch angle shot', 'Aerial shot', 'Overhead shot']),
});

export const CAMERA_MOVES = Object.freeze(['push in', 'pull out', 'tracking shot', 'orbit', 'fixed camera', 'moves left', 'moves right', 'drone shot', 'fly-through', 'tilt up', 'tilt down', 'pan left', 'pan right']);

// Every time/source/intensity/tone below must be a member of
// AESTHETIC_VOCABULARY (the test enforces it). `closer` is prose for the
// closing sentence, which is a sentence rather than a tag and so is
// deliberately outside the closed vocabulary.
const LIGHT_PRESETS = Object.freeze([
  Object.freeze({ match: /\b(?:night|neon|midnight|after dark|street ?lamp|lamplight)\b/i, time: 'Night time', source: 'Practical lighting', intensity: 'Soft lighting', tone: 'Cool colors', closer: 'the practical lamps' }),
  Object.freeze({ match: /\b(?:fire|firelight|candle|hearth|campfire|torch)\b/i, time: 'Night time', source: 'Firelight', intensity: 'Soft lighting', tone: 'Warm colors', closer: 'the firelight' }),
  Object.freeze({ match: /\b(?:dawn|sunrise|first light)\b/i, time: 'Dawn time', source: 'Daylight', intensity: 'Soft lighting', tone: 'Warm colors', closer: 'the low sun' }),
  Object.freeze({ match: /\b(?:overcast|rain|raining|storm|fog|mist|drizzle)\b/i, time: 'Day time', source: 'Overcast lighting', intensity: 'Soft lighting', tone: 'Cool colors', closer: 'the overcast sky' }),
]);
const DEFAULT_LIGHT = Object.freeze({ time: 'Day time', source: 'Daylight', intensity: 'Soft lighting', tone: 'Warm colors', closer: 'the daylight' });

const AMBIENT = Object.freeze([
  Object.freeze({ match: /\b(?:rain|raining|drizzle|storm)\b/i, text: 'Rain keeps falling through the frame and beads run down every wet surface.' }),
  Object.freeze({ match: /\b(?:smoke|steam|fog|mist|dust)\b/i, text: 'Smoke and steam drift slowly across the frame throughout the shot.' }),
  Object.freeze({ match: /\b(?:tree|leaves|grass|field|forest)\b/i, text: 'Wind moves continuously through the leaves and grass.' }),
]);
const AMBIENT_FALLBACK = 'Air moves through the frame throughout the shot: hair and fabric shift continuously, dust drifts in the light.';

const MAX_PROMPT_WORDS = 100;
const NON_PHOTOREAL = /\b(?:2d|anime|cartoon|illustration|illustrated|painterly|watercolou?r|comic|line ?art|cel[- ]shaded)\b/i;

const optionalString = (value, code, label) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw failure(code, `${label} must be a string when provided`);
  return value.trim();
};

export function buildWanPrompt({ brief, shotRole = 'hero', camera, style, negative } = {}) {
  if (typeof brief !== 'string' || !brief.trim()) throw failure('BRIEF_REQUIRED', 'buildWanPrompt needs a non-empty brief string');
  if (!Object.hasOwn(SHOT_ROLES, shotRole)) throw failure('UNKNOWN_SHOT_ROLE', `shotRole must be one of ${Object.keys(SHOT_ROLES).join(', ')}`);
  const cameraText = optionalString(camera, 'INVALID_CAMERA', 'camera');
  const styleText = optionalString(style, 'INVALID_STYLE', 'style');
  const extraNegative = optionalString(negative, 'INVALID_NEGATIVE', 'negative');

  const subject = brief.trim();
  const analysis = analyseBrief(subject);
  const role = SHOT_ROLES[shotRole];
  const applied = ['structure.repo-sys-order', `role.${shotRole}`];
  const warnings = analysis.triggers.map(t => ({
    code: t.risk === 'high' ? 'PROMPT_HIGH_RISK' : 'PROMPT_MEDIUM_RISK',
    triggerId: t.id, risk: t.risk, matched: t.matched, why: t.why, suggestion: t.reframe,
  }));

  const light = LIGHT_PRESETS.find(p => p.match.test(subject)) || DEFAULT_LIGHT;
  // Vendor rule: camera movement and shooting angle compete, so a stated move
  // drops the angle tag.
  let shootingAngle = role.shootingAngle;
  if (cameraText && shootingAngle) { shootingAngle = null; applied.push('camera.drop-shooting-angle'); }

  let tags = [shootingAngle, role.shotSize, light.source, light.time, light.tone, light.intensity, role.composition].filter(Boolean);
  if (styleText && NON_PHOTOREAL.test(styleText)) { tags = []; applied.push('style.non-photoreal-drops-tags'); }
  else if (tags.length > 4) { tags = tags.slice(0, 4); applied.push('tags.cap-4'); }

  const sections = [];
  if (styleText) { sections.push({ id: 'style', text: `${styleText}.` }); applied.push('style.first'); }
  if (tags.length) sections.push({ id: 'tags', text: `${tags.join(', ')}.` });
  sections.push({ id: 'subject', text: subject.endsWith('.') ? subject : `${subject}.` });
  if (cameraText) {
    sections.push({ id: 'camera', text: `The camera holds one slow move: ${cameraText.replace(/\.$/, '')}.` });
    applied.push('camera.single-move');
    if (!CAMERA_MOVES.some(move => cameraText.toLowerCase().includes(move))) {
      warnings.push({ code: 'CAMERA_VOCABULARY_UNKNOWN', triggerId: null, risk: 'medium', matched: cameraText, why: `"${cameraText}" is outside the vendor's supported camera vocabulary and may be ignored by the sampler.`, suggestion: `Use one of: ${CAMERA_MOVES.join(', ')}.` });
    }
  }
  if (analysis.dynamicDegree === 'static') {
    sections.push({ id: 'ambient', text: (AMBIENT.find(a => a.match.test(subject)) || { text: AMBIENT_FALLBACK }).text });
    applied.push('ambient.injected-for-static');
  }
  if (tags.length) {
    sections.push({ id: 'light', text: `${light.intensity} from ${light.closer} shapes the subject and separates it from the background.` });
    applied.push('light.closer');
  }

  const prompt = sections.map(s => s.text).join(' ');
  const words = prompt.split(/\s+/).filter(Boolean).length;
  // The two vendor length numbers are in different units: the T2V rewriter says
  // 60-200 CHINESE CHARACTERS, the I2V rewriter says "100 words or less". Only
  // the second is denominated in words, so it is the one used here. Counting the
  // 200 as words would be twice the loosest thing the vendor actually says.
  if (words > MAX_PROMPT_WORDS) warnings.push({ code: 'PROMPT_TOO_LONG', triggerId: null, risk: 'medium', matched: `${words} words`, why: `The vendor I2V rewriter caps itself at ${MAX_PROMPT_WORDS} words. UMT5-XXL truncates at 512 tokens, so this is a quality warning, not a hard cap.`, suggestion: 'Cut appearance detail that the keyframe already carries.' });

  let negativePrompt = NEGATIVE_PROMPT;
  if (extraNegative) { negativePrompt = `${NEGATIVE_PROMPT}, ${extraNegative}`; applied.push('negative.caller-terms'); }
  else applied.push('negative.vendor-base');

  return { prompt, negative: negativePrompt, structure: sections, applied, warnings };
}

// The vendor default negative prompt, verbatim from wan/configs/shared_config.py
// and byte-identical in node 7 of the official ComfyUI 5B template. Kept in
// Chinese because that is the string the weights were validated against; every
// term is glossed here so nobody downstream has to guess.
const VENDOR_NEGATIVE_TERMS = [
  { term: '色调艳丽', gloss: 'garish colour grading', why: 'Suppresses oversaturation. Measured on our own output: 13.6% of pixels are chroma-clipped.' },
  { term: '过曝', gloss: 'overexposure', why: 'Blown highlights, the failure the vendor azure-sky rule also exists to dodge.' },
  { term: '静态', gloss: 'static', why: 'The dominant 5B failure: a still frame with no motion. One of three slots the vendor spends on it.' },
  { term: '细节模糊不清', gloss: 'indistinct blurry detail', why: 'Detail mush, which Q4 quantisation makes more likely than the FP16 baseline.' },
  { term: '字幕', gloss: 'subtitles', why: 'Burned-in captions. All in-piece text is composited in post.' },
  { term: '风格', gloss: 'style', why: 'Part of the four-term cluster pushing output away from "a depicted artwork" toward live footage.' },
  { term: '作品', gloss: 'an artwork', why: 'Same cluster: stops the model composing a gallery piece instead of a shot.' },
  { term: '画作', gloss: 'a painting', why: 'Same cluster: suppresses painterly rendering.' },
  { term: '画面', gloss: 'a picture', why: 'Same cluster: suppresses framed-image composition.' },
  { term: '静止', gloss: 'motionless', why: 'Second of three anti-static slots.' },
  { term: '整体发灰', gloss: 'overall grey cast', why: 'Washed-out low-contrast output.' },
  { term: '最差质量', gloss: 'worst quality', why: 'Generic quality anchor.' },
  { term: '低质量', gloss: 'low quality', why: 'Generic quality anchor.' },
  { term: 'JPEG压缩残留', gloss: 'JPEG compression residue', why: 'Blocking and ringing. Matters more for us than for an FP16 user because Q4_K_M is where banding appears first.' },
  { term: '丑陋的', gloss: 'ugly', why: 'Generic aesthetic anchor.' },
  { term: '残缺的', gloss: 'mutilated or incomplete', why: 'Truncated anatomy at the frame edge.' },
  { term: '多余的手指', gloss: 'extra fingers', why: 'One of four hand slots, the model family’s worst-defended structure.' },
  { term: '画得不好的手部', gloss: 'badly drawn hands', why: 'Hand slot two of four; hands are this model family’s worst-defended structure.' },
  { term: '画得不好的脸部', gloss: 'badly drawn face', why: 'Face slot one. Q4 reportedly shows face drift before anything else.' },
  { term: '畸形的', gloss: 'deformed', why: 'General anatomy, the catch-all for bodies the sampler resolves wrongly.' },
  { term: '毁容的', gloss: 'disfigured', why: 'Face slot two. Faces drift within a single shot even on frontier models.' },
  { term: '形态畸形的肢体', gloss: 'malformed limbs', why: 'Hand and limb slot three.' },
  { term: '手指融合', gloss: 'fused fingers', why: 'Hand slot four: fingers melting into each other, the classic diffusion tell.' },
  { term: '静止不动的画面', gloss: 'a completely motionless frame', why: 'Third of three anti-static slots. The weighting is the vendor telling us what breaks most.' },
  { term: '杂乱的背景', gloss: 'cluttered background', why: 'Background chaos, which shallow depth of field also suppresses by construction.' },
  { term: '三条腿', gloss: 'three legs', why: 'Limb duplication: an extra limb appearing part-way through the shot.' },
  { term: '背景人很多', gloss: 'many people in the background', why: 'Crowds. Our own smoke prompt used to request exactly this, fighting the negative.' },
  { term: '倒着走', gloss: 'walking backwards', why: 'Reversed locomotion. MEASURED on our shot 2: a front-facing request tracked from behind.' },
];

// Ours, appended. These name degenerate modes the vendor list does not cover.
const LOCAL_NEGATIVE_TERMS = [
  { term: 'slideshow', gloss: null, why: 'A sequence of near-duplicate frames rather than continuous motion; our stall detector fires on the same failure.' },
  { term: 'geometric primitives', gloss: null, why: 'The degenerate output when the sampler fails to resolve a subject at all.' },
  { term: 'vector art', gloss: null, why: 'Flat-fill rendering with no texture, a Q4 collapse mode.' },
  { term: 'watermark', gloss: null, why: 'Training-data watermarks, which the vendor list covers only for subtitles.' },
  { term: 'black empty background', gloss: null, why: 'The void background the model falls back to when the scene clause is too thin.' },
  { term: 'unstable geometry', gloss: null, why: 'Structure that changes shape between frames; matches the non-rigid morphing our homography-inlier metric detects.' },
  { term: 'morphing face', gloss: null, why: 'Identity drift within one shot, measured at 69-79% identity consistency across all frontier models.' },
  { term: 'flickering texture', gloss: null, why: 'High-frequency temporal noise, the failure VBench temporal flickering scores.' },
  { term: 'duplicated subject', gloss: null, why: 'A second copy of the subject appearing mid-shot, reported for W4 quantisation.' },
];

export const NEGATIVE_TERMS = Object.freeze([...VENDOR_NEGATIVE_TERMS, ...LOCAL_NEGATIVE_TERMS].map(t => Object.freeze(t)));

export const NEGATIVE_PROMPT = `${VENDOR_NEGATIVE_TERMS.map(t => t.term).join('，')}，${LOCAL_NEGATIVE_TERMS.map(t => t.term).join(', ')}`;

// Only `steps` is a real bound: it mirrors the executable guard in
// runtime/neural-production.mjs (steps < 1 || steps > 30 throws
// NEURAL_PROFILE_OUT_OF_BOUNDS). cfg and shift are ADVISORY ONLY — wanWorkflow()
// hardcodes cfg: 5 in the KSampler node and shift: 8 in ModelSamplingSD3 and
// accepts neither as a parameter, so nothing recommendSampler returns for those
// two can currently reach the graph. cfg [3,7] is the [REPLICATE] sweep band
// (Wan2.1 14B, a different model). shift [4,9] spans the lowest cell of the
// planned §5.6 sweep to the top of that same sweep. Neither is measured here.
export const SAMPLER_BOUNDS = Object.freeze({ steps: Object.freeze([1, 30]), cfg: Object.freeze([3, 7]), shift: Object.freeze([4, 9]) });

export function recommendSampler({ dynamicDegree = 'moderate', shotRole = 'hero' } = {}) {
  if (!DYNAMIC_DEGREES.includes(dynamicDegree)) throw failure('UNKNOWN_DYNAMIC_DEGREE', `dynamicDegree must be one of ${DYNAMIC_DEGREES.join(', ')}`);
  if (!Object.hasOwn(SHOT_ROLES, shotRole)) throw failure('UNKNOWN_SHOT_ROLE', `shotRole must be one of ${Object.keys(SHOT_ROLES).join(', ')}`);
  const wantsStructure = dynamicDegree === 'high' || shotRole === 'detail';
  const steps = wantsStructure ? 24 : 20;
  return {
    steps, cfg: 5, shift: 8, sampler: 'uni_pc', scheduler: 'simple',
    rationale: [
      'vendor: uni_pc + simple, cfg 5, shift 8 and 20 steps are the official ComfyUI 5B template verbatim. We match it on every axis except resolution.',
      'third-party: cfg 5 sits inside the only published sweep band (3-7), which was run on Wan2.1 14B, not on this model. Our own output is measured at 13.6% chroma-clipped, but the oversaturation knee is unmeasured, so cfg is not moved on theory.',
      'advisory: wanWorkflow() hardcodes cfg 5 and shift 8 and accepts neither as an argument, so those two fields are documentation until the workflow builder takes them. Only steps is actually applied to the graph.',
      'contested: SD3 scaling implies shift 6.5 at 1024x576 while the only published sweep prefers 7-9. Shift stays at 8 until the 4-cell sweep runs.',
      wantsStructure
        ? `unverified: ${steps} steps for ${dynamicDegree === 'high' ? 'high dynamic degree' : 'detail-role'} shots is a bounded preference, not a measured optimum. At the measured 78.4 s per step that is about ${Math.round(steps * 78.4)} s per 121-frame shot.`
        : `vendor default: 20 steps, about ${Math.round(steps * 78.4)} s per 121-frame shot at the measured 78.4 s per step.`,
    ],
  };
}
