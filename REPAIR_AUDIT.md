# ZEUS repair audit — 2026-09-06

## Root causes found

- The original UI rendered hard-coded cards and sample metrics.
- Generation handlers returned toast messages or delayed status without a worker output.
- Browser IndexedDB and the Node service were competing state stores.
- The referenced V4 bundle was absent; implementation proceeded from the self-contained mandate.

## Repaired path

`brief → SQLite project revision → authenticated job → typed worker → validated artifact → asset promotion → playable preview/export → review package`

The control plane is `server.js`, with SQLite WAL persistence and loopback-only session tokens. Blender/FFmpeg jobs promote only files that pass worker validation. Director jobs use the cached Ollama model through `runtime/director.mjs` and preserve model digest/timing evidence.

## Evidence

- Director: `work/runtime-audit/director-production.json` and inference records.
- Editable 3D + MP4: `outputs/renderer-evidence/violet-test/`.
- Timeline conform: `outputs/renderer-evidence/timeline-test/`.
- Independent scene reopen: Blender reported 7 objects and animated camera.
- API scene job: persisted `succeeded` job, promoted MP4/poster/BLEND assets, and updated project `latestOutput`.
- Fresh unseen-brief API run: Ollama director persisted one scene, three shots, and three editable timeline entries before the scene render.
- Fresh scene run: Blender/FFmpeg worker produced and promoted a playable MP4 and editable `.blend`; Review prepared a SHA-256 release package in local state.
- Desktop shell syntax, capability registry acceptance, publishing state-machine, and runtime integrity/storage tests pass through `npm test`.

## Remaining gates

- No local neural-video checkpoint was present; no neural-video capability is claimed.
- YouTube OAuth/upload/publication is not connected; publishing remains a separate permissioned subsystem.
- FFmpeg/Blender are project-scoped worker dependencies rather than PATH installations.
- Electron installers, signing/notarization, and OS installation have not been executed in this workspace; macOS (including Intel) is unverified.
- The desktop manifest provides integrity-gated repair and resumable-download primitives, but release artifacts still need approved per-platform Node/Blender/FFmpeg/model bundles.
