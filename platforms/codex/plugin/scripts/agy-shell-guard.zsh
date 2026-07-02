# agy-shell-guard.zsh — shell-level backstop for the agy ≤1.0.7 symlinked-dest
# self-copy-truncation bug (data loss; mechanism + repro in
# references/multi-agent-portability.md § "Verified by Spike (agy 1.0.5
# headless dispatch)").
#
# This wraps RAW `agy plugin install/uninstall` invocations — the layer the
# repo's own guarded installer (scripts/install-antigravity.sh) cannot reach.
# It blocks while ANY symlink sits at the top level of
# ~/.gemini/config/plugins/ (legacy agy-1.0.1-era installs plant them there).
#
# Install: add to your ~/.zshrc:
#   source /path/to/autopilot/scripts/agy-shell-guard.zsh
#
# zsh syntax (uses [[ ]] and local); trivially portable to bash if needed.

agy() {
  if [[ "$1" == "plugin" && ("$2" == "install" || "$2" == "uninstall") ]]; then
    local hit
    hit=$(find ~/.gemini/config/plugins -maxdepth 1 -type l 2>/dev/null)
    if [[ -n "$hit" ]]; then
      echo "BLOCKED: symlink(s) in ~/.gemini/config/plugins/ — agy <=1.0.7 self-copy-truncates the link TARGET (data-loss bug). Offenders:" >&2
      echo "$hit" >&2
      echo "Remove the link itself first:  rm <link>   (never rm -rf the target)" >&2
      return 1
    fi
  fi
  command agy "$@"
}
