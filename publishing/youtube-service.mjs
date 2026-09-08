import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createYouTubeClient } from './youtube-client.mjs';
import { createYouTubeVault } from './youtube-vault.mjs';
import { bootstrapPublisherDesktopConfig } from './youtube-desktop-config.mjs';
import { youtubeError, YouTubeError } from './youtube-errors.mjs';

const CLIENT_ID = /^[A-Za-z0-9_-]{3,200}\.apps\.googleusercontent\.com$/;
const ID = /^[a-zA-Z0-9_-]{1,200}$/;
const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
function only(input, fields) { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) throw youtubeError('YOUTUBE_INVALID_REQUEST', 'The request contains unsupported fields.'); }
const jobDocument = row => row ? { id: row.id, projectId: row.project_id, revision: row.revision, type: row.type, status: row.status, progress: row.progress, stage: row.stage, output: parse(row.output), error: row.error, attempts: row.attempts, createdAt: row.created_at, updatedAt: row.updated_at } : null;

/** One per-user optional online service; projects and durable jobs stay in the existing SQLite store. */
export async function createYouTubeService({ dataDir, mediaDir, db, publisherConfigPath, clientFactory = createYouTubeClient, vaultFactory = createYouTubeVault } = {}) {
  const directory = path.join(dataDir, 'integrations');
  const configurationPath = path.join(directory, 'youtube-client.json');
  const vault = vaultFactory({ filePath: path.join(directory, 'youtube-credentials.protected.json') });
  let clientId = ''; let configurationError = null; let registrationSource = null; let configurationMissing = false;
  try { const file = await fs.lstat(configurationPath); if (!file.isFile() || file.isSymbolicLink() || file.size > 10000) throw new Error(); const cfg = parse(await fs.readFile(configurationPath, 'utf8')); if (!CLIENT_ID.test(cfg.clientId || '')) throw new Error(); clientId = cfg.clientId; registrationSource = cfg.registrationSource === 'bundled' ? 'bundled' : 'developer'; }
  catch (error) { if (error.code === 'ENOENT') configurationMissing = true; else configurationError = 'Stored YouTube Desktop client configuration is invalid. Import valid Desktop credentials to repair it.'; }
  if (configurationMissing && publisherConfigPath) {
    try { const initialized = await bootstrapPublisherDesktopConfig({publisherConfigPath,configurationPath,vault,clientFactory}); if(initialized.applied){clientId=initialized.clientId;registrationSource='bundled';}else configurationError='The local sign-in configuration changed during setup. Restart the application to load it.'; }
    catch(error){configurationError=error instanceof YouTubeError?error.message:'Desktop sign-in setup could not finish. Existing protected data was retained; repair the application or use advanced Desktop configuration.';}
  }
  let client = clientFactory({ clientId, vault }); let authorization = null; let auth = { phase: 'idle' }; let active = null; let shuttingDown = false; let channelWrites = Promise.resolve();let verifying=false,admitting=false;let channelVerification=null;
  const queued = new Set(); const now = () => new Date().toISOString();
  const currentJob = id => db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  const updateJob = (id, status, stage, output, error = null) => db.prepare('UPDATE jobs SET status=?,stage=?,progress=?,output=?,error=?,updated_at=? WHERE id=?').run(status, stage, output?.bytesTotal ? Math.min(1, output.bytesUploaded / output.bytesTotal) : status === 'succeeded' ? 1 : 0, JSON.stringify(output || {}), error, now(), id);
  async function publicStatus() {
    const status = await client.status(); let connectedChannel = null;
    if (status.connected) { try { connectedChannel = (await vault.read()).connectedChannel || null; } catch {} }
    return { ...status, ...(configurationError ? { code: 'YOUTUBE_CONFIGURATION_INVALID', diagnostic: configurationError } : {}), profile: 'local-user', clientId: clientId || null, registrationSource, connectedChannel, channelVerification:status.connected?channelVerification:null, auth: { ...auth }, uploadJob: active?.id || null, credentialsBundled: registrationSource === 'bundled' };
  }
  async function saveChannel(channel) {const operation=channelWrites.then(async()=>{if(client.saveConnectedChannel)return client.saveConnectedChannel(channel);const stored=await vault.read();if(channel)stored.connectedChannel=channel;else delete stored.connectedChannel;await vault.write(stored);});channelWrites=operation.catch(()=>{});return operation;}
  async function verifyConnection(){
    if(verifying||authorization||active||admitting)throw youtubeError('YOUTUBE_BUSY','Finish the active YouTube operation before verifying the channel.');
    verifying=true;
    try{const channels=await client.channels();if(channels.length!==1)throw youtubeError('YOUTUBE_CHANNEL_SELECTION_REQUIRED','Select one channel account in Google sign-in.');const checkedAt=now();await saveChannel({...channels[0],verifiedAt:checkedAt});channelVerification={status:'verified',checkedAt,channelId:channels[0].id};return await publicStatus();}
    catch(error){channelVerification={status:'failed',checkedAt:now(),code:error.code||'YOUTUBE_CHANNEL_LOOKUP_FAILED'};throw error;}
    finally{verifying=false;}
  }
  async function configure(credentials) {
    only(credentials, ['installed']); const installed = credentials.installed;
    if (!installed || !CLIENT_ID.test(installed.client_id || '')) throw youtubeError('YOUTUBE_DESKTOP_CREDENTIALS_REQUIRED', 'Import a Google Desktop app credential JSON.');
    if ((await client.status()).connected || authorization || active) throw youtubeError('YOUTUBE_DISCONNECT_REQUIRED', 'Disconnect the current account and finish uploads before replacing Desktop client configuration.');
    const next = clientFactory({ clientId: installed.client_id, vault }); const result = await next.configureDesktopCredentials({ installed });
    await fs.mkdir(directory, { recursive: true }); const temp = `${configurationPath}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(temp, JSON.stringify({ schemaVersion: 1, clientId: installed.client_id, type: 'desktop', registrationSource:'developer' }), { flag: 'wx', mode: 0o600 }); await fs.rename(temp, configurationPath); }
    finally { await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    clientId = installed.client_id; client = next; registrationSource='developer'; configurationError = null; return { ...result, profile: 'local-user', registrationSource };
  }
  async function authorize(input) {
    only(input, ['features']); if ((await client.status()).connected || authorization || active||verifying||admitting) throw youtubeError('YOUTUBE_DISCONNECT_REQUIRED', 'Disconnect the current account before selecting another account.');
    const flow = await client.beginAuthorization({ features: input.features || ['upload', 'analytics'] }); authorization = flow; auth = { phase: 'pending', expiresAt: flow.expiresAt };
    void flow.completion.then(async result => {
      if (authorization !== flow) return;
      auth = { phase: result.connected ? 'pending' : result.code === 'YOUTUBE_AUTH_CANCELLED' ? 'cancelled' : 'failed', code: result.connected ? 'YOUTUBE_VERIFYING_CHANNEL' : result.code };
      if (result.connected) {
        try { const channels = await client.channels(); if (authorization !== flow) return; if (channels.length !== 1) throw youtubeError('YOUTUBE_CHANNEL_SELECTION_REQUIRED', 'Connect the specific channel account in Google consent. A single channel must be selected.');const checkedAt=now(); await saveChannel({...channels[0],verifiedAt:checkedAt});if(authorization===flow){auth={phase:'connected',code:result.code};channelVerification={status:'verified',checkedAt,channelId:channels[0].id};} }
        catch (error) { auth = { phase: 'connected', code: error.code || 'YOUTUBE_CHANNEL_LOOKUP_FAILED', diagnostic: 'Account authorization is stored, but its channel could not be verified. Reconnect with channel read permission or check the enabled YouTube API.' }; }
      }
    }).catch(() => { auth = { phase: 'failed', code: 'YOUTUBE_AUTH_FAILED' }; }).finally(() => { if (authorization === flow) authorization = null; });
    return { authorizationUrl: flow.authorizationUrl, expiresAt: flow.expiresAt, scopes: flow.scopes, auth: { ...auth } };
  }
  async function ownedOutput(input, current = true) {
    const row = ID.test(input.projectId || '') && db.prepare('SELECT * FROM projects WHERE id=?').get(input.projectId);
    if (!row) throw youtubeError('YOUTUBE_PROJECT_NOT_FOUND', 'The selected project does not exist.');
    if (current && row.revision !== input.expectedRevision) throw youtubeError('YOUTUBE_REVISION_CONFLICT', 'The project changed. Review and confirm the current export before uploading.');
    const document = parse(row.document), latest = document.latestOutput;
    const assetId = current ? latest?.videoAssetId : input.sourceAssetId, sourceJobId = current ? latest?.jobId : input.sourceJobId;
    const asset = assetId && db.prepare('SELECT * FROM assets WHERE id=? AND project_id=?').get(assetId, row.id), source = sourceJobId && db.prepare('SELECT * FROM jobs WHERE id=? AND project_id=?').get(sourceJobId, row.id);
    const output = parse(source?.output), metadata = parse(asset?.document);
    if (!asset || !source || source.status !== 'succeeded' || metadata.mime !== 'video/mp4' || metadata.jobId !== source.id || output.assets?.video !== asset.id || output.review?.verdict !== 'passed' || output.review?.outputHash !== input.expectedOutputHash || output.provenance?.outputHash !== input.expectedOutputHash || (current && (latest?.status !== 'reviewed' || latest.provenance?.outputHash !== input.expectedOutputHash))) throw youtubeError('YOUTUBE_REVIEW_REQUIRED', 'Only the current owned video with a matching passed visual review can be uploaded.');
    const base = await fs.realpath(mediaDir), file = await fs.realpath(asset.path), relative = path.relative(base, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw youtubeError('YOUTUBE_ASSET_BOUNDARY', 'The approved video must remain inside this profile’s media folder.');
    const hash = crypto.createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest('hex') !== input.expectedOutputHash) throw youtubeError('YOUTUBE_FILE_CHANGED', 'The reviewed video changed. Review the exact current file before upload.');
    return { filePath: file, sourceAssetId: asset.id, sourceJobId: source.id, revision: row.revision };
  }
  async function enqueue(input) {
    only(input, ['projectId', 'expectedRevision', 'expectedOutputHash', 'expectedChannelId', 'confirmed', 'containsSyntheticMedia', 'metadata','requestId']);
    if (input.confirmed !== true || !Number.isSafeInteger(input.expectedRevision) || !/^[a-f0-9]{64}$/.test(input.expectedOutputHash || '') || !/^UC[A-Za-z0-9_-]{22}$/.test(input.expectedChannelId || '') || typeof input.containsSyntheticMedia !== 'boolean' || typeof input.metadata?.title !== 'string' || !input.metadata.title.trim()) throw youtubeError('YOUTUBE_INVALID_REQUEST', 'Confirm the exact reviewed film, revision, hash, channel, title and synthetic-media disclosure.');
    if(input.requestId!==undefined&&!/^[a-f0-9-]{36}$/.test(input.requestId))throw youtubeError('YOUTUBE_INVALID_REQUEST','Use the saved upload request identifier.');
    const prior=input.requestId&&currentJob(input.requestId);if(prior){const saved=parse(prior.input);if(prior.type!=='youtube-upload'||['projectId','expectedRevision','expectedOutputHash','expectedChannelId','containsSyntheticMedia'].some(key=>saved[key]!==input[key])||JSON.stringify(saved.metadata)!==JSON.stringify(input.metadata))throw youtubeError('YOUTUBE_REQUEST_CONFLICT','This request identifier belongs to another upload.');return jobDocument(prior);}
    if(active||authorization||verifying||admitting)throw youtubeError('YOUTUBE_UPLOAD_BUSY','Finish the current YouTube operation before starting another upload.');
    admitting=true;try{
    if (!(await client.status()).connected) throw youtubeError('YOUTUBE_NOT_CONNECTED', 'Connect your own YouTube channel before uploading.');
    const channels=await client.channels();if(channels.length!==1||channels[0].id!==input.expectedChannelId)throw youtubeError('YOUTUBE_CHANNEL_MISMATCH','The connected Google channel differs from the channel you confirmed. Refresh and select your own channel.');
    const owned = await ownedOutput(input); const id = input.requestId||crypto.randomUUID(), time = now();
    const existing = db.prepare("SELECT * FROM jobs WHERE project_id=? AND type='youtube-upload' AND status IN ('queued','running','cancelling')").get(input.projectId);
    if (existing) throw youtubeError('YOUTUBE_UPLOAD_BUSY', 'This project already has an active YouTube upload.');
    db.prepare('INSERT INTO jobs(id,project_id,revision,type,status,progress,stage,input,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,input.projectId,input.expectedRevision,'youtube-upload','queued',0,'queued for confirmed private upload',JSON.stringify({...input,sourceAssetId:owned.sourceAssetId,sourceJobId:owned.sourceJobId}),time,time);
    return jobDocument(currentJob(id));
    }finally{admitting=false;}
  }
  async function runJob(id) {
    const row = currentJob(id); if (!row || row.type !== 'youtube-upload' || row.status !== 'queued' || shuttingDown) return;
    if (active) { queued.add(id); return; }
    const controller = new AbortController(); active = { id, controller }; const input = parse(row.input); let progress = parse(row.output);
    db.prepare("UPDATE jobs SET status='running',stage='checking approved film and account',attempts=attempts+1,error=NULL,updated_at=? WHERE id=?").run(now(), id);
    try {
      const file = await ownedOutput(input, !progress.id);
      if (!progress.id) { progress = await client.beginPrivateUpload({ filePath: file.filePath, sha256: input.expectedOutputHash, expectedChannelId: input.expectedChannelId, confirmed: true, containsSyntheticMedia: input.containsSyntheticMedia, metadata: input.metadata, signal: controller.signal }); updateJob(id,'running','private upload session created',progress); }
      for (let pass = 0; pass < 128 && progress.state !== 'uploaded_private'; pass++) {
        progress = await client.resumeUpload(progress.id,{signal:controller.signal,maxChunks:32,onProgress:receipt=>{progress=receipt;updateJob(id,'running','uploading privately to YouTube',receipt);}});
        updateJob(id,'running','private upload in progress',progress);
      }
      if (progress.state !== 'uploaded_private') throw youtubeError('YOUTUBE_UPLOAD_PASS_LIMIT', 'This bounded upload run reached its transfer limit. Resume the retained session explicitly.');
      updateJob(id,'succeeded','uploaded privately; YouTube processing not yet verified',{...progress,processingVerified:false});
    } catch (error) { updateJob(id,controller.signal.aborted?'cancelled':'failed',controller.signal.aborted?'private upload paused; resume available':'private upload stopped',progress,error instanceof YouTubeError?`${error.code}: ${error.message}`:'YOUTUBE_UPLOAD_FAILED: The upload stopped. Its retained session can be inspected and resumed.'); }
    finally { active = null; const next = queued.values().next().value; if (next) { queued.delete(next); queueMicrotask(()=>void runJob(next)); } }
  }
  async function cancel(id) {
    const row=currentJob(id);if(!row||row.type!=='youtube-upload')throw youtubeError('YOUTUBE_UPLOAD_NOT_FOUND','Upload job not found.');
    queued.delete(id);if(active?.id===id){active.controller.abort();db.prepare("UPDATE jobs SET status='cancelling',stage='pausing private upload',updated_at=? WHERE id=?").run(now(),id);}else if(row.status==='queued')updateJob(id,'cancelled','private upload cancelled before transfer',parse(row.output));
    return jobDocument(currentJob(id));
  }
  async function retry(id) {const row=currentJob(id);if(!row||row.type!=='youtube-upload')throw youtubeError('YOUTUBE_UPLOAD_NOT_FOUND','Upload job not found.');if(!['failed','cancelled'].includes(row.status))throw youtubeError('YOUTUBE_UPLOAD_BUSY','Only failed or paused uploads can be resumed.');db.prepare("UPDATE jobs SET status='queued',error=NULL,stage='private upload resume queued',updated_at=? WHERE id=?").run(now(),id);void runJob(id);return jobDocument(currentJob(id));}
  async function verifyUpload(id){
    const row=currentJob(id),output=parse(row?.output);if(row?.type!=='youtube-upload'||row.status!=='succeeded'||!output.id)throw youtubeError('YOUTUBE_UPLOAD_NOT_FOUND','Choose a completed private upload to check its processing.');
    let verified;try{verified=await client.verifyUploadedVideo(output.id);if(verified.channelId!==output.channelId||verified.videoId!==output.videoId||verified.sha256!==output.sha256)throw youtubeError('YOUTUBE_UPLOAD_RECEIPT_MISMATCH','The processing receipt does not match the retained upload.');}
    catch(error){updateJob(id,'succeeded','Transfer completed; current privacy and processing are unverified',{...output,privacyStatus:'unverified',processingVerified:false,processing:{status:'unverified',checkedAt:now(),code:error.code||'YOUTUBE_VERIFICATION_FAILED'}});throw error;}
    updateJob(id,'succeeded',verified.processingVerified?'private video processed by YouTube':verified.processing?.status==='failed'?'private transfer completed; YouTube processing failed':'private transfer completed; YouTube processing pending',verified);return jobDocument(currentJob(id));
  }
  async function attachThumbnail(id,input){
    only(input,['thumbnailJobId','expectedThumbnailHash','confirmed']);
    if(input.confirmed!==true||!ID.test(input.thumbnailJobId||'')||!/^[a-f0-9]{64}$/.test(input.expectedThumbnailHash||''))throw youtubeError('YOUTUBE_INVALID_REQUEST','Review the exact thumbnail and confirm it before uploading.');
    if(active||verifying||admitting||authorization)throw youtubeError('YOUTUBE_BUSY','Finish the active YouTube action before attaching a thumbnail.');
    const row=currentJob(id),output=parse(row?.output),job=currentJob(input.thumbnailJobId),thumbnail=parse(job?.output);
    if(row?.type!=='youtube-upload'||row.status!=='succeeded'||output.state!=='uploaded_private'||!output.id)throw youtubeError('YOUTUBE_UPLOAD_NOT_FOUND','Choose a completed private video upload.');
    if(job?.type!=='thumbnail'||job.status!=='succeeded'||job.project_id!==row.project_id||thumbnail.sourceHash!==output.sha256||thumbnail.artifacts?.upload?.sha256!==input.expectedThumbnailHash)throw youtubeError('YOUTUBE_THUMBNAIL_MISMATCH','This thumbnail is not bound to that project and uploaded video.');
    const asset=db.prepare('SELECT * FROM assets WHERE id=? AND project_id=?').get(thumbnail.assets?.upload||'',row.project_id),metadata=parse(asset?.document);
    if(!asset||metadata.jobId!==job.id||metadata.mime!=='image/jpeg'||metadata.provenance?.outputHash!==input.expectedThumbnailHash)throw youtubeError('YOUTUBE_THUMBNAIL_MISMATCH','The owned thumbnail asset does not match its production receipt.');
    const folder=await fs.realpath(path.join(dataDir,'jobs',job.id)),file=await fs.realpath(asset.path),relative=path.relative(folder,file);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw youtubeError('YOUTUBE_ASSET_BOUNDARY','The thumbnail must remain inside its recorded production job.');
    verifying=true;
    try{
      const result=await client.setThumbnail(output.id,{thumbnail,filePath:file});
      if(result.videoId!==output.videoId||result.sha256!==output.sha256||result.channelId!==output.channelId||result.thumbnail?.status!=='uploaded'||result.thumbnail.thumbnailHash!==input.expectedThumbnailHash)throw youtubeError('YOUTUBE_UPLOAD_RECEIPT_MISMATCH','YouTube thumbnail confirmation did not match the selected video.');
      updateJob(id,'succeeded','private video thumbnail accepted by YouTube',{...result,thumbnail:{...result.thumbnail,jobId:job.id,assetId:asset.id}});return jobDocument(currentJob(id));
    }catch(error){updateJob(id,'succeeded','Video retained; thumbnail needs attention',{...output,thumbnail:{status:'failed',jobId:job.id,thumbnailHash:input.expectedThumbnailHash,checkedAt:now(),code:error.code||'YOUTUBE_THUMBNAIL_FAILED'}});throw error;}
    finally{verifying=false;}
  }
  async function handle({pathname,method,body={},searchParams=new URLSearchParams()}) {
    try {
      if(pathname==='/api/youtube/status'&&method==='GET')return {status:200,body:await publicStatus()};
      if(pathname==='/api/youtube/verify'&&method==='POST'){only(body,[]);return {status:200,body:await verifyConnection()};}
      if(pathname==='/api/youtube/config'&&method==='POST')return {status:200,body:await configure(body)};
      if(pathname==='/api/youtube/authorize'&&method==='POST')return {status:202,body:await authorize(body)};
      if(pathname==='/api/youtube/disconnect'&&method==='POST'){only(body,['expectedChannelId']);if(active||verifying||admitting)throw youtubeError('YOUTUBE_UPLOAD_BUSY','Finish the active YouTube operation before disconnecting.');if(body.expectedChannelId!==undefined&&(await vault.read()).connectedChannel?.id!==body.expectedChannelId)throw youtubeError('YOUTUBE_CHANNEL_MISMATCH','The connected channel changed. Refresh before disconnecting.');const flow=authorization;authorization=null;flow?.cancel();await channelWrites;await client.disconnect();await saveChannel(null);auth={phase:'idle'};channelVerification=null;return {status:200,body:await publicStatus()};}
      if(pathname==='/api/youtube/analytics'&&method==='GET'){const query=Object.fromEntries(searchParams);only(query,['startDate','endDate','videoId']);return {status:200,body:await client.analytics(query)};}
      if(pathname==='/api/youtube/uploads'&&method==='GET')return {status:200,body:{uploads:await client.listUploads()}};
      if(pathname==='/api/youtube/upload'&&method==='POST')return {status:202,body:await enqueue(body)};
      const processing=pathname.match(/^\/api\/youtube\/uploads\/([a-zA-Z0-9_-]{1,200})\/verify$/);if(processing&&method==='POST'){only(body,[]);return {status:200,body:await verifyUpload(processing[1])};}
      const thumbnail=pathname.match(/^\/api\/youtube\/uploads\/([a-zA-Z0-9_-]{1,200})\/thumbnail$/);if(thumbnail&&method==='POST')return {status:200,body:await attachThumbnail(thumbnail[1],body)};
      return {status:404,body:{error:'Unknown YouTube route',code:'YOUTUBE_ROUTE_NOT_FOUND'}};
    }catch(error){const code=error instanceof YouTubeError?error.code:'YOUTUBE_LOCAL_SERVICE_FAILED';const invalid=/INVALID|CREDENTIALS_REQUIRED|CLIENT_MISMATCH|PRIVATE_ONLY/.test(code),missing=/NOT_FOUND/.test(code);return {status:missing?404:invalid?400:error instanceof YouTubeError?409:500,body:{code,error:error instanceof YouTubeError?error.message:'The local YouTube service could not complete this operation. Credentials were not logged.'}};}
  }
  return {handle,runJob,cancel,retry,readConnection:publicStatus,fetchDailyAnalytics:input=>client.analytics(input),fetchVideoAnalytics:input=>client.videoAnalytics(input),async close(){shuttingDown=true;const flow=authorization;authorization=null;flow?.cancel();active?.controller.abort();await channelWrites;vault.close?.();}};
}
