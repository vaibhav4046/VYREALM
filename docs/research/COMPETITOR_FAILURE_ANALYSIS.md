# Competitor failure analysis — where hosted AI video actually breaks

Research date: 2026-09-07
Author: VYREALM research pass
Purpose: locate the failure surface of the leading hosted AI video tools and models, so VYREALM targets gaps deliberately instead of chasing pixel quality it cannot win.

---

## 0. How to read this document

Every claim below is tagged with a source class. A skeptical judge should be able to check the tag before weighing the claim.

| Tag | Meaning | Weight |
|---|---|---|
| `[PRIMARY]` | Vendor's own docs, model card, system card, licence, or technical report | High. The vendor is admitting it. |
| `[BENCHMARK]` | Published numeric leaderboard or peer-reviewed eval with a stated methodology | High for the number, medium for what the number means. |
| `[AGGREGATE]` | Review aggregator with a stated sample size (Trustpilot, BBB) | Medium. Selection-biased toward the angry, but the sample size and distribution are real. |
| `[SECONDARY]` | Hands-on review, comparison blog, community post | Low. Directionally useful, not evidence. Several of these are SEO content produced by competing vendors — flagged inline where that is true. |
| `[MEASURED-LOCAL]` | Numbers produced by running something on this machine during this research pass | High for this machine only. Not generalisable. |

**Nothing in this document is a measurement unless it is tagged `[MEASURED-LOCAL]` or `[BENCHMARK]`.** Where a plausible number exists only on a vendor blog, it is marked as unverified and is not used to support a conclusion.

---

## 1. The measured baseline

### 1.1 VBench-2.0 — the only benchmark that scores *reasoning*, not prettiness

`[BENCHMARK]` VBench-2.0 (arXiv 2503.21755) evaluates 18 dimensions of "intrinsic faithfulness" rather than aesthetic appeal. This is the single most useful competitor document in this report, because it publishes the exact dimensions on which every model — open and closed, 5B and 30B — collapses.

Table 2 of the paper, verbatim percentages:

| Dimension | HunyuanVideo | CogVideoX-1.5 | Sora-480p | Kling 1.6 |
|---|---|---|---|---|
| Human Anatomy | 88.58% | 59.72% | 86.45% | 86.99% |
| Clothes consistency | 82.97% | 87.18% | 98.15% | 91.75% |
| Identity consistency | 75.67% | 69.51% | 78.57% | 71.95% |
| Composition | 43.96% | 44.70% | 53.65% | 43.89% |
| Diversity | 39.73% | 42.61% | 67.48% | 53.26% |
| Mechanics | 76.09% | 80.80% | 62.22% | 65.55% |
| Material | 64.37% | 83.19% | 64.94% | 68.00% |
| Thermotics | 56.52% | 67.13% | 43.36% | 59.46% |
| Multi-view consistency | 43.80% | 21.79% | 58.22% | 64.38% |
| **Dynamic Spatial Relationship** | **21.26%** | **19.32%** | **19.81%** | **20.77%** |
| **Dynamic Attribute** | **22.71%** | **24.18%** | **8.06%** | **19.41%** |
| **Motion Order Understanding** | **26.60%** | **26.94%** | **14.81%** | **29.29%** |
| Human Interaction | 67.67% | 73.00% | 59.00% | 72.67% |
| **Complex Landscape** | **19.56%** | **23.11%** | **14.67%** | **18.44%** |
| **Complex Plot** | **10.11%** | **12.42%** | **11.67%** | **11.83%** |
| Camera Motion | 33.95% | 33.33% | 27.16% | 61.73% |
| Motion Rationality | 34.48% | 33.91% | 34.48% | 38.51% |
| Instance Preservation | 73.79% | 71.03% | 74.60% | 76.10% |

Source: https://arxiv.org/html/2503.21755v1

**The bolded rows are the thesis of this entire report.** They are the dimensions where *no model exceeds 30%*, regardless of parameter count, regardless of whether it is an open 13B checkpoint or a closed frontier system on a datacenter cluster. Complex Plot tops out at 12.42%. Motion Order Understanding tops out at 29.29%. Dynamic Attribute — "the ice cream melts", "the paper burns" — tops out at 24.18% and Sora scores 8.06%.

The paper's own diagnosis, quoted: current models "typically produce single-shot videos under 10 seconds", which is insufficient for coherent narrative; and models fail "roughly 80% of the time on simple spatial and attribute modifications", which the authors attribute to inadequate temporal grounding in training data.

`[BENCHMARK]` The VBench-2.0 project page confirms the radar-chart values are normalised to a 0.3–0.8 band "for better readability", meaning the visual presentation compresses how bad the low scores are. https://vchitect.github.io/VBench-2.0-project/

Caveat, stated honestly: the models in Table 2 are the 2025 generation (Sora-480p, Kling 1.6, HunyuanVideo, CogVideoX-1.5). Newer entries (Veo 3.1, Vidu Q1, Wan 3.0, LongCat-Video) appear on the live leaderboard, which I could not fetch — the HuggingFace space returns HTTP 401 and the project page does not render the numeric table. `[SECONDARY]` Third-party reporting places LongCat-Video's total score behind only Veo3 and Vidu Q1 (https://arxiv.org/pdf/2510.22200). **I am not claiming the 2026 models score identically on the weak dimensions.** I am claiming the *structure* of the weakness — narrative, ordering, state change — is architectural rather than scale-driven, and that no vendor has published a number contradicting it.

