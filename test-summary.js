// Milestone 12 Hindi step 1 tests: parent summary (Hindi / Roman Hindi / English) from fixed templates. No internet, no AI, no API key.
process.env.DATABASE_PATH = ':memory:';
delete process.env.GEMINI_API_KEY; delete process.env.OPENROUTER_API_KEY;
const fs = require('fs');
const auth = require('./services/auth');
const core = require('./services/core');
const x = require('./services/extras');
const fam = require('./services/family');
const rep = require('./services/reports');
const alerts = require('./services/alerts');
const con = require('./services/contacts');
const sum = require('./services/summary');
const hindi = require('./services/hindi');
const db = require('./database/db');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
const status = (fn) => { try { fn(); return 0; } catch (e) { return e.status || 'CRASH:' + e.message; } };
const is = (fn, ...codes) => codes.includes(status(fn));
const user = (u, p, role) => auth.userFromToken(auth.login(u, p, role).token);
const today = x.todayIst(), D = (n) => x.addDays(today, n);
const monthStart = today.slice(0, 8) + '01', prevStart = x.addDays(monthStart, -1).slice(0, 8) + '01';
const dd = (start, i) => start.slice(0, 8) + String(i).padStart(2, '0');

auth.createUser({ username: 'st1', password: 'pass1234', name: 'Teacher One', role: 'teacher' });
auth.createUser({ username: 'st2', password: 'pass1234', name: 'Teacher Two', role: 'teacher' });
const T1 = user('st1', 'pass1234'), T2 = user('st2', 'pass1234');
const cls = core.createClass(T1, 'C1'), cls2 = core.createClass(T2, 'C2'), cls3 = core.createClass(T1, 'C3 empty');
const kid = (c, T, name, roll) => { const s = core.addStudent(T, c.id, { name, roll }); return { ...s, user: user(s.login.username, s.login.pin, 'student') }; };
const arjun = kid(cls, T1, 'Arjun', '1'), priya = kid(cls, T1, 'Priya', '2'), meena = kid(cls, T1, 'Meena', '3'), empty = kid(cls3, T1, 'Nikhil', '4'), zed = kid(cls2, T2, 'Zed', '1');
const mkp = (T, s, name) => { const p = fam.addParent(T, s.id, { name }); return { ...p, user: user(p.login.username, p.login.password, 'parent') }; };
const pA = mkp(T1, arjun, 'Mr Arjun'); fam.addParent(T1, priya.id, { linkUsername: pA.login.username });   // one login, two children
const pM = mkp(T1, meena, 'Mrs Meena'), pE = mkp(T1, empty, 'Mr Nikhil'), pZ = mkp(T2, zed, 'Mrs Zed');
const att = (c, sid, day, st) => db.run('INSERT OR REPLACE INTO attendance (class_id, student_id, day, status) VALUES (?,?,?,?)', [c.id, sid, day, st]);
let asm = 0;
function result(c, sid, marks, total, daysAgo, title) {
  const a = core.createAssessment(T1, c.id, { title: title || 'Test ' + (++asm), kind: 'test', expressions: ['1/2+1/3'] });
  db.run('UPDATE assessments SET created_at = ? WHERE id = ?', [D(-daysAgo) + ' 09:00:00', a.id]);
  db.run('INSERT INTO submissions (assessment_id, student_id, status, result_json, created_at) VALUES (?,?,?,?,?)', [a.id, sid, 'final', JSON.stringify({ marks, total }), D(-daysAgo) + ' 10:00:00']);
}
function homework(c, title, due, doneBy) {
  const a = core.createAssessment(T1, c.id, { title, kind: 'homework', due, expressions: ['1/2+1/3'] });
  (Array.isArray(doneBy) ? doneBy : []).forEach((sid) => db.run('INSERT INTO submissions (assessment_id, student_id, status, result_json, created_at) VALUES (?,?,?,?,?)', [a.id, sid, 'final', JSON.stringify({ marks: 5, total: 5 }), today + ' 10:00:00']));
  return a.id;
}
const NUM = /\d+(?:\.\d+)?/g;
const DEV = /[\u0900-\u097F]/;

