# GapMap: hand-off and requirements (keep this file updated)

If you are a new Claude picking this up: read this whole file, then ask the user to upload the latest project zip. Do not start by rewriting everything. Continue from the status section.

## People and context
- Owner: Arjun (B.Tech CSE student, Java level, beginner in web). Prefers short, blunt, structured answers. Team of 5, all beginners.
- Event: Build with Bharat 4.0, KCC Institute, Greater Noida, 10-11 Oct 2026 (24-hour hackathon). Treat time as very limited.
- Motto: "Evidence before diagnosis."
- The user pastes work between laptops as zip files. Claude cannot read the user's C: drive; files must be uploaded in the chat.

## Product the user wants (their requirements, in order of the user flow)
1. **Login first.** The user picks a role (teacher or student) and signs in with credentials.
2. **Teacher portal.** The teacher can upload a JPG/PNG, take a photo with the camera, or upload a PDF. The content is extracted and analysed to find the mistakes.
3. **Students are listed separately.** Each student's result is shown on its own.
4. **Groups.** Students with the same mistake pattern go into the same group. The teacher sees how many students have which type of misconception.
5. **Plain-language names.** Never show codes like M1 or M2 to users. Show a readable name, for example "Adds tops and bottoms of fractions".
6. **Teacher history.** A list of students who made mistakes, and which mistakes.
7. **Remedial kit** for each group, plus sample practice questions for that group (answers computed by code, never by the AI).
8. **Student portal.** The student sees which group they are in, their practice sheet, their score, their marks and their misconception.
9. **TinyFish API** for learning resources (key server-side only; send only the topic, never student data).
10. **Look and feel:** unique, 3D-like depth, colours that are easy on the eyes, attractive, animations, coloured button animations, pop-ups (modals). It must be simple and friendly: one clear step per screen, not everything in one place. The current frontend was rejected as too basic and too cluttered.

### Conflict (RESOLVED: user loved the current build's look: floating 3D cards, animation, coloured buttons, modals. Keep it.)
An earlier frontend prompt banned gradients, hover animations, glass effects and similar. The user now asks for colour, animation, pop-ups and a 3D feel, and also said to avoid "the 30 things". Default: follow the latest request for visuals, but keep these rules: no fake data, no emojis as decoration, no clipped text, no unlabeled sample data, no claim of "diagnosed" or "exact". Confirm with the user.

### Privacy decision (in force)
The user now asks for student names. Earlier decision: IDs only. Default: the teacher enters a display name or roll number inside the school's own class; names are never sent to Gemini or TinyFish; only the answer-sheet image goes to Gemini.

## Engine decisions already made (do not undo)
- Gemini reads the sheet. Key in `.env`; model name from `GEMINI_MODEL`; never called from the browser.
- Read each sheet twice. If the two reads differ on an answer, mark it "needs teacher review".
- The correct answer is computed in code with mathjs (exact fractions). The AI never decides marks.
- For a wrong answer, the AI describes the rule the student seemed to follow as a formula in n1, n2, n3... Code then tests the formula on the question's numbers. If it reproduces the student's answer, show "Verified"; otherwise "AI suggestion (unverified)" and do not count it as evidence.
- A student has a "likely gap" when 2+ questions share the same verified rule; 1 is only "suspected"; no match goes to "needs teacher review".
- Groups are built from matching verified rules. Group names come from the AI's plain-language explanation, and the teacher can rename them.
- A tested module exists: `verify.js` and `verify.test.js` (18 tests pass). Use it; do not rewrite it. Security rule: only evaluate rule text that matches `^(?:[0-9.\s+\-*/^()]|n\d+)+$` and is under 80 characters.
- Practice questions: generate new questions with the same structure and random numbers, and compute the answer key in code. The AI may only translate instruction lines (Hindi).
- Storage: Node 24 built-in `node:sqlite` works. No heavy infrastructure.
- Wording: "likely", "suspected", "needs teacher review". Never "diagnosed" or "exact misconception". "Verified" means "consistent with", not "proves".
- Pilot evidence so far: Gemini read 21/21 final answers on 3 neat sheets; diagnosis labels matched on 2 sheets. Tiny sample; do not present as accuracy.

