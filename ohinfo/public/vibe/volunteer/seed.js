// 견본 봉사활동 데이터 (일반 스크립트). 사람 이름은 전부 가상이다.
(function () {
  const F = globalThis.FakeFB;
  const U = F.DEMO_USER;
  const ts = (days) => F.Timestamp.fromMillis(Date.now() - days * 86400000);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // core.jsx의 guessTerm과 같은 규칙: 3~8월 1학기, 9~2월 2학기
  const now = new Date();
  const m = now.getMonth() + 1;
  const TERM = m >= 3 && m <= 8 ? `${now.getFullYear()}-1` : `${m <= 2 ? now.getFullYear() - 1 : now.getFullYear()}-2`;
  const [Y, S] = TERM.split('-').map(Number);
  const termStart = S === 1 ? `${Y}-03-02` : `${Y}-08-20`;
  const termEnd = S === 1 ? `${Y}-07-20` : `${Y + 1}-02-10`;
  // GWVS 는 통합 프로젝트(gwansan-work) 구조: apps/volunteer, 교사 staff/{이메일}, 명렬표 years/{학년도}/students
  const LAYOUTS = [
    { D: 'apps/volunteer', teacherDoc: (uid, email) => `staff/${email}`, teacherId: U.email,
      rosterCol: () => `years/${Y}/students`, rid: (n) => `${Y}-1-1-${n}` },
  ];

  F.seed('vibe-volunteer', (put) => {
    put(`admins/${U.email}`, { email: U.email });
    LAYOUTS.forEach(({ D, teacherDoc, teacherId, rosterCol, rid }) => {
      put(`${D}/settings/term`, { current: TERM, terms: [TERM] });
      put(teacherDoc(U.uid, U.email), { name: '견본 선생님', email: U.email, homeroom: true, grade: 1, klass: 1, roles: ['r1'], status: 'approved', createdAt: ts(60), updatedAt: ts(60) });
      put(teacherDoc('demo-other', 'other@example.com'), { name: '다른 견본 선생님', email: 'other@example.com', homeroom: true, grade: 1, klass: 2, roles: [], status: 'pending', createdAt: ts(0), updatedAt: ts(0) });

      const names = ['김하늘', '이바다', '박서준', '최은비', '정도윤', '한지우'];
      names.forEach((name, i) => put(`${rosterCol(D)}/${rid(i + 1)}`, { term: TERM, grade: 1, klass: 1, number: i + 1, name, koreanName: '', updatedAt: ts(30) }));

      const periods = Object.fromEntries(['1', '2', '3'].map((g) => [g, { start: termStart, end: termEnd }]));
      put(`${D}/roles/${TERM}_r1`, { term: TERM, key: 'r1', name: '도서부', content: '도서관 대출·반납과 서가 정리 도우미', area: '이웃돕기활동', hours: 10, periods, teacherUid: teacherId, teacherName: '견본 선생님', order: 1, createdAt: ts(50), updatedAt: ts(50) });
      put(`${D}/roles/${TERM}_r2`, { term: TERM, key: 'r2', name: '환경지킴이', content: '분리수거장 정리와 교내 환경 캠페인', area: '환경보호활동', hours: 8, periods, teacherUid: '', teacherName: '', order: 2, createdAt: ts(50), updatedAt: ts(50) });
      [[1, 'r1', '도서부', 10], [2, 'r1', '도서부', 10], [4, 'r2', '환경지킴이', 8]].forEach(([n, roleKey, helperName, hours]) => {
        const key = `1-1-${n}`;
        put(`${D}/students/${TERM}_${roleKey}_${key}`, { term: TERM, roleKey, helperName, rosterKey: key, grade: 1, class: 1, number: n, neisName: names[n - 1], name: names[n - 1], hours, originalHours: hours, reason: '', createdAt: ts(40) });
      });

      const d = new Date(); d.setDate(d.getDate() - 7);
      put(`${D}/events/ev1`, { title: '학교 주변 환경 정화', date: iso(d), periodStart: 5, periodEnd: 6, hours: 2, area: '환경보호활동', content: '학교 주변 쓰레기 줍기와 분리배출', grades: [1, 2, 3], term: TERM, finalized: false, createdAt: ts(14), updatedAt: ts(14) });
      put(`${D}/attendance/ev1_1-1`, { eventId: 'ev1', term: TERM, grade: 1, klass: 1, absent: [rid(3)], confirmed: true, confirmedBy: '견본 선생님', confirmedAt: ts(6) });
    });
  });
})();
