# VYREALM extension map — format library, batch queue, route selector

Read-only recon, 2026-09-07. Target: `C:\Users\lalwa\Documents\Codex\2026-09-06\j` (VYRELUM/VYREALM 1.0.4).
No file in the tree was modified. Line numbers are as-read at survey time; `server.js` and `app.js` use
very long lines, so one line number often points at a whole subsystem.

---

## 1. Job types and the dispatch switch

**The dispatch switch is a single ternary chain at `server.js:98`, inside `runJob(id)` (`server.js:96`).**

```
'scene' | 'render'                    -> workers/render.mjs
'direct'                              -> runtime/director.mjs   (the director is its own worker)
'produce'                             -> workers/produce.mjs
'generation-test' | 'generation-shot' -> workers/neural.mjs
'enhance'                             -> workers/enhance.mjs
'interpolate'                         -> workers/interpolate.mjs
'runtime-setup'                       -> workers/runtime-setup.mjs
'sound-design'                        -> workers/sound-design.mjs
'voiceover' | 'transcribe'            -> workers/audio.mjs
otherwise                             -> null -> job set to 'blocked'
```

11 job types. Every worker is spawned identically (`server.js:155`):

```
spawn(process.execPath, [script, '--input', <jobDir>/request.json, '--output', <jobDir>])
```

with NDJSON `{progressEvent:true, stage, progress, elapsedSeconds}` on stdout (parsed at `server.js:157`)
and a `result.json` in the output dir as the sole success/failure contract (`server.js:159` onward).

**Render routes are a different axis from job type.** Three, declared as `ROUTES` at
`runtime/director.mjs:7` and gated by `capabilityRoute` (`runtime/inference-harness.mjs:12-24`):
`scene3d`, `neural-video`, `image`. The executable pipelines are:

| Pipeline | Entry | Speed |
|---|---|---|
| Product / asset-first FFmpeg | `workers/produce.mjs:20-24` -> `renderProductVideo` | fast (seconds) |
| Asset-first trailer (multi-shot FFmpeg) | `workers/produce.mjs:49` -> `renderAssetFirstTrailer` | fast |
| Timeline compose | `workers/render.mjs` / `workers/timeline.mjs` `renderTimeline` | fast |
| Blender abstract scene | `workers/produce.mjs:58-66` -> director + `render.mjs` | medium |
| Neural Wan2.2 via ComfyUI | `workers/neural.mjs` -> `produceNeuralSmoke` | slow: 1,413–1,838 s per 5 s shot (`TASKS.md:8`) |

**Job creation is gated twice.** `POST /api/jobs` admits only `direct|scene|render|produce`
(`server.js:381`, the `allowed` Set). Every other type is created by its own dedicated endpoint (§6).

---

## 2. GPU lease — where it is and how it serialises

Two layers, both required.

**Layer 1 — in-process: `server.js:32` + `server.js:100`.**
`let gpuLease=null` (`:32`). Then:
```js
if(gpuLease && gpuLease!==id){ setTimeout(()=>void runJob(id), 500); return; } gpuLease=id;   // :100
```
Released at `:110, :123, :147, :150, :152` (early exits) and in the child `exit` handler at `:158`.

**Layer 2 — cross-process: `runtime/inference-harness.mjs:28` — `acquireGpuLease(owner, {root})`.**
- Opens `<GPU_ROOT>/gpu-lease.sqlite` and takes an exclusive OS write lock with
  `PRAGMA busy_timeout=0; BEGIN IMMEDIATE` (`:32`). A second process gets SQLITE_BUSY -> throws
  `GPU_LEASE_BUSY` (`:35`).
- `GPU_ROOT` = `VYRELUM_GPU_LEASE_DIR` or `%APPDATA%/vyrelum/runtime` (`:11`), so **every VYREALM
  workspace on the account shares one lease**.
- Also rejects when `gpu-worker.json` names a still-live pid (`:38-45`).
- Returns an async `release()` (`:47`) carrying `release.registerChild(pid)` (`:52`), which writes the
  worker pid atomically (tmp + rename, `wx` flag). `server.js:156` calls it with the spawned pid.
- Held until the child exits. **No wall-clock expiry** — the lock dies with the process.
- Covered by `runtime/inference-harness.test.mjs`: 8 concurrent contenders all get `GPU_LEASE_BUSY`,
  a live lease does not expire, and the OS releases the lock on process kill.

**Properties that matter for a batch queue:**
- Strictly one GPU-heavy child at a time, machine-wide. Correct.
- **Ordering is undefined.** Blocked jobs busy-poll every 500 ms (`server.js:100` and `:104`);
  whichever timer fires first wins. No FIFO, no priority, no fairness.
- Each waiting job holds a live `setTimeout` chain for its entire wait. 50 enqueued productions =
  50 concurrent 2 Hz timers.
- `capabilityRoute` (`inference-harness.mjs:12`) lives in the same module but is **not** part of leasing.

**Boot recovery already exists: `server.js:392`.**
```js
for(const pending of db.prepare("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at").all())
  void runJob(pending.id);
```
Queued jobs survive a restart and are re-driven in `created_at` order. Separately, `server.js:57` marks
`running|staging|validating|cancelling` as `failed` with stage `interrupted` — deliberately not resumed,
because a control-plane restart cannot safely re-adopt an in-flight worker.
**Durable resumability for a batch queue is therefore already built. What is missing is ordering.**

---

## 3. Route selection — what already exists

`runtime/inference-harness.mjs:12` — `capabilityRoute({ route, capabilities, hardware })`.
Returns `{route}` or `{route:'unsupported', reason, profile?}`:
- `hardware.profile.blockedRoutes` includes route -> `NO_DISCRETE_GPU` / `INSUFFICIENT_HARDWARE_PROFILE` (`:17`)
- `neural-video` without `capabilities['neural-video']` -> `NEURAL_VIDEO_MODEL_UNQUALIFIED` (`:20`)
- `image` without `capabilities.image` -> `IMAGE_MODEL_UNQUALIFIED` (`:21`)
- `vramGb < 4` and route !== `scene3d` -> `INSUFFICIENT_VRAM` (`:22`)

**Only caller: `runtime/director.mjs:63`**, once per shot, with
`hardware = {vramGb: VYRELUM_VRAM_GB || 6}` (`:60`). Rejections become
`routeDiagnostics[] = {shotId, requestedRoute, selectedRoute:'unsupported', reason}` (`director.mjs:65`)
and the shot gets `status:'blocked'` (`:66`).

**It routes on capability and VRAM. It has no notion of a time budget.** That is the single extension
point for requirement 3 — one new argument, one new rule, no new module.

---

## 4. SQLite project/revision schema

