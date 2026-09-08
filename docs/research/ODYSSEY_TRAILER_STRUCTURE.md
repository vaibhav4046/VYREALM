# Epic Teaser Trailer Structure — Craft Grammar for an Original Odyssey Trailer

Research date: 2026-09-08. Purpose: extract the reusable *grammar* of a modern epic film teaser so we can build an ORIGINAL trailer for Homer's Odyssey (public domain). No shots, score, footage or specific imagery from any copyrighted film are copied or referenced.

**Confidence key:** `[V]` = verified against a cited source. `[C]` = craft convention, widely practised, not tied to a single citable timing. `[E]` = my estimate/derivation, unverified. Treat every *second-level timing* attributed to a real trailer as `[E]` unless marked otherwise — I did not have frame-accurate access to any trailer's audio track, only written breakdowns.

---

## 0. What was actually verified about the primary reference

Christopher Nolan's *The Odyssey* (Universal, 17 July 2026) teaser, per Variety's written breakdown `[V]`:

- **Length: 70 seconds** `[V]`
- **Opens on narration over dark ocean / crashing waves** — voice-over first, image second `[V]`
- Narration text is roughly: darkness / a kingdom without a king / an unwinnable war that was somehow won `[V]` — note the *structure*: state a condition, state an absence, state a paradox. Three beats, no plot.
- Middle section is dialogue fragments between two characters, lit by low firelight, storm approaching `[V]`
- A search motif: a character repeatedly asking others what they know `[V]`
- Returns to dark waves, then reveals the protagonist clinging to wreckage — **the human reveal is the last image before the cards** `[V]`
- **Three text cards at the end, in order:** "One Year From Now" → "A Journey Begins" → title + "17. 07. 26" `[V]`

Other written coverage confirms it is cut "more like a mood piece than a plot breakdown" — storm, silhouettes, flashes of monsters, no narrative clarity `[V]`.

**The single most transferable finding:** the teaser withholds the protagonist. Narration by a *secondary* voice describes an absent man; the man himself appears in the final seconds, at his lowest point. That is the whole engine. We can use it, and it is pure Homer anyway — the *Odyssey* itself opens with Odysseus absent, discussed by others, and does not show him until Book V, adrift.

---

## 1. Overall arc of a 60–90 s epic teaser

Teasers land **60–90 s**, and despite the length they carry **three acts, same as a full trailer** `[V]`. The received shape:

| Section | Window (in a 75 s cut) | Job |
|---|---|---|
| **Cold open** | 0:00 – 0:12 | Black or near-black. One image, one voice, one idea. No cutting. Establishes the *absence* the film is about. |
| **First hard cut** | ~0:12 – 0:15 | The first genuine cut-on-impact. Everything before it should feel like one continuous held breath. This is where the audience learns the trailer has teeth. |
| **Act 2 / world** | 0:15 – 0:40 | Medium shots, 2–3 s each. Establish place, scale, threat. Second and third voice lines sit here. |
| **Turn** | ~0:40 – 0:45 | A riser, a downer, or a sudden silence. The pivot from "world" to "consequence". |
| **Montage / acceleration** | 0:45 – 0:63 | "Montage land" — shot lengths collapse to 0.4–0.8 s, then 0.25–0.4 s in the final burst. Music and hits carry it; images are impressions, not information `[V]`. |
| **Held black / silence** | 0:63 – 0:65 | The most premium two seconds in the trailer. Total stop. |
| **Title card** | 0:65 – 0:70 | Title lands *into* the silence on a single low hit. Title is preceded by a beat of silence and followed by one final punchline shot or a date `[V]`. |
| **Stinger / final beat** | 0:70 – 0:75 | One last image or sound *after* the title. A door, a bowstring, a single word. Then date card. |

**Rule of thirds for information:** by 0:20 the audience should know the *tone*; by 0:45 the *stakes*; by 0:70 the *title*. They should never know the plot.

---

## 2. SOUND DESIGN GRAMMAR (the part we build from)

The received wisdom, verified: a trailer "lives or dies on three sounds — the riser that builds, the boom that lands, and the braam that announces the title card" `[V]`. Additional verified craft rules from a working trailer editor `[V]`:

