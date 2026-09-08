# Creator workflow anatomy: what short-form creators actually do, and which parts VYREALM can take

Compiled 2026-09-08. Read-only research pass. No file outside this document was modified.

Companion to `docs/research/VIRAL_YOUTUBE_FORMATS_2026-09-07.md` (which catalogues *structure*)
and `docs/research/VYREALM_EXTENSION_MAP_2026-09-07.md` (which catalogues *plumbing*). This one
catalogues *labour*: the eleven stages between an idea and a published video, who does what, with
which tool, and where the hours actually go.

---

## 0. Evidence rules

Four rules govern every claim.

1. **Every factual claim carries a URL.** Anything I could not verify against a page fetched in
   this session is labelled `UNVERIFIED`.
2. **Evidence tiers are explicit.**
   - `[PRIMARY]` platform or tool vendor's own documentation, fetched and read this session.
   - `[VENDOR]` a tool company's marketing or blog claim. A number here is a hypothesis, not a fact.
   - `[SECONDARY]` third-party analysis, trade press, or aggregator.
   - `[MEASURED-LOCAL]` a number measured on this machine and recorded in this repository.
3. **No invented time estimates.** Where the literature has no citable figure for a stage, this
   document says "no citable figure found" and leaves it empty. It does not fill the gap with a
   plausible-sounding range. Roughly half the stages below have no defensible time number in
   public sources, and that is itself a finding: the creator-workflow literature is almost entirely
   qualitative.
4. **Automation verdicts are grounded in code I read.** Every `TODAY` verdict names the module and
   the exported function that does the work. Every `NOT CONNECTED` verdict quotes the error code
   the repository itself already returns for that capability.

### 0.1 The repository's own admission of scope

`runtime/automation-tools.mjs:53` already declares which of these stages are unimplemented, by
error code. This is the most reliable automation evidence in the document, because it is the
product's own contract rather than my reading of it:

```
research_topic           -> RESEARCH_NOT_CONNECTED
extract_podcast_clips    -> PODCAST_SELECTION_NOT_CONNECTED
create_thumbnail         -> THUMBNAIL_NOT_CONNECTED
schedule_campaign        -> SCHEDULER_NOT_CONNECTED
create_platform_variants -> VARIANT_QUEUE_NOT_CONNECTED
```

Those five codes map one-to-one onto five of the eleven stages below. Where a stage's verdict is
`NOT CONNECTED`, I cite the code rather than asserting the gap myself.

---

## 1. Executive summary

| # | Stage | Dominant tools | Citable time figure? | VYREALM verdict |
|---|---|---|---|---|
| 1 | Idea capture | Notion, notes apps, YouTube Studio Inspiration / Ask Studio, vidIQ, 1of10 | No | **HUMAN** (`RESEARCH_NOT_CONNECTED`) |
| 2 | Packaging-first (title + thumbnail concept) | Docs, thumbnail sketches, title lists | No | **HUMAN**, machine-assistable |
| 3 | Scripting | Google Docs, Notion, LLMs, Descript | Partial, weak | **TODAY (partial)** via `prompt-logic.mjs` + Ollama hooks |
| 4 | Shot listing | StudioBinder, spreadsheets, Notion | No | **TODAY** via `format-library.mjs` `buildProductionPlan` |
| 5 | Filming or sourcing | Phone, mirrorless, Pexels/Storyblocks, screen capture | No | **TODAY for generated**, HUMAN for filmed |
| 6 | Editing | CapCut, Premiere Pro, DaVinci Resolve, Final Cut, Descript | Weak, wide range | **TODAY for templated cuts**, HUMAN for judgement cuts |
| 7 | Captioning | CapCut auto-captions, Submagic, Descript, platform auto-captions | No | **TODAY** via `format-captions.mjs` + faster-whisper |
| 8 | Thumbnail production | Photoshop, Canva, Figma, Photopea | No | **NOT CONNECTED** (`THUMBNAIL_NOT_CONNECTED`) |
| 9 | Packaging finalisation and A/B | YouTube Studio A/B test | Test runs "a few days or up to 2 weeks" `[PRIMARY]` | **HUMAN** (platform-side) |
| 10 | Scheduling | YouTube Studio, Meta Business Suite, Buffer/Later/Metricool | No | **NOT CONNECTED** (`SCHEDULER_NOT_CONNECTED`) |
| 11 | Publishing | Native uploaders; YouTube Data API, IG Graph API, TikTok Content Posting API | API limits documented `[PRIMARY]` | **NOT CONNECTED**, and deliberately so |
| R | Repurpose loop (1 long -> 5-15 shorts) | Opus Clip, Klap, Descript, Vizard, manual | Clip counts documented `[PRIMARY]` | **PARTIAL**: reframe/caption/render TODAY, selection NOT CONNECTED |

Counting the verdicts: **4 stages VYREALM can do today**, **2 partially**, **5 it cannot** (three
of those by explicit design decision, two by absence). The repurpose loop is the one place where
VYREALM has most of the machinery and is missing the single hardest piece.

---

## 2. Stage-by-stage anatomy

### Stage 1. Idea capture

**What the creator actually does.** Ideas arrive continuously and unpredictably, so the working
pattern is a capture inbox rather than a scheduled activity: a note app, a Notion database, a
voice memo, a saved-post folder. Ideas are then triaged against past performance and against what
is currently working on the platform. Two categories of tooling serve this:

- *Own-channel signal.* YouTube ships this natively. The Inspiration tab "provides suggestions for
  video topics, titles, hooks, outlines" and analyses what the creator's own viewers watched in
  the trailing 28 days. `[SECONDARY]` https://support.google.com/youtube/answer/15575509
  Note the deprecation: reporting says YouTube began gradually retiring the Inspiration tab from
  August 2026 in favour of "Ask Studio". `UNVERIFIED` (search-result summary; I did not fetch a
  YouTube page stating the deprecation date).
- *Cross-channel signal.* Outlier-finding tools (vidIQ, 1of10 and similar) rank videos by
  views-to-subscriber ratio to surface formats that overperformed their channel size. `UNVERIFIED`
  as to any specific tool's method; the category is real but no vendor publishes its ranking maths.

**Time.** No citable figure found. Idea capture is diffuse by nature and no survey I located
measures it as a discrete block.

**Where the pain is.** The pain is not generating ideas; it is *selection under uncertainty*. The
creator has more ideas than production slots and no reliable ex-ante signal about which will work.
This is also the stage most contaminated by AI: 82.7% of surveyed creators report using AI for
brainstorming, the joint-highest use case alongside writing and editing content, and 89.2% say they
always review AI output before using it, with 0% saying they trust it without changes.
`[PRIMARY-SURVEY]` 550 creators surveyed April 2026,
https://kit.com/resources/blog/ai-creator-economy-report

**VYREALM verdict: HUMAN.** The product already declares this: `research_topic` returns
`RESEARCH_NOT_CONNECTED`, described as "No local research adapter is connected; fact verification
requires supplied source notes" (`runtime/automation-tools.mjs:53`). That is the correct call for a
local-first, no-network product. There is no offline corpus of what is currently working on TikTok,
and inventing one would be fabrication. The honest local contribution is *format* selection, not
*topic* selection, and `format-library.mjs` already provides 36 formats across 151 variants with an
`inferNiche(brief)` helper to narrow them.

