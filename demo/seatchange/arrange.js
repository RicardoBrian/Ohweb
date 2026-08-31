/**
 * 좌석 배정 엔진 — DOM에 의존하지 않는 순수 모듈.
 *
 * 단순 셔플이 아니라 제약조건을 만족시키는 배정을 찾는다.
 * 교실에서 실제로 필요한 건 "완전 랜덤"이 아니라
 * "시력 나쁜 애는 앞줄, 저 둘은 떼어놓고, 지난번이랑 다르게"이기 때문.
 *
 * seed를 저장해두면 같은 입력 + 같은 seed = 같은 결과라서
 * "다시 돌려봐" 요구에 재현이 되고, 공정성 시비도 막을 수 있다.
 */

/** 시드 기반 PRNG. Math.random과 달리 재현 가능하다. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeSeed() {
  return (crypto?.getRandomValues?.(new Uint32Array(1))[0]) ?? (Math.random() * 2 ** 32) >>> 0;
}

/** 시드 셔플 (Fisher-Yates). */
function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 짝꿍 = 같은 줄에서 바로 옆자리. 통로 건너편은 짝으로 치지 않는다. */
function buildDeskmates(seats) {
  const map = new Map(seats.map(s => [s.id, []]));
  const byRow = new Map();
  for (const s of seats) {
    if (!byRow.has(s.row)) byRow.set(s.row, []);
    byRow.get(s.row).push(s);
  }
  for (const row of byRow.values()) {
    row.sort((a, b) => a.col - b.col);
    for (let i = 1; i < row.length; i++) {
      if (row[i].col - row[i - 1].col !== 1) continue; // 통로가 끼면 짝이 아님
      map.get(row[i].id).push(row[i - 1].id);
      map.get(row[i - 1].id).push(row[i].id);
    }
  }
  return map;
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * @param {object}   input
 * @param {Array}    input.seats    [{id, row, col, disabled?}]
 * @param {Array}    input.members  [{id, name}]
 * @param {object}   input.rules
 * @param {object}   input.rules.pins            {memberId: seatId} 고정석
 * @param {string[]} input.rules.frontRequired   앞줄이어야 하는 멤버
 * @param {number}   input.rules.frontRows       앞줄로 치는 줄 수 (기본 2)
 * @param {object}   input.rules.rowRequired     {memberId: rowIndex} 정확히 이 줄
 *   (명렬표 업로드로 들어오는 제약. frontRequired와 달리 "이 줄이 아니면 안 됨"이라
 *   완화 대상이 아니다 — 명단에 명시된 값을 조용히 무시하면 안 되므로.)
 * @param {Array}    input.rules.avoidPairs      [[m1,m2]] 짝 금지
 * @param {boolean}  input.rules.avoidPrevSeat   직전과 같은 자리 금지
 * @param {boolean}  input.rules.avoidPrevNeighbor 직전과 같은 짝 금지
 * @param {object}   input.rules.prev            {seatId: memberId} 직전 배정
 * @param {number}   input.seed
 */
export function arrange({ seats, members, rules = {}, seed = makeSeed() }) {
  const usable = seats.filter(s => !s.disabled);
  const {
    pins = {}, frontRequired = [], frontRows = 2, rowRequired = {}, avoidPairs = [],
    avoidPrevSeat = false, avoidPrevNeighbor = false, prev = null,
  } = rules;

  if (members.length > usable.length) {
    return { ok: false, reason: 'seat_shortage', seed,
             detail: { members: members.length, seats: usable.length } };
  }

  const deskmates = buildDeskmates(usable);
  const seatById = new Map(usable.map(s => [s.id, s]));
  const avoid = new Set(avoidPairs.map(([a, b]) => pairKey(a, b)));
  const frontSet = new Set(frontRequired);

  // pins는 fits()를 거치지 않고 바로 놓이므로, rowRequired와 모순되는 고정석은
  // 여기서 미리 걸러야 한다 — 안 그러면 명단에 적은 줄 지정이 조용히 무시된다.
  for (const [mId, seatId] of Object.entries(pins)) {
    const want = rowRequired[mId];
    if (want != null && seatById.get(seatId)?.row !== want) {
      return { ok: false, reason: 'unsatisfiable', seed,
               detail: { hint: `고정석과 줄 지정이 서로 다른 학생이 있습니다 (${mId}).` } };
    }
  }

  // 직전 배정을 멤버 기준으로 뒤집어 둔다.
  const prevSeatOf = new Map();
  const prevMateOf = new Map();
  if (prev) {
    for (const [seatId, mId] of Object.entries(prev)) prevSeatOf.set(mId, seatId);
    for (const [seatId, mId] of Object.entries(prev)) {
      for (const n of deskmates.get(seatId) ?? []) {
        if (prev[n]) prevMateOf.set(mId, (prevMateOf.get(mId) ?? new Set()).add(prev[n]));
      }
    }
  }

  // 완화 가능한 규칙을 강한 것부터 차례로 끈다. 못 풀면 아예 결과가 없는 것보다,
  // "무엇을 못 지켰는지 밝히고" 배정을 내주는 편이 교실에서 쓸모 있다.
  const levels = [
    { relaxed: [],                                       prevNeighbor: avoidPrevNeighbor, prevSeat: avoidPrevSeat, pairs: true },
    { relaxed: ['avoidPrevNeighbor'],                    prevNeighbor: false,             prevSeat: avoidPrevSeat, pairs: true },
    { relaxed: ['avoidPrevNeighbor', 'avoidPrevSeat'],   prevNeighbor: false,             prevSeat: false,         pairs: true },
    { relaxed: ['avoidPrevNeighbor', 'avoidPrevSeat', 'avoidPairs'], prevNeighbor: false,  prevSeat: false,         pairs: false },
  ];

  for (const lv of levels) {
    const res = solve(lv);
    if (res) return { ok: true, seed, placements: res, relaxed: lv.relaxed };
  }
  return { ok: false, reason: 'unsatisfiable', seed,
           detail: { hint: '고정석이나 앞줄 지정이 서로 충돌할 수 있습니다.' } };

  function solve(lv) {
    const assign = {};          // seatId -> memberId
    const seatOf = new Map();   // memberId -> seatId
    const taken = new Set();

    // 고정석 먼저. 여기서 충돌하면 시도할 것도 없다.
    for (const [mId, seatId] of Object.entries(pins)) {
      if (!seatById.has(seatId) || taken.has(seatId)) return null;
      assign[seatId] = mId; seatOf.set(mId, seatId); taken.add(seatId);
    }

    const free = members.filter(m => !(m.id in pins));

    const candidatesFor = m => usable.filter(s => !taken.has(s.id) && fits(m.id, s.id, assign, lv));

    // MRV: 선택지가 적은 멤버부터 놓는다. 막다른 길을 일찍 발견해서 탐색이 훨씬 빨라진다.
    const order = shuffled(free, mulberry32(seed)).sort(
      (a, b) => candidatesFor(a).length - candidatesFor(b).length
    );

    const rng = mulberry32(seed ^ 0x9e3779b9);
    let budget = 200000; // 무한 탐색 방지

    const place = i => {
      if (i === order.length) return true;
      if (budget-- <= 0) return false;
      const m = order[i];
      for (const s of shuffled(usable.filter(x => !taken.has(x.id)), rng)) {
        if (!fits(m.id, s.id, assign, lv)) continue;
        assign[s.id] = m.id; seatOf.set(m.id, s.id); taken.add(s.id);
        if (place(i + 1)) return true;
        delete assign[s.id]; seatOf.delete(m.id); taken.delete(s.id);
      }
      return false;
    };

    return place(0) ? assign : null;
  }

  function fits(mId, seatId, assign, lv) {
    const seat = seatById.get(seatId);
    if (pins[mId] && pins[mId] !== seatId) return false;
    if (rowRequired[mId] != null) {
      if (seat.row !== rowRequired[mId]) return false;
    } else if (frontSet.has(mId) && seat.row >= frontRows) return false;
    if (lv.prevSeat && prevSeatOf.get(mId) === seatId) return false;

    for (const nId of deskmates.get(seatId) ?? []) {
      const other = assign[nId];
      if (!other) continue;
      if (lv.pairs && avoid.has(pairKey(mId, other))) return false;
      if (lv.prevNeighbor && (prevMateOf.get(mId)?.has(other) || prevMateOf.get(other)?.has(mId))) return false;
    }
    return true;
  }
}

/**
 * 꽉 찬 행×열 격자 생성 — 초기 기본 배치를 만들 때만 쓴다.
 * 이후에는 이 결과를 편집 가능한 책상 배열(S.desks)로 다루므로, 여기서
 * "통로" 같은 생성 규칙을 더 두지 않는다 — 통로는 그냥 책상이 없는 칸이다.
 */
export function makeGrid(rows, cols) {
  const seats = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) seats.push({ id: `r${r}c${c}`, row: r, col: c });
  return seats;
}
