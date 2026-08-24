// 기존 학생 계정을 Firebase Auth로 일괄 전환하는 일회성 스크립트.
//
// 이건 브라우저에서 돌릴 수 없다 — 관리자 PC(또는 신뢰할 수 있는 서버)에서
// Node.js로 직접 실행해야 한다. Firebase 서비스 계정 키(관리자 권한 인증서)가
// 필요한데, 이 키는 절대 커밋하거나 다른 사람과 공유하면 안 된다.
//
// ── 준비 ──
//   1. Firebase 콘솔 → 프로젝트 설정(⚙) → 서비스 계정 → "새 비공개 키 생성"
//      → JSON 파일 다운로드 (예: serviceAccountKey.json). 이 레포 밖의 안전한
//      곳에 저장하고, 절대 git에 커밋하지 않는다.
//   2. 이 폴더에서: npm install firebase-admin
//   3. 실행:
//        node migrate-students-to-auth.mjs /path/to/serviceAccountKey.json
//      먼저 미리보기만 하려면:
//        node migrate-students-to-auth.mjs /path/to/serviceAccountKey.json --dry-run
//
// ── 동작 ──
// `students` 컬렉션에서 registered=true 이고 아직 password 필드(평문)가
// 남아있는 문서를 찾아서:
//   - 문서 ID로 합성 이메일 `${id}@ohinfo.local` 을 만들고
//   - 이미 그 이메일로 된 Auth 계정이 있으면 (이미 로그인 시점에 자동
//     전환된 경우) → 새로 만들지 않고 Firestore의 password 필드만 지움
//   - 없으면 Auth 계정을 새로 만들고 → password 필드를 지움
//
// 6자 미만 비밀번호를 Firebase가 거부하는 문제는 `public/student-auth.js`와
// 동일한 padPassword 로직으로 맞춘다 — 여기서 로직이 어긋나면 그 학생만
// 로그인이 안 되니, student-auth.js를 고치면 여기도 같이 고쳐야 한다.

import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const keyPath = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!keyPath) {
  console.error('사용법: node migrate-students-to-auth.mjs <서비스계정키.json> [--dry-run]');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
initializeApp({ credential: cert(serviceAccount) });

const db = getFirestore();
const auth = getAuth();

const EMAIL_SUFFIX = '@ohinfo.local';
const MIN_LEN = 6;
const PAD_CHAR = '0';
function padPassword(pw) {
  return pw.length >= MIN_LEN ? pw : pw.padEnd(MIN_LEN, PAD_CHAR);
}

async function main() {
  const snap = await db.collection('students').get();
  const targets = snap.docs.filter(d => {
    const data = d.data();
    return data.registered === true && typeof data.password === 'string' && data.password.length > 0;
  });

  console.log(`전체 학생 문서: ${snap.size}건, 마이그레이션 대상(등록됨 + 평문 비밀번호 남음): ${targets.length}건`);
  if (dryRun) console.log('(--dry-run: 실제로 쓰지 않고 미리보기만 합니다)');

  let created = 0, cleanedOnly = 0, failed = 0;

  for (const docSnap of targets) {
    const id = docSnap.id;
    const data = docSnap.data();
    const email = `${id}${EMAIL_SUFFIX}`;
    const password = padPassword(data.password);

    try {
      let userExists = false;
      try {
        await auth.getUserByEmail(email);
        userExists = true;
      } catch (e) {
        if (e.code !== 'auth/user-not-found') throw e;
      }

      if (!dryRun) {
        if (!userExists) {
          await auth.createUser({ email, password, emailVerified: true });
        }
        await db.collection('students').doc(id).update({ password: FieldValue.delete() });
      }

      if (userExists) cleanedOnly++; else created++;
      console.log(`✓ ${id} (${data.schoolName || ''} ${data.grade || ''}/${data.class || ''} ${data.number || ''}번 ${data.name || ''}) — ${userExists ? '기존 계정, 평문 필드만 정리' : '계정 생성'}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${id} 실패: ${e.message}`);
    }
  }

  console.log('---');
  console.log(`계정 생성: ${created}건, 기존 계정 정리: ${cleanedOnly}건, 실패: ${failed}건`);
  if (dryRun) console.log('(dry-run이었으므로 실제로는 아무것도 바뀌지 않았습니다)');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
