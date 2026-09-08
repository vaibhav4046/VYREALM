import {readFile,writeFile,mkdir} from 'node:fs/promises';import {join,resolve} from 'node:path';
import {setupLocalVideo} from '../runtime/setup-local-video.mjs';
import {setupInterpolation} from '../runtime/interpolation-setup.mjs';
const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1],out=resolve(value('--output'));await mkdir(out,{recursive:true});
try{const input=JSON.parse(await readFile(resolve(value('--input')),'utf8'));const report=await (input.mode==='install-interpolation'?setupInterpolation:setupLocalVideo)({...input,onProgress:event=>console.log(JSON.stringify({progressEvent:true,...event}))});await writeFile(join(out,'result.json'),JSON.stringify({status:'verified',validated:true,report,outputs:{}},null,2));}
catch(error){await writeFile(join(out,'result.json'),JSON.stringify({status:'blocked',validated:false,diagnostics:[{code:'RUNTIME_SETUP_FAILED',message:error.message}]}));}
