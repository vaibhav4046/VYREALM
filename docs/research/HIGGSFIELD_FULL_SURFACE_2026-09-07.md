# Higgsfield.ai — Full Capability Surface Map

**Purpose:** evidence-backed inventory of everything Higgsfield.ai ships, so VYREALM (a fully local, open-source video studio targeting an RTX 3050 Laptop 6 GB VRAM / 16 GB RAM) can decide what to mirror, what to degrade, and what to drop.

**Date of research:** 2026-09-07
**Researcher note:** every factual claim below carries a source URL. Anything I could not read is marked **UNVERIFIED** rather than guessed. No preset name in this document was invented — all lists are transcriptions of what the cited page rendered.

---

## 0. Method, coverage, and what I could not read

**What I fetched:** the Higgsfield marketing sitemap (146 URLs), the Creator Hub Help Center (all 9 sections, ~70 articles indexed, 15 read in full), the public changelog, the blog index (207 posts), and the public preset-gallery pages.

**Pages that would not yield content (JS-rendered shell only, no login wall hit):**

| URL | Problem |
|---|---|
| `https://higgsfield.ai/pricing` | Returned only nav + meta description. **The actual price table is client-rendered and was not readable.** Pricing below comes from third parties and is flagged. |
| `https://higgsfield.ai/speak` | Returned generic app shell ("The ultimate AI-powered camera control for creators by creators"). No Speak-specific content. |
| `https://higgsfield.ai/3d-jutsu` | Same generic shell. 3D Jutsu detail below comes from the changelog and homepage instead. |
| `https://higgsfield.ai/character` | Same generic shell. |
| `https://higgsfield.ai/draw-to-video`, `/product-to-video` | **HTTP 404.** These are not real routes; the capability lives under `/sketch-to-video-ai` and Marketing Studio. |
| `https://higgsfield.ai/blog/Turn-Your-Sketch-Into-a-Cinema` | **HTTP 404** (link surfaced by search but dead). |
| `https://en.wikipedia.org/wiki/Higgsfield_AI` | **HTTP 404** — no Wikipedia article at that title. |
| `https://mcpservers.org/agent-skills/higgsfield-ai/higgsfield-generate` | **HTTP 403 Forbidden.** MCP tool schema not readable. |
| `https://higgsfield.ai/motion/sitemap.xml` | Readable, but all 229 entries are **UUID-only URLs** — preset *names* are not exposed in the sitemap. |
| `https://higgsfield.ai/mixed-media-presets/sitemap.xml` | Same: 33 UUID-only preset URLs, no names. |

**Consequence:** the preset taxonomy below (~370 named presets) is a floor, not a ceiling. There are at least 229 motion presets and 33 mixed-media presets whose names I could not resolve, plus a per-account "Presets library" inside DoP that the help centre describes only by *category*.

**No page in this research was paywalled or required a login.** Everything that failed, failed for the technical reasons listed above.

---

## 1. What Higgsfield is (one paragraph)

Higgsfield positions itself as an "AI-native creative suite" — an aggregation layer over ~30+ third-party generative models (Seedance, Kling, Veo, Sora, Wan, Nano Banana, MiniMax Hailuo, Grok, Recraft, FLUX, Seedream, GPT Image, Z-Image) plus a handful of proprietary models (Soul, Soul Cinema, DoP, Speak, Genjutsu), wrapped in opinionated *workflow products* (Cinema Studio, Marketing Studio, Canvas, Supercomputer, Popcorn, AI Influencer, Apps) and a very large curated **preset library**. Homepage claims "40+ creative AI tools" and "30+ models (including Sora 2, Kling 3.0, Veo 3.1)". Source: <https://higgsfield.ai/>

The strategically important observation for VYREALM: **Higgsfield's moat is not the models — it is the preset taxonomy, the consistency primitives (Soul ID / Elements / Soul HEX), and the agent/orchestration layer.** Those three are exactly the parts that are reproducible locally.

---

## 2. Product-by-product inventory

### 2.1 Cinema Studio (v4.0)