One statement, `server.js:30`. DB file `<dataDir>/vyrelum.sqlite`, WAL mode.
`dataDir` = `VYRELUM_DATA_DIR` or `<root>/data` (`server.js:26`); on desktop `%APPDATA%/vyrelum/data`.

```sql
projects           (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)

project_revisions  (project_id TEXT NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL,
                    created_at TEXT NOT NULL, PRIMARY KEY(project_id, revision))

assets             (id TEXT PRIMARY KEY, project_id TEXT, document TEXT NOT NULL, path TEXT NOT NULL,
                    created_at TEXT NOT NULL)

jobs               (id TEXT PRIMARY KEY, project_id TEXT, revision INTEGER, type TEXT NOT NULL,
                    status TEXT NOT NULL, progress REAL, stage TEXT, input TEXT, output TEXT,
                    error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
```

A second DB, `<GPU_ROOT>/gpu-lease.sqlite`, is used purely as a mutex (`inference-harness.mjs:31`) and
has no tables.

**Everything domain-shaped lives as JSON inside the `document` / `input` / `output` TEXT blobs.**
There is no formats table, no batch table, and **no migration system**.

Project-document fields observed (`server.js:379`, `:380`, `:161-175`; `automation-tools.mjs:91`):
`name, brief, mode, sampleId, productTemplate, productCamera, productAssetId, durationSeconds,
timeline[], scene, settings{width,height,fps}, assets[], latestOutput, latestAudio, latestSoundDesign,
transcript, transcriptSource, captionsEnabled, soundtrack, audioTracks[], script, scriptSource,
storyboard, storyboardSource, scenes, shots, operations, directorEvidence, hooks, hooksFormat,
hooksFormatLabel, hooksSource, hooksResearchBasis, hooksDisclaimer, importedHistory`.

`jobs.status` values in use: `queued, running, staging, validating, cancelling, cancelled, blocked,
failed, succeeded, review_required, rejected`.

**All project writes are revision-bumping and transactional:** `BEGIN IMMEDIATE` ->
`UPDATE projects` + `INSERT project_revisions` -> `COMMIT` (`server.js:176`, `:380`).
`PATCH /api/projects/:id` rejects any patch touching `id, revision, createdAt, updatedAt, latestOutput,
latestAudio, latestSoundDesign, transcriptSource, directorEvidence` — worker-owned fields
(`server.js:380`).

---

## 5. The fast route: product / asset-first FFmpeg composition

### `runtime/product-video.mjs` — the route to scale up

Exports:
- `PRODUCT_TEMPLATES` (`:8`) — frozen, 11 entries `{label, description, background}`
- `CAMERA_PRESETS` (`:23`) — frozen, 8 entries `{label, x, zoom}`
- `buildProductPlan({template, camera, durationSeconds, aspectRatio, productAssetId})` (`:65`)
- `buildProductFfmpegArgs(input, output, {width, height, fps, durationSeconds, camera, background})` (`:78`)
- `renderProductVideo({input, output, ffmpeg, ffprobe, template, camera, width, height, fps, durationSeconds, aspectRatio})` (`:106`)

**Existing presets, by exact key.**

`PRODUCT_TEMPLATES` (`product-video.mjs:9-20`):
`studio`, `lifestyle`, `with-model`, `ugc-faceless`, `ugc-talking-head`, `ugc-silent`,
`motion-2d`, `motion-mixed-media`, `360-orbit`, `unboxing`, `demo`

`CAMERA_PRESETS` (`product-video.mjs:24-31`), with their `x` / `zoom` values:
`static` (0, 1.00), `pan-right` (1, 1.10), `pan-left` (-1, 1.10), `dolly-in` (0, 1.16),
`crane-up` (0, 1.10), `hero-orbit` (1, 1.18), `handheld` (-1, 1.08), `crash-zoom` (0, 1.28)

The same 11 + 8 keys are hard-coded a second time in the UI `<select>` markup at `app.js:43`, and the
defaults `studio` / `dolly-in` a third time at `app.js:34`. **Three copies of one list.**

**Validation: `validateOptions` (`product-video.mjs:56`)** — the single guard, called by all three exports:
- template/camera must be own-properties of the frozen maps -> `PRODUCT_TEMPLATE_INVALID` / `PRODUCT_CAMERA_INVALID`
- `aspectRatio` in `['16:9','9:16','1:1','4:5']` -> `PRODUCT_ASPECT_RATIO_INVALID`
- width/height even, 64..4096, product <= 8,847,360 px -> `PRODUCT_RESOLUTION_INVALID`
- fps integer 12..60 -> `PRODUCT_FPS_INVALID`
- durationSeconds 3..60 -> `PRODUCT_DURATION_INVALID`

**Filtergraph (`:78-105`)** — two mutually exclusive branches on `assetKind(source)`:
- **image** (`:93`): `scale=W:H:force_original_aspect_ratio=increase,crop,zoompan=z/x/y:d=frames:s=WxH:fps`,
  plus `-an`. The `zoom`/`x`/`y` expressions derive from the preset's `x` and `zoom` and a `progress` term.
- **video** (`:97`): `scale=...decrease:force_divisible_by=2,pad=...:color=<background>,setsar=1,fps,format=yuv420p`,
  plus `-map 0:a:0? -c:a aac -b:a 160k`. Deliberately no synthetic motion on real footage.
- Encode is fixed: `libx264 -preset veryfast -crf 18 -profile:v high -pix_fmt yuv420p -movflags +faststart`.

**`buildProductPlan` returns a single-stage plan, not a beat list** (`:69-76`):
```json
{ "schemaVersion":1, "kind":"product-video-plan", "route":"local-asset-motion",
  "template":"...", "templateLabel":"...", "camera":"...", "cameraLabel":"...",
  "aspectRatio":"9:16", "durationSeconds":15, "productAssetId":null,
  "stages":["product asset","look and camera","captions/audio","local FFmpeg encode"],
  "limitations":["..."], "diagnostics":[] }
```
`stages` is a fixed 4-string pipeline description. **This is exactly where a format recipe's beat list belongs.**

### `runtime/asset-first-trailer.mjs` — the multi-shot FFmpeg route
`renderAssetFirstTrailer({output, ffmpeg, ffprobe, assetDir, width, height, fps, durationSeconds, captions, shots, sourceMethod})` (`:40`); also exports `SHOTS` and `rejectPlaceholder` (`:84`).
No named camera-preset table — motion alternates positionally on `index % 2` (`:24`).
Receipt at `:79`, `schemaVersion:1`.

### Where the fast route is entered
- `workers/produce.mjs:20-24` — `if (request.mode === 'product')` -> `renderProductVideo` -> `result.json` -> exit 0.
- `workers/produce.mjs:30-52` — cinematic asset-first branch -> `renderAssetFirstTrailer`.
- `workers/produce.mjs:54-66` — abstract -> Ollama director + Blender + `renderTimeline`.
- Server-side input assembly for `direct` and `produce` is `server.js:130-137`, which already reads
  `productTemplate`, `productCamera` and `productAssetPath` off the project document.

