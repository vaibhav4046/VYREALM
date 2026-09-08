const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Mount inside the host's Thumbnail tab. Uses its existing API/session and project store. */
export function createThumbnailStudio({ store, api, refresh, onError = () => {} }) {
  let busy = false, last = null;
  function html() {
    const project = store.project, saved = project?.thumbnailStudio;
    const receipt = last?.projectId === project?.id && (!saved || last.createdAt >= saved.createdAt) ? last : saved;
    if (!project) return '<section class="chat-card" aria-label="Thumbnail studio"><h2>Thumbnail studio</h2><p role="status">Create or select a project to save your thumbnails, then add a headline and choose a composition.</p></section>';
    return `<section class="chat-card" aria-label="Thumbnail studio"><div class="chat-message-meta">VYREALM · Thumbnail studio</div><h2>A clear first impression</h2><p class="meta">Create a 4K composition from your video, an image, or prompt typography. Review it at feed size before publishing.</p><form id="thumbnailStudioForm"><label class="field">Headline<input name="title" maxlength="100" required value="${h(project?.title || project?.name || '')}" placeholder="Three to six words"></label><label class="field">Brief<textarea name="prompt" maxlength="6000" rows="2" placeholder="Describe the idea behind this thumbnail"></textarea></label><label class="field">Source<select name="source"><option value="video" ${project?.latestOutput?.videoAssetId ? '' : 'disabled'}>Current exported video</option><option value="prompt" ${project?.latestOutput?.videoAssetId ? '' : 'selected'}>Prompt typography</option></select></label><label class="field">Composition<select name="style"><option value="cinematic">Cinematic · image above headline</option><option value="editorial">Editorial · headline left</option><option value="bold">Bold · headline panel</option></select></label><button class="btn primary" type="submit" ${busy || !project ? 'disabled' : ''}>${busy ? 'Composing thumbnail…' : 'Create thumbnail'}</button><p class="meta" role="status" id="thumbnailStudioStatus"></p></form>${receipt ? `<div class="thumbnail-result"><img style="display:block;width:100%;max-width:960px;border-radius:14px" src="/media/${h(receipt.assets.upload)}" alt="${h(receipt.title)}"><p class="meta">Feed-size check</p><img style="width:320px;height:180px;max-width:100%;object-fit:contain" width="320" height="180" src="/media/${h(receipt.assets.preview)}" alt="Thumbnail at 320 pixels wide"><div class="chat-actions"><a class="btn primary" href="/media/${h(receipt.assets.master)}" download="thumbnail-master.png">Download 4K master</a><a class="btn" href="/media/${h(receipt.assets.upload)}" download="thumbnail-upload.jpg">Download YouTube thumbnail</a></div><p class="meta">${h(receipt.method.replaceAll('-', ' '))} · ${Math.round(receipt.artifacts.upload.bytes / 1024)} KB · review required${receipt.attached ? '' : ' · project changed; result retained separately'}</p></div>` : ''}</section>`;
  }
  function bind(container) {
    container.querySelector('#thumbnailStudioForm')?.addEventListener('submit', async event => {
      event.preventDefault(); if (busy || !store.project) return;
      const project = store.project, values = Object.fromEntries(new FormData(event.currentTarget)); busy = true;
      const button = event.currentTarget.querySelector('button'), status = container.querySelector('#thumbnailStudioStatus'); button.disabled = true; button.textContent = 'Composing thumbnail…';
      try {
        const result = await api(`/projects/${encodeURIComponent(project.id)}/thumbnails`, { method: 'POST', body: JSON.stringify({ ...values, expectedRevision: project.revision }) });
        last = result.thumbnail; await refresh();
        if (store.project?.id === project.id) { container.innerHTML = html(); bind(container); }
      } catch (error) { status.textContent = error.message || 'Thumbnail could not be created.'; onError(error); }
      finally { busy = false; const current = container.querySelector('button[type="submit"]'); if (current) { current.disabled = false; current.textContent = 'Create thumbnail'; } }
    });
  }
  return { html, bind };
}

