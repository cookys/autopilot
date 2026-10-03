# Row R1 — manifest `repo_identity` from a shared shell function
Worktree: /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1a/wt-r1  Branch: p1a/r1  Base: 532930ed
Plan text: §4 P1a bullet "manifest 加 `repo_identity`（G1 R2）" and §3 file-map row 1. Implement exactly that.

Product: new `scripts/lib/repo-identity.sh` providing `repo_identity_of <dir>` — bit-identical to
`src/status/task-runtime.js` `repoIdentity()` (git rev-parse --path-format=absolute --git-common-dir, then `pwd -P`,
prefix `git-common-dir:`), named failure on old git (stderr one line, empty output). The dispatch rails that write a run
manifest source it and add `repo_identity` + `repo_identity_source` (precedence REPO_ROOT → CONSUMING_REPO_ROOT → null;
`git_rev_parse_failed` on failure). Premise check FIRST and report it: which of `dispatch-hetero.sh`, `dispatch-review.sh`,
`dispatch-author.sh` actually write a manifest (only dispatch-hetero.sh defines `write_manifest()`; find whether the
other two write manifests through it, through another function, or not at all). Wire every rail that writes a manifest;
for a rail that writes none, report that and do not invent one. Confirm a `write_manifest` test seam exists; if not, add
the smallest seam in the same commit. Old manifests lacking the field must not break any reader.

Tests (new, plan names): `hooks/tests/repo-identity-parity.test.sh` (4 fixtures: main worktree, symlinked path, linked
worktree via `git worktree add`, subdirectory cwd → bit-equal to Node; 5th fixture: fake `git` on PATH refusing
`--path-format` → both shell and Node null, shell stderr diagnostic) and `hooks/tests/manifest-repo-identity.test.sh`
(every manifest-writing rail writes the fields via its seam; REPO_ROOT beats CONSUMING_REPO_ROOT; `git_rev_parse_failed`
recorded; an old manifest without the field is read fine by `autopilot status runs --json`).

Allowed files: scripts/lib/repo-identity.sh (new), scripts/dispatch-hetero.sh, scripts/dispatch-review.sh,
scripts/dispatch-author.sh (only those that write manifests), their platforms/codex/plugin mirrors, the two new tests,
CLAUDE.md (add `lib/repo-identity.sh` to the "Dispatch rails" grouped name list), docs/scripts-inventory.md (one index
row, Row shape rule). You are the only row adding a shipped script: Verify includes `node scripts/check-claude-md-inventory.js`
rc 0 plus the existing dispatch-hetero / dispatch-review / dispatch-author suites (consumer sweep).
Commit message: `feat(dispatch): run manifests carry repo_identity from a shared shell function (mods P1a R1)`
