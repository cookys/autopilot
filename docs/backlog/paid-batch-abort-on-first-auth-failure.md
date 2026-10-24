# Paid batch should abort on the first auth failure

BL-0294. Lift the wrapper-local STOP_AUTH into a shared mechanism so every paid batch stops at the first auth failure. Efficiency class. Efficiency work jumps the queue (owner rule 2026-10-24).
