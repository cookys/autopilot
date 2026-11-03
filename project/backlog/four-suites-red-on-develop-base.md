# five hook suites are red on develop at base (BL-0366)

Found during acceptance of the sealbase lane (two independent acceptance runs, cv1 and cv2). Each suite was run with the same command at the shadow base (2902ac939) and at the lane HEAD; the failure was identical on both, so it predates the lane.

## Failures (verbatim from the acceptance reports)

- `hooks/tests/runs-watch-git-stable.test.sh`: rc=1, `14 passed, 1 failed`. The task poll expected GIT_DIR to be unset but it was an empty string.
- `hooks/tests/review-rail-no-session-reuse.test.sh`: rc=1, `6 passed, 5 failed`. Tail line: `--resume not found in output`. The session-id negative-control output is missing as well.
- `hooks/tests/runs-watch-render.test.sh`: rc=1, `72 passed, 3 failed`. S10 and S10b: the count of manifest dated-directory publishes is 0 (S10b expected 3, got 0).
- `hooks/tests/status-cli.test.sh`: rc=1, `32 passed, 1 failed`. The provider-less receipt JSON comparison failed (expected 1, got 0).
- `hooks/tests/runs-watch-task-log.test.sh`: 18 passed, 5 failed at base.

## What is not known

These five are not on the known-red list, and nobody knows which commit turned them red.

## First step

Run git bisect on each suite to find the first red commit, then decide per suite whether the test or the code is wrong.

## When

Next touch of runs-watch, the status CLI or the review rail, or the full-suite run before the 3.0.0 release.
