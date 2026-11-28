// 학생 수업 화면(k/)이 같이 쓰는 것: 세션, /api/lesson 부르기, 언어, 글자 이스케이프.
import { loadSession, verifyStudentAuth, authReady, clearSession } from '/session.js';

export const LOGIN = '/index.html';
export let session = loadSession();
if (!session) { location.replace(LOGIN); throw new Error('no session'); }
verifyStudentAuth(session, { redirectTo: LOGIN }).then(s => { if (s) session = s; });

const LANG_KEY = 'ohinfo_lang';
export const getLang = dict => { try { const l = localStorage.getItem(LANG_KEY); return dict[l] ? l : 'ko'; } catch { return 'ko'; } };
export const setLang = l => { try { localStorage.setItem(LANG_KEY, l); } catch {} };

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const nameIn = (o, lang) => (lang !== 'ko' && o?.i18n?.[lang]) || o?.name || '';
export const stuNo = s => s.isMaster ? 'T' : `${s.grade || ''}${String(s.class || '').padStart(2, '0')}${String(s.number || '').padStart(2, '0')}`;

export async function api(action, extra = {}) {
  await authReady();
  const { auth } = await import('/firebase-config.js');
  if (!auth.currentUser) { clearSession(); location.replace(LOGIN); throw new Error('logout'); }
  const res = await fetch('/api/lesson', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, idToken: await auth.currentUser.getIdToken(), studentDocId: session.id, ...extra }) });
  const d = await res.json().catch(() => ({ error: 'HTTP ' + res.status }));
  if (d.relogin) { clearSession(); location.replace(LOGIN); throw new Error('relogin'); }
  return d;
}

export function logout() {
  clearSession();
  import('/firebase-config.js').then(({ auth }) => auth.signOut()).finally(() => location.replace(LOGIN));
}
