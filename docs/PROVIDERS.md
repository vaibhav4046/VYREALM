# Local provider contract

VYRELUM providers implement `runtime/providers/provider-contract.mjs`. The contract is deliberately capability oriented: every provider reports health, supported operations, installation guidance and resource estimates, and every operation returns a structured result or a diagnostic. A provider cannot claim readiness from a static catalogue entry.

`runtime/providers/comfyui.mjs` is the loopback ComfyUI adapter. It checks `/system_stats`, `/object_info`, and model folders, performs workflow, VRAM, and optional disk preflight, submits `/prompt` requests, polls `/history/:promptId`, and cancels via `/interrupt`. Missing nodes and checkpoints are returned by name (`WORKFLOW_REQUIREMENTS_MISSING`); no substitute renderer is used. Input uploads use the local `/upload/image` endpoint and are never sent to a hosted service.

ComfyUI is optional on the constrained local profile. With no running instance, health is `available: false` and the app should show the returned installation steps and `COMFYUI_UNAVAILABLE` diagnostic. Large model downloads are never performed by the adapter.
