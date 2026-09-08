import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { interpolateVideo } from '../runtime/frame-interpolation.mjs';
const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1],out=resolve(value('--output'));
await mkdir(out,{recursive:true});
try{const input=JSON.parse(await readFile(value('--input'),'utf8'));await interpolateVideo({...input,output:out,onProgress:e=>console.log(JSON.stringify({progressEvent:true,...e}))});}
catch(error){await writeFile(join(out,'result.json'),JSON.stringify({status:'blocked',validated:false,provenance:{generationStatus:'blocked'},diagnostics:[{code:'INTERPOLATION_FAILED',message:error.message}]},null,2));console.error(error.stack);}
