// Smoke test over HTTP. Start the server first (npm start), then in a second window: npm run test:api
// Uses typed answers, so it needs no Gemini key. It creates a throwaway teacher in your local database.
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const t = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (extra || ''))); };
async function call(method, url, body, token) {
  const res = await fetch(BASE + '/api' + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
(async () => {
  const h = await call('GET', '/health');
  t('server is up', h.status === 200, JSON.stringify(h));
  const u = 'tester' + Date.now().toString(36);
  const su = await call('POST', '/auth/signup', { username: u, password: 'test1234', name: 'Test Teacher' });
  t('teacher signup returns a token', su.status === 200 && su.data.token, JSON.stringify(su));
  const T = su.data.token;
  t('no token -> 401', (await call('GET', '/classes')).status === 401);
  const cls = await call('POST', '/classes', { name: 'Test class' }, T);
  const st = await call('POST', `/classes/${cls.data.id}/students`, { name: 'Roll 01', roll: '1' }, T);
  t('student created with PIN', /^\d{4}$/.test(st.data.login?.pin), JSON.stringify(st));
  const pre = await call('GET', '/presets', null, T);
  const asm = await call('POST', `/classes/${cls.data.id}/assessments`, { title: 'Fractions check', expressions: pre.data[0].expressions }, T);
  const answers = { Q1: '2/5', Q2: '3/10', Q3: '4/10', Q4: '1/2', Q5: '5/8', Q6: '1/2', Q7: '2/5' };
  const sub = await call('POST', `/assessments/${asm.data.id}/typed`, { studentId: st.data.id, answers }, T);
  t('typed answers analysed', sub.status === 200 && sub.data.result?.marks === 4, JSON.stringify(sub.data).slice(0, 200));
  const rep = await call('GET', `/assessments/${asm.data.id}/report`, null, T);
  const g = rep.data.groups?.[0];
  t('report has a plain-language group', g && !/\bM\d/.test(g.name), JSON.stringify(rep.data.groups));
  const kit = await call('POST', `/assessments/${asm.data.id}/kit`, { signature: g.signature }, T);
  t('remedial kit has practice questions', kit.data.samplePractice?.length === 5, JSON.stringify(kit.data).slice(0, 200));
  const asg = await call('POST', `/assessments/${asm.data.id}/practice/assign`, { signature: g.signature }, T);
  t('practice assigned', asg.data.assigned === 1, JSON.stringify(asg.data));
  const sl = await call('POST', '/auth/login', { username: st.data.login.username, password: st.data.login.pin, role: 'student' });
  t('student can sign in with the PIN', sl.status === 200, JSON.stringify(sl.data));
  const home = await call('GET', '/student/home', null, sl.data.token);
  t('student home shows marks and practice', home.data.results?.[0]?.marks === 4 && home.data.practice?.length === 1, JSON.stringify(home.data).slice(0, 200));
  t('student cannot call teacher routes', (await call('GET', '/classes', null, sl.data.token)).status === 403);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Could not reach the server. Is "npm start" running?', e.message); process.exit(1); });
