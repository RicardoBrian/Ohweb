#!/usr/bin/env python3
"""견본(kakainfo.com/vibe) 빌드 — 실제 앱 파일을 복사해 견본용으로 바꾼다.

    python3 ohinfo/tools/vibe/build.py            # 전부
    python3 ohinfo/tools/vibe/build.py teacher    # 일부만

실제 앱이 바뀌면 이걸 다시 돌려 견본을 맞춘다. 손으로 쓴 견본 전용 파일
(각 앱의 firebase-config.js, seed 데이터 등, 아래 KEEP)은 덮어쓰지 않는다.

복사하면서 바꾸는 것 (transform):
  - gstatic의 Firebase SDK 주소 → /vibe/shared/fake-firebase/ (데이터는 브라우저에만 저장)
  - 실제 관리자 이메일 → teacher@example.com (견본 계정)
  - Apps Script 주소·업로드 비밀값 → 가짜 값 (demo.js가 브라우저 안에서 처리)
  - 모든 HTML <head> 맨 앞에 /vibe/shared/demo.js (저장 공간 분리 + 견본 표시줄)
빌드 끝에 실제 키·이메일·비밀값이 남았는지 검사하고, 남아 있으면 실패한다.
"""
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]          # 저장소 맨 위
VIBE = ROOT / 'ohinfo/public/vibe'
EXTERNAL = Path(os.environ.get('VIBE_SRC', '/tmp/vibe-src'))  # 다른 저장소를 받아 둘 곳


def external(name: str) -> Path:
    """다른 저장소(RicardoBrian/<name>)를 EXTERNAL 아래에 받아 두고(없으면 clone, 있으면 pull) 경로를 돌려준다."""
    d = EXTERNAL / name
    if d.exists():
        subprocess.run(['git', '-C', str(d), 'pull', '-q'], check=False)
    else:
        EXTERNAL.mkdir(parents=True, exist_ok=True)
        subprocess.run(['git', 'clone', '-q', '--depth', '1', f'https://github.com/RicardoBrian/{name}.git', str(d)], check=True)
    return d

FAKE = '/vibe/shared/fake-firebase/'
DEMO_JS = '<script src="/vibe/shared/demo.js"></script>'

# 공개 사본에 절대 남으면 안 되는 값들 (실제 키·이메일·비밀값의 일부)
FORBIDDEN = [
    'AIza', 'qjatjr7575', 'ohweb-upload-2026', 'script.google.com/macros',
    'ohweb-93062', 'ohsettle-10d43', 'gstatic.com/firebasejs', '오범석', 'nosuk.beom',
    'ohtravel-3540c', 'qjatjrdl1', '961002',
]


def transform(text: str, is_html: bool) -> str:
    # Firebase SDK (예전 compat 방식): 세 줄 → 가짜 core.js + compat.js 두 줄
    text = re.sub(r'<script src="https://www\.gstatic\.com/firebasejs/[\d.]+/firebase-app-compat\.js"></script>',
                  f'<script src="{FAKE}core.js"></script><script src="{FAKE}compat.js"></script>', text)
    text = re.sub(r'[ \t]*<script src="https://www\.gstatic\.com/firebasejs/[\d.]+/firebase-[a-z]+-compat\.js"></script>\n?', '', text)
    # Firebase SDK (모듈 방식) — 버전과 상관없이
    text = re.sub(r'https://www\.gstatic\.com/firebasejs/[\d.]+/firebase-([a-z-]+)\.js', FAKE + r'firebase-\1.js', text)
    # 'https://www.gstatic.com/firebasejs/10.12.2/' + 'firebase-auth.js' 처럼 나눠 쓴 경우
    text = re.sub(r'https://www\.gstatic\.com/firebasejs/[\d.]+/', FAKE, text)
    text = text.replace('qjatjr7575@gmail.com', 'teacher@example.com')
    text = re.sub(r'ohweb-93062|ohsettle-10d43', 'demo-project', text)
    # 제작자 이름·연락처 (저작권 줄, SNS)
    text = text.replace('관산중학교 오범석', '견본중학교 견본 선생님').replace('오범석', '견본 선생님')
    text = re.sub(r'https://(www\.)?instagram\.com/[A-Za-z0-9._]+', 'https://www.instagram.com/', text)
    text = text.replace('@nosuk.beom', '(견본)')
    text = re.sub(r'https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec', 'https://demo-upload.invalid/exec', text)
    text = text.replace("'ohweb-upload-2026'", "'demo'")
    if is_html and DEMO_JS not in text:
        text = re.sub(r'(<head[^>]*>)', r'\1\n  ' + DEMO_JS, text, count=1, flags=re.I)
    return text


