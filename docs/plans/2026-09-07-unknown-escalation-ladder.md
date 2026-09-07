# Plan — Unknown-escalation ladder (turning "I'm stuck" into a measured signal)

> Status: 📝 Draft R0 — not yet plan-reviewed; owner discussion pending
> Owner: cookys (Board) · Author: autopilot session, 2026-09-07
> Branch: none yet (proposed `feat/unknown-escalation-ladder`)
> Frame: dev-flow L (six S/Fix phases behind one plan). Owner question 2026-09-07 「應該怎樣設計以擴大解決未知問題的能力」.
> logical_plan_id: `unknown-escalation-ladder`

## 0. Context / thesis

Today autopilot has three ways to reach outside the current session for help, and each is keyed
on a *known* structure:

| Route | Trigger today | Where defined | Enforcement |
|---|---|---|---|
| Web research (`survey`, `research-to-ship`) | user says "survey"; other skills may *suggest*; CEO mode may invoke on judgment | `skills/survey/SKILL.md` Trigger + Boundary ("No auto-trigger"); `skills/ceo-agent/SKILL.md` step 7 + DOA table | LLM judgment only |
| Hetero engine (plan loop, per-phase review, `/l5` `/l6`) | dev-flow size predicate (Fix/S/L/H) and FIX-THEN-SHIP verdicts | `skills/dev-flow/SKILL.md` Quick Decision; `skills/hetero-review/SKILL.md`; `review-loop-config.md` knobs | scripts + receipts (`hetero-review-loop.js`, `check-phase-review-receipt.js`) |
| Consult seat (`dispatch-consult.sh`) | debug: after 2 failed hypotheses; dev-flow: before L-2 design; think-tank: single bounded question | `references/hetero-dispatch.md` Hook points; `skills/debug/SKILL.md`; `skills/dev-flow/references/hetero-loops.md` | condition recognised by the LLM (nothing counts), dispatch itself deterministic |

None of them fires on the property that actually characterises an unknown problem: the session
does not know the shape, does not know whom to ask, and does not notice it is stuck. The size
predicate is decided at L-0 before anything is known; the "two failed hypotheses" rule has no
counter; the survey signal table is suggestion-only. The most autonomous modes (`/l4`–`/l6`, where a
foreman runs dev-flow unattended) have the *least* research capability: `skills/dev-flow/SKILL.md`
contains no survey or consult step, so a foreman can only escalate at a DOA boundary.

The thesis: make uncertainty observable with cheap deterministic signals, route each kind of
unknown to the rung that fits it, climb a budgeted ladder with receipts, and close the loop by
writing what was learned back so the same unknown becomes a rung-0 hit next time. That last step is
the actual capability expansion; everything else is plumbing.

External input (OpenAI "GPT-6 Astra prompting guide", `developers.openai.com/api/docs/guides/latest-model`,
read 2026-09-07 via the-decoder summary + the guide itself):

- "Before asking the user clarifying questions, complete the work that is already authorized from
  context and necessary to make the proposed action concrete and reviewable." Read-only, reversible
  work needs no pre-approval. ⇒ The ladder's bottom rungs are read-only and must not ask first.
- "The model tends to respond well to prompting for how and when it should delegate … spell out when
  and how much." ⇒ Trigger conditions must be explicit numbers, not "when appropriate".
- Testing calibrated to risk: "broaden or repeat testing only when new changes, failures, or
  unresolved concerns justify it." ⇒ Ladder climb cost must be proportional to the signal, and
  the stall fuse already exists for the over-testing shape.
- Skill-file conflicts cause silent blocking; the remedy is "name and link to the exact SKILL.md
  file, quote the relevant instruction." ⇒ Every ladder stop names the rule and the receipt that
  caused it (§4 P2). The guide offers no escalation ladder at all; it treats blocking as a
  prompt-clarity defect. This plan disagrees for the autonomous case: a foreman with no operator in
  the loop needs a mechanical path from "stuck" to "asked the right thing", not better prose.

External input (Anthropic "Prompting Claude Fable 5.1",
`platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1`, read 2026-09-07):

