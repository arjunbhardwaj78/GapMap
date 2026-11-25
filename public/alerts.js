/* GapMap Milestone 12: class settings (alert lines) and the Alert centre. Loaded after notify.js.
   All server text goes in with h() (textContent), never innerHTML. Numbers and triggers come from the server (code), never from AI. */
(() => {
'use strict';
const { h, api, toast, busy, btn, link, page, head, empty, errorBox, route } = window.GM;

const TYPE = {
  performance_low: 'Overall score', performance_drop: 'Results dropped', improvement: 'Results improving', attendance_low: 'Attendance',
  absent_streak: 'Absent in a row', good_attendance: 'Full attendance', missed_homework: 'Homework missed', missed_test: 'Test missed', missed_quiz: 'Quiz missed',
};
const typeChip = (type, positive) => h('span', { class: 'chip ' + (positive ? 'leaf' : 'sun') }, TYPE[type] || type);
const crumbs = (cid, name, last) => [{ label: 'Classes', href: '#/t' }, { label: name || 'Class', href: '#/t/c/' + cid }, { label: last }];
const className = async (cid) => { const c = (await api('GET', '/classes')).find((x) => String(x.id) === String(cid)); return c ? c.name : 'Class'; };

// ---------- Class settings ----------
async function settingsScreen(cid) {
  const [S, name] = await Promise.all([api('GET', `/classes/${cid}/settings`), className(cid)]);
  const err = h('div'), out = h('div');
  const num = (id, v, min, max) => h('input', { id, type: 'number', value: v, min, max, inputmode: 'numeric', style: 'max-width:110px' });
  const on = (id, v) => h('input', { id, type: 'checkbox', checked: v, style: 'width:22px;height:22px' });
  const rows = [
    ['floorOn', 'floorPct', 'Overall score line', 'Alert if the overall score (total marks over total available) is below this percent.', '%'],
    ['dropOn', 'dropPts', 'Drop in results', 'Alert if the average of the latest results is lower than the results before by more than this many points.', 'points'],
    ['attOn', 'attPct', 'Attendance line', 'Alert if attendance is below this percent (leave days are not counted against the child).', '%'],
    ['streakOn', 'streakDays', 'Absent in a row', 'Alert after this many marked school days absent in a row.', 'days'],
    ['missedOn', 'missedHwK', 'Missed homework', 'Alert after this many homework items past due and not handed in. Missed tests and quizzes use the number below.', 'items'],
  ];
  const ctl = {};
  const form = h('div', { class: 'list' }, rows.map(([sw, nm, title, hint, unit]) => {
    ctl[sw] = on('s_' + sw, S[sw]); ctl[nm] = num('s_' + nm, S[nm], 1, 100);
    return h('div', { class: 'slab setrow' }, h('label', { class: 'setsw', for: 's_' + sw }, ctl[sw], h('strong', {}, title)), h('p', { class: 'muted small' }, hint), h('div', { class: 'row' }, ctl[nm], h('span', { class: 'muted' }, unit)));
  }));
  ctl.dropN = num('s_dropN', S.dropN, 1, 10); ctl.missedTestK = num('s_missedTestK', S.missedTestK, 1, 10); ctl.positiveOn = on('s_positiveOn', S.positiveOn);
  ctl.yearStart = h('input', { id: 's_ys', type: 'date', value: S.yearStart }); ctl.yearEnd = h('input', { id: 's_ye', type: 'date', value: S.yearEnd }); ctl.termSplit = h('input', { id: 's_ts', type: 'date', value: S.termSplit || '' });
  const collect = () => {
    const o = {};
    for (const k of ['floorOn', 'dropOn', 'attOn', 'streakOn', 'missedOn', 'positiveOn']) o[k] = ctl[k].checked;
    for (const k of ['floorPct', 'dropPts', 'attPct', 'streakDays', 'missedHwK', 'dropN', 'missedTestK']) o[k] = ctl[k].value.trim() === '' ? NaN : Number(ctl[k].value);
    o.yearStart = ctl.yearStart.value; o.yearEnd = ctl.yearEnd.value; o.termSplit = ctl.termSplit.value || '';
    return o;
  };
  const preview = async () => {
    err.replaceChildren();
    const done = busy('Checking who would get an alert');
    try {
      const r = await api('POST', `/classes/${cid}/alerts/preview`, { overrides: collect() }); done();
      out.replaceChildren(h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:6px' }, 'If you saved these settings'), h('p', { class: 'muted small', style: 'margin-bottom:10px' }, `${r.checked} students checked. Nothing was sent and nothing was saved.`),
        r.would.length ? h('div', { class: 'list' }, r.would.map((w) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('strong', {}, w.name), h('p', { class: 'small muted' }, w.summary)), typeChip(w.type, w.positive))))
          : h('p', { class: 'muted' }, 'Nobody would get an alert right now.')));
    } catch (e) { done(); err.replaceChildren(errorBox(e.message)); }
  };
  page(crumbs(cid, name, 'Class settings'), head('Class settings', 'When should families and you hear about a child? Everything is worked out by the computer from marks, attendance and homework.'), err,
    h('div', { class: 'list roomy' }, form,
      h('div', { class: 'slab setrow' }, h('h3', {}, 'More details'), h('div', { class: 'pair', style: 'margin-top:10px' },
        h('div', { class: 'field' }, h('label', { for: 's_dropN' }, 'Results compared for a drop (the last N against the N before)'), ctl.dropN),
        h('div', { class: 'field' }, h('label', { for: 's_missedTestK' }, 'Missed tests or quizzes before an alert'), ctl.missedTestK)),
        h('label', { class: 'setsw', for: 's_positiveOn' }, ctl.positiveOn, h('strong', {}, 'Also send good news (improving results, full attendance)'))),
      h('div', { class: 'slab setrow' }, h('h3', {}, 'Academic year'), h('p', { class: 'muted small' }, 'Reports and alerts count from the start date. The term split is optional.'),
        h('div', { class: 'pair', style: 'margin-top:10px' }, h('div', { class: 'field' }, h('label', { for: 's_ys' }, 'Starts'), ctl.yearStart), h('div', { class: 'field' }, h('label', { for: 's_ye' }, 'Ends'), ctl.yearEnd)),
        h('div', { class: 'field' }, h('label', { for: 's_ts' }, 'Term split (optional)'), ctl.termSplit)),
      h('p', { class: 'small muted' }, 'The same alert is not sent again to the same child within 7 days, unless things get clearly worse.'),
      h('div', { class: 'row', style: 'justify-content:flex-end' }, btn('Preview who would get an alert', 'plum', preview), btn('Save settings', 'leaf', async () => {
        err.replaceChildren();
        try { await api('PUT', `/classes/${cid}/settings`, collect()); toast('Settings saved', 'ok'); } catch (e) { err.replaceChildren(errorBox(e.message)); window.scrollTo(0, 0); }
      }, 'big')), out));
}

