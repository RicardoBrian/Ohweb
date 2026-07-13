import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCCMbYG6GbKnVho7SWEu0-4TkMdnS7-VAM",
  authDomain: "ohsettle-10d43.firebaseapp.com",
  projectId: "ohsettle-10d43",
  storageBucket: "ohsettle-10d43.firebasestorage.app",
  messagingSenderId: "756532072898",
  appId: "1:756532072898:web:4931ae1d705bfd157a865b"
};

const app = initializeApp(firebaseConfig, 'ohsettle');
export const settleDb = getFirestore(app);