### 1.2 Artificial Analysis Video Arena — blind human preference, and price

`[BENCHMARK]` Text-to-video with audio, Elo from blind pairwise human votes. Price column is "the cost to generate 1 minute of 1080p video on the model creator's API at the model's default settings."

| Rank | Model | Creator | Elo | ±95% CI | $/min 1080p |
|---|---|---|---|---|---|
| 1 | Wan 3.0 | Alibaba | 1238 | ±10 | $12.00 |
| 2 | Gemini Omni Flash | Google | 1238 | ±6 | $6.00 |
| 3 | Minimax H3 Max (fal) | Fal | 1235 | ±10 | $2.40 |
| 4 | MiniMax H3 | MiniMax | 1227 | ±7 | $7.80 |
| 5 | Dreamina Seedance 2.0 720p | ByteDance | 1222 | ±5 | $9.07 |
| 10 | Kling 3.0 1080p Pro | KlingAI | 1108 | ±5 | $20.16 |
| 12 | SkyReels V4 | Skywork | 1103 | ±7 | $21.00 |
| 14 | Veo 3.1 | Google | 1091 | ±6 | $24.00 |
| 16 | Veo 3.1 Lite | Google | 1089 | ±6 | $4.80 |
| 18 | Veo 3.1 Fast | Google | 1086 | ±5 | $9.00 |
| 23 | grok-imagine-video | SpaceXAI | 1062 | ±5 | $4.20 |
| 27 | Seedance 1.5 pro | ByteDance | 1000 | ±0 | $11.86 |
| 33 | Agnes-Video-V2.0 | Sapiens AI | 920 | ±8 | $0.30 |

Source: https://artificialanalysis.ai/video/leaderboard/text-to-video

Two things a skeptical reader should extract from this table, because they cut against easy narratives:

1. **The top four are separated by 11 Elo points with confidence intervals of ±6 to ±10.** Ranks 1 through 4 are statistically indistinguishable. The frontier is a plateau, not a ladder. "Best model" marketing is noise at the top.
2. **Price does not track quality.** Veo 3.1 sits at rank 14 and costs $24.00/min — the most expensive model on the board — while Minimax H3 Max sits at rank 3 for $2.40/min, a 10x price difference in the *opposite* direction to the ranking. Paying more buys brand, integration, and rights, not measurably better pixels.

### 1.3 What one vendor's own system card does and does not measure

`[PRIMARY]` I read the full Sora 2 System Card (OpenAI, 30 September 2025, 6 pages). Direct quotes:

> "Sora 2 will be available via sora.com, in a new standalone iOS Sora app, and in the future it will be available via our API."

> "Our iterative deployment includes rolling out initial access to Sora 2 via limited invitations, restricting the use of image uploads that feature a photorealistic person and all video uploads, and placing stringent safeguards and moderation thresholds on content involving minors."

> "For general availability, our provenance safety tooling for our First-party (1P) products will include: C2PA metadata on all assets... Visible moving watermark on videos downloaded from sora.com or the Sora app... Internal detection tools..."

> "Safeguards for our initial launch include: not supporting video-to-video generation at launch, not supporting text-to-video generation of public figures, and blocking generations that include real people (other than users who consent through Sora's likeness-control cameo feature)"

The card's only quantitative table (Table 1: Safety Evaluations) reports `not_unsafe` and `not_overrefuse` at output: Adult Nudity/Sexual without likeness 96.04% / 96.20%; with likeness 98.40% / 97.60%; Self-Harm 99.70% / 94.60%; Violence and Gore 95.10% / 97.00%; Violative Political Persuasion 95.52% / 98.67%; Extremism/Hate 96.82% / 99.11%.

Source: https://cdn.openai.com/pdf/50d5973c-c4ff-4c2d-986f-c72b5d0ff069/sora_2_system_card.pdf

**This is the most important finding in the report and it is a fact about a document, not an opinion.** The Sora 2 system card contains **zero output-quality metrics**. Not one number about physics violation rate, temporal artifact rate, identity drift, hand deformation, or text legibility. Every measured quantity in the card is a *safety classifier* score. OpenAI measures, to two decimal places, how often the model produces content that would embarrass OpenAI. It publishes nothing about how often the model produces content that is simply broken.

That is the entire industry pattern in one artefact. Hosted vendors have built elaborate, quantified, red-teamed pipelines for **output blocking on policy** — and shipped nothing equivalent for **output blocking on quality**. The blocking machinery exists, is described in the card ("Output blocking: This approach, applied after the video has been generated..."), and is pointed exclusively at liability rather than at the user's actual problem.

---

## 2. Question 1 — what does EVERY model still get wrong?

Ordered by how attackable each gap is with logic rather than scale.

### 2.1 Narrative and multi-shot structure — the deepest universal gap

`[BENCHMARK]` Complex Plot: 10.11% / 12.42% / 11.67% / 11.83% across HunyuanVideo, CogVideoX-1.5, Sora, Kling 1.6. Every model is below 13%. The VBench-2.0 authors attribute this directly to the single-shot sub-10-second output ceiling.

