Recommend two `/l5` deliverables:

1. `A1 — managed-panel blind-capability admission`
2. `B+C — proof-contract parity and rejected-output recovery`

Keep A2 as a bounded qualification spike that gates a later change. Do not add A3 to the authoritative panel contract; if advisory seats are ever wanted, they should be explicitly non-authoritative and excluded from `min_panel_size`.

## Deliverable 1: A1 pre-spend admission

Add a named `isBlindDiscoveryCapableRunner()` capability representing the current runtime allowlist:

- `qoderclicn`
- `cc-shim`
- `claude-native`
- `anthropic-compatible`

Use it in [campaign-intake.js](/home/cookys/projects/autopilot/src/engine/campaign-intake.js:1413) before any mission/generation claim. Keep the runtime guard in [dispatch-review.sh](/home/cookys/projects/autopilot/scripts/dispatch-review.sh:288) unchanged as defense in depth.

Use a distinct rejection such as `final_panel_seat_blind_incompatible`, in the same pre-spend class as `final_panel_seat_unqualified`. Reusing “unqualified” would prescribe the wrong remedy: a standing pin can fix qualification, but cannot make `codex` blind-capable.

The diagnostic should name the exact seat and say that pins/overrides do not bypass containment:

> qc_panel[0] gpt-5.6-sol/codex cannot execute a managed blind-discovery review; replace it with a blind-capable seat or complete the codex containment qualification.

`resolve-review-loop.sh --check-scorecard` should:

- Remain report-only and exit successfully.
- Add the warning to `capability_warnings[]`.
- Emit the same indexed tuple as a `⚠` line on stderr.
- Emit nothing when `--check-scorecard` is absent.
- Never suggest another pin as the remedy.

Prefer one canonical capability predicate. If Bash and Node retain separate literal lists, add a parity test against the actual `AUTOPILOT_BLIND_DISCOVERY=1` runtime behavior.

A1’s deliberate remaining failure is availability: with `min_panel_size=3` and exactly three seats including pinned `codex`, every managed campaign will now stop immediately. Removing codex leaves only 2/3 seats. A1 prevents the expensive late failure; it does not restore the operator’s desired three-seat panel.

### A2 spike requirements

Do not reuse the agy `--ro-bind / /` shape: that exposes the whole repository read-only and therefore does not provide outcome blinding.

The spike must prove:

- A live Codex API call succeeds inside the outer `bwrap`.
- The namespace contains only the scratch inputs, required executable/runtime libraries, TLS/DNS material, and a minimal sanitized Codex auth/config view.
- The real repository, sibling worktrees, home directory, `/tmp` artifacts, parent file descriptors, and host paths through `/proc` are inaccessible.
- Symlinks from the scratch directory cannot escape its mount namespace.
- Only required auth material is exposed; session history, logs, skills, MCP configuration, and prior transcripts under `~/.codex` are not mounted.
- Codex cannot use a shell, `git`, `curl`, web search, or MCP to reacquire the repository. Keeping network for the API is insufficient unless tool subprocess network egress is separately denied or restricted.
- Outer `bwrap` and Codex’s own `--sandbox read-only` work together; nested sandbox initialization must not silently degrade.
- Prompt ingestion, stdout/stderr capture, timeout, signal handling, exit status, `raw_log`, model, and effort remain equivalent to the existing codex rail.
- Missing `bwrap`, missing mounts, config drift, and unsupported Codex versions fail before spend.
- The probe records Codex version, bwrap version, kernel/user-namespace requirements, and the discovered file dependency set.

Only after those adversarial probes pass should `codex` enter the blind-capability allowlist. On non-bwrap hosts, A1 remains the correct fallback.

A3 weakens the central property. If implemented later, an advisory codex observation must not count toward the authoritative panel or its minimum size.

## Deliverable 2: B and C together

### B: align proof validation

Agree with the proposed direction. Node has no reason to retain a stricter separator grammar. Separator punctuation carries no integrity value, and the shell has already declared these forms contract-valid.

Use equivalent anchored grammars, preferably accepting one-or-more separator characters:

```text
Bash: ^checked=(.+)[[:space:];,.]+evidence=(.+)[[:space:];,.]+conclusion=(.+)$
Node: /^checked=(.+)[\s;,.]+evidence=(.+)[\s;,.]+conclusion=(.+)$/u
```

Then trim captures and apply the same blacklist independently to all three fields.

Return distinct failures:

- Shape failure: ordered labels are missing, a value is empty, or an allowed separator is absent.
- Semantic failure: a parsed field normalizes to a blacklist entry.

Normalizing the shell output to semicolons is acceptable as an additional canonicalization step, but it should not justify keeping [review.js](/home/cookys/projects/autopilot/src/runners/review.js:48) semicolon-only. Node is an independent validation boundary, and the accepted contract should not depend on which producer serialized it.

Drive both validators from one shared test-vector table. Required valid rows:

- Semicolon separators.
- Period separators.
- Comma separators.
- Whitespace-only separators.
- Mixed punctuation plus whitespace.
- A semicolon inside a substantive field value.

