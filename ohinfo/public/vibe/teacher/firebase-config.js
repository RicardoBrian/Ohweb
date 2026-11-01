// 견본 관리자 화면용 설정 — 실제 Firebase 대신 가짜 Firebase(이 브라우저 저장)를 쓴다.
import { initializeApp } from '/vibe/shared/fake-firebase/firebase-app.js';
import { getFirestore } from '/vibe/shared/fake-firebase/firebase-firestore.js';
import { getStorage } from '/vibe/shared/fake-firebase/firebase-storage.js';
import { getAuth } from '/vibe/shared/fake-firebase/firebase-auth.js';
import { NS, seedSchool } from '/vibe/shared/seed-school.js';

seedSchool();
const app = initializeApp({ projectId: NS, authDomain: 'teacher' });
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
