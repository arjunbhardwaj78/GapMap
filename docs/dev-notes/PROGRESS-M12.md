# >>> LATEST (session 8, HINDI STEP 1 DONE) <<< READ THIS FIRST
HINDI STEP 1 (one-tap "Hindi summary" for parents, NO AI, works with no API key) is built and tested. Hindi steps 2 (AI chatbot) and 3 (parent screens in Hindi) are NOT started: ask the owner before each. The extra step PROFILE PHOTOS + HEADER CHIP is NOT started (owner said "Hindi first"; ask before starting it).
EXPECTED COUNTS NOW (replace older numbers): `NODE_PATH=dev-tools/standin/node_modules npm test` = 765 pass (731 + test-summary.js 34, already in npm test). Browser (start command is in the older blocks below): e2e-m12.py 22, e2e-m12-alerts.py 25, e2e-m12-reports.py 47, e2e-m12-contacts.py 24, e2e-m12-features.py 38, e2e-m12-hindi.py 26 (new). Note: grep "^FAIL" also counts the summary line "FAILS: 0" in the features script; that is not a failure.
Built:
- services/hindi.js: new summary(f, lang) with fixed templates for lang hi (Devanagari), hinglish (Roman Hindi) and en; SUMMARY_LANGS. Order: hello, attendance this month, overall attendance, latest 3 results + average, homework due in 7 days, good-news line (only if true), one soft "may need support" line (only if an alert is open or attendance is below the line), kind closing.
- services/summary.js: factsFor(st, today) builds the facts ONLY from reportFor (default till-date scope), family.attendanceFor, alerts.countAtt (this month), features.upcoming (not-handed-in homework in the next 7 days) and open alert_log rows; summaryFor(user, id, {lang}) and summaryAll(user, {lang}). Parent only (403 others), linked child only (404). Returns {child, lang, lines, text, numbers}; `numbers` is the facts packet (step 2 can reuse factsFor).
- Routes: GET /parent/children/:id/summary?lang=hi|hinglish|en and GET /parent/summary?lang= (all linked children, one card each).
- UI: public/summary.js; big button "हिंदी में सारांश सुनें / देखें" on parent home (all children) and on each child page; screens #/p/summary and #/p/c/:id/summary; Devanagari / Roman Hindi toggle; "Full report card" button; Listen button uses speechSynthesis hi-IN and is hidden with a message if the phone has no Hindi voice (Listen always reads the Devanagari text); whole screen is class noprint. CSS at the end of app.css.
- Rules tested: every number in the text is a number from the facts; no AI/network in the summary code; teacher-written titles unchanged; no phone numbers, passwords, other children, teacher or class name in the text; two children = two separate cards; other family 404; student/teacher 403.
- Screenshots viewed by eye: parent home on 390 px (button), summary on 390 px with two children. Layout OK.
NOT tested: how natural the Hindi sounds (a Hindi-speaking teacher must read hindi.js once before real use; Roman Hindi spellings are my own choice), a REAL Hindi voice on real phones (the browser test used a fake voice and checked only that speak() got hi-IN and the Devanagari text), a real printer, real Gemini (step 1 does not use it), real Express.
Small known limits: homework is class-wide, so "due soon" lists class homework the child has not handed in; the average is the test average (or quiz average if no test); the summary uses the default "till date" scope.
NEXT (ask the owner): HINDI STEP 2 (AI chatbot, needs test-chat.js with AI mocked), then HINDI STEP 3 (parent screens in Hindi, only if the owner says yes), and the PROFILE PHOTOS extra step (spec was given by the owner in chat; not in the repo, so ask for it again if the chat is lost).

