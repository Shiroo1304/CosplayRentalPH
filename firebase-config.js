// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyB17XH0Jo_Xq3EkFmbDSH6uaop2H7opdUQ",
  authDomain: "cosrent-24f13.firebaseapp.com",
  projectId: "cosrent-24f13",
  storageBucket: "cosrent-24f13.firebasestorage.app",
  messagingSenderId: "578444258648",
  appId: "1:578444258648:web:8903404056af9fcea2c92d",
  measurementId: "G-EY0H3KN6RX"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const analytics = getAnalytics(app);