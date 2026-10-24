# Long sessions never reap their background work

BL-0297. In scope: (a) the state-checkpoint restore block lists live background shells, Monitors and waiters (PID, age, last output); (b) a warning hook for long-lived sleep or until wait loops; (c) guidance that subagents hang no placeholder timer (guidance, needs ON/OFF eval); (d) cleanup of tasks-directory output. Out of scope: footer, roster and the shell-listing tool, which belong to Claude Code itself. Efficiency class. Efficiency work jumps the queue (owner rule 2026-10-24).
