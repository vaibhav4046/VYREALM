# VYREALM continuation record — 2026-09-07

The current source app and runtime are retained. Evidence below is measured on the Windows Lenovo LOQ (RTX 3050 Laptop 6 GiB, 16 GiB RAM). Claims are limited to the routes that were exercised.

## Completed checkpoint

- Three original local Wan2.2 TI2V 5B Q4 shots are saved and reviewed: 1024×576, 24 fps, 5 seconds each. Jobs `148be8ce-5a53-4b23-9d00-b9280372332d`, `2ea931b5-5edd-42ca-bb46-80f5de2a9ed9` and `7555bcc4-9323-41f4-bfde-e6c1fb0cc406`. The second and third shots reuse the character keyframe; their provider histories, frame ledgers and SHA-256 hashes remain in their job folders.
- Shot timings were 1,838.020 s, 1,716.804 s and 1,413.336 s. Whole-device GPU peaks were 5.788, 5.849 and 5.849 GiB. These are local motion studies, not a claim of native 1080p/4K or hosted-model parity.
- The 15-second Rainline edit is job `ee19097b-e822-42ce-b10e-4c25b3f1abed`, project `c2689d21-5add-4ffc-9ff4-4c7239236353`, revision 26. It is 1920×1080, 24 fps, 360 decoded frames, 15 seconds, with Piper narration, editable captions and original procedural rain/footstep cues. Final delivered audio measured −14.38 LUFS / −2.11 dBTP. One-second frames were inspected in `outputs/desktop/VYREALM_RAINLINE_CONTACT_SHEET.png`; the output is operator-reviewed.
- Shot 2 tracks from behind rather than the requested front-facing angle. Shot 3 is a restrained look-back under the awning rather than a full duck-and-enter shelter performance. The review records these limitations.
- A separate five-second Real-ESRGAN x4 sample reaches 3840×2160 at approximately 61 Mbps H.264 (`outputs/desktop/VYREALM_LOCAL_GENERATION_4K.mp4`). Its 1024×576 source and 1,077.676-second enhancement time are retained. It is not a 15-second native-UHD neural trailer.
- Settings onboarding installed and hash-verified private Python/CUDA/audio environments in an isolated directory and started the registered ComfyUI process itself. The setup reused cached pinned code/model files during qualification; it is not a clean network-download claim.
- Browser golden journey passed local import, Piper, Whisper, caption edits, procedural sound layers, colour grade, three aspect-ratio exports, download and reopening without external browser requests. Project bundle round-trip now embeds all media, rejects incomplete bundles and remaps video/audio-layer links while labelling imported provenance.
- Node/unit suite passes 92 tests plus standalone acceptance checks; Vite production build passes; `npm audit` reports zero known vulnerabilities. Python download tests pass. The final browser journey passes after the bundle/provenance changes, including round-trip import and reopened playback.

- Added real local RIFE v4.6 interpolation, its Settings installer, GPU/CPU startup probes, a typed MCP tool and reviewed-export UI action. Rainline now has a 15-second 1920×1080/60 fps delivery (900 frames), job `99200737-d638-436a-a4d0-cc33548517bd`, revision 30. First pass took 314.336 s; a 46.564 s caption repair reused all RIFE frames and two encoded shots. Original AAC audio is unchanged. Initial job `f6714a87-1376-41e6-90a2-8c647b77e12d` stays rejected for caption morphing. CPU 128×72 fixture and cached retry passed. See `docs/LOCAL_INTERPOLATION_2026-09-07.md` and `outputs/desktop/VYREALM_RAINLINE_60FPS_EVIDENCE.json`.
- Added format-aware original hook planning for recurring characters, hybrid augmentation, transformation loops, what-if documentaries, micro-horror, product proof and rights-cleared commentary. The planner records the selected format, research basis and non-guarantee disclaimer in the project revision. See `docs/VIRAL_FORMATS_RESEARCH_2026-09-07.md`.
- Source-app Settings downloaded the exact RIFE archive, verified hashes and selected the NVIDIA Vulkan device using real small GPU/CPU probes. Setup job `47d4715b-ceef-417d-89cc-bd1d5828e4b6` passed. This is not installed-desktop-app acceptance.
- Packaged version 1.0.6 from an immutable snapshot. All 21 selected critical files match the packaged application and the current source. The 610,998,159-byte installer SHA-256 is `c0ae9574dfbf9e07a34f8c0938442085ebb951d0e3db52734a3ab2400062da77`; see `outputs/verification/installer-1.0.6-inventory.json`.
- Added a visible Format Lab backed by 36 structurally validated formats, 105 format/platform routes, 59 bounded camera controls, 35 looks and 20 FFmpeg-qualified transitions. Caption safe-area, source-extension and sidechain-audio acceptance tests are part of `npm test`.
- Final source verification passes 192 Node tests, the Vite production build, zero npm-audit vulnerabilities and a 57.6-second Playwright golden journey covering local import, Piper, Whisper, captions, sound, three real MP4 exports, download and project reopen without external browser traffic.

## Remaining qualification

- Installed-app verification for version 1.0.6 remains outstanding. Do not launch it through the earlier blocked approval path or bypass Windows signing protections.
- Run a real smoke test from the newly registered isolated runtime if a fresh model generation is needed. Existing three generated sources must be reused unless a new creative change requires rerendering.
- Repeat 4K enhancement for the full 15-second edit only when disk and time allow; preserve the separate five-second proof and do not call a canvas resize an AI upscale.
- Add a qualified local lip-sync/dubbing route, diarization, combined 4K/60 fps delivery and richer per-shot visual scoring only after models and hardware are tested. Do not claim those capabilities from metadata.
- Generate catalogue films only after each film has real sources, contact-sheet inspection and provenance. Existing demo catalogue records are metadata, not finished films.
- macOS, Apple Silicon, Intel Mac and signed installation remain untested. YouTube OAuth, publishing and analytics remain explicit future online functions.

## Source/runtime notes

- Canonical data: `%APPDATA%/vyrelum/data`; runtime config: `%APPDATA%/vyrelum/runtime`; source API: `http://127.0.0.1:4173/`.
- Isolated setup data: `D:\VYREALM-runtime\bootstrap-qualification\full-install` during qualification. The setup marker reports installed/verified; it does not certify neural generation until a smoke test passes.
- The paused `vyrelum-product-monitor` heartbeat remains paused. No new automation or duplicate task was created.
