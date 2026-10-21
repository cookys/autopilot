# Pre-existing reds recorded 2026-10-22

Five suites are red on develop at base `3224af2b0`. They were not caused by the conc, unc275, or concfix merges. Re-ran on `14ef4aa39` with identical results. No code or test was changed by this record. Facts below are the investigation evidence only.

## Three engine-qualify impl suites (test environment)

Suites: `scripts/engine-qualify-impl-hardening.test.js`, `scripts/engine-qualify-impl.test.js`, `scripts/engine-qualify-truncated-locked.test.js`.

Cause: run under a temporary HOME with no git user.name / user.email, the fake dispatcher inside these tests cannot make its git commit. Confirmed by running git commit in a fresh repo under an empty HOME: "Author identity unknown / *** Please tell me who you are." The fake dispatcher then answers status no_op with commit null, the grader classifies 20 of 24 cases as contract_violation (only the 4 no-op-family cases pass), so the row is status failed with corpus_pass 4/24. With a temp HOME that contains a .gitconfig with a user name and email, all three suites pass (hardening: 12 pass, 0 fail; the other two exit 0). The suites do not set a git identity themselves (no GIT_AUTHOR_* env), so they pass only on a machine whose real HOME has a git identity. No commit is to blame; the suites have never set their own identity (not bisected; not needed for an environment cause).

First red: environment, no commit.

Failure messages (verbatim):

- engine-qualify-impl-hardening.test.js: test "consumer matrix (b)-(f) on the emitted implementer row" fails at scripts/engine-qualify-impl-hardening.test.js:517 with "Expected values to be strictly equal: + actual 'failed' - expected 'qualified'" (11 pass, 1 fail).
- engine-qualify-impl.test.js: "AssertionError [ERR_ASSERTION]: honest candidate qualifies / false !== true" at engine-qualify-impl.test.js:26 via line 188.
- engine-qualify-truncated-locked.test.js: "AssertionError [ERR_ASSERTION]: implementer truncated undecided sitting is no_verdict / + actual 'failed' - expected 'no_verdict'" at engine-qualify-truncated-locked.test.js:38 via line 300.

Suggested fix direction (proposal, not done): make the suites export GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL / GIT_COMMITTER_NAME / GIT_COMMITTER_EMAIL for the fake dispatcher, so they no longer depend on the host gitconfig.

## qualification-review-provider (test is stale)

Suite: `scripts/qualification-review-provider.test.js`.

Cause: commit `02b8e804a` (2026-10-18, "Check the served model in the claude qualification transport (BL-0052)") made `scripts/qualification-review-provider.js` run claude with `--output-format json` and require a JSON envelope (a string result and a non-empty modelUsage naming the declared model); verifyClaudeRuntimeIdentity throws otherwise. That commit did not touch the test. The test's stub claude (stub-claude in the test file) still prints the raw reviewer text, and the test has no modelUsage or envelope handling for the claude kind. Bisected: the suite passes at `02b8e804a^` and fails at `02b8e804a`, run in a detached worktree with a HOME that has a git identity. So it is a real test defect (not environment) and has been red since 2026-10-18.

First red: `02b8e804a`.

Failure message (verbatim): "AssertionError [ERR_ASSERTION]: claude reviewer run succeeds (stderr: model call failed: claude CLI identity unverifiable: JSON envelope has no string `result`" with "1 !== 0", raised at scripts/qualification-review-provider.test.js:99 via line 470 (section 5, claude CLI reviewer happy path). Section 5 and the claude sections after it need the stub to print the envelope.

Suggested fix direction (proposal, not done): make stub-claude emit a JSON envelope with result and modelUsage keyed by the declared model.

## codex-mirror-require-closure (test scanner defect)

Suite: `hooks/tests/codex-mirror-require-closure.test.sh`.

Cause: the scanner regex in that test matches every text of the form require('./x') in a mirrored file, including comments. The mirrored file `platforms/codex/plugin/src/status/sources-manifest.js` carries comment text (its comment lines mentioning require('./<file>'), require('./awaiting-owner') and require('./awaiting-owner.js')) that is not real code; the real require calls in that file are the fs/os/path ones and the one for ../../scripts/lib/config-path, which resolves. The scanner reports the three comment texts as unresolved: "./<file>", "./awaiting-owner", "./awaiting-owner.js" — the same list in the mirror and in the source tree. They are comments only, so this is a false positive, not a missing file.

When it turned red: the test was added in `ea97fd4eb` (2026-10-17) and PASSED there (3 assertions), although the comments already existed. Bisected over the range `ea97fd4eb..3224af2b0` (git bisect run, 504 commits): the first bad commit is `6dcb90122` (2026-10-20, "dispatch-hetero(grok): edits on hands/hderive/5"), which made `scripts/lib/headless-seat-derive.js` (reached from engine-qualify.js) require ./stage-write; stage-write.js lazily requires ../session-mode, which pulls in src/status modules, putting sources-manifest.js inside the set of files the test scans. The exact middle hops between src/status/project-key and src/status/watch-inputs.js were not traced one by one.

First red: `6dcb90122` (regression from a later commit; scanner defect).

Failure message (verbatim): "FAIL [codex-mirror-require-closure] every relative require in the codex mirror resolves inside the mirror: expected exit 0, got 1".

Suggested fix direction (proposal, not done): strip block and line comments before matching, as sources-manifest.js's own hostsOf does.
