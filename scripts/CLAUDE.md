# scripts/ - directory rules (Claude Code)

Loaded when a session reads or edits a file under `scripts/`. Root `CLAUDE.md` keeps the one-line versions of the rules below that cause damage when missed; this file holds the full text and the name list that `scripts/check-claude-md-inventory.js` checks (every shipped script must be named here).

## Scripts inventory (prefer over LLM judgment)

`scripts/` ships deterministic tooling that the skills reference instead of asking the LLM to do mechanical work each run. **Before hand-coding any mechanical step, check whether a script already covers it.**

What each one does — purpose, when to call it, pointer to its contract — lives in [`docs/scripts-inventory.md`](../docs/scripts-inventory.md). That file is the canonical index; the grouped names below exist so a session knows what to go looking for without loading 30 KB of descriptions at every startup. Most answer `<script> --help` — but 37 do not parse argv at all, and a few of those are installers that act immediately, so `--help` runs them. Check the header comment first when a script is unfamiliar. JSON emitters have stable schemas with exit codes documented in their own header.

A caution learned the hard way (2026-08-06): several of these were fully built, tested and documented, yet doing nothing — an age threshold left at `0`, a hook never installed, a scanner keyed on an id the residue did not carry. **A script existing is not evidence it is running.** When one is supposed to be protecting something, check that it actually fires. It is one of a family — a module with zero callers, a suite that passes when you delete the gate it tests, a shadow derived from the answer it checks, an assertion pinned to one machine, a green test writing fixture rows into the real store. Each incident and its preventing artifact: [`references/evidence-discipline.md`](../references/evidence-discipline.md). Read it before recording anything as verified.

**Rule — negative control**: any new or modified check (gate, hook, scan, admission check) must ship with a negative control, a deliberately broken case that must be blocked and is shown red before green ([evidence-discipline §58](../references/evidence-discipline.md)).

**Dispatch rails** — `lib/dispatch-strike.js` `dispatch-hetero.sh` `dispatch-research.sh` `mechanical-reroute-report.js` `rc-alarm.js` `rc-alarm.test.js` `dispatch-review.sh` `dispatch-author.sh` `dispatch-author-kimi.js` `dispatch-consult.sh` `dispatch-discuss.js` `dispatch-explore.sh` `dispatch-foreman.sh` `dispatch-batch.sh` `dispatch-anthropic-review.js` `dispatch-vision-review.js` `dispatch-vision-review.test.js` `dispatch-local-openai.js` `dispatch-plan-review.js` `lib/repair-recheck.js`
`lib/shed-route.js` `lib/gateway-fill.js` `lib/gateway-fill.test.js` `gateway-fill-dry-run.js` `gateway-fill-dry-run.test.js` `dispatch-contract.js` `dispatch-status.js` `local-impl-report.js` `local-impl-report.test.js` `dispatch-round-table.js` `dispatch-usage-report.js` `dispatch-usage-report.test.js` `dispatch-usage-push.sh` `dispatch-tree.js` `check-context-window.js` `lib/context-window.sh` `lib/dispatch-author-codex-transport.sh` `lib/dispatch-detach.sh` `lib/cleanroom-launch.sh` `lib/main-checkout-boundary.sh` `wait-dispatch-results.js` `lib/output-quiescence.sh` `lib/pi-rpc-run.js` `lib/grok-effort.sh` `lib/cursor-model.sh` `lib/cursor-broker-client.js` `lib/cursor-broker-run.js`
`lib/cursor-quota-observe.js`
`dispatch-hetero.sh` may run target pre-commit after capture in a disposable worktree (`target_precommit`, `target_precommit_timeout_s`).
Shared Cursor/Kimi broker transport and clone rail use the cursor-named helpers; Kimi observer is listed under Review family gate.
`lib/agy-model-alias.sh` `lib/agy-stream-json.js` `lib/plan-review-findings.js` `lib/plan-review-normalize.js` `lib/plan-review-timeout.js`
`lib/endpoint-probe.js` `lib/endpoint-probe.sh` `lib/worker-containment.sh` `lib/idle-watch.sh` `lib/idle-watch.js` `lib/plan-review-panel.js` `lib/ask-group-key.js` `lib/plan-review-context.js` `lib/review-fanout.js` `lib/repo-identity.sh` `lib/dispatch-branch-ledger.sh` `lib/gitconfig-containment.sh` `lib/seed-claude-config.js` `lib/codeforge-collect.sh` `lib/fleet-task-header.js` `lib/fleet-task-ref.js` `lib/fleet-task-ref.test.js` `lib/hetero-run-registry.js` `lib/hetero-run-registry.test.js` `lib/event-attribution.js` `lib/agent-event-emit.sh` `lib/agent-event-emit.js` `lib/dispatch-lane.sh` `dispatch-panel.js` `hetero-panel.sh` `hetero-panel.test.sh` `bg-quiet.sh` `bg-quiet.test.sh` `lane-ops.sh` `dispatch-from-scratch.sh` `dispatch-from-scratch.test.sh`