Required invalid rows:

- Missing or reordered label.
- Unsupported separator such as `|`.
- Empty value for each field.
- Every blacklist entry substituted into each of the three fields, with the other two remaining substantive.

### C: constrained salvage

Agree, with two provenance guards.

On a validation failure in [dispatchReviewJson](/home/cookys/projects/autopilot/src/runners/review.js:228):

- Keep `result: null`.
- Keep the original `parseError`.
- Perform schema-lenient, not text-lenient, parsing: `JSON.parse(stdout.trim())`. Do not scan arbitrary prose for JSON.
- Salvage only a non-empty string `raw_log`.
- Derive `runner` and `model` from the invocation arguments/transport envelope, not from the rejected envelope.
- Do not salvage `status`, `verdict`, `findings`, `no_finding_proof`, `usage`, or `unratified_verdict`.

Suggested internal shape:

```js
{
  result: null,
  parseError,
  salvaged: {
    runner: requestedRunner,
    model: requestedModel,
    raw_log: rejectedEnvelope.raw_log
  }
}
```

Propagate `raw_log` to the engine’s blocked/no-verdict result and to the failed seat receipt built in [autopilot-engine.js](/home/cookys/projects/autopilot/src/engine/autopilot-engine.js:4986).

Make `raw_log` an optional diagnostic field on the closed final-panel-seat shape:

- Old v1 receipts without it remain valid.
- Failed new receipts include it when salvage succeeds.
- Successful receipts can continue omitting it, preserving their stable shape/digest.
- When present, include it in the receipt digest like other fields.

I found no current review/campaign consumer that treats `raw_log` presence as verdict authority. Authority comes from `result`, `status`, `verdict`, and `review_digest`. Nevertheless, add an explicit regression because the seat schema and exact-key validation in [campaign-composition.js](/home/cookys/projects/autopilot/src/engine/campaign-composition.js:315) and [implementation-campaign-receipt.schema.json](/home/cookys/projects/autopilot/schemas/implementation-campaign-receipt.schema.json:210) must be updated carefully.

## Red-first assertions

| Defect | Assertions that prove behavior changed |
|---|---|
| A1 intake | A fully qualified/pinned codex seat returns `final_panel_seat_blind_incompatible`; `missionClaim`, `claimGeneration`, implementation dispatch, and review dispatch counters all remain zero. |
| A1 non-bypass | Adding `override_admitted_seats: ["qc_panel[0]"]` still cannot admit codex for managed blind review. |
| A1 control | Replacing codex with `cc-shim` using the same otherwise-valid roster reaches admission. |
| A1 resolver | `--check-scorecard` produces a structured warning naming `qc_panel[0] gpt-5.6-sol/codex`; without the flag, that warning is absent. |
| B acceptance | Every valid proof vector passes the shell battery and then `parseReviewOutput`, yielding `status:"reviewed"` and the original verdict. |
| B error class | Bad separators produce the shape message; syntactically valid blacklist values produce only the tautology message. |
| B field safety | A substantive semicolon inside `checked`, `evidence`, or `conclusion` does not truncate or reject the proof. |
| C salvage | A syntactically valid JSON envelope rejected only by proof validation returns `result:null`, non-null `parseError`, and the exact `salvaged.raw_log`. |
| C strictness | Malformed JSON yields no salvage; wrong-typed `raw_log` yields no diagnostic locator. |
| C authority | Even if the rejected JSON claims `SHIP-AS-IS`, no verdict/status/findings are copied into `salvaged`. |
| C panel | A final seat with salvaged `raw_log` remains `status:"no_verdict"`, has null verdict/digest, is excluded from `final_panel_count`, and blocks the panel while preserving the log path. |
| C compatibility | An old seat receipt without `raw_log` still validates; a failed receipt with it also validates and its digest detects path tampering. |

## Expected suites

For A1:

```text
hooks/tests/implementation-campaign-state.test.sh
hooks/tests/implementation-campaign-routing.test.sh
hooks/tests/resolve-review-loop.test.sh
hooks/tests/resolve-review-loop-standing-pin.test.sh
hooks/tests/resolve-review-loop-qc-panel-rejection.test.sh
hooks/tests/dispatch-review.test.sh
```

For B+C:

```text
hooks/tests/review-runner.test.sh
hooks/tests/dispatch-review.test.sh
hooks/tests/autopilot-engine.test.sh
hooks/tests/implementation-campaign-routing.test.sh
hooks/tests/implementation-campaign-receipt.test.sh
hooks/tests/qc-panel-honesty.test.sh
hooks/tests/status-task.test.sh
scripts/check-canonical-invariants.sh
scripts/validate.sh
scripts/sync-codex-plugin-skills.sh --check
```

The evidence-first debug discipline materially drives this split: A is an admission/execution-capability mismatch, while B+C are one parser-boundary failure chain. Each deliverable therefore gets a reproduction that turns red on state and authority, not merely on diagnostic wording.