// ---------- Alert centre ----------
let filter = 'new';
async function alertCentre(cid) {
  const [name, data] = await Promise.all([className(cid), api('GET', `/classes/${cid}/alerts${filter === 'all' ? '' : '?status=' + filter}`)]);
  const tab = (key, label, n) => h('button', { class: 'btn small ' + (filter === key ? 'blue' : 'ghost'), type: 'button', onclick: () => { filter = key; route(); } }, n === undefined ? label : `${label} (${n})`);
  const setStatus = async (a, status, noteBox) => {
    try { await api('PUT', '/alerts/' + a.id, { status, note: noteBox.value }); route(); } catch (e) { toast(e.message, 'bad'); }
  };
  const contacts = await api('GET', `/classes/${cid}/contacts`).catch(() => ({ students: [] }));
  const parentsOf = (sid) => ((contacts.students.find((s) => s.studentId === sid) || {}).parents || []);
  const card = (a) => {
    const note = h('textarea', { 'aria-label': 'Note about ' + a.name, maxlength: 300, rows: 2, placeholder: 'What did you do? (only you see this)', style: 'font-family:inherit' }, a.note || '');
    const nums = Object.entries(a.numbers).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join('   ');
    return h('div', { class: 'slab' }, h('div', { class: 'row' }, h('strong', { class: 'grow' }, a.name), typeChip(a.type, a.positive), h('span', { class: 'chip ' + (a.status === 'new' ? 'blue' : a.status === 'seen' ? 'sun' : 'leaf') }, a.status)),
      h('p', { style: 'margin:8px 0 2px' }, a.summary), h('p', { class: 'small muted' }, `Sent ${a.sentOn} to ${a.sent.students} student${a.sent.students === 1 ? '' : 's'} and ${a.sent.parents} parent${a.sent.parents === 1 ? '' : 's'}.` + (a.receipt && a.receipt.of ? ' Seen by ' + a.receipt.seen + ' of ' + a.receipt.of + ' parent' + (a.receipt.of === 1 ? '' : 's') + '.' : '') + (nums ? '  ' + nums : '')),
      h('div', { class: 'small', style: 'margin-top:8px' }, h('strong', {}, 'Parent contact: '), parentsOf(a.studentId).some((p) => p.shared) ? parentsOf(a.studentId).filter((p) => p.shared).map((p) => h('div', { style: 'margin-top:4px' }, h('span', { class: 'muted' }, p.name + '  '), window.GM.contactLine(p, p.name))) : h('span', { class: 'muted' }, 'no number shared. Use in-app messages (Notices and parents).')),
      window.GM.quickActions ? window.GM.quickActions(cid, a.studentId, a.name) : null,
      h('div', { class: 'field', style: 'margin-top:10px' }, note),
      h('div', { class: 'row' }, btn('Save note', 'ghost', async () => { try { await api('PUT', '/alerts/' + a.id, { note: note.value }); toast('Note saved', 'ok'); } catch (e) { toast(e.message, 'bad'); } }, 'small'),
        a.status !== 'seen' ? btn('Mark seen', 'sun', () => setStatus(a, 'seen', note), 'small') : null, a.status !== 'done' ? btn('Mark done', 'leaf', () => setStatus(a, 'done', note), 'small') : null));
  };
  page(crumbs(cid, name, 'Alert centre'), head('Alert centre', 'Every alert that was really sent, with the numbers behind it. Wording to families is calm: "may need support", never a verdict.',
    btn('Check now', 'plum', async () => {
      const done = busy('Checking every student');
      try { const r = await api('POST', `/classes/${cid}/alerts/run`); done(); toast(`Checked ${r.checked} students. ${r.sent} new alert${r.sent === 1 ? '' : 's'} sent.`, r.sent ? 'ok' : undefined); route(); } catch (e) { done(); toast(e.message, 'bad'); }
    })),
    h('div', { class: 'row', style: 'margin-bottom:18px' }, tab('new', 'New', data.counts.new), tab('seen', 'Seen', data.counts.seen), tab('done', 'Done', data.counts.done), tab('all', 'All'), h('span', { class: 'grow' }), btn('Download CSV', 'ghost', () => window.GM.download(`/classes/${cid}/alerts.csv`, 'alerts.csv'), 'small'), link('Class settings', `#/t/c/${cid}/settings`, 'ghost', 'small')),
    data.items.length ? h('div', { class: 'list' }, data.items.map(card)) : empty('No alerts here', filter === 'new' ? 'When a child crosses one of your lines, it shows up here. You can change the lines in Class settings.' : 'Nothing in this list.', link('Class settings', `#/t/c/${cid}/settings`, 'blue')));
}

window.GM.routes.push([/^\/t\/c\/(\d+)\/settings$/, settingsScreen, 'teacher'], [/^\/t\/c\/(\d+)\/alerts$/, alertCentre, 'teacher']);
})();
