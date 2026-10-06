/**
 * AI 실험실 — 학생 사진을 선생님 구글 드라이브에 저장하는 Apps Script 웹앱.
 * 배포 방법은 같은 폴더의 README.md 참고.
 *
 * 학생 화면(ohinfo ailab.html)이 부르는 동작:
 *   upload  사진 한 장 저장(이미 512px JPG로 줄여서 온다)
 *   delete  학생이 지운 사진을 휴지통으로
 *   fetch   대표 PC가 학습할 사진을 받아 간다
 *   saveModel / getModel  실험실에서 학습한 모델 저장(대표만) · 불러오기(짝, 공개 웹앱은 배포 번호만)
 *   zip     학습용 사진을 레이블 폴더별로 묶어 돌려준다(예전 티처블머신 방식용)
 *   ping    설정 확인용
 *
 * 보안: 페이지에 비밀값을 넣지 않는다. 학생의 Firebase 로그인 토큰(idToken)으로
 * Firestore의 그 프로젝트 문서를 읽어 본다 — Firestore 보안 규칙이 "그 짝의 학생만"
 * 읽게 막고 있으므로, 읽히면 그 짝이 맞다. 다른 사람은 주소를 알아도 올리지 못한다.
 *
 * 폴더: 내 드라이브/AI실험실/관산중 1학년 4반/3짝 (김가람, 이나래) 1번째 모델 [프로젝트ID]/1_사과/…
 */

var FIREBASE_PROJECT = 'ohweb-93062';
var ROOT_FOLDER_NAME = 'AI실험실';
var MAX_BYTES = 3 * 1024 * 1024;   // 한 장 최대(줄인 사진은 보통 30~60KB)
var MAX_ZIP_FILES = 600;

function doGet() {
  return json_({ ok: true, app: 'ailab-drive' });
}

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (req.action === 'ping') return json_({ ok: true });
    // 공개 웹앱은 로그인 없이 모델을 불러온다(배포된 버전만) — 본인 확인 전에 처리.
    if (req.action === 'getModel' && !req.idToken) return json_(getPublicModel_(req));
    var info = verify_(req.idToken, req.pid, false);
    switch (req.action) {
      case 'upload': return json_(upload_(req, info));
      case 'delete': return json_(remove_(req, info));
      case 'zip': return json_(zip_(req, info));
      case 'fetch': return json_(fetchPhotos_(req, info));
      case 'saveModel': return json_(saveModel_(req, info));
      case 'getModel': return json_(readModel_(info, req.version));
      default: return json_({ error: 'unknown action', code: 'badRequest' });
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

// ── 본인 확인 + 프로젝트 정보 ──
function verify_(idToken, pid, noCache) {
  if (!idToken) throw new Error('auth: 로그인 정보가 없습니다');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(pid || ''))) throw new Error('badRequest: 프로젝트 ID');
  var cache = CacheService.getScriptCache();
  var key = 'v_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken + '|' + pid)).slice(0, 40);
  if (!noCache) {
    var hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  }
  var proj = firestoreGet_('ai_projects/' + pid, idToken);
  if (!proj) throw new Error('auth: 이 프로젝트의 짝이 아닙니다');
  var info = {
    pid: pid,
    pairId: proj.pairId || '',
    round: proj.round || 1,
    school: proj.schoolName || '',
    grade: proj.grade || '',
    cls: proj['class'] || '',
    labels: (proj.labels || []).map(function (l) { return { id: l.id, name: l.name }; }),
    pairNo: '',
    names: [],
  };
  var pair = info.pairId ? firestoreGet_('ai_pairs/' + info.pairId, idToken) : null;
  if (pair) {
    info.pairNo = pair.no || '';
    var mn = pair.memberNames || {};
    info.names = (pair.members || []).map(function (id) { return mn[id] || id; });
  }
  cache.put(key, JSON.stringify(info), 300);
  return info;
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

