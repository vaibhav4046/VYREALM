/**
 * Small, deterministic planning vocabulary for original short-form stories.
 * These are format hypotheses, not promises of reach or copies of a creator's
 * script. The renderer remains responsible for real media and provenance.
 */

export const VIRAL_FORMATS = Object.freeze({
  'recurring-character': {
    label: 'Recurring character micro-series',
    hooks: [
      'Meet the character who keeps returning to {brief}.',
      'The {brief} episode starts with one rule — then breaks it.',
      'What happens when the same hero faces {brief}?'
    ]
  },
  'hybrid-augmentation': {
    label: 'Hybrid real-footage augmentation',
    hooks: [
      'This footage looked normal until {brief} changed.',
      'Watch the real world collide with {brief}.',
      'We filmed the moment {brief} appeared.'
    ]
  },
  'transformation-loop': {
    label: 'Impossible transformation loop',
    hooks: [
      '{brief} changes state — and the ending returns to the first frame.',
      'Look closely: {brief} is about to break its own rules.',
      'The transformation starts before you notice.'
    ]
  },
  'what-if-documentary': {
    label: 'What-if micro-documentary',
    hooks: [
      'What if {brief} happened for ten seconds?',
      'One question changes everything: {brief}.',
      'Here is the consequence nobody models: {brief}.'
    ]
  },
  'micro-horror': {
    label: 'Micro-horror or emotional twist',
    hooks: [
      'Everything is normal in {brief} — until the sound stops.',
      'Something in {brief} is watching back.',
      'The last detail in {brief} changes the story.'
    ]
  },
  'product-proof': {
    label: 'Product proof story',
    hooks: [
      'This is the problem {brief} solves in one shot.',
      'See {brief} prove it before the timer ends.',
      'We tested {brief} where it matters.'
    ]
  },
  'commentary-remix': {
    label: 'Commentary or rights-cleared remix',
    hooks: [
      'The clip says one thing; {brief} reveals another.',
      'Here is what the original footage misses about {brief}.',
      'Watch the edit, then decide what {brief} means.'
    ]
  }
});

const FORMAT_KEYS = new Set(Object.keys(VIRAL_FORMATS));

function cleanBrief(value) {
  const brief = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!brief) throw new TypeError('A non-empty brief is required');
  return brief.slice(0, 240);
}

export function inferViralFormat(brief) {
  const text = cleanBrief(brief).toLowerCase();
  if (/product|demo|advert|brand|camera|app|service/.test(text)) return 'product-proof';
  if (/footage|filmed|raw video|real person|webcam|phone video|street/.test(text)) return 'hybrid-augmentation';
  if (/what if|counterfactual|alternate history|why did|how would/.test(text)) return 'what-if-documentary';
  if (/horror|haunt|ghost|scary|fear|unseen sound/.test(text)) return 'micro-horror';
  if (/transform|melting|unravel|liquid|loop|infinite zoom/.test(text)) return 'transformation-loop';
  if (/commentary|reaction|review|explain this|clip/.test(text)) return 'commentary-remix';
  return 'recurring-character';
}

export function buildViralHooks({ brief, format } = {}) {
  const clean = cleanBrief(brief);
  const selected = format == null || format === '' ? inferViralFormat(clean) : format;
  if (!FORMAT_KEYS.has(selected)) throw new RangeError(`Unknown viral format: ${selected}`);
  const definition = VIRAL_FORMATS[selected];
  return {
    format: selected,
    formatLabel: definition.label,
    hooks: definition.hooks.map(template => template.replaceAll('{brief}', clean)),
    source: 'deterministic-local-format-template',
    researchBasis: 'YouTube Shorts hook guidance; original narrative and recurring-character case studies',
    disclaimer: 'A hook is a creative hypothesis; virality is not guaranteed.'
  };
}
