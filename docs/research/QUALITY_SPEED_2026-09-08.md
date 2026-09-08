# Quality and speed: measured change and next gates

8 September 2026. Scope: CPU hybrid editing, a correction to prior research, and reference-conditioning decisions. No training, downloads, GPU job, new casting approval or new neural film is claimed.

## Product change

`runtime/format-render.mjs` previously encoded each beat, re-encoded the concatenation, then encoded again for burned captions. It now stream-copies the homogeneous H.264 beat streams at the concatenation stage. Caption burn-in and audio mixing remain. This removes a lossy generation and adds an actual `assembly.concatMs` measurement to the production receipt. All callers of the existing renderer receive the improvement; no separate agent service is required.

FFmpeg requires matching streams for concat. This renderer creates every segment itself using the same canvas, frame rate, pixel format and encoder; it does not concat arbitrary uploaded codecs. [FFmpeg concat documentation](https://ffmpeg.org/ffmpeg-formats.html#concat)

Hardware measured: Intel i5-12450HX, 16,873,545,728 physical RAM bytes, NVIDIA RTX 3050 Laptop GPU, 6,144 MiB VRAM. CPU-only benchmark uses `VYREALM_ANIME_HERO_5S.mp4` as existing source footage, a 12s 1280x720 24fps edit with four three-second beats including one black beat, and a declared silent audio track. It is a technical fixture, not a finished creative example.

| Run | Plain edit | Captioned edit |
|---|---:|---:|
| Baseline 1 | 8.484s | 9.276s |
| Candidate 1 | 3.566s | 4.551s |
| Baseline 2 | 6.641s | 7.511s |
| Candidate 2 | 3.604s | 6.137s |

Second candidate and raw receipts are in the task's `outputs/concat-benchmark`. Baseline variability is material; do not advertise a universal multiplier. Source inference time is excluded and unknown for this fixture; no enhancement was requested. Every output fully decoded and contained exactly 288 video frames at 24fps. The new integration test compares every decoded pixel to independently decoded original segments at 24 and 30fps and checks continuous frame timestamps, including black/footage boundaries. Focused renderer/caption/audio/sourcing checks: 99 passed, zero skipped. Reproduce using `scripts/benchmark-format-concat.mjs`; its command-line help names the module, source, output, FFmpeg and FFprobe arguments, so an unchanged baseline checkout can be compared without a legacy production option.

This saves editing time; it cannot turn the rejected 49m11s Wan shot into minute-scale fresh motion. The previous decode-only experiment lacks an isolated baseline and is not a demonstrated acceleration. Training would add dataset curation, compute and validation without addressing redundant editing or supplying a missing reference-edit model.

## Correct the analytics assumptions

The prior `VIRAL_YOUTUBE_FORMATS_2026-09-07.md` M3 and its engineering consequence overreach: the 60-second/100-view condition concerns highlighted key moments, not a blanket absence of Shorts retention curves. Do not suppress retention data based on format alone. The same official page defines the 30-second intro measure, explains that expectation alignment matters, and warns that a spike can reflect confusion as well as repeat interest. [YouTube retention guidance](https://support.google.com/youtube/answer/9314415?hl=en)

For Shorts, preserve stayed-to-watch, engaged views, average view duration and average percentage viewed as separate fields with source/date/denominator, allowing unavailable values rather than zeros. [YouTube content metrics](https://support.google.com/youtube/answer/12220281?co=GENIE.Platform%3DDesktop&hl=en-8)

For long-form, examine title/thumbnail expectation, intro and later drop-offs together. Thumbnail testing considers watch time rather than clicks alone. [YouTube explanation](https://blog.youtube/creator-and-artist-stories/renes-top-five-june-14-2024/)

## Compact design framework for the product planner

These are editorial hypotheses, not a causal formula or a reach score. They complement the existing format library; platform outcome measurements require the product's authenticated analytics integration.

| Decision | Shorts | Long-form | Observable review |
|---|---|---|---|
| Hook | Make the premise visible immediately; remove setup that adds no context | Fulfil title/thumbnail expectation early and state the question | Opening frame, first spoken line, explicit promise |
| Progression | Setup, meaningful change, consequence, payoff | Chapters advance the question with evidence and counterexamples | Each beat adds information; no repeated filler |
| Consistency | Lock subject, costume, palette and screen direction across cuts | Maintain those anchors across scenes and recaps | Compare first/middle/last frames; prop/face/costume checklist |
| Pacing | Cut when information changes; allow enough reading time | Vary shot length with explanation and emotional stakes | Timecoded beat sheet and actual caption dwell times |
| Audio | Intelligible voice, restrained effects tied to action | Continuous voice identity and ambience; music yields to speech | Listen through, clipping/silence checks, cue alignment |
| Payoff | Show the promised change before the ending | Resolve the central question and distinguish uncertainty | Opening promise mapped to an actual delivered shot |
| Packaging | Frame and title describe what viewers actually get | Compare title/thumbnail variants against downstream viewing | No fabricated events/results; analytics provenance |

Public AI/hybrid examples: YouTube profiles imUrgency's AI-assisted recut of *The Idol Was Overhyped*, TheDanocracy's *Restoring a 53 YEAR OLD photo using A.I*, and Los Wagners' image-transformation comedy. The useful transferable distinction is original commentary/process/performance plus targeted AI work. These are platform-profiled examples, not independently verified performance winners; their openings were not watched in this research pass, and no current per-video view counts or private retention figures were obtained. [YouTube creator profiles](https://blog.youtube/creator-and-artist-stories/how-shorts-creators-are-using-ai/)

The Dor Brothers' own portfolio describes commercials/music videos and large aggregate reach. Treat that as creator-reported portfolio evidence, not proof that a particular visual pattern caused virality. [Creator portfolio](https://thedorbrothers.com/about/)

## Casting/wardrobe: the missing operation

Inspected R7 PNG job `3c7275da-79b4-463a-8286-90bb28ee1440`: mail-like sleeveless vest, no visible circlet or saffron sash. It remains rejected. Repeated text-only sampling has not established costume adherence. The existing `wanWorkflow` supports a single starting image through `Wan22ImageToVideoLatent.start_image`; that animates a reference, it does not implement a mask-based wardrobe edit. The installed keyframe request and evidence checks do not accept an externally edited frame as an owned generated reference.

Available model-family choices must not be confused: Wan TI2V supports text/image-to-video; VACE adds optional video/mask/reference inputs with different weights; Qwen-Image-Edit explicitly supports appearance editing and is based on a 20B model. None of the latter routes is installed/qualified here. No claim that a quantized version fits this machine or runs in minutes has been measured. [Wan official](https://github.com/Wan-Video/Wan2.2), [VACE official](https://github.com/ali-vilab/VACE), [Qwen edit model card](https://huggingface.co/Qwen/Qwen-Image-Edit)

Concrete next product operation: `edit-reference` takes an owned source image hash, optional region mask, wardrobe/prop reference hashes, and explicit preservation requirements. Its receipt must identify the actual provider/model, input hashes, output hash and measured timing. A separate visual review checks identity and each required garment/prop before the exact image becomes an I2V input. Importing an edited image must retain external provenance rather than claiming local Wan generation. Until a provider exists, return an unavailable capability; do not silently rerun text-only casting or animate a rejected image. No additional approval of the failed R7 frame is implied.

The main owner owns product research/API and analytics integration. This document is supporting evidence, not proof the app can already research and learn independently.
