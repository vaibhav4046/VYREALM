import { createHash, randomUUID } from 'node:crypto';
import { LOCAL_AUTOMATION_PENDING_LIMIT, summarizeLocalAutomations } from './local-automations.mjs';

const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const diagnostic=error=>({code:String(error.code||'AUTOMATION_BATCH_INTERRUPTED').slice(0,100),message:String(error.message||'Batch admission was interrupted. Retry this same requestId to reconcile durable admissions.').slice(0,1600)});
const finalRejections=new Set(['AUTOMATION_REQUEST','AUTOMATION_SCHEDULE','AUTOMATION_REVISION','AUTOMATION_TIMELINE','AUTOMATION_SNAPSHOT','AUTOMATION_PROJECT_CONFLICT','AUTOMATION_QUEUE_FULL','AUTOMATION_REQUEST_CONFLICT','AUTOMATION_REQUEST_EVIDENCE']);

/** @typedef {{projectId:string,expectedRevision:number,name?:string}} SavedEditEntry */
/** @typedef {{requestId:string,name:string,scheduledAt?:string,entries:SavedEditEntry[]}} SavedEditBatchRequest */
export function validateLocalAutomationBatch(input){
 if(!object(input)||Object.keys(input).some(k=>!['requestId','name','scheduledAt','entries'].includes(k))||!identifier(input.requestId)||typeof input.name!=='string'||!input.name.trim()||input.name.length>120||/[\u0000-\u001f]/.test(input.name))fail('AUTOMATION_BATCH_REQUEST','A requestId and name of up to 120 characters are required. Only saved edit entries and an optional schedule are accepted.');
 if(!Array.isArray(input.entries)||input.entries.length<1||input.entries.length>LOCAL_AUTOMATION_PENDING_LIMIT)fail('AUTOMATION_BATCH_LIMIT',`Select 1–${LOCAL_AUTOMATION_PENDING_LIMIT} distinct saved projects. A batch does not generate projects or source media.`);
 if(input.scheduledAt!==undefined&&(typeof input.scheduledAt!=='string'||!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.scheduledAt)||!Number.isFinite(Date.parse(input.scheduledAt))))fail('AUTOMATION_BATCH_SCHEDULE','Use an ISO schedule with an explicit timezone.');
 const name=input.name.trim(),seen=new Set(),entries=input.entries.map((entry,index)=>{
  if(!object(entry)||Object.keys(entry).some(k=>!['projectId','expectedRevision','name'].includes(k))||!identifier(entry.projectId)||!Number.isSafeInteger(entry.expectedRevision)||entry.expectedRevision<1||entry.name!==undefined&&(typeof entry.name!=='string'||!entry.name.trim()||entry.name.length>160||/[\u0000-\u001f]/.test(entry.name)))fail('AUTOMATION_BATCH_REQUEST',`Entry ${index+1} must identify a saved project, positive revision and optional bounded name. Prompts, paths and generation instructions are not accepted.`);
  if(seen.has(entry.projectId))fail('AUTOMATION_BATCH_DUPLICATE','Each saved project may appear only once in a batch. Save distinct projects for distinct edits.');seen.add(entry.projectId);
  return{projectId:entry.projectId,expectedRevision:entry.expectedRevision,name:entry.name?.trim()||`${name} · ${index+1} of ${input.entries.length}`};
 });
 return{requestId:input.requestId,name,...(input.scheduledAt?{scheduledAt:new Date(input.scheduledAt).toISOString()}:{}),entries};
}

export function localAutomationBatchEntryRequestId(batchId,projectId,expectedRevision){
 if(!identifier(batchId)||!identifier(projectId)||!Number.isSafeInteger(expectedRevision)||expectedRevision<1)fail('AUTOMATION_BATCH_REQUEST','A valid batch, project and revision are required for admission identity.');
 return`batch-${hash(['vyrealm-saved-edit-batch-v1',batchId,projectId,expectedRevision])}`;
}

/**
 * Durable admission only; no worker, GPU, project/media creation or publishing.
 * Each existing automations.create() commits independently. A crash between its
 * commit and our receipt is recovered through its durable per-entry requestId.
 * Schema validation precedes all writes; eligibility failures are per-entry.
 * get/list are read-only. recover() performs bounded interrupted admission only.
 */
