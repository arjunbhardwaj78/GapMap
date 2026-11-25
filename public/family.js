/* GapMap Milestone 11 frontend: attendance, notice board, parent logins, parent portal.
   Loaded after choice.js and BEFORE extras.js (extras.js calls GM.start()). All server text goes in with h() (textContent), never innerHTML.
   Wording rule kept: a repeated mistake is "likely", never "proven". A parent sees their own child only. */
(() => {
'use strict';
const GM = window.GM;
const { h, api, state, toast, busy, btn, link, page, head, empty, errorBox, icon, route, modal } = GM;
const enc = encodeURIComponent;
const crumbsFor = (cid, name, last) => [{ label: 'Classes', href: '#/t' }, { label: name || 'Class', href: '#/t/c/' + cid }, { label: last }];
const className = async (cid) => ((await api('GET', '/classes')).find((x) => String(x.id) === String(cid)) || {}).name || 'Class';
const note = (text) => h('p', { class: 'small muted', style: 'margin-top:8px' }, text);
const STATUS = [['present', 'Present', 'leaf'], ['absent', 'Absent', 'rose'], ['late', 'Late', 'sun'], ['leave', 'Leave', 'blue']];
const STATUS_NAME = { present: 'Present', absent: 'Absent', late: 'Late', leave: 'Leave' };
const KIND = { notice: ['Notice', 'blue'], praise: ['Praise', 'leaf'], concern: ['Concern', 'sun'], from_parent: ['From parent', 'plum'] };
const kindChip = (k) => h('span', { class: 'chip ' + (KIND[k] || KIND.notice)[1] }, (KIND[k] || KIND.notice)[0]);
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

async function download(path, fallbackName) {
  try {
    const res = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + state.token } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed.');
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || fallbackName;
    const url = URL.createObjectURL(await res.blob());
    const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { toast(e.message, 'bad'); }
}
const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast('Copied', 'ok'), () => toast('Could not copy', 'bad'));

// ================= TEACHER: attendance =================
async function attendanceScreen(cid) {
  const cname = await className(cid);
  const box = h('div'), summary = h('div');
  let current = null;

  async function loadSummary() {
    try {
      const s = await api('GET', `/classes/${cid}/attendance-summary`);
      summary.replaceChildren(h('div', { class: 'slab', style: 'margin-top:26px' },
        h('div', { class: 'head', style: 'margin:0 0 14px' }, h('div', {}, h('h3', {}, 'Attendance so far'),
          h('p', { class: 'small muted' }, s.classDays ? `${plural(s.classDays, 'school day')} marked. Leave is not counted against a student. Below ${s.threshold}% is shown in red.` : 'Nothing marked yet.')),
          s.classDays ? btn('Download CSV', 'blue', () => download(`/classes/${cid}/attendance.csv`, 'attendance.csv'), 'small') : null),
        s.lowCount ? h('div', { class: 'note', style: 'margin-bottom:12px' }, `${plural(s.lowCount, 'student')} below ${s.threshold}%.`) : null,
        s.students.length ? h('div', { class: 'list' }, s.students.map((r) => h('div', { class: 'item' },
          h('div', { class: 'grow' }, h('strong', {}, r.name), r.roll ? h('span', { class: 'muted' }, '  Roll ' + r.roll) : null),
          h('span', { class: 'chip leaf' }, 'Present ' + r.present), h('span', { class: 'chip sun' }, 'Late ' + r.late), h('span', { class: 'chip rose' }, 'Absent ' + r.absent), h('span', { class: 'chip blue' }, 'Leave ' + r.leave),
          h('span', { class: 'chip ' + (r.low ? 'rose' : r.pct === null ? '' : 'leaf'), title: r.pct === null ? 'Needs at least one present, late or absent day' : '' }, r.pct === null ? 'No % yet' : r.pct + '%')))) : null));
    } catch (e) { summary.replaceChildren(errorBox(e.message)); }
  }

  function draw(data) {
    current = data.date;
    const marks = {}; data.students.forEach((s) => { marks[s.id] = s.status || ''; });
    const counter = h('span', { class: 'chip' });
    const dateInput = h('input', { type: 'date', id: 'ad', value: data.date, max: data.today, 'aria-label': 'Day' });
    dateInput.addEventListener('change', () => { if (dateInput.value) load(dateInput.value); else dateInput.value = current; });
    const count = () => { const n = Object.values(marks).filter(Boolean).length; counter.textContent = `${n} of ${data.students.length} marked`; };
    const paints = [];
    const rows = data.students.map((s) => {
      const btns = h('div', { class: 'row', style: 'gap:6px' });
      const paint = () => btns.replaceChildren(...STATUS.map(([k, label, color]) => h('button', {
        type: 'button', class: 'btn small ' + (marks[s.id] === k ? color : 'ghost'), 'aria-pressed': marks[s.id] === k ? 'true' : 'false', 'aria-label': `${label}: ${s.name}`,
        onclick: () => { marks[s.id] = marks[s.id] === k ? '' : k; paint(); count(); } }, label)));
      paints.push(paint); paint();
      return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('strong', {}, s.name), s.roll ? h('span', { class: 'muted' }, '  Roll ' + s.roll) : null), btns);
    });
    const markAll = () => { data.students.forEach((s) => { if (!marks[s.id]) marks[s.id] = 'present'; }); paints.forEach((p) => p()); count(); };
    const save = btn('Save attendance', 'leaf', async () => {
      const done = busy('Saving');
      try { const r = await api('POST', `/classes/${cid}/attendance`, { date: data.date, marks }); done(); toast(`Saved ${plural(r.markedCount, 'mark')} for ${data.date}`, 'ok'); await loadSummary(); }
      catch (e) { done(); toast(e.message, 'bad'); }
    }, 'big');
    count();
    box.replaceChildren(h('div', { class: 'slab' },
      h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:14px' },
        h('div', { class: 'field', style: 'margin:0;max-width:220px' }, h('label', { for: 'ad' }, 'Day'), dateInput),
        h('div', { class: 'row' }, counter, btn('Mark everyone present', 'ghost', markAll, 'small'), data.date !== data.today ? btn('Today', 'ghost', () => load(null), 'small') : null)),
      data.students.length ? h('div', { class: 'list' }, rows) : empty('No students yet', 'Add students to this class first.', link('Add students', `#/t/c/${cid}/students`, 'leaf')),
      data.students.length ? h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:16px' }, save) : null,
      note('You can mark any day from the last 120 days, but not a day that has not happened yet. Tap a button again to clear it.')));
  }
  async function load(d) {
    try { draw(await api('GET', `/classes/${cid}/attendance${d ? '?date=' + enc(d) : ''}`)); }
    catch (e) { box.replaceChildren(errorBox(e.message)); }
  }
  page(crumbsFor(cid, cname, 'Attendance'), head('Attendance', 'Mark the day. Percentages and the 75% warning are worked out by the computer.'), box, summary);
  await Promise.all([load(null), loadSummary()]);
}

