# A full in-place suite run rewrites `.opencode/package.json` and its lock

Source: depth-0 probe 2026-10-02 (full suite in a fresh clone at 6bdd1a38) and the v2.36.105 landing run with `AUTOPILOT_TEST_SNAPSHOT=0` — both left `@opencode-ai/plugin` bumped (1.18.27 → 1.18.34) and `package-lock.json` changed.

- **Trigger**: next touch of the opencode tests or `scripts/install-opencode.sh`/`sync-opencode-plugin.sh`.
- **Context**: since v2.36.105 the default full run happens in a disposable snapshot, so the real tree is no longer touched; the in-place opt-out still is, and the outer guard only WARNS for working-tree drift. Find which test runs an install/update with cwd = repo (candidates: `opencode-v2-plugin`, `sync-opencode-plugin`, `project-detect`, `check-test-integrity-l1`) and move it into a scratch copy.
- **Effort**: S
