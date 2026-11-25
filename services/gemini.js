// Gemini helper. Key comes from .env; model is optional (a default list is tried). Never called from the browser.
// Errors carry a `reason` so the app can tell the user WHY the AI is unavailable (no key, bad key, quota, model, network).
const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash'];

const hasGemini = () => Boolean((process.env.GEMINI_API_KEY || '').trim());
const hasOpenRouter = () => Boolean((process.env.OPENROUTER_API_KEY || '').trim());
const hasKey = () => hasGemini() || hasOpenRouter(); // either key turns the AI on
// Only the key is required now. GEMINI_MODEL (if set) is tried first; otherwise the defaults.
const configured = hasKey;
const models = () => {
  const own = (process.env.GEMINI_MODEL || '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...own, ...DEFAULT_MODELS.filter((m) => !own.includes(m))];
};

class AiError extends Error {
  constructor(reason, message, status) { super(message); this.reason = reason; this.aiStatus = status; }
}
let sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setSleep = (f) => { sleep = f; }; // tests replace this so they do not really wait

// From a 429 reply read ONLY how long to wait and whether the DAILY limit is used up. Nothing else is read or logged.
async function quotaInfo(res) {
  let waitMs = null, daily = false;
  try {
    const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
    if (ra > 0) waitMs = ra * 1000;
    const body = JSON.parse(await res.text());
    for (const d of (body && body.error && body.error.details) || []) {
      if (/RetryInfo/.test(d['@type'] || '') && /^[\d.]+s$/.test(String(d.retryDelay || ''))) waitMs = parseFloat(d.retryDelay) * 1000;
      if (/QuotaFailure/.test(d['@type'] || '')) for (const x of d.violations || []) if (/PerDay/i.test(String(x.quotaId || ''))) daily = true;
    }
  } catch (e) { /* keep defaults */ }
  return { waitMs, daily };
}

function parseJson(text) {
  const clean = String(text || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(clean);
}

const reasonFor = (status) => (status === 400 || status === 401 || status === 403 ? 'key' : status === 404 ? 'model' : status === 429 ? 'quota' : status >= 500 ? 'busy' : 'error');
const MESSAGES = {
  no_key: 'The AI key is missing. Add GEMINI_API_KEY to the .env file and restart the server.',
  key: 'Google rejected the AI key. Check GEMINI_API_KEY in .env (it may be wrong, expired or blocked).',
  model: 'The AI model name was not found. Remove GEMINI_MODEL from .env or set a model your key can use.',
  quota: 'The AI is over its free limit right now, even after waiting. Wait a minute and try again, or type the answers instead.',
  quota_day: 'The free daily limit for this AI key is used up. It resets tomorrow. Meanwhile you can type the answers instead, or use another key or turn on billing in Google AI Studio.',
  busy: 'The AI service is busy. Try again in a moment.',
  network: 'The server could not reach the AI service. Check the internet connection.',
  bad_output: 'The AI answered in a format the app could not read. Try again.',
  error: 'The AI returned an error. Try again.',
};
const messageFor = (reason) => MESSAGES[reason] || MESSAGES.error;

// Ask Google which models THIS key can use, keep ones that can generateContent, best-suited first.
let discovered = null;
const SKIP = /embed|tts|image|live|native-audio|robotics|computer-use|learnlm|gemma|aqa|imagen|veo/i;
const rank = (n) => (/flash/.test(n) && !/lite/.test(n) ? 0 : /flash-lite|lite/.test(n) ? 1 : /pro/.test(n) ? 2 : 3) * 10 + (/preview|exp/.test(n) ? 5 : 0) + (/latest/.test(n) ? -1 : 0);
async function discoverModels() {
  if (discovered) return discovered;
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY.trim() } });
    if (!res.ok) return [];
    const data = await res.json();
    discovered = (data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, '')).filter((n) => /^gemini/i.test(n) && !SKIP.test(n)).sort((a, b) => rank(a) - rank(b));
  } catch (e) { discovered = []; }
  return discovered;
}
const resetModels = () => { discovered = null; };

async function callModel(m, parts, temperature) {
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY.trim() },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature, responseMimeType: 'application/json' } }),
    });
  } catch (e) { throw new AiError('network', MESSAGES.network); }
  if (res.ok) {
    const data = await res.json();
    try { return { out: parseJson(data.candidates?.[0]?.content?.parts?.[0]?.text) }; } catch (e) { return { err: new AiError('bad_output', MESSAGES.bad_output) }; }
  }
  // body not logged: it may echo student content
  if (res.status === 429) {
    const q = await quotaInfo(res);
    const e = new AiError(q.daily ? 'quota_day' : 'quota', messageFor(q.daily ? 'quota_day' : 'quota'), 429);
    e.waitMs = q.waitMs; e.daily = q.daily;
    return { err: e };
  }
  return { err: new AiError(reasonFor(res.status), messageFor(reasonFor(res.status)), res.status) };
}

