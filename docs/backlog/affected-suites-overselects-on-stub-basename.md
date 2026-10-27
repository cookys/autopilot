# affected-suites selects about 500 suites for the fbatch stub

BL-0311. The fbatch evaluation ships stub files whose names equal real `dispatch-*` scripts. `scripts/affected-suites.js` matches by name, so a change touching a stub selects about 500 suites, which stretches acceptance. Seen in the fbland and fbrestamp acceptance runs on 2026-10-26. Direction: let the selector tell a stub under the evaluation directory from the real script of the same name.
