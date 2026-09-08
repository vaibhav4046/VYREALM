import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** @typedef {'uploaded-media'|'local-generation'|'mixed'} CreatorSourceMode */
/** @typedef {'ready'|'needs-input'|'review-required'|'blocked'|'not-requested'} CreatorStageStatus */
/** @typedef {{projectId:string,expectedRevision:number,workflowId:string,brief:string,durationSeconds:number,sourceMode:CreatorSourceMode,assetIds?:string[],captionsEnabled?:boolean,narrationMode?:'uploaded'|'piper'|'none',researchNotes?:string,scriptText?:string,characterContinuity?:string}} CreatorWorkflowInput */
/** @typedef {{id:string,label:string,implementation:'implemented'|'missing',status:'ready'|'configured'|'preflight-required'|'missing-runtime'|'missing',verifiedExecution:boolean,diagnostic:string}} CreatorCapability */

const workflows = [
 {id:'cinematic',label:'Original film',description:'Develop an original story with inspected references and shot-level continuity.',roles:['establish the setting','introduce the subject','show the turning point','hold the consequence'],sourceModes:['uploaded-media','local-generation','mixed']},
 {id:'product-ad',label:'Product story',description:'Build an accurate demonstration from your product photography or footage.',roles:['show the product clearly','demonstrate its use','show evidence and detail','finish with the requested call to action'],sourceModes:['uploaded-media','local-generation','mixed']},
 {id:'talking-head',label:'Talking-head edit',description:'Edit a real recorded speaker, then review the transcript and captions.',roles:['select the opening statement','keep the strongest explanation','add relevant supporting footage','retain the closing thought'],sourceModes:['uploaded-media']},
 {id:'social-recut',label:'Social recut',description:'Select moments from existing footage and compose a platform-sized edit.',roles:['select the strongest opening','preserve necessary context','show the payoff','close clearly'],sourceModes:['uploaded-media']},
 {id:'tutorial',label:'Tutorial',description:'Explain a process with your screen recording or filmed demonstration.',roles:['show the intended result','show the first essential step','show the remaining steps','verify the result'],sourceModes:['uploaded-media','mixed']},
 {id:'faceless',label:'Narrated explainer',description:'Combine reviewed source material, an editable script and local narration.',roles:['introduce the question','supply the context','show the supporting evidence','state the conclusion'],sourceModes:['uploaded-media','local-generation','mixed']},
];
export const CREATOR_WORKFLOWS = Object.freeze(workflows.map(w=>Object.freeze({...w,roles:Object.freeze(w.roles),sourceModes:Object.freeze(w.sourceModes)})));
const allowed = new Set(['projectId','expectedRevision','workflowId','brief','durationSeconds','sourceMode','assetIds','captionsEnabled','narrationMode','researchNotes','scriptText','characterContinuity']);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(value);
function optionalText(value,name,max){if(value===undefined)return '';if(typeof value!=='string'||value.length>max)fail('CREATOR_INPUT_INVALID',`${name} must be text no longer than ${max} characters`);return value.trim();}

export function validateCreatorWorkflowInput(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.has(k)))fail('CREATOR_INPUT_INVALID','Unsupported creator workflow fields');
 if(!validId(input.projectId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)fail('CREATOR_INPUT_INVALID','A saved project and positive expectedRevision are required');
 const workflow=CREATOR_WORKFLOWS.find(w=>w.id===input.workflowId);if(!workflow)fail('CREATOR_INPUT_INVALID','Choose an available creator workflow');
 const brief=optionalText(input.brief,'brief',6000);if(!brief)fail('CREATOR_INPUT_INVALID','Provide an original brief');
 if(!Number.isFinite(input.durationSeconds)||input.durationSeconds<1||input.durationSeconds>600)fail('CREATOR_INPUT_INVALID','Plan a duration between 1 and 600 seconds');
 if(!workflow.sourceModes.includes(input.sourceMode))fail('CREATOR_INPUT_INVALID','This workflow does not support the selected source mode');
 const assetIds=input.assetIds??[];if(!Array.isArray(assetIds)||assetIds.length>64||assetIds.some(id=>!validId(id))||new Set(assetIds).size!==assetIds.length)fail('CREATOR_INPUT_INVALID','Select at most 64 distinct project assets');
 if(input.captionsEnabled!==undefined&&typeof input.captionsEnabled!=='boolean')fail('CREATOR_INPUT_INVALID','Caption preference must be true or false');
 const narrationMode=input.narrationMode??'none';if(!['uploaded','piper','none'].includes(narrationMode))fail('CREATOR_INPUT_INVALID','Choose uploaded speech, local Piper or no narration');
 return {projectId:input.projectId,expectedRevision:input.expectedRevision,workflowId:workflow.id,brief,durationSeconds:input.durationSeconds,sourceMode:input.sourceMode,assetIds:[...assetIds],captionsEnabled:input.captionsEnabled??false,narrationMode,researchNotes:optionalText(input.researchNotes,'researchNotes',12000),scriptText:optionalText(input.scriptText,'scriptText',12000),characterContinuity:optionalText(input.characterContinuity,'characterContinuity',4000)};
}

