const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localMediaUrl=value=>typeof value==='string'&&/^\/media\/[A-Za-z0-9_-]+$/.test(value)?value:null;
const sizeLabel=value=>Number(value)>0?Number(value)<1e6?`${Math.round(Number(value)/1024)} KB`:`${(Number(value)/1e6).toFixed(1)} MB`:'Size unavailable';
export function assetMediaType(asset){const mime=String(asset?.mime||'').toLowerCase();return ['image','video','audio'].find(type=>mime.startsWith(`${type}/`))||'files';}
export function selectLibraryAssets({assets=[],projects=[],jobs=[],currentProjectId=null,scope='current',query='',type='media',page=1,pageSize=24}={}){
 const projectMap=new Map(projects.map(p=>[p.id,p])),jobMap=new Map(jobs.map(j=>[j.id,j])),seen=new Set(),needle=String(query).trim().toLocaleLowerCase();
 const selected=scope==='all'?null:scope==='current'?currentProjectId:scope;
 const items=[];
 for(const asset of assets){
  if(!asset?.id||seen.has(asset.id))continue;seen.add(asset.id);
  if(selected&&asset.projectId!==selected)continue;
  const mediaType=assetMediaType(asset);if(type==='media'?mediaType==='files':mediaType!==type)continue;
  const project=projectMap.get(asset.projectId),projectName=project?.name||'Unassigned project';
  if(needle&&!`${asset.name||''} ${projectName} ${mediaType}`.toLocaleLowerCase().includes(needle))continue;
  const job=jobMap.get(asset.jobId),currentOutput=project?.latestOutput;
  const rejected=asset.status==='rejected'||asset.review?.verdict==='rejected'||job?.status==='rejected'||job?.output?.review?.verdict==='rejected'||currentOutput?.status==='rejected'&&[currentOutput.videoAssetId,currentOutput.posterAssetId].includes(asset.id);
  const role=asset.kind==='sourcevideo'||!asset.jobId?'Source':'Output';
  const poster=mediaType==='video'&&asset.jobId?assets.find(p=>p.jobId===asset.jobId&&p.projectId===asset.projectId&&p.kind==='poster'&&!/contact.sheet/i.test(p.name||'')&&localMediaUrl(p.url)):null;
  items.push({asset,type:mediaType,url:localMediaUrl(asset.url),posterUrl:poster?.url||null,projectName,role,review:rejected?'Rejected':job?.status==='review_required'?'Needs review':null});
 }
 const limit=Math.max(1,Math.min(36,Math.floor(Number(pageSize)||24))),pages=Math.max(1,Math.ceil(items.length/limit)),current=Math.max(1,Math.min(pages,Math.floor(Number(page)||1)));
 return {items:items.slice((current-1)*limit,current*limit),total:items.length,page:current,pages,pageSize:limit};
}

