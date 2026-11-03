# Session Handoff — test-integrity L1 + hetero-dispatch/review-loop (2026-06-26)

> **Status: BOTH SHIPS DONE, MERGED, PUSHED.** This is a resume doc for a fresh session.
> `develop` = `origin/develop` = **`03bb60c`** (clean working tree). Nothing in flight.
> Read top-to-bottom; everything you need to continue is here.

## TL;DR for the next session

Two ships landed this session, each through a full **generation-adversarial heterogeneous** review loop (subagent/codex generates → decorrelated gpt-5.5 xhigh reviews in a loop → depth-0 independent adversarial harness → qc-gate subagent):

1. **v2.25.7 — L1 test-integrity gate** (executed-set invariance). DONE.
2. **v2.25.8 — dispatch-hetero codex-trigger fix + best-effort containment + review-loop automation.** The L1 block-mode **override unlock was attempted and REVERTED as UNSAFE** (gpt-5.5 caught it). DONE.

The remaining work is in [`docs/BACKLOG.md`](../../../BACKLOG.md) — top item is the **L1 override re-enable**, which is genuinely hard (needs real OS isolation, see below). There is no half-finished code; pick the next thing from BACKLOG or `/next`.

## What shipped this session (DON'T redo)

### v2.25.7 — L1 test-integrity gate (`scripts/check-test-integrity.sh`, additive to L0)
- **Executed-set invariance**: RUNS the test collector (pytest / jest / vitest / go — **RUN-not-collect**, since `--collect-only` lists skipped tests) on base↔head worktrees; fails `executed_set_shrink` if the set of tests that ACTUALLY execute shrinks. Catches additions-only / out-of-test-path gaming L0's diff-text misses (`test.only`, module `pytestmark=skip`, `collect_ignore`, `testPathIgnorePatterns`, go build-tag drops).
- env-scrubbed, pgroup-killed timeout, always-cleanup worktrees; fail-closed on broken head runner (JS empty/crashed report, go multi-package build-fail, timeout). No fuzzy rename matching (renamed id = drop = documented FP needing override). base-collection-error → `base_failed`/pass (not a false shrink).
- Override verdict-verification plumbing exists but **block-mode HONORING is DEFERRED** (see below).
- Tests: `hooks/tests/check-test-integrity-l1.test.sh` (71 assertions). Spec (4-round review history): [`design-spec.md`](design-spec.md).

### v2.25.8 — dispatch-hetero + review-loop (`9fb6725`)
- **W1 `dispatch-hetero.sh` codex-trigger FIX**: `--runner auto|codex|agy` (auto matches the codex family `*gpt*`/`*codex*` case-insensitively) + `--effort`. The old `*gpt-5.5*`-only match sent `gpt-5.3-codex-spark` to the repo-corrupting agy branch. Explicit `--runner` wins. Tests: 39 assertions.
- **W2 worker containment** (`systemd-run --user --scope` cgroup, reaped + verified on all exit paths) — shipped as **TEARDOWN HYGIENE ONLY**, emits `containment`/`contained` provenance. NOT a security boundary (see the reverted unlock).
- **W3 review-loop automation**: `scripts/resolve-review-loop.sh` + `project-config-template/review-loop-config.md` make the engine roster + loop policy DATA; `/l5` reads it and runs a **decorrelated reviewer** (default `gpt-5.5`) instead of homogeneous Claude. `cp project-config-template/review-loop-config.md .claude/` then `/l5 <goal>`. Tests: 16 assertions.

## ⚠️ The hard open item — L1 override re-enable (BACKLOG, the reason it's hard)

The L1 block-mode override is **always DEFERRED** (`defer_override = config_mode=="block"`). A v2.25.8 attempt to unlock it on `--containment cgroup-verified` was **reverted UNSAFE** — gpt-5.5 adversarial review found two **empirically-verified** escapes that a depth-0 spike + green self-test MISSED:

1. A same-user worker can ITSELF `systemd-run --user --scope` a **SIBLING** cgroup outside the dispatcher's scope → killing only our scope leaves it alive → `contained:true` is a **false attestation**.
2. The `--l1-verdict-file` path was honored even when worker-reachable (warned, not enforced).

**Conclusion (vindicates the original deferral): no local-only, same-user mechanism closes the override forgery hole.** Re-enable needs a REAL isolation boundary — one of: a separate UID for the worker, a real sandbox (container/VM/firejail), or a blocked user systemd bus (`/run/user/$UID/bus`) so the worker can't create sibling scopes. THEN: enforce the verdict path is depth-0-created-after-containment + outside repo/.git/worktree; collapse `containment`+`contained` into ONE attestation enum; add an empirical sibling-escape regression. The `--containment` flag is currently accepted-but-advisory (does NOT unlock — locked in by test 13b).

## Key gotchas carried forward

- **`agy` is unreliable for the autopilot repo itself** — it writes its plugin install copy, not the worktree ([[project_agy-writes-install-dir]]). For THIS repo, hetero impl = `codex` / `gpt-5.3-codex-spark`. (W1 fixed the routing so `dispatch-hetero.sh --runner codex` works directly now.)
- **Don't trust an implementer's own green** — depth-0 must build an INDEPENDENT adversarial harness; wrap every temp-repo case in `( cd "$D" && … )` (a `D=$(fn)` with `cd` in a command-substitution subshell leaks git ops into the real repo — it polluted a feature branch with 2 junk commits this session, cleaned via `git rebase --onto`). The independent harness + the decorrelated gpt-5.5 review each caught real holes the other missed (vitest-blind, go multi-pkg build-fail, the override forgeability).
- **cgroup containment is NOT malicious-proof** against a same-user worker (sibling-scope escape) — see above. It's teardown hygiene.
- **Review pattern that worked**: `codex exec --dangerously-bypass-approvals-and-sandbox -m gpt-5.5 -c model_reasoning_effort=xhigh - < promptfile` (stdin), capture stdout for the verdict; loop until `VERDICT: SHIP-AS-IS`.

## How to continue (first moves)

1. `git -C ~/projects/autopilot log --oneline -3` → confirm at `03bb60c`.
2. `/next` (or read `docs/BACKLOG.md`) → pick the next item. The L1-override-re-enable item is L-size and needs the isolation-boundary decision first (consider `brainstorm`/`survey` on rootless sandboxing before coding).
3. To run the now-automated loop on any task: `cp project-config-template/review-loop-config.md .claude/` (once) → `/l5 <goal>`.

## Pointers
- Spec + review history: [`design-spec.md`](design-spec.md) (§8.3 / §12 carry the override-deferral + revert record).
- Automation proposal: [`hetero-review-loop-automation-proposal.md`](hetero-review-loop-automation-proposal.md).
- BACKLOG: [`docs/BACKLOG.md`](../../../BACKLOG.md) (L1-override re-enable + the v2.25.8 DONE entry).
- CHANGELOG: v2.25.7 + v2.25.8. INDEX: both rows under Completed.
- Memory: [[project_dispatch-hetero-codex-trigger]] (codex routing fixed + cgroup lesson), [[project_agy-writes-install-dir]], [[feedback_delegate-selftest-false-green]], [[feedback_verify-reviewer-claims]].
