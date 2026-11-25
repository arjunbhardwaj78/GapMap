// Milestone 12 step 6: extra parent/teacher features.
//  1. leave requests (parent asks, teacher approves with one tap, approved days become "leave" in attendance)
//  2. read receipts ("Seen by 24 of 31 parents"; a parent taps "I have seen this")
//  3. weekly digest (Sunday evening, one summary per parent family, text written by code from facts)
//  4. parent-teacher meeting slots (teacher posts, a parent books one slot per child, reminder the day before)
// Same rules as the rest of GapMap: a parent sees only their own children (404 otherwise), numbers come from code, never from AI.
const db = require('../database/db');
const core = require('./core');
const x = require('./extras');
const notify = require('./notify');
const { HttpError } = require('./auth');
const { must } = core;
const hindi = require('./hindi');

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const isDate = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))) return false;
  const ms = Date.parse(d + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === d;
};
const dow = (ymd) => new Date(Date.parse(ymd + 'T00:00:00Z')).getUTCDay();   // 0 = Sunday
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const istHour = () => new Date(Date.now() + 19800000).getUTCHours();
const nowHm = () => new Date(Date.now() + 19800000).toISOString().slice(11, 16);

// 404 (not 403) so a parent cannot tell which other children exist
function linked(user, studentId) {
  must(db.get('SELECT 1 FROM parent_links WHERE user_id = ? AND student_id = ?', [user.id, studentId]), 'Child not found.');
  return must(db.get('SELECT * FROM students WHERE id = ?', [studentId]), 'Child not found.');
}

// ================= 1. LEAVE REQUESTS =================
const MAX_PENDING = 5, MAX_SPAN = 31;
const leaveRow = (r) => ({ id: r.id, studentId: r.student_id, name: r.name || undefined, from: r.from_day, to: r.to_day,
  days: daysBetween(r.from_day, r.to_day) + 1, reason: r.reason, status: r.status, asked: x.istDate(r.created_at) });

function requestLeave(user, studentId, { from, to, reason } = {}) {
  const st = linked(user, studentId);
  const today = x.todayIst();
  const f = String(from || '').trim(), t = String(to || from || '').trim();
  if (!isDate(f) || !isDate(t)) throw new HttpError(400, 'Dates must look like 2026-10-12.');
  if (t < f) throw new HttpError(400, 'The last day cannot be before the first day.');
  if (f < x.addDays(today, -7)) throw new HttpError(400, 'Leave can start at most 7 days back. Please message the teacher instead.');
  if (t > x.addDays(today, 120)) throw new HttpError(400, 'That date is too far ahead.');
  if (daysBetween(f, t) + 1 > MAX_SPAN) throw new HttpError(400, `One request can cover at most ${MAX_SPAN} days.`);
  const why = clip(reason, 200);
  if (why.length < 3) throw new HttpError(400, 'Write a short reason (at least 3 letters).');
  const open = db.all("SELECT from_day, to_day, status FROM leave_requests WHERE student_id = ? AND status IN ('pending','approved') AND to_day >= ?", [st.id, x.addDays(today, -8)]);   // requests may start 7 days back, so look that far for overlaps
  if (open.filter((r) => r.status === 'pending').length >= MAX_PENDING) throw new HttpError(429, 'Too many requests are waiting for the teacher. Please wait for an answer.');
  if (open.some((r) => !(t < r.from_day || f > r.to_day))) throw new HttpError(409, 'There is already a request for some of those days.');
  const id = Number(db.run('INSERT INTO leave_requests (class_id, student_id, parent_id, from_day, to_day, reason) VALUES (?,?,?,?,?,?)', [st.class_id, st.id, user.id, f, t, why]).lastInsertRowid);
  notify.notifyTeacher(st.class_id, st.id, { type: 'leave_request', key: 'leave:' + id, title: 'Leave request for ' + st.name,
    body: f === t ? f : f + ' to ' + t, link: '#/t/c/' + st.class_id + '/leave', hi: hindi.leaveRequest(st.name, f, t) });
  return { id, status: 'pending' };
}

function myLeaves(user, studentId) {
  const st = linked(user, studentId);
  return db.all('SELECT * FROM leave_requests WHERE student_id = ? AND parent_id IN (SELECT user_id FROM parent_links WHERE student_id = ?) ORDER BY id DESC LIMIT 30', [st.id, st.id]).map(leaveRow);
}

