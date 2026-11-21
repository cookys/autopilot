#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCAN_SH="$SCRIPT_DIR/runaway-scan.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

STUB_PS="$TMP_DIR/ps"
cat > "$STUB_PS" <<'EOF'
#!/usr/bin/env bash
cat <<'OUT'
team             12345  23040  98.2 node scripts/foo.test.js
alpha-lead       12346   7200  65.0 python3 worker.py --loop
otheruser        12347   9000  99.0 node should-ignore.js
team             12348    100  99.0 node too-young.js
team             12349   5000  10.0 node low-cpu.js
team             12350   5000  80.0 bash not-node-or-python.sh
OUT
EOF
chmod +x "$STUB_PS"

OUT_TEXT="$(PS_BIN="$STUB_PS" bash "$SCAN_SH" --min-secs 3600 --min-cpu 50)"
echo "$OUT_TEXT" | grep -q "12345"
echo "$OUT_TEXT" | grep -q "12346"
! echo "$OUT_TEXT" | grep -q "12347"
! echo "$OUT_TEXT" | grep -q "12348"
! echo "$OUT_TEXT" | grep -q "12349"
! echo "$OUT_TEXT" | grep -q "12350"

OUT_JSON="$(PS_BIN="$STUB_PS" bash "$SCAN_SH" --min-secs 3600 --min-cpu 50 --json)"
echo "$OUT_JSON" | node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
if (!Array.isArray(data) || data.length !== 2) process.exit(1);
if (data[0].pid !== 12345 || data[1].pid !== 12346) process.exit(1);
'

echo "runaway-scan.test.sh: PASS"
