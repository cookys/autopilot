# PRO Phase 4 — Bounded Heto Review

> RED: `38da972`
>
> Candidate: `d0a05f7`
>
> Repair: `d0a05f7..8f1daa3`
>
> Status: READY
>
> Repair cap: one admitted generation, followed by one terminal panel

## Frozen Checklist

Only a concrete, reproducible violation of the Phase 4 receipt/CLI boundary could block:

1. Every seat and observation is bound to the exact
   `{role, runner, model, effort, endpoint|null}` tuple.
2. Transport, live auth/quota, and role qualification stay independent; missing/stale evidence
   remains unknown rather than unavailable.
3. `status readiness` is observation-only unless `--probe` is explicit. Its live path reuses the
   Phase 2 exact-tuple lock and TTL suppression.
4. The content-bound receipt rejects expiry, future issue time, roster/policy/observation drift,
   incomplete seats, and non-canonical content.
5. Ordered fallback output contains only fully ready, family-safe candidates; an unqualified
   candidate is never selected or named as eligible.
6. Human and JSON status report each required seat and its failing axes honestly; existing status
   subcommands remain compatible.
7. This phase exports a pure receipt consumer but does not wire ICC, campaign generations,
   worktrees, package mirrors, or native Kimi transport.

## Disposition Rules

- `must-fix-now`: a reproduced checklist violation that makes Phase 4 acceptance false.
- `follow-up`: an independent improvement with a concrete trigger and expected value.
- `reject-out-of-scope`: later-phase work, duplicate, speculative, or preference-only advice.
- Severity does not grant scheduling authority.
- One repair generation maximum; Codex mirror sync remains portfolio Phase 33.

## Deterministic Evidence

- Focused suites pass: receipt consumer 22, pure readiness 32, resolver 258, status 26,
  review-loop runner 35, context-window 52, engine contract 439, contract parity 36, roster
  consumers 38, and campaign routing 29 assertions. Endpoint loading also passes.
- Contract schema parity passes with 61 fields. Skill/version/hook/canonical, whitespace,
  error-path, and secret gates pass.
- `38da972..d0a05f7` is isolated-worktree red/green `VALIDATED`: HEAD passes and the RED base lacks
  the receipt, CLI, schema, and live adapter.
- `d0a05f7..8f1daa3` is independently red/green `VALIDATED`: the candidate exposes family-blocked
  and unqualified fallback rows, while the repair exposes only orders 3 and 4.
- Static test-integrity reports no violations. Completeness's sole new match is the normal
  `status readiness` success `return 0`, identical to the neighboring status branches.
- The full repository run passed L1 `169/169`. Its first L2 pass exposed ten non-green files:
  three P4 fixture drifts were repaired and rerun green; four are the intentionally deferred Codex
  mirror sync; three are earlier-phase regression debt, not changed or concealed by this phase.

## Panel Results

### Generation 1

| Seat | Semantic verdict | Depth-0 disposition |
|---|---|---|
| GPT-5.6 Sol high | `FIX-THEN-SHIP` | One fallback finding admitted; two findings classified below. |
| Qwen3.8-Max-Preview max | `SHIP-AS-IS` | No findings. |
| GLM-5.2 high | `SHIP-AS-IS` | No findings. |

Admitted finding:

1. The receipt included every configured fallback with `eligible=false`, although the frozen
   contract says its ordered fallback surface names only eligible candidates.

Repair `8f1daa3` evaluates all configured candidates for deterministic selection, keeps their
identity in the roster/policy binding, and publishes only fully ready, family-safe fallback rows.

Other findings:

- ICC pre-spend consumption is owned by portfolio ICC P4 and is prohibited by this phase's pure
  boundary.
- Implementer/verification-author/QC qualification cannot be inferred from transport probes or
  disk scorecards. The missing authority-bound provider is valuable and was added to
  `docs/BACKLOG.md` with an ICC P4/Mission integration trigger.

### Terminal Panel

| Seat | Semantic verdict | Depth-0 disposition |
|---|---|---|
| GPT-5.6 Sol high | `FIX-THEN-SHIP` | Repeated the two classified items; its new TTL claim was disproved. |
| Qwen3.8-Max-Preview max | `SHIP-AS-IS` | No findings. |
| GLM-5.2 high | `SHIP-AS-IS` | No findings. |

The terminal TTL claim said every `--probe` repeats live spend. The actual coordinator acquires the
exact-tuple lock, calls `readCurrentLiveObservation`, and returns
`attempted:false, reused:true` on fresh evidence before invoking the live adapter. Phase 2's TTL
and two-process race tests cover that path. The claim is therefore not admitted.

## Final Verdict

`READY` at `8f1daa3`. The exact-roster receipt, honest CLI, bounded probe reuse, drift/expiry
validation, pure consumer, and eligible-only fallback surface satisfy the frozen Phase 4 boundary.
No verified Critical/Major finding remains.
