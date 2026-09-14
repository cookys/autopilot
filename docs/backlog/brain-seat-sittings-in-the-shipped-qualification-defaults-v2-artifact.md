# Brain-seat sittings in the shipped qualification defaults (v2 artifact)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: a consuming repo asks to adopt an owner/brain seat without self-qualifying; or the Board schedules the fourth brain sitting and it PASSES (a passing sitting is the first brain row worth shipping as a default).
- **Context**: v2.34.36 ships official defaults for `implementer` / `reviewer` / `verification_author` — all scorecard rows. Brain-seat sittings are NOT scorecard rows: they are atomic `owner-brain-seat-v1` records in the capability store with their own semantics (forced `brain-seat` scope, no expiry, 3-strike revocation via `engine-capability-state.js brain-status`). Packaging them means a second record shape in the artifact + a second adoption path in `adopt-qualification-defaults.js`, and today all three recorded sittings FAILED (events 3/4/6), so there is nothing routing-useful to ship. Recorded as a deferral with a reason rather than forced into the v1 shape: `references/official-qualification-defaults.recipe.json` `excluded[]`.
- **Effort**: S(第二種 record shape + 採用路徑)。
- **Source**: v2.34.36 official-qualification-defaults ship;`references/qualification-defaults.md` § "What this does NOT do"。

