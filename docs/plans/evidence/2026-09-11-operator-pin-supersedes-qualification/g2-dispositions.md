# G2 review (terminal) — findings and depth-0 final adjudication

> Source plan: `docs/plans/2026-09-11-operator-pin-supersedes-qualification.md`
> Artifact: `~/.autopilot/plan-review/8a26bb28…/generation-02.json`
> Verdict CONDITIONAL, `terminal: true`, `policy_reason: generation_cap_requires_depth_0_adjudication`.
> Seats: grok STOP, MiniMax CONDITIONAL, sol STOP. 25 findings / 17 blockers.
> Generation cap reached: no G3. Freeze predicate = zero unrepaired mechanism-level findings.

## Depth-0 re-derivations (facts checked before adjudicating)

- **`no_op` is conclusively EXCLUDED from strike accrual**, not "unverified" as R1 §1 said.
  `sed -n '3800,3804p' scripts/dispatch-hetero.sh` → the `*)` arm returns 0 for
  "committed / no_op / question_suspected / any status not in the fail-closed set".
  Consequence: the owner's "無法完成 (cannot complete)" revocation cause **does not accrue today**
  when the run surfaces as `no_op`. This is new work, not an existing mechanism.
- **The quota exclusion is narrower than R1 §1 claimed.** `sed -n '3782,3800p' scripts/dispatch-hetero.sh`
  → `engine_unavailable` is re-derived from the **exit code alone**; a text-only quota message carrying
  an ordinary exit code is deliberately NOT honoured as an exclusion and falls through to
  `cause_class="ambiguous"`, which **accrues**. So "quota never revokes" holds only for
  **host-corroborated** quota. This is correct-by-design (a runner is never trusted to label its own
  failure) and is a scope question for the owner, not a defect.

## Dispositions — all 17 blockers accepted; zero deferred

| G2 finding | Rubric | Disposition |
|---|---|---|
| Live overlay cannot become canonical without writing topology.json or bypassing the resolver | R15 | **ACCEPT** — adopt one read-side live resolver (below) |
| P4 treats live resolver fields as persistence surfaces | R13 | **ACCEPT** — split assertions: on-disk unchanged vs live tuple names the substitute |
| KR9's global default flip violates the plan's own zero-pin equivalence | R5 ×2 | **ACCEPT — design change**: `substitute` activates **only when a live pin is present**; zero-pin hosts keep `ask` |
| `seat_unusable` has no consumer that rebinds the live tuple | R12 | **ACCEPT** — resolver returns the rebound tuple in the same invocation |
| P9's strike-seat fragment cannot create the real row | R20 ×2 | **ACCEPT** — freeze the complete command incl. `--effort low` and every provenance field; reconcile the phase number against frozen R20's "P7" |
| §1 anchors still not re-derivable (`no_op`, text-only quota) | R16 | **ACCEPT** — both corrected above and in §1 |
| Substitution signal is downstream of its consumer (cycle) | R11 | **ACCEPT** — one acyclic protocol, resolver before contract admission |
| Durable queue has no producer/schema/idempotency/ack lifecycle | R12 | **ACCEPT** — specify ledger kind, key, producer, rehydration, acknowledgement |
| No separate effective tuple defined | R13 | **ACCEPT** — `preferred_tuple` + `effective_tuple` + `substitution_reason` |
| Seven-row matrix does not cover every fail-closed guard | R10 | **ACCEPT** — branch-complete table, one mutant per guard boundary |
| P0's grep cannot identify anchors or verify pointers | R7 | **ACCEPT** — frozen anchor manifest + deterministic checker |
| The jsonl-store gate is green before any pin code exists | R1 | **ACCEPT** — name `withWriteLock`/`appendRow`; add a concurrent-write case |
| `pins.jsonl` has no unpin/supersession representation | R6 | **ACCEPT** — locked snapshot of active rows; temp file + atomic rename; unpin removes the role's row |
| P0–P7 acceptances still not zero-context executable | R19 | **ACCEPT** — executable tables with fixtures, env, exit code, assertion text, cleanup |
| Two-commit path tests can pass with prose in the mechanism commit | R8 | **ACCEPT** — exhaustive path/extension classifier, mirrors classified with their sources, unclassified path fails |

