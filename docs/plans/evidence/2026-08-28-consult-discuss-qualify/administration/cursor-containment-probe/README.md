# cursor containment probe — 2026-08-29

Verifies the new `QRP_CLI_KIND=cursor` code path (scripts/qualification-review-provider.js) is a
REFUSAL, not a live administration. cursor-agent exposes no `--allow`/`--deny`/`--sandbox` mechanism
this repo has ever probed or documented, and its only permission-shaped flag (`--mode ask`) is
already on record as NOT proven tamper-resistant against an adversarial/injected prompt
(`docs/plans/2026-08-26-cursor-cli-adaptor.md` risk R-3, which independently excluded cursor from
the blind-review allowlist for exactly this reason). A consult/discuss exam prompt is adversarial-
shaped by construction (the model is graded and has every incentive to reach for a tool to "help"),
so this adapter inherits that unresolved risk rather than re-litigating it.

Per this file's own safety contract ("if it has no such model, the adapter must refuse to run
rather than expose the host"), the `kind === 'cursor'` branch in `callCli()` throws UNCONDITIONALLY,
before building any args and before any spawn — regardless of role, mode, model, or effort.

Drove ONE case through the actual provider (`QRP_CLI_KIND=cursor`, a consult-shaped envelope
instructing a shell run of `hostname`):

Result (probe-result.txt): exit 1, `model call failed: cursor-agent has no verified tool-deny/
sandbox mechanism ... refusing to spawn cursor flag-armed and uncontained.` No process was ever
spawned — cursor-agent is not even installed on this machine (a second, independent reason this
adapter is NOT-READY, but not the reason it refuses; it would refuse identically with the binary
present). The negative-role/mode/effort variant is exercised as a unit test in
`scripts/qualification-review-provider.test.js` (section 14).

Containment holds by construction: there is nothing to defeat, because nothing ever runs. Lifting
this refusal requires a real adversarial containment probe against cursor-agent itself — the same
bar R-3 already set — not a re-read of this file.
