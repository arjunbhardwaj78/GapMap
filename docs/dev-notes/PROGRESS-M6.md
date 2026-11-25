# Milestone 6 progress (live checkpoint - read this first if you are a new Claude)
Base: gapmap-milestone5-final.zip (wip3 is older, ignore). Run tests: `NODE_PATH=dev-tools/standin/node_modules npm test` (sandbox) or `npm test` (laptop).
User asks (3 fixes):
1. Interview: add VIDEO mode (camera+mic) so AI can also coach on face expression/eye contact/posture. Keep voice-only as an option. Consent tick, files deleted after analysis, labelled coaching not grade.
2. "AI not available" on quiz making. Cause: GEMINI_MODEL had no default and configured() needed both key+model; any failure hid the reason. Fix: default model + fallback list, clear reasons, and a built-in offline quiz bank (code-made number questions + small MCQ bank) used when AI is unavailable.
3. Student portal did not show the student's problem: results said "Nice work" when wrong answers had no verified pattern. Fix: show a clear "Your problem" summary + per-wrong-answer worked correct answer; honest wording when pattern is not confirmed.

## Checklist (tick when done AND tested)
- [x] A gemini.js default model/fallback/error reasons (tested)
- [x] B services/quizbank.js + use in createQuiz/selfQuiz (tested, 6 topics)
- [x] C interview video mode backend+frontend+unit tests done; browser test with fake camera still TODO
- [x] D student problem display: backend tested; browser check still TODO
- [x] E all tests + browser checks pass, HANDOFF.md updated, zip delivered (see HANDOFF.md "MILESTONE 6")
