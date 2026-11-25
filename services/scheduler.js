// Time-driven jobs. Runs once at start and then every 30 minutes (plain setInterval, no cron library).
// Safe to run twice and safe after the server was off for days: every message has a dedupe key, so nothing repeats.
const db = require('../database/db');
const x = require('./extras');
const notify = require('./notify');
const alerts = require('./alerts');

const OVERDUE_DAYS = 14;      // homework overdue by more than this is not announced any more

function notDone(assessmentId, classId) {
  return db.all(`SELECT s.id FROM students s WHERE s.class_id = ? AND NOT EXISTS (SELECT 1 FROM submissions b WHERE b.assessment_id = ? AND b.student_id = s.id) ORDER BY s.id`, [classId, assessmentId]).map((r) => r.id);
}
const gotNew = (sent) => sent.students + sent.parents > 0;

// today = India date (YYYY-MM-DD). Returns how many children were told, and how many alerts were sent.
function runOnce({ today, hour } = {}) {
  const day = today || x.todayIst();
  const out = { dueSoon: 0, overdue: 0, alerts: 0, classes: 0, errors: 0, leaveMarked: 0, digest: 0, reminders: 0 };
  const homework = db.all("SELECT id, class_id, title, due FROM assessments WHERE kind = 'homework' AND due IS NOT NULL AND due >= ? AND due <= ?", [x.addDays(day, -OVERDUE_DAYS), x.addDays(day, 1)]);
  for (const a of homework) {
    try {
      if (a.due >= day) {          // due today or tomorrow: remind children with nothing handed in
        const when = a.due === day ? 'today' : 'tomorrow';
        for (const sid of notDone(a.id, a.class_id)) {
          const name = db.get('SELECT name FROM students WHERE id = ?', [sid]).name;
          if (gotNew(notify.notifyStudent(sid, { type: 'homework_due_soon', key: 'hw_soon:' + a.id, title: `Homework due ${when}: ${a.title}`,
            studentBody: `Your homework "${a.title}" is due ${when}. Please hand it in.`, parentBody: `${name}'s homework "${a.title}" is due ${when}. It has not been handed in yet.`, link: '#/s/homework/' + a.id, hi: require('./hindi').homeworkDue(a.title, a.due, day, name) }))) out.dueSoon++;
        }
      } else {                     // past due and still nothing: say it once
        for (const sid of notDone(a.id, a.class_id)) {
          const name = db.get('SELECT name FROM students WHERE id = ?', [sid]).name;
          if (gotNew(notify.notifyStudent(sid, { type: 'homework_overdue', key: 'hw_over:' + a.id, title: `Homework overdue: ${a.title}`,
            studentBody: `Your homework "${a.title}" was due on ${a.due} and has not been handed in. You can still hand it in.`, parentBody: `${name}'s homework "${a.title}" was due on ${a.due} and has not been handed in.`, link: '#/s/homework/' + a.id, hi: require('./hindi').homeworkDue(a.title, a.due, day, name) }))) out.overdue++;
        }
      }
    } catch (e) { out.errors++; console.error('[scheduler] homework', e.message); }
  }
  for (const c of db.all('SELECT id FROM classes ORDER BY id')) {
    try { out.alerts += alerts.evaluateClass(c.id, { today: day }).sent; out.classes++; } catch (e) { out.errors++; console.error('[scheduler] class', c.id, e.message); }
  }
  // Milestone 12 step 6: approved leave fills empty days, Sunday-evening digest, meeting reminders (each in its own try, each idempotent)
  const feat = require('./features');
  try { out.leaveMarked = feat.applyApprovedLeaves(day); } catch (e) { out.errors++; console.error('[scheduler] leave', e.message); }
  try { out.digest = feat.runDigest({ today: day, hour }).sent; } catch (e) { out.errors++; console.error('[scheduler] digest', e.message); }
  try { out.reminders = feat.runMeetingReminders({ today: day }).sent; } catch (e) { out.errors++; console.error('[scheduler] reminders', e.message); }
  return out;
}

let timer = null;
function start(ms = 30 * 60 * 1000) {
  if (timer) return;
  const tick = () => { try { runOnce(); } catch (e) { console.error('[scheduler]', e.message); } };
  timer = setInterval(tick, ms); timer.unref();
  setTimeout(tick, 3000).unref();
}
module.exports = { runOnce, start };
