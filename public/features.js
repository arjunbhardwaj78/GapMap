/* GapMap Milestone 12 step 6: leave requests, meeting slots, "I have seen this". All server text goes in with h() (textContent), never innerHTML.
   The parent cards are never printed (class noprint). A parent only ever gets their own child's data from the server (404 otherwise). */
(() => {
'use strict';
const GM = window.GM;
const { h, api, toast, busy, btn, page, head, empty, errorBox, route } = GM;

const crumbs = (cid, name, last) => [{ label: 'Classes', href: '#/t' }, { label: name || 'Class', href: '#/t/c/' + cid }, { label: last }];
const className = async (cid) => { const c = (await api('GET', '/classes')).find((x) => String(x.id) === String(cid)); return c ? c.name : 'Class'; };
const CHIP = { pending: 'sun', approved: 'leaf', rejected: 'rose', cancelled: '' };
const WORD = { pending: 'Waiting', approved: 'Approved', rejected: 'Not approved', cancelled: 'Taken back' };
const span = (r) => (r.from === r.to ? r.from : r.from + ' to ' + r.to);
const sure = (label, fn) => btn(label, 'ghost', async (ev) => {      // two taps to confirm, like Delete elsewhere
  const b = ev.currentTarget;
  if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Tap again to confirm'; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = label; } }, 3500); return; }
  fn();
}, 'small');
const card = (title, sub, ...kids) => h('div', { class: 'slab noprint', style: 'margin-top:22px' }, h('h3', { style: 'margin-bottom:' + (sub ? '4' : '12') + 'px' }, title), sub ? h('p', { class: 'small muted', style: 'margin-bottom:12px' }, sub) : null, ...kids);

// ---------- read receipts: "I have seen this" on a parent's notice ----------
GM.seenButton = (n) => {
  const box = h('div', { style: 'margin-top:6px' });
  const show = (seen) => box.replaceChildren(seen ? h('span', { class: 'chip leaf' }, 'You have seen this')
    : btn('I have seen this', 'ghost', async () => { try { await api('POST', '/parent/notices/' + n.id + '/seen'); show(true); } catch (e) { toast(e.message, 'bad'); } }, 'small'));
  show(Boolean(n.seen));
  return box;
};

// ---------- TEACHER: leave requests ----------
async function leaveScreen(cid) {
  const [name, data] = await Promise.all([className(cid), api('GET', `/classes/${cid}/leave`)]);
  const answer = async (r, decision) => {
    try { const out = await api('POST', `/leave/${r.id}/decision`, { decision }); toast(decision === 'approve' ? 'Approved' + (out.marked ? ` (${out.marked} day${out.marked === 1 ? '' : 's'} marked as leave)` : '') : 'Not approved', 'ok'); route(); } catch (e) { toast(e.message, 'bad'); }
  };
  page(crumbs(cid, name, 'Leave requests'), head('Leave requests', 'A parent asks, you answer with one tap. Approved days are marked "leave" and do not count against attendance. Days that have not happened yet are marked on the day.'),
    data.items.length ? h('div', { class: 'list' }, data.items.map((r) => h('div', { class: 'item', style: 'align-items:flex-start' },
      h('div', { class: 'grow' }, h('div', { class: 'row', style: 'gap:8px' }, h('strong', {}, r.name), h('span', { class: 'chip ' + CHIP[r.status] }, WORD[r.status])),
        h('p', { style: 'margin:6px 0 2px' }, span(r) + ' (' + r.days + ' day' + (r.days === 1 ? '' : 's') + ')'), h('p', { class: 'small muted', style: 'white-space:pre-wrap' }, r.reason + ' · asked ' + r.asked)),
      r.status === 'pending' ? h('div', { class: 'row', style: 'gap:8px' }, btn('Approve', 'leaf', () => answer(r, 'approve'), 'small'), btn('Decline', 'ghost', () => answer(r, 'reject'), 'small')) : null)))
      : empty('No leave requests', 'When a parent asks for leave from their child page, it shows up here.'));
}

// ---------- TEACHER: meeting slots ----------
async function meetingsScreen(cid) {
  const [name, slots] = await Promise.all([className(cid), api('GET', `/classes/${cid}/meetings`)]);
  const err = h('div');
  const day = h('input', { id: 'mday', type: 'date' });
  const times = h('input', { id: 'mtimes', placeholder: 'Start times, for example: 16:00, 16:10, 16:20' });
  const mins = h('input', { id: 'mmins', type: 'number', min: 5, max: 60, value: 10, inputmode: 'numeric', style: 'max-width:100px' });
  const note = h('input', { id: 'mnote', maxlength: 100, placeholder: 'Optional, for example: Room 4' });
  const post = btn('Post times', 'leaf', async () => {
    err.replaceChildren();
    const list = times.value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    const done = busy('Posting');
    try { await api('POST', `/classes/${cid}/meetings`, { day: day.value, times: list, minutes: mins.value, note: note.value }); done(); toast('Meeting times posted. Parents were told.', 'ok'); route(); }
    catch (e) { done(); err.replaceChildren(errorBox(e.message)); }
  }, 'big');
  const byDay = {}; slots.forEach((s) => { (byDay[s.day] = byDay[s.day] || []).push(s); });
  page(crumbs(cid, name, 'Meeting times'), head('Parent-teacher meeting times', 'Post some times. Each child can book one. Both of you get a message, and a reminder the day before.'),
    h('div', { class: 'slab' }, h('h3', { style: 'margin-bottom:12px' }, 'Add times'), err,
      h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { for: 'mday' }, 'Day'), day), h('div', { class: 'field' }, h('label', { for: 'mmins' }, 'Minutes each'), mins)),
      h('div', { class: 'field' }, h('label', { for: 'mtimes' }, 'Start times (24-hour, India time)'), times),
      h('div', { class: 'field' }, h('label', { for: 'mnote' }, 'Note'), note), h('div', { class: 'row', style: 'justify-content:flex-end' }, post)),
    h('div', { style: 'margin-top:22px' }, Object.keys(byDay).length ? Object.entries(byDay).map(([d, list]) => h('div', { class: 'slab', style: 'margin-bottom:14px' }, h('h3', { style: 'margin-bottom:10px' }, d),
      h('div', { class: 'list' }, list.map((s) => h('div', { class: 'item' }, h('strong', {}, s.time), h('span', { class: 'small muted' }, s.minutes + ' min' + (s.note ? ' · ' + s.note : '')),
        h('div', { class: 'grow' }, s.booked ? h('span', { class: 'chip blue' }, s.child + (s.parent ? ' (' + s.parent + ')' : '')) : h('span', { class: 'chip leaf' }, 'Free')),
        sure(s.booked ? 'Cancel booking' : 'Remove', async () => { try { await api('DELETE', '/meetings/' + s.id); toast('Removed', 'ok'); route(); } catch (e) { toast(e.message, 'bad'); } }))))))
      : empty('No meeting times yet', 'Add some above. Parents see them on their child page.')));
}

