import { promises as fs, createReadStream, constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec=promisify(execFile),fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const sha=async file=>{const digest=crypto.createHash('sha256');for await(const bytes of createReadStream(file))digest.update(bytes);return digest.digest('hex');};
const outputs={manifest:'creator-pack.json',draft:'publish-draft.md',thumbnail:'thumbnail.png'};
const localAbsolute=(value,label)=>{if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0')||/^[/\\]{2}/.test(value))fail('CREATOR_PACK_PATH',`${label} must be an absolute local path.`);return path.resolve(value);};
const within=(parent,child)=>{const relative=path.relative(parent,child);return Boolean(relative)&&!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative);};
function text(value,label,max,{required=false}={}){if(value===undefined||value===null){if(required)fail('CREATOR_PACK_PROJECT',`${label} is required.`);return '';}if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail('CREATOR_PACK_PROJECT',`${label} must be bounded plain text.`);const cleaned=value.replace(/\r\n?/g,'\n').trim();if(required&&!cleaned)fail('CREATOR_PACK_PROJECT',`${label} is required.`);return cleaned;}
function hashtags(title,brief,script){
 const stop=new Set('a an the and or but of to in on at for from by as is are was were be been being it its this that these those i me my we us our you your they them their with without into about than then there here have has had do does did can could should would will shall may might not no yes who what where when why how video film edit edited footage uploaded short make create project original only please'.split(' '));
 const scored=new Map();for(const [content,weight]of [[title,4],[brief,2],[script,1]])for(const word of content.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().match(/[a-z][a-z0-9]{2,23}/g)||[]){if(stop.has(word))continue;scored.set(word,(scored.get(word)||0)+weight);}
 const words=[...scored].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([word])=>word[0].toUpperCase()+word.slice(1));for(const word of ['CreatorVideo','VideoStory','LocalCreator','CreativeWork','IndependentVideo'])if(!words.some(item=>item.toLowerCase()===word.toLowerCase()))words.push(word);return words.slice(0,5).map(word=>`#${word}`);
}
function savedProvenance(project){
 const value=project.latestOutput?.provenance;if(!value||typeof value!=='object'||Array.isArray(value))return {generationStatus:'unknown',sourceMethod:'local-video',evidenceStatus:'no saved provenance supplied'};
 const allowed=['generationStatus','sourceMethod','providerId','modelId','workflowHash','outputHash','evidenceHash','seed','nativeAIGeneration','neuralVideoGenerated','mediaGenerationModelInvoked','fourKMethod'];const result={};for(const key of allowed)if(['string','number','boolean'].includes(typeof value[key]))result[key]=typeof value[key]==='string'?value[key].slice(0,2048):value[key];
 result.sources=Array.isArray(value.sources)?value.sources.slice(0,64).map(source=>({assetId:typeof source.assetId==='string'?source.assetId.slice(0,200):null,sha256:source.sha256||source.sourceHash||null})):[];
 result.evidenceStatus=value.outputHash?'saved output hash checked against actual video':'saved project declaration; no historical output hash supplied';return result;
}
function titleLines(title){const lines=[];let current='';for(const original of title.split(/\s+/)){const pieces=Array.from(original);while(pieces.length){const part=pieces.splice(0,38).join('');if(Array.from(current+(current?' ':'')+part).length>38){lines.push(current);current=part;}else current+=(current?' ':'')+part;}}if(current)lines.push(current);return lines.filter(Boolean).slice(0,5).join('\n');}
const indented=value=>String(value).split('\n').map(line=>`    ${line}`).join('\n');
function publishingMarkdown(pack){
 const lines=['# Creator publishing drafts','','DRAFT — not published. Review the copy and rights before sharing.','No trend research, virality prediction, cloud inference, or publishing was performed.','','## Saved title','',indented(pack.metadata.title),'','## Saved description','',indented(pack.metadata.description),'','## Saved script','',indented(pack.metadata.script||'(No script saved in this project.)'),'','## Suggested hashtags','',pack.metadata.hashtags.join(' '),'','## Campaign drafts'];
 for(const campaign of pack.campaigns)lines.push('',`### ${campaign.platform}`,'','Deterministic template draft; no upload or aspect-ratio conversion has occurred.','',indented(campaign.copy));
 lines.push('','## Actual source evidence','',`- Video SHA-256: ${pack.source.sha256}`,`- Duration: ${pack.source.durationSeconds} seconds`,`- Source: ${pack.source.width} × ${pack.source.height} at ${pack.source.fps} fps`,`- Thumbnail: extracted at ${pack.thumbnail.atSeconds} seconds; fit to 1280 × 720`,`- Thumbnail SHA-256: ${pack.thumbnail.sha256}`,'');return lines.join('\n');
}

