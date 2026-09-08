# Time-sampled VYREALM observation

This folder contains actual screenshots of the local VYREALM application and
read-only engine-job snapshots. It is **not a continuous screen recording**.
There is no audio capture and no synthesized video made from the screenshots.

Each screenshot records its request time, completion time, SHA-256 hash, and
selected app view. Capture is requested approximately every 15 seconds;
processing and machine load can increase the actual interval. Five-minute
sample-window manifests preserve those actual intervals and disclose the
longest gap. Activity between screenshots is not asserted.

One persistent browser observes only http://127.0.0.1:4173. It cannot submit
generation jobs, alter the film, approve quality reviews, upload media, or
publish. It reads the existing Mahabharata project
`e92789c9-ef27-44fc-b29d-aa01d3eea25b` and changes only its displayed app view.
Observation started after generation submission and earlier recording gaps.

The observer has a four-hour bound. Create `STOP` in this folder to request
termination. `capture-command.json` accepts read-only navigation, screenshot,
or stop commands. Check both the process and fresh `run-status.json`/journal
timestamps before describing observation as live.

A separately recovered continuous 302.48-second recording is retained in
`outputs/verification/mahabharata-live/run-2026-09-08T00-30-09-225Z` in the
workspace. Its separate recovery audit verifies all 7,562 encoded frame
packets and timestamps, full FFmpeg decoding, and duration against wall time.
Neither that interval nor these samples claim to cover the complete production
or establish superiority to another filmmaking system.
