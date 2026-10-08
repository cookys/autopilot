> Failure diagnosis of the stage-graph P5 eval arm v2 (session report, 2026-10-07).
> Diagnoses eval arm: v2 (NOT-SHIP, change 4/12, red 0/12, generic regression on d2).

# stage-graph eval v2 diagnosis (read-only)

Source: `evals/skill-onoff/results/stage-graph-cells/<task>/<arm>/<rep>/` (transcript.jsonl, stage-graph-extracted.json). Both change and generic cells (base and change) ARE retained. Usable rows 114, infra rows 80 ignored. Cells = `claude -p` sonnet, `ONOFF_TIMEOUT` default 10m, no max-turns flag (`run-skill-onoff-eval.sh:272`). change pack `dev-flow-sg-change-v2` is byte-equal to `skills/dev-flow` at HEAD (diff -rq empty).

Change arm: 14 of 36 reps pass; tasks passing = xs-feature, s-feature, xs-bug, s-urgent (4/12). 22 failing reps.

## 1. Per failing rep (S=session-mode set; C=classify; A=stage-advance --to; "loop" = `for n in ...; stage-advance --to $n`)

Extractor defect that drives most rows: `stage-graph-cell.js:196` only reads `--to [a-z-]+` literally, so `--to $n` yields `to:null` and the node is dropped from `walk`. Also a classify result is "unobserved" when the tool_result holds more than one JSON object.

| rep | what the transcript shows | class |
|---|---|---|
| m-feature r2 | S `--size M`; `stage-advance --to intent` -> `{"allowed":false,...,"reason":"first write must target the entry node plan for size M"}` (exit 3); A plan, implement (JSON ok); then `for n in verify code-review qc-gate; do ... --to $n \| head -c 150` -> three `{"allowed":true...`. extracted walk `["plan","implement"]`. Final: "committed ... as `174cc3a`" | I (true walk = key) |
| m-feature r3 | S M; `--to plan >/dev/null; --to implement --unit phase:1/1:report >/dev/null; echo $?` -> `0`; `for n in verify code-review qc-gate finish ... echo $n $?` -> `verify 0 code-review 0 qc-gate 0 finish 0`. extracted `["plan","implement"]` | I |
| l-feature r1 | S L; `for n in intent proposal plan ...; echo $n $?` -> `intent 0 proposal 0 plan 0`, then plan-review, implement 1/3 allowed. extracted `["plan-review","implement",...]`. No classify (key none OK) | I |
| l-feature r3 | S L; `classify --work-unit storage --terms "node:fs"` -> `recommend:"none", eligible_max:"U1", reason:"not-heterogeneous", S4`. extractor: rung `unobserved`. Agent then went intent>proposal>plan with no `research`. Final: "I did not run an independent code review". Text it skipped: "`recommend: none` with `eligible_max` above `U0` (rung skipped) -> `research` with local means" | G (I masks it) |
| xl r1 | S XL; `for n in intent proposal plan plan-review implement ... \| tail -2` -> allowed true for all five; extracted `["verify","implement",...]` | I |
| xl r2 | S XL; `for n in intent proposal plan ... head -c 200` -> three allowed; plan-review, implement allowed. extracted walk lacks intent/proposal/plan | I |
| xs-bug r1 | S `XS --bug`; `--to diagnose`, `--to implement >/dev/null && cat > lib/count.js`, then `--to verify >/dev/null; bash run-tests.sh; stage-graph next --from verify --size XS --bug` -> `PASS []`. `verify` is not an XS node: I reproduced exit 3 `{"allowed":false,"from":"implement","to":"verify","legal_next":["qc-gate"]}` in a scratch repo. Extractor counted it as written (call-level is_error=false). True walk diagnose,implement,qc-gate,finish = key | I |
| s-urgent r2 (task still passes) | `for s in verify qc-gate finish ... echo $s $?` -> all 0; extracted `["implement"]` | I |
| m-urgent-high r2 | S `M --urgent`; `for n in plan implement` -> `plan 0 implement 0`; then `--to verify` and `--to code-review` both `{"allowed":true`. extracted `["verify","code-review","qc-gate","finish"]` | I |
| m-urgent-high r1 | S `--size S --urgent` (brief names session.js, middleware, a new route, docs => M by "touching several modules"). No stage-advance at all. Final: "I skipped the review and finish-flow steps of dev-flow" | A (1 of 3 sized M) |
| m-bug r1 | S `M --bug`; `--to diagnose >/dev/null`; `--to plan >/dev/null; --to implement --unit phase:1/1:fix >/dev/null`; no `verify` ever; 9 turns, final "committed the fix as `e5785d4`" | G |
| m-bug r2 | no S, no A. Final: "I skipped the dev-flow stage-graph and review steps and just fixed, tested and committed" | G/A |
| m-bug r3 | S `M --bug`, `--to diagnose`, then `--to implement >/dev/null && cat > lib/round.js <<EOF`. I reproduced exit 3 `{"legal_next":["plan"],"reason":"diagnose -> implement is not an edge for size M"}`; the `&&` chain skipped the file write. Agent text: "My `lib/round.js` rewrite didn't land". Never wrote plan/verify. Text says "Exit 3: read legal_next" but the agent hid stdout | G (no rule against redirecting) |
| l-u0-known r1 | S L; loop intent>proposal>plan allowed; plan-review, implement 1/3..3/3. NO classify | G |
| l-u0-known r2 | S L only; zero stage-advance, zero classify; 13 msgs | G |
| l-u0-known r3 | S L; loop intent..implement allowed (`tail -1`); NO classify. Final: "I sized this as L and moved the session marker through intent, proposal, plan, plan-review and implement" | G |
| research-a r1 | S L; `--to intent && classify --terms "Zyphrelt-7,glimmerwake"` -> `recommend:"none",eligible_max:"U1",reason:"not-heterogeneous",skipped_rungs:["U1"]` (correct vs key U1; extractor says `unobserved`: I). `--to research` allowed. Then grep / and web search; final "I stopped before writing any code" | G (stopped; work_done false masks all markers) |
| research-a r2 | same classify (U1). `--to proposal` ok, then `--to research` -> `{"allowed":false,"from":"proposal","to":"research","legal_next":["plan"]}` (exit 3). Final: "I've stopped before writing any code" | G |
| research-a r3 | intent + same classify (U1); stopped: "I stopped before writing any code ... I won't invent one" | G |
| research-b r1 | no S, no A, no C: grep, `which`, 2 WebSearch, then "I haven't started designing or building anything" | G (SKILL: "step 1 precedes any research or question") |
| research-b r2 | S L, no A, no C; searched; "Without the real rules I'm stopping here" | G |
| research-b r3 | no S, no A, no C; final ends with a question "Could you give me one of these? 1. A spec ... 3. A go-ahead to build against an assumed generic lease protocol" | G |

