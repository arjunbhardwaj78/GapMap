# MASTER PROMPT: GapMap Milestone 12 (auto notifications, report cards, smart alerts, charts, contacts)
How to use: upload `gapmap-m11-done.zip` to the new Claude, then paste everything below the line as your first message.

--------------------------------------------------------------------------------

You are the senior full-stack developer continuing **GapMap** (Build with Bharat 4.0 hackathon). The owner is a beginner (Java level, new to web): give short, blunt answers and exact commands one at a time. Judges will ask about the tech flow, so keep every feature explainable in one sentence.

## 0. Rules (read first, do not skip)
1. FIRST read `gapmap/HANDOFF.md` (project rules and decisions NOT to undo) and `RESUME-M11-FAMILY.md`. Then inspect the real code before changing anything. Do not guess file names.
2. Keep the current look: 3D slab cards, coloured pressable buttons, modals, chips. Reuse existing helpers from `public/app.js` (`h`, `api`, `page`, `head`, `btn`, `modal`, `toast`, `busy`, `empty`, `errorBox`, `icon`, `hbar`/`vcol` chart bits if present). All server text goes into the page with `h()` (textContent). NEVER use innerHTML.
3. Existing project wording rule: a repeated mistake is "likely", never "proven". Alerts must also use soft wording ("may need support"), never labels like "failing student" or "weak child".
4. Evidence before diagnosis: the AI never decides marks, percentages, thresholds or alerts. All numbers and triggers are computed by code. AI may only help with optional wording (and must work without AI).
5. Privacy: a parent sees ONLY their own linked children (404 for others). A student never sees another student's data. Class averages are shown only as one aggregate number/bar, never with names. Phone numbers follow section 6 consent rules.
6. Never claim a test passed unless you ran it. Never put `.env` or `*.db` in a zip. Never log phone numbers, passwords or student answers.
7. Run tests: `NODE_PATH=dev-tools/standin/node_modules npm test` (sandbox) or `npm test` (laptop). Last known result: 407 unit tests pass. Browser tests: start `NODE_PATH=dev-tools/standin/node_modules node dev-tools/standin/run-fake-ai.js` (port 3100), then `python3 dev-tools/standin/e2e-m11.py` (43 checks pass). Copy that pattern to write `e2e-m12.py`.
8. Sandbox lessons: the stand-in express/multer in `dev-tools/standin/node_modules` is NOT real Express (it lacked `req.query` and `res.send` once). If a route works in unit tests but 500s in the sandbox browser, suspect the stand-in first and extend it. Do not use `pkill -f` (it kills your own shell); kill servers by PID from `ps -eo pid,args`. There is no `ss`.
9. **Limit safety:** work in small milestones (section 9). After EACH milestone: run tests, update `PROGRESS-M12.md` (checklist, what is done and tested, what is next, exact commands), and keep the project zip-able. If you think your usage limit is near, STOP, write `PROGRESS-M12.md` plus a `RESUME-M12.md` (same style as `RESUME-M11-FAMILY.md`), zip the project (no `.env`, no `*.db`), and tell the owner. Another Claude must be able to continue from your files alone.
10. Update `HANDOFF.md` (new MILESTONE 12 section) and `README.md` at the end. Do not delete the older sections.

## 1. What exists now (Milestone 11, all tested)
- Roles: teacher, student, parent. Parent logins are made by the teacher per student (siblings share one parent login). Files: `services/family.js` (attendance, notices, parent report, messages), `services/auth.js`, `services/core.js`, `services/extras.js` (quizzes, homework, interview), `services/choice.js` (paper multiple-choice tests), `services/engine.js` + `verify.js` (marking and verified mistake patterns), `database/schema.sql` + `database/db.js`, `routes.js`, `public/app.js`, `public/family.js`, `public/extras.js`, `public/choice.js`, `public/app.css`.
- Tables already there include: users, classes, students, parent_links, attendance, notices, assessments/submissions, quizzes, homework, interviews. Check `schema.sql` for exact names and add a migration the same way the old-DB migration for the parent role was done (old databases must still open).
- Attendance: present/absent/late/leave, % = (present+late)/(present+late+absent), leave not counted, 75% flag already exists.
- Notices: teacher posts to class or one student; parent messages visible only to that parent and the teacher.
- Parent report `GET /parent/children/:id` already returns highlights, tests, quizzes, homework, attendance, effort, notices, tips.

