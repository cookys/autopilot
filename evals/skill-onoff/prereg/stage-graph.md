# Pre-registration — stage-graph guidance eval (row `stage-graph`)

Plan: `docs/plans/2026-10-06-dev-flow-stage-graph.md` §2.7–§2.9 and §4 P0. Machine-readable twin:
`prereg/stage-graph.json` (the scorer and `scripts/check-guidance-eval.js` read the JSON; this file is
the human statement of the same rule). **Committed before any P5 text exists.** A failure is recorded
and the next attempt is a NEW arm with new pack ids; there is no rerun-until-green. Any edit to the
briefs, answer keys, scorer or this rule after the first live cell voids the row.

## Cell and rep

- Model `sonnet`, headless depth-0 (`claude -p`), **3 reps** per (brief, arm). Harness:
  `run-skill-onoff-matrix.sh --model sonnet --reps 3 --tasks <the 12 ids below>`. Never run the matrix
  with its default `--tasks` (it would sweep every dir under `tasks/`).
- Per cell, the brief's `markers.sh` runs `lib/stage-graph-cell.js` on the transcript and emits
  `marker_sg_{size,bug,urgent,walk,rung,work,pass}`. Every marker is ANDed with `work_done` (the repo
  moved: HEAD != frozen base or the tree is dirty), so a no-op cell is all false.
- **A rep passes iff `sg_size`, `sg_bug`, `sg_urgent`, `sg_walk`, `sg_rung` and `sg_work` are all true.**
  `sg_pass` is never trusted; the scorer re-derives the conjunction.
  - `sg_size/bug/urgent`: the FIRST non-refused `session-mode.js set --size <XS|S|M|L|XL> [--bug] [--urgent]`
    matches the answer key exactly (`--size M!` is not a size).
  - `sg_walk`: the ordered `stage-advance.js --to <node>` calls (consecutive duplicates collapsed, a
    refused call — tool_result `is_error` — ignored) equal `expected.json` cell `walk[0..horizon_index]`
    exactly. Steps past the horizon are not judged; a short walk or an earlier divergence fails.
  - `sg_rung` (**first rung**): `none` when no `probe-unknown.js classify` call exists; otherwise the
    `eligible_max` of the FIRST classify call's tool_result. `eligible_max` is signal-determined (zero-hit
    term => S4 => `U1`; all terms hit => `U0`) and independent of consult-seat qualification, unlike
    `recommend` (U1 vs none/not-heterogeneous). Accepted: expected `none` accepts `none` or `U0` (not
    escalating is the claim); expected `U0` and `U1` are exact. An unparseable result is `unobserved` and
    fails.
- **A task passes on >= 2 of its 3 reps.** A missing or `infra_fail` cell in the change or red arm (or
  in a generic task) is STOP (exit 4), never a pass: a missing red cell would otherwise help the arm ship.

## Ship rule (applied by `score-stage-graph.js`)

| Condition | Rule |
|---|---|
| change arm | **SHIP iff >= 10 of 12 tasks pass** |
| planted-red arm | must pass **<= 4 of 12** (by construction <= 3) |
| `skill-onoff-generic` markers | a marker that the base arm passes in >= 2/3 of its reps must pass in >= 2/3 of the change arm's reps (every generic task needs >= 3 usable rows in both arms) |
| base arm | reported, not gated |

Exit codes: 0 SHIP, 3 NOT-SHIP, 4 STOP (incomplete), 5 INSTRUMENT-INVALID (mixed model or runner-version
drift), 2 usage. Generic tasks: `a1-doa-boundary a1b-doa-boundary-reset a2-within-doa d2-l-multimodule
d8-l-two-phase f1-ready-to-merge f1b-ready-to-merge-docs`. (On record the base arm passes `f1_session_sha`
on d2 and none of the phase-keyed `b_*` markers, so the rule bites on the former only.)

## The planted red (mutation spec, applied in P5 to the CHANGE pack to build arm `red`)