export function createAssetLibrary({store,onImport=()=>{},onError=()=>{}}){
 let scope='current',query='',type='media',page=1,projectId=undefined,observer=null,bound=null,lastSignature='',opener=null;
 const selectedProject=()=>store.project?.id||null;
 function syncProject(){const next=selectedProject();if(projectId!==next){projectId=next;scope=next?'current':'all';query='';type='media';page=1;return true;}return false;}
 function selection(){return selectLibraryAssets({assets:store.state?.assets||[],projects:store.state?.projects||[],jobs:store.state?.jobs||[],currentProjectId:projectId,scope,query,type,page});}
 const signature=()=>JSON.stringify([selectedProject(),(store.state?.assets||[]).map(a=>[a.id,a.url,a.name,a.size]),(store.state?.jobs||[]).map(j=>[j.id,j.status]),(store.state?.projects||[]).map(p=>[p.id,p.name,p.latestOutput?.status])]);
 function card(item){
  const a=item.asset,name=escapeHtml(a.name||'Untitled asset'),url=escapeHtml(item.url),icon=item.type==='audio'?'♪':item.type==='files'?'▤':item.type==='video'?'▶':'▧';
  const visual=item.url&&item.type==='image'?`<img src="${url}" alt="" loading="lazy">`:item.url&&item.type==='video'?item.posterUrl?`<img src="${escapeHtml(item.posterUrl)}" alt="" loading="lazy"><span class="al-play" aria-hidden="true">▶</span>`:`<video data-al-video="${url}" preload="none" muted playsinline aria-hidden="true"></video><span class="al-play" aria-hidden="true">▶</span>`:`<span class="al-file-icon" aria-hidden="true">${icon}</span><span class="al-file-type">${item.url?item.type==='audio'?'Audio source':'Project file':'Media unavailable'}</span>`;
  return `<article class="al-card"><button class="al-card-open" data-al-open="${escapeHtml(a.id)}" aria-label="Preview ${name}" ${item.url?'':'disabled'}>${visual}<span class="al-card-type">${escapeHtml(item.type==='files'?'File':item.type)}</span></button><div class="al-card-info"><h2 title="${name}">${name}</h2><p class="al-project-name" title="${escapeHtml(item.projectName)}">${escapeHtml(item.projectName)}</p><div class="al-card-meta"><span>${item.role} · ${sizeLabel(a.size)}</span>${item.review?`<span class="al-review ${item.review==='Rejected'?'al-rejected':''}">${item.review}</span>`:''}</div>${item.url?'':'<p class="al-unavailable">Source link missing. Import the original media to use it.</p>'}</div></article>`;
 }
 function results(){const value=selection();page=value.page;return `<div class="al-results-heading"><p role="status">${value.total?`${(page-1)*value.pageSize+1}–${Math.min(page*value.pageSize,value.total)} of ${value.total} ${type==='files'?'files':'media items'}`:'No matching media'}</p><span>${type==='files'?'Project files and evidence':'Source files and saved outputs'}</span></div>${value.items.length?`<div class="al-grid">${value.items.map(card).join('')}</div>`:`<div class="al-empty"><span aria-hidden="true">▧</span><h2>${query?'No media matches your search':type==='files'?'No project files here':'Your media belongs here'}</h2><p>${query?'Try a filename or choose another project.':type==='files'?'Saved project documents and evidence appear in this view.':'Import footage, images or audio, or choose All projects to browse your library.'}</p></div>`}<nav class="al-pagination" aria-label="Asset pages"><button class="btn" data-al-page="${page-1}" ${page===1?'disabled':''}>← Previous</button><span>Page ${page} of ${value.pages}</span><button class="btn" data-al-page="${page+1}" ${page===value.pages?'disabled':''}>Next →</button></nav>`;}
 function html(){syncProject();lastSignature=signature();return `<section class="al-library" id="alLibrary"><header class="al-heading"><div><div class="eyebrow">Library / Your media</div><h1>Find the right <em>frame.</em></h1><p>Your footage, images and sound, organized by project.</p></div><button class="btn primary" id="alImport">Import media ↗</button></header><div class="al-toolbar"><label class="al-search">Search media<input id="alSearch" type="search" value="${escapeHtml(query)}" placeholder="Search filenames or projects"></label><label>Project<select id="alScope">${projectId?`<option value="current" ${scope==='current'?'selected':''}>Current · ${escapeHtml(store.project?.name||'Untitled')}</option>`:''}<option value="all" ${scope==='all'?'selected':''}>All projects</option>${(store.state?.projects||[]).map(p=>`<option value="${escapeHtml(p.id)}" ${scope===p.id?'selected':''}>${escapeHtml(p.name||'Untitled')}</option>`).join('')}</select></label><label>Show<select id="alType">${[['media','All media'],['video','Videos'],['image','Images'],['audio','Audio'],['files','Files & evidence']].map(([id,label])=>`<option value="${id}" ${type===id?'selected':''}>${label}</option>`).join('')}</select></label></div><div id="alResults">${results()}</div><dialog class="al-dialog" id="alPreview" aria-labelledby="alPreviewTitle"><div class="al-dialog-heading"><div><h2 id="alPreviewTitle">Media preview</h2><p id="alPreviewMeta"></p></div><button class="btn" id="alClose" aria-label="Close media preview">Close ×</button></div><div id="alPreviewBody"></div><p id="alPreviewError" class="al-preview-error" role="status" hidden></p></dialog></section>`;}
 function stopPreviews(){observer?.disconnect();observer=null;bound?.querySelectorAll('.al-card video').forEach(v=>{v.pause();v.removeAttribute('src');v.load();});}
 function closePreview(){const dialog=bound?.querySelector('#alPreview');dialog?.querySelectorAll('video,audio').forEach(v=>{v.pause();v.removeAttribute('src');v.load();});if(dialog?.open)dialog.close();dialog?.querySelector('#alPreviewBody')?.replaceChildren();if(opener?.isConnected)opener.focus();opener=null;}
 function preview(id,button){
  const item=selection().items.find(x=>x.asset.id===id);if(!item?.url)return;
  closePreview();opener=button;const dialog=bound.querySelector('#alPreview'),body=dialog.querySelector('#alPreviewBody'),error=dialog.querySelector('#alPreviewError');
  dialog.querySelector('#alPreviewTitle').textContent=item.asset.name||'Untitled asset';dialog.querySelector('#alPreviewMeta').textContent=`${item.projectName} · ${item.role}${item.review?' · '+item.review:''}`;error.hidden=true;
  const url=escapeHtml(item.url);body.innerHTML=item.type==='video'?`<video src="${url}" controls playsinline preload="metadata"></video>`:item.type==='audio'?`<div class="al-audio-preview"><span aria-hidden="true">♪</span><audio src="${url}" controls preload="metadata"></audio></div>`:item.type==='image'?`<img src="${url}" alt="${escapeHtml(item.asset.name||'Source image')}">`:'<div class="al-file-preview"><p>This project file can be downloaded for inspection. It is not executed in the studio.</p></div>';
  body.insertAdjacentHTML('beforeend',`<a class="btn al-download" href="${url}" download="${escapeHtml(item.asset.name||'vyrealm-asset')}">Download original</a>`);
  body.querySelector('video,audio,img')?.addEventListener('error',()=>{error.textContent='This media could not be opened. The source may be missing or its format unsupported.';error.hidden=false;},{once:true});dialog.showModal();dialog.querySelector('#alClose').focus();
 }
 function bindResults(){
  bound.querySelectorAll('[data-al-open]').forEach(b=>b.onclick=()=>preview(b.dataset.alOpen,b));
  bound.querySelectorAll('[data-al-page]').forEach(b=>b.onclick=()=>{page=Number(b.dataset.alPage);paint();bound.querySelector('.al-toolbar')?.scrollIntoView({block:'start'});});
  const load=v=>{if(!v.getAttribute('src'))v.src=v.dataset.alVideo;v.preload='metadata';};
  if(typeof IntersectionObserver==='function'){observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){load(e.target);observer.unobserve(e.target);}}),{rootMargin:'100px'});bound.querySelectorAll('[data-al-video]').forEach(v=>observer.observe(v));}else bound.querySelectorAll('[data-al-video]').forEach(load);
 }
 function paint(){if(!bound?.isConnected)return;closePreview();stopPreviews();bound.querySelector('#alResults').innerHTML=results();bindResults();}
 function bind(){dispose();bound=typeof document!=='undefined'?document.querySelector('#alLibrary'):null;if(!bound)return;
  bound.querySelector('#alImport').onclick=()=>Promise.resolve().then(onImport).catch(onError);
  bound.querySelector('#alSearch').oninput=e=>{query=e.target.value;page=1;paint();};bound.querySelector('#alScope').onchange=e=>{scope=e.target.value;page=1;paint();};bound.querySelector('#alType').onchange=e=>{type=e.target.value;page=1;paint();};
  const dialog=bound.querySelector('#alPreview');bound.querySelector('#alClose').onclick=closePreview;dialog.oncancel=e=>{e.preventDefault();closePreview();};dialog.onclick=e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closePreview();}};bindResults();
 }
 function dispose(){closePreview();stopPreviews();bound=null;}
 function update(){if(!bound?.isConnected)return;const changed=syncProject(),next=signature();if(!changed&&next===lastSignature)return;if(changed){const node=bound;dispose();node.outerHTML=html();bind();}else{lastSignature=next;paint();}}
 return {html,bind,dispose,update};
}
