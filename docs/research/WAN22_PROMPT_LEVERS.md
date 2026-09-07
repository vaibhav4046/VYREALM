# WAN2.2 TI2V-5B PROMPT AND SAMPLER LEVERS

Research date: 2026-09-07. Target: Wan2.2 TI2V-5B, Q4_K_M GGUF, 1024x576, RTX 3050 Laptop 6 GiB.

**Nothing in this document is a measurement of our own output.** Every number is either (a) read out of a
primary source file, (b) arithmetic over primary-source constants, or (c) an attributed third-party claim.
Where a lever is untested here it is labelled `UNVERIFIED` with the experiment that would settle it. Two
items are labelled `MEASURED` and come from `TASKS.md`, which records our own three generations.

---

## 0. Source table

| Tag | Source | What it is |
|---|---|---|
| `REPO-CFG` | `Wan-Video/Wan2.2` → `wan/configs/wan_ti2v_5B.py` | Vendor reference inference constants for *our exact model* |
| `REPO-NEG` | `Wan-Video/Wan2.2` → `wan/configs/shared_config.py` | Vendor default negative prompt + `text_len` |
| `REPO-SYS` | `Wan-Video/Wan2.2` → `wan/utils/system_prompt.py` | Vendor's own LLM prompt-rewriter rules and worked examples |
| `REPO-README` | `Wan-Video/Wan2.2` README / HF model card | Resolution, VAE compression, VRAM |
| `COMFY-TPL` | `Comfy-Org/workflow_templates` → `templates/video_wan2_2_5B_ti2v.json` | The official ComfyUI 5B template |
| `COMFY-SRC` | `comfyanonymous/ComfyUI` → `comfy/model_sampling.py` | The actual `shift` implementation |
| `SD3` | Esser et al., *Scaling Rectified Flow Transformers*, arXiv:2403.03206 §5.3.2 | Where resolution-dependent shift comes from |
| `ALI-DOC` | Alibaba Cloud Model Studio, Wan text-to-video prompt guide | Vendor-published prompt guide |
| `REPLICATE` | Replicate, "Wan2.1 parameter sweep" | Empirical sweep, **Wan2.1 14B**, not our model |
| `MUSUBI` | `kohya-ss/musubi-tuner` discussion #797 | Community flow-shift analysis (training-oriented) |
| `GGUF` | city96 ComfyUI-GGUF docs + community quant guides | Quantisation quality, lowest confidence tier |

Sources are named inline as `[TAG]`.

---

## 1. Prompt structure

### 1.1 The constants that bound the question

From `[REPO-NEG]`: `wan_shared_cfg.text_len = 512`. UMT5-XXL truncates at 512 tokens, so prompt length is
capped by the encoder, not by taste. Our current `SMOKE_PROMPT` is **93 words / 597 characters** (counted,
not estimated), comfortably inside that ceiling. Length is not our problem; ordering and stage-splitting are.

### 1.2 What the vendor's own rewriter enforces

`[REPO-SYS]` is the strongest evidence available, because it is the instruction set Alibaba gives an LLM to
manufacture prompts *for this model family*. Verbatim rules from `T2V_A14B_EN_SYS_PROMPT`:

- Pick **no more than 4** cinematic settings, from a closed vocabulary (time / light source / light intensity
  / light angle / tone / shot size / shooting angle / composition). "可以任选，不必每项都有" — optional, not
  all required. **More aesthetic tags is explicitly not better.**
- Defaults when unspecified: `Day time`; shot size `Medium shot` or `Wide shot`; composition `Center composition`.
- **"若原始prompt中有运镜的描述，则取消添加此项"** — if the prompt already describes camera *movement*,
  drop the shooting-angle tag. Camera move and camera angle compete; do not specify both.
- **"不要输出关于氛围、感觉等文学描写"** — do not write atmosphere or mood prose ("full of tension",
  "a sense of longing"). Explicitly banned.
- Describe the motion *process*. If there is no action, add one — including background motion (drifting
  clouds, wind in leaves).
- Style goes **first** if a style exists; if no style is given, add none. For non-photoreal styles (2D
  illustration etc.) drop the cinematic-aesthetic vocabulary entirely.
- **"若prompt出现天空的描述，则改为湛蓝色的天空相关描述，避免曝光"** — rewrite any sky mention to an
  azure-blue sky, to avoid blowing out the exposure. A named, model-specific failure dodge.
