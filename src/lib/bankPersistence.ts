import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { isLocalBackend } from './dataBackend';
import { banksApi } from '../services/local/modulesApi';

type FirestorePatchValue = unknown | ReturnType<typeof deleteField>;

const FIRESTORE_FIELD_DELETE = deleteField();

function isFirestoreDeleteField(value: unknown): boolean {
  return (
    value === FIRESTORE_FIELD_DELETE ||
    (typeof value === 'object' &&
      value !== null &&
      '_methodName' in value &&
      (value as { _methodName?: string })._methodName === 'deleteField')
  );
}

function newLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Strip Firestore-only fields before API writes. */
function toApiPayload(body: Record<string, FirestorePatchValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (isFirestoreDeleteField(value)) {
      out[key] = null;
      continue;
    }
    if (value instanceof Timestamp) continue;
    if (key === 'createdAt' || key === 'updatedAt' || key === 'postedAt' || key === 'cancelledAt') continue;
    out[key] = value;
  }
  return out;
}

export async function createBankAccount(payload: Record<string, FirestorePatchValue>): Promise<string> {
  if (isLocalBackend) {
    const id = newLocalId();
    await banksApi.accounts.create({ id, ...toApiPayload(payload) });
    return id;
  }
  const ref = await addDoc(collection(db, 'bank_accounts'), payload);
  return ref.id;
}

export async function updateBankAccount(id: string, payload: Record<string, FirestorePatchValue>): Promise<void> {
  if (isLocalBackend) {
    await banksApi.accounts.update(id, toApiPayload(payload));
    return;
  }
  await updateDoc(doc(db, 'bank_accounts', id), payload);
}

export async function removeBankAccount(id: string): Promise<void> {
  if (isLocalBackend) {
    await banksApi.accounts.remove(id);
    return;
  }
  await deleteDoc(doc(db, 'bank_accounts', id));
}

export async function createBankMovement(payload: Record<string, FirestorePatchValue>): Promise<string> {
  if (isLocalBackend) {
    const id = newLocalId();
    await banksApi.movements.create({ id, ...toApiPayload(payload) });
    return id;
  }
  const ref = await addDoc(collection(db, 'bank_movements'), payload);
  return ref.id;
}

export async function updateBankMovement(id: string, payload: Record<string, FirestorePatchValue>): Promise<void> {
  if (isLocalBackend) {
    await banksApi.movements.update(id, toApiPayload(payload));
    return;
  }
  await updateDoc(doc(db, 'bank_movements', id), payload);
}

export async function removeBankMovement(id: string): Promise<void> {
  if (isLocalBackend) {
    await banksApi.movements.remove(id);
    return;
  }
  await deleteDoc(doc(db, 'bank_movements', id));
}

export async function createBankCheque(payload: Record<string, FirestorePatchValue>): Promise<string> {
  if (isLocalBackend) {
    const id = newLocalId();
    await banksApi.cheques.create({ id, ...toApiPayload(payload) });
    return id;
  }
  const ref = await addDoc(collection(db, 'bank_cheques'), payload);
  return ref.id;
}

export async function updateBankCheque(id: string, payload: Record<string, FirestorePatchValue>): Promise<void> {
  if (isLocalBackend) {
    await banksApi.cheques.update(id, toApiPayload(payload));
    return;
  }
  await updateDoc(doc(db, 'bank_cheques', id), payload);
}

export async function removeBankCheque(id: string): Promise<void> {
  if (isLocalBackend) {
    await banksApi.cheques.remove(id);
    return;
  }
  await deleteDoc(doc(db, 'bank_cheques', id));
}

export async function createBankStatement(
  payload: Record<string, FirestorePatchValue>,
  lines: Array<Record<string, FirestorePatchValue>>,
): Promise<string> {
  if (isLocalBackend) {
    const id = newLocalId();
    await banksApi.statements.create({ id, ...toApiPayload(payload) });
    for (const line of lines) {
      const lineId = newLocalId();
      await banksApi.statementLines.create({
        id: lineId,
        statementId: id,
        ...toApiPayload(line),
      });
    }
    return id;
  }
  const stmtRef = await addDoc(collection(db, 'bank_statements'), payload);
  const batch = writeBatch(db);
  for (const line of lines) {
    const lineRef = doc(collection(db, 'bank_statement_lines'));
    batch.set(lineRef, { ...line, statementId: stmtRef.id });
  }
  await batch.commit();
  return stmtRef.id;
}

export async function updateBankStatementLine(
  id: string,
  payload: Record<string, FirestorePatchValue>,
): Promise<void> {
  if (isLocalBackend) {
    await banksApi.statementLines.update(id, toApiPayload(payload));
    return;
  }
  await updateDoc(doc(db, 'bank_statement_lines', id), payload);
}
