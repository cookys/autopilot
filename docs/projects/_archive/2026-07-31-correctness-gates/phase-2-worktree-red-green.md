# Phase 2 — Worktree Red-Green

## Goal

A repo-owned verify script executes from the detached tree being evaluated.

## Design

Map caller-resolved repo-owned scripts back to their repo-relative path inside each worktree.
Keep genuinely external absolute executables absolute. Do not modify the shared test `lib.sh`.

## Tasks

- [x] Add a repo-owned test script whose product dependency differs between base and head.
- [x] Prove the current tool incorrectly reads head product code for the base run.
- [x] Implement worktree-relative resolution for repo-owned scripts.
- [x] Add an external absolute executable compatibility case.
- [x] Preserve CLI, JSON, and exit-code behavior.

## Verification

Acceptance patterns A2 + A1:

```bash
bash hooks/tests/verify-red-green.test.sh
```