// ================= TEACHER: notices and parent messages =================
async function noticesTeacher(cid) {
  const [cname, students] = await Promise.all([className(cid), api('GET', `/classes/${cid}/students`)]);
  const listBox = h('div');
  const to = h('select', { id: 'nto' }, h('option', { value: '' }, 'Whole class'), students.map((s) => h('option', { value: s.id }, s.name + (s.roll ? ' (roll ' + s.roll + ')' : ''))));
  const kind = h('select', { id: 'nkind' }, h('option', { value: 'notice' }, 'Notice'), h('option', { value: 'praise' }, 'Praise'), h('option', { value: 'concern' }, 'Concern'));
  const title = h('input', { id: 'ntitle', maxlength: 80, placeholder: 'For example: Unit test on Friday' });
  const body = h('textarea', { id: 'nbody', maxlength: 600, rows: 4, style: 'font-family:inherit', placeholder: 'Write the message. Students and their parents can read it.' });
  const err = h('div');

  async function loadList() {
    try {
      const list = await api('GET', `/classes/${cid}/notices`);
      const fromParents = list.filter((n) => n.fromParent).length;
      listBox.replaceChildren(
        fromParents ? h('div', { class: 'note', style: 'margin-bottom:12px' }, `${plural(fromParents, 'message')} from parents. Only you and that parent can read them.`) : null,
        list.length ? h('div', { class: 'list' }, list.map((n) => h('div', { class: 'item', style: 'align-items:flex-start' },
          h('div', { class: 'grow' }, h('div', { class: 'row', style: 'gap:8px' }, kindChip(n.kind), h('strong', {}, n.title), n.receipt && n.receipt.of ? h('span', { class: 'chip blue' }, `Seen by ${n.receipt.seen} of ${plural(n.receipt.of, 'parent')}`) : null),
            h('p', { style: 'margin:6px 0 4px;white-space:pre-wrap' }, n.body),
            h('p', { class: 'small muted' }, (n.fromParent ? 'About ' : 'To: ') + (n.studentName || 'Whole class') + ' · ' + n.when + (n.fromParent ? '' : ' · ' + (n.authorName || ''))),
            ),
          btn('Delete', 'ghost', async (ev) => {
            const b = ev.currentTarget;
            if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Click again to delete'; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = 'Delete'; } }, 3500); return; }
            try { await api('DELETE', '/notices/' + n.id); loadList(); } catch (e) { toast(e.message, 'bad'); }
          }, 'small')))) : empty('No notices yet', 'Post the first notice above. Students and parents see it on their home page.'));
    } catch (e) { listBox.replaceChildren(errorBox(e.message)); }
  }
  const post = btn('Post', 'leaf', async () => {
    err.replaceChildren();
    const done = busy('Posting');
    try {
      await api('POST', `/classes/${cid}/notices`, { title: title.value, body: body.value, kind: kind.value, studentId: to.value || null });
      done(); title.value = ''; body.value = ''; toast('Posted', 'ok'); loadList();
    } catch (e) { done(); err.replaceChildren(errorBox(e.message)); }
  }, 'big');
  page(crumbsFor(cid, cname, 'Notices and parents'), head('Notices and parent messages', 'Post a notice for the whole class, or a note about one student. Parents can write back to you here.'),
    h('div', { class: 'slab' }, err,
      h('div', { class: 'row' }, h('div', { class: 'field', style: 'flex:1;min-width:200px' }, h('label', { for: 'nto' }, 'To'), to), h('div', { class: 'field', style: 'flex:1;min-width:160px' }, h('label', { for: 'nkind' }, 'Type'), kind)),
      h('div', { class: 'field' }, h('label', { for: 'ntitle' }, 'Title'), title), h('div', { class: 'field' }, h('label', { for: 'nbody' }, 'Message'), body),
      h('div', { class: 'row', style: 'justify-content:flex-end' }, post)),
    h('div', { style: 'margin-top:26px' }, listBox));
  await loadList();
}