## The one design change the owner should know about

The owner chose (2026-09-11, Q4) "flip the `on_engine_unavailable` default to `substitute`". Two seats
independently showed this **contradicts the plan's own central safety claim** (R5, zero-pin byte
equivalence): a host with no pin at all would change behaviour. The repair preserves the owner's intent
exactly — a pinned seat never stops to ask — while restoring the invariant: **`substitute` activates only
when a live pin is present; a zero-pin host keeps `ask`.** The owner always pins, so the observed
behaviour is unchanged for them.

---

# R2 lineage — two further generations (2026-09-11)

R2 had never been reviewed (G2 reviewed R1), so a fresh bounded lineage
(`operator-pin-supersedes-qualification-r2`) was opened. Two generations, terminal at the cap.

| Round | Seat verdicts | findings / blockers |
|---|---|---|
| R2-G1 | STOP / STOP / STOP | 22 / 20 |
| R2-G2 (terminal) | STOP / CONDITIONAL / STOP | 19 / 14 |

**R2-G1** was dominated by contradictions *I* introduced by patching sections individually instead of
sweeping the whole document: KR9 said "pinned-only" while §2.6 and Q4 still said "global default flip";
KR10 said the resolver decides while §3's contract row still described the pre-G2 design. Three were
genuine: `jsonl-store` has no snapshot primitive (re-derived — it exports only `withWriteLock` and
`appendRow`), the `ack-revocation` verb made live evidence suppressible, and P9 was a shadow derived from
its own answer. All folded; a four-term consistency sweep now runs after every edit.

**R2-G2** found four real design holes, all folded:

1. **The pin could not expand into a dispatchable tuple** (R6 ×2). The six-key row derived `effort` and
   `endpoint` from the qualified ladder — but KR1 exists precisely to admit a seat that is **not on that
   ladder**. The six-key reuse is abandoned as provably impossible; the row is now eight keys carrying the
   full dispatch identity, which is also what the effort-partitioned strike lookup needs.
2. **One pin could become a blanket admission bypass** (R10). With a pin present the contract admitted
   `effective_tuple` — so an autonomously chosen substitute rode in on the operator's pin. New **KR11**:
   `operator-pin` applies to `preferred_tuple` only; a substitute must pass ordinary admission on its own,
   and an unqualified rung is skipped, not admitted.
3. **Substitution might never reach the process** (R12). Nothing asserted the child argv. New **KR12** +
   a recording-stub acceptance asserting the launched argv names the effective seat, not the pinned one.
4. **Phase order forced the defect it forbade** (R10). P2 had the contract admitting a pin before the
   resolver existed, which necessarily puts pin reads inside the admission predicate. The resolver moves
   to P2; the contract becomes P2b and is gated by `grep pins.jsonl scripts/dispatch-contract.js` → empty.

Also folded: the two-commit allowlists excluded files the mechanism must touch (`resolve-review-loop.sh`)
and rejected a repo-required prose change (`CLAUDE.md` scripts inventory); a protected-region sha256
assertion now pins the §7 out-of-scope blocks (`dispatch-hetero.sh` strike writer 3765-3880,
`check_mission_enforcement_gate` 1411) byte-unchanged.

**Note for audit**: the R2-G2 dispatch was launched with `--session-id undefined` — the extractor read a
`session_id` key that `state.json` does not have (it stores `session_key`). Verified harmless: lineage
identity is the `session_key` derived from repo + ticket + logical_plan_id + rubric/manifest seals, and
the run attached to the same state dir with `next_generation: 2` and the 20 carried blocker fingerprints.
The label survives in that generation's claim record.

**Stop decision (depth-0)**: no fifth generation. Blocker counts across four rounds were 22 / 17 / 20 / 14
with three seats never once returning SHIP — the panel's output function emits findings every round, so
"zero findings" is not a reachable stopping condition and chasing it would hand the freeze decision to the
chair. The freeze predicate is **zero unrepaired mechanism-level findings**, and the four above were the
last of them. Remaining hardening moves to the code-stage hetero review, where the artifact under review
is a real diff rather than plan prose.
