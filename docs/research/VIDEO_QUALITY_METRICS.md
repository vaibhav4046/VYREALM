# Video quality metrics we can actually compute

Research + working prototype for the VYREALM quality gate.

- Prototype: `scripts/qc/probe_metrics.py`
- Interpreter: `D:\VYREALM-runtime\bootstrap-qualification\full-install\VYREALM-local-video-v1\venv\Scripts\python.exe`
- Measured on: `outputs/desktop/VYREALM_ANIME_HERO_5S.mp4`, `outputs/desktop/VYREALM_RAINLINE_TRAILER_1080P.mp4`
- Emitted metrics: `outputs/desktop/QC_ANIME_HERO_5S.json`, `outputs/desktop/QC_RAINLINE_15S.json`

Every number in this document came from running the prototype on this machine. Nothing is estimated.

---

## 1. What VBench actually computes

The papers describe the dimensions; the source code decides them. I read both. The single most useful
finding is that **VBench's temporal dimensions are far cheaper than their reputation suggests**.

From `vbench/temporal_flickering.py`, the entire metric is:

```python
ssds.append(calculate_mae(frames[i], frames[i+1]))
# calculate_mae == np.mean(cv2.absdiff(np.array(img1, dtype=np.float32),
#                                      np.array(img2, dtype=np.float32)))
return (255.0 - np.mean(score_seq).item()) / 255.0
```

No network. No embedding. It is `cv2.absdiff` and a divide. We are not approximating temporal
flickering — we can reproduce it bit for bit.

`vbench/motion_smoothness.py` has the same shape, with one model in the middle:

```python
vfi_score = self.vfi_score(frames, outputs)   # mean of cv2.absdiff(real, reconstructed)
norm = (255.0 - vfi_score) / 255.0
```

It drops every other frame (`range(start_from, len(frame_list), 2)`), rebuilds them with the AMT
frame-interpolation network, and scores how well the rebuild matched. AMT here is **"All-Pairs Multi-Field
Transforms"**, a video frame interpolation model — not Amazon Mechanical Turk. (Web search results
conflate the two; the paper's own wording, "utilize the motion priors in the video frame interpolation
model", settles it.) The scoring wrapper is again just MAE.

`vbench/dynamic_degree.py` is a RAFT optical flow field reduced to a binary verdict:

```python
rad = np.sqrt(np.square(u) + np.square(v))
cut_index = int(h*w*0.05)
max_rad = np.mean(abs(np.sort(-rad_flat))[:cut_index])   # mean of the largest 5%
...
"thres": 6.0*(scale/256.0)          # scale = min frame dimension
"count_num": round(4*(count/16.0))  # count = number of frames
```

A clip is "dynamic" if the top-5% flow magnitude clears the threshold in at least `count_num` frame
pairs. The threshold structure is fully portable; only RAFT needs replacing.

`vbench/subject_consistency.py` is the one that genuinely needs a network — DINO features, compared
both ways:

```python
sim_pre = F.cosine_similarity(former_image_features, image_features)
sim_fir = F.cosine_similarity(first_image_features, image_features)
cur_sim = (sim_pre + sim_fir) / 2
```

That **to-previous + to-first, averaged** structure is worth copying even when the features are cheap,
because the two halves catch different failures: to-previous catches jitter, to-first catches drift.

### Cost tiering

| VBench dimension | What it needs | Can we do it on this box? |
|---|---|---|
| Temporal flickering | nothing — `cv2.absdiff` | **Exactly.** Not an approximation. |
| Motion smoothness | AMT interpolation net | Proxy: linear-blend reconstruction, same MAE wrapper |
| Dynamic degree | RAFT | Proxy: Farneback flow, VBench's own thresholds unchanged |
| Subject consistency | DINO ViT | Proxy only: histogram correlation + ORB matching |
| Background consistency | CLIP | Proxy only: histogram correlation on a low-flow mask |
| Imaging quality | MUSIQ (SPAQ) | No. Substitute Laplacian variance + blockiness + clipping |
| Aesthetic quality | LAION predictor | No, and not worth faking |