- Open the trailer with **a low boom to get you in the mood** — the very first sound is sub, not music.
- Put an impact on **anything with sudden, definitive motion** on screen, including the title card slam.
- **Risers build; hits land.** A rise prepares, the hit says the payoff arrived.
- A rise is often followed by a hit **or by a brief silence** to hold suspense.
- **Whooshes ride the transitions** — dips to black, dips to white, cross-dissolves, flares.
- **Overlap audio across the cut**: the next scene's sound starts before the previous picture ends. This is what makes a trailer feel woven rather than assembled.
- **Drones create the mood** underneath, with or without music.

### 2.1 The seven cues, specified for procedural synthesis

All of these are synthesisable in FFmpeg with `sine`, `anoisesrc`, `aevalsrc`, `afade`, `asetrate`/`atempo` for pitch glides, `lowpass`/`highpass`/`bandpass`, `aecho`/`areverb`-style tails, and `amix`. Levels below are peak targets before the final master limiter; master the whole bed to about **-14 LUFS integrated with -1 dBTP ceiling**, and let the *dynamic range* between the quiet passages (-30 to -25 LUFS short-term) and the impacts do the work. `[C]`

---

**CUE 1 — SUB DRONE / RUMBLE BED (the floor)**
Runs almost the entire trailer. It is the thing that makes cheap trailers sound cheap when it is missing.

- Content: sine at **41 Hz** (low E) + sine at **27.5 Hz** (sub octave, ~-8 dB relative) + **brown noise low-passed at 180 Hz** at about -20 dB.
- Movement: amplitude LFO **0.08–0.15 Hz** (one swell every 7–12 s), depth ±4 dB. Without this slow breathing it reads as a hum, not dread.
- Envelope: 3–4 s fade in at the top, ducked -6 to -9 dB under every voice line, pushed +3 dB into every riser.
- Duck it to near-silence for the held-black beat, then bring it back under the title.

```
ffmpeg -f lavfi -i "sine=frequency=41:duration=75" \
       -f lavfi -i "sine=frequency=27.5:duration=75" \
       -f lavfi -i "anoisesrc=color=brown:duration=75:amplitude=0.35" \
       -filter_complex "[2:a]lowpass=f=180[n];[0:a][1:a][n]amix=inputs=3:weights=1 0.4 0.25,\
       tremolo=f=0.1:d=0.35,afade=t=in:d=4,afade=t=out:st=71:d=4" -c:a pcm_s16le drone.wav
```

---

**CUE 2 — BRAAM / HORN HIT (the announcement)**
The brass blast. Used sparingly: **2 to 4 times in 75 seconds, no more.** A braam every ten seconds is the number one tell of an amateur cut. `[C]`

- Fundamental: **55–65 Hz**, with a harmonic stack at 2×, 3×, 4×, 5× (110/165/220/275 Hz) at descending amplitude (1.0 / 0.6 / 0.45 / 0.3 / 0.2).
- Detune: duplicate the stack **±7 cents** and **±14 cents** and mix — the beating between detuned copies is what makes it sound like a section rather than a synth.
- Timbre: sawtooth-ish (harmonic-rich) low-passed at **1.2–1.8 kHz**. Above that it turns into a buzz.
- Envelope: attack **40–90 ms** (not instant — brass has a lip), sustain 0.6–1.0 s, exponential decay **1.5–2.5 s**.
- Motion: a **-4 % pitch droop across the tail** (asetrate glide) makes it sound like it is collapsing under its own weight.
- Layer: add a 5 ms high-passed noise transient at the front for definition on laptop speakers, and a long plate/hall tail of **2.5–4 s**.
- Placement: on the title card, and on at most one or two mid-trailer reveals.

---

**CUE 3 — RISER (the build)**
Every acceleration and every reveal is preceded by one.

- Two layers, always: (a) a **tonal sweep** and (b) a **noise sweep**.
- Tonal: exponential glide **80 Hz → 4–6 kHz** over the riser length. Short riser **1.5–2 s**; long structural riser into the montage **3.5–5 s**.
- Noise: band-passed white noise, band centre sweeping **400 Hz → 8 kHz**, Q rising as it climbs.
- Amplitude: -30 dB → -6 dB, exponential, so the last 20 % of the riser does most of the perceived work.
- Optional: add an accelerating pulse (a click or short noise burst) whose rate goes from 2 Hz to 12 Hz across the riser. This is the "heartbeat" build.
- **The riser must stop 60–120 ms BEFORE the cut**, leaving a hole. Then the hit lands on the first frame of the new shot. The hole is what makes the hit hurt. `[V]`(riser→hit or riser→silence)

