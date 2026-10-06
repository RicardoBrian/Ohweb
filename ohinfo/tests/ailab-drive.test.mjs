// Apps Script(ohinfo/apps-script/ailab-drive.gs)를 가짜 구글 환경에서 돌려 보는 테스트.
// `node ohinfo/tests/ailab-drive.test.mjs`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';

const src = fs.readFileSync(new URL('../apps-script/ailab-drive.gs', import.meta.url), 'utf8');

// ── 가짜 드라이브 ──
let seq = 0;
class Folder {
  constructor(name, parent) { this.id = 'F' + (++seq); this.name = name; this.desc = ''; this.parent = parent; this.folders = []; this.files = []; ALL.set(this.id, this); }
  getId() { return this.id; } getName() { return this.name; }
  getDescription() { return this.desc; } setDescription(d) { this.desc = d; return this; }
  getFolders() { return iter(this.folders); }
  getFoldersByName(n) { return iter(this.folders.filter(f => f.name === n)); }
  createFolder(n) { const f = new Folder(n, this); this.folders.push(f); return f; }
  createFile(blob) { const f = new File(blob, this); this.files.push(f); return f; }
  getFiles() { return iter(this.files); }
  getParents() { return iter(this.parent ? [this.parent] : []); }
}
class File {
  constructor(blob, parent) { this.id = 'D' + (++seq); this.blob = blob; this.parent = parent; this.trashed = false; ALL.set(this.id, this); }
  getId() { return this.id; } getName() { return this.blob.name; }
  getParents() { return iter([this.parent]); }
  setTrashed(v) { this.trashed = v; } isTrashed() { return this.trashed; }
  getBlob() { return new Blob(this.blob.bytes, this.blob.type, this.blob.name); }
}
class Blob {
  constructor(bytes, type, name) { this.bytes = bytes; this.type = type; this.name = name; }
  setName(n) { this.name = n; return this; } getBytes() { return this.bytes; }
  getDataAsString() { return Buffer.from(this.bytes).toString(); }
}
const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
const ALL = new Map();
const ROOT = new Folder('내 드라이브', null);

// ── 가짜 Firestore(REST): 토큰별로 읽을 수 있는 문서 ──
const docs = {
  'ai_projects/P1_1': { pairId: { stringValue: 'P1' }, round: { integerValue: '1' }, schoolName: { stringValue: '관산중' }, grade: { stringValue: '1' }, class: { stringValue: '4' },
    labels: { arrayValue: { values: [
      { mapValue: { fields: { id: { stringValue: 'la' }, name: { stringValue: '사과' } } } },
      { mapValue: { fields: { id: { stringValue: 'lb' }, name: { stringValue: '배/나무' } } } },
    ] } } },
  'ai_pairs/P1': { no: { integerValue: '3' }, leaderId: { stringValue: 'A' }, members: { arrayValue: { values: [{ stringValue: 'A' }, { stringValue: 'B' }] } }, memberNames: { mapValue: { fields: { A: { stringValue: '김가람' }, B: { stringValue: '이나래' } } } } },
};
// 로그인 토큰 흉내(JWT 모양: 머리.내용.서명) — 내용에 이메일이 들어 있다.
const jwt = email => 'h.' + Buffer.from(JSON.stringify({ email })).toString('base64url') + '.s';
const tokA = jwt('a@ohinfo.local'), tokB = jwt('b@ohinfo.local'), tokX = jwt('x@ohinfo.local');
const ACCESS = { [tokA]: ['ai_projects/P1_1', 'ai_pairs/P1'], [tokB]: ['ai_projects/P1_1', 'ai_pairs/P1'], [tokX]: ['ai_pairs/P1'], '': [] };
const PUBLIC = new Set();  // 로그인 없이 읽히는 문서(ai_apps)
let fetches = 0;
const cacheStore = new Map();
const props = new Map();
const ctx = {
  DriveApp: { getRootFolder: () => ROOT, getFolderById: id => { const f = ALL.get(id); if (!(f instanceof Folder)) throw new Error('no'); return f; }, getFileById: id => { const f = ALL.get(id); if (!(f instanceof File)) throw new Error('no'); return f; } },
  UrlFetchApp: { fetch: (url, opt) => {
    fetches++;
    const path = url.split('/documents/')[1];
    const tok = opt.headers ? opt.headers.Authorization.replace('Bearer ', '') : '';
    const ok = ((ACCESS[tok] || []).includes(path) || (!tok && PUBLIC.has(path))) && docs[path];
    return { getResponseCode: () => (ok ? 200 : 403), getContentText: () => JSON.stringify(ok ? { fields: docs[path] } : { error: {} }) };
  } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) || null, setProperty: (k, v) => props.set(k, v) }) },
  CacheService: { getScriptCache: () => ({ get: k => cacheStore.get(k) || null, put: (k, v) => cacheStore.set(k, v) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => ({ body: s }) }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (_, s) => [...Buffer.from(s)].slice(0, 32),
    base64EncodeWebSafe: b => Buffer.from(b).toString('base64url'),
    base64Encode: b => Buffer.from(b).toString('base64'),
    base64Decode: s => [...Buffer.from(s, 'base64')],
    base64DecodeWebSafe: s => [...Buffer.from(s.replace(/=+$/, ''), 'base64url')],
    newBlob: (bytes, type, name) => new Blob(typeof bytes === 'string' ? [...Buffer.from(bytes)] : bytes, type, name),
    getUuid: () => 'uuid',
    zip: (blobs, name) => ({ getBytes: () => [...Buffer.from(JSON.stringify(blobs.map(b => b.name)))], name }),
  },
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);

