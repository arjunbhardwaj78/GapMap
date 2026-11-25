// Alerts. ONE evaluator is used by the event hooks (after marks/attendance are saved) and by the scheduler.
// CODE computes every number and decides every trigger. The AI is not involved at all.
// Wording is soft ("may need support"): facts and numbers, never a verdict, never another child's name.
const db = require('../database/db');
const core = require('./core');
const x = require('./extras');
const notify = require('./notify');
const { HttpError } = require('./auth');

const J = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);   // b - a

const POSITIVE = ['improvement', 'good_attendance'];
const MIN_ATTENDANCE_DAYS = 5, MIN_GOOD_MONTH_DAYS = 10, LOOKBACK_DAYS = 60, TEST_GRACE_DAYS = 3;

// ================= settings =================
function defaultYear(ymd) {
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7));
  return m >= 6 ? { start: `${y}-06-01`, end: `${y + 1}-03-31` } : { start: `${y - 1}-06-01`, end: `${y}-03-31` };
}
const defaults = () => { const y = defaultYear(x.todayIst()); return {
  floorOn: true, floorPct: 40, dropOn: true, dropN: 3, dropPts: 10, attOn: true, attPct: 75, streakOn: true, streakDays: 3,
  missedOn: true, missedTestK: 1, missedHwK: 2, positiveOn: true, yearStart: y.start, yearEnd: y.end, termSplit: '' }; };
const INTS = { floorPct: [0, 100], attPct: [0, 100], dropN: [1, 10], dropPts: [1, 100], streakDays: [2, 10], missedTestK: [1, 10], missedHwK: [1, 10] };
const BOOLS = ['floorOn', 'dropOn', 'attOn', 'streakOn', 'missedOn', 'positiveOn'];
const LABEL = { floorPct: 'Overall score line', attPct: 'Attendance line', dropN: 'Results to compare', dropPts: 'Drop in points', streakDays: 'Days absent in a row', missedTestK: 'Missed tests', missedHwK: 'Missed homework' };

// Everything is checked BEFORE anything is saved. Returns a clean full object or throws 400.
function validate(s) {
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(INTS)) {
    const v = typeof s[k] === 'string' && s[k].trim() !== '' ? Number(s[k]) : s[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new HttpError(400, `${LABEL[k]} must be a whole number from ${lo} to ${hi}.`);
    out[k] = v;
  }
  for (const k of BOOLS) { if (typeof s[k] !== 'boolean') throw new HttpError(400, `${k} must be on or off.`); out[k] = s[k]; }
  if (!isDate(s.yearStart) || !isDate(s.yearEnd)) throw new HttpError(400, 'The academic year dates must be real dates like 2026-06-01.');
  if (s.yearStart >= s.yearEnd) throw new HttpError(400, 'The academic year must end after it starts.');
  out.yearStart = s.yearStart; out.yearEnd = s.yearEnd;
  const split = s.termSplit == null ? '' : s.termSplit;
  if (split !== '' && (!isDate(split) || split < s.yearStart || split > s.yearEnd)) throw new HttpError(400, 'The term split must be a real date inside the academic year, or empty.');
  out.termSplit = split;
  return out;
}
function settingsFor(classId) {
  const row = db.get('SELECT settings_json FROM class_settings WHERE class_id = ?', [classId]);
  return { ...defaults(), ...(row ? J(row.settings_json, {}) : {}) };
}
const KNOWN = [...Object.keys(INTS), ...BOOLS, 'yearStart', 'yearEnd', 'termSplit'];
const merged = (current, patch) => { const m = { ...current }; for (const k of KNOWN) if (patch && Object.prototype.hasOwnProperty.call(patch, k)) m[k] = patch[k]; return m; };
function getSettings(user, classId) { core.ownClass(user, classId); return settingsFor(classId); }
function putSettings(user, classId, patch) {
  core.ownClass(user, classId);
  const clean = validate(merged(settingsFor(classId), patch));
  db.run('INSERT INTO class_settings (class_id, settings_json, updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(class_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = CURRENT_TIMESTAMP', [classId, JSON.stringify(clean)]);
  return clean;
}

// ================= facts (all numbers come from here) =================
const studentRow = (id) => db.get('SELECT id, name, class_id FROM students WHERE id = ?', [id]);

