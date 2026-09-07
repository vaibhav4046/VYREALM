import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNarrationCues} from './narration-cues.mjs';
test('narration cues retain absolute shot timing and exact spoken-text provenance',()=>{
 const input={durationSeconds:10,text:'At dawn. A decision.',cues:[{start:0,end:5,text:'At dawn.'},{start:5,end:10,text:'A decision.'}]};
 assert.deepEqual(validateNarrationCues(input),input.cues);
 assert.throws(()=>validateNarrationCues({...input,text:'Different words.'}),/TEXT_MISMATCH/);
 for(const cues of [[{start:0,end:11,text:input.text}],[{start:0,end:6,text:'At dawn.'},{start:5,end:10,text:'A decision.'}],[{start:NaN,end:5,text:input.text}],[],[{start:0,end:5,text:''}]])assert.throws(()=>validateNarrationCues({...input,cues}),/INVALID/);
});
