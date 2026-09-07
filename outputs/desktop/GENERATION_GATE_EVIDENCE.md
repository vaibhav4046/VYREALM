# VYREALM neural generation gate evidence

Date: 2026-09-07 (Europe/London)

VYREALM now records generation provenance and refuses to label an output as locally generated until a provider has produced an in-job playable artifact.

- Provider order: ComfyUI → Wan2.2 → Wan2GP → FramePack.
- Preflight checks: loopback health, model files, executable paths, CUDA/discrete GPU, VRAM, and free disk.
- Smoke-test rule: a detected provider without a reviewed adapter returns `NEURAL_ADAPTER_SMOKE_TEST_REQUIRED`; no file is promoted.
- RTX 3050 test: `NVIDIA GeForce RTX 3050 6GB Laptop GPU`, 6 GB VRAM, 15.7 GiB RAM measured.
- Current host result: ComfyUI loopback unavailable; Wan2.2, Wan2GP, and FramePack executables/models are not configured. The installed app therefore returns `BLOCKED_NEURAL_GENERATION` for neural requests.
- Explicit asset routes remain available: imported local media is recorded as `imported-local-media`; the bundled rain-market acceptance film is recorded as `fallback-asset-first-keyframes` and remains `review_required`.

The installed UI exposes an `OUTPUT PROVENANCE` panel and a `Run real generation test` action. Legacy primitive outputs remain in history but are marked `BLOCKED` and cannot be presented as cinematic generation.
