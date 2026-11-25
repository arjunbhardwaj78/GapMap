// Family and school features: parent portal, attendance, notice board, parent-to-teacher messages.
// Rules kept from the rest of GapMap: nothing is invented, "likely" is never "proven", and a parent only ever sees
// their OWN linked children. A parent never sees another student, and never sees the student's private interview practice.
const crypto = require('crypto');
const db = require('../database/db');
const core = require('./core');
const x = require('./extras');
const concept = require('./concept');
const auth = require('./auth');
const notify = require('./notify');
const { HttpError } = auth;
const { J, must } = core;

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const LOW_ATTENDANCE = 75;            // percent: below this the app says so (common school and college rule)
const MAX_PARENT_MESSAGES_PER_DAY = 5;
const STATUSES = ['present', 'absent', 'late', 'leave'];
const KINDS = ['notice', 'praise', 'concern'];

const isDate = (d) => { // real calendar day only: 2026-02-31 and 2026-13-01 are refused (they used to crash with a 500)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))) return false;
  const ms = Date.parse(d + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === d;
};

// ================= PARENT LOGINS (teacher side) =================
const randomPassword = () => String(crypto.randomInt(100000, 1000000));
function parentUsername(studentId) {
  const base = ('parent-' + (db.get('SELECT username FROM users WHERE student_id = ?', [studentId])?.username || 'child' + studentId)).slice(0, 26);
  let u = base;
  while (db.get('SELECT id FROM users WHERE username = ?', [u])) u = base + crypto.randomInt(10, 100);
  return u;
}
function ownsParent(user, parentUserId) {   // is this parent linked to at least one of this teacher's students?
  return Boolean(db.get(`SELECT 1 FROM parent_links pl JOIN students s ON s.id = pl.student_id JOIN classes c ON c.id = s.class_id
    WHERE pl.user_id = ? AND c.teacher_id = ?`, [parentUserId, user.id]));
}

function listParents(user, studentId) {
  core.ownStudent(user, studentId);
  const contacts = require('./contacts');
  return db.all(`SELECT u.id AS userId, u.name, u.username, pl.relation FROM parent_links pl JOIN users u ON u.id = pl.user_id
    WHERE pl.student_id = ? ORDER BY pl.id`, [studentId]).map((p) => ({ ...p, contact: contacts.visible(p.userId) }));   // number only if the parent agreed
}

// Make a new parent login for this student, or link a parent you already made (brothers and sisters share one login).
function addParent(user, studentId, { name, relation, password, linkUsername, phone }) {
  const st = core.ownStudent(user, studentId);
  const rel = clip(relation, 30) || 'Parent';
  if (linkUsername) {
    const p = db.get("SELECT * FROM users WHERE username = ? AND role = 'parent'", [String(linkUsername).trim().toLowerCase()]);
    if (!p || !ownsParent(user, p.id)) throw new HttpError(404, 'No parent login with that username among your own students. Make a new login instead.');
    if (db.get('SELECT 1 FROM parent_links WHERE user_id = ? AND student_id = ?', [p.id, st.id])) throw new HttpError(409, 'That parent is already linked to this student.');
    db.run('INSERT INTO parent_links (user_id, student_id, relation) VALUES (?,?,?)', [p.id, st.id, rel]);
    return { linked: true, userId: p.id, name: p.name, username: p.username };
  }
  const contacts = require('./contacts');
  const digits = contacts.normalisePhone(phone);   // checked BEFORE anything is saved
  const nm = clip(name, 60);
  if (!nm) throw new HttpError(400, "Type the parent's or guardian's name.");
  if (password && String(password).length < 6) throw new HttpError(400, 'A parent password must be at least 6 characters.');
  const pw = password ? String(password) : randomPassword();
  const username = parentUsername(st.id);
  const userId = auth.createUser({ username, password: pw, name: nm, role: 'parent' });
  db.run('INSERT INTO parent_links (user_id, student_id, relation) VALUES (?,?,?)', [userId, st.id, rel]);
  if (digits) contacts.setInitialPhone(userId, digits);
  return { linked: false, userId, name: nm, login: { username, password: pw } };
}

function resetParentPassword(user, studentId, parentUserId) {
  core.ownStudent(user, studentId);
  const link = must(db.get('SELECT * FROM parent_links WHERE user_id = ? AND student_id = ?', [parentUserId, studentId]), 'That parent is not linked to this student.');
  const u = must(db.get('SELECT * FROM users WHERE id = ?', [link.user_id]));
  const pw = randomPassword();
  auth.setPassword(u.id, pw);   // also signs them out everywhere
  return { username: u.username, password: pw };
}

function unlinkParent(user, studentId, parentUserId) {
  core.ownStudent(user, studentId);
  const r = db.run('DELETE FROM parent_links WHERE user_id = ? AND student_id = ?', [parentUserId, studentId]);
  if (!r.changes) throw new HttpError(404, 'That parent is not linked to this student.');
  if (!db.get('SELECT 1 FROM parent_links WHERE user_id = ?', [parentUserId])) db.run("DELETE FROM users WHERE id = ? AND role = 'parent'", [parentUserId]);   // no children left: remove the login
  return { ok: true };
}

// ================= ATTENDANCE =================
function attendanceFor(studentId) {
  const rows = db.all('SELECT day, status FROM attendance WHERE student_id = ? ORDER BY day DESC', [studentId]);
  const c = { present: 0, late: 0, absent: 0, leave: 0 };
  rows.forEach((r) => { c[r.status]++; });
  const counted = c.present + c.late + c.absent;          // approved leave is not counted against the student
  const pct = counted ? Math.round(((c.present + c.late) / counted) * 100) : null;
  return { ...c, markedDays: rows.length, pct, low: pct !== null && pct < LOW_ATTENDANCE, threshold: LOW_ATTENDANCE, recent: rows.slice(0, 14) };
}

function attendanceDay(user, classId, date) {
  core.ownClass(user, classId);
  const day = date || x.todayIst();
  if (!isDate(day)) throw new HttpError(400, 'Date must look like 2026-10-12.');
  const students = db.all('SELECT id, name, roll FROM students WHERE class_id = ? ORDER BY id', [classId]);
  const marks = Object.fromEntries(db.all('SELECT student_id, status FROM attendance WHERE class_id = ? AND day = ?', [classId, day]).map((r) => [r.student_id, r.status]));
  return { date: day, today: x.todayIst(), students: students.map((s) => ({ ...s, status: marks[s.id] || null })), markedCount: Object.keys(marks).length };
}

// marks: { "<studentId>": "present" | "absent" | "late" | "leave" | "" }  ("" removes the mark). Students not listed are left alone.
function markAttendance(user, classId, date, marks) {
  core.ownClass(user, classId);
  if (!isDate(date)) throw new HttpError(400, 'Date must look like 2026-10-12.');
  const today = x.todayIst();
  if (date > today) throw new HttpError(400, 'You cannot mark attendance for a day that has not happened yet.');
  if (date < x.addDays(today, -120)) throw new HttpError(400, 'That date is too old to change.');
  if (!marks || typeof marks !== 'object' || Array.isArray(marks)) throw new HttpError(400, 'Nothing to save.');
  const entries = Object.entries(marks);
  if (!entries.length || entries.length > 300) throw new HttpError(400, 'Mark between 1 and 300 students at a time.');
  const ids = new Set(db.all('SELECT id FROM students WHERE class_id = ?', [classId]).map((r) => r.id));
  for (const [sid, status] of entries) {      // check everything first so a bad row saves nothing
    if (!ids.has(Number(sid))) throw new HttpError(400, 'One of those students is not in this class.');
    if (status !== '' && status !== null && !STATUSES.includes(status)) throw new HttpError(400, 'Attendance must be present, absent, late or leave.');
  }
  let saved = 0;
  for (const [sid, status] of entries) {
    if (status === '' || status === null) db.run('DELETE FROM attendance WHERE student_id = ? AND day = ?', [Number(sid), date]);
    else db.run('INSERT INTO attendance (class_id, student_id, day, status) VALUES (?,?,?,?) ON CONFLICT(student_id, day) DO UPDATE SET status = excluded.status, class_id = excluded.class_id', [classId, Number(sid), date, status]);
    saved++;
  }
  if (date === today) {   // a parent hears about an absence the same day, once
    for (const [sid, status] of entries) if (status === 'absent') {
      notify.notifyStudent(Number(sid), { type: 'absent_today', key: 'absent:' + sid + ':' + date, title: 'Marked absent today',
        body: 'Your child was marked absent today (' + date + '). If this is a mistake, please message the teacher.', link: '#/s/attendance', hi: require('./hindi').absentToday(date) });
    }
  }
  try { require('./alerts').afterChange(entries.filter(([, st]) => st !== '' && st !== null).map(([sid]) => Number(sid))); } catch (e) { console.error('[alerts]', e.message); }   // streak / attendance alerts right away
  return { saved, ...attendanceDay(user, classId, date) };
}

function attendanceSummary(user, classId) {
  core.ownClass(user, classId);
  const students = db.all('SELECT id, name, roll FROM students WHERE class_id = ? ORDER BY id', [classId]);
  const rows = students.map((s) => ({ id: s.id, name: s.name, roll: s.roll, ...attendanceFor(s.id) })).map(({ recent, ...r }) => r);
  const days = db.get('SELECT COUNT(DISTINCT day) AS n FROM attendance WHERE class_id = ?', [classId]).n;
  return { threshold: LOW_ATTENDANCE, classDays: days, students: rows, lowCount: rows.filter((r) => r.low).length };
}

function attendanceCsv(user, classId) {
  const s = attendanceSummary(user, classId);
  const rows = [['Student', 'Roll', 'Present', 'Late', 'Absent', 'Leave', 'Days marked', 'Attendance %', 'Below ' + LOW_ATTENDANCE + '%']];
  s.students.forEach((r) => rows.push([r.name, r.roll, r.present, r.late, r.absent, r.leave, r.markedDays, r.pct == null ? '' : r.pct, r.low ? 'yes' : '']));
  return { filename: 'attendance-class-' + classId + '.csv', text: x.toCsv(rows) };
}

// ================= NOTICES =================
function postNotice(user, classId, { title, body, kind, studentId }) {
  core.ownClass(user, classId);
  const k = kind || 'notice';
  if (!KINDS.includes(k)) throw new HttpError(400, 'Type must be notice, praise or concern.');
  const t = clip(title, 80), b = String(body || '').replace(/\r/g, '').trim().slice(0, 600);
  if (t.length < 3) throw new HttpError(400, 'Give it a short title (at least 3 letters).');
  if (!b) throw new HttpError(400, 'Write the message.');
  let sid = null;
  if (studentId !== undefined && studentId !== null && studentId !== '') {
    const st = core.ownStudent(user, Number(studentId));
    if (st.class_id !== classId) throw new HttpError(400, 'That student is not in this class.');
    sid = st.id;
  }
  const id = Number(db.run('INSERT INTO notices (class_id, student_id, author_id, kind, title, body) VALUES (?,?,?,?,?,?)', [classId, sid, user.id, k, t, b]).lastInsertRowid);
  const ev = { type: 'notice_posted', key: 'notice:' + id, title: (k === 'praise' ? 'Good news: ' : 'Notice: ') + t, body: b.slice(0, 120), link: '#/s/notices', hi: require('./hindi').notice(k === 'praise', t, b.slice(0, 120)) };
  const sent = sid ? notify.notifyStudent(sid, ev) : notify.notifyClass(classId, ev);
  return { id, notified: sent, notifiedText: notify.sentText(sent) };
}

function listNotices(user, classId) {
  core.ownClass(user, classId);
  const receipts = require('./features').noticeReceipts(classId);   // "Seen by 24 of 31 parents": counts only, no names
  return db.all(`SELECT n.*, s.name AS student_name, u.name AS author_name FROM notices n
    LEFT JOIN students s ON s.id = n.student_id LEFT JOIN users u ON u.id = n.author_id
    WHERE n.class_id = ? ORDER BY n.id DESC LIMIT 100`, [classId]).map((n) => ({
    id: n.id, kind: n.kind, title: n.title, body: n.body, studentId: n.student_id, studentName: n.student_name || null,
    authorName: n.author_name || '', fromParent: n.kind === 'from_parent', when: x.istDate(n.created_at), receipt: receipts[n.id] || null }));
}

function deleteNotice(user, id) {
  const n = must(db.get('SELECT * FROM notices WHERE id = ?', [id]), 'Notice not found.');
  core.ownClass(user, n.class_id);
  db.run('DELETE FROM notices WHERE id = ?', [id]);
  return { ok: true };
}

// What one student (or that student's parent) may read: class-wide notices plus notes about that student.
// A message a parent wrote is shown only to that parent and the teacher, never to the student or other parents.
function noticesFor(classId, studentId, parentUserId = null) {
  const seen = parentUserId === null ? new Set() : require('./features').seenByMe(parentUserId);
  return db.all(`SELECT n.*, u.name AS author_name FROM notices n LEFT JOIN users u ON u.id = n.author_id
    WHERE n.class_id = ? AND (n.student_id IS NULL OR n.student_id = ?) ORDER BY n.id DESC LIMIT 60`, [classId, studentId])
    .filter((n) => n.kind !== 'from_parent' || (parentUserId !== null && n.author_id === parentUserId))
    .map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, personal: n.student_id !== null && n.kind !== 'from_parent',
      mine: n.kind === 'from_parent', seen: seen.has(n.id), from: n.kind === 'from_parent' ? 'You' : n.author_name || 'Teacher', when: x.istDate(n.created_at) }));
}

