# Managed rail never passes scorecard scope files — `fallback_ladder` is always `[]`; evidenced qc seats need a pin

Original row from 5f3aa3b1d^:docs/BACKLOG.md:

> ### Managed rail never passes scorecard scope files — `fallback_ladder` is always `[]`; evidenced qc seats need a pin
> - **Status**: open
> - **Trigger**: a qc seat scorecard-qualified for reviewer (e.g. gpt-5.6-sol once `codex-cli`/`codex` canonicalise) is refused at intake without a pin
> - **Effort**: S
> - **Source**: plan §0 fact 1 / §6, 2026-09-15
> - **Pointer**: docs/plans/2026-09-15-final-panel-per-seat-pins.md
> - **Context**: engine resolves with bare `--check-scorecard`; `resolve-review-loop.sh:1498` needs both files to emit a ladder.
> 

Audit finding: Audit #12: Status open, Effort S. Unconfirmed whether still true. v2.36.46 chose standing pins and did not make the rail pass the scorecard scope file. Trigger-Type event.

Restored 2026-10-19 from 5f3aa3b1d^; see docs/plans/evidence/2026-10-19-backlog-deletion-audit/REPORT.md
