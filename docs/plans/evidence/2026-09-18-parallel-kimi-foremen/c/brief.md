# Brief C — unit name for this run: `secretscan-c` (repair: `secretscan-c-r2`)

# Brief C — `secret-scan-diff.js` must scan a large range instead of dying on ENOBUFS

BACKLOG row: "`secret-scan-diff.js --range` fails OPEN on a large range — ENOBUFS is printed and the exit code stays 0".
Depth-0 re-measured 2026-09-18 on this repo: `node scripts/secret-scan-diff.js --range 6a414c3c..HEAD` prints
`git diff error: spawnSync git ENOBUFS` and exits **2** (the row's "exit 0" was observed through a pipeline that ate the
status; record that correction in your report — the row text is depth-0's to fix, not yours). The real defect stands:
`spawnSync('git', diffArgs, { encoding: 'utf8', timeout: 10000 })` (~:52) has Node's default 1 MiB `maxBuffer`, so any
diff over 1 MiB is never scanned at all — a scanner that cannot read its input is useless on exactly the pushes that
need it (a release range).

## Product
1. Stream, do not buffer: replace the single `spawnSync` with a per-file loop that keeps memory bounded and never
   hits `maxBuffer`: first `git diff --name-only --diff-filter=ACMR <range|--cached> [-- files]` (small), then for each
   path `git diff -U0 --diff-filter=ACMR <range|--cached> -- <path>` with `maxBuffer: 256 * 1024 * 1024`; feed each
   file's hunks through the SAME line scanner (factor the existing loop into a function `scanDiffText(text, findings)`
   so the detection rules are byte-identical). A per-file diff that STILL overflows (a >256 MiB single file) is
   reported as a finding-class error: exit 2 with `secret-scan-diff: <path>: diff too large to scan` on stderr — never
   silently skipped, never exit 0. Keep `--files` semantics (explicit paths restrict the name-only list).
2. Keep every exit code: 0 clean, 1 findings, 2 cannot scan. Keep the JSON shape `{ findings }`. Keep the 10 s timeout
   PER git call. Keep the `--range` argument validation and the usage text.
3. Note in the header comment: "per-file streaming (2026-09-18): a 1 MiB spawnSync buffer made release ranges
   unscannable".

## Tests (RED-first: run each new case against the unmodified script first, record the exact observed output in a
`# RED at <base sha>: …` comment beside the assertion; never weaken an existing assertion)
- `hooks/tests/secret-scan-diff.test.sh` (currently 6 assertions): (1) a fixture repo whose range adds one 3 MiB
  text file with NO secret plus one small file WITH a planted `AKIA…`-style key → exit 1 and the finding names the
  small file (RED at base: exit 2, `ENOBUFS`); (2) the same range with no secret → exit 0 and `findings: []`; (3)
  `--files` restricting to the clean file → exit 0; (4) the existing invalid-range case still exits 2. Build the
  3 MiB file with `head -c 3145728 /dev/zero | tr '\0' 'a'` plus newlines every 100 chars (`fold -w 100`) so it is
  many lines, not one.

## Verify (foreground, all exit 0)
```
bash hooks/tests/secret-scan-diff.test.sh
node scripts/secret-scan-diff.js --range 6a414c3c..HEAD ; test $? -ne 2   # must not be "cannot scan" any more
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
```

## Allowed files
`scripts/secret-scan-diff.js` (+ its codex twin `platforms/codex/plugin/scripts/secret-scan-diff.js` via the sync
script only), `hooks/tests/secret-scan-diff.test.sh`. Nothing else; nothing created.

## How you work (foreman rules — identical for every run)
- You ORCHESTRATE. You never edit code yourself, never merge, never push, never checkout. All product work is done by
  ONE hand you dispatch; you verify by git artifacts (`git -C <wt> diff --stat`, the hand's result JSON), never by its
  self-report. Depth 0 (the dispatcher) reaches the verdict from git after you finish.
- Hand dispatch (exact form; <unit> is the unit name given at the top of this brief — globally unique, the dispatch
  run manifests live in one shared directory; keep every other flag):
  `<rail>/dispatch-hetero.sh --branch hands/<run_id>/<unit> --base <base_sha> --ledger <run_dir>/hands.ledger --run-id <unit> --stage implement --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m --prompt-file <run_dir>/hand-<unit>.md`
  Write `<run_dir>/hand-<unit>.md` first: paste the "Product", "Tests", "Verify" and "Allowed files" sections below
  VERBATIM plus: "Commit ONE commit on the branch you are on; do not touch other files; do not run sync scripts on
  the codex mirror by hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the mirror in
  the same commit; run every verify command in the foreground before committing."
  Then wait: `node <rail>/wait-dispatch-results.js --ledger <run_dir>/hands.ledger --expect <unit>.implement`
  (never a shell sleep loop).
- Review (decorrelated family, required before you report done): produce the diff with
  `git -C <your worktree> diff <base_sha>..hands/<run_id>/<unit> > <run_dir>/<unit>.diff` and run
  `<rail>/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file <run_dir>/<unit>.diff --spec-file <run_dir>/hand-<unit>.md > <run_dir>/<unit>.review.json`.
  If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings you judge real, dispatch ONE repair hand on branch
  `hands/<run_id>/<unit>-r2` with `--base <head of hands/<run_id>/<unit>>` and a prompt listing the findings verbatim;
  re-review the delta. At most one repair round; then report.
- Budget: 40 Bash calls. Plan them: write prompt (1), dispatch (1), wait (1), diff/stat (2), review (1), read verdict
  (1), optional repair (4), report (1). Do NOT read large files into your context; use `head`/`grep -n`.
- REPORT.md must name: hand branch(es) and head sha(s), `diff --stat` vs base, the review verdict and the findings you
  accepted/refuted with one line why, the verify commands' tails, and anything NOT done.