---

### Stage 2. Packaging-first (title and thumbnail concept before production)

**What the creator actually does.** In the highest-performing tier of YouTube production, the title
and thumbnail are written *before* the video exists, and the video is then built to deliver on
them. The leaked MrBeast Productions handbook is the clearest published statement of this:
"The creative process for every video they produce starts with the title and thumbnail," and the
first minute of the video exists to demonstrate "that their expectations from the thumbnail will
be met." `[SECONDARY]` https://simonwillison.net/2024/Sep/15/how-to-succeed-in-mrbeast-production/
and https://www.tubefilter.com/2024/09/17/mrbeast-internal-production-guide-leaked-key-points/

The same document gives a rare published retention benchmark: losing 21 million of 60 million
viewers in the first minute is described as "a reasonably good result". `[SECONDARY]`, same source.
That is a 65% one-minute retention floor at MrBeast scale. Treat it as an order-of-magnitude
anchor, not a target: one channel, one genre, one leaked document, unverifiable against YouTube's
own data.

This stage is structurally important for VYREALM because it inverts the naive pipeline. A tool that
generates video first and packaging last is modelling the workflow backwards relative to how the
top of the market works.

**Time.** No citable figure found.

**Where the pain is.** Title-thumbnail concepting is judgement work with no local ground truth. It
is also where creators report the most iteration and the least satisfaction, though I found no
survey quantifying that. `UNVERIFIED`.

**VYREALM verdict: HUMAN, machine-assistable.** VYREALM has the right shape of assistance already:
`HOOK_PATTERNS` in `format-library.mjs:194` is 25 named structural openings, each with a `rule`
describing what must happen on screen and a `holdSeconds` minimum ('cold-question', 'end-first',
'impossible-image', 'myth-break', 'loop-seam', 'scale-shift', and 19 others). Combined with
`scripts/write-format-hooks.mjs` driving local Ollama qwen3:4b, the machine can propose hook
*copy* against a chosen structural pattern. It cannot choose which promise is worth making. Note
that `generate_hooks` in `automation-tools.mjs` is already correctly caveated as "an original
creative hypothesis, not a virality guarantee".

---

### Stage 3. Scripting

**What the creator actually does.** Practice splits sharply by genre. Talking-head, educational and
commentary formats are scripted word-for-word or beat-by-beat in a document. Vlog, gameplay and
reaction formats are largely unscripted and the "script" emerges in the edit. A widely cited
survey summary puts the split concretely: "Gamers and casual vloggers tend to fall at the lower end
and often do not do scripting or heavy editing," while "tech and history video creators report
taking much more scripting and research time." `UNVERIFIED-SNIPPET` (the underlying page,
https://medium.com/rizzle/how-long-does-it-take-to-create-a-youtube-video-266ae3496bf3, returned
HTTP 403 when fetched this session; the text above is from a search-engine summary only and its
methodology could not be inspected).

