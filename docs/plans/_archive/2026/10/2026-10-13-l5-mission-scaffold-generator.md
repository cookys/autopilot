# Plan — `scaffold-mission.js`: generate the /l5 mission scaffold instead of hand-authoring it
> Status: ✅ Merged to develop as 46ee16a6 — ships with 3.0.0. (Was: R0 2026-10-13.) BACKLOG row: "/l5 has no generator for the mission scaffold".

## 1. Problem
Before `mission prepare` a managed /l5 deliverable needs five artifacts that depth-0 writes by hand
(`skills/l5/references/hetero-impl-loop.md`, "Depth-0 recipe", steps 1-5). The gate runs of 2026-10-05
and the P7 gate of 2026-10-09 burned grant attempts on mechanical mistakes: a pipe in a verify command,
a session id stripped by `env -u`, a repo-bound task-authority envelope hand-built or missing.
Every one of those is a rule an existing validator already knows; nothing generates a file that satisfies them.

## 2. Inventory: what is hand-authored today, and what checks it
| Artifact | Today | Validator / consumer |
|---|---|---|
| Plan `docs/plans/<stem>.md` | prose, depth-0 | `mission-execution-graph-check.js` (`spec_plan_unregistered`), `validateGraphSpecsAtBase` (spec path + heading exist at base) |
| Rubric `<stem>.rubric.md` | `plan-rubric-scaffold.js` already generates it from plan §2 KRs, §2.5, §6 | rubric ids parsed by `loadSourceCoverageManifest` |
| Sources manifest `docs/mission-<slug>-sources.json` | hand: both sha256, repo-relative to the manifest dir | `loadSourceCoverageManifest` (closed key set, digest drift, unique targets) |
| Execution graph `docs/mission-<slug>-execution-graph.json` | hand: content-bound `plan-<sha>` / `R<decimal>` ids, reservation, campaign paths | `freezeMissionExecutionGraph` (`src/engine/mission-execution-graph.js`), coverage check, `--mirror-roots` check, `validBoundedVerifyCommand` at campaign intake |
| Task-authority envelope | hand-assembled `freezeTaskAuthorityEnvelope` input | `mission prepare` (`MISSION_AUTHORITY_BINDING_MISMATCH`) |
| `.claude/mission-routing-config.json` + `mission-terminal-reconcile.js legacy` | hand | admission (`exact legacy B/C terminal disposition is invalid`) |

Only the rubric has a generator. The rest has validators but no producer.

## 3. Design
New `scripts/scaffold-mission.js` (Node, built-ins plus the repo's own `src/` modules, the same ones the
validators use, so output and validator cannot drift).

Inputs (flags):
- `--plan <repo-relative .md>` (required, must exist; its `<stem>` is the default slug), `--slug`, `--node-id`
- `--output-path <p>` (repeatable, required), `--create <p>` (repeatable; becomes `authorized_creates` and is excluded from `required_paths`)
- `--required-path <p>` (repeatable; plan, rubric and every non-created output are added automatically)
- `--verify-cmd <cmd>` (repeatable, required)
- `--allowed-prefix <p>` (repeatable; default: the distinct first path segment of the outputs and required inputs, so the plan and rubric add `docs`; mirror paths use the mirror root `platforms/codex/plugin`)
- `--required-change-path <p>` (repeatable, optional), `--spec-section` (default `Deliverable contract`)
- `--acceptance-id <tok>` (repeatable; default `accept-R<n>` per rubric id), `--objective` (default: plan title)
- Budgets with the defaults used by every shipped graph: `--profile standard`, `--max-changed-files` (default outputs + 8),
  `--baseline-churn 1600`, `--max-repair-generations 2`, wall 3600 s, reservation 10800 s / 450 tool calls / 2 engine attempts
- `--rubric <file>` (default `<stem>.rubric.md`, generated through `plan-rubric-scaffold.js` when absent)
- `--governance` (default `.claude/owner-kernel-governance.json`), `--repo-root`, `--out-dir` (default `docs`)
- `--authority-out` (default `<git-common-dir>/autopilot-scaffold/<slug>-<graph digest first 12>-authority.json`, so it never dirties the tree and never gets committed)
- `--check` only validates, writes nothing; `--force` overwrites existing outputs (default: refuse)

