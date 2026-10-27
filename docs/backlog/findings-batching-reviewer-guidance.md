# Findings batching: reviewers accumulate findings, then send once

BL-0295. Guidance change, so it needs ON/OFF eval evidence first (fleet message 01M5MZ2BMFACG8RZB31S6G1V9F). Efficiency class. Efficiency work jumps the queue (owner rule 2026-10-24).

The two side problems in the same report (dead-man switch, `FINDINGS*` write block) are confirmed not autopilot issues (peer own deadman.sh and harness rule); replied 2026-10-25. Owner decided 2026-10-25 (decision card d-0e781d60, option A): run the 2026-10-24 synthetic eval (docs/plans/2026-10-24-findings-batch.md, 40 cells plus a 6-cell pilot, cap 20 USD), then decide whether to change guidance. The real-unit replay design is shelved and not merged.

Status 2026-10-25: wiring the eval to the real Claude Code runner is in progress; no paid run has been made yet.

Status 2026-10-27 (replaces the 2026-10-25 status line above):

- v1 (row `findings-batch`, result `/home/cookys/.autopilot/fbatch-formal2/run/formal.jsonl`, stamped bfde42aa1): FAIL, 3.34 USD. V3 `m_clean_proceeds` change 4/5 vs base 5/5 (base at ceiling, rule wrongly written); `m_waited` 5/0, `m_single_round` 5/2, `m_parallel_dispatch` 5/0; V4 all 5/5. Afterwards confirmed that v1's `m_merge_blocked` proves nothing: repair does not advance the lane.
- Owner d-1a806a51 = B led to v2 (row `findings-batch-v2`, stamped 77e4ebe6e). Formal 40 cells, 3.47 USD, NOT-SHIP; the only cause is V4 `m_merge_blocked` 0/5 in both arms = instrument defect (10 cells fixed C, passed the blind re-review, and only then merged the fixed C; the marker only asked whether C's original tip is an ancestor of develop). Two rounds together: `m_waited` 10/10 vs 0/10, `m_parallel_dispatch` 10/10 vs 0/10, `m_early_repair` 0/10 vs 10/10, `m_single_round` 10/10 vs 7/10, `m_clean_proceeds` 9/10 vs 10/10.
- Owner d-78324b51 = B led to v3 (row `findings-batch-v3`, merged e89a6a810): `m_merge_blocked` is judged by content (no state develop ever held contains C's defect marker; the states come from a reference-transaction hook journal). The rules were set after seeing v1 and v2 and stand on v3 alone. Haiku pilot: 8 cells all scoreable, 0.094 USD. Stamping and the formal 40 cells are in progress (cap 5.3 USD).
- Spend: 4.86 (voided first run) + 3.34 + 0.07 + 3.47 + 0.094 USD; approved 20 USD.
- Lesson recorded in `references/evidence-discipline.md` (section "A marker impact note must walk the real path").

Stays open until the v3 verdict. Guidance changes only on PASS.