- "Search triggering at low effort": at `low` effort the model answers from memory instead of
  searching; "recognizing a name isn't the same as knowing its current state … familiarity is not a
  reason to skip the search." ⇒ Two plan consequences: S4 novelty gets an explicit cue class
  (an unrecognised name, or a name from a fast-moving area such as models and developer tools), and
  every U2 dispatch carries an effort floor of `medium` — a low-effort survey seat is a seat that
  will not search (§3 rungs, P6).
- "Finish the whole task": "first do everything that doesn't depend on the answer; then … put the
  question at the end of a turn that also delivers that progress." Same U4 shape as Astra's
  "concrete, reviewable result"; both vendors converge, so U4 is defined that way (§3).
- "A signal that pattern-matches to a known failure may have a different cause." ⇒ The probe never
  acts on a signal alone; it attaches the evidence rows and the recommendation is a rung, not a fix.
- Compaction summaries must preserve "difficulties … and how they were handled" and "approaches …
  tried, or set aside, and why." That is exactly the `hypothesis` / `ladder` ledger rows; P1 adds
  them to what `compaction-rehydrate.js` / `state-checkpoint` re-inject, so a climb survives
  compaction instead of being retried from scratch.
- "Let the lead agent keep working while subagents run." ⇒ U2 inside a foreman round is a
  background dispatch; the round continues on independent work and reads the result at round end
  (P4).
- "Keep changes and tests to what the task asks for." ⇒ S4 terms come from the task brief only;
  a novelty hit on something the task did not ask about is reported as a follow-up, never a climb
  (§6 risk).

### 0.5 Contradictions found in the current definitions (each resolved in a phase)

| # | Contradiction | Resolution |
|---|---|---|
| C1 | `skills/debug/SKILL.md` step 4: after the 2nd failed hypothesis **call the consult seat**. `agents/debugger.md` PUA Trigger: after the 2nd failure **write 3 new hypotheses yourself** and "Never call another agent" (line 193). The same event has two different prescribed reactions depending on whether debug runs inline or as the dispatched agent. | P0: the agent stays dispatch-free (blind-dispatch rule); its handoff carries the `hypothesis` ledger rows so the *caller* (debug skill, depth 0) makes the consult call. Same counter, one decision point. |
| C2 | `skills/survey/SKILL.md` Boundary: "**No auto-trigger** — signal only suggests, user confirms." `skills/ceo-agent/SKILL.md` step 7: "Need research? → **Autonomously** invoke autopilot:survey." | P0: reword survey's boundary to "no auto-trigger in participatory modes; in just-results modes the caller may invoke without confirmation and must record the decision" — which is what CEO already does. The absolute wording is the bug. |
| C3 | "Consult before design" for every L task lives only in `skills/dev-flow/references/hetero-loops.md`; `skills/dev-flow/SKILL.md` L-2 never references it (grep `consult` → 0 hits in the step list). A rule in a reference that the step list does not call is the "script exists ≠ script runs" shape from `references/evidence-discipline.md`. | P3: add the call to L-2 as a step with a receipt; P0 marks the reference line as canonical pointer, not a second statement. |
| C4 | `survey` Signal Detection lists "Uncertainty: `TBD`, `undecided`, `pending` in plans" as a trigger; `references/plan-template.md` §4 forbids `TBD` in load-bearing steps and `completeness-scan.sh` rejects it. The signal is defined on a state the pipeline refuses to produce. | P0: replace that row with the ladder's `unknown-how` / `unknown-whether` signals (§3 S4, S5); a plan that reaches review has no `TBD` to detect. |
| C5 | `consult_dispatch: auto` with a zero-seat topology falls back to `sonnet/high@claude-native` and still calls it a consult (`review-loop-config.md` knob table). A same-family, same-context "outside opinion" is not outside anything; the receipt says `native-fallback` but the calling skill's prose still says "outside opinion". | P2: the ladder receipt records `heterogeneous: false` on native fallback and the probe's recommendation skips U1 straight to U2 (web research is the cheapest genuinely-outside source when no hetero seat exists). Knob semantics unchanged. |
| C6 | Astra guide: ask only with a concrete reviewable result. `survey` suggestion template asks "Proceed?" **before** doing any work. | Owner ruling 2026-09-07 (Q1): the ladder is a switch, **default on** in every mode. U2 climbs without asking, within budget; the suggestion template survives only when the knob is `off` or the budget is exhausted. |
| C7 | `finish-flow` makes `learn` mandatory only for H (H-9.4) and retry≥2 (S.1); L-5.6 says "if warranted". A resolved unknown at rung ≥1 is by definition non-trivial, yet nothing routes it to `learn`. | P5: any ladder receipt with `resolved_at_rung ≥ 1` makes L-5.6 / S.1 learn mandatory, with the receipt's key terms pre-filled so the next S4 probe hits. |
| C8 | `/l4`–`/l6` foreman runs dev-flow "unattended" and dev-flow has no research/consult step; `level-front-door.md` says "should I continue?" is NOT an escalation trigger and the run stops only at DOA/irreversible/input. So a foreman that is stuck on an unknown has no sanctioned move except burning rounds until the stall fuse trips or `loop_max_rounds` halts. | P4: the foreman round-end report reads the probe; U1–U2 are within CEO DOA (read-only, budgeted); `[ESCALATION]` to depth 0 carries the ladder receipts as the "concrete reviewable result". |