Torch is installed in the venv but **does not load on this machine** — `OSError [WinError 1455] The
paging file is too small` on `torch/lib/uv.dll`. So the model-based tier is not merely expensive here,
it is currently unavailable. Everything below is numpy + OpenCV.

---

## 2. The cheap metric set

Implemented in `scripts/qc/probe_metrics.py`. Available: numpy 2.5.2, OpenCV 4.12.0 (FFMPEG-enabled),
scipy 1.18.1, PIL 12.3.0, av 18.1.0. Missing: skimage, imageio. Unusable: torch.

`ffmpeg`/`ffprobe` turned out to be unnecessary — OpenCV is built with FFMPEG, so `cv2.VideoCapture`
decodes these files directly. One less subprocess boundary.

| Metric | How | Approximates |
|---|---|---|
| `vbenchFlickerScore` | `(255 - mean(cv2.absdiff)) / 255` over consecutive frames | Temporal flickering (exact) |
| `lumaMaeVariance` | variance of the per-pair luma MAE series | Flicker *instability* vs steady motion |
| `highFreqEnergyDelta` | frame-to-frame change in Laplacian energy | High-frequency churn |
| `blendSmoothnessProxy` | `(255 - mean|f_t - (f_{t-1}+f_{t+1})/2|) / 255` | Motion smoothness (AMT → linear blend) |
| `flowAcceleration` | `np.diff(mean_flow, 2)` | Stutter spikes |
| `vbenchIsDynamic` | Farneback → top-5% → thres `6.0`, `count_num = round(4n/16)` | Dynamic degree |
| `histCorrPrevFrame` / `histCorrFirstFrame` | HSV H-S histogram correlation, both directions | Subject consistency |
| `backgroundHistCorrProxy` | same, masked to the below-median-flow half of the frame | Background consistency |
| `orbHomographyInlierRatio` | ORB → Lowe → RANSAC homography inlier fraction | *No VBench equivalent* |
| `steppedMotionSuspected` | lag-1/lag-2 autocorrelation of the MAE series | *No VBench equivalent* |
| `maxSingleFrameDropRatio` | largest one-frame fall in Laplacian variance | Imaging quality collapse |
| `blockinessRatio` | gradient energy on the 8×8 grid ÷ off it | Compression artefacts |
| `saturationExtremeFrac` etc. | HSV S≥250, V≥250, V≤5 fractions | Oversaturation / clipping |
| `colourDrift.slopePerSec` | least-squares slope of per-channel means | Palette drift |

Two of these have no VBench counterpart and both earned their place on measured evidence (§4).

The probe streams frames through a 3-frame ring buffer and never holds the clip in memory. That is not
premature optimisation: this box was at **82% memory load with 1.16 GB of commit headroom** during
development, and an earlier draft that retained full-resolution HSV per frame died with
`cv2.error: Insufficient memory: Failed to allocate 2329600 bytes`.

### Design corrections forced by measurement

**Mean optical flow under-reads badly.** The self-check pans a crop at a known 8 px/frame, which after
rescaling to the 256 px working height is a known **7.11 px** true displacement. Measured: top-5%
statistic **7.37** (within 3.6%), whole-frame mean **2.87** (60% low). Farneback returns ~0 in flat
regions it cannot solve, which drags the mean down. This is why VBench thresholds on the top 5%, and
why the gate must never treat `flowMean` as an absolute motion figure.

**A linear sharpness slope is the wrong model.** It is what I implemented first and it was actively
misleading on both clips (§4). Detail does not fade linearly; it falls off a step. `maxSingleFrameDropRatio`
and `fracBelowHalfMedian` were added after the linear fit missed a 4× collapse.

---

## 3. Measured numbers

Run cost, wall clock on this machine:

| Clip | Frames | Resolution | Probe time | Per frame |
|---|---|---|---|---|
| `VYREALM_ANIME_HERO_5S.mp4` | 121 | 1024×576 | **26.2 s** | 0.217 s |
| `VYREALM_RAINLINE_TRAILER_1080P.mp4` | 360 | 1920×1080 | **151.3 s** | 0.420 s |