Derivations (all computed, never typed):
1. Mirror closure: every output under a mirrored dir gets its `platforms/codex/plugin/<path>` counterpart added to `output_paths`, `required_paths` (when not created) and `authorized_creates` (when created), using `sync-codex-plugin-skills.sh --mirror-roots-json`.
2. Sources manifest: sha256 of plan and rubric; paths relative to the manifest dir.
3. Graph: plan id `plan-<sha>`, rubric ids through `loadSourceCoverageManifest`'s own content-bound ids (the exported function, not a copy); `graph_digest`, `calculated_*` through `freezeMissionExecutionGraph`.
4. Envelope: `freezeTaskAuthorityEnvelope` with `acceptance.contract_hash` = plan sha, `criteria_hash` = rubric sha, `missionAuthority.repoIdentity = git-common-dir:<realpath>`, `graphDigest`; `policy` from `resolveGovernancePolicy`. Caller-supplied authority fields are never set.

Pre-checks that fail BEFORE any file is written (the rules that cost attempts):
- each verify command passes `validBoundedVerifyCommand` (no pipe, quote, redirect, or `;`) and the joined projection is under 4096 chars
- plan exists, has the `--spec-section` heading, and has a registered `active` INDEX row (prints the paste-ready row when not)
- the plan is committed and clean at HEAD (otherwise `spec.path missing at base`); an uncommitted rubric, sources and graph are expected and only listed in `next_steps`
- every `required_paths` entry exists at HEAD unless it is in `--create` (the rubric is exempt: it is generated by this run or committed afterwards)

Self-validation after generation: runs `inspect()` from `mission-execution-graph-check.js` (with mirror roots and repo root) on the files just written; any failure restores overwritten files byte for byte, removes newly created ones, and exits 2 with the validator's message.

Outputs: the three repo files (rubric if generated, sources, graph) and the envelope outside the repo. stdout is one JSON object: `status`, paths, `plan_sha256`, `rubric_sha256`, `graph_digest`, and `next_steps` (including `mission_lineage_id`) (`commit`, `verify_at_base`, `routing_config`, `legacy_reconcile` = `mission-terminal-reconcile.js legacy --graph-digest <d>`, `prepare`, `grant`, `dispatch_env`).

Deliberately NOT done: the script does not edit `docs/projects/INDEX.md`, `.claude/mission-routing-config.json`, run the legacy reconcile, run `prepare`/`grant`, or run the `verification_commands` at base. Those mutate shared state or spend a grant; they stay a depth-0 decision and are listed in `next_steps`. The detached-checkout base run of the verify commands also stays manual (recipe step 3).

## 4. Verification
New `hooks/tests/scaffold-mission.test.sh`, in a temp git repo seeded with a plan, governance file and INDEX row:
1. Generated sources, graph and envelope pass `mission-execution-graph-check.js --mirror-roots` and `mission prepare` (real CLI, against the temp repo) with no hand edit.
2. Mirror closure: a `scripts/x.sh` output produces the codex mirror entries; omitting `--mirror` handling would make the checker fail (mutation: strip the mirror step, expect red).
3. Pre-checks: a verify command with `|`, an unregistered plan, a missing required path, an uncommitted plan each exit non-zero with the named reason and write nothing.
4. Determinism: two runs produce byte-identical graph and sources; changing one plan byte changes `plan_sha256`, `graph_digest` and the envelope's lineage binding.
5. Refuses to overwrite without `--force`.

## 5. Options considered (no owner decision required)
- Extend `plan-rubric-scaffold.js` vs new script: new script; the rubric tool has a stable contract and a test, and the new one only calls it.
- Auto-edit routing config and INDEX: rejected; shared-state mutation belongs to depth-0 and the checker already prints the exact row.
- Envelope location: outside the repo by default, because it is repo-identity-bound and a tracked copy would dirty the tree the contract checker refuses.
- No new schema, no changed requirement text, no behavior change in any existing script: this is a producer for existing contracts. Wiring: CLAUDE.md inventory list, `docs/scripts-inventory.md`, the recipe in `skills/l5/references/hetero-impl-loop.md` (one pointer line per step), plus the codex mirror via `sync-codex-plugin-skills.sh`.

## 6. Out of scope
Plan authoring, the plan hetero loop (step 5b), session-mode marker, brief, dispatch, the `status task` can_merge gap (separate BACKLOG row), and multi-node graphs (v1 generates one node; a second node is hand-added).