// ================= STUDENT VIEW of these features =================
function studentRow(user) {
  if (!user.student_id) throw new HttpError(403, 'No student record for this login.');
  return must(db.get('SELECT * FROM students WHERE id = ?', [user.student_id]));
}
const studentNotices = (user) => { const st = studentRow(user); return noticesFor(st.class_id, st.id, null); };
const studentAttendance = (user) => attendanceFor(studentRow(user).id);

// ================= PARENT PORTAL =================
function linkedChild(user, studentId) {
  must(db.get('SELECT 1 FROM parent_links WHERE user_id = ? AND student_id = ?', [user.id, studentId]), 'Child not found.');   // 404, so a parent cannot tell which other students exist
  return must(db.get('SELECT s.*, c.name AS class_name FROM students s JOIN classes c ON c.id = s.class_id WHERE s.id = ?', [studentId]), 'Child not found.');
}

function homeworkFor(st) {
  const today = x.todayIst();
  return db.all("SELECT * FROM assessments WHERE class_id = ? AND kind = 'homework' ORDER BY id DESC LIMIT 30", [st.class_id]).map((a) => {
    const sub = db.get('SELECT status, result_json FROM submissions WHERE assessment_id = ? AND student_id = ?', [a.id, st.id]);
    const res = sub && sub.status === 'final' ? J(sub.result_json) : null;
    return { title: a.title, due: a.due, done: Boolean(res), marks: res ? res.marks : null, total: J(a.questions_json).length, overdue: Boolean(a.due && a.due < today && !res) };
  });
}