---

## 6. HTTP API routes

Served by `createServer` at `server.js:388`, bound to `127.0.0.1`, port `PORT || 4173`.
Origin must be loopback; every route except `/api/session` requires the `x-vyrelum-token` header or the
`vyrelum_token` cookie (`auth`, `server.js:95`).

| Method | Path | Line | Notes |
|---|---|---|---|
| GET | `/api/session` | 215 | issues the token; the only unauthenticated route |
| GET | `/api/state` | 216 | projects + assets + jobs + capabilities + hardware in one payload |
| GET | `/api/hardware` | 217 | `detectHardware()` |
| GET | `/api/runtime/status` | 218 | ComfyUI / enhancement / interpolation registration + generation preflight |
| POST | `/api/runtime/start` | 225 | `ensureManagedComfyUI()` |
| GET | `/api/providers` | 226 | provider inspect + model router + generation gate |
| GET | `/api/generation/preflight` | 227 | `preflightGeneration({root})` |
| POST | `/api/audio/voiceover` | 228 | creates job type `voiceover` |
| POST | `/api/audio/transcribe` | 228 | creates job type `transcribe` |
| POST | `/api/generation/review` | 239 | records operator verdict against the output hash |
| POST | `/api/audio/sound-design` | 252 | job type `sound-design` |
| POST | `/api/runtime/setup` | 263 | job type `runtime-setup`; global singleton guard |
| POST | `/api/video/interpolate` | 270 | job type `interpolate`; per-project singleton guard |
| POST | `/api/generation/enhance` | 301 | job type `enhance` |
| POST | `/api/generation/smoke-test` | 313 | job type `generation-test`; global singleton guard |
| POST | `/api/generation/shot` | 321 | job type `generation-shot`; per-project singleton guard |
| GET | `/api/releases` | 335 | |
| POST | `/api/releases` | 336 | hashed release package |
| POST | `/api/projects/import` | 346 | portable bundle, base64 media, <= 70 MB/asset |
| GET | `/api/projects/:id/export` | 372 | <= 50 MB/asset, <= 300 MB total |
| POST | `/api/projects` | 379 | |
| GET / PATCH | `/api/projects/:id` | 380 | PATCH is revision-checked; worker-owned fields rejected |
| POST / GET | `/api/jobs` | 381 | POST admits only `direct\|scene\|render\|produce` |
| GET | `/api/jobs/:id` | 382 | |
| POST | `/api/jobs/:id/cancel` | 382 | |
| POST | `/api/jobs/:id/retry` | 382 | only from `failed\|cancelled` |
| POST | `/api/assets` | 383 | raw body; `x-filename`, `x-project-id` headers |
| — | unknown `/api/*` | 386 | `404 {error:'Unknown route'}` |

Non-API: `/media/:assetId` -> `streamLocalMedia` with range support (`server.js:388`).

**Static serving is an allowlist of exactly four paths**:
`publicFiles = new Set(['/', '/index.html', '/app.js', '/styles.css'])` (`server.js:387`).
**A new client-side module file will 404 unless it is added to that Set.**

**Concurrency guards worth copying for a batch queue** — all the same shape, a
`SELECT id FROM jobs WHERE ... status IN ('queued','running','cancelling')` before insert:
`server.js:265` (runtime-setup, global), `:274` (interpolate, per project),
`:315` (generation-test, global), `:324` (generation-shot, per project).

---

## 7. Ollama director — the prompt -> scene-graph contract

`runtime/director.mjs`, 89 lines. Single export:
`createProduction({brief, projectId, revision, durationSeconds, fps, capabilities, signal, onProgress})` (`:31`).
It also runs as a CLI worker (`--input`/`--output`, `:77-89`) — which is why job type `direct` maps
straight to the module rather than to a `workers/` script.

- **Model: `qwen3:4b-instruct`**, overridable via `VYRELUM_DIRECTOR_MODEL` (`:5`).
- **Endpoint: `OLLAMA_HOST || http://127.0.0.1:11434`** (`:6`). Loopback enforced — non-loopback host,
  non-`http:` protocol, or embedded credentials -> `DIRECTOR_LOOPBACK_REQUIRED` (`:35`).
- Two calls: `GET /api/tags` (`:38`) and `POST /api/generate` (`:54`), both `redirect:'error'` and
  under `AbortSignal.timeout(180000)` (`:37`).
- Request body (`:52`): `{model, system, prompt, format:<JSON schema>, stream:false, think:false,
  keep_alive:0, options:{temperature:0.2, num_ctx:4096, num_predict:2600}}`. Structured output is
  enforced by `format` — the schema at `:9-10` requires `title, treatment, shots, scene`, where
  `shots` is 1..12 of `{prompt, durationFrames, camera, route, caption?}` and `scene` is `sceneSchema`
  imported from `runtime/scene-contract.mjs`.
- **Input bounds** (`:32`, `:36`): brief 1..4000 chars (`DIRECTOR_BRIEF_REQUIRED`), fps 1..60,
  durationSeconds 1..120 (`DIRECTOR_INPUT_BOUNDS`).
- **Post-model repair** (`validate`, `:23-30`, not exported): clamps to 12 shots; coerces unknown
  `route` to `scene3d` and unknown `camera` to `static`; slices prompts to 1200 chars; assigns
  `shot-01..` ids; rebalances durations to sum exactly to the total frame count.

**Output** (`:73`):
```json
{ "schemaVersion":1, "projectId":"...", "revision":1, "fps":24, "durationFrames":288,
  "title":"...", "treatment":"...", "scene":{...},
  "scenes":[{"id":"scene-01","title":"...","purpose":"...","shots":[...]}],
  "shots":[{"id","prompt","route","durationFrames","camera":{"type"},"caption","sceneId","startFrame","endFrame","capabilities","status?","diagnostic?"}],
  "operations":[{"type":"create_scene",...},{"type":"propose_shot",...}],
  "status":"ready"|"blocked",
  "timeline":[{"id","kind","duration","caption","startFrame","endFrame","status"}],
  "modelEvidence":{"runtime":"ollama","endpoint","model","digest","totalDurationNs","loadDurationNs","evalCount","routeDiagnostics":[],"wallMs","cacheHit?"} }
```

- **Plan cache:** `readPlanCache` / `writePlanCache` from `inference-harness.mjs` (`:46`, `:74`).
  Identity = `{runtime, endpoint, model, digest, schema, options, promptVersion:4}` (`:45`).
  **Bump `promptVersion` whenever the prompt or schema changes**, or stale plans will be served.
