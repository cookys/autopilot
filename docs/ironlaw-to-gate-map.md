# Loop-Convergence 鐵律 → Gate 對照表

Single source of truth for the mechanical / brief-template gates that downgrade
"a human should have pulled the brake" from "someone remembers to watch" into
machine gates. Origin of rows 1–5: 2026-07-14 codex replay-driver incident
(8 artifact generations v1→v3.4, `tests_executed:false` for the whole run, `ship_ready:false`
monotonic, verdicts oscillating FAIL/PASS, hours unattended). Row 6: 2026-08-28
revival.3d `5ca9b104` foreman sleep/cat polling cost.

Methodology: `autopilot-distill-skills:ironlaw-to-gate`. Last verified: 2026-08-28.

## The table

| # | 規則 (rule + origin) | Gate 機制 | 指令 (one-line check) | 現況 + limitations |
|---|----------------------|-----------|-----------------------|--------------------|
| 1 | Verification-anchored loop guard — a續輪 must be anchored to a red→green change in *executable* verification; ≥2 consecutive zero-execution rounds ⇒ halt (incident: `tests_executed:false` all 7 gens) | `scripts/check-loop-convergence.js` gate 1 (deterministic count over an artifact sequence) | `node scripts/check-loop-convergence.js --artifacts-dir <dir> --enforce` (exit 3 = trip) | ✅ mechanical. **Catches HONEST-but-WEAK only** — a worker that LIES (`tests_executed:true` without running) is not caught (needs execution provenance/oracle). |
| 2 | Rubric freeze — round 0 seals acceptance criteria; a blocking finding mapping to nothing in the sealed rubric = scope expansion ⇒ escalate, don't open a new round | `scripts/rubric-freeze.js seal\|check` (spec-hash seal + drift) | `node scripts/rubric-freeze.js check <spec> <seal>` (exit 3 = drift) | ⚠️ **半機械**: spec-hash seal + drift is mechanical; the finding→rubric *mapping* is semantic → **review-only** (see below). |
| 3 | Generation cap — artifact version番号 is the round counter; cap 3 gens still REWORK-shape ⇒ halt (incident: climbed to v3.4) | `scripts/check-loop-convergence.js` gate 3 (parses `artifact_generation` as number `2` OR string `"3.4"`) | `node scripts/check-loop-convergence.js --artifacts-dir <dir> --generation-cap 3 --enforce` | ✅ mechanical. Trusts `artifact_generation` monotonicity; a forged/rewritten counter is not detected. REWORK-shape is a field-name heuristic (missing `ship_ready` + no verdict field ⇒ reads REWORK = fail-toward-halt, the safe direction). |
| 4 | 裸跑禁令 — a multi-hour autonomous hetero loop MUST have a named depth-0 clock owner (incident: hours unattended, no brake) | Brief-template hard constraint: `skills/ceo-agent/references/level-front-door.md` § 裸跑禁令 + `references/hetero-dispatch.md` invariant 6 | (review-only — no code gate; the clock owner *runs* gate 1+3 as its brake) | ⚠️ **doc forcing-function, not a machine gate** — "is there a live clock owner" is not repo-observable. Honestly review-only; mechanized part = the brake it wields (gates 1+3). |
| 5 | 規模預算 — every dispatch brief carries a LOC/complexity budget; over-budget ⇒ escalate, don't grind | Brief-template hard constraint: `skills/ceo-agent/references/task-prompt-templates.md` § HOW MUCH + `references/hetero-dispatch.md` invariant 5 | `scripts/measure-task-width.sh --json` (upper-bound file-disjoint churn sanity check) | ⚠️ **半機械 / doc forcing-function**: the *presence* of a budget in a brief is not repo-gate-able; `measure-task-width.sh` only bounds realized width (file-disjoint churn ≠ semantic coupling). |
| 6 | Foreman 禁止輪詢 — 工頭等 leaf 只能用 `run_in_background`／task-notification 喚醒並結束回合；`sleep` 迴圈、`cat`/`tail` leaf `.output` 灌回自己 context、Monitor 等 leaf、Bash >40 皆紅（incident: revival.3d `5ca9b104`, 28/30 opus 工頭用量高於全部 leaf） | `scripts/check-foreman-polling.js` over `<session>/tasks/<agentId>.output` | `node scripts/check-foreman-polling.js <transcript>` (exit 1 = RED) | ✅ mechanical over the transcript. Does not see Monitor tool_use (Bash-only). Depth-0 harvest; red = do not merge. |

## Verification (gates 1 + 3, the 🔴 mechanical pair)

```
bash hooks/tests/check-loop-convergence.test.sh   # red-case + negative controls; wired into hooks/tests/run.sh (CI)
```
- **Red case**: `hooks/tests/fixtures/loop-convergence/accident-replay-driver/` (7 real
  incident artifacts) ⇒ gate 1 AND gate 3 trip.
- **Negative control**: `healthy-convergence/` (tests_executed:true, red→green, gen≤3, final
  ship_ready:true) ⇒ PASS; `boundary-single-zero-exec/` (one isolated zero-exec round) ⇒ PASS
  (proves the ≥2-consecutive threshold).

## Review-only list (cannot be mechanized — honest)

- **Gate 2 finding→rubric mapping**: deciding whether a blocking finding is *in* the sealed
  acceptance criteria or is scope expansion requires semantic judgement over the finding text
  and the spec. Only the spec-hash *seal/drift* is mechanical.
- **Gate 4 "is a live human/agent clock-owning this run"**: not observable from the repo. The
  doc mandates it; the mechanized surface is the brake (gates 1+3) the owner runs.
- **Gate 5 "does this brief carry a budget, and is the budget right"**: brief presence/quality
  is not repo-gate-able. `measure-task-width.sh` bounds realized width only.
- **The general limit**: all five gates stop HONEST-but-WEAK loops. None stop a *malicious*
  worker that fabricates status fields. That needs execution provenance / an independent oracle
  and is explicitly out of scope.

## 「新增 gate 時」checklist

1. Classify the new rule (ironlaw-to-gate Step 1): 語法可判 / 檔案形狀可判 / 狀態語義不變式 /
   外部對照語義. Pick the gate form accordingly.
2. If it can be a machine gate, ship it WITH a red-case (inject a violation → gate red) AND a
   negative control (clean input → green), and wire it into `hooks/tests/run.sh` (CI).
3. If it CANNOT be mechanized, add it to the review-only list above WITH the reason — do not
   pretend a doc mandate is a gate.
4. Update this table's row + the "Last verified" date.