**Routing & config resolution** — `lib/dispatch-usage.js` `lib/account-alias.js` `resolve-dispatch.sh` `resolve-dispatch-topology.js` `topology-prune.js` `lib/topology-runners.js` `lib/retired-runners.json` `resolve-doa.sh` `resolve-endpoint.sh` `resolve-knowledge-routing.sh` `resolve-project-paths.sh` `resolve-qc-gate.sh` `resolve-review-loop.sh` `resolve-worktree-teardown.sh` `resolve-execution-profile.js` `resolve-scaffold-tier.js` `lib/scaffold-envelope.sh` `lib/resolve-config.sh` `lib/config-audit.js` `lib/config-audit-seat.test.js` `lib/autocompact-window.js` `lib/runtime-paths.js` `load-endpoints-env.sh` `lib/load-endpoints-env.js` `claude-account.js` `quota-reporter.js` `quota-provider-sync.js` `quota-mirror-tick.js` `lane-reopen.js`
`lib/local-sandbox-endpoints.json` `lib/local-sandbox-endpoint.sh` `lib/local-sandbox-parent.js` `pace-select.js` `pace-select.test.js` `lib/pace-reading.js` `lib/pace-roles.json` `lib/broker-run-pace.js`

**Routing & config resolution (cont.)** — `align-autocompact.js` `align-autocompact.test.js` `quota-wait-check.js` `quota-wait-sweep.js` `quota-wait-guard.test.js`

**Worktree & branch lifecycle** — `reap-dispatch-branches.sh` `reap-dispatch-worktrees.sh` `reap-build-artifacts.js` `lib/build-artifacts.js` `lib/disk-guard.js` `accept-dev-channel-prompt.sh` `reap-scratch-checkouts.js` `scratch-closeout.sh` `repo-residue-sweep.js` `prune-plugin-cache.js` `resolve-repo-placement.js` `pin-evidence-anchors.js` `lifecycle-residue-receipt.js` `write-task-status-input.js` `record-integration.js` `check-inputs-landed.js` `check-containment.js` `land-branch.js` `lib/worktree-reap.sh` `lib/worktree-intent.sh` `lib/prune-tmp-residue.sh` `lib/worktree-activity.js` `lib/tmp-residue.js` `lib/tmp-residue-registry.json` `register-external-run.js`
`prune-merged-branch.js` `count-merged-remote-branches.js` `finish-hygiene-check.sh` `lib/worktree-removal-log.js`

**Mission, campaign & session state** — `check-blueprint-conformance.js` `decision-ledger.js` `open-decision.js` `list-lane-cards.js` `lib/operator-step-check.js` `decision-claim.js` `card-exception-grant.js` `fleet-card-mirror.js` `lib/card-notice.js` `probe-unknown.js` `build-rehydration-bundle.js` `check-stall-fuse.js` `next-pick.js`

