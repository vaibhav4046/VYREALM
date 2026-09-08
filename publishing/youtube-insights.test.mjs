import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
import { createYouTubeInsights } from './youtube-insights.mjs';

const A='UCaaaaaaaaaaaaaaaaaaaaaa', B='UCbbbbbbbbbbbbbbbbbbbbbb';
const heads=names=>names.map(name=>({name,dataType:name==='day'||name==='video'?'STRING':'FLOAT'}));
const videos=()=>({columnHeaders:heads(['video','views','estimatedMinutesWatched','averageViewDuration','likes','comments','shares']),rows:[['abcdefghijk',100,100,60,9,3,6],['bcdefghijkl',100,50,30,3,1,1],['cdefghijklm',100,40,24,2,0,0]]});
const daily=()=>({columnHeaders:heads(['day','views','estimatedMinutesWatched','averageViewDuration']),rows:[['2026-09-07',300,190,38]]});
function fixture(t,options={}) {
 const db=options.db||new DatabaseSync(':memory:'); let time=Date.parse('2026-09-08T11:00:00Z'),connection={connected:true,connectedChannel:{id:A,title:'My channel'}};const calls=[];
 const make=()=>createYouTubeInsights({db,clock:()=>time,readConnection:async()=>connection,fetchDailyAnalytics:async query=>{calls.push({kind:'daily',query});return {...daily(),startDate:query.startDate,endDate:query.endDate};},fetchVideoAnalytics:async query=>{calls.push({kind:'video',query});return {...videos(),startDate:query.startDate,endDate:query.endDate};},...options.dependencies});
 let service=make();t.after(async()=>{await service.close();if(!options.db)db.close();});
 const call=(suffix='',method='GET',body={})=>service.handle({pathname:'/api/youtube/insights'+suffix,method,body});
 return {db,calls,call,get service(){return service;},time:()=>time,advance:ms=>time+=ms,channel:id=>{connection=id?{connected:true,connectedChannel:{id,title:id===A?'My channel':'Other channel'}}:{connected:false,connectedChannel:null};},async reopen(){await service.close();service=make();},async settle(){await service.tick();return (await call()).body;}};
}

