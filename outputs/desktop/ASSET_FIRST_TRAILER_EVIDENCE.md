# VYREALM asset-first cinematic evidence

Date: 2026-09-07 (Europe/London)

The visible cinematic path now uses three bundled high-detail raster keyframes and FFmpeg camera motion. The default `produce` worker does not call Blender for the trailer path, so Blender primitives cannot appear in the camera unless an explicit legacy scene mode is requested.

- Source method: bundled development-generated photoreal keyframes, not native neural video and not an upscale of the old vector placeholder.
- Trailer: `VYREALM_CINEMATIC_15S_TRAILER_1080P.mp4`
- 4K delivery: `VYREALM_CINEMATIC_15S_TRAILER_4K.mp4` (3840x2160, 24 fps, H.264 High, 60 Mbps target; CPU temporal-safe Lanczos enhancement from the 1080p source).
- Three shots, five seconds each, 1920x1080, 24 fps, 15 seconds total.
- Sound design: local FFmpeg generated ambient/tonal bed.
- Dialogue captions: optional; disabled for this acceptance render.
- Contact sheet: `VYREALM_CINEMATIC_15S_TRAILER_CONTACT_SHEET.png` (one frame per second, visually inspected).
- Quality receipt: `VYREALM_CINEMATIC_15S_QUALITY.json` reports `review_required`. Technical media checks pass (1920x1080, 24 fps, 15 s, 360 decoded frames, audio sync, no black seconds); semantic realism and action/audio alignment still require an evaluator review and are not self-awarded.

The quality gate rejects non-keyframe sources, primitive/debug/placeholder filenames, missing shot count, short duration, missing audio, invalid captions, unreadable luma/contrast, and static frames. It records the subject, environment, foreground, background, lighting, and camera direction for every shot. A render is not labelled cinematic until the semantic review has valid per-category evidence at 7/10 or above.

This is a deliberate stylised fallback for a 6 GB laptop. It is not a claim of native neural-video or hosted frontier quality.