### 0.6 Known vs unknown (what this plan can assert today)

| Known (verified 2026-09-07) | Unknown (must be measured or decided) |
|---|---|
| The four trigger definitions and their enforcement split (table in §0). | Real-world false-positive rate of each signal (§3) — no data until P1 ships and runs. |
| `decision-ledger.js` is append-only JSONL with typed rows and a round-end report; adding row kinds is additive. | Whether a self-reported `unknown` row without a mechanical co-signal should be allowed to climb (Q3). |
| `check-stall-fuse.js` and `check-loop-convergence.js` exist and are consumed by `level-front-door.md` / `check-blueprint-conformance.js`; they already encode "not converging". | Right default budgets per rung (Q2). Start conservative, tune from receipts. |
| `consult_dispatch` / `plan_review` / `hetero_review` share tri-state semantics; a fourth knob can copy them verbatim. | Whether kimi/opencode/codex seats are qualified for a `consult` role on the target host (topology-dependent; `native-fallback` handles absence). |
| `.claude/knowledge/INDEX.md` + memory dir are the only rung-0 sources; `identifier-scan.js` is a PII lint, **not** a novelty detector and must not be reused for S4. | Whether the foreman's `[ESCALATION]` consumer at depth 0 needs a new field or reuses `refs[]` (P4 decides after reading the current payload shape). |

## 1. Problem

When a task turns out to be an unknown — no known approach, a bug that resists two hypotheses, a
decision with no consensus — the session either flails (rounds without product delta), asks the
owner too early with nothing reviewable, or silently narrows scope. The cheap outside sources
(knowledge, consult, web, multi-perspective) exist but are reached by judgment, unevenly, and not at
all from a foreman. The owner wants the system to *expand* its ability to resolve unknowns, which
means: detect earlier, route correctly, spend proportionally, and remember.

## 2. OKR / KRs

**Objective**: an autopilot session that hits an unknown climbs a bounded, receipted ladder to the
cheapest source that can resolve it, and the next session with the same unknown resolves at rung 0.

- **KR1** Every consult / survey / think-tank invocation made *autonomously* (CEO, `/l3`+, foreman)
  carries a ladder receipt naming the signal that justified it (`signal` ≠ `judgment-only`).
  Measured by `probe-unknown.js report` over a project's receipts: 100% of autonomous climbs.
- **KR2** The debug "two failed hypotheses" rule is a counter, not prose: `decision-ledger.js` holds
  `hypothesis` rows, and the probe recommends U1 at `refuted ≥ 2`. Test: a ledger with two refuted
  rows ⇒ `recommend: U1`; one refuted ⇒ `recommend: none`.
- **KR3** A `/l4`–`/l6` foreman can climb U0–U2 within its round budget without depth-0 involvement,
  and an `[ESCALATION]` to depth 0 for an unresolved unknown includes the receipts. Verified by one
  dogfood run whose ledger shows a U2 climb inside a foreman round.
