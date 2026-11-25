// Milestone 12 tests, part 3: report engine (formula, scopes, attendance, homework, trend, remarks, privacy, CSV). No internet, no AI.
process.env.DATABASE_PATH = ':memory:';
const auth = require('./services/auth');
const core = require('./services/core');
const x = require('./services/extras');
const fam = require('./services/family');
const alerts = require('./services/alerts');
const rep = require('./services/reports');
const db = require('./database/db');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const status = async (fn) => { try { await fn(); return 0; } catch (e) { return e.status || 'CRASH:' + e.message; } };
const is = async (fn, ...codes) => codes.includes(await status(fn));
const user = (u, p, role) => auth.userFromToken(auth.login(u, p, role).token);
const today = x.todayIst(), D = (n) => x.addDays(today, n);

auth.createUser({ username: 'rt1', password: 'pass1234', name: 'Teacher One', role: 'teacher' });
auth.createUser({ username: 'rt2', password: 'pass1234', name: 'Teacher Two', role: 'teacher' });
const T1 = user('rt1', 'pass1234'), T2 = user('rt2', 'pass1234');
let n = 0, asmN = 0;
const newClass = () => { const name = 'RClass ' + (++n); return { ...core.createClass(T1, name), name }; };
const kid = (cls, name) => { const s = core.addStudent(T1, cls.id, { name, roll: String(++n) }); return { ...s, user: user(s.login.username, s.login.pin, 'student') }; };
function result(cls, sid, marks, total, daysAgo, kind = 'test', due = null, subject = null) {
  const a = core.createAssessment(T1, cls.id, { title: (kind === 'homework' ? 'HW' : 'T') + (++asmN), kind, due, subject, expressions: ['1/2+1/3'] });
  db.run('UPDATE assessments SET created_at = ? WHERE id = ?', [D(-daysAgo) + ' 09:00:00', a.id]);
  db.run('INSERT INTO submissions (assessment_id, student_id, status, result_json, created_at) VALUES (?,?,?,?,?)', [a.id, sid, 'final', JSON.stringify({ marks, total }), D(-daysAgo) + ' 10:00:00']);
  return a.id;
}
const att = (cls, sid, day, st) => db.run('INSERT OR REPLACE INTO attendance (class_id, student_id, day, status) VALUES (?,?,?,?)', [cls.id, sid, D(day), st]);
const S0 = (cls) => alerts.settingsFor(cls.id);

