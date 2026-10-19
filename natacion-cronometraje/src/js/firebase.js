import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  initializeFirestore,
  onSnapshot,
  serverTimestamp as firebaseServerTimestamp,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyBE0xfJi1jIj0cQ69LEoyJeNZA0SKHun8Y',
  authDomain: 'cronometraje-745c0.firebaseapp.com',
  projectId: 'cronometraje-745c0',
  storageBucket: 'cronometraje-745c0.firebasestorage.app',
  messagingSenderId: '879075048831',
  appId: '1:879075048831:web:8f39e4520867f204352e4a',
  measurementId: 'G-DPCGEKVCD9'
};

export const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
const competitionRef = doc(db, 'competition', 'state');
const sessionsCollection = collection(db, 'sessions');
const sessionRef = (lane) => doc(db, 'sessions', String(lane));

const timestampToMillis = (value) => {
  if (typeof value === 'number') return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
};

const normalizeTimestamps = (data) => ({
  ...data,
  startedAt: timestampToMillis(data.startedAt),
  stoppedAt: timestampToMillis(data.stoppedAt),
  updatedAt: timestampToMillis(data.updatedAt),
  lastSeenAt: timestampToMillis(data.lastSeenAt)
});

export const serverTimestamp = () => firebaseServerTimestamp();
export const setCompetitionState = async (state) => {
  await setDoc(competitionRef, state, { merge: true });
};
export const subscribeToCompetition = (callback, onError = () => {}) => {
  return onSnapshot(competitionRef, { includeMetadataChanges: true }, (snapshot) => {
    callback(snapshot.exists() ? normalizeTimestamps(snapshot.data()) : { status: 'ready' });
  }, onError);
};
export const subscribeToServerOffset = (callback) => {
  callback(0);
  return () => {};
};
export const subscribeToConnection = (callback, onError = () => {}) => {
  return onSnapshot(competitionRef, { includeMetadataChanges: true }, (snapshot) => {
    callback(snapshot.metadata.fromCache ? null : true, '');
  }, (error) => {
    callback(false, error.message || 'No se pudo leer el estado del evento.');
    onError(error);
  });
};
export const setJudgeConnection = async (lane, connected) => {
  await setDoc(sessionRef(lane), {
    lane: String(lane),
    connected,
    ready: false,
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
};
export const heartbeatSession = async (lane) => {
  await setDoc(sessionRef(lane), {
    connected: true,
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
};
export const updateSession = async (lane, partial) => {
  await setDoc(sessionRef(lane), { ...partial, lane: String(lane) }, { merge: true });
};
export const subscribeToSession = (lane, callback, onError = () => {}) => {
  return onSnapshot(sessionRef(lane), { includeMetadataChanges: true }, (snapshot) => {
    callback(snapshot.exists() ? normalizeTimestamps(snapshot.data()) : null);
  }, onError);
};
export const subscribeToSessions = (callback, onError = () => {}) => {
  return onSnapshot(sessionsCollection, { includeMetadataChanges: true }, (snapshot) => {
    const sessions = snapshot.docs
      .map((session) => normalizeTimestamps(session.data()))
      .sort((a, b) => Number(a.lane) - Number(b.lane));
    callback(sessions);
  }, onError);
};