// ── 폴더 ──
function safeName_(s) {
  return String(s || '').replace(/[\\\/:*?"<>|\[\]]/g, '_').trim().slice(0, 60) || '_';
}

function childFolder_(parent, name, marker) {
  // marker가 있으면 설명(description)에 적어 두고 그걸로 찾는다(이름이 바뀌어도 같은 폴더).
  var it = parent.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    if (marker ? f.getDescription() === marker : f.getName() === name) return f;
  }
  var created = parent.createFolder(name);
  if (marker) created.setDescription(marker);
  return created;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function projectFolder_(info) {
  var cache = CacheService.getScriptCache();
  var key = 'pf_' + info.pid;
  var id = cache.get(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 지워졌으면 다시 만든다 */ } }
  return withLock_(function () {
    var roots = DriveApp.getRootFolder().getFoldersByName(ROOT_FOLDER_NAME);
    var root = roots.hasNext() ? roots.next() : DriveApp.getRootFolder().createFolder(ROOT_FOLDER_NAME);
    var cls = childFolder_(root, safeName_(info.school + ' ' + info.grade + '학년 ' + info.cls + '반'));
    var title = safeName_((info.pairNo ? info.pairNo + '짝 ' : '') + (info.names.length ? '(' + info.names.join(', ') + ') ' : '') + info.round + '번째 모델');
    var pf = childFolder_(cls, title + ' [' + info.pid + ']', 'pid=' + info.pid);
    cache.put(key, pf.getId(), 21600);
    return pf;
  });
}

function labelFolder_(info, labelId) {
  var idx = -1;
  for (var i = 0; i < info.labels.length; i++) if (info.labels[i].id === labelId) idx = i;
  if (idx < 0) throw new Error('badLabel: 없는 레이블');
  var cache = CacheService.getScriptCache();
  var key = 'lf_' + info.pid + '_' + labelId;
  var id = cache.get(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 다시 찾는다 */ } }
  var pf = projectFolder_(info);
  return withLock_(function () {
    var lf = childFolder_(pf, safeName_((idx + 1) + '_' + info.labels[idx].name), 'label=' + labelId);
    cache.put(key, lf.getId(), 21600);
    return lf;
  });
}

// ── 동작 ──
function upload_(req, info) {
  var b64 = String(req.base64 || '');
  if (!b64) throw new Error('badRequest: 사진이 없습니다');
  if (b64.length * 0.75 > MAX_BYTES) throw new Error('tooBig: 사진이 너무 큽니다');
  var known = info.labels.some(function (l) { return l.id === req.labelId; });
  // 방금 추가한 레이블이면 캐시가 옛것일 수 있다 — 한 번 새로 읽는다.
  if (!known) info = verify_(req.idToken, req.pid, true);
  var folder = labelFolder_(info, req.labelId);
  var name = safeName_(req.filename || (Utilities.getUuid() + '.jpg'));
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', name);
  var file = folder.createFile(blob);
  return { id: file.getId() };
}

function inProject_(file, info) {
  var pfId = projectFolder_(info).getId();
  var parents = file.getParents();
  while (parents.hasNext()) {
    var lf = parents.next();
    var gp = lf.getParents();
    while (gp.hasNext()) if (gp.next().getId() === pfId) return true;
  }
  return false;
}

function remove_(req, info) {
  var file;
  try { file = DriveApp.getFileById(String(req.fileId || '')); } catch (e) { return { ok: true }; }
  if (!inProject_(file, info)) throw new Error('auth: 이 프로젝트의 사진이 아닙니다');
  file.setTrashed(true);
  return { ok: true };
}

function zip_(req, info) {
  var want = {};
  var ids = req.fileIds || [];
  if (!ids.length) throw new Error('badRequest: 내려받을 사진이 없습니다');
  if (ids.length > MAX_ZIP_FILES) throw new Error('tooMany: 사진이 너무 많습니다');
  ids.forEach(function (id) { want[id] = true; });
  info = verify_(req.idToken, req.pid, true); // 레이블 이름은 지금 것으로
  var pf = projectFolder_(info);
  var names = {};
  info.labels.forEach(function (l, i) { names['label=' + l.id] = (i + 1) + '_' + safeName_(l.name); });
  var blobs = [];
  var it = pf.getFolders();
  while (it.hasNext()) {
    var lf = it.next();
    var dir = names[lf.getDescription()];
    if (!dir) continue;
    var files = lf.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      if (!want[f.getId()] || f.isTrashed()) continue;
      blobs.push(f.getBlob().setName(dir + '/' + f.getName()));
    }
  }
  if (!blobs.length) throw new Error('notFound: 사진을 찾지 못했습니다');
  var zip = Utilities.zip(blobs, 'ai_photos.zip');
  return { name: 'ai_photos.zip', count: blobs.length, base64: Utilities.base64Encode(zip.getBytes()) };
}

// ── 실험실 안에서 학습: 학습 사진 불러오기 · 모델 저장/불러오기 ──
// 모델은 프로젝트 폴더 안 models/v1, v2 …에 model.json · weights.bin · metadata.json으로 둔다.
var MAX_FETCH_FILES = 30;
var MAX_FETCH_BYTES = 6 * 1024 * 1024;

