import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import[^\n]*\r?\n/gm,'').replace(/\ninit\(\);\s*$/,'\n');
function fixture(){
 const calls=[],current=[{id:'job',status:'running',progress:0.25}];
 const ctx=vm.createContext({document:{visibilityState:'visible',activeElement:null,addEventListener(){},querySelector(){return null},querySelectorAll(){return[]}},localStorage:{getItem(){return null}},calls,current,remote:{projects:[],assets:[],jobs:current,capabilities:[]}});
 vm.runInContext(source,ctx);const run=code=>vm.runInContext(code,ctx);
 run("api=async path=>{calls.push(path);return path==='/jobs'?current:path==='/state'?remote:[]};store.state.jobs=current;lastFullRefresh=Date.now();");
 return{run,calls,ctx};
}
test('progress polling avoids full dependency checks but keeps live progress',async()=>{
 const f=fixture();f.run("current=[{id:'job',status:'running',progress:0.65}]");await f.run('pollState()');
 assert.deepEqual(f.calls,['/jobs']);assert.equal(f.run('store.state.jobs[0].progress'),0.65);
});
test('terminal transitions trigger full asset/project refresh immediately',async()=>{
 const f=fixture();f.run("current=[{id:'job',status:'review_required',progress:1}];remote.jobs=current;");await f.run('pollState()');
 assert.deepEqual(f.calls,['/jobs','/state','/releases']);
});
test('full refresh happens periodically and hidden tabs do not poll',async()=>{
 const f=fixture();f.run('lastFullRefresh=0');await f.run('pollState()');assert.deepEqual(f.calls,['/state','/releases']);
 f.calls.length=0;f.run("document.visibilityState='hidden'");await f.run('pollState()');assert.deepEqual(f.calls,[]);
});
test('overlapping poll intervals coalesce into one request',async()=>{
 const f=fixture();f.run("api=path=>{calls.push(path);return new Promise(resolve=>globalThis.releasePoll=resolve)}");
 const first=f.run('pollState()');await f.run('pollState()');assert.deepEqual(f.calls,['/jobs']);
 f.run('releasePoll(current)');await first;
});
test('an older poll cannot overwrite a newer full refresh',async()=>{
 const f=fixture();f.run("api=path=>path==='/jobs'?new Promise(resolve=>globalThis.releasePoll=resolve):Promise.resolve(path==='/state'?{projects:[],assets:[],jobs:[{id:'job',status:'succeeded'}]}:[])");
 const first=f.run('pollState()');await f.run('refresh()');f.run('releasePoll(current)');await first;
 assert.equal(f.run('store.state.jobs[0].status'),'succeeded');
});
