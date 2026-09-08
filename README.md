# VYREALM

A local creator studio for turning your footage and ideas into editable video projects. Plan in chat, work with shots and captions, add narration and sound, then export actual video files. Projects and media stay on your machine; optional online research and YouTube features are separate actions.

Source repository: [vaibhav4046/VYREALM](https://github.com/vaibhav4046/VYREALM).

VYREALM is an early Windows application. The editing and export workflow has been exercised end to end, including an installed 1.0.8 Windows application. Local cinematic generation, publishing and newer releases have separate qualification requirements.

## Start the basic studio

Download or clone this repository, then open PowerShell in its folder. Install **Node.js 24** first; version **24.12.0** was tested.

```powershell
node server.js
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The Creator workspace starts in Studio chat. Use **Upload footage**, describe the edit, then choose **Produce video**. Uploading creates a project when needed. Stop the server with `Ctrl+C`.

The basic browser studio uses Node's built-in modules, including SQLite. It boots without npm dependencies, AI models, an account, API keys or a GPU. A clean source snapshot was tested with empty user directories: the app loaded, created a project and reopened it with no browser errors or external browser requests. The browser test harness used an existing Playwright installation outside that snapshot.

By default, source runs save projects under `data/` in the repository. To choose another location before starting:

```powershell
$env:VYRELUM_DATA_DIR = Join-Path $env:LOCALAPPDATA 'VYREALM\projects'
$env:VYRELUM_RUNTIME_DIR = Join-Path $env:LOCALAPPDATA 'VYREALM\runtime'
node server.js
```

Keep using the same paths to reopen that library. The app listens on loopback, not your network interface.

## What works, and what needs setup

| Area | Current status |
|---|---|
| Studio chat and project context | Persistent conversations, character information and workflow plans; local-model replies require a configured model. A saved plan is not a rendered film. |
| Projects | SQLite revisions, local media import, portable project export/import and reopening verified. |
| Editing and export | Timeline, captions, sound layers, colour settings and landscape/portrait/square MP4 exports verified with original test media and FFmpeg. |
| Timeline controls | Video preview, playhead seeking, trim, split, clip ordering and save/reopen have a real browser verification path. |
| Creator materials | Extracts a real 1280×720 video frame and prepares text drafts from the saved brief. These are not trend research or generated-image claims. |
| Narration and transcription | Local Piper narration and Whisper captions verified on the configured CPU runtime. Models are installed separately. |
| Templates | Six editable presets create a new project and saved workflow plan. They do not generate footage, narration or a finished film. |
| Local automations | A real UI journey rendered a saved timeline, verified its file and prepared creator materials, then stopped at `needs-review`. Scheduling uses the running local app. |
| MCP connection | Optional stdio configuration and a real local bridge check: initialization, tool listing and a read-only project-list call. Assistant-client setup is separate. |
| Local cinematic generation | Optional ComfyUI/Wan route. Outputs need technical checks and visual review; no current showcase is advertised as approved. |
| YouTube | Live Desktop OAuth, actual channel readback, analytics and Windows DPAPI persistence verified. No upload or publication has occurred; the upload route is private-only. |
| Desktop distribution | Windows 1.0.8 installed through NSIS; native editing, render, download, restart, MCP bridge, Templates and Automations verified. Unsigned; macOS untested. |

Missing runtimes must be configured before the relevant media operation can succeed. The source repository does not contain model weights, user projects or large executable tools.

### Export your own footage

Install an FFmpeg build with H.264/AAC support and its matching FFprobe. Set their absolute paths in the same terminal before starting the server:

```powershell
$env:VYRELUM_FFMPEG = 'C:\tools\ffmpeg\bin\ffmpeg.exe'
$env:VYRELUM_FFPROBE = 'C:\tools\ffmpeg\bin\ffprobe.exe'
node server.js
```

These are example locations; use the files you installed. In a project, import media, open **Timeline**, adjust the clips and choose **Export edit**. **Download video** retrieves the resulting MP4. **Export portable** includes project media within the supported size limits; keep a backup of important originals.

For a direct edit from Studio chat, try a concrete instruction such as:

```text
First 5 seconds. Landscape. Fit. No captions.
```

For a single uploaded source, an explicit range is `from 2s to 6s; landscape; crop right`. With multiple sources, specify their order: `source 2 from 0s to 3s; then source 1 from 5s to 8s; portrait; fit`. The source must contain the requested range. Invalid, overlapping or ambiguous ranges are rejected; unsupported creative requests are disclosed rather than silently treated as completed effects.

Use Timeline to preview and seek, trim or split clips, change their order, save and render the edit. After rendering, open **Export → Prepare creator pack** for an extracted thumbnail, title, description, hashtags and platform copy drafts. These materials use the saved brief and actual render; review them before posting. The pack does not publish anything or claim current trend analysis.

### Start from a reusable template

Open **Templates** and choose **Original film**, **Product story**, **Talking-head edit**, **Social recut**, **Tutorial**, or **Narrated explainer**. Edit the project name, brief, target duration, aspect ratio, visual source choice, narration preference and captions. Each preset shows the sources it needs and a proposed sequence.

**Create project from template** creates a separate project and saves its workflow plan against the returned project revision. Defaults use your local media and no added narration. Choosing local generation or Piper records a later step; it does not install models or start a media job. Open the saved project in Studio chat, add the required media and review the plan before production.

If the project is created but its plan cannot be saved, **Retry saving this plan** uses the same project. **Open saved project** lets you continue from the retained work. If the initial creation response is uncertain, automatic creation retry stops; check Dashboard for the project before creating another.

### Work in Audio

Select a saved project, then open **Audio** from the studio navigation. The workspace contains narration, captions and the available sound-layer controls for that project.

1. Enter the exact words under **Narration** and choose **Generate narration** to invoke the configured local Piper voice. Job progress appears in Jobs.
2. Return to Audio and select the narration or a speech-containing recording under **Transcribe project media**. **Generate timed captions** invokes local Whisper.
3. Inspect and edit the returned words and timestamps. Word-timestamp results are grouped into short caption pages; the original transcription remains in the job evidence. Transcription is not a substitute for listening to the recording.
4. Set **Include captions in the next render**, then choose **Save audio & caption edits**. Open Timeline and export the edit to apply the saved audio and captions to a new file.

Piper and Whisper are optional CPU runtimes. The narration operation does not perform lip-sync, speaker cloning or multilingual dubbing. Sound layers must fit the actual footage and remain editable; no sound preset is automatically a match for a scene.

### Automate a saved edit locally

Open **Automations → Render & prepare**, select a saved project with a timeline, and name the workflow. Choose **Run now** or **Schedule for later** with a local start time. Save any pending timeline changes before scheduling.

The workflow is **Render video → Verify file → Prepare materials → Your review**. It uses the saved canvas, clips, captions and audio. Verification checks the actual output, including a full decode and its hash; creator materials contain an extracted thumbnail and draft publishing copy. The workflow ends at **Ready for your review** (`needs-review`). It does not generate new neural footage, approve the output or publish it.

Keep VYREALM open for a scheduled run. There is no operating-system wake-up service: if the app is closed before the start time, a due saved run starts after the app is reopened. Recovery reconciles the saved workflow and owned job records. An interrupted or failed worker can leave **Needs attention**; inspect the diagnostic instead of assuming it resumed or finished. If the project revision changes, the workflow pauses as **Project changed**. Save the revised edit and create a new workflow for that revision. Cancellation retains completed files and project history.

### Connect an optional MCP client

Open **MCP tools**, keep VYREALM running, and choose **Copy configuration**. Add that machine-specific configuration to a compatible assistant's MCP settings. It points to the local stdio bridge and this app's loopback API; the studio itself does not require an assistant subscription.

**Test local bridge** starts the bridge process and performs `initialize`, `tools/list`, and a read-only `list_projects` call through the real transport. A pass verifies this local bridge and project-store access. It does not confirm that a separate assistant client has loaded the configuration, nor does it run a model, create media or publish anything. Start with `list_projects` in the connected client. The UI separates available tools from capabilities that remain unavailable.

### Add local models when you need them

- **Chat:** run Ollama locally with the configured model. The default is `qwen3:4b-instruct`; `OLLAMA_HOST` and `VYRELUM_CHAT_MODEL` can select an existing local installation.
- **Voice and captions:** optional CPU setup is provided below. You do not need to hand-write `audio.json`. Pinned requirements and model hashes are in `runtime/audio-requirements-windows.lock.txt` and `runtime/audio-models.lock.json`.
- **Generated shots:** Windows x64 setup is separate and needs substantial disk space, a compatible GPU/runtime and model downloads. Settings setup expects the pinned uv helper listed in `runtime/bootstrap.lock.json`; lean source excludes that executable. The developer route `npm run setup:neural` requires Git and uv already installed. Inspect its installation/configuration paths before running it.

Allow at least 25 GB free for the optional video setup, with additional room for footage and render caches. Video-generation feasibility depends on the selected model and this machine's preflight results. Complete fresh-download setup on an unconfigured PC has not been requalified for this checkpoint.

Earlier ComfyUI/Wan2.2 TI2V 5B Q4 runs on this RTX 3050 Laptop 6 GB / 16 GB RAM machine produced five-second, 1024×576, 24 fps shots in 1,838, 1,717 and 1,413 seconds. These are measured tens-of-minutes generation times, not a fast-render promise. They do not establish native 1080p/4K detail or an approved neural showcase.

### Optional CPU narration and automatic captions

Editing uploaded footage with FFmpeg does not require Piper, Whisper or a GPU. Automatic speech captions need Whisper; generated narration also needs Piper. If those models are absent, the basic exported video is a separate capability from automatic captions or narration.

From a Windows source checkout, this command creates a private Python environment, installs the pinned CPU packages, downloads and verifies the audio models, registers the configuration, then generates and transcribes a short test phrase:

```powershell
.\scripts\Setup-AudioRuntime.ps1
node server.js
```

By default it stores the audio runtime under `%LOCALAPPDATA%\VYREALM\audio` and writes the source studio's `data\runtime\audio.json`. If you set `VYRELUM_RUNTIME_DIR`, it uses that directory instead. Existing audio configurations are left unchanged; use a different `-ConfigDir` for a separate setup. For the desktop application's standard runtime directory, use:

```powershell
.\scripts\Setup-AudioRuntime.ps1 -ConfigDir "$env:APPDATA\vyrelum\runtime"
```

An initial setup needs network access and free disk space. It installs CPU audio dependencies only, not ComfyUI, CUDA or video-generation models. The setup verification performed here uses a new Python environment with existing checksum-verified model files; it is not evidence of a complete fresh model download or an installed-desktop run.

## Tested environment and proof

Windows x64, Node 24.12.0, Intel Core i5-12450HX, 12 logical CPUs and 16 GiB RAM. The editing proof used CPU narration/transcription and a locally generated FFmpeg test card. It produced three five-second, 24 fps H.264/AAC videos at 1920×1080, 1080×1920 and 1080×1080. Every file fully decoded, and the project survived portable import, re-render, browser reload and server restart.

This is editing proof, not a claim of neural cinematic quality. Other hardware, macOS and Linux have not been qualified.

See [the verification guide](docs/HACKATHON_VERIFICATION.md) for the exact journey, prerequisites, evidence and limitations. With the audio runtime, tools and browser test dependencies installed:

```powershell
node scripts/run-hackathon-demo.mjs
```

The command creates isolated test data and stops its server when finished. It does not connect an account or touch existing projects.

Separate development-workspace evidence records the installed **Windows 1.0.8** qualification in `work/installed-1.0.8-proof/installed-evidence.json`: native editing, render, playback and download; the real 46-tool MCP bridge; template creation; and a durable automation that fully decoded its render and prepared creator materials for review. A full restart retained saved projects and workflow output. The unsigned installer is 244,482,440 bytes, SHA-256 `DDD76D34BBAC627B2BEAA5DABB391DBA7B3112CA67AACC1B009FED8A644B59ED`. When the standard port is occupied and the app chooses a different port on restart, reselect the saved project from the picker. This README qualification update follows the frozen runtime build; it does not alter packaged code. `work/youtube-live-proof/evidence.json` records actual Desktop OAuth consent, channel and analytics readback, and fresh-process access to the Windows DPAPI-protected token store. No upload or publication occurred. The configured Google API project remains unverified, and the upload integration is constrained to private videos.

The local automation UI journey in `work/automation-journey-1788841194211/evidence.json` verified a real render, full decode, draft creator materials, matching download hash, playback through the end, reload persistence and cancellation of a scheduled run without creating a render. It stopped at review; it did not publish.

### Earth after dark: an actual footage-based short

The separate **Earth after dark** project was created through VYREALM's visible controls: source import, a four-cut edit, local Piper narration, local Whisper transcription, caption text corrections and FFmpeg export. Its output is 27 seconds at 1920×1080 and 24 fps, with 648 decoded frames and 48 kHz stereo AAC audio. A frame from each second was extracted for contact-sheet inspection. These checks document a rendered file, not an audience reaction or a voice-quality verdict.

The visuals are imported NASA footage, not VYREALM-generated neural video. Daylight footage is credited to **NASA Johnson**, from April 2016 ([source page](https://svs.gsfc.nasa.gov/30771/)). Aurora footage is credited to the **Earth Science and Remote Sensing Unit, NASA Johnson Space Center**, captured on 17 August 2022 ([source page](https://svs.gsfc.nasa.gov/31281/)). Source credits and the original narration script are saved with the project and publishing draft. See [NASA's media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/); no NASA endorsement is implied.

The original files and creative project are excluded from the lean source distribution. In the development workspace, `work/earth-selected-proof/evidence.json` records the later visual/technical review and local catalogue selection of the exact output hash; `work/quality-short-review/evidence.json` retains the production and contact-sheet evidence. No subjective listening or voice-performance review is claimed. This is source-app evidence; it does not establish installation or qualification of a new desktop release.

## Development

```powershell
npm ci
npm run build
npm run desktop:dev
```

`npm ci` installs development dependencies; the desktop command starts Electron from source. Building the web assets does not install the desktop app or optional media runtimes.

```powershell
npx playwright install chromium
node scripts/test-stabilization.mjs
npm test
```

Media tests require FFmpeg/FFprobe and, for the narrated browser demo, the configured audio runtime. The full suite passed at the recorded checkpoint; later source changes need fresh checks. `npm run mcp` exposes optional local automation. Codex, ChatGPT and MCP are not required to use the studio.

The application has three main parts:

- `app.js`, `studio-chat.js`, `timeline-editor.js`, `youtube-settings.js`: browser workspace and controls.
- `server.js`, `runtime/`, `publishing/`: local API, SQLite revisions, job coordination and optional integrations.
- `workers/`, `desktop/`: media processing and the Electron host.

See the [implementation architecture](docs/VYREALM_ARCHITECTURE.md) for the current data flow and runtime boundaries.

`node scripts/stage-public-source.mjs` creates a new allowlisted source snapshot without databases, credentials, models or media. It does not publish anything. `node scripts/verify-clean-source.mjs <snapshot-directory>` exercises basic startup and project reopening with an isolated home directory. Final publication still requires the owner's secret and licensing audit.

## Troubleshooting

- **SQLite import error:** use the tested Node 24 line; an older Node installation may be first on your PATH.
- **Port 4173 is busy:** stop your other studio instance, or set `$env:PORT = '4174'` and open that port. Do not run two servers against the same data directory.
- **Projects appear missing:** check `VYRELUM_DATA_DIR`; a different path opens a different library.
- **Render cannot find FFmpeg:** set `VYRELUM_FFMPEG` and `VYRELUM_FFPROBE` to real executable paths and restart the source server.
- **Voice, chat or generated shots are unavailable:** check the relevant runtime configuration in Settings. Starting the studio does not install those models.
- **Audio changes are not in the video:** save them in Audio, check the caption toggle, then export the timeline again. A previous MP4 does not change when the project is edited.
- **Template created a project but no video:** that is its planning step. Add its required media, review source ranges and run production or export a saved timeline.
- **Template plan save failed:** retry the plan in the retained project. If the initial project creation was not confirmed, inspect Dashboard before creating another.
- **Scheduled workflow did not run while the app was closed:** reopen VYREALM using the same data directory. Scheduling runs inside the app, not an OS background service. Check workflow diagnostics for interrupted jobs or a changed project revision.
- **MCP test failed:** keep VYREALM running and copy the current configuration again after moving the app or changing its port. The check needs the indicated executable, bridge script and loopback API to be available.
- **A job is blocked or rejected:** inspect its diagnostics and source evidence. A successful encode does not replace visual review.

See the [troubleshooting guide](docs/EMBERFORGE_TROUBLESHOOTING.md) for recovery details.

## Credits and licensing

Built with Node.js, SQLite, Electron and Vite; editing uses FFmpeg, with optional Piper, Whisper, Ollama, ComfyUI/Wan and other separately configured tools. Runtime notices and pinned model information live in `runtime/notices/` and the runtime lock files. Each dependency, executable and model retains its own terms.

Original VYREALM code is available under the [MIT License](LICENSE), copyright 2026 VYREALM contributors. This does not relicense third-party binaries, libraries or models. The Windows FFmpeg/FFprobe build reports GPLv3-or-later; its license and source links are included under `runtime/notices/`. The lean uploaded-footage package excludes Blender, model weights and sample media; optional setup code remains available.
