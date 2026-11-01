// 로그인 · 가입 신청 · 승인 대기 · 교사 관리(관리자)
(function () {
  const { useState, useMemo } = React;
  const { db, auth, FieldValue, CONTACT, PATHS, toInt, classLabel, fmtTime, toast, useCollection,
    Icon, IconBtn, Modal, Inspector, PageHead, Empty, Seg, GradeClassSelect } = window.GW;

  const GoogleMark = () => (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );

  const sortRoles = (list) => [...list].sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.name).localeCompare(String(b.name), "ko"));

  // 담당 역할 고르기(여러 개). roles: 지금 학기 역할 목록
  function RolePicker({ roles, value, onChange, owners }) {
    if (!roles || !roles.length) return <p className="field-hint" style={{ marginTop: 0 }}>{roles === null ? "불러오는 중…" : "아직 등록된 역할이 없습니다."}</p>;
    return (
      <div className="chips">
        {roles.map((r) => {
          const on = value.includes(r.key);
          const other = owners && owners[r.key];
          return (
            <button key={r.key} type="button" className="btn btn-sm" aria-pressed={on} title={other ? `지금 담당: ${other}` : undefined}
              onClick={() => onChange(on ? value.filter((k) => k !== r.key) : [...value, r.key])}>
              {r.name}{other && <span style={{ opacity: 0.7, fontWeight: 500 }}> · {other}</span>}
            </button>
          );
        })}
      </div>
    );
  }

  function AuthShell({ children, sub }) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <div className="auth-head">
            <img src="logo.png" alt="" className="auth-logo" onError={(e) => { e.target.style.display = "none"; }} />
            <div className="auth-word">봉사활동 관리</div>
            <div className="auth-sub">{sub || "관산중학교"}</div>
          </div>
          {children}
        </div>
      </div>
    );
  }

  const Contact = ({ children }) => (
    <div className="contact">
      {children || "처음 쓰시거나 접속이 안 되면"} <strong>{CONTACT.who}</strong>께 {CONTACT.how}로 연락해 주세요.
    </div>
  );

  function LoginScreen() {
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const signIn = async () => {
      setBusy(true);
      setError("");
      try {
        await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
      } catch (err) {
        console.error("구글 로그인 실패:", err);
        if (err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") {
          setError("Google 로그인에 실패했습니다. 다시 시도해 주세요.");
        }
      }
      setBusy(false);
    };
    return (
      <AuthShell>
        <button onClick={signIn} disabled={busy} className="btn btn-block google-btn">
          <GoogleMark /> Google 계정으로 로그인
        </button>
        {error && <p className="field-error text-center">{error}</p>}
        <p className="text-center muted" style={{ fontSize: "0.8125rem", marginTop: "0.875rem" }}>
          처음 로그인하면 이름과 담임 학급을 적어 가입 신청을 합니다.<br />담당 선생님이 승인하면 쓸 수 있습니다.
        </p>
        <Contact />
      </AuthShell>
    );
  }

  // 가입 신청 / 승인 대기 / 거절. teacher: teachers/{uid} 문서(없으면 null)
  function ApplyScreen({ user, teacher, term }) {
    const roles = useCollection(term ? PATHS.roles : null, sortRoles, term);
    const [myRoles, setMyRoles] = useState(teacher?.roles || []);
    const [editing, setEditing] = useState(!teacher);
    const [name, setName] = useState(teacher?.name || user.displayName || "");
    const [homeroom, setHomeroom] = useState(teacher ? !!teacher.homeroom : true);
    const [grade, setGrade] = useState(teacher?.grade || null);
    const [klass, setKlass] = useState(teacher?.klass || null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
      e.preventDefault();
      if (!name.trim()) return setError("이름을 입력하세요.");
      if (homeroom && (!grade || !klass)) return setError("담임 학급(학년·반)을 고르세요.");
      setBusy(true);
      try {
        const data = {
          name: name.trim(),
          email: user.email,
          homeroom,
          roles: myRoles,
          status: "pending",
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (homeroom) Object.assign(data, { grade, klass });
        if (!teacher) data.createdAt = FieldValue.serverTimestamp();
        // 담임이 아니게 바뀌면 예전 학급 값을 지운다.
        await db.collection("teachers").doc(user.uid).set(
          homeroom ? data : { ...data, grade: FieldValue.delete(), klass: FieldValue.delete() },
          { merge: true }
        );
        setEditing(false);
      } catch (err) {
        console.error("가입 신청 실패:", err);
        setError("신청을 저장하지 못했습니다. 잠시 후 다시 시도하세요.");
      }
      setBusy(false);
    };

    const who = <p className="text-center muted" style={{ fontSize: "0.8125rem", margin: "0 0 1rem" }}>{user.email}</p>;
    const signOut = <button onClick={() => auth.signOut()} className="btn btn-ghost btn-sm">다른 계정으로 로그인</button>;

    if (!editing && teacher) {
      const rejected = teacher.status === "rejected";
      return (
        <AuthShell sub={rejected ? "승인되지 않았습니다" : "승인을 기다리는 중입니다"}>
          {who}
          <div className="notice" style={{ fontSize: "0.875rem" }}>
            <div><span className="muted">이름</span> <strong>{teacher.name}</strong></div>
            <div><span className="muted">담임</span> <strong>{teacher.homeroom ? classLabel(teacher.grade, teacher.klass) : "비담임"}</strong></div>
            {teacher.roles && teacher.roles.length > 0 && <div><span className="muted">담당 역할</span> <strong>{teacher.roles.length}개</strong></div>}
          </div>
          <Contact>{rejected ? "신청 내용을 고쳐 다시 신청하거나" : "승인이 늦어지면"}</Contact>
          <div className="flex justify-center gap-2 mt-4">
            <button onClick={() => setEditing(true)} className="btn btn-sm">{rejected ? "다시 신청" : "신청 내용 고치기"}</button>
            {signOut}
          </div>
        </AuthShell>
      );
    }

    return (
      <AuthShell sub="가입 신청">
        {who}
        <form onSubmit={submit} className="fields">
          <div>
            <label className="field-label" htmlFor="ap-name">이름</label>
            <input id="ap-name" className="inp" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} maxLength={30} autoFocus />
            <p className="field-hint">확인서의 확인자 칸에 이 이름이 들어갑니다.</p>
          </div>
          <div>
            <span className="field-label">담임</span>
            <Seg value={homeroom ? "y" : "n"} options={[["y", "담임"], ["n", "비담임"]]} onChange={(v) => { setHomeroom(v === "y"); setError(""); }} />
          </div>
          {homeroom && (
            <div>
              <span className="field-label">담임 학급</span>
              <GradeClassSelect grade={grade} klass={klass} onChange={(g, k) => { setGrade(g); setKlass(k); setError(""); }} />
            </div>
          )}
          <div>
            <span className="field-label">담당 역할 <span className="faint" style={{ fontWeight: 400 }}>(교육과정 외 봉사, 없으면 비워 두세요)</span></span>
            <RolePicker roles={roles} value={myRoles} onChange={setMyRoles} />
          </div>
          {error && <p className="field-error" style={{ marginTop: 0 }}>{error}</p>}
          <button type="submit" disabled={busy} className="btn btn-primary btn-block">{teacher ? "다시 신청" : "가입 신청"}</button>
        </form>
        <div className="flex justify-center gap-2 mt-3">
          {teacher && <button onClick={() => setEditing(false)} className="btn btn-ghost btn-sm">취소</button>}
          {signOut}
        </div>
        <Contact>승인이 필요하면</Contact>
      </AuthShell>
    );
  }

  // ---------- 도장 ----------
  // 도장 사진·스캔을 받아 흰 바탕을 투명하게 만들고, 여백을 잘라 작은 PNG(data URL)로 만든다.
  // 교사 문서에 그대로 저장하므로(문서 한도 1MB) 크기를 줄인다.
  async function makeStamp(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("그림 파일을 열지 못했습니다.")); i.src = url; });
      for (const max of [320, 220, 160]) {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h);
        const px = data.data;
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const light = (px[i] + px[i + 1] + px[i + 2]) / 3;
          // 밝은 바탕은 투명하게, 중간 밝기는 반투명하게
          const a = light >= 235 ? 0 : light <= 185 ? px[i + 3] : Math.round(px[i + 3] * (235 - light) / 50);
          px[i + 3] = a;
          if (a > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 < 0) throw new Error("도장 모양을 찾지 못했습니다. 흰 바탕에 찍힌 도장 사진을 올려 주세요.");
        ctx.putImageData(data, 0, 0);
        const pad = 4;
        const cw = Math.min(w, x1 - x0 + 1 + pad * 2), ch = Math.min(h, y1 - y0 + 1 + pad * 2);
        const out = document.createElement("canvas");
        out.width = cw; out.height = ch;
        out.getContext("2d").drawImage(c, Math.max(0, x0 - pad), Math.max(0, y0 - pad), cw, ch, 0, 0, cw, ch);
        const dataUrl = out.toDataURL("image/png");
        if (dataUrl.length < 190000) return dataUrl;
      }
      throw new Error("그림이 너무 복잡합니다. 도장 부분만 잘라서 올려 주세요.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // 도장 미리보기 + 올리기·지우기 버튼
  function StampField({ stamp, name, onChange }) {
    const pick = async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try { onChange(await makeStamp(file)); } catch (err) { toast(err.message, "danger"); }
    };
    return (
      <div className="stamp-field">
        <div className="stamp-preview">
          <span>확인자 : 담임 {Array.from(name || "").join(" ")}</span>
          <span className="stamp-in">(인){stamp && <img src={stamp} alt="도장" />}</span>
        </div>
        <div className="flex gap-1.5">
          <label className="btn btn-icon" aria-label="도장 그림 올리기" data-tip="도장 그림 올리기">
            <Icon name="upload" />
            <input type="file" accept="image/*" className="hidden" onChange={pick} />
          </label>
          {stamp && <IconBtn icon="trash" label="도장 지우기" ghost danger onClick={() => onChange("")} />}
        </div>
      </div>
    );
  }

  function StampModal({ uid, name, stamp, onClose }) {
    const [value, setValue] = useState(stamp);
    const [busy, setBusy] = useState(false);
    const save = async () => {
      setBusy(true);
      try {
        await db.collection("teachers").doc(uid).update(value
          ? { stamp: value, stampUpdatedAt: FieldValue.serverTimestamp() }
          : { stamp: FieldValue.delete(), stampUpdatedAt: FieldValue.serverTimestamp() });
        toast(value ? "도장을 저장했습니다." : "도장을 지웠습니다.");
        onClose();
      } catch (err) {
        console.error(err);
        toast("저장하지 못했습니다.", "danger");
      }
      setBusy(false);
    };
    return (
      <Modal title="내 도장" sub="교육과정 내 봉사활동 확인서의 (인) 자리에 찍힙니다." onClose={onClose} width={440}
        footer={<IconBtn icon="ok" label="저장" primary disabled={busy || value === stamp} onClick={save} />}>
        <StampField stamp={value} name={name} onChange={setValue} />
        <p className="field-hint">흰 종이에 찍은 도장을 사진으로 찍거나 스캔해 올리세요. 흰 바탕은 자동으로 투명해집니다.</p>
      </Modal>
    );
  }

  // ---------- 교사 관리(관리자) ----------
  const STATUS = {
    pending: ["승인 대기", "badge-warn"],
    approved: ["승인", "badge-ok"],
    rejected: ["거절", "badge-danger"],
  };

  function TeachersPage({ teachers, term, readOnly }) {
    const roles = useCollection(PATHS.roles, sortRoles, term);
    const roleNames = (t) => (roles || []).filter((r) => r.teacherUid === t.id).map((r) => r.name);
    const [filter, setFilter] = useState("pending");
    const [selId, setSelId] = useState(null);
    const list = teachers || [];
    const pending = list.filter((t) => t.status === "pending").length;
    const shown = useMemo(() => {
      const rows = filter === "all" ? list : list.filter((t) => t.status === filter);
      return [...rows].sort((a, b) =>
        (a.homeroom === b.homeroom ? 0 : a.homeroom ? -1 : 1) ||
        ((a.grade || 99) - (b.grade || 99)) || ((a.klass || 99) - (b.klass || 99)) ||
        String(a.name).localeCompare(String(b.name), "ko"));
    }, [list, filter]);
    const sel = list.find((t) => t.id === selId) || null;

    // 같은 학급에 승인된 담임이 둘 이상이면 표시
    const dupClass = useMemo(() => {
      const m = new Map();
      list.filter((t) => t.status === "approved" && t.homeroom).forEach((t) => {
        const k = `${t.grade}-${t.klass}`;
        m.set(k, (m.get(k) || 0) + 1);
      });
      return new Set([...m].filter(([, n]) => n > 1).map(([k]) => k));
    }, [list]);

    return (
      <>
        <PageHead title="교사 관리" sub={`가입한 교사 ${list.length}명${pending ? ` · 승인 대기 ${pending}명` : ""}`} />
        <div className="split">
          <div className="card min-w-0" style={{ overflow: "hidden" }}>
            <div className="toolbar" style={{ borderBottom: "0.5px solid var(--hairline)" }}>
              <Seg value={filter} onChange={setFilter} options={[["pending", `승인 대기 ${pending}`], ["approved", "승인"], ["rejected", "거절"], ["all", "전체"]]} />
            </div>
            {teachers === null ? <Empty title="불러오는 중…" /> : shown.length === 0 ? (
              <Empty title={filter === "pending" ? "승인을 기다리는 신청이 없습니다." : "해당하는 교사가 없습니다."} />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>담임 학급</th>
                    <th className="col-wide">담당 역할</th>
                    <th className="col-wide">이메일</th>
                    <th>상태</th>
                    <th className="col-wide">도장</th>
                    <th className="col-xwide">신청</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.id} className={`row-open ${selId === t.id ? "selected" : ""}`} tabIndex={0}
                      onClick={() => setSelId(t.id)} onKeyDown={(e) => e.key === "Enter" && setSelId(t.id)}>
                      <td className="font-semibold">{t.name}</td>
                      <td className="num whitespace-nowrap">
                        {t.homeroom ? classLabel(t.grade, t.klass) : <span className="faint">비담임</span>}
                        {t.homeroom && t.status === "approved" && dupClass.has(`${t.grade}-${t.klass}`) && <span className="badge badge-warn ml-1">중복</span>}
                      </td>
                      <td className="col-wide">{roleNames(t).join(", ") || (t.status === "pending" && (t.roles || []).length ? <span className="faint">신청 {(t.roles || []).length}개</span> : <span className="faint">–</span>)}</td>
                      <td className="col-wide muted">{t.email}</td>
                      <td><span className={`badge ${STATUS[t.status]?.[1] || ""}`}>{STATUS[t.status]?.[0] || t.status}</span></td>
                      <td className="col-wide">{t.stamp ? <img src={t.stamp} alt="도장" style={{ height: "1.6rem" }} /> : <span className="faint">–</span>}</td>
                      <td className="col-xwide muted num">{fmtTime(t.updatedAt || t.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <TeacherEditor key={sel ? sel.id : "none"} t={sel} roles={roles} term={term} readOnly={readOnly} onClose={() => setSelId(null)} />
        </div>
      </>
    );
  }

  function TeacherEditor({ t, roles, term, readOnly, onClose }) {
    const roleList = roles || [];
    // 지금 맡은 역할 + (승인 전이면) 신청한 역할
    const [myRoles, setMyRoles] = useState(() => {
      const own = roleList.filter((r) => t && r.teacherUid === t.id).map((r) => r.key);
      const asked = t && t.status !== "approved" ? (t.roles || []) : [];
      return [...new Set([...own, ...asked])].filter((k) => roleList.some((r) => r.key === k));
    });
    const owners = Object.fromEntries(roleList.filter((r) => r.teacherUid && t && r.teacherUid !== t.id).map((r) => [r.key, r.teacherName]));
    const [name, setName] = useState(t?.name || "");
    const [homeroom, setHomeroom] = useState(!!t?.homeroom);
    const [grade, setGrade] = useState(t?.grade || null);
    const [klass, setKlass] = useState(t?.klass || null);
    const [stamp, setStamp] = useState(t?.stamp || "");
    const [busy, setBusy] = useState(false);

    const save = async (status) => {
      if (!name.trim()) return toast("이름을 입력하세요.", "danger");
      if (homeroom && (!grade || !klass)) return toast("담임 학급을 고르세요.", "danger");
      setBusy(true);
      try {
        const taken = myRoles.filter((k) => owners[k]);
        if (status === "approved" && taken.length && !window.confirm(`${taken.map((k) => `${roleList.find((r) => r.key === k).name}(지금 ${owners[k]})`).join(", ")}의 담당 교사를 ${name.trim()} 선생님으로 바꿉니다. 계속할까요?`)) { setBusy(false); return; }
        const batch = db.batch();
        batch.set(db.collection("teachers").doc(t.id), {
          name: name.trim(),
          homeroom,
          grade: homeroom ? grade : FieldValue.delete(),
          klass: homeroom ? klass : FieldValue.delete(),
          roles: myRoles,
          status,
          updatedAt: FieldValue.serverTimestamp(),
          ...(stamp !== (t.stamp || "") ? { stamp: stamp || FieldValue.delete(), stampUpdatedAt: FieldValue.serverTimestamp() } : {}),
        }, { merge: true });
        // 역할 담당 교사(역할당 1명)는 역할 문서에 적는다. 승인할 때만 넘겨주고, 거절하면 이 교사가 맡던 역할을 비운다.
        if (!readOnly) {
          roleList.forEach((r) => {
            const want = status === "approved" && myRoles.includes(r.key);
            const ref = db.collection(PATHS.roles).doc(r.id);
            if (want && (r.teacherUid !== t.id || r.teacherName !== name.trim())) batch.update(ref, { teacherUid: t.id, teacherName: name.trim() });
            else if (!want && r.teacherUid === t.id) batch.update(ref, { teacherUid: "", teacherName: "" });
          });
        }
        await batch.commit();
        toast(status === "approved" ? `${name} 선생님을 승인했습니다.` : status === "rejected" ? "거절했습니다." : "저장했습니다.");
      } catch (err) {
        console.error(err);
        toast("저장하지 못했습니다.", "danger");
      }
      setBusy(false);
    };
    const remove = async () => {
      if (!window.confirm(`${t.name} 선생님의 가입 정보를 지울까요? 다시 로그인하면 새로 신청하게 됩니다.`)) return;
      const batch = db.batch();
      batch.delete(db.collection("teachers").doc(t.id));
      if (!readOnly) roleList.filter((r) => r.teacherUid === t.id).forEach((r) => batch.update(db.collection(PATHS.roles).doc(r.id), { teacherUid: "", teacherName: "" }));
      await batch.commit();
      toast("지웠습니다.");
      onClose();
    };

    return (
      <Inspector
        open={!!t}
        title={t ? t.name : ""}
        sub={t ? t.email : ""}
        onClose={onClose}
        placeholder={
          <div className="panel-body" style={{ paddingTop: "1.25rem" }}>
            <div className="card-title" style={{ marginBottom: "0.5rem" }}>승인 방법</div>
            <ol className="muted" style={{ fontSize: "0.875rem", paddingLeft: "1.1rem", margin: 0, listStyle: "decimal" }}>
              <li>선생님이 Google로 로그인해 이름과 담임 학급을 적어 신청합니다.</li>
              <li>여기서 줄을 눌러 학급을 확인하고 승인합니다.</li>
              <li>담임은 자기 반 명단·출결만, 비담임은 교육과정 외 도우미만 다룰 수 있습니다.</li>
            </ol>
          </div>
        }
        footer={t && (
          <>
            <IconBtn icon="trash" label="가입 정보 삭제" ghost danger className="mr-auto" disabled={busy} onClick={remove} />
            {t.status !== "rejected" && <IconBtn icon="ban" label="거절" disabled={busy} onClick={() => save("rejected")} />}
            <IconBtn icon="ok" label={t.status === "approved" ? "저장" : "승인"} primary disabled={busy} onClick={() => save("approved")} tipLeft />
          </>
        )}
      >
        {t && (
          <div className="fields">
            <div>
              <span className={`badge ${STATUS[t.status]?.[1] || ""}`}>{STATUS[t.status]?.[0]}</span>
            </div>
            <div>
              <label className="field-label">이름</label>
              <input className="inp" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
            </div>
            <div>
              <span className="field-label">담임</span>
              <Seg value={homeroom ? "y" : "n"} options={[["y", "담임"], ["n", "비담임"]]} onChange={(v) => setHomeroom(v === "y")} />
            </div>
            {homeroom && (
              <div>
                <span className="field-label">담임 학급</span>
                <GradeClassSelect grade={grade} klass={klass} onChange={(g, k) => { setGrade(g); setKlass(k); }} />
              </div>
            )}
            <div>
              <span className="field-label">담당 역할</span>
              <RolePicker roles={roles} value={myRoles} onChange={setMyRoles} owners={owners} />
            </div>
            {(
              <div>
                <span className="field-label">도장</span>
                <StampField stamp={stamp} name={name} onChange={setStamp} />
              </div>
            )}
          </div>
        )}
      </Inspector>
    );
  }

  Object.assign(window.GW, { LoginScreen, ApplyScreen, TeachersPage, StampModal });
})();