// ================= TEACHER: parent login modal (opened from the Students list) =================
GM.parentLoginModal = async (s) => {
  const body = h('div');
  const view = { creds: null };
  const relation = h('select', { id: 'prel' }, ['Mother', 'Father', 'Guardian', 'Other'].map((r) => h('option', { value: r }, r)));
  const name = h('input', { id: 'pname', maxlength: 60, placeholder: "Parent's or guardian's name" });
  const pw = h('input', { id: 'ppw', type: 'text', autocomplete: 'off', placeholder: 'Leave empty for a random 6-digit password' });
  const linkU = h('input', { id: 'plink', autocomplete: 'off', placeholder: 'For example: parent-asha1' });
  const phone = h('input', { id: 'pphone', inputmode: 'tel', autocomplete: 'off', maxlength: 20, placeholder: '10-digit mobile (optional)' });
  const err = h('div');

  const credsBlock = (c, title) => h('div', { class: 'slab', style: 'margin-bottom:16px' }, h('h3', { style: 'margin-bottom:6px' }, title),
    h('p', { class: 'small muted', style: 'margin-bottom:10px' }, 'Write this down now. The password is shown only once. The parent can change it after signing in.'),
    h('div', { class: 'pin' }, c.username + '  /  ' + c.password),
    h('div', { class: 'row', style: 'margin-top:10px' }, btn('Copy', 'blue', () => copy(`Username: ${c.username}\nPassword: ${c.password}\n(Sign in at the Parent door)`), 'small'), btn('Done', 'ghost', () => { view.creds = null; refresh(); }, 'small')));

  async function refresh() {
    try {
      const list = await api('GET', `/students/${s.id}/parents`);
      body.replaceChildren(
        view.creds ? credsBlock(view.creds.c, view.creds.title) : '', err,
        list.length ? h('div', { class: 'list', style: 'margin-bottom:18px' }, list.map((p) => h('div', { class: 'item', style: 'flex-wrap:wrap' },
          h('div', { class: 'grow' }, h('strong', {}, p.name), h('span', { class: 'muted' }, '  ' + p.relation), h('p', { class: 'small muted' }, 'Username: ' + p.username)),
          btn('New password', 'ghost', async () => { try { const r = await api('POST', `/students/${s.id}/parents/${p.userId}/reset`); view.creds = { c: r, title: 'New password for ' + p.name }; refresh(); } catch (e) { err.replaceChildren(errorBox(e.message)); } }, 'small'),
          btn('Remove', 'ghost', async (ev) => {
            const b = ev.currentTarget;
            if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Click again'; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = 'Remove'; } }, 3500); return; }
            try { await api('DELETE', `/students/${s.id}/parents/${p.userId}`); refresh(); } catch (e) { err.replaceChildren(errorBox(e.message)); }
          }, 'small'),
          h('div', { style: 'flex-basis:100%' }, h('span', { class: 'small muted' }, 'Contact: '), GM.contactLine ? GM.contactLine(p.contact, p.name) : null)))) : h('p', { class: 'muted', style: 'margin-bottom:14px' }, 'No parent login yet.'),
        h('h3', { style: 'margin-bottom:8px' }, 'Make a parent login'),
        h('div', { class: 'row' }, h('div', { class: 'field', style: 'flex:2;min-width:180px' }, h('label', { for: 'pname' }, 'Name'), name), h('div', { class: 'field', style: 'flex:1;min-width:120px' }, h('label', { for: 'prel' }, 'Relation'), relation)),
        h('div', { class: 'field' }, h('label', { for: 'ppw' }, 'Password (optional, at least 6 characters)'), pw),
        h('div', { class: 'field' }, h('label', { for: 'pphone' }, 'Mobile number (optional)'), phone, h('p', { class: 'hint', style: 'margin:4px 0 0' }, 'Kept private. You will only see it again if the parent switches sharing on in their own settings.')),
        btn('Make login', 'plum', async () => {
          err.replaceChildren();
          try { const r = await api('POST', `/students/${s.id}/parents`, { name: name.value, relation: relation.value, password: pw.value, phone: phone.value }); name.value = ''; pw.value = ''; phone.value = ''; view.creds = { c: r.login, title: 'Login for ' + r.name }; refresh(); }
          catch (e) { err.replaceChildren(errorBox(e.message)); }
        }),
        h('hr', { style: 'border:0;border-top:1px solid var(--line);margin:22px 0' }),
        h('h3', { style: 'margin-bottom:4px' }, 'Brother or sister already has a parent login?'),
        h('p', { class: 'hint', style: 'margin:0 0 8px' }, 'Type that parent\'s username to give them this child too. One login then shows all their children.'),
        h('div', { class: 'row' }, h('div', { class: 'field', style: 'flex:1;min-width:200px;margin:0' }, h('label', { for: 'plink', class: 'small muted' }, 'Existing parent username'), linkU),
          btn('Link', 'blue', async () => {
            err.replaceChildren();
            try { const r = await api('POST', `/students/${s.id}/parents`, { linkUsername: linkU.value, relation: relation.value }); linkU.value = ''; toast('Linked ' + r.name, 'ok'); refresh(); }
            catch (e) { err.replaceChildren(errorBox(e.message)); }
          }, 'small')));
    } catch (e) { body.replaceChildren(errorBox(e.message)); }
  }
  modal({ title: 'Parent logins for ' + s.name, body, actions: [{ label: 'Close', color: 'ghost', onclick: (c) => c() }] });
  refresh();
};