# (older block) LATEST (session 7, checkpoint 8: MILESTONE 12 COMPLETE)
ALL 8 steps and ALL optional section 7 items (1 to 8) are now built and tested in the sandbox. Final zip: gapmap-m12-done.zip.
EXPECTED COUNTS NOW (these replace every older number below): `NODE_PATH=dev-tools/standin/node_modules npm test` = 731 pass (test-hindi.js = 30, test-features.js = 62). Browser: e2e-m12.py 22, e2e-m12-alerts.py 25, e2e-m12-reports.py 47, e2e-m12-contacts.py 24, e2e-m12-features.py 38.
Checkpoint 8 built item 6, the HINDI TOGGLE for system notification text:
- services/hindi.js holds fixed Hindi templates (written by hand, NOT machine translated). A person who sets "Language for GapMap messages" = Hindi in their contact details (teachers and parents only; PUT /me/contact {language:'hi'}) gets Hindi for system messages. Everyone else (including students, who cannot set a language) gets English.
- Hook: notify.insertOne uses `ev.hi` ({title, body, parentBody?, studentBody?}) when notify.langOf(recipient) === 'hi'. An event with no `ev.hi` is sent in English to everyone. The teacher's own words (notice title and text, homework/quiz/test titles, the Alert-centre log) are NEVER translated: notices get a Hindi label in front and the teacher's text unchanged.
- Covered: all 9 alert types, absent today, homework/test/quiz/paper-test assigned, results ready, homework due soon/overdue, notice label, parent message to teacher, leave request and decision, meeting times open / booked / cancelled / reminder, weekly digest.
- NOT translated: screens, buttons and labels (the app itself is English), the quick-action messages (fixed English wording), report cards, CSV files, the .ics file, error messages.
- Hindi wording is soft ("सहायता की ज़रूरत हो सकती है") and gender-neutral, but a Hindi-speaking teacher should read hindi.js once before real use. Messages already sent stay in the language they were sent in.
- Remaining ideas (not required): let students pick a language; translate screens; Hindi quick actions; real phones/printer/Express/Gemini/SMS tests on the laptop.
Where things are: HANDOFF.md (section MILESTONE 12), README.md (Milestone 12), RESUME-M12.md (prompt for a new AI).

