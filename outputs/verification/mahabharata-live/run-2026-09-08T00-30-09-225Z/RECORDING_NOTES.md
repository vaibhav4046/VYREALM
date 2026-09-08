# Mahabharata production observation — resumed capture

This is an unretimed recording of the real local VYREALM browser UI at
http://127.0.0.1:4173. It records **1280 × 720 browser pixels without audio**.
It does not record Codex, other applications, or unrelated browser tabs.

The recorder is an observer. It issues only read-only local API requests and
changes the selected view/project. It cannot submit generation jobs, edit the
project, approve visual reviews, publish a film, or replace the app UI.

This capture starts after the first keyframe and after the current motion
submission. The job is `a707a1a2-66da-415d-9051-c8ff805cb915`, in project
`e92789c9-ef27-44fc-b29d-aa01d3eea25b`. The engine had already submitted the
motion workflow at 2026-09-08 00:06:38 UTC with provider prompt ID
`23afe5a5-5aa0-4c09-938f-753f3eb73f1c`. This recording therefore cannot prove
an uninterrupted start-to-finish capture of that submission.

Five-minute segments are kept as original WebM recordings. Each is compared
against its wall-clock observation interval with a two-second tolerance. A
missing file, duration mismatch, or interrupted observation is marked
`incomplete`. No frames are duplicated, interpolated, retimed, or reconstructed
to conceal missing footage. Context reload and finalization gaps are recorded
as UTC intervals in the append-only SHA-256 journal.

Earlier runs are preserved:

- `run-2026-09-07T21-55-04-483Z`: an append-only timing audit marks segment 3
  incomplete: 109.8 seconds captured versus 300.48 seconds elapsed.
- `run-2026-09-08T00-09-49-856Z`: interrupted browser recovery attempts and
  real dashboard screenshots are retained; these do not constitute a full
  continuous production recording.

The recording documents visible engine state. It does not establish a
comparative quality win, neural generation provenance by itself, or captured
film sound. Those require the engine's saved model/workflow evidence and a
separate inspection of the generated film.
