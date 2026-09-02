# Cursor Agent as a read-only transport fallback for reviewer-class seats

> **Status**: Phases 1-4 shipped; **Phase 5 is BLOCKED and Phase 6's admission is
> therefore not added** — see §6. The mechanism is generic and complete; the cursor seat is not
> admitted and must not be described as available. Authorized by operator 2026-09-02 (routed from
> TWGameProject via fleet peer `twgs-revival-twgs-dev`, msg `msg_01M1G1JA5ZTH45Y5R7D77ZVFKC`).
> Peer transport is not authorization; the operator authorized this in the autopilot session
> directly.
>
> **Predecessor**: [`2026-08-26-cursor-cli-adaptor.md`](2026-08-26-cursor-cli-adaptor.md) shipped
> the cursor rail (Phases 1–4) and left Phase 5 — Stage-1 **implementer** qualification on
> `cursor-grok-4.6-high-fast` — outstanding. This plan is **not** that phase and does not
> substitute for it.

## 0. Context

TWGameProject hit transport exhaustion on the direct `grok` runner during a frozen plan review:
every attempt for a required seat failed at the transport layer, so the round ended
`transport_exhausted` with no semantic verdict and the plan review could not converge. They
separately probed `cursor-agent` on their host and observed `cursor-grok-4.6-xhigh` returning
valid JSON, and asked for it as a fallback that preserves the reviewer's logical identity.

### 0.1 Verified on this host, 2026-09-02

| Fact | How verified | Result |
|------|--------------|--------|
| `cursor-agent` present | `command -v cursor-agent; cursor-agent --version` | `/home/cookys/.local/bin/cursor-agent`, `2026.08.25-3e8eec8` (newer than the `2026.08.11-e8db854` in `src/harness/capabilities/cursor.json`) |
| `cursor-grok-4.6-xhigh` is a real enabled id | `scripts/lib/cursor-model.sh` `_CURSOR_BASE_OUT` table, `grok46`+`xhigh` row | yes, and `max` clamps to the same id |
| cursor has **no** roster admission | `scripts/resolve-review-loop.sh` `UNQUALIFIED_RUNNERS="cursor"` | naming cursor in any seat is refused (exit 3) without an operator override |
| cursor capability record is unverified | `src/harness/capabilities/cursor.json` | `status: unverified`, `harness_level: H0`, all eight capability fields `unverified` |
| plan-review attempts ≠ generations | `scripts/dispatch-plan-review.js` — `max_attempts_per_seat: 2` is a frozen manifest field with a hard `!== 2` reject at :547; generations cap at 2 separately (:173) | transport retries already live at a layer BELOW semantic generations |
| the claimed `dispatch-plan-review.js` comment-parse bug | `node --check scripts/dispatch-plan-review.js`; `grep -n '\*/'` | **not present upstream** — two `*/`, both ordinary JSDoc terminators (:45, :1317). Fixed in v2.34.41; `scripts/check-js-syntax.js` + `hooks/tests/check-js-syntax.test.sh` are the standing regression gate. The peer observed it in an installed **v2.34.40 cache**, which predates the fix. No work required. |

### 0.2 What this is NOT

The predecessor plan's §3b matrix deliberately left the **verification_author**, **plan_reviewer**
and **plan_deep_reviewer** allowlists closed, and Phase 5 qualifies exactly one pair
(`cursor` + `cursor-grok-4.6-high-fast`) for the **implementer** role. This plan needs a
**reviewer-class** role on a **different model id** (`cursor-grok-4.6-xhigh`). Qualification
evidence binds to an exact deployment identity and does not transfer across model ids or roles
(predecessor §7), so this plan carries its own qualification and cannot ride Phase 5's.

## 1. Problem

A required reviewer-class seat whose transport dies takes the whole round with it. The only
recoveries today are: re-run the round (costs a semantic generation, and generation 2 is the hard
cap), or hand-edit the frozen manifest (destroys the freeze). Neither is acceptable when the seat's
*model* was never the problem — only the pipe to it was.

## 2. OKR / KRs

**Objective**: a transport failure on a reviewer-class seat can be retried over a second,
explicitly-authorized transport without changing what the round means.

- **KR1** — A frozen seat may declare `transport_fallback: {runner, model}`. Absent that field,
  behavior is byte-identical to today. The fallback is never inferred, never defaulted, never
  chosen by the dispatcher.
- **KR2** — A fallback attempt preserves the seat's **logical** identity (id, role, model, family).
  `minimum_distinct_families` is computed from logical families only, so decorrelation math cannot
  be moved by a transport event.
- **KR3** — A fallback consumes a **transport attempt**, never a semantic generation. The existing
  `max_attempts_per_seat: 2` freeze is unchanged.
- **KR4** — Every receipt records BOTH identities: logical `{model, family}` and actual
  `{runner, model_id, transport}`. A reader can always tell that a fallback happened.
- **KR5** — Fallback fires ONLY on a transport-class failure. A seat that returned a real verdict,
  a refusal, or a parse-level disagreement never falls back.
- **KR6** — `cursor` + `cursor-grok-4.6-xhigh` has a **recorded** reviewer-class qualification
  outcome (pass or fail) via `scripts/engine-scorecard.js record`, and the resolver admits the pair
  **iff** that outcome is a pass. A recorded fail is a successful phase.
