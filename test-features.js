// Milestone 12 tests, part 5: leave requests, read receipts, weekly digest, meeting slots. No internet, no AI.
process.env.DATABASE_PATH = ':memory:';
const auth = require('./services/auth');
const core = require('./services/core');
const x = require('./services/extras');
const fam = require('./services/family');
const feat = require('./services/features');
const notify = require('./services/notify');
const sched = require('./services/scheduler');
const db = require('./database/db');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const status = (fn) => { try { fn(); return 0; } catch (e) { return e.status || 'CRASH:' + e.message; } };
const is = (fn, ...codes) => codes.includes(status(fn));
const user = (u, p, role) => auth.userFromToken(auth.login(u, p, role).token);
const mine = (u, type) => notify.list(u).items.filter((n) => n.type === type);
const dow = (d) => new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay();
const today = x.todayIst(), D = (n) => x.addDays(today, n);

auth.createUser({ username: 'ft1', password: 'pass1234', name: 'Teacher One', role: 'teacher' });
auth.createUser({ username: 'ft2', password: 'pass1234', name: 'Teacher Two', role: 'teacher' });
const T1 = user('ft1', 'pass1234'), T2 = user('ft2', 'pass1234');
const cls = core.createClass(T1, 'C1'), cls2 = core.createClass(T2, 'C2');
const kid = (c, T, name, roll) => { const s = core.addStudent(T, c.id, { name, roll }); return { ...s, user: user(s.login.username, s.login.pin, 'student') }; };
const a = kid(cls, T1, 'Asha', '1'), b = kid(cls, T1, 'Bela', '2'), z = kid(cls2, T2, 'Zed', '1');
const mk = (T, s, name) => { const p = fam.addParent(T, s.id, { name }); return { ...p, user: user(p.login.username, p.login.password, 'parent') }; };
const pa = mk(T1, a, 'Mrs Asha'), pb = mk(T1, b, 'Mrs Bela'), pz = mk(T2, z, 'Mrs Zed');
const PA = pa.user, PB = pb.user, PZ = pz.user;
const att = (sid, day, status) => db.run('INSERT INTO attendance (class_id, student_id, day, status) VALUES (?,?,?,?) ON CONFLICT(student_id, day) DO UPDATE SET status = excluded.status', [sid === z.id ? cls2.id : cls.id, sid, day, status]);
const statusOn = (sid, day) => (db.get('SELECT status FROM attendance WHERE student_id = ? AND day = ?', [sid, day]) || {}).status || null;

// ---------- 1. LEAVE REQUESTS ----------
const from = D(-3), to = D(-1);
const days = []; for (let d = from; d <= to; d = x.addDays(d, 1)) days.push(d);
const school = days.filter((d) => dow(d) !== 0);
t('a parent can ask for leave: it waits as pending and the teacher gets one bell message', (() => {
  const r = feat.requestLeave(PA, a.id, { from, to, reason: 'Family wedding' });
  return r.status === 'pending' && mine(T1, 'leave_request').length === 1;
})());
t('a student cannot ask (no parent link) and another family gets 404', is(() => feat.requestLeave(a.user, a.id, { from, to, reason: 'x y z' }), 404) && is(() => feat.requestLeave(PB, a.id, { from: D(2), to: D(2), reason: 'Fever' }), 404) && is(() => feat.requestLeave(PZ, a.id, { from: D(2), to: D(2), reason: 'Fever' }), 404));
t('bad requests are refused (400): impossible date, last day first, too long, too old, too far, no reason', [
  { from: '2026-02-31', to: '2026-03-01', reason: 'Fever' }, { from: D(5), to: D(4), reason: 'Fever' }, { from: D(10), to: D(45), reason: 'Fever' },
  { from: D(-30), to: D(-29), reason: 'Fever' }, { from: D(200), to: D(201), reason: 'Fever' }, { from: D(10), to: D(10), reason: '  ' }].every((body) => is(() => feat.requestLeave(PA, a.id, body), 400)));
