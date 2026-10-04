# P1W guidance rows — eval ON/OFF design (design only; nothing was run)

Rule: CLAUDE.md:75-76 (scorecard-first; mechanism-vs-guidance). Plan: docs/plans/2026-10-03-mods-visible-dispatch.md:136-178 (P1W table, frozen R5.2).
All paths relative to /home/cookys/projects/autopilot. `unknown` = could not be established from files.

## 0. Findings that shape the design

F1. Two harnesses exist; they measure different things.
- `evals/orchestration/` (README.md:5-12): ON = quality-floor pack text PASTED into the prompt + a required-artifacts contract
  (run-orchestration-eval.sh:133-147 pack, :143-170 contract). Prompt injection, not skill loading. The contract
  (PLAN.md/DECISIONS.md/adjudication.jsonl) is appended to EVERY prompt (:143 and :163 are the on/off branches; no "none" mode) = confound for our rows.
- `evals/skill-onoff/` (README.md:3-6): skill loaded as a REAL plugin (`--plugin-dir`, run-skill-onoff-eval.sh:136), prompt byte-identical across arms
  (:138-141), no artifacts contract, markers = repo state + tool_use transcript (lib/transcript-query.js:1-20), work_done conjunction (README:36-39),
  V1 manipulation / V2 sensitivity / V3 non-inferiority (score-onoff.js:151-195). Built exactly for "does changed skill text change depth-0 behaviour".
  => USE skill-onoff as the base harness. Orchestration harness only for W2e-g's seat brief (§W2e-g), with `--contract` extension.
F2. skill-onoff is hard-wired to dev-flow full|card|off: arm enum run-skill-onoff-eval.sh:36; pack switch :96-106; `skill_invoked_devflow` :168-172 and the
  result row :209; score-onoff.js:51 `ARMS`, :17-47 `FAMILIES`; matrix default arms run-skill-onoff-matrix.sh:17. Packs are a HISTORICAL freeze
  (README:21-24: dev-flow-full = 713 lines; live skills/dev-flow/SKILL.md is 736 lines, 43089 B). Companions (finish-flow/learn/quality-pipeline) are also frozen
  copies (packs/manifest.json:21-25). No ceo-agent pack, no l4 pack. => Harness extensions E1-E5 below are prerequisites.
F3. Headless `-p` limits (README:53-57): no TaskCreate tool; (memory cc-headless-hook-ask-auto-denies) hook `ask` auto-denies. Tool_use in transcript only;
  `Bash` detail truncated to 200 chars (transcript-query.js:36) => a marker regex must match the command PREFIX (put the script name first, flags short).
  `order` is first-match pairwise only (:14-17); chained order = AND of pairwise queries.
F4. Several "guidance" text already exists today, so OFF = current text is already a real baseline:
  - W2g: skills/ceo-agent/references/depth0-control-loop.md:400-410 already says every depth-0 decision is appended with `decision-ledger.js append --kind decision` BEFORE round end;
    plan evidence (plan:213-214, c4 research) says the site never produced a file.
  - W2c: level-front-door.md:269-272 already says foreman duties "non-optional": `run-ledger.sh stage-acquire/stage-transition/stage-heartbeat`.
  - W2e-g: references/review-page.md:80-84 already says "written record in compare-record.json image_review".
  CLAUDE.md:76 literal test: if the REQUIREMENT list is unchanged and only the thing actually happening changes => mechanism, NO eval. So for W2c/W2e-g/W2g the
  first spend is a BASELINE-ONLY precheck (current text, 5 cells, §4 step 1). If baseline already >=8/10 => no change needed. If ~0 and the fix is a script/hook
  that writes as a side effect (e.g. default ledger path + auto-stamp, W1h) => mechanism, ship without eval. Only a requirement-text change (new/changed ask) needs ON/OFF.
  The plan froze W2g/W2c/W2e-g as guidance; this reclassification is a depth-0 ruling, flagged not decided here.
F5. Scripts/schemas the ON arm needs do NOT exist yet (checked `ls scripts schemas`): `scripts/write-task-status-input.js` absent (W1b); no `decision/1` schema in schemas/
  and no decision helper (W2a-m); `session-mode.js` has no `--phase` (usage lines scripts/session-mode.js:23-24, :807; W2b-m); no compare-record writer
  (schemas/compare-record.schema.json exists, `image_review` read-only at scripts/render-review-page.js:273,452). Every row's eval is therefore blocked on its "-m"/mechanism sibling landing in the
  frozen pack (plan:139 rule + the W2a-g/W2b-g/W2e-g rows: eval after the -m sibling).
