// Report cards. ONE function reportFor(studentId, from, to) does all the maths; teacher, student and parent views all use it.
// CODE computes every number. The AI is not involved. Wording is soft: facts and numbers, "likely pattern, not proof".
const db = require('../database/db');
const x = require('./extras');
const alerts = require('./alerts');
const { HttpError } = require('./auth');

const J = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const mean = (a) => a.reduce((p, v) => p + v, 0) / a.length;
const inRange = (d, from, to) => d >= from && d <= to;
const MAX_REMARK = 600, MIN_CLASS_FOR_AVERAGE = 3, TREND_N = 3, TREND_POINTS = 5, MAX_CUSTOM_DAYS = 800, JOIN_GAP_DAYS = 7;

const FORMULA = 'Overall % = total marks obtained / total marks available, across checked tests, class quizzes and checked homework in the dates shown. Items still waiting for the teacher are left out and listed as waiting. Leave days are not counted in attendance.';
const TREND_RULE = `Trend compares the average of the latest ${TREND_N} results with the ${TREND_N} before them (needs ${TREND_N * 2} results). ${TREND_POINTS} points or more higher = improving, ${TREND_POINTS} or more lower = dropping, otherwise steady.`;

// ================= scope =================
function resolveScope(settings, q = {}, today = x.todayIst()) {
  const scope = q.scope || 'till';
  const S = settings;
  const dayBefore = (d) => x.addDays(d, -1);
  if (scope === 'till') return { key: 'till', scope, label: 'Till date', from: S.yearStart, to: today };
  if (scope === 'year') return { key: 'year', scope, label: 'Full academic year', from: S.yearStart, to: S.yearEnd };
  if (scope === 'term1' || scope === 'term2') {
    if (!S.termSplit) throw new HttpError(400, 'Set a term split date in Class settings first.');
    return scope === 'term1' ? { key: 'term1', scope, label: 'Term 1', from: S.yearStart, to: dayBefore(S.termSplit) } : { key: 'term2', scope, label: 'Term 2', from: S.termSplit, to: S.yearEnd };
  }
  if (scope === 'custom') {
    if (!isDate(q.from) || !isDate(q.to)) throw new HttpError(400, 'Pick real start and end dates.');
    if (q.from > q.to) throw new HttpError(400, 'The end date must not be before the start date.');
    if ((Date.parse(q.to) - Date.parse(q.from)) / 86400000 > MAX_CUSTOM_DAYS) throw new HttpError(400, 'Pick a range shorter than about two years.');
    return { key: `custom:${q.from}:${q.to}`, scope, label: 'Custom dates', from: q.from, to: q.to };
  }
  throw new HttpError(400, 'Unknown report scope.');
}

// ================= facts =================
function classAverage(kind, id) {   // one aggregate number. Hidden when fewer than 3 children have a result (so nobody can be guessed).
  const rows = kind === 'quiz'
    ? db.all('SELECT score AS marks, total FROM quiz_attempts WHERE quiz_id = ?', [id])
    : db.all("SELECT result_json FROM submissions WHERE assessment_id = ? AND status = 'final'", [id]).map((r) => { const res = J(r.result_json, null); return res ? { marks: Number(res.marks) || 0, total: Number(res.total) } : null; }).filter(Boolean);
  const ok = rows.filter((r) => Number(r.total) > 0);
  if (ok.length < MIN_CLASS_FOR_AVERAGE) return null;
  return r1((ok.reduce((p, r) => p + Number(r.marks || 0), 0) / ok.reduce((p, r) => p + Number(r.total), 0)) * 100);
}
const patternName = (assessmentId, sig, items) => {
  const g = db.get('SELECT name FROM group_names WHERE assessment_id = ? AND signature = ?', [assessmentId, sig]);
  if (g && g.name) return g.name;
  const it = (items || []).find((i) => i && i.ruleName && i.ruleExpression);
  return (it && it.ruleName) || 'Unnamed pattern';
};

