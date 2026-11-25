/* GapMap frontend. Plain JavaScript, no build step. All text from the server is added with
   textContent (never innerHTML), so student names cannot inject code. */
(() => {
'use strict';

// ---------- tiny helpers ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return el;
}
const ICONS = {
  teacher: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18v11H3z"/><path d="M8 20h8M12 16v4"/><path d="M7 10h6M7 13h9"/></svg>',
  student: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v15H5.5C4.7 19 4 18.3 4 17.5z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v15h5.5c.8 0 1.5-.7 1.5-1.5z"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.5 0 4 1.6 4 4.5"/></svg>',
  test: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9M10 19V5M16 19v-8M22 19H2"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  type: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5h16v2M12 5v14M9 19h6"/></svg>',
  report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  parent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="7" r="3"/><circle cx="17" cy="10" r="2.2"/><path d="M2.5 20c0-3.4 2.5-5.6 5.5-5.6s5.5 2.2 5.5 5.6"/><path d="M14.5 20c.2-2.2 1.4-3.6 3.5-3.6 1.6 0 2.8.9 3.5 3.6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17M8 14.5l2 2 4-4"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 4v8l6 4"/></svg>',
};
const icon = (name) => { const t = document.createElement('template'); t.innerHTML = ICONS[name]; return t.content.firstChild; };
const logo = () => { const t = document.createElement('template'); t.innerHTML = '<svg viewBox="0 0 40 40" fill="none"><rect width="40" height="40" rx="11" fill="#2E8B8B"/><path d="M6 27c5-6 9 2 14-4s9-1 14-7" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M6 20c5-6 9 2 14-4s9-1 14-7" stroke="#B8E2DF" stroke-width="2.4" stroke-linecap="round"/><circle cx="26" cy="22" r="3.6" fill="#F2B94F"/></svg>'; return t.content.firstChild; };

const state = { token: sessionStorage.getItem('gm_token'), user: JSON.parse(sessionStorage.getItem('gm_user') || 'null'), health: null };
const $app = document.getElementById('app');

async function api(method, url, body, isForm) {
  const opts = { method, headers: {} };
  if (state.token) opts.headers.Authorization = 'Bearer ' + state.token;
  if (body && !isForm) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  if (isForm) opts.body = body;
  let res;
  try { res = await fetch('/api' + url, opts); } catch (e) { throw new Error('Cannot reach the server. Is it running?'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { signOut(true); throw new Error('Please sign in again.'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  if (data && typeof data.notifiedText === 'string' && method !== 'GET') toast(data.notifiedText);   // teacher sees who was told, automatically
  return data;
}

function toast(msg, kind) {
  const el = h('div', { class: 'toast ' + (kind || '') }, msg);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 3600);
}

// ---------- modal ----------
let closeCurrentModal = null;
function modal({ title, body, actions = [], onClose }) {
  const root = document.getElementById('modal-root');
  const prevFocus = document.activeElement;
  const panel = h('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', {}, title), body);
  const acts = h('div', { class: 'actions' }, actions.map((a) => h('button', { class: 'btn ' + (a.color || 'ghost'), type: 'button', onclick: () => a.onclick(close) }, a.label)));
  panel.append(acts);
  const back = h('div', { class: 'back', onmousedown: (e) => { if (e.target === back && !modal.locked) close(); } }, panel);
  root.append(back);
  function close() { back.remove(); document.removeEventListener('keydown', onKey); closeCurrentModal = null; if (onClose) onClose(); if (prevFocus && prevFocus.focus) prevFocus.focus(); }
  function onKey(e) { if (e.key === 'Escape' && !modal.locked) close(); }
  document.addEventListener('keydown', onKey);
  closeCurrentModal = close;
  setTimeout(() => (panel.querySelector('input,textarea,button') || panel).focus(), 30);
  return { close, panel };
}
function busy(text) {
  const m = modal({ title: text, body: h('div', {}, h('div', { class: 'loader' }, h('i'), h('i'), h('i'), h('i')), h('p', { class: 'muted', style: 'text-align:center' }, 'This can take a few seconds.')) });
  modal.locked = true;
  return () => { modal.locked = false; m.close(); };
}
function errorBox(msg) { return msg ? h('div', { class: 'err', role: 'alert' }, msg) : null; }

// ---------- layout ----------
function btn(label, color, onclick, extra) { return h('button', { class: 'btn ' + (color || '') + (extra ? ' ' + extra : ''), type: 'button', onclick }, label); }
function link(label, href, color, extra) { return h('a', { class: 'btn ' + (color || '') + (extra ? ' ' + extra : ''), href }, label); }
function page(crumbs, ...content) {
  document.body.classList.remove('intro', 'auth-page');
  const trail = h('nav', { class: 'crumbs', 'aria-label': 'Where you are' });
  (crumbs || []).forEach((c, i) => {
    if (i) trail.append(h('span', { class: 'sep' }, '/'));
    trail.append(c.href ? h('a', { href: c.href }, c.label) : h('span', {}, c.label));
  });
  const bar = h('header', { class: 'topbar' }, h('a', { class: 'brand', href: '#/' }, logo(), 'GapMap'), trail,
    state.user ? h('div', { class: 'who' }, window.GM.bell ? window.GM.bell() : null, h('span', {}, state.user.name), state.user.role === 'student' ? btn('Change PIN', 'ghost', changePinModal, 'small') : null, state.user.role === 'parent' ? btn('Change password', 'ghost', () => window.GM.changePasswordModal && window.GM.changePasswordModal(), 'small') : null, btn('Sign out', 'ghost', () => signOut(), 'small')) : null);
  $app.replaceChildren(bar, h('main', { class: 'wrap' }, content));
  window.scrollTo(0, 0);
}
const head = (title, sub, right) => h('div', { class: 'head' }, h('div', {}, h('h1', {}, title), sub ? h('p', { class: 'muted' }, sub) : null), right || null);
const steps = (n, total) => h('div', { class: 'stepper', role: 'img', 'aria-label': `Step ${n} of ${total}` }, Array.from({ length: total }, (_, i) => h('i', { class: i < n ? 'on' : '' })));
const empty = (title, text, action) => h('div', { class: 'slab empty' }, h('h3', {}, title), h('p', { class: 'muted' }, text), action || null);
const loading = () => $app.replaceChildren(h('div', { class: 'landing' }, h('div', { class: 'loader' }, h('i'), h('i'), h('i'), h('i'))));
const qlist = (qs) => qs.map((q) => 'Q' + q).join(', ');

function signOut(expired) {
  if (state.token && !expired) api('POST', '/auth/logout').catch(() => {});
  state.token = null; state.user = null; sessionStorage.clear();
  location.hash = '#/login';
}

const homeOf = (u) => (u && u.role === 'student' ? '#/s' : u && u.role === 'parent' ? '#/p' : '#/t');

// ---------- screens: sign in ----------
function roleScreen() {
  document.body.classList.add('intro'); document.body.classList.remove('auth-page');
  const roleCard = (role, color, title, text) => {
    const el = h('a', { class: 'tile role ' + color, href: '#/login/' + role }, h('div', { class: 'ico ' + color }, icon(role)), h('div', {}, h('h2', {}, title), h('p', { class: 'muted' }, text)), h('span', { class: 'go', 'aria-hidden': 'true' }, '→'));
    el.addEventListener('pointermove', (e) => { const r = el.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; el.style.transform = `rotateY(${x * 7}deg) rotateX(${-y * 7}deg) translateY(-3px)`; });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    return el;
  };
  const opt = (l, t, cls) => h('div', { class: 'o ' + (cls || '') }, h('b', {}, l), t);
  $app.replaceChildren(h('div', { class: 'hero' }, h('div', { class: 'bg3d', id: 'bg3d', 'aria-hidden': 'true' }), h('div', { class: 'hero-grid' },
    h('div', {},
      h('div', { class: 'brand' }, logo(), 'GapMap'),
      h('div', { class: 'eyebrow' }, h('i'), 'Mistakes, explained'),
      h('h1', {}, 'Every wrong answer has a ', h('span', { class: 'hl' }, 'reason.')),
      h('p', { class: 'hi-line', lang: 'hi' }, 'हर गलत जवाब के पीछे एक वजह होती है।'),
      h('p', { class: 'muted lead' }, 'GapMap shows teachers which mistaken idea sits behind a wrong answer, which students share it, and what to practise next. The computer marks. The evidence comes first.'),
      h('div', { class: 'demo', 'aria-hidden': 'true' }, h('div', { class: 'float f1' }), h('div', { class: 'float f2' }),
        h('div', { class: 'slab' }, h('div', { class: 'q' }, 'Which part of the cell makes energy?'),
          opt('A', 'Nucleus', 'pick'), opt('B', 'Mitochondria'),
          h('div', { class: 'tag' }, h('span', { class: 'chip plum' }, 'Thinks the nucleus does every job'), h('span', { class: 'chip sun' }, 'Likely: 5 students share this')))),
      h('div', { class: 'trust' }, h('span', { class: 'chip' }, 'Hindi + English'), h('span', { class: 'chip' }, 'Code marks, not AI'), h('span', { class: 'chip' }, 'Works on a phone'))),
    h('div', { class: 'pick-panel' }, h('div', { class: 'ask' }, 'Welcome'), h('h2', {}, 'Who are you?'),
      h('div', { class: 'roles' },
        roleCard('teacher', 'blue', 'I am a teacher', 'Check answer sheets and see which mistakes are shared by which students.'),
        roleCard('student', 'leaf', 'I am a student', 'See your marks, your practice, and what to work on next.'),
        roleCard('parent', 'plum', 'I am a parent', "Your child's progress, attendance and notices, in Hindi too."))))));
  const bg = document.getElementById('bg3d'); if (bg && window.SetuScene) window.SetuScene.mount(bg, { variant: 'full' });
}

function loginScreen(role) {
  let mode = 'in';
  const box = h('div');
  function draw(error) {
    const user = h('input', { id: 'u', autocomplete: 'username', required: true });
    const pass = h('input', { id: 'p', type: 'password', autocomplete: mode === 'in' ? 'current-password' : 'new-password', required: true });
    const name = h('input', { id: 'n', autocomplete: 'name' });
    const form = h('form', { novalidate: true },
      errorBox(error),
      mode === 'up' ? h('div', { class: 'field' }, h('label', { for: 'n' }, 'Your name'), name) : null,
      h('div', { class: 'field' }, h('label', { for: 'u' }, 'Username'), user),
      h('div', { class: 'field' }, h('label', { for: 'p' }, role === 'student' ? 'PIN' : 'Password'), h('div', { class: 'pwrap' }, pass, h('button', { type: 'button', 'aria-label': 'Show or hide the password', onclick: (e) => { const show = pass.type === 'password'; pass.type = show ? 'text' : 'password'; e.target.textContent = show ? 'Hide' : 'Show'; } }, 'Show'))),
      h('button', { class: 'btn big ' + (role === 'student' ? 'leaf' : role === 'parent' ? 'plum' : ''), type: 'submit', style: 'width:100%' }, mode === 'in' ? 'Sign in' : 'Create account'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const out = mode === 'in'
          ? await api('POST', '/auth/login', { username: user.value, password: pass.value, role })
          : await api('POST', '/auth/signup', { username: user.value, password: pass.value, name: name.value });
        state.token = out.token; state.user = out.user;
        sessionStorage.setItem('gm_token', out.token); sessionStorage.setItem('gm_user', JSON.stringify(out.user));
        location.hash = homeOf(out.user);
      } catch (err) { draw(err.message); }
    });
    box.replaceChildren(form,
      role === 'teacher' ? h('p', { class: 'small muted', style: 'margin-top:18px;text-align:center' }, mode === 'in' ? 'New here? ' : 'Already have an account? ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); mode = mode === 'in' ? 'up' : 'in'; draw(); } }, mode === 'in' ? 'Create a teacher account' : 'Sign in'))
      : h('p', { class: 'small muted', style: 'margin-top:18px;text-align:center' }, role === 'parent' ? "Your child's teacher gives you a username and a password. You can change the password after you sign in." : 'Your teacher gives you a username and a 4-digit PIN.'));
    user.focus();
  }
  draw();
  document.body.classList.remove('intro'); document.body.classList.add('auth-page');
  const SIDE = {
    teacher: ['Find the mistake behind the mark.', 'हर गलती का कारण खोजें।', ['Check a whole sheet in minutes', 'See which students share an idea', 'Draft practice for just that group']],
    student: ['Know exactly what to practise.', 'जानिए आगे क्या अभ्यास करना है।', ['See your marks and your problem idea', 'Practise only what you need', 'Your teacher is always one tap away']],
    parent: ['See how your child is really doing.', 'अपने बच्चे की प्रगति, हिंदी में।', ['Marks, attendance and notices', 'A one-tap Hindi summary', 'Message the teacher directly']] }[role];
  const others = ['teacher', 'student', 'parent'].filter((r) => r !== role);
  $app.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'bg3d', id: 'bg3d', 'aria-hidden': 'true' }), h('div', { class: 'auth-card' },
    h('div', { class: 'auth-side ' + role }, h('div', { class: 'brand' }, logo(), 'GapMap'),
      h('div', {}, h('h2', {}, SIDE[0]), h('p', { class: 'hi', lang: 'hi' }, SIDE[1])),
      h('ul', {}, SIDE[2].map((t) => h('li', {}, t)))),
    h('div', { class: 'auth-main' }, h('a', { href: '#/login', class: 'back' }, '← Back'),
      h('h1', {}, 'Welcome back'), h('p', { class: 'muted', style: 'margin-bottom:18px' }, role === 'student' ? 'Student sign in' : role === 'parent' ? 'Parent sign in' : 'Teacher sign in'),
      box, h('div', { class: 'swap' }, h('span', { class: 'small muted' }, 'Not a ' + role + '?'), others.map((r) => h('a', { href: '#/login/' + r }, 'I am a ' + r)))))));
  const bg = document.getElementById('bg3d'); if (bg && window.SetuScene) window.SetuScene.mount(bg, { variant: 'full' });
}

