# Test-Integrity Gate — L1 (executed-set invariance + real override)

> **Status: NOT STARTED — this is a HANDOFF doc.** A fresh session should read this top-to-bottom, then run `dev-flow` (L-size) to start. P1a (L0) already SHIPPED in v2.25.6.
> Created: 2026-06-26 · Owner: cookys

## TL;DR for the next session

P1a (the **L0 static** test-integrity gate) is **done, verified, merged, pushed** (v2.25.6, develop `dc2949d`). L1 is the **deferred second half**. Your job: design + build the **L1 semantic layer** (and the real override). **Start by writing a per-runner design spec** — the last review flagged L1 as "under-specified for a mechanical implementer", so it must NOT be dispatched until the spec exists.

## What already shipped (context — don't redo)

- **`scripts/check-test-integrity.sh`** — L0 static, git-artifact-only gate. Checks: test-path **additions-only** (`deleted_line`), skip/solo-marker denylist, `rename_escape`, `surface_touch` (independent of test-path), non-waivable `protected_path_touch`/`malformed_config`/`git_error`. **Config read from the trusted base ref** (candidate in-diff `mode:off` ignored). Default `warn`; `block` opt-in.
- Tests: `hooks/tests/check-test-integrity.test.sh` (70 assertions). Config template: `project-config-template/test-integrity-config.md`. Reference: `skills/quality-pipeline/references/test-integrity-gate.md`. Wired into CLAUDE.md inventory + quality-pipeline SKILL.
- Full design + 5-round review history + implementation record: **`docs/plans/2026-06-25-test-integrity-gate.md`** (read §2, §3, §9). The L1 scope lives in that plan's §2.1 (L1) + §3 (Phase P1b) + §4 (residuals).

## L1 scope (what to build)

**1. Executed-set invariance (the semantic layer L0 can't do).**
L0 only reads diff text, so it misses gaming that adds-only or happens outside test files: `test.only`/`fit` (disables all OTHER tests), module `pytestmark=skip`, `collect_ignore`, runner-config exclusions, fixture changes that make tests skip. L1 must **run the test collector on base vs head and fail if the set of tests that ACTUALLY EXECUTE shrinks** (collected-AND-not-skipped/xfail/todo/filtered — use report/JUnit status, NOT `--collect-only` which still lists skipped). Best-effort: only runs when a runner is detected; `repo has no framework` → `unavailable` (OK); `runner present but collection FAILS` → suspicious → require override in block mode (a candidate could break the runner to bypass — round-2 finding).

**2. Real override provenance (currently a fail-safe stub).**
The L0 override is inert: it's committed-tree-only (untracked forgery rejected ✓) but a *legitimate* override can't be constructed because committing the verdict changes the commit SHA its filename must match (fixed-point). L1 needs a real depth-0 mechanism: verdict on an **out-of-commit trusted ref** (e.g. `refs/qc/`, a git note, or a CI-owned path the candidate can't write), digest-bound to the head tree + the changed-path summary, targeted `{file,kind}` waives. Keep `protected_path_touch`/`malformed_config`/`git_error` non-waivable (already enforced in L0).

## ⚠️ MUST DO FIRST (gate before any dispatch)

Write a **per-runner design spec** (the thing that was missing last time): for pytest / jest|vitest / go test (at least), nail down — normalized test-id format, how skipped/xfail/todo/filtered map to "not executed", command discovery, dependency/env setup boundaries, timeout policy, and how base-vs-head collection failures are classified. **Without this, a mechanical implementer will guess** (= the exact `delegate-selftest-false-green` failure this whole feature fights). Consider `brainstorm` or `survey` (how do other test-diff tools collect?) before coding.

## Key gotchas / decisions (carried forward)

- **Do NOT dispatch agy for this repo.** agy `-p` on autopilot writes to its plugin INSTALL copy (`~/.gemini/.../autopilot/`), not the worktree → `no_op` + false self-report. Spiked 2026-06-26: no env knob exists; develop's `dispatch-hetero` fix targets a different agy bug and also concludes "use codex". **Use `gpt-5.3-codex-spark`** (`codex exec --dangerously-bypass-approvals-and-sandbox -m gpt-5.3-codex-spark`) for hetero impl, **`gpt-5.5`** (`-c model_reasoning_effort=xhigh`) for adversarial review. See [[project_agy-writes-install-dir]].
- **Verify independently** — never trust an implementer's own passing tests. Build an **isolated** adversarial harness; wrap each temp-repo case in `( cd "$D" && … )` (a `D=$(fn)` with `cd` in the subshell does NOT change the parent cwd → git ops leak into the real repo; this happened and polluted develop with 12 junk commits, since reset).
- **Override design is the hard part** — it kept resurfacing across 5 review rounds. Treat it as the centerpiece of L1, not an afterthought.
- Semver: L1 is a hardening of an existing script → **PATCH** (new behavior in a shipped script). Default stays `warn`.

## Pointers
- Plan: `docs/plans/2026-06-25-test-integrity-gate.md` (§2.1 L1, §3 P1b, §4 residuals, §9 impl record)
- Shipped script: `scripts/check-test-integrity.sh` · tests: `hooks/tests/check-test-integrity.test.sh`
- Memory: [[project_agy-writes-install-dir]], [[feedback_delegate-selftest-false-green]], [[feedback_verify-reviewer-claims]]
- CHANGELOG v2.25.6, INDEX completed row (merge `0709fc3`)

## First moves for the resuming session
1. Read this + plan §2.1/§3/§9.
2. `dev-flow` (L-size) → branch `feat/test-integrity-l1`.
3. Write the per-runner design spec (brainstorm/survey if helpful) → get it reviewed (gpt-5.5 xhigh loop, like P1a).
4. Only then implement (via gpt-5.3-codex-spark), verify (isolated adversarial harness + gpt-5.5), ship.
