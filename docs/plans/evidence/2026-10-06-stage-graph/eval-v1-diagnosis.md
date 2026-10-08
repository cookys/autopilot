> Failure diagnosis of the stage-graph P5 change arm v1 (session report, 2026-10-06; inferred, cell transcripts were deleted).
> Diagnoses eval arm: change v1 (-sg-change).

# P5 stage-graph eval (change arm v1) — failure diagnosis

## 0. Limit of this diagnosis (read first)

The 114 cell transcripts no longer exist. `run-skill-onoff-matrix.sh` (`rm -rf "$out"` after appending `result.json`) and the cell's
`cleanup` trap in `run-skill-onoff-eval.sh` (scratch HOME, plugin dir, state dir) delete everything but the one-line row in
`results/stage-graph.jsonl`. `markers.env` is also masked by `work_done`, so the pre-mask raw judgements are gone too. Only the
scratch smoke cells `c1`/`c2` survive. So per-rep "read the transcript" was not possible. Every class below is **inferred** from
(a) the marker pattern + duration per rep, (b) the shipped guidance, (c) deterministic re-runs of `stage-graph.js` and
`probe-unknown.js classify` on the frozen fixtures (no live cells). Confidence is stated per row. The instrument should keep transcripts
in the next arm (non-scoring change; owner decision).

## 1. Two root causes reproduced deterministically

**R1 — `eligible_max` depends on which terms the agent chooses, and L/XL feature nouns are zero-hit by construction.**
`probe-unknown.js classify` gives S4 (=> `eligible_max U1`) if ANY `--terms` term has zero hits in repo/knowledge. Re-run on the fixtures:

