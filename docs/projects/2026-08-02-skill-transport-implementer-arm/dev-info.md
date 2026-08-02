# Development info

- Entry level: `/l4`
- Bootstrap branch: `develop`
- Bootstrap HEAD before plan commit: `408002f608bdf67dc2b3f3a60dfe03039aef7711`
- Bootstrap/admission commit: `d8cff77d774962d911aa102b1bad3c8b1819d02d`
- Execution branch: `feat/skill-transport-implementer-arm-l4-20260802T025510Z`
- Execution worktree: private `/tmp` worktree created from the admission commit; no main-checkout implementation edits
- L4 run id: `l4-skill-transport-implementer-arm-20260802T025510Z`
- Foreman continuity: the existing `backlog_convergence_foreman` transcript was reattached twice; after a second bounded no-progress window, depth-0 interrupted it and acquired generation 3 on the same branch/worktree instead of dispatching a replacement implementer
- Authoritative verifier: depth-0 independent QC, never the implementer or foreman
- External effects: model dispatch only; no push, PR, release, production change, or publication

## Frozen execution tuple

- Seed: `20260802`
- Implementer: `codex / gpt-5.3-codex-spark / high`
- Reviewer preference: `claude-opus / claude-native`, then `Gemini 3.6 Flash (High) / agy` only before cell 1
- Selected reviewer: `Gemini 3.6 Flash (High) / agy / high`; Opus failed readiness because the local account could not access the alias
- Pack SHA-256: `3f29d5fd224d45ac96630e642fa9ada1f24446d538b6c2b2ed020ad3f8a7beca`
- Canonical dispatch SHA-256: `ec7d71d66fa5a81ecbc2fa49a429d2360aa4a43f4c73b315ea2681d91bcc5d0a`

## Harness note

The historical plan described a pack file path, but current `dispatch-hetero.sh --skill`
accepts only a slash-free skill name. Production scripts and the frozen pack were not edited.
The evaluation runner creates a private adapter root whose dispatcher/support files resolve to
canonical repository bytes and whose `skills/implementer-pack/SKILL.md` resolves to the frozen
fixture. Both arms traverse the adapter; only the pack arm enables prompt transport.

The initial schedule-position-1 attempt found a harness stdin bug: agy inherited the driver's
schedule stream and prefixed the remaining 15 rows before an otherwise valid wrapped verdict.
That attempt was quarantined in the private run store and never counted. The driver now gives
both dispatchers `/dev/null` stdin, the mechanics fixture asserts EOF, and the official complete
arm was restarted at the same seed.

## Verification commands

```bash
bash evals/skill-transport/test/implementer-matrix-mechanics.test.sh
node evals/skill-transport/implementer-report.js \
  --in evals/skill-transport/results/implementer-matrix.jsonl --json
bash evals/skill-transport/assert-instruments.sh
bash evals/skill-transport/test/matrix-mechanics.test.sh
```
