import test from 'node:test';
import assert from 'node:assert/strict';
import { assessVisualReview } from './quality-inspection.mjs';

test('visual inspection never claims semantic quality without a review', () => {
  const result = assessVisualReview(null, 'abc');
  assert.equal(result.status, 'review_required');
  assert.equal(result.diagnostics[0].code, 'VISUAL_REVIEW_REQUIRED');
});

test('visual inspection rejects incomplete or weak category evidence', () => {
  const result = assessVisualReview({ sha256: 'abc', reviewer: 'qa', method: 'contact sheet', categories: { subjectRealism: { score: 6, observation: 'face is soft' } } }, 'abc');
  assert.equal(result.status, 'rejected');
  assert.ok(result.diagnostics.some(x => x.code === 'VISUAL_QUALITY_REJECTED'));
  assert.ok(result.diagnostics.some(x => x.code === 'REVIEW_INCOMPLETE'));
});
