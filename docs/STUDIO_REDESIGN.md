# VYREALM Studio redesign

8 September 2026. Existing application and canonical project/job store retained.

The subject is a working local filmmaking studio. The main surface is **Studio chat**, with a persistent project context for characters, shots and production actions. **Creator OS** and **Film Studio** are saved workspace preferences, not separate databases or disconnected applications. Both keep every existing tool reachable. Dashboard remains available for production status and the research → script → shots → edit → review → export sequence.

## Design decisions

- Graphite `#0c0d10`, panel `#14161c`, silver-white `#f0f0f5`, muted text `#a3a5b6`, lavender `#b9a3ff`, restrained amber `#e9ad66` for the work-in-progress marker.
- Segoe UI / native platform sans for operations, Georgia for the restrained film-title display, Consolas / platform monospace for technical metadata. No font binaries were present outside dependencies; system-font fallbacks keep this offline and avoid copying OS font files or loading a CDN.
- The dashboard's signature is an editorial film slate paired with a live production status panel. It does not display rejected media, artificial film stills or fictional success counters. Actual queue/project counts remain visibly labelled.
- A chat-first main column and project-context side column join creative instructions to project state. On narrow screens, context can collapse above the conversation and the composer stays above the bottom navigation. Root integration owns chat behavior, production actions and catalogue content.

## Functional changes

Studio chat is the initial route and appears first in both workspaces. The workspace preference survives reloads in `vyrealm:workspace`. Switching it preserves the selected project and active tool. Existing navigation labels and action IDs remain compatible with the engine. Dashboard workflow links open the referenced project and correct tool; selecting another project first attempts to save existing edits and stops if they remain unsaved.

The first-load state shows a skeleton and disables refresh/search while local data loads. Project opening is coalesced and disables the clicked action while fetching. Manual refresh visibly disables its control. Job polling still uses the lightweight queue path and does not replace the chat transcript or composer.

At mobile widths, the sidebar is a dismissible drawer with a dedicated close control, backdrop, Escape, a focus trap and inert background. The closed drawer is inert to keyboard navigation. Resizing restores the normal desktop sidebar. Four equally sized bottom controls prevent navigation overflow. Buttons, forms and dialogs share keyboard-focus, loading, hover and reduced-motion styles.

## Verification record

- JavaScript syntax check passed after shell and dashboard changes.
- Existing project-status and polling suite: 19/19 passed before chat-module import integration. The Dashboard fixture now explicitly selects Dashboard because the initial route intentionally changed to Studio chat.
- Actual 1440px and 390px browser verification is required after the chat wrappers are integrated. Do not read this design note as proof that a render, character, film or catalogue entry passed its own acceptance gates.

### Integration checkpoint

The navigation now uses a consistent set of original inline SVG icons with text labels. No icon library, icon font or remote resource is required. The VM status/polling harness strips the specific chat-module import because those tests exercise the existing rendered status functions; 19/19 passed with that integration adjustment.

A live browser pass inspected Dashboard at 1440 × 1000 and 390 × 844, persisted workspace selection across reload, exercised mobile close/Escape/backdrop/inert behavior, and opened Create, Production plan, Timeline, Jobs and Catalog without horizontal page overflow at 390px. Screenshots are in `outputs/verification/studio-redesign/`. The first pass stopped on a resize-event timing assertion, subsequently changed to wait for the actual desktop inert state. It was not declared a complete pass.

At 03:03 BST, the running server returned HTTP 404 for `/studio-chat.js` even though the new source import existed. A subsequent full run correctly timed out waiting for application bootstrap. Final integrated chat verification therefore remains pending the coordinated server update; no installed desktop build has been tested by these source-browser checks.

### Verified after coordinated server restart

The module route is now served. `scripts/verify-studio-redesign.mjs` passed against the actual local application: all fifteen tool entries, workspace preference after reload, Dashboard at 1440px and 390px, mobile drawer close/Escape/backdrop/inert states, and Create, Production plan, Timeline, Assets, Jobs and Catalog at 390px. No horizontal page overflow or browser page errors were found.

`scripts/verify-studio-chat-ui.mjs` exercised the actual chat interface without sending a message or modifying a project: default chat at 1440px, an unsent draft retained across Dashboard navigation, selection of the existing Mahabharata project, character/shot context, collapsed mobile context at 390px, the asset tab, and Shift+Enter adding a newline. No external requests or browser page errors occurred. The character/shot adapter was corrected after the first observation missed the existing `productionPlan`/`characterReferences` data. A separate canonical-data follow-up is still needed for the old casting descriptions; the UI does not certify them as accepted.

Visual inspection caught the mobile composer covering text. It was corrected by keeping the composer in normal layout flow and scrolling the conversation within its available column. The verification now also checks that the composer and visible message region do not overlap. Final desktop and mobile screenshots are `chat-default-1440.png` and `chat-project-390.png` under `outputs/verification/studio-redesign/`; JSON browser results are beside them. All 19 existing status/polling tests passed after integration.

These checks verify the source application UI. They do not assert that an installed desktop package, neural generation, the replacement casting or the completed Mahabharata trailer has passed.

### Whole-product finishing pass

The graphite/silver/lavender palette now also matches the standalone `public/catalogue.html` page; its 22 tests pass, including the effective-token contract. Create, Production plan, Storyboard, Timeline, Assets, Templates, Automations, Jobs, Settings, Export and MCP tools were opened in the actual application at both 1440px and 390px. All 22 view checks passed with the expected neutral page/panel colors, no horizontal page overflow and no browser page errors. Screenshots and the measured results are under `outputs/verification/studio-redesign/views/`.

This audit found a real existing-plan crash: format recipe markup assumed every `productionPlan` had `timeline` and `sourceRequirements` arrays. The renderer now distinguishes that format-recipe shape from a cinematic `shots` plan. The director and storyboard show the saved Mahabharata shot plan and its rejection/revision status, separately from the actual timeline clip count. Existing timeline clips remain selectable. A focused regression case was added; the combined status/polling/catalogue run passed 42/42 tests.

Card spacing, form controls, neutral checkbox accents and route headings were made consistent. Navigation/content entrance uses 180ms, context reveal 170ms and hover/press states 160–170ms. Only route-level content animates, so ordinary queue polling does not animate the whole page. Reduced-motion preferences disable those effects. Screenshot review caught and corrected a sibling-panel margin rule that staggered cards and editor columns.

The production-data and conversation-mutation acceptance tests are separate from these read-only UI checks. No model was invoked and no canonical project or media file was changed by this finishing pass.
