# Local production smoke evidence

Fresh local run on the verified Windows host using Ollama qwen3:4b-instruct, Blender, and bundled FFmpeg.

- Output: VYRELUM_LOCAL_SMOKE.mp4 (640x360, 12 fps, 3 seconds, H.264 + AAC)
- Editable source: VYRELUM_LOCAL_SMOKE.blend
- Captions: VYRELUM_LOCAL_SMOKE.srt
- Poster: VYRELUM_LOCAL_SMOKE.png
- Pipeline: brief → local director → validated scene graph → Blender render → timeline trim/caption/audio pass → export
- No cloud model, API key, subscription, or external upload was used.
- Local usage has no app token meter; runtime remains bounded by the user's hardware, storage, and time.
