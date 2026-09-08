import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { editRawFootage } from '../runtime/raw-footage-edit.mjs';
const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1],output=resolve(value('--output'));
await mkdir(output,{recursive:true});
try{
  const request=JSON.parse(await readFile(resolve(value('--input')),'utf8'));
  const root=fileURLToPath(new URL('..',import.meta.url));
  await editRawFootage({...request,outputDir:output},{ffmpeg:process.env.VYRELUM_FFMPEG||join(root,'workers/tools/ffmpeg.exe'),ffprobe:process.env.VYRELUM_FFPROBE||join(root,'workers/tools/ffprobe.exe'),onProgress:event=>console.log(JSON.stringify({progressEvent:true,...event}))});
}catch(error){await writeFile(join(output,'result.json'),JSON.stringify({status:'blocked',validated:false,diagnostics:[{code:error.code||'RAW_EDIT_FAILED',message:error.message}]}));console.error(error.message);process.exitCode=1;}
