// ============================================================
//  프롬프트 생성기 — 상태 및 상수
// ============================================================

const PURPOSE_TEXT = {
  work: '이 앱은 업무 효율을 높이기 위한 실용적 도구입니다. 불필요한 장식보다는 빠른 입력과 결과 확인에 집중해주세요.',
  edu: '이 앱은 교육 현장(수업, 평가, 기록)에서 사용됩니다.',
  personal: '이 앱은 개인이 편하게 쓰는 용도입니다. 사용자 취향에 맞게 자유롭게 스타일링해도 좋습니다.',
};

const DESIGN_PRESETS = [
  {
    id: 'liquid',
    name: '리퀴드 (Liquid Glass)',
    summary: '반투명 유리 카드 + 부드러운 그라데이션',
    swatchClass: 'swatch-liquid',
    text: '유리처럼 반투명하고 매끈한 \'리퀴드 글래스\' 스타일로 디자인해주세요. backdrop-filter blur를 활용한 반투명 카드, 부드럽게 흐르는 듯한 곡선과 그라데이션, 은은한 광택 하이라이트를 사용하고, 배경은 부드러운 그라데이션 컬러로 채워주세요.',
  },
  {
    id: 'bw',
    name: '흑백',
    summary: '화이트/그레이 배경 + 블랙 텍스트 모노톤',
    swatchClass: 'swatch-bw',
    text: '흑백 모노톤으로 디자인해주세요. 배경은 흰색 또는 아주 옅은 회색, 텍스트와 요소는 검정~짙은 회색 계열로 통일하고, 타이포그래피의 굵기와 크기 대비로 위계를 표현해주세요.',
  },
  {
    id: 'minimal',
    name: '미니멀',
    summary: '넉넉한 여백 + 채도 낮은 중성 컬러',
    swatchClass: 'swatch-minimal',
    text: '미니멀 디자인으로 만들어주세요. 불필요한 장식 요소를 제거하고, 여백을 넉넉하게 사용하며, 채도가 낮은 중성 색상 팔레트(화이트, 그레이, 소프트 블루 등)를 사용하고, 그림자는 아주 은은하게만 적용해주세요.',
  },
  {
    id: 'warm',
    name: '따뜻한 느낌',
    summary: '베이지·코랄·살구빛 웜톤, 둥근 모서리',
    swatchClass: 'swatch-warm',
    text: '따뜻하고 포근한 느낌으로 디자인해주세요. 베이지, 크림, 코랄, 살구빛 같은 채도 낮은 웜톤 컬러를 사용하고, 모서리는 둥글게, 폰트는 부드러운 느낌으로 해주세요.',
  },
  {
    id: 'neon',
    name: '네온',
    summary: '어두운 배경 + 네온 글로우 사이버펑크',
    swatchClass: 'swatch-neon',
    text: '어두운 배경 위에 네온 컬러(형광 그린, 시안, 마젠타, 퍼플 등)로 포인트를 주는 사이버펑크/네온 스타일로 디자인해주세요. 글로우(glow) 효과와 그라데이션 테두리를 적극 활용해주세요.',
  },
  {
    id: 'sky',
    name: 'OHinfo 하늘',
    summary: '연하늘→연보라 배경 + 반투명 흰 카드 + 보라 포인트',
    swatchClass: 'swatch-sky',
    text: '차분한 \'하늘\' 스타일로 디자인해주세요. 배경은 연한 하늘색에서 연보라로 넘어가는 부드러운 세로 그라데이션 하나만 쓰고, 카드는 반투명한 흰색에 1px 얇은 테두리와 은은한 그림자를 주세요. 글자는 짙은 남색, 포인트 색은 보라(#5a48d6 계열)로 통일하고, 주요 버튼은 짙은 남색 알약(둥근 pill) 모양으로 해주세요. 글꼴은 IBM Plex Sans KR을 Google Fonts로 불러와 사용해주세요.',
  },
  {
    id: 'pastel',
    name: '파스텔',
    summary: '민트·라벤더·핑크 파스텔 + 큼직한 둥근 카드',
    swatchClass: 'swatch-pastel',
    text: '파스텔 톤으로 귀엽고 산뜻하게 디자인해주세요. 민트, 라벤더, 연핑크, 연노랑 같은 채도 낮고 밝은 색을 영역별로 나눠 쓰고, 카드와 버튼은 크고 둥글게(모서리 16px 이상), 그림자는 색이 살짝 섞인 부드러운 그림자로 해주세요. 글자는 너무 연하지 않게 짙은 회보라 계열로 해서 읽기 쉽게 해주세요.',
  },
  {
    id: 'chalk',
    name: '칠판 교실',
    summary: '짙은 초록 칠판 + 분필 글씨 + 나무 테두리',
    swatchClass: 'swatch-chalk',
    text: '교실 칠판 느낌으로 디자인해주세요. 배경은 짙은 초록색 칠판(약간의 분필 가루 질감), 화면 가장자리는 나무 프레임 색 테두리, 글자는 분필처럼 흰색과 노란색, 강조는 분홍·하늘색 분필 색으로 해주세요. 제목에는 손글씨 느낌의 글꼴(예: Gaegu 또는 Nanum Pen Script, Google Fonts)을 쓰고, 본문은 읽기 쉬운 고딕으로 해주세요.',
  },
  {
    id: 'notebook',
    name: '종이 노트',
    summary: '아이보리 종이 + 줄 노트 + 포스트잇 카드',
    swatchClass: 'swatch-notebook',
    text: '종이 노트 느낌으로 디자인해주세요. 배경은 아이보리색 종이에 옅은 파란 줄무늬(또는 격자), 카드는 포스트잇처럼 노랑·분홍·연두 색으로 살짝 기울이거나 그림자를 주고, 제목은 손글씨 느낌 글꼴(예: Gaegu, Google Fonts), 본문은 읽기 쉬운 글꼴로 해주세요. 버튼은 스티커 느낌의 둥근 모양으로 해주세요.',
  },
  {
    id: 'dark',
    name: '다크 대시보드',
    summary: '진한 슬레이트 배경 + 카드 + 파랑 포인트',
    swatchClass: 'swatch-dark',
    text: '어두운 슬레이트(짙은 남회색) 배경의 대시보드 스타일로 디자인해주세요. 카드는 배경보다 한 단계 밝은 색에 얇은 테두리, 포인트 색은 밝은 파랑 하나만 쓰고, 숫자와 상태는 큼직하게 보여주세요. 눈이 편하도록 흰색 대신 아주 밝은 회색 글자를 쓰고, 표와 목록은 줄마다 은은한 구분선을 넣어주세요.',
  },
  {
    id: 'brutal',
    name: '네오 브루탈',
    summary: '굵은 검정 테두리 + 원색 + 각진 그림자',
    swatchClass: 'swatch-brutal',
    text: '네오 브루탈리즘 스타일로 디자인해주세요. 배경은 선명한 노랑 또는 크림색, 카드와 버튼은 흰색 바탕에 3px 굵은 검정 테두리와 오프셋 그림자(오른쪽 아래로 4~6px, 번짐 없는 검정), 포인트는 원색(파랑·분홍·초록)으로 하고, 글자는 굵고 크게 해주세요. 버튼을 누르면 그림자가 줄어들며 눌리는 효과를 넣어주세요.',
  },
  {
    id: 'nature',
    name: '자연 · 숲',
    summary: '차분한 초록·베이지 + 부드러운 곡선',
    swatchClass: 'swatch-nature',
    text: '숲과 자연을 닮은 차분한 디자인으로 해주세요. 이끼색·올리브·연한 베이지·흙색 팔레트를 쓰고, 모서리는 잎사귀처럼 비대칭으로 둥글게(예: 24px 6px 24px 6px), 그림자는 낮고 부드럽게, 아이콘과 일러스트는 선이 얇고 둥근 스타일로 해주세요. 글자는 짙은 갈색 또는 짙은 초록으로 해주세요.',
  },
  {
    id: 'retro',
    name: '레트로 픽셀',
    summary: '8비트 게임 · 픽셀 글꼴 · 각진 버튼',
    swatchClass: 'swatch-retro',
    text: '옛날 8비트 게임 같은 레트로 픽셀 스타일로 디자인해주세요. 어두운 남보라 배경에 노랑·분홍·하늘·연두의 밝은 원색 포인트, 모서리는 둥글지 않고 계단 모양(또는 각진 테두리), 제목에는 픽셀 글꼴(예: DotGothic16 또는 Press Start 2P, Google Fonts)을 쓰되 본문은 읽기 쉬운 글꼴로 해주세요. 버튼은 눌리는 느낌이 나게 해주세요.',
  },
  {
    id: 'editorial',
    name: '에디토리얼 (잡지)',
    summary: '큰 세리프 제목 + 흑백 + 한 가지 포인트 색',
    swatchClass: 'swatch-editorial',
    text: '잡지·신문 같은 에디토리얼 스타일로 디자인해주세요. 배경은 아주 옅은 크림색, 글자는 거의 검정, 포인트는 진한 빨강 하나만 쓰고, 큰 제목은 세리프 글꼴(예: Noto Serif KR, Google Fonts)로 아주 크게, 본문은 고딕으로 해주세요. 카드 대신 가는 구분선과 넉넉한 여백으로 영역을 나누고, 그림자와 둥근 모서리는 쓰지 말아주세요.',
  },
  {
    id: 'contrast',
    name: '고대비 (잘 보이게)',
    summary: '검정·흰·노랑 + 아주 큰 글씨 + 굵은 포커스',
    swatchClass: 'swatch-contrast',
    text: '누구나 잘 보이는 고대비 접근성 디자인으로 해주세요. 검정 배경에 흰색 글자와 노란색 강조(또는 흰 배경에 검정 글자와 진한 파랑 강조)로 대비를 최대로 하고, 글자는 기본 18px 이상, 버튼은 높이 48px 이상으로 크게, 키보드로 이동할 때 보이는 포커스 테두리는 3px 이상 굵게 해주세요. 색만으로 구분하지 말고 글자나 아이콘도 함께 써주세요.',
  },
  {
    id: 'sunset',
    name: '선셋 그라데이션',
    summary: '주황→분홍→보라 그라데이션 + 반투명 카드',
    swatchClass: 'swatch-sunset',
    text: '노을 같은 선셋 그라데이션 스타일로 디자인해주세요. 배경은 주황에서 분홍, 보라로 이어지는 큰 그라데이션, 카드는 반투명한 흰색(blur 포함)에 얇은 밝은 테두리, 버튼은 흰색 바탕에 보라색 글자로 해주세요. 글자가 배경색 때문에 읽기 어려워지지 않도록 대비를 충분히 확보해주세요.',
  },
];