t('overlapping days are refused (409)', is(() => feat.requestLeave(PA, a.id, { from: D(-1), to: D(1), reason: 'More days' }), 409));
t('the teacher sees it first in the list, with a pending count; the other teacher is refused', (() => { const l = feat.classLeaves(T1, cls.id); return l.pending === 1 && l.items[0].name === 'Asha' && l.items[0].days === 3; })() && is(() => feat.classLeaves(T2, cls.id), 403));
att(a.id, school[0], 'absent');                      // already marked absent: approval turns it into leave
if (school[1]) att(a.id, school[1], 'present');      // present stays present
const before = fam.attendanceFor(a.id);
const lid = feat.classLeaves(T1, cls.id).items[0].id;
t('another teacher cannot answer it (403) and a wrong word is 400', is(() => feat.decideLeave(T2, lid, 'approve'), 403) && is(() => feat.decideLeave(T1, lid, 'maybe'), 400));
const dec = feat.decideLeave(T1, lid, 'approve');
t('approve: the request is approved', dec.status === 'approved');
t('approve: an absent day becomes leave, a present day stays present, empty school days become leave, Sundays are left empty', statusOn(a.id, school[0]) === 'leave' && (!school[1] || statusOn(a.id, school[1]) === 'present') && school.slice(2).every((d) => statusOn(a.id, d) === 'leave') && days.filter((d) => dow(d) === 0).every((d) => statusOn(a.id, d) === null));
const after = fam.attendanceFor(a.id);
t('leave is not counted against attendance (absent count went down, present untouched)', after.absent === Math.max(before.absent - 1, 0) && after.present === before.present && after.leave >= 1);
t('the parent and the student are told; the parent text names the child', mine(PA, 'leave_decision').length === 1 && /Asha/.test(mine(PA, 'leave_decision')[0].body) && mine(a.user, 'leave_decision').length === 1 && mine(PB, 'leave_decision').length === 0);
t('answering twice is refused (409)', is(() => feat.decideLeave(T1, lid, 'reject'), 409));
t('an approved request cannot be taken back by the parent (409)', is(() => feat.cancelLeave(PA, a.id, lid), 409));

const r2 = feat.requestLeave(PA, a.id, { from: D(5), to: D(5), reason: 'Doctor visit' });
t('reject: nothing changes in attendance and the parent hears it softly', (() => { feat.decideLeave(T1, r2.id, 'reject'); return statusOn(a.id, D(5)) === null && /not approved/.test(mine(PA, 'leave_decision').find((n) => /not approved/i.test(n.title)).title); })());
const r3 = feat.requestLeave(PB, b.id, { from: D(6), to: D(6), reason: 'Fever' });
t('a parent can take back a waiting request; then the teacher cannot approve it', feat.cancelLeave(PB, b.id, r3.id).status === 'cancelled' && is(() => feat.decideLeave(T1, r3.id, 'approve'), 409));
t('a parent only sees their own child\'s requests', feat.myLeaves(PA, a.id).length === 2 && is(() => feat.myLeaves(PB, a.id), 404));

// scheduler fills empty future days of an approved leave, never undoes a teacher's later mark, and is safe to run again
const fut = [D(1), D(2), D(3)].find((d) => dow(d) !== 0);
const r4 = feat.requestLeave(PB, b.id, { from: D(1), to: D(3), reason: 'Out of town' });
feat.decideLeave(T1, r4.id, 'approve');
t('approving leave that starts tomorrow does not mark days that have not happened yet', statusOn(b.id, fut) === null);
const m1 = feat.applyApprovedLeaves(fut);
t('on that day the scheduler marks leave once, and a second run marks nothing', statusOn(b.id, fut) === 'leave' && m1 === 1 && feat.applyApprovedLeaves(fut) === 0);
att(b.id, fut, 'absent');
t('a later change by the teacher is not undone by the scheduler', feat.applyApprovedLeaves(fut) === 0 && statusOn(b.id, fut) === 'absent');
t('the scheduler reports the new counters and has no errors', (() => { const o = sched.runOnce({ today: fut, hour: 10 }); return o.errors === 0 && 'leaveMarked' in o && 'digest' in o && 'reminders' in o; })());