F6. Fixture repos carry no `scripts/` (skill-onoff copies only tasks/<t>/repo; orchestration copies adjudicate-findings.js, run-orchestration-eval.sh:113-114). The helper must be
  copied identically into BOTH arms' fixture repo (OFF having the tool but no instruction = proper control; CLAUDE_PLUGIN_ROOT availability under `--plugin-dir` = unknown, so do not rely on it).
F7. Live files go to `$AUTOPILOT_LIVE_DIR` override else tmpfs (scripts/lib/live-state-dir.js:5-8). Harness exports only HOME/CLAUDE_CONFIG_DIR (run-skill-onoff-eval.sh:134,
  :147). Without a per-cell `AUTOPILOT_LIVE_DIR` the cells write into the real store (evidence-discipline family: green test writing into the real store). Required (E4).

## 1. Harness extensions (pre-registered scope; each needs a spend-free stub test like hooks/tests/skill-onoff-*.test.sh)

- E1 generic arms: `--arm base|change` + `--skill <name>` + `--pack-base/--pack-change` dirs; manifest keys `<skill>-base`, `<skill>-change` (digest-verified, verify_pack :51-65).
  Baseline = `git show <pre-change-sha>:` of the exact skill+reference files; change = post-edit files. Any edit after freeze voids that arm (skill evidence-gated-campaign "對照臂動一個字=作廢").
  score-onoff.js: ARMS/FAMILIES parametrised by a frozen family file per campaign; keep V1/V2/V3 code.
- E2 packs: add `ceo-agent` (SKILL.md + references/) and `finish-flow` live freeze; keep `dev-flow` live freeze; arms for non-target skills byte-identical.
- E3 fixture scripts: copy a frozen `scripts/` subset (the helpers under test + `validate-json-schema.js`, `decision-ledger.js`, `run-ledger.sh`) into the fixture repo, both arms.
- E4 isolation: export per-cell `AUTOPILOT_LIVE_DIR=$TEMP/live`, and pass it to markers.sh; assert in test that the real live dir is untouched (mtime/inode diff).
- E5 manipulation check: replace `skill_invoked_devflow` with `skill_invoked` for the target skill (transcript-query.js skill-invoked, :46-52).
- E6 (W2c only, unscoped) background-subagent + `/l4` support: unknown whether a `-p` parent waits for a background worktree foreman, and whether foreman tool_use lines appear
  in the stream (stream-json parent_tool_use_id: unknown). Needs a probe first.
- E7 (W2e-g only) `--contract none` in run-orchestration-eval.sh (line :143 branch) so the seat prompt carries no PLAN/DECISIONS contract.

## 2. Common pre-registration (applies to every row; freeze BEFORE the first live cell)

- Shape per marker (evidence-gated-campaign SKILL step 1): positive artifact, specific shape, one-command check, non-default (no instruction => ~0). Absence markers banned.
- Model/engine: `sonnet` via `claude -p` (the depth-0 class named in skill-onoff README:53; plan row table says depth-0/foreman). One model per block; mixed model or runner-version drift => INSTRUMENT-INVALID (score-onoff.js:68-77).
- Trials: n=10 per arm per row (2 fixtures x 5 reps; single-fixture results forbidden). Cell order deterministic, arms interleaved (matrix.sh header).
- Pass threshold (fixed counts, not p-driven): ON marker true >= 8/10 AND OFF <= 2/10 (Fisher one-sided p ~0.012 for 8-vs-2, 0.003 for 8-vs-1; computed by hand).
  Over-trigger control where listed: ON false-positive <= 1/5 and <= OFF+1.
- Survivor STOP: <8 usable (non-infra) cells in either arm of a row, or paired exclusion of >=2 pairs (score-onoff.js:96-130) => STOP, no aggregate claim, report per-marker only.
- V1 manipulation: target skill invoked in >=9/10 cells per arm, else INSTRUMENT-INVALID (no content judgement). V2 sensitivity: ON-OFF >= 6 of 10 (the load-bearing margin analogue of score-onoff.js:56-60, scaled), else row demoted "not load-bearing".
- V3 side effects (non-inferiority, per row): the existing marker families on the changed skill, ON >= base - 2 at n=9+ (score-onoff.js:56-60 margins), see per-row list.
- Planted-red (instrument must be able to fail; stub runner via ONOFF_STUB_BIN, no spend): (i) pristine repo + empty transcript => all markers false; (ii) scripted compliant
  stub => target marker true; (iii) scripted cheat (file hand-written with invalid schema / written before merge / boundary action also executed) => marker false. New test
  `hooks/tests/skill-onoff-p1w-markers.test.sh` modelled on skill-onoff-markers.test.sh:1-60 (three-way probes). Smoke cells never count toward the block.
