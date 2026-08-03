# Heterogeneous plan-review receipt — Platform capability trigger activation

> Outcome: **FORMAL TRANSPORT EXHAUSTED** · Semantic evidence: **Gemini READY, no second valid
> family verdict** · Generation 2: **not authorized**

## Frozen identity

- Logical plan: `platform-capability-trigger-activation-2026-08-04`
- Ticket: `platform-trigger-activation-20260804`
- Session: `platform-trigger-activation-g1`
- Frozen plan SHA-256: `db897d8f0a6f9c44a89596fb5c69d54fbf4be9fe9f7497a3df0b0467b61ce613`
- Frozen rubric SHA-256: `84bf0b4e4881964f67802b8b4f08dd1dd6206b1c73a21e243c4bf9ebbd9e6c8b`
- Frozen manifest SHA-256: `a6ef2b9a6675fb7b6ee5a6c8e0facfc172a95c4ef08eb0f91b0d5ae87f321709`
- Durable controller artifact:
  `~/.autopilot/plan-review/49fc06cb5dbe035dc6b2ae4a10a4464e01759711d8f1aa1180cf60494dfc4fc8/generation-01.json`

## Formal generation 1

The controller returned `CONDITIONAL` with
`policy_reason=required_seat_transport_exhausted`, `semantic_verdict=null`, zero findings, zero
accepted blockers, `repair_authorized=false`, and `next_generation=null`. This is terminal and was
not reset under a new ticket or logical-plan identity.

| Seat | Attempts | Transport / parser | Semantic result |
|---|---:|---|---|
| OpenAI architecture — `codex/gpt-5.6-sol@max` | 2 | Both failed before model invocation. Raw stderr: `Not inside a trusted directory and --skip-git-repo-check was not specified.` The controller spawned `dispatch-author` from an untrusted `/tmp/dispatch-plan-review-*` cwd. | Unavailable; not a finding or verdict. |
| Google operations-skeptic — `agy/gemini-3.6-flash-high@high` | 1 | Transport success; purpose-bound parser status `extracted`; raw digest `372405b6538f6ea249c00382a7e3b33a55943b9341d201d68e381f980026a3ce`. | `READY`, `findings=[]`. |

The controller correctly refused to publish the surviving single-seat semantic result as a formal
heterogeneous verdict after the required OpenAI seat exhausted.

## Same-hash supplemental attempts

These attempts reviewed or attempted to review the same frozen plan/rubric hashes. They do not alter
the formal controller state and are not counted as a generation.

| Runner / model | Result | Disposition |
|---|---|---|
| `codex/gpt-5.6-sol@max` from the trusted repository cwd | 300-second hard timeout, exit 124; stdout and last-message both zero bytes. | Transport-only failure; no partial verdict. |
| `claude-native/opus@high` | Exit 1 in 0.8 seconds; zero-byte raw capture. | Pre-model/transport failure; no verdict. |
| `claude-native/claude-fable-5@high` | Exit 1 in 0.7 seconds; zero-byte raw capture. | Pre-model/transport failure; no verdict. |
| `grok/grok-4.5` | Installed Grok 0.2.118 reported `You are not authenticated`. | Not dispatched; known-fail precondition avoided. |

## Depth-0 disposition

- No rubric-bound blocker candidates exist, so there is nothing to accept/reject and no legal
  generation-2 repair.
- Gemini's valid `READY` is retained as partial semantic evidence, not promoted to a formal READY.
- The Codex scratch-cwd defect is added to the already planned `dispatch-author` transport D3 rather
  than duplicated as a new backlog entry.
- The platform implementation plan and its four backlog items remain PLANNED, with status
  `review-transport-exhausted`; execution must not claim that the formal hetero gate passed.
