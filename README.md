# GapMap

Evidence before diagnosis. Teachers check answer sheets; the computer marks them and checks every claimed mistake pattern; students get practice for their own gap.

## Run it
1. Install Node 22 or newer.
2. In this folder: `npm install`
3. Copy `.env.example` to `.env` and fill it in (below).
4. `npm start`, then open http://localhost:3000
5. Tests: `npm test` (no internet needed). With the server running, `npm run test:api` in a second window.

## .env keys
- `GEMINI_API_KEY` (required for AI) and `GEMINI_MODEL` (optional, defaults are tried): reads photos/PDFs of answer sheets, describes mistake rules, writes teaching ideas and hints. Without them you can still type answers.
- `TINYFISH_API_KEY`: online learning resources on the group screen. Without it that card says so.
- Never share or zip your `.env`. If a key was shared, create a new one and delete the old.

## Where the TinyFish key is used
Only in `services/tinyfish.js`, on the server. It runs when a teacher opens a group (Results > a group > "Learning resources"). Only the pattern name, for example "Adds tops and bottoms of fractions", is sent. Never student names, answers or sheets. If the key is missing or the call fails, no links are shown (no made-up links).

## Sample class
Teacher home > "Load sample class" adds a clearly labelled demo class so you can show every screen without real sheets.

## Milestone 5 features
- **Teacher:** Quizzes (AI from a topic, or typed; stays a draft until you publish; MCQ keys written by the AI are labelled), Participation (who attempted, who is absent, streaks, CSV), homework tests (due date, students hand in typed or by photo/PDF), printable remedial sheets, shared interview feedback.
- **Student hub:** My results, Quizzes (class quiz + own AI practice quiz, number questions only, 10 a day), Homework, Study help (AI mini lesson, TinyFish links, printable sheet), Interview practice (audio only, consent tick, deleted right after analysis), badges and streak.
- **Rules kept:** the AI never marks; number answers are always computed by code; the only AI-written keys are MCQ answers in teacher quiz drafts.
- **Real services not yet tried by the team:** Gemini quiz/lesson/audio calls, microphone and WAV conversion on phones, real multer uploads. Test these on your laptop before the demo.
- Tests: `npm test` now also runs `test-extras.js`.

## Milestone 6
- **Interview practice:** choose Voice only or Video (camera + voice). Video mode also looks at a few snapshots for eye contact, face expression and posture. Only the feedback text is stored; it is coaching, not a grade.
- **Quizzes without AI:** if the AI key is missing or the AI fails, quizzes are made from a built-in bank (fractions, integers, decimals, percentages, powers, order of operations) and the screen says why the AI was not used.
- **Student results:** a "Your problem" card names the mistake and the next step.
- Only `GEMINI_API_KEY` is required now; `GEMINI_MODEL` is optional.

## Milestone 7: any subject, any topic
- **Quizzes now work for every subject** (Biology, History, English, Computer Science, anything). Teacher types a subject + topic, or types multiple-choice questions by hand (no AI needed).
- **Every wrong option can name the mistaken idea behind it.** After students answer, the computer counts: the same mistaken idea in 2 or more questions = "likely", once = "suspected", no name on the wrong option = "unclear" (never guessed).
- **Teacher** sees "Mistake patterns in this class" (who is likely / suspected). **Student** sees "Your problem" and a "Help me with this" button (AI explanation, labelled, plus online links by topic only).
- **Evidence levels, kept honest:** maths = verified by code. Multiple choice = marked by code, but only as good as the answer key and mistaken-idea names, so the teacher must check AI drafts before publishing. Long written answers (essays) are NOT diagnosed.
- Students' own practice quizzes stay number-sums only (so no unchecked AI answer key ever reaches a student).
- Typed format: line 1 question, then 4 option lines, `*` before the correct one, ` | mistaken idea` after a wrong option, blank line between questions.
- Tests: `npm test` now also runs `test-concept.js`.

## Milestone 11
- **Parent portal:** teachers make a parent login for each student (Students > Parent login). Parents see their own child's tests, attendance, homework, notices and tips, and can message the teacher.
- **Attendance:** mark present/absent/late/leave each day; below 75% is flagged; download as CSV. Students see their own.
- **Notices:** post to the class or to one student; parents and students read them.

## Milestone 12: notifications, alerts, report cards, charts, contacts, leave and meetings
- **Notifications (the bell):** quizzes, tests, homework, results, absences and notices reach the student and every linked parent automatically. Alerts and missed-item messages cannot be muted; low-priority ones can.
- **Alerts:** the teacher sets the lines (overall score, drop in results, attendance, absent in a row, missed work) in Class settings. The computer checks them (no AI), sends calm messages, and the Alert centre lists what was sent. "Preview" shows who would get an alert without sending.
- **Report cards:** till date, full year, term or custom dates. The formula is shown on the page; class average is one number only; teacher remarks; parents tap "seen"; A4 print layout; class CSV.
- **Charts:** plain SVG (trend, marks per test, attendance by month, homework, class score bands). They print in black and white.
- **Contacts:** a teacher or parent may add a mobile number. Sharing is OFF by default; the other side sees it only if the owner switches sharing on. Never printed, never in reports.
- **Leave requests:** a parent asks, the teacher approves with one tap; approved days become "leave" and do not count against attendance.
- **Read receipts:** "Seen by 24 of 31 parents" on notices and alerts; parents tap "I have seen this".
- **Weekly digest:** every Sunday evening one summary per child to the parents (attendance, tests, next week's homework, one good-news line).
- **Meeting times:** the teacher posts slots, a parent books one per child, both get a reminder the day before.
- **Also:** "Coming up" list with a calendar (.ics) download, quick messages on alerts, CSV of alerts and sent notifications.
- **Hindi messages:** a teacher or parent can choose Hindi under Contact details ("Language for GapMap messages"). System messages (alerts, homework, results, leave, meetings, weekly digest) then arrive in Hindi; what the teacher writes is never translated. Screens and buttons stay in English.
- No real SMS/WhatsApp is sent: only an in-app dry-run channel exists. Tests: `npm test`.

---

## Quick demo (for reviewers)

```
npm install
npm start                 # http://localhost:3000
node demo-setup.js        # in a second terminal, once: creates a demo teacher, a labelled sample class and a parent, and prints the three logins
npm test                  # 779 automated checks
MODE=patched node sim-verifier.js    # simulation: 330,000 synthetic answers through the real verifier (MODE=original shows the old matcher)
```

The sample class is labelled "demo data" and uses typed answers. Handwriting photo reading needs a `GEMINI_API_KEY` (or `OPENROUTER_API_KEY`) in `.env`; copy `.env.example` to `.env`. Never commit `.env`.

Internal development notes are in `docs/dev-notes/`.
