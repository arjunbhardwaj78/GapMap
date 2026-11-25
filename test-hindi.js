// Milestone 12 item 6: Hindi system text, chosen per person (teachers and parents). No internet, no AI.
process.env.DATABASE_PATH = ':memory:';
const auth = require('./services/auth');
const core = require('./services/core');
const x = require('./services/extras');
const fam = require('./services/family');
const feat = require('./services/features');
const alerts = require('./services/alerts');
const contacts = require('./services/contacts');
const hindi = require('./services/hindi');
const notify = require('./services/notify');
const db = require('./database/db');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const status = (fn) => { try { fn(); return 0; } catch (e) { return e.status || 'CRASH:' + e.message; } };
const user = (u, p, role) => auth.userFromToken(auth.login(u, p, role).token);
const mine = (u, type) => notify.list(u).items.filter((n) => n.type === type);
const DEV = /[\u0900-\u097F]/;
const today = x.todayIst(), D = (n) => x.addDays(today, n);

auth.createUser({ username: 'ht1', password: 'pass1234', name: 'Teacher One', role: 'teacher' });
const T1 = user('ht1', 'pass1234');
const cls = core.createClass(T1, 'C1');
const a = core.addStudent(T1, cls.id, { name: 'Asha', roll: '1' });
const sa = user(a.login.username, a.login.pin, 'student');
const p1 = fam.addParent(T1, a.id, { name: 'Mrs Hindi' }), p2 = fam.addParent(T1, a.id, { name: 'Mr English' });
const PH = user(p1.login.username, p1.login.password, 'parent'), PE = user(p2.login.username, p2.login.password, 'parent');

// ---------- the choice ----------
t('everyone starts with English', notify.langOf(PH.id) === 'en' && notify.langOf(T1.id) === 'en' && notify.langOf(sa.id) === 'en');
contacts.putMine(PH, { language: 'hi' }); contacts.putMine(PE, { language: 'en' });
t('a parent who chooses Hindi gets Hindi; English or unset stays English', notify.langOf(PH.id) === 'hi' && notify.langOf(PE.id) === 'en');
t('an unknown language is refused (400) and students cannot set one (403)', status(() => contacts.putMine(PH, { language: 'fr' })) === 400 && status(() => contacts.putMine(sa, { language: 'hi' })) === 403);

// ---------- one event, two languages ----------
const ev = { type: 'performance_low', key: 'alert:777', title: 'Overall score may need support', studentBody: 'Your overall score is 30%.', parentBody: "Asha's overall score is 30%.", body: 'x',
  hi: hindi.alert('performance_low', { overall: 30, count: 4 }, 'Asha') };
const sent = notify.notifyStudent(a.id, ev);
t('the same alert reaches both parents and the student once each', sent.students === 1 && sent.parents === 2);
t('Hindi parent reads Hindi with the same numbers and the child name', (() => { const n = mine(PH, 'performance_low')[0]; return DEV.test(n.title) && DEV.test(n.body) && n.body.includes('Asha') && n.body.includes('30%') && n.body.includes('4'); })());
t('English parent and the student still read English', mine(PE, 'performance_low')[0].title === 'Overall score may need support' && !DEV.test(mine(PE, 'performance_low')[0].body) && !DEV.test(mine(sa, 'performance_low')[0].body));
t('Hindi alert wording stays soft: "may need support", no verdict words', /सहायता की ज़रूरत हो सकती है/.test(mine(PH, 'performance_low')[0].title) && !/असफल|कमज़ोर|फेल/.test(mine(PH, 'performance_low')[0].body));
t('sending the same event again adds nothing (no duplicate in either language)', (() => { const s2 = notify.notifyStudent(a.id, ev); return s2.parents === 0 && mine(PH, 'performance_low').length === 1; })());
t('the outbox text for the Hindi parent is Hindi, for the English parent English', (() => { const o = (u) => db.get('SELECT text FROM outbox WHERE to_user_id = ? ORDER BY id DESC', [u.id]).text; return DEV.test(o(PH)) && !DEV.test(o(PE)); })());
notify.notifyStudent(a.id, { type: 'quiz_assigned', key: 'nohi:1', title: 'New quiz: X', body: 'Your teacher has published a quiz.' });
t('an event without a Hindi version is sent in English to everyone (nothing is made up)', !DEV.test(mine(PH, 'quiz_assigned')[0].title));