function childSummary(user, studentId) {
  const st = linkedChild(user, studentId);
  const att = attendanceFor(st.id), home = core.studentHomeById(st.id), latest = home.results[0] || null;
  const overdue = homeworkFor(st).filter((h) => h.overdue).length;
  return { id: st.id, name: st.name, roll: st.roll, className: st.class_name,
    attendancePct: att.pct, attendanceLow: att.low,
    latestTest: latest ? { title: latest.title, marks: latest.marks, total: latest.total, problem: latest.problem.kind } : null,
    overdueHomework: overdue,
    needsAttention: att.low || overdue > 0 || Boolean(latest && latest.problem.kind === 'likely') };
}
const children = (user) => db.all('SELECT student_id FROM parent_links WHERE user_id = ? ORDER BY id', [user.id]).map((r) => childSummary(user, r.student_id));

const HOME_TIPS = [
  'Ask your child to explain, step by step, how they got one answer. Saying it out loud often shows where the idea went wrong.',
  'Ten to fifteen minutes of practice every day works better than one long session before a test.',
  'Praise the effort and the corrections, not only the marks.',
  'If a repeated mistake is named above, show the teacher this page and ask what to try next. It is a likely pattern, not a final verdict.',
];

function childReport(user, studentId) {
  const st = linkedChild(user, studentId);
  const today = x.todayIst();
  const home = core.studentHomeById(st.id);
  const tests = home.results.map((r) => ({
    title: r.title, marks: r.marks, total: r.total, problem: r.problem.kind, wrongCount: r.problem.wrongCount,
    patterns: r.likely.map((p) => ({ name: p.name, explanation: p.explanation })),
    suspected: r.suspected.map((p) => p.name), needsReview: r.reviewCount }));
  const quizzes = db.all(`SELECT a.score, a.total, a.answers_json, a.created_at, q.title, q.mode, q.questions_json FROM quiz_attempts a
    JOIN quizzes q ON q.id = a.quiz_id WHERE a.student_id = ? AND q.student_id IS NULL ORDER BY a.id DESC LIMIT 15`, [st.id]).map((r) => {
    const qs = J(r.questions_json) || [];
    const d = qs.some((q) => q.type === 'mcq') ? concept.diagnose(qs, J(r.answers_json) || {}) : null;
    return { title: r.title, score: r.score, total: r.total, paper: r.mode === 'paper', when: x.istDate(r.created_at),
      problem: d ? d.kind : null, ideas: d ? d.tags.map((t) => ({ name: t.name, level: t.level })) : [] };
  });
  const homework = homeworkFor(st);
  const att = attendanceFor(st.id);
  const acts = x.activityOf(st.id), streak = x.streakOf(acts), days = new Set(acts.map((a) => x.istDate(a.t)));
  let last7 = 0; for (let i = 0; i < 7; i++) if (days.has(x.addDays(today, -i))) last7++;
  const badges = x.badgesOf(st.id, acts, streak).filter((b) => b.earned).map((b) => b.name);
  const practice = home.practice;

  const highlights = [];
  const latest = tests[0];
  if (latest) {
    let text = `Latest test "${latest.title}": ${latest.marks} out of ${latest.total}.`;
    if (latest.problem === 'likely' && latest.patterns[0]) text += ` The same mistake showed up in 2 or more questions: ${latest.patterns[0].name}. This is a likely pattern, not proof.`;
    else if (latest.problem === 'suspected') text += ' One question hints at a repeated mistake. The teacher will confirm it.';
    highlights.push({ level: latest.problem === 'likely' ? 'watch' : 'ok', text });
  }
  if (att.pct !== null) highlights.push({ level: att.low ? 'watch' : 'ok', text: `Attendance is ${att.pct}%` + (att.low ? `, below the ${LOW_ATTENDANCE}% mark.` : '.') });
  const overdue = homework.filter((h) => h.overdue).length;
  if (overdue) highlights.push({ level: 'watch', text: `${overdue} homework task${overdue === 1 ? ' is' : 's are'} past the due date and not handed in.` });
  else if (homework.length) highlights.push({ level: 'ok', text: 'Homework is up to date.' });
  if (!highlights.length) highlights.push({ level: 'ok', text: 'Nothing to show yet. Results appear here after the teacher checks a test.' });

  return {
    student: { id: st.id, name: st.name, roll: st.roll, className: st.class_name },
    highlights, tests, quizzes, homework, attendance: att,
    practice: { sets: practice.length, done: practice.filter((p) => p.done).length },
    effort: { streak: streak.current, activeDaysLast7: last7, badges },
    notices: noticesFor(st.class_id, st.id, user.id),
    tips: HOME_TIPS,
    privacy: 'You see your own child only. Private interview practice is never shown to parents.',
  };
}

