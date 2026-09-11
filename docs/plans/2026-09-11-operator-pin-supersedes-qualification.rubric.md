# Rubric — 2026-09-11-operator-pin-supersedes-qualification.md

> Source plan: docs/plans/2026-09-11-operator-pin-supersedes-qualification.md

R1: Node ≥ 20.10, built-ins only; no new npm dependency; the pin store reuses `lib/jsonl-store.js` primitives.
R2: ADR-0001 binding — a pin is an operator preference record, never an attestation; no hash chain, witness receipt or tamper-evidence may be added.
R3: The strike event log format is frozen and append-only; this plan changes only what admission DOES with strike rows, never how they are written.
R4: `EXTERNAL_CAUSE_EXCLUSIONS`, `CRITICAL_REEXAM_PREDICATES`, `STRIKE_WRITER_ALLOWLIST` and `ORDINARY_STRIKE_THRESHOLD` are frozen closed registries — no member added, removed or reordered.
R5: Zero-pin equivalence — on any host with no pin, every dispatch decision must be byte-identical to the pre-change build. This is the plan's central safety claim and must be asserted, not argued.
R6: The pin row reuses the existing `--qualification-override` row schema (engine+runner+role, reason, operator, expires) with `expires: null`; no second schema is introduced.
R7: Two supersessions are recorded as supersessions, not reinterpretations — KR6's `per-invocation` clause and the 2026-08-22 strike-precedence ruling — with a pointer comment at each code anchor so no reader finds a stale absolute.
R8: Mechanism and guidance ship as two commits; the mechanism commit contains zero prose edits and the guidance commit zero code edits, verified mechanically by `git show --stat`.
R9: The scorecard-first waiver for the guidance commit rests on the owner ruling of 2026-09-11 and is written down; it is not left implicit.
R10: **The change disables admission for everyone** — a refactor of `isAdmissibleScorecardRow` returns true too early. Mitigation: KR2 and KR3-unpinned are authored first and asserted byte-for-byte against output captured from the pre-change build.
R11: **The pin becomes a rerun-until-green escape** — exactly what the 2026-08-22 ruling guarded. Mitigation: pins are written only by an operator-attributed CLI call; `pending_revocation` is always surfaced and never suppressible; Q1 decides whether critical strikes stay absolute.
R12: **Unattended runs cannot ask**, so a seat that has begun fabricating evidence keeps being dispatched. Mitigation candidate KR4; ordinary strikes hold the pin and queue the question to the next interactive turn or round-end report. Reviewers must attack this specifically.
R13: **The quota stand-in leaks into preference** — the ladder's temporary pick gets persisted somewhere read back as an operator choice. Mitigation: P4 asserts `pins` unchanged and that no "last used engine" is written by `decision-ledger.js` / `next-pick.js`.
R14: **Every gate must be shown able to go red before it ships** (evidence-discipline §9 family): removing the pin lookup must fail KR1, removing the strike split must fail KR3-unpinned. A suite that stays green with the change reverted is not evidence.
R15: **The exam is deleted rather than demoted** — the plan's intent is that scorecard/ladder remain the recommender when no pin exists. Any step that removes or bypasses `resolve-dispatch-topology.js` seat selection violates the plan.
R16: **The plan claims an existing mechanism it has not verified.** §1's "already correct" table cites four code anchors; each must be independently re-derivable at the cited line, and a reviewer that cannot re-derive one must say so rather than accept the table.
R17: Out-of-scope boundaries hold: `check_mission_enforcement_gate`, the `skill_transport: native` precondition die, strike detectors/writers, and the exam harness itself are untouched.
R18: No new severity vocabulary; `🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion` only.
R19: Every phase P0–P7 carries a concrete acceptance a zero-context engineer can execute, naming the file, the command and the expected output — no "add error handling" shaped step.
R20: P7's real-data acceptance (the `agy` / `gemini-3.8-flash-low` seat carrying `evidence_hash_manipulation` from commit 1488a268) is a genuine test on real store data, not a fixture dressed as one; if Q1 resolves to `yes` its expected outcome is a refusal that NAMES the predicate, not a silent one.
