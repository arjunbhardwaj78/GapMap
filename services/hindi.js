// Milestone 12, item 6: Hindi versions of the SYSTEM notification text. Fixed templates only, written by people, not machine translation.
// Used only when the person chose Hindi in their contact details (contact_prefs.language = 'hi'). Everyone else gets the English text.
// Teacher-written words (notice titles and bodies, homework/quiz/test titles) are put in exactly as the teacher wrote them and are never translated.
// Wording stays soft ("may need support"). Numbers are the same numbers the English text uses. A Hindi-speaking teacher should read these once before real use.

const list = (items, count) => (items || []).join(', ') + (count && items && count > items.length ? ' और अन्य' : '');
const span = (from, to) => (from === to ? from : from + ' से ' + to);

// alert text from the same numbers the English alert used. Returns { title, studentBody, parentBody } or null for an unknown type.
function alert(type, n, name) {
  n = n || {};
  const T = {
    performance_low: ['कुल अंकों में सहायता की ज़रूरत हो सकती है',
      `अब तक आपके कुल अंक ${n.count} परिणामों में ${n.overall}% हैं। शिक्षक से थोड़ी बातचीत मदद कर सकती है।`,
      `अब तक ${name} के कुल अंक ${n.count} परिणामों में ${n.overall}% हैं। शिक्षक से थोड़ी बातचीत मदद कर सकती है।`],
    performance_drop: ['हाल के परिणामों में सहायता की ज़रूरत हो सकती है',
      `पिछले ${n.n} परिणामों में आपका औसत ${n.last}% है, जो पहले ${n.before}% था। शिक्षक से थोड़ी बातचीत मदद कर सकती है।`,
      `पिछले ${n.n} परिणामों में ${name} का औसत ${n.last}% है, जो पहले ${n.before}% था। शिक्षक से थोड़ी बातचीत मदद कर सकती है।`],
    improvement: ['अच्छी खबर: परिणाम बेहतर हो रहे हैं',
      `पिछले ${n.n} परिणामों में आपका औसत ${n.last}% है, जो पहले ${n.before}% था। शाबाश!`,
      `पिछले ${n.n} परिणामों में ${name} का औसत ${n.last}% है, जो पहले ${n.before}% था। अच्छी खबर।`],
    attendance_low: ['उपस्थिति में सहायता की ज़रूरत हो सकती है',
      `अब तक आपकी उपस्थिति ${n.counted} स्कूल दिनों में ${n.attendance}% है। नियमित आने से पढ़ाई में मदद मिलती है।`,
      `अब तक ${name} की उपस्थिति ${n.counted} स्कूल दिनों में ${n.attendance}% है। यदि आने में कोई कठिनाई हो तो कृपया शिक्षक से बात करें।`],
    absent_streak: ['लगातार कई दिन अनुपस्थित',
      `आप लगातार ${n.daysInARow} स्कूल दिन अनुपस्थित दर्ज हुए हैं। यदि कोई समस्या हो तो अपने शिक्षक को बताइए।`,
      `${name} को लगातार ${n.daysInARow} स्कूल दिन अनुपस्थित दर्ज किया गया है। यदि कोई समस्या हो तो कृपया शिक्षक को बताइए।`],
    good_attendance: ['अच्छी खबर: पिछले महीने पूरी उपस्थिति',
      `${n.month} में आप हर स्कूल दिन उपस्थित थे। बहुत बढ़िया।`,
      `${n.month} में ${name} की हर स्कूल दिन उपस्थिति रही। अच्छी खबर।`],
    missed_homework: ['गृहकार्य जमा नहीं हुआ',
      `देय तिथि के बाद भी ${n.count} गृहकार्य जमा नहीं हुए: ${list(n.items, n.count)}।`,
      `${name} के ${n.count} गृहकार्य देय तिथि के बाद भी जमा नहीं हुए: ${list(n.items, n.count)}।`],
    missed_test: ['एक टेस्ट का परिणाम अभी नहीं है',
      `${list(n.items, n.count)} में अभी आपका कोई परिणाम नहीं है। कृपया अपने शिक्षक से पूछिए।`,
      `${list(n.items, n.count)} में अभी ${name} का कोई परिणाम नहीं है। कृपया शिक्षक से पूछिए।`],
    missed_quiz: ['एक क्विज़ छूट गया',
      `एक क्विज़ आपके देने से पहले बंद हो गया: ${list(n.items, n.count)}। शिक्षक से पूछिए कि क्या आप अब भी दे सकते हैं।`,
      `एक क्विज़ ${name} के देने से पहले बंद हो गया: ${list(n.items, n.count)}। कृपया शिक्षक से पूछिए।`],
  };
  const t = T[type];
  return t ? { title: t[0], studentBody: t[1], parentBody: t[2] } : null;
}

