import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ohweb-93062 프로젝트 그대로 재사용 — 나머지 4개 앱(ohweb/ohinfo/ohsettle*)과
// 동일한 Firebase 프로젝트. 이 앱만을 위한 별도 프로젝트를 새로 만들지 않는다.
const firebaseConfig = {
  apiKey: "AIzaSyB1SuaWwJgUY6SrCnmN8dmhG2cnVnGcl2s",
  authDomain: "ohweb-93062.firebaseapp.com",
  projectId: "ohweb-93062",
  storageBucket: "ohweb-93062.firebasestorage.app",
  messagingSenderId: "1027347539839",
  appId: "1:1027347539839:web:b3b8e8a02986a6e4cb1c4a"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