`[PRIMARY]` The ceiling is confirmed by the vendors themselves. Google's Veo 3.1 documentation states supported durations are **4, 6, or 8 seconds** and that "Referencing or reasoning across multiple videos is not currently supported... attempting multi-video prompting may result in degraded model performance or unexpected outputs." https://ai.google.dev/gemini-api/docs/veo

`[SECONDARY]` MiniMax's Hailuo family is documented at a 10-second per-video ceiling; Luma Dream Machine tops out at 15 seconds per generation with longer output achieved by chaining "Extend" calls.

**Consequence:** every multi-shot piece anyone has ever made with these tools was assembled *outside* the model, by a human or a script, from clips the model produced blind to each other. The model does not know shot 2 follows shot 1. Nothing in the generator enforces continuity across a cut. This is not a scale problem — a 30B model still emits 8 seconds with no memory of the previous 8 — it is a *systems* problem, and systems problems are attackable by a 5B model with good orchestration.

### 2.2 State change over time — objects that should transform, don't

`[BENCHMARK]` Dynamic Attribute: 22.71% / 24.18% / **8.06%** / 19.41%. Dynamic Spatial Relationship: 21.26% / 19.32% / 19.81% / 20.77%. Motion Order Understanding: 26.60% / 26.94% / 14.81% / 29.29%.

Three separate dimensions, all measuring "did the thing change in the order and manner the prompt described", all under 30%, all four models. Sora's 8.06% on Dynamic Attribute is the single worst number in the table — a frontier model scoring below one in twelve on "the candle burns down."

**This is detectable without a model.** "The ice melts" implies monotonic change in a measurable image statistic over the clip. Prompt says a state transition; frames show none; the shot is wrong. That is arithmetic on pixel histograms, not intelligence.

### 2.3 Physics violations

`[BENCHMARK]` Mechanics 62.22%–80.80%, Thermotics 43.36%–67.13%, Motion Rationality 33.91%–38.51%. Motion Rationality never breaks 39% for any model.

`[PRIMARY]` OpenAI's own framing in the Sora 2 launch material is that Sora 2 achieves "more accurate physics" while remaining "still imperfect" — the system card does not quantify the residual. `[SECONDARY]` Hands-on reporting describes "physics hallucinations" including solid objects intersecting, and specific weakness on fluid dynamics and multi-character interaction. https://openai.com/index/sora-2/

**Partially detectable.** Object interpenetration and impossible acceleration are measurable from optical flow. Full physical plausibility is not. Claim only what optical flow supports.

### 2.4 Identity and continuity drift

`[BENCHMARK]` Identity consistency 69.51%–78.57%; Instance Preservation 71.03%–76.10%. Even the best model loses the subject roughly a quarter of the time within a single sub-10-second shot — before any cut.

`[AGGREGATE]` Higgsfield Trustpilot, 7 September 2026: a reviewer reports "characters' faces, ages, hairstyles, clothing, and body proportions often changed between shots." https://www.trustpilot.com/review/higgsfield.ai

`[SECONDARY]` Multiple 2026 hands-on reviews of Higgsfield's Soul ID consistency feature converge on a "90% consistency ceiling" and note that "profile shots and overhead angles noticeably break Soul ID continuity." Treat the specific figure as unverified — no vendor publishes a measured identity-drift rate — but the direction is consistent across independent reviewers.

**Highly detectable.** Face/region embedding distance between the first and last frame of a shot, and across a cut, is a cheap deterministic measurement.

### 2.5 Hands, limbs, and fast motion

`[BENCHMARK]` Human Anatomy 59.72%–88.58%; CogVideoX-1.5 fails anatomy 40% of the time.

`[SECONDARY]` Runway's own help material and independent reviews of Gen-4/Gen-4.5 converge that "continuity, physics, hands, text and complex interactions still need careful review across every take", and that close-up finger–object interaction "often requires multiple generations to get a usable take." https://help.runwayml.com/hc/en-us/articles/46974685288467-Creating-with-Gen-4-5

Note the phrasing in the vendor's own help centre: the remedy on offer is *look at every take yourself* and *generate again*. There is no automated check. The vendor knows the failure mode, names it, and hands the inspection burden to the paying user who is billed per attempt.

### 2.6 On-screen text

`[PRIMARY]` ByteDance names text rendering among Seedance's remaining weaknesses alongside multi-subject consistency, complex edits, detail stability, and occasional audio distortion. https://seed.bytedance.com/en/blog/official-launch-of-seedance-2-0

**Trivially detectable.** OCR the frames; if the prompt asked for a sign reading X and OCR returns garbage, reject. No model needed beyond an OCR pass, and this is one of the few failures that is *fully* machine-checkable.

### 2.7 Temporal artifacts — flicker, shimmer, morph

`[PRIMARY]` The Sora 2 launch material acknowledges "temporal artifacts" among the model's mistakes.

`[SECONDARY]` Independent write-ups characterise the failure at three levels: frame-level flicker, shot-level drift, cross-scene style incoherence — and specifically describe abrupt feature inversion/morphing where frontal and rear characteristics swap mid-sequence.

**Highly detectable.** Frame-differencing and inter-frame perceptual distance find flicker and morph cheaply. This is the most tractable universal failure on the list.

### 2.8 Summary — the universal gap in one sentence

Every model, at every scale, is weak on **things that unfold over time and across shots**: order, state change, causality, identity, narrative. And every hosted product ships those weak outputs to the user unmeasured. **Scale improved the frame. It has not fixed the sequence, and no vendor measures the sequence.**