**Session efficiency** — `wasted-turns-report.js` `lib/wasted-turns-classify.js` `wasted-turns-report.test.js`
**Mission, campaign & session state (cont.)** — `pm-ledger.js`
**Mission, campaign & session state (cont.)** — `pm-act.js`
**Mission, campaign & session state (cont.)** — `switchboard-quality.js`
**Mission, campaign & session state (cont.)** — `request-decision.js` `lib/team.js` `lib/menu-card-content.js` `lib/team.test.js` `open-decision-role-gate.test.js` `open-decision-attach-step.test.js` `request-decision.test.js` `pm-ask.js` `pm-auto-handoff.js` `check-architecture-map.js` `map-drift-check.js` `map-arch-check.js` `map-arch-check.test.js` `map-drift-check.test.js` `check-architecture-map.test.js` `pm-auto-handoff.test.js` `card-triage.js` `pm-switchboard.js` `pm-inbox-done.js` `fleet-replay.js` `fleet-replay.test.js` `lib/pm-inbox-adapter.js` `lib/pm-result-rules.js` `lib/work-order-plan.js` `work-order-adopt.js` `work-order-adopt.test.js` `native-msg-outbox.js`
`mission-routing-admission.js` `mission-execution-graph-check.js` `scaffold-mission.js` `mission-terminal-reconcile.js` `mission-convergence-check.js` `next-touch-validation.js` `validate-next-touch-reservation.js` `validate-next-touch-terminal.js` `session-mode.js` `session-ctx-report.js` `noncq.js` `noncq.test.js` `lib/noncq-pools.json` `stage-advance.js` `lib/fleet-task.js` `lib/stage-event.js` `run-approval.js` `compaction-rehydrate.js` `checkpoint-coverage.js` `run-ledger.sh` `watch-foreman.js` `agent-liveness-check.js` `stuck-hand-check.js` `stuck-hand-check.test.js` `implementation-campaign-check.js` `check-plan-authority-ownership.js` `check-repair-scope.js` `stage-graph.js` `lib/stage-write.js` `lib/urgent-review-follow-up.js` `task-card.js`

**Engine capability & qualification** — `engine-scorecard.js` `engine-capability-state.js` `engine-qualify.sh` `engine-qualify.js` `qualification-case-broker.js` `qualification-review-provider.js` `lib/qualification-panel-schema.json` `lib/qualification-mode-schemas.json` `lib/agy-containment.js` `probe-engine-capability.sh` `probe-local-engine.js` `probe-harness-capabilities.sh` `probe-todo-tools-pin.js` `probe-codex-enforcement.js` `probe-codex-postcompact-production.js`
`probe-skill-frontmatter-portability.sh` `platform-capability-claims.js` `bench-engine-capability.sh` `import-aa-capabilities.js` `evaluate-profile-cutover.js` `build-qualification-defaults.js` `adopt-qualification-defaults.js` `lib/qualification-feed.js` `qualification-sweep.sh` `lib/qualification-asset-seals.js` `lib/qualification-applicability-scope.js` `qualification-metrics.js` `lib/qualification-metrics.js` `qualification-feed-trust.js` `lib/qualification-confirm.js` `qualification-prices.js` `lib/qualification-prices.js` `qualification-send-queue.js` `lib/qualification-record-v2.js` `lib/qualification-usage.js` `lib/qualification-effort-label.js` `lib/qualify-stage-credentials.sh`
**Engine capability & qualification (cont.)** — `lib/vision-guard.js` `lib/engine-vision.json` `runner-pin-check.js` `runner-smoke.js` `lib/runner-pins.js` `lib/engine-preflight.js` `lib/codex-models-cache.js`

**Execution profiles** — `build-profile-payload.js` `profile-session.js` `check-profile-isolation.js` `measure-profile-context.js`

**Root-scan guard** — `lib/root-scan-guard.js` `root-scan-shim.js`