- **No fallback.** Ollama down -> the fetch rejects and propagates; model absent ->
  `DIRECTOR_MODEL_UNAVAILABLE`; non-2xx -> `DIRECTOR_RUNTIME_HTTP_<status>`; unparseable ->
  `DIRECTOR_INVALID_JSON`. Only a warm plan-cache key degrades gracefully.

`runtime/scene-contract.mjs` exports `sceneSchema` (`:10`) and `validateScene(raw, {frames, fps})` (`:16`),
which clamps ranges, dedupes ids, throws `SCENE_*` codes, and silently repairs a motionless scene by
injecting keyframes (`:26-30`). It returns `render:{width:640,height:360,fps,frames}` hard-coded at `:31`;
`workers/produce.mjs:63` overrides width/height immediately afterwards.

---

## 8. ComfyUI / Wan2.2 adapter — the slow route

**Contract:** `runtime/providers/provider-contract.mjs` — `PROVIDER_METHODS` (`:6-11`) is a 14-method
interface (`health_check, capabilities, install_instructions, estimate_resources, generate_image,
generate_video, animate_image, transcribe, synthesize_speech, animate_avatar, upscale, interpolate,
cancel, retrieve_result`). `assertProvider` throws `INVALID_PROVIDER` listing missing methods (`:22`).
`runtime/providers/registry.mjs:4` — `createProviderRegistry({providers, ...})` always registers
ComfyUI first (`:7`) and exposes `{register, get, list, inspect}`.

**Adapter:** `runtime/providers/comfyui.mjs` — `class ComfyUIProvider` (`:32`),
`createComfyUIProvider(options)` (`:165`). `id='comfyui-local'`; base URL
`VYRELUM_COMFYUI_URL || http://127.0.0.1:8188` (`:33-39`); loopback enforced (`:9-14`).

**How a neural shot is requested** — `generate_video(request)` (`:135`) -> `_submit` (`:125`):
```js
{ workflow,            // ComfyUI prompt graph object, required -> INVALID_WORKFLOW
  requiredNodes: [],   // class_types that must exist -> WORKFLOW_REQUIREMENTS_MISSING
  requiredModels: [],  // model filenames that must be installed
  width, height, frames, batch, diskNeedGb,
  allowResourceWarnings,   // false -> RESOURCE_PREFLIGHT_FAILED on any warning
  clientId }
```
POSTs `{prompt: workflow, client_id}` to `/prompt`.

**What it returns** (`:131`):
```json
{ "provider":"comfyui-local", "operation":"generate_video", "status":"queued",
  "promptId":"...", "clientId":"...",
  "resources":{"width","height","frames","batch","estimatedVramGb","availableVramGb",
               "diskNeedGb","availableDiskGb","warnings":[],"safe":true} }
```
The result is fetched separately: `retrieve_result(promptId)` -> `/history/{id}` ->
`{provider, promptId, status:'completed'|'running'|'failed', outputs, error}` (`:142`).
`cancel(promptId)` (`:151`) checks `/queue` first and only `/interrupt`s when that prompt is the
running one — otherwise it deletes from the queue.

**Orchestration:** `runtime/neural-production.mjs`. Exports `WAN_MODELS` (`:13`), `SMOKE_PROMPT` (`:14`),
`wanWorkflow(...)` (`:17`), `ensureWanInput(...)` (`:57`), `executeWanStage(...)` (`:106`),
`produceNeuralSmoke(...)` (`:185`).
- Models (`:13`): `Wan2.2-TI2V-5B-Q4_K_M.gguf`, `umt5-xxl-encoder-Q4_K_S.gguf`,
  `wan2.2_vae.safetensors` — duplicated as `NEURAL_MODEL_IDS` at `generation-gate.mjs:8`.
- Workflow: an 11-node string-keyed graph (`:20-34`) using `Wan22ImageToVideoLatent` + `KSampler`
  (`uni_pc` / `simple`, cfg 5). Hard bounds at `:19`: `frames in {1,33,61,121}`, `steps 1..30`,
  `width%32===0`, `height%32===0`, `width*height <= 1024*576`.
- Two stages, keyframe (frames=1) then motion, each resumable through `executeWanStage` with
  `provider.jsonl`, `history.json`, a SHA-256 `frames.json` ledger, and a `generation-checkpoint.json`
  input-identity guard (`JOB_INPUT_CHANGED`). Refuses to enqueue while ComfyUI's queue is non-empty ->
  `PROVIDER_BUSY` (`:123`). Default stage timeout 7,200,000 ms.
- Returns a `schemaVersion:2` receipt (`:223`) — see §10.

`runtime/managed-comfyui.mjs:15` — `ensureManagedComfyUI` verifies `comfyui.json` and
`installation.json` (SHA-256 for code, size+mtime for models), then spawns ComfyUI with a hardened
offline arg set (`:8`) including `--lowvram --cache-none --disable-all-custom-nodes
--whitelist-custom-nodes ComfyUI-GGUF`. `stopManagedComfyUI` (`:63`) is called before `interpolate` and
before `generation-*` jobs (`server.js:112`, `:116`) to free VRAM.

`workers/neural.mjs` is a 14-line wrapper. Note `:9`: it forwards `reference, prompt, seed, steps,
frames` but **not** `width`, `height` or `fps`, so those stay pinned to the 1024x576 / 24 defaults.

---

## 9. Captions, Whisper and Piper audio

**The real implementation is Python: `workers/audio-local.py`** (37 lines), spawned by
`workers/audio.mjs:9` through `config.python` (a private venv interpreter — not a whisper.cpp or piper
CLI binary), with `HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1` forced and a 600 s kill timer
(`audio.mjs:11`). Every model file is SHA-256 checked before use ->
`LOCAL_AUDIO_MODEL_INTEGRITY_FAILED` (`audio-local.py:8`).

- **Voiceover / Piper** (`audio-local.py:12-23`): `from piper import PiperVoice, SynthesisConfig`,
  `use_cuda=False`, `SynthesisConfig(length_scale=1.05, noise_scale=0.5, noise_w_scale=0.7)`.
  Model `en_US-ljspeech-high`. Writes `narration.wav`. Provenance `providerId:'piper-local-cpu'`,
  plus `modelHash`, `outputHash`, `sampleRate`, `renderTimeMs`. Diagnostic `VOICE_REVIEW_REQUIRED`.
- **Transcribe / Whisper** (`:24-35`): `from faster_whisper import WhisperModel`, `device='cpu'`,
  `compute_type='int8'`, `cpu_threads=4`, `beam_size=3`, `word_timestamps=True`, `language='en'`,
  `local_files_only=True`. Model `tiny.en`. Writes `captions.srt` and returns `segments[]` of
  `{id,start,end,text,words:[{start,end,word,probability}]}`. Provenance
  `providerId:'faster-whisper-local-cpu'`. Diagnostic `TRANSCRIPT_REVIEW_REQUIRED`; empty ->
  `NO_SPEECH_DETECTED`.
