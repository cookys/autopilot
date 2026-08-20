---
status: planned
date: 2026-08-04
size: Fix
entry_level: l4
project: plan-review-codex-trusted-cwd-fix
---

# Plan — Codex plan-review trusted cwd fix

## Background

The `platform-capability-trigger-activation` plan-review session proved that
`dispatch-plan-review.js` launches `dispatch-author.sh` from its private temporary prompt directory.
Codex 0.146.0 rejects that directory before model invocation because it is outside a trusted Git
repository. The prompt file itself must remain private, but the child process must execute from the
canonical repository supplied by `--repo-root`.

This is the caller-boundary slice already recorded under D3 of
`2026-08-03-next-touch-debt-retirement.md`; it creates no new backlog item and does not implement the
separate cgroup-containment work in that deliverable.

## Deliverable contract

Use the canonicalized `--repo-root` as the Codex author child's working directory and pass the same
repository binding to `dispatch-author.sh`. Keep the private 0700 temporary directory and 0600
prompt artifact. Do not add `--skip-git-repo-check`, weaken repository trust globally, or change the
scratch-cwd posture of non-Codex reviewers.

Add a deterministic regression that observes the child cwd and repository argument without model
spend. It must prove that the canonical reviewed repository is used and that an invalid repository
binding still fails before dispatch. Synchronize the generated Codex package mirror.

## Acceptance criteria

- The Codex plan-review author starts in the exact canonical `--repo-root` and receives that same
  repository binding while its prompt remains in the private temporary directory.
- A nonexistent, non-directory, or non-Git repository is rejected before a runner can start.
- Non-Codex seat behavior and the two-attempt/two-generation controller budget are unchanged.
- Root and Codex package copies of `dispatch-plan-review.js` are byte-identical.
- The focused controller suite and repository validation checks pass.

## Verification commands

```bash
bash hooks/tests/dispatch-plan-review.test.sh
cmp -s scripts/dispatch-plan-review.js platforms/codex/plugin/scripts/dispatch-plan-review.js
bash scripts/sync-all.sh --check
bash scripts/validate.sh
git diff --check
```

## Risks and out of scope

The main risk is accidentally granting repo context to every author runner. Scope the cwd change to
the plan-review caller contract and preserve each runner's own isolation behavior. Cgroup
supervision, reviewer framing, and the four platform-capability deliverables remain out of scope.