**Diff scanning & anti-gaming** — `completeness-scan.sh` `error-path-scan.sh` `secret-scan-diff.js` `safe-inspect.js` `lib/mask-secrets.js` `check-redispatch-prompt.sh` `check-dispatch-suppression.sh` `check-backlog-entries.js` `check-backlog-single-writer.js` `lib/backlog-rules.js` `lib/record-files.js` `migrate-backlog-entries.js` `diff-file-list.sh` `diff-scope-report.sh` `diff-since-last-round.sh` `probe-diff-domain.sh`
`classify-diff-risk.sh` `check-disjointness.sh` `check-hands-commit.js` `check-test-integrity.sh` `replay-test-integrity.js` `scan-fixture-literals.js` `check-blind-evidence.sh` `lib/test-integrity-l1.py` `check-test-outcome.js` `leak-guard.js` `redact-personal.js` `lib/personal-data-patterns.js` `lib/personal-data-redact.js` `lib/leak-guard-hosts.example.json` `knowledge-review.js` `knowledge-review.test.js`

**Diff scanning & anti-gaming (cont.)** — `ar-redact.js` `lib/ar-redact-rules.js` `lib/ar-redact-rules.test.js` `lib/ar-redact-fixtures.js`

**Verification & review synthesis** — `pm-accept-check.js` `dispatch-experience-critic.sh` `verify-preexisting.sh` `verify-red-green.sh` `verify-strength.js` `gate-verify.js` `per-turn-gate-arm.js` `adjudicate-findings.js` `probe-mutation.js` `review-mvp-portfolio.js` `review-seat-report.js` `qc-panel.js` `qc-evidence-status.js` `lib/qc-evidence.sh` `render-review-page.js` `qc-metric-emit.js` `calibration.sh` `ladder-run.sh` `check-node-report.js` `check-loop-convergence.js` `check-foreman-polling.js` `check-escalation-coverage.js` `rubric-freeze.js` `admit-backlog-follow-ups.js` `check-holdout-coverage.sh` `affected-suites.js`
`build-dep-cache.js` `lib/dep-trace-hook.js` `lib/dep-trace-bash.sh` `plan-rubric-scaffold.js` `hetero-review-loop.js` `check-phase-review-receipt.js` `measure-streamjson-equivalence.js` `lib/review-chain-derive.js` `lib/review-packets.js`
`lib/finding-class.js` `lib/exclude-allowlist.js` `lib/seat-id-guard.js` `lib/raw-log-path.js` `review-ledger-archive.js` `lib/review-ledger-copy.js` `lib/review-ledger-tar.js` `evidence-pack.js` `evidence-pack.test.js` `lib/high-risk-paths.json`

**Verification & review synthesis (cont.)** — `fleet-tools-regress.js` `fleet-tools-regress.test.js` `review-jury.js` `render-fleet-inventory.js` `rule-effect-check.js` `post-merge-suite.sh` `nightly-suites.sh`
`replay-stop-guard.js` `reply-precheck.js` `check-unmerged-ship.js` `lesson-lint.js` `lesson-lint.test.js` `check-tip-verify-default.sh` `lib/tip-verify-repo-default.js` `lib/tip-verify-grace.json`

**Task tree & risk** — `tree.js` `risk-counter.js` `brain-tier-report.js` `check-batch-overlap.js` `hook-harness-matrix.js` `lib/chain-command.js`

**Sync, drift & release gates** — `sync-all.sh` `sync-version.js` `sync-agent-bodies.sh` `sync-model-routing.sh` `sync-codex-plugin-skills.sh` `sync-opencode-plugin.sh` `check-canonical-invariants.sh` `check-settings-changelog.js` `check-reference-sizes.js` `check-supersession-anchors.js` `check-claude-md-inventory.js` `check-tmp-residue-registry.js` `check-config-docs.js` `config-keys.json` `check-guidance-eval.js` `check-contract-schema.js` `check-hook-inventory.js` `check-js-syntax.js` `check-optin-changelog.js` `check-readme-parity.js` `check-plan-graduation.js` `preflight-portability.sh` `preflight-release.sh` `report-roster-field-consumers.js` `validate.sh` `validate-json-schema.js` `doc-drift-gate.js` `test-doc-drift-gate.sh` `check-stage-vocab.js` `layout-lint.js`
`check-config-docs.test.js`

