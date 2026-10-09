// 학생 사이트(OHinfo) 공통 — 상단 바의 "로고 + 지금 페이지 이름"과 브라우저 탭 제목.
//
// 예전엔 페이지마다 제목 규칙이 달랐다("시험 — OHinfo", "설문 참여", "관산중학교
// 정보 게시판" …). 이제 탭 제목은 항상 "페이지 이름 — OHinfo"(홈은 "OHinfo"),
// 이름은 홈 화면 앱 카드(home.html의 TH[...].apps)와 같은 말을 쓴다. 언어를 바꾸면
// 각 페이지의 언어 전환 함수에서 setPageTitle을 다시 부른다.
const NAMES = {
  ohdlet:   { ko: '정보 게시판',   zh: '共享白板',  ru: 'Паддлет',        en: 'Paddlet' },
  exam:     { ko: '시험',          zh: '考试',      ru: 'Тест',           en: 'Exam' },
  formlab:  { ko: '설문지 만들기', zh: '问卷练习',  ru: 'Опрос',          en: 'Survey' },
  formfill: { ko: '설문 참여',     zh: '参与问卷',  ru: 'Опрос',          en: 'Survey' },
  ailab:    { ko: 'AI 실험실',     zh: 'AI实验室',  ru: 'ИИ-лаборатория', en: 'AI Lab' },
  qna:      { ko: '질문하기',      zh: '提问',      ru: 'Вопрос учителю', en: 'Ask your teacher' },
  login:    { ko: '로그인',        zh: '登录',      ru: 'Вход',           en: 'Log in' },
};

export function pageName(key, lang) {
  const l = lang || localStorage.getItem('ohinfo_lang') || 'ko';
  const n = NAMES[key];
  return n ? (n[l] || n.ko) : '';
}

// key: NAMES의 키, override: 설문 제목처럼 그때그때 정해지는 이름(있으면 우선).
export function setPageTitle(key, override, lang) {
  const name = override || pageName(key, lang);
  const el = document.getElementById('navBrandTitle');
  if (el) el.textContent = name;
  document.title = name ? `${name} — OHinfo` : 'OHinfo';
}
