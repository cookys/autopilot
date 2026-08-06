# autopilot — project conventions (Claude Code)

For Claude Code sessions working **on** the autopilot plugin itself. Skill-runtime conventions live in each skill's `SKILL.md`; this file covers cross-cutting things a session needs at entry.

For **non-Claude-Code** agents (OpenCode, Codex, Antigravity, …), see [`AGENTS.md`](AGENTS.md) for the agents.md-spec readme that applies to any agent. For cross-platform portability details (what each platform actually supports vs. what's unverified), see [`references/multi-agent-portability.md`](references/multi-agent-portability.md).

## What this repo is

Standalone lifecycle orchestration plugin: 28 skills, 3 methodology agents, 25 hooks (10 default-on,
15 opt-in). Optional integrations and coexistence rules: [`docs/coexistence.md`](docs/coexistence.md).

## Scripts inventory (prefer over LLM judgment)

`scripts/` ships deterministic tooling that the skills reference instead of asking the LLM to do mechanical work each run. **Before hand-coding any mechanical step, check whether a script already covers it.**

What each one does — purpose, when to call it, pointer to its contract — lives in [`docs/scripts-inventory.md`](docs/scripts-inventory.md). That file is the canonical index; the grouped names below exist so a session knows what to go looking for without loading 30 KB of descriptions at every startup. Every script also answers `<script> --help`, and JSON emitters have stable schemas with exit codes documented in their own header.

A caution learned the hard way (2026-08-06): several of these were fully built, tested and documented, yet doing nothing — an age threshold left at `0`, a hook never installed, a scanner keyed on an id the residue did not carry. **A script existing is not evidence it is running.** When one is supposed to be protecting something, check that it actually fires.

**Dispatch rails** — `dispatch-hetero.sh` `dispatch-review.sh` `dispatch-author.sh` `dispatch-explore.sh` `dispatch-batch.sh` `dispatch-anthropic-review.js` `dispatch-local-openai.js` `dispatch-plan-review.js` `dispatch-contract.js` `dispatch-status.js` `check-context-window.js` `lib/context-window.sh` `lib/dispatch-author-codex-transport.sh` `lib/dispatch-detach.sh` `lib/output-quiescence.sh` `lib/pi-rpc-run.js` `lib/grok-effort.sh` `lib/plan-review-findings.js` `lib/plan-review-normalize.js`

**Routing & config resolution** — `resolve-dispatch.sh` `resolve-doa.sh` `resolve-endpoint.sh` `resolve-qc-gate.sh` `resolve-review-loop.sh` `resolve-worktree-teardown.sh` `resolve-execution-profile.js` `lib/resolve-config.sh` `load-endpoints-env.sh` `lib/load-endpoints-env.js`

**Worktree & branch lifecycle** — `reap-dispatch-branches.sh` `reap-dispatch-worktrees.sh` `pin-evidence-anchors.js` `lifecycle-residue-receipt.js` `lib/worktree-reap.sh` `lib/prune-tmp-residue.sh`

**Mission, campaign & session state** — `mission-routing-admission.js` `mission-execution-graph-check.js` `mission-terminal-reconcile.js` `mission-convergence-check.js` `next-touch-validation.js` `validate-next-touch-reservation.js` `validate-next-touch-terminal.js` `session-mode.js` `compaction-rehydrate.js` `run-ledger.sh` `watch-foreman.js` `implementation-campaign-check.js` `check-plan-authority-ownership.js` `check-repair-scope.js`

**Engine capability & qualification** — `engine-scorecard.js` `engine-capability-state.js` `engine-qualify.sh` `engine-qualify.js` `qualification-case-broker.js` `probe-engine-capability.sh` `probe-local-engine.js` `probe-harness-capabilities.sh` `probe-codex-enforcement.js` `probe-codex-postcompact-production.js` `probe-skill-frontmatter-portability.sh` `platform-capability-claims.js` `bench-engine-capability.sh` `import-aa-capabilities.js` `evaluate-profile-cutover.js`

**Owner kernel & execution profiles** — `owner-kernel.js` `check-owner-kernel-release-gates.js` `build-profile-payload.js` `profile-session.js` `check-profile-isolation.js` `measure-profile-context.js`

**Diff scanning & anti-gaming** — `completeness-scan.sh` `error-path-scan.sh` `secret-scan-diff.js` `check-redispatch-prompt.sh` `check-dispatch-suppression.sh` `diff-file-list.sh` `diff-scope-report.sh` `diff-since-last-round.sh` `probe-diff-domain.sh` `classify-diff-risk.sh` `check-disjointness.sh` `check-test-integrity.sh` `lib/test-integrity-l1.py`

**Verification & review synthesis** — `verify-preexisting.sh` `verify-red-green.sh` `verify-strength.js` `adjudicate-findings.js` `probe-mutation.js` `review-mvp-portfolio.js` `qc-panel.js` `qc-metric-emit.js` `calibration.sh` `ladder-run.sh` `check-node-report.js` `check-loop-convergence.js` `check-escalation-coverage.js` `rubric-freeze.js` `admit-backlog-follow-ups.js`

**Task tree & risk** — `tree.js` `risk-counter.js`

**Sync, drift & release gates** — `sync-all.sh` `sync-version.js` `sync-agent-bodies.sh` `sync-model-routing.sh` `sync-codex-plugin-skills.sh` `sync-opencode-plugin.sh` `check-canonical-invariants.sh` `check-claude-md-inventory.js` `check-contract-schema.js` `check-hook-inventory.js` `check-l1-cache-key-parity.js` `check-optin-changelog.js` `check-readme-parity.js` `preflight-portability.sh` `preflight-release.sh` `report-roster-field-consumers.js` `validate.sh` `validate-json-schema.js` `doc-drift-gate.js` `test-doc-drift-gate.sh`

**Setup & install** — `dev-setup.sh` `dev-update.sh` `install-hooks.sh` `install-antigravity.sh` `install-opencode.sh` `setup-symlinks.sh` `setup-symlinks.ps1` `install-antigravity.ps1` `agy-shell-guard.zsh` `project-detect.js` `scaffold-config.js`

**Skills tooling, evals & measurement** — `distill-scan.js` `distill-consolidate.sh` `distill-sync-setup.sh` `retro-review-loop.js` `lib/retro-loop-metrics.js` `lib/transcript-attribution.js` `measure-task-width.sh` `task-width-fleet.sh` `task-width-ingest.py` `run-eval-batch.sh` `run-skill-opt.sh` `toggle-payload-capture.js` `benchmark-hook-multiplexer.js` `validate-hook-multiplexer-benchmark.js` `run-grok-implementer-ab.sh` `validate-grok-implementer-ab.js` `test-grok-effort.sh`

**Shared JSON & store primitives** — `lib/json-emit.sh` `lib/jsonl-store.js`


## When adding a new script

If you replace an LLM-judgment step with a script, **wire it in**:
1. The reference doc (`skills/quality-pipeline/references/*.md` or equivalent) — describe what the script does and when to call it.
2. The relevant `SKILL.md` — add a row to its "Available Scripts" table (if it has one) or reference inline.
3. [`docs/scripts-inventory.md`](docs/scripts-inventory.md) — one row: what it does, when to call it, pointer to its contract.
4. The grouped name list above — add the basename to whichever group it belongs to. `check-claude-md-inventory.js` enforces that every shipped script is named here, and that list is what a session actually reads at startup.

Without all four, the script is dead code: future sessions won't discover it. And discovery is not the whole job — a script that is wired in but switched off (see the caution in the inventory section) is dead code that looks alive.

**Row shape rule**: each row is an index entry (purpose, call condition, canonical pointer). Keep release history and incident detail in `CHANGELOG.md`, references, or script headers; `check-claude-md-inventory.js` enforces line and 40k-byte caps.

### Language choice (sh vs js vs py)

There is **no "everything must be JS" mandate** — the v2.25.3 `port-autopilot-to-node` ship was a *scoped* port of the 7 scripts on the **agy-sandbox runtime path** that used `jq`/`python3`, not a repo-wide migration. Pick per script:

| Script touches… | Use | Why |
|-----------------|-----|-----|
| JSON parsing/mutation, file-locking, panel synthesis, or **runs inside a dep-minimal sandbox** (agy `-p`, headless dispatch) | **Node (`.js`)**, built-ins only, Node ≥ 20.10 | agy/restricted sandboxes don't guarantee `jq`/`python3`; Node is first-class on all four target platforms. Removes the host-environment assumption. |
| Pure git-artifact glue (`git diff`/`grep`/`sed`), a dev/CI-time gate that **never runs in the agy sandbox** | **Bash (`.sh`)** is fine | Shell is the right tool for git-artifact work; porting it is churn with zero portability payoff. |
| A standalone always-on service never on any agent's runtime path (e.g. `task-width-ingest.py`) | whatever fits | Not sandbox-constrained; don't rewrite for uniformity's sake. |

Rule of thumb: **if it parses JSON or could run under agy, write it in Node; otherwise shell is fine.** When in doubt, prefer Node for anything new that returns structured output.

## Skill evolution rules

- **童子軍規則 (boy-scout)**: any touch of a skill trims it toward contract-card shape (trigger/inputs/decision-table/engine-pointers; judgment prose → references/). The north-star gate (prose↓ engine↑) watches per release.
- **成績單前置 (scorecard-first)**: rewriting or deleting any skill requires prior eval ON/OFF evidence (evals/orchestration harness); an unevidenced rewrite = unevidenced trust.

## Severity vocabulary

Unified across all skills and agents:

```
🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion
```

If you see "Important" anywhere in a severity context, that's a leftover from the old vocabulary — fix it. The dialectic skills (`think-tank`, `think-tank-dialectic`) use a separate **risk** tagging vocabulary (`critical / important / minor`, lowercase) which is intentionally distinct.

## Versioning (semver bump rule)

The version (canonical in `.claude-plugin/plugin.json`, mirrored by `scripts/sync-version.js`) follows a **user-facing-milestone** semver policy. The second digit advances ONLY for a new user-facing surface — not for every addition.

| Bump | When | Examples |
|------|------|----------|
| **MAJOR** (`X.0.0`) | Breaking / incompatible change to a surface consumers rely on | Removed or renamed skill; a skill `description:` change that shifts routing incompatibly; config-schema break; removed hook/script a consumer depends on |
| **MINOR** (`x.Y.0`) | A **new user-facing milestone**: a new **skill** or a new **agent** | New `skills/<name>/` skill; new `agents/<role>.md` methodology agent |
| **PATCH** (`x.y.Z`) | **Everything else that changes shipped code**: new **script**, new **hook**, new **reference doc**, a bug fix or hardening of existing behavior (**including fixes to release tooling like `sync-version.js`**), a regex/contract tweak | `check-dispatch-suppression.sh` (new script) → patch; re-enabling a hook → patch; a reviewer-prompt fix → patch |
| **(no bump)** | Changes touching **only docs or tests** — no shipped code behavior changes. Fold into the next release | Adding a `hooks/tests/*.test.sh`; a `docs/BACKLOG.md` / `docs/projects/` edit; a typo/wording fix in a doc |

Rationale: a new script/hook/reference is real work but it is **not** a new user-facing capability the way a skill or agent is — bundling those under PATCH keeps the second digit meaningful as a "new thing users invoke" counter. The PATCH-vs-no-bump line is **code vs not-code**: if the change alters the behavior of any shipped code, it's at least a PATCH; reserve no-bump for changes that touch only docs or tests. (Borderline: a commit that is mostly tests plus a trivial incidental code touch may ride as no-bump if the code touch isn't itself the point; when the code fix *is* the point, it's a PATCH.)

Mechanics: bump via `scripts/sync-version.js --version <V> --hook-count <N> --skill-count <M>` (opt-in/disabled counts are preserved from canonical when omitted). A version bump triggers the finish-flow L-5.5 release gate (`scripts/preflight-release.sh`: CHANGELOG entry + INDEX row + mirror parity).

## Coexistence with superpowers

Autopilot is standalone-capable. When `superpowers` is installed, orchestrators (`ceo-agent`, `finish-flow`, `quality-pipeline`, `think-tank*`, `dev-flow`) consult `.claude/dispatch-config.md` to decide which methodology / reviewer / parallel dispatcher to delegate to. Defaults in [`project-config-template/dispatch-config.md`](project-config-template/dispatch-config.md). Per-scenario UX in [`docs/coexistence.md`](docs/coexistence.md).

## Where context lives

| Topic | File |
|-------|------|
| Skill execution rules | `skills/<name>/SKILL.md` |
| Methodology agent prompts | `agents/{reviewer,debugger,planner}.md` |
| Engine CLI / orchestration layer | `bin/autopilot.js`, `src/engine/`, `src/runners/` |
| Cross-skill references | `references/{blind-dispatch,model-routing}.md` |
| Project tracking | `docs/projects/` (active + `_archive/`) |
| Backlog | `docs/BACKLOG.md` |
| Plans | `docs/plans/` |
| Release notes | `CHANGELOG.md` |
| Per-session gotchas | `~/.claude/projects/-home-cookys-projects-autopilot/memory/` |

## Reply preference

Inherit from `~/.claude/CLAUDE.md` (Traditional Chinese, terse decisions like `go`/`A`/`1` accepted). For docs and code, English unless content is user-facing localization.

## Don't

- Don't hardcode dispatch model/mode in skill files — use `scripts/resolve-dispatch.sh`.
- Don't write "manually check for TODO/FIXME" in a reference doc — call `scripts/completeness-scan.sh`.
- Don't enumerate forbidden phrases inline in code-review logic — call `scripts/check-redispatch-prompt.sh`.
- Don't introduce new severity vocabulary — use the unified 4-tier above.
- Don't add a second canonical statement of "what the reviewer reads" — code-review.md Invocation § is canonical; reviewer.md Workflow §1 references it.
- Don't append per-release notes to a Scripts-inventory row — `CHANGELOG.md` owns history; the row is an index entry (see Row shape rule).
- Don't claim cross-platform env vars or CLI subcommands without verifying — by official doc URL OR by running the real tool. Past lesson cuts both ways: `CODEX_PLUGIN_ROOT` / `AGY_PLUGIN_ROOT` / `GEMINI_PLUGIN_ROOT` env vars were fabricated and shipped to main; but the *correction* then over-corrected, labelling `agy plugin validate` + the root-`plugin.json` requirement as fabricated when installing real `agy` 1.0.1 proved both genuine. If you can't cite a URL or show a tool run, it's a Spike candidate, not a fact. See [`references/multi-agent-portability.md`](references/multi-agent-portability.md) "Corrected — previously mislabelled" §.