- Length: `60-200字`. The I2V rewriter says **"Limit the rewritten prompt to 100 words or less."**

### 1.3 The actual observed order (this contradicts the popular guides)

Every worked example in `[REPO-SYS]` puts the **cinematic tag block first**, as a bare comma list, before the
subject. Example 1 verbatim:

> `Edge lighting, medium close-up shot, daylight, left-heavy composition. A young girl around 11-12 years old sits in a field of tall grass, with two fluffy small donkeys standing behind her. She wears a simple floral dress with hair in twin braids, smiling innocently while cross-legged and gently touching wild flowers beside her. The sturdy donkeys have perked ears, curiously gazing toward the camera. Sunlight bathes the field, creating a warm natural atmosphere.`

Example 3 verbatim:

> `Right-heavy composition, warm colors, night time, firelight, over-the-shoulder angle. An eye-level close-up of a foreign woman indoors wearing brown clothes...`

So the primary-source order is:

```
[STYLE, if any] → [≤4 aesthetic tags, comma list] → [SUBJECT + appearance] →
[SUBJECT ACTION, described as a process] → [SECONDARY SUBJECTS + their motion] → [SCENE / LIGHT closer]
```

**Disagreement, stated plainly.** The widely-syndicated community formula is "subject first, motion second,
camera third, scene last", and `[ALI-DOC]` itself gives `Entity + Scene + Motion + Aesthetic control +
Stylization` — aesthetic control *fourth*. That ordering is contradicted by all four worked examples in
`[REPO-SYS]`, which are what the vendor's own tooling actually emits. My read: `[ALI-DOC]` is a
human-readable checklist of *what to include*, `[REPO-SYS]` is the machine spec for *what order to emit*.
Prefer `[REPO-SYS]`.

**Caveat, and it is a real one:** `system_prompt.py` contains no `TI2V_5B_*` entry — I checked. The rules
above are `T2V_A14B` and `I2V_A14B`. They are the closest primary evidence for a sibling model in the same
release, not a 5B-specific spec. Treat as strong prior, not proof.

### 1.4 T2V and I2V need *different* prompts — we are not doing this

`[REPO-SYS]`'s `I2V_A14B_EN_SYS_PROMPT` is a different job from the T2V one:

> "Focus on dynamic content in the video description and avoid adding static scene descriptions. **If the
> user's input already describes elements visible in the image, remove those static descriptions.**"

Its examples are one or two clauses long: *"The camera pulls back to show two foreign men walking up the
stairs. The man on the left supports the man on the right with his right hand."*

`[ALI-DOC]` says the same thing: for image-to-video the image already fixes entity, scene and style, so the
prompt should carry motion and camera only.

**Our pipeline violates this.** In `runtime/neural-production.mjs`, `produceNeuralSmoke` builds the keyframe
stage and the motion stage from the *same* `prompt` variable (lines 238 and 241). The motion stage receives
the full 93-word scene description whose subject, wardrobe, location and lighting are already baked into the
start image. Per the vendor's own I2V rules that static text should be stripped. This is the single most
concrete structural finding in this document, and it is a code change, not a wording change.

---

## 2. The negative prompt

### 2.1 Correction to the brief

The task brief states our negative prompt is "a Chinese string inherited from the Wan repo." **It is not.** I
grepped the whole project for CJK codepoints and there are none. `runtime/neural-production.mjs:16` is:

```js
const NEGATIVE = 'static frozen image, slideshow, vector art, cartoon, geometric primitives, text, subtitles, watermark, black empty background, distorted face, deformed hands, duplicated limbs, unstable geometry, oversaturated, low quality';
```

15 English terms, hand-written here. It is **not** the vendor string. Whoever wrote it replaced the inherited
default. That is the thing to evaluate.

### 2.2 The vendor default, verbatim

From `[REPO-NEG]`, and byte-identical in node 7 of `[COMFY-TPL]`:

```
色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走
```

28 terms. Term-by-term, grouped by what each is actually defending against:

| # | Term | Gloss | Defends against |
|---|---|---|---|
| 1 | 色调艳丽 | garish/vivid colour grading | oversaturation |
| 2 | 过曝 | overexposure | blown highlights — the sky rule in §1.2 exists because of this |
| 3 | 静态 | static | **the dominant 5B failure: a still frame with no motion** |
| 4 | 细节模糊不清 | indistinct blurry detail | mush |
| 5 | 字幕 | subtitles | burned-in captions |
| 6 | 风格 | "style" | — |
| 7 | 作品 | "an artwork" | — |
| 8 | 画作 | "a painting" | — |
| 9 | 画面 | "a picture/frame" | — |
| 10 | 静止 | motionless | still output |
| 11 | 整体发灰 | overall grey cast | washed-out low-contrast output |
| 12 | 最差质量 | worst quality | generic quality anchor |
| 13 | 低质量 | low quality | generic quality anchor |
| 14 | JPEG压缩残留 | JPEG compression residue | blocking/ringing |
| 15 | 丑陋的 | ugly | generic |
| 16 | 残缺的 | mutilated/incomplete | truncated anatomy |
| 17 | 多余的手指 | extra fingers | hands |
| 18 | 画得不好的手部 | badly drawn hands | hands |
| 19 | 画得不好的脸部 | badly drawn face | faces |
| 20 | 畸形的 | deformed | anatomy |
| 21 | 毁容的 | disfigured | faces |
| 22 | 形态畸形的肢体 | malformed limbs | anatomy |
| 23 | 手指融合 | fused fingers | hands |
| 24 | 静止不动的画面 | a completely motionless frame | still output (third time) |
| 25 | 杂乱的背景 | cluttered background | background chaos |
| 26 | 三条腿 | three legs | limb duplication |
| 27 | 背景人很多 | many people in the background | **crowds** |
| 28 | 倒着走 | walking backwards | **reversed locomotion** |

Read as a document, this list is the model authors telling you exactly what their model gets wrong. Note the
weighting: **three separate terms for "it came out static"** (3, 10, 24), **four for hands** (17, 18, 22, 23),
and a four-term cluster (6-9: 风格/作品/画作/画面) whose job is to push the output away from "this is a
depicted artwork" toward "this is live footage." That cluster is subtle and our English negative has no real
equivalent — "vector art, cartoon" is adjacent but much narrower.

### 2.3 Is ours optimal? No. Three specific problems.

**(a) It drops 13 of the vendor's terms with no replacement.** Missing entirely: 过曝 (overexposure),
细节模糊不清 (blurry detail), 整体发灰 (grey cast), JPEG压缩残留 (compression artifacts), 多余的手指
(extra fingers), 手指融合 (fused fingers), 残缺的, 毁容的, 杂乱的背景 (cluttered background), 三条腿,
**背景人很多 (crowded background)**, **倒着走 (walking backwards)**, and the 风格/作品/画作/画面 cluster.

Compression artifacts and grey cast matter more for us than for a 4090 user, because Q4_K_M is exactly the
regime where `[GGUF]` sources report banding and detail loss first.

**(b) Language.** UMT5 is multilingual, so English terms *work*. But the vendor validated against the Chinese
string, and `[COMFY-TPL]` — the workflow whose sampler settings we copied verbatim — ships the Chinese
string. Notably the vendor is asymmetric on purpose: `[REPO-SYS]` demands the *positive* be English
("输出必须是英文！") while the *negative* stays Chinese. Copying half of the reference configuration and
rewriting the other half from scratch is the kind of divergence that makes our output hard to compare
against any published baseline.

**(c) One term is actively fighting our own prompt.** The vendor negative contains 背景人很多 ("many people
in the background"). Our `SMOKE_PROMPT` asks for *"a busy rain-soaked night market ... market stalls in the
middle distance ... distant people move naturally."* We are requesting the exact content the model authors
found necessary to suppress. See §3.

### 2.4 Recommendation

Adopt the vendor string verbatim as the base — it is what the weights were tuned against — then append
English terms for failure modes specific to *our* pipeline, which the vendor list does not cover:

```
<28-term vendor Chinese string>，slideshow, geometric primitives, vector art, watermark,
black empty background, unstable geometry, morphing face, flickering texture, duplicated subject
```

Keep `slideshow`, `geometric primitives`, `black empty background` and `unstable geometry` from our current
string — those are ours, they are not in the vendor list, and they name real degenerate-output modes worth
naming. Drop nothing else from the vendor list. `UNVERIFIED`: same seed, same prompt, three negatives (ours /
vendor / merged), compare on the detector metrics.

---

## 3. What reliably fails, and why

Ranked by evidence strength.

### 3.1 MEASURED — our own two documented failures

`TASKS.md` records, for our three real generations:

> "Shot 2 tracks from behind rather than the requested front-facing angle. Shot 3 is a restrained look-back
> under the awning rather than a full duck-and-enter shelter performance."

Two distinct failure classes, both from our exact model at our exact settings:

- **Camera-relative subject orientation is not reliably controlled.** Asking for "front-facing" got a
  back-tracking shot. This is the same family as the vendor's 倒着走 (walking backwards) — the model has a
  weak grip on which way a body faces relative to the lens.
- **Multi-beat actions collapse to their first beat.** "Duck and enter shelter" is two chained actions; we
  got the restrained first half. This is consistent with `[ALI-DOC]`'s explicit warning against "very long or
  complex action sequences."

**Prompt-builder consequence:** one action verb per shot, and never specify facing direction as an
instruction ("she faces the camera"); specify it as a *state* in the subject clause ("a woman facing the
camera") so it is carried by the keyframe rather than requested of the motion model.

### 3.2 STRONG — named by the vendor negative prompt (§2.2)

Anything the model authors spent a negative-prompt slot on is something that goes wrong often enough to be
worth 512-token budget. In priority order by how many slots it got:

| Failure | Slots | Prompt-builder rule |
|---|---|---|
| Output is static / a still | 3 | Always state an explicit motion, plus ambient background motion |
| Hands, fingers | 4 | Never frame a shot where hands are the subject; keep hands out of close-ups |
| Face deformation | 2 | Medium shot over close-up; avoid extreme close-up |
| Limb count / duplication | 2 | Single subject; avoid limb-heavy actions (dancing, fighting) |
| Crowded background | 1 | **Cap named background people at "a few"; never "busy", "crowd", "packed"** |
| Reversed locomotion | 1 | Prefer stationary or turning subjects over walking subjects |
| Cluttered background | 1 | Shallow depth of field, simple backgrounds |

### 3.3 STRONG — named by the vendor prompt guide `[ALI-DOC]`

Explicitly listed as things the model handles badly:

- **Named real people** — rejected or inconsistent.
- **Rapid scene changes within a single clip** — the model does not cut. One continuous shot per generation.
- **Exact text legibility** — "text renders approximately." Do not request readable signage, labels, or UI.
- **Very long or complex action sequences** — matches our §3.1 measurement.
- **Lip-synced dialogue to specific words** — unreliable.

### 3.4 MODERATE — architectural, derived from `[REPO-CFG]` and `[REPO-README]`

The 5B uses a Wan2.2-VAE at `vae_stride = (4, 16, 16)` with `patch_size = (1, 2, 2)`, giving **32x spatial**
and **4x temporal** compression `[REPO-CFG]`. Consequences, computed:

| | Native `1280x704` | Ours `1024x576` |
|---|---|---|
| Pixels | 901,120 | 589,824 |
| Latent token grid | 40 x 22 = **880** | 32 x 18 = **576** |

We are running at **65.5% of the native pixel count and 65.5% of the native token budget.** Every fine
detail — a face, a hand, text on a sign — is being represented in ~2/3 the latent capacity the model was
tuned for, *before* Q4 quantisation touches it. This is the mechanical reason close-ups of small structures
fail harder for us than for a 4090 user at 704p. It is also why "reframe to a wider shot" is a weak fix and
"do not put small critical detail in the frame at all" is the strong one.

Two hard constraints fall out of the same constants and both are already enforced correctly in
`wanWorkflow()`:
- width and height must be divisible by 32 (guard: `width % 32 || height % 32`) ✓
- frame count must be `4n+1` — verified: 1, 33, 61, 121 are all `4n+1`, giving 1, 9, 16, 31 latent frames ✓
  and 121 frames at 24 fps is exactly 5.000 s ✓ (`frame_num = 121`, `sample_fps = 24` in `[REPO-CFG]`)

### 3.5 LOW CONFIDENCE — quantisation

`[GGUF]` community sources report Q4_K_M's first visible failures as **face drift across a long clip** and
**banding in flat gradients** (skies). One widely-circulated guide claims ~95% of FP8 quality for Q4_K_M and
recommends quantising the text encoder before the diffusion model, on the grounds that encoder loss is less
visible. Our stack already does the opposite-friendly thing (`umt5-xxl-encoder-Q4_K_S` + diffusion
`Q4_K_M`), so both are at Q4.

**I am flagging these numbers as unreliable.** The same guide quotes 83 s for a 720p 81-frame generation,
which is not plausible on consumer hardware and is inconsistent with our own 78.4 s *per step*. Treat the
qualitative claims (banding, face drift) as plausible and the percentages as marketing. Do not cite the
numbers downstream.

---

## 4. What reliably succeeds

Derived by inverting §3 and reading the vendor's own worked examples `[REPO-SYS]`, all four of which are:
single subject, medium or close shot, one clear action, simple background, one lighting idea.

**Prefer, in roughly this order of safety:**

1. **Single subject, medium shot, stationary or turning.** Every `[REPO-SYS]` example. Default shot size in
   the rules is literally `Medium shot` or `Wide shot`.
2. **Slow, single-axis camera moves.** `[ALI-DOC]`'s supported vocabulary: push-in, pull-out, tracking shot,
   orbit, fixed camera, camera moves left/right, drone shot, fly-through, tilt up. `[REPO-SYS]`'s I2V
   examples are all one move: *"The camera moves left, then pushes forward."* One move, or two chained.
   Never a move plus an angle change (§1.2 rule).
3. **Ambient environmental motion.** The vendor rewriter is instructed to *add* background motion — drifting
   clouds, wind in leaves — when the subject is static. Rain, smoke, steam, dust, water and foliage are
   high-motion-energy, low-anatomy-risk content. They satisfy the three anti-static negative terms without
   risking hands or faces. This is the cheapest way to look alive.
4. **Hair and fabric.** Same argument: deformable, high-frequency, and there is no "correct" configuration a
   viewer can catch the model getting wrong. Our own `SMOKE_PROMPT` already does this well ("wet strands of
   hair move", "fabric texture") and it is the strongest part of that prompt.
5. **Speaking / expression change without lip-sync.** `[REPO-SYS]` example: *"A man talks, his expression
   shifting from smiling to closing his eyes, reopening them, and finally smiling with closed eyes."* An
   expression arc is a legitimate multi-beat action because it is facial, not locomotive. Note this is the
   one place multi-beat is safe. Do not request specific words (§3.3).
6. **One decisive lighting condition.** Firelight, practical lamp, moonlight, overcast. Named light source
   plus named light angle, from the closed vocabulary. Avoid open sky unless you also say "azure blue"
   (§1.2).
7. **Shallow depth of field.** Directly suppresses 杂乱的背景 and 背景人很多 by construction rather than by
   negative prompt.

---

## 5. Sampler parameters

### 5.1 What we run, and where it came from

Our `wanWorkflow()` uses `uni_pc` + `simple`, 20 steps, cfg 5, `ModelSamplingSD3` shift 8, at 1024x576, 121
frames.

**These are not arbitrary — they are `[COMFY-TPL]` verbatim.** The official ComfyUI 5B template is: KSampler
seed/**steps 20**/**cfg 5**/**uni_pc**/**simple**/denoise 1, `ModelSamplingSD3` **shift 8**,
`Wan22ImageToVideoLatent` 1280x704x121, 24 fps. We match on every axis except resolution. That is worth
knowing: we have not drifted from the reference workflow, we have only shrunk the frame.

### 5.2 Vendor reference vs ComfyUI reference — they disagree

| Parameter | `[REPO-CFG]` (vendor Python) | `[COMFY-TPL]` (ComfyUI) | Ours |
|---|---|---|---|
| Solver | `unipc` (default in `generate.py`) | `uni_pc` + `simple` | `uni_pc` + `simple` ✓ |
| Steps | `sample_steps = 50` | **20** | 20 |
| Guidance | `sample_guide_scale = 5.0` | cfg **5** | 5 ✓ |
| Shift | `sample_shift = 5.0` | **8** | 8 |
| fps | `sample_fps = 24` | 24 | 24 ✓ |
| Frames | `frame_num = 121` | 121 | 121 ✓ |
| Resolution | `1280*704` | 1280x704 | **1024x576** |

Solver, guidance, fps and frame count are unanimous. **Steps and shift are not**, and they disagree
*together*: ComfyUI cut steps 50→20 and simultaneously raised shift 5→8.

### 5.3 What `shift` actually does

Verified from `[COMFY-SRC]`, not from folklore:

```python
def time_snr_shift(alpha, t):
    if alpha == 1.0:
        return t
    return alpha * t / (1 + (alpha - 1) * t)
