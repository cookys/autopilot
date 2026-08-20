# Frozen review rubric — multi-turn / event-instrumented harness plan (option B, campaign 1)

MH1: Manipulation validity. The plan claims a 3-turn scripted session operationalizes "the
session has room" and that turn text ("Continue." / "Anything left before you finish? Wrap
up.") does not cue the ceremony behaviours because OFF@3 receives identical turns. Is that
differencing argument sound, or can a cue interact with the skill (FULL-only priming) so that
FULL@3 - FULL@1 measures prompt-compliance rather than skill-driven ceremony? Is k=3 enough
room for L-setup behaviours that dev-flow places at session START — does a turn-2 "Continue."
even give the model a reason to go back and do setup it already skipped?

MH2: Channel validity. Events come from zero-output PostToolUse/Stop/SessionStart hooks
writing JSONL inside the sandbox, plus stream-json, FS/git residue and task JSON. Are
zero-output hooks actually non-reactive on this runtime — is there ANY model-visible trace
(latency, system-reminder, settings echo) that differs between hooked and unhooked sessions?
Is the hook channel's failure mode (hook silently not firing) distinguishable from "behaviour
absent", and does the P1 smoke actually cover that distinction (planted-positive must prove
hook-fired-per-turn, not merely artifact-exists)?

MH3: Verdict-rule completeness. §5 defines inadmissible / truncation-explains /
skill-does-not-drive / mixed, an F2 positive control, a survivor STOP, and forbids aggregate
claims on mixed. Enumerate the outcome table: are there cells the rules do not cover, or cover
with the wrong verdict? Is "skill-does-not-drive valid only if F2 control fired" the right
dependency — F2 lives in a DIFFERENT task fixture, so does its firing actually prove the
ceremony tasks' multi-turn channel worked? Is 3 reps enough to separate ≥2/3 from ≤1/3 given
the predecessor's small-n lesson, and if not, what is the honest minimum?

MH4: Pre-registration integrity. Smokes may repair the instrument and re-run, but never count
toward cells; §5 freezes at review-freeze; budget is a hard 80-call cap. Where can post-hoc
discretion still leak in — task fixture authoring after seeing smoke transcripts, the choice
of WHICH 2 d2-type tasks, the pin-absent planted-red rep count of 2, or the OQ1/OQ2 options
being decided after data starts? Name each leak and the cheapest seal.

MH5: F2 regression-guard design. The F2 block claims independent standing as a rerunnable
red-green guard for the v2.34.23/24 env-pin fix. Is a 3-rep green / 2-rep red block actually
rerunnable as a guard (cost, flake rate, model drift), or should the guard be a single
deterministic probe outside this campaign? Does tying it to this harness couple a production
regression guard to an experimental instrument that may be retired?

MH6: Claim scope and consequence. If the block lands truncation-explains for all three
markers, what exactly is licensed — and does anything in the plan tempt a broader claim (e.g.
"dev-flow works multi-turn")? If it lands skill-does-not-drive, the natural next step is
editing dev-flow: does the plan adequately firewall that decision as a separate Board matter?
Is the survivor STOP (<2 admissible) set at the right threshold given only 3 markers exist?

MH7: Cheaper or better alternatives. Argue the strongest case AGAINST buying this campaign:
is there a materially cheaper design that answers Q1 (e.g. a single FULL@3 pilot before the
full 2×2, transcript-only without hooks, or reading production transcripts where opus-5
sessions already ran dev-flow multi-turn with tools live before 2026-08-16)? What evidence
would change your mind?
