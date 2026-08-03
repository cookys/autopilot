# Platform capability trigger activation

> **Status:** planning / `review-pending-r4` (generation 2 pending)
> **Branch:** `feat/platform-capability-trigger-activation`
> **Plan:** [platform capability trigger activation](../../plans/2026-08-04-platform-capability-trigger-activation.md)

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
| Platform capability trigger activation | `planning / review-pending-r4` (generation 2 pending) | D1 capability claims → D2 agy telemetry → D3 Codex PostCompact → D4 strict-L5 bootstrap | Cumulative verification/review and docs finish gate pass on the frozen range |

The tracker has one deliverable. D1–D4 are ordered internal gates, not independently claimable phases;
tests, reviews, repairs, and doc sync remain inside this row and its existing budgets.

R4 generation 1 used ticket `platform-trigger-activation-r4-20260804`, session
`platform-trigger-activation-r4-g1`, and key
`9d76ee510ba046bd6aab6484cfb193b5e376afcfe689490d1c484ff063363bab`. Sol returned
`CONDITIONAL`, Gemini returned `READY`, and depth 0 accepted the sole R8 claim-consumption blocker
(`e9f817092f3b54635588d1c76aca049615ff918c5ef4e3c4e5f373d951c88645`) in the immutable
[`r4-g1 disposition`](../../plans/2026-08-04-platform-capability-trigger-activation.r4-g1-disposition.json).
The exact D2/D3/D4 consumer-manifest repair stays in the same R4 lineage; generation 2 is pending.

## Scope boundaries

This project does not restore OpenCode's truncated `debug skill` hard gate, promote inconclusive generic
`tier:` metadata, create Codex install-time payload generation, reconstruct historical agy usage, enable
generic GitHub Actions, open a PR, push, tag, publish, or release.