For context, generating the 121-frame anime shot took ~1568 s. **QC costs 1.7% of generation.** Cheap
enough to run on every shot without argument.

### 3.1 `VYREALM_ANIME_HERO_5S.mp4` — 121 frames, 1024×576, 24 fps, 5.04 s

```
temporalFlicker
  vbenchFlickerScore           0.980259
  rgbMae      mean 5.0339  std 3.7514  min 0.6997  max 12.4883  p95 10.5650
  lumaMae     mean 4.7891
  lumaMaeVariance             13.2330
  highFreqEnergyDelta mean    76.1908  max 242.4482
motionSmoothness
  blendSmoothnessProxy         0.982150
  blendReconstructionMae mean 4.5518  max 7.0393
  flowAcceleration       mean 1.7010  max 4.2125
dynamicDegree
  vbenchIsDynamic              false     (24 moving pairs, 30 required)
  flowTop5Pct mean 3.1881  std 3.9227  min 0.1758  max 20.0375  p95 10.5960
  flowMean    mean 0.4975  max 2.1776
stability
  histCorrPrevFrame       mean 0.997274  min 0.959858
  histCorrFirstFrame      mean 0.893868  min 0.813180
  backgroundHistCorrProxy mean 0.997891  min 0.938125
  orbMatchRatioPrev       mean 0.767757
  orbMatchRatioFirst      mean 0.133266
  orbHomographyInlierRatio mean 0.954044 min 0.807818
stall
  exactDuplicatePairs 0   nearDuplicatePairs 0   longestStallRun 0
cadence
  rgbMaeAutocorrLag1          -0.812716
  rgbMaeAutocorrLag2          +0.875223
  rgbMaeAlternationRatio       2.6344
  flowAlternationRatio         5.2651
  steppedMotionSuspected       true
colourDrift  (units of 8-bit level per second)
  slopePerSec   b -0.0693   g -0.4591   r -3.0224   luma -1.1802
  endMinusStart b -6.5371   g -5.6980   r -12.2055  luma -7.7286
  maxChannelSpreadDrift        2.9530
sharpness
  laplacianVar mean 1341.75  std 189.70  min 696.84  max 1716.26
  median 1382.33   minOverMedian 0.5041   fracBelowHalfMedian 0.000
  maxSingleFrameDropRatio 1.2350 (at frame 112)
  slopePerSec -36.93   relativeSlopePctPerSec -2.75
artefacts
  blockinessRatio       mean 1.0517  max 1.1668
  saturationExtremeFrac mean 0.1558
  highlightClipFrac     mean 0.1672
  shadowCrushFrac       mean 0.0010
```

### 3.2 `VYREALM_RAINLINE_TRAILER_1080P.mp4` — 360 frames, 1920×1080, 24 fps, 15.0 s

This is three 5 s Wan2.2 shots edited together, so the whole-timeline aggregates below are polluted by
the cuts. The per-shot breakdown in §3.3 is the one to read.

```
temporalFlicker
  vbenchFlickerScore           0.952690
  rgbMae      mean 12.0641  std 11.6987  min 1.6214  max 89.5739  p95 36.3063
  lumaMaeVariance            108.5916
motionSmoothness
  blendSmoothnessProxy         0.964410
  blendReconstructionMae mean 9.0756  max 49.5388
  flowAcceleration       mean 1.0445  max 29.6971
dynamicDegree
  vbenchIsDynamic              true      (132 moving pairs, 90 required)
  flowTop5Pct mean 7.8418  max 52.7682
  flowMean    mean 2.3745  max 17.5947
stability
  histCorrPrevFrame        mean 0.965461  min 0.114441
  histCorrFirstFrame       mean 0.884572  min 0.223254
  backgroundHistCorrProxy  mean 0.965455  min 0.141919
  orbMatchRatioPrev        mean 0.571112  min 0.002132
  orbMatchRatioFirst       mean 0.104198  min 0.000000
  orbHomographyInlierRatio mean 0.899970  min 0.000000
stall
  exactDuplicatePairs 0   nearDuplicatePairs 0   longestStallRun 0
cadence
  rgbMaeAutocorrLag1          +0.815472
  rgbMaeAutocorrLag2          +0.748117
  rgbMaeAlternationRatio       1.1105
  flowAlternationRatio         1.1125
  steppedMotionSuspected       false
colourDrift
  slopePerSec   b -0.3617  g -0.2722  r -0.1760  luma -0.2539
  maxChannelSpreadDrift        0.1857
sharpness
  laplacianVar mean 27.544  std 25.346  min 3.100  max 108.135
  median 23.04   minOverMedian 0.1346   fracBelowHalfMedian 0.328
  maxSingleFrameDropRatio 4.0258 (at frame 35)
  slopePerSec -3.226   relativeSlopePctPerSec -11.71
artefacts
  blockinessRatio       mean 1.1812  max 1.4332
  saturationExtremeFrac mean 0.2040  max 0.3942
  highlightClipFrac     mean 0.0816
  shadowCrushFrac       mean 0.0587  max 0.1767
```