// ================= PARENT =================
GM.changePasswordModal = () => {
  const oldP = h('input', { id: 'opw', type: 'password', autocomplete: 'current-password' }), newP = h('input', { id: 'npw', type: 'password', autocomplete: 'new-password' });
  const err = h('div');
  modal({ title: 'Change your password', body: h('div', {}, err, h('div', { class: 'field' }, h('label', { for: 'opw' }, 'Current password'), oldP), h('div', { class: 'field' }, h('label', { for: 'npw' }, 'New password (at least 6 characters)'), newP)),
    actions: [{ label: 'Cancel', onclick: (c) => c() }, { label: 'Save password', color: 'plum', onclick: async (close) => {
      try { await api('POST', '/parent/change-password', { oldPassword: oldP.value, newPassword: newP.value }); close(); toast('Password changed. Please sign in again.', 'ok'); setTimeout(() => GM.signOut(true), 900); }
      catch (e) { err.replaceChildren(errorBox(e.message)); } } }] });
};

async function parentHome() {
  const kids = await api('GET', '/parent/children');
  page([{ label: 'Home' }], head('Hello, ' + state.user.name, kids.length ? 'Tap a child to see how they are doing.' : null, btn('My contact details', 'ghost', () => GM.contactModal && GM.contactModal(), 'small')),
    kids.length ? GM.hindiSummaryButton(null) : null,
    kids.length ? h('div', { class: 'grid', style: 'margin-top:18px' }, kids.map((k) => h('a', { class: 'tile', href: '#/p/c/' + k.id },
      h('div', { class: 'ico plum' }, icon('parent')), h('h2', {}, k.name), h('p', { class: 'muted' }, k.className),
      h('div', { class: 'pill-list' },
        k.needsAttention ? h('span', { class: 'chip sun' }, 'Worth a look') : h('span', { class: 'chip leaf' }, 'Doing fine so far'),
        k.attendancePct !== null ? h('span', { class: 'chip ' + (k.attendanceLow ? 'rose' : '') }, 'Attendance ' + k.attendancePct + '%') : null,
        k.latestTest ? h('span', { class: 'chip blue' }, `${k.latestTest.title}: ${k.latestTest.marks}/${k.latestTest.total}`) : null,
        k.overdueHomework ? h('span', { class: 'chip rose' }, plural(k.overdueHomework, 'homework task') + ' overdue') : null))))
      : empty('No child linked yet', 'Ask the teacher to link your login to your child.'),
    h('p', { class: 'small muted', style: 'margin-top:26px' }, 'You see your own child only. Private interview practice is never shown to parents.'));
}