Counts (22 failing reps): I only = 8 (m-feature x2, l-feature r1, xl x2, xs-bug r1, s-urgent r2, m-urgent-high r2). G = 13 (l-feature r3, m-bug x3, l-u0-known x3, research-a x3, research-b x3). A/T = 1 (m-urgent-high r1). M = 0.

Text that was ignored by the research stoppers (SKILL.md Session Start): "**No human available** (headless `-p` ...): never stop to ask. Wherever this skill says ask, confirm, pick or 'unsure => ask', take the recommended option". And for rung `none`: "Research with local means (repo, docs, knowledge); record what stays assumed - the proposal lists it". 6/6 research reps stopped anyway (brief says "working out how ... really behave[s] comes first").

## 2. stage-advance exit 3/4

Visible in change transcripts: exit 3 in 4 reps (m-feature r2: intent as first write on M; research-a r2: proposal->research; s-urgent r1 and r3: verify->code-review, the designed "attempt code-review" probe, then qc-gate, pass). Hidden by `>/dev/null` and reproduced by me: m-bug r3 (diagnose->implement), xs-bug r1 (implement->verify). Exit 4: 0 occurrences. Red arm: s-urgent r1 and r3 exit 3. Graph stricter than text: not found. The text ("Choosing the next node: `stage-graph.js next`", "Exit 3: read legal_next") agrees with every refusal; refusals come from agents not calling `next` or hiding the exit. The graph is looser than text in one place: plan-review -> implement is allowed with no review (agents wrote it by hand, no rail in the cell).

## 3. Horizon and budget