// ---------- the real alert engine ----------
fam.markAttendance(T1, cls.id, D(-3), { [a.id]: 'absent' }); fam.markAttendance(T1, cls.id, D(-2), { [a.id]: 'absent' }); fam.markAttendance(T1, cls.id, D(-1), { [a.id]: 'absent' });
t('a real "absent several days" alert is Hindi for the Hindi parent and English for the other; the teacher log stays English', (() => {
  const h = mine(PH, 'absent_streak')[0], e = mine(PE, 'absent_streak')[0];
  const log = alerts.listAlerts(T1, cls.id).items.find((i) => i.type === 'absent_streak');
  return h && e && DEV.test(h.title) && h.body.includes('3') && e.title === 'Absent several days in a row' && log && !DEV.test(log.summary);
})());
t('the absence message of the day is Hindi for the Hindi parent only', (() => { fam.markAttendance(T1, cls.id, today, { [a.id]: 'absent' }); const h = mine(PH, 'absent_today')[0], e = mine(PE, 'absent_today')[0]; return h && DEV.test(h.title) && h.body.includes(today) && e && !DEV.test(e.title); })());

// ---------- teacher-written words are never translated ----------
fam.postNotice(T1, cls.id, { title: 'Picnic on Friday', body: 'Bring a water bottle.' });
fam.postNotice(T1, cls.id, { title: 'Nice work', body: 'Asha helped a friend.', kind: 'praise', studentId: a.id });
t('a notice: only the label is Hindi; the teacher\'s title and text are exactly as written', (() => { const n = mine(PH, 'notice_posted'); const a1 = n.find((q) => q.title.includes('Picnic')), a2 = n.find((q) => q.title.includes('Nice work')); return a1.title === 'सूचना: Picnic on Friday' && a1.body === 'Bring a water bottle.' && a2.title === 'अच्छी खबर: Nice work' && a2.body === 'Asha helped a friend.'; })());
t('the English parent gets the English label with the same teacher text', mine(PE, 'notice_posted').some((q) => q.title === 'Notice: Picnic on Friday'));

// ---------- homework, results ----------
const hw = core.createAssessment(T1, cls.id, { title: 'Fractions HW', expressions: ['1/2+1/2'], kind: 'homework', due: D(2) });
t('new homework: Hindi label, the teacher\'s title unchanged, the due date unchanged', (() => { const n = mine(PH, 'homework_assigned')[0]; return n.title === 'नया गृहकार्य: Fractions HW' && n.body.includes(D(2)) && mine(PE, 'homework_assigned')[0].title === 'New homework: Fractions HW'; })());
core.createAssessment(T1, cls.id, { title: 'Unit test', expressions: ['2+2'], kind: 'test' });
t('new test: Hindi for the Hindi parent', DEV.test(mine(PH, 'test_assigned')[0].title) && mine(PH, 'test_assigned')[0].title.includes('Unit test'));
const sched = require('./services/scheduler');
sched.runOnce({ today: D(1), hour: 9 });
t('homework due tomorrow reminder: Hindi for the Hindi parent with the child name, English for the other', (() => { const h = mine(PH, 'homework_due_soon')[0], e = mine(PE, 'homework_due_soon')[0]; return h && e && h.title.includes('कल') && h.body.includes('Asha') && /due tomorrow/.test(e.title); })());