function sendMessage(user, studentId, body) {
  const st = linkedChild(user, studentId);
  const b = String(body || '').replace(/\r/g, '').trim().slice(0, 500);
  if (b.length < 3) throw new HttpError(400, 'Write your message to the teacher.');
  const today = x.todayIst();
  const sentToday = db.all("SELECT created_at FROM notices WHERE author_id = ? AND kind = 'from_parent'", [user.id]).filter((r) => x.istDate(r.created_at) === today).length;
  if (sentToday >= MAX_PARENT_MESSAGES_PER_DAY) throw new HttpError(429, `You can send ${MAX_PARENT_MESSAGES_PER_DAY} messages a day. Please try again tomorrow.`);
  const id = Number(db.run('INSERT INTO notices (class_id, student_id, author_id, kind, title, body) VALUES (?,?,?,?,?,?)', [st.class_id, st.id, user.id, 'from_parent', 'Message from parent', b]).lastInsertRowid);
  notify.notifyTeacher(st.class_id, st.id, { type: 'message_from_parent', key: 'pmsg:' + id, title: 'Message from a parent about ' + st.name, body: 'Open Notices to read and reply.', link: '#/t/c/' + st.class_id + '/notices', hi: require('./hindi').parentMessage(st.name) });
  return { id };
}

module.exports = { LOW_ATTENDANCE, MAX_PARENT_MESSAGES_PER_DAY, listParents, addParent, resetParentPassword, unlinkParent,
  attendanceFor, attendanceDay, markAttendance, attendanceSummary, attendanceCsv,
  postNotice, listNotices, deleteNotice, noticesFor, studentNotices, studentAttendance,
  children, childReport, sendMessage, linkedChild };