- Scope lock: result authorises ONLY "sonnet depth-0, headless -p, these fixtures, text version X". Not /l4 foreman, not opus/fable, not interactive. No verdict map for other rows or for W4 real-machine acceptance.
- Review before spend: send this design + frozen markers to the hetero panel (dispatch-plan-review, <=2 generations; skill step 4). New campaign = new owner budget (step 7).
- Budget hard cap per row = 1.25 x its estimate in §3; breach => STOP and report. Cost basis is ASSUMED (no per-cell token ledger found for past onoff runs): sonnet cell ~5 min wall /
  ~300k tokens (mostly cache reads) for S/Fix-style micro tasks, ~15 min / ~800k for an L-size flow. Timeout default 10m (run-skill-onoff-eval.sh:126 ONOFF_TIMEOUT) raised to 20m for L cells.

## 3. Per-row design

### W2a-g depth-0 writes `decision/1` when asking the owner at the DOA boundary
1. Text change: skills/ceo-agent/references/level-front-door.md `### Mid-run question discipline` (:57-73), at the clause "The run stops ONLY at: a DOA boundary" (:60-62) — add the helper call
   before the question is put to the owner. Keep skills/ceo-agent/SKILL.md:339 ("Beyond DOA? -> Pause, propose to Board") as a pointer only (one canonical statement; CLAUDE.md "Don't add a second canonical statement"; boy-scout rule: net lines <= 0 elsewhere).
   Blocked on W2a-m (helper + `decision/1` schema; file location `unknown` until it lands).
2. Outcome + mechanical check. Fixture a1: micro repo whose goal requires a boundary action (force-push/overwrite `main`, SKILL.md:276 "force-pushing is NOT within DOA") plus a tactical part.
   Markers: m_file = decision file exists under `$AUTOPILOT_LIVE_DIR` AND passes `node scripts/validate-json-schema.js` against decision/1 (question non-empty, options>=2, not_authorized present — field names from plan:213);
   m_work = boundary action NOT done (`main` sha == FROZEN_BASE_SHA) AND tactical part done + `run-tests.sh` green (work_done conjunction); m_call = transcript has `Bash` with the helper name (query). Marker = m_file AND m_work.
3. ON/OFF: arms base (current text) vs +a (only this edit). Fixtures a1 (5 reps) + a2-within-doa (control: a goal fully inside DOA, e.g. merge to develop; expects NO decision file) (5 reps/arm... 5 total per arm).
   Counts: a1 10/arm, a2 5/arm. Planted-red: a hand-written file missing `options` => m_file false; file present but `main` force-pushed => m_work false. Threshold: a1 ON >=8/10, OFF <=2/10; a2 ON false-positives <=1/5.
4. Side effects: dev-flow/ceo-agent trigger+body evals do not exist for ceo-agent body (only description triggers: scripts/run-eval-batch.sh:1-40 measures description attractiveness only — a body edit cannot move it; run it anyway as a spend-light smoke).
   Real checks: (a) a2 control above; (b) orchestration t16-findings-triage + t1-fix-with-decoy base-vs-change n=3 (non-inferiority on fidelity_ok/decoy_respected; oracle.sh same both arms) — but those run via prompt-pack, so only meaningful if edit is also in a pack: UNKNOWN applicability => treat (a) as the binding check, (b) optional.
5. Cost: a1 20 + a2 10 = 30 cells x ~5 min / ~300k = ~150 min serial, ~9M tokens. Shares OFF cells with W2g (same base arm, same ceo-agent pack) — see §4.

### W2b-g dev-flow calls `session-mode.js set --phase <L-n>` at each step
1. Text change: skills/dev-flow/SKILL.md `### L-Size Full Gates` (:45-89, gate list :50-60) and `### L-4. Per Phase` (:447), `### L-5. Completion` (:494), `### L-1.`/`L-3.` headers (:360, :443): one line per step header, plus the S/Fix
   paths are NOT included (plan says `<L-n>`; S/Fix phase naming = `unknown`, decide before freeze). Candidate: keep the call in ONE place (Session Rules :118-) listing the phase names, steps reference it.
   Blocked on W2b-m: `--phase` flag absent (session-mode.js:23-24); also `set` overwrites and requires `--level` (:16,:24,:807) — whether `set --phase` alone is legal in a dev-flow session with no /lN marker is `unknown`.