function cancelLeave(user, studentId, id) {
  linked(user, studentId);
  const r = must(db.get('SELECT * FROM leave_requests WHERE id = ? AND student_id = ?', [id, studentId]), 'Request not found.');
  if (r.status !== 'pending') throw new HttpError(409, 'Only a request that is still waiting can be taken back. Please message the teacher.');
  db.run("UPDATE leave_requests SET status = 'cancelled', decided_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
  return { id, status: 'cancelled' };
}

function classLeaves(user, classId, status) {
  core.ownClass(user, classId);
  const want = ['pending', 'approved', 'rejected', 'cancelled'].includes(status) ? status : null;
  const rows = db.all(`SELECT l.*, s.name FROM leave_requests l JOIN students s ON s.id = l.student_id WHERE l.class_id = ? ${want ? 'AND l.status = ?' : ''} ORDER BY (l.status = 'pending') DESC, l.id DESC LIMIT 100`, want ? [classId, want] : [classId]);
  return { pending: db.get("SELECT COUNT(*) AS n FROM leave_requests WHERE class_id = ? AND status = 'pending'", [classId]).n, items: rows.map(leaveRow) };
}

// Approved leave: days up to today become "leave" (an absent mark is turned into leave on purpose; present/late are left alone).
// fillOnly = only days with no mark (used by the scheduler, so it never undoes a teacher's later change).
function applyLeave(r, today, fillOnly) {
  let marked = 0;
  const last = r.to_day < today ? r.to_day : today;
  for (let d = r.from_day; d <= last; d = x.addDays(d, 1)) {
    if (dow(d) === 0) continue;                      // Sunday: no school mark
    const have = db.get('SELECT status FROM attendance WHERE student_id = ? AND day = ?', [r.student_id, d]);
    if (have && (fillOnly || have.status !== 'absent')) continue;
    db.run('INSERT INTO attendance (class_id, student_id, day, status) VALUES (?,?,?,?) ON CONFLICT(student_id, day) DO UPDATE SET status = excluded.status', [r.class_id, r.student_id, d, 'leave']);
    marked++;
  }
  if (marked) try { require('./alerts').afterChange([r.student_id]); } catch (e) { console.error('[alerts]', e.message); }
  return marked;
}

function decideLeave(user, id, decision) {
  const r = must(db.get('SELECT l.*, s.name FROM leave_requests l JOIN students s ON s.id = l.student_id WHERE l.id = ?', [id]), 'Request not found.');
  core.ownClass(user, r.class_id);
  if (!['approve', 'reject'].includes(decision)) throw new HttpError(400, 'Choose approve or reject.');
  if (r.status !== 'pending') throw new HttpError(409, 'This request was already answered or taken back.');
  const ok = decision === 'approve';
  db.run('UPDATE leave_requests SET status = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?', [ok ? 'approved' : 'rejected', id]);
  const marked = ok ? applyLeave(r, x.todayIst(), false) : 0;
  const span = r.from_day === r.to_day ? r.from_day : r.from_day + ' to ' + r.to_day;
  const sent = notify.notifyStudent(r.student_id, { type: 'leave_decision', key: 'leave_dec:' + id, title: ok ? 'Leave approved' : 'Leave not approved',
    body: `${r.name}: ${span}.`, parentBody: ok ? `Leave for ${r.name} (${span}) was approved. These days will not count against attendance.` : `Leave for ${r.name} (${span}) was not approved. Please message the teacher if you have questions.`,
    studentBody: ok ? `Your leave (${span}) was approved.` : `Your leave (${span}) was not approved.`, link: '#/s/attendance', parentLink: '#/p/c/' + r.student_id, hi: hindi.leaveDecision(ok, r.name, r.from_day, r.to_day) });
  return { id, status: ok ? 'approved' : 'rejected', marked, notified: sent, notifiedText: notify.sentText(sent) };
}

// scheduler: approved leave covers today (or the last 3 days after a gap) -> fill empty days
function applyApprovedLeaves(today) {
  let marked = 0;
  for (const r of db.all("SELECT * FROM leave_requests WHERE status = 'approved' AND from_day <= ? AND to_day >= ?", [today, x.addDays(today, -3)])) {
    marked += applyLeave({ ...r, from_day: r.from_day < x.addDays(today, -3) ? x.addDays(today, -3) : r.from_day }, today, true);
  }
  return marked;
}

// ================= 2. READ RECEIPTS =================
// A parent can see a notice if it is for the whole class, or about their own child. A parent's own message is never shown to others.
function markNoticeSeen(user, noticeId) {
  const n = must(db.get('SELECT * FROM notices WHERE id = ?', [noticeId]), 'Notice not found.');
  const mine = db.all('SELECT pl.student_id, s.class_id FROM parent_links pl JOIN students s ON s.id = pl.student_id WHERE pl.user_id = ?', [user.id]);
  const visible = n.kind !== 'from_parent' && mine.some((m) => m.class_id === n.class_id && (n.student_id === null || n.student_id === m.student_id));
  if (!visible) throw new HttpError(404, 'Notice not found.');
  db.run('INSERT OR IGNORE INTO notice_seen (notice_id, user_id) VALUES (?,?)', [n.id, user.id]);
  return { seen: true };
}
const seenByMe = (userId) => new Set(db.all('SELECT notice_id FROM notice_seen WHERE user_id = ?', [userId]).map((r) => r.notice_id));

// teacher: { noticeId: { seen, of } } for one class. Counts only, no names.
function noticeReceipts(classId) {
  const out = {};
  for (const n of db.all("SELECT id, student_id FROM notices WHERE class_id = ? AND kind != 'from_parent'", [classId])) {
    const who = db.all(`SELECT DISTINCT pl.user_id FROM parent_links pl JOIN students s ON s.id = pl.student_id WHERE s.class_id = ? ${n.student_id ? 'AND s.id = ?' : ''}`, n.student_id ? [classId, n.student_id] : [classId]).map((r) => r.user_id);
    const seen = new Set(db.all('SELECT user_id FROM notice_seen WHERE notice_id = ?', [n.id]).map((r) => r.user_id));
    out[n.id] = { seen: who.filter((u) => seen.has(u)).length, of: who.length };
  }
  return out;
}

// alerts: a parent "has seen" an alert when the parent opened the bell message (read_at is set)
function alertReceipt(alertId) {
  const rows = db.all(`SELECT DISTINCT n.user_id, n.read_at FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.event_key = ? AND u.role = 'parent'`, ['alert:' + alertId]);
  return { seen: rows.filter((r) => r.read_at).length, of: rows.length };
}

// ================= 3. WEEKLY DIGEST =================
function digestFor(studentId, today) {
  const st = must(db.get('SELECT * FROM students WHERE id = ?', [studentId]));
  const from = x.addDays(today, -6);
  const lines = [];
  const att = { present: 0, late: 0, absent: 0, leave: 0 };
  db.all('SELECT status FROM attendance WHERE student_id = ? AND day >= ? AND day <= ?', [st.id, from, today]).forEach((r) => { att[r.status]++; });
  const marked = att.present + att.late + att.absent + att.leave;
  lines.push(marked ? `Attendance: ${att.present} present, ${att.late} late, ${att.absent} absent${att.leave ? ', ' + att.leave + ' on leave' : ''}.` : 'Attendance was not marked this week.');
  const tests = db.all("SELECT id, created_at FROM assessments WHERE class_id = ? AND kind = 'test'", [st.class_id]).filter((a) => { const d = x.istDate(a.created_at); return d >= from && d <= today; });
  const done = tests.filter((a) => db.get('SELECT 1 FROM submissions WHERE assessment_id = ? AND student_id = ?', [a.id, st.id])).length;
  lines.push(tests.length ? `Tests this week: ${done} of ${tests.length} handed in.` : 'No tests this week.');
  const hw = db.all("SELECT id, title, due FROM assessments WHERE class_id = ? AND kind = 'homework' AND due IS NOT NULL ORDER BY due", [st.class_id]);
  const sent = (a) => Boolean(db.get('SELECT 1 FROM submissions WHERE assessment_id = ? AND student_id = ?', [a.id, st.id]));
  const next = hw.filter((a) => a.due > today && a.due <= x.addDays(today, 7) && !sent(a));
  lines.push(next.length ? `Homework due next week: ${next.slice(0, 3).map((a) => `${clip(a.title, 30)} (${a.due.slice(5)})`).join(', ')}${next.length > 3 ? ` and ${next.length - 3} more` : ''}.` : 'No homework is due next week.');
  const thisWeek = hw.filter((a) => a.due >= from && a.due <= today);
  let good = '', goodKind = '';
  if (att.present + att.late + att.absent >= 3 && !att.absent && !att.late) { good = 'Good news: no school days missed this week.'; goodKind = 'days'; }
  else if (thisWeek.length && thisWeek.every(sent)) { good = 'Good news: all homework due this week was handed in.'; goodKind = 'homework'; }
  if (good) lines.push(good);
  const hiData = { marked, att, tests: tests.length, done, next: next.slice(0, 3).map((a) => `${clip(a.title, 30)} (${a.due.slice(5)})`), more: next.length > 3 ? next.length - 3 : 0, good: goodKind };
  return { name: st.name, text: lines.join(' '), positive: Boolean(good), hi: hindi.digest(st.name, hiData) };
}

// Sunday evening (India time), once per week per family: the key holds the Sunday date, so a second run changes nothing.
function runDigest({ today, hour } = {}) {
  const day = today || x.todayIst();
  const h = hour == null ? istHour() : hour;
  if (dow(day) !== 0 || h < 17) return { sent: 0, children: 0, skipped: 'The digest goes out on Sunday evening.' };
  let sent = 0, children = 0;
  const parents = new Set();
  for (const s of db.all('SELECT DISTINCT student_id FROM parent_links ORDER BY student_id')) {
    try {
      const d = digestFor(s.student_id, day);
      const r = notify.notifyStudentInternal(s.student_id, { type: 'weekly_digest', key: 'digest:' + day, only: 'parent', title: 'This week: ' + d.name,
        body: d.text, parentBody: d.text, parentLink: '#/p/c/' + s.student_id, hi: d.hi });
      if (r._ids.parent.size) children++;
      r._ids.parent.forEach((u) => parents.add(u));
    } catch (e) { console.error('[digest]', e.message); }
  }
  sent = parents.size;
  return { sent, children };
}

// ================= 4. MEETING SLOTS =================
const slotRow = (r) => ({ id: r.id, day: r.day, time: r.start_time, minutes: r.minutes, note: r.note, booked: r.student_id !== null });
const timeOk = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || ''));
const isPast = (s, today) => s.day < today || (s.day === today && s.start_time <= nowHm());