### 3.3 Rainline, per shot

Recomputed from the emitted per-frame arrays, no re-decode:

| Segment | rgbMAE | flicker | flowTop5 | homogInlier | histPrev | blockiness | sharpness |
|---|---|---|---|---|---|---|---|
| shot 1, 0–5 s | 4.75 | 0.9814 | 3.61 | 0.9507 | 0.9961 | 1.146 | 48.7 |
| **shot 2, 5–10 s** | **24.73** | **0.9030** | **17.03** | **0.8088** | **0.9044** | **1.265** | **11.7** |
| shot 3, 10–15 s | 5.84 | 0.9771 | 2.41 | 0.9506 | 0.9983 | 1.132 | 22.2 |

Shot 2 is worse on *every single axis*. That is the gate earning its keep: one shot of three is the
problem, and the metrics agree unanimously about which one.

Cut detection, for free:

```
pair idx 119 (t= 5.00 s)  rgbMae 38.52  histCorr 0.8777  homographyInlier 0.5946
pair idx 239 (t=10.00 s)  rgbMae 89.57  histCorr 0.7585  homographyInlier 0.0000
```

The 10 s cut is textbook — homography inliers at exactly **0.0**, because no single transform relates
two unrelated shots. The 5 s boundary is much softer, which is itself informative: shot 2 opens in a
state not that far from where shot 1 ended, then degenerates.

---

## 4. What this says about our own footage

Honest reading, including the parts that are unflattering.

**The anime hero shot is animating on twos, and the evidence is not subtle.** The frame-difference
series has autocorrelation **lag-1 = −0.813** and **lag-2 = +0.875**. Motion between odd frame pairs is
**5.27×** that between even pairs. 34 of 120 pairs have an MAE under 1.5 at indices 1, 3, 7, 11, 15, 19,
23, 27, 31, 35, 39 … The shot renders roughly 12 distinct frames per second inside a 24 fps container.

Rainline is the negative control and shows none of it: whole clip lag-1 **+0.815**, lag-2 **+0.748**,
alternation ratio 1.11×; shot 1 alone lag-1 **+0.434**, lag-2 **+0.361**, alternation 1.14×. Neither is
negative at lag 1. So the period-2 structure is a property of the anime clip, not an artefact of the
method.

I am deliberately **not** calling this a defect. Hand-drawn anime is conventionally animated on twos —
12 fps is the house style, not a bug. The detector is reliable; its *polarity is intent-dependent*. For
an anime shot this is correct craft. For a live-action or cinematic shot it is the "AI slideshow"
failure. The gate must take the target style as an input rather than assume.

**The anime shot is nonetheless classified static by VBench's own rule.** 24 moving pairs against 30
required, `flowMean` 0.4975. Combined with the cadence finding, this shot is both low-motion overall and
stepped within that motion. This is the trap the strategic thesis names: the shot scores a *good*
flicker number (0.980) partly **because** it barely moves. Flicker and dynamic degree must be read
jointly or the gate will reward dead footage.

