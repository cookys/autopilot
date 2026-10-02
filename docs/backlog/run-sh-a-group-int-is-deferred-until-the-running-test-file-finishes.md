# run.sh: a group INT is deferred until the running test file finishes

Source: tsflake hand, 2026-10-03 (wave-B S fixes row 5).

- **Trigger**: next run.sh touch.
- **Context**: `timeout` puts each test file in its own process group, so a group INT sent to the suite is only acted on by bash once the running foreground test file finishes; the fix for the intermittent SIGINT 130 case (python3 SIG_DFL reset + setsid) does not change this deferral. Decide whether the outer should signal each file group directly.
- **Effort**: S
