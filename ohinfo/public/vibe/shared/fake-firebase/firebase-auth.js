// 견본용 가짜 firebase-auth (모듈 방식). 어떤 로그인 방법을 눌러도 "견본 선생님"으로 들어간다.
import './core.js';
import { getApp } from './firebase-app.js';

const F = globalThis.FakeFB;

export function getAuth(app) { return F.getAuthFor((app || getApp()).__authNs); }
export const initializeAuth = (app) => getAuth(app);
export function connectAuthEmulator() {}

export const onAuthStateChanged = (auth, cb) => auth.onAuthStateChanged(cb);
export const onIdTokenChanged = (auth, cb) => auth.onAuthStateChanged(cb);
export const signInWithPopup = (auth) => auth.signIn();
export const signInWithRedirect = (auth) => auth.signIn();
export async function getRedirectResult() { return null; }
export const signInAnonymously = (auth) => auth.signIn({ ...F.DEMO_USER, isAnonymous: true });
// 이메일 로그인은 비밀번호를 확인하지 않고, 입력한 이메일의 계정으로 들어간다.
const emailUser = (email) => {
  const id = String(email || '').split('@')[0];
  return { ...F.DEMO_USER, uid: 'demo-' + id, email: String(email || '').toLowerCase(), displayName: id, providerData: [] };
};
export const signInWithEmailAndPassword = (auth, email) => auth.signIn(emailUser(email));
export const createUserWithEmailAndPassword = (auth, email) => auth.signIn(emailUser(email));
export const signInWithCustomToken = (auth) => auth.signIn();
export const signOut = (auth) => auth.signOut();
export async function setPersistence() {}
export async function sendPasswordResetEmail() {}
export async function updatePassword() {}
export async function updateProfile(user, p) { Object.assign(user, p); }
export async function reauthenticateWithCredential() {}

export const browserLocalPersistence = { type: 'LOCAL' };
export const browserSessionPersistence = { type: 'SESSION' };
export const inMemoryPersistence = { type: 'NONE' };
export const indexedDBLocalPersistence = { type: 'LOCAL' };

export class GoogleAuthProvider {
  constructor() { this.providerId = 'google.com'; }
  addScope() { return this; }
  setCustomParameters() { return this; }
  static credentialFromResult() { return null; }
  static credentialFromError() { return null; }
}
export class EmailAuthProvider {
  static credential() { return {}; }
}