function postSlots(user, classId, { day, times, minutes, note } = {}) {
  core.ownClass(user, classId);
  const today = x.todayIst();
  if (!isDate(day)) throw new HttpError(400, 'Date must look like 2026-10-20.');
  if (day < today) throw new HttpError(400, 'Choose today or a later day.');
  if (day > x.addDays(today, 90)) throw new HttpError(400, 'That date is too far ahead.');
  if (!Array.isArray(times) || !times.length || times.length > 20) throw new HttpError(400, 'Add 1 to 20 start times such as 16:00.');
  if (times.some((t) => !timeOk(t))) throw new HttpError(400, 'Times must look like 16:30.');
  const uniq = [...new Set(times)];
  const len = minutes === undefined || minutes === '' ? 10 : Number(minutes);
  if (!Number.isInteger(len) || len < 5 || len > 60) throw new HttpError(400, 'A slot is 5 to 60 minutes long.');
  if (uniq.some((t) => db.get('SELECT 1 FROM meeting_slots WHERE class_id = ? AND day = ? AND start_time = ?', [classId, day, t]))) throw new HttpError(409, 'One of those times already exists on that day.');
  uniq.forEach((t) => db.run('INSERT INTO meeting_slots (class_id, day, start_time, minutes, note) VALUES (?,?,?,?,?)', [classId, day, t, len, clip(note, 100)]));
  const sent = notify.notifyClass(classId, { type: 'notice_posted', key: 'slots:' + classId + ':' + day, only: 'parent', title: 'Meeting times open',
    body: `The teacher posted meeting times for ${day}. Open your child's page to book one.`, parentLink: '#/p/c/', hi: hindi.meetingOpen(day) }, null);
  return { added: uniq.length, notified: sent };
}