// ---------- leave, meetings, digest, teacher in Hindi ----------
contacts.putMine(T1, { language: 'hi' });
const lv = feat.requestLeave(PH, a.id, { from: D(4), to: D(5), reason: 'Wedding' });
t('a teacher who chose Hindi gets the leave request in Hindi', DEV.test(mine(T1, 'leave_request')[0].title) && mine(T1, 'leave_request')[0].title.includes('Asha'));
feat.decideLeave(T1, lv.id, 'approve');
t('leave decision: Hindi for the Hindi parent, English for the other parent', DEV.test(mine(PH, 'leave_decision')[0].title) && mine(PH, 'leave_decision')[0].body.includes('Asha') && mine(PE, 'leave_decision')[0].title === 'Leave approved');
feat.postSlots(T1, cls.id, { day: D(3), times: ['16:00', '16:10'] });
t('meeting times open: Hindi for the Hindi parent only', DEV.test(mine(PH, 'notice_posted').find((n) => /मिलने/.test(n.title)).title) && mine(PE, 'notice_posted').some((n) => n.title === 'Meeting times open'));
const slot = feat.listSlots(T1, cls.id)[0];
feat.bookSlot(PH, a.id, slot.id);
t('booking: Hindi for the Hindi parent and the Hindi teacher, English for the other parent', DEV.test(mine(PH, 'meeting_booked')[0].title) && DEV.test(mine(T1, 'meeting_booked')[0].title) && mine(PE, 'meeting_booked')[0].title === 'Meeting booked');
feat.runMeetingReminders({ today: D(2) });
t('meeting reminder: Hindi for the Hindi parent and teacher, English for the other', DEV.test(mine(PH, 'meeting_reminder')[0].title) && DEV.test(mine(T1, 'meeting_reminder')[0].title) && mine(PE, 'meeting_reminder')[0].title === 'Meeting tomorrow');
feat.removeSlot(T1, slot.id);
t('meeting cancelled by the teacher: Hindi / English by parent', DEV.test(mine(PH, 'meeting_cancelled')[0].title) && mine(PE, 'meeting_cancelled')[0].title === 'Meeting cancelled');
let sun = today; while (new Date(Date.parse(sun + 'T00:00:00Z')).getUTCDay() !== 0) sun = x.addDays(sun, 1);
feat.runDigest({ today: sun, hour: 19 });
t('weekly digest: the Hindi parent gets the Hindi digest with the same facts, the other parent the English one', (() => { const h = mine(PH, 'weekly_digest')[0], e = mine(PE, 'weekly_digest')[0]; return h.title === 'इस सप्ताह: Asha' && /अनुपस्थित/.test(h.body) && /absent/.test(e.body) && e.title === 'This week: Asha' && /गृहकार्य/.test(h.body); })());

// ---------- every template ----------
const N = { overall: 30, count: 4, last: 50, before: 70, n: 3, attendance: 60, counted: 20, daysInARow: 3, month: '2026-09', items: ['Fractions HW', 'Ratio HW'] };
const types = ['performance_low', 'performance_drop', 'improvement', 'attendance_low', 'absent_streak', 'good_attendance', 'missed_homework', 'missed_test', 'missed_quiz'];
t('all 9 alert types have Hindi text: no empty, undefined, NaN or null; parent text names the child', types.every((ty) => { const h = hindi.alert(ty, N, 'Asha'); return h && [h.title, h.studentBody, h.parentBody].every((s) => DEV.test(s) && !/undefined|NaN|null/.test(s)) && h.parentBody.includes('Asha'); }));
t('numbers in the Hindi text come from the same numbers as the English text', hindi.alert('performance_drop', N, 'Asha').parentBody.includes('50%') && hindi.alert('performance_drop', N, 'Asha').parentBody.includes('70%') && hindi.alert('attendance_low', N, 'Asha').studentBody.includes('60%') && hindi.alert('attendance_low', N, 'Asha').studentBody.includes('20'));
t('missed items: the teacher\'s titles stay unchanged in the Hindi text', hindi.alert('missed_homework', N, 'Asha').parentBody.includes('Fractions HW, Ratio HW'));
t('an unknown alert type gives no Hindi (falls back to English)', hindi.alert('nonsense', N, 'Asha') === null);
t('no phone numbers or passwords in any Hindi text', !/\b\d{10}\b/.test(JSON.stringify(db.all('SELECT title, body FROM notifications'))));
contacts.putMine(PH, { language: 'en' });
notify.notifyStudent(a.id, { type: 'performance_low', key: 'alert:778', title: 'English again', studentBody: 's', parentBody: 'p', body: 'p', hi: hindi.alert('performance_low', N, 'Asha') });
t('switching back to English works at once and old messages are left as they were', (() => { const l = mine(PH, 'performance_low'); return l[0].title === 'English again' && l.some((q) => DEV.test(q.title)); })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