---

**CUE 4 — SUDDEN SILENCE (the reveal setup)**
The most valuable and cheapest tool we have.

- Duration: **0.4–1.2 s**. Under 0.4 s it reads as a glitch; over 1.5 s the viewer thinks the file broke.
- Never cut to *digital zero*. Leave a room tone or a -50 dBFS filtered noise bed so the ear knows the trailer is still playing. Absolute silence sounds like a dropout; near-silence sounds like held breath.
- Standard placement: **twice** — once mid-trailer before the biggest reveal, once immediately before the title card.
- Complement it visually: silence over held black is worth ten braams.

---

**CUE 5 — WHOOSH / TRANSITION**
Rides every dip to black, dissolve, or whip-pan `[V]`.

- Band-passed noise (white or pink), centre frequency sweeping **300 Hz → 3 kHz → 300 Hz** across **0.5–0.9 s** — up then down, so it arrives and departs.
- Stereo: pan hard L→R or the reverse; alternate direction on consecutive whooshes so they do not stack.
- Level: -18 to -12 dB. A whoosh you consciously notice is too loud.
- Doppler flavour: a slight pitch bend down through the middle sells motion.

---

**CUE 6 — BOOM / IMPACT (the land)**
The workhorse. One on the first hard cut, one on most montage accents, one under the title.

- Sine at **48 Hz glissing down to 28 Hz over 250–350 ms** (this downward glide is the entire trick — a static sine reads as a beep, a falling one reads as a hit).
- Attack **≤5 ms**; decay exponential **2–4 s**.
- Add a **3–8 ms high-passed (>2 kHz) noise click** at the transient so it survives phone speakers, which cannot reproduce 30 Hz at all.
- Add a **reversed pre-hit**: 0.4–0.6 s of reversed noise/impact swelling *into* the boom. Costs nothing, doubles the perceived weight.
- Tail: on the final boom, let a **5–8 s reverb tail** decay under the date card and out to black.

---

**CUE 7 — DOWNER / SUB DROP (the release)**
The inverse of a riser, used on the turn (~0:40) and after the title.

- Tonal glide **150 Hz → 22 Hz over 1.2–2 s**, amplitude falling -6 dB → -20 dB with a small bump at the bottom.
- Pair with a visual cut to black or a slow-motion push.

---

### 2.2 Cue placement map for a 75-second cut `[E]`

| Time | Cue |
|---|---|
| 0:00 | Low boom under the first frame of black `[V]`(open with a low boom) |
| 0:00–0:75 | Sub drone bed, ducked under voice, swelling every ~9 s |
| 0:11.4 | Short riser (1.6 s), ends 0:13.9 |
| 0:14.0 | **BOOM #1** on the first hard cut |
| 0:19 / 0:24 / 0:31 | Whooshes on dips and dissolves |
| 0:27 | **BRAAM #1** (mid reveal) |
| 0:38.5 | Long riser (4 s) |
| 0:42.5 | **BOOM #2** — the turn; downer immediately after |
| 0:45–0:62 | Montage: sub-hits every 0.4–0.8 s locked to the cut grid, ascending in pitch |
| 0:60.5 | Final short riser (1.5 s) into the drop-out |
| 0:62.0–0:63.0 | **SILENCE** (1.0 s, held black) |
| 0:63.0 | **BRAAM #2 + BOOM #3** together — title card |
| 0:69 | Whoosh out of title |
| 0:70 | Stinger: one diegetic sound alone (bowstring, rope, breath) |
| 0:72 | **BOOM #4**, small, with an 8 s tail under the date card |

Rule of thumb: **loud is relative.** The braam at 0:63 only hits because the second before it was silent and the ten seconds before that were dense.

---

## 3. Cut rhythm

Shot-length curve is **long → medium → short, with hard cuts on impacts or beats** `[V]`; montage shots run "a second or two, even if that's just to jump cut within the same shot" `[V]`.

Concrete beat pattern for 75 s `[E]`:

```
COLD OPEN   0:00-0:12   3 shots   ~4.0s each        (or 1 shot held 12s over VO)
BUILD       0:14-0:26   5 shots   2.4s avg
WORLD       0:26-0:40   6 shots   2.3s avg
TURN        0:40-0:45   2 shots   2.5s, then 1 held beat
MONTAGE A   0:45-0:54   14 shots  0.65s avg
MONTAGE B   0:54-0:62   20 shots  0.40s avg  (final 6 at 0.25s)
BLACK       0:62-0:63   —
TITLE       0:63-0:69   1 card    6.0s
STINGER     0:69-0:72   1 shot    3.0s
DATE        0:72-0:75   1 card    3.0s
```

Total ≈ 52 shots. Notes:
- **Never let two adjacent montage shots have the same length.** Alternate 0.4 / 0.6 / 0.4 / 0.3 — a metronomic grid reads as a slideshow.
- Cut **on** the transient, not after it. One frame late reads as sloppy; one frame early reads as deliberate.
- In the montage, alternate direction of movement across cuts (left-moving shot, then right-moving) so the montage has kinetic friction.
- Give the montage **one deliberate hole**: a single 1.2 s shot at ~0:57 amid the 0.4s cuts. The irregularity is what stops it feeling like a screensaver.

---

## 4. Text card convention

- **Count: 3 to 5 cards total, including the title.** The verified reference used exactly three: two teaser cards then the title with a date `[V]`.
- **Words per card: 2–5.** "One Year From Now" (4), "A Journey Begins" (3) `[V]`. Never a sentence, never punctuation heavier than a full stop.
- **Placement:** cards belong to the last third. A card in the first 20 seconds bleeds tension. Exception: an opening date/context card over black at 0:00–0:03 if the trailer needs a frame.
- **Hold: 1.2–1.8 s** per teaser card; **4–6 s** for the title card; **2.5–3 s** for the date.
- **Motion:** either a hard cut in with a hit, or a slow 1–2 % scale-up over the hold. Never slide, never fly in, never letter-animate.
- **Type:** one typeface, one weight, wide tracking (80–150 units), centred, small relative to frame — a card that fills 20 % of the frame width reads more expensive than one filling 70 %.
- Cards sit **over pure black**, not over footage, except the title if it lands over a held image.

---

## 5. Voice

- **Yes, narration — but not the protagonist.** The verified reference has a secondary character narrating about an absent Odysseus `[V]`. Withholding the hero's voice is the single strongest structural choice available and it is native to Homer.
- **Where it sits:** first line in the first 3–6 seconds, over black or near-black, *before* any real image. Then 2–4 more lines spread through the first 45 seconds. **No narration during the montage** — the montage is music and sound design only.
- **Cadence:** short declaratives, 5–10 words each, with 1.5–3 s of silence between them. Low register, close-miked, dry with only a short room. Falling intonation at line ends. The pauses carry more than the words.
- **Total word count for 75 s: 35–55 words.** Anything above ~70 and it becomes an audiobook.
- **Structure of the lines** (from the verified reference `[V]`, generalised): (1) name a condition, (2) name an absence, (3) name a paradox or an impossible fact. Optionally (4) a question left hanging.
- Fragments of dialogue can be intercut later — two or three lines maximum, and they should be ambiguous out of context.

---

## 6. Premium vs cheap: the actual signals

**Premium:**
1. **Held black.** Blackness is expensive because it says the trailer is not afraid of losing you. 2–4 s of black across the cut, in at least two places.
2. **Negative space.** Small subject in a large empty frame. One object, one horizon. Cheap trailers fill the frame; expensive ones frame emptiness.
3. **Dynamic range.** The gap between the quietest and loudest moment. Cheap trailers are loud throughout, which means nothing is loud.
4. **Colour discipline.** Two or three hues total across the whole cut. Desaturated base plus one warm accent (firelight) against one cold field (sea/night). Every shot graded to the same palette.
5. **Letterboxing** at 2.39:1 (or a deliberate tall IMAX-style 1.90:1 block against a wide surround) — consistent, never switching mid-cut without intent.
6. **Grain.** A light, static-free film grain at low opacity over everything, including the black and the title cards. Uniform grain across mixed sources is what makes disparate footage read as one film.
7. **One idea per shot.** Cheap trailers cut to shots that contain three things happening.
8. **Slow motion used once**, not throughout.
9. **The title card is small, centred, and still.**
10. **Sound leads picture.** Audio for the next shot starts before the current picture ends `[V]`.