function listSlots(user, classId) {
  core.ownClass(user, classId);
  const today = x.todayIst();
  return db.all(`SELECT m.*, s.name AS child, u.name AS parent FROM meeting_slots m LEFT JOIN students s ON s.id = m.student_id LEFT JOIN users u ON u.id = m.booked_by
    WHERE m.class_id = ? AND m.day >= ? ORDER BY m.day, m.start_time LIMIT 200`, [classId, x.addDays(today, -1)]).map((r) => ({ ...slotRow(r), child: r.child || null, parent: r.parent || null, studentId: r.student_id }));
}

function removeSlot(user, id) {
  const m = must(db.get('SELECT * FROM meeting_slots WHERE id = ?', [id]), 'Slot not found.');
  core.ownClass(user, m.class_id);
  let sent = null;
  if (m.student_id) sent = notify.notifyStudentInternal(m.student_id, { type: 'meeting_cancelled', key: 'meet_cancel:' + m.id + ':' + Date.now(), only: 'parent', title: 'Meeting cancelled',
    body: `The teacher cancelled the meeting on ${m.day} at ${m.start_time}. Please book another time.`, parentBody: `The teacher cancelled the meeting on ${m.day} at ${m.start_time}. Please book another time.`, hi: hindi.meetingCancelled(m.day, m.start_time) });
  db.run('DELETE FROM meeting_slots WHERE id = ?', [id]);
  return { ok: true, parentsTold: sent ? sent.parents : 0 };
}