// ---------- teacher: classes ----------
async function teacherHome() {
  page([{ label: 'Classes' }]);
  const classes = await api('GET', '/classes');
  const add = btn('New class', 'leaf', newClassModal);
  const sample = btn('Load sample class', 'sun', sampleModal);
  page([{ label: 'Classes' }], head('Your classes', 'Pick a class to start.', h('div', { class: 'row' }, btn('My contact details', 'ghost', () => window.GM.contactModal && window.GM.contactModal(), 'small'), classes.length ? sample : null, classes.length ? add : null)),
    classes.length ? h('div', { class: 'grid' }, classes.map((c) => h('a', { class: 'tile stack', href: '#/t/c/' + c.id }, h('h2', {}, c.name), h('p', { class: 'muted' }, c.studentCount + (c.studentCount === 1 ? ' student' : ' students')))))
      : empty('No classes yet', 'Create your first class, then add students to it. Or load a sample class to look around first.', h('div', { class: 'row', style: 'justify-content:center' }, add, sample)));
}
function sampleModal() {
  modal({ title: 'Load a sample class?', body: h('p', { class: 'muted' }, 'This adds a class named "Sample class (demo data)" with 6 sample students and 6 typed answer sheets, so you can see groups, charts and practice. It is clearly labelled and you can ignore it later.'),
    actions: [{ label: 'Cancel', onclick: (c) => c() }, { label: 'Load sample class', color: 'sun', onclick: async (close) => {
      const done = busy('Setting up the sample class');
      try { const r = await api('POST', '/samples/class'); done(); close(); toast('Sample class ready', 'ok'); location.hash = '#/t/a/' + r.assessmentId; } catch (e) { done(); toast(e.message, 'bad'); } } }] });
}
function changePinModal() {
  const oldP = h('input', { id: 'op', type: 'password', inputmode: 'numeric', autocomplete: 'current-password' }), newP = h('input', { id: 'np', type: 'password', inputmode: 'numeric', autocomplete: 'new-password' });
  const err = h('div');
  modal({ title: 'Change your PIN', body: h('div', {}, err, h('div', { class: 'field' }, h('label', { for: 'op' }, 'Current PIN'), oldP), h('div', { class: 'field' }, h('label', { for: 'np' }, 'New PIN (4 to 8 digits)'), newP)),
    actions: [{ label: 'Cancel', onclick: (c) => c() }, { label: 'Save PIN', color: 'leaf', onclick: async (close) => {
      try { await api('POST', '/student/change-pin', { oldPin: oldP.value, newPin: newP.value }); close(); toast('PIN changed', 'ok'); } catch (e) { err.replaceChildren(errorBox(e.message)); } } }] });
}
function newClassModal() {
  const input = h('input', { id: 'cn', placeholder: 'For example: Class 7-B' });
  const err = h('div');
  modal({ title: 'New class', body: h('div', {}, err, h('div', { class: 'field' }, h('label', { for: 'cn' }, 'Class name'), input)),
    actions: [{ label: 'Cancel', onclick: (c) => c() }, { label: 'Create class', color: 'leaf', onclick: async (close) => {
      try { const r = await api('POST', '/classes', { name: input.value }); close(); location.hash = '#/t/c/' + r.id; } catch (e) { err.replaceChildren(errorBox(e.message)); } } }] });
}