**Sync, drift & release gates (cont.)** — `check-fixed-times.js` `check-test-exec-bits.js` `check-plan-phases.js` `lib/plan-inventory-lint.js` `plan-to-tasks.js` `plan-gap-hint.js` `tests/plan-to-tasks-join.test.sh` `finish-triage.js` `look-classes.json` `probes/p1.sh` `probes/p2.sh` `probes/p3.sh` `probes/p4.sh`

**Sync, drift & release gates (cont.)** — `check-quota-adapters.js` `check-events-contract.js` `check-claude-spawn-sites.js` `lib/claude-spawn-sites.json` `export-fleet-flow.js` `export-fleet-flow.test.js` `check-seat-rules.js` `tests/check-seat-rules.test.js`

**Sync, drift & release gates (cont.)** — `gen-tux.js` `tux-manifest.js` `ansi-to-html-grid.js` `ansi-to-html-grid.test.js`（使用方式見 [終端畫面轉 HTML](../docs/guide/terminal-screen-to-html.md)）

**Setup & install** — `dev-setup.sh` `dev-update.sh` `accounts-onboard.sh` `profile-health.js` `profile-link.js` `lane-switch.js` `profile-switch-advice.js` `login-checklist.js` `install-hooks.sh` `install-antigravity.sh` `install-opencode.sh` `install-token-discipline.js` `install-quota-mirror.js` `rollout-quota-mirror.sh` `install-fleet-card-mirror.js` `setup-symlinks.sh` `setup-symlinks.ps1` `install-antigravity.ps1` `agy-shell-guard.zsh` `project-detect.js` `scaffold-config.js` `statusline-live-tee.js` `lib/opencode-discovery-probe.js` `lib/test-git-env.js` `lib/test-git-env.sh` `lib/test-gitconfig` `lib/runner-fallback-bin.sh`

**Skills tooling, evals & measurement** — `eval-skill-triggers.js` `tests/eval-skill-triggers.test.js` `measure-seat-injection.js` `tests/measure-seat-injection.test.js` `export-hook-trace.js` `export-hook-trace.test.js` `cost-digest.js` `pm-seat-cost-metrics.js` `pm-seat-cost-daily.sh` `pm-seat-cost-daily.test.sh` `pm-seat-cost-metrics.test.js` `benchmark-hook-latency.js` `status-events-bench.js` `distill-scan.js` `identifier-scan.js` `distill-consolidate.sh` `distill-sync-setup.sh`
`retro-review-loop.js` `lib/retro-loop-metrics.js` `lib/transcript-attribution.js` `measure-task-width.sh` `task-width-fleet.sh` `task-width-ingest.py` `run-eval-batch.sh` `run-skill-opt.sh` `toggle-payload-capture.js` `benchmark-hook-multiplexer.js` `validate-hook-multiplexer-benchmark.js` `run-grok-implementer-ab.sh` `validate-grok-implementer-ab.js` `test-grok-effort.sh` `roundtable-window.js` `permission-prompt-watch.js` `lib/permission-prompt-detect.js` `ticket-claude-usage.js`

**Shared JSON & store primitives** — `lib/json-emit.sh` `lib/brain-spend.js` `lib/residue-config.js` `lib/run-ledger-config.js` `lib/effort-scale.js` `lib/jsonl-store.js` `lib/extract-json-object.js` `lib/runner-binary.js` `lib/auth-stop.js` `lib/auth-stop.sh` `lib/claude-call-capture.js` `lib/claude-call-capture.sh` `lib/claude-call-capture-exec.sh` `lib/headless-seat-derive.js` `lib/grok-effort.js` `lib/live-state-dir.js` `lib/config-path.js` `lib/load-source.js` `lib/json-fields.sh`
`lib/kimi-local-stop.js` `lib/kimi-containment.js` `lib/opencode-containment.js` `lib/test-identity.sh` `lib/semver.js` `lib/bash-wait-rules.js` `lib/sealed-docs.js` `lib/workflow-snapshot.js` `lib/compaction-handoff.js` `lib/bash-launch-rules.js` `lib/engine-spelling.js` `lib/room-log.js` `lib/qualification-trust.js`

