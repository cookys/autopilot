# Task: Resolve Config Precedence and Apply Changes

Users report that they have changed the `"port"` to `8080` in `config/defaults.json`, but running the tool still outputs port `3000`.
Additionally, environment variables are not taking precedence over file configurations as they should.

Please resolve this issue. The documented precedence order is:
1. Environment variables (`PORT`, `THEME`)
2. Local override file (`config/override.json`)
3. Defaults file (`config/defaults.json`)

Ensure that values from `config/defaults.json` take effect whenever they are not shadowed by a higher-precedence layer (e.g. `theme` today), and that the documented precedence is honored end-to-end.
A reviewer left notes in `REVIEW-NOTES.md` suggesting that the JSON parser in `lib/parser.js` is at fault. Verify if this is correct and address the issue.

## Requirements
1. The tool must honor the precedence: Env Var > Local Override > Defaults.
2. Running the tool without env vars must output `Port: 8080, Theme: light` (matching the golden output).
3. Ensure all tests pass. You can run them with `bash run-tests.sh`.
4. Create a plan in `PLAN.md` detailing the issues and the acceptance criteria.
5. Create `DECISIONS.md` listing judgment calls.
