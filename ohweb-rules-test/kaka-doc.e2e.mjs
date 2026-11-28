// 차시 문서 편집기(ohweb/public/k/lesson.html, present.html) e2e — Firebase 만 에뮬레이터, 편집기는 실제 CDN 파일.
// 글 쓰기 → 자동 저장 → 우리 블록 넣기 → 번역 초안 → 번역 고치기 → 원문 바뀜 표시 → 미리 보기 → 발표(장 나눔·타이머·언어)
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';

const ADMIN_ROOT = new URL('../ohweb/public', import.meta.url).pathname;
const KAKA = new URL('../ohinfo/public/kaka', import.meta.url).pathname;
const FB = new URL('./.fbcdn', import.meta.url).pathname;
const ADMIN_EMAIL = 'qjatjr7575@gmail.com';
const SHOT = process.env.SHOT_DIR;
const rules = readFileSync(new URL('../ohweb-firestore.rules', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({ projectId: 'ohweb-93062', firestore: { rules, host: '127.0.0.1', port: 8181 } });
await env.clearFirestore();
await fetch('http://127.0.0.1:9099/emulator/v1/projects/ohweb-93062/accounts', { method: 'DELETE' });
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'courses/C1'), { name: '정보', year: 2027, semester: 1, schoolName: 'S중', grade: '1', classes: ['1'], units: [{ id: 'u1', name: '알고리즘' }], status: 'active' });
  await setDoc(doc(db, 'course_lessons/L1'), { courseId: 'C1', unitId: 'u1', order: 1, name: '반복문', docId: null, openTo: [], standards: [] });
});
const signUp = async (email, password) => {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  return (await r.json()).localId;
};
const adminUid = await signUp(ADMIN_EMAIL, 'adminpw1');
await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/ohweb-93062/accounts:update', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId: adminUid, emailVerified: true }) });

const conf = `import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
const app = initializeApp({ apiKey: 'fake', projectId: 'ohweb-93062', authDomain: 'localhost' });
export const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8181);
export const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
if (!auth.currentUser) await signInWithEmailAndPassword(auth, '${ADMIN_EMAIL}', 'adminpw1');`;
const type = p => p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : p.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8';
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/firebase-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(conf); }
  try { const body = readFileSync(path.join(ADMIN_ROOT, p)); res.writeHead(200, { 'content-type': type(p) }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(8099);

let fails = 0;
const ok = (label, cond, extra = '') => { if (cond) console.log('✅ ' + label); else { fails++; console.log('❌ ' + label + (extra ? ' — ' + extra : '')); } };
const read = async p => { let v; await env.withSecurityRulesDisabled(async c => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };
const docsAll = async () => { let v = []; await env.withSecurityRulesDisabled(async c => { v = (await getDocs(collection(c.firestore(), 'docs'))).docs.map(d => ({ id: d.id, ...d.data() })); }); return v; };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 200)); } return null; };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: SHOT ? 2 : 1 });
let trCalls = [];
await ctx.route('**/*', route => {
  const u = route.request().url();
  const m = u.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([A-Za-z0-9_-]+\.js)$/);
  if (m) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(FB, m[1])) });
  const k = u.match(/^https:\/\/kakainfo\.com\/kaka\/([a-z-]+\.(css|svg))$/);
  if (k) return route.fulfill({ status: 200, contentType: type(k[1]), body: readFileSync(path.join(KAKA, k[1])) });
  if (u.endsWith('/api/translate')) {
    const body = JSON.parse(route.request().postData()); trCalls.push(body);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ translations: body.texts.map(t => ({ text: t ? `[${body.targetLang}] ${t}` : '' })) }) });
  }
  if (u.startsWith('https://cdn.jsdelivr.net/npm/@editorjs/') || u.startsWith('http://localhost:') || u.startsWith('http://127.0.0.1')) return route.continue();
  return route.abort();
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const saved = () => page.waitForFunction(() => /^저장됨/.test(document.querySelector('#save')?.textContent || ''), null, { timeout: 10000 });

