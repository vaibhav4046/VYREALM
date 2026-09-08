import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMahabharataDirection, matchesMahabharataBrief } from './mahabharata-direction.mjs';
import { validateKeyframeRequest } from './keyframe-production.mjs';
import { validateNarrationCues } from './narration-cues.mjs';

test('ordinary Mahabharata briefs route to the recipe without matching unrelated Arjuna topics',()=>{
  for(const brief of ['Make a Mahabharata trailer','mahabharat film','make the mahabahart trailer fast','Maha Bharat trailer','महाभारत का ट्रेलर','Arjuna and Krishna in a chariot at Kurukshetra'])assert.equal(matchesMahabharataBrief(brief),true,brief);
  for(const brief of ['Arjuna Award profile','Aadhav Arjuna interview','Krishna restaurant advert','A coastal city film',null,{},''])assert.equal(matchesMahabharataBrief(brief),false);
});

test('normal brief produces exactly six contiguous five-second shots at 24 fps',()=>{
  const plan=buildMahabharataDirection({brief:'Make an accurate Mahabharata trailer',seed:123});
  assert.equal(plan.title,'Between Two Armies');assert.equal(plan.durationSeconds,30);assert.equal(plan.productionPlan.frameCount,720);assert.equal(plan.shots.length,6);
  plan.shots.forEach((shot,index)=>{assert.equal(shot.startSeconds,index*5);assert.equal(shot.durationSeconds,5);assert.equal(shot.startFrame,index*120);assert.equal(shot.durationFrames,120);assert.equal(shot.seed,123+index);for(const field of ['subject','environment','foreground','midground','background','camera','motionPrompt','prompt'])assert.ok(shot[field].length>10);});
  assert.deepEqual(plan.settings,{width:1920,height:1080,fps:24});assert.equal(plan.productionPlan.native1080pClaim,false);assert.equal(plan.productionPlan.upscaleDisclosureRequired,true);
});

test('wardrobe, face and diadem are required; optional jewellery cannot replace them',()=>{
  const plan=buildMahabharataDirection({brief:'Mahabharata trailer'}),required=plan.castCandidate.requiredVisualCriteria.map(item=>item.id),optional=plan.castCandidate.optionalVisualCriteria.map(item=>item.id);
  for(const id of ['arjuna-clean-shaven','arjuna-hair','arjuna-ivory-dhoti','arjuna-saffron-angavastra','arjuna-low-gold-diadem','arjuna-no-armour','arjuna-bow']){assert.ok(required.includes(id));assert.ok(!optional.includes(id));}
  assert.match(plan.castCandidate.prompt,/head to below knees/);assert.match(plan.castCandidate.prompt,/ivory dhoti, saffron shoulder drape and low gold diadem must all be visible/i);
  assert.equal(plan.locks.wardrobe.arjuna.armour,'none');assert.match(plan.locks.wardrobe.policy,/cannot be silently changed/);
  for(const term of ['beard','moustache','topknot','mail vest','bronze breastplate','segmented lamellar shoulder plates','red scarf'])assert.ok(plan.negativePrompt.includes(term));
});

test('direction never approves a missing still, claims face locking or pretends to create audio/video',()=>{
  const plan=buildMahabharataDirection({brief:'Mahabharat'});
  assert.equal(plan.status,'direction-only');assert.equal(plan.productionPlan.renderable,false);assert.equal(plan.castCandidate.generationStatus,'not-started');assert.equal(plan.castCandidate.reviewStatus,'unreviewed');assert.equal(plan.castCandidate.motionRequested,false);
  assert.equal(plan.qualityPolicy.approveFromPrompt,false);assert.equal(plan.qualityPolicy.automaticQualityScore,false);assert.equal(plan.narration.status,'not-produced');assert.equal(plan.productionPlan.soundDesign.status,'not-produced');
  assert.ok(plan.characters.every(character=>character.faceReference.status==='missing'&&character.faceReference.outputHash===null));assert.match(plan.locks.face.policy,/Matching seeds and repeated prompts do not lock a face/);
  assert.equal(plan.productionPlan.captionsEnabled,false);assert.equal(plan.narration.lipSyncRequested,false);
});