- **What it does:** "Cinema Studio is how Higgsfield handles cinematic video production. Instead of one-shot text-to-video, it simulates a film studio: structured control over optics and camera motion, AI actors built with Soul Cast, color grading, physics-aware motion with native audio, an AI Director that drafts shots, and an Elements system for reusing characters, locations, and props." — <https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-cinema-studio>
- **Inputs:** text prompt; references — "Up to fifty per generation - uploads, Elements, past takes, likes" (v4.0); v3.0–3.5 accepted 9 references. Video uploads: none in v2.5, "Up to 15 seconds" in v3.0–3.5, "Up to 30 seconds" in v4.0. Same source; also <https://higgsfield.ai/cinematic-video-generator>
- **Outputs:** "Native 4K" with "No upscale tricks — the detail is generated, not stretched" (<https://higgsfield.ai/cinematic-video-generator>); "clips up to 30 seconds" / "Up to one minute per generation" — **the marketing page says up to one minute, the help centre says 30 seconds, and the engineering blog says "up to 720p" and "generations up to 30 seconds"** (<https://higgsfield.ai/blog/how-we-built-cinema-studio>). **These three official sources conflict. Treat max duration as 30 s and max resolution as CONTESTED (720p vs native 4K).**
- **Aspect ratio:** "Originally optimized for 21:9 cinema format" (<https://higgsfield.ai/blog/how-we-built-cinema-studio>); "HD resolution with Cinema Studio in 21:9 aspect ratio" (<https://higgsfield.ai/ai-video>). **fps: UNVERIFIED.**
- **Underlying model:** "Cinema Studio 4.0 runs on Seedance 2.5"; "built on top of interchangeable video models" with "multi-model support" in 4.0.
- **Credits:** "generations are priced in credits by length, resolution and model" — no table published.

**Named Cinema Studio controls (all quoted verbatim):**

| Control group | Values |
|---|---|
| Genres (v3.0) | General, Action, Horror, Comedy, Noir, Drama, Epic |
| Genres (v4.0) | General, Action, Epic, Drama, Comedy, Horror, Noir |
| Speed Ramps (v3.0) | Linear, Auto, Flash In, Flash Out, Slow-mo, Bullet Time, Impact, Ramp Up |
| Camera Moves (added v4.0) | POV, Robot Arm, Helicopter Shot |
| Camera bodies (v4.0) | 35mm Film, 8mm Film, DV Camcorder |
| Lens styles (v4.0) | "clean sharp to anamorphic and vintage options" (individual names not enumerated on page) |
| Color Grading (v2.5) | Color Temperature, Contrast, Saturation, Sharpness, Film Grain, Highlights, Exposure |
| Lighting (v4.0) | "6 presets, or a custom setup with control over color, brightness, diffusion, and angle" (the 6 names are **UNVERIFIED**) |
| Montage Pacing / Tempo | Chaotic, Dynamic, Calm, Single Shot ("Single Shot to Chaotic") |
| Era | "from the 60s to the 2020s" |
| Per-shot optics (v3.5+) | Camera, Lens, Focal length, Aperture |
| Global project settings (v3.5+) | Genre, Style, Lighting, Color Palette, Camera MoveSet Style |
| AI Cast character axes | genre, era, archetype, physique, outfit, distinguishing details, emotions |
| Other v4.0 features | Native 4K, AI Cast, Cinematic Locations, Soul Cinema Models, anti-slop camera pipeline, team layer |

Sources: <https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-cinema-studio>, <https://higgsfield.ai/cinematic-video-generator>, <https://higgsfield.ai/blog/how-we-built-cinema-studio>

### 2.2 Marketing Studio

- **What it does:** "the marketing creation workspace for ads, product creative, UGC, and other commercial content", template-first: "start from a ready format and connect your product." — <https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-marketing-studio-to-create-video-ads>
- **Inputs:** product image upload; a website/product-page **URL** parsed for "brand signals"; reference ads (UGC category); optional written prompt; logos/websites (Motion Design).
- **Outputs:** max clip length **15 seconds per generation**; both image and video templates; post-generation editing only in the Posters category; native audio and lip sync included.
- **Named template categories (7):** Product Shots (`Studio`, `Lifestyle`, `With Model`), Ads ("Image ads built to the specs of Meta and Google placements"), Marketplace, Posters, UGC Videos (`Faceless`, `Talking Head`, `Silent`), Motion (`Hypermotion`, `2D Product Motion`, `Mixed Media`, `Motion Design`), Ref → Video.
- **Supporting features:** Brand Kit (auto-extracts "logo, brand colors, fonts, imagery, and tone of voice"), Soul ID (needs 20+ reference photos), **Virality Predictor** (scores "virality potential, expected engagement, and how well it holds attention").
- **Known limitations (stated by Higgsfield):** template Marketing Studio is not available through MCP or Supercomputer; no editing except Posters.
- **Related standalone release: Ad Multiplier** (Aug 25, 2026) — "Turns one video ad into many variants: same video, edit, and pacing, with new characters, clothing, locations, and objects." <https://higgsfield.ai/creator-hub/changelog>

### 2.3 Supercomputer (the agent layer)

- **What it does:** "Supercomputer is a chat-driven agent that does more than generate a single asset: it breaks a request into steps, picks the right model for each one, runs them, and assembles the result." — <https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-supercomputer>
- **Generation models it routes to:** Soul, Cinema Studio, Seedance, Nano Banana, "and others".
- **LLM brains available:** "models from Anthropic, OpenAI, Google, xAI, DeepSeek, and others", with auto-routing or manual model selection. Changelog names specific ones: Claude Fable 5, Claude Fable 5.1, Claude Sonnet 5, GPT-5.6, GPT-6 Astra, Grok 4.5, GLM-5.3 Flash, Ox Alpha ("roughly 1M-token context window"), plus a free tier ("All text generations on the Free model cost nothing, and there are no usage limits", Jul 17 2026).
- **Named official skills:** Product UGC, Higgsfield Faceless Video, Shorts Maker, YouTube Covers, Personal Clipper. **Named pre-built use cases:** TV Commercials, Animated Infographics, Localization. Plus a "Made by community" skill marketplace.
- **Storage:** base 20 GB, expandable (changelog Jul 8, 2026).
- **Projects:** "A shared workspace in Supercomputer that keeps context across your work" (Aug 23, 2026).
- **AI Employees / AI Employees 2.0:** "Ready-made agents you call with @" (Jun 2, 2026); "Your AI Employees now remember" (Jun 19, 2026).

### 2.4 Canvas (node graph)

- **What it does:** "Higgsfield's node-based infinite board for multi-model visual production… a prompt feeds an image, the image feeds a video, the video feeds an edit." — <https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-canvas>
- **Node types:** Text Prompt nodes, Generation nodes, Reference nodes (images/audio/existing generations), Audio nodes. "Every Higgsfield model is available as a node on the board."
- **Behaviour notes:** Seedance references require explicit role description in the prompt; Kling treats connected images as start frames and uses `@element-tags` for character references; audio nodes attach to video generation nodes.
- **Features:** parallel model runs for comparison, saved reusable workflow templates, real-time team collaboration.
- **Credits:** "Credits are deducted only when a node generates content." Building/connecting nodes is free.

### 2.5 Soul family (proprietary image models)

- **Soul:** "native image model family, built for cinematic, fashion, and culture-native visuals" (<https://higgsfield.ai/creator-hub/help-center/getting-started/what-is-higgsfield>). Three variants: **Soul** ("Quick preset-driven generation"), **Soul 2.0** ("Full creative control" — presets, Moodboards, Soul HEX, Soul ID, reference images), **Soul Cinema** ("Cinematic-grade visuals" with Soul HEX and Soul ID built in). <https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-soul-to-generate-images>
- **Output settings (Soul):** aspect ratios **9:16, 3:4, 2:3, 1:1, 4:3, 16:9, 3:2**; quality **1.5k or 2k**; batch size **1 to 4**.
- **Preset categories inside Soul:** General, TikTok Core, Instagram Aesthetics, Beauty, Mood, Camera Photo, Graphic Art.
- **Moodboards (Soul 2.0 only):** custom styles built from "20+ cohesive reference images".
- **Soul HEX:** "Precise color control and palette consistency across every generation" (<https://higgsfield.ai/soul-cinema>). Now also a **standalone tool** (changelog Aug 21, 2026: "Relight & HEX Standalone").
- **Soul ID:** "Upload 20 or more photos of the same person (up to 80 supported)"; "Training takes a few minutes"; works across the Soul family and plugs into Seedance video as an Element; "the trained character itself isn't a downloadable file." <https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-create-and-use-a-soul-id-character>
- **Soul Cinema:** "Generate cinematic-grade images with the richness and detail of a real film set"; inputs = "a prompt or a reference image"; era-aware ("The model knows what the '70s, '90s, and today actually look like"). Base architecture **UNVERIFIED**. <https://higgsfield.ai/soul-cinema>
- **Soul Cast:** used for AI actors inside Cinema Studio (<https://higgsfield.ai/blog/soul-cast-ai-filmmaking>).

### 2.6 Popcorn (storyboard / multi-frame)

- **What it does:** "Popcorn creates coherent sequences of up to 8 frames where character identity, lighting, and atmosphere stay consistent across every shot." — <https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-popcorn>
- **Inputs:** "A written prompt, up to 4 image references (portraits, props, locations), or both combined." References are addressed by number in the prompt.
- **Outputs:** up to 8 frames per generation. Aspect ratios **3:4, 2:3, 3:2, 1:1, 9:16**. The dedicated landing page also lists **16:9** and a "High" quality setting, plus "one-click export to Sora 2" (<https://higgsfield.ai/storyboard-generator>). Output resolution otherwise **UNVERIFIED**.
- **Modes:** **Manual** ("direct every frame yourself") and **Auto** ("write one prompt, choose how many frames you want (up to 8), and Popcorn expands your story").
- **Continuation trick:** "take the last image of your sequence and use it as the new reference input to continue the story."
- **Credits:** scales with frame count; exact cost shown on the Generate button.

### 2.7 DoP (Director of Photography) — proprietary image-to-video

- **What it does:** Higgsfield's proprietary image-to-video model that "blends diffusion with reinforcement learning, so the model reasons about how a scene should move and evolve over time." Cinematography-aware. — <https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-dop>
- **Inputs:** keyframe image (PNG/JPG upload, clipboard paste, or generated in-app) + preset selection + text prompt (with optional auto-enhance) + advanced settings.
- **Outputs:** clip duration **3 or 5 seconds**; seed and steps exposed. Resolution/fps **UNVERIFIED**.
- **Preset categories (verbatim):** Effects, Basic Camera Control, Epic Camera Control, Catch the Pulse, Mix, New, Trending, Top Choice. The help centre does **not** enumerate individual preset names — those come from the public gallery pages, transcribed in §3.

### 2.8 Genjutsu (motion transfer / element swap)

- **What it does:** two modes — **Motion Transfer** ("Keep the motion and camera. Rebuild everything around them") and **Object Swap** ("Point edits - outfit, location, characters, objects"). Changelog framing: "Changes an object, location, product, or character in a video while leaving everything else as it was" (Sep 1, 2026).
- **Inputs:** reference video **3 to 30 seconds**; **up to 40 reference images** (characters, products, wardrobe, visual elements); text prompt.
- **Outputs:** transformed video preserving original motion and timing. Resolution/fps **UNVERIFIED**.
- **Underlying model: UNVERIFIED** (page names "Genjutsu" but no architecture).
- Sources: <https://higgsfield.ai/genjutsu>, <https://higgsfield.ai/higgsfield-genjutsu-presets>, <https://higgsfield.ai/creator-hub/changelog>
- **Note:** `https://higgsfield.ai/higgsfield-genjutsu-presets` shows ~20 before/after examples with "Recreate" buttons but exposes **only two action labels — "Objects swap" and "Motion transfer"**. There is no named Genjutsu preset taxonomy on the public page.

### 2.9 3D Jutsu

- **What it does:** "Turns a prompt or reference into an editable 3D scene, with objects, layout, lighting, cameras, and animation, and then into video." (changelog, Sep 4, 2026). Homepage: "Turn a single prompt into a fully editable, interactive 3D world."
- Inputs/outputs/specs/models: **UNVERIFIED** — `/3d-jutsu` renders only the app shell.

### 2.10 AI Influencer / AI Influencer Studio

- **What it does:** "AI Influencer is Higgsfield's visual character builder for virtual personas" — a game-style menu builder rather than prompting. <https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-ai-influencer>
- **Builder panel (base identity):** Character Type, Gender, Ethnicity/Origin Base, Skin Color, Eye Color, Age, Skin Conditions (freckles, scars, birthmarks, vitiligo, albinism, etc.).
- **Advanced tabs:** **Face** — "eyes by type and details, mouth and teeth, ears, horns, face skin material, and surface pattern"; **Body** — "body type, height, proportions, and customizable limbs, including extra ones for non-human builds"; **Style** — "hair, accessories, and rendering style".
- **Species supported:** "humans, mammals, reptiles, fish, hybrids, and aliens, and categories can be blended in a single build."
- **Outputs:** static images **up to 4K**; animated video via motion control or movement templates; talking-head with lipsync; saved to a personal character library.
- **Models:** Soul, Nano Banana, Seedance referenced; exclusive model **UNVERIFIED**.

### 2.11 Higgsfield Apps + App Builder

- **What they are:** "full working web apps built from a single prompt inside Supercomputer, with Higgsfield's generative models wired in automatically." Examples given: "an AI photobooth, an anime filter, a 'see your future self' tool." <https://higgsfield.ai/creator-hub/help-center/tools/what-are-higgsfield-apps>
- **Three layout templates:** `App detail` ("A single-tool landing page"), `Preset` ("A 'pick a style, then generate' grid"), `Studio` ("A full creative workspace").
- **Economics:** "people who use your app sign in with their own Higgsfield accounts and generate on their own credits, so their usage costs you nothing."
- **App Builder (Jun 26, 2026):** "Turns a prompt into a deployed website, so you go from idea to a shareable link."
- The live app catalogue at `/apps` is transcribed in §3.6 (40 named apps in 8 categories).

### 2.12 Higgsfield Audio

- **Three modes:** Text to Speech ("Generate a voice track from text"), Voice Change ("Replace the existing voice in a clip with a different one"), Translate ("Translate and re-voice your content in another language (18 languages)"). <https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-lipsync-voiceover-and-aspect-ratios>
- **Voice cloning:** "record a sample or upload one (MP3 or WAV), then clones it into a reusable voice you can select for any generation."
- **Named audio models:** Seed Audio ("complete sound scene: voice, music, and effects in one pass"), Eleven / ElevenLabs ("expressive AI voice with emotion control"; default voice), MiniMax Speech ("studio-quality text-to-speech"; "strong voice cloning"), Seed Speech ("multilingual voice"; ByteDance), VibeVoice / Vibe Voice ("long-form expressive voice synthesis"; "multi speaker dialog"), Qwen (added Aug 10, 2026). Sources: <https://higgsfield.ai/creator-hub/help-center/ai-models/which-ai-model-should-i-use>, <https://higgsfield.ai/ai-voice-generator>, changelog.
- **Language claims conflict:** the help centre says Translate covers **18 languages**; `/ai-voice-generator` and `/ai-talking-avatar` both claim **"74+ languages"** for TTS/avatars. Both are quoted; the 18 figure appears to be translation-specific.
- **Export:** "MP3, WAV, and video ready audio".

### 2.13 Speak / talking-head / lipsync

- **Eight lipsync models** listed by Higgsfield. Image-to-video: **Google Veo 3.1** (cinematic talking video), **Kling 2.6 Lipsync** ("up to 1080p with audio"), **Wan 2.5 Speak** ("480p–1080p with audio"), **Kling Avatars 2.0** ("longer clips"), **Higgsfield Speak 2.0** ("priority-queue speed"), **Infinite Talk** ("long-form video"). Video-to-video: **Kling Lipsync**, **Sync Lipsync 3** ("up to 4K"). <https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-lipsync-voiceover-and-aspect-ratios>
- **AI Talking Avatar page:** inputs = script + avatar (library avatar, generated face, or "digital twins from selfies") + voice (native or cloned). Output: "Export MP4 in 9:16, 1:1, or 16:9 up to 4K." "Speak 74+ languages with native sound, with lip sync re-locked per language." Models named on that page: Cinema Studio 3.0, Seedance 2.0, Veo 3.1, Kling 3.0, Wan 2.7, ElevenLabs, MiniMax, Vibe Voice. <https://higgsfield.ai/ai-talking-avatar>
- **Native audio co-generation (video + audio in one pass):** Seedance 2.5, Kling 3.0, Seedance 2.0, Flux 3, MiniMax Hailuo 3.0, Wan 2.5.

### 2.14 Image editing suite

Named editing surfaces (from `/ai-image`, `/image-editing`, `/higgsfield-layers`, and the account article):

- **Per-asset edit actions:** Color Grading, Upscale, Enhancer, Relight, Inpaint, Angles. Continue-working actions: "Turn to video", "Recreate", "Reference", "Create Element". <https://higgsfield.ai/creator-hub/help-center/getting-started/whats-in-my-higgsfield-account>
- **Named tools:** Nano Banana Pro Inpaint ("brush over any area and change it — swap objects, fix backgrounds, rewrite text, adjust colors"), Relight, Skin Enhancer, Style Snap, Paint App, Color Grading, Image Background Remover, Expand Image, AI Image Upscaler, AI Image Enhancer, AI Object Remover, Face Swap, Hairstyle Changer, Clothes Changer, Glitter Sticker, AI Headshot Generator, AI Stylist, Outfit Swap.
- **Image specs:** "You can generate images at up to 4K (4096x4096) resolution natively"; aspect ratios "1:1, 9:16, 16:9, 3:4, 4:3, and more"; editing accepts "JPG, PNG, WebP up to 4K resolution". <https://higgsfield.ai/ai-image>, <https://higgsfield.ai/image-editing>
- **Layers (Aug 11, 2026):** "Break any flat image into clean, editable layers — subject, background, and details." Draw-to-edit ("Sketch directly on the frame to tell Higgsfield what to change"), background removal with "pixel-level edges - clean hair detail, transparent alpha", upscaling "up to 4K with real detail recovery", relighting, text editing. Models named: **Seedream 5.0** and **Nano Banana Pro**. <https://higgsfield.ai/higgsfield-layers>

### 2.15 Video editing / restoration

- **AI Video Upscaler:** "4K and 8K upscaling"; frame interpolation "at 60 or 120 fps"; batch processing. Underlying model not named on the page. <https://higgsfield.ai/ai-video-upscaler>
- **ByteDance Upscale (Jun 14, 2026):** "Raises video to 4K with frame interpolation up to 60fps in one pass."
- **FLUX 3 Video Upscaler (Aug 27, 2026):** "Raises the resolution of video while keeping motion smooth and audio in sync."
- **Other video ops:** remove object from video, remove text from video, video background changer, video background remover, video face swap, video extender, video sharpener, slow-motion maker, add text to video, video-to-video, AI video translator. (Routes present in the marketing sitemap: <https://higgsfield.ai/sitemap-marketing.xml>)

### 2.16 AI Motion Design

- **What it does:** "Turn text into high-fidelity animation. Create data-driven infographics, kinetic typography, and logo reveals that look hand-crafted by pros." <https://higgsfield.ai/ai-motion-design>
- **Inputs:** chat prompt + optional "logos, SVGs, images, or footage".
- **Distinctive mechanic:** "Edit the code, not the pixels" — a visual editor over generated code, not a diffusion frame stack. Controls include exact Hex/RGB colour input, social-platform safe zones, easing curves, font selection.
- **Output:** up to 4K. Individual motion-preset names **UNVERIFIED** (page references a "Motion Presets" library without naming entries).

### 2.17 Other named products (from changelog / sitemap)

| Product | Description (verbatim where quoted) | Source |
|---|---|---|
| **Faceless Studio** (Aug 20, 2026) | "Generates animated faceless videos in three steps, across four themes: **Education, History, Kids, and Storytelling**." | changelog |
| **Shorts Studio** (Jun 30, 2026) | "Restyles your own footage into a completely new look." | changelog |
| **Higgsfield Explainer** (Jul 2, 2026) | Standalone tool (was a Supercomputer/MCP skill) for narrative video from text and URLs | changelog, `/explainer-intro` |
| **Higgsfield Gaming / Games** (Jun 10, 2026) | "turns a description into a browser-playable game"; multiplayer games; GPT-6 Astra: "Turn a single prompt into a playable 3D game. Story, mechanics, and every asset included" | changelog, homepage |
| **Higgsfield Chat** | "Social Network for Collaborative AI" | blog |
| **Higgsfield Academy** (Jul 14, 2026) | Interactive courses, video-lesson format | changelog |
| **Higgsfield Earn** | Monetisation for AI influencers | blog |
| **Virality Predictor** | Scores virality potential / engagement / attention hold | Marketing Studio doc, `/apps` |
| **Similarity/content scoring** | "How Higgsfield's Similarity-Scoring Feature Works" | blog |
| **Elements** | Reusable characters, locations, props across generations | Cinema Studio doc |

### 2.18 Integrations surface

- **MCP:** "Image and video generation (all models)", "Image and video upscaling", "Background removal (image and video)", "Expand image (outpaint) and expand video (reframe)", "Kling 3.0 Motion Control", "Soul characters and reference Elements", "Audio: voiceover, voice cloning, voice change, video dubbing", "Personal Clipper (YouTube videos into short clips)", "Check credit balance, list generations and uploads". Not available via MCP: "Unlimited model access", "Free generations". <https://higgsfield.ai/creator-hub/help-center/integrations/how-do-i-connect-higgsfield-to-ai-agent>
- **CLI + Skills:** "generate from Claude Code, Cursor, or Codex without opening the website".
- **Host-app plugins:** Adobe After Effects (Jul 13, 2026), Photoshop (Jun 13, 2026), DaVinci Resolve (Jun 7, 2026), Blender (Aug 21, 2026), Figma/FigJam (Jun 2, 2026 — "Image generation across models, Vector Generation (SVG)"), Minecraft (Jun 3, 2026).
- **Important credit rule:** "everything generated through MCP deducts credits, regardless of your plan" — Unlimited only applies on higgsfield.ai itself. <https://higgsfield.ai/creator-hub/help-center/integrations/what-is-higgsfield-mcp>

---

## 3. THE PRESET TAXONOMY (the core deliverable)

Every name below is transcribed verbatim from the cited public gallery page. **~370 named presets across 6 galleries.** This is the asset VYREALM most needs to mirror, because it is the product-shaped layer, not the model layer.

### 3.1 Camera Controls — 65 entries
Source: <https://higgsfield.ai/camera-controls> (page title: "Higgsfield Camera Controls – 50+ Cinematic AI-Motion Presets"; embedded video schema marks clips as `PT10S`, i.e. 10 seconds, `video/mp4`)

```
General · Eyes In · Bullet Time · Aerial Pullback · Arc Left · BTS · Buckle Up ·
Car Chasing · Car Grip · Crane Down · Crane Over The Head · Crane Up ·
Crash Zoom In · Crash Zoom Out · Dolly In · Dolly Left · Dolly Out · Dolly Right ·
Dolly Zoom In · Dolly Zoom Out · Double Dolly · Dutch Angle · Eating Zoom ·
Fisheye · Flying Cam Transition · Focus Change · FPV Drone · Glam · Handheld ·
Head Tracking · Hero Cam · Hyperlapse · Incline · Jib down · Jib up · Lazy Susan ·
Low Shutter · Mouth In · Object POV · Overhead · Pan Left · Pan Right ·
Rapid Zoom In · Rapid Zoom Out · Road Rush · Robo Arm · Snorricam · Static ·
Super Dolly In · Super Dolly Out · Through Object In · Through Object Out ·
Tilt Down · Tilt up · Timelapse Glam · Timelapse Human · Timelapse Landscape ·
Whip Pan · Wiggle · YoYo Zoom · 360 Orbit · Zoom In · Zoom Out · Arc Right ·
3D Rotation
```

### 3.2 VFX / Effects — 100 entries
Source: <https://higgsfield.ai/effects>

```
Earth Zoom Out · Eyes In · Turning Metal + Melting · Building Explosion ·
Face Punch · Turning Metal + Eyes In · Diamond · Duplicate · Roll Transition ·
Acid · Air Bending · Animalization · Aquarium · Atomic · Balloon · Black Tears ·
Buddy · Censorship · Clone Explosion · Collage · Color Rain · Column Wipe ·
Cotton Cloud · Cyborg · Disintegration · Display Transition · Earth Element ·
Earth Wave · Explosion · Fast Sprint · Fire Element · Firelava · Firework ·
Flame On · Flame Transition · Flying Cam Transition · Freezing · Garden Bloom ·
Gas Transformation · Giant Grab · Glitch · Glow Trace · Glowing Fish ·
Gorilla Transfer · Group Photo · Hair Style · Hand Transition · Head Explosion ·
Head Off · Hero Flight · Hole Transition · Horror Face · I Can Fly · Ice Rose ·
Illustration Scene · Innerlight · Intermission · Jump Transition · Levitation ·
Live Concert · Look, Boom! · Luminous Gaze · Melt Transition · Money Rain ·
Monstrosity · Mouth In · Multiverse · Mystification · Nature Bloom ·
Northern Lights · Objects Around · Pizza Fall · Plasma Explosion · Point Cloud ·
Polygon · Portal · Raven Transition · Saint Glow · Sakura Petals ·
Seamless Transition · Set on Fire · Shadow · Shadow Smoke · Smoke Transition ·
Spiders from Mouth · Splash Transition · Starship Troopers · Tattoo Animation ·
Thunder God · Train Rush · Trucksition · Turning Metal · Visor X · Water Bending ·
Water Element · Werewolf · Wireframe · Wonderland · X-Ray · 3D Rotation
```

### 3.3 Viral Presets — 50 displayed + 12 schema-only = 62 entries
Source: <https://higgsfield.ai/viral-presets> (changelog Aug 7, 2026: "Thirteen new presets are live in the Viral Presets section, built around current short-form trends")

Displayed:
```
Agamemnon · Cold vision · Particles · Canvas · Superstar · MOONWALK ·
Dolphin Ride · Ocean · Monet Muse · Bubbles · ORBIT 360 · EARTH ZOOM ·
MIGHTY FIGHTER · Palette · Argus · Skatedog · Lost in a Book · RACE TRACK ·
Ink Riot · FAIRYTALE CASTLE · Pigeons · BLUE DEPTH · 2000'S PAPARAZZI · Noir ·
SELFIE TWIN · 3D RENDER · Acid · Paper · Fallen Angel · Windows · Tracking ·
Pearl earring · Overexposed · Multiverse · Casual Monster Slayer · Sketch ·
Magazine · Cannabis · ACTION FIGURE · Flash comic · Bullet time · Comic ·
Cyclope · LSD · Knight's Diary · Fragments · STICKER PEEL · Akrill ·
Penguin Ride · ORBITAL PRESENCE
```
Present in page schema but not rendered in the visible grid:
```
Random Glow · Toxic · Broken mirror · Hand paint · Lava · Marble · Modern ·
Puffin Ride · Origami · Two color · Ultraviolet · Vintage
```

### 3.4 Soul image style presets — ~100 entries
Source: <https://higgsfield.ai/soul> (page describes "a hyper-realistic, fashion-grade AI photo model with 50+ aesthetic presets")

```
General · Duplicate · Bimbocore · 0.5 Selfie · Ring Selfie · Afterparty Cam ·
Amalfi Summer · Angel Wings · Artwork · Avant-Garde · Babydoll Makeup ·
Bike Mafia · Birthday Mess · Bleached Brows · Burgundy Suit · CCTV ·
Clouded Dream · Coquette Core · Creatures · Crossing the Street ·
Digital Camera · dmv · Double Take · Eating Food · Elevator Mirror · Escalator ·
Fairycore · Fashion Show · Fireproof · Fish-Eye Twin · Fisheye · Flight Mode ·
Foggy Morning · Gallery · Geominimal · Giant Accessory · Giant People ·
Glazed Doll Skin Makeup · Glitch · Gorpcore · Graffiti · Green Editorial ·
Grillz Selfie · Grunge · Hair Clips · Hallway Noir · Help It's Too Big ·
Indie sleaze · Invertethereal · iPhone · It's French · Japandi · Library ·
Long Legs · Medieval · Mixed Media · Movie · Mt. Fuji · Nail Check ·
Nicotine Glow · Night Beach · Night Rider · Object Makeup · Office Beach ·
Overexposed · Paper Face · Pixelated Face · Quiet Luxury · Rainy Day ·
Realistic · Red Balloon · Rhyme & Blues · Sand · Sea Breeze · Self-Care ·
Shoe Check · Sitting on the Street · Spotlight · Static Glow · Street View ·
Subway · Sunbathing · Sunset Beach · Swords Hill · Through the Glass ·
tokyo drift · Tokyo Street Style · Tumblr · Vintage Photo Booth · Y2K ·
Y2K Posters · 0.5 Outfit · 2000s Cam · 2000s Fashion · 2049 · 360 Cam ·
505room · 7\ · 90's Editorial · 90s Grain
```
(Preset *categories* inside the Soul UI, per the help centre: General, TikTok Core, Instagram Aesthetics, Beauty, Mood, Camera Photo, Graphic Art.)

### 3.5 UGC templates — 45 entries
Source: <https://higgsfield.ai/ugc> (clips ~10 s, MP4)

```
Angry Mode · Aquarium · Atomic · Ballet · Beach Ride · Beast Appearance · BTS ·
Clothes Rain · Color Rain · Cotton Cloud · Crying · Eating · Eating Zoom ·
Explosion · Firework · Fix and pose · Gas Transformation · Giant Grab ·
Group Photo · Hair Style · Handheld Run · Happy · Happy Mode · Money Rain ·
Morning routine · Motor Ride · Northern Lights · Outfit Check · Outfit Switch ·
Peak Moment · Pizza Fall · Plate Check · Pool Jump · Saint Glow · Sand Cut ·
Selfie · Selfie Outfit · Selfie Posing · Shocked · Static Posing · Sunglasses ·
Timelapse Glam · Timelapse Human · Train Rush · Yacht
```

### 3.6 Higgsfield Apps catalogue — 40 named apps in 8 categories
Source: <https://higgsfield.ai/apps>

| Category | Apps |
|---|---|
| Professional | Virality Predictor · Expand image · Angles 2.0 · Shots · Transitions |
| Enhance & Style | Skin Enhancer · AI Stylist · Relight · Outfit Swap · Style Snap |
| Face & Identity | Face Swap · Headshot Generator · Character Swap 2.0 · Recast · Video Face Swap |
| Video Editing | ClipCut · Urban Cuts · Video Background Remover · Breakdown · Japanese Show |
| Ads & Products | Click to Ad · Billboard Ad · Bullet Time Scene · Truck Ad · Bullet Time White |
| Games & Characters | Game Dump · Nano Strike · Nano Theft · Simlife · Plushies |
| Extras | AI Meme Generator · Background Remover · Micro-Beasts · Signboard · Paint App |
| Trending Templates | On Fire · Skibidi · Mukbang · Cloud Surf · Idol |

### 3.7 Recraft V4 styles — 4 named
Source: <https://higgsfield.ai/recraft-v4-styles> — `Product · Interview · Portrait · Campaign`. Page also refers to "a curated set of visual styles covering illustration, photography, and design directions" without naming them (**UNVERIFIED**).

### 3.8 Unresolved preset pools
- **229 motion presets** at `https://higgsfield.ai/motion/<uuid>` — names not exposed in the sitemap. **UNVERIFIED.**
- **33 mixed-media presets** at `https://higgsfield.ai/mixed-media-presets/preset/<uuid>` — same. **UNVERIFIED.**
- **DoP in-app preset library** — categorised (Effects / Basic Camera Control / Epic Camera Control / Catch the Pulse / Mix / New / Trending / Top Choice) but per-preset names live behind the app UI.

---

## 4. Model roster on Higgsfield (with what the site actually states)

| Model | Type | Stated specs | Source |
|---|---|---|---|
| Seedance 2.5 | video + native audio | "Up to 30 seconds per generation — in any aspect ratio from vertical 9:16 to widescreen 21:9"; "Up to 50 multimodal inputs — images and clips"; native 1080p and native 4K referenced; ambience/foley/score in the same pass; fps **UNVERIFIED** | <https://higgsfield.ai/seedance/2.5>, <https://higgsfield.ai/seedance-2-5-community> |
| Seedance 2.0 | video | "480p to 4K"; up to **9 images**, **3 video clips**, **3 audio files** per generation; aspect "Auto…or custom" | <https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-seedance> |
| Seedance 2.0 Fast | video | "480p to 720p" | same |
| Seedance 2.0 Mini | video | "480p to 720p"; "About twice as fast as Enhanced Seedance 2.0 Fast" | same + changelog |
| Kling 3.0 | video + audio | "4K, 3-15 seconds"; "Up to 6 camera cuts in a single generation"; dialogue/SFX/ambience native; EN/ZH/JA/KO/ES with accents; "Voice Binding locks unique voices to characters across 5 languages" | <https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-kling>, <https://higgsfield.ai/kling-3.0> |
| Kling 3.0 Turbo | video | "1080p, 3-15 seconds" | help centre |
| Kling 3.0 Motion Control | video | "1080p, 3-30 seconds" | help centre |
| Kling 3.0 Omni | video | "4K, 3-15 seconds" | help centre |
| Kling 3.0 Omni Edit | video edit | "1080p, 3-10 seconds" | help centre |
| Kling 2.6 | video + audio | "1080p, 5-10 seconds" | help centre |
| Kling O1 / O1 Video / O1 Video Edit / Motion Control / 2.5 Turbo / 2.1 / 2.1 Master | video | listed as variants; specs **UNVERIFIED** | help centre |
| Gemini Omni Flash / Gemini Omni 1.1 Flash | video gen + edit | "Native 720p at 24fps with optional 1080p upscaling"; "Default 8-second clips, extendable to 60 seconds through continuation"; aspect "16:9, 9:16, 1:1, and 4:5"; MP4 H.264; images ≤20 MB (PNG/JPG/WebP), video ≤60 s (MP4/MOV/WebM), audio ≤30 s (MP3/WAV); SynthID + C2PA embedded | <https://higgsfield.ai/gemini-omni-flash> |
| Veo 3.1 | video | "Crystal clear 4K generation with native cinematic visual flows" | <https://higgsfield.ai/ai-video> |
| Sora 2 | video | "Deep world simulation with accurate physics and object permanence" | <https://higgsfield.ai/ai-video> |
| Wan 2.7 | video | "The perfect balance of generation speed and visual richness" | <https://higgsfield.ai/ai-video> |
| Wan 3.0 / Wan 3.0 Prime | video | "Multi-subject consistency: faces, clothing, and details stay stable across frames" | changelog Aug 24, 2026 |
| Wan 2.5 Speak | lipsync | "480p–1080p with audio" | lipsync article |
| MiniMax Hailuo / H3 / H3 Max | video | "high-dynamic video at fast speeds"; H3 Max "caps at 768p, where base H3 reaches 2K" | help centre, changelog |
| Grok Imagine / Grok Video 1.5 | video | "synchronized audio"; 1.5 "Animates a still image while keeping the source composition and style" | help centre, changelog |
| Higgsfield DoP | image→video (proprietary) | 3 or 5 second clips | DoP article |
| Flux 3 | video + native audio | listed among native-audio models; also "FLUX 3 Video Upscaler" | lipsync article, changelog |
| Nano Banana | image edit | "up to 8 reference images" | <https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-nano-banana> |
| Nano Banana Pro | image | "up to native 4K"; up to 14 reference images | same |
| Nano Banana 2 | image | "up to 5 consistent characters + 14 stable objects"; up to 14 refs | same |
| Nano Banana 2 Lite | image | "~4 seconds per image, 1K resolution"; Thinking level High/Minimal | same |
| Soul / Soul 2.0 / Soul Cinema | image (proprietary) | AR 9:16, 3:4, 2:3, 1:1, 4:3, 16:9, 3:2; quality 1.5k or 2k; batch 1–4 | Soul article |
| Popcorn | multi-frame image | up to 8 frames; up to 4 refs | Popcorn article |
| Seedream 5.0 / 5.0 Pro / 5.0 Lite | image | "native 4K output straight from the prompt" | <https://higgsfield.ai/ai-image>, changelog |
| Recraft V4 / v4.1 | image / vector | "Varies light, mood, and composition across generations"; "strong typography and clean lines" | changelog |
| GPT Image / GPT Image 1.5 | image | "accurate text rendering or precise color" | help centre, blog |
| FLUX | image | "speed-optimized detail" | help centre |
| Z-Image | image | listed on Higgsfield via blog | blog |
| Seed Audio 1.0 | audio | "Generates speech, sound effects, and music together from a single prompt" | changelog |
| Eleven / MiniMax Speech / Seed Speech / VibeVoice / Qwen | TTS | "74+ languages" claim on `/ai-voice-generator` | audio pages |
| Sync Lipsync 3 | lipsync (v2v) | "up to 4K" | lipsync article |
| Infinite Talk | lipsync | "long-form video" | lipsync article |
| Kling Avatars 2.0 | lipsync | "longer clips" | lipsync article |
| Higgsfield Speak 2.0 | lipsync (proprietary) | "priority-queue speed" | lipsync article |

---

## 5. Pricing and credits — what is actually documented

**The official pricing page did not render its table to my fetch.** Everything below is either from Higgsfield's own help centre (mechanics) or third-party trackers (numbers). Treat the numbers as indicative and re-verify in a browser.

**Mechanics (official, verified):**
- Five credit types: Subscription credits (reset each cycle, do not roll over), Credit Pack credits (expire in 90 days), Auto-Refill credits (90 days), Promo credits (stated date), Boost Credits (90 days). <https://higgsfield.ai/creator-hub/help-center/credits/how-credits-work>
- "Subscription credits are always spent first. After that…the balance expiring soonest is used first."
- "Credits are deducted for all generations on web, MCP, CLI, Canvas, and Supercomputer: images, videos, re-rolls, and upscaling."
- "If you set the batch size to 2, 3, or 4 before generating, each output is charged separately." <https://higgsfield.ai/creator-hub/help-center/credits/what-uses-my-credits>
- **Higgsfield publishes no per-model credit table.** Repeatedly: "the exact cost is shown on the Generate button before you confirm."
- **Unlimited models:** mid and top plans include a rotating set; "the exact list and period for each model are shown on the plan's card on the Pricing page" — i.e. not documented in the help centre. Unlimited never applies via MCP/CLI.
- Concurrency Boost packs buy parallel generation slots; watermarks are tied to plan tier (article exists: "Why is there a watermark, and how do I remove it?").

**Third-party price snapshots (CONFLICTING — both cited):**

| Source | Plans |
|---|---|
| <https://www.usagepricing.com/blueprint/higgsfield> | Basic $9/mo (120 credits) · Pro $29/mo or $23/mo annual (600–900 via slider) · Max $79/mo or $59/mo annual (1,800–5,400 via slider) · Team $79/seat/mo or $65 annual (1,000 credits/seat, 2–9 seats) · Scale $215/seat/mo or $150 annual (2,500 credits/seat, 5–15 seats) · Enterprise custom. Also notes a briefly-shown ratio "Team $1 = 33 credits · Max $1 = 31 · Pro $1 = 27 · Basic $1 = 14", removed by 2026-08-28. |
| <https://www.blotato.com/blog/higgsfield-pricing> | Starter $19/mo (270 credits) · Plus $59/mo, $47 annual (1,200 credits) · Ultra $129/mo, $99 annual (3,000 credits). Conversion examples: 270 credits ≈ "about 15 Seedance 2.0 Fast videos"; 1,200 ≈ "about 53 Seedance 2.0 videos"; 3,000 ≈ "about 133". |

Higgsfield's own changelog corroborates the **Team/Scale** naming ("Scale, our Business plan for teams of 5 to 15, now includes unlimited models", Sep 3 2026), which suggests the usagepricing snapshot (Basic/Pro/Max/Team/Scale) is the more current tier structure. **Marked UNVERIFIED against the live page.**

---

## 6. TABLE A — Full Higgsfield capability inventory

One row per feature. "Specs" quotes the site where stated; blank/UNVERIFIED where it does not.

| # | Feature | What it does (1 line) | Inputs | Output specs | Named model(s) | Presets shipped | Credits |
|---|---|---|---|---|---|---|---|
| A1 | **Cinema Studio 4.0** | Simulated film studio producing edited multi-shot scenes, not raw clips | text; up to 50 refs (images/video/Elements/past takes); video ≤30 s | "Native 4K" (marketing) vs "up to 720p" (eng blog); ≤30 s; 21:9 optimised; fps UNVERIFIED | Seedance 2.5 + interchangeable video models; Soul Cinema; Soul Cast | 7 genres, 8 speed ramps, 3 new camera moves, 3 camera bodies, 7 grading params, 6 lighting presets, 4 pacing modes, era 60s–2020s | by length/res/model |
| A2 | **Marketing Studio** | Template-first ad/UGC/product-creative workspace | product image, product/site URL, reference ad, prompt, logo/SVG | video ≤15 s per generation; images; native audio + lipsync | not enumerated | 7 template categories incl. Studio/Lifestyle/With Model, Faceless/Talking Head/Silent, Hypermotion/2D Product Motion/Mixed Media/Motion Design | shown pre-generate |
| A3 | **Ad Multiplier** | One ad → many variants with new cast/wardrobe/locations/objects | existing video ad | UNVERIFIED | UNVERIFIED | — | UNVERIFIED |
| A4 | **Supercomputer** | Chat agent that decomposes a brief, routes models, assembles output | natural-language brief; refs | assembled multi-asset deliverables; 20 GB base storage | Soul, Cinema Studio, Seedance, Nano Banana + LLMs (Claude/GPT/Gemini/Grok/DeepSeek/GLM/Ox Alpha) | Skills: Product UGC, Faceless Video, Shorts Maker, YouTube Covers, Personal Clipper; use-cases: TV Commercials, Animated Infographics, Localization | per generation; free text tier |
| A5 | **Canvas** | Node-based infinite board chaining models into pipelines | prompt/reference/audio nodes | per-node model outputs | "Every Higgsfield model is available as a node" | saved workflow templates | only on node generation |
| A6 | **Higgsfield Apps + App Builder** | One prompt → deployed generative web app | prompt + template choice | hosted app w/ cover, icon, description | Higgsfield models wired automatically | 3 layouts (App detail / Preset / Studio); 40 published apps | builder pays; end-users pay own credits |
| A7 | **Soul / Soul 2.0** | Fashion-grade image generation with preset + moodboard + palette control | prompt, presets, moodboard (20+ images), Soul HEX, Soul ID, refs | 7 aspect ratios; 1.5k or 2k; batch 1–4 | Soul (proprietary) | ~100 named style presets in 7 categories | standard rates |
| A8 | **Soul Cinema** | Cinematic-grade film-look stills, era-aware | prompt or reference image | UNVERIFIED res | Soul family (base UNVERIFIED) | era awareness; HEX + ID built in | UNVERIFIED |
| A9 | **Soul ID** | Train a face once, reuse across all images and video | 20–80 photos of one person | consistent identity across generations; not downloadable | Soul family; usable as Seedance Element | — | UNVERIFIED |
| A10 | **Soul HEX** | Exact colour-palette lock across generations; also standalone | reference image / hex codes | palette-consistent output | Soul | — | UNVERIFIED |
| A11 | **Popcorn** | Storyboard generator: coherent multi-frame sequences | prompt + up to 4 image refs | up to 8 frames; AR 3:4, 2:3, 3:2, 1:1, 9:16 (+16:9 on landing page) | Higgsfield core (unnamed) | Manual mode, Auto mode | scales with frames |
| A12 | **DoP** | Proprietary image→video with cinematography-aware presets | keyframe image + preset + prompt (+seed, steps) | 3 s or 5 s clips | Higgsfield DoP (diffusion + RL) | 8 preset categories; 65 camera controls + 100 effects in public galleries | UNVERIFIED |
| A13 | **Genjutsu** | Motion transfer + point object/character/location swap in existing video | video 3–30 s; up to 40 ref images; prompt | preserves original motion/timing | UNVERIFIED | 2 modes only (Motion transfer, Objects swap) | shown pre-generate |
| A14 | **3D Jutsu** | Prompt/reference → editable interactive 3D scene → video | prompt or reference | objects, layout, lighting, cameras, animation | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| A15 | **AI Influencer** | Menu-driven virtual-persona builder | ~20 structured attribute menus across Builder/Face/Body/Style | stills up to 4K; animated video; talking-head w/ lipsync | Soul, Nano Banana, Seedance | species: humans, mammals, reptiles, fish, hybrids, aliens | varies by model/res/duration |
| A16 | **Speak / talking avatars** | Photo or video + script → lipsynced talking video | script, avatar (library/generated/selfie twin), voice | MP4 9:16, 1:1, 16:9 up to 4K; 74+ languages | Veo 3.1, Kling 2.6 Lipsync, Wan 2.5 Speak, Kling Avatars 2.0, Higgsfield Speak 2.0, Infinite Talk, Kling Lipsync, Sync Lipsync 3 | — | UNVERIFIED |
| A17 | **Higgsfield Audio** | TTS, voice change, voice cloning, translation/dubbing | text; MP3/WAV sample; existing clip | MP3, WAV, video-ready audio; translate 18 languages; TTS 74+ | Seed Audio, ElevenLabs, MiniMax Speech, Seed Speech, VibeVoice, Qwen | — | UNVERIFIED |
| A18 | **Image editing suite** | Inpaint, relight, upscale, enhance, angles, colour grade, expand, remove | JPG/PNG/WebP up to 4K | up to 4K (4096×4096); AR 1:1, 9:16, 16:9, 3:4, 4:3 | Nano Banana Pro, Seedream 5.0 | Angles 2.0, Style Snap, Skin Enhancer, Relight, Outfit Swap, etc. | UNVERIFIED |
| A19 | **Layers** | Decompose a flat image into subject/background/detail layers | image ≤4K | layered edit, alpha-clean cutouts, 4K upscale, relight, text edit | Seedream 5.0 + Nano Banana Pro | draw-to-edit | UNVERIFIED |
| A20 | **Video upscale / restore** | 4K–8K upscale + frame interpolation | any clip | "4K and 8K upscaling"; "60 or 120 fps" interpolation | ByteDance Upscale, FLUX 3 Video Upscaler | — | UNVERIFIED |
| A21 | **AI Motion Design** | Text → kinetic typography, infographics, logo reveals ("edit the code, not the pixels") | prompt + logos/SVGs/images/footage | up to 4K | UNVERIFIED | "Motion Presets" library (names UNVERIFIED) | UNVERIFIED |
| A22 | **Faceless Studio** | 3-step animated faceless videos | prompt/script | UNVERIFIED | UNVERIFIED | 4 themes: Education, History, Kids, Storytelling | UNVERIFIED |
| A23 | **Shorts Studio** | Restyle your own footage into a new look | user footage | UNVERIFIED | UNVERIFIED | — | UNVERIFIED |
| A24 | **Explainer** | Text/URL → narrative explainer video | text, URL | UNVERIFIED | UNVERIFIED | — | UNVERIFIED |
| A25 | **Personal Clipper** | YouTube long-form → short clips | YouTube URL | short clips | UNVERIFIED | — | credits (MCP-available) |
| A26 | **Virality Predictor** | Scores virality potential, engagement, attention hold | creative asset | score | UNVERIFIED | — | UNVERIFIED |
| A27 | **Elements** | Reusable characters/locations/props referenced across generations | uploaded or generated assets | reusable reference objects | Cinema Studio, Kling (`@element-tags`), Seedance | — | n/a |
| A28 | **Higgsfield Gaming / GPT-6 Astra** | One prompt → browser-playable (3D/multiplayer) game with assets | prompt | playable game | GPT-6 Astra | — | UNVERIFIED |
| A29 | **MCP / CLI / Skills** | Drive the whole suite from Claude, ChatGPT, Cursor, Codex | agent calls | all web models except Unlimited/free gens | all | — | always credits, standard rates |
| A30 | **Host-app plugins** | Generate inside After Effects, Photoshop, DaVinci Resolve, Blender, Figma/FigJam, Minecraft | host-app assets | in-app generation, SVG vector in Figma | all | — | credits |
| A31 | **Community / Library / Projects / Chat** | Public creator profiles, asset library w/ folders + favourites, shared projects, social layer | — | — | — | — | free |
| A32 | **Academy / Film Festival / Grants / Affiliate** | Courses; $1,000,000 prize festival; up to 100k-credit grants; up to 25% affiliate commission | — | — | — | — | — |

---

## 7. TABLE B — Closest LOCAL open-source equivalent (RTX 3050 Laptop 6 GB VRAM / 16 GB RAM)

Verdict key: **DIRECT-EQUIVALENT** = comparable capability, confirmed to run in ≤6 GB · **DEGRADED-EQUIVALENT** = capability exists locally but at materially lower res/length/quality/speed, or VRAM fit is plausible-but-unproven · **NO-LOCAL-EQUIVALENT** = nothing open-source does this at usable quality on this hardware.

| Higgsfield feature | Local OSS equivalent | Model / repo | Quant + VRAM | License | Verdict |
|---|---|---|---|---|---|
| A1 Cinema Studio (multi-shot 4K/30 s) | No integrated equivalent; nearest is a ComfyUI graph chaining T2I → I2V → upscale → interpolate → ffmpeg concat | ComfyUI <https://github.com/comfyanonymous/ComfyUI> ("smart VRAM and RAM management, model offloading, and support for quantized models") | n/a (orchestrator) | GPL-3.0 | **NO-LOCAL-EQUIVALENT** as a product; **DEGRADED-EQUIVALENT** as a hand-built pipeline. Nothing local generates a coherent 30 s multi-shot 4K scene on 6 GB. |
| A1/A12 image→video short clips | **FramePack** — the single best 6 GB match found | <https://github.com/lllyasviel/FramePack> — "To generate 1-minute video (60 seconds) at 30fps (1800 frames) using 13B model, the minimal required GPU memory is **6GB**"; supports "RTX 30XX, 40XX, 50XX" | fp16/bf16, 6 GB stated | Apache-2.0 | **DIRECT-EQUIVALENT (with a speed tax).** Reference speed is "2.5 seconds/frame (unoptimized) or 1.5 seconds/frame (teacache)" on an **RTX 4090** — a 3050 laptop will be several times slower, so budget hours, not minutes, per minute of video. |
| A1/A12 text→video | **Wan 2.2 TI2V-5B**, GGUF-quantised | <https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B> (Apache-2.0; 720P 1280×704, **24 FPS, 5 seconds**) — but the model card says it "can run on a GPU with at least **24GB VRAM** (e.g, RTX 4090)". GGUF: <https://huggingface.co/QuantStack/Wan2.2-TI2V-5B-GGUF> (apache-2.0) with Q4_K_M = **3.43 GB**, Q3_K_M = 2.55 GB, Q2_K = 1.85 GB | Q4_K_M weights fit; runtime peak VRAM on 6 GB **UNVERIFIED** | Apache-2.0 | **DEGRADED-EQUIVALENT.** Weights fit; whether activations + VAE decode fit 6 GB is unproven. Expect 480p and short clips. |
| A1 higher-quality T2V | **Wan 2.2 T2V-A14B** GGUF | <https://huggingface.co/QuantStack/Wan2.2-T2V-A14B-GGUF> — smallest quant Q2_K is **5.3 GB**, Q3_K_S 6.51 GB | Q2_K 5.3 GB leaves ~0.7 GB headroom | Apache-2.0 | **NO-LOCAL-EQUIVALENT at 6 GB** in practice. Q2_K also degrades quality badly. Skip. |
| A1 fast T2V/I2V | **LTX-Video** (2B distilled) | <https://huggingface.co/Lightricks/LTX-Video> — "produces 30 FPS videos at a 1216×704 resolution faster than they can be watched"; "works best on resolutions under 720 x 1280 and number of frames below 257"; 2B distilled variants exist | VRAM figure **UNVERIFIED** for 6 GB; 2B is the realistic candidate | **LTX-Video-Open-Weights-License-0.X** (not OSI-standard — read before commercial use) | **DEGRADED-EQUIVALENT.** Best speed/VRAM ratio in the class; licence needs a read. |
| A7/A8 Soul (fashion-grade stills) | **SDXL + LoRA stack**, or **Z-Image-Turbo**, or **FLUX.1-schnell GGUF** | Z-Image-Turbo <https://huggingface.co/Tongyi-MAI/Z-Image-Turbo> — apache-2.0, **6B**, 1024×1024, "only 8 NFEs", but "fits comfortably within **16G VRAM** consumer devices". FLUX.1-schnell <https://huggingface.co/black-forest-labs/FLUX.1-schnell> — apache-2.0, 12B, docs recommend `enable_model_cpu_offload()` | Z-Image: 16 GB stated, 6 GB **UNVERIFIED**. FLUX GGUF Q4 + CPU offload is the pragmatic 6 GB path | Apache-2.0 both | **DEGRADED-EQUIVALENT.** SDXL (6 GB-proven for years) is the safe base; Z-Image/FLUX are the quality target but need offload. |
| A7 ~100 style presets | Presets are just prompt+LoRA+sampler bundles — trivially reproducible as JSON/YAML preset files over any local T2I | n/a — this is VYREALM's own work | n/a | n/a | **DIRECT-EQUIVALENT.** *This is the cheapest, highest-leverage thing to copy.* |
| A9 Soul ID (identity lock) | **LoRA fine-tune** (kohya_ss / ai-toolkit) for SDXL, or **PuLID** for zero-shot | PuLID <https://github.com/ToTheBeginning/PuLID> — Apache-2.0; PuLID-FLUX "can run on a 16GB graphic card" and supports "12GB graphic card" with optimisations | PuLID: 12 GB minimum stated → **does not fit 6 GB**. SDXL LoRA training on 6 GB is the fallback | Apache-2.0 | **DEGRADED-EQUIVALENT.** Zero-shot identity (PuLID/InstantID on FLUX) is out of reach at 6 GB; SDXL LoRA training + IP-Adapter is the workable path (slow, but it is exactly the "train once, reuse" model Soul ID uses). |
| A10 Soul HEX (palette lock) | Post-hoc palette transfer (LAB/histogram matching, ffmpeg/OpenCV) + palette-conditioned prompting | n/a — deterministic image processing, no model needed | negligible | n/a | **DIRECT-EQUIVALENT.** Higgsfield's HEX is a colour-consistency guarantee; a deterministic grade achieves the same end more reliably. |
| A11 Popcorn (8-frame consistent storyboard) | ComfyUI batch graph: fixed seed + IP-Adapter/reference latents + Qwen-Image-Edit chaining | Qwen-Image-Edit-2509 <https://huggingface.co/Qwen/Qwen-Image-Edit-2509> — Apache-2.0, **20B params**, "Optimal performance is currently achieved with **1 to 3 input images**" | 20B on 6 GB requires aggressive GGUF + offload; **UNVERIFIED** | Apache-2.0 | **DEGRADED-EQUIVALENT.** Achievable with SDXL + IP-Adapter today; Qwen-Image-Edit is the quality target but 20B is heavy for 6 GB. |
| A18 Nano-Banana-style multi-ref image editing | **Qwen-Image-Edit-2509** is the closest open answer (person+person, person+product, person+scene) | as above | as above | Apache-2.0 | **DEGRADED-EQUIVALENT.** 1–3 refs vs Higgsfield's 8–14. |
| A12 camera-move presets (65 names) | ComfyUI + Wan/LTX prompt-preset library; **camera-control models** (CameraCtrl, MotionCtrl, Uni3C, ATI) exist but were not verified for 6 GB in this pass | **UNVERIFIED** — no 6 GB figures found | varies | **DEGRADED-EQUIVALENT.** The *taxonomy* (dolly in, crash zoom, orbit, Snorricam…) is free to copy as prompt templates. True 3D camera conditioning at 6 GB is unproven. |
| A12 100 VFX effects | Two-track: (a) prompt-template presets over I2V; (b) deterministic compositing in ffmpeg/OpenCV/Blender for transitions, glitch, X-ray, wipes | n/a | negligible for track (b) | n/a | **DEGRADED-EQUIVALENT.** Roughly a third of the 100 effects (transitions, glitch, wipes, colour rain, overexposed) are compositing, not generation — those are **DIRECT-EQUIVALENT** and cheap. |
| A13 Genjutsu (motion transfer / object swap) | **Wan VACE** (video editing/reference-to-video) via ComfyUI; AnimateDiff vid2vid + ControlNet/DWPose | Wan VACE GGUF repos exist under city96/QuantStack but <https://huggingface.co/city96/Wan2.1-VACE-14B-gguf> returned **HTTP 401** to my fetch — repo id and quant sizes **UNVERIFIED**. 14B class quants are ~5–9 GB (see A14B sizes above) | 14B VACE at 6 GB: **not realistic**. 1.3B VACE variant is the candidate — **UNVERIFIED** | Apache-2.0 (Wan family) | **DEGRADED-EQUIVALENT** at best. Object swap on short low-res clips is feasible; 30 s / 40-reference motion transfer is not. |
| A16 talking-head / lipsync | **MuseTalk** — near-exact hardware match | <https://github.com/TMElyralab/MuseTalk> — MIT, "no limitation for both academic and commercial usage"; runs on "an **NVIDIA GeForce RTX 3050 Ti Laptop GPU with 4GB VRAM**", 8-second video in ~5 minutes (fp16); face region 256×256; "30fps+ on an NVIDIA Tesla V100" | 4 GB confirmed | MIT | **DIRECT-EQUIVALENT.** The single strongest local match in this whole table — the cited hardware is essentially your machine. Limitation: 256×256 face region (upscale after). |
| A16 higher-quality lipsync | **LatentSync** | <https://github.com/bytedance/LatentSync> — Apache-2.0; "Minimum VRAM for inference: **8 GB** with LatentSync 1.5" and "**18 GB** with LatentSync 1.6"; 1.6 trained at 512×512 | 8 GB minimum | Apache-2.0 | **NO-LOCAL-EQUIVALENT at 6 GB.** Rules itself out explicitly. |
| A16 photo→talking video | **SadTalker** | <https://github.com/OpenTalker/SadTalker> — Apache-2.0 (non-commercial restriction removed); 256px and 512px face renderers | VRAM **UNVERIFIED** but historically runs on 6–8 GB | Apache-2.0 | **DEGRADED-EQUIVALENT.** Older/stiffer motion than Higgsfield's avatars. |
| A17 TTS (commercial-safe) | **Kokoro-82M** | <https://huggingface.co/hexgrad/Kokoro-82M> — **apache-2.0**, "82 million parameters", 8 languages / 54 voices | 82M — runs on CPU comfortably | Apache-2.0 | **DIRECT-EQUIVALENT** for quality-per-byte, **DEGRADED** on language count (8 vs Higgsfield's claimed 74+). |
| A17 voice cloning | **XTTS-v2** or **F5-TTS** | XTTS-v2 <https://huggingface.co/coqui/XTTS-v2> — "**Coqui Public Model License**"; 17 languages; clones from "just a quick **6-second** audio clip". F5-TTS <https://github.com/SWivid/F5-TTS> — "code is released under MIT License. The pre-trained models are licensed under the **CC-BY-NC**" | both run on <6 GB in practice; exact figures **UNVERIFIED** | XTTS: Coqui CPML (restrictive). F5-TTS weights: **CC-BY-NC (non-commercial)** | **DIRECT-EQUIVALENT technically, LICENCE-BLOCKED commercially.** Both clone from a short sample as Higgsfield does; neither weight set is cleanly commercial. Flag this. |
| A17 translation / dubbing | faster-whisper (ASR) → local MT → Kokoro/XTTS re-voice → MuseTalk re-lipsync | multi-stage, all small models | fits 6 GB | mixed | **DEGRADED-EQUIVALENT.** Achievable, but it is a 4-stage pipeline vs one Higgsfield button. |
| A17 Seed Audio (voice + SFX + music one-pass) | **MMAudio** (video-synced foley) + **Stable Audio Open** (SFX/music) | MMAudio <https://github.com/hkchengrex/MMAudio> — "Inference only takes around **6GB** of GPU memory (in 16-bit mode)"; code MIT, "checkpoints are released on Hugging Face under the **CC-BY-NC 4.0** license". Stable Audio Open <https://huggingface.co/stabilityai/stable-audio-open-1.0> — "Stability AI Community License", "up to 47s stereo audio at 44.1kHz", 1B params | MMAudio 6 GB confirmed | MMAudio weights **CC-BY-NC**; Stable Audio = Community License (commercial needs separate terms) | **DIRECT-EQUIVALENT capability, LICENCE-CONSTRAINED.** MMAudio's 6 GB figure is an exact fit and it does the video-synced foley Higgsfield sells as "same-pass audio". |
| A20 upscale / restore | **Real-ESRGAN** (+ GFPGAN/CodeFormer for faces) | <https://github.com/xinntao/Real-ESRGAN> — **BSD-3-Clause**; variants RealESRGAN_x4plus, x2plus, anime_6B, realesr-general-x4v3, AnimeVideo-v3; tiled inference for low VRAM | tiling makes 6 GB fine | BSD-3-Clause | **DIRECT-EQUIVALENT.** Fully permissive, fully local, 4K achievable via tiling. 8K is a time problem, not a capability problem. |
| A20 frame interpolation to 60/120 fps | **RIFE** (and FILM) via ComfyUI-Frame-Interpolation | RIFE runs comfortably on 6 GB; specific VRAM figure **UNVERIFIED** in this pass | small | MIT (RIFE) | **DIRECT-EQUIVALENT.** |
| A5 Canvas (node graph) | **ComfyUI** | <https://github.com/comfyanonymous/ComfyUI> — GPL-3.0; supports SD1.5/SDXL/SD3.5/Flux.1/Flux.2/Qwen Image/Hunyuan Image, Flux Kontext/HiDream/OmniGen2 editing, Wan 2.1/2.2, LTX-Video 2/2.3, HunyuanVideo 1.5, CogVideoX, Mochi, ACE-Step/Stable Audio 3, Hunyuan3D 2.1, SUPIR, SAM 3 | orchestrator | **GPL-3.0 — copyleft. If VYREALM ships ComfyUI in-process, VYREALM inherits GPL. Use it as a separate process over its HTTP API instead.** | **DIRECT-EQUIVALENT** functionally; **licence architecture warning**. |
| A4 Supercomputer (planning agent) | Local LLM (Ollama/llama.cpp) + a tool-calling planner driving the ComfyUI HTTP API | model choice depends on the 6 GB budget shared with the diffusion models — a 7–8B Q4 model needs ~4–5 GB, competing directly with image/video VRAM | timeshare, don't co-resident | varies | **DEGRADED-EQUIVALENT.** Architecturally straightforward; the real constraint is that the planner LLM and the generator cannot both hold VRAM. Plan for sequential load/unload. |
| A6 Apps / App Builder | Out of scope for a local studio (it is a hosting product) | — | — | — | **NO-LOCAL-EQUIVALENT** (and not worth mirroring). |
| A14 3D Jutsu | **TRELLIS** / **Hunyuan3D-2mini** | TRELLIS <https://github.com/microsoft/TRELLIS> — MIT, but "An NVIDIA GPU with at least **16GB** of memory is necessary". Hunyuan3D-2mini <https://huggingface.co/tencent/Hunyuan3D-2mini> — **tencent-hunyuan-community** licence, "0.6B shape generator", VRAM **UNVERIFIED** | TRELLIS: 16 GB → excluded | TRELLIS MIT; Hunyuan3D community licence (not OSI) | **NO-LOCAL-EQUIVALENT** for TRELLIS at 6 GB. Hunyuan3D-2mini (0.6B) is the only plausible candidate and is **UNVERIFIED**. |
| A21 AI Motion Design | **Not a diffusion problem** — Remotion / Motion Canvas / Manim / SVG+CSS animation driven by a local LLM writing code | pure CPU | MIT-family | **DIRECT-EQUIVALENT.** Higgsfield itself says "Edit the code, not the pixels" — so the local version is *better*, deterministic, and free of VRAM entirely. High-leverage. |
| A22 Faceless Studio | Local pipeline: script (LLM) → Kokoro TTS → stock/generated stills → Ken Burns + RIFE → ffmpeg | all small | mixed | **DIRECT-EQUIVALENT.** Faceless video is the easiest Higgsfield product to fully replicate locally. |
| A25 Personal Clipper | yt-dlp + faster-whisper transcript → LLM highlight selection → ffmpeg cut + reframe | CPU-bound | mixed | **DIRECT-EQUIVALENT.** |
| A26 Virality Predictor | No credible open equivalent; a local heuristic/classifier would be a guess dressed as a score | — | — | **NO-LOCAL-EQUIVALENT.** Do not ship a fake score. |
| A27 Elements (reusable refs) | Local asset DB + IP-Adapter/LoRA registry + prompt-token substitution | negligible | n/a | **DIRECT-EQUIVALENT.** Pure application logic. |
| A2 Marketing Studio (URL→ad) | Local scrape (trafilatura/readability) → brand-kit extraction (colour quantisation, logo crop) → template render | CPU | mixed | **DEGRADED-EQUIVALENT.** The URL→brand-signal step is ordinary scraping; the ad templates are yours to author. |
| A28 Games from a prompt | Local LLM writing a Phaser/Three.js scaffold | LLM-bound | mixed | **DEGRADED-EQUIVALENT** — and off-mission for a video studio. |

---

## 8. Strategic read for VYREALM

1. **The preset taxonomy is free to take and is the highest-value artefact in this document.** 65 camera moves + 100 VFX + 62 viral + ~100 Soul styles + 45 UGC templates = ~370 names, all of which are prompt/parameter bundles, not models. Ship them as a versioned preset pack. This alone closes most of the perceived gap.
2. **The three products that map cleanly to 6 GB hardware are: lipsync (MuseTalk, confirmed on a 3050 Ti laptop 4 GB), upscale/interpolate (Real-ESRGAN + RIFE, BSD/MIT), and faceless/motion-design video (code-driven, zero VRAM).** Build those first — they are DIRECT-EQUIVALENT and cheap.
3. **The honest hard walls at 6 GB:** long multi-shot 4K video (A1), zero-shot identity injection on FLUX (PuLID needs 12–16 GB), high-quality lipsync (LatentSync needs 8–18 GB), 3D generation (TRELLIS needs 16 GB), and 14B-class video models (smallest useful quant is already 5.3 GB). Do not promise these.
4. **Licence landmines to design around now:** ComfyUI is **GPL-3.0** (isolate it behind HTTP, never link it), MMAudio and F5-TTS weights are **CC-BY-NC**, XTTS-v2 is under the **Coqui Public Model License**, Stable Audio Open is under a **Stability Community License**, LTX-Video uses its own **open-weights licence**, and Hunyuan3D uses a **Tencent community licence**. The clean-commercial core is: Wan (Apache-2.0), Qwen-Image-Edit (Apache-2.0), Z-Image (Apache-2.0), FLUX.1-schnell (Apache-2.0), Kokoro (Apache-2.0), FramePack (Apache-2.0), MuseTalk (MIT), Real-ESRGAN (BSD-3).
5. **FramePack is the headline finding for video.** It is the only video model in this survey whose own README states a **6 GB** minimum, for a full minute at 30 fps. Everything else in the T2V class either states ≥24 GB (Wan 5B) or leaves VRAM unstated. Treat FramePack as VYREALM's video spine and accept the wall-clock cost.

---

## 9. Consolidated gap list (things I could not verify)

- Higgsfield live pricing table, Unlimited-model roster per plan, and any per-model credit cost. (Client-rendered page.)
- Cinema Studio true max resolution — three official sources conflict (native 4K vs up to 720p).
- fps for every Higgsfield video model except Gemini Omni Flash (24 fps).
- Names of the 229 `/motion/` presets and 33 `/mixed-media-presets/` presets.
- Names of the 6 Cinema Studio lighting presets and the Cinema Studio lens list.
- Names of AI Motion Design presets and the full Recraft V4 style set.
- Underlying architecture of Soul, Soul Cinema, Speak 2.0, and Genjutsu.
- 3D Jutsu inputs/outputs/specs entirely.
- Higgsfield MCP formal tool schema (mcpservers.org returned HTTP 403).
- Local side: runtime peak VRAM (not file size) for Wan 2.2 5B GGUF, Qwen-Image-Edit-2509 GGUF, Z-Image-Turbo, LTX-Video 2B distilled, Wan VACE 1.3B, SadTalker, RIFE, and Hunyuan3D-2mini on a 6 GB card. The city96 VACE GGUF repo returned HTTP 401. Web-search budget for this session was exhausted before these could be closed — **these are the first things to verify before committing to an architecture.**

---

## 10. Source index

Higgsfield first-party:
<https://higgsfield.ai/> ·
<https://higgsfield.ai/sitemap.xml> ·
<https://higgsfield.ai/sitemap-marketing.xml> ·
<https://higgsfield.ai/motion/sitemap.xml> ·
<https://higgsfield.ai/mixed-media-presets/sitemap.xml> ·
<https://higgsfield.ai/creator-hub/help-center> ·
<https://higgsfield.ai/creator-hub/changelog> ·
<https://higgsfield.ai/creator-hub/help-center/getting-started/what-is-higgsfield> ·
<https://higgsfield.ai/creator-hub/help-center/getting-started/whats-in-my-higgsfield-account> ·
<https://higgsfield.ai/creator-hub/help-center/tools/which-higgsfield-tool-should-i-use> ·
<https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-cinema-studio> ·
<https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-marketing-studio-to-create-video-ads> ·
<https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-supercomputer> ·
<https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-canvas> ·
<https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-ai-influencer> ·
<https://higgsfield.ai/creator-hub/help-center/tools/what-are-higgsfield-apps> ·
<https://higgsfield.ai/creator-hub/help-center/ai-models/which-ai-model-should-i-use> ·
<https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-soul-to-generate-images> ·
<https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-create-and-use-a-soul-id-character> ·
<https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-seedance> ·
<https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-kling> ·
<https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-nano-banana> ·
<https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-popcorn> ·
<https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-dop> ·
<https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-lipsync-voiceover-and-aspect-ratios> ·
<https://higgsfield.ai/creator-hub/help-center/credits/how-credits-work> ·
<https://higgsfield.ai/creator-hub/help-center/credits/what-uses-my-credits> ·
<https://higgsfield.ai/creator-hub/help-center/credits/what-are-unlimited-models-and-which-plans-include-them> ·
<https://higgsfield.ai/creator-hub/help-center/integrations/what-is-higgsfield-mcp> ·
<https://higgsfield.ai/creator-hub/help-center/integrations/how-do-i-connect-higgsfield-to-ai-agent> ·
<https://higgsfield.ai/camera-controls> ·
<https://higgsfield.ai/effects> ·
<https://higgsfield.ai/viral-presets> ·
<https://higgsfield.ai/soul> ·
<https://higgsfield.ai/soul-cinema> ·
<https://higgsfield.ai/ugc> ·
<https://higgsfield.ai/apps> ·
<https://higgsfield.ai/ai-video> ·
<https://higgsfield.ai/ai-image> ·
<https://higgsfield.ai/image-editing> ·
<https://higgsfield.ai/higgsfield-layers> ·
<https://higgsfield.ai/storyboard-generator> ·
<https://higgsfield.ai/ai-motion-design> ·
<https://higgsfield.ai/cinematic-video-generator> ·
<https://higgsfield.ai/genjutsu> ·
<https://higgsfield.ai/higgsfield-genjutsu-presets> ·
<https://higgsfield.ai/seedance/2.5> ·
<https://higgsfield.ai/seedance-2-5-community> ·
<https://higgsfield.ai/kling-3.0> ·
<https://higgsfield.ai/gemini-omni-flash> ·
<https://higgsfield.ai/recraft-v4-styles> ·
<https://higgsfield.ai/ai-talking-avatar> ·
<https://higgsfield.ai/ai-voice-generator> ·
<https://higgsfield.ai/ai-video-upscaler> ·
<https://higgsfield.ai/blog> ·
<https://higgsfield.ai/blog/how-we-built-cinema-studio> ·
<https://higgsfield.ai/blog/The-AI-Storyboard-Generator-That-Feels-Like-Directing>

Third-party pricing (conflicting, flagged):
<https://www.usagepricing.com/blueprint/higgsfield> ·
<https://www.blotato.com/blog/higgsfield-pricing>

Open-source model sources:
<https://github.com/comfyanonymous/ComfyUI> ·
<https://github.com/lllyasviel/FramePack> ·
<https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B> ·
<https://huggingface.co/QuantStack/Wan2.2-TI2V-5B-GGUF> ·
<https://huggingface.co/QuantStack/Wan2.2-T2V-A14B-GGUF> ·
<https://huggingface.co/Lightricks/LTX-Video> ·
<https://huggingface.co/Qwen/Qwen-Image-Edit-2509> ·
<https://huggingface.co/Tongyi-MAI/Z-Image-Turbo> ·
<https://huggingface.co/black-forest-labs/FLUX.1-schnell> ·
<https://github.com/ToTheBeginning/PuLID> ·
<https://github.com/TMElyralab/MuseTalk> ·
<https://github.com/bytedance/LatentSync> ·
<https://github.com/OpenTalker/SadTalker> ·
<https://huggingface.co/hexgrad/Kokoro-82M> ·
<https://huggingface.co/coqui/XTTS-v2> ·
<https://github.com/SWivid/F5-TTS> ·
<https://github.com/hkchengrex/MMAudio> ·
<https://huggingface.co/stabilityai/stable-audio-open-1.0> ·
<https://github.com/xinntao/Real-ESRGAN> ·
<https://github.com/microsoft/TRELLIS> ·
<https://huggingface.co/tencent/Hunyuan3D-2mini>
