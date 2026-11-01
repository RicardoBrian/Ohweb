// 학기: 처음 설정(기존 데이터를 새 구조로 옮기기) · 학기 고르기(지난 학기는 읽기 전용) · 새 학기 시작
(function () {
  const { useState } = React;
  const { db, FieldValue, PATHS, AREAS, GRADES, toInt, studentKey, rosterId, guessTerm, termLabel, nextTerm,
    commitInChunks, toast, Icon, IconBtn, Modal, Empty } = window.GW;

  const TERM_RE = /^\d{4}-[12]$/;
  const newKey = () => Math.random().toString(36).slice(2, 10);
  // 가장 많이 나온 값
  const mode = (values) => {
    const m = new Map();
    values.filter((v) => v !== "" && v != null).forEach((v) => m.set(v, (m.get(v) || 0) + 1));
    return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  };

  // 학기(term)가 없는 예전 문서. 서버에서 다시 읽는다.
  async function legacyDocs(path) {
    const snap = await db.collection(path).get({ source: "server" });
    return snap.docs.filter((d) => !d.data().term);
  }

  // 학기가 없던 예전 데이터를 term 이 있는 새 구조로 옮긴다. 옮긴 결과(확인할 학생 목록)를 돌려준다.
  // 큰 컬렉션을 한 번에 다 못 읽는 경우가 있어, 예전 문서가 남지 않을 때까지 되풀이한다(다시 실행해도 안전).
  async function migrateLegacy(term) {
    const cur = await db.doc(PATHS.term).get({ source: "server" });
    if (!cur.exists || !cur.data().current) {
      await db.doc(PATHS.term).set({ current: term, terms: [term], updatedAt: FieldValue.serverTimestamp() });
    }
    const report = { roster: 0, roles: 0, students: 0, events: 0, mismatches: [], left: 0 };
    const idMap = {};
    const PASSES = 6;

    // 전교생 명단: 문서 ID 학년-반-번호 → 학기_학년-반-번호
    for (let pass = 0; pass < PASSES; pass++) {
      const docs = await legacyDocs(PATHS.roster);
      if (!docs.length) break;
      const ops = [];
      docs.forEach((d) => {
        const r = d.data();
        const id = rosterId(term, r.grade, r.klass, r.number);
        idMap[d.id] = id;
        ops.push((b) => b.set(db.collection(PATHS.roster).doc(id), { ...r, term, koreanName: r.koreanName || "" }));
        ops.push((b) => b.delete(d.ref));
      });
      await commitInChunks(ops);
      report.roster += docs.length;
    }

    // 교육과정 내 활동·출결 (출결의 불참 학생 ID도 새 명단 ID로)
    const rosterNewId = (id) => idMap[id] || (/^\d+-\d+-\d+$/.test(id) ? `${term}_${id}` : id);
    for (let pass = 0; pass < PASSES; pass++) {
      const [evs, atts] = await Promise.all([legacyDocs(PATHS.events), legacyDocs(PATHS.attendance)]);
      if (!evs.length && !atts.length) break;
      await commitInChunks([
        ...evs.map((d) => (b) => b.update(d.ref, { term })),
        ...atts.map((d) => (b) => b.update(d.ref, { term, absent: (d.data().absent || []).map(rosterNewId) })),
      ]);
      report.events += evs.length;
    }

    // 교육과정 외: 역할 이름(helperName)별로 역할을 만들고, 학생별 활동 내용·기간은 역할로 모은다.
    const setSnap = await db.doc(PATHS.certSettings).get().catch(() => null);
    const certRoles = (setSnap && setSnap.exists && setSnap.data().roles) || {};
    for (let pass = 0; pass < PASSES; pass++) {
      const legacy = (await legacyDocs(PATHS.students)).map((d) => ({ ref: d.ref, id: d.id, ...d.data() }));
      if (!legacy.length) break;
      // 앞선 회차에서 만든 역할은 이름으로 다시 쓴다.
      const existing = (await db.collection(PATHS.roles).where("term", "==", term).get({ source: "server" })).docs.map((d) => d.data());
      const byName = new Map();
      legacy.forEach((s) => {
        const n = (s.helperName || "").trim() || "(역할 없음)";
        if (!byName.has(n)) byName.set(n, []);
        byName.get(n).push(s);
      });
      const ops = [];
      let order = existing.length;
      byName.forEach((list, name) => {
        let role = existing.find((r) => r.name === name);
        if (!role) {
          const key = newKey();
          const setting = certRoles[name] || {};
          const periods = {};
          GRADES.forEach((g) => {
            const inGrade = list.filter((s) => +s.grade === g);
            const src = inGrade.length ? inGrade : list;
            periods[String(g)] = { start: mode(src.map((s) => s.activityStartDate)), end: mode(src.map((s) => s.activityEndDate)) };
          });
          const content = setting.content != null && setting.content !== "" ? setting.content : mode(list.map((s) => (s.activityContent || "").trim()));
          role = {
            term, key, name, content, area: AREAS.includes(setting.area) ? setting.area : AREAS[0],
            hours: toInt(mode(list.map((s) => s.originalHours ?? s.hours))) ?? 0, periods,
            teacherUid: "", teacherName: setting.teacher || "", order: order++,
          };
          const data = { ...role, createdAt: FieldValue.serverTimestamp() };
          ops.push((b) => b.set(db.collection(PATHS.roles).doc(`${term}_${role.key}`), data));
          report.roles++;
        }
        list.forEach((s) => {
          const p = (role.periods || {})[String(+s.grade)] || {};
          const diff = [];
          if ((s.activityContent || "").trim() && (s.activityContent || "").trim() !== role.content) diff.push(`활동 내용 "${s.activityContent}"`);
          if (s.activityStartDate && s.activityStartDate !== p.start) diff.push(`시작일 ${s.activityStartDate}`);
          if (s.activityEndDate && s.activityEndDate !== p.end) diff.push(`종료일 ${s.activityEndDate}`);
          if (diff.length) report.mismatches.push(`${s.grade}-${s.class}-${s.number} ${s.name} (${name}): ${diff.join(", ")}`);
          ops.push((b) => b.update(s.ref, {
            term, roleKey: role.key, helperName: name, rosterKey: studentKey(s.grade, s.class, s.number),
            neisName: s.neisName || s.name, activityContent: FieldValue.delete(), activityStartDate: FieldValue.delete(), activityEndDate: FieldValue.delete(),
          }));
          report.students++;
        });
      });
      await commitInChunks(ops);
    }

    for (let pass = 0; pass < PASSES; pass++) {
      const logs = await legacyDocs(PATHS.logs);
      if (!logs.length) break;
      await commitInChunks(logs.map((d) => (b) => b.update(d.ref, { term })));
    }

    // 그래도 남은 예전 문서가 있으면 알린다(다시 실행하면 이어서 옮긴다).
    const left = await Promise.all([PATHS.roster, PATHS.students, PATHS.events, PATHS.attendance, PATHS.logs].map(legacyDocs));
    report.left = left.reduce((n, l) => n + l.length, 0);
    return report;
  }

  // 관리자: 학기 설정이 아직 없을 때(처음 한 번)
  function TermSetup({ onDone }) {
    const [term, setTerm] = useState(guessTerm());
    const [busy, setBusy] = useState(false);
    const [report, setReport] = useState(null);
    const run = async () => {
      if (!TERM_RE.test(term)) return toast("학기는 2026-2처럼 적어 주세요.", "danger");
      setBusy(true);
      try {
        setReport(await migrateLegacy(term));
      } catch (err) {
        console.error(err);
        toast("옮기다가 멈췄습니다. 새로고침한 뒤 다시 시도하세요.", "danger");
      }
      setBusy(false);
    };
    if (report) {
      return (
        <div className="card card-pad" style={{ maxWidth: "40rem" }}>
          <div className="card-title">{termLabel(term)}로 시작했습니다</div>
          <ul className="muted" style={{ fontSize: "0.875rem", margin: "0.75rem 0", paddingLeft: "1.1rem", listStyle: "disc" }}>
            <li>전교생 명단 {report.roster}명, 교육과정 내 활동 {report.events}건을 옮겼습니다.</li>
            <li>도우미 {report.students}명을 역할 {report.roles}개로 묶었습니다.</li>
          </ul>
          {report.left > 0 && (
            <div className="notice notice-danger" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
              아직 옮기지 못한 예전 기록이 {report.left}건 남았습니다. <button className="btn btn-sm" onClick={run}>이어서 옮기기</button>
            </div>
          )}
          {report.mismatches.length > 0 && (
            <div className="notice notice-warn" style={{ fontSize: "0.85rem" }}>
              <strong>역할 기간·내용과 달랐던 학생 {report.mismatches.length}명</strong> — 역할 값으로 맞췄습니다. 필요하면 역할을 고쳐 주세요.
              <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem", listStyle: "disc" }}>{report.mismatches.slice(0, 30).map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}
          <div className="flex justify-end mt-3"><IconBtn icon="ok" label="시작하기" primary tipLeft onClick={() => onDone(term)} /></div>
        </div>
      );
    }
    return (
      <div className="card card-pad" style={{ maxWidth: "40rem" }}>
        <div className="card-title">학기 설정</div>
        <p className="muted" style={{ fontSize: "0.875rem" }}>
          이제 모든 기록을 학기별로 보관합니다. 지금 학기를 정하면 지금까지의 명단·도우미·활동 기록이 이 학기로 옮겨지고,
          도우미의 활동 내용·기간은 역할별로 묶입니다(학년별 기간은 그 학년 학생에게 가장 많이 쓴 값).
        </p>
        <div className="flex items-end gap-2 mt-3">
          <div><label className="field-label">지금 학기</label><input className="inp num" style={{ width: "8rem" }} value={term} onChange={(e) => setTerm(e.target.value.trim())} placeholder="2026-2" /></div>
          <span className="muted" style={{ paddingBottom: "0.55rem" }}>{termLabel(term)}</span>
          <IconBtn icon="ok" label="이 학기로 시작" primary className="ml-auto" disabled={busy} onClick={run} tipLeft />
        </div>
        {busy && <p className="field-hint">옮기는 중입니다. 창을 닫지 마세요…</p>}
      </div>
    );
  }

  // 새 학기 시작: 지금 학기는 보관(읽기 전용)되고 새 학기가 비어서 시작한다.
  function RolloverModal({ current, terms, onClose, onDone }) {
    const [term, setTerm] = useState(nextTerm(current));
    const [copyRoles, setCopyRoles] = useState(true);
    const [copyRoster, setCopyRoster] = useState(String(current).slice(0, 4) === String(nextTerm(current)).slice(0, 4));
    const [busy, setBusy] = useState(false);
    const run = async () => {
      if (!TERM_RE.test(term)) return toast("학기는 2026-2처럼 적어 주세요.", "danger");
      if (terms.includes(term)) return toast("이미 있는 학기입니다.", "danger");
      if (!window.confirm(`${termLabel(current)}를 마감하고 ${termLabel(term)}를 시작합니다. 마감한 학기는 고칠 수 없습니다. 계속할까요?`)) return;
      setBusy(true);
      try {
        const [roles, roster] = await Promise.all([
          copyRoles ? db.collection(PATHS.roles).where("term", "==", current).get() : null,
          copyRoster ? db.collection(PATHS.roster).where("term", "==", current).get() : null,
        ]);
        await db.doc(PATHS.term).set({ current: term, terms: FieldValue.arrayUnion(term), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        const ops = [];
        // 역할은 이름·내용·담당 교사를 이어 가고, 기간은 새 학기에 맞게 다시 적는다.
        if (roles) roles.docs.forEach((d) => {
          const r = d.data();
          ops.push((b) => b.set(db.collection(PATHS.roles).doc(`${term}_${r.key}`), {
            ...r, term, periods: Object.fromEntries(GRADES.map((g) => [String(g), { start: "", end: "" }])),
            createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
          }));
        });
        if (roster) roster.docs.forEach((d) => {
          const r = d.data();
          ops.push((b) => b.set(db.collection(PATHS.roster).doc(rosterId(term, r.grade, r.klass, r.number)), { ...r, term, updatedAt: FieldValue.serverTimestamp() }));
        });
        await commitInChunks(ops);
        toast(`${termLabel(term)}를 시작했습니다.`);
        onDone(term);
      } catch (err) {
        console.error(err);
        toast("새 학기를 시작하지 못했습니다.", "danger");
      }
      setBusy(false);
    };
    return (
      <Modal title="새 학기 시작" sub={`${termLabel(current)}는 보관되어 읽기 전용이 됩니다. 언제든 학기를 골라 다시 보고 출력할 수 있습니다.`} onClose={onClose} width={480}
        footer={<IconBtn icon="ok" label={`${termLabel(term)} 시작`} primary tipLeft disabled={busy} onClick={run} />}>
        <div className="fields">
          <div className="flex items-end gap-2">
            <div><label className="field-label">새 학기</label><input className="inp num" style={{ width: "8rem" }} value={term} onChange={(e) => setTerm(e.target.value.trim())} /></div>
            <span className="muted" style={{ paddingBottom: "0.55rem" }}>{termLabel(term)}</span>
          </div>
          <label className="flex items-center gap-2" style={{ fontSize: "0.9rem" }}>
            <input type="checkbox" checked={copyRoles} onChange={(e) => setCopyRoles(e.target.checked)} />
            역할 이어 가기 <span className="faint">(이름·내용·담당 교사, 기간은 비움, 배정 학생은 비움)</span>
          </label>
          <label className="flex items-center gap-2" style={{ fontSize: "0.9rem" }}>
            <input type="checkbox" checked={copyRoster} onChange={(e) => setCopyRoster(e.target.checked)} />
            전교생 명단 이어 가기 <span className="faint">(같은 학년도 2학기일 때)</span>
          </label>
          {busy && <p className="field-hint">준비하는 중입니다…</p>}
        </div>
      </Modal>
    );
  }

  // 사이드바 위쪽 학기 표시·고르기
  function TermSwitcher({ info, view, onView, isAdmin }) {
    const [open, setOpen] = useState(false);
    const terms = [...(info.terms || [info.current])].sort().reverse();
    return (
      <div className="term-switch">
        <select className="inp" value={view} onChange={(e) => onView(e.target.value)} aria-label="학기">
          {terms.map((t) => <option key={t} value={t}>{termLabel(t)}{t === info.current ? "" : " (보관)"}</option>)}
        </select>
        {isAdmin && <IconBtn icon="calendarPlus" label="새 학기 시작" small tipLeft onClick={() => setOpen(true)} />}
        {open && <RolloverModal current={info.current} terms={terms} onClose={() => setOpen(false)} onDone={(t) => { setOpen(false); onView(t); }} />}
      </div>
    );
  }

  const ArchiveBanner = ({ term, current, onBack }) => (
    <div className="notice notice-warn archive-banner">
      <Icon name="lock" size={15} />
      <span><strong>{termLabel(term)}</strong>는 보관된 학기라 보기만 할 수 있습니다.</span>
      <button className="btn btn-sm ml-auto" onClick={onBack}>{termLabel(current)}로</button>
    </div>
  );

  Object.assign(window.GW, { TermSetup, TermSwitcher, ArchiveBanner });
})();
