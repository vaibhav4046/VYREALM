# AI Video Failure Taxonomy

**Scope.** How AI-generated video fails at the frame and shot level, why it fails architecturally, and for each failure: can we detect it from pixels, prevent it, or repair it. Written for VYREALM's quality engine (Wan2.2 TI2V-5B Q4 GGUF via ComfyUI, RTX 3050 6GB).

**Status:** research document. Every substantive claim carries a URL. Claims I could not ground in a primary source are marked **UNVERIFIED**. Every number in "Measured on our own output" came from actually running code on our own files.

**Compute anchor used throughout.** Our measured generator cost is **1568 s for 121 frames at 1024x576, 20 steps = 12.96 s/frame**. A re-roll of one 5 s shot costs ~26 minutes. An `ffmpeg` filter pass over the same shot costs seconds. That ratio, roughly **200:1**, is what makes the ranking at the end come out the way it does: prevention and cheap post-fixes dominate anything that ends in "generate it again".

---

## 0. Why this document is the product

We cannot beat Minimax / Hunyuan / Kling / Seedance on pixels. They run 13B-30B models on datacenter GPUs; we run 5B at Q4 on a 6GB laptop. What hosted tools do *not* do is measure their own output and act on it. They generate and hand you whatever came out.

The academic evaluation literature has already done the hard part of enumerating and operationalising the failure modes. VBench decomposes video quality into 16 measurable dimensions with a concrete detector for each ([arXiv:2311.17982](https://arxiv.org/abs/2311.17982)); VBench-2.0 adds 18 fine-grained "intrinsic faithfulness" dimensions covering anatomy, physics and object permanence ([arXiv:2503.21755](https://arxiv.org/abs/2503.21755)); EvalCrafter contributes flow-warping error and face-consistency metrics ([arXiv:2310.11440](https://arxiv.org/abs/2310.11440)). Nobody has wired those detectors into a *generation loop* on consumer hardware. That is the gap.

---

## 1. Source inventory

Primary sources this taxonomy rests on. Each failure mode below cites the specific one it uses.

| Source | What it gives us | URL |
|---|---|---|
| VBench (CVPR 2024) | 16 dimensions + the exact detector for each | https://arxiv.org/abs/2311.17982 |
| VBench code | Canonical dimension names | https://github.com/Vchitect/VBench |
| VBench++ | Image-to-video suite extension | https://arxiv.org/abs/2411.13503 |
| VBench-2.0 | 18 dimensions: anatomy, physics, instance preservation | https://arxiv.org/abs/2503.21755 |
| VBench-2.0 code | Dimension groupings | https://github.com/Vchitect/VBench/tree/master/VBench-2.0 |
| EvalCrafter (CVPR 2024) | Warping Error, Flow-Score, Face Consistency, OCR-Score | https://arxiv.org/abs/2310.11440 |
| EvalCrafter project page | Metric name list | https://evalcrafter.github.io/ |
| FETV (NeurIPS 2023 D&B) | Static vs temporal quality split; automatic metrics correlate poorly with humans | https://arxiv.org/abs/2311.01813 |
| T2VBench (CVPR-W 2024) | Temporal-dynamics-only benchmark (see gap #8) | https://openaccess.thecvf.com/content/CVPR2024W/EvGenFM/html/Ji_T2VBench_Benchmarking_Temporal_Dynamics_for_Text-to-Video_Generation_CVPRW_2024_paper.html |
| Wan technical report | Wan-VAE 4x8x8 compression, chunked decode of at most 4 frames | https://arxiv.org/abs/2503.20314 |
| Wan2.2-TI2V-5B model card | 4x16x16 VAE, ~4x32x32 total with patchify, native 1280x704 @ 24fps | https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B |
| HunyuanVideo | 13B open model, systematic framework | https://arxiv.org/abs/2412.03603 |
| CogVideoX | 3D causal VAE explicitly motivated as a flicker fix | https://arxiv.org/abs/2408.06072 |
| LTX-Video | 1:192 compression "inherently limits the representation of fine details" | https://arxiv.org/abs/2501.00103 |
| VideoPhy | Physics failure taxonomy: mass conservation, Newton, penetration | https://arxiv.org/abs/2406.03520 |
| PhyGenBench | 160 prompts across 27 physical laws | https://arxiv.org/abs/2410.05363 |
| BroadWay / ByTheWay | Temporal-attention disparity to implausible structure; attention energy to motion amplitude | https://arxiv.org/abs/2410.06241 |
| FlowMo | Patch-wise temporal variance of latents predicts motion incoherence | https://arxiv.org/abs/2506.01144 |
| ViDiT-Q | Quantisation artifacts in video DiTs: jitter, glitches, colour shift | https://arxiv.org/abs/2406.02540 |
| Adaptive Video Distillation | Oversaturation + temporal collapse from few-step distillation, with Dynamic Degree numbers | https://arxiv.org/html/2603.21864v1 |
| Wan2.2 distill+quant paper | Errors from low-bit quant "first appear in Subject Consistency and Motion Smoothness" | https://arxiv.org/html/2606.00658 |
| Imagen | High CFG weight gives "highly saturated and unnatural images"; dynamic thresholding | https://arxiv.org/abs/2205.11487 |
| Common Diffusion Noise Schedules are Flawed | Train/test mismatch, limited brightness range | https://arxiv.org/pdf/2305.08891 |
| LF-CFG | Oversaturation traced to redundant low-frequency accumulation | https://arxiv.org/abs/2506.21452 |
| HandRefiner | Malformed hands: wrong finger counts, irregular shapes; inpainting repair | https://arxiv.org/abs/2311.17957 |
| HandCraft | Malformed-hand *detector* + MalHand dataset | https://arxiv.org/abs/2411.04332 |
| Lai et al., Blind Video Temporal Consistency (ECCV 2018) | Flow warping error with occlusion mask | https://arxiv.org/abs/1808.00449 |
| DeMamba / GenVideo | Million-scale AI-video detection built on spatial-temporal inconsistency | https://arxiv.org/abs/2405.19707 |
| MemoBench | Disappear/reappear object-permanence benchmark | https://arxiv.org/abs/2606.27537 |
| Error Analyses of Auto-Regressive Video Diffusion Models | Error accumulation along the AR chain | https://arxiv.org/html/2503.10704 |
| Movie Gen | Aspect-ratio bucketing in video training | https://arxiv.org/pdf/2410.13720 |
| Wan causal-VAE feat-cache issue | "Wrong cache order/chunking implies temporal seams every 4 frames" | https://github.com/utensils/mold/issues/744 |
| ComfyUI VAEDecodeTiled docs | Tiled/chunked decode with overlap | https://docs.comfy.org/built-in-nodes/VAEDecodeTiled |

### The detector toolbox the literature already validated

Worth internalising before reading the taxonomy, because it decides what is cheap for us. From VBench's own method descriptions ([arXiv:2311.17982](https://arxiv.org/abs/2311.17982)):

- **Subject Consistency** - DINO features per frame, cosine similarity frame-1 to frame-t and frame-(t-1) to frame-t.
- **Background Consistency** - same structure, CLIP image encoder instead of DINO.
- **Temporal Flickering** - **mean absolute error between consecutive frames over all pixel locations**, on videos pre-filtered to be static by optical flow; reported as `(255 - MAE)/255`.
- **Motion Smoothness** - drop the odd-numbered frames, reconstruct them with a video frame interpolation model, report MAE between reconstructed and dropped frames.
- **Dynamic Degree** - RAFT optical flow; the "average of the largest 5% optical flows" decides static vs non-static.
- **Aesthetic Quality** - LAION aesthetic predictor per frame.
- **Imaging Quality** - MUSIQ trained on SPAQ, per frame. Catches blur, noise, over-exposure.
- **Object Class / Multiple Objects / Colour / Spatial Relationship** - GRiT detection and dense captions; IoU of boxes for spatial relations.
- **Human Action** - UMT action classifier on 16 uniformly sampled frames, logit threshold 0.85.
- **Scene** - Tag2Text captions checked against the prompt.
- **Appearance Style / Temporal Style / Overall Consistency** - CLIP and ViCLIP similarity to the prompt.

Three of those - **temporal flickering, motion smoothness, dynamic degree** - need nothing but pixel arithmetic and optical flow. Those are free for us. The rest need a neural model resident in VRAM we do not have while the generator is loaded.

From VBench-2.0 ([arXiv:2503.21755](https://arxiv.org/abs/2503.21755)):

- **Human Anatomy** - a ViT-base anomaly detector trained on 150k labelled real+generated human frames, over YOLO-World crops of body / hands / faces.
- **Human Identity** - RetinaFace detection plus **ArcFace** embeddings, every frame compared to the first frame.
- **Human Clothes** - LLaVA-Video-7B multi-question answering on outfit stability.
- **Instance Preservation** - "abnormal entity states (entity sudden merging, splitting, appearing, and disappearing)"; clip-level anomaly detector fine-tuned on Qwen2.5-VL-3B-Instruct.
- **Multi-View Consistency** - SIFT keypoints + FLANN matching + RANSAC for feature-matching stability, plus RAFT for camera-motion speed.
- **Camera Motion** - CoTracker-v2 point tracking with heuristics for nine camera-motion types.
- **Mechanics / Thermotics / Material / Motion Rationality** - VLM multi-question answering. No cheap pixel proxy exists.

SIFT+FLANN+RANSAC and ArcFace are the two interesting entries: both are cheap enough to run on CPU alongside a loaded generator.

---

## 2. The taxonomy

Each entry: **definition, frame-to-frame signature, architectural cause, pixel-detectable?, preventable?, repairable?**

---

### GROUP A - Temporal stability

#### A1. Temporal flicker

**Definition.** High-frequency, low-amplitude fluctuation of pixel values across consecutive frames in regions that should be static. VBench names this dimension `temporal_flickering` and defines it as "high-frequency temporal inconsistencies" ([arXiv:2311.17982](https://arxiv.org/abs/2311.17982)).

**Frame-to-frame signature.** In a spatially static region, per-pixel values wander by a few levels each frame with no coherent optical flow. Textured surfaces (foliage, fabric weave, gravel, rain) boil. The signature that separates flicker from motion is **near-zero optical flow but non-zero pixel difference**.

**Why architecturally.** Each denoising trajectory starts from independently sampled noise per latent frame; without sufficient temporal coupling nothing forces identical reconstruction of a static texture across frames. CogVideoX states this directly as the motivation for its 3D causal VAE over per-frame 2D VAE fine-tuning: the 3D design "helps prevent flicker in the generated videos, ensuring continuity among frames" ([arXiv:2408.06072](https://arxiv.org/abs/2408.06072)). Flicker is the residual after that coupling.

**Pixel-detectable?** **Yes, trivially, and exactly as VBench does it.** Mean absolute difference between consecutive frames restricted to low-flow regions. One grayscale diff per frame pair plus an optical flow field to mask genuinely moving pixels. Fully CPU, milliseconds per frame at 1024x576.

**Preventable?** Partially. Step count and seed choice help; the dominant lever is prompting for *less* fine stochastic texture (rain, foliage, crowd, glitter) in otherwise static regions. Also: do not generate below the model's native training resolution, which amplifies per-frame noise (see D3).

**Repairable?** Yes and cheaply for mild cases. A temporal low-pass over the flow-warped stack (`ffmpeg tmix`, or motion-compensated temporal denoise) removes the high-frequency component at the cost of real fine motion, so it must be region-limited. **Severe** flicker cannot be denoised out without turning the shot to mush. That is a re-roll.

---

#### A2. Background instability / scene drift

**Definition.** The non-subject background changes identity over the shot: architecture rearranges, a treeline becomes a different treeline, an interior gains or loses fixtures. VBench measures this as `background_consistency` via CLIP-image-encoder cosine similarity between frames ([arXiv:2311.17982](https://arxiv.org/abs/2311.17982)).

**Frame-to-frame signature.** Adjacent-frame differences stay small; **frame-1-to-frame-t** differences grow monotonically. The tell is the *divergence between the adjacent-frame similarity curve and the anchor-frame similarity curve*. Adjacent stays high, anchor decays.

**Why architecturally.** Latent drift. Each step's small error is conditioned on the previous state, so bias compounds along the sequence: "tiny numerical biases generated at each step are propagated and accumulated along the autoregressive chain, leading to non-linear amplification" ([arXiv:2503.10704](https://arxiv.org/html/2503.10704)). Bidirectional-attention models like Wan2.2 get a milder version of the same thing because the attention window still cannot enforce global scene identity over 121 frames.

**Pixel-detectable?** **Yes, but it needs a feature extractor.** VBench uses CLIP. The cheap version is a colour-histogram plus SIFT-keypoint-match-count between frame 1 and frame t - VBench-2.0's Multi-View Consistency already validates SIFT+FLANN+RANSAC as a structural-stability signal ([arXiv:2503.21755](https://arxiv.org/abs/2503.21755)). A falling keypoint-match count against a fixed anchor with no camera motion is a clean drift signal and runs on CPU.

**Preventable?** Strongly, by shot length. Drift is superlinear in frame count. Two 61-frame shots joined at a cut are far more stable than one 121-frame shot and cost the same compute. This is our single biggest prevention lever.

**Repairable?** No, not post-hoc. Re-roll, or trim to the stable prefix. Trimming is nearly free and often sufficient.

---

#### A3. Colour drift and progressive oversaturation

**Definition.** Global chroma statistics move monotonically over the shot - usually saturation climbing and value falling - and/or the clip sits at unnaturally high saturation from frame one.

**Frame-to-frame signature.** Mean HSV S per frame trends upward; the fraction of pixels at S=255 (clipped chroma) rises. Hue histograms shift toward a dominant channel. No corresponding change in scene content.

**Why architecturally.** Two separable causes.
1. **Guidance.** High classifier-free-guidance weight pushes x-predictions outside the [-1,1] range the training data occupies. Imagen states plainly that increasing the guidance weight "damages image fidelity producing highly saturated and unnatural images", and introduces dynamic thresholding to counter it ([arXiv:2205.11487](https://arxiv.org/abs/2205.11487)). LF-CFG later attributes the same effect to accumulation of redundant low-frequency information ([arXiv:2506.21452](https://arxiv.org/abs/2506.21452)). A related train/test mismatch in noise schedules limits the achievable brightness range ([arXiv:2305.08891](https://arxiv.org/pdf/2305.08891)).
2. **Distillation.** Few-step distilled students inherit oversaturation from distribution-matching objectives: the teacher "tends to overemphasize local information, steering the student toward a suboptimal distribution characterized by excessive color saturation" ([arXiv:2603.21864](https://arxiv.org/html/2603.21864v1)). Relevant if we ever adopt a Turbo-style distilled Wan variant.

**Pixel-detectable?** **Yes, and it is the cheapest detector we have.** Per-frame mean and percentile HSV S and V, clipped-pixel fraction, and a linear fit of S against frame index. Pure numpy, microseconds.

**Preventable?** Yes - it is a *parameter* fault, not a content fault. Lower CFG. Finding the CFG knee is the highest-value parameter experiment available, because the fix costs nothing at generation time.

**Repairable?** **Yes, almost free.** Per-shot colour normalisation (`ffmpeg eq` / `colorbalance`, or matching each frame's chroma histogram to the shot median) fixes drift in seconds. This is the archetype of a defect that should never trigger a re-roll.

---

#### A4. Luminance / exposure pumping

**Definition.** Global brightness oscillates or ramps across the shot with no lighting event in the content. Distinct from A3 in that chroma is stable and only value moves.

**Frame-to-frame signature.** Mean luma per frame shows a low-frequency oscillation or a monotone ramp; the spatial pattern of the change is flat rather than localised.

**Why architecturally.** Same family as A3 - noise-schedule and signal-to-noise mismatch means the achievable mean brightness is not stable across the trajectory ([arXiv:2305.08891](https://arxiv.org/pdf/2305.08891)). **UNVERIFIED** as a specifically *temporal* effect in Wan2.2; the cited work is about images.

**Pixel-detectable?** Yes: per-frame mean luma, fit and residual. Trivially cheap.

**Preventable?** Partially, via the same CFG and scheduler levers as A3. **UNVERIFIED** which of our sampler settings dominates.

**Repairable?** Yes, cheap: normalise each frame's mean luma to a smoothed trend. `ffmpeg` has `deflicker` built in.

---

#### A5. Frame duplication and motion stall (temporal collapse)

**Definition.** Consecutive frames are identical or near-identical; the shot has no real motion despite a prompt requesting some. The distillation literature names the general case **temporal collapse**: "mode collapse extends into the temporal dimension, resulting in videos with limited or even static motion" ([arXiv:2603.21864](https://arxiv.org/html/2603.21864v1)).

**Frame-to-frame signature.** MAD between consecutive frames drops to near zero for a run of frames; optical flow magnitude collapses. VBench's `dynamic_degree` operationalises the boundary: RAFT flow, "average of the largest 5% optical flows" thresholded to classify a video as static ([arXiv:2311.17982](https://arxiv.org/abs/2311.17982)).

**Why architecturally.** Three contributors, all measurable in principle:
1. **Distillation.** Measured directly: baseline DMD reached 72.22% Dynamic Degree against the teacher's 85.56% ([arXiv:2603.21864](https://arxiv.org/html/2603.21864v1)).
2. **Insufficient temporal attention energy.** BroadWay finds that "videos that exhibit a higher degree of motion amplitude and a richer variety of motion patterns are observed to possess greater energy within their temporal attention maps", and amplifies that energy to fix near-static output ([arXiv:2410.06241](https://arxiv.org/abs/2410.06241)).
3. **Prompt.** Prompts with no verb, or verbs describing state rather than change, yield state.

**Pixel-detectable?** **Yes, and this is the highest-confidence detector in the taxonomy.** Duplicate detection is exact (MAD below a floor). Stall detection is a flow-magnitude percentile. Both cheap, both with essentially zero false positives when the prompt requested motion.

**Preventable?** Strongly. Prompt-level: an explicit motion verb plus a camera move. Parameter-level: avoid aggressive distillation; check the sampler is not effectively converging back to the conditioning image in I2V mode.

**Repairable?** **No.** Interpolation cannot invent motion that is not there - RIFE and friends synthesise *between* existing states, so interpolating stalled frames yields more stalled frames. This is a re-roll, and because detection is so reliable it is one of the few defects where a 26-minute re-roll is unambiguously the right call.

---

#### A6. VAE chunk-boundary seams

**Definition.** A periodic discontinuity in the decoded video at the temporal chunk stride of the causal 3D VAE - a per-N-frame tick in texture, sharpness or colour.

**Frame-to-frame signature.** MAD, or a texture-energy measure, shows a **periodic spike at a fixed stride**, independent of content. For Wan the stride is 4: the technical report says each encode/decode "handles only the video chunk corresponding to a single latent representation", "at most 4 frames" ([arXiv:2503.20314](https://arxiv.org/html/2503.20314v1)), and a Wan VAE reimplementation writeup states outright that "Wrong cache order/chunking implies temporal seams every 4 frames" ([issue #744](https://github.com/utensils/mold/issues/744)).

**Why architecturally.** The decoder is temporally convolutional. Pixel values at a chunk boundary depend on latents outside the chunk window; when the feature cache (Wan uses `CACHE_T=2` trailing frames per conv) is not carried correctly, or when a tiled decoder splits without overlap, the receptive field is truncated and the boundary frame is reconstructed from incomplete context. ComfyUI's `VAEDecodeTiled` explicitly processes temporal frames "in chunks with overlap for smooth transitions" for this reason ([docs](https://docs.comfy.org/built-in-nodes/VAEDecodeTiled)).

**Pixel-detectable?** **Yes, and the periodicity makes it near-unambiguous.** Take the per-frame-pair MAD series, subtract a rolling median, then either run a DFT or simply compare the mean of indices congruent to 0 mod 4 against the rest. A significant stride-4 component is a seam. A distinctive, high-precision detector no hosted competitor exposes.

**Preventable?** **Yes, entirely - it is a configuration bug, not a model limitation.** Correct feat-cache handling, or tiled decode with sufficient temporal overlap, eliminates it. Prevention cost: zero.

**Repairable?** Partially, by temporal blending across the offending boundaries. But if we see it, the right action is to fix the decode configuration, not to paper over it.

---

#### A7. Terminal detail collapse (tail-of-clip softening)

**Definition.** Fine, pixel-scale high-frequency energy decays progressively over the final fraction of a shot, so the last frames are visibly softer than the middle. Not a named dimension in any benchmark I found. **This is our own measured observation** (section 3.3), flagged as such.

**Frame-to-frame signature.** Laplacian variance, or any high-band energy measure, computed **at native resolution**, falls monotonically over the last roughly 10-15% of frames. The effect largely disappears if you downscale before measuring, which localises it to the finest spatial band.

**Why architecturally.** Candidate explanations, none confirmed:
- The final VAE decode chunk has the least temporal context on one side (the causal decoder's forward context runs out).
- Latent drift (A2) manifesting as high-frequency loss rather than semantic change.
- H.264 rate control allocating fewer bits to the clip tail.

I tested the third: mean packet size falls only about 14% from the first quartile to the last (27,348 to 23,393 bytes) while native-resolution Laplacian variance falls about 50%, so **encoding does not account for it**. The other two remain **UNVERIFIED** and are separable by the controlled test below.

**Pixel-detectable?** **Yes and cheaply** - per-frame Laplacian variance at native resolution, ratio of the last-k-frame mean to the shot median. One convolution per frame.

**Preventable?** Unknown until the cause is isolated. If it is the decode tail, generating N+8 frames and discarding 8 costs 8 x 12.96 s = 104 s and fixes it structurally.

**Repairable?** **Yes, essentially free:** trim the soft tail, or crossfade the shot out over it. Since we author the edit and the tail is where a cut lands anyway, trimming costs nothing in runtime.

**Controlled test needed before we act on the *cause*.** Measure Laplacian variance on the **raw PNG frames straight out of ComfyUI, before any H.264 encode**, across n >= 5 prompts with different content and motion profiles, plus one generation with 8 extra frames. That separates generator behaviour from encode behaviour and content confound. Not yet done.

---

### GROUP B - Object and subject integrity

#### B1. Subject / identity drift

**Definition.** The main subject's appearance changes over the shot - face, hair, clothing colour, proportions - without a narrative reason. VBench's `subject_consistency` (DINO cosine similarity across frames) and VBench-2.0's `Human Identity` (RetinaFace + ArcFace against the first frame) both target this ([arXiv:2311.17982](https://arxiv.org/abs/2311.17982), [arXiv:2503.21755](https://arxiv.org/abs/2503.21755)). VBench-2.0 splits out `Human Clothes` as a separate dimension because outfit drift is distinct from facial drift.

**Frame-to-frame signature.** As A2 but restricted to the subject mask: adjacent-frame similarity stays high, anchor-frame similarity decays. Discrete jumps (a shirt changing colour between frames 40 and 41) are a different and more damaging sub-case than continuous morphing.

**Why architecturally.** Latent drift plus the absence of any explicit identity constraint in the objective. The model is trained to produce *plausible next latents*, not *the same person*. Identity-preserving video work exists precisely because the base objective does not supply it ([arXiv:2510.14255](https://arxiv.org/html/2510.14255)).

**Pixel-detectable?** **Yes.** For faces: ArcFace embedding cosine similarity to frame 1, exactly as VBench-2.0 does; the *variance* of the frame-wise similarity series is the drift signal, and ArcFace is small enough to run on CPU. For clothing: mean colour of the subject region against frame 1. For general subjects without a face, DINO/CLIP features are the literature answer but too heavy to co-reside with the generator on 6GB; colour-histogram plus SIFT-match is the cheap substitute.

**Preventable?** Strongly, by shot length (same argument as A2) and by I2V anchoring - starting from a fixed reference image constrains the subject far harder than T2V.

**Repairable?** No, post-hoc. Trim to the stable prefix, or re-roll.

---

#### B2. Face distortion at small pixel scale

**Definition.** Faces occupying a small fraction of the frame come out malformed - asymmetric, smeared, wrong feature count - while the same model renders a large face acceptably.

**Frame-to-frame signature.** The face region has *lower* high-frequency structure than surrounding detail and *higher* frame-to-frame instability than the rest of the subject. Facial landmarks jitter, or fail to be detected at all on some frames.

**Why architecturally.** Latent resolution. Wan2.2's TI2V-5B VAE compresses 16x16 spatially, with a patchification layer bringing the total to about 4x32x32 ([model card](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B)). At 1024x576, a 32-pixel-wide face is **one latent token wide**. There is no representational capacity for a face at that scale. LTX-Video's authors state the general principle: high compression "inherently limits the representation of fine details" ([arXiv:2501.00103](https://arxiv.org/abs/2501.00103)).

**Pixel-detectable?** **Yes, and the cheap version is a geometry check, not a quality model.** Run a face detector; for every detected face compute its bounding-box width in pixels; flag any face below the latent-token threshold. We do not need to judge whether the face *looks* bad - we know a priori that a sub-32-pixel face cannot be represented. That inference is free and immune to detector quality on the aesthetics side.

**Preventable?** **Yes - the clearest prompt-level prevention in the taxonomy.** Either compose so faces are large (close or medium shots), or compose so no face is legible (backs turned, silhouettes, distance with obscured features, helmets, masks). The failure only happens in the middle ground, and the middle ground is avoidable by shot design.

**Repairable?** Partially and expensively: face-restoration models (GFPGAN/CodeFormer class) applied per frame introduce their own identity drift across frames unless temporally constrained. On 6GB, per-frame face restoration over 121 frames is not cheap. Prevention is strictly better.

---

#### B3. Hand and finger artifacts

**Definition.** Hands with wrong finger counts, fused or extra digits, impossible joint articulation. Well documented for image diffusion: models "suffer from generating accurate human hands, such as incorrect finger counts or irregular shapes" ([HandRefiner, arXiv:2311.17957](https://arxiv.org/abs/2311.17957)). VBench-2.0's Human Anatomy detector explicitly covers hands as a sub-region ([arXiv:2503.21755](https://arxiv.org/abs/2503.21755)).

**Frame-to-frame signature.** In video the failure is *unstable* rather than merely wrong: finger count changes between frames, digits merge and split. That temporal instability is easier to detect than static malformation.

**Why architecturally.** Hands are high-articulation, low-pixel-area, and high-variance in the training distribution; the model has weak priors and little latent budget for them. The same latent-resolution argument as B2 applies with extra force, because a hand needs *more* structural precision than a face at the same pixel size.

**Pixel-detectable?** **Yes, two ways.** (a) A hand-landmark detector: count detected digits per frame and flag variance across frames - the temporal inconsistency is the signal and it needs no quality judgment. (b) A trained malformed-hand detector; HandCraft contributes the MalHand datasets specifically for training one ([arXiv:2411.04332](https://arxiv.org/abs/2411.04332)). (a) is far cheaper and probably sufficient.

**Preventable?** **Yes, at prompt and composition level, and this should be policy.** Do not compose shots where hands are both prominent and doing fine manipulation. Gloves, occlusion, motion blur, holding an object, hands out of frame - all remove the failure surface.

**Repairable?** In images, yes - HandRefiner does conditional inpainting on the hand region ([arXiv:2311.17957](https://arxiv.org/abs/2311.17957)). In video, per-frame inpainting reintroduces flicker unless temporally conditioned, and costs a full inpaint pass per frame. **Not viable for us.** Detect, then re-roll with a modified prompt, or reject the shot.

---

#### B4. Limb duplication

**Definition.** A subject gains an extra arm, leg, or a duplicated body part, usually transiently. FlowMo names "duplicated or missing limbs" as one of the standard temporal artifacts of text-to-video models ([arXiv:2506.01144](https://arxiv.org/abs/2506.01144)).

**Frame-to-frame signature.** A new limb-like structure fades in over several frames in a region adjacent to the body, most often during fast motion or when a limb crosses the torso.

**Why architecturally.** BroadWay's finding is the sharpest available mechanism: "significant disparities between temporal attention maps across different blocks are associated with the occurrence of implausible structures and temporal inconsistencies" ([arXiv:2410.06241](https://arxiv.org/abs/2410.06241)). Different decoder blocks disagree about where the limb *is*, and the decoder resolves the disagreement by rendering both.

**Pixel-detectable?** **Partially, and expensively.** The literature answer is pose estimation: run a body-pose model per frame and flag keypoint-count anomalies or implausible skeleton topology. That is a real model in VRAM. A cheaper proxy exists in latent space - FlowMo's "patch-wise variance across the temporal dimension" of consecutive-frame latent differences, where "incoherent motion... introduces abrupt changes, manifesting as larger fluctuations and higher patch-wise variance" ([arXiv:2506.01144](https://arxiv.org/abs/2506.01144)). We hold the latents at generation time and would not need to decode. **Adapting FlowMo's variance signal as a cheap in-flight incoherence detector is the single most interesting research lead in this document.**

**Preventable?** Partially: reduce motion amplitude, avoid limbs crossing the body, avoid multiple humans in frame. Prompt-level mitigation is weak here compared with B2 and B3.

**Repairable?** No. Re-roll.

---

#### B5. Morphing and topology breaks

**Definition.** An object continuously deforms into a different object, or its topology changes (a hole opens, two parts fuse) without a physical cause. Distinct from B1 in that the *category* of the thing changes, not just its appearance.

**Frame-to-frame signature.** Adjacent-frame difference stays low - the morph is smooth - while structural correspondence to the anchor frame collapses. SIFT keypoint matches against frame 1 fall off a cliff while MAD stays flat. **That divergence between smooth pixel change and collapsing structural match is the specific fingerprint**, and it distinguishes morphing from a cut and from ordinary motion.

**Why architecturally.** The model optimises frame-to-frame plausibility, not object persistence. Nothing in a bidirectional-attention DiT enforces that the thing at frame 100 is the same object as at frame 1 - VBench-2.0 had to invent `Instance Preservation` as a separate dimension precisely because models "frequently struggle to maintain object counts due to unnatural merging, duplication, or disappearance" ([arXiv:2503.21755](https://arxiv.org/abs/2503.21755)).

**Pixel-detectable?** **Yes**, via the SIFT-versus-MAD divergence above. VBench-2.0 validates SIFT + FLANN + RANSAC for structural stability. CPU-cheap.

**Preventable?** Yes, by shot length and by reducing the number of distinct objects. Morph rate scales with frames and with scene complexity.

**Repairable?** No. Trim to the pre-morph prefix, which is usually recoverable, else re-roll.

---

#### B6. Object permanence failure

**Definition.** An object disappears, appears from nothing, merges with another, or splits - most often across an occlusion. VBench-2.0's `Instance Preservation` covers exactly "entity sudden merging, splitting, appearing, and disappearing" ([arXiv:2503.21755](https://arxiv.org/abs/2503.21755)). MemoBench isolates the hardest case: objects that leave frame, change state while out of view, and must return correctly ([arXiv:2606.27537](https://arxiv.org/abs/2606.27537)).

**Frame-to-frame signature.** Detector object count changes across frames with no exit or entry at the frame boundary. Merges show as two boxes becoming one with no collision.

**Why architecturally.** No persistent object memory. The model's state is the latent stack; nothing represents "there is an object, currently occluded". MemoBench's finding is that models "still struggle to preserve and update object states during occlusion" even when the video is otherwise coherent.

**Pixel-detectable?** **Yes but it costs a detector.** VBench-2.0 uses YOLO-World (open-vocabulary) for counting plus a fine-tuned VLM anomaly detector. YOLO-World-class detection over 121 frames is affordable *if* the generator is unloaded; it is not affordable concurrently on 6GB. This is a post-generation batch check, not an in-flight one.

**Preventable?** Yes, at composition level: avoid shots where objects pass behind occluders, avoid crowds, keep object count low.

**Repairable?** No. Re-roll.

---

#### B7. Text and signage garbling

**Definition.** Any rendered text - signage, labels, UI, in-scene subtitles - comes out as pseudo-letterforms, mirrored glyphs, or nonsense strings, and changes between frames.

**Frame-to-frame signature.** OCR confidence low and *unstable*: the recognised string differs frame to frame for text that should be static. EvalCrafter includes an `OCR-Score` for exactly this axis ([evalcrafter.github.io](https://evalcrafter.github.io/)).

**Why architecturally.** Diffusion models model images holistically and have no glyph-level structural prior. In video it is worse: the model must render the same glyphs identically 121 times. Wan's own report notes Chinese and English visual text support but its caption evaluation shows OCR as a relative weakness ([arXiv:2503.20314](https://arxiv.org/html/2503.20314v1)). Secondary sources describe the general open-model pattern of "garbled letters, mirrored characters, and nonsense strings" and OCR benchmarks report substantial headroom ([OCRGenBench](https://arxiv.org/html/2507.15085v4)) - treat the secondary framing as context, the Wan report as the load-bearing citation.

**Pixel-detectable?** **Yes, cheaply, with an unusually clean decision rule.** Run OCR on a handful of frames; if any text is detected at all in a Wan-generated shot, treat it as a defect *by default*, because we did not ask for text. Then check string stability across frames. We do not need to read it correctly - we need to know it is there and unstable.

**Preventable?** **Yes, completely, and this is the highest-leverage rule in the document.** Never ask the generator for text. Never put the camera on a sign, a screen, a book, a shopfront. Any text the piece needs is composited in post, where it is perfect, free, and editable. Zero compute, and it removes a failure mode hosted competitors visibly still ship.

**Repairable?** By compositing over it, if the region is stable enough to track. Generally: prevention only.

---

### GROUP C - Motion and physics

#### C1. Unnatural, floating, or weightless motion

**Definition.** Motion that is smooth and artifact-free but physically wrong: subjects glide rather than walk, objects drift without inertia, cloth and hair do not respond to movement.

**Frame-to-frame signature.** Optical flow is *too* smooth - low acceleration, no impulse discontinuities where a footfall or a collision should produce one. Foot contact points slide relative to the ground plane.

**Why architecturally.** VBench-2.0 exists because VBench "mainly represents superficial faithfulness, which focuses on whether the video appears visually convincing rather than whether it adheres to real-world principles" ([arXiv:2503.21755](https://arxiv.org/abs/2503.21755)). The model has learned the appearance statistics of motion, not its dynamics.

**Pixel-detectable?** **Partially.** The second derivative of the flow field is computable and cheap, and "implausibly low acceleration variance for the depicted action" is a real signal. Judging *correctness* of motion needs a VLM, which we do not have locally. The full version is **not detectable within our constraints**; the acceleration proxy is **UNVERIFIED** as a useful discriminator and would need calibration against real footage.

**Preventable?** Partially, by prompt: naming the physical interaction ("boots crunching on gravel", "wind pushing the coat") rather than only the action. **UNVERIFIED** whether this measurably improves Wan2.2 output. A testable prompt-lever hypothesis.

**Repairable?** No.

---

#### C2. Physics violations

**Definition.** Explicit breaches of physical law. VideoPhy enumerates the failure classes: "conservation of mass violation, Newton's First and Second Law violations, solid and fluid constitutive law violations, and non-physical penetration of objects" ([arXiv:2406.03520](https://arxiv.org/abs/2406.03520)). PhyGenBench covers 27 distinct physical laws across four domains ([arXiv:2410.05363](https://arxiv.org/abs/2410.05363)). VBench-2.0 splits Physics into Mechanics, Thermotics, Material and Multi-View Consistency ([arXiv:2503.21755](https://arxiv.org/abs/2503.21755)).

**Frame-to-frame signature.** Object trajectories that do not fit a ballistic or damped model; interpenetration; fluid volume changing; a state transition (ice to water, fire to smoke) that runs backwards or not at all.

**Why architecturally.** No world model. The training objective never sees a physics loss.

**Pixel-detectable?** **Mostly no, within our constraints.** Every benchmark that measures this uses a VLM - VBench-2.0's Mechanics, Thermotics and Material dimensions are all video-based multi-question answering with GPT-4o-authored questions. **Multi-View Consistency is the exception**: SIFT feature-matching stability plus RAFT camera-motion speed, both local ([arXiv:2503.21755](https://arxiv.org/abs/2503.21755)). Narrow trajectory checks (does this thrown object follow a parabola?) are implementable but need object tracking.

**Preventable?** Yes, strongly, at shot-design level: do not stage shots whose whole point is a physical interaction. Choose subjects and camera moves where physics is not load-bearing. A creative constraint that costs nothing.

**Repairable?** No.

---

#### C3. Motion smear, ghosting, and interpolation-like blur

**Definition.** Moving subjects leave semi-transparent trails, or fast motion resolves as blurred double-exposure rather than a coherent moving object.

**Frame-to-frame signature.** Edge energy of the moving region drops sharply relative to static regions; the moving object's silhouette shows two overlapping alpha-blended copies.

**Why architecturally.** The model averages over plausible positions when uncertain where a fast-moving object should be - the same "diffusion averages out high-frequency detail" mechanism cited in D1, applied along the motion axis. **UNVERIFIED** as a specifically documented Wan2.2 behaviour.

**Pixel-detectable?** **Partially.** Compute high-band energy inside the high-flow mask versus the low-flow mask; a large deficit in moving regions is smear. Cheap, since flow is already computed for A1 and A5. Distinguishing it from *intentional* cinematic motion blur is the hard part and probably needs a shutter-angle heuristic.

**Preventable?** Yes: constrain motion amplitude. Prompt for slower camera and subject motion. Directly tradeable against A5, since too little motion is also a defect - which means the correct move is to define a **target flow-magnitude band** and treat both tails as failures.

**Repairable?** Not really. Frame interpolation (RIFE class, [arXiv:2011.06294](https://arxiv.org/abs/2011.06294)) raises frame rate and reduces judder but cannot reconstruct detail that was averaged away at generation time.

---

#### C4. Camera motion failure

**Definition.** The camera does not execute the requested move, or executes an unrequested one - a static prompt yields drift, or a "slow dolly in" yields a pan.

**Frame-to-frame signature.** Global flow field dominated by a coherent translation, zoom or rotation component that does not match the prompt. VBench-2.0 measures this with CoTracker-v2 point tracking plus heuristics for nine camera-motion types ([arXiv:2503.21755](https://arxiv.org/abs/2503.21755)).

**Why architecturally.** Camera motion is only weakly disentangled in the text conditioning; the model learned camera language from captions that describe it inconsistently.

**Pixel-detectable?** **Yes and cheaply, without CoTracker.** Fit a global affine or homography to the flow field per frame pair; the decomposed translation, scale and rotation give the executed camera move directly. That is `cv2.estimateAffinePartial2D` on sparse flow - CPU, milliseconds. Compare against the intended move from the shot spec.

**Preventable?** Partially, by using the model's own camera vocabulary. Wan2.2 was trained with "meticulously curated aesthetic data with detailed labels for lighting, composition, contrast, and color tone" ([model card](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B)), so matching caption vocabulary matters.

**Repairable?** **Partially and cheaply, which is unusual for this group.** Unwanted camera drift can be stabilised post-hoc with the same estimated homography (`ffmpeg vidstab`, or apply the inverse transform) at the cost of a small crop. A *missing* move cannot be added convincingly. So: drift, fix in post; wrong move, re-roll.

---

### GROUP D - Appearance and render quality

#### D1. "AI sheen" - over-smoothed plastic look

**Definition.** Surfaces, especially skin, render with suppressed micro-texture: no pores, no fine fabric weave, no grain. Uniform, airbrushed, slightly waxy. Nothing is *wrong* in any single frame; the whole thing just reads as synthetic.

**Frame-to-frame signature.** Not a temporal defect. The signature is spectral: the high-frequency band of the spatial power spectrum is depressed relative to real footage of comparable content, and unusually *uniform* across the frame.

**Why architecturally.** Three compounding causes.
1. **Denoising is averaging.** Diffusion constraints "can unintentionally suppress high-frequency details, causing over-smoothing", most visible "in texture-rich and detail-heavy images" ([Scientific Reports](https://www.nature.com/articles/s41598-025-96185-2)). Diffusion-based super-resolution is independently observed to be "inferior at generating high-frequency details" ([arXiv:2405.17261](https://arxiv.org/pdf/2405.17261)).
2. **VAE compression.** Our VAE discards roughly 64x of the signal before the decoder sees it; LTX-Video states the general consequence: high compression "inherently limits the representation of fine details" ([arXiv:2501.00103](https://arxiv.org/abs/2501.00103)).
3. **Aesthetic-data training.** Wan2.2 was explicitly trained on curated aesthetic data ([model card](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B)), which biases toward clean, pleasing, texture-poor surfaces.

**Pixel-detectable?** **Yes**, as a spectral statistic: radially averaged power-spectrum slope, or high-band Laplacian/wavelet energy, compared against a reference distribution from real footage. What it needs is a **calibration set** - the measure is only meaningful relative to what real footage of that content scores. We do not have that reference set yet.

**Preventable?** Partially. Prompting for material and texture language ("weathered", "grain", "worn") helps at the margin. **UNVERIFIED** for Wan2.2 specifically. One of the highest-value prompt experiments to run, because the fix is free.

**Repairable?** **Yes, cheaply, and this is one of the best compute-to-perceived-quality trades available.** Calibrated film grain, a subtle unsharp mask, and slight chroma/luma texture in `ffmpeg` cost seconds per shot and measurably shift output away from the plastic look. It does not add real detail, but perceptually it defeats the specific tell that makes footage read as AI.

---

#### D2. Low-level imaging distortion

**Definition.** Blur, noise, over-exposure, blocking, banding - the classical image-quality defects. VBench's `imaging_quality` dimension measures exactly these with MUSIQ trained on SPAQ ([arXiv:2311.17982](https://arxiv.org/abs/2311.17982)).

**Frame-to-frame signature.** Per-frame, content-independent quality degradation. Banding shows as large flat regions with visible step contours, especially in skies and gradients.

**Why architecturally.** Mixed: VAE reconstruction limits, quantisation of the decoder, and - critically for us - **the final H.264 encode**. Banding in particular is usually an 8-bit encode artifact, not a generator artifact.

**Pixel-detectable?** **Yes.** Blur via Laplacian variance, noise via a high-pass estimate in flat regions, over-exposure via clipped-pixel fraction, banding via counting distinct luma levels in smooth gradient regions. All numpy.

**Preventable?** Yes, largely at the encode stage: higher bitrate, lower CRF, a 10-bit intermediate, dithering before 8-bit quantisation. Zero generator cost.

**Repairable?** Only by re-encoding from source frames if we still hold them. **Implication: keep the raw PNG/EXR frames until QC has passed.** Discarding them and keeping only the mp4 makes an entire class of defect unrepairable for no reason.

---

#### D3. Aspect, crop, and resolution-bucket artifacts

**Definition.** Generating at an aspect ratio or resolution outside the model's training buckets produces repeated elements, doubled subjects, unnatural cropping of the subject, or degraded coherence.

**Frame-to-frame signature.** Duplicated structures at regular spatial intervals; subjects consistently cropped at the frame edge; coherence noticeably worse than the same prompt at native resolution.

**Why architecturally.** Video models are trained with aspect-ratio bucketing - Movie Gen uses five aspect-ratio buckets and bucketises data "according to aspect ratio and length" so every video in a bucket yields the same latent shape ([arXiv:2410.13720](https://arxiv.org/pdf/2410.13720)). Off-bucket generation is out of distribution. Separately, going meaningfully beyond a model's native resolution tends to introduce repeated image elements.

**This is directly relevant to us.** The Wan2.2-TI2V-5B card names **1280x704 or 704x1280** as the 720P resolution ([model card](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B)). Our measured sample runs at **1024x576** - same 16:9 family, but not the stated native size. Whether Wan2.2 degrades at 1024x576 is **UNVERIFIED** and is a cheap, high-value A/B: same prompt and seed at 1024x576 versus 1280x704, compared on the flicker, sharpness and drift metrics below.

**Pixel-detectable?** Partially: self-similarity or autocorrelation peaks at fixed spatial offsets catch repeated elements. Mostly this should be a **config guard**, not a detector - refuse or warn on off-bucket resolutions before spending 26 minutes.

**Preventable?** Yes, entirely, at zero cost. Generate at a native bucket and crop or letterbox in post.

**Repairable?** Crop and resize, if the artifact is at the edges. Repeated central elements: no.

---

### GROUP E - Pipeline-specific: distilled, quantised, and stitched

This group is where our system differs from a hosted service, and therefore where our detectors have to be original.

#### E1. Distillation artifacts (few-step models)

**Definition.** Defects introduced by training a student to reproduce a multi-step teacher in far fewer steps. Three named, measured effects: **oversaturation**, **temporal collapse**, **blur**.

**Frame-to-frame signature.** Oversaturation as in A3; temporal collapse as in A5 (Dynamic Degree 72.22% versus the teacher's 85.56% in the ablation, [arXiv:2603.21864](https://arxiv.org/html/2603.21864v1)); blur as a global drop in high-band energy. Deterministic distillation methods specifically "produce very blurry few-step generation results due to optimization inaccuracy and reduced Lipschitz constant in the student model".

**Why architecturally.** Distribution-matching objectives adapted from image distillation "frequently lead to artifacts such as oversaturation, temporal inconsistency, and mode collapse" ([arXiv:2603.21864](https://arxiv.org/html/2603.21864v1)).

**Pixel-detectable?** Yes - all three components have cheap detectors already listed (A3, A5, D1).

**Preventable?** Yes: **choose not to use a distilled checkpoint**, or use one with a temporal regularisation term. The tradeoff is direct and quantifiable: at 12.96 s/frame, going from 20 steps to 4 steps saves about 21 minutes per shot. If a distilled model costs us a measurable Dynamic Degree drop and a saturation shift, that is a decision we can make with numbers rather than vibes. **Measure it before adopting one.**

**Repairable?** Oversaturation yes, cheaply. Temporal collapse no. Blur partially, via sharpening and grain.

---

#### E2. Quantisation artifacts (Q4 - what we actually run)

**Definition.** Defects caused by low-bit weight and activation quantisation of the diffusion transformer. **The least-documented and most directly relevant category for VYREALM.**

**Frame-to-frame signature.** ViDiT-Q's failure analysis of video DiT quantisation is the best primary source and it names the artifacts precisely ([arXiv:2406.02540](https://arxiv.org/abs/2406.02540)):
- objects that **"jitter and tremble"** across frames
- **"color shifting"**, hues distorted or washed out
- **subject consistency breakdown** - an object part "suddenly appears" between frames
- **scene consistency failure** - structures "change significantly across frames"
- at aggressive W4 settings without proper handling: **"blank images or noise"**, "nearly pure noises"

ViDiT-Q attributes the temporal component to disruption of cross-attention and temporal-attention layers, and the W4 collapse to grouping mechanisms that "struggle to handle the large output channel variation under W4".

A more recent paper working on **exactly our model family** - few-step distillation plus low-bit quantisation of Wan2.2 - states that errors accumulating across denoising steps and frames "first appear in **Subject Consistency** and **Motion Smoothness**", and that small numerical perturbations can cause "subject drift, flicker, or unstable motion" ([arXiv:2606.00658](https://arxiv.org/html/2606.00658)). Reported honestly: that paper's own W4A4 configuration matches or beats FP baselines at equal step count, so quantisation is not automatically ruinous. The failure is configuration-dependent.

**Why architecturally.** Quantisation error is a small perturbation injected at every layer of every denoising step. In a video model that perturbation propagates along the temporal axis, so it surfaces first in the metrics that integrate across frames - which is precisely why Subject Consistency and Motion Smoothness are the leading indicators.

**Pixel-detectable?** **Yes, and the leading-indicator claim gives us a targeted test.** We do not need a general "is this quantised" detector. We need to compare our Q4 output against a higher-precision reference on **subject consistency and motion smoothness specifically**. Bounded experiment: same prompt, same seed, Q4 versus Q5/Q6/Q8 if any fits, measured on those two dimensions.

**Preventable?** Partially: quantisation format matters more than bit width. ViDiT-Q's channel balancing and mixed precision, and HiF4-style formats with entrance-layer protection ([arXiv:2606.00658](https://arxiv.org/html/2606.00658)), show W4 is not inherently broken. Practically: if a Q5 or Q6 GGUF fits in 6GB, comparing it against Q4 on the two leading-indicator metrics decides whether we are paying quality for VRAM we did not need to save.

**Repairable?** Colour shift yes, cheaply. Jitter partially, via temporal filtering. Consistency breakdown no.

---

#### E3. Cut-boundary discontinuity

**Definition.** At a join between two generated shots the eye catches a mismatch - exposure step, colour step, or a subject that jumps position or appearance across a cut meant to be continuous.

**Frame-to-frame signature.** A single-frame-pair spike in MAD and colour-histogram distance at the join.

**Why architecturally.** Independent generations share no state. Each shot has its own drift trajectory (A2, A3), so shot N ends somewhere different from where shot N+1 begins.

**Pixel-detectable?** **In principle yes, but our own measurement says naive detection is unreliable - and more importantly, it is unnecessary.** We *author* the edit; cut frame indices are known exactly from the edit list. Spending compute to detect what we already know is the definition of a wasted pass. (Measured evidence in section 3.4: on our 15 s three-shot trailer a global 3x-median MAD threshold produced **77 candidate cuts for 2 real cuts**, and a colour-histogram distance ranked the true cuts *below* several intra-shot frames.)

What *is* worth measuring at a known cut is the **magnitude of the mismatch**: mean luma and mean chroma of the last k frames of shot N versus the first k frames of shot N+1.

**Preventable?** Partially, by generating adjacent shots with matched conditioning: same seed family, same lighting language, I2V-anchored to the same reference.

**Repairable?** **Yes, and cheaply - a strong compute trade.** Match colour and exposure of each shot to a common target before the join, and place a short crossfade or a hard cut on a motion beat. `ffmpeg` work, seconds. Combined with A7 (trim the soft tail), the shot join is one of the places where post-processing genuinely buys perceived quality the generator could not.

---

#### E4. Encode-stage artifacts

**Definition.** Defects introduced after generation by the H.264 (or other) encode: banding, blocking, chroma-subsampling smear on saturated edges, and rate-control-driven detail loss.

**Frame-to-frame signature.** Blocking on an 8x8 or 16x16 grid at low bitrate; banding in gradients; red and orange edges smearing from 4:2:0 chroma subsampling.

**Why architecturally.** Lossy codec at finite bitrate, plus 8-bit 4:2:0 output. Our measured sample is `yuv420p` at about 4.97 Mbps, so all three mechanisms are live.

**Pixel-detectable?** Yes: distinct-luma-level counting for banding, block-boundary energy for blocking, per-frame packet size from `ffprobe` for rate-control behaviour.

**Preventable?** Yes, free: higher bitrate / lower CRF, `yuv420p10le` intermediate, dither before 8-bit.

**Repairable?** Only by re-encoding from source frames - another reason to keep them (D2).

**Why it matters for our metrics, not just our output.** Encode artifacts contaminate every pixel measurement we take. Any quality metric computed on the *encoded* mp4 is measuring generator plus encoder. The quality engine must run on the raw frames.

---

## 3. Measured on our own output

Real numbers from actually running code on our own files. No estimates. Tooling: `ffprobe` at `workers/tools/ffprobe.exe`, and OpenCV 4.12.0 with numpy 2.5.2 under `D:\VYREALM-runtime\bootstrap-qualification\full-install\VYREALM-local-video-v1\venv\Scripts\python.exe` (package presence verified via `pip list` before use, per house rules: `cv2`, `numpy`, `scipy`, `torch`, `av`, `pillow`, `scikit-learn` are all installed).

### 3.1 Container facts

`outputs/desktop/VYREALM_ANIME_HERO_5S.mp4` - h264, 1024x576, `yuv420p`, 24/1 fps, **121 frames**, 5.041667 s, 4,970,483 bps, 3,134,779 bytes.

### 3.2 Frame statistics, `VYREALM_ANIME_HERO_5S.mp4` (native 1024x576)

| Measure | Value |
|---|---|
| Consecutive-frame MAD (gray, 0-255) | mean 4.789, median 4.101, min 0.571, max 12.220, p95 10.010 |
| VBench-style temporal-flickering proxy `(255-meanMAD)/255` | **0.9812** |
| Near-duplicate pairs (MAD < 0.5) | **0 / 120** |
| MAD spikes above 3x median | **0** |
| Farneback flow magnitude | mean-of-means 0.302 px, mean-of-p95 1.208 px, max-p95 7.025 px, min-p95 0.254 px |
| Laplacian variance (sharpness) | first 1381.4, last 696.8, mean 1341.8, median 1382.3, min 696.8, max 1716.3 |
| HSV S mean | first 96.03 to last 109.56 (**+13.53**), overall 108.21 |
| HSV V mean | first 189.60 to last 181.98 (-7.62) |
| Fraction of pixels with S = 255 (clipped chroma) | mean **0.13645**, max 0.15744 |

Readings:
- **No stall, no duplication, no flicker problem.** A flicker proxy of 0.9812 and zero duplicate pairs say this shot is temporally clean under the two cheapest detectors.
- **Motion is low.** Mean-of-p95 flow of 1.2 px/frame is gentle. Under VBench's Dynamic Degree framing (top-5% flow decides static vs non-static) this sits near the boundary. Worth knowing that our "good" sample is a low-motion sample: the detectors have not been stress-tested against a high-motion one.
- **13.6% of all pixels are chroma-clipped, and saturation climbs +13.5 over 5 seconds.** A3 is present and measurable in our current output, and it is also the cheapest thing on this list to fix.

### 3.3 The tail-softening finding (A7), with confound tests

Native-resolution Laplacian variance over the final 16 frames of `VYREALM_ANIME_HERO_5S.mp4`, as a ratio to the shot median (1382.3):

```
frame 105: 1377.1  (0.996)      frame 113: 1006.6  (0.728)
frame 106: 1259.7  (0.911)      frame 114:  896.6  (0.649)
frame 107: 1238.2  (0.896)      frame 115:  922.6  (0.667)
frame 108: 1219.2  (0.882)      frame 116:  828.7  (0.600)
frame 109: 1179.0  (0.853)      frame 117:  772.2  (0.559)
frame 110: 1136.4  (0.822)      frame 118:  780.5  (0.565)
frame 111: 1171.3  (0.847)      frame 119:  711.5  (0.515)
frame 112:  948.5  (0.686)      frame 120:  696.8  (0.504)
```

A monotone ramp over the last ~15 frames ending at **50.4% of the shot median**. Not a single-frame edge effect.

Same pattern in the three independent Wan2.2 shots inside `VYREALM_RAINLINE_TRAILER_1080P.mp4` (analysed at 960 px width). Last-frame divided by first-frame Laplacian variance: **shot 1 = 0.507, shot 2 = 0.494, shot 3 = 0.213**. Four shots, four terminal drops.

**Confound tests run:**

1. **Is it the H.264 encode?** Per-frame packet sizes, quartile means: Q1 = 27,348, Q2 = 27,844, Q3 = 25,660, Q4 = 23,393 bytes. **A 14% bitrate decline cannot explain a 50% high-frequency decline.** GOP structure: 1 I-frame, 31 P, 89 B. Encoding is *a* contributor, not *the* cause.
2. **Is it luminance?** Mean luma falls only 155.53 to 147.81 across the clip, about -5%. Pearson r(Laplacian variance, luminance) = -0.509 at 512 px analysis width. Direction is wrong and magnitude far too small.
3. **Is it motion blur?** Farneback flow *decreases* across quartiles: 0.703, 0.605, 0.456, 0.372 px. The clip gets **slower** as it gets softer, so motion blur is ruled out.
4. **Is it scale-dependent?** Yes, and this is the sharpest result. Laplacian-variance trend by analysis resolution:

| Analysis width | Slope per frame | r with frame index | Quartile means |
|---|---|---|---|
| 1024 (native) | **-1.539** | **-0.283** | 1302.8, 1438.0, 1433.7, 1214.0 |
| 512 | +0.778 | +0.146 | 1653.2, 1820.8, 1875.5, 1780.8 |
| 256 | +1.505 | +0.543 | 1445.5, 1553.2, 1542.0, 1630.1 |

**The decay lives entirely in the finest spatial band.** Downscale by two and it vanishes. That localises the loss to pixel-scale high frequency, consistent with a VAE-decode or late-denoise effect rather than semantic drift.

**Honest limits.** One clip plus three shots from one pipeline, all H.264-encoded, all from the same generator config. The cause is **UNVERIFIED**. The controlled test that settles it: measure on **raw PNG frames before any encode**, n >= 5 prompts spanning motion and content, plus one run generating 8 extra frames to see whether the ramp follows the clip end or a fixed frame index.

**Regardless of cause, the action is the same and it is free:** trim or crossfade the last ~12 frames of every shot. Those frames land on a cut anyway.

### 3.4 Cut detection is unreliable - measured, on `VYREALM_RAINLINE_TRAILER_1080P.mp4`

360 frames, three 120-frame Wan2.2 shots. True cuts at frame-pairs **119** and **239**.

- Consecutive-frame MAD: mean 11.039, median 6.185, min 1.526, max 88.714, p95 33.268. Flicker proxy 0.9567. Duplicate pairs 0/359.
- **A global "MAD > 3x median" rule fires 77 times.** 77 candidates for 2 real cuts.
- Top-8 MAD frame-pairs: `239 (88.71)`, `146 (46.68)`, `145 (46.62)`, `134 (41.68)`, `149 (40.20)`, `137 (39.67)`, `147 (38.84)`, `119 (38.23)`. The real cut at 239 ranks first, but the real cut at **119 ranks eighth**, below six intra-shot high-motion frames.
- **Colour-histogram distance is worse, not better.** Top-8 Bhattacharyya distances on 8x8x8 BGR histograms: `126 (0.816)`, `125 (0.753)`, `157 (0.532)`, `194 (0.510)`, `132 (0.502)`, `195 (0.500)`, `154 (0.469)`, `168 (0.459)`. **Neither true cut appears in the top 8.**

**Conclusion, with evidence:** do not build a shot-boundary detector. Take cut positions from the edit list. Use the frames around known cuts only to measure the *magnitude* of the mismatch (E3).

### 3.5 An operational constraint discovered by accident

Holding all decoded frames of the 1080p clip in memory failed: `numpy._core._exceptions._ArrayMemoryError: Unable to allocate 5.93 MiB for an array with shape (1080, 1920, 3)`, and Farneback flow at 1080p failed with `cv2.error ... (-4:Insufficient memory) Failed to allocate 41472000 bytes`. On this box under normal load, **full-resolution whole-clip frame analysis does not fit**. The quality engine must stream frames (retaining only the previous frame) and compute optical flow on a downscaled copy. This is a hard requirement, not a nicety - it bit three times during this research.

---

## 4. Ranked priority: perceived-quality damage per unit of compute to fix

Ranking rule: **(perceptual damage x detection reliability) / (detection cost + repair cost)**, with a 26-minute re-roll as the unit of expensive repair and an `ffmpeg` pass as the unit of cheap repair. Damage 1-5. Costs: **free** (config or prompt), **cheap** (CPU seconds), **mid** (a model in VRAM, or a full pass over frames), **expensive** (re-roll).

| # | Failure mode | Damage | Detect cost | Detect reliability | Repair | Repair cost | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | **B7 Text / signage garbling** | 5 | cheap (OCR on ~8 frames) | high | prevent: never prompt text, composite in post | **free** | **Do first.** Total elimination of a top-3 AI tell for zero compute. |
| 2 | **A3 Colour drift / oversaturation** | 4 | **cheapest we have** (HSV stats) | high | per-shot colour normalisation | **cheap** | **Do first.** Already measurably present (13.6% clipped chroma). Never re-roll for this. |
| 3 | **A7 Terminal detail collapse** | 3 | cheap (Laplacian variance) | high (4/4 shots) | trim or crossfade the tail | **free** | **Do first.** Original to us; cause still to be confirmed but the fix is free either way. |
| 4 | **A5 Frame duplication / stall** | 5 | cheap (MAD + flow) | **highest** | none, re-roll | expensive | **Do first, as a gate.** Detection is near-perfect, so the expensive re-roll is justified. |
| 5 | **D3 Aspect / resolution bucket** | 4 | **free** (config guard) | exact | generate at a native bucket | **free** | **Do first.** A pre-flight assert, not a detector. Saves whole 26-minute runs. |
| 6 | **B2 Face distortion at distance** | 5 | cheap (face box width vs latent-token size) | high | prevent by shot design | **free** | **Do first.** A geometric precondition, checkable before generating. |
| 7 | **A6 VAE chunk seams** | 4 | cheap (stride-4 periodicity in MAD) | high, distinctive | fix decode config | **free** | High value: a bug-class defect, permanently removable, and a detector nobody else ships. |
| 8 | **E3 Cut-boundary mismatch** | 3 | **free** (cuts known from the edit list) | exact | colour/exposure match plus crossfade | cheap | High value. Do *not* build a cut detector - evidence in 3.4. |
| 9 | **D1 "AI sheen"** | 4 | mid (needs a real-footage calibration set) | medium | grain plus micro-contrast | **cheap** | High value once calibrated. The repair is cheap even when the detector is imperfect. |
| 10 | **D2 / E4 Imaging and encode artifacts** | 3 | cheap | high | re-encode from source frames | cheap | Easy, but **conditional on keeping raw frames.** Make that a pipeline rule now. |
| 11 | **A1 Temporal flicker** | 4 | cheap (VBench formula) | high | temporal filter (mild) or re-roll (severe) | cheap to expensive | Do it; the detector is free and already exercised in section 3. |
| 12 | **C4 Camera motion failure** | 3 | cheap (affine fit to flow) | high | stabilise drift; re-roll a wrong move | cheap to expensive | Good ratio; the unwanted-drift half is cheap to fix. |
| 13 | **B3 Hand / finger artifacts** | 5 | mid (landmark count variance) | medium-high | prevention only | free to prevent, expensive to re-roll | High damage. Make it a **composition rule** first, a detector second. |
| 14 | **A2 / B1 Background and subject drift** | 4 | mid (SIFT-match or ArcFace vs anchor) | high | trim to stable prefix, else re-roll | cheap to expensive | Shorten shots as prevention; the trim repair is cheap and often enough. |
| 15 | **B5 Morphing / topology break** | 5 | mid (SIFT-vs-MAD divergence) | medium | trim, else re-roll | expensive | High damage, workable detector, no cheap repair. |
| 16 | **E2 Q4 quantisation artifacts** | 3 | mid (A/B vs higher precision on Subject Consistency and Motion Smoothness) | high, per the source | change quant format | one-off | Not a per-shot check - a **one-time experiment** that then sets a config forever. |
| 17 | **B4 Limb duplication** | 5 | mid to expensive (pose model, or FlowMo latent variance) | medium | none | expensive | High damage but expensive on both sides. The FlowMo latent-variance route could move this up a lot if it works. |
| 18 | **C3 Motion smear** | 2 | cheap (HF energy inside the flow mask) | medium | none | expensive | Fold into a target flow band rather than treating as its own defect. |
| 19 | **B6 Object permanence** | 4 | expensive (open-vocab detector, generator unloaded) | medium | none | expensive | Post-batch audit at most. Prevent by composition. |
| 20 | **C1 Floating motion** | 3 | expensive (needs a VLM) | low locally | none | expensive | Prevent by shot design. Not detectable within our constraints. |
| 21 | **C2 Physics violations** | 4 | not feasible locally (VLM) | n/a | none | expensive | Prevent by staging. Exception: Multi-View Consistency (SIFT + RAFT) *is* local and worth having. |
| 22 | **A4 Luminance pumping** | 2 | cheap | high | `ffmpeg deflicker` | cheap | Free to add once A3's colour machinery exists. |
| 23 | **E1 Distillation artifacts** | 3 | reuses A3 and A5 detectors | high | do not adopt a distilled model | free | Only matters if we adopt one. Decide with measurements, not defaults. |

### What the ranking actually says

1. **The top six are all prevention or near-free repair.** Nothing in the top six requires a re-roll. At a 200:1 compute ratio between re-rolling and post-processing, that is the correct shape.
2. **Only two defects justify spending 26 minutes on a re-roll: A5 (stall) and severe A1 (flicker).** Both because detection reliability is near-perfect. Everything else with an expensive repair should first try trim-to-prefix.
3. **Three checks belong *before* generation, not after:** the resolution-bucket guard (D3), the face-size geometry check (B2), and the no-text rule (B7). A pre-flight validator that rejects a bad shot spec in milliseconds is worth more than any post-hoc detector, because it saves the whole 1568 s.
4. **Two detectors are genuinely original to a system like ours**, and no hosted competitor exposes them: the **stride-4 VAE seam detector** (A6) and the **terminal-detail-collapse detector** (A7). Both come directly from knowing our own architecture.
5. **The highest-upside research lead** is FlowMo's patch-wise temporal variance of consecutive-frame latent differences ([arXiv:2506.01144](https://arxiv.org/abs/2506.01144)). It operates on latents we already hold, before VAE decode, so it could gate a bad generation *during* sampling rather than after. The only detector in this document with the potential to save compute instead of spending it.

---

## 5. Known gaps

Stated plainly so nobody builds on sand.

1. **A7's cause is unconfirmed.** Four shots agree on the effect; the mechanism is not established. The controlled test is specified in 3.3 and has not been run.
2. **All measurements are post-H.264.** Every number in section 3 includes encoder influence. The quality engine must be validated on raw frames.
3. **One content type, low motion.** Both samples are stylised, gentle-motion clips. The detectors are untested against fast action, crowds, water, fire, and hands.
4. **No reference distribution.** The D1 "AI sheen" detector and every "is this value bad?" threshold need a calibration set of real footage. We have none.
5. **No Q4-versus-higher-precision A/B has been run.** E2's ranking assumes the leading-indicator claim from [arXiv:2606.00658](https://arxiv.org/html/2606.00658) transfers to our GGUF build. Unproven here.
6. **The 1024x576 versus 1280x704 question is open** (D3) and cheap to settle.
7. **VBench's exact thresholds are not reproduced here.** I have the formulas and the models; VBench's pass/fail cut points are relative to a leaderboard, not absolute. Our thresholds must be set from our own distribution.
8. **T2VBench is a weak source.** It is cited for temporal-dimension framing only; I did not extract its 16 temporal dimensions individually, and one search result surfaced an IEEE Xplore retraction notice for a version of it. Prefer VBench and VBench-2.0 wherever they overlap.
9. **FETV's warning applies to us directly:** it found that "existing automatic metrics (e.g., CLIPScore and FVD) correlate poorly with human evaluation" ([arXiv:2311.01813](https://arxiv.org/abs/2311.01813)). Every detector in this document is a proxy. They should gate obvious defects, not be mistaken for taste.
