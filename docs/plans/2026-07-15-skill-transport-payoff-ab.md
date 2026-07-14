# Plan — skill-transport payoff A/B: does loading skills into headless workers sharpen them?

> Status: DRAFT (R0, awaiting review loop)
> Owner: depth-0 (cookys)
> Branch: TBD (`feature/skill-transport-ab` when execution starts)
> Frame: measurement experiment — the deliverable is a **decision with evidence**, not a feature. Any wiring change ships only if the data says so.

## 0. Context / thesis

Headless dispatch workers today run **without** autopilot's methodology: codex exec / grok / cc-shim get only the dispatch prompt; agy `-p` is a verified negative for skill loading; **pi RPC is the exception** (native `.agents/skills` auto-discovery, verified v2.32.21). The transport plumbing already exists and is idle: `dispatch-hetero.sh --skill-mode prompt --skill <name>` (prompt-pack), `engine-capability-state` records `skill_transport` per-field (native / prompt_pack), and the dogfood `review-loop-config.md` runs `skill_mode: off` — a deliberate, but **never-measured**, default.

The question became concrete on 2026-07-15 (/l5 lineage+directive runs): the haiku in-loop reviewer passed two Majors that the cross-family depth-0 panel caught (runsTree cycle-drop; IS_PI pretend-channel). Would a methodology pack have changed that — or is it a model-capability ceiling no prompt can fix?

**Thesis (falsifiable, stated before data):**
- **H1 (implementer arm)**: packing a skill into an implementer leaf adds ≤ marginal quality gain over the six-element prompt with pre-seeded verify requirements, at a real token cost. Prediction: no reduction in downstream-caught defects; cost overhead measurable.
- **H2 (reviewer arm)**: packing review methodology into a **weak** reviewer seat lifts its catch rate on planted-defect sets without raising over-flagging. Prediction: haiku sensitivity ↑ by ≥ 2 cases absolute; specificity flat. (If H2 holds, the low-risk fallback seat gets cheaper-but-sharper; if it fails, "structure beats prompt content" is confirmed and the question closes.)

Both arms may independently confirm or refute. An honest "H2 refuted" is a fully successful outcome — it closes a standing design question with data instead of belief.

## 1. Problem

We are paying for a structural compensator (3-seat cross-family qc panel) partly because in-loop reviewer seats are weak. If a ~free prompt-pack meaningfully sharpens weak seats, we are leaving quality on the table; if it does not, `skill_mode: off` stops being a guess and becomes a measured decision — and nobody re-litigates it without new evidence (the routing-axis rule).

## 2. OKR / KRs

**Objective**: turn `skill_mode` from an unmeasured default into an evidence-backed decision, per role (reviewer / implementer).

