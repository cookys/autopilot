# band 加一個 fleet 分頁，由 autopilot 畫 (BL-0358)

Source: codeforge peer report 01M69BHRJMNZ6XRXEERDTX62KG, 2026-11-01.
Decision: the owner chose "fleet tab is drawn by autopilot" on the codeforge card d-d99e2d99.

## Problem
The owner wants to see fleet state directly on the band. Today it takes a terminal and a command.

## Content direction
- Online peers.
- Unread messages.
- Number of `fleet approve` requests waiting for the owner.
- Claims.

## Red line (keep verbatim)
`fleet approve` is a human-only gate that passes only on a tty. The tab must NOT carry an approve button. It may only show how many requests are waiting and the command to type.

## Research first
- How does a mod obtain fleet state? A mod cannot call MCP tools.
- Check whether the fleet CLI has a readable JSON output or a state file (for example `fleet peers --json`, inbox, claims).
- Reading must never block a band redraw: cache the result and use a timeout.

## Layout
Per the owner rule, build a real-terminal preview first and let the owner choose. Colours follow design-system section 12 (docs/plans/2026-10-13-live-pane-design-system.md): one colour one meaning, colours only through PALETTE.

## Relation to BL-0356 (extension mechanism)
The fleet tab is an autopilot-owned tab and need not wait for the extension contract. It must still mount the same way BL-0356 plans for tabs, so nothing needs rework later.

## Trigger
After 3.0.0-alpha.7 ships (avoids mods path changes during the move), or evaluate together when the BL-0356 plan is written.