**Cheap tells:**
- Braam on every cut; no silence anywhere.
- Text cards with sentences, exclamation marks, gradients, drop shadows, or animated entrances.
- Shots that all last exactly the same length.
- Loud from frame one, so the ending has nowhere to go.
- Ungraded footage — three different colour temperatures in one montage.
- Zoom/whip transitions used decoratively rather than on an audio cue.
- Title card that fills the frame edge to edge.
- Narration that explains the plot.
- Digital-zero silence (reads as a broken file, not as a held breath).

---

## 7. CONCRETE 75-SECOND BEAT SHEET — original Odyssey trailer

All imagery derived from public-domain Homer. Nothing here references any film's specific shots. Format 2.39:1, light grain throughout, palette: desaturated slate-blue sea and night, one warm ember accent (fire, torch, hearth), bone-white type.

| # | Time | Shot | Audio | Text |
|---|---|---|---|---|
| 1 | 0:00–0:04 | Pure black. | Low BOOM at 0:00. Sub drone fades in from 0:01. | — |
| 2 | 0:04–0:08 | Black slowly resolving into moving water at night — barely legible, more texture than image. | VO 1: *"Twenty years, and the sea has not given him back."* | — |
| 3 | 0:08–0:12 | Wide: an empty stone hall, one dying hearth fire, a chair nobody sits in. Static. Held 4 s. | Room tone, fire crackle only. Drone ducked. | — |
| 4 | 0:12–0:14 | Push in on the empty chair. | Short riser (1.6 s) starting 0:11.4. Riser cuts out at 0:13.9. | — |
| 5 | 0:14–0:16 | **HARD CUT.** Storm sea, horizon inverted, spray filling frame. | **BOOM #1** on frame one. Drone up +3 dB. Storm ambience enters. | — |
| 6 | 0:16–0:19 | Low angle: a wave standing above a small hull. | Whoosh on the dip in. Wind. | — |
| 7 | 0:19–0:22 | Silhouette of a man at a broken mast, seen from behind, unrecognisable. | VO 2: *"He angered a god who owns the water."* | — |
| 8 | 0:22–0:26 | Rope, timber, spar splitting. Fast handheld, one motion. | Wood crack sweetened with a mid impact. | — |
| 9 | 0:26–0:29 | Cut to black for 6 frames, then: the interior of a vast cave, one shaft of light, scale unreadable. | **BRAAM #1** at 0:27, into the cave reveal. Reverb tail 3 s. | — |
| 10 | 0:29–0:32 | Close: a sharpened olive stake in firelight, hands binding it. | Fire. Low pulse begins (2 Hz). | — |
| 11 | 0:32–0:35 | Extreme close: a single eye reflecting flame. No creature shown. | Breath, deep and slow, not human tempo. | — |
| 12 | 0:35–0:38 | Wide: a shore of white rock, still water, no wind, nothing moving. Wrong-feeling calm. | Everything drops away except a single sustained high tone (2.8 kHz, quiet). | — |
| 13 | 0:38–0:41 | Slow push toward figures on the rocks, out of focus, indistinct. | VO 3: *"Every voice that calls him home is not a friend."* Long riser starts 0:38.5. | — |
| 14 | 0:41–0:43 | Water surface, from below, a hand breaking through. | Riser hole at 0:42.4. **BOOM #2** at 0:42.5. Downer follows. | — |
| 15 | 0:43–0:45 | Black. | Sub tail only. | — |
| 16 | 0:45–0:47 | A woman's hands at a loom, unpicking the night's weaving thread by thread. | Montage bed enters: pulse at 4 Hz, sub hits on the grid. | — |
| 17 | 0:47–0:54 | MONTAGE A (~11 shots, 0.6 s avg): torch flames along a corridor; a ship's prow; a chart of stars; a dog's head lifting; a door barred from inside; a wave collapsing; a shield rim; a hand on a doorframe; a fire going out; a horizon line; a shadow crossing a wall. | Sub-hit on every cut, ascending in pitch across the run. Whooshes on the two dissolves. | — |
| 18 | 0:54–0:57 | MONTAGE B part 1 (~8 shots, 0.4 s): faces turning; spilled wine; a table overturned; a bowstring; sea; sea; fire; black. | Pulse doubles to 8 Hz. Drone up. | — |
| 19 | 0:57–0:58.2 | **THE HOLE:** one held 1.2 s shot — a great bow, unstrung, lying alone on a stone floor. | Everything drops to the sub drone alone. | — |
| 20 | 0:58.2–0:62 | MONTAGE B part 2 (~9 shots, 0.25–0.35 s): hands on the bow; the string pulled; storm; the eye; the loom; the empty chair; the wave; the hall doors closing; white flash. | Hits accelerate to 12 Hz. Final short riser from 0:60.5. | Card at 0:58.5, 1.4 s: **"ONE MAN"** · Card at 0:60.2, 1.4 s: **"IS STILL COMING HOME"** |
| 21 | 0:62–0:63 | **BLACK.** | **SILENCE** — near-silence, room tone at -50 dBFS only. 1.0 s. | — |
| 22 | 0:63–0:69 | Title card, small, centred, bone-white, wide tracking, over black. Grain still running. | **BRAAM #2 + BOOM #3** together on frame one. 4 s tail. | **THE ODYSSEY** |
| 23 | 0:69–0:72 | STINGER: a single shot — the bowstring drawn to full, held, in near-darkness. No release. | Whoosh out of title at 0:69. Then one dry diegetic sound alone: the creak of the drawn bow. Nothing else. | — |
| 24 | 0:72–0:75 | Date card over black. | **BOOM #4**, small, 8 s reverb tail decaying past the end. | **[DATE]** |