// Final test results and class quiz results since the year start. Homework is NOT part of this. Total 0 is ignored.
function resultsOf(studentId, settings) {
  const st = studentRow(studentId);
  if (!st) return [];
  const S = settings || settingsFor(st.class_id);
  const rows = [];
  db.all(`SELECT s.id, s.created_at, s.result_json, a.title FROM submissions s JOIN assessments a ON a.id = s.assessment_id
          WHERE s.student_id = ? AND s.status = 'final' AND COALESCE(a.kind, 'test') != 'homework' AND s.created_at >= ?`, [studentId, S.yearStart]).forEach((r) => {
    const res = J(r.result_json, null);
    if (res && Number(res.total) > 0) rows.push({ marks: Number(res.marks) || 0, total: Number(res.total), at: r.created_at, title: r.title, order: r.id });
  });
  db.all(`SELECT qa.id, qa.created_at, qa.score, qa.total, q.title FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id
          WHERE qa.student_id = ? AND q.student_id IS NULL AND q.audience_json IS NULL AND qa.created_at >= ?`, [studentId, S.yearStart]).forEach((r) => {
    if (Number(r.total) > 0) rows.push({ marks: Number(r.score) || 0, total: Number(r.total), at: r.created_at, title: r.title, order: 1e9 + r.id });
  });
  rows.forEach((r) => { r.pct = (r.marks / r.total) * 100; });
  return rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.order - b.order));
}
// total marks obtained / total marks available (NOT the average of percentages). null when there is nothing.
function overallPct(rows) {
  const ok = (rows || []).filter((r) => Number(r.total) > 0);
  const total = ok.reduce((p, r) => p + Number(r.total), 0);
  return total > 0 ? (ok.reduce((p, r) => p + Number(r.marks || 0), 0) / total) * 100 : null;
}
const mean = (a) => a.reduce((p, v) => p + v, 0) / a.length;
const r1 = (v) => Math.round(v * 10) / 10;

function countAtt(rows) {
  const c = { present: 0, late: 0, absent: 0, leave: 0 };
  rows.forEach((r) => { c[r.status]++; });
  const counted = c.present + c.late + c.absent;                     // leave is never counted against the child
  const rawPct = counted ? ((c.present + c.late) / counted) * 100 : null;
  return { ...c, counted, rawPct, pct: rawPct == null ? null : Math.round(rawPct) };
}
function attendanceFacts(studentId, { today } = {}) {
  const st = studentRow(studentId);
  if (!st) return countAtt([]);
  const S = settingsFor(st.class_id);
  const rows = db.all('SELECT day, status FROM attendance WHERE student_id = ? AND day >= ? AND day <= ? ORDER BY day', [studentId, S.yearStart, today || x.todayIst()]);
  return countAtt(rows);
}

