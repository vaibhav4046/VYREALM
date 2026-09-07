import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { synthesizeSoundDesign } from '../runtime/sound-design.mjs';
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1],out=resolve(value('--output'));await mkdir(out,{recursive:true});
try {
 const request=JSON.parse(await readFile(resolve(value('--input')),'utf8'));
 const {wave,evidence}=synthesizeSoundDesign(request);
 await writeFile(join(out,'sound-design.wav'),wave);
 const provenance={generationStatus:'generated',sourceMethod:evidence.sourceMethod,providerId:'local-dsp',modelId:null,outputHash:createHash('sha256').update(wave).digest('hex'),neuralModelInvoked:false};
 const result={status:'review_required',validated:true,provenance,evidence,outputs:{audio:'sound-design.wav',quality:'sound-design.json'}};
 await writeFile(join(out,'sound-design.json'),JSON.stringify(result,null,2));await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));
} catch(error) { await writeFile(join(out,'result.json'),JSON.stringify({status:'blocked',validated:false,diagnostics:[{code:'SOUND_DESIGN_FAILED',message:error.message}]})); }