```

`ModelSamplingSD3` sets `alpha = shift` and warps the sigma schedule through this. `alpha > 1` pushes sigmas
up, which means **more of your sampling steps land in the high-noise region where global structure and motion
are decided, and fewer land in the low-noise region where fine texture is resolved.**

Origin `[SD3]` §5.3.2: this is a *resolution* correction. A larger image has more tokens, so each denoising
step destroys relatively less information, so higher-resolution sampling needs the schedule shifted. Their
formula maps a timestep between resolutions as

> `t_m = (√(m/n) · t_n) / (1 + (√(m/n) − 1) · t_n)`

with `m` and `n` the pixel counts — which is exactly `time_snr_shift` with `alpha = √(m/n)`. They settled on
`α = 3.0` for 1024x1024.

### 5.4 The resolution argument for lowering our shift

Applying `[SD3]`'s own scaling law to our case (arithmetic, shown so it can be checked):

```
√(589,824 / 901,120) = √0.6545 = 0.8090
shift 8 (ComfyUI, @1280x704)  → 8 × 0.8090 = 6.47
shift 5 (vendor,  @1280x704)  → 5 × 0.8090 = 4.05
```

On the resolution argument alone, the right shift for 1024x576 is **4.0 to 6.5**, and our 8 is above the
band. `[MUSUBI]` is directionally consistent (finds very high DFS "misses important timesteps"), as is the
general community position that low resolution plus high shift starves the detail steps and yields soft,
plasticky output.

### 5.5 The counter-argument, which I think is strong enough to block the change

Both references were at the **same** resolution (1280x704) yet chose different shifts — 5 and 8. Resolution
cannot explain that. The other thing that changed is step count: 50 vs 20. Higher shift front-loads structure,
which is precisely what you want when you have fewer steps to spend. So the likeliest reading is that
**ComfyUI raised shift 5→8 to compensate for cutting steps 50→20**, not because of resolution.

If that is right, our shift 8 is doing double duty for our 20 steps, and scaling it down for resolution
without also raising steps would undercorrect and lose structure.

Independent empirical evidence points the same way and *against* §5.4: `[REPLICATE]` swept shift 1-9 on
Wan2.1 14B at 81 frames / 30 steps and concluded **7-9 was best**, with shift 1 producing "a dolly effect
with background warping." Different model and different generation, so not decisive — but it is the only
actual sweep on the table and it does not support lowering shift.

**Verdict: contested. Do not change shift on theory.** `UNVERIFIED`.

### 5.6 The one sweep worth the GPU time

Cost is known: 1568 s / 20 steps = **78.4 s per step** at our settings. So 50 steps ≈ 3,920 s ≈ 65 minutes
per shot — probably out of budget as a default, but affordable once as an experiment.

Fixed: same seed, same prompt, 1024x576, 121 frames, `uni_pc`+`simple`, cfg 5.

| Cell | steps | shift | Cost | Tests |
|---|---|---|---|---|
| A (control) | 20 | 8 | ~26 min | current config |
| B | 20 | 6.5 | ~26 min | §5.4 resolution correction |
| C | 20 | 4.0 | ~26 min | vendor shift, resolution-corrected |
| D | 50 | 5 | ~65 min | full vendor reference |

~2.4 GPU-hours. B vs A settles resolution scaling at fixed steps. D vs A settles whether ComfyUI's 20/8 is
genuinely equivalent to the vendor's 50/5. Score with our own detectors, not by eye.

**cfg** needs no sweep: `[REPO-CFG]` says 5.0, `[COMFY-TPL]` says 5, and `[REPLICATE]` found 3-7 optimal with
8+ producing "overcooked, shiny skin." Three independent sources, all containing 5. Leave it.

**Solver** needs no sweep: `unipc` is the vendor default in `generate.py` and `uni_pc` is the ComfyUI
template choice. Unanimous. Leave it.

---

## 6. The mechanical checklist

Ordered. A prompt-builder applies these top to bottom. `REJECT` steps should surface a coded error rather
than silently rewriting, so the user learns the constraint.

### Phase 1 — reject or reframe the brief

1. **REJECT: readable text.** If the brief asks for legible signage, labels, logos, screens, or writing,
   either drop the element or restate it as illegible texture ("a neon sign", not "a sign reading OPEN").
   `[ALI-DOC]`.
2. **REJECT: named real people.** Replace with a described original character. `[ALI-DOC]`.
3. **REJECT: cuts.** One continuous shot per generation. If the brief has "then", "cut to", or two locations,
   split it into separate shots. `[ALI-DOC]`.
4. **REJECT: lip-sync to specific words.** Downgrade to "speaks", "his expression shifts". `[ALI-DOC]`.
5. **REJECT: hands as subject.** If the brief centres hands, fingers, or fine manipulation, reframe wider or
   refuse. Four negative-prompt slots. §3.2.
6. **CAP: subject count at 1** (2 only if they do not physically interact). Interacting characters multiply
   the limb/anatomy failure surface. §3.2.
7. **CAP: action at one verb.** Multi-beat actions collapse to beat one — MEASURED, §3.1. "Ducks and enters
   the shelter" → "ducks under the awning". Exception: a facial-expression arc is allowed. §4.5.
8. **CAP: crowds.** Rewrite "busy", "crowded", "packed", "a crowd" to "a few figures" or delete. The vendor
   negative suppresses 背景人很多; do not fight it from the positive side. §2.3(c).
9. **DEMOTE: walking.** Prefer stationary, turning, or gesturing subjects. Walking risks 倒着走. §3.2.
10. **SHOT SIZE: default `Medium shot`.** Escalate to `Close-up shot` only when no hands are in frame. Never
    `Extreme close-up shot`. §3.4 — we have 65.5% of native latent capacity.

### Phase 2 — assemble the T2V / keyframe prompt

11. **If a non-photoreal style is requested, put it first and stop** — emit no cinematic-aesthetic
    vocabulary at all. `[REPO-SYS]` rule 5.
12. **Emit ≤ 4 aesthetic tags, comma-separated, first**, drawn only from the closed vocabulary:
    - time: `Day time` (default) | `Night time` | `Dawn time` | `Sunrise time`
    - light source: `Daylight` | `Artificial lighting` | `Moonlight` | `Practical lighting` | `Firelight` | `Fluorescent lighting` | `Overcast lighting` | `Sunny lighting`
    - light intensity: `Soft lighting` | `Hard lighting`
    - light angle: `Top lighting` | `Side lighting` | `Underlighting` | `Edge lighting`
    - tone: `Warm colors` | `Cool colors` | `Mixed colors`
    - shot size: `Medium shot` (default) | `Wide shot` | `Medium close-up shot` | `Close-up shot`
    - composition: `Center composition` (default) | `Balanced composition` | `Left-heavy composition` | `Right-heavy composition` | `Symmetrical composition`
    - shooting angle: `Over-the-shoulder shot` | `Low angle shot` | `High angle shot` | `Dutch angle shot` | `Aerial shot` | `Overhead shot`
13. **If a camera *movement* is specified, drop the shooting-angle tag.** Explicit `[REPO-SYS]` rule; angle
    and movement compete.
14. **Subject clause:** appearance, wardrobe, material. Encode facing direction here as a *state* ("a woman
    facing the camera"), never later as an instruction — MEASURED failure, §3.1.
15. **Action clause:** describe the motion as a process, not a label. "turns her head, eyebrows rising", not
    "she reacts".
16. **Ambient motion clause:** always add one, even for a static subject — rain falling, steam rising, wind in
    fabric. `[REPO-SYS]` rule 4; defends the three anti-static negative terms. §4.3.
17. **If the sky appears, force "azure blue sky".** `[REPO-SYS]` rule 6, anti-overexposure.
18. **BAN mood prose.** Strip "atmospheric", "full of tension", "a sense of", "evoking", "cinematic feel".
    `[REPO-SYS]` rule 3.
19. **BAN negation in the positive prompt.** Strip "no X", "without X", "avoid X". Our current
    `SMOKE_PROMPT` ends *"No text or watermark."* — that belongs in the negative prompt, where `text` and
    `watermark` already are. Move it, do not duplicate it.
20. **Target 60-200 characters of aesthetic+subject+action**, hard-cap the whole positive under 512 UMT5
    tokens. `[REPO-SYS]`, `[REPO-NEG]`.

### Phase 3 — assemble the I2V / motion prompt (currently missing from our pipeline)

21. **Do not reuse the keyframe prompt.** Build a second, separate string. §1.4 — this is a code change in
    `produceNeuralSmoke`.
22. **Strip every static element already visible in the start image**: appearance, wardrobe, location,
    lighting, style. `[REPO-SYS]` I2V rule.
23. **Keep only:** subject motion + camera movement + ambient motion.
24. **Hold it under 100 words.** `[REPO-SYS]`: *"Limit the rewritten prompt to 100 words or less."*
25. **Camera vocabulary, one move (two chained maximum):** push in, pull back, track left/right, tilt up,
    orbit, fixed camera. `[ALI-DOC]` + `[REPO-SYS]` examples.

### Phase 4 — negative and sampler

26. **Emit the vendor 28-term Chinese negative verbatim**, then append our pipeline-specific English terms.
    §2.4.
27. **Sampler: do not vary.** `uni_pc` + `simple`, cfg 5, 20 steps, shift 8, 24 fps, frames ∈ {1,33,61,121},
    dimensions divisible by 32. Unanimous across both references except steps/shift, which are contested and
    pending the §5.6 sweep.

---

## 7. Open items

| Item | Status | Settles it |
|---|---|---|
| shift 8 vs 6.5 vs 4.0 at 1024x576 | Contested; theory and the only sweep disagree | §5.6 grid, cells A/B/C |
| 20 steps @ shift 8 ≡ 50 steps @ shift 5? | Unknown | §5.6 cell D |
| Separate I2V motion prompt | Not implemented; vendor rules say we should | Code change + A/B |
| Vendor Chinese negative vs our English | Ours diverges from reference on 13 terms | Same-seed 3-way |
| Q4_K_M vs Q5_K_M quality delta on 5B | No trustworthy source found | Local A/B if Q5 fits in 6 GiB |
| Native 1280x704 | Blocked by the `width*height > 1024*576` guard and 6 GiB | Would need offload measurement |

## 8. Sources

- [Wan-Video/Wan2.2 — wan/configs/wan_ti2v_5B.py](https://github.com/Wan-Video/Wan2.2/blob/main/wan/configs/wan_ti2v_5B.py)
- [Wan-Video/Wan2.2 — wan/configs/shared_config.py](https://github.com/Wan-Video/Wan2.2/blob/main/wan/configs/shared_config.py)
- [Wan-Video/Wan2.2 — wan/utils/system_prompt.py](https://github.com/Wan-Video/Wan2.2/blob/main/wan/utils/system_prompt.py)
- [Wan-AI/Wan2.2-TI2V-5B model card](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B)
- [Comfy-Org/workflow_templates — video_wan2_2_5B_ti2v.json](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_wan2_2_5B_ti2v.json)
- [comfyanonymous/ComfyUI — comfy/model_sampling.py](https://github.com/comfyanonymous/ComfyUI/blob/master/comfy/model_sampling.py)
- [Esser et al., Scaling Rectified Flow Transformers, arXiv:2403.03206](https://arxiv.org/abs/2403.03206)
- [Alibaba Cloud Model Studio — Wan text-to-video prompt guide](https://www.alibabacloud.com/help/en/model-studio/text-to-video-prompt)
- [ComfyUI docs — Wan2.2 workflow examples](https://docs.comfy.org/tutorials/video/wan/wan2_2)
- [Replicate — Wan2.1 parameter sweep](https://replicate.com/blog/wan-21-parameter-sweep)
- [kohya-ss/musubi-tuner discussion #797 — WAN 2.1/2.2 and Discrete Flow Shift](https://github.com/kohya-ss/musubi-tuner/discussions/797)
- [leejet/stable-diffusion.cpp discussion #1243 — Wan 2.2 5B video quality](https://github.com/leejet/stable-diffusion.cpp/discussions/1243)
- [huggingface/diffusers issue #12034 — Wan 2.2 5B i2v quality](https://github.com/huggingface/diffusers/issues/12034)
- [city96/ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF)
