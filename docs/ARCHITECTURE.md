# VYREALM architecture

This diagram describes the public `v1.0.8` source snapshot, commit `d93d498701573d0d1fafec61f75e3f0189533888`. It is a conceptual component and execution map, not a screenshot or a promise that every optional runtime is installed.

## Read the four chapters

1. **Entry and state.** Browser/Windows Studio, six project templates and an optional stdio MCP bridge converge on the Node.js loopback API. The released bridge advertises 46 tool definitions, including compatibility aliases and tools that may report unavailable capabilities; this is not 46 independently qualified production features. SQLite holds projects, revisions and durable work records. Local files hold imported assets, renders and receipts. A session token protects API calls. YouTube credentials use a separate protected vault, with Windows DPAPI protecting its encryption key.
2. **Editing flow.** Explicit source ranges and bounded edit instructions become a checked plan against a project revision. Owned worker jobs report state and support the controls implemented by their route. FFmpeg edits/renders media; the shared heavy-worker lease serializes the heavy execution paths, not every HTTP request or every lightweight operation. Preview, captions, sound and timeline edits can be saved and rendered again. Technical verification and human output review are distinct.
3. **Optional paths.** Ollama supplies local draft chat replies labelled suggestions-only. Configured Piper and Whisper provide local CPU narration and transcription. ComfyUI/Wan generation needs model files and hardware preflight; output requires review. Real-ESRGAN and RIFE are optional post-processing routes, not a claim of native generated detail or native high frame rate. Explicit online research retrieves bounded public HTTPS sources and stores source receipts. It is not autonomous trend intelligence. Guided audio installation and the newer Original shots UI belong to later source work and are excluded from the released flow.
4. **Outputs and review.** MP4 output, an extracted 1280×720 thumbnail and draft creator copy remain local. Local automations render a saved revision, verify its file, prepare materials and end at `needs-review`; scheduling requires the local app to run, and revision changes pause the workflow. YouTube needs separate account configuration and OAuth consent. Channel/analytics readback was live-verified in the configured environment. The private-only upload route has mock-test coverage; no production upload or public publication was performed for that qualification. Upload requires confirmation tied to the reviewed output, project revision and channel.

Lavender arrows show the shared execution path. Teal marks saved state and media. Amber identifies optional connections or qualification boundaries. Dashed arrows indicate an explicit repeat/optional action. Directional flow is conceptual; storage reads and writes are not an exhaustive call graph.

## Source map

| Diagram component | Public source |
|---|---|
| Loopback API, session token, SQLite schema, owned jobs and heavy lease | [`server.js`](../server.js) |
| MCP protocol and shared local API dispatch | [`mcp-server.mjs`](../mcp-server.mjs), [`automation-tools.mjs`](../runtime/automation-tools.mjs) |
| Bounded edit planning and verified result registration | [`raw-footage-plan.mjs`](../runtime/raw-footage-plan.mjs), [`raw-footage-service.mjs`](../runtime/raw-footage-service.mjs) |
| Revision-aware local scheduling and review boundary | [`local-automations.mjs`](../runtime/local-automations.mjs) |
| Ollama context and suggestions-only replies | [`studio-conversation.mjs`](../runtime/studio-conversation.mjs) |
| Local audio worker | [`audio.mjs`](../workers/audio.mjs), [`audio-local.py`](../workers/audio-local.py) |
| Optional ComfyUI provider | [`comfyui.mjs`](../runtime/providers/comfyui.mjs) |
| Bounded online research | [`project-research.mjs`](../runtime/project-research.mjs) |
| Actual thumbnail and deterministic publishing drafts | [`creator-pack.mjs`](../runtime/creator-pack.mjs) |
| YouTube confirmation, private upload and protected credentials | [`youtube-service.mjs`](../publishing/youtube-service.mjs), [`youtube-vault.mjs`](../publishing/youtube-vault.mjs) |

Runtime qualification is narrower than code availability. See the README capability table and verification guide for prerequisites and evidence. The animation asserts no cinematic-quality superiority, virality guarantee or autonomous publishing.

## Accessible alternatives

The animated diagram loops through four chapters over 18 seconds. Use the [static full-resolution PNG](media/vyrealm-architecture-poster.png) or [SVG poster](media/vyrealm-architecture-poster.svg) to read at your own pace. A [higher-quality MP4](media/vyrealm-architecture.mp4) is also available. All diagram artwork consists of vector shapes and text, rendered locally without generated imagery.