// parts: [{ text }, { inline_data: { mime_type, data } }]
let working = null; // the model that last worked: tried first next time
const MAX_WAITS = 2, MAX_WAIT_MS = 30000;
async function geminiJson(parts, temperature = 0.1) {
  if (!hasGemini()) throw new AiError('no_key', MESSAGES.no_key);
  let last = null;
  // One pass over the models. A 429 on one model moves on to the next (each model has its own limit).
  const pass = async (list, tried) => {
    for (const m of list) {
      if (tried.has(m)) continue;
      tried.add(m);
      const r = await callModel(m, parts, temperature);
      if (r.out !== undefined) { working = m; return r.out; }
      last = r.err;
      if (![404, 429].includes(r.err.aiStatus) && !(r.err.aiStatus >= 500) && r.err.reason !== 'bad_output') throw r.err; // key problem: other models fail too
    }
    return undefined;
  };
  let tried = new Set();
  let out = await pass([...(working ? [working] : []), ...models()], tried);
  // names were wrong, or the DAILY limit of those models is gone (each model has its own limit): use what the key really has
  if (out === undefined && (!last || last.reason === 'model' || last.reason === 'quota_day')) out = await pass((await discoverModels()).slice(0, 6), tried);
  // Over the per-minute limit on every model: wait the time Google asks for, then try again (not when the DAILY limit is gone).
  for (let w = 0; out === undefined && last && last.reason === 'quota' && w < MAX_WAITS; w++) {
    await sleep(Math.min(Math.max(last.waitMs || 8000, 2000), MAX_WAIT_MS));
    tried = new Set();
    out = await pass([...(working ? [working] : []), ...models()], tried);
  }
  if (out !== undefined) return out;
  if (last && last.reason === 'model') throw new AiError('model', `No Gemini model that can read your request was found for this key (tried ${[...tried].join(', ')}). Check that the key is a Gemini API key from Google AI Studio.`, 404);
  throw last || new AiError('error', MESSAGES.error);
}

// ---------- OpenRouter: used when Gemini fails (quota, busy, network...) or when only OPENROUTER_API_KEY is set ----------
const OR_DEFAULT_MODELS = ['google/gemini-2.5-flash'];
const orModels = () => {
  const own = (process.env.OPENROUTER_MODEL || '').split(',').map((x) => x.trim()).filter(Boolean);
  return own.length ? own : OR_DEFAULT_MODELS;
};
// Gemini-style parts -> OpenRouter chat content. Returns null when a part cannot be sent (e.g. audio): then there is no fallback.
function toOpenRouterContent(parts) {
  const out = [];
  for (const p of parts) {
    if (p.text !== undefined) { out.push({ type: 'text', text: p.text }); continue; }
    const d = p.inline_data;
    if (!d) return null;
    const url = `data:${d.mime_type};base64,${d.data}`;
    if (/^image\//.test(d.mime_type)) out.push({ type: 'image_url', image_url: { url } });
    else if (d.mime_type === 'application/pdf') out.push({ type: 'file', file: { filename: 'sheet.pdf', file_data: url } });
    else return null;
  }
  return out;
}
async function openRouterJson(parts, temperature) {
  const content = toOpenRouterContent(parts);
  if (!content) throw new AiError('error', 'This kind of file cannot be sent to the backup AI.');
  let last = null;
  for (const m of orModels()) {
    let res;
    try {
      res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY.trim() },
        body: JSON.stringify({ model: m, messages: [{ role: 'user', content }], temperature, response_format: { type: 'json_object' } }),
      });
    } catch (e) { last = new AiError('network', MESSAGES.network); continue; }
    if (!res.ok) { last = new AiError(reasonFor(res.status), messageFor(reasonFor(res.status)), res.status); continue; } // body not logged
    try { const data = await res.json(); return parseJson(data.choices?.[0]?.message?.content); } catch (e) { last = new AiError('bad_output', MESSAGES.bad_output); }
  }
  throw last || new AiError('error', MESSAGES.error);
}

// The one function the rest of the app calls. Gemini first; OpenRouter as the backup (or the only AI if no Gemini key).
async function generateJson(parts, temperature = 0.1) {
  if (!hasKey()) throw new AiError('no_key', MESSAGES.no_key);
  if (!hasGemini()) return openRouterJson(parts, temperature);
  try { return await geminiJson(parts, temperature); } catch (gemErr) {
    if (!hasOpenRouter() || gemErr.reason === 'no_key') throw gemErr;
    try { return await openRouterJson(parts, temperature); } catch (orErr) { throw gemErr; } // show the main AI's reason, not the backup's
  }
}

module.exports = { hasOpenRouter, orModels, configured, generateJson, AiError, messageFor, models, discoverModels, resetModels, setSleep };
