# Repair hand brief — unit `secretscan-c-r2`

You are the repair hand. Work on the branch you are on (hands/par2-c/secretscan-c-r2), based on the head of
hands/par2-c/secretscan-c (2e7eaf37d3fed3c7fee4668dbfec02d888f5f282). Fix the two MUST-FIX review findings below,
verbatim from the reviewer; do not change anything else. Keep all existing behavior and tests passing.

## Findings to fix (verbatim)

🟠 [quoted-paths-skipped] MUST-FIX `git diff --name-only` honours core.quotePath (default true), so any path with non-ASCII bytes, spaces-with-quotes, or control chars is emitted C-quoted (e.g. `"\321\201onfig.txt"`); the per-file call then runs `git diff -U0 ... -- "\321\201onfig.txt"`, which matches nothing, returns status 0 with empty stdout, and the file is silently skipped with exit 0 — exactly the "never silently skipped" case the spec forbids, and a secret in such a file is missed. Paths containing `*`, `?`, `[` are likewise treated as pathspec globs (`a[b].txt` does not match itself). Smallest remediation: add `-z` to the name-only args and split on `'\0'` instead of `'\n'` (drop the `\r` strip), and prefix the per-file invocation with the global `--literal-pathspecs` (i.e. `spawnSync('git', ['--literal-pathspecs', ...fileArgs])`) so each listed path is matched verbatim. Apply in `scripts/secret-scan-diff.js` and re-sync the codex mirror.

🟡 [files-standalone-mode] MUST-FIX Removing `mode = 'files'` changes standalone `--files <paths>` (no `--range`) from `git diff -- paths` (worktree vs index) to `git diff --cached -- paths` (index vs HEAD); a caller scanning unstaged edits now gets an empty diff and exit 0. Spec says keep `--files` semantics; the intended fix is only that `--files` must not discard an explicit range. Smallest remediation: in the arg parser set `if (mode !== 'range') mode = 'files';` and leave `gitBaseArgs` pushing nothing for `mode === 'files'` (both name-only and per-file calls), so range+files combines and bare `--files` keeps its worktree behaviour; existing test (3) still passes.

🔵 [name-only-default-buffer] FOLLOW-UP (fix if trivial): pass the same large maxBuffer to the name-only call too.

## Allowed files
`scripts/secret-scan-diff.js` (+ its codex twin `platforms/codex/plugin/scripts/secret-scan-diff.js` via the sync
script only), `hooks/tests/secret-scan-diff.test.sh`. Nothing else; nothing created. You may add test assertions for
the two fixed behaviors (a non-ASCII/quoted path case; bare `--files` unstaged-edit case) — never weaken an existing
assertion.

## Verify (foreground, all exit 0, before committing)
```
bash hooks/tests/secret-scan-diff.test.sh
node scripts/secret-scan-diff.js --range 6a414c3c..HEAD ; test $? -ne 2
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
```

## Execution rules
Commit ONE commit on the branch you are on; do not touch other files; do not run sync scripts on
the codex mirror by hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the mirror in
the same commit; run every verify command in the foreground before committing and record the output tails in your
final message.