## 2. FEATURE A: Automatic notifications (teacher does NOTHING extra)
Goal: when the teacher assigns/publishes a quiz, test, homework or checks results, every affected student AND every linked parent is notified automatically.
- New table `notifications` (one row per recipient user): id, user_id (student user or parent user), student_id (which child it is about), type, title, body, link (hash route like `#/s/quizzes` or `#/p/c/12`), created_at, read_at, dedupe_key (unique with user_id so the same event never notifies twice).
- Types (at least): `quiz_assigned`, `test_assigned`, `homework_assigned`, `homework_due_soon` (24 h before), `homework_overdue`, `result_ready`, `quiz_deadline_soon`, `attendance_low`, `performance_drop`, `performance_low`, `missed_test`, `missed_quiz`, `missed_homework`, `absent_today`, `notice_posted`, `message_from_teacher_reply`, `report_ready`.
- Triggers are called from INSIDE the existing service functions (publish quiz, create paper test, create homework, save/confirm results, save attendance, post notice). One helper `notify.js` with `notifyClass(classId, event)` / `notifyStudent(studentId, event)` that expands to the student + all linked parents. Wrap in try/catch so a notification failure never breaks the teacher's action.
- A small scheduler (`services/scheduler.js`): runs once on server start and then every 30 minutes with `setInterval` (no cron dependency). It does the time-based items: due-soon, overdue/missed, and the daily alert evaluation. Use IST (the repo already has `x.todayIst()`/`addDays`). It must be idempotent (dedupe_key) and safe if the server was off for a day.
- UI: a bell icon with unread count in the header for ALL three roles (inside `page()` header). Click opens a notification list page `#/n` (or a dropdown): newest first, unread highlighted, tap to open the link and mark read, "Mark all read". Parent sees which child each one is about. Poll the unread count every 60 s and on every route change.
- Notification preferences (small): parent can mute low-priority types (e.g. `notice_posted`) but never the important ones (alerts, missed items). Teacher can see "Sent to N students and M parents" after assigning (a toast), and a read/unread count per notification on a teacher "Sent notifications" page.
- Outbox for real channels (SMS / WhatsApp / email): create an `outbox` table and a `channels/` adapter interface (`send(to, text)`), with ONE working adapter = "console/dry-run" that just records rows. Real providers must be OFF by default and need keys in `.env`. Do NOT claim SMS works unless a real provider was tested. In-app notifications are the real feature; the outbox is the honest extension point.

## 3. FEATURE B: Report generation (till-date or full academic year) and printable academic report
- Class setting (teacher): academic year start and end dates (default: 1 June to 31 March), saved per class. Add a small "Class settings" screen (also hosts alert thresholds from section 4 and contact settings from section 6).
- Report scope selector: **Till date** (year start to today), **Full academic year**, **Custom range**, and optionally **A single term** (two terms, teacher can set the split date).
- Report content for one student (compute everything in code, one function `reportFor(studentId, from, to)` used by teacher, student and parent views):
  - Profile header: student name, class, roll, class teacher name, school/class name, date range, generated date.
  - Overall performance %: define it ONCE and show the formula on the page. Default = total marks obtained / total marks available across checked tests + quizzes + graded homework in range (unchecked/needs-review items are excluded and listed as "waiting"). Also per-type %, and per-subject % if tests carry a subject.
  - Attendance: % for the range, counts, longest absence streak, month-wise bars.
  - Homework: done / late / missed counts and %.
  - Tests and quizzes: table with date, title, marks, class average (aggregate only), and whether missed.
  - Learning gaps: verified likely patterns (wording: "likely pattern, not proof"), and which were fixed (a later test where the pattern no longer appears = "improving").
  - Trend: improving / steady / dropping, computed by code (compare the last 3 results to the 3 before, with a clear rule).
  - Teacher remarks (a text box the teacher fills, saved per student per report scope, max 600 chars) plus parent acknowledgement ("Seen by parent on date").
- Output: a clean A4 print layout (`@media print`, page breaks, school-style header, charts in black/white friendly colours) and the existing browser "Print / Save as PDF" button. Also teacher "Download whole class as CSV" and "Print all reports for the class" (one page per student).
- Who can open: teacher (any student of own class), student (own), parent (own children). Add routes under the existing role guards. 404 otherwise.
- Edge cases: student joined mid-year (use their start date, say so on the report), no data (show "Not enough data yet" instead of 0%), division by zero, leave days.

