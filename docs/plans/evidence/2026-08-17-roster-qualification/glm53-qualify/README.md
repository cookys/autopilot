# GLM reviewer qualification — glm-5.3 first sitting (2026-08-17)

BACKLOG "Reviewer-seat full qualifications" GLM leg. Planned as a GLM-5.2
re-attempt; the pre-run probe showed the z.ai endpoint resolves the `glm-5.2`
request to runtime model id **glm-5.3** (alias upgraded upstream). Honest identity
follows the runtime id, so this is **glm-5.3's FIRST full evaluation** (its own
acceptance), requested explicitly as `glm-5.3` to avoid mid-run alias drift — not
a rerun of the GLM-5.2 2026-08-16 failure (which stands as recorded: scorecard
event 139, one clean false positive).

## Identity + fingerprint derivations (recorded)

- model glm-5.3, model_version glm-5.3-20260817 (runtime probe, this session),
  runner anthropic-compatible @ node-direct-http-fetch, family zhipu, effort high.
- harness_version = `engine-qualify-<first8 sha256(scripts/engine-qualify.js)>`
  = `engine-qualify-e9eb3890`.
- prompt_config_hash = sha256(SYSTEM_PROMPT in qualification-review-provider.js)
  = `3cbe203c…` (unchanged since the GLM-5.2 run — byte-verified).
- semantic_fingerprint = sha256(canonicalJson({kind:
  'reviewer-semantic-surface-v1', model:'glm-5.3',
  transport:'anthropic-compatible-http', endpoint:'glm'})) = `b4d2079f…`.
- containment_fingerprint = sha256(canonicalJson({kind:
  'reviewer-containment-surface-v1',
  exam_transport:'qualification-case-broker-networkless-bwrap',
  credential_isolation:'broker-env-allowlist-http-token'})) = `8b46dca1…`.
- Note: the 2026-08-16 GLM-5.2 run's fingerprint recipes were never recorded and
  proved unrecoverable; recorded derivations are the convention from this run on.

## Result — FAILED (recorded honestly; not re-run)

Full run, 2 trials, wall 449 s (sample), corpus
`reviewer-known-bad-clean-v2.reviewer-metamorphic-v4`:

| Trial | Sensitivity | Clean specificity |
|---|---|---|
| 1 | 20/21 known-bad (missed known-bad-07) | 2 false positives (clean-06, clean-04) |
| 2 | 21/21 | 2 false positives (clean-06, clean-04) |

Both trials fail the `max_clean_false_positives=0` bar; trial 1 additionally has a
sensitivity miss. Aggregate 41/42 corpus pass, `false_pass_critical=0`,
specificity 4/38. **glm-5.3 sits WORSE than the glm-5.2 sitting of 2026-08-16**
(one clean FP) — the upstream alias upgrade regressed clean-case precision on this
corpus, and clean-04 is now a repeated offender across both identities. Recorded
as qualification-evidence event 2 (`state: degraded`) and scorecard event 140
(`status: failed`). Per the anti-flake design, this evaluation is spent: a future
attempt is a fresh evaluation with its own acceptance.

- Row JSON: `qualify-out.json` (`--emit-row` stdout); verdict + exit:
  `qualify-err.log`.
