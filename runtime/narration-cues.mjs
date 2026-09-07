export function validateNarrationCues({cues,durationSeconds,text}) {
  if(!Number.isFinite(durationSeconds)||durationSeconds<1||durationSeconds>120||!Array.isArray(cues)||!cues.length||cues.length>24)throw new Error('NARRATION_CUES_INVALID');
  let previous=0;
  const result=cues.map(cue=>{
    if(!cue||!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||cue.start<previous||cue.end<=cue.start||cue.end>durationSeconds||typeof cue.text!=='string'||!cue.text.trim()||cue.text.length>1000)throw new Error('NARRATION_CUES_INVALID');
    previous=cue.end;return{start:cue.start,end:cue.end,text:cue.text.trim()};
  });
  if(result.map(c=>c.text).join(' ').replace(/\s+/g,' ').trim()!==String(text||'').replace(/\s+/g,' ').trim())throw new Error('NARRATION_CUE_TEXT_MISMATCH');
  return result;
}
