# BL-0253 — agy 1.4.2 headless large output does not exit

Reported by codepower. Report `01M5AMCPARPY10G4GYCJAKT80X`. Reply `2026-10-20 01M5AMDBG5B1ZDDVFD1CPTKM3Y`.

With agy 1.4.2 in headless mode, a large output (roughly 6k or more output tokens) prints the SUCCESS envelope and then the process stays alive until an external timeout. agy 1.2.1 does not do this.

autopilot's dispatch-review agy seat waits for process exit before parsing, so it is probably affected. That is not verified.

Suggested fix: once a fully closed envelope with status SUCCESS is detected, allow a grace period, then send TERM and then KILL to the process group, and record the result as `forced_exit`.

Also record the upstream issue google-antigravity/antigravity-cli#582: since 1.1.1 the text print mode does not read stdin.

## 2026-10-23: hands parked on background tasks

agy-served `claude-sonnet-5-5-low` hands parked on their own background tasks ("root agent idle; waiting up to 40m0s for N background task(s)") until the dispatch wall timeout: unit tintacc twice with zero useful output, unit tokrace twice after committing. A foreground clause in the prompt did not prevent it. Short tasks completed normally.