**Review family gate** — `lib/outbound-secret-scan.js` `lib/review-family-gate.js` `lib/cn-model-dispatch-gate.js` `lib/local-impl-slot.js` `lib/local-impl-slot.test.js` `lib/local-reviewer-exclusion.js` `local-reviewer-exclusion.test.js` `lib/cloud-operators.json` `lib/cn-model-gate-defaults.json` `cn-model-dispatch-gate.test.js` `lib/kimi-quota-observe.js` `lib/kimi-quota-observe.test.js` `lib/kimi-quota-observe.test.js` `cursor-quota-observe.test.js` `lib/qc-panel-codex-fallback.js` `lib/seat-fallback.js` (operator-based cloud gate, lease acquisition and context gating for implicit local implementers; cross-family rule, codex quota runtime substitute, pace-ordered seat retreat / family inference; contracts: `lib/cn-model-dispatch-gate.js`, `references/hetero-dispatch.md`)

**Transcript data class** — `lib/data-class-policy.js` `lib/data-class-policy.json` `pm-offline-estimate.js` `pm-offline-estimate.test.js` `pm-replay-slice.js` `pm-replay-slice.test.js` `decided-no-task-bind.js` `decided-no-task-bind.test.js` `pm-replay-dryrun.js` `pm-replay-dryrun.test.js` `pm-replay-run.js` `pm-replay-run.test.js` `lib/replay-sandbox.js` `lib/replay-sandbox.test.js` `lib/replay-stub.js` `lib/replay-stub.test.js` `lib/replay-score.js` `lib/replay-score.test.js` `lib/replay-budget.js` `lib/replay-budget.test.js` `lib/replay-pool.js` `lib/replay-pool.test.js` `qualification-review-provider-cn-gate.test.js`

**Shared JSON & store primitives (cont.)** — `lib/quota-mirror-dirs.js` `lib/decision-answer.js`

**Shared JSON & store primitives (cont.)** — `lib/claude-stream-envelope.js` `lib/account-observation.js` `lib/repo-layout.js` `lib/seat-model-id.js` `lib/roster-overlay.js` `lib/fleet-decision.js` `lib/decide-line.js` `lib/agy-timeout.sh` `lib/events-fixture.js` `lib/account-registry.js` `lib/account-quota.js` `lib/account-cooldown.js` `lib/account-pick.js` `lib/account-interpret.js` `lib/account-capture.js` `lib/account-probe.js` `lib/account-audit.js` `lib/account-env.js` `lib/account-fixtures/claude-shim.js` `lib/account-fixtures/shim-install.js` `lib/account-fixtures/os-lock-holder.js` `lib/account-rail.js` `lib/account-state.sh` `lib/role-kit.js` `lib/role-kit-kimi.js` `lib/role-kit.sh` `lib/eval-account.sh` `lib/eval-account.js` `lib/fixtures/gen-account-pick-g37-golden.js`

**Shared JSON & store primitives (cont.)** — `lib/hippo.js` `lib/m6-cutline.js` `project-record.js` `lib/lane-manifest.js` `lib/switch-journal.js` `lib/lane-switch-preflight.js` `lib/lane-switch-handoff.js` `lib/lane-switch-transcript.js` `lib/lane-switch-confirm.js` `lib/fleet-peers.js` `lib/token-seat.js` `lib/token-seat.sh` `lib/safe-mkdirp.js`

**PM, seat & operator-card tooling** — `pm-handoff-write.js` `plan-sync-run.sh` `operator-stuck-no-card.js` `lib/seat-decl.js` `acp-usage-probe.js` `lib/grok-live-probe.js` `measure-cn-shingle-build.js`

**Test helpers** — `lib/test-reaper.js` `lib/test-tmux-claude-teardown.sh` `check-test-tmux-claude-teardown.js` `check-test-cli-timeout.js` `runaway-scan.sh` `check-test-bg-reap.js`


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

`node scripts/fleet-tools-regress.js` checks fleet upload, fetch, and watch registration/cancellation; intended for hangar’s updater to call after each harness update.
