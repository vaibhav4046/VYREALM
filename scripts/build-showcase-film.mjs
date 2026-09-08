/**
 * Build the long-form showcase film with the project's own engine.
 *
 * Narration is synthesised line by line with the local Piper voice so each caption
 * lands on its own audio, rather than being guessed from a single blob. Picture is cut
 * from footage this project actually produced. Assembly is the same FFmpeg binary the
 * studio uses. Nothing here reaches the network.
 *
 *   node scripts/build-showcase-film.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const work = join(root, 'work', 'showcase-film');
const outDir = join(root, 'outputs', 'demo');
const ffmpeg = join(root, 'workers', 'tools', 'ffmpeg.exe');
const ffprobe = join(root, 'workers', 'tools', 'ffprobe.exe');
const audioConfig = process.env.VYREALM_AUDIO_CONFIG;
if (!audioConfig) throw new Error('Set VYREALM_AUDIO_CONFIG');
const python = JSON.parse(readFileSync(audioConfig, 'utf8')).python;

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(outDir, { recursive: true });

const S = join(root, 'outputs', 'showcase');
const NL = 'C:/Users/lalwa/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Roaming/vyrelum/data/media/6b4f7444-1e00-4532-9917-5a1868eb8742-render.mp4';
const WB = 'C:/Users/lalwa/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Roaming/vyrelum/data/jobs/fed29ea8-e7eb-40d8-abd0-a9d23209fd4b/delivery-1080p.mp4';

// line: what the voice says. clip: the picture under it. in: seconds into that clip.
const BEATS = [
  ['This film was made on one laptop.', NL, 0],
  ['No cloud service. No API key. No account.', NL, 4],
  ['Everything you are about to see was produced by models running on a single six gigabyte graphics card.', WB, 0],
  ['This is VYREALM.', join(S, '062-cinematic-trailer-30-youtube-long-30s.mp4'), 2],
  ['You start with a sentence.', join(S, '001-cold-open-question-instagram-reels-15s.mp4'), 1],
  ['The system turns that brief into a shot plan.', join(S, '043-story-narrative-30-instagram-reels-30s.mp4'), 3],
  ['It renders the sequence with FFmpeg, in landscape, portrait or square.', join(S, '023-numbered-listicle-instagram-reels-30s.mp4'), 2],
  ['It writes the voiceover with a local Piper model. This voice. Right now.', join(S, '047-text-story-scroll-instagram-reels-20s.mp4'), 2],
  ['It transcribes that narration with local Whisper and returns timed captions.', join(S, '114-myth-vs-fact-instagram-reels-20s.mp4'), 2],
  ['The captions come back marked review required, because a draft transcriber should not be trusted word for word.', join(S, '129-day-in-life-instagram-reels-30s.mp4'), 3],
  ['It synthesises a sound bed, and hands you the layers to mix.', join(S, '123-music-video-loop-instagram-reels-15s.mp4'), 2],
  ['It generates a four K thumbnail beside the film, not after it.', join(S, '136-quote-card-motion-square-feed-10s.mp4'), 1],
  ['Then it uploads the film and that thumbnail to YouTube.', join(S, '070-product-proof-15-instagram-reels-15s.mp4'), 2],
  ['Anime, in the same pipeline.', join(S, '051-anime-character-intro-instagram-reels-12s.mp4'), 2],
  ['Ninety seconds of it, cut from the same engine.', join(S, '061-anime-short-film-youtube-long-90s.mp4'), 20],
  ['Documentary. Horror. Explainer. Thirty six formats across five platforms.', join(S, '038-micro-horror-turn-instagram-reels-15s.mp4'), 2],
  ['Here is the part nobody else ships.', join(S, '103-explainer-diagram-instagram-reels-30s.mp4'), 3],
  ['Every output carries a receipt naming the model, the seed and the hash that produced it.', WB, 2],
  ['If footage was composited rather than generated, the system says so, in writing, in its own evidence file.', join(S, '063-cinematic-trailer-60-youtube-long-60s.mp4'), 8],
  ['Generated stills are held at review required until a human inspects them and writes down the defects.', WB, 3],
  ['It refuses to mass upload recut variants, because that would breach YouTube policy.', join(S, '006-false-start-loop-instagram-reels-12s.mp4'), 2],
  ['It is a video tool that tells on itself.', join(S, '064-establishing-mood-instagram-reels-15s.mp4'), 3],
  ['The cloud tools are renting you a GPU and keeping the receipts.', join(S, '138-what-if-micro-doc-instagram-reels-25s.mp4'), 2],
  ['This one runs on your machine, offline, and hands the receipts to you.', NL, 6],
  ['VYREALM. Prompt in. Film out. Nothing leaves the room.', join(S, '062-cinematic-trailer-30-youtube-long-30s.mp4'), 12],
];

const run = (bin, args) => execFileSync(bin, args, { windowsHide: true, maxBuffer: 1 << 28 });
const dur = f => Number(String(run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f])).trim());

// 1. Narration, one wav per beat, so captions cannot drift.
console.log(`synthesising ${BEATS.length} narration lines with Piper...`);
const segs = [];
for (const [i, [line]] of BEATS.entries()) {
  const jobDir = join(work, `v${i}`);
  mkdirSync(jobDir, { recursive: true });
  const reqPath = join(jobDir, 'request.json');
  writeFileSync(reqPath, JSON.stringify({ operation: 'voiceover', text: line }));
  run(python, [join(root, 'workers', 'audio-local.py'), '--request', reqPath, '--output', jobDir, '--config', audioConfig]);
  const wav = join(jobDir, 'narration.wav');
  const d = dur(wav);
  segs.push({ wav, seconds: d, line, clip: BEATS[i][1], inPoint: BEATS[i][2] });
  process.stdout.write(`  ${i + 1}/${BEATS.length} ${d.toFixed(2)}s\n`);
}

// 2. One picture segment per line, held exactly as long as the line plus a breath.
const GAP = 0.45;
const parts = [];
for (const [i, s] of segs.entries()) {
  if (!existsSync(s.clip)) throw new Error(`missing clip ${s.clip}`);
  const hold = s.seconds + GAP;
  const out = join(work, `p${i}.mp4`);
  const srcLen = dur(s.clip);
  const start = Math.max(0, Math.min(s.inPoint, Math.max(0, srcLen - hold)));
  // Fill 1920x1080 from any source aspect: cover, centre-crop, no letterbox bars.
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-t', String(hold), '-i', s.clip,
    '-vf', `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,setsar=1`,
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', out]);
  parts.push({ out, hold, ...s });
}

// 3. Picture and voice tracks.
writeFileSync(join(work, 'v.txt'), parts.map(p => `file '${p.out.replace(/\\/g, '/')}'`).join('\n'));
const picture = join(work, 'picture.mp4');
run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(work, 'v.txt'), '-c', 'copy', picture]);

const voiceParts = [];
for (const [i, p] of parts.entries()) {
  const padded = join(work, `a${i}.wav`);
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', p.wav,
    '-af', `apad=pad_dur=${GAP},aresample=48000`, '-t', String(p.hold), '-ac', '2', padded]);
  voiceParts.push(padded);
}
writeFileSync(join(work, 'a.txt'), voiceParts.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
const voice = join(work, 'voice.wav');
run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(work, 'a.txt'), '-c', 'copy', voice]);

// 4. Captions, timed off the real per-line durations.
let t = 0, srt = '';
const stamp = s => {
  const ms = Math.round(s * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
parts.forEach((p, i) => {
  srt += `${i + 1}\n${stamp(t)} --> ${stamp(t + p.seconds)}\n${p.line}\n\n`;
  t += p.hold;
});
const srtPath = join(work, 'captions.srt');
writeFileSync(srtPath, srt, 'utf8');

// 5. Final mux with burned-in captions.
const final = join(outDir, 'VYREALM_SHOWCASE_FILM_1080P.mp4');
const srtArg = srtPath.replace(/\\/g, '/').replace(':', '\\:');
run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', picture, '-i', voice,
  '-vf', `subtitles='${srtArg}':force_style='FontName=Segoe UI,FontSize=19,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00101014,BorderStyle=1,Outline=2,Shadow=1,MarginV=52'`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', final]);

console.log(JSON.stringify({
  output: final,
  seconds: Number(dur(final).toFixed(2)),
  beats: parts.length,
  narrationSeconds: Number(segs.reduce((a, s) => a + s.seconds, 0).toFixed(2)),
}, null, 2));
