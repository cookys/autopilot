# Phase 2 — Transcript Aggregation

## Goal

Convert explicit local transcript roots into de-identified, honest, non-authoritative aggregates.

## Design

- Extend `scripts/engine-scorecard.js`; do not add another top-level script.
- Require explicit provider-tagged roots. Provider schema recognition and model admission are
  internal and fail closed; there is no caller-selected engine/schema switch.
- Admit only exact known provider model labels (plus the bounded Gemini label shape). Secrets,
  prose, session/UUID-shaped values, unknown models, and future labels collapse to `unknown`
  until the allowlist is deliberately updated.
- Emit only aggregate counts/rates and source-availability metadata.
- Never emit raw messages, prompts, paths, session IDs, credentials, or transcript fragments.
- Keep agy token/cost unavailable; report truncation separately.
- Keep OpenCode calibration cohorts separate from general-use cohorts.
- Imported rows remain disk telemetry and cannot create a routing ladder candidate.

## Tasks

- [x] Add synthetic Codex/Grok/OpenCode/agy roots with a planted secret/content sentinel.
- [x] Implement deterministic schema parsing and aggregation.
- [x] Prove repeated import is byte-stable or idempotently supersedes the same aggregate identity.
- [x] Prove the sentinel and source paths never appear in output/store.
- [x] Prove imported data cannot produce `status:qualified` or a ladder entry.
- [x] Record unsupported/missing fields as unavailable rather than zero.

## Verification

Acceptance patterns A4 + A1:

```bash
bash hooks/tests/engine-scorecard.test.sh
```

Depth 0 may additionally perform a local aggregate-only dry run after inspecting the committed
parser. No raw output is sent to a reviewer.