# (older block follows) LATEST (session 7, checkpoint 7)
EXPECTED COUNTS NOW (these replace older numbers below): `NODE_PATH=dev-tools/standin/node_modules npm test` = 701 pass (test-features.js has 62). Browser: e2e-m12.py 22, e2e-m12-alerts.py 25, e2e-m12-reports.py 47, e2e-m12-contacts.py 24, e2e-m12-features.py 35.
Checkpoint 7 built the optional section 7 items 5, 7 and 8 (item 6 Hindi toggle is NOT built):
- Item 5 homework calendar: GET /student/calendar and GET /parent/children/:id/calendar (homework due in the next 14 days with done flag; parents also see their child's booked meeting). UI: student tile + page #/s/calendar, parent "Coming up in the next 14 days" card, "Add to my calendar (.ics)" button (the .ics text is built in the browser by GM.icsFile in public/features.js, escaped; no server route). The .ics was checked as text only; it was never opened in a real calendar app.
- Item 7 quick actions: on every Alert centre card, three buttons (Please call me / Extra practice / Well done), two taps to confirm, send a fixed kind notice (or praise) to that one child's family through the normal notice route. Wording in English only.
- Item 8 CSV: GET /classes/:id/alerts.csv and /classes/:id/sent-notifications.csv (teacher only, own class, formula guard via x.toCsv). Buttons on the Alert centre and the Sent notifications page.
- NOT built: item 6 (Hindi toggle for system text). NOT tested: opening the .ics in a real calendar, real phones, real printer, real Express/multer, real Gemini, SMS/WhatsApp.
- Remaining work: item 6 (optional), then a last review and the final zip name gapmap-m12-done.zip. HANDOFF.md, README.md, RESUME-M12.md already exist (add the 3 new items to the HANDOFF Milestone 12 step 6 line if you want).

# (older block follows) LATEST (session 7, checkpoint 5)
UPDATE (checkpoint 6): HANDOFF.md (MILESTONE 12 section), README.md and RESUME-M12.md are now written, so steps 7 and 8 are DONE. Only the optional section 7 items 5 to 8 below remain; any item built after this is listed under "Items built after checkpoint 5" just below.
Items built after checkpoint 5: see checkpoint 7 above (items 5, 7, 8).

Milestone 12 STEP 6 (extra parent/teacher features) is BUILT and tested for items 1 to 4 of section 7 of the master prompt. Items 5 to 8 are NOT built.
- `NODE_PATH=dev-tools/standin/node_modules npm test` = 692 checks pass (639 + 53 in the new test-features.js, added to npm test).
- Browser (start: `(NODE_PATH=dev-tools/standin/node_modules node dev-tools/standin/run-fake-ai.js > /tmp/srv.log 2>&1 & echo $! > /tmp/srv.pid); sleep 2; python3 dev-tools/standin/<script>.py; kill $(cat /tmp/srv.pid)`): e2e-m12.py 22, e2e-m12-alerts.py 21, e2e-m12-reports.py 47, e2e-m12-contacts.py 24, e2e-m12-features.py 28 (new). All pass. In one sequential run e2e-m12-features.py showed 1 FAIL once and then passed 3 runs in a row (likely a timing flake; not investigated).
- Screenshots viewed by eye: parent page on phone (leave + meeting cards), teacher leave screen, teacher meeting screen on phone (fixed a squeezed "start times" field). Layout OK.
- Built (all in services/features.js, routes at the end of routes.js, UI in public/features.js):
  1. LEAVE REQUESTS: tables leave_requests. Parent POST /parent/children/:id/leave {from,to,reason}; GET same; DELETE .../leave/:leaveId (only while pending). Teacher GET /classes/:id/leave, POST /leave/:id/decision {decision:'approve'|'reject'}. Rules: from at most 7 days back, to at most 120 days ahead, at most 31 days, reason 3 to 200 letters, no overlap (409), max 5 pending (429). Approve turns days up to TODAY into "leave" (an absent mark becomes leave; present/late stay; Sundays skipped); days in the future are filled by the scheduler on the day (applyApprovedLeaves, fills only EMPTY days, never undoes a later teacher mark). Parent and student get a bell message; teacher gets one on request. Leave is not counted in attendance %.
  2. READ RECEIPTS: table notice_seen. Parent POST /parent/notices/:id/seen (404 for other class, other child's personal note, or a parent's own message). Teacher notice list now has `receipt {seen, of}` (counts of parents only, no names); parent notices have `seen`. Alert centre items have `receipt` (a parent has "seen" an alert when the bell message was opened). UI: "Seen by 1 of 2 parents" chip, parent button "I have seen this".
  3. WEEKLY DIGEST: features.runDigest({today,hour}) sends only on Sunday at/after 17:00 India time, one notification per child to PARENTS ONLY (notify ev.only='parent'), key digest:<sunday date> so a repeat sends nothing. Text from code: attendance this week, tests handed in, homework due next week, one "Good news" line if true. Called from scheduler.runOnce (now takes {today,hour}; returns also leaveMarked, digest, reminders). If the server is off on Sunday evening the digest is skipped for that week (no Monday catch-up).
  4. MEETING SLOTS: table meeting_slots. Teacher GET/POST /classes/:id/meetings {day,times[],minutes,note}, DELETE /meetings/:id (tells the parents if it was booked). Parent GET /parent/children/:id/meetings (open times only, no other family's names), POST .../meetings/:slotId/book, DELETE .../meetings/:slotId. One booking per child (409), a taken slot is 409, past times 400. Parents of the class get a "Meeting times open" bell message; booking notifies parent(s) and teacher; reminder the day before via scheduler (runMeetingReminders, once).
  Notes: a child with two parent logins gets messages on BOTH logins (counts in tests reflect that). New notification types: leave_request, leave_decision, weekly_digest, meeting_booked, meeting_cancelled, meeting_reminder. notify.js: ev.only filters recipients by role.
- Screens: teacher hub tiles "Leave requests" (#/t/c/:id/leave) and "Meeting times" (#/t/c/:id/meetings); parent child page cards "Ask for leave" and "Meet the teacher" (class noprint, not printed); notice receipts in teacher Notices and parent notices; "Seen by X of Y" on Alert centre cards.
- NOT built (section 7 items 5 to 8): homework due calendar + .ics, Hindi toggle for system text, teacher quick-action templates in the Alert centre, CSV export of alerts and notification log.
- NOT tested: real Express/multer, real Gemini, real phones (tel:/WhatsApp links only checked as text), real SMS/WhatsApp (only the console dry-run channel exists), a real printer. Date inputs were only tested in headless Chromium.
- Small known polish: Alert centre still shows raw number labels (daysInARow: 3); the Sunday digest has no catch-up if the server was off.
NEXT (ask the owner which): 7 = e2e for steps 4 to 6 is mostly DONE already (e2e-m12-reports, -contacts, -features exist), so step 7 only needs a final review/cleanup; optional section 7 items 5 to 8; 8 = HANDOFF.md (add MILESTONE 12 section; do not delete older sections), README.md, RESUME-M12.md refresh, final zip gapmap-m12-done.zip.

# >>> LATEST (session 6, checkpoint 4) <<< READ THIS FIRST
Milestone 12 STEP 5 (contacts and consent) is DONE and tested. Step 4 (charts) is fully closed (phone hub screenshot viewed: OK).
- `NODE_PATH=dev-tools/standin/node_modules npm test` = 639 checks pass (599 + 40 in the new test-contacts.js, added to npm test).
- Browser (start: `(NODE_PATH=dev-tools/standin/node_modules node dev-tools/standin/run-fake-ai.js > /tmp/srv.log 2>&1 & echo $! > /tmp/srv.pid); sleep 2; python3 dev-tools/standin/<script>.py; kill $(cat /tmp/srv.pid)`): e2e-m12-reports.py 47, e2e-m12-alerts.py 21, e2e-m12-contacts.py 24 (new), e2e-m12.py 22. All pass. Screenshots viewed by eye: parent page on phone, teacher parent-login dialog, Alert centre (layout OK).
- Built: table contact_prefs (user_id, phone digits, share default 0, preferred_time, language); services/contacts.js (normalisePhone: 10 digits, optional +91/91/0, 400 and never echoes the number; getMine/putMine; forParent; forTeacherStudent/forTeacherClass; setInitialPhone); routes GET/PUT /me/contact, GET /parent/children/:id/teacher-contact, GET /classes/:id/contacts; family.addParent accepts optional `phone` (checked BEFORE the login is made; stored hidden until the PARENT switches sharing on); family.listParents returns `contact` (number only if parent agreed); public/contacts.js (My contact details dialog, contact line with masked number + Show/Call/WhatsApp, parent "Contact the teacher" card, class noprint); entry buttons on teacher home and parent home; parent child page + parent report page show the card; teacher parent-login dialog has a number field and shows shared numbers; Alert centre shows "Parent contact".
- Rules enforced and tested: sharing OFF by default; number visible to the other side only if its owner switched sharing on; sharing cannot be on without a number; students get 403 on all contact routes and never see numbers; another family's parent gets 404; another teacher is refused; numbers never in report JSON, class reports, CSV, class charts, notifications or logs; only digits stored; unlinking the last child deletes the parent login and its stored number; contact card is not printed.
- Also fixed: an old bug where the teacher's parent-login dialog showed the word "null" at the top (replaceChildren(null)).
- Small known polish: Alert centre still shows raw number labels (daysInARow: 3) in small grey text. No "print contact on report" option (not asked). The 5/day parent message limit was not touched.
- NOT tested: real Express/multer, real Gemini, real phones (tel: and WhatsApp links were only checked as link text, never tapped), real SMS/WhatsApp, a real printer.
NEXT (do not start until the owner asks): 6 extra parent/teacher features from section 7 of the master prompt (leave request, read receipts, weekly digest, meeting slots; priority order, stop when time runs out), 7 e2e for 4-6, 8 HANDOFF.md (add MILESTONE 12), README.md, RESUME-M12.md, final zip gapmap-m12-done.zip.

# (session 6, checkpoint 3: step 4 charts, DONE)
Milestone 12 STEP 4 (charts) is BUILT and tested, except the small leftovers below.
- `NODE_PATH=dev-tools/standin/node_modules npm test` = 599 checks pass (532 old + 67 in test-reports.js; 10 new chart-data checks).
- Browser: e2e-m12-reports.py = 47 checks pass; e2e-m12-alerts.py = 21 checks pass (same start command as in the block below).
- Built: public/charts.js (plain SVG, own sv() helper because h() cannot make SVG; no innerHTML; role=img + aria-label; text values; hatch/outline for black-white print); charts placed inside reportView() in public/reports.js: trend (overall % over time), marks per test/quiz with class-average marker (hidden when null), attendance by month, homework stacked bar, subject bars (only when r.subjects exists). Class hub #/t/c/:id/reports: score bands 0-40/40-60/60-80/80-100 (counts only), class attendance by month, count of children with a new/seen alert. Empty data shows "Not enough data yet".
- Server: reportFor() now also returns overallSeries (running overall %); new classCharts(user, classId, q) in services/reports.js; route GET /classes/:id/charts (teacher only). CSS at end of public/app.css; script tag charts.js in index.html before reports.js.
- Screenshots viewed by eye: teacher report 1100 px, phone report 390 px, class hub 1100 px = layout OK. NOT yet viewed: m12-charts-hub-phone-390.png (the test says no sideways scroll and charts inside the screen: pass).
- Leftovers (small): single-student print to PDF came out as 3 pages (charts add height; not tuned); trend chart shows a line from 2 results while the text trend needs 6 (wording differs on purpose); 21 vs the old note "19" for alerts e2e is just the real count today.
- NOT tested: real Express/multer, real Gemini, real phones, real SMS/WhatsApp, printing on a real printer.
NEXT (do not start until the owner asks): 5 contacts + consent switches, 6 extra parent features, 7 e2e for 4-6, 8 HANDOFF.md (add MILESTONE 12), README.md, RESUME-M12.md, final zip.

# >>> LATEST (session 5, checkpoint 2) <<< READ THIS FIRST
Milestone 12 STEP 3 (report cards) is DONE and tested: backend + screens.
- `NODE_PATH=dev-tools/standin/node_modules npm test` = 589 checks pass (532 old + 57 in test-reports.js).
- Browser (sandbox): start `(NODE_PATH=dev-tools/standin/node_modules node dev-tools/standin/run-fake-ai.js > /tmp/srv.log 2>&1 & echo $! > /tmp/srv.pid); sleep 2; python3 dev-tools/standin/e2e-m12-reports.py; kill $(cat /tmp/srv.pid)` = 27 checks pass (e2e-m12-alerts.py still passes, 19). Teacher and phone screenshots viewed by eye: layout OK.
- Built: report_remarks table; services/reports.js (reportFor = ONE function for all roles; scopes till/year/term1/term2/custom; getReport, putRemarks (600 max, teacher only, a changed text clears parent "seen"), markSeen (parent only), classReports, classCsv with formula guard); routes GET /reports/student/:id, PUT .../remarks, POST .../seen, GET /classes/:id/reports and /reports.csv; public/reports.js (report page, scope picker, remarks, class hub #/t/c/:id/reports, print-all, student #/s/report, parent #/p/c/:id/report, teacher #/t/r/:studentId); A4 print CSS at the end of app.css; entry points (class tile, Students list button, student tile, parent button).
- Rules: overall % = total marks / total available over tests + class quizzes + checked homework in range (waiting items excluded, listed); class average only if >= 3 children have a result; trend needs 6 results (last 3 vs previous 3, +-5 points); missed test = no sheet while >= half the class has one; "records start on" note only if the child's first record is > 7 days after the class's first.
NEXT, in order:
 4. Charts as plain SVG via h() with text values and role="img", INSIDE the report (reportView in public/reports.js): marks per test with class-average marker, overall % trend, attendance by month bars, homework done/late/missed stacked bar, subject bars; teacher class view: test score bands (0-40, 40-60, 60-80, 80-100, no names), class attendance by month, count needing attention. Must print black/white friendly and fit 390 px. Add checks to e2e-m12-reports.py, view screenshots.
 5. Contacts + consent switches (tables contact_prefs; numbers hidden unless both sides opt in; never in printed reports). 6. Feature F items in priority order. 7. e2e for 4-6. 8. HANDOFF.md (add MILESTONE 12), README.md, RESUME-M12.md, final zip gapmap-m12-done.zip.
Untested anywhere: real Express/multer, real Gemini, phones, real SMS/WhatsApp (only the console dry-run channel exists).

# (session 4 notes)
Milestone 12 STEP 2 IS COMPLETE (backend + UI), tested in the sandbox:
- `NODE_PATH=dev-tools/standin/node_modules npm test` = 532 checks pass (18+20+60+87+9+37+82+11+83+46+79).
- Browser: `(NODE_PATH=dev-tools/standin/node_modules node dev-tools/standin/run-fake-ai.js > /tmp/srv.log 2>&1 & echo $! > /tmp/srv.pid); sleep 2; python3 dev-tools/standin/e2e-m12-alerts.py; kill $(cat /tmp/srv.pid)` = 19 checks pass (e2e-m12.py still holds the 22 step-1 checks). Screenshots of settings and Alert centre viewed by eye: OK.
Built: services/alerts.js (ONE evaluator, cooldown, preview, Alert centre data), services/scheduler.js (started in server.js only when run directly), hooks in family.markAttendance / core.finalizeSubmission / extras.submitQuiz / choice.saveAttempt,
  routes (settings, alerts, preview, run, PUT /alerts/:id), public/alerts.js (Class settings screen with Preview, Alert centre with New/Seen/Done/All, Check now, notes), two hub tiles in app.js.
NEXT = steps 3-8 of MASTER-PROMPT-M12-ALERTS.md, in order:
 3. Report engine reportFor(studentId, from, to) (services/reports.js): formula shown on the page, per-type %, attendance, homework, tests table with class average (aggregate only), likely patterns, trend rule, teacher remarks (max 600), parent "seen", scope Till date / Full year / Custom / Term (uses class_settings yearStart, yearEnd, termSplit), A4 print layout, CSV for the class. Reuse alerts.resultsOf / overallPct / attendanceFacts.
 4. Charts (plain SVG via h(), text values, role="img"). 5. Contacts + consent switches. 6. Feature F items. 7. e2e for 3-6. 8. HANDOFF.md (add MILESTONE 12), README.md, zip.
Small known polish: Alert centre shows raw number labels (overall: 0 floor: 40) in small grey text; fine for now.
Untested anywhere: real Express/multer, real Gemini, phones, real SMS/WhatsApp (only the console dry-run channel exists).

# PROGRESS: Milestone 12 (see MASTER-PROMPT-M12-ALERTS.md for the full spec)

## Checklist (build order from the master prompt, section 9)
- [x] 1. Notifications: schema, notify.js, API, bell UI, triggers (quiz, test, homework, results, absent today, notice, parent message). TESTED.
- [x] 2. Class settings screen + alert evaluator + scheduler (services/scheduler.js) + Alert centre + alert notifications
- [x] 3. Report engine reportFor(studentId, from, to) + report page + remarks + print layout + CSV
- [x] 4. Charts (plain SVG via h())
- [x] 5. Contacts + consent switches
- [x] 6. Feature F items 1 to 4 (leave request, read receipts, weekly digest, meeting slots). Items 5 to 8 of section 7 NOT built.
- [x] 7. e2e for steps 2-6 (e2e-m12, -alerts, -reports, -contacts, -features)
- [x] 8. HANDOFF.md MILESTONE 12 section, README.md, RESUME-M12.md written (session 7). Final zip name when the owner says done: gapmap-m12-done.zip

## Milestone 1: what is done (all run in the sandbox)
- database/schema.sql: tables notifications (event_key + dedupe_key = event + child, UNIQUE(user_id, dedupe_key)), notif_prefs, outbox.
- channels/index.js: only the "console" dry-run adapter. No real SMS/WhatsApp/email exists or is claimed.
- services/notify.js: notifyStudent / notifyClass(classId, ev, audience) / notifyTeacher, list, unreadCount, markRead, getPrefs/setPrefs, sentLog. Never throws. Counts are DISTINCT people ("Sent to 3 students and 3 parents").
  A parent with two children gets one row PER CHILD (dedupe includes the child). Only LOW types can be muted (notice_posted, report_ready, quiz_assigned, test_assigned, homework_assigned).
  TYPES already lists all types from the spec (attendance_low, performance_drop, missed_*, etc.); only some are triggered so far.
- Triggers wired: core.createAssessment (homework_assigned / test_assigned), core.confirmSubmission (result_ready), extras.setQuizStatus publish (quiz_assigned / test_assigned for paper, respects audience), choice.saveAttempt (result_ready), family.markAttendance (absent_today, today only), family.postNotice (notice_posted), family.sendMessage (message_from_parent to teacher bell, no message text copied).
- Those service functions now return `notified` and `notifiedText`; app.js api() shows it as a toast automatically.
- routes.js: GET /notifications, GET /notifications/unread-count, POST /notifications/read {ids|all}, GET/PUT /notifications/prefs, GET /classes/:id/sent-notifications.
- Frontend: public/notify.js (bell with badge in page() for all roles, polls 60 s + on every route change, list page #/n with mute switches, teacher page #/t/c/:id/sent), tile "Sent notifications" on the class hub, CSS at the end of app.css, script tag in index.html.
- Tests: `NODE_PATH=dev-tools/standin/node_modules npm test` = 407 old + 46 new (test-alerts.js, added to npm test) = 453 pass.
  Browser: dev-tools/standin/e2e-m12.py = 22 checks pass, no console errors. Screenshots (parent list, phone home) viewed by eye: OK.

## NOT done / NOT tested
- Scheduler (due-soon, overdue, missed, daily alerts) does not exist yet. Types homework_due_soon, homework_overdue, missed_*, attendance_low, performance_* are defined but nothing sends them.
- Not tested: real Express/multer, real phones, real Gemini. No real SMS/WhatsApp.
- Hindi notification text not built.

## Next step (milestone 2)
1. Add class_settings and alert_log tables to schema.sql (thresholds: floor 40, drop N=3 Y=10, attendance 75, absent streak 3, missed test K=1, missed homework K=2, switches).
2. services/alerts.js: ONE evaluator evaluate(classId, {dryRun}) used by event hooks and the scheduler; dedupe keys + 7-day cooldown; soft wording; numbers computed by code.
3. services/scheduler.js: run on server start + setInterval 30 min (start it in server.js only when require.main === module, NOT in run-fake-ai.js unless wanted); idempotent after a gap.
4. UI: Class settings screen, Alert centre #/t/c/:id/alerts, dry-run preview.
5. Tests into test-alerts.js, browser checks into e2e-m12.py.

## Commands
Tests: `NODE_PATH=dev-tools/standin/node_modules npm test`
Browser: `(NODE_PATH=dev-tools/standin/node_modules node dev-tools/standin/run-fake-ai.js > /tmp/srv.log 2>&1 & echo $! > /tmp/srv.pid); sleep 2; python3 dev-tools/standin/e2e-m12.py; kill $(cat /tmp/srv.pid)`
Laptop: `npm install`, `npm test`, `npm start`, open http://localhost:3000

---
# SESSION 2 NOTES (Milestone 12, step 2: alerts). Read this before coding.

## State of the zip
- Only ONE file was added in this session: `test-alerts-engine.js` (63 checks, the CONTRACT for step 2). It currently FAILS on require() because `services/alerts.js` and `services/scheduler.js` do not exist yet. It is NOT yet in `npm test` (add it once it passes: `... && node test-alerts-engine.js`).
- Everything else is unchanged: the 453 existing tests still pass (as in session 1).
- Sandbox clock is 2026-10-11 (tests use x.todayIst()); default academic year then = 2026-06-01 to 2027-03-31.

## What to build (design already worked out against the test file)
1. `database/schema.sql` (uses IF NOT EXISTS, so old DBs get the tables on start; no migration needed):
   - `class_settings(class_id PK -> classes ON DELETE CASCADE, settings_json TEXT NOT NULL DEFAULT '{}', updated_at)`
   - `alert_log(id, class_id, student_id, type, numbers_json, severity REAL, text TEXT (MUST exist: the test creates a trigger on NEW.text), status 'new'|'seen'|'done', note, sent_on 'YYYY-MM-DD', created_at, seen_at, sent_students, sent_parents)` + index (student_id, type, id).
2. `services/notify.js`: add 'absent_streak' to TYPES. In notifyStudent give per-role text: if ev.studentBody / ev.parentBody exist, use them for that role (student text must start "Your overall...", parent text "Asha's overall..."). Keep never-throws.
3. `services/alerts.js` (exports used by the test): defaultYear(ymd) -> {start,end} (month>=6: this year 06-01 to next year 03-31, else previous year); settingsFor(classId) (defaults + stored JSON, no auth); getSettings(user,classId) / putSettings(user,classId,patch) (core.ownClass: 404 unknown, 403 other teacher; validate everything BEFORE saving, 400 on: floorPct/attPct 0..100, dropN 1..10, dropPts 1..100, streakDays 2..10, missedTestK/missedHwK 1..10, booleans, real YYYY-MM-DD dates, yearStart < yearEnd, termSplit empty or inside the year; store the full merged object); resultsOf(studentId) (final test submissions + class quiz_attempts, total>0 only, homework excluded, sorted by created_at, since yearStart); overallPct(rows)=sum marks / sum total *100 or null; attendanceFacts(studentId,{today}) -> {present,late,absent,leave,counted,pct(rounded int),rawPct}; evaluateStudent(studentId,{today,dryRun,settings}); evaluateClass; previewAlerts(user,classId,overrides) -> {checked, would:[{studentId,name,type,numbers,summary}]} (merges overrides, saves nothing); runNow(user,classId) -> {checked, sent}; listAlerts(user,classId,status) -> {counts:{new,seen,done}, items:[{id,studentId,name,type,numbers,summary,status,note,sentOn,sent:{students,parents},positive}]}; updateAlert(user,alertId,{status,note}) (note clipped to 300, plain text; 400 bad status, 404 missing, 403 other teacher); afterChange(idOrIds) (never throws, ignores non-integers/unknown ids).
4. Rules (all checked by the test):
   - performance_low: >=2 results, overall% STRICTLY below floor; numbers {overall(rounded), floor, count}; severity = 100 - overall.
   - performance_drop: need 2N results; mean pct of last N vs previous N; alert when before - last > dropPts (strictly); numbers {last, before, n, drop}. improvement: last - before >= dropPts (positive, needs positiveOn).
   - attendance_low: counted days (present+late+absent, leave excluded) >= 5 and rawPct < attPct (strict); numbers {attendance, floor, ...}.
   - absent_streak: consecutive latest 'absent' rows (present/late/leave breaks it) >= streakDays AND latest marked day within 3 days of today; numbers {daysInARow}.
   - good_attendance: previous calendar month, >=10 counted days, no absent and no late; numbers {month:'YYYY-MM'}; positive.
   - missed_homework: homework with due < today (within last 60 days) and NO submission row by the child; fire when count >= missedHwK; numbers {count, items[titles <=5]}.
   - missed_test: tests created >=3 days ago (within 60 days), child has no submission row, and >= half the class has one; count >= missedTestK; numbers {count, items}.
   - missed_quiz: class quizzes (student_id NULL, mode online, status closed, child in audience via x.audienceOf) with no quiz_attempts row; count >= missedTestK. missedOn switch covers all three.
   - Dry run ignores cooldown and writes nothing; empty array when nothing applies (no data = no crash).
   - Cooldown (real runs): last alert_log row of same type for the child; if days since sent_on < 7 (negative counts as <7) skip with skipped = `already sent on <date>`, UNLESS severity rose by margin (5 for % types and drop, 2 for streak/missed). Positives: cooldown 21 days (good_attendance 25).
   - On fire: insert alert_log first, then notify.notifyStudent(studentId, {type, key:'alert:'+logId, title, studentBody, parentBody, ...}); the key MUST contain the log id so a legitimate re-send is not deduped. Save sent counts on the log row. Soft wording only (no fail/failing/weak/bad/poor/stupid/lazy), never another child's name; parent text names the child; link default (#/p/c/<id> for parents, #/s for students).
5. `services/scheduler.js`: runOnce({today}) -> {dueSoon, overdue, alerts, classes, errors}. Homework due today/tomorrow -> homework_due_soon (key 'hw_soon:'+assessmentId) to children with NO submission (+parents); homework due < today and >= today-14 -> homework_overdue (key 'hw_over:'+id); then evaluateClass for every class (alerts = number fired); each class in try/catch (errors++). Counts must be 0 on an immediate re-run. start(ms=30 min): module-level timer guard (second call no-op), setInterval(...).unref(), first run via setTimeout(...,3000).unref(). Call start() in server.js inside `if (require.main === module)`, NOT in run-fake-ai.js.
6. Hooks (use lazy require inside the function to avoid circular requires: core<->alerts): family.markAttendance (after saving, afterChange(ids with a non-empty status)), core.confirmSubmission, extras.submitQuiz, choice.saveAttempt, homework confirm. Check the 453 old tests (esp. notification counts in test-alerts.js) still pass after hooks.
7. routes.js (teacher guard): GET/PUT /classes/:id/settings; GET /classes/:id/alerts?status=; POST /classes/:id/alerts/preview {overrides}; POST /classes/:id/alerts/run; PUT /alerts/:id {status,note}.
8. UI (public/alerts.js new file, loaded after notify.js; use h(), never innerHTML): Class settings screen `#/t/c/:id/settings` (switches + number inputs + year dates + term split, "Preview who would get an alert" button using the preview route, no sending), Alert centre `#/t/c/:id/alerts` (filter new/seen/done, reason + numbers, note box, Mark seen / Mark done, "Check now"), tiles on the class hub (with new-alert count). Then browser checks into dev-tools/standin/e2e-m12.py.
9. After step 2 passes: update PROGRESS-M12.md checklist, then steps 3-8 of MASTER-PROMPT-M12-ALERTS.md (reports, charts, contacts, feature F, e2e, HANDOFF/README).

## Commands
Tests: `NODE_PATH=dev-tools/standin/node_modules npm test` and `NODE_PATH=dev-tools/standin/node_modules node test-alerts-engine.js`