function reportFor(studentId, from, to, opts = {}) {
  const st = db.get('SELECT s.id, s.name, s.roll, s.class_id, c.name AS class_name, u.name AS teacher_name FROM students s JOIN classes c ON c.id = s.class_id JOIN users u ON u.id = c.teacher_id WHERE s.id = ?', [studentId]);
  if (!st) throw new HttpError(404, 'Student not found.');
  const today = opts.today || x.todayIst();
  const S = alerts.settingsFor(st.class_id);
  const classSize = db.get('SELECT COUNT(*) AS n FROM students WHERE class_id = ?', [st.class_id]).n;

  // ---- results (tests, class quizzes, homework) ----
  const rows = [], waiting = [], missed = [];
  db.all(`SELECT s.id, s.assessment_id, s.status, s.created_at, s.result_json, a.title, a.kind, a.due FROM submissions s JOIN assessments a ON a.id = s.assessment_id WHERE s.student_id = ?`, [st.id]).forEach((r) => {
    const day = x.istDate(r.created_at);
    if (!inRange(day, from, to)) return;
    const type = r.kind === 'homework' ? 'homework' : 'test';
    if (r.status !== 'final') { waiting.push({ title: r.title, type, date: day }); return; }
    const res = J(r.result_json, null);
    if (!res || !(Number(res.total) > 0)) return;
    rows.push({ type, title: r.title, date: day, marks: Number(res.marks) || 0, total: Number(res.total), classAverage: type === 'test' ? classAverage('test', r.assessment_id) : null, assessmentId: r.assessment_id, _res: res, order: r.id });
  });
  db.all(`SELECT qa.id, qa.quiz_id, qa.score, qa.total, qa.created_at, q.title FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id WHERE qa.student_id = ? AND q.student_id IS NULL AND q.audience_json IS NULL`, [st.id]).forEach((r) => {
    const day = x.istDate(r.created_at);
    if (!inRange(day, from, to) || !(Number(r.total) > 0)) return;
    rows.push({ type: 'quiz', title: r.title, date: day, marks: Number(r.score) || 0, total: Number(r.total), classAverage: classAverage('quiz', r.quiz_id), order: 1e9 + r.id });
  });
  rows.forEach((r) => { r.pct = r1((r.marks / r.total) * 100); });
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));

  // ---- missed tests and quizzes (same idea as the alert rules: a test counts as missed when at least half the class has a result) ----
  const graceLimit = x.addDays(today, -3);
  db.all("SELECT a.id, a.title, a.created_at FROM assessments a WHERE a.class_id = ? AND COALESCE(a.kind,'test') != 'homework'", [st.class_id]).forEach((a) => {
    const day = x.istDate(a.created_at);
    if (!inRange(day, from, to) || day > graceLimit) return;
    if (db.get('SELECT 1 FROM submissions WHERE assessment_id = ? AND student_id = ?', [a.id, st.id])) return;
    const done = db.get("SELECT COUNT(*) AS n FROM submissions WHERE assessment_id = ? AND status = 'final'", [a.id]).n;
    if (classSize && done * 2 >= classSize) missed.push({ type: 'test', title: a.title, date: day });
  });
  db.all("SELECT q.id, q.title, q.created_at FROM quizzes q WHERE q.class_id = ? AND q.student_id IS NULL AND q.audience_json IS NULL AND q.mode = 'online' AND q.status = 'closed'", [st.class_id]).forEach((q) => {
    const day = x.istDate(q.created_at);
    if (!inRange(day, from, to)) return;
    if (!db.get('SELECT 1 FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?', [q.id, st.id])) missed.push({ type: 'quiz', title: q.title, date: day });
  });
  missed.sort((a, b) => (a.date < b.date ? -1 : 1));

  const perType = {};
  ['test', 'quiz', 'homework'].forEach((t) => { const of = rows.filter((r) => r.type === t); const p = alerts.overallPct(of); perType[t] = { count: of.length, pct: p == null ? null : r1(p) }; });
  const ov = alerts.overallPct(rows);
  // running overall % after each result (same formula as overall, so the last point equals the overall %). Drawn as the trend chart.
  const overallSeries = rows.map((r, i) => ({ date: r.date, pct: r1(alerts.overallPct(rows.slice(0, i + 1))) }));
  const overall = { pct: ov == null ? null : r1(ov), count: rows.length, enough: ov != null };

  // ---- subjects (only when assessments/quizzes carry one) ----
  const subj = {};
  rows.forEach((r) => {
    const s = r.type === 'quiz'
      ? (db.get('SELECT q.subject FROM quizzes q WHERE q.title = ? AND q.class_id = ? LIMIT 1', [r.title, st.class_id]) || {}).subject
      : (db.get('SELECT subject FROM assessments WHERE id = ?', [r.assessmentId]) || {}).subject;
    if (!s) return; (subj[s] = subj[s] || []).push(r);
  });
  const subjects = Object.keys(subj).sort().map((name) => ({ name, count: subj[name].length, pct: r1(alerts.overallPct(subj[name])) }));

  // ---- trend (clear rule, shown on the page) ----
  let trend = { label: 'not_enough', text: `Not enough results yet to see a trend (needs ${TREND_N * 2}).`, rule: TREND_RULE };
  if (rows.length >= TREND_N * 2) {
    const last = mean(rows.slice(-TREND_N).map((r) => r.pct)), before = mean(rows.slice(-TREND_N * 2, -TREND_N).map((r) => r.pct)), diff = last - before;
    const label = diff >= TREND_POINTS ? 'improving' : diff <= -TREND_POINTS ? 'dropping' : 'steady';
    trend = { label, last: r1(last), before: r1(before), diff: r1(diff), rule: TREND_RULE,
      text: label === 'steady' ? `Steady: the last ${TREND_N} results average ${r1(last)}% and the ${TREND_N} before average ${r1(before)}%.`
        : `${label === 'improving' ? 'Improving' : 'Dropping'}: the last ${TREND_N} results average ${r1(last)}%, the ${TREND_N} before averaged ${r1(before)}%.` };
  }

  // ---- attendance ----
  const attRows = db.all('SELECT day, status FROM attendance WHERE student_id = ? AND day >= ? AND day <= ? ORDER BY day', [st.id, from, to]);
  const attCounts = alerts.countAtt(attRows);
  let longest = 0, run = 0;
  attRows.forEach((r) => { if (r.status === 'absent') { run++; longest = Math.max(longest, run); } else run = 0; });
  const byMonth = {};
  attRows.forEach((r) => { (byMonth[r.day.slice(0, 7)] = byMonth[r.day.slice(0, 7)] || []).push(r); });
  const months = Object.keys(byMonth).sort().map((m) => { const c = alerts.countAtt(byMonth[m]); return { month: m, pct: c.pct, counted: c.counted, absent: c.absent }; });
  const attendance = { present: attCounts.present, late: attCounts.late, absent: attCounts.absent, leave: attCounts.leave, counted: attCounts.counted, pct: attCounts.pct, longestAbsentRun: longest, months, enough: attCounts.counted > 0 };

  // ---- homework (done / late / missed) ----
  const hw = { done: 0, late: 0, missed: 0, waiting: 0, pending: 0, items: [] };
  db.all("SELECT id, title, due, created_at FROM assessments WHERE class_id = ? AND kind = 'homework' ORDER BY id", [st.class_id]).forEach((a) => {
    const key = a.due || x.istDate(a.created_at);
    if (!inRange(key, from, to)) return;
    const sub = db.get('SELECT status, created_at FROM submissions WHERE assessment_id = ? AND student_id = ?', [a.id, st.id]);
    let state;
    if (sub) { if (sub.status !== 'final') state = 'waiting'; else state = a.due && x.istDate(sub.created_at) > a.due ? 'late' : 'done'; }
    else state = a.due && a.due < today ? 'missed' : 'pending';
    hw[state]++; hw.items.push({ title: a.title, due: a.due || null, state });
  });
  const hwCounted = hw.done + hw.late + hw.missed;
  const homework = { ...hw, counted: hwCounted, donePct: hwCounted ? Math.round(((hw.done + hw.late) / hwCounted) * 100) : null, onTimePct: hwCounted ? Math.round((hw.done / hwCounted) * 100) : null, enough: hwCounted > 0 };

  // ---- learning gaps: verified likely patterns only (never "proven") ----
  const seen = {};
  rows.filter((r) => r.type === 'test' && r._res && Array.isArray(r._res.findings)).forEach((r) => {
    const sigs = new Set(r._res.findings.filter((f) => f.level === 'likely').map((f) => f.signature));
    r._sigs = sigs;
    sigs.forEach((sig) => { const p = seen[sig] = seen[sig] || { name: patternName(r.assessmentId, sig, r._res.items), tests: 0, firstOn: r.date, lastOn: r.date }; p.tests++; p.lastOn = r.date; });
  });
  const checked = rows.filter((r) => r._sigs);
  const patterns = Object.entries(seen).map(([sig, p]) => {
    const later = checked.filter((r) => r.date > p.lastOn && !r._sigs.has(sig));
    return { name: p.name, tests: p.tests, firstOn: p.firstOn, lastOn: p.lastOn, status: later.length ? 'improving' : 'showing',
      text: later.length ? `${p.name}: a likely pattern earlier (${p.tests} test${p.tests === 1 ? '' : 's'}). It did not appear in a later test, so this may be improving.` : `${p.name}: a likely pattern in ${p.tests} test${p.tests === 1 ? '' : 's'}. This is a likely pattern, not proof.` };
  });

  // ---- joined mid-way ----
  const firsts = [db.get('SELECT MIN(day) AS d FROM attendance WHERE student_id = ?', [st.id]).d, rows[0] && rows[0].date].filter(Boolean).sort();
  const firstRecord = firsts[0] || null;
  // Only say "joined later" when the child's records start clearly after the class's own first record (a class that simply started tracking late is not a late joiner).
  const classFirst = [db.get('SELECT MIN(day) AS d FROM attendance WHERE class_id = ?', [st.class_id]).d, (db.get("SELECT MIN(created_at) AS d FROM assessments WHERE class_id = ?", [st.class_id]) || {}).d && x.istDate(db.get('SELECT MIN(created_at) AS d FROM assessments WHERE class_id = ?', [st.class_id]).d)].filter(Boolean).sort()[0];
  const joinedNote = firstRecord && classFirst && firstRecord > from && firstRecord <= to && (Date.parse(firstRecord) - Date.parse(classFirst)) / 86400000 > JOIN_GAP_DAYS
    ? `Records for ${st.name} start on ${firstRecord}, so earlier dates in this range are not counted.` : null;

  rows.forEach((r) => { delete r._res; delete r._sigs; delete r.order; delete r.assessmentId; });
  return {
    student: { id: st.id, name: st.name, roll: st.roll, className: st.class_name, teacherName: st.teacher_name },
    range: { from, to }, generatedOn: today, formula: FORMULA,
    overall, overallSeries, perType, subjects, results: rows, waiting, missed, trend, attendance, homework, patterns, joinedNote,
    notEnoughData: !overall.enough && !attendance.enough && !homework.enough,
  };
}

