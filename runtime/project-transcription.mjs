import {createHash} from 'node:crypto';
import {mapSourceCaptionsToTimeline} from './source-captions.mjs';

/** Prepare a worker result for the current, revision-checked project. */
export function projectTranscriptionUpdate({project,sourceAssetId,jobId,segments,provenance}) {
 const mapped=mapSourceCaptionsToTimeline({segments,timeline:project.timeline||[],sourceAssetId,fps:project.settings?.fps||24});
 if(!mapped.appearsInTimeline){
  const tracks=project.audioTracks||[];
  if(!Array.isArray(tracks))throw Object.assign(Error('The saved audio layers are invalid. Repair their placement before applying captions.'),{code:'TRANSCRIPT_AUDIO_PLACEMENT_INVALID'});
  const placements=[...(project.soundtrack?[project.soundtrack]:[]),...tracks].filter(track=>track?.assetId===sourceAssetId);
  for(const placement of placements){
   const start=Number(placement.start??0),trim=Number(placement.trimStart??0);
   if(!Number.isFinite(start)||!Number.isFinite(trim)||start<0||trim<0)throw Object.assign(Error('The selected audio has an invalid start or source trim. Correct its placement before applying captions.'),{code:'TRANSCRIPT_AUDIO_PLACEMENT_INVALID'});
   if(start!==0||trim!==0)throw Object.assign(Error(`The selected audio starts at ${start}s and trims ${trim}s from its source. Caption placement for shifted audio is not supported yet. The source transcript is retained; transcribe the assembled export or set this audio's start and trim to zero before retrying.`),{code:'TRANSCRIPT_AUDIO_OFFSET_UNSUPPORTED'});
  }
 }
 // A soundtrack or standalone narration is not a visual clip. Preserve its
 // existing zero-offset source timing; never invent a displaced placement.
 const transcript=mapped.appearsInTimeline?mapped.segments:structuredClone(segments);
 return {
  transcript,
  transcriptSource:{assetId:sourceAssetId,jobId,provenance,
   coordinateSpace:mapped.appearsInTimeline?'timeline':'source',
   ...(mapped.appearsInTimeline?{mapping:{version:1,method:'source-trims-to-sequential-edit',clipIds:mapped.matchedClipIds,durationSeconds:mapped.durationSeconds}}:{}),
   sourceSegmentsHash:createHash('sha256').update(JSON.stringify(segments)).digest('hex')},
  captionsEnabled:transcript.length>0
 };
}