function slotsForParent(user, studentId) {
  const st = linked(user, studentId);
  const today = x.todayIst();
  const mine = db.get('SELECT * FROM meeting_slots WHERE class_id = ? AND student_id = ? AND day >= ? ORDER BY day, start_time', [st.class_id, st.id, today]);
  const open = db.all('SELECT * FROM meeting_slots WHERE class_id = ? AND student_id IS NULL AND day >= ? ORDER BY day, start_time LIMIT 100', [st.class_id, today]).filter((s) => !isPast(s, today));
  return { booked: mine ? slotRow(mine) : null, open: mine ? [] : open.map(slotRow) };       // no names of other families, ever
}

function bookSlot(user, studentId, slotId) {
  const st = linked(user, studentId);
  const today = x.todayIst();
  const m = must(db.get('SELECT * FROM meeting_slots WHERE id = ? AND class_id = ?', [slotId, st.class_id]), 'Slot not found.');
  if (isPast(m, today)) throw new HttpError(400, 'That time has already passed.');
  if (db.get('SELECT 1 FROM meeting_slots WHERE class_id = ? AND student_id = ? AND day >= ?', [st.class_id, st.id, today])) throw new HttpError(409, 'This child already has a meeting booked. Cancel it first to choose another time.');
  const r = db.run('UPDATE meeting_slots SET student_id = ?, booked_by = ? WHERE id = ? AND student_id IS NULL', [st.id, user.id, m.id]);
  if (!r.changes) throw new HttpError(409, 'Someone just took that time. Please choose another.');
  const when = `${m.day} at ${m.start_time}`;
  notify.notifyStudentInternal(st.id, { type: 'meeting_booked', key: 'meet_book:' + m.id + ':' + st.id, only: 'parent', title: 'Meeting booked', body: `Meeting with the teacher about ${st.name}: ${when}.`,
    parentBody: `Meeting with the teacher about ${st.name}: ${when} (${m.minutes} minutes). You will get a reminder the day before.`, parentLink: '#/p/c/' + st.id, hi: hindi.meetingBooked(st.name, when, m.minutes) });
  notify.notifyTeacher(st.class_id, st.id, { type: 'meeting_booked', key: 'meet_book_t:' + m.id + ':' + st.id, title: 'Meeting booked', body: `${st.name}'s family booked ${when}.`, link: '#/t/c/' + st.class_id + '/meetings', hi: hindi.meetingBookedTeacher(st.name, when) });
  return { booked: slotRow({ ...m, student_id: st.id }) };
}

function cancelBooking(user, studentId, slotId) {
  const st = linked(user, studentId);
  const m = must(db.get('SELECT * FROM meeting_slots WHERE id = ? AND student_id = ?', [slotId, st.id]), 'Booking not found.');
  db.run('UPDATE meeting_slots SET student_id = NULL, booked_by = NULL WHERE id = ?', [m.id]);
  notify.notifyTeacher(st.class_id, st.id, { type: 'meeting_cancelled', key: 'meet_cancel_t:' + m.id + ':' + Date.now(), title: 'Meeting cancelled', body: `${st.name}'s family cancelled ${m.day} at ${m.start_time}. The time is free again.`, link: '#/t/c/' + st.class_id + '/meetings', hi: hindi.meetingCancelledTeacher(st.name, m.day, m.start_time) });
  return { ok: true };
}