async function classHub(cid) {
  const [classes, students, tests, alertData] = await Promise.all([api('GET', '/classes'), api('GET', `/classes/${cid}/students`), api('GET', `/classes/${cid}/assessments`), api('GET', `/classes/${cid}/alerts?status=new`).catch(() => null)]);
  const c = classes.find((x) => String(x.id) === String(cid));
  if (!c) { location.hash = '#/t'; return; }
  const newAlerts = alertData ? alertData.counts.new : 0;
  page([{ label: 'Classes', href: '#/t' }, { label: c.name }], head(c.name, 'What do you want to do?'),
    h('div', { class: 'grid' },
      h('a', { class: 'tile', href: `#/t/c/${cid}/students` }, h('div', { class: 'ico teal' }, icon('people')), h('h2', {}, 'Students'), h('p', { class: 'muted' }, students.length + ' in this class')),
      h('a', { class: 'tile', href: `#/t/c/${cid}/tests` }, h('div', { class: 'ico blue' }, icon('test')), h('h2', {}, 'Tests'), h('p', { class: 'muted' }, tests.length + ' created')),
      h('a', { class: 'tile', href: `#/t/c/${cid}/history` }, h('div', { class: 'ico plum' }, icon('help')), h('h2', {}, 'Who needs help'), h('p', { class: 'muted' }, 'Mistakes by student')),
      h('a', { class: 'tile', href: `#/t/c/${cid}/quizzes` }, h('div', { class: 'ico sun' }, icon('test')), h('h2', {}, 'Quizzes'), h('p', { class: 'muted' }, 'AI or typed quiz for the whole class')),
      h('a', { class: 'tile', href: `#/t/c/${cid}/participation` }, h('div', { class: 'ico leaf' }, icon('chart')), h('h2', {}, 'Participation'), h('p', { class: 'muted' }, 'Who is practising, who is absent')),
      h('a', { class: 'tile', href: `#/t/c/${cid}/attendance` }, h('div', { class: 'ico teal' }, icon('calendar')), h('h2', {}, 'Attendance'), h('p', { class: 'muted' }, 'Mark the day, see who is below 75%')),
      h('a', { class: 'tile', href: `#/t/c/${cid}/notices` }, h('div', { class: 'ico rose' }, icon('bell')), h('h2', {}, 'Notices and parents'), h('p', { class: 'muted' }, 'Post notices, read parent messages')),
      h('a', { class: 'tile', href: `#/t/c/${cid}/sent` }, h('div', { class: 'ico plum' }, icon('bell')), h('h2', {}, 'Sent notifications'), h('p', { class: 'muted' }, 'What families were told, and who read it')),
      h('a', { class: 'tile', href: `#/t/c/${cid}/alerts` }, h('div', { class: 'ico rose' }, icon('bell')), h('h2', {}, 'Alert centre'), h('p', { class: 'muted' }, newAlerts ? newAlerts + ' new alert' + (newAlerts === 1 ? '' : 's') : 'Children who may need support, and good news'), newAlerts ? h('span', { class: 'chip rose' }, newAlerts + ' new') : null),
      h('a', { class: 'tile', href: `#/t/c/${cid}/leave` }, h('div', { class: 'ico teal' }, icon('calendar')), h('h2', {}, 'Leave requests'), h('p', { class: 'muted' }, 'Approve a parent\'s leave note with one tap')),
      h('a', { class: 'tile', href: `#/t/c/${cid}/meetings` }, h('div', { class: 'ico sun' }, icon('calendar')), h('h2', {}, 'Meeting times'), h('p', { class: 'muted' }, 'Parents book a slot to meet you')),
      h('a', { class: 'tile', href: `#/t/c/${cid}/settings` }, h('div', { class: 'ico teal' }, icon('help')), h('h2', {}, 'Class settings'), h('p', { class: 'muted' }, 'Alert lines and the academic year')),
      h('a', { class: 'tile', href: `#/t/c/${cid}/reports` }, h('div', { class: 'ico leaf' }, icon('chart')), h('h2', {}, 'Report cards'), h('p', { class: 'muted' }, 'Till date or full year, print or download'))));
}

async function studentsScreen(cid) {
  const [classes, students] = await Promise.all([api('GET', '/classes'), api('GET', `/classes/${cid}/students`)]);
  const c = classes.find((x) => String(x.id) === String(cid)) || { name: 'Class' };
  const add = btn('Add students', 'leaf', () => addStudentsModal(cid));
  page([{ label: 'Classes', href: '#/t' }, { label: c.name, href: '#/t/c/' + cid }, { label: 'Students' }],
    head('Students', 'Use a first name or roll number. Real names are not needed, and nothing here goes to the AI.', students.length ? add : null),
    students.length ? h('div', { class: 'list' }, students.map((s) => h('div', { class: 'item' },
      h('div', { class: 'grow' }, h('strong', {}, s.name), s.roll ? h('span', { class: 'muted' }, '  Roll ' + s.roll) : null),
      h('span', { class: 'chip' }, 'Login: ' + (s.username || 'none')),
      link('Report', '#/t/r/' + s.id, 'blue', 'small'),
      btn('Parent login', 'plum', () => (window.GM.parentLoginModal ? window.GM.parentLoginModal(s) : toast('Not ready yet', 'bad')), 'small'),
      btn('Set PIN', 'ghost', () => setPinModal(s), 'small'),
      btn('Random PIN', 'ghost', async () => { try { const r = await api('POST', `/students/${s.id}/reset-pin`); showLogins([{ name: s.name, login: r }], 'New PIN'); } catch (e) { toast(e.message, 'bad'); } }, 'small'))))
      : empty('No students yet', 'Add the students in this class. Each one gets a username and a PIN.', add));
}
function setPinModal(s) {
  const input = h('input', { id: 'sp', inputmode: 'numeric', placeholder: '4 to 8 digits', autocomplete: 'off' });
  const err = h('div');
  modal({ title: 'Set a PIN for ' + s.name, body: h('div', {}, err, h('div', { class: 'field' }, h('label', { for: 'sp' }, 'New PIN'), input, h('p', { class: 'hint' }, 'The student can also change it after signing in.'))),
    actions: [{ label: 'Cancel', onclick: (c) => c() }, { label: 'Save PIN', color: 'leaf', onclick: async (close) => {
      try { const r = await api('POST', `/students/${s.id}/set-pin`, { pin: input.value }); close(); showLogins([{ name: s.name, login: r }], 'PIN saved'); } catch (e) { err.replaceChildren(errorBox(e.message)); } } }] });
}
function addStudentsModal(cid) {
  const ta = h('textarea', { id: 'sl', placeholder: 'Asha, 1\nRahul, 2\nRoll 3' });
  const err = h('div');
  modal({ title: 'Add students', body: h('div', {}, err, h('div', { class: 'field' }, h('label', { for: 'sl' }, 'One student per line'), ta, h('p', { class: 'hint' }, 'Write the name, then a comma, then the roll number. You can add a third part to choose the PIN yourself: Asha, 1, 4821. Without it, a random PIN is made.'))),
    actions: [{ label: 'Cancel', onclick: (c) => c() }, { label: 'Add students', color: 'leaf', onclick: async (close) => {
      const lines = ta.value.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) { err.replaceChildren(errorBox('Type at least one student.')); return; }
      const made = [];
      try {
        for (const l of lines) { const [name, roll, pin] = l.split(',').map((x) => x.trim()); made.push(await api('POST', `/classes/${cid}/students`, { name, roll, pin })); }
      } catch (e) { err.replaceChildren(errorBox(e.message + (made.length ? ` (${made.length} were added before this.)` : ''))); if (!made.length) return; }
      close(); showLogins(made, 'Student logins', () => route());
    } }] });
}
function showLogins(list, title, after) {
  const text = list.map((s) => `${s.name}: username ${s.login.username}, PIN ${s.login.pin}`).join('\n');
  modal({ title, onClose: after, body: h('div', {}, h('p', { class: 'muted', style: 'margin-bottom:14px' }, 'Write these PINs down now. They are shown only once. You can set a new PIN later.'),
    h('div', { class: 'list' }, list.map((s) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('strong', {}, s.name)), h('span', { class: 'pin' }, s.login.username + '  /  ' + s.login.pin))))),
    actions: [{ label: 'Copy all', color: 'blue', onclick: () => { navigator.clipboard?.writeText(text).then(() => toast('Copied', 'ok'), () => toast('Could not copy', 'bad')); } }, { label: 'Done', color: 'leaf', onclick: (c) => c() }] });
}

