/*
 * Browser-authenticated Firestore exports should usually be produced from the
 * Firebase console or Admin SDK service account. This file documents the JSON
 * shape expected by importFirestoreJson.ts:
 *
 * migration-data/
 *   projects.json
 *   contracts.json
 *   chart_of_accounts.json
 *   suppliers.json
 *   transactions.json
 *   billing.json
 *   boq_items.json
 *   purchase_transactions.json
 *
 * Each array item must include its Firestore document id as `id`.
 */

console.log('Use Firebase export/Admin SDK to create JSON files in migration-data/.');
