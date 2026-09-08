# VYREALM

**A complete video studio that runs on one Windows laptop, and refuses to lie about what it made.**

A written brief becomes a shot plan, a rendered film, local narration, timed captions, a synthesised
sound bed, a 4K thumbnail and a private YouTube upload. No cloud service, no API key, no account,
no rented GPU. Every model runs locally on a 6 GB consumer card or on CPU, and every output carries
a receipt naming the model, the seed and the hash that produced it.

Repository: [vaibhav4046/VYREALM](https://github.com/vaibhav4046/VYREALM). Package name is `vyrelum`.

**Watch first:** `outputs/demo/VYREALM_SHOWCASE_FILM_1080P.mp4`. 110.6 seconds, 1920x1080, h264 + aac,
25 narration beats, 104 seconds of local Piper speech synthesised one line per beat so the captions
cannot drift off the audio. Built by `scripts/build-showcase-film.mjs` with the same FFmpeg binary the
studio itself uses. Nothing in that film reached the network.

---

## The honest part, up front

The format library defines **36 formats across 5 delivery platforms**. Expanded with the evidence
retimes that is **151 renderable variants** (105 without them). Those 151 variants are cut from
**seven source clips totalling about 91 seconds of footage**, and two of the seven are not filmed
material at all: they are generated stills panned for five seconds each.

| Source clip | Length | What it is |
|---|---:|---|
| `VYREALM_RAINLINE_TRAILER_1080P.mp4` | 15.0 s | locally generated |
| `VYREALM_CINEMATIC_15S_TRAILER_1080P.mp4` | 15.0 s | composited |
| `VYREALM_ASSET_FIRST_TRAILER_1080P.mp4` | 30.0 s | composited |
| `VYREALM_UI_PROJECT_OUTPUT_1080P.mp4` | 15.0 s | composited |
| `ODYSSEY_FILM_CINEMATIC_1080P.mp4` | 6.0 s | Blender 3D render |
| `VYREALM_ANIME_HERO_5S.mp4` | 5.04 s | generated still, panned |
| `VYREALM_TALKING_HEAD_5S.mp4` | 5.04 s | generated still, panned |
| **Total** | **91.1 s** | |

A 151-file catalogue built from 91 seconds of source advertises the repetition, not the engine. So the
batch was curated **down**, not shipped whole. `scripts/curate-showcase.mjs` hashed 170 rendered files
and kept **19 distinct pictures**:

| Dropped | Count | Why |
|---|---:|---|
| Same picture | 70 | Reels / TikTok / Shorts share a 1080x1920 canvas; siblings differ only in caption placement |
| Evidence retimes | 56 | The 53 s / 150 s / 300 s variants are the same cut slowed or ping-ponged |
| Byte-identical | 16 | Groups of files with matching SHA-256 content hashes |
| Visual review | rest | Flat-vector mascot and plain gradient title-card families: they render correctly, they are just not worth showing |

Run `node scripts/curate-showcase.mjs` and it re-derives those counts against whatever is currently in
`outputs/`, hashes every file and prints its own reasoning. Add `--write` to repopulate
`outputs/showcase/`.

The interesting claim here was never "we made 151 videos". It is that a brief becomes a shot plan, a
render, timed captions, a sound bed, a thumbnail and an upload without a single network call, on
consumer hardware, with a provenance receipt attached to every output.

---

## Quickstart

Install **Node.js 24** (24.12.0 is what was tested), then:

```powershell
git clone https://github.com/vaibhav4046/VYREALM
cd VYREALM
node server.js
```

Open <http://127.0.0.1:4173>. Stop with `Ctrl+C`.

That is the whole install. The studio boots with **zero npm dependencies**, using Node's built-in
modules including `node:sqlite`. No models, no GPU, no API key and no account are needed to start it,
create a project, import media and reopen the library. The server listens on loopback, not on your
network interface.

Projects land in `data/` inside the repo by default. To put them somewhere else, set the paths before
starting and keep using the same ones to reopen that library:

```powershell
$env:VYRELUM_DATA_DIR    = Join-Path $env:LOCALAPPDATA 'VYREALM\projects'
$env:VYRELUM_RUNTIME_DIR = Join-Path $env:LOCALAPPDATA 'VYREALM\runtime'
node server.js
```

### Rendering your own footage

Exporting video needs an FFmpeg build with H.264/AAC support plus its matching FFprobe. Drop
`ffmpeg.exe` and `ffprobe.exe` into `workers/tools/`, or point at an existing install:

```powershell
$env:VYRELUM_FFMPEG  = 'C:\tools\ffmpeg\bin\ffmpeg.exe'
$env:VYRELUM_FFPROBE = 'C:\tools\ffmpeg\bin\ffprobe.exe'
node server.js
```

Import media, open **Timeline**, cut, then **Export edit**. `npm run doctor` verifies the rest of the
local runtime and tells you what is missing.

### Optional local runtimes

| Capability | What it needs | How |
|---|---|---|
| Chat / shot planning | Ollama with a local model (default `qwen3:4b-instruct`) | set `OLLAMA_HOST`, `VYRELUM_CHAT_MODEL` |
| Narration and captions | Piper + faster-whisper on CPU | **Settings → Voice & captions → Install**, or `.\scripts\Setup-AudioRuntime.ps1` |
| Generated shots | ComfyUI, a compatible GPU, ~25 GB free disk | `npm run setup:neural` (needs Git and uv) |

The guided audio install verifies eight model files and 26 pinned package versions, generates a real
Piper sample and transcribes it with Whisper before registering the configuration. Measured footprint
including caches and proof files: about 808 MiB. Pinned hashes live in
`runtime/audio-models.lock.json` and `runtime/audio-requirements-windows.lock.txt`.

---

## What it does

| Stage | Runs on | Notes |
|---|---|---|
| **Plan** | local LLM via Ollama | Brief becomes a concrete shot plan against the 36-format library |
| **Render** | FFmpeg | 1080p landscape, portrait or square; duration drift measured per file |
| **Narrate** | Piper `en_US-ljspeech-high`, CPU | One WAV per line, so captions cannot drift |
| **Caption** | faster-whisper `tiny.en`, CPU | Returns `review_required`; a draft transcriber is not trusted verbatim |
| **Score** | ACE-Step | Sound bed synthesised locally, mixed as editable layers |
| **Thumbnail** | FFmpeg | 4K thumbnail produced alongside the film, not after it |
| **Publish** | `publishing/` | Private YouTube upload, hash-verified, thumbnail bound to the video |

Generation is real when the hardware allows it: LTX-Video 2B distilled Q8 GGUF and Wan2.2-TI2V-5B
Q4_K_M GGUF run under a local ComfyUI on an RTX 3050 with 6 GB of VRAM. Wan2.2 peaks at **5.85 GiB**.
Every downstream choice in this project is shaped by that remaining sliver of headroom.

---

## Provenance: the receipts

Most of the engineering here is a provenance system that constrains the product rather than
flattering it. This is the part worth reading the source for.

**`runtime/generation-gate.mjs`** will not let anything be labelled "generated" on the strength of a
detected executable. It requires a reachable provider, the exact pinned models
(`Wan2.2-TI2V-5B-Q4_K_M.gguf`, `umt5-xxl-encoder-Q4_K_S.gguf`, `wan2.2_vae.safetensors`), eleven named
ComfyUI nodes, a measurable GPU with at least 4 GB of VRAM, and a verified output that physically
exists inside the durable job directory. Anything short of that returns
`BLOCKED_NEURAL_GENERATION` and tells you which precondition failed. A provider that is installed but
has no reviewed adapter returns `NEURAL_ADAPTER_SMOKE_TEST_REQUIRED` rather than quietly counting as
capability.

`recordGeneratedProvenance` writes the receipt: provider id, model id, workflow hash, seed, prompt,
output SHA-256, resolution, fps, frame count, VRAM peak, render time, provider prompt id, and a
lineage chain. An artifact outside its own job directory is refused outright
(`GENERATED_OUTPUT_OUTSIDE_JOB`).

**`runtime/format-render.mjs`** stamps `sourceMethod: 'composited-from-existing-footage'` on every
batch output, so a recut can never be mistaken for a generation.

**`scripts/render-format-batch.mjs`** writes, into its own evidence file, the sentence:

> "No pixels were generated by this batch."

It also refuses to substitute stand-in footage: plans whose shot roles have no honest source are
skipped and reported by name, never filled in.

**Generated stills sit at `review_required`** until a human inspects the image and writes down its
specific defects. Approval is bound to that image's SHA-256, so editing the project cannot silently
re-approve an older frame.

**`assertNotBulkPublishable`** in `runtime/format-library.mjs` blocks mass-uploading recut variants
outright, citing YouTube's and Instagram's own policies on repetitive and unoriginal content. Format
variants are production plans, not approved uploads.

**Uploads are private-only and hash-gated.** `publishing/youtube-service.mjs` re-reads the approved
file, re-hashes it with SHA-256 and compares against the expected hash before a byte is sent
(`YOUTUBE_FILE_CHANGED` if it moved). It re-checks the connected channel against the channel you
confirmed (`YOUTUBE_CHANNEL_MISMATCH`), refuses anything whose visual review did not pass
(`YOUTUBE_REVIEW_REQUIRED`), refuses files outside the profile's media folder
(`YOUTUBE_ASSET_BOUNDARY`), and requires an explicit synthetic-media disclosure boolean. Credentials
sit in a Windows DPAPI-protected vault and are never logged.

The system declines to overstate what it made, including in its own documentation. That is the
feature.

---

## Quality detectors

`runtime/quality-detectors.mjs` scores delivered video against a catalogue of failure modes, each one
calibrated against clips this project actually produced, each carrying its own `calibratedOn`,
`confidence` and source citation. Thresholds are labelled provisional, because two clips of evidence
is two clips of evidence.

| Mode | Signal | Example measurement |
|---|---|---|
| Temporal flicker | VBench frame-difference score | 0.9803 accepted, 0.9030 bad on every axis |
| Motion stall | Run of near-duplicate frame pairs | Re-roll is the only repair |
| Dead footage | Top-5% optical flow below spec | Gated against shot intent, not applied blind |
| Detail collapse | Step drop in Laplacian variance | Frame 34 to 35 lost 4.03x its detail, invisible to every frame-difference metric |
| Terminal detail decay | Monotonic decay over the last ~15 frames | Ends at 50.4% of shot median; trim or crossfade the tail |
| Morphing geometry | High ORB match ratio, low RANSAC inlier ratio | 0.809 inliers against 0.951 on stable shots |
| Scene drift | Histogram correlation against frame one | Named as a proxy, not identity |
| Colour drift | Per-channel means sliding apart | Red draining at 3.02 levels/sec against 0.07 on blue |
| Stepped cadence | Period-2 autocorrelation structure | Polarity is intent-dependent: correct for anime, a defect in live action |
| Encode blocking | Gradient energy on the 8x8 transform grid | Measures the encoder, not the generator. Telemetry, not a gate |

Four further modes (VAE chunk seam, face below latent resolution, garbled on-screen text, off-bucket
resolution) are catalogued as **not detectable** on this box and are handled by refusal at
prompt-compile time instead. Naming an undetectable failure is cheaper than a 26-minute re-roll.

Scoring is off by default in batch renders, and the reason is measured: one 8-second 1080x1080 clip
takes 8.8 s to render and 99.7 s to probe and score. Pass `--score` when you want the measurement, and
the evidence file then records the thresholds behind every verdict.

---

## Testing

```powershell
npm ci                            # dev dependencies only; the studio itself needs none
npx playwright install chromium   # browser journeys
npm test                          # ~356 node tests
```

`npm test` renders and probes real video, so a `pretest` guard checks for FFmpeg and FFprobe first.
The binaries are about 227 MB each and are deliberately not committed. Without the guard a fresh
clone fails eleven tests deep with a bare `ENOENT` that explains nothing, so the guard fails
immediately instead and prints the exact fix, including the download URL and the two environment
variables.

`npm run test:release` adds stabilisation, creator-pack, automation and YouTube service suites.

---

## Architecture

```
app.js  studio-chat.js  timeline-editor.js  youtube-settings.js   browser workspace
server.js  runtime/  publishing/                                  local API, SQLite revisions, jobs
workers/  desktop/                                                media processing, Electron host
scripts/                                                          batch render, curation, film build
```

- **Storage** is SQLite through `node:sqlite`, with project revisions and portable export/import.
- **Jobs** are durable rows, recovered on restart. An interrupted worker surfaces as *Needs attention*
  rather than silently resuming.
- **MCP**: `npm run mcp` exposes the same engine over stdio, so an agent can drive it. **MCP tools →
  Test local bridge** performs a real `initialize`, `tools/list` and read-only `list_projects` through
  the actual transport.
- **Desktop**: an Electron build exists for Windows via `npm run desktop:dist`.

See `docs/VYREALM_ARCHITECTURE.md` for the data flow and runtime boundaries.

---

## Known limits

- **Source variety is the binding constraint, not the pipeline.** More formats do not add more
  footage. Generating genuinely new shots runs at roughly 500 to 1500 seconds per shot on this GPU.
- **Native generation resolution is low**, 512x288 to 1024x576, and upscaled with Lanczos for
  delivery. Delivery dimensions do not imply native detail, and no AI enhancement is claimed.
- **Whisper `tiny.en` is a draft transcriber.** It rendered "Someone" as "some more" in our own demo
  run. Captions ship marked for review, not as truth.
- **Bulk publishing is blocked on purpose**, and that is not configurable.
- **Windows x64 only.** Tested on Node 24.12.0, Intel Core i5-12450HX, 16 GiB RAM, RTX 3050 Laptop
  6 GB. macOS and Linux are unqualified.
- **A rendered file is not a reviewed film.** A clean encode and a full decode say nothing about
  whether the shot is any good, and the system does not pretend otherwise.

---

## Credits and licence

Built with Node.js, SQLite, Electron, Vite and FFmpeg, with optional Piper, faster-whisper, Ollama,
ACE-Step and ComfyUI / Wan2.2 and LTX-Video. Runtime notices and pinned model information are in
`runtime/notices/` and the runtime lock files. Every dependency, binary and model keeps its own terms;
the Windows FFmpeg build reports GPLv3-or-later, with its licence and source links included.

Original VYREALM code is [MIT](LICENSE), copyright 2026 VYREALM contributors. That does not relicense
third-party binaries, libraries or model weights, none of which are in this repository.
