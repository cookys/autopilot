#!/usr/bin/env node
'use strict';
// build-prereg.js -- regenerate prereg/pilot.json and prereg/formal.json (both status "draft", unstamped) and
// COST-TABLE-{pilot,formal}.md. Run it only before stamping; after `stamp-rolekit.js` the prereg is frozen and this
// script must not be run again (a re-run changes a frozen file and voids the row). No model call.
const fs = require('fs');
const path = require('path');
const { compute, markdown } = require('../cost-table.js');

const ROLES = ['planner', 'implementer', 'reviewer', 'verifier', 'debugger', 'explorer'];
const PLAN = 'project/plans/2026-11-05-rolekit-direction.md';

const RULE_FORMAL = [
  '0. Schedule: rows are checked against the frozen schedule (arm x seat x role x task x rep from this design and tasks/manifest.json). A row outside it or a duplicate row is refused; a scheduled cell with no row counts as infra. All comparisons use exact rational arithmetic; rounded numbers in the report are display only.',
  'Primary seat = weak1 (Haiku 5.5) for arms A, B, C; arm D = strong seat (Sonnet) with the current brief. Only rows with infra=false count.',
  '1. Infra gate: if infra or missing cells exceed 5% of the scheduled cells of any arm on its primary seat (weak1 for A, B, C; strong for D) after one re-run, the verdict is INCONCLUSIVE_INFRA and nothing else is computed. Infra on weak2 is reported and never blocks the verdict.',
  '2. Per role r and arm X, s_X(r) = mean over tasks of (mean over reps of pass). A task with no non-infra row in any of A, B, C, D is dropped from that role in all arms.',
  '3. Headroom: if s_D(r) - s_A(r) < 0.15 the role is "no_headroom": it is reported and counts neither as a pass nor as a fail.',
  '4. gap_closed(r) = (s_B(r) - s_A(r)) / (s_D(r) - s_A(r)).',
  '5. Discordant pairs B vs C: over (task, rep) cells present in both arms, b = #(B pass, C fail), c = #(B fail, C pass). B_beats_C(r) iff b > c and the exact one-sided binomial tail P(X >= b | n = b + c, p = 0.5) <= 0.10.',
  '6. role_pass(r) = headroom ok AND gap_closed(r) >= 0.50 AND B_beats_C(r).',
  '7. harm(r) = s_B(r) - s_A(r) <= -0.10.',
  '8. Verdict: SHIP_CANDIDATE iff the number of role_pass roles >= 3 AND no role has harm; otherwise NOT_SHIP. The second weak seat (weak2, kimi) is computed with the same arithmetic but reported in a separate table (weak2_report) and is read by nothing in rules 1 to 8: it can neither confirm nor veto the verdict.',
].join('\n');

const RULE_PILOT = [
  'The pilot checks the instrument and never emits SHIP_CANDIDATE or NOT_SHIP. Verdict PILOT_OK iff every gate below holds, else PILOT_FIX with the failing gates listed.',
  'G1 infra: infra rows <= 10% of all scheduled cells and <= 25% in any arm x role.',
  'G2 kit applied: for >= 95% of B and C rows, kit_applied is true (the runner confirmed the system prompt marker, the tool list and the plugin skill match the compiled kit); a B or C row with kit_applied=false is an infra row.',
  'G3 parse: parse_ok is true for >= 50% of the non-infra rows in every arm A, B, C, D.',
  'G4 headroom: s_D(r) - s_A(r) > 0 for >= 3 roles, and s_A(r) < 1.0 for >= 4 roles (no ceiling), and s_D(r) > 0 for >= 4 roles (no floor).',
  'G5 cost: every submitted row has a finite non-negative cost_usd (a missing or invalid cost fails the gate, it is never read as 0), and the sum <= 1.5 x the high estimate of cost-table for this row; the per-role mean cost_usd per cell is written to the pilot report for the formal estimate.',
  'G6 checks: the evidence file written by collect-evidence.js (it runs the unit tests itself) shows tests > 0, pass == tests, fail == 0, a passing negative-control test for each of reviewer, implementer, verifier, planner, debugger, explorer, score-rolekit, compile-kit, stamp-rolekit, the full set of test files, sentinel_calls == 0, and an artifact_sha256 equal to the identity (sha256 over every file under evals/rolekit/ including the tests, see lib-identity.js) of the tree being scored, which the collector derives itself; a missing or failing evidence file fails the gate.',
].join('\n');

