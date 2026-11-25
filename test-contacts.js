// Milestone 12 tests, part 4: contact numbers with consent (default OFF, only the other side, never students/other families/reports). No internet.
process.env.DATABASE_PATH = ':memory:';
const auth = require('./services/auth');
const core = require('./services/core');
const x = require('./services/extras');
const fam = require('./services/family');
const rep = require('./services/reports');
const con = require('./services/contacts');
const notify = require('./services/notify');
const db = require('./database/db');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const status = async (fn) => { try { await fn(); return 0; } catch (e) { return e.status || 'CRASH:' + e.message; } };
const is = async (fn, ...codes) => codes.includes(await status(fn));
const user = (u, p, role) => auth.userFromToken(auth.login(u, p, role).token);
const msgOf = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };

auth.createUser({ username: 'ct1', password: 'pass1234', name: 'Teacher One', role: 'teacher' });
auth.createUser({ username: 'ct2', password: 'pass1234', name: 'Teacher Two', role: 'teacher' });
const T1 = user('ct1', 'pass1234'), T2 = user('ct2', 'pass1234');
const cls = core.createClass(T1, 'C1'), cls2 = core.createClass(T2, 'C2');
const kid = (c, T, name, roll) => { const s = core.addStudent(T, c.id, { name, roll }); return { ...s, user: user(s.login.username, s.login.pin, 'student') }; };
const a = kid(cls, T1, 'Asha', '1'), b = kid(cls, T1, 'Bela', '2'), z = kid(cls2, T2, 'Zed', '1');
const pa = fam.addParent(T1, a.id, { name: 'Mrs Asha' }), PA = user(pa.login.username, pa.login.password, 'parent');
const pz = fam.addParent(T2, z.id, { name: 'Mrs Zed' }), PZ = user(pz.login.username, pz.login.password, 'parent');
const NUM = '9876543210', NUM2 = '9123456780';

