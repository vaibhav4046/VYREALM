# Higgsfield benchmark and VYRELUM target

Research date: 2026-09-07

## Observed product surface

Higgsfield exposes Image, Video, Audio, Edit, Cinema Studio, Marketing Studio, 3D Jutsu, Canvas, community projects, presets, and a Supercomputer orchestration surface. Its public site also presents project-level prompts and assets as inspectable examples.

The Seedance 2.5 page claims 30-second audiovisual generation with sound matched to on-screen action and up to 50 multimodal references. Genjutsu is positioned as motion transfer/recasting: preserve motion while changing characters, locations, or products.

Sources: https://higgsfield.ai/ and https://higgsfield.ai/seedance-2-5-community and https://higgsfield.ai/higgsfield-genjutsu-presets

## VYRELUM implementation mapping

| Higgsfield capability | VYRELUM status | Evidence / behavior |
| --- | --- | --- |
| Cinema-style prompt to film | Implemented locally | Ollama director -> validated scene graph -> Blender -> FFmpeg timeline |
| Editable 3D scenes | Implemented | `.blend` source is promoted as an editable asset |
| Project prompts/assets/revisions | Implemented | SQLite project store, revisions, embedded portable assets |
| Audio/video finishing | Implemented | FFmpeg timeline, AAC output, captions, soundtrack gain/mute |
| 1080p delivery | Implemented | 1920x1080 render profile and verifier |
| 60 fps timeline contract | Supported | FPS bounds accept 1–60; must be measured per render |
| Motion transfer / neural video | Gated | Blocked until a qualified local checkpoint and adapter pass hardware tests |
| Generated speech/music | Gated | No fake success; requires qualified local adapters |
| Multi-reference neural generation | Gated | Asset planner/provider interface required; no unverified model claim |
| Public publishing | Approval gated | Release package requires explicit metadata and disclosure |

## Quality policy

A 6 GB laptop cannot truthfully promise parity with hosted frontier video systems. VYRELUM records whether output is locally generated, composited, upscaled, or interpolated, and fails closed when a requested route is unavailable.