- Both write `audio-evidence.json` **and** `result.json` with the same body, `status:'review_required'`.

Model paths are registered by `scripts/install-audio-models.py:74` into
`audio.json = {schemaVersion:1, python, voice:<root>/piper/en_US-ljspeech-high.onnx,
whisper:<root>/whisper-tiny.en, files:[{path,sha256}]}`.
`POST /api/audio/*` returns `409 LOCAL_AUDIO_UNAVAILABLE` when `audio.json` is absent (`server.js:236`).
Pinned versions: `piper-tts==1.8.0`, `faster-whisper==1.2.1`
(`runtime/audio-requirements-windows.lock.txt:21`, `:7`).

**Caption timing (pure JS, no binary):** `runtime/timed-captions.mjs:2` —
`prepareTimedCaptions(segments, duration)`. Validates monotonic non-overlapping segments (<= 3000),
wraps at 42 chars/line, pages at 2 lines, and returns `[{start, end, text}]` where `text` may contain
an embedded `\n`. Called from `PATCH /api/projects/:id` whenever `transcript` is patched
(`server.js:380`) and from `workers/timeline.mjs:58`.

**Procedural sound (no model):** `runtime/sound-design.mjs:2` —
`synthesizeSoundDesign({durationSeconds, seed=713, footsteps[], shelterAt, climaxAt})`. Hand-written
LCG noise, one-pole lowpass rain bed, per-footstep thud/splash, peak limiter at 0.85; 48 kHz stereo
16-bit with a hand-assembled WAV header. Returns `{wave: Buffer, evidence:{sourceMethod:
'local-procedural-sound-design', neuralModelInvoked:false, preset:'rain-tension-v1', ...}}`.

**Stale config worth knowing:** `capabilities/registry.mjs:58` and `runtime/model-router.mjs:18-19`
still probe `data/models/whisper` and `data/models/piper`, which is **not** where
`install-audio-models.py:74` installs them.

---

## 10. Evidence-JSON conventions

**Only two `schemaVersion` literals exist in source: `1` and `2`.** Version 1 is used everywhere except
the two neural receipts.

| Producer | Version | file:line |
|---|---|---|
| director plan | 1 | `runtime/director.mjs:73` |
| product plan | 1 | `runtime/product-video.mjs:70` |
| asset-first trailer receipt | 1 | `runtime/asset-first-trailer.mjs:79` |
| quality-inspection receipt | 1 | `runtime/quality-inspection.mjs:62` |
| interpolation receipt | 1 | `runtime/frame-interpolation.mjs:196` |
| capability results | 1 | `capabilities/registry.mjs:79,99,104,108,115,120` |
| provider-inspection report | 1 | `runtime/generation-gate.mjs:121` |
| hardware profile | 1 | `runtime/hardware-profile.mjs:116` |
| release records | 1 | `publishing/index.js:141` (typed as the literal in `publishing/index.d.ts:11`) |
| project export bundle | 1 | `server.js:377` (also `schema:'vyrelum.project'`) |
| worker request envelopes | 1 | `server.js:138,139`; `workers/produce.mjs:63,66` |
| runtime lock/config files | 1 | `managed-comfyui.mjs:23,27`; `onboarding.mjs:10,29`; `interpolation-setup.mjs:31`; `setup-local-video.mjs:19` |
| **neural production receipt** | **2** | `runtime/neural-production.mjs:223` |
| **neural enhancement receipt** | **2** | `runtime/neural-enhancement.mjs:52` |

**Caution:** every `schemaVersion` *validator* in the tree checks `=== 1`
(`workers/render.mjs:3`, `workers/timeline.mjs:26`, `onboarding.mjs:10`, `director.mjs:47`,
`managed-comfyui.mjs:23,27`, `setup-local-video.mjs:19`). Nothing validates `=== 2`. A v2 receipt
handed to any of those readers is rejected. **New features should emit `schemaVersion: 1`.**

**Worker `result.json` contract** — what `server.js:159-180` actually reads:
```json
{ "schemaVersion": 1,
  "status": "verified" | "review_required" | "blocked" | "rejected",
  "validated": true,
  "durationSeconds": 15,
  "outputs": { "video":"...", "sourceVideo":"...", "poster":"...", "blend":"...", "glb":"...",
               "captions":"...", "quality":"...", "audio":"..." },
  "provenance": { "generationStatus":"generated|imported|edited|upscaled|fallback|blocked", "...":"..." },
  "verification": { "ok": true, "checks": [], "diagnostics": [] },
  "diagnostics": [ { "code":"...", "message":"..." } ] }
```
Hard rules enforced by the server:
- `outputs` keys are **allowlisted** to exactly `video, sourceVideo, poster, blend, glb, captions,
  quality, audio`, and each value must be a bare basename (`server.js:163`). Anything else is silently
  dropped and never promoted to an asset row.
- `validated===false` or `status==='blocked'` routes to the blocked branch (`server.js:161`, `:178`).
- `status==='review_required'` becomes the terminal job status and requires
  `POST /api/generation/review` before the output counts as reviewed (`server.js:177`).
- A `generationStatus` outside the six allowed values gets the project force-blocked with
  `MISSING_PROVENANCE` at boot (`server.js:74-82`).

**Generation provenance** — `runtime/generation-gate.mjs:149`, `recordGeneratedProvenance(...)`:
```json
{ "status":"generated", "providerId":"comfyui-local", "modelId":"...", "workflowHash":"...",
  "seed":7092026, "prompt":"...", "outputPath":"<job-relative>", "outputHash":"<sha256>",
  "durationSeconds":5, "resolution":{"width":1024,"height":576}, "fps":24,
  "vramPeakGb":5.849, "renderTimeMs":1413336, "providerPromptId":"...",
  "evidenceHash":"...", "frameCount":120, "lineage":[{"index","rgbRmse","threshold"}] }
```
Failure returns `{status:'blocked', code, message}`. Canonical hashing is `hashJson` (`:144`) —
recursively key-sorted JSON, SHA-256.

`runtime/generation-evidence.mjs:12` — `verifyGenerationEvidence(o)` is a read-only verifier (it writes
nothing and carries no `schemaVersion`). It requires `providerEvidence = {promptId, logPath,
historyPath, framesPath, stageRoot}`, confirms every provider file resolves *inside* the job directory
(`GENERATED_OUTPUT_OUTSIDE_JOB`), that the recorded workflow hash equals the submitted graph
(`PROVIDER_WORKFLOW_MISMATCH`), and that the frame ledger matches ComfyUI history
(`PROVIDER_FRAME_COUNT`). Returns `{ok:true, frameCount, lineage, evidenceHash}` or
`{ok:false, code, message}`.

