/* GapMap Milestone 12 step 5: contact numbers with consent. Default OFF. All text goes in with h() (textContent), never innerHTML.
   A number is only ever sent by the server to the OTHER side when its owner switched sharing on. Never on printed pages (class noprint). */
(() => {
'use strict';
const { h, api, toast, btn, modal, errorBox } = window.GM;
const GM = window.GM;

// "98xxxxx210  [Show]  [Call]  [WhatsApp]" for a number the owner agreed to share. tel: and wa.me links are built from 10 checked digits.
GM.contactLine = (c, who) => {
  if (!c || !c.shared) return h('span', { class: 'small muted' }, 'No number shared. Use in-app messages.');
  const num = h('strong', { class: 'cnum' }, c.masked);
  const show = h('button', { type: 'button', class: 'btn ghost small', 'aria-label': 'Show or hide the number of ' + (who || 'this person') }, 'Show');
  show.addEventListener('click', () => { const hidden = num.textContent === c.masked; num.textContent = hidden ? c.phone : c.masked; show.textContent = hidden ? 'Hide' : 'Show'; });
  return h('span', { class: 'row cline', style: 'gap:8px;align-items:center;flex-wrap:wrap' }, num, show,
    h('a', { class: 'btn leaf small', href: 'tel:+91' + c.phone }, 'Call'),
    h('a', { class: 'btn blue small', href: 'https://wa.me/91' + c.phone, target: '_blank', rel: 'noopener noreferrer' }, 'WhatsApp'),
    c.preferredTime ? h('span', { class: 'small muted' }, 'Best time: ' + c.preferredTime) : null,
    c.language ? h('span', { class: 'small muted' }, c.language === 'hi' ? 'Hindi' : 'English') : null);
};

// my own contact settings (teacher or parent)
GM.contactModal = async () => {
  let m;
  try { m = await api('GET', '/me/contact'); } catch (e) { toast(e.message, 'bad'); return; }
  const err = h('div');
  const phone = h('input', { id: 'cphone', inputmode: 'tel', autocomplete: 'off', maxlength: 20, placeholder: '10-digit mobile number (optional)', value: m.phone });
  const time = h('input', { id: 'ctime', maxlength: 60, placeholder: 'For example: after 4 pm', value: m.preferredTime });
  const lang = h('select', { id: 'clang' }, [['', 'Not set'], ['en', 'English'], ['hi', 'Hindi']].map(([v, l]) => h('option', { value: v, selected: v === m.language }, l)));
  const share = h('input', { type: 'checkbox', id: 'cshare' }); share.checked = m.share;
  modal({ title: 'My contact details', body: h('div', {}, err,
    h('p', { class: 'small muted', style: 'margin-bottom:12px' }, m.note),
    h('div', { class: 'field' }, h('label', { for: 'cphone' }, 'Mobile number'), phone),
    h('div', { class: 'row' }, h('div', { class: 'field', style: 'flex:2;min-width:160px' }, h('label', { for: 'ctime' }, 'Best time to reach me'), time), h('div', { class: 'field', style: 'flex:1;min-width:120px' }, h('label', { for: 'clang' }, 'Language for GapMap messages'), lang)),
    h('label', { class: 'row', for: 'cshare', style: 'gap:10px;align-items:center;margin-top:8px;font-weight:650' }, share, m.shareLabel),
    h('p', { class: 'small muted', style: 'margin-top:6px' }, 'Switched off by default. You can switch it off again any time.')),
    actions: [{ label: 'Cancel', onclick: (c) => c() }, { label: 'Save', color: 'plum', onclick: async (close) => {
      try { await api('PUT', '/me/contact', { phone: phone.value, preferredTime: time.value, language: lang.value, share: share.checked }); close(); toast('Contact details saved', 'ok'); } catch (e) { err.replaceChildren(errorBox(e.message)); } } }] });
};

// parent: "Contact the teacher" card (never printed)
GM.contactCard = (studentId) => {
  const box = h('div', { class: 'slab noprint contact-card', style: 'margin-top:22px' }, h('h3', { style: 'margin-bottom:6px' }, 'Contact the teacher'), h('p', { class: 'small muted' }, 'Loading'));
  api('GET', `/parent/children/${studentId}/teacher-contact`).then((c) => {
    box.replaceChildren(h('h3', { style: 'margin-bottom:6px' }, 'Contact the teacher'),
      c.shared ? h('div', {}, h('p', { class: 'small muted', style: 'margin-bottom:8px' }, c.teacherName + ' chose to share this number with parents.'), GM.contactLine(c, c.teacherName))
        : h('p', { class: 'muted' }, 'Use in-app messages: write to the teacher below. They always work.'),
      h('p', { class: 'small muted', style: 'margin-top:8px' }, 'Numbers are only visible to each other, never to other families.'));
  }).catch(() => box.replaceChildren(h('h3', {}, 'Contact the teacher'), h('p', { class: 'muted' }, 'Use in-app messages.')));
  return box;
};
})();
