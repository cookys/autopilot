# P1W row PHASE-TASK — the phase cell falls back to the task in progress (owner 2026-10-05, plan R5.8)

Read `w-common.md`, the WATCH-A report (`src/status/phase-input.js`, `planned-input.js`), the W1de report (`autopilot.session-tasks/1`), and `scripts/render-review-page.js` `buildPhase`. Base: `w/int4` (head named in the dispatch message). Worktree `$P/wt-phasetask`, branch `w/phasetask`.

Why: the dev-flow skill-text phase writer scored 0/10 in eval; the owner chose to show the in-progress task instead of asking the model to write a phase.

## Change
- Phase precedence becomes: campaign live phase > valid campaign receipt phase > marker `phase` (manual `set --phase`) > **the session task in progress** > first open deliverable > `—`.
- "Task in progress": from the scope's session tasks (same session/root filter as `planned-input.js`), the task with status `in_progress`; several → the most recently updated; none in progress → skip this source. Phase object `{code: <task id>, label: "做：<subject>", source: "task"}`; subject trimmed to 40 chars with an ellipsis.
- The watcher signature already includes the tasks digest (WATCH-A planned); confirm a status change re-renders. The mod shows the phase from model.json; touch `mods/live` only if a test proves it mislabels `source: "task"`.
- `references/review-page.md` "Job phase" section: add the new source in order (renderer contract text). Do NOT edit any SKILL.md.

## Tests (RED-first, mutations)
In-progress task shown; marker phase beats it; campaign phase beats both; none in progress → falls to deliverable/`—`; two in progress → newest; another session's/root's task never used; long subject trimmed; tick-level test that marking a task in_progress republishes model.json with the new phase. Consumers: render-review-page, runs-watch*, runs-watch-inputs, mod wrapper run, L1, codex sync. Isolation as usual (/dev/shm; real runs/ unchanged).
One commit `feat(status): the phase cell falls back to the task in progress (mods P1W PHASE-TASK)`. Report `$P/run-w/phasetask/REPORT.md`.
