# Mission stays not ready after a section 11 downgrade

Reported by codepower twgs-revival (report 01M59ZPRRAH8CGMG59HHD8816N, reply 2026-10-19 01M59ZQBD887MCS212ZQY3MYDX).

- After a section 11 downgrade followed by record-integration, the mission graph still judges the mission not ready.
- There is no way to mark the node terminal.
- Cross-reference BL-0220 (Managed rail: no_verdict leaves the phase in REVIEWING and resume refuses).

## Status 2026-10-23: BLOCKED

The repo has no "section 11 downgrade" concept, so the case cannot be reproduced from here. Ask codepower twgs-revival for a minimal repro: the graph file, the node id, the record-integration receipt, and the raw output of the check script. The fleet MCP connection was down, so the request has not been sent.
