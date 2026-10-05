# Peer-reported: hangar lab-ingress × autopilot preview servers (2026-10-05)

Source: fleet message `01M45R3JWAVVZ5WDTQ4M89A503` from `cookys/openclaw/hangar--claude-2` (requested by cookys); autopilot reply `01M45R4M3V0999MB5HEV8E7R84`. Discussion only — no process is killed by either side without cookys' approval.

Facts (hangar inventory 2026-10-05, hangar `docs/projects/2026-09-07-lab-ingress-and-domains/INVENTORY-2026-10-05.md` @ `2604c88`): 40 ad-hoc preview/doc/review servers fleet-wide (cuda 19, aimax395 14 — 13 of them from 308: vite preview ×9, `http.server` ×4), almost all bound 0.0.0.0, unregistered, unreaped; two serve deleted working dirs.

autopilot side (verified): the only server autopilot starts by code is the P1b host review server (`src/status/review-server.js`, `python3 -m http.server --bind 127.0.0.1 <review.port|8787> --directory ~/.autopilot/review`, started by the runs watcher; 127.0.0.1 by design, `references/review-page.md`). The 0.0.0.0 previews are agent improvisation, not skill/script output.

hangar proposal (lab-ingress v2, not decided): `lab preview <dir|port> [--ttl 72h]` registers in `tower/ingress/registry`, serves `<name>.lan.lab.cookys.org` via Caddy on x570-1u (LAN only), reaper tears down on expiry; `lab expose` for public via Cloudflare Tunnel + Access.

Candidate autopilot work (after v2.37.0):
1. Review server registers itself with `lab preview` (or the shared registry file) when `lab` is installed; keep the 127.0.0.1 bind — the LAN hop (local forwarder vs lab-side) is a joint decision.
2. A mechanism, not skill text (2026-10-05 eval: skill-text instructions scored 0/10): a PreToolUse Bash hook that notices `http.server` / `vite preview` / `--host 0.0.0.0` and routes the agent to `lab preview` (advise or rewrite), with a local fallback that binds the LAN IP and writes `~/.local/state/lab/previews/<id>.json` {port, dir, owner session_id + project_key, expires_at} for the hangar reaper. Format co-defined with hangar.
3. Plan P4 progress snapshot lists the repo's open previews from that registry file.

Follow-up 2026-10-05 (fleet `01M45R5551H3D58FCV7V1M1NXF`): on cuda, 8787 is taken by rw3d-edge (0.0.0.0:8787, upstream of rw3d.twmud.net), so the review server there cannot start on the default port. Current behaviour is deliberate (`src/status/review-server.js:13-14`: busy port → stderr "review server: port busy", never replaced, so page links stay stable); workaround `~/.autopilot/config.json {"review":{"port":N}}`; the actual port is written to `<live>/review/server.json`. Candidate (decide with the registry format): fixed port first, automatic fallback only when busy, and register the actual port. Replied `01M45R5…` (fleet reply id in the session).
