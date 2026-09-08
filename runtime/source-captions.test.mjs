import test from 'node:test';
import assert from 'node:assert/strict';
import {mapSourceCaptionsToTimeline} from './source-captions.mjs';
import {prepareTimedCaptions} from './timed-captions.mjs';
const clip=(id,assetId,trimStart,duration)=>({id,assetId,kind:'video',trimStart,duration});
const cue=(start,end,text='Original spoken words')=>({start,end,text});
const map=(segments,timeline,extra={})=>mapSourceCaptionsToTimeline({segments,timeline,sourceAssetId:'source',fps:24,...extra});

test('transcription after trimming becomes valid edit-relative captions',()=>{
 const input=[cue(5.25,6.25)],timeline=[clip('a','source',5,5)],before=structuredClone({input,timeline});
 const result=map(input,timeline);
 assert.equal(result.appearsInTimeline,true);assert.deepEqual(result.matchedClipIds,['a']);assert.equal(result.durationSeconds,5);
 assert.deepEqual(result.segments,[cue(.25,1.25)]);assert.deepEqual(prepareTimedCaptions(result.segments,5),[cue(.25,1.25)]);
 assert.deepEqual({input,timeline},before,'never mutate source transcript or saved clips');
});
test('reordered clips include every preceding non-target duration',()=>{
 const segments=[cue(10.25,11.25)];
 assert.deepEqual(map(segments,[clip('target','source',10,2),clip('foreign','other',0,3)]).segments,[cue(.25,1.25)]);
 assert.deepEqual(map(segments,[clip('foreign','other',0,3),clip('target','source',10,2)]).segments,[cue(3.25,4.25)]);
});
test('a repeated asset receives separate correctly placed cues',()=>{
 const result=map([cue(5.25,6.25)],[clip('intro','other',0,2.5),clip('first','source',5,2),clip('second','source',5,2)]);
 assert.deepEqual(result.matchedClipIds,['first','second']);assert.deepEqual(result.segments,[cue(2.75,3.75),cue(4.75,5.75)]);assert.equal(result.durationSeconds,6.5);
});
test('segment cuts clip both ends and exclude touching or non-overlapping ranges',()=>{
 assert.deepEqual(map([cue(3,9)],[clip('a','source',5,2)]).segments,[cue(0,2)]);
 assert.deepEqual(map([cue(0,5),cue(7,8)],[clip('a','source',5,2)]).segments,[]);
});
test('word cuts retain only spoken words and shift measured word timing',()=>{
 const segments=[{start:4.5,end:6.75,text:'The train arrives.',timingMethod:'word-timestamps',words:[{start:4.5,end:5,word:' The',probability:.9},{start:5.25,end:5.75,word:' train',probability:.8},{start:6.25,end:6.75,word:' arrives.',probability:.7}]}];
 const result=map(segments,[clip('a','source',5,1)]);
 assert.deepEqual(result.segments,[{start:.25,end:.75,text:'train',timingMethod:'word-timestamps',words:[{start:.25,end:.75,word:' train',probability:.8}]}]);
 assert.deepEqual(prepareTimedCaptions(result.segments,1),[cue(.25,.75,'train')]);
});
test('a cut inside a measured word clips its interval without inventing another word',()=>{
 const result=map([{start:4.8,end:5.5,text:'Arrival.',words:[{start:4.8,end:5.5,word:'Arrival.'}]}],[clip('a','source',5,.25)]);
 assert.deepEqual(result.segments,[{start:0,end:.25,text:'Arrival.',words:[{start:0,end:.25,word:'Arrival.'}],timingMethod:'word-timestamps'}]);
});
test('word-timestamp silence is not captioned and terminal instantaneous words are retained',()=>{
 assert.deepEqual(map([{start:0,end:10,text:'Early late',words:[{start:0,end:1,word:'Early'},{start:9,end:10,word:'late'}]}],[clip('a','source',4,2)]).segments,[]);
 const result=map([{start:5,end:6,text:'Hello world.',words:[{start:5,end:6,word:'Hello'},{start:6,end:6,word:'world.'}]}],[clip('a','source',5,1)]);
 assert.equal(result.segments[0].text,'Hello world.');assert.deepEqual(result.segments[0].words[1],{start:1,end:1,word:'world.'});
});
test('full segments preserve original text while stripping arbitrary metadata',()=>{
 const result=map([{id:'external',...cue(5,6,'  Preserve this punctuation! '),timingMethod:'segment-timestamps',words:[],provenance:{generated:true},path:'C:/private',html:'<script>'}],[clip('a','source',5,1)]);
 assert.deepEqual(result.segments,[{start:0,end:1,text:'  Preserve this punctuation! ',words:[],timingMethod:'segment-timestamps'}]);
});
test('no matching placement returns explicit no-mapping instead of global captions',()=>{
 for(const timeline of [[],[clip('foreign','other',0,5)]]){const result=map([cue(1,2)],timeline);assert.equal(result.appearsInTimeline,false);assert.deepEqual(result.segments,[]);assert.deepEqual(result.matchedClipIds,[]);}
 assert.equal(map([cue(50,51)],[clip('a','source',0,5)]).appearsInTimeline,true,'placement exists even when its retained range has no speech');
});
test('renderer frame rounding is stable across fractional foreign clip durations',()=>{
 const timeline=[...Array.from({length:24},(_,i)=>clip('other'+i,'other',0,.04)),clip('a','source',5,1)];
 const result=map([cue(5,6)],timeline);assert.equal(result.durationSeconds,2);assert.deepEqual(result.segments,[cue(1,2)]);
 const fractional=map([cue(0,.03)],[clip('a','source',0,.04)],{fps:30});assert.equal(fractional.durationSeconds,1/30);assert.equal(fractional.segments[0].end,.03);
});
test('malformed timestamps and words fail without emitting unsafe captions',()=>{
 for(const segments of [[cue(NaN,2)],[cue(1,Infinity)],[cue(-1,2)],[cue(2,1)],[cue(0,2),cue(1,3)],[{...cue(0,1),text:''}],[{...cue(0,1),words:[{start:0,end:Infinity,word:'broken'}]}],[{...cue(0,1),words:[{start:0,end:1,word:'broken',probability:2}]}]])assert.throws(()=>map(segments,[clip('a','source',0,5)]),/SOURCE_CAPTIONS_/);
});
test('invalid inputs and foreign clip durations fail before mapping',()=>{
 for(const timeline of [[clip('a','source',-1,5)],[clip('a','source',0,0)],[clip('a','source',0,Infinity)],[clip('a','other',0,NaN),clip('b','source',0,5)],[clip('same','source',0,1),clip('same','source',1,1)]])assert.throws(()=>map([cue(0,1)],timeline),/SOURCE_CAPTIONS_/);
 for(const extra of [{sourceAssetId:''},{sourceAssetId:1},{fps:0},{fps:Infinity},{fps:'24'}])assert.throws(()=>map([cue(0,1)],[clip('a','source',0,5)],extra),/SOURCE_CAPTIONS_/);
});
test('bounded output refuses pathological repeated captions',()=>{
 const segments=Array.from({length:1001},(_,i)=>cue(i,i+.5));
 assert.throws(()=>map(segments,[0,1,2].map(i=>clip('repeat'+i,'source',0,1100))),/SOURCE_CAPTIONS_OUTPUT_LIMIT/);
});
