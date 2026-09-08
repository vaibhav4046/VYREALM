# Review the character before animating it

This route retains one generated still as a durable `generation-keyframe` job and registered image asset. It does not mark a still as generated video, attach an unreviewed image to the trailer, or accept the previously rejected Arjuna as a default reference.

Run from the existing VYREALM workspace with the installed local ComfyUI service. The same SQLite store and GPU lease as VYREALM's workers are used. No cloud account, API key, download or hosted generator is used.

```powershell
D:/node.exe scripts/generate-keyframe.mjs --request-file docs/mahabharata/keyframe-requests-r6/02-the-cost.json
D:/node.exe scripts/generate-keyframe.mjs --request-file docs/mahabharata/keyframe-requests-r6/02-the-cost.json --run
```

Refresh `expectedRevision` in the request to the current project revision before running. The first command is a read-only model/node/disk preflight. The second makes one real local Wan model call; it writes provider submission/completion logs, exact workflow/history, PNG hash, decoded image dimensions, model ID, prompt, seed and generation duration. Its completed status is `review_required`.

Inspect the exact emitted PNG, then write concrete casting/costume/environment/composition notes to a text file. The reviewer is judging suitability for the intended portrayal, not inferring anyone's ethnicity from facial appearance. A passing still review is not a motion-quality verdict.

```powershell
D:/node.exe scripts/generate-keyframe.mjs --review-job <generated-job-UUID> --verdict passed --expected-output-hash <PNG-SHA256> --notes-file <inspection-notes.txt>
D:/node.exe scripts/benchmark-ltx-shot.mjs --source-job <same-reviewed-job-UUID> --prompt-file <motion-prompt.txt> --seed 730602 --profile draft-512 --queue-policy fifo --tiled-decode --run
```

Use `--verdict rejected` when the still misses the brief. Rejected or changed images cannot enter the LTX route. The LTX command rechecks the canonical DB job, served image bytes, original provider evidence and hash-bound review immediately before inference. It creates a separate `ltx-qualification` job with 121 generated frames, 120 delivered frames, five seconds at 24 fps, and a 1080p Lanczos delivery. The draft model source is **512×288**; this is not native 1080p or 4K. `comparison-1024` requests 1024×576 source instead. Both LTX profiles remain experimental until measured and visually reviewed. Tiled decoding is opt-in and not a claimed quality improvement.

The original generated PNG is copied into the new motion job with source job ID/hash/provider prompt provenance. Motion must receive its own visual review, and the complete trailer still requires sound, edit, duration and final visual validation before catalogue admission.

Validation: `D:/node.exe --test --test-concurrency=1 runtime/keyframe-production.test.mjs runtime/ltx-production.test.mjs scripts/benchmark-ltx-shot.test.mjs` — 15 tests passed, including actual CPU PNG decode, SQLite review/asset integrity, and rejected/mutated/foreign/missing evidence. These CPU fixtures do not prove model quality or invoke the GPU.