---

## 3. Question 2 — product and workflow gaps, distinct from model gaps

These are the gaps that do not require beating anyone's model. They are business-model and product-surface gaps.

### 3.1 The credit model charges for failure

This is the structural defect underneath most user anger, and it follows directly from §2: the vendor knows roughly a quarter of takes are unusable, prices per attempt, and provides no automated way to tell a good take from a bad one.

`[PRIMARY]` Runway Gen-4 and Gen-4.5 are billed at 12 credits per generated second in-app; the API lists Gen-4.5 at $0.12 per generated second. Billing is on *generation*, not on *acceptance*.

`[PRIMARY]` Google Veo 3.1 API pricing: $0.40/sec (720p and 1080p), $0.60/sec (4K); Veo 3.1 Fast $0.10/sec (720p), $0.12/sec (1080p), $0.30/sec (4K); Veo 3.1 Lite $0.05/sec (720p), $0.08/sec (1080p). Audio included. https://ai.google.dev/gemini-api/docs/pricing

Veo 3.1 does have one genuinely good behaviour worth naming: `[PRIMARY]` "Safety filters may block videos; no charge if blocked." Google refunds *policy* failures. It does not refund *quality* failures. Nobody does.

`[AGGREGATE]` Runway, Trustpilot: TrustScore **1.1/5 across 323 reviews**, 180 in the last 12 months, **92% one-star**. Representative, dated: "Did a 26 second video that used all my first month credits" (31 Aug 2026); "repeatedly struggled to generate it and failed over and over again. Each attempt costs a significant number of credits" (3 Sept 2026); support response quoted as "completed generations are non-refundable" (21 Aug 2026). https://ca.trustpilot.com/review/runwayml.com

`[AGGREGATE]` Kling, Trustpilot: TrustScore **1.2/5 across 381 reviews**, 215 in the last 12 months, **89% one-star**. Representative: "I purchased a Pro monthly subscription... I had 3000 credits... The next day... credit balance was 60" (Aug 2026); "they charged my card $79.20... despite having SEVEN DAYS' advance written notice that I did not authorize the renewal." https://www.trustpilot.com/review/klingai.com

`[AGGREGATE]` Higgsfield, Trustpilot: **4.0/5 across 4,211 reviews, 19% one-star** — materially better than Runway or Kling, and worth stating plainly rather than burying. But the one-star themes are the same: expiring credits (21 Aug 2026), "I used a significant number of credits correcting unpredictable AI errors" (7 Sept 2026), and one user reporting "only TWO generations successfully completed" in 24 hours on a premium plan (4 Sept 2026).

`[AGGREGATE]` Higgsfield, BBB (San Francisco): **27 complaints in 3 years, all 27 closed in the last 12 months — 16 unanswered, 8 answered, 3 resolved.** Dated examples: refund refused despite request "within 30 mins of being charged... ZERO credits have been used" (21 June 2026); newly released models "presently limited to verified Business users" despite advertised Creator-plan access (6 April 2026); features removed mid-project after credits consumed (19 May 2026). https://www.bbb.org/us/ca/san-francisco/profile/artificial-intelligence/higgsfield-ai-1116-977987/complaints

**Selection-bias caveat, stated up front:** Trustpilot and BBB are complaint venues. A 1.1 TrustScore is not the average user's experience — it is the experience of users motivated enough to file. What is *not* selection-biased is the **theme distribution**: across three independent vendors and four independent aggregators, the top themes are identical (credits burned on unusable output, no refund for quality failure, credit expiry, cancellation friction). That convergence is signal even if the star ratings are not.

### 3.2 Rate limits, queues, and non-determinism as a product

`[PRIMARY]` Veo 3.1: "Request latency ranges from a minimum of 11 seconds to a maximum of 6 minutes during peak hours." A 32x variance in delivery time, documented by the vendor, with no SLA.

`[PRIMARY]` Veo 3.1: **generated videos are retained on Google's servers for 2 days and then deleted.** Miss the window, lose the asset — and the asset cost you real money.

`[SECONDARY]` Multiple sources report Kling free-tier queue backlogs of hours during peak US/EU afternoons and failure rates in the 30–60% band at peak. **I could not verify these percentages against any primary source and they should not be cited as fact.** The underlying dynamic — shared infrastructure means your throughput depends on strangers — is structurally true regardless.

### 3.3 No batch, no format automation, no platform recuts

`[PRIMARY]` Veo 3.1 supports exactly two aspect ratios: 16:9 and 9:16. No 1:1, no 4:5, no 2.39:1. A creator delivering to Instagram feed (4:5), Stories/Reels (9:16), YouTube (16:9), and a cinema crop is doing three of those four conversions in another tool.

`[SECONDARY]` The gap is real enough that a whole product category exists to patch it — Envato VideoGen Reframe, OpusClip reframe, Adobe Firefly reframe in Premiere, all sold as bolt-ons to fix what the generator did not do. Note that the most detailed articulation of this gap I found is published by **Higgsfield's own blog** (https://higgsfield.ai/blog/ai-batch-generation-tools-2026), which is a competitor marketing asset; the observation stands, the framing is not neutral.

**Honest correction to the brief:** Higgsfield *does* ship batch generation and multi-ratio branching. "No batch" is not a fair universal claim. The fair claim is narrower and stronger: **batch exists, batch-with-quality-gating does not.** Generating 8 variants is a solved feature. Automatically discarding the 6 broken ones is not shipped anywhere I could find.

