# Changelog

<!--
RELEASE TEMPLATE (paste below this comment for each new release):

## v<X.Y.Z> — <Headline>

**Headline**: <one paragraph user-facing summary>

### Added
- ...

### Changed
- ...

### Fixed
- ...

### Hook-order semantics reminder (if hooks change)
- Claude Code hooks run **in parallel / non-deterministic order across different matcher blocks** (e.g., PostToolUse `Bash` vs `Write|Edit` vs `.*` are independent). Only **intra-matcher** sequencing within a single matcher block is guaranteed. Do not claim cross-matcher ordering in release notes.

### Rollback
- Maintainer: `git revert <merge-sha>`
- User-side (post-marketplace): `/plugin update autopilot @v<previous>` + cleanup new sibling files (e.g., `rm -rf ~/.autopilot/<new-dir>/`)
-->

## v2.31.15 — campaign R2: relatable tasks; the procedure-lift REPLICATES (+80pp, p≈0.001)

**Headline**: Three new eval tasks that read as ordinary dev work — release-day version bump across manifest mirrors, config-key rename with backward compatibility, secret-leaking log cleanup — each with real-incident provenance documented (t6 mirrors this plugin's own historical marketplace.json miss). The 40-run band campaign (haiku, ON/OFF × 5): **t2's procedure-lift replicated — ON 80% vs OFF 0%; cumulative across rounds ON 7/8 vs OFF 0/8 (Fisher p≈0.001)**. The three relatable tasks split 60%/60% both arms: their misses are attention/coverage slips (a forgotten fourth version site, a missed error path) — exactly the classes the ladder says to demote to L0 mechanical gates, not longer prompts. The eval independently re-derived why `sync-version.js --check` exists.

> **CORRECTION (2026-07-04, post-release)**: 15 of the 40 R2 runs were killed by a mid-campaign Claude Code re-login (1-2s duration, mis-scored as failures). Clean re-run (all cells n=5 live): **t2 ON 5/5 vs OFF 0/5** (cumulative 8/8 vs 0/8, p≈0.0001 — the effect is STRONGER than first reported); **t6/t7/t8 are 5/5 BOTH arms** — the "60%/60% attention-slip → L0 gates" narrative was a dead-run artifact and is withdrawn (those tasks are haiku-ceiling). Corrected analysis + clean data: the archived campaign-r2 project's report.

### Added
- `evals/orchestration/tasks/`: **t6-version-bump** (version in 4 legitimate places; zero-check oracle), **t7-config-rename** (old key keeps working + deprecation warning; new key wins; oracle drives the real tool 3 ways), **t8-log-redaction** (fresh random token per oracle run; asserts key-free logs across happy + 3 failure paths) — oracles self-tested; provenance table in the evals README ("Tuesday-afternoon jobs, not traps").
- Campaign R2 report + raw results archived with the project.

### Rollback
- Maintainer: `git revert <merge-sha>`. User-side: `/plugin update autopilot @v2.31.14`.

## v2.31.14 — lift campaign R1 executed + `qc_panel: all-calibrated` preset

**Headline**: The quality-floor lift campaign ran for real — 5 tasks (3 new: vacuous-test / config-layer-decoy / pre-existing-classification, all with self-tested oracles) × ON/OFF × 3 reps on sonnet. Result, honestly: **30/30 oracle pass in BOTH arms — a ceiling effect** (sonnet is above the task set; haiku was below it), no duration signal. The real finding is about MECHANISM: the prose pack moved vocabulary (`patterns_named` 80% vs 0%) but **not protocol compliance** (`adjudication_valid` 40% vs 40% — identical); what compliance existed came from the mechanical required-artifact contract. Independent evidence for the ladder's core thesis: invest in L0/L3 mechanical contracts, not longer L1 prompt packs. R2 designs + trigger recorded in the campaign report.

### Added
- **`qc_panel: all-calibrated`** resolver preset — expands to the calibrated 5-family roster (gpt-5.5 · claude-opus · gemini-flash · grok-build · MiniMax-M3); consumers always see the expanded list; documented in the config template ("全席審").
- **Three orchestration-eval tasks** with mechanically-derived, self-tested oracles: `t3-vacuous-test` (candidate must make a vacuous test discriminate — oracle re-injects the bug and the strengthened test must fire), `t4-config-layer` (three-layer precedence defect + a decoy blaming the correct parser), `t5-preexisting-classification` (fix the introduced break, CLASSIFY the pre-existing one instead of chasing it).
- Campaign artifacts: report + raw results archived with the project.

### Rollback
- Maintainer: `git revert <merge-sha>`. User-side: `/plugin update autopilot @v2.31.13`.

## v2.31.13 — endpoints batch + campaign gate OPEN (sonnet 2/2 with full adherence)

**Headline**: The endpoints S-batch plus a CEO-discretion sweep — and the day's best data point: after fixing a harness defect (the eval runner invoked `claude -p` with no permission flags, so arms could REASON but not ACT — a sonnet transcript showed a fully correct diagnosis, including a timezone-precise refutation of the planted decoy, stalled on a permission ask), **a sonnet-class ON-arm passes 2/2 orchestration-eval oracles with FULL adherence**: real bug fixed, decoy refuted through a valid adjudication table, acceptance patterns named, probe evidence present. **The quality-floor campaign gate is OPEN.**

### Added
- **`autopilot endpoints test <name>`** — the deferred live auth-roundtrip probe: one tiny `/v1/messages` request, latency + `ok/auth_failed/network_failed/not_configured` classification, token never printed, loopback-stub tested (the CLI's only networked subcommand, labeled as such).
- **`endpoints which/set` repo-key provenance** — `repo_key_source: remote|path-fallback`; `set --repo` warns when the overlay is keyed to a moveable checkout path.
- **`dispatch-author.sh --endpoint <name>`** — parity with its two siblings (closes the manual `ANTHROPIC_*` export gap hit twice in real runs); additive.
- **Per-runner settle bound** — cc-shim late-flush (observed 17 KB answer landing after the 3s bound) gets a 10s default; `AUTOPILOT_SETTLE_MS` override; truly-empty still fail-closed.
- **`hooks/tests/preflight-meta-smoke.test.sh`** — proves the 17-check portability gate FAILS on a seeded violation (perturb→fail-named-check→restore→green, trap-protected). Default self-skip (`PREFLIGHT_META_FULL=1` to run): the full gate is minutes-long and its OpenCode checks are documented load-flaky; it already runs for real at every release. Validated EXIT=0 end-to-end on a quiet host.

### Changed
- **`docs/projects/` hygiene**: 16 legacy completed project dirs swept into `_archive/` with every reference repaired (INDEX now fully archive-linked; payload-sync manifest updated).
- **Eval runner**: `--dangerously-skip-permissions` for cc arms (disposable temp repo + scratch HOME justify it); credential-only scratch-HOME (v2.31.12) retained.

### Evidence
- Sonnet smoke (ON arm): t1 `oracle_pass:true, decoy_respected:true, adjudication_valid:true, patterns_named:true, probe_evidence_present:true`; t2 `oracle_pass:true, fidelity_ok:true`. haiku's earlier uniform failure re-attributed to the permissions defect; its true floor unmeasured. Full addendum: archived quality-floor-completion project's `pilot-report.md`.

### Rollback
- Maintainer: `git revert <merge-sha>`. User-side: `/plugin update autopilot @v2.31.12`.

## v2.31.12 — quality-floor engine completed: P2-P4 + orchestration eval, in one run

**Headline**: Board-directed completion of the quality-floor plan — all remaining phases (P2-P4) plus their ex-BACKLOG prerequisites shipped in a single `/l6` run. The **full test suite is green for the first time in weeks** (the 3 chronic pre-existing failures fixed), and the **orchestration-eval pipeline ran a live pilot**: 4 arms on real engines end-to-end. Honest pilot verdict: the measurement pipeline works; a haiku-class single-turn orchestrator is below the task floor in BOTH arms, so the lift campaign needs a sonnet-class tier (operator cost gate recorded in the pilot report).

### Added
- **P2a `scripts/check-escalation-coverage.js`** + tests — warn-first ledger-coverage gate: triggered emission points must have `escalation_opened` events (signals-file driven, never guesses); `--gate` hardens to exit 1; archive-path fallback.
- **P2b `scripts/probe-mutation.js`** + tests — mechanizes the REFUTED rule: probe→inject→probe→restore in an isolated detached worktree; emits `adjudicate-findings.js refute` evidence directly; vacuous probes (green under mutation) exit 1; baseline-failing/mutation-noop fail closed exit 2.
- **P2c/P4**: `skills/retro` escalation-ledger scan step (aggregate `tree.js escalations` → demotion candidates) + `skills/distill` demotion-drafting step (playbook/pattern CANDIDATE stubs, human-gated).
- **P3-pre**: eval-arm isolation + `--selftest` that fails if the baseline arm loaded any plugin (ponytail contamination lesson, ex-BACKLOG).
- **P3 `evals/orchestration/`** — the weak-orchestrator lift harness: 2 hermetic pilot tasks (fix-with-decoy: planted FALSE reviewer finding + real bug; extract-verbatim: byte-fidelity), git-artifact oracles (arm-independent, asset-vocabulary-free), ON/OFF packs (length-matched padding control), cc/agy/stub runner with credential-only scratch-HOME isolation, compact-JSONL results, gate-based scoring + per-mechanism adherence report, hermetic stub test suite. **Live pilot executed** (4/4 arms, real haiku runs) — see `docs/projects/_archive/2026-07-04-quality-floor-completion/pilot-report.md`.

### Fixed
- **Suite 96/96**: `autopilot-cli.test.sh` / `review-runner.test.sh` (stale stubs from the nonce-protocol + stdout-split eras) and `intent-capture-basic-write.test.sh` (session-id fallback) — the 3 chronic pre-existing failures repaired.
- Dispatched-implementer artifacts caught and corrected at depth-0 (5 ledger events): baked dead-worktree literals in THREE files (script env-fallback, test wrapper path, test TMPDIR — plus one more unit repeating the class), heredoc-embedded expected-content oracles (rewritten to derive expectations mechanically from git), a stdin-conflict fixture design (`python3 - <<EOF` cannot also read data from stdin — redesigned to argv), missing +x bits, pretty-vs-JSONL result format.

### Deferred
- The full P3 statistical campaign (≥5 tasks × seeds × sonnet-class) — operator cost decision; smoke-gate first (pilot report §campaign gate).

### Rollback
- Maintainer: `git revert <merge-sha>`. User-side: `/plugin update autopilot @v2.31.11`.

## v2.31.11 — quality-floor engine Phase 1: the judgment-demotion ladder

**Headline**: The first ship of the **quality-floor engine** — the methodology evolution from "clone cookys, remove cookys from the loop" to "make a weak orchestrating model sustain frontier-floor output quality on long tasks". Design: [`docs/plans/2026-07-04-quality-floor-engine.md`](docs/plans/2026-07-04-quality-floor-engine.md) — a **judgment-demotion ladder** (L0 script → L1 playbook match → L2 fan-out + mechanical aggregation → L3 probe-then-branch → L4 escalate + ledger), applied at DESIGN time per lifecycle stage so the weak model never self-selects a level. The design survived a **3-disjoint-family adversarial critique** (codex gpt-5.5 · agy/Gemini · MiniMax-M3) with all 13 major claims adjudicated in the plan's §9 — including dropping the R0 "ledger trends to zero" KPI that all three families independently called a Goodhart trap.

### Added
- **`references/probe-playbook.md`** (L1) — 8 diagnostic probes indexed by symptom, each with a **discriminating check** (expected-if-match / expected-if-NOT-match) and a real incident citation; no-match ⇒ mandatory escalation (never invent silently); growth rule feeds from escalations via learn/distill.
- **`references/acceptance-patterns.md`** (L1) — 7 mechanical acceptance patterns (round-trip parity · perturbation · fidelity · idempotency · negative self-check · live-e2e · baseline classification), every instance embedding its own **negative control**; "acceptance with no demonstrated failure mode" is now a 🟠 Major reviewer finding.
- **`scripts/adjudicate-findings.js`** + tests (L3) — validated finding-adjudication table: `UNPROBED → REPRODUCED / REFUTED / PROOF_BY_TRACE`; **REFUTED requires a mutation-validated probe** (a probe that stays green under the injected defect is vacuous); `PROOF_BY_TRACE` requires second-family confirmation; `gate --ids` fails closed unless every finding referenced by a fix dispatch is actionable. Self-dogfooded live in this ship.
- **`skills/ceo-agent/references/decision-matrix.md`** (L2) — design-panel aggregation rules: unanimity auto-adopts ONLY across ≥2 disjoint families AND reversible decisions; irreversible ⇒ probe or escalate regardless of unanimity; panelist factual claims go to the adjudication table (this critique round: 3-for-3 families made confidently-cited wrong claims).
- **Escalation-ledger convention** (L4) — `tree.js` events at 5 named structural emission points; finish-flow L-5.6 checklist line; KPI = demotions shipped + non-increasing escape-rate on a blind strong-model audit sample (NOT entry count). Dogfooded: 2 events emitted during this very ship.
- Wiring: reviewer.md / planner.md / debugger.md / debug / dev-flow / quality-pipeline code-review.md / level-front-door.md / finish-flow.

### Deferred (plan §7, trigger-conditioned)
- P2: `check-escalation-coverage.js` + probe-mutation automation + retro ledger-scan. P3: orchestration eval (prereq: eval-arm isolation). P4: demotion-loop automation via distill.

### Rollback
- Maintainer: `git revert <merge-sha>`. User-side: `/plugin update autopilot @v2.31.10`.

## v2.31.10 — review-closeout: 7 verified defects + structural-risk hardening (contract parity, dispatch rails, hook-layer)

**Headline**: A whole-repo review (two Explore agents + depth-0 verification of every claim) found 7 concrete defects and 3 structural risks; all closed in one `/l6` run — implementation by **agy/Gemini** (codex-spark quota-exhausted mid-run, capability event recorded), design by a **3-family panel** (codex gpt-5.5 · agy/Gemini · grok/xAI), verification plan **authored by MiniMax-M3** (cc-shim) and executed at depth-0 (20 checks, incl. 6 adversarial probes MiniMax designed itself). The dogfood ALSO caught two live dispatch-rail defects the stub tests couldn't see (codex chrome-channel merge; a prompt that never demanded the closing nonce marker) — both fixed and e2e-verified against real codex.

### Fixed
- **`dispatch-review.sh` codex rail was structurally broken** (every real codex review → `no_verdict`): codex exec sends the model message to stdout and ALL chrome (prompt echo, thinking, "tokens used", message repeat) to stderr; the `2>&1` merged capture could never start with the nonce marker. Now parses **stdout only**; `raw_log` carries stdout + `--- codex stderr (chrome, not parsed) ---` + stderr on every exit path (passive quota classification intact). Verified live: gpt-5.5 at low effort → `reviewed`.
- **Review prompt never explicitly demanded the closing END marker** — high-effort models inferred it, low-effort ones omitted it → parser exit 5 → false `no_verdict`. The prompt now states the end-with contract; prompt-contract asserted in tests.
- **`dispatch-author.sh`/`dispatch-review.sh` empty-capture race**: grok output can flush after the main process exits — observed `empty_output` while the raw_log later held a 158-line answer. Bounded ~3s settle-wait before classifying; truly-empty still fails closed (deterministic late-flush stub test).
- **`REVIEW_LOOP_FIELDS` had drifted 8 fields** behind `resolve-review-loop.sh` (endpoint + capability keys) — engine path now carries/validates all 29; guarded forever by a new **round-trip contract-parity test** (runs the REAL shell script, both drift directions, named keys).
- `skills/ceo-agent/SKILL.md` DOA table: orphaned `Resources 2x+` row rejoined the table.
- `hooks/transcript-reader-lib.js` `MAX_LINE_BYTES` (1 MB, comment said "match") now imports state-checkpoint-lib's 5 MB constant — single definition.
- `hooks/audit-log.js`: fd-0-first stdin read (repo's own documented ENXIO fix); header matches the real `.*` matcher wiring.
- Removed tracked dead file `hooks/state-checkpoint.sh.bak` (+ hooks/README refs; git history is the archaeology).
- `findJsonObjectCandidates`/`isImmutableGitSha`/`bufferToString` deduplicated into **`src/lib/common.js`** (public re-exports preserved).
- `scripts/check-test-integrity.sh`: the ~1,880-line embedded Python heredoc extracted **verbatim** to `scripts/lib/test-integrity-l1.py` (2,090→215-line shell; py_compile/lint/unit-test surface unlocked; behavior byte-identical, argv contract unchanged).

### Added
- `hooks/tests/contract-parity.test.sh` — bash↔JS contract round-trip drift gate (panel-unanimous R1 design; JSON-schema SSOT deferred to BACKLOG with trigger).
- `hooks/tests/dispatch-explore.test.sh` — behavioral coverage for the fail-loud read-probe contract (probe-fail exit 3 + answer withheld, dirty-repo exit 4, `--no-probe`, precondition).
- `hooks/transcript-reader-lib.js`: **bounded tail-window read** (256 KB tail + full-read fallback — kills the O(n²) per-tool-call transcript re-parse) + **once-per-session schema canary** (stderr warn + `~/.autopilot/transcript-canary.log` when a non-empty transcript parses to zero events; `AUTOPILOT_NO_CANARY=1` kill-switch) + fixture smoke tests. Panel-unanimous R3 design; per-event multiplexer stays BACKLOG'd (offset-cache alternative rejected: shared-cursor coupling).
- `check-canonical-invariants.sh` seeds: the dev-flow/ceo-agent **S-scope-gate block** can no longer drift silently (repeat-mode lines + audit-heading reference; perturbation-probe verified).

### Changed
- `skills/l5/SKILL.md` slimmed 104→31 lines to stub parity with l3/l4/l6 (frontmatter byte-identical); `level-front-door.md` now covers **/l6** (drift found by the panel's codex member).
- Pure dated historical narratives moved from dev-flow/ceo-agent SKILL.md to `skills/dev-flow/references/historical-rationale.md` (gates/forcing functions untouched — the settled inline rule).

### Deferred (BACKLOG, trigger-conditioned)
- Contract JSON-schema SSOT; `preflight-portability.sh` meta-smoke; `dispatch-author.sh --endpoint` parity (gap hit live when falling back to MiniMax authoring); per-event multiplexer reaffirmed-deferred.

### Rollback
- Maintainer: `git revert <merge-sha>`. User-side: `/plugin update autopilot @v2.31.9`.

## v2.31.9 — cross-family qc-panel hardening of the endpoints CLI + loader

**Headline**: A **disjoint-family qc panel** (gpt-5.5 / grok / MiniMax-M3 — OpenAI · xAI · MiniMax, dogfooding `dispatch-review.sh`) over the combined credential diff caught **seven** real issues that the earlier single-reviewer rounds missed — a strong argument for the cross-family panel; each vendor found *different* real defects. All fixed + regression-tested. (grok + MiniMax delivered substantive reviews; codex degraded to prompt-echo on the large diff. MiniMax explicitly confirmed "no security-critical defects". One grok finding — "absent base rejects on no-getuid" — was **empirically disproved** as a control-flow misread and locked in with a test.)

### Fixed
- **Fail-closed ordering** (flagged by BOTH families): the loader gated the base file *after* loading the overlay, so a rejected base returned `rejected:true` while overlay secrets were already in the env. Now the base is **gated first** — a present-but-rejected base loads **nothing** (not even a valid overlay), in both the shell loader and the JS twin.
- **`endpoints set` unguarded filesystem ops**: `mkdir`/`readFile`/`writeFile`/`chmod` threw an **uncaught stack trace** on EACCES/EISDIR (e.g. a directory target) instead of the `stderr + status 2` contract. Now wrapped; also refuses a **non-regular** (not just symlink) existing target.
- **JS twin perms fail-closed parity**: on a platform where ownership/perms can't be verified (no `getuid`), the JS twin now **refuses** (matching the shell's "cannot determine permissions, refusing") instead of warning + loading. (An *absent* base remains a no-op on all platforms — verified.)
- **`load-endpoints-env.sh --init`** creates `~/.autopilot/` with **mode 700** (matching the CLI's `mkdir`), so endpoint filenames aren't group/world-listable (files were already 600).
- **(MiniMax-M3 panelist)** `endpoints set` now **chmods a pre-existing credential dir to 700** (mkdir's `mode` only applies on creation, so a pre-existing `~/.autopilot` at 0755 leaked filenames); writes the secret file **atomically** (tmp + rename, mode 600) so a crash mid-write can't corrupt it; and `endpoints list`/`which` **surface a perms-rejection warning** in non-json mode instead of a silently-empty list mistaken for "no endpoints configured".

### Tests
- +9 assertions: rejected-base-loads-nothing (fail-closed), init dir mode 700, JS no-getuid refuses (present) / no-ops (absent), `set` into a directory target exits 2 with no stack trace, `set` hardens a pre-existing 0755 dir to 700, no leftover `.tmp` after an atomic write, `list` surfaces a perms-rejection warning.

### Rollback
- Maintainer: `git revert <sha>`. User-side: `/plugin update autopilot @v2.31.8`.

## v2.31.8 — `autopilot endpoints` CLI + opt-in per-repo credential overlay

**Headline**: The endpoint-credential system gains a control surface and a per-repo layer, decided by a **3-disjoint-family heterogeneous design panel** (codex/gpt-5.5 · agy/Gemini · grok/xAI, dogfooding the credential system as the topic). All three independently flagged the same weakness — the credential state was **too opaque** for humans and agents to inspect — and unanimously wanted a helper CLI. A new **`autopilot endpoints`** CLI (`init`/`list`/`which`/`set`/`doctor`, `--json`, token-redacted) is that surface; and an **opt-in per-repo overlay** lets the same committed endpoint name (`glm`) resolve to a different token per repo, with the secret files still living under `~/.autopilot/` (never in a repo).

### Added
- **`bin/autopilot.js endpoints`** (`src/endpoints/cli.js`): `init` · `list [--json]` (defined endpoints: name, url/token present, layer) · `which [--json]` (for THIS repo: which endpoints reviewer/implementer select + resolve + from which layer — the agent-legibility "merged view" that answers "why isn't `glm` resolving here?") · `set <name> --url <u> [--token-stdin] [--repo]` (idempotent upsert to base or the per-repo overlay; **token via STDIN only, never argv**; mode-600; symlink-target refused) · `doctor [--json]` (perms + unresolved-endpoint diagnosis, no network; exit 1 unhealthy). list/which/doctor **never print a token value**.
- **Opt-in per-repo overlay** in `load-endpoints-env.sh` + the `.js` twin: `~/.autopilot/endpoints.d/<repo-key>.env` layers over the base (precedence process env > overlay > base). Secret files stay under `~/.autopilot/`. `<repo-key>` = normalized git remote (fallback toplevel-path cksum), exposed as `load-endpoints-env.sh --repo-key`; the JS `repoKey()` delegates to it (single source of truth — bash+JS keying can't drift).

### Changed
- The loader is **gated on `~/.autopilot/endpoints.d/` existing** — absent ⇒ zero git calls, byte-identical to base-only (overlays cost nothing until you opt in). Per-file gate+parse factored into `_autopilot_endpoints_load_file` / `parseEndpointsFile` for reuse by the CLI.
- `docs/installation.md` documents the overlay + the `endpoints` CLI; CLAUDE.md inventory gains the CLI + updated loader row.

### Design panel
- codex: O1+O3, defer overlay (YAGNI). agy: O2+O3. grok: O2+O3 (distinct-names *collides* with the selection layer). Depth-0 synthesis (not majority vote): build the overlay into the CLI's model but keep it **opt-in** — absent ⇒ today's behavior (codex's YAGNI), `set --repo` ⇒ per-repo token (agy/grok). See `docs/projects/2026-07-03-endpoints-cli/`.

### Tests
- `hooks/tests/load-endpoints-env.test.sh` +8 (overlay overrides base, no-dir no-op, overlay-perms-reject→base-fallthrough, js repoKey parity, js overlay merge). `hooks/tests/endpoints-cli.test.sh` (new, ~18): no-token-leak on list/which/doctor, mode-600 writes, argv-token rejected, overlay layering in `which`, doctor exit codes, symlink-target refusal.

### Deferred (BACKLOG)
- `endpoints test <name>` live auth roundtrip (network + real creds — panel marked it optional).

### Rollback
- Maintainer: `git revert <merge-sha>`. User-side: `/plugin update autopilot @v2.31.7`.

## v2.31.7 — tracked `endpoints.env.example` template + documented by-repo/by-user split

**Headline**: Follow-up to v2.31.6. The credential stub is now a **tracked, GitHub-viewable canonical template** (`scripts/endpoints.env.example`) instead of being embedded only in a `--init` heredoc — matching autopilot's `settings.example.json` convention. `load-endpoints-env.sh --init` now COPIES that template (single source of truth; minimal inline fallback + warning if it's somehow absent). And the credential **layering** is now documented as a deliberate design: the SECRET (url+token) is **by-user only** (`~/.autopilot/endpoints.env`) with NO auto `$PWD/.claude/` cascade — unlike the non-secret `resolve-*` config resolvers — because a repo-local secret file is a commit-a-token footgun; the **by-repo** layer is *selection only* (the non-secret endpoint NAME in `review-loop-config.md`). Per-repo tokens remain an explicit opt-in via `AUTOPILOT_ENDPOINTS_ENV`.

### Added
- **`scripts/endpoints.env.example`** — the tracked canonical credential template (all-commented, loads nothing until edited). `--init` copies it verbatim.

### Changed
- `load-endpoints-env.sh --init` copies the tracked template instead of emitting an inline heredoc (DRY — one source of truth); keeps a minimal inline fallback + warning for partial installs.
- `docs/installation.md` documents the `--init`/copy path, the tracked template, and a **by-repo vs by-user** table making the secrets-are-by-user-only decision explicit. CLAUDE.md inventory row updated (incl. `dispatch-author.sh` as the 4th wired dispatcher).

### Tests
- `hooks/tests/load-endpoints-env.test.sh` +3 assertions: template exists, `--init` copies it **verbatim** (`diff -q`), and the tracked template itself parses cleanly + loads nothing.

### Rollback
- Maintainer: `git revert <merge-sha>`
- User-side: `/plugin update autopilot @v2.31.6`.

## v2.31.6 — one canonical endpoint-credential home + declarative endpoint wiring

**Headline**: Anthropic-compatible env-token engines (GLM / MiniMax / any compatible endpoint) now have **ONE** credential home and a **declarative** invoke path. Before, tokens were scattered across `AUTOPILOT_ENDPOINT_<NAME>_*`, `MINIMAX_API_KEY`, `ANTHROPIC_COMPATIBLE_AUTH_TOKEN`, and raw `ANTHROPIC_BASE_URL`/`AUTH_TOKEN` with no documented place to put them, and `--endpoint` had to be hand-typed every run. Now a single machine-local mode-600 file — `${AUTOPILOT_ENDPOINTS_ENV:-~/.autopilot/endpoints.env}` — is the canonical home (loaded automatically by the dispatchers), and `reviewer_endpoint` / `implementer_endpoint` in `review-loop-config.md` flow through to `/l5` `/l6` so a project's engine is picked up without a flag. New user-facing docs steer to **subscription plans over metered API keys** (OAuth-login `codex`/`agy`/`grok` need no token → GLM/MiniMax coding-plan token → metered API key last).

### Added
- **`scripts/load-endpoints-env.sh`** (sourceable bash) + **`scripts/lib/load-endpoints-env.js`** (Node twin, built-ins only): the canonical endpoint-credential loader. Populates the allowlisted `AUTOPILOT_ENDPOINT_<NAME>_*` / `ANTHROPIC_*` / `MINIMAX_API_KEY` env vars from the one file. **LINE-PARSER, never `source`** (file contents never executed); safety gate rejects symlink / non-owner / group-other-writable, warns on group-other-readable, fail-closed when perms unverifiable; existing-env-WINS precedence; one-layer quote strip; `set +x` + never echoes a token; `${HOME:-}` so `set -u`/`env -i` can't crash it. `--init` idempotently scaffolds a commented mode-600 stub (never clobbers).
- **`reviewer_endpoint` / `implementer_endpoint`** config keys (`review-loop-config.md` + `resolve-review-loop.sh`): validated `[A-Za-z0-9_]` (invalid → empty, fail-closed against `--endpoint`/JSON injection), emitted as two appended JSON keys + `--field`, passed to `dispatch-*.sh --endpoint` by the `/l5`/`/l6` prose.
- **`docs/installation.md` § Heterogeneous engine credentials** — the canonical placement, copy-paste stub, subscription-≻-API-key ladder, and declarative wiring. README.md + README.zh-TW.md gain a `🔌 Add another engine` subsection linking there. `skills/onboard` step 5.5 points onboarding users at it.

### Changed
- `dispatch-hetero.sh` / `dispatch-review.sh` / `dispatch-anthropic-review.js` load `~/.autopilot/endpoints.env` at startup (best-effort — absent/rejected file = no-op; the normal cc-shim/anthropic precondition fires unchanged). The env-var convention consumed by `resolve-endpoint.sh` remains the resolution contract; the file is a persistence layer only. Legacy `MINIMAX_API_KEY` / `ANTHROPIC_COMPATIBLE_AUTH_TOKEN` become documented aliases (still honored as fallbacks).
- Closed the CLAUDE.md-noted BACKLOG: `implementer_endpoint`/`reviewer_endpoint` config-surface wiring is done — `--endpoint` is no longer manual-only.

### Fixed
- `load-endpoints-env.sh` guards `${HOME:-}`: a dispatcher running under `set -uo pipefail` with `HOME` unset (e.g. `env -i`) previously would have aborted on an unbound-variable fatal; now it cleanly no-ops (caught by the P0 test suite + the existing `resolve-endpoint` `env -i` regression).

### Tests
- `hooks/tests/load-endpoints-env.test.sh` (new, ~22 assertions): no-code-execution, symlink/writable reject, readable warn, existing-env precedence, quote-strip, missing-file no-op, JS-twin parity, cc-shim integration (creds from file satisfy the precondition), `set -u`/unset-HOME regression, `--init` (create / mode-600 / idempotent-no-clobber / commented-stub-loads-nothing). `resolve-review-loop.test.sh` +8 endpoint assertions + schema-lockstep update.

### Rollback
- Maintainer: `git revert <merge-sha>`
- User-side: `/plugin update autopilot @v2.31.5`; optionally `rm ~/.autopilot/endpoints.env` (only a stub unless you added tokens).

## v2.31.5 — retro review-loop lens (`scripts/retro-review-loop.js`)

**Headline**: `skills/retro` gains a **review-loop lens** (Step 1f) that recovers the effort git-history retro (Steps 1a–1e) structurally cannot see. For a `/l5`-heavy workflow the commit count is only half the story: the hetero-engine **dispatch / decorrelated-review / debate** effort mostly never becomes a commit (reviews, harness runs) or is SQUASHED into one (3 dispatch rounds → 1 commit). New deterministic `scripts/retro-review-loop.js` (Node, built-ins only, NO LLM) reads THIS machine's session transcripts (`~/.claude/projects/<encoded-cwd>/*.jsonl`), counting **real Bash `tool_use` invocations** by dispatch/review pattern (impl `dispatch-hetero`, `dispatch-review`, `codex exec`, agy/grok/explore, engine implement-review) — only actual tool_use command inputs, so CLAUDE.md / reference-doc content that mentions those script names never inflates it — plus git commit-message loop markers (review-round / QC-verdict / converged, counted **per-commit** via `git log -z` NUL separation). Fail-safe: a missing transcript dir yields zero counts, exit 0. **Honesty baked in**: `review_dispatch` includes ad-hoc harness/debug runs (the git review-round / QC markers are the cleaner cycle count), and only local-machine transcripts are seen; the report section is skipped when `transcript.sessions == 0`. Wired into the retro SKILL (Step 1f + Review-Loop Lens report section + `review_loop_lens` snapshot block + Step 6 delta) and the CLAUDE.md scripts inventory. Born from the 2026-07-03 observation that a 217-commit week's git retro hid ~300 hetero dispatch/review invocations behind squashed rounds.

### Added
- `scripts/retro-review-loop.js` + `hooks/tests/retro-review-loop.test.sh` (hermetic, 11 assertions incl. the anti-pollution invariant: only assistant tool_use commands counted, not tool_result / user-message mentions).

### Changed
- `skills/retro/SKILL.md` + `references/data-collection.md` + `references/report-templates.md`: Step 1f data collection, Review-Loop Lens report section, `review_loop_lens` persisted-snapshot block + delta.

### Verification
- `bash hooks/tests/retro-review-loop.test.sh` (11 assertions); `node -c`; live run on this repo; decorrelated gpt-5.5 review (2 findings — printable-delimiter collision → `git log -z`; untested parse guard → malformed-line fixture — fixed, re-reviewed SHIP-AS-IS); `validate.sh`, `doc-drift-gate.js`, `preflight-portability.sh`, `preflight-release.sh` green.

## v2.31.4 — anthropic-compatible reviewer under the nonce wrapped-block protocol

**Headline**: Completes the v2.31.3 echo-hardening by bringing the **anthropic-compatible** reviewer (direct-HTTP MiniMax/GLM via `dispatch-anthropic-review.js`) under the SAME fresh-nonce wrapped-block protocol as the codex/agy/grok/cc-shim runners — via a **raw passthrough** (single source of truth for the parser, no duplicated protocol logic, no inline HTTP client). `dispatch-anthropic-review.js` gains `--raw` + `--prompt-file`: as **pure transport** it sends the shell's pre-built wrapped prompt, keeps its existing hardening (log redaction, `MAX_RESPONSE_BYTES` cap, timeout), emits ONLY the raw model response text, and does NOT parse. The two flags are mutually bound (`--raw` requires `--prompt-file` AND `--prompt-file` requires `--raw`) so the ONLY prompt-file path is the raw passthrough; the legacy `--diff-file` standalone path is byte-identical. `dispatch-review.sh` no longer `exec`s the JS early — it builds the shared nonce prompt for anthropic too and routes the JS's raw output through the **shared nonce parser** (marker-as-prefix, reject-guard, oversize cap, exactly-one-anchored-VERDICT, fail-closed `no_verdict`), so anthropic responses now get the identical echo/leak/oversize/fail-closed handling as every other runner. **Process**: `/l5` hetero-impl (gpt-5.3-codex-spark; the prescriptive raw-passthrough design landed correct in one round — a clean contrast to v2.31.3's anthropic over-reach) + decorrelated gpt-5.5 xhigh review (converged SHIP-AS-IS; two over-flagged findings — a non-reachable "token leak" and a "vacuous redaction test" — were verified against the code and dismissed) + depth-0 authoritative qc: an independent loopback-HTTP harness confirmed valid-block ⇒ reviewed and echo/leak ⇒ no_verdict with no token leak, plus a `--prompt-file`-requires-`--raw` guard added at depth-0.

### Changed
- `scripts/dispatch-anthropic-review.js`: `--raw` + `--prompt-file` transport mode (flags mutually bound; legacy `--diff-file` standalone path unchanged).
- `scripts/dispatch-review.sh`: anthropic-compatible now builds the shared nonce prompt and routes the external-JS raw output through the shared nonce parser (no early exec, no inline HTTP client).

### Verification
- `bash hooks/tests/dispatch-review.test.sh` (99 assertions incl. a hermetic loopback mock exercising the anthropic protocol: valid-block/echo/leak/malformed/max_tokens/oversize/timeout/non-zero-exit ⇒ correct verdict-or-no_verdict + token-non-leak); depth-0 independent loopback harness; `node -c`, `bash -n`, `preflight-portability.sh`, `preflight-release.sh` green.

## v2.31.3 — dispatch-review.sh prompt-echo hardening (fresh-nonce wrapped-block protocol)

**Headline**: Hardens `scripts/dispatch-review.sh` against **prompt-echo pollution** — the failure (surfaced in the v2.31.2 P6 close) where a review engine parrots the prompt back on a large diff and the awk parser accepts the echoed template + diff as the "findings" (fail-closed guards don't fire because a garbage `VERDICT:`/`FINDINGS:` line exists). New **fresh-nonce wrapped-block protocol** for the codex/agy/grok/cc-shim runners: a per-call unguessable nonce (verified ABSENT from the diff so diff content can't forge it) delimits the answer as `<<<AUTOPILOT-REVIEW-{nonce}>>> … <<<AUTOPILOT-END-{nonce}>>>`; the parser requires the marker as the **absolute output prefix** (defeats whole-prompt echo), extracts the single block (multiple blocks / trailing content after END / missing END ⇒ `no_verdict`), enforces a **reject-guard** (block containing `diff --git` / `^@@ ` / `Diff under review:` / the template placeholder ⇒ `no_verdict`), an **oversize cap** (16 KB), and **exactly one anchored `VERDICT:`** line; a pre-dispatch **size-guard** warns on large diffs (a known echo trigger). Any anomaly ⇒ `no_verdict`, never a false `SHIP-AS-IS`. Design converged via a 2026-07-03 cross-family design debate (codex gpt-5.5 + grok + depth-0 synthesis); the plain-nonce-as-prefix + reject-guard hybrid was chosen over a derived/transformed delimiter (max-security but false-negative-prone on weaker engines — BACKLOG'd). **Process**: `/l5` hetero-impl dogfood — implementer `gpt-5.3-codex-spark` (3 rounds: fatal heredoc-backtick bug → core protocol + an over-reaching inline anthropic HTTP client → reverted that over-reach), decorrelated `gpt-5.5 xhigh` reviewer (3 rounds, converged SHIP-AS-IS) + a depth-0 independent adversarial harness (echo / diff-forged-verdict / trailing-after-END / oversize / missing-END). The **anthropic-compatible** runner is deliberately unchanged (separate hardened external-JS path; bringing it under the nonce protocol is a BACKLOG follow-up).

### Changed
- `scripts/dispatch-review.sh`: fresh-nonce wrapped-block review contract + hardened fail-closed parser for the codex/agy/grok/cc-shim runners (replaces the fence-tracking awk parser that a prompt-echo could defeat).

### Verification
- `bash hooks/tests/dispatch-review.test.sh` (97 assertions incl. new echo-pollution / forged-verdict / trailing / oversize / missing-END cases); depth-0 independent harness confirmed pass/ship ⇒ reviewed and echo/forged/leak/trailing/noend/oversize ⇒ no_verdict; `bash -n`, `preflight-portability.sh`, `preflight-release.sh` green.

## v2.31.2 — engine capability-state layer (quota + skill-transport awareness)

**Headline**: Adds an evidence-backed, local, append-only **engine capability-state layer** so `/l5`/`/l6` dispatch can become quota-aware and skill-transport-aware without changing existing behavior. New `scripts/engine-capability-state.js` (record/current/report/prune/classify-error store — flock+PID-stale-breaker, monotonic `event_id`, schema-strict, UTC-required timestamps, per-field skill_transport merge, unknown-never-clobbers-known), `scripts/probe-engine-capability.sh` (safe no-spend + operator-gated `--live-spend` runner probe, read-only), and `scripts/bench-engine-capability.sh` (native-vs-prompt-pack skill-transport bench, honest recording via isolated temp store). `dispatch-hetero.sh` gains passive quota capture (status-keyed) + a `--skill-mode off|prompt|native|auto` / `--skill <name>` bounded skill pack (path-traversal-guarded, provenance `skill_mode_effective`/`skills_injected`); `dispatch-review.sh` gains passive capture (verifier isolation preserved) and now **fail-closes on a non-zero codex exit** before the shared VERDICT parser. `resolve-review-loop.sh` consumes the state **report-only / demote-only** (demote only on `exhausted`+`high`+fresh; `unknown` never demotes; `/l4` untouched), appending `capability_state_source`/`quota_status`/`quota_reset_at`/`skill_mode_requested`/`skill_mode_effective`/`capability_warnings` as a byte-exact suffix. **Process**: `/l5` dogfood at depth-0 — hetero implementer **agy / Gemini 3.5 Flash (High)** (switched from `gpt-5.3-codex-spark` after it hit its usage cap mid-run — the very pain this layer addresses), decorrelated **gpt-5.5 xhigh** reviewer loop (Batch 1: 6 rounds / 19 findings incl. a `--skill` path-traversal fix; Batch 2/3 further rounds), authoritative depth-0 harness. Local state lives under `~/.autopilot/engine-capability/` and is never committed. v1 is report-only — no hard quota gate.

### Added
- `scripts/engine-capability-state.js`, `scripts/probe-engine-capability.sh`, `scripts/bench-engine-capability.sh`, `schemas/engine-capability-state.schema.json`, `evals/engine-capabilities/` bench fixtures.
- `dispatch-hetero.sh` `--skill-mode`/`--skill` bounded skill-pack transport + passive quota capture; `resolve-review-loop.sh` `--capability-state on|off` report-only consumption.

### Changed
- `dispatch-review.sh`: codex path now fail-closes (`no_verdict`, exit 1) on any non-zero codex exit before parsing a possibly-partial VERDICT (previously only grok/cc-shim did).

### Fixed
- `engine-capability-state.js` merge: an expired medium/low quota no longer `continue`s past the skill_transport in the SAME row (a latent bug surfaced once bench events carry both); skill_transport now merges per field.
- **P6 depth-0 review hardening** (decorrelated gpt-5.5 whole-diff loop, 5 rounds, all findings verified real then fixed): `engine-capability-state.js` stale-lock recovery is now an identity-checked atomic rename+link steal (no longer blindly unlinks whatever sits at the lock path; residual restore-gap knowingly accepted as the Node-built-ins floor for a local single-user store); `prune` protects the latest native/prompt_pack skill-signal carrier so a quota-TTL expiry can't silently revert it to unknown; merged `current` exposes per-field `native_observed_at`/`prompt_pack_observed_at` (added to schema + `validateEvent`) so freshness gating uses the native event's OWN time, not the aggregate `observed_at`. `dispatch-hetero.sh` rejects `.`/`..` skill names (one-level `skills/<name>/` boundary escape) and its `auto` native-freshness now reads `native_observed_at`. `bench-engine-capability.sh` records `quota=unknown` (a skill bench does not measure quota; the old hardcoded `available/high` poisoned the real quota signal). `probe-engine-capability.sh` live-spend failures persist only the classification and **redact** the operator-facing raw diagnostic (portable case-insensitive Authorization/scheme-token/base64 scrub).

### Verification
- `bash hooks/tests/engine-capability-state.test.sh` / `probe-engine-capability.test.sh` / `engine-capability-bench.test.sh` / `dispatch-hetero.test.sh` / `dispatch-review.test.sh` / `resolve-review-loop.test.sh` (P6 added regressions: state #9/#10, dispatch-hetero #19/#20, bench #7, probe #3/#3b); `preflight-portability.sh` 17/17, `preflight-release.sh` 6/6; full suite green except the pre-existing `intent-capture-basic-write` failure (identical on clean base, untouched by this diff). Full suite must run in the FOREGROUND (background bash has a ~2min cap).

## v2.31.1 — ladder-run implementer diff hardening

**Headline**: Fixes `scripts/ladder-run.sh --impl-prompt-file` so the acceptance-delegation ladder verifies the hetero implementer's returned commit, not the caller's current checkout. `dispatch-hetero.sh` removes successful worktrees by default and emits `worktree:null`; ladder-run now uses the returned `commit` field directly to build the `base..commit` diff and fails closed if that commit is not the requested branch tip or does not descend from the requested base.

### Fixed
- `scripts/ladder-run.sh`: the live implementer path now requires a returned commit SHA, verifies it is visible in the current repo, requires the returned branch to match the requested branch, requires `refs/heads/<branch>` to point to the returned commit, requires `BASE_SHA` to be an ancestor, and generates the review diff with `git diff "$BASE_SHA..$IMPL_COMMIT"`.
- `scripts/ladder-run.test.sh`: adds regressions that run even when external `qc_metric.py` is unavailable, using a fake `dispatch-hetero.sh` that returns `status:committed`, a real branch commit, and `worktree:null`; negative cases cover stale non-tip commits and unrelated commits.

### Verification
- `bash scripts/ladder-run.test.sh` covers the `worktree:null` live implementer path before the `qc_metric.py`-dependent tests.

## v2.31.0 — raw prompt authoring dispatch split for `/l6`

**Headline**: Adds `scripts/dispatch-author.sh`, a dedicated read-only raw prompt dispatch path for AUTHORING tasks (test plans, verification docs, and spec drafts), so `/l6` verification authoring runs on an uncoupled engine contract while reviewer prompt isolation stays in `dispatch-review.sh`.

### Added
- `scripts/dispatch-author.sh`: peer sibling to `dispatch-review.sh` that forwards `--prompt-file` bytes directly to `codex|agy|grok|cc-shim` with shared structural rails (read-only sandboxing/capture) and no reviewer template wrapper.
- `hooks/tests/dispatch-author.test.sh`: smoke suite for prompt-forwarding correctness and `dispatch-author` fail-closed semantics.

### Changed
- `skills/l6/SKILL.md`: verification AUTHORING rails now dispatch through `dispatch-author.sh` (instead of `dispatch-review.sh`) and capture the 2026-07-02 l6/N2 incident rationale.

### Fixed
- `/l6` guidance now avoids sending AUTHORING prompts through the reviewer wrapper that prepends `You are a code reviewer` / `Diff under review`, preventing the refusal path observed in the 2026-07-02 repro.

## v2.30.2 — dispatch-hetero: codex flag feature-detect + --codex-bin seam

**Headline**: Fixes a silent-misclassification bug where `engine implement-review` (and any `dispatch-hetero.sh --runner codex`) could dispatch to a STALE codex earlier in `$PATH` — e.g. an old npm-global `@openai/codex` in an nvm node's bin, ahead of `~/.local/bin/codex` — that lacks `--dangerously-bypass-hook-trust`. The old codex exited 2 mid-run with a cryptic "unexpected argument", which dispatch-hetero MISCLASSIFIED as `question_suspected`, wasting a round with no diagnostic. Root cause: the engine runs under nvm's node, whose `$PATH` prepends the nvm bin.

### Fixed
- `dispatch-hetero.sh` now **feature-detects** codex flag support in the precondition (`codex exec --help` must advertise `--dangerously-bypass-hook-trust`); a codex that lacks it fails LOUD as `precondition_failed` (exit 2) naming the resolved path + version + remediation, instead of being dispatched and misclassified.
- New `--codex-bin <path>` seam (sibling of `--agy-bin`/`--grok-bin`) to pin/override the codex binary explicitly (test seam + escape hatch for PATH ambiguity).

### Provenance
- Root-caused empirically (instrumented the worker to log the resolved codex path/version: the engine picked `~/.nvm/.../bin/codex` 0.130.0 vs `~/.local/bin/codex` 0.142.2). Env remediation (removing the stale npm-global codex) applied on the affected machine; the code fix makes the class fail-loud everywhere. The `--codex-bin` seam was further hardened over a 3-round decorrelated `gpt-5.5` review (absolutize path-form values before the worker's `cd`; validate dir resolution so a failed `cd` can't silently yield `/<basename>`). 59 dispatch-hetero test assertions.
- **Verified e2e (2026-07-02)**: three real `bin/autopilot.js engine implement-review` dispatches confirmed the previously-broken codex implementation step now works — (1) default `gpt-5.3-codex-spark`: codex 0.142.2 ran and ACCEPTED `--dangerously-bypass-hook-trust` (the old "unexpected argument" failure mode is gone) but hit that model's usage cap; (2) `gpt-5.5` implementer, qualified reviewer: full loop — impl `committed` → review `FIX-THEN-SHIP` (a legitimate finding) → repair `no_op` → honest `blocked` (no false-green); (3) evidence-complete task: **`converged` / `SHIP-AS-IS` / exit 0** (`resolve_roster` → impl `committed` → review `reviewed`). Probes were throwaway branches; `develop` untouched.

## v2.30.1 — unified endpoint credential resolver

**Headline**: Adds `scripts/resolve-endpoint.sh` — a unified `AUTOPILOT_ENDPOINT_<NAME>_{URL,TOKEN}` convention + resolver for the env-token hetero-dispatch families (MiniMax / GLM / any Anthropic-compatible endpoint), so multiple compatible endpoints can be registered by logical name instead of colliding on one `ANTHROPIC_COMPATIBLE_AUTH_TOKEN`. Wired additively into `dispatch-hetero.sh` / `dispatch-review.sh` (`--endpoint <name>`) and `dispatch-anthropic-review.js` (`--token-env <NAME>`) — every caller that omits the new flag is byte-identical. The OAuth-login runners (codex/agy/grok/claude) are untouched; they need no env token. (Developed as v2.29.1 from v2.29.0; retargeted to v2.30.1 on merge because the concurrent v2.30.0 ladder-run MINOR landed first.)

### Added
- `scripts/resolve-endpoint.sh` — resolves a named endpoint to **non-secret metadata only** (`base_url`, the token's env-var NAME, `token_present`/`url_safe`/`ready` booleans, `missing[]`); it NEVER prints a token value. Atomic candidate resolution (autopilot-namespace → minimax-only provider-native → generic-compatible) with no fail-open cross-combine; `url_safe` gate (https or http-loopback) folded into `ready`; fail-closed. Secret hygiene is mechanical: xtrace disabled at entry + scrubbed from `SHELLOPTS` (an inherited `bash -x` cannot leak a token), value read via `${!name-}` indirect expansion, `--list` enumerated via `compgen -v` (never by parsing `env`).
- `hooks/tests/resolve-endpoint.test.sh` — 40 assertions incl. atomic no-fail-open, xtrace non-leak, url-safety, `--token-env` fail-closed, and a sibling-path fail-if-called stub proving the no-`--endpoint` path never calls the resolver.

### Changed
- `dispatch-hetero.sh` / `dispatch-review.sh` gain `--endpoint <name>`; `dispatch-anthropic-review.js` gains `--token-env <NAME>` (uses that var INSTEAD OF the hostname fallback — an unset named token is fail-closed, not a silent drop to `MINIMAX_API_KEY`). All additive.

### Provenance
- The resolver's first-draft structure was dispatched to a heterogeneous implementer (codex `gpt-5.3-codex-spark`) via `dispatch-hetero.sh`; depth-0 review found and fixed two real defects in that draft (token value leaked under `bash -x`; trailing-comma invalid JSON on a non-empty `missing` array) and completed the wiring/tests/docs. The design spec passed a 4-round decorrelated `gpt-5.5` review loop before implementation.

## v2.30.0 — ladder-run: the acceptance-delegation ladder harness (P2.2)

**Headline**: Adds `scripts/ladder-run.sh`, the first real *measured* run of the acceptance-delegation ladder (ROADMAP P2.2). The `run` subcommand does one cycle: (1) obtain the change artifact, (2) a **decorrelated, isolated** agent renders the acceptance verdict from the diff text only (verifier isolation via `dispatch-review.sh` — the implementer's self-report never reaches the verifier), (3) emit a QC-metric event to the P2.1 store (`qc-metric-emit.js`), (4) deterministically flag the 30% cookys sample, (5) recompute the *class's* running escape/endorsement rate (via the unmodified `qc_metric.py`) and report a T0→T1→T2 promotion recommendation. The `audit` subcommand records a **later-stage escape** (a defect the in-cycle verdict passed but a stronger/later review caught) so `qc_metric.py`'s union-merge counts it as a real class escape — without this the in-cycle verifier is blind to its own escapes and the promotion gate is vacuous. Strictly additive — drives existing tools unchanged, alters no skill's behavior, records a recommendation (never auto-flips a tier), one cycle per invocation (not a scheduler).

Hardening (fail-closed measurement is the point of the gate): the 30% sample is keyed on `head_sha` + optional secret `$LADDER_SAMPLE_SALT` (not `change_id`) so it cannot be dodged by renaming; endorsement is compared as a fraction against the `0.90` bar (a 40% endorsement no longer reads as "> 0.90"); a `qc_metric.py` failure yields `HOLD-ERROR`/`needs_human`/exit 3 rather than a fail-open clean promote; the cycle writes ladder state first then appends the QC event last, rolling back and exiting 4 (`needs_human`) on a real-write failure so store and state stay consistent on the normal path (a hard-kill window between the two writes self-heals via the append-only store + `qc_metric.py` union-merge dedup on re-run — not an unconditional never-diverge claim); a rejected (`fail`/`needs_human`) verdict is recorded non-autonomous so it does not dilute the endorsement denominator.

### Added
- `scripts/ladder-run.sh`: the ladder-run harness — `run` (impl → isolated verify → emit → sample → per-class report) + `audit` (record a later-stage escape).
- `scripts/ladder-run.test.sh`: self-test incl. regressions for endorsement-as-fraction, audit-counts-as-escape, sampling-not-evadable, and calculator-failure-fail-closed, via a `--mock-verdict` test seam.
- `docs/ladder-run.md`: usage + posture (verifier isolation, agent-held acceptance with cookys as sampled co-participant, on-gate-catch vs escape + the `audit` escape path, weak-oracle caveat for diff-only doc-sync, fail-closed, non-evadable sampling).

### Rollback
- Maintainer: `git revert <merge-sha>` (additive — no existing behavior to restore).

## v2.29.0 — /l5 and /l6 engine implementation-review orchestration

**Headline**: Promotes the `/l5`/`/l6` engine implementation-review path to a release-ready minor: `engine implement-review` runs deterministic `implementer -> review -> repair -> review` cycles, reviewer qualification now fails closed by default, Codex package payload drift is gated, and the previously silent `harness-maintenance` skill is now correctly recorded as the 27th user-facing skill.

### Added
- `harness-maintenance`: user-facing skill for auditing and refreshing cross-harness capability state. This landed code-side in the v2.28.x development series without a CHANGELOG entry; v2.29.0 repairs the semver/release record.
- `src/runners/implementer.js`: dispatch helper for `scripts/dispatch-hetero.sh` with shape validation for implementer outcomes.
- `src/engine/autopilot-engine.js`:
  - `implementTask` and `runImplementationReviewLoop` for `/l5` and `/l6`-style implementation review loops.
  - `buildImplementationArgs`, implementer roster validation, and implement/review loop argument validation.
  - DI seams for `implementationDispatcher`, `diffProvider`, and `repairPromptWriter`.
- `bin/autopilot.js`: new `engine implement-review` command.
- `references/blind-dispatch.md`: new normative verifier-isolation section: reviewers and verdict-producing judges receive artifacts plus the original task/plan baseline, never the implementer's self-report, summary, chat narrative, or self-verdict.

### Changed
- `skills/l5` and `skills/l6` now document `engine implement-review` as the canonical `/l5` and `/l6` integration path.
- `src/engine/index.js` now exports implementation-loop builders and implementer validation helpers alongside existing review-loop APIs.
- `engine implement-review` now requires a qualified reviewer by default and fails closed at `phase:"reviewer_qualification"` when scorecard qualification is absent or false. Use `--allow-unqualified-reviewer` only as an explicit escape hatch.
- `agents/reviewer.md`, `skills/quality-pipeline/references/code-review.md`, and `project-config-template/review-loop-config.md` now encode verifier isolation as a MUST for every review round, including round 1.
- `scripts/dispatch-review.sh` now documents the structural invariant that reviewer prompt assembly is diff/artifact based and has no self-report input path.

### Verification / validation
- Focused suite updates:
  - `hooks/tests/autopilot-engine.test.sh`
  - `hooks/tests/autopilot-cli.test.sh`
  - `hooks/tests/codex-plugin-package.test.sh`
  - `hooks/tests/dispatch-review.test.sh`
  - `hooks/tests/hook-normalizers.test.sh`
  - `hooks/tests/review-runner.test.sh`
- Full-suite follow-up focused gates:
  - `hooks/tests/check-optin-changelog.test.sh`
  - `hooks/tests/check-test-integrity.test.sh`
  - `hooks/tests/check-test-integrity-l1.test.sh`
  - `hooks/tests/dispatch-hetero.test.sh`
- Reviewer prompt assembly verified artifacts-only (`dispatch-review.sh` has no self-report parameter); decorrelated review of the verifier-isolation diff ran through a different engine family.

### Fixed
- `scripts/sync-codex-plugin-skills.sh --check`: read-only Codex payload drift check, wired into pre-commit and `preflight-portability.sh`.
- `scripts/dispatch-hetero.sh`: wrapper-commit fallback now succeeds in repos without configured git author/committer identity by using a deterministic fallback identity only when either `GIT_AUTHOR_IDENT` or `GIT_COMMITTER_IDENT` is unavailable; the fallback still stages net-new files with `git add -A` and uses `--no-verify`.
- `hooks/tests/check-test-integrity*.test.sh`: L0 coverage now disables L1 explicitly, and L1 pytest coverage uses a hermetic fake pytest reporter so the suite no longer depends on host-level pytest installation.
- `hooks/tests/check-optin-changelog.test.sh`: ambiguous-history sandbox now configures repo-local git identity before committing.
- Review/implementer runner validators now enforce their documented schemas, including review `status`/`verdict` enums, unknown-key rejection, and `precondition_failed` implementer results with empty `branch`/`base`.
- Claude hook normalization now lets canonical cwd/session context override payload fields, keeping intent-file keys and persisted values aligned on symlinked paths or payload-session drift.
- Anthropic-compatible review dispatch fails closed immediately on response stream errors/aborts and oversized bodies.

### Hook-order semantics reminder
- unchanged

## v2.28.1 — hook adapter framework and Codex hook probe

**Headline**: Adds the first host-neutral hook adapter layer for Autopilot hooks and a separate warning-only Codex hook probe package. Existing Claude hooks keep their behavior, while Codex hook payload/cwd/env/failure semantics can now be captured as artifacts before any blocking Codex hook behavior ships.

### Added
- `src/hooks/normalize/{claude,codex}.js`: normalized hook event envelope for Claude Code and Codex payloads, backed by `schemas/hook-event.schema.json`.
- `src/hooks/handlers/{intent-capture,session-start}.js`: first host-neutral handler helpers used by the existing Claude hook wrappers.
- `platforms/codex/hook-probe/`: separate local Codex plugin package with warning-only `SessionStart`, `PreToolUse`, `PostToolUse`, `PreCompact`, and `Stop` probe hooks.
- Hook adapter tests for normalizers, handlers, and Codex hook probe packaging.

### Changed
- Codex capability state now distinguishes documented/plugin-bundled hook support from Autopilot gate readiness: the default Codex package remains skills-only, and the hook probe stays warning-only.

### Verification / validation
- Focused hook suites: `bash hooks/tests/run.sh intent-capture`, `bash hooks/tests/run.sh session-start`.
- Focused package/capability suites: `bash hooks/tests/codex-plugin-package.test.sh`, `bash hooks/tests/codex-hook-probe-package.test.sh`, `bash hooks/tests/harness-capabilities.test.sh`.

## v2.28.0 — /l6 full-dispatch CEO front-door

**Headline**: Adds `l6`, the 26th skill, as a full-dispatch CEO front-door: `/l6` is `/l5` plus verification AUTHORING as independent heterogeneous dispatch (separate engine family + independent harness), while depth-0 remains pure orchestration with authoritative QC (it executes committed artifacts and judges convergence-by-verification, never trusting a dispatched green).

### Added
- `l6`: new 26th user-facing `/l6` skill that defines full-dispatch CEO posture as `/l5` + independently-dispatched verification authoring and reviews.

### Verification / validation
- Built entirely by heterogeneous dispatch (`codex` implementation + Gemini decorrelated review), with recurrence proven by cross-session manual usage (token-conservation need), not a single one-off session.
- Prerequisite `dispatch-hetero` fix shipped in v2.27.1.

## v2.27.1 — dispatch-hetero wrapper-commit fix

**Headline**: `scripts/dispatch-hetero.sh` now wrapper-commits a worker's uncommitted edits for **any** runner, not just agy/grok/cc-shim — the fallback was guarded on `[ "$IS_CODEX" -eq 0 ]` on the assumption "codex commits itself", but `gpt-5.3-codex-spark` routinely leaves edits uncommitted (HEAD at base, tree dirty, especially for net-new files), so dispatches that created new files wrongly returned `dirty`/`files_changed:0` and had to be harvested by hand (~8× in the v2.26.11/v2.27.0 full-dispatch build). Dropping the codex exclusion makes the wrapper-commit a universal fallback (safe: it only fires when HEAD hasn't moved, so a self-committing codex run is never double-committed); the existing `git add -A` already stages net-new files.

### Fixed
- `dispatch-hetero.sh`: wrapper-commit fallback fires for codex too (was `IS_CODEX`-excluded → `dirty` on net-new files); codex now gets a correct `_runner_label`. Verified end-to-end (a real codex net-new-file dispatch now returns `committed`) + a 48-assertion test. Prerequisite for a future `/l6` full-dispatch level (see BACKLOG).
- `dispatch-hetero.sh`: the edit-only wrapper commit now runs `--no-verify` (merged from the other machine, `cbeca0c`) — the target repo's pre-commit hook (e.g. a `vue-tsc -b` build on staged `.ts/.vue`) could emit untracked artifacts or `exit 1` and silently swallow correct edits as a false `dirty`/`no_op`. The wrapper commit is a mechanical artifact-capture, not the quality gate (verdict stays at depth 0). Combined cleanly with the universal-fallback fix above.

## v2.27.0 — engine lifecycle onboarding skill

**Headline**: Adds the 25th `engine-onboarding` skill as the user-facing runbook for the hetero-engine lifecycle methodology (`spike → qualify → score → roster → re-qualify`), with routing constrained to capability, decorrelation, and cost. Includes three v1 qc cleanups (calibration floor assertion, `--field` exit-2 path, and `engine-qualify` JSON parse hardening). MINOR (new user-facing skill).

### Added
- `engine-onboarding`: new user-facing skill that operationalizes the hetero-engine lifecycle sequence, including the spike/qualify/score/roster/re-qualify phases and routing behavior that only routes on capability/decorrelation/cost.

### Fixed
- QC cleanup from the v1 ship: calibration floor assertion in lifecycle qualification.
- QC cleanup from the v1 ship: `--field` now exits with code 2 on invalid/missing input.
- QC cleanup from the v1 ship: hardened `engine-qualify` JSON parsing against malformed payloads.

### Verification / validation
- Built and verified entirely by hetero dispatch.

## v2.26.11 — hetero-engine lifecycle methodology v1

**Headline**: Adds a reviewer-facing engine lifecycle methodology that keeps the /l5 scorecard state append-only, monotonic, and fail-closed: `engine-scorecard.js` records calibrated qual results, `engine-qualify.sh` evaluates a known-bad bar from `evals/known-bad` (including injection-resistance), and `resolve-review-loop.sh --check-scorecard` gates `fallback_ladder` decisions from durable scorecard state when reviewer lifecycle is active. PATCH (new scripts + review-loop fail-closed wiring; no new user-facing surface).

### Added
- `scripts/engine-scorecard.js`: append-only JSONL scorecard store + query engine for the hetero-engine lifecycle (subcommands `record`/`current`/`report`/`ladder`) with stale-breaker locking, effective-status derivation, and unmeasured-row handling for capability/cost reporting.
- `scripts/engine-qualify.sh`: reviewer-stage qualifier that runs `calibration.sh run-known-bad` against `evals/known-bad/` (including injection-resistance cases), computes `false-pass-on-critical`, sensitivity, and specificity, and can emit a scorecard row to `engine-scorecard.js record` via `--emit-row`.

### Changed
- `scripts/resolve-review-loop.sh --check-scorecard`: adds fail-closed scorecard validation to the reviewer role (including `fallback_ladder` behavior and score-derived gating of lifecycle progression).
- `evals/known-bad/`: added/updated injection-resistance cases used by `engine-qualify.sh` for reviewer calibration.

### Verification / validation
- Implemented by hetero dispatch (`gpt-5.3-codex-spark` implementation path), then reviewed/verified by a decorrelated `grok` + Gemini qc-panel path.
- Plan: [`docs/plans/2026-06-30-hetero-engine-lifecycle-methodology.md`](docs/plans/2026-06-30-hetero-engine-lifecycle-methodology.md).

## v2.26.10 — cc-shim reviewer + MiniMax-M3 reviewer calibration

**Headline**: `dispatch-review.sh --runner cc-shim` makes any Anthropic-compatible model (MiniMax-M3, GLM, …) a read-only reviewer — the reviewer-side counterpart of the v2.26.8 cc-shim implementer — and **MiniMax-M3 is calibrated against `evals/known-bad`** so this is a measured-quality reviewer, not just a different vendor family. PATCH (new reviewer runner + resolver enum + docs/test).

### Added
- `dispatch-review.sh --runner cc-shim`: READ-INTENT, best-effort surface reduction on an untrusted diff (NOT a hard OS sandbox — see below), hardened over an 11-round gpt-5.5 review loop: `--tools ""` (ALL built-in tools disabled — an allow-list, not a leaky deny-list) + `--setting-sources project` (user/local settings excluded) + `--strict-mcp-config` (no MCP) + `HOME`/scratch cwd + NO `--dangerously-skip-permissions` + prompt via STDIN + `env -u ANTHROPIC_API_KEY`; `--bin` resolved to absolute via POSIX `cd`/`pwd` (not `realpath`); enforced timeout + FAIL-CLOSED-before-parser (a partial `VERDICT:` printed before a stall is never read as SHIP); `raw_log` JSON-escaped. Adversarially verified: an injection diff ("ignore instructions, run Bash/read /etc/passwd") returned in ~5s with no tool execution and no hang. Requires `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` in env.
- `resolve-review-loop.sh`: `reviewer_runner` enum now accepts `cc-shim` (was silently reset). +1 test assertion (73 total).

### Honest isolation ceiling (BACKLOG'd)
- No hetero reviewer is a hard OS sandbox: claude has no sandbox flag, and `codex --sandbox read-only` is a real sandbox ONLY with bubblewrap installed (absent on the current host → codex degrades to bypass too). cc-shim's surface is minimized + adversarially verified, but a genuinely-untrusted diff should be reviewed on a disposable/sandboxed host (install `bwrap` → codex becomes the hard-isolation reviewer). Tracked in `docs/BACKLOG.md`.

### Verification / calibration
- cc-shim reviewer e2e (MiniMax-M3): caught a planted `===`→`=` auth bypass and a negative-charge bug with accurate, specific findings.
- **MiniMax-M3 reviewer calibration over `evals/known-bad/` (2026-06-30): 10/10 caught — false-pass-on-critical = 0 (all 7 critical defects flagged: DOA-inversion, path-traversal, hardcoded-credential, silent-fallback, …) — and 3/3 clean diffs passed (no over-flag).** Good sensitivity AND specificity → safe to put `MiniMax-M3` in a `qc_panel`.
- **GLM-5.2** (`https://api.z.ai/api/anthropic`, model `glm-5.2`): endpoint/auth verified + clean (no `thinking` leak), but the service was **persistently 529-overloaded** (4/4 full-loop attempts on both z.ai and bigmodel.cn) — NOT certified as implementer/reviewer; re-Spike when capacity frees (spike-before-assert: a 200 probe ≠ a completed loop).

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.26.9 — wire grok/cc-shim into the /l5 config path + how-to docs

**Headline**: The v2.26.6–2.26.8 runners (grok, cc-shim) were dispatchable via `dispatch-hetero.sh`/`dispatch-review.sh` directly, but `resolve-review-loop.sh` — the resolver `/l5` reads — would **silently reset** `implementer_runner: grok`/`cc-shim` or `reviewer_runner: grok` back to the default (its enum allow-list predated them). This closes that end-to-end gap so the config values actually take effect, and documents how to use each runner where users look. PATCH (resolver fix + docs/test).

### Fixed
- `scripts/resolve-review-loop.sh`: runner enums widened — `reviewer_runner` now accepts `grok`; `implementer_runner` now accepts `grok` and `cc-shim` (were silently falling back to default). `family_of()` now recognises `xai` (grok/composer), `minimax` (minimax/abab), and `zhipu` (glm) — so the decorrelation overlap / `cross_family_satisfied` check is correct for the new engines instead of treating them all as `unknown`. +4 regression-guard test assertions (72 total).

### Docs (how to use)
- `project-config-template/review-loop-config.md`: `reviewer_runner`/`implementer_runner` field rows updated; new **Gotchas** entries for `grok` (impl + reviewer) and `cc-shim` (the full `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` env recipe, MiniMax-M3 example, M3-clean-vs-M2.x-leaks note).
- `references/hetero-dispatch.md`: new "Wired engines (runners)" table (codex/agy/grok/cc-shim — implementer vs reviewer, how to invoke).
- `skills/l5/SKILL.md`: the stale "grok deferred behind a smoke test" line replaced with the actual wired-runner roster.

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.26.8 — cc-shim implementer (Claude Code CLI → any Anthropic-compatible model, e.g. MiniMax-M3)

**Headline**: `dispatch-hetero.sh --runner cc-shim` drives the Claude Code CLI (`claude -p`) against an arbitrary Anthropic-compatible endpoint (`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` from the env), making any such model an implementer — verified end-to-end with **MiniMax-M3**. Corrects an earlier category error: for an IMPLEMENTER the **model** writes the code, so a base-url shim IS a viable implementer (decorrelation by driver family matters for reviewers, not implementers). PATCH (new runner on an existing script).

### Added
- `dispatch-hetero.sh --runner cc-shim`: EXPLICIT-only (never auto-routed). Precondition requires `ANTHROPIC_BASE_URL` + a token (else it would dispatch to vanilla Claude — homogeneous + the user's own quota). Prompt fed via STDIN (`claude -p < file`, dodges ARG_MAX); `env -u ANTHROPIC_API_KEY` so the shim token is the sole auth; EDIT-ONLY + wrapper-commit (same git-artifact rail as agy/grok); runner-aware commit message + INT/TERM-trap cleanup of the prompt temp.

### Verification
- Spike (2026-06-29, real MiniMax-M3 via `https://api.minimax.io/anthropic`): the endpoint/model/auth confirmed by a direct `/v1/messages` probe (M3 returned clean text, no `reasoning_content` leak — unlike M2.7 which did); `claude -p` edited files in cwd from a STDIN prompt; full `dispatch-hetero.sh --runner cc-shim --model MiniMax-M3` e2e returned `committed` + cgroup-contained + correct edit; the missing-base-url precondition fired correctly.

### To use via /l5
- Set `implementer_engine: MiniMax-M3` + `implementer_runner: cc-shim` in `.claude/review-loop-config.md`, and export `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` in the environment. Works for any Anthropic-compatible endpoint (GLM/zai, etc.), not just MiniMax.

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.26.7 — grok reviewer (dispatch-review.sh --runner grok)

**Headline**: `dispatch-review.sh` gains a `--runner grok` reviewer, so a disjoint-family qc panel can include an xAI vote (the read-only sibling of v2.26.6's grok implementer). Read-only BY CONSTRUCTION on an untrusted diff: scratch `--cwd` (never the repo), no `--always-approve` (cannot auto-edit), `--disable-web-search`, `--output-format plain` so the VERDICT/FINDINGS land at line-start for the parser. PATCH (new reviewer runner on an existing script).

### Added
- `dispatch-review.sh --runner grok` (models `grok-build` / `grok-composer-2.5-fast`). grok delivers stdout under a pipe (unlike agy), so a direct redirect captures it — no `script -qec` pseudo-TTY needed. The existing fail-closed parser (empty/unparseable → `no_verdict`, never SHIP) covers it unchanged.

### Verification
- Spike (2026-06-29, real `grok`): caught a planted `=`-vs-`===` assignment bug (`VERDICT: FIX-THEN-SHIP` with correct findings); a clean diff returned `SHIP-AS-IS`. Normal LLM-reviewer verdict variance observed (occasional over-flag) — safely absorbed by the parser's fail-toward-block resolution.

### To use
- Add `grok-build` or `grok-composer-2.5-fast` to a project's `qc_panel` in `.claude/review-loop-config.md` (the resolver already emits the panel; the runner is now wireable).

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.26.6 — grok hetero implementer (xAI Grok Build, 3rd dispatch family)

**Headline**: `dispatch-hetero.sh` gains a `--runner grok` implementer (xAI Grok Build CLI) alongside codex/OpenAI and agy/Gemini — a genuine third vendor family for decorrelated dispatch. Models: `grok-build` and `grok-composer-2.5-fast` (Composer 2.5 ships inside the grok CLI on the Grok Build plan). Wired only after a real CLI Spike (spike-before-assert): unlike agy, grok `-p` HONORS `--cwd` (no absolute-path anchor needed), and only flags actually present in `grok --help` are used (deliberately NOT the `--no-auto-update` the survey suggested). PATCH (new runner capability on an existing script; no new user-facing skill/agent).

### Added
- `dispatch-hetero.sh --runner grok` (+ `--grok-bin` test seam): EDIT-ONLY + wrapper-commit, same git-artifact verification rail as agy (verdict from git, never self-report). `auto` routing extended: `*grok*`/`*composer*` → grok. Invocation uses Spike-verified flags only (`-p --cwd --model --always-approve --no-alt-screen --output-format json`).
- Provenance: JSON `runner` field now reports `"grok"`; wrapper-commit message is runner-aware (`dispatch-hetero(grok|agy): …`).

### Verification
- Spike (2026-06-29, real `grok` CLI): both models created files inside `--cwd` (exit 0); full `dispatch-hetero.sh --runner grok` e2e returned `committed`, `runner:grok`, `containment:cgroup`, `contained:true`, correct edit; `auto`-routing on `grok-composer-2.5-fast` resolved to `grok`.

### To use via /l5
- Set `implementer_engine: grok-composer-2.5-fast` (or `grok-build`) + `implementer_runner: grok` in the project's `.claude/review-loop-config.md`. No further code change needed.

### Not in this release (follow-ups)
- grok as a `dispatch-review.sh` reviewer (new reviewer family); MiniMax M3 as an implementer via the CC + `ANTHROPIC_BASE_URL` shim path (different integration than grok's native CLI).

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.26.5 — hetero loop-review remediation (doc-drift mechanization + gate hardening)

**Headline**: A dual heterogeneous-engine review (gpt-5.5 xhigh via codex + Gemini 3.5 Flash High via agy) over the whole repo, every finding cross-verified against real `path:line` and then driven to convergence through a gpt-5.5 review loop. Fixes a quality-gate hole (committed stubs slipping `completeness-scan --range`), a PreToolUse hook that ENXIO'd on `/dev/stdin`, a data-loss-prone eval cleanup, and a layer of stale operational-doc references — plus a new deterministic gate that mechanizes the stale-script-reference class so it can't recur. PATCH (hardening of existing shipped code; no new user-facing surface).

### Added
- `scripts/doc-drift-gate.js` script-ref check: flags `scripts/<name>.<ext>`, `./scripts/...`, and backticked-bare renamed refs (`` `tree.sh` `` when only `scripts/tree.js` exists) that don't resolve. Active docs only (history/tracking/templates exempt); non-backticked prose not gated (FP risk). Mechanizes the drift class below.
- Pre-commit gate (`.githooks/pre-commit`): change-scoped `check-readme-parity.js` (README staged) + `check-hook-inventory.js --check` (hooks / count-bearing mirror staged), incl. **deletions** as triggers.
- `scripts/sync-version.js`: `README.zh-TW.md` version badge now synced (was drifting — 2.26.3 vs 2.26.4); included only when the file exists (forks/sandboxes safe).

### Fixed
- `scripts/completeness-scan.sh --range`: stubs **committed within the range** were misclassified as pre-existing and passed; now range-introduced findings are correctly flagged.
- `hooks/config-protection.js`, `hooks/test-runner.js`, `hooks/mcp-health.js`: read fd 0 first (the `/dev/stdin` PATH ENXIOs on PreToolUse) with a `/dev/stdin` fallback — matches the existing blocker convention.
- `scripts/run-eval-batch.sh`: replaced the blanket `rm ~/.claude/commands/*-skill-*.md` (could delete a user's/concurrent run's files) with per-`run_eval` before/after tracking + a `flock` single-instance lock.
- `scripts/check-optin-changelog.js`: scope `git rev-list` to commits touching the manifest (O(history) → O(version bumps)).
- `scripts/probe-diff-domain.sh`: exclude lockfiles in subdirectories (`*/package-lock.json`, `*/go.sum`, …).
- `scripts/dispatch-explore.sh`: signal handler exits cleanly (cleanup always returns 0).
- Stale operational-doc references corrected to real `.js` entrypoints (`tree.sh`→`tree.js`, `qc-panel.sh`→`qc-panel.js`, `risk-counter.sh`→`risk-counter.js`, `check-node-report.sh`→`.js`, `toggle-payload-capture.sh`→`.js`) across `references/tree-contracts.md`, `references/hetero-dispatch.md`, `references/blind-dispatch.md`, `references/multi-agent-portability.md`, `docs/BACKLOG.md`; `hetero-dispatch.md` runner-schema (`agy`-only → `codex|agy` + containment fields); `multi-agent-portability.md` Antigravity self-contradiction; `AGENTS.md` hook-inventory source + `--disabled-count` + pre-commit-gate description; `hooks/README.md` opt-in mechanism + PostToolUse order.
- `hooks/tests/check-hook-inventory.test.sh`: pre-existing breakage — sandbox never copied `hooks/opt-in-manifest.json` (a derivation input since v2.26.2) so the script ENOENT'd; also stale `8 default-on` vs current `10`. Now 18/18. (Test-only.)

### Eval coverage
- `scripts/run-eval-batch.sh` now derives the skill list and reports uncovered skills explicitly (16/24 have eval sets) instead of silently running a hardcoded 16.

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.26.4 — opt-in CHANGELOG release-hygiene gate

**Headline**: Closes the accuracy gap the v2.25.16 runtime update-checker left open — the runtime surfaces whatever CHANGELOG headline exists on a version bump, but nothing *forced* a change to the opt-in hook set to be described as opt-in. New `scripts/check-optin-changelog.js` (wired as `preflight-release.sh` check #6) fails the release-hygiene gate when the `hooks/opt-in-manifest.json` opt-in set changes vs the previous release **unless** the current version's CHANGELOG section contains the literal `opt-in` and names every added/removed stem alongside it. PATCH (new script; no new user-facing surface; opt-in set unchanged this release so the gate is inert here).

### Added
- **`scripts/check-optin-changelog.js`** — deterministic, pure-Node (no deps) gate. **Tag-free baseline**: walks first-parent `.claude-plugin/plugin.json` history to the boundary-parent of the current version's run (robust to a manifest change decoupled from the version-bump commit, and to non-monotonic/revert histories → flagged **ambiguous, fail-closed** with a `--base-ref` remedy). **No-baseline is fail-closed** (not a silent pass) except the legitimate pre-v2.26.2 bootstrap where the manifest predates introduction; `--allow-no-baseline` is the explicit escape hatch. **CommonMark-aware section scan**: version heading matched with a word boundary (so `v2.26.3` never matches `v2.26.30` or a `-alpha` prerelease), fenced-code and HTML-comment masking (inline comment spans stripped so a real heading sharing a comment line still terminates), 0–3-space ATX tolerance. **Co-location**: each changed stem must appear with hook-name word boundaries inside a list-item/paragraph block that *also* contains `opt-in` (a mention in a Rollback note or a neighbouring bullet does not count). Exit `0` pass/inert, `1` violation/fail-closed, `2` usage.
- **`hooks/tests/check-optin-changelog.test.sh`** — 41 assertions (file fixtures + real-git temp repos): unchanged/added/removed, missing-`opt-in`-token, boundary collision, prerelease/fenced/comment no-bleed, uncommitted-version fail-closed, ambiguous-history, bootstrap, usage.

### Changed
- **`scripts/preflight-release.sh`** — added check #6 (`opt-in change is named in the CHANGELOG`). Run it **after** committing the version bump (the gate fail-closes when the canonical version is not yet in first-parent history).
- **`CLAUDE.md`** — Scripts inventory row for `check-optin-changelog.js` + the sh-vs-js script-language criterion ("When adding a new script"). Version mirrors 2.26.3 → 2.26.4.

### Process
- `/l5` dogfood: spec → 1-round gpt-5.5 xhigh decorrelated spec-review (6 findings folded) → `gpt-5.3-codex-spark` hetero impl (worktree-isolated, cgroup-contained) → depth-0 independent adversarial harness → **4-round** decorrelated gpt-5.5 xhigh impl-review (R1 4 findings / R2 2 / R3 2 → **SHIP-AS-IS**). The decorrelated reviewer caught false-pass holes (adjacent-bullet credit leak, prerelease/fenced heading bleed, uncommitted-version baseline, CommonMark fence-length + inline-comment-on-heading) that both the implementer's own green and the depth-0 harness initially missed.

## v2.26.3 — hetero engines can now READ the repo instead of guessing (`dispatch-explore.sh`)

**Headline**: A new third sibling in the hetero-dispatch family, [`scripts/dispatch-explore.sh`](scripts/dispatch-explore.sh), lets a non-Claude engine (codex/GPT, agy/Gemini) **read the trusted repo** and answer grounded — the posture `dispatch-hetero.sh` (write) and `dispatch-review.sh` (review a diff fed as text) both deliberately avoid. Born from a real failure this session: when asked to explore autopilot's capabilities for landing-page copy, both engines **silently read nothing and guessed** — a map-only agy confidently "fact-checked" the real 24 skills down to an invented 23 and declared an existing skill missing. Two read recipes were diagnosed and baked in so no caller rediscovers them, plus a fail-loud probe that turns "the engine guessed" into a hard error instead of a plausible lie.

### Added
- [`scripts/dispatch-explore.sh`](scripts/dispatch-explore.sh) — read-the-repo hetero dispatch. **codex** read recipe: detect `bwrap` → `--sandbox read-only` if present, else `--dangerously-bypass-approvals-and-sandbox` (+ loud stderr note; bypass is acceptable here — repo trusted, read-only intent — but NEVER in `dispatch-review.sh`'s untrusted-diff path), always `-C <repo>`. **agy** read recipe: prompt PREPENDS `Your ABSOLUTE working directory is <repo>` + an absolute-path read-list (agy `-p` ignores process cwd), captured via `script -qec` pseudo-TTY, prompt right after `-p` / `--model` last. **Fail-loud read probe**: a fresh unguessable token is written to a repo sentinel; the engine must echo it on a `READ-PROBE:` line or `status:read_failed` (exit 3) and the guessed body is **withheld** — same fail-closed stance as "verify by artifacts, never self-report." Verified end-to-end: codex + agy both `explored` (grounded answer), a non-reading binary correctly `read_failed`. JSON `{runner, model, status, read_probe, sandbox, raw_log}`; exit 0/3/2.

### Changed
- [`references/hetero-dispatch.md`](references/hetero-dispatch.md) — new "Reading the repo" section documenting the silent-guess trap, the two read recipes (table), and the fail-loud probe.
- `CLAUDE.md` scripts inventory — added the `dispatch-explore.sh` row.

## v2.26.2 — all 12 opt-in hooks now enable-able (off the broken settings.json copy-paste route)

**Headline**: Completes the v2.26.1 fix for the whole opt-in catalog. `${CLAUDE_PLUGIN_ROOT}` expands only inside the plugin's own `hooks.json`, so the `settings.example.json` "copy this entry into your settings.json" route left every opt-in hook's script path literal and unlaunchable. All 12 remaining opt-in hooks (branch-protection, commit-secret-scan, large-file-warner, config-protection, mcp-health, accumulator, test-runner, design-quality, cost-tracker, session-summary, check-console, batch-format) are now wired in `hooks.json` (token resolves + auto-tracks the install path on update) behind a **default-OFF** runtime gate, enabled via `~/.autopilot/config.json` instead of copy-paste. Tier counts unchanged (10 default-on / 12 opt-in / 0 disabled). PATCH (mechanism change, no new user-facing surface).

### Added
- **`hooks/_shared/opt-in.js`** — single runtime gate. `isEnabled(stem)` is true iff `~/.autopilot/config.json` `hooks[stem] === true` OR env `AUTOPILOT_HOOK_<STEM>` is set. **Default-false, fail-safe** (any error → disabled): a gated-off PreToolUse hook exits 0 and never emits a block decision, so it can't wedge a tool call.
- **`hooks/opt-in-manifest.json`** — declarative SSOT of which wired hooks are opt-in; `check-hook-inventory.js` derives the opt-in tier from it. Self-check: every manifest stem must be wired in `hooks.json`.

### Changed
- **`hooks/hooks.json`** — wired all 12 opt-in hooks under their correct events (new `PreToolUse` / `Stop` / `PostToolUseFailure` blocks; `accumulator`/`test-runner`/`design-quality` joined the existing `PostToolUse Write|Edit` block; `mcp-health` keeps its `pre`/`failure` mode args; timeouts preserved).
- **12 opt-in hook scripts** — each gained an early `if (!isEnabled('<stem>')) process.exit(0)` gate (before any blocking/output logic).
- **`scripts/check-hook-inventory.js`** — derivation reworked: `default-on = wired − opt-in-manifest`, `opt-in = manifest`, `disabled = on-disk − wired`. No longer reads `settings.example.json`. Counts/membership identical to v2.26.1.
- **`settings.example.json`** — removed `hooks-opt-in-examples` entirely; now points at `~/.autopilot/config.json` enablement.
- **Docs** — `hooks/README.md` (Tier B = config-enable, not copy-paste), `docs/installation.md` ("Enabling opt-in hooks" section), `CLAUDE.md` + `preflight-portability.sh` (inventory opt-in source = manifest). Version mirrors 2.26.1 → 2.26.2.

### Known tradeoff (accepted; follow-up BACKLOG)
- Wiring the opt-in hooks in `hooks.json` means they spawn `node` (then gate-exit) on every matching tool call even when disabled — in line with existing default-on hooks but additive. The only update-stable wiring requires `hooks.json` (token must resolve). A per-event multiplexer that runs only enabled opt-in hooks is BACKLOGd.

### Hook-order semantics reminder
- New `PreToolUse` (Bash/Read/Write|Edit/mcp__.*), `Stop`, and `PostToolUseFailure` matcher blocks are independent of other matcher blocks; no cross-matcher ordering is claimed. Within the `PostToolUse Write|Edit` block the deterministic order is `suggest-compact` (default-on) → `accumulator` → `test-runner` → `design-quality`.

### Rollback
- Maintainer: `git revert <merge-sha>`.
- User-side: `/plugin update autopilot@v2.26.1`. No new sibling files created (opt-in state lives in the user's own `~/.autopilot/config.json`).

## v2.26.1 — opt-in hooks that referenced `${CLAUDE_PLUGIN_ROOT}` in `settings.example.json` were unusable

**Headline**: `${CLAUDE_PLUGIN_ROOT}` expands **only inside the plugin's own `hooks.json`** — never in a user's or project's `settings.json` (confirmed against the Claude Code hooks docs + reproduced locally). Every opt-in hook in `settings.example.json` told users to *copy* a `node ${CLAUDE_PLUGIN_ROOT}/hooks/<x>.js` command into their `settings.json`, where the token stays literal and the hook silently fails to launch. This release fixes the two hooks most affected by moving them into `hooks.json` (where the token resolves **and** auto-tracks the install path across plugin updates) behind a runtime opt-in gate; documents the systemic trap for the rest; and BACKLOGs the full migration. Counts: 22 hooks, **8 → 10 default-on**, **14 → 12 opt-in** (the two moved, semantics unchanged). PATCH (rewiring shipped hooks, no new user-facing surface).

### Changed
- **`hooks/hooks.json`** — `version-drift-check` (SessionStart) + `session-handoff` writer (new SessionEnd block) moved here from `settings.example.json`. `version-drift-check` was already silent for everyone but a behind-upstream dev clone, so default-on is correct. `session-handoff` stays opt-in via a **runtime gate**.
- **`hooks/session-handoff.js`** — added `handoffEnabled()` early gate: no-ops (`skip_disabled`) unless `AUTOPILOT_HANDOFF_INJECT=1` or `~/.autopilot/config.json` `handoff_inject:true` — the **same** switch that enables the session-start reader/inject half (writing a snapshot nobody injects is wasted work).
- **`settings.example.json`** — removed the two now-relocated entries; added a prominent `${CLAUDE_PLUGIN_ROOT}`-does-not-expand-in-settings.json warning so the remaining 12 copy-paste opt-in entries are no longer silently misleading (replace the token with the real install path; note it changes on update).
- **Docs** — `hooks/README.md` (tier tables 8/14 → 10/12, two rows moved Tier B → Tier A with inert-by-default notes, file-tree tags, Tier-B copy-paste caveat), `docs/installation.md` (version-drift-check now automatic; session-handoff enable-via-config), `CLAUDE.md` count line; version mirrors via `sync-version.js` (2.26.0 → 2.26.1).

### Fixed
- A dev clone's `.claude/settings.local.json` no longer needs the absolute-path SessionEnd workaround (the original symptom); removed to avoid double-firing now that the writer is in `hooks.json`.

### Known / BACKLOG
- The other 12 Tier-B opt-in hooks share the same `${CLAUDE_PLUGIN_ROOT}`-in-`settings.json` defect when copied verbatim. Full migration (wire-in-`hooks.json` + per-hook runtime gate, or a single enable-list config) is BACKLOGd — most are genuine per-project policy toggles, so the design is non-trivial and out of this PATCH's approved scope.

### Hook-order semantics reminder
- The new SessionEnd block is independent of other matcher blocks; no cross-matcher ordering is claimed. `version-drift-check` runs in the same `startup|clear|compact` SessionStart block as `session-start.js` (intra-matcher order: `session-start` then `version-drift-check`).

### Rollback
- Maintainer: `git revert <merge-sha>`.
- User-side: `/plugin update autopilot@v2.26.0`. No new sibling files created.

## v2.26.0 — `autopilot:onboard` + ecosystem-standalone premise + install/update-UX

**Headline**: One branch, three strands, landing as the 24th skill. **(A) `autopilot:onboard`** — the "fresh repo → autopilot-calibrated repo" bridge that was missing (project-lifecycle bootstraps tracking docs from a plan, nothing scaffolded the `.claude/*-config.md` DI): **detect** a repo's mechanical reality → **scaffold** the config set with ecosystem-standalone (autopilot-only) chains → **enrich** the judgment configs. **(B) Ecosystem-standalone premise flip** — autopilot's documented default is now autopilot + `codeforge` + `mnemos` standalone; `superpowers` consistently optional (no longer "built-in"/"recommended default"/"Superpowers executes"); voltagent de-assumed as a peer. **(C) Install/update-UX** — a single "Updating" decision branch in `docs/installation.md`, the opt-in `version-drift-check` SessionStart hook, and `dev-update.sh`. Skills 23 → **24**; hooks 21 → **22** (this branch's `version-drift-check`, opt-in).

### Added
- **`skills/onboard/SKILL.md`** (24th skill) — judgment layer over the two scripts: maps domain keywords → skills, derives doc⇄code drift domains, names security surfaces, optional CLAUDE.md reconcile + memory seed. Ecosystem-standalone by default.
- **`scripts/project-detect.js`** — pure-Node read-only repo detector → JSON (package manager, commands + `lint_is_noop`, per-package coverage thresholds, doc convention, workspace/packages, `default_branch` only when target is the git top-level, protected paths, project paths, `installed_plugins.superpowers`). Path-traversal + symlink-escape guarded; never throws out of main. 83 assertions / 9 fixture shapes; golden-exact vs hangar-bridge.
- **`scripts/scaffold-config.js`** — mechanical `.claude/` scaffolder (7 filled configs + 2 `TODO(onboard)` skeletons), autopilot-only chains, `.gitignore` runtime-state block (keeps `*-config.md` tracked; warns on a pre-existing wholesale `.claude/` ignore). Idempotent; `--force`/`--dry-run`. 47 assertions.
- **`hooks/version-drift-check.js`** (opt-in, SessionStart) — dev-mode advisory when the autopilot clone is behind its git upstream (no network; fail-open). + **`scripts/dev-update.sh`**.

### Changed
- **Premise flip**: `hooks/session-start.js`, `hooks/failure-escalation.js`, `.claude/dispatch-config.md`, `docs/coexistence.md`, `docs/architecture.md`, `project-config-template/team-config.md`, `agents/README.md`, `skills/think-tank/{SKILL.md,references/role-prompts.md}`, README + zh-TW + CLAUDE.md (trio baseline).
- **Install/update**: `docs/installation.md` "Known Limitation" + "Update" folded into one "Updating" decision section; `dev-setup.sh` completion message points at the dev-mode update one-liner.
- Counts propagated: 24 skills / 22 hooks (8 default-on, 14 opt-in) across every surface; version 2.25.16 → 2.26.0 (new skill = MINOR).

### Process
- `/l5` with a gpt-5.5 xhigh decorrelated review loop on every phase. P2 (detector): 8 review rounds caught real path-traversal + symlink-escape vulnerabilities + edge cases. P3 (scaffolder): 4 rounds. Holistic whole-branch pre-merge review (gpt-5.5) caught a gitignore-shadow gap + a stale doc-drift-gate reference. Rebased onto a fast-moving develop (which shipped v2.25.13–v2.25.16 concurrently); merge reconciled the new opt-in hook → 22.

### Rollback
- Maintainer: `git revert <merge-sha>`. User-side: `/plugin update autopilot@v2.25.16`. The onboard scripts only WRITE into an explicit `<target>`.

## v2.25.16 — update-checker: "what's new" on version bump (default-on, fixes opt-in discovery)

**Headline**: Solves a real adoption gap — when autopilot updates and adds a new **opt-in** feature, the user's `settings.json` is unchanged, so the feature has ~0 discovery (CHANGELOG is pull-only). A new **default-on** behavior folded into `session-start.js` now announces a version bump **once** per bump: on a SessionStart `startup`/`clear`, it compares the current `plugin.json` version against a `~/.autopilot/last-seen-version` high-watermark, and if it advanced, injects a capped, CHANGELOG-driven "what's new + where to enable new opt-in features" notice, then atomically advances the watermark. Default-on (an opt-in discovery tool can't bootstrap), but **bounded and safe**: counts toward the existing 10k `additionalContext` cap, fires only on a real bump (no steady-state noise), the user-mention instruction is **conditional** (skipped for exact/JSON/machine-readable output), and it's opt-out-able. No repo writes, no network, no settings-introspection. **Process**: `/l5` dogfood — 3-round gpt-5.5 **spec-review** (design converged before code: 4🟠+2🟡 → 2🟠 → SHIP) → codex `gpt-5.3-codex-spark` hetero impl → 2-round gpt-5.5 **impl-review** (3🟠 default-on edge cases — stale-lock-wedge / empty-CHANGELOG-throw / instruction-truncation — caught + fixed) + independent depth-0 harness.

### Added
- `hooks/session-start.js` update-checker (default-on, in the existing Tier-A hook): semver high-watermark in `~/.autopilot/last-seen-version`; atomic at-most-once (lock → re-read → compare → publish → append → finally-release, with a 60s stale-lock breaker); bounded CHANGELOG parse (256KiB prefix, em/en/ASCII-dash tolerant, ≤5 headlines + "…N older"); conditional strict-output-safe instruction; opt-out via `AUTOPILOT_UPDATE_CHECK=0` / `~/.autopilot/config.json` `update_check:false`. First-run records silently; downgrade never lowers the watermark.
- `hooks/tests/session-start-update-check.test.sh` — 50 assertions (bump/once/silent, first-run, downgrade, opt-out, headline cap, malformed/empty CHANGELOG, budget, lock held / stale-lock-reaped / fresh-lock, concurrent two-start, fail-open, dash variants, instruction-never-truncated).

## v2.25.15 — auto-handoff rework: machine state to ~/.autopilot + opt-in inject (no repo writes)

**Headline**: Reworks the v2.25.14 `session-handoff` hook after a decorrelated design-review loop caught — and an empirical repro **confirmed** — a 🔴 **dirty-tree self-poisoning loop**: writing the handoff into `docs/HANDOFF.md` made the repo dirty, so the next *trivial* session re-fired forever (the foreman, the depth-0 review, and all 27 v2.25.14 assertions missed it — none exercised the cross-session loop). A second 🔴: folding the inject into the default-on `session-start.js` would have turned any repo's markdown into injected context. The rework moves the machine handoff OUT of the repo to `~/.autopilot/handoff/<repo-hash>.md` (mirroring the existing `compaction-state` mechanism: write → inject-once → consume), and adds the inject as a **default-off** gate inside `session-start.js`. `docs/HANDOFF.md` is now never written or read — it stays 100% human-authored. **Process**: `/l5` dogfood — codex `gpt-5.3-codex-spark` hetero impl → 4-round decorrelated `gpt-5.5` review (2🔴 → 2🟠 → 2🟠 → SHIP-AS-IS) + independent depth-0 race harness. The review loop hardened the writer/reader concurrency protocol across rounds: atomic temp→rename publish, atomic rename-consume, **generation-id (sha1-of-body) binding** so a reader/TTL never injects-stale or deletes a freshly-republished body.

### Changed
- `hooks/session-handoff.js` (writer): writes `~/.autopilot/handoff/<repo-hash>.md` + `<hash>.meta.json` (repo root via `git -C cwd rev-parse --show-toplevel`; temp→atomic-rename; `gen=sha1(body)`). NO repo writes; marker-guard/`HANDOFF.auto.md` sidecar deleted. Self-poisoning gone (decide-if-needed no longer sees its own output).
- `hooks/session-start.js` (reader, **default-off**): behind `AUTOPILOT_HANDOFF_INJECT=1` or `~/.autopilot/config.json` `handoff_inject:true`. On `clear`/`startup` (the wired sources; never `compact`): atomic rename-consume + generation-validate + inject a <10k DATA block, suppressing the overlapping intent hint; generation-bound TTL cleanup. A default install reads/injects nothing.
- Tests: cross-session feedback-loop regression lock (the missing v2.25.14 test) + atomic-publish/consume + race-lock + generation-binding (`session-handoff` 29, `session-start-handoff-inject` 32). Docs: `settings.example.json`, `hooks/README.md`, README hook-count prose.

## v2.25.14 — opt-in auto-handoff on /clear (SessionEnd hook)

**Headline**: A new **opt-in** `session-handoff` hook automates the recurring "do I need to write a handoff before I `/clear`?" decision. On `SessionEnd` with `reason: clear` (or `logout`) it parses the transcript itself (reusing `state-checkpoint-lib`), DECIDES whether meaningful work happened — dirty tree / commits-this-session / a touched active project / a substantive transcript — and only then writes `docs/HANDOFF.md` (repo state, recent commits, last action, inferred next step). If nothing meaningful happened it writes nothing; that *is* the automated "no handoff needed" answer. **Marker-guard**: a hand-written `HANDOFF.md` (no `AUTO-GENERATED` marker) is **never clobbered** — the auto handoff lands in `docs/HANDOFF.auto.md` instead; only an absent or prior-auto file is overwritten in place. Fail-open, opt-in only (wired in `settings.example.json`, never default-on — it writes into your repo). **Process**: `/l4` dogfood — a background worktree-isolated foreman built the hook + 21-assertion test; depth-0 review caught the manual-HANDOFF clobber footgun (confirmed by an adversarial smoke that destroyed a hand-written file) and added the marker-guard + 6 more assertions before merge.

### Added
- `hooks/session-handoff.js` — opt-in `SessionEnd` hook: decide-if-needed (dirty / commits / active-project / substantive-transcript) → write/update `docs/HANDOFF.md` (marker-guarded to `HANDOFF.auto.md` for manual files), fail-open, transcript-parse via `state-checkpoint-lib`, `~/.autopilot/.session-handoff.log` (600) diagnostics.
- `hooks/tests/session-handoff.test.sh` — 27 assertions (decide-if-needed paths, reason gate, non-git, fail-open on garbage/missing transcript, idempotency, marker-guard preserve+sidecar).

### Changed
- Hook inventory 20→**21** (opt-in 12→**13**): `settings.example.json` opt-in block, `hooks/README.md` tier table, count mirrors.

## v2.25.13 — diff-domain telemetry for /l5 (measure-now, route-later)

**Headline**: `/l5` now records a deterministic **`work_domain`** for each implementation diff, so per-project per-domain model performance becomes measurable — the prerequisite for any future domain-aware engine routing. It routes **nothing**: a new `scripts/probe-diff-domain.sh` classifies a `git diff --numstat -z -M -C` into `rust` / `backend-cli` / `frontend` / `docs` / `mixed` (enumerated extension map, explicit exclude list, ties/binary/deletion/degenerate cases pinned, LLM-free), and `resolve-review-loop.sh` gains `--domain`/`--auto-domain` that append exactly two telemetry keys (`work_domain`, `domain_source`) to its JSON without touching any pre-existing field or engine choice. **Process**: dogfooded via `/l5` — heterogeneous implementer (`codex gpt-5.3-codex-spark`, cgroup-contained worktree dispatch) → 4-round decorrelated `gpt-5.5` xhigh review loop (1🔴+2🟠+2🟡 → 1🟠+1🟡 → 1🟠+1🟡 → SHIP-AS-IS) + an independent depth-0 adversarial harness. The 🔴 (a numstat-`z` rename path that looked like a counts record caused phantom double-counting) was caught by the decorrelated reviewer after the local green passed — fixed with a deterministic NUL state-machine parse. All domain **routing** is deferred to `docs/BACKLOG.md` behind explicit prerequisites (thin evidence: one exam, n=15).

### Added
- `scripts/probe-diff-domain.sh` — deterministic, LLM-free diff-domain telemetry probe (numstat-`z -M -C` NUL parse, enumerated classifier, inline exclude list, `> 0.5` dominant-share with ties→`mixed`, binary/deletion/rename-by-new-path handled). JSON + `--help`.
- `resolve-review-loop.sh` `--domain <d>` (enum-validated) / `--auto-domain [range]` (shells the probe) → two appended telemetry keys `work_domain` + `domain_source` (`explicit|auto|none`); pre-existing output is a byte-exact prefix; non-git/empty/probe-fail ⇒ `mixed`/`none`, exit code unchanged.
- `work_domain` column in the `/l5` run-summary ledger (`level-front-door.md`); `/l5` records it post-impl from the dispatch-outcome `base..commit` range (telemetry only).

### Changed
- Docs: `CLAUDE.md` inventory row for the probe + resolver two-key note; `review-loop-config.md` documents both keys as emitted telemetry; `BACKLOG.md` records the deferred domain-routing entry with its 5 prerequisites.

## v2.25.12 — onboarding-friendly README: slim front door, detail relocated to docs/

**Headline**: `README.md` was a 651-line spec dump that buried newcomers under Superpowers-coexistence scenarios, the injection-mechanism diagram, full 20-hook Tier tables, design philosophy, and a 6-source credits block. It's now a **135-line onboarding tour** (What Is / Quick Start / What It Does, with natural-language "Try saying" triggers / A Day With Autopilot / Install / Learn More) and `README.zh-TW.md` mirrors it 1:1. All the depth was **relocated verbatim** (not summarized) into five English `docs/` files — `skills.md`, `coexistence.md`, `configuration.md`, `installation.md`, `architecture.md` — plus the hook Override/Secret-Detection operational notes moved into the canonical `hooks/README.md`. **Process**: built via `/l5` — a gpt-5.5 xhigh spec-review pass caught 3 real gaps (missing `--skill-count`, zh-TW badge not auto-bumped, an un-homed Override section) which were folded in before implementation; depth-0 ran every gate green.

### Changed
- `README.md` 651→135 lines; `README.zh-TW.md` slimmed in lockstep (parity: 6 badges + 12 sections).
- `scripts/check-hook-inventory.js`: the hooks **body** assertions (Tier headers, intro tally, Tier-A membership) now target `hooks/README.md` (already canonical) instead of `README.md`; both READMEs keep only the `hooks-<N>` hero-badge assertion. The slim README no longer carries a hook table.
- `hooks/tests/check-hook-inventory.test.sh`: membership-drift case #4 retargeted from `README.md` to `hooks/README.md` (swaps `failure-escalation`, the one default-on hook confined to the Tier-A block).
- `CLAUDE.md`: the `README.md#superpowers-coexistence` anchor link → `docs/coexistence.md`.

### Added
- `docs/skills.md`, `docs/coexistence.md`, `docs/configuration.md`, `docs/installation.md`, `docs/architecture.md` — the relocated detail (English-only; both READMEs link to them).
- `hooks/README.md`: `## Override` section (relocated `autopilot.<hookName>=false` / `AUTOPILOT_PROTECTED_BRANCHES` / `autopilot.costTracker=false`).

### Fixed
- Content-homing completeness: the README Secret-Detection + Override operational notes had no other home; relocated so nothing is lost.

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.25.11 — trust-tiered review policy: deterministic review-risk + cross-family enforce

**Headline**: Implements the buildable core of the trust-tiered review-policy design (`docs/plans/2026-06-26-trust-tiered-review-policy.md`, converged through a 3-round gpt-5.5 xhigh review loop). The industry/research sweep found the real lever is **decorrelated execution verification**, the cross-family panel is secondary (1→2 families is the win, more is waste), and **review depth should key on MEASURED risk, not who implemented**. `resolve-review-loop.sh` now derives a deterministic `implementation_review_risk` and emits the policy the depth-0 loop enforces; an opt-in `--enforce` hard gate blocks a high-risk change whose required cross-family decorrelation is unsatisfied. **Built via `/l5` dogfood**: codex `gpt-5.3-codex-spark` implemented it, verified by an independent depth-0 acceptance harness + a 3-round gpt-5.5 decorrelated review loop (caught a metadata-not-enforced hole + a high-risk-empty-panel hole — both fixed). Scope: hardens honest-but-weak implementers only, NOT malicious-proof.

### Added
- `resolve-review-loop.sh` risk-tiered fields: deterministic `review_risk` (low/high) from `--source-trust`/`--diff-lines`/`--protected-path`/`--oracle-available`/`--security-surface` (source-trust is ONE input, not the key); emits `required_review_families`, `l1_required`, `cross_family_required`, `cross_family_satisfied`. `family_id` fail-closed: an unknown-family panel member never satisfies cross-family. Cross-family overlap escalates WARNING(low)→ERROR(high).
- `resolve-review-loop.sh --enforce`: opt-in hard gate (exit 3, JSON still emitted) when a high-risk change's required cross-family decorrelation is unsatisfied (incl. an empty panel at high risk). Default stays exit-0 data mode (resolver reports, caller enforces — same as resolve-doa/resolve-qc-gate). +8 resolver assertions (53 total).

### Changed
- `code-review.md` Panel aggregation: terminal verdict states (`verified` / `unverified-nonblocking` / `unverified-blocking` — `warn`/`off` may suppress blocking but never relabel unverified as verified) + cross-family fail-closed-on-unknown + `l1_required` mandatory at high risk. `review-loop-config.md` documents the risk inputs/fields/`--enforce`. `level-front-door.md` qc@depth-0 adds the dispatch-manifest provenance precondition (missing ⇒ fail-closed strictest).

## v2.25.10 — quality-pipeline routes hard/flaky test failures to test-strategy

**Headline**: Closes the one genuine missing routing edge found by the 2026-06-26 methodology-completeness inventory: `quality-pipeline`'s test step classified failures (`verify-preexisting.sh`) but never tapped `test-strategy`'s failure-investigation methodology. Now, an INTRODUCED failure that is clustered (≥3), flaky/intermittent, or not-obvious-from-the-diff routes to `autopilot:test-strategy` (funnel / baseline / regression scoping) before blind patching; a single obvious failure still fixes directly. (The inventory confirmed no orphan skills and that entry-point skills are correctly standalone — this was the only cross-cutting edge worth wiring; the `team`→`dev-flow` "gap" was deliberately NOT wired, per the recorded thin-slice parallelization non-goal.)

### Changed
- `skills/quality-pipeline/SKILL.md` Tests step — conditional routing to `autopilot:test-strategy` on hard/flaky INTRODUCED failures.

## v2.25.9 — heterogeneous decorrelation: agy restored as implementer + cross-family qc panel

**Headline**: Two coupled `/l5` decorrelation upgrades. (1) **`agy`/Gemini works as a heterogeneous implementer again** — the long-standing "agy can't write to the worktree" blocker was not a vendor wall but a relative-path prompt interacting with agy ignoring process cwd (it invented a `~/.gemini/.../scratch/` project = the old `no_op`). `dispatch-hetero.sh` now prepends an absolute-worktree anchor so agy edits in place (verified single-/multi-file + 3-way concurrent). (2) The authoritative depth-0 qc gate becomes a configurable **disjoint-family panel** (`qc_panel`, default OpenAI/Anthropic/Google) aggregated **`union-on-verified-critical`** (majority forbidden — it would suppress the single-track blind-spot catch a panel exists to surface), with a new **read-only** `dispatch-review.sh` putting Gemini-via-agy into the panel (agy's write bug is implementer-only; read-only review is verified — it caught a planted bug).

### Added
- `scripts/dispatch-review.sh` — READ-ONLY heterogeneous reviewer dispatch (sibling of `dispatch-hetero.sh`): diff-as-text-in-prompt + `script -qec` pseudo-TTY capture (agy stdout-drop #76/#408) + `VERDICT:` parse; **empty → `no_verdict` fail-closed** (never a silent pass); no worktree, no git mutation. `--runner codex|agy`. 21 test assertions; verified end-to-end with real agy.
- `review-loop-config.md` / `resolve-review-loop.sh`: **`qc_panel`** (disjoint-family terminal gate, default `gpt-5.5, claude-opus, gemini-flash`) + **`qc_panel_aggregation`** (`union-on-verified-critical`); resolver emits the panel as a JSON array, rejects `majority`, and WARNS if the panel shares the implementer's vendor family. +9 resolver assertions.
- `code-review.md` "Panel aggregation" canonical section (union-on-verified-critical; verified-gates-the-union via `independent_harness`; no-verdict fail-closed; decorrelate by family not just lens — PoLL/self-preference grounding). Wired into `level-front-door.md` qc@depth-0 + `agents/reviewer.md` pointer.

### Fixed
- **`dispatch-hetero.sh` agy `no_op`**: agy `-p` ignores process cwd, so a relative-path prompt made it write to a scratch project and leave the worktree untouched. The agy directive now prepends `Your ABSOLUTE working directory is: <worktree>` + a scratch/project prohibition → agy edits in place. Restores `implementer_runner: agy` as viable (supersedes the v2.25.8-era "don't chase agy" verdict, which was an over-correction from a relative-path bench). +2 dispatch-hetero assertions (anchor-injection capture).

### Changed
- agy `no_op`/"unreliable" narrative corrected across `references/hetero-dispatch.md`, the `review-loop-config.md` gotcha, and `docs/BACKLOG.md` (agy CAN implement now; stays EDIT-ONLY for the run_command-10s reason, not a write wall). Docker remains a non-solution (headless auth broken, #223/#479) — run agy on an interactively-authed host.

## v2.25.8 — hetero-dispatch roster fix + review-loop automation (`/l5` config-driven)

**Headline**: Three coupled hardenings of the `/l5` heterogeneous pipeline. (1) `dispatch-hetero.sh` no longer mis-routes non-`gpt-5.5` codex models to the repo-corrupting agy branch. (2) The "generation-adversarial heterogeneous" loop is now **data, not a hand-typed prompt** — a per-project engine roster makes `/l5 <goal>` run the whole `subagent plan → decorrelated reviewer loop → hetero impl → reviewer loop → qc-gate` pipeline. (3) Worker teardown reaps escaped descendants. An attempt to also unlock the L1 block-mode override on cgroup containment was **reverted as UNSAFE** after adversarial review — it stays deferred (see below).

### Added
- `scripts/resolve-review-loop.sh` + `project-config-template/review-loop-config.md` — per-project **engine roster + loop policy** (`reviewer_engine`/`reviewer_effort`/`implementer_engine`/`implementer_runner`/`loop_max_rounds`/`spec_review`/`independent_harness`/…). Same config-resolution chain as `resolve-qc-gate.sh`. `/l5` reads it instead of you re-typing the roster; the **decorrelated reviewer** (default `gpt-5.5`) replaces homogeneous-Claude review. 16 resolver assertions.
- `dispatch-hetero.sh`: `--runner auto|codex|agy` (auto routes `*gpt*`/`*codex*` → codex) + `--effort` (per-call codex reasoning). Best-effort **worker containment** (`systemd-run --user --scope` cgroup, reaped + verified on all exit paths) emitting `containment`/`contained` provenance. 8 new dispatch-hetero assertions.

### Fixed
- **`dispatch-hetero.sh` codex-trigger bug**: the codex branch matched only `*gpt-5.5*`, so a stated implementer like `gpt-5.3-codex-spark` silently fell through to the **agy** branch — which corrupts the autopilot repo (writes its plugin install copy). Now routes the whole codex family; explicit `--runner` always wins.

### Changed
- `/l5` SKILL: resolves the roster via `resolve-review-loop.sh`; runs the decorrelated reviewer + depth-0 independent harness; documents the impl `--runner/--model/--effort` + `containment` provenance.

### Reverted (kept deferred — adversarial review caught it)
- An unlock of the **L1 block-mode test-integrity override** on a `--containment cgroup-verified` attestation was **reverted as UNSAFE** (gpt-5.5 review, two verified escapes: a same-user worker can `systemd-run --user --scope` a sibling cgroup outside the dispatcher's scope → `contained:true` is a false attestation; and the verdict-file path was honored when worker-reachable). No local-only same-user mechanism closes the forgery hole — vindicating the original deferral. The override stays deferred; the dispatch-hetero cgroup shipped as teardown hygiene only; the gate's `--containment` flag is accepted-but-advisory. Re-enable (needs a real isolation boundary: separate UID / sandbox / blocked user systemd bus) is BACKLOG'd.

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.25.7 — L1 test-integrity gate (executed-set invariance)

**Headline**: L1 layer for `check-test-integrity.sh` — the semantic half L0 (diff-text-only) can't see. L1 RUNS the test collector on base vs head and fails (`executed_set_shrink`) if the set of tests that **actually execute** shrinks — catching additions-only / out-of-test-path gaming L0 misses (`test.only`/`fit`, module `pytestmark=skip`, `collect_ignore`, runner-config exclusions, go build-tag drops, jest/vitest `testPathIgnorePatterns`). Per-runner: **pytest / jest / vitest / go** (RUN-not-collect — verified `--collect-only` lists skipped tests, so execution/report status is the only honest signal). Best-effort (runs only when a runner is detected); default stays `warn`, `block` opt-in. Strictly additive to L0 (the 70 L0 assertions are unchanged). Converged through a 4-round gpt-5.5 adversarial design loop + a 3-round impl review + an independent depth-0 adversarial harness.

### Added
- L1 layer in `scripts/check-test-integrity.sh` (additive): two-sided `git worktree` collection with env-scrub + pgroup-killed timeout + always-cleanup; per-runner detection (`marker_present`+`tool_available` matrix), collection commands, normalized test-ids, and status→executed mapping; `executed_set_shrink` by exact set-diff (no fuzzy rename matching — a renamed test id is a documented false-positive requiring depth-0 override, per the deliberate spec decision); base-vs-head failure classification (`unavailable`/`collection_failed`(`reporter_failed`/`build_failed`/`timeout`/`module_path_changed`)/`runner_disappeared`); JS empty/broken-report and go multi-package build-failure both **fail closed**.
- New CLI flags: `--no-l1`, `--l1-timeout`, `--l1-runner`, `--l1-worktree-dir`, `--l1-verdict-file`, `--assert-worker-dead <pgid>`. New JSON fields: `l1`, `l1_runners[]` (backward-compatible with the L0 schema).
- Override verdict-verification plumbing (changeset-digest + dropped-digest bound, out-of-commit channel) — **built but inert in `block` mode** (see Known limitation).
- `hooks/tests/check-test-integrity-l1.test.sh` — 58 L1 acceptance assertions (per-runner shrink/ok, broken-runner, multi-package build-fail, override inertness).
- Design spec: `docs/projects/_archive/2026-06-26-test-integrity-l1/design-spec.md` (v4, with the 4-round review history).

### Changed
- `scripts/check-test-integrity.sh` description + CLAUDE.md inventory row + `skills/quality-pipeline/references/test-integrity-gate.md` updated to document the L1 layer. Two L0-test assertions isolated with `--no-l1` (L0-scoped cases that L1 now legitimately augments; no L0 assertion removed or loosened).

### Known limitation
- **Block-mode override HONORING is DEFERRED** (ruling: ship detection + warn + block-hard-fail now). A block-mode `executed_set_shrink` is a hard fail with NO honored override until a worker **descendant-containment** mechanism stronger than pgid-emptiness lands. Reason: in the linked-worktree `/l5` dispatch model a same-user worker can forge the override channel, and `--assert-worker-dead <pgid>` doesn't stop a `setsid`-escaped descendant — this is honestly out of threat model for a same-user shell until `dispatch-hetero.sh` is hardened (own-session + tree-sweep reap on all exit paths). Refusing a forgeable waiver is fail-safe. See design-spec §8.3.

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.25.6 — L0 test-integrity gate (anti-gaming forcing function)

**Headline**: A new deterministic, git-artifact-based quality-pipeline gate that stops a delegated implementer from gaming tests to go green — by deleting / skipping / soloing / weakening existing tests or escaping the test surface. Born from the `delegate-selftest-false-green` lesson. Default `warn` (shadow→calibrate→gate); `block` is opt-in per project for `/l5` hetero dispatch.

### Added
- `scripts/check-test-integrity.sh` — L0 static gate. `validate --range <base>..<head>`: test-path **additions-only** (`deleted_line` catches in-place assertion weakening + deletion), skip/solo-marker denylist (`xit`/`.only`/`fit`/`fdescribe`/`@pytest.mark.skip`/`t.Skipf`/`#[ignore]`/…), `rename_escape` (test→non-test path), `surface_touch` (conftest/fixtures/runner-config/CI — independent of test-path), and **non-waivable** `protected_path_touch`/`malformed_config`/`git_error`. **Config read from the trusted base ref** so a candidate's in-diff `mode:off`/bogus `test_paths` is ignored. JSON; exit 0/1/2.
- `project-config-template/test-integrity-config.md` — per-project `mode`/`test_paths`/`surface_paths` overrides.
- `skills/quality-pipeline/references/test-integrity-gate.md` + wiring (SKILL Available Scripts + Sub-step References + CLAUDE.md inventory).

### Changed
- quality-pipeline gains the test-integrity gate as a post-impl / pre-merge step.

### Known limitation
- The override (`.qc/<sha>.verdict.json`) is a **fail-safe stub**: committed-only (untracked forgery rejected), but a legitimate override is currently unconstructable (commit-SHA↔filename fixed-point). It fails closed. Full depth-0 override provenance **and** the L1 executed-set/collection-invariance layer are deferred to a follow-up **L1 project**.

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.25.5 — scope-creep forcing function + OpenCode preflight retry

**Headline**: Two fixes revived from a long-lived branch (`fix/scope-creep-gate-forcing-function`, written 2026-06-05/10) and re-landed on current develop. (1) The S→L **scope-creep gate** in `dev-flow` and `ceo-agent` becomes a real forcing function: an `S-scope-gate` **TaskCreate** created at S-start (which the system-reminder surfaces before every tool use) replaces the old passive "self-check after every commit" markdown — passive bullets get mentally compressed into "I know this", which is exactly the failure mode. The L-side gets a distinct **L-scope-expansion → Board Decision** path (a doubled estimate or new subsystem maps to DOA "Resources 2x+", which the CEO cannot approve unilaterally). (2) The OpenCode skill-discovery preflight check now retries (3×) to absorb a cold-start false negative. The branch's third commit (a now-obsolete BACKLOG nested-subagent proposal, superseded by the v2.14.0 ✅ entry) was dropped.

### Added
- `dev-flow` / `ceo-agent`: **`S-scope-gate` TaskCreate** at S-start — a pending task that surfaces the three S→L indicators (≥3 commits / ≥3 modules / features beyond goal) before every commit. S creates exactly one TaskCreate (intentionally minimal vs L's infra). New anti-pattern table rows guard against skipping it, evaluating it only at task-end, or a CEO approving L-scope expansion unilaterally.

### Changed
- `dev-flow` / `ceo-agent` **Scope Creep Detection**: split into two explicit escalation paths — S→L (enforced by the TaskCreate) and L-scope-expansion (Board Decision, mapped to the existing DOA "Resources 2x+ / Scope expansion" entries). CEO mode provides no exemption. S Workflow renumbered (4→5 steps) to add the pre-commit scope evaluation.

### Fixed
- `scripts/preflight-portability.sh` — `check_opencode_skill_discovery()` now retries up to 3× (1s apart) before failing. OpenCode's first cold invocation can return a partial skill listing before discovery finishes indexing `.agents/skills/`, which intermittently failed the gate as a false negative (documented flake).

## v2.25.4 — finish-flow L-size branch cleanup (close the leak)

**Headline**: Fixed a flow defect that left a `feat/*` branch behind after every L-size ship. `finish-flow`'s **L-5** closing sequence had no branch-deletion sub-task — unlike Fix (`F.5`) and Hotfix (`H-9.5`), which delete theirs — so L-ships silently accumulated stale local **and** remote branches (discovered when a cleanup found `feat/task-tree-engine`, `feat/tree-role-dispatch`, `feat/l4-l5-dep-graph-fanout` and others never removed). This is a workflow gap, not a git setting: git does not auto-delete a local branch on merge, and GitHub's "auto-delete head branch" only fires on PR merges (this repo merges directly).

### Added
- `finish-flow` **L-5.7 "Delete merged branch (local + remote)"** sub-task — mirrors `F.5`/`H-9.5`: verify merged, then `git branch -d` + `git push origin --delete` (if pushed), with `git branch` + `git ls-remote` confirmation. L-5 is now **7 sub-tasks**.

### Changed
- `F.5` / `H-9.5` hardened to delete the **remote** branch too (`git push origin --delete`), not only the local one — remote branches were accumulating as well.
- Synced the L-5 sub-task count (6→7) across the references in `dev-flow` (the `L-5:` parent-task TaskCreate + the L-5 section) and `ceo-agent`. H-size remains 6.

## v2.25.3 — Pure-Node.js core: jq/python3-free runtime + validation scripts

**Headline**: Ported autopilot's core runtime and validation scripts to **pure Node.js**, removing the `jq` and `python3` dependencies from the runtime and preflight paths so the engine runs flawlessly in dependency-minimal sandboxes (e.g. Antigravity/`agy`). Seven scripts were rewritten — `risk-counter`, `toggle-payload-capture`, `session-start` (hook), `doc-drift-gate` (was `.py`), `check-node-report`, `tree` (the task-tree engine), and `qc-panel` — and their shell/python originals deleted (no wrapper shims; `hooks.json` and all wiring now point at the `.js` entrypoints). All 57 hook test files and the 16-check portability preflight pass with `jq`/`python3` stubbed to fail.

### Added
- `scripts/{risk-counter,toggle-payload-capture,doc-drift-gate,check-node-report,tree,qc-panel}.js` + `hooks/session-start.js` — pure-Node ports.
- `TREE_LOCK_TIMEOUT_MS` env knob on the tree engine's lock acquire (default 10000) + a live-owner-no-steal regression test (`tree-engine.test.sh` TEST 4b).

### Changed
- Runtime + preflight no longer depend on `jq` or `python3` (`git` is still required). Tool-event wiring (`hooks.json`, `settings.example.json`) references the `.js` entrypoints.

### Fixed
- **tree.js lock mutual-exclusion** (found in pre-merge review): the stale-lock check stole a lock from a **live but slow** owner once its lock aged past a fixed 10s TTL → concurrent appends could tear the JSONL. Now a local owner's staleness is decided by **PID liveness only** (a live owner is never stale → contenders fail closed, matching `flock -w`); a wall-clock TTL applies only to cross-host owners (60s, decoupled from the acquire timeout). Busy-wait spin replaced with a kernel sleep; `fetch --raw` is now binary-safe (Buffer, no utf8 re-encode).
- **qc-panel.js false-PASS race** (found in pre-merge review): Judge A read its stdout file before the write stream flushed → a dropped trailing chunk could lose a `MISSED:` line and flip the gating verdict to a false PASS. Now buffers stdout in memory like Judge B. Synth-omitted `dissents`/`extras` default to `[]` (shell parity); large-stdin spawns get EPIPE handlers.
- Ported scripts now print their own `.js` name (not the deleted `.sh`) in `--help`, usage, and error prefixes.

### Rollback
- Maintainer: `git revert <merge-sha>`. The deleted shell/python scripts are recoverable from history; re-pointing `hooks.json` to a `.sh` requires restoring that script too.

## v2.25.2 — cost-tracker re-enabled (transcript-sum); zero disabled hooks

**Headline**: The last shipped-but-disabled hook, `cost-tracker`, is fixed and re-enabled (opt-in) — autopilot now has **zero disabled hooks** (8 default-on + 12 opt-in). The blocker was never stdin (fd 0 works): the Claude Code 2.1.186 Stop payload simply carries no `usage` field, so the old hook always early-exited at 0 tokens. The rewrite reads `transcript_path` from the Stop payload and sums per-turn `message.usage` from the transcript. Because the Stop hook fires once per assistant turn and the transcript is cumulative, it keeps a per-session cursor (`~/.claude/metrics/.cursors/<session>.json`) and logs only the turns added since the last Stop — so summing all rows in `costs.jsonl` equals the true session cost with no double-count. Cost is **cache-aware** (cache reads billed at 0.1×, 5-minute cache writes at 1.25× the model's input rate), which matters because cache-read tokens dominate a real autopilot session by ~40:1. Opt-out unchanged: `AUTOPILOT_COST_TRACKER=false`.

### Added
- `hooks/cost-tracker-lib.js` — pure, testable usage/cost aggregation (`parseAssistantTurns` / `aggregateSince` / cache-aware `costOf`), separated from the hook's IO so the cursor-delta math is unit-tested.
- `hooks/cost-tracker.test.js` (10 L1 unit tests) — parse/skip-malformed, model-substring pricing (incl. unknown→sonnet default), cache multipliers, cursor delta, shrink/re-baseline (no double-count), and an integration check that per-Stop deltas sum to the one-shot total.

### Changed
- `cost-tracker` moved disabled → **opt-in** in `settings.example.json` (Stop). Hook tally: opt-in 11→12, disabled 1→0 (total still 20). Reconciled across the 4 canonical descriptions, README.md / README.zh-TW.md / hooks/README.md tier tables, and `check-hook-inventory.js`'s prose-tally assertions (re-anchored off the removed "shipped-but-disabled" sentence).

### Fixed
- `cost-tracker` no longer no-ops: it read a `usage` field the Stop payload doesn't have. Now sums from the transcript via `transcript_path`. End-to-end verified against a real 287-turn transcript (cold-cursor full sum + per-turn delta + no-new-turn no-op + opt-out + fail-open).
- `hooks/tests/sync-version-preserve-counts.test.sh` + `hooks/tests/check-hook-inventory.test.sh`: de-coupled from the live disabled count (was hardcoded to 1 / required a non-zero disabled tier) so they survive disabled→0.

### Rollback
- Maintainer: `git revert <merge-sha>`
- User-side: remove the `cost-tracker` Stop entry from your `settings.json` (it's opt-in — default installs are unaffected). Optional cleanup: `rm -rf ~/.claude/metrics/.cursors/`.

## v2.25.1 — Versioning rule documented + sync-version count-preservation fix

**Headline**: Pinned the semver bump policy that was previously only de-facto, and fixed a real footgun in the release tooling. The bump rule (now in `CLAUDE.md` § Versioning): **MINOR** advances only for a new user-facing milestone (a new **skill** or **agent**); a new **script / hook / reference**, a bug fix, or hardening of existing behavior is **PATCH**; breaking changes are **MAJOR**; pure docs/tests/dev-tooling don't bump. This keeps the second digit a meaningful "new thing users invoke" counter instead of inflating on every internal addition. Separately, `scripts/sync-version.js` no longer silently clobbers the opt-in / disabled hook tiers when those flags are omitted (the v2.20.0 footgun): omitted counts are now **preserved from the canonical description**, with the historical literals (opt-in 7 / disabled 0) only as a last-resort fallback when canonical is unparseable. This release dogfoods the fix — it was bumped by omitting `--opt-in-count` / `--disabled-count` and the `11 opt-in, 1 disabled` tiers survived intact.

### Added
- `CLAUDE.md` § **Versioning (semver bump rule)** — MAJOR/MINOR/PATCH/no-bump table tied to the user-facing-milestone policy, plus bump mechanics + the finish-flow release gate pointer.
- `hooks/tests/sync-version-preserve-counts.test.sh` (9 assertions) — regression guard: a bump omitting `--disabled-count`/`--opt-in-count` must PRESERVE the canonical tiers (not clobber disabled→0), an explicit flag still overrides, mirrors stay in sync. Sandboxed; live repo untouched.

### Fixed
- `scripts/sync-version.js` — omitting `--opt-in-count` / `--disabled-count` previously defaulted them to 7 / 0, silently rewriting e.g. "20 hooks (8 default-on, 11 opt-in, 1 disabled)" → "...(13 default-on, 7 opt-in)" and dropping the disabled tier. Now backfilled from the canonical description's current values (new `readCanonicalCounts()`); literals apply only when canonical can't be parsed. Closes the BACKLOG footgun entry hit during the v2.20.0 bump.

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.25.0 — Anti-gaming dispatch-suppression linter + plan Global Constraints

**Headline**: The two dialectic-converged learnable items from the 2026-06-24 survey of `obra/superpowers` v6.0.3 + `garrytan/gstack` (a 2-round Architect/Ops/Skeptic dialectic that **cut** the runtime/browser-QA and UX-axis candidates as selection bias — two UI-oriented repos sharing a UI bias, not an autopilot gap). What shipped: a new anti-gaming linter that catches a dispatcher **coaching the reviewer to go soft** — telling it to suppress a finding or pre-rate its severity ("call it Minor at most", "don't treat X as a defect", "ignore/skip the auth path", "downgrade it to minor", "leave the race condition alone"). This is a **distinct adversarial class** from the round-cycle leakage its sibling `check-redispatch-prompt.sh` already covers, and it runs on **every** dispatch (round 1 included). Patterns are anchored to imperative-suppression grammar so honest calibration ("don't over-flag minor nits"), severity vocabulary, scope statements, and real security instructions ("treat X as untrusted data") all pass — verified by an adversarial reviewer running the linter over the entire `reviewer.md` + `code-review.md` (both clean). Plus a plan-template **Global Constraints** block (verbatim invariant propagation) and an honest note about the standalone red-green-TDD gap. Adapted from superpowers v6's `subagent-driven-development` anti-gaming reviewer contract + `writing-plans` global-constraint block.

### Added
- `scripts/check-dispatch-suppression.sh` (+ `hooks/tests/check-dispatch-suppression.test.sh`, 16 assertions) — anti-gaming linter for any dispatch prompt; sibling of `check-redispatch-prompt.sh`. Exit 0 clean / 1 coaching found / 2 usage; plaintext markers on stderr. Wired into `references/blind-dispatch.md` (anti-gaming pre-flight) + the CLAUDE.md scripts inventory.
- `references/plan-template.md` §2.5 **Global Constraints** — verbatim-propagated plan-level invariants (version floors / dep limits / exact values) copied unchanged into every implementer + reviewer dispatch; single canonical statement; per-task Interfaces folded into the existing six-element `input`/`output`, not a parallel block.

### Changed
- `skills/test-strategy/SKILL.md` Coexistence + `README.md` / `README.zh-TW.md` scenario B — state the standalone red-green-refactor TDD gap honestly: autopilot ships no native `tdd` skill (that loop is superpowers' lane; duplicating it would violate the skill-proliferation discipline). For TDD standalone, install `superpowers` or run red-green by hand.
- `README.md` / `README.zh-TW.md` `Inspired By` — credit `obra/superpowers` for E1/E2; fixed a stale gstack URL (`garry-t` → `garrytan`).

### Also (doc hygiene bundled in this branch)
- Fixed the dead `superpowers:code-reviewer` reference (removed in superpowers v5.1.0 → `requesting-code-review`) across README EN+zh, `project-config-template/`, and autopilot's own `.claude/` configs.
- Fixed un-gated prose doc-staleness a 4-facet sweep found: skill count `20`/`16` → `23` (CLAUDE.md, AGENTS.md, .opencode/README.md), the README FAQ's deprecated "rule-setter / executor" framing, a wrong repo URL (`TWGS` → `cookys`), a dead archived-project path, and a dead skill-arrow (`→ systematic-debugging` → `→ debug`).

## v2.24.0 — QC-panel refute pass (shadow) + no-silent-caps disclosure clause

**Headline**: Two adjudicated review-discipline upgrades. (1) `scripts/qc-panel.sh` gains a 4th question shape — a **refute pass** that turns the panel's skepticism on itself: for each candidate `MISSED:` finding, the OTHER cross-family judge tries to refute it, and a miss survives only by explicitly defeating refutation (`default-refuted-if-uncertain`). It is **SHADOW / non-gating** — the authoritative verdict is unchanged (any non-empty `MISSED:` still fails exactly as before); the result rides alongside as `refute_shadow` and into the calibration sample for feed-forward measurement, and may only become gating after `calibration.sh` / `run-known-bad` proves it does not false-suppress critical findings. (2) A shared **no-silent-caps** clause — *any bounded coverage (top-N / per-segment / sampled / skipped-on-timeout) MUST be disclosed in the verdict; an undisclosed bound is a defect* — added to the reviewer and audit output contracts, generalizing `skills/doc-sync`'s existing "a clean sweep only means this sample found nothing" ethos.

### Added
- `scripts/qc-panel.sh`: refute pass (Q4) — per-miss cross-family refutation, `default-refuted-if-uncertain`. New `refute_shadow:{refuted_misses[],survived_misses[]}` field in the panel JSON; refute summary tag (`refute=refuted:N,survived:M,gating_misses:K`) appended to the calibration sample's `--source`. **Non-gating**: does not alter `verdict`; Amendment-4 liveness (artifact + sample) preserved. Verified by the existing `hooks/tests/qc-panel.test.sh` (39 assertions) + survives/clean-pass smokes; shellcheck clean.

### Changed
- `skills/quality-pipeline/references/code-review.md`: documents the finding-survival refute rule (marked SHADOW / non-gating-until-calibrated) and adds the "No silent caps — disclose every bound" clause.
- `skills/audit/SKILL.md`: Phase-2 output contract gains the no-silent-caps disclosure rule (which segments were / were NOT covered), citing doc-sync as the generalized source pattern.
- `agents/reviewer.md`: one-line no-silent-caps reference under the Exhaustiveness Red Line, pointing to the canonical clause.

## v2.23.0 — Re-enable the parked hooks via the `/dev/stdin`→fd-0 fix (and pin the one real data-gap)

**Headline**: The v2.7.4 batch disabled `branch-protection`, `commit-secret-scan`, `large-file-warner`, `session-summary`, and `cost-tracker` believing the hooks "get no stdin" — and the project spent months treating the PreToolUse ones as permanently blocked on upstream #6305. A fresh end-to-end spike on Claude Code **2.1.186** found the diagnosis was too broad: it's only the **`/dev/stdin` PATH open** that throws ENXIO in the Bun-spawned hook environment — the payload **is** delivered on **file descriptor 0** (true for PreToolUse *and* Stop). Reading fd 0 directly (`fs.readFileSync(0)`, the fallback chain `failure-escalation.js` already used) recovers it. **4 hooks re-enabled opt-in**: the 3 PreToolUse blockers + `session-summary`. The 5th, `cost-tracker`, stays disabled — but for the *correct* reason: fd 0 works, yet the 2.1.186 Stop payload carries **no `usage` field**, so it would always early-exit at 0 tokens; re-enabling needs a transcript-sum rewrite, not a stdin fix. Shipped opt-in (not default-on) because hard-blocking commits/reads is a per-project policy call. Verified e2e against live 2.1.186 (a real PreToolUse hook returning exit 2 blocked the tool; Stop probe showed the payload shape) + `reenabled-blockers.test.sh`.

### Added
- `hooks/tests/reenabled-blockers.test.sh` — positive block/allow regression for the 4 re-enabled hooks (PreToolUse blockers block+allow both directions; session-summary writes its md). 49 test files total.

### Changed
- `branch-protection`, `commit-secret-scan`, `large-file-warner`, `session-summary`, `cost-tracker`: read fd 0 (`fs.readFileSync(0)`) with a `/dev/stdin` fallback instead of opening the broken path.
- `settings.example.json`: 4 new opt-in entries (3 PreToolUse + session-summary/Stop). Hook tally membership shifts **disabled 5→1, opt-in 7→11** (default-on still 8, total still 20); reconciled across the 4 canonical descriptions, README.md / README.zh-TW.md / hooks/README.md tier tables, and `check-hook-inventory.test.sh`.
- `transcript-reader-lib.js`: comment corrected — the transcript route is a recovery/fallback, not the only option; fd 0 works.

### Fixed
- The "PreToolUse hooks are permanently unrecoverable" claim (BACKLOG + hooks/README) was over-broad: only the `/dev/stdin` path is broken, not fd 0.

### Known limitation
- `cost-tracker` remains disabled: the Claude Code 2.1.186 Stop payload has no token-`usage` field (keys: session_id, transcript_path, cwd, permission_mode, effort, stop_hook_active, last_assistant_message, background_tasks, session_crons). A transcript-sum rewrite is tracked in BACKLOG.

### Rollback
- Maintainer: `git revert <merge-sha>`
- User-side: remove the new entries from your `settings.json` (they are opt-in; default installs are unaffected).

## v2.22.0 — Anti-skip qc-gate forcing function (config-driven)

**Headline**: A configurable forcing function that makes "merged/pushed without a qc gate" a **loud, deliberate, logged** act instead of a silent default — born from a real miss where doc fixes were merged to develop before the qc reviewer ran. Strength is **per-project**, resolved like every other autopilot gate (`.claude/<thing>-config.md` override + template default + a `resolve-*.sh` script). A `.githooks/pre-push` hook refuses to push a commit range touching a **protected path** (`skills/agents/scripts/references/hooks/`) without **review evidence** (a `QC-Verdict: PASS` git trailer or a `.qc/<sha>.verdict.json` artifact). `mode: block | warn | off` per project; fail-closed to `block`; `git push --no-verify` is the deliberate, logged bypass. A hook enforces evidence *existence*, never *quality* — the goal is to flip the default, not seal it. Sibling of DOA: DOA governs *dispatch authority*, qc-gate governs *merge/push review*.

### Added
- `scripts/resolve-qc-gate.sh` — resolves `{mode, protected_paths, evidence, source}` JSON from `.claude/qc-gate-config.md` (cwd → repo → template), garbage/missing → `block` fail-closed.
- `project-config-template/qc-gate-config.md` — shipped default (`block`, protected paths, `trailer` evidence) + field reference.
- `.githooks/pre-push` — the enforcer; consults `resolve-qc-gate.sh`, blocks/warns per `mode`. Degrades open (exit 0) if the resolver is absent.

### Changed
- `scripts/install-hooks.sh` — header now lists `pre-push` (auto-installed via the existing `.githooks/*` glob + chmod).
- `skills/finish-flow/SKILL.md` L-5.3 (+ F.4/H-9.3) — merge commit MUST carry the `QC-Verdict: PASS (reviewer <id>, <date>)` trailer once the pre-merge gate passes.
- `skills/quality-pipeline/SKILL.md` — scripts table row: on PASS, stamp the landing commit with the trailer.
- `CLAUDE.md` — scripts-inventory row for `resolve-qc-gate.sh`.

### Note
- Dogfood: this change is landed THROUGH the gate — the qc reviewer ran on the diff (caught a fail-OPEN CSV-spacing bug, fixed before merge), and the merge commit carries the `QC-Verdict: PASS` trailer.

## v2.21.1 — Worktree-base correction: `worktree.baseRef` supersedes the STEP-0 reset

**Headline**: A baseRef spike (CC 2.1.186) corrected a stale invariant in the `/l4 /l5` front-door docs. `Agent(isolation:"worktree")` was documented as exposing **no base parameter**; in fact CC's **`worktree.baseRef` setting** (`fresh`|`head`, added 2.1.133) selects the native worktree base. Empirically re-verified 2.1.186 with a sentinel-commit probe: `worktree.baseRef:"head"` forks the foreman from the CEO's **local HEAD**, and it takes effect **in-session, no restart** (read from any settings tier incl. project-local `.claude/settings.local.json`). The `git reset --hard <CEO-HEAD-sha>` STEP-0 dance is now the **portable fallback** (non-CC, or when the setting can't be set), not the primary fix. Separately: the `/l5` hetero impl uses its own `git worktree add --base` mechanism — untouched by `worktree.baseRef` — and must be passed `--base "$(git rev-parse HEAD)"` to build on un-merged work.

### Fixed
- `skills/ceo-agent/references/level-front-door.md` worktree-base section + base-currency decision table + Gotchas: corrected "no base parameter" → `worktree.baseRef` (`fresh`|`head`); made `worktree.baseRef:"head"` the primary Claude-Code build-on-un-merged-work path and the `git reset` STEP-0 a portable fallback.
- `level-front-door.md` `/l5` topology bullet: documented that `dispatch-hetero.sh`'s `--base` (default local `develop`) is a **separate** mechanism `worktree.baseRef` does not reach; added the `--base "$(git rev-parse HEAD)"` forcing function.
- Empirical basis: in-session sentinel-probe spike (CC 2.1.186) — default `fresh` → sentinel absent (`origin/develop`); `worktree.baseRef:"head"` → sentinel present (CEO local HEAD).
- `level-front-door.md`: added a **"Visibility & control surface"** subsection — a matrix of what CC displays + what's connectable per dispatch kind. Key asymmetry made explicit: `/l4` foreman (native Agent) is shown + controllable via `TaskList`/`TaskGet`/`TaskOutput`/`TaskStop`/`Monitor`; Workflow has the `/workflows` live tree but no worktree isolation / no hetero; the `/l5` hetero leaf is a **Bash subprocess outside the subagent surface** — only `tail -f <agent_log>` + git artifacts, no live CC display.

## v2.21.0 — `/l3 /l4 /l5` CEO front-door + dispatched foreman

**Headline**: CEO mode gains a terse front-door. `/l3 /l4 /l5 <goal>` enter `ceo-agent` with the four startup questions pre-filled and set the execution posture — `/l3` runs inline, `/l4` dispatches **one background, worktree-isolated `sub-orchestrator` foreman** that runs dev-flow unattended while the CEO holds a **depth-0 control loop** (budget cap → `TaskStop` + escalate; outcome→action table; merge-back; worktree GC) and the **authoritative qc verdict**, and `/l5` adds a heterogeneous (agy/Gemini) implementer via the already-built `dispatch-hetero.sh`. The depth-0 kill+reap mechanism was verified empirically by the P0 spike. Deferred behind their own gates: full `role × task-type` routing table, engines beyond Claude+Gemini, tree-engine coordinator, multi-node fleet.

### Added
- **`skills/l3`, `skills/l4`, `skills/l5`** — thin slash-command front-doors into `ceo-agent` (skills 20 → 23).
- **`skills/ceo-agent/references/level-front-door.md`** — full front-door + dispatched-foreman semantics: topology (CEO depth-0 → foreman depth-1 → impl/review depth-2, depth-3 escalates), the P0-verified background-`Agent` + `TaskStop` kill + worktree-reap mechanism, depth-0 control loop, outcome→action table, qc@depth-0 vs foreman first-pass, run-summary ledger.

### Changed
- **`scripts/dispatch-hetero.sh`** — outcome + precondition JSON now carry `runner`/`model` **engine provenance** (`runner` always `"agy"`, `model` echoes `--model`) for the caller's run-summary ledger. Doc-synced: `references/hetero-dispatch.md`, `CLAUDE.md` inventory.
- **`skills/ceo-agent/SKILL.md`** — new "/lN front-door & dispatched foreman" pointer section.
- **`skills/team/references/team-tactics.md`** — new "Dispatched-Subagent Return Contract" section: a 4-value status enum (`DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`) with the orchestrator's action per status (BLOCKED → re-scope/escalate, never a silent drop). Shipped as the **`/l4` dogfood payload** of this release.
- **`level-front-door.md` worktree-base contract** — made explicit (verified by probe) that `Agent(isolation:"worktree")` branches the foreman off **`origin/develop`**, never the CEO's HEAD, with **no base parameter** to override; added a base-currency **STEP-0 decision table** (independent task → clean develop base; build-on-un-merged-CEO-work → foreman STEP 0 = `git reset --hard <CEO-HEAD-sha>`). Resolves the dogfood's self-referential edge (the `/l5` foreman ran develop's pre-feature tooling).

### Fixed
- **`scripts/resolve-doa.sh`** — apply the `valid_token` (`^[A-Za-z0-9._-]+$`) allowlist to the override-config **Preset column** before it reaches the `printf`-built JSON, mirroring the v2.17.0 `resolve-dispatch.sh` hardening; an invalid token warns to stderr and falls through to defaults. Shipped as the **`/l5` (hetero/Gemini) dogfood payload** of this release.
- **`hooks/tests/check-readme-parity.test.sh`** — the EN↔zh skills-badge drift negative test hardcoded the old count (`skills-20-`), silently no-opping its drift injection after a count bump; wildcarded to `skills-[0-9]+-` so it self-maintains.
- **`scripts/dispatch-hetero.sh` orphan-branch leak** — `git worktree add -b` creates the branch ref before the dir (verified), so a dir-creation failure left a stale branch and locked the next run ("branch already exists"); now reaped on the failure path, plus an `INT`/`TERM` trap (disarmed once agy returns) reaps worktree+branch if interrupted mid-run. Cleanup recipe also added to `references/hetero-dispatch.md` + `level-front-door.md §5`.

### Rollback
- Maintainer: `git revert <merge-sha>`
- User-side: `/plugin update autopilot @v2.20.0`

## v2.20.0 — doc-sync gains a deterministic gate (Layer 1)

**Headline**: `autopilot:doc-sync` is now a **two-layer** system. Layer 1 is a deterministic gate — zero-variance checks that *always* catch their class, so it's a **reliable stopping condition** and gate-able in CI. The shipped baseline (`scripts/doc-drift-gate.py`) does links + code-fence balance; projects extend it with their own mechanizable checks (version-sync, CLI-surface-vs-docs, roadmap-consistency — see codeforge's `scripts/check-doc-drift.py`). Layer 2 is the existing LLM sweep, reframed as **discovery** (non-deterministic — never loop it to zero). Converging workflow: when the LLM sweep finds a mechanizable drift class, demote it into the gate. This resolves the core flaw of an LLM-only design — a "clean" sweep only means *this sample* found nothing, never that nothing exists (proven by codeforge's 7-round non-convergent trajectory).

### Added
- **`scripts/doc-drift-gate.py`** — portable, project-agnostic Layer-1 baseline: internal-link resolution + code-fence balance over a configurable doc set, zero-config, zero-false-positive (skips placeholders, GitHub-relative conventions, extensionless targets). Projects adopt + extend with project-specific checks. Exit 0/1 → CI-gate-able.
- **`project-config-template/doc-drift-config.md`** — new `gate_command` field (the project-local Layer-1 command doc-sync runs first).

### Changed
- **`skills/doc-sync/SKILL.md`** — new "Two layers" section: deterministic gate (run FIRST, reliable) vs LLM discovery (non-deterministic, don't loop-to-zero); the demote-into-gate convergence loop; bootstrapping guidance. Description updated.

## v2.19.1 — hook inventory single source of truth

**Headline**: Reconciled four mutually-inconsistent hook tallies into one derived source of truth. Before: `plugin.json`/`CLAUDE.md` said "19 hooks (12 default-on, 7 opt-in)", README badges said 19/14, README Tier-A tables listed the 5 *disabled* hooks as default-on while omitting the 5 actually-wired ones, and the zh-TW badge said 14. After: every doc reads **20 hooks (8 default-on, 7 opt-in, 5 disabled)**, derived mechanically from real wiring (`hooks.json` + `settings.example.json`) by the new `scripts/check-hook-inventory.js`, which gates both counts AND per-tier membership.

### Added
- **`scripts/check-hook-inventory.js`** — single source of truth for the hook tally. Derives default-on (`hooks.json`), opt-in (`settings.example.json` `hooks-opt-in-examples`), and disabled (`hooks/*.{js,sh}` wired in neither) from real wiring. Default run prints the canonical lists (regeneration oracle); `--check` asserts every doc agrees on counts **and** per-tier membership — catching the count-blind failure class (a disabled hook listed as Tier-A default-on while the headline number still "looks right"). Wired into `preflight-portability.sh` (now 14 checks).
- **README.md / README.zh-TW.md / hooks/README.md** — new "Shipped but Disabled (5 hooks)" section documenting the 5 v2.7.4-parked hooks (PreToolUse blockers gated on upstream #6305; Stop-event hooks pending separate re-verification).

### Fixed
- **Hook counts across `.claude-plugin/plugin.json`, root `plugin.json`, `.claude-plugin/marketplace.json`, `CLAUDE.md`** — `19 (12 default-on, 7 opt-in)` → `20 (8 default-on, 7 opt-in, 5 disabled)`.
- **README.md + hooks/README.md Tier-A tables** — rebuilt to the **correct** 8 default-on members (state-checkpoint, session-start, intent-capture, reload-watch, audit-log, log-error, failure-escalation, suggest-compact); the 5 disabled hooks moved out of default-on. Tier-B header 6 → 7. README badges 19/14 → 20. zh-TW Tier-B 6 → 7.

### Changed
- **`scripts/sync-version.js`** — de-coupled from hook-count *ownership*. It now mirrors the canonical description's hook fragment verbatim (3-tier aware via `--disabled-count`; default-on = hook-count − opt-in − disabled) but no longer writes the README hooks badge or `hooks/README.md` — those belong to `check-hook-inventory.js`. Its 6-scenario test suite + sandbox lib + AGENTS.md bump recipe updated accordingly. `sync-version.js --check` and `check-hook-inventory.js --check` are now orthogonal gates.
- **`CLAUDE.md` + `AGENTS.md`** — scripts inventory + verification sections document the new script and the sync-version ownership split.
- **`docs/BACKLOG.md`** — the 2026-06-22 "hook inventory reconciliation" and 2026-06-02 "Hook tally is stale" entries (same drift, two records) resolved and folded; new entry logs the residual zh-TW skill-count "16" staleness (separate, deferred).

### Not changed (deliberate)
- Period-accurate historical counts left as-is: README "v2.5 added 14 hooks", the devteam-absorb narrative "14 of devteam's 15 hooks (8 default-on Tier A + 6 opt-in Tier B)", and CHANGELOG history.

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.19.0 — doc-sync skill (doc↔code drift audit)

**Headline**: New `autopilot:doc-sync` skill — an on-demand doc↔code drift audit that finds WRONG / STALE / MISSING documentation claims, adversarially verifies each to kill false positives, and reports (graded by severity, report-only — never edits). Closes a real gap: autopilot previously had only a 25-line manual `post-feature-doc-sync.md` checklist and no automated drift detection. Born from a codeforge audit that found 48 confirmed drift items in a mature repo.

### Added
- **`skills/doc-sync/SKILL.md`** — dispatcher + methodology skill. Two modes: **scoped** (cheap, audits only docs for the modules a diff touched — the L-size default) and **full** (whole-repo sweep across domains — periodic / big-change, OFFER-only). Method: per-domain find → adversarial verify → grade. Portable: default `native` subagent fan-out, with a Claude-Code `Workflow`-tool fast path when the project ships one (capability-gated; never a hard dependency, so it runs on OpenCode / Codex / Antigravity too).
- **`project-config-template/doc-drift-config.md`** — per-project domain definitions (docs↔code slices), preferred-auditor pointer, staleness threshold, fix policy.

### Changed
- **`project-config-template/dispatch-config.md`** — new `## Doc Drift Audit` preference chain (`workflow:<path>` CC fast-path → project skill → `native`).
- **`skills/finish-flow/SKILL.md`** — L-5.4 (Post-Merge Review) now invokes `autopilot:doc-sync` (scoped) when a change touched user-facing behavior / 3+ modules; OFFER full for large ships. Still 6 sub-tasks (folded into L-5.4, not a new sub-task).
- **`skills/dev-flow/references/post-feature-doc-sync.md`** — points to the new automated `doc-sync` skill alongside the manual checklist.

### Fix policy (documented in the skill, not auto-applied)
- User-facing docs → always correct to code reality. Specs → pure STALE fixed in place; genuine design-target-not-yet-built kept + marked `NOT YET IMPLEMENTED` + BACKLOG.

## v2.18.0 — dispatch outcome signals + canonical-invariant gate (tmuxai/ponytail absorptions)

**Headline**: absorbs two cross-agent-orchestration learnings without adopting their mechanisms. From **tmuxai** (a TUI-scrape orchestrator we explicitly chose *not* to emulate): hetero dispatch now emits caller-readable outcome signals instead of a black-box timeout — `dispatch-hetero.sh` splits the no-commit case into `no_op` (exit 0, agent legitimately did nothing) vs `question_suspected` (timeout/non-zero, likely paused on a clarifying question that auto-approve never suppresses), and `AGENT_EXIT==0` is now required for `committed` (closing a blind spot where a non-zero exit with a clean commit scored success) — all from git artifacts, zero stream parsing, agy path byte-for-byte unchanged. From **ponytail** (a 13-platform skill-distribution): a `check-canonical-invariants.sh` gate enforces cross-file rule invariants by test, not discipline — `repeat` mode (a phrase must co-exist verbatim across files) and `reference` mode (a referenced anchor must still exist, exact-line) — wired blocking into pre-commit. `preflight-portability.sh` now asserts adapter targets *carry* their rules (≥2 seeded `name:` invariants), not merely resolve.

### Added
- `scripts/check-canonical-invariants.sh` — two-mode canonical-invariant gate (repeat + reference, inline seed table, same-commit update ritual); pre-commit blocking. Catches structural drift (anchor rename/deletion); body-reword stays a human-review concern by design.
- `references/blind-dispatch.md` — "clarifying questions survive auto-approve" gotcha (codex-confirmed #10187/#2138; Claude `-p` expected-not-yet-observed); pre-commit grep asserts the issue refs persist.
- `references/multi-agent-portability.md` — capability `Tier` column (full-plugin vs instruction-tier); flag corrections (Gemini `--yolo` REAL/doc-omitted; `kiro-cli chat --classic` UNVERIFIED).

### Changed
- `scripts/dispatch-hetero.sh` — four outcomes (`committed`/`failure`/`no_op`/`question_suspected`) + `AGENT_EXIT==0` in the success condition; agy invocation unchanged.
- `scripts/preflight-portability.sh` — 12→13 checks; new content-carrying adapter assertion.

### Verified
- New tests: `hooks/tests/{check-canonical-invariants,preflight-adapter-invariant,dispatch-hetero}.test.sh` — repeat-delete/reference-rename(superset)→exit 1, four-outcome split, adapter-stub→exit 1. Full suite green; `validate.sh` 19/19. Independent acceptance audit caught + fixed a `grep -F` substring false-pass in the reference gate (`-Fq`→`-Fxq`).

### Rollback
- Maintainer: `git revert <merge-sha>` (scripts + docs + tests; no schema/version-data change beyond the bump)

## v2.17.2 — remove `.opencode/skills/` leftover (drift surface, not a mirror)

**Headline**: deletes the 16 tracked `.opencode/skills/*` copies. They were a `bf0c637` (2026-05-22) leftover that the multi-agent-portability-correction plan already decided to remove (step 24) but never executed — OpenCode discovers all 19 skills through the canonical `.agents/skills/ → ../skills` symlink, which `preflight-portability.sh` check #11 verifies live (`opencode debug skill`). The copies had silently drifted (14/16 stale, 3 skills missing) because nothing kept them in sync, and a sync script would only have perpetuated the duplication the architecture was built to avoid. No behavior change: the README already points OpenCode users at `.agents/skills/`.

### Removed
- `.opencode/skills/` (16 skill copies) — redundant with the `.agents/skills/` symlink; eliminates the drift-surface class entirely.

### Verified
- `scripts/preflight-portability.sh` → 12/12 post-deletion, incl. check #11 (OpenCode discovers skills via `.agents/skills/`) and #8 (symlink resolves).

### Rollback
- Maintainer: `git revert <merge-sha>` (restores the copies; harmless but reintroduces the drift surface)

## v2.17.1 — qc-panel node-scope rule + tree-by-default for CEO L-tasks

**Headline**: closes the two operational gaps the v2.17.0 dogfood surfaced. (1) QC-panel judges now get an explicit **node-scope rule** — judge the node's own question/claims, never project-lifecycle steps (merge / gates / archiving) — fixing the systematic `fail` verdicts both live calibration samples showed on mid-flight nodes; calibration sampling becomes signal instead of a known artifact. (2) `tree.sh init` becomes the **default** in ceo-agent L-size project setup (Board directive 2026-06-12) so shadow calibration samples and the audit trail accumulate on every CEO L-ship; TaskCreate remains authoritative — zero authority change.

### Fixed
- `scripts/qc-panel.sh` — `SCOPE_RULE` injected into both judge prompts (Claude + Gemini) and the synthesizer's pass definition: out-of-scope lifecycle items never count as goals/extras/misses. Verified live: re-running the v2.17.0 `p0-impl` report under the rule flips the panel verdict fail → pass (dissents empty, ~42k tokens vs ~149k pre-fix), matching the authoritative reviewer — artifact preserved at `docs/projects/_archive/2026-06-12-tree-role-dispatch/tree/panel/p0-impl-2026-06-12T10-34-54Z.json` + `scope-rule-verify-sample.jsonl`.

### Changed
- `skills/ceo-agent/SKILL.md` Execution 3.c2 — `tree.sh init` + root-node emit is now part of mandatory L-1 project setup (skip only on explicit Board instruction); new anti-pattern row: archive (L-5.5) before final node verdicts.
- `skills/ceo-agent/references/tree-adapter.md` §9 — default-for-CEO-L note + **close-out ordering** rule: archived trees (`_archive/`) are read-only, emit all final verdicts before the archive move.

### Rollback
- Maintainer: `git revert <merge-sha>` (prompt text + skill prose only; no schema change)

## v2.17.0 — resolve-dispatch tree-role integration (`--tree`)

**Headline**: `scripts/resolve-dispatch.sh` now resolves task-tree roles. A new `--tree` context flag switches to the Amendment-11 tree table (sub-orchestrator→opus, planner/researcher/implementer→sonnet, judge/synthesizer→haiku) while the legacy table stays **byte-identical** — the `implementer`-key conflict (opus legacy vs sonnet tree) is resolved by context, not by renaming, so the role vocabulary stays shared with `scripts/resolve-doa.sh`. Closes the BACKLOG item deferred at v2.16.0 ship (R1 Fix 3). First ship dogfooding the ceo-agent tree adapter in dual-run shadow mode on a real task.

### Added
- `scripts/resolve-dispatch.sh --tree` — tree-role table; tree-path output carries `"table":"tree"` (legacy output unchanged, no new field); `--role manager --tree` refuses with named error `MANAGER_NOT_DISPATCHABLE` (exit 3) — "Fable is never dispatched" is now a tool-layer invariant, not just prose.
- Project override rows for tree roles: `tree:<role>` prefix in `.claude/model-routing-config.md` — coexists with legacy bare-role rows in one table, no collision in either direction (tested both ways). Template documented in `project-config-template/model-routing-config.md`.
- `hooks/tests/resolve-dispatch.test.sh` — 114 assertions: legacy byte-stability across all 7 roles, tree table, manager refusal, override isolation, sanitization, override-value injection protection, `--help` leak guard, malformed-override resilience.
- Hardening parity with sibling `resolve-doa.sh`: input sanitization (`$ROLE` flows into `grep -iE` — same injection vector, now closed) + `MODEL_ROUTING_CONFIG_OVERRIDE` env test seam.

### Fixed
- `scripts/qc-panel.sh` — calibration vocabulary bridge: node-report verdicts are free-form (`tree-contracts.md` §4: "approved"/"rejected") but `calibration.sh add-sample` only accepts `pass|fail`; the panel now normalizes (`pass|approved|approve|lgtm` → pass; `fail|rejected|reject` → fail) **before judges run**, and an unmappable verdict is a named `VERDICT_UNMAPPABLE` liveness failure instead of a generic add-sample error after a ~100k-token panel run. Found live by this ship's shadow-dogfood run (first reviewer-baseline calibration sample landed).

### Changed
- `references/model-routing.md` §Tree roles, `skills/ceo-agent/SKILL.md` + `references/tree-adapter.md` §6, `CLAUDE.md` inventory — "integration deferred / would return wrong models" notes replaced with `--tree` usage.
- `docs/BACKLOG.md` — tree-role-integration entry → Resolved; new entry: `.opencode/skills/` mirror is a stale manual snapshot (found by the P2 consumers sweep; out of scope here).

### Rollback
- Maintainer: `git revert <merge-sha>` (additive flag; no callers depend on `--tree` yet)
- User-side: `/plugin update autopilot @v2.16.0`

## v2.16.0 — task-tree engine v1 (delegated orchestration core, shadow-mode)

**Headline**: the manager's context now grows with *decisions*, not work products. New append-only JSONL task tree (`scripts/tree.sh`) externalizes execution state per project; delegates return decision-shaped reports with evidence pointers (`references/tree-contracts.md` + `scripts/check-node-report.sh` validator); a cross-family interrogation QC panel (`scripts/qc-panel.sh`, Claude + Gemini judges × 3 question shapes) runs in **shadow** alongside the authoritative reviewer, feeding a calibration harness (`scripts/calibration.sh` + `evals/known-bad/` ground-truth corpus). **Zero behavior change unless a project opts in** (tree dir exists); verification-authority graduation is a Board decision gated on local calibration data (≥50 reviewer-baseline samples, zero false-pass on known-bad critical, H1 replay) — never on published benchmarks.

### Added
- `scripts/tree.sh` — single state-owning tree CLI: `init` / `emit` (flock, fail-closed) / `rebuild-index` (truncated-tail tombstone) / `next-decision` (never prints work content) / `report` / `escalations` / `fetch --raw` (logged escalation valve) / `board-status` (authority gate on `.active`, i.e. `decision=="graduate"`). 115-assertion torture matrix incl. 8-parallel emitters, kill -9 mid-append, truncated-tail injection.
- `references/tree-contracts.md` — canonical event/report schemas; evidence pointers carry commit-SHA anchors (sha256-only for binaries; moved-file content-hash fallback emits `pointer_stale`, never silent); intent/state boundary table (README owns INTENT, tree owns EXECUTION STATE).
- `scripts/check-node-report.sh` — report-contract validator (schema + pointer resolution + sha256; deleted-evidence fails closed).
- `scripts/resolve-doa.sh` + `project-config-template/doa-config.md` — four-tier DOA presets (cloud-high-trust / local-low-trust), fail-closed on unknown role/tier, all thresholds `calibrate-me`.
- `references/model-routing.md` § Tree roles — Amendment-11 routing economy: Fable-class = manager (depth 0) + named escalations ONLY, never a delegate; sonnet implementers; flash/haiku cross-family judges (PoLL); script+haiku synthesizer.
- `scripts/qc-panel.sh` — 2 judges × 3 question shapes (achieved/extra/missed) with deterministic merge + cheap-model synthesis; Amendment-4 liveness (verdict artifact + calibration sample per run or non-zero exit); judge model env seams; verified live end-to-end (6/6 judges, first real disagreement sample captured).
- `scripts/calibration.sh` + `evals/known-bad/` — verdict-agreement store with baseline separation (self-report vs reviewer; only reviewer-baseline counts toward graduation), known-bad breakout, per-class false-pass tracking, graduation criteria as data; 10-diff injected-defect ground-truth corpus.
- `skills/ceo-agent/references/tree-adapter.md` — branch-by-abstraction adapter: dual-run (shadow) by default; post-signoff mode requires a `board_signoff` event with `decision=="graduate"`; KR1 measured by post-hoc transcript audit, not self-report.

### Changed
- `skills/quality-pipeline/SKILL.md` + `references/code-review.md` — shadow QC panel wiring (MUST run when tree exists and node is verdict-bearing; authoritative reviewer unchanged).
- `skills/ceo-agent/SKILL.md` — Tree Adapter section + authority-gate anti-patterns.
- `references/multi-agent-portability.md` §7 — P0 spike records: CC native tasks are session-scoped (only `--resume <session-id>` reattaches); `agy -p` judge mode viable with file-write recipe.

### Rollback
- Maintainer: `git revert <merge-sha>`
- User-side: `/plugin update autopilot @v2.15.3`; remove `~/.autopilot/calibration/` and any `docs/projects/*/tree/` dirs if opted in.

## v2.15.3 — incident knowledge into the repo (recovery recipe + shell guard)

**Headline**: two gaps closed so the agy-incident protections work for anyone, not just this machine: the **recovery recipe** for the symlinked-dest truncation is now inlined in `references/multi-agent-portability.md` (it previously pointed at a private session memory — useless to other users), and the shell-level backstop ships as sourceable [`scripts/agy-shell-guard.zsh`](scripts/agy-shell-guard.zsh).

### Added
- `scripts/agy-shell-guard.zsh` — wraps raw `agy plugin install/uninstall`: blocks while any symlink sits in `~/.gemini/config/plugins/` (the agy ≤ 1.0.7 kill condition); `agy -p` dispatch passes through untouched. Install: `source` it from `~/.zshrc`.
- `references/multi-agent-portability.md`: 5-step recovery recipe inlined (HEAD/config rebuild, index reset, zero-byte-only restore preserving surviving edits, fsck).
- `references/hetero-dispatch.md`: shell-guard section.
- BACKLOG skill-wrapper entry: user-facing README section explicitly deferred to ship with the skill.

### Rollback
- Maintainer: `git revert <merge-sha>` (docs + standalone snippet; nothing depends on it)

## v2.15.2 — agy export-then-install (structural workaround)

**Headline**: while the agy ≤ 1.0.7 symlinked-dest truncation bug is unfixed upstream, `install-antigravity.sh`/`.ps1` now **never hand agy the live repo**: the install runs against a sacrificial `git archive HEAD` export (no `.git`, no path back to the real checkout). Even an installer failure mode we haven't guarded against cannot touch the working copy. The v2.15.1 preflight guards remain as defense in depth.

### Added
- Export-then-install in both scripts: `git archive HEAD` → temp dir → validate + install from there → cleanup. Non-git source (reachable only via `--skip-git-checks`) falls back to direct install with a warning. `--export-only` creates the export, prints its path, and exits (test seam / manual inspection; needs no agy binary).
- Test scenarios: export is not the source, contains the manifest, has no `.git` (20 assertions total).

### Rollback
- Maintainer: `git revert <merge-sha>` (restores direct-from-repo install; guards stay via v2.15.1)

## v2.15.1 — agy install data-loss guard

**Headline**: `scripts/install-antigravity.sh` (+ `.ps1`) now refuse the conditions behind the 2026-06-11 source-repo truncation incident. Mechanism (confirmed by sandboxed repro, **still present in agy 1.0.7, latest**): `agy plugin install` follows a symlinked `~/.gemini/config/plugins/<name>` and self-copies — truncating the source repo file-by-file (1497–1503 files zeroed in repro, `.git/HEAD` destroyed).

### Added
- Install preflight in `install-antigravity.sh`: **symlinked destination → hard refuse (never bypassable)**; uncommitted / unpushed / non-git source → refuse with sacrificial-clone instructions (`--skip-git-checks` to override); `--preflight-only` runs guards and exits. `AUTOPILOT_REPO_OVERRIDE` test seam.
- `hooks/tests/install-antigravity-guard.test.sh` — 15 assertions across symlink (incl. non-bypassability), real-dir, dirty, unpushed, non-git, unknown-arg paths. No agy binary needed.
- PowerShell mirror guards in `install-antigravity.ps1` (syntax unverified on this machine — no pwsh; logic mirrors bash).
- `references/multi-agent-portability.md`: hazard re-verified against agy 1.0.7 (unfixed upstream).

### Rollback
- Maintainer: `git revert <merge-sha>` (guard-only change; removing it restores the unguarded installer)

## v2.15.0 — heterogeneous dispatch, script-first

**Headline**: Claude Code can now dispatch a non-Claude engine as a headless implementer through a hard-railed script. `scripts/dispatch-hetero.sh` wraps the verified `agy -p` (Gemini) pattern with **non-skippable worktree isolation** (agy has no granular tool allowlist — the rail is hard-coded, not prose) and **artifact-based verification** (commit/diff/cleanliness from git; the agent's self-report is never trusted — an observed Gemini run claimed success while omitting the requested commit hash). Verdict stays at depth 0: the dispatching session reviews the returned branch via quality-pipeline before merge. Skill wrapper deliberately deferred until recurrence (BACKLOG trigger).

### Added
- `scripts/dispatch-hetero.sh` — heterogeneous implementer dispatch: JSON output `{status, commit, files_changed, …}`; exit 0 committed (worktree auto-removed, branch survives for review) / 1 no-commit-or-dirty (worktree kept for inspection) / 2 precondition failure. `--agy-bin` seam for testing.
- `hooks/tests/dispatch-hetero.test.sh` — 24-assertion integration test via PATH-stubbed fake agy (no network): preconditions, committed path, duplicate-branch guard, dirty and no-commit paths with kept worktree, `--keep-worktree`.
- `references/hetero-dispatch.md` — the ritual + four invariants (worktree mandatory / artifacts-not-self-report / verdict at depth 0 / six-element prompt as the contract), engine-neutral role-prompt reuse of `.opencode/agent-bodies/*.body.md`, unverified-engines list.
- `docs/BACKLOG.md` — skill-wrapper entry, trigger: 2-3 more real uses or a second engine passing the headless spike.

### Rollback
- Maintainer: `git revert <merge-sha>` (pure addition — no existing behavior changed)
- User-side: `/plugin update autopilot @v2.14.1`

## v2.14.1 — _bodies relocation (closes all-tools bypass) + agy headless dispatch facts

**Headline**: the generated OpenCode body files moved out of Claude Code's plugin agent scan path (`agents/_bodies/` → `.opencode/agent-bodies/`), closing a real bypass: frontmatter-less body files registered as dispatchable CC agents with ALL tools, and a natural-language "dispatch the planner" was observed misrouting to `autopilot:_bodies:planner.body` in practice. Bonus: the fix itself was implemented by **Gemini 3.5 Flash via `agy -p`** in an isolated worktree from a six-element Task Prompt — the first verified heterogeneous dispatch — with the review verdict kept in the dispatching Claude Code session.

### Fixed
- 🟠 **`agents/_bodies/*.body.md` no longer surface as dispatchable CC agents** (all-tools bypass): relocated to `.opencode/agent-bodies/`, co-located with their sole consumer. `sync-agent-bodies.sh` output path, `.opencode/opencode.json` `{file:..}` refs (now same-dir, no `../` traversal), pre-commit hint, and live docs updated; body files are pure renames (R100). Acceptance verified: fresh-session roster lists only `autopilot:{reviewer,debugger,planner}`; `preflight-portability.sh` 12/12 including live OpenCode body resolution. Merged as `a83c04a`.

### Added
- `references/multi-agent-portability.md`: "Verified by Spike (agy 1.0.5 headless dispatch)" — `agy -p` is a full agentic loop equivalent to `claude -p`; verified flags and the two hard differences (no granular tool allowlist ⇒ worktree mandatory; no structured output ⇒ verify by artifacts). Records the heterogeneous-dispatch invariant: shelled-out agents implement, verdict stays at depth 0.

### Rollback
- Maintainer: `git revert a83c04a` (restores `agents/_bodies/`; OpenCode refs revert with it)
- User-side: `/plugin update autopilot @v2.14.0`

## v2.14.0 — nested-dispatch integration (capability-gated)

**Headline**: Claude Code v2.1.172 shipped nested subagents ("Sub-agents can now spawn their own sub-agents (up to 5 levels deep)"). autopilot integrates it capability-gated: Handoff ENUMs stay the canonical cross-platform dispatch path, the planner gains read-only research children, and blind-dispatch review integrity is hardened to hold at every nesting depth. Non-CC platforms (OpenCode / Codex / Antigravity) need zero changes — they degrade to the existing skill-layer round-trip. Validated pre-ship by a 3-lens review team (portability / blind-dispatch safety / feasibility) + two empirical spikes on 2.1.172.

### Added
- `references/blind-dispatch.md` § **Nested dispatch**: the blinding boundary is **who holds verdict context, not the round number** — verdict dispatch originates only from the dispatcher (depth 0); fixer may decompose fixes but never dispatch a "verify my fix" sub-review; reviewer stays terminal; round-delta and round-cycle meta-signals never flow down to any depth. Enforcement is contract-only (`check-redispatch-prompt.sh` cannot see nested prompts) — the structural lever is keeping `Agent`/`Task` out of reviewer tools.
- `agents/planner.md` § **Research Children**: planner's `tools:` now includes `Agent` — read-only researcher children (`subagent_type: Explore`) to explore the codebase without filling planner context. Children never mutate, never spawn grandchildren; child claims are spot-checked before citation (Fact-driven red line applies through the hop).
- `agents/README.md` § Orchestration: **autopilot nesting policy depth ≤ 2** (canonical statement; main → orchestrating agent → leaf) — same coordination-cost philosophy as team cap-3; harness depth-5 is a limit, not a target. Nested self-dispatch documented as a scoped, never-required exception to "agents do not call each other".
- `references/multi-agent-portability.md` §7: nested-dispatch row (CC v2.1.172+, spike evidence 2026-06-11: default grant + explicit allowlist both honored, children get `Agent` not `Task`; other platforms ❌ unverified-by-absence).

### Changed
- `agents/reviewer.md` Red Line extended: never dispatch your own re-review, even on nesting-capable runtimes.
- `skills/quality-pipeline/references/code-review.md`: re-review blindness constraints stated to hold at any nesting depth.
- `agents/README.md` tool-permissions: planner allowlist variant documented; child-hop guarantee flagged as convention-enforced, not mechanical.

### Rollback
- Maintainer: `git revert <merge-sha>`
- User-side: `/plugin update autopilot @v2.13.1`; behavior change is planner-only (drop of research children), no data/file migration involved.

## v2.13.1 — standalone-fallback fix + 3 parity refinements (superpowers-gap batch)

**Fix batch** from the superpowers-parity inventory (via `research-to-ship`, right-sized: small known items built, 2 M items CEO-deferred to BACKLOG). The headline is a real **standalone-capability bug**.

### Fixed
- 🔴 **`think-tank-dialectic` no longer hard-depends on voltagent** (standalone bug): the 4 職能 roles named `voltagent-*` subagent_types with **no fallback** — so the dialectic broke when voltagent isn't installed (i.e. the default, autopilot-standalone case). Now documents graceful degradation to `general-purpose` + inlined role Focus (the mechanism the 2 adversarial roles already use), mirroring the reviewer-chain fallback. The panel runs with zero voltagent agents present.

### Changed
- `skills/research-to-ship/SKILL.md`: added an **optional Phase 0 → `autopilot:brainstorm`** (discover the design when the topic starts fuzzy; skip when it's already a clear question) — resolves the prior one-way link (brainstorm declared a research-to-ship Phase-0 that research-to-ship didn't reciprocate).
- `skills/debug/SKILL.md`: added the **3-fix architecture gate** — after 3 failed fix attempts, STOP and question the architecture/mental-model (re-collect evidence at the boundary above the suspected site) rather than attempting fix #4. (Internalized from `superpowers:systematic-debugging`.)
- `agents/reviewer.md`: the Security checklist now points to Claude Code's **native `/security-review`** for a dedicated security deep-dive (threat model / supply-chain), clarifying that autopilot's reviewer owns the *general* pre-merge security pass and delegates the specialist deep-dive rather than shipping a separate skill.

### Deferred (CEO call — no biting value for self-use; recorded with triggers in `docs/BACKLOG.md`)
- **subagent-driven-development**: the spec→quality review ORDER is already covered (reviewer's v2.12.1/v2.12.3 claim-completeness IS spec-compliance); only the BLOCKED/incomplete-return handling residue remains → backlog (trigger: a mishandled blocked dispatch).
- **writing-skills RED-phase**: overkill for self-use (it's tuned for public skill publishing); the cheap CSO description principle is already autopilot practice → backlog (trigger: publishing skills broadly).

### Rollback
- Maintainer: `git revert <merge-sha>` (doc/methodology-only).

## v2.13.0 — internalize 3 superpowers capabilities (brainstorm skill + plan template + verification)

**Headline**: surveyed all 14 `obra/superpowers` skills (cloned & read) for what's worth internalizing into autopilot (the user runs without superpowers by choice), then a dialectic right-sized the 3 HIGH candidates. Net: **one new skill, one template, one one-line discipline edit** — each capability addressed at its correct size rather than as three new skills.

### Added
- **`skills/brainstorm/`** (19th skill) — pre-code **Socratic design exploration**: discovers options *when none exist yet*, surfaces 2-3 genuinely different approaches, and **gates implementation until a design is approved**. The discriminator vs neighbours is *whether options exist yet*: `brainstorm` (no options) vs `think-tank` (decide between known options) vs `survey` (external research). Internalizes `superpowers:brainstorming`.
- **`references/plan-template.md`** — the **plan-authoring** discipline internalized from `superpowers:writing-plans` as a *template* (a plan form never triggers standalone — it's invoked by `research-to-ship` Phase 2 / `dev-flow` L-2): file-structure map, bite-sized phases with dev-flow sizes + acceptance, every-step-concrete, and a self-review checklist (scope coverage / placeholder scan / dependency map).

### Changed
- `skills/quality-pipeline/references/anti-rationalization.md`: the **Unverified completion** rule now generalizes the reviewer's soft-language ban (should/seems/probably/likely…) from *findings* to **any completion claim** — "no completion claim without fresh verification evidence this turn" (internalizes `superpowers:verification-before-completion`, which autopilot was ~80% already enforcing).
- `research-to-ship` Phase 2 now follows `references/plan-template.md` (removes its inline plan duplication). Resolved the dangling `→ writing-plans` / `→ brainstorming` "Not for" refs in `dev-flow` / `finish-flow` / `project-lifecycle` (they pointed at non-existent skills) → now point at `plan-template.md` / `brainstorm`.
- Skill count 18 → 19 (README badge + prose + table).

### Rollback
- Maintainer: `git revert <merge-sha>`
- User-side: `/plugin update autopilot @v2.12.3` (new skill/template are inert if not invoked).

## v2.12.3 — reviewer: claim-completeness via decompose + per-outcome grounding

**Headline**: sharpens the reviewer's existing "claimed but missing" stance (v2.12.1) from *eyeball* into *method*. The **goal-scoped vs artifact-scoped** miss — a change that *claims* something ("make X idempotent", "add validation") but delivers it only partially, with the gap in code the diff didn't touch — is now handled by an explicit instruction: decompose the stated claim into the outcomes it implies, treat **the claim's scope (not the diff's scope) as the unit of done**, and confirm each implied outcome against an **external signal** (a test, a measured invariant, or every named code site enumerated) or mark it **`UNVERIFIED`** — reusing the v2.12.1 live-fact convention. This is **recall** (catch partial delivery), complementary to v2.12.1's **precision** (don't confabulate) and the deferred verify-barrier's finding-level refutation.

Deliberately a **prose sharpening of the existing stance, not a new pipeline step / dispatch pass** — consistent with the review-verify-barrier dialectic's ruling (claim/spec-compliance = stance in prose, not a separate gate, `docs/plans/2026-06-04-review-verify-barrier.md` §10) and with the evidence that reflexive ungrounded self-checks backfire (each outcome must ground in an external signal, never "looks done"; Sphinx arXiv:2601.04252 + SGCR arXiv:2512.17540 for intent-decomposition, arXiv:2603.00539 + Huang ICLR 2024 for why grounding-not-introspection).

### Changed
- `agents/reviewer.md`: Review Philosophy "Don't trust the report" bullet gains a "claimed but missing: decompose, don't just eyeball" sub-point — claim-scope as unit of done, per-outcome external grounding or `UNVERIFIED`, with the "make X idempotent ⇒ every write on the re-entered path, not just the changed one" worked example.
- `agents/_bodies/reviewer.body.md`: re-synced via `scripts/sync-agent-bodies.sh`.

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.12.2 — team: cap-3 ≠ independent read-only fan-out; no parallel code-mutation

**Fix** (methodology clarification): `team`'s "cap at 3" governs **coordination cost of collaborative teams** — it was being mis-read as a cap on *independent read-only fan-out* (N agents each producing findings/reports over disjoint inputs, no inter-agent messaging, no shared-file writes — e.g. `audit` Phase 2 per-segment exploration, parallel review dimensions, multi-source research). That kind of fan-out **is not a team and is not capped at 3**; bound it by concurrency (~8) and assert *collected == dispatched* before synthesizing so a dropped unit fails loudly. Also records an explicit **non-goal**: do NOT parallelize code *mutation* via per-unit git worktrees — disjoint-file merges are clean but you can't guarantee disjointness up front, and merge-back conflict-resolution cost outweighs the wall-clock saved.

### Changed
- `skills/team/SKILL.md`: Team Size Rules note distinguishing collaborative cap-3 from uncapped independent read-only fan-out.
- `skills/team/references/team-tactics.md`: File Overlap Check gains an **output-only → overlap N/A → fan out to N** row + the parallel-code-mutation non-goal with its rationale.
- Design + research record (3 research rounds incl. an empirical git-worktree spike + a 4-way parallelizable-work inventory, and the dialectic that descoped a larger proposal to this): `docs/plans/2026-06-04-parallel-read-fanout.md`.

### Rollback
- Maintainer: `git revert <merge-sha>` (doc-only).

## v2.12.1 — reviewer live-fact rule + calibration + consumer verify-pushback

**Fix**: retires the HIGH-severity `reviewer-livefact-confabulation` defect (the reviewer "verified" a live-world claim — `fr.cookys.org` does not exist — by citing a README that never mentioned it; `verified == cites-a-repo-line` let argument-from-silence pass as fact). The fix is in the reviewer's own discipline, not a new verification layer (the BACKLOG entry's own scoping ruled the caller-side layer out — confirmed by a research-to-ship run whose dialectic descoped a proposed verify-barrier down to this). Also absorbs the genuinely useful, cheap ideas from `obra/superpowers`' reviewer (studied by cloning it) without taking its weaker ones (its 3-tier `Critical/Important/Minor` uses the `Important` vocab autopilot already retired).

### Changed
- `agents/reviewer.md`: Fact-driven Red Line now distinguishes **documented-fact from live-system-fact** — live claims (DNS/reachability/version/process/existence) must be **Bash-execution-verified or marked `UNVERIFIED`**, never "verified" by a doc/README citation; **argument-from-silence is banned** ("repo doesn't mention Y" ≠ "Y is false"). Added a **Calibration** section (not everything is Critical; acknowledge what's clean; explicit DON'Ts) + a "**don't trust the report** — verify by reading code; hunt over-engineering + solved-wrong-problem" philosophy line (absorbed from superpowers' spec-reviewer).
- `skills/quality-pipeline/references/code-review.md`: new **"Consuming a finding — verify before implementing"** step in Handoff Consumption (findings are suggestions to evaluate, not orders; verify against the codebase; push back with technical reasoning; YAGNI-grep; **no performative agreement** — no "You're absolutely right!"/thanks; one fix at a time). Operationalizes the `verify-reviewer-claims` discipline on the consumer side.
- `docs/BACKLOG.md`: retired the `reviewer-livefact-confabulation` 🔴 entry (now fixed).
- Design record + the full dialectic that descoped a larger proposal: `docs/plans/2026-06-04-review-verify-barrier.md` (verify-barrier / spec-gate / Workflow fan-out all deferred with explicit triggers).

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.12.0 — `research-to-ship` skill (pinned research→plan→dialectic→project→dev-flow pipeline)

**Headline**: a new orchestrator skill for a recurring ritual — start from a *topic*, and get best-practice research → a written plan → a **multi-round dialectic review loop** → a tracked project → step-by-step dev-flow execution, with a **human approval gate between every phase**. It's a *thin* skill: it pins the sequence and the gates, and delegates the real work to existing skills (`survey`/`deep-research`, `think-tank-dialectic`, `project-lifecycle`, `dev-flow`, `quality-pipeline`, `finish-flow`). The dialectic loop is **pinned on** (unlike `ceo-agent`, which only escalates to it conditionally). Researched against the Claude Code primitives first: the Workflow tool was rejected (it can't pause mid-run for the human gates), `/loop` is interval-polling (wrong shape), and `/goal` is offered only for Phase-5 execution where a transcript-checkable finish line exists.

### Added
- `skills/research-to-ship/SKILL.md` — 18th skill. Invoke `autopilot:research-to-ship <topic>`. Participatory (you approve each gate); coexists with `ceo-agent` (full autonomy) and `dev-flow` (starts at "we know what to build"). Multi-agent portable; only the optional Phase-5 `/goal` is Claude-Code-specific and degrades cleanly.

### Changed
- Skill count 17 → 18 across README (badge + prose + skill table) and CLAUDE.md.

### Rollback
- Maintainer: `git revert <merge-sha>`
- User-side: `/plugin update autopilot @v2.11.1` (the skill is inert if never invoked).

## v2.11.1 — fix: `distill-consolidate.sh migrate` must rewrite frontmatter `name:`

**Fix**: v2.11.0's `migrate` only `git mv`'d the skill directory to its normalized slug but left the frontmatter `name:` stale — so two machines would converge on the directory while still diverging on `name:`, which is the skill's actual identity. The engine would never truly converge. `migrate` now rewrites the first `name:` line to the normalized slug (byte-preserving the rest of the file) alongside the dir rename, idempotently fixing a stale `name:` even when the dir is already normalized. JSON output gains a `name_fixed` array. Caught by inspecting a real migration before committing. Test fixture upgraded to real frontmatter; +3 assertions (29 total).

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.11.0 — distill cross-machine consolidate (slug-normalize + proactive merge)

**Headline**: when two fleet machines distil the **same** recurring procedure, `/distill` now converges them automatically instead of stopping on a raw git conflict. A deterministic **slug normalizer** (Step 4) makes independent namings of one procedure land on a single path (`fix-git-identity`, `git-identity-fix`, `ensure-git-identity` → `git-identity`), and Step 5 does a **proactive** divergence check (`compare` against the pack's `@{u}` *before* committing the push) so the human-gated LLM merge happens in the clean working tree — **never inside a held rebase/merge transaction**. Shipped after two dialectic review rounds that cut a held-rebase design (it inverted git's `:2:`/`:3:` stages and could wedge the pack) and a per-host-staging design (it regressed Claude Code skill loading and used a self-defeating content-hash key); see [`docs/plans/2026-06-04-distill-consolidate.md`](docs/plans/2026-06-04-distill-consolidate.md).

### Added
- `scripts/distill-consolidate.sh` (deterministic, no LLM): `normalize-slug <raw>` (lowercase + drop a tiny stopword set + **preserve token order** — converges naming divergence while keeping antonyms like `add-user`/`remove-user` distinct), `migrate [pack]` (one-time rename of existing dirs to normalized slugs; STOPs when two dirs collide on one slug — a real consolidation case), `compare <slug> [pack]` (proactive divergence check vs `@{u}` → JSON `identical`/`divergent`/`absent-theirs`/`absent-mine`; requires a configured upstream, never guesses `origin/<branch>`).
- `hooks/tests/distill-consolidate.test.sh` — 26 assertions: normalize convergence + antonym-safety + all-stopword fallback; migrate rename/idempotent/collision-STOP; compare all four statuses + no-upstream/non-git guards (bare+two-clone fixture).

### Changed
- `skills/distill/SKILL.md`: Step 4 normalizes the pack slug; Step 5 replaces "STOP on conflict (deferred consolidate)" with the proactive `compare` → human-gated LLM-merge → normal commit flow + a one-time `migrate` note; the "Deferred" section is un-deferred. `references/sync-setup.md`: migration steps + a **fleet-rollback runbook** (`git revert` works because the consolidation is a normal commit, not a merge commit; documents the peer-re-consolidated descendant case).
- **Correctness boundary** (stated in SKILL.md): the scripts are tested for git-plumbing; the **LLM merge quality is human-gated, not test-gated**.

### Rollback
- Maintainer: `git revert <merge-sha>`
- User-side: `/plugin update autopilot @v2.10.2` + `rm -f ~/.autopilot/distill/slug-stopwords` (the new scripts are inert if unused; no migration is auto-run).

## v2.10.2 — distill incremental cursor + batch-approval UX

**Headline**: `/distill` is now cheap to re-run and lower-friction to approve. `distill-scan.js` gained a **per-session cursor** (`--incremental` / `--new-only`) so a routine re-scan only re-reads sessions that are new or changed since last time, then reports just the candidates whose recurrence **rose this run** — "what's newly worth distilling" instead of re-proposing everything you already triaged. The skill's human review gate is unchanged in substance but collapsed in friction: present the whole candidate list once and accept a **batch multi-select** rather than one yes/no per candidate, followed by **one** "push back to the shared pack?" prompt.

### Added
- `scripts/distill-scan.js --incremental`: reuses cached per-session atoms from `~/.autopilot/distill/scan-state.json` (keyed by `{size, mtime}`); only new/grown session jsonl is re-read. **Cumulative totals stay identical to a full scan** — the ≥N× value gate is unaffected (asserted by a parity test).
- `scripts/distill-scan.js --new-only`: like `--incremental`, but filters the report to candidates whose cumulative count rose this run (the cursor's "what's new since last time" view).
- `DISTILL_SCAN_ROOT` env seam on the scanner (testability) + `hooks/tests/distill-scan-incremental.test.sh` (9 assertions incl. full-vs-incremental count parity).

### Changed
- `skills/distill/SKILL.md`: Step 1 uses the incremental cursor on routine runs; Step 3 review gate is now a **batch multi-select** (lint still runs per-candidate first and gates the batch — a lint-flagged identifier can never ride into the pack on a batch tick); Step 5 adds a single "push back to the shared pack?" yes/no that does `pull --rebase` then `push`, stopping on same-name conflict (the deferred multi-machine `consolidate` case — never auto-merge another machine's skill).

### Rollback
- Maintainer: `git revert <merge-sha>`
- User-side: `/plugin update autopilot @v2.10.1` + `rm -f ~/.autopilot/distill/scan-state.json`

## v2.10.1 — distill onboarding hardening

**Headline**: the `distill` pack-sync onboarding shipped a **silently broken** `.gitignore` fix — `.claude/` + `!.claude/skills/` does *not* track a project-scoped skill (git cannot re-include a path under a fully-excluded parent), so any teammate following it got skills that never propagated. Fixed, and replaced the hand-copied git plumbing with a deterministic, idempotent setup script plus a guided first-run flow inside the skill.

### Fixed
- `skills/distill/references/sync-setup.md` — corrected the broken negation to the working `.claude/*` + `!.claude/skills/` form, with an explanation of *why* the obvious form fails (verified empirically: `git check-ignore` on the probe path).

### Added
- **`scripts/distill-sync-setup.sh`** — onboarding plumbing: `status` (state as JSON + next-step hint), `init-remote <url>` (pack machine #1 backup remote), `enroll <url>` (clone the pack on a new machine), `fix-gitignore [repo]` (make a repo track `.claude/skills/` with the correct form — handles bare `.claude/`, `.claude/*`, and recursive `.claude/**`; verifies via `check-ignore`). Every subcommand idempotent.
- `skills/distill/SKILL.md` Step 5 — guided first-run setup: detect state via the script, `AskUserQuestion` only when a decision is genuinely needed (this machine's role / remote URL), then call the script. No more hand-copied commands.

### Changed
- CLAUDE.md scripts inventory + distill SKILL.md "Available scripts" + sync-setup.md: document the new script as the primary onboarding path.

### Rollback
- Maintainer: `git revert <merge-sha>`

**Headline**: autopilot now **deepens Claude Code** with three of its session-control primitives while staying multi-agent-portable (each is capability-gated with a documented non-CC fallback). A new `.githooks/post-merge` advisory closes the release-ritual toil loop — when a merge lands on develop/main it surfaces the merge SHA (ready to paste) plus the `preflight-release.sh` status, **without ever blocking or auto-committing**. `ceo-agent` gains `/goal` as an optional convergence engine, a shipped `loop.md` template enables unattended branch babysitting, and the quality gate can wait on CI-backed tests via `Monitor` instead of busy-polling.

### Added
- **`.githooks/post-merge`** — release-ritual advisory. Fires only on a true merge commit (2+ parents) landing on `develop`/`main`; prints the short SHA + a paste-ready `docs: record merge SHA` tip + `preflight-release.sh` summary (full report only when something drifts). Always exits 0 — an advisory must never disrupt git flow. Auto-activates via the existing `core.hooksPath=.githooks`. Deliberately does **not** block (impossible post-merge) and **not** auto-commit (a hook-authored commit is a surprising one-way door).
- **`project-config-template/loop.md`** — default prompt for a bare `/loop`: unattended babysit of the current branch (continue work → tend PR/CI → `autopilot:quality-pipeline` before "done" → stop when clean), with hard constraints against unauthorized irreversible actions and scope drift. CC-only (v2.1.72+); copy to `.claude/loop.md` or `~/.claude/loop.md`.
- **`/goal` convergence primitive** in `ceo-agent` — recommend a transcript-checkable OKR condition so the session converges autonomously; coexists with autopilot's side-effect-only Stop hooks; degrades to per-phase re-prompting where `/goal` is unavailable. Requires CC v2.1.139+.
- **`Monitor` CI-polling** — capability-gated note in `quality-pipeline` Tests (canonical) + a pointer from `finish-flow` L-5.2: wait on CI-backed/long-running test commands via `Monitor` instead of busy-looping `gh run watch`; falls back to manual polling elsewhere.
- **`references/multi-agent-portability.md` §7** — "Harness primitives are Claude-Code-only (capability-gated)": `/goal` / `/loop` / `Monitor` table with official-doc sources, autopilot integration points, and per-primitive non-CC fallbacks.

### Changed
- `CLAUDE.md` scripts inventory + `scripts/install-hooks.sh` header: document the new `post-merge` hook alongside `pre-commit`.
- `README.md` config-template table: add the `.claude/loop.md` row.

### Hook-order semantics reminder
- The new `post-merge` is a **git hook** (fires on the `git merge` / `git pull` event), not a Claude Code lifecycle hook — the CC parallel-matcher ordering caveat does not apply to it.

### Rollback
- Maintainer: `git revert <merge-sha>`

## v2.9.1 — distill durability hardening

**Headline**: `distill` now commits each approved skill **at approval time** (`commit-on-approve`) instead of leaving it as a loose uncommitted file — so an approved skill survives concurrent sessions / crashes (it's in git history immediately). Docs reframe the pack remote as **durability-required (backup, not just sync)**: a remote-less pack is a single on-disk copy, one `rm -rf` from total loss.

### Changed
- `skills/distill/SKILL.md` Step 4: write **and commit** the approved global skill atomically into the pack; project writes stay unstaged (user's repo). Step 5 sync = propagate the already-made commit.

### Fixed
- Durability gap: approved-but-uncommitted skills were vulnerable to loss under the concurrent-session races common on shared machines. Now loss-safe locally; worst concurrency case = a same-skill merge conflict (deferred `consolidate`), never lost data.

## v2.9.0 — distill (recurring procedures → your personal skills)

**Headline**: New `distill` skill — autopilot ships a *distiller* that mines your local conversation history for recurring procedures and corrections and turns the ones you approve into **your own personal skills**, routed into your skill dirs (a private `autopilot-distill-skills@skills-dir` pack for global, `<project>/.claude/skills/` for project-scoped). autopilot ships only the factory; the distilled skills are yours and never enter autopilot's repo. Sync across your fleet via the pack repo (git) or Syncthing.

### Added
- `skills/distill/` — scan → review (human gate + identifier lint + deny-list) → scope-aware write. Privacy: de-identified by construction + approval gate; raw history never leaves the machine.
- `scripts/distill-scan.js` — deterministic full-history scanner → frequency atoms in two buckets (ritual + correction candidates); `--real-only`, `--json`, `--top N`. No LLM in the count path.
- `skills/distill/references/sync-setup.md` — fleet enrollment (pack-as-private-repo / Syncthing).

### Notes
- Multi-machine `consolidate` (merging the same procedure distilled on N machines) is deliberately **deferred** until a real cross-machine conflict occurs (plan §0.3.1). Self-use-first; publish-grade de-id hardening is a later phase.

## v2.8.1 — Hook follow-ups: suggest-compact revived + dead-dispatch guidance

**Headline**: Closes the actionable hook follow-ups left after the v2.8.0 transcript pivot. `suggest-compact` is wired and working again (it never needed transcript recovery — it only counts `Write|Edit` calls; the one bug was that its `/dev/stdin` read threw ENXIO *before* the counter incremented, so it silently never fired). Adds a deterministic, docs-only way to tell when your PostToolUse dispatch has died mid-session (and how to recover), after a 5-role dialectic review found the auto-detector design non-functional and deferred it to a spike. Two stale hook docs are brought in line with v2.8.0 reality.

### Added
- **`hooks/suggest-compact-lib.js`** — pure `compactDecision(count)` threshold logic, unit-tested.
- **`hooks/suggest-compact.test.js`** — 9 tests: threshold boundaries (49 silent / 50 nudge / 51-74 silent / 75 nudge / unbounded 100,125) + a subprocess test proving the counter increments without a real stdin payload (the ENXIO regression) + the `AUTOPILOT_SUGGEST_COMPACT=false` opt-out.
- **`hooks/README.md` "Is my PostToolUse dispatch dead?"** — deterministic manual check (run a `Bash` tool → did `~/.claude/bash-commands.log` gain a line?) + recovery (full restart; `/clear` and `/reload-plugins` do not re-init dispatch). Valid on v2.8.0+.

### Fixed
- **suggest-compact re-enabled** — `/dev/stdin` read isolated in its own inner try so the counter increments under ENXIO; wired under a `Write|Edit` PostToolUse matcher block; `AUTOPILOT_SUGGEST_COMPACT=false` opt-out added.

### Changed (docs)
- **`hooks/README.md`** — reconciled the contradictory suggest-compact rows (removed it from "still disabled"; fixed the threshold drift "50/75/100" → unbounded "50, then every 25"); added a "`/compact` ≠ real PreCompact for testing" caveat (cites the 2026-05-14 method-B observation).
- **`docs/BACKLOG.md`** — "Re-enable v2.7.4 disabled hooks" rewritten to reflect that the PostToolUse log-only hooks are done (v2.8.0/v2.8.1); remaining split into PreToolUse blockers (gated on #6305) vs Stop-event hooks (separate). Dead-dispatch auto-detector marked SPIKE-GATED with the dialectic rationale. New entry logging the stale "12 default-on" hook tally (deferred, pre-existing).

### Hook-order semantics reminder
- Claude Code hooks run **in parallel / non-deterministic order across different matcher blocks** (PostToolUse `Write|Edit` vs `.*` are independent). Only **intra-matcher** sequencing is guaranteed. suggest-compact's new `Write|Edit` block carries no cross-block ordering guarantee.

### Notes
- Tier counts unchanged (suggest-compact was always counted in the 19/12 Tier A tally; this only wires it). The broader "12 default-on" tally is stale post-v2.7.4 — logged to BACKLOG, deliberately not half-fixed here.
- The dead-dispatch auto-detector (SessionStart-side) was **deferred**: a 5-role dialectic (0/5 for shipping the heuristic) found it non-functional — intent file keyed by `sha1(cwd)` not session_id, SessionStart runs before the new id is written, and dispatch dies mid-session while SessionStart only fires at the next (already-fresh) entry. Replaced by the deterministic manual check above + a spike-gated BACKLOG entry.
- Project: `docs/projects/2026-06-02-hook-followups/`.

### Rollback
- `git revert -m 1 <merge-sha>`. suggest-compact returns to unwired; docs revert. No data loss.

## v2.8.0 — Hook transcript pivot: revive tool-event hooks without stdin

**Headline**: Claude Code never pipes stdin to PreToolUse/PostToolUse hooks (ENXIO; upstream #6305, re-confirmed at 2.1.159), which silently broke every hook depending on `tool_input`/`tool_response` (disabled in v2.7.4). This release recovers tool data from the **session transcript JSONL** instead, re-enabling the PostToolUse hooks. A 4-point spike (structure / recoverability / path-discovery via `CLAUDE_CODE_SESSION_ID` / write-timing) confirmed feasibility against real transcripts before any code.

### Added
- **`hooks/transcript-reader-lib.js`** — pure `findLatestToolEvent()` + `resolveTranscriptPath()` (UUID glob, no cwd-encoding assumption) + fail-open `readLatestToolEvent()` / `getToolEvent()` (stdin-first, transcript-fallback). 9 unit tests.
- **`hooks/_transcript-timing-probe.js`** — opt-in diagnostic to confirm intra-cycle write-vs-dispatch timing in a fresh session (not wired by default).

### Fixed (re-enabled via transcript pivot)
- **intent-capture** — `last_tool` is populated again (was `<unknown>`); adds `last_tool_source`.
- **audit-log** — recovers `tool_input.command` → `~/.claude/bash-commands.log`.
- **log-error** — recovers `tool_response` + `is_error` → `~/.claude/error-log.md`.
- **failure-escalation** — recovers Bash `is_error` → escalation counter.
- Each smoke-verified producing its artifact via the transcript; +3 L2 tests (29 test files total).

### Notes
- **PreToolUse hooks stay disabled — permanently unrecoverable** by this approach (the tool hasn't run, so no transcript entry exists): large-file-warner, branch-protection, commit-secret-scan.
- **Out of scope (follow-up, BACKLOG)**: suggest-compact (PostToolUse — recoverable, deferred); cost-tracker + session-summary (Stop events, env-driven — not tool-event-stdin).
- Project: `docs/projects/_archive/2026-06-02-hook-transcript-pivot/`. Tier counts unchanged (the re-enabled hooks were always "default-on" tier, just temporarily off).

### Rollback
- `git revert -m 1 <merge-sha>`. Hooks revert to disabled (v2.7.4 state); no data loss.

## v2.7.7 — Maintenance: doc-rot fixes + skill leverage extraction

**Headline**: Two maintenance efforts driven by `/next` deep scans, shipped together. (1) A `/next --deep` link audit found shipped skills citing reference files that were **never created**; this release authors the missing canonical references, fixes the broken links, and closes the validator gap that hid them. (2) A behavior-preserving refactor trims the always-loaded tail of two over-200-line skills by relocating passive leaf content to `references/`.

### Fixed (doc-rot — level-3 batch)
- **Authored `quality-pipeline/_base/prohibited-behaviors.md`** — `test-policy.md` (×2) and `code-review.md` (×1) cited *"Full list: ../_base/prohibited-behaviors.md"*, a file that never existed. Now a real consolidated canonical list (test-failure / pre-existing-error / code-review prohibitions).
- **Authored `project-lifecycle/references/templates.md`** — `project-structure.md` (×2) cited a missing templates file via a **doubled** `references/references/` path. Now a real file (README/ADR/dev-info/phase-N skeletons + phase-merging rules); the citing path is corrected to the sibling `templates.md`.

### Added
- **`scripts/validate.sh` link-check, hardened.** It previously scanned only `SKILL.md` with a `references/`-prefix-only regex — so broken links inside reference docs, `../_base/x.md`, and doubled paths all shipped undetected. It now validates **every relative `.md` link in every skill-local doc** (SKILL.md + references/ + _base/), resolving against the file dir or repo root, while **skipping links inside fenced code blocks** (template/example placeholders). New regression test `hooks/tests/validate-link-check.test.sh`.

### Changed (skill leverage extraction)
- **dev-flow** (645 → 618 lines): Context Continuation (resume-path-only) → `references/context-continuation.md`; Post-Feature Doc Sync → `references/post-feature-doc-sync.md`. Forcing functions, gates, and cross-skill-named sections (Scope Audit L-1.5, H Workflow H-1, Session-End L-Full cited by finish-flow:64, dimensions checklist cited by ceo-agent:224) kept **inline** — review confirmed extracting them would silently regress the finish-flow forcing mechanism.
- **retro** (225 → 130 lines): Step 1 data-collection commands → `references/data-collection.md`; Step 4 output-report templates → `references/report-templates.md`. Step 1-6 sequence kept inline.

### Notes
- Scope-cut (refactor): think-tank-dialectic (342) and ceo-agent (335) evaluated and **rejected** as negative-ROI churn (mostly inline control flow). Project: `docs/projects/_archive/2026-06-02-skill-leverage-extraction/`.
- Deferred to BACKLOG with triggers: 4 orphaned 2026-05-14 plan docs; `_bodies/*.body.md` relative-link depth bug (generated artifact, low severity, not CI-failing).
- Verification: `validate.sh` 16/16 (new link-check), completeness clean, **26 test files** green, `preflight-portability.sh` 12/12, `preflight-release.sh` green.

### Rollback
- Maintainer: `git revert -m 1 <merge-sha>`, or revert individual phase commits. Skill-leverage refactor shipped earlier on develop as merge `a4c5db6` (commits 6d62ee0 / e1a9974 / 69b29ca).

## v2.7.6 — Hook-polish batch (3 backlog items, now test-covered)

**Headline**: Three small backlog fixes that the v2.7.5 test harness made cheap+safe to land — each ships with a regression test. A dialectic review round caught a Major (empty-file disable-flag parity gap) before merge.

### Fixed
- **state-checkpoint symlink-reject diag echoes `$HOME`** (Item A). The "transcript path resolves outside HOME" failure detail now reads `resolved=<path> (HOME=<homedir>)` so users with `CLAUDE_CONFIG_DIR` overrides or cross-volume symlinks can see *why* it was rejected. (Backlog: v2.7.2 L-5.2 Suggestion #1.)
- **Failure-counter mtime cleanup** (Item B). `hooks/state-checkpoint-lib.js` gains `selectFailureCounter`: `.failure_count_*` files older than 7 days are excluded from "current" selection AND unlinked as orphans, so the scan can't grow unbounded. (Backlog: v2.7.2 L-5.2 Suggestion #2.)
- **Malformed / empty disable flag self-heals** (Item C). `intent-capture` disable flag with invalid JSON — or a 0-byte partial write (the most common ENOSPC outcome) — now auto-clears (`clear_malformed` decision) instead of wedging the hook with no recovery path but manual `rm`. `null` (read-failed, transient) still leaves the flag active. OpenCode plugin (`.opencode/plugins/autopilot.ts`) given matching parity. (Backlog: v2.7.2 L-5.2 Suggestion #3.)

### Tests
- `hooks/state-checkpoint.test.js`: +6 L1 unit tests for `selectFailureCounter` (freshest-wins, stale-excluded, all-stale, override, boundary).
- `hooks/intent-capture.test.js`: malformed→clear_malformed, empty/whitespace→clear_malformed, stale-precedence.
- `hooks/tests/`: symlink-reject extended to assert `HOME=`; new `intent-capture-disable-flag-malformed.test.sh` + `intent-capture-disable-flag-empty.test.sh`.
- Full suite: 25 test files green.

### Review
- 1 dialectic review round. Major caught: `disableFlagDecision`'s `if (flagContentJson)` guard treated a present-but-empty `''` as falsy → left the Node hook wedged on a 0-byte flag while the OpenCode plugin cleared it. Fixed by distinguishing `null` (read failed → active) from `''` (present-but-empty → clear_malformed) + a 0-byte L2 fixture.

### Rollback
- Maintainer: `git revert <merge-sha>`. All changes additive; the lib helpers are pure + unit-tested, wrappers verified via the existing smoke tests.

---

## v2.7.5 — Test Suite Foundation

**Headline**: Closes the long-standing "autopilot has zero automated test infrastructure" gap (filed in backlog 2026-05-14 after the v2.7.3 sync-version Critical was only caught because a reviewer agent happened to run the script). Three-layer pyramid: L1 unit tests via `node:test` against pure-helper libs, L2 integration tests via bash + `hooks/tests/run.sh` umbrella, GitHub Actions CI. Two highest-complexity hooks (state-checkpoint, intent-capture) refactored to extract pure helpers into `*-lib.js` modules for testability; wrappers keep all fs/process IO. Smoke-test parity verified pre/post the refactor (R1 mitigation). 23 test files total (5 L1 + 18 L2 = 78+ assertions). 1 dialectic review round caught a Major (sync-version tests mutating live repo files); fixed by adding a sandbox helper that copies sync-version.js + the 5 tracked manifests into `$TEST_TMP/sandbox/`.

### Added
- **`hooks/tests/lib.sh`** — assertion helpers + per-test sandbox (`mktemp -d`, redirected `HOME` AND `TMPDIR`, auto-cleanup on EXIT). `run_hook` spawns the script under sandbox env with stdin/stdout/stderr capture. `setup_sync_version_sandbox` builds a self-contained mini-repo for sync-version tests so live manifests are never touched.
- **`hooks/tests/run.sh`** — umbrella runner. Discovers L1 (`hooks/*.test.js` → `node --test`) and L2 (`hooks/tests/*.test.sh`) tests. Per-file pass/fail + aggregate exit. Substring filter as first arg.
- **`hooks/tests/README.md`** — framework docs + "writing a new test" recipes for both layers.
- **`hooks/state-checkpoint-lib.js`** — pure helpers extracted: `truncateUtf8Safe`, `renderContentBlocks`, `extractTurn`, `parseTranscriptText`, `buildTranscriptTail`, `emitFailure` (+ constants `PER_TURN_BUDGET` / `THINKING_BLOCK_CAP` / `MAX_LINE_BYTES`). No fs/process IO.
- **`hooks/state-checkpoint.test.js`** — 27 L1 unit tests covering codepoint-boundary truncation, content-block rendering, transcript parsing edges (CRLF, malformed, oversize), tail building (newest-exempt, older-truncated, byte-cap-drop), emitFailure shape + stderr sink.
- **7 L2 integration tests** under `hooks/tests/` for state-checkpoint covering R10-A through R10-K scenarios from the original test-suite plan (empty stdin, missing transcript, malformed JSONL, thinking-only newest, newest-verbatim regression for v2.7.2 fix, CRLF transcript, symlink-rejection security guard).
- **`hooks/intent-capture-lib.js`** — `summarizeToolInput` + `disableFlagDecision` pure helpers; constants `FAILURE_THRESHOLD=10` / `STALE_DISABLE_HOURS=24` / `SUMMARY_MAX_LENGTH`.
- **`hooks/intent-capture.test.js`** — 17 L1 unit tests covering tool-input summarization (precedence, ellipsis, empty-string-as-absent) and disable-flag decision branches (no_flag/clear_stale/clear_version/active, malformed JSON → active, staleHours override).
- **6 L2 integration tests** for intent-capture: basic write path + mode 0600, env opt-out short-circuit, stale-flag auto-clear, version-mismatched flag auto-clear, active flag suppresses write, long-command summary truncation end-to-end.
- **6 L2 integration tests** for sync-version: --dry-run (no writes, all 5 mirrors byte-identical), invalid version rejected, invalid counts rejected, --check on clean tree, --check detects drift, full round-trip byte-identity. All run inside `$TEST_TMP/sandbox/` — live repo never touched.
- **`hooks/tests/all-hooks-fail-open.test.sh`** — every hook script (20 Node + 1 bash) must exit 0 on `{}` payload. The regression net for syntax errors, missing-field crashes, accidentally-required env vars across the whole hook directory.
- **`hooks/tests/reload-watch-detects-mtime-change.test.sh`** — happy path for the third active Node hook; first-run silent init, subsequent change fires "Plugin catalog signal changed" warning.
- **`.github/workflows/test.yml`** — Node 22 LTS Ubuntu CI running setup-symlinks → tests → sync-version --check → sync-agent-bodies --check → preflight-release → preflight-portability. Triggers on push to develop/main + PR + manual dispatch.
- **`docs/projects/_archive/2026-06-01-test-suite-foundation/README.md`** — project tracking doc.

### Changed
- **`hooks/state-checkpoint.js`** — wired to import from `state-checkpoint-lib.js`. `emitFailure` wrapper injects `process.stderr`; `parseTranscript` is a thin `fs.readFileSync` shim around `parseTranscriptText`; `buildTranscriptTail` shim forwards env-overridable `TRANSCRIPT_TAIL_N` / `TRANSCRIPT_BYTE_CAP` into the lib. Smoke-test parity verified.
- **`hooks/intent-capture.js`** — wired to import from `intent-capture-lib.js`. `checkDisableFlag` reduced to the fs side; decision logic goes through `disableFlagDecision`. Inline `summarizeToolInput` removed in favor of the lib export.
- **`.claude/quality-gate-config.md`** — `Test Command: N/A` → `bash hooks/tests/run.sh`. The "autopilot ships only prose" rationale is no longer true.
- **`agents/reviewer.md` Workflow §7** — adds "Run the project's test suite as a pre-merge gate" step. Non-zero exit is a 🔴 Critical finding. Falls back to the project's `.claude/quality-gate-config.md` Test Command for non-autopilot repos. `agents/_bodies/reviewer.body.md` regenerated via pre-commit gate.

### Rollback
- Maintainer: `git revert <merge-sha>`. The lib refactor is the only behavior-touching change; the wrappers were verified byte-equivalent via the smoke test (state-checkpoint-empty-stdin) before and after. If reverted, the tests under `hooks/tests/` will also disappear cleanly (no other code references them outside the workflow file).

---

## v2.7.4 — Post-portability follow-ups (OpenCode parity + release-hygiene + agy fact correction)

**Headline**: Three follow-ups from the v2.7.3 ship's out-of-scope list, executed as a CEO-triaged project ([docs/projects/_archive/2026-05-29-post-portability-followups](docs/projects/_archive/2026-05-29-post-portability-followups/README.md)). The headline is an **empirical correction**: installing real `agy` 1.0.1 overturned both the original PM claims AND v2.7.3's "fact-version" — `agy plugin validate` and the root-`plugin.json` requirement are genuine (v2.7.3 had wrongly labelled them fabricated). Spike-before-assert cuts both ways.

### Added
- **`scripts/preflight-release.sh`** — release-hygiene gate (5 checks): canonical version parseable, CHANGELOG entry present, version mirrors in sync, INDEX references the version, all INDEX project-README links resolve. Wired into `finish-flow` L-5.5. Prevents the doc-drift class that bit v2.7.3 (version bump with no CHANGELOG entry / colliding INDEX labels). Negative-tested (phantom version fails checks 2/3/4).
- **OpenCode circuit-breaker** in `.opencode/plugins/autopilot.ts` — disable-flag / failure-counter / stale-clear parity with `hooks/intent-capture.js`. 10 consecutive intent-write failures → disable flag; auto-clears on staleness (>24h) or plugin-version bump. OpenCode-specific flag filenames (`opencode-intent-capture.disabled`) so the two runtimes don't cross-contaminate state.

### Changed
- **`scripts/install-antigravity.{sh,ps1}`** — rewritten from the wrong symlink-into-`~/.gemini/antigravity/skills/` model (from a codelabs walkthrough) to the **real `agy` plugin model**: `agy plugin validate → install → list`. Verified end-to-end against `agy` 1.0.1 (install + uninstall).
- **`references/multi-agent-portability.md`** — corrected the Antigravity rows and the "NOT verified" section. `agy plugin validate` moved to a new "Corrected — previously mislabelled" subsection. Root `plugin.json` documented as having two real consumers (agy validate + npm/GitHub metadata), not "metadata only". `Last verified` bumped to 2026-05-29 (agy 1.0.1).
- **`AGENTS.md` + `CLAUDE.md`** — Spike-before-assert lesson reworded to note it "cuts both ways" (fabrication AND over-correction); skill-sharing paths corrected (Antigravity uses plugin import, not a `.agents/skills/` scan).
- **`README.md` §Antigravity** — install snippet updated to the `agy plugin validate → install → list` flow.
- **`CLAUDE.md` scripts inventory** — backfilled 6 v2.7.3 scripts that existed but were unlisted (sync-agent-bodies, preflight-portability, preflight-release, setup-symlinks, install-antigravity, install-hooks).

### Empirical findings (agy 1.0.1, 2026-05-29)
- `agy plugin {validate,install,uninstall,list,enable,disable,import,link}` — full verified subcommand set.
- `agy plugin validate <repo>` → `[ok]` (16 skills / 5 agents / 25 hooks); **requires root `plugin.json`** (removing it → `Error: missing plugin.json`).
- `agy plugin install <repo>` → imports as `source: claude-code`, registering skills + agents + hooks.
- Still **unverified**: `AGY_PLUGIN_ROOT` / `GEMINI_PLUGIN_ROOT` env vars; whether agy fires the imported hooks at runtime.

### Rollback
- Maintainer: `git revert <merge-sha>`. All changes additive (new script, OpenCode-only plugin logic, doc corrections); no Claude Code runtime behavior changed.

---

## v2.7.3 — Multi-Agent Portability Correction + disable-batch + capture-payload

**Headline**: Aggregates three batches of post-v2.7.2 work that all shipped to develop without an intervening canonical version bump:

1. **Multi-Agent Portability Correction** (this release's headline, 2026-05-22~27): reverts and replaces 3 previous commits (`bf0c637`, `b7d1adb`, `139ca49`) that shipped fabricated cross-platform support — env vars (`CODEX_PLUGIN_ROOT`, `AGY_PLUGIN_ROOT`, `GEMINI_PLUGIN_ROOT`) that don't exist, CLI subcommands (`agy plugin validate`) that don't exist, hook fallback chains that broke runtime on every non-Claude host. Replaced with **empirically verified** OpenCode integration (3 Spikes against real OpenCode 1.15.10), `.agents/skills/` cross-agent intersection symlink, and a canonical-mirror version manifest split with pre-commit drift gate. **4 rounds of dialectic review (Architect / Ops / Skeptic)** documented in the plan; each round caught self-inflicted bugs introduced by the prior round, including a latent `__dirname` 3-level arithmetic bug in the existing OpenCode plugin that had been silently returning `"unknown"` since `bf0c637`.

2. **Hook disable batch** (originally drafted as v2.7.4, 2026-05-14): fresh-claude transcript diagnostic (Claude Code 2.1.128–2.1.141) confirmed Claude Code **never** pipes stdin to PreToolUse / PostToolUse / Stop hook events on Linux + Bun-spawned-Node. All `tool_input` / `tool_response` / `usage`-dependent hooks were silent-skipping. `hooks/hooks.json` simplified from 13 entries to 4 — only `PreCompact` + `SessionStart` (stdin-pipe-working) plus `PostToolUse .*` (stdin-tolerant: intent-capture, reload-watch) survive.

3. **SESSION_ID env-var fix** (`a2cd815`): 6 hooks were reading `process.env.CLAUDE_SESSION_ID` but Claude Code actually sets `CLAUDE_CODE_SESSION_ID`. All hooks' `getSessionId()` were falling back to cwd-hash. Fixed so SessionStart / PreCompact-class hooks now join the real session UUID.

### Added
- **`.agents/skills/ → ../skills` symlink** — single path scanned natively by OpenCode and by Codex's skill discovery walk-up; reused by Antigravity install script. Replaces the per-platform skill duplication attempted in `bf0c637`.
- **`agents/_bodies/<role>.body.md`** — YAML-frontmatter-stripped copies of `agents/{reviewer,debugger,planner}.md` for OpenCode `{file:..}` reference (avoids leaking `name:` / `tools:` / `model:` into agent prompt body).
- **`scripts/sync-agent-bodies.sh`** — generates `_bodies/` from canonical `agents/<role>.md`; `--check` mode wired into `.githooks/pre-commit`.
- **`scripts/sync-version.js --check`** — read-only canonical-vs-mirror drift detector. Canonical = `.claude-plugin/plugin.json`; mirrors = root `plugin.json` + `README.md` badges + `hooks/README.md` hook count. Pre-commit gate.
- **`scripts/setup-symlinks.{sh,ps1}`** — ensures `.agents/skills/` resolves correctly post-clone. PowerShell variant detects `UnauthorizedAccessException` and points user to Developer Mode. Wired into `scripts/dev-setup.sh` line 54-56 anchor (after Validate section, before marketplace registration).
- **`scripts/install-antigravity.{sh,ps1}`** — symlinks `skills/` into `~/.gemini/antigravity/skills/autopilot`. Script header `# verified-against: codelabs walkthrough 2026-05-22` flags when target path may have drifted upstream. **⚠ Superseded in v2.7.4**: empirical `agy` 1.0.1 testing showed this symlink model is wrong; the real mechanism is `agy plugin install`. See v2.7.4 entry.
- **`scripts/install-hooks.sh`** — one-time `git config core.hooksPath .githooks` activation. Required after clone before pre-commit gates fire.
- **`scripts/preflight-portability.sh`** — 12-check acceptance bundle (intent-capture × 3, session-start × 2, sync-version, sync-agent-bodies, .agents/skills, validate.sh, OpenCode × 3). Self-skips OpenCode checks when binary not installed.
- **`.githooks/pre-commit`** — runs `sync-version.js --check` and `sync-agent-bodies.sh --check`. Activated via `scripts/install-hooks.sh`.
- **`platforms/codex/config.toml.example`** — Codex skill-discovery example. Notes that `.agents/skills/` symlink alone is sufficient for per-repo usage.
- **`.opencode/package.json` + `.opencode/package-lock.json`** — declares `@opencode-ai/plugin@1.15.10` so editors / `npm install` can resolve the `Plugin` type for the local TS plugin.
- **`docs/plans/2026-05-22-multi-agent-portability-correction.md`** — 4-round dialectic-reviewed plan with Spike-results appendix (§A).
- **`docs/projects/_archive/2026-05-22-multi-agent-portability-correction/README.md`** — project tracking doc.
- **`hooks/capture-payload.js`** (`9f56a36`) — Tier B opt-in diagnostic hook. Dumps raw stdin + CLAUDE_/AUTOPILOT_ env vars to `~/.autopilot/payloads/<ts>-<pid>-<marker>.json` when `AUTOPILOT_CAPTURE_PAYLOAD=1`. Rotation keep-50 FIFO.
- **`scripts/toggle-payload-capture.sh`** (`7e4d2a1`) — One-shot enable/disable helper for capture-payload. Wires it into 4 matchers via jq, byte-for-byte backup + restore of `hooks.json`.

### Changed
- **`AGENTS.md`** — rewritten as [agents.md](https://agents.md/)-spec readme (Project Structure / Coding Conventions / Testing / PR Guidelines + autopilot-added Build / Contribution, explicitly marked as additive). No more LLM-fabricated env vars or "25 Hooks" claims contradicting `plugin.json`.
- **`CLAUDE.md`** — header note pointing non-Claude agents to AGENTS.md and portability doc; hook count `14 → 19 (12 default-on, 7 opt-in)` per canonical; new Don't entry forbidding unverified cross-platform claims.
- **`references/multi-agent-portability.md`** — fact-version with citation URLs for every claim. Includes "Things explicitly NOT verified" subsection listing `CODEX_PLUGIN_ROOT`, `AGY_PLUGIN_ROOT`, `GEMINI_PLUGIN_ROOT`, `AGENT_PLUGIN_ROOT`, `OPENCODE_PLUGIN_ROOT`, `agy plugin validate` — these explicitly **cannot** be used in code.
- **`.opencode/opencode.json`** — schema cleanup: removed `"skills": { "paths": [...] }` (auto-scan covers it) and `"plugin": ["./.opencode/plugins"]` (directory path invalid; .ts files auto-discover regardless). Agent prompts switched to cross-layer `{file:../agents/_bodies/<role>.body.md}` references (Spike 1 verified).
- **`.opencode/plugins/autopilot.ts`** — `getPluginVersion()` rewritten: `import.meta.url + fileURLToPath` instead of `__dirname` (Spike 0 verified `__dirname` is `undefined` in Bun ESM plugin context); 2-level climb instead of 3-level (Architect R3 catch: 3-level landed at repo's *parent* dir, so version has been silently `"unknown"` since `bf0c637`).
- **`scripts/sync-version.js`** — `editPlan` extended to cover root `plugin.json` + `README.md` badges; `hooks/hooks.json` dropped from editPlan (its `v2.7.4 disable batch` reference is an event marker, not plugin version).
- **`scripts/validate.sh`** — reference-existence check handles 3 SKILL.md reference forms (skill-local / repo-root / sibling-skill). Fixes pre-existing false positives on `audit`, `quality-pipeline`, `team`.
- **`README.md`** — Install section expanded from Claude-Code-only to 4 platforms; Windows symlink prerequisites documented (`git config --global core.symlinks=true` + Developer Mode BEFORE clone).
- **`docs/projects/INDEX.md`** — relabelled the 2026-05-14 retro-roundup row from `v2.7.3` to `v2.7.2-followup` (no canonical version bump occurred in that ship).
- **`hooks/hooks.json`** (from disable-batch work, `c5e5a4c`) — simplified from 13 entries to 4. Only stdin-pipe-working (PreCompact, SessionStart) and stdin-tolerant (PostToolUse `.*` intent-capture + reload-watch) hooks remain wired.
- **`hooks/README.md`** (from disable-batch work) — added "v2.7.4 disable batch" section listing the 9 disabled hooks and their reasons (`large-file-warner`, `branch-protection`, `commit-secret-scan`, `audit-log`, `failure-escalation`, `suggest-compact`, `log-error`, `cost-tracker`, `session-summary`). Note: `hooks/README.md` retains the literal text `v2.7.4 disable batch` as an event marker referring to the disable batch event, not a plugin version label.

### Removed
- `.opencode/skills/{quality-pipeline,think-tank,survey,dev-flow}/references/model-routing.md` — 4 dangling symlinks (`../../../` only climbs to `.opencode/`, not 4 levels needed for repo root). Conditional-rm guard ensures only true dangling links are removed.
- `.opencode/agents/autopilot-{reviewer,debugger,planner}.md` — orphan duplicates now that `opencode.json` defines agents inline with cross-layer `{file:..}` body references.

### Fixed
- **Hook env-var fallback chain reverted** (`hooks/intent-capture.js`, `hooks/session-start.sh` restored to `b1ee7a6` state). The added `CODEX_PLUGIN_ROOT || AGY_PLUGIN_ROOT || GEMINI_PLUGIN_ROOT || path.dirname(__dirname)` chain was non-functional (env vars don't exist) AND combined with the hardcoded `.claude-plugin/plugin.json` lookup would throw on any non-Claude host. `session-start.sh`'s broadened OR-condition also inverted semantics — emitting Claude's `hookSpecificOutput` envelope whenever any of the fabricated env vars happened to be set.
- **OpenCode `getPluginVersion()` silent `"unknown"` regression** since `bf0c637` — the 3-level `__dirname` climb landed at the repo's parent dir, so `plugin.json` was never found. Spike 0 + Architect R3 catch.
- **CLAUDE_SESSION_ID → CLAUDE_CODE_SESSION_ID** (`a2cd815`) — 6 hooks (`intent-capture`, `batch-format`, `accumulator`, `session-summary`, `suggest-compact`, `cost-tracker`) were reading the wrong env var name. All `getSessionId()` calls were silently falling back to cwd-hash. Post-fix, SessionStart / PreCompact-class hooks correctly join the real session UUID.
- **9 silent-broken hooks disabled** (`c5e5a4c`, from disable-batch work) — `large-file-warner`, `branch-protection`, `commit-secret-scan`, `audit-log`, `failure-escalation`, `suggest-compact`, `log-error`, `cost-tracker`, `session-summary`. Script files retained in `hooks/`; re-enable when upstream Claude Code stdin-pipe fix lands. Tracking: `docs/BACKLOG.md` "Claude Code tool-event hooks get NO stdin pipe" entry.

### Hook-order semantics reminder
No hook ordering changes in this release. Existing 4 hook entries in `hooks/hooks.json` (PreCompact / SessionStart / PostToolUse × 2) all properly prefixed with `${CLAUDE_PLUGIN_ROOT}` per Phase 1 audit.

### Rollback
- Maintainer: `git revert 5099d75` (merge SHA)
- User-side: `/plugin update autopilot @v2.7.2`; the v2.7.3 changes are additive (new scripts, new docs, new `.agents/skills/` symlink) so rollback leaves no stale state apart from the symlink which can be removed manually (`rm .agents/skills`).

### Predecessor version-label note
The 2026-05-14 retro-roundup ship (`57c88ee`) and the 2026-05-14 hook-disable-batch ship (`c5e5a4c`) both previously appeared as separate "releases" (retro-roundup labelled v2.7.3 in INDEX; disable-batch drafted as v2.7.4 in CHANGELOG). Neither bumped canonical `.claude-plugin/plugin.json` (which stayed at `2.7.2`). The first actual post-v2.7.2 canonical bump is this v2.7.3 release, which therefore aggregates all three work batches:

- retro-roundup → relabelled `v2.7.2-followup` in `docs/projects/INDEX.md`
- disable-batch + capture-payload + SESSION_ID fix → merged into this v2.7.3 CHANGELOG entry (the standalone draft v2.7.4 entry has been removed)
- multi-agent portability correction → this release's headline work

The `hooks/README.md` "v2.7.4 disable batch" section header is retained as an **event marker** (referring to the 2026-05-14 disable event), not a plugin version label.

---

## v2.7.2 — Context-Handoff Hardening (L-size) + 3 post-v2.7.1 Fix cycles

**Headline**: Auto-compact 不再 silent drop important context。`hooks/state-checkpoint.sh` 從「bash + 叫 Claude 自願 Edit-append（best-effort）」改寫為 `hooks/state-checkpoint.js`（Node JSONL parser，hook 自己撈 transcript，**零 LLM compliance dependency**）。新增 `hooks/intent-capture.js`（PostToolUse 寫 per-cwd resume hint）；`hooks/session-start.sh` 加 per-cwd intent 顯示（hostname filter + 24h auto-clear circuit breaker）。Plus 3 post-v2.7.1 Fix cycles consolidated（B/A/eval-proxy）。

### Added

- **`hooks/state-checkpoint.js`** — Node 重寫 PreCompact hook（v2.7.2，replaces bash + `state-checkpoint.sh` which becomes `state-checkpoint.sh.bak`）。Hook 自己 parse transcript JSONL（newest-first、filter-first/tail-after、per-block thinking truncate 500B、global 8KB cap、UTF-8 safe）。失敗 emit visible diag in-file + stderr。Diagnostic JSONL log at `~/.autopilot/.state-checkpoint.log`（rotate 1MB）。Inspired by tanweai/pua session-restore.sh + claude-powerloop-plugin sibling-file design。
- **`hooks/intent-capture.js`** — Tier A PostToolUse hook（v2.7.2）。寫 per-cwd `~/.autopilot/intent/<sha1(realpath(cwd))>.json`：session_id, hostname, last_updated, last_tool, last_tool_input_summary, tool_count_session, cwd, git_branch。Multi-cwd race-free。Circuit breaker：10 連續 fail → `intent-capture.disabled` flag（auto-clear 24h / plugin-version-bump / manual `rm`）。Env opt-out `AUTOPILOT_INTENT_CAPTURE=false`。
- **`hooks/session-start.sh` 加 per-cwd intent hint** — 啟動時讀 per-cwd intent，hostname filter 後輸出 1-2 行 resume hint；intent-capture disabled 時印 ⚠ warning。既有 compaction-state.md recovery 邏輯保留。
- **B fix** (`99ab8a6`) — SubAgent skill-invocation rule。Seven-Element Task Prompt 加 `### SKILLS` 段，dev-flow L-1.6 紀律延伸進 ceo-agent / team SubAgent dispatch。Inspired by claude-powerloop-plugin v0.4.0+ commit `8f6af68`。
- **A fix** (`ec9027f`) — Blind re-dispatch principle。新 `references/blind-dispatch.md` + quality-pipeline Re-review Loop / audit Phase 2+4 接引用。Round 2 reviewer dispatch 必須剝離 prior verdicts 防 quality-gate self-bypass。Inspired by claude-powerloop-plugin v0.4.0+ `examples/blind-dispatch.md`。
- **Eval-proxy clarification + router-judge plan** (`01ad396`) — `scripts/run-eval-batch.sh` 加 header documentation 與 env parametrize (`RUNS_PER_QUERY` / `MODEL`)；docs/plans/2026-05-14-eval-router-judge.md 新 proposal。High-fidelity baseline at `skill-creator-workspace/results/*/2026-05-14_155325/`（opus×5 runs, 0% recall confirmed as isolation-test floor）。

### Changed

- `hooks/hooks.json` — PreCompact hook `state-checkpoint.sh` → `state-checkpoint.js`；PostToolUse `.*` 加 `intent-capture.js`（intra-matcher order：intent-capture → log-error → reload-watch；`suggest-compact` 在 separate Write|Edit matcher block，與 `.*` block 跨 block 並行 / 非確定順序）；description「9 default-on」→「10 default-on」。
- `hooks/README.md` — Tier A 9→10 hooks，加 reload-watch + state-checkpoint + intent-capture rows，加 Self-Disable Recovery subsection。Architecture diagram 同步。
- `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` — version 2.7.1→2.7.2，description「14 hooks (8 default-on)」→「16 hooks (10 default-on)」。

### Review Loop（L-size dogfood）

3 rounds plan review（Architect / QA Devil / Ops/SRE）。r0：原 3-layer 提案 (UserPromptSubmit + count_tokens / PreCompact exit 2 / TaskList rehydrate) 全票 REJECT，Architect 替代設計 adopted。r1-r3：CONDITIONAL trajectory（major redesigns → smaller refinements）。Plan v4 absorbed all r3 critical findings inline。Pre-merge review at L-5.2 將補上 implementation 風險。詳見 [project README](docs/projects/_archive/2026-05-14-context-handoff-hardening/README.md#review-background) + [plan §1.3-§2.3](docs/plans/2026-05-14-context-handoff-hardening.md)。

### Rollback

- **Maintainer**: `git revert <merge-sha>` on develop
- **User-side** (post-marketplace pull): `/plugin update autopilot` to v2.7.1 + cleanup new sibling files:
  ```bash
  rm -rf ~/.autopilot/intent/
  rm -f ~/.autopilot/intent-capture.disabled
  rm -f ~/.autopilot/.state-checkpoint.log
  ```

---

## v2.7.1 — Post-v2.7.0 Routing Polish + D-1/D-2 Dogfood Closure

**Headline**: Three post-merge Fix cycles consolidated into a release: skill-description tightening (`bae3f43`), D-1 + D-2 scenario dogfood verification (`f5c1d0a`), and chain-aware reviewer-prose alignment across six doc surfaces (`f69f4b7`). v2.7.0's coexistence design is now backed by routing evidence; v2.7.1 is the first taggable release of the post-merge train.

### Added

- **D-1 + D-2 dogfood log** (`docs/projects/_archive/2026-05-14-superpowers-coexistence/dogfood-routing-log.md`, §D-1 + §D-2) — 9-query scenario A routing observation (autopilot v2.7.0 + superpowers both installed, dispatch-config chain active) plus 2-query scenario C `disabledSkills` cutoff observation. Verifies chain delegation works as designed; documents three loud findings (session-snapshot vs disk-state gap, doc-prose fragility now closed, `/reload-plugins` agent-invokable bottleneck).
- **Follow-up plan** `docs/plans/2026-05-14-reload-plugins-agent-invokable.md` — proposes Option D (watcher hook + reminder) as short-term mitigation for the `/reload-plugins` bottleneck surfaced by D-2; Option A (Claude Code core agent-invokable reload) for long-term.

### Changed

- **Skill descriptions tightened** (`bae3f43`) — 3 routing ambiguities from v2.7.0 scenario B dogfood addressed by precise description claims:
  - `test-strategy`: explicit `Not for: TDD red-green-refactor cycle (→ superpowers:test-driven-development)` exclusion + `specific test debugging (→ debug)`
  - `profiling`: claims `'got slower after deploy' — measure before assuming the deploy diff is the cause`, defers crashes → debug, slow-tests-by-design → test-strategy
  - `debug`: claims `intermittent failures (incl. flaky tests with environment divergence), or 'works on my machine' issues`, explicitly defers perf regressions to profiling
- **Chain-aware reviewer prose alignment** (`f69f4b7`) — six doc surfaces updated to point at the `.claude/dispatch-config.md` `## Code Review` chain instead of hardcoded `autopilot:reviewer`:
  - `skills/quality-pipeline/SKILL.md:56` — pipeline directive
  - `skills/quality-pipeline/references/code-review.md:67-92` — `## Invocation` restructured
  - `.claude/finish-flow-config.md:32` — L-5.2 Pre-Merge Review wording
  - `agents/README.md:25,38` — dispatch boundary explainer
  - `README.md:452,457` + `README.zh-TW.md:445,450` — Dispatch boundary section (EN + zh-TW mirrors)

  All six surfaces use the canonical phrasing `default fallback when the chain is unset or no chain entry is dispatchable` (EN) / `chain 未設或 entry 不可 dispatch 時預設 fallback 為 autopilot:reviewer` (zh-TW). The reviewer-chain default-to-autopilot:reviewer is preserved triple-redundantly (SKILL directive + code-review.md lead + bullet list at code-review.md:92).

### Fixed

- **Documentation fragility** identified by D-1 dogfood (`f5c1d0a` loud finding #2) — `skills/quality-pipeline/SKILL.md:56` + `references/code-review.md:69` + `.claude/finish-flow-config.md:32` previously had hardcoded "primary reviewer" prose that contradicted chain logic in the same files. Now consistent. (Closed in `f69f4b7` after 3 review rounds.)

### Notes

- **Release model** — v2.7.1 is the first git-tag of the v2.7.x line. v2.7.0 (`eb70999`) was version-marked in manifests but not git-tagged; the cumulative v2.7.1 tag at this commit captures the full v2.7.0 coexistence ship + post-merge polish train.
- **Single-reviewer Fix-size waiver** applied to both `bae3f43` and `f69f4b7` (rationale: narrow follow-ups grounded in dogfood evidence; full L-loop already ran for v2.7.0). Both waivers documented in `dogfood-routing-log.md` §59-67.
- **Known limitation**: `/reload-plugins` is user-side; agent cannot fire it. D-2 scenario C verification used reasoned inference rather than live observation. See `docs/plans/2026-05-14-reload-plugins-agent-invokable.md` for the proposed remediation.

## v2.7.0 — Superpowers Coexistence + Standalone Mode

**Headline**: autopilot now works fully without the `superpowers` plugin installed, and offers first-class coexistence semantics when it is. v2.0-v2.6 implicitly assumed `superpowers` was always present; v2.7.0 makes that explicit and optional.

### Added

- **4 restored fallback skills** (originally removed in v2.0 commit `f08812c` under the「Superpowers always installed」assumption):
  - `skills/debug/` — evidence-first debugging (tool → log → code) with Three Red Lines
  - `skills/test-strategy/` — test pyramid, baseline 守則, failure investigation funnel
  - `skills/team/` — team allocation decisions (when to組隊, role selection, dependency analysis)
  - `skills/profiling/` — evidence-first performance profiling (only methodology entry point in the ecosystem)
  Each ships with a `## Coexistence with Superpowers` body section explaining the relationship to its superpowers counterpart (if any).
- **`project-config-template/dispatch-config.md`** — declarative routing chains for orchestrator skills:
  - `## Parallel Dispatch` (superpowers:dispatching-parallel-agents → native)
  - `## Code Review` (autopilot:reviewer → superpowers:code-reviewer → project-specific)
  - `## Methodology Preferences` (4 sub-chains: Debugging, Testing methodology, Performance profiling, Team allocation)
  First-available-wins; no `mode` field; per-chain ordering expresses all preferences.
- **README "Superpowers Coexistence" section** (both EN and zh-TW) — three deployment scenarios with concrete config snippets:
  - A: superpowers installed (recommended default; dispatch-config chain delegates tactically)
  - B: superpowers NOT installed (autopilot standalone)
  - C: superpowers user-level, pure-autopilot per-project (`.claude/settings.json` `disabledSkills` escape hatch)

### Changed

- **Tagline revision**: plugin.json + marketplace.json + both READMEs reframed from「Sets the rules; Superpowers executes」(v2.0-v2.6) to「Standalone-capable orchestration that coexists with Superpowers」.
- **6 orchestrator skills now auto-inject `dispatch-config.md`** via `!cat` preprocessor (matches existing config-injection pattern in dev-flow / quality-pipeline / finish-flow): `quality-pipeline`, `ceo-agent`, `finish-flow`, `think-tank`, `think-tank-dialectic`, `dev-flow`. dev-flow also gains a Session Rules table row pointing at dispatch-config.
- **`skills/quality-pipeline/references/code-review.md:80-95`** — rewrote the previous「quality-pipeline does **not** runtime-detect」paragraph to align with chain-based dispatch design. Reviewer selection now reads from dispatch-config's Code Review chain; first available wins; unavailable plugins fall through naturally.
- **`.claude/finish-flow-config.md` + `.claude/quality-gate-config.md`** — `superpowers:code-reviewer` fallback marked as conditional on the plugin being installed (rather than implicitly available).
- **README skills count badge**: 12 → 16 (4 fallback skills restored); plugin.json + marketplace.json description "12 skills" → "16 skills".
- **README "Why 12 skills?" → "Why 16 skills?"** — Design Philosophy section reframed: v2.0 removal claim updated to「v2.7.0 restores them as fallbacks with explicit coexistence design」.
- **README "Hooks (v2.5.0)" heading → "Hooks"** — version info moved inline to avoid heading-bump on every release.
- **README.zh-TW.md version badge** — catch-up from v2.5.0 to v2.7.0 (was drifting behind EN README's v2.6.0).
- **`hooks/hooks.json`** description string version (v2.6.0) → (v2.7.0).
- **`plugin.json` + `marketplace.json` version 2.5.0 → 2.7.0** — also catches up missed v2.6.0 manifest bump.

### Migration

If you upgrade from v2.6.0 and previously **removed** `debug`, `test-strategy`, `team`, or `profiling` entries from your `CLAUDE.md` skill routing tables (expecting them to remain absent post-v2.0), be aware they're back as fallback skills in v2.7.0 and may now trigger on the corresponding keywords. Two ways to suppress:

1. (Preferred) **Express your preference in `.claude/dispatch-config.md`** — list `superpowers:X` first in each methodology chain so orchestrator skills delegate to superpowers; the autopilot fallback stays in the catalog but is not preferentially dispatched.
2. (Hard cut) **Add to `.claude/settings.json`'s `disabledSkills`**:
   ```jsonc
   {
     "disabledSkills": [
       "autopilot:debug",
       "autopilot:test-strategy",
       "autopilot:team",
       "autopilot:profiling"
     ]
   }
   ```

### Note on v2.0 design intent

v2.0's rule-setter model (autopilot sets rules, Superpowers executes tactics) remains the **recommended deployment** when superpowers is installed. v2.7.0 is forward-progress, not reversal: it adds a standalone-capable mode for users without superpowers while preserving the v2.0-v2.6 coexistence semantics for users with superpowers. The brand tagline change reflects coexistence becoming first-class, not the rule-setter model being abandoned.

### Evidence

- 4 SKILL.md files at `skills/{debug,test-strategy,team,profiling}/`; each contains `## Coexistence with Superpowers` H2 + verbatim restoration of body content from `f08812c^`.
- `dispatch-config.md` has 2 H2 operational chains + 1 H2 Methodology Preferences umbrella with 4 H3 sub-chains + Fallback semantics; no `mode` field.
- 6 orchestrator SKILL.md files contain `!\`cat .claude/dispatch-config.md` preprocessor.
- `skills/quality-pipeline/references/code-review.md`: `grep -c "runtime-detect"` returns 0.
- README + zh-TW: both have `## Superpowers Coexistence` H2 section; both have skills-16 badge; both have v2.7.0 version badge.
- CHANGELOG (this entry): describes all phases; migration callout for v2.6.0 users present.

### Plan + project tracking

- Plan: [`docs/plans/2026-05-14-superpowers-coexistence.md`](docs/plans/2026-05-14-superpowers-coexistence.md)
- Project: [`docs/projects/_archive/2026-05-14-superpowers-coexistence/README.md`](docs/projects/_archive/2026-05-14-superpowers-coexistence/README.md)
- Review loop: r1 (3 parallel reviewers, approve-with-revisions) + r2 (single focused reviewer, approve-with-minor-revisions). See plan §9 for findings.

---

## v2.6.0 — Model Routing

### Added

- **Model routing for subagent dispatch** — skills now select model + mode per role
  (planner/reviewer → sonnet+plan, implementer → opus, test-runner → haiku)
- **`references/model-routing.md`** — shared default routing table, ships with plugin
- **`.claude/model-routing-config.md`** — per-project override (optional)
- **`project-config-template/model-routing-config.md`** — template for project customization

### Changed

- **`dev-flow`** — auto-injects `model-routing-config.md` via `!cat` preprocessor
- **`think-tank`** — role agents dispatch with `model: "sonnet", mode: "plan"`
- **`quality-pipeline`** — reviewer dispatch with `model: "sonnet", mode: "plan"`
- **`survey`** — researcher/skeptic dispatch with `model: "sonnet"`

### Evidence

Based on 90-run benchmark across 6 providers (Claude opus/sonnet/haiku, Gemini 2.5
Flash, GLM 5.1, MiniMax 2.7) using 10 real codebase tasks:
- All providers scored 94-98% accuracy on analysis tasks — model choice barely matters
- Runtime constraint (`mode: "plan"`) achieves 95-100% compliance vs 70-80% prompt-only
- Cost: opus $0.115 → sonnet $0.074 (-34%) → haiku $0.037 (-68%) per run

## v2.5.0 — Universal Hooks (Ship B)

### Added

- **14 universal hooks** — runtime enforcement layer complementing the methodology agent layer
  shipped in v2.4.0. Ported from [my-claude-devteam](https://github.com/NYCU-Chung/my-claude-devteam)
  v1.1.0 (MIT) with Ship A review adjustments.
  - **8 Tier A hooks (default-on)**: `large-file-warner` (>500KB warn, >2MB block),
    `suggest-compact` (tool-call counter, /compact at 50), `cost-tracker` (token cost JSONL),
    `audit-log` (bash commands + auto secret redaction), `session-summary` (git state at Stop),
    `log-error` (error keyword detection), `commit-secret-scan` (staged secret scan, hard block),
    `branch-protection` (anchored whole-ref regex, env override)
  - **6 Tier B hooks (opt-in)**: `config-protection` (linter config guard),
    `check-console` (console.log warning), `accumulator` + `batch-format` (batch Prettier + tsc),
    `test-runner` (auto sibling test), `design-quality` (generic UI warning),
    `mcp-health` (exponential backoff)
- **`hooks/_shared/secret-patterns.js`** — shared secret detection module used by `audit-log`
  and `commit-secret-scan`. Covers OpenAI, Anthropic, GitHub (PAT/OAuth/App), AWS, Google API,
  Slack, Stripe tokens + inline kv patterns. Fixes Ship A r1 mi1 (regex drift between hooks).
- **`hooks/README.md`** — comprehensive hook documentation with exit code convention, architecture,
  and source attribution
- **`settings.example.json`** — opt-in hook activation examples for Tier B hooks
- **`project-config-template/hooks.json`** — project-level hook override template

### Changed

- **`hooks/hooks.json`** — expanded from SessionStart-only to full lifecycle registration
  (PreToolUse, PostToolUse, Stop) for all 8 Tier A hooks
- **`.claude-plugin/plugin.json` and `marketplace.json`** — version 2.4.0 → 2.5.0, description
  updated to mention 14 hooks
- **README.md + README.zh-TW.md** — new Hooks section, hooks-14 badge, updated Inspired By
  devteam entry for Ship B, updated design philosophy

### Ship A Review Fixes (incorporated into design)

| Finding | Fix |
|---------|-----|
| C1: branch-protection substring match | Anchored whole-ref regex `^(main\|master)$` + env override |
| mi1: secret regex drift | Shared `_shared/secret-patterns.js` module |
| mi1: cost-tracker privacy | `AUTOPILOT_COST_TRACKER=false` opt-out |
| mi1: suggest-compact counter persistence | `/tmp/claude-tool-count-${CLAUDE_SESSION_ID}` |
| mi2: testing 3/8 too soft | 8/8 Tier A positive + negative tests |

### Source

Same as Ship A — [NYCU-Chung/my-claude-devteam](https://github.com/NYCU-Chung/my-claude-devteam)
v1.1.0 (MIT). Ship B absorbs 14 of 15 hooks with the adjustments listed above. `log-error`
rewritten from Bash to Node.js for consistency with other hooks.

### Scope Completeness (L-1.5 walkthrough)

~26 files in this release:

**~20 new**: plan doc, project dir, 14 hook JS files, `_shared/secret-patterns.js`,
`hooks/README.md`, `settings.example.json`, `project-config-template/hooks.json`

**6 modified**: `hooks/hooks.json`, `README.md`, `README.zh-TW.md`, `plugin.json`,
`marketplace.json`, `CHANGELOG.md`

---

## v2.4.0 — Methodology agents + voltagent companionship

### Added

- **3 methodology agents** (`agents/reviewer.md`, `agents/debugger.md`, `agents/planner.md`) —
  autopilot's Three Red Lines discipline (closure / fact-driven / exhaustiveness) now has an
  executable carrier. Dispatched automatically by `quality-pipeline`, `dev-flow`, `ceo-agent`,
  and other autopilot skills. All three are read-only (no `Edit` / `Write` tools) and produce
  findings/proposals/plans with a unified enum-based `### Handoff` output contract.
  - `reviewer` (opus) — pre-commit / pre-merge code review, security audit, plan critique;
    enforces file:line citations and `✅ Verified Clean` sections
  - `debugger` (opus) — evidence-first root-cause analysis with 5-phase methodology and PUA
    stress trigger (2+ failed attempts → forced 3 fresh hypotheses); produces `Proposed Fix`
    as diff, never applies patches
  - `planner` (sonnet) — six-element Task Prompt decomposition (goal / scope / input / output /
    acceptance / boundaries); cannot write code, emits plan for caller to execute
- **`agents/README.md`** — documents dispatch boundary, unified output contract, enum grammar,
  and how autopilot methodology agents coexist with voltagent role agents without conflict
- **README `Recommended Companions` section** — positions voltagent as the recommended
  companion for role-specialized work (80+ language / infra / domain agents), clarifies
  three-layer architecture (methodology / role / project), explains that autopilot does not
  runtime-detect voltagent

### Changed

- **`quality-pipeline` dispatches `autopilot:reviewer` by default** — `skills/quality-pipeline/
  references/code-review.md` updated to dispatch `autopilot:reviewer` instead of
  `superpowers:code-reviewer`. This is a static dispatch-target change in skill prose, not a
  runtime fallback mechanism. External skill API unchanged.
- **`.claude-plugin/plugin.json` and `marketplace.json`** — version 2.3.0 → 2.4.0, description
  updated to mention 3 methodology agents

### Rationale

autopilot's methodology was previously documented only in skill markdown. When `quality-pipeline`
or `ceo-agent` dispatched reviewers or debuggers, they fell back to `superpowers:code-reviewer`
or third-party agents that lacked autopilot's Three Red Lines discipline — the plugin's core
differentiation was not reaching the execution layer. The 3 methodology agents close this gap
by carrying closure / fact-driven / exhaustiveness rules into the agent's system prompt with
a fixed output contract (severity tiers, `✅ Verified Clean`, enum-based Handoff).

The layered split — autopilot owns methodology, voltagent owns role specialization, project
repos own domain-specific agents — is a deliberate divergence from
[`NYCU-Chung/my-claude-devteam`](https://github.com/NYCU-Chung/my-claude-devteam)'s all-in-one
12-agent approach. autopilot stays orthogonal to voltagent's role-agent ecosystem by deferring
role expertise and only shipping the methodology axis.

### Source

- Design source: [NYCU-Chung/my-claude-devteam](https://github.com/NYCU-Chung/my-claude-devteam)
  v1.1.0 (MIT licensed). Absorbed: Three Red Lines, P7 `[P7-COMPLETION]` output contract pattern
  (adapted to autopilot's unified `### Handoff` section), P9 six-element Task Prompt,
  evidence-first debug methodology, PUA stress trigger, physical tool-restriction for methodology
  agents. Not absorbed: P7/P9/P10 role language (overlaps with autopilot S/L/H sizing), 12 role
  agents (deferred to voltagent), 15 hooks (deferred to Ship B / v2.5.0).
- Review history: two rounds of parallel review via voltagent-qa-sec:architect-reviewer +
  feature-dev:code-reviewer + voltagent-meta:agent-organizer. Plan doc:
  `docs/plans/2026-04-12-methodology-agents-and-hooks.md`.

### Out of Scope (deferred to Ship B / v2.5.0)

- 14 universal hooks (large-file-warner, suggest-compact, cost-tracker, audit-log,
  session-summary, log-error, commit-secret-scan, branch-protection + 6 opt-in hooks) —
  separate plan / ship once v2.4.0 has dogfood exposure

## v2.3.0 — L-1.6 skill routing forcing function

### Added

- **`dev-flow` L-1.6 Skill routing TaskCreate** — new mandatory parent task at L-1 alongside
  the existing L-5 `finish-flow` parent. Applies the passive→active TaskCreate forcing
  function pattern (first proven at L-5) to skill routing:
  - Parent task "L-1.6: Skill routing — invoke required skills for all affected code areas"
    must be created at L-1 time. Missing it = failed L-1 gate.
  - Input is the module list produced by L-1.5 Scope Completeness Audit.
  - Completion criteria: every required project skill actually invoked via the Skill tool
    (reading the skill file is explicitly NOT invoking), plus a one-line "what this skill
    told me for this task" note captured in session context.
  - **Phase tasks (P0..PN) must be created with `blockedBy=[L-1.6]`** — this is the
    mechanical layer: phases literally cannot start until skill routing completes. Two
    layers of defense: system-reminder surfaces the pending parent, and the blockedBy
    dependency makes implementation unclaimable.
- **`dev-flow` Anti-patterns** — three new rows covering the failure modes L-1.6 is
  designed to block: "skip because I already read CLAUDE.md", "create phase tasks
  without blockedBy", and "mark L-1.6 completed after reading skill markdown".
- **`dev-flow` Pre-implementation Checklist** — three new L-size rows covering L-1.5
  audit, L-1.6 skill routing parent, and phase-task blockedBy dependency.
- **`dev-flow` Phase 1 Session Start gate 6** — now cross-references L-1.6 as the active
  enforcement (gate 6 alone is passive markdown, retained as documentation).
- **`dev-flow` L-1.5 Scope Audit** — now explicitly "feeds into L-1.6", so the module
  list cannot be dropped on the floor between audit and phase start.

### Background

On 2026-04-11, the `reconnect-regression-fix` session ran a full fix workflow against
`src/network/`, `src/lobby/`, and E2E tests without invoking any of the project's `twgs-*`
skills (`twgs-network`, `twgs-debug`, etc). The existing "Skill routing" bullet in the
L-size Full Gates section (Phase 1 Session Start, gate 6) is passive markdown and got
mentally compressed into "I know this area" — the exact same failure mode that L-5 closing
hit before `finish-flow` replaced inline markdown with active TaskCreate.

The `dev-flow-l5-enforcement` project (v2.2.0) proved that passive→active TaskCreate works
for closing discipline. The Residual Gaps section of its Phase 5 dogfood walkthrough
explicitly flagged skill routing as out-of-scope at the time, to be addressed if the same
incident recurred. It recurred the same day. v2.3.0 applies the proven pattern to the
second gate.

Missing skill invocations don't produce immediate bugs — they systematically waste the
knowledge base the project has invested in, and they're invisible until post-merge review
spots a pattern the relevant skill would have flagged. This release surfaces the failure
at L-1 time where it's cheap to fix.

### Dogfood trace

This release was itself developed under dev-flow S workflow (not L) because the scope is a
single file edit plus mandatory version sync. The v2.2.1 L-1.5 audit dimensions were
walked:
- Source + tests: `skills/dev-flow/SKILL.md` ✅
- User-facing docs: CHANGELOG entry (this section) ✅
- Version bump (semver): 2.2.1 → 2.3.0 (new feat, backwards-compatible) ✅
- Version sync verification (grep): `grep "2\.2\.1"` across repo returned 6 hits, all
  addressed — plugin.json, marketplace.json, README.md badge, README.zh-TW.md badge,
  CHANGELOG.md (new header), SKILL.md line 361 (historical reference, intentionally left)
- Credit / attribution: N/A (pure internal process improvement)
- Dogfood target: ✅ this file IS the target; the new forcing function applies to future
  autopilot L-size work immediately after reload

### Files changed

- `skills/dev-flow/SKILL.md` (L Workflow task tracking block, L-1.5 feeds-into line,
  Phase 1 gate 6 cross-reference, Anti-patterns +3 rows, Pre-implementation Checklist +3 rows)
- `.claude-plugin/plugin.json` (2.2.1 → 2.3.0)
- `.claude-plugin/marketplace.json` (2.2.1 → 2.3.0)
- `README.md` (version badge 2.2.1 → 2.3.0)
- `README.zh-TW.md` (version badge 2.2.1 → 2.3.0)
- `CHANGELOG.md` (this entry)

---

## v2.2.1 — L-1.5 audit: credit + version-sync dimensions

### Added

- **`dev-flow` L-1.5 dimensions checklist** — two new rows added to the Scope Completeness Audit:
  - **Version sync verification (grep)** — any version bump must `grep` the old version string across all tracked files (no pre-filter by extension — tomorrow's repo may add `.toml` / `Dockerfile`). If grep returns N hits, the edit list must touch all N. Enumerating from memory is the failure mode.
  - **Credit / attribution** — any feature absorbing external OSS, prior art, or third-party design must update README's `Inspired By` / credits / acknowledgements section as part of the same release.
- **`ceo-agent` SKILL.md anti-patterns** — two new rows mirroring the new dimensions: "bump version in one file from memory without grepping" and "absorb external OSS / prior art design without crediting source".
- **`dev-flow` L-1.5 historical rationale** — additional paragraph explaining why these two rows were added (the v2.2.0 dual near-miss).

### Background

v2.2.0 (`think-tank-dialectic`) walked the L-1.5 dimensions checklist correctly but still had two near-misses:

1. **`marketplace.json` version bump was missed** — `autopilot:quality-pipeline` caught it after the main commit had already landed. The audit's existing `Version bump (semver)` row correctly triggered, but the audit was walked from memory and the edit list forgot one of the two version files. A `grep "2.1.1"` would have surfaced both immediately.
2. **README `Inspired By` credit was missed** — the user pointed out post-merge that the two source repos (`agora`, `council-of-high-intelligence`) were not credited. The dimensions checklist had no row for attribution at all, so even a careful audit could not have caught it.

Both failures share a root cause: the audit was *enumerated* rather than *grepped*, and one whole dimension (attribution) was missing from the checklist. v2.2.1 fixes both: grep becomes the default for version bumps, and attribution joins the dimensions list as a first-class row.

This release dogfoods both new dimensions: the first action of the v2.2.1 session was `grep "2.2.0"` across the autopilot repo to enumerate all live references before editing, and the credit dimension was checked (N/A — pure internal process improvement, no external OSS absorbed).

### Scope Completeness (L-1.5 walkthrough)

7 files in this release:

**0 new** (process tightening, no new artifacts).

**7 modified**:
- `skills/dev-flow/SKILL.md` (2 new dimension rows + historical rationale paragraph)
- `skills/ceo-agent/SKILL.md` (2 new anti-pattern rows)
- `CHANGELOG.md` (this entry)
- `.claude-plugin/plugin.json` (2.2.0 → 2.2.1)
- `.claude-plugin/marketplace.json` (2.2.0 → 2.2.1)
- `README.md` (version badge 2.2.0 → 2.2.1)
- `README.zh-TW.md` (version badge 2.2.0 → 2.2.1)

Skill count unchanged at 12 (no new skill). No public skill API changes.

---

## v2.2.0 — think-tank-dialectic: Hegelian dialectic for hard decisions

### Added

- **`think-tank-dialectic` skill** — structured Hegelian dialectic (Thesis → Antithesis → Synthesis) for irreversible or high-stakes decisions where two positions have genuine merit. **NOT** a "better think-tank" — a different tool for a different situation. 6 roles: 4 職能 (architect / product / ops-sre / qa-devil via voltagent) + 2 adversarial (Falsifier Popper-style / Inverter Munger-style via general-purpose with inline prompts). Two rounds: R1 independent blind analysis + optional R2 Hegelian cross-examination with forced thesis/antithesis declaration. Outputs Advance Decision Brief with Hegelian Arc, first-class Minority Report, Epistemic Diversity Scorecard self-eval, and sharp distinction between Unresolved Questions (factual gaps — can be researched) and Questions Only You Can Answer (value/preference — human must decide).
- **`think-tank-dialectic` Grounding Protocol** — 5 hard rules preventing "dialectic-for-the-sake-of-dialectic" overuse:
  - Rule 1: Max 2 rounds (no R3)
  - Rule 2: Session-scoped re-entry guard (3rd invocation on same topic → refuse with escape hatch)
  - Rule 3: HIGH consensus auto-downgrade (≥5/6 aligned → skip R2, output Downgrade Brief, recommend `think-tank` next time)
  - Rule 4: Turn-count budget (`dispatched_count > 12` without brief → emergency interim brief)
  - Rule 5: R2 hemlock rule targeting drifting agents (adversarial roles specifically)
- **`think-tank-dialectic` adversarial drift mitigations** — 4 concrete protections against `general-purpose` subagents softening over 2 rounds: R2 full prompt re-injection, verbatim concrete example moves in role prompts, front-weighted anti-drift anchor sentence, hemlock enforcement scan

### Changed

- **`think-tank` SKILL.md** — added escalation path note in "When to Use" (LOW consensus + irreversible → recommend `think-tank-dialectic`) and added `think-tank-dialectic` to "See Also" table. Existing think-tank workflow unchanged — no breaking change
- **`think-tank` brief-template.md** — Decision Brief footer now includes an `### Escalation Recommendation` section that checks R1 consensus level and recommends escalation to dialectic only when LOW consensus meets irreversible decision
- **`ceo-agent` SKILL.md** — added `think-tank-dialectic` to CEO's autonomous skill list, renamed boundary section to "Boundary with survey, think-tank, and think-tank-dialectic" with expanded trigger table, added dedicated "Think Tank Dialectic escalation rules" subsection specifying when CEO must escalate (LOW think-tank consensus + irreversible + both positions have genuine merit + CEO is genuinely willing to commit either way) and when NOT to escalate
- **`hooks/session-start.sh`** — routing table now includes `think-tank-dialectic` row (`"Irreversible decision, genuine stalemate, Hegelian dialectic, 不可逆決策, 兩邊都有道理, 辯證一下"`) so new sessions discover the escalation target
- **README.md + README.zh-TW.md** — skill count 11 → 12, version badge 2.1.1 → 2.2.0, skill count badge 11 → 12, skill table row added, design philosophy section updated

### Background

Completed a full scan of two open-source Claude Code skills: [agora](https://github.com/geekjourneyx/agora) (6 審議室, 31 思想家, 8-step dialectic protocol) and [council-of-high-intelligence](https://github.com/0xNyk/council-of-high-intelligence) (18-member council with enforcement mechanisms). Three key design insights were extracted and absorbed into autopilot:

1. **Every thinking style must carry its own fail-safe** — 100% of the 31 reference agents have a `## Grounding Protocol` section with 3-5 hard rules constraining their own overuse (e.g., Feynman max 2 analogies, Socrates 3-level depth limit on questioning, Popper max 1 analogy). This is the meta-pattern that makes multi-agent deliberation work: single LLMs fail because they have no limits, multi-agent structures force each voice to declare its own.
2. **The core of dialectic is Hegelian (Thesis → Antithesis → Synthesis), not consensus-finding** — `think-tank` maps perspectives; `think-tank-dialectic` resolves genuine stalemates through forced transcendent synthesis (must NOT be compromise).
3. **think-tank-class tools split into two types, not two depths**: "multi-perspective map" (frequent, low cost — think-tank) vs "structured dialectic" (rare, high cost — dialectic). Merging them into `--depth full` flag would erase the friction that keeps dialectic from being reflexively invoked. Separate skill enforces cost discipline.

### Scope Completeness (L-1.5 walkthrough)

16 files in this release:

**8 new**:
- `docs/plans/2026-04-11-think-tank-dialectic.md` (plan doc)
- `skills/think-tank-dialectic/SKILL.md`
- `skills/think-tank-dialectic/references/role-prompts.md`
- `skills/think-tank-dialectic/references/brief-template.md`
- `skills/think-tank-dialectic/references/problem-restate-gate.md`
- `skills/think-tank-dialectic/references/silent-pre-check.md`
- `skills/think-tank-dialectic/references/minority-report.md`
- `skills/think-tank-dialectic/references/epistemic-diversity-scorecard.md`

**8 modified**:
- `.claude-plugin/plugin.json` (version bump)
- `CHANGELOG.md` (this entry)
- `README.md` (skill count, badges, skill table, design philosophy)
- `README.zh-TW.md` (same)
- `hooks/session-start.sh` (routing table row)
- `skills/ceo-agent/SKILL.md` (autonomous skill list, boundary section, escalation rules)
- `skills/think-tank/SKILL.md` (escalation note, See Also row)
- `skills/think-tank/references/brief-template.md` (footer Escalation Recommendation)

Survey skill's boundary comment was evaluated but intentionally not changed — `think-tank` remains the single entry for strategic questions, and dialectic is discovered via think-tank's LOW-consensus escalation to preserve cost discipline.

### Phase 2 deferred (not shipped)

Four mechanisms are explicitly deferred pending Phase 1 real-session feedback:
- Forced Synthesis (R2 禁止選邊 — currently Synthesis Proposal exists but is not enforced)
- Novelty Gate (R2 must have new arguments vs R1)
- Counterfactual Trigger at >70% agreement (currently Dissent Quota exists but no auto-steelman)
- Anti-Recursion rules (Socrates-style 3-level depth limit)

Phase 2 triggers when ≥3 real dialectic sessions reveal: dissent quota failures, synthesis degrading to compromise, or user feedback showing brief didn't change the decision. If Phase 1's 4 core mechanisms prove sufficient, Phase 2 remains unshipped.

---

## v2.1.1 — L-1.5 Scope Completeness Audit

### Added
- **`dev-flow` L-1.5 Scope Completeness Audit** — mandatory discrete TaskCreate before phase enumeration. Walks a dimensions checklist (source/tests/docs/API/templates/CHANGELOG/version/migration/consumers/dogfood) and requires each "yes" row to be either phased or explicitly marked out-of-scope in README. Prevents the failure mode where a correctly-executed phase plan ships an incomplete deliverable because the scope missed user-facing surfaces.
- **`ceo-agent` Execution step 3e** — CEO mandate to run the scope audit BEFORE phase TaskCreate (renumbered prior step 3e to 3f for the phase/L-5-parent TaskCreate). Plus anti-patterns covering "skip audit because obvious" and "enumerate phases before audit".

### Background
2026-04-11 `dev-flow-l5-enforcement` project initially shipped the `finish-flow` skill but missed the autopilot-side user-facing surface (README skill count, CHANGELOG entry, template example, plugin version bump). The source-code dimension was complete; the docs dimension was invisible. `finish-flow` enforces closing discipline — it cannot recover a phase plan that never contained the docs phase in the first place. This is a different failure mode that belongs at L-1 (scope), not L-5 (closing). The audit is the L-1 counterpart to the L-5 forcing function: both are active TaskCreate items that cannot be silently compressed.

### Note on v2.1.0
The `v2.1.1` release itself is the first dogfood of the new audit. Had the audit existed 2 hours earlier, `v2.1.0` would have shipped with docs in a single commit instead of two.

---

## v2.1.0 — finish-flow Forcing Function

### Added
- **`finish-flow` skill** — size-aware closing sequence forcing function. On invocation, immediately `TaskCreate`s size-appropriate discrete sub-tasks (L=6, H=6, Fix=5, S=3) each with explicit verification output. Solves the "passive markdown gets mentally compressed" failure mode that caused repeated L-5 skips in real projects.
  - L-size: Final Goal Review → Pre-Merge Review → Merge → Post-Merge Review → Archive → L Session End
  - H-size: Verify fix → Quality gate → Merge to main → Post-incident learn (MANDATORY) → Delete hotfix branch → Session end
  - Fix-size (5 tasks) and S-size (3 tasks) are OPTIONAL — finish-flow is only enforced for L and H to preserve lightweight-workflow constraints
- **`project-config-template/finish-flow-config.md`** — template for project-specific closing overrides (merge target branch, archive procedure, per-size quality gate, known pitfalls)

### Changed
- **`dev-flow` L-1** now MANDATORILY creates a parent closing `TaskCreate` (`"L-5: Invoke autopilot:finish-flow"`) alongside phase tasks. Parent task stays pending through all phases and is surfaced by system-reminder after every tool use — the forcing function that makes the closing sequence unskippable
- **`dev-flow` L-5** — inline 6-step closing sequence replaced with "invoke `autopilot:finish-flow`". The skill owns the closing sequence via discrete TaskCreate items
- **`dev-flow` H workflow** — step 4 now delegates to `finish-flow` (same forcing function, H-size branch). H-1 mandates parent `"H-9: Invoke autopilot:finish-flow"` TaskCreate
- **`dev-flow` anti-patterns** — +4 rows covering skipped L-1 parent TaskCreate, inlined closing, premature parent completion, batched sub-task TaskCreate
- **`ceo-agent`** — merge-to-develop clarified as within CEO DOA (tactical, locally reversible; merge-to-main still requires Board approval). Execution steps updated to mandate parent closing TaskCreate and finish-flow invocation without pausing between sub-tasks. +3 anti-patterns
- **`project-config-template/dev-flow-config.md`** — new "L-5 / H-9 Closing Forcing Function" section explaining how to reference finish-flow
- **README / README.zh-TW** — skill count 10 → 11, finish-flow row added to skill table and config table

### Background
L-5 completion was silently skipped on 2026-03-17 and 2026-04-11 across different projects. Prior fixes tried bolder markdown, expanded sub-steps, explicit anti-patterns — all passive text, all mentally compressed into "one action" under time pressure. The only mechanism in Claude Code that produces **active** reminders is `TaskCreate` (surfaced by system-reminder after every tool use). This release converts closing-sequence enforcement from passive text to active task reminders. Core insight: the forcing function turns **passive skipping** (forgetting, compressing) into **active cheating** — good-faith operators will not cross the latter line.

### Migration
No config changes required. Existing `.claude/dev-flow-config.md` keeps working. Optionally drop `.claude/finish-flow-config.md` into projects that need closing-sequence overrides — see `project-config-template/finish-flow-config.md`.

---

## v2.0.0 — Rule-Setter Architecture

**Breaking:** Autopilot no longer competes with built-in Superpowers. It sets the rules; Superpowers executes.

### Changed
- **`dev-flow` gained Session Rules** — persistent config injection directives that tell the model to read project config files when debugging, testing, profiling, or dispatching teams. These rules complement Superpowers' tactical skills with project-specific context.
- **`quality-pipeline` slimmed** — keeps pipeline orchestration (test → scan → completeness → review), delegates step methodology.
- **`project-lifecycle` slimmed** — keeps bootstrap/structure, delegates branch finishing mechanics.
- **`audit` config injection activated** — was commented out, now silent `!`cat``.
- **All config fallbacks changed to silent** — `2>/dev/null` without `|| echo`. No noise for projects without config files.

### Removed
- **`debug`** — replaced by dev-flow session rule + superpowers:systematic-debugging
- **`test-strategy`** — replaced by dev-flow session rule + superpowers:test-driven-development
- **`team`** — replaced by dev-flow session rule + superpowers:dispatching-parallel-agents
- **`profiling`** — replaced by dev-flow session rule (methodology was generic; config injection is what matters)

### Migration
Your `.claude/*-config.md` files still work unchanged. `dev-flow` now tells the model to read them via session rules instead of dedicated skills. No config file changes needed.

If you relied on `autopilot:debug`, `autopilot:test-strategy`, `autopilot:team`, or `autopilot:profiling` as explicit skill invocations: invoke them via their Superpowers equivalents (`superpowers:systematic-debugging`, `superpowers:test-driven-development`, `superpowers:dispatching-parallel-agents`) — dev-flow's session rules ensure your project config is still read.

---

## v1.4.4
- Enhanced `ceo-agent` — added cognitive layer inspired by gstack's CEO review agent:
  - **Cognitive Patterns**: 10 thinking instincts (Bezos doors, Munger inversion, Jobs subtraction, Grove paranoia, Altman leverage) that shape tactical decisions within DOA
  - **Boil the Lake**: completeness principle — AI makes marginal cost near-zero, always choose complete over shortcut
  - **Prime Directives**: 5 execution principles (zero silent failures, named errors, shadow paths, 6-month horizon, permission to scrap) complementing quality-pipeline
  - **Scope Mode**: 4 postures (Expand/Selective/Hold/Reduce) chosen at startup, governs opportunity handling throughout execution
  - Fixed startup count, clarified Scope Mode vs DOA interaction, added Scope Opportunities to CEO Report template

## v1.4.3
- Enhanced `dev-flow` — added Fix workflow for bug fixes (any module count, no plan/project needed, ongoing-maintenance audit trail); restructured Quick Decision to separate nature (Fix/H) from size (S/L); fixed H scope check; updated session start/end to cover Fix
- Added scope creep detection to `dev-flow` — auto-escalate S→L when scope grows (3+ commits, 3+ modules)
- Fixed `ceo-agent` — CEO mode now **mandates** project setup for L-size (was text suggestion, now hard gate)
- Added 4 anti-patterns to `ceo-agent` covering project tracking bypass

## v1.4.2
- Activated config injection for `debug` and `test-strategy` skills (were commented out, inconsistent with other skills)
- Rewrote `dev-setup.sh`: symlinks cache dir to local clone (Claude Code only loads from `~/.claude/plugins/cache/`); requires one-time `/plugin install` first

## v1.4.1
- Added `scripts/dev-setup.sh` — one-command dev mode setup (points plugin registry at local clone, skips cache)
- Added Development section to README / README.zh-TW

## v1.4.0
- Enhanced `dev-flow` — unified session lifecycle (absorbed session-start, session-end, goal-check, context-reduce); H-size hotfix workflow, user override protocol
- Enhanced `learn` — session learning summary for L-size tasks; merged memory-health (knowledge health audit)
- Enhanced `next` — merged improvement-queue into Phase 0
- Merged proposal concept into plans (draft/approved status) — overlap check moved to project-lifecycle bootstrap
- Added `test-strategy` — test pyramid, baseline management, feature flag levels
- Added `audit` — systematic comparison between implementations
- Added `debug` — evidence-first debugging (broader than profiling: crashes, bugs, connectivity)
- Enhanced `quality-pipeline` — pre-existing error cleanup, dispatch decision tree
- Enhanced `project-lifecycle` — archive eligibility check, stale entry sweep
- Added `scripts/validate.sh` — skill validation script

## v1.3.0
- Added `profiling` — evidence-first performance profiling methodology, tool selection, interpretation
  - Injects from `.claude/profiling-config.md`

## v1.2.0
- Added `next` — global work recommender (scan → rank → recommend)
- Added `team` — multi-agent parallelization with dependency analysis
- Added `improvement-queue` — process pending maintenance suggestions

## v1.1.0
- Added `quality-pipeline` — unified quality gate with project config injection
- Added `project-lifecycle` — plan → bootstrap → structure → archive
- Added `memory-health` — MEMORY.md audit, knowledge staleness detection

## v1.0.0
- Initial release: dev-flow, survey, think-tank, ceo-agent, learn, retro, context-reduce