export function createLocalAutomationBatches({db,automations,clock=Date.now}={}){
 if(!db?.prepare||!db?.exec||typeof automations?.create!=='function'||typeof automations?.get!=='function'||typeof clock!=='function')fail('AUTOMATION_BATCH_CONFIG','The canonical SQLite database and existing local automation service are required.');
 db.exec(`CREATE TABLE IF NOT EXISTS local_automation_batches(
  id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,input_hash TEXT NOT NULL,
  name TEXT NOT NULL,scheduled_at TEXT,admission_status TEXT NOT NULL,
  input_json TEXT NOT NULL,diagnostic TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
 );CREATE TABLE IF NOT EXISTS local_automation_batch_entries(
  batch_id TEXT NOT NULL,position INTEGER NOT NULL,project_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,request_id TEXT NOT NULL UNIQUE,name TEXT NOT NULL,
  status TEXT NOT NULL,automation_id TEXT,diagnostic TEXT,
  PRIMARY KEY(batch_id,position)
 );CREATE INDEX IF NOT EXISTS local_automation_batch_pending ON local_automation_batches(admission_status,created_at);`);
 const time=()=>{const n=clock();if(!Number.isFinite(n))fail('AUTOMATION_BATCH_CLOCK','A finite local clock is required.');return new Date(n).toISOString();};
 const row=id=>db.prepare('SELECT * FROM local_automation_batches WHERE id=?').get(id);
 const rows=id=>db.prepare('SELECT * FROM local_automation_batch_entries WHERE batch_id=? ORDER BY position').all(id);
 const transaction=action=>{db.exec('BEGIN IMMEDIATE');try{const result=action();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
 function checkedInput(batch){
  try{const input=validateLocalAutomationBatch(JSON.parse(batch.input_json));if(input.requestId!==batch.request_id||hash(input)!==batch.input_hash)throw Error('Changed batch');return input;}
  catch{fail('AUTOMATION_BATCH_EVIDENCE','The saved batch request changed. No additional automation was admitted.');}
 }
 function checkedEntries(batch,input){
  const entries=rows(batch.id);
  if(entries.length!==input.entries.length||entries.some((entry,i)=>entry.position!==i||entry.project_id!==input.entries[i].projectId||entry.expected_revision!==input.entries[i].expectedRevision||entry.name!==input.entries[i].name||entry.request_id!==localAutomationBatchEntryRequestId(batch.id,entry.project_id,entry.expected_revision)||!['pending','accepted','rejected'].includes(entry.status)))fail('AUTOMATION_BATCH_EVIDENCE','The saved batch entries do not match the original request. No additional automation was admitted.');
  return entries;
 }
 function ownedAutomation(entry){
  const reference=db.prepare('SELECT automation_id FROM local_automation_requests WHERE request_id=?').get(entry.request_id);
  const automation=entry.automation_id&&automations.get(entry.automation_id);
  if(reference?.automation_id!==entry.automation_id||!automation||automation.id!==entry.automation_id||automation.projectId!==entry.project_id||automation.expectedRevision!==entry.expected_revision)return null;
  return automation;
 }
 function view(batch){
  if(!batch)return null;const input=checkedInput(batch),stored=checkedEntries(batch,input),runs=[];
  const counts={requested:stored.length,accepted:0,rejected:0,admissionPending:0,missingAutomations:0};
  const entries=stored.map(entry=>{
   counts[entry.status==='pending'?'admissionPending':entry.status]++;
   let automation=null,problem=entry.diagnostic?JSON.parse(entry.diagnostic):null;
   if(entry.status==='accepted'){
    automation=ownedAutomation(entry);
    if(automation)runs.push(automation);else{counts.missingAutomations++;problem={code:'AUTOMATION_BATCH_ENTRY_EVIDENCE',message:'The durable automation request, project or receipt no longer matches this batch entry. No output is counted.'};}
   }
   return{position:entry.position,projectId:entry.project_id,expectedRevision:entry.expected_revision,name:entry.name,admissionStatus:entry.status,automationId:entry.automation_id||null,automation,diagnostic:problem};
  });
  const summary=summarizeLocalAutomations(runs);Object.assign(counts,summary);delete counts.total;
  let status='attention-required';
  if(counts.admissionPending)status='admitting';else if(counts.pending)status='in-progress';else if(!counts.accepted)status='rejected';else if(counts.readyForReview===counts.requested)status='needs-review';else if(counts.readyForReview)status='partial-needs-review';
  return{id:batch.id,kind:'saved-edit-render-batch',requestId:batch.request_id,name:batch.name,scheduledAt:batch.scheduled_at,admissionStatus:batch.admission_status,partialAdmission:counts.accepted>0&&counts.rejected>0,status,counts,entries,diagnostic:batch.diagnostic?JSON.parse(batch.diagnostic):null,createdAt:batch.created_at,updatedAt:batch.updated_at};
 }
 function admit(id){
  const batch=row(id),input=checkedInput(batch),entries=checkedEntries(batch,input);let interrupted;
  for(const entry of entries){
   if(entry.status!=='pending')continue;
   try{
    const result=automations.create({name:entry.name,projectId:entry.project_id,expectedRevision:entry.expected_revision,requestId:entry.request_id,...(input.scheduledAt?{scheduledAt:input.scheduledAt}:{})});
    if(!identifier(result?.id)||result.projectId!==entry.project_id||result.expectedRevision!==entry.expected_revision)fail('AUTOMATION_BATCH_ENTRY_EVIDENCE','Admission returned no matching saved-project automation. Retry this batch to reconcile the durable request.');
    // This reference must have been written by the existing service's admission
    // transaction; callers cannot adopt another project's pending workflow.
    const reference=db.prepare('SELECT automation_id FROM local_automation_requests WHERE request_id=?').get(entry.request_id);
    if(reference?.automation_id!==result.id)fail('AUTOMATION_BATCH_ENTRY_EVIDENCE','The per-entry admission request has no matching durable automation identity.');
    db.prepare("UPDATE local_automation_batch_entries SET status='accepted',automation_id=?,diagnostic=NULL WHERE batch_id=? AND position=? AND status='pending'").run(result.id,id,entry.position);
   }catch(error){
    const problem=diagnostic(error);
    if(finalRejections.has(error.code)){db.prepare("UPDATE local_automation_batch_entries SET status='rejected',diagnostic=? WHERE batch_id=? AND position=? AND status='pending'").run(JSON.stringify(problem),id,entry.position);continue;}
    // An unknown failure may follow a committed admission. Keep its exact key
    // pending instead of reporting rejection or starting another automation.
    interrupted=problem;db.prepare("UPDATE local_automation_batch_entries SET diagnostic=? WHERE batch_id=? AND position=? AND status='pending'").run(JSON.stringify(problem),id,entry.position);break;
   }
  }
  const remaining=db.prepare("SELECT count(*) n FROM local_automation_batch_entries WHERE batch_id=? AND status='pending'").get(id).n;
  db.prepare('UPDATE local_automation_batches SET admission_status=?,diagnostic=?,updated_at=? WHERE id=?').run(remaining?'interrupted':'complete',interrupted?JSON.stringify(interrupted):null,time(),id);
  return view(row(id));
 }
 function create(value){
  const input=validateLocalAutomationBatch(value),inputHash=hash(input);
  const id=transaction(()=>{
   const existing=db.prepare('SELECT * FROM local_automation_batches WHERE request_id=?').get(input.requestId);
   if(existing){if(existing.input_hash!==inputHash)fail('AUTOMATION_BATCH_REQUEST_CONFLICT','This requestId belongs to a different saved-edit batch. Reuse it only for an identical retry.');return existing.id;}
   const id=randomUUID(),stamp=time();db.prepare('INSERT INTO local_automation_batches VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,input.requestId,inputHash,input.name,input.scheduledAt||null,'admitting',JSON.stringify(input),null,stamp,stamp);
   const insert=db.prepare('INSERT INTO local_automation_batch_entries VALUES(?,?,?,?,?,?,?,?,?)');
   input.entries.forEach((entry,i)=>insert.run(id,i,entry.projectId,entry.expectedRevision,localAutomationBatchEntryRequestId(id,entry.projectId,entry.expectedRevision),entry.name,'pending',null,null));return id;
  });
  return row(id).admission_status==='complete'?view(row(id)):admit(id);
 }
 function get(id){if(!identifier(id))fail('AUTOMATION_BATCH_REQUEST','Invalid batch ID.');return view(row(id));}
 function list(options={}){
  if(!object(options)||Object.keys(options).some(k=>!['limit','before'].includes(k))||options.limit!==undefined&&(!Number.isInteger(options.limit)||options.limit<1||options.limit>100)||options.before!==undefined&&!identifier(options.before))fail('AUTOMATION_BATCH_REQUEST','List accepts a limit of 1–100 and an optional batch ID cursor.');
  const limit=options.limit||20,cursor=options.before?row(options.before):null;
  if(options.before&&!cursor)fail('AUTOMATION_BATCH_NOT_FOUND','The batch page cursor does not exist.');
  const result=cursor?db.prepare('SELECT * FROM local_automation_batches WHERE created_at<? OR (created_at=? AND id<?) ORDER BY created_at DESC,id DESC LIMIT ?').all(cursor.created_at,cursor.created_at,cursor.id,limit+1):db.prepare('SELECT * FROM local_automation_batches ORDER BY created_at DESC,id DESC LIMIT ?').all(limit+1);
  return{batches:result.slice(0,limit).map(view),nextCursor:result.length>limit?result[limit-1].id:null};
 }
 function recover(options={}){
  if(!object(options)||Object.keys(options).some(k=>k!=='limit')||options.limit!==undefined&&(!Number.isInteger(options.limit)||options.limit<1||options.limit>16))fail('AUTOMATION_BATCH_REQUEST','Recovery accepts a bounded limit of 1–16 batches.');
  const pending=db.prepare("SELECT id FROM local_automation_batches WHERE admission_status!='complete' ORDER BY created_at,id LIMIT ?").all(options.limit||8),batches=[];
  for(const item of pending){const batch=admit(item.id);batches.push(batch);if(batch.admissionStatus==='interrupted')break;}
  return{batches,remaining:db.prepare("SELECT count(*) n FROM local_automation_batches WHERE admission_status!='complete'").get().n};
 }
 return{create,get,list,recover};
}