| fixture | terms | eligible_max |
|---|---|---|
| l-u0-known | scheduler,retry,queue,delay,backoff | U0 (the key's own list) |
| l-u0-known | scheduler,retry,attempts,backoff,delay,cap | U1 (zero: cap) |
| l-u0-known | retry,exponential,backoff,jitter / the brief's flags `max-attempts,delay-ms,delay-cap-ms` | U1 |
| l-feature | storage,notes,atomic,persistence / `--storage,--file` | U1 |
| xl-deliverable | exporter,importer,activity log,rotate / ndjson,csv,... | U1 |
| research-a/b | invented nouns | U1 (key right) |

dev-flow says `--terms <key nouns from the task brief>` at `intent`. For a feature brief, the key nouns include the thing being created,
so an honest agent gets U1. The keys (`none` accepts none/U0; `U0` exact) only pass when the agent picks pre-existing nouns only, or skips
classify. And U1 routes per the SKILL table to `research`: `stage-graph.js next --from intent --size L` returns `[proposal, research]`
(legal without `--research`), so the walk becomes intent, research, proposal, plan, which is not the key's `noresearch` walk.
Rung and walk failures are the same event.

**R2 — urgent-high placement contradicts the "Choosing the next node" rule.** `stage-graph.js next --from verify --size M --urgent` returns
`[implement, qc-gate]` (no `code-review`; urgent-low unless `--high-risk`). SKILL "Stage protocol" says to choose the next node with `next`;
only the `### verify` paragraph and `references/stage-graph.md` "Urgent placement" say to blindly try `--to code-review`. An agent following
the protocol goes verify to qc-gate and misses the `M!` key (`code-review` at idx 3).

## 2. Per-rep table (change arm)

Class: G guidance, T task/key, I instrument, A agent noise. "(unv.)" = unverifiable without the transcript.

| task rep | markers false | class | evidence / confidence |
|---|---|---|---|
| m-feature 3 | walk | A (unv.; I possible) | Reps 1,2 clean (34-48 s). Candidate I: scorer drops a stage-advance whose Bash call `is_error`; c2 shows agents chain `stage-advance ... && bash run-tests.sh`, so a red test run after a successful advance erases that node (`stage-graph-cell.js:112-115`). Low |
| l-feature 2 | walk | A (unv.) | rung ok (none/U0) so no U1 detour; cause unknown (skipped/reordered node). Low |
| l-feature 3 | rung | T (R1) | walk ok, rung not none/U0 => classify called with a feature noun (zero-hit => U1). Reproduced above. Med-high |
| xl-deliverable 3 | walk | A (unv.; R1 detour possible) | rung ok, so not the U1 detour. Low |
| m-bug 1 | size, walk | G | bug flag right, size wrong, walk follows. Brief: "pricing, rounding and report code all touch this, so I don't know which of them is at fault" supports M (SKILL bug row: "cause not yet located across several modules => M"), but SKILL also says "Between XS, S and M pick the smaller one" and the anti-pattern row warns off L for 3-module bugs. Likely S. Med |
| m-bug 2 | size, bug, urgent, walk | I or A (unv.) | work true (bug fixed) but `set` never recorded as non-refused: the agent skipped session start, or its `set` chain returned is_error. Both flags false => `obs.set === null`. Low |
| m-bug 3 | walk | A (unv.; I possible) | size/bug right; same is_error caveat as m-feature 3 |
| s-urgent 1 | walk | A (unv.) | 2/3 reps pass; urgent-low walk implement, verify, qc-gate. Low |
| m-urgent-high 1 | size, walk | G | "Urgent ... Smallest possible change" (Urgent section) + "pick the smaller one" push to S; brief spans session.js + middleware + route + docs (M by the table). Walk follows. Med |
| m-urgent-high 3 | walk | G (R2) | size/urgent right, walk wrong; reproduced `next` omits code-review. Med |
| l-u0-known 1 | walk, rung | T (R1) | `--max-attempts/--delay-ms/--delay-cap-ms`, "cap", "exponential" are zero-hit => U1 => `research` detour. Brief says every noun is in tracked files; the CLI flag names it contains are not. Med-high |
| l-u0-known 2 | rung | T (R1) | same, walk survived (agent ignored the table) |
| l-u0-known 3 | walk, rung | T (R1) | as rep 1 |
| l-research-a 1 | ALL (work=false) | G (unv.) | 25 s, repo never touched (even README/plan dirt would set work). Agent stopped before writing anything |
| l-research-a 2 | walk, rung | G | work true (38 s). rung != U1 => classify not called or non-zero-hit terms; walk missed `research` (needs the U1 outcome). Ladder probe is "documented-only" |
| l-research-a 3 | ALL | G (unv.) | as rep 1 (26 s) |
| l-research-b 1 | ALL | G (unv.) | 120 s, no repo change: probably searched or reasoned, then replied in text |
| l-research-b 2 | ALL | G (unv.) | 42 s |
| l-research-b 3 | ALL | G (unv.) | 37 s |

For the 5 all-false research reps I cannot show whether the agent asked the user about the invented nouns or just wrote nothing in-repo
(plan via EnterPlanMode lands outside the repo). Both leave `work_done=false`. Evidence for "stopped early": durations 25-37 s,
and a rep 2 that continued reached `plan` in 38 s. Headless defaults exist only in `### proposal` ("Headless (-p) or CEO mode => take the
recommended option"); nothing in Session Start or `### research` says it, and `research` reads "act on `recommend`" (U1 => `dispatch-consult.sh`,
which has no seat in the cell). Instrument note: `work_done` demands repo dirt although the horizon nodes (intent..plan) are prose writes
whose artefacts can live outside the repo; this is a latent I/T defect for L/XL horizons.

## 3. Counts (19 failing reps)

G 9 (m-bug 1, m-urgent-high 1,3, research a1,a2,a3, b1,b2,b3; the last five unverified) · T 4 (l-feature 3, l-u0-known 1,2,3) ·
A/I unresolved 6 (m-feature 3, l-feature 2, xl 3, m-bug 2, m-bug 3, s-urgent 1) · I confirmed 0.

## 4. Guidance edits that fix the G cases

1. `skills/dev-flow/SKILL.md` intent "Ladder probe": define `--terms` as the **existing or external things the design depends on and you
   do not already understand** (a format, protocol, library), never the names of what you will create or the new flags; "if you can
   describe it from the repo and general knowledge, it is not a term". Add: "`U1`+ moves to `research` only when the unknown blocks the
   design; a feature name you invent is not an unknown." Fixes R1 for L/XL feature tasks (also reduces `research` detours).
2. `skills/dev-flow/SKILL.md` "Stage protocol / Choosing the next node" + `references/stage-graph.md`: for an urgent session leaving `verify`,
   say "do not use `next` here; attempt `--to code-review` (written => normal order, exit 3 => qc-gate)". Fixes R2.
3. Sizing: scope "pick the smaller one" to *size-by-diff ambiguity among XS/S/M for features*, and add: "A bug whose cause spans several
   modules and is not yet located is M; urgent never lowers the size" (urgent section "Smallest possible change" is about the diff,
   not the size flag). Fixes m-bug 1 / m-urgent-high 1.
4. Session Start (before step 1): "Headless (`-p`) / no interactive user: never stop to ask. Unknown domain nouns => `research` node with
   local means, record assumptions, continue to the next node". Mirror in `### research`. Likely fixes the research all-false reps.
5. Make Session Start step 1 (`set --size`) and step 4 (`--to <entry>`) unconditional for every size including bug (m-bug 2).

## 5. T / I issues for the owner (instrument/brief changes after seeing data; do not apply unilaterally)

- **T1 (answer key, R1):** the `none`/`U0` rung keys for L/XL feature briefs cannot be satisfied by an agent that follows the guidance and
  names feature nouns. Options: (a) keep keys, fix guidance edit 1 (preferred, no instrument change); (b) score rung only on research
  briefs and l-u0-known with a recorded term list. Per prereg any key change after data voids the row, so this is a new arm either way.
- **T2:** `l-u0-known` brief names three new CLI flags whose names are zero-hit; the key text "every noun in the brief exists in tracked
  files" is false for those tokens.
- **I1 (suspected, unconfirmed):** `stage-graph-cell.js` treats a whole Bash call's `is_error` as "refused" for every stage-advance/
  session-mode in it. Chained `advance && run-tests` with a red run drops the node; `set ... && something-that-fails` drops the size.
  Check by replaying the next arm's transcripts with per-command exit codes.
- **I2:** `work_done` AND-masking hides which markers the agent really hit for no-repo-write reps. Record raw (unmasked) judgements and keep
  `transcript.jsonl` per cell in the next arm.
- Prereg consequence: there is no rerun of v1; any of the above needs a new arm id and prereg amendment.
