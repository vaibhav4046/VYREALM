import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { enhanceNeuralClip } from '../runtime/neural-enhancement.mjs';
const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1],output=resolve(value('--output'));await mkdir(output,{recursive:true});
try{const request=JSON.parse(await readFile(value('--input'),'utf8'));await enhanceNeuralClip({input:request.sourcePath,receiptPath:request.receiptPath,output,onProgress:e=>console.log(JSON.stringify({progressEvent:true,...e}))});}
catch(error){await writeFile(join(output,'result.json'),JSON.stringify({status:'blocked',validated:false,provenance:{generationStatus:'blocked'},diagnostics:[{code:'ENHANCEMENT_FAILED',message:error.message}]}));console.error(error.stack);}