**Evidence is written to disk under `<dataDir>/jobs/<jobId>/`** (`server.js:26`):
per stage (`keyframe` / `motion`) — `workflow.json`, `provider.jsonl`, `history.json`, `frames.json`,
`frames/%05d.png`, `latents.json`; per job — `request.json`, `generated-source.mp4`, `contact-sheet.png`,
`delivery-1080p.mp4`, `verification.json`, `result.json`, and `visual-review.json` after an operator
verdict (`server.js:246`).

**Automation/MCP receipt** — `runtime/automation-tools.mjs:73`:
```json
{ "status":"succeeded|failed|blocked|partial|<job status>",
  "outputPaths": [], "metadata": {}, "diagnostics": [{"code":"...","message":"..."}],
  "reproducibility": {"tool","adapterVersion":"automation-v1.1","inputHash","projectId","revision"},
  "verification": {"status":"passed|failed|not-run","kind":"..."} }
```

---

## 11. The existing format-aware hook planner

**`TASKS.md:17`:**
> "Added format-aware original hook planning for recurring characters, hybrid augmentation,
> transformation loops, what-if documentaries, micro-horror, product proof and rights-cleared
> commentary. The planner records the selected format, research basis and non-guarantee disclaimer in
> the project revision. See `docs/VIRAL_FORMATS_RESEARCH_2026-09-07.md`."

**`README.md:58`:** "Format-aware viral hooks are available through the MCP `generate_hooks` tool and
are stored with the selected project revision." Also `README.md:21` and `TASKS.md:22` (the packaged
build "must include the format-aware hook planner and its tests").

**There is no symbol named `hookPlanner`, `planHook` or `hookPattern` anywhere.** The planner is a
static template table plus a regex classifier, in **`runtime/viral-formats.mjs` (98 lines)** — and this
is the seed of the format library.

| Piece | file:line | Shape |
|---|---|---|
| Format table | `runtime/viral-formats.mjs:7-64` | `export const VIRAL_FORMATS`, frozen, **7** keys. Entry schema is only `{label: string, hooks: string[3]}` with `{brief}` placeholders. |
| Brief sanitizer | `:68-72` | `cleanBrief(value)` (not exported) — collapses whitespace, `TypeError` on empty, truncates to 240 chars |
| Classifier | `:74-83` | `export function inferViralFormat(brief)` — 6 ordered regex tests over the lowercased brief, default `recurring-character` |
| Planner | `:85-98` | `export function buildViralHooks({brief, format})` — `RangeError` on unknown format |
| MCP schema | `runtime/automation-tools.mjs:15, 24` | `viralFormat = {enum: Object.keys(VIRAL_FORMATS)}`; `tool('generate_hooks', ..., object({projectId, expectedRevision, format: viralFormat}, ['projectId','expectedRevision']))` |
| Dispatch | `runtime/automation-tools.mjs:91` | calls `buildViralHooks({brief, format})` where `brief = value.brief \|\| value.name`, then `save({hooks, hooksFormat, hooksFormatLabel, hooksSource, hooksResearchBasis, hooksDisclaimer})` |

Keys (`:8-56`): `recurring-character`, `hybrid-augmentation`, `transformation-loop`,
`what-if-documentary`, `micro-horror`, `product-proof`, `commentary-remix`.

**What it currently generates** (`:90-97`) — three interpolated strings plus four constant metadata fields:
```json
{ "format":"micro-horror",
  "formatLabel":"Micro-horror or emotional twist",
  "hooks":["Everything is normal in <brief> — until the sound stops.", "...", "..."],
  "source":"deterministic-local-format-template",
  "researchBasis":"YouTube Shorts hook guidance; original narrative and recurring-character case studies",
  "disclaimer":"A hook is a creative hypothesis; virality is not guaranteed." }
```

**Research backing:** `docs/VIRAL_FORMATS_RESEARCH_2026-09-07.md`. Its taxonomy table (`:62-70`) has
four columns — `Format | Hook and story shape | Local production recipe | Main failure gate` — and its
7 rows map 1:1 onto the `VIRAL_FORMATS` keys. **Two structures in that doc are specified but not
implemented anywhere:**
- A **5-beat time grid** (`:77-84`) for a 20 s short: `Hook 0.00–0.01`, `Context 0.01–0.04`,
  `Escalation 0.04–0.12`, `Payoff 0.12–0.18`, `Exit 0.18–0.20`, with `:86-90` requiring it to scale to
  the requested duration.
- **Typed per-shot prompt fields** (`:97-109`): `subject`, `identityReference`, `environment`, `action`,
  `camera{shot,lens,movement}`, `lighting`, `continuity[]`, `audio[]`, `negativeChecks[]`.
  `runtime/neural-production.mjs` still passes a single `prompt` string.

**Gaps vs. the requested library.** A `VIRAL_FORMATS` entry has `label` + `hooks` only — **no aspect
ratio, beat list, timings, caption style, audio bed, shot count, or render route.** There is no
`runtime/viral-formats.test.mjs`; coverage is indirect, through `runtime/automation-tools.test.mjs`
(two of its eight tests). `runtime/viral-formats.mjs` is also **not** in the `node --check` list.
There is no UI surface — `app.js` and `server.js` contain zero hook references, so it is
MCP/`dispatchTool`-only.

---

## 12. What `npm test` actually runs

`package.json:18`, one long `&&` chain in three phases.

**Phase 1 — 32 `node --check` syntax checks.** All 32 referenced files exist (verified).
`app.js, engine.js, server.js, workers/{render,timeline,produce,neural,enhance,audio}.mjs,
runtime/{director,scene-contract,inference-harness,hardware-profile,generation-gate,generation-evidence,
neural-production,neural-enhancement,managed-comfyui,doctor,upscale-4k,seed-demo-catalog,
automation-tools,model-router,onboarding}.mjs, mcp-server.mjs, cli.mjs, capabilities/registry.mjs,
runtime/providers/{provider-contract,comfyui,registry}.mjs, desktop/main.mjs, desktop/preload.cjs`

Not syntax-checked (notable omissions): `runtime/viral-formats.mjs`, `runtime/product-video.mjs`,
`runtime/asset-first-trailer.mjs`, `runtime/quality-inspection.mjs`, `runtime/media-verifier.mjs`,
`runtime/timed-captions.mjs`, `runtime/sound-design.mjs`, `runtime/frame-interpolation.mjs`,
`runtime/interpolation-setup.mjs`, `runtime/media-stream.mjs`, `runtime/engine-ownership.mjs`,
`runtime/verified-download.mjs`, `runtime/setup-local-video.mjs`, `publishing/index.js`,
`workers/{sound-design,interpolate,runtime-setup}.mjs`.

