# l5g driving notes (2026-10-05, gate-sandbox2, resumed session 6bae5b13)
- Launch 13:51:45Z with --resume; session id and marker unchanged, no new marker. Message sent 13:52:10Z.
- Driven /l5 ran prepare+grant (one command), read campaign.json, wrote brief-hand.md (sed -i trim of 2 lines), then engine implement-review in background with env -u AUTOPILOT_SESSION_ID only (verified in the dialog text). Marker root job-1791208074-91773e8e vs contract root mission-0d79866fc5e39773fe6d63e1: differ.
- Campaign finished in ~5 min (rc=0, status converged, phase campaign_terminal_ready, verdict SHIP-AS-IS, 4-seat final panel all SHIP-AS-IS, no findings). The band stayed 待命 throughout; envelope.json runs [] (scope is the marker's job root, campaign runs are under the mission root).
- Depth-0 session polled/inspected by itself despite "do not poll" (read-only dialogs); every dialog approved by box-text match.
- Cell l5g-running capture hit a read-only inspection dialog (panel 要你決定), not the live-hand state; hand/review runs were seconds long.
- Frozen sandbox: no write from my side. origin e1316d0 unchanged.
