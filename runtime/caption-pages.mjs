/** Split ASR output at measured word boundaries; never invent word timings. */
export function createCaptionPages(segments,{maxWords=5,maxCharacters=34,maxDuration=2.6}={}){
 if(!Array.isArray(segments)||segments.length>3000)throw Error('Invalid speech segments');
 const pages=[];let previousEnd=0;
 for(const segment of segments){
  const start=Number(segment.start),end=Number(segment.end),text=String(segment.text||'').trim();
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<previousEnd-0.002||end<=start||!text)throw Error('Invalid speech segment timing');
  previousEnd=end;
  const words=Array.isArray(segment.words)?segment.words.filter(w=>String(w.word||'').trim()):[];
  let wordEnd=start;
  const valid=words.length&&words.every(w=>{const a=Number(w.start),b=Number(w.end),ok=Number.isFinite(a)&&Number.isFinite(b)&&a>=start-0.002&&b<=end+0.002&&b>=a&&a>=wordEnd-0.002;wordEnd=b;return ok;});
  if(!valid){pages.push({start,end,text,timingMethod:'segment-timestamps',words:[]});continue;}
  let group=[];
  const flush=()=>{if(!group.length)return;const a=group[0].start,b=group.at(-1).end;if(b<=a)return;pages.push({start:Math.round(a*1000)/1000,end:Math.round(b*1000)/1000,text:group.map(w=>w.word.trim()).join(' '),words:group.map(w=>({...w})),timingMethod:'word-timestamps'});group=[];};
  for(const word of words){const candidate=group.map(w=>w.word.trim()).concat(word.word.trim()).join(' ');if(group.length&&group.at(-1).end>group[0].start&&(group.length>=maxWords||candidate.length>maxCharacters||word.end-group[0].start>maxDuration||word.start-group.at(-1).end>0.45))flush();group.push(word);if(/[.!?]$/.test(word.word.trim())&&group.length>=2)flush();}
  if(group.length&&group.at(-1).end<=group[0].start){const last=pages.at(-1);if(last&&last.end>=start){last.text+=' '+group.map(w=>w.word.trim()).join(' ');last.words.push(...group);group=[];}else{pages.push({start,end,text,timingMethod:'segment-timestamps',words:[]});group=[];}}
  flush();
 }
 return pages.map((page,id)=>({id,...page}));
}
export function captionsToSrt(rows){const stamp=seconds=>{const ms=Math.round(seconds*1000);return`${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};return rows.map((row,i)=>`${i+1}\n${stamp(row.start)} --> ${stamp(row.end)}\n${row.text}`).join('\n\n')+'\n';}
