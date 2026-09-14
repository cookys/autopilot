# Arm the ordinary-strike threshold (currently shadow-only) — DATED REVIEW REQUIRED

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: When shadow data exists for a role — i.e. `would_requalify` has fired at least once against a seat and the operator has replayed those strikes and agrees each was a true engine/pair failure. Also: this row must be re-read by **2026-11-22** even if nothing fired, because a threshold nobody revisits is a calendar tooth in a trench coat.
- **Context**: v2.34.35 ships `ordinary_strike` accrual in SHADOW: strikes are recorded and `would_requalify` is projected, but `admission_status` stays `qualified`. `critical_reexam_trigger` enforces immediately (deterministic predicates need no calibration). The flip is one env var, `AUTOPILOT_STRIKE_ENFORCEMENT=enforce`, read at projection time in `engine-scorecard.js` — see [`references/strike-decay.md`](../references/strike-decay.md) § Arming. Arming is a per-role Board decision, not a default: the question is whether N=3 is right for that role, which needs the shadow counts to answer. Do NOT arm on a hunch; a wrongly-armed threshold blocks a good seat and reads exactly like the calendar tooth this replaced.
- **Effort**: S (flag + per-role N) once the data justifies it
- **Source**: hetero design panel 2026-08-22 (kimi's "trench coat" objection), shipped shadow-first per synthesis §8.

