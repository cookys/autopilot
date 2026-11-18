// sets the part of live.test.ts that live3.test.ts runs (see the note at the top of live.test.ts); imported before it so it is set when live.test.ts is evaluated
;(globalThis as { __livePart?: number }).__livePart = 2
export {}
