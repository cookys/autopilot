# G1 review — findings and depth-0 dispositions

> Source plan: `docs/plans/2026-09-11-operator-pin-supersedes-qualification.md`

- **G1** dispatched 2026-09-11 (`--generation 1`, 3 seats, all transports complete).
  Verdict **CONDITIONAL** (`semantic_verdict: CONDITIONAL`, `policy_reason: depth_0_adjudication_required`);
  seat verdicts: grok chair CONDITIONAL, MiniMax evidence-skeptic **STOP**, sol mechanism-skeptic **STOP**.
  31 findings, 22 candidate blockers. Artifact:
  `~/.autopilot/plan-review/8a26bb28a506a0ac89f7fe42681e4416e6f9403178f386b8637e1bae5d06087e/generation-01.json`.

  **Depth-0 dispositions (G1)** — re-derived, not accepted on the reviewers' word:

  - **ACCEPT (R16, findings 1 + 28) — the plan's §1 table was factually wrong.** Independently
    re-derived 2026-09-11: `dispatch-contract.js:1303` makes quota unavailability a **NO-GO reason**,
    not a stand-in trigger; `resolve-review-loop.sh:97` sets `DEF_ON_ENGINE_UNAVAILABLE="ask"`, so the
    shipped default on a quota wall is to **stop and ask the operator**; and `resolve-dispatch-topology.js`
    contains **zero** occurrences of `quota`, so the implementer ladder is not quota-aware and cannot
    "climb past" an exhausted seat. Consequence: the owner requirement "quota does not revoke, it only
    needs a stand-in" is **NEW WORK**, not an existing mechanism, and `on_engine_unavailable=ask` is a
    second, independent source of the re-authorisation interrupts this plan exists to remove. §1 row 2,
    KR5 and P4 are rewritten accordingly in R1.
  - **ACCEPT (R10, findings 2 + 25).** `isAdmissibleScorecardRow` stays pin-unaware and keeps returning
    false on `requalify_required`; pins are handled only in the `!matched` / strike-precedence branch
    after that false. KR2 becomes a table-driven byte-for-byte capture of every pre-change inadmissible
    row shape, authored before any permissive code.
  - **ACCEPT (R6, findings 4 + 18).** `expires: null` is illegal for the override validator, and
    relaxing it would change zero-pin override admission. Same six keys, **two validators**, separate
    `pins.jsonl` in the capability store; `loadQualificationOverride` is never called for pins.
    `pinned_at` is dropped from KR1 rather than widening the frozen row.
  - **ACCEPT (R15, finding 19) + (R13, findings 7 + 20).** One canonical live resolution path: the pin
    is a **non-persisted overlay** on the scorecard-derived ladder, so a fresh pin takes effect without
    a cache round-trip and a quota stand-in cannot be written back. P4's assertions move to the real
    leak surfaces — `topology.json` and `resolve-review-loop.sh`'s `implementer_*` fields — and keep the
    `decision-ledger.js` / `next-pick.js` checks only as negative controls.
  - **ACCEPT (R11, finding 23).** `pending_revocation` must derive from the same authoritative
    active-strike fold that admission uses, with negative cases for invalidated, rejected-writer,
    duplicate, pre-baseline and future rows.
  - **ACCEPT (R20, finding 6) + (R7, finding 26) + (R8, findings 5 + 27).** The refusal payload names
    `predicate_id`, not just the class; the supersession pointer is applied at **every** anchor found by
    a semantic scan (`per-invocation`, `only evidence-free`, strike-precedence wording) including the
    `platforms/codex/plugin` mirror; P0 splits across the two commits (code-anchor comments → mechanism,
    frozen-plan amendment → guidance).
  - **ACCEPT (R5, findings 11 + 24).** Zero-pin equivalence is captured across the full matrix (qualified
    admit, each inadmissible shape, no-row, ordinary and critical strike, valid/invalid override, quota
    states, topology auto and fallback), not the refusal string alone.
  - **ACCEPT, wording (R19/R1/R4/R14, findings 8, 12, 13, 14, 16, 17, 29, 30).** Every phase acceptance
    becomes a zero-context table (file, command, exit code, expected line); the frozen-registry
    byte-identity check and the negation ("mutate, watch it go red, restore") runs become their own
    acceptance steps rather than §5 prose.
  - **REFUTE (findings 9 + 10) — reviewer attestation is not verification.** Both ask for a
    "reviewer-attestation acceptance" in which reviewers record that they re-derived an anchor or judged
    a risk adequately gated. ADR-0001 is binding here: a recorded claim by a reviewer is exactly the
    attestation this repo refuses to treat as evidence. The underlying need is accepted in a different
    shape — depth-0 re-derives each cited anchor and the plan records **the re-derivation command and
    its output**, which is how finding 1 was confirmed above. No attestation row is added.
  - **BLOCKED ON OWNER (R12/R11, findings 3 + 21 + 22).** Two seats independently conclude P3 has no
    implementable admission rule while §8 Q1 is open, and that "queue the question to the next
    interactive turn" is promised but unimplemented. Q1 goes to the owner before R1 freezes P3.
