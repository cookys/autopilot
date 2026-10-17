# opencode v2 adaptor follow-ups (BL-0208)

Left open by the oc2 review of the opencode v1/v2 adaptor split (commit 9883b6397). Source: hetero-review-loop ledger, generation 1 aa784ab5, generation 2 95279be8 / 3b543bc0 / b311744d. Background: the spike report and the "OpenCode 2.x adaptor" section of `references/multi-agent-portability.md`.

## 1. OPENCODE_PERMISSION is not cleared

Neither adaptor in `scripts/lib/opencode-containment.js` strips `OPENCODE_PERMISSION` from the inherited environment (true since v1). If that variable outranks the injected `OPENCODE_CONFIG_CONTENT`, an operator-set value could widen a reviewer's tool permissions. This is inference only; nothing has been measured.

Measure on opencode 2.0.32 in a throwaway directory:
1. Set `OPENCODE_CONFIG_CONTENT` to a config that denies every permission.
2. Set `OPENCODE_PERMISSION` to an allow-all value in the same environment.
3. Ask the run to read a file. If the read tool executes, the env var wins and must be added to the cleared-variable list (for both adaptors, with a negative-control test). If it is refused, record the result and close this item.

## 2. Probe seat root

`scripts/probe-engine-capability.sh` builds the v2 seat root as `"$PROBE_CWD.oc"` followed by `mkdir -p`. Replace it with a second `mktemp -d` so the path cannot collide with or be pre-created by something else.

## 3. Dead ternary in the test

`scripts/lib/opencode-containment.test.js` has a ternary whose two branches both return an empty string. Remove it (replace with the plain value).
