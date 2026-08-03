# Plan — Durable Heterogeneous Plan-Review Session Controller
<!-- autopilot-authority-claims: ["plan_review"] -->
> Status: ✅ Shipped in v2.34.0 — merged as `c66349e` / Owner: CEO / Frame: independent L-size follow-up

## 0. Context / thesis

The 2026-07-26 session exposed three review-control defects: recoverable reviewer prose caused a
strict-JSON transport STOP, reviewer additions opened ad hoc sessions, and findings lacked one
durable adjudication ledger. The current controller correctly freezes a rubric and limits a ticket to
two generations, but it supports only chair plus deep seats and treats transport recovery outside the
controller as a new orchestration problem.

The fix is not more review. It is one durable ticket that owns panel membership, attempts,
generations, findings, repairs, and terminal state.

## 1. Problem

Today, an operator can unintentionally reset effective review effort by creating another ticket or
supplemental panel. A malformed response is not represented separately from a semantic verdict, and
the controller cannot express a three- or four-seat heterogeneous panel. Findings are returned but
not durably adjudicated as accepted, rejected, deferred, or duplicate before the next generation.

## 2. OKR / KRs

**Objective:** Make one plan-review ticket the bounded source of truth from first dispatch to terminal
decision.

- **R1 / KR1 — one identity:** Canonical repo identity + ticket + frozen rubric identify the review
  session. Session IDs, process restarts, models, runners, panel changes, and transport retries cannot
  reset its clock or generation budget.
- **R2 / KR2 — attempts are not generations:** A transport/parser failure consumes a seat attempt but
  not a semantic generation. Each seat has a configured maximum of two attempts per generation.
- **R3 / KR3 — N-seat manifest:** One frozen reviewer manifest supports 1–4 seats with exact runner,
  model, effort, endpoint, role, and family. Panel width remains one generation.
- **R4 / KR4 — controlled substitution:** An unavailable seat may be replaced only by a
  manifest-declared fallback satisfying readiness and family rules. The substitution is recorded and
  does not create a new ticket.
- **R5 / KR5 — finding ledger:** Every normalized finding has a stable fingerprint and depth-0
  disposition: `accepted_blocker`, `accepted_nonblocking`, `rejected`, `duplicate`, or `deferred`.
- **R6 / KR6 — repair admission:** Only accepted blockers mapped to a frozen rubric ID and immediate
  next-slice integrity can authorize generation 2. Nonblocking and out-of-rubric findings go to
  backlog output.
- **R7 / KR7 — terminal cap:** Generation 2 with an accepted blocker is STOP. READY or nonblocking
  CONDITIONAL is terminal. No controller or reviewer prose can schedule generation 3.
- **R8 / KR8 — truthful transport result:** Output distinguishes `semantic_verdict`,
  `transport_status`, `attempts`, `generation`, and `terminal`; recoverable raw output is retained in
  private artifacts for adjudication.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Canonical repo identity plus ticket plus frozen rubric is the durable review identity; runner, model, process, and session changes never reset it.
- Every plan-review manifest carries a caller-stable `logical_plan_id`; changing ticket, path, runner, process, or session does not change this identity.
- Reviewer width is not another generation; one generation may contain 1–4 frozen manifest seats.
- A transport or parser failure is not a semantic plan verdict and cannot by itself mark the plan STOP.
- Each seat gets at most two transport attempts per generation, including fallback substitution.
- A fallback may replace a seat only when it preserves the manifest's frozen minimum distinct-family count and violates none of the seat's excluded-family constraints.
- Only depth-0 `accepted_blocker` findings mapped to the frozen rubric may authorize a repair generation.
- Generation 2 is the hard terminal cap; no reviewer text or new process may create generation 3 for the same ticket.
- Raw reviewer output may be retained only in private state artifacts and must not leak credentials.
- Existing two-seat CLI flags remain supported as a compatibility translation into a manifest.
- PRS consumes the shared `RunnerTransportEnvelope` for mechanical outcomes. Only
  `plan-review-normalize.js` may canonicalize the purpose-bound plan-review payload; it cannot emit
  another transport truth or accept a raw artifact bound to another controller.

## 3. File-structure map

