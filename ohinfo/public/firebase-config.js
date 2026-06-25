import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
