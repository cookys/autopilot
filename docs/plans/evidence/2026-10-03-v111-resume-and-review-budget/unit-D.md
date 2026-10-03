# Unit D — dispatch-author suite fails when TMPDIR is a symlink
Worktree `wt-D`, branch `hands/w111/D`, base = default BASE_SHA.

Reproduced by depth-0 at f197fc09: `hooks/tests/dispatch-author.test.sh` passes 144/144 with TMPDIR=/tmp and TMPDIR=/tmp/ but fails 19/144 with TMPDIR set to a symlink to a directory (log: `<SCRATCH>/run/tmpdir/link.dispatch-author.log`, where SCRATCH is the parent of the clone). Failing groups: independently observed polarity receipt; agy script-wrapper / generic alias / runner_failed / empty_output; gemini-flash effort mapping. The dispatch exits 3 (or 2) where 0/1 is expected. A peer host hit the same suite failing until it switched to a plain private /tmp path. `provider-readiness-single-line-frame.test.sh` passes in all shapes (it is a consumer check, rerun it).

Reproduce: `ln -s <some real dir> <SCRATCH>/tdlinkD; TMPDIR=<SCRATCH>/tdlinkD bash hooks/tests/dispatch-author.test.sh`.

Do:
1. Diagnose: find where a path derived from TMPDIR (or the test's TEST_TMP) is compared, without resolving symlinks on one side, against a path resolved with `pwd -P`/realpath on the other (candidates: `scripts/dispatch-author.sh` REPO_ROOT normalization, `scripts/lib/main-checkout-boundary.sh`, cleanroom/containment checks, the agy containment `scripts/lib/agy-containment.js`, or the test harness itself in `hooks/tests/lib.sh`). Report the exact cause with path:line.
2. Decide product vs test: if the product refuses a legitimate symlinked TMPDIR (a real user can have one), fix the product by normalizing both sides consistently — never by loosening a containment/boundary check (a path genuinely outside the allowed root must still be refused; add a negative control proving it). If only the test fixture assumes an unresolved path, fix the fixture.
3. RED-first regression: a case (in the existing suite or a new small suite) that runs the affected path with a symlinked TMPDIR. Then the full `dispatch-author.test.sh` must pass under TMPDIR=/tmp AND under a symlinked TMPDIR AND under a non-/tmp real dir.
Commit message: `fix(dispatch-author): a symlinked TMPDIR no longer breaks <what you found>`

Addendum (depth-0, after the full repro finished): a non-/tmp REAL directory (`/home/cookys/.cache/tdprobe`) passes 144/144. Only the symlinked shape fails. So the cause is symlink resolution, not the /tmp prefix.
