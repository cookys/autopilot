# P2.5 — recursive walkers vs `<main>/.claude/worktrees/`

Rail worktrees now live inside the main checkout. A walker rooted at a work tree that descends into
`.claude/worktrees/` reads other checkouts as if they were this one.

## Enumeration

```
grep -rnE "readdirSync|readdir\(|recursive: *true|walk\(|walkDir|globSync|\*\*/|opendirSync" scripts hooks bin src --include='*.js' --exclude='*.test.js' --exclude-dir=tests --exclude-dir=node_modules
grep -rnE "\bfind +[\"\$.]|\bgrep +-[a-zA-Z]*r|\bdu +|\bls +-R|\brg +" scripts --include='*.sh' --exclude-dir=tests
grep -rnE "'find'|\"find\"|git grep|'grep', *\['-r|execSync\(.find " scripts hooks bin src --include='*.js' --exclude='*.test.js' --exclude-dir=tests
```

`bin/` holds no walker; `hooks/lib` does not exist. The first grep returned 151 lines, triaged by file; the rows
below are every hit that recursively walks a directory, plus the near-misses read to rule them out.

## Disposition

| Site | Root | Disposition |
|---|---|---|
| `scripts/doc-drift-gate.js:100` `walk` | repo root | skips .claude/worktrees (`:42`, plus the nested-git-root rule) |
| `scripts/check-stage-vocab.js:123` `listFiles` | repo root | uses git ls-files; the fallback walk skips `.claude/worktrees/` (`:68`) |
| `scripts/identifier-scan.js:99` `walkDir` | any path argument | **fixed here (test)** — skips `.claude/worktrees` |
| `scripts/probe-unknown.js:539` `findLedgers` | `--project-dir` | **fixed here (test)** — skips `.claude/worktrees` and `node_modules` |
| `scripts/lib/worktree-activity.js:41` `newestMtime` | a worktree path | **fixed here (test)** — skips `<root>/.claude/worktrees`; a root that is itself under that path is unaffected (the skip is relative to the root) |
| `scripts/lib/main-checkout-boundary.sh:87` `find -xdev` | main checkout | **fixed here (test)** — D3, pruned in the stat walk |
| `scripts/project-detect.js:651` `sortedDirectoryChildren` | one level of a declared workspace glob base | cannot run from the main checkout into worktrees (why): not recursive; the base would have to be `.claude/worktrees` itself |
| `scripts/probe-unknown.js:304` `listMarkdown` | knowledge / memory dirs | cannot run from the main checkout (why): not a work tree |
| `scripts/repo-residue-sweep.js:301` `newestMtimeMs` | `$TMPDIR` campaign dirs | cannot run from the main checkout (why): temp root |
| `scripts/lib/kimi-containment.js:72`, `scripts/lib/agy-containment.js:183` | engine session dirs | cannot run from the main checkout (why): not a work tree |
| `scripts/next-touch-validation.js:489`, `scripts/pin-evidence-anchors.js:170`, `src/engine/profile-runtime.js:187` | state / receipt / runtime dirs | cannot run from the main checkout (why): not a work tree |
| `scripts/engine-scorecard.js:919`, `scripts/distill-scan.js:315` | transcript trees under `~` | cannot run from the main checkout (why): not a work tree |
| `scripts/validate.sh:66` | a skill subtree | cannot run from the main checkout (why): root is `skills/<name>` |
| `scripts/task-width-fleet.sh:67` | user roots, `-type d -name .git` | cannot run into worktrees (why): a linked worktree's `.git` is a file, excluded by `-type d` |
| `scripts/probe-skill-frontmatter-portability.sh:339` | a plugin target, depth ≤ 4 | cannot run from the main checkout (why): plugin dir, not a consumer work tree |
| hooks `cost-tracker:131`, `state-checkpoint:59`, `foreman-guard:420`, `session-start:423`, `session-handoff:115`, `capture-payload:71`, `transcript-reader-lib:195`; `src/status/*`, `src/engine/*` | state / run dirs | cannot run from the main checkout (why): not a work tree |