// Arjun: this month 9 present + 1 absent = 90%; last month 4 present + 6 absent, so overall = 13/20 = 65% (below the 75% line)
for (let i = 1; i <= 9; i++) att(cls, arjun.id, dd(monthStart, i), 'present'); att(cls, arjun.id, dd(monthStart, 10), 'absent');
for (let i = 1; i <= 4; i++) att(cls, arjun.id, dd(prevStart, i), 'present'); for (let i = 5; i <= 10; i++) att(cls, arjun.id, dd(prevStart, i), 'absent');
[[5, 10, 40, 'Fractions A'], [6, 10, 30, 'Fractions B'], [7, 10, 20, 'Decimals <b>C</b> & D'], [8, 10, 10, 'Algebra E']].forEach(([m, tot, d, title]) => result(cls, arjun.id, m, tot, d, title));
homework(cls, 'Chapter 4 sums', D(3), []);                 // due soon, not handed in: listed
homework(cls, 'Handed in already', D(2), [arjun.id]);      // done: not listed
homework(cls, 'Far away', D(20), []);                      // outside 7 days: not listed
// Priya: different numbers, so we can see the cards are not mixed
for (let i = 1; i <= 5; i++) att(cls, priya.id, dd(monthStart, i), 'present'); att(cls, priya.id, dd(monthStart, 6), 'late');
result(cls, priya.id, 9, 10, 5, 'Priya Test');
// Meena: full attendance this month -> good news
for (let i = 1; i <= 6; i++) att(cls, meena.id, dd(monthStart, i), 'present');

