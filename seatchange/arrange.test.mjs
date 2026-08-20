const { arrange, makeGrid } = await import('./public/arrange.js');
let pass=0, fail=0;
const ok=(c,m)=>{ c?pass++:fail++; console.log((c?'  PASS  ':'->FAIL  ')+m); };

const seats = makeGrid(5,6,{aisleAfter:[2]});          // 5행 6열, 3열 뒤 통로
const members = Array.from({length:28},(_,i)=>({id:`m${i}`,name:`학생${i+1}`}));
const deskmate=(seats,a,b)=>{const A=seats.find(s=>s.id===a),B=seats.find(s=>s.id===b);return A.row===B.row&&Math.abs(A.col-B.col)===1;};
const mates=(p,id)=>{const seat=Object.keys(p).find(s=>p[s]===id);return Object.keys(p).filter(s=>s!==seat&&deskmate(seats,s,seat)).map(s=>p[s]).filter(Boolean);};

ok(seats.length===30, `격자 30석 생성 (실제 ${seats.length})`);
ok(seats.filter(s=>s.row===0).map(s=>s.col).join()==='0,1,2,4,5,6', '통로가 col 3을 비움');

const r = arrange({seats,members,seed:12345});
ok(r.ok, '기본 배정 성공');
ok(Object.keys(r.placements).length===28, '28명 전원 배치');
ok(new Set(Object.values(r.placements)).size===28, '중복 배치 없음');

const r2 = arrange({seats,members,seed:12345});
ok(JSON.stringify(r.placements)===JSON.stringify(r2.placements), '같은 seed = 같은 결과 (재현성)');
const r3 = arrange({seats,members,seed:999});
ok(JSON.stringify(r.placements)!==JSON.stringify(r3.placements), '다른 seed = 다른 결과');

const rp = arrange({seats,members,seed:7,rules:{pins:{m0:'r0c0',m1:'r4c6'}}});
ok(rp.ok && rp.placements['r0c0']==='m0' && rp.placements['r4c6']==='m1', '고정석 준수');

const rf = arrange({seats,members,seed:7,rules:{frontRequired:['m3','m4','m5'],frontRows:2}});
const frontOK = ['m3','m4','m5'].every(id=>{const s=Object.keys(rf.placements).find(k=>rf.placements[k]===id);return seats.find(x=>x.id===s).row<2;});
ok(rf.ok && frontOK, '앞줄 지정 준수 (시력 배려)');

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

console.log(`\n통과 ${pass} / 실패 ${fail}`);
process.exit(fail?1:0);