Dominant tools: Google Docs and Notion for the document; LLMs for drafting and restructuring
(82.7% of surveyed creators use AI for "writing/editing content", the joint-highest category
alongside brainstorming, `[PRIMARY-SURVEY]`
https://kit.com/resources/blog/ai-creator-economy-report); Descript for the increasingly common
inverted workflow where the creator records first and the transcript *becomes* the script.

**Time.** The only figures I found come from the same 403-blocked source: a range of 2 to 300 hours
for a whole video with an average around 7 hours for a 1-to-5 minute video, and a pre-production
band of 1 to 6 hours for a standard 6-to-12 minute video. `UNVERIFIED-SNIPPET`. I record them
because they are the only numbers in circulation, not because they are trustworthy. Sample size,
recruitment method and date are all unknown to me. Do not hard-code them.

**Where the pain is.** Two distinct pains, and conflating them is a common product error:

- *Blank-page pain* on the first draft. Largely solved by LLMs.
- *Compression pain* on the last draft, cutting a 900-word script to 140 words for a 45-second
  Short without losing the payoff. Not solved by LLMs, because the constraint is spoken duration
  and the model has no clock.

**VYREALM verdict: TODAY (partial).** The compression pain is exactly the one VYREALM's format
library is shaped for, because a format carries a duration and a beat structure rather than a word
count. `buildProductionPlan({formatId, platform, brief, shots, seed})` returns a beat-resolved plan,
and `retimeFormat(formatId, targetSeconds)` rescales it. `analyseBrief(brief)` and
`FAILURE_TRIGGERS` in `prompt-logic.mjs` already reject briefs the local models cannot render (the
lip-sync trigger at `prompt-logic.mjs:78` is a good example: it detects dialogue requests and
refuses rather than producing mouth-flapping garbage). Local hook copy via Ollama is proven in
`scripts/write-format-hooks.mjs`. What is *not* there: converting a supplied long script into timed
narration cues automatically. `write_script` is a save operation only, explicitly described as
"Save supplied script text or a disclosed deterministic draft."

---

### Stage 4. Shot listing

**What the creator actually does.** For scripted work, the script is broken into shots with camera
angle, movement, framing and order. StudioBinder's published process is the reference workflow:
import the script, use shot tagging to convert lines of action into shot rows, add visual
references, then "group your shots into camera or lighting setups" and reorder for shooting
efficiency. `[VENDOR]` https://www.studiobinder.com/blog/how-to-make-a-shot-list-software/

For short-form specifically, most creators do not build a formal shot list. They work from a mental
list or a numbered note. The shot list exists, it is just not written down. This matters: it means
"generate a shot list" is *not* automating a chore the creator recognises, it is introducing a
document they did not have. Positioning matters more than capability here.

**Time.** No citable figure found.

**Where the pain is.** Shot listing is not painful. It is skipped. The downstream pain is the
consequence of skipping it: arriving in the edit without the cutaway you need.

**VYREALM verdict: TODAY, and arguably VYREALM's strongest stage.** This is solved in the existing
modules, and solved better than the manual version:

- `FORMATS` (36 entries, `format-library.mjs:259`) each carry a `beats` array where every beat has
  a `shot` role name and a `route` of `'composite' | 'neural' | 'either'`. The route is the piece a
  human shot list does not have: it says whether the beat can be cut from existing footage in
  seconds or needs a generated shot costing minutes.
- `format-presets.mjs` supplies the vocabulary a shot list needs, with enforced minimum counts
  (`MINIMUM_COUNTS` at `:347`: 40 cameras, 8 ramps, 20 looks, 12 transitions, 8 lighting setups),
  validated by `validateAllPresets`.
- `assertRenderable(plan, shotLibrary)` and `assertSufficientFootage(plan, shotLibrary, ffprobe)`
  in `format-render.mjs` check the shot list against footage that actually exists, before any render
  starts. That is the "arrived in the edit without the cutaway" failure, caught at plan time.
- `lintPlan(plan)` warns against documented platform penalties and against the duration evidence in
  `DURATION_EVIDENCE`, without blocking.

---

### Stage 5. Filming or sourcing

**What the creator actually does.** Three sourcing routes, usually mixed within one video:

1. *Filmed.* Phone or mirrorless, natural or one-light setup, often a single continuous take for
   short-form. The dominant constraint is not equipment but setup and reset time.
2. *Sourced stock.* Free-tier libraries dominate at the low end. Pexels' license permits free
   personal and commercial use with no attribution required, permits modification, and prohibits
   selling unaltered copies and redistributing to other stock platforms.
   `[VENDOR-PRIMARY]` https://www.pexels.com/license/ and
   https://help.pexels.com/hc/en-us/articles/360042295174
3. *Screen capture and existing assets.* For software, tutorial and commentary content this is the
   majority of the frame.

**Time.** No citable figure found for filming or sourcing as a discrete block.

**Where the pain is.** For filmed content: reshoots. For sourced content: search. Finding the one
usable stock clip out of forty near-misses is a slow, low-value, high-frequency task, and it is the
task most vulnerable to being replaced by generation.

**VYREALM verdict: split.**

- **TODAY for generated footage,** with real measured cost. From `runtime/production-scheduler.mjs`,
  `MEASURED_NEURAL_RUNS` and `MEASURED_COMPOSITE`, `[MEASURED-LOCAL]` on this box:
  - LTX 2B distilled q8: 97 frames at 768x512 in 196 s, approximately 2.0 s/frame, 8 steps,
    cfg 1.0, fits entirely in 6 GB VRAM.
  - Wan2.2 TI2V 5B Q4_K_M: 121 frames at 1024x576 in 1568 s, approximately 13.0 s/frame, peak
    5.85 GiB VRAM. The module's own comment flags this figure as optimistic and cites three logged
    runs of the same anchor at 1838.020 / 1716.804 / 1413.336 s (mean 1656.05 s), advising a
    `safetyFactor > 1` for any budget that must not overrun.
  - Composite FFmpeg render of a 15 s 1080x1920 cut: approximately 11 s, CPU only.

  The ratio is the product argument. A composite beat costs 11 seconds. A neural beat costs 3 to 30
  minutes. `beat.route` exists precisely to keep that decision explicit rather than accidental.
- **HUMAN for filmed footage.** Nothing in the repo touches a camera, and nothing should.
- **Gap: no stock-library search.** `format-sourcing.mjs` is about *extending* footage you already
  have (`planSourceExtension`, `EXTENSION_STRATEGIES` = `none | slow | pingpong | loop | refuse`),
  not about finding footage you do not have. `refuse` as a first-class strategy is the right design:
  when there is not enough footage, the honest answer is to say so, and `extensionProvenance`
  records what was done to the source.

---

### Stage 6. Editing

**What the creator actually does.** Assemble, trim, pace, add b-roll, sound design, colour, export.
For short-form the dominant tool is unambiguous: CapCut. Aggregated figures put CapCut at roughly
37% of global mobile video-editor downloads in 2024, ahead of InShot at 14% and Premiere Rush at 9%,
and at 509.2 million downloads in 2025 as the most-downloaded Photo & Video app worldwide.
`UNVERIFIED` (aggregator restatements of Statista and Sensor Tower figures; I did not reach a
primary source, and the MAU claims in circulation range from 300 million to 800 million, a spread
wide enough to distrust all of them). Treat "CapCut dominates mobile short-form editing" as solid
and every specific number as unreliable.

For long-form and desktop: Premiere Pro, DaVinci Resolve, Final Cut Pro, and Descript for
transcript-driven cutting. Descript's model is edit-the-text-edit-the-video, with one-click removal
of filler words ("um", "uh", "like", "you know", "so", "actually") and Studio Sound for audio
cleanup. `[VENDOR]` https://www.descript.com/tools/remove-filler-from-video

**Time.** The only figures in circulation come from the 403-blocked source: post-production
"20-100+ hours" for a standard 6-to-12 minute video, and the claim that experienced creators cut
editing time "2x-5x" through templates, shortcuts, presets and batching. `UNVERIFIED-SNIPPET`. The
20-100 hour figure is implausible for the median creator and almost certainly reflects
high-production-value channels; I record it and distrust it.

The more defensible framing, and the one this project should use, is the *template multiplier*
rather than an absolute: the reported gain comes from templates, presets and batch workflows. That
is a structural claim about where savings live, and it is the claim VYREALM's format library is a
direct implementation of.

**Where the pain is.** Editing is the acknowledged bottleneck of the whole pipeline. The strongest
supporting evidence I could verify is indirect: 25% of surveyed creators report using AI for
editing, and 46.9% for repurposing content. `[PRIMARY-SURVEY]`
https://kit.com/resources/blog/ai-creator-economy-report

The pain decomposes into two very different halves, and every honest automation claim depends on
separating them:

- *Mechanical editing.* Conforming to aspect ratio, applying a look, timing cuts to a beat grid,
  normalising loudness, burning captions, exporting per platform. Fully specifiable. Fully
  automatable.
- *Judgement editing.* Deciding which take is better, where the joke lands, when to hold on a
  reaction, what to cut entirely. Not specifiable, and a tool that claims to do it is lying.

**VYREALM verdict: TODAY for mechanical, HUMAN for judgement.** `renderPlan` in `format-render.mjs`
executes the mechanical half end to end: `beatFilter({move, grade, width, height, fps,
durationSeconds, extensionFilter})` composes the per-beat FFmpeg filter chain, `planBeatSources`
resolves each beat to real footage with duration probing, captions come from `format-captions.mjs`,
audio from `format-audio.mjs`. Measured cost is approximately 11 s for a 15 s vertical cut
`[MEASURED-LOCAL]`. Nothing in the repository attempts judgement editing, and `quality-gate.mjs` is
careful about the distinction: `run_quality_check` is described as running "technical
FFprobe/FFmpeg checks; it does not score realism."

---

### Stage 7. Captioning

**What the creator actually does.** Burned-in captions are effectively mandatory for short-form. The
load-bearing consumer research is the Verizon Media / Publicis Media study, reported as finding that
92% of consumers view video with sound off on mobile, 83% watch with sound off generally, 69% watch
with sound off in public, 80% of caption users have no hearing impairment, and 80% of consumers are
more likely to watch an entire video when captions are available. `[SECONDARY]`
https://www.forbes.com/sites/tjmccue/2019/07/31/verizon-media-says-69-percent-of-consumers-watching-video-with-sound-off/
and https://www.3playmedia.com/blog/verizon-media-and-publicis-media-find-viewers-want-captions/
Caveat clearly: this is a 2019 survey, self-reported, commissioned by parties with an interest in
the answer, and the 92% / 83% figures are reported inconsistently across secondary outlets. The
direction is certainly right; the decimals are not.

Tooling splits three ways:

- *In-editor auto-captions.* CapCut generates captions server-side and requires an internet
  connection; free-tier users are limited to five auto-caption generations per month. `UNVERIFIED`
  (consistent across several third-party guides; I did not reach CapCut's own help-centre page).
- *Dedicated caption tools.* Submagic and similar sell word-by-word animated highlighting, timed per
  word to the voice, with template libraries. `[VENDOR]` https://www.submagic.co/ai-caption
- *Platform auto-captions.* TikTok's auto-captions transcribe speech automatically and creators can
  edit them; the feature launched for American English and Japanese. `[SECONDARY]`
  https://newsroom.tiktok.com/en-us/introducing-auto-captions

The claim that word-by-word animated captions outperform static ones on completion rate is
`[VENDOR]` and `UNVERIFIED`. It is a plausible hypothesis and a good thing to A/B test. It is not a
fact, and it should not be hard-coded as the only caption style.

**Time.** No citable figure found.

**Where the pain is.** Not generation, but *correction*. Auto-captions reliably fail on proper
nouns, technical terms, product names and fast speech, and every one of those errors is visible on
screen for the whole clip. The second pain is layout: captions must sit inside the platform's UI
safe area or they are covered by the like button and the caption text.

**VYREALM verdict: TODAY, with an honest review gate.** This is the second-strongest stage.

- `runtime/format-captions.mjs` provides `buildCueList({text, durationSeconds, style})`,
  `buildCaptionFilter({cues, style, canvas, safeArea, fontFile})`, `escapeDrawtext` and
  `captionEvidence({cues, style})`. Five styles in `CAPTION_STYLES`: `karaoke-bold` (3 words per
  cue, weight 800, lower third, highlight on), `single-line-center` (5), `top-statement` (6),
  `minimal-lower` (7), and `none`. The `highlight: true` flag on `karaoke-bold` is the word-by-word
  treatment the vendor market sells.
- Safe areas are real data, not guesses, and are honestly tiered in `PLATFORM_SPECS`. Instagram
  Reels carries `safeArea {top: 269, bottom: 672, left: 65, right: 65}` at
  `safeAreaConfidence: 'published-for-ads'` citing Meta's own ads guide, plus a separate
  `safeAreaOrganic {top: 269, bottom: 340, left: 65, right: 160}` at `'community-measured'`. TikTok
  carries an explicit note: "TikTok publishes no pixel safe zone. Verify against their template
  files before delivery." That is the right posture. Third-party guides converge on the same Reels
  numbers (top 269 px / 14%, bottom 672 px / 35%, 65 px sides), which corroborates the stored
  values. `[SECONDARY]` https://www.outfy.com/blog/instagram-safe-zone/
- Speech recognition exists and is local: `workers/audio-local.py:53-55` runs `faster_whisper`
  `WhisperModel` on CPU, `int8`, `local_files_only=True`, `word_timestamps=True`, `beam_size=3`.
  `provider-catalogue.mjs:167` registers `whisper-tiny-en` sourced from
  https://huggingface.co/Systran/faster-whisper-tiny.en
- Critically, the transcription result returns `status: 'review_required'` with the diagnostic
  `TRANSCRIPT_REVIEW_REQUIRED`: "Local speech recognition completed. Review words, names and timing;
  diarization is not enabled." That is the correction pain, surfaced rather than hidden. `tiny.en`
  is the smallest Whisper model and will mis-transcribe proper nouns; forcing review is correct and
  should not be softened.

---

### Stage 8. Thumbnail production

**What the creator actually does.** Shoot or extract a base frame, cut out the subject, composite
onto a background, add two to four words of text at very large size, push saturation and contrast so
it survives being displayed small on mobile. Photoshop dominates at the professional tier, Canva and
Figma at the accessible tier, Photopea for the free-and-browser tier.

For Shorts and Reels this stage largely does not exist, since the platform derives the cover from a
frame. It is a long-form YouTube stage, which matters for scoping: a short-form-first tool can
legitimately defer it.

**Time.** No citable figure found.

**Where the pain is.** Iteration count with no feedback signal until publish, followed by Stage 9
giving a signal up to two weeks later.

**VYREALM verdict: NOT CONNECTED.** `create_thumbnail` returns `THUMBNAIL_NOT_CONNECTED`: "No
thumbnail generation worker is connected" (`runtime/automation-tools.mjs:53`). Nothing in the
repository produces a still image for packaging. This is a genuine gap rather than a design
decision, and it is a cheap one to close for the *mechanical* part: extracting a candidate frame
from a rendered plan and compositing text inside a safe area is FFmpeg work that
`format-captions.mjs`'s `buildCaptionFilter` already substantially covers. The *judgement* part,
which frame and which two words, stays human.

---

### Stage 9. Packaging finalisation and A/B testing

**What the creator actually does.** Write the final title, upload up to three thumbnail or title
variants, let the platform decide.

This is the best-documented stage in the whole workflow because YouTube publishes the mechanics.
All `[PRIMARY]`, https://support.google.com/youtube/answer/16391400:

- "Creators can test and compare up to 3 different titles and thumbnails."
- Results are decided "based on watch time share", not click-through rate.
- "Your A/B test can take a few days or up to 2 weeks to complete."
- Three verdicts: Winner, Performed Same, Inconclusive.
- "Desktop only: This feature is currently only available on computers through YouTube Studio."
- "You need to enable advanced features to be eligible."
- "You cannot use this feature on videos that are made for kids, mature audiences, or are private."
- "You are not able to A/B test Shorts, Scheduled Lives, and Premiere videos at this time."

The watch-time-share basis is the single most important packaging fact for a generator to encode,
and it is already recorded as fact `M1` in `VIRAL_YOUTUBE_FORMATS_2026-09-07.md`. It means a
thumbnail that wins clicks and loses viewers loses the test. Optimising for clickability alone is
optimising against the mechanism.

**Time.** A few days to two weeks per test, platform-side. `[PRIMARY]`, above.

**Where the pain is.** Latency and exclusion. Two weeks per iteration, and Shorts are excluded
entirely, so short-form creators get no A/B mechanism at all.

**VYREALM verdict: HUMAN.** This runs inside YouTube Studio and cannot be done locally. The useful
local contribution is generating the three variants to test, which folds back into Stage 8.

---

### Stage 10. Scheduling

**What the creator actually does.** Either schedule natively per platform, or use a cross-platform
scheduler (Buffer, Later, Metricool, Hootsuite) to queue one asset to several destinations.

Native YouTube scheduling: set date, time and time zone on the Schedule card at upload. Two
documented gotchas a scheduler must handle: watch-page dates are rendered in Pacific Standard Time,
and "If your account has a Community Guidelines strike, your scheduled video won't publish during
the penalty period." `[SECONDARY]` https://support.google.com/youtube/answer/1270709
Via API, scheduling is `status.publishAt` with `status.privacyStatus` set to private; the API docs
list `invalidPublishAt` as an error for "The request metadata specifies an invalid scheduled
publishing time." `[PRIMARY]` https://developers.google.com/youtube/v3/docs/videos/insert

**Time.** No citable figure found.

**Where the pain is.** Per-platform divergence. The same asset needs a different aspect ratio,
different caption text, different hashtag conventions and a different length ceiling per
destination, so "schedule everywhere" is really "produce four variants, then schedule".

**VYREALM verdict: NOT CONNECTED, and correctly so for now.** `schedule_campaign` returns
`SCHEDULER_NOT_CONNECTED`: "Scheduling requires an explicit publishing adapter and authorization"
(`runtime/automation-tools.mjs:53`). Also `create_platform_variants` returns
`VARIANT_QUEUE_NOT_CONNECTED`: "Render each explicit canvas revision; automatic multi-aspect export
is not connected."

That second one is the more interesting gap, because the *data* for it already exists.
`PLATFORM_SPECS` holds canvas, fps range, container, codecs, sample rate, file-size ceiling, min and
max seconds and safe area for all five destinations, and `expandVariants({brief, niches, platforms,
shots, limit, seed, includeEvidenceRetimes})` already fans a brief across them. What is missing is
the render-and-queue side, not the plan side. This is the highest-leverage unbuilt feature in the
document: the modules are most of the way there.

One deliberate guard deserves calling out: `assertNotBulkPublishable(variants)` at
`format-library.mjs:777`. The product already refuses to hand back a bulk-publishable pile of
near-identical variants. Given Stage 11's policy findings, that is not squeamishness, it is
liability management.

---

### Stage 11. Publishing

**What the creator actually does.** Most creators upload natively. Programmatic publishing exists
and is well documented, and every platform gates it.

`[PRIMARY]` **YouTube Data API `videos.insert`**,
https://developers.google.com/youtube/v3/docs/videos/insert

- "A call to this method has a quota cost of 1 unit in the Video Uploads quota bucket."
- "100 calls per day."
- "Maximum file size: 256GB", accepted media types `video/*, application/octet-stream`.
- (Reporting that the cost was cut from roughly 1,600 units on 2025-12-04 and moved to its own
  bucket on 2026-06-01 is `UNVERIFIED`; the current doc simply states the present numbers.)

`[PRIMARY]` **Instagram Platform content publishing**,
https://developers.facebook.com/docs/instagram-platform/content-publishing/

- "Instagram accounts are limited to 100 API-published posts within a 24-hour moving period."
- Two-step: POST to `/<IG_ID>/media` to create a container, then POST to `/<IG_ID>/media_publish`.
- Reels require `media_type=REELS`.
- Poll `GET /<IG_CONTAINER_ID>?fields=status_code` for
  `EXPIRED | ERROR | FINISHED | IN_PROGRESS | PUBLISHED`; the docs recommend checking "once per
  minute, for no more than 5 minutes."
- Media "must be hosted on a publicly accessible server at the time of the attempt". That single
  sentence is a hard architectural conflict with a local-first, no-network product.

`[PRIMARY]` **TikTok Content Posting API, Direct Post**,
https://developers.tiktok.com/docs/en/content-posting-api-get-started

- Requires "approval and authorization of the `video.publish` scope."
- "All content posted by unaudited clients will be restricted to private viewing mode." Lifting it
  requires an audit "to verify compliance with our Terms of Service."
- "To initiate a direct post to a creator's account, you must first use the Query Creator Info
  endpoint to get the target creator's latest information."
- (The circulating "roughly 15 posts per day per creator" limit is `UNVERIFIED`; it is not in the
  get-started page I fetched.)

**The policy constraint that actually governs this stage.** YouTube renamed its "repetitious
content" policy to "inauthentic content" on 2025-07-15. Monetised content must "Be your original
creation" and "Not be mass-produced, generic, repetitive, or manipulative." Explicitly
non-monetisable examples include "Similar or repetitive content with low educational value,
commentary, narratives, or minimal variation across videos"; "Videos where characters are put in the
same situation over and over again with the same outcome"; "Image slideshows, templated storylines,
or scrolling text with minimal or no narrative, commentary, or educational value"; and "AI-generated
content made with generic or unoriginal templates giving the impression of mass production". YouTube
also states "There is no change to our reused content policy which reviews content like commentary,
clips, compilations, and reaction videos." `[PRIMARY]`
https://support.google.com/youtube/answer/1311392

Read that against a 151-variant format library and the risk is obvious: the failure mode of a
template engine is producing exactly the thing this policy demonetises. `assertNotBulkPublishable`
and `lintPlan`'s `previously-posted` / `unoriginal-reupload` / `reused-unmodified-content` penalty
entries in `PLATFORM_SPECS` are the mitigations, and they should be treated as product-critical
rather than as nice-to-have linting.

**Time.** No citable figure found.

**VYREALM verdict: NOT CONNECTED, and the conflict is real.** Publishing requires network, OAuth,
and in Instagram's case a publicly reachable media URL. All three contradict the stated local-first,
no-network-in-shipped-UI constraint. The defensible position is: VYREALM renders platform-conformant
files and hands them to the creator, who uploads them. Any publishing adapter should be an
explicitly opt-in, out-of-band component, which is exactly what `SCHEDULER_NOT_CONNECTED` already
says.

---

## 3. The repurpose anatomy: one long video into 5 to 15 shorts

This is the highest-volume workflow in short-form and the one with the clearest published mechanics,
because a whole tool category sells it.

### 3.1 How many clips actually come out

`[PRIMARY-VENDOR]` OpusClip publishes a clip-count table by source duration.
https://help.opus.pro/docs/article/how-many-clips
"The number of clips that Opus creates is dependent on the video length that you process, and the
model you use."

| Source length | Clips produced |
|---|---|
| 0-3 min | 1-2 |
| 3-10 min | 3-14 |
| 10-30 min | 5-21 |
| 30-60 min | 23-32 |
| 60-120 min | 32-42 |
| Over 120 min | 42-55 |

"ClipAnything usually yields slightly more clips than ClipBasic."

The brief's premise of "5-15 shorts from one long video" lands squarely in the 10-to-30-minute row,
which is the modal YouTube long-form length. That is the right target band.

The yield number matters more than the count. One vendor-adjacent review reports that roughly 60-80%
of generated clips are usable with minor edits, and 20-40% "miss the punchline, cut mid-sentence, or
start mid-thought". `[VENDOR]` `UNVERIFIED`
https://bigvu.tv/blog/opus-clip-tested-2026-where-ai-wins-40-percent-discard/
Treat the exact split as marketing. Treat the existence of a substantial discard rate as certain:
every published account of these tools describes a human review pass, and none claims otherwise.

### 3.2 Clip selection criteria

Selection is the whole game. The most consistent claim across the practitioner literature is the
effort split: roughly 80% of the work is curation and 20% is editing. `[VENDOR]` `UNVERIFIED`
https://www.opus.pro/blog/how-to-make-short-videos-from-youtube-long-videos

The criteria that recur across every source I read, stated as a checklist:

1. **Standalone comprehension.** The segment must make sense with zero knowledge of the source
   video. "If the moment doesn't stand on its own, no crop, caption preset, or export setting will
   save it." `[VENDOR]` same source. This is the dominant criterion and the dominant failure.
2. **Contained arc.** Setup, turn and payoff inside the clip. A clip that starts mid-argument or
   ends before the conclusion fails even if the middle is excellent.
3. **Hook within the first seconds.** Practitioner consensus is a hook inside the first 3 seconds,
   with the opening made "obvious within the first second". `[VENDOR]` `UNVERIFIED` as to the exact
   number; the 3-second figure is practitioner convention, not a platform-published threshold.
4. **Built-in tension.** A question posed, a disagreement, a claim that invites objection, or a
   visible transformation beginning.
5. **Clean speech boundaries.** No clipped first word, no trailing half-sentence. This is the single
   most common mechanical defect in auto-generated clips, and it is fully detectable from word-level
   timestamps.
6. **Trend or query alignment.** OpusClip's Virality Score explicitly includes "Trend: whether the
   video is aligned with current trends and audience interests". `[PRIMARY-VENDOR]`
   https://help.opus.pro/docs/article/virality-score

**What the vendor scoring actually measures.** OpusClip's Virality Score runs 0 to 99 and evaluates
four named dimensions: **Hook** (does the introduction capture attention and connect to the core
subject), **Flow** (does the content progress logically with satisfying closure), **Value**
(usefulness, emotional resonance, audience connection), and **Trend** (alignment with current trends
and viewer interests). It is gated to paid plans. `[PRIMARY-VENDOR]`, same URL.

Note what those four are: two of them (Hook, Flow) are structural and computable from a transcript
with timestamps. Two of them (Value, Trend) are not computable offline at all. **That split is the
exact boundary of what VYREALM could ever do locally.** A local clip selector can score Hook and
Flow honestly. It cannot score Trend, because Trend requires the network. Claiming otherwise would
be fabrication, and a locally computed "virality score" that silently drops half its inputs would be
a worse lie than not having one at all.

### 3.3 Hook re-cutting

A clip lifted verbatim from the middle of a long video almost never opens correctly, because the
long-form opening of that segment was written assuming the previous nine minutes. The re-cut
operations, in the order practitioners describe them:

1. **Cut the setup, keep the payoff.** "Pick one segment, cut away the setup, keep the payoff
   intact, and make the opening obvious within the first second." `[VENDOR]` `UNVERIFIED`
   https://www.opus.pro/blog/how-to-make-short-videos-from-youtube-long-videos
2. **Reorder to lead with the strongest line.** Frequently the best opening line sits 20 seconds
   into the segment. Moving it to position zero is the highest-value single edit in the whole
   repurpose workflow.
3. **Add an external hook.** A text card, an on-screen question, or a re-recorded line supplying the
   context the long-form video established elsewhere. This is the operation that fixes the
   standalone-comprehension failure without discarding the clip.
4. **Cold open.** Remove greetings, throat-clearing, "so as I was saying", and every filler word.
   This is Descript's core competence and it is transcript-driven. `[VENDOR]`
   https://www.descript.com/tools/remove-filler-from-video

Mapped onto VYREALM's existing vocabulary, `HOOK_PATTERNS` already contains the exact re-cut
patterns this stage needs: `end-first` ("Show the final result in the opening frame, then rewind to
the beginning"), `in-medias-res` ("Drop into the highest-tension moment with no setup"),
`cold-question`, `number-claim`, `quote-open`, and `loop-seam`. That is not a coincidence of naming;
those are the same operations under different labels.

### 3.4 Aspect reframing (16:9 to 9:16)

Three implementations, three different quality and cost profiles.

- **Premiere Pro Auto Reframe.** Adobe's AI reframing analyses each frame, detects the primary
  subject or motion, and generates position keyframes to keep the action in frame when the sequence
  changes aspect ratio; the target resolution can be set in the Auto Reframe dialog. `[SECONDARY]`
  Adobe's own help page
  (https://helpx.adobe.com/premiere/desktop/add-video-effects/commonly-used-effects/auto-reframe-overview.html)
  timed out twice when fetched this session, so this description comes from search-result summaries
  and third-party guides. `UNVERIFIED` as to the exact preset names ("slower / default / faster
  motion"), which I could not confirm from Adobe directly.
- **DaVinci Resolve Smart Reframe.** Studio-only. Lives in the Inspector under Transform. The
  "Object of Interest" dropdown defaults to Auto; where Auto misframes, the operator can switch to
  "Reference Point" and click a target to nominate the subject manually. It detects and tracks
  people, animals, objects and fast-moving elements. `[SECONDARY]` I could not reach the official
  Blackmagic manual page (404 on the mirror I tried); this is from converging third-party
  descriptions. `UNVERIFIED`.
- **Fixed-crop or split-screen.** No tracking at all: centre-crop, or stack the 16:9 frame in the
  upper third with captions below. Ugly but deterministic, and for talking-head content where the
  speaker is already centred, frequently indistinguishable from tracked reframing.

**The failure mode that matters.** Auto-reframing crops on *subject*, not on *information*. Any
on-screen text, lower third, chart, code, or UI that lived in the outer thirds of the 16:9 frame is
silently destroyed. For talking-head content, auto-reframe is close to free. For screen-share,
tutorial, data or design content it is actively destructive, and the correct answer is to letterbox
rather than crop.

**VYREALM position.** There is no reframing module. `beatFilter` in `format-render.mjs` composes
scale and move filters against a target canvas, so fixed-crop and letterbox reframing are already
reachable; subject-tracked reframing is not, and would need a detector this repo does not have.
`PLATFORM_SPECS` already carries every target canvas and safe area needed to drive it.

### 3.5 Caption styles for clipped shorts

Settled practice, with the honest caveat that the performance claims are all vendor-side:

- **Word-by-word or small-group highlighting**, timed to the voice, is the default treatment sold by
  the entire caption-tool category. `[VENDOR]` https://www.submagic.co/ai-caption
- **Three to five words visible at once.** VYREALM's `CAPTION_STYLES` encodes this directly:
  `karaoke-bold` at `wordsPerCue: 3`, `single-line-center` at 5, `top-statement` at 6,
  `minimal-lower` at 7.
- **Heavy weight, high contrast, stroke or shadow**, because the caption competes with an arbitrary
  background. `karaoke-bold` uses `weight: 800`.
- **Positioned inside the safe area.** For Reels the practical working area is roughly the central
  950x979 px of a 1080x1920 frame once UI overlays are excluded. `[SECONDARY]`
  https://www.outfy.com/blog/instagram-safe-zone/
- **Every proper noun manually verified.** Non-negotiable, and the reason `TRANSCRIPT_REVIEW_REQUIRED`
  exists.

### 3.6 What makes a clipped short work, and what makes it fail

**Works:**

1. Comprehensible with zero prior context.
2. Complete arc inside the clip: a question is asked and answered, or a claim is made and shown.
3. Opens on the strongest moment, not the chronologically first one.
4. Speech starts and ends on clean word boundaries.
5. Reframed so that the information, not just the face, survives the crop.
6. Captioned, inside the safe area, with names spelled correctly.
7. Duration inside the platform's evidenced band rather than the platform's maximum.

**Fails:**

1. **Missing context.** The clip references something established earlier in the long video. This is
   the number one failure and it is a *selection* failure, unfixable downstream.
2. **Mid-sentence start or end.** A mechanical defect, and a fully detectable one.
3. **No hook, because long-form pacing was inherited.** The segment's natural opening was written
   for an audience already nine minutes invested.
4. **Cropped-away information.** Auto-reframe removed the chart, the code, or the lower third.
5. **Caption occlusion.** Text placed under the platform's own UI.
6. **Volume without variation.** Fifty near-identical clips from one source, which is precisely what
   YouTube's inauthentic-content policy names: "similar or repetitive content with... minimal
   variation across videos". `[PRIMARY]` https://support.google.com/youtube/answer/1311392
   This is a monetisation risk, not merely an aesthetic one.
7. **Wrong duration for the platform.** `DURATION_EVIDENCE` in `format-library.mjs:687` records the
   measured bands and their confidence: Instagram Reels best at 45-60 s with the 1-30 s band weakest
   for both views and engagement (approximately 6M Reels, Jan-Jun 2026,
   https://www.socialinsider.io/blog/instagram-reels-length/); TikTok views peaking at 120-180 s
   while engagement peaks at 15-30 s and the 0-15 s band had the lowest median views (approximately
   6M videos, https://www.socialinsider.io/blog/how-long-are-tiktok-videos/); YouTube Shorts
   converging on 34-43 s across secondary analyses. All three are labelled `secondary-correlational`
   or `secondary-weak` in the code, which is the correct confidence level.

**One platform-native shortcut worth knowing.** YouTube ships a first-party repurpose path: from the
watch page of your own uploaded video, "Remix > Edit into a Short" lets you select up to 60 seconds.
Constraints, all `[PRIMARY]` from https://support.google.com/youtube/answer/12836917:
"You can only edit long-form public videos you've uploaded into Shorts. Private and unlisted videos
and videos with third-party copyright claims cannot be used with this feature." The source video
must be opted into sampling ("Allow people to sample this content"). "You cannot use music or other
sounds from our Audio Library on Shorts you create from your videos." And usefully, "Shorts you
create from your videos are linked back to your original video."

That last property is a real distribution advantage no third-party clipping tool can replicate, and
it is worth surfacing to any user whose source video is already on YouTube.

---

## 4. Consolidated automation map

### 4.1 VYREALM can automate TODAY

| Stage | Module and entry point | Evidence |
|---|---|---|
| Shot listing | `format-library.mjs` `buildProductionPlan`, `FORMATS` (36), `beat.route` | Read at `:259`, `:535` |
| Plan linting against platform rules | `format-library.mjs` `lintPlan`, `PLATFORM_SPECS`, `DURATION_EVIDENCE` | `:723`, `:34`, `:687` |
| Footage sufficiency check before render | `format-render.mjs` `assertRenderable`, `assertSufficientFootage` | `:112`, `:144` |
| Mechanical editing and render | `format-render.mjs` `renderPlan`, `beatFilter`, `planBeatSources` | 15 s vertical cut in approximately 11 s `[MEASURED-LOCAL]` |
| Source extension when footage is short | `format-sourcing.mjs` `planSourceExtension`, `buildExtensionFilter`, `extensionProvenance` | `refuse` is a first-class strategy |
| Caption cueing, styling, safe-area placement | `format-captions.mjs` `buildCueList`, `buildCaptionFilter`, `captionEvidence` | 5 styles, per-platform safe areas |
| Transcription with word timestamps | `workers/audio-local.py` faster-whisper `tiny.en`, CPU int8 | `word_timestamps=True`, returns `review_required` |
| Audio bed, ducking, loudness targeting | `format-audio.mjs`, `AUDIO_BEDS` (5 beds, `duckDb`, `targetLufs`) | `format-library.mjs:236` |
| Look, camera, transition, lighting vocabulary | `format-presets.mjs` `resolvePreset`, `validateAllPresets` | Minimums enforced at `:347` |
| Measured quality scoring, accept/repair/reject | `quality-detectors.mjs` `probeVideo`/`scoreVideo`, `quality-gate.mjs` `decideAction`/`planShotRepair` | Explicitly "does not score realism" |
| Neural shot generation with real cost models | `production-scheduler.mjs` `MEASURED_NEURAL_RUNS`, `estimateSchedule`, `createScheduler` | LTX approximately 2.0 s/frame, Wan2.2 approximately 13.0 s/frame `[MEASURED-LOCAL]` |
| Prompt construction, refusal of impossible briefs | `prompt-logic.mjs` `buildWanPrompt`, `analyseBrief`, `FAILURE_TRIGGERS` | Lip-sync refusal at `:78` |
| Hook copy drafting against a chosen pattern | `scripts/write-format-hooks.mjs` + local Ollama qwen3:4b, `HOOK_PATTERNS` (25) | Already produced `runtime/assets/format-hooks.json` |

### 4.2 VYREALM could automate WITH WORK

Ordered by leverage per unit of effort.

1. **Multi-platform variant rendering.** Currently `VARIANT_QUEUE_NOT_CONNECTED`. All the data
   exists (`PLATFORM_SPECS` for 5 destinations, `expandVariants` to fan out, `retimeFormat` to
   rescale, `renderPlan` to execute). What is missing is the queue that walks the variant list and
   calls `renderPlan` per canvas. Highest leverage in the document.
2. **Clip selection from a transcript (the repurpose core).** Currently
   `PODCAST_SELECTION_NOT_CONNECTED`. Word-level timestamps already exist from faster-whisper. Two
   of OpusClip's four scoring dimensions (Hook, Flow) are computable offline from a transcript;
   Value and Trend are not. Ship the two that are honest, score them as what they are, and refuse to
   call the result a virality score.
3. **Clean-boundary trimming.** Given word timestamps, detecting and refusing a clip that starts or
   ends mid-sentence is close to free, and it eliminates failure mode #2 in section 3.6 entirely.
4. **Fixed-crop and letterbox reframing.** `beatFilter` already composes scale and position filters
   against a target canvas. Subject-tracked reframing needs a detector the repo does not have, but
   the deterministic modes are reachable now, and for information-dense sources letterboxing is the
   *correct* answer rather than the fallback.
5. **Thumbnail compositing.** Currently `THUMBNAIL_NOT_CONNECTED`. Frame extraction plus safe-area
   text compositing is FFmpeg work that `buildCaptionFilter` already substantially covers.
6. **Filler-word removal.** faster-whisper is running with `word_timestamps=True`; excising a known
   filler-word list and re-cutting is a solvable transcript-to-cutlist problem.

### 4.3 Genuinely needs a human

| Stage | Why it cannot be automated locally |
|---|---|
| Topic selection | Requires knowing what is working now. No network, no signal. Product already returns `RESEARCH_NOT_CONNECTED`. |
| The promise (title + thumbnail concept) | Judgement about what an audience wants. No local ground truth. |
| Filming | No camera in scope, and correctly so. |
| Judgement editing | Which take, where the joke lands, when to hold. `run_quality_check` is explicitly technical only: "it does not score realism". |
| Transcript correction | `tiny.en` will get proper nouns wrong; `TRANSCRIPT_REVIEW_REQUIRED` forces the check rather than hiding it. |
| Trend alignment | The `Trend` dimension of any virality score is network-dependent by definition. |
| A/B testing | Runs inside YouTube Studio, watch-time-share basis, up to two weeks of latency. |
| Publishing authorisation | OAuth, per-platform audit (TikTok), and Instagram's publicly-reachable-media-URL requirement all conflict with local-first. |
| Originality judgement | YouTube's inauthentic-content policy turns "did the machine add anything" into a monetisation question. A machine cannot certify its own originality. |

---

## 5. What this changes about VYREALM's positioning

Three findings that bear on product decisions.

1. **The workflow is packaging-first at the top of the market, and VYREALM is render-first.** The
   MrBeast handbook's "starts with the title and thumbnail" is the opposite ordering from a pipeline
   that renders video and packages it afterward. The cheapest correction is not to build a thumbnail
   generator but to make the *format choice* carry the promise, which `HOOK_PATTERNS` already half
   does.

2. **Selection, not rendering, is the scarce skill in the repurpose loop.** The practitioner split
   is roughly 80% curation, 20% editing. VYREALM has excellent editing machinery and no curation
   machinery, and the repository already admits it with `PODCAST_SELECTION_NOT_CONNECTED`. Two of
   the four vendor scoring dimensions are computable offline. Building those two honestly is more
   valuable than building a fake version of all four.

3. **The template engine's success case and the platform's demonetisation case are the same
   artefact.** "AI-generated content made with generic or unoriginal templates giving the impression
   of mass production" is a verbatim description of what a 151-variant library produces if used
   carelessly. `assertNotBulkPublishable` is therefore not a UX nicety. It is the feature that keeps
   users monetised, and it deserves to be documented to the user as such rather than sitting
   silently in a lint pass.

---

## 6. Open gaps and unverified claims

Recorded so the next pass does not re-derive them.

| Claim | Status | What would close it |
|---|---|---|
| Per-stage hours for any creator workflow | `UNVERIFIED-SNIPPET`; the only source (Medium/Rizzle) returns HTTP 403 | A survey with published methodology. I could not find one. This is the biggest evidential hole in the document. |
| Post-production "20-100+ hours" for a 6-12 min video | `UNVERIFIED-SNIPPET`, implausible for the median | Same |
| "Templates cut editing time 2x-5x" | `UNVERIFIED-SNIPPET` | Same |
| Creators work 36.5 h/week, 46% spent creating | `UNVERIFIED`; appeared in a search summary without a traceable primary | Locate the originating report |
| CapCut MAU (300M vs 800M in circulation) | `UNVERIFIED`, spread too wide to use | ByteDance or Sensor Tower primary |
| CapCut free tier limited to 5 auto-caption runs/month | `UNVERIFIED` | CapCut help-centre page |
| Premiere Auto Reframe preset names and limitations | `UNVERIFIED`; helpx.adobe.com timed out twice | Retry the Adobe help page |
| DaVinci Smart Reframe official manual text | `UNVERIFIED`; mirror returned 404 | Blackmagic's own PDF manual |
| TikTok approximately 15 Direct Posts/day/creator | `UNVERIFIED`; not in the get-started page | TikTok rate-limit reference page |
| YouTube quota change dates (2025-12-04, 2026-06-01) | `UNVERIFIED` | YouTube API revision history |
| Inspiration tab deprecation from August 2026 | `UNVERIFIED` | A YouTube-published notice |
| "Word-by-word captions improve completion rate" | `[VENDOR]`, `UNVERIFIED` | An independent A/B study. Do not hard-code it as the only style. |
| "3-second hook" threshold | Practitioner convention, not platform-published | Nothing; treat as convention |
| 60-80% clip usability / 20-40% discard | `[VENDOR]`, `UNVERIFIED` | Independent measurement |
| Verizon/Publicis sound-off percentages | `[SECONDARY]`, 2019, self-reported, inconsistently restated | The original study PDF |

**Fetch-failure note.** Three fetches failed this session and are recorded above rather than papered
over: Adobe helpx (timeout, twice), the Blackmagic manual mirror (404), and the Medium creator-time
survey (HTTP 403).

---

## 7. Source index

**Platform primary**

- YouTube A/B test titles and thumbnails: https://support.google.com/youtube/answer/16391400
- YouTube channel monetisation / inauthentic content: https://support.google.com/youtube/answer/1311392
- YouTube create Shorts from your videos: https://support.google.com/youtube/answer/12836917
- YouTube schedule video publish time: https://support.google.com/youtube/answer/1270709
- YouTube Inspiration tab: https://support.google.com/youtube/answer/15575509
- YouTube Data API videos.insert: https://developers.google.com/youtube/v3/docs/videos/insert
- Instagram Platform content publishing: https://developers.facebook.com/docs/instagram-platform/content-publishing/
- TikTok Content Posting API get started: https://developers.tiktok.com/docs/en/content-posting-api-get-started
- TikTok Direct Post reference: https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post
- TikTok auto captions announcement: https://newsroom.tiktok.com/en-us/introducing-auto-captions

**Tool vendor primary**

- OpusClip Virality Score: https://help.opus.pro/docs/article/virality-score
- OpusClip clip counts by duration: https://help.opus.pro/docs/article/how-many-clips
- Pexels license: https://www.pexels.com/license/
- Pexels license FAQ: https://help.pexels.com/hc/en-us/articles/360042295174
- Descript filler-word removal: https://www.descript.com/tools/remove-filler-from-video
- Submagic AI captions: https://www.submagic.co/ai-caption
- StudioBinder shot-list process: https://www.studiobinder.com/blog/how-to-make-a-shot-list-software/
- Adobe Auto Reframe (fetch failed twice, listed for retry): https://helpx.adobe.com/premiere/desktop/add-video-effects/commonly-used-effects/auto-reframe-overview.html

**Survey and secondary**

- Kit, State of AI in the Creator Economy, 550 creators, April 2026: https://kit.com/resources/blog/ai-creator-economy-report
- MrBeast production guide coverage: https://simonwillison.net/2024/Sep/15/how-to-succeed-in-mrbeast-production/
- MrBeast production guide coverage: https://www.tubefilter.com/2024/09/17/mrbeast-internal-production-guide-leaked-key-points/
- Verizon Media / Publicis sound-off study coverage: https://www.forbes.com/sites/tjmccue/2019/07/31/verizon-media-says-69-percent-of-consumers-watching-video-with-sound-off/
- Same study, caption findings: https://www.3playmedia.com/blog/verizon-media-and-publicis-media-find-viewers-want-captions/
- Instagram safe zones: https://www.outfy.com/blog/instagram-safe-zone/
- OpusClip repurposing guide (80/20 curation split): https://www.opus.pro/blog/how-to-make-short-videos-from-youtube-long-videos
- Clip usability review: https://bigvu.tv/blog/opus-clip-tested-2026-where-ai-wins-40-percent-discard/
- Reels duration study (cited in `DURATION_EVIDENCE`): https://www.socialinsider.io/blog/instagram-reels-length/
- TikTok duration study (cited in `DURATION_EVIDENCE`): https://www.socialinsider.io/blog/how-long-are-tiktok-videos/
- Creator time survey, fetch blocked (HTTP 403), snippet only: https://medium.com/rizzle/how-long-does-it-take-to-create-a-youtube-video-266ae3496bf3

**Repository sources read for the automation map**

`runtime/format-library.mjs`, `runtime/format-captions.mjs`, `runtime/format-render.mjs`,
`runtime/format-sourcing.mjs`, `runtime/format-presets.mjs`, `runtime/quality-detectors.mjs`,
`runtime/quality-gate.mjs`, `runtime/production-scheduler.mjs`, `runtime/prompt-logic.mjs`,
`runtime/automation-tools.mjs`, `runtime/provider-catalogue.mjs`, `workers/audio.mjs`,
`workers/audio-local.py`
