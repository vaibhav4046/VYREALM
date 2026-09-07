# Open-source engine capability matrix

This is a screening record, not an endorsement or a vendored dependency list. No repository below is copied into VYREALM by this review.

| Capability | Candidate | License | Windows | VRAM/RAM | Integration status | Fallback |
|---|---|---|---|---|---|---|
| Text/image-to-video | Wan2.2 | Apache-2.0 (repository code; model terms still require review) | Not measured in VYREALM | Not measured on RTX 3050 6 GB | Research only; no checkpoint bundled | Asset-first keyframes + FFmpeg motion |
| Low-VRAM video workflows | Wan2GP / WanGP | WanGP Community License 2.0; redistribution/embedding restrictions apply | Not measured in VYREALM | Candidate for low-VRAM experiments; no claim at 6 GB | Not integrated; license gate required before embedding | Asset-first keyframes |
| Long image-to-video | FramePack | Apache-2.0 | Not measured in VYREALM | Candidate; upstream advertises laptop operation but local peak is unmeasured | Not integrated; isolated adapter required | Asset-first keyframes |
| Conversational editor | OpenChatCut | AGPL-3.0-or-later | Not measured in VYREALM | Not measured | Reference only; no source copied | Existing local timeline editor |
| ComfyUI video workflows | Official ComfyUI workflows | Per-workflow/model terms | Loopback provider health is tested | Preflight required per workflow | Local provider adapter implemented; workflows remain opt-in | Asset-first keyframes |
| Programmatic composition | Remotion | MIT (runtime packages) | Existing Node path | CPU/browser preview | Existing VYREALM timeline concepts; no hosted renderer | FFmpeg timeline worker |
| Transcription | whisper.cpp / faster-whisper | Project/model licenses vary | Adapter pending machine qualification | Small model route planned | Capability-gated | Timed captions from script |
| Voice | Piper | MIT code; voice model terms vary | Adapter pending machine qualification | CPU-friendly candidate | Capability-gated | User narration upload |
| Upscaling | Real-ESRGAN / Video2X | Per-project licenses | Not measured in VYREALM | Tiled route planned | Temporal-safe FFmpeg 4K fallback implemented | Lanczos + grade |
| Face tracking | MediaPipe | Apache-2.0 | Not measured in VYREALM | Not measured | Not integrated | Manual reframing |
| Podcast clipping | podcli / ViralMint / ScriptCut / Recut | License and provenance review pending | Not measured | Not measured | Research references only | Existing timeline editor |
| Diarization | MOSS Transcribe-Diarize | License review pending | Not measured | Not measured | Research only | Single-speaker transcript |
| Desktop editing | Kinocut / Vanta | License and provenance review pending | Not measured | Not measured | Research only | Existing Electron shell |

## Decision rules

1. A candidate is not shipped from a README claim. It needs a pinned commit, license notice, Windows smoke test, VRAM/RAM measurement, dependency provenance review, and an isolated adapter test.
2. Wan2GP cannot be embedded or white-labeled without resolving its Community License restrictions. OpenChatCut's AGPL obligations require a separate distribution review. These are not silently adopted as VYREALM product restrictions.
3. Until a local video checkpoint passes the 6 GB preflight and visual gate, VYREALM routes cinematic production through bundled high-detail raster keyframes and rejects primitive/vector placeholder scenes.

## Sources checked

- Wan2.2 repository and Apache-2.0 notice: https://github.com/Wan-Video/Wan2.2
- Wan2GP Community License 2.0: https://github.com/deepbeepmeep/Wan2GP/blob/main/LICENSE.txt
- FramePack repository and Apache-2.0 license: https://github.com/lllyasviel/FramePack
- OpenChatCut repository and AGPL-3.0-or-later notice: https://github.com/0xsline/OpenChatCut