**Phase 2 — 6 standalone `node <file>` assertion scripts:**

| File | Covers |
|---|---|
| `engine.test.mjs` | browser engine: create/read, job completion, export/import round-trip |
| `publishing/publishing.test.mjs` | release state machine; `STALE_PUBLISH_AT`, `WRONG_CHANNEL`, `UNVERIFIED_API_PROJECT` |
| `capabilities/registry.test.mjs` | manifest `schemaVersion===1`, exactly 9 capabilities, adapter outputs |
| `runtime/onboarding.test.mjs` | verified artifact download, sha256 match |
| `runtime/inference-harness.test.mjs` | **GPU lease**: 8 concurrent contenders -> `GPU_LEASE_BUSY`; live lease never expires; OS frees lock on kill; plan-cache atomicity |
| `runtime/hardware-profile.test.mjs` | `classifyHardware` tiers; `INSUFFICIENT_HARDWARE_PROFILE` at 6 GB |

**Phase 3 — `node --test` with 17 files, then a second `node --test` for 1 more:**
`workers/timeline.test.mjs`, `runtime/media-verifier.test.mjs`, `runtime/providers/comfyui.test.mjs`,
`runtime/upscale-4k.test.mjs`, `runtime/asset-first-trailer.test.mjs`, `runtime/product-video.test.mjs`,
`runtime/quality-inspection.test.mjs`, `runtime/automation-tools.test.mjs`, `runtime/model-router.test.mjs`,
`runtime/generation-gate.test.mjs`, **`runtime/generation-evidence.test.mjs`**,
`runtime/neural-production.test.mjs`, `runtime/timed-captions.test.mjs`, `runtime/engine-ownership.test.mjs`,
`runtime/sound-design.test.mjs`, `runtime/verified-download.test.mjs`, `runtime/setup-local-video.test.mjs`
— then `runtime/frame-interpolation.test.mjs`.

**24 test files are referenced; 23 exist. `runtime/generation-evidence.test.mjs` is not on disk.**

**Measured, not assumed:** on Node v24.12.0, `node --test a.test.mjs MISSING.test.mjs b.test.mjs`
exits **0** and runs both real suites — the missing file is silently ignored:
```
✔ A (0.6405ms)
✔ B (0.6641ms)
ℹ tests 2   ℹ pass 2   ℹ fail 0
EXIT=0
```
So `npm test` is **not** red and does **not** abort at that point. It quietly runs one fewer suite than
the script claims. (A parallel reading of this tree concluded the chain aborts there; the direct
experiment above refutes that.)

**Playwright is not part of `npm test`.** `tests/local-engine-golden.spec.mjs` runs via
`npx playwright test` against `VYREALM_TEST_URL || http://127.0.0.1:4174` (`playwright.config.mjs`,
`testMatch:'local-engine-golden.spec.mjs'`). `tests/emberforge-golden.spec.ts` also exists but is
excluded by that `testMatch` and appears superseded.

Two unrelated smells noticed in passing: `workers/render.mjs:4` hard-codes a fallback ffmpeg path into
an unrelated `2026-08-20` project directory, and `runtime/upscale-4k.mjs:44` reads `FFMPEG`/`FFPROBE`
while every other module uses `VYRELUM_FFMPEG`/`VYRELUM_FFPROBE`.

---

# Minimum-diff insertion plan

The house pattern in this codebase is: **a frozen map + a `validate*` guard + a `schemaVersion:1` plan
object, consumed by an existing worker branch.** All three features fit that shape. None of them needs
a new table, a new worker, a new job type, or a new abstraction layer.

## Feature 1 — Format/template library (100+ typed recipes)

**Extend `runtime/viral-formats.mjs` in place. Do not create a parallel module.** It already owns the
vocabulary, already feeds the MCP enum, and is already documented in `README.md` and `TASKS.md`.

1. **Widen the entry schema at `runtime/viral-formats.mjs:7`.** Keep `label` and `hooks` so
   `buildViralHooks` and the seven existing keys keep working untouched; add the typed fields:
   ```
   { label, hooks: [3],
     aspectRatio: '16:9'|'9:16'|'1:1'|'4:5',   // reuse product-video's exact 4-value vocabulary
     shotCount: int,
     beats: [{ id, label, startFraction, endFraction, intent }],
     captionStyle: <enum>,
     audioBed: <enum>,
     route: 'product'|'asset-first'|'scene3d'|'neural-video',
     camera: <key of CAMERA_PRESETS>,
     template: <key of PRODUCT_TEMPLATES>,     // when route === 'product'
     keywords: [] }
   ```
   Use **fractions, not seconds**, so one recipe serves any duration in the 3–60 s range. Seed the
   default beat grid from `docs/VIRAL_FORMATS_RESEARCH_2026-09-07.md:77-84`
   (Hook / Context / Escalation / Payoff / Exit) rather than inventing one.
2. **Add `validateViralFormat(entry)` and run every entry through it at module load**, mirroring
   `product-video.mjs:56`. Cross-check `camera` against `CAMERA_PRESETS` and `template` against
   `PRODUCT_TEMPLATES` **by import**, so the three duplicate preset lists cannot drift further. Throw
   `VIRAL_FORMAT_INVALID_*` codes to match the existing `PRODUCT_*_INVALID` style.
3. **Add `selectFormat(brief, {format})`** beside `inferViralFormat` (`:74`). The current 6-regex chain
   will not scale to 100+ entries — replace the body with a scored keyword match over the new
   `keywords` field, and keep `inferViralFormat` as a thin wrapper so nothing downstream breaks.
4. **Add `buildFormatPlan({format, brief, durationSeconds, fps})`** returning
   `{schemaVersion:1, kind:'format-plan', format, formatLabel, aspectRatio, route, beats:[{id,label,
   start,duration,intent}], shotCount, captionStyle, audioBed, camera, template, hooks, source,
   researchBasis, disclaimer, limitations, diagnostics}`. Mirror `buildProductPlan`
   (`product-video.mjs:65`) field for field — same `schemaVersion`, same `diagnostics` array, same
   `limitations` honesty note. Emit `schemaVersion: 1`, never 2 (see §10).
5. **New file — the only one strictly needed: `runtime/viral-formats.test.mjs`.** Assert every entry
   validates, every `camera`/`template` key resolves against the frozen maps, beat fractions are
   ordered and cover 0..1, and `buildFormatPlan` beat durations sum to `durationSeconds`.
   Then add it to the `node --test` list **and** add `runtime/viral-formats.mjs` to the `node --check`
   list in `package.json:18` — `TASKS.md:22` explicitly requires the packaged build to carry
   "the format-aware hook planner and its tests".