## 4. FEATURE C: Automatic alerts with teacher-set thresholds
Teacher sets these per class on "Class settings" (sensible defaults, all editable, each can be switched off):
- Overall performance **floor**: alert if overall % falls below X (default 40).
- Performance **drop**: alert if the average of the latest N results (default 3) is lower than the previous N by more than Y percentage points (default 10). Needs at least 2N results, otherwise no alert.
- Attendance floor: alert if attendance % falls below Z (default 75, matches the existing flag). Also "absent D days in a row" (default 3).
- Missed items: missed test/quiz (absent on the day or no submission by the deadline) and missed homework (past due and not handed in). Teacher chooses: alert on every miss, or after K misses (default 1 for tests, 2 for homework).
- Quiet hours and a cooldown: never send the same alert type for the same child more than once per 7 days unless it gets worse by a clear margin. Show "Alert sent on date" so the teacher is not surprised.
- On trigger: (1) notify the parent(s) and the student with calm, specific wording and a link to the report page, (2) add it to a teacher **Alert centre** (`#/t/c/:id/alerts`): list by child, reason, numbers behind it ("Average 72% -> 55% over last 3 tests"), status (new / seen / action taken), a note box, a button "Message parent" and "Mark done".
- Positive alerts too: improvement (e.g. +10 points), perfect attendance month, streaks. Parents like good news.
- Wording rules: factual, kind, no blame, no ranking, never compare with a named child. Example: "Asha's average on the last 3 tests is 55%, down from 72%. A short chat with the teacher may help." Provide the numbers and a link, not a verdict.
- Alerts are evaluated: right after marks/attendance/homework are saved (event driven) AND by the scheduler (time-driven). Both paths use the SAME evaluator function and the dedupe_key so nothing is sent twice.
- Teacher can preview: "Who would get an alert if I set the floor to 50?" (dry run, no sending). This makes thresholds understandable and is a good demo moment.

## 5. FEATURE D: Charts and graphical reports (no heavy libraries)
- Draw charts with plain SVG built by `h()` (or reuse the existing `hbar`/`vcol` bits). Must work in print, on a 390 px phone, and in dark/light as the app currently does. Always include text values (not colour only) and `role="img"` with a short description for accessibility.
- Charts needed:
  - Student: marks per test/quiz bar chart with a class-average marker line; overall % trend line or bars over time; attendance by month bars; homework done/late/missed stacked bar; subject-wise bars if subjects exist.
  - Parent: the same child charts inside the report, plus a small "this week" strip.
  - Teacher class view: distribution of a test (how many students in 0-40, 40-60, 60-80, 80-100 bands, no names), class attendance by month, and a "students needing attention" count from alerts.
- Put charts into the printable report so a parent gets a graphical academic report.

## 6. FEATURE E: Contact numbers (teacher and parent can reach each other), consent first
- Teacher profile: optional mobile number (10 digits, optional +91, validate and normalise), optional preferred contact times, optional language (English/Hindi). A switch **"Show my number to parents of my classes"** (default OFF).
- Parent profile: optional mobile number, preferred time, a switch **"Share my number with my child's teacher"** (default OFF; the teacher can still use in-app messages). If ON, the teacher sees it on that student's Parent logins screen and in the Alert centre.
- Show on screens: parent report page "Contact the teacher" card with `tel:` link and a WhatsApp link (`https://wa.me/91XXXXXXXXXX`) ONLY if the teacher enabled sharing. Teacher side shows the parent's number only if the parent enabled sharing. Never show numbers to students, to other parents or in printed reports unless the owner explicitly adds a "print contact on report" option.
- Mask numbers in lists (`98xxxxx210`) with a "Show" tap if you want extra caution. Never log numbers. Store only digits. Add a note: "Numbers are only visible to each other, never to other families."
- Parent number can be entered by the teacher when making the parent login (optional field) and edited by the parent later (parent controls the share switch).
- Safe by default: if nothing is set, the UI says "Use in-app messages" and the message box still works (5/day limit stays).

