# RC alarm

`scripts/rc-alarm.js` tracks consecutive non-zero command exits per label. A second and third failure send one notice each; later calls are blocked with exit 75 and a single blocked notice. Success clears the count and sends a recovery notice when the count had reached two. Fleet send failures only print warnings.

Use wrapping mode to run a command under the counter:

```bash
scripts/rc-alarm.js --label deploy-trigger --owner team/owner--claude -- command arg...
```

Use `--lead <address>` one or more times to override configured leads. Without any `--lead`, the `rc_alarm_lead` config list supplies them; `--owner` is added independently. No recipient is built in. State defaults to `$XDG_RUNTIME_DIR/autopilot/rc-alarm`, or `os.tmpdir()/autopilot-<uid>/rc-alarm`; `--state-dir` selects another directory. `--reset --label <label>` prints the prior count, clears the blocked marker and sets the count to zero.

Callers that already ran the command use `record --label <label> --owner <address> --rc <exit-code> [--last-line <text>]` to update the same counter and send the same notices. `check --label <label>` returns 75 and prints the blocked warning when the label is blocked, otherwise 0.

`dispatch-hetero.sh` opts in with `--rc-alarm-label <label>` and optionally `--rc-alarm-owner <address>`. `AUTOPILOT_RC_ALARM_LABEL` and `AUTOPILOT_RC_ALARM_OWNER` provide fallbacks. A blocked label stops before engine work; the final dispatch result is recorded under that label. Only this final result path is counted as a failure; early precondition or boundary exits are not counted.