function common(row, isPilot) {
  const tasksByRole = isPilot
    ? { planner: 3, implementer: 3, reviewer: 3, verifier: 3, debugger: 3, explorer: 3 }
    : { planner: 10, implementer: 8, reviewer: 20, verifier: 20, debugger: 10, explorer: 10 };
  const seatsABC = isPilot ? ['weak1'] : ['weak1', 'weak2'];
  const reps = { A: {}, B: {}, C: {}, D: { strong: 1 } };
  for (const a of ['A', 'B', 'C']) for (const s of seatsABC) reps[a][s] = 2;
  const design = {
    roles: ROLES,
    tasks_by_role: tasksByRole,
    arms: [
      { id: 'A', name: 'current brief', seats: seatsABC, kit: null, tools: 'production default for the rail' },
      { id: 'B', name: 'role kit', seats: seatsABC, kit: 'kits/<role>', tools: 'kits/<role>/tools' },
      { id: 'C', name: 'placebo kit', seats: seatsABC, kit: 'placebo/<role>', tools: 'kits/<role>/tools (same list as B: C isolates the content, not the tool surface)' },
      { id: 'D', name: 'strong model + current brief (ceiling)', seats: ['strong'], kit: null, tools: 'same as A' },
    ],
    seats: {
      weak1: 'Haiku 5.5 (claude)',
      weak2: isPilot ? 'not run in the pilot' : 'kimi (kimi-code 2.3.0), PM ruling 2026-11-05. Arms B and C use the kimi variant kits (kimi/kits/<role>, kimi/placebo/<role>): the method is written into the card because a custom kimi agent cannot read plugin skills or AGENTS.md; the card cap is 4096 bytes. Own subscription quota.',
      strong: 'Sonnet (claude), arm D only',
    },
    reps,
    task_prompt: 'tasks/<role>/<id>/prompt.md is byte-identical in all arms; it ends with a one-line list of the top-level keys of the final JSON. Arms differ only in system prompt, plugin and tool list.',
  };
  const cost = compute(design);
  const capUsd = isPilot ? 15 : 75;
  return { design, cost, tasksByRole, capUsd };
}

