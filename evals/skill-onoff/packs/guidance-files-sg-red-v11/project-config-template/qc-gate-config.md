# qc-gate-config — per-project qc-gate forcing-function strength

> Copy to `.claude/qc-gate-config.md` in the consuming project to override.
> Resolved by [`scripts/resolve-qc-gate.sh`](../scripts/resolve-qc-gate.sh), which the
> `.githooks/pre-push` hook and `finish-flow` both consult. Sibling of
> [`doa-config.md`](doa-config.md): DOA governs *dispatch authority*, qc-gate governs
> *whether a merge/push to a protected path requires review evidence*.

This is the **anti-skip forcing function**: it makes "merged/pushed without a qc gate"
a loud, deliberate, logged act instead of a silent default. A hook can enforce the
*existence* of review evidence, never its *quality* — and `git push --no-verify` can
bypass it; the goal is to flip the default, not to make bypass impossible.

## Settings (one `key: value` per line; first match wins)

- mode: block
- protected_paths: skills/,agents/,scripts/,references/,hooks/
- evidence: trailer
- outcome: off
- outcome_rerun: sample
- outcome_sample: 20
- outcome_budget_s: 600

## Field reference

| Key | Values | Meaning |
|-----|--------|---------|
| `mode` | `block` \| `warn` \| `off` | `block` = pre-push exits non-zero when a protected-path commit in the push range lacks evidence (fail-closed). `warn` = print the un-reviewed commits, allow the push. `off` = no gate (process-only). |
| `protected_paths` | comma-separated path prefixes | A push is gated only when its range touches one of these. Pure docs / CHANGELOG / INDEX changes don't trip it. |
| `evidence` | `trailer` \| `artifact` \| `either` | `trailer` = a `QC-Verdict: PASS …` git trailer in some commit of the push range (added after qc passes). `artifact` = a `.qc/<sha>.verdict.json` file (reuses the `qc-panel.sh` verdict-artifact convention). `either` = accept either. |
| `outcome` | `off` \| `warn` \| `block` | Opt-in outcome stage. Default `off` (the stage is not entered). `block` refuses a protected-path push the outcome checker refuses. `warn` prints that refusal and allows the push. An unknown value resolves to `off`. |
| `outcome_rerun` | `sample` \| `all` \| `none` | How much of the recorded run the checker re-executes. Default `sample`. Anything else resolves to `sample`. `none` with `outcome: block` is treated as warn. |
| `outcome_sample` | non-negative integer | Extra non-direct suites drawn in `sample` mode. Default `20`. Anything else resolves to `20`. |
| `outcome_budget_s` | positive integer | Wall-clock budget in seconds for the re-run. Default `600`. Anything else resolves to `600`. |

## Defaults & fail-closed

Unknown / missing / unparseable config → **`mode: block`** with the protected_paths above
(matches `resolve-doa.sh`'s "unknown → fail-closed" stance). Set `mode: warn` or `off`
per project when the gate is too strict for that repo's workflow.

## How evidence gets created

After a qc gate passes (`quality-pipeline` / `finish-flow` / a `reviewer` dispatch), the
landing commit carries the trailer:

```
QC-Verdict: PASS (reviewer <agent-id>, <YYYY-MM-DD>)
```

The pre-push hook greps the push range for this trailer (or the `.qc/` artifact) and
enforces per `mode`. No trailer + protected path touched + `mode: block` ⇒ push refused.

## Outcome stage (opt-in)

Default `outcome` is `off`. The pre-push hook does not enter the outcome stage, and it does not run the checker. `mode: off` still returns before either stage, trailer or outcome, exactly as it does today.

`AUTOPILOT_QC_OUTCOME=off` skips the outcome stage only. The trailer stage still applies. Each use of that hatch while the file says `warn` or `block` prints one line on stderr. `git push --no-verify` skips every hook stage.

An unknown `outcome` value means `off`, and the resolver names the bad value on stderr.

Honest limits: suites the checker does not re-run are "claimed, not re-derived". A selector result of `full` is reported `NOT JUDGED` and is not blocked.
