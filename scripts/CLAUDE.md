# scripts/ - directory rules (Claude Code)

Loaded when a session reads or edits a file under `scripts/`. Root `CLAUDE.md` keeps the one-line versions of the rules below that cause damage when missed; this file holds the full text and the name list that `scripts/check-claude-md-inventory.js` checks (every shipped script must be named here).

## Scripts inventory (prefer over LLM judgment)

`scripts/` ships deterministic tooling that the skills reference instead of asking the LLM to do mechanical work each run. **Before hand-coding any mechanical step, check whether a script already covers it.**

What each one does — purpose, when to call it, pointer to its contract — lives in [`docs/scripts-inventory.md`](../docs/scripts-inventory.md). That file is the canonical index; the grouped names below exist so a session knows what to go looking for without loading 30 KB of descriptions at every startup. Most answer `<script> --help` — but 37 do not parse argv at all, and a few of those are installers that act immediately, so `--help` runs them. Check the header comment first when a script is unfamiliar. JSON emitters have stable schemas with exit codes documented in their own header.

A caution learned the hard way (2026-08-06): several of these were fully built, tested and documented, yet doing nothing — an age threshold left at `0`, a hook never installed, a scanner keyed on an id the residue did not carry. **A script existing is not evidence it is running.** When one is supposed to be protecting something, check that it actually fires. It is one of a family — a module with zero callers, a suite that passes when you delete the gate it tests, a shadow derived from the answer it checks, an assertion pinned to one machine, a green test writing fixture rows into the real store. Each incident and its preventing artifact: [`references/evidence-discipline.md`](../references/evidence-discipline.md). Read it before recording anything as verified.

**Rule — negative control**: any new or modified check (gate, hook, scan, admission check) must ship with a negative control, a deliberately broken case that must be blocked and is shown red before green ([evidence-discipline §58](../references/evidence-discipline.md)).

**Dispatch rails** — `dispatch-hetero.sh` `dispatch-review.sh` `dispatch-author.sh` `dispatch-author-kimi.js` `dispatch-consult.sh` `dispatch-discuss.js` `dispatch-explore.sh` `dispatch-foreman.sh` `dispatch-batch.sh` `dispatch-anthropic-review.js` `dispatch-local-openai.js` `dispatch-plan-review.js` `dispatch-contract.js` `dispatch-status.js` `dispatch-tree.js` `check-context-window.js` `lib/context-window.sh` `lib/dispatch-author-codex-transport.sh` `lib/dispatch-detach.sh` `lib/cleanroom-launch.sh` `lib/main-checkout-boundary.sh` `wait-dispatch-results.js` `lib/output-quiescence.sh` `lib/pi-rpc-run.js` `lib/grok-effort.sh` `lib/cursor-model.sh` `lib/agy-model-alias.sh` `lib/agy-stream-json.js` `lib/plan-review-findings.js` `lib/plan-review-normalize.js` `lib/plan-review-timeout.js`
`lib/endpoint-probe.js` `lib/endpoint-probe.sh` `lib/worker-containment.sh` `lib/idle-watch.sh` `lib/plan-review-panel.js` `lib/plan-review-context.js` `lib/review-fanout.js` `lib/repo-identity.sh` `lib/dispatch-branch-ledger.sh` `lib/gitconfig-containment.sh` `lib/seed-claude-config.js` `lib/codeforge-collect.sh`

**Routing & config resolution** — `lib/dispatch-usage.js` `lib/account-alias.js` `resolve-dispatch.sh` `resolve-dispatch-topology.js` `resolve-doa.sh` `resolve-endpoint.sh` `resolve-knowledge-routing.sh` `resolve-project-paths.sh` `resolve-qc-gate.sh` `resolve-review-loop.sh` `resolve-worktree-teardown.sh` `resolve-execution-profile.js` `resolve-scaffold-tier.js` `lib/scaffold-envelope.sh` `lib/resolve-config.sh` `lib/config-audit.js` `lib/autocompact-window.js` `lib/runtime-paths.js` `load-endpoints-env.sh` `lib/load-endpoints-env.js` `claude-account.js` `quota-reporter.js` `quota-provider-sync.js` `quota-mirror-tick.js` `lane-reopen.js`
`lib/local-sandbox-endpoints.json` `lib/local-sandbox-endpoint.sh` `lib/local-sandbox-parent.js`