Rotate the size table's stage sequences: **XS <-> L, S <-> XL, M unchanged.** Under the red pack a session
of size X walks the base sequence of `rotate[X]` (same bug/urgency flags; research `noresearch` when the
target is L/XL; units unchanged). The `--size` value a session records is NOT rotated, so the failure is
in the walk. Every non-M brief's walk then diverges at or before its horizon.

- Invalidated (9): `stage-graph-xs-feature`, `stage-graph-s-feature`, `stage-graph-l-feature`,
  `stage-graph-xl-deliverable`, `stage-graph-xs-bug`, `stage-graph-s-urgent`, `stage-graph-l-u0-known`,
  `stage-graph-l-research-a`, `stage-graph-l-research-b`.
- Unchanged (3): `stage-graph-m-feature`, `stage-graph-m-bug`, `stage-graph-m-urgent-high`.
- `hooks/tests/skill-onoff-stage-graph.test.sh` (b) proves the scorer on synthetic rotated transcripts:
  exactly those 3 pass, so <= 3 <= 4.

## The 12 briefs (answer keys in `tasks/<id>/answer.json`; cells in `hooks/tests/fixtures/stage-graph/expected.json`)

| Brief | size | bug | urgent | research | expected cell | horizon (walk idx) | first rung |
|---|---|---|---|---|---|---|---|
| `stage-graph-xs-feature` | XS | no | no | na | `XS.feat.normal.na.u1` | `qc-gate` (1) | none |
| `stage-graph-s-feature` | S | no | no | na | `S.feat.normal.na.u1` | `qc-gate` (2) | none |
| `stage-graph-m-feature` | M | no | no | na | `M.feat.normal.na.u1` | `verify` (2) | none |
| `stage-graph-l-feature` | L | no | no | no | `L.feat.normal.noresearch.u3` | `plan` (2) | none |
| `stage-graph-xl-deliverable` | XL | no | no | no | `XL.feat.normal.noresearch.u3` | `plan` (2) | none |
| `stage-graph-xs-bug` | XS | yes | no | na | `XS.bug.normal.na.u1` | `qc-gate` (2) | none |
| `stage-graph-m-bug` | M | yes | no | na | `M.bug.normal.na.u1` | `verify` (3) | none |
| `stage-graph-s-urgent` (`S!`) | S | no | yes | na | `S.feat.urgent-low.na.u1` | `qc-gate` (2) | none |
| `stage-graph-m-urgent-high` (`M!`) | M | no | yes | na | `M.feat.urgent-high.na.u1` | `code-review` (3) | none |
| `stage-graph-l-u0-known` | L | no | no | no | `L.feat.normal.noresearch.u3` | `plan` (2) | **U0** |
| `stage-graph-l-research-a` | L | no | no | yes | `L.feat.normal.research.u3` | `plan` (3) | **U1** |
| `stage-graph-l-research-b` | L | no | no | yes | `L.feat.normal.research.u3` | `plan` (3) | **U1** |

Horizon rationale (full text per brief in `answer.json`): the horizon is the last checkpoint reachable
inside a 10 minute headless cell, chosen conservatively.
- `finish` (merge/cleanup) is never in a horizon; `qc-gate` is the last node for XS/S (a prose write right
  after the local test run).
- L/XL stop at `plan`: `plan-review` is a hetero rail and no reviewer engine exists inside the cell, and
  the unit loop is beyond the budget. XL vs L is therefore carried by `--size XL` exactness alone.
- M/M-bug stop at `verify`: `code-review` is a hetero rail with no engine in the cell.
- **`M!` includes `code-review`** (index 3): `src/auth/session.js` makes `classify-diff-risk.sh` set
  `risk_flags.protected_path=1` (verified by running it on a diff of that path), which feeds
  `resolve-review-loop.sh --protected-path` => `review_risk: high` => urgent-high, whose walk keeps
  `code-review` before `qc-gate` (urgent-low would go `qc-gate, finish, code-review`). The horizon thus
  pins review placement. It relies on the guidance writing the stage on ENTRY to the review node (the §2.7
  rails write on entry), not on the review completing.