test('story roles are cited and narration is original editorial writing with valid local voice cues',()=>{
  const plan=buildMahabharataDirection({brief:'A Mahabharata film trailer'});
  assert.equal(plan.authorship.method,'built-in-editorial-recipe');assert.equal(plan.authorship.llmGenerated,false);assert.equal(plan.authorship.liveResearchPerformed,false);
  assert.match(plan.characters.find(character=>character.id==='arjuna').role,/Archer/);assert.match(plan.characters.find(character=>character.id==='krishna').role,/charioteer/);
  assert.match(plan.script,/teachers|family/);assert.match(plan.script,/Krishna holds the reins/);assert.match(plan.script,/grieving heart/);assert.doesNotMatch(plan.script,/I am become|destroyer of worlds|victory is certain/i);
  assert.deepEqual(validateNarrationCues({cues:plan.narration.cues,durationSeconds:30,text:plan.script}),plan.narration.cues);
  assert.ok(plan.narration.cues.every(cue=>(cue.text.split(/\s+/).length/(cue.end-cue.start))*60<160));
  assert.ok(plan.sourceCitations.every(source=>source.url.startsWith('https://')&&source.supports.length&&source.limits&&source.use));
  for(const shot of plan.shots)for(const id of shot.sourceIds)assert.ok(plan.sourceCitations.some(source=>source.id===id));
  assert.match(plan.qualityPolicy.historicalAccuracy,/no claim of exact historical faces/);
});

test('casting request validates against the actual local still adapter with no output or source injection',()=>{
  const plan=buildMahabharataDirection({brief:'Mahabharata trailer',seed:42}),candidate=plan.castCandidate;
  const request=validateKeyframeRequest({projectId:'ordinary-prompt-project',expectedRevision:3,prompt:candidate.prompt,negativePrompt:candidate.negativePrompt,seed:candidate.seed,width:candidate.width,height:candidate.height,steps:candidate.steps,queuePolicy:'fifo'});
  assert.equal(request.kind,'generation-keyframe');assert.equal(request.width,1024);assert.equal(request.steps,20);assert.ok(request.negativePrompt.length<=2000);
  assert.ok(!('path' in candidate));assert.ok(!('sourceJobId' in candidate));assert.ok(!('assetId' in candidate));
});

test('seeds and direction receipts are deterministic and invalid profiles cannot silently shorten the film',()=>{
  const first=buildMahabharataDirection({brief:'Mahabharata trailer',seed:0xffffffff});assert.deepEqual(first,buildMahabharataDirection({brief:'Mahabharata trailer',seed:0xffffffff}));assert.equal(first.shots[1].seed,0);
  assert.notEqual(first.directionHash,buildMahabharataDirection({brief:'Mahabharata trailer',seed:1}).directionHash);
  for(const change of [{durationSeconds:15},{durationSeconds:60},{durationSeconds:'30'},{seed:-1},{seed:1.5},{seed:0x100000000},{brief:'A landscape'},{referencePath:'outside.png'}])assert.throws(()=>buildMahabharataDirection({brief:'Mahabharata trailer',...change}),/MAHABHARATA_/);
  first.characters[0].wardrobe.dhoti='red';assert.equal(buildMahabharataDirection({brief:'Mahabharata trailer'}).characters[0].wardrobe.dhoti,'ivory cotton with narrow gold border');
});

test('motion-only and repeated-face checks are not falsely treated as inspectable in the first still',()=>{
  const plan=buildMahabharataDirection({brief:'Mahabharata trailer'});
  assert.ok(!plan.castCandidate.requiredVisualCriteria.some(item=>['motion-and-temporal-review','arjuna-face-continuity','audio-and-delivery'].includes(item.id)));
  assert.ok(plan.shots[4].visualCriteria.required.some(item=>item.id==='arjuna-face-continuity'));
  assert.ok(plan.shots[2].visualCriteria.required.every(item=>!['arjuna-clean-shaven','arjuna-hair','arjuna-low-gold-diadem'].includes(item.id)));
  assert.match(plan.shots.at(-1).prompt,/not rage, triumph or a claim that his dilemma is already resolved/);
});