test('default is opt-out; a read or tick makes no analytics requests',async t=>{const f=fixture(t);const s=await f.settle();assert.equal(s.settings.enabled,false);assert.equal(s.status,'idle');assert.equal(s.snapshot,null);assert.deepEqual(f.calls,[]);});
test('explicit refresh produces traceable channel-owned metrics and coalesces duplicate starts',async t=>{
 const f=fixture(t);const [a,b]=await Promise.all([f.call('/refresh','POST',{channelId:A}),f.call('/refresh','POST',{channelId:A})]);assert.equal(a.status,202);assert.equal(b.status,202);
 const s=await f.settle();assert.equal(f.calls.length,2);assert.equal(s.snapshot.source,'youtube-analytics-api');assert.equal(s.snapshot.startDate,'2026-08-11');assert.equal(s.snapshot.endDate,'2026-09-07');assert.equal(s.snapshot.channelId,A);assert.equal(s.snapshot.reports.video.rows.length,3);assert.match(s.snapshot.contentSha256,/^[a-f0-9]{64}$/);assert.equal(s.settings.enabled,false);
 assert.ok(s.recommendations.length);const r=s.recommendations.find(r=>r.kind==='average-view-duration');assert.equal(r.videoId,'abcdefghijk');assert.equal(r.evidence.observed,60);assert.equal(r.evidence.baseline,27);assert.equal(r.snapshotId,s.snapshot.id);assert.match(r.caveat,/not.*retention curve/i);assert.ok(s.unavailableMetrics.includes('impressions'));assert.equal(JSON.stringify(s).includes('viral score'),false);
});
test('24/48h cadence persists and restart does not duplicate completed checks',async t=>{
 const f=fixture(t);assert.equal((await f.call('/settings','POST',{channelId:A,enabled:true,cadenceHours:48})).status,200);await f.settle();assert.equal(f.calls.length,2);const state=(await f.call()).body;assert.equal(Date.parse(state.settings.nextCheckAt),f.time()+48*3600000);
 await f.reopen();await f.settle();assert.equal(f.calls.length,2);f.advance(48*3600000);await f.settle();assert.equal(f.calls.length,4);assert.equal((await f.call()).body.settings.cadenceHours,48);
});
test('settings and snapshots are isolated by channel; disconnect pauses scheduled work',async t=>{
 const f=fixture(t);await f.call('/settings','POST',{channelId:A,enabled:true,cadenceHours:24});const a=await f.settle();f.channel(B);const b=await f.settle();assert.equal(b.snapshot,null);assert.equal(b.settings.enabled,false);assert.equal(b.channel.id,B);assert.equal(JSON.stringify(b).includes(a.snapshot.id),false);
 assert.equal((await f.call('/refresh','POST',{channelId:A})).status,409);f.channel(null);f.advance(48*3600000);const disconnected=await f.settle();assert.equal(disconnected.status,'paused');assert.equal(disconnected.snapshot,null);assert.equal(f.calls.length,2);f.channel(A);const back=await f.settle();assert.equal(back.channel.id,A);assert.equal(f.calls.length,4);
});
test('empty and undersampled channels yield no invented recommendations',async t=>{
 const f=fixture(t,{dependencies:{fetchDailyAnalytics:async()=>({columnHeaders:[],rows:[]}),fetchVideoAnalytics:async()=>({columnHeaders:[],rows:[]})}});await f.call('/refresh','POST',{channelId:A});const s=await f.settle();assert.equal(s.status,'empty');assert.deepEqual(s.recommendations,[]);assert.match(s.diagnostic.message,/No.*rows/i);assert.equal(s.snapshot.reports.video.rows.length,0);
});
test('rate limiting persists bounded backoff; repeated refresh cannot bypass it',async t=>{
 let attempts=0;const f=fixture(t,{dependencies:{fetchDailyAnalytics:async()=>{attempts++;throw Object.assign(Error('DO NOT ECHO PRIVATE GOOGLE BODY'),{code:'YOUTUBE_RETRYABLE',details:{httpStatus:429,retryAfterMs:120000}});}}});
 await f.call('/settings','POST',{channelId:A,enabled:true,cadenceHours:24});let s=await f.settle();assert.equal(s.status,'retry-wait');assert.equal(s.settings.retryCount,1);assert.equal(Date.parse(s.settings.nextCheckAt),f.time()+120000);assert.equal((await f.call('/refresh','POST',{channelId:A})).status,429);await f.reopen();await f.settle();assert.equal(attempts,1);
 for(let i=0;i<3;i++){f.advance(300000);s=await f.settle();}assert.equal(attempts,4);assert.equal(s.status,'failed');assert.equal(Date.parse(s.settings.nextCheckAt),f.time()+24*3600000);assert.equal(JSON.stringify(s).includes('PRIVATE GOOGLE'),false);
});
test('disconnect during an owned fetch aborts it and cannot commit old-channel evidence',async t=>{
 let started,aborted=false;const beginning=new Promise(resolve=>started=resolve);const f=fixture(t,{dependencies:{fetchDailyAnalytics:async({signal})=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true});})}});
 await f.call('/refresh','POST',{channelId:A});await beginning;f.channel(B);await f.service.pauseForDisconnect();const s=await f.settle();assert.equal(aborted,true);assert.equal(s.snapshot,null);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM youtube_insights_snapshots').get().n,0);assert.equal(s.channel.id,B);
});
test('switch detected after a successful fetch discards the result before a second request',async t=>{
 let f;f=fixture(t,{dependencies:{fetchDailyAnalytics:async query=>{f.channel(B);return {...daily(),...query};}}});await f.call('/refresh','POST',{channelId:A});const s=await f.settle();assert.equal(s.channel.id,B);assert.equal(s.snapshot,null);assert.equal(f.calls.length,0);
});
test('strict settings reject stale channels, unsupported cadences and unknown fields',async t=>{
 const f=fixture(t);for(const body of [{channelId:A,enabled:true,cadenceHours:1},{channelId:A,enabled:'true',cadenceHours:24},{channelId:A,enabled:true,cadenceHours:24,publish:true}])assert.equal((await f.call('/settings','POST',body)).status,400);
 assert.equal((await f.call('/refresh','POST',{channelId:A,videoId:'abcdefghijk'})).status,400);assert.equal((await f.call('/settings','POST',{channelId:B,enabled:true,cadenceHours:24})).status,409);assert.equal(f.calls.length,0);
});
test('invalid Google rows fail without a snapshot or a guessed metric',async t=>{
 const f=fixture(t,{dependencies:{fetchVideoAnalytics:async()=>({columnHeaders:heads(['video','views']),rows:[['abcdefghijk',-1]]})}});await f.call('/refresh','POST',{channelId:A});const s=await f.settle();assert.equal(s.status,'failed');assert.equal(s.snapshot,null);assert.match(s.diagnostic.code,/REPORT/);
});
test('provider responses cannot introduce a different channel or outside-range day',async t=>{
 const f=fixture(t,{dependencies:{fetchDailyAnalytics:async()=>({columnHeaders:heads(['day','views']),rows:[['2030-01-01',2]]})}});await f.call('/refresh','POST',{channelId:A});const s=await f.settle();assert.equal(s.snapshot,null);assert.equal(s.status,'failed');
});
test('disabling an enabled schedule aborts its active fetch and leaves old snapshots intact',async t=>{
 let f,block=false,started;const beginning=new Promise(r=>started=r);f=fixture(t,{dependencies:{fetchDailyAnalytics:async({signal})=>{if(!block)return daily();return new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});}}});await f.call('/refresh','POST',{channelId:A});const before=await f.settle();block=true;await f.call('/settings','POST',{channelId:A,enabled:true,cadenceHours:24});const flight=f.service.tick();await beginning;await f.call('/settings','POST',{channelId:A,enabled:false,cadenceHours:24});await flight;const after=(await f.call()).body;assert.equal(after.settings.enabled,false);assert.equal(after.snapshot.id,before.snapshot.id);
});
test('snapshot survives closing the actual SQLite file and interrupted state recovers honestly',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'vyrealm-insights-')),file=join(dir,'insights.sqlite');let db=new DatabaseSync(file),now=Date.parse('2026-09-08T11:00:00Z');let calls=0;
 const make=()=>createYouTubeInsights({db,clock:()=>now,readConnection:async()=>({connected:true,connectedChannel:{id:A,title:'Own channel'}}),fetchDailyAnalytics:async()=>{calls++;return daily();},fetchVideoAnalytics:async()=>videos()});let service=make();
 t.after(async()=>{await service.close();db.close();if(dirname(dir)===resolve(tmpdir())&&basename(dir).startsWith('vyrealm-insights-'))await rm(dir,{recursive:true,force:true});});
 await service.handle({pathname:'/api/youtube/insights/refresh',method:'POST',body:{channelId:A}});await service.tick();const before=(await service.handle({pathname:'/api/youtube/insights',method:'GET'})).body;
 await service.close();db.close();db=new DatabaseSync(file);service=make();assert.equal((await service.handle({pathname:'/api/youtube/insights',method:'GET'})).body.snapshot.id,before.snapshot.id);assert.equal(calls,1);
 await service.close();const settings=JSON.parse(db.prepare('SELECT document FROM youtube_insights_settings WHERE channel_id=?').get(A).document);db.prepare('UPDATE youtube_insights_settings SET document=? WHERE channel_id=?').run(JSON.stringify({...settings,enabled:true,status:'running',runId:'interrupted-fixture'}),A);service=make();let state=(await service.handle({pathname:'/api/youtube/insights',method:'GET'})).body;assert.equal(state.status,'interrupted');assert.equal(state.snapshot.id,before.snapshot.id);await service.tick();assert.equal(calls,1);now+=60000;await service.tick();assert.equal(calls,2);
});
test('automatic snapshots are retained with a bounded history and exact report hashes',async t=>{
 const f=fixture(t);for(let i=0;i<34;i++){await f.call('/refresh','POST',{channelId:A});await f.settle();f.advance(1);}assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM youtube_insights_snapshots').get().n,32);const s=(await f.call()).body;assert.equal(s.snapshotRetention,32);assert.equal(f.calls.length,68);
});
test('aborting a stalled provider at the deadline schedules a bounded timeout retry',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let begin;const started=new Promise(r=>begin=r);const f=fixture(t,{dependencies:{fetchDailyAnalytics:async({signal})=>new Promise((resolve,reject)=>{begin();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})}});await f.call('/refresh','POST',{channelId:A});await started;t.mock.timers.tick(120001);const s=await f.settle();assert.equal(s.status,'retry-wait');assert.equal(s.settings.retryCount,1);assert.equal(s.snapshot,null);
});