const section = (title, sub, ...kids) => h('div', { class: 'slab', style: 'margin-top:22px' }, h('h3', { style: 'margin-bottom:' + (sub ? '4' : '12') + 'px' }, title), sub ? h('p', { class: 'small muted', style: 'margin-bottom:12px' }, sub) : null, ...kids);

async function parentChild(id) {
  const r = await api('GET', '/parent/children/' + id);
  const msg = h('textarea', { id: 'pmsg', maxlength: 500, rows: 3, style: 'font-family:inherit', placeholder: 'Write to the teacher (up to 500 letters). You can send 5 messages a day.' });
  const merr = h('div');
  const send = btn('Send to teacher', 'plum', async () => {
    merr.replaceChildren();
    const done = busy('Sending');
    try { await api('POST', `/parent/children/${id}/message`, { body: msg.value }); done(); toast('Sent to the teacher', 'ok'); route(); }
    catch (e) { done(); merr.replaceChildren(errorBox(e.message)); }
  });
  const att = r.attendance;
  page([{ label: 'Home', href: '#/p' }, { label: r.student.name }],
    head(r.student.name, r.student.className + (r.student.roll ? ' · Roll ' + r.student.roll : ''), h('span', { class: 'row', style: 'gap:8px' }, link('Academic report', '#/p/c/' + id + '/report', 'leaf', 'small'), btn('Print this page', 'blue', () => window.print(), 'small'))),
    GM.hindiSummaryButton(id),
    section('At a glance', null, h('div', { class: 'list' }, r.highlights.map((x) => h('div', { class: 'item' }, h('span', { class: 'chip ' + (x.level === 'watch' ? 'sun' : 'leaf') }, x.level === 'watch' ? 'Worth a look' : 'Fine'), h('div', { class: 'grow' }, x.text))))),

    section('Tests', 'Marks come from the teacher\'s check. A repeated mistake is a likely pattern, not proof.',
      r.tests.length ? h('div', { class: 'list' }, r.tests.map((t) => h('div', { class: 'item', style: 'align-items:flex-start' },
        h('div', { class: 'grow' }, h('strong', {}, t.title),
          t.patterns.length ? t.patterns.map((p) => h('p', { class: 'small', style: 'margin-top:6px' }, h('span', { class: 'chip sun' }, 'Likely pattern'), ' ', p.name, p.explanation ? ' - ' + p.explanation : '')) : null,
          t.suspected.length ? h('p', { class: 'small muted', style: 'margin-top:6px' }, 'Possible, shown once only: ' + t.suspected.join(', ')) : null,
          t.needsReview ? h('p', { class: 'small muted', style: 'margin-top:6px' }, plural(t.needsReview, 'answer') + ' still waiting for the teacher to check.') : null),
        h('span', { class: 'chip blue' }, `${t.marks} / ${t.total}`)))) : h('p', { class: 'muted' }, 'No test results yet.')),

    r.quizzes.length ? section('Quizzes', null, h('div', { class: 'list' }, r.quizzes.map((q) => h('div', { class: 'item', style: 'align-items:flex-start' },
      h('div', { class: 'grow' }, h('strong', {}, q.title), h('p', { class: 'small muted' }, q.when), q.ideas.length ? h('p', { class: 'small', style: 'margin-top:4px' }, (q.problem === 'likely' ? 'Likely mistaken idea: ' : 'Possible mistaken idea: ') + q.ideas.map((i) => i.name).join('; ')) : null),
      q.paper ? h('span', { class: 'chip plum' }, 'Paper test') : null, h('span', { class: 'chip blue' }, `${q.score} / ${q.total}`))))) : null,

    section('Homework', null, r.homework.length ? h('div', { class: 'list' }, r.homework.map((x) => h('div', { class: 'item' },
      h('div', { class: 'grow' }, h('strong', {}, x.title), x.due ? h('p', { class: 'small muted' }, 'Due ' + x.due) : null),
      x.done ? h('span', { class: 'chip leaf' }, `Handed in${x.marks !== null ? ': ' + x.marks + '/' + x.total : ''}`) : x.overdue ? h('span', { class: 'chip rose' }, 'Overdue') : h('span', { class: 'chip' }, 'Not yet due or not handed in')))) : h('p', { class: 'muted' }, 'No homework yet.')),

    section('Attendance', att.pct === null ? 'Not enough days marked to show a percentage.' : `Below ${att.threshold}% is flagged. Approved leave is not counted against the student.`,
      att.pct !== null ? h('p', { style: 'font-size:1.6rem;font-weight:800;margin-bottom:10px', class: att.low ? 'bad' : '' }, att.pct + '%', att.low ? h('span', { class: 'chip rose', style: 'margin-left:10px;vertical-align:middle' }, 'Below ' + att.threshold + '%') : null) : null,
      h('div', { class: 'pill-list' }, h('span', { class: 'chip leaf' }, 'Present ' + att.present), h('span', { class: 'chip sun' }, 'Late ' + att.late), h('span', { class: 'chip rose' }, 'Absent ' + att.absent), h('span', { class: 'chip blue' }, 'Leave ' + att.leave)),
      att.recent.length ? h('div', { class: 'pill-list', style: 'margin-top:12px' }, att.recent.map((d) => h('span', { class: 'chip', title: d.day }, d.day.slice(5) + ' ' + STATUS_NAME[d.status]))) : null),

    section('Effort', 'Counts only what your child did in the app.', h('div', { class: 'pill-list' },
      h('span', { class: 'chip' }, 'Streak: ' + plural(r.effort.streak, 'day')), h('span', { class: 'chip' }, 'Active ' + r.effort.activeDaysLast7 + ' of the last 7 days'),
      h('span', { class: 'chip' }, `Practice sets done: ${r.practice.done} of ${r.practice.sets}`), r.effort.badges.map((b) => h('span', { class: 'chip sun' }, b)))),

    section('Notices', null, r.notices.length ? h('div', { class: 'list' }, r.notices.map((n) => h('div', { class: 'item', style: 'align-items:flex-start' },
      h('div', { class: 'grow' }, h('div', { class: 'row', style: 'gap:8px' }, kindChip(n.mine ? 'from_parent' : n.kind), h('strong', {}, n.mine ? 'Your message' : n.title)), h('p', { style: 'margin:6px 0 4px;white-space:pre-wrap' }, n.body),
        h('p', { class: 'small muted' }, n.from + ' · ' + n.when + (n.personal ? ' · about your child' : '')), n.mine || !GM.seenButton ? null : GM.seenButton(n))))) : h('p', { class: 'muted' }, 'No notices.')),

    GM.parentExtras ? GM.parentExtras(id) : null,
    GM.contactCard ? GM.contactCard(id) : null,

    section('Write to the teacher', null, merr, msg, h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:12px' }, send), note('Only you and the teacher can read this. Your child cannot.')),

    section('Ways to help at home', null, h('ul', { style: 'padding-left:20px' }, r.tips.map((x) => h('li', { style: 'margin:6px 0' }, x)))),
    h('p', { class: 'small muted', style: 'margin-top:18px' }, r.privacy));
}

// ================= STUDENT: notices and attendance =================
async function studentNotices() {
  const list = await api('GET', '/student/notices');
  page([{ label: 'Home', href: '#/s' }, { label: 'Notices' }], head('Notices', 'From your teacher.'),
    list.length ? h('div', { class: 'list' }, list.map((n) => h('div', { class: 'item', style: 'align-items:flex-start' },
      h('div', { class: 'grow' }, h('div', { class: 'row', style: 'gap:8px' }, kindChip(n.kind), h('strong', {}, n.title), n.personal ? h('span', { class: 'chip plum' }, 'For you') : null),
        h('p', { style: 'margin:6px 0 4px;white-space:pre-wrap' }, n.body), h('p', { class: 'small muted' }, n.from + ' · ' + n.when))))) : empty('No notices', 'When your teacher posts something, it shows up here.'));
}
async function studentAttendance() {
  const a = await api('GET', '/student/attendance');
  page([{ label: 'Home', href: '#/s' }, { label: 'My attendance' }], head('My attendance', a.pct === null ? 'Not enough days marked yet.' : `Below ${a.threshold}% is flagged. Approved leave is not counted against you.`),
    h('div', { class: 'slab' },
      a.pct !== null ? h('p', { style: 'font-size:2rem;font-weight:800;margin-bottom:10px' }, a.pct + '%', a.low ? h('span', { class: 'chip rose', style: 'margin-left:12px;vertical-align:middle' }, 'Below ' + a.threshold + '%') : null) : null,
      h('div', { class: 'pill-list' }, h('span', { class: 'chip leaf' }, 'Present ' + a.present), h('span', { class: 'chip sun' }, 'Late ' + a.late), h('span', { class: 'chip rose' }, 'Absent ' + a.absent), h('span', { class: 'chip blue' }, 'Leave ' + a.leave)),
      a.recent.length ? h('div', { style: 'margin-top:16px' }, h('h3', { style: 'margin-bottom:8px' }, 'Recent days'), h('div', { class: 'pill-list' }, a.recent.map((d) => h('span', { class: 'chip', title: d.day }, d.day.slice(5) + ' ' + STATUS_NAME[d.status])))) : null));
}

GM.routes.push(
  [/^\/t\/c\/(\d+)\/attendance$/, attendanceScreen, 'teacher'],
  [/^\/t\/c\/(\d+)\/notices$/, noticesTeacher, 'teacher'],
  [/^\/p$/, parentHome, 'parent'],
  [/^\/p\/c\/(\d+)$/, parentChild, 'parent'],
  [/^\/s\/notices$/, studentNotices, 'student'],
  [/^\/s\/attendance$/, studentAttendance, 'student'],
);
})();