// ---------- teacher: tests ----------
async function testsScreen(cid) {
  const [classes, tests] = await Promise.all([api('GET', '/classes'), api('GET', `/classes/${cid}/assessments`)]);
  const c = classes.find((x) => String(x.id) === String(cid)) || { name: 'Class', studentCount: 0 };
  const add = link('New test', `#/t/c/${cid}/tests/new`, 'leaf');
  const addChoice = link('New multiple-choice test', `#/t/c/${cid}/paper/new`, 'plum');
  const paperBlock = window.GM.paperTestsBlock ? await window.GM.paperTestsBlock(cid) : null;
  page([{ label: 'Classes', href: '#/t' }, { label: c.name, href: '#/t/c/' + cid }, { label: 'Tests' }], head('Tests', 'Number tests (maths) or multiple-choice paper tests (any subject). You add one answer sheet per student.', h('div', { class: 'row' }, addChoice, tests.length ? add : null)),
    tests.length ? h('div', { class: 'list' }, tests.map((a) => h('a', { class: 'item', href: '#/t/a/' + a.id }, h('div', { class: 'grow' }, h('strong', {}, a.title), a.subject ? h('span', { class: 'chip', style: 'margin-left:8px' }, a.subject) : null, a.kind === 'homework' ? h('span', { class: 'chip sun', style: 'margin-left:8px' }, 'Homework' + (a.due ? ' due ' + a.due : '')) : null), h('span', { class: 'chip ' + (a.sheetsDone ? 'leaf' : '') }, `${a.sheetsDone} of ${c.studentCount} sheets checked`))))
      : empty('No number tests yet', 'Create a maths test with the questions your students answered, or make a multiple-choice test for any subject.', add), paperBlock);
}
async function newTestScreen(cid) {
  const [classes, presets] = await Promise.all([api('GET', '/classes'), api('GET', '/presets')]);
  const c = classes.find((x) => String(x.id) === String(cid)) || { name: 'Class' };
  const title = h('input', { id: 'tt', placeholder: 'For example: Fractions check' });
  const ta = h('textarea', { id: 'qs', placeholder: '1/2+1/3\n5/6-1/3\n2/3*3/4' });
  const err = h('div');
  const SUBJECTS = ['Maths', 'Science', 'Biology', 'Physics', 'Chemistry', 'Social Science', 'History', 'Geography', 'English', 'Hindi', 'Computer Science', 'Economics', 'Civics', 'Sanskrit', 'Art'];
  // Any subject can be typed. Only Maths uses number sums checked from a photo; every other subject uses a multiple-choice paper test.
  const subj = h('input', { id: 'sj', list: 'sjList', value: 'Maths', autocomplete: 'off', placeholder: 'Type or pick any subject' });
  const subjList = h('datalist', { id: 'sjList' }, SUBJECTS.map((x) => h('option', { value: x })));
  const isMaths = () => /^\s*(maths?|mathematics|math)\s*$/i.test(subj.value) || !subj.value.trim();
  const numberBox = h('div', { class: 'field' }, h('label', { for: 'qs' }, 'Questions, one per line'), ta,
    h('p', { class: 'hint' }, 'Number sums only, like 1/2+1/3 or 2/3*3/4. The correct answers are worked out by the computer, not by the AI.'));
  const other = h('div', { class: 'slab', style: 'display:none;margin:12px 0' });
  const hwBox = h('input', { type: 'checkbox', id: 'hw' }), due = h('input', { type: 'date', id: 'due' });
  const createBtn = btn('Create test', 'leaf', async () => {
          try { const r = await api('POST', `/classes/${cid}/assessments`, { title: title.value, subject: 'Maths', expressions: ta.value.split('\n'), kind: hwBox.checked ? 'homework' : 'test', due: due.value || null }); toast('Test created', 'ok'); location.hash = '#/t/a/' + r.id; }
          catch (e) { err.replaceChildren(errorBox(e.message)); } }, 'big');
  const syncSubject = () => {
    const notMaths = !isMaths();
    numberBox.style.display = notMaths ? 'none' : '';
    other.style.display = notMaths ? 'block' : 'none';
    createBtn.disabled = notMaths; createBtn.style.opacity = notMaths ? '.5' : '';
    if (notMaths) other.replaceChildren(h('h3', { style: 'margin-bottom:6px' }, subj.value.trim() + ': make a multiple-choice test'),
      h('p', { class: 'muted' }, `Number-sum tests are for Maths. For ${subj.value.trim()}, make a multiple-choice paper test: you (or the AI, then you check it) write the key and the mistaken idea behind each wrong option. For each student you photograph the answer sheet or type the letters. The computer marks it and groups students who share a mistaken idea.`),
      h('div', { class: 'row', style: 'margin-top:10px' }, link('Make a ' + subj.value.trim() + ' multiple-choice test', `#/t/c/${cid}/paper/new/${encodeURIComponent(subj.value.trim())}`, 'plum')));
  };
  subj.addEventListener('input', syncSubject); subj.addEventListener('change', syncSubject);
  page([{ label: 'Classes', href: '#/t' }, { label: c.name, href: '#/t/c/' + cid }, { label: 'Tests', href: `#/t/c/${cid}/tests` }, { label: 'New test' }],
    head('New test', 'Type the questions exactly as printed on the sheet.'),
    h('div', { class: 'slab' }, err,
      h('div', { class: 'field' }, h('label', { for: 'tt' }, 'Test name'), title),
      h('div', { class: 'field' }, h('label', { for: 'sj' }, 'Subject'), subj, subjList,
        h('p', { class: 'hint' }, 'Any subject works. Maths uses number sums checked from a photo. Every other subject uses a multiple-choice paper test (you or the AI write the questions, you check them).')),
      other,
      numberBox,
      h('div', { class: 'field' }, h('label', { for: 'hw', style: 'display:flex;gap:10px;align-items:center' }, hwBox, 'This is homework: students hand it in themselves (photo, PDF or typed)'),
        h('label', { for: 'due', style: 'margin-top:8px' }, 'Due date (optional)'), due),
      h('div', { class: 'row' },
        ...presets.map((p) => btn('Use the ' + p.title.toLowerCase() + ' starter', 'sun', () => { ta.value = p.expressions.join('\n'); if (!title.value) title.value = p.title; })),
        h('span', { class: 'grow' }),
        createBtn)));
}

async function testHub(aid) {
  const [a, rep] = await Promise.all([api('GET', '/assessments/' + aid), api('GET', `/assessments/${aid}/report`)]);
  const classes = await api('GET', '/classes');
  const c = classes.find((x) => x.id === a.classId) || { name: 'Class' };
  const total = rep.students.length;
  page([{ label: 'Classes', href: '#/t' }, { label: c.name, href: '#/t/c/' + a.classId }, { label: 'Tests', href: `#/t/c/${a.classId}/tests` }, { label: a.title }],
    head(a.title, `${rep.submittedCount} of ${total} sheets checked`),
    h('div', { class: 'grid' },
      h('a', { class: 'tile', href: `#/t/a/${aid}/sheet` }, h('div', { class: 'ico blue' }, icon('upload')), h('h2', {}, 'Add a sheet'), h('p', { class: 'muted' }, 'Photo, PDF, camera or typed answers')),
      h('a', { class: 'tile', href: `#/t/a/${aid}/results` }, h('div', { class: 'ico leaf' }, icon('chart')), h('h2', {}, 'See results'), h('p', { class: 'muted' }, 'Groups, marks and what to teach next')),
      h('a', { class: 'tile', href: `#/t/a/${aid}/overview` }, h('div', { class: 'ico plum' }, icon('report')), h('h2', {}, 'Class overview'), h('p', { class: 'muted' }, 'Charts for the whole class'))),
    (window.GM.testActions ? window.GM.testActions(aid, a) : null),
    h('div', { class: 'slab', style: 'margin-top:30px' }, h('h3', { style: 'margin-bottom:12px' }, 'Questions in this test'),
      h('div', { class: 'pill-list' }, a.questions.map((q) => h('span', { class: 'chip' }, q.id + ': ' + q.expression)))));
}

