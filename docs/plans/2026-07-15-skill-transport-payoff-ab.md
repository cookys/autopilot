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

- **KR1**: reviewer arm — paired catch table (per engine × arm × case × repeat) over ≥ 13 known-bad + ≥ 11 clean cases. **`caught` is a pre-registered defect-matched predicate**, NOT any-fail: each case ships a `<case>.match.json` (keyword/regex set derived from the sidecar `defect`, authored in Phase 0, grep-verified disjoint from pack vocabulary); a review counts as caught only when verdict ≠ SHIP-AS-IS AND the findings text matches the predicate. Report columns: caught, verdict, `no_verdict` rate per arm, latency, and (if Phase 0 validates extraction) tokens. Primary statistic = **paired discordant pairs** (cases flipped caught-with-pack-only minus flipped caught-no-pack-only), not marginal counts. Zero missing cells (`no_verdict` recorded fail-closed).
- **KR2**: implementer arm — paired defect table over ≥ 8 tasks × pack/no-pack on one engine, defects counted ONLY by the fixed decorrelated reviewer + fixed harness (never the implementer's own green).
- **KR3**: a written decision applying the pre-registered rules in §5, recorded in BACKLOG + memory + (if wiring changes) CHANGELOG. The runsTree cycle-drop escape becomes a permanent `evals/known-bad/` case IF it passes the §4 P0.2 admission gate; IS_PI non-forwarding is recorded as REJECTED-for-diff-review (cross-file wiring defect — documented so nobody re-adds it as an eval case).
- **KR4**: every dispatch row lands in `engine-scorecard.js` / capability-state with the `skill_transport` field populated — the experiment leaves the store richer than it found it.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- The pack content is FROZEN before the first live dispatch AND is **methodology-only**: reviewer pack = `skills/quality-pipeline/references/code-review.md` review-execution sections **with every output-format directive stripped** (no "Reviewer output contract", no Handoff enum, no report-structure/severity-format sections — they compete with the dispatch nonce `VERDICT:` protocol and would inflate arm-B `no_verdict` for a purely mechanical reason the placebo cannot isolate); implementer pack = `skills/dev-flow/SKILL.md` six-element + TDD discipline sections, same stripping rule. Phase 0 asserts by grep that no pack fixture contains an output-format directive. Byte-frozen fixtures under `evals/skill-transport/packs/`; no mid-experiment edits (edits = restart the arm).
- **Format-conflict guard**: `report.js` computes `no_verdict` rate per arm; if the pack arm's `no_verdict` count exceeds the no-pack arm's by > 1 case on any engine, the block is flagged `format_conflict` and CANNOT be read as a methodology result (adopt/refute both blocked for that engine until the pack is re-frozen and the block re-run).
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

### Phase 0 — instruments (size S) — acceptance: matrix stub-runs green, oracle + cases validated, zero matrix spend
1. Freeze the two packs into `evals/skill-transport/packs/` (methodology-only per §2.5; record source SHA in a header; grep-assert no output-format directive).
2. **New-case admission gate** (the cheap de-risking control): a candidate case is admitted ONLY if a strong seat (MiniMax-M3, no-pack) catches it from the diff alone. runsTree cycle-drop (`git show 6f7ba42^2~1`, pre-fix `src/status/cli.js` hunk as a surgical single-defect diff) is the candidate — construction method pinned in the case header. **IS_PI non-forwarding is DROPPED as a diff-review case** (an omission defect requiring cross-file wiring knowledge the diff does not contain — it is an integration defect, not a diff-local one; recorded here so nobody re-adds it). New-case headroom is therefore 1, known-bad total ≥ 13. Sidecar `class` reflects real severity (`major`); since `calibration.sh` false-pass-on-critical gates only `class=="critical"`, `report.js` adds its own false-pass-on-major column.
3. Author `<case>.match.json` defect-matched predicates for ALL known-bad cases (existing 12 + admitted new); grep-verify each predicate set is disjoint from pack vocabulary; predicate quality validated by replaying 2-3 historical raw_logs (a MiniMax catch must match, a SHIP-AS-IS must not).
4. `dispatch-review.sh --pack-file`: prepend-inside-nonce implementation + 2 test cases (pack present in prompt; absent flag byte-compat); full dispatch-review test file green.
5. `run-matrix.sh` + `report.js` skeletons with a stub `--panel-cmd`-style fixture engine (NOT `calibration.sh --dry-run`, which does not exist) proving: resume-by-cell, shuffled-seed recording, `no_verdict` fail-closed accounting, per-arm no_verdict-rate guard, discordant-pair computation.
6. Token-extraction validation for haiku/claude-native `raw_log` (the review JSON deliberately carries no tokens field): if a reliable per-review token count cannot be extracted, the numeric ≤ 2× cost rule is DROPPED here (pre-registration edit recorded in the review log) and cost is reported qualitatively. Cache caveat disclosed: costs are as-observed under shuffled ordering (cache-cold-ish); steady-state production cost may differ in either direction.

### Phase 1 — reviewer arm (size S, live spend ~150 cheap reviews) — acceptance: KR1 table complete
1. Matrix: engines {claude-haiku (claude-native), Gemini (agy), MiniMax-M3 (anthropic-compatible)} × arms {no-pack, pack} × cases {known-bad ≥ 13 (12 existing + admitted new), clean 11}.
2. Primary comparison is **haiku** (headroom exists — it demonstrably missed Majors; MiniMax is already 10/10 on known-bad, so it serves as a ceiling/robustness control, and Gemini as the mid case).
3. **Repeats: k=3 per haiku cell (all arms)** — the decision rules resolve to 1-2 case swings, so the within-cell flip band must be measured, not assumed. Gemini/MiniMax run k=1 (control seats, no decision rests on them). `report.js` reports the haiku discordant-pair delta alongside its observed run-to-run band; a delta that does not exceed the band is inconclusive by construction.
4. Placebo sub-arm (haiku only, k=3): arm C = equal-length irrelevant text pack — separates "relevant methodology" from "longer prompt changed behavior".
5. Emit every row to the JSONL + scorecard (`skill_transport: prompt_pack`); `report.js` prints the paired table + per-arm no_verdict rates + discordant pairs.

### Phase 2 — implementer arm (size L, gated: runs regardless of Phase 1 outcome but AFTER it, using its cost data) — acceptance: KR2 table complete
1. Task set: 8-10 S-size units sourced from BACKLOG small items + synthetic-but-real repo tasks, each with a **pre-authored verify-cmd**. Pre-dispatch qualification = run the verify-cmd at base and assert NON-ZERO exit (plain base-red check — `verify-red-green.sh` needs a green head, which does not exist pre-dispatch). Where a reference solution is authored for a task, `verify-red-green.sh --range base..reference` additionally validates that the verify-cmd genuinely exercises the change; reference solutions are never shown to the engine.
2. Engine: gpt-5.3-codex-spark (its normal seat), worktree-isolated `dispatch-hetero.sh`, arms {six-element only, six-element + `--skill-mode prompt --skill <implementer-pack>`}.
3. Outcome per cell: committed?, verify-cmd pass?, defects found by ONE fixed decorrelated reviewer (strongest available cross-family seat at run time) + the pre-authored harness, tokens, wall, rounds.
4. Same shuffling/resume/fail-closed rules.

### Phase 3 — analysis + decision + recording (size S) — acceptance: KR3/KR4 done
1. `report.js` evaluates the pre-registered rules (§5) — exact counts, no percentages-only reporting at this N.
2. Decision recorded: BACKLOG entry (with "don't re-litigate without new evidence" framing), memory update, scorecard rows persisted (`record --file`, not just emit).
3. IF (and only if) a rule fires for adoption: open a SEPARATE follow-up ship for the config wiring (e.g. `reviewer_skill_pack` knob in review-loop-config resolved by `resolve-review-loop.sh`) with its own review loop. This plan itself ships only instruments + evidence.

## 5. Test / validation — pre-registered decision rules (written BEFORE data)

- **R-H2-adopt**: haiku **discordant-pair delta** (defect-matched caught, majority-of-k per cell) ≥ +2 cases AND the delta exceeds the observed within-cell flip band AND clean-set over-flag increase ≤ 1 case AND no `format_conflict` flag AND (if token extraction validated) median token overhead ≤ 2× ⇒ adopt reviewer pack as opt-in config for weak seats.
- **R-H2-placebo**: if placebo arm C's discordant delta ≥ ⌈B's delta / 2⌉ (ceiling convention; placebo veto only trusted at k=3) ⇒ the effect is prompt-length, not methodology; do NOT adopt (record as refuted-with-mechanism).
- **R-H2-refute**: delta < +2, or delta inside the flip band, or specificity degrades ⇒ H2 refuted; `skill_mode: off` becomes evidence-backed; panel-as-compensator confirmed as the load-bearing layer.
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

## 8. Open questions (Board) — ANSWERED 2026-07-15 (CEO)

1. Reviewer pack source = `code-review.md` methodology sections (format-stripped per §2.5) — it is the repo's single canonical review-methodology statement; `agents/reviewer.md` rejected (stronger competing output contract, worse format-conflict risk).
2. Spend approved (metered/cheap seats only per §2.5; haiku k=3 raises review count to ~200 — still trivial).
3. Phase 2 runs regardless of Phase 1's outcome (different roles), ordered after Phase 1 for its cost data.

## Review log

- R0 2026-07-15: authored at depth-0 (Fable), from the 2026-07-15 /l5 lineage+directive run's escape evidence.
- R1 2026-07-15: decorrelated plan review — agy Gemini 3.1 Pro SHIP-AS-IS (no findings); claude-opus methodology lens FIX-THEN-SHIP: 🔴 `caught` operator undefined (any-fail conflates flagging with diagnosis) + 🟠 pack carries competing output contract (format-conflict confound placebo can't isolate) + 🟠 IS_PI case not diff-diagnosable + 🟠 single-shot cells leave the decision inside unmeasured noise + 🟠 token cost not emitted by dispatch-review + 🟠 verify-red-green misuse pre-dispatch + 3 minors (fictional --dry-run flag; false-pass-on-critical won't cover major-class cases; cache×shuffle cost artifact; placebo rounding). ALL adopted in this revision: defect-matched `caught` predicate + discordant-pair statistic (KR1/§5), methodology-only pack + format-conflict guard (§2.5), new-case admission gate + IS_PI dropped (§4 P0.2), k=3 haiku repeats + flip-band requirement (§4 P1.3/§5), token-extraction validation-or-drop (§4 P0.6), plain base-red pre-dispatch check (§4 P2.1), stub-panel-cmd wording + false-pass-on-major column + cache disclosure + ceiling convention. Pre-registration considered LOCKED at this revision; Phase 0 acceptance re-validates the oracle mechanics before any matrix spend.