// ---------- PARENT: leave and meetings on the child page ----------
function leaveCard(studentId) {
  const box = card('Ask for leave', 'Tell the teacher in advance. If the teacher approves, those days do not count against attendance.');
  const err = h('div');
  const from = h('input', { id: 'lfrom', type: 'date' }), to = h('input', { id: 'lto', type: 'date' });
  const why = h('input', { id: 'lwhy', maxlength: 200, placeholder: 'Reason, for example: Family wedding' });
  const list = h('div', { style: 'margin-top:14px' });
  const load = async () => {
    try {
      const rows = await api('GET', `/parent/children/${studentId}/leave`);
      list.replaceChildren(rows.length ? h('div', { class: 'list' }, rows.slice(0, 6).map((r) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('strong', {}, span(r)), h('p', { class: 'small muted' }, r.reason)),
        h('span', { class: 'chip ' + CHIP[r.status] }, WORD[r.status]), r.status === 'pending' ? sure('Take back', async () => { try { await api('DELETE', `/parent/children/${studentId}/leave/${r.id}`); toast('Request taken back', 'ok'); load(); } catch (e) { toast(e.message, 'bad'); } }) : null))) : null);
    } catch (e) { list.replaceChildren(errorBox(e.message)); }
  };
  const send = btn('Send request', 'plum', async () => {
    err.replaceChildren();
    const done = busy('Sending');
    try { await api('POST', `/parent/children/${studentId}/leave`, { from: from.value, to: to.value || from.value, reason: why.value }); done(); toast('Sent to the teacher', 'ok'); from.value = ''; to.value = ''; why.value = ''; load(); }
    catch (e) { done(); err.replaceChildren(errorBox(e.message)); }
  });
  box.append(err, h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { for: 'lfrom' }, 'First day'), from), h('div', { class: 'field' }, h('label', { for: 'lto' }, 'Last day (optional)'), to)),
    h('div', { class: 'field' }, h('label', { for: 'lwhy' }, 'Reason'), why), h('div', { class: 'row', style: 'justify-content:flex-end' }, send), list);
  load();
  return box;
}

function meetingCard(studentId) {
  const box = card('Meet the teacher', 'Choose one time for this child. You will get a reminder the day before.');
  const body = h('div', { class: 'small muted' }, 'Loading');
  box.append(body);
  const load = async () => {
    try {
      const v = await api('GET', `/parent/children/${studentId}/meetings`);
      if (v.booked) body.replaceChildren(h('div', { class: 'item' }, h('div', { class: 'grow' }, h('strong', {}, v.booked.day + ' at ' + v.booked.time), h('p', { class: 'small muted' }, v.booked.minutes + ' minutes' + (v.booked.note ? ' · ' + v.booked.note : ''))),
        h('span', { class: 'chip leaf' }, 'Booked'), sure('Cancel booking', async () => { try { await api('DELETE', `/parent/children/${studentId}/meetings/${v.booked.id}`); toast('Booking cancelled', 'ok'); load(); } catch (e) { toast(e.message, 'bad'); } })));
      else if (!v.open.length) body.replaceChildren(h('p', { class: 'muted' }, 'No meeting times are open right now. Use the message box below to write to the teacher.'));
      else body.replaceChildren(h('div', { class: 'list' }, v.open.slice(0, 20).map((s) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('strong', {}, s.day + ' at ' + s.time), h('span', { class: 'small muted' }, ' · ' + s.minutes + ' min' + (s.note ? ' · ' + s.note : ''))),
        btn('Book', 'leaf', async () => { try { await api('POST', `/parent/children/${studentId}/meetings/${s.id}/book`); toast('Booked', 'ok'); load(); } catch (e) { toast(e.message, 'bad'); load(); } }, 'small')))));
    } catch (e) { body.replaceChildren(errorBox(e.message)); }
  };
  load();
  return box;
}

