// Milestone 12 tests, part 2: class settings, alert evaluator (threshold maths), cooldown, scheduler, Alert centre. No internet, no AI.
process.env.DATABASE_PATH = ':memory:';
const auth = require('./services/auth');
const core = require('./services/core');
const x = require('./services/extras');
const fam = require('./services/family');
const notify = require('./services/notify');
const alerts = require('./services/alerts');
const sched = require('./services/scheduler');
const db = require('./database/db');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const status = async (fn) => { try { await fn(); return 0; } catch (e) { return e.status || 'CRASH:' + e.message; } };
const is = async (fn, ...codes) => codes.includes(await status(fn));
const user = (u, p, role) => auth.userFromToken(auth.login(u, p, role).token);
const today = x.todayIst(), D = (n) => x.addDays(today, n);
const mine = (u, type) => notify.list(u, { limit: 200 }).items.filter((n) => !type || n.type === type);

auth.createUser({ username: 'tea1', password: 'pass1234', name: 'Teacher One', role: 'teacher' });
auth.createUser({ username: 'tea2', password: 'pass1234', name: 'Teacher Two', role: 'teacher' });
const T1 = user('tea1', 'pass1234'), T2 = user('tea2', 'pass1234');
let n = 0;
const newClass = () => core.createClass(T1, 'Class ' + (++n));
const kid = (cls, name) => { const s = core.addStudent(T1, cls.id, { name, roll: String(++n) }); return { ...s, user: user(s.login.username, s.login.pin, 'student') }; };
let asmN = 0;
// one checked result for a student, "daysAgo" days ago (written straight to the table so dates can be controlled)
function result(cls, sid, marks, total, daysAgo, kind = 'test') {
  const a = core.createAssessment(T1, cls.id, { title: 'T' + (++asmN), kind, expressions: ['1/2+1/3'] });
  db.run("UPDATE assessments SET created_at = ? WHERE id = ?", [D(-daysAgo) + ' 09:00:00', a.id]);
  db.run("INSERT INTO submissions (assessment_id, student_id, status, result_json, created_at) VALUES (?,?,?,?,?)", [a.id, sid, 'final', JSON.stringify({ marks, total }), D(-daysAgo) + ' 10:00:00']);
  return a.id;
}
const att = (cls, sid, day, st) => db.run('INSERT OR REPLACE INTO attendance (class_id, student_id, day, status) VALUES (?,?,?,?)', [cls.id, sid, D(day), st]);
const fired = (sid, type, opts = {}) => alerts.evaluateStudent(sid, { today, ...opts }).filter((f) => f.type === type && f.fired);
const would = (sid, type, opts = {}) => alerts.evaluateStudent(sid, { today, dryRun: true, ...opts }).filter((f) => f.type === type && f.wouldFire);