const CLOSING_TEXT = '빌드 도구(Vite, React, webpack 등) 없이 순수 HTML/CSS/JS로 작성해주세요. 데스크톱과 모바일 화면 모두에서 자연스럽게 보이도록 반응형으로 만들어주세요. 화면에 보이는 버튼, 안내 문구, 오류 메시지 등 모든 텍스트는 한국어로 작성해주세요. TODO나 "여기에 구현" 같은 미완성 부분 없이, 위에 적은 기능들이 실제로 클릭하면 동작하는 완성된 코드로 작성해주세요. 입력값이 비어있거나 잘못된 경우에도 오류 없이 자연스럽게 동작하도록 예외 처리를 해주세요. 먼저 바로 실행 가능한 완성된 웹앱 코드를 한 번에 작성하고, 필요한 설명은 코드 작성이 끝난 뒤에 해주세요. 단, 위에서 설명한 제약 조건(빌드 도구 미사용, 지정한 데이터 저장 방식 등) 때문에 제가 원하는 기능을 제대로 구현하기 어렵다면, 마음대로 다른 방식으로 바꾸지 말고 먼저 어떤 제약을 왜 바꿔야 하는지 저에게 물어봐주세요. 제가 좋다고 하면 그때 그 기능을 추가하는 방법(설치·설정 방법 포함)까지 코드와 함께 설명해주세요. 저는 바이브코딩이 처음입니다.';

// 데이터 저장 방식별 삽입 문구. 받는 사람이 코드를 직접 고칠 줄 모른다는 전제라,
// 연결에 필요한 값은 AI가 채팅으로 물어보고 직접 반영하게 하고, 시트 머리글이나
// 드라이브 폴더처럼 물어볼 필요 없는 건 Apps Script가 처음 실행될 때 만들게 한다.
// 시트는 CORS·배포 권한·재배포에서, Firebase는 30일 뒤 막히는 테스트 모드에서
// 처음 하는 사람이 가장 많이 막힌다.
const NO_MANUAL_EDIT_TEXT = '저는 코드를 직접 고칠 줄 모릅니다. 연결에 필요한 값은 웹앱 코드를 다 만든 뒤에 하나씩 저에게 물어봐주시고, 제가 채팅으로 알려주면 직접 코드에 반영해주세요. 제가 다른 곳(Apps Script 편집기, Firebase 콘솔 등)에 붙여넣어야 하는 코드는 고칠 부분 없이 그대로 복사해서 붙여넣기만 하면 되는 완성된 상태로 주세요.';

