import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const RESEARCH_LIMITS = Object.freeze({ pages: 4, sourceUrls: 3, redirects: 2, bytesPerPage: 1024 * 1024, timeoutMs: 20_000 });
const fail = (suffix, message) => { throw Object.assign(new Error(`RESEARCH_${suffix}: ${message}`), { code: `RESEARCH_${suffix}` }); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const idPattern = /^[a-zA-Z0-9-]{1,128}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const parse = value => { try { return JSON.parse(value); } catch { fail('EVIDENCE_INVALID', 'Saved research data is not valid JSON'); } };
const normalize = value => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
const blocked4 = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked4.addSubnet(address, prefix, 'ipv4');
const public6 = new BlockList(); public6.addSubnet('2000::', 3, 'ipv6');
const blocked6 = new BlockList();
for (const [address, prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) blocked6.addSubnet(address, prefix, 'ipv6');

/** Conservative global-unicast admission. IPv4-mapped/translated IPv6,
 * link-local, multicast and transition mechanisms are deliberately excluded. */
export function isPublicResearchAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blocked4.check(address, 'ipv4') : family === 6 && public6.check(address, 'ipv6') && !blocked6.check(address, 'ipv6');
}

export function validateResearchUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(value)) fail('URL', 'Use an HTTPS public source URL without whitespace');
  let url; try { url = new URL(value); } catch { fail('URL', 'Source URL is invalid'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || !host || host.includes('%')) fail('URL', 'Only credential-free HTTPS on port 443 is supported');
  if (/^(localhost|metadata|metadata\.google\.internal)$/.test(host) || /\.(localhost|local|internal|home|lan|test|invalid)$/.test(host) || !isIP(host) && !host.includes('.')) fail('PRIVATE_ADDRESS', 'Local and internal source hosts are not allowed');
  if (isIP(host) && !isPublicResearchAddress(host)) fail('PRIVATE_ADDRESS', 'The source address is not public');
  url.hash = '';
  return url.href;
}

export function validateResearchPlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['projectId','expectedRevision','query','sourceUrls'].includes(key))) fail('PLAN', 'Supply projectId, expectedRevision, query, and optionally up to three sourceUrls');
  if (typeof input.projectId !== 'string' || !idPattern.test(input.projectId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || typeof input.query !== 'string' || !input.query.trim() || input.query.length > 500) fail('PLAN', 'An existing project, exact revision and a query of 1–500 characters are required');
  const plan = { projectId: input.projectId, expectedRevision: input.expectedRevision, query: normalize(input.query) };
  if (!plan.query) fail('PLAN', 'A readable query is required');
  if (input.sourceUrls !== undefined) {
    if (!Array.isArray(input.sourceUrls) || input.sourceUrls.length < 1 || input.sourceUrls.length > RESEARCH_LIMITS.sourceUrls) fail('PLAN', 'Provide one to three explicit source URLs');
    plan.sourceUrls = [...new Set(input.sourceUrls.map(validateResearchUrl))];
  }
  return plan;
}

function abortError(signal) {
  return Object.assign(new Error(signal.reason?.code === 'RESEARCH_TIMEOUT' ? 'RESEARCH_TIMEOUT: Research exceeded its 20-second deadline' : 'RESEARCH_CANCELLED: Research was cancelled'), { code: signal.reason?.code === 'RESEARCH_TIMEOUT' ? 'RESEARCH_TIMEOUT' : 'RESEARCH_CANCELLED' });
}

function bounded(promise, signal) {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolvePromise, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolvePromise, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function resolvePublic(url, lookup, signal) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  const literalFamily = isIP(host);
  const answers = literalFamily ? [{ address: host, family: literalFamily }] : await bounded(lookup(host, { all: true, verbatim: true }), signal);
  if (!Array.isArray(answers) || !answers.length || answers.some(item => !isPublicResearchAddress(item.address) || item.family !== isIP(item.address))) fail('PRIVATE_ADDRESS', 'All DNS answers must be public global-unicast addresses');
  // Prefer one IPv4 address for common laptop networks. Never resolve again in
  // the socket: lookup below always returns this already-vetted address.
  return answers.find(item => item.family === 4) || answers[0];
}

