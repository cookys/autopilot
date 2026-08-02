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
- Candidate boundary: exactly ten successor-authorized output paths; no plan/rubric, adapter,
  version-manifest, release, or adjacent review-efficiency changes
- Preserved focused evidence: `dispatch-review` 250 assertions; `dispatch-detach` 74 assertions;
  `bash -n scripts/dispatch-review.sh` clean
- Successor evidence: canonical/mirror `cmp` pairs, complete 260-file hook suite, validation,
  version sync, hook inventory, sync-all, completeness/secret scans, and exact-path audit green

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
cmp -s scripts/dispatch-review.sh platforms/codex/plugin/scripts/dispatch-review.sh
cmp -s references/hetero-dispatch.md platforms/codex/plugin/references/hetero-dispatch.md
AUTOPILOT_TEST_TIMING_FACTOR=3 bash hooks/tests/run.sh
bash scripts/validate.sh
node scripts/sync-version.js --check
node scripts/check-hook-inventory.js --check
bash scripts/sync-all.sh --check
```
