export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { texts, targetLang, sourceLang = 'KO' } = req.body || {};
    if (!texts || !targetLang) return res.status(400).json({ error: 'missing params' });

    const results = await Promise.all(texts.map(async text => {
      if (!text || !text.trim()) return '';
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang.toLowerCase()}&tl=${targetLang.toLowerCase()}&dt=t&q=${encodeURIComponent(text)}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`translate HTTP ${r.status}`);
      const data = await r.json();
      return (data[0] || []).map(s => s[0] || '').join('');
    }));

    return res.status(200).json({ translations: results.map(text => ({ text })) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