// scheduler: the day before a booked meeting (parent and teacher, once each)
function runMeetingReminders({ today } = {}) {
  const day = today || x.todayIst();
  let sent = 0;
  for (const m of db.all('SELECT * FROM meeting_slots WHERE day = ? AND student_id IS NOT NULL', [x.addDays(day, 1)])) {
    const st = db.get('SELECT * FROM students WHERE id = ?', [m.student_id]);
    if (!st) continue;
    const body = `Reminder: meeting about ${st.name} tomorrow (${m.day}) at ${m.start_time}.`;
    const r = notify.notifyStudentInternal(st.id, { type: 'meeting_reminder', key: 'meet_rem:' + m.id, only: 'parent', title: 'Meeting tomorrow', body, parentBody: body, parentLink: '#/p/c/' + st.id, hi: hindi.meetingReminder(st.name, m.day, m.start_time) });
    sent += r.parents;
    notify.notifyTeacher(m.class_id, st.id, { type: 'meeting_reminder', key: 'meet_rem_t:' + m.id, title: 'Meeting tomorrow', body: `${st.name}'s family at ${m.start_time}.`, link: '#/t/c/' + m.class_id + '/meetings', hi: hindi.meetingReminderTeacher(st.name, m.start_time) });
  }
  return { sent };
}

// ================= 5. UPCOMING LIST (homework due in the next 14 days, booked meetings for parents) =================
const UPCOMING_DAYS = 14;
function upcoming(studentId, today, withMeetings) {
  const st = must(db.get('SELECT * FROM students WHERE id = ?', [studentId]), 'Not found.');
  const end = x.addDays(today, UPCOMING_DAYS);
  const items = db.all("SELECT id, title, due FROM assessments WHERE class_id = ? AND kind = 'homework' AND due IS NOT NULL AND due >= ? AND due <= ? ORDER BY due, id", [st.class_id, today, end]).map((a) => ({
    kind: 'homework', date: a.due, time: null, title: clip(a.title, 80), done: Boolean(db.get('SELECT 1 FROM submissions WHERE assessment_id = ? AND student_id = ?', [a.id, st.id])) }));
  if (withMeetings) db.all('SELECT day, start_time, minutes FROM meeting_slots WHERE class_id = ? AND student_id = ? AND day >= ? AND day <= ?', [st.class_id, st.id, today, end])
    .forEach((m) => items.push({ kind: 'meeting', date: m.day, time: m.start_time, minutes: m.minutes, title: 'Meeting with the teacher', done: false }));
  items.sort((p, q) => (p.date + (p.time || '')).localeCompare(q.date + (q.time || '')));
  return { today, until: end, child: st.name, items };
}
function studentUpcoming(user) {
  if (!user.student_id) throw new HttpError(403, 'No student record for this login.');
  return upcoming(user.student_id, x.todayIst(), false);
}
function parentUpcoming(user, studentId) { const st = linked(user, studentId); return upcoming(st.id, x.todayIst(), true); }

// ================= 8. CSV EXPORTS (teacher, own class) =================
function alertsCsv(user, classId) {
  const l = require('./alerts').listAlerts(user, classId);
  const rows = [['Date sent', 'Student', 'Type', 'Status', 'What was sent', 'Students told', 'Parents told', 'Parents seen', 'Parents total', 'Your note']];
  l.items.forEach((a) => rows.push([a.sentOn, a.name, a.type, a.status, a.summary, a.sent.students, a.sent.parents, a.receipt.seen, a.receipt.of, a.note]));
  return { filename: 'alerts-class-' + classId + '.csv', text: x.toCsv(rows) };
}
function notificationsCsv(user, classId) {
  const log = notify.sentLog(user, classId);
  const rows = [['First sent', 'Type', 'Title', 'Students', 'Parents', 'Students read', 'Parents read']];
  log.forEach((r) => rows.push([r.firstAt, r.type, r.title, r.students, r.parents, r.studentsRead, r.parentsRead]));
  return { filename: 'notifications-class-' + classId + '.csv', text: x.toCsv(rows) };
}

module.exports = { requestLeave, myLeaves, cancelLeave, classLeaves, decideLeave, applyApprovedLeaves,
  markNoticeSeen, seenByMe, noticeReceipts, alertReceipt, digestFor, runDigest,
  postSlots, listSlots, removeSlot, slotsForParent, bookSlot, cancelBooking, runMeetingReminders,
  upcoming, studentUpcoming, parentUpcoming, alertsCsv, notificationsCsv };
