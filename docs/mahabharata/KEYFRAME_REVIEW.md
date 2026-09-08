# Arjuna keyframe inspection

Inspected the original PNG visually at its native 1024 × 576 resolution on 7 September 2026. This assessment covers one still image only.

- File: `C:/Users/lalwa/AppData/Roaming/vyrelum/data/jobs/a707a1a2-66da-415d-9051-c8ff805cb915/keyframe/frames/00000.png`
- SHA-256: `957efafb8aa68c96a6efd2417fdc4137e0b0d481a000986a1aa485d58561e75b`
- Compared against: `docs/mahabharata/production-script.json`, especially the Arjuna character description and shot 02, “The cost”.
- Decision: **usable high-detail character-reference candidate; conditional permission to attempt motion, not final shot or film acceptance.** Resolve the facial-hair continuity mismatch before locking this character reference for subsequent shots.

## What is visible

The image contains a recognisable adult human face with individual facial features, a gold headband, tied long dark hair, a textured ochre/saffron wrap, and dark segmented shoulder protection. Soft cloth banners occupy the background. Warm light comes from image-left and models the face and fabric; the shadow side remains readable. The subject, nearer arm, and blurred banners provide some depth. This is substantially more detailed than flat vector art, a polygon scene, or a black-background placeholder.

The eyes, nose and mouth are readable and broadly coherent in this frame. Skin has visible fine texture and a warm, slightly stylised photographic appearance. The moustache and beard are clearly present. The fabric has a visible woven pattern, folds and shading, and the shoulder protection has curved edges and highlights. Loose hair strands cross the lighter background. No watermark, debug text or default primitive is visible.

## Issues that must remain explicit

1. **Character specification mismatch:** the script locks a clean-shaven Arjuna, while this frame has a moustache and short beard. Either regenerate a clean-shaven reference or make an explicit versioned change to the character description and retain this exact facial hair in every later shot. Silently treating both as the same locked appearance would fail continuity.
2. **Limited environment evidence:** flags and bright sky suggest an exterior gathering, but the frame does not establish Kurukshetra, a timber chariot, horses, soil, or two armies. It can serve as a portrait reference; it cannot replace the planned establishing shot. The planned blurred rope foreground is not visible.
3. **Performance is not established:** the visible expression is alert and intent. Grief, recognition of kin, a caught breath and a lowered gaze are not demonstrated by this still. Those actions require inspection of the generated motion clip.
4. **Anatomy is only partially assessable:** the visible face and shoulder have no obvious severe deformation. The raised hand/forearm is cropped at the left edge, so finger count, grip and the complete wrist/arm relationship cannot be accepted. No bow is visible. Do not reuse this frame as evidence that the bow insert has passed.
5. **Texture still has synthetic regularity:** skin and especially the woven cloth show fine, rather uniform texture. The top hair mass is unusually smooth and dense compared with the loose strands. These could become unstable or shimmer during animation. The still is usable for a motion experiment, but it does not justify a claim of reference-level skin, hair or fabric realism.
6. **Costume is a creative interpretation:** the saffron/ochre wrap, gold band and protective shoulder piece fit the intended broad epic palette, but this image does not establish historical costume accuracy. The dark layered protection should remain consistent rather than changing shape or style between frames.
7. **Lighting and composition limits:** the warm side light and shallow background focus are readable. The bright, largely featureless sky reduces environmental richness; the tightly cropped hair bun and arm should remain intentional. A distinct rim light, physically accurate reflections and convincing motion blur cannot be verified here.

## Required checks after animation

Inspect the actual five-second clip and extracted samples for stable eyes, nose, lips, ears and beard; stable headband placement, shoulder plates and cloth weave; believable eye movement and breathing; coherent loose-hair motion; stable banners and light direction; and camera movement that preserves the face and anatomy. Inspect between sampled frames as well as the contact sheet. Reject face melting, texture flicker, facial-hair changes, duplicated anatomy, unmotivated mouth movement or a frozen portrait presented as acting.

Audio, lip-sync, sound-to-action alignment, frame-to-frame consistency, complete shot duration, output provenance and final export decoding were **not** evaluated in this still-image review. No numerical quality score has been assigned. No review API has been called, and no film or flagship catalogue entry has been approved by this document.

## Superseding user decision — 8 September 2026

**REJECTED_CASTING.** The user has rejected this character design for the intended Mahabharata portrayal. The earlier conditional candidate assessment is preserved for history and is no longer an approval to use this reference. Production-script revision 6 removes the image from the active Arjuna reference. See the user rejection amendment in `SHOT_02_REVIEW.md` for the decision and required replacement. No claim about the pictured subject's actual ethnicity is made.
