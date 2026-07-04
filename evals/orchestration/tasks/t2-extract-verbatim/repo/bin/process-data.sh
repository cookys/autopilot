#!/usr/bin/env bash
set -euo pipefail

# Sizable python script embedded in heredoc.
# Extract this block verbatim to lib/stats.py.
python3 - << 'EOF'
import sys
import json

def parse_and_summarize():
    summary = {"errors": 0, "warnings": 0, "infos": 0}
    total = 0
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        total += 1
        try:
            log_entry = json.loads(line)
            level = log_entry.get("level", "").upper()
            if level == "ERROR" or level == "FATAL":
                summary["errors"] += 1
            elif level == "WARN" or level == "WARNING":
                summary["warnings"] += 1
            elif level == "INFO":
                summary["infos"] += 1
        except json.JSONDecodeError:
            summary["errors"] += 1
    
    print(f"Total processed: {total}")
    print(f"Errors: {summary['errors']}")
    print(f"Warnings: {summary['warnings']}")
    print(f"Infos: {summary['infos']}")

if __name__ == "__main__":
    parse_and_summarize()
EOF
