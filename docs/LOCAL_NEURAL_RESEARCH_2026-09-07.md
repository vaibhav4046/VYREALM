# Local video qualification — 7 September 2026

This work extends the existing VYREALM application. It does not demonstrate
parity with Higgsfield, a hackathon win, native 4K generation, or 100 finished films.

## What the public sources establish

- [Higgsfield's video product](https://higgsfield.ai/ai-video) combines several
  model families with reference frames, camera controls and editing workflows.
  Its public product descriptions are not a published implementation of its
  proprietary inference architecture.
- [OpenAI's Higgsfield case study](https://openai.com/index/higgsfield/) describes
  planner and video model use. A prompt harness alone cannot replace the trained
  video model supplying the visual detail and performance.
- [Wan2.2 upstream](https://github.com/Wan-Video/Wan2.2) gives a 24 GB reference
  requirement for its 5B inference command. [ComfyUI's native workflow guide](https://docs.comfy.org/tutorials/video/wan/wan2_2)
  describes an 8 GB route. Neither claim qualifies a 6 GB laptop. The installed
  GGUF experiment must be measured independently.
- [FramePack](https://github.com/lllyasviel/FramePack) documents a 6 GB route;
  its hardware/speed descriptions are not VYREALM machine evidence. It has not
  been installed as a second, competing multi-gigabyte stack in this run.
- [Real-ESRGAN ncnn](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan) supports
  tiled inference. It is image restoration, so temporal stability requires a
  separate video treatment and inspection. Upscaling cannot restore authentic
  detail which the source model never generated.

## Selected installation

See `runtime/neural-runtime.lock.json` for exact repositories, commits, model
revisions, sizes and upstream model SHA-256 values. See
`runtime/neural-requirements-windows.lock.txt` for installed Python versions.

ComfyUI and its code remain in a separate local runtime directory. Only the
reviewed GGUF custom node is enabled; hosted API nodes are disabled. Loopback
requests use fixed workflows, not downloaded instructions executed by the app.
No account credentials, cloud inference or paid APIs were used for this test.

The runtime is GPL-3.0; the reviewed GGUF loader and model repositories declare
Apache-2.0. Preserve their actual notices and source information when packaging
or redistributing them. Real-ESRGAN's release includes BSD-3-Clause model/code
terms and additional runtime dependencies; its archive hash is an observed
download pin, not an upstream published digest.

## Machine evidence

RTX 3050 Laptop 6 GB, 16 GB RAM, Windows. VYREALM jobs invoked the local provider; no hosted generated assets were used.

| Stage | Result | Time | Whole-device GPU peak |
| --- | --- | --- | --- |
| 512 x 288, tiled VAE | Rejected for colour/facial artifacts | 526.729 s | 4.349 GiB |
| 512 x 288, standard VAE | Rejected; changing decoder alone did not solve it | 620.350 s | 4.444 GiB |
| 1024 x 576 keyframe + I2V | Five seconds / 120 delivered frames / 24 fps; operator-reviewed motion study | 1838.020 s | 5.788 GiB |
| Locked-reference second shot | Five seconds with woman turning/moving through market; operator-reviewed | 1716.804 s | 5.849 GiB |
| Locked-reference third shot | Five seconds; restrained look-back under awning; operator-reviewed | 1413.336 s | 5.849 GiB |
| Real-ESRGAN enhancement of first shot | UHD 3840 x 2160, 120 frames, roughly 61 Mbps | 1077.676 s | Not sampled as whole-device peak |

The three successful generation jobs are 148be8ce-5a53-4b23-9d00-b9280372332d, 2ea931b5-5edd-42ca-bb46-80f5de2a9ed9 and 7555bcc4-9323-41f4-bfde-e6c1fb0cc406. Source detail remains 1024 x 576. The UHD result is enhanced delivery, not native 4K inference. The second shot follows the subject from behind rather than the requested front-facing tracking angle; the third is a restrained reaction rather than a complete shelter-entry action. Both limitations are recorded in their reviews.

The three shots were assembled into the reviewed 15-second Rainline edit `ee19097b-e822-42ce-b10e-4c25b3f1abed`: 1920 x 1080, 360 decoded frames, 24 fps, local Piper narration, editable captions and local procedural rain/footsteps. Two-pass audio evidence measured -14.38 LUFS and -2.11 dBTP. The final contact sheet and source-shot provenance are copied under `outputs/desktop/`.

The source application starts its registered ComfyUI process itself. The isolated onboarding qualification installed private Python 3.12.13, pinned CUDA packages, Piper/Whisper environments, code archives and all three model files, then started ComfyUI on the RTX 3050. It reused cached checksum-verified downloads and did not run a new model smoke test. Generated-frame ledgers, exact workflow/provider history, prompt/seed/model, source hashes and decoded-frame lineage are retained. Completed stages recover from these saved files even after provider history disappears. An incomplete stage with lost provider history blocks instead of claiming a new output.

Piper 1.8.0 (GPL-3.0 runtime), the LJSpeech high voice trained from scratch on the public-domain LJSpeech dataset, and Whisper tiny.en ran on CPU. The full browser journey passed caption edits, timed procedural sound layers, 16:9 / 9:16 / 1:1 exports, download and reopening without external browser requests. These browser tests use explicitly imported test media; they do not masquerade as fresh neural inference.

## Distribution and remaining qualification

The 1.0.1 Windows installer was built but its launch was rejected by automatic approval review with “blocked by policy.” No more specific reason was provided. The older installed app must not be presented as verification of current source changes. A new 1.0.2 package is the current source target; installation and a completely disconnected installed-app acceptance run remain outstanding.

The new setup route bundles [uv 0.11.21](https://github.com/astral-sh/uv/releases/tag/0.11.21), preserves MIT/Apache notices, downloads private Python and verifies pinned code/model archives. Fresh private Python installation and code extraction were exercised. Full clean-install qualification, upscaler onboarding, Mac variants and signed distribution remain separate tasks.

Lip-sync, dubbing, native 720p/1080p inference, 60 fps interpolation and the 100-film catalogue are not established by these tests. No automatic numerical realism score is claimed.

The supplied Devpost page could not be retrieved in the earlier research pass. Its deadline and eligibility have not been independently reconfirmed.
