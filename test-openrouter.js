// OpenRouter backup AI: fetch is mocked, no network. Run: node test-openrouter.js
const g = require('./services/gemini');
let pass = 0, fail = 0;
const t = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); c ? pass++ : fail++; };
const realFetch = global.fetch;
const reply = (status, body) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const gem = (obj) => reply(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });
const orOk = (obj) => reply(200, { choices: [{ message: { content: '```json\n' + JSON.stringify(obj) + '\n```' } }] });
let calls;
const setup = (fn) => { calls = []; global.fetch = async (url, o) => { calls.push({ url: String(url), o }); return fn(String(url), o); }; };
g.setSleep(async () => {});
const parts = [{ text: 'hi' }, { inline_data: { mime_type: 'image/jpeg', data: 'QUJD' } }];
(async () => {
  process.env.GEMINI_API_KEY = 'g'; delete process.env.OPENROUTER_API_KEY;
  setup((u) => (u.includes('openrouter') ? orOk({ x: 1 }) : gem({ ok: 1 })));
  t('Gemini works: used, OpenRouter not called', JSON.stringify(await g.generateJson(parts)) === '{"ok":1}' && !calls.some((c) => c.url.includes('openrouter')));

  process.env.OPENROUTER_API_KEY = 'or-key';
  setup((u) => (u.includes('openrouter') ? orOk({ x: 1 }) : gem({ ok: 1 })));
  t('both keys, Gemini ok: still Gemini', JSON.stringify(await g.generateJson(parts)) === '{"ok":1}' && !calls.some((c) => c.url.includes('openrouter')));

  g.resetModels();
  setup((u) => (u.includes('openrouter') ? orOk({ x: 1 }) : reply(429, { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'PerDay' }] }] } })));
  const r = await g.generateJson(parts);
  t('Gemini daily quota gone: OpenRouter answers (fenced JSON parsed)', JSON.stringify(r) === '{"x":1}');
  const orCall = calls.find((c) => c.url.includes('openrouter'));
  const body = JSON.parse(orCall.o.body);
  t('sends the key as Bearer and the default model', orCall.o.headers.Authorization === 'Bearer or-key' && body.model === 'google/gemini-2.5-flash');
  t('sends the image as a data URL', body.messages[0].content.some((c) => c.type === 'image_url' && c.image_url.url === 'data:image/jpeg;base64,QUJD'));
  t('OPENROUTER_MODEL overrides the model', (() => { process.env.OPENROUTER_MODEL = 'a/b, c/d'; const m = g.orModels(); delete process.env.OPENROUTER_MODEL; return m.join() === 'a/b,c/d'; })());

  g.resetModels();
  setup((u) => (u.includes('openrouter') ? reply(401, {}) : reply(503, {})));
  let e = null; try { await g.generateJson(parts); } catch (x) { e = x; }
  t('both fail: the Gemini reason is shown, not the backup one', e && e.reason === 'busy');

  g.resetModels();
  setup((u) => (u.includes('openrouter') ? reply(200, { choices: [{ message: { content: 'not json' } }] }) : reply(503, {})));
  e = null; try { await g.generateJson(parts); } catch (x) { e = x; }
  t('backup returns junk: error, no crash', e && e.reason === 'busy');

  g.resetModels();
  setup(() => gem({ ok: 1 }));
  setup((u) => (u.includes('openrouter') ? orOk({ x: 1 }) : reply(503, {})));
  e = null; try { await g.generateJson([{ text: 'a' }, { inline_data: { mime_type: 'audio/wav', data: 'QQ' } }]); } catch (x) { e = x; }
  t('audio cannot go to the backup: original error, no OpenRouter call', e && e.reason === 'busy' && !calls.some((c) => c.url.includes('openrouter')));

  delete process.env.GEMINI_API_KEY;
  setup((u) => orOk({ only: 1 }));
  t('only an OpenRouter key: configured() is true and it is used', g.configured() && JSON.stringify(await g.generateJson(parts)) === '{"only":1}');
  delete process.env.OPENROUTER_API_KEY;
  e = null; try { await g.generateJson(parts); } catch (x) { e = x; }
  t('no keys at all: no_key and configured() false', e && e.reason === 'no_key' && !g.configured());

  global.fetch = realFetch;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