def copy(src: Path, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix in ('.html', '.js', '.css', '.mjs', '.json', '.jsx'):
        dst.write_text(transform(src.read_text(encoding='utf-8'), src.suffix == '.html'), encoding='utf-8')
    else:
        shutil.copy2(src, dst)


def copy_tree(src_dir: Path, dst_dir: Path, include=None, exclude=(), keep=()):
    for src in sorted(src_dir.rglob('*')):
        if src.is_dir():
            continue
        rel = src.relative_to(src_dir).as_posix()
        if include is not None and not any(rel == i or rel.startswith(i.rstrip('/') + '/') for i in include):
            continue
        if any(rel == e or rel.startswith(e.rstrip('/') + '/') for e in exclude):
            continue
        if rel in keep and (dst_dir / rel).exists():
            continue
        copy(src, dst_dir / rel)


# ── 앱별 ─────────────────────────────────────────────

def build_teacher():
    """관리자 화면 (ohweb/public) → vibe/teacher. 학생 화면과 같은 저장 공간(vibe-school)."""
    copy_tree(ROOT / 'ohweb/public', VIBE / 'teacher',
              exclude=['_headers', 'settle.html', 'settle-firebase-config.js'],
              keep=['firebase-config.js'])


def build_student():
    """학생 사이트 (ohinfo/public 일부) → vibe/student."""
    files = [
        'index.html', 'login.html', 'home.html', 'exam.html', 'formlab.html', 'formfill.html', 'qna.html', 'ohdlet.html',
        'ailab.html', 'aicode.html', 'aiapp.html',
        'theme.css', 'student-sky.css', 'ai-themes.css', 'icon.svg', 'logo.png', 'logo.svg', 'apple-touch-icon.png',
        'escape.js', 'page-title.js', 'session.js', 'student-auth.js', 'firebase-config.js',
        'aicode.js', 'ailab.js',
    ]
    src = ROOT / 'ohinfo/public'
    files += [p.name for p in src.glob('ai-*.js')]
    copy_tree(src, VIBE / 'student', include=files, keep=['firebase-config.js'])
    # 로그아웃하면 다음에 열 때 견본 학생으로 자동 로그인하지 않게 표시를 남긴다
    s = (VIBE / 'student/session.js').read_text(encoding='utf-8')
    if 'vibe_student_loggedout' not in s:
        s = s.replace("export function saveSession(data) {",
                      "export function saveSession(data) {\n  localStorage.removeItem('vibe_student_loggedout');")
        s = s.replace("export function clearSession() {",
                      "export function clearSession() {\n  localStorage.setItem('vibe_student_loggedout', '1');")
        (VIBE / 'student/session.js').write_text(s, encoding='utf-8')


def build_classlog():
    """수업일지 (ohlog/public) → vibe/classlog. 시간표는 shared/api/comci.js가 가상으로 만든다."""
    copy_tree(ROOT / 'ohlog/public', VIBE / 'classlog', exclude=['_headers'], keep=['firebase-config.js'])


def build_shortener():
    """단축 URL (ohshrt/public) → vibe/shortener. 원본은 /app.js처럼 사이트 맨 위 기준 주소를 써서 상대 주소로 바꾼다."""
    dst = VIBE / 'shortener'
    copy_tree(ROOT / 'ohshrt/public', dst, keep=['firebase-config.js'])
    for p in dst.glob('*.html'):
        t = p.read_text(encoding='utf-8')
        t = re.sub(r'(src|href)="/(?!/|vibe/)', r'\1="./', t)
        p.write_text(t, encoding='utf-8')


def build_settle():
    """모임 정산 (ohsettle/public) → vibe/settle."""
    copy_tree(ROOT / 'ohsettle/public', VIBE / 'settle', keep=['firebase-config.js'])


def build_activation():
    """활성화 함수 시각화 (데이터 없음) → vibe/activation/index.html."""
    src = ROOT / 'ohinfo/public'
    copy(src / '활성함수.html', VIBE / 'activation/index.html')
    p = VIBE / 'activation/index.html'
    p.write_text(p.read_text(encoding='utf-8').replace('href="home.html"', 'href="../"'), encoding='utf-8')
    for f in ['theme.css', 'icon.svg', 'logo.png', 'apple-touch-icon.png']:
        if (src / f).exists():
            copy(src / f, VIBE / 'activation' / f)


def build_attend():
    """출결 관리 (gwansanattend/public) → vibe/attend."""
    copy_tree(external('gwansanattend') / 'public', VIBE / 'attend', exclude=['_headers'], keep=['firebase-config.js'])


def build_broadcast():
    """방송부 관리 (GWBS) → vibe/broadcast. 입장 비밀번호 게이트(functions)·데이터 이전 도구는 뺀다."""
    src, dst = external('GWBS'), VIBE / 'broadcast'
    for f in ['index.html', 'admin.html', 'request.html', 'fb-guard.js', 'yt.js', 'favicon.svg', 'logo.png']:
        copy(src / f, dst / f)
    g = (dst / 'fb-guard.js').read_text(encoding='utf-8')
    g = re.sub(r'window\.FB_CONFIG = \{.*?\};', "window.FB_CONFIG = { projectId: 'vibe-broadcast' }; // 견본: 가짜 Firebase", g, count=1, flags=re.S)
    (dst / 'fb-guard.js').write_text(g, encoding='utf-8')
    y = (dst / 'yt.js').read_text(encoding='utf-8')
    y = re.sub(r'window\.YT_API_KEY = "[^"]*";', 'window.YT_API_KEY = ""; // 견본: 키 없음 → 유튜브에서 검색해 주소를 붙여넣는 방식', y)
    (dst / 'yt.js').write_text(y, encoding='utf-8')
    for p in dst.glob('*.html'):
        t = p.read_text(encoding='utf-8')
        if 'src="seed.js"' not in t:
            t = t.replace('<script src="fb-guard.js"></script>', '<script src="seed.js"></script>\n  <script src="fb-guard.js"></script>', 1)
        p.write_text(t, encoding='utf-8')


def build_volunteer():
    """봉사활동 관리 (GWVS) → vibe/volunteer. React·Babel은 원본처럼 CDN에서 받는다."""
    src, dst = external('GWVS'), VIBE / 'volunteer'
    for p in src.iterdir():
        if p.suffix in ('.jsx', '.css') or p.name in ('index.html', 'logo.png'):
            copy(p, dst / p.name)
    c = (dst / 'core.jsx').read_text(encoding='utf-8')
    c = re.sub(r'const firebaseConfig = \{.*?\};', 'const firebaseConfig = { projectId: "vibe-volunteer" }; // 견본: 가짜 Firebase', c, count=1, flags=re.S)
    (dst / 'core.jsx').write_text(c, encoding='utf-8')
    h = (dst / 'index.html').read_text(encoding='utf-8')
    if 'src="seed.js"' not in h:
        h = h.replace('compat.js"></script>', 'compat.js"></script>\n  <script src="seed.js"></script>', 1)
    (dst / 'index.html').write_text(h, encoding='utf-8')


def build_travel():
    """여행 플래너 (oHtravel) → vibe/travel. 입장 코드·관리자 비밀번호 기본값은 'demo'로 바꾼다."""
    src, dst = external('oHtravel'), VIBE / 'travel'
    for f in ['index.html', 'styles.css', 'app.js']:
        copy(src / f, dst / f)
    a = (dst / 'app.js').read_text(encoding='utf-8')
    a = re.sub(r'const firebaseConfig = \{.*?\};', "const firebaseConfig = { projectId: 'vibe-travel' }; // 견본: 가짜 Firebase", a, count=1, flags=re.S)
    a = a.replace("'961002'", "'demo'").replace("'qjatjrdl1'", "'demo'")
    if "import './seed.js';" not in a:
        a = a.replace("import { initializeApp }", "import './seed.js';\nimport { initializeApp }", 1)
    (dst / 'app.js').write_text(a, encoding='utf-8')
    h = (dst / 'index.html').read_text(encoding='utf-8')
    h = h.replace('<p class="entry-desc">입장 코드를 입력하세요</p>', '<p class="entry-desc">입장 코드를 입력하세요 (견본: demo)</p>')
    (dst / 'index.html').write_text(h, encoding='utf-8')


def build_aia():
    """앱 인벤터 점검기 (appinventorcheck/teacher) → vibe/aia. 예제 .aia 5개가 들어 있는 교사용 한 파일 빌드."""
    src = external('appinventorcheck')
    copy_tree(src / 'teacher', VIBE / 'aia')
    # 내려받아 '파일 열기'로도 시험해 볼 수 있게 예제 파일도 둔다
    copy_tree(src / 'src/samples', VIBE / 'aia/samples')


def build_roadmap():
    """학생 성장 지원 로드맵 (gwresearch) → vibe/roadmap. 개인정보가 없는 공개 사이트라 그대로 옮긴다.
    서버 기능(functions: 드라이브 PDF 중계·짧은 주소)과 시안·도구는 빼고, 견본 PDF가 든 정적 파일만."""
    copy_tree(external('gwresearch'), VIBE / 'roadmap', include=['index.html', 'favicon.ico', 'css', 'js', 'assets'])


BUILDERS = {
    'teacher': build_teacher,
    'student': build_student,
    'classlog': build_classlog,
    'shortener': build_shortener,
    'settle': build_settle,
    'activation': build_activation,
    'attend': build_attend,
    'broadcast': build_broadcast,
    'volunteer': build_volunteer,
    'travel': build_travel,
    'aia': build_aia,
    'roadmap': build_roadmap,
}


def check_forbidden():
    bad = []
    for p in VIBE.rglob('*'):
        if p.is_file() and p.suffix in ('.html', '.js', '.css', '.json', '.jsx', '.mjs', '.md'):
            t = p.read_text(encoding='utf-8', errors='ignore')
            for f in FORBIDDEN:
                if f in t:
                    bad.append(f'{p.relative_to(ROOT)}: {f}')
    if bad:
        print('공개하면 안 되는 값이 남아 있습니다:\n  ' + '\n  '.join(bad))
        sys.exit(1)


if __name__ == '__main__':
    names = sys.argv[1:] or list(BUILDERS)
    for n in names:
        BUILDERS[n]()
        print('built', n)
    check_forbidden()
    print('ok — 금지 값 없음')