**The anime shot is draining red.** Slope −3.02 levels/s on red against −0.07 on blue; over the 5 s shot
red falls 12.2 levels while blue falls 6.5. `maxChannelSpreadDrift` 2.95. The shot ends measurably cooler
than it began — a real, quantified defect that no amount of eyeballing a thumbnail would surface.

**Rainline shot 1 loses 4× its detail in a single frame, and the flicker metric never notices.** Frame
34 → 35, Laplacian variance falls **92.6 → 23.0**, while the frame difference stays flat (rgbMae 4.07 →
4.58) and luma barely moves (92.0 → 91.0). It is not a cut, and not motion blur from a big movement.
The model simply stopped resolving detail and never recovered:

```
f 34 sharp= 92.6  flowT5=3.19  rgbMae=4.07  luma=92.0
f 35 sharp= 23.0  flowT5=5.06  rgbMae=4.58  luma=91.0   <-- 4.03x collapse
f 36 sharp= 22.7  flowT5=5.15  rgbMae=4.30  luma=90.7
```

Two things make this the strongest result here. First, `maxSingleFrameDropRatio` = **4.0258 at frame 35**
is the *global* maximum across all 360 frames — this generative failure is a larger detail event than the
hard cut between two unrelated shots. Second, look at what separates it from the other large drops:

```
f 34 -> f 35 :  92.6 ->  23.0   ratio 4.03   rgbMae  4.58   <-- invisible to frame differencing
f147 -> f148 :  14.2 ->   5.3   ratio 2.69   rgbMae 44.52
f134 -> f135 :   9.4 ->   4.2   ratio 2.24   rgbMae 45.97
f178 -> f179 :  17.4 ->   8.5   ratio 2.05   rgbMae 19.68
f163 -> f164 :  12.4 ->   6.1   ratio 2.04   rgbMae 28.02
```

Every other big drop comes with a big frame difference (rgbMae 20–46) — those are cuts and violent
motion, and any metric would flag them. The frame-35 collapse has an rgbMae of **4.58**, entirely
unremarkable for this clip. It is the one detail event that hides inside normal-looking frame deltas.

This is the single best argument in this document for building the gate. Every frame-difference metric,
including VBench's temporal flickering, is blind to it. A hosted tool would hand you this clip without
comment.

**I got the sharpness trend wrong on the first pass, and the correction matters.** The linear fit gave
the anime clip −2.75%/s and rainline shot 1 −35.8%/s, and I initially read those as "mild" and "severe"
softening. Both readings were wrong:

- The anime clip does **not** soften. Median 1382, `fracBelowHalfMedian` **0.000**, first-30-frames mean
  1302.8 vs last-30 mean 1192.1 — an 8.5% tail decline, no more. The −2.75%/s slope was an artefact of a
  gentle ramp over the final ~8 frames (1007 → 897 → 923 → 829 → 772 → 781 → 712 → 697).
- Rainline shot 1 does not decline linearly either. It holds ~100 for 34 frames, drops off a cliff, and
  plateaus near 25.

A least-squares slope is simply the wrong estimator for a step function. Both the metric set and the
thresholds below use step and distribution statistics instead.

**Good news worth recording.** Neither clip has a single stalled or duplicated frame (0 exact, 0 near,
longest run 0). Frame-to-frame geometric coherence is high where it should be — homography inlier ratio
0.954 (anime), 0.951 / 0.951 on rainline shots 1 and 3 — meaning the model is not morphing or warping
between adjacent frames. Blockiness is mild at 1.052 (anime) and 1.13–1.15 (rainline shots 1, 3).
Whatever is wrong with this footage, it is not compression and it is not frame-level incoherence.

**One caveat on the anime clip's clipping numbers.** `highlightClipFrac` 0.167 and
`saturationExtremeFrac` 0.156 are high in absolute terms, but flat-shaded anime legitimately contains
large blown-white and fully-saturated regions. With two clips I cannot separate style from defect here,
so I am reporting it as an observation and explicitly *not* proposing a gate threshold for it.

---

## 5. Recommended thresholds

