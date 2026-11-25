// Automatic notifications. The teacher does nothing extra: service functions call notifyStudent / notifyClass and every
// affected student AND every linked parent gets one row. Failures are swallowed so a teacher's action never breaks.
// Text is written by code from facts (no AI). Wording stays calm: "may", "likely", never a verdict.
const db = require('../database/db');
const channels = require('../channels');
const { HttpError } = require('./auth');

const istToday = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const LOW_TYPES = ['notice_posted', 'report_ready', 'quiz_assigned', 'test_assigned', 'homework_assigned'];   // these may be muted
const TYPES = ['quiz_assigned', 'test_assigned', 'homework_assigned', 'homework_due_soon', 'homework_overdue', 'result_ready', 'quiz_deadline_soon',
  'attendance_low', 'performance_drop', 'performance_low', 'missed_test', 'missed_quiz', 'missed_homework', 'absent_today', 'notice_posted',
  'message_from_parent', 'message_from_teacher_reply', 'report_ready', 'improvement', 'good_attendance', 'absent_streak',
  'leave_request', 'leave_decision', 'weekly_digest', 'meeting_booked', 'meeting_cancelled', 'meeting_reminder'];
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

const mutedOf = (userId) => { const r = db.get('SELECT muted_json FROM notif_prefs WHERE user_id = ?', [userId]); try { return r ? JSON.parse(r.muted_json) : []; } catch (e) { return []; } };

// student user + linked parents of one student
function recipientsOf(studentId) {
  const out = [];
  const s = db.get("SELECT id FROM users WHERE student_id = ? AND role = 'student'", [studentId]);
  if (s) out.push({ userId: s.id, role: 'student' });
  db.all('SELECT user_id FROM parent_links WHERE student_id = ? ORDER BY id', [studentId]).forEach((p) => out.push({ userId: p.user_id, role: 'parent' }));
  return out;
}

// language choice lives in contact_prefs.language ('hi' = Hindi). Only system text has a Hindi version (ev.hi); teacher-written words are never translated.
const langOf = (userId) => { const r = db.get('SELECT language FROM contact_prefs WHERE user_id = ?', [userId]); return r && r.language === 'hi' ? 'hi' : 'en'; };

function insertOne(userId, role, studentId, classId, ev, link) {
  if (ev.hi && ev.hi.title && ev.hi.body && langOf(userId) === 'hi') ev = { ...ev, title: ev.hi.title, body: ev.hi.body };
  if (LOW_TYPES.includes(ev.type) && mutedOf(userId).includes(ev.type)) return false;     // only low-priority types can be muted
  const r = db.run(`INSERT OR IGNORE INTO notifications (user_id, student_id, class_id, type, title, body, link, event_key, dedupe_key) VALUES (?,?,?,?,?,?,?,?,?)`,
    [userId, studentId, classId, ev.type, clip(ev.title, 120), clip(ev.body, 400), link || null, clip(ev.key, 150), clip(ev.key, 150) + '#' + (studentId || 0)]);
  if (!r.changes) return false;                                                           // same event already sent
  const nid = Number(r.lastInsertRowid);
  for (const ch of channels.active()) db.run('INSERT INTO outbox (notification_id, channel, to_user_id, text, status) VALUES (?,?,?,?,?)',
    [nid, ch, userId, clip(ev.title + '. ' + ev.body, 300), channels.adapters[ch].real ? 'queued' : 'dry-run']);
  return true;
}

const count = (p) => ({ students: p.student.size, parents: p.parent.size, _ids: p });
// ev: { type, title, body, key, link?, parentLink? }   returns { students, parents } actually notified (never throws)
function notifyStudent(studentId, ev) {
  const people = { student: new Set(), parent: new Set() };   // distinct people (a parent of two children counts once)
  try {
    if (!ev || !TYPES.includes(ev.type) || !ev.key) return count(people);
    const st = db.get('SELECT id, class_id FROM students WHERE id = ?', [studentId]);
    if (!st) return count(people);
    for (const r of recipientsOf(st.id)) {
      if (ev.only && r.role !== ev.only) continue;                                  // for example the weekly digest goes to parents only
      const link = r.role === 'parent' ? (ev.parentLink || '#/p/c/' + st.id) : (ev.link || '#/s');
      const text = r.role === 'parent' ? ev.parentBody : ev.studentBody;          // alerts speak to the child ("Your...") or about the child ("Asha's...")
      const hi = ev.hi ? { title: ev.hi.title, body: (r.role === 'parent' ? ev.hi.parentBody : ev.hi.studentBody) || ev.hi.body } : null;
      if (insertOne(r.userId, r.role, st.id, st.class_id, { ...ev, body: text || ev.body, hi }, link)) people[r.role].add(r.userId);
    }
  } catch (e) { console.error('[notify]', ev && ev.type, e.message); }
  return count(people);
}