const STORAGE_TEXT = {
  local: '데이터 저장은 브라우저 localStorage만 사용해주세요. 로그인이나 외부 서비스 연동 없이, 각 사용자의 브라우저 안에만 데이터가 저장되면 됩니다.',
  sheets: [
    '데이터는 Google 스프레드시트에 저장하고 불러와주세요. 스프레드시트에 연결된 Google Apps Script를 웹앱(Web App)으로 배포하고, 그 배포 URL로 fetch를 보내 데이터를 읽고(doGet) 쓰는(doPost) 방식으로 구현해주세요.',
    '브라우저에서 Apps Script로 POST를 보낼 때 CORS 오류가 나지 않도록, 요청 본문은 JSON 문자열로 보내되 Content-Type은 "text/plain;charset=utf-8"로 지정하고 다른 헤더는 추가하지 마세요. 여러 사람이 동시에 저장해도 데이터가 덮어써지지 않도록 Apps Script 쪽에서 LockService를 사용해주세요.',
    '시트 탭과 첫 줄 열 제목은 Apps Script가 처음 실행될 때 없으면 직접 만들도록 해서, 제가 시트에 미리 입력할 것이 없게 해주세요.',
    NO_MANUAL_EDIT_TEXT,
    '그리고 아래 순서대로 단계별로 안내해주세요: (1) 새 구글 스프레드시트를 만들고 메뉴의 확장 프로그램 → Apps Script를 여는 방법, (2) 거기에 그대로 붙여넣을 Apps Script 전체 코드, (3) 배포 → 새 배포 → 유형 "웹 앱"을 고르고 실행 사용자 "나", 액세스 권한 "모든 사용자"로 배포한 뒤 권한을 승인하는 방법, (4) 배포 후 나온 웹 앱 URL을 저에게 알려달라고 요청하고, 제가 알려주면 웹앱 코드에 반영하기, (5) 나중에 Apps Script 코드를 바꿔야 할 때는 "배포 관리"에서 새 버전으로 업데이트해야 URL이 그대로 유지된다는 점, (6) 이 방식은 웹 앱 URL을 아는 사람이면 누구나 데이터에 접근할 수 있다는 보안상 한계.',
  ].join(' '),
  firebase: [
    '데이터는 Firebase(Firestore)에 저장하고 불러와주세요. Firebase JS SDK(CDN 방식)를 사용해서 구현해주세요.',
    'Firestore의 테스트 모드는 30일 뒤에 읽기·쓰기가 막히므로, 이 앱에 맞는 Firestore 보안 규칙도 함께 작성해주세요.',
    NO_MANUAL_EDIT_TEXT,
    '그리고 아래 순서대로 단계별로 안내해주세요: (1) Firebase 콘솔(console.firebase.google.com)에서 새 프로젝트를 만드는 방법, (2) Firestore Database를 만드는 방법, (3) Firestore의 "규칙" 탭에 그대로 붙여넣고 게시할 보안 규칙, (4) 프로젝트 설정에서 "웹 앱 추가"로 앱을 등록한 뒤 나오는 firebaseConfig 값을 저에게 알려달라고 요청하고, 제가 알려주면 웹앱 코드에 반영하기.',
  ].join(' '),
};

// 시트에는 칸당 5만 자 제한이 있어 사진·PDF는 같은 Apps Script로 드라이브 폴더에
// 넣고 시트엔 링크만 남긴다. Firebase Storage는 결제 카드 등록(Blaze)이 필요해 제외.
const FILE_TEXT = [
  '사진·PDF 같은 파일도 저장해야 합니다. 파일은 위의 Apps Script로 구글 드라이브의 한 폴더에 저장하고, 스프레드시트에는 그 파일의 ID와 링크만 기록해주세요.',
  '저장할 폴더는 Apps Script가 처음 실행될 때 직접 만들고 그 폴더 ID를 PropertiesService에 기억해 두도록 해서, 제가 폴더를 만들거나 ID를 입력할 일이 없게 해주세요.',
  '브라우저에서 파일을 base64로 바꿔 위와 같은 방식(Content-Type "text/plain;charset=utf-8"의 POST)으로 보내고, 사진은 올리기 전에 브라우저에서 긴 변 1600px 정도의 JPEG로 줄여서 보내주세요. 10MB가 넘는 파일은 올리기 전에 안내 메시지로 막아주세요.',
  '저장한 파일은 "링크가 있는 모든 사용자"가 볼 수 있게 공유 설정하고, 화면에 사진을 보여줄 때는 https://drive.google.com/thumbnail?id=파일ID&sz=w1000 형식의 주소를 사용해주세요.',
  '드라이브 접근 권한을 승인하는 화면이 나오면 어떻게 승인하는지도 설명해주세요.',
].join(' ');