function requestPinned(url, address, signal, request) {
  return new Promise((resolvePromise, reject) => {
    let req, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', abort);
      if (error) { req?.destroy(); reject(error); } else resolvePromise(result);
    };
    const abort = () => finish(abortError(signal));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    try {
      req = request(new URL(url), {
        method: 'GET', agent: false, rejectUnauthorized: true, family: address.family, autoSelectFamily: false,
        lookup: (_hostname, options, callback) => {
          if (typeof options === 'function') { callback = options; options = {}; }
          if (options?.all) callback(null, [{ ...address }]); else callback(null, address.address, address.family);
        },
        headers: { 'User-Agent': 'VYREALM/1.0 (local creator research)', Accept: 'text/html, application/xhtml+xml, text/plain, application/json', 'Accept-Encoding': 'identity' },
      }, response => {
        const status = response.statusCode || 0;
        if ([301,302,303,307,308].includes(status)) { response.destroy(); finish(null, { redirect: response.headers.location, status }); return; }
        if (status < 200 || status > 299) { response.destroy(); finish(Object.assign(new Error(`RESEARCH_HTTP: Source returned HTTP ${status}`), { code: 'RESEARCH_HTTP' })); return; }
        const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (!['text/html','application/xhtml+xml','text/plain','application/json'].includes(contentType)) { response.destroy(); finish(Object.assign(new Error('RESEARCH_CONTENT_TYPE: Only HTML, plain text and JSON sources are supported'), { code: 'RESEARCH_CONTENT_TYPE' })); return; }
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); finish(Object.assign(new Error('RESEARCH_ENCODING: Compressed source responses are not accepted'), { code: 'RESEARCH_ENCODING' })); return; }
        if (Number(response.headers['content-length']) > RESEARCH_LIMITS.bytesPerPage) { response.destroy(); finish(Object.assign(new Error('RESEARCH_SIZE: Source exceeds 1 MiB'), { code: 'RESEARCH_SIZE' })); return; }
        const chunks = []; let bytes = 0;
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > RESEARCH_LIMITS.bytesPerPage) { response.destroy(); finish(Object.assign(new Error('RESEARCH_SIZE: Source exceeds 1 MiB'), { code: 'RESEARCH_SIZE' })); }
          else chunks.push(Buffer.from(chunk));
        });
        response.on('end', () => finish(null, { status, contentType, body: Buffer.concat(chunks) }));
        response.on('error', error => finish(error));
        response.on('aborted', () => finish(Object.assign(new Error('RESEARCH_TRUNCATED: Source response ended prematurely'), { code: 'RESEARCH_TRUNCATED' })));
      });
      req.on('error', error => finish(error)); req.end();
    } catch (error) { finish(error); }
  });
}

async function fetchSource(initialUrl, { lookup, request, signal }) {
  let url = validateResearchUrl(initialUrl); const redirects = [];
  for (let hop = 0; hop <= RESEARCH_LIMITS.redirects; hop++) {
    if (signal.aborted) throw abortError(signal);
    const address = await resolvePublic(url, lookup, signal);
    const result = await requestPinned(url, address, signal, request);
    if ('redirect' in result) {
      if (!result.redirect || hop === RESEARCH_LIMITS.redirects) fail('REDIRECT_LIMIT', 'Source exceeded two redirects or omitted its destination');
      let target; try { target = new URL(result.redirect, url).href; } catch { fail('URL', 'Redirect URL is invalid'); }
      const destination = validateResearchUrl(target);
      redirects.push({ from: url, to: destination, status: result.status, address: address.address }); url = destination;
    } else return { ...result, requestedUrl: initialUrl, url, redirects, resolvedAddress: address.address, accessedAt: new Date().toISOString() };
  }
  fail('REDIRECT_LIMIT', 'Source exceeded two redirects');
}