## Findings on the Antigravity zip (second gapmap-final.zip, reviewed by Claude)
- It is the OLD engine again: fixed M1-M4 catalogue, trigger answers, hardcoded gemini-1.5-flash, seeded real-looking student names, API key passed in the URL.
- Its "OCR fallback" (services/extraction.js) INVENTS answers: it maps question text to hardcoded student answers and ignores the image. NEVER port or reuse it. Fake data is banned.
- Its .env contained real GEMINI and TINYFISH keys and was inside the zip uploaded to chat: user must ROTATE both keys and never zip .env.
- Ideas taken from it (rebuilt properly): integer topic (6-(-4), -8+5), baseline-vs-practice progress, assign practice to a group, student practice portal.
- Not taken: tesseract.js, eng.traineddata, seeded names, M-codes, its UI.

## Architecture map (current project, node 22+/24, Express, node:sqlite, mathjs)
- verify.js (+ verify.test.js): user's tested core. Do not rewrite. checkAnswer, verifyRule, summarizeStudent, groupClass.
- services/engine.js: read sheet twice (Gemini), analyzeStudent, LIBRARY of known slips (fractions + integers) tested in code, buildClassReport, AI text helpers teachingTipsWithAI + hintWithAI (get pattern name/explanation only).
- services/practice.js: generatePractice (new proper-fraction/integer questions, answers computed by code, only questions where the wrong rule differs), markPractice.
- services/core.js: all business logic (classes, students, PINs, tests, sheets draft/confirm, report, overview, kit, tips, practice, student portal, sample class). services/auth.js: scrypt, Bearer sessions. services/gemini.js, services/tinyfish.js.
- routes.js: one Express router (buildRouter(ai) so tests can inject a fake AI). server.js. database/schema.sql + db.js.
- public/index.html, app.css, app.js: the whole frontend (vanilla JS, hash routes, h() DOM helper, no innerHTML with data).
- Tests: `npm test` = verify.test.js + test-engine.js + test-core.js (57 core tests). `npm run test:api` needs the server running.
- API (all JSON, errors {error}): auth/signup|login|logout, me, presets; classes; students (add, set-pin, reset-pin); assessments (create, get, sheets upload, typed, report, overview, kit, kit/tips, groups/rename, practice/assign); sheets/:id (GET draft or result, confirm, file); samples/class; history; student/home, student/change-pin, student/practice/new, :id, :id/submit, :id/hint.

## Status (latest)
- DONE and confirmed on user's laptop (real Express + mathjs): engine, API, first frontend (milestones 1-3).
- DONE this session, tested only in the Claude sandbox (stand-in for express/mathjs/multer, pretend AI, headless browser, 57 core tests pass): teacher-chosen PIN (when adding students as "Name, roll, pin", or Set PIN button; 4-8 digits), student can change own PIN, Class overview charts (marks spread, per-question, patterns, status, practice-helped, print button), AI teaching ideas per group (cached), student "make a new practice set" from own verified gap (max 6 sets per gap, no repeats), AI hint after submitting (answer key by code), progress card, integers preset + integer library rules, labelled "Sample class (demo data)" loader.
- NOT yet tested anywhere: real Gemini calls (sheet reading, rule description, tips, hints), real multer upload, real TinyFish, camera on a real device. Hindi not built.
- AI honesty rules kept: AI never marks, never writes answer keys; tips/hints are labelled AI and get only pattern name + code-computed answer.

## MILESTONE 5 (IN PROGRESS, started 10 Oct 2026). Resume from here.
User request: student AI practice quiz on own weak topics; AI "interview judge" (student records audio live, AI gives coaching feedback); student homework upload (photo/PDF or typed "CBT" answers, auto-checked); teacher types a topic -> AI quiz -> shown on every student portal, teacher sees who attempted / who is absent; alternate remedial ways (mini lesson, online resources, printable remedial sheet); extra SaaS-style features (participation dashboard, CSV export, badges, streak).

