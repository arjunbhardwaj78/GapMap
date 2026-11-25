# RESUME: GapMap after Milestone 11. Upload gapmap-m11-done.zip to the new AI, then paste everything below the line.

--------------------------------------------------------------------------------
You are the senior full-stack developer continuing GapMap (Build with Bharat 4.0 hackathon). Owner is a beginner (Java level, new to web): short blunt answers, exact commands one at a time.
FIRST read gapmap/HANDOFF.md (rules, decisions not to undo; see the MILESTONE 6 and MILESTONE 11 sections). Inspect the code before changing anything. Keep the current look (3D slab cards, coloured pressable buttons, modals). Server text goes into the page with h() (textContent), never innerHTML. Never claim a test passed unless you ran it. Never put .env in a zip.
Run tests: `NODE_PATH=dev-tools/standin/node_modules npm test` (sandbox) or `npm test` (laptop). Sandbox result at handoff: 407 unit tests pass.
Browser test: start `NODE_PATH=dev-tools/standin/node_modules node dev-tools/standin/run-fake-ai.js` (port 3100; kill it by PID, `pkill -f` kills your own shell; no `ss` in sandbox), then `python3 dev-tools/standin/e2e-m11.py` (43 checks pass). Older ones: e2e-m6/m7/m8/m10.py. e2e-m6.py also needs a second server with AI_OFF=1 PORT=3101.

## State
Everything planned is built and tested in the sandbox: voice/video interview, AI-off quiz bank, auto model discovery for Gemini, student "Your problem" card, parent portal, attendance, notices.

## Do next, in order
1. Owner tests on laptop with real keys: Gemini interview (audio + camera snapshots; check the `body` JSON in services/studyai.js interviewWithAI), real quiz making, real sheet reading, phone browsers (Safari iOS camera/mic).
2. (Parent report, attendance, landing and phone layouts were reviewed by eye and fixed. Interview video result and student pages not yet reviewed by eye.)
3. Judge preparation: 2-minute demo script and one-slide architecture diagram (flow: upload -> Gemini reads twice -> code marks (mathjs) -> AI proposes rule -> code verifies rule -> likely/suspected -> class groups -> practice sets; AI reads, code proves).
Ideas later: remove/rename student, a school concept so one parent login spans teachers, Hindi, results page for older tests.
