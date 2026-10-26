# Lane B summary

Landed. Candidate sha @SHA_B@.

Review (verified by depth-0):
- B-F1 (Major): the exporter truncates rows longer than 64 KiB without an error.
- B-F2 (Major): the exporter writes the header twice when the output file already exists.
