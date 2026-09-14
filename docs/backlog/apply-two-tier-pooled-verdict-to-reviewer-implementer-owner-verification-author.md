# Apply two-tier + pooled verdict to reviewer/implementer/owner/verification_author/brain

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: a role's own eval corpus + scorecard-first ON/OFF evidence exists — a frozen, sealed
  case corpus for that role plus an OC characterization against it, produced the same way
  `docs/plans/2026-08-28-consult-discuss-qualification.md` + `docs/plans/2026-08-29-qualification-verdict-stability.md`
  D6 produced one for consult/discuss.
- **Context**: `foldPooledVerdict`, `(VERDICT_Z, VERDICT_TAU)`, and the D3 error-class → tier map
  (`scripts/engine-qualify.js`) are already written role-agnostic — they consume only per-case
  outcomes and a role's tier map — but `reviewer`/`implementer`/`owner`/`verification_author`/`brain`
  keep their existing single-administration verdicts (KR7, `docs/plans/2026-08-29-qualification-verdict-stability.md`).
  Switching any of them without that role's own eval evidence first would repeat exactly the mistake
  this plan corrected for consult/discuss (成績單前置 — CLAUDE.md). See
  `docs/plans/evidence/2026-08-29-verdict-stability/OC-CHARACTERIZATION.md` § "Generalization seam
  (deferred)" for the full reasoning.
- **Effort**: L
- **Source**: `docs/plans/2026-08-29-qualification-verdict-stability.md` D8

