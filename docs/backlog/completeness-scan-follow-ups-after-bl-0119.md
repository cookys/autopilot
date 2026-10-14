# completeness-scan follow-ups left by the BL-0119 review

Source: BL-0119 review rounds 1-3, 2026-10-14.

1. **All `--files` pieces missing still passes.** Each missing piece warns on stderr, then the scan
   reports `clean:true` and exits 0 with zero files scanned. A typo in the file list silently passes the
   gate. Fix direction: exit 2 (usage) when no scannable file remains after splitting.
2. **Self-referential findings in `--range`.** A range that edits the PAT_MARKER line in
   `scripts/completeness-scan.sh`, or the marker table row in
   `skills/quality-pipeline/references/completeness-gate.md`, reports those lines as new findings
   (4 on the BL-0119 branch: 2 lines × canonical + codex mirror). Fix direction: an allowlist for the
   pattern's own definition lines (see `scripts/lib/exclude-allowlist.js`), or build the pattern from
   pieces so the literal never appears.
3. **Leading whitespace in newline lists.** When a joined `--files` argument holds a newline it splits
   on newlines only and strips `\r`, but a piece like `  a.sh` keeps its leading spaces and is reported
   missing. Fix direction: trim leading/trailing blanks per piece unless the untrimmed name exists.