// ================= the rules =================
const nm = (st) => st.name;
const list = (items) => items.slice(0, 5).join(', ');
function candidates(st, today, S) {
  const out = [];
  const add = (type, numbers, severity, summary, studentBody, parentBody, title) => out.push({ type, numbers, severity, summary, studentBody, parentBody, title, positive: POSITIVE.includes(type) });
  const res = resultsOf(st.id, S);

  // --- overall score below the line ---
  if (S.floorOn && res.length >= 2) {
    const ov = Math.round(overallPct(res));
    if (ov < S.floorPct) add('performance_low', { overall: ov, floor: S.floorPct, count: res.length }, 100 - ov,
      `Overall ${ov}% across ${res.length} results (line is ${S.floorPct}%).`,
      `Your overall score so far is ${ov}% across ${res.length} results. A short chat with your teacher may help.`,
      `${nm(st)}'s overall score so far is ${ov}% across ${res.length} results. A short chat with the teacher may help.`, 'Overall score may need support');
  }
  // --- drop or improvement: the last N results against the N before ---
  if (res.length >= 2 * S.dropN && (S.dropOn || S.positiveOn)) {
    const n = S.dropN, last = r1(mean(res.slice(-n).map((r) => r.pct))), before = r1(mean(res.slice(-2 * n, -n).map((r) => r.pct)));
    const drop = r1(before - last);
    if (S.dropOn && drop > S.dropPts) add('performance_drop', { last: Math.round(last), before: Math.round(before), n, drop: Math.round(drop) }, drop,
      `Average ${Math.round(before)}% to ${Math.round(last)}% over the last ${n} results.`,
      `Your average on the last ${n} results is ${Math.round(last)}%, down from ${Math.round(before)}%. A short chat with your teacher may help.`,
      `${nm(st)}'s average on the last ${n} results is ${Math.round(last)}%, down from ${Math.round(before)}%. A short chat with the teacher may help.`, 'Recent results may need support');
    else if (S.positiveOn && r1(last - before) >= S.dropPts) add('improvement', { last: Math.round(last), before: Math.round(before), n, rise: Math.round(last - before) }, last - before,
      `Average ${Math.round(before)}% up to ${Math.round(last)}% over the last ${n} results.`,
      `Your average on the last ${n} results is ${Math.round(last)}%, up from ${Math.round(before)}%. Well done.`,
      `${nm(st)}'s average on the last ${n} results is ${Math.round(last)}%, up from ${Math.round(before)}%. Good news.`, 'Good news: results are going up');
  }
  // --- attendance ---
  const att = db.all('SELECT day, status FROM attendance WHERE student_id = ? AND day >= ? AND day <= ? ORDER BY day', [st.id, S.yearStart, today]);
  if (S.attOn) {
    const f = countAtt(att);
    if (f.counted >= MIN_ATTENDANCE_DAYS && f.rawPct < S.attPct) add('attendance_low', { attendance: f.pct, floor: S.attPct, counted: f.counted, absent: f.absent }, 100 - f.rawPct,
      `Attendance ${f.pct}% over ${f.counted} marked days (line is ${S.attPct}%).`,
      `Your attendance so far is ${f.pct}% over ${f.counted} school days. Coming in regularly helps learning.`,
      `${nm(st)}'s attendance so far is ${f.pct}% over ${f.counted} school days. Please talk to the teacher if something is making it hard to attend.`, 'Attendance may need support');
  }
  if (S.streakOn && att.length) {
    const latest = att[att.length - 1];
    if (latest.day >= x.addDays(today, -3)) {
      let run = 0;
      for (let i = att.length - 1; i >= 0 && att[i].status === 'absent'; i--) run++;           // present, late or leave breaks the run
      if (run >= S.streakDays) add('absent_streak', { daysInARow: run }, run,
        `Absent ${run} marked days in a row.`,
        `You have been marked absent for ${run} school days in a row. If something is wrong, tell your teacher.`,
        `${nm(st)} has been marked absent for ${run} school days in a row. Please let the teacher know if something is wrong.`, 'Absent several days in a row');
    }
  }
  if (S.positiveOn) {                      // previous calendar month: 10+ marked days, no absence, no late
    const prevLast = x.addDays(today.slice(0, 7) + '-01', -1), month = prevLast.slice(0, 7);
    const f = countAtt(att.filter((r) => r.day.slice(0, 7) === month));
    if (f.counted >= MIN_GOOD_MONTH_DAYS && f.absent === 0 && f.late === 0) add('good_attendance', { month, days: f.counted }, 0,
      `Present every marked day in ${month}.`, `You were present on every school day in ${month}. Great work.`, `${nm(st)} was present on every school day in ${month}. Good news.`, 'Good news: full attendance last month');
  }
  // --- missed items ---
  if (S.missedOn) {
    const from = x.addDays(today, -LOOKBACK_DAYS), lateTest = x.addDays(today, -TEST_GRACE_DAYS);
    const hw = db.all(`SELECT a.id, a.title FROM assessments a WHERE a.class_id = ? AND a.kind = 'homework' AND a.due IS NOT NULL AND a.due < ? AND a.due >= ?
        AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.assessment_id = a.id AND s.student_id = ?) ORDER BY a.due`, [st.class_id, today, from, st.id]);
    if (hw.length >= S.missedHwK) add('missed_homework', { count: hw.length, items: hw.slice(0, 5).map((r) => r.title) }, hw.length,
      `${hw.length} homework past due with nothing handed in.`,
      `You have ${hw.length} homework ${hw.length === 1 ? 'item' : 'items'} past the due date with nothing handed in: ${list(hw.map((r) => r.title))}.`,
      `${nm(st)} has ${hw.length} homework ${hw.length === 1 ? 'item' : 'items'} past the due date with nothing handed in: ${list(hw.map((r) => r.title))}.`, 'Homework not handed in');
    const classSize = db.get('SELECT COUNT(*) AS n FROM students WHERE class_id = ?', [st.class_id]).n;
    const tests = db.all(`SELECT a.id, a.title, (SELECT COUNT(*) FROM submissions s WHERE s.assessment_id = a.id AND s.status = 'final') AS done FROM assessments a
        WHERE a.class_id = ? AND COALESCE(a.kind, 'test') != 'homework' AND date(a.created_at) <= ? AND date(a.created_at) >= ?
        AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.assessment_id = a.id AND s.student_id = ?) ORDER BY a.id`, [st.class_id, lateTest, from, st.id])
      .filter((t) => classSize > 0 && t.done * 2 > classSize);          // MORE than half the class must have a result, so a test nobody finished is not "missed"
    if (tests.length >= S.missedTestK) add('missed_test', { count: tests.length, items: tests.slice(0, 5).map((r) => r.title) }, tests.length,
      `${tests.length} test${tests.length === 1 ? '' : 's'} with no result.`,
      `There is no result for you yet in ${list(tests.map((r) => r.title))}. Please ask your teacher about it.`,
      `There is no result for ${nm(st)} yet in ${list(tests.map((r) => r.title))}. Please ask the teacher about it.`, 'A test has no result yet');
    const quizzes = db.all(`SELECT q.id, q.title, q.audience_json FROM quizzes q WHERE q.class_id = ? AND q.student_id IS NULL AND COALESCE(q.mode, 'online') = 'online' AND q.status = 'closed'
        AND date(q.created_at) >= ? AND NOT EXISTS (SELECT 1 FROM quiz_attempts qa WHERE qa.quiz_id = q.id AND qa.student_id = ?) ORDER BY q.id`, [st.class_id, from, st.id])
      .filter((q) => x.audienceOf(q) === null || x.audienceOf(q).includes(st.id));
    if (quizzes.length >= S.missedTestK) add('missed_quiz', { count: quizzes.length, items: quizzes.slice(0, 5).map((r) => r.title) }, quizzes.length,
      `${quizzes.length} closed quiz${quizzes.length === 1 ? '' : 'zes'} not attempted.`,
      `A quiz closed before you took it: ${list(quizzes.map((r) => r.title))}. Ask your teacher if you can still do it.`,
      `A quiz closed before ${nm(st)} took it: ${list(quizzes.map((r) => r.title))}. Please ask the teacher about it.`, 'A quiz was missed');
  }
  return out;
}

