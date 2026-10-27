# Suites red on base at every pre-push run: one list

BL-0313. Seen in the pre-push suite runs of 2026-10-26 to 10-27. Each of these was also red on the base commit, so none is introduced by a lane; confirm each against the base before relying on it.

- `dispatch-author-strict-roster` Case 8 still asserts `-p`, `--model` and `--effort` in argv (red on base since BL-0298).
- `child-parent-record`, `child-session-identity`
- `codex-plugin-package` (qualifier cases)
- `check-tmp-residue-registry` (EXDEV; case 3 parity)
- `agy-stdin-transport`: registered only in BL-0315, not repeated here
- `dispatch-detach`, `dispatch-review-b`, `dispatch-review-c`
- `engine-qualify-a`, `engine-qualify-b`, `engine-qualify-badmode`, `engine-qualify-headless`, `engine-qualify-writeboundary`, `engine-qualify-brain`
- `mission-runtime-v2`
- `stage-graph-g8`: `stamp-prereg --check` digest mismatch
- `bash-launch-guard` 100 ms assertion: BL-0305, not repeated.

Goal: either fix each, or record why it is red and since when, so a new red stands out.
