const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = value => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const seconds = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const stamp = value => `${String(Math.floor(Math.max(0, value) / 60)).padStart(2, '0')}:${(Math.max(0, value) % 60).toFixed(2).padStart(5, '0')}`;

export function timelineSegments(clips = []) {
  let cursor = 0;
  return clips.map((clip, index) => { const start = cursor; cursor += Math.max(0, seconds(clip.duration)); return { clip, index, start, end: cursor, duration: cursor - start }; });
}
export function locateTimelineTime(clips, time) {
  const segments = timelineSegments(clips), total = segments.at(-1)?.end || 0;
  if (!segments.length) return null;
  const position = clamp(seconds(time), 0, total), segment = segments.find(item => position < item.end) || segments.at(-1);
  return { ...segment, position, localTime: position - segment.start, sourceTime: seconds(segment.clip.trimStart) + position - segment.start, total };
}
export function validateClipEdit(clip, patch, sourceDuration = null, fps = 24) {
  const next = { ...clip, ...patch }, duration = Number(next.duration), trimStart = Number(next.trimStart || 0);
  if (!Number.isFinite(duration) || duration < 1 / fps || duration > 3600 || !Number.isFinite(trimStart) || trimStart < 0 || trimStart > 3600) throw Error('Choose a positive clip duration of at least one frame and a valid source start.');
  if (clip.kind !== 'image' && Number.isFinite(sourceDuration) && trimStart + duration > sourceDuration + 0.002) throw Error(`This source ends at ${sourceDuration.toFixed(2)} seconds. Shorten the clip or move its source start earlier.`);
  if (typeof next.caption !== 'string' && next.caption != null || String(next.caption || '').length > 1000) throw Error('Keep the clip caption within 1000 characters.');
  return { ...next, duration, trimStart };
}
export function splitTimelineClip(clips, clipId, position, newId, fps = 24) {
  const segment = timelineSegments(clips).find(item => item.clip.id === clipId);
  if (!segment || !newId || clips.some(item => item.id === newId)) throw Error('Select a timeline clip to split.');
  const local = Math.round((position - segment.start) * fps) / fps;
  if (local < 1 / fps || segment.duration - local < 1 / fps - 0.00001) throw Error('Move the playhead inside the selected clip, at least one frame from either edge.');
  const first = { ...segment.clip, duration: local }, second = { ...segment.clip, id: newId, duration: segment.duration - local, trimStart: seconds(segment.clip.trimStart) + local };
  return [...clips.slice(0, segment.index), first, second, ...clips.slice(segment.index + 1)];
}
export function moveTimelineClip(clips, clipId, direction) {
  const index = clips.findIndex(item => item.id === clipId), target = index + direction;
  if (![1, -1].includes(direction) || index < 0 || target < 0 || target >= clips.length) return clips.slice();
  const result = clips.slice(); [result[index], result[target]] = [result[target], result[index]]; return result;
}
/** Timed captions follow their original clip/source range through trims, splits and reorders. */
export function remapTimelineCaptions(before, after, cues, origins = {}) {
  const old = timelineSegments(before), output = [];
  for (const next of timelineSegments(after)) {
    const previous = old.find(item => item.clip.id === (origins[next.clip.id] || next.clip.id));
    if (!previous) continue;
    const sourceShift = seconds(next.clip.trimStart) - seconds(previous.clip.trimStart);
    for (const cue of cues || []) {
      const start = Math.max(seconds(cue.start), previous.start, previous.start + sourceShift);
      const end = Math.min(seconds(cue.end), previous.end, previous.start + sourceShift + next.duration);
      if (end > start + 0.001) output.push({ ...cue, start: next.start + start - previous.start - sourceShift, end: next.start + end - previous.start - sourceShift });
    }
  }
  return output.sort((a, b) => a.start - b.start);
}

