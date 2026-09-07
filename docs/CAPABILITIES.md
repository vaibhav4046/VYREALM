# Internal capability registry

VYRELUM keeps production capabilities in `capabilities/manifest.json` and executes them through `capabilities/registry.mjs`. The catalogue is internal to the application; it is not a marketplace and it does not execute downloaded instructions. Each entry carries typed input/output contracts, an adapter name, dependency checks, acceptance criteria and attribution notices.

Run `node capabilities/registry.mjs` to emit a machine-readable readiness report. The same report is included in authenticated `GET /api/state` as `capabilities` and `capabilityCatalogue`. A blocked capability is a deliberate diagnostic: the engine does not substitute a graphics clip for a missing neural, audio or speech runtime.

The adapters that do not need a model are executable offline today: supplied transcript segments become editable captions, local talking-head takes become a deterministic cut list, and product images/clips become controlled template and camera-motion ads. Music-to-video requires a qualified local ACE-Step beat source; audio mixing requires a bundled or explicitly configured FFmpeg binary. Director and explainer routing may use the selected loopback Ollama model, with deterministic templates when it is missing. These checks never download models or call a hosted service.

The HyperFrames and React Video Editor references in the manifest are attribution and design provenance only. Timeline behavior is independently implemented and no source is copied from those projects.
