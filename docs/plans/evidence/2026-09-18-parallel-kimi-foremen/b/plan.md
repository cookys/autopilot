# Plan B — verify station scrubs dispatcher session identity; suites pin their own
1. RED: engine case (injected verifyCommandRunner sees AUTOPILOT_SESSION_ID); mission-runtime-v2 red under a foreign AUTOPILOT_SESSION_ID.
2. GREEN: scrub in verificationEnvironment; suite pins its own session id.
3. Sync mirror; verify list (+ the foreign-variable run); one commit on the hands branch.
Acceptance: a dispatcher that exports AUTOPILOT_SESSION_ID no longer turns the rail's verification red.
