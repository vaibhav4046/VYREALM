const invalid=message=>{throw Object.assign(new Error(message),{code:'RAW_PROMPT_INVALID'});};
const tick=n=>Math.round(n*24)/24;
/** Deliberately bounded instruction parser. Never infers visual meaning. */
export function planRawPrompt(request,sources){
 let rest=String(request.brief||'').toLowerCase(),ranges=[],applied=[],diagnostics=[];
 if(/\b(?:no|not|never|without|avoid|don't)\s+(?:\w+\s+){0,2}(?:crop|fit|letterbox|portrait|vertical|landscape|horizontal|source|duration)\b/.test(rest))invalid('Negated edit directives are ambiguous. State the desired framing, aspect and source ranges explicitly.');
 const consume=(pattern,fn)=>{rest=rest.replace(pattern,(...args)=>{fn(...args);return ' ';});};
 let captionsEnabled=request.captionsEnabled??true;
 consume(/\b(?:no|without|disable) captions\b/g,match=>{captionsEnabled=false;applied.push(match);});
 consume(/\b(?:add|enable|with) captions\b/g,match=>{captionsEnabled=true;applied.push(match);});
 consume(/\b(?:preserve|keep|retain) (?:the )?original audio\b/g,match=>applied.push(match));
 rest=rest.replace(/\b(first|last)\s+(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/g,(match,which,n)=>{
  if(sources.length!==1)invalid('First/last trims require one selected source.');
  const duration=Number(n),end=which==='first'?duration:Math.floor(sources[0].durationSeconds*24)/24,start=which==='first'?0:end-duration;
  if(start<0||duration<=0)invalid('First/last trim exceeds the source duration.');
  return `source 1 from ${start}s to ${end}s`;
 });
 const number='(\\d+(?:\\.\\d+)?)',unit='\\s*(?:seconds?|secs?|s)?';
 const rangePattern=new RegExp('(?:source\\s+(\\d+)\\s+)?(?:from\\s+)?'+number+unit+'\\s*(?:to|–|-)\\s*'+number+unit,'g');
 consume(rangePattern,(match,index,start,end)=>{
  if(!index&&sources.length!==1)invalid('Name a source number for every range when multiple videos are selected.');
  const source=sources[index?Number(index)-1:0],a=tick(Number(start)),b=tick(Number(end));
  if(!source||a<0||b<=a||b>Math.floor(source.durationSeconds*24)/24)invalid(`Invalid source range: ${match}`);
  if(ranges.some(r=>r.assetId===source.id&&a<r.start+r.duration&&b>r.start))invalid('Source ranges overlap; repeated footage is not supported.');
  ranges.push({assetId:source.id,start:a,duration:tick(b-a)});applied.push(match);
 });
 if(/\b(?:source\s+\d+|from\s+\d|range\s+\d|start\s+\d|end\s+\d)/.test(rest))invalid('Use source N from STARTs to ENDs for explicit ranges.');
 let explicitDuration;
 consume(/\b(?:(?:duration\s*:?\s*|make (?:it |a )?))?(\d+(?:\.\d+)?)\s*[- ]?\s*(?:seconds?|secs?|s)\b/g,(match,n)=>{
  if(explicitDuration!==undefined&&explicitDuration!==tick(Number(n)))invalid('Conflicting durations.');explicitDuration=tick(Number(n));applied.push(match);
 });
 let aspect=request.aspect||'9:16',chosenAspect;
 consume(/\b(portrait|vertical|landscape|horizontal|9:16|16:9)\b/g,(match)=>{
  const value=['portrait','vertical','9:16'].includes(match)?'9:16':'16:9';
  if(chosenAspect&&chosenAspect!==value)invalid('Conflicting aspect instructions.');chosenAspect=value;aspect=value;applied.push(match);
 });
 let framing='crop-center',chosenFraming;
 consume(/\b(fit|letterbox|crop(?:\s+(?:left|right|center|centre))?)\b/g,(match)=>{
  const value=['fit','letterbox'].includes(match)?'fit':match.includes('left')?'crop-left':match.includes('right')?'crop-right':'crop-center';
  if(chosenFraming&&chosenFraming!==value)invalid('Conflicting framing instructions.');chosenFraming=value;framing=value;applied.push(match);
 });
 const total=tick(ranges.reduce((n,r)=>n+r.duration,0));
 const durationSeconds=ranges.length?total:explicitDuration??request.durationSeconds??20;
 if(ranges.length&&explicitDuration!==undefined&&explicitDuration!==total)invalid('Explicit duration must equal the sum of the selected ranges.');
 if(!Number.isFinite(durationSeconds)||durationSeconds<1||durationSeconds>90)invalid('Choose an edit duration from 1 to 90 seconds.');
 if(!['9:16','16:9'].includes(aspect))invalid('Supported aspects are 9:16 and 16:9.');
 const unsupported=rest.match(/\b(?:music|soundtrack|titles?|text|transitions?|zoom|slow motion|speed ramp|voiceover|narration|generate|cinematic|highlights?)\b/g)||[];
 if(unsupported.length)diagnostics.push({code:'RAW_PROMPT_UNSUPPORTED',message:`Not applied: ${[...new Set(unsupported)].join(', ')}. This worker applies explicit trims and framing only, retaining original audio.`});
 rest=rest.replace(/\b(?:make|create|edit)\s+(?:a\s+)?/g,' ').replace(/\b(?:reel|video|short)\b/g,' ').replace(/\bfrom (?:my|the) uploaded footage\b/g,' ');
 const remainder=rest.replace(/\b(?:then|and)\b/g,' ').replace(/[\s,;.]+/g,' ').trim();
 if(remainder)diagnostics.push({code:'RAW_PROMPT_REMAINDER',message:`Uninterpreted brief text: ${remainder}. No visual-semantic interpretation was performed.`});
 if(!ranges.length)diagnostics.push({code:'RAW_PROMPT_DEFAULT_SELECTION',message:'No explicit ranges supplied; chronological evenly spaced coverage was selected.'});
 return {schemaVersion:1,mode:ranges.length?'explicit-ranges':'chronological',ranges,durationSeconds,aspect,framing,captionsEnabled,applied,diagnostics};
}

export function rawFramingFilter(width,height,framing,cropPosition){
 if(cropPosition!==undefined&&(!cropPosition||typeof cropPosition!=='object'||Array.isArray(cropPosition)||['x','y'].some(axis=>typeof cropPosition[axis]!=='number'||!Number.isFinite(cropPosition[axis])||cropPosition[axis]<0||cropPosition[axis]>1)))throw new Error('Crop position must contain x and y numbers between 0 and 1.');
 if(framing==='crop-custom'&&!cropPosition)throw new Error('Custom framing requires a crop position.');
 if(framing==='fit')return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;
 const x=framing==='crop-custom'?`(iw-ow)*${cropPosition.x}`:framing==='crop-left'?'0':framing==='crop-right'?'iw-ow':'(iw-ow)/2';
 const y=framing==='crop-custom'?`(ih-oh)*${cropPosition.y}`:'(ih-oh)/2';
 return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:${x}:${y}`;
}