// ── 추가 입력 요소 문구 ──
const ADMIN_TEXT = {
  password: {
    local: '관리자 전용 화면도 따로 만들어주세요(예: admin.html). 일반 화면에는 관리 기능이 보이지 않게 하고, 관리자는 비밀번호를 입력해야 들어갈 수 있게 해주세요. 이 방식은 코드를 열어보면 비밀번호가 보이는 가벼운 잠금일 뿐이라는 점도 코드 작성 후 알려주세요.',
    sheets: '관리자 전용 화면도 따로 만들어주세요(예: admin.html). 일반 화면에는 관리 기능이 보이지 않게 하고, 관리자는 비밀번호를 입력해야 들어갈 수 있게 해주세요. 비밀번호는 웹앱 코드에 직접 쓰지 말고 Apps Script의 속성(PropertiesService)에 저장해서 Apps Script에서 확인하게 하고, 비밀번호를 처음 정하는 방법도 알려주세요.',
    firebase: '관리자 전용 화면도 따로 만들어주세요(예: admin.html). 일반 화면에는 관리 기능이 보이지 않게 하고, 관리자는 Firebase Authentication의 이메일/비밀번호 로그인으로만 들어갈 수 있게 해주세요. 관리자 계정을 만드는 방법과, 관리자만 읽고 쓸 수 있도록 하는 보안 규칙도 알려주세요.',
  },
  google: '관리자 전용 화면도 따로 만들어주세요(예: admin.html). 일반 화면에는 관리 기능이 보이지 않게 하고, 관리자는 구글 로그인으로 들어가며 제가 알려주는 구글 계정(이메일 목록)만 허용해주세요. 이 로그인을 위해 Firebase Authentication을 함께 써야 한다면 먼저 저에게 물어봐주세요.',
};
const OPT_TEXT = {
  sample: '처음 실행했을 때 빈 화면이 아니라 앱이 어떻게 동작하는지 바로 보이도록 가상의 예시 데이터(실제 사람 이름이 아닌 가짜 이름과 내용)를 넣어주고, 예시 데이터를 한 번에 지우는 버튼도 만들어주세요.',
  csv: '저장된 데이터를 CSV 파일로 내려받는 버튼을 넣어주세요(엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 포함해주세요).',
  print: '내용을 종이로 깔끔하게 인쇄할 수 있도록 인쇄용 화면(버튼·메뉴는 숨기고 내용만 보이게)도 만들어주세요.',
  privacy: '학생 이름·성적 같은 개인정보를 다루는 앱입니다. 꼭 필요한 정보만 저장하고, 화면에 필요 이상으로 드러내지 않게 해주세요. 그리고 코드 작성이 끝난 뒤에, 공개 주소로 배포했을 때 개인정보가 누구에게 보일 수 있는지와 접근을 제한하는 방법을 알려주세요.',
  darkmode: '화면 위쪽에 다크 모드 전환 버튼을 넣고, 선택한 모드는 기억해주세요.',
};
const ACCENT_COLOR = { '파랑': '파랑(#2f7df6 계열)', '보라': '보라(#7a5af8 계열)', '초록': '초록(#22a96b 계열)', '주황': '주황(#f08a24 계열)', '분홍': '분홍(#ec5fa0 계열)', '빨강': '빨강(#e5484d 계열)' };
const DENSITY_TEXT = {
  large: '글자와 버튼을 평소보다 크게(교실 맨 뒤에서도 보이도록 본문 20px 이상) 만들어주세요.',
  compact: '한 화면에 많은 정보가 보이도록 간격과 글자 크기를 촘촘하게 만들어주세요. 단, 버튼은 손가락으로 누르기 편한 크기를 유지해주세요.',
};

// data-x 가 붙은 입력 요소(칩 선택, 추가 요청)의 값을 한 번에 읽고 쓰는 도우미
function readExtras() {
  const x = {};
  document.querySelectorAll('[data-x]').forEach((el) => {
    if (el.type === 'checkbox') { if (el.checked) (x[el.name] = x[el.name] || []).push(el.value); }
    else if (el.type === 'radio') { if (el.checked) x[el.name] = el.value; }
    else x[el.name] = el.value;
  });
  return x;
}
function writeExtras(x) {
  x = x || {};
  document.querySelectorAll('[data-x]').forEach((el) => {
    if (el.type === 'checkbox') el.checked = Array.isArray(x[el.name]) && x[el.name].includes(el.value);
    else if (el.type === 'radio') el.checked = (x[el.name] === undefined ? el.defaultChecked : x[el.name] === el.value);
    else el.value = x[el.name] || '';
  });
}

const state = {
  features: [],
  storage: null, // 'local' | 'sheets' | 'firebase'
  designMode: 'custom', // 'custom' | 'preset'
  selectedPreset: null,
};

let featureSeq = 0;
function newFeature() {
  featureSeq++;
  return { key: 'f' + featureSeq, name: '', desc: '', steps: [''] };
}

// 수정 프롬프트(웹앱 수정하기) 화면 전용 상태 — 원래 마법사의 state와는 별개.
const reviseState = {
  newFeatures: [],
  existingNotes: {}, // 기존 기능 key -> 수정 요청 텍스트
  designMode: 'custom',
  selectedPreset: null,
};

let newFeatureSeq = 0;
function newFeatureForRevise() {
  newFeatureSeq++;
  return { key: 'nf' + newFeatureSeq, name: '', desc: '', steps: [''] };
}

// ============================================================
//  기능 목록 (동적 카드)
// ============================================================

function addFeature() {
  state.features.push(newFeature());
  renderFeatures();
  saveDraft();
}

function removeFeature(key) {
  state.features = state.features.filter((f) => f.key !== key);
  renderFeatures();
  saveDraft();
}

function moveFeature(key, dir) {
  const i = state.features.findIndex((f) => f.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.features.length) return;
  [state.features[i], state.features[j]] = [state.features[j], state.features[i]];
  renderFeatures();
  saveDraft();
}

function addStep(featureKey) {
  const f = state.features.find((x) => x.key === featureKey);
  if (f) f.steps.push('');
  renderFeatures();
  saveDraft();
}