// ---------- download helper (same as reports.js) ----------
async function download(path, fallbackName) {
  try {
    const res = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + GM.state.token } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed.');
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || fallbackName;
    const url = URL.createObjectURL(await res.blob());
    const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { toast(e.message, 'bad'); }
}
GM.download = GM.download || download;

// ---------- calendar file (.ics) built in the browser from the list the server sent; text is escaped ----------
const icsEsc = (v) => String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsFile(data) {
  const ymd = (d) => d.replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ev = data.items.map((it, i) => {
    const lines = ['BEGIN:VEVENT', `UID:gapmap-${ymd(it.date)}-${i}-${icsEsc(data.child).length}@gapmap`, 'DTSTAMP:' + stamp];
    if (it.time) lines.push(`DTSTART:${ymd(it.date)}T${it.time.replace(':', '')}00`, `DURATION:PT${it.minutes || 10}M`);
    else lines.push('DTSTART;VALUE=DATE:' + ymd(it.date));
    lines.push('SUMMARY:' + icsEsc((it.kind === 'homework' ? 'Homework due: ' : '') + it.title + ' (' + data.child + ')'), 'END:VEVENT');
    return lines.join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GapMap//EN', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}
GM.icsFile = icsFile;
function upcomingBox(path) {
  const box = h('div', {}, h('p', { class: 'small muted' }, 'Loading'));
  (async () => { try {
    const d = await api('GET', path);
    box.replaceChildren(
      d.items.length ? h('div', { class: 'list' }, d.items.map((it) => h('div', { class: 'item' },
        h('strong', { style: 'min-width:90px' }, it.date.slice(5) + (it.time ? ' ' + it.time : '')), h('div', { class: 'grow' }, it.title),
        it.kind === 'homework' ? h('span', { class: 'chip ' + (it.done ? 'leaf' : 'sun') }, it.done ? 'Handed in' : 'To do') : h('span', { class: 'chip blue' }, 'Meeting'))))
        : h('p', { class: 'muted' }, 'Nothing is due in the next 14 days.'),
      d.items.length ? h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:10px' }, btn('Add to my calendar (.ics)', 'ghost', () => {
        const url = URL.createObjectURL(new Blob([icsFile(d)], { type: 'text/calendar' }));
        const a = h('a', { href: url, download: 'gapmap-upcoming.ics' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      }, 'small')) : null);
  } catch (e) { box.replaceChildren(errorBox(e.message)); } })();
  return box;
}
GM.upcomingCard = (studentId) => card('Coming up in the next 14 days', 'Homework due dates and your meeting. Nothing here is a mark.', upcomingBox(`/parent/children/${studentId}/calendar`));
function studentCalendar() {
  page([{ label: 'Home', href: '#/s' }, { label: 'Coming up' }], head('Coming up', 'Homework due in the next 14 days.'), h('div', { class: 'slab' }, upcomingBox('/student/calendar')));
}

// ---------- TEACHER: quick actions on an alert (sends a fixed, kind message to that child's family) ----------
GM.quickActions = (cid, studentId, name) => {
  const T = [
    ['Please call me', 'notice', 'Please call me', `Please call or message me when you are free, so we can talk about how ${name} is doing.`],
    ['Extra practice', 'notice', `Extra practice for ${name}`, `I will give ${name} a little extra practice. A few minutes each day will help. Please encourage them.`],
    ['Well done', 'praise', 'Great improvement', `${name} has been improving. Well done!`]];
  return h('div', { class: 'row', style: 'gap:8px;margin-top:8px;flex-wrap:wrap' }, h('span', { class: 'small muted' }, 'Quick message to the family:'), ...T.map(([label, kind, title, body]) => sure(label, async () => {
    try { await api('POST', `/classes/${cid}/notices`, { kind, title, body, studentId }); toast('Sent to ' + name + "'s family", 'ok'); } catch (e) { toast(e.message, 'bad'); }
  })));
};

GM.parentExtras = (studentId) => h('div', { class: 'noprint' }, GM.upcomingCard(studentId), leaveCard(studentId), meetingCard(studentId));

GM.routes.push([/^\/s\/calendar$/, studentCalendar, 'student'], [/^\/t\/c\/(\d+)\/leave$/, leaveScreen, 'teacher'], [/^\/t\/c\/(\d+)\/meetings$/, meetingsScreen, 'teacher']);
})();