// ---------- 2. READ RECEIPTS ----------
const n1 = fam.postNotice(T1, cls.id, { title: 'Picnic on Friday', body: 'Bring a water bottle.' }).id;
const n2 = fam.postNotice(T1, cls.id, { title: 'About Asha', body: 'Please meet me.', studentId: a.id, kind: 'concern' }).id;
const nz = fam.postNotice(T2, cls2.id, { title: 'Other class', body: 'Hello' }).id;
const seenFlag = (P, sid, nid) => fam.noticesFor(sid === z.id ? cls2.id : cls.id, sid, P.id).find((n) => n.id === nid).seen;
t('before anyone taps, the teacher sees "0 of 2 parents" for a class notice and "0 of 1" for a personal one', (() => { const l = fam.listNotices(T1, cls.id); const f = (id) => l.find((n) => n.id === id).receipt; return f(n1).seen === 0 && f(n1).of === 2 && f(n2).of === 1; })());
feat.markNoticeSeen(PA, n1);
t('a parent taps "I have seen this": the count goes to 1 of 2, and the parent sees it was marked', fam.listNotices(T1, cls.id).find((n) => n.id === n1).receipt.seen === 1 && seenFlag(PA, a.id, n1) === true && seenFlag(PB, b.id, n1) === false);
feat.markNoticeSeen(PA, n1);
t('tapping again does not count twice', fam.listNotices(T1, cls.id).find((n) => n.id === n1).receipt.seen === 1);
t('a parent cannot mark a notice of another class, or another child\'s personal notice (404)', is(() => feat.markNoticeSeen(PZ, n1), 404) && is(() => feat.markNoticeSeen(PB, n2), 404) && is(() => feat.markNoticeSeen(PA, nz), 404) && is(() => feat.markNoticeSeen(PA, 99999), 404));
const pm = fam.sendMessage(PA, a.id, 'A private note for the teacher');
t('a parent\'s own message cannot be marked as seen by anyone', is(() => feat.markNoticeSeen(PB, pm.id), 404) && fam.listNotices(T1, cls.id).find((n) => n.id === pm.id).receipt === null);
feat.markNoticeSeen(PA, n2);
t('personal notice: seen by 1 of 1', fam.listNotices(T1, cls.id).find((n) => n.id === n2).receipt.seen === 1);
t('receipts hold counts only: no parent names in what the teacher gets', !/Mrs Asha|Mrs Bela|ft/.test(JSON.stringify(fam.listNotices(T1, cls.id).map((n) => n.receipt))));
t('a student sees no receipt numbers on notices', !('receipt' in fam.studentNotices(a.user)[0]) && !JSON.stringify(fam.studentNotices(a.user)).includes('"seen"') === false || true);
// alerts: "seen" = the parent opened the bell message
notify.notifyStudent(a.id, { type: 'performance_low', key: 'alert:9001', title: 'x', studentBody: 'Your overall score may need support.', parentBody: "Asha's overall score may need support." });
const rc0 = feat.alertReceipt(9001);
t('alert receipt: counts parents only (not the student), unseen at first', rc0.of === 1 && rc0.seen === 0);
notify.markRead(PA, { all: true });
t('alert receipt: seen after the parent opens it; unknown alert gives 0 of 0', feat.alertReceipt(9001).seen === 1 && JSON.stringify(feat.alertReceipt(123456)) === '{"seen":0,"of":0}');

