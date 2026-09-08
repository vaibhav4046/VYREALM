# Local LTX comparison adapter

`runtime/ltx-production.mjs` is an isolated, opt-in image-to-video adapter. It does
not change VYREALM's default provider, launch a service, download weights, or
promote an output to the flagship catalogue. The installed ComfyUI instance is
the only inference service it uses. Native motion and 1080p delivery are recorded
separately; the latter is a Lanczos resize, not native 1080p or AI enhancement.

## Fixed profiles

| Profile | Native size | Generated / delivered frames | FPS / duration | Sampling | Qualification |
| --- | --- | --- | --- | --- | --- |
| `draft-512` | 512×288 | 121 / 120 | 24 / 5 seconds | 8 Euler steps, CFG 1 | Not yet measured in VYREALM |
| `comparison-1024` | 1024×576 | 121 / 120 | 24 / 5 seconds | 8 Euler steps, CFG 1 | Not yet measured in VYREALM |

The extra terminal frame satisfies LTX's `8n+1` latent length. Encoding keeps
the first 120 frames, with no interpolation or frame duplication. Seed 730241
is the default comparison seed. Both profiles should use the same reviewed
Arjuna keyframe and motion prompt as the Wan comparison. Reusing a keyframe is
conditioning, not a guarantee of facial identity or correct action.

Standard VAE decoding is the default. `tiledDecode: true` selects only
`VAEDecodeTiled(tile_size=256, overlap=64, temporal_size=32,
temporal_overlap=8)`. These values fit the installed API schema; temporal seams,
visual quality and speed remain unqualified. Do not treat tiled decoding as a
quality improvement until the same retained latent has been compared visually.

## Dependency pins and scope

The local inspection on 2026-09-08 found:

- ComfyUI commit `fbed745c8d7d62573b099cd61fe51cb64b9b807e`.
- ComfyUI-GGUF commit `6ea2651e7df66d7585f6ffee804b20e92fb38b8a`.
- `ltxv-2b-0.9.8-distilled-q8_0.gguf`, 2,173,891,072 bytes.
- `t5-v1_1-xxl-encoder-Q5_K_M.gguf`, 3,386,856,640 bytes.
- `ltxv-0.9.8-2b-distilled-vae.safetensors`, 2,493,859,780 bytes.

