import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// A bounded, CPU-only local editorial pass. This does not invoke a renderer.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'docs', 'mahabharata');
const endpoint = 'http://127.0.0.1:11434';
const model = 'qwen3:4b-instruct';
const repairMode = process.argv.includes('--repair-narration');
const hash = text => createHash('sha256').update(text).digest('hex');
const baseText = await readFile(path.join(directory, 'production-script.json'), 'utf8');
const base = JSON.parse(baseText);
const researchText = await readFile(path.join(directory, 'SCRIPT_RESEARCH.md'), 'utf8');
const options = { num_gpu: 0, num_ctx: 4096, num_predict: repairMode ? 768 : 1800, temperature: 0.2, seed: repairMode ? 73620 : 73519 };
let format = {
  type: 'object', required: ['title', 'narration', 'shots', 'accuracyNotes'],
  properties: {
    title: { type: 'string' }, narration: { type: 'string' }, accuracyNotes: { type: 'array', items: { type: 'string' } },
    shots: { type: 'array', minItems: 6, maxItems: 6, items: { type: 'object', required: ['id', 'action', 'camera', 'sound'], properties: { id: { type: 'string' }, action: { type: 'string' }, camera: { type: 'string' }, sound: { type: 'string' } } } }
  }
};
let prompt = `You are VYREALM's LOCAL film script editor. Return JSON matching the schema. This is an original 30-second Mahabharata teaser titled BETWEEN TWO ARMIES. The following research facts were obtained by the production team from published scripture, NOT by you browsing the web. Ground your work only in these facts: Bhagavad Gita 1.21 has Arjuna ask Krishna to position the chariot between the armies at Kurukshetra. Gita 1.28-30 depicts Arjuna grieving on seeing his relatives and teachers; his body falters and Gandiva slips from his hand. Krishna is his charioteer and guide. Gita 2.47 teaches action without attachment to its fruit and does not endorse inaction. Gita 18.73 ends with Arjuna's restored resolve. The epic describes white horses, chariots, conches and army banners. Dawn lighting, specific faces and costumes are artistic interpretation, not archaeology. Sources: ${base.sourceReferences.map(s => s.url).join(' ')}\n\nImprove or retain this original narrator text at 48-58 words: ${base.narration}\n\nKeep these six shot identities, order and 5-second duration each: ${base.shots.map(s => `${s.id}: ${s.shotType}; ${s.motionPrompt}`).join('\n')}\n\nConstraints: compassionate moral dilemma, clear natural English, no invented scripture quotation, no "ancient destiny awakens" cliches, no prophecy or invincible warrior sales language, no magic powers or battle charge. One subtle visible action per shot, only restrained camera motion. Keep the two characters' exact faces, wardrobes and dawn lighting. Offscreen narration only, no lip-sync claim. Do not promise any quality or describe any shot as already rendered. Return six concise shot actions/cameras/sound descriptions that the local video model can execute, and 2-4 accuracy notes. Title must remain BETWEEN TWO ARMIES. Do not include commands or file paths.`;
if (repairMode) {
  format = { type: 'object', required: ['narration', 'accuracyNotes'], properties: { narration: { type: 'string', minLength: 200, maxLength: 600 }, accuracyNotes: { type: 'array', maxItems: 3, items: { type: 'string' } } } };
  prompt = `Write ONLY the original English narrator voiceover for a 30-second Mahabharata teaser. Produce a complete 45-65 word paragraph with a beginning, tension and an ending. Return it in the narration field, plus at most three brief accuracy notes.\nFacts supplied from Bhagavad Gita 1.21, 1.28-30, 2.47 and 18.73: Arjuna asks Krishna to stop their chariot between the armies at Kurukshetra. He sees his kin and teachers, grieves, and his bow slips. Krishna is his charioteer and counsels action without attachment to reward, not inaction. Arjuna eventually regains resolve.\nBe concrete and compassionate. Focus on kinship, the faltering bow and the moral choice. This is original narrator exposition, never a scripture quotation. Do not mention supernatural powers, guaranteed victory or destiny. Dawn is only an artistic lighting choice, not a fact established by these verses. No shot list. No screenplay directions. Do not end the paragraph prematurely. Count approximately 55 words.`;
}
const request = { model, system: 'Generate editable production data only. Use provided facts; do not invent evidence, citations or completed work.', prompt, format, stream: false, think: false, keep_alive: 0, options };
const started = new Date();
const evidence = {
  schemaVersion: 1, stage: repairMode ? 'local-narration-repair-pass' : 'local-script-editorial-pass', provider: 'ollama-loopback', endpoint, requestedModel: model,
  startedAt: started.toISOString(), options, keepAlive: 0,
  researchMethod: 'Production-team web research supplied as context; local model did not browse.',
  researchSha256: hash(researchText), baselineScriptSha256: hash(baseText), promptSha256: hash(prompt),
  request, acceptanceState: 'awaiting-human-readable-editorial-inspection', generatedVideo: false
};
await mkdir(directory, { recursive: true });
try {
  const tagsResponse = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!tagsResponse.ok) throw Error(`OLLAMA_TAGS_HTTP_${tagsResponse.status}`);
  const tags = await tagsResponse.json();
  const installed = tags.models?.find(m => m.name === model || m.model === model);
  if (!installed?.digest) throw Error('LOCAL_MODEL_NOT_INSTALLED_OR_DIGEST_MISSING');
  evidence.modelDigest = installed.digest;
  evidence.modelDetails = installed.details;
  const showResponse = await fetch(`${endpoint}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }), signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (showResponse.ok) {
    const show = await showResponse.json();
    evidence.templateInspection = { templateSha256: hash(show.template || ''), templateLength: show.template?.length, parameters: show.parameters, architecture: show.model_info?.['general.architecture'] };
  }
  const response = await fetch(`${endpoint}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(600000), redirect: 'error' });
  if (!response.ok) throw Error(`OLLAMA_GENERATE_HTTP_${response.status}`);
  const rawResponse = await response.text();
  evidence.responseSha256 = hash(rawResponse);
  evidence.rawResponse = rawResponse;
  const data = JSON.parse(rawResponse);
  evidence.responseModel = data.model;
  evidence.evalCount = data.eval_count;
  evidence.promptEvalCount = data.prompt_eval_count;
  evidence.totalDurationNs = data.total_duration;
  evidence.doneReason = data.done_reason;
  if (!data.done || !data.response) throw Error('LOCAL_MODEL_RESPONSE_INCOMPLETE');
  const draft = JSON.parse(data.response);
  evidence.draftFile = repairMode ? 'local-llm-repair-draft.json' : 'local-llm-draft.json';
  await writeFile(path.join(directory, evidence.draftFile), `${JSON.stringify(draft, null, 2)}\n`);
  const words = String(draft.narration || '').trim().split(/\s+/).length;
  if (!repairMode) {
    if (!Array.isArray(draft.shots) || draft.shots.length !== 6) throw Error('LOCAL_DRAFT_SHOT_COUNT_INVALID');
    if (!draft.shots.every((s, i) => s.id === base.shots[i].id)) throw Error('LOCAL_DRAFT_SHOT_IDENTITIES_CHANGED');
    if (draft.title !== base.title) throw Error('LOCAL_DRAFT_TITLE_CHANGED');
  }
  if (words < (repairMode ? 45 : 48) || words > (repairMode ? 65 : 58)) throw Error(`LOCAL_DRAFT_NARRATION_LENGTH_${words}`);
  evidence.structuralValidation = { passed: true, narrationWords: words, shots: draft.shots?.length };
  console.log(JSON.stringify({ model, digest: installed.digest, durationSeconds: (Date.now() - started.valueOf()) / 1000, narrationWords: words, draft }, null, 2));
} catch (error) {
  evidence.error = { message: error.message, name: error.name };
  evidence.acceptanceState = 'draft-rejected-preserve-researched-baseline';
  process.exitCode = 1;
  console.error(error.message);
} finally {
  evidence.finishedAt = new Date().toISOString();
  evidence.wallMs = Date.now() - started.valueOf();
  await writeFile(path.join(directory, repairMode ? 'local-llm-repair-evidence.json' : 'local-llm-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
}