### Decisions made this milestone (tell the user; easy to change)
- Number questions: AI gives only the EXPRESSION; code computes the answer (rule kept).
- Concept (MCQ) questions: AI writes the key. Allowed ONLY in TEACHER quizzes, which stay DRAFT until the teacher reviews and publishes. Labelled "AI-written answer key". Student self-made quizzes are number-questions only (code keys).
- Interview judge: voice only OR (since Milestone 6) video mode; explicit consent tick, audio deleted right after analysis, only feedback text is stored, teacher sees it only if the student ticks "share". Browser converts to WAV before upload. Labelled "AI coaching feedback, not a grade". Prompt forbids comments on accent/looks/background.
- Homework = an `assessments` row with kind='homework' (+ optional due date), so results/groups/overview work unchanged. Student photo flow: 2 Gemini reads -> student re-types any question where the reads disagree (blank = stays "needs teacher review") -> code checks. `submissions.source='student'`.
- Student portal becomes a hub (#/s) with tiles; old home moves to #/s/results.

### Done so far (sandbox, `npm test` = 57 pass with stand-ins)
- database/schema.sql: new tables quizzes, quiz_attempts, interviews, resource_cache, gap_lessons.
- database/db.js: addColumn migration (assessments.kind/due, submissions.source, practice_sets.done_at) so old .db files still work.
- services/core.js: createAssessment accepts kind+due; listAssessments/getAssessment return them; confirmSubmission split into finalizeSubmission (reused by student homework); groupSources(); practice done_at; getSheet returns source; more exports.
- services/practice.js exports `pretty`. services/studyai.js: quizWithAI, lessonWithAI, interviewWithAI (NOT yet called by anything).
- dev-tools/standin/: sandbox-only fakes (see its README).

### Done in the second session (11 Oct, 00:00 IST), NOT yet run or tested
- services/extras.js WRITTEN (all of step 1): cleanQuestions, teacher quizzes (create draft by AI or typed, remove question, publish, close, participation attempted/absent + per-question stats), student quizzes + submit + selfQuiz (calc only, 10/day, IST), homework (list, detail, typed, photo, confirm: only questions where the 2 reads disagree can be typed by the student), interview (consent, audio deleted in `finally`, sanitizeFeedback, share toggle, teacher sees shared only), studyHelp (lesson cached, TinyFish resources cached 24h, topic only), studentSheet + teacherSheet (printable, code answer key), badges + streak (IST), engagement dashboard, CSV (assessmentCsv, engagementCsv, formula-neutralised).
- routes.js WIRED (step 2): all endpoints for the above, audio multer (wav/mp3/ogg, 8MB), defaultAi now has quiz/lesson/interview. Student homework photo uses the existing `upload` (image/pdf).
- I have NOT yet run `npm test` after these two edits. First command for the next Claude: `NODE_PATH=dev-tools/standin/node_modules npm test` (sandbox) or `npm test` (laptop). Fix any require/syntax error in extras.js or routes.js first.

### Milestone 5 status (11 Oct): CODE COMPLETE in the sandbox, needs real-service testing
- Backend: services/extras.js + routes.js (done). Tests: `npm test` = verify 18 + engine 18 + core 57 + extras 69, all pass with stand-ins.
- Frontend: public/extras.js (teacher: quizzes, quiz review/publish/close/participation, participation + shared interviews + CSV, results CSV, print remedial sheet; student: hub with badges/streak, quizzes + own AI quiz, homework typed/photo/draft-confirm, interview recorder with browser WAV conversion, study help, printable sheet). app.js exposes window.GM; extras.js calls GM.start(). Print CSS and quiz option styles are in app.css.
- Headless browser click-through (Playwright, pretend AI via dev-tools/standin/run-fake-ai.js, port 3100) passed all 25 checks and a phone-width check. Pretend AI text starts with "PRETEND".
- dev-tools/standin/node_modules/multer now has a tiny multipart parser (sandbox only) so browser uploads can be tested. Real multer is used on a laptop.
- NOT tested with real services: Gemini quiz/lesson/interview-audio calls (check the JSON shapes in services/studyai.js), MediaRecorder + WAV on real phones (Chrome Android, Safari iOS), real multer for audio and homework photos, TinyFish.
- Ideas if time remains: Hindi practice instructions; delete-old-uploads job; teacher edit of quiz question text; per-student quiz history on the teacher side.

## MILESTONE 6 (12 Oct 2026): three fixes. DONE and tested in sandbox (stand-ins + headless browser with fake camera)
User reported: (1) interview had no video mode, (2) AI quiz said "AI not available", (3) student portal did not show the student's problem.
- **Interview video mode (reverses the old "audio only" decision; user asked for it).** Student picks "Voice only" or "Video (camera + voice)". Video mode: browser records AUDIO only (converted to WAV) and samples up to 8 small JPEG snapshots (every ~3 s). Route accepts fields `audio` + `frames` (JPEG). Gemini gets audio + snapshots and returns the usual rubric plus `body`: eyeContact, expression, posture (1-5 + reason), or `bodyVisible:false` (then a friendly note). Prompt forbids comments on looks, skin, age, gender, clothing, background, and guessing feelings; says "in the snapshots". All files deleted in `finally`. Teacher sees shared feedback TEXT only. Labelled "coaching, not a grade".
- **AI not available fix.** Cause: `GEMINI_MODEL` had no default and `configured()` needed key AND model; every failure hid the reason. Now `services/gemini.js` needs only the key, tries `GEMINI_MODEL` (optional, comma list) then defaults (gemini-2.5-flash, gemini-flash-latest, gemini-2.0-flash), and throws `AiError` with `reason` (no_key, key, model, quota, busy, network, bad_output) turned into plain text by `gemini.messageFor`. NEW `services/quizbank.js`: when the AI is off or fails, quizzes come from a built-in bank (fractions, integers, decimals, percentages, powers, order of operations; number answers still computed by code; a few hand-written MCQs tagged `builtin:true`, not counted as "AI-written key"). Responses carry `source` ('ai'|'builtin'|'typed') and `note` (why AI was not used), shown on the quiz screen. Unknown topic with AI off gives 422 listing the bank topics. Interview and sheet reading still need the AI but now say exactly what to fix.
- **Student portal problem display.** `core.studentHome` results now have `problem` {kind: likely|suspected|unclear|none, wrong[], wrongCount} and per item `pattern`/`patternHow` (only code-verified patterns). Student Results page has a "Your problem" card and never says "Nice work" when answers were wrong. Wrong rows show "Looks like: <pattern>". Hub tile shows "Problem found: <name>".
- 12 Oct later: user's real key returned 404 for every guessed model name. gemini.js now calls ListModels for the key, skips tts/embedding/image models, ranks flash first, and remembers the working model (test-gemini.js, mocked fetch). Real Gemini still untested by Claude.
- Interview "could not hear a clear answer": now separates silent mic (client checks loudness before upload, live level bar), AI said no speech (422, prompt relaxed), and unreadable AI reply (502, tolerant parsing). Server logs only the reply KEYS.
- Tests: `npm test` = 18 + 18 + 57 + 87 + 4 (test-gemini) pass. Browser: `dev-tools/standin/e2e-m6.py` 17 checks pass (needs run-fake-ai.js on 3100 and `AI_OFF=1 PORT=3101` on 3101).
- STILL NOT TESTED WITH REAL SERVICES: real Gemini with image+audio parts (check the `body` JSON shape in studyai.interviewWithAI), real camera/mic on phones (Safari iOS especially), real multer `fields()`. Test on the laptop.
- Ideas: results page for older tests (only the latest shows), Hindi, more bank topics.

## MILESTONE 7 (11 Oct 2026): any subject, any topic. DONE and tested in sandbox
User asked: "only decimals/fractions; make it accessible for any subject, concept, topic".
Decision (tell the user, easy to change): three evidence tiers. (1) computable maths: existing engine, verified by code. (2) fixed-answer MCQ any subject: NEW, options carry a "mistaken idea" tag; key + tags typed by teacher or AI-drafted then teacher-reviewed; CODE marks and counts (2+ same tag = likely, 1 = suspected, no tag = unclear). (3) open-ended essays: NOT built; if added, label "AI suggestion, teacher to confirm", never "Verified".
- services/concept.js NEW: tagKey, cleanTags, parseTyped, diagnose, classGaps, tagList (all pure code).
- services/extras.js: cleanQuestions keeps `tags` (+ `typed` flag); createQuiz({title,topic,subject,level,count,expressions,typedMcq}); quizView has subject + tagList; publicQ hides tags; revealQ adds yourTag only after attempt; getQuizForStudent(attempted) adds `problem`; quizParticipation adds `gaps`; NEW conceptHelp (AI explanation cached in gap_lessons key concept|quiz|tag, labelled, + TinyFish resources by subject+tag only); selfQuiz stays calc-only.
- services/studyai.js: quizWithAI({topic,count,allowMcq,subject,level}) asks for tagged MCQs; NEW conceptLessonWithAI. database/db.js: quizzes.subject column (migration). routes.js: POST /student/quizzes/:id/help.
- public/extras.js: Subject/Level inputs, typed-MCQ box, tag list + chips on draft, "Mistake patterns in this class", student "Your problem" card + help modal.
- Tests: `npm test` = 18 + 18 + 57 + 87 + 4 + 37 (test-concept.js) all pass. Browser: dev-tools/standin/e2e-m7.py, 22 checks pass (servers: run-fake-ai.js on 3100 AI on, AI_OFF=1 PORT=3101). Pretend AI has tagged biology questions.
- STILL NOT TESTED WITH REAL SERVICES: real Gemini tagged-MCQ output shape and quality (tags may need prompt tuning), real conceptLesson, TinyFish for non-maths topics. Test on the laptop with the real key.
- Known limits: tags must use the exact same wording to be counted together (AI is told to reuse wording; teacher sees the tag list before publishing). No merge/rename tag tool yet. The answer-sheet photo engine (tests/homework) is still maths-only. No Hindi.
- Ideas: tag merge/rename on the draft screen; subject field on classes; remedial MCQ practice from a student's likely tag (teacher-approved questions only); essay tier with rubric + teacher confirm.

## MILESTONE 8 (11 Oct 2026): quota errors, honest "unverified" label, subject on tests. DONE, tested in sandbox
User reported: (1) no subject option on tests, (2) sheet upload kept failing with "AI is over its free limit" (and the browser only showed "Something went wrong"), (3) wrong answers showed "AI suggestion (unverified)" with NO pattern name.
- **Causes found.** (2) Upload read the sheet twice at the same moment (burst) and a 429 was never retried; AiError had no HTTP status so routes.js turned it into a vague 500. (3) At confirm time `describeRule` swallowed every AI error, so a rate-limited AI left a wrong answer with no suggestion, yet it was still labelled "AI suggestion (unverified)".
- **services/gemini.js:** 429 handling. Reads only the retry delay and whether the DAILY quota is gone (never logs/echoes the reply body). Per-minute limit: waits what Google asks (2-30 s, max 2 waits) then retries all models. Daily limit: new reason `quota_day`, no waiting, clear message. `setSleep` exists so tests do not really wait.
- **routes.js error handler:** AI errors (have `reason`) now return 503 with the plain message instead of "Something went wrong".
- **services/engine.js:** `readSheetTwice` is now one read after the other. Label is "AI suggestion (unverified)" only when the AI really suggested a name; otherwise "No pattern found". Item keeps `aiNote` when the AI could not be asked.
- **services/core.js `finalizeSubmission`:** known slips (LIBRARY) are tried FIRST by code, so common patterns get a verified name with zero AI calls (fewer calls, works when the AI is limited). The AI is asked only when nothing in the library fits; its rule must still pass `verifyRule`. If the AI fails, the answer gets `aiNote`.
- **Subject:** `assessments.subject` (migration, default Maths). New-test form has a Subject dropdown. Maths = existing number-sum engine. Any other subject: the form explains that photo sheets are number-only and links to the multiple-choice quiz (button disabled). Tests list shows the subject chip. Quiz Subject box now offers suggestions (datalist), still free text.
- Follow-up: when the DAILY limit is gone on the default models, gemini.js now also tries the other models the key can use (ListModels, up to 6), since each model has its own daily limit. Mocked-fetch test only.
- Tests: `npm test` = 18 + 20 + 60 + 87 + 9 + 37. Browser: e2e-m7.py 22 checks and NEW e2e-m8.py 9 checks pass.
- STILL NOT TESTED WITH REAL SERVICES: real Gemini (the retry wait is tested with a mocked fetch only). If the free key's DAILY quota is used up, nothing in the code can fix that: type answers, wait for tomorrow, use another key or enable billing.
- NOT built: reading answer-sheet photos for non-maths subjects (multiple-choice sheet reader: Gemini reads which option was circled, code marks and counts tags). This is the natural next step for "any subject" on photo sheets.

## MILESTONE 10 (IN PROGRESS: backend module written, routes/tests/UI not yet): multiple-choice answer sheets for any subject
See RESUME-M10-CHOICE.md in this zip for the full plan, the design (choice test = quiz with mode 'paper', teacher enters each student's sheet, existing tag engine counts), file list and tests to write. This zip is otherwise Milestone 8, unchanged.

## MILESTONE 12, Hindi step 2: parent chat (backend only, rebuilt 11 Oct 2026). Tested in sandbox
- The earlier session that built this was lost (its sandbox files were not in the zip), so services/chat.js and test-chat.js were REBUILT from its transcript.
- services/chat.js: POST /api/parent/children/:id/chat {question, lang: hi|hinglish|en}. Facts come only from summary.factsFor. The AI only words the answer (prompt says the question is not instructions). Code rejects the reply if it has a number not in the records (exact match, no rounding), another student's name (honorifics and words already in the facts are allowed), a link, or a phone number. Rejected, failed or no-AI replies use the fixed Hindi summary template. Limit 20 AI questions per parent per day (table chat_use, schema.sql); fallbacks do not count; over the limit = 429.
- Tests: test-chat.js (14 checks) added to `npm test`. The whole chain passes (no FAIL).
- NOT built: the chat box in the parent screen (public/), quick buttons, e2e browser test. Real AI never tested (mocked).
- Next: add chat box + quick buttons to the parent child page (call summaryFor for quick buttons, no AI), e2e-m12-chat.py, then rest of the Hindi plan.

## Next steps (update this list)
1. User: rotate leaked keys; copy .env.example to .env; set GEMINI_API_KEY, GEMINI_MODEL, TINYFISH_API_KEY; `npm install`; `npm test`; `npm start`; open http://localhost:3000; run `npm run test:api` in a second window.
2. Test one real handwritten sheet; if Gemini output is wrong, fix prompts in services/engine.js (readSheetOnce, describeRuleWithAI).
3. Verify TinyFish live (group kit screen "Learning resources"); adjust services/tinyfish.js if the response shape differs.
4. Optional: Hindi practice instructions; demo script; deploy notes.
5. Refresh this file after each milestone.

## MILESTONE 10: multiple-choice PAPER tests (any subject) - DONE in the sandbox
- Teacher: Tests page > "New multiple-choice test" (typed block or AI draft, stays DRAFT) > check key > Publish > "Print question paper" (no key) > "Add a student's sheet": pick student > upload photo/PDF, camera, or type letters (e.g. BACDB) > review grid A-D (rows where the two reads differed are left BLANK and flagged) > Confirm and mark. Code marks; the AI never marks.
- Result page per student: score, Likely/Suspected/unclear idea (wording: "not proof"), "Chose B: ..." / "Key A: ...", the original sheet image.
- Mistake patterns on the test page: "Send a practice quiz" makes a DRAFT quiz for the LIKELY students only; publish it and only they see it ("For you").
- Student: sees "Paper test" result with "Your problem" and "Next step: your teacher may send you a practice quiz for this idea. Look in your Quizzes."
- Files: services/choice.js, public/choice.js (loaded after app.js, before extras.js), routes in routes.js, test-choice.js (82 checks), dev-tools/standin/e2e-m10.py (32 checks).
- Verified in sandbox: npm test = 18+20+60+87+9+37+82 pass; e2e-m10 32 pass; e2e-m7 and e2e-m8 pass (m8's Science check updated to the new M10 button).
- NOT tested: real Gemini reading circled letters on real photos, phone camera, TinyFish. Do on the laptop. If Gemini quota is gone, type the letters.
- Merge note: a separate "Milestone 9 judges' demo data" build (seed-demo.js) exists in another zip and is not merged here.

## OpenRouter backup AI (added after M10)
- services/gemini.js: generateJson tries Gemini, then OpenRouter if Gemini fails (quota, busy, network, bad output). OPENROUTER_API_KEY alone also works. Audio cannot go to OpenRouter (no fallback for the interview coach). If both fail, the Gemini reason is shown.
- .env: OPENROUTER_API_KEY, OPENROUTER_MODEL (default google/gemini-2.5-flash, NOT verified live; pick a model that reads images).
- test-openrouter.js (11 checks, fetch mocked). Real OpenRouter calls: untested. Privacy: sheet photos go to a second company.
 (give this to a new Claude with the latest project zip)
```
You are the senior full-stack developer continuing GapMap (Build with Bharat 4.0 hackathon, 10-11 Oct 2026).
Read HANDOFF.md fully first, then inspect the uploaded zip before changing anything.
Owner Arjun is a beginner; keep answers short and blunt, give exact commands one at a time.
Keep the current frontend look (3D slab cards, coloured pressable buttons, modals, animations).
Never invent data or claim a test passed unless you ran it. The AI never marks or writes answer keys.
Do not reuse the Antigravity fake OCR. Keep the app runnable after every step and update HANDOFF.md at the end of each milestone.
```

## MILESTONE 11 (11-12 Oct 2026): parent portal, attendance, notice board. DONE, tested in sandbox.
- Parent role: teacher makes a parent login per student (or links a sibling's parent by username). Parent sees ONLY linked children (404 otherwise): highlights, tests (likely/suspected patterns), quizzes, homework, attendance, effort, notices, tips, can message the teacher (5/day). Interview practice is never shown. Parent can change password (then is signed out).
- Attendance: present/absent/late/leave per day (last 120 days, not future). % = (present+late)/(present+late+absent), leave not counted, below 75% flagged, CSV export. Student sees own attendance.
- Notice board: teacher posts to class or one student (notice/praise/concern). Parent messages are visible only to that parent + the teacher.
- Bug fixes: login lock (8 wrong tries = 15 min), sessions expire after 14 days, ghost-student fix, uploaded photos deleted on failure, empty manual sheet refused, old-DB migration for parent role, impossible dates give 400.
- Files: services/family.js, services/auth.js, database/schema.sql (parent_links, attendance, notices), routes.js, public/family.js (teacher Attendance + Notices + Parent-login modal, parent portal #/p and #/p/c/:id, student Notices + My attendance), public/app.js, public/extras.js.
- TESTS: `npm test` = 407 unit tests pass. BROWSER: `dev-tools/standin/e2e-m11.py` = 43 checks pass, no console errors (start run-fake-ai.js on port 3100 first). Covers 3 role cards in a row, attendance mark/save/summary/CSV, parent-login modal (make, reset, link sibling), notices post/delete, parent sign-in/report/print/message/change password, unlinked child blocked, student tiles, phone width 390.
- Sandbox-only lesson: the stand-in express (dev-tools/standin/node_modules/express) lacked req.query and res.send; both added. Real Express has them. If a route works in unit tests but 500s in the sandbox browser, suspect the stand-in first.
- NOT TESTED by Claude: real Gemini/OpenRouter with real keys, real phone browsers, real multer/express (laptop `npm install`). Screenshots were taken to /tmp but not visually reviewed: look at the parent report and attendance pages by eye.
- Phone fix (12 Oct): at <=640px the breadcrumb wraps under the logo and list rows wrap (public/app.css, last block). Screenshots were reviewed by eye: landing, parent report, attendance, phone report look right.
- Ideas later: remove/rename student, one parent login across several teachers (needs a school concept), Hindi, results page for older tests.

## MILESTONE 12 (11 Oct 2026): notifications, alerts, report cards, charts, contacts, leave/meetings. Built and tested in the sandbox (stand-ins, headless Chromium). Spec: MASTER-PROMPT-M12-ALERTS.md. Live status: PROGRESS-M12.md.
- Rules kept: a parent sees only their own children (404 otherwise); students never see numbers/other students; the AI never decides marks, thresholds or alerts (all numbers come from code; no AI is used in milestone 12); soft wording ("may need support"); never log phone numbers/passwords; no real SMS/WhatsApp (only a console dry-run channel in channels/index.js).
- Step 1 notifications: services/notify.js (notifyStudent/notifyClass/notifyTeacher never throw; dedupe key = event + child; a parent with two children gets one per child; only LOW types can be muted; `ev.only` = 'parent' limits recipients). Bell UI in public/notify.js, list page #/n, teacher "Sent notifications".
- Step 2 alerts: services/alerts.js (ONE evaluator, 7-day cooldown, dry-run preview), services/scheduler.js (starts in server.js only when run directly; every 30 min; safe after a gap), class settings screen + Alert centre (public/alerts.js).
- Step 3 report cards: services/reports.js (reportFor is the one function for all roles; scopes till date/year/term/custom; formula shown; class average only if >= 3 children; remarks max 600; parent "seen"; class CSV with formula guard), public/reports.js, A4 print CSS at end of app.css.
- Step 4 charts: public/charts.js (plain SVG, text values, role=img, black/white friendly), classCharts for the teacher hub.
- Step 5 contacts: services/contacts.js + public/contacts.js. Phone = 10 digits (optional +91), stored as digits only, sharing OFF by default, a number is visible to the other side only if its owner switched sharing on, never in reports/CSV/charts/notifications/logs, not printed.
- Step 6 (items 1-4 of section 7): services/features.js + public/features.js: leave requests (approved days become "leave"; the scheduler fills future days on the day, only empty ones), read receipts (notice_seen; counts only), Sunday-evening weekly digest (parents only, key = Sunday date), parent-teacher meeting slots (one per child, reminder the day before). Also built: homework calendar + browser-made .ics (student #/s/calendar, parent card), Alert-centre quick-action messages (fixed wording, two taps), CSV export of alerts and sent notifications. Hindi toggle for system notification text: services/hindi.js (fixed hand-written templates) + one hook in notify.insertOne (ev.hi, chosen by contact_prefs.language; teachers and parents only; the teacher's own text is never translated; screens/buttons stay English). test-hindi.js (30 checks).
- Tests: `NODE_PATH=dev-tools/standin/node_modules npm test` (sandbox) or `npm test` (laptop) = test-alerts, test-alerts-engine, test-reports, test-contacts, test-features added to the older ones (731 at the end of Milestone 12). Browser: dev-tools/standin/e2e-m12.py, -alerts, -reports, -contacts, -features (start run-fake-ai.js on port 3100 first).
- NOT tested: real Express/multer, real phones (tel:/WhatsApp links), real SMS/WhatsApp, a real printer, real Gemini. Do these on the laptop (`npm install`, `npm start`).
- Sandbox lessons: the stand-in express in dev-tools/standin/node_modules is not real Express; kill servers by PID (no pkill -f, no ss). Playwright text selectors are substring + case-insensitive ("Approve" also matches "Not approve", "Book" matches "Cancel booking"): use :text-is().

## UI refresh + Hindi Listen fix (11 Oct 2026)
- New landing (role chooser) and sign-in screens: public/landing.css + roleScreen/loginScreen in app.js. Animated mistake demo card, Hindi tagline, role-coloured sign-in panel, Show/Hide password. Inputs still #u and #p. Phone: demo card hidden so the role cards show sooner.
- Hindi "Listen" button (public/summary.js) always shows now. The voice is looked up at tap time, each line is spoken as its own piece, tap again to stop, and if nothing starts in 2.5 s the parent is told to install a Hindi voice (Settings > Language > Text-to-speech). Real phone voices NOT tested (only a mocked speechSynthesis in headless Chromium); test on a real Android phone.
- e2e-m12-hindi.py updated for the new Listen behaviour (27 checks pass).

## 3D scene + public website (12 Oct 2026). Layout and logic tested; REAL 3D NOT SEEN YET
- public/scene3d.js: one reusable Three.js (r128) scene: floating book, bridge over a gap, bubble sheet, small shapes, particles. API: SetuScene.mount(el, {variant}) -> {destroy, setProgress}. Loads /vendor/three.min.js first, then the cdnjs CDN. No WebGL / no library = box hidden, page works. Respects prefers-reduced-motion, pauses when off-screen or tab hidden, stops moving if the phone is too slow, frees GPU memory when you leave the page.
- In-app: a 3D stage above the role cards on the first page (app.js roleScreen, styles in landing.css).
- Public website: public/site/index.html (open /site/). English/Hindi toggle, 3D hero that turns as you scroll. Features not built yet are marked 'Coming soon' (bubble sheets, principal dashboard, consent tools). It still says SamajhSetu while the app still says GapMap: rename is a week-1 task. TODO in the file: put a real contact (email/WhatsApp) for pilot requests.
- Sandbox has no internet, so Three.js was never really loaded here. Tests (dev-tools/standin/e2e-3d.py, 10 checks) use a stand-in library to prove the page logic, fallbacks, language toggle and clean-up. Look at it on a real laptop and phone. If objects look too big/small or overlap, change positions in build() and the camera in fit() in scene3d.js.
- Note: the sandbox stand-in express does not serve /site/ (folder index); real express does. Test with /site/index.html there.

- UPDATE (12 Oct 2026): the first page AND the sign-in page now use the 3D scene as a full-page fixed background (variant 'full' in scene3d.js: bigger objects spread across the screen, more particles, stronger mouse parallax). Cards are frosted glass (landing.css, .bg3d rules). The small 3D box above the role cards was removed. The user's laptop screenshot showed the small version rendering correctly, so Three.js loads from the CDN there.
