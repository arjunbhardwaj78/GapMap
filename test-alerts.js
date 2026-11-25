// Milestone 12 tests: notifications (more sections are added per milestone). No internet, no AI.
process.env.DATABASE_PATH = ':memory:';
const auth = require('./services/auth');
const core = require('./services/core');
const x = require('./services/extras');
const fam = require('./services/family');
const notify = require('./services/notify');
const db = require('./database/db');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const status = async (fn) => { try { await fn(); return 0; } catch (e) { return e.status || 'CRASH:' + e.message; } };
const is = async (fn, ...codes) => codes.includes(await status(fn));
const noAi = { configured: () => false };
const user = (u, p, role) => auth.userFromToken(auth.login(u, p, role).token);
const mine = (u, type) => notify.list(u, { limit: 200 }).items.filter((n) => !type || n.type === type);

(async () => {
  auth.createUser({ username: 'teach1', password: 'pass1234', name: 'Teacher One', role: 'teacher' });
  auth.createUser({ username: 'teach2', password: 'pass1234', name: 'Teacher Two', role: 'teacher' });
  const T1 = user('teach1', 'pass1234'), T2 = user('teach2', 'pass1234');
  const cls = core.createClass(T1, 'Class A'), clsB = core.createClass(T2, 'Class B');
  const [s1, s2, s3] = ['Asha', 'Ravi', 'Meena'].map((n, i) => core.addStudent(T1, cls.id, { name: n, roll: String(i + 1) }));
  const sB = core.addStudent(T2, clsB.id, { name: 'Zed', roll: '1' });
  const S1 = user(s1.login.username, s1.login.pin, 'student'), S2 = user(s2.login.username, s2.login.pin, 'student'), SB = user(sB.login.username, sB.login.pin, 'student');
  const p1 = fam.addParent(T1, s1.id, { name: 'Mrs Rao' });
  const p1b = fam.addParent(T1, s1.id, { name: 'Mr Rao' });                       // second parent of Asha
  fam.addParent(T1, s3.id, { linkUsername: p1.login.username });                  // Mrs Rao is also Meena's parent (siblings)
  const p2 = fam.addParent(T1, s2.id, { name: 'Mr Das' });
  const PA = user(p1.login.username, p1.login.password, 'parent'), PA2 = user(p1b.login.username, p1b.login.password, 'parent'), PD = user(p2.login.username, p2.login.password, 'parent');
  const pB = fam.addParent(T2, sB.id, { name: 'Mrs Zed' });
  const PB = user(pB.login.username, pB.login.password, 'parent');

  // ---------- assigning homework / test notifies student AND parents, nothing extra for the teacher ----------
  const hw = core.createAssessment(T1, cls.id, { title: 'Fractions homework', kind: 'homework', due: '2026-10-20', expressions: ['1/2+1/3', '2/5+1/5'] });
  t('creating homework tells 3 students and 3 parent people (the sibling parent counts once)', hw.notified.students === 3 && hw.notified.parents === 3, JSON.stringify(hw.notified));
  t('the teacher gets a readable "Sent to" line', /Sent to 3 students and 3 parents/.test(hw.notifiedText), hw.notifiedText);
  t('student bell: 1 homework_assigned, unread, opens the homework page', (() => { const n = mine(S1, 'homework_assigned'); return n.length === 1 && !n[0].read && n[0].link === '#/s/homework/' + hw.id && /2026-10-20/.test(n[0].body); })());
  t('parent bell: names the child and links to that child\'s page', (() => { const n = mine(PD, 'homework_assigned'); return n.length === 1 && n[0].child === 'Ravi' && n[0].link === '#/p/c/' + s2.id; })());
  t('both parents of one child are notified', mine(PA2, 'homework_assigned').length === 1 && mine(PA, 'homework_assigned').length >= 1);
  t('sibling parent gets ONE notification PER CHILD (Asha and Meena)', (() => { const n = mine(PA, 'homework_assigned'); return n.length === 2 && n.map((q) => q.child).sort().join() === 'Asha,Meena'; })());
  t('the student bell does not show a child name field (only parents)', mine(S1)[0].child === null);
  const test1 = core.createAssessment(T1, cls.id, { title: 'Unit test 1', expressions: ['1/2+1/3'] });
  t('creating a test gives test_assigned', mine(S2, 'test_assigned').length === 1 && test1.notified.students === 3);

  // ---------- privacy: other classes and families see nothing ----------
  t('another teacher\'s student and parent got nothing', mine(SB).length === 0 && mine(PB).length === 0);
  t('the teacher\'s own bell stays empty for assignments', mine(T1).length === 0 && notify.unreadCount(T1) === 0);
  t('unread counts are per person', notify.unreadCount(S1) === 2 && notify.unreadCount(PD) === 2 && notify.unreadCount(PA) === 4, [notify.unreadCount(S1), notify.unreadCount(PD), notify.unreadCount(PA)].join());

  // ---------- dedupe ----------
  const before = db.get('SELECT COUNT(*) AS n FROM notifications').n;
  const again = notify.notifyClass(cls.id, { type: 'homework_assigned', key: 'homework_assigned:' + hw.id, title: 'x', body: 'y' });
  t('the same event sent again notifies nobody (dedupe)', again.students === 0 && again.parents === 0 && db.get('SELECT COUNT(*) AS n FROM notifications').n === before);
  t('an unknown type is ignored, never crashes', notify.notifyStudent(s1.id, { type: 'nope', key: 'k', title: 't', body: 'b' }).students === 0);
  t('a missing student is ignored, never crashes', notify.notifyStudent(99999, { type: 'notice_posted', key: 'k2', title: 't', body: 'b' }).parents === 0);

  // ---------- quiz publish: audience respected ----------
  const quiz = await x.createQuiz(T1, noAi, cls.id, { title: 'Fraction quiz', expressions: ['1/2+1/4', '1/3+1/3'] });
  t('a DRAFT quiz notifies nobody', mine(S1, 'quiz_assigned').length === 0);
  const pub = x.publishQuiz(T1, quiz.id);
  t('publishing notifies students and parents, and tells the teacher how many', pub.notified.students === 3 && /Sent to/.test(pub.notifiedText) && mine(S1, 'quiz_assigned').length === 1);
  t('quiz link opens that quiz', mine(S1, 'quiz_assigned')[0].link === '#/s/quiz/' + quiz.id);
  const q2 = await x.createQuiz(T1, noAi, cls.id, { title: 'Group quiz', expressions: ['1/2+1/4'] });
  db.run('UPDATE quizzes SET audience_json = ? WHERE id = ?', [JSON.stringify([s2.id]), q2.id]);
  x.publishQuiz(T1, q2.id);
  t('a quiz for one group notifies only that student and their parent', mine(S2, 'quiz_assigned').length === 2 && mine(S1, 'quiz_assigned').length === 1 && mine(PD, 'quiz_assigned').length === 2);

  // ---------- results ----------
  const sub = await core.manualSubmission(T1, noAi, test1.id, s1.id, { Q1: '5/6' });
  t('saving a result notifies that student and BOTH parents only', sub.notified.students === 1 && sub.notified.parents === 2, JSON.stringify(sub.notified));
  t('result text has the marks and the right link', (() => { const n = mine(S1, 'result_ready')[0]; return n && /1 out of 1/.test(n.body) && n.link === '#/s/results'; })());
  t('other students got no result message', mine(S2, 'result_ready').length === 0);
  await core.manualSubmission(T1, noAi, test1.id, s1.id, { Q1: '5/6' });
  t('saving the same sheet again does not notify twice', mine(S1, 'result_ready').length === 1);

  // ---------- attendance: absent today only ----------
  const today = x.todayIst();
  fam.markAttendance(T1, cls.id, today, { [s2.id]: 'absent', [s1.id]: 'present' });
  t('marked absent today: student and parent are told, present child is not', mine(S2, 'absent_today').length === 1 && mine(PD, 'absent_today').length === 1 && mine(S1, 'absent_today').length === 0);
  fam.markAttendance(T1, cls.id, today, { [s2.id]: 'absent' });
  t('saving attendance twice does not repeat the message', mine(PD, 'absent_today').length === 1);
  fam.markAttendance(T1, cls.id, x.addDays(today, -1), { [s1.id]: 'absent' });
  t('an old day (not today) sends no absent message', mine(S1, 'absent_today').length === 0);

  // ---------- notices and parent messages ----------
  const nt = fam.postNotice(T1, cls.id, { title: 'Picnic on Friday', body: 'Bring a lunch box.' });
  t('class notice notifies everyone in the class', nt.notified.students === 3 && mine(S1, 'notice_posted').length === 1);
  fam.postNotice(T1, cls.id, { title: 'Well done', body: 'Great effort.', kind: 'praise', studentId: s2.id });
  t('a note about one child reaches only that child and parent', mine(S2, 'notice_posted').length === 2 && mine(S1, 'notice_posted').length === 1 && mine(PD, 'notice_posted').length === 2);
  t('praise is worded as good news', mine(S2, 'notice_posted')[0].title.startsWith('Good news'));
  fam.sendMessage(PD, s2.id, 'My son has a fever, he will miss class.');
  t('a parent message reaches the teacher bell and no one else', mine(T1, 'message_from_parent').length === 1 && mine(T2).length === 0 && mine(S2, 'message_from_parent').length === 0);
  t('the teacher bell does NOT copy the private message text', !/fever/.test(JSON.stringify(mine(T1))));

  // ---------- read / unread ----------
  const first = mine(S1)[0];
  const r1 = notify.markRead(S1, { ids: [first.id] });
  t('mark one read lowers the count by one', r1.unread === notify.unreadCount(S1) && mine(S1).find((n) => n.id === first.id).read);
  const pdFirst = mine(PD)[0];
  notify.markRead(S1, { ids: [pdFirst.id] });
  t('a student cannot mark someone else\'s notification read', mine(PD).find((n) => n.id === pdFirst.id).read === false);
  t('mark all read sets the count to zero', notify.markRead(S1, { all: true }).unread === 0);
  t('mark read with nothing to mark is 400', await is(() => notify.markRead(S1, {}), 400));
  t('newest first', (() => { const l = mine(PD); return l.every((n, i) => i === 0 || l[i - 1].id > n.id); })());

  // ---------- mute rules ----------
  t('parent can mute a low-priority type', notify.setPrefs(PD, ['notice_posted']).muted.join() === 'notice_posted');
  fam.postNotice(T1, cls.id, { title: 'Holiday', body: 'School closed Monday.' });
  t('a muted type is not delivered to that parent', mine(PD, 'notice_posted').length === 2 && mine(PA, 'notice_posted').length === 4);
  t('important types cannot be muted (400)', await is(() => notify.setPrefs(PD, ['absent_today']), 400) && await is(() => notify.setPrefs(PD, ['missed_test']), 400));
  fam.markAttendance(T1, cls.id, today, { [s3.id]: 'absent' });
  t('an absent message still arrives for a parent with notices muted', mine(PA, 'absent_today').length === 1);
  t('prefs must be a list', await is(() => notify.setPrefs(PD, 'notice_posted'), 400));
  notify.setPrefs(PD, []);

  // ---------- teacher "sent notifications" ----------
  const log = notify.sentLog(T1, cls.id);
  const hwRow = log.find((r) => r.key === 'homework_assigned:' + hw.id);
  t('teacher log shows who got it and how many have read it', hwRow && hwRow.students === 3 && hwRow.parents === 3 && hwRow.studentsRead >= 1, JSON.stringify(hwRow));
  t('teacher log never includes the teacher\'s own bell items', !log.some((r) => r.type === 'message_from_parent'));
  t('another teacher cannot read my log (404)', await is(() => notify.sentLog(T2, cls.id), 404));

  // ---------- outbox: dry-run only, honest ----------
  const ob = db.all('SELECT * FROM outbox');
  t('every notification has a dry-run outbox row and nothing claims to be sent', ob.length === db.get('SELECT COUNT(*) AS n FROM notifications').n && ob.every((r) => r.status === 'dry-run' && r.channel === 'console'));
  t('no phone numbers or passwords in the outbox', !ob.some((r) => /\b\d{10}\b/.test(r.text) || /password/i.test(r.text)));

  // ---------- failure never breaks the teacher's action ----------
  const keep = db.run; db.raw.exec('DROP TABLE outbox');
  const hw2 = core.createAssessment(T1, cls.id, { title: 'Broken outbox hw', kind: 'homework', expressions: ['1/2+1/3'] });
  t('if notifications fail the teacher\'s action still succeeds', Boolean(hw2.id));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
