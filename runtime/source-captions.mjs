import {prepareTimedCaptions} from './timed-captions.mjs';

const MAX_CUES=3000,MAX_CLIPS=2000,EPSILON=1e-9;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const number=(value,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max;
const identifier=value=>typeof value==='string'&&value.trim().length>0&&value.length<=200&&!value.includes('\0');
const fail=(code,message)=>{throw Object.assign(Error(`SOURCE_CAPTIONS_${code}: ${message}`),{code:`SOURCE_CAPTIONS_${code}`});};
const cleanTime=value=>Number(value.toFixed(9));

function readSegments(input){
 if(!Array.isArray(input)||input.length>MAX_CUES)fail('INPUT','Expected at most 3000 source captions.');
 let previousEnd=0;
 return input.map((item,index)=>{
  if(!record(item)||!number(item.start,86400)||!number(item.end,86400)||item.end<=item.start||item.start<previousEnd-.001||typeof item.text!=='string'||!item.text.trim()||item.text.length>2000)fail('TIMING',`Invalid source caption ${index+1}.`);
  previousEnd=item.end;const cue={start:item.start,end:item.end,text:item.text};
  if(item.words!==undefined){
   if(!Array.isArray(item.words)||item.words.length>1000)fail('WORDS',`Invalid words in source caption ${index+1}.`);
   let wordEnd=item.start;
   cue.words=item.words.map(word=>{
    if(!record(word)||!number(word.start,86400)||!number(word.end,86400)||word.end<word.start||word.start<item.start-.002||word.end>item.end+.002||word.start<wordEnd-.002||typeof word.word!=='string'||!word.word.trim()||word.word.length>2000)fail('WORDS',`Invalid measured word in source caption ${index+1}.`);
    if(word.probability!==undefined&&!number(word.probability,1))fail('WORDS',`Invalid word probability in source caption ${index+1}.`);
    wordEnd=word.end;return {start:word.start,end:word.end,word:word.word,...(word.probability!==undefined?{probability:word.probability}:{})};
   });
  }
  if(['word-timestamps','segment-timestamps'].includes(item.timingMethod))cue.timingMethod=item.timingMethod;
  return cue;
 });
}

/**
 * Convert one asset's measured source transcript into sequential edit time.
 * No storage, media access, inference, or implicit narration/global placement.
 *
 * @param {{segments:Array<{start:number,end:number,text:string,words?:Array<{start:number,end:number,word:string,probability?:number}>,timingMethod?:string}>,timeline:Array<{id?:string,assetId?:string,trimStart?:number,duration:number}>,sourceAssetId:string,fps?:number}} input
 * @returns {{appearsInTimeline:boolean,matchedClipIds:string[],segments:Array<object>,durationSeconds:number}}
 */
export function mapSourceCaptionsToTimeline({segments,timeline,sourceAssetId,fps=24}={}){
 if(!identifier(sourceAssetId))fail('ASSET','Select an exact source asset ID.');
 if(!number(fps,60)||fps<1)fail('FPS','Expected a numeric frame rate between 1 and 60.');
 if(!Array.isArray(timeline)||timeline.length>MAX_CLIPS)fail('TIMELINE','Expected a bounded sequential timeline.');
 const source=readSegments(segments),placements=[],matchedClipIds=[],ids=new Set();let frames=0,requestedDuration=0;
 for(let index=0;index<timeline.length;index++){
  const clip=timeline[index];
  if(!record(clip)||!number(clip.duration,3600)||clip.duration<=0||!number(clip.trimStart??0,3600))fail('TIMELINE',`Invalid duration or trim in clip ${index+1}.`);
  if(clip.id!==undefined&&(!identifier(clip.id)||ids.has(clip.id)))fail('TIMELINE','Clip IDs must be distinct when supplied.');
  if(clip.id!==undefined)ids.add(clip.id);
  requestedDuration+=clip.duration;if(requestedDuration>21600)fail('TIMELINE','Timeline duration exceeds six hours.');
  // Match workers/timeline.mjs: count integer rendered frames, not accumulated
  // floating clip durations. Word timestamps are never quantized to video frames.
  const clipFrames=Math.max(1,Math.round(clip.duration*fps)),start=frames/fps,duration=clipFrames/fps;
  if(clip.assetId===sourceAssetId){matchedClipIds.push(clip.id??String(index));placements.push({start,duration,trimStart:clip.trimStart??0});}
  frames+=clipFrames;
 }
 const output=[],durationSeconds=frames/fps;
 for(const placement of placements){
  const {start:offset,duration,trimStart}=placement,limit=trimStart+duration;
  const shifted=time=>cleanTime(Math.max(offset,Math.min(offset+duration,offset+time-trimStart)));
  for(const cue of source){
   const low=Math.max(cue.start,trimStart),high=Math.min(cue.end,limit);if(high-low<=EPSILON)continue;
   let mapped={start:shifted(low),end:shifted(high),text:cue.text};
   if(cue.words?.length){
    const kept=cue.words.filter(word=>word.end>word.start?Math.min(word.end,high)-Math.max(word.start,low)>EPSILON:word.start>=low-EPSILON&&(word.start<high-EPSILON||Math.abs(word.start-cue.end)<EPSILON&&Math.abs(high-cue.end)<EPSILON));
    if(!kept.length)continue; // A segment spanning silence does not supply speech.
    const words=kept.map(word=>({start:shifted(Math.max(low,word.start)),end:shifted(Math.min(high,word.end)),word:word.word,...(word.probability!==undefined?{probability:word.probability}:{})}));
    if(words.at(-1).end-words[0].start<=EPSILON)continue;
    mapped={start:words[0].start,end:words.at(-1).end,text:kept.length===cue.words.length?cue.text:kept.map(word=>word.word.trim()).join(' '),words,timingMethod:'word-timestamps'};
   }else{
    if(cue.words)mapped.words=[];
    if(cue.timingMethod)mapped.timingMethod=cue.timingMethod==='word-timestamps'?'segment-timestamps':cue.timingMethod;
   }
   if(mapped.end<=mapped.start)continue;
   if(output.length>=MAX_CUES)fail('OUTPUT_LIMIT','Repeated source placements exceed 3000 captions.');
   output.push(mapped);
  }
 }
 // Validate without replacing original text/word evidence. The renderer can
 // perform its existing line wrapping when it writes captions.
 try{prepareTimedCaptions(output,durationSeconds);}catch(error){fail('OUTPUT',error.message);}
 return {appearsInTimeline:matchedClipIds.length>0,matchedClipIds,segments:output,durationSeconds};
}
