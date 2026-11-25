/* GapMap Milestone 12 step 4: charts as plain SVG. No libraries, no innerHTML. Loaded before reports.js.
   Every number is worked out by the server (reportFor / classCharts). Here we only DRAW it.
   Rules: text values on every chart (not colour only), role="img" + short aria-label, black/white friendly (patterns + outlines),
   viewBox 340 wide so it scales down to a 390 px phone with no sideways scroll, and "Not enough data yet" instead of an empty chart. */
(() => {
'use strict';
const { h } = window.GM;
const NS = 'http://www.w3.org/2000/svg', W = 340;
let uid = 0;

// like h(), but makes SVG elements (h() uses createElement, which cannot draw SVG). Text goes in as text nodes.
function sv(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; el.setAttribute(k, v === true ? '' : String(v)); }
  kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return el;
}
const txt = (x, y, s, o = {}) => sv('text', { x, y, 'font-size': o.size || 11, 'text-anchor': o.anchor || 'start', 'font-weight': o.weight, class: 'c-txt' + (o.muted ? ' c-muted' : '') }, s);
const trunc = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (m) => MONTHS[Number(m.slice(5, 7)) - 1] || m;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const frame = (height, label, ...kids) => sv('svg', { viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': label, class: 'c-svg', focusable: 'false', preserveAspectRatio: 'xMidYMid meet' }, ...kids);

// the box around every chart: title, the drawing (or "Not enough data yet"), and plain-text notes
function box(title, svgEl, notes = []) {
  return h('figure', { class: 'chart' }, h('figcaption', {}, title),
    svgEl || h('p', { class: 'muted chart-empty' }, 'Not enough data yet'),
    svgEl ? notes.filter(Boolean).map((n) => h('p', { class: 'small muted chart-note' }, n)) : null);
}

// horizontal bars: label + small line on the left, bar, value text on the right. rows: {label, sub, frac (0..1), value, subValue, marker (0..1 or null)}
function hbars(rows, label, axis) {
  const BX = 104, BW = 128, VX = BX + BW + 8, RH = 34, H = rows.length * RH + (axis ? 20 : 4);
  const kids = [];
  rows.forEach((r, i) => {
    const y = i * RH, f = Math.max(0, Math.min(1, r.frac || 0));
    kids.push(txt(0, y + 15, trunc(r.label, 16), { weight: 650 }));
    if (r.sub) kids.push(txt(0, y + 28, trunc(r.sub, 22), { size: 9, muted: true }));
    kids.push(sv('rect', { x: BX, y: y + 4, width: BW, height: 14, rx: 3, class: 'c-track' }));
    if (f > 0) kids.push(sv('rect', { x: BX, y: y + 4, width: Math.max(2, BW * f), height: 14, rx: 3, class: 'c-bar' }));
    if (r.marker != null) {   // class average: white outline + black line, so it shows on dark and light bars, in colour and in print
      const mx = BX + BW * Math.max(0, Math.min(1, r.marker));
      kids.push(sv('line', { x1: mx, x2: mx, y1: y + 1, y2: y + 21, class: 'c-mark-bg' }), sv('line', { x1: mx, x2: mx, y1: y + 1, y2: y + 21, class: 'c-mark' }));
    }
    kids.push(txt(VX, y + 15, r.value, { weight: 700 }));
    if (r.subValue) kids.push(txt(VX, y + 28, r.subValue, { size: 9, muted: true }));
  });
  if (axis) axis.forEach((a) => { const x = BX + BW * a.frac; kids.push(sv('line', { x1: x, x2: x, y1: 0, y2: rows.length * RH, class: 'c-grid' }), txt(x, H - 5, a.label, { size: 9, anchor: 'middle', muted: true })); });
  return frame(H, label, kids);
}

// vertical columns with the value written above each one. items: {label, value 0..100, text}
function vcols(items, label) {
  const PL = 30, PR = W - 6, TOP = 16, PH = 108, BASE = TOP + PH, H = BASE + 24, slot = (PR - PL) / items.length, bw = Math.min(34, slot * 0.62);
  const kids = [0, 50, 100].map((v) => { const y = BASE - (PH * v) / 100; return [sv('line', { x1: PL, x2: PR, y1: y, y2: y, class: 'c-grid' }), txt(PL - 4, y + 3, v, { size: 9, anchor: 'end', muted: true })]; });
  items.forEach((it, i) => {
    const cx = PL + slot * i + slot / 2, bh = (PH * Math.max(0, Math.min(100, it.value))) / 100;
    kids.push(sv('rect', { x: cx - bw / 2, y: BASE - bh, width: bw, height: Math.max(bh, 1.5), rx: 2, class: 'c-bar' }),
      txt(cx, BASE - bh - 4, it.text, { size: slot < 30 ? 9 : 10, anchor: 'middle', weight: 700 }),
      txt(cx, BASE + 13, it.label, { size: 9, anchor: 'middle', muted: true }));
  });
  kids.push(sv('line', { x1: PL, x2: PR, y1: BASE, y2: BASE, class: 'c-axis' }));
  return frame(H, label, kids);
}

// line with dots; value written at the dots (all of them when 8 or fewer, otherwise first, last, highest, lowest)
function lineChart(points, label) {
  const PL = 30, PR = W - 14, TOP = 18, PH = 110, BASE = TOP + PH, H = BASE + 26, n = points.length;
  const X = (i) => PL + 8 + ((PR - PL - 16) * i) / (n - 1), Y = (v) => BASE - (PH * Math.max(0, Math.min(100, v))) / 100;
  const kids = [0, 50, 100].map((v) => [sv('line', { x1: PL, x2: PR, y1: Y(v), y2: Y(v), class: 'c-grid' }), txt(PL - 4, Y(v) + 3, v, { size: 9, anchor: 'end', muted: true })]);
  kids.push(sv('line', { x1: PL, x2: PR, y1: BASE, y2: BASE, class: 'c-axis' }), sv('polyline', { points: points.map((p, i) => `${X(i)},${Y(p.pct)}`).join(' '), class: 'c-line', fill: 'none' }));
  const vals = points.map((p) => p.pct), hi = vals.indexOf(Math.max(...vals)), lo = vals.indexOf(Math.min(...vals));
  points.forEach((p, i) => {
    kids.push(sv('circle', { cx: X(i), cy: Y(p.pct), r: 3.6, class: 'c-dot' }));
    if (n <= 8 || i === 0 || i === n - 1 || i === hi || i === lo) kids.push(txt(Math.max(PL + 8, Math.min(PR - 8, X(i))), Y(p.pct) - 7, p.pct + '%', { size: 10, anchor: 'middle', weight: 700 }));
  });
  [0, n - 1].forEach((i) => kids.push(txt(Math.max(PL + 14, Math.min(PR - 14, X(i))), BASE + 15, points[i].date.slice(5), { size: 9, anchor: 'middle', muted: true })));
  return frame(H, label, kids);
}

// one stacked bar: done on time (solid), late (hatched), missed (empty box). Counts and % are written below, so it also works in black and white.
function stacked(parts, total, label) {
  const BX = 0, BW = W - 2, id = 'gm-hatch-' + (++uid), H = 42 + parts.length * 20;
  const kids = [sv('defs', {}, sv('pattern', { id, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, sv('rect', { width: 6, height: 6, fill: '#fff' }), sv('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#1b2b27', 'stroke-width': 2.4 })))];
  let x = BX;
  parts.forEach((p) => {
    const w = (BW * p.n) / total;
    if (w > 0) kids.push(sv('rect', { x, y: 2, width: w, height: 26, class: p.kind === 'solid' ? 'c-bar c-seg' : 'c-seg', fill: p.kind === 'hatch' ? `url(#${id})` : p.kind === 'empty' ? '#fff' : null }));
    x += w;
  });
  kids.push(sv('rect', { x: BX, y: 2, width: BW, height: 26, fill: 'none', class: 'c-frame' }));
  parts.forEach((p, i) => {
    const y = 48 + i * 20;
    kids.push(sv('rect', { x: 0, y: y - 11, width: 16, height: 12, class: p.kind === 'solid' ? 'c-bar c-seg' : 'c-seg', fill: p.kind === 'hatch' ? `url(#${id})` : p.kind === 'empty' ? '#fff' : null }),
      txt(24, y, `${p.name}: ${p.n} (${Math.round((p.n / total) * 100)}%)`, { size: 11, weight: 650 }));
  });
  return frame(H, label, kids);
}

// ---------- charts for one child (student, parent, teacher) ----------
function marksChart(r) {
  const all = r.results.filter((x) => x.type !== 'homework'), list = all.slice(-10);
  const TYPE = { test: 'Test', quiz: 'Quiz' };
  if (!list.length) return box('Marks in each test and quiz', null);
  const rows = list.map((x) => ({ label: x.title, sub: `${TYPE[x.type]} · ${x.date}`, frac: x.pct / 100, value: `${x.marks}/${x.total} · ${x.pct}%`, marker: x.classAverage == null ? null : x.classAverage / 100, subValue: x.classAverage == null ? null : `class avg ${x.classAverage}%` }));
  const hasAvg = rows.some((x) => x.marker != null), lacks = rows.some((x) => x.marker == null);
  return box('Marks in each test and quiz', hbars(rows, `Marks in ${plural(list.length, 'test or quiz', 'tests and quizzes')}. Latest: ${list[list.length - 1].pct} percent.`, [{ frac: 0, label: '0' }, { frac: 0.5, label: '50' }, { frac: 1, label: '100%' }]),
    [hasAvg ? 'Black line on a bar = class average (one number for the whole class).' : null, lacks ? 'The class average is hidden where fewer than 3 children have a result.' : null, all.length > 10 ? `Showing the latest 10 of ${all.length}.` : null]);
}
function trendChart(r) {
  const pts = (r.overallSeries || []).slice(-24);
  if (pts.length < 2) return box('Overall % over time', null);
  return box('Overall % over time', lineChart(pts, `Overall percentage after each result, from ${pts[0].pct} to ${pts[pts.length - 1].pct} percent over ${pts.length} results.`),
    ['Each dot is the overall % after that result is added (the same formula as above).', (r.overallSeries || []).length > 24 ? 'Showing the latest 24 results.' : null]);
}
function attendanceChart(r) {
  const ms = r.attendance.months.filter((m) => m.pct != null);
  if (!ms.length) return box('Attendance by month', null);
  const multiYear = new Set(ms.map((m) => m.month.slice(0, 4))).size > 1;
  return box('Attendance by month', vcols(ms.map((m) => ({ label: monthName(m.month) + (multiYear ? " '" + m.month.slice(2, 4) : ''), value: m.pct, text: m.pct + '%' })), `Attendance by month, ${plural(ms.length, 'month', 'months')}. Overall ${r.attendance.pct} percent.`), ['Leave days are not counted.']);
}
function homeworkChart(r) {
  const hw = r.homework;
  if (!hw.counted) return box('Homework: done, late, missed', null);
  return box('Homework: done, late, missed', stacked([{ name: 'Done on time', n: hw.done, kind: 'solid' }, { name: 'Handed in late', n: hw.late, kind: 'hatch' }, { name: 'Not handed in', n: hw.missed, kind: 'empty' }], hw.counted, `Homework: ${hw.done} done on time, ${hw.late} late, ${hw.missed} not handed in.`),
    [hw.pending || hw.waiting ? 'Homework not due yet, or waiting for the teacher, is not counted.' : null]);
}
function subjectChart(r) {
  if (!r.subjects || !r.subjects.length) return null;   // only when the report has subjects
  return box('Marks by subject', hbars(r.subjects.map((s) => ({ label: s.name, sub: plural(s.count, 'result', 'results'), frac: (s.pct || 0) / 100, value: s.pct + '%' })), `Marks in ${plural(r.subjects.length, 'subject', 'subjects')}.`, [{ frac: 0, label: '0' }, { frac: 0.5, label: '50' }, { frac: 1, label: '100%' }]));
}

// ---------- charts for the whole class (counts only, never names) ----------
function bandsChart(c) {
  const b = c.bands;
  if (!b.enough) return box('Test scores: children in each band', null);
  const max = Math.max(1, ...b.items.map((i) => i.count));
  return box('Test scores: children in each band', hbars(b.items.map((i) => ({ label: i.label + '%', frac: i.count / max, value: plural(i.count, 'child', 'children') })), `Number of children in each test score band: ${b.items.map((i) => `${i.label} percent, ${i.count}`).join('; ')}.`),
    ['Each child is placed by their overall test %. Counts only, no names.', b.noResult ? `${plural(b.noResult, 'child has', 'children have')} no test result yet and ${b.noResult === 1 ? 'is' : 'are'} not counted.` : null]);
}
function classAttendanceChart(c) {
  const ms = c.attendance.months;
  if (!ms.length) return box('Class attendance by month', null);
  return box('Class attendance by month', vcols(ms.map((m) => ({ label: monthName(m.month), value: m.pct, text: m.pct + '%' })), `Class attendance by month, ${plural(ms.length, 'month', 'months')}.`), ['One number per month for the whole class. Leave days are not counted.']);
}
function attentionChart(c, alertsHref) {
  const a = c.attention;
  if (!a.students) return box('Children who may need support', null);
  return box('Children who may need support', hbars([{ label: 'Open alerts', frac: a.count / a.students, value: `${a.count} of ${a.students}` }], `${a.count} of ${a.students} children have an open alert.`),
    ['Counts children with a new or seen alert in the Alert centre. An alert is a reason to look, not a judgement.', alertsHref ? h('a', { href: alertsHref }, 'Open the Alert centre') : null]);
}

window.GM.charts = { sv, marksChart, trendChart, attendanceChart, homeworkChart, subjectChart, bandsChart, classAttendanceChart, attentionChart };
})();
