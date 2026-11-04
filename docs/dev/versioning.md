# Versioning and release numbering

Moved out of the root `CLAUDE.md` (BL-0383) so it is read on demand. Root `CLAUDE.md` keeps the one-line rule: bump with `scripts/sync-version.js` only; the version is frozen at 3.0.0 until the operator confirms a release.

## Versioning (semver bump rule)

The version (canonical in `.claude-plugin/plugin.json`, mirrored by `scripts/sync-version.js`) follows a **user-facing-milestone** semver policy. The second digit advances ONLY for a new user-facing surface — not for every addition.

| Bump | When | Examples |
|------|------|----------|
| **MAJOR** (`X.0.0`) | Breaking / incompatible change to a surface consumers rely on | Removed or renamed skill; a skill `description:` change that shifts routing incompatibly; config-schema break; removed hook/script a consumer depends on |
| **MINOR** (`x.Y.0`) | A **new user-facing milestone**: a new **skill**, a new **agent**, or a new **mod surface** | New `skills/<name>/` skill; new `agents/<role>.md` methodology agent; new mod surface (first module under `mods/`) |
| **PATCH** (`x.y.Z`) | **Everything else that changes shipped code**: new **script**, new **hook**, new **reference doc**, a bug fix or hardening of existing behavior (**including fixes to release tooling like `sync-version.js`**), a regex/contract tweak | `check-dispatch-suppression.sh` (new script) → patch; re-enabling a hook → patch; a reviewer-prompt fix → patch |
| **(no bump)** | Changes touching **only docs or tests** — no shipped code behavior changes. Fold into the next release | Adding a `hooks/tests/*.test.sh`; a `project/backlog/BACKLOG.md` / `docs/projects/` edit; a typo/wording fix in a doc |

Rationale: a new script/hook/reference is real work but it is **not** a new user-facing capability the way a skill or agent is — bundling those under PATCH keeps the second digit meaningful as a "new thing users invoke" counter. The PATCH-vs-no-bump line is **code vs not-code**: if the change alters the behavior of any shipped code, it's at least a PATCH; reserve no-bump for changes that touch only docs or tests. (Borderline: a commit that is mostly tests plus a trivial incidental code touch may ride as no-bump if the code touch isn't itself the point; when the code fix *is* the point, it's a PATCH.)

Mechanics: bump via `scripts/sync-version.js --version <V> --hook-count <N> --skill-count <M>` (opt-in/disabled counts are preserved from canonical when omitted). A version bump triggers the finish-flow Release hygiene row release gate (`scripts/preflight-release.sh`, with `--with-slash-probe` at the actual release only: CHANGELOG entry + INDEX row + mirror parity).

**Concurrent-session PATCH collisions**: two sessions working this repo in parallel occasionally pick
the same next PATCH number — version-mirror files with identical values merge silently with no git
conflict, so nothing warns you. Before pushing a version bump, check `git show
origin/develop:.claude-plugin/plugin.json` for the real canonical version. Convention (established
both directions, 2026-08-21): **whoever pushes to `origin` second yields the number** — rebase onto
`origin/develop`; a CHANGELOG collision resolves as two sections (own section moves to the new number,
on top); re-run `sync-version.js` with the freed number; re-stamp every reference to the old number in
files YOU changed (CHANGELOG heading, INDEX row, plan/README status lines, in-code `(vX.Y.Z)`
comments, test-file headers, and your branch name if it embeds the version). Grep for stragglers only
within your own changed files — another session's already-shipped old-number references are history,
not drift.
