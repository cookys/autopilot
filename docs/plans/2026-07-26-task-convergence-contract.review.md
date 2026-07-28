# Heto plan review — Mission Convergence Supervisor

> **Outcome**: DEPTH-0 READY
>
> **Formal controller outcome**: READY at generation 2 of 2
>
> **Current plan SHA-256**: `1d82264b51b0a361bf0db673aa6d479576c2370b11c1c2db6b39cf8918d206dc`
>
> **Frozen rubric SHA-256**: `e9dcffa05c2f9e0a96d59ce1a655b4c0cc2dbfe0b1428817b291fa98d6260e48`
>
> **Formal generation-2 plan SHA-256**:
> `d091898aecf05fe8de86e586c3095822f8c0eb684b48bdf313f8a1bda7920847`

The formal two-generation controller is terminal. The current plan hash is newer than the
formally reviewed generation-2 hash because a same-hash supplemental panel found four
independently reproducible defects. Depth 0 applied their bounded union after the generation cap;
it did not open or imply a generation 3, and the current hash was not sent back to a model.

## Formal bounded loop

Ticket: `mission-convergence-portfolio-20260726-r4`

Session: `mission-convergence-portfolio-r4`

State:
`~/.autopilot/plan-review/2f43d13ad71386cdad04694cd97ea9b46facc53a846f4a5faa075a44102190fa/`

| Generation | Plan SHA-256 | MiniMax-M3 | GLM-5.2 | Controller |
|---|---|---|---|---|
| 1 | `49832383732a063f1fb9c548bf4868e3606fbcfde5509f6cb403a54fcfbbeb92` | STOP | READY | CONDITIONAL; 8 admitted blockers |
| 2 | `d091898aecf05fe8de86e586c3095822f8c0eb684b48bdf313f8a1bda7920847` | READY | READY | READY; 0 findings, terminal |

Generation 1 admitted only rubric-bound repairs: deterministic incident fixtures, ICC transport
sequencing, reservation reconciliation, authenticated controls and closure receipts, rejection
ownership, projection binding, evidence-gated enforcement, and phase ordering. Generation 2 was
1.245242 times the baseline size, below the controller's 1.25 warning threshold.

## Same-hash supplemental panel

All supplemental seats reviewed the formal generation-2 hash. Their output did not alter the
terminal controller state.

| Family / seat | Verdict | Disposition |
|---|---|---|
| Grok 4.5 high | STOP | Admitted: active actual plus full active reservation was double-counted |
| Qwen3.8-Max-Preview | READY | Two non-blocking clarifications |
| Kimi K3 | READY | Lineage-owner clarification plus the same accounting defect |
| gpt-5.6-sol | STOP | Admitted four mechanically checkable contract defects |

Depth 0 applied one bounded union:

1. Two zero-delta campaign boundaries now deterministically produce `BLOCKED/stagnation`.
2. PRO owns readiness truth; ICC owns `PRESPEND_REJECTED/provider_readiness`; Mission only consumes
   the content-bound no-effect release.
3. Admission math uses terminal-only `durable_consumed` plus full active reservations. Active actual
   is telemetry inside its reservation and is charged exactly once at terminal.
4. Mission atomically claims and reserves before ICC, PRO, context, and WLB checks; a later
   pre-spend rejection releases the full reservation with `actual_usage=0`.
5. Mission supervisor solely owns `mission_lineage_id`; Owner Kernel stores only authority and
   provenance bindings.

## Transport evidence

No failed transport was counted as a reviewer pass:

- a `cc-shim` MiniMax attempt returned empty output with exit 1;
- a direct MiniMax advisory produced useful text but ended `stop/length`;
- Qoder emitted exact `{"verdict":"READY","findings":[]}` in scratch space but exited 1;
- Codex CLI 0.145 rejected the dispatch-author scratch directory as untrusted;
- the agy Gemini smoke timed out after three minutes.

The authoritative loop succeeded with direct `anthropic-compatible` MiniMax and GLM endpoints and
`AUTOPILOT_AUTHOR_MAX_TOKENS=60000`. The transport defects remain fail-closed backlog evidence, not
review verdicts.

## Portfolio result

The plans now have one owner per effect:

- Mission: lineage, aggregate ceilings, grants, authenticated controls, Mission terminal;
- ICC: campaign generation, mutation, findings, tests, campaign terminal, effectful intake;
- WLB: worktree occupancy, lifecycle, branch inventory, residue receipt;
- PRO: exact-tuple readiness receipt;
- LSM: task status, merge, `can_merge`, `can_close`, finish marker;
- PRS: pre-code plan-review generations;
- CTR and RSS: post-hoc telemetry and shipped finding/scope stop-loss.

Shared files are limited to thin command registration, distinct status subcommands, a
producer/consumer receipt schema, and generated Codex mirrors.

## Local deterministic gates

The final depth-0 union passes:

- `bash scripts/validate.sh` — 28/28 skills valid;
- `bash scripts/check-canonical-invariants.sh`;
- `node scripts/sync-version.js --check`;
- `node scripts/check-hook-inventory.js --check`;
- `git diff --check`.

`bash scripts/sync-codex-plugin-skills.sh --check` still reports payload drift in committed
quality-pipeline and dispatch support files that this worktree did not modify. It is a pre-existing
repository condition and was not pulled into this planning scope.
