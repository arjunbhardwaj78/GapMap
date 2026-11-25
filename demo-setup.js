// One-time demo setup for the video. Start the app first (npm start), then run:  node demo-setup.js
// It creates a demo teacher, loads the labelled sample class, adds a parent, and prints all three logins.
const BASE = process.env.BASE || 'http://localhost:3000';
async function api(method, path, body, token) {
  const res = await fetch(BASE + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}
(async () => {
  const teacher = { username: 'demoteacher', password: 'pass1234', name: 'Demo Teacher' };
  let t;
  try { t = await api('POST', '/auth/signup', teacher); }
  catch (e) { t = await api('POST', '/auth/login', { username: teacher.username, password: teacher.password, role: 'teacher' }); console.log('(teacher already existed, signed in instead)'); }
  const sample = await api('POST', '/samples/class', {}, t.token);
  const stu = sample.students[0];
  const report = await api('GET', `/assessments/${sample.assessmentId}/report`, null, t.token);
  const parent = await api('POST', `/students/${report.students[0].id}/parents`, { name: 'Demo Parent' }, t.token);
  console.log('\nOpen ' + BASE + '\n');
  console.log('TEACHER  username: ' + teacher.username + '   password: ' + teacher.password);
  console.log('STUDENT  username: ' + stu.login.username + '   PIN: ' + stu.login.pin + '   (Sample 1)');
  console.log('PARENT   username: ' + parent.login.username + '   password: ' + parent.login.password + '   (parent of Sample 1)');
  console.log('\nThe sample class is labelled "demo data" in the app. Run this script only once.');
})().catch((e) => { console.error('Setup failed:', e.message); process.exit(1); });
