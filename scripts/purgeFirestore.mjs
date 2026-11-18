import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId:
    process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error(
    'Missing Firebase configuration. Set VITE_FIREBASE_API_KEY and VITE_FIREBASE_PROJECT_ID in your environment before running this script.'
  );
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const collections = [
  'teams',
  'issues',
  'auditLogs',
  'participants',
  'repositories',
  'pullRequests',
  'scoreEvents',
  'reviews',
  'webhookEvents',
  'bonusAwards',
  'challengeMappings',
];

async function purgeAll() {
  console.log('Initiating purge of collections...');
  for (const colName of collections) {
    try {
      const snap = await getDocs(collection(db, colName));
      console.log(`Found ${snap.size} documents in "${colName}". Deleting...`);
      for (const d of snap.docs) {
        await deleteDoc(d.ref);
      }
      console.log(`Cleared "${colName}".`);
    } catch (e) {
      console.error(`Error clearing "${colName}":`, e.message);
    }
  }
  console.log('Purge complete!');
  process.exit(0);
}

purgeAll();
