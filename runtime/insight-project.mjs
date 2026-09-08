import { createHash, randomUUID } from 'node:crypto';
import { deriveYouTubeRecommendations } from '../publishing/youtube-insights.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNEL=/^UC[A-Za-z0-9_-]{22}$/;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const issue=(code,message,status=409)=>Object.assign(new Error(message),{code,status});
function parse(value){try{return JSON.parse(value);}catch{throw issue('INSIGHT_PROJECT_EVIDENCE_INVALID','The saved analytics evidence is unreadable.');}}
function validate(input){
 const keys=['requestId','channelId','snapshotId','recommendationId'];
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==keys.length||Object.keys(input).some(k=>!keys.includes(k))||!UUID.test(input.requestId||'')||!UUID.test(input.snapshotId||'')||!CHANNEL.test(input.channelId||'')||typeof input.recommendationId!=='string'||!input.recommendationId.length||input.recommendationId.length>300||/[\r\n\x00-\x1f]/.test(input.recommendationId))throw issue('INSIGHT_PROJECT_INVALID','Provide only a request UUID and the current channel, snapshot and recommendation IDs.',400);
 return {requestId:input.requestId.toLowerCase(),channelId:input.channelId,snapshotId:input.snapshotId.toLowerCase(),recommendationId:input.recommendationId};
}
function document(row){const p=parse(row.document);return {...p,id:row.id,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,assets:Array.isArray(p.assets)?p.assets:[]};}

