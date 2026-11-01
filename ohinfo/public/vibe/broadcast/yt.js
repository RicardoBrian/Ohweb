/* ─────────────────────────────────────────────────────────────
   유튜브 링크 유틸 (index / admin 공용)

   ▼ 아래 키를 채우면 admin.html 의 “🔍 찾기” 버튼이 앱 안에서 바로
     검색 결과를 보여 줍니다. 비워 두면 자동으로 “유튜브에서 검색 →
     주소 복사 → 붙여넣기” 방식으로 동작합니다. (기능은 그대로)

     키 발급 방법은 DEPLOY.md 의 “D. 유튜브 검색 자동화” 참고.
   ───────────────────────────────────────────────────────────── */

window.YT_API_KEY = ""; // 견본: 키 없음 → 유튜브에서 검색해 주소를 붙여넣는 방식

(function () {
  'use strict';

  // 유튜브 영상 ID는 항상 11자
  var ID_RE = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/|music\.youtube\.com\/watch\?(?:[^#]*&)?v=)([\w-]{11})/;

  /** 어떤 형태의 유튜브 주소든 영상 ID만 뽑아낸다. 실패하면 null. */
  function parseVideoId(text) {
    if (!text) return null;
    var s = String(text).trim();
    if (/^[\w-]{11}$/.test(s)) return s;            // ID를 그대로 붙여넣은 경우
    var m = s.match(ID_RE);
    return m ? m[1] : null;
  }

  function hasKey() {
    return !!(window.YT_API_KEY && window.YT_API_KEY.trim());
  }

  /** 곡명 + 가수 → 유튜브 검색어 */
  function query(song, artist) {
    return [song, artist].filter(Boolean).join(' ').trim();
  }

  /** 유튜브 검색 결과 페이지 주소 (키 없이도 사용) */
  function searchUrl(q) {
    return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
  }

  /**
   * 영상 ID 여러 개 → 로그인 없이 열리는 임시 재생목록.
   * 공식 문서에 없는 엔드포인트라 구글이 바꿀 수 있고, 한 번에 50개까지만
   * 안정적으로 동작합니다.
   */
  function playlistUrl(ids) {
    return 'https://www.youtube.com/watch_videos?video_ids=' + ids.slice(0, 50).join(',');
  }

  function watchUrl(id) {
    return 'https://www.youtube.com/watch?v=' + id;
  }

  function thumbUrl(id) {
    return 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg';
  }

  /**
   * YouTube Data API v3 검색. 키가 없으면 거부한다.
   * 검색 1회 = 할당량 100유닛 (기본 한도 10,000/일 → 하루 100회).
   */
  async function search(q, max) {
    if (!hasKey()) throw new Error('NO_KEY');
    var url = 'https://www.googleapis.com/youtube/v3/search' +
      '?part=snippet&type=video&videoEmbeddable=true' +
      '&maxResults=' + (max || 5) +
      '&q=' + encodeURIComponent(q) +
      '&key=' + encodeURIComponent(window.YT_API_KEY);

    var res = await fetch(url);
    if (!res.ok) {
      var body = await res.json().catch(function () { return null; });
      var reason = body && body.error && body.error.errors && body.error.errors[0]
        ? body.error.errors[0].reason : '';
      if (reason === 'quotaExceeded')
        throw new Error('오늘 유튜브 검색 할당량(하루 100회)을 다 썼습니다. 내일 다시 시도하거나 링크를 직접 붙여넣어 주세요.');
      if (res.status === 400 || reason === 'keyInvalid')
        throw new Error('유튜브 API 키가 올바르지 않습니다. yt.js의 YT_API_KEY를 확인하세요.');
      if (res.status === 403)
        throw new Error('유튜브 API 키가 이 도메인에서 거부됐습니다. Google Cloud에서 HTTP 리퍼러 제한을 확인하세요.');
      throw new Error('유튜브 검색 실패 (' + res.status + ')');
    }

    var data = await res.json();
    return (data.items || []).map(function (it) {
      return {
        videoId: it.id.videoId,
        title: it.snippet.title,
        channel: it.snippet.channelTitle,
        thumb: (it.snippet.thumbnails.medium || it.snippet.thumbnails.default).url
      };
    }).filter(function (v) { return v.videoId; });
  }

  /** 클립보드에서 유튜브 주소를 읽어 영상 ID를 반환. 실패 사유는 throw. */
  async function readClipboardVideoId() {
    if (!navigator.clipboard || !navigator.clipboard.readText)
      throw new Error('이 브라우저는 클립보드 읽기를 지원하지 않습니다. 주소를 직접 붙여넣어 주세요.');
    var text;
    try {
      text = await navigator.clipboard.readText();
    } catch (e) {
      throw new Error('클립보드 접근이 거부됐습니다. 주소를 입력란에 직접 붙여넣어 주세요.');
    }
    var id = parseVideoId(text);
    if (!id) throw new Error('클립보드에 유튜브 주소가 없습니다.');
    return id;
  }

  window.YTLink = {
    parseVideoId: parseVideoId,
    hasKey: hasKey,
    query: query,
    search: search,
    searchUrl: searchUrl,
    playlistUrl: playlistUrl,
    watchUrl: watchUrl,
    thumbUrl: thumbUrl,
    readClipboardVideoId: readClipboardVideoId
  };
})();
