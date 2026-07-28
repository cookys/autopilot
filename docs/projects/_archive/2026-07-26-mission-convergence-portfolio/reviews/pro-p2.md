# PRO Phase 2 — Bounded Heto Review

> Candidate: `5178965..51ef94b`
>
> Repair: `51ef94b..1edd145`
>
> Status: READY
>
> Repair cap: one admitted generation, followed by one terminal panel

## Frozen Checklist

Only a concrete, evidence-backed violation of one of these items may block Phase 2:

1. **Safe-first fixed request** — every call runs a safe transport/config surface before any live
   request. The live adapter receives one frozen, dispatcher-owned, read-only, tools-disabled,
   minimal request; caller input cannot supply a prompt or request body.
2. **Exact-tuple TTL bound** — fresh evidence suppresses live spend, stale/missing evidence permits
   one attempt, and different endpoint wallets remain distinct. A PID-stale exact-tuple lock makes
   the read/probe/persist sequence single-owner across processes.
3. **Canonical persistence** — `scripts/engine-capability-state.js` remains the sole persistence
   target. Probe outcome, minimal/no-effect spend class, exact endpoint/null identity, observation
   time, selected quota event ID, and TTL are durable; raw output is not.
4. **Mechanical transport truth** — the coordinator consumes the shared
   `RunnerTransportEnvelope`, verifies exact fields and its content digest, and keeps semantic probe
   validation purpose-bound. It does not create a competing transport envelope.
5. **Distinct honest outcomes** — success, timeout, transport failure, auth failure, quota
   exhaustion, rate limit, unavailable, interruption, and malformed semantic response remain
   distinct. Only success is `ready`; auth/quota/rate are `blocked`; indeterminate transport or
   semantic failures are `unknown`.
6. **Credential hygiene** — endpoint credentials load through the canonical safe loader into a
   one-call env clone. Tokens/raw responses/adapter errors never enter argv, public results,
   capability evidence, diagnostics, or fixtures.
7. **Containment** — the change does not implement readiness CLI/receipts, ICC integration, native
   Kimi transport, dispatch policy, qualification, package sync, or another portfolio phase.

## Disposition Rules

- `must-fix-now`: a reproducible checklist violation that makes Phase 2's acceptance claim false.
- `follow-up`: a valuable independent improvement with source, concrete trigger, and expected
  value; depth-0 records it for later but does not reopen this phase.
- `reject-out-of-scope`: unsupported, duplicate, speculative, preference-only, or owned by a later
  phase.
- Severity alone has no scheduling authority. Reviewers may not expand the frozen checklist.
- One repair generation maximum. Terminal discoveries are classified and may complete a regression
  inside that same repair, but cannot create a new feature loop.
- Codex generated-mirror sync remains portfolio Phase 33.

## Deterministic Evidence

- Focused HEAD checks pass: provider readiness/probe 32, capability state 13, manual safe/live probe
  5, implementation-campaign transport 29, status 26, and context window 52 assertions; the
  endpoint loader suite also passes.
- Two real child processes racing the same exact tuple produce one live request, one durable event,
  one `attempted`, and one `reused`.
- `5178965..51ef94b` is isolated-worktree red/green `VALIDATED`: HEAD is green; base lacks the
  quota-specific time and coordinator and cannot satisfy the concurrent oracle.
- The exact-effort/role and stdout-binding repair is red/green validated against `51ef94b`; the
  superseded repair `c58d698` separately fails the legacy-null schema assertion that `1edd145`
  passes.
- Version, canonical and contract invariants pass. Completeness has zero new findings; error-path
  and secret scans have zero findings.
- Static test-integrity reports no violations; its generic template does not classify
  `hooks/tests/**`, so the isolated red/green result is the authoritative dynamic evidence.

## Panel Results

### Generation 1

| Seat | Transport | Semantic verdict | Depth-0 disposition |
|---|---|---|---|
| GPT-5.6 Sol high | reviewed | `FIX-THEN-SHIP` | Two Major findings admitted below. |
| Qwen3.8-Max-Preview max | reviewed | `SHIP-AS-IS` | No findings. |
| GLM-5.2 high | reviewed | `SHIP-AS-IS` | No findings. |

Admitted findings:

1. The lock digest included `effort`, but capability persistence and reads did not. Different
   efforts could therefore share evidence while locking independently.
2. The semantic `response_text` was not bound to the shared envelope's stdout digest. An adapter
   could pair an `OK` semantic string with a receipt for different output.

The repair adds an effort identity partition and an exact-role quota query while preserving the
legacy account-pool/default behavior for existing callers. Semantic classification now hashes the
raw response bytes and requires equality with `output_digests.stdout_sha256` before interpreting
`OK`.

### Terminal Panel

| Seat | Scope | Result | Depth-0 disposition |
|---|---|---|---|
| Qwen3.8-Max-Preview max | full aggregate | parser rejected | A semantic clean verdict preceded the nonce block; fail-closed and not counted. |
| Qwen3.8-Max-Preview max | repair delta retry | `SHIP-AS-IS` | No findings. |
| GPT-5.6 Sol high | first repair delta | `FIX-THEN-SHIP` | Valid schema regression completed inside the same repair generation. |
| GPT-5.6 Sol high | final repair delta | `SHIP-AS-IS` | No findings. |

The first repair emitted `effort:null` for legacy ambiguous rows while its schema allowed only a
string. The same repair generation was amended so `effort` accepts string or null and
`effort_binding` remains the disambiguator. An isolated test proves the superseded repair fails and
the final repair passes.

No independent refactor, feature, or preference-only finding was admitted. Nothing from this phase
needs a follow-up backlog entry.

## Final Verdict

`READY`. Safe-first probing, fixed-request authority, exact tuple/TTL single ownership, canonical
redacted persistence, endpoint loading, shared-envelope binding, and distinct outcome semantics all
pass at `1edd145`.
