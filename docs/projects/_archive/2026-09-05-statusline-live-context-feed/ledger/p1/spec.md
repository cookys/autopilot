# P1 review spec — codeforge live context files
Plan: /home/cookys/projects/autopilot/docs/plans/2026-09-05-statusline-live-context-feed.md — review the diff against §2.5 Global Constraints and P1 only.
Must-hold: every live-dir candidate (override included) probed via findmnt/proc-mounts and accepted only as tmpfs|ramfs; SSD fallback = ~/.autopilot with exactly one warning; two files, one writer each, no read-modify-write; mode 0600 + same-dir temp+rename; sanitiser = per-scalar replace, first 64 scalars, empty ⇒ unknown; records built from raw Value; write failure never changes rendering/exit; install flag opt-in only; no new crate.
Depth-0 verified independently: cargo test 857/0; both writers run on the real p0 payloads (single-line stdin) produce schema-1 files with mode 600 under AUTOPILOT_LIVE_DIR on tmpfs.
Report findings with file:line; severity 🔴/🟠/🟡/🔵; verdict SHIP-AS-IS or FIX-THEN-SHIP.
