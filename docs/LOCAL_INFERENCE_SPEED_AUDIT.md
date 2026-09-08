# Local inference speed audit — 8 September 2026

The two rejected Arjuna attempts remain rejected. This investigation changes runtime efficiency, not the visual acceptance decision. No additional casting frame, model download, model training or catalogue film was produced by this audit.

## Measured bottleneck and installed implementation

The replacement still job `b8c598d8-fa72-4baa-9b53-7c2ce289b20a` took approximately169 seconds end to end. The managed provider logged167.42 seconds; its20 sampler steps occupied roughly38 seconds. About two minutes preceded sampling, covering model loading and CPU text encoding; that interval is not a separately instrumented text-encoder measurement. The final single-frame VAE decode was short. These figures concern one1024×576 still, not a five-second video.

The actual managed startup uses `--lowvram --disable-dynamic-vram --disable-smart-memory --cache-none`. At installed ComfyUI commit `fbed745c8d7d62573b099cd61fe51cb64b9b807e`, the null cache never retains node results; non-dynamic low-VRAM execution routes text encoders to the CPU. Upstream documents the same costs. Consequently, changing only the sampling seed can still repeat both unchanged positive and negative text encoding. [ComfyUI CLI](https://github.com/comfyanonymous/ComfyUI/blob/fbed745c8d7d62573b099cd61fe51cb64b9b807e/comfy/cli_args.py)

The installed checkpoint inventory contains Wan2.2 TI2V5B Q4, LTX0.9.8 distilled2B Q8, their large text encoders and VAEs. There is no general image checkpoint in `models/checkpoints`, nor an installed LTX latent spatial upscaler. The2B diffusion model alone is about2.02GiB; the installed T5 encoder is3.15GiB and therefore the whole pipeline is not a2GiB VRAM workload.

## Bounded change implemented

`runtime/comfy-performance-profile.mjs` adds an **opt-in, unmeasured** `ram-pressure-4gb` profile. The launcher reads `performanceProfile` from the registered local `comfyui.json` configuration. The profile replaces only `--cache-none` with `--cache-ram 4 4`, retaining all local-only, GPU reserve, low-VRAM, custom-node whitelist and offload controls. It requires at least14GiB installed RAM and checks that the pinned CLI supports both thresholds. The current running provider and default remain unchanged.

Both values are free-system-RAM eviction thresholds:4GiB for active and inactive entries. They are **not** a hard process-memory ceiling. The upstream cache uses graph input signatures, including upstream encoder identity and prompt text, for reuse. Changing seed downstream can retain unchanged conditioning, while a different prompt changes its key. Large tensors are eligible for eviction under RAM pressure. This should reduce repeat encoding where cache entries survive; no seconds-saved figure is claimed before measurement. [ComfyUI cache implementation](https://github.com/comfyanonymous/ComfyUI/blob/fbed745c8d7d62573b099cd61fe51cb64b9b807e/comfy_execution/caching.py)

Do not substitute `--cache-lru 1` as a strict memory cap. Inspection of the installed implementation shows current-generation entries can remain above that count. Do not enable `--highvram`, force all models onto the GPU, or enable unmeasured numerical fast modes to obtain a speed claim.

Three profile tests pass; the original launch argument sequence is asserted exactly. The actual installed Python CLI also parsed `--cache-ram 4 4` with low-VRAM mode and1GiB VRAM reserve. No provider restart or GPU comparison of this cache profile has occurred. To roll back a future trial, remove `performanceProfile` or set it to `conservative`, then restart only at an idle, checkpointed boundary.

## Decode-only experiment

One authorized operation `4ec79558-5297-4e36-bfdf-a504ec1625d6` decodes the retained Wan latent from owned job `7555bcc4-9323-41f4-bfde-e6c1fb0cc406`. The latent SHA256 is `e44af235c97d7ce257529994b8f0aed1e3a3dab00ef194295d08c9485a12f252`. The graph contains only latent loading, VAE loading, tiled VAE decode and PNG saving. It has no text encoder or sampler.

Profile: spatial tile256, overlap64, temporal window128, temporal overlap8. The temporal window covers the retained five-second latent span; this avoids intentionally introducing extra temporal segment boundaries in this test. A full121-frame standard-versus-tiled SSIM/PSNR comparison and120 adjacent-frame differences are required, along with a playable120-frame24fps MP4, full decode and visual inspection. Results belong in `outputs/benchmarks/latent-decode/4ec79558-5297-4e36-bfdf-a504ec1625d6/result.json` and its appended review. This is **decoded-from-prior-latent**, never a newly generated film. The retained original run has no isolated VAE timing, so that run cannot establish a numerical decode speedup.

Completed measurement:182.689s provider execution,186.176s full stage,2.661GiB system-wide peak device memory,3.056GiB minimum free system RAM. All121 frames compared: SSIM mean0.997365/min0.996775, PSNR mean52.267dB/min50.01dB. All120 adjacent differences showed no aggregate increase. The five-second120-frame MP4 fully decoded. Both121-frame contact-sheet sequences and the worst-SSIM frame at native resolution showed no obvious additional spatial seam or face/material degradation. This qualifies fidelity only on the tested latent; a separate `VISUAL_REVIEW.md` preserves the limited decision. The provider queue is empty and the benchmark process exited.

## LTX and fast-image decisions

The LTX paper's headline five-second generation result was measured on anH100. It is not a3050 laptop latency promise. LTX compresses video spatially and temporally, trading detail representation against an efficient transformer; its decoder participates in recovering detail. [LTX-Video paper](https://arxiv.org/abs/2501.00103)

The official0.9.8 distilled configuration uses a two-stage, multi-scale pipeline with a spatial upscaler, a checkpoint-specific timestep schedule, and decoder timestep/noise controls. VYREALM's currently installed eight-step GGUF I2V graph is a bounded qualification candidate, not an implementation of that entire reference pipeline. The two are not interchangeable quality claims. [Official0.9.8 distilled configuration](https://github.com/Lightricks/LTX-Video/blob/main/configs/ltxv-2b-0.9.8-distilled.yaml)

SDXL-Turbo offers one-to-four-step image synthesis, but its own model card warns about faces and fixed-resolution limitations; it does not use negative prompting. Its licensing also requires a separate review for the intended distribution and commercial creator use. Therefore it is not a drop-in fix for the failed detailed casting prompt, and no checkpoint was downloaded. [SDXL-Turbo model card](https://huggingface.co/stabilityai/sdxl-turbo)

Next evidence needed: a repeated identical-prompt/different-seed local run comparing null cache against the pressure-cache profile; timings split into encoding, sampling and decoding; minimum free RAM and peak device VRAM; successful history identifying cached text nodes; and unchanged visual/provenance validation. Until then the profile is an implemented experiment, not a measured acceleration claim.
