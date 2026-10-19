# Final-panel seat whose transport fails leaves no reason

Reported by codepower twgs-revival (report 01M59ZPRRAH8CGMG59HHD8816N, reply 2026-10-19 01M59ZQBD887MCS212ZQY3MYDX).

- A final-panel seat whose transport fails leaves no reason behind.
- The seat json should record the exit code, the stderr tail, and the cleanroom stage.
- Only codex goes through the cleanroom and fails there. Non-cleanroom runs are fine.
- Cross-reference BL-0223 (Managed rail: a red campaign_verification keeps only digests, so the failing command is lost).