// add-sheet flow: pick student -> pick method -> check -> result
async function pickStudent(aid) {
  const [a, rep] = await Promise.all([api('GET', '/assessments/' + aid), api('GET', `/assessments/${aid}/report`)]);
  page([{ label: 'Classes', href: '#/t' }, { label: a.title, href: '#/t/a/' + aid }, { label: 'Add a sheet' }], steps(1, 4), head('Whose sheet is it?', 'Pick the student.'),
    rep.students.length ? h('div', { class: 'list' }, rep.students.map((s) => h('a', { class: 'item', href: `#/t/a/${aid}/sheet/${s.id}` }, h('div', { class: 'grow' }, h('strong', {}, s.name), s.roll ? h('span', { class: 'muted' }, '  Roll ' + s.roll) : null),
      s.done ? h('span', { class: 'chip leaf' }, `Checked: ${s.marks}/${s.total}`) : h('span', { class: 'chip' }, 'Not checked'))))
      : empty('No students in this class', 'Add students first.', link('Add students', `#/t/c/${a.classId}/students`, 'leaf')));
}
async function pickMethod(aid, sid) {
  const [a, rep, health] = await Promise.all([api('GET', '/assessments/' + aid), api('GET', `/assessments/${aid}/report`), api('GET', '/health')]);
  const st = rep.students.find((s) => String(s.id) === String(sid)); if (!st) { location.hash = `#/t/a/${aid}/sheet`; return; }
  const fileIn = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf', style: 'display:none', onchange: () => { if (fileIn.files[0]) sendSheet(aid, sid, fileIn.files[0]); } });
  const ai = health.aiReading;
  page([{ label: 'Classes', href: '#/t' }, { label: a.title, href: '#/t/a/' + aid }, { label: 'Add a sheet', href: `#/t/a/${aid}/sheet` }, { label: st.name }], steps(2, 4),
    head('How do you want to add it?', st.name + (st.done ? '. This will replace the earlier sheet.' : '')),
    ai ? null : h('div', { class: 'err' }, 'Sheet reading is not set up on this computer, so only typing is available. Add GEMINI_API_KEY to the .env file to turn it on.'),
    h('div', { class: 'grid' },
      h('button', { class: 'tile', disabled: !ai, onclick: () => fileIn.click() }, h('div', { class: 'ico blue' }, icon('upload')), h('h2', {}, 'Upload a photo or PDF'), h('p', { class: 'muted' }, 'JPG, PNG, WEBP or PDF, up to 10 MB')),
      h('button', { class: 'tile', disabled: !ai, onclick: () => cameraModal((file) => sendSheet(aid, sid, file)) }, h('div', { class: 'ico plum' }, icon('camera')), h('h2', {}, 'Take a photo'), h('p', { class: 'muted' }, 'Use this computer or phone camera')),
      h('a', { class: 'tile', href: `#/t/a/${aid}/sheet/${sid}/type` }, h('div', { class: 'ico sun' }, icon('type')), h('h2', {}, 'Type the answers'), h('p', { class: 'muted' }, 'No sheet needed'))), fileIn);
}
async function sendSheet(aid, sid, file) {
  const done = busy('Reading the sheet twice');
  try {
    const fd = new FormData(); fd.append('studentId', sid); fd.append('file', file);
    const d = await api('POST', `/assessments/${aid}/sheets`, fd, true);
    done(); location.hash = '#/t/s/' + d.submissionId;
  } catch (e) { done(); toast(e.message, 'bad'); }
}
function cameraModal(onFile) {
  const video = h('video', { class: 'cam', autoplay: true, playsinline: true, muted: true });
  const err = h('div');
  let stream = null;
  const m = modal({ title: 'Take a photo of the sheet', onClose: () => stream && stream.getTracks().forEach((t) => t.stop()), body: h('div', {}, err, video, h('p', { class: 'hint' }, 'Hold the sheet flat, in good light, so all the answers are in view.')),
    actions: [{ label: 'Cancel', onclick: (c) => c() }, { label: 'Take photo', color: 'plum', onclick: (close) => {
      if (!stream) return;
      const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight; c.getContext('2d').drawImage(video, 0, 0);
      c.toBlob((b) => { close(); onFile(new File([b], 'camera.jpg', { type: 'image/jpeg' })); }, 'image/jpeg', 0.9);
    } }] });
  navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } }).then((s) => { stream = s; video.srcObject = s; }, () => err.replaceChildren(errorBox('The camera is blocked or not available. Allow camera access, or upload a photo instead.')));
  if (!navigator.mediaDevices) err.replaceChildren(errorBox('This browser cannot use the camera here. Upload a photo instead.'));
  return m;
}
async function typeAnswers(aid, sid) {
  const [a, rep] = await Promise.all([api('GET', '/assessments/' + aid), api('GET', `/assessments/${aid}/report`)]);
  const st = rep.students.find((s) => String(s.id) === String(sid)); if (!st) { location.hash = `#/t/a/${aid}/sheet`; return; }
  const inputs = a.questions.map((q) => h('input', { id: 'a' + q.id, 'aria-label': 'Answer to ' + q.expression, placeholder: 'e.g. 5/6', inputmode: 'text', autocomplete: 'off' }));
  const err = h('div');
  page([{ label: 'Classes', href: '#/t' }, { label: a.title, href: '#/t/a/' + aid }, { label: 'Add a sheet', href: `#/t/a/${aid}/sheet` }, { label: st.name }], steps(3, 4),
    head('Type the answers', st.name + '. Leave a box empty if the student left it blank.'),
    h('div', { class: 'slab' }, err, a.questions.map((q, i) => h('div', { class: 'qrow' }, h('div', { class: 'qno' }, i + 1), h('label', { for: 'a' + q.id, class: 'expr', style: 'margin:0' }, q.expression + ' ='), inputs[i])),
      h('div', { class: 'row', style: 'margin-top:20px;justify-content:flex-end' }, btn('Check answers', 'leaf', async () => {
        const answers = {}; a.questions.forEach((q, i) => { answers[q.id] = inputs[i].value.trim() || 'UNCLEAR'; });
        const done = busy('Checking the answers');
        try { const r = await api('POST', `/assessments/${aid}/typed`, { studentId: Number(sid), answers }); done(); location.hash = '#/t/s/' + r.submissionId; }
        catch (e) { done(); err.replaceChildren(errorBox(e.message)); }
      }, 'big'))));
  inputs[0]?.focus();
}

// check the reading, or show the result
async function sheetScreen(subId) {
  const s = await api('GET', '/sheets/' + subId);
  return s.status === 'read' ? reviewDraft(s) : resultScreen(s);
}
function reviewDraft(s) {
  const d = s.draft;
  const inputs = d.answers.map((a) => h('input', { 'aria-label': 'Answer to ' + a.expression, value: a.agree ? a.value : '', placeholder: a.agree ? '' : 'Type what the student wrote' }));
  const img = h('div');
  if (s.hasFile) {
    fetch('/api/sheets/' + s.submissionId + '/file', { headers: { Authorization: 'Bearer ' + state.token } }).then((r) => r.ok ? r.blob() : null).then((b) => {
      if (!b) return; const url = URL.createObjectURL(b);
      img.replaceChildren(b.type === 'application/pdf' ? h('a', { href: url, target: '_blank', rel: 'noopener', class: 'btn ghost small' }, 'Open the PDF') : h('img', { class: 'sheet-img', src: url, alt: 'The uploaded answer sheet' }));
    }).catch(() => {});
  }
  const flagged = d.answers.filter((a) => !a.agree).length;
  page([{ label: 'Classes', href: '#/t' }, { label: s.assessment, href: '#/t/a/' + s.assessmentId }, { label: s.studentName }], steps(3, 4),
    head('Check the reading', `${s.studentName}. The sheet was read twice.`),
    flagged ? h('div', { class: 'err' }, `${flagged} answer${flagged > 1 ? 's' : ''} could not be read the same way both times. Please type what the student wrote.`) : h('div', { class: 'chip leaf', style: 'margin-bottom:16px' }, 'Both readings agree on every answer'),
    h('div', { class: 'pair' }, h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:8px' }, 'Sheet'), img, s.hasFile ? null : h('p', { class: 'muted' }, 'No sheet was uploaded.')),
      h('div', { class: 'slab' }, d.answers.map((a, i) => h('div', { class: 'qrow' }, h('div', { class: 'qno' }, i + 1), h('span', { class: 'expr' }, a.expression + ' ='), inputs[i],
        a.agree ? null : h('div', { class: 'note' }, 'Reading 1: ', h('button', { class: 'chip sun', type: 'button', onclick: () => { inputs[i].value = a.readA === 'UNCLEAR' ? '' : a.readA; } }, a.readA), ' Reading 2: ', h('button', { class: 'chip sun', type: 'button', onclick: () => { inputs[i].value = a.readB === 'UNCLEAR' ? '' : a.readB; } }, a.readB), ' (tap to use)'))))),
    h('div', { class: 'row', style: 'margin-top:26px;justify-content:flex-end' }, btn('Confirm and check', 'leaf', async () => {
      const answers = {}; d.answers.forEach((a, i) => { if (inputs[i].value.trim()) answers[a.id] = inputs[i].value.trim(); });
      const done = busy('Checking the answers');
      try { await api('POST', `/sheets/${s.submissionId}/confirm`, { answers }); done(); route(); }
      catch (e) { done(); toast(e.message, 'bad'); }
    }, 'big')));
}
function resultScreen(s) {
  const r = s.result, nm = (sig, fallback) => s.names[sig] || fallback;
  const nameFor = (sig) => nm(sig, (r.items.find((i) => i.verified && i.ruleExpression && i.ruleExpression.replace(/\s+/g, '') === sig) || {}).ruleName || 'Unnamed pattern');
  const explFor = (sig) => (r.items.find((i) => i.verified && i.ruleExpression && i.ruleExpression.replace(/\s+/g, '') === sig && i.explanation) || {}).explanation || '';
  const likely = r.findings.filter((f) => f.level === 'likely'), sus = r.findings.filter((f) => f.level === 'suspected');
  const chipFor = (it) => it.status === 'correct' ? h('span', { class: 'chip leaf' }, 'Correct')
    : it.status === 'wrong' ? (it.verified ? h('span', { class: 'chip blue' }, 'Verified pattern') : it.ruleName ? h('span', { class: 'chip sun' }, 'AI suggestion (unverified)') : h('span', { class: 'chip rose' }, 'No pattern found'))
    : h('span', { class: 'chip rose' }, 'Needs teacher review');
  page([{ label: 'Classes', href: '#/t' }, { label: s.assessment, href: '#/t/a/' + s.assessmentId }, { label: s.studentName }], steps(4, 4),
    h('div', { class: 'head' }, h('div', {}, h('h1', {}, s.studentName), h('p', { class: 'muted' }, s.assessment)), ring(r.marks, r.total)),
    h('div', { class: 'list' },
      h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:10px' }, 'Likely gaps'),
        likely.length ? h('div', { class: 'list' }, likely.map((f) => h('div', {}, h('strong', {}, nameFor(f.signature)), h('p', { class: 'muted' }, explFor(f.signature)), h('p', { class: 'small muted' }, `Seen in ${qlist(f.questions)}. The same verified pattern in 2 or more questions.`))))
          : h('p', { class: 'muted' }, 'No pattern was found in 2 or more questions.')),
      sus.length ? h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:10px' }, 'Suspected, only one question'), h('div', { class: 'list' }, sus.map((f) => h('div', {}, h('strong', {}, nameFor(f.signature)), h('p', { class: 'small muted' }, `Seen in ${qlist(f.questions)}. One question is not enough evidence.`))))) : null,
      r.needsReview.length ? h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:10px' }, 'Needs your review'), h('p', { class: 'muted' }, 'These answers were wrong or unclear, but no pattern could be verified: ' + qlist(r.needsReview) + '.')) : null,
      h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:6px' }, 'Every question'), r.items.map((it) => h('div', { class: 'qrow' }, h('div', { class: 'qno' }, it.q), h('div', {}, h('span', { class: 'expr' }, it.expression + ' = '), h('span', {}, it.studentAnswer), it.status === 'wrong' ? h('span', { class: 'muted' }, '   (correct: ' + it.correct + ')') : null), chipFor(it),
        it.status === 'wrong' && it.ruleName ? h('div', { class: 'note' }, (it.verified ? 'Consistent with: ' : 'AI suggestion, not counted as evidence: ') + it.ruleName + (!it.verified && it.explanation ? '. ' + it.explanation : '')) : null,
        it.status === 'wrong' && !it.ruleName ? h('div', { class: 'note' }, (it.aiNote ? it.aiNote + ' ' : '') + 'No known pattern fits this wrong answer, so please look at it yourself.') : null,
        it.status === 'needs_review' && it.reason ? h('div', { class: 'note' }, it.reason) : null)))),
    h('div', { class: 'row', style: 'margin-top:26px' }, link('Add the next sheet', `#/t/a/${s.assessmentId}/sheet`, 'blue'), link('See class results', `#/t/a/${s.assessmentId}/results`, 'leaf')));
}
function ring(n, total) {
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (t, a) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const svg = mk('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true' });
  svg.append(mk('circle', { class: 'bg', cx: 60, cy: 60, r: 50 }), mk('circle', { class: 'fg', cx: 60, cy: 60, r: 50 }));
  const el = h('div', { class: 'ring', role: 'img', 'aria-label': `${n} out of ${total}` }, svg, h('b', {}, `${n}/${total}`));
  el.style.setProperty('--p', total ? n / total : 0);
  return el;
}

