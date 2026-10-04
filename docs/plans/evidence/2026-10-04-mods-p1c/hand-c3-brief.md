Engine: sonnet

# Hand — row C3: redesign the `live` band around "what a returning human needs" (owner decision 2026-10-04, option B)

OLD=/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad
Worktree: $OLD/p1c/wt-c (branch p1c/c, HEAD 2279e6d0 = C1+C2, clean). Do NOT use the main checkout. Foreground long commands (Bash timeout 600000); prefix with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`, suffix `< /dev/null`. Author user.name cookys, user.email 2537196+cookys@users.noreply.github.com. Never --no-verify. No push, no version bump, no CHANGELOG/INDEX, do not edit the plan.

Read first: $OLD/p1c/run/hand-common.md, $OLD/p1c/run/hand-c.md (C2 spec, still binding for everything this brief does not change), $OLD/p1c/run/c2.REPORT.md.
The job-model source of truth is the P1b renderer, NOT in this worktree: $OLD/p1b/land/scripts/render-review-page.js (function building the `review-job-model/1` object around lines 150-200) and its tests/fixtures; read it, do not copy it. The mod reads `<autopilot_home>/review/<key>/<date>/<job>/current/model.json` (C2 already does, see mods/live/model.ts readJobModel).

## Owner's request (verbatim intent)
The band must show, at a glance, for a person who left the computer: which PROJECT, which PHASE, how long it has RUN, and PROGRESS %. First word = a verdict. Cost and context move to the pane. If something awaits the human's decision, that must be the loudest thing.

## Product — band
One band entry, two lines (line 2 may be omitted when there is nothing to say):
  line 1: `<mark> <verdict> <project> · <phase> · <elapsed> · <progress>`
  line 2: one short reason sentence (zh-TW; why this verdict)
Verdict words (exactly these four; `mark` is a single leading glyph chosen per verdict, e.g. ▲ ● ⏸ ✓): 
  1. `要你決定`   — job model `needs_decision === true`. Highest priority; wins over everything.
  2. `疑似卡住`   — use the stalled notion C2 already derives from the envelope (do not invent a new threshold).
  3. `完成待驗收` — no confirmed-live runs, progress frozen with done === total, and acceptance axis not yet accepted/rejected.
  4. `進行中`     — otherwise, when confirmed_live > 0.
  Precedence is the numeric order above. Existing non-data states (`no pointer`, `no project`, `stale`, `unavailable · run: …`, `unreadable`) keep their C2 wording and behavior; they replace the whole entry.
Fields:
  - project: short name from `scope.repo_identity` (strip the `git-common-dir:` prefix, drop a trailing `/.git`, take the last path segment; for a bare repo or odd shape fall back to the first 8 hex of project_key). Never run git, never compute hashes in the mod.
  - phase: the human phase from the job model ONLY if the model carries one (check the P1b model fields; if none exists, show `—`). NEVER use the process phase (`running`/`exited`) as a phase. If the model has no human phase field, implement the `—` path, say so in the report, and do not invent a source.
  - elapsed: now minus the earliest `started_at` among the scope's runs (or the model's dispatch rows if that is what P1b exposes); `—` if absent. Format `38m`, `2h14m`, `1d3h`.
  - progress: from model `progress` (the P1b model: `frozen`, `percent`, `done`, `total`). Frozen: `62%（5/8）`. NOT frozen: `3 done*` — the count, an asterisk, and a dim/muted style (use the element table's available dim/color prop; if none, asterisk alone). A percent is NEVER shown without a frozen denominator; no model → `—`. Never 0 for unknown.
  - two axes never mix: execution (running/exited) is not progress; progress never comes from run counts.
Reason line examples (your wording may differ, keep them short and factual, built only from fields): needs_decision → the model's one-line `conclusion` or decision summary; stalled → `最久的派工 <n>m 沒有輸出`; waiting acceptance → `驗收結論尚未出`; running → `<n> 個派工在跑`.

## Product — pane
- Header row now carries what left the band: session cost / host cost / context % (same sources and `—` rules as C2).
- If `needs_decision`, the FIRST section of the pane lists what is awaited, built from the model's `decision` object (read its real shape from the P1b renderer; show the question/title and the available options only if those fields exist). Keep the Link to the job page.
- Keep C2's execution-status table, gate rows and the "execution status, not progress" label.
- Do NOT add anything about proxy decisions ("代你決定") — that is row C4, out of scope here.

## Tests (RED-first, mutation-proven)
Extend mods/live/live.test.ts. Cases at minimum: each verdict word and the precedence order (needs_decision beats stalled beats waiting-acceptance beats running); frozen progress with %; unfrozen progress shows `n done*` and contains no `%`; no model → `—` and not 0; phase falls back to `—` and never equals `running`/`exited`; project name derivation (normal path, linked-worktree style identity, odd shape fallback); elapsed formatting; cost/ctx appear in the pane header and NOT in line 1; needs_decision section is first in the pane. Record the RED run (before implementation) in the test header and run mutation controls: delete/alter each of the guarded behaviours above and show the suite goes red (save outputs under $OLD/p1c/c3/mut-*.txt, as C2 did in $OLD/p1c/c2).
Consumer sweep: `claude plugin test` on the throwaway wrapper (see references/mods.md "Loading it before it is wired"), `claude plugin validate`, tsc, the negative grep (`prompt.submit|asUser|process.spawn|process.run` → empty), `bash scripts/sync-codex-plugin-skills.sh` then `--check`, `node scripts/check-js-syntax.js`, `hooks/tests/session-mode-watcher.test.sh`, and the L1 layer (`node --test hooks/*.test.js scripts/*.test.js scripts/lib/*.test.js`; the ONLY accepted red is the 22 pre-existing failures in scripts/import-aa-capabilities.test.js — verify the failing set is exactly that file).

## Docs
Update references/mods.md ("The live mod" section: new band contract, verdict precedence, the unfrozen `*` rule, the project/phase/elapsed sources, what moved to the pane) and its codex mirror in lock-step. Add a short evidence note under docs/plans/evidence/2026-10-03-mods-spikes/ (S9-band-redesign.md) with a captured band rendering for each of the four verdicts from the test kit (text only). Allowed files: mods/live/**, references/mods.md, platforms/codex/plugin/references/mods.md, that evidence dir.

## Commit and report
ONE commit: `feat(mods): live band answers project, phase, elapsed and progress with a verdict word (mods P1c C3)`, body ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. If a protected path blocks the commit, STOP and report.
Write $OLD/p1c/run/c3.REPORT.md: item-by-item evidence for every bullet above (command + result), commit SHA, `git diff --stat 2279e6d0..HEAD`, which model fields you found for phase / decision / progress, anything NOT done.