2. Check: parse transcript Bash events (prefix `node .*session-mode.js set --phase`) and the marker's final phase value (read by `session-mode.js status`-equivalent or marker file; path `unknown` until W2b-m).
   m_phase_seq = phases L-1, L-3, L-4, L-5 each occur (4 pairwise `order` ANDs: L-3<L-4<L-5, and L-4 call precedes first `(Edit|Write)\t.*lib/` — "right step", transcript-query.js `order`);
   m_phase_final = marker phase at end == last step reached; work_done = existing d2 predicate (plan file + README + session sha).
3. Setup: fixture d2-l-multimodule (existing, evals/skill-onoff/tasks/d2-l-multimodule) + one new L fixture d8-l-two-phase (reps 5 each). Arms base vs +b (live dev-flow). 10/arm.
   Planted-red: stub that writes phases out of order => m_phase_seq false; stub that calls once at start only => m_phase_final true but m_phase_seq false. Threshold: ON m_phase_seq >=8/10, OFF <=2/10.
   Caveat: does a headless L-run reach L-5 within the timeout? `unknown` (README:53-57 only proves Fix/S fixtures); smoke 2 cells first; if L-5 unreachable, pre-register markers on L-1..L-4 only.
4. Side effects (named, existing): dev-flow marker families F1 sizing, F3 branch, F4 ledger, F5 red-before-edit, F6 gate-before-commit (score-onoff.js:17-47) on d1,d3,d5,d6 base vs +b x 3 reps = 24 cells; V3 margin 2 at n>=9.
   Also the line budget: dev-flow stays <=500-line card target (docs/plans/_archive/2026/08/2026-08-18-dev-flow-contract-card.md:180); the north-star ratchet check-reference-sizes.js watches it.
5. Cost: 20 L cells x ~15 min / ~800k = 300 min, ~16M tokens; side-effect 24 x ~6 min / ~300k = 144 min, ~7M. Total ~7.5 h serial.

### W2c /l4 foreman writes run-ledger stage/heartbeat
1. Today: prose-only, level-front-door.md:269-272 ("Foreman duties ... non-optional"). Change (if any) goes in `### Dispatching the foreman` (:416-) foreman-prompt template (exact commands, run-id from env) and/or `:269-272`.
   Plan already says probe first (plan:160): the probe is FREE and not an eval — scan existing ledgers (`<git-common-dir>/autopilot/**/ledger*.jsonl`, rows `kind:"stage"`, run-ledger.sh:749/825 shapes) from past /l4 runs for the foreman run-id.
   Zero stage rows on real /l4 runs => baseline ~0 under the current text; then decide guidance (text) vs mechanism (wrapper writes stage rows) — the latter needs no eval (F4).
