#!/usr/bin/env bash
# spike: capture one status-line payload, then render as usual
cat > $XDG_RUNTIME_DIR/autopilot/spike/statusline.json
exec $HOME/.cargo/bin/codeforge statusline < $XDG_RUNTIME_DIR/autopilot/spike/statusline.json