/** Configuration inspection only: no network requests, model loading, hashing of large weights or subprocesses. */
export async function inspectCreatorWorkflows({root=process.cwd(),runtimeDirectory=join(root,'data','runtime')}={}){
 const file=path=>existsSync(join(root,path));const binary=name=>file(`workers/tools/${name}${process.platform==='win32'?'.exe':''}`);
 let audio=null;try{audio=JSON.parse(await readFile(join(runtimeDirectory,'audio.json'),'utf8'));}catch{}
 const voice=Boolean(audio?.python&&audio?.voice&&existsSync(audio.python)&&existsSync(audio.voice));
 const whisper=Boolean(audio?.python&&audio?.whisper&&existsSync(audio.python)&&existsSync(audio.whisper));
 const implemented=(id,label,configured,diagnostic,preflight=false)=>({id,label,implementation:'implemented',status:configured?(preflight?'preflight-required':'configured'):'missing-runtime',verifiedExecution:false,diagnostic});
 const missing=(id,label,diagnostic)=>({id,label,implementation:'missing',status:'missing',verifiedExecution:false,diagnostic});
 const capabilities=[
  {id:'planning',label:'Offline creator planning',implementation:'implemented',status:'ready',verifiedExecution:false,diagnostic:'Deterministic editable outline; no factual research or media generation is implied.'},
  implemented('director','Local model director',file('runtime/director.mjs'),'Ollama and the selected model are checked when the existing director job runs; cinematic source plans are bounded to 120 seconds.',true),
  implemented('assets','Local media import',file('server.js'),'Import images, video and audio into this project; inspection of source content remains required.'),
  implemented('timeline','Timeline edit and render',file('workers/timeline.mjs')&&binary('ffmpeg')&&binary('ffprobe'),'FFmpeg trims, crops, ordered clips and audio mix. Source decoding, duration and output quality are validated by the render job.'),
  implemented('captions','Editable timed captions',file('runtime/timed-captions.mjs'),'User text and timestamps remain editable; script timing is not speech recognition.'),
  implemented('voiceover','Local Piper narration',voice&&file('workers/audio.mjs'),'CPU narration revalidates model hashes at invocation. Pronunciation and timing require review.'),
  implemented('transcription','Local Whisper transcription',whisper&&file('workers/audio.mjs'),'CPU transcription revalidates model hashes. Speaker diarization is not included.'),
  implemented('sound-design','Original local sound design',file('workers/sound-design.mjs'),'Synthesized DSP atmosphere and cues; requires an existing 1–90 second edit. Not neural music.'),
  implemented('generation','Local keyframe and image-to-video',file('workers/neural.mjs'),'Provider, exact model files, resource limits and owned generation evidence must pass preflight and review.',true),
  implemented('enhancement','Local 4K enhancement',file('workers/enhance.mjs'),'The selected enhancement runtime and source provenance require preflight; canvas resize is not AI upscaling.',true),
  implemented('release','Local release package',file('publishing/index.js'),'Prepare metadata, rights and disclosure for an existing output. This does not upload or publish.'),
  implemented('mcp','Optional local MCP',file('mcp-server.mjs'),'Local automation uses the same project and job APIs; no agent subscription is needed by the app.'),
  missing('online-research','Live research','Supply source notes locally. A live research adapter is not connected to this workflow.'),
  missing('lip-sync','Neural lip-sync and avatars','No qualified lip-sync worker is connected; use recorded speaker footage.'),
  missing('dubbing','Multilingual dubbing','Translation, speaker matching and timing are not connected as an end-to-end adapter.'),
  missing('diarization','Speaker diarization','Review speakers and transcript ranges manually.'),
  missing('highlights','Automatic highlight selection','Choose transcript ranges and trims in the timeline; no relevance model is qualified.'),
  missing('relighting','Neural video relighting','Existing grade filters are not a neural relighting or region-editing adapter.'),
  missing('publishing','Online publishing','No automatic upload is performed; channel authorization and an explicit publishing adapter are required.'),
 ];
 return {schemaVersion:1,offline:true,workflowPlanning:true,workflows:CREATOR_WORKFLOWS,capabilities,inspection:{method:'local-configuration-only',modelsInvoked:false,networkAccess:false,verifiedExecution:false},store:'existing-projects-and-project_revisions',planningEndpoint:'/api/creator/workflows/plan'};
}

