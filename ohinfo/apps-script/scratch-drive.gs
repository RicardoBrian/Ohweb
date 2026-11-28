/**
 * kaká 스크래치 — 학생 스크래치 파일(.sb3)을 선생님 구글 드라이브에 저장하는 Apps Script 웹앱.
 * 설정 방법: 같은 폴더 README-scratch.md
 *
 * 부르는 곳(둘 다 비밀값 secret 을 같이 보낸다 — 비밀값은 이 스크립트 속성과 Firestore kaka_config/scratch 에만 있다):
 *   - ohinfo 서버(/api/lesson): 학생 저장·불러오기. 학생 본인 확인·공개 차시 확인은 서버가 먼저 한다.
 *   - 선생님 화면(admin.kakainfo.com/k/): 시작 파일 올리기, 학생 작업 열어 보기.
 *
 * 동작:
 *   ping                 설정 확인
 *   register  {secret}   처음 한 번 — 비밀값을 정한다(이미 있으면 거절)
 *   save      {folders:[...], name, b64}  → {fileId}   새 파일로 저장
 *   load      {fileId}   → {b64, name}
 *   trash     {fileId}   휴지통으로(저장 기록에 안 남는 지난 자동 저장 파일)
 *
 * 폴더: 내 드라이브/kaká 스크래치/1학년 정보/3차시 반복문/2반 03 김하늘/0303 1415 저장.sb3
 */

var ROOT_FOLDER_NAME = 'kaká 스크래치';
var MAX_B64 = 20 * 1024 * 1024 * 4 / 3; // 파일 20MB 까지

function doGet() {
  return json_({ ok: true, app: 'kaka-scratch', ready: !!secret_() });
}

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (req.action === 'ping') return json_({ ok: true, ready: !!secret_() });
    if (req.action === 'register') return json_(register_(req.secret));
    if (!secret_() || req.secret !== secret_()) return json_({ error: '비밀값이 맞지 않습니다', code: 'auth' });
    switch (req.action) {
      case 'save': return json_(save_(req));
      case 'load': return json_(load_(req));
      case 'trash': return json_(trash_(req));
      default: return json_({ error: 'unknown action', code: 'badRequest' });
    }
  } catch (err) {
    return json_({ error: String((err && err.message) || err), code: 'server' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function secret_() {
  return PropertiesService.getScriptProperties().getProperty('SECRET') || '';
}

// 처음 연결할 때 선생님 화면이 만든 비밀값을 한 번만 받는다. 다시 정하려면 스크립트 속성 SECRET 을 지운다.
function register_(secret) {
  if (secret_()) return { error: '이미 연결되어 있습니다. 다시 연결하려면 스크립트 속성 SECRET 을 지우세요.', code: 'already' };
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(String(secret || ''))) return { error: '비밀값 형식', code: 'badRequest' };
  PropertiesService.getScriptProperties().setProperty('SECRET', secret);
  return { ok: true };
}

function root_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('ROOT_ID');
  if (id) { try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  var it = DriveApp.getRootFolder().getFoldersByName(ROOT_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(ROOT_FOLDER_NAME);
  props.setProperty('ROOT_ID', folder.getId());
  return folder;
}

function clean_(s) {
  return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '이름 없음';
}

function folderAt_(names) {
  var f = root_();
  (names || []).slice(0, 6).forEach(function (n) {
    n = clean_(n);
    var it = f.getFoldersByName(n);
    f = it.hasNext() ? it.next() : f.createFolder(n);
  });
  return f;
}

// 이 스크립트가 만든 폴더(kaká 스크래치) 안의 파일만 다룬다
function inRoot_(file) {
  var rootId = root_().getId();
  var seen = 0, parents = file.getParents();
  var queue = [];
  while (parents.hasNext()) queue.push(parents.next());
  while (queue.length && seen < 12) {
    var p = queue.shift(); seen++;
    if (p.getId() === rootId) return true;
    var up = p.getParents();
    while (up.hasNext()) queue.push(up.next());
  }
  return false;
}

function save_(req) {
  var b64 = String(req.b64 || '');
  if (!b64 || b64.length > MAX_B64) throw new Error('파일이 비었거나 너무 큽니다');
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/x.scratch.sb3', clean_(req.name).replace(/(\.sb3)?$/, '.sb3'));
  var file = folderAt_(req.folders).createFile(blob);
  return { fileId: file.getId(), bytes: blob.getBytes().length };
}

function fileOf_(fileId) {
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(String(fileId || ''))) throw new Error('파일 ID');
  var file = DriveApp.getFileById(fileId);
  if (!inRoot_(file)) throw new Error('kaká 스크래치 폴더의 파일이 아닙니다');
  return file;
}

function load_(req) {
  var file = fileOf_(req.fileId);
  return { b64: Utilities.base64Encode(file.getBlob().getBytes()), name: file.getName() };
}

function trash_(req) {
  fileOf_(req.fileId).setTrashed(true);
  return { ok: true };
}
