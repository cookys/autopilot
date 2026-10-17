# Autonomous next-pick never checks a row's Trigger

Source: session 2026-10-18.

`scripts/next-pick.js pick` ranks by class weight, then age (now real, from `Since`), then effort. It never asks whether the row's `Trigger` has fired. A row parked on purpose until a trigger is the oldest, so it ranks first. On 2026-10-18 the pick was BL-0071; measuring showed its trigger had not happened, and the round ended in a close proposal.

## Why it is not a script fix
All 70 rows carry a `Trigger` field, but it is free text, so a machine cannot decide whether it has fired. It needs a judgment step in the `/next` autonomous path. That is a guidance change: CLAUDE.md scorecard-first requires eval ON/OFF evidence before it ships.

## Related
`preferences.class_weights` file does not exist, so KR6 (owner habit outranks system signals) currently has no effect.

Effort S.
