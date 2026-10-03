# Review page — served root, URL scheme, server lifecycle

Index-shaped reference for the mods "visible dispatch" review pages (plan `docs/plans/2026-10-03-mods-visible-dispatch.md`,
§2.5, §8 D1/D2, R4.1). Sections marked **[renderer contract]** are implemented by
`scripts/render-review-page.js` (rows B1a/B1b); the rest is implemented by `src/status/review-server.js` and
`src/status/runs-watch.js` (row B2).

## URL scheme

`http://localhost:<port>/<project_key>/<date>/<job>/current/` — `current` is a symlink to the newest immutable
version directory `v-<published_at>/`; `http.server` follows it. The host root `http://localhost:<port>/` is a
static project index (one row per `project_key`: display name, last `published_at`, decisions needed). It is a
directory page, not a cockpit. `project_key` is `sha256(repo_identity)[0:16]`, computed only by the CLI
(`src/status/project-key.js`). **[renderer contract]**

## Served root and durability (D1)

- Served root: `<autopilot_home>/review/` (`autopilot_home` = `$HOME/.autopilot`, or the parent of
  `AUTOPILOT_SESSION_MODE_DIR` when set; see `src/status/live-pointer.js`). One subdirectory per project:
  `<autopilot_home>/review/<project_key>/`. Never served from a checkout.
- Originals and bundled assets (`<job>/assets/<sha256[0:12]>.<ext>`) live there durably; default retention is
  90 days (`render-review-page.js --reap --days`). **[renderer contract]**
- Git keeps only `compare-record.json` plus previews of at most 200 KB under `docs/plans/evidence/<date>-<job>/`.
- Pages are generated only from JSON by `scripts/render-review-page.js`; HTML is self-contained with relative URLs;
  unknown values render as unknown, never 0. **[renderer contract]**

## Two-axis chips (A12)

The execution axis and the acceptance axis never merge. **[renderer contract]**

| Axis | Source value | Chip |
|------|--------------|------|
| Execution | `running` | `RUNNING` |
| Execution | `exited` | `EXITED` |
| Execution | `unknown` | `UNKNOWN` |
| Acceptance | `accepted` | `ACCEPTED` |
| Acceptance | `rejected` | `REJECTED` |
| Acceptance | `unknown` | `PENDING` |
| Acceptance | `accepted` with `can_close=false` | `ACCEPTED · 未收尾` |

Index first line, axes listed separately:
`執行 RUNNING n · EXITED n · UNKNOWN n ｜ 驗收 ACCEPTED n · REJECTED n · PENDING n`.
The acceptance axis comes only from `autopilot status task --root-run-id` (`task_status_receipt`).

## One host, one server

- One `python3 -m http.server --bind 127.0.0.1 <port> --directory <autopilot_home>/review` per machine.
  It binds 127.0.0.1 only; the bind address is not configurable.
- Port: `<autopilot_home>/config.json`, key `review.port` (integer 1..65535, default `8787`). The file has no
  central schema; each reader reads it directly. Example: `{"review": {"port": 8787}}`.
- Started by the project watcher (`autopilot status runs --watch`) at startup via `ensureReviewServer`, fail-open
  (a failure is one line in the watcher log). It is detached, not the watcher's child: the watcher's `--idle-exit`
  and `--stop` do not stop it.
- Single instance: the server process holds `flock` on `<live>/review/server.lock` (same `sh -c 'exec 9>lock;
  flock -n 9 || exit 75; exec …'` shape as the watcher). Already held means no second server; the holder pid is
  read from `<live>/review/server.json` (`pid`, `port`, `root`, `started_at`). Log: `<autopilot_home>/review/server.log`.
- Port busy (another process listens on it): stderr `review server: port busy`, status `port_busy`, no other
  port is tried. Missing `python3` or `flock`: named status, no throw.
- Opt out: `AUTOPILOT_REVIEW_SERVER_AUTOSTART=0` (tests export it via `hooks/tests/lib.sh`).
- Manual ensure / stop: `node src/status/review-server.js ensure` and `node src/status/review-server.js stop`.
  Stop checks `/proc/<pid>/cmdline` is that http.server for that root and port before SIGTERM; a pid that is not
  the server is refused (exit 1); a server that does not exit prints `still running pid N` and exits 1.
- Lock order, when the renderer publishes: project `<live>/review/<project_key>.index.lock` first, then host
  `<live>/review/root-index.lock`; never the reverse. **[renderer contract]**

## Remote viewing (reverse proxy; auth and TLS are the proxy's job)

autopilot does not bind LAN, does not do auth, does not do TLS. Plain HTTP on a shared network exposes every
project's review pages to anyone who can reach the port, which is why the server stays on 127.0.0.1. To view from
a phone or another machine, put your own proxy in front:

- Tailscale: `tailscale serve --bg 8787` (tailnet-only HTTPS to localhost:8787).
- Caddy: `reverse_proxy 127.0.0.1:8787` inside a site block that carries your TLS and auth.
- SSH: `ssh -L 8787:127.0.0.1:8787 <host>`, then open `http://localhost:8787/` locally.

Replace 8787 with your `review.port`.

## Image-review seat rule

Images shown to the owner are screenshotted and looked at by the implementer before delivery. Every image in a
compare page is first viewed by an independent image-review seat (`model: sonnet`), one image at a time, with a
written record in `compare-record.json` `image_review` (lesson: a leaf once accepted an all-black frame). The seat
is a procedure, not a gate; the page lists the record and renders no verdict. **[renderer contract]**
