# VYREALM Odyssey installed-product evidence

Date: 2026-09-07 (Europe/London)

## Fresh 1080p cinematic output

- Video: `ODYSSEY_FILM_CINEMATIC_1080P.mp4`
- Resolution: 1920x1080, 24 fps, 6.00 seconds, H.264/AAC stereo
- SHA-256: `E60BF30305C8793AE0471145148D7A10E2467A21422E3DBA7DFB1113F9D4A36A`
- Captions: `THE SHATTERED MOON SURFACE`, `THE DRIFTING STARSHIP`, `THE VIOLET NEBULA`
- Editable source: `ODYSSEY_FILM_CINEMATIC_1080P.blend`
- Verification: visual luma/contrast/motion, duration, frame rate, audio, and captions all passed.

This output is a deterministic local Blender cinematic renderer with editable 3D motion. It improves composition and readability over the previous abstract render; it is not a claim of Higgsfield or Seedance photorealism.

## Verification

- `npm test`: 15/15 tests passed.
- Installer: `VYREALM-1.0.0-win-x64.exe`
- Installer SHA-256: `464377DBC606A7954C9C337E2A85002017534044E2EF9CE32B86BA588BAF784C`
- Windows package was rebuilt and provider/hardware/media modules were checked in the packaged payload.
- macOS and Intel Mac installation remain unverified.

## 4K enhancement smoke

- `VYREALM_4K_SMOKE_RECHECK.mp4` verified at 3840x2160, 24 fps, H.264 High Profile, 48 kHz stereo, and 60 Mbps target. The run retained a frame extraction checkpoint and used the temporal-safe CPU fallback.

## Known model diagnostic

A forced cache-busting Ollama director call returned `DIRECTOR_INVALID_JSON`; the job stopped with that diagnostic. The existing validated editable scene was retained and the timeline was rerendered from it, so no completed project data was discarded.





