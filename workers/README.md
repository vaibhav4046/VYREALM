# VYRELUM local render workers

`render.mjs` is a typed subprocess worker. It accepts a JSON request with
`schemaVersion: 1`, `kind: "scene"` or `"timeline"`, and writes only to the
requested output directory. Scene requests compile canonical meters/radians,
Z-up scene data into an editable Blender `.blend`, PNG frames, an H.264 MP4,
and `result.json` containing ffprobe evidence. Timeline requests conform
existing owned clips with FFmpeg's concat demuxer; missing paths fail before
execution. Both workers run the shared layered media verifier before writing a
successful receipt. It checks the playable file, stream presence, dimensions,
duration, frame rate, required audio, and (when requested) valid SRT cues. All
output promotion is left to the control plane.

```powershell
node workers/render.mjs --input workers/default-scene.json --output outputs/renderer-evidence/violet-matter
```

Use `VYRELUM_BLENDER`, `VYRELUM_FFMPEG`, and `VYRELUM_FFPROBE` to point at
approved installations. The bundled Blender is the official 4.5.13 Windows
x64 archive; its SHA-256 is recorded in `tools.json`.