function build(row) {
  const isPilot = row === 'pilot';
  const { design, cost, capUsd } = common(row, isPilot);
  const prereg = {
    row: `rolekit-${row}`,
    status: 'draft',
    stamped: false,
    stamp: null,
    note: 'DRAFT. Not stamped. The PM stamps it with `node evals/rolekit/stamp-rolekit.js --row ' + row + '` before any real cell runs. After stamping any edit to a frozen file voids the row.',
    plan: PLAN,
    decisions: ['operator d-c76529c3 (2026-11-05): go; subscription billing only; 75 USD cap; pilot first, the PM decides the formal run', 'real-model cells start only after G37 account registration (d-2a19fdb5)'],
    precedent: 'skill-transport 2026-07-15: a skill-body pack gave a weak reviewer no gain (H2 refuted, haiku delta -1 vs placebo delta -1). This row tests the whole kit: narrowed skill, fixed output shape, tool list, machine-checked output, with a same-length placebo.',
    hypotheses: [
      { id: 'H1', text: 'For the same weak model and task set, the role kit (B) closes at least 50% of the gap between the current brief (A) and the strong-model ceiling (D) on at least 3 of the 6 roles.' },
      { id: 'H2', text: 'On those roles B beats the same-length placebo kit (C) by the discordant-pair test: the gain is the kit content, not extra words.' },
      { id: 'H3', text: 'No role gets worse with the kit (B - A > -0.10 on every role).' },
      { id: 'H4 (secondary, never decides)', text: 'The effect repeats on kimi (kimi-code 2.3.0), a weak seat from another model family; reported in weak2_report, not in the verdict.' },
    ],
    design,
    metrics: {
      cell_pass: 'Each cell yields pass in {0,1} from its machine check (checks/check-cell.js, exit 0 = pass, 1 = miss, 2 = infra). Rates are means of pass.',
      per_role: {
        reviewer: { primary: 'defect catch: verdict FIX and a critical/major finding that matches the case predicate and cites a line inside a diff hunk', secondary: ['false_must_fix count (critical/major findings that do not match and cite no real line)'], source: 'evals/skill-transport/match-eval.js predicate rule, evals/known-bad' },
        implementer: { primary: 'task oracle.sh exits 0 AND red/green evidence valid (red exit != 0, green exit == 0) AND no protected path touched', secondary: ['files_changed vs git status'], source: 'evals/orchestration/tasks/*/oracle.sh' },
        verifier: { primary: 'va grader outcome pass: declared results match the contract oracle and the clean twin, and the defect twin deviates somewhere', secondary: ['malformed_plan / budget_exceeded / declared_mismatch / missed_defect shares'], source: 'evals/va-eval-generator.js, evals/va-eval-grader.js gradeCase' },
        planner: { primary: 'plan skeleton check: six elements, runnable acceptance, scopes exist and parallel scopes disjoint, request areas covered, dependency edge where required, no cycle, risks have dispositions', secondary: ['subtask count'], source: 'checks/check-cell.js checkPlanner' },
        debugger: { primary: 'hypothesis hit: root_cause file, line window and claim wording match the planted cause, >= 2 decided hypotheses, repository untouched', secondary: ['decoy_blamed'], source: 'checks/check-cell.js checkDebugger' },
        explorer: { primary: 'all questions right: found/absent as expected and every positive answer has a citation whose line really holds the quoted text', secondary: ['score = fraction of questions right'], source: 'checks/check-cell.js checkExplorer' },
      },
    },
    estimators: {
      gap_closed: '(s_B - s_A) / (s_D - s_A) per role',
      discordant_pairs: 'B vs C over (task, rep) cells; exact one-sided binomial tail on b of b + c at p = 0.5, alpha 0.10',
    },
    verdict: {
      rule: isPilot ? RULE_PILOT : RULE_FORMAL,
      script: 'evals/rolekit/score-rolekit.js',
      params: isPilot
        ? { infra_total_max: 0.10, infra_arm_role_max: 0.25, kit_applied_min: 0.95, parse_ok_min: 0.5, roles_with_headroom_min: 3, roles_below_ceiling_min: 4, roles_above_floor_min: 4, cost_factor_max: 1.5 }
        : { infra_arm_seat_max: 0.05, headroom_min: 0.15, gap_closed_min: 0.5, discordant_alpha: 0.10, harm_delta: -0.10, roles_pass_min: 3 },
    },
    exclusions: [
      'A task whose frozen files no longer match tasks/manifest.json is excluded before the run and the row is void until restamped.',
      'A cell with infra=true is never scored as a miss and never as a pass; it is re-run once, and a second infra stays infra.',
      'No cell is dropped for being a bad answer: parse failure, wrong schema and wrong content all score pass=0.',
    ],
    infra_failure: [
      'auth or quota error from the runner (the campaign stops at the first one, exit 4 like the skill-onoff runners)',
      'runner crash, timeout with no model output, empty transcript',
      'kit not applied: init system prompt, tool list or plugin skill differs from the compiled kit (kit_applied=false) in a B or C cell',
      'check-cell.js exit 2 (task files missing, workdir not a git repo, oracle cannot run, verifier case drifted from its frozen envelope)',
    ],
    cost: {
      billing: 'subscription only; no API-key path',
      cap_usd: capUsd,
      cap_note: isPilot ? 'pilot-own cap; the pilot spend counts against the 75 USD A/B total' : '75 USD total for the whole A/B, pilot spend included (operator d-c76529c3)',
      estimate_usd_low: cost.total.usd_low,
      estimate_usd_high: cost.total.usd_high,
      estimate_usd_high_with_margin: cost.with_margin_high,
      cells: cost.total.cells,
      table: `COST-TABLE-${row}.md`,
      stop_loss: isPilot
        ? ['stop the campaign when booked cost reaches cap_usd', 'stop and report when the first 30 cells cost more than 2x their share of the high estimate']
        : ['stop the campaign when booked cost reaches cap_usd', 'after 10% of the cells, stop and report if the projected total exceeds cap_usd', 'a stop is recorded as INCONCLUSIVE_INFRA with the cells done; it is never silently resumed past the cap'],
    },
    freeze_files: ['kits', 'placebo', 'kimi', 'tasks', 'checks', 'cost-model.json', 'cost-table.js', 'compile-kit.js', 'score-rolekit.js', 'collect-evidence.js', 'stamp-rolekit.js', 'lib-identity.js', `prereg/${row}.json`, `COST-TABLE-${row}.md`, ...(isPilot ? [] : ['prereg/preconditions-formal.json'])],
    stamp_with: `node evals/rolekit/stamp-rolekit.js --row ${row}   (then --check)`,
  };
  if (!isPilot) {
    prereg.preconditions = [
      { id: 'real-check-weak1', seat: 'weak1 (Haiku 5.5)', text: 'Before the formal run, one minimal real-model call per kit shows the model follows the role card: a throwaway copy of the compiled card carries a nonce instruction; the evidence is the runner session record (system prompt hash and tool list equal the compiled kit, kit_applied=true) plus a reply that contains the nonce. Needs G37 account registration (d-2a19fdb5).' },
      { id: 'real-check-weak2', seat: 'weak2 (kimi-code 2.3.0)', text: 'The same check, done the same way, on kimi with the kimi variant kit (--agent-file, tools in the agent file). The spike so far proves injection and the tool list from the session record only; whether the model follows the card is unverified.' },
    ];
    prereg.preconditions_gate = 'stamp-rolekit.js refuses to stamp this row unless prereg/preconditions-formal.json lists every precondition id with met=true and a non-empty evidence path; the file is part of the frozen set. A cost of these calls counts against the 75 USD cap.';
    prereg.seats_not_used = [{ seat: 'flash (agy 1.5.0, Gemini Flash)', status: 'unproven', reason: 'without credentials agy cannot create a request (it asks for OAuth first), so neither the injected card nor the tool list can be observed; a non-empty tool allowlist cannot be discovered with zero calls; the old empty-allowlist evidence is from earlier agy versions. Not a candidate until a verified check exists.' }];
    prereg.task_set = {
      status: 'NOT FROZEN: only the 18 pilot tasks exist (tasks/manifest.json). The formal task set must be frozen the same way (build-tasks.js) before stamping.',
      reviewer: '20 = evals/known-bad 01..13 (13 planted defects) + 7 of evals/clean 01..11 (clean controls: pass = no critical/major finding)',
      implementer: '8 = evals/skill-transport/implementer-tasks.json (t1 t3 t4 t7 t8 t11 t13 t15) with their oracle.sh',
      verifier: '20 = va-eval-generator cases from seed rolekit-pilot-v1 (24 per administration; pick by sorted case id, drop the 4 last)',
      planner: '10 = the 3 pilot requests + 7 to author from evals/skill-onoff/tasks L-size tasks',
      debugger: '10 = the 3 pilot symptoms + 7 to author over evals/orchestration/tasks bug repos',
      explorer: '10 = the 3 pilot question sets + 7 to author',
      deviation_from_plan: 'the plan says 20 tasks per role; implementer is 8 (that is the size of the frozen implementer set) and planner/debugger/explorer are 10 (the plan says 10 for planner and debugger).',
    };
  }
  return { prereg, cost };
}

for (const row of ['pilot', 'formal']) {
  const { prereg, cost } = build(row);
  fs.writeFileSync(path.join(__dirname, `${row}.json`), `${JSON.stringify(prereg, null, 2)}\n`);
  fs.writeFileSync(path.join(__dirname, '..', `COST-TABLE-${row}.md`), markdown(row, cost, prereg.cost.cap_usd));
  console.log(`${row}: ${cost.total.cells} cells, ${cost.total.usd_low}..${cost.total.usd_high} USD (x1.5 = ${cost.with_margin_high})`);
}
