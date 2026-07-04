# Hetero loop-review remediation — 2026-06-29

Source: dual hetero-engine explore-review (gpt-5.5 xhigh via codex + Gemini 3.5 Flash High via agy)
over the autopilot repo, every finding cross-verified against real `path:line` before inclusion.
Engine-only / unverified claims dropped. Severity recalibrated by autopilot's own conventions.

Status legend: ☐ todo · ◑ in-progress · ☑ done (gpt-5.5 SHIP-AS-IS)

## Verified findings (deduped, both engines)

| # | Bucket | Sev | Finding | Evidence | Both? |
|---|--------|-----|---------|----------|-------|
| 1 | FIX | 🟠 Major | Active docs name removed `.sh` scripts (`tree.sh`/`qc-panel.sh`/`risk-counter.sh`) — operational commands an agent will try to run | `references/tree-contracts.md` (~15×), `hetero-dispatch.md:97`, `blind-dispatch.md:173,275` vs `tree.js`/`qc-panel.js`/`risk-counter.js` | gpt-5.5 |
| 2 | FIX | 🟠 Major | `hetero-dispatch.md:29` says `runner` is **always "agy"**, contradicting `dispatch-hetero.sh --runner auto\|codex\|agy` | `references/hetero-dispatch.md:29` vs `scripts/dispatch-hetero.sh` | gpt-5.5 |
| 3 | FIX | 🟠 Major | Portability doc self-contradicts: `multi-agent-portability.md:74` lumps Antigravity into `.agents/skills/` scanners; `:15` + `AGENTS.md:66` say it imports via `agy plugin install` (NOT a scan path) | `references/multi-agent-portability.md:15,74` | gpt-5.5 |
| 4 | FIX | 🟠 Major | zh-TW version badge stale (`2.26.3` vs `2.26.4`) — `check-readme-parity.js` would flag it but isn't in pre-commit; root cause: `sync-version.js` updates only `README.md` badge | `README.zh-TW.md:13`, `sync-version.js:236` | **both** |
| 5 | FIX | 🟠 Major | `run-eval-batch.sh` cleanup does `rm ~/.claude/commands/*-skill-*.md` — deletes ALL matching user files, not just this run's | `scripts/run-eval-batch.sh:105-109` | gpt-5.5 |
| 6 | FIX | 🟠 Major | `completeness-scan.sh --range` misclassifies range-introduced (committed) stubs as pre-existing — `classify_new` only treats working-tree `0000` as new, so a stub committed inside the range blames to a real SHA → silently passes | `scripts/completeness-scan.sh:75-85` | flash |
| 7 | FIX | 🟠 Major | PreToolUse hook `config-protection.js` reads `/dev/stdin` (ENXIO on PreToolUse per [[hook-transcript-pivot]]); `test-runner.js`/`mcp-health.js` same pattern — need fd-0-first shared reader | `hooks/config-protection.js:27` (+ PreToolUse wiring `hooks.json:43,74`) | gpt-5.5 |
| 8 | IMPROVE | 🟡 Minor | `check-optin-changelog.js` runs `git show` for **every** first-parent commit; scope to commits touching `plugin.json` | `scripts/check-optin-changelog.js:152-177` | flash |
| 9 | IMPROVE | 🟡 Minor | pre-commit narrower than preflight reality — wire `check-readme-parity.js` + `check-hook-inventory.js --check` (change-scoped) | `.githooks/pre-commit:19-68` | **both** |
| 10 | FIX | 🟡 Minor | `check-redispatch-prompt.sh` comment claims indented-block detection that isn't implemented (only fenced) | `scripts/check-redispatch-prompt.sh:101-107` | flash |
| 11 | FIX | 🟡 Minor | Stale agent/hook docs: `AGENTS.md:36` hook-inventory source, `hooks/README.md:31,141` opt-in/order claims | `AGENTS.md:36`, `hooks/README.md:31,141` | gpt-5.5 |
| 12 | FIX | 🔵 Sugg | `probe-diff-domain.sh` excludes lockfiles by exact basename — `frontend/package-lock.json` etc. slip through (telemetry-only, no routing impact) | `scripts/probe-diff-domain.sh:46-48` | flash |
| 13 | FIX | 🔵 Sugg | `dispatch-explore.sh` traps INT/TERM but cleanup doesn't `exit` | `scripts/dispatch-explore.sh:114-117` | flash |
| ~~14~~ | ~~IMPROVE~~ | — | **DROPPED (false positive)** — report files live inside the L1 git worktrees; the `finally` block (`check-test-integrity.sh:1536-1539`) `git worktree remove --force`s them (deletes untracked report files) + `shutil.rmtree`s the auto-created parent. flash saw creation, missed the cleanup. | `scripts/check-test-integrity.sh:1536-1539` | flash |
| 15 | EXTEND | 🟠 Major | Extend `doc-drift-gate.js` with a script-ref checker — mechanizes the path-form (`scripts/x.sh`, `./scripts/x.sh`) AND backticked-bare (`` `tree.sh` ``→tree.js) renamed-ref classes (finding #1). Non-backticked prose mentions intentionally NOT gated (FP risk). | `scripts/doc-drift-gate.js:173-185` | gpt-5.5 |
| 16 | EXTEND | 🟡 Minor | Eval harness covers 16/24 skills; generate skill list + report missing eval sets | `scripts/run-eval-batch.sh:2,53` | **both** |
| 17 | FIX | 🟠 Major | **(discovered during validation, not by engines)** `check-hook-inventory.test.sh` broken on develop: sandbox never copies `hooks/opt-in-manifest.json` (a derivation input since v2.26.2) → script ENOENTs → 17/18 assertions fail; also stale `8 default-on` vs current `10`. Test-only (no-bump). | `hooks/tests/check-hook-inventory.test.sh:16,44,63,70` | (validation) |

Dropped (engine claimed, NOT verified / already backlogged / false-positive): codex's "no DO item beyond BACKLOG"; any item already in `docs/BACKLOG.md` (opt-in multiplexer, domain routing, hetero-dispatch skill wrapper).

## Execution order (cheapest-correct first; gpt-5.5 loop-reviews each batch to SHIP-AS-IS)

- **Batch A — operational doc drift (no-bump, docs-only):** #1 #2 #3 #11
- **Batch B — release hygiene (PATCH):** #4 #9 (sync-version zh-TW badge + pre-commit wiring)
- **Batch C — script correctness/safety (PATCH):** #5 #6 #8 #10 #13 #14
- **Batch D — hook fd-0 reader (PATCH, careful):** #7
- **Batch E — mechanize the class (PATCH):** #15
- **Batch F — telemetry/coverage (PATCH/no-bump):** #12 #16

Each batch: implement → `dispatch-review.sh --runner codex --model gpt-5.5` on the diff → fix round → re-review until `VERDICT: SHIP-AS-IS` or loop_max_rounds(5).

## Pre-existing test failures discovered (out of scope — for a follow-up)

Full hook suite on this branch = **61 passed, 3 failed**; all 3 also fail on clean `develop`
(verified via detached worktree) ⇒ NOT regressions from this work. Likely one root cause:
the v2.26.2 opt-in enablement move (`opt-in-manifest.json` + `_shared/opt-in.js`) left some
test harnesses enabling hooks the old way.
- `reenabled-blockers.test.sh` — large-file-warner / branch-protection / commit-secret-scan /
  session-summary exit 0 instead of blocking (opt-in gate not enabled in the sandbox).
- `session-handoff.test.sh`, `session-start-update-check.test.sh` — unrelated subsystems.

Fixed opportunistically (adjacent to Batch B's pre-commit wiring of check-hook-inventory):
finding #17 (`check-hook-inventory.test.sh`) — now 18/18.

## gpt-5.5 loop-review log
- **Round 1** → `FIX-THEN-SHIP`. One finding: run-eval cleanup's whole-batch snapshot still
  races a concurrent run/user creating a matching file mid-run. **Fixed**: per-skill
  before/after diff around each `run_eval` call → deletes only files we observed appear in our
  own invocation window.
- **Round 2** → `FIX-THEN-SHIP`. Two findings: (a) run-eval residual race still open →
  **fixed** with a `flock` single-instance lock (serializes batches, kills the concurrent-run
  case; only a human manually creating a matching file in the exact window remains, documented);
  (b) doc-drift script-ref gate missed `./scripts/...` + bare `tree.sh` while PLAN claimed the
  class was mechanized → **fixed** (`./` prefix + backticked-bare renamed-ref detection against
  the real scripts/ inventory) and PLAN claim made accurate.
- **Round 3** → `FIX-THEN-SHIP`. One finding: claimed the sync-version `README.zh-TW` block is
  unreachable (after `return plans`). **FALSE POSITIVE** — verified by reading the code (block
  is before `return`) AND a functional round-trip (reverted the badge to 2.26.3 → `sync-version`
  rewrote it to 2.26.4, `[WROTE] README.zh-TW.md`). No edit made ([[feedback_verify-reviewer-claims]]).
- **Round 4** → `FIX-THEN-SHIP`. Two findings: (a) `dispatch-explore.sh` signal handler — premise
  (`set -e`) is inaccurate (script is `set -uo pipefail`, no `-e`, so `exit 130` is already
  reached), but applied the cheap hardening anyway (`cleanup` now `return 0`, future-proof);
  (b) `AGENTS.md` pre-commit-gate description was stale after Batch B added checks → **fixed**
  (now lists all always-on + change-scoped checks).
- **Round 5** → `FIX-THEN-SHIP`. One finding: pre-commit `STAGED` used `--diff-filter=ACMR`,
  excluding deletions → deleting a hook/mirror could bypass the new change-scoped gates.
  **Fixed**: dropped the filter (deletions now trigger; verified a deleted `hooks/*.js` path
  matches the trigger).
- **Round 6** (confirmation) → `FIX-THEN-SHIP`. Sole finding = a **verbatim repeat of Round 3's
  false positive** (sync-version zh-TW block "unreachable"). Re-proven FALSE a third time:
  `plans.push` is line 252, `return plans` line 264 (push BEFORE return), and a break→sync→heal
  round-trip rewrote the badge 2.26.3→2.26.4. No edit ([[feedback_verify-reviewer-claims]]).

### Convergence decision (STOP after 6 rounds)
All REAL findings (R1, R2, R4, R5) fixed + independently verified. The only residual objection
(R3 ≡ R6) is a reviewer **misread of the diff hunk**, disproven by code-order inspection AND a
functional round-trip — acting on it would BREAK the working zh-TW sync. Convergence is reached
**by verification, not by the verdict string** (autopilot's verify-reviewer-claims rule overrides
a demonstrably-wrong FIX-THEN-SHIP). Loop stopped at round 6 (> max 5).

### Final state
- Local gates green: `validate.sh`, `doc-drift-gate.js .`, `check-readme-parity.js`,
  `check-hook-inventory.js --check`, `sync-version.js --check`, all sync-version tests, the
  completeness-scan range adversarial test, the doc-drift script-ref negative/FP tests.
- Hook suite: 62 passed (incl. the now-fixed check-hook-inventory), 3 pre-existing failures
  unchanged from develop (documented above, out of scope).
- Zero regressions vs develop.