- **KR1**: reviewer arm — paired catch-rate table (per engine × pack/no-pack × case) over ≥ 14 known-bad + ≥ 11 clean cases, with sensitivity / false-pass-on-critical / specificity / token-cost columns. Zero missing cells (every dispatch either verdicts or is recorded `no_verdict` fail-closed).
- **KR2**: implementer arm — paired defect table over ≥ 8 tasks × pack/no-pack on one engine, defects counted ONLY by the fixed decorrelated reviewer + fixed harness (never the implementer's own green).
- **KR3**: a written decision applying the pre-registered rules in §5, recorded in BACKLOG + memory + (if wiring changes) CHANGELOG. The two real 2026-07-15 escapes (runsTree cycle-drop, IS_PI non-forwarding) are added to `evals/known-bad/` as permanent cases regardless of outcome.
- **KR4**: every dispatch row lands in `engine-scorecard.js` / capability-state with the `skill_transport` field populated — the experiment leaves the store richer than it found it.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- The pack content is FROZEN before the first live dispatch: reviewer pack = `skills/quality-pipeline/references/code-review.md` review-execution sections; implementer pack = `skills/dev-flow/SKill.md` six-element + TDD discipline sections. Byte-frozen fixture files under `evals/skill-transport/packs/`; no mid-experiment edits (edits = restart the arm).
- Verdict capture uses the existing nonce wrapped-block protocol (`dispatch-review.sh`); EMPTY/unparseable ⇒ `no_verdict`, recorded as a failed cell, never re-rolled silently.
- Defect/catch oracles are artifacts only: known-bad sidecar expectations, clean-set sidecars, harness exit codes. No LLM-judged outcome anywhere in the count path.
- Order of (case × arm) execution is shuffled once per engine with a recorded seed; no re-ordering after results start arriving.
- Subscription pools are NOT spent on matrix cells: matrix engines are metered/cheap seats only (haiku via claude-native, Gemini via agy, MiniMax-M3 via anthropic-compatible). gpt-5.3-codex-spark appears ONLY in the implementer arm (its normal seat).
- No production config default flips inside this plan's branch; wiring changes (if any) ship as a separate follow-up with their own review.

## 3. File-structure map

| File | Responsibility |
|------|----------------|
| `evals/skill-transport/packs/reviewer-pack.md`, `implementer-pack.md` | Frozen pack fixtures (Global Constraint #1) |
| `evals/known-bad/<2 new cases>/` | The two real 2026-07-15 escapes as planted-defect cases + sidecars (KR3) |
| `evals/skill-transport/run-matrix.sh` (new, bash) | Deterministic matrix driver: iterates (engine × arm × case), shells `dispatch-review.sh` with/without pack injection, appends one JSONL row per cell {engine, arm, case, verdict, caught, tokens, wall_secs, raw_log}; idempotent resume by cell key |
| `evals/skill-transport/report.js` (new, node, built-ins only) | Fold JSONL → paired tables + the §5 decision-rule evaluation printed as PASS/FAIL per rule; no LLM |
| `scripts/dispatch-review.sh` | ADDITIVE `--pack-file <path>` (prepend pack to the review prompt inside the existing nonce protocol); absent flag = byte-identical |
| `hooks/tests/dispatch-review.test.sh` | +cases: pack injection present in prompt, absent flag byte-compat |
| `docs/plans/2026-07-15-skill-transport-payoff-ab.md` | this plan |

## 4. Phases

### Phase 0 — instruments (size S) — acceptance: matrix dry-runs green, zero live spend
1. Freeze the two packs into `evals/skill-transport/packs/` (copy exact sections; record source SHA in a header comment).
2. Author the two new known-bad cases from git history: `git show 6f7ba42^2~1` region for runsTree cycle-drop (pre-fix `src/status/cli.js` hunk as the planted diff), `git show 229e3b5^2~1` for IS_PI non-forwarding; sidecars declare the expected Critical/Major finding per the existing known-bad sidecar schema. Validate with `calibration.sh run-known-bad --dry-run` (or the closest existing dry path).
3. `dispatch-review.sh --pack-file`: prepend-inside-nonce implementation + 2 test cases; run the full dispatch-review test file.
4. `run-matrix.sh` + `report.js` skeletons with a stub engine (fixture verdicts) proving: resume-by-cell, shuffled-seed recording, no_verdict fail-closed accounting.

### Phase 1 — reviewer arm (size S, live spend ~150 cheap reviews) — acceptance: KR1 table complete
1. Matrix: engines {claude-haiku (claude-native), Gemini (agy), MiniMax-M3 (anthropic-compatible)} × arms {no-pack, pack} × cases {known-bad 12 existing + 2 new, clean 11}.
2. Primary comparison is **haiku** (headroom exists — it demonstrably missed Majors; MiniMax is already 10/10 on known-bad, so it serves as a ceiling/robustness control, and Gemini as the mid case).
3. Placebo sub-arm (haiku only): arm C = equal-length irrelevant text pack — separates "relevant methodology" from "longer prompt changed behavior". +25 reviews.
4. Emit every row to the JSONL + scorecard (`skill_transport: prompt_pack`); `report.js` prints the paired table.

### Phase 2 — implementer arm (size L, gated: runs regardless of Phase 1 outcome but AFTER it, using its cost data) — acceptance: KR2 table complete
1. Task set: 8-10 S-size units sourced from BACKLOG small items + synthetic-but-real repo tasks, each with a **pre-authored verify-cmd** (red-green validated via `verify-red-green.sh` BEFORE any dispatch — a task whose test isn't red on base is disqualified).
2. Engine: gpt-5.3-codex-spark (its normal seat), worktree-isolated `dispatch-hetero.sh`, arms {six-element only, six-element + `--skill-mode prompt --skill <implementer-pack>`}.
3. Outcome per cell: committed?, verify-cmd pass?, defects found by ONE fixed decorrelated reviewer (strongest available cross-family seat at run time) + the pre-authored harness, tokens, wall, rounds.
4. Same shuffling/resume/fail-closed rules.

### Phase 3 — analysis + decision + recording (size S) — acceptance: KR3/KR4 done
1. `report.js` evaluates the pre-registered rules (§5) — exact counts, no percentages-only reporting at this N.
2. Decision recorded: BACKLOG entry (with "don't re-litigate without new evidence" framing), memory update, scorecard rows persisted (`record --file`, not just emit).
3. IF (and only if) a rule fires for adoption: open a SEPARATE follow-up ship for the config wiring (e.g. `reviewer_skill_pack` knob in review-loop-config resolved by `resolve-review-loop.sh`) with its own review loop. This plan itself ships only instruments + evidence.

## 5. Test / validation — pre-registered decision rules (written BEFORE data)

- **R-H2-adopt**: haiku sensitivity (pack − no-pack) ≥ +2 cases absolute on the 14 known-bad AND clean-set over-flag increase ≤ 1 case AND median token overhead ≤ 2× ⇒ adopt reviewer pack as opt-in config for weak seats.
- **R-H2-placebo**: if placebo arm C gains ≥ half of arm B's gain ⇒ the effect is prompt-length, not methodology; do NOT adopt (record as refuted-with-mechanism).
- **R-H2-refute**: gain < +2 or specificity degrades ⇒ H2 refuted; `skill_mode: off` becomes evidence-backed; panel-as-compensator confirmed as the load-bearing layer.
- **R-H1-refute (expected)**: implementer pack shows no reduction in reviewer+harness-caught defects (Δ ≤ 0) ⇒ H1 confirmed (six-element + pre-seeded verify is sufficient); keep off.
- **R-H1-surprise**: defect reduction ≥ 2 across ≥ 8 tasks with cost ≤ 1.5× ⇒ H1 refuted; open follow-up for implementer-side wiring.
- Script-gated: all counting in `report.js` from JSONL artifacts. Human-gated: the final adopt/refute call (Board reads the table; rules are advisory clamps against motivated reasoning, not an auto-gate).

## 6. Risks + inversion ("what would guarantee this fails?")

- **Ceiling effect** — engines already at 10/10 show nothing. Mitigated: haiku-primary design; 2 new harder cases from real escapes.
- **Pack drift mid-run** — someone edits the skill while the matrix runs. Mitigated: frozen fixture files + source-SHA header; matrix reads fixtures only.
- **Prompt-length confound** — "any long prompt helps/hurts". Mitigated: placebo arm C on the primary engine.
- **Oracle leakage** — pack text accidentally names the planted defect classes (the known-bad set partially overlaps what code-review.md teaches). Real risk, embraced honestly: that overlap IS the hypothesis (methodology text should help catch methodology-class defects). But sidecar-specific hints must not appear; Phase 0 includes a grep of pack text against sidecar expectation keywords — collisions get the case flagged in the report, not silently counted.
- **N too small for strong claims** — 14 cases is small. Mitigated: exact-count reporting, decision rules use absolute case deltas (not significance theater), and the conclusion is scoped to "this seat, this set".
- **Quota burn** — matrix on subscription pools. Mitigated: Global Constraint — metered/cheap seats only; spark only in its normal implementer seat.
- **dispatch-review regression** — `--pack-file` touches a load-bearing rail. Mitigated: additive flag + byte-compat test + the existing 129-assertion suite must stay green.

## 7. Out of scope

- Flipping any production default in this plan's branch (separate follow-up ship).
- Native (non-prompt-pack) skill transport benching for pi — `bench-engine-capability.sh` already owns that surface; this plan only consumes its recorded rows.
- Re-litigating domain/phase routing (routing-axis-evidence stands).
- Multi-skill packs / pack composition search — one frozen pack per role, this round.
- Fine-tuning or any non-prompt intervention.

## 8. Open questions (Board)

1. Reviewer pack source: is `code-review.md` the right single pack, or should the reviewer agent prompt (`agents/reviewer.md`) be the pack? (Plan default: code-review.md sections; Board may swap before Phase 0 freeze.)
2. Is the ~150-review metered spend (rough order: tens of NT$ on MiniMax + agy free-tier + haiku subscription overhead) approved?
3. Should Phase 2 run even if Phase 1 fully refutes H2? (Plan default: yes — the arms test different roles; but Board may cut Phase 2 to save cost.)

## Review log

- R0 2026-07-15: authored at depth-0 (Fable), from the 2026-07-15 /l5 lineage+directive run's escape evidence. Not yet reviewed.