function removeStep(featureKey, idx) {
  const f = state.features.find((x) => x.key === featureKey);
  if (f) f.steps.splice(idx, 1);
  renderFeatures();
  saveDraft();
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderFeatures() {
  const el = document.getElementById('featureList');
  if (!state.features.length) {
    el.innerHTML = '<div class="empty-features">아직 추가된 기능이 없습니다. "기능 추가" 버튼을 눌러보세요.</div>';
    return;
  }

  el.innerHTML = state.features.map((f, i) => `
    <div class="feature-card" data-key="${f.key}">
      <div class="feature-card-head">
        <span>기능 ${i + 1}</span>
        <div class="feature-card-actions">
          <button class="icon-btn" type="button" title="위로 이동" onclick="moveFeature('${f.key}', -1)" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="icon-btn" type="button" title="아래로 이동" onclick="moveFeature('${f.key}', 1)" ${i === state.features.length - 1 ? 'disabled' : ''}>▼</button>
          <button class="icon-btn" type="button" title="기능 삭제" onclick="removeFeature('${f.key}')">✕</button>
        </div>
      </div>
      <div class="feature-row">
        <label>기능 이름</label>
        <input type="text" class="inp" placeholder="예: 집중 타이머" value="${esc(f.name)}"
          oninput="updateFeatureField('${f.key}', 'name', this.value)">
      </div>
      <div class="feature-row">
        <label>기능 소개 (1~2줄)</label>
        <input type="text" class="inp" placeholder="예: 설정한 시간 동안 카운트다운하고 종료 시 알림을 준다"
          value="${esc(f.desc)}" oninput="updateFeatureField('${f.key}', 'desc', this.value)">
      </div>
      <div class="feature-row">
        <label>작동 단계</label>
        <div class="step-list">
          ${f.steps.map((s, si) => `
            <div class="step-row">
              <span class="step-row-num">${si + 1}단계</span>
              <input type="text" class="inp" placeholder="예: 사용자가 시작 버튼을 누른다"
                value="${esc(s)}" oninput="updateStepField('${f.key}', ${si}, this.value)">
              ${f.steps.length > 1 ? `<button class="icon-btn" type="button" title="단계 삭제" onclick="removeStep('${f.key}', ${si})">✕</button>` : ''}
            </div>
          `).join('')}
        </div>
        <button class="btn ghost sm" type="button" style="margin-top:8px;" onclick="addStep('${f.key}')">+ 단계 추가</button>
      </div>
    </div>
  `).join('');
}

function updateFeatureField(key, field, value) {
  const f = state.features.find((x) => x.key === key);
  if (f) f[field] = value;
  saveDraft();
}
function updateStepField(key, idx, value) {
  const f = state.features.find((x) => x.key === key);
  if (f) f.steps[idx] = value;
  saveDraft();
}

// ============================================================
//  웹앱 수정하기 — 새로 추가할 기능 (기능 목록과 동일한 카드형 UI)
// ============================================================

function addNewFeature() {
  reviseState.newFeatures.push(newFeatureForRevise());
  renderNewFeatures();
  saveDraft();
}

function removeNewFeature(key) {
  reviseState.newFeatures = reviseState.newFeatures.filter((f) => f.key !== key);
  renderNewFeatures();
  saveDraft();
}

function moveNewFeature(key, dir) {
  const i = reviseState.newFeatures.findIndex((f) => f.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= reviseState.newFeatures.length) return;
  [reviseState.newFeatures[i], reviseState.newFeatures[j]] = [reviseState.newFeatures[j], reviseState.newFeatures[i]];
  renderNewFeatures();
  saveDraft();
}

function addNewFeatureStep(key) {
  const f = reviseState.newFeatures.find((x) => x.key === key);
  if (f) f.steps.push('');
  renderNewFeatures();
  saveDraft();
}

function removeNewFeatureStep(key, idx) {
  const f = reviseState.newFeatures.find((x) => x.key === key);
  if (f) f.steps.splice(idx, 1);
  renderNewFeatures();
  saveDraft();
}

function updateNewFeatureField(key, field, value) {
  const f = reviseState.newFeatures.find((x) => x.key === key);
  if (f) f[field] = value;
  saveDraft();
}
function updateNewFeatureStepField(key, idx, value) {
  const f = reviseState.newFeatures.find((x) => x.key === key);
  if (f) f.steps[idx] = value;
  saveDraft();
}

function renderNewFeatures() {
  const el = document.getElementById('newFeatureList');
  if (!reviseState.newFeatures.length) {
    el.innerHTML = '<div class="empty-features">추가할 새 기능이 없다면 비워두고 넘어가도 됩니다.</div>';
    return;
  }

  el.innerHTML = reviseState.newFeatures.map((f, i) => `
    <div class="feature-card" data-key="${f.key}">
      <div class="feature-card-head">
        <span>새 기능 ${i + 1}</span>
        <div class="feature-card-actions">
          <button class="icon-btn" type="button" title="위로 이동" onclick="moveNewFeature('${f.key}', -1)" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="icon-btn" type="button" title="아래로 이동" onclick="moveNewFeature('${f.key}', 1)" ${i === reviseState.newFeatures.length - 1 ? 'disabled' : ''}>▼</button>
          <button class="icon-btn" type="button" title="기능 삭제" onclick="removeNewFeature('${f.key}')">✕</button>
        </div>
      </div>
      <div class="feature-row">
        <label>기능 이름</label>
        <input type="text" class="inp" placeholder="예: 초 단위 진동 알림" value="${esc(f.name)}"
          oninput="updateNewFeatureField('${f.key}', 'name', this.value)">
      </div>
      <div class="feature-row">
        <label>기능 소개 (1~2줄)</label>
        <input type="text" class="inp" placeholder="예: 소리 대신 화면 전체가 깜빡이며 알려준다"
          value="${esc(f.desc)}" oninput="updateNewFeatureField('${f.key}', 'desc', this.value)">
      </div>
      <div class="feature-row">
        <label>작동 단계</label>
        <div class="step-list">
          ${f.steps.map((s, si) => `
            <div class="step-row">
              <span class="step-row-num">${si + 1}단계</span>
              <input type="text" class="inp" placeholder="예: 시간이 끝나면 화면이 3번 깜빡인다"
                value="${esc(s)}" oninput="updateNewFeatureStepField('${f.key}', ${si}, this.value)">
              ${f.steps.length > 1 ? `<button class="icon-btn" type="button" title="단계 삭제" onclick="removeNewFeatureStep('${f.key}', ${si})">✕</button>` : ''}
            </div>
          `).join('')}
        </div>
        <button class="btn ghost sm" type="button" style="margin-top:8px;" onclick="addNewFeatureStep('${f.key}')">+ 단계 추가</button>
      </div>
    </div>
  `).join('');
}

// ============================================================
//  웹앱 수정하기 — 기존 기능 수정 (읽기 전용 + 수정 요청 메모)
// ============================================================

function renderExistingFeatureNotes() {
  const el = document.getElementById('existingFeatureNotes');
  const feats = state.features.filter((f) => f.name.trim());
  if (!feats.length) {
    el.innerHTML = '<div class="empty-features">수정할 기존 기능이 없습니다.</div>';
    return;
  }
  el.innerHTML = feats.map((f) => {
    const steps = f.steps.map((s) => s.trim()).filter(Boolean);
    return `
    <div class="existing-feature-card">
      <div class="existing-feature-locked">
        <div class="existing-feature-name">${esc(f.name)}</div>
        <div class="existing-feature-desc">${esc(f.desc || '(설명 없음)')}</div>
        ${steps.length ? `<ol class="existing-feature-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
      </div>
      <label>이 기능을 이렇게 수정해주세요 (수정하지 않으려면 비워두세요. 특정 단계를 콕 집어 얘기하려면 "2번째 단계를 ~로 바꿔주세요"처럼 적어도 됩니다)</label>
      <textarea class="inp" rows="2" placeholder="예: 시작 버튼을 누르면 3초 카운트다운 후 시작하게 해주세요"
        oninput="updateExistingNote('${f.key}', this.value)">${esc(reviseState.existingNotes[f.key] || '')}</textarea>
    </div>
  `;
  }).join('');
}

function updateExistingNote(key, value) {
  reviseState.existingNotes[key] = value;
  saveDraft();
}

// ============================================================
//  디자인 (직접 작성 / 견본 선택)
// ============================================================

function setDesignMode(mode) {
  state.designMode = mode;
  document.getElementById('modeBtn-custom').classList.toggle('active', mode === 'custom');
  document.getElementById('modeBtn-preset').classList.toggle('active', mode === 'preset');
  document.getElementById('designCustom').hidden = mode !== 'custom';
  document.getElementById('designPreset').hidden = mode !== 'preset';
  saveDraft();
}

function renderPresets() {
  const el = document.getElementById('presetGrid');
  el.innerHTML = DESIGN_PRESETS.map((p) => `
    <div class="preset-card${state.selectedPreset === p.id ? ' selected' : ''}" onclick="selectPreset('${p.id}')">
      <div class="preset-swatch ${p.swatchClass}"></div>
      <div class="preset-name">${p.name}</div>
      <div class="preset-desc">${p.summary}</div>
    </div>
  `).join('');
}

function selectPreset(id) {
  state.selectedPreset = id;
  renderPresets();
  saveDraft();
}

function setReviseDesignMode(mode) {
  reviseState.designMode = mode;
  document.getElementById('reviseModeBtn-custom').classList.toggle('active', mode === 'custom');
  document.getElementById('reviseModeBtn-preset').classList.toggle('active', mode === 'preset');
  document.getElementById('reviseDesignCustom').hidden = mode !== 'custom';
  document.getElementById('reviseDesignPreset').hidden = mode !== 'preset';
  saveDraft();
}

function renderRevisePresets() {
  const el = document.getElementById('revisePresetGrid');
  el.innerHTML = DESIGN_PRESETS.map((p) => `
    <div class="preset-card${reviseState.selectedPreset === p.id ? ' selected' : ''}" onclick="selectRevisePreset('${p.id}')">
      <div class="preset-swatch ${p.swatchClass}"></div>
      <div class="preset-name">${p.name}</div>
      <div class="preset-desc">${p.summary}</div>
    </div>
  `).join('');
}

function selectRevisePreset(id) {
  reviseState.selectedPreset = id;
  renderRevisePresets();
  saveDraft();
}

// ============================================================
//  단계 이동 / 검증
// ============================================================

function goStep(n) {
  if (n === 2 && !validateStep1()) return;
  if (n === 3 && !validateStep2()) return;
  if (n === 4 && !validateStorage()) return;
  showStep(n);
}

function showStep(n) {
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  document.getElementById('panel-' + n).classList.add('active');

  document.getElementById('shell').classList.toggle('wide', n === 5);
  document.querySelectorAll('.step').forEach((s) => {
    const stepNum = Number(s.dataset.step);
    s.classList.toggle('active', stepNum === n);
    s.classList.toggle('done', stepNum < n);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function getPurpose() {
  const el = document.querySelector('input[name="purpose"]:checked');
  return el ? el.value : null;
}

function validateStep1() {
  const ok = !!getPurpose();
  document.getElementById('err-purpose').hidden = ok;
  return ok;
}

function validateStep2() {
  const topic = document.getElementById('topic').value.trim();
  const topicOk = !!topic;
  document.getElementById('err-topic').hidden = topicOk;

  const validFeatures = state.features.filter((f) => f.name.trim());
  const featuresOk = validFeatures.length > 0;
  document.getElementById('err-features').hidden = featuresOk;

  return topicOk && featuresOk;
}

function getStorage() {
  const el = document.querySelector('input[name="storage"]:checked');
  return el ? el.value : null;
}

function validateStorage() {
  const storage = getStorage();
  const ok = !!storage;
  document.getElementById('err-storage').hidden = ok;
  const filesOk = !document.getElementById('needFiles').checked || storage === 'sheets';
  document.getElementById('err-files').hidden = filesOk;
  return ok && filesOk;
}

function validateStep3() {
  let ok = false;
  if (state.designMode === 'custom') {
    ok = !!document.getElementById('designText').value.trim();
  } else {
    ok = !!state.selectedPreset;
  }
  document.getElementById('err-design').hidden = ok;
  return ok;
}

// ============================================================
//  프롬프트 조립
// ============================================================

// 입력된 내용만으로 프롬프트 줄들을 만든다. live=true 면 아직 안 채운 부분은 건너뛴다(미리보기용).
function buildPromptLines() {
  const purpose = getPurpose();
  const storage = getStorage();
  const topic = document.getElementById('topic').value.trim();
  const validFeatures = state.features.filter((f) => f.name.trim());
  const ex = readExtras();
  const lines = [];

  // 0. 앱을 만들어달라는 지시문임을 맨 앞에 명확히 한다 — 뒤따르는 문장들은
  // 전부 이 지시를 위한 조건/맥락이지, 앱 자체를 소개하는 글이 아니다.
  lines.push('아래 조건에 맞는 웹앱을 만들어주세요.');
  lines.push('');

  // 1. 목적별 삽입 문구
  if (purpose) { lines.push(PURPOSE_TEXT[purpose]); lines.push(''); }

  // 2. 주제 + 사용자 + 기기
  if (topic) lines.push(`이 앱의 주제는 ${topic}입니다.`);
  if (ex.users && ex.users.length) lines.push(`이 앱을 사용하는 사람은 ${ex.users.join(', ')}입니다.`);
  if (ex.devices && ex.devices.length) lines.push(`주로 ${ex.devices.join(', ')}에서 사용하니, 해당 화면 크기에서 버튼 크기와 배치가 편하도록 최적화해주세요.`);
  if (topic || (ex.users && ex.users.length) || (ex.devices && ex.devices.length)) lines.push('');

  // 3. 기능 목록
  if (validFeatures.length) {
    lines.push('다음 기능들을 구현해주세요. 각 기능은 적어놓은 순서/설명 그대로 실제로 동작해야 하고, 기능이 여러 개면 서로 방해하지 않고 함께 정상 동작해야 합니다:');
    validFeatures.forEach((f) => {
      lines.push(`- ${f.name}: ${f.desc || '(설명 없음)'}`);
      const steps = f.steps.map((s) => s.trim()).filter(Boolean);
      steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    });
    lines.push('');
  }
  if ((ex.extraText || '').trim()) { lines.push(`추가 요청: ${ex.extraText.trim()}`); lines.push(''); }

  // 4. 데이터 저장 방식 + 관리 페이지 + 함께 넣을 기능
  if (storage) {
    lines.push(STORAGE_TEXT[storage]);
    lines.push('');
    if (storage === 'sheets' && document.getElementById('needFiles').checked) { lines.push(FILE_TEXT); lines.push(''); }
  }
  if (ex.admin === 'password') { lines.push(ADMIN_TEXT.password[storage || 'local']); lines.push(''); }
  else if (ex.admin === 'google') { lines.push(ADMIN_TEXT.google); lines.push(''); }
  const opts = ex.opts || [];
  const optLines = ['sample', 'csv', 'print', 'privacy', 'darkmode'].filter((k) => opts.includes(k)).map((k) => OPT_TEXT[k]);
  if (optLines.length) { lines.push(...optLines); lines.push(''); }

  // 5. 디자인
  let design = '';
  if (state.designMode === 'custom') design = document.getElementById('designText').value.trim();
  else { const preset = DESIGN_PRESETS.find((p) => p.id === state.selectedPreset); design = preset ? preset.text : ''; }
  if (design) lines.push(design);
  if (ex.accent && ACCENT_COLOR[ex.accent]) lines.push(`포인트 색은 ${ACCENT_COLOR[ex.accent]}으로 해주세요.`);
  if (ex.density && DENSITY_TEXT[ex.density]) lines.push(DENSITY_TEXT[ex.density]);
  if (design || ex.accent || ex.density) lines.push('');

  // 6. 고정 문구
  lines.push(CLOSING_TEXT);
  return lines;
}

function generatePrompt() {
  if (!validateStep1()) { showStep(1); return; }
  if (!validateStep2()) { showStep(2); return; }
  if (!validateStorage()) { showStep(3); return; }
  if (!validateStep3()) return;

  document.getElementById('resultText').value = buildPromptLines().join('\n');
  showStep(5);
}

// 오른쪽 미리보기와 진행 체크리스트
function renderLive() {
  const live = document.getElementById('liveText');
  if (!live) return;
  const ok = {
    purpose: !!getPurpose(),
    topic: !!document.getElementById('topic').value.trim(),
    features: state.features.some((f) => f.name.trim()),
    storage: !!getStorage(),
    design: state.designMode === 'custom' ? !!document.getElementById('designText').value.trim() : !!state.selectedPreset,
  };
  document.querySelectorAll('#checklist li').forEach((li) => li.classList.toggle('done', !!ok[li.dataset.k]));
  const any = Object.values(ok).some(Boolean);
  const text = any ? buildPromptLines().join('\n') : '';
  live.textContent = text;
  document.getElementById('liveCount').textContent = text ? `${text.length.toLocaleString()}자` : '0자';
}

// ============================================================
//  웹앱 수정하기 — 화면 진입 / 수정 프롬프트 조립
// ============================================================

function openRevise() {
  renderNewFeatures();
  renderExistingFeatureNotes();
  renderRevisePresets();
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  document.getElementById('panel-revise').classList.add('active');
  document.getElementById('shell').classList.add('wide');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function generateRevisePrompt() {
  const newFeats = reviseState.newFeatures.filter((f) => f.name.trim());
  const notes = state.features
    .filter((f) => f.name.trim() && (reviseState.existingNotes[f.key] || '').trim())
    .map((f) => ({ f, note: reviseState.existingNotes[f.key].trim() }));
  const bug = document.getElementById('reviseBugText').value.trim();
  const designCustom = document.getElementById('reviseDesignText').value.trim();
  const hasDesign = reviseState.designMode === 'custom' ? !!designCustom : !!reviseState.selectedPreset;

  const hasAnything = newFeats.length > 0 || notes.length > 0 || !!bug || hasDesign;
  document.getElementById('err-revise').hidden = hasAnything;
  if (!hasAnything) return;

  const lines = [];
  lines.push('아래 요청대로 기존 웹앱을 수정해주세요. 언급하지 않은 기존 기능과 디자인은 그대로 유지해주세요.');
  lines.push('');

  if (newFeats.length) {
    lines.push('다음 기능을 새로 추가해주세요:');
    newFeats.forEach((f) => {
      lines.push(`- ${f.name}: ${f.desc || '(설명 없음)'}`);
      const steps = f.steps.map((s) => s.trim()).filter(Boolean);
      steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    });
    lines.push('');
  }

  if (notes.length) {
    lines.push('다음 기존 기능을 수정해주세요:');
    notes.forEach(({ f, note }) => {
      lines.push(`- ${f.name}`);
      lines.push(`  기존 설명: ${f.desc || '(설명 없음)'}`);
      const steps = f.steps.map((s) => s.trim()).filter(Boolean);
      if (steps.length) {
        lines.push('  기존 작동 단계:');
        steps.forEach((s, i) => lines.push(`    ${i + 1}. ${s}`));
      }
      lines.push(`  수정 요청: ${note}`);
    });
    lines.push('');
  }

  if (bug) {
    lines.push('다음 문제를 고쳐주세요:');
    lines.push(bug);
    lines.push('');
  }

  if (hasDesign) {
    lines.push('디자인을 다음과 같이 바꿔주세요:');
    if (reviseState.designMode === 'custom') {
      lines.push(designCustom);
    } else {
      lines.push(DESIGN_PRESETS.find((p) => p.id === reviseState.selectedPreset).text);
    }
    lines.push('');
  }

  lines.push('수정된 전체 코드를 다시 한 번에, 생략 없이 작성해주세요. (빌드 도구 없이 순수 HTML/CSS/JS, 기존에 쓰던 데이터 저장 방식(localStorage/구글 시트/Firebase 등) 그대로 유지, 화면 텍스트는 한국어 등 기존 제약은 동일하게 적용해주세요.) TODO나 "여기에 구현" 같은 미완성 부분 없이 실제로 동작하는 코드로 작성해주세요. 단, 이 제약 때문에 요청한 수정을 제대로 구현하기 어렵다면 마음대로 바꾸지 말고 먼저 왜 바꿔야 하는지 물어봐주시고, 제가 좋다고 하면 그 방법을 설명해주세요.');

  document.getElementById('resultText').value = lines.join('\n');
  showStep(5);
  toast('수정 프롬프트가 생성되었습니다');
}

// ============================================================
//  결과 화면: 복사 / 초기화
// ============================================================

async function copyResult() {
  const text = document.getElementById('resultText').value;
  try {
    await navigator.clipboard.writeText(text);
    toast('클립보드에 복사되었습니다');
  } catch {
    // Clipboard API를 못 쓰는 환경 — textarea 선택으로 대체
    const ta = document.getElementById('resultText');
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      toast('클립보드에 복사되었습니다');
    } catch {
      alert('복사에 실패했습니다. 직접 선택해서 복사해주세요.');
    }
  }
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function resetAll() {
  document.querySelectorAll('input[name="purpose"]').forEach((el) => { el.checked = false; });
  document.getElementById('topic').value = '';
  state.features = [newFeature()];
  renderFeatures();
  document.querySelectorAll('input[name="storage"]').forEach((el) => { el.checked = false; });
  document.getElementById('needFiles').checked = false;
  document.getElementById('designText').value = '';
  writeExtras({});
  state.selectedPreset = null;
  setDesignMode('custom');
  renderPresets();
  document.getElementById('err-purpose').hidden = true;
  document.getElementById('err-topic').hidden = true;
  document.getElementById('err-features').hidden = true;
  document.getElementById('err-storage').hidden = true;
  document.getElementById('err-files').hidden = true;
  document.getElementById('err-design').hidden = true;

  reviseState.newFeatures = [];
  reviseState.existingNotes = {};
  reviseState.selectedPreset = null;
  document.getElementById('reviseBugText').value = '';
  document.getElementById('reviseDesignText').value = '';
  setReviseDesignMode('custom');
  document.getElementById('err-revise').hidden = true;

  clearDraft();
  showStep(1);
}

// ============================================================
//  예시로 채워보기
// ============================================================

function fillExample() {
  document.querySelector('input[name="purpose"][value="edu"]').checked = true;
  document.getElementById('topic').value = '수업 집중용 타이머';

  state.features = [{
    key: 'f' + (++featureSeq),
    name: '집중 타이머',
    desc: '설정한 시간 동안 카운트다운하고, 시간이 끝나면 알림을 준다',
    steps: [
      '선생님이 분/초를 입력하고 시작 버튼을 누른다',
      '화면에 남은 시간이 큰 숫자로 표시된다',
      '시간이 끝나면 알림음이 울리고 화면이 깜빡인다',
    ],
  }];
  renderFeatures();

  document.querySelector('input[name="storage"][value="local"]').checked = true;

  writeExtras({ users: ['우리 반 학생'], devices: ['교실 전자칠판·빔프로젝터', 'PC·노트북'], admin: 'none', opts: ['sample'], density: 'large' });
  state.selectedPreset = 'sky';
  setDesignMode('preset');
  renderPresets();

  toast('예시 데이터를 채웠습니다. 자유롭게 고쳐서 써보세요');
  saveDraft();
}

// ============================================================
//  임시 저장 (localStorage) — 새로고침해도 작성 중이던 내용 유지
// ============================================================

const DRAFT_KEY = 'promptgen_draft';

function saveDraft() {
  try {
    const draft = {
      purpose: getPurpose(),
      topic: document.getElementById('topic').value,
      features: state.features.map((f) => ({ name: f.name, desc: f.desc, steps: f.steps })),
      storage: getStorage(),
      needFiles: document.getElementById('needFiles').checked,
      designMode: state.designMode,
      designText: document.getElementById('designText').value,
      selectedPreset: state.selectedPreset,
      extras: readExtras(),
      revise: {
        newFeatures: reviseState.newFeatures.map((f) => ({ name: f.name, desc: f.desc, steps: f.steps })),
        existingNotes: reviseState.existingNotes,
        bugText: document.getElementById('reviseBugText').value,
        designMode: reviseState.designMode,
        designText: document.getElementById('reviseDesignText').value,
        selectedPreset: reviseState.selectedPreset,
      },
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch { /* localStorage를 못 쓰는 환경이면 임시 저장은 그냥 건너뛴다 */ }
  renderLive();
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}

function loadDraft() {
  let draft;
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { draft = null; }
  if (!draft) return false;

  if (draft.purpose) {
    const el = document.querySelector(`input[name="purpose"][value="${draft.purpose}"]`);
    if (el) el.checked = true;
  }
  document.getElementById('topic').value = draft.topic || '';

  if (Array.isArray(draft.features) && draft.features.length) {
    state.features = draft.features.map((f) => ({
      key: 'f' + (++featureSeq),
      name: f.name || '',
      desc: f.desc || '',
      steps: Array.isArray(f.steps) && f.steps.length ? f.steps : [''],
    }));
  }

  if (draft.storage) {
    const el = document.querySelector(`input[name="storage"][value="${draft.storage}"]`);
    if (el) el.checked = true;
  }
  document.getElementById('needFiles').checked = !!draft.needFiles;

  document.getElementById('designText').value = draft.designText || '';
  state.selectedPreset = draft.selectedPreset || null;
  setDesignMode(draft.designMode === 'preset' ? 'preset' : 'custom');

  writeExtras(draft.extras);

  const r = draft.revise;
  if (r) {
    if (Array.isArray(r.newFeatures) && r.newFeatures.length) {
      reviseState.newFeatures = r.newFeatures.map((f) => ({
        key: 'nf' + (++newFeatureSeq),
        name: f.name || '',
        desc: f.desc || '',
        steps: Array.isArray(f.steps) && f.steps.length ? f.steps : [''],
      }));
    }
    reviseState.existingNotes = r.existingNotes && typeof r.existingNotes === 'object' ? r.existingNotes : {};
    document.getElementById('reviseBugText').value = r.bugText || '';
    document.getElementById('reviseDesignText').value = r.designText || '';
    reviseState.selectedPreset = r.selectedPreset || null;
    setReviseDesignMode(r.designMode === 'preset' ? 'preset' : 'custom');
  }

  return true;
}

// ============================================================
//  다크모드
// ============================================================

function toggleDark() {
  document.body.classList.toggle('dark');
  localStorage.setItem('dark', document.body.classList.contains('dark') ? '1' : '0');
}
if (localStorage.getItem('dark') === '1') document.body.classList.add('dark');
const darkToggleEl = document.getElementById('darkToggle');
darkToggleEl.addEventListener('click', toggleDark);
darkToggleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDark(); } });

// ============================================================
//  초기화
// ============================================================

if (!loadDraft()) {
  state.features.push(newFeature());
}
renderFeatures();
renderPresets();

renderLive();
