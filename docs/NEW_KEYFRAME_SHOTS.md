# Appending a new local shot

Create / Timeline → **Direct the next shot** exposes two keyframe sources:

| Choice | Visual input | Continuity expectation |
| --- | --- | --- |
| Reuse reviewed keyframe (default) | The selected generated keyframe is reused for new motion. | Inspect face, wardrobe, motion and objects in the new clip. Reuse does not guarantee consistency. |
| Generate a new keyframe | The local model produces an independent image from the new shot brief, then animates it. | The selected reviewed job is a generation prerequisite, not image conditioning. Matching a previous character is not guaranteed. |

For a new setting or subject, include the subject, environment, clothing, lighting, framing, action and camera direction. A new keyframe is appropriate for an establishing shot or a distinct character. Do not describe the resulting shot as identity locked.

Both choices require a succeeded, passed-review, generated `generation-test` or `generation-shot` job from the same project. The server verifies its owned media and review hash; a UI option is not permission to bypass that gate.

The UI sends:

```json
{
  "projectId": "current-project-id",
  "expectedRevision": 8,
  "referenceJobId": "reviewed-job-id",
  "brief": "Original detailed shot direction",
  "sourceMode": "new-keyframe"
}
```

`sourceMode` also accepts `locked-keyframe`; omission retains that default. The server keeps `sourceMode` and the prerequisite job in the durable input. In new-keyframe mode it omits the worker's image reference so the worker must generate a fresh keyframe. Both modes use the next-shot append route; this does not call the first-shot smoke-test route.

Every new result still needs visual inspection. A stale project revision retains its completed job for review and explicit application. Do not regenerate the whole timeline solely because an independent shot fails inspection.

The local UI keeps the source choice, reference selection and brief through polling while the page is open. This draft is cleared after the API accepts a new job. A browser reload can discard an unsubmitted draft.

Focused verification: `node --test runtime/project-status-ui.test.mjs` covers default and explicit request modes, required references, unsupported modes, honest continuity wording and reference eligibility. Provider execution and actual motion quality require separate runtime and visual verification.
