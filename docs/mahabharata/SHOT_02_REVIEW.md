# Shot 02 — The cost

Review date: 8 September 2026. Project `e92789c9-ef27-44fc-b29d-aa01d3eea25b`, job `a707a1a2-66da-415d-9051-c8ff805cb915`. Scope: one silent five-second portrait candidate for **Between Two Armies**, not acceptance of the complete trailer or a comparative quality benchmark.

## Examined evidence

- Original generated keyframe: `keyframe/frames/00000.png`, SHA-256 `957efafb8aa68c96a6efd2417fdc4137e0b0d481a000986a1aa485d58561e75b`.
- Native source: `generated-source.mp4`, 1024 × 576, 120 frames at 24 fps, five seconds. SHA-256 `93c2b0c95957e6547989ae9aab6269966c6bb82802b517a7fc291d04bffb36e3`.
- Delivery: `delivery-1080p.mp4`, 1920 × 1080, Lanczos resize of the native source. SHA-256 `2a46c05ae50b1ca041ce4f3968ca6a5a37c0fb6b4da8edae2559dbab2c65ce98`.
- `contact-sheet.png`: one actual decoded frame per second. `frame-review-01.png` through `frame-review-04.png`: all 120 decoded source frames, 30 per sheet. Native frames 48 and 119 were also inspected individually.
- `verification.json` and provider records: 121 provider PNGs retained; 120 delivered frames. Full native and delivery decode passed. Recorded output lineage ties the provider frames to the native source and resized delivery.

All paths above are relative to `C:/Users/lalwa/AppData/Roaming/vyrelum/data/jobs/a707a1a2-66da-415d-9051-c8ff805cb915/`. Hashes distinguish the original source, resized delivery and reference image.

## Visual judgment

The subject has a recognisable, detailed face; a gold headband, tied dark hair, moustache and chin beard; woven saffron cloth; and segmented dark shoulder protection. Face, facial hair, headband and clothing remain coherent in the inspected frame sequence. Warm light from camera-left models the face and fabric, with blurred banners behind the subject. Loose hair and banners move. The expression begins alert and worried; the eyes close and the head lowers near the end. This is a restrained human reaction rather than a rotating primitive or a zoomed static illustration.

No obvious severe facial deformation, disappearing headband, black placeholder background, primitive geometry, debug text or watermark was observed across the inspected 120 frames. The slight push and head movement preserve the portrait composition. This supports using the clip as the planned reaction portrait, subject to playback verification in the app.

## Limits and required continuity

- The close portrait does not establish two armies, a chariot or Kurukshetra. It cannot replace the establishing shot. The bright sky is comparatively featureless and the environment needs the wider shots.
- The cropped hand/grip at frame-left is insufficient evidence for a bow or finger-detail acceptance. Shot 03 needs its own anatomy and prop check.
- Cloth grain and the dense hair mass retain some synthetic regularity. Do not claim perfect skin, hair or fabric realism, or parity with the supplied reference.
- The approved project revision deliberately adopts this reference's moustache and chin beard. Earlier clean-shaven wording remains in immutable generation history; subsequent shots must follow the revised reference.
- This shot is silent. No dialogue, lip-sync, score, sound-to-action alignment or complete-film rhythm has passed. Sound and the remaining five shots still require production and review.
- Full-frame contact sheets provide broad visual coverage but do not replace real-time playback for temporal judgment. The application playback result and final review decision are separate evidence.

## Generation and timing

VYREALM invoked local ComfyUI with `Wan2.2-TI2V-5B-Q4_K_M.gguf`. Motion prompt ID: `23afe5a5-5aa0-4c09-938f-753f3eb73f1c`; workflow hash: `1ac9fcb0f3032896f6cc0831c94a938f01cf212e0a96173b64044523d2fb28c5`; seed: `730241`. The motion provider stage ran approximately 49 minutes 11 seconds, including prolonged decode. Recorded whole-device peak VRAM was 5.840 GiB; this is not a process-isolated memory measurement. The overall job duration also includes earlier stages and interruption/recovery, so it must not be presented as pure inference time.

Source method: **locally generated keyframe and neural image-to-video; 1080p delivery resized from 1024 × 576**. It is neither native 1080p generation nor a 4K output. No external generated clip was substituted. No numerical quality score, flagship approval or superiority claim is assigned by this review.

## User rejection amendment — 8 September 2026

**Final creative decision: REJECTED_CASTING.** This amendment supersedes the earlier suggestion that the clip could serve as the reaction portrait. The user explicitly rejected the character design as inaccurate for their intended Mahabharata portrayal. Successful generation, coherent motion and detailed textures do not override that creative rejection.

The old source, delivery, hashes and inspection observations above remain intact as historical evidence. Do not apply this shot to the trailer, approve it as a character reference, reuse its face for later shots, or publish it as an accepted flagship film. Rejection concerns the requested casting and art direction; it does not assert the depicted subject's actual ethnicity from facial appearance.

Production-script revision 6 removes this image path and hash from the active Arjuna reference and retains revision 5 under `history/production-script.revision-5.json`. The replacement is an original clean-shaven Arjuna with loose wavy black hair, a saffron angavastra over an ivory dhoti, modest gold kundala earrings and a low diadem. The prior topknot, moustache/chin beard and segmented shoulder protection are not part of the new design. These are explicit creative choices informed by Indian epic visual traditions, not a claim that one facial appearance or costume is historically definitive.

A newly generated keyframe must be visually inspected for brief adherence before motion is commissioned. Face continuity must be checked against that new accepted reference; a text prompt alone is not evidence of reference locking. See `CASTING_DIRECTION_R6.md` and `KEYFRAME_PROMPTS_R6.json`. No replacement frame, motion clip or trailer is approved merely by this amendment.
