// Milestone 11 tests: parent portal, attendance, notices, login lock, session expiry, old-database migration, bug fixes.
// No internet, no AI.
process.env.DATABASE_PATH = ':memory:';
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const auth = require('./services/auth');
const core = require('./services/core');
const x = require('./services/extras');
const fam = require('./services/family');
const db = require('./database/db');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const status = async (fn) => { try { await fn(); return 0; } catch (e) { return e.status || 'CRASH:' + e.message; } };
const is = async (fn, ...codes) => codes.includes(await status(fn));
const noAi = { configured: () => false };
const user = (u, p, role) => auth.userFromToken(auth.login(u, p, role).token);

(async () => {
  auth.createUser({ username: 'teach1', password: 'pass1234', name: 'Teacher One', role: 'teacher' });
  auth.createUser({ username: 'teach2', password: 'pass1234', name: 'Teacher Two', role: 'teacher' });
  const T1 = user('teach1', 'pass1234'), T2 = user('teach2', 'pass1234');
  const clsA = core.createClass(T1, 'Class A'), clsB = core.createClass(T2, 'Class B');
  const clsA2 = core.createClass(T1, 'Class A2');
  const [s1, s2, s3] = ['Asha', 'Ravi', 'Meena'].map((n, i) => core.addStudent(T1, clsA.id, { name: n, roll: String(i + 1) }));
  const sB = core.addStudent(T2, clsB.id, { name: 'Zed', roll: '1' });
  const sOther = core.addStudent(T1, clsA2.id, { name: 'Other', roll: '1' });
  const S1 = user(s1.login.username, s1.login.pin, 'student'), S2 = user(s2.login.username, s2.login.pin, 'student');

  // ---------------- parent logins ----------------
  const p1 = fam.addParent(T1, s1.id, { name: 'Mrs Rao', relation: 'Mother' });
  t('new parent login: username starts with parent- and a 6-digit password', /^parent-/.test(p1.login.username) && /^\d{6}$/.test(p1.login.password), JSON.stringify(p1));
  const P1 = user(p1.login.username, p1.login.password, 'parent');
  t('parent can sign in as a parent', P1.role === 'parent');
  t('parent cannot sign in through the student or teacher door', await is(() => auth.login(p1.login.username, p1.login.password, 'student'), 401) && await is(() => auth.login(p1.login.username, p1.login.password, 'teacher'), 401));
  t('parent needs a name', await is(() => fam.addParent(T1, s2.id, { name: '  ' }), 400));
  t('parent password must be 6+ characters', await is(() => fam.addParent(T1, s2.id, { name: 'X', password: '123' }), 400));
  t('teacher can choose the password', (() => { const r = fam.addParent(T1, s2.id, { name: 'Mr Das', password: 'chosen99' }); return r.login.password === 'chosen99' && Boolean(user(r.login.username, 'chosen99', 'parent')); })());
  const p2 = fam.listParents(T1, s2.id)[0];
  t('listParents shows name, username and relation only', p2 && p2.name === 'Mr Das' && !('hash' in p2) && !('salt' in p2) && p2.relation === 'Parent');

  t('another teacher cannot list, add, reset or remove parents of my student', await is(() => fam.listParents(T2, s1.id), 403) && await is(() => fam.addParent(T2, s1.id, { name: 'Spy' }), 403)
    && await is(() => fam.resetParentPassword(T2, s1.id, p1.userId), 403) && await is(() => fam.unlinkParent(T2, s1.id, p1.userId), 403));

  // brothers and sisters: one parent login, two children
  const link = fam.addParent(T1, s3.id, { linkUsername: p1.login.username, relation: 'Mother' });
  t('same parent can be linked to a second child', link.linked === true && fam.children(P1).length === 2);
  t('linking the same child twice is refused (409)', await is(() => fam.addParent(T1, s3.id, { linkUsername: p1.login.username }), 409));
  t('linking a username that does not exist is 404', await is(() => fam.addParent(T1, s3.id, { linkUsername: 'nobody-here' }), 404));
  t('a teacher cannot link a parent who belongs only to another teacher', await is(() => fam.addParent(T2, sB.id, { linkUsername: p1.login.username }), 404));
  t('linking a teacher or student username is refused', await is(() => fam.addParent(T1, s3.id, { linkUsername: 'teach1' }), 404) && await is(() => fam.addParent(T1, s3.id, { linkUsername: s1.login.username }), 404));

  // ---------------- test data so reports have something real ----------------
  const asm = core.createAssessment(T1, clsA.id, { title: 'Fractions check', expressions: core.PRESETS[0].expressions });
  const wrong = ['2/5', '3/10', '4/10', '1/2', '5/8', '1/2', '2/5'];   // adds tops and bottoms 3 times
  await core.manualSubmission(T1, noAi, asm.id, s1.id, Object.fromEntries(wrong.map((a, k) => ['Q' + (k + 1), a])));
  t('manual sheet with zero answers is refused (400)', await is(() => core.manualSubmission(T1, noAi, asm.id, s2.id, { Q1: '', Q2: '   ' }), 400));

  // ---------------- parent portal privacy ----------------
  const kids = fam.children(P1);
  t('parent sees only their own children', kids.length === 2 && kids.map((k) => k.name).sort().join() === 'Asha,Meena', JSON.stringify(kids));
  const rep = fam.childReport(P1, s1.id);
  t('report has the child, highlights, tests, attendance, notices and tips', rep.student.name === 'Asha' && rep.highlights.length >= 1 && rep.tests.length === 1 && rep.attendance && Array.isArray(rep.notices) && rep.tips.length >= 3);
  t('report says "likely pattern, not proof" and never "diagnosed"', /not proof/.test(JSON.stringify(rep.highlights)) && !/diagnos/i.test(JSON.stringify(rep)));
  t('report never contains interview practice', !/interview/i.test(JSON.stringify({ ...rep, privacy: undefined, tips: undefined })), '');
  t('parent cannot open a child of the same class who is not theirs (404)', await is(() => fam.childReport(P1, s2.id), 404));
  t('parent cannot open another teacher\'s student (404, same as not found)', await is(() => fam.childReport(P1, sB.id), 404) && await is(() => fam.childReport(P1, 99999), 404));
  t('parent cannot send a message about a child who is not theirs', await is(() => fam.sendMessage(P1, s2.id, 'Hello teacher'), 404));
  const resMock = () => { const r = { code: 0, status(c) { r.code = c; return r; }, json() { return r; } }; return r; };
  const gate = (role, token) => { const res = resMock(); let went = false; auth.requireRole(role)({ headers: { authorization: 'Bearer ' + token } }, res, () => { went = true; }); return { went, code: res.code }; };
  const ptok = auth.login(p1.login.username, p1.login.password).token;
  t('parent token is refused by teacher and student doors (403)', gate('teacher', ptok).code === 403 && gate('student', ptok).code === 403 && gate('parent', ptok).went);
  const stok = auth.login(s1.login.username, s1.login.pin).token;
  t('student token is refused by the parent door', gate('parent', stok).code === 403);

  // ---------------- attendance ----------------
  const today = x.todayIst(), d = (n) => x.addDays(today, -n);
  const day = fam.attendanceDay(T1, clsA.id, today);
  t('attendance sheet lists every student, none marked yet', day.students.length === 3 && day.markedCount === 0);
  const saved = fam.markAttendance(T1, clsA.id, today, { [s1.id]: 'present', [s2.id]: 'absent', [s3.id]: 'late' });
  t('marking saves 3 and shows them back', saved.saved === 3 && saved.markedCount === 3 && saved.students.find((s) => s.id === s2.id).status === 'absent');
  t('marking again changes the mark (no duplicates)', fam.markAttendance(T1, clsA.id, today, { [s2.id]: 'present' }).students.find((s) => s.id === s2.id).status === 'present'
    && db.get('SELECT COUNT(*) AS n FROM attendance WHERE student_id = ? AND day = ?', [s2.id, today]).n === 1);
  t('empty string removes a mark', fam.markAttendance(T1, clsA.id, today, { [s3.id]: '' }).students.find((s) => s.id === s3.id).status === null);
  t('future day refused (400)', await is(() => fam.markAttendance(T1, clsA.id, x.addDays(today, 1), { [s1.id]: 'present' }), 400));
  t('day older than 120 days refused (400)', await is(() => fam.markAttendance(T1, clsA.id, d(121), { [s1.id]: 'present' }), 400) && await is(() => fam.markAttendance(T1, clsA.id, d(120), { [s1.id]: '' }), 0));   // exactly 120 days back is allowed (saves nothing: empty removes)
  t('impossible dates give a clean 400, never a crash (2026-02-31, 2026-13-01, abc, empty)',
    await is(() => fam.markAttendance(T1, clsA.id, '2026-02-31', { [s1.id]: 'present' }), 400) && await is(() => fam.markAttendance(T1, clsA.id, '2026-13-01', { [s1.id]: 'present' }), 400)
    && await is(() => fam.markAttendance(T1, clsA.id, 'abc', { [s1.id]: 'present' }), 400) && await is(() => fam.markAttendance(T1, clsA.id, '', { [s1.id]: 'present' }), 400)
    && await is(() => fam.attendanceDay(T1, clsA.id, '2026-02-31'), 400) && await is(() => fam.attendanceDay(T1, clsA.id, '2026-99-99'), 400));
  t('bad status refused (400)', await is(() => fam.markAttendance(T1, clsA.id, today, { [s1.id]: 'sleeping' }), 400));
  const before = db.get('SELECT COUNT(*) AS n FROM attendance').n;
  t('a student from another class refused, and NOTHING is saved (all or nothing)', await is(() => fam.markAttendance(T1, clsA.id, d(1), { [s1.id]: 'present', [sOther.id]: 'present' }), 400) && db.get('SELECT COUNT(*) AS n FROM attendance').n === before);
  t('empty marks refused (400)', await is(() => fam.markAttendance(T1, clsA.id, today, {}), 400) && await is(() => fam.markAttendance(T1, clsA.id, today, null), 400) && await is(() => fam.markAttendance(T1, clsA.id, today, [1]), 400));
  t('another teacher cannot read or mark my class (403)', await is(() => fam.attendanceDay(T2, clsA.id, today), 403) && await is(() => fam.markAttendance(T2, clsA.id, today, { [s1.id]: 'absent' }), 403)
    && await is(() => fam.attendanceSummary(T2, clsA.id), 403) && await is(() => fam.attendanceCsv(T2, clsA.id), 403));

  // percentages: Asha already has today = present. Add 2 present, 1 late, 1 absent, 3 leave
  fam.markAttendance(T1, clsA.id, d(1), { [s1.id]: 'present' }); fam.markAttendance(T1, clsA.id, d(2), { [s1.id]: 'present' });
  fam.markAttendance(T1, clsA.id, d(3), { [s1.id]: 'late' }); fam.markAttendance(T1, clsA.id, d(4), { [s1.id]: 'absent' });
  for (const n of [5, 6, 7]) fam.markAttendance(T1, clsA.id, d(n), { [s1.id]: 'leave' });
  let a = fam.attendanceFor(s1.id);
  t('attendance %: present+late over present+late+absent, leave not counted (4 of 5 = 80%)', a.pct === 80 && a.leave === 3 && a.markedDays === 8 && a.low === false, JSON.stringify(a));
  fam.markAttendance(T1, clsA.id, d(8), { [s1.id]: 'absent' });
  a = fam.attendanceFor(s1.id);
  t('below 75% is flagged low (4 of 6 = 67%)', a.pct === 67 && a.low === true);
  t('a student with no marks has no percentage and is not flagged', fam.attendanceFor(s3.id).pct === null && fam.attendanceFor(s3.id).low === false);
  t('only leave marked = no percentage', (() => { fam.markAttendance(T1, clsA.id, d(9), { [s3.id]: 'leave' }); const r = fam.attendanceFor(s3.id); return r.pct === null && r.leave === 1; })());
  const sum = fam.attendanceSummary(T1, clsA.id);
  t('class summary counts low students and days marked', sum.lowCount === 1 && sum.classDays >= 8 && sum.students.length === 3 && !('recent' in sum.students[0]));
  const csv = fam.attendanceCsv(T1, clsA.id);
  t('attendance CSV has a header and one row per student', csv.text.trim().split(/\r?\n/).length === 4 && /^\uFEFFStudent,Roll,Present/.test(csv.text) && /\.csv$/.test(csv.filename));
  core.addStudent(T1, clsA.id, { name: '=HYPERLINK("http://x")', roll: '9' });
  t('attendance CSV neutralises spreadsheet formulas', !/(^|\n|,)=HYPERLINK/.test(fam.attendanceCsv(T1, clsA.id).text));
  t('parent report shows the attendance and a "below 75%" highlight', (() => { const r = fam.childReport(P1, s1.id); return r.attendance.pct === 67 && r.highlights.some((h) => /Attendance is 67%/.test(h.text) && h.level === 'watch'); })());
  t('parent child list flags needs-attention for low attendance', fam.children(P1).find((k) => k.id === s1.id).needsAttention === true);
  t('student sees their own attendance only', fam.studentAttendance(S1).pct === 67 && fam.studentAttendance(S2).markedDays === 1);
  t('a login with no student record cannot use the student views', await is(() => fam.studentAttendance({ id: 1, student_id: null }), 403) && await is(() => fam.studentNotices({ id: 1, student_id: null }), 403));

  // ---------------- notices ----------------
  t('notice needs a valid type, title and body', await is(() => fam.postNotice(T1, clsA.id, { title: 'Hello', body: 'x', kind: 'shout' }), 400) && await is(() => fam.postNotice(T1, clsA.id, { title: 'a', body: 'x' }), 400)
    && await is(() => fam.postNotice(T1, clsA.id, { title: 'Hello', body: '   ' }), 400));
  t('from_parent cannot be faked by a teacher', await is(() => fam.postNotice(T1, clsA.id, { title: 'Hello', body: 'x', kind: 'from_parent' }), 400));
  t('personal note for a student from another class refused', await is(() => fam.postNotice(T1, clsA.id, { title: 'Hello', body: 'x', studentId: sOther.id }), 400));
  t('personal note for another teacher\'s student refused (403)', await is(() => fam.postNotice(T1, clsA.id, { title: 'Hello', body: 'x', studentId: sB.id }), 403));
  t('other teacher cannot post to my class (403)', await is(() => fam.postNotice(T2, clsA.id, { title: 'Hello', body: 'x' }), 403));
  fam.postNotice(T1, clsA.id, { title: 'Holiday on Friday', body: 'School is closed.', kind: 'notice' });
  fam.postNotice(T1, clsA.id, { title: 'Well done Ravi', body: 'Great effort this week.', kind: 'praise', studentId: s2.id });
  const nS1 = fam.studentNotices(S1), nS2 = fam.studentNotices(S2);
  t('class-wide notice reaches every student', nS1.some((n) => n.title === 'Holiday on Friday') && nS2.some((n) => n.title === 'Holiday on Friday'));
  t('a personal note reaches only that student', nS2.some((n) => n.title === 'Well done Ravi' && n.personal) && !nS1.some((n) => n.title === 'Well done Ravi'));
  t('parent sees class notices and notes about their own child, not about other children', fam.childReport(P1, s1.id).notices.some((n) => n.title === 'Holiday on Friday') && !fam.childReport(P1, s1.id).notices.some((n) => n.title === 'Well done Ravi')
    && fam.childReport(user(p2name(), 'chosen99', 'parent'), s2.id).notices.some((n) => n.title === 'Well done Ravi'));
  function p2name() { return fam.listParents(T1, s2.id)[0].username; }

  // parent messages
  fam.sendMessage(P1, s1.id, 'Asha was ill on Monday.');
  const P2 = user(p2name(), 'chosen99', 'parent');
  t('a parent message is shown to that parent as "You"', fam.childReport(P1, s1.id).notices.some((n) => n.mine && n.from === 'You' && /ill on Monday/.test(n.body)));
  t('the teacher sees the parent message, marked fromParent', fam.listNotices(T1, clsA.id).some((n) => n.fromParent && /ill on Monday/.test(n.body) && n.studentName === 'Asha'));
  t('the STUDENT never sees the parent message', !fam.studentNotices(S1).some((n) => /ill on Monday/.test(n.body)) && !fam.studentNotices(S1).some((n) => n.mine));
  t('ANOTHER parent never sees it', !fam.childReport(P2, s2.id).notices.some((n) => /ill on Monday/.test(n.body)));
  t('even a parent of the same child (second login) does not see the other parent\'s message', (() => { const second = fam.addParent(T1, s1.id, { name: 'Mr Rao', relation: 'Father' }); const P3 = user(second.login.username, second.login.password, 'parent'); return !fam.childReport(P3, s1.id).notices.some((n) => /ill on Monday/.test(n.body)); })());
  t('message must have some text', await is(() => fam.sendMessage(P1, s1.id, ' '), 400));
  for (let i = 1; i < fam.MAX_PARENT_MESSAGES_PER_DAY; i++) fam.sendMessage(P1, s1.id, 'Message number ' + (i + 1));
  t('6th message in a day is refused (429)', await is(() => fam.sendMessage(P1, s1.id, 'One more please'), 429));
  t('a different parent can still send (limit is per parent)', await is(() => fam.sendMessage(P2, s2.id, 'Hello teacher'), 0));
  t('long messages are cut to 500 characters', (() => { fam.sendMessage(P2, s2.id, 'a'.repeat(900)); return fam.listNotices(T1, clsA.id).find((n) => n.body.length > 400).body.length === 500; })());
  const toDelete = fam.listNotices(T1, clsA.id).find((n) => n.title === 'Holiday on Friday');
  t('another teacher cannot delete my notice (403)', await is(() => fam.deleteNotice(T2, toDelete.id), 403));
  fam.deleteNotice(T1, toDelete.id);
  t('teacher can delete a notice; it disappears for students', !fam.studentNotices(S1).some((n) => n.title === 'Holiday on Friday') && await is(() => fam.deleteNotice(T1, toDelete.id), 404));
  t('notice text is stored as plain text (no HTML is run)', (() => { fam.postNotice(T1, clsA.id, { title: '<b>Hi there</b>', body: '<script>alert(1)</script>' }); const n = fam.listNotices(T1, clsA.id).find((q) => /Hi there/.test(q.title)); return n.body === '<script>alert(1)</script>'; })());

  // ---------------- reset, unlink, password change ----------------
  const oldTok = auth.login(p1.login.username, p1.login.password).token;
  const reset = fam.resetParentPassword(T1, s1.id, p1.userId);
  t('reset gives a new 6-digit password; the old one stops working and old sessions end', /^\d{6}$/.test(reset.password) && await is(() => auth.login(p1.login.username, p1.login.password), 401) && auth.userFromToken(oldTok) === null && Boolean(auth.login(reset.username, reset.password, 'parent')));
  t('reset for a child the parent is not linked to is 404', await is(() => fam.resetParentPassword(T1, s2.id, p1.userId), 404));
  const P1b = user(reset.username, reset.password, 'parent');
  t('parent changes own password: wrong old / too short refused', await is(() => auth.changePassword(P1b, 'wrong', 'newpass99'), 400) && await is(() => auth.changePassword(P1b, reset.password, '123'), 400));
  const tokBefore = auth.login(reset.username, reset.password).token;
  auth.changePassword(P1b, reset.password, 'newpass99');
  t('password change works, old password fails, other sessions end', Boolean(auth.login(reset.username, 'newpass99', 'parent')) && await is(() => auth.login(reset.username, reset.password), 401) && auth.userFromToken(tokBefore) === null);
  fam.unlinkParent(T1, s3.id, p1.userId);
  t('unlinking one child keeps the parent and their other child', fam.children(user(reset.username, 'newpass99', 'parent')).length === 1);
  fam.unlinkParent(T1, s1.id, p1.userId);
  t('unlinking the last child deletes the parent login', await is(() => auth.login(reset.username, 'newpass99'), 401) && !db.get('SELECT 1 FROM users WHERE id = ?', [p1.userId]));
  t('unlinking a parent who is not linked is 404', await is(() => fam.unlinkParent(T1, s2.id, 999999), 404));

  // ---------------- login lock and session expiry ----------------
  auth._throttle.reset();
  let now = 1000000; auth._throttle.setClock(() => now);
  let last = 0;
  for (let i = 0; i < auth._throttle.MAX_FAILS; i++) last = await status(() => auth.login('teach2', 'wrong-password'));
  t('8 wrong tries: the 8th is 401 and the 9th is locked (429), even with the right password', last === 401 && await is(() => auth.login('teach2', 'pass1234'), 429));
  t('the lock is per username: another user can still sign in', await is(() => auth.login('teach1', 'pass1234'), 0));
  now += 14 * 60 * 1000;
  t('still locked after 14 minutes', await is(() => auth.login('teach2', 'pass1234'), 429));
  now += 2 * 60 * 1000;
  t('unlocked after 15 minutes', await is(() => auth.login('teach2', 'pass1234'), 0));
  auth._throttle.setClock(null); auth._throttle.reset();
  t('a good sign-in clears the count (7 fails, 1 success, 7 fails is still fine)', await (async () => { for (let i = 0; i < 7; i++) await status(() => auth.login('teach1', 'bad')); await status(() => auth.login('teach1', 'pass1234')); for (let i = 0; i < 7; i++) await status(() => auth.login('teach1', 'bad')); return await is(() => auth.login('teach1', 'pass1234'), 0); })());
  auth._throttle.reset();
  const tk = auth.login('teach1', 'pass1234').token;
  t('a fresh session works', auth.userFromToken(tk) !== null);
  db.run("UPDATE sessions SET created_at = datetime('now', '-15 days') WHERE token = ?", [tk]);
  t('a session older than 14 days no longer works', auth.userFromToken(tk) === null);
  const tk2 = auth.login('teach1', 'pass1234').token;
  db.run("UPDATE sessions SET created_at = datetime('now', '-13 days') WHERE token = ?", [tk2]);
  t('a 13-day-old session still works', auth.userFromToken(tk2) !== null);

  // ---------------- ghost student bug ----------------
  const count = db.get('SELECT COUNT(*) AS n FROM students').n;
  t('bad PIN is refused and leaves NO student without a login', await is(() => core.addStudent(T1, clsA.id, { name: 'Ghost', roll: '77', pin: '12' }), 400) && db.get('SELECT COUNT(*) AS n FROM students').n === count && !db.get("SELECT 1 FROM students WHERE name = 'Ghost'"));

  // ---------------- old database file: users table rebuilt, data kept ----------------
  const file = path.join(os.tmpdir(), 'gapmap-old-' + process.pid + '.db');
  try { fs.unlinkSync(file); } catch (e) { /* none */ }
  const { DatabaseSync } = require('node:sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('teacher','student')), salt TEXT NOT NULL, hash TEXT NOT NULL, student_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  old.prepare("INSERT INTO users (username, name, role, salt, hash) VALUES ('oldteacher','Old Teacher','teacher','aa','bb')").run();
  old.prepare("INSERT INTO sessions (token, user_id) VALUES ('tok123', 1)").run();
  old.close();
  const code = `const auth=require('./services/auth'); const db=require('./database/db');
    const u=db.get("SELECT * FROM users WHERE username='oldteacher'"); const s=db.get("SELECT * FROM sessions WHERE token='tok123'");
    const id=auth.createUser({username:'parent-new',password:'abcdef',name:'P',role:'parent'});
    const sql=db.get("SELECT sql FROM sqlite_master WHERE name='users'").sql;
    const again=require('./database/db');
    console.log(JSON.stringify({kept: !!u && u.role==='teacher' && u.name==='Old Teacher', session: !!s && s.user_id===u.id, parent: id>1, sqlHasParent: /parent/.test(sql), tables: ['parent_links','attendance','notices'].every((n)=>!!db.get("SELECT 1 FROM sqlite_master WHERE name=?",[n]))}));`;
  const run = () => spawnSync(process.execPath, ['-e', code], { cwd: __dirname, env: { ...process.env, DATABASE_PATH: file }, encoding: 'utf8' });
  const r1 = run(); let o1 = {}; try { o1 = JSON.parse(r1.stdout.trim().split('\n').pop()); } catch (e) { /* shown below */ }
  t('old database: teacher and session kept, parent role now allowed, new tables exist', o1.kept && o1.session && o1.parent && o1.sqlHasParent && o1.tables, (r1.stderr || r1.stdout).slice(0, 300));
  const code2 = `const db=require('./database/db'); console.log(JSON.stringify({users: db.get('SELECT COUNT(*) AS n FROM users').n}));`;
  const r2 = spawnSync(process.execPath, ['-e', code2], { cwd: __dirname, env: { ...process.env, DATABASE_PATH: file }, encoding: 'utf8' });
  t('starting again on the migrated file is safe (nothing lost, nothing doubled)', JSON.parse(r2.stdout.trim().split('\n').pop()).users === 2, r2.stderr.slice(0, 200));
  try { fs.unlinkSync(file); } catch (e) { /* ignore */ }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