/** Source-preview editor. Finishing effects and the complete audio mix are rendered on export. */
export function createTimelineEditor({ store, saveProject, onError = () => {}, onExport = () => {} }) {
  let projectId = null, revision = null, signature = '', history = [], node = null, abort = null, video = null;
  let playhead = 0, playing = false, timer = null, lastTick = 0, loadedClip = null, saving = false, pendingSeek = null, frameCallback = null, frameTimer = null;
  const knownDurations = new Map();
  const clips = () => store.project?.timeline || [];
  const fps = () => Math.max(1, Number(store.project?.settings?.fps) || 24);
  const assetFor = clip => store.state.assets.find(asset => asset.id === clip?.assetId);
  const durationFor = clip => { const asset = assetFor(clip), value = knownDurations.get(clip.assetId) ?? asset?.metadata?.duration ?? asset?.metadata?.durationSeconds ?? asset?.duration; return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null; };
  const total = () => timelineSegments(clips()).at(-1)?.end || 0;
  const selected = () => clips().find(clip => clip.id === store.selectedClip) || clips()[0];
  const snapshot = () => ({ timeline: clone(clips()), transcript: clone(store.project.transcript || []), captionsEnabled: store.project.captionsEnabled });
  function syncIdentity() {
    const p = store.project, nextSignature = JSON.stringify([p?.timeline, p?.transcript]);
    if (projectId !== p?.id || revision !== p?.revision && !store.dirty) {
      stop(); history = []; playhead = 0; loadedClip = null;
    }
    projectId = p?.id || null; revision = p?.revision || null; signature = nextSignature;
    if (p && !clips().some(clip => clip.id === store.selectedClip)) store.selectedClip = clips()[0]?.id || null;
  }
  function report(error) { onError(error instanceof Error ? error : Error(String(error))); }
  function safe() { if (!store.project || store.project.id !== projectId || store.project.revision !== revision) throw Error('The project changed. Reopen the timeline before editing this revision.'); if (saving || store.saving) throw Error('Wait for this revision to finish saving.'); }
  function mediaUrl(asset) { return asset?.id ? `/media/${encodeURIComponent(asset.id)}` : ''; }
  function html() {
    syncIdentity();
    const p = store.project;
    if (!p) return '<section id="vyTimelineEditor" class="tle-shell"><h1>Timeline</h1><p>Open a project in Studio or Dashboard to edit its footage.</p></section>';
    const segments = timelineSegments(clips()), length = total(), clip = selected(), asset = assetFor(clip), px = 56, width = Math.max(640, length * px);
    const cues = p.captionsEnabled === false ? [] : Array.isArray(p.transcript) && p.transcript.length ? p.transcript : segments.filter(s => s.clip.caption).map(s => ({ start:s.start, end:s.end, text:s.clip.caption }));
    const audio = [...(p.soundtrack ? [{ ...p.soundtrack, name:'Soundtrack' }] : []), ...(p.audioTracks || [])].filter(track => assetFor(track));
    const sourceAudio = segments.filter(s => { const a = assetFor(s.clip); return a?.metadata?.hasAudio === true || a?.hasAudio === true || a?.metadata?.audioStreams > 0; });
    return `<section id="vyTimelineEditor" class="tle-shell" data-project-id="${esc(p.id)}"><header class="tle-heading"><div><div class="eyebrow">Editor / ${esc(p.name || 'Untitled')}</div><h1>Shape the sequence.</h1><p class="meta">Source preview · grade, final framing, caption styling and audio mix are applied on export.</p></div><div class="tle-actions"><span id="tleSaveStatus" role="status">${store.dirty ? 'Unsaved changes' : `Saved · revision ${p.revision}`}</span><button class="btn" id="tleUndo" ${history.length ? '' : 'disabled'}>Undo edit</button><button class="btn" id="tleSave">Save revision</button><button class="btn primary" id="tleExport" ${clips().length ? '' : 'disabled'}>Export edit ↗</button></div></header><div class="tle-main"><div class="tle-preview"><div class="tle-monitor">${clip ? `<video id="tleVideo" preload="metadata" playsinline ${clip.kind === 'image' ? 'hidden' : ''}></video><img id="tleImage" alt="Selected source image" ${clip.kind === 'image' ? '' : 'hidden'}><div id="tleCaption" class="tle-caption" aria-live="off"></div><p id="tleMediaError" role="status" ${asset ? 'hidden' : ''}>${asset ? '' : 'Source media is missing. Add the source in Assets before export.'}</p>` : '<div class="empty">No clips yet. Upload footage in Studio to start editing.</div>'}</div><div class="tle-transport"><button class="btn" id="tleStart" ${clip ? '' : 'disabled'} aria-label="Go to sequence start">|◀</button><button class="btn primary" id="tlePlay" ${clip ? '' : 'disabled'} aria-label="Play sequence">Play</button><output id="tleTime">${stamp(playhead)} / ${stamp(length)}</output><span id="tleSourceTime" class="meta"></span></div></div><aside class="tle-inspector"><h2>Clip inspector</h2>${clip ? `<p>${esc(asset?.name || clip.title || 'Source clip')}</p><p class="meta">${durationFor(clip) ? `Source length ${durationFor(clip).toFixed(2)} s` : clip.kind === 'image' ? 'Still image' : 'Source length checked when loaded'}</p><label class="field">Source start (seconds)<input id="tleTrim" type="number" min="0" max="3600" step="${1/fps()}" value="${seconds(clip.trimStart)}"></label><label class="field">Clip duration (seconds)<input id="tleDuration" type="number" min="${1/fps()}" max="3600" step="${1/fps()}" value="${seconds(clip.duration)}"></label><label class="field">Caption for this clip<textarea id="tleClipCaption" maxlength="1000" rows="3">${esc(clip.caption || '')}</textarea></label><p class="meta">Changing this caption replaces timed captions inside this clip only.</p><label class="checkbox"><input id="tleMuted" type="checkbox" ${clip.muted ? 'checked' : ''}>Mute source audio</label><button class="btn" id="tleApply">Apply clip changes</button><div class="tle-actions"><button class="btn" id="tleSplit">Split at playhead</button><button class="btn ghost" id="tleEarlier" ${segments[0]?.clip.id === clip.id ? 'disabled' : ''}>Move earlier</button><button class="btn ghost" id="tleLater" ${segments.at(-1)?.clip.id === clip.id ? 'disabled' : ''}>Move later</button></div>` : '<p>Select a clip to trim and arrange it.</p>'}</aside></div><div class="tle-scroll"><div class="tle-canvas" style="position:relative;min-width:${width}px"><div class="tle-ruler" style="display:flex;position:relative;height:28px">${Array.from({length:Math.min(200,Math.ceil(length / Math.max(1,Math.ceil(length/100))))+1}, (_,i) => {const t=i*Math.max(1,Math.ceil(length/100));return `<button class="tle-tick" data-tle-seek="${t}" style="position:absolute;left:${t*px}px" aria-label="Seek to ${t} seconds">${stamp(t)}</button>`;}).join('')}</div><input id="tleScrub" aria-label="Sequence playhead" type="range" min="0" max="${length}" step="${1/fps()}" value="${playhead}" style="width:${Math.max(1,length*px)}px"><div class="tle-track-label">Video · ${clips().length} clips</div><div class="tle-track" style="display:flex;min-height:70px">${segments.map(s => `<button class="tle-clip ${s.clip.id === clip?.id ? 'selected' : ''}" data-tle-clip="${esc(s.clip.id)}" style="flex:0 0 ${s.duration*px}px;width:${s.duration*px}px;overflow:hidden" aria-label="Select clip ${s.index+1}: ${esc(assetFor(s.clip)?.name || s.clip.kind)}"><strong>${s.index+1}. ${esc(assetFor(s.clip)?.name || s.clip.kind)}</strong><small>${stamp(s.duration)} · in ${stamp(seconds(s.clip.trimStart))}${s.clip.muted ? ' · muted' : ''}</small></button>`).join('')}</div>${sourceAudio.length ? `<div class="tle-track-label">Source audio · no waveform analysis</div><div class="tle-track tle-audio-track" style="position:relative;height:32px">${sourceAudio.map(s => `<span style="position:absolute;left:${s.start*px}px;width:${s.duration*px}px">${s.clip.muted ? 'Muted' : 'Source audio'}</span>`).join('')}</div>` : ''}${audio.map(track => `<div class="tle-track-label">${esc(track.name || assetFor(track)?.name || 'Audio layer')}${track.muted ? ' · muted' : ''} · mixed on export</div><div class="tle-track tle-audio-track" style="height:32px;position:relative"><span style="position:absolute;left:${clamp(seconds(track.start),0,length)*px}px;width:${Math.max(0,Math.min(durationFor(track) || length,length-seconds(track.start)))*px}px">${esc(assetFor(track)?.name || 'Audio')}</span></div>`).join('')}${cues.length ? `<div class="tle-track-label">Captions</div><div class="tle-track tle-caption-track" style="position:relative;height:38px">${cues.map(cue => `<span title="${esc(cue.text)}" style="position:absolute;overflow:hidden;left:${clamp(seconds(cue.start),0,length)*px}px;width:${Math.max(0,Math.min(length,seconds(cue.end))-Math.max(0,seconds(cue.start)))*px}px">${esc(cue.text)}</span>`).join('')}</div>` : ''}<div id="tlePlayhead" class="tle-playhead" style="position:absolute;pointer-events:none;top:28px;bottom:0;left:${playhead*px}px"></div></div></div></section>`;
  }
  function redraw() {
    const host = node, previousVideo = video; dispose(); if (!host?.isConnected) return;
    host.outerHTML = html();
    // Keep the browser's decoded source frame and buffer through edits of the same media.
    // Replacing the monitor with a fresh <video> leaves WebM previews black until reload.
    if(previousVideo?.getAttribute('src'))document.querySelector('#vyTimelineEditor #tleVideo')?.replaceWith(previousVideo);
    bind();
  }
  function mutate(next, { origins = {}, captionChanged = false } = {}) {
    safe(); const before = snapshot(); history.push(before); if (history.length > 30) history.shift();
    const sourceCues = before.transcript.length ? before.transcript : timelineSegments(before.timeline).filter(s=>s.clip.caption).map(s=>({start:s.start,end:s.end,text:s.clip.caption}));
    const nextCues = remapTimelineCaptions(before.timeline, next, sourceCues, origins);
    if (captionChanged) {
      const s = timelineSegments(next).find(item => item.clip.id === store.selectedClip);
      const remaining = nextCues.flatMap(c => c.end <= s.start || c.start >= s.end ? [c] : [{...c,end:Math.min(c.end,s.start)},{...c,start:Math.max(c.start,s.end)}].filter(c => c.end > c.start));
      if (s.clip.caption.trim()) remaining.push({start:s.start,end:s.end,text:s.clip.caption.trim()});
      store.project.transcript = remaining.sort((a,b) => a.start-b.start); store.project.captionsEnabled = true;
    } else store.project.transcript = nextCues;
    store.project.timeline = next; store.dirty = true; playhead = Math.min(playhead,total()); signature = JSON.stringify([next,store.project.transcript]); redraw();
  }
  function stop() { playing = false; if (timer) clearInterval(timer); timer = null; video?.pause(); if(node?.querySelector('#tlePlay'))node.querySelector('#tlePlay').textContent='Play'; }
  function renderTime() {
    if (!node) return; const where = locateTimelineTime(clips(),playhead), time=node.querySelector('#tleTime'), scrub=node.querySelector('#tleScrub'), line=node.querySelector('#tlePlayhead');
    if(time)time.textContent=`${stamp(playhead)} / ${stamp(total())}`;if(scrub)scrub.value=String(playhead);if(line)line.style.left=`${playhead*56}px`;
    const source=node.querySelector('#tleSourceTime');if(source)source.textContent=where?`Source ${stamp(where.sourceTime)}`:'';
    const caption=node.querySelector('#tleCaption');if(caption){const p=store.project,cue=p.captionsEnabled===false?null:p.transcript?.length?p.transcript.find(c=>playhead>=c.start&&playhead<c.end):where?.clip.caption?{text:where.clip.caption}:null;caption.textContent=cue?.text||'';caption.hidden=!cue;}
  }
  function previewLoading(){if(!node)return;node.dataset.previewState='loading';const status=node.querySelector('#tlePreviewState');if(status){status.hidden=false;status.textContent='Loading source frame…';}}
  function previewReady(){
    if(!node||!video||video.hidden||video.seeking||video.readyState<2)return;
    const currentNode=node,currentVideo=video,clipId=loadedClip;
    const ready=()=>{if(node!==currentNode||video!==currentVideo||loadedClip!==clipId||video.seeking||video.readyState<2)return;node.dataset.previewState='ready';const status=node.querySelector('#tlePreviewState');if(status)status.hidden=true;};
    if(frameCallback!==null&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(frameCallback);
    if(video.requestVideoFrameCallback)frameCallback=video.requestVideoFrameCallback(ready);else requestAnimationFrame(ready);
    // A paused frame may already have been presented before seeked is dispatched,
    // so a new video-frame callback is not guaranteed until playback resumes.
    clearTimeout(frameTimer);frameTimer=setTimeout(()=>requestAnimationFrame(ready),100);
  }
  function loadAt(position, forceSeek = false) {
    playhead=clamp(seconds(position),0,total());const where=locateTimelineTime(clips(),playhead);if(!where||!node)return;
    const asset=assetFor(where.clip), image=node.querySelector('#tleImage'), error=node.querySelector('#tleMediaError');
    if(!asset){stop();if(error){error.hidden=false;error.textContent='Source media is missing. Add the source in Assets before export.';}return;}
    const changed=loadedClip!==where.clip.id;if(changed){loadedClip=where.clip.id;video?.pause();if(video)video.hidden=where.clip.kind==='image';if(image)image.hidden=where.clip.kind!=='image';if(error)error.hidden=true;}
    if(where.clip.kind==='image'){if(image&&changed){previewLoading();image.src=mediaUrl(asset);}}
    else if(video){
      video.muted=Boolean(where.clip.muted);video.volume=clamp(Number(where.clip.gain??1),0,1);
      pendingSeek=where.sourceTime;
      const sameSource=video.getAttribute('src')===mediaUrl(asset);
      if(changed&&!sameSource){previewLoading();video.src=mediaUrl(asset);video.load();}
      else if(changed||forceSeek||!playing){try{previewLoading();video.currentTime=Math.min(where.sourceTime,Number.isFinite(video.duration)?video.duration:where.sourceTime);pendingSeek=null;}catch{}}
      if(playing&&sameSource&&video.paused)void video.play().catch(error=>{stop();report(error);});
    }
    renderTime();
  }
  function play() {
    if(playing){stop();return;}if(!clips().length)return;if(playhead>=total()-0.01)playhead=0;
    playing=true;lastTick=performance.now();loadAt(playhead,true);if(video&&!video.hidden)void video.play().catch(error=>{stop();report(error);});
    node.querySelector('#tlePlay').textContent='Pause';
    timer=setInterval(()=>{if(!node?.isConnected||store.project?.id!==projectId){stop();return;}const now=performance.now(),dt=(now-lastTick)/1000;lastTick=now;const where=locateTimelineTime(clips(),playhead);if(!where){stop();return;}
      if(where.clip.kind==='image')playhead+=dt;else if(video&&!video.seeking&&video.readyState>=2)playhead=where.start+Math.max(0,video.currentTime-seconds(where.clip.trimStart));
      if(playhead>=where.end-0.012||video?.ended&&where.clip.kind!=='image'){if(where.index===clips().length-1){playhead=total();stop();renderTime();return;}loadAt(where.end,true);}else renderTime();
    },40);
  }
  async function save(exportAfter=false) {
    safe();const id=projectId;saving=true;stop();updateStatus();
    try{for(const clip of clips())validateClipEdit(clip,{},durationFor(clip),fps());const result=await saveProject();if(store.project?.id!==id)return;if(result===false||store.dirty)throw Error('Save this revision successfully before exporting.');revision=store.project.revision;history=[];if(exportAfter)await onExport();}
    catch(error){report(error);}finally{saving=false;if(store.project?.id===id)updateStatus();}
  }
  function bind() {
    dispose();node=document.querySelector('#vyTimelineEditor');if(!node||!store.project)return;abort=new AbortController();video=node.querySelector('#tleVideo');loadedClip=null;
    if(video&&!node.querySelector('#tlePreviewState')){const status=document.createElement('p');status.id='tlePreviewState';status.className='meta';status.setAttribute('role','status');status.textContent='Loading source frame…';video.parentElement.appendChild(status);}
    const listen=(selector,event,action)=>node.querySelectorAll(selector).forEach(el=>el.addEventListener(event,e=>{try{const result=action(e);if(result?.catch)void result.catch(report);}catch(error){report(error);}},{signal:abort.signal}));
    listen('[data-tle-clip]','click',e=>{safe();store.selectedClip=e.currentTarget.dataset.tleClip;playhead=timelineSegments(clips()).find(s=>s.clip.id===store.selectedClip).start;redraw();});
    listen('[data-tle-seek]','click',e=>loadAt(Number(e.currentTarget.dataset.tleSeek),true));
    listen('#tleScrub','input',e=>loadAt(Number(e.currentTarget.value),true));
    listen('#tlePlay','click',play);listen('#tleStart','click',()=>{stop();loadAt(0,true);});
    listen('#tleSave','click',()=>save());listen('#tleExport','click',()=>save(true));
    listen('#tleApply','click',()=>{const clip=selected(),caption=node.querySelector('#tleClipCaption').value;const next=validateClipEdit(clip,{trimStart:Number(node.querySelector('#tleTrim').value),duration:Number(node.querySelector('#tleDuration').value),caption,muted:node.querySelector('#tleMuted').checked},durationFor(clip),fps());mutate(clips().map(c=>c.id===clip.id?next:c),{captionChanged:caption!==(clip.caption||'')});});
    listen('#tleSplit','click',()=>{const id=crypto.randomUUID(),clip=selected();mutate(splitTimelineClip(clips(),clip.id,playhead,id,fps()),{origins:{[id]:clip.id}});});
    listen('#tleEarlier','click',()=>mutate(moveTimelineClip(clips(),selected().id,-1)));listen('#tleLater','click',()=>mutate(moveTimelineClip(clips(),selected().id,1)));
    listen('#tleUndo','click',()=>{safe();const previous=history.pop();if(!previous)return;Object.assign(store.project,previous);store.dirty=true;playhead=Math.min(playhead,total());redraw();});
    listen('#tleVideo','loadedmetadata',()=>{const current=locateTimelineTime(clips(),playhead);if(!current||current.clip.id!==loadedClip)return;knownDurations.set(current.clip.assetId,video.duration);try{validateClipEdit(current.clip,{},video.duration,fps());}catch(error){stop();report(error);return;}if(pendingSeek!==null){video.currentTime=pendingSeek;pendingSeek=null;}if(playing)void video.play().catch(error=>{stop();report(error);});});
    listen('#tleVideo','loadeddata',previewReady);listen('#tleVideo','seeked',previewReady);
    listen('#tleImage','load',()=>{node.dataset.previewState='ready';const status=node.querySelector('#tlePreviewState');if(status)status.hidden=true;});
    listen('#tleVideo,#tleImage','error',()=>{stop();const error=node.querySelector('#tleMediaError');if(error){error.hidden=false;error.textContent='This source could not be decoded by the browser. Check the original media before export.';}});
    loadAt(playhead,true);updateStatus();
  }
  function dispose(){stop();abort?.abort();abort=null;if(frameCallback!==null&&video?.cancelVideoFrameCallback)video.cancelVideoFrameCallback(frameCallback);clearTimeout(frameTimer);frameTimer=null;frameCallback=null;video=null;node=null;loadedClip=null;}
  function updateStatus(){
    if(!node)return;if(store.project?.id!==projectId){dispose();return;}
    const next=JSON.stringify([store.project.timeline,store.project.transcript]);if(!saving&&next!==signature){redraw();return;}
    if(!saving)revision=store.project.revision;
    const status=node.querySelector('#tleSaveStatus');if(status)status.textContent=saving||store.saving?'Saving…':store.dirty?'Unsaved changes':`Saved · revision ${store.project.revision}`;
    node.querySelectorAll('#tleSave,#tleExport,#tleApply,#tleSplit,#tleEarlier,#tleLater,#tleUndo').forEach(el=>{if(saving||store.saving)el.disabled=true;else if(el.id==='tleUndo')el.disabled=!history.length;else if(el.id==='tleEarlier')el.disabled=selected()?.id===clips()[0]?.id;else if(el.id==='tleLater')el.disabled=selected()?.id===clips().at(-1)?.id;else el.disabled=!clips().length;});
  }
  return {html,bind,dispose,updateStatus};
}
