# Local training feasibility

Assessed 8 September 2026 for the Lenovo LOQ, RTX 3050 Laptop 6 GB VRAM and 16 GB RAM. This is a research record: no trainer was installed, no model was downloaded, and no training or GPU benchmark was started by this audit.

**Decision: improve the approved character reference and image-to-video route now. Training every installed model is not a qualified route to a faster trailer. A small character LoRA is a separate, unqualified experiment.** Neither successful training loss nor a smaller checkpoint would establish cinematic quality or a five-minute complete trailer.

## What is actually installed

Fresh file inspection found these inference files under `D:/VYREALM-runtime/ComfyUI/models`:

| File | Bytes | Present purpose |
| --- | ---: | --- |
| `Wan2.2-TI2V-5B-Q4_K_M.gguf` | 3,433,116,000 | Quantized video diffusion inference |
| `ltxv-2b-0.9.8-distilled-q8_0.gguf` | 2,173,891,072 | Distilled video diffusion inference |
| `t5-v1_1-xxl-encoder-Q5_K_M.gguf` | 3,386,856,640 | LTX text encoder |
| `ltxv-0.9.8-2b-distilled-vae.safetensors` | 2,493,859,780 | LTX video autoencoder |

The first two are not training-ready full-precision checkpoints merely because ComfyUI loads them. The audited application route uses GGUF inference loaders, not an optimizer or training adapter. No installed, qualified Wan/LTX training environment was identified. Repository inventory and filenames establish availability, not a new checksum verification or training success.

At inspection, Windows reported approximately 2.45 GiB free physical RAM; D: had 11.99 GiB free and C: 37.14 GiB. These are workload-dependent snapshots. The 2.17 GB LTX diffusion file does not describe its complete working set: text encoder, VAE, activations and temporary buffers matter.

## Upstream constraints and licenses

The official Wan TI2V-5B model card licenses its models under Apache-2.0. Its documented 720p inference command requires at least 24 GB VRAM with offload options. VYREALM's quantized/offloaded 6 GB inference is a different configuration; successful inference is not evidence of 6 GB training support. Preserve the model and converter notices. The installed conversion is pinned in `runtime/neural-runtime.lock.json` to QuantStack revision `57437632ddd08bdcbd1508c866aa22e126ed51d2`. [Wan model card](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B)

Lightricks' LTX-Video-Trainer, inspected at commit `e055182fa36dba6f48eb0919aef09d277da30fbd`, documents approximately **16–40 GB VRAM for LTXV 2B training**, depending on configuration. It describes checkpointing and reduced dimensions, and requires conversion of Diffusers-format LoRAs for ComfyUI. Its `configs/ltxv_2b_lora.yaml` targets `LTXV_2B_0.9.6_DEV`, not the installed 0.9.8 distilled GGUF. Exact checkpoint, quantizer and Windows optimizer compatibility therefore remain unverified. Trainer code is Apache-2.0; this does not relicense model weights. [Pinned official training troubleshooting](https://github.com/Lightricks/LTX-Video-Trainer/blob/e055182fa36dba6f48eb0919aef09d277da30fbd/docs/troubleshooting.md)

LTX 0.9.8 weights fall under **LTXV Open Weights License 0.X**, dated April 15, 2025, rather than Apache/MIT. It has use and redistribution conditions, including model-derivative obligations; commercial entities with annual revenue of at least $10 million require separate commercial terms. Distillation is included in its derivative definition. Keep these model-specific terms explicit instead of describing every dependency as unrestricted. [LTX model license](https://huggingface.co/Lightricks/LTX-Video/blob/main/LTX-Video-Open-Weights-License-0.X.txt)

## Which intervention addresses which problem

| Intervention | Expected role | What it does not establish |
| --- | --- | --- |
| Better prompts and shot constraints | Casting, wardrobe, action and composition direction | Same identity across independent generations |
| Approved reference image plus I2V | Starts motion from the selected face, costume and scene without training | Perfect face retention or physically correct motion |
| Identity/control adapter | Adds conditioning when its exact model family and implementation are supported | Compatibility with arbitrary Wan/LTX versions |
| Character/style LoRA | Learns a narrow concept while most base weights remain frozen | A smaller base model, fewer denoising steps, general quality improvement or automatic speedup |
| Quantization/offload/tiled decoding | Reduces selected inference memory costs | Added visual knowledge; offload can slow generation |
| Pruning or distillation | Changes/compresses a model using additional optimization and evaluation | A free conversion that preserves quality; teacher generation and retraining still cost time/memory |
| Full fine-tuning or training all models | Large optimization workload needing suitable data per model | Feasible six-GB deployment just because inference fits |

These are engineering distinctions, not new measured performance results. Even approximate FP16 weights alone require 10 GB for 5 billion parameters or 4 GB for 2 billion; gradients, optimizer state and activations add to training memory. LoRA reduces trainable state but does not remove frozen base-weight and activation costs.

## A bounded qualification experiment, if prerequisites are later met

1. Select **one** exact compatible LTX 2B training checkpoint and pinned trainer/quantizer. Verify its rights, checksums and Windows dependencies first. Do not attempt to train the installed inference GGUF directly. No extra checkpoint is authorized or downloaded by this document.
2. Use a small manifest of original, consented or explicitly licensed character footage: for example 12 short clips, eight for training and four held out by scene. Record owner, permitted training/derivative uses, source hash and character/wardrobe labels. A public-domain story does not grant rights to a YouTube adaptation's footage, actors or soundtrack. Exclude the rejected Arjuna reference from approved identity data.
3. Before meaningful training, try only one forward/backward/optimizer step at batch 1, rank 4, 256×256 and nine frames, with cached latents/text, checkpointing and a trainer-supported frozen-base quantization. These are proposed diagnostic settings, **not an upstream-proven six-GB recipe**. Unload unused text/VAE components and run only one GPU process. Stop on unsupported operations, OOM, non-finite loss or sustained paging. Suggested operating caps: 5.5 GiB GPU and 12 GiB process RAM, with sufficient separately budgeted free disk; fail closed if the configuration cannot obey them.
4. Record step time, peak allocated/reserved GPU memory, whole-device peak, process/host RAM, input and checkpoint hashes. Extrapolate from measured steady steps and label that estimate. Only after this test passes consider a bounded 100-step adaptation with saved rollback checkpoints; that trial is not itself evidence of usable identity learning.
5. Compare base versus adapter on the held-out prompts using identical seeds, camera actions and settings. Inspect identity, wardrobe, hands, temporal stability and action adherence; measure complete generation/decode time. Accept only a repeatable improvement without material regressions, and retain the untouched base. Never use a demographic classifier to determine whether casting is correct: assess the user's approved character design, styling and cultural setting.

No six-GB training profile is qualified today. For the current trailer, the shortest useful path is to inspect a corrected keyframe before animating it, reuse the approved reference, benchmark the already installed distilled route, cache accepted shots and rerender only failed stages. Speed improvements must come from measured generation and decode work, not from labelling a LoRA or upscale as a new, faster foundation model.
