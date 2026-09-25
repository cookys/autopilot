# Landing evidence — foreman-guard role-caps + reserve (v2.36.97)

Plan: `docs/plans/_archive/2026/09/2026-09-25-foreman-guard-role-caps-reserve.md`.

**Shape**: `brief.md` (P1–P5 build), `brief-land.md` (landing/self-review pass), `brief-close.md`
(this closeout pass); `REPORT-foreman.md` is the build-phase foreman's REPORT, `REPORT-land.md` the
landing pass's REPORT; `review-1-fix-then-ship.json` / `review-2-ship.json` are the two
`dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high` full-diff verdicts
against `origin/develop..HEAD`.

**P0/P1 probes**: the plan's P1 required a live check that a PreToolUse `additionalContext` reaches
the model without a `permissionDecision`, recorded under the P0 evidence dir. P1 ran that probe twice — once with the (buggy)
`permissionDecision:"allow"` alongside `additionalContext`, once with `additionalContext` alone
(`docs/plans/evidence/2026-09-25-foreman-guard-roles/p1-probe/` and `p1-probe-nodecision/`, referenced
from CHANGELOG.md) — confirming the subagent sees the text either way, so dropping the field costs
nothing and closes the bypass below.

**Key lesson — the allow-bypass finding**: `review-1-fix-then-ship.json` caught `emitAllowContext()`
emitting `permissionDecision:"allow"` alongside `additionalContext`. In Claude Code a PreToolUse
`"allow"` bypasses the normal permission flow for that call, so every advisory (warn-mode breach,
ambiguous-rows diagnostic, reserve-entry directive, every-40th no-marker nudge) was auto-approving
whatever Bash command rode on it — including one it was supposed to merely warn about. Fix: drop
`permissionDecision` from `emitAllowContext()` entirely; an advisory hook must never emit
`permissionDecision:"allow"` — only a real `deny` sets that field, everything else falls through to
the normal permission prompt. `review-2-ship.json` re-reviewed the fixed diff and confirmed no
`permissionDecision` is emitted on any allow/advisory path.

**Gate results**: `review-1-fix-then-ship.json` verdict `FIX-THEN-SHIP` (1 🟠 allow-bypass MUST-FIX +
1 🟡 TMPDIR-test-env MUST-FIX, both fixed; rest CUT/FOLLOW-UP). `review-2-ship.json` verdict
`SHIP-AS-IS`, all findings 🔵 CUT/FOLLOW-UP (including the `hooks/README.md` "depth-0 and plain
sessions are untouched" wording, fixed in this closeout pass). `hooks/tests/run.sh --parallel 8`:
953 `foreman-guard-roles` + 114 `foreman-guard` assertions green; 2 pre-existing reds unrelated to this
diff (`engine-qualify-verdict-stability` D6, `migrate-backlog-entries`), same on `origin/develop`
baseline. `check-js-syntax` / `sync-codex-plugin-skills --check` / `validate.sh` /
`check-hook-inventory` green; `doc-drift-gate` at the known 3 baseline FAILs (links/fences/script-refs),
no new FAIL.

**Plan-review chair swap**: the generation-1 plan-review session id
(`pr-gen1-chairswap-2026-09-25-ee9eb17b`, in `docs/plans/2026-09-25-foreman-guard-role-caps-reserve.g1-artifact.json`)
records the chair seat as `fable_chair` / `claude-fable-5-1` for that one run — the plan-review chair
was swapped from codex to fable because codex quota was exhausted at the time.
