# Phase 0 notes — running log (findings as they happen; operator verdict at the end)

## F1 — "cuda/codex" is not an address the relay can reach (the biggest one)
`send_to_peer to:"cuda" all_sessions:true meta.local_target:<pane>` (what `fleet send --to cuda --local <name>` puts on the wire)
matched **7** live cuda sessions and the codex pane got nothing: three Claude sessions replied "misrouted", one answered the
question anyway. cuda's hangar-bridge config has no `final_mile`, and the cockpit's peers are the two chatgpt-tunnel adapters,
not agent-call panes — nothing on cuda turns `local_target` into a paste. So from the relay side, a non-Claude pane behind a host
with no switchboard is unreachable, and trying conscripts every Claude session on that host — the exact §6 failure the plan
names first. Workaround used: ssh to the host and `fleet local send <name>` (same-machine agent-call paste), reply path = the
pane runs `fleet send --instance <moderator>`. Consequence for Phase 1: the skill must refuse a non-Claude seat unless the host
has a verified single-pane route, or use the ssh+local paste path explicitly and say so.

## F2 — instance-narrowed MCP sends need `to:"@group"`
`send_to_peer to_filter:{instance}` without `to` is a 400 (`invalid_body`); the CLI's `--instance` sets `to=@group`. Not
documented on the tool. Phase 1 protocol.md must spell the exact call.

## F3 — a seat can be dead for reasons the roster cannot see
codex on cuda had its ChatGPT usage limit exhausted; the pane looked healthy in `agent-call list`. Only the screen said so.
Roster check in Phase 1 should include a cheap liveness probe (a one-line "say READY" paste with a 60 s deadline) before round 1.

## F4 — the Claude channel seat just works
`cr claude <name> --fresh` in a plain directory: trust prompt + channel-dev prompt (two Enters via tmux send-keys), then the
instance shows in `list_peers` within ~30 s, the instance-narrowed send matched 1, and a 250-word position came back in ~6 min
via reply_to_peer with thread_root set. This is the delivery class to build Phase 1 on.

## F5 — accidental data: a conscripted session gave the best line of the round
"Persist the artifact, not the promise" came from the misrouted cuda Claude, not from a seat. Worth remembering when weighing
"dedicated seats only": the rule is right for cost and interruption, but the fleet's working sessions do hold the context the
plan is about.

## F6 — three non-Claude harnesses on one host, two dead on quota, one refused by its adapter
codex: ChatGPT usage limit. kimi: 5-hour quota, AND agent-call's kimi adapter refused the paste ("requires a reviewed Kimi foreground
command; observed kimi desktop" — kimi 2.0.1's process name no longer matches the adapter), so delivery had to bypass agent-call
with `tmux load-buffer` + `paste-buffer -p`. grok: alive, answered in 22 s, replied through shell `fleet send --instance <moderator>`
which arrives as an ephemeral `~cli` message — the whole non-Claude class works end to end **only** via ssh+tmux paste in, shell
send out. Two consequences: Phase 1's liveness probe (F3) is not optional; and the operator's daily harnesses share quota with
roundtable seats, so a room on the operator's own hosts competes with their day.

## F7 — the room converged unanimously three times; the disagreement that survived is about placement, not shape
Three seats, three rounds, ~45 min wall, every question answered by every live seat inside its deadline (Claude seats 2–6 min,
grok ~20 s). The plan changed shape (offer/lessons split, tool-written stub + one-line asker obligation + gate, falsifiable P4). A
conscripted-by-accident session contributed the framing line of the room. Two things the moderator relay did that a flat chat
would not: forced each seat to attack the other side in R2, and carried R2 to a late-joining seat as a summary so R3 was still
three-way. Operator's verdict on worth (cookys, 2026-09-19): **worth it** — 「值」. Next: more manual rooms by hand before Phase 1 (BACKLOG row).

## Phase 1 consequences (from F1–F6)
- Claude channel seats are the only class the skill can address from the hub; a non-Claude seat means ssh + tmux paste in and shell
  `fleet send --instance <moderator>` out, and the skill must say so and do it, never `--to <host> --local` (F1 conscripts the host).
- Liveness probe before round 1 (F3/F6): seats die on quota with a healthy-looking registration.
- Exact MCP call shapes in protocol.md (F2): `to:"@group"` + `to_filter.instance`; replies by `reply_to_peer`.
- agent-call adapters drift with harness releases (kimi 2.0.1); the paste path should not depend on them.

## Cost
aimax395/claude seat: ctx 59,481 · out 4,985 · 9 turns (fleet-cockpit status, before /exit). cuda/claude: not separable — it is
the operator's working session. grok: not cockpit-tracked. codex, kimi: died before spending. Moderator: one hangar session,
~30 tool calls for the room itself.

## F1 — root cause (found after the room, 2026-09-19)
cuda's switchboard courier answers to the handle **`cuda-kimi`** (presence `caps` contains `switchboard`, `repos` lists what its
`agent-call list` reaches), not `cuda`. `--to cuda --local <pane>` therefore hit the host's Claude handle with `all_sessions`, and
nothing on that path reads `local_target`. `--to cuda-kimi --local <pane>` matched exactly the courier and the nonce landed in the
pane. The CLI now narrows a `--local` send to the courier instance and refuses a handle without one (dotfiles main). Two deeper
layers are in hangar BACKLOG: peers should drop foreign `local_target` envelopes; courier naming / cockpit-owned final mile is an
ADR-level choice. Corrects the Phase 1 consequence above: non-Claude seats ARE addressable from the hub — through the courier.
