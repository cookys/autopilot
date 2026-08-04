# Platform capability trigger activation

> **Status:** ✅ Shipped in v2.34.2 — merged to `develop` as `ef72be66`; archive record being completed
> **Source branch:** `feat/platform-capability-trigger-activation` (merged; retained at archive record time)
> **Plan:** [platform capability trigger activation](../../../plans/2026-08-04-platform-capability-trigger-activation.md)

## Objective

Activate three newly available platform capabilities as one fail-closed production slice: authoritative
agy structured usage, Codex `PostCompact` recovery wiring, and ordinary strict-L5 provider bootstrap.
Every promoted platform fact must first pass the closed dual-evidence claim contract.

## Success

- D1 emits content-addressed claims backed by both official contract and fresh version-matched live
  evidence; downstream gates consume only immediately revalidated claim IDs.
- D2 preserves agy response framing while sourcing usage only from the native structured envelope.
- D3 invokes existing recovery authority from the official Codex event using canonical hook sources
  outside the generated plugin package.
- D4 admits strict-L5 dispatch only through fresh in-process closures derived from the exact
  six-dimensional code policy.
- Focused negative matrices, generated parity, full validation, cumulative review, and documentation
  close without widening the one-node Mission.

## Execution tracker

| Deliverable | Status | Internal gates | Exit condition |
|---|---|---|---|
| Platform capability trigger activation | shipped in v2.34.2; merged as `ef72be66`; archive record being completed | D1 capability claims ✓ → D2 agy telemetry ✓ → D3 Codex PostCompact ✓ → D4 strict-L5 bootstrap ✓ → depth-0 suite/review ✓ | Archive record committed with the verified merge receipt; push, tag, and publish remain outside this record |

The tracker has one deliverable. D1–D4 are ordered internal gates, not independently claimable phases;
tests, reviews, repairs, and doc sync remain inside this row and its existing budgets.

## Final verification receipt

- Final implementation candidate: `12875e95721867eadf058f94cddf0bfb2390d58f`.
- Exact independently reviewed range:
  `7047717b2df5354da134043692e31ad067a98bfa..12875e95721867eadf058f94cddf0bfb2390d58f`.
- Independent reviewer: `READY`; the four-level severity review returned zero findings.
- Authoritative depth-0 suite: **263/263 test files GREEN**.
- Merge commit: `ef72be66022afee2f6cf5a549e368678940c13f5` on `develop`.
- Archive state: being completed by the post-merge closeout commit containing this record.
- Push state: **pending at archive record time**.
- Tag/publish state: not performed or claimed by this archive record.

R4 generation 1 used ticket `platform-trigger-activation-r4-20260804`, session
`platform-trigger-activation-r4-g1`, and key
`9d76ee510ba046bd6aab6484cfb193b5e376afcfe689490d1c484ff063363bab`. Sol returned
`CONDITIONAL`, Gemini returned `READY`, and depth 0 accepted the sole R8 claim-consumption blocker
(`e9f817092f3b54635588d1c76aca049615ff918c5ef4e3c4e5f373d951c88645`) in the immutable
[`r4-g1 disposition`](../../../plans/2026-08-04-platform-capability-trigger-activation.r4-g1-disposition.json).
The exact D2/D3/D4 consumer-manifest repair stayed in the same R4 lineage. Generation 2 session
`platform-trigger-activation-r4-g2` produced terminal semantic `READY` under
`generation_2_terminal`: both Sol and Gemini returned `READY`, findings were empty, and
`next_generation` is `null`. The immutable artifact is
`/home/cookys/.autopilot/plan-review/9d76ee510ba046bd6aab6484cfb193b5e376afcfe689490d1c484ff063363bab/generation-02.json`
(SHA-256 `5cbdfdeb86de9d85f4395a1e70f218e3ca72844c31684c76b2154399699dd1ed`).
Implementation is merged. D1 emitted the closed [platform capability receipt](evidence/platform-capabilities.json): D2 owns two required IDs, D3 four, and D4 six; all required claims pass immediate version re-probe, while five optional IDs retain four blocked negative findings plus the validated Claude hook baseline. D2 now consumes its exact two-claim set before every agy provider invocation, captures the native JSON envelope privately, preserves only the response framing in worker-visible logs, and admits only validated usage into result/scorecard telemetry.

D3 now ships one Codex-native production `PostCompact` registration (`manual|auto`) from canonical
sources outside the generated package. The adapter translates the official payload into the existing
fail-closed reconciliation authority; it does not copy recovery logic or claim Claude hook parity.
The generated package mirrors the canonical manifest and adapter byte-for-byte.

D4 now compiles ordinary `AUTOPILOT_LEVEL=l5 engine implement-review` through the frozen
six-claim provider policy in `src/readiness/provider-bootstrap.js`. Its canonical policy digest is
`856551c093f382114166404c4c0288da667da5ff4075da30021a7c8a9fea547c`; the invocation roster is
projected to exact `{runner,model,role,effort,endpoint,family}` tuples, canonically sorted, and
required to have byte-equal policy coverage. The CLI constructs fresh in-process qualification and
live-probe closures, injects them only through the Engine constructor, and consumes readiness before
workflow dispatch. Missing, stale, mismatched, duplicate, unresolved, extra, reordered, wrong-family,
claim-substituted, digest-drifted, serialized, or probe-failed evidence rejects with zero workflow
dispatcher calls. Lower levels retain their explicit non-strict behavior and are never labelled L5.

## D3 production evidence

The exact [Codex production live receipt](evidence/codex-postcompact-production-live-receipt.json)
is a byte-for-byte copy of
`/tmp/autopilot-d3-live-E8PkHl/depth0-production-live-final12/live-receipt.json`.
Its file SHA-256 is `789a0cfb1975adafbfd162ce28ee1dee943999bfba805077c9857597c212a461`,
its sealed internal digest is
`96e7859cef39132aa3c80aa4e55ea0672c07d8838c4238994cbb0f3f25be762a`, and the
live driver SHA-256 is `41bc2658d91ca8416387ea1174df34bd4a9cd879e63324d8b3fe3028dba6c94c`.
On Codex 0.146.0 it proves manual reconciliation before effect, threshold-12000 automatic
reconciliation before the continuation/effect, and the negative boundary where a broken adapter
fails the hook with no reconciliation receipt and no sentinel. Raw terminal content is intentionally
not committed; its redacted digests remain bound by the receipt.

## Scope boundaries

This project does not restore OpenCode's truncated `debug skill` hard gate, promote inconclusive generic
`tier:` metadata, create Codex install-time payload generation, reconstruct historical agy usage, enable
generic GitHub Actions, open a PR, push, tag, or publish.
