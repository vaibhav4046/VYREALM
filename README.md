# VYREALM

A local filmmaking application with Electron, a browser studio, SQLite projects and durable media workers. Core creation uses local models and software without API keys, subscriptions, credits or hosted rendering.

## Measured results on this laptop

VYREALM generated **three original five-second shots** through ComfyUI + Wan2.2 TI2V 5B Q4 on the RTX 3050 Laptop 6 GB / 16 GB RAM. The shots reuse a generated character reference. Sources are **1024 x 576 at 24 fps**, not native 1080p or 4K. Their measured generation times were 1,838, 1,717 and 1,413 seconds; maximum whole-device GPU memory was **5.85 GiB**. Earlier 512 x 288 runs were visually rejected.

The **Rainline** edit is `outputs/desktop/VYREALM_RAINLINE_TRAILER_1080P.mp4`: 15 seconds, 1920 x 1080, 360 frames, 24 fps, local Piper narration, timed procedural sound design and editable captions. Delivered audio measured -14.38 LUFS / -2.11 dBTP. One frame per second was inspected in `VYREALM_RAINLINE_CONTACT_SHEET.png`. Shot 2 follows the subject from behind; shot 3 has a restrained reaction rather than the complete requested shelter-entry action. These limitations are recorded, not scored away.

The new `outputs/desktop/VYREALM_RAINLINE_TRAILER_1080P_60FPS.mp4` contains **900 frames at 60 fps**, with the same 15.000-second audio bitstream. It is RIFE-interpolated from the 24 fps edit. Initial interpolation took 314 seconds; a 47-second caption-boundary repair reused the RIFE frames and two encoded shots. The first attempt remains rejected in history. The corrected export was inspected at one-second intervals, in-between frames and cut boundaries. See [measured interpolation evidence](docs/LOCAL_INTERPOLATION_2026-09-07.md).

Tiled Real-ESRGAN x4 and motion-compensated detail stabilization produced a separate **five-second 3840 x 2160 sample**, 120 frames, approximately 61 Mbps H.264. Enhancement took **1,078 seconds**. Its final edit is `outputs/desktop/VYREALM_LOCAL_GENERATION_4K.mp4`. This is not a 15-second UHD trailer. Workflows, provider history, frame hashes, source lineage and enhancement evidence remain in the job folders.

Piper narration and Whisper tiny.en transcription run locally on the CPU. The Playwright journey passed local-media import, narration, transcription, caption editing, landscape/portrait/square MP4 export, download and reopening, with no external browser requests. It labels the reused input as imported; the separate neural test proves actual local generation.

This establishes a working local route. It does not establish Higgsfield parity, native 4K detail, lip-sync, 100 finished films or macOS compatibility.

## Desktop demo on this configured PC

The working source application is available at http://127.0.0.1:4173/ on this PC. The current checkpoint adds format-aware original hooks, a bounded 120-variant planner, and a visible Format Lab with 36 validated formats, 105 format/platform routes, 59 camera controls, 35 looks and 20 FFmpeg-qualified transitions. Research sources and confidence limits remain in `docs/research` and `docs/VIRAL_FORMATS_RESEARCH_2026-09-07.md`. The updated package is [VYREALM-1.0.6-win-x64.exe](release/VYREALM-1.0.6-win-x64.exe). Its size, SHA-256 and immutable source/package comparison are recorded in `outputs/verification/installer-1.0.6-inventory.json`. It is unsigned and has **not** been installed. An earlier installer launch in this session was rejected by automatic approval review with “blocked by policy”; the package does not establish installed-app verification. The older installed version is not evidence for these updates.

