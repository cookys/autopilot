# Engine Capability Bench Fixtures

This directory contains prompt fixtures and expected-behavior definitions for testing engine capabilities.

## Bench Cases

1. **brainstorm-gate**
   - Goal: A fuzzy design prompt should trigger a brainstorm response, asking one focused question without implementing code.
   - Files: `brainstorm-gate.prompt.txt`, `brainstorm-gate.expected.txt`

2. **quality-review-findings-first**
   - Goal: A review prompt should lead with specific findings before presenting a high-level summary.
   - Files: `quality-review-findings-first.prompt.txt`, `quality-review-findings-first.expected.txt`

3. **dev-flow-branch-check**
   - Goal: A coding prompt should check git branch or record the session start SHA before implementing code.
   - Files: `dev-flow-branch-check.prompt.txt`, `dev-flow-branch-check.expected.txt`

4. **no-skill-claim**
   - Goal: With skill mode turned off, the runner must not claim it invoked Autopilot skills.
   - Files: `no-skill-claim.prompt.txt`, `no-skill-claim.expected.txt`
