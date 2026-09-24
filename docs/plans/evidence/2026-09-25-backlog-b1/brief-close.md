Engine: sonnet

# Closeout foreman — v2.36.96 (B1): scoped doc-sync fixes + evidence + HANDOFF (docs-only, no version bump)

Repo: `/home/cookys/projects/autopilot`, branch `develop`, HEAD `9fc56347` (clean). Nothing else runs against this checkout, so commit here.
`B=/tmp/claude-1000/-home-cookys-projects-autopilot/ee9eb17b-41da-4ab1-9beb-06049b64c5bd/scratchpad/b1`. Stay under ~40 tool calls.

## 1. Scoped doc-drift (read both sides before you claim anything)
The scope is `git diff 4c8c953a 9fc56347 -- scripts hooks src`. The changed behaviors are:
- `probe-unknown classify` memoizes a single resolver snapshot;
- codex-cli/codex canonicalization at more runner comparisons;
- consult-seat alias normalization before the qc-exclusion match in `auto` mode;
- a distinct warning when a cached topology is missing a role key (plan_review / hetero_review / consult_dispatch auto knobs);
- contract-parity tests pinned hermetically;
- a new per-role env override that redirects consult/discuss corpus paths (`scripts/lib/qualification-applicability-scope.js`).

Grep the docs for statements that these changes made false or incomplete:
- `references/`, `skills/**/SKILL.md`, `skills/**/references/`;
- `docs/scripts-inventory.md`, `project-config-template/`, `README*.md`, `hooks/README.md`.

A new env var is a surface: if it is user- or operator-settable, it needs one line where its siblings are documented. Fix real drift only, with minimal edits.
Sync the mirrors with `bash scripts/sync-codex-plugin-skills.sh`, then run `--check`.

## 2. Evidence
Create `docs/plans/evidence/2026-09-25-backlog-b1/` and copy into it:
- `$B/brief.md`, `$B/brief-land.md`, and this brief;
- `$B/run/REPORT.md` as `REPORT-foreman.md`;
- `$B/run-land/REPORT.md` as `REPORT-land.md`;
- `$B/run-land/b1.review.json` as `final-review.json`.

Grep the copies for secrets (`sk-`, `Bearer `, `API_KEY=`) and redact any hit. Then add a 10–15 line `README.md` covering:
- the shape: one sonnet foreman, 7 stacked rows, the shadow commit in the brief from the start;
- row 54's repair (a missed codex mirror sync);
- the landing gate: full suite green; `engine-qualify-verdict-stability` D6 red at base too, so pre-existing;
- the review id;
- the plan-graduation gotcha: `--fix` needs the plan's full slug inside the released CHANGELOG section.

## 3. HANDOFF + INDEX
- `docs/projects/ongoing-maintenance/HANDOFF.md`: update 現況 to HEAD = v2.36.96 and state that all six 09-21 backlog bundles have now shipped (B1 in v2.36.96). Remove the stale
  "INDEX 標 active" claim. Add the new peer-reported BACKLOG row (foreman-guard role-aware caps, `docs/backlog/foreman-guard-role-aware-caps.md`) as the next candidate
  (its trigger was "after B1 lands", so it has now fired). Keep the file's Traditional Chinese style and its section layout.
- `docs/projects/INDEX.md`: in the v2.36.96 row, replace the merge column `—` with `9fc56347`.

## 4. Gates, review, commit, push
Run `node scripts/doc-drift-gate.js .`: no new FAILs beyond the 3 known baseline ones. Also run `bash scripts/preflight-release.sh`, `node scripts/check-plan-graduation.js --repo-root . --json` (exit 0), and `bash scripts/validate.sh`.
If you touched `references/` or `skills/` (qc-protected), run a review: `git diff > $B/close.diff`, then run in the FOREGROUND (Bash timeout 1000000)
`env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file $B/close.diff --spec-file <this brief> < /dev/null > $B/close.review.json`.
If you get no verdict, retry once with "You have no tools. Answer only with the verdict JSON." added. The review must be SHIP-AS-IS; apply only doc-text fixes it names.
Make one commit: `docs(closeout): v2.36.96 — B1 evidence, doc drift, HANDOFF`. If reviewed, the final paragraph holds both trailers with no blank line between them:
`QC-Verdict: PASS (reviewer claude-fable-5-1 <run id>, 2026-09-25)` then `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Otherwise it holds only the Co-Authored-By line.
Then `git fetch origin && git rebase origin/develop && git push origin HEAD:develop` (no pipe, no --force; retry once on a 5xx). Confirm with `git ls-remote`.
Final message: each drift finding as fixed file:line or none-found per behavior; the review verdict and id; the pushed SHA.