**Touch `runtime/automation-tools.mjs` minimally:** `viralFormat` (`:15`) is already
`Object.keys(VIRAL_FORMATS)`, so the `generate_hooks` tool schema widens for free as entries are added.
Either add one field to the `generate_hooks` save at `:91` (`hooksPlan: buildFormatPlan(...)`) or add a
sibling `plan_format` tool via one `tool(...)` line near `:24`.

**Do NOT touch:** `buildViralHooks`'s return shape, the six `hooks*` project-document field names, or
the seven existing format keys — `README.md`, `TASKS.md` and stored project revisions all reference them.

## Feature 2 — Batch production queue

**The durable substrate already exists. Do not add a table or a job type.** `jobs` already has
`status`, `attempts` and `created_at`; `server.js:392` already re-drives every `queued` job on boot in
`created_at` order; `POST /api/jobs/:id/retry` already exists; per-item evidence is already one
`result.json` per job directory.

The one real gap is **ordering** — `server.js:100` busy-polls with no fairness.

1. **Replace the busy-poll with a FIFO drain in `server.js`.** Add a module-level `const waiting=[]`
   beside `let gpuLease=null` (`server.js:32`). At `:100`, instead of
   `setTimeout(()=>void runJob(id),500)`, push `id` onto `waiting` and return. In the child `exit`
   handler where `gpuLease=null` is set (`server.js:158`), shift the next id and call `runJob`.
   Keep a timer for the `GPU_LEASE_BUSY` branch at `:104` — that lock is held by *another process*, so
   a queue-local shift cannot wake it. Roughly a 6-line diff; removes N concurrent timers and makes
   order deterministic.
2. **Batch enqueue: extend `POST /api/jobs` at `server.js:381`.** Do not add a route. Accept an
   optional `items: [{projectId, type, format, ...}]` (cap it — the existing `array()` helper in
   `automation-tools.mjs:13` caps at 64), insert N rows inside one `BEGIN IMMEDIATE` transaction, then
   `void runJob(id)` for each. Put a `batchId` in the existing `input` JSON blob — no schema change,
   and `jdoc` (`server.js:94`) already spreads `input` into the job response, so `batchId` surfaces on
   `GET /api/jobs` for free.
3. **Batch status needs no new storage:**
   `SELECT * FROM jobs WHERE json_extract(input,'$.batchId')=?`.
4. **MCP surface:** one `tool('queue_batch', ...)` line near `runtime/automation-tools.mjs:30` plus one
   dispatch branch, following the `generate_production_plan` pattern at `:93` exactly — POST to
   `/api/jobs`, set `receipt.status = job.status`, `receipt.metadata = {job, nextTool:'inspect_job'}`.

**Do NOT touch:** `acquireGpuLease` (`inference-harness.mjs:28`) — its crash-safety comes from the OS
lock and it is well covered by `runtime/inference-harness.test.mjs`; the `server.js:57` interrupted-job
policy; the per-type singleton guards at `server.js:265, 274, 315, 324`. A batch of `produce` jobs is
unaffected by those guards, which is exactly why `produce` is the right batch unit.

## Feature 3 — Time-budget route selector

**Extend `capabilityRoute` in `runtime/inference-harness.mjs:12`.** It is already the single route gate
and has exactly one caller, so the blast radius is two files.

1. **Add two optional args:**
   `capabilityRoute({route, capabilities, hardware, timeBudgetSeconds, estimatedSeconds})`.
   After the existing VRAM rule (`:22`), add one rule: if `route==='neural-video'` and
   `estimatedSeconds > timeBudgetSeconds`, return
   `{route:'scene3d', reason:'TIME_BUDGET_EXCEEDED', downgradedFrom:'neural-video'}`.
   Return a **downgrade**, not `'unsupported'` — the existing caller already treats a non-matching
   route as a diagnostic and will surface it with no further change.
2. **Cost table:** add a frozen `ROUTE_COST_SECONDS` map in the same module. Seed it from the measured
   numbers already recorded in `TASKS.md:8` (1,838.020 / 1,716.804 / 1,413.336 s per 5-second Wan shot;
   1,077.676 s for a 5-second Real-ESRGAN pass) rather than inventing figures, and leave it
   env-overridable so it stays calibratable on other hardware.
3. **Caller: `runtime/director.mjs:63`** — pass the two new fields through. `routeDiagnostics` (`:65`)
   already carries `{shotId, requestedRoute, selectedRoute, reason}`, so downgrades are recorded in
   `modelEvidence` and land in the project document as `directorEvidence` with no extra plumbing.
   **Bump `promptVersion` at `director.mjs:45` if the prompt changes**, or cached plans will mask the
   new routing.
4. **Plumb the budget in at `server.js:130-137`**, which already assembles the `direct`/`produce`
   worker input from the project document — add `timeBudgetSeconds` the same way `productCamera` is read.

**Do NOT touch:** the `ROUTES` set at `director.mjs:7` (no new route is needed — this selects among
existing ones); `produceNeuralSmoke`'s bounds at `neural-production.mjs:19`; the provider contract.

## Global do-not-touch list

- `runtime/inference-harness.mjs:28-58` (`acquireGpuLease`) — crash-safe by construction.
- `server.js:30` schema DDL — additive JSON in the `document`/`input` blobs only. There is no
  migration system, so a column add would require writing one.
- `server.js:57` interrupted-job policy and `server.js:64-86` legacy-provenance backfill.
- `server.js:163` `outputs` key allowlist and `server.js:74-82` `generationStatus` allowlist —
  widening either silently changes what counts as trusted media.
- `runtime/generation-evidence.mjs` and `recordGeneratedProvenance` — the honesty spine.
- The worker-owned-field rejection list in `PATCH /api/projects/:id` (`server.js:380`).
- The seven existing `VIRAL_FORMATS` keys and the six `hooks*` document fields.
- `runtime/product-video.mjs:93` / `:97` — the image-vs-video filtergraph split. The comments at `:91`
  and `:95` explain why footage must never receive `zoompan` (`d=N` would hold every source frame N
  times). That is a correctness boundary, not a style choice.

## Three cheap fixes worth folding in

1. `package.json:18` references `runtime/generation-evidence.test.mjs`, which does not exist. Node 24
   silently skips it, so the gap is invisible in a green run. Create the file or drop the reference.
2. `runtime/viral-formats.mjs` is absent from the `node --check` list — add it when extending it.
3. The 11 product templates and 8 camera presets are duplicated in three places
   (`runtime/product-video.mjs:9-31`, the `<select>` markup at `app.js:43`, the defaults at `app.js:34`).
   A format library that references preset keys makes this drift dangerous. Serving the lists from
   `GET /api/state` — which already returns `capabilityCatalogue` — would collapse it. Note that adding
   a **new client file** requires adding its path to the `publicFiles` allowlist at `server.js:387`, so
   prefer extending `app.js` over creating a new module.