// audience: optional array of student ids (a quiz for one group); null = whole class
function notifyClass(classId, ev, audience = null) {
  const people = { student: new Set(), parent: new Set() };
  try {
    const ids = db.all('SELECT id FROM students WHERE class_id = ? ORDER BY id', [classId]).map((r) => r.id).filter((i) => !audience || audience.includes(i));
    ids.forEach((i) => { const s = notifyStudent(i, ev); s._ids.student.forEach((u) => people.student.add(u)); s._ids.parent.forEach((u) => people.parent.add(u)); });
  } catch (e) { console.error('[notify]', ev && ev.type, e.message); }
  return { students: people.student.size, parents: people.parent.size };
}

// the teacher who owns the class gets a bell item too (for example when a parent writes)
function notifyTeacher(classId, studentId, ev) {
  try {
    const c = db.get('SELECT teacher_id FROM classes WHERE id = ?', [classId]);
    if (c && TYPES.includes(ev.type)) insertOne(c.teacher_id, 'teacher', studentId || null, classId, ev, ev.link);
  } catch (e) { console.error('[notify]', ev && ev.type, e.message); }
}

const word = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const sentText = (s) => `Sent to ${word(s.students, 'student', 'students')} and ${word(s.parents, 'parent', 'parents')}.`;

// ================= what each person reads (own rows only) =================
function list(user, { limit = 60 } = {}) {
  const rows = db.all(`SELECT n.*, s.name AS child FROM notifications n LEFT JOIN students s ON s.id = n.student_id
    WHERE n.user_id = ? ORDER BY n.id DESC LIMIT ?`, [user.id, Math.min(Math.max(Number(limit) || 60, 1), 200)]);
  return { unread: unreadCount(user), items: rows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link,
    child: user.role === 'parent' ? n.child || null : null, when: n.created_at, read: Boolean(n.read_at), mutable: LOW_TYPES.includes(n.type) })) };
}
const unreadCount = (user) => db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', [user.id]).n;

function markRead(user, { ids, all } = {}) {
  if (all) db.run("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL", [user.id]);
  else if (Array.isArray(ids)) ids.slice(0, 200).map(Number).filter(Number.isInteger).forEach((i) => db.run("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND read_at IS NULL", [i, user.id]));
  else throw new HttpError(400, 'Say which notifications to mark as read.');
  return { unread: unreadCount(user) };
}

function getPrefs(user) { return { muted: mutedOf(user.id), mutableTypes: LOW_TYPES, note: 'Alerts and missed-item messages cannot be muted.' }; }
function setPrefs(user, muted) {
  if (!Array.isArray(muted)) throw new HttpError(400, 'Send a list of notification types to mute.');
  if (muted.some((t) => !LOW_TYPES.includes(t))) throw new HttpError(400, 'Only low-priority types can be muted. Alerts and missed items always arrive.');
  db.run('INSERT INTO notif_prefs (user_id, muted_json) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET muted_json = excluded.muted_json', [user.id, JSON.stringify([...new Set(muted)])]);
  return getPrefs(user);
}

// Teacher: what was sent for one class and how many have read it. Counts only, no private text of a family.
function sentLog(user, classId) {
  const c = db.get('SELECT id FROM classes WHERE id = ? AND teacher_id = ?', [classId, user.id]);
  if (!c) throw new HttpError(404, 'Class not found.');
  return db.all(`SELECT n.event_key AS key, n.type, MIN(n.title) AS title, MIN(n.created_at) AS firstAt,
      COUNT(DISTINCT CASE WHEN u.role = 'student' THEN n.user_id END) AS students, COUNT(DISTINCT CASE WHEN u.role = 'parent' THEN n.user_id END) AS parents,
      COUNT(DISTINCT CASE WHEN u.role = 'student' AND n.read_at IS NOT NULL THEN n.user_id END) AS studentsRead,
      COUNT(DISTINCT CASE WHEN u.role = 'parent' AND n.read_at IS NOT NULL THEN n.user_id END) AS parentsRead
    FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.class_id = ? AND u.role != 'teacher'
    GROUP BY n.event_key, n.type ORDER BY MIN(n.id) DESC LIMIT 80`, [classId]);
}

const notifyStudentPublic = (id, ev) => { const { _ids, ...r } = notifyStudent(id, ev); return r; };
module.exports = { langOf, TYPES, LOW_TYPES, notifyStudentInternal: notifyStudent, notifyStudent: notifyStudentPublic, notifyClass, notifyTeacher, sentText, list, unreadCount, markRead, getPrefs, setPrefs, sentLog, recipientsOf, istToday };
