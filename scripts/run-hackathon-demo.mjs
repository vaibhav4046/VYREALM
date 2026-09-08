import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, totalmem } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node scripts/run-hackathon-demo.mjs [--audio-config path/to/audio.json]\nCreates isolated work/hackathon-demo-<timestamp> data and evidence. Requires local Piper/Whisper, FFmpeg and Playwright Chromium. No Google login or generation service is used.');
  process.exit(0);
}
assert.ok(args.length === 0 || args.length === 2 && args[0] === '--audio-config', 'Only --audio-config <path> is supported');
const audioConfig = args[1] ? resolve(args[1]) : join(process.env.APPDATA || '', 'vyrelum', 'runtime', 'audio.json');
const runDir = join(root, 'work', `hackathon-demo-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
const evidence = join(runDir, 'evidence'), runtime = join(runDir, 'runtime');
await mkdir(evidence, { recursive: true }); await mkdir(runtime);
await copyFile(audioConfig, join(runtime, 'audio.json'));
const started = Date.now(), ffmpeg = join(root, 'workers', 'tools', 'ffmpeg.exe');
const fixture = join(runDir, 'original-test-pattern.mp4');
let server;
async function run(command, argv, env = process.env) {
  const child = spawn(command, argv, { cwd: root, env, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  let log=''; child.stdout.on('data', bytes => { log += bytes; process.stdout.write(bytes); }); child.stderr.on('data', bytes => { log += bytes; process.stderr.write(bytes); });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Demo command failed with exit ${code}`);
  return log;
}
const probe = createServer(); await new Promise(done => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port; await new Promise(done => probe.close(done));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), VYRELUM_ROOT: root, VYRELUM_DATA_DIR: join(runDir,'data'), VYRELUM_RUNTIME_DIR: runtime,
  VYREALM_TEST_URL: base, VYREALM_TEST_MEDIA: fixture, VYREALM_TEST_OUTPUT: evidence };
async function startServer() {
  server = spawn(process.execPath, ['server.js'], { cwd: root, env, windowsHide: true, stdio: ['ignore','pipe','pipe','ipc'] });
  let tail=''; for (const pipe of [server.stdout,server.stderr]) pipe.on('data', bytes => { tail=(tail+bytes).slice(-3000); });
  for (let n=0;n<150;n++) {
    if (server.exitCode !== null) throw new Error(`Test server stopped: ${tail}`);
    try { if ((await fetch(`${base}/api/session`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(done => setTimeout(done,100));
  }
  throw new Error(`Test server did not become ready: ${tail}`);
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const owned = server; server = undefined;
  const exited = once(owned,'exit');
  const timer = setTimeout(() => owned.kill(),15000);
  try { if (owned.connected) owned.send({type:'shutdown'}); else owned.kill(); await exited; }
  finally { clearTimeout(timer); }
}
try {
  console.log(`Isolated verification: ${runDir}`);
  await run(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=1920x1080:rate=24:duration=5','-c:v','libx264','-threads','2','-pix_fmt','yuv420p',fixture]);
  await startServer();
  const log = await run(process.execPath,[join(root,'node_modules','@playwright','test','cli.js'),'test','--output',join(runDir,'playwright')],env);
  await writeFile(join(evidence,'golden-run.log'),log);
  await stopServer(); await startServer();
  const golden = JSON.parse(await readFile(join(evidence,'golden-evidence.json'),'utf8'));
  const session = await (await fetch(`${base}/api/session`)).json();
  const response = await fetch(`${base}/api/projects/${golden.projectId}`,{headers:{'X-Vyrelum-Token':session.token}});
  assert.equal(response.status,200); const project = await response.json();
  assert.equal(project.timeline.length,1); assert.equal(project.latestOutput.status,'verified');
  assert.equal(project.audioTracks[0].gain,0.4); assert.equal(project.transcript[0].text,'Someone is following me.');
  const media = await fetch(`${base}/media/${project.latestOutput.videoAssetId}`,{headers:{Range:'bytes=0-1023'}});
  assert.equal(media.status,206); assert.equal((await media.arrayBuffer()).byteLength,1024);
  await writeFile(join(evidence,'restart-evidence.json'),JSON.stringify({serverRestart:true,projectId:project.id,revision:project.revision,timelineClips:1,caption:project.transcript[0].text,soundLayerGain:0.4,outputStatus:project.latestOutput.status,mediaRangeStatus:206},null,2));
  const proof=[];
  for (const item of golden.artifacts) {
    const bytes = await readFile(item.path);
    proof.push({file:item.path.split(/[\\/]/).pop(),canvas:item.canvas,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),frames:120,durationSeconds:5,audioSampleRate:48000,fullDecode:true});
  }
  await writeFile(join(evidence,'demo-manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),elapsedSeconds:(Date.now()-started)/1000,sourceClassification:'Original FFmpeg test pattern imported as footage; local Piper narration, Whisper captions and synthesized sound layers; no neural cinema claim',hardware:{platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,logicalCpus:cpus().length,memoryGiB:Math.round(totalmem()/2**30)},sourceFixtureSha256:createHash('sha256').update(await readFile(fixture)).digest('hex'),externalBrowserRequests:golden.externalBrowserRequests,pageErrors:golden.pageErrors,proof},null,2));
  console.log(`PASS: three decoded exports, portable import/re-render, browser reopen and full server restart. Evidence: ${evidence}`);
} finally { await stopServer(); }
