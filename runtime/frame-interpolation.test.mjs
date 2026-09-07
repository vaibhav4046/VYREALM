import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolationPlan, validateInterpolationSource, renderInputIdentity, captionBoundaryFrames, protectedCaptionSamples } from './frame-interpolation.mjs';

test('24 to 60 preserves exact five-second shot boundaries and terminal frame hold',()=>{
  const plan=interpolationPlan({fps:24,frames:360,cutFrames:[120,240]});
  assert.equal(plan.targetFrames,900);
  assert.deepEqual(plan.segments.map(s=>[s.start,s.frames,s.targetFrames]),[[0,120,300],[120,120,300],[240,120,300]]);
  assert.equal(plan.durationSeconds,15);
});

test('unsupported timing and geometry fail before any inference',()=>{
  assert.throws(()=>interpolationPlan({fps:23.976,frames:120}),/SOURCE_FPS/);
  assert.throws(()=>interpolationPlan({fps:24,frames:360,cutFrames:[1]}),/CUT_NOT_ALIGNED/);
  assert.throws(()=>interpolationPlan({fps:24,frames:121}),/DURATION_NOT_ALIGNED/);
  assert.throws(()=>interpolationPlan({fps:60,frames:300}),/SOURCE_FPS/);
  assert.equal(interpolationPlan({fps:30,frames:150}).targetFrames,300);
});

test('post-processing requires reviewed hashed owned media and never accepts a placeholder as generated',()=>{
  const source={review:{verdict:'passed'},provenance:{generationStatus:'edited',outputHash:'a'.repeat(64)},outputs:{video:'render.mp4'}};
  assert.equal(validateInterpolationSource(source),'a'.repeat(64));
  assert.throws(()=>validateInterpolationSource({...source,review:null}),/REVIEWED_SOURCE/);
  assert.throws(()=>validateInterpolationSource({...source,provenance:{generationStatus:'fallback',outputHash:'a'.repeat(64)}}),/SOURCE_PROVENANCE/);
  assert.throws(()=>validateInterpolationSource({...source,provenance:{generationStatus:'generated'}}),/SOURCE_PROVENANCE/);
});

test('changes to captions, edit or mix invalidate an existing export; review metadata does not',()=>{
 const source={timeline:[{assetId:'a',duration:5}],settings:{fps:24,width:1920,height:1080},captionsEnabled:true};
 assert.equal(renderInputIdentity(source),renderInputIdentity({...source,revision:4,latestOutput:{status:'reviewed'}}));
 assert.notEqual(renderInputIdentity(source),renderInputIdentity({...source,captionsEnabled:false}));
 assert.notEqual(renderInputIdentity(source),renderInputIdentity({...source,audioTracks:[{assetId:'b',gain:1}]}));
});

test('caption end at 1.440 seconds preserves original letters on the two intervening 60 fps samples',()=>{
 const boundaries=captionBoundaryFrames('1\n00:00:00,000 --> 00:00:01,440\nSomeone is following me.',24,360);
 assert.deepEqual(boundaries,[35]);
 const [first,second]=interpolationPlan({fps:24,frames:360,cutFrames:[120,240]}).segments;
 assert.deepEqual(protectedCaptionSamples(first,24,boundaries),[{outputFrame:87,sourceFrame:34},{outputFrame:88,sourceFrame:34}]);
 assert.deepEqual(protectedCaptionSamples(second,24,boundaries),[]);
});
