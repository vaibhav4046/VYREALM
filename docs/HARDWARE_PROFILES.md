# Hardware profiles

VYRELUM performs a local hardware preflight before exposing production routes. It never downloads a model during detection. `GET /api/hardware` returns the measured profile, GPU/driver information when available, RAM, and the route budget; `/api/state` includes the same object for the desktop UI.

| Profile | Gate | Local routes |
| --- | --- | --- |
| `RENDER_ONLY` | No measurable discrete GPU | Scene3D, edit, captions, audio mix |
| `LOW_VRAM_LOCAL` | Discrete GPU below 6 GB VRAM, or under 15 GiB RAM | Scene3D, edit, captions, audio mix |
| `STANDARD_LOCAL` | At least 6 GB VRAM and 15 GiB RAM (the OS reading for a marketed 16 GB machine) | Above plus qualified compact image adapters |
| `CREATOR_LOCAL` | At least 12 GB VRAM and 32 GiB RAM | All adapter routes, subject to per-model acceptance tests |

A route that is outside the profile is blocked with a stable diagnostic (`NO_DISCRETE_GPU` or `INSUFFICIENT_HARDWARE_PROFILE`). Adapter availability is checked separately, so a profile never implies that an uninstalled model is ready.
