# Original shots through the local MCP bridge

This source extension exposes VYREALM's existing local, review-first worker. It does not use the MCP client's model to generate media and does not change the frozen 1.0.8 release.

| Tool | Required arguments | Product action |
| --- | --- | --- |
| `generate_original_keyframe` | `projectId`, `expectedRevision`, `brief` | Queue one locally generated still. Optional `seed` and `negativePrompt`. |
| `inspect_original_generation` | `projectId` | Read the current still and motion jobs, project revision, provider receipt, hashes and asset IDs. |
| `review_original_keyframe` | `projectId`, `expectedRevision`, `jobId`, `expectedOutputHash`, `verdict`, `notes` | Record an explicit operator decision on the exact still. `verdict` is `passed` or `rejected`. |
| `animate_original_keyframe` | `projectId`, `expectedRevision`, `keyframeJobId`, `expectedOutputHash` | Queue motion from the exact approved local still. Optional motion `brief`, `seed`, and `motionEngine` (`wan` or explicitly experimental `ltx-draft-512`). |
| `retry_original_generation` | `projectId`, `expectedRevision`, `jobId` | Retry an eligible interrupted stage; the backend rechecks ownership and retained evidence. |
| `cancel_original_generation` | `projectId`, `jobId` | Request cancellation of a current owned stage while retaining its work. |

Start with `inspect_project` to obtain the saved revision. Write an explicit visual shot prompt; the generation service saves this in `originalGeneration.brief` and leaves the overall project description unchanged. Poll `inspect_original_generation` after admission. Refresh the revision after each job completes or review is saved.

A queued or running response contains no completed output claim. An image response is a still, not video. Inspect its actual registered image and obtain an explicit operator verdict and notes before calling the review tool. A technical pass or an invented quality score is not approval. The backend checks the exact lowercase SHA-256 hash, same-project ownership, provider evidence and current revision again before animation. Changed, imported and rejected references cannot pass this gate.

The default Wan route produces a five-second, 24 fps clip with a 1024×576 neural source. The optional `ltx-draft-512` route uses the installed LTX-Video 0.9.8 distilled model, a fixed 512×288 source, eight steps and tiled decoding. The LTX choice is experimental and uses separate custom model-weight terms, retained in `runtime/notices/LTX-Video-Open-Weights-License-0.X.txt`. Unknown engine names are rejected before admission; no cloud or automatic fallback is selected.

Both routes retain a separately recorded 1920×1080 Lanczos delivery. The receipt retains source and delivery hashes and the resize method; this is not native 1080p or 4K inference. The complete clip remains `review_required` until inspected in VYREALM's motion review/export screen. These tools do not autoapprove, publish or add a film to the catalogue.

`run_generation_test` remains a named diagnostic. The legacy `generate_keyframe` tool remains unavailable and points clients to `generate_original_keyframe`; it is not a second production route.

Verification: `node --test runtime/original-generation-mcp.test.mjs runtime/automation-tools.test.mjs runtime/mcp-connection.test.mjs runtime/mcp-connection-ui.test.mjs`. The focused suite exercises typed arguments, revision conflicts, exact review receipts, mismatched owners/hashes, missing or imported evidence, cancellation and retry, plus a real stdio subprocess against an authenticated loopback HTTP fixture. Fixture evidence is synthetic and does not establish neural quality or speed. No GPU job, download or live-project mutation is performed by these tests.