/** Saves an editorial hypothesis from verified own-channel analytics; performs no generation or publishing. */
export async function createInsightProject({db,insights,input,now=()=>new Date().toISOString()}={}){
 if(!db||typeof insights?.handle!=='function'||typeof now!=='function')throw new TypeError('Insight drafts require the canonical database and insights service.');
 const request=validate(input),inputHash=hash(request);
 db.exec('CREATE TABLE IF NOT EXISTS insight_project_requests(request_id TEXT PRIMARY KEY,input_hash TEXT NOT NULL,project_id TEXT NOT NULL,snapshot_id TEXT NOT NULL,channel_id TEXT NOT NULL,recommendation_id TEXT NOT NULL,source_hash TEXT NOT NULL,created_at TEXT NOT NULL);');
 const response=await insights.handle({pathname:'/api/youtube/insights',method:'GET'}),state=response?.body;
 if(response?.status!==200)throw issue('INSIGHT_PROJECT_UNAVAILABLE','The current analytics state could not be read.');
 if(state?.connection!=='channel-selected'||!state.channel?.id)throw issue('INSIGHT_PROJECT_CHANNEL_REQUIRED','Connect and verify your channel before creating an insight draft.');
 if(state.channel.id!==request.channelId)throw issue('INSIGHT_PROJECT_CHANNEL_CHANGED','The connected channel changed. Refresh insights before continuing.');

 function replay(){
  const saved=db.prepare('SELECT * FROM insight_project_requests WHERE request_id=?').get(request.requestId);
  if(!saved)return null;
  if(saved.input_hash!==inputHash)throw issue('INSIGHT_PROJECT_REQUEST_CONFLICT','This request ID already belongs to a different insight. Use a new request for a different selection.');
  const row=db.prepare('SELECT * FROM projects WHERE id=?').get(saved.project_id),original=db.prepare('SELECT document FROM project_revisions WHERE project_id=? AND revision=1').get(saved.project_id);
  const originalSource=original?parse(original.document).insightSource:null;
  if(!row||!originalSource||hash(originalSource)!==saved.source_hash)throw issue('INSIGHT_PROJECT_EVIDENCE_INVALID','The original insight draft receipt is missing or changed. No replacement project was created.');
  // Replaying an admitted request returns the current edited document, even after newer snapshots arrive.
  return document(row);
 }
 function source(){
  if(state.snapshot?.id!==request.snapshotId||state.snapshot.channelId!==request.channelId)throw issue('INSIGHT_PROJECT_SOURCE_STALE','This recommendation is no longer from the current snapshot. Refresh insights.');
  const latest=db.prepare('SELECT id,channel_id,document FROM youtube_insights_snapshots WHERE channel_id=? ORDER BY fetched_at DESC,rowid DESC LIMIT 1').get(request.channelId);
  if(latest?.id!==request.snapshotId)throw issue('INSIGHT_PROJECT_SOURCE_STALE','A newer analytics snapshot is available. Select a current recommendation.');
  const snapshot=parse(latest.document);
  if(snapshot.id!==latest.id||snapshot.channelId!==latest.channel_id||snapshot.source!=='youtube-analytics-api'||!snapshot.reports||hash(snapshot.reports)!==snapshot.contentSha256||hash(snapshot)!==hash(state.snapshot))throw issue('INSIGHT_PROJECT_EVIDENCE_INVALID','The analytics snapshot does not match its saved content receipt.');
  let canonical;
  try{canonical=deriveYouTubeRecommendations(snapshot).find(rec=>rec.id===request.recommendationId);}catch{throw issue('INSIGHT_PROJECT_EVIDENCE_INVALID','The saved analytics report cannot produce a valid recommendation.');}
  const selected=Array.isArray(state.recommendations)?state.recommendations.find(rec=>rec.id===request.recommendationId):null;
  if(!canonical||!selected)throw issue('INSIGHT_PROJECT_SOURCE_STALE','That recommendation is not in the current snapshot.');
  if(hash(canonical)!==hash(selected)||canonical.channelId!==request.channelId||canonical.snapshotId!==request.snapshotId||typeof canonical.title!=='string'||!canonical.title.length||canonical.title.length>500||typeof canonical.brief!=='string'||!canonical.brief.length||canonical.brief.length>12000)throw issue('INSIGHT_PROJECT_EVIDENCE_INVALID','The recommendation differs from the one derived from saved metrics.');
  return {snapshot,canonical};
 }

 db.exec('BEGIN IMMEDIATE');
 try{
  const previous=replay();if(previous){db.exec('COMMIT');return previous;}
  const {snapshot,canonical}=source(),id=randomUUID(),createdAt=now();
  if(typeof createdAt!=='string'||!Number.isFinite(Date.parse(createdAt)))throw new TypeError('The draft clock must return an ISO timestamp.');
  const insightSource={snapshotId:snapshot.id,channelId:request.channelId,recommendationId:canonical.id,evidence:canonical.evidence,sourceMethod:'youtube-analytics-derived-hypothesis',snapshotContentSha256:snapshot.contentSha256,dateRange:canonical.dateRange,videoId:canonical.videoId,createdAt};
  const p={name:canonical.title,brief:canonical.brief,mode:'cinematic',sampleId:null,productTemplate:null,productCamera:null,productAssetId:null,durationSeconds:null,timeline:[],scene:{objects:[],lights:[],camera:{position:[0,0,3],target:[0,0,0]}},settings:{width:1080,height:1920,fps:24},assets:[],captionsEnabled:true,latestOutput:null,insightSource};
  const encoded=JSON.stringify(p);
  db.prepare('INSERT INTO projects(id,revision,document,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,1,encoded,createdAt,createdAt);
  db.prepare('INSERT INTO project_revisions(project_id,revision,document,created_at) VALUES(?,?,?,?)').run(id,1,encoded,createdAt);
  db.prepare('INSERT INTO insight_project_requests(request_id,input_hash,project_id,snapshot_id,channel_id,recommendation_id,source_hash,created_at) VALUES(?,?,?,?,?,?,?,?)').run(request.requestId,inputHash,id,request.snapshotId,request.channelId,request.recommendationId,hash(insightSource),createdAt);
  db.exec('COMMIT');
  return {...p,id,revision:1,createdAt,updatedAt:createdAt};
 }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
