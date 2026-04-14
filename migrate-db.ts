/**
 * Migration Script: Copy all data from old Firestore DB to new DB
 * Usage: npx tsx migrate-db.ts
 */
import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  initializeFirestore,
  getFirestore,
  collection,
  getDocs,
  addDoc,
  doc,
  setDoc,
  getDoc
} from 'firebase/firestore';

// Firebase config
const firebaseConfig = {
  projectId: "gen-lang-client-0599011721",
  appId: "1:828920577618:web:869ad370b485f73f35698b",
  apiKey: "AIzaSyAsoXi8n9H5huO9iokxCZd6N7OwKnYXmVw",
  authDomain: "gen-lang-client-0599011721.firebaseapp.com",
  storageBucket: "gen-lang-client-0599011721.firebasestorage.app",
  messagingSenderId: "828920577618",
};

const OLD_DB_ID = "ai-studio-ed995a7f-1301-474a-bea7-988b7ce5664c";
const NEW_DB_ID = "megypt15061978";

// All collections to migrate
const COLLECTIONS = [
  'users',
  'projects',
  'contracts',
  'boq_items',
  'actual_costs',
  'collections',
  'suppliers',
  'admin_expenses',
  'chart_of_accounts',
  'transactions',
  'billing',
  'ipc_progress',
  'settings',
  'cost_centers',
  'purchase_transactions',
];

async function migrateCollection(collectionName: string, oldDb: any, newDb: any) {
  console.log(`\n📦 Migrating: ${collectionName}`);

  try {
    const oldCollection = collection(oldDb, collectionName);
    const snapshot = await getDocs(oldCollection);

    if (snapshot.empty) {
      console.log(`   ⏭️  Empty collection, skipping`);
      return { copied: 0, skipped: 0 };
    }

    let copied = 0;
    let skipped = 0;

    for (const oldDoc of snapshot.docs) {
      const docId = oldDoc.id;
      const data = oldDoc.data();

      // Remove Firestore-generated fields that can't be written
      delete data.createdAt;
      delete data.updatedAt;

      try {
        const newDocRef = doc(newDb, collectionName, docId);
        await setDoc(newDocRef, data);
        copied++;
        console.log(`   ✅ ${docId}`);
      } catch (err) {
        skipped++;
        console.error(`   ❌ Failed to copy ${docId}:`, err);
      }
    }

    console.log(`   📊 ${collectionName}: ${copied} copied, ${skipped} skipped`);
    return { copied, skipped };
  } catch (err) {
    console.error(`   ❌ Error reading ${collectionName}:`, err);
    return { copied: 0, skipped: 0 };
  }
}

async function main() {
  console.log('🚀 Starting Firestore Migration...\n');
  console.log(`   Old DB: ${OLD_DB_ID}`);
  console.log(`   New DB: ${NEW_DB_ID}\n`);

  // Initialize Firebase
  let app;
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApp();
  }

  const oldDb = initializeFirestore(app, {}, OLD_DB_ID);
  const newDb = initializeFirestore(app, {}, NEW_DB_ID);

  let totalCopied = 0;
  let totalSkipped = 0;

  for (const coll of COLLECTIONS) {
    const result = await migrateCollection(coll, oldDb, newDb);
    totalCopied += result.copied;
    totalSkipped += result.skipped;
  }

  console.log('\n' + '='.repeat(50));
  console.log(`✅ Migration Complete!`);
  console.log(`   Total copied: ${totalCopied}`);
  console.log(`   Total skipped: ${totalSkipped}`);
  console.log('='.repeat(50));
}

main().catch(err => {
  console.error('\n❌ Migration failed:', err);
  process.exit(1);
});
