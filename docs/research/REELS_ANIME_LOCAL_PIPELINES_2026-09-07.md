# Reels/TikTok formats and local 6 GB pipelines — 2026-09-07

Research checkpoint for VYREALM. Two halves:

1. **Instagram Reels + TikTok format structure**, deliberately distinct from the
   YouTube Shorts material already in
   [`docs/VIRAL_FORMATS_RESEARCH_2026-09-07.md`](../VIRAL_FORMATS_RESEARCH_2026-09-07.md).
2. **Local open-source pipelines** that realistically run on this machine:
   RTX 3050 Laptop 6 GiB VRAM, 16 GiB RAM, Windows.

Status markers used throughout:

- **PRIMARY** — platform's own documentation, newsroom, or an official model card / repo.
- **SECONDARY** — trade press, agency blog, creator claim. Directionally useful, not authoritative.
- **UNVERIFIED** — could not be confirmed from a primary source in this pass. Do not build a product promise on it.
- **COMMUNITY-REPORTED** — a VRAM or speed number posted by a user, not published by the model author.

Nothing here is a promise of reach. Format research is a hypothesis generator,
and the local-model section is a shortlist to *test*, not a set of measured
VYREALM results. The only measured numbers on this machine are in the baseline
below and in `docs/LOCAL_NEURAL_RESEARCH_2026-09-07.md`.

---

## Part 0 — Measured baseline on this machine

Everything in Half 2 is judged against this, because speed is the binding
constraint, not quality.

| Component | Pin | Measured cost |
| --- | --- | --- |
| ComfyUI | `Comfy-Org/ComfyUI` @ `fbed745c` (GPL-3.0) | — |
| GGUF loader | `city96/ComfyUI-GGUF` @ `6ea2651e` (Apache-2.0) | — |
| Video model | `QuantStack/Wan2.2-TI2V-5B-GGUF` → `Wan2.2-TI2V-5B-Q4_K_M.gguf`, 3.43 GB (Apache-2.0) | **1413–1838 s per 5 s shot** |
| Text encoder | `city96/umt5-xxl-encoder-gguf` → `umt5-xxl-encoder-Q4_K_S.gguf`, 3.50 GB | — |
| VAE | `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` → `split_files/vae/wan2.2_vae.safetensors`, 1.41 GB | — |
| Interpolation | `rife-ncnn-vulkan` 20221029, model `rife-v4.6` (MIT) | 314 s for 15 s 1080p 24→60 fps |
| Upscale | Real-ESRGAN ncnn-vulkan v0.2.5.0, `realesrgan-x4plus` | 1078 s for 5 s 1024×576 → 3840×2160 |
| TTS | Piper 1.8.0 + `rhasspy/piper-voices` `en_US-ljspeech-high` | CPU, faster than realtime |
| ASR | `Systran/faster-whisper-tiny.en` | CPU |

**The number that matters:** one 5-second 1024×576 24 fps Wan2.2 TI2V-5B Q4_K_M
shot costs **~23–31 minutes** and peaks **5.85 GiB whole-device GPU memory**.
A 3-shot 15-second edit is therefore **70–90 minutes of GPU time before any
audio, captions, interpolation or upscale**. That is the bar every alternative
in Half 2 has to beat.

Derived rates for comparison:

- ~283–368 s per generated second of video.
- ~11.8–15.3 s per generated frame at 24 fps.
- Headroom above the 6 GiB card at peak: ~0.15 GiB. There is no room for a
  second resident model; every stage must be sequential with a full unload
  between stages.

---