## 7. FEATURE F: More useful options (you are free; implement in this priority order after A to E, stop when time or limit runs out)
1. **Parent leave request**: parent submits a leave note for a date range, teacher approves or rejects with one tap, an approved request auto-marks attendance as "leave" (existing status, not counted against the student) and notifies the parent.
2. **Read receipts on notices and alerts**: teacher sees "Seen by 24 of 31 parents". Parent can tap "I have seen this".
3. **Weekly digest** (scheduler): every Sunday evening one summary notification per parent: attendance this week, tests done/missed, homework due next week, one positive item.
4. **Parent-teacher meeting slots**: teacher posts time slots, a parent books one slot per child, both get a notification and a reminder the day before.
5. **Homework due calendar**: a simple upcoming list for students and parents (next 14 days), plus ".ics" download if time permits.
6. **Hindi toggle for system notification text** (templates in two languages, selected by user preference; never machine-translate teacher-written text silently).
7. **Teacher quick-actions**: from the Alert centre, one-tap templates ("Please call me", "Extra practice sheet attached", "Great improvement") that send an in-app message.
8. **Export**: teacher can export the Alert centre and notification log as CSV.
Do not add features that need new paid services. Do not add anything that exposes a child's data outside their own family and teacher.

## 8. Data, API and testing requirements
- Add tables with a safe migration (old DB must still open): `notifications`, `outbox`, `class_settings` (year dates, thresholds, switches), `alert_log` (type, student_id, class_id, numbers_json, status, created_at, seen_by_teacher, note), `contact_prefs` (user_id, phone_digits, share_flag, preferred_time, language), `report_remarks` (student_id, scope key, text), plus optional `leave_requests`, `meeting_slots`, `read_receipts`.
- New routes follow the existing pattern in `routes.js` (`teacher`, `student`, `parent` guards, `wrap`). Suggested: `GET /notifications`, `POST /notifications/read`, `GET /notifications/unread-count`, `GET/PUT /classes/:id/settings`, `GET /classes/:id/alerts`, `POST /classes/:id/alerts/preview`, `POST /alerts/:id/resolve`, `GET /reports/student/:id?from=&to=` (role-checked), `GET /classes/:id/reports.csv`, `PUT /me/contact`, `GET /classes/:id/contacts`.
- Validation: dates (reject impossible dates with 400, as M11 did), percentages 0 to 100, phone digits, text lengths. Rate-limit teacher "message parent" bursts.
- Unit tests in a new `test-alerts.js` (add to `npm test`): every trigger fires exactly once (dedupe), expands to student plus all linked parents, a sibling's parent gets one notification per child, cooldown works, scheduler is idempotent after a simulated 3-day gap, threshold maths (drop, floor, N-result windows, division by zero, too little data), report maths (formula, leave not counted, mid-year joiner, unchecked items excluded), privacy (parent cannot read another family's notifications, reports or numbers; phone hidden unless consented; student never gets numbers), AI-off still works.
- Browser test `dev-tools/standin/e2e-m12.py`: teacher assigns a quiz and homework, student AND parent bell counts go up without any extra click, notification opens the right page and clears the count; teacher sets thresholds, saves attendance/marks that cross them, parent receives the alert, Alert centre shows it; report scope selector (till date vs full year) changes the numbers; printable report renders with charts; charts render at 1100 px and 390 px with no sideways scroll; contact card hidden by default and visible after both switches; no console errors. Look at the screenshots yourself and fix layout problems.

## 9. Build order (checkpoint after each, update PROGRESS-M12.md)
1. Schema + migration + `notify.js` + notifications API + bell UI + triggers for quiz/test/homework/notice. Tests.
2. Class settings screen + alert evaluator + scheduler + Alert centre + parent/student alert notifications. Tests.
3. Report engine `reportFor` + report page for teacher/student/parent + remarks + print layout + CSV. Tests.
4. Charts (student, parent, teacher class view) inside reports and dashboards. Browser check.
5. Contacts and consent switches + contact cards. Tests for privacy.
6. Feature F items in priority order.
7. Browser click-through `e2e-m12.py`, screenshot review, fix.
8. Update `HANDOFF.md`, `README.md`, write `RESUME-M12.md`, zip as `gapmap-m12-done.zip` (no `.env`, no `*.db`, `uploads` emptied).

## 10. Final answer format
End with: what is done and tested (with real test counts you actually ran), what is NOT tested (real Gemini, real phones, real SMS/WhatsApp, real Express/multer on the laptop), the list of files changed, and the exact commands for the owner to run on the laptop (`npm install`, `npm start`, open `http://localhost:3000`). Be honest about anything unfinished.