| File | Responsibility |
|---|---|
| `scripts/dispatch-plan-review.js` | Durable ticket state machine, manifest loading, per-seat attempts, substitution, generation aggregation, and terminal policy. |
| `scripts/lib/plan-review-normalize.js` (new) | Purpose-bound strict JSON parse plus bounded extraction; consumes shared transport status and produces only plan-review semantic/parser status. |
| `scripts/lib/plan-review-findings.js` (new) | Stable finding fingerprint, dedupe, rubric mapping, and disposition validation. |
| `schemas/plan-review-manifest.schema.json` (new) | Caller-stable `logical_plan_id`, frozen 1–4 seat manifest, and declared fallback contract. |
| `schemas/plan-review-artifact.schema.json` (new) | Generation, attempts, substitutions, findings ledger, and terminal result contract. |
| `scripts/rubric-freeze.js` | Seal manifest hash beside rubric hash and reject later drift. |
| `hooks/tests/dispatch-plan-review.test.sh` | State-machine red/green cases, compatibility flags, attempts vs generations, terminal cap. |
| `hooks/tests/plan-review-routing.test.sh` | N-seat routing, endpoints, readiness/family substitution, and no hidden extra seats. |
| `hooks/tests/fixtures/plan-review/**` (new) | Prose-wrapped JSON, malformed JSON, duplicate findings, seat timeout, fallback, drift, and cap fixtures. |
| `references/plan-template.md` | Describe manifest freeze and finding disposition review log. |
| `skills/research-to-ship/SKILL.md` | Invoke the manifest-based controller and require adjudication before generation 2. |
| `platforms/codex/plugin/**` | Canonically generated mirror only. |

The existing author-dispatch CLI is a read-only transport dependency, not a PRS-owned modification
surface. PRS passes the frozen exact tuple into its public interface. New runner
adapters such as optional native Kimi belong to the provider/transport plan and remain independently
testable.

## 4. Phases

### Phase 1 — Manifest and artifact contracts (L)

**Depends on:** provider-readiness plan only for live readiness; fixture adapters make this phase
independently implementable.

1. Define a manifest with a required caller-stable `logical_plan_id`, 1–4 exact seats, and ordered,
   explicit fallbacks. `logical_plan_id` is an opaque repo-scoped UUID/slug created once at plan
   intake and copied unchanged into supplements and resubmissions; it is never derived from mutable
   plan content, path, ticket, runner, or session.
   A fallback is eligible only when readiness/qualification pass, the panel still satisfies the
   manifest's frozen minimum distinct-family count, and the fallback family is not in the seat's
   excluded-family set.
2. Define an artifact that separates generation, seat attempt, transport status, semantic verdict,
   substitution, raw-artifact reference, and finding dispositions.
   Reuse the existing private state root:
   `~/.autopilot/plan-review/<sha256(canonical-repo-identity + NUL + ticket)>/state.json`.
   The state stores rubric and manifest hashes plus the original deadline, attempts, claims, and next
   generation. Every process restart loads this same record; a model, runner, or session change
   cannot create a fresh clock or counter.
   A second private index at
   `~/.autopilot/plan-review/logical/<sha256(canonical-repo-identity + NUL + logical_plan_id)>.json`
   atomically points to the canonical ticket/session directory. Ticket creation locks and checks this
   index; an existing active or terminal logical plan returns the canonical ticket instead of opening
   a new budget.
3. Extend rubric freeze to seal the manifest. Reject mutation after generation 1 claim.
4. Translate legacy chair/deep flags into an equivalent two-seat in-memory manifest.

**Acceptance:** schema checks accept valid 1/2/4-seat manifests and reject a fifth seat, duplicate seat
ID, incomplete exact tuple, undeclared fallback, and post-freeze mutation.

### Phase 2 — Transport normalization and bounded retry (L)

**Depends on:** Phase 1.

1. Move response parsing into a pure normalizer.
2. Preserve strict JSON as the preferred form. Permit extraction only when exactly one complete JSON
   object matches the response contract; ambiguous/multiple objects remain parser failures.
3. Record malformed/prose-wrapped/timeout/empty response as transport outcomes, not STOP verdicts.
4. Retry the same seat once; when policy allows, the second attempt may use its declared ready,
   qualified fallback.
5. End the ticket with `transport_exhausted` when a required seat has no semantic verdict after two
   attempts. Do not consume generation 2.

**Acceptance:** prose-wrapped single JSON recovers in generation 1; ambiguous JSON retries once then
ends `transport_exhausted`; neither case creates a generation-2 artifact.

### Phase 3 — Finding ledger and depth-0 adjudication (L)

**Depends on:** Phase 2.

1. Fingerprint normalized findings from rubric ID, affected surface, claim, and evidence reference.
2. Dedupe equivalent findings across seats without losing provenance.
3. Require a disposition file or explicit controller adjudication input before generation 2.
4. Validate that `accepted_blocker` maps to the frozen rubric and has both
   `blocks_next_slice_or_immediate_integrity=true` and `cannot_defer_to_spike=true`, matching the
   admission contract in `scripts/dispatch-plan-review.js`.
