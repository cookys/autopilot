# GLM-5.3 / GLM-5.4 qualification, round 5 (2026-11-25)

Conditions: thinking off, anthropic-compatible `/v1/messages` on `api.z.ai`, `QRP_CN_WORK_TIER=T1` declared by the
host cell script after a leak-scan of the synthetic corpus (0 findings, planted-path negative control red), no scorecard write.
develop at run: 93a4e7b7 (provider reads QRP_CN_WORK_TIER; api.z.ai classified as zhipu).

| role | GLM-5.3 | GLM-5.4 |
|---|---|---|
| verification_author | qualified, evaluation_passed, 3 subjects true, false_pass_critical 0 (evidence 7702103c) | same (evidence 618d6ed7) |
| reviewer | degraded, not passed (evidence 04b696df) | degraded, not passed (evidence 797bd36b) |

Reviewer failures: known-bad sensitivity miss, panel result not `{verdict,findings}`, witness call outside the case domain,
defect-reversal mutation control failed. PM ruling 01M89NZGZZ: reviewer is not listed; retest on the next GLM version.
Raw cell outputs stay in /home/team/.tmp/glm-qual/cells/r5-* (not committed).
