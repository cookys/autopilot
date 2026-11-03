# Guidance cut gate is red on develop and not wired into preflight

BL-0272. From merge 215d9084c (dwire): wiring check-guidance-eval into preflight was skipped.

- check-guidance-eval run with base 3.0.0-alpha.3 exits 1.
- Cause: the digest of references/evidence-discipline.md does not match the eval pack.
- The gate requires a base. Preflight has no fixed 2.x baseline.

Trigger: after deval phase 2's pack covers every manifest file that differs from the 2.x baseline. Trigger-Type event.
