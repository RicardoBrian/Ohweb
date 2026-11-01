// 견본용 가짜 firebase-app. 앱마다 config의 projectId를 저장 공간 이름으로 쓴다.
import './core.js';

const apps = new Map();

export function initializeApp(options = {}, name = '[DEFAULT]') {
  const app = { name, options: { ...options }, automaticDataCollectionEnabled: false, __ns: options.projectId || name, __authNs: (options.projectId || name) + (options.authDomain ? '#' + options.authDomain : '') };
  apps.set(name, app);
  return app;
}
export function getApp(name = '[DEFAULT]') {
  if (!apps.has(name)) throw new Error(`Firebase App named '${name}' does not exist`);
  return apps.get(name);
}
export function getApps() { return [...apps.values()]; }
export async function deleteApp(app) { apps.delete(app.name); }
export const SDK_VERSION = '10.12.2-demo';