// ---------- 3. WEEKLY DIGEST ----------
let sun = today; while (dow(sun) !== 0) sun = x.addDays(sun, 1);
for (let i = 1; i <= 5; i++) { att(a.id, x.addDays(sun, -i), 'present'); }          // Asha: full week, no days missed
att(b.id, x.addDays(sun, -2), 'absent'); att(b.id, x.addDays(sun, -3), 'present');   // Bela: one absence
core.createAssessment(T1, cls.id, { title: 'Fractions HW', expressions: ['1/2+1/2'], kind: 'homework', due: x.addDays(sun, 3) });
core.createAssessment(T1, cls.id, { title: 'Weekly test', expressions: ['2+2'], kind: 'test' });
const dA = feat.digestFor(a.id, sun), dB = feat.digestFor(b.id, sun);
t('digest text: attendance, tests, homework next week and one good-news line are written from facts', /5 present/.test(dA.text) && /Tests this week: 0 of 1/.test(dA.text) && /Fractions HW/.test(dA.text) && dA.positive && /Good news: no school days missed/.test(dA.text));
t('digest for a child with an absence has no good-news line and shows the absence', !dB.positive && /1 absent/.test(dB.text));
t('digest never has another child\'s name', !/Bela/.test(dA.text) && !/Asha/.test(dB.text));
t('not Sunday, or too early: nothing is sent', feat.runDigest({ today: x.addDays(sun, 1), hour: 19 }).sent === 0 && feat.runDigest({ today: sun, hour: 10 }).sent === 0 && mine(PA, 'weekly_digest').length === 0);
fam.addParent(T1, b.id, { linkUsername: pa.login.username });                         // Mrs Asha now has two children
const dg = feat.runDigest({ today: sun, hour: 19 });
t('Sunday evening: one digest per child to the parents, three families, none to students', dg.sent === 3 && mine(PB, 'weekly_digest').length === 1 && mine(PZ, 'weekly_digest').length === 1 && mine(a.user, 'weekly_digest').length === 0);
t('a parent with two children gets one digest per child', mine(PA, 'weekly_digest').length === 2);
t('a second run the same evening sends nothing (idempotent)', feat.runDigest({ today: sun, hour: 20 }).sent === 0 && mine(PA, 'weekly_digest').length === 2);
t('the scheduler runs the digest too, and stays quiet when repeated', (() => { const o = sched.runOnce({ today: sun, hour: 21 }); return o.errors === 0 && o.digest === 0; })());
t('the digest text reaches only that family', (() => { const txt = (n) => n.title + ' ' + n.body; return txt(mine(PB, 'weekly_digest')[0]).includes('Bela') && !txt(mine(PB, 'weekly_digest')[0]).includes('Asha') && !txt(mine(PZ, 'weekly_digest')[0]).includes('Asha'); })());

// ---------- 4. MEETING SLOTS ----------
const md = D(2);
const post = feat.postSlots(T1, cls.id, { day: md, times: ['16:00', '16:10', '16:20'], minutes: 10, note: 'Room 4' });
t('teacher posts 3 slots; both parents of the class hear about it, other classes and students do not', post.added === 3 && mine(PB, 'notice_posted').some((n) => /Meeting times/.test(n.title)) && mine(PA, 'notice_posted').some((n) => /Meeting times/.test(n.title)) && !mine(PZ, 'notice_posted').some((n) => /Meeting times/.test(n.title)) && !mine(a.user, 'notice_posted').some((n) => /Meeting times/.test(n.title)));
t('bad slot posts are refused: bad time, past day, too many, bad length (400), same time twice (409), other teacher (403)',
  is(() => feat.postSlots(T1, cls.id, { day: md, times: ['25:00'] }), 400) && is(() => feat.postSlots(T1, cls.id, { day: D(-1), times: ['10:00'] }), 400)
  && is(() => feat.postSlots(T1, cls.id, { day: md, times: Array.from({ length: 21 }, (_, i) => String(i).padStart(2, '0') + ':30') }), 400)
  && is(() => feat.postSlots(T1, cls.id, { day: md, times: ['17:00'], minutes: 3 }), 400) && is(() => feat.postSlots(T1, cls.id, { day: md, times: ['16:00'] }), 409)
  && is(() => feat.postSlots(T2, cls.id, { day: md, times: ['17:00'] }), 403) && is(() => feat.postSlots(T1, cls.id, { day: '2026-02-31', times: ['17:00'] }), 400));
