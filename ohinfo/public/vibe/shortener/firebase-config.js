// 견본 단축 URL용 설정 — 가짜 Firebase(이 브라우저 저장) + 견본 링크.
import { initializeApp } from '/vibe/shared/fake-firebase/firebase-app.js';
import { getFirestore } from '/vibe/shared/fake-firebase/firebase-firestore.js';
import { getAuth } from '/vibe/shared/fake-firebase/firebase-auth.js';

const NS = 'vibe-shortener';
const F = globalThis.FakeFB;
const ts = (days) => F.Timestamp.fromMillis(Date.now() - days * 86400000);
F.seed(NS, (put) => {
  put('short_links/vibe', { url: 'https://kakainfo.com/vibe/', createdAt: ts(1) });
  put('short_links/prompt', { url: 'https://kakainfo.com/프롬프트', createdAt: ts(3) });
  put('short_links/survey1', { url: 'https://example.com/forms/2학기-체육대회-종목-투표', createdAt: ts(6) });
  put('short_links/notice', { url: 'https://example.com/school/notice/2026-11-가정통신문', createdAt: ts(9) });
});

const app = initializeApp({ projectId: NS });
export const db = getFirestore(app);
export const auth = getAuth(app);