- **KR7** — Read-only posture is enforced, not assumed: workspace trust handled explicitly,
  `--mode ask`, scratch cwd, and a mutation-attempt negative test that fails if the seat can write.

## 3. Phases

| # | Phase | Size | Depends on |
|---|-------|------|-----------|
| 1 | Seat-manifest schema: optional `transport_fallback`, frozen, validated, default-absent | S | — |
| 2 | `dispatch-plan-review.js` attempt loop: fallback on transport-class failure only; dual-identity receipts | M | 1 |
| 3 | `dispatch-review.sh` / `dispatch-author.sh` fallback surface + explicit workspace-trust handling | M | 1 |
| 4 | Negative-test suite (8 classes, below) | M | 2, 3 |
| 5 | Stage-0 probes + reviewer-class qualification on the frozen id; `engine-scorecard.js record` | H | 3 |
| 6 | Conditional resolver admission (iff pass) + capability record + docs + release | S | 5 |

Phase 5 is the only phase that spends money. Phases 1–4 are free and independently gated.

### 3.1 Negative tests (Phase 4 — the peer's list, made concrete)

Each is a case that must FAIL CLOSED, with a planted-negative control proving the assertion binds:

1. fallback declared with an unknown **runner** → manifest rejected at freeze time. (The model
   **id** is deliberately NOT validated at freeze: no freeze-time model validation exists anywhere
   on this rail — not for primary seats, not for `fallbacks[]` — and adding it for this field alone
   would be an asymmetry pretending to be a guarantee. A bogus id fails closed at dispatch as
   `transport_exhausted`, the same shape as a bogus primary-seat id.)
2. fallback transport unauthenticated → attempt fails, seat records transport failure, no verdict
3. fallback returns empty output → `no_verdict`, never a fabricated pass
4. fallback returns a DIFFERENT model/family than the logical seat → refused, round fails closed
5. fallback times out → attempt exhausted, generation not consumed
6. fallback attempts a mutation → refused; the probe file is unchanged
7. workspace-trust prompt appears → non-interactive refusal, never an indefinite hang
8. both transports exhausted → `transport_exhausted` exactly as today (no new terminal state)

## 3.5 Phase 5 outcome: BLOCKED, on evidence that already existed

Qualifying cursor for a reviewer-class role is **not possible today**, and the blocker is neither
money nor authorization. `scripts/qualification-review-provider.js`'s `callCli()` has a
`kind === 'cursor'` branch that refuses **unconditionally, before building argv or spawning**,
because the exam transport must be able to force a tool-deny and cursor-agent offers none.

That refusal rests on a live adversarial probe that was already run —
[`docs/plans/evidence/2026-08-29-cursor-containment-probe/`](evidence/2026-08-29-cursor-containment-probe/),
18 probes against **cursor-agent 2026.08.25-3e8eec8, the exact build installed on this host**:

- enumerated `permissions.deny` beats `--force` for the five nameable categories, but the model has
  more tools than any deny can name — **TodoWrite and WebSearch ran uncontained under full deny +
  `--force`**, WebSearch making a real outbound call;
- `permissions.deny: ["*"]` silently no-ops — worse than nothing, because it looks like protection;
- `--sandbox enabled` is AppArmor-gated and unavailable here — fails closed on this host, but that
  is not a portable guarantee;
- `--mode ask` is cooperative only, and is overridden by `--force`; **`--force` or `--trust` is
  MANDATORY for headless `-p`**, so the bypass flag cannot be avoided.

An exam prompt is adversarial-shaped by construction (the model is graded and has every incentive
to reach for a tool), and a **reviewer** seat is worse still: it reads an untrusted diff, which is a
prompt-injection surface. So the refusal is correct and this plan does not re-litigate it.

**Consequence, stated plainly**: `cursor` gains no roster admission from this plan.
`UNQUALIFIED_RUNNERS="cursor"` is unchanged. Phase 6 ships the docs and the release, not the
admission. Lifting this requires cursor-agent to ship a real catch-all deny or a portable sandbox
that survives `--force`, and then a full re-run of all 18 probes — not a re-reading of this section.

**A caveat this surfaced about the existing rail.** `dispatch-author.sh`'s cursor branch runs
`-p --trust --mode ask` in a scratch cwd. Per the probe, `--mode ask` is *cooperative*, and `--trust`
is itself in the bypass class. So that rail's read-only posture is **cooperative, not enforced** —
the scratch cwd is real containment for the working directory, but the process is not prevented from
reaching the host. This is now recorded in `references/hetero-dispatch.md`; it is not a regression,
but it was previously easy to read as stronger than it is.

## 4. Out of scope

- Promoting cursor to an implementer seat — that is the predecessor's Phase 5.
- Any `--runner auto` change. Auto refuses cursor ids by design and stays that way.
- Making cursor a *default* anywhere.

## 5. Open questions

1. Should the fallback be expressible in `.claude/review-loop-config.md` (roster level) as well as
   in a frozen plan-review manifest, or manifest-only for v1? **Proposed: manifest-only**, so the
   authorization is per-round and cannot become an ambient default.
2. Does the reviewer-class qualification need the full 6-family × 2 × 2 suite, or the
   reviewer-specific known-bad corpus? **Proposed: the reviewer corpus** — the role being qualified
   is reviewer-class, and `engine-qualify.sh` already owns that suite's shape.