// ================= cooldown =================
const MARGIN = { performance_low: 5, performance_drop: 5, attendance_low: 5, absent_streak: 2, missed_homework: 2, missed_test: 2, missed_quiz: 2 };
const COOLDOWN = (type) => (type === 'good_attendance' ? 25 : POSITIVE.includes(type) ? 21 : 7);
function cooldownReason(studentId, c, today) {
  const last = db.get('SELECT sent_on, severity FROM alert_log WHERE student_id = ? AND type = ? ORDER BY id DESC LIMIT 1', [studentId, c.type]);
  if (!last) return null;
  const since = daysBetween(last.sent_on, today);                        // a date before the last send counts as "too soon"
  if (since >= COOLDOWN(c.type)) return null;
  if (!c.positive && c.severity - last.severity >= (MARGIN[c.type] || 5)) return null;     // clearly worse: send again
  return `already sent on ${last.sent_on}`;
}

// ================= evaluate =================
function fire(st, c, today) {
  const logId = Number(db.run('INSERT INTO alert_log (class_id, student_id, type, numbers_json, severity, text, status, sent_on) VALUES (?,?,?,?,?,?,?,?)',
    [st.class_id, st.id, c.type, JSON.stringify(c.numbers), c.severity, clip(c.summary, 300), 'new', today]).lastInsertRowid);
  const sent = notify.notifyStudent(st.id, { type: c.type, key: 'alert:' + logId, title: c.title, studentBody: c.studentBody, parentBody: c.parentBody, body: c.studentBody, hi: require('./hindi').alert(c.type, c.numbers, st.name) });
  db.run('UPDATE alert_log SET sent_students = ?, sent_parents = ? WHERE id = ?', [sent.students, sent.parents, logId]);
  return { logId, sent };
}
// dryRun: lists what WOULD fire (ignores cooldown, writes nothing). Real run: applies the cooldown, logs, notifies.
function evaluateStudent(studentId, { today, dryRun = false, settings } = {}) {
  const st = studentRow(studentId);
  if (!st) return [];
  const day = today || x.todayIst();
  const S = settings || settingsFor(st.class_id);
  return candidates(st, day, S).map((c) => {
    const base = { type: c.type, numbers: c.numbers, severity: c.severity, summary: c.summary, positive: c.positive };
    if (dryRun) return { ...base, wouldFire: true };
    const skipped = cooldownReason(st.id, c, day);
    if (skipped) return { ...base, fired: false, skipped };
    const f = fire(st, c, day);
    return { ...base, fired: true, logId: f.logId, sent: f.sent };
  });
}
function evaluateClass(classId, { today, dryRun = false, settings } = {}) {
  const students = db.all('SELECT id, name FROM students WHERE class_id = ? ORDER BY id', [classId]);
  const S = settings || settingsFor(classId);
  const findings = [];
  let sent = 0;
  for (const st of students) for (const f of evaluateStudent(st.id, { today, dryRun, settings: S })) {
    findings.push({ studentId: st.id, name: st.name, ...f });
    if (f.fired) sent++;
  }
  return { checked: students.length, findings, sent };
}

