# Wan VAE decode qualification study

This opt-in tool decodes an existing VYREALM-owned latent. It does **not** sample a new film, alter production defaults, promote catalogue items, or write to the canonical project database. Its operation name is `decoded-from-prior-latent`. The proposed profile remains **unqualified** until the actual output and measurements have been reviewed.

## Candidate

- Installed ComfyUI pin: `fbed745c8d7d62573b099cd61fe51cb64b9b807e`.
- VAE: `wan2.2_vae.safetensors`; exact installation inventory hash is checked before execution.
- Spatial tile: 256; overlap: 64.
- Temporal tile: 128; overlap: 8. With this Wan VAE's temporal compression, it covers the complete 31-frame latent for the 121-frame source, avoiding intentional temporal splitting in this candidate.
- Fixed source: 1024×576, 121 decoded frames. The compatibility MP4 uses the first 120 frames at 24 fps: exactly five seconds. It has no generated audio.

## Commands

Run from the existing VYREALM repository. The default is read-only provider preflight plus workspace evidence files; it does not submit a workflow:

```powershell
node scripts/benchmark-latent-decode.mjs --source-job=7555bcc4-9323-41f4-bfde-e6c1fb0cc406
```

The completed Rainline source is allowed as a qualification study. It is not Mahabharata output. A verified preflight operation exists at `outputs/benchmarks/latent-decode/4d21e102-d11b-4bfa-b509-10d8e4f6348b/`.

Only at an available VYREALM GPU boundary, explicitly run the candidate:

```powershell
node scripts/benchmark-latent-decode.mjs --source-job=7555bcc4-9323-41f4-bfde-e6c1fb0cc406 --operation-id=4d21e102-d11b-4bfa-b509-10d8e4f6348b --queue-policy=fifo --execute
```

This takes the account's GPU lease, stages the hash-checked latent under a unique basename in the registered ComfyUI input root, and submits one owned decode graph. Core `LoadLatent` scans root basenames, so the filename itself contains the operation UUID. Existing input files cannot be overwritten with different bytes.

FIFO execution queues behind existing ComfyUI work and never cancels unrelated prompts. Admission fails when eight or more prompts are already pending. Decode waiting is capped at two hours; optional sequential standard/candidate runs share that budget. Retry the same operation ID to reconnect to its original prompt and reuse verified saved frames. Provider status failures retain the owned prompt and diagnostics; they are not proof that provider work stopped. Inspect the queue before scheduling a separate heavy workload after such a failure.

For an isolated standard-decode timing comparison, create a separate preflight operation with `--include-standard`, then repeat its printed command with `--execute`. This runs the standard and tiled decoders sequentially against the same saved latent. Comparing the candidate's time to the original full sampling job is invalid: the report explicitly labels that old measurement as whole-generation time. System-wide VRAM samples can include external queue work; they are not isolated model allocations.

## Evidence and review

Admission verifies canonical SQLite job/result identity, owned provider success history, submitted/completed workflow logs, original sampler graph, all 121 retained frame hashes, the latent ledger, its tensor shape and embedded sampler metadata, and the original MP4 hash. It accepts only the completed fixed Wan source profile. Imported files, changed frames, missing logs, unsafe paths and unfinished jobs fail admission.

The output retains provider logs, workflow hashes, source and staged latent hashes, queue progress, timing, resource measurements, the decoded MP4, all provider PNGs, SSIM/PSNR per-frame statistics, adjacent-frame difference statistics and a two-row contact sheet. The top row is standard decode; the bottom row is the candidate. Contact frames are 0, 30, 60, 90 and 120. The MP4 must decode successfully and pass the media verifier.

These metrics do not establish semantic quality. Inspect tile boundaries, faces/materials, movement and flicker in the full clip as well as the contact sheet. Report actual timing and memory scope. The tool finishes at `review_required`; it never automatically marks the profile qualified.

The CPU comparison harness can be exercised without VAE execution:

```powershell
node scripts/benchmark-latent-decode.mjs --source-job=7555bcc4-9323-41f4-bfde-e6c1fb0cc406 --verify-comparison-only
node --test runtime/decode-profiles.test.mjs runtime/neural-production.test.mjs
```

The CPU check compares the retained source to itself and labels that fact. Its contact sheet and perfect similarity are a command-path check, not tiled-decode quality evidence. The tests use synthetic ownership fixtures where indicated and do not claim real model execution.
