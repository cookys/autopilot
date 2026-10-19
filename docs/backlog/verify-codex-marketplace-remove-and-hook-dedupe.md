# Verify Codex marketplace remove and hook de-duplication on a real Codex CLI

BL-0214. Follow-up of BL-0027 (merge d997355a9). Code: scripts/dev-setup.sh

Dev-mode install now writes user-level hook config. Two checks were only run against a fake Codex:

1. `codex plugin marketplace remove` exists and works, so `--uninstall` clears the derived dev marketplace registration.
2. A user-level hook and a plugin-level hook with the same name are de-duplicated.

Trigger: the next `dev-setup.sh --harness codex --install` on a host with the real Codex CLI.