- **KR4** Repeat-unknown rate is measurable: `probe-unknown.js report` prints, per key-term set, how
  many times it climbed above U0 across receipts; the number exists after P5 even if the baseline
  is 1 run.
- **KR5** The ladder never blocks: no hook Stop decision, no exit≠0 that halts a phase. Same posture
  as `dispatch-model-guard` `mode: remind` and the dirty-tree hook (owner rulings 2026-09-06/07).
  Test: probe exits 0 on every classification; only `--strict` (opt-in, for CI) exits non-zero.
- **KR6** Zero trust machinery (ADR-0001): receipts are plain telemetry; the independent check is
  the round-end report cross-referencing dispatch manifests, exactly as `decision-ledger.js` does.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Node ≥ 20.10, built-ins only; no new npm dependencies.
- New scripts emit one JSON object on stdout, human lines on stderr, exit 0 on any classification; non-zero only for usage errors or `--strict`.
- Ladder receipts are append-only JSONL rows in the existing decision ledger file (`kind: unknown | hypothesis | ladder`), never a second ledger.
- The ladder never emits a hook Stop decision and never halts a phase; it recommends, records, and (in `auto`) dispatches through the existing rails only.
- Rung dispatches go through the existing scripts unchanged: `dispatch-consult.sh`, the `survey` skill, the `think-tank` skill. No new seat, no new transport.
- Severity vocabulary stays `🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion`; the ladder uses rung ids `U0..U4`, not a new severity.
- `identifier-scan.js` is not a novelty detector; S4 uses its own term lookup.
- Knob `unknown_escalation` copies the `consult_dispatch` tri-state semantics byte-for-byte (`off` ⇒ opt-out receipt + `capability_warnings`; `on` ⇒ explicit budgets required; `auto` default = on with default budgets). Owner ruling 2026-09-07: a switch, default on, in participatory and just-results modes alike.

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only` — new knob defaults to `auto` and every consumer treats a missing knob as `auto`; existing ledgers without `hypothesis` rows classify as "no signal". No consumer sees a changed contract.
- **Dependency decision**: `none` — everything is built on `decision-ledger.js`, `check-stall-fuse.js`, `check-loop-convergence.js`, `resolve-review-loop.sh`, `dispatch-consult.sh` and the three skills. No new library satisfies anything the built-ins cannot.

## 3. File-structure map

**Signals** (all read by the probe; none new except the ledger row kinds):

| id | Signal | Source | Kind of unknown it evidences |
|---|---|---|---|
| S1 | refuted hypotheses ≥ 2 | `decision-ledger.js` rows `kind: hypothesis, status: refuted` (new kind) | unknown-why |
| S2 | review loop not converging | `check-loop-convergence.js --json` (same finding fingerprints across ≥2 generations, or rounds ≥ `loop_max_rounds − 1`) | unknown-why (impl) / unknown-whether (design) |
| S3 | stall fuse tripped | `check-stall-fuse.js check` result | unknown-why |
| S4 | novelty: key terms with zero hits, or a term the caller flags as an unrecognised / fast-moving name (`--fast-moving`) | new lookup over `.claude/knowledge/INDEX.md` + memory dir + `git grep` of the repo, terms supplied by the caller from the task brief only (`--terms a,b,c`) | unknown-how |
| S5 | decision without consensus | think-tank Decision Brief `consensus: LOW` (already the dialectic escalation input) | unknown-whether |
| S6 | self-report | `decision-ledger.js` row `kind: unknown {type, rationale}` written by the agent | claim only (ADR-0001) — may justify U1, never U2+ alone (Q3) |

**Rungs**:

| Rung | Source | Cost | Auto in participatory | Auto in just-results |
|---|---|---|---|---|
| U0 | local knowledge + memory + repo grep (S4 lookup doubles as the search) | zero | yes | yes |
| U1 | consult seat, one bounded question (`dispatch-consult.sh`) | one call | yes (read-only, reversible — Astra rule) | yes |
| U2 | web research: `survey` (unknown-how) or its new `issue-search` mode (unknown-why: search the exact error/finding string); effort floor `medium` on the seat | two agents | yes, budgeted (owner ruling Q1) | yes, budgeted, background inside a foreman round |
| U3 | multi-perspective: `think-tank` (unknown-whether), `think-tank-dialectic` per existing LOW-consensus rule, or debugger PUA for unknown-why | many | yes, budgeted | yes, budgeted |
| U4 | owner, with the receipts as the concrete reviewable result | human | always | always |

Routing by kind: unknown-how U0→U1→U2→U4; unknown-why U0→U1→U2(issue-search)→U3(PUA)→U4;
unknown-whether U0→U1→U3→U4. C5 rule: if U1 resolves to `native-fallback`, the recommendation
skips to U2 with `skipped_rungs: [U1], reason: not-heterogeneous`.

**Files**:

| File | Responsibility |
|---|---|
| `scripts/probe-unknown.js` (new) | `classify` (read signals → `{unknown_type, signals[], recommend: U0..U4, budget_left}`), `receipt` (append `kind: ladder` row), `report` (aggregate receipts for KR1/KR4). Node, built-ins only. |
| `scripts/decision-ledger.js` | add row kinds `hypothesis {hypothesis_id, round, text, status: open\|refuted\|confirmed, evidence_refs[]}`, `unknown {type, rationale}`, `ladder {rung, signal_ids[], dispatch_run_id?, resolved: bool, heterogeneous: bool}`; round-end report gets a "Ladder" section. |
| `scripts/resolve-review-loop.sh` + `project-config-template/review-loop-config.md` | knob `unknown_escalation: auto\|on\|off` + `unknown_budget_u1/u2/u3` (calls or minutes), same tri-state prose as `consult_dispatch`. |
| `scripts/dispatch-consult.sh` | accept `--ladder-receipt <ledger>` so the U1 call stamps the receipt itself (dispatch and receipt in one place, like the consult switch resolution today). |
| `skills/debug/SKILL.md` | step 3 writes `hypothesis` rows; step 4 calls `probe-unknown.js classify` and consults only on `recommend: U1`. |
| `agents/debugger.md` | PUA section: emit `hypothesis` rows in the handoff; keep "never call another agent"; state that the caller consults (C1). |
| `skills/dev-flow/SKILL.md` | L-1 step 4 runs the S4 lookup with the task's key terms; L-2 gains the consult-before-design step with receipt (C3); Quick Decision table gets one line pointing at the ladder. |
| `skills/dev-flow/references/hetero-loops.md` | "Consult before design" becomes the pointer to the L-2 step; ladder semantics section. |
| `skills/survey/SKILL.md` | Boundary reworded (C2); Signal Detection table replaced by S4/S5 pointer (C4); new `issue-search` mode (P6). |
| `skills/ceo-agent/SKILL.md` + `references/level-front-door.md` | step 7 "Need research?" becomes "probe says U2 or judgment (recorded)"; foreman round-end reads the probe; DOA table lists U1–U2 as within CEO DOA. |
| `skills/think-tank/SKILL.md` | Decision Brief writes S5 into the ledger. |
| `skills/finish-flow/SKILL.md` | L-5.6 / S.1: learn mandatory when a ladder receipt has `resolved: true` at rung ≥ 1 (C7). |
| `references/hetero-dispatch.md` Hook points | one canonical list of ladder call sites (replaces the four prose bullets). |
| `hooks/tests/probe-unknown.test.sh`, `hooks/tests/decision-ledger.test.sh` (extend) | fixtures: 0/1/2 refuted; stall tripped; convergence stuck; zero-hit terms; native-fallback skip; `off`/`on`/`auto`. |
| `docs/scripts-inventory.md`, `CLAUDE.md` grouped list, `skills/*/SKILL.md` Available Scripts rows | the four-place wiring rule. |
| `CHANGELOG.md`, `docs/projects/<date>-unknown-escalation-ladder/` | release + tracking. |

## 4. Phases

### P0 — Reconcile the definitions (no bump; docs only)
Fix C1, C2, C3 (pointer half), C4 in prose before any code, so the code lands on consistent rules.
- `agents/debugger.md` PUA: add "emit `hypothesis` rows in `### Handoff`; the caller decides whether to consult" after line 83; keep line 193 verbatim.
- `skills/survey/SKILL.md` Boundary: replace "No auto-trigger — signal only suggests, user confirms" with "No auto-trigger in participatory modes (suggest, user confirms). In just-results modes (`ceo-agent`, `/l3`+) the caller may invoke without confirmation and records the decision (ledger or CEO Report)."
- `skills/survey/SKILL.md` Signal Detection: drop the `TBD/undecided/pending` row; add "Novelty / no-consensus signals are computed by `scripts/probe-unknown.js` (P1); this table lists the phrasing cues only."
- `skills/dev-flow/references/hetero-loops.md` "Consult before design": prefix "Canonical step is dev-flow L-2 (P3); this section documents the rail."
- **Acceptance**: `grep -n "No auto-trigger" skills/survey/SKILL.md` shows the qualified sentence; `doc-drift-gate.js` clean; no code touched.

### P1 — Signals and the probe (S)
- `scripts/decision-ledger.js`: add the three row kinds with schema validation in `append`; round-end report prints a `Ladder` section (rows of `kind: ladder` in this round, plus refuted-hypothesis count). Existing rows unaffected (`schema_version` stays 1; kinds are additive).
- `scripts/probe-unknown.js`:
  - `classify --ledger <file> [--convergence <json>] [--stall <json>] [--terms a,b,c] [--knowledge-dir <dir>] [--memory-dir <dir>] [--repo-root <dir>] [--json]`
    → stdout `{unknown_type: how|why|whether|none, signals: [{id, value, evidence}], recommend: U0..U4|none, skipped_rungs: [], heterogeneous_u1: bool, budget: {u1, u2, u3, left}}`; exit 0 always; `--strict` exits 2 when `recommend ≥ U2` (CI use only).
  - `receipt --ledger <file> --rung Ux --signals S1,S3 [--run-id <id>] [--resolved]` → appends `kind: ladder`.
  - `report --ledger <file>|--project-dir <dir>` → `{climbs: [...], judgment_only: n, repeat_terms: {...}}` for KR1/KR4.
  - Thresholds are argv-overridable with documented defaults: `--refuted-threshold 2`, `--stall-threshold 3` (mirrors the fuse), `--convergence-generations 2`.
- `scripts/compaction-rehydrate.js` (and the `state-checkpoint` hook's re-inject set): include the current round's `hypothesis` / `unknown` / `ladder` rows, so a climb survives compaction (Fable guide, compaction section).
- Tests: `hooks/tests/probe-unknown.test.sh` with fixtures for every row of §3 Signals, both threshold edges, and a ledger with none of the kinds (⇒ `none`); a compaction-rehydrate fixture asserting the ladder rows are re-injected.
- Wire in all four places (reference doc, SKILL rows, inventory, CLAUDE.md group **Mission, campaign & session state**).
- **Acceptance**: KR2 test green; `check-claude-md-inventory.js` and `check-js-syntax.js` green; `probe-unknown.js classify` on an empty ledger prints `recommend: none` and exits 0.

### P2 — Knob, budget, receipt-on-dispatch (S)
- `review-loop-config.md`: `unknown_escalation: auto` (default on), `unknown_budget_u1: 2`, `unknown_budget_u2: 1`, `unknown_budget_u3: 1`. A budget counts climbs to that rung per **work unit**: one dev-flow phase for L/H, the whole task for S/Fix, one foreman round-set for `/l4`–`/l6`. Exhausting a rung's budget moves the recommendation to the next rung, never to a repeat. U1 is 2 because the common debug shape is consult → new evidence → one more bounded question, which is cheaper and more precise than U2; U2 is 1 because survey already runs two agents and a second survey means the question was wrong (⇒ U3 or U4). Documented in the knob table with the tri-state prose copied from `consult_dispatch`.
- `resolve-review-loop.sh --field unknown_escalation` (and the three budgets); missing ⇒ `auto` / defaults, never exit 3 for the budgets.
- `dispatch-consult.sh --ladder-receipt <ledger>`: after a successful dispatch, append the `kind: ladder` row with `rung: U1`, `heterogeneous: <resolved_from != native-fallback>`, `dispatch_run_id`. When the knob resolves `off`, the opt-out receipt is written (via `hetero-review-loop.js opt-out --knob unknown_escalation`) and the probe reports `recommend: none, reason: knob-off`.
- Every stop reason the probe emits names the knob or rule that produced it (`reason: knob-off | budget-exhausted | not-heterogeneous`) — the Astra "name the instruction" rule, applied to our own gates.
- Tests: `hooks/tests/resolve-review-loop.test.sh` extended; consult test asserts the receipt row.
- **Acceptance**: `off`/`on`/`auto` matrix test green; a consult run leaves exactly one ladder row; KR5 (exit 0 everywhere but `--strict`).

### P3 — Wire the inline skills (S)
- `skills/debug/SKILL.md`: step 3 "write each hypothesis as a `hypothesis` row (`decision-ledger.js append --kind hypothesis`), mark `refuted` with the evidence ref when it fails"; step 4 "run `probe-unknown.js classify --ledger …`; on `recommend: U1` call `dispatch-consult.sh --ladder-receipt …`; on `U2` run survey `issue-search` (P6) with the exact error string; on `U3` dispatch `autopilot:debugger` (PUA)". Available Scripts row updated.
- `skills/dev-flow/SKILL.md`: L-1 step 4 "run `probe-unknown.js classify --terms <key nouns from the task brief>`; record the result; `unknown_type: how` ⇒ U1 consult now, then U2 survey within budget"; L-2 new sub-step "consult before design (receipted)" replacing the reference-only rule (C3).
- `skills/think-tank/SKILL.md`: after the Decision Brief, append `kind: unknown {type: whether}` when consensus is LOW; the existing dialectic escalation rule is the U3 climb, unchanged.
- **Acceptance**: each SKILL has one probe call site with the exact argv; `hetero-dispatch.md` Hook points lists the same three sites and nothing else; `check-canonical-invariants.sh` green.

### P4 — Foreman integration (S)
- `skills/ceo-agent/references/level-front-door.md`: round-end sequence gains "run `probe-unknown.js classify --ledger <round ledger> --convergence … --stall …`; U1–U2 within CEO DOA when budget left; U3 within DOA for `whether` only; U4 ⇒ `[ESCALATION]` with `ladder_receipts[]`."
- `skills/ceo-agent/SKILL.md` DOA table: row "Unknown escalation | climb U1–U2 (read-only, budgeted); U3 for design questions" under CEO Autonomous; step 7 reworded to cite the probe.
- `skills/l4/SKILL.md`, `l5`, `l6`: one line each — "foreman inherits the ladder; budgets from `review-loop-config.md`".
- The `[ESCALATION]` payload: reuse `refs[]` for receipt paths if the current template already carries refs; otherwise add `ladder_receipts[]` (decide by reading `references/task-prompt-templates.md` at implementation time; either way one field, documented once).
- **Acceptance**: KR3 dogfood: one `/l4` run on a seeded unknown (a task whose key terms have zero knowledge hits) shows a U2 ladder row inside a foreman round and no depth-0 involvement before U4.

### P5 — Close the loop (S)
- `skills/finish-flow/SKILL.md` L-5.6 and S.1: "if `probe-unknown.js report` shows any `resolved: true` row at rung ≥ 1, `autopilot:learn` is MANDATORY; pre-fill the entry with the receipt's `terms` and `unknown_type` so the S4 lookup hits next time." H-9.4 unchanged (already mandatory).
- `skills/learn/SKILL.md`: accept `--from-ladder <receipt>` (or the equivalent prose instruction) so the knowledge entry carries the terms verbatim.
- `probe-unknown.js report --project-dir` aggregates across a project's ledgers for `retro`.
- **Acceptance**: a fixture project with one resolved U2 receipt makes the finish-flow checklist print `learn: mandatory (ladder receipt …)`; KR4 number appears in `report`.

### P6 — `survey` issue-search mode (Fix)
- `skills/survey/SKILL.md`: mode `issue-search` — input is an exact error/finding string plus the runtime/version tuple; researcher searches the literal string as written (at least one query verbatim, per the Fable guide), skeptic checks version applicability; output is the existing survey table with a "matches our version?" column. Budget: one round, no second generation. Both survey modes state an effort floor of `medium` for the researcher/skeptic seats.
- **Acceptance**: mode documented with the prompt in `skills/survey/references/prompts.md`; one manual run on a known error string returns at least one source or the explicit "no public data" marker.

Dependency map: P0 → P1 → P2 → {P3, P4, P6} → P5. P3 and P4 are independent; P6 only blocks the U2 branch of P3's debug wiring.

## 5. Test / validation

Script-gated: P1/P2 fixtures (`hooks/tests/*.test.sh`), inventory/syntax/canonical gates, `preflight-release.sh`.
Human-gated: P4 dogfood run (owner reads the ledger), Q1–Q4 answers, and the P0 wording.
Per `references/evidence-discipline.md`: before recording any phase as verified, show the probe firing on a real ledger (not only the fixture), and show one autonomous climb receipt produced by the real rail, not by hand.

## 6. Risks + inversion

What would guarantee failure:
- **The probe is wired but never called** (the inventory caution). Mitigation: KR1 is measured from receipts, and P3/P4 acceptance requires a call site with exact argv; P4 dogfood must show a real row.
- **Signals fire on every task** (S4 zero-hit on any new noun). Mitigation: S4 alone only recommends U0/U1; U2 needs S4 plus a second signal (S1/S2/S3/S5), or an S4 fast-moving-name cue; thresholds are argv-overridable and the report exposes the false-positive rate.
- **The ladder becomes a blocker** in the name of rigour. Mitigation: KR5 exit-0 rule, remind-only posture, `--strict` opt-in only.
- **Consult is not heterogeneous** and the receipt hides it. Mitigation: `heterogeneous: false` is a first-class field and skips the rung (C5).
- **Foreman climbs cost money silently**. Mitigation: budgets are per-task integers in config, default 1 each; `cost-fuse` hook and the round ledger already surface spend.
- **Nothing is written back** and every session pays again. Mitigation: P5 makes learn mandatory on a resolved climb; KR4 makes the repeat rate visible.
- **The ladder widens scope**: an S4 zero-hit on a nearby thing the task never asked about triggers research. Mitigation: terms come from the task brief; a hit outside the brief is reported as a follow-up in the summary, never a climb.
- **Self-reported unknowns game the ladder** (an agent declares `unknown` to get a cheaper engine to do its thinking). Mitigation: S6 alone caps at U1; the round-end report lists S6-only climbs separately.

## 7. Out of scope

- New seats, transports, or engines. The ladder only orders and receipts what exists.
- Changing the PUA methodology in `agents/debugger.md` beyond the handoff rows.
- A hook that runs the probe on every tool call. Call sites are the three skills and the foreman round end; a hook can come later if receipts show the sites are missed.
- `brainstorm` wiring to any seat (already a BACKLOG candidate; unchanged).
- Trust machinery of any kind (ADR-0001).

## 8. Open questions (Board)

- ~~Q1~~ **Ruled 2026-09-07**: the ladder is a switch, default on in every mode (「做開關 預設要」).
- ~~Q2~~ **Ruled 2026-09-07**: budgets are climb counts per work unit; defaults U1=2, U2=1, U3=1 (owner asked whether 1 is too few; U1 raised to 2, rationale in P2).
- **Q3** May a self-reported `unknown` row (S6) with no mechanical co-signal climb past U1? Not yet ruled; plan proceeds on the recommendation **no** (it is a claim) until the owner says otherwise.
- ~~Q4~~ **Ruled 2026-09-07** (「up2u」): knob name `unknown_escalation`, matching the `*_dispatch` verbs already in the file.

## Review log

- R0 2026-09-07 author draft. Owner rulings same day: Q1 default on, Q2 budgets 2/1/1 per work unit, Q4 `unknown_escalation`; Q3 open on the recommended default. No manifest yet; plan-review (dispatch-plan-review, frozen rubric) to run after P0 wording is accepted.
