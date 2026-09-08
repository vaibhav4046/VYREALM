/**
 * VYRELUM local-first production engine.
 * Persists project state, media metadata, and resumable jobs in IndexedDB,
 * with a localStorage fallback for restricted environments.
 */

const SCHEMA_VERSION = 1;
const STORES = ['projects', 'media', 'jobs'];
const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}_${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`}`;
const clone = (value) => { if (value == null) return value; try { return globalThis.structuredClone ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value)); } catch { return JSON.parse(JSON.stringify(value)); } };

export class VyrelumEngine {
  constructor({ dbName = 'vyrelum-engine', storageKey = 'vyrelum:engine', maxRetries = 2 } = {}) {
    this.dbName = dbName;
    this.storageKey = storageKey;
    this.maxRetries = maxRetries;
    this.db = null;
    this.mode = 'memory';
    this.memory = { projects: [], media: [], jobs: [] };
    this.ready = this.init();
  }

  async init() {
    if (typeof indexedDB === 'undefined') {
      this.mode = 'storage';
      this._loadStorage();
      return this;
    }
    try {
      this.db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, SCHEMA_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          STORES.forEach((name) => {
            if (!db.objectStoreNames.contains(name)) {
              const store = db.createObjectStore(name, { keyPath: 'id' });
              store.createIndex('updatedAt', 'updatedAt');
              if (name === 'jobs') store.createIndex('status', 'status');
              if (name === 'media') store.createIndex('projectId', 'projectId');
            }
          });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      this.mode = 'indexeddb';
    } catch (error) {
      console.warn('VYRELUM: IndexedDB unavailable, using local storage', error);
      this.mode = 'storage';
      this._loadStorage();
    }
    return this;
  }