/** Build drafts and an actual video-frame thumbnail. No network or publishing. */
export async function buildCreatorPack({project,videoPath,outputDir,ffmpeg,ffprobe,fontPath,titleOverlay=false}={}){
 if(!project||typeof project!=='object'||Array.isArray(project))fail('CREATOR_PACK_PROJECT','A saved project is required.');
 const title=text(project.title??project.name,'Project title',140,{required:true}).replace(/\n/g,' '),description=text(project.description,'Publishing description',6000)||text(project.brief,'Project brief',6000,{required:true}),script=text(project.script,'Saved script',50000);
 if(typeof titleOverlay!=='boolean')fail('CREATOR_PACK_REQUEST','titleOverlay must be a boolean.');
 const sourcePath=localAbsolute(videoPath,'Video'),destination=localAbsolute(outputDir,'Creator pack folder');localAbsolute(ffmpeg,'FFmpeg');localAbsolute(ffprobe,'FFprobe');
 let actual;try{actual=await fs.realpath(sourcePath);if(!(await fs.stat(actual)).isFile())throw new Error('not a file');}catch{fail('CREATOR_PACK_VIDEO_MISSING','The selected exported video is missing.');}
 const run=(bin,args,options={})=>exec(bin,args,{windowsHide:true,timeout:120000,maxBuffer:4*1024**2,...options});
 let probe;try{probe=JSON.parse((await run(ffprobe,['-v','error','-print_format','json','-show_streams','-show_format',actual])).stdout);}catch{fail('CREATOR_PACK_VIDEO_INVALID','FFprobe could not read the exported video.');}
 const stream=probe.streams?.find(item=>item.codec_type==='video'),durationSeconds=Number(probe.format?.duration||stream?.duration||0);if(!stream||!Number.isFinite(durationSeconds)||durationSeconds<=0||!Number.isInteger(stream.width)||stream.width<=0||!Number.isInteger(stream.height)||stream.height<=0)fail('CREATOR_PACK_VIDEO_INVALID','The export needs a video stream with a positive duration and resolution.');
 const sourceHash=await sha(actual),declaredHash=project.latestOutput?.provenance?.outputHash;if(declaredHash!==undefined&&(!/^[a-f0-9]{64}$/.test(declaredHash)||declaredHash!==sourceHash))fail('CREATOR_PACK_SOURCE_MISMATCH','The exported video does not match the saved project output hash.');
 let actualFont=null;if(titleOverlay){if(!fontPath)fail('CREATOR_PACK_FONT_REQUIRED','A local font file is required for the optional title overlay.');try{actualFont=await fs.realpath(localAbsolute(fontPath,'Font'));if(!(await fs.stat(actualFont)).isFile()||!['.ttf','.otf'].includes(path.extname(actualFont).toLowerCase()))throw new Error('font');}catch{fail('CREATOR_PACK_FONT_REQUIRED','The optional title overlay needs an existing local TTF or OTF font.');}}
 await fs.mkdir(destination,{recursive:true});const realDestination=await fs.realpath(destination);if(within(realDestination,actual))fail('CREATOR_PACK_OUTPUT_OVERLAP','Choose a separate creator-pack folder outside the source media.');
 const lockPath=path.join(realDestination,'.creator-pack.lock');let lock;try{lock=await fs.open(lockPath,'wx');}catch(error){if(error.code==='EEXIST')fail('CREATOR_PACK_BUSY','A creator pack is already being prepared in this folder.');throw error;}
 const staging=path.join(realDestination,`.creator-pack-${crypto.randomUUID()}`),written=[];let complete=false;
 try{
  for(const name of Object.values(outputs))if(await fs.stat(path.join(realDestination,name)).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))fail('CREATOR_PACK_EXISTS','This folder already contains a creator pack. Use a new folder to preserve it.');
  await fs.mkdir(staging,{recursive:false});const [numerator,denominator]=String(stream.avg_frame_rate||'0/1').split('/').map(Number),fps=Number.isFinite(numerator/denominator)?numerator/denominator:0;
  const atSeconds=Number((durationSeconds/2).toFixed(6));let filter='scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1';
  if(titleOverlay){const wrapped=titleLines(title),lineCount=wrapped.split('\n').length,panelHeight=lineCount*40+56;await fs.copyFile(actualFont,path.join(staging,'overlay-font.ttf'),constants.COPYFILE_EXCL);await fs.writeFile(path.join(staging,'thumbnail-title.txt'),wrapped,{flag:'wx'});filter+=`,drawbox=x=0:y=ih-${panelHeight}:w=iw:h=${panelHeight}:color=black@0.72:t=fill,drawtext=fontfile=overlay-font.ttf:textfile=thumbnail-title.txt:expansion=none:fontcolor=white:fontsize=32:line_spacing=8:x=52:y=h-${panelHeight-24}:shadowcolor=black@0.8:shadowx=1:shadowy=2`;}
  const thumbnailFile=path.join(staging,outputs.thumbnail);try{await run(ffmpeg,['-v','error','-ss',String(atSeconds),'-i',actual,'-map','0:v:0','-frames:v','1','-vf',filter,'-threads','1','thumbnail.png'],{cwd:staging});await run(ffmpeg,['-v','error','-xerror','-i',thumbnailFile,'-f','null','-']);}catch(error){fail('CREATOR_PACK_THUMBNAIL_FAILED',`The local thumbnail could not be extracted: ${String(error.stderr||error.message).slice(-1200)}`);}
  const imageProbe=JSON.parse((await run(ffprobe,['-v','error','-show_entries','stream=width,height','-of','json',thumbnailFile])).stdout);if(imageProbe.streams?.[0]?.width!==1280||imageProbe.streams?.[0]?.height!==720)fail('CREATOR_PACK_THUMBNAIL_INVALID','The extracted thumbnail is not 1280 × 720.');
  if(await sha(actual)!==sourceHash)fail('CREATOR_PACK_SOURCE_CHANGED','The source video changed while its thumbnail was being prepared.');
  const metadata={title,description,script,hashtags:hashtags(title,description,script)},shortDescription=description.length>240?`${description.slice(0,237).trimEnd()}…`:description;
  const campaign=(platform,copy)=>({platform,status:'draft',method:'deterministic-template',basis:'saved project title, publishing description or brief, and script',copy,requiresReview:true,published:false,videoTransformPerformed:false});
  const campaigns=[campaign('YouTube',`${title}\n\n${description}\n\n${metadata.hashtags.join(' ')}`),campaign('Instagram Reel',`${title}\n\n${shortDescription}\n\n${metadata.hashtags.join(' ')}`),campaign('LinkedIn',`${title}\n\n${description}\n\nWhich moment stood out to you?\n\n${metadata.hashtags.slice(0,3).join(' ')}`)];
  const pack={schemaVersion:1,kind:'creator-pack',status:'draft',createdAt:new Date().toISOString(),project:{id:typeof project.id==='string'?project.id:null,revision:Number.isSafeInteger(project.revision)?project.revision:null},outputs:{...outputs},source:{sha256:sourceHash,durationSeconds,width:stream.width,height:stream.height,fps,provenance:savedProvenance(project)},thumbnail:{width:1280,height:720,atSeconds,method:'extracted-video-frame',fit:'contain',titleOverlay,sha256:await sha(thumbnailFile),sourceHash},metadata,campaigns,disclosure:{metadataMethod:'saved-project-text',campaignMethod:'deterministic-template',trendResearchPerformed:false,modelInvoked:false,published:false,note:'Review all drafts and media rights. No AI image generation, trend research, platform validation, or publishing was performed.'}};
  await fs.writeFile(path.join(staging,outputs.manifest),JSON.stringify(pack,null,2),{flag:'wx'});await fs.writeFile(path.join(staging,outputs.draft),publishingMarkdown(pack),{flag:'wx'});
  for(const name of Object.values(outputs)){const finalPath=path.join(realDestination,name);await fs.copyFile(path.join(staging,name),finalPath,constants.COPYFILE_EXCL);written.push(finalPath);}complete=true;return pack;
 }finally{
  if(!complete)for(const file of written)if(within(realDestination,file))await fs.unlink(file).catch(()=>{});
  if(within(realDestination,staging)&&path.basename(staging).startsWith('.creator-pack-'))await fs.rm(staging,{recursive:true,force:true}).catch(()=>{});await lock.close().catch(()=>{});await fs.unlink(lockPath).catch(()=>{});
 }
}
