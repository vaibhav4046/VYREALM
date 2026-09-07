# VYRELUM production audit

Audit date: 2026-09-06. This is evidence from the current checkout. `UNTESTED` means implemented but not exercised; it is not a capability claim.

## Repository and runtime

This workspace has no `.git` directory, so Git history, remotes, submodules, and branch state are unavailable here. The executable surface is the Electron shell (`desktop/main.mjs`), local control plane (`server.js`), browser UI (`app.js`), and workers under `workers/` and `runtime/`. SQLite is the canonical store: development uses `data/vyrelum.sqlite`; packaged builds use the per-user application data directory (`server.js:15-18`, `desktop/main.mjs:66-80`).

## Journey matrix

| Control | Frontend | API | Worker | Store/artifact | Result |
|---|---|---|---|---|---|
| New project | `app.js:createProject` | `POST /api/projects` | n/a | SQLite project row | WORKING_REAL |
| Import media | `app.js:uploadAsset` | `POST /api/assets` | n/a | SQLite asset + media file | WORKING_REAL |
| Director plan | `app.js:queueJob('direct')` | `POST /api/jobs` | `runtime/director.mjs` | revision, scenes, shots, operations | WORKING_REAL with Ollama model |
| One-prompt produce | `app.js:queueJob('produce')` | `POST /api/jobs` | `workers/produce.mjs` + Blender + FFmpeg | editable `.blend`, MP4, SRT, poster, timeline | WORKING_REAL with Ollama model |
| 3D scene | `app.js:queueJob('scene')` | `POST /api/jobs` | `workers/render.mjs` + Blender | MP4, `.blend`, poster | WORKING_REAL on verified Windows host |
| Project render | `app.js:queueJob('render')` | `POST /api/jobs` | `workers/render.mjs` + FFmpeg | promoted MP4 | WORKING_REAL on verified Windows host |
| Timeline edit | clip/scene fields + save | `PATCH /api/projects/:id` | `workers/timeline.mjs` | trim/order/caption/audio rerender with cache | WORKING_REAL on verified Windows host |
| Cancel / retry | job controls | `POST /api/jobs/:id/cancel` or `/retry` | process-tree termination / requeue | job status, no partial promotion | WORKING_REAL |
| Save / reopen | project refresh/open | `GET /api/projects/:id` | n/a | SQLite document + revision history | WORKING_REAL |
| Export portable | `app.js:exportProject` | `GET /api/projects/:id/export` | n/a | JSON project bundle | WORKING_REAL; external source paths need packaging |
| Release package | `app.js:createRelease` | `POST /api/releases` | release validation | `releases.json`, output hash | WORKING_REAL; publication is explicit |
| Captions / cut list / audio graph | internal capability registry | `executeCapability` | typed local adapters | deterministic JSON graph | WORKING_DETERMINISTIC |
| Neural video / image | director route gate | capability routing | no qualified checkpoint | precise `modelEvidence` diagnostic | BLOCKED / truthful |

## Safety and reliability evidence

`capabilities/manifest.json` defines typed inputs/outputs, executable adapters, dependency checks, acceptance text, and attribution. `runtime/inference-harness.mjs` provides SQLite-backed GPU exclusion, crash-safe child registration, model/version-aware SHA-256 plan caching, and atomic cache publication. The director records route downgrades rather than claiming unavailable neural generation (`runtime/director.mjs:41-54`). Electron runs the sidecar itself, uses context isolation and sandboxing, restricts child environment, blocks non-loopback navigation, and the HTTP server exposes only an explicit static-file allowlist (`desktop/main.mjs:42-82`, `server.js:115-117`).

The control plane marks in-flight jobs as interrupted on restart and requires explicit retry. Cancellation kills the worker process tree, waits for exit, releases the GPU lease, and refuses artifact promotion. A completed worker is promoted only when its queued project revision still matches; stale output is retained with a diagnostic (`server.js:54-90`). Project revisions are persisted in `project_revisions` and included in portable export (`server.js:18`, `server.js:106-108`).

## Measured host and remaining gates

Measured host evidence is in `work/blueprint-audit/doctor.json` and `work/blueprint-audit/HARDWARE_MODEL_AUDIT.md`: Windows 11 x64, i5-12450HX, RTX 3050 6GB, 16.87 GB RAM, Node 24, Python 3.13, Ollama 0.32.13, FFmpeg 8.1.1, project-scoped Blender. No neural-video or ComfyUI checkpoint is installed. macOS and Intel macOS are unverified. Whisper, Kokoro, ACE-Step, resumable model onboarding, selective dependency hashing, signed installers, and a user-owned publishing adapter remain release gates.