const get = (user, id, lang) => sum.summaryFor(user, id, lang ? { lang } : {});
(async () => {
  // ---------- numbers equal the report/attendance numbers ----------
  const A = get(pA.user, arjun.id, 'hi'), n = A.numbers;
  const r = rep.reportFor(arjun.id, alerts.settingsFor(cls.id).yearStart, today), af = fam.attendanceFor(arjun.id);
  t('attendance numbers come from attendanceFor: overall 65%, this month 90%', n.attendance.overall.pct === af.pct && af.pct === 65 && n.attendance.month.pct === 90 && n.attendance.month.counted === 10, JSON.stringify(n.attendance));
  t('test numbers come from reportFor: average equals perType.test.pct (65), latest 3 are the last three results', n.tests.avgPct === r.perType.test.pct && n.tests.avgPct === 65 && n.tests.latest.map((q) => q.marks).join() === '6,7,8', JSON.stringify(n.tests));
  t('homework: only not-handed-in tasks due in the next 7 days (1), not the done one, not the one 20 days away', n.homework.dueCount === 1 && n.homework.due[0] === 'Chapter 4 sums' && n.homework.windowDays === 7);
  t('the Hindi text says those same numbers: 90%, 65%, 8 में से 10, the homework title', /90%/.test(A.text) && /65%/.test(A.text) && /10 में से 8 अंक \(80%\)/.test(A.text) && A.text.includes('Chapter 4 sums') && A.text.includes('1 गृहकार्य'));
  const allowed = new Set([n.attendance.overall.pct, n.attendance.month.pct, n.tests.avgPct, n.homework.dueCount, n.homework.windowDays, ...n.tests.latest.flatMap((q) => [q.marks, q.total, q.pct])].map(String));
  for (const lang of ['hi', 'hinglish', 'en']) {
    const S = get(pA.user, arjun.id, lang);
    const nums = (S.text.replace(/Chapter 4 sums|Fractions [AB]|Decimals <b>C<\/b> & D|Algebra E/g, '').match(NUM) || []);
    t(`${lang}: every number in the text is a number from the facts (no invented number)`, nums.every((v) => allowed.has(v)) && nums.length >= 8, nums.join());
  }

  // ---------- language and style ----------
  const HI = get(pA.user, arjun.id, 'hi'), HG = get(pA.user, arjun.id, 'hinglish'), EN = get(pA.user, arjun.id, 'en'), DEF = get(pA.user, arjun.id);
  t('default language is Hindi (Devanagari)', DEF.lang === 'hi' && DEV.test(DEF.text));
  t('Hindi uses Devanagari and keeps the name exactly as stored (Arjun, not translated)', DEV.test(HI.text) && HI.text.includes('आपके बच्चे Arjun की उपस्थिति इस महीने 90% रही।'));
  t('Roman Hindi has no Devanagari and starts like speech: "aapke bacche Arjun ki attendance"', !DEV.test(HG.text) && /Aapke bacche Arjun ki attendance is mahine 90% rahi/.test(HG.text));
  t('English version has no Devanagari', !DEV.test(EN.text) && /Arjun's attendance this month is 90%/.test(EN.text));
  const words = HI.text.split(/\s+/).length;
  t('Hindi summary is about one minute of reading (60 to 170 words)', words >= 60 && words <= 170, words);
  t('teacher-written titles go in unchanged (even with < > &), never translated', HI.text.includes('Decimals <b>C</b> & D में 10 में से 7 अंक (70%)') && EN.text.includes('Decimals <b>C</b> & D: 7 out of 10'));
  t('wrong language is 400', is(() => get(pA.user, arjun.id, 'fr'), 400));
  t('no "null", "undefined" or "NaN" in any summary', ['hi', 'hinglish', 'en'].every((l) => !/null|undefined|NaN/.test(get(pA.user, arjun.id, l).text)));
  t('the summary has a kind closing line', /धन्यवाद/.test(HI.text) && /Dhanyavaad/.test(HG.text) && /Thank you/.test(EN.text));

  // ---------- good news and "may need support" lines ----------
  t('Arjun: overall attendance 65% is below the line, so ONE soft support line appears (may need support, with 65%)', HI.numbers.support === 'attendance' && /उपस्थिति में सहायता की ज़रूरत हो सकती है \(अब तक 65%\)/.test(HI.text) && /may need support \(65% so far\)/.test(EN.text));
  t('wording is soft: no verdict words in any language', !/कमज़ोर|फेल|नालायक|weak|failing|failed|lazy|bad student|kamzor/i.test(HI.text + HG.text + EN.text));
  t('Arjun: no good-news line because none is true', HI.numbers.good === null && !/अच्छी खबर/.test(HI.text));
  const M = get(pM.user, meena.id, 'hi');
  t('Meena: full attendance this month gives a good-news line and no support line', M.numbers.good === 'attendance' && /अच्छी खबर: इस महीने उपस्थिति पूरी रही/.test(M.text) && M.numbers.support === null && !/ध्यान देने की बात/.test(M.text));
  const hwKid = kid(cls, T1, 'Hema', '9'); const pH = mkp(T1, hwKid, 'Mrs Hema');
  homework(cls, 'Old A', D(-9), [hwKid.id]); homework(cls, 'Old B', D(-8), [hwKid.id]);
  const H = get(pH.user, hwKid.id, 'en');
  t('all homework handed in gives a homework good-news line', H.numbers.good === 'homework' && /all homework so far has been handed in/.test(H.text), H.numbers.good);
  const sendLog = db.run("INSERT INTO alert_log (class_id, student_id, type, numbers_json, severity, text, status, sent_on) VALUES (?,?,?,?,?,?,?,?)", [cls.id, meena.id, 'performance_drop', '{}', 1, 'x', 'new', today]);
  t('an open alert (a line that was crossed) gives the matching soft line; a done alert does not', get(pM.user, meena.id, 'en').numbers.support === 'marks' && /overall marks may need support/.test(get(pM.user, meena.id, 'en').text) && (db.run("UPDATE alert_log SET status = 'done' WHERE id = ?", [Number(sendLog.lastInsertRowid)]), get(pM.user, meena.id, 'en').numbers.support === null));

  // ---------- a child with no data ----------
  const E = get(pE.user, empty.id, 'hi');
  t('a child with no data: honest "not yet" lines, no invented number, no support line', /अभी दर्ज नहीं हुई/.test(E.text) && /अभी कोई टेस्ट या क्विज़ का परिणाम नहीं आया/.test(E.text) && /कोई गृहकार्य देय नहीं/.test(E.text) && E.numbers.support === null && !/\d%/.test(E.text), E.text);

  // ---------- two children, one login ----------
  const ALL = sum.summaryAll(pA.user, { lang: 'hi' });
  t('a parent with two children gets one card per child, each with its own name', ALL.children.length === 2 && ALL.children.map((c) => c.child.name).sort().join() === 'Arjun,Priya');
  const P = ALL.children.find((c) => c.child.name === 'Priya'), AJ = ALL.children.find((c) => c.child.name === 'Arjun');
  t('the two cards do not mix: Priya has her own numbers and never mentions Arjun (and the reverse)', !P.text.includes('Arjun') && !AJ.text.includes('Priya') && P.numbers.attendance.month.pct === 100 && P.numbers.tests.avgPct === 90 && /90%/.test(P.text));
  t('summaryAll with no children linked returns an empty list, not an error', (() => { const lone = auth.createUser({ username: 'lonep', password: 'pass1234', name: 'Lone', role: 'parent' }); return sum.summaryAll(user('lonep', 'pass1234', 'parent'), {}).children.length === 0; })());

  // ---------- privacy ----------
  t('another family gets 404 for this child; a parent of another class too', is(() => get(pM.user, arjun.id, 'hi'), 404) && is(() => get(pZ.user, arjun.id, 'hi'), 404) && is(() => get(pA.user, zed.id, 'hi'), 404));
  t('a student gets 403 and a teacher gets 403', is(() => get(arjun.user, arjun.id, 'hi'), 403) && is(() => get(T1, arjun.id, 'hi'), 403) && is(() => sum.summaryAll(arjun.user, {}), 403) && is(() => sum.summaryAll(T1, {}), 403));
  con.putMine(T1, { phone: '9876543210', share: true }); con.putMine(pA.user, { phone: '9123456780', share: true });
  const blob = JSON.stringify([sum.summaryAll(pA.user, { lang: 'hi' }), get(pA.user, arjun.id, 'hinglish'), get(pA.user, arjun.id, 'en')]);
  t('no summary contains a phone number (10 digits) or either saved number', !/\d{10}/.test(blob) && !blob.includes('9876543210') && !blob.includes('9123456780'));
  t('no password, username or other family name in the summary', !/pass1234|parent-|Mrs Meena|Mrs Zed|Meena|Zed|Nikhil/.test(blob));
  const texts = JSON.stringify([sum.summaryAll(pA.user, { lang: 'hi' }).children.map((c) => c.text), get(pA.user, arjun.id, 'hinglish').text, get(pA.user, arjun.id, 'en').text]);
  t('the summary text never names the teacher or the class', !/Teacher One|C1/.test(texts));

  // ---------- needs no AI ----------
  const src = fs.readFileSync('./services/summary.js', 'utf8') + fs.readFileSync('./services/hindi.js', 'utf8');
  t('works with no API key: the summary code does not use Gemini or OpenRouter or any network', !/gemini|openrouter|fetch\(|https?:\/\//i.test(src.replace(/\/\/.*$/gm, '')));
  t('summary does not change any data (same call twice, same answer)', JSON.stringify(get(pA.user, arjun.id, 'hi').lines) === JSON.stringify(get(pA.user, arjun.id, 'hi').lines));
  t('hindi.summary refuses an unknown language instead of guessing', (() => { try { hindi.summary({}, 'xx'); return false; } catch (e) { return true; } })());

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
