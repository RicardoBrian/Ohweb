const { arrange, makeGrid } = await import('./public/arrange.js');
let pass=0, fail=0;
const ok=(c,m)=>{ c?pass++:fail++; console.log((c?'  PASS  ':'->FAIL  ')+m); };

// 통로는 이제 격자 생성 옵션이 아니라 "그 칸에 책상이 없는 것"이다 — 편집 가능한
// 책상 배열을 흉내내려면 makeGrid로 만든 뒤 특정 칸을 직접 빼면 된다.
const withGap = (seats, row, col) => seats.filter(s => !(s.row === row && s.col === col));
const seats = makeGrid(5, 6);   // 꽉 찬 5×6 — 정원 관련 테스트는 이걸 쓴다.

const members = Array.from({length:28},(_,i)=>({id:`m${i}`,name:`학생${i+1}`}));
const deskmate=(seats,a,b)=>{const A=seats.find(s=>s.id===a),B=seats.find(s=>s.id===b);return A.row===B.row&&Math.abs(A.col-B.col)===1;};
const mates=(p,id)=>{const seat=Object.keys(p).find(s=>p[s]===id);return Object.keys(p).filter(s=>s!==seat&&deskmate(seats,s,seat)).map(s=>p[s]).filter(Boolean);};

ok(makeGrid(5,6).length===30, 'makeGrid(5,6)은 꽉 찬 30칸');

// 통로(=빈 칸)를 사이에 둔 두 책상은 짝으로 치지 않는다.
// 좌석이 정확히 2개뿐이라 배정 자체는 자리가 있으면 항상 성공한다 — 진짜로
// 확인하려는 건 avoidPairs가 "완화됐는지"다. 진짜 이웃이 아니라면 애초에
// 걸릴 일이 없으니 relaxed가 비어 있어야 하고, 잘못 이웃으로 쳤다면
// avoidPairs를 강제로 끄고서야 성공해 relaxed에 흔적이 남는다.
const acrossGap = withGap(makeGrid(1, 3), 0, 1); // r0c0 · [통로] · r0c2
const twoMembers = members.slice(0, 2);
const rg = arrange({ seats: acrossGap, members: twoMembers, seed: 1, rules: { avoidPairs: [[twoMembers[0].id, twoMembers[1].id]] } });
ok(rg.ok && rg.relaxed.length === 0, '통로 건너편은 짝이 아니라 avoidPairs를 완화할 필요조차 없음');

const r = arrange({seats,members,seed:12345});
ok(r.ok, '기본 배정 성공');
ok(Object.keys(r.placements).length===28, '28명 전원 배치');
ok(new Set(Object.values(r.placements)).size===28, '중복 배치 없음');

const r2 = arrange({seats,members,seed:12345});
ok(JSON.stringify(r.placements)===JSON.stringify(r2.placements), '같은 seed = 같은 결과 (재현성)');
const r3 = arrange({seats,members,seed:999});
ok(JSON.stringify(r.placements)!==JSON.stringify(r3.placements), '다른 seed = 다른 결과');

const rp = arrange({seats,members,seed:7,rules:{pins:{m0:'r0c0',m1:'r4c5'}}});
ok(rp.ok && rp.placements['r0c0']==='m0' && rp.placements['r4c5']==='m1', '고정석 준수');

const rf = arrange({seats,members,seed:7,rules:{frontRequired:['m3','m4','m5'],frontRows:2}});
const frontOK = ['m3','m4','m5'].every(id=>{const s=Object.keys(rf.placements).find(k=>rf.placements[k]===id);return seats.find(x=>x.id===s).row<2;});
ok(rf.ok && frontOK, '앞줄 지정 준수 (시력 배려)');

// 명렬표 업로드로 들어오는 "정확히 이 줄" 제약 — 앞줄 고정과 달리 완화되면 안 된다.
const rr2 = arrange({seats,members,seed:7,rules:{rowRequired:{m6:2,m7:4}}});
const rowOf = (placements, id) => seats.find(s => s.id === Object.keys(placements).find(k=>placements[k]===id)).row;
ok(rr2.ok && rowOf(rr2.placements,'m6')===2 && rowOf(rr2.placements,'m7')===4, '줄 지정(rowRequired) 준수');

const conflict = arrange({seats,members,seed:7,rules:{pins:{m0:'r0c0'},rowRequired:{m0:3}}});
ok(!conflict.ok, '고정석과 줄 지정이 모순되면 즉시 거부');

const ra = arrange({seats,members,seed:7,rules:{avoidPairs:[['m0','m1'],['m2','m3']]}});
ok(ra.ok && !mates(ra.placements,'m0').includes('m1') && !mates(ra.placements,'m2').includes('m3'), '짝 금지 준수');

const prev = arrange({seats,members,seed:1}).placements;
const rs = arrange({seats,members,seed:2,rules:{prev,avoidPrevSeat:true}});
const moved = members.every(m=>{const now=Object.keys(rs.placements).find(k=>rs.placements[k]===m.id);return prev[now]!==m.id;});
ok(rs.ok && moved, '직전과 같은 자리 금지 — 전원 이동');

const rn = arrange({seats,members,seed:3,rules:{prev,avoidPrevNeighbor:true}});
const prevMate = id=>{const s=Object.keys(prev).find(k=>prev[k]===id);return Object.keys(prev).filter(k=>k!==s&&deskmate(seats,k,s)).map(k=>prev[k]);};
ok(rn.ok && members.every(m=>!mates(rn.placements,m.id).some(x=>prevMate(m.id).includes(x))), '직전 짝 금지 준수');

ok(arrange({seats,members:Array.from({length:31},(_,i)=>({id:`m${i}`})),seed:1}).reason==='seat_shortage', '자리 부족 감지');
ok(!arrange({seats,members,seed:1,rules:{pins:{m0:'r0c0',m1:'r0c0'}}}).ok, '고정석 충돌 감지');

// 완화: 좁은 격자에 불가능한 앞줄 요구 -> 완화 없이도 실패해야
const tiny = makeGrid(2,2);
const impossible = arrange({seats:tiny,members:members.slice(0,4),seed:1,rules:{frontRequired:['m0','m1','m2'],frontRows:1}});
ok(!impossible.ok, '충족 불가능한 제약 감지');

// 완화 경로: prev 제약이 빡빡하면 relaxed에 기록되며 성공
const t2 = makeGrid(1,2);
const rr = arrange({seats:t2,members:members.slice(0,2),seed:5,rules:{prev:{r0c0:'m0',r0c1:'m1'},avoidPrevSeat:true,avoidPrevNeighbor:true}});
ok(rr.ok && rr.relaxed.length>0, `풀 수 없으면 규칙 완화 후 보고 (relaxed=${rr.relaxed})`);

// 줄이 통째로 없어진 경우(=행을 지운 경우) rowRequired는 완화되지 않고 그대로 실패해야
const noRow5 = withGap(makeGrid(2,2), 1, 0).filter(s => s.row !== 1 || s.col !== 1); // row 1 통째로 없앰
const rowGone = arrange({seats: noRow5, members: members.slice(0,2), seed: 1, rules: { rowRequired: { m0: 1 } }});
ok(!rowGone.ok, '지정한 줄 자체가 없으면 배정 불가');

console.log(`\n통과 ${pass} / 실패 ${fail}`);
process.exit(fail?1:0);