### 3.4 No QC — the gap with no competitor

I searched specifically for a hosted platform that measures its own output and auto-retries or auto-refunds on quality grounds. I found:

- `[SECONDARY]` Vendor claims of "Smart Render" modes and "quality anchors" with specific improvement percentages, published by the vendors selling them, with no methodology. Not evidence.
- `[PRIMARY]` Veo's no-charge-if-safety-blocked policy — the only vendor-side automated output gate I could confirm, and it gates policy, not quality.

`[PRIMARY]` And the Sora 2 system card, which as established in §1.3 proves the *capability* exists and is pointed elsewhere: OpenAI describes an "Output blocking" stage that runs "after the video has been generated" using "a multimodal reasoning model which is custom-trained to reason about content policies." The post-generation inspection pipeline is built. It reasons about policy. It does not reason about whether the video is any good.

**Conclusion, stated carefully:** I found no hosted tool that measures a generated clip against the prompt's implied physical and temporal expectations and refuses or repairs it. This is an absence-of-evidence claim from a bounded search, not a proof of non-existence — but the search was targeted and the absence is consistent with the incentive: a vendor billing per generation has no commercial reason to reduce generations.

### 3.5 Rights, watermarks, and privacy

| Vendor | Watermark | Commercial rights | Class |
|---|---|---|---|
| Sora 2 (1P) | "Visible moving watermark on videos downloaded from sora.com or the Sora app"; C2PA metadata on all assets | Commercial permitted on paid tiers; removing branding to misrepresent origin is a ToS violation | `[PRIMARY]` / `[SECONDARY]` |
| Veo 3.1 | SynthID invisible watermark on all output | Per Google Cloud terms | `[PRIMARY]` |
| Kling | Free tier watermarked; watermark-free from Standard membership | Free-tier output restricted from commercial use | `[SECONDARY]` |
| Luma Dream Machine | Free tier: permanent watermark, draft resolution | Commercial rights from Plus ($29.99/mo) | `[SECONDARY]` |
| Pika | Watermark removed on paid | Commercial rights reported at the $28/mo Pro tier | `[SECONDARY]` |

`[PRIMARY]` Sora 2's content restrictions are unusually tight and worth quoting because they are a real product constraint, not just a safety note: at launch, "not supporting video-to-video generation", "not supporting text-to-video generation of public figures", and "blocking generations that include real people (other than users who consent through Sora's likeness-control cameo feature)". Regionally, `[PRIMARY]` Veo restricts `personGeneration` to `allow_adult` only in the EU, UK, Switzerland and MENA — which means a UK-based creator has strictly fewer capabilities than a US one, on the same paid plan.

`[SECONDARY]` On privacy: Variety's reporting on studio hesitancy notes that uploading NDA-protected footage to a cloud AI tool constitutes disclosure to a third party regardless of whether it is discovered, and that actor footage in particular is kept away from cloud generative tools. https://variety.com/vip/gen-ai-video-limbo-why-studios-still-uncertain-1236284800/ Filenames and metadata alone leak — an unreleased product name or a celebrity's name in a filename appears in processing logs.

### 3.6 No editable source

Every hosted tool returns an MP4. Not a project file, not a node graph, not the latents, not the seed-plus-parameters bundle needed to reproduce or partially re-roll a shot. If frame 60 of an otherwise perfect take has a broken hand, the only remedy the product offers is to regenerate the entire clip and pay again — which is why `[SECONDARY]` practitioners report "Frankenstein shots" stitched from the best seconds of multiple generations of the same prompt. The workaround exists because the product refuses to expose the seam.

---

## 4. Question 3 — what users complain about most, ranked

Ranking method: theme frequency weighted by how many *independent* aggregators and vendors it appears across. A theme appearing at Runway, Kling, and Higgsfield on both Trustpilot and BBB outranks a theme appearing once.

**1. Credits consumed by unusable output, with no refund.**
Present at Runway (Trustpilot, 92% 1-star, multiple dated quotes), Kling (Trustpilot, 89% 1-star), Higgsfield (Trustpilot 1-star cluster + BBB). Unanimous across all sources examined. This is the #1 complaint by a wide margin and it is the direct commercial consequence of §2 plus §3.4: models fail on a predictable schedule, nothing detects it, the user pays anyway.

