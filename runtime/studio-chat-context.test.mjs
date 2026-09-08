import test from 'node:test';
import assert from 'node:assert/strict';
import { studioProjectCharacters,studioProjectShots } from '../studio-chat.js';
import { conversationContext } from './studio-conversation.mjs';
test('existing film shot plans and character direction remain connected without exposing obsolete file references',()=>{
 const project={name:'Existing film',productionPlan:{shots:[{id:'shot1',keyframePrompt:'Chariot in dust',durationSeconds:5,generationStatus:'needs-casting-revision'}]},characterReferences:{arjuna:{description:'Historical direction',referenceImagePath:'C:/old/rejected.png',approvalStatus:'replacement-required'}},timeline:[]};
 assert.equal(studioProjectShots(project).length,1);const c=studioProjectCharacters(project)[0];assert.equal(c.name,'Arjuna');assert.equal(c.status,'replacement-required');assert.equal(c.referenceAssetId,null);assert.equal(c.referenceImagePath,undefined);
 const context=conversationContext(project);assert.equal(context.shots[0].prompt,'Chariot in dust');assert.equal(context.characters[0].status,'replacement-required');assert.doesNotMatch(JSON.stringify(context),/rejected.png/);
 project.characters=[{id:'new',name:'Arjuna',description:'Updated direction'}];assert.equal(studioProjectCharacters(project).length,1);assert.equal(studioProjectCharacters(project)[0].description,'Updated direction');
});
