// 견본용 /api/version — 견본은 새 버전 확인을 하지 않는다(항상 같은 값).
export async function handle() {
  return new Response(JSON.stringify({ v: 'demo' }), { headers: { 'content-type': 'application/json' } });
}