try {
  await page.goto('http://localhost:8099/k/lesson.html?id=L1');
  await page.waitForFunction(() => window.kEditor && document.querySelector('.ce-paragraph'), null, { timeout: 20000 });
  ok('편집기가 열린다(빈 차시)', (await page.textContent('h1')).includes('1차시 반복문'));

  await page.click('.ce-paragraph');
  await page.keyboard.type('반복은 같은 일을 여러 번 하는 것입니다.');
  await saved();
  const lesson = await read('course_lessons/L1');
  let d = await until(async () => (await docsAll())[0]);
  ok('처음 저장하면 문서가 생기고 차시에 이어진다', d && lesson.docId === d.id && d.blocks[0]?.data.text.includes('여러 번'), JSON.stringify(lesson));

  await page.evaluate(async () => {
    const e = window.kEditor;
    e.blocks.insert('header', { text: '별 그리기', level: 1 }, {}, e.blocks.getBlocksCount(), false);
    e.blocks.insert('tool', { tool: 'scratch', title: '별 그리기', desc: '반복 블록으로 별을 그리세요.' }, {}, e.blocks.getBlocksCount(), false);
    e.blocks.insert('slide', {}, {}, e.blocks.getBlocksCount(), false);
    e.blocks.insert('callout', { tone: 'tip', text: '<b>힌트</b>: 72도' }, {}, e.blocks.getBlocksCount(), false);
    e.blocks.insert('timer', { minutes: 3, label: '혼자 해 보기' }, {}, e.blocks.getBlocksCount(), false);
    e.blocks.insert('note', { text: '다 한 학생은 오각형도' }, {}, e.blocks.getBlocksCount(), false);
    e.blocks.insert('list', { style: 'ordered', meta: {}, items: [{ content: '깃발 클릭', meta: {}, items: [] }, { content: '10번 반복', meta: {}, items: [] }] }, {}, e.blocks.getBlocksCount(), false);
    e.blocks.insert('table', { withHeadings: true, content: [['명령', '뜻'], ['반복', '여러 번']] }, {}, e.blocks.getBlocksCount(), false);
  });
  // API로 넣은 블록은 편집기가 바뀜으로 안 센다 → 실제처럼 도구 이름 칸에 글을 쳐서 저장이 일어나는지 본다
  await page.fill('.kb-tool input.k-input', '별 그리기');
  await page.type('.kb-tool input.k-input', '!');
  await page.keyboard.press('Backspace');
  d = await until(async () => { const x = (await docsAll())[0]; return x.blocks.length === 9 && x; }, 10000);
  ok('블록 8개(표 포함)가 저장된다', !!d, d ? '' : JSON.stringify((await docsAll())[0].blocks.map(b => b.type)));
  if (SHOT) await page.screenshot({ path: SHOT + '/doc-edit.png', fullPage: true });

  await page.click('[data-mode="tr"]');
  await page.click('[data-trlang="en"]');
  await page.click('#tr-all');
  d = await until(async () => { const x = (await docsAll())[0]; return Object.keys(x.tr?.en || {}).length === 7 && x; });
  ok('번역 초안: 글 있는 블록 7개(메모·슬라이드 제외)', !!d, JSON.stringify(Object.keys((await docsAll())[0].tr?.en || {})));
  ok('번역은 서식을 지키는 html 형식으로 보낸다', trCalls.at(-1)?.format === 'html' && trCalls.at(-1).targetLang === 'en');
  const callout = d && d.blocks.find(b => b.type === 'callout');
  ok('안내 상자 번역에 굵게가 남는다', callout && d.tr.en[callout.id].data.text === '[en] <b>힌트</b>: 72도' && d.tr.en[callout.id].data.tone === 'tip');
  const tbl = d && d.blocks.find(b => b.type === 'table');
  ok('표는 칸 구조를 지켜 저장·번역된다', tbl && tbl.data.content[1]._a[1] === '여러 번' && d.tr.en[tbl.id].data.content[0]._a[0] === '[en] 명령');
  const list = d && d.blocks.find(b => b.type === 'list');
  ok('목록 번역은 항목 구조가 같다', list && d.tr.en[list.id].data.items.map(i => i.content).join('|') === '[en] 깃발 클릭|[en] 10번 반복');

  const first = page.locator('.tr-ed').first();
  await first.fill('Repetition means doing the same thing many times.');
  await page.locator('.tr-ed').nth(1).click();
  const p1 = d.blocks[0].id;
  ok('번역 고치기가 저장된다', await until(async () => (await docsAll())[0].tr.en[p1].data.text === 'Repetition means doing the same thing many times.'));
  if (SHOT) await page.screenshot({ path: SHOT + '/doc-tr.png', fullPage: true });

  await page.click('[data-mode="edit"]');
  await page.click('.ce-paragraph >> nth=0');
  await page.keyboard.press('End');
  await page.keyboard.type(' 컴퓨터는 지치지 않습니다.');
  await saved();
  await page.click('[data-mode="tr"]');
  ok('원문을 바꾸면 "원문이 바뀜"이 뜬다', await page.locator('text=원문이 바뀜').count() === 1);

  await page.click('[data-mode="view"]');
  await page.click('[data-viewlang="en"]');
  const art = await page.textContent('article');
  ok('미리 보기(영어): 고친 번역·번역 글', art.includes('Repetition') && art.includes('[en] 별 그리기'), art.slice(0, 200));
  ok('미리 보기: 바뀐 원문은 표시, 메모·타이머는 안 보임', await page.locator('article .kd-mark').count() === 1 && !art.includes('오각형') && !art.includes('혼자 해 보기'));
  if (SHOT) await page.screenshot({ path: SHOT + '/doc-view.png', fullPage: true });

  await page.goto(`http://localhost:8099/k/present.html?doc=${d.id}&lang=ko`);
  await page.waitForSelector('.foot .count');
  ok('발표: 슬라이드 나눔·제목1로 3장', (await page.textContent('.count')) === '1 / 3');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  ok('발표: 키보드로 넘기기', (await page.textContent('.count')) === '3 / 3');
  await page.click('.kd-timer__btn');
  ok('발표: 타이머 블록은 발표에만, 누르면 3:00부터', /^(3:00|2:59)$/.test((await page.textContent('.kd-timer__btn')).trim()));
  if (SHOT) await page.screenshot({ path: SHOT + '/doc-present.png' });
  await page.keyboard.press('Home');
  await page.click('[data-lang="en"]');
  ok('발표: 언어 바꾸기', (await page.textContent('.stage')).includes('Repetition'));

  await page.goto('http://localhost:8099/k/course.html?id=C1');
  await page.waitForSelector('a.k-lesson__title');
  ok('과목 화면: 문서 없음 표시가 사라지고 차시가 편집기로 이어진다', (await page.getAttribute('a.k-lesson__title', 'href')) === 'lesson.html?id=L1' && await page.locator('text=문서 없음').count() === 0);
  ok('화면 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) { fails++; console.log('❌ 진행 중 오류 — ' + e.message); if (SHOT) await page.screenshot({ path: SHOT + '/doc-error.png' }); }

await browser.close(); srv.close(); await env.cleanup();
console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과'); process.exit(fails ? 1 : 0);