**Worktree & branch lifecycle** — `reap-dispatch-branches.sh` `reap-dispatch-worktrees.sh` `accept-dev-channel-prompt.sh` `reap-scratch-checkouts.js` `scratch-closeout.sh` `repo-residue-sweep.js` `prune-plugin-cache.js` `resolve-repo-placement.js` `pin-evidence-anchors.js` `lifecycle-residue-receipt.js` `write-task-status-input.js` `record-integration.js` `check-inputs-landed.js` `check-containment.js` `lib/worktree-reap.sh` `lib/worktree-intent.sh` `lib/prune-tmp-residue.sh` `lib/worktree-activity.js` `lib/tmp-residue.js` `lib/tmp-residue-registry.json` `register-external-run.js`

**Mission, campaign & session state** — `check-blueprint-conformance.js` `decision-ledger.js` `open-decision.js` `decision-claim.js` `fleet-card-mirror.js` `lib/card-notice.js` `probe-unknown.js` `build-rehydration-bundle.js` `check-stall-fuse.js` `next-pick.js`
`mission-routing-admission.js` `mission-execution-graph-check.js` `scaffold-mission.js` `mission-terminal-reconcile.js` `mission-convergence-check.js` `next-touch-validation.js` `validate-next-touch-reservation.js` `validate-next-touch-terminal.js` `session-mode.js` `session-ctx-report.js` `noncq.js` `noncq.test.js` `lib/noncq-pools.json` `stage-advance.js` `run-approval.js` `compaction-rehydrate.js` `run-ledger.sh` `watch-foreman.js` `agent-liveness-check.js` `implementation-campaign-check.js` `check-plan-authority-ownership.js` `check-repair-scope.js` `stage-graph.js` `lib/stage-write.js` `task-card.js`

**Engine capability & qualification** — `engine-scorecard.js` `engine-capability-state.js` `engine-qualify.sh` `engine-qualify.js` `qualification-case-broker.js` `qualification-review-provider.js` `lib/qualification-panel-schema.json` `lib/qualification-mode-schemas.json` `lib/agy-containment.js` `probe-engine-capability.sh` `probe-local-engine.js` `probe-harness-capabilities.sh` `probe-todo-tools-pin.js` `probe-codex-enforcement.js` `probe-codex-postcompact-production.js`
`probe-skill-frontmatter-portability.sh` `platform-capability-claims.js` `bench-engine-capability.sh` `import-aa-capabilities.js` `evaluate-profile-cutover.js` `build-qualification-defaults.js` `adopt-qualification-defaults.js` `lib/qualification-feed.js` `qualification-sweep.sh` `lib/qualification-asset-seals.js` `lib/qualification-applicability-scope.js` `qualification-metrics.js` `lib/qualification-metrics.js` `qualification-feed-trust.js` `lib/qualification-confirm.js` `qualification-prices.js` `lib/qualification-prices.js` `qualification-send-queue.js` `lib/qualification-record-v2.js` `lib/qualification-usage.js` `lib/qualification-effort-label.js` `lib/qualify-stage-credentials.sh`
**Engine capability & qualification (cont.)** — `lib/vision-guard.js` `lib/engine-vision.json`

**Execution profiles** — `build-profile-payload.js` `profile-session.js` `check-profile-isolation.js` `measure-profile-context.js`

