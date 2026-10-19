# Managed rail: ADJUDICATING / VERTICAL_VERIFICATION resumes still spend the Mission claim before the git-drift check

Original row from 5f3aa3b1d^:docs/BACKLOG.md:

> ### Managed rail: ADJUDICATING / VERTICAL_VERIFICATION resumes still spend the Mission claim before the git-drift check
> - **Status**: open
> - **Trigger**: a drifted non-durable-wait resume burns a grant attempt (same pre-spend class as v2.36.42/46/48/53)
> - **Effort**: S
> - **Source**: plan 2026-09-16-disposition-resume-scope-sha §6 (kept out by rubric R6)
> - **Pointer**: docs/plans/2026-09-16-disposition-resume-scope-sha.md
> - **Context**: extend the v2.36.53 pre-claim preflight from the durable-wait phases to every git_candidate resume; the existing P3 drift cases gain a zero-call assertion.
> 

Audit finding: Audit #10: Status open, Effort S. Kept out of the disposition-resume plan by rubric R6; the note lives only in that archived plan. Trigger-Type event.

Restored 2026-10-19 from 5f3aa3b1d^; see docs/plans/evidence/2026-10-19-backlog-deletion-audit/REPORT.md