// ================= who can open it =================
function ownStudent(user, studentId) {
  const st = db.get('SELECT s.id, s.class_id, c.teacher_id FROM students s JOIN classes c ON c.id = s.class_id WHERE s.id = ?', [studentId]);
  const ok = st && (user.role === 'teacher' ? st.teacher_id === user.id
    : user.role === 'student' ? user.student_id === st.id
    : user.role === 'parent' ? Boolean(db.get('SELECT 1 FROM parent_links WHERE user_id = ? AND student_id = ?', [user.id, st.id])) : false);
  if (!ok) throw new HttpError(404, 'Student not found.');   // 404 for everyone else, so nobody can tell which students exist
  return st;
}
const remarkRow = (studentId, key) => db.get('SELECT text, updated_at, seen_on FROM report_remarks WHERE student_id = ? AND scope_key = ?', [studentId, key]);

function getReport(user, studentId, q = {}) {
  const st = ownStudent(user, studentId);
  const sc = resolveScope(alerts.settingsFor(st.class_id), q);
  const rep = reportFor(st.id, sc.from, sc.to);
  const rm = remarkRow(st.id, sc.key);
  return { ...rep, scope: { key: sc.key, scope: sc.scope, label: sc.label }, role: user.role,
    remarks: { text: rm ? rm.text : '', seenOn: rm ? rm.seen_on : null, max: MAX_REMARK }, canEdit: user.role === 'teacher', canSee: user.role === 'parent' };
}
function putRemarks(user, studentId, q = {}, text) {
  const st = ownStudent(user, studentId);
  if (user.role !== 'teacher') throw new HttpError(403, 'Only the teacher can write remarks.');
  const sc = resolveScope(alerts.settingsFor(st.class_id), q);
  const t = String(text == null ? '' : text).replace(/\r/g, '').trim().slice(0, MAX_REMARK);
  const old = remarkRow(st.id, sc.key);
  const changed = !old || old.text !== t;
  db.run(`INSERT INTO report_remarks (student_id, scope_key, text, updated_at, seen_on) VALUES (?,?,?,CURRENT_TIMESTAMP,NULL)
          ON CONFLICT(student_id, scope_key) DO UPDATE SET text = excluded.text, updated_at = CURRENT_TIMESTAMP, seen_on = ${changed ? 'NULL' : 'report_remarks.seen_on'}`, [st.id, sc.key, t]);
  return { text: t, seenOn: changed ? null : (old && old.seen_on) || null };
}
function markSeen(user, studentId, q = {}) {
  const st = ownStudent(user, studentId);
  if (user.role !== 'parent') throw new HttpError(403, 'Only a parent can confirm this.');
  const sc = resolveScope(alerts.settingsFor(st.class_id), q);
  const day = x.todayIst();
  db.run(`INSERT INTO report_remarks (student_id, scope_key, text, seen_on) VALUES (?,?,'',?) ON CONFLICT(student_id, scope_key) DO UPDATE SET seen_on = excluded.seen_on`, [st.id, sc.key, day]);
  return { seenOn: day };
}