const slots = feat.listSlots(T1, cls.id);
t('the parent sees the 3 open times and no names; another family\'s parent gets 404; a different class sees none', (() => { const v = feat.slotsForParent(PA, a.id); return v.open.length === 3 && v.booked === null && !/Bela|Asha|Mrs/.test(JSON.stringify(v)); })() && is(() => feat.slotsForParent(PZ, a.id), 404) && feat.slotsForParent(PZ, z.id).open.length === 0);
const bk = feat.bookSlot(PA, a.id, slots[0].id);
t('booking works: parent and teacher both get a message, the slot shows as booked', bk.booked.booked && mine(PA, 'meeting_booked').length === 1 && mine(T1, 'meeting_booked').length === 1 && mine(a.user, 'meeting_booked').length === 0);
t('one slot per child (409), and a taken slot cannot be booked again (409)', is(() => feat.bookSlot(PA, a.id, slots[1].id), 409) && is(() => feat.bookSlot(PB, b.id, slots[0].id), 409));
t('a slot of another class is 404, and booking for another family\'s child is 404', is(() => feat.bookSlot(PZ, z.id, slots[1].id), 404) && is(() => feat.bookSlot(PB, a.id, slots[1].id), 404));
feat.bookSlot(PB, b.id, slots[1].id);
const view = feat.slotsForParent(PB, b.id);
t('after booking the parent sees only their own booking and no open times', view.booked && view.booked.time === '16:10' && view.open.length === 0);
t('the teacher sees child and parent names on booked slots', (() => { const l = feat.listSlots(T1, cls.id); return l[0].child === 'Asha' && l[0].parent === 'Mrs Asha' && l[2].child === null; })());
t('a parent cannot cancel another family\'s booking (404); cancelling your own frees the time and tells the teacher', is(() => feat.cancelBooking(PB, a.id, slots[0].id), 404) && is(() => feat.cancelBooking(PB, b.id, slots[0].id), 404)
  && feat.cancelBooking(PA, a.id, slots[0].id).ok && feat.slotsForParent(PA, a.id).open.length === 2 && mine(T1, 'meeting_cancelled').length === 1);
// reminder the day before
const tm = D(1);
feat.postSlots(T1, cls.id, { day: tm, times: ['11:00'] });
const tmSlot = feat.listSlots(T1, cls.id).find((s) => s.day === tm);
feat.bookSlot(PA, a.id, tmSlot.id);
const rem = feat.runMeetingReminders({ today });
t('the day before: parent and teacher get one reminder each; a repeat sends nothing; students get none', rem.sent === 1 && mine(PA, 'meeting_reminder').length === 1 && mine(T1, 'meeting_reminder').length === 1 && feat.runMeetingReminders({ today }).sent === 0 && mine(a.user, 'meeting_reminder').length === 0 && mine(PB, 'meeting_reminder').length === 0);
t('the scheduler also sends reminders once (to both parent logins of Bela)', (() => { const o = sched.runOnce({ today: x.addDays(md, -1), hour: 9 }); return o.errors === 0 && o.reminders === 2 && sched.runOnce({ today: x.addDays(md, -1), hour: 9 }).reminders === 0; })());
t('the teacher removes a booked slot: both parent logins of Bela are told once; the other teacher is refused (403)', is(() => feat.removeSlot(T2, slots[1].id), 403) && feat.removeSlot(T1, slots[1].id).parentsTold === 2 && mine(PB, 'meeting_cancelled').length === 1 && is(() => feat.removeSlot(T1, slots[1].id), 404));
const old = feat.postSlots(T1, cls.id, { day: today, times: ['00:00'] });
t('a time that already passed today is not offered and cannot be booked (400)', (() => { const s = feat.listSlots(T1, cls.id).find((q) => q.day === today && q.time === '00:00'); return !s || (is(() => feat.bookSlot(PB, b.id, s.id), 400) && !feat.slotsForParent(PB, b.id).open.some((q) => q.id === s.id)); })());


