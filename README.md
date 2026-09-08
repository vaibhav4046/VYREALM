# VYREALM

A local creator studio for turning your footage and ideas into editable video projects. Plan in chat, work with shots and captions, add narration and sound, then export actual video files. Projects and media stay on your machine; optional online research and YouTube features are separate actions.

Source repository: [vaibhav4046/VYREALM](https://github.com/vaibhav4046/VYREALM).

VYREALM is an early Windows application. The 1.0.7 Windows installer has been installed and exercised end to end: upload, trim, save, render, playback and download. Local cinematic generation and publishing have separate qualification requirements.

## Windows download

Download the **unsigned Windows x64 installer** from the [1.0.7 prerelease](https://github.com/vaibhav4046/VYREALM/releases/tag/v1.0.7). Actual installation and the packaged Electron app were tested with an isolated profile. The downloaded four-second H.264/AAC edit fully decoded with the bundled FFmpeg. macOS has not been tested.

This README records a documentation checkpoint newer than the release source commit; the packaged runtime is unchanged.

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
| Local cinematic generation | Optional ComfyUI/Wan route. Outputs need technical checks and visual review; no current showcase is advertised as approved. |
| YouTube | Live OAuth, channel readback and analytics access verified for one owner account. No video upload was performed; upload behavior is not qualified by that connection test. |
| Desktop distribution | Windows x64 1.0.7 installer built, installed and launched successfully. Packaged upload, trim, save, render, playback and native download passed. Unsigned; macOS untested. |

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

### Add local models when you need them

- **Chat:** run Ollama locally with the configured model. The default is `qwen3:4b-instruct`; `OLLAMA_HOST` and `VYRELUM_CHAT_MODEL` can select an existing local installation.
- **Voice and captions:** optional CPU setup is provided below. You do not need to hand-write `audio.json`. Pinned requirements and model hashes are in `runtime/audio-requirements-windows.lock.txt` and `runtime/audio-models.lock.json`.
- **Generated shots:** Windows x64 setup is separate and needs substantial disk space, a compatible GPU/runtime and model downloads. Settings setup expects the pinned uv helper listed in `runtime/bootstrap.lock.json`; lean source excludes that executable. The developer route `npm run setup:neural` requires Git and uv already installed. Inspect its installation/configuration paths before running it.

Allow at least 25 GB free for the optional video setup, with additional room for footage and render caches. Past local generation on an RTX 3050 Laptop with 6 GB VRAM took tens of minutes per short shot; do not assume interactive generation speed. Complete fresh-download setup on an unconfigured PC has not been requalified for this checkpoint.

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

Windows x64, Node 24.12.0, Intel Core i5-12450HX, 12 logical CPUs and 16 GiB RAM. The editing proof used CPU narration/transcription and a locally generated FFmpeg test card. It produced three five-second, 24 fps H.264/AAC videos at 1920×1080, 1080×1920 and 1080×1080. Every file fully decoded, and the project survived portable import, re-render, browser reload and server restart. The repeatable run took **77 seconds** on that configured machine.

This is editing proof, not a claim of neural cinematic quality. Other hardware, macOS and Linux have not been qualified.

See [the verification guide](docs/HACKATHON_VERIFICATION.md) for the exact journey, prerequisites, evidence and limitations. With the audio runtime, tools and browser test dependencies installed:

```powershell
node scripts/run-hackathon-demo.mjs
```

The command creates isolated test data and stops its server when finished. It does not connect an account or touch existing projects.

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

`node scripts/stage-public-source.mjs` creates a new allowlisted source snapshot without databases, credentials, models or media. It does not publish anything. `node scripts/verify-clean-source.mjs <snapshot-directory>` exercises basic startup and project reopening with an isolated home directory. Final publication still requires the owner's secret and licensing audit.

## Troubleshooting

- **SQLite import error:** use the tested Node 24 line; an older Node installation may be first on your PATH.
- **Port 4173 is busy:** stop your other studio instance, or set `$env:PORT = '4174'` and open that port. Do not run two servers against the same data directory.
- **Projects appear missing:** check `VYRELUM_DATA_DIR`; a different path opens a different library.
- **Render cannot find FFmpeg:** set `VYRELUM_FFMPEG` and `VYRELUM_FFPROBE` to real executable paths and restart the source server.
- **Voice, chat or generated shots are unavailable:** check the relevant runtime configuration in Settings. Starting the studio does not install those models.
- **A job is blocked or rejected:** inspect its diagnostics and source evidence. A successful encode does not replace visual review.

## Credits and licensing

Built with Node.js, SQLite, Electron and Vite; editing uses FFmpeg, with optional Piper, Whisper, Ollama, ComfyUI/Wan and other separately configured tools. Runtime notices and pinned model information live in `runtime/notices/` and the runtime lock files. Each dependency, executable and model retains its own terms.

Original VYREALM code is available under the [MIT License](LICENSE), copyright 2026 VYREALM contributors. This does not relicense third-party binaries, libraries or models. The Windows FFmpeg/FFprobe build reports GPLv3-or-later; its license and source links are included under `runtime/notices/`. The lean uploaded-footage package excludes Blender, model weights and sample media; optional setup code remains available.
