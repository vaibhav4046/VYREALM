import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {verifyRegisteredRuntime,setupLocalVideo} from './setup-local-video.mjs';

test('registered runtime integrity detects modified model data and path escapes',async()=>{
 const base=await mkdtemp(join(tmpdir(),'vyrealm-runtime-check-')),config=join(base,'config'),root=join(base,'owned');await mkdir(config);await mkdir(root);
 const bytes=Buffer.from('fixture'),sha256=createHash('sha256').update(bytes).digest('hex');for(const name of ['code.py','one','two','three'])await writeFile(join(root,name),bytes);
 const inventory={schemaVersion:1,code:[{path:'code.py',sha256}],models:['one','two','three'].map(path=>({path,sha256}))};await writeFile(join(root,'installation.json'),JSON.stringify(inventory));await writeFile(join(config,'comfyui.json'),JSON.stringify({root}));
 assert.equal((await verifyRegisteredRuntime(config)).models,3);await writeFile(join(root,'one'),'changed');await assert.rejects(verifyRegisteredRuntime(config),/INTEGRITY_FAILED/);await writeFile(join(root,'one'),bytes);
 await writeFile(join(base,'outside'),bytes);inventory.models[0].path='../outside';await writeFile(join(root,'installation.json'),JSON.stringify(inventory));await assert.rejects(verifyRegisteredRuntime(config),/OUTSIDE_RUNTIME/);
});
test('installer rejects a drive root before writing setup content',async()=>{await assert.rejects(setupLocalVideo({installDirectory:process.platform==='win32'?'D:\\':'/'}),/folder|PLATFORM/);});
