import { readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { produceLocalKeyframe,validateKeyframeRequest } from '../runtime/keyframe-production.mjs';

export async function runCinematicKeyframeWorker(jobRoot){
  const request=validateKeyframeRequest(JSON.parse(await readFile(join(jobRoot,'request.json'),'utf8')));
  return produceLocalKeyframe({jobRoot,request,onProgress:event=>process.stdout.write(JSON.stringify({type:'progress',...event})+'\n')});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {values}=parseArgs({options:{'job-root':{type:'string'}},strict:true,allowPositionals:false});if(!values['job-root'])throw new Error('Owned job directory required');await runCinematicKeyframeWorker(resolve(values['job-root']));}
  catch(error){process.stderr.write(`${error.code||'KEYFRAME_WORKER_FAILED'}: ${error.message}\n`);process.exitCode=1;}
}
