# Registry reader follow-ups from the relay2 review (BL-0349)

1. suite-baseline-literals (753bac21): tools/migrate/suite-baseline.js hardcodes scripts/affected-suites.js, scripts/tests/ and mods/*/run-tests.sh instead of registry keys. Adopt the registry at P3 and P4 when those roots move.
2. plans-explicit-global-sticky (1e396ce2): check-plan-graduation.js run() sets module-global PLANS_DIR_EXPLICIT to true and never back. Fix: `PLANS_DIR_EXPLICIT = Boolean(opts.plansDir)` in run.
3. idnamed-plansdir-semantics (f162da8f): with --plans-dir, idNamedInPlan reads that tree (plan and _archive) instead of fixed docs/plans plus the registry archive. Default invocation is unchanged. Note it in CHANGELOG as a deliberate behaviour change.
4. key-count-drift (5ca6c335): the registry has 38 keys (codex_platform_dir and codex_hooks_dir added for the one-way prefix check) where the spec says 36; the first CHANGELOG bullet says 38 though it describes the commit-1 state. Align spec and CHANGELOG wording.
