# autopilot — project conventions (Claude Code)

For Claude Code sessions working **on** the autopilot plugin itself. Skill-runtime conventions live in each skill's `SKILL.md`; this file covers cross-cutting things a session needs at entry.

For **non-Claude-Code** agents (OpenCode, Codex, Antigravity, …), see [`AGENTS.md`](AGENTS.md) for the agents.md-spec readme that applies to any agent. For cross-platform portability details (what each platform actually supports vs. what's unverified), see [`references/multi-agent-portability.md`](references/multi-agent-portability.md).

## What this repo is

Standalone-capable lifecycle orchestration plugin for Claude Code. 28 skills, 3 methodology agents, 25 hooks (10 default-on, 15 opt-in, 0 disabled). Works fully alone; the assumed ecosystem baseline is cookys's own `autopilot` + `codeforge` + `mnemos` trio (standalone from third-party plugins). Delegates to `superpowers` when installed via `.claude/dispatch-config.md` chains (optional). See [`docs/coexistence.md`](docs/coexistence.md) for the full coexistence model.

## Scripts inventory (prefer over LLM judgment)

`scripts/` ships deterministic tooling that the skills reference instead of asking the LLM to do mechanical work each run. Before hand-coding any mechanical step, check whether a script already covers it.

This table is an INDEX, not a spec: one row = what it does + when to call it + pointer to the canonical detail (reference doc, `--help`, or the script header). Version history lives in `CHANGELOG.md` — never append it here (enforced by `check-claude-md-inventory.js`).

| Script | Purpose |
|--------|---------|
| [`scripts/completeness-scan.sh`](scripts/completeness-scan.sh) | Anti-stub regex (TODO/FIXME/empty-impl/DISABLED_) on staged diff; JSON output; exit 1 ⇒ new findings (quality-pipeline completeness gate). |
| [`scripts/error-path-scan.sh`](scripts/error-path-scan.sh) | L0 attention-slip scan for error paths (swallowed errors, broadened catches, untested error branches). JSON output; exit 0 always (advisory findings for reviewer). |
| [`scripts/secret-scan-diff.js`](scripts/secret-scan-diff.js) | L0 attention-slip scan for secrets. JSON output; exit 1 ⇒ findings (quality-pipeline completeness gate blocking step). |
| [`scripts/check-redispatch-prompt.sh`](scripts/check-redispatch-prompt.sh) | Leaky-phrase linter for round-2+ re-dispatch prompts; encodes `references/blind-dispatch.md` checklist. Exit 1 ⇒ strip and retry. |
| [`scripts/check-dispatch-suppression.sh`](scripts/check-dispatch-suppression.sh) | Anti-gaming linter for **any** dispatch prompt (round-1 included; sibling of `check-redispatch-prompt.sh`): catches a dispatcher coaching the reviewer to suppress / pre-rate findings. Exit 1 ⇒ strip and re-dispatch. Encodes `references/blind-dispatch.md` anti-gaming pre-flight. |
| [`scripts/diff-file-list.sh`](scripts/diff-file-list.sh) | Changed-file list as a Verified Clean markdown checklist. Removes LLM-from-memory file enumeration in reviewer output. |
| [`scripts/diff-scope-report.sh`](scripts/diff-scope-report.sh) | Scope-creep candidate filter: whitespace-only files, files not in commit message, comment-only hunks, quote-style swaps. JSON `findings`; reviewer judges, doesn't auto-flag. |
| [`scripts/probe-diff-domain.sh`](scripts/probe-diff-domain.sh) | Deterministic LLM-free diff-domain telemetry probe for `/l5`: extension→domain classifier over `git diff --numstat` → JSON `{work_domain, language_mix, …}` (domains `rust`/`backend-cli`/`frontend`/`docs`/`mixed`). **Telemetry only — routes no engine.** Consumed by `resolve-review-loop.sh --auto-domain`. |
| [`scripts/resolve-dispatch.sh`](scripts/resolve-dispatch.sh) | Role → `{model, mode, agent}` JSON (`--tree` for the task-tree role table). Consults `.claude/model-routing-config.md` or `references/model-routing.md` defaults. Use instead of hardcoding dispatch metadata. |
| [`scripts/resolve-endpoint.sh`](scripts/resolve-endpoint.sh) | Named-endpoint credential resolver (`AUTOPILOT_ENDPOINT_<NAME>_{URL,TOKEN}` convention) → **NON-SECRET** readiness metadata; never prints a token; atomic candidate resolution, fail-closed. Consumed by `dispatch-hetero.sh` / `dispatch-review.sh` `--endpoint` + `dispatch-anthropic-review.js --token-env`; creds populate via `load-endpoints-env.sh`. |
| [`scripts/load-endpoints-env.sh`](scripts/load-endpoints-env.sh) + [`scripts/lib/load-endpoints-env.js`](scripts/lib/load-endpoints-env.js) | Canonical endpoint-credential loader (bash sourceable + Node twin): populates `AUTOPILOT_ENDPOINT_*` env vars from mode-600 `~/.autopilot/endpoints.env` (+ opt-in per-repo overlay `~/.autopilot/endpoints.d/<repo-key>.env`). Line-parser (never `source`), fail-closed perms gate, never echoes tokens; `--init` scaffolds from [`scripts/endpoints.env.example`](scripts/endpoints.env.example). Secrets stay by-user — never a repo-local secrets file. |
| `bin/autopilot.js endpoints <sub>` ([`src/endpoints/cli.js`](src/endpoints/cli.js)) | `autopilot endpoints` CLI — control surface for the credential system: `init` / `list` / `which` (this repo's merged view) / `set` (**token via STDIN only, never argv**) / `doctor`. Never prints token values. |
| `bin/autopilot.js status <sub>` ([`src/status/cli.js`](src/status/cli.js)) | `autopilot status` CLI — 唯讀狀態總覽，合成既有觀測底座（never re-derive）：`quota`（per-model 池狀態；過期觀測=unknown，絕不當活真相）/ `runs`（含 `--tree` 父子樹）/ `roster`（review-loop 座位表）。全部 `--json`。 |
| [`scripts/verify-preexisting.sh`](scripts/verify-preexisting.sh) | Test failure classification: PRE_EXISTING / INTRODUCED / NO_FAILURE / INCONCLUSIVE. Replaces manual `git stash + checkout develop` recipe. |
| [`scripts/verify-red-green.sh`](scripts/verify-red-green.sh) | Red-green validation (opposite-direction sibling of `verify-preexisting.sh`): proves a change's tests actually EXERCISE it — head must be GREEN and, in an isolated detached worktree, the test-only edits applied onto base must be RED. Verdicts `VALIDATED` / `NOT_RED_ON_BASE` / `NOT_GREEN_ON_HEAD` / `INCONCLUSIVE` (fail-closed); JSON; artifact-not-self-report. |
| [`scripts/reap-dispatch-branches.sh`](scripts/reap-dispatch-branches.sh) | Preserve-first local dispatch-branch lifecycle rail: `scan` / `check` (finish-flow ack gate) / `reap` (dry-run default; deletes only branches proven contained by the integration target, one verified full-history bundle first). Contract/tests: [`references/hetero-dispatch.md`](references/hetero-dispatch.md) § Repo-branch lifecycle. |
| [`scripts/risk-counter.js`](scripts/risk-counter.js) | Persistent WTF-Likelihood Cap counter (per repo+branch). Subcommands: `status`, `increment --event <kind>`, `threshold-hit`, `reset`. |
| [`scripts/session-mode.js`](scripts/session-mode.js) | Orchestrator-mode marker CLI (`set --level l3\|l4\|l5\|l6` / `clear` / `status`): session-id-keyed marker under `~/.autopilot/session-mode/`, 24h TTL, fail-open on expiry; written by /l4–/l6 entry, cleared at finish-flow L-5.6; read by the `orchestrator-edit-gate` + `context-budget` opt-in hooks. |
| [`scripts/diff-since-last-round.sh`](scripts/diff-since-last-round.sh) | Round-N checkpoint + delta-since-checkpoint. **Delta output is dispatcher-only — never pass to reviewer** (leaks round-cycle meta-signal). |
| [`scripts/dispatch-hetero.sh`](scripts/dispatch-hetero.sh) | Heterogeneous implementer dispatch (`--runner auto\|codex\|agy\|grok\|cc-shim\|pi\|qoderclicn`; auto routes by model name incl. `*qwen*`/`*qwq*`→qoderclicn, cc-shim/pi explicit-only) with hard-coded worktree isolation + worker cgroup containment (**teardown-hygiene provenance, NOT a security attestation**) + artifact-based verification — status from exit code + git artifacts, never agent self-report. Startup-prunes aged tmp residue via [`scripts/lib/prune-tmp-residue.sh`](scripts/lib/prune-tmp-residue.sh). Runner rails, preconditions + outcome table: [`references/hetero-dispatch.md`](references/hetero-dispatch.md). |
| [`scripts/dispatch-status.js`](scripts/dispatch-status.js) | Mid-run dispatch observability: dispatchers emit a START-time run manifest; `--run <id>` → phase/liveness/usage/stall JSON (report-only, never auto-kills; no-signal formats ⇒ honest `null`); `--reap` retention reaper (live runs never touched). Recipe: [`references/hetero-dispatch.md`](references/hetero-dispatch.md) § Mid-run observability. |
| [`scripts/run-ledger.sh`](scripts/run-ledger.sh) | Durable per-run R0 ledger + stage state machine (`stage-acquire`/`stage-heartbeat`/`stage-transition`/`journal-add`/directive queue; flock + fsync-rename). Consumed by `watch-foreman.js`, the dispatch detach rail, and `pi-rpc-run.js` directive delivery. Contract in its header. |
| [`scripts/watch-foreman.js`](scripts/watch-foreman.js) | Depth-0 live sensing for a dispatched /l4–/l6 foreman: composes the `run-ledger.sh` ledger + dispatch manifests into one event stream (`STAGE`/`LEAF_START`/`LEAF_END`/`QUIET`/`LEAF_STALL`/`WAIT`) behind the Monitor tool. **Report-only by construction** (no kill/steer surface). Ritual: front-door § Live sensing. |
| [`scripts/lib/json-emit.sh`](scripts/lib/json-emit.sh) | Sourceable JSON helpers — the ONE canonical `json_escape` (RFC 8259-correct) + `json_array_from_lines`; replaces the old divergent per-script copies. Tests: [`hooks/tests/json-emit.test.sh`](hooks/tests/json-emit.test.sh). |
| [`scripts/lib/resolve-config.sh`](scripts/lib/resolve-config.sh) | Sourceable config-resolution helpers: `resolve_config_ladder` (4-tier override-env → cwd `.claude/` → repo `.claude/` → `project-config-template/`) + `read_field` markdown parser. `resolve-doa.sh` is a deliberate carve-out (different ladder contract, documented in-file). Tests: [`hooks/tests/resolve-config.test.sh`](hooks/tests/resolve-config.test.sh). |
| [`scripts/dispatch-author.sh`](scripts/dispatch-author.sh) | READ-ONLY heterogeneous AUTHORING dispatch (test plans / verification docs / spec writeups; the `/l6` authoring leaf) — sibling of `dispatch-review.sh` with no review template (a reviewer template makes engines parse authoring input as a spec). Runner rails + read-only posture in its header. |
| [`scripts/lib/dispatch-author-codex-transport.sh`](scripts/lib/dispatch-author-codex-transport.sh) | Codex author transport engine（`dispatch-author.sh` source）：行程真相先於內容真相——私有 run dir、exit-first 分類、全樹 TERM→KILL reap、雙關係 witness、fail-closed。Oracle: [`hooks/tests/dispatch-author-codex-transport.test.sh`](hooks/tests/dispatch-author-codex-transport.test.sh)。 |
| [`scripts/lib/dispatch-detach.sh`](scripts/lib/dispatch-detach.sh) + [`scripts/lib/output-quiescence.sh`](scripts/lib/output-quiescence.sh) | Sourceable dispatch-rail helpers: `setsid`-survive detach for the read-only rails (`dispatch-review.sh`/`dispatch-author.sh`; heartbeats to the R0 ledger, atomic result landing) + content-driven output-quiescence wait for late-flushing runner subprocesses. |
| [`scripts/lib/pi-rpc-run.js`](scripts/lib/pi-rpc-run.js) | pi RPC supervisor for `dispatch-hetero.sh --runner pi`: spawns `pi --mode rpc`, forwards its JSONL event stream verbatim to `$LOG`, report-only stall probe (never auto-kills). pi RPC is a persistent server — the supervisor owns shutdown and scores on the observed `agent_end`, never pi's exit code. Optional R0-ledger advisory directive delivery. Recipe: [`references/hetero-dispatch.md`](references/hetero-dispatch.md) § pi. |
| [`scripts/dispatch-contract.js`](scripts/dispatch-contract.js) | Dispatch-unit contract validator: `check --contract <file> --repo <dir> --json` validates against `schemas/dispatch-unit-contract.schema.json` + resolves the engine, emitting GO / NO-GO with sha256 provenance. Pre-dispatch gate for `dispatch-hetero.sh` / `dispatch-author.sh`. |
| [`scripts/lib/jsonl-store.js`](scripts/lib/jsonl-store.js) | Shared JSONL-store concurrency primitives (Node built-ins): canonical flock + PID-liveness stale-lock breaker + atomic append + monotonic `event_id`. Consumed by `engine-scorecard.js` / `engine-capability-state.js` / `adjudicate-findings.js`; **`scripts/tree.js` is a deliberate carve-out** (different lock contract). Tests: [`hooks/tests/jsonl-store.test.sh`](hooks/tests/jsonl-store.test.sh). |
| [`scripts/dispatch-batch.sh`](scripts/dispatch-batch.sh) | Tier-2 batch fan-out engine for `/l4` width parallelism: `plan` (single-base enforcement) / `verify` (git artifacts, ALL-OR-NOTHING) / `merge-back` (merge-conflict-as-missing-edge ⇒ `serial_collapse`, never auto-resolves) / `telemetry` / `reap`. Contract: [`references/batch-dispatch.md`](references/batch-dispatch.md). |
| [`scripts/ladder-run.sh`](scripts/ladder-run.sh) | Acceptance-delegation ladder harness (P2.2): change → decorrelated isolated verify → QC event emit → deterministic 30% sample flag → class escape/endorsement recompute → tier promotion **recommendation** (never auto-flips); `audit` records later-stage escapes. Fail-closed (`HOLD-ERROR`/`needs_human`, never a fail-open promote). |
| [`scripts/qc-metric-emit.js`](scripts/qc-metric-emit.js) | P2.1 QC-metric emitter: appends one QC review event to the llm-playground-owned escape-rate store (`$QC_METRIC_STORE`); additive, fail-closed no-op if unconfigured. Emit sites: depth-0 QC panel + `ladder-run.sh`. |
| [`scripts/adjudicate-findings.js`](scripts/adjudicate-findings.js) | Finding-adjudication table (quality-floor engine): append-only JSONL per review round making "verified" MECHANICAL — `probe` ⇒ `REPRODUCED`, `refute` requires a mutation-validated probe, `trace` ⇒ `PROOF_BY_TRACE`, `gate --ids` exit 1 unless every id actionable. Probes are EXECUTED by depth-0 (artifact-not-self-report applies to probes). Design: [`docs/plans/2026-07-04-quality-floor-engine.md`](docs/plans/2026-07-04-quality-floor-engine.md). |
| [`scripts/distill-scan.js`](scripts/distill-scan.js) | Deterministic history scanner for `skills/distill`: session JSONL → frequency atoms (ritual + correction buckets); `--incremental`/`--new-only` per-session cursor. No LLM in the count path. |
| [`scripts/retro-review-loop.js`](scripts/retro-review-loop.js) | Review-loop lens for `skills/retro` Step 1f: counts real dispatch/review Bash `tool_use` invocations in local session transcripts + per-commit git loop markers — recovers effort the git-history retro can't see. Fail-safe zero counts; no LLM in the count path. |
| [`scripts/distill-sync-setup.sh`](scripts/distill-sync-setup.sh) | `skills/distill` pack-sync onboarding: `status` / `init-remote` / `enroll` / `fix-gitignore`. Idempotent; emits the **correct** `.claude/*` + `!.claude/skills/` negation (the obvious form is silently broken — git can't re-include under a fully-excluded parent). |
| [`scripts/distill-consolidate.sh`](scripts/distill-consolidate.sh) | `skills/distill` cross-machine consolidation plumbing (no LLM): `normalize-slug` (order-preserving machine-stable slug) / `migrate` (rename dirs + rewrite frontmatter `name:`; STOPs on collision) / `compare` vs `@{u}`. Human-gated LLM merge lives in SKILL.md Step 5. Design: [`docs/plans/2026-06-04-distill-consolidate.md`](docs/plans/2026-06-04-distill-consolidate.md). |
| [`scripts/validate.sh`](scripts/validate.sh) | Validate every skill's SKILL.md structure (YAML frontmatter, required fields). |
| [`scripts/project-detect.js`](scripts/project-detect.js) | `skills/onboard` detector (pure read → fail-safe JSON): package manager, commands, coverage thresholds, doc convention, workspace, `default_branch`, protected-path candidates, installed plugins. Owns the MECHANICAL half so the skill doesn't re-derive it. |
| [`scripts/scaffold-config.js`](scripts/scaffold-config.js) | `skills/onboard` scaffolder: `project-detect.js` JSON → the 9-file `.claude/` config set (7 mechanical + 2 judgment skeletons with `TODO(onboard)` markers). Idempotent; `--force` / `--dry-run`; writes ONLY inside the target. |
| [`scripts/dev-setup.sh`](scripts/dev-setup.sh) | One-time local-dev setup. |
| [`scripts/dev-update.sh`](scripts/dev-update.sh) | Daily dev-clone update: `git pull --ff-only` + version-change report (`docs/installation.md` § Updating). |
| [`scripts/sync-version.js`](scripts/sync-version.js) | Sync version across canonical `.claude-plugin/plugin.json` + mirrors + description count fragments; `--check` drift gate in pre-commit. Does NOT own hook counts — those belong to `check-hook-inventory.js`. |
| [`scripts/sync-codex-plugin-skills.sh`](scripts/sync-codex-plugin-skills.sh) | Materialize the committed Codex plugin payload under `platforms/codex/plugin/`; `--check` anti-drift gate (pre-commit + `preflight-portability.sh`). |
| [`scripts/check-readme-parity.js`](scripts/check-readme-parity.js) | Assert `README.md` ↔ `README.zh-TW.md` lockstep (shields.io badge values + section-header count); exit 1 on drift. Wired into `preflight-portability.sh`. |
| [`scripts/check-optin-changelog.js`](scripts/check-optin-changelog.js) | Gate that the current version's CHANGELOG section names every changed opt-in stem in an `opt-in` paragraph. |
| [`scripts/check-hook-inventory.js`](scripts/check-hook-inventory.js) | Single source of truth for the hook tally: derives default-on/opt-in/disabled tiers from real wiring; `--check` asserts every doc agrees on counts AND per-tier membership. Wired into `preflight-portability.sh`. |
| [`scripts/check-claude-md-inventory.js`](scripts/check-claude-md-inventory.js) | Membership + size gate for THIS file: every `scripts/*.{sh,js}` + `scripts/lib/*` basename must be NAMED here (else it's dead code), the file must stay under the 40k harness warning threshold, and no line may exceed the per-line byte cap — version history belongs in `CHANGELOG.md`, details in `references/` or the script header. `--json`; run via `sync-all.sh`. |
| [`scripts/report-roster-field-consumers.js`](scripts/report-roster-field-consumers.js) | **Advisory report, never a gate**: counts literal matches for every always-on review-loop roster field across seven scan roots and buckets each as code-match / skills-match / no-detected-modeled-match. Exit 0 whatever it finds; exit 2 + `REPORT-HEALTH` only when it cannot run. Deliberately NOT a `sync-all` ritual (that harness hides a passing ritual's output). Printed by CI and by `preflight-release.sh`; **owner reviews the bucket at release prep**. Measures matches, not consumption — see [`docs/plans/2026-07-25-roster-field-report.md`](docs/plans/2026-07-25-roster-field-report.md). |
| [`scripts/check-l1-cache-key-parity.js`](scripts/check-l1-cache-key-parity.js) | Parity gate: the L1 JS-runtime CI cache key (`.github/workflows/test.yml`) must match the jest/vitest pins in `hooks/tests/check-test-integrity-l1.test.sh`. Registered in `sync-manifest.json`. |
| [`scripts/sync-agent-bodies.sh`](scripts/sync-agent-bodies.sh) | Strip YAML frontmatter from `agents/<role>.md` → `.opencode/agent-bodies/<role>.body.md` (OpenCode `{file:..}` reference target). `--check` mode in pre-commit. |
| [`scripts/sync-model-routing.sh`](scripts/sync-model-routing.sh) | model-routing single-truth sync: `references/model-routing.md` is CANONICAL; the four in-skill copies are regenerated as real files; `--check` byte-parity (pre-commit via `check-canonical-invariants.sh` mirror mode). Never hand-edit a copy. |
| [`scripts/sync-all.sh`](scripts/sync-all.sh) + [`scripts/sync-manifest.json`](scripts/sync-manifest.json) | One entry point for the repo's sync/check rituals. The manifest is DATA (one row per ritual); `sync-all.sh` runs every generator or `--check`; `--changed` filters by trigger globs; `--only <id>` runs one. Pre-commit, CI and `preflight-portability.sh` delegate here — register new rituals in ONE place. Tests: [`hooks/tests/sync-all.test.sh`](hooks/tests/sync-all.test.sh). |
| [`scripts/preflight-portability.sh`](scripts/preflight-portability.sh) | 17-check cross-agent acceptance gate (hooks smoke, symlinks, inventory drift, README parity, Codex payload, doc drift, OpenCode plugin/skill/agent). Self-skips OpenCode checks when the binary is absent. |
| [`scripts/preflight-release.sh`](scripts/preflight-release.sh) | Release-hygiene gate: CHANGELOG entry + INDEX row + version-mirror parity + slash-entry thin-shell probe + north-star surface lines (prose +5% needs a CHANGELOG `prose-justification:` line). Run at finish-flow L-5.5 when a ship bumps the version. |
| [`scripts/setup-symlinks.sh`](scripts/setup-symlinks.sh) / [`.ps1`](scripts/setup-symlinks.ps1) | Ensure `.agents/skills/` symlink resolves (Windows-safe). Auto-run by `dev-setup.sh`. |
| [`scripts/install-antigravity.sh`](scripts/install-antigravity.sh) / [`.ps1`](scripts/install-antigravity.ps1) | Register autopilot as an `agy` plugin behind a data-loss preflight (refuses a symlinked `~/.gemini/config/plugins/<name>` — agy ≤ 1.0.7 self-copy-truncates through it) + export-then-install (agy only ever sees a `git archive HEAD` export, never the live repo). |
| [`scripts/agy-shell-guard.zsh`](scripts/agy-shell-guard.zsh) | Sourceable shell backstop for raw `agy plugin install/uninstall`: blocks while any symlink sits in `~/.gemini/config/plugins/` (agy ≤ 1.0.7 self-copy-truncation kill condition). |
| [`scripts/install-hooks.sh`](scripts/install-hooks.sh) | Set `git config core.hooksPath .githooks`: `pre-commit` (drift gates) + `post-merge` (release-ritual advisory; never blocks, never commits). |
| [`scripts/tree.js`](scripts/tree.js) | Task-tree engine core: append-only JSONL event log per project, single state-owning CLI (`init`/`emit`/`rebuild-index`/`next-decision`/`report`/`escalations`/`fetch --raw`/`board-status`). Contracts: [`references/tree-contracts.md`](references/tree-contracts.md). |
| [`scripts/check-node-report.js`](scripts/check-node-report.js) | Node-report contract validator: schema + evidence-pointer resolution (commit-SHA anchored via `git show`) + artifact sha256 verify. JSON `{valid, errors, warnings}`. |
| [`scripts/check-canonical-invariants.sh`](scripts/check-canonical-invariants.sh) | Cross-file invariant gate for files intentionally not byte-equal: `repeat` (verbatim phrase must co-exist in all listed files) + `reference` (anchor + heading survive) modes; inline seed table with a same-commit update ritual. Blocking pre-commit. |
| [`scripts/check-contract-schema.js`](scripts/check-contract-schema.js) | Drift gate reconciling `scripts/resolve-review-loop.sh` against the canonical `schemas/review-loop-contract.schema.json` SSOT (shell field-set + enum parity). Asserted in `hooks/tests/contract-parity.test.sh`. |
| [`scripts/check-disjointness.sh`](scripts/check-disjointness.sh) | `/l4 /l5` width-fan-out file-disjointness gate: `validate` (authoritative post-commit, git artifacts — never agent self-report — vs the declared per-unit `Scope:` allowlist + regex-ownable denylist, fail-closed) / `propose` (advisory pre-dispatch). **FILES ONLY** — certifies files, not behavior; semantic coupling stays the depth-0 reviewer's. |
| [`scripts/check-test-integrity.sh`](scripts/check-test-integrity.sh) | Anti-gaming test-integrity gate. L0: git-artifact diff checks (test-path additions-only, skip-marker denylist, rename escape, surface touch; config read from the TRUSTED base ref). L1 (additive): `executed_set_shrink` runs collectors on base↔head worktrees; block-mode override ALWAYS DEFERRED (containment unlock reverted UNSAFE). Engine: [`scripts/lib/test-integrity-l1.py`](scripts/lib/test-integrity-l1.py); spec: `docs/projects/_archive/2026-06-26-test-integrity-l1/design-spec.md`. |
| [`scripts/resolve-doa.sh`](scripts/resolve-doa.sh) | Role/model-tier → DOA preset JSON (four-tier action table); consults the project override config else `project-config-template/doa-config.md`. Unknown role/tier → all-escalate fail-closed. |
| [`scripts/resolve-qc-gate.sh`](scripts/resolve-qc-gate.sh) | Per-project anti-skip qc-gate strength → JSON `{mode, protected_paths, evidence, source}`; garbage/missing → `block` fail-closed. Consumed by `.githooks/pre-push` + finish-flow's merge step. Sibling-of-DOA: DOA governs dispatch authority, qc-gate governs merge/push review. |
| [`scripts/engine-scorecard.js`](scripts/engine-scorecard.js) | Node append-only JSONL scorecard store + query engine: `record` / `current` / `report` / `ladder` (decorrelation soft penalty); rows accept an optional `effort` for invocation-tuple calibration. Consumed by `engine-qualify.sh` + `resolve-review-loop.sh --check-scorecard`. |
| [`scripts/engine-capability-state.js`](scripts/engine-capability-state.js) | Engine capability-state store (append-only JSONL under `~/.autopilot/engine-capability/`): `record`/`current`/`report`/`prune`/`classify-error`; schema-strict, UTC-required, `unknown` never clobbers a valid signal, `skill_transport` merges per field. Consumed by dispatch passive capture + `resolve-review-loop.sh --capability-state`. |
| [`scripts/probe-engine-capability.sh`](scripts/probe-engine-capability.sh) | Safe runner-availability probe: `--safe` checks only binary/version/auth surface (no model prompt, no spend); explicit `--live-spend` sends a tiny read-only prompt (scratch cwd, NO skip-permissions/always-approve). Never claims support it didn't test. |
| [`scripts/bench-engine-capability.sh`](scripts/bench-engine-capability.sh) | Skill-transport bench distinguishing NATIVE skill loading from PROMPT-PACK obedience (`evals/engine-capabilities/`); `--dry-run` vs operator-gated `--live-spend`; records only the dimension actually tested. |
| [`scripts/engine-qualify.sh`](scripts/engine-qualify.sh) | Reviewer Stage-1 qualifier: wraps `calibration.sh run-known-bad`, computes the pass bar (`false-pass-on-critical=0`, sensitivity, specificity); `--emit-row` PRINTS a scorecard row — persisting is a separate explicit `engine-scorecard.js record` step. |
| [`scripts/dispatch-anthropic-review.js`](scripts/dispatch-anthropic-review.js) | Direct HTTP Anthropic-compatible reviewer for `dispatch-review.sh --runner anthropic-compatible`: `/v1/messages`, env-only auth, redacted raw logs, timeout/body-cap fail-closed, shared review-result JSON schema. |
| [`scripts/dispatch-review.sh`](scripts/dispatch-review.sh) | **READ-ONLY** heterogeneous reviewer dispatch — sibling of the write-oriented `dispatch-hetero.sh`: feeds a diff as TEXT in the prompt (`--runner codex\|agy\|grok\|cc-shim\|anthropic-compatible\|claude-native\|qoderclicn`) and parses a `VERDICT:` for the disjoint-family `qc_panel`. Local CLI reviewers are read-INTENT only, **NOT a hard OS sandbox** — review genuinely-untrusted diffs on a disposable host. EMPTY/unparseable capture ⇒ `status:no_verdict`, exit 1, FAIL-CLOSED. Engine picking: [`references/hetero-dispatch.md`](references/hetero-dispatch.md) § Wired engines. |
| [`scripts/dispatch-explore.sh`](scripts/dispatch-explore.sh) | **READ-the-repo** heterogeneous dispatch (third sibling): the engine reads the trusted repo and answers grounded. Fail-loud read probe (sentinel token must be echoed, else `read_failed` and the guessed body is withheld) + before/after `git status` snapshot (`explored_dirty` on any write). Recipe: [`references/hetero-dispatch.md`](references/hetero-dispatch.md) § Reading the repo. |
| [`scripts/resolve-review-loop.sh`](scripts/resolve-review-loop.sh) | Per-project review-loop engine roster + loop policy → JSON (engines/efforts/runners, loop caps, `qc_panel` + `union-on-verified-critical` aggregation, risk-tiered depth, declarative endpoints, `on_family_conflict` fallback ladder). The point is **decorrelation**: the reviewer is a DIFFERENT family from the generator; `qc_panel` is the authoritative depth-0 terminal gate. Garbage enums → safe defaults; fallback guards fail closed; `--enforce` opt-in hard gate. Design: [`docs/plans/2026-06-26-trust-tiered-review-policy.md`](docs/plans/2026-06-26-trust-tiered-review-policy.md). |
| [`scripts/measure-task-width.sh`](scripts/measure-task-width.sh) | Portable `/l4 /l5` task-supply probe: depth × churn-threshold sensitivity matrix of how many recent tasks split into file-disjoint units; emits `confidence` (low ⇒ don't trust). Upper bound only (file-disjoint ≠ semantically independent). `--json`. |
| [`scripts/task-width-fleet.sh`](scripts/task-width-fleet.sh) | Fleet layer over the probe: `scan` every repo under roots → per-repo JSONL (+ optional POST to an ingest endpoint); `aggregate` dedups by remote and gates only over `confidence==ok` repos. |
| [`scripts/task-width-ingest.py`](scripts/task-width-ingest.py) | Zero-dependency stdlib inbox for fleet task-width data (`POST /submit` / `GET /report` / `GET /raw`; optional `X-Token` auth). |
| [`scripts/calibration.sh`](scripts/calibration.sh) | Panel verdict calibration store: `add-sample` / `report` (agreement, false-pass-on-critical, graduation) / `run-known-bad` (`evals/known-bad/`) / `run-clean-set` (over-flag specificity gate, fail-closed). |
| [`scripts/qc-panel.js`](scripts/qc-panel.js) | QC interrogation panel (P4): 2 judges × 3 question shapes over a node report; deterministic merge + synthesizer → `{verdict, dissents, extras}`; every run MUST write artifact AND append a calibration sample. Shadow-wired into `skills/quality-pipeline/` (tree-conditional). |
| [`scripts/run-eval-batch.sh`](scripts/run-eval-batch.sh) / [`run-skill-opt.sh`](scripts/run-skill-opt.sh) | Eval harness; see `evals/`. |
| [`scripts/toggle-payload-capture.js`](scripts/toggle-payload-capture.js) | Hook payload capture (Tier B diagnostic — see hooks gotchas). |
| [`scripts/doc-drift-gate.js`](scripts/doc-drift-gate.js) + [`scripts/test-doc-drift-gate.sh`](scripts/test-doc-drift-gate.sh) | Layer-1 deterministic doc↔code gate（links / fences / script-refs；`skills/doc-sync` 的 stopping condition；`scripts/...` 以被稽核 repo root 解析，支援 `--repo-root`）＋ consuming-repo root 回歸測試。 |
| [`scripts/classify-diff-risk.sh`](scripts/classify-diff-risk.sh) | Diff → risk-tier 分類（engine `implement-review` 的 review_risk 輸入之一）。 |
| [`scripts/check-loop-convergence.js`](scripts/check-loop-convergence.js) | Loop-convergence 煞車（連續零執行輪 / generation cap 仍 REWORK ⇒ halt+escalate）；/l4-/l6 depth-0 clock owner 的機械閘。 |
| [`scripts/check-escalation-coverage.js`](scripts/check-escalation-coverage.js) / [`scripts/rubric-freeze.js`](scripts/rubric-freeze.js) | Loop-convergence-gates 專案配套：escalation 出口覆蓋檢查 / rubric 凍結（防 mid-run 改分規）。 |
| [`scripts/probe-mutation.js`](scripts/probe-mutation.js) | Mutation-validated probe 執行器（`adjudicate-findings.js` refute 路徑的機械後盾）。 |
| [`scripts/resolve-worktree-teardown.sh`](scripts/resolve-worktree-teardown.sh) | Worktree teardown policy resolver（`scripts/lib/worktree-reap.sh` 消費）。 |
| [`scripts/install-opencode.sh`](scripts/install-opencode.sh) / [`scripts/sync-opencode-plugin.sh`](scripts/sync-opencode-plugin.sh) | OpenCode 接入：安裝 / plugin payload 同步（`dev-setup.sh` 消費）。 |

All scripts respond to `<script> --help`. JSON-emitting scripts have stable schemas; exit codes follow each script's header.

## When adding a new script

If you replace an LLM-judgment step with a script, **wire it in**:
1. The reference doc (`skills/quality-pipeline/references/*.md` or equivalent) — describe what the script does and when to call it.
2. The relevant `SKILL.md` — add a row to its "Available Scripts" table (if it has one) or reference inline.
3. This file's inventory table — keep alphabetical-by-purpose grouping.

Without all three, the script is dead code: future sessions won't discover it.

**Row shape rule**: an inventory row is an index entry — what it does, when to call it, and a pointer to the canonical detail. Do NOT append per-release behavior notes, flag inventories, or incident lore to a row when shipping a change; that history belongs in `CHANGELOG.md` (release ritual already requires it) and the details in `references/` or the script header. `check-claude-md-inventory.js` enforces a per-line byte cap and a whole-file cap so this file never regrows past the harness 40k warning threshold.

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
