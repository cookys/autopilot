# Developer info — reviewer output-token budget

- Target branch: `develop`
- Feature branch: `feat/v2.34.1-reviewer-output-budget`
- Size: L
- Compatibility: additive; omitted flag byte-compatible
- Dependencies: platform/stdlib and existing scripts only
- Foreman: reuse `/root/backlog_convergence_foreman` transcript
- Verification authority: independent depth-0 panel, never the implementer/foreman
- Integration: depth-0 owned; foreman must not merge, push, release, or publish
- Successor scope: original eight outputs plus exact generated mirrors at
  `platforms/codex/plugin/scripts/dispatch-review.sh` and
  `platforms/codex/plugin/references/hetero-dispatch.md`

## Frozen runner matrix

| Runner | With `--max-tokens` |
|--------|---------------------|
| `anthropic-compatible` | map to adapter `--max-tokens` |
| `qoderclicn` | map to CLI `--max-output-tokens` |
| `codex`, `agy`, `grok`, `cc-shim`, `claude-native` | exit 2 before runner spawn |

## Required commands

```bash
bash -n scripts/dispatch-review.sh
bash hooks/tests/dispatch-review.test.sh
bash hooks/tests/dispatch-detach.test.sh
AUTOPILOT_TEST_TIMING_FACTOR=3 bash hooks/tests/run.sh
bash scripts/validate.sh
node scripts/sync-version.js --check
node scripts/check-hook-inventory.js --check
bash scripts/sync-all.sh --check
```