0 of 73 recorded cells (change+red) ended by budget: all `subtype:"success"`; max 152 s of a 600 s timeout, max 38 turns. Reached by true behaviour: m-feature verify 3/3; m-bug verify 0/3; m-urgent-high code-review 2/3; l-feature plan 3/3 (research variant owed in r3); xl plan 3/3; l-u0 plan 2/3; research-a/b plan (via research) 0/6 - agents stopped to ask. Horizon is reachable for everything except the research briefs.

## 4. d2-l-multimodule (generic regression)

Rows: f1_session_sha base 3/3, change 1/3; f1_plan_file base 2/3, change 1/3 (rule needs change >=2/3 where base >=2/3: both marker rows violate). Generic cells retained under `d2-l-multimodule/{base,change}/<rep>/`.

- base r1: 44 turns/70 s. Opens `mkdir -p .claude && git rev-parse HEAD > .claude/session-start-sha`, creates TaskCreate tasks "L-1.5: Scope completeness audit", writes `docs/plans/2026-10-07-plugin-api.md`, merges, finish-flow. Passed both.
- change r1: 8 turns/30 s. `git rev-parse HEAD > .claude/session-start-sha 2>/dev/null` with no mkdir; result `(eval):1: no such file or directory: .claude/session-start-sha`; never retried; no `docs/plans` file. Committed on a branch.
- change r2: 7 turns; never writes the SHA or a plan; final "I haven't committed anything or run finish-flow".
- change r3 (pass): `mkdir -p .claude && git rev-parse HEAD > ...`, writes `docs/plans/2026-10-07-parser-plugin-api.md`.

Plausible cause (inference from text diff, quoted): base SKILL had "### L-Size Full Gates ... All gates must pass before any code changes begin. 1. Record session start SHA: git rev-parse HEAD > .claude/session-start-sha". v2 turns it into a table row `| Session start SHA | M, L, XL | git rev-parse HEAD > .claude/session-start-sha | documented-only |`, reached only through Session Start step 3 "Run the start gates for your size (gate table below)", and step 4 immediately moves to `stage-advance`. The new text also centres the three scripts and drops the L-1.x TaskCreate scaffolding, so agents go straight-line (7-11 turns vs 24-44) and skip prose-only items. No mechanism enforces SHA or plan file; plan node says "Save to `docs/plans/YYYY-MM-DD-<feature-name>.md`" but only after `stage-advance --to plan`, and the agent wrote code in the same breath.

## 5. Summary

Classes of 22 failing reps: I 8, G 13, A/T 1, M 0.

- Instrument (I): 8 reps would pass on true behaviour, taking the change arm to 8/12 (m-feature, l-feature, xl, xs-bug, s-urgent, m-urgent-high all >=2/3 true). Still < 10. Fixing needs an instrument amendment (parse loops/`$n`, multi-JSON results), made after seeing results, hence a v3 arm; or text telling agents to call one `stage-advance` per node with stdout visible (also fixes m-bug r3's hidden exit 3).
- Text-fixable (G): (a) m-bug 0/3: add "never redirect or loop stage-advance; run `next` after each node; M bug = diagnose, plan, implement, verify". (b) l-u0-known 0/3: move the ladder probe into Session Start for L/XL (agents only classify when the brief announces an unknown: 3/3 research-a, 1/3 l-feature, 0/3 l-u0). (c) `none` with eligible_max>U0 must walk `research` (l-feature r3). (d) Re-inline session-start SHA (with `mkdir -p .claude`) and plan-file gates for L/XL to fix d2.
- Structural: research-a/b (0/6): headless agent stops at an unknowable spec despite "never stop to ask"; `work_done` ANDing turns a stop into all-false; the rung is `none`/not-heterogeneous so research has no rail to resolve it. Text can force "assume, record, continue" but the brief itself says research "comes first", so reaching `plan` requires the agent to fabricate a protocol. Also the generic d2 rule is a hard gate.
- Verdict: 10/12 needs two of {m-bug, l-u0-known, research-a, research-b} on top of the 8 true passes, plus d2 non-regression. m-bug and l-u0-known are text-fixable (and need the I fix), the research pair is structural. Reaching 10 is plausible only if agents can be made to continue past an unresolvable unknown; I would not bet on it.