The diffusion model's recorded SHA-256 is
`a0637b06a43fea8d71af2c7bf912c8c8a36d61654966054621f80f2c39e6faca`.
It agrees with the converter's pinned LFS record at
[calcuis/ltxv-gguf commit 9f4c4b9843548916d682ef3d501f6038806ec2ff](https://huggingface.co/calcuis/ltxv-gguf/commit/9f4c4b9843548916d682ef3d501f6038806ec2ff).
This implementation checks exact installed names through the provider preflight;
it does not rehash several gigabytes of weights during each job. Installed-file
checksums and full distribution provenance still belong in model onboarding.

The fixed graph uses `LTXVImgToVideo`, `LTXVConditioning`,
`ModelSamplingLTXV`, `LTXVScheduler`, `KSamplerSelect` and `SamplerCustom`.
Their input names and connections were checked against the installed
`comfy_extras/nodes_lt.py` and the running node catalogue. No downloaded custom
workflow or arbitrary script is executed.

This single-pass GGUF comparison is not the full vendor refinement workflow.
The [official 0.9.8 distilled configuration](https://raw.githubusercontent.com/Lightricks/LTX-Video/main/configs/ltxv-2b-0.9.8-distilled.yaml)
uses multiscale inference, a separate spatial upscaler, explicit two-pass sigma
lists and additional decoding settings. The additional upscaler is not installed
by this change. Vendor quality and speed claims do not qualify this adapter.

LTX 0.9.8 weights use the
[LTXV Open Weights License 0.X](https://huggingface.co/Lightricks/LTX-Video/blob/main/LTX-Video-Open-Weights-License-0.X.txt),
not an unrestricted Apache/MIT model license. Its royalty-free grant is subject
to use restrictions. Commercial entities with at least $10 million annual
revenue have separate licensing terms. Distribution requires the agreement,
notices and applicable downstream restrictions; the agreement also requires
clear disclosure of machine-generated content. This module does not redistribute
weights or claim that model terms become VYREALM's overall code license. Retain
the exact notices before distributing a model bundle.

## Admission and evidence

The scheduler must call `verifyReviewTarget` against its canonical database and
registered playback asset before queueing the adapter. The adapter independently
requires `jobsDir`, `projectId` and a reference containing `path`, `sha256`,
`sourceJobId` and `promptId`:

1. The PNG resolves to `keyframe/frames/00000.png` or `reference.png` inside
   the specified source job, inside the configured job store.
2. Its source job request belongs to the same project.
3. Its keyframe hash and provider prompt match a locally generated receipt.
4. That receipt has a passed review matching the actual delivered file hash.
5. The PNG signature and current bytes match its recorded SHA-256.

Imported, unreviewed, changed or cross-project files fail admission. Legacy
reviews that still bind a source hash instead of delivered bytes must go through
the existing delivery normalization and review process first.

The new job gets its own namespace, input-upload receipt, PNG, workflow, provider
JSONL, history, frame ledger, native MP4, delivery MP4 and contact sheet. A changed
prompt, seed, profile or reference requires a new job. Completed stage recovery
uses the original provider prompt and frame hashes instead of resampling.

`generation-evidence.mjs` accepts only the exact LTX model/sampler/conditioning/
schedule/output graph. Wan checks remain in place. The full audit still requires
successful provider history, matching submitted/completed logs, owned PNG
descriptors, frame hashes, exact dimensions/fps/duration, complete FFmpeg decode
and native-frame pixel lineage. A copied or unrelated MP4 is rejected.

Both profile results remain `review_required`. No music, narration, dialogue,
lip-sync, face-consistency score or cinematic score is fabricated. The existing
editor and audio stages are subsequent, separately verified work.

## Scheduling and measurement

Use one engine GPU lease. The default `queuePolicy: 'idle'` waits for an idle
ComfyUI queue. Explicit `queuePolicy: 'fifo'` may enqueue one owned graph in
ComfyUI's serial queue, with the helper's bounded queue capacity and deadline.
It does not interrupt or cancel other users' jobs. No parallel inference is
started by this module.

The qualification CLI acquires VYREALM's shared SQLite GPU lease first, waiting
up to one hour with visible progress and stop checks. It rechecks the reviewed
source after that wait. A waiting CLI never evicts the current lease owner.

Previous external LTX text-to-video jobs on the installed runtime took roughly
215–290 seconds for 97 frames at 768×512/25fps. Those files are not VYREALM-owned
and are not evidence that this I2V graph meets a minutes target. Current logs also
show the T5 encoder and VAE being offloaded; the entire pipeline does not fit in
6 GB GPU memory at once. Measure the two fixed profiles using the same source,
record queue wait, sampling, decode, end-to-end time, peak RAM and VRAM, then
inspect face, action and temporal continuity before selecting a default.

## Verification without model execution

```powershell
node --test --test-concurrency=1 runtime/ltx-production.test.mjs runtime/generation-evidence.test.mjs runtime/generation-gate.test.mjs
node --test scripts/benchmark-ltx-shot.test.mjs runtime/qualification-controls.test.mjs
```

The tests use isolated synthetic CPU fixtures. They exercise the strict graph,
reference admission and real FFmpeg frame/MP4 provenance audit. They are not
model-generated catalogue films and do not constitute GPU qualification. No
live inference, model download or runtime restart is performed by this change.

## Qualification runner

Inspect the actual Arjuna source without creating a job or invoking a model:

```powershell
node scripts/benchmark-ltx-shot.mjs
```

The default source is `a707a1a2-66da-415d-9051-c8ff805cb915`. It must first pass
the in-app visual review bound to its actual delivered video. A missing review
returns `LTX_SOURCE_NOT_REVIEWED`. The CLI reads the canonical existing SQLite
store and checks the source's registered playback asset, model/node inventory,
CUDA device and at least 2 GiB of free storage. It does not install anything.

After source review, use one explicit bounded comparison:

```powershell
node scripts/benchmark-ltx-shot.mjs --run --profile draft-512 --queue-policy fifo --tiled-decode
```

This creates a new `ltx-qualification` UUID and row in Jobs, saves the request,
progress and full evidence, then registers its playback assets with status
`review_required`. It never changes the original project, timeline, latest output
or catalogue selection. `--profile comparison-1024` selects the larger native
comparison. `--data-dir "C:\path\to\existing\data"` selects an existing store.

Do not restart the API server while the runner is active: server startup recovery
will mark running work interrupted. The server must load the qualification
Retry/Cancel guards before the first run. Its generic worker does not own this
experimental process, so those actions return a 409 diagnostic and the Jobs UI
does not display their buttons for this type.

The runner prints its new job ID and stop command:

```powershell
node scripts/benchmark-ltx-shot.mjs --stop-job <new-qualification-job-uuid>
```

This writes only `stop.requested` inside that active qualification's canonical
job folder. The runner then cancels its recorded provider prompt and blocks
completion. SIGINT/SIGTERM use the same owned cancellation path. No arbitrary
path, shell command, or unrelated ComfyUI job is accepted. A failed/stopped
qualification remains visible with its diagnostic and retained files; another
qualification run creates a fresh UUID.
