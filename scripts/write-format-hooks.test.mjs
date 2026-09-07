import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanHookLine, isUsableHook } from './write-format-hooks.mjs';

test('reasoning tags and preambles are stripped', () => {
  assert.equal(cleanHookLine('<think>hmm let me consider</think>Made offline on one laptop.'), 'Made offline on one laptop.');
  assert.equal(cleanHookLine('Caption: Your whole studio, offline.'), 'Your whole studio, offline.');
  assert.equal(cleanHookLine('  "No cloud. No credits."  '), 'No cloud. No credits.');
});

test('only the first line survives', () => {
  assert.equal(cleanHookLine('First line here\nSecond line ignored'), 'First line here');
});

test('a plain hook of sensible length is usable', () => {
  assert.ok(isUsableHook('What if filmmaking worked without the internet?'));
  assert.ok(isUsableHook('Your whole studio, running offline on one laptop.'));
});

test('too short, too long, and model chatter are rejected', () => {
  assert.equal(isUsableHook('Too short'), false);
  assert.equal(isUsableHook(Array(30).fill('word').join(' ')), false);
  assert.equal(isUsableHook('Sure! Here is a caption for you to use.'), false);
  assert.equal(isUsableHook(''), false);
  assert.equal(isUsableHook(null), false);
});

test('markup and links are rejected', () => {
  assert.equal(isUsableHook('Check out <b>this</b> amazing studio today'), false);
  assert.equal(isUsableHook('Go to http://example.com to see the studio'), false);
});

/**
 * The load-bearing test. A small model invents statistics unprompted; one real
 * run produced "1,200 hours of film made on one laptop". Burning an unmeasured
 * number into a video turns a caption into a false claim.
 */
test('fabricated quantities are rejected outright', () => {
  assert.equal(isUsableHook('1,200 hours of film made on one laptop.'), false, 'the exact line a real run produced');
  assert.equal(isUsableHook('Thousands of creators already switched to this.'), false);
  assert.equal(isUsableHook('This renders a hundred times faster than the cloud.'), false);
  assert.equal(isUsableHook('Ninety percent cheaper than every rival tool.'), false);
  assert.equal(isUsableHook('Millions of videos made without a single credit.'), false);
  assert.equal(isUsableHook('Render 4 videos at once on your laptop.'), false, 'any digit is a claim we would have to prove');
});

test('evocative lines with no measurement still pass', () => {
  assert.ok(isUsableHook('No cloud. No credits. Just your laptop.'));
  assert.ok(isUsableHook('The whole studio fits on the machine you own.'));
});
