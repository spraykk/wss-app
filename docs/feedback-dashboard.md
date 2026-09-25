# 테스터 피드백 증빙 대시보드 (docs/feedback.html)

테스터에게 앱 내 '의견 보내기'로 직접 받은 피드백을 **서버 원본 그대로** 보여주는
정적 웹 페이지입니다. 자소서/포트폴리오 증빙자료(캡처·PDF)로 쓰기 좋게 설계했습니다.

- 앱스토어 리뷰가 아니라 앱 안에서 직접 수집한 의견을 표시합니다.
- 조작·가공 없이 Supabase 서버가 기록한 원본(날짜·내용)을 그대로 보여줍니다.
- 작성자는 개인정보 보호를 위해 **익명 참조코드**(`left(md5(device_id),6)`)로만 표시됩니다.

## 1. 사전 준비 (DB)

`supabase/schema.sql` 을 Supabase 대시보드 > SQL Editor 에서 실행하세요(전체를 붙여넣고 Run).
이미 `wss_scores` 부분을 실행했다면, 파일 하단에 추가된 **feedback 테이블 / RPC** 부분만
다시 실행해도 됩니다(idempotent 하게 작성되어 재실행해도 안전합니다).

생성되는 것:

- `public.feedback` 테이블 (RLS on, anon insert 정책만)
- `list_feedback()` RPC — 원시 `device_id` 대신 익명 참조코드로 목록 반환(최신순)
- `get_feedback_summary()` RPC — 총건수·카테고리별·참여 기기수·평균 별점 요약

두 RPC 모두 anon 역할에 execute 권한이 부여됩니다. 원시 행 select/update/delete 는
정책이 없어 차단되므로, 공개(anon) 키로도 개별 원시 데이터에는 접근할 수 없습니다.

## 2. 키 설정 (배포 전 1회)

`docs/feedback.html` 상단의 `<script>` 안 두 상수를 본인 프로젝트 값으로 채웁니다.

```js
const SUPABASE_URL = "https://<your-project>.supabase.co";
const SUPABASE_ANON_KEY = "<anon(public) 키>";
```

- **반드시 anon(public/publishable) 키만** 사용하세요. `service_role`/secret 키는
  절대 넣지 마세요(원시 데이터 노출 위험).
- anon 키는 공개해도 되는 키지만, 소스 저장소에는 커밋하지 않도록 기본값을 비워 두었습니다.
  로컬에서 확인하거나 배포하는 시점에만 값을 채우고, 커밋 시에는 다시 비워 두는 것을 권장합니다.

## 3. 열어보기 / 배포

- **로컬 확인:** 브라우저로 `docs/feedback.html` 을 직접 열면 됩니다.
- **GitHub Pages 배포:** `docs/` 폴더가 이미 Pages 소스입니다(`docs/index.html` 등).
  키를 채운 `feedback.html` 을 push 하면 `https://<user>.github.io/<repo>/feedback.html`
  형태로 공개됩니다. (자세한 Pages 설정은 `docs/HOSTING.md` 참조.)
  - 공개 URL 에 키를 노출하고 싶지 않다면, 로컬에서만 키를 채워 열고 캡처/PDF 로 증빙을
    만든 뒤 키를 비운 상태로 커밋하세요.

## 4. 증빙 활용 (캡처 / PDF)

- 상단 요약(총 N건 · 참여자 M명 · 평균 별점 · 카테고리 분포)과 피드백 카드 목록이
  한 페이지에 보기 좋게 나옵니다. 카테고리 필터로 원하는 종류만 추려 캡처할 수 있습니다.
- **PDF로 저장:** 브라우저 인쇄(⌘/Ctrl+P) → "PDF로 저장". 인쇄 시 필터 버튼은 숨겨지고
  카드가 페이지 중간에서 잘리지 않도록 정리됩니다.
- 각 항목의 날짜는 서버 원본 타임스탬프라 "언제 수집했는지"를 신뢰성 있게 보여줍니다.
- 개선 이력은 이 대시보드가 관리하지 않습니다(직접 관리). 이 페이지는 수집분을 정직하게
  보여주는 용도입니다.

## 5. 표시되지 않는 것 (개인정보 보호)

- 원시 `device_id`, 위치·경로 등은 절대 표시되지 않습니다(애초에 수집하지 않거나 RPC가
  익명 참조코드로 대체).
- 가짜/샘플 피드백은 넣지 않습니다. 실제 수집분이 없으면 "표시할 피드백이 아직 없습니다"로
  정직하게 표시됩니다.
