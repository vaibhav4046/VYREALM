# Reuse and attribution audit

This build uses independently implemented project and timeline contracts. No source code from the projects below is copied into the application.

| Reference | Version / license evidence | Decision |
|---|---|---|
| [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) | Repository describes Apache-2.0; the pinned package family is `@hyperframes/core` 0.8.x. | Keep as a future composition adapter boundary. The current renderer uses the qualified Blender/FFmpeg worker and does not silently depend on hosted rendering. |
| [react-video-editor docs](https://www.reactvideoeditor.com/docs/core/installation) | Pro source is private and requires a paid developer seat. | Do not copy or vendor code. Implement the required timeline concepts in the canonical project store. |
| [Open-Video-Craft](https://github.com/Reubencfernandes/Open-Video-Craft) | Repository README identifies ISC licensing and local recording/editing. | Use as a design reference for local projects, recording, subtitles, and audio lanes. No source code or hosted AI dependency is inherited. |

Attribution notices belong in the eventual installer package. License status for third-party binaries (Blender, FFmpeg, Whisper, Kokoro, and any future model weights) must be recorded with their exact build and checksum before distribution.

The current machine evidence supports local Ollama director inference, editable Blender scenes, and FFmpeg export. Neural video, transcription, narration, and music adapters remain capability-gated until a local model/runtime is installed and acceptance-tested.