// ---------- teacher: results, groups, kit ----------
async function resultsScreen(aid) {
  const rep = await api('GET', `/assessments/${aid}/report`);
  const a = rep.assessment;
  const body = [];
  if (!rep.submittedCount) body.push(empty('No sheets checked yet', 'Add at least two students to see shared mistakes.', link('Add a sheet', `#/t/a/${aid}/sheet`, 'blue')));
  else {
    body.push(h('h2', { style: 'margin:6px 0 4px' }, 'Groups with the same mistake'), h('p', { class: 'muted small', style: 'margin-bottom:6px' }, 'Students are grouped when a verified pattern appears in 2 or more of their answers.'));
    body.push(rep.groups.length ? h('div', { class: 'grid' }, rep.groups.map((g) => h('a', { class: 'tile stack', href: `#/t/a/${aid}/group/${encodeURIComponent(g.signature)}` },
      h('h3', {}, g.name), h('span', { class: 'chip plum' }, g.count + (g.count === 1 ? ' student' : ' students')), h('p', { class: 'muted small' }, g.students.map((x) => x.name).join(', ')))))
      : h('div', { class: 'slab muted' }, 'No shared pattern yet. This may change as you add more sheets.'));
    if (rep.suspected.length) body.push(h('h2', { style: 'margin:34px 0 12px' }, 'Suspected, one question only'), h('div', { class: 'list' }, rep.suspected.map((x) => h('div', { class: 'item' }, h('strong', { class: 'grow' }, x.studentName), h('span', { class: 'chip sun' }, x.name + ' (' + qlist(x.questions) + ')')))));
    if (rep.review.length) body.push(h('h2', { style: 'margin:34px 0 12px' }, 'Needs your review'), h('div', { class: 'list' }, rep.review.map((x) => { const st = rep.students.find((s) => s.id === x.student); return h('a', { class: 'item', href: '#/t/s/' + st.submissionId }, h('strong', { class: 'grow' }, x.studentName), h('span', { class: 'chip rose' }, qlist(x.questions))); })));
    body.push(h('h2', { style: 'margin:34px 0 12px' }, 'Each student'), h('div', { class: 'list' }, rep.students.map((s) => s.done
      ? h('a', { class: 'item', href: '#/t/s/' + s.submissionId }, h('strong', { class: 'grow' }, s.name), s.findings.filter((f) => f.level === 'likely').map((f) => h('span', { class: 'chip plum' }, f.name)), h('span', { class: 'chip leaf' }, `${s.marks}/${s.total}`))
      : h('div', { class: 'item' }, h('strong', { class: 'grow' }, s.name), h('span', { class: 'chip' }, 'Sheet not added')))));
  }
  page([{ label: 'Classes', href: '#/t' }, { label: a.title, href: '#/t/a/' + aid }, { label: 'Results' }], head('Results', a.title, link('Class overview charts', `#/t/a/${aid}/overview`, 'plum', 'small')), body);
}

// ----- charts: plain HTML/CSS bars, so they are readable and printable -----
function hbar(label, segments, text) {
  const total = segments.reduce((p, s) => p + s.value, 0);
  return h('div', { class: 'hbar' }, h('div', { class: 'hl' }, label),
    h('div', { class: 'track', role: 'img', 'aria-label': (typeof label === 'string' ? label : '') + ': ' + text }, segments.filter((s) => s.value > 0).map((s) => h('i', { class: s.color, style: { width: (total ? (s.value / (s.max || total)) * 100 : 0) + '%' } }))),
    h('div', { class: 'hv' }, text));
}
function vbars(items, max) {
  const m = Math.max(1, max || Math.max(...items.map((i) => i.value)));
  return h('div', { class: 'vbars' }, items.map((i) => h('div', { class: 'vb' }, h('span', { class: 'vv' }, i.value),
    h('div', { class: 'vcol' }, h('i', { style: { height: (i.value / m) * 100 + '%' } })), h('span', { class: 'vl' }, i.label))));
}
const legend = (items) => h('div', { class: 'legend' }, items.map(([c, t]) => h('span', {}, h('i', { class: c }), t)));

async function overviewScreen(aid) {
  const o = await api('GET', `/assessments/${aid}/overview`);
  const stat = (n, label, color) => h('div', { class: 'slab stat' }, h('b', { class: color }, n), h('span', { class: 'muted' }, label));
  const body = [];
  if (!o.sheetsChecked) body.push(empty('No sheets checked yet', 'Charts appear after you check at least one answer sheet.', link('Add a sheet', `#/t/a/${aid}/sheet`, 'blue')));
  else {
    const st = o.status;
    body.push(h('div', { class: 'stats' }, stat(`${o.sheetsChecked} of ${o.studentsInClass}`, 'sheets checked', 'c-blue'), stat(`${o.averageMarks} / ${o.assessment.total}`, 'class average', 'c-leaf'),
      stat(st.likely, 'students with a likely gap', 'c-plum'), stat(st.review + st.suspectedOnly, 'students to look at yourself', 'c-sun')));
    body.push(h('div', { class: 'slab chart' }, h('h3', {}, 'How the class scored'), h('p', { class: 'muted small' }, 'Number of students for each mark.'), vbars(o.marks.map((m) => ({ label: m.marks + '/' + o.assessment.total, value: m.students })))));
    body.push(h('div', { class: 'slab chart' }, h('h3', {}, 'Question by question'), h('p', { class: 'muted small' }, 'Which questions the class found hardest.'),
      o.perQuestion.map((q) => hbar(h('span', {}, h('b', {}, 'Q' + q.q), ' ' + q.expression), [{ value: q.correct, color: 'leaf', max: q.total }, { value: q.wrong, color: 'rose', max: q.total }, { value: q.review, color: 'sun', max: q.total }], `${q.correct} of ${q.total} right`)),
      legend([['leaf', 'Right'], ['rose', 'Wrong'], ['sun', 'Needs review']])));
    body.push(h('div', { class: 'slab chart' }, h('h3', {}, 'Mistake patterns'), h('p', { class: 'muted small' }, 'Students per pattern. "Likely" means the same verified pattern in 2 or more questions.'),
      o.patterns.length ? [o.patterns.map((p) => hbar(p.name, [{ value: p.likely, color: 'plum', max: o.sheetsChecked }, { value: p.suspected, color: 'sun', max: o.sheetsChecked }], `${p.likely} likely, ${p.suspected} suspected`)), legend([['plum', 'Likely'], ['sun', 'Suspected (one question)']])]
        : h('p', { class: 'muted' }, 'No verified pattern yet.')));
    body.push(h('div', { class: 'slab chart' }, h('h3', {}, 'Class status'), h('p', { class: 'muted small' }, 'Every checked student appears once.'),
      hbar('All students', [{ value: st.noGap, color: 'leaf', max: o.sheetsChecked }, { value: st.likely, color: 'plum', max: o.sheetsChecked }, { value: st.suspectedOnly, color: 'sun', max: o.sheetsChecked }, { value: st.review, color: 'rose', max: o.sheetsChecked }], o.sheetsChecked + ' students'),
      legend([['leaf', `No gap (${st.noGap})`], ['plum', `Likely gap (${st.likely})`], ['sun', `Suspected only (${st.suspectedOnly})`], ['rose', `Needs review (${st.review})`]])));
    body.push(h('div', { class: 'slab chart' }, h('h3', {}, 'Did practice help?'), h('p', { class: 'muted small' }, 'Test score against practice score, for students who finished the practice. A small group is only a hint, not proof.'),
      o.practice.length ? o.practice.map((g) => h('div', { class: 'prog' }, h('strong', {}, g.name), h('span', { class: 'muted small' }, `${g.done} of ${g.assigned} finished`),
        g.done ? [hbar('Test', [{ value: g.beforePct, color: 'blue', max: 100 }], g.beforePct + '%'), hbar('Practice', [{ value: g.afterPct, color: 'leaf', max: 100 }], g.afterPct + '%')] : h('p', { class: 'muted small' }, 'Nobody has finished this practice yet.')))
        : h('p', { class: 'muted' }, 'No practice has been given yet. Open a group and give it out.')));
  }
  page([{ label: 'Classes', href: '#/t' }, { label: o.assessment.title, href: '#/t/a/' + aid }, { label: 'Class overview' }],
    head('Class overview', o.assessment.title, body.length > 1 ? btn('Print this report', 'ghost', () => window.print(), 'small') : null), h('div', { class: 'list roomy' }, body));
}

