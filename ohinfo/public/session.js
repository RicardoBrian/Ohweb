// 학생 로그인 세션 — localStorage 기반, 5일 유지 (활동 시마다 연장)
const KEY = 'ohinfo_student';
const TTL_MS = 5 * 24 * 60 * 60 * 1000; // 5일

export function saveSession(data) {
  const withExp = { ...data, _exp: Date.now() + TTL_MS };
  localStorage.setItem(KEY, JSON.stringify(withExp));
}

export function loadSession() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { localStorage.removeItem(KEY); return null; }
  if (!parsed._exp || Date.now() > parsed._exp) { localStorage.removeItem(KEY); return null; }
  return parsed;
}

export function clearSession() {
  localStorage.removeItem(KEY);
}
