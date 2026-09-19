# Hand brief — unit `secretscan-c`

You are the implementation hand. Work on the branch you are on (hands/par2-c/secretscan-c), at base dec4a01b423e9749a1f9a84a4a4f8c316f2e56b6.

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

## Execution rules
Commit ONE commit on the branch you are on; do not touch other files; do not run sync scripts on
the codex mirror by hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the mirror in
the same commit; run every verify command in the foreground before committing.
