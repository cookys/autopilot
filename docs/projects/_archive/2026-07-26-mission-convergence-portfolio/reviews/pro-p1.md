# PRO Phase 1 — Bounded Heto Review

> Candidate: `04d06f4..9eeec32`
>
> Repair: `9eeec32..e99b912`
>
> Status: READY
>
> Repair cap: one admitted generation, followed by one terminal panel

## Frozen Checklist

Only a concrete, evidence-backed violation of one of these items may block Phase 1:

1. **Exact identity** — readiness is keyed by the exact
   `{role, runner, model, effort, endpoint|null}` tuple. Same-model endpoint wallets remain
   distinct, while legacy endpoint-less capability rows stay explicitly ambiguous.
2. **Independent axes** — `transport`, `live`, and `qualification` are independently normalized as
   `ready|blocked|unknown`; one axis never determines another.
3. **Honest freshness** — a missing or stale axis becomes `unknown + probe_required`, never
   `blocked`. Future or unsafe observation windows fail validation.
4. **Bound fallback eligibility** — ordered fallbacks retain only fully ready exact tuples.
   Duplicate tuples and observations bound to a different tuple fail validation.
5. **Pure decision surface** — Phase 1 performs no probe, dispatch, persistence, or engine
   mutation. Public decision fields and digests derive only from validated input.
6. **Capability compatibility** — exact endpoint/null capability rows are isolated by wallet.
   Existing endpoint-less reads retain legacy semantics and malformed persisted endpoint rows
   cannot contaminate a valid report.
7. **Containment** — the change does not implement the probe coordinator, readiness CLI/receipt,
   native Kimi transport, ICC integration, package sync, or another portfolio phase.

## Disposition Rules

- `must-fix-now`: a reproducible violation of the checklist that would make Phase 1's acceptance
  claim false.
- `follow-up`: a valuable refactor or later feature that does not invalidate the checklist. It
  must include source, concrete trigger, and expected value before depth-0 may add it to backlog.
- `reject-out-of-scope`: unsupported, duplicate, preference-only, speculative, or owned by a later
  phase.
- Severity does not grant scheduling authority. Reviewers may not expand the frozen checklist.
- At most one repair generation is allowed. New topics found after that are classified, not used
  to reopen the phase.
- Codex generated-mirror sync remains portfolio Phase 33 and is not a Phase 1 blocker.

## Deterministic Evidence

- Candidate regression: 504 shell assertions pass across provider readiness, capability state,
  status, context window, resolver, and review dispatch. The repaired HEAD additionally passes
  provider readiness (18), capability state (13), context window (52), and status (26).
- Isolated worktree red/green: `04d06f4..9eeec32` is `VALIDATED`; HEAD is green and base rejects
  endpoint records/options and lacks the new pure contract.
- Both repair cases are independently red/green validated: `9eeec32` fails the cross-wallet
  duplicate-ID provenance assertion, and the superseded first repair `6ea4f21` fails the
  null-context fallback event-ID assertion; `e99b912` passes both.
- Repository skill/version/agent/hook/canonical/README invariants pass.
- Completeness scan has zero new findings; error-path and secret scans have zero findings.
- Static test-integrity reports no violations; its template does not classify `hooks/tests/**`,
  so the isolated red/green result is the authoritative dynamic test-integrity evidence.

## Panel Results

### Generation 1

| Seat | Transport | Semantic verdict | Depth-0 disposition |
|---|---|---|---|
| GPT-5.6 Sol high | reviewed | `FIX-THEN-SHIP` | One endpoint-isolation Major admitted. |
| Qwen3.8-Max-Preview max | reviewed | `SHIP-AS-IS` | No findings. |
| GLM-5.2 high | reviewed | `SHIP-AS-IS` | No findings. |

Admitted finding:

1. The capability merge filtered rows by exact endpoint, but later recovered aggregate
   `observed_at` through a global `event_id` lookup. A different or malformed endpoint row with a
   duplicate ID could therefore supply the selected wallet's timestamp, violating checklist items
   1 and 6.

The repair carries time provenance on each winning quota/skill/context candidate and never performs
the global lookup.

### Terminal Panel

| Seat | Scope | Result | Depth-0 disposition |
|---|---|---|---|
| Qwen3.8-Max-Preview max | full aggregate | parser rejected | A semantic `SHIP-AS-IS` preceded the nonce block; fail-closed and not counted. |
| Qwen3.8-Max-Preview max | repair delta retry | `SHIP-AS-IS` | No findings. |
| GPT-5.6 Sol high | first repair delta | `FIX-THEN-SHIP` | Valid repair regression completed inside the same repair generation. |
| GPT-5.6 Sol high | final repair delta | `SHIP-AS-IS` | No findings. |

The first repair could select an initialized null-only context candidate whose `eventId` remained
`-1`. Depth-0 admitted this because the repair itself would have broken legacy fallback output.
The same repair generation was amended to admit only candidates with a positive stored event ID;
an isolated red/green test proves the superseded repair fails and the final repair passes.

No reviewer proposed an independent refactor or feature requiring backlog admission. No
preference-only finding was allowed to reopen the phase.

## Final Verdict

`READY`. The exact five-part identity, independent readiness axes, missing/stale semantics,
endpoint-aware capability compatibility, and pure Phase 1 boundary all pass. The sole admitted
repair generation is terminally clean at `e99b912`.
