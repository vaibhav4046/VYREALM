/**
 * Record the demo: start an isolated local server, drive the real UI with the
 * demo-capture spec, and leave a .webm of the actual session.
 *
 * Deliberately leaner than run-hackathon-demo.mjs, which is the qualification
 * harness and asserts provenance invariants afterwards. This one only has to
 * produce a watchable recording of the real product, so a spec failure still
 * leaves whatever footage was captured on disk.
 *
 *   node scripts/record-demo.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const runDir = join(root, 'work', 'demo-recording');
const evidence = join(runDir, 'evidence');
const videoDir = join(root, 'outputs', 'demo', 'raw');
const ffmpeg = join(root, 'workers', 'tools', 'ffmpeg.exe');
const fixture = join(runDir, 'demo-source.mp4');

await mkdir(evidence, { recursive: true });
await mkdir(videoDir, { recursive: true });

const audioConfig = process.env.VYREALM_AUDIO_CONFIG;
if (!audioConfig) throw new Error('Set VYREALM_AUDIO_CONFIG to the local audio.json');

const run = (command, argv, env = process.env) => new Promise((ok, bad) => {
  const child = spawn(command, argv, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('exit', code => code === 0 ? ok() : bad(new Error(`${command} exited ${code}`)));
});

const probe = createServer();
await new Promise(done => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port;
await new Promise(done => probe.close(done));
const base = `http://127.0.0.1:${port}`;

const env = {
  ...process.env,
  PORT: String(port),
  VYRELUM_ROOT: root,
  VYRELUM_DATA_DIR: join(runDir, 'data'),
  VYRELUM_RUNTIME_DIR: join(runDir, 'runtime'),
  VYREALM_TEST_URL: base,
  VYREALM_TEST_MEDIA: fixture,
  VYREALM_TEST_OUTPUT: evidence,
  VYREALM_RECORD_VIDEO: videoDir,
  VYREALM_TEST_MATCH: 'demo-capture.spec.mjs',
  VYREALM_TEST_TIMEOUT: process.env.VYREALM_TEST_TIMEOUT || '1800000',
};

await mkdir(join(runDir, 'runtime'), { recursive: true });
await run(process.execPath, ['-e', `require('node:fs').copyFileSync(${JSON.stringify(audioConfig)}, ${JSON.stringify(join(runDir, 'runtime', 'audio.json'))})`]);

// A short original clip stands in for imported footage. Silent on purpose: the
// narration the demo transcribes is the one Piper generates on camera.
await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
  '-i', 'testsrc2=size=1920x1080:rate=24:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fixture]);

let server;
const startServer = async () => {
  server = spawn(process.execPath, ['server.js'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let tail = '';
  for (const pipe of [server.stdout, server.stderr]) pipe.on('data', b => { tail = (tail + b).slice(-2000); });
  for (let n = 0; n < 200; n++) {
    if (server.exitCode !== null) throw new Error(`server stopped: ${tail}`);
    try { if ((await fetch(`${base}/api/session`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error(`server never became ready: ${tail}`);
};

try {
  await startServer();
  console.log(`recording against ${base}`);
  await run(process.execPath, [join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '--output', join(runDir, 'playwright')], env);
  console.log(`RECORDED. Video in ${videoDir}`);
} finally {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    const timer = setTimeout(() => server.kill(), 10000);
    try { if (server.connected) server.send({ type: 'shutdown' }); else server.kill(); await exited; } finally { clearTimeout(timer); }
  }
}
