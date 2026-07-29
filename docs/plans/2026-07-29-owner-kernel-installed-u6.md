# Owner Kernel installed activation U6

> Depends on: installed activation U5
> Scope: one installed Engine sink, low-risk dogfood, and release-gate disposition

## Deliverable contract

Extend the U5 installed authority vertical with exactly one Engine action,
`engine-implementation-dispatch-v1`, and the P2 coordinator-v2 acceptance transaction.

The installed host must bind intake, owner decision, delegation, implementation dispatch,
verification, independent challenge, reconciliation, abort/resume, final manifest, acceptance, and
complete into one witnessed v2 ledger. `AutopilotEngine` `committed` or `converged` is input evidence,
never acceptance. Acceptance and complete are one atomic witnessed batch over the immutable delivered
manifest.

Run the complete eight-attack and fifteen-category production corpus against the installed route, with
scenario-specific and mutation-proven oracles. Then run low-risk self-hosted dogfood for project default,
one-run override, session replacement, conservative policy, abort/recovery, exact disclosure, and the
one fixed Engine sink.

Release-gate tooling must report KR8, KR10, alias-retirement readiness, and every blocking reason from
mechanical evidence. It must not redefine KR10, manufacture 14 elapsed days, treat fixture telemetry as
production telemetry, or delete compatibility aliases. A real KR10 failure or incomplete 14-day gate is
an explicit terminal `HOLD`, not a fabricated pass.

### Required mutations

- `src/engine/supervised-owner-kernel-installed-engine.js`
- `scripts/check-owner-kernel-release-gates.js`
- `hooks/tests/supervised-owner-kernel-installed-engine.test.sh`
- `hooks/tests/owner-kernel-installed-dogfood.test.sh`
- `hooks/tests/owner-kernel-production-corpus.test.sh`
- `hooks/tests/owner-kernel-release-gates.test.sh`
- `hooks/tests/owner-kernel-alias-retirement.test.sh`

### Acceptance commands

```bash
bash hooks/tests/supervised-owner-kernel-installed-engine.test.sh
AUTOPILOT_P37_DOGFOOD=1 bash hooks/tests/owner-kernel-installed-dogfood.test.sh
bash hooks/tests/owner-kernel-production-corpus.test.sh
bash hooks/tests/owner-kernel-release-gates.test.sh
bash hooks/tests/owner-kernel-alias-retirement.test.sh
node scripts/check-owner-kernel-release-gates.js --project docs/projects/2026-07-20-owner-kernel-governance --check
git diff --check
```

## Boundaries

- The Engine catalog contains exactly one installed implementation-dispatch action.
- No external push, publish, deployment, send, charge, or downstream mutation.
- No alias deletion before a real shipped compatibility cycle and 14 complete witnessed days.
- No named model qualification claim without fresh role-specific evidence.
- P4 remains a separate post-activation release.
