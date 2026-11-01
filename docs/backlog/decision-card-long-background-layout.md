# live pane decision card: long background and options are hard to read (BL-0369)

Owner report (2026-11-01): "I find this very hard to read."

Decision cards opened by other projects with `scripts/open-decision.js` are shown by the live pane (`mods/live/`). The background field (`decide.k_background`, data from `mods/live/model.ts`) is one long string and the pane only hard-wraps it. Numbered points, context and file paths run together, and all options sit on one line.

## Constraints

- UI change: build before/after screenshots first and let the owner choose (plan A light, plan B structured).
- Follow `docs/plans/2026-10-13-live-pane-design-system.md` section 12: one colour one meaning, bold whitelist, colours only through PALETTE in `mods/live/ui.ts`.
- Fix in the renderer; do not require the card author to change how they write.

## Trigger

The owner picks a layout from the screenshots.