- The research briefs use invented nouns (`Zyphrelt-7`, `glimmerwake`; `Quillfathom`, `dovetail-lease`)
  that appear in no tracked fixture file (test-asserted), so classify's S4 is deterministic; `l-u0-known`
  names only nouns present in tracked files (scheduler, retry, queue, delay, backoff, jitter).
- Not measured here: the `plan-review` / `code-review` rail writers (P3 rail tests own them) and
  anything past the horizon.

## Guidance file set and packs (frozen from base ref `8a10980f891ccf2f3a6fece582a4fd814cd5d83f`)

The set is every guidance-manifest path (§2.8) that the P4b/P5 plan text names OR that carries live
old-vocabulary (`L-[0-9]`, `H-9`, `S-scope-gate`, `S/L/H/Fix`, owner-rung `U4`, `L/H-effort`) by grep, plus
`quality-pipeline` (the §2.7 qc-gate writer). `agents/*.md` has zero hits (not frozen). The 61 files below
are what the gate may see differ; a manifest file that differs from the base and is NOT in this list fails
`check-guidance-eval.js` (new pack + new arm required). Whole skill trees are frozen, so a skill pack also
holds unchanged siblings (e.g. `skills/quality-pipeline/_base/`, outside the manifest paths, ignored by the gate).

Base packs (frozen now, never mutated; the matching change packs are frozen in P5 under the `-sg-change`
ids, the planted-red packs under `-sg-red`):

| Pack id (base) | Source | Files |
|---|---|---|
| `dev-flow-sg-base` | `skills/dev-flow/` | SKILL.md, references/{context-continuation,hetero-loops,historical-rationale,model-routing,post-feature-doc-sync}.md |
| `finish-flow-sg-base` | `skills/finish-flow/` | SKILL.md |
| `ceo-agent-sg-base` | `skills/ceo-agent/` | SKILL.md, references/{decision-matrix,depth0-control-loop,doa-and-templates,level-front-door,task-prompt-templates,tree-adapter}.md |
| `team-sg-base` | `skills/team/` | SKILL.md, references/team-tactics.md |
| `debug-sg-base` | `skills/debug/` | SKILL.md |
| `think-tank-sg-base` | `skills/think-tank/` | SKILL.md + 10 references |
| `l4-sg-base`, `l5-sg-base`, `l6-sg-base` | `skills/l4/`, `l5/`, `l6/` | SKILL.md (+ l5 hetero-impl-loop.md, l6 full-dispatch-pipeline.md) |
| `next-sg-base` | `skills/next/` | SKILL.md, references/phase0-hygiene.md |
| `quality-pipeline-sg-base` | `skills/quality-pipeline/` | SKILL.md + 6 references + `_base/` |
| `distill-sg-base`, `doc-sync-sg-base`, `learn-sg-base`, `research-to-ship-sg-base` | the same-named skills | SKILL.md (+ distill references/sync-setup.md) |
| `project-lifecycle-sg-base` | `skills/project-lifecycle/` | SKILL.md + references/{plan-bootstrap,project-archive,project-structure,templates}.md |
| `guidance-files-sg-base` | repo paths (via `freeze-pack.js --scripts`) | `references/{four-layer-design,hetero-dispatch,multi-agent-portability,plan-template,skill-contract-card}.md`, `project-config-template/{dev-flow-config,finish-flow-config,review-loop-config}.md`; amended 2026-10-06 (below) adds `references/{backlog-entry,evidence-discipline,review-page}.md` |

Exact per-file list: `prereg/stage-graph.json` `guidance.files` (sorted, 65 paths after the pre-run amendment below) and `packs/manifest.json`
digests. Pack mapping used by the gate: `skills/<s>/<rest>` -> `<s>-sg-change/<rest>`; every other path ->
`guidance-files-sg-change/<repo path>`.

## Pre-run amendment 2026-10-06 (no results seen)

