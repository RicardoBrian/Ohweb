// 견본 방송부 데이터 (일반 스크립트). 사람 이름은 전부 가상이다.
(function () {
  const F = globalThis.FakeFB;
  const ts = (days) => F.Timestamp.fromMillis(Date.now() - days * 86400000);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  // 오늘(주말이면 다음 월요일)부터 수업일 n개
  function schoolDays(n) {
    const out = [];
    const d = new Date(); d.setHours(0, 0, 0, 0);
    while (out.length < n) { if (d.getDay() !== 0 && d.getDay() !== 6) out.push(new Date(d)); d.setDate(d.getDate() + 1); }
    return out;
  }
  // 방송부 앱이 통합 프로젝트 구조(apps/broadcast/…, 부원은 members)로 바뀌는 중이라(2026-11)
  // 예전·새 경로에 같은 견본을 둘 다 넣는다. 방송부 전환이 끝나면 예전 경로는 지운다.
  F.seed('vibe-broadcast', (put) => {
    const both = (path, data) => { put(path, data); put('apps/broadcast/' + path.replace(/^students\//, 'members/'), data); };
    [['김하늘', '1'], ['이바다', '1'], ['박서준', '2'], ['최은비', '2'], ['정도윤', '3'], ['한지우', '3']]
      .forEach(([name, grade], i) => both(`students/s${i + 1}`, { name, grade, createdAt: ts(60) }));

    const plans = [
      [{ period: '아침방송', p3: '정도윤', p2: '박서준', p1: '김하늘', notice: '아침 조회: 교장 선생님 말씀 → 이번 주 행사 안내' },
       { period: '점심시간', p3: '한지우', p2: '', p1: '이바다', notice: '신청곡 2곡 송출' }],
      [{ period: '아침방송', p3: '한지우', p2: '최은비', p1: '이바다', notice: '학교폭력 예방 교육 영상 송출 (1교시 전까지)' }],
      [{ period: '5교시', p3: '정도윤', p2: '박서준, 최은비', p1: '김하늘', notice: '체육대회 개회식 생중계 — 강당 카메라 점검' },
       { period: '점심시간', p3: '', p2: '최은비', p1: '김하늘', notice: '신청곡 송출' }],
    ];
    schoolDays(plans.length).forEach((d, i) => {
      const key = iso(d);
      both(`broadcasts/${key}`, {
        date: `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAYS[d.getDay()]})`, dateValue: key,
        tasks: plans[i].map((t) => ({ id: `task_${key}_${t.period}`, rawVideoUrl: '', ...t })),
      });
    });

    [['2', '3', '익명', '밤양갱', '비비'], ['1', '5', '김하늘', '봄날', '방탄소년단'], ['3', '2', '익명', 'Supernova', 'aespa']]
      .forEach(([grade, classInfo, name, song, artist], i) => both(`songs/song${i + 1}`, { grade, classInfo, name, song, artist, isDone: false, createdAt: ts(i) }));

    both('manuals/m1', {
      mainTitle: '아침방송 송출 순서', mainDesc: '8시 20분까지 방송실에 모입니다.',
      subItems: [
        { subTitle: '준비', steps: ['방송실 장비 전원 켜기', '마이크·카메라 연결 확인', '오늘 일정표의 영상 주소 열어 두기'] },
        { subTitle: '송출', steps: ['조회 시작 음악 재생', '사회자 멘트', '영상 송출 후 화면 전환'] },
      ], createdAt: ts(30),
    });
    both('manuals/m2', {
      mainTitle: '점심 신청곡 송출', mainDesc: '신청곡은 하루 2곡까지 틉니다.',
      subItems: [{ subTitle: '송출 전', steps: ['신청곡 목록에서 오래된 순으로 고르기', '가사 확인(욕설·부적절한 내용 제외)'] },
        { subTitle: '송출 후', steps: ['신청곡을 "완료"로 표시'] }],
      createdAt: ts(25),
    });
  });
})();
