# VYRELUM production roadmap

The winning demo should prove a complete creator loop with a result a judge can inspect: a fresh brief becomes a locally planned sequence, editable shots and captions, a polished render, a portable project, and a reviewable release package. The product claims privacy, editability, recovery, and honest capability reporting.

## Current proof

- Local Ollama director produces validated scenes, shots, operations, and timeline entries.
- Blender produces editable scene sources; FFmpeg produces an H.264 MP4 and ffprobe evidence.
- SQLite revisions, durable jobs, cancellation/retry, artifact promotion, and a single GPU-heavy lease are connected.
- Captions and talking-head cut lists execute offline; release packages hash outputs and enforce channel, disclosure, rights, and scheduling guards.
- The director uses model/version-aware plan caching and records any unavailable neural/image route as a diagnostic; the scheduler uses a crash-safe SQLite GPU lease, process-tree cancellation, revision history, stale-output protection, and a static-file allowlist.
- Windows NSIS packaging launches the bundled local engine; macOS and Intel macOS remain unverified.

## Next implementation gates

1. **Model onboarding:** ship signed, checksum-pinned local runtimes and compact model profiles. Keep downloads resumable and user-authorized; measure VRAM, RAM, latency, and quality per adapter.
2. **Premium motion adapter:** qualify one genuine local image/video checkpoint that fits the target machine. A Blender fallback must never be reported as neural video.
3. **Audio and captions:** bundle or qualify Whisper, Kokoro, and ACE-Step variants separately for Windows and Apple Silicon. Add acceptance clips with intelligibility, timing, and mix checks.
4. **Selective rerendering:** hash scene, shot, caption, and audio inputs independently so an edit invalidates only affected jobs.
5. **Publication adapter:** connect YouTube OAuth through a user-owned credential store, upload privately first, reconcile resumable offsets, and require explicit approval before scheduling or publishing.
6. **Release matrix:** build and sign Windows x64, macOS Apple Silicon, and macOS Intel separately. Run the same unseen-brief workflow after install, restart, and reopen.

## Demo acceptance matrix

| Journey | Evidence required | Current state |
|---|---|---|
| Idea to plan | Model digest, structured plan, bounded loop | Passing locally |
| Plan to edit | Revisioned scenes, shots, captions, timeline | Passing locally |
| Edit to film | MP4, ffprobe metadata, editable `.blend` | Passing on Windows host and packaged runtime |
| Review to export | Portable project and hashed release package | Passing locally |
| Film to YouTube | OAuth, private upload, resumable reconciliation | Adapter boundary only |
| Neural video | Real local checkpoint and measured acceptance clip | Blocked until qualified |
| Cross-platform install | Signed Windows/macOS artifacts and post-install run | Windows unsigned verified; macOS unverified |
