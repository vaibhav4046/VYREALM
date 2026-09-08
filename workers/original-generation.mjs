import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { produceLocalKeyframe, validateKeyframeRequest } from '../runtime/keyframe-production.mjs';
import { produceReviewedKeyframeMotion, ORIGINAL_GENERATION_OWNER, validateReviewedMotionRequest, originalMotionEngine } from '../runtime/reviewed-keyframe-motion.mjs';
import { createComfyUIProvider } from '../runtime/providers/comfyui.mjs';
import { runOriginalWithReconnect, writeOriginalWorkerFailure, recordOriginalMonitoring } from '../runtime/original-generation-monitor.mjs';
import { createOriginalProgressBridge } from '../runtime/original-generation-progress.mjs';

let failureContext;
try {
 const {values}=parseArgs({options:{'job-root':{type:'string'},kind:{type:'string'},'run-id':{type:'string'},'started-at':{type:'string'},'deadline-at':{type:'string'}},strict:true,allowPositionals:false});
 const startedAt=Number(values['started-at']),deadlineAt=Number(values['deadline-at']);
 if(!values['job-root']||!['keyframe','motion'].includes(values.kind)||!/^[a-f0-9-]{36}$/.test(values['run-id']||'')||!Number.isSafeInteger(startedAt)||!Number.isSafeInteger(deadlineAt)||deadlineAt<=startedAt||deadlineAt-startedAt>(values.kind==='keyframe'?20:90)*60000)throw new Error('Owned job directory, generation stage and bounded invocation required');
 const jobRoot=resolve(values['job-root']),jobsDir=dirname(jobRoot),dataDir=dirname(jobsDir),db=new DatabaseSync(join(dataDir,'vyrelum.sqlite'),{readOnly:true});
 try {
  const row=db.prepare('SELECT * FROM jobs WHERE id=?').get(basename(jobRoot)),input=JSON.parse(row?.input||'{}');
  if(input.serviceOwner!==ORIGINAL_GENERATION_OWNER||input.stageKind!==values.kind||row.status!=='running')throw new Error('Only an active original-generation job may own this worker');
  const request=JSON.parse(await readFile(join(jobRoot,values.kind==='keyframe'?'request.json':'motion-request.json'),'utf8'));
  if(JSON.stringify(input.request)!==JSON.stringify(request))throw new Error('The durable job and worker request differ');
  if(values.kind==='motion'){validateReviewedMotionRequest(request);if(originalMotionEngine(request)==='ltx-draft-512'&&deadlineAt-startedAt>20*60000)throw new Error('The experimental LTX draft worker is bounded to twenty minutes');}
  const project=db.prepare('SELECT revision FROM projects WHERE id=?').get(row.project_id);if(project?.revision!==request.expectedRevision)throw new Error('Project revision changed before local generation');
  failureContext={jobRoot,kind:values.kind,request,runId:values['run-id']};
  let reconnects=0;const onProgress=event=>{if(event.reconnecting)reconnects++;process.stdout.write(JSON.stringify({type:'progress',...event})+'\n');};
  const progress=createOriginalProgressBridge({...failureContext,deadlineAt,provider:createComfyUIProvider(),onProgress});let receipt;
  try{receipt=await runOriginalWithReconnect({...failureContext,deadlineAt,provider:progress.provider,onProgress:progress.progress,produce:({provider})=>values.kind==='keyframe'?produceLocalKeyframe({jobRoot,request:validateKeyframeRequest(request),provider,onProgress:progress.progress}):produceReviewedKeyframeMotion({jobRoot,request,db,jobsDir,mediaDir:join(dataDir,'media'),provider,onProgress:progress.progress})});}finally{await progress.close();}
  const monitored=recordOriginalMonitoring(receipt,{kind:values.kind,runId:values['run-id'],startedAt,deadlineAt,reconnects});await writeFile(join(jobRoot,'result.json'),JSON.stringify(monitored,null,2));
 } finally {db.close();}
} catch(error){if(failureContext)await writeOriginalWorkerFailure({...failureContext,error}).catch(()=>{});process.stderr.write(`${error.code||'ORIGINAL_WORKER_FAILED'}: ${error.message}\n`);process.exitCode=1;}
