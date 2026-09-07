# Live VYREALM capture

Started at 2026-09-07 21:55:04 UTC, after the first Arjuna keyframe had already been generated. This recording observes the real local VYREALM application at `http://127.0.0.1:4173/`, in a dedicated 1920 × 1080 browser viewport. It does not record Codex, unrelated applications, or private browser sessions.

Recorder PID: `38996`.

Five-minute browser video segments are finalized as `.webm` files. Their adjacent JSON files record UTC start/end/finalization times, measured duration, dimensions, file size and SHA-256. Segment gaps are visible in those times. There is no retiming, generated replacement UI, synthetic demonstration footage or performance comparison claim.

`journal.jsonl` records a chained hash for events, and hashes of screenshots, video segments and sanitized API snapshots. API snapshots contain only this production's selected metadata and jobs. Session tokens and authorization values are not recorded. The first observed state was a running generation job at 25%, waiting for the local GPU with prior frames retained.

The capture records browser pixels, **not audio**. The produced film's sound design and narration need their own actual listening/export checks. Visible model/job status is workflow evidence, not proof that the eventual film passes a cinematic quality benchmark.

## Read-only controls

Write one JSON object to `capture-command.json` in this folder. The recorder consumes each distinct file content once. Include a new `id` for repeated commands.

```json
{"action":"navigate","view":"Jobs","id":"show-jobs-1"}
```

Supported views: Dashboard, Create, Production plan, Storyboard, Timeline, Assets, Jobs, Export, Catalog, Settings. Navigation pauses the automatic view cycle for one minute.

```json
{"action":"screenshot","id":"capture-current-1"}
```

```json
{"action":"stop","id":"finish-recording-1"}
```

Creating a file named `STOP` in this folder also requests a graceful stop and finalizes the current video. Do not kill the process when a graceful stop can be used; an abruptly killed current segment may not finalize.

The recorder never clicks generation, review, download or other mutation buttons. Browser mutations and external requests are blocked. The app continues producing media independently. Its live data and UI are neither substituted nor edited by the capture.