// 대표 PC가 학습할 때 쓸 사진을 돌려준다(고른 것만, 이 프로젝트 폴더 안의 것만).
function fetchPhotos_(req, info) {
  var ids = req.fileIds || [];
  if (!ids.length || ids.length > MAX_FETCH_FILES) throw new Error('badRequest: 사진 수');
  var want = {};
  ids.forEach(function (id) { want[id] = true; });
  var pf = projectFolder_(info);
  var out = [], total = 0;
  var it = pf.getFolders();
  while (it.hasNext()) {
    var lf = it.next();
    if (lf.getDescription().indexOf('label=') !== 0) continue;
    var files = lf.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      if (!want[f.getId()] || f.isTrashed()) continue;
      var bytes = f.getBlob().getBytes();
      total += bytes.length;
      if (total > MAX_FETCH_BYTES) throw new Error('tooBig: 한 번에 너무 많은 사진');
      out.push({ id: f.getId(), base64: Utilities.base64Encode(bytes) });
    }
  }
  return { files: out };
}

// 로그인 토큰(JWT) 안의 이메일. 토큰이 진짜인지는 verify_에서 Firestore가 이미 확인했다.
function tokenEmail_(idToken) {
  var part = String(idToken).split('.')[1] || '';
  var json = Utilities.newBlob(Utilities.base64DecodeWebSafe(part + '==='.slice((part.length + 3) % 4))).getDataAsString();
  return String(JSON.parse(json).email || '').toLowerCase();
}

function modelsFolder_(info, create) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('mf_' + info.pid);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 지워졌으면 다시 */ } }
  if (!create) return null;
  var pf = projectFolder_(info);
  var mf = withLock_(function () { return childFolder_(pf, 'models', 'models'); });
  // 공개 웹앱(로그인 없음)이 폴더를 찾을 수 있게 위치를 기록해 둔다.
  props.setProperty('mf_' + info.pid, mf.getId());
  return mf;
}

// 학습한 모델 저장 — 짝의 대표만.
function saveModel_(req, info) {
  var v = Number(req.version);
  if (!(v >= 1 && v <= 999)) throw new Error('badRequest: 모델 번호');
  var pair = firestoreGet_('ai_pairs/' + info.pairId, req.idToken);
  var leaderEmail = pair && pair.leaderId ? (pair.leaderId + '@ohinfo.local').toLowerCase() : '';
  if (!leaderEmail || tokenEmail_(req.idToken) !== leaderEmail) throw new Error('auth: 대표만 모델을 저장할 수 있습니다');
  var weights = Utilities.base64Decode(String(req.weightsBase64 || ''));
  if (!weights.length || weights.length > 20 * 1024 * 1024) throw new Error('badRequest: 모델 파일');
  JSON.parse(req.modelJson); JSON.parse(req.metadataJson); // 형식 확인
  var mf = modelsFolder_(info, true);
  var vf = withLock_(function () { return childFolder_(mf, 'v' + v, 'v=' + v); });
  // 같은 번호로 다시 저장하면 옛 파일은 휴지통으로
  var old = vf.getFiles();
  while (old.hasNext()) old.next().setTrashed(true);
  vf.createFile(Utilities.newBlob(req.modelJson, 'application/json', 'model.json'));
  vf.createFile(Utilities.newBlob(req.metadataJson, 'application/json', 'metadata.json'));
  vf.createFile(Utilities.newBlob(weights, 'application/octet-stream', 'weights.bin'));
  return { ok: true, version: v };
}

function readModelIn_(mf, version) {
  var v = Number(version);
  if (!mf) throw new Error('notFound: 모델이 없습니다');
  var it = mf.getFolders(), vf = null;
  while (it.hasNext()) { var f = it.next(); if (f.getDescription() === 'v=' + v) vf = f; }
  if (!vf) throw new Error('notFound: 모델이 없습니다');
  var out = {};
  var files = vf.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (file.isTrashed()) continue;
    var n = file.getName();
    if (n === 'model.json') out.modelJson = file.getBlob().getDataAsString();
    else if (n === 'metadata.json') out.metadataJson = file.getBlob().getDataAsString();
    else if (n === 'weights.bin') out.weightsBase64 = Utilities.base64Encode(file.getBlob().getBytes());
  }
  if (!out.modelJson || !out.weightsBase64) throw new Error('notFound: 모델 파일이 없습니다');
  return out;
}

function readModel_(info, version) {
  return readModelIn_(modelsFolder_(info, false), version);
}

// 공개 웹앱용: ai_apps 문서(누구나 읽기)에서 공개됐고 그 번호가 배포 번호인지 확인한 뒤 돌려준다.
function getPublicModel_(req) {
  var pid = String(req.pid || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(pid)) throw new Error('badRequest: 프로젝트 ID');
  var url = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents/ai_apps/' + pid;
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('notFound: 웹앱이 없습니다');
  var app = fromFields_(JSON.parse(res.getContentText()).fields || {});
  if (!app.published || Number(app.modelVersion) !== Number(req.version)) throw new Error('auth: 배포된 모델이 아닙니다');
  return readModelIn_(modelsFolder_({ pid: pid }, false), req.version);
}
