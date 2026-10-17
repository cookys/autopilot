# D0 re-run 2026-10-18: row d2, kimi cell (BL-0176)

One real run of `scripts/dispatch-author.sh --runner kimi --model kimi-code/k3` (kimi 2.2.0) with the credential
staged into an isolated HOME (`scripts/lib/qualify-stage-credentials.sh`, write-back armed; the real
`~/.kimi-code` was not handed to the child). Recipe: `raw/d2-kimi/probe.sh`, prompt `raw/d2-kimi/prompt.txt`.

The launcher environment carried `CLAUDE_CODE_SESSION_ID=11111111-...`, `AUTOPILOT_SESSION_ID=outer-S`,
`AUTOPILOT_CHILD_SESSION_ID=22222222-...`, `AUTOPILOT_PARENT_RUN_ID=run-outer`, `AUTOPILOT_DISPATCH_DEPTH=1`,
`AUTOPILOT_ROOT_RUN_ID=root-outer`. The kimi child ran a shell tool and printed its own environment
(`raw/d2-kimi/kimi-env.txt`, same variable list and order as the codex cell):

| Variable seen by the kimi child | Value |
|---|---|
| CLAUDE_CODE_SESSION_ID | `<unset>` (differs from the parent id, so the rail scrubs it) |
| AUTOPILOT_CHILD_SESSION_ID | `<unset>` (3d: an inherited C never reaches a child) |
| AUTOPILOT_SESSION_ID | `<unset>` |
| AUTOPILOT_PARENT_SESSION_ID | `outer-S` (the parent id the rail resolved) |
| AUTOPILOT_PARENT_RUN_ID / DISPATCH_DEPTH / ROOT_RUN_ID | `run-outer` / `1` / `root-outer` |

The rail's own manifest (`raw/d2-kimi/author.manifest.json`): `session_id` = the launcher's id, `parent_run_id` =
`run-outer`, `root_run_id` = `root-outer`, `depth` 1, `child_session_id` null (a non-Claude harness mints no child id,
the post-3d rule for row d2). Verdict: **pass**. One kimi call; rc 0; status `authored`.

Not covered by this cell: the foreman rail (`dispatch-foreman.sh`) and kimi inside a hetero rail still run only against
stubs (`hooks/tests/dispatch-runner-session-id-scrub.test.sh` case 4).
