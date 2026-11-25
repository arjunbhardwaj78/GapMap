// Mocked-fetch tests for model discovery. No internet.
process.env.GEMINI_API_KEY = 'k'; process.env.GEMINI_MODEL = 'bad-name';
const g = require('./services/gemini');
let pass = 0, fail = 0; const t = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n); };
const calls = [];
global.fetch = async (url, o) => {
  calls.push(url);
  if (/\/models\?/.test(url)) return { ok: true, json: async () => ({ models: [
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3-flash-tts', supportedGenerationMethods: ['generateContent'] } ] }) };
  if (/gemini-3-flash:generate/.test(url)) return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }] }) };
  return { ok: false, status: 404 };
};
(async () => {
  const out = await g.generateJson([{ text: 'hi' }]);
  t('wrong/unknown names -> discovers a working model from the key', out.ok === 1 && calls.some((c) => /gemini-3-flash:generate/.test(c)));
  t('tts / embedding models are skipped, flash ranked first', !calls.some((c) => /tts:generate|embedding/.test(c)));
  calls.length = 0; await g.generateJson([{ text: 'hi' }]);
  t('next call goes straight to the working model', calls.length === 1 && /gemini-3-flash:generate/.test(calls[0]));
  g.resetModels();
  global.fetch = async () => ({ ok: false, status: 403 });
  let e; try { await g.generateJson([{ text: 'x' }]); } catch (x) { e = x; }
  t('bad key -> reason key', e && e.reason === 'key');

  // ---- quota: wait and retry; daily limit says so; nothing else of the reply is read ----
  process.env.GEMINI_MODEL = ''; g.resetModels(); g.setSleep(async () => {});
  let n = 0, slept = [];
  g.setSleep(async (ms) => { slept.push(ms); });
  const reply429 = (extra) => ({ ok: false, status: 429, headers: { get: () => null }, text: async () => JSON.stringify({ error: { message: 'SECRET STUDENT TEXT', details: extra } }) });
  global.fetch = async (url) => (/\/models\?/.test(url) ? { ok: false, status: 500 } : ++n <= 4 ? reply429([{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7s' }]) : { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":2}' }] } }] }) });
  const r2 = await g.generateJson([{ text: 'x' }]);
  t('per-minute limit: waits the time Google asks (7s) and then succeeds', r2.ok === 2 && slept.length === 1 && slept[0] === 7000, JSON.stringify(slept));
  slept.length = 0;
  global.fetch = async (url) => (/\/models\?/.test(url) ? { ok: false, status: 500 } : reply429([{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }]));
  let e2; try { await g.generateJson([{ text: 'x' }]); } catch (x) { e2 = x; }
  t('daily limit: no waiting, clear message', e2 && e2.reason === 'quota_day' && slept.length === 0 && /daily limit/.test(g.messageFor(e2.reason)));
  t('error message never contains text from the reply', e2 && !/SECRET/.test(e2.message));
  global.fetch = async (url) => (/\/models\?/.test(url) ? { ok: false, status: 500 } : reply429([]));
  let e3; try { await g.generateJson([{ text: 'x' }]); } catch (x) { e3 = x; }
  t('still limited after 2 waits: gives up with quota reason', e3 && e3.reason === 'quota' && slept.length === 2, JSON.stringify(slept));

  // ---- daily limit on the default models, but another model of the key still has quota ----
  g.resetModels(); slept.length = 0;
  const daily = () => ({ ok: false, status: 429, headers: { get: () => null }, text: async () => JSON.stringify({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }) });
  global.fetch = async (url) => /\/models\?/.test(url)
    ? { ok: true, json: async () => ({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) }
    : /flash-lite:generate/.test(url) ? { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":3}' }] } }] }) } : daily();
  const r4 = await g.generateJson([{ text: 'x' }]);
  t('daily limit on one model: falls through to another model the key has', r4.ok === 3 && slept.length === 0);
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
