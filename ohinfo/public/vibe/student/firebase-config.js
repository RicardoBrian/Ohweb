// 견본 학생 사이트용 설정 — 관리자 화면과 같은 저장 공간을 쓰고, 로그인만 따로 한다.
import { initializeApp } from '/vibe/shared/fake-firebase/firebase-app.js';
import { getFirestore } from '/vibe/shared/fake-firebase/firebase-firestore.js';
import { getAuth } from '/vibe/shared/fake-firebase/firebase-auth.js';
import { NS, seedSchool, ensureStudentLogin } from '/vibe/shared/seed-school.js';

seedSchool();
ensureStudentLogin();
globalThis.FakeFB.autoLogin = false; // 학생은 로그인 화면에서 들어온 계정만
const app = initializeApp({ projectId: NS, authDomain: 'student' });
export const db = getFirestore(app);
export const auth = getAuth(app);
