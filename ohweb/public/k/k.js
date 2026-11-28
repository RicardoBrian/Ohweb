// kaká 선생님 화면 공통 — 로그인 확인, 머리글, 알림, 대화창, 과목 자료 읽기·쓰기.
// 자료 구조: PLATFORM-DESIGN.md §8 (courses, course_lessons). 스타일: kakainfo.com/kaka/kaka.css
import { db, auth } from '../firebase-config.js';
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where, serverTimestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

export { db, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where, serverTimestamp, writeBatch };

const ADMIN_EMAIL = 'qjatjr7575@gmail.com';
export const $ = (s, el = document) => el.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const nv = v => String(v ?? '').replace(/학년|반/g, '').trim();
// 화면 안에서 불러올 때 쓰는 스켈레톤 줄
export const skel = (n = 4) => `<div class="sk-list" aria-busy="true">${'<div class="sk-item"><span class="sk" style="height:14px;margin-top:4px"></span><div><span class="sk" style="width:55%;height:18px"></span><span class="sk" style="width:35%;height:12px;margin-top:8px"></span></div></div>'.repeat(n)}</div>`;
export const chip = (cls, text) => `<span class="k-chip ${cls ? 'k-chip--' + cls : ''}">${esc(text)}</span>`;
import { LOGO_SVG } from 'https://kakainfo.com/kaka/logo.js';

// 로그인: 선생님 계정이 아니면 로그인 버튼만 보여 주고 멈춘다.
export function requireAdmin() {
  return new Promise(resolve => {
    onAuthStateChanged(auth, user => {
      if (user && user.email === ADMIN_EMAIL && user.emailVerified) return resolve(user);
      document.body.innerHTML = header('') + `<main class="k-page"><div class="k-page__head"><h1 class="t-display">선생님 로그인</h1>
        <p class="k-muted" style="margin:0">${user ? esc(user.email) + ' 계정은 선생님 계정이 아닙니다.' : '구글 계정으로 로그인하세요.'}</p></div>
        <button class="k-btn k-btn--primary" id="login">구글로 로그인</button></main>`;
      $('#login').onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch(e => toast('로그인하지 못했습니다: ' + e.code));
    });
  });
}

export function header(current) {
  const nav = [['index.html', 'today', '오늘'], ['index.html#courses', 'course', '과목']]
    .map(([h, k, n]) => `<a href="${h}" ${current === k ? 'aria-current="page"' : ''}>${n}</a>`).join('');
  return `<header class="k-header"><a class="k-logo" href="index.html" aria-label="kaká 오늘">${LOGO_SVG}</a>
  <nav class="k-nav">${nav}</nav><div class="k-header__end"><a class="k-btn k-btn--ghost k-btn--sm" href="../admin.html">지금 관리자 화면</a><span class="k-avatar" aria-label="오범석">오</span></div></header>`;
}

export function toast(msg) {
  let t = $('#k-toast');
  if (!t) { t = document.createElement('div'); t.id = 'k-toast'; t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:50'; document.body.append(t); }
  t.innerHTML = `<div class="k-toast" role="status">${esc(msg)}</div>`; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2800);
}

// 대화창: fields = [{key, label, value, hint, type}] → 저장 누르면 값 객체, 닫으면 null
export function dialog({ title, body = '', fields = [], ok = '저장', danger = false, extra = '' }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:40;display:grid;place-items:center;padding:16px;background:rgba(20,24,22,.32)';
    wrap.innerHTML = `<form class="k-dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-t"><h2 class="k-dialog__title" id="dlg-t">${esc(title)}</h2>
      ${body ? `<p class="k-dialog__body">${body}</p>` : ''}
      ${fields.map(f => `<label class="k-field"><span class="k-label">${esc(f.label)}</span>
        <input class="k-input" name="${f.key}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} autocomplete="off">
        ${f.hint ? `<span class="k-hint">${esc(f.hint)}</span>` : ''}</label>`).join('')}${extra}
      <div class="k-dialog__actions"><button type="button" class="k-btn k-btn--ghost" data-x>닫기</button><button class="k-btn ${danger ? 'k-btn--danger' : 'k-btn--primary'}">${esc(ok)}</button></div></form>`;
    const close = v => { wrap.remove(); resolve(v); };
    wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-x]')) close(null); });
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });
    wrap.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      close(Object.fromEntries(new FormData(e.target).entries()));
    });
    document.body.append(wrap);
    (wrap.querySelector('input') || wrap.querySelector('button:last-child')).focus();
  });
}

// 이름 번역: 한국어 → 중국어·러시아어·영어. 실패한 언어는 비워 둔다(나중에 다시 저장하면 채워진다).
export async function translateName(ko) {
  const out = { zh: '', ru: '', en: '' };
  if (!ko) return out;
  await Promise.allSettled([['zh', 'zh-cn'], ['ru', 'ru'], ['en', 'en']].map(async ([k, code]) => {
    const res = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: [ko], targetLang: code, sourceLang: 'ko' }) });
    const d = await res.json();
    if (d.translations?.[0]?.text) out[k] = d.translations[0].text;
  }));
  return out;
}

// ── 과목 자료 ──
export const newId = () => Math.random().toString(36).slice(2, 10);
export const classLabel = c => `${nv(c)}반`;
export const courseLabel = c => `${c.grade ? nv(c.grade) + '학년 ' : ''}${c.name}`;
export const termLabel = c => `${c.year}학년도 ${c.semester}학기`;

export async function loadCourses() {
  const snap = await getDocs(collection(db, 'courses'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.year - a.year) || (b.semester - a.semester) || nv(a.grade).localeCompare(nv(b.grade)) || a.name.localeCompare(b.name));
}
export async function loadLessons(courseId) {
  const snap = await getDocs(query(collection(db, 'course_lessons'), where('courseId', '==', courseId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
// 단원 순서 → 단원 안 순서로 줄 세우고 과목 전체 차시 번호(no)를 붙인다. 단원이 지워진 차시는 맨 뒤.
export function orderLessons(course, lessons) {
  const uIdx = Object.fromEntries((course.units || []).map((u, i) => [u.id, i]));
  const list = [...lessons].sort((a, b) => ((uIdx[a.unitId] ?? 1e9) - (uIdx[b.unitId] ?? 1e9)) || (a.order - b.order));
  list.forEach((l, i) => { l.no = i + 1; });
  return list;
}
// 반마다 다음에 공개할 차시 = 순서대로 봤을 때 그 반에 아직 안 연 첫 차시
export function nextFor(ordered, cls) {
  return ordered.find(l => !(l.openTo || []).includes(cls)) || null;
}
export function lastOpenFor(ordered, cls) {
  return [...ordered].reverse().find(l => (l.openTo || []).includes(cls)) || null;
}