/** Make data and fixed action descriptors only. A plan never claims a completed production stage. */
export function buildCreatorWorkflowPlan({input,project,assets=[],capabilities=[],createdAt=new Date().toISOString(),id=randomUUID()}={}){
 const value=validateCreatorWorkflowInput(input);if(project?.id!==value.projectId)fail('CREATOR_PROJECT_NOT_FOUND','Project not found');
 if(project.revision!==value.expectedRevision)fail('CREATOR_REVISION_CONFLICT','The project changed; refresh before planning');
 const definition=CREATOR_WORKFLOWS.find(w=>w.id===value.workflowId),selected=value.assetIds.map(id=>{
  const asset=assets.find(a=>a.id===id);if(!asset||asset.projectId!==project.id||asset.available===false||! /^(image|video|audio)\//.test(asset.mime||''))fail('CREATOR_ASSET_INVALID','Select existing image, video or audio assets owned by this project');
  return {id:asset.id,name:String(asset.name||asset.id).slice(0,300),mime:asset.mime,provenance:{generationStatus:'imported-or-existing',claim:'Existing project asset; this planning step generates no media.'}};
 });
 const visuals=selected.filter(a=>/^(image|video)\//.test(a.mime)),speech=selected.find(a=>/^(audio|video)\//.test(a.mime));
 const fps=[24,25,30,60].includes(project.settings?.fps)?project.settings.fps:24,totalFrames=Math.round(value.durationSeconds*fps),count=Math.min(definition.roles.length,totalFrames);
 let cursor=0;const shots=definition.roles.slice(0,count).map((role,index)=>{
  const frames=index===count-1?totalFrames-cursor:Math.floor(totalFrames/count),startFrame=cursor;cursor+=frames;
  return {id:`creator-shot-${index+1}`,role,description:`${role.charAt(0).toUpperCase()+role.slice(1)}. Creative brief: ${value.brief}`,startFrame,durationFrames:frames,durationSeconds:frames/fps,route:value.sourceMode==='local-generation'?'neural-video':'local-media',candidateAssetId:visuals[index]?.id??null,assetSelectionStatus:'review-required',generationStatus:value.sourceMode==='uploaded-media'?'not-requested':'not-generated',continuity:value.characterContinuity||'Review subject, wardrobe, props, setting and lighting between shots.'};
 });
 const revision=project.revision+1,body={projectId:project.id,expectedRevision:revision};
 const configured=id=>['ready','configured'].includes(capabilities.find(c=>c.id===id)?.status);
 const actions=[
  {id:'review-script',kind:'navigate',label:'Review script and production plan',view:'plan',status:'ready'},
  {id:'import-assets',kind:'navigate',label:'Add and inspect local media',view:'assets',status:'ready'},
  {id:'edit-timeline',kind:'navigate',label:'Choose takes, trims and framing',view:'timeline',status:visuals.length?'ready':'needs-input'},
  {id:'render-edit',kind:'api',label:'Render the saved timeline',method:'POST',endpoint:'/api/jobs',body:{...body,type:'render'},status:project.timeline?.length&&configured('timeline')?'ready':'needs-input',requires:['A saved timeline with decodable source media','Review caption text, framing and audio settings']},
  {id:'review-render',kind:'navigate',label:'Inspect the rendered video',view:'jobs',status:'needs-input'},
  {id:'export-project',kind:'api',label:'Download editable project bundle',method:'GET',endpoint:`/api/projects/${encodeURIComponent(project.id)}/export`,status:'ready',requires:['Individual embedded assets below 50 MB; total below 300 MB']},
  {id:'prepare-release',kind:'navigate',label:'Review export and release details',view:'export',status:'needs-input',requires:['An actual rendered video','Rights and disclosure review; publication is separate']},
 ];
 if(value.narrationMode==='piper')actions.push({id:'generate-narration',kind:'api',label:'Generate local narration',method:'POST',endpoint:'/api/audio/voiceover',...(value.scriptText&&value.scriptText.length<=5000?{body:{...body,text:value.scriptText}}:{}),status:!value.scriptText||value.scriptText.length>5000?'needs-input':configured('voiceover')?'ready':'blocked',requires:['Reviewed spoken script, at most 5000 characters','Installed Piper voice; pronunciation review afterward']});
 if(value.captionsEnabled){actions.push({id:'edit-captions',kind:'navigate',label:'Review caption text and timing',view:'timeline',status:'ready'});actions.push({id:'transcribe-media',kind:'api',label:'Transcribe selected local speech',method:'POST',endpoint:'/api/audio/transcribe',...(speech?{body:{...body,assetId:speech.id}}:{}),status:!speech?'needs-input':configured('transcription')?'ready':'blocked',requires:['A project audio or video source containing speech','Review words, names and timing']});}
 if(value.sourceMode!=='uploaded-media')actions.push({id:'provider-preflight',kind:'api',label:'Check local generation provider',method:'GET',endpoint:'/api/generation/preflight',status:'ready'},{id:'run-generation',kind:'navigate',label:'Generate and inspect source shots',view:'create',status:'needs-input',requires:['A ready provider and approved character/location references','An owned local generation receipt for each clip']});
 const stage=(id,label,status,actionIds,dependsOn=[])=>({id,label,status,actionIds,dependsOn});
 const stages=[stage('brief','Creative brief','ready',[],[]),stage('research','Source notes and context',value.researchNotes?'review-required':'needs-input',[],['brief']),stage('script','Script review',value.scriptText?'review-required':'needs-input',['review-script'],['brief','research']),stage('shots','Shot and continuity plan','review-required',['review-script'],['script']),stage('assets','Source media',visuals.length?'ready':'needs-input',['import-assets',...(value.sourceMode!=='uploaded-media'?['provider-preflight','run-generation']:[])],['shots']),stage('audio','Narration and sound',value.narrationMode==='none'?'not-requested':value.narrationMode==='uploaded'&&speech?'review-required':'needs-input',value.narrationMode==='piper'?['generate-narration']:['import-assets'],['script']),stage('captions','Captions',value.captionsEnabled?'needs-input':'not-requested',value.captionsEnabled?['transcribe-media','edit-captions']:[],['audio']),stage('edit','Timeline edit','needs-input',['edit-timeline','render-edit'],['assets','audio','captions']),stage('review','Watch and inspect','needs-input',['review-render'],['edit']),stage('export','Export and local release','needs-input',['export-project','prepare-release'],['review'])];
 return {schemaVersion:1,id,workflowId:definition.id,label:definition.label,projectId:project.id,revision,createdAt,status:'planned',offline:true,sourceMode:value.sourceMode,generationStatus:value.sourceMode==='uploaded-media'?'not-requested':'not-generated',mediaGenerated:false,inputs:value,brief:value.brief,durationSeconds:totalFrames/fps,durationFrames:totalFrames,fps,characterContinuity:value.characterContinuity,research:{notes:value.researchNotes,verification:value.researchNotes?'unverified-user-context':'not-provided',networkResearchPerformed:false},script:{text:value.scriptText||value.brief,source:value.scriptText?'user-supplied':'brief-outline',requiresReview:true,spokenScriptApproved:false,instruction:value.scriptText?'Review exact words and factual claims before narration.':'This is the supplied brief as an outline. Supply spoken script text before generating narration.'},shots,selectedAssets:selected,stages,actions,capabilitySnapshot:capabilities.map(c=>({id:c.id,implementation:c.implementation,status:c.status})),inputHash:createHash('sha256').update(JSON.stringify(value)).digest('hex'),provenance:{planner:'deterministic-local-template',modelInvoked:false,networkAccess:false,scriptGeneratedByModel:false},diagnostics:['PLAN_ONLY_NO_MEDIA_GENERATED','REVIEW_SCRIPT_SOURCES_AND_CONTINUITY']};
}

/** Persist only the plan in the canonical project and append its revision atomically. */
export function saveCreatorWorkflowPlan({db,input,capabilities=[]}={}){
 const value=validateCreatorWorkflowInput(input),row=db.prepare('SELECT * FROM projects WHERE id=?').get(value.projectId);if(!row)fail('CREATOR_PROJECT_NOT_FOUND','Project not found');
 const original=JSON.parse(row.document),project={...original,id:row.id,revision:row.revision};
 const assets=db.prepare('SELECT * FROM assets WHERE project_id=?').all(row.id).map(a=>({...JSON.parse(a.document),id:a.id,projectId:a.project_id,available:existsSync(a.path)}));
 const plan=buildCreatorWorkflowPlan({input:value,project,assets,capabilities}),document={...original,creatorWorkflow:plan},serialized=JSON.stringify(document),at=plan.createdAt;
 db.exec('BEGIN IMMEDIATE');try{
  const changed=db.prepare('UPDATE projects SET revision=?,document=?,updated_at=? WHERE id=? AND revision=?').run(plan.revision,serialized,at,row.id,value.expectedRevision);
  if(!changed.changes)fail('CREATOR_REVISION_CONFLICT','The project changed while saving its creator plan');
  db.prepare('INSERT INTO project_revisions (project_id,revision,document,created_at) VALUES (?,?,?,?)').run(row.id,plan.revision,serialized,at);db.exec('COMMIT');
 }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
 return {project:{...document,id:row.id,revision:plan.revision,createdAt:row.created_at,updatedAt:at},plan};
}
