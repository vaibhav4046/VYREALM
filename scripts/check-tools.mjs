/**
 * Preflight for `npm test`.
 *
 * The FFmpeg binaries are ~227 MB each and are deliberately not in git (.gitignore
 * excludes *.exe). Without this check a fresh clone fails eleven tests deep with a
 * bare ENOENT that says nothing about what is missing, which is the first thing a
 * new contributor hits. Fail immediately instead, and say exactly what to do.
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const win = process.platform === 'win32';
const bin = name => process.env[`VYRELUM_${name.toUpperCase()}`] || join(root, 'workers', 'tools', win ? `${name}.exe` : name);

const required = ['ffmpeg', 'ffprobe'];
const missing = required.filter(name => !existsSync(bin(name)));

if (missing.length) {
  const dir = join(root, 'workers', 'tools');
  console.error(`
VYREALM: missing local media tools -> ${missing.join(', ')}

The test suite renders and probes real video, so it needs FFmpeg on disk.
These binaries are ~227 MB each and are not committed to git.

Fix it either way:

  1. Put ffmpeg${win ? '.exe' : ''} and ffprobe${win ? '.exe' : ''} in:
       ${dir}
     Windows builds: https://www.gyan.dev/ffmpeg/builds/  (release "essentials")

  2. Or point at an existing install:
       ${win ? 'setx VYRELUM_FFMPEG  "C:\\path\\to\\ffmpeg.exe"' : 'export VYRELUM_FFMPEG=/usr/bin/ffmpeg'}
       ${win ? 'setx VYRELUM_FFPROBE "C:\\path\\to\\ffprobe.exe"' : 'export VYRELUM_FFPROBE=/usr/bin/ffprobe'}

Then run "npm run doctor" to confirm the whole local runtime.
`);
  process.exit(1);
}

console.log(`media tools ok: ${required.map(n => bin(n)).join(', ')}`);