(async () => {
  // ---------- phone checking ----------
  const ok = (v) => { try { return con.normalisePhone(v); } catch (e) { return 'ERR'; } };
  t('numbers are stored as 10 digits: spaces, dashes, +91, 91 and a leading 0 are accepted', ok('98765 43210') === NUM && ok('+91 98765-43210') === NUM && ok('+919876543210') === NUM && ok('919876543210') === NUM && ok('09876543210') === NUM && ok('(98765) 43210') === NUM);
  t('empty means "no number" (clears it)', ok('') === '' && ok(null) === '' && ok('   ') === '');
  t('bad numbers are refused: letters, too short, too long, starts with 1-5, wrong country code', ['abc', '12345', '98765432101', '5876543210', '+44 9876543210', '98765x3210', '+91 98765 4321'].every((v) => ok(v) === 'ERR'));
  t('the error message never repeats the number back', !/9876/.test(msgOf(() => con.normalisePhone('98765432'))) && !/5876543210/.test(msgOf(() => con.normalisePhone('5876543210'))));
  t('masked like 98xxxxx210', con.mask(NUM) === '98xxxxx210');

  // ---------- default OFF ----------
  let m = con.getMine(T1);
  t('default: no number, sharing OFF, safe note says to use in-app messages', m.phone === '' && m.share === false && /in-app messages/.test(m.note));
  t('teacher with no number: parent sees "not shared" and no digits', JSON.stringify(con.forParent(PA, a.id)) .indexOf('"shared":false') > 0 && !/\d{10}/.test(JSON.stringify(con.forParent(PA, a.id))));
  t('parent with no number: teacher sees "not shared"', con.forTeacherStudent(T1, a.id)[0].shared === false);

  // ---------- teacher saves a number but does NOT share ----------
  m = con.putMine(T1, { phone: '+91 98765 43210', preferredTime: 'After 4 pm', language: 'hi' });
  t('teacher saved a number: owner sees it, sharing is still OFF', m.phone === NUM && m.share === false && m.preferredTime === 'After 4 pm' && m.language === 'hi');
  t('number saved but sharing OFF: the parent still sees nothing', con.forParent(PA, a.id).shared === false && !JSON.stringify(con.forParent(PA, a.id)).includes(NUM));
  t('sharing cannot be turned on without a number', await is(() => con.putMine(PA, { share: true }), 400));
  t('share must be a real on/off value', await is(() => con.putMine(T1, { share: 'yes' }), 400));
  t('bad language is 400', await is(() => con.putMine(T1, { language: 'fr' }), 400));
  t('bad number is 400 and nothing is changed', await is(() => con.putMine(T1, { phone: '123' }), 400) && con.getMine(T1).phone === NUM);

  // ---------- teacher shares ----------
  con.putMine(T1, { share: true });
  let v = con.forParent(PA, a.id);
  t('teacher turned sharing ON: the parent of the teacher\'s own student sees number, time and language', v.shared && v.phone === NUM && v.masked === '98xxxxx210' && v.preferredTime === 'After 4 pm' && v.language === 'hi' && v.teacherName === 'Teacher One');
  t('a parent of ANOTHER class (another teacher) never gets this teacher\'s number', await is(() => con.forParent(PZ, a.id), 404));
  t('that other parent sees only their own teacher, who shared nothing', con.forParent(PZ, z.id).shared === false);
  t('a teacher cannot call the parent endpoint (403)', await is(() => con.forParent(T1, a.id), 403));

  // ---------- parent number: hidden until the parent agrees ----------
  con.putMine(PA, { phone: NUM2, preferredTime: 'Evenings' });
  t('parent saved a number but did not share: teacher sees nothing', con.forTeacherStudent(T1, a.id)[0].shared === false && !JSON.stringify(con.forTeacherClass(T1, cls.id)).includes(NUM2));
  con.putMine(PA, { share: true });
  const tp = con.forTeacherStudent(T1, a.id)[0];
  t('parent turned sharing ON: teacher sees number, masked form and time', tp.shared && tp.phone === NUM2 && tp.masked === '91xxxxx780' && tp.preferredTime === 'Evenings' && tp.name === 'Mrs Asha');
  t('class contacts: only the shared parent has a number, other students show "not shared"', (() => { const c = con.forTeacherClass(T1, cls.id).students; return c.find((s) => s.name === 'Asha').parents[0].shared && c.find((s) => s.name === 'Bela').parents.length === 0; })());
  t('family.listParents shows the number only because the parent agreed', fam.listParents(T1, a.id)[0].contact.phone === NUM2);
  con.putMine(PA, { share: false });
  t('switching OFF hides it again at once', con.forTeacherStudent(T1, a.id)[0].shared === false && fam.listParents(T1, a.id)[0].contact.shared === false && !JSON.stringify(fam.listParents(T1, a.id)).includes(NUM2));
  t('the owner still sees their own number after switching OFF', con.getMine(PA).phone === NUM2);
  t('removing the number (empty) while sharing is on is allowed and also hides it', (() => { con.putMine(PA, { share: true }); con.putMine(PA, { phone: '', share: false }); return con.getMine(PA).phone === '' && con.forTeacherStudent(T1, a.id)[0].shared === false; })());

  // ---------- other teachers and other families ----------
  t('another teacher cannot read parents of a student they do not teach (refused) or the class contacts (403)', await is(() => con.forTeacherStudent(T2, a.id), 403, 404) && await is(() => con.forTeacherClass(T2, cls.id), 403));
  con.putMine(PZ, { phone: '9000000001', share: true });
  t('teacher one never sees another family\'s number', !JSON.stringify(con.forTeacherClass(T1, cls.id)).includes('9000000001') && !JSON.stringify(fam.listParents(T1, a.id)).includes('9000000001'));
  t('a parent cannot read the class contacts list (teacher only, via the route guard role)', (() => { try { return con.forTeacherClass(PA, cls.id); } catch (e) { return e.status; } })() === 403);

  // ---------- students never get numbers ----------
  t('a student cannot open or change contact details (403)', await is(() => con.getMine(a.user), 403) && await is(() => con.putMine(a.user, { phone: NUM }), 403) && await is(() => con.forParent(a.user, a.id), 403));
  t('student home data and login info never contain a phone number', !JSON.stringify(core.studentHomeById(a.id)).includes(NUM) && !JSON.stringify(auth.publicUser(a.user)).match(/\d{10}/));

  // ---------- teacher enters the parent number when making the login ----------
  const before = db.get('SELECT COUNT(*) AS n FROM users').n;
  t('a bad parent number refuses the whole login (nothing is created)', await is(() => fam.addParent(T1, b.id, { name: 'Mr Bela', phone: '555' }), 400) && db.get('SELECT COUNT(*) AS n FROM users').n === before);
  const pb = fam.addParent(T1, b.id, { name: 'Mr Bela', phone: '+91 91234 56780' }); const PB = user(pb.login.username, pb.login.password, 'parent');
  t('parent number typed by the teacher is stored but hidden (the parent controls the switch)', fam.listParents(T1, b.id)[0].contact.shared === false && con.getMine(PB).phone === NUM2 && con.getMine(PB).share === false);
  con.putMine(PB, { share: true });
  t('after the parent agrees, the teacher sees it', fam.listParents(T1, b.id)[0].contact.phone === NUM2);

  // ---------- siblings share one login ----------
  const sib = kid(cls, T1, 'Asha Sister', '3'); fam.addParent(T1, sib.id, { linkUsername: pa.login.username });
  con.putMine(PA, { phone: NUM2, share: true });
  t('one parent login for two children: the teacher sees the same shared number for both', con.forTeacherStudent(T1, sib.id)[0].phone === NUM2 && con.forParent(PA, sib.id).teacherName === 'Teacher One');

  // ---------- plain text only, short ----------
  con.putMine(T1, { preferredTime: '<b>5 pm</b>   to    6 pm' + 'x'.repeat(100) });
  const pt = con.getMine(T1).preferredTime;
  t('preferred time is plain text: no < or >, spaces tidied, at most 60 letters', !/[<>]/.test(pt) && pt.length <= 60 && !/\s{2,}/.test(pt), pt);

  // ---------- never in reports, CSV, notifications ----------
  con.putMine(T1, { phone: NUM, share: true });
  const blob = JSON.stringify([rep.getReport(T1, a.id, {}), rep.getReport(PA, a.id, {}), rep.getReport(a.user, a.id, {}), rep.classReports(T1, cls.id, {}), rep.classCsv(T1, cls.id, {}), rep.classCharts(T1, cls.id, {})]);
  t('numbers never appear in report cards, class reports, CSV or class charts (so never printed)', !blob.includes(NUM) && !blob.includes(NUM2) && !/9000000001/.test(blob));
  const notes = JSON.stringify([notify.list(PA, {}), notify.list(T1, {}), notify.list(a.user, {})]);
  t('numbers never appear in notifications', !notes.includes(NUM) && !notes.includes(NUM2));
  const logged = [];
  const oldLog = console.log, oldErr = console.error; console.log = (...s) => logged.push(s.join(' ')); console.error = (...s) => logged.push(s.join(' '));
  try { con.putMine(T1, { phone: '+91 98765 43210' }); con.putMine(PA, { phone: NUM2 }); try { con.putMine(PA, { phone: '12345' }); } catch (e) {} } finally { console.log = oldLog; console.error = oldErr; }
  t('saving numbers writes nothing to the log', logged.join('\n') === '' || !/\d{10}/.test(logged.join('\n')), logged.join('|'));
  t('only digits are stored in the database', db.all('SELECT phone FROM contact_prefs WHERE phone IS NOT NULL').every((r) => /^\d{10}$/.test(r.phone)));
  t('removing a parent login removes the stored number too', (() => { fam.unlinkParent(T1, b.id, pb.userId); return !db.get('SELECT 1 FROM contact_prefs WHERE user_id = ?', [pb.userId]); })());

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
