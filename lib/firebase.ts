import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore } from "firebase/firestore";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let _app: FirebaseApp | null = null;
let _db: Firestore | null = null;

export function getFirebase() {
  if (typeof window === "undefined") return { app: null, db: null };
  if (!_app) {
    if (!config.apiKey) {
      throw new Error(
        "Firebase env vars are missing. Copy .env.local.example to .env.local and fill it in."
      );
    }
    _app = getApps()[0] ?? initializeApp(config);
    _db = getFirestore(_app);
  }
  return { app: _app, db: _db! };
}