**Why this works:** we never show the protagonist's face. We show the chair he does not sit in, the loom that waits, the bow only he can string, and a silhouette in a storm. The reveal we withhold is the reveal the audience buys a ticket for — which is the same structure Homer used, and it costs us nothing in rights.

**Assets we must generate procedurally:** drone bed, 2 braams, 4 booms, 3 risers, 1 downer, ~6 whooshes, ~30 grid sub-hits, 1 sustained high tone, 1 reversed pre-hit per boom. All specified in §2.1.

---

## Sources

- [Christopher Nolan's 'The Odyssey' Teaser Leaks Online — Variety (AU)](https://au.variety.com/2025/film/news/christopher-nolan-odyssey-teaser-leaks-online-first-footage-24450) — 70 s length, narration text, shot order, three title cards
- [The Odyssey Trailer Breakdown: 7 Biggest Reveals — Screen Rant](https://screenrant.com/the-odyssey-movie-trailer-details-revealed-christopher-nolan/) — imagery inventory; contains no timing data
- [The Odyssey Teaser Trailer — High On Films](https://www.highonfilms.com/the-odyssey-teaser-trailer-christopher-nolan/) — "mood piece, not a plot breakdown"
- [Secrets to Trailer Sound Design — Derek Lieu](https://www.derek-lieu.com/blog/2022/1/17/secrets-to-trailer-sound-design) — hits/risers/whooshes/drones craft rules, audio overlap across cuts, open on a low boom
- [Sound Design for Trailers: Hits, Rises, Drones and Pulses — add.app](https://add.app/sound-effects/sound-design-for-trailers-hits-rises-drones-pulses/) — rise-prepares / hit-lands; rise followed by hit or silence
- [Braam sound effects — Morphic](https://morphic.com/resources/sounds/braam-sound-effects) — braam function and character
- [Cinematic Sound Effects: Trailer Booms & Risers — Morphic](https://morphic.com/resources/tools/cinematic-sound-effects) — riser / boom / braam as the three structural sounds
- [Trailers, Teasers & Promos: Lengths, Formats & Tips — Film Editing Pro](https://www.filmeditingpro.com/trailers-teasers-promos-lengths-formats-tips/) — 60–90 s teaser length, three acts, "montage land"
- [Trailer Pacing in 2025 — Epikton](https://epikton.net/a-quick-guide-to-pacing-in-trailers/) — long→medium→short shot curve, hard cuts on impacts
- [Teaser Trailer Conventions — SlideShare](https://www.slideshare.net/slideshow/analysis-of-trailer-conventions/63926283) — montage shot length of a second or two

**Not verified:** all second-level cue timings in §2.2, the shot-count table in §3, and every frequency/envelope value in §2.1 are craft-derived specifications, not measurements of any released trailer. Dune, Gladiator II, Troy, 300, Oppenheimer and Interstellar teasers were not individually analysed within the time budget — the conventions above are the cross-cutting grammar they share, per the editing sources cited, not per-title measurement.
