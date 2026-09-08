import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareTimedCaptions } from './timed-captions.mjs';
test('caption paging preserves all words and source timing', () => {
 const text='Rain falls over the night market. Someone is following me. The lanterns above the empty alley are shaking in the wind as footsteps draw closer.';
 const rows=prepareTimedCaptions([{start:0.5,end:5,text}],5);
 assert.equal(rows.flatMap(r=>r.text.split(/\s+/)).join(' '),text);
 assert.equal(rows[0].start,0.5);assert.equal(rows.at(-1).end,5);
 assert.ok(rows.every(r=>r.text.split('\n').length<=2&&r.text.split('\n').every(line=>line.length<=42)));
});
test('out-of-range and overlapping captions are rejected', () => {
 assert.throws(()=>prepareTimedCaptions([{start:0,end:6,text:'Hello'}],5));
 assert.throws(()=>prepareTimedCaptions([{start:0,end:2,text:'First'},{start:1,end:3,text:'Second'}],5));
});