5. Emit accepted nonblockers, duplicates, rejected, and out-of-rubric findings as a separate backlog
   candidate artifact; they cannot authorize repair.

**Acceptance:** only one of two duplicate blocker reports consumes repair scope, an unverified
reviewer claim is rejected without repair, and a useful out-of-rubric suggestion appears only in the
backlog artifact.

### Phase 4 — N-seat aggregation and terminal policy (L)

**Depends on:** Phase 3.

1. Dispatch all frozen seats as panel width in one generation.
2. Aggregate semantic results after required seats complete or exhaust transport.
3. Generation 1 with accepted blockers becomes nonterminal CONDITIONAL and names generation 2.
4. Generation 2 is always terminal; any accepted blocker produces STOP, otherwise
   READY/nonblocking CONDITIONAL.
5. Reject a second ticket with the same canonical repo identity and caller-stable `logical_plan_id`
   while its index points to an active or terminal ticket; provide that canonical ticket in the
   error. Rubric/manifest hashes are drift evidence, not the logical identity itself.

**Acceptance:** a four-seat fixture with one retry and two duplicate findings produces one generation,
one accepted blocker, one repair authorization, and no hidden session reset.

### Phase 5 — Skill/docs/package integration (S)

**Depends on:** Phase 4.

1. Update plan-authoring and research-to-ship instructions to freeze a manifest and adjudicate
   findings.
2. Document that transport failure is not plan rejection.
3. Sync the Codex plugin mirror and update CHANGELOG at ship time.

**Acceptance:** invariant/document checks and plugin mirror check pass.

## 5. Test / validation

```bash
bash hooks/tests/dispatch-plan-review.test.sh
bash hooks/tests/plan-review-routing.test.sh
node scripts/check-contract-schema.js
bash scripts/sync-codex-plugin-skills.sh --check
```

Required red cases: new ticket cannot reset an equivalent active review; transport exhaustion cannot
be labeled semantic STOP; generation 3 is rejected; a fifth seat is rejected; manifest/rubric drift
is rejected; two equivalent blocker findings consume repair scope exactly once; nonblocking findings
cannot authorize repair.

## 6. Risks + inversion

| Failure guarantee | Mitigation |
|---|---|
| Treat every wrapper prose response as valid JSON | Extract only one unambiguous contract object; otherwise bounded retry. |
| Let retry become an infinite provider carousel | Two attempts per seat, manifest-declared fallbacks only. |
| Let panel expansion evade the budget | Freeze 1–4 seats with the rubric; supplements use the same ticket or are rejected. |
| Let reviewer severity directly mutate scope | Depth-0 disposition plus frozen rubric mapping is mandatory. |
| Hide disagreement by deduping too aggressively | Fingerprint preserves all seat provenance and exact claims/evidence. |
| Break current chair/deep callers | Compatibility translation and pinned legacy fixtures. |

## 7. Out of scope

- Implementing provider-specific transports or qualification; owned by the provider-readiness plan.
- Raising the hard cap above two generations or four panel seats.
- Implementation diff review; this plan governs plan readiness only.
- Existing worktree and branch lifecycle budget implementation.
- Automatically editing `docs/BACKLOG.md`; this plan emits a candidate artifact for depth-0 to apply.

## 8. Open questions

None. The Board explicitly requested bounded heterogeneous loop review and correction only for
verified findings.

## Review log

- Ownership consolidation (2026-07-26): removed `dispatch-author.sh` from the implementation file
  map. PRS owns plan-session semantics and its normalizer only; it consumes common transport and PRO
  readiness without adding runner adapters.

- R0 (2026-07-26): Authored from the transcript investigation. Rubric frozen in
  `2026-07-26-plan-review-session-controller.rubric.md`.
- R0.5 Kimi K3: CONDITIONAL. Confirmed and repaired durable state/resume semantics, family
  substitution rules, and the two explicit blocker-admission booleans.
- R1 MiniMax-M3: semantic READY, zero findings.
- R1 GLM-5.2: semantic READY with two nonblocking findings; both confirmed and repaired
  (`logical_plan_id`/cross-ticket index and explicit dedupe red case). GLM wrapped its valid JSON in a
  Markdown fence, so the current controller recorded terminal
  `reviewer_transport_or_response_failure` rather than the semantic READY. No generation 2 was
  opened because there was no admitted blocker; this exact transport/semantic split is in this
  plan's scope.
