/* GapMap Milestone 12: report cards (teacher, student, parent) + class reports hub + print-all. Loaded after alerts.js.
   Every number comes from the server (reportFor, computed by code). All server text goes in with h() (textContent), never innerHTML. */
(() => {
'use strict';
const { h, api, state, toast, busy, btn, link, page, head, empty, errorBox, route } = window.GM;
const C = window.GM.charts;   // plain SVG charts (public/charts.js)
const chartRow = (...figs) => h('div', { class: 'chartrow' }, figs.filter(Boolean));

async function download(path, fallbackName) {
  try {
    const res = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + state.token } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed.');
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || fallbackName;
    const url = URL.createObjectURL(await res.blob());
    const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { toast(e.message, 'bad'); }
}
const SCOPES = [['till', 'Till date'], ['year', 'Full academic year'], ['term1', 'Term 1'], ['term2', 'Term 2'], ['custom', 'Custom dates']];
const parseQ = (qs) => { const p = new URLSearchParams(qs || ''); return { scope: p.get('scope') || 'till', from: p.get('from') || '', to: p.get('to') || '' }; };
const toQ = (q) => { const p = new URLSearchParams({ scope: q.scope }); if (q.scope === 'custom') { p.set('from', q.from); p.set('to', q.to); } return p.toString(); };
const num = (v, suffix = '%') => (v == null ? 'Not enough data yet' : v + suffix);
const when = (d) => d;

// ---------- scope picker (not printed) ----------
function scopeBar(q, go, extra) {
  const sel = h('select', { id: 'rscope', 'aria-label': 'Report period' }, SCOPES.map(([v, l]) => h('option', { value: v, selected: v === q.scope }, l)));
  const from = h('input', { type: 'date', id: 'rfrom', value: q.from, 'aria-label': 'From date' }), to = h('input', { type: 'date', id: 'rto', value: q.to, 'aria-label': 'To date' });
  const custom = h('span', { class: 'row', style: { display: q.scope === 'custom' ? 'inline-flex' : 'none', gap: '8px' } }, from, h('span', { class: 'muted' }, 'to'), to);
  sel.addEventListener('change', () => { custom.style.display = sel.value === 'custom' ? 'inline-flex' : 'none'; });
  return h('div', { class: 'row noprint', style: 'margin-bottom:16px;align-items:center;flex-wrap:wrap;gap:10px' },
    h('label', { for: 'rscope', class: 'muted' }, 'Period'), sel, custom,
    btn('Show', 'blue', () => go({ scope: sel.value, from: from.value, to: to.value }), 'small'), extra || null);
}

// ---------- one report ----------
const stat = (label, value, sub) => h('div', { class: 'rstat' }, h('div', { class: 'rl' }, label), h('div', { class: 'rv' }, value), sub ? h('div', { class: 'rs' }, sub) : null);
const section = (title, ...kids) => h('section', { class: 'rsec' }, h('h2', {}, title), ...kids);
const TYPE = { test: 'Test', quiz: 'Quiz', homework: 'Homework' };

function reportView(r, ctx) {
  const o = r.overall, a = r.attendance, hw = r.homework;
  const trendChip = { improving: ['leaf', 'Improving'], steady: ['blue', 'Steady'], dropping: ['sun', 'Dropping'], not_enough: ['', 'Not enough data yet'] }[r.trend.label];
  const el = h('article', { class: 'report-page' },
    h('header', { class: 'rhead' },
      h('div', {}, h('div', { class: 'rbrand' }, 'GapMap academic report'), h('h1', {}, r.student.name),
        h('p', { class: 'muted' }, [r.student.className, r.student.roll ? 'Roll ' + r.student.roll : null, 'Class teacher: ' + r.student.teacherName].filter(Boolean).join(' · '))),
      h('div', { class: 'rmeta' }, h('div', {}, h('strong', {}, r.scope.label)), h('div', { class: 'muted' }, `${r.range.from} to ${r.range.to}`), h('div', { class: 'muted small' }, 'Made on ' + r.generatedOn))),
    r.notEnoughData ? h('div', { class: 'rnote' }, 'Not enough data yet. Results, attendance and homework will appear here once the teacher has recorded them.') : null,
    r.joinedNote ? h('div', { class: 'rnote' }, r.joinedNote) : null,

    section('Overall performance',
      h('div', { class: 'rstats' },
        stat('Overall', o.enough ? o.pct + '%' : '—', o.enough ? `${o.count} checked result${o.count === 1 ? '' : 's'}` : 'Not enough data yet'),
        stat('Tests', r.perType.test.pct == null ? '—' : r.perType.test.pct + '%', r.perType.test.count + ' counted'),
        stat('Quizzes', r.perType.quiz.pct == null ? '—' : r.perType.quiz.pct + '%', r.perType.quiz.count + ' counted'),
        stat('Homework marks', r.perType.homework.pct == null ? '—' : r.perType.homework.pct + '%', r.perType.homework.count + ' checked')),
      h('p', { class: 'small muted', style: 'margin-top:10px' }, r.formula),
      h('p', { style: 'margin-top:10px' }, h('span', { class: 'chip ' + trendChip[0] }, trendChip[1]), ' ', r.trend.text),
      h('p', { class: 'small muted' }, r.trend.rule),
      chartRow(C.trendChart(r), C.subjectChart(r))),

    section('Tests and quizzes',
      chartRow(C.marksChart(r)),
      r.results.length || r.missed.length || r.waiting.length ? h('div', { class: 'rscroll' }, h('table', { class: 'rtable' },
        h('thead', {}, h('tr', {}, ['Date', 'Title', 'Type', 'Marks', 'Class average'].map((c) => h('th', {}, c)))),
        h('tbody', {},
          ...r.results.filter((x) => x.type !== 'homework').map((x) => h('tr', {}, h('td', {}, when(x.date)), h('td', {}, x.title), h('td', {}, TYPE[x.type]), h('td', {}, `${x.marks} / ${x.total} (${x.pct}%)`), h('td', {}, x.classAverage == null ? '—' : x.classAverage + '%'))),
          ...r.missed.map((x) => h('tr', {}, h('td', {}, when(x.date)), h('td', {}, x.title), h('td', {}, TYPE[x.type]), h('td', {}, h('span', { class: 'chip sun' }, 'Missed')), h('td', {}, '—'))),
          ...r.waiting.filter((x) => x.type !== 'homework').map((x) => h('tr', {}, h('td', {}, when(x.date)), h('td', {}, x.title), h('td', {}, TYPE[x.type]), h('td', {}, h('span', { class: 'chip blue' }, 'Waiting for the teacher')), h('td', {}, '—'))))))
        : h('p', { class: 'muted' }, 'No tests or quizzes in this period yet.'),
      h('p', { class: 'small muted' }, 'Class average is one number for the whole class. It is only shown when at least 3 children have a result.')),

    section('Attendance',
      a.enough ? h('div', {}, h('div', { class: 'rstats' }, stat('Attendance', a.pct + '%', `${a.present + a.late} of ${a.counted} school days`), stat('Present', a.present), stat('Late', a.late), stat('Absent', a.absent), stat('Leave', a.leave, 'not counted'), stat('Longest absence', a.longestAbsentRun + (a.longestAbsentRun === 1 ? ' day' : ' days'))),
        chartRow(C.attendanceChart(r)),
        h('div', { class: 'rscroll', style: 'margin-top:10px' }, h('table', { class: 'rtable' }, h('thead', {}, h('tr', {}, ['Month', 'Attendance', 'School days counted', 'Days absent'].map((c) => h('th', {}, c)))),
          h('tbody', {}, ...a.months.map((m) => h('tr', {}, h('td', {}, m.month), h('td', {}, num(m.pct)), h('td', {}, m.counted), h('td', {}, m.absent)))))))
        : h('p', { class: 'muted' }, a.leave ? `Only leave days are recorded (${a.leave}), so there is no percentage yet.` : 'Not enough data yet.')),

    section('Homework',
      hw.items.length ? h('div', {}, h('div', { class: 'rstats' }, stat('Done on time', hw.done), stat('Late', hw.late), stat('Missed', hw.missed), stat('Handed in', hw.donePct == null ? '—' : hw.donePct + '%', 'on time ' + (hw.onTimePct == null ? '—' : hw.onTimePct + '%'))),
        chartRow(C.homeworkChart(r)),
        h('div', { class: 'rscroll', style: 'margin-top:10px' }, h('table', { class: 'rtable' }, h('thead', {}, h('tr', {}, ['Homework', 'Due', 'Status'].map((c) => h('th', {}, c)))),
          h('tbody', {}, ...hw.items.map((i) => h('tr', {}, h('td', {}, i.title), h('td', {}, i.due || '—'), h('td', {}, { done: 'Done', late: 'Handed in late', missed: 'Not handed in', pending: 'Not due yet', waiting: 'Waiting for the teacher' }[i.state])))))))
        : h('p', { class: 'muted' }, 'No homework in this period.')),

    section('Learning gaps',
      r.patterns.length ? h('div', { class: 'list' }, r.patterns.map((p) => h('div', { class: 'item' }, h('span', { class: 'chip ' + (p.status === 'improving' ? 'leaf' : 'sun') }, p.status === 'improving' ? 'May be improving' : 'Likely pattern'), h('span', { class: 'grow' }, p.text))))
        : h('p', { class: 'muted' }, 'No repeated mistake pattern found in this period. A pattern is only shown when the same mistake appears in 2 or more questions of a test.')),

    remarksBlock(r, ctx));
  return el;
}

function remarksBlock(r, ctx) {
  const rm = r.remarks;
  if (r.canEdit) {
    const ta = h('textarea', { id: 'rremark', maxlength: rm.max || 600, rows: 4, style: 'font-family:inherit;width:100%', placeholder: 'A few kind, specific words for the family (up to 600 letters).' }, rm.text || '');
    ta.value = rm.text || '';
    const count = h('span', { class: 'small muted' }, `${ta.value.length} / ${rm.max || 600}`);
    ta.addEventListener('input', () => { count.textContent = `${ta.value.length} / ${rm.max || 600}`; });
    return section('Teacher remarks', ta, h('div', { class: 'row noprint', style: 'margin-top:8px;align-items:center;gap:12px' }, btn('Save remarks', 'leaf', async () => {
      try { await api('PUT', `/reports/student/${r.student.id}/remarks?${toQ(ctx.q)}`, { text: ta.value }); toast('Remarks saved', 'ok'); route(); } catch (e) { toast(e.message, 'bad'); } }, 'small'), count),
      h('p', { class: 'small muted', style: 'margin-top:6px' }, rm.seenOn ? 'Seen by a parent on ' + rm.seenOn + '.' : 'Not yet seen by a parent.'),
      rm.text ? h('p', { class: 'print-only remark-print' }, rm.text) : null);
  }
  return section('Teacher remarks', rm.text ? h('p', { class: 'remark-print' }, rm.text) : h('p', { class: 'muted' }, 'No remarks from the teacher yet.'),
    r.canSee ? (rm.seenOn ? h('p', { class: 'chip leaf' }, 'Seen by you on ' + rm.seenOn)
      : h('div', { class: 'noprint', style: 'margin-top:10px' }, btn('I have seen this report', 'leaf', async () => { try { await api('POST', `/reports/student/${r.student.id}/seen?${toQ(ctx.q)}`); toast('Thank you. The teacher can see you read it.', 'ok'); route(); } catch (e) { toast(e.message, 'bad'); } }))) : null);
}

// ---------- screens ----------
async function showReport(crumbs, sid, qs, hashBase, who) {
  const q = parseQ(qs);
  let r;
  try { r = await api('GET', `/reports/student/${sid}?${toQ(q)}`); }
  catch (e) { page(crumbs, head('Academic report'), scopeBar(q, (n) => { location.hash = hashBase + '?' + toQ(n); }), empty('Cannot show this report', e.message)); return; }
  page(crumbs,
    head('Academic report', 'One page for the family. Numbers are worked out by code from checked results, never guessed.', btn('Print / Save as PDF', 'blue', () => window.print(), 'small')),
    scopeBar(q, (n) => { location.hash = hashBase + '?' + toQ(n); }),
    reportView(r, { q, who }),
    who === 'parent' && window.GM.contactCard ? window.GM.contactCard(sid) : null);
}
const teacherReport = (sid, qs) => showReport([{ label: 'Classes', href: '#/t' }, { label: 'Student report' }], sid, qs, '#/t/r/' + sid, 'teacher');
const studentReport = (qs) => showReport([{ label: 'Home', href: '#/s' }, { label: 'My report' }], state.user.studentId, qs, '#/s/report', 'student');
const parentReport = (sid, qs) => showReport([{ label: 'Home', href: '#/p' }, { label: 'Child', href: '#/p/c/' + sid }, { label: 'Academic report' }], sid, qs, '#/p/c/' + sid + '/report', 'parent');

async function classHub(cid, qs) {
  const q = parseQ(qs);
  const [classes, students] = await Promise.all([api('GET', '/classes'), api('GET', `/classes/${cid}/students`)]);
  const charts = await api('GET', `/classes/${cid}/charts?${toQ(q)}`).catch(() => null);
  const c = classes.find((x) => String(x.id) === String(cid)) || { name: 'Class' };
  const go = (n) => { location.hash = `#/t/c/${cid}/reports?` + toQ(n); };
  page([{ label: 'Classes', href: '#/t' }, { label: c.name, href: '#/t/c/' + cid }, { label: 'Report cards' }],
    head('Report cards', 'Open one child, print the whole class, or download a spreadsheet. The period you pick applies to all of them.'),
    scopeBar(q, go, h('span', { class: 'row', style: 'gap:8px' },
      btn('Download class CSV', 'ghost', () => download(`/classes/${cid}/reports.csv?${toQ(q)}`, 'reports.csv'), 'small'),
      link('Print all reports', `#/t/c/${cid}/reports/print?` + toQ(q), 'plum', 'small'))),
    charts ? h('section', { class: 'classcharts' }, h('h2', {}, 'Class at a glance'), h('p', { class: 'small muted' }, `${charts.scope.label}, ${charts.scope.from} to ${charts.scope.to}. Numbers only, no names, no ranking.`),
      chartRow(C.bandsChart(charts), C.classAttendanceChart(charts), C.attentionChart(charts, `#/t/c/${cid}/alerts`))) : null,
    students.length ? h('div', { class: 'list' }, students.map((s) => h('a', { class: 'item', href: `#/t/r/${s.id}?` + toQ(q) }, h('strong', { class: 'grow' }, s.name, s.roll ? h('span', { class: 'muted' }, '  Roll ' + s.roll) : null), h('span', { class: 'chip blue' }, 'Open report'))))
      : empty('No students yet', 'Add students first.', link('Add students', `#/t/c/${cid}/students`, 'leaf')));
}
async function printAll(cid, qs) {
  const q = parseQ(qs);
  const data = await api('GET', `/classes/${cid}/reports?${toQ(q)}`);
  page([{ label: 'Classes', href: '#/t' }, { label: data.className, href: '#/t/c/' + cid }, { label: 'Report cards', href: `#/t/c/${cid}/reports?` + toQ(q) }, { label: 'Print all' }],
    head('Print all reports', `${data.reports.length} report${data.reports.length === 1 ? '' : 's'}, one page each, for ${data.scope.label}.`, btn('Print / Save as PDF', 'blue', () => window.print(), 'small')),
    data.reports.length ? h('div', { class: 'report-stack' }, data.reports.map((r) => reportView({ ...r, canEdit: false, canSee: false }, { q }))) : empty('No students yet', 'Add students first.'));
}

const Q = '(?:\\?(.*))?$';
window.GM.routes.push(
  [new RegExp('^\\/t\\/r\\/(\\d+)' + Q), teacherReport, 'teacher'],
  [new RegExp('^\\/t\\/c\\/(\\d+)\\/reports' + Q), classHub, 'teacher'],
  [new RegExp('^\\/t\\/c\\/(\\d+)\\/reports\\/print' + Q), printAll, 'teacher'],
  [new RegExp('^\\/s\\/report' + Q), studentReport, 'student'],
  [new RegExp('^\\/p\\/c\\/(\\d+)\\/report' + Q), parentReport, 'parent']);
})();
