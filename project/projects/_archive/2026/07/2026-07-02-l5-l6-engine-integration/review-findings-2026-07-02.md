# External Architecture Review — feat/v2.28.2-engine-integration

> Reviewer: Claude (depth-0 orchestrator + 4 parallel area reviewers: runners / harness+hooks / codex-packaging / conventions+release-hygiene).
> Range reviewed: `origin/develop...HEAD` (merge-base `14180b5`), 27 commits, 268 files, +42k lines.
> Date: 2026-07-02.
> Status of this doc: REPORT-ONLY. Fixes are to be applied by the implementing session. Each finding has a concrete fix + acceptance check so it can be executed without re-deriving context.
> Closure note: This report was generated against an intermediate HEAD (`8fbfc68`). Phase 7 was closed by the scoped `/l5` full-diff loop review that converged at Round 9 with `SHIP-AS-IS`; remaining broad architecture/release-hygiene items here are preserved as report-only follow-up input, not as the authoritative Phase 7 merge verdict.

## Verdict summary

Core engineering quality is HIGH — no fail-open path, no security hole, no injection surface found across all four review areas. The problems cluster in **wiring completeness** (mechanisms exist but are not hooked into any gate) and **release hygiene**, not in code correctness. Recommend fixing the four 🟠 Major items before merge to develop; 🟡/🔵 can ride along or follow up.

## Verified-green baseline (do NOT re-litigate these)

All verified live on this branch at HEAD (`8fbfc68`) on 2026-07-02:

- `bash scripts/preflight-release.sh` → 6/6 pass (v2.28.2 CHANGELOG + INDEX + mirror parity).
- `bash scripts/check-canonical-invariants.sh`, `node scripts/check-readme-parity.js`, `node scripts/check-optin-changelog.js`, `node scripts/sync-version.js --check`, `node scripts/check-hook-inventory.js --check` → all pass.
- `bash hooks/tests/codex-plugin-package.test.sh` → PASS, 59 assertions. **The codex mirror has ZERO drift at HEAD** (`diff -rq skills|scripts|src platforms/codex/plugin/...` → empty, exit 0; both `autopilot-engine.js` copies are 1160 lines). A sub-reviewer reported "mirror already drifted at HEAD / test red (57/2)" — that claim was **REFUTED by direct re-run**; do not chase it. The *structural* gate-wiring gap is real though (Finding 1).
- `/l5`/`/l6` SKILL.md name `engine implement-review` as canonical → project success criterion #3 met.
- Skill count 27 consistent across plugin.json description / architecture.md / AGENTS.md / actual dirs.
- Blind-dispatch is preserved **structurally** in the engine loop: the reviewer receives only the cumulative `git diff <immutable-base>..<latest-commit>` as TEXT (`src/engine/autopilot-engine.js:206-229` `defaultDiffProvider`; `scripts/dispatch-review.sh:122` `cat "$DIFF_FILE"`); no dispatcher prose reaches the reviewer, so no round-number/meta-signal can leak and `check-redispatch-prompt.sh` is structurally unnecessary on this path. This is a strength, keep it.
- Runner-layer secret hygiene verified: env-only auth, header-only transmission, double redaction into 0700/0600 raw logs, `spawnSync shell:false` array args, MiniMax hostname suffix-safe matching (`scripts/dispatch-anthropic-review.js:101-103`).
- Codex platform claims are all empirically backed (`codex-cli 0.142.5`), hook-probe honestly scoped warning-only. No fabricated-platform-fact violations.

---

## 🟠 Major findings (fix before merge)

### F1. Codex mirror payload has no enforced anti-drift gate

**Files**: `scripts/sync-codex-plugin-skills.sh`, `.githooks/pre-commit`, `scripts/preflight-portability.sh`, `hooks/tests/codex-plugin-package.test.sh`, `hooks/tests/run.sh`.

**Context**: `platforms/codex/plugin/**` (~30k lines) is a committed generated mirror produced by `sync-codex-plugin-skills.sh` (rm -rf + rsync of `skills/ bin/ src/ hooks/_shared/ references/ scripts/ project-config-template/` + 4 doc files). The committed-mirror choice itself is correct — Codex install does not copy through symlinked skill dirs (design doc Phase 5, `docs/plans/2026-07-01-cross-harness-engine-infrastructure.md:744-776`) — but:

- The sync script has **no `--check` (read-only drift-report) mode**; its only mode is a destructive rebuild.
- The drift test `codex-plugin-package.test.sh` exists and works, but is wired into **no gate**: not `.githooks/pre-commit`, not `.githooks/pre-push`, not `preflight-portability.sh`, not `preflight-release.sh`. `hooks/tests/run.sh` exists but is likewise not referenced by any hook/preflight.
- This repo's own convention gates every other generated artifact in pre-commit (`sync-version.js --check`, `sync-agent-bodies.sh --check`, `check-hook-inventory.js --check`, `check-readme-parity.js`, `check-canonical-invariants.sh`). This — the largest mirror — is the only ungated one.
- The predicted failure already happened once mid-branch: commit `0117f89 fix(codex): package engine cli support payload` was exactly a payload-drift repair.