**Diff scanning & anti-gaming** — `completeness-scan.sh` `error-path-scan.sh` `secret-scan-diff.js` `check-redispatch-prompt.sh` `check-dispatch-suppression.sh` `check-backlog-entries.js` `lib/backlog-rules.js` `lib/record-files.js` `migrate-backlog-entries.js` `diff-file-list.sh` `diff-scope-report.sh` `diff-since-last-round.sh` `probe-diff-domain.sh` `classify-diff-risk.sh` `check-disjointness.sh` `check-hands-commit.js` `check-test-integrity.sh` `replay-test-integrity.js` `scan-fixture-literals.js` `check-blind-evidence.sh` `lib/test-integrity-l1.py` `check-test-outcome.js` `leak-guard.js` `redact-personal.js` `lib/personal-data-patterns.js` `lib/personal-data-redact.js` `lib/leak-guard-hosts.json`

**Verification & review synthesis** — `dispatch-experience-critic.sh` `verify-preexisting.sh` `verify-red-green.sh` `verify-strength.js` `gate-verify.js` `per-turn-gate-arm.js` `adjudicate-findings.js` `probe-mutation.js` `review-mvp-portfolio.js` `review-seat-report.js` `qc-panel.js` `qc-evidence-status.js` `lib/qc-evidence.sh` `render-review-page.js` `qc-metric-emit.js` `calibration.sh` `ladder-run.sh` `check-node-report.js` `check-loop-convergence.js` `check-foreman-polling.js` `check-escalation-coverage.js` `rubric-freeze.js` `admit-backlog-follow-ups.js` `check-holdout-coverage.sh` `affected-suites.js` `plan-rubric-scaffold.js` `hetero-review-loop.js` `check-phase-review-receipt.js` `measure-streamjson-equivalence.js` `lib/review-chain-derive.js` `lib/review-packets.js`
`lib/exclude-allowlist.js` `lib/seat-id-guard.js` `lib/raw-log-path.js` `review-ledger-archive.js` `lib/review-ledger-copy.js` `lib/review-ledger-tar.js`

**Verification & review synthesis (cont.)** — `review-jury.js`

**Task tree & risk** — `tree.js` `risk-counter.js` `hook-harness-matrix.js` `lib/chain-command.js`

**Sync, drift & release gates** — `sync-all.sh` `sync-version.js` `sync-agent-bodies.sh` `sync-model-routing.sh` `sync-codex-plugin-skills.sh` `sync-opencode-plugin.sh` `check-canonical-invariants.sh` `check-settings-changelog.js` `check-reference-sizes.js` `check-supersession-anchors.js` `check-claude-md-inventory.js` `check-tmp-residue-registry.js` `check-config-docs.js` `config-keys.json` `check-guidance-eval.js` `check-contract-schema.js` `check-hook-inventory.js` `check-js-syntax.js` `check-optin-changelog.js` `check-readme-parity.js` `check-plan-graduation.js` `preflight-portability.sh` `preflight-release.sh` `report-roster-field-consumers.js` `validate.sh` `validate-json-schema.js` `doc-drift-gate.js` `test-doc-drift-gate.sh` `check-stage-vocab.js` `layout-lint.js`

**Sync, drift & release gates (cont.)** — `check-fixed-times.js`

**Sync, drift & release gates (cont.)** — `check-quota-adapters.js` `check-events-contract.js` `check-claude-spawn-sites.js` `lib/claude-spawn-sites.json`

**Setup & install** — `dev-setup.sh` `dev-update.sh` `accounts-onboard.sh` `profile-health.js` `profile-link.js` `lane-switch.js` `login-checklist.js` `install-hooks.sh` `install-antigravity.sh` `install-opencode.sh` `install-token-discipline.js` `install-quota-mirror.js` `setup-symlinks.sh` `setup-symlinks.ps1` `install-antigravity.ps1` `agy-shell-guard.zsh` `project-detect.js` `scaffold-config.js` `statusline-live-tee.js` `lib/opencode-discovery-probe.js` `lib/test-git-env.js` `lib/test-git-env.sh` `lib/test-gitconfig` `lib/runner-fallback-bin.sh`

