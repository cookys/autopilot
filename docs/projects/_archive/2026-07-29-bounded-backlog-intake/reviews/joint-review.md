# Joint review — bounded backlog intake

Status: **COMPLETE (4/4 authorized seats authored; bounded MVP selected)**

This is one frozen review generation over the eleven admitted candidates. It is not an
implementation plan and does not authorize candidate work. Qwen failed before model execution;
the user explicitly authorized Grok 4.5 as the replacement fourth seat.

## Engine outcomes

| Requested seat | Transport outcome | Review outcome |
|---|---|---|
| Kimi K3 (`kimi-code/k3`) | Authored through native Kimi 0.28.0 in an isolated empty cwd. The shipped adapter's `--prompt --plan` combination was rejected, so this attempt omitted interactive `--plan`; no repository was exposed. | `CONDITIONAL`; selected the durable recovery stack as the minimum blocker. |
| GLM 5.2 (`GLM-5.2`, `cc-shim/glm`) | Authored successfully. | `CONDITIONAL`; selected panel honesty, durable recovery, and boundary outcome handling. |
| MiniMax 3 (`MiniMax-M3`, `cc-shim/minimax`) | Authored successfully. | `CONDITIONAL`; one central claim about finding disposition was rejected during depth-0 verification. |
| Qwen 3.8 Max (`Qwen3.8-Max-Preview`, `qoderclicn`) | **Unavailable and replaced by explicit user direction.** Before re-login, Qoder loaded the exact model and returned HTTP 403/code 112 with the pricing URL before consuming any input token. After re-login and upgrade to CLI 1.1.7, the same account (`cookyss`) returned `You've reached your credit usage limit`, and `--list-models` still reported no available models. | No review. This is an account-credit/entitlement failure, not `no-finding`. |
| Grok 4.5 (`grok-4.5`, native Grok) | Authorized replacement; exact model listed and an isolated tool-disabled probe returned `OK`, followed by a complete frozen-matrix response. | `CONDITIONAL`; selected panel honesty, compaction identity, and rotation-aware ledger state. |

The empty Qoder model listing was not used as the failure oracle. The decisive evidence is the
actual exact-model request and its server-side 403 response.

## Final candidate matrix

`Score` is the four authorized authored seats' mean of `(acceptance + risk + value) / 30`, rounded
to the nearest integer. The frozen bands remain 80–100
`keep-now`, 55–79 `follow-up`, and 0–54 `cut`; dependency admission can promote a follow-up.

| ID | Candidate | Score | Final disposition | Minimum bounded correction and close oracle |
|---|---|---:|---|---|
| C1 | Exact-tuple capability probe/admission parity | 62 | follow-up | Make the live probe write the exact identity consumed by strict admission. A current tuple admits; a legacy-only tuple fails pre-spend with a named reason. |
| C2 | Output-path existence and mirror-closure preflight | 45 | cut | Keep the existing manual pre-spend graph check. Trigger only on another impossible path or incomplete version-mirror closure; then add a structural rejection test. |
| C3 | First-class boundary-rejected outcome | 71 | follow-up | Preserve the boundary result and reason instead of mapping it to unknown/mutation failure. A forced boundary stop retains its class; an actual transport failure does not. |
| C4 | Resumable finding-disposition wait | 57 | follow-up | Park valid findings in an explicit awaiting-disposition state and resume after authority arrives. Missing finding identity/schema must still hard-stop. |
| C5 | Minimum QC panel-size enforcement | 83 | keep-now | Refuse acceptance when the final panel is below the sealed minimum. A three-seat/minimum-three run with one valid response fails; a complete panel passes. |
| C6 | Resume projection and no-op adoption | 51 | cut | Continue the manual successor-graph control. Trigger on another historical-output replay or no-effect attempt; adoption must require byte-equal, receipt-backed satisfaction. |
| C7 | Compaction rehydration and dispatch idempotency | 87 | keep-now | Persist and rehydrate the authoritative phase/identity, then key duplicate dispatch to that identity. Replay the 16/34 incident and prove the phase stays 16/34 with zero duplicate dispatch. |
| C8 | Retained-worktree lease and outcome disposition | 47 | cut | Continue explicit depth-0 disposition. Trigger on retained-budget exhaustion or an unowned/expired retain; never delete dirty or unknown evidence. |
| C9 | Managed-campaign orphan mutation adoption | 76 | follow-up | Prove the old controller dead, verify leaf/git identity, atomically adopt the same mutation, and resume without redispatch. A foreign or inconsistent mutation must remain blocked. |
| C10 | Rotation-aware active campaign ledger view | 83 | keep-now | Give every campaign/state/lease/journal reader the same locked rotation-aware view. Forced rotation during a live campaign must keep it found; an absent ID remains not-found. |
| C11 | Session-local exact-role qualification provider | 65 | follow-up | Add exact-role, session-local qualification authority without promoting from transport alone. A qualified exact tuple admits; transport-only and wrong-role tuples remain rejected. |

Depth-0 rejected MiniMax's finding-disposition claim because it inverted the recorded current
behavior: the backlog states that missing authority **terminal-stops** today and the requested
correction is a resumable wait. That seat's score and blocking claim for this candidate are excluded
from the adjudicated conclusion; the displayed score uses the three accurate authored seats for
this row.

## Final maximum-value portfolio

Two independently closable implementation plans are justified:

1. **Durable continuation identity** — first make active-ledger reads rotation-aware, then implement
   compaction rehydration and dispatch idempotency. Close only when forced rotation preserves the
   active campaign and the 16/34 replay resumes exactly once at the correct phase.
2. **QC panel honesty** — enforce the sealed minimum panel at finalization. Close only when an
   undersized panel cannot emit acceptance and a complete panel remains successful.

Dependency DAG:

```text
rotation-aware ledger → compaction-safe identity

minimum panel gate
```

This is a gated union, not the raw union of reviewer suggestions. Exact-tuple probe parity,
output-path preflight, resumable disposition, no-op adoption, retained-worktree leases, and
session-local role qualification stay in their existing trigger-bearing backlog entries; no
duplicate backlog items are opened.

## Bounded-review gates

- Blocking criticism is capped at three per seat and must include a smallest correction.
- A seat with no blocking criticism must identify all inspected candidates and observed evidence in
  a structured no-finding proof. Bare `PASS` is invalid.
- None of the four authored seats reported no findings, so no no-finding proof is applicable.
- The failed Qwen request cannot satisfy the no-finding gate because it performed no model review.
- The four-seat matrix is complete through the user-authorized Grok replacement.
- This artifact closes review intake only. Implementation-plan creation, implementation, release,
  merge, and push require a separate authorized workflow.