// what-if for the teacher: nothing is saved, nothing is sent, the stored settings do not change
function previewAlerts(user, classId, overrides = {}) {
  core.ownClass(user, classId);
  const S = validate(merged(settingsFor(classId), overrides));
  const r = evaluateClass(classId, { today: x.todayIst(), dryRun: true, settings: S });
  return { checked: r.checked, would: r.findings.map((f) => ({ studentId: f.studentId, name: f.name, type: f.type, numbers: f.numbers, summary: f.summary, positive: f.positive })) };
}
function runNow(user, classId) {
  core.ownClass(user, classId);
  const r = evaluateClass(classId, { today: x.todayIst() });
  return { checked: r.checked, sent: r.sent };
}

// ================= Alert centre =================
const ownAlert = (user, id) => {
  const a = db.get('SELECT * FROM alert_log WHERE id = ?', [id]);
  if (!a) throw new HttpError(404, 'Alert not found.');
  core.ownClass(user, a.class_id);
  return a;
};
function listAlerts(user, classId, status) {
  core.ownClass(user, classId);
  const counts = { new: 0, seen: 0, done: 0 };
  db.all('SELECT status, COUNT(*) AS n FROM alert_log WHERE class_id = ? GROUP BY status', [classId]).forEach((r) => { counts[r.status] = r.n; });
  const ok = ['new', 'seen', 'done'].includes(status);
  const rows = db.all(`SELECT a.*, s.name FROM alert_log a JOIN students s ON s.id = a.student_id WHERE a.class_id = ? ${ok ? 'AND a.status = ?' : ''} ORDER BY a.id DESC LIMIT 300`, ok ? [classId, status] : [classId]);
  return { counts, items: rows.map((a) => ({ id: a.id, studentId: a.student_id, name: a.name, type: a.type, numbers: J(a.numbers_json, {}), summary: a.text, status: a.status, note: a.note || '',
    sentOn: a.sent_on, sent: { students: a.sent_students, parents: a.sent_parents }, positive: POSITIVE.includes(a.type), receipt: require('./features').alertReceipt(a.id) })) };
}
function updateAlert(user, id, { status, note } = {}) {
  const a = ownAlert(user, id);
  if (status !== undefined && !['new', 'seen', 'done'].includes(status)) throw new HttpError(400, 'Status must be new, seen or done.');
  if (status !== undefined) db.run('UPDATE alert_log SET status = ?, seen_at = CASE WHEN ? != \'new\' AND seen_at IS NULL THEN CURRENT_TIMESTAMP ELSE seen_at END WHERE id = ?', [status, status, a.id]);
  if (note !== undefined) db.run('UPDATE alert_log SET note = ? WHERE id = ?', [String(note == null ? '' : note).slice(0, 300), a.id]);
  return { ok: true };
}
const newCount = (classId) => db.get("SELECT COUNT(*) AS n FROM alert_log WHERE class_id = ? AND status = 'new'", [classId]).n;

// Called right after marks, attendance or homework are saved. Never throws: a broken check must not break the teacher.
function afterChange(idOrIds) {
  const ids = (Array.isArray(idOrIds) ? idOrIds : [idOrIds]).filter((v) => Number.isInteger(v));
  const today = x.todayIst();
  for (const id of ids) { try { if (studentRow(id)) evaluateStudent(id, { today }); } catch (e) { console.error('[alerts]', e.message); } }
}

module.exports = { defaultYear, settingsFor, getSettings, putSettings, resultsOf, overallPct, countAtt, attendanceFacts, evaluateStudent, evaluateClass, previewAlerts, runNow, listAlerts, updateAlert, afterChange, newCount, POSITIVE };