**These are provisional and calibrated on a sample of two clips — four Wan2.2 shots in total, from one
model at one setting.** They are starting points chosen so that the one shot I can independently confirm
is bad (rainline shot 2) fails and the three that look acceptable pass. They are not validated against
human judgement, and any threshold below marked *low confidence* is little more than a guess with a
number attached. Re-calibrate once there are ~30 shots with human pass/fail labels.

Run the gate **per shot, never per edited timeline** — §3.3 shows the aggregates hide everything.

| # | Metric | Pass | Warn | Fail | Confidence | Basis |
|---|---|---|---|---|---|---|
| 1 | `vbenchFlickerScore` (low-motion shots only) | ≥ 0.975 | 0.950–0.975 | < 0.950 | medium | anime 0.980, shots 1/3 0.981/0.977 pass; shot 2 0.903 fails |
| 2 | `orbHomographyInlierRatio` mean | ≥ 0.90 | 0.80–0.90 | < 0.80 | medium | 0.954 / 0.951 / 0.951 good; 0.809 on the bad shot |
| 3 | `sharpness.maxSingleFrameDropRatio` | < 1.6 | 1.6–2.5 | ≥ 2.5 | **high** | anime 1.235 clean; rainline 4.026 at f35 is a confirmed collapse, and the global max |
| 4 | `sharpness.fracBelowHalfMedian` | < 0.10 | 0.10–0.25 | ≥ 0.25 | medium | anime 0.000; rainline 0.328 (multi-shot, so read per shot) |
| 5 | `vbenchIsDynamic` = false **and** style ≠ static | — | — | fail | **high** | VBench's own rule; anime trips it at 24/30 |
| 6 | `flowTop5Pct` mean | 2.0–20.0 | 20–35 | > 35 or < 2.0 | low | anime 3.19, shots 1/3 3.61/2.41; shot 2 17.03 with max 52.8 |
| 7 | `steppedMotionSuspected` **and** style ≠ anime | — | warn | — | **high** (detector) / low (polarity) | anime lag1 −0.813 / lag2 +0.875 vs control +0.434 / +0.361 |
| 8 | `colourDrift.maxChannelSpreadDrift` | < 1.0 | 1.0–2.5 | ≥ 2.5 | low | anime 2.95 (red drain); rainline 0.186 |
| 9 | `blockinessRatio` mean | < 1.15 | 1.15–1.30 | ≥ 1.30 | low | anime 1.052; shots 1/3 1.146/1.132; shot 2 1.265 |
| 10 | `exactDuplicatePairs` > 0 or `longestStallRun` ≥ 3 | — | — | fail | medium | both clips 0; no positive example yet, threshold is a priori |
| 11 | `histCorrPrevFrame` < 0.60 | — | — | *shot boundary, not a defect* | **high** | 0.114 / 0.223 at real cuts |

Notes that matter more than the table:

- **#1 is confounded with motion and must not be applied alone.** Flicker score falls as legitimate
  motion rises: shot 2 has 4.7× the flow of shot 1, so some of its 0.903 is honest movement, not
  artefact. Gate on flicker only when `flowTop5Pct` mean < ~5; above that, use #2 and
  `blendSmoothnessProxy` instead. Untangling the two properly needs a motion-conditioned baseline I do
  not have from two clips.
- **#5 and #7 need the intended style as an input.** Both are style-dependent in polarity, not in
  measurement. A `shotIntent` field of `static | cinematic | anime` would resolve both.
- **#3 is the one I would ship first.** It is high-confidence, it caught a real defect that every other
  metric missed, and it has clean separation between the two clips (1.235 vs 4.026).
- **#3 gets much sharper when paired with the frame difference at the same index**, which the measured
  data suggests directly: of the five largest sharpness drops in rainline, the four benign ones (cuts and
  violent motion) all carry rgbMae 19.7–46.0, while the one genuine generative collapse carries 4.58.
  Recommended refinement: flag a drop as a *detail collapse* only when `dropRatio ≥ 2.5` **and** the
  co-indexed `rgbMae` is below that shot's median. A drop with a large frame difference is an edit or a
  camera move, not a model failure. This is one clip's worth of evidence, so it is a hypothesis to test,
  not a settled rule.
