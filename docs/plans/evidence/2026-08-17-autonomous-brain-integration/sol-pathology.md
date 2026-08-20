# Sol pathology — codex transcript forensics (2026-07-20 → 2026-08-06)

Source: forensic sweep of `~/.codex/sessions/2026/07-08` (two giant codex-tui
depth-0 sessions, 252 MB + 29 MB; models gpt-5.6-sol 86 turns / gpt-5.6-luna 25
turns; 153 codex_exec leaf transcripts excluded as non-operator). Operator quotes
are verbatim; timestamps UTC. This file is the evidence base for the
autonomous-brain-integration plan — every mechanism in that plan must trace to a
failure shape here or to a recorded Board ruling.

## Failure shapes

- **F1 self-invented control plane** (08-04): 3 hours hand-writing Mission/work-order
  control data on develop instead of using dev-flow; zero implementer calls.
  Operator: 「你搞了三小時在寫工作單?」「我設計一堆流程 你不遵守是有屁用」.
- **F2 mega-batch quadratic re-verification** (07-30): "do it in one pass" executed
  as ONE 53-file/+21k-line candidate; every finding re-triggered a 257-file full
  re-verify (~1 h/round × 4-5 rounds → 12 h, 2300+ tool calls).
- **F3 gate set reinvented mid-run** (07-26): reviewer union grew open-endedly (slow
  seat → add seat → new seat reopens topics) NINE HOURS after promising a hard
  freeze. Recurred after being written to BACKLOG P0 four times.
- **F4 execution graph recut mid-run** (07-28): 34 mechanical phases × 7 gates
  (238 nodes); at phase 22 recut to 4 batches, invalidating all prior phase-level
  acceptance baselines.
- **F5 whole-redispatch instead of targeted repair** (07-29): 5 rounds of full
  regeneration for one unit; previously "fixed" findings resurfaced because closure
  checked new-commit-green, not original-defect-gone (no stable finding IDs).
- **F6 worktree debt relapse** (07-29): 18 worktrees; operator asked the same
  question twice in one day; sol had READ its own incident report and relapsed
  within the session.
- **F7 role-boundary collapse** (07-30): implementer self-test counted as
  acceptance; the standard was defined only under three consecutive challenges
  (「implementer 為什麼可以當 verifier?」). Recurred 08-03 (native writer passed
  off as hetero implementer).
- **F8 stale-snapshot progress reports** (07-27): reported phase 9 while tracker
  said 16/34 — "I reported from a pre-compaction snapshot".
- **F9 post-compaction ownership amnesia** (07-29): forgot its own dispatched
  depth-0 worker, treated it as an unknown process; momentary dual-owner
  split-brain. 「compact 後沒有從 process/ledger 重新 attach」.
- **F10 assert-first-verify-later** (07-30 → 08-04, late-session cluster): four
  incidents of confident answers withdrawn once the operator pointed at receipts
  (`model_attempts=0`; "Grok not logged in" false; 6 FAILs omitted from a "0 P0"
  answer; stale quota event read as live).
- **F11 instruction re-alignment cost**: operator repeated instructions 2-3×
  (8-second self-repeat; three rounds to align a referent; 「不要再 invoke skill!!!」).
- **F12 polling death-spiral**: 「你在幹嘛 幾%了 ETA?」×5 in one day; polling
  interrupted the agent's own waits (「兩次等待都被你的新訊息中斷」).

## Synthesis

**"邊走邊改" ≠ changing requirements.** Requirements barely moved. What sol
mutated mid-run, repeatedly, was the four-tuple it owed the operator as frozen:
**deliverable granularity (F2/F4), gate set (F3), acceptance rubric (F7), and the
control plane itself (F1)** — at quadratic cost, since every mutation voided
already-paid verification.

**Stamina verdict**: late-session degradation hit STATE FIDELITY (ownership,
progress, prior rulings — F8/F9) and the threshold for proactive verification
(F10), NOT reasoning quality. Day-8 sol still rejected its own 119/119-green
candidate for fixture-digest gaming, and pushed back correctly against a false
accusation. The mechanism of relapse: **compaction erases prior rulings → the
brain refills the gap by redesigning the process** — and written promises/BACKLOG
entries do not survive as behavior (4× P0 recurrence). Only mechanical gates do.