const homeworkAssigned = (title, due) => ({ title: 'नया गृहकार्य: ' + title, body: due ? 'कृपया इसे ' + due + ' तक जमा करें।' : 'आपके शिक्षक ने नया गृहकार्य दिया है।' });
const testAssigned = (title) => ({ title: 'नया टेस्ट: ' + title, body: 'आपके शिक्षक ने नया टेस्ट रखा है।' });
const paperTest = (title) => ({ title: 'नया पेपर टेस्ट: ' + title, body: 'टेस्ट के बाद शिक्षक आपके अंक दर्ज करेंगे। आपका परिणाम यहाँ दिखेगा।' });
const quizAssigned = (title) => ({ title: 'नया क्विज़: ' + title, body: 'आपके शिक्षक ने एक क्विज़ प्रकाशित किया है।' });
const result = (title, marks, total, withDetails) => ({ title: 'परिणाम तैयार: ' + title, body: `अंक: ${total} में से ${marks}।` + (withDetails ? ' विवरण देखने के लिए इसे खोलिए।' : '') });
const absentToday = (date) => ({ title: 'आज अनुपस्थित दर्ज', body: `आपके बच्चे को आज (${date}) अनुपस्थित दर्ज किया गया है। यदि यह गलती है तो कृपया शिक्षक को संदेश भेजिए।` });
// the teacher's own title and text go in unchanged; only the label in front is Hindi
const notice = (praise, teacherTitle, teacherBody) => ({ title: (praise ? 'अच्छी खबर: ' : 'सूचना: ') + teacherTitle, body: teacherBody });
const homeworkDue = (title, due, today, name) => {
  if (due >= today) { const w = due === today ? 'आज' : 'कल';
    return { title: `गृहकार्य ${w} देय: ${title}`, studentBody: `आपका गृहकार्य "${title}" ${w} देय है। कृपया इसे जमा कीजिए।`, parentBody: `${name} का गृहकार्य "${title}" ${w} देय है। यह अभी जमा नहीं हुआ है।` }; }
  return { title: 'गृहकार्य की तिथि निकल गई: ' + title, studentBody: `आपका गृहकार्य "${title}" ${due} को देय था और अभी जमा नहीं हुआ है। आप अब भी इसे जमा कर सकते हैं।`, parentBody: `${name} का गृहकार्य "${title}" ${due} को देय था और अभी जमा नहीं हुआ है।` };
};
const parentMessage = (name) => ({ title: `${name} के बारे में अभिभावक का संदेश`, body: 'पढ़ने और जवाब देने के लिए सूचनाएँ खोलिए।' });

const leaveRequest = (name, from, to) => ({ title: name + ' के लिए छुट्टी का अनुरोध', body: span(from, to) });
const leaveDecision = (ok, name, from, to) => {
  const s = span(from, to);
  return ok ? { title: 'छुट्टी स्वीकृत', body: `${name}: ${s}।`, parentBody: `${name} की छुट्टी (${s}) स्वीकृत हुई। इन दिनों को उपस्थिति में अनुपस्थिति नहीं गिना जाएगा।`, studentBody: `आपकी छुट्टी (${s}) स्वीकृत हुई।` }
    : { title: 'छुट्टी स्वीकृत नहीं हुई', body: `${name}: ${s}।`, parentBody: `${name} की छुट्टी (${s}) स्वीकृत नहीं हुई। यदि कोई प्रश्न हो तो कृपया शिक्षक को संदेश भेजिए।`, studentBody: `आपकी छुट्टी (${s}) स्वीकृत नहीं हुई।` };
};
const meetingOpen = (day) => ({ title: 'मिलने के समय खुले हैं', body: `शिक्षक ने ${day} के लिए मिलने के समय रखे हैं। एक चुनने के लिए अपने बच्चे का पेज खोलिए।` });
const meetingBooked = (name, when, minutes) => ({ title: 'मुलाक़ात तय हुई', body: `${name} के बारे में शिक्षक से मुलाक़ात: ${when}।`, parentBody: `${name} के बारे में शिक्षक से मुलाक़ात: ${when} (${minutes} मिनट)। एक दिन पहले आपको याद दिलाया जाएगा।` });
const meetingBookedTeacher = (name, when) => ({ title: 'मुलाक़ात तय हुई', body: `${name} के परिवार ने ${when} चुना है।` });
const meetingCancelled = (day, time) => ({ title: 'मुलाक़ात रद्द हुई', body: `शिक्षक ने ${day} को ${time} की मुलाक़ात रद्द कर दी है। कृपया कोई और समय चुनिए।` });
const meetingCancelledTeacher = (name, day, time) => ({ title: 'मुलाक़ात रद्द हुई', body: `${name} के परिवार ने ${day} को ${time} की मुलाक़ात रद्द की। यह समय फिर खाली है।` });
const meetingReminder = (name, day, time) => ({ title: 'कल मुलाक़ात है', body: `याद दिलाना: ${name} के बारे में कल (${day}) ${time} बजे मुलाक़ात है।` });
const meetingReminderTeacher = (name, time) => ({ title: 'कल मुलाक़ात है', body: `${name} का परिवार ${time} बजे।` });

