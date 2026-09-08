# Between Two Armies — replacement casting and art direction

8 September 2026. Scope: correct the rejected Arjuna design while preserving the original 30-second, six-shot story, 24 fps delivery and 44-word narration. This is a brief and source record, not generated-film acceptance.

The user rejected job `a707a1a2-66da-415d-9051-c8ff805cb915` for creative casting and Mahabharata art-direction accuracy. That rejection takes precedence over the earlier technical and visual candidate review. Its media and provenance stay in history. It is excluded from the active character reference.

## Primary collection evidence

| Record | What the collection supports | Limits |
| --- | --- | --- |
| National Museum, New Delhi, **Scene from Mahabharata**, accession 96.231/16 | The catalogue identifies Arjuna using a bow and Krishna driving his chariot. It identifies this as a modern Pahari painting from Kashmir. [Museum record](https://museumsofindia.gov.in/repository/record/nat_del-96-231-16-3829) | Establishes narrative roles in a later Indian artistic interpretation; it is not archaeological costume evidence. |
| National Museum, **The Cosmic Form of Krishna-Vasudeva**, 88.6; **Radha and Krishna**, 56.59/57 | Collection descriptions identify a richly detailed dhoti and jewellery in the first work, and peacock-feather headwear in the second. These provide points of reference for Krishna's textile and ornament direction. [Painting collection](https://www.nationalmuseumindia.gov.in/en/collections/index/13) | Mysore and Jaipur works from different periods and stories. The page's indexed text was available on 8 September; direct fetch timed out. No assertion that either costume was worn at historical Kurukshetra. |
| The Met, **Krishna and Arjuna (Krishna Arjun)**, Mumbai, mid-20th century, 2025.269.19 | Its catalogue describes Krishna as Arjuna's charioteer, their ethical discussion, Arjuna's bow and Krishna's conch. [Object record](https://www.metmuseum.org/art/collection/search/851494) | This is an Indian-origin modern print. Its image is restricted on the collection page; no image was downloaded, copied, bundled or passed to a model. |

These sources support narrative roles and a range of Indian visual traditions. They do not establish one uniquely correct face for Arjuna. No ethnicity is inferred from the rejected portrait. Primary Bhagavad Gita references for narration remain in `SCRIPT_RESEARCH.md` and the production script.

## Original design decisions

Arjuna is an original adult Indian epic character with a clean-shaven expressive face, loose shoulder-length wavy black hair, a low gold diadem, modest kundala earrings and a gold armlet. An ivory cotton dhoti with a narrow woven gold border and deep saffron silk-cotton angavastra make the costume readable through fabric and drape. A simple wrist guard supports the archery role. No prior topknot, facial hair or segmented shoulder plates carry forward. These are declared creative decisions, not facial rules for an ethnic group or a likeness of a real actor.

Krishna is an original compassionate, clean-shaven charioteer with gently blue-toned skin, dark curls, yellow pitambara and upper drape, restrained gold ornaments and one small peacock feather in modest headwear. He holds reins and offers counsel. A flute, fighting pose, neon halo or invented spoken dialogue would misdirect these shots.

The chariot has a low timber body, curved carved rail, spoked wooden wheels and restrained brass fittings; white horses and woven cloth standards establish the epic battlefield. Wood, earth, leather, cotton and silk must have visible detail. Dawn, exact materials, jewellery and the chariot's construction are artistic interpretation. Keep warm key light from camera-left, cool fill and a restrained brass/saffron palette across all six shots.

## Production handoff

Generate the new `02-the-cost` still first. Inspect the whole head, clean-shaven face, loose hair, fabric drape, diadem and setting before committing five seconds of motion. The script and request files do not prove any asset exists.

- `production-script.json`: revision 6; unchanged six 5-second shots and 44 narration words.
- `history/production-script.revision-5.json`: exact prior script retained.
- `KEYFRAME_PROMPTS_R6.json`: six detailed source and simple motion briefs, rejection checks and shared negative prompt.
- `keyframe-requests-r6/*.json`: keyframe-only request inputs. `expectedRevision: 6` is a preparation snapshot; refresh against the canonical project at submission. Each uses seed 730601–730606, 1024 × 576, 20 steps and bounded FIFO.

Text-conditioned shots are independent candidates. Do not call identity locked unless the actual supported workflow conditions on an accepted reference and the results pass comparison. If a second Arjuna image changes the face, hair or wardrobe, reject only that stage. A faster render must not convert a casting failure into approval.

The six shots remain: halted chariot and field; Arjuna's recognition; the bow grip slackening; Krishna's counsel; Arjuna listening; quiet resolve and editorial title. Offscreen narration avoids unsupported lip-sync claims. Titles are added in editing, not generated as unstable text. No new media, motion, audio mix, full trailer or catalogue approval is claimed by this document.