function decodeEntities(text) {
  const named = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', ndash:'–', mdash:'—', hellip:'…', lsquo:'‘', rsquo:'’', ldquo:'“', rdquo:'”' };
  return text.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (match, entity) => {
    if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? match;
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' ';
  });
}

/** Inert extraction, not a browser or HTML sanitizer. Returned strings remain
 * untrusted source data and must be rendered with textContent, never innerHTML. */
export function extractResearchText(body, contentType = 'text/html') {
  const input = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  if (Buffer.byteLength(input) > RESEARCH_LIMITS.bytesPerPage * 3) fail('SIZE', 'Source text exceeds the extraction limit');
  if (contentType === 'text/plain') return { title: '', text: normalize(input) };
  if (!['text/html','application/xhtml+xml'].includes(contentType)) fail('CONTENT_TYPE', 'Research source pages must contain readable HTML or plain text');
  const withoutActive = input.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ').replace(/<(script|style|noscript|template|svg|iframe|object|nav|footer|header)\b[^<>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ');
  const title = normalize(decodeEntities((withoutActive.match(/<title\b[^<>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || '').replace(/<[^<>]*>/g, ' '))).slice(0, 300);
  const text = normalize(decodeEntities(withoutActive.replace(/<head\b[^<>]*>[\s\S]*?(?:<\/head\s*>|$)/gi, ' ').replace(/<[^<>]*>/g, ' ')));
  return { title, text };
}

export function selectResearchSnippets(text, query) {
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])];
  const candidates = (text.match(/[^.!?]+(?:[.!?]+|$)/g) || [text]).map(normalize).filter(item => item.length >= 30);
  return candidates.map((text, index) => ({ text: text.slice(0, 380), index, score: words.reduce((n, word) => n + Number(text.toLowerCase().includes(word)), 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 2).sort((a, b) => a.index - b.index).map(item => item.text);
}

async function ownedRoot(jobsDir, jobId, create = false) {
  if (typeof jobId !== 'string' || !idPattern.test(jobId) || typeof jobsDir !== 'string' || !isAbsolute(jobsDir)) fail('OWNERSHIP', 'An absolute canonical jobs directory and job ID are required');
  const jobsRoot = await realpath(jobsDir), candidate = join(jobsRoot, jobId);
  if (create) await mkdir(candidate, { recursive: true });
  const jobRoot = await realpath(candidate);
  if (relative(jobsRoot, jobRoot) !== jobId) fail('OWNERSHIP', 'Research files must belong to a direct child of the canonical jobs store');
  return jobRoot;
}

async function ownedFile(jobRoot, name, maxBytes = RESEARCH_LIMITS.bytesPerPage) {
  const path = await realpath(resolve(jobRoot, name)), rel = relative(jobRoot, path);
  if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) fail('OWNERSHIP', 'Research evidence escaped its job directory');
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > maxBytes) fail('EVIDENCE_INVALID', 'Research evidence is missing or exceeds its byte limit');
  return readFile(path);
}

function diagnostic(error, url) {
  return { code: typeof error?.code === 'string' && error.code.startsWith('RESEARCH_') ? error.code : 'RESEARCH_FETCH_FAILED', message: String(error?.message || 'Source could not be read').slice(0, 400), ...(url ? { url } : {}) };
}

/** Explicit online action only. No model, account, browser session, subprocess,
 * credential, remote instruction execution or publishing is involved.
 * dependencies are trusted in-process test seams, never accepted in plan JSON. */
