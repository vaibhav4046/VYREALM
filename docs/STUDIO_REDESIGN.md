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
