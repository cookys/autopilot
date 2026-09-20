# Rubric — 2026-09-14-backlog-entry-schema.md

> Source plan: docs/plans/_archive/2026-09-14-backlog-entry-schema.md

R1: The schema is stated exactly ONCE (`references/backlog-entry.md`); every other file links it and quotes only field names. A second field list anywhere fails.
R2: Every field has a byte cap (UTF-8 bytes, measured by the gate) or a closed value set; the plan names the numbers, not "reasonable".
R3: `Pointer` is required above the 600 B entry cap and must RESOLVE (path exists under `pointer_roots`, or id matches `id_pattern`); a dangling pointer is a violation, not a warning.
R4: Evidence (numbers, logs, stacks, narratives) is defined as belonging at the pointer; the row cap makes this mechanical, not advisory.
R5: The gate parses all three styles (heading / table / checklist) and treats an unparseable block as a violation, never a skip.
R6: The allowlist ratchets down only: a run that would add an entry fails; `--update-allowlist` can only remove.
R7: `--self-test` exists and can fail: every violation code fires on its embedded fixture and nowhere else.
R8: DI: `backlog-config.md` template + `resolve-project-paths.sh backlog_config` + onboard scaffold; caps may only be lowered by a consumer config.
R9: Every writer skill line (dev-flow ×4, finish-flow ×3, quality-pipeline, handoff, code-review, project-lifecycle) is enumerated with its location and replaced by one linking sentence; `grep 'context + trigger'` returns zero after Phase 3.
R10: Migration preserves bytes: moved text's sha256 is verified in the sidecar before `preserved: true`; `--dry-run` is the default.
R11: Autopilot's own backlog (233 KB) is migrated in this plan and the gate flips to `block` on it in the same release; the residual allowlist count is recorded in the CHANGELOG.
R12: Mechanism vs guidance is respected: gate + migration + resolver are mechanism; the schema/writer text is guidance and ships with the §5 eval evidence, not before.
R13: `next-pick.js parse` keeps working on migrated entries (Effort/Source field names unchanged).
R14: Compatibility with a consumer "register now" rule is shown: registering = one row with a pointer; no rule in the plan requires a consumer to delay registration.
R15: RISK — sessions route around the gate by pasting the same prose into a sidecar per sentence. Mitigation named: one sidecar per entry from migration; plan/project preferred as pointer target.
R16: RISK — the gate ships in `warn` and never flips. Mitigation named: Phase 4 flips autopilot in the same release; a consumer's choice is recorded in its config.
R17: Node ≥ 20.10 built-ins only; no markdown library; no trust machinery (ADR-0001).
R18: Open questions are only ones the Board can answer (threshold, retention, pre-commit placement), each with the plan's proposed default.
