import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  collection,
  connectFirestoreEmulator,
  deleteField,
  doc,
  getDocs,
  initializeFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp as firebaseServerTimestamp,
  setDoc,
  writeBatch
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
export const auth = getAuth(app);
export const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

const currentUserId = () => {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('Inicia sesión para acceder a los datos de la carrera.');
  return userId;
};

const userRoot = () => ['users', currentUserId()];
const competitionRef = () => doc(db, ...userRoot(), 'competition', 'state');
const sessionsCollection = () => collection(db, ...userRoot(), 'sessions');
const sessionRef = (lane) => doc(db, ...userRoot(), 'sessions', String(lane));
const racesCollection = () => collection(db, ...userRoot(), 'races');

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
export const setAuthPersistence = (rememberMe) => setPersistence(
  auth,
  rememberMe ? browserLocalPersistence : browserSessionPersistence
);
export const registerAccount = async (email, password, profile) => {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const user = credential.user;
  try {
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      organizationName: profile.organizationName,
      poolName: profile.poolName,
      contactName: profile.contactName,
      email: user.email,
      phone: profile.phone,
      city: profile.city,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    try {
      await deleteUser(user);
    } catch (rollbackError) {
      console.error('No se pudo revertir la cuenta incompleta de Firebase:', rollbackError);
    }
    throw error;
  }
  return user;
};
export const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
export { onAuthStateChanged, signOut };

export const setCompetitionState = async (state) => {
  const stateToWrite = { ...state, lastSeenAt: deleteField() };
  if (!Object.prototype.hasOwnProperty.call(state, 'startedAt')) delete stateToWrite.startedAt;
  await setDoc(competitionRef(), stateToWrite, { merge: true });
};
export const subscribeToCompetition = (callback, onError = () => {}) => {
  return onSnapshot(competitionRef(), { includeMetadataChanges: true }, (snapshot) => {
    callback(
      snapshot.exists() ? normalizeTimestamps(snapshot.data()) : { status: 'ready' },
      snapshot.metadata
    );
  }, onError);
};
export const subscribeToServerOffset = (callback) => {
  callback(0);
  return () => {};
};
export const subscribeToConnection = (callback, onError = () => {}) => {
  return onSnapshot(competitionRef(), { includeMetadataChanges: true }, (snapshot) => {
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
  return onSnapshot(sessionsCollection(), { includeMetadataChanges: true }, (snapshot) => {
    const sessions = snapshot.docs
      .map((session) => normalizeTimestamps(session.data()))
      .sort((a, b) => Number(a.lane) - Number(b.lane));
    callback(sessions);
  }, onError);
};

export const saveRace = async (race, laneSessions) => {
  const userId = currentUserId();
  const batch = writeBatch(db);
  const raceRef = doc(racesCollection());
  batch.set(raceRef, {
    status: race.status,
    createdAt: serverTimestamp(),
    durationMs: race.durationMs,
    durationMode: race.durationMode,
    distancePerLap: race.distancePerLap,
    elapsedMs: race.elapsedMs,
    expectedLanes: race.expectedLanes
  });
  for (const session of laneSessions) {
    batch.set(doc(db, 'users', userId, 'races', raceRef.id, 'lanes', String(session.lane)), {
      lane: String(session.lane),
      team: session.team || '',
      judge: session.judge || '',
      totalDistance: Number(session.totalDistance) || 0,
      elapsedMs: Number(session.elapsedMs) || 0,
      laps: Array.isArray(session.laps) ? session.laps : [],
      checkpoints: Array.isArray(session.checkpoints) ? session.checkpoints : [],
      phase: session.phase === 'running' ? 'running' : 'finished'
    });
  }
  await batch.commit();
  return raceRef.id;
};

export const listRaces = async (sortDirection = 'asc') => {
  const direction = sortDirection === 'desc' ? 'desc' : 'asc';
  const raceQuery = query(racesCollection(), orderBy('createdAt', direction));
  const snapshot = await getDocs(raceQuery);
  return snapshot.docs.map((race) => ({ id: race.id, ...race.data() }));
};

export const getRaceLanes = async (raceId) => {
  const lanes = collection(db, ...userRoot(), 'races', raceId, 'lanes');
  const snapshot = await getDocs(query(lanes, orderBy('lane')));
  return snapshot.docs.map((lane) => lane.data());
};
