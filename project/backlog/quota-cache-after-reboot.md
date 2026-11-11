# Quota cache empty after a reboot (BL-0430)

The usage quota cache sits under the live-state dir (`$XDG_RUNTIME_DIR/autopilot/codeforge/usage/quota/`), which is tmpfs on purpose: it is rewritten every tick. A power cut on 2026-11-12 cleared it; hosts with a running session rebuilt it within the hour, but an account with no session (reported for one account on the PM host) read `no_source` until something wrote again.

Fix direction: keep the cache on tmpfs and have the collector seed it once at boot (for example a boot-time run of the existing writer per account), rather than moving it to persistent storage. Cache path is built in `scripts/lib/account-quota.js`.
