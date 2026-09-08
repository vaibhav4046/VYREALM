export type BriefFamily = 'cinematic'|'anime'|'music'|'shorts'|'longform'|'tutorial';
export type BriefRenderer = 'timeline'|'format';
export interface CreatorBriefInput {
 prompt:string; title?:string; family?:BriefFamily; durationSeconds?:number; fps?:24|25|30|60;
 aspect?:'16:9'|'9:16'|'1:1'; renderer?:BriefRenderer; captionStyle?:string;
 sourceMode?:'uploaded-media'|'local-generation'|'mixed'; narrationText?:string;
 shotDescriptions?:string[]; continuityNotes?:string; constraints?:string[];
}
export interface CaptionOption {id:string;label:string;renderer:BriefRenderer;timing:string;limitation?:string}
export interface CreatorBrief {
 schemaVersion:1;kind:'creator-brief';method:'deterministic-offline-adapter';modelInvoked:false;mediaGenerated:false;editable:true;status:'draft'|'needs-changes';inputHash:string;prompt:string;title:string;family:BriefFamily;workflowId:string;
 recipeReference:{id:string;use:string}; format:{aspect:string;durationSeconds:number;requestedDurationSeconds:number;fps:number;canvas:{width:number;height:number};resolutionMeaning:string};
 hook:{text:string;basis:string;instruction:string};
 shots:Array<{id:string;startFrame:number;durationFrames:number;startSeconds:number;durationSeconds:number;role:string;description:string;camera:string;cameraStatus:string;assetId:null;mediaStatus:string;continuity:string}>;
 beats:Array<{shotId:string;startSeconds:number;durationSeconds:number;role:string}>;
 audio:{narration:{mode:'piper'|'none';text:string;timing:string;generated:false};music:{requested:boolean;status:string;generated:false};ambience:{requested:boolean;method:string;generated:false}};
 subtitles:{requested:string;selected:string|null;enabled:boolean|null;renderer:BriefRenderer;options:CaptionOption[];timing:string|null;cues:never[];limitation?:string};
 style:{gradeId:string;gradeLabel:string;generationStyle:string}; constraints:string[];feedback:Array<{code:string;message:string;severity:'review'|'blocked'}>;
 integration:{sourceMode:string;workflowEndpoint:string;workflowEndpointPurpose:string;requiresSavedProject:true;requiresReview:true;renderer:BriefRenderer;autoSubmit:false};
}
export function buildCreatorBrief(input:CreatorBriefInput):CreatorBrief;
export function creatorCaptionOptions(renderer?:BriefRenderer):CaptionOption[];
export function creatorBriefWorkflowInput(brief:CreatorBrief, context:{projectId:string;expectedRevision:number;assetIds?:string[];allowRoleResegmentation?:boolean}):{projectId:string;expectedRevision:number;workflowId:string;brief:string;durationSeconds:number;sourceMode:string;assetIds:string[];captionsEnabled:boolean;narrationMode:string;researchNotes:string;scriptText:string;characterContinuity:string};
