// 견본용 가짜 firebase-storage. 견본에서는 파일을 서버에 올리지 않는다.
import './core.js';

const NO_UPLOAD = () => Promise.reject(Object.assign(new Error('견본에서는 파일 업로드를 할 수 없습니다.'), { code: 'storage/unauthorized' }));
export function getStorage(app) { return { type: 'storage', app }; }
export function connectStorageEmulator() {}
export function ref(storage, path = '') { return { storage, fullPath: path, name: String(path).split('/').pop() }; }
export const uploadBytes = NO_UPLOAD;
export const uploadString = NO_UPLOAD;
export function uploadBytesResumable() { const p = NO_UPLOAD(); return { on: (e, n, err) => p.catch(err), then: p.then.bind(p), catch: p.catch.bind(p), cancel() {} }; }
export const getDownloadURL = () => Promise.reject(Object.assign(new Error('견본에는 저장된 파일이 없습니다.'), { code: 'storage/object-not-found' }));
export const getMetadata = getDownloadURL;
export async function deleteObject() {}
export async function listAll() { return { items: [], prefixes: [] }; }