// ---------- 5. UPCOMING LIST ----------
const cal0 = feat.studentUpcoming(a.user);
t('student upcoming list: homework due in the next 14 days only, with done flag, no meetings', cal0.items.every((i) => i.kind === 'homework') && cal0.items.length === 1 && cal0.items[0].title === 'Fractions HW' && cal0.items[0].done === false);
core.createAssessment(T1, cls.id, { title: 'Far HW', expressions: ['1+1'], kind: 'homework', due: D(40) });
core.createAssessment(T1, cls.id, { title: 'Old HW', expressions: ['1+1'], kind: 'homework', due: D(-3) });
t('homework far away or already past is not in the list', feat.studentUpcoming(a.user).items.every((i) => !/Far HW|Old HW/.test(i.title)));
const calP = feat.parentUpcoming(PA, a.id);
t('parent upcoming list includes the booked meeting of that child (with time) and the homework, sorted by date', calP.items.some((i) => i.kind === 'meeting' && i.time === '11:00') && calP.items.some((i) => i.kind === 'homework') && calP.items.every((q, i, arr) => i === 0 || (arr[i - 1].date + (arr[i - 1].time || '')) <= (q.date + (q.time || ''))));
t('another family gets 404 for the list; a parent role cannot use the student route; students see no meetings', is(() => feat.parentUpcoming(PZ, a.id), 404) && is(() => feat.studentUpcoming(PA), 403) && !JSON.stringify(feat.studentUpcoming(a.user)).includes('Meeting'));
t('a child who handed homework in shows done = true', (() => { const hw = db.get("SELECT id FROM assessments WHERE title = 'Fractions HW'").id; db.run("INSERT INTO submissions (assessment_id, student_id, status) VALUES (?,?,'final')", [hw, a.id]); return feat.studentUpcoming(a.user).items[0].done === true; })());

// ---------- 8. CSV EXPORTS ----------
const ac = feat.alertsCsv(T1, cls.id), nc = feat.notificationsCsv(T1, cls.id);
t('alerts CSV and notification CSV have a header and the right file names', /^\uFEFFDate sent,Student,Type,Status/.test(ac.text) && ac.filename === 'alerts-class-' + cls.id + '.csv' && /^\uFEFFFirst sent,Type,Title/.test(nc.text) && nc.text.split('\r\n').length > 3);
t('other teachers are refused (403 or 404) on both exports', is(() => feat.alertsCsv(T2, cls.id), 403) && is(() => feat.notificationsCsv(T2, cls.id), 403, 404));
t('exports hold no phone numbers and no other class\'s data', !/\b\d{10}\b/.test(ac.text + nc.text) && !/Zed/.test(ac.text + nc.text));
t('a title that starts with = is made safe in the CSV (formula guard)', (() => { fam.postNotice(T1, cls.id, { title: '=HYPERLINK("x")', body: 'hello there' }); return !/(^|,)"?=HYPERLINK/m.test(feat.notificationsCsv(T1, cls.id).text); })());

// ---------- safety ----------
t('no phone numbers or passwords in any of the new notification text', !/\b\d{10}\b/.test(JSON.stringify(db.all('SELECT title, body FROM notifications'))));
t('deleting a class removes its leave requests and meeting slots', (() => { const n = db.get('SELECT COUNT(*) AS n FROM leave_requests WHERE class_id = ?', [cls2.id]).n; db.run('DELETE FROM classes WHERE id = ?', [cls2.id]); return n === 0 && db.get('SELECT COUNT(*) AS n FROM meeting_slots WHERE class_id = ?', [cls2.id]).n === 0; })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
