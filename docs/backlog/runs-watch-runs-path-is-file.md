# runs-watch: a regular file at <live>/runs makes the parent mkdir fail with EEXIST and leaves no launch result (BL-0344)

Evidence probe: /tmp/claude-<uid>/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/ensureu1/cv3/evidence/parent-mkdir-probe.js . Old version is also red.

Fix direction: detect a non-directory at <live>/runs and write a launch result file with the reason. Related to BL-0336 (missing-path assumptions).
