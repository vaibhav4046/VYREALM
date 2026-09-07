import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1],output=resolve(value('--output'));await mkdir(output,{recursive:true});
const configPath=join(process.env.VYRELUM_RUNTIME_DIR||resolve('data/runtime'),'audio.json');
try{
 const config=JSON.parse(await readFile(configPath,'utf8'));
 const child=spawn(config.python,[fileURLToPath(new URL('./audio-local.py',import.meta.url)),'--request',resolve(value('--input')),'--output',output,'--config',configPath],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});
 child.stdout.pipe(process.stdout);let tail='';child.stderr.on('data',b=>{tail=(tail+b.toString()).slice(-4000);process.stderr.write(b)});
 const timer=setTimeout(()=>child.kill(),600000);const code=await new Promise((ok,bad)=>{child.on('error',bad);child.on('close',ok)});clearTimeout(timer);
 if(code!==0)throw new Error(`Local audio worker exited ${code}: ${tail}`);
}catch(error){await writeFile(join(output,'result.json'),JSON.stringify({status:'blocked',validated:false,diagnostics:[{code:'LOCAL_AUDIO_FAILED',message:error.message}]}));console.error(error.message);}
