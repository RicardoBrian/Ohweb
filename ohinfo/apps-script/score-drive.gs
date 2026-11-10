/**
 * 수행평가 제출물 — 선생님 구글 드라이브의 제출 파일을 본인 학생에게만 보여주는 Apps Script 웹앱.
 * 배포 방법은 같은 폴더의 README.md 의 "수행평가 제출물" 참고.
 *
 * 부르는 곳:
 *   list  교사 화면(admin.kakainfo.com score.html) — 드라이브 폴더(하위 반 폴더 포함)의 파일 목록
 *   file  학생 화면(kakainfo.com score.html)·교사 화면 — 파일 한 개 내용
 *   ping  설정 확인용
 *
 * 보안: 페이지에 비밀값을 넣지 않는다. 부른 사람의 Firebase 로그인 토큰(idToken)으로
 * Firestore 문서를 직접 읽어 본다 — 읽히면 권한이 있는 것이다(판단은 Firestore 규칙이 한다).
 *   list: score_assessments/{평가ID} 를 읽을 수 있어야 한다 → 관리자(선생님)만.
 *   file: score_results/{결과ID} 를 읽을 수 있어야 하고(학생은 본인·공개된 것만),
 *         그 문서의 files 목록에 요청한 파일 ID 가 있어야 한다. files 는 선생님만 쓴다.
 * 그래서 파일을 "링크가 있는 모든 사용자"로 공유하지 않아도 되고, 주소를 알아도 남의 것은 못 받는다.
 */

var FIREBASE_PROJECT = 'ohweb-93062';
var MAX_BYTES = 15 * 1024 * 1024;   // 한 파일 최대
var MAX_FILES = 3000;               // list 한 번에 훑는 최대 파일 수
var MAX_DEPTH = 3;                  // 폴더 깊이(평가 폴더 → 반 폴더 → 파일)

function doGet() {
  return json_({ ok: true, app: 'score-drive' });
}

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (req.action) {
      case 'ping': return json_({ ok: true, app: 'score-drive' });
      case 'list': return json_(list_(req));
      case 'file': return json_(file_(req));
      default: return json_({ error: '알 수 없는 요청', code: 'badRequest' });
    }
  } catch (err) {
    var msg = String((err && err.message) || err);
    var code = /^\w+:/.test(msg) ? msg.split(':')[0] : 'server';
    return json_({ error: msg, code: code });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── 권한 확인: 토큰으로 Firestore 문서 읽기 ──
function canRead_(path, idToken) {
  if (!idToken) throw new Error('auth: 로그인 정보가 없습니다');
  var cache = CacheService.getScriptCache();
  var key = 'r_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken + '|' + path)).slice(0, 40);
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var doc = firestoreGet_(path, idToken);
  if (!doc) throw new Error('auth: 볼 수 있는 권한이 없습니다');
  try { cache.put(key, JSON.stringify(doc), 300); } catch (e) { /* 큰 문서는 캐시 안 함 */ }
  return doc;
}

function firestoreGet_(path, idToken) {
  var url = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents/' + path;
  var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + idToken }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  var doc = JSON.parse(res.getContentText());
  return fromFields_(doc.fields || {});
}
function fromValue_(v) {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(fromValue_);
  if (v.mapValue !== undefined) return fromFields_(v.mapValue.fields || {});
  return null;
}
function fromFields_(f) {
  var o = {};
  for (var k in f) o[k] = fromValue_(f[k]);
  return o;
}
function safeId_(s, what) {
  s = String(s || '');
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(s)) throw new Error('badRequest: ' + what);
  return s;
}

// ── list: 폴더 안 파일 목록 (교사) ──
function list_(req) {
  canRead_('score_assessments/' + safeId_(req.aid, '평가 ID'), req.idToken);
  var ids = (req.folders || []).map(function (f) { return folderId_(f); });
  if (!ids.length) throw new Error('badRequest: 폴더 주소가 없습니다');
  var out = [], folders = [];
  ids.forEach(function (id) {
    var folder;
    try { folder = DriveApp.getFolderById(id); } catch (e) { throw new Error('notFound: 폴더를 열 수 없습니다 (' + id + ')'); }
    folders.push({ id: id, name: folder.getName() });
    walk_(folder, folder.getName(), 0, out);
  });
  return { folders: folders, files: out, truncated: out.length >= MAX_FILES };
}
function folderId_(s) {
  s = String(s || '').trim();
  var m = s.match(/folders\/([A-Za-z0-9_-]+)/) || s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  return safeId_(m ? m[1] : s, '폴더 주소');
}
function walk_(folder, path, depth, out) {
  var it = folder.getFiles();
  while (it.hasNext() && out.length < MAX_FILES) {
    var f = it.next();
    out.push({ id: f.getId(), name: f.getName(), mimeType: f.getMimeType(), size: f.getSize(), path: path, created: f.getDateCreated().getTime() });
  }
  if (depth + 1 >= MAX_DEPTH) return;
  var sub = folder.getFolders();
  while (sub.hasNext() && out.length < MAX_FILES) {
    var c = sub.next();
    walk_(c, path + '/' + c.getName(), depth + 1, out);
  }
}

// ── file: 파일 한 개 (학생 본인·교사) ──
function file_(req) {
  var rid = safeId_(req.rid, '결과 ID');
  var fid = safeId_(req.fileId, '파일 ID');
  var doc = canRead_('score_results/' + rid, req.idToken);
  var ok = (doc.files || []).some(function (f) { return f && f.id === fid; });
  if (!ok) throw new Error('auth: 이 결과에 연결된 파일이 아닙니다');
  var file = DriveApp.getFileById(fid);
  var mime = file.getMimeType();
  var name = file.getName();
  // 구글 문서는 글자로
  if (mime === 'application/vnd.google-apps.document') {
    return { name: name, mimeType: mime, text: DocumentApp.openById(fid).getBody().getText() };
  }
  if (file.getSize() > MAX_BYTES) throw new Error('tooLarge: 파일이 너무 큽니다 (' + Math.round(file.getSize() / 1048576) + 'MB)');
  var blob = file.getBlob();
  if (/^text\//.test(mime)) return { name: name, mimeType: mime, text: blob.getDataAsString('UTF-8') };
  return { name: name, mimeType: mime, size: file.getSize(), data: Utilities.base64Encode(blob.getBytes()) };
}
