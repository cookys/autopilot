# Leak guard and redactor

Keeps personal data out of tracked files. Two scripts share one pattern engine.

| Piece | File |
|---|---|
| Pattern engine | `scripts/lib/personal-data-patterns.js` (host list: `scripts/lib/leak-guard-hosts.json`) |
| Gate | `scripts/leak-guard.js` |
| Per-file exemptions | `scripts/leak-guard-registry.json` |
| Redactor | `scripts/redact-personal.js` over `scripts/lib/personal-data-redact.js` |
| Tests | `hooks/tests/leak-guard.test.sh` |

## What counts

- Home paths under `/home` or `/Users` (the user name must not start with a dot), including the flattened Claude Code project-dir form `-home-<user>-`; `/tmp/claude-<digits>`; `/run/user/<digits>`.
- E-mail addresses, except `noreply@anthropic.com` and any address at `example.com`, `example.org` or `example.net` (a list, not any noreply). A git author identity that must stay is registered per file.
- Host names: the local hostname and the fleet list. Ordinary words (`pico`, `cuda`, `gentoo`) count only in a host context: `@name`, `ssh name`, `name:` not followed by a digit, a `/name/` path segment not under `local|opt|lib|usr|share`, `name.local`, `cookys-name`. A hyphenated token that contains a strong name is replaced whole (a `cookys-` prefix plus a fleet name becomes `<host>`). Lowercase only, so the GPU word never matches.
- Private IPv4: 10/8, 172.16/12, 192.168/16, 100.64/10.
- Credential shapes: the prefixes of `hooks/_shared/secret-patterns.js` (reused, not copied).
- A file named `.env` or `*.env`.

There is no benign-list. A false positive gets a per-file registry entry.

## The gate

`node scripts/leak-guard.js --staged` (pre-commit, step 1c) or `--range A..B` (CI, `.github/workflows/checks.yml`). Only lines a change adds are read, with rename detection, so history and pure moves are never re-judged. The diff filter is `ACMRT`: a typechange (a symlink swapped for a regular file) is scanned too. Exit 0 clean, 1 findings, 2 for a usage or git error or a bad registry. There is no warn mode.

On a block it prints `file:line  [category]  value` for every hit and one runnable `redact-personal.js` command covering all blocked files. The command uses absolute paths, so it runs as printed from any directory.

### Reverting a redaction commit

Restoring cleaned data adds it back, so a plain `git revert` of a redaction commit is blocked in `--range` mode. The deliberate path: the revert commit message keeps git's own `This reverts commit <sha>.` line and also carries the trailer `Leak-Guard-Allow-Revert: <sha>` naming the same commit (add it with `git interpret-trailers`). Only lines the reverted commit removed may return, file and text identical; any other personal line the revert adds is still blocked. The rules are strict: the trailer must sit in the final trailer block of the message (parsed with `git interpret-trailers --parse`, so a trailer-looking line followed by another paragraph does not count); `This reverts commit <sha>.` needs its full stop, which `git revert` always writes; removed lines are matched under the reverted commit's old path (`---` side), so a redaction that also renamed the file is allowed back under the old name but the same line in any other file is blocked; and a line may return no more times than the reverted commit removed it. The allowance is bound to the revert commit itself: when any commit in the range carries a valid revert trailer, the range is scanned commit by commit and only that commit may spend its allowance, so a later commit that re-adds the same line is blocked (a range with no revert trailer is scanned as one diff, as before). The range has one shared ledger keyed by (reverted sha, file, text), counted by how often that commit removed the line; every revert commit naming the same cleanup spends from the same entry, so a second trailer for the same cleanup gets nothing. In the per-commit scan a merge commit is scanned on what it introduces itself (`git show --cc`, only lines new against every parent; side-branch commits are scanned as their own commits) and never receives an allowance, whatever its message says. Trade-off: in a range that carries a revert trailer, a commit that adds personal data and a later commit that deletes it is still blocked, because each commit is judged on its own diff (a range with no trailer is judged on the net diff, as before). A missing trailer, a trailer naming another commit, or a trailer with no `This reverts` line allows nothing. `--staged` has no such path (`git revert` runs no pre-commit hook).

### Local host name

`os.hostname()` joins the strong list only when it is distinctive (it has a digit, hyphen or underscore). A plain-word name would block every added use of that word, so it counts only in the host contexts listed above. Trade-off: a bare mention of such a machine name, outside those contexts, is not caught.

## The registry

`scripts/leak-guard-registry.json`: `{"version":1,"entries":[{"path","category","reason"}]}`. One full repo path and one category per entry, with a reason. A glob, a directory, an unknown category or a missing reason makes the registry invalid. A missing or invalid registry fails the gate. The registry holds only files that are edited and must keep a hit (guard tests and docs, `endpoints.env.example` and mirrors). Frozen history needs no entry because it is never an added line.

## The redactor

`node scripts/redact-personal.js [--check | --dry-run] FILE...` rewrites hits to `$HOME` (flattened form `-home-<user>-`), `/tmp/claude-<uid>`, `/run/user/<uid>`, `<email>`, `<host>` (two or more distinct hosts on one line become `<host-a>`, `<host-b>` ... `<host-z>`, `<host-aa>`, `<host-ab>` ... in order of appearance, a repeat reuses its label), `<private-ip>`, `<redacted-secret>` through a tmp file and a rename. `--check` exits 1 on any hit and writes nothing. Binary files are skipped. Not wired to an evidence writer yet.

## Negative controls (all in the test)

Evidence-directory file with a home path is red; directory and glob registry entries are refused; missing or broken registry is red; planted home path, synthetic key and new `.env` are red; a pure rename of a file with a legacy hit is green; the redactor test goes red when replacement is switched off.