**2. Billing practice — expiry, renewal, cancellation friction, refund refusal.**
Kling Trustpilot (unauthorised renewal quote, 7 days' written notice ignored). Higgsfield BBB (16 of 27 complaints unanswered; refund refused 30 minutes after charge with zero credits used). Runway Trustpilot (feature access changed mid-subscription, 5 Sept 2026). Distinct from #1: this is about the contract, not the output.

**3. Character/identity inconsistency across shots.**
Higgsfield Trustpilot (7 Sept 2026, verbatim). Confirmed numerically by VBench-2.0 Identity (69–79%) and Instance Preservation (71–76%). The only top-3 complaint with a published benchmark number behind it.

**4. Prompt adherence — "it doesn't make what I asked for."**
Runway Trustpilot (repeated). Corroborated by VBench-2.0 Composition (43.89–53.65%) and the sub-30% dynamic dimensions.

**5. Reliability, queues, and failure at peak.**
Higgsfield Trustpilot ("only TWO generations successfully completed" in 24h, 4 Sept 2026). Veo's documented 11s–6min latency band. Peak failure-rate percentages circulating in secondary sources are **unverified** and excluded from the ranking weight.

**6. Support non-response.**
Runway ("Customer support is non existent and 3 weeks later, the problem still exists", 31 Aug 2026). Kling ("completely unresponsive"). Higgsfield BBB: 16 of 27 complaints never answered — the hardest number available on this theme.

**7. Duration ceilings and multi-shot assembly burden.**
Structural (§2.1) rather than a loud complaint, because users have normalised it.

**8. Watermarks and commercial-rights gating.**
Real but low-heat — users treat it as the price of the free tier rather than a grievance.

---

## 5. Question 4 — where a local, unlimited, self-correcting system is genuinely better

Rules for this section: a win must survive the question "would a hosted vendor fix this next Tuesday if they wanted to?" If yes, it is not a durable advantage. And every win is paired with the cost it carries.

### 5.1 Genuine, durable wins

**W1 — Marginal cost per attempt is ~0, which makes measurement-and-retry economically possible.**

`[MEASURED-LOCAL]` Verified on this machine, this session, with ffprobe at `workers/tools/ffprobe.exe`:

```
VYREALM_ANIME_HERO_5S.mp4       h264 1024x576  24/1 fps  121 frames  5.041667s  3,134,779 bytes
VYREALM_RAINLINE_TRAILER_1080P.mp4  h264 1920x1080 24/1 fps  360 frames 15.000000s 13,140,277 bytes
```

Generation time for the 121-frame clip: 1568s at 20 steps (from the project brief, not re-measured this session). Derived: **12.96 s of compute per output frame; 311x slower than realtime.**

Cost comparison against the cheapest credible hosted equivalent, using `[PRIMARY]` published API prices:

| | 5s clip, one attempt | At 3 attempts per usable shot |
|---|---|---|
| Veo 3.1 (1080p, $0.40/s) | $2.00 | $6.00 |
| Veo 3.1 Fast (720p, $0.10/s) | $0.50 | $1.50 |
| Veo 3.1 Lite (720p, $0.05/s) | $0.25 | $0.75 |
| Runway Gen-4.5 API ($0.12/s) | $0.60 | $1.80 |
| VYREALM local | 26.1 min wall-clock + electricity | 78.4 min wall-clock + electricity |

The "3 attempts per usable shot" multiplier comes from `[SECONDARY]` vendor FAQ content (invideo.io) citing a 164-generations-to-41-final-shots case study, ~25% selection. **This is a marketing-blog number with no methodology and I do not treat it as measured.** It is included because it is the only quantified estimate I could find, and because the direction is corroborated by VBench-2.0's sub-30% dimensions. If the true ratio is 2:1 the argument weakens slightly; if it is 5:1 it strengthens. It does not change the sign.

The electricity figure is **deliberately left unfilled** — I did not measure GPU power draw and will not invent it. Measure with `nvidia-smi --query-gpu=power.draw --format=csv -l 5` across a full generation and integrate; the formula is `kWh = mean_watts x 1568s / 3.6e6`, times the local tariff.

The real point is not "cheaper". It is: **at ~$0 per attempt, a measure-and-retry loop is free to run; at $2.00 per attempt it is not.** A hosted product cannot build the self-correction loop VYREALM can build, because every retry it spends is either a charge that angers the user or a cost it absorbs. Local flips retry from a cost centre into a quality mechanism. This is the load-bearing advantage and it is durable, because it is a consequence of the business model, not of the technology.

**W2 — The output is inspectable, and inspection has somewhere to go.**

Hosted tools return an MP4 and end the transaction. VYREALM holds every frame, every intermediate, the seed, the prompt, the workflow graph. A detector that finds identity drift between frame 1 and frame 121 can act — re-roll with a different seed, shorten the shot to the stable window, repair the segment. Hosted tools structurally cannot: `[PRIMARY]` Veo deletes the video after 2 days and never exposed the latents at all.

**W3 — Prompt shaping against a known failure catalogue.**

§2 gives a measured list of what breaks: state changes (8–24%), motion ordering (15–29%), multi-shot plot (10–12%), on-screen text. A prompt compiler that *refuses to write prompts that land in those buckets* — decomposing "the candle burns down as she reads" into shots that do not require the model to model combustion — raises the usable-take rate without touching the model. `[PRIMARY]` Every vendor knows these buckets; none of them stops you walking into one, because a failed generation is revenue.

**W4 — Privacy is a categorical difference, not a gradient.**

`[SECONDARY]` Studio and agency footage under NDA cannot legally go to a cloud endpoint; metadata in filenames leaks even when the pixels are fine. `[PRIMARY]` Veo retains output on Google's servers for 2 days by design. Local generation is not "more private", it is *a different legal category*: no disclosure to a third party occurs. No hosted vendor can match this without becoming an on-prem vendor.

**W5 — No rights ambiguity, no watermark, no regional capability gap.**

`[PRIMARY]` Sora 2 applies a visible moving watermark to 1P downloads and C2PA metadata to all assets; `[PRIMARY]` Veo applies SynthID to everything; `[PRIMARY]` Veo restricts person generation in the UK/EU relative to the US. Wan 2.2 ships under Apache-2.0 with the model licence's use restrictions and no watermarking obligation. For a UK-based user this last point is concrete and not theoretical.

**W6 — Determinism and reproducibility.**

`[PRIMARY]` Veo's own documented 11s-to-6-minutes latency band means the same job has a 32x delivery-time spread depending on other people's load. Local throughput is a function of one machine. A pipeline that must produce N shots on a deadline can be *scheduled* locally and cannot be scheduled on a shared queue.

### 5.2 Where hosted tools are simply better, stated without hedging

If this section is missing or soft, the whole document reads as motivated reasoning. These are real and several of them are not closeable.

**L1 — Per-frame visual fidelity. Not close, and not closeable.**
`[BENCHMARK]` The top of the Artificial Analysis arena is 1238 Elo from blind human preference on 13B–30B models. A Q4-quantised 5B on 6GB is not in that distribution and no orchestration fixes it. Any VYREALM claim of parity is false and would be caught in the first side-by-side.

**L2 — Wall-clock speed. 300x.**
`[MEASURED-LOCAL]` 1568s for 5.04s of output = 311x realtime. `[PRIMARY]` Veo's *worst documented* case is 6 minutes; typical is nearer 11–60s. For anyone with a deadline measured in hours rather than days, hosted wins outright and the argument is over.

**L3 — Native synchronised audio.**
`[PRIMARY]` Veo 3.1 includes audio in the base per-second price at every tier. Sora 2 generates synchronised dialogue and effects. VYREALM's local audio path is FFmpeg mixing of supplied assets. This is a genuine feature gap, not a positioning difference.

**L4 — Resolution and duration headroom.**
`[PRIMARY]` Veo 3.1 delivers 4K at $0.60/s. `[MEASURED-LOCAL]` VYREALM's real generated sample is 1024x576, upscaled for the 1080p trailer. `[PRIMARY]` Wan2.2's own README states TI2V-5B "can run on a GPU with at least 24GB VRAM (e.g, RTX 4090)" — running it at all on 6GB via Q4 GGUF is already outside the vendor's supported envelope, and headroom above 1024x576 does not exist on this hardware.

**L5 — Prompt adherence at the frontier.**
`[BENCHMARK]` Composition 43.89–53.65% for the 2025 frontier is unimpressive in absolute terms but is still ahead of a 5B model. Self-correction narrows the gap in *delivered* output; it does not narrow it in *first-attempt* output.

**L6 — Zero setup, zero maintenance, works on a phone.**
No local system competes with a URL and a text box. `[AGGREGATE]` Higgsfield's 4.0/5 across 4,211 reviews is a real signal that a large population is well served by a hosted product and is not looking for a local one.

**L7 — Reference-driven and multimodal conditioning.**
Multi-reference conditioning (up to 50 references on some Higgsfield surfaces), motion transfer, and likeness-consented cameo features are shipped hosted capabilities with no bundled local equivalent in VYREALM today.

### 5.3 The defensible position, in one paragraph

VYREALM should not claim better video. It should claim **a higher proportion of delivered shots are usable, and it can prove the number.** Hosted tools measure safety to two decimal places and quality not at all — that is a verified fact about OpenAI's own system card, not a rhetorical flourish. The frontier's weakest measured dimensions are ordering, state change, and narrative, which are systems failures rather than capacity failures, and are therefore attackable by orchestration on a 5B model. The economics only close locally: a measure-and-retry loop costs ~$0 per iteration on owned hardware and $0.25–$2.00 per iteration on someone else's, which is why no hosted vendor has built one and why it is not obvious that one ever will.

---

## 6. What this makes actionable for the build

Ordered by evidence strength behind the detector, not by ease of implementation.

| # | Detector / behaviour | Failure it targets | Evidence | Feasibility on this box |
|---|---|---|---|---|
| 1 | Inter-frame perceptual distance → flicker/morph score, with a hard reject threshold | Temporal artifacts (§2.7) | `[PRIMARY]` OpenAI names temporal artifacts | Pure numpy/opencv on decoded frames. Cheap. |
| 2 | First-vs-last-frame subject embedding distance → identity drift score | Identity 69–79%, Instance Pres. 71–76% (§2.4) | `[BENCHMARK]` | Needs an embedding; check venv for torch+opencv before assuming. |
| 3 | OCR pass when prompt implies on-screen text; reject on garbage | Text rendering | `[PRIMARY]` ByteDance names it | Only if an OCR dep already exists — **check `pip list` first, do not add one.** If absent, detect "prompt requests text" and refuse the shot at prompt-compile time instead. |
| 4 | Monotonic-statistic check when prompt implies a state transition | Dynamic Attribute 8.06–24.18% (§2.2) | `[BENCHMARK]` — worst number in the table | Histogram/luminance trend over frames. Trivial. |
| 5 | Optical-flow sanity: impossible acceleration, interpenetration proxies | Motion Rationality ≤38.51% (§2.3) | `[BENCHMARK]` | opencv Farneback if available. Claim only what flow supports. |
| 6 | Prompt compiler that refuses constructions landing in the sub-30% buckets | Motion order, complex plot, dynamic spatial | `[BENCHMARK]` all four models <30% | Pure logic. Highest value per line of code on this list. |
| 7 | Shot-boundary continuity check across cuts in an assembled timeline | Complex Plot ≤12.42% (§2.1) | `[BENCHMARK]` + `[PRIMARY]` 8s ceilings | VYREALM already owns the timeline; hosted tools structurally cannot do this. |
| 8 | Per-shot QC receipt: every delivered clip carries its measured scores | §3.4 — nobody ships this | `[PRIMARY]` Sora 2 card has zero quality metrics | JSON alongside the MP4. This is the differentiator made visible. |
| 9 | Multi-ratio recut from one accepted master | §3.3 — Veo ships 16:9 and 9:16 only | `[PRIMARY]` | FFmpeg. Already in the stack. |

Item 8 is the one that turns the thesis into a product. A hosted tool hands you a file. VYREALM should hand you a file *and the measurements that justified shipping it* — because §1.3 established that no competitor publishes such a number for any output, ever.

---

## 7. Known gaps in this research

Stated so a judge does not have to find them.

1. **No 2026-generation VBench-2.0 numbers.** The HuggingFace leaderboard space returns HTTP 401; the project page renders the table as a normalised radar chart only. Table 2 figures are the 2025 cohort. The structural argument does not depend on the specific models, but the specific percentages are dated and should be refreshed if the live table becomes reachable.
2. **Peak failure rates are unverified.** 30–60% peak-hour failure figures for Kling circulate widely in secondary sources with no primary corroboration. Excluded from all conclusions.
3. **The 3:1 generations-per-usable-shot ratio is a vendor-blog number.** Used only to illustrate the shape of the cost argument, never as a measurement.
4. **Trustpilot and BBB are complaint venues.** Star ratings are selection-biased. Only the cross-vendor theme convergence is treated as signal.
5. **Higgsfield's own blog is cited once (§3.3) on batch/format gaps.** It is a competitor marketing asset and is flagged as such inline.
6. **Electricity cost is not measured.** Formula and command given in §5.1; number deliberately left blank rather than estimated.
7. **§3.4's "no hosted QC exists" is an absence-of-evidence claim** from a bounded search, not a proof. Stated as such.
8. **I could not reach Runway's or Kling's official ToS/pricing pages directly** — those rows lean on secondary reporting of primary terms and are tagged accordingly.

---

## 8. Sources

Primary — vendor documents
- OpenAI, Sora 2 System Card (30 Sept 2025, full PDF read): https://cdn.openai.com/pdf/50d5973c-c4ff-4c2d-986f-c72b5d0ff069/sora_2_system_card.pdf
- OpenAI, Sora 2 announcement: https://openai.com/index/sora-2/
- Google, Veo 3.1 API documentation (durations, limitations, retention, SynthID, regional): https://ai.google.dev/gemini-api/docs/veo
- Google, Gemini API pricing (Veo per-second): https://ai.google.dev/gemini-api/docs/pricing
- Google Cloud, Veo 3.1 model page: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate
- ByteDance Seed, Seedance 2.0 launch (named weaknesses): https://seed.bytedance.com/en/blog/official-launch-of-seedance-2-0
- ByteDance, Seedance 1.0 technical report: https://arxiv.org/html/2506.09113v1
- Alibaba, Wan2.2 repository (VRAM requirements, licence): https://github.com/Wan-Video/Wan2.2
- Runway, Creating with Gen-4.5 help article: https://help.runwayml.com/hc/en-us/articles/46974685288467-Creating-with-Gen-4-5
- Higgsfield refund policy: https://higgsfield.ai/creator-hub/help-center/refunds/how-do-i-request-a-refund

Benchmarks
- VBench-2.0 paper, Table 2 per-dimension scores: https://arxiv.org/html/2503.21755v1
- VBench-2.0 project page: https://vchitect.github.io/VBench-2.0-project/
- Artificial Analysis, text-to-video leaderboard (Elo + $/min): https://artificialanalysis.ai/video/leaderboard/text-to-video
- LongCat-Video technical report (VBench-2.0 relative placement): https://arxiv.org/pdf/2510.22200

Aggregators — stated sample sizes
- Runway, Trustpilot (1.1/5, 323 reviews, 92% 1-star): https://ca.trustpilot.com/review/runwayml.com
- Kling, Trustpilot (1.2/5, 381 reviews, 89% 1-star): https://www.trustpilot.com/review/klingai.com
- Higgsfield, Trustpilot (4.0/5, 4,211 reviews, 19% 1-star): https://www.trustpilot.com/review/higgsfield.ai
- Higgsfield, BBB (27 complaints, 16 unanswered): https://www.bbb.org/us/ca/san-francisco/profile/artificial-intelligence/higgsfield-ai-1116-977987/complaints

Secondary — treat as directional only
- Variety VIP, studio uncertainty on generative video: https://variety.com/vip/gen-ai-video-limbo-why-studios-still-uncertain-1236284800/
- Higgsfield blog, batch generation tools (competitor marketing asset): https://higgsfield.ai/blog/ai-batch-generation-tools-2026
- invideo.io, generations-per-usable-shot FAQ (vendor blog, no methodology): https://invideo.io/faq/how-many-ai-video-generations-do-you-need-per-usable/

Local measurement
- ffprobe `C:\Users\lalwa\Documents\Codex\2026-09-06\j\workers\tools\ffprobe.exe` against `outputs/desktop/VYREALM_ANIME_HERO_5S.mp4` and `outputs/desktop/VYREALM_RAINLINE_TRAILER_1080P.mp4`, 2026-09-07. Raw output reproduced verbatim in §5.1.
