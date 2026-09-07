# Blueprint hardware and model audit

Measured on 2026-09-06 from `runtime/doctor.mjs`; raw evidence: `work/blueprint-audit/doctor.json`.

## Host
- Windows 11 Home Single Language, x64; Intel Core i5-12450HX, 12 logical CPUs.
- RAM: 16,873,545,728 bytes total (~15.7 GiB), 4,444,856,320 bytes free at capture.
- NVIDIA GeForce RTX 3050 6GB Laptop GPU; driver 581.86; 6144 MiB VRAM, 6002 MiB free at capture.
- Node v24.12.0, Python 3.13.3, Ollama 0.32.13.
- FFmpeg 8.1.1 available on PATH. Blender is not on PATH; project-scoped Blender exists under `work/render-development/tools/blender/`.
- Ollama loopback API reachable; doctor reports no downloads and paid inference false.

## Installed Ollama models
Inventory is from Ollama `/api/tags` in doctor.json. Sizes total about 27.8 GB across Ollama storage; individual models are 0.27–5.23 GB. Available models are primarily Q4 text/vision-language models: qwen3 4B/8B, qwen3.5 4B, qwen2.5-coder 3B, gemma3 1B/4B, llama3.2 3B, and project variants. No video diffusion checkpoint or ComfyUI video model is evidenced.

## Qualification blockers
- No installed neural-video pipeline was found or exercised. RTX 3050 6GB is below official memory reports for common Wan/Hunyuan configurations; FramePack's 6GB target conflicts with the 20 GiB download budget and is not installed. A graphics/Blender render cannot satisfy a neural-video gate.
- Existing local models are suitable for bounded directing, metadata, captions/planning and code-like tool calls, subject to project harness evidence. They do not prove image/video generation.
- Blender + FFmpeg can provide real editable 3D and deterministic composition, but Blender is not globally installed and must remain bundled/project-scoped for standalone shipping.
- No macOS or Intel-Mac evidence exists; do not claim those platforms verified.

## Conclusion
On this machine, the viable near-term product is a local production OS with qualified text planning, editable Blender scenes, deterministic FFmpeg export, timeline/caption/audio handling and precise diagnostics for unsupported neural generation. A fresh local neural-motion clip remains a release gate requiring a measured, license-compatible checkpoint within VRAM/RAM/storage limits.
