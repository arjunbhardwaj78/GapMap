/* Notifications: the bell in the header (all three roles), the list page #/n, mute switches, and the teacher's "Sent" page.
   All server text goes in with h() (textContent). The bell count is polled every 60 seconds and on every page change. */
(() => {
'use strict';
const GM = window.GM, { h, api, state, page, head, empty, btn, icon, toast } = GM;

// ---------- the bell ----------
function setBadges(n) {
  document.querySelectorAll('.bell-badge').forEach((b) => { b.textContent = n > 99 ? '99+' : String(n); b.hidden = !n; });
  document.querySelectorAll('a.bell').forEach((a) => a.setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications'));
}
async function refresh() {
  if (!state.user || !state.token) return;
  try { setBadges((await api('GET', '/notifications/unread-count')).unread); } catch (e) { /* the bell stays as it was */ }
}
GM.bell = () => {
  const el = h('a', { class: 'bell', href: '#/n', 'aria-label': 'Notifications' }, icon('bell'), h('span', { class: 'bell-badge', hidden: true }));
  refresh();
  return el;
};
GM.refreshBell = refresh;
setInterval(refresh, 60000);
window.addEventListener('hashchange', refresh);

// ---------- list page ----------
const LABELS = { notice_posted: 'Notices from the teacher', report_ready: 'Report ready', quiz_assigned: 'New quizzes', test_assigned: 'New tests', homework_assigned: 'New homework' };
const KIND = { absent_today: 'rose', missed_test: 'rose', missed_quiz: 'rose', missed_homework: 'rose', homework_overdue: 'rose', attendance_low: 'sun', performance_drop: 'sun', performance_low: 'sun',
  result_ready: 'leaf', improvement: 'leaf', good_attendance: 'leaf', notice_posted: 'plum', message_from_parent: 'plum' };
const when = (s) => { const d = new Date(String(s).replace(' ', 'T') + 'Z'); return isNaN(d) ? '' : d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };
const homeLink = () => (state.user.role === 'teacher' ? '#/t' : state.user.role === 'parent' ? '#/p' : '#/s');

async function listPage() {
  if (!state.user) { location.hash = '#/login'; return; }
  const [data, prefs] = await Promise.all([api('GET', '/notifications'), state.user.role === 'teacher' ? null : api('GET', '/notifications/prefs')]);
  const open = async (n) => { if (!n.read) { try { await api('POST', '/notifications/read', { ids: [n.id] }); } catch (e) { /* still go */ } } location.hash = n.link || homeLink(); GM.refreshBell(); };
  const markAll = btn('Mark all read', 'ghost', async () => { await api('POST', '/notifications/read', { all: true }); toast('All marked as read'); GM.route(); }, 'small');
  const rows = data.items.map((n) => h('a', { class: 'item notif' + (n.read ? '' : ' unread'), href: n.link || homeLink(), onclick: (e) => { e.preventDefault(); open(n); } },
    h('div', { class: 'grow' },
      h('strong', {}, n.title), n.child ? h('span', { class: 'chip blue', style: 'margin-left:8px' }, n.child) : null,
      n.body ? h('p', { class: 'muted', style: 'margin-top:4px' }, n.body) : null),
    h('span', { class: 'muted small-text' }, when(n.when)),
    n.read ? null : h('span', { class: 'chip ' + (KIND[n.type] || 'blue') }, 'New')));
  const prefCard = prefs ? h('div', { class: 'slab', style: 'margin-top:18px' },
    h('h3', {}, 'What to hear about'),
    h('p', { class: 'muted' }, 'You can switch off the lower-priority messages. ' + prefs.note),
    h('div', { class: 'pill-list', style: 'margin-top:10px' }, prefs.mutableTypes.map((t) => {
      const cb = h('input', { type: 'checkbox', id: 'mute-' + t, ...(prefs.muted.includes(t) ? {} : { checked: true }) });
      cb.addEventListener('change', async () => {
        const muted = prefs.mutableTypes.filter((x) => !document.getElementById('mute-' + x).checked);
        try { await api('PUT', '/notifications/prefs', { muted }); toast('Saved'); } catch (e) { toast(e.message, 'bad'); cb.checked = !cb.checked; }
      });
      return h('label', { class: 'chip', for: 'mute-' + t, style: 'cursor:pointer' }, cb, ' ' + (LABELS[t] || t));
    }))) : null;
  page([{ label: 'Home', href: homeLink() }, { label: 'Notifications' }],
    head('Notifications', data.unread ? `${data.unread} unread` : 'You are all caught up.', data.unread ? markAll : null),
    data.items.length ? h('div', { class: 'list' }, rows) : empty('Nothing yet', 'New homework, quizzes, results and notices will appear here.'), prefCard);
  GM.refreshBell();
}

// ---------- teacher: what was sent and who has read it ----------
async function sentPage(cid) {
  const [classes, log] = await Promise.all([api('GET', '/classes'), api('GET', `/classes/${cid}/sent-notifications`)]);
  const c = classes.find((x) => String(x.id) === String(cid)) || { name: 'Class' };
  page([{ label: 'Classes', href: '#/t' }, { label: c.name, href: '#/t/c/' + cid }, { label: 'Sent notifications' }],
    head('Sent notifications', 'Sent automatically when you assign, publish, check or post. Counts only.', GM.btn('Download CSV', 'ghost', () => GM.download(`/classes/${cid}/sent-notifications.csv`, 'notifications.csv'), 'small')),
    log.length ? h('div', { class: 'list' }, log.map((r) => h('div', { class: 'item' },
      h('div', { class: 'grow' }, h('strong', {}, r.title), h('p', { class: 'muted' }, when(r.firstAt))),
      h('span', { class: 'chip leaf' }, `Students read ${r.studentsRead} of ${r.students}`),
      h('span', { class: 'chip plum' }, `Parents read ${r.parentsRead} of ${r.parents}`)))) : empty('Nothing sent yet', 'Assign homework or publish a quiz and it shows up here.'));
}

GM.routes.push([/^\/n$/, listPage, false], [/^\/t\/c\/(\d+)\/sent$/, sentPage, 'teacher']);
})();