**Skills tooling, evals & measurement** — `cost-digest.js` `benchmark-hook-latency.js` `status-events-bench.js` `distill-scan.js` `identifier-scan.js` `distill-consolidate.sh` `distill-sync-setup.sh` `retro-review-loop.js` `lib/retro-loop-metrics.js` `lib/transcript-attribution.js` `measure-task-width.sh` `task-width-fleet.sh` `task-width-ingest.py` `run-eval-batch.sh` `run-skill-opt.sh` `toggle-payload-capture.js` `benchmark-hook-multiplexer.js` `validate-hook-multiplexer-benchmark.js` `run-grok-implementer-ab.sh` `validate-grok-implementer-ab.js` `test-grok-effort.sh` `roundtable-window.js` `permission-prompt-watch.js` `lib/permission-prompt-detect.js`

**Shared JSON & store primitives** — `lib/json-emit.sh` `lib/brain-spend.js` `lib/residue-config.js` `lib/run-ledger-config.js` `lib/effort-scale.js` `lib/jsonl-store.js` `lib/extract-json-object.js` `lib/runner-binary.js` `lib/auth-stop.js` `lib/auth-stop.sh` `lib/claude-call-capture.js` `lib/claude-call-capture.sh` `lib/claude-call-capture-exec.sh` `lib/headless-seat-derive.js` `lib/grok-effort.js` `lib/live-state-dir.js` `lib/config-path.js` `lib/load-source.js` `lib/json-fields.sh` `lib/kimi-containment.js` `lib/opencode-containment.js` `lib/test-identity.sh` `lib/semver.js` `lib/bash-wait-rules.js` `lib/sealed-docs.js` `lib/workflow-snapshot.js` `lib/compaction-handoff.js` `lib/bash-launch-rules.js` `lib/engine-spelling.js` `lib/room-log.js` `lib/qualification-trust.js`

**Review family gate** — `lib/review-family-gate.js` `lib/qc-panel-codex-fallback.js` (cross-family rule and codex quota runtime seat substitute helper shared by `hetero-review-loop.js`, `check-phase-review-receipt.js`, and `src/engine/autopilot-engine.js`)

**Shared JSON & store primitives (cont.)** — `lib/claude-stream-envelope.js` `lib/account-observation.js` `lib/repo-layout.js` `lib/seat-model-id.js` `lib/roster-overlay.js` `lib/fleet-decision.js` `lib/decide-line.js` `lib/agy-timeout.sh` `lib/events-fixture.js` `lib/account-registry.js` `lib/account-quota.js` `lib/account-cooldown.js` `lib/account-pick.js` `lib/account-interpret.js` `lib/account-capture.js` `lib/account-probe.js` `lib/account-audit.js` `lib/account-env.js` `lib/account-fixtures/claude-shim.js` `lib/account-fixtures/shim-install.js` `lib/account-fixtures/os-lock-holder.js` `lib/account-rail.js` `lib/account-state.sh` `lib/role-kit.js` `lib/role-kit-kimi.js` `lib/role-kit.sh` `lib/eval-account.sh` `lib/eval-account.js` `lib/fixtures/gen-account-pick-g37-golden.js`

**Shared JSON & store primitives (cont.)** — `lib/hippo.js`, `project-record.js` `lib/lane-manifest.js` `lib/switch-journal.js`

**Test helpers** — `lib/test-reaper.js`


## When adding a new script

If you replace an LLM-judgment step with a script, **wire it in**:
1. The reference doc (`skills/quality-pipeline/references/*.md` or equivalent) — describe what the script does and when to call it.
2. The relevant `SKILL.md` — add a row to its "Available Scripts" table (if it has one) or reference inline.
3. [`docs/scripts-inventory.md`](../docs/scripts-inventory.md) — one row: what it does, when to call it, pointer to its contract.
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

## Hooks testing (moved from AGENTS.md)

- **Hooks runtime smoke test**: `CLAUDE_PLUGIN_ROOT=$(pwd) node hooks/intent-capture.js < /dev/null` should write to `~/.autopilot/intent/` without throwing.