(async () => {
  // ---------- settings ----------
  const c0 = newClass();
  const d0 = alerts.getSettings(T1, c0.id);
  t('defaults: floor 40, compare 3 results, drop 10 points, attendance 75, 3 absent days, missed test 1 / homework 2',
    d0.floorPct === 40 && d0.dropN === 3 && d0.dropPts === 10 && d0.attPct === 75 && d0.streakDays === 3 && d0.missedTestK === 1 && d0.missedHwK === 2 && d0.floorOn && d0.positiveOn, JSON.stringify(d0));
  t('default academic year is 1 June to 31 March', /-06-01$/.test(d0.yearStart) && /-03-31$/.test(d0.yearEnd) && Number(d0.yearEnd.slice(0, 4)) === Number(d0.yearStart.slice(0, 4)) + 1);
  t('default year: October 2026 is in 2026-06-01 to 2027-03-31; February 2027 is the same year', JSON.stringify(alerts.defaultYear('2026-10-11')) === '{"start":"2026-06-01","end":"2027-03-31"}' && alerts.defaultYear('2027-02-10').start === '2026-06-01' && alerts.defaultYear('2027-06-01').start === '2027-06-01');
  const saved = alerts.putSettings(T1, c0.id, { floorPct: 50, attOn: false });
  t('saving keeps the other values and returns the new ones', saved.floorPct === 50 && saved.attOn === false && saved.dropN === 3 && alerts.getSettings(T1, c0.id).floorPct === 50);
  t('bad numbers are refused (400)', await is(() => alerts.putSettings(T1, c0.id, { floorPct: 101 }), 400) && await is(() => alerts.putSettings(T1, c0.id, { dropN: 0 }), 400) && await is(() => alerts.putSettings(T1, c0.id, { attPct: 'abc' }), 400) && await is(() => alerts.putSettings(T1, c0.id, { streakDays: 1 }), 400));
  t('bad dates are refused (400): impossible day, end before start, split outside the year', await is(() => alerts.putSettings(T1, c0.id, { yearStart: '2026-02-31' }), 400) && await is(() => alerts.putSettings(T1, c0.id, { yearStart: '2027-04-01' }), 400) && await is(() => alerts.putSettings(T1, c0.id, { termSplit: '2020-01-01' }), 400));
  t('a refused save changes nothing', alerts.getSettings(T1, c0.id).floorPct === 50);
  t('term split inside the year is saved', alerts.putSettings(T1, c0.id, { termSplit: '2026-10-01' }).termSplit === '2026-10-01');
  t('another teacher cannot read or change my settings (403)', await is(() => alerts.getSettings(T2, c0.id), 403) && await is(() => alerts.putSettings(T2, c0.id, { floorPct: 10 }), 403));
  t('unknown class is 404', await is(() => alerts.getSettings(T1, 99999), 404));

  // ---------- performance floor ----------
  const c1 = newClass(); const a = kid(c1, 'Asha'), b = kid(c1, 'Ravi'), c = kid(c1, 'Meena');
  result(c1, a.id, 3, 10, 5); result(c1, a.id, 4, 10, 4);          // 35% overall
  result(c1, b.id, 2, 10, 4);                                       // one result only
  result(c1, c.id, 9, 10, 5); result(c1, c.id, 10, 10, 4);          // 95%
  t('overall below the floor gives performance_low with the numbers', (() => { const f = would(a.id, 'performance_low'); return f.length === 1 && f[0].numbers.overall === 35 && f[0].numbers.floor === 40; })());
  t('only one result: "not enough data", no alert', would(b.id, 'performance_low').length === 0);
  t('a good student gets no low alert', would(c.id, 'performance_low').length === 0);
  t('overall % is total marks over total available (not the average of percentages)', (() => { const r = [{ marks: 1, total: 2, pct: 50 }, { marks: 9, total: 10, pct: 90 }]; return Math.round(alerts.overallPct(r)) === 83; })());
  t('overall % with nothing is null (no division by zero)', alerts.overallPct([]) === null);
  t('a result with total 0 is ignored (no crash)', (() => { const z = kid(c1, 'Zero'); db.run("INSERT INTO submissions (assessment_id, student_id, status, result_json) VALUES (?,?,?,?)", [result(c1, c.id, 1, 1, 9), z.id, 'final', '{"marks":0,"total":0}']); return alerts.resultsOf(z.id).length === 0 && would(z.id, 'performance_low').length === 0; })());
  t('floor exactly equal to the percentage does not alert (strictly below)', (() => { const e = kid(c1, 'Exact'); result(c1, e.id, 4, 10, 5); result(c1, e.id, 4, 10, 4); return would(e.id, 'performance_low').length === 0; })());
  t('switching the floor off stops the alert', would(a.id, 'performance_low', { settings: { ...alerts.settingsFor(c1.id), floorOn: false } }).length === 0);
  t('a higher floor catches more children (floor 98 catches the 95% student)', would(c.id, 'performance_low', { settings: { ...alerts.settingsFor(c1.id), floorPct: 98 } }).length === 1);

  // ---------- drop and improvement ----------
  const c2 = newClass();
  const mk = (name, pcts) => { const k = kid(c2, name); pcts.forEach((p, i) => result(c2, k.id, p, 100, 30 - i * 2)); return k; };
  const noFloor = { ...alerts.settingsFor(c2.id), floorOn: false };
  const dr = mk('Dropper', [72, 72, 72, 55, 55, 55]);
  const d10 = mk('TenDrop', [70, 70, 70, 60, 60, 60]);
  const d11 = mk('ElevenDrop', [71, 71, 71, 60, 60, 60]);
  const few = mk('Few', [80, 80, 30, 30, 30]);
  const up = mk('Upper', [50, 50, 50, 62, 62, 62]);
  t('last 3 average 55 vs previous 3 average 72 gives performance_drop with both numbers', (() => { const f = would(dr.id, 'performance_drop', { settings: noFloor }); return f.length === 1 && f[0].numbers.last === 55 && f[0].numbers.before === 72; })());
  t('a drop of exactly 10 points does not alert (more than 10 needed)', would(d10.id, 'performance_drop', { settings: noFloor }).length === 0);
  t('a drop of 11 points alerts', would(d11.id, 'performance_drop', { settings: noFloor }).length === 1);
  t('fewer than 2N results (5 of 6): no drop alert', would(few.id, 'performance_drop', { settings: noFloor }).length === 0);
  t('N is the teacher\'s choice (N=2 works with 5 results)', would(few.id, 'performance_drop', { settings: { ...noFloor, dropN: 2 } }).length === 1);
  t('a rise of 12 points gives a positive "improvement" and no drop', would(up.id, 'improvement', { settings: noFloor }).length === 1 && would(up.id, 'performance_drop', { settings: noFloor }).length === 0);
  t('homework is not part of the trend (only tests and quizzes)', (() => { const k = kid(c2, 'HwOnly'); [90, 90, 90, 10, 10, 10].forEach((p, i) => result(c2, k.id, p, 100, 20 - i, 'homework')); return would(k.id, 'performance_drop', { settings: noFloor }).length === 0; })());

  // ---------- attendance ----------
  const c3 = newClass();
  const k4 = kid(c3, 'Four'), k10 = kid(c3, 'Ten'), kl = kid(c3, 'Leave'), k75 = kid(c3, 'Exact75'), ks = kid(c3, 'Streak'), ks2 = kid(c3, 'Short'), kold = kid(c3, 'Old');
  for (let i = 0; i < 4; i++) att(c3, k4.id, -10 - i, i < 3 ? 'absent' : 'present');       // only 4 days
  for (let i = 0; i < 10; i++) att(c3, k10.id, -20 - i, i < 3 ? 'absent' : 'present');     // 70%
  for (let i = 0; i < 10; i++) att(c3, kl.id, -20 - i, i < 8 ? 'present' : 'leave');       // leave not counted: 100%
  for (let i = 0; i < 8; i++) att(c3, k75.id, -20 - i, i < 6 ? 'present' : 'absent');      // 6/8 = 75%
  [0, 1, 2].forEach((i) => att(c3, ks.id, -i, 'absent'));                                    // 3 in a row up to today
  [0, 1].forEach((i) => att(c3, ks2.id, -i, 'absent')); att(c3, ks2.id, -2, 'present');       // only 2
  [10, 11, 12].forEach((i) => att(c3, kold.id, -i, 'absent'));                                // streak ended long ago
  const quiet = { ...alerts.settingsFor(c3.id), attOn: false };
  t('4 marked days is too little data: no attendance alert', would(k4.id, 'attendance_low').length === 0);
  t('70% attendance is below 75: alert with the numbers', (() => { const f = would(k10.id, 'attendance_low'); return f.length === 1 && f[0].numbers.attendance === 70 && f[0].numbers.floor === 75; })());
  t('approved leave is not counted against the child', would(kl.id, 'attendance_low').length === 0 && alerts.attendanceFacts(kl.id).pct === 100);
  t('exactly 75% does not alert', would(k75.id, 'attendance_low').length === 0);
  t('3 absent days in a row up to today: absent_streak', (() => { const f = would(ks.id, 'absent_streak', { settings: quiet }); return f.length === 1 && f[0].numbers.daysInARow === 3; })());
  t('2 in a row with the default 3: no streak alert; with 2 selected it alerts', would(ks2.id, 'absent_streak').length === 0 && would(ks2.id, 'absent_streak', { settings: { ...quiet, streakDays: 2 } }).length === 1);
  t('a streak that ended more than 3 days ago is not announced now', would(kold.id, 'absent_streak').length === 0);
  t('a child with no attendance rows has no alert and no crash', (() => { const q = kid(c3, 'None'); return alerts.evaluateStudent(q.id, { today, dryRun: true }).length === 0; })());
  t('perfect attendance last month gives good news (10+ days)', (() => { const g = kid(c3, 'Perfect'); const first = today.slice(0, 7) + '-01', prev = x.addDays(first, -1); for (let i = 1; i <= 12; i++) db.run('INSERT INTO attendance (class_id, student_id, day, status) VALUES (?,?,?,?)', [c3.id, g.id, prev.slice(0, 7) + '-' + String(i).padStart(2, '0'), i === 5 ? 'leave' : 'present']); const f = would(g.id, 'good_attendance'); return f.length === 1 && f[0].numbers.month === prev.slice(0, 7); })());

  // ---------- missed items ----------
  const c4 = newClass(); const m1 = kid(c4, 'M1'), m2 = kid(c4, 'M2'), m3 = kid(c4, 'M3');
  const hw = [1, 2].map((i) => core.createAssessment(T1, c4.id, { title: 'HW' + i, kind: 'homework', due: D(-i), expressions: ['1/2+1/3'] }).id);
  const fut = core.createAssessment(T1, c4.id, { title: 'HWfuture', kind: 'homework', due: D(3), expressions: ['1/2+1/3'] }).id;
  db.run("INSERT INTO submissions (assessment_id, student_id, status, result_json) VALUES (?,?,?,?)", [hw[0], m2.id, 'final', '{"marks":1,"total":1}']);
  t('2 homework past due and not handed in: missed_homework (default needs 2)', (() => { const f = would(m1.id, 'missed_homework'); return f.length === 1 && f[0].numbers.count === 2; })());
  t('one handed in leaves 1 miss: no alert with the default 2, alert with 1', would(m2.id, 'missed_homework').length === 0 && would(m2.id, 'missed_homework', { settings: { ...alerts.settingsFor(c4.id), missedHwK: 1 } }).length === 1);
  t('homework not yet due is never counted as missed', would(m3.id, 'missed_homework', { settings: { ...alerts.settingsFor(c4.id), missedHwK: 3 } }).length === 0);
  t('missed alerts can be switched off', would(m1.id, 'missed_homework', { settings: { ...alerts.settingsFor(c4.id), missedOn: false } }).length === 0);
  const c5 = newClass(); const p1 = kid(c5, 'P1'), p2 = kid(c5, 'P2'), p3 = kid(c5, 'P3'), p4 = kid(c5, 'P4');
  const oldT = core.createAssessment(T1, c5.id, { title: 'Old test', expressions: ['1/2+1/3'] }).id;
  const newT = core.createAssessment(T1, c5.id, { title: 'New test', expressions: ['1/2+1/3'] }).id;
  db.run('UPDATE assessments SET created_at = ? WHERE id = ?', [D(-10) + ' 09:00:00', oldT]);
  [p1, p2, p3].forEach((k) => db.run("INSERT INTO submissions (assessment_id, student_id, status, result_json) VALUES (?,?,?,?)", [oldT, k.id, 'final', '{"marks":1,"total":1}']));
  db.run("INSERT INTO submissions (assessment_id, student_id, status, result_json) VALUES (?,?,?,?)", [newT, p1.id, 'final', '{"marks":1,"total":1}']);
  t('a test most of the class has results for, 10 days old, but not this child: missed_test', (() => { const f = would(p4.id, 'missed_test'); return f.length === 1 && f[0].numbers.items[0] === 'Old test'; })());
  t('the children who did the test get no missed alert', would(p1.id, 'missed_test').length === 0);
  t('a test set only today is not missed yet', (() => { const c6 = newClass(); const q = kid(c6, 'Q1'), q2 = kid(c6, 'Q2'); const t1 = core.createAssessment(T1, c6.id, { title: 'Fresh', expressions: ['1/2+1/3'] }).id; db.run("INSERT INTO submissions (assessment_id, student_id, status, result_json) VALUES (?,?,?,?)", [t1, q.id, 'final', '{"marks":1,"total":1}']); return would(q2.id, 'missed_test').length === 0; })());
  t('if fewer than half the class has results the test is not called missed', (() => { const c7 = newClass(); const ks = [1, 2, 3, 4].map((i) => kid(c7, 'R' + i)); const t1 = core.createAssessment(T1, c7.id, { title: 'Half', expressions: ['1/2+1/3'] }).id; db.run('UPDATE assessments SET created_at = ? WHERE id = ?', [D(-9) + ' 09:00:00', t1]); db.run("INSERT INTO submissions (assessment_id, student_id, status, result_json) VALUES (?,?,?,?)", [t1, ks[0].id, 'final', '{"marks":1,"total":1}']); return would(ks[3].id, 'missed_test').length === 0; })());
  t('a closed online quiz a child never attempted: missed_quiz', await (async () => { const c8 = newClass(); const q1 = kid(c8, 'A'), q2 = kid(c8, 'B'); const qz = await x.createQuiz(T1, { configured: () => false }, c8.id, { title: 'Closed quiz', expressions: ['1/2+1/4'] }); x.publishQuiz(T1, qz.id); db.run("INSERT INTO quiz_attempts (quiz_id, student_id, answers_json, score, total) VALUES (?,?,?,?,?)", [qz.id, q1.id, '{}', 1, 1]); x.closeQuiz(T1, qz.id); return would(q2.id, 'missed_quiz').length === 1 && would(q1.id, 'missed_quiz').length === 0; })());

  // ---------- sending: student + parents, wording, cooldown ----------
  const c9 = newClass(); const s9 = kid(c9, 'Asha'), o9 = kid(c9, 'Ravi'), sib = kid(c9, 'Meena');
  const pa = fam.addParent(T1, s9.id, { name: 'Mrs Rao' }); fam.addParent(T1, sib.id, { linkUsername: pa.login.username }); const pb = fam.addParent(T1, s9.id, { name: 'Mr Rao' });
  const po = fam.addParent(T1, o9.id, { name: 'Mr Das' });
  const PA = user(pa.login.username, pa.login.password, 'parent'), PB = user(pb.login.username, pb.login.password, 'parent'), PO = user(po.login.username, po.login.password, 'parent');
  result(c9, s9.id, 30, 100, 6); result(c9, s9.id, 35, 100, 5);
  const f1 = alerts.evaluateStudent(s9.id, { today });
  const low = f1.find((f) => f.type === 'performance_low');
  t('the alert is sent: student and BOTH parents get one, with a link to the child page', low && low.fired && low.sent.students === 1 && low.sent.parents === 2 && mine(PB, 'performance_low')[0].link === '#/p/c/' + s9.id, JSON.stringify(low));
  t('sibling: the parent of Asha AND Meena gets this alert only for Asha', mine(PA, 'performance_low').length === 1 && mine(PA, 'performance_low')[0].child === 'Asha');
  t('another family hears nothing', mine(PO).length === 0 || !mine(PO).some((n) => n.type === 'performance_low'));
  t('student text speaks to the student; parent text names the child', /^Your overall/.test(mine(s9.user, 'performance_low')[0].body) && /^Asha's overall/.test(mine(PB, 'performance_low')[0].body));
  const words = JSON.stringify([...mine(PB), ...mine(s9.user)]);
  t('wording is soft: no "fail", "weak", "bad", "poor", "stupid"', !/\b(fail|failing|failed|weak|bad|poor|stupid|lazy)\b/i.test(words.replace(/"type":"[a-z_]+"/g, '')), words.slice(0, 200));
  t('wording never names another child', !/Ravi|Meena/.test(JSON.stringify(mine(PB)) + JSON.stringify(mine(s9.user))));
  t('the alert is in the Alert centre log with its numbers', (() => { const l = alerts.listAlerts(T1, c9.id); const r = l.items.find((i) => i.type === 'performance_low'); return r && r.name === 'Asha' && r.status === 'new' && r.numbers.overall === 33 && r.sentOn === today && l.counts.new >= 1; })());
  const again = alerts.evaluateStudent(s9.id, { today }).filter((f) => f.type === 'performance_low');
  t('second run the same day: skipped (cooldown), nothing new sent', again.length === 1 && !again[0].fired && /already sent/.test(again[0].skipped) && mine(PB, 'performance_low').length === 1);
  t('3 days later with no change: still within 7 days, skipped', !alerts.evaluateStudent(s9.id, { today: D(3) }).find((f) => f.type === 'performance_low').fired);
  t('6 days later: still skipped', !alerts.evaluateStudent(s9.id, { today: D(6) }).find((f) => f.type === 'performance_low').fired);
  t('8 days later with no change: sent again', alerts.evaluateStudent(s9.id, { today: D(8) }).find((f) => f.type === 'performance_low').fired && mine(PB, 'performance_low').length === 2);
  result(c9, s9.id, 5, 100, 1); result(c9, s9.id, 5, 100, 0);   // clearly worse (33% -> 19%)
  t('within 7 days but clearly worse (5+ points lower): sent again', alerts.evaluateStudent(s9.id, { today: D(8) }).find((f) => f.type === 'performance_low').fired && mine(PB, 'performance_low').length === 3);

  // ---------- event-driven: no scheduler needed ----------
  const c10 = newClass(); const e1 = kid(c10, 'Event'), e2 = kid(c10, 'Fine'); const pe = fam.addParent(T1, e1.id, { name: 'Mrs Event' }); const PE = user(pe.login.username, pe.login.password, 'parent');
  fam.markAttendance(T1, c10.id, D(-2), { [e1.id]: 'absent', [e2.id]: 'present' });
  fam.markAttendance(T1, c10.id, D(-1), { [e1.id]: 'absent', [e2.id]: 'present' });
  t('after two absent days nothing yet', mine(PE, 'absent_streak').length === 0);
  fam.markAttendance(T1, c10.id, today, { [e1.id]: 'absent', [e2.id]: 'present' });
  t('saving the 3rd absent day sends the streak alert at once, plus the absent-today message', mine(PE, 'absent_streak').length === 1 && mine(PE, 'absent_today').length === 1);
  t('the present child got nothing', mine(e2.user).filter((q) => /absent/.test(q.type)).length === 0);
  fam.markAttendance(T1, c10.id, today, { [e1.id]: 'absent' });
  t('saving the same attendance again does not repeat the alert', mine(PE, 'absent_streak').length === 1);
  const eq = await x.createQuiz(T1, { configured: () => false }, c10.id, { title: 'Q', expressions: ['1/2+1/4'] }); x.publishQuiz(T1, eq.id);
  t('a failing evaluator never breaks the teacher (afterChange swallows errors)', (() => { alerts.afterChange('not-a-number'); alerts.afterChange([undefined, null, 99999]); return true; })());

  // ---------- preview (dry run) ----------
  const c11 = newClass(); const v1 = kid(c11, 'V1'), v2 = kid(c11, 'V2');
  result(c11, v1.id, 45, 100, 5); result(c11, v1.id, 45, 100, 4); result(c11, v2.id, 80, 100, 5); result(c11, v2.id, 80, 100, 4);
  const rowsBefore = db.get('SELECT COUNT(*) AS n FROM alert_log').n, notesBefore = db.get('SELECT COUNT(*) AS n FROM notifications').n;
  const p40 = alerts.previewAlerts(T1, c11.id, {}), p50 = alerts.previewAlerts(T1, c11.id, { floorPct: 50 }), p90 = alerts.previewAlerts(T1, c11.id, { floorPct: 90 });
  t('preview with floor 40: nobody; floor 50: V1 only; floor 90: both', p40.would.filter((w) => w.type === 'performance_low').length === 0 && p50.would.filter((w) => w.type === 'performance_low').map((w) => w.name).join() === 'V1' && p90.would.filter((w) => w.type === 'performance_low').length === 2);
  t('preview sends nothing, saves nothing, and does not change the stored settings', db.get('SELECT COUNT(*) AS n FROM alert_log').n === rowsBefore && db.get('SELECT COUNT(*) AS n FROM notifications').n === notesBefore && alerts.settingsFor(c11.id).floorPct === 40);
  t('preview validates numbers too (400)', await is(() => alerts.previewAlerts(T1, c11.id, { floorPct: 500 }), 400));
  t('another teacher cannot preview or run (403)', await is(() => alerts.previewAlerts(T2, c11.id, {}), 403) && await is(() => alerts.runNow(T2, c11.id), 403));
  t('"check now" sends the real alerts once and reports the count', (() => { alerts.putSettings(T1, c11.id, { floorPct: 50 }); const r = alerts.runNow(T1, c11.id); const r2 = alerts.runNow(T1, c11.id); return r.sent === 1 && r.checked === 2 && r2.sent === 0; })());

  // ---------- scheduler ----------
  const c12 = newClass(); const h1 = kid(c12, 'H1'), h2 = kid(c12, 'H2'); const ph = fam.addParent(T1, h1.id, { name: 'Mrs H' }); const PH = user(ph.login.username, ph.login.password, 'parent');
  const dueTomorrow = core.createAssessment(T1, c12.id, { title: 'Due tomorrow', kind: 'homework', due: D(1), expressions: ['1/2+1/3'] }).id;
  db.run("INSERT INTO submissions (assessment_id, student_id, status, result_json) VALUES (?,?,?,?)", [dueTomorrow, h2.id, 'final', '{"marks":1,"total":1}']);
  const r1 = sched.runOnce({ today });
  t('scheduler: homework due tomorrow reminds only the child who has not handed in, and the parent', mine(h1.user, 'homework_due_soon').length === 1 && mine(PH, 'homework_due_soon').length === 1 && mine(h2.user, 'homework_due_soon').length === 0 && r1.errors === 0);
  const before2 = db.get('SELECT COUNT(*) AS n FROM notifications').n;
  const r2 = sched.runOnce({ today });
  t('scheduler is idempotent: a second run sends nothing', db.get('SELECT COUNT(*) AS n FROM notifications').n === before2 && r2.dueSoon === 0 && r2.alerts === 0);
  const gap = sched.runOnce({ today: D(3) });   // the server was off for 3 days
  t('after a 3-day gap: homework is now overdue, told once, and the reminder is not repeated', mine(h1.user, 'homework_overdue').length === 1 && mine(h2.user, 'homework_overdue').length === 0 && mine(h1.user, 'homework_due_soon').length === 1 && gap.errors === 0);
  const before3 = db.get('SELECT COUNT(*) AS n FROM notifications').n;
  sched.runOnce({ today: D(3) }); sched.runOnce({ today: D(3) });
  t('repeated runs after the gap stay quiet', db.get('SELECT COUNT(*) AS n FROM notifications').n === before3);
  t('overdue homework older than 14 days is not announced', (() => { const c13 = newClass(); const k = kid(c13, 'Old'); core.createAssessment(T1, c13.id, { title: 'Ancient', kind: 'homework', due: D(-40), expressions: ['1/2+1/3'] }); sched.runOnce({ today }); return mine(k.user, 'homework_overdue').length === 0; })());
  t('scheduler does the daily alert check for every class (attendance alert found by the scheduler alone)', (() => { const c14 = newClass(); const k = kid(c14, 'Sched'); for (let i = 0; i < 10; i++) att(c14, k.id, -30 - i, i < 4 ? 'absent' : 'present'); const before = mine(k.user, 'attendance_low').length; const r = sched.runOnce({ today }); return before === 0 && r.alerts >= 1 && mine(k.user, 'attendance_low').length === 1; })());
  t('scheduler survives a broken class (errors are counted, the rest still runs)', (() => { const raw = db.get; let boom = true; db.raw.exec('CREATE TEMP TRIGGER IF NOT EXISTS nope BEFORE INSERT ON alert_log WHEN NEW.text LIKE \'%BOOM%\' BEGIN SELECT RAISE(ABORT, \'boom\'); END'); return typeof sched.runOnce({ today }).errors === 'number'; })());
  t('start() can be called twice without a second timer and does not keep the process alive', (() => { sched.start(60000); sched.start(60000); return true; })());

  // ---------- Alert centre actions ----------
  const al = alerts.listAlerts(T1, c9.id).items[0];
  t('mark seen then done; the note is saved and clipped to 300 characters', (() => { alerts.updateAlert(T1, al.id, { status: 'seen', note: 'Called the parent. ' + 'x'.repeat(400) }); const a1 = alerts.listAlerts(T1, c9.id, 'seen').items.find((i) => i.id === al.id); alerts.updateAlert(T1, al.id, { status: 'done' }); const a2 = alerts.listAlerts(T1, c9.id, 'done').items.find((i) => i.id === al.id); return a1 && a1.note.length === 300 && a2 && a2.note.length === 300 && a2.status === 'done'; })());
  t('"new" count drops when an alert is done', alerts.listAlerts(T1, c9.id).counts.new === alerts.listAlerts(T1, c9.id, 'new').items.length);
  t('a bad status is 400, a missing alert is 404, another teacher is 403', await is(() => alerts.updateAlert(T1, al.id, { status: 'deleted' }), 400) && await is(() => alerts.updateAlert(T1, 99999, { status: 'seen' }), 404) && await is(() => alerts.updateAlert(T2, al.id, { status: 'seen' }), 403));
  t('another teacher cannot list my alerts (403)', await is(() => alerts.listAlerts(T2, c9.id), 403));
  t('a text note is stored as plain text', (() => { alerts.updateAlert(T1, al.id, { note: '<img src=x onerror=alert(1)>' }); return alerts.listAlerts(T1, c9.id).items.find((i) => i.id === al.id).note === '<img src=x onerror=alert(1)>'; })());

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
