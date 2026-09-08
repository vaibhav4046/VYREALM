/**
 * Re-mux the showcase film with captions at the top of frame.
 *
 * The source clips already carry burned-in captions low in frame, so a second caption
 * track at the bottom stacks two unrelated lines on top of each other. Ours goes top
 * centre in an opaque box instead.
 */
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ff = join(root, 'workers', 'tools', 'ffmpeg.exe');
const work = join(root, 'work', 'showcase-film');
const out = join(root, 'outputs', 'demo', 'VYREALM_SHOWCASE_FILM_1080P.mp4');

// libavfilter parses this as a filter argument: forward slashes, and the drive colon escaped.
const srt = join(work, 'captions.srt').replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
const style = 'FontName=Segoe UI,FontSize=20,Bold=1,PrimaryColour=&H00FFFFFF,BackColour=&HB0101014,BorderStyle=4,Outline=0,Shadow=0,Alignment=8,MarginV=46';

execFileSync(ff, [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-i', join(work, 'picture.mp4'),
  '-i', join(work, 'voice.wav'),
  '-vf', `subtitles='${srt}':force_style='${style}'`,
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
  out,
], { stdio: 'inherit', windowsHide: true });

console.log('remuxed ->', out);
