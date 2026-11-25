// TinyFish learning resources. PRIVACY: only a maths topic is sent. Never student names, IDs, answers or sheets.
// If no key is set or the call fails, we return an empty list and say so. No made-up fallback links.
async function searchResources(topic) {
  const key = (process.env.TINYFISH_API_KEY || '').trim();
  if (!key) return { live: false, message: 'TINYFISH_API_KEY is not set, so no online resources are shown.', resources: [] };
  const url = new URL('https://api.search.tinyfish.ai');
  url.searchParams.set('query', `Class 6-8 maths remedial exercises ${topic}`);
  url.searchParams.set('language', 'en');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { 'X-API-Key': key, Accept: 'application/json' }, signal: ctl.signal });
    if (!res.ok) throw new Error('status ' + res.status);
    const data = await res.json();
    const items = Array.isArray(data) ? data : data.results || data.items || [];
    const resources = items.slice(0, 5).map((i) => ({
      title: i.title || i.name || 'Resource', url: i.url || i.link || '',
      summary: i.description || i.snippet || i.summary || '',
    })).filter((r) => /^https?:\/\//.test(r.url));
    return { live: true, message: '', resources };
  } catch (e) {
    return { live: false, message: 'Online resources could not be loaded right now.', resources: [] };
  } finally { clearTimeout(timer); }
}
module.exports = { searchResources };