// ================= whole class =================
function classStudents(user, classId) {
  const c = require('./core').ownClass(user, classId);
  return { c, students: db.all('SELECT id FROM students WHERE class_id = ? ORDER BY CAST(roll AS INTEGER), roll, name', [classId]) };
}
function classReports(user, classId, q = {}) {
  const { c, students } = classStudents(user, classId);
  const sc = resolveScope(alerts.settingsFor(c.id), q);
  return { scope: { key: sc.key, scope: sc.scope, label: sc.label, from: sc.from, to: sc.to }, className: c.name,
    reports: students.map((s) => { const rep = reportFor(s.id, sc.from, sc.to); const rm = remarkRow(s.id, sc.key); return { ...rep, scope: { key: sc.key, label: sc.label }, remarks: { text: rm ? rm.text : '', seenOn: rm ? rm.seen_on : null } }; }) };
}
// Class charts: numbers only, never names. Computed in code from the same reportFor() the report cards use.
const BANDS = [[0, 40, '0-40'], [40, 60, '40-60'], [60, 80, '60-80'], [80, 100.0001, '80-100']];
function classCharts(user, classId, q = {}) {
  const { c, students } = classStudents(user, classId);
  const sc = resolveScope(alerts.settingsFor(c.id), q);
  const bands = BANDS.map(([lo, hi, label]) => ({ label, from: lo, to: Math.min(hi, 100), count: 0 }));
  let noResult = 0;
  students.forEach((s) => {
    const p = reportFor(s.id, sc.from, sc.to).perType.test.pct;
    if (p == null) { noResult++; return; }
    bands[BANDS.findIndex(([lo, hi]) => p >= lo && p < hi)].count++;
  });
  const withTests = students.length - noResult;
  const byMonth = {};
  db.all('SELECT day, status FROM attendance WHERE class_id = ? AND day >= ? AND day <= ? ORDER BY day', [c.id, sc.from, sc.to]).forEach((r) => { (byMonth[r.day.slice(0, 7)] = byMonth[r.day.slice(0, 7)] || []).push(r); });
  const months = Object.keys(byMonth).sort().map((m) => { const k = alerts.countAtt(byMonth[m]); return { month: m, pct: k.pct, counted: k.counted }; }).filter((m) => m.counted > 0);
  const flagged = db.get(`SELECT COUNT(DISTINCT student_id) AS n FROM alert_log WHERE class_id = ? AND status IN ('new','seen') AND type NOT IN (${alerts.POSITIVE.map(() => '?').join(',')})`, [c.id, ...alerts.POSITIVE]).n;
  return { scope: { key: sc.key, label: sc.label, from: sc.from, to: sc.to }, students: students.length,
    bands: { items: bands, withTests, noResult, enough: withTests > 0 },
    attendance: { months, enough: months.length > 0 },
    attention: { count: flagged, students: students.length } };
}
const safeCell = (v) => { const s = v == null ? '' : String(v); return /^[=+\-@\t\r]/.test(s) ? "'" + s : v; };   // a cell can never start a spreadsheet formula
function classCsv(user, classId, q = {}) {
  const { c, students } = classStudents(user, classId);
  const sc = resolveScope(alerts.settingsFor(c.id), q);
  const head = ['Student', 'Roll', 'From', 'To', 'Overall %', 'Tests %', 'Quizzes %', 'Homework marks %', 'Results counted', 'Attendance %', 'Days absent', 'Longest absent run', 'Homework done', 'Homework late', 'Homework missed', 'Missed tests/quizzes', 'Trend'];
  const rows = [head];
  students.forEach((s) => {
    const r = reportFor(s.id, sc.from, sc.to), blank = (v) => (v == null ? '' : v);
    rows.push([r.student.name, r.student.roll, sc.from, sc.to, blank(r.overall.pct), blank(r.perType.test.pct), blank(r.perType.quiz.pct), blank(r.perType.homework.pct), r.overall.count,
      blank(r.attendance.pct), r.attendance.absent, r.attendance.longestAbsentRun, r.homework.done, r.homework.late, r.homework.missed, r.missed.length, r.trend.label === 'not_enough' ? 'not enough data' : r.trend.label].map(safeCell));
  });
  return { filename: `reports-class-${classId}-${sc.key.replace(/[^a-z0-9]+/gi, '-')}.csv`, text: x.toCsv(rows) };
}

module.exports = { reportFor, classCharts, resolveScope, getReport, putRemarks, markSeen, classReports, classCsv, MAX_REMARK, FORMULA, TREND_RULE };
