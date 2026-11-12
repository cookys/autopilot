# Suites red on base at every pre-push run: one list

BL-0313. The bullets below are still open. They were not re-run on 2026-11-13.

Cleared the same day, run alone, and not part of the bullets below:

- Green: `external-lifecycle-witness`, `manifest-repo-identity`, `p2-batch-env`, `p2-batch-lifecycle`, `p2-batch-loop`, `p2-batch-wrapper`, `review-server`, `skill-onoff-d0gate-cc`, `suite-residue-reaper`, `qualification-consult-discuss-transport`, `session-mode-live-dir`.
- Host SKIP, not a product green: `post-tool-chain-differential`. The harness re-execs under flock on `/tmp/ptc-fixed-harness.lock`. When that file exists and this user cannot open it, flock exits 66 (Permission denied) before any case. The suite prints SKIP and does not run the corpus.

Seen in the pre-push suite runs of 2026-10-26 to 10-27. Each of these was also red on the base commit, so none is introduced by a lane; confirm each against the base before relying on it.

- `dispatch-author-strict-roster` Case 8 still asserts `-p`, `--model` and `--effort` in argv (red on base since BL-0298).
- `child-parent-record`, `child-session-identity`
- `codex-plugin-package` (qualifier cases)
- `check-tmp-residue-registry` (EXDEV; case 3 parity)
- `agy-stdin-transport`: intermittent under load, green alone (was BL-0315, row removed 2026-11-05)
- `dispatch-detach`, `dispatch-review-b`, `dispatch-review-c`
- `engine-qualify-a`, `engine-qualify-b`, `engine-qualify-badmode`, `engine-qualify-headless`, `engine-qualify-writeboundary`, `engine-qualify-brain`
- `mission-runtime-v2`
- `stage-graph-g8`: `stamp-prereg --check` digest mismatch
- `bash-launch-guard` 100 ms assertion: BL-0305, not repeated.

Goal: either fix each, or record why it is red and since when, so a new red stands out.

Added 2026-10-28 (bltidy20, from the handoff list):

- `test-pipefail-grep-q` has been red for a long time. Re-run on 2026-10-28 at base 403c47f30: 7 passed, 1 failed; the one failure is the check "no printf-into-grep -q shape left in hooks/tests", which finds `hooks/tests/post-tool-chain-differential.test.sh:457` (a printf piped into grep -Eq). Fix is to rewrite that line, or to record why it is accepted and narrow the check.
