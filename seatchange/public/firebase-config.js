import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, connectAuthEmulator, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDjWtMpUcvwnA20E_2sJt_eBCNIn4eeCM4",
  authDomain: "seatchange-43950.firebaseapp.com",
  projectId: "seatchange-43950",
  storageBucket: "seatchange-43950.firebasestorage.app",
  messagingSenderId: "957188298111",
  appId: "1:957188298111:web:66ea099e0fcc5be400364a"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// 로컬에서 `firebase emulators:exec`로 띄워 개발할 때만 에뮬레이터로 붙는다.
// 배포된 도메인은 절대 이 hostname이 아니므로 운영 환경에는 영향이 없다.
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
}

/**
 * 로그인 화면이 없는 앱이라 익명 인증으로 브라우저마다 uid를 하나 받는다.
 * 사용자는 이걸 의식하지 않지만, firestore.rules는 이 uid로
 * "누가 이 좌석표를 만들었는지"를 판별한다.
 *
 * onAuthStateChanged가 최초 1회 uid를 물어다 줄 때까지 기다렸다가
 * 그 이후 로직(Firestore 읽기/쓰기)을 진행해야 한다 — 그 전에 쓰면
 * request.auth가 아직 없어서 규칙이 거부한다.
 */
export function whenSignedIn() {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, user => {
      if (user) { unsub(); resolve(user); }
    }, reject);
    signInAnonymously(auth).catch(reject);
  });
}
