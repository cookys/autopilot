# A grok process under this session tree loaded the fleet server

BL-0324. Source: bltidy20 handoff list, 2026-10-28 (self). Searched BACKLOG, docs/backlog and docs/plans for grok plus fleet on 2026-10-28: no prior entry.

Observed: a grok process that started under this session's process tree loaded the fleet messaging server, so a worker engine could appear as a fleet member. The fleet side has been fixed. What the autopilot side still has to establish: which of our rails starts grok (dispatch-hetero, dispatch-review, dispatch-author, a qualification run), and whether that rail hands grok an MCP or channel configuration that includes fleet. Nothing has been traced yet.

First step: reproduce with a throwaway config directory (never the real one), list the grok child's environment and config sources, and check whether the rail should start grok with an empty MCP set, as the cleanroom rails do.
