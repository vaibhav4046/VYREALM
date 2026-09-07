# Reproducible YouTube video structure — deep research for an executable template library

Compiled 2026-09-07. Companion to, and a deliberate expansion of,
`docs/VIRAL_FORMATS_RESEARCH_2026-09-07.md`.

## 0. How to read this document

This is a structure catalogue, not a virality promise. Three rules govern every
claim below.

1. **Every claim carries a URL.** Claims I could not verify against a page I
   actually fetched are marked `UNVERIFIED`.
2. **Evidence tiers are labelled.** `[PRIMARY]` = YouTube/TikTok/Google's own
   documentation. `[PRACTITIONER]` = a named creator's stated rule, no dataset.
   `[VENDOR]` = a tool company's blog claim, usually unsourced. `[SECONDARY]` =
   third-party analysis. A `[VENDOR]` number is a hypothesis to A/B test, not a
   fact to hard-code.
3. **Case studies are not causal.** View counts are confounded by channel size,
   subscriber base, upload timing, topic seasonality and luck. Where I name a
   video, I am naming an *observable structure*, not proving that structure
   caused the views.

**Exemplar verification method.** Every `youtube.com/watch?v=` URL in Section 1
was fetched this session and its title string confirmed. URLs I list as
channel/playlist pages, or that appeared only in a search result, are marked
`(title not fetch-verified)`.

**Search budget note.** This session exhausted its 200-call web-search budget.
Some lines of inquiry (notably Creator Insider / Rene Ritchie video statements)
could not be closed and are flagged as open gaps in Section 8.

---

## 1. What this adds beyond the existing VIRAL_FORMATS doc

The existing doc is correct but thin: it establishes seven format archetypes, a
20-second beat sheet, a shot-prompt JSON schema, and the AI-disclosure boundary.
It is a positioning document. This one is a specification document.

Net new material here:

| Area | Existing doc | This doc |
| --- | --- | --- |
| Hooks | "one readable visual change" in 0.00–0.01 | 32 named hook patterns with 0–3s structural rules, exemplars and executable parameters (§2) |
| Retention | one 20s beat sheet | separate Shorts and long-form retention models, re-hook cadence, pattern-interrupt intervals, loop mechanics, with the official 30-second Intro metric as the anchor (§3) |
| Niches | 7 archetypes, prose | 12 niches with numbered shot lists, per-shot durations and asset requirements (§4) |
| Titles/thumbnails | not covered | formulas, character budgets, the Test & Compare optimisation target (§5) |
| Captions | "captions must follow narration" | font/weight/position/words-per-cue/karaoke specs plus subtitle-timing standards (§6) |
| Audio | 3 generic cue types | loudness targets, ducking depths, energy curve, SFX placement grid (§7) |
| Failure modes | monetization policy summary | the spam-policy removal risk (not just demonetization), exact prohibited-pattern strings, and the three-way views/engaged/qualified terminology trap (§8) |
| Platform mechanics | not covered | what YouTube actually measures and optimises, with primary citations (§1.1) |

### 1.1 Platform mechanics a template generator must encode

These are the load-bearing primary facts. Everything downstream depends on them.

| # | Fact | Source |
| --- | --- | --- |
| M1 | Test & Compare picks winners on watch time, **explicitly over CTR**: "we optimize tests for overall watch time over other metrics, like click-through-rate." | [PRIMARY] https://support.google.com/youtube/answer/13861714?hl=en |
| M2 | The retention report's only published hard number: "Intro tells you what percentage of your audience still watched your video after the first 30 seconds." | [PRIMARY] https://support.google.com/youtube/answer/9314415?hl=en |
| M3 | Retention report requires video ≥60s and ≥100 views — so **Shorts get no retention curve**, only Shorts metrics. | [PRIMARY] https://support.google.com/youtube/answer/9314415?hl=en |
| M4 | Retention is benchmarked length-normalised: "see how your video compares to all YouTube videos of similar length." | [PRIMARY] https://support.google.com/youtube/answer/9314415?hl=en |
| M5 | Spikes = "moments in your video that were rewatched or shared"; Dips = "moments... either skipped or... viewers stopped watching". | [PRIMARY] https://support.google.com/youtube/answer/9314415?hl=en |
| M6 | Shorts have their own retention proxy: "The percentage of times viewers stayed to watch past the initial seconds of a Short." | [PRIMARY] https://support.google.com/youtube/answer/12220281?hl=en |
| M7 | Shorts feed exposure metric: "Viewed (vs. swiped away)" — "the percentage of times that viewers viewed your Shorts versus swiped away." | [PRIMARY] https://support.google.com/youtube/answer/12942217?hl=en |
| M8 | From 31 Mar 2025, Shorts views "count the number of times a Short starts to play or replay, with no minimum watch time". | [PRIMARY] https://support.google.com/youtube/answer/10059070?hl=en |
| M9 | From **24 Aug 2026**, "views are counted the moment a video starts to play" across all formats — Shorts, VOD and live. | [PRIMARY] https://support.google.com/youtube/answer/2991785?hl=en |
| M10 | Three non-interchangeable terms: **views** (counts on play), **engaged views** (drives YPP earnings), **qualified views** (drives YPP eligibility). Conflating them is the most common error in secondary coverage. | [PRIMARY] https://support.google.com/youtube/answer/2991785?hl=en |
| M11 | Engaged view = "How many times viewers stayed to watch past the initial seconds, not including any loops." **No second-count is published.** | [PRIMARY] https://support.google.com/youtube/answer/12220281?hl=en |
| M12 | Average percentage viewed excludes loops: "As of December 13, 2021, this metric excludes looping clips traffic." | [PRIMARY] https://developers.google.com/youtube/analytics/metrics |
| M13 | The recommender "learns how much of the video the viewer watches and if they're satisfied." | [PRIMARY] https://support.google.com/youtube/answer/141805?hl=en |
| M14 | Shorts max length 3 minutes; max upload resolution 1080p. | [PRIMARY] https://support.google.com/youtube/answer/10059070?hl=en |
| M15 | YouTube publishes **no** ideal length: "There's no universal 'ideal' length for YouTube videos." | [PRIMARY] https://support.google.com/youtube/answer/16559651?hl=en |
| M16 | Shorts feed "may tune up on the recency of content" — the only official Shorts-feed ranking statement found. No weightings are published for watch time, swipe-away, shares or rewatch. | [PRIMARY] https://support.google.com/youtube/answer/16559651?hl=en |
| M17 | Format switching is stated not to harm a channel: "Experimenting with new content formats ... will not inherently confuse the algorithm". | [PRIMARY] https://support.google.com/youtube/answer/16559651?hl=en |
| M18 | Test & Compare: up to 3 title/thumbnail variants, test completes within two weeks, long-form only (not Shorts). | [PRIMARY] https://support.google.com/youtube/answer/13861714?hl=en |
| M19 | Shorts averaged 200 billion daily views as of Jan 2026 (YouTube CEO letter). | [PRIMARY] https://blog.youtube/inside-youtube/the-future-of-youtube-2026/ |

**Engineering consequence of M1 + M2.** The two numbers the platform itself
exposes and optimises are *watch time* and *% still present at 0:30*. A template
generator should therefore treat "survive to 30 seconds" as the single most
important long-form structural constraint, and treat CTR as a diagnostic rather
than a target.

**Engineering consequence of M3 + M6 + M12.** Shorts and long-form need
*different* internal quality models. Long-form can be scored against a retention
curve; Shorts can only be scored against a binary early-hold proxy and a
swipe-away percentage, and loops are excluded from percentage-viewed. A studio
that scores both with one retention heuristic is scoring the wrong thing for one
of them.

---

## 2. Hook taxonomy — 32 opening patterns

### 2.1 Read this before using the exemplars

**Honest limitation.** I did not watch the opening frames of any video in this
section. Video pages return only page chrome to a text fetcher. What I verified
is that each `youtube.com/watch?v=` URL below exists and its **title string** is
what I say it is (fetched and confirmed this session). The hook pattern is
therefore attributed on **packaging and format evidence** — title, known series
structure, and third-party description — not on frame-level observation.

Each exemplar is tagged:
- `[TITLE-VERIFIED]` — URL fetched, title string confirmed this session.
- `[SOURCE-LISTED]` — URL appeared in a source I fetched, title not independently confirmed.
- `[NO EXEMPLAR]` — I could not find a verifiable example. The pattern is still
  described because it is documented in a cited source, but do not treat it as
  observed.

**The two anchor facts this taxonomy is built on.**

