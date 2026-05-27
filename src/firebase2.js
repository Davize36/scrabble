import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig2 = {
  apiKey: "AIzaSyDiKbEg5Z_rP5ijP4NR4hDOyb0ExIvYBdQ",
  authDomain: "scrabble-backup.firebaseapp.com",
  projectId: "scrabble-backup",
  storageBucket: "scrabble-backup.firebasestorage.app",
  messagingSenderId: "767550824434",
  appId: "1:767550824434:web:7714c4a522745482fd956b",
  measurementId: "G-K44K38PX7Z"
};

const backupApp = initializeApp(firebaseConfig2, 'backup-app');
export const db2 = getFirestore(backupApp);