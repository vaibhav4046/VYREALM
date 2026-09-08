import { VIRAL_FORMATS, buildViralHooks, inferViralFormat } from './viral-formats.mjs';

/**
 * Delivery profiles are planning targets. They do not imply that a render or
 * platform upload exists; the production graph must create and verify media
 * before a variant can leave the `planned` state.
 */
export const VIRAL_DELIVERIES = Object.freeze({
  'instagram-reel': { label: 'Instagram Reel', aspectRatio: '9:16', width: 1080, height: 1920, durationSeconds: 30 },
  'youtube-short': { label: 'YouTube Short', aspectRatio: '9:16', width: 1080, height: 1920, durationSeconds: 35 },
  'youtube-film': { label: 'YouTube film', aspectRatio: '16:9', width: 1920, height: 1080, durationSeconds: 60 },
  'long-form': { label: 'Long-form chapter', aspectRatio: '16:9', width: 1920, height: 1080, durationSeconds: 180 },
  'anime-sequence': { label: 'Anime sequence', aspectRatio: '16:9', width: 1920, height: 1080, durationSeconds: 30 },
  'tech-explainer': { label: 'Tech explainer', aspectRatio: '16:9', width: 1920, height: 1080, durationSeconds: 45 },
  'product-demo': { label: 'Product demo', aspectRatio: '9:16', width: 1080, height: 1920, durationSeconds: 30 },
  'astra-demo': { label: 'Astra model demo', aspectRatio: '16:9', width: 1920, height: 1080, durationSeconds: 45 }
});

const DELIVERY_KEYS = Object.keys(VIRAL_DELIVERIES);
const FORMAT_KEYS = Object.keys(VIRAL_FORMATS);
const CAMERA_DIRECTIONS = Object.freeze([
  'close handheld push-in with motivated rack focus',
  'low tracking move through layered foreground and practical light',
  'slow orbit that preserves the subject silhouette and eyeline',
  'locked establishing frame followed by a measured dolly',
  'crane reveal from environmental detail to the subject',
  'documentary shoulder camera with purposeful reframing'
]);
const STORY_ARCS = Object.freeze([
  'hook, escalation, reveal',
  'question, evidence, consequence',
  'normal world, disruption, choice',
  'promise, proof, payoff',
  'mystery, pursuit, release',
  'before, transformation, after'
]);
const SOUND_PLANS = Object.freeze([
  'foreground foley leads into a restrained music lift',
  'diegetic ambience stays readable under a single impact cue',
  'rhythmic edit points follow footsteps, cuts, and one resolved hit',
  'quiet room tone opens space for narration before the final sting',
  'weather and crowd texture build while dialogue remains intelligible'
]);
const VISUAL_PRIORITIES = Object.freeze([
  'recognisable subject, expressive performance, and readable environment',
  'continuity of face, wardrobe, props, time of day, and light direction',
  'foreground, midground, background, depth of field, and controlled motion blur',
  'high-detail materials with stable text and logos only when requested',
  'original composition with no scraped footage, copied characters, or watermarks'
]);

function cleanBrief(value) {
  const brief = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!brief) throw new TypeError('A non-empty brief is required');
  return brief.slice(0, 240);
}

function pick(list, index) {
  return list[index % list.length];
}

function shotPlan(brief, delivery, index) {
  const count = delivery.durationSeconds >= 120 ? 6 : delivery.durationSeconds >= 45 ? 5 : 3;
  const duration = Number((delivery.durationSeconds / count).toFixed(3));
  return Array.from({ length: count }, (_, shotIndex) => ({
    id: `shot-${shotIndex + 1}`,
    start: Number((shotIndex * duration).toFixed(3)),
    duration,
    visualBrief: `${brief}; ${shotIndex === 0 ? 'establish the subject and world' : shotIndex === count - 1 ? 'resolve the action with a memorable final image' : 'advance the action while preserving continuity'}`,
    camera: pick(CAMERA_DIRECTIONS, index + shotIndex),
    audio: pick(SOUND_PLANS, index + shotIndex),
    status: 'needs-media'
  }));
}

export function buildViralVariants({ brief, count = 120, format, platform } = {}) {
  const clean = cleanBrief(brief);
  const total = Number(count);
  if (!Number.isInteger(total) || total < 1 || total > 256) throw new RangeError('count must be an integer from 1 to 256');
  if (format != null && format !== '' && !FORMAT_KEYS.includes(format)) throw new RangeError(`Unknown viral format: ${format}`);
  if (platform != null && platform !== '' && !DELIVERY_KEYS.includes(platform)) throw new RangeError(`Unknown delivery platform: ${platform}`);

  const selectedFormat = format || inferViralFormat(clean);
  const hookSet = buildViralHooks({ brief: clean, format: selectedFormat });
  const variants = Array.from({ length: total }, (_, index) => {
    const formatKey = format || pick(FORMAT_KEYS, index);
    const hooks = formatKey === selectedFormat ? hookSet.hooks : buildViralHooks({ brief: clean, format: formatKey }).hooks;
    const deliveryKey = platform || pick(DELIVERY_KEYS, index);
    const delivery = VIRAL_DELIVERIES[deliveryKey];
    const camera = pick(CAMERA_DIRECTIONS, index);
    const arc = pick(STORY_ARCS, index * 3);
    return {
      id: `variant-${String(index + 1).padStart(3, '0')}`,
      title: `${VIRAL_FORMATS[formatKey].label} · ${delivery.label} ${index + 1}`,
      format: formatKey,
      formatLabel: VIRAL_FORMATS[formatKey].label,
      platform: deliveryKey,
      hook: pick(hooks, index),
      storyArc: arc,
      cameraDirection: camera,
      visualPriority: pick(VISUAL_PRIORITIES, index),
      delivery: { ...delivery },
      shotPlan: shotPlan(clean, delivery, index),
      renderStatus: 'planned',
      provenance: { generatedBy: 'not-rendered', sourceMethod: 'deterministic-local-variation-plan' },
      requiredRoute: 'local-neural-provider-or-user-media',
      disclaimer: 'This is an original creative recipe. Reach, quality, and platform performance are not guaranteed.'
    };
  });
  return {
    brief: clean,
    variants,
    count: variants.length,
    source: 'deterministic-local-variation-plan',
    researchBasis: 'YouTube Shorts hook guidance, original narrative direction, recurring-character and rights-safe editing evidence',
    disclaimer: 'Recipes are editable plans. VYREALM must generate or import media and pass its visual/technical gates before marking any variant rendered.'
  };
}

