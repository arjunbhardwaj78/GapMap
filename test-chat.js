// Milestone 12 Hindi step 2 tests: parent chat guard. No internet, no real AI.
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
const chat = require('./services/chat');
const pa = mkp(T1, arjun, 'Arjun Parent'), pz = mkp(T2, zed, 'Zed Parent');
const ok = { configured: () => true };
const ask = (u, id, q, reply, lang = 'en') => chat.chatFor(u, id, { question: q, lang }, { ...ok, generate: async () => (typeof reply === 'function' ? reply() : reply) });
(async () => {
  const facts = sum.factsFor(db.get('SELECT s.*, c.name AS class_name FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=?', [arjun.id]), today);
  let r = await ask(pa.user, arjun.id, 'How is he doing?', { reply: 'Arjun is doing fine. Please ask the teacher for more.' });
  t('a clean AI reply is used', r.source === 'ai' && r.reply.includes('fine'), JSON.stringify(r).slice(0, 200));
  r = await ask(pa.user, arjun.id, 'Marks?', { reply: 'He scored 9999 marks.' });
  t('a number not in the records is rejected', r.source === 'summary' && /number/.test(r.note), r.note);
  r = await ask(pa.user, arjun.id, 'Marks?', { reply: 'Priya did better than him.' });
  t('another child\'s name is rejected', r.source === 'summary' && /names someone/.test(r.note), r.note);
  r = await ask(pa.user, arjun.id, 'x', { reply: 'See https://example.com now.' });
  t('a link is rejected', r.source === 'summary', r.note);
  r = await ask(pa.user, arjun.id, 'x', { reply: 'Call 9876543210.' });
  t('a phone number is rejected', r.source === 'summary', r.note);
  r = await ask(pa.user, arjun.id, 'x', async () => { throw new Error('down'); });
  t('AI failure falls back to the fixed summary', r.source === 'summary');
  r = await chat.chatFor(pa.user, arjun.id, { question: 'hi', lang: 'en' }, { configured: () => false });
  t('no AI configured falls back safely', r.source === 'summary');
  t('fallback never holds another child\'s name', !/Priya|Meena|Zed/.test(r.reply));
  let e = 0; try { await chat.chatFor(pa.user, zed.id, { question: 'hi' }, ok); } catch (x2) { e = x2.status; }
  t('a parent cannot ask about another parent\'s child (404)', e === 404, e);
  e = 0; try { await chat.chatFor(T1, arjun.id, { question: 'hi' }, ok); } catch (x2) { e = x2.status; }
  t('teachers cannot use parent chat (403)', e === 403, e);
  e = 0; try { await chat.chatFor(pa.user, arjun.id, { question: 'hi', lang: 'fr' }, ok); } catch (x2) { e = x2.status; }
  t('bad language is 400', e === 400, e);
  e = 0; try { await chat.chatFor(pa.user, arjun.id, { question: '  ' }, ok); } catch (x2) { e = x2.status; }
  t('empty question is 400', e === 400, e);
  db.run('DELETE FROM chat_use');
  for (let i = 0; i < chat.DAILY_LIMIT; i++) await ask(pa.user, arjun.id, 'q', { reply: 'Fine.' });
  e = 0; try { await ask(pa.user, arjun.id, 'q', { reply: 'Fine.' }); } catch (x2) { e = x2.status; }
  t('daily limit gives 429', e === 429, e);
  r = await ask(pz.user, zed.id, 'q', { reply: 'Fine.' });
  t('limit is per parent', r.source === 'ai');
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.stack); process.exit(1); });