let n = 0; const test = (name, fn) => { fn(); n++; console.log('✅', name); };
const jpg = Buffer.from('fake-jpeg').toString('base64');

test('ping', () => assert.deepEqual(post({ action: 'ping' }), { ok: true }));
test('토큰 없으면 거절', () => assert.equal(post({ action: 'upload', pid: 'P1_1' }).code, 'auth'));
test('다른 짝(프로젝트를 못 읽는 토큰)은 거절', () => assert.equal(post({ action: 'upload', idToken: tokX, pid: 'P1_1', labelId: 'la', base64: jpg }).code, 'auth'));
test('이상한 프로젝트 ID 거절', () => assert.equal(post({ action: 'upload', idToken: tokA, pid: '../x', labelId: 'la', base64: jpg }).code, 'badRequest'));
let up1, up2, up3;
test('업로드 → 학교/반/짝/레이블 폴더', () => {
  up1 = post({ action: 'upload', idToken: tokA, pid: 'P1_1', labelId: 'la', filename: 'im1.jpg', base64: jpg });
  up2 = post({ action: 'upload', idToken: tokA, pid: 'P1_1', labelId: 'lb', filename: 'im2.jpg', base64: jpg });
  up3 = post({ action: 'upload', idToken: tokA, pid: 'P1_1', labelId: 'la', filename: 'im3.jpg', base64: jpg });
  assert.ok(up1.id && up2.id && up3.id);
  const root = ROOT.folders.find(f => f.name === 'AI실험실');
  const cls = root.folders[0];
  assert.equal(cls.name, '관산중 1학년 4반');
  const pf = cls.folders[0];
  assert.equal(pf.name, '3짝 (김가람, 이나래) 1번째 모델 [P1_1]');
  assert.deepEqual(pf.folders.map(f => f.name), ['1_사과', '2_배_나무']);
  assert.equal(pf.folders[0].files.length, 2);
  assert.equal(root.folders.length, 1); // 같은 폴더를 두 번 만들지 않음
});
test('검증 결과 캐시(업로드마다 Firestore를 읽지 않음)', () => {
  const before = fetches;
  post({ action: 'upload', idToken: tokA, pid: 'P1_1', labelId: 'la', filename: 'im4.jpg', base64: jpg });
  assert.equal(fetches, before);
});
test('없는 레이블 → badLabel(한 번 새로 읽어 본 뒤)', () => {
  const r = post({ action: 'upload', idToken: tokA, pid: 'P1_1', labelId: 'zz', base64: jpg });
  assert.equal(r.code, 'badLabel');
});
test('너무 큰 사진 거절', () => {
  const big = Buffer.alloc(3.2 * 1024 * 1024).toString('base64');
  assert.equal(post({ action: 'upload', idToken: tokA, pid: 'P1_1', labelId: 'la', base64: big }).code, 'tooBig');
});
test('묶어 내려받기: 고른 사진만, 레이블 폴더 이름으로', () => {
  const r = post({ action: 'zip', idToken: tokA, pid: 'P1_1', fileIds: [up1.id, up2.id] });
  assert.equal(r.count, 2);
  const names = JSON.parse(Buffer.from(r.base64, 'base64').toString());
  assert.deepEqual(names.sort(), ['1_사과/im1.jpg', '2_배_나무/im2.jpg']);
});
test('지우기: 휴지통으로, 지운 건 내려받기에서 빠짐', () => {
  assert.deepEqual(post({ action: 'delete', idToken: tokA, pid: 'P1_1', fileId: up3.id }), { ok: true });
  assert.equal(ALL.get(up3.id).trashed, true);
  const r = post({ action: 'zip', idToken: tokA, pid: 'P1_1', fileIds: [up1.id, up3.id] });
  assert.equal(r.count, 1);
});
test('다른 프로젝트 파일은 못 지움', () => {
  const other = ROOT.createFolder('남의폴더').createFile(new Blob([1], 'image/jpeg', 'x.jpg'));
  assert.equal(post({ action: 'delete', idToken: tokA, pid: 'P1_1', fileId: other.getId() }).code, 'auth');
  assert.equal(other.trashed, false);
});
test('학습 사진 불러오기: 고른 것만, 지운 건 빼고', () => {
  const r = post({ action: 'fetch', idToken: tokA, pid: 'P1_1', fileIds: [up1.id, up2.id, up3.id] });
  assert.deepEqual(r.files.map(f => f.id).sort(), [up1.id, up2.id].sort());
  assert.equal(Buffer.from(r.files[0].base64, 'base64').toString(), 'fake-jpeg');
  assert.equal(post({ action: 'fetch', idToken: tokX, pid: 'P1_1', fileIds: [up1.id] }).code, 'auth');
});
const model = { action: 'saveModel', pid: 'P1_1', version: 1, modelJson: '{"a":1}', metadataJson: '{"labels":["la","lb"]}', weightsBase64: Buffer.from('WEIGHTS').toString('base64') };
test('모델 저장: 대표가 아니면 거절', () => assert.equal(post({ ...model, idToken: tokB }).code, 'auth'));
test('모델 저장: 대표는 models/v1에', () => {
  assert.deepEqual(post({ ...model, idToken: tokA }), { ok: true, version: 1 });
  const pf = ROOT.folders.find(f => f.name === 'AI실험실').folders[0].folders[0];
  const mf = pf.folders.find(f => f.desc === 'models');
  assert.deepEqual(mf.folders[0].files.map(f => f.getName()).sort(), ['metadata.json', 'model.json', 'weights.bin']);
});
test('모델 다시 저장하면 옛 파일은 휴지통', () => {
  post({ ...model, idToken: tokA, modelJson: '{"a":2}' });
  const r = post({ action: 'getModel', idToken: tokB, pid: 'P1_1', version: 1 });
  assert.equal(r.modelJson, '{"a":2}');
  assert.equal(Buffer.from(r.weightsBase64, 'base64').toString(), 'WEIGHTS');
});
test('짝은 모델 불러오기 가능, 없는 번호는 notFound', () => {
  assert.equal(post({ action: 'getModel', idToken: tokB, pid: 'P1_1', version: 2 }).code, 'notFound');
});
test('공개 웹앱: 공개되고 배포 번호가 맞을 때만', () => {
  assert.equal(post({ action: 'getModel', pid: 'P1_1', version: 1 }).code, 'notFound'); // 웹앱 문서 없음
  docs['ai_apps/P1_1'] = { published: { booleanValue: false }, modelVersion: { integerValue: '1' } };
  PUBLIC.add('ai_apps/P1_1');
  assert.equal(post({ action: 'getModel', pid: 'P1_1', version: 1 }).code, 'auth');
  docs['ai_apps/P1_1'].published = { booleanValue: true };
  assert.equal(post({ action: 'getModel', pid: 'P1_1', version: 2 }).code, 'auth'); // 배포 안 한 번호
  assert.equal(post({ action: 'getModel', pid: 'P1_1', version: 1 }).modelJson, '{"a":2}');
});
console.log(`\n${n}개 통과`);