async function groupScreen(aid, sig) {
  const kit = await api('POST', `/assessments/${aid}/kit`, { signature: sig });
  const rename = () => { const input = h('input', { value: kit.name }); const err = h('div');
    modal({ title: 'Rename this group', body: h('div', {}, err, h('div', { class: 'field' }, h('label', {}, 'A plain-language name'), input)), actions: [{ label: 'Cancel', onclick: (c) => c() },
      { label: 'Save name', color: 'leaf', onclick: async (close) => { try { await api('POST', `/assessments/${aid}/groups/rename`, { signature: sig, name: input.value }); close(); route(); } catch (e) { err.replaceChildren(errorBox(e.message)); } } }] }); };
  const assign = btn(kit.assignedCount ? 'Give practice to anyone new' : `Give this practice to ${kit.students.length} student${kit.students.length === 1 ? '' : 's'}`, 'leaf', async () => {
    try { const r = await api('POST', `/assessments/${aid}/practice/assign`, { signature: sig }); toast(r.assigned ? `Practice sent to ${r.assigned} student${r.assigned === 1 ? '' : 's'}` : 'Everyone already has this practice', 'ok'); route(); } catch (e) { toast(e.message, 'bad'); } }, 'big');
  page([{ label: 'Classes', href: '#/t' }, { label: 'Test', href: '#/t/a/' + aid }, { label: 'Results', href: `#/t/a/${aid}/results` }, { label: kit.name }],
    head(kit.name, kit.explanation, btn('Rename', 'ghost', rename, 'small')),
    h('div', { class: 'list' },
      h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:10px' }, 'Students in this group'), h('div', { class: 'pill-list' }, kit.students.map((s) => h('span', { class: 'chip plum' }, s.name)))),
      h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:6px' }, 'What the mistake looks like'), kit.examples.map((e, i) => h('div', { class: 'qrow' }, h('div', { class: 'qno' }, i + 1), h('div', {}, h('span', { class: 'expr' }, e.question + ' = '), h('span', {}, e.studentWrote), h('span', { class: 'muted' }, '   (correct: ' + e.correct + ')'))))),
      h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:4px' }, 'Sample practice questions'), h('p', { class: 'muted small', style: 'margin-bottom:8px' }, 'Made with new numbers. The answers are worked out by the computer. Each student gets their own numbers.'),
        kit.samplePractice.length ? kit.samplePractice.map((q) => h('div', { class: 'qrow' }, h('div', { class: 'qno' }, q.number), h('span', { class: 'expr' }, q.prompt), h('span', { class: 'chip leaf' }, 'Answer: ' + q.answer))) : h('p', { class: 'muted' }, 'Practice could not be made for this pattern.')),
      tipsCard(aid, sig),
      h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:4px' }, 'Learning resources'), h('p', { class: 'muted small', style: 'margin-bottom:8px' }, 'Found online using only the topic name. No student information is sent.'),
        kit.resources.resources.length ? h('div', { class: 'list' }, kit.resources.resources.map((r) => h('a', { class: 'item', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, h('div', {}, h('strong', {}, r.title), r.summary ? h('p', { class: 'muted small' }, r.summary) : null)))) : h('p', { class: 'muted' }, kit.resources.message || 'No resources found.')),
      h('div', { class: 'row' }, assign, kit.assignedCount ? h('span', { class: 'chip leaf' }, kit.assignedCount + ' practice sheets given') : null),
      (window.GM.groupActions ? window.GM.groupActions(aid, sig, kit) : null)));
}

function tipsCard(aid, sig) {
  const out = h('div'), card = h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:4px' }, 'Teaching ideas (AI)'),
    h('p', { class: 'muted small', style: 'margin-bottom:10px' }, 'Written by AI from the pattern name only. No student information is sent. Use your own judgement.'), out);
  const go = btn('Get teaching ideas', 'plum', async () => {
    const done = busy('Asking for ideas');
    try { const t = await api('POST', `/assessments/${aid}/kit/tips`, { signature: sig }); done(); go.remove();
      out.replaceChildren(h('ol', { class: 'ideas' }, t.activities.map((x) => h('li', {}, x))), t.checkQuestion ? h('p', {}, h('strong', {}, 'Ask the class: '), t.checkQuestion) : null); }
    catch (e) { done(); out.replaceChildren(errorBox(e.message)); } });
  out.append(go);
  return card;
}

async function historyScreen(cid) {
  const [classes, rows] = await Promise.all([api('GET', '/classes'), api('GET', `/classes/${cid}/history`)]);
  const c = classes.find((x) => String(x.id) === String(cid)) || { name: 'Class' };
  page([{ label: 'Classes', href: '#/t' }, { label: c.name, href: '#/t/c/' + cid }, { label: 'Who needs help' }], head('Who needs help', 'Students who made mistakes, and which ones.'),
    rows.length ? h('div', { class: 'list' }, rows.map((r) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('strong', {}, r.student), h('p', { class: 'muted small' }, r.assessment)),
      r.likely.map((n) => h('span', { class: 'chip plum' }, n)), r.suspected.map((n) => h('span', { class: 'chip sun' }, 'Suspected: ' + n)), r.needsReview ? h('span', { class: 'chip rose' }, 'Needs review') : null, h('span', { class: 'chip' }, `${r.marks}/${r.total}`))))
      : empty('No mistakes recorded yet', 'Check some answer sheets and they will appear here.'));
}