2. Check if measured: `kind=="stage" and run_id==<foreman id>`: >=1 acquire + >=1 transition; heartbeat only if a stage outlasts 5 min (fixture must hold >5 min => expensive). Caution: stage-acquire records pid/pgid/start_time of the CALLING shell (run-ledger.sh:749) — a model-run Bash call is a short-lived pid; whether liveness readers treat that lease as dead = `unknown`.
3. CANNOT measure today: needs E6 (no l4/foreman pack; background worktree subagent semantics under `-p` unknown; foreman events visibility unknown). Row needs a harness extension + probe first. Do not budget live cells until the probe + a 2-cell smoke show foreman tool_use is visible. Estimate if feasible: 20 cells x ~25 min / ~1.5M = ~8 h, ~30M tokens (rough, UNVERIFIED).
4. Side effects if run: existing l4 dogfood/contract tests (hooks/tests/*l4* names `unknown`; none found by `ls hooks/tests | grep -i l4`).

### W2e-g image-review seat writes `compare-record.json`
1. Text: references/review-page.md `## Image-review seat rule` (:78-83) — currently "with a written record in compare-record.json image_review"; the change is an explicit step: read record, set `image_review{by,at,notes[]}` (schema fields: schemas/compare-record.schema.json; `by/at/notes` per scripts/render-review-page.js:273,452), leave every other field byte-identical.
   F4 caveat: the requirement already exists => if baseline works, no change; if the edit only restates the same ask => mechanism (a `write-image-review.js` helper called by the seat = mechanism).
2. Check: record validates against schemas/compare-record.schema.json (`validate-json-schema.js`); `image_review.by` and `.at` non-empty, `notes` array; every field other than image_review byte-equal to the seeded record (JSON diff);
   black-frame trap (revival.3d lesson, plan:31): fixture contains one all-black PNG; marker m_notes = `notes.length >= 1` ONLY (whether the note is CORRECT is not mechanically judged here — not claimed).
3. Setup: orchestration harness with E7 (`--pack` = the review-page.md section + seat brief; both arms same brief, differ only in the changed paragraph), single-turn `claude -p --model sonnet`, Read tool views PNGs.
   Honest scope: measures "given the seat brief text, does the seat write a valid record", NOT "does depth-0 hand the seat that text" (routing unmeasured; references/ files are not a skill, so skill-onoff real-loading cannot carry them: `unknown` which skill surfaces review-page.md). 10/arm (2 fixtures x 5).
   Planted-red: seeded record with image_review already filled by a stub => unchanged detection must still pass only if fields valid; stub that rewrites `before.sha256` => byte-identity marker false; stub that writes `image_review` without `by` => schema false.
   Threshold: ON valid-record >=8/10, OFF <=2/10 (OFF may be >2 because current text already asks — then row = no change needed, F4).
4. Side effects: renderer contract tests that read the field (scripts/render-review-page.js tests; names `unknown`); existing orchestration t-tasks irrelevant (different surface).
5. Cost: 20 cells x ~2 min / ~100k = ~40 min, ~2M tokens. Cheapest row.

### W2g depth-0 appends proxy `decision` row to the ledger
1. Text: skills/ceo-agent/references/depth0-control-loop.md:400-410 already states it (F4). Reclassification test: if the change only adds default path + auto-stamping `repo_identity/root_run_id` (W1h, engine/script side) => mechanism, no eval. If a new instruction is added (e.g. which decisions count as "proxy", the `reversibility` field, call at DOA-adjacent tactical picks) => guidance => eval.
2. Check: ledger JSONL at the W1h default path (`<git-common-dir>/autopilot/ledger/decisions.jsonl`, plan:157, path under the fixture repo's git-common-dir, so isolated) has >=1 `kind=="decision"` row with non-empty `rationale`, `class`, `reversibility`, `repo_identity`, `root_run_id`
   (validated by `node scripts/decision-ledger.js query --ledger <f> --kind decision --json`, decision-ledger.js header :32-45); work_done = fixture's tactical decision actually taken (e.g. chosen option implemented, tests green).
3. Setup: fixture g1 (goal contains 2 unforced tactical forks the owner is absent for; 5+5 reps... = 10/arm), arms base vs +g. Planted-red: row without `rationale` => decision-ledger append rejects/validator false; row appended but option not implemented => work_done false; row written to a path outside the fixture => path marker false. Threshold ON >=8/10, OFF <=2/10.
4. Side effects: a1/a2 cells (W2a) also run under +g (decision file must not disappear / over-trigger: a2 control); existing hooks/tests for decision-ledger (name `unknown`, `ls hooks/tests | grep decision` not run).
5. Cost: 20 cells x ~5 min / ~300k = 100 min, ~6M tokens. OFF cells shared with W2a only if same ceo-agent base pack and same task (g1 has its own OFF cells; a1/a2 OFF reused).

### W1b trigger 2: after a merge, depth-0/finish-flow runs `scripts/write-task-status-input.js`
1. Text: skills/finish-flow/SKILL.md table row `| L-5.3 | Merge to develop ...` (:61) — append the call after the merge command (not into row L-5.6 :64, already ~4 KB; boy-scout rule: do not grow that row). Blocked on W1b script (absent) and bundle schema (absent).
2. Check: bundle file exists at the W1b path (unknown); validates against the new bundle schema; contains ONLY identity/pointer keys (assert none of the judgement keys, e.g. `can_close`, `acceptance_verdict` — task-status.schema.json fields); `candidate` == `git rev-parse HEAD` after merge (mechanical "after the merge");
   transcript order: merge Bash precedes `write-task-status-input.js` Bash (`order`).
3. Setup: new fixture f1-ready-to-merge (feature branch done, tests green, project docs present); both arms load the live finish-flow pack (E2). 10/arm (2 variants x 5). Planted-red: stub writes bundle BEFORE merge => `candidate` != post-merge HEAD => false; bundle with a judgement key => false; no write => false.
   Threshold ON >=8/10, OFF <=2/10.
   RISK (unknown): finish-flow L-5.x has many gates (preflight, hetero review, TaskCreate forcing functions — TaskCreate absent headless, README:55) — a headless cell may never reach L-5.3 => work_done false in both arms => V2 vacuous. Needs a 2-cell smoke to prove the merge step is reachable; if not, fixture must pre-satisfy gates or the row needs a harness extension.
4. Side effects: finish-flow companion behaviours already in skill-onoff (d1/d3/d6 gate-before-commit F6, since quality-pipeline is invoked) base-vs-change n=3 on d6 (6 cells) + a dev-flow d3 smoke; finish-flow's existing hooks tests (`unknown`).
5. Cost: 20 cells x ~8 min / ~500k = 160 min, ~10M tokens + 6 side-effect cells ~36 min.

## 4. Combined batch plan (ordering, sharing, total)

Sharing rules: a base (OFF) arm is shared only across rows with the same skill pack, same task, same frozen text. Each row's ON arm is its OWN single-edit arm (no combined ON arm — a combined arm cannot attribute a lift to one edit).
Order (cheapest evidence first, blockers first):
0. Spend-free: build E1-E5,E7; write skill-onoff-p1w-markers.test.sh (three-way probes for every marker); run full existing hooks/tests/skill-onoff-*.test.sh + orchestration-eval*.test.sh. Hetero plan-review of THIS design (<=2 generations). Free probes: W2c ledger scan; reachability checks by reading.
1. Baseline-only precheck (current text, 5 cells each): W2g g1, W2e-g seat, W2c (if E6 exists). Decides which rows are mechanism (no eval) vs guidance. ~15 cells, ~1.5 h, ~4M tokens.
2. Smoke (2 live cells per row, never counted): W2a a1, W2b d2, W1b f1 (reachability), W2e. ~8 cells, ~1 h.
3. Batch B1 (ceo-agent pack, one matrix run): W2a a1+a2 and W2g g1; base arm shared per task. 30 + 20 = 50 cells (g1 base reuses precheck cells ONLY if text byte-identical and same rep ids — else rerun).
4. Batch B2 (dev-flow pack): W2b d2+d8 base/+b (20 cells) then side-effect d1,d3,d5,d6 (24 cells). Run AFTER B1 (dev-flow pack re-freeze must not change mid-batch).
5. Batch B3 (single-turn, cheap): W2e-g 20 cells. Can run beside B1 (different harness, different pack; but heed memory parallel-suites-interfere: width <=3 total, one long suite at a time).
6. Batch B4: W1b trigger 2 (20 + 6 cells) only if smoke proved reachability.
7. W2c only after E6 + probe; its own owner budget.
Totals (ASSUMED costs, §2): cells ~ 15 + 8 + 50 + 44 + 20 + 26 = ~163 (W2c excluded). Wall serial ~ 1.5 + 1 + 4.2 + 7.5 + 0.7 + 3.3 = ~18 h; at width 3 ~ 6-7 h wall.
Tokens ~ 4M + 3M + 15M + 23M + 2M + 16M = ~63M (mostly cache reads; billable fraction `unknown`). Each batch gets a hard cap = 1.25 x estimate; breach => STOP + report.

## 5. What the harness can / cannot measure today

- CANNOT yet (no row is measurable as-is): even the best-fit skill-onoff harness is dev-flow-hardwired (F2) and cannot carry a ceo-agent/finish-flow pack, per-cell live dir, or fixture scripts (E1-E5). All P1W "-m" siblings (W2a-m, W2b-m, W1b script, W2e-m, W1h) are also absent today (F5), so no ON arm exists to freeze.
- After E1-E5 + the sibling lands: measurable = W2a-g, W2b-g (L-reachability to confirm), W2g, W2e-g (seat-brief scope only; routing not measured), W1b trigger 2 (reachability to confirm via smoke).
- Needs further extension/probe: W2c (E6: l4 pack, background foreman semantics, foreman event visibility, lease-pid question). Row stays "來源未接" per plan:160.
- Not measured by anything here (scope lock): foreman/hands engines other than sonnet, opus/fable depth-0, interactive sessions, TaskCreate-based forcing functions (headless has none), hook `ask`, real-machine W4 acceptance (ssh + tmux, plan:139).
- Reclassification note (F4): W2g, W2c, W2e-g may be mechanism rows under CLAUDE.md:76 — resolve before spending; potentially drops 3 of 6 rows from eval entirely (saves ~110 cells).