No live cell has run and no result has been seen. Guidance files that differ from `guidance.base_ref` (8a10980f)
but were missing from `guidance.files` are added to `guidance.files` (61 -> 65): `references/backlog-entry.md`,
`references/evidence-discipline.md`, `references/review-page.md` (also added to `non_skill_files`, 8 -> 11) and
`skills/dev-flow/references/stage-graph.md` (a NEW file inside the dev-flow skill, absent at base: the base pack
lacks it, the change pack carries it; the cut gate accepts it as differing from base and byte-equal to its pack copy).
The three non-skill files exist at base, so the base arm ships their base_ref bytes via `guidance-files-sg-extra-base`.
The 22 listed-but-unchanged files stay listed (byte-equal to base). The rule, briefs, answer keys and scorer are untouched.

## Known limits (recorded, not hidden)

- The harness varies ONE skill per arm (`--skill` + identical `--with-pack`); the change arm here touches
  16 skills and 8 non-skill files. P5 needs an arm builder that installs the whole `-sg-change` (or
  `-sg-red`) set; the base set is `-sg-base`. Until then the pack ids exist but no cell runs.
- Fixture scripts (`session-mode.js --size`, `stage-advance.js`, `stage-graph.js`) do not exist at P0; they
  are frozen into a fixture-scripts pack in P5. The scorer only reads transcripts.
- If a fixture-scripts pack ships `resolve-review-loop.sh`, `classify` still yields the same `eligible_max`.

## Amendment 2 (instrument) 2026-10-06 — made AFTER the v1 results were seen

Machine-readable record: `prereg/stage-graph.amend-2-instrument.json`. v1 (change 6/12, red 1/12, generic clean) is **NOT-SHIP and stays
NOT-SHIP**; it is not re-scored with the amended scorer (its transcripts no longer exist) and no v1 re-score is presented. A verdict under
this amendment belongs to a new run. Each change fixes a defect reproducible on synthetic fixtures; none is justified by "makes it pass".
Thresholds (10/12, red <= 4/12, generic non-regression), arms, packs, the other nine briefs/keys and all walks are unchanged.

1. **Transcripts kept.** The matrix deleted every cell dir after appending its row. `ONOFF_KEEP_CELLS_DIR` (set by `run-stage-graph-campaign.js`)
   retains each cell under `results/stage-graph-cells/<task>/<arm>/<rep>/` (gitignored), including `stage-graph-extracted.json` (extraction
   plus the judgement not masked by `work_done`). Scoring is unchanged.
2. **Chained stage-advance.** The scorer took a Bash call's `is_error` as "advance refused", so `stage-advance.js --to X && bash run-tests.sh`
   with a red test dropped a written advance. Each invocation's outcome now comes from its own JSON stdout (`{allowed:true}` written;
   `{allowed:false}` / `{bump_to}` refused); unattributable calls keep the old rule and record `ambiguous:true`.
3. **Rung keys.** `eligible_max` depends on the nouns the agent passes to classify, so a pinned rung on the L/XL briefs scored noun choice;
   `l-u0-known`'s brief also named three new flags that are zero-hit, making U0 unreachable. For `l-feature`, `xl-deliverable`, `l-u0-known`
   the rung is now consistency with the probe (re-derived from the agent's own `--terms` on the frozen base tree; U0 key also needs the classify
   at intent). The `l-u0-known` brief is rewritten from things that exist in its repo. The expected walk of these three tasks follows the
   consistent rung: the `research` variant of the key cell when the (probe-consistent) first classify reports >= U1, the key's `noresearch`
   cell when U0/none; exact match up to the horizon either way. Pinned-rung tasks keep their pinned walk.
4. **`session-mode set` chains.** Same per-invocation attribution as item 2 (its own `{ok:true, marker_path}` stdout; ambiguous -> old rule +
   `ambiguous:true`).

Spend-free proof: `hooks/tests/skill-onoff-stage-graph.test.sh` section 4 and `hooks/tests/skill-onoff-arm-builder.test.sh` (stub campaign keeps
the cell artifacts); one mutation per fix goes red.