(async () => {
  // ---------- formula and per-type ----------
  const c1 = newClass(); const a = kid(c1, 'Asha');
  result(c1, a.id, 8, 10, 30); result(c1, a.id, 2, 10, 20); result(c1, a.id, 9, 10, 10, 'homework', D(-10));
  let r = rep.reportFor(a.id, S0(c1).yearStart, today);
  t('overall % = total marks / total available (19/30 = 63.3), NOT the average of percentages', r.overall.pct === 63.3 && r.overall.count === 3, JSON.stringify(r.overall));
  t('per-type: tests 50%, homework 90%, quizzes none', r.perType.test.pct === 50 && r.perType.homework.pct === 90 && r.perType.quiz.pct === null && r.perType.quiz.count === 0);
  t('the formula text is part of the report', /total marks obtained \/ total marks available/.test(r.formula));
  t('profile: name, class, roll, class teacher, dates', r.student.name === 'Asha' && r.student.className === c1.name && r.student.teacherName === 'Teacher One' && r.range.to === today && r.generatedOn === today);

  // ---------- no data, division by zero ----------
  const c2 = newClass(); const e = kid(c2, 'Empty');
  r = rep.reportFor(e.id, S0(c2).yearStart, today);
  t('no data: overall pct is null (not 0), attendance and homework not enough, notEnoughData flag', r.overall.pct === null && !r.overall.enough && !r.attendance.enough && !r.homework.enough && r.notEnoughData && r.attendance.pct === null);
  result(c2, e.id, 0, 0, 5);
  t('a test with total 0 is ignored (no divide by zero)', rep.reportFor(e.id, S0(c2).yearStart, today).overall.pct === null);

  // ---------- unchecked items ----------
  const c3 = newClass(); const w = kid(c3, 'Wait');
  result(c3, w.id, 5, 10, 8);
  const wa = core.createAssessment(T1, c3.id, { title: 'Unchecked', expressions: ['1/2+1/3'] });
  db.run("INSERT INTO submissions (assessment_id, student_id, status, created_at) VALUES (?,?,?,?)", [wa.id, w.id, 'read', D(-2) + ' 10:00:00']);
  r = rep.reportFor(w.id, S0(c3).yearStart, today);
  t('unchecked sheet is excluded from overall and listed as waiting', r.overall.pct === 50 && r.overall.count === 1 && r.waiting.length === 1 && r.waiting[0].title === 'Unchecked');

  // ---------- attendance ----------
  const c4 = newClass(); const at = kid(c4, 'Att'); const lv = kid(c4, 'Leave');
  [['present', -9], ['present', -8], ['absent', -7], ['absent', -6], ['absent', -5], ['present', -4], ['late', -3], ['leave', -2], ['leave', -1]].forEach(([s, d]) => att(c4, at.id, d, s));
  r = rep.reportFor(at.id, S0(c4).yearStart, today);
  t('attendance % = (present+late)/(present+late+absent), leave not counted: 4/7 = 57%', r.attendance.pct === 57 && r.attendance.counted === 7 && r.attendance.leave === 2, JSON.stringify(r.attendance));
  t('longest absent run = 3', r.attendance.longestAbsentRun === 3);
  t('month-wise rows exist with counted days', r.attendance.months.length >= 1 && r.attendance.months.reduce((p, m) => p + m.counted, 0) === 7);
  att(c4, lv.id, -2, 'leave'); att(c4, lv.id, -1, 'leave');
  r = rep.reportFor(lv.id, S0(c4).yearStart, today);
  t('only leave days = no percentage (not 0%), not enough data', r.attendance.pct === null && !r.attendance.enough && r.attendance.leave === 2);

  // ---------- homework done / late / missed ----------
  const c5 = newClass(); const h = kid(c5, 'Hw');
  const hOk = core.createAssessment(T1, c5.id, { title: 'Done', kind: 'homework', due: D(-6), expressions: ['1/2+1/3'] }).id;
  const hLate = core.createAssessment(T1, c5.id, { title: 'Late', kind: 'homework', due: D(-8), expressions: ['1/2+1/3'] }).id;
  core.createAssessment(T1, c5.id, { title: 'Missed', kind: 'homework', due: D(-4), expressions: ['1/2+1/3'] });
  core.createAssessment(T1, c5.id, { title: 'Future', kind: 'homework', due: D(5), expressions: ['1/2+1/3'] });
  db.run("INSERT INTO submissions (assessment_id, student_id, status, result_json, created_at) VALUES (?,?,'final',?,?)", [hOk, h.id, JSON.stringify({ marks: 1, total: 1 }), D(-7) + ' 10:00:00']);
  db.run("INSERT INTO submissions (assessment_id, student_id, status, result_json, created_at) VALUES (?,?,'final',?,?)", [hLate, h.id, JSON.stringify({ marks: 1, total: 1 }), D(-5) + ' 10:00:00']);
  r = rep.reportFor(h.id, D(-30), D(30));
  t('homework: 1 done, 1 late, 1 missed, 1 not due yet (pending, not counted as missed)', r.homework.done === 1 && r.homework.late === 1 && r.homework.missed === 1 && r.homework.pending === 1, JSON.stringify(r.homework));
  t('homework handed in % = (done+late)/counted = 67, on time 33', r.homework.donePct === 67 && r.homework.onTimePct === 33);

  // ---------- missed test + class average is aggregate only ----------
  const c6 = newClass(); const m1 = kid(c6, 'Misser'), m2 = kid(c6, 'Two'), m3 = kid(c6, 'Three'), m4 = kid(c6, 'Four');
  const tid = result(c6, m2.id, 6, 10, 10); result.call(null, c6, m3.id, 8, 10, 12);
  db.run('INSERT INTO submissions (assessment_id, student_id, status, result_json, created_at) VALUES (?,?,?,?,?)', [tid, m3.id, 'final', JSON.stringify({ marks: 8, total: 10 }), D(-10) + ' 11:00:00']);
  db.run('INSERT INTO submissions (assessment_id, student_id, status, result_json, created_at) VALUES (?,?,?,?,?)', [tid, m4.id, 'final', JSON.stringify({ marks: 7, total: 10 }), D(-10) + ' 12:00:00']);
  r = rep.reportFor(m2.id, S0(c6).yearStart, today);
  const row = r.results.find((q) => q.classAverage != null);
  t('class average is one number (6+8+7 / 30 = 70%) with no names anywhere', row && row.classAverage === 70 && !JSON.stringify(r).match(/Three|Four|Misser/), JSON.stringify(r.results));
  t('a child with no sheet for that test (half the class has one) sees it as missed', rep.reportFor(m1.id, S0(c6).yearStart, today).missed.length === 1);
  const c6b = newClass(); const lone1 = kid(c6b, 'L1'), lone2 = kid(c6b, 'L2'); result(c6b, lone1.id, 5, 10, 10);
  t('class average hidden when fewer than 3 children have a result (nobody can be guessed)', rep.reportFor(lone1.id, S0(c6b).yearStart, today).results[0].classAverage === null);

  // ---------- trend rule ----------
  const c7 = newClass(); const tr = kid(c7, 'Trend'), tr2 = kid(c7, 'Flat'), tr3 = kid(c7, 'Short');
  [30, 40, 35, 60, 70, 65].forEach((p, i) => result(c7, tr.id, p, 100, 60 - i * 5));
  [50, 52, 48, 51, 49, 50].forEach((p, i) => result(c7, tr2.id, p, 100, 60 - i * 5));
  [30, 90].forEach((p, i) => result(c7, tr3.id, p, 100, 20 - i));
  let q = rep.reportFor(tr.id, S0(c7).yearStart, today).trend;
  t('trend improving: last 3 average 65 vs 35 before (diff +30)', q.label === 'improving' && q.last === 65 && q.before === 35 && q.diff === 30, JSON.stringify(q));
  t('trend steady when within 5 points', rep.reportFor(tr2.id, S0(c7).yearStart, today).trend.label === 'steady');
  t('trend needs 6 results: 2 results = not enough data', rep.reportFor(tr3.id, S0(c7).yearStart, today).trend.label === 'not_enough');
  const c7b = newClass(); const dr = kid(c7b, 'Drop'); [80, 85, 90, 60, 55, 50].forEach((p, i) => result(c7b, dr.id, p, 100, 60 - i * 5));
  t('trend dropping', rep.reportFor(dr.id, S0(c7b).yearStart, today).trend.label === 'dropping');
  t('the trend rule is in the report', /5 points or more/.test(q.rule));

  // ---------- subjects ----------
  const c8 = newClass(); const sb = kid(c8, 'Subj');
  result(c8, sb.id, 5, 10, 9, 'test', null, 'Maths'); result(c8, sb.id, 9, 10, 8, 'test', null, 'Science');
  const subj = rep.reportFor(sb.id, S0(c8).yearStart, today).subjects;
  t('per-subject % when tests carry a subject', subj.length === 2 && subj.find((s) => s.name === 'Maths').pct === 50 && subj.find((s) => s.name === 'Science').pct === 90);

  // ---------- scopes ----------
  const c9 = newClass(); const sc = kid(c9, 'Scope');
  alerts.putSettings(T1, c9.id, { yearStart: D(-100), yearEnd: D(100), termSplit: D(-20) });
  result(c9, sc.id, 2, 10, 60); result(c9, sc.id, 9, 10, 10); result(c9, sc.id, 5, 10, -50 > -1 ? 0 : 0);
  db.run("UPDATE submissions SET created_at = ? WHERE student_id = ? AND id = (SELECT MAX(id) FROM submissions WHERE student_id = ?)", [D(50) + ' 10:00:00', sc.id, sc.id]);
  const get = (u, q2) => rep.getReport(u, sc.id, q2);
  t('Till date: year start to today (future-dated result not included)', get(T1, { scope: 'till' }).results.length === 2 && get(T1, { scope: 'till' }).range.to === today);
  t('Full year includes the later result', get(T1, { scope: 'year' }).results.length === 3 && get(T1, { scope: 'year' }).range.to === D(100));
  t('Term 1 = year start to the day before the split; Term 2 = split to year end', get(T1, { scope: 'term1' }).results.length === 1 && get(T1, { scope: 'term2' }).results.length === 2 && get(T1, { scope: 'term1' }).range.to === D(-21));
  t('Custom range works', get(T1, { scope: 'custom', from: D(-15), to: D(-5) }).results.length === 1);
  t('different scopes give different numbers', get(T1, { scope: 'till' }).overall.pct !== get(T1, { scope: 'year' }).overall.pct);
  t('custom with end before start is 400', await is(() => get(T1, { scope: 'custom', from: D(-5), to: D(-15) }), 400));
  t('custom with an impossible date is 400', await is(() => get(T1, { scope: 'custom', from: '2026-02-30', to: D(-5) }), 400));
  t('custom range wider than 2 years is 400', await is(() => get(T1, { scope: 'custom', from: '2020-01-01', to: '2026-01-01' }), 400));
  t('unknown scope is 400', await is(() => get(T1, { scope: 'banana' }), 400));
  const c9b = newClass(); const nt = kid(c9b, 'NoTerm');
  t('term scope without a split date is 400 with a helpful message', await is(() => rep.getReport(T1, nt.id, { scope: 'term1' }), 400));

  // ---------- joined mid-year ----------
  const c10 = newClass(); const jn = kid(c10, 'Joiner');
  const old10 = kid(c10, 'Early');
  r = rep.reportFor(jn.id, S0(c10).yearStart, today);
  att(c10, jn.id, -3, 'present'); att(c10, jn.id, -2, 'present');
  t('a class that simply started tracking together gets no late-joiner note', rep.reportFor(jn.id, S0(c10).yearStart, today).joinedNote === null);
  att(c10, old10.id, -40, 'present');
  r = rep.reportFor(jn.id, S0(c10).yearStart, today);
  t('a child whose records start late gets a note saying so (not counted as absent)', /start on/.test(r.joinedNote) && r.attendance.pct === 100, r.joinedNote);

  // ---------- remarks + parent seen ----------
  const c11 = newClass(); const rk = kid(c11, 'Remark'), other = kid(c11, 'Other');
  const pa = fam.addParent(T1, rk.id, { name: 'Mrs Remark' }); const PA = user(pa.login.username, pa.login.password, 'parent');
  const po = fam.addParent(T1, other.id, { name: 'Mrs Other' }); const PO = user(po.login.username, po.login.password, 'parent');
  rep.putRemarks(T1, rk.id, { scope: 'till' }, '  Good effort this term.  ');
  t('teacher remark is saved trimmed and shown to teacher, student and parent', rep.getReport(T1, rk.id, {}).remarks.text === 'Good effort this term.' && rep.getReport(rk.user, rk.id, {}).remarks.text === 'Good effort this term.' && rep.getReport(PA, rk.id, {}).remarks.text === 'Good effort this term.');
  rep.putRemarks(T1, rk.id, { scope: 'till' }, 'x'.repeat(900));
  t('remarks are clipped to 600 characters', rep.getReport(T1, rk.id, {}).remarks.text.length === 600);
  rep.putRemarks(T1, rk.id, { scope: 'till' }, '<b>hi</b>');
  t('remark is stored as plain text', rep.getReport(T1, rk.id, {}).remarks.text === '<b>hi</b>');
  t('remarks are kept per scope (the year scope has none)', rep.getReport(T1, rk.id, { scope: 'year' }).remarks.text === '');
  t('before the parent taps "seen", seenOn is empty', rep.getReport(PA, rk.id, {}).remarks.seenOn === null);
  const sn = rep.markSeen(PA, rk.id, {});
  t('parent marks seen: date saved and visible to the teacher', sn.seenOn === today && rep.getReport(T1, rk.id, {}).remarks.seenOn === today);
  rep.putRemarks(T1, rk.id, { scope: 'till' }, '<b>hi</b>');
  t('saving the same text again keeps "seen"', rep.getReport(T1, rk.id, {}).remarks.seenOn === today);
  rep.putRemarks(T1, rk.id, { scope: 'till' }, 'New words');
  t('changing the remark clears "seen" so the parent reads the new words', rep.getReport(T1, rk.id, {}).remarks.seenOn === null);
  t('student cannot write remarks (403) and parent cannot (403)', await is(() => rep.putRemarks(rk.user, rk.id, {}, 'hack'), 403) && await is(() => rep.putRemarks(PA, rk.id, {}, 'hack'), 403));
  t('teacher cannot press "seen" (403); student cannot (403)', await is(() => rep.markSeen(T1, rk.id, {}), 403) && await is(() => rep.markSeen(rk.user, rk.id, {}), 403));

  // ---------- who can open it ----------
  t('another teacher gets 404 (not 403) for a student they do not teach', await is(() => rep.getReport(T2, rk.id, {}), 404));
  t('another family\'s parent gets 404', await is(() => rep.getReport(PO, rk.id, {}), 404));
  t('a student cannot open a classmate\'s report (404)', await is(() => rep.getReport(other.user, rk.id, {}), 404));
  t('a student opens their own; a parent opens their own child', rep.getReport(rk.user, rk.id, {}).student.name === 'Remark' && rep.getReport(PO, other.id, {}).student.name === 'Other');
  t('unknown student is 404', await is(() => rep.getReport(T1, 99999, {}), 404));
  t('another parent cannot mark seen (404) or another teacher write remarks (404)', await is(() => rep.markSeen(PO, rk.id, {}), 404) && await is(() => rep.putRemarks(T2, rk.id, {}, 'x'), 404));
  t('canEdit only for the teacher, canSee only for the parent', rep.getReport(T1, rk.id, {}).canEdit === true && rep.getReport(PA, rk.id, {}).canEdit === false && rep.getReport(PA, rk.id, {}).canSee === true);

  // ---------- class reports + CSV ----------
  const cls = rep.classReports(T1, c11.id, {});
  t('class reports: one report per student in the class, with remarks', cls.reports.length === 2 && cls.className === c11.name && cls.reports.find((q2) => q2.student.name === 'Remark').remarks.text === 'New words');
  t('class reports and CSV are teacher-only for the class owner (403 for another teacher)', await is(() => rep.classReports(T2, c11.id, {}), 403) && await is(() => rep.classCsv(T2, c11.id, {}), 403));
  const c12 = newClass(); const ev = kid(c12, '=cmd|calc'), ok = kid(c12, 'Normal');
  result(c12, ev.id, 5, 10, 5); result(c12, ev.id, 5, 10, 4);
  const csvOut = rep.classCsv(T1, c12.id, {});
  t('CSV has a header and one row per student with the overall %', /Overall %/.test(csvOut.text) && csvOut.text.split('\r\n').filter(Boolean).length === 3 && /,50,/.test(csvOut.text), csvOut.text);
  t('CSV cells that start with = are neutralised (no spreadsheet formulas)', !/(^|,|\n)"?=cmd/.test(csvOut.text) && /'=cmd/.test(csvOut.text));
  t('CSV filename is safe', /^reports-class-\d+-till\.csv$/.test(csvOut.filename), csvOut.filename);
  t('CSV has no phone numbers, passwords or logins', !/pin|password|username/i.test(csvOut.text));

  // ---------- chart data (step 4) ----------
  const c13 = newClass(); const g1 = kid(c13, 'G1'), g2 = kid(c13, 'G2'), g3 = kid(c13, 'G3'), g4 = kid(c13, 'G4'), g5 = kid(c13, 'G5'), g6 = kid(c13, 'G6');
  result(c13, g1.id, 3, 10, 20); result(c13, g1.id, 10, 10, 10);                 // two results: 30% then 65% running
  [[g1, 0], [g2, 40], [g3, 59], [g4, 60], [g5, 100]].forEach(([k, p]) => result(c13, k.id, p, 100, 5));   // band edges. g6 has no result
  r = rep.reportFor(g1.id, S0(c13).yearStart, today);
  t('overallSeries: running overall % after each result, last point equals the overall %', r.overallSeries.length === r.overall.count && r.overallSeries[0].pct === 30 && r.overallSeries[r.overallSeries.length - 1].pct === r.overall.pct, JSON.stringify(r.overallSeries));
  t('overallSeries is empty when there are no results', rep.reportFor(g6.id, S0(c13).yearStart, today).overallSeries.length === 0);
  // g1 tests = (3+10+0)/(10+10+100)= 10.8%, g2 40, g3 59, g4 60, g5 100
  [[g1, -3, 'present'], [g2, -3, 'absent'], [g3, -3, 'present'], [g4, -3, 'present'], [g1, -2, 'present'], [g2, -2, 'present']].forEach(([k, d, st]) => att(c13, k.id, d, st));
  let ch = rep.classCharts(T1, c13.id, {});
  const cnt = ch.bands.items.map((b) => b.count).join(',');
  t('score bands count students by their test %: 0-40, 40-60, 60-80, 80-100 (edges go up: 40 and 60 are in the higher band, 100 in the last)', cnt === '1,2,1,1' && ch.bands.items.map((b) => b.label).join('|') === '0-40|40-60|60-80|80-100', cnt);
  t('students with no test result are counted separately, not as 0%', ch.bands.noResult === 1 && ch.bands.withTests === 5 && ch.students === 6 && ch.bands.enough);
  t('class charts have NO names and no per-student rows', !/G1|G2|G3|G5|Asha|Teacher One/.test(JSON.stringify(ch)) && !Object.keys(ch).includes('reports'));
  t('class attendance by month is one aggregate per month (6 counted days in total, no names)', ch.attendance.enough && ch.attendance.months.every((m) => /^\d{4}-\d{2}$/.test(m.month) && m.counted > 0 && m.pct >= 0 && m.pct <= 100) && ch.attendance.months.reduce((p, m) => p + m.counted, 0) === 6, JSON.stringify(ch.attendance));
  const c14 = newClass(); kid(c14, 'Nobody');
  ch = rep.classCharts(T1, c14.id, {});
  t('class with no data: enough is false for bands and attendance (the page shows Not enough data yet)', !ch.bands.enough && !ch.attendance.enough && ch.bands.items.every((b) => b.count === 0) && ch.attention.count === 0);
  const ins = (cls, sid, type, status) => db.run("INSERT INTO alert_log (class_id, student_id, type, numbers_json, severity, text, status, sent_on) VALUES (?,?,?,?,?,?,?,?)", [cls.id, sid, type, '{}', 1, 'x', status, today]);
  ins(c13, g1.id, 'attendance_low', 'new'); ins(c13, g1.id, 'performance_low', 'seen'); ins(c13, g2.id, 'performance_drop', 'seen'); ins(c13, g3.id, 'attendance_low', 'done'); ins(c13, g4.id, 'improvement', 'new');
  ch = rep.classCharts(T1, c13.id, {});
  t('needing attention = distinct children with a new/seen alert; done and positive alerts do not count', ch.attention.count === 2 && ch.attention.students === 6, JSON.stringify(ch.attention));
  t('class charts are teacher-only for the class owner (403 other teacher), bad scope is 400', await is(() => rep.classCharts(T2, c13.id, {}), 403) && await is(() => rep.classCharts(PA, c13.id, {}), 403, 404) && await is(() => rep.classCharts(T1, c13.id, { scope: 'nope' }), 400));
  t('class charts honour the period (a custom range with no records shows nothing)', !rep.classCharts(T1, c13.id, { scope: 'custom', from: '2020-01-01', to: '2020-02-01' }).bands.enough);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
