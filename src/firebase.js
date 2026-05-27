import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCG_rac4NjkyUWqeB6ENJaGPEAqeLPICT0",
  authDomain: "scrabble-1a871.firebaseapp.com",
  projectId: "scrabble-1a871",
  storageBucket: "scrabble-1a871.firebasestorage.app",
  messagingSenderId: "797202634390",
  appId: "1:797202634390:web:e0e1b6b8b6a8a78d7bd4b7",
  measurementId: "G-0NMXWCYWMV"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);