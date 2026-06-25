exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    const { texts, targetLang, sourceLang = 'KO' } = JSON.parse(event.body || '{}');
    if (!texts || !targetLang) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'missing params' }) };

    // Google Translate 비공식 API (무료, 키 불필요)
    const results = await Promise.all(texts.map(async text => {
      if (!text || !text.trim()) return '';
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang.toLowerCase()}&tl=${targetLang.toLowerCase()}&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`translate HTTP ${res.status}`);
      const data = await res.json();
      return (data[0] || []).map(s => s[0] || '').join('');
    }));

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ translations: results.map(text => ({ text })) })
    };
  } catch (e) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
