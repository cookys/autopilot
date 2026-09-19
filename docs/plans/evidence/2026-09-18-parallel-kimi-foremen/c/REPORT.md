# REPORT — run par2-c, unit `secretscan-c` (repair `secretscan-c-r2`)

## Verdict-relevant artifacts (from git, not self-report)

- Hand branch 1: `hands/par2-c/secretscan-c` @ `2e7eaf37d3fed3c7fee4668dbfec02d888f5f282` (1 commit, cursor/cursor-grok-4.6-low, wall 186s, exit 0)
- Repair branch: `hands/par2-c/secretscan-c-r2` @ `3c79b26facfaf18aa7d4b0d089dca1fa0406c802` (1 commit on top of r1, wall 118s, exit 0)
- `git diff --stat dec4a01b..hands/par2-c/secretscan-c-r2`:
  ```
  hooks/tests/secret-scan-diff.test.sh               |  69 +++++++++
  platforms/codex/plugin/scripts/secret-scan-diff.js | 160 ++++++++++++++-------
  scripts/secret-scan-diff.js                        | 160 ++++++++++++++-------
  3 files changed, 279 insertions(+), 110 deletions(-)
  ```
  Only the three allowed files touched; nothing created. Codex mirror included in both commits via the sync script.

## Reviews (dispatch-review.sh, claude-native/claude-fable-5-1, effort high)

- Round 1 (`secretscan-c.review.json`): **FIX-THEN-SHIP**
  - 🟠 quoted-paths-skipped — ACCEPTED as real: `core.quotePath` C-quoting made the per-file diff match nothing → silent skip with exit 0, violating "never silently skipped". Fixed in r2 with `-z` + NUL split + `--literal-pathspecs`.
  - 🟡 files-standalone-mode — ACCEPTED as real: bare `--files` was silently changed from worktree-vs-index to `--cached`. Fixed in r2 (`mode = 'files'` only when no explicit range).
  - 🔵 name-only-default-buffer — accepted as trivial hardening; fixed in r2 (large maxBuffer on the name-only call too).
  - 🔵 rename-pathspec-widens — refuted as defect (strictly more conservative scanning); not fixed, per reviewer's own CUT recommendation.
  - 🔵 no-verify-evidence — process note; foreman re-ran the verify commands itself (below).
- Round 2, delta r1→r2 (`secretscan-c-r2.review.json`): **SHIP-AS-IS**. Reviewer's no-finding proof confirms both MUST-FIX remediated exactly as prescribed, mirror blob hashes identical (sync clean), new test assertions added with none weakened. One residual 🔵 (user-supplied `--files` globs in name-only) is intentional caller semantics, out of scope.

## Verify (re-run by foreman in hand worktree `/tmp/hetero-hands-par2-c-secretscan-c-r2-Whwx6g` @ 3c79b26f)

- `bash hooks/tests/secret-scan-diff.test.sh` → `PASS [secret-scan-diff] 15 assertions`, exit 0 (was 6 assertions at base; RED-first comments recorded by the hand)
- `node scripts/secret-scan-diff.js --range 6a414c3c..HEAD` → **exit 1** (not 2): the release range is now scanned; findings are the planted `AKIA…`/`sk-a…` keys in the new test file itself. `test $? -ne 2` → OK
- `node scripts/check-js-syntax.js` → `✓ 666 tracked .js/.cjs/.mjs file(s) parse cleanly`, exit 0
- `bash scripts/sync-codex-plugin-skills.sh --check` → `Codex plugin payload in sync`, exit 0

## Correction for depth 0 (brief-mandated)

The BACKLOG row's "exit code stays 0" is wrong as measured 2026-09-18: at base, `node scripts/secret-scan-diff.js --range 6a414c3c..HEAD` exits **2** with `git diff error: spawnSync git ENOBUFS`; the exit-0 observation came from a pipeline that ate the status. The row text is depth-0's to fix.

## Not done

- Nothing. Plan steps 1–3 (RED → GREEN per-file streaming → mirror sync + verify + one commit) all landed; acceptance met: a release-sized range is scanned, exit codes (0/1/2) and JSON shape `{ findings }` unchanged, one repair round used of the one allowed.
