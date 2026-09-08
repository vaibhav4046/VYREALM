import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { produceNeuralSmoke } from '../runtime/neural-production.mjs';
const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1];
const output = resolve(value('--output'));
await mkdir(output, { recursive: true });
try {
  const request = JSON.parse(await readFile(resolve(value('--input')), 'utf8'));
  await produceNeuralSmoke({ output, reference: request.reference, prompt: request.brief || undefined, seed: request.seed || 7092026, steps: request.steps || 20, frames: request.frames || 121, onProgress: progress => { console.log(JSON.stringify({ progressEvent: true, ...progress })); void writeFile(join(output, 'progress.json'), JSON.stringify(progress)); } });
} catch (error) {
  const result = { status: 'blocked', code: error.code || 'NEURAL_GENERATION_FAILED', provenance: { generationStatus: 'blocked' }, diagnostics: [{ code: error.code || 'NEURAL_GENERATION_FAILED', message: error.message }] };
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.error(error.stack);
}