- **#6, #8, #9 are low confidence** — single-clip separations with no replication. Treat as telemetry to
  collect, not as gates to enforce, until there is more data.

---

## 6. Limitations

1. **n = 2 clips, 4 shots, one model, one setting.** Everything in §5 is provisional. The two clips also
   differ enormously in content (crisp anime lineart at Laplacian variance ~1382 vs soft rainy cinematic
   at ~23), which is useful for showing scale-dependence but useless for establishing norms.
2. **Absolute Laplacian variance is not comparable across content.** 1382 vs 23 between the two clips is
   content, not quality. Only within-shot statistics — step ratio, fraction below median — transfer.
3. **No subject/background segmentation.** `backgroundHistCorrProxy` masks on below-median optical flow,
   so a stationary subject counts as background. On these clips it tracked `histCorrPrevFrame` almost
   exactly (0.9979 vs 0.9973 anime; 0.96546 vs 0.96546 rainline), meaning **it added no information
   here** and is unproven. Real separation needs segmentation.
4. **No semantic or aesthetic dimension at all.** Nothing here knows whether the video matches its
   prompt, has six-fingered hands, or is beautiful. That is the CLIP/DINO/LAION tier, and it is
   unavailable while torch cannot load.
5. **Farneback ≠ RAFT.** The dynamic-degree verdict uses VBench's thresholds with a weaker flow
   estimator. It recovered a known displacement to within 3.6% on synthetic content, but has not been
   cross-checked against RAFT on real footage.
6. **The linear-blend motion-smoothness proxy is strictly worse than AMT** and will read lower than a
   published VBench score on identical footage. Use it for ranking our own shots, never for claiming a
   VBench number.
7. **Colour drift assumes a single shot with no intentional grade change.** A deliberate sunset will
   trip #8.

---

## 7. Prototype usage

```bash
PY="D:\VYREALM-runtime\bootstrap-qualification\full-install\VYREALM-local-video-v1\venv\Scripts\python.exe"

# metrics to stdout
"$PY" scripts/qc/probe_metrics.py outputs/desktop/VYREALM_ANIME_HERO_5S.mp4

# to a file, aggregates only
"$PY" scripts/qc/probe_metrics.py shot.mp4 --out shot.qc.json --no-per-frame

# assertions on synthetic clips with known ground truth
"$PY" scripts/qc/probe_metrics.py --selfcheck
```

`--selfcheck` builds seven synthetic clips whose correct answers are known by construction — frozen,
panning at a known displacement, 2-frame flicker, progressive blur, held-on-twos, and a one-frame detail
cliff — and asserts the metrics respond correctly, including that the smooth pan does *not* trip the
stepped-motion detector. It needs no video files and no network. Current output:

```
selfcheck OK
  frozen    flicker=1.000000 flowMean=0.0001
  panning   flicker=0.969042 flowMean=2.8697 homogInlier=0.9665
  flicker   flicker=0.767355 flowMean=0.0267 blendSmooth=0.767355
  softening sharpTrend=-514.92 %/s
```

Failures are coded, never silently approximated: `VYQC_FILE_NOT_FOUND`, `VYQC_OPEN_FAILED`,
`VYQC_BAD_FPS`, `VYQC_NO_FRAMES`, `VYQC_TOO_FEW_FRAMES`. They emit
`{"error": {"code": ..., "message": ...}}` and exit 2.

---

## 8. What I would build next

1. **Ship `maxSingleFrameDropRatio` into the gate now.** Highest confidence, caught the defect nothing
   else saw.
2. **Add a `shotIntent` input** (`static | cinematic | anime`) so #5 and #7 can be enforced rather than
   merely reported.
3. **Auto-segment on `histCorrPrevFrame < 0.6` before gating**, so multi-shot timelines are scored per
   shot automatically.
4. **Collect telemetry on ~30 labelled shots** before hardening any low-confidence threshold.
5. **Fix the torch paging-file problem** if the semantic tier is ever wanted — but note that DINO/CLIP
   scoring on a 6 GB card competing with Wan2.2 for VRAM is a real scheduling problem, not just an
   install.