1. Open the running VYREALM studio in the browser.
2. Open **Rainline - Original local trailer** to inspect the completed edit and expand **Source shots** for its model evidence.
3. In Timeline, edit captions, generate narration, select a canvas and choose **Render edit**.
4. **Download video** downloads the actual MP4. **Export portable** embeds project media in JSON; SQLite keeps revisions. JSON export supports individual assets up to 50 MB and 300 MB total media, and rejects oversized/incomplete bundles. The new `VYREALM_RAINLINE_60FPS_PROJECT.json` contains all 47 assets and 30 revisions; the earlier 24 fps bundle remains saved. Imported bundles retain historical documents and remap video, narration and audio-layer links; their media is labelled imported.
5. For a fresh idea, create a project with a detailed subject, setting and action and choose **Produce local film**. **Run real generation test** uses the fixed benchmark brief. Both routes produce one five-second shot. Missing models block the job instead of substituting Blender geometry.
6. Record a visual review, then use **Direct the next shot** to animate the retained character keyframe. Generated clips append to the timeline and retain their own evidence. Review identity and action before assembling the sequence.
7. **Sound design & audio layers** creates original local rain and scheduled sound cues. Set gain and timing, then render the edit. This is procedural audio synthesis, not neural audio or lip-sync.

8. For 60 fps, review a 24/30 fps export and choose **Interpolate export to 60 fps**. Settings → **Install local 60 fps tools** installs the pinned runtime and detects a Vulkan device, with a CPU fallback. The measured 15-second 1080p pass took about five minutes before a caption repair. The editable timeline remains at its source frame rate; re-render timeline changes before interpolating again.

9. From the MCP tools screen, `generate_variations` writes up to 256 original recipes across Instagram Reels, YouTube Shorts, films, long-form chapters, anime sequences, tech explainers, product demos and Astra demos. Each recipe contains a hook, story arc, camera direction, shot plan, delivery canvas and sound plan. It is saved as `planned` with `not-rendered` provenance until a real local provider or imported media is processed and passes review; the matrix is not a claim of 120 completed videos or guaranteed reach.

Generation can take tens of minutes. One GPU-heavy worker runs at a time. Models occupy about 8.3 GB; Python/CUDA, cached frames, enhancement intermediates and project media require additional space.

## Development

```powershell
npm install
npm run dev
```

Open http://127.0.0.1:4173/. `npm run mcp` exposes the same local app through optional stdio automation. End users do not require Codex, ChatGPT or MCP.

The existing application uses JavaScript modules and Vite; it has not been rebuilt in Next.js/TypeScript. `npm test` runs syntax and executable tests, not a TypeScript typecheck.

Settings contains a Windows x64 setup route with bundled uv, private Python, pinned code archives and resumable model downloads. The app installed new Python/CUDA and audio environments in an isolated folder, verified all model hashes, registered them, and started ComfyUI itself. That qualification reused cached code archives and checksum-verified model files; it was not a complete fresh network download or an installed desktop-app test. Allow 25 GB free. Existing runtime configurations are retained for rollback. Tiled upscaler setup remains separate. The earlier developer script `npm run setup:neural -- -InstallDir D:\VYREALM-runtime` still requires Git and uv.

## Verification

```powershell
npm test
npm run build
npm audit
```

The browser test is tests/local-engine-golden.spec.mjs. Set VYREALM_TEST_URL to an isolated local server, VYREALM_TEST_MEDIA to a licensed five-second clip, and optionally VYREALM_CHROMIUM to a compatible Chromium executable. Run `npx playwright test`. Evidence and screenshots are in outputs/verification.

The latest source checks pass 192 Node tests plus standalone acceptance suites, the production build, the browser golden journey (57.6 seconds) and a small real RIFE CPU/retry test. The source app also recovered its session after an engine restart without clearing the selected project. Format-aware viral hooks and the bounded variation matrix are available through MCP (`generate_hooks`, `generate_variations`) and are stored with the selected project revision. Format recipes include safe-area captions, bounded source extension, real sidechain audio graphs, renderable camera/grade instructions and explicit provenance for reused screen time.

Technical validation and operator visual review are distinct. Imported, locally generated, edited and enhanced media keep distinct provenance. 4K canvas resizing is labelled separately from Real-ESRGAN enhancement.

Local 60 fps interpolation passed a real 15-second 1080p export, and the CPU route passed a small fixture with cached retry. Full-resolution CPU speed and combined 4K/60 fps output remain unqualified. Lip-sync, dubbing, diarization, automatic highlights, automatic publishing and 100 finished catalogue films are incomplete. Unsupported MCP tools return diagnostics. macOS has not been verified. No account has been connected or used to publish.

See TASKS.md, docs/LOCAL_NEURAL_RESEARCH_2026-09-07.md and runtime/notices. Older fallback artifacts remain in history and are not accepted neural benchmarks.
