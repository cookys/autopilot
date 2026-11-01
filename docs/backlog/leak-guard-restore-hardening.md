# leak-guard revert-allowance hardening (BL-0362)

Source: leakfu review g5 (CUT/FOLLOW-UP suggestions), 2026-11-01. Canonical behavior: `references/leak-guard.md`.

1. Above 500 findings in one file the allowance switches to whole-file blame. That path has no unit test. Add one, with a negative control shown red before green.
2. The blame porcelain header regex hardcodes a 40-hex SHA-1. In a SHA-256 repository the header never parses, so every allowance silently stops applying. Accept both lengths, with a negative control.

Both failures degrade to "not allowed", never to a wrongly allowed line. Only the allowance is affected; the scan itself is not. The repository is SHA-1 today.
