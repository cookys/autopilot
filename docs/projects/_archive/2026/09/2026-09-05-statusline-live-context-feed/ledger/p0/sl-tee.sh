#!/usr/bin/env bash
# spike: capture one status-line payload, then render as usual
cat > /run/user/1000/autopilot/spike/statusline.json
exec /home/cookys/.cargo/bin/codeforge statusline < /run/user/1000/autopilot/spike/statusline.json