**Fix**:
1. Add a `--check` mode to `scripts/sync-codex-plugin-skills.sh`: run the same source list through `diff -rq` (or rsync `--dry-run --itemize-changes`) against `platforms/codex/plugin/`, print drifted paths, exit 1 on drift, write nothing. Keep the header comment updated.
2. Wire it into `.githooks/pre-commit` as an additive fail-fast check, following the existing `sync-agent-bodies.sh --check` block pattern (message + "To fix: ./scripts/sync-codex-plugin-skills.sh && git add platforms/codex/plugin").
   - Optional perf refinement: change-scope it (run only when staged paths touch `skills/ bin/ src/ hooks/_shared/ references/ scripts/ project-config-template/ platforms/codex/`), mirroring the README-parity change-scoping.
3. Add a row/check to `scripts/preflight-portability.sh` (it is the cross-agent acceptance gate; this is check #16) that shells `sync-codex-plugin-skills.sh --check`.
4. Per CLAUDE.md "when adding a new script" (this modifies one): update the CLAUDE.md scripts-inventory row for `sync-codex-plugin-skills.sh` (see F5 — the row doesn't exist yet; add it with the `--check` mode documented).

**Acceptance**: `scripts/sync-codex-plugin-skills.sh --check` exits 0 at clean HEAD; touch any file under `skills/` → exits 1 naming the path; pre-commit blocks a commit in that state; `bash scripts/preflight-portability.sh` includes and passes the new check; `bash hooks/tests/codex-plugin-package.test.sh` still passes.

### F2. Reviewer qualification gate is opt-in and nothing opts in

**Files**: `bin/autopilot.js:37,92-96`, `src/engine/autopilot-engine.js:353-354,423-442,892,938-959`, `skills/l5/SKILL.md`, `skills/l6/SKILL.md`, `skills/ceo-agent/references/level-front-door.md`.

**Context**: `AutopilotEngine` supports `requireQualifiedReviewer` — blocks when `roster.reviewer_qualified !== true` — and the default rosterArgs include `--check-scorecard`, so the field is populated. But the CLI defaults the flag to `false`, and **no skill doc instructs passing `--require-qualified-reviewer`** (`grep -rn require-qualified skills/` → only `engine-onboarding/SKILL.md:119`, which states the fail-closed policy without wiring it). The design doc says unqualified rosters must escalate to the human policy loop; today the default path silently proceeds with an unqualified/unknown reviewer.

**Fix** (pick per policy judgment; option A recommended):
- **A (recommended)**: flip the CLI default — `engine implement-review` passes `requireQualifiedReviewer: true` unless an explicit `--allow-unqualified-reviewer` escape hatch is given. This matches the repo's fail-closed posture. Update `printHelp()` and the l5/l6 SKILL.md invocation lines accordingly. Note this is a shipped-behavior change → belongs in CHANGELOG under the version this rides.
- **B (minimal)**: keep default false, but add `--require-qualified-reviewer` to the canonical invocation in `skills/l5/SKILL.md` step and `skills/l6/SKILL.md` per-unit pipeline step 2, and to `level-front-door.md`'s /l5 delta (see F4).

**Acceptance**: with a roster whose `reviewer_qualified` is absent/false, `node bin/autopilot.js engine implement-review ...` (default invocation as documented in the skills) exits non-zero with `phase: reviewer_qualification`; `bash hooks/tests/autopilot-cli.test.sh` updated + passing.

### F3. `harness-maintenance` skill shipped with no MINOR bump and no CHANGELOG entry

**Files**: `CHANGELOG.md`, `.claude-plugin/plugin.json` (+ mirrors via sync-version.js), `skills/harness-maintenance/SKILL.md` (added in `5ac0b0d` at unchanged v2.28.0), optionally `scripts/preflight-release.sh`.

**Context**: CLAUDE.md semver policy: new skill ⇒ MINOR. Siblings complied (engine-onboarding → 2.27.0, l6 → 2.28.0); harness-maintenance rode in silently — `grep harness-maintenance CHANGELOG.md` → nothing. Only the skill-count fragment moved 26→27. Users get an undocumented skill and the "MINOR = new user-facing capability" contract is broken.

**Fix** (history can't be rewritten; repair the record):
1. Since 2.28.2 is unreleased on this branch, the cleanest repair is: bump the branch target to **2.29.0** via `node scripts/sync-version.js --version 2.29.0 --hook-count 22 --skill-count 27`, rename/merge the CHANGELOG `2.28.2` section to `2.29.0`, and add an explicit line crediting the harness-maintenance skill (with a note it landed code-side in the 2.28.1 series without an entry). Update the project README success criterion #5 wording (it names 2.28.2) with a decision-log entry explaining the re-target.
   - If the owner prefers keeping 2.28.2, the fallback is: add a harness-maintenance entry retroactively under the 2.28.1/2.28.2 section + a CHANGELOG errata note; document in the decision log why the MINOR policy was waived. Either way the CHANGELOG must name the skill.
2. Optional gate hardening (new-script-free): extend `scripts/preflight-release.sh` with a check "every `skills/<name>/` dir must appear somewhere in CHANGELOG.md" (or at least: any skill dir added since the previous release tag must appear in the current version's section). This closes the blind spot that let this through.

**Acceptance**: `grep harness-maintenance CHANGELOG.md` hits; `node scripts/sync-version.js --check` passes; `bash scripts/preflight-release.sh` passes; if re-targeted, INDEX/project README updated consistently.

### F4. Architecture/reference docs are silent on the new engine layer

**Files**: `docs/architecture.md`, `skills/ceo-agent/references/level-front-door.md`, (minor: `CLAUDE.md` "Where context lives" table).

**Context**: the branch's largest structural addition — `src/engine/` (AutopilotEngine, resolve-review-loop bridge), `src/harness/` (capability state + probes), `src/runners/` (implementer/review JS wrappers), `src/hooks/` (host-neutral handlers + per-harness normalizers), `bin/autopilot.js` (CLI: `dispatch review` / `engine review-loop` / `engine implement-review` / `harness report`) — appears in `docs/architecture.md` only as two count bumps (lines 27, 86). `level-front-door.md` (the /l4-/l6 shared main-flow reference) still describes the pre-engine `dispatch-hetero.sh` direct-dispatch flow and never mentions `engine implement-review`, contradicting the updated l5/l6 SKILL.md ("canonical path").

**Fix**:
1. Add a `src/` engine-layer section to `docs/architecture.md`: the four modules, the DI contract (`AutopilotEngine({reviewLoopResolver, reviewDispatcher, implementationDispatcher, diffProvider, repairPromptWriter, clock, cwd})`), the loop semantics (immutable base SHA; per-round repair branch `X-repair-rN-<sha7>`; reviewer sees cumulative base..commit diff as text; converged/non_converged/blocked statuses; exit 0 only on converged), and the layering rule (engine wraps — never replaces — the artifact-verified shell dispatchers).
2. Update `level-front-door.md`'s /l5 delta paragraph to name `bin/autopilot.js engine implement-review` as the canonical impl-loop entry (internally `dispatch-hetero.sh`), keeping direct shell as compatibility fallback — mirror the l5 SKILL.md wording so the two stay consistent (consider whether a `check-canonical-invariants.sh` `repeat` seed should pin the shared phrase).
3. Add `bin/autopilot.js` / `src/engine/` pointers to CLAUDE.md "Where context lives".

**Acceptance**: `grep -n 'src/engine\|bin/autopilot' docs/architecture.md skills/ceo-agent/references/level-front-door.md` hits in both; doc-sync deterministic gate (`node scripts/doc-drift-gate.js` if wired) still green; `bash scripts/check-canonical-invariants.sh` passes.

---

## 🟡 Minor findings (ride-along fixes)

### F5. CLAUDE.md scripts inventory: two missing rows + one stale row
`scripts/dispatch-anthropic-review.js` (new, invoked by `dispatch-review.sh`'s new `anthropic-compatible` runner) and `scripts/sync-codex-plugin-skills.sh` are absent from the inventory table. The existing `dispatch-review.sh` row still says runners `codex|agy|grok|cc-shim` — add `anthropic-compatible` (direct HTTP `/v1/messages`, MiniMax/GLM, env-only auth, fail-closed no_verdict). Add both new rows (alphabetical-by-purpose grouping).

### F6. KR5 deviation: intent-capture precedence changes (behavior vs old Claude hook)
`hooks/intent-capture.js:242-263` + `src/hooks/normalize/claude.js:25`. Two silent precedence flips vs origin/develop:
- `cwd`: old hook always stored `fs.realpathSync(process.cwd())`; now `raw.cwd` (payload, non-symlink-resolved) wins over the canonical fallback. The intent file is still keyed by realpath hash, so on symlinked paths (macOS `/tmp`, symlinked `$HOME`) record key and stored `cwd` value diverge.
- `session_id`: old hook consulted env only (`CLAUDE_CODE_SESSION_ID`/`CLAUDE_SESSION_ID` → cwd-hash); now payload `session_id` wins, and the per-session tool-counter file key follows it.
Downstream consumers (`hooks/session-start.js:490-512`) don't read these fields today, so impact is latent. **Fix**: in the Claude hook's normalizer call, pass canonical cwd/session id as authoritative (so `raw.*` cannot win), OR declare the new precedence intentional and add an integration test asserting the persisted record for a representative real Claude payload (fixtures exist: `hooks/tests/fixtures/claude-post-tool-use.json`). Either way, add the missing precedence test — `hook-handlers.test.sh` currently drives `buildIntentCaptureRecord` with pre-built events and never exercises normalizer precedence.

### F7. `src/runners/implementer.js:62-67` — validator stricter than shell's `precondition_failed` contract
`dispatch-hetero.sh` emits `"branch": ""` on `--branch is required` / early `unknown argument` precondition failures; the JS validator unconditionally requires non-empty `branch`/`base`, so it throws a parse error that masks the real structured error text. Fail-safe (engine still blocks) but misleading diagnostics. **Fix**: gate the non-empty `branch`/`base` assertions on `status !== 'precondition_failed'`, exactly like the existing containment-field gating at `implementer.js:69-76`. Add a test feeding a real precondition_failed JSON (empty branch) through `parseImplementationOutput`.

### F8. `src/runners/review.js:17-27` — validator ignores schema enums
`review-result.schema.json:9-22` declares `status ∈ {reviewed,no_verdict,precondition_failed}` and `verdict ∈ {SHIP-AS-IS,FIX-THEN-SHIP,null}` with `additionalProperties:false`; the JS validator only checks field presence. Downstream string-equality keeps it fail-closed, but the validator under-enforces its own contract. **Fix**: add the two enum checks (and consider unknown-key rejection) in `validateReviewResult`; add a malformed-enum test.

### F9. Test gaps (all on the failure classes above)
- No precondition_failed-through-parser test (would have caught F7).
- `review-runner.test.sh` never exercises `validateReviewResult`'s throw path.
- No coverage of `dispatch-anthropic-review.js` HTTP-timeout or `MAX_RESPONSE_BYTES` cap paths.
Fold these in with F7/F8.

---

## 🔵 Suggestions (optional)

- **S1** `scripts/dispatch-anthropic-review.js:364-397`: add `res.on('error')`/`res.on('aborted')` handlers — a mid-body connection reset currently waits out the full `timeoutMs` instead of failing fast (still fail-closed either way).
- **S2** `src/harness/capabilities/copilot-cli.json:9`: `expires_at: 2026-07-01` ships pre-expired (reads as `ttl_expired` from day one). Either forward-date like the other five records (`2026-07-15/16`) or add a `notes` line saying pre-expiry is intentional for an unverified H0 record.
- **S3** SessionStart stale-facts auto-injection: `formatWarning()` (`src/harness/capabilities.js:398`) and `--format warning` exist, but `hooks/session-start.js` never calls the harness report — the plan's `AUTOPILOT_HARNESS_ATTENTION` framing implies auto-injection that isn't there. Add a one-line "auto-injection deferred" note in the plan/skill, or wire it (opt-in tier).
- **S4** `schemas/hook-event.schema.json` is asserted only in tests, never validated at runtime against normalizer output. Fine as a doc contract; note it, or add a cheap runtime assert in the handlers.
- **S5** `platforms/codex/README.md`: document that ~14 mirrored skills reference Claude-only tooling (Agent tool, TaskCreate/TaskUpdate, `subagent_type`) that doesn't exist under Codex — bodies are read as guidance so nothing crashes, but the limitation should be stated until harness-neutral bodies land (deferred by design to a later phase).
- **S6** Repair-branch proliferation: each loop round creates `X-repair-rN-<sha7>` with no cleanup helper; converged runs leave N-1 stale branches. Consider a reap note in the l5 SKILL outcome table or a `--reap-repair-branches` follow-up.
- **S7** `defaultDiffProvider`/`defaultRepairPromptWriter` mkdtemp dirs are never cleaned up (temp accumulation only; harmless).

## Suggested commit grouping (to avoid conflicts with this doc)

1. `fix(codex): add sync --check drift gate + pre-commit/preflight wiring` (F1)
2. `fix(engine): fail closed on unqualified reviewer by default` or `docs(l5,l6): require qualified reviewer flag` (F2 — decide A/B first)
3. `docs(release): record harness-maintenance skill + version policy repair` (F3 — needs owner decision: re-target 2.29.0 vs errata)
4. `docs(architecture): describe src engine layer; sync level-front-door with l5/l6` (F4)
5. `fix(runners): align validators with shell contracts + tests` (F7, F8, F9, S1)
6. `fix(hooks): pin intent-capture cwd/session precedence + test` (F6)
7. `docs(claude-md): inventory rows for new scripts` (F5, can fold into 1)

This file itself is report-only documentation (no-bump per policy); it may be deleted or moved to `_archive/` when the project closes.
