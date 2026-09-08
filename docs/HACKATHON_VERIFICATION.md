# VYREALM — reproducible editing and export proof

This demo proves a real local editing workflow: footage import, generated narration, editable captions and sound, three video exports, portable project import, re-render and reopening after a server restart. The footage is an original moving test pattern. It is not a generated cinematic scene.

## Run the demo

From the repository directory on Windows, with dependencies, Playwright Chromium, FFmpeg/FFprobe and the local Piper/Whisper runtime already installed:

```powershell
node scripts/run-hackathon-demo.mjs
```

The command reads `%APPDATA%/vyrelum/runtime/audio.json`. To use a different existing audio configuration:

```powershell
node scripts/run-hackathon-demo.mjs --audio-config "C:\path\to\audio.json"
```

The configuration must point to the installed Python audio environment, Piper voice and Whisper model. This command does not install models, sign into Google, use a generation GPU, or open existing user projects. It creates a unique `work/hackathon-demo-<timestamp>/` directory and a separate local server on an available port. It stops its server when finished and retains its evidence and test database for inspection.

The final line must begin `PASS: three decoded exports`. A nonzero exit or missing PASS is a failed demo. Allow several minutes; timings depend on the machine and background work.

## What it exercises

1. Generates a five-second moving test card with FFmpeg, then imports it through the actual app.
2. Creates Piper narration saying “Someone is following me.” Whisper transcribes that narration. The browser edits and saves the caption, synthesized sound effects, layer gain and colour grade.
3. Renders and downloads landscape, portrait and square videos. FFprobe checks their streams; FFmpeg fully decodes each file. HTTP byte-range access is checked too.
4. Exports the portable project, rejects an intentionally incomplete bundle, imports the complete bundle with remapped asset IDs, and renders again.
5. Reloads the browser, reopens the saved project, verifies playback metadata and checks the narrow layout.
6. Stops and restarts the isolated server, then verifies persisted timeline, caption, sound gain, verified output and media access.

| Export | Video | Audio | Duration | Frames |
|---|---|---|---|---|
| Landscape | 1920 × 1080, 24 fps | 48 kHz | 5 seconds | 120 |
| Portrait | 1080 × 1920, 24 fps | 48 kHz | 5 seconds | 120 |
| Square | 1080 × 1080, 24 fps | 48 kHz | 5 seconds | 120 |

The exported test videos use H.264/AAC. `demo-manifest.json` records hashes, sizes, machine information and elapsed time for that run. `golden-evidence.json` identifies the render jobs; `restart-evidence.json` records the process-restart result. The two screenshots show the actual app with the test pattern. `playwright-results.json` and `golden-run.log` record the browser run. Failure traces remain in the private work directory rather than the submission evidence folder.

## Evidence checkpoint

On 8 September 2026, the golden journey passed in approximately 1.4 minutes on Windows with Node 24.12.0, an Intel Core i5-12450HX (12 logical CPUs) and 16 GiB RAM. All three files fully decoded; no browser page errors or external browser requests were observed. A subsequent full server restart retained project revision 15, the edited caption and sound gain 0.4. The repeatable wrapper records its own fresh timings separately.

Additional checks:

```powershell
node scripts/test-stabilization.mjs
npm test
npm run build
```

At the checkpoint, `npm test` passed, the focused runner passed 40 tests before the desktop OAuth tests were added, and the cinematic regression suite passed all 65 tests. Later source changes require fresh qualification; these results do not certify a different build.

## Source and rights

- Video: generated locally with FFmpeg `testsrc2`; no downloaded footage, actors, user project or rejected creative media is included.
- Speech: a short original verification phrase synthesized locally with Piper `en_US-ljspeech-high`. The installed model card identifies its LJ Speech training dataset as public domain; the card is included as attribution evidence. This statement does not relicense model weights or dependencies.
- Sound effects: locally synthesized test layers. No commercial music or extracted soundtrack is included.
- Captions: local Whisper transcription, manually edited in the browser test.
- Provenance: video is labelled **edited / imported media**, with local FFmpeg rendering. The voice is synthesized; the visuals are not neural cinema.

`submission/evidence/manifest.json` is an explicit file allowlist with hashes. Only those reviewed proof files are candidates for submission. The source-publication candidate manifest is a separate review aid, not permission to publish all repository files. The owning task performs the final secret, licensing and provenance audit before publishing.

## Packaging and limits

```powershell
npx electron-builder --config electron-builder.yml --dir --config.directories.output=work/release-candidate
node scripts/verify-package-coherence.mjs work/release-candidate/win-unpacked work/release-candidate/coherence.json
```

Run those commands against a stable source snapshot. The audit compares actual packaged bytes and static imports, including the chat module and desktop OAuth helper. It intentionally fails if source changes during packaging. Building a directory package does not install or launch it.

The editing proof does not establish neural cinematic quality, external YouTube authorization/upload, installer startup, a public demo URL or completed hackathon submission. Desktop Google sign-in validation is tested with an injected shell and backend-created authorization URLs; no real grant is part of this demo. A prior installer-launch approval rejection remains recorded, so installer launch was not used as a workaround.
