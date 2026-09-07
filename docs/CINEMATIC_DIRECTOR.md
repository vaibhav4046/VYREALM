# Local cinematic director

`runtime/director.mjs` defaults to `mode: "cinematic"`. Its Ollama structured output contains a title, treatment and shot list. Each shot has a prompt, integer frame duration, camera, source route, subject, environment, action, lighting, depth and continuity. The route must be `neural-video` or `image`; the latter is for requested still keyframes. A missing or invalid route is an error, not a request for Blender geometry.

The cinematic schema contains no Blender `scene`. Responses that include one are rejected. A provider unavailable for a requested route leaves that route intact and marks the plan blocked with a capability diagnostic. A ready plan is explicitly `generationStatus: "not-generated"`; it provides neither a playable output nor proof of source generation. Provider receipts and subsequent visual review remain required.

Explicit `mode: "abstract"` or `mode: "scene3d"` selects the existing bounded editable scene contract. Only that prompt asks the local model for primitive geometry. The abstract branch in `workers/produce.mjs` passes its mode explicitly.

Captions are disabled by default. Set `captions: true` to permit requested narration, dialogue or titles. Missing captions stay empty; the director never invents chapter labels.

The CLI accepts these fields through its existing `--input` JSON request. Public helpers `directorMode`, `directorSchema`, `directorPrompt` and `validateDirectorPlan` allow callers and tests to inspect the same contract used by `createProduction`. Plan-cache identity version 5 separates these responses from the previous scene-required prompt and includes mode/caption preferences.

Run the focused regression checks with `node --test runtime/director.test.mjs`. They cover route rejection, typed cinematography, explicit abstract preservation, caption preferences, duration bounds, and an Ollama transport fixture through validation and persistent plan caching. The fixture does not claim a real local-model benchmark or generated video.
