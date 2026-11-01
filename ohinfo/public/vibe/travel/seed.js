// 견본 여행 데이터 — 가상의 여행 두 개. 날짜는 오늘을 기준으로 만든다.
import '/vibe/shared/fake-firebase/core.js';

const F = globalThis.FakeFB;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return iso(d); };

F.seed('vibe-travel', (put) => {
  put('config/access', { entryCode: 'demo', adminPassword: 'demo' });

  // 여행 1: 겨울방학 일본 (20일 뒤 출발, 5일)
  const s = 20;
  put('trips/trip1', {
    title: '겨울방학 오사카·교토 (견본)', startDate: day(s), endDate: day(s + 4), budget: 1500000,
    packing: [
      { text: '여권', done: true }, { text: '지갑 / 카드', done: true }, { text: '핸드폰 충전기', done: false },
      { text: '어댑터 (110V)', done: false }, { text: '상비약', done: false }, { text: '교통카드 (ICOCA)', done: false },
    ],
    createdAt: F.Timestamp.now(),
  });
  put('trips/trip1/transports/t1', {
    type: 'flight', fromCity: 'ICN', toCity: 'KIX', departDate: day(s), departTime: '08:30', arriveDate: day(s), arriveTime: '10:20',
    bookingNo: 'DEMO123', memo: '2시간 전 공항 도착',
  });
  put('trips/trip1/transports/t2', {
    type: 'train', fromCity: '오사카', toCity: '교토', departDate: day(s + 2), departTime: '09:10', arriveDate: day(s + 2), arriveTime: '09:40',
    bookingNo: '', memo: 'JR 신쾌속',
  });
  put('trips/trip1/transports/t3', {
    type: 'flight', fromCity: 'KIX', toCity: 'ICN', departDate: day(s + 4), departTime: '18:00', arriveDate: day(s + 4), arriveTime: '20:00',
    bookingNo: 'DEMO456', memo: '',
  });
  const hotelA = { accommodation: '난바 견본 호텔', accommodationMap: '' };
  const hotelB = { accommodation: '교토역 견본 게스트하우스', accommodationMap: '' };
  put(`trips/trip1/days/${day(s)}`, {
    theme: '도착 · 도톤보리', city: 'Osaka', ...hotelA, memo: '체크인 15시',
    todos: [{ text: '공항에서 교통카드 사기', done: false }, { text: '도톤보리 야경', done: false }],
    expenses: [
      { category: 'transport', name: '공항 열차', amount: 1300, currency: 'JPY' },
      { category: 'food', name: '타코야키', amount: 800, currency: 'JPY' },
    ],
  });
  put(`trips/trip1/days/${day(s + 1)}`, {
    theme: '오사카성 · 우메다', city: 'Osaka', ...hotelA, memo: '',
    todos: [{ text: '오사카성 천수각', done: false }, { text: '우메다 공중정원 전망대', done: false }],
    expenses: [{ category: 'sightseeing', name: '오사카성 입장권', amount: 600, currency: 'JPY' }],
  });
  put(`trips/trip1/days/${day(s + 2)}`, {
    theme: '교토 이동 · 기요미즈데라', city: 'Kyoto', ...hotelB, memo: '짐은 숙소에 먼저 맡기기',
    todos: [{ text: '기요미즈데라', done: false }, { text: '기온 거리 산책', done: false }], expenses: [],
  });
  put(`trips/trip1/days/${day(s + 3)}`, {
    theme: '후시미이나리 · 아라시야마', city: 'Kyoto', ...hotelB, memo: '',
    todos: [{ text: '아침 일찍 후시미이나리', done: false }], expenses: [],
  });
  put(`trips/trip1/days/${day(s + 4)}`, { theme: '귀국', city: 'Osaka', accommodation: '', accommodationMap: '', memo: '면세점 쇼핑', todos: [], expenses: [] });

  // 여행 2: 지난달 다녀온 제주 (끝난 여행)
  put('trips/trip2', { title: '제주 가족 여행 (견본)', startDate: day(-40), endDate: day(-38), budget: 600000, packing: [], createdAt: F.Timestamp.now() });
  put('trips/trip2/transports/t1', { type: 'flight', fromCity: 'GMP', toCity: 'CJU', departDate: day(-40), departTime: '07:40', arriveDate: day(-40), arriveTime: '08:50', bookingNo: '', memo: '' });
  put(`trips/trip2/days/${day(-40)}`, {
    theme: '동쪽 해안 드라이브', city: 'Jeju', accommodation: '성산 견본 펜션', accommodationMap: '', memo: '',
    todos: [{ text: '성산일출봉', done: true }],
    expenses: [{ category: 'transport', name: '렌터카', amount: 120000, currency: 'KRW' }, { category: 'food', name: '고기국수', amount: 27000, currency: 'KRW' }],
  });
});