- Jenny Hoyos, on YouTube's own blog: *"I really do think you have one second to
  hook someone, especially on Shorts."*
  ([PRACTITIONER, first-party venue] https://blog.youtube/creator-and-artist-stories/youtube-shorts-deep-dive/)
- Paddy Galloway, from a 5,400-Short / 3.3B-view study: *"make your first second
  really punchy"*, and *"Viewed vs swiped away metric is worth paying attention
  to"* ([MEASURED study, practitioner prescription]
  https://www.linkedin.com/posts/paddy-galloway-459b8913a_we-studied-33-billion-views-to-decode-the-activity-7053697597592498176-PAkf)

Two independent sources, one data-backed, converge on the same window: **second
one for Shorts; thirty seconds for long-form** (the latter because that is the
only checkpoint YouTube itself reports —
https://support.google.com/youtube/answer/9314415).

**Mute-legibility is a hard constraint, not a style note.** Between 50% and 80%
of feed video is consumed sound-off (publisher self-report range,
https://digiday.com/media/silent-world-facebook-video/) and 80% of surveyed
viewers say captions make them more likely to finish a video
(n=5,616, https://www.3playmedia.com/blog/verizon-media-and-publicis-media-find-viewers-want-captions/).
**Every hook below must be comprehensible with audio disabled.** A generator
should reject any hook whose meaning lives only in the voice-over.

### 2.2 The hook grammar (what a generator actually emits)

Every pattern below decomposes into the same seven fields. This is the
executable contract:

```json
{
  "hookId": "H07",
  "frame0": "the literal first frame — what is on screen at t=0.00",
  "motionAtT0": "static | already-moving | mid-gesture | camera-move",
  "spokenLine": "≤10 words, or null",
  "onScreenText": "≤6 words, mute-legible, or null",
  "informationWithheld": "the specific thing the viewer now wants",
  "payoffBeatIndex": 4,
  "resolvesByT": 31.0
}
```

Two invariants a generator must enforce, both derived from cited rules:

- `informationWithheld` must be non-null **and** must be answered by
  `payoffBeatIndex`. An unanswered hook is the clickbait failure mode YouTube's
  own Liaison names: *"If you over-index on CTR, it could become click-bait,
  which could tank retention"*
  (https://www.searchenginejournal.com/do-faces-help-youtube-thumbnails-heres-what-the-data-says/563944/).
- `onScreenText` ≤ 6 words. Derived from the thumbnail dataset finding that the
  best-performing text is under 10 characters covering under 7% of the frame
  (https://1of10.com/blog/what-actually-makes-a-youtube-video-go-viral-in-2025/)
  and the short-form caption spec of 5–8 words per cue
  (https://www.opus.pro/blog/best-caption-presets-styles-boost-retention).

### 2.3 The 32 patterns

Column key: **t0 rule** = what is on screen and audible in seconds 0–3.

---

**H01 — Extreme Quantity Declaration**
*t0 rule:* First frame shows the subject already inside the extreme condition. Spoken/on-screen line names a number and a duration: `I <verb> <big number> <unit> <in condition>`. No greeting, no logo.
*Exemplar:* "I Spent 50 Hours In Solitary Confinement" — https://www.youtube.com/watch?v=r7zJ8srwwjk `[TITLE-VERIFIED]`
*Why it works:* the number sets a finite, checkable contract, and the condition is instantly legible without audio. The MrBeast doc frames this exact class of packaging as the highest-leverage decision: "I Spent 50 Hours In My Front Yard" vs "I Spent 50 Hours In Ketchup", the latter "easily 100x more viral" (p5, https://cdn.prod.website-files.com/6623b7720b009050313e701c/66ede69453b7bbadcd2f05a8_How-To-Succeed-At-MrBeast-Production%20(2).pdf) `[LEAKED-DOC CLAIM]`.
*Params:* `quantity`, `unit`, `condition`, `visible_constraint_object`.

**H02 — Prize-Stakes Cold Open**
*t0 rule:* Show the money/prize or the scale of the game in frame 0; state the amount within 3 seconds.
*Exemplar:* "$456,000 Squid Game In Real Life!" — https://www.youtube.com/watch?v=0e3GPea1Tyg `[TITLE-VERIFIED]`
*Why it works:* the stake is the open loop, and the winner is deliberately withheld. The MrBeast doc names this structure: "last to leave" formats where "the winner isn't revealed until the end of the video", concluding "Strong payoffs at the end of videos boost retention" (p29) `[LEAKED-DOC CLAIM]`.
*Params:* `prize_value`, `prize_visual`, `contestant_count`.

**H03 — Trap / Device Versus Antagonist**
*t0 rule:* Show the device armed and the antagonist approaching, in the same frame or in two cuts inside 3s. Name both parties.
*Exemplar:* "Glitter Bomb 1.0 vs Porch Pirates" — https://www.youtube.com/watch?v=xoxhDk-hwuo `[TITLE-VERIFIED]`
*Why it works:* two named parties plus an armed mechanism is a complete premise with zero exposition; the viewer already knows what they are waiting for.
*Params:* `device`, `antagonist`, `arming_shot`, `trigger_condition`.

**H04 — Outcome-In-Parenthesis (spoiler-as-hook)**
*t0 rule:* State the setup, then immediately append the consequence as a parenthetical escalation. On screen at t0: the setup in motion.
*Exemplar:* "Glitterbomb Trap Catches Phone Scammer (who gets arrested)" — https://www.youtube.com/watch?v=VrKW58MS12g `[TITLE-VERIFIED]`
*Why it works:* spoiling the *outcome* while withholding the *mechanism* keeps `informationWithheld` intact. The viewer stays for how, not whether.
*Params:* `setup`, `spoiled_outcome`, `withheld_mechanism`.

**H05 — Absurd Hypothetical Question**
*t0 rule:* Pose a physically concrete impossible question in ≤10 words while showing the object of the question.
*Exemplar:* "What Happens If We Throw an Elephant From a Skyscraper? Life & Size 1" — https://www.youtube.com/watch?v=f7KSfjv4Oq0 `[TITLE-VERIFIED]`
*Why it works:* a question the viewer cannot answer but can *imagine* creates a specific, resolvable gap. Concreteness matters — "what happens if we break physics" fails, a named object and a named action does not.
*Params:* `object`, `action`, `impossible_condition`.

**H06 — Consensus Negation**
*t0 rule:* State a widely believed fact, then negate it, inside 3 seconds. Frame 0 shows the thing everyone thinks they understand.
*Exemplar:* "Why No One Has Measured The Speed Of Light" — https://www.youtube.com/watch?v=pTn6Ewhb27k `[TITLE-VERIFIED]`
*Why it works:* it creates a debt — the viewer's existing model is now wrong and must be repaired. Supported by the dataset finding that negative-sentiment titles, at only 11% of the corpus, got ~22% more views (https://1of10.com/blog/what-actually-makes-a-youtube-video-go-viral-in-2025/) `[MEASURED, correlational]`.
*Params:* `common_belief`, `negation`, `evidence_beat`.

**H07 — Superlative Location/Object**
*t0 rule:* Frame 0 is the superlative thing itself, held long enough to read. Line names the superlative and the scope.
*Exemplar:* "The Most Radioactive Places on Earth" — https://www.youtube.com/watch?v=TRL7o2kPqw0 `[TITLE-VERIFIED]`
*Why it works:* superlatives are self-ranking; the viewer stays to see whether their guess is on the list. Implicitly a listicle, so it inherits the list's re-hook structure for free.
*Params:* `superlative`, `category`, `scope`, `rank_count`.

**H08 — Imperative Manifesto**
*t0 rule:* 2–4 word command, spoken hard, over a moving image with no context. No subject introduction.
*Exemplar:* "DO WHAT YOU CAN'T" — https://www.youtube.com/watch?v=jG7dSXcfVqE `[TITLE-VERIFIED]`
*Why it works:* second-person imperative addresses the viewer directly and demands a self-assessment. Highest-risk pattern in this list: it has no `informationWithheld` of its own, so it must be paired with an immediate escalating narrative or it dies at 0:05.
*Params:* `imperative`, `energy_curve_start` (must start high).

**H09 — Silent Process Cold Open**
*t0 rule:* Hands already working. No speech at all in the first 3 seconds. Diegetic sound only.
*Exemplar:* "Primitive Technology: Tiled Roof Hut" — https://www.youtube.com/watch?v=P73REgj-3UE `[TITLE-VERIFIED]`
*Why it works:* the absence of a presenter is itself the pattern interrupt in a feed of talking heads. Fully mute-legible by construction. Note this format's entire retention model is process-completion, not curiosity.
*Params:* `craft`, `first_physical_action`, `end_artifact`.

**H10 — Machine/Contraption Reveal**
*t0 rule:* Show the complete apparatus running, in one wide shot, before explaining any part of it.
*Exemplar:* "Wintergatan - Marble Machine (music instrument using 2000 marbles)" — https://www.youtube.com/watch?v=IvUU8joBb1Q `[TITLE-VERIFIED]`
*Why it works:* visual complexity that resolves into obvious function creates a "how does that work" gap that needs no verbal setup.
*Params:* `apparatus`, `visible_output`, `component_count`.

**H11 — Serialised Expert Reaction**
*t0 rule:* Frame 0 is the clip being reacted to, not the reactors. Cut to reactors only after the subject is established. Series index shown.
*Exemplar:* "VFX Artists React to Bad & Great CGi 240 Ft. Richard Taylor" — https://www.youtube.com/watch?v=DJ92uAZ-dVs `[TITLE-VERIFIED]`
*Why it works:* the serial number ("240") is a retention device — it signals a proven format to returning viewers, which is Galloway's "when a format works, ride it until they stop you" (https://podcast.creatorscience.com/paddy-galloway-2/) `[PRACTITIONER]`. **Policy note:** this pattern is only monetizable with genuine added commentary — YouTube names "Reaction videos where you comment on the original video" as allowed, and bare clip compilation as not (https://support.google.com/youtube/answer/1311392?hl=en).
*Params:* `subject_clip`, `expert_credential`, `series_index`, `commentary_ratio`.

**H12 — Animal/Obstacle Escalation**
*t0 rule:* Show the obstacle course/system fully built, then introduce the naive participant. Both inside 3s.
*Exemplar:* "Backyard Squirrel Maze 1.0- Ninja Warrior Course" — https://www.youtube.com/watch?v=hFZFjoX2cGg `[TITLE-VERIFIED]`
*Why it works:* an unwitting participant plus a designed system is a pre-loaded eight-minute open loop with built-in stair-stepping.
*Params:* `system`, `participant`, `stage_count`, `failure_stakes`.

**H13 — Buried/Confined Constraint**
*t0 rule:* First frame is inside the constraint, looking out. The constraint is the whole visual.
*Exemplar:* "I Spent 50 Hours Buried Alive" — https://www.youtube.com/watch?v=9bqk6ZUsKyA `[TITLE-VERIFIED]`
*Why it works:* claustrophobic framing is a visceral, instantly legible stake. Distinct from H01 in that the *frame composition itself* carries the premise.
*Params:* `enclosure`, `duration`, `escape_condition`.

**H14 — Seamless Loop Seam**
*t0 rule:* Frame 0 is byte-identical to the final frame. The action begins mid-cycle so the join is invisible.
*Exemplar:* "This Video is a Seamless Infinite Loop ♾️ #shorts" — https://www.youtube.com/shorts/XzkBgasDUi4 `[SOURCE-LISTED]`; construction tutorial: https://www.youtube.com/watch?v=gP76Sk_P6Ng `[SOURCE-LISTED]`
*Why it works:* **the only hook technique in this document with real measured lift on a named channel.** Colin & Samir's Q1 2022 channel data: Shorts with end-loops "averaged 143% more views, as well as a higher subscribe rate", and one 26-second Short "resulted in 68% of viewers watching the video again" (https://news.thepublishpress.com/p/shorts-powered) `[MEASURED, n=1 channel]`. Caveat: average-percentage-viewed **excludes looping traffic** (https://developers.google.com/youtube/analytics/metrics), so loops inflate views and rewatch, not APV.
*Params:* `loop_frame`, `cycle_seconds`, `seam_masking_motion`.

**H15 — Price Constraint ("what does $N get you")**
*t0 rule:* Show the money in hand, name the amount and the target, ≤10 words. Money on screen at t0.
*Exemplar:* `[NO EXEMPLAR]` — the widely cited Jenny Hoyos example "What does $1 get you at Starbucks?" (reported 23M views) appears only in a vidIQ page that returned HTTP 429 on five fetch attempts. **Unverified; no URL constructed.** Pattern itself is documented: Hoyos names "banned," "free," "one dollar," "secret," "cheap" as her power words, with the worked example "$1 chicken sandwich" (https://www.marketingexamined.com/blog/jenny-hoyos-short-form-video-playbook) `[PRACTITIONER]`.
*Params:* `amount`, `venue`, `expectation_baseline`.

**H16 — Foreshadowed Comparison ("but is that enough to beat X")**
*t0 rule:* Hook line, then within the same 3-second window a second line that names the comparison target and the test. Hoyos's verbatim template: *"Chick-fil-A has the best chicken sandwiches, but I am not paying $6. So, I am gonna make it with $1 then compare them."*
*Exemplar:* `[NO EXEMPLAR]` — template documented at https://www.marketingexamined.com/blog/jenny-hoyos-short-form-video-playbook and https://www.linkedin.com/posts/jayclouse_jenny-hoyos-gave-me-her-exact-script-that-activity-7262878750684459010-NIZu `[PRACTITIONER]`
*Why it works:* it front-loads the *ending question* in the first 3 seconds. Hoyos's stated structure is Hook → Foreshadow → Narrative → Twist, with hook and foreshadow both inside "no more than 3 seconds".
*Params:* `benchmark_brand`, `constraint`, `comparison_metric`.

**H17 — Mid-Sentence Entry**
*t0 rule:* Audio starts mid-word or mid-clause; the first complete thought lands at ~0.6s. Never begin with a greeting, a logo, or "so".
*Why it works:* Hoyos explicitly deletes pace-breaking connectives, quoting her own edit: *"At first I wrote let's get started, but that breaks pace... instead I said so I cooked illegally"* (marketingexamined URL above) `[PRACTITIONER]`. Encodes to a hard filter: strip leading discourse markers from generated scripts.
*Exemplar:* `[NO EXEMPLAR]`
*Params:* `entry_word_index`, `banned_openers[]`.

**H18 — But/Therefore Chain Opener**
*t0 rule:* Two clauses joined by "but", never "and then". Hoyos's example: *"I went on a walk, but it started raining. Therefore I started running back home."*
*Why it works:* "and then" is additive and predicts nothing; "but/therefore" is causal and forces the viewer to model a next state. Documented at the marketingexamined URL above `[PRACTITIONER]`. Encodes to a linter: reject scripts whose beat-to-beat connective is additive.
*Exemplar:* `[NO EXEMPLAR]`
*Params:* `clause_a`, `reversal`, `consequence`.

**H19 — Crazy Progression Compression**
*t0 rule:* Do not spend the opening on day one of a long process. Compress multiple stages into the first beats so the viewer sees the trajectory immediately.
*Why it works:* the MrBeast doc states this directly for minutes 1–3: for a video about surviving weeks in the woods, "cover multiple days in the first 3 minutes" rather than lingering on day one, and "Stop telling people what they will be watching and start showing them" (p7) `[LEAKED-DOC CLAIM]`.
*Exemplar:* structural rule, applies to H01/H13 videos above.
*Params:* `stage_list`, `compression_ratio`, `first_visible_change`.

**H20 — "Only X Can Do This" Spectacle**
*t0 rule:* Open on a physically impossible-to-fake production event that no competitor could stage.
*Why it works:* the MrBeast doc describes flying a house in on a crane "30 seconds into the video", conceding it is "from a data standpoint illogical and a waste of time", justified purely by brand memory: "Anytime we do something that no other creator can do, that seperates us in their mind" (p9) `[LEAKED-DOC CLAIM]`. **Honest read: this is an explicitly anti-retention hook** that trades short-term watch time for differentiation. Do not present it as retention-optimal.
*Exemplar:* `[NO EXEMPLAR]`
*Params:* `spectacle_asset`, `uniqueness_justification`.

**H21 — Direct Address Qualifier**
*t0 rule:* Second-person sentence that filters the audience: `If you <condition>, <promise>`. On-screen text mirrors the condition.
*Why it works:* it converts a broad feed impression into a self-selected view, which raises the odds the viewer completes. **Caution:** it also narrows reach, which conflicts with Galloway's CCN test — *"can a core, casual, and new viewer all click this video and enjoy it?"* (https://podcast.creatorscience.com/paddy-galloway-2/) `[PRACTITIONER]`. Use for conversion-oriented content, not reach.
*Exemplar:* `[NO EXEMPLAR]`
*Params:* `audience_condition`, `promise`.

**H22 — Countdown / Visible Timer**
*t0 rule:* A running timer or counter is composited on screen from frame 0 and never leaves.
*Why it works:* a persistent counter is a continuous open loop — it re-hooks passively at every glance, without spending a beat.
*Exemplar:* `[NO EXEMPLAR]` — structurally present in the H01/H13 class (a "50 hours" premise implies an on-screen clock) but I did not verify the on-screen treatment.
*Params:* `counter_type`, `start_value`, `terminal_value`, `screen_position`.

**H23 — Stair-Step Escalation Ladder**
*t0 rule:* Open at the bottom rung, and show the top rung's *existence* (not its content) within 3 seconds.
*Why it works:* the MrBeast doc's named "stair stepping" format — lighting a $1 firework, then $10, $50, $375, $1,000, $10,000, $40,000, $100,000, then the world record, with "The payoff of the world record is at the end" (p29) `[LEAKED-DOC CLAIM]`. Each rung is a micro-payoff that funds the next open loop, so retention does not depend on one distant reward.
*Exemplar:* `[NO EXEMPLAR]` — the format is described in the doc; I did not verify a specific video.
*Params:* `rung_values[]`, `rung_count`, `terminal_reward`.

**H24 — Result-First Reverse Reveal**
*t0 rule:* Frame 0 is the finished state (the built thing, the transformed person, the final score). Cut immediately to "here's how".
*Why it works:* it converts a "will this be worth it" question into a "how did that happen" question, which is a much more durable gap. Pairs naturally with H14 because the result frame can also be the loop frame.
*Exemplar:* `[NO EXEMPLAR]`
*Params:* `final_state_shot`, `rewind_marker`, `process_beat_count`.

**H25 — Credentialed Confession**
*t0 rule:* `I'm a <role> and <thing the role isn't supposed to say>`, spoken to camera, ≤10 words, role visually evidenced (uniform, workspace, tool).
*Why it works:* combines authority with taboo, so the withheld information is framed as insider knowledge. **Policy trap:** YouTube's monetization policy explicitly names "An AI 'doctor' providing medical diagnoses, health advice, or wellness remedies" as ineligible (https://support.google.com/youtube/answer/1311392?hl=en). A generator must block synthetic credentialed personas in health, finance and legal.
*Exemplar:* `[NO EXEMPLAR]`
*Params:* `role`, `credential_visual`, `confession`, `domain_allowlist`.

**H26 — Physical Anomaly In Frame**
*t0 rule:* Something visibly wrong with the physics or scale of the opening image, held static for ~1s so the eye finds it.
*Why it works:* pure mute-legible pattern interrupt; requires no language at all, so it survives every sound-off and non-native-speaker case.
*Exemplar:* `[NO EXEMPLAR]`
*Params:* `anomaly_type`, `hold_duration`, `explanation_beat`.

**H27 — Fourth-Wall Scroll Interrupt**
*t0 rule:* Address the act of scrolling itself in ≤5 words, on-screen and spoken.
*Why it works:* it targets `Viewed (vs. swiped away)` directly — the one Shorts exposure metric YouTube publishes (https://support.google.com/youtube/answer/12942217?hl=en). **Highest slop risk in this list:** it is content-free, so it is exactly the kind of "templated storyline" the inauthentic-content policy names. Use at most once per project, never as a channel default.
*Exemplar:* `[NO EXEMPLAR]`
*Params:* `interrupt_phrase`, `payoff_within_seconds` (must be ≤3).

**H28 — Banned / Forbidden Framing**
*t0 rule:* The words "banned", "illegal", "not allowed", or "they removed this" inside the first 3 seconds, with the subject visible.
*Why it works:* one of Hoyos's named power words (marketingexamined URL above) `[PRACTITIONER]`. **Truth constraint:** if the claim is false, the video is a misleading-metadata problem, and the packaging-payoff mismatch is exactly what the Liaison warns tanks retention. A generator must require a factual basis field for this hook.
*Exemplar:* `[NO EXEMPLAR]`
*Params:* `prohibition_claim`, `evidence_source` (required, non-null).

**H29 — Two-Object Versus**
*t0 rule:* Both objects in frame 0, side by side, labelled. No preamble.
*Why it works:* comparison is self-explaining and creates an implicit poll, which drives comments. Note Galloway's study found engagement metrics "don't seem massively important" for Shorts distribution (LinkedIn URL above), so treat the comment lift as a community benefit, not a ranking one.
*Exemplar:* "Glitter Bomb 1.0 vs Porch Pirates" (versus framing) — https://www.youtube.com/watch?v=xoxhDk-hwuo `[TITLE-VERIFIED]`
*Params:* `object_a`, `object_b`, `comparison_axis`.

**H30 — Serialised Day-N**
*t0 rule:* `Day <N> of <ongoing commitment>` on screen at t0, with the current state visible.
*Why it works:* N > 1 implies a back catalogue and a future, which is a subscription argument rather than a view argument. **Policy trap:** this is the closest legitimate format to the prohibited pattern "characters are put in the same situation over and over again with the same outcome" (https://support.google.com/youtube/answer/1311392?hl=en). It stays compliant only if each instalment's substance is "materially varied".
*Exemplar:* `[NO EXEMPLAR]`
*Params:* `day_index`, `commitment`, `variation_delta` (required, must differ from previous instalment).

**H31 — Mute-Test Visual Premise**
*t0 rule:* Compose the first 3 seconds so the entire premise is readable with audio off — action, subject, and stake all visual.
*Why it works:* Hoyos's stated rule is that content "needs to be so good that you can be watching the video on mute and still know what it's about" (attributed via vidIQ snippet, **page unfetchable, HTTP 429** — `[PRACTITIONER, UNVERIFIED SOURCE]`). The underlying claim is independently supported by the sound-off consumption data in §2.1, so the rule is safe even though this specific quote is not.
*Exemplar:* `[NO EXEMPLAR]`
*Params:* `visual_premise`, `audio_dependency` (must be `false`).

**H32 — Simplicity-Gated Premise**
*t0 rule:* Reject any hook whose premise cannot be stated in one clause at a low reading level.
*Why it works:* two independent sources converge. MrBeast doc: "for 50 million people to understand something it must be simple" (p26) `[LEAKED-DOC CLAIM]`. Hoyos writes scripts at 5th-grade reading level or below and reports top Shorts scoring around 1st-grade (https://podcast.creatorscience.com/jenny-hoyos/, https://www.leaderonomics.com/videos/box-of-chocolates/how-to-make-great-youtube-shorts-lessons-from-jenny-hoyos) `[PRACTITIONER]`.
*Implementation:* run a readability score on the generated hook line and reject above grade 5. This is the single cheapest automated quality gate in this document.
*Exemplar:* applies to all.
*Params:* `max_reading_grade` (default 5), `max_clauses` (default 1).

### 2.4 Hook selection policy

Do not let a generator pick uniformly at random. Constraints, in priority order:

1. **H32 gates everything.** Reading-grade check runs on every candidate.
2. **H31 gates everything visual.** If `audio_dependency` is true, regenerate.
3. **Format determines the eligible subset**, not creator preference. Shorts:
   H01–H18, H22, H24, H26–H31. Long-form: H01–H13, H19–H25, H29, H30, H32.
4. **H20 and H27 are rationed.** H20 is anti-retention by its own source's
   admission; H27 is the highest slop-policy risk.
5. **H25 and H28 require a non-null evidence field** before they may be emitted.
6. **Never emit two videos in a project with the same `hookId` and the same
   `informationWithheld` shape** — that is the templated-storyline failure in §8.

---

## 3. Retention structure

### 3.1 Shorts (<60s)

**Length: the evidence genuinely conflicts, and the conflict is informative.**

| Source | Finding | Tier |
| --- | --- | --- |
| Galloway/Gileta, 5,400 Shorts / 33 channels / 3.3B views | Algorithm "does (unsurprisingly) appear to favor longer videos (40 seconds+)"; optimal band 50–60s | [MEASURED] https://news.thepublishpress.com/p/are-shorts-worth-it |
| Colin & Samir, own channel Q1 2022 | "Six of our top eight performing Shorts in Q1 were within the 34-43 second range" (prior quarter: 23–30s) | [MEASURED, n=1 channel] https://news.thepublishpress.com/p/shorts-powered |
| Jenny Hoyos | "It's exactly 34 seconds because my most popular videos are exactly that length" | [PRACTITIONER] https://podcast.creatorscience.com/jenny-hoyos/ |
| Adobe Express, n=507 creators surveyed Mar 2026 | 53% named under-30s best for views | [MEASURED — but of *opinion*, not performance] https://www.adobe.com/express/learn/blog/youtube-shorts-length-study |
| Todd Sherman, YouTube Shorts product lead | refuses to name one; best is the duration that "aligns with how they want to tell their story" | [PRIMARY] https://blog.youtube/creator-and-artist-stories/youtube-shorts-deep-dive/ |
| YouTube Help | "There's no universal 'ideal' length for YouTube videos." | [PRIMARY] https://support.google.com/youtube/answer/16559651?hl=en |

**Resolution.** The performance data (Galloway 40s+, Colin & Samir 34–43s,
Hoyos 34s) converges on **34–45 seconds**. The "under 30s" finding is creator
*opinion* from a survey, not measured performance, and is contradicted by the
only large dataset. **Default to 34–43s; treat sub-30s as a special mode.**

Hoyos gives the reason sub-30s is a trap: *"if a short is less than 30 seconds,
it needs to. It has to have over a 100% retention"* — i.e. it only travels if
loops push it past 100%, which requires H14 to be built in from the start.

**The second-level arithmetic (the most encodable retention model found).**
Hoyos states it as literal maths on a ~32-second Short: *"Every 2nd counts on a
short. Like, every single second."* / *"If you lose one second, that's already
97%. That's 3 percentages."* / *"If you have lose 2 seconds, that's 6%."*
`[PRACTITIONER]` https://podcast.creatorscience.com/jenny-hoyos/

That yields a directly implementable cost function:

```
retention_cost_per_second = 1 / duration_seconds
# a 34s Short: every dead second costs ~2.9 percentage points of APV
```

**The tail-trim rule — the single most actionable edit in this corpus.** Hoyos
found her curve cliffing at the very end: *"I noticed on the last 2nd, it was a
huge dip. It was 70%. One second later, it was 45%."* Deleting that one second
moved the video *"from 83% to 88%"* `[PRACTITIONER, same URL]`.
**Implementation: after render, inspect the final 1–2 seconds and cut any frame
after the emotional peak.** There is no reason for a Short to hold on a resolved
image.

**Her stated benchmarks** (`[PRACTITIONER]`, self-reported, same URL): scroll-
through rate 85%, retention 95%, shares-to-views ratio 20%. Treat as one
creator's ceiling, not a target to fail against.

**The two-gate measurement model.** Both the study and the practitioner
independently describe the same two gates, and they map onto the two metrics
YouTube actually publishes for Shorts:

1. Gate 1 — **`Viewed (vs. swiped away)`**: "the percentage of times that viewers
   viewed your Shorts versus swiped away"
   (https://support.google.com/youtube/answer/12942217?hl=en). Owned by the hook.
2. Gate 2 — **`Stayed to watch`**: "The percentage of times viewers stayed to
   watch past the initial seconds of a Short"
   (https://support.google.com/youtube/answer/12220281?hl=en). Owned by beats 2–3.

Galloway's study also found engagement metrics were **not** decisive: "Engagement
metrics (likes, shares, comments) don't seem massively important" (LinkedIn URL
in §2.1) `[MEASURED]`. Do not optimise a Shorts template for comment bait.

**Executable Shorts beat sheet (34–43s target).**

| Beat | Window (s) | Job | Hard rule |
| --- | --- | --- | --- |
| B0 Hook | 0.0–1.0 | establish subject + stake, mute-legible | one visual change; no greeting, no logo, no discourse marker |
| B1 Foreshadow | 1.0–3.0 | name the comparison/question that the ending answers | Hoyos: hook + foreshadow both inside "no more than 3 seconds" |
| B2–B5 Escalation | 3.0–26.0 | but/therefore chain, one new state per beat | new visual state every 3–5s; never additive ("and then") |
| B6 Peak | 26.0–33.0 | the promised reveal, at maximum emotional intensity | "the intensity of the emotion at the end" determines satisfaction |
| B7 Cut | 33.0–34.0 | end immediately, or return to loop frame | trim any frame after the peak (tail-trim rule) |

Pattern-interrupt cadence inside B2–B5: a new visual or story beat every 3–5
seconds. The commonly cited "one cut every 2–4 seconds / new beat every 5–7
seconds" figures are `[VENDOR, unsourced]`
(https://www.opus.pro/blog/ideal-youtube-shorts-length-format-retention); the
3–5s window is the conservative intersection of that and the second-level cost
arithmetic above.

**Loop mechanics.** If `duration < 30s`, loop is mandatory (Hoyos's >100%
requirement). If `duration ≥ 34s`, loop is optional and should be used when the
final image can plausibly be the first. Remember loops inflate views and rewatch
but **not** average percentage viewed, which "excludes looping clips traffic"
since 13 Dec 2021 (https://developers.google.com/youtube/analytics/metrics).

### 3.2 Long-form (8–20 min)

**Why 8 minutes is a real boundary.** Mid-roll ads require "8 minutes or longer"
(https://support.google.com/youtube/answer/6175006) `[PRIMARY]`. That is the
only hard structural threshold YouTube publishes for long-form.

**The retention law, stated by the largest channel on the platform.** From the
leaked production document (read in full, 36 pages; **authenticity: Business
Insider reportedly verified it with two former staffers per
https://fortune.com/2024/09/26/youtube-mrbeast-jimmy-donaldson-leaked-business-handbook-advice,
MrBeast has never publicly confirmed it, and its date of authorship is unknown —
treat everything from it as `[LEAKED-DOC CLAIM]`**):

- *"As with almost every video on Youtube, the first minute has the most loss."* (p6)
- *"The first minute of each video is the most important minute of each video."* (p7)
- Worked example with real analytics: 60 million people clicked; *"we lost 21
  million viewers in the first minute of the video"* — **65% retention at 1:00**
  (derived arithmetic from his two figures, not a percentage he states) — and he
  calls that *"surprisingly compared to other channels ... above average"*.

**The official 30-second checkpoint.** YouTube's own retention report defines
Intro as "what percentage of your audience still watched your video after the
first 30 seconds" (https://support.google.com/youtube/answer/9314415)
`[PRIMARY]`. Two analytics screenshots inside the leaked doc show YouTube's own
in-product commentary: *"69% of viewers are still watching at around the 0:30
mark, which is typical"* (p6) and *"74% of viewers are still watching at around
the 0:30 mark, which is typical"* (p33) `[MEASURED, two videos]`.

**This is the most useful number in the entire document.** YouTube's own product
called ~69–74% at 0:30 "typical" on a large channel. Use ~70% at 0:30 as the
working design target, and label it honestly as derived from two screenshots,
not from a published benchmark.

**The re-hook cadence, from the doc (13:37 average video length, p8):**

| Time | Named job | Verbatim rule |
| --- | --- | --- |
| 0:00–1:00 | survive the biggest loss | thumbnail↔content contract must hold or "You'd feel like you were lied to and click off" (p5) |
| 1:00–3:00 | "transition from hype to execution" | *"Stop telling people what they will be watching and start showing them."* (p7) |
| 1:00–3:00 | compression | "crazy progression" — cover multiple stages, not stage one (p7) |
| ~3:00 | **re-engagement #1** | content that "only MrBeast can do this"; purpose is boredom insurance — "they could get bored of the story and click off" (p7) |
| 3:00–6:00 | second-most-important block | "all the most exciting and interesting content that is also very simple", with "lots of quick scene changes" (p7–8) |
| ~6:00 | **re-engagement #2** | "needs a little more explanation", pushes story into the back half (p8) |
| 6:00–end | "a lull" | viewers "are watching the video without even realizing they are watching a video"; weaker content and long explanations live here (p8) |
| end | payoff | *"Don't ever signal the end of the video unless it's to build hype for the prize or payoff at the end"* (p8); *"The video endings must always be abrupt to protect retention."* (p35) |

**The commitment threshold:** *"If we can get them to watch the first half of
the video there's a very high chance they'll watch to the end."* (p8) This is why
the re-hooks cluster in the first half and the second half is allowed to be
lower-energy — the structure spends its budget where the decision is made.

**Organisational rule worth encoding as UI:** *"must always know what minute mark
the content you are working on is."* (p8) A timeline that does not display the
minute-mark role of each block is missing the doc's central working practice.

**The strongest single retention→views datapoint available anywhere.** Two videos
of near-identical length from the same channel, first-day data (p27–28)
`[LEAKED-DOC CLAIM, screenshot-backed]`:

| Video | AVD | APV | Views |
| --- | --- | --- | --- |
| A | 5:58 | 49.9% | 45,000,000 |
| B | 7:36 | 68.3% | 120,000,000 |

His read: *"People on average watched this video a minute and 38 seconds longer
than the other video of the same length!!"* and it *"GOT TRIPLE THE VIEWS"*.
**This is n=2 on one channel with no controls.** It is consistent with M1 (the
platform's own A/B tool optimises watch time) but it is not proof of causation —
the better-retained video may simply have been a better idea.

**Verified absences — do not cite these as MrBeast rules.** Having read all 36
pages: there is **no** "70% at 1 minute" target, **no** "50% AVD" target, **no**
"the first 3 minutes are 30% of the effort", **no** "add a new element every X
seconds", **no** cut-frequency or b-roll-density rule, and the terms "the click",
"the retain", "the reward" do not appear. Also correcting a common
misattribution: the A/B/C-player framework in the doc is about **staff**, not
video priority (p4–5).

**Pattern-interrupt interval, honestly.** The only published number I found is
"every 2–4 minutes in videos over ten minutes long"
(https://increditors.com/video-pacing-youtube-retention-science/) — that page
cites no source and its per-niche cut-frequency table appears fabricated, so it
is `[UNVERIFIED]`. It is worth noting only because the doc's actual cadence
(re-hooks at ~3:00 and ~6:00 on a 13:37 video) falls inside that window. **Use
the doc's cadence, cite the doc, and discard the folklore table.**

**Mid-roll placement.** YouTube states ads "placed at natural breakpoints ... are
more likely to serve ads as our systems generally find higher viewer retention at
these breakpoints", and that slots "mid-sentence or mid-action are less likely to
serve ads" (https://support.google.com/youtube/answer/6175006) `[PRIMARY]`. No
spacing interval is published. The doc supplies the visual evidence for the cost
of a bad break: a retention chart of an old-style brand read with a visible
crater — *"Notice the crater where the brand deal is, that means people skipped
it and also clicked off the video."* (p32) — versus an integrated read on a 9:00
video where *"The dip is way less dramatic"* (p33).

**Length and engagement outside YouTube.** Wistia's 2026 study of "over 13
million videos" and "79 million hours of viewing data" found "The shorter the
video, the higher the engagement rate": under 1 minute averages a 52% engagement
rate, engagement "naturally declines after the five-minute mark", and there is
"an 11% drop in engagement once videos cross" 30 minutes
(https://wistia.com/blog/video-marketing-statistics,
https://wistia.com/blog/optimal-video-length) `[MEASURED — but business video on
Wistia, not YouTube]`. Their own counter-example matters more for template
design: "Webinar replays between 31–45 minutes saw more than 2x the engagement of
those under 30 minutes." **The length penalty is format-dependent, not absolute.**

**Retention benchmark tables in circulation are not evidence.** The commonly
copied ranges (65–75% APV at 4 min, 50–60% at 10 min, 40–50% at 15 min) are
labelled by their own publisher as derived — "These are conversions, not new
performance claims" (https://prepublish.ai/blog/good-average-view-duration-youtube)
`[UNVERIFIED]`. One self-reported real channel datapoint for contrast: 19.43%
average percentage viewed across 10+ minute videos, top videos 32.7–42.6%
(https://humbleandbrag.com/blog/youtube-audience-retention-benchmarks)
`[MEASURED, n=1 channel]`. The honest position: **there is no published,
methodologically sound APV benchmark for YouTube long-form.** Compare a video
only against YouTube's own same-length comparison in Studio (M4).

### 3.3 Executable long-form skeleton (13-minute default)

```
t=0:00–0:15   Cold open. Highest-energy shot in the video. No branding.
t=0:15–0:30   State the contract: what the thumbnail promised, restated as a
              question the video will answer. CHECKPOINT: target ~70% here.
t=0:30–1:00   Show, do not tell. First visible progress toward the promise.
t=1:00–3:00   Crazy progression: compress multiple stages. Energy trough allowed
              at ~2:00 so the 3:00 re-hook reads as a lift.
t=3:00        RE-HOOK 1: the "only we can do this" beat.
t=3:00–6:00   Densest, simplest, most exciting block. Fast scene changes.
t=6:00        RE-HOOK 2: the beat that requires explanation and opens the back half.
t=6:00–11:30  The lull. Lower energy is permitted. Explanations live here.
              Mid-roll candidates: natural breakpoints only, never mid-action.
t=11:30–12:45 Payoff. Never signal that the end is coming except to build hype
              for the payoff itself.
t=12:45–13:00 Abrupt end. No outro, no "if you enjoyed".
```

Every timing above traces to a cited rule in §3.2. The one number that is mine,
not a source's, is the 2:00 trough — it follows from Derek Lieu's energy law
("If a trailer feels high energy all the time, then none of it will feel high
energy") applied to the doc's 3:00 re-hook, and should be labelled a design
choice rather than an evidenced rule.

---

## 4. Per-niche formats and shot lists

**Status of this section.** Sections 2, 3, 5–8 are research. **This section is
derived design.** The shot lists apply the cited rules above to twelve niches.
The *rules* are sourced; the *shot lists* are my construction. Nothing here
should be presented as measured. Where a niche has niche-specific evidence, it is
cited inline.

Notation: `[n s]` = beat duration. `SH` = Short variant, `LF` = long-form variant.

### 4.1 Tech / gadget review

Structure evidence: standard sequence unboxing → design → display → performance →
camera → battery → verdict is the widely described convention
(https://fluxnote.io/guides/how-to-make-phone-review-video-youtube-shorts)
`[SECONDARY]`. Hook: H24 (result-first) or H06 (consensus negation).

`SH` (38s):
1. `[1s]` Verdict frame first — the device in hand with the one-line judgement burned in. (H24)
2. `[2s]` Name the single spec that makes the judgement true.
3. `[5s]` Macro push-in on the physical detail that carries the claim.
4. `[6s]` Side-by-side against the obvious competitor, labelled. (H29)
5. `[8s]` The one real-world test, shot in a single unbroken take (no cuts = credibility).
6. `[10s]` Result on screen as a number.
7. `[5s]` Restate verdict with the price. Cut.
8. Loop frame = shot 1 if the verdict frame is static.

`LF` (12 min): cold open on the failed or surprising test result → 0:30 contract
("is it worth £X") → 1:00–3:00 compress unboxing and design into a montage, never
a real-time unbox → 3:00 re-hook: the test no other reviewer runs → 3:00–6:00
performance and camera, fast cuts → 6:00 re-hook: the deal-breaker → lull for
battery/software detail → payoff: buy/don't-buy with the price → abrupt cut.

Asset requirements: macro lens shots of 3 physical details, 1 controlled
comparison rig, 1 measurable test with an on-screen number, competitor device.

### 4.2 AI / software demo

Hook: H24 or H10 (show the working system before explaining it). The failure mode
is the "tour of the settings menu" open.

`SH` (34s):
1. `[1s]` The finished output on screen, already generated. No UI chrome.
2. `[2s]` One line: what was typed to get it.
3. `[4s]` Screen recording of the actual input, sped up, cursor visible.
4. `[6s]` The generation happening, compressed — never show real waiting time.
5. `[8s]` Output revealed at full scale.
6. `[8s]` The second, harder example that proves it was not cherry-picked.
7. `[5s]` The limitation, stated plainly. (Credibility beat; also the twist.)

`LF`: same skeleton, with re-hook 1 at 3:00 = the case where it breaks, and
re-hook 2 at 6:00 = the workflow that makes it useful in practice.

Constraint: never fake a demo. YouTube's disclosure policy triggers on content
that "Generates a realistic scene that didn't actually occur"
(https://support.google.com/youtube/answer/14328491?hl=en); a staged product
capability presented as real is both a disclosure and a trust problem.

### 4.3 Anime / animation short

Hook: H26 (physical anomaly) or H14 (loop). This niche has the weakest evidence
base — I found **no** published retention data specific to animation shorts, and
say so rather than inventing one.

`SH` (30s, loop-mandatory per §3.1):
1. `[1s]` Character mid-action in a composition that will become the loop frame.
2. `[2s]` The anomaly or stake, delivered visually — no dialogue.
3. `[5s]` Reaction shot; establish the character's want in one expression.
4. `[7s]` Escalation: the world responds. New environment or scale change.
5. `[7s]` Reversal.
6. `[6s]` Return to the opening composition, transformed. Loop seam here.

Asset requirements: one character sheet, one environment sheet, three camera
angles held consistent, one motion cycle that can be seamlessly joined. The
existing VYREALM doc's continuity fields (`same face`, `same jacket`) are the
right mechanism; this shot list is what they must hold across.

### 4.4 Cinematic film trailer

Best-documented structure in this section. Derek Lieu's four-part shape
(https://www.derek-lieu.com/blog/2017/9/10/the-matrix-is-a-trailer-editors-dream)
`[PRACTITIONER]`:

1. **Cold open** — "hit the ground running with some very exciting, humorous or dramatic scene that requires very little context"; must "provide its own context".
2. **Introduction** — premise via exposition or questions.
3. **Escalation** — antagonist / central problem, and the response to it.
4. **Climax** — protagonist acts, music swells, rapid montage, ends on title card.

Governing law: *"If a trailer feels high energy all the time, then none of it
will feel high energy."* Music timings from the trailer-music three-act
convention: Act I ambient/minimal for the first ~20–30s, Act II momentum, Act III
30–60s of peak, with a "stopdown" (big hit then silence) as the editor's cut
point (https://www.rareformaudio.com/blog/how-production-music-reveals-trailer-structure,
https://www.nathanfieldsmusic.com/blog/three-act-structure-trailer-music)
`[PRACTITIONER]`. Full trailers run ~90–150s; teasers ~30s.

Shot list (120s): cold open `[0–15s]` → title-adjacent breath and silence
`[15–20s]` → introduction, 4–6 shots cut on bars `[20–45s]` → escalation, 8–12
shots, cut rate doubling `[45–80s]` → stopdown + held silence `[80–84s]` →
climax montage, cut on beats `[84–112s]` → title card `[112–117s]` → button /
stinger `[117–120s]`.

Editing rule from the same source: editors "latch onto any noun in a line of
dialogue, and try to find an image that will go with it" — connections can be
"INCREDIBLY LITERAL". That is a directly implementable dialogue→shot matcher.

### 4.5 Product ad / UGC

The only niche here with genuine first-party advertiser data.

- "90% of ad recall impact is captured within the first six seconds" (TikTok Creative Guide: Driving Brand Equity, 2020) `[PRIMARY, advertiser platform]` https://ads.tiktok.com/business/en/blog/creative-best-practices-top-performing-ads
- "ads showing the product on screen drive a 65% increase in brand affinity and 25% uplift in recall" (TikTok Marketing Science US SMB Creative Effectiveness Study 2021, Lumen) `[PRIMARY]` same URL
- "CTA cards ... lead to a 45% lift in recall and a 19% increase in likeability" (TikTok Marketing Science, Top-Performing BLS Creative Analysis 2020) `[PRIMARY]` same URL
- "88% of TikTok users" say sound is "vital to the TikTok experience" (Kantar, 2022) `[PRIMARY]` same URL — note this is in direct tension with the sound-off data in §2.1; the honest reading is that sound *adds* on TikTok while captions *insure* against sound-off.

Shot list (`SH`, 22s):
1. `[2s]` Problem, dramatised physically. Product **on screen** from frame 0 (the 65%/25% finding).
2. `[2s]` Name the problem in ≤8 words.
3. `[4s]` Product introduced in use, not in packaging.
4. `[5s]` The demonstration — one continuous take, no cuts, because cuts read as faked.
5. `[4s]` Result side-by-side with the problem state.
6. `[3s]` Proof beat: a number, a receipt, or a second person.
7. `[2s]` CTA card, action-oriented and specific.

Everything material must land inside 6 seconds. Refresh cadence claim: ads beyond
7–14 days see CPM rises and CTR declines, with 3–5 new variants per campaign per
week (https://www.demandcurve.com/playbooks/tiktok-ads-best-practices)
`[SECONDARY, unsourced]`.

### 4.6 Explainer / educational

Hook: H05 (absurd hypothetical) or H06 (consensus negation) — the two exemplars
in §2.3 with verified titles are both from this niche.

`LF` (12 min):
1. `[0–15s]` The question, posed over the single most striking image available.
2. `[15–30s]` Why the obvious answer is wrong. **Checkpoint ~70%.**
3. `[30s–3:00]` Build the mental model with one concrete analogy, physically shot.
4. `[3:00]` Re-hook: the experiment, the field trip, or the expert.
5. `[3:00–6:00]` Evidence, fastest cuts of the video.
6. `[6:00]` Re-hook: the complication that breaks the simple model.
7. `[6:00–11:00]` The real answer, with its caveats. Lull permitted.
8. `[11:00–12:00]` Payoff: answer the opening question in one sentence.
9. Abrupt cut.

Hard requirement: `informationWithheld` from the hook must be the thing answered
at step 8. An explainer that answers its title question at 0:45 has no structure
left.

### 4.7 Listicle

The list is a re-hook generator: every item boundary is a natural pattern
interrupt, which is why H07 (superlative) collapses into this format.

Rules: order items so the **second-best is first** and the best is last (the
open loop is "what beat that?"); number them on screen persistently (a passive
H22 counter); keep item durations *unequal* — equal-length items make the format
feel templated, which is both boring and the pattern §8 names as
ineligible ("templated storylines").

`LF` (10 items, 12 min): 0:00–0:30 hook + the promise of #1 → items 2–4 at ~45s
each → 3:00 re-hook: raise the stakes of the remaining list → items 5–7 at ~60s →
6:00 re-hook: reveal a rule change → items 8–9 at ~75s → #1 at 2:00 → abrupt end.

### 4.8 Story / narrative

Structural spine: Hoyos's Hook → Foreshadow → but/therefore Narrative → Twist
(§2.3 H16/H18) `[PRACTITIONER]`.

`SH` (36s):
1. `[1s]` In medias res: the character already in trouble. (H17)
2. `[2s]` Foreshadow the question the ending answers.
3. `[6s]` Complication A. Connective must be "but".
4. `[7s]` Consequence A. Connective must be "therefore".
5. `[7s]` Complication B, higher stakes.
6. `[7s]` The turn.
7. `[6s]` Twist payoff at maximum emotional intensity. Cut on the peak.

The generator should emit the connective explicitly per beat and reject any beat
pair joined additively.

### 4.9 Transformation / before-after

Hook: H24 (result-first) is near-mandatory — the "after" is the strongest frame
available and burying it wastes it.

`SH` (34s): after-state `[1s]` → before-state hard cut `[2s]` → the constraint
(time, money, tools) `[3s]` → process compressed, 4 beats of ~5s each with a
visible progress indicator `[20s]` → after-state again at full scale `[6s]` →
loop seam back to frame 1 `[2s]`.

Requirements: identical camera position, lens and lighting for before and after —
the cut only reads if everything except the subject is constant. This is a
continuity constraint the shot planner must enforce, not a suggestion.

### 4.10 Day-in-the-life

Weakest retention structure of the twelve, because it has no inherent open loop.
It must borrow one.

Fixes: (a) impose an external constraint that can fail (H01), (b) put a visible
clock on screen from frame 0 (H22), (c) flash-forward to the day's worst moment
in the cold open (H24).

`LF` (11 min): flash-forward to the crisis `[0–20s]` → "how did I get here",
clock starts `[20–30s]` → morning compressed hard, never real-time `[30s–2:30]` →
3:00 re-hook: the first thing that goes wrong → 3:00–6:00 the actual work,
densest block → 6:00 re-hook: the crisis from the cold open, now in context →
resolution and the day's outcome → abrupt end.

**Policy note:** this format is the highest-risk for the inauthentic-content rule
if serialised. YouTube names "characters ... put in the same situation over and
over again with the same outcome" as ineligible. Each instalment needs a
materially different premise, not just a different date.

### 4.11 Reaction / commentary

The niche with the most explicit policy boundary, so encode the boundary first.

**Allowed:** "Reaction videos where you comment on the original video"; "Using
clips for a critical review". **Not allowed:** "Clips of moments from your
favorite show edited together with little or no narrative"; content "copied from
another online source without any substantive modifications"
(https://support.google.com/youtube/answer/1311392?hl=en) `[PRIMARY]`.

Structure (`LF`, exemplar format: https://www.youtube.com/watch?v=DJ92uAZ-dVs
`[TITLE-VERIFIED]`):
1. `[0–15s]` The clip, cold, no reactor on screen.
2. `[15–30s]` The reactor's credential and the specific claim they will make about it.
3. Per segment: clip `[20–40s]` → pause → analysis `[40–90s]` → verdict `[10s]`.
4. Re-hooks at ~3:00 and ~6:00 land on segment boundaries with the strongest clips.
5. Payoff: the ranking, the verdict, or the thing the expert would have done.

Enforceable gate: `commentary_seconds / total_seconds` must exceed a configured
floor before export. This is gate G7 in §8.3.

### 4.12 Tutorial

Distinct from explainer: the viewer arrives with intent, so the curiosity gap is
weak and *completion* is the goal. Front-load capability, not mystery.

`SH` (30s):
1. `[1s]` The finished result.
2. `[2s]` "In 30 seconds, no [expensive thing]."
3. `[6s]` Step 1, hands only, single take.
4. `[6s]` Step 2.
5. `[6s]` Step 3.
6. `[5s]` The mistake everyone makes, shown failing.
7. `[4s]` Result again. Loop to frame 1.

`LF`: add a materials/prerequisites beat before step 1, put the common-failure
beat at ~3:00 as re-hook 1, and a variation or advanced case at ~6:00 as re-hook
2. Steps get chapter markers — chapters are the tutorial's re-hook mechanism,
since YouTube reports Dips at skipped moments
(https://support.google.com/youtube/answer/9314415) and tutorial viewers skip
deliberately rather than leaving.

Caption requirement is stricter here than anywhere else: every step must be
legible sound-off, because tutorials are frequently watched with hands busy and
audio off.

---

## 5. Title and thumbnail patterns

### 5.1 The one hard constraint

**Optimise packaging for watch time, not clicks.** YouTube's own A/B tool
selects the winning title+thumbnail on "overall watch time over other metrics,
like click-through-rate" ([PRIMARY]
https://support.google.com/youtube/answer/13861714?hl=en). YouTube's Creator
Liaison Rene Ritchie stated the reason directly: "If you over-index on CTR, it
could become click-bait, which could tank retention" ([SECONDARY, direct quote]
https://www.searchenginejournal.com/do-faces-help-youtube-thumbnails-heres-what-the-data-says/563944/).

A generator that scores candidate titles on predicted CTR is optimising the
wrong objective. Score on *promise-payoff consistency*: the title must be a
claim the video actually delivers, because the delivery is what produces watch
time.

### 5.2 Thumbnail specification (current, official)

The commonly cited "1280x720, 2 MB" spec is now legacy. The live help page
specifies:

| Property | Value | Source |
| --- | --- | --- |
| Recommended resolution | 3840 x 2160 (video), 2160 x 3840 (Shorts) | [PRIMARY] https://support.google.com/youtube/answer/72431?hl=en |
| Minimum | 640 px width (video), 640 px height (Shorts) | same |
| Aspect ratio | 16:9 video, 9:16 Shorts, 1:1 podcast playlist | same |
| Formats | JPG or PNG (GIF no longer listed) | same |
| File size | 50 MB desktop upload; 2 MB mobile upload; 10 MB podcast on mobile | same |

### 5.3 The one large real dataset, and what it contradicts

1of10 analysed 300,000+ high-performing 2025 videos across ~52,000 channels
(62.6B views). It is **correlational, not causal** — high-performing videos are
a selected sample — but it is the only large dataset found, and it contradicts
several of the most-repeated rules.

| Finding | Direction | Source |
| --- | --- | --- |
| Titles ≤30 characters got ~60% more views than titles near 70 | shorter wins | [MEASURED, correlational] https://1of10.com/blog/what-actually-makes-a-youtube-video-go-viral-in-2025/ |
| 5-word titles have the highest median engagement; decline after 6 words | 5 words | same |
| 35% of titles contain numbers; titles with numbers averaged ~11% **fewer** views | numbers hurt | same |
| Only 11% of titles are negative-sentiment, but they got ~22% more views | negativity wins | same |
| 84% of thumbnails contain text; text thumbnails got ~19% **fewer** views | less text | same |
| Best-performing thumbnail text: **under 10 characters, covering under 7% of image area** | tiny text | same |
| Cyan thumbnails earned ~36% more views than average; peak brightness band 100–110 | colour | same |
| Faces only meaningfully helped channels above 200K subscribers; face vs no-face otherwise "perform similarly"; multi-face beat single-face; direction varies by niche | faces overrated | same + SEJ URL above |

**Actively refuted.** The widely circulated "faces boost CTR 2.3x / 62% / 38%"
cluster traces to sourceless AI-content blogs
(https://blog.bananathumbnail.com/thumbnail-psychology-7/,
https://thumbnailtest.com/guides/face-in-youtube-thumbnail/) with no linked
study, sample or method. **Do not encode those numbers.** The "numbers in titles
boost CTR 20–30%" claim (https://humbleandbrag.com/blog/best-youtube-titles) is
likewise unsourced and is contradicted by the dataset above.

Similarly, the third-party thumbnail A/B deltas of "+47% surprised face, +32%
text hook, +28% clean background" (bananathumbnail.com) give no channel, sample
or duration and are `UNVERIFIED`. A more plausible practitioner datapoint from
the same page: dozens of tests over months yielding a **3–7% CTR bump on 3 of 4
videos**. Encode that order of magnitude, not the former.

### 5.4 Encodable title formulas

These are pattern templates, each with a slot schema. They are `[PRACTITIONER]`
unless marked; use them as generators, and let Test & Compare pick.

| # | Formula | Slot schema | Notes |
| --- | --- | --- | --- |
| T1 | `I <verb> <extreme quantity> <noun>` | verb, quantity, noun | "I Spent 50 Hours In Solitary Confinement" (verified: https://www.youtube.com/watch?v=r7zJ8srwwjk) |
| T2 | `$<amount> <familiar thing> In Real Life` | amount, referent | "$456,000 Squid Game In Real Life!" (verified: https://www.youtube.com/watch?v=0e3GPea1Tyg) |
| T3 | `Why <surprising negation>` | negated claim | "Why No One Has Measured The Speed Of Light" (verified: https://www.youtube.com/watch?v=pTn6Ewhb27k) |
| T4 | `What Happens If <absurd premise>?` | premise | "What Happens If We Throw an Elephant From a Skyscraper?" (verified: https://www.youtube.com/watch?v=f7KSfjv4Oq0) |
| T5 | `The <superlative> <category> <in scope>` | superlative, category, scope | "The Most Radioactive Places on Earth" (verified: https://www.youtube.com/watch?v=TRL7o2kPqw0) |
| T6 | `<Antagonist> vs <Device/Trap>` | two named parties | "Glitter Bomb 1.0 vs Porch Pirates" (verified: https://www.youtube.com/watch?v=xoxhDk-hwuo) |
| T7 | `<Action> <Outcome> (<parenthetical escalation>)` | action, outcome, twist | "Glitterbomb Trap Catches Phone Scammer (who gets arrested)" (verified: https://www.youtube.com/watch?v=VrKW58MS12g) |
| T8 | `<Imperative>` (2–4 words, no context) | imperative | "DO WHAT YOU CAN'T" (verified: https://www.youtube.com/watch?v=jG7dSXcfVqE) |
| T9 | `<Craft/Process>: <Artifact>` | craft, artifact | "Primitive Technology: Tiled Roof Hut" (verified: https://www.youtube.com/watch?v=P73REgj-3UE) |
| T10 | `<Expert group> React to <Subject> <serial number>` | group, subject, index | "VFX Artists React to Bad & Great CGi 240 Ft. Richard Taylor" (verified: https://www.youtube.com/watch?v=DJ92uAZ-dVs) — note serialisation is the retention device |

**Generator constraints derived from the dataset:** target 5 words and ≤30
characters where the format allows; do not auto-insert digits for their own
sake; allow negative-valence framing; never let the title promise something the
script does not deliver.

**No published number found for:** second-person "you" in titles, ALL-CAPS word
usage, emoji in titles, "I did X for Y days" as a format. Do not encode a number
for these.

### 5.5 Thumbnail composition rules

| Rule | Value | Tier | Source |
| --- | --- | --- | --- |
| Text length | under 10 characters, under 7% of image area | [MEASURED] | 1of10 URL above |
| Word count (competing advice) | 2–5 words; 1–3 for Shorts; 6+ "almost always underperform" | [PRACTITIONER, no data] | https://miraflow.ai/blog/how-many-words-youtube-thumbnail-2026 |
| Text height | ≥10–15% of thumbnail height (72–108 px on a 1280x720) | [PRACTITIONER] | same |
| Element count | face + one key object + short text, max | [PRACTITIONER] | https://www.thumbnailcreator.com/blog/thumbnail-composition-guide |
| Render size to design against | ~160 px wide mobile home feed; 240–360 px desktop | [PRACTITIONER] | miraflow URL above |
| Colour | cyan over-indexes; brightness band 100–110 | [MEASURED, correlational] | 1of10 URL above |

`No published number found` for rule-of-thirds effect, saturation targets, or
thumbnail↔title non-redundancy. The non-redundancy advice is real and widely
repeated but unquantified anywhere I could reach.

---

## 6. Caption and subtitle specification

Two separate standards apply and they conflict. **Accessibility standards**
(Netflix, BBC) are slow and conservative. **Short-form retention practice** is
fast and aggressive. A studio should implement both and switch by target.

### 6.1 Accessibility-grade (use for long-form, and as the safety floor)

| Parameter | Value | Source |
| --- | --- | --- |
| Max chars per line | 42 | [MEASURED] https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-Timed-Text-Style-Guide |
| Reading speed, English adult | 20 CPS | same |
| Reading speed, English children | 17 CPS | same |
| Reading speed, Spanish adult | 17 CPS (13 children) | [MEASURED] https://partnerhelp.netflixstudios.com/hc/en-us/articles/217349997-Spanish-Latin-America-Spain-Timed-Text-Style-Guide |
| Min cue duration | 5/6 second (20 frames at 24 fps) | [MEASURED] https://partnerhelp.netflixstudios.com/hc/en-us/articles/215758617-Timed-Text-Style-Guide-General-Requirements |
| Max cue duration | 7 seconds | same |
| Max lines | 2 | same |
| Justification/position | centre justified, top or bottom of frame | same |
| Reading speed (BBC) | 160–180 WPM ≈ 0.33–0.375 s/word | [MEASURED] https://www.clevercast.com/bbc-subtitling-guidelines/ |
| Line width (BBC) | 68% of frame width at 16:9; 90% at 4:3 | same |
| Min on-screen time (BBC) | ~0.3 s per word (1.2 s for a 4-word cue) | same |
| Min gap between cues (BBC) | 1.5 seconds | same |
| Safe area (BBC) | central 90% vertical, central 75% horizontal | same |

**Correction worth carrying:** the popular shorthand "Netflix = 17 CPS" is
wrong for English. 20 CPS is English adult; 17 CPS is English *children's* and
Spanish adult. CPS is language-dependent — encode per-locale.

180 WPM ≈ 15 CPS in English
([MEASURED conversion] https://www.closedcaptioncreator.com/blog/articles/subtitle-reading-speed.html),
so BBC is materially more conservative than Netflix.

### 6.2 Short-form retention-grade (use for Shorts/Reels/TikTok)

| Parameter | Value | Tier | Source |
| --- | --- | --- | --- |
| Words per cue | 5–8 ideal, 8–12 max | [VENDOR] | https://www.opus.pro/blog/best-caption-presets-styles-boost-retention |
| Cue duration | 1.5–3 s | [VENDOR] | same |
| Lead-in | caption appears 100–200 ms **before** the audio | [VENDOR] | same |
| Gap between cues | 150–250 ms (vs BBC's 1500 ms) | [VENDOR] | same |
| Contrast ratio | ≥4.5:1 | [VENDOR] | same |
| Karaoke highlight timing | each word highlights **50–100 ms before it is spoken**; white → yellow or brand accent | [VENDOR] | same |
| Emoji | max one per caption line | [VENDOR] | same |
| "Bold Statement" preset | 60–80 pt, Montserrat Bold / Bebas Neue / Impact, upper or centre third | [VENDOR] | same |
| "Minimal Clean" preset | 40–50 pt, Helvetica Neue or Lato, subtle drop shadow | [VENDOR] | same |
| Hormozi style | 1–3 ALL-CAPS words at a time, 80 px+ | [PRACTITIONER] | https://ascynd.io/en/blog/why-hormozi-captions-get-more-views |
| Shorts placement | avoid top ~20% (title/channel chrome) and bottom ~25% (like/comment/share rail); 32–42 chars ≈ 5–7 words per line; white on black box at 60–80% opacity | [VENDOR] | https://www.opus.pro/blog/youtube-shorts-caption-subtitle-best-practices |

**Font popularity, not font performance.** Submagic's histogram over 2,000,000
videos: Montserrat 61%, Rubik 7.94%, Fira Sans Condensed 6.50%, Gabarito 6.25%,
Poppins 5.05%; Impact, The Bold Font, Shrikhand, CocoGoose each under 1.5%
([VENDOR] https://www.submagic.co/blog/best-font-for-subtitle). This measures
what creators *use*, not what performs. It is still the right default: matching
the platform's visual dialect is cheap and low-risk.

### 6.3 Safe-area: the honest state of the evidence

There is **no official Google Shorts safe-zone template** I could reach. Three
third-party maps disagree:

- 900 × 1160 centred; 90 px sides; 380 px top and bottom — https://youtubetoolkit.com/blog/youtube-shorts-dimensions
- 840 × 960 starting 288 px from top, 48 px left — cited to a "Google vertical safe zone PNG"
- central 4:5 (≈1080 × 1440), avoid bottom 10–15% — https://kreatli.com/guides/safe-zone-guide

**Recommendation: encode the conservative intersection** — on a 1080 × 1920
canvas, keep all critical text inside x ∈ [96, 984] and y ∈ [384, 1536], and
flag the constraint as inferred, not official. TikTok and Reels margins from the
same Kreatli source (`[PRACTITIONER]`, self-described as conservative): TikTok
~130 px top, ~250 px bottom, ~60 px sides; Reels ~108 px top, ~320 px bottom,
~60 px sides.

### 6.4 Why captions at all — the real evidence

- Verizon Media + Publicis Media surveyed 5,616 US adults 18–54 in April 2019:
  "80% say they're more likely to watch an entire video with captions"; 80% of
  caption users have no hearing impairment; 69% watch sound-off in public, 25%
  sound-off in private ([MEASURED, survey of stated intent]
  https://www.3playmedia.com/blog/verizon-media-and-publicis-media-find-viewers-want-captions/,
  https://www.streamingmedia.com/Articles/ReadArticle.aspx?ArticleID=131860).
  Same study, ad effects with captions: +8% ad recall, +10% ad memory quality,
  +13% brand linkage.
- The famous "85% of video is watched sound-off" figure is **not a Facebook
  study**. It is a 2016 Digiday piece quoting publisher self-report, and
  PopSugar's own range in that piece was 50–80%
  ([PRACTITIONER, self-report] https://digiday.com/media/silent-world-facebook-video/).
  Cite the range, not the 85%.
- Vendor retention claims for burned-in captions are directionally consistent
  and numerically incoherent: the same vendor publishes "15–25% higher
  retention", "12–15% higher completion", and "12–40% watch-time increase"
  for the same effect
  (https://www.opus.pro/blog/ideal-youtube-shorts-length-format-retention,
  https://www.opus.pro/blog/tiktok-caption-subtitle-best-practices).
  **Treat the direction as real and the magnitude as unsupported.**

---

## 7. Audio specification

### 7.1 Loudness

| Target | Value | Tier | Source |
| --- | --- | --- | --- |
| YouTube playback normalisation | −14 LUFS integrated (since ~2019) | [PRACTITIONER / reverse-engineered — **not official**] | https://productionadvice.co.uk/youtube-loudness/ |
| YouTube's own published audio spec | AAC in MP4, "Audio bitrate: 128 kbps or better"; 64 kbps floor for lossy | [PRIMARY] | https://support.google.com/youtube/answer/4603579?hl=en |
| Spotify | −14 LUFS / −1 dBTP (−2 recommended) | [VENDOR, Spotify does publish] | https://www.forasoft.com/learn/audio-for-video/articles-audio/lufs-targets-per-platform-2026 |
| Apple Music | −16 LUFS / −1 dBTP | [VENDOR] | same |
| EBU R128 (broadcast) | −23 LUFS ±0.5, −1 dBTP ceiling | [MEASURED, published standard] | https://www.production-expert.com/production-expert-1/what-is-loudness-lufs-lkfs-and-delivery-specs-explained-2026 |
| ATSC A/85 (US broadcast, CALM Act) | −24 LKFS, −2 dBTP, dialogue-anchored | [MEASURED, published standard] | same |
| Netflix cinematic | −27 LKFS dialog-gated ±2, −2 dBTP | [VENDOR citing Netflix] | forasoft URL above |
| Practical creator delivery | peaks ~−6 dB, dialogue averaging ~−16 LUFS | [PRACTITIONER] | https://www.descript.com/blog/article/how-to-set-the-perfect-audio-levels-for-video |

**The asymmetry that matters.** YouTube only turns content *down*, never up:
"Quieter songs are not being boosted — 'Loud' songs are being turned down"
([PRACTITIONER] https://productionadvice.co.uk/youtube-loudness-normalisation-details/).
Delivering below −14 LUFS therefore means playing back permanently quieter than
everything around you. **Master to −14 LUFS integrated, −1 dBTP.**

**Ground-truth measurement, per video, free.** Right-click the player → "Stats
for nerds" → the `Volume / Normalized` line reports content loudness in dB. A
positive content-loudness value means YouTube is attenuating you; negative means
it is not normalising
([MEASURED, directly observable] https://productionadvice.co.uk/stats-for-nerds/).
This is the only honest verification loop available and should be a post-publish
check in any studio pipeline.

**Verified absence:** TikTok, Instagram, Meta, X and Twitch publish **no**
official LUFS target ([MEASURED absence] forasoft URL above). Any −10/−12/−13
figure for those platforms is an estimate. Do not encode one as authoritative.
YouTube also publishes a bitrate floor but no loudness target — that asymmetry
is itself the finding.

### 7.2 Music, ducking and cut rhythm

**Ducking depth is genuinely contested.** Recommendations found: 18–25 dB
(https://zellahq.com/blog/music-ducking-explained/), 15–25 dB, −12 dB for
dialogue-heavy, 6–10 dB for a natural result, and 6–12 dB with 30–80 ms attack /
250–700 ms release (https://openclip.app/learn/audio-ducking). All
`[PRACTITIONER]`. **If you must pick one default: 12 dB duck, 50 ms attack,
400 ms release** — that sits inside every cited range.

**BPM → timeline is exact arithmetic and fully encodable.** At 120 BPM a beat is
0.5 s and a four-beat bar is 2 s
([MEASURED] https://clipmusic.ai/blog/bpm-video-editing-guide). Generalised:
`beat_seconds = 60 / BPM`, `bar_seconds = 4 * 60 / BPM`. Cut placement
heuristic: "Cut on bars for calm pacing, on beats for intensity, and on the drop
for the moment that gets rewatched"
([PRACTITIONER] https://www.toolsforfilm.com/blog/bpm-and-picture-editors-guide).

### 7.3 SFX placement grid

| Cue | Placement rule | Tier | Source |
| --- | --- | --- | --- |
| Riser | starts 2–3 s **before** the reveal, resolves on the reveal frame | [PRACTITIONER] | https://esecut.com/blog/sound-effects-that-boost-engagement |
| Impact / stinger | on the reveal frame itself, aligned to a bar line | [PRACTITIONER] | toolsforfilm URL above |
| Whoosh | on transitions, 4–8 frames of pre-roll before the cut | [PRACTITIONER] | esecut URL above |
| Density ceiling | **3–5 significant SFX per video, maximum** — an effect on every cut "starts to feel chaotic rather than polished" | [PRACTITIONER] | esecut URL above |

### 7.4 Energy curve (encodable envelope)

The trailer-music three-act shape is the best-documented energy envelope and
transfers to short-form. Act I establishes tone (ambient, minimal); Act II builds
momentum with rhythm and rising tension; Act III peaks with full percussion and
melody; composers insert a "stopdown" — a big hit followed by a pause — to give
editors a natural cut point
([PRACTITIONER] https://www.rareformaudio.com/blog/how-production-music-reveals-trailer-structure,
https://www.nathanfieldsmusic.com/blog/three-act-structure-trailer-music).

Derek Lieu's governing rule for the whole envelope: **"If a trailer feels high
energy all the time, then none of it will feel high energy."**
([PRACTITIONER] https://www.derek-lieu.com/blog/2017/9/10/the-matrix-is-a-trailer-editors-dream).
Encode this as a hard constraint: any generated energy curve must contain at
least one deliberate trough before its peak, or the peak does not read as a peak.

**Silence.** `No published number found.` I could not locate a dataset, A/B
test, or even a practitioner heuristic with a duration attached for deliberate
silence as a retention device. Do not encode a silence duration as evidence-based;
if the studio uses one, mark it as a design choice.

---

## 8. What fails, what gets suppressed

This is the section with the strongest primary sourcing, and the one most worth
implementing as hard gates rather than warnings.

### 8.1 Two distinct enforcement surfaces

Most coverage conflates them. They are different penalties with different
severity.

**Surface A — monetization (demonetization risk).** YouTube channel monetization
policies, https://support.google.com/youtube/answer/1311392?hl=en. On
**15 July 2025** the "repetitious content" policy was renamed **"inauthentic
content"**: "We're making a minor update to our 'repetitious content' policy...
to better clarify this includes content that is repetitive or mass-produced."

Exact ineligible patterns named on that page:

- "Similar or repetitive content with low educational value, commentary, narratives, or minimal variation"
- "characters are put in the same situation over and over again with the same outcome"
- "Image slideshows, templated storylines, or scrolling text with minimal or no narrative"
- **"AI-generated content made with generic or unoriginal templates giving the impression of mass production"**
- Reused: "Content downloaded or copied from another online source without any substantive modifications"
- Reused: "Clips of moments from your favorite show edited together with little or no narrative"
- "Songs modified to change the pitch or speed, but are otherwise identical to the original"
- "An AI 'doctor' providing medical diagnoses, health advice, or wellness remedies."

The stated compliance test: **"the substance of each video should be materially
varied and deliver creative, educational, or other value."** Top-level
requirement: "Be your original creation" and "Not be mass-produced, generic,
repetitive, or manipulative."

Explicitly still allowed and monetizable: "Reaction videos where you comment on
the original video" and "Using clips for a critical review". YouTube's Creator
Liaison clarified that reused/repurposed content "can continue to be monetized
if you've added significant original commentary, modifications, or educational or
entertainment value to the original video", and that "channels that use AI in
their content remain eligible for monetization"
([SECONDARY, quoting YouTube]
https://www.socialmediatoday.com/news/youtube-clarifies-monetization-update-inauthentic-repeated-content/752892/).

**Surface B — spam / deceptive practices (removal risk, not just
demonetization).** https://support.google.com/youtube/answer/2801973?hl=en. This
is the one most AI-video coverage misses. It prohibits:

- **"Using automated tools or AI to churn out high volumes of similar content with minimal changes"**
- "the exact same background music and repetitive AI generated imagery across many videos"
- "Re-posting material from other websites or platforms ... without adding anything of your own"
- "Repetitive or templated content aimed at artificially inflating engagement through bots, coercion, or offering rewards"

With an explicit carve-out: "testing out new creation tools or posting a few
variations of a video is ok."

**Engineering consequence.** A local AI video studio that ships a one-click
"generate 20 variants and upload them" mode is building a spam-policy violation
generator, not a growth feature. The safe design is **one project, one distinct
premise, materially varied substance**, with batch generation confined to
*drafts for one video*, never to *many published videos*.

**Surface C — Shorts monetization specifically.**
https://support.google.com/youtube/answer/12504220?hl=en names as ineligible:
"Non-original Shorts, such as unedited clips from others' movies or TV shows",
"compilations with no original content added", and "Artificial or fake views of
Shorts, such as from automated click or scroll bots". (Note this page still uses
the pre-rename term "repetitious".)

### 8.2 AI disclosure

Disclosure is required when generated or meaningfully altered content **appears
realistic** ([PRIMARY]
https://support.google.com/youtube/answer/14328491?hl=en). The three triggers,
verbatim:

1. "Makes a real person appear to say or do something they didn't do."
2. "Alters footage of a real event or place."
3. "Generates a realistic scene that didn't actually occur."

Exempt: "Applying beauty filters, Color adjustment or lighting filters, Special
effects filters", "Video sharpening, upscaling or repair", and "Cloning one's own
voice to create voice overs or dubs". Fully animated / clearly unreal content is
also exempt.

Label placement: photorealistic content gets "a label in the video player";
non-photorealistic gets a label "in the expanded description". Sensitive topics
escalate: "like health, news, elections, or finance — we'll also show a more
prominent label" ([PRIMARY] https://blog.youtube/news-and-events/disclosing-ai-generated-content/,
18 Mar 2024, defining the threshold as "content a viewer could easily mistake for
a real person, place, scene, or event").

Non-disclosure consequences, verbatim: "manual application of a label, or
penalties from YouTube, including removal of content or suspension".

Labelling is not a shield: "some synthetic media, regardless of whether it's
labeled, will be removed"
([PRIMARY] https://blog.youtube/inside-youtube/our-approach-to-responsible-ai-innovation/).

Restated by YouTube's CEO in Jan 2026: "creators must disclose when they've
created realistic altered or synthetic content", and enforcement is framed as an
extension of existing anti-spam systems — "we're actively building on our
established systems that have been very successful in combatting spam and
clickbait" ([PRIMARY] https://blog.youtube/inside-youtube/the-future-of-youtube-2026/).

### 8.3 Hard gates a studio should implement

| Gate | Rule | Backed by |
| --- | --- | --- |
| G1 | Refuse batch-publish of >1 video sharing a template, script skeleton, music bed, or image style | spam policy, "churn out high volumes of similar content with minimal changes" |
| G2 | Require a distinct premise string per project, and diff it against prior projects | monetization policy, "materially varied" |
| G3 | Block export of any project whose only content is stock/scraped media + TTS over slideshow | "Image slideshows, templated storylines, or scrolling text with minimal or no narrative" |
| G4 | Force an AI-disclosure decision at export, with the three trigger questions asked verbatim | disclosure policy triggers |
| G5 | Keep provenance per asset (generated / imported / upscaled / licensed) and surface it in the export manifest | reused-content policy; disclosure exemption for upscaling |
| G6 | Block "AI expert persona" templates in health/finance/legal | "An AI 'doctor' providing medical diagnoses" |
| G7 | For commentary/reaction templates, require the user's own commentary track to exceed a minimum share of runtime before allowing export | "significant original commentary" |

### 8.4 What does *not* fail

- Using AI tools is explicitly fine. Monetization eligibility survives AI use.
- Reaction, commentary, critical review and clip use with added value are named
  as allowed.
- Experimenting with formats does not harm the channel: "Experimenting with new
  content formats ... will not inherently confuse the algorithm" ([PRIMARY]
  https://support.google.com/youtube/answer/16559651?hl=en).
- A single underperforming video does not penalise the channel: "An individual
  video's underperformance does not penalize a channel overall" (same URL).
- Monetization status is not a ranking input: the system "does not prioritize
  videos based on whether they are monetized" (same URL).

---

## 9. Contradictions register

Where good sources disagree, a template generator must not silently pick one.
These are the live conflicts.

| # | Conflict | Sources | Recommended handling |
| --- | --- | --- | --- |
| C1 | Shorts optimal length: 50–60s vs 34–43s vs under 30s | Galloway 5,400-Short study vs Colin & Samir channel data vs Adobe survey of *opinion* | Default 34–43s. Sub-30s only with a built-in loop. Expose as a tunable, not a constant. |
| C2 | Numbers in titles: +20–30% CTR vs −11% views | humbleandbrag (unsourced) vs 1of10 300k-video dataset | Trust the dataset. Do not auto-insert digits. |
| C3 | Faces in thumbnails: +38–62% CTR vs "perform similarly" | bananathumbnail / thumbnailtest (both sourceless) vs 1of10 dataset | Trust the dataset. Faces help mainly above 200K subs. |
| C4 | Text on thumbnails: universal advice to add it vs −19% views | practitioner consensus vs 1of10 dataset | Allow text but cap hard: under 10 characters, under 7% of frame. |
| C5 | Caption reading speed: 160–180 WPM vs 200–250 WPM | BBC accessibility standard vs OpusClip short-form | Two profiles. Accessibility profile for long-form; aggressive profile for Shorts, with a warning. |
| C6 | Netflix CPS: 17 vs 20 | English-adult 20, English-children 17, Spanish-adult 17 | Per-locale table, never one global constant. |
| C7 | Music duck depth: 6 dB to 25 dB | five practitioner sources | Default 12 dB / 50 ms attack / 400 ms release (inside every range). |
| C8 | Sound matters (88% of TikTok users) vs 50–80% watch sound-off | TikTok/Kantar vs Digiday publisher self-report | Both. Design sound-on as upside, captions as insurance. |
| C9 | Shorts view counting: Mar 2025 vs Aug 2026 | two separate official changes | Both are real. 31 Mar 2025 = Shorts count on play; 24 Aug 2026 = all formats count on play. |
| C10 | "Views" vs "engaged views" vs "qualified views" | YouTube's own docs use all three for different purposes | Never treat as synonyms. Views ≠ earnings ≠ eligibility. |

---

## 10. Open gaps — what this research could not close

Stated plainly rather than filled with plausible numbers.

1. **Frame-level hook observation.** No video's opening frames were watched. All
   hook attributions in §2 rest on title, format and third-party description.
   Closing this needs actual playback, ideally with a frame sampler.
2. **Creator Insider / Rene Ritchie primary statements.** The support.google.com
   Creator Insider community-video pages returned only navigation chrome. The one
   attributable Ritchie quote in this document comes via Search Engine Journal,
   not from a first-party page.
3. **Shorts feed ranking weights.** YouTube publishes none. The only official
   Shorts-feed ranking statement found is that it "may tune up on the recency of
   content". Every specific weighting circulating online is third-party inference.
4. **The "initial seconds" threshold for an engaged view.** YouTube defines the
   metric but publishes no second count. Nothing found.
5. **Official Shorts safe-zone template.** None found. Three third-party maps
   disagree; §6.3 recommends the conservative intersection and flags it as
   inferred.
6. **Official YouTube loudness target.** None published. The −14 LUFS figure is
   reverse-engineered and its own author calls it "research and speculation".
7. **Deliberate silence as a retention device.** No dataset, no A/B test, no
   practitioner heuristic with a duration attached. Nothing found.
8. **Jenny Hoyos specifics I was asked for and could not source:** a "read the
   first line" caption rule (found in no source), a "no dead air" rule phrased
   that way (the real thing is the per-second arithmetic in §3.1), and any
   sentence-length or word-count rule (only reading level is sourced). Her
   claimed retention *graph shape* is likewise never described in any primary
   source I reached — she gives point metrics, not a curve.
9. **Named Jenny Hoyos example videos.** No verifiable URLs. The often-cited
   "What does $1 get you at Starbucks?" appears only in a vidIQ page that
   returned HTTP 429 on five attempts. No URL was constructed.
10. **Johnny Harris / Veritasium act-structure breakdowns, Think Media, Spotter
    Studio, ThoughtLeaders, Nathan Allebach.** Not reached before the session's
    200-call web-search budget ran out. No findings, invented or otherwise.
11. **Animation/anime short retention data.** None found, at all. §4.3 is
    entirely derived design.
12. **Business Insider's original MrBeast-doc verification.** businessinsider.com
    is not fetchable in this environment. The authenticity claim rests on Fortune
    quoting BI.

**Sources actively rejected during this research** (recorded so they are not
re-ingested later): `finallayer.com` Jenny Hoyos claims ("no more than three
objects in frame", "pattern interrupts at exactly 15 seconds", "real problems
perform 300% better") — none appear in any primary Hoyos source and the page
reads as AI-generated elaboration; `optinformarketing.substack.com` ("within the
first 0.2 seconds"); `blog.bananathumbnail.com` thumbnail-psychology numbers;
`increditors.com` per-niche cut-frequency table; `thumbnailtest.com` face-CTR
assertion. All sourceless.

---

## 11. Implementation checklist for the studio

Ordered by leverage. Each line traces to a section above.

**Must implement (evidence is strong and the rule is cheap):**

- [ ] Reading-grade gate on every hook line, reject above grade 5 (§2.3 H32).
- [ ] Mute-legibility gate: reject any hook whose meaning requires audio (§2.3 H31).
- [ ] Tail-trim pass: after render, cut every frame after the emotional peak (§3.1).
- [ ] Additive-connective linter: reject "and then" beat joins, require but/therefore (§2.3 H18).
- [ ] Banned-opener filter: strip greetings, logos and leading discourse markers (§2.3 H17).
- [ ] Shorts default duration 34–43s; sub-30s forces loop construction (§3.1).
- [ ] Long-form re-hook markers at ~3:00 and ~6:00, surfaced on the timeline with their minute-mark role (§3.2).
- [ ] `informationWithheld` must be non-null and must map to a payoff beat index (§2.2).
- [ ] Policy gates G1–G7 (§8.3), enforced at export, not as warnings.
- [ ] AI-disclosure decision at export using the three verbatim trigger questions (§8.2).
- [ ] Master to −14 LUFS integrated, −1 dBTP; verify post-publish via Stats for nerds (§7.1).
- [ ] Caption safe area: on 1080×1920, text inside x ∈ [96, 984], y ∈ [384, 1536] (§6.3).
- [ ] Two caption profiles: accessibility (BBC/Netflix timings) and short-form (§6).

**Should implement (evidence is directional):**

- [ ] Thumbnail text cap: under 10 characters, under 7% of frame area (§5.5).
- [ ] Title generator targets 5 words / ≤30 characters, no auto-inserted digits (§5.4).
- [ ] Pattern-interrupt cadence of one new visual state every 3–5s in Shorts (§3.1).
- [ ] SFX density cap of 3–5 significant effects per video (§7.3).
- [ ] Energy curve must contain a trough before its peak (§7.4).
- [ ] BPM-locked cut grid: `beat = 60/BPM`, cut on bars for calm, beats for intensity, drop for the rewatch moment (§7.2).
- [ ] Music duck default 12 dB / 50 ms / 400 ms (§7.2).

**Must not implement:**

- [ ] Any "generate N variants and publish them" batch mode (§8.1, spam policy).
- [ ] CTR-maximising packaging optimiser (§5.1 — YouTube optimises watch time).
- [ ] Hard-coded face/number/text thumbnail heuristics from the sourceless blogs (§5.3).
- [ ] A retention-benchmark scoring model built on the circulating APV tables (§3.2 — no sound benchmark exists).
- [ ] A silence-duration rule presented as evidence-based (§7.4 — none found).

---

## 12. Source index

**Primary — YouTube / Google**
- Channel monetization policies (inauthentic, reused): https://support.google.com/youtube/answer/1311392?hl=en
- Spam & deceptive practices (AI mass-production removal risk): https://support.google.com/youtube/answer/2801973?hl=en
- Shorts monetization: https://support.google.com/youtube/answer/12504220?hl=en
- Audience retention report (Intro / Top moments / Spikes / Dips): https://support.google.com/youtube/answer/9314415?hl=en
- Studio metric definitions (engaged views, stayed to watch, APV): https://support.google.com/youtube/answer/12220281?hl=en
- Shorts metrics (shown in feed, viewed vs swiped away): https://support.google.com/youtube/answer/12942217?hl=en
- View counting change (Aug 2026, all formats): https://support.google.com/youtube/answer/2991785?hl=en
- Create Shorts (3-minute cap, 1080p, Mar 2025 view counting): https://support.google.com/youtube/answer/10059070?hl=en
- Mid-roll ads (8-minute threshold, natural breakpoints): https://support.google.com/youtube/answer/6175006
- Test & Compare (optimises watch time over CTR): https://support.google.com/youtube/answer/13861714?hl=en
- Thumbnail spec (3840×2160): https://support.google.com/youtube/answer/72431?hl=en
- Upload encoding spec (audio bitrate): https://support.google.com/youtube/answer/4603579?hl=en
- Recommendation system: https://support.google.com/youtube/answer/141805?hl=en
- Algorithm FAQ (no ideal length, format experimentation): https://support.google.com/youtube/answer/16559651?hl=en
- Search ranking elements: https://support.google.com/youtube/answer/16090438
- AI disclosure requirement: https://support.google.com/youtube/answer/14328491?hl=en
- Analytics API metric definitions (relative/absolute retention, loop exclusion): https://developers.google.com/youtube/analytics/metrics
- Shorts deep dive with Todd Sherman and Jenny Hoyos: https://blog.youtube/creator-and-artist-stories/youtube-shorts-deep-dive/
- Disclosing AI-generated content: https://blog.youtube/news-and-events/disclosing-ai-generated-content/
- Responsible AI innovation: https://blog.youtube/inside-youtube/our-approach-to-responsible-ai-innovation/
- The future of YouTube 2026 (CEO letter): https://blog.youtube/inside-youtube/the-future-of-youtube-2026/

**Primary — other platforms**
- TikTok creative best practices (6-second recall, product-on-screen, CTA cards): https://ads.tiktok.com/business/en/blog/creative-best-practices-top-performing-ads
- Netflix English Timed Text Style Guide: https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-Timed-Text-Style-Guide
- Netflix Spanish TTSG: https://partnerhelp.netflixstudios.com/hc/en-us/articles/217349997-Spanish-Latin-America-Spain-Timed-Text-Style-Guide
- Netflix general timed-text requirements: https://partnerhelp.netflixstudios.com/hc/en-us/articles/215758617-Timed-Text-Style-Guide-General-Requirements

**Leaked document**
- How To Succeed In MrBeast Production (36 pp, read in full): https://cdn.prod.website-files.com/6623b7720b009050313e701c/66ede69453b7bbadcd2f05a8_How-To-Succeed-At-MrBeast-Production%20(2).pdf
- Authenticity reporting: https://fortune.com/2024/09/26/youtube-mrbeast-jimmy-donaldson-leaked-business-handbook-advice
- Provenance dispute: https://www.dexerto.com/youtube/leaked-mrbeast-pdf-reveals-youtubers-secrets-to-video-success-2900841/

**Studies and datasets**
- 1of10, 300,000+ videos / 62.6B views / 52,000 channels: https://1of10.com/blog/what-actually-makes-a-youtube-video-go-viral-in-2025/
- Galloway/Gileta, 5,400 Shorts / 33 channels / 3.3B views: https://news.thepublishpress.com/p/are-shorts-worth-it and https://www.linkedin.com/posts/paddy-galloway-459b8913a_we-studied-33-billion-views-to-decode-the-activity-7053697597592498176-PAkf
- Colin & Samir channel data, loops +143%: https://news.thepublishpress.com/p/shorts-powered
- Adobe Express, n=507 creators: https://www.adobe.com/express/learn/blog/youtube-shorts-length-study
- Metricool, 799,718 videos / 71,177 accounts: https://metricool.com/press-release-youtube-study-2026/
- arXiv 2402.18208v2, 250 creators / 171,320 videos: https://arxiv.org/html/2402.18208v2
- Wistia, 13M videos / 79M hours: https://wistia.com/blog/video-marketing-statistics and https://wistia.com/blog/optimal-video-length
- Verizon Media + Publicis, n=5,616: https://www.3playmedia.com/blog/verizon-media-and-publicis-media-find-viewers-want-captions/
- Submagic font histogram, 2M videos: https://www.submagic.co/blog/best-font-for-subtitle

**Practitioner**
- Jenny Hoyos on Creator Science #167: https://podcast.creatorscience.com/jenny-hoyos/
- Jenny Hoyos playbook: https://www.marketingexamined.com/blog/jenny-hoyos-short-form-video-playbook
- Jenny Hoyos script via Jay Clouse: https://www.linkedin.com/posts/jayclouse_jenny-hoyos-gave-me-her-exact-script-that-activity-7262878750684459010-NIZu
- Jenny Hoyos TEDNext 2024: https://www.ted.com/talks/jenny_hoyos_the_secret_to_telling_a_great_story_in_less_than_60_seconds
- Paddy Galloway on Creator Science: https://podcast.creatorscience.com/paddy-galloway/ and https://podcast.creatorscience.com/paddy-galloway-2/
- Paddy Galloway via Colin & Samir: https://www.colinandsamir.com/resources/the-new-rules-of-youtube-from-paddy-galloway
- Colin & Samir playbook (Stop, Hook, Payoff): https://www.colinandsamir.com/playbook
- Derek Lieu on trailer structure: https://www.derek-lieu.com/blog/2017/9/10/the-matrix-is-a-trailer-editors-dream
- Trailer music three-act: https://www.rareformaudio.com/blog/how-production-music-reveals-trailer-structure
- Ian Shepherd on YouTube loudness: https://productionadvice.co.uk/youtube-loudness/ and https://productionadvice.co.uk/stats-for-nerds/
- Rene Ritchie on CTR vs clickbait (via SEJ): https://www.searchenginejournal.com/do-faces-help-youtube-thumbnails-heres-what-the-data-says/563944/
- YouTube policy clarification coverage: https://www.socialmediatoday.com/news/youtube-clarifies-monetization-update-inauthentic-repeated-content/752892/

**Vendor (numbers unsourced unless noted — treat as hypotheses)**
- OpusClip caption presets: https://www.opus.pro/blog/best-caption-presets-styles-boost-retention
- OpusClip Shorts captions: https://www.opus.pro/blog/youtube-shorts-caption-subtitle-best-practices
- OpusClip Shorts length (all 24 numeric claims uncited): https://www.opus.pro/blog/ideal-youtube-shorts-length-format-retention
- Platform LUFS table: https://www.forasoft.com/learn/audio-for-video/articles-audio/lufs-targets-per-platform-2026
- Loudness standards explainer (EBU R128, ATSC A/85): https://www.production-expert.com/production-expert-1/what-is-loudness-lufs-lkfs-and-delivery-specs-explained-2026
- BPM editing arithmetic: https://clipmusic.ai/blog/bpm-video-editing-guide
- SFX density: https://esecut.com/blog/sound-effects-that-boost-engagement
- Riverside Shorts length telemetry: https://riverside.com/blog/how-long-can-youtube-shorts-be

**Verified exemplar videos (title strings fetched and confirmed 2026-09-07)**
- https://www.youtube.com/watch?v=0e3GPea1Tyg — "$456,000 Squid Game In Real Life!"
- https://www.youtube.com/watch?v=r7zJ8srwwjk — "I Spent 50 Hours In Solitary Confinement"
- https://www.youtube.com/watch?v=9bqk6ZUsKyA — "I Spent 50 Hours Buried Alive"
- https://www.youtube.com/watch?v=xoxhDk-hwuo — "Glitter Bomb 1.0 vs Porch Pirates"
- https://www.youtube.com/watch?v=VrKW58MS12g — "Glitterbomb Trap Catches Phone Scammer (who gets arrested)"
- https://www.youtube.com/watch?v=hFZFjoX2cGg — "Backyard Squirrel Maze 1.0- Ninja Warrior Course"
- https://www.youtube.com/watch?v=jG7dSXcfVqE — "DO WHAT YOU CAN'T"
- https://www.youtube.com/watch?v=f7KSfjv4Oq0 — "What Happens If We Throw an Elephant From a Skyscraper? Life & Size 1"
- https://www.youtube.com/watch?v=pTn6Ewhb27k — "Why No One Has Measured The Speed Of Light"
- https://www.youtube.com/watch?v=TRL7o2kPqw0 — "The Most Radioactive Places on Earth"
- https://www.youtube.com/watch?v=IvUU8joBb1Q — "Wintergatan - Marble Machine (music instrument using 2000 marbles)"
- https://www.youtube.com/watch?v=P73REgj-3UE — "Primitive Technology: Tiled Roof Hut"
- https://www.youtube.com/watch?v=DJ92uAZ-dVs — "VFX Artists React to Bad & Great CGi 240 Ft. Richard Taylor"

**Rights boundary.** Naming these videos as structural exemplars is analysis.
Downloading, reusing or imitating their footage, characters, music or series
identity is a separate rights decision and is not licensed by their popularity.
Templates built from this document must use original premises, user-owned media,
or assets with a documented licence.