  _loadStorage() {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.storageKey) || '{}');
      this.memory = { ...this.memory, ...parsed };
    } catch { /* corrupted storage is treated as empty */ }
  }

  _saveStorage() {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.memory)); } catch { /* quota/private mode */ }
  }

  async _put(storeName, value) {
    await this.ready;
    const record = clone(value);
    if (this.mode === 'indexeddb') {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(record);
        tx.oncomplete = () => resolve(record);
        tx.onerror = () => reject(tx.error);
      });
    }
    const rows = this.memory[storeName];
    const index = rows.findIndex((row) => row.id === record.id);
    if (index < 0) rows.push(record); else rows[index] = record;
    this._saveStorage();
    return record;
  }

  async _get(storeName, id) {
    await this.ready;
    if (this.mode === 'indexeddb') return new Promise((resolve, reject) => {
      const request = this.db.transaction(storeName, 'readonly').objectStore(storeName).get(id);
      request.onsuccess = () => resolve(request.result ? clone(request.result) : null);
      request.onerror = () => reject(request.error);
    });
    return clone(this.memory[storeName].find((row) => row.id === id) || null);
  }

  async _list(storeName, predicate = () => true) {
    await this.ready;
    let rows;
    if (this.mode === 'indexeddb') rows = await new Promise((resolve, reject) => {
      const request = this.db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    else rows = this.memory[storeName];
    return clone(rows.filter(predicate).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))));
  }

  async _delete(storeName, id) {
    await this.ready;
    if (this.mode === 'indexeddb') return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).delete(id);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    this.memory[storeName] = this.memory[storeName].filter((row) => row.id !== id); this._saveStorage();
  }

  async createProject(input = {}) {
    const timestamp = now();
    const project = {
      id: input.id || uid('proj'), name: input.name || 'Untitled project', brief: input.brief || '',
      medium: input.medium || 'Video · 16:9', timeline: input.timeline || [], assets: input.assets || [],
      settings: input.settings || {}, version: Number(input.version || 1), createdAt: input.createdAt || timestamp,
      updatedAt: timestamp
    };
    return this._put('projects', project);
  }

  async updateProject(id, patch = {}) {
    const current = await this._get('projects', id);
    if (!current) throw new Error(`Project ${id} not found`);
    return this._put('projects', { ...current, ...patch, id, version: Number(current.version || 1) + 1, updatedAt: now() });
  }

  getProject(id) { return this._get('projects', id); }
  listProjects() { return this._list('projects'); }
  deleteProject(id) { return this._delete('projects', id); }

  async ingestMedia(file, { projectId = null, persistBlob = true } = {}) {
    if (!file) throw new Error('A File or Blob is required');
    const timestamp = now();
    const metadata = {
      id: uid('media'), projectId, name: file.name || 'untitled-media', type: file.type || 'application/octet-stream',
      size: Number(file.size || 0), lastModified: file.lastModified || Date.now(), createdAt: timestamp, updatedAt: timestamp,
      kind: (file.type || '').startsWith('video/') ? 'video' : (file.type || '').startsWith('audio/') ? 'audio' : 'image'
    };
    if (persistBlob && this.mode === 'indexeddb' && file instanceof Blob) metadata.blob = file;
    if (metadata.kind === 'image' && typeof createImageBitmap === 'function') {
      try { const bitmap = await createImageBitmap(file); metadata.width = bitmap.width; metadata.height = bitmap.height; bitmap.close(); } catch { /* metadata remains valid */ }
    }
    return this._put('media', metadata);
  }

  getMedia(id) { return this._get('media', id); }
  listMedia(projectId = null) { return this._list('media', (item) => projectId == null || item.projectId === projectId); }

  async enqueueJob(type, input = {}, { projectId = null, maxRetries = this.maxRetries } = {}) {
    const timestamp = now();
    return this._put('jobs', {
      id: uid('job'), type, projectId, input: clone(input), status: 'queued', progress: 0, checkpoint: null,
      attempts: 0, maxRetries, error: null, output: null, createdAt: timestamp, updatedAt: timestamp
    });
  }

  getJob(id) { return this._get('jobs', id); }
  listJobs(status = null) { return this._list('jobs', (job) => !status || job.status === status); }

  async updateJob(id, patch = {}) {
    const job = await this._get('jobs', id);
    if (!job) throw new Error(`Job ${id} not found`);
    return this._put('jobs', { ...job, ...clone(patch), id, updatedAt: now() });
  }

  async checkpointJob(id, checkpoint, progress) {
    return this.updateJob(id, { checkpoint: clone(checkpoint), ...(progress == null ? {} : { progress: Math.max(0, Math.min(1, progress)) }) });
  }

  async retryJob(id) {
    const job = await this._get('jobs', id);
    if (!job) throw new Error(`Job ${id} not found`);
    if (!['failed', 'cancelled'].includes(job.status)) return job;
    if (job.attempts >= job.maxRetries) throw new Error(`Job ${id} exceeded retry limit`);
    return this.updateJob(id, { status: 'queued', error: null, progress: 0 });
  }

  async cancelJob(id) { return this.updateJob(id, { status: 'cancelled' }); }

  /** Run one job with an executor(ctx), persisting every state transition. */
  async runJob(id, executor) {
    const job = await this._get('jobs', id);
    if (!job) throw new Error(`Job ${id} not found`);
    if (!['queued', 'failed'].includes(job.status)) return job;
    const running = await this.updateJob(id, { status: 'running', attempts: job.attempts + 1, error: null });
    const ctx = {
      job: running,
      checkpoint: (value, progress) => this.checkpointJob(id, value, progress),
      isCancelled: async () => (await this.getJob(id))?.status === 'cancelled'
    };
    try {
      const output = await executor(ctx);
      return this.updateJob(id, { status: 'completed', progress: 1, output: clone(output), checkpoint: null });
    } catch (error) {
      const latest = await this.getJob(id);
      if (latest?.status === 'cancelled') return latest;
      return this.updateJob(id, { status: latest?.attempts < latest?.maxRetries ? 'failed' : 'failed', error: String(error?.message || error) });
    }
  }

  async runNext(executor) {
    const queued = await this.listJobs('queued');
    return queued[0] ? this.runJob(queued[0].id, executor) : null;
  }

  /** Import an exported project JSON bundle and preserve ids for round trips. */
  async importProject(serialized, { replace = false } = {}) {
    const payload = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    if (!payload?.project?.id) throw new Error('Invalid VYRELUM project bundle');
    const existing = await this.getProject(payload.project.id);
    if (existing && !replace) throw new Error(`Project ${payload.project.id} already exists`);
    await this._put('projects', { ...payload.project, updatedAt: now() });
    for (const asset of payload.media || []) await this._put('media', { ...asset, updatedAt: now() });
    for (const job of payload.jobs || []) await this._put('jobs', { ...job, updatedAt: now() });
    return this.getProject(payload.project.id);
  }
  async exportProject(projectId, { includeMedia = true, pretty = true } = {}) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    const media = includeMedia ? await this.listMedia(projectId) : [];
    const jobs = await this.listJobs();
    const payload = { schema: 'vyrelum.project', schemaVersion: SCHEMA_VERSION, exportedAt: now(), project, media: media.map(({ blob, ...item }) => item), jobs: jobs.filter((job) => job.projectId === projectId) };
    return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
  }

  async exportProjectFile(projectId, options = {}) {
    const json = await this.exportProject(projectId, options);
    return new Blob([json], { type: 'application/json' });
  }
}

export const createVyrelumEngine = (options) => new VyrelumEngine(options);
export default VyrelumEngine;



