# Neural video qualification (2026-09-06)

## Decision

One viable trial candidate is **Wan2.1 T2V 1.3B, Q4_K_M GGUF**, loaded through a recent ComfyUI build with `city96/ComfyUI-GGUF` and `kijai/ComfyUI-WanVideoWrapper`. It is a candidate only: no model larger than 100 MB was downloaded, no package was installed, and no GPU inference was run.

The audited machine is an NVIDIA GeForce RTX 3050 6GB Laptop GPU (6,144 MiB; 6,002 MiB free at audit), Intel i5-12450HX, and 16.87 GiB RAM. C: had 24.49 GiB free and D: 72.99 GiB free. Because the requested 20 GiB free space must remain, model/cache/environment roots should be on D:.

## Primary source revisions

- [Wan2.1](https://github.com/Wan-Video/Wan2.1) main at `9737cba9c1c3c4d04b33fcad41c111989865d315`; its `LICENSE.txt` is Apache License 2.0.
- [LTX-Video](https://github.com/Lightricks/LTX-Video) main at `4b2d053057623ddd4d0a1d3e9cd28890e9ef487f`; LTX model card uses its open-weights license.

## Pinned artifacts

| Artifact | Revision / file | Bytes | SHA-256 | License |
|---|---|---:|---|---|
| [Wan GGUF card](https://huggingface.co/samuelchristlie/Wan2.1-T2V-1.3B-GGUF) | `5a512b15fc35d1b67a074cfe55a591be9e9ef9b5`; `Wan2.1-T2V-1.3B-Q4_K_M.gguf` | 982,716,640 (0.915 GiB) | `1e22a68152e6c4432524c61c78185efa35e6b305483ceb5fe238b2d51964cea7` | Apache-2.0 derivative card |
| [Comfy repackaged card](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged) | `617a7633e636506f850e043bc4605f290a466a8e`; `split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors` | 6,735,906,897 (6.273 GiB) | `c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68` | Apache-2.0 |
| [Comfy repackaged card](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged) | same revision; `split_files/vae/wan_2.1_vae.safetensors` | 253,815,318 (0.236 GiB) | `2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b` | Apache-2.0 |
| [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) | commit `6ea2651e7df66d7585f6ffee804b20e92fb38b8a` | source checkout | — | verify repository LICENSE |
| [WanVideoWrapper](https://github.com/kijai/ComfyUI-WanVideoWrapper) | commit `088128b224242e110d3906c6750e9a3a348a659b` | source checkout | — | verify repository LICENSE |

The three model files total 7,972,438,855 bytes (about **7.425 GiB**), before the source checkout and Python environment, comfortably below the 20 GiB new-download ceiling. The Q3_K_M alternative is 729,129,184 bytes (0.679 GiB) and reduces memory pressure at a quality cost.

## Why Wan, not LTX

The official [Wan2.1 repository](https://github.com/Wan-Video/Wan2.1) reports 8.19 GB VRAM for unquantized T2V-1.3B and recommends `--offload_model True --t5_cpu` for OOM cases; it supports 480p T2V. That makes a quantized/offloaded trial plausible but not guaranteed on 6 GB. The official [LTX-Video card](https://huggingface.co/Lightricks/LTX-Video) lists the 2B distilled transformer at 6,340,744,028 bytes, but its complete pipeline also needs a four-shard text encoder totaling 19,049,269,744 bytes (17.741 GiB) and a 1,676,798,532-byte VAE. That exceeds the 20 GiB download budget before runtime dependencies and is not a viable first trial.

## Safe next command (prepare only)

After explicit approval to install/download, create `D:\neural-video\wan21`, set `HF_HOME` and `TORCH_HOME` there, pin the commits above, download only the three listed files, verify each SHA-256, and run a 17-frame 480p Wan T2V workflow with model and text encoder offloaded to CPU. Do not enable prompt extension, remote APIs, or any additional checkpoint. Stop on any free-space check below 20 GiB or hash mismatch.

## Current blockers and risks

- The workspace has Python 3.13 and uv-managed Python 3.11.15, but no torch, diffusers, transformers, accelerate, safetensors, or gguf in the audited Python 3.13 environment.
- No ComfyUI, GGUF node, or Wan wrapper checkout was found in the audited workspace/model directories.
- 6 GB VRAM is below the official unquantized requirement; Q4 GGUF plus offload may still OOM. RAM is only 16.87 GiB, so the first smoke test must be very short (17 frames) and CPU offload enabled.
- Licenses are Apache-2.0 for the Wan derivative and Comfy model artifacts; wrapper/node repository licenses must be checked at checkout before redistribution or publication.

This report records a reproducible qualification candidate, not a claim that inference currently works.