export async function runProjectResearch({ plan: input, jobsDir, jobId, onlineAuthorized = false, onProgress = () => {}, signal, dependencies = {} } = {}) {
  if (onlineAuthorized !== true) fail('ONLINE_AUTHORIZATION', 'Research requires an explicit online action');
  const plan = validateResearchPlan(input), jobRoot = await ownedRoot(jobsDir, jobId, true);
  await writeFile(join(jobRoot, 'research-request.json'), JSON.stringify(plan, null, 2), { flag: 'wx' });
  const sourceRoot = join(jobRoot, 'research'); await mkdir(sourceRoot, { recursive: true });
  if (relative(jobRoot, await realpath(sourceRoot)) !== 'research') fail('OWNERSHIP', 'Research snapshots must remain in the owned job');
  const controller = new AbortController(), cancel = () => controller.abort(signal.reason);
  if (signal?.aborted) controller.abort(signal.reason); else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort({ code: 'RESEARCH_TIMEOUT' }), RESEARCH_LIMITS.timeoutMs);
  const startedAt = new Date().toISOString(), sources = [], diagnostics = [], documents = [];
  const transport = { lookup: dependencies.lookup || dnsLookup, request: dependencies.request || httpsRequest, signal: controller.signal };
  const progress = (stage, progress) => onProgress({ stage, progress });
  async function snapshot(page, role, sourceMethod) {
    const extracted = role === 'source' ? extractResearchText(page.body, page.contentType) : null;
    const snippets = extracted ? selectResearchSnippets(extracted.text, plan.query) : null;
    if (role === 'source' && !snippets.length) fail('EMPTY_SOURCE', 'The source did not contain enough readable text');
    const index = documents.length + 1, prefix = `research/source-${String(index).padStart(2, '0')}`;
    const bodyPath = `${prefix}.body.txt`, contentSHA256 = sha(page.body);
    await writeFile(join(jobRoot, bodyPath), page.body, { flag: 'wx' });
    const entry = { role, sourceMethod, requestedUrl: page.requestedUrl, url: page.url, accessedAt: page.accessedAt, contentType: page.contentType, contentSHA256, bytes: page.body.length, bodyPath, resolvedAddress: page.resolvedAddress, redirects: page.redirects };
    if (role === 'source') {
      entry.title = extracted.title || new URL(page.url).hostname;
      entry.textPath = `${prefix}.text.txt`; entry.textSHA256 = sha(extracted.text); entry.snippets = snippets;
      await writeFile(join(jobRoot, entry.textPath), extracted.text, { flag: 'wx' });
      sources.push(entry);
    }
    documents.push(entry); return entry;
  }
  try {
    let urls = plan.sourceUrls;
    if (!urls) {
      progress('Searching Wikipedia public sources', 5);
      const searchUrl = new URL('https://en.wikipedia.org/w/rest.php/v1/search/page'); searchUrl.searchParams.set('q', plan.query); searchUrl.searchParams.set('limit', '3');
      const discovery = await fetchSource(searchUrl.href, transport);
      if (discovery.contentType !== 'application/json') fail('DISCOVERY', 'Wikipedia returned an unexpected search format');
      const search = parse(discovery.body.toString('utf8'));
      await snapshot(discovery, 'discovery', 'wikipedia-rest-search');
      if (!Array.isArray(search.pages)) fail('DISCOVERY', 'Wikipedia search did not return page references');
      urls = [...new Set(search.pages.slice(0, 3).filter(page => typeof page.key === 'string' && page.key.length < 512).map(page => `https://en.wikipedia.org/w/rest.php/v1/page/${encodeURIComponent(page.key)}/html`))];
    }
    for (const [index, url] of urls.entries()) {
      if (documents.length >= RESEARCH_LIMITS.pages) break;
      if (signal?.aborted) throw abortError(controller.signal);
      progress(`Reading source ${index + 1} of ${urls.length}`, 15 + index * 20);
      try { await snapshot(await fetchSource(url, transport), 'source', plan.sourceUrls ? 'user-url' : 'wikipedia-rest-page'); }
      catch (error) { if (signal?.aborted) throw error; diagnostics.push(diagnostic(error, url)); }
    }
    if (signal?.aborted) throw abortError(controller.signal);
    if (!sources.length) fail('NO_SOURCES', 'No readable public source was retrieved; no researched brief was created');
    const receipt = { schemaVersion: 1, kind: 'project-research', jobId, projectId: plan.projectId, expectedRevision: plan.expectedRevision, query: plan.query, status: 'succeeded', sourceMethod: plan.sourceUrls ? 'user-urls' : 'wikipedia-rest', summaryMethod: 'extractive', untrustedSourceData: true, startedAt, completedAt: new Date().toISOString(), limits: RESEARCH_LIMITS, sources, documents, diagnostics, summary: sources.flatMap(source => source.snippets.map(text => ({ text, sourceUrl: source.url, contentSHA256: source.contentSHA256 }))) };
    receipt.evidenceHash = sha(JSON.stringify(receipt));
    await writeFile(join(jobRoot, 'research-result.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
    progress('Source receipts saved; waiting for project revision commit', 95);
    return receipt;
  } catch (error) {
    await writeFile(join(jobRoot, 'research-failure.json'), JSON.stringify({ status: 'failed', jobId, projectId: plan.projectId, diagnostics: [...diagnostics, diagnostic(error)], completedAt: new Date().toISOString() }, null, 2), { flag: 'wx' }).catch(() => {});
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

/** Re-read owned snapshots and derive every summary sentence again before
 * committing. A caller cannot substitute an invented 'researched' receipt. */
export async function commitProjectResearch({ db, jobsDir, jobId } = {}) {
  if (!db) fail('DATABASE', 'The canonical project database is required');
  const databaseFile = db.prepare('PRAGMA database_list').all().find(item => item.name === 'main')?.file;
  if (!databaseFile || await realpath(jobsDir) !== await realpath(join(dirname(await realpath(databaseFile)), 'jobs'))) fail('OWNERSHIP', 'Research evidence must use this database’s canonical sibling jobs store');
  const jobRoot = await ownedRoot(jobsDir, jobId), plan = validateResearchPlan(parse((await ownedFile(jobRoot, 'research-request.json')).toString('utf8')));
  const receipt = parse((await ownedFile(jobRoot, 'research-result.json')).toString('utf8'));
  const { evidenceHash, ...unsigned } = receipt;
  if (receipt.schemaVersion !== 1 || receipt.kind !== 'project-research' || receipt.status !== 'succeeded' || receipt.jobId !== jobId || receipt.projectId !== plan.projectId || receipt.expectedRevision !== plan.expectedRevision || receipt.query !== plan.query || receipt.summaryMethod !== 'extractive' || receipt.untrustedSourceData !== true || !isDeepStrictEqual(receipt.limits, RESEARCH_LIMITS) || !hashPattern.test(evidenceHash || '') || sha(JSON.stringify(unsigned)) !== evidenceHash || !Array.isArray(receipt.documents) || receipt.documents.length > RESEARCH_LIMITS.pages || !Array.isArray(receipt.sources) || !receipt.sources.length || receipt.sources.length > 3) fail('EVIDENCE_INVALID', 'A complete hash-bound extractive research receipt is required');
  const actualSources = [];
  for (const [index, document] of receipt.documents.entries()) {
    const prefix = `research/source-${String(index + 1).padStart(2, '0')}`;
    if (document.bodyPath !== `${prefix}.body.txt` || !['source','discovery'].includes(document.role) || !isPublicResearchAddress(document.resolvedAddress || '') || !Number.isFinite(Date.parse(document.accessedAt)) || !Array.isArray(document.redirects) || document.redirects.length > 2) fail('EVIDENCE_INVALID', 'The source receipt metadata is invalid');
    validateResearchUrl(document.url); validateResearchUrl(document.requestedUrl);
    for (const redirect of document.redirects) { validateResearchUrl(redirect.from); validateResearchUrl(redirect.to); if (!isPublicResearchAddress(redirect.address || '')) fail('EVIDENCE_INVALID', 'A redirect address is invalid'); }
    const body = await ownedFile(jobRoot, document.bodyPath);
    if (sha(body) !== document.contentSHA256 || body.length !== document.bytes) fail('SOURCE_HASH', 'Downloaded source bytes have changed');
    if (document.role === 'source') {
      const extracted = extractResearchText(body, document.contentType), snippets = selectResearchSnippets(extracted.text, plan.query);
      if (document.textPath !== `${prefix}.text.txt` || sha(extracted.text) !== document.textSHA256 || !snippets.length || !isDeepStrictEqual(snippets, document.snippets) || document.title !== (extracted.title || new URL(document.url).hostname) || sha(await ownedFile(jobRoot, document.textPath, RESEARCH_LIMITS.bytesPerPage * 3)) !== document.textSHA256) fail('SOURCE_HASH', 'Readable source text or excerpts have changed');
      actualSources.push(document);
    }
  }
  if (!isDeepStrictEqual(actualSources, receipt.sources) || !isDeepStrictEqual(receipt.summary, actualSources.flatMap(source => source.snippets.map(text => ({ text, sourceUrl: source.url, contentSHA256: source.contentSHA256 }))))) fail('SUMMARY', 'The research summary must contain only verified source excerpts');
  db.exec('BEGIN IMMEDIATE');
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(plan.projectId), job = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
    if (!project || !job || job.project_id !== plan.projectId || job.type !== 'research' || job.revision !== plan.expectedRevision || !isDeepStrictEqual(validateResearchPlan(parse(job.input || '{}')), plan)) fail('OWNERSHIP', 'Research must match its durable same-project job and exact input');
    const document = parse(project.document);
    if (!document || typeof document !== 'object' || Array.isArray(document) || document.researchEvidence !== undefined && !Array.isArray(document.researchEvidence)) fail('DOCUMENT', 'Saved project research must be an editable array');
    const previous = (document.researchEvidence || []).find(entry => entry.jobId === jobId);
    if (previous) {
      if (previous.evidenceHash !== evidenceHash || job.status !== 'succeeded') fail('EVIDENCE_INVALID', 'Previously committed research differs from its job');
      db.exec('COMMIT'); return { applied: false, alreadyApplied: true, project: { ...document, id: project.id, revision: project.revision }, receipt: previous };
    }
    if (project.revision !== plan.expectedRevision) fail('REVISION_CONFLICT', 'Project changed while researching; saved evidence is retained but has not been applied');
    if (!['queued','running','review_required'].includes(job.status)) fail('JOB_STATE', 'Cancelled, failed or completed research cannot be applied');
    const now = new Date().toISOString(), revision = project.revision + 1, entry = { ...receipt, appliedRevision: revision, appliedAt: now };
    document.researchEvidence = [...(document.researchEvidence || []), entry];
    const saved = JSON.stringify(document), output = JSON.stringify({ ...receipt, appliedRevision: revision, appliedAt: now });
    db.prepare('UPDATE projects SET revision=?,document=?,updated_at=? WHERE id=?').run(revision, saved, now, project.id);
    db.prepare('INSERT INTO project_revisions(project_id,revision,document,created_at) VALUES(?,?,?,?)').run(project.id, revision, saved, now);
    db.prepare("UPDATE jobs SET status='succeeded',progress=100,stage='Research sources saved to project',output=?,error=NULL,updated_at=? WHERE id=?").run(output, now, jobId);
    db.exec('COMMIT');
    return { applied: true, alreadyApplied: false, project: { ...document, id: project.id, revision, createdAt: project.created_at, updatedAt: now }, receipt: entry };
  } catch (error) { try { db.exec('ROLLBACK'); } catch { /* Keep the original failure. */ } throw error; }
}
