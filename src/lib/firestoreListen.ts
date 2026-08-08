/**
 * firestoreListen — safe wrapper around Firestore `onSnapshot`.
 *
 * When `VITE_DATA_BACKEND=local`, the app uses SQLite as its primary store.
 * Opening persistent WebSocket watch-streams to Firestore in that mode triggers
 * a known SDK internal-assertion bug (FIRESTORE INTERNAL ASSERTION FAILED).
 *
 * This module replaces `onSnapshot` with a one-time `getDocs` call in local mode,
 * returning an unsubscribe function that matches the onSnapshot API so call-sites
 * need no further changes.
 */

import {
  type Query,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type QuerySnapshot,
  type Unsubscribe,
  type FirestoreError,
  onSnapshot,
  getDocs,
  getDoc,
} from 'firebase/firestore';
import { isLocalBackend } from './dataBackend';

type QueryObserver<T extends DocumentData> = {
  next?: (snap: QuerySnapshot<T>) => void;
  error?: (err: FirestoreError) => void;
};

type DocObserver<T extends DocumentData> = {
  next?: (snap: DocumentSnapshot<T>) => void;
  error?: (err: FirestoreError) => void;
};

// ─── Collection / query ──────────────────────────────────────────────────────

export function listenQuery<T extends DocumentData>(
  q: Query<T>,
  onNext: (snap: QuerySnapshot<T>) => void,
  onError?: (err: FirestoreError) => void,
): Unsubscribe;

export function listenQuery<T extends DocumentData>(
  q: Query<T>,
  observer: QueryObserver<T>,
): Unsubscribe;

export function listenQuery<T extends DocumentData>(
  q: Query<T>,
  onNextOrObserver: ((snap: QuerySnapshot<T>) => void) | QueryObserver<T>,
  onError?: (err: FirestoreError) => void,
): Unsubscribe {
  const next = typeof onNextOrObserver === 'function' ? onNextOrObserver : onNextOrObserver.next;
  const err  = typeof onNextOrObserver === 'function' ? onError           : onNextOrObserver.error;

  if (!isLocalBackend) {
    if (typeof onNextOrObserver === 'function') {
      return onSnapshot(q, onNextOrObserver, err);
    }
    return onSnapshot(q, onNextOrObserver);
  }

  // Local mode: one-time fetch, no WebSocket
  let cancelled = false;
  getDocs(q)
    .then((snap) => { if (!cancelled && next) next(snap as QuerySnapshot<T>); })
    .catch((e) => { if (!cancelled && err) err(e as FirestoreError); });
  return () => { cancelled = true; };
}

// ─── Single document ─────────────────────────────────────────────────────────

export function listenDoc<T extends DocumentData>(
  ref: DocumentReference<T>,
  onNext: (snap: DocumentSnapshot<T>) => void,
  onError?: (err: FirestoreError) => void,
): Unsubscribe;

export function listenDoc<T extends DocumentData>(
  ref: DocumentReference<T>,
  observer: DocObserver<T>,
): Unsubscribe;

export function listenDoc<T extends DocumentData>(
  ref: DocumentReference<T>,
  onNextOrObserver: ((snap: DocumentSnapshot<T>) => void) | DocObserver<T>,
  onError?: (err: FirestoreError) => void,
): Unsubscribe {
  const next = typeof onNextOrObserver === 'function' ? onNextOrObserver : onNextOrObserver.next;
  const err  = typeof onNextOrObserver === 'function' ? onError           : onNextOrObserver.error;

  if (!isLocalBackend) {
    if (typeof onNextOrObserver === 'function') {
      return onSnapshot(ref as DocumentReference<DocumentData>, onNextOrObserver as (snap: DocumentSnapshot<DocumentData>) => void, err);
    }
    return onSnapshot(ref as DocumentReference<DocumentData>, onNextOrObserver as DocObserver<DocumentData>);
  }

  // Local mode: one-time fetch
  let cancelled = false;
  getDoc(ref)
    .then((snap) => { if (!cancelled && next) next(snap as DocumentSnapshot<T>); })
    .catch((e) => { if (!cancelled && err) err(e as FirestoreError); });
  return () => { cancelled = true; };
}
