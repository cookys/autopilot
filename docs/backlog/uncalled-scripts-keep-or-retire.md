# Scripts that appear uncalled: keep or retire

BL-0275. From the 2026-10-21 discoverability audit (audit-flow.md items 7–10, audit-engine.md items 9–12). A missing caller is not a reason to delete. Each note is what the file header says it is for, who calls it in that audit, and the audit's suggestion. Trigger-Type owner. Effort M.

## scripts/ladder-run.sh

Prevents a vacuous promotion: the acceptance-delegation ladder (T0 to T1 to T2) may move a task class up only when the measured QC escape rate stays under a threshold. The `audit` subcommand records a later-stage escape so an in-cycle pass is not counted as proof.

Callers in the audit: no skill, agent, AGENTS.md, reference, src, hook, bin or script hit except itself, its test, `scripts/tmp-residue-allowlist.json`, `docs/ladder-run.md` and the inventory. The header names an external consumer (fuchikoma `docs/ladder/state.json`, llm-playground `qc_metric.py`).

Suggestion: if it is only for that external project, move it off the verification list to opt-in / external and say so in the header. If it is unused, retire it. Do not retire it only because this repo has no caller.

## scripts/qc-metric-emit.js

Saves the QC escape-rate measurement. Header: the depth-0 QC panel run and the publish hetero-review run can append one event to the llm-playground JSONL store. No store configured is a no-op. It never gates a verdict.

Callers in the audit: inventory and the header name the depth-0 QC panel, but `scripts/qc-panel.js` has no metric hit. The only caller found is `scripts/ladder-run.sh`.

Suggestion: wire the QC panel if the measurement is still wanted, or change the inventory and the header to say only ladder-run emits. An empty store makes the ladder's promotion gate vacuous.

## scripts/check-escalation-coverage.js

Checks that an escalation ledger (`docs/projects/<proj>/tree/events.jsonl`) covers five exit points: playbook_no_match, adjudication_unvalidatable, panel_irreversible_disagreement, plan_revision_trip, depth0_override. `--gate` can fail the run.

Callers in the audit: only `hooks/tests/check-escalation-coverage.test.sh`. `skills/retro/SKILL.md` and `skills/distill/SKILL.md` teach `tree.js escalations` and do not name this script.

Suggestion: if the quality-floor project is still live, name `--gate` next to the retro skill's escalations step. Otherwise retire it. Skipping it hides a missing exit point.

## scripts/validate-next-touch-reservation.js and scripts/validate-next-touch-terminal.js

Read-only authorization checks for the next-touch plan. Reservation is the pre-spend check (`--ledger`, `--pre-spend`). Terminal is the before-merge check (`--receipt`, `--base`, `--candidate`, and related flags). Both are thin CLIs over `scripts/next-touch-validation.js`.

Callers in the audit: no src, bin, hook, script, skill, agent or reference hit outside themselves and tests. The steps live in `docs/plans/2026-08-03-next-touch-debt-retirement.md`. The project tree is archived under `docs/projects/_archive/2026/08/2026-08-03-next-touch-debt-retirement/`. The plan file is still under `docs/plans/`.

Suggestion: if the plan has shipped, graduate it and take these two CLIs (and the shared library, or a note that it is archive-only) off the inventory. They occupy the list and read as if a mission ending must run them.

## scripts/qualification-metrics.js (the CLI)

Reads the registry's qualification-metrics.json, caches it, and reorders seats that are already admitted (fetch / status / order). Header: metrics order, they never admit. Fetch failure exits 0 with ok false.

Callers in the audit: `scripts/engine-qualify.js` and `scripts/qualification-send-queue.js` require `scripts/lib/qualification-metrics.js`, not this CLI. No skill, hook or script calls `fetch`, so who fills the cache is unknown.

Suggestion: if the qualification feed is supposed to call it, add that caller. If it is a human operation, say so in the inventory and the header. Do not delete it because the cache is empty.

## scripts/resolve-execution-profile.js

Builds or checks a role execution grant from an envelope and an input (`grant` / `verify`). Header: every successful result is explicitly unanchored. This CLI cannot write an Owner Kernel ledger, admit a role, grant host authority, or perform an effect.

Callers in the audit: after excluding CLAUDE.md and the inventory, only a sentence in `project-config-template/governance-config.md` and `hooks/tests/execution-profile.test.sh`. `resolveRoleExecutionGrant` itself is defined in `src/engine/execution-profile.js`.

Suggestion: if profile is still shadow and the owner knows that, mark the inventory "no runtime caller, owner runs it by hand". Otherwise add the caller.

## scripts/check-profile-isolation.js

Checks profile isolation in three forms: prose, runtime (rehashable no-effect probe artifacts; it never supplies an execution witness), and a caller-authored trace (adapter conformance only). Header: neither form qualifies an effectful transport.

Callers in the audit: CLAUDE.md, the inventory, old plan and evidence files, and `hooks/tests/profile-context-isolation.test.sh`. No skill, hook or release gate.

Suggestion: same as resolve-execution-profile.js.

## scripts/profile-session.js

prepare / measure / run / check. Header: prepare creates a workspace-bound, single-profile Claude `--bare` probe with no skills, hooks, tools or effects, and measure runs a paired input-token probe.

Callers in the audit: `skills/l4/SKILL.md`, `skills/l5/SKILL.md`, `skills/l6/SKILL.md` and `skills/dev-flow/references/card-relocated.md` state that the canonical profile-session.js lane only proves no-effect isolation. They do not say when or who runs it. No script, hook or src caller outside itself and tests.

Suggestion: same as the profile CLIs above, or point those four statements at the profile doc.
