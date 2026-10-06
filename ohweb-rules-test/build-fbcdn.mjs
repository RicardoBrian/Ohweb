// 시험 화면 e2e용: 페이지가 gstatic CDN에서 받는 Firebase 모듈을 npm 패키지로 묶어
// .fbcdn/에 만든다(앱·인증·DB가 같은 인스턴스를 쓰도록 공유 청크로 분할).
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = new URL('./.fbcdn/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const mods = ['app', 'auth', 'firestore', 'storage'];
for (const m of mods) writeFileSync(`${out}firebase-${m}.mjs`, `export * from 'firebase/${m}';`);
await build({ entryPoints: mods.map(m => `${out}firebase-${m}.mjs`), bundle: true, splitting: true, format: 'esm', outdir: out, outExtension: { '.js': '.js' }, logLevel: 'error' });
