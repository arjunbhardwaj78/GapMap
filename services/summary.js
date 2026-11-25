// Parent summary: one short, kind summary per child in Hindi (Devanagari), Hindi in Roman letters, or English.
// NO AI. Every number comes from reportFor / attendanceFor / upcoming; the words come from fixed templates in hindi.js.
// A parent sees only their own linked children (404 otherwise). The text never holds a phone number, a password or another child's name.
const db = require('../database/db');
const x = require('./extras');
const { HttpError } = require('./auth');
const alerts = require('./alerts');
const reports = require('./reports');
const family = require('./family');
const features = require('./features');
const hindi = require('./hindi');

const WINDOW_DAYS = 7;
const KIND = { attendance_low: 'attendance', absent_streak: 'attendance', performance_low: 'marks', performance_drop: 'marks', missed_homework: 'homework', missed_test: 'tests', missed_quiz: 'tests' };

function parentOnly(user) { if (!user || user.role !== 'parent') throw new HttpError(403, 'This page is for parents.'); }
function langOf(q) {
  const l = String((q && q.lang) || 'hi').toLowerCase();
  if (!hindi.SUMMARY_LANGS.includes(l)) throw new HttpError(400, 'Language must be hi, hinglish or en.');
  return l;
}

// the facts for one child (also the "numbers it used" that the endpoint returns, and what the chat bot in step 2 may use)
function factsFor(st, today) {
  const sc = reports.resolveScope(alerts.settingsFor(st.class_id), {}, today);
  const r = reports.reportFor(st.id, sc.from, sc.to);
  const attAll = family.attendanceFor(st.id);
  const mk = alerts.countAtt(db.all('SELECT status FROM attendance WHERE student_id = ? AND day LIKE ?', [st.id, today.slice(0, 7) + '-%']));
  const graded = r.results.filter((q) => q.type !== 'homework');
  const latest = graded.slice(-3).map((q) => ({ title: q.title, marks: q.marks, total: q.total, pct: q.pct }));
  const avgPct = r.perType.test.pct != null ? r.perType.test.pct : r.perType.quiz.pct;
  const end = x.addDays(today, WINDOW_DAYS);
  const dueAll = features.upcoming(st.id, today, false).items.filter((i) => i.kind === 'homework' && !i.done && i.date <= end);
  const hw = r.homework;
  let good = null;
  if (mk.pct === 100 && mk.counted >= 3) good = 'attendance';
  else if (r.trend.label === 'improving') good = 'improving';
  else if (hw.counted >= 2 && hw.missed === 0) good = 'homework';
  const open = db.all("SELECT type FROM alert_log WHERE student_id = ? AND status IN ('new','seen') ORDER BY id DESC", [st.id]).map((a) => KIND[a.type]).filter(Boolean);
  const support = open[0] || (attAll.low ? 'attendance' : null);
  return { name: st.name, attendance: { month: { pct: mk.pct, counted: mk.counted }, overall: { pct: attAll.pct, counted: attAll.present + attAll.late + attAll.absent } },
    tests: { latest, avgPct: avgPct == null ? null : avgPct }, homework: { due: dueAll.slice(0, 3).map((i) => i.title), dueCount: dueAll.length, windowDays: WINDOW_DAYS }, good, support };
}

function build(st, lang, today) {
  const f = factsFor(st, today);
  const lines = hindi.summary(f, lang);
  return { child: { id: st.id, name: st.name, className: st.class_name }, lang, today, lines, text: lines.join(' '), numbers: f };
}
const linkedChild = (user, id) => family.linkedChild(user, id);

function summaryFor(user, studentId, q = {}) {
  parentOnly(user);
  const lang = langOf(q);
  return build(linkedChild(user, studentId), lang, x.todayIst());
}
function summaryAll(user, q = {}) {
  parentOnly(user);
  const lang = langOf(q), today = x.todayIst();
  const ids = db.all('SELECT pl.student_id FROM parent_links pl JOIN students s ON s.id = pl.student_id WHERE pl.user_id = ? ORDER BY pl.id', [user.id]).map((r) => r.student_id);
  return { lang, today, children: ids.map((id) => build(linkedChild(user, id), lang, today)) };
}
module.exports = { summaryFor, summaryAll, factsFor, WINDOW_DAYS };
