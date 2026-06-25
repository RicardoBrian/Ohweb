exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const DEEPL_KEY = 'cf131ad1-2cd2-455b-8915-dd32ddfce706:fx';
  const { texts, targetLang, sourceLang = 'KO' } = JSON.parse(event.body || '{}');

  if (!texts || !targetLang) return { statusCode: 400, body: JSON.stringify({ error: 'missing params' }) };

  const body = new URLSearchParams({ auth_key: DEEPL_KEY, source_lang: sourceLang, target_lang: targetLang });
  texts.forEach(t => body.append('text', t));

  const res = await fetch('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  const data = await res.json();
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(data)
  };
};
