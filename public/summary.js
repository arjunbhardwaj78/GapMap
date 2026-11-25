/* GapMap Milestone 12 Hindi step 1: one-tap "Hindi summary" for parents. NO AI: the server fills fixed Hindi templates with numbers from the report.
   All text goes in with h() (textContent), never innerHTML. Never printed (class noprint). "Listen" uses the phone's own voice (speechSynthesis), no paid speech service. */
(() => {
'use strict';
const GM = window.GM;
const { h, api, btn, page, head, empty, errorBox } = GM;
const DEV = (id) => (id ? `#/p/c/${id}/summary` : '#/p/summary');

// the big button (parent home: all children; child page: that child)
GM.hindiSummaryButton = (id) => h('a', { class: 'btn big plum hindi-btn noprint', href: DEV(id), 'aria-label': 'हिंदी में सारांश सुनें या देखें (Hindi summary)' },
  h('span', { class: 'hindi-main', lang: 'hi' }, 'हिंदी में सारांश सुनें / देखें'), h('span', { class: 'hindi-sub' }, 'Hindi summary of your child, one tap'));

// does this phone have a Hindi voice? (voices can load late, so we also listen for the change)
function hindiVoice() {
  if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance === 'undefined') return null;
  return (window.speechSynthesis.getVoices() || []).find((v) => /^hi([-_]|$)/i.test(v.lang)) || null;
}

async function summaryScreen(id) {
  const base = id ? `/parent/children/${id}/summary` : '/parent/summary';
  const [hi, hg] = await Promise.all([api('GET', base + '?lang=hi'), api('GET', base + '?lang=hinglish')]);
  const cards = (r) => (id ? [r] : r.children);
  const HI = cards(hi), HG = cards(hg);
  let mode = 'hi';
  const holder = h('div'), toggle = h('div', { class: 'row', style: 'gap:8px;margin-bottom:16px' }), speak = { on: null };

  // Listen: always shown. The voice is looked up at the moment of the tap (phones load voices late), each line is spoken
  // as its own short piece (long text makes Chrome stop), and if nothing starts speaking we tell the parent what to do.
  const listen = (lines, statusEl) => {
    let playing = false;
    const b = h('button', { class: 'btn leaf small', type: 'button' }, 'सुनें (Listen)');
    const finish = () => { playing = false; b.textContent = 'सुनें (Listen)'; };
    b.addEventListener('click', () => {
      const ss = window.speechSynthesis;
      if (!ss || typeof window.SpeechSynthesisUtterance === 'undefined') { statusEl.textContent = 'This browser cannot read aloud. Please read the text above.'; return; }
      if (playing) { ss.cancel(); finish(); return; }
      statusEl.textContent = '';
      ss.cancel();
      const voice = hindiVoice();
      let started = false;
      const parts = lines.filter(Boolean);
      parts.forEach((t, i) => {
        const u = new window.SpeechSynthesisUtterance(t); u.lang = 'hi-IN'; u.rate = 0.9; if (voice) u.voice = voice;
        u.onstart = () => { started = true; playing = true; b.textContent = 'रोकें (Stop)'; };
        if (i === parts.length - 1) u.onend = finish;
        u.onerror = (ev) => { if (ev && (ev.error === 'canceled' || ev.error === 'interrupted')) return; finish(); statusEl.textContent = 'Could not play the voice. Check that the phone volume is on.'; };
        setTimeout(() => ss.speak(u), i === 0 ? 80 : 0);   // a tiny wait after cancel() so Chrome does not swallow the first line
      });
      setTimeout(() => { if (!started) { ss.cancel(); finish(); statusEl.textContent = voice ? 'The voice did not start. Turn the volume up and try again.' : 'No Hindi voice found on this phone. Open Settings > Language > Text-to-speech and install Hindi, then try again.'; } }, 2500);
    });
    return b;
  };
  function draw() {
    const list = mode === 'hi' ? HI : HG;
    toggle.replaceChildren(
      h('button', { class: 'btn small ' + (mode === 'hi' ? 'plum' : 'ghost'), type: 'button', 'aria-pressed': String(mode === 'hi'), onclick: () => { mode = 'hi'; draw(); } }, 'देवनागरी'),
      h('button', { class: 'btn small ' + (mode === 'hinglish' ? 'plum' : 'ghost'), type: 'button', 'aria-pressed': String(mode === 'hinglish'), onclick: () => { mode = 'hinglish'; draw(); } }, 'Roman Hindi'));
    holder.replaceChildren(...list.map((c, i) => {
      const dev = HI[i], status = h('p', { class: 'small muted', 'aria-live': 'polite', style: 'margin-top:8px' });
      const lb = listen(dev.lines, status);   // the voice always reads the Devanagari text, which a Hindi voice says best
      return h('div', { class: 'slab', style: 'margin-bottom:18px' },
        h('h2', { style: 'margin-bottom:10px' }, c.child.name),
        c.lines.map((line) => h('p', { class: 'hindi-line', lang: mode === 'hi' ? 'hi' : 'en-IN' }, line)),
        h('div', { class: 'row', style: 'margin-top:14px;gap:10px;flex-wrap:wrap' }, lb, h('a', { class: 'btn blue small', href: `#/p/c/${c.child.id}/report` }, 'Full report card')),
        status);
    }));
  }
  draw();
  if ('speechSynthesis' in window) window.speechSynthesis.addEventListener && window.speechSynthesis.addEventListener('voiceschanged', () => { if (holder.isConnected) draw(); }, { once: true });
  page([{ label: 'Home', href: '#/p' }].concat(id ? [{ label: HI[0].child.name, href: '#/p/c/' + id }] : []).concat([{ label: 'Hindi summary' }]),
    head('हिंदी में सारांश', 'A short summary made from your child\'s recorded numbers. It is made from fixed sentences, not by AI.'),
    HI.length ? h('div', { class: 'noprint' }, toggle, holder, h('p', { class: 'small muted' }, 'Numbers come from the same records as the report card. Marks and wording are never guessed.')) : empty('No child linked yet', 'Ask the teacher to link your login to your child.'));
}
GM.routes.push([/^\/p\/summary$/, () => summaryScreen(null), 'parent'], [/^\/p\/c\/(\d+)\/summary$/, (id) => summaryScreen(id), 'parent']);
})();