// ---------- student portal ----------
// What the student's problem is, in plain words. Never says "nice work" if answers were wrong.
function problemCard(res) {
  const p = res.problem || { kind: 'none', wrong: [] };
  const title = h('h3', { style: 'margin-bottom:10px' }, p.kind === 'none' ? 'Your problem areas' : 'Your problem: what to work on');
  let body;
  if (p.kind === 'likely') {
    body = [h('div', { class: 'list' }, res.likely.map((l) => h('div', {}, h('strong', {}, l.name), h('p', { class: 'muted' }, l.explanation), h('p', { class: 'small muted' }, 'Seen in ' + qlist(l.questions) + '. The same mistake showed up in 2 or more questions.')))),
      h('p', { class: 'small', style: 'margin-top:12px' }, 'Next step: use "Make a new practice set" below. It makes new questions for this exact mistake.')];
  } else if (p.kind === 'suspected') {
    body = [h('div', { class: 'list' }, res.suspected.map((s) => h('div', {}, h('strong', {}, s.name), h('p', { class: 'small muted' }, 'Possible problem. It showed up in ' + qlist(s.questions) + ' only, so your teacher will confirm it with you.')))),
      p.wrongCount ? h('p', { class: 'small muted', style: 'margin-top:8px' }, `You got ${p.wrongCount} question${p.wrongCount === 1 ? '' : 's'} wrong (${qlist(p.wrong)}). The right answers are listed below.`) : null];
  } else if (p.kind === 'unclear') {
    body = [h('p', {}, p.wrongCount ? `You got ${p.wrongCount} question${p.wrongCount === 1 ? '' : 's'} wrong (${qlist(p.wrong)}).` : 'Some answers need your teacher to check them.'),
      h('p', { class: 'muted', style: 'margin-top:6px' }, 'The computer could not find one repeated mistake yet. Look at the correct answers below, redo those questions, and ask your teacher to go through them with you.'),
      res.reviewCount ? h('p', { class: 'small muted', style: 'margin-top:6px' }, res.reviewCount + ' answer(s) could not be read. Your teacher will check them.') : null];
  } else body = [h('p', { class: 'muted' }, 'No mistakes were found in this test. Nice work.')];
  return h('div', { class: 'slab', 'data-testid': 'problem-card' }, title, body);
}
async function studentResults() {
  const d = await api('GET', '/student/home');
  const res = d.results[0];
  page([{ label: 'Home', href: '#/s' }, { label: 'Results' }], head('Hi, ' + d.name), 
    !res ? empty('Nothing to show yet', 'When your teacher checks your sheet, your marks and practice will appear here.') : h('div', { class: 'list' },
      h('div', { class: 'slab row' }, ring(res.marks, res.total), h('div', {}, h('h2', {}, res.title), h('p', { class: 'muted' }, `You got ${res.marks} out of ${res.total} right.`))),
      problemCard(res),
      h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:6px' }, 'Your answers'), res.items.map((it) => h('div', { class: 'qrow' }, h('div', { class: 'qno' }, it.q), h('div', {}, h('span', { class: 'expr' }, it.expression + ' = '), h('span', {}, it.yourAnswer)),
        it.status === 'correct' ? h('span', { class: 'chip leaf' }, 'Right') : h('div', { style: 'display:flex;flex-direction:column;align-items:flex-end;gap:6px' }, h('span', { class: 'chip rose' }, it.status === 'wrong' ? 'Correct answer: ' + it.correct : 'Your teacher will check'),
          it.pattern ? h('span', { class: 'small muted', style: 'text-align:right;max-width:260px' }, 'Looks like: ' + it.pattern) : null))))),
    d.gaps.length ? h('div', { class: 'slab', style: 'margin-top:26px' }, h('h3', { style: 'margin-bottom:6px' }, 'Practise a gap'), h('p', { class: 'muted small', style: 'margin-bottom:12px' }, 'New questions with new numbers, made from your own mistakes. Answers are checked by the computer.'),
      h('div', { class: 'list' }, d.gaps.map((g) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('strong', {}, g.name), h('p', { class: 'muted small' }, `${g.setsMade} of ${g.maxSets} practice sets used`)),
        h('button', { class: 'btn leaf small', type: 'button', disabled: g.setsMade >= g.maxSets, onclick: async () => { try { const r = await api('POST', '/student/practice/new', { assessmentId: g.assessmentId, signature: g.signature }); location.hash = '#/s/practice/' + r.id; } catch (e) { toast(e.message, 'bad'); } } }, 'Make a new practice set'))))) : null,
    progressCard(res, d.practice),
    d.practice.length ? h('div', { style: 'margin-top:30px' }, h('h2', { style: 'margin-bottom:14px' }, 'Your practice'), h('div', { class: 'list' }, d.practice.map((p) => h('a', { class: 'item', href: '#/s/practice/' + p.id }, h('strong', { class: 'grow' }, p.title), p.done ? h('span', { class: 'chip leaf' }, `Score ${p.score}/${p.total}`) : h('span', { class: 'chip blue' }, 'Start'))))) : null);
}
function progressCard(res, practice) {
  const done = practice.filter((p) => p.done);
  if (!res || !done.length) return null;
  const pct = (a, b) => Math.round((a / b) * 100);
  const first = done[done.length - 1], last = done[0];
  return h('div', { class: 'slab', style: 'margin-top:26px' }, h('h3', { style: 'margin-bottom:10px' }, 'Your progress'),
    hbar('Test', [{ value: pct(res.marks, res.total), color: 'blue', max: 100 }], `${res.marks}/${res.total}`),
    hbar('Practice', [{ value: pct(last.score, last.total), color: 'leaf', max: 100 }], `${last.score}/${last.total}`),
    done.length > 1 ? h('p', { class: 'small muted', style: 'margin-top:8px' }, `First practice ${first.score}/${first.total}, latest ${last.score}/${last.total}.`) : null);
}
async function practiceScreen(pid) {
  const p = await api('GET', '/student/practice/' + pid);
  const inputs = p.questions.map((q) => h('input', { 'aria-label': 'Answer to ' + q.prompt, placeholder: 'e.g. 3/4', autocomplete: 'off', value: q.yourAnswer || '', disabled: p.done }));
  page([{ label: 'Home', href: '#/s' }, { label: 'Practice' }], head(p.title, p.done ? `You scored ${p.score} out of ${p.total}.` : 'Write each answer as a fraction or a whole number.'),
    h('div', { class: 'slab' }, p.questions.map((q, i) => h('div', { class: 'qrow' }, h('div', { class: 'qno' }, q.number), h('div', {}, h('span', { class: 'expr' }, q.instruction + ': ' + q.prompt), p.done ? h('p', { class: 'small muted' }, 'Correct answer: ' + q.answer) : null, p.done && !q.correct ? hintBox(pid, q.number) : null), p.done ? h('span', { class: 'chip ' + (q.correct ? 'leaf' : 'rose') }, q.correct ? 'Right' : 'Not yet') : inputs[i])),
      p.done ? h('div', { class: 'row', style: 'margin-top:18px' }, link('Back to home', '#/s', 'leaf')) : h('div', { class: 'row', style: 'margin-top:20px;justify-content:flex-end' }, btn('Submit answers', 'leaf', async () => {
        const answers = {}; p.questions.forEach((q, i) => { answers[q.number] = inputs[i].value.trim(); });
        try { const r = await api('POST', `/student/practice/${pid}/submit`, { answers });
          modal({ title: `You scored ${r.score} out of ${r.total}`, body: h('p', { class: 'muted' }, r.score === r.total ? 'All correct. Great work.' : 'You will see the correct answers next. Look at the ones you missed.'), actions: [{ label: 'See answers', color: 'leaf', onclick: (c) => { c(); route(); } }] });
        } catch (e) { toast(e.message, 'bad'); } }, 'big'))));
}

function hintBox(pid, number) {
  const out = h('div', { class: 'small', style: 'margin-top:6px' });
  const b = h('button', { class: 'btn plum small', type: 'button', onclick: async () => {
    b.disabled = true;
    try { const r = await api('POST', `/student/practice/${pid}/hint`, { number }); b.remove(); out.replaceChildren(h('p', {}, r.hint), h('p', { class: 'muted' }, 'AI hint. If it does not make sense, ask your teacher.')); }
    catch (e) { b.disabled = false; out.replaceChildren(errorBox(e.message)); } } }, 'Show a hint (AI)');
  return h('div', {}, b, out);
}

// ---------- router ----------
const routes = [
  [/^\/login$/, () => roleScreen(), false],
  [/^\/login\/(teacher|student|parent)$/, (r) => loginScreen(r), false],
  [/^\/t$/, teacherHome, 'teacher'],
  [/^\/t\/c\/(\d+)$/, classHub, 'teacher'],
  [/^\/t\/c\/(\d+)\/students$/, studentsScreen, 'teacher'],
  [/^\/t\/c\/(\d+)\/tests$/, testsScreen, 'teacher'],
  [/^\/t\/c\/(\d+)\/tests\/new$/, newTestScreen, 'teacher'],
  [/^\/t\/c\/(\d+)\/history$/, historyScreen, 'teacher'],
  [/^\/t\/a\/(\d+)$/, testHub, 'teacher'],
  [/^\/t\/a\/(\d+)\/sheet$/, pickStudent, 'teacher'],
  [/^\/t\/a\/(\d+)\/sheet\/(\d+)$/, pickMethod, 'teacher'],
  [/^\/t\/a\/(\d+)\/sheet\/(\d+)\/type$/, typeAnswers, 'teacher'],
  [/^\/t\/s\/(\d+)$/, sheetScreen, 'teacher'],
  [/^\/t\/a\/(\d+)\/results$/, resultsScreen, 'teacher'],
  [/^\/t\/a\/(\d+)\/overview$/, overviewScreen, 'teacher'],
  [/^\/t\/a\/(\d+)\/group\/(.+)$/, (a, sig) => groupScreen(a, decodeURIComponent(sig)), 'teacher'],
  [/^\/s\/results$/, studentResults, 'student'],
  [/^\/s\/practice\/(\d+)$/, practiceScreen, 'student'],
];
async function route() {
  if (closeCurrentModal) closeCurrentModal();
  const path = (location.hash || '#/').slice(1) || '/';
  if (path === '/') { location.hash = state.user ? homeOf(state.user) : '#/login'; return; }
  for (const [re, fn, role] of routes) {
    const m = path.match(re); if (!m) continue;
    if (role && (!state.user || state.user.role !== role)) { location.hash = state.user ? '#/' : '#/login'; return; }
    if (!role && state.user && /^\/login/.test(path)) { location.hash = homeOf(state.user); return; }
    try { if (role) loading(); await fn(...m.slice(1)); }
    catch (e) { page([{ label: 'Home', href: '#/' }], empty('That did not work', e.message, link('Go back', '#/', 'blue'))); }
    return;
  }
  page([{ label: 'Home', href: '#/' }], empty('Page not found', 'Check the link, or go back home.', link('Go home', '#/', 'blue')));
}
window.addEventListener('hashchange', route);
// extras.js (loaded after this file) adds routes and then calls GM.start(). If it is missing, the load event starts the app anyway.
window.GM = { homeOf, h, api, state, toast, modal, busy, btn, link, page, head, empty, errorBox, steps, icon, ICONS, ring, hbar, vbars, legend, qlist, loading, route, routes, signOut,
  started: false, start() { if (this.started) return; this.started = true; route(); } };
window.addEventListener('load', () => window.GM.start());
})();
