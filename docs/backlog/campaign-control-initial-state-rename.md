# BL-0255 — campaignControl.initial_state rename

The field `initial_state` appears in `src/campaign/cli.js` and under `src/engine/` (campaign-intake, repair-ladder, autopilot-engine) and in the codex mirror under `platforms/codex/plugin/`.

It is a persisted wire field, so a rename needs a migration or a clean MAJOR-style cut. The memory rule is no compatibility shims.

It was left out of the bluefix batch (merge `d0d87b1c4`) as a design decision.

Source: bluefix merge d0d87b1c4, owner d-15632582.
