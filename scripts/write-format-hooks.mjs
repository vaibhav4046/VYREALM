/**
 * Write one on-screen hook line per format, using the local LLM.
 *
 * The caption is the first thing a viewer reads and the single biggest lever
 * on whether they keep watching, so it must be specific to the format's hook
 * STRUCTURE rather than generic copy. That structure lives in HOOK_PATTERNS.
 *
 * Runs against loopback Ollama. If Ollama is unreachable the script falls back
 * to a deterministic template and SAYS SO in the output, because a silently
 * degraded hook would be indistinguishable from a written one.
 *
 *   node scripts/write-format-hooks.mjs [--model qwen3:4b-instruct] [--out path]
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMATS, FORMAT_IDS, HOOK_PATTERNS } from '../runtime/format-library.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OLLAMA = process.env.VYRELUM_OLLAMA || 'http://127.0.0.1:11434';

const SUBJECT = 'VYREALM, a filmmaking studio that runs entirely on your own laptop with no cloud, no credits and no limits';

function templateHook(formatId) {
  const format = FORMATS[formatId];
  return `${format.label}. Made offline on one laptop.`;
}

async function askOllama(model, prompt, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0.8, num_predict: 80 }
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const body = await res.json();
    return String(body.response ?? '').trim();
  } finally {
    clearTimeout(timer);
  }
}

/** Strip reasoning tags, quotes and stray labels a small model tends to emit. */
export function cleanHookLine(raw) {
  let text = String(raw ?? '');
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, ' ');
  text = text.replace(/^[\s\S]*?(?:hook|caption|line)\s*[:\-]\s*/i, '');
  text = text.split('\n').map(l => l.trim()).filter(Boolean)[0] ?? '';
  text = text.replace(/^["'`*\s]+|["'`*\s]+$/g, '');
  text = text.replace(/\s+/g, ' ');
  return text;
}

/**
 * A usable hook is short, plain, not the model narrating itself, and above all
 * makes NO factual claim we cannot stand behind.
 *
 * A small model will happily invent statistics: one run produced "1,200 hours
 * of film made on one laptop", a number nobody measured, which would then have
 * been burned into a video as a claim. Any digit or quantity word is therefore
 * rejected outright. A hook is allowed to be evocative; it is not allowed to
 * assert a measurement.
 */
const FABRICATED_CLAIM = /\d|\b(?:hundreds?|thousands?|millions?|billions?|percent|x faster|times faster)\b/i;

export function isUsableHook(text) {
  if (!text) return false;
  const words = text.split(/\s+/).length;
  if (words < 4 || words > 26) return false;
  if (/^(sure|here|okay|certainly|i )/i.test(text)) return false;
  if (/[{}<>]|http/i.test(text)) return false;
  if (FABRICATED_CLAIM.test(text)) return false;
  return true;
}

async function main() {
  const argv = process.argv.slice(2);
  const model = argv.includes('--model') ? argv[argv.indexOf('--model') + 1] : 'qwen3:4b-instruct';
  const outPath = resolve(root, argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'runtime/assets/format-hooks.json');

  let ollamaUp = true;
  try {
    const ping = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
    ollamaUp = ping.ok;
  } catch { ollamaUp = false; }
  console.log(ollamaUp ? `ollama reachable, using ${model}` : 'ollama UNREACHABLE - every line will be templated');

  const hooks = {};
  let written = 0;
  let templated = 0;

  for (const formatId of FORMAT_IDS) {
    const format = FORMATS[formatId];
    const hook = HOOK_PATTERNS[format.hook];
    let line = null;
    let source = 'template';

    if (ollamaUp) {
      const prompt = `You write on-screen captions for short videos. Write ONE caption line, 6 to 14 words.

The video promotes: ${SUBJECT}
The video's format is: ${format.label} (niche: ${format.niche})
The opening must follow this structure: ${hook.rule}

Rules: plain spoken English. No hashtags, no emoji, no quotes, no preamble. Do not describe the video, write the words that appear ON SCREEN. Output only the line.`;
      try {
        const cleaned = cleanHookLine(await askOllama(model, prompt));
        if (isUsableHook(cleaned)) { line = cleaned; source = `ollama:${model}`; written++; }
      } catch { /* fall through to template */ }
    }

    if (!line) { line = templateHook(formatId); templated++; }
    hooks[formatId] = { line, source, hookPattern: format.hook, formatLabel: format.label };
    console.log(`${source === 'template' ? '[tmpl]' : '[llm ]'} ${formatId}: ${line}`);
  }

  const doc = {
    schemaVersion: 1,
    subject: SUBJECT,
    model: ollamaUp ? model : null,
    generatedBy: ollamaUp ? 'local-ollama' : 'deterministic-template',
    counts: { total: FORMAT_IDS.length, fromModel: written, templated },
    hooks
  };
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(doc, null, 2), 'utf8');
  console.log(`\n${written} written locally, ${templated} templated -> ${outPath}`);
}

const invokedDirectly = process.argv[1]
  && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`;
if (invokedDirectly) await main();