// weekly digest: same facts as the English digest, passed in as numbers/names
function digest(name, d) {
  const L = [];
  L.push(d.marked ? `उपस्थिति: ${d.att.present} उपस्थित, ${d.att.late} देर से, ${d.att.absent} अनुपस्थित${d.att.leave ? ', ' + d.att.leave + ' छुट्टी पर' : ''}।` : 'इस सप्ताह उपस्थिति दर्ज नहीं हुई।');
  L.push(d.tests ? `इस सप्ताह के टेस्ट: ${d.tests} में से ${d.done} जमा हुए।` : 'इस सप्ताह कोई टेस्ट नहीं था।');
  L.push(d.next.length ? `अगले सप्ताह देय गृहकार्य: ${d.next.join(', ')}${d.more ? ' और ' + d.more + ' अन्य' : ''}।` : 'अगले सप्ताह कोई गृहकार्य देय नहीं है।');
  if (d.good === 'days') L.push('अच्छी खबर: इस सप्ताह कोई स्कूल दिन नहीं छूटा।');
  else if (d.good === 'homework') L.push('अच्छी खबर: इस सप्ताह देय सारा गृहकार्य जमा हुआ।');
  return { title: 'इस सप्ताह: ' + name, body: L.join(' ') };
}

// ---------- Parent summary (Hindi in Devanagari, Hindi in Roman letters, English). Fixed templates, no AI. ----------
// f = facts built by services/summary.js from reportFor / attendanceFor. Every number below comes from f. The child's name is put in exactly as stored.
// Teacher-written titles (tests, homework) are put in unchanged. Wording stays soft. A Hindi-speaking teacher should read these once before real use.
const SUMMARY = {
  hi: {
    hello: (n) => `नमस्ते। यह आपके बच्चे ${n} का सारांश है।`,
    attMonth: (n, p) => `आपके बच्चे ${n} की उपस्थिति इस महीने ${p}% रही।`,
    attNoMonth: () => 'इस महीने की उपस्थिति अभी दर्ज नहीं हुई है।',
    attAll: (p) => `अब तक की कुल उपस्थिति ${p}% है।`,
    testItem: (t) => `${t.title} में ${t.total} में से ${t.marks} अंक (${t.pct}%)`,
    tests: (items, avg) => `हाल के परिणाम: ${items.join('; ')}।` + (avg == null ? '' : ` अब तक औसत ${avg}% है।`),
    noTests: () => 'अभी कोई टेस्ट या क्विज़ का परिणाम नहीं आया है।',
    hw: (c, titles, days) => `अगले ${days} दिनों में ${c} गृहकार्य देय हैं: ${titles.join(', ')}${c > titles.length ? ' और अन्य' : ''}।`,
    noHw: (days) => `अगले ${days} दिनों में कोई गृहकार्य देय नहीं है।`,
    good: { attendance: 'अच्छी खबर: इस महीने उपस्थिति पूरी रही।', improving: 'अच्छी खबर: हाल के परिणाम पहले से बेहतर हैं।', homework: 'अच्छी खबर: अब तक का सारा गृहकार्य जमा है।' },
    support: {
      attendance: (p) => 'ध्यान देने की बात: उपस्थिति में सहायता की ज़रूरत हो सकती है' + (p == null ? '' : ` (अब तक ${p}%)`) + '। यदि आने में कोई कठिनाई हो तो कृपया शिक्षक से बात करें।',
      marks: () => 'ध्यान देने की बात: कुल अंकों में सहायता की ज़रूरत हो सकती है। शिक्षक से थोड़ी बातचीत मदद कर सकती है।',
      homework: () => 'ध्यान देने की बात: गृहकार्य जमा करने में थोड़ी सहायता की ज़रूरत हो सकती है।',
      tests: () => 'एक टेस्ट या क्विज़ का परिणाम अभी नहीं है। कृपया शिक्षक से पूछिए।',
    },
    close: () => 'आपका साथ बच्चे के लिए बहुत मायने रखता है। कोई सवाल हो तो शिक्षक को संदेश भेजिए। धन्यवाद।',
  },
  hinglish: {
    hello: (n) => `Namaste. Yeh aapke bacche ${n} ka saransh hai.`,
    attMonth: (n, p) => `Aapke bacche ${n} ki attendance is mahine ${p}% rahi.`,
    attNoMonth: () => 'Is mahine ki attendance abhi darj nahi hui hai.',
    attAll: (p) => `Ab tak ki kul attendance ${p}% hai.`,
    testItem: (t) => `${t.title} mein ${t.total} mein se ${t.marks} ank (${t.pct}%)`,
    tests: (items, avg) => `Haal ke results: ${items.join('; ')}.` + (avg == null ? '' : ` Ab tak average ${avg}% hai.`),
    noTests: () => 'Abhi koi test ya quiz ka result nahi aaya hai.',
    hw: (c, titles, days) => `Agle ${days} dinon mein ${c} homework dene hain: ${titles.join(', ')}${c > titles.length ? ' aur anya' : ''}.`,
    noHw: (days) => `Agle ${days} dinon mein koi homework dena nahi hai.`,
    good: { attendance: 'Achchhi khabar: is mahine attendance poori rahi.', improving: 'Achchhi khabar: haal ke results pehle se behtar hain.', homework: 'Achchhi khabar: ab tak ka sara homework jama hai.' },
    support: {
      attendance: (p) => 'Dhyan dene ki baat: attendance mein sahayata ki zaroorat ho sakti hai' + (p == null ? '' : ` (ab tak ${p}%)`) + '. Agar aane mein koi kathinai ho to kripya teacher se baat kijiye.',
      marks: () => 'Dhyan dene ki baat: kul ankon mein sahayata ki zaroorat ho sakti hai. Teacher se thodi baatcheet madad kar sakti hai.',
      homework: () => 'Dhyan dene ki baat: homework jama karne mein thodi sahayata ki zaroorat ho sakti hai.',
      tests: () => 'Ek test ya quiz ka result abhi nahi hai. Kripya teacher se poochhiye.',
    },
    close: () => 'Aapka saath bacche ke liye bahut mayne rakhta hai. Koi sawal ho to teacher ko message bhejiye. Dhanyavaad.',
  },
  en: {
    hello: (n) => `Hello. This is a short summary for your child ${n}.`,
    attMonth: (n, p) => `${n}'s attendance this month is ${p}%.`,
    attNoMonth: () => "This month's attendance has not been marked yet.",
    attAll: (p) => `Attendance so far is ${p}% overall.`,
    testItem: (t) => `${t.title}: ${t.marks} out of ${t.total} (${t.pct}%)`,
    tests: (items, avg) => `Latest results: ${items.join('; ')}.` + (avg == null ? '' : ` The average so far is ${avg}%.`),
    noTests: () => 'There are no test or quiz results yet.',
    hw: (c, titles, days) => `${c} homework ${c === 1 ? 'task is' : 'tasks are'} due in the next ${days} days: ${titles.join(', ')}${c > titles.length ? ' and more' : ''}.`,
    noHw: (days) => `No homework is due in the next ${days} days.`,
    good: { attendance: 'Good news: attendance was full this month.', improving: 'Good news: recent results are better than before.', homework: 'Good news: all homework so far has been handed in.' },
    support: {
      attendance: (p) => 'Worth a look: attendance may need support' + (p == null ? '' : ` (${p}% so far)`) + '. If coming to school is difficult, please talk to the teacher.',
      marks: () => 'Worth a look: overall marks may need support. A short talk with the teacher can help.',
      homework: () => 'Worth a look: handing in homework may need a little support.',
      tests: () => 'One test or quiz result is not in yet. Please ask the teacher.',
    },
    close: () => 'Your support means a lot to your child. If you have a question, send the teacher a message. Thank you.',
  },
};
const SUMMARY_LANGS = Object.keys(SUMMARY);
// returns the sentences (array) for one child. Order: hello, attendance, tests, homework, good news (if true), support line (if a line was crossed), closing.
function summary(f, lang) {
  const T = SUMMARY[lang];
  if (!T) throw new Error('Unknown summary language');
  const L = [T.hello(f.name)];
  L.push(f.attendance.month.pct == null ? T.attNoMonth() : T.attMonth(f.name, f.attendance.month.pct));
  if (f.attendance.overall.pct != null) L.push(T.attAll(f.attendance.overall.pct));
  L.push(f.tests.latest.length ? T.tests(f.tests.latest.map(T.testItem), f.tests.avgPct) : T.noTests());
  L.push(f.homework.dueCount ? T.hw(f.homework.dueCount, f.homework.due, f.homework.windowDays) : T.noHw(f.homework.windowDays));
  if (f.good) L.push(T.good[f.good]);
  if (f.support) L.push(T.support[f.support](f.attendance.overall.pct));
  L.push(T.close());
  return L;
}

module.exports = { summary, SUMMARY_LANGS, alert, homeworkAssigned, testAssigned, paperTest, quizAssigned, result, absentToday, notice, homeworkDue, parentMessage,
  leaveRequest, leaveDecision, meetingOpen, meetingBooked, meetingBookedTeacher, meetingCancelled, meetingCancelledTeacher, meetingReminder, meetingReminderTeacher, digest };
