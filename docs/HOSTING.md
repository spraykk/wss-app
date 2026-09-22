# 개인정보 처리방침 웹 호스팅 (GitHub Pages) — 사용자 클릭 가이드

App Store Connect 는 **공개 URL 로 접근 가능한 개인정보 처리방침**을 요구합니다.
이 저장소의 `docs/` 폴더는 그대로 GitHub Pages 로 게시할 수 있도록 준비되어 있습니다.

게시되면 다음과 같은 형태의 URL 이 생깁니다:

```
https://spraykk.github.io/wss-app/                     ← 진입 페이지 (docs/index.html)
https://spraykk.github.io/wss-app/privacy-policy.html  ← 개인정보 처리방침 전문
```

둘 중 아무거나 App Store Connect 개인정보 URL 로 써도 됩니다(진입 페이지 권장).

---

## 저장소에 이미 준비된 것

- `docs/index.html` — Pages 기본(진입) 페이지. 개인정보 처리방침 요약 + 전문 링크.
- `docs/privacy-policy.html` — 개인정보 처리방침 전문 (기존 유지).
- `docs/.nojekyll` — Jekyll 빌드를 건너뛰고 정적 HTML 을 그대로 서빙(파일명 규칙 이슈 회피).

사용자가 코드로 할 일은 **없습니다.** 아래는 GitHub 웹에서 클릭으로만 진행합니다.

---

## 클릭 단계 (GitHub 웹)

1. 저장소 페이지(`spraykk/wss-app`)로 이동 → 상단 **Settings** 탭.
2. 왼쪽 사이드바에서 **Pages**.
3. **Build and deployment** → **Source** 를 **"Deploy from a branch"** 로 선택.
4. **Branch** 에서 소스 브랜치를 고르고, 폴더는 **`/docs`** 로 선택 → **Save**.
   - 폴더 드롭다운에서 반드시 **`/docs`** 를 선택하세요(루트 `/` 아님).
5. 몇 분 뒤 페이지 상단에 **"Your site is live at https://spraykk.github.io/wss-app/"** 링크가 나타납니다.
6. 그 URL(또는 `.../privacy-policy.html`)을 열어 정상 표시되는지 확인합니다.

---

## 브랜치 관련 주의 (중요)

현재 이 저장소에는 브랜치가 여러 개 있습니다:

- 작업 브랜치: **`fix/wss-bugs`** (이 문서/HTML 이 커밋되는 곳)
- 그 외: `main`

Pages 의 **Branch** 드롭다운에는 **원격(origin)에 push 된 브랜치만** 나타납니다. 4번에서 브랜치를 고를 때 아래 중 하나를 선택하세요:

- **가장 간단**: `docs/` 변경이 들어있는 브랜치(예: `fix/wss-bugs` 가 병합된 브랜치, 또는 `main`)를 Pages 소스로 지정.
- `main` 을 소스로 쓰려면, 이 `docs/` 변경이 **`main` 에 병합**되어 있어야 페이지에 반영됩니다. (이 브랜치를 `main` 으로 PR 병합한 뒤 `main` 을 Pages 소스로 선택하는 흐름을 권장합니다.)

> 요약: Pages 소스 브랜치에 `docs/index.html` / `docs/privacy-policy.html` 이 존재해야 URL 이 살아납니다. `docs/` 변경을 담은 브랜치를 소스로 고르거나, 먼저 그 변경을 `main` 에 병합하세요.

---

## 게시 후 해야 할 일 (URL 반영)

1. 게시된 URL 을 **App Store Connect → 앱 정보 → 개인정보 처리방침 URL** 에 입력.
2. `docs/store-listing.md` 의 "개인정보 처리방침 URL" 항목을 실제 URL 로 교체.
3. `docs/privacy-policy.html` / `docs/privacy-policy.md` 의 담당자 이메일은 `spraykk@snu.ac.kr` 로 기입되어 있습니다. 변경이 필요하면 두 파일을 함께 수정한 뒤 다시 커밋/push.

---

## 문제 해결

- **404 가 뜬다**: (a) Pages 소스 브랜치에 `docs/index.html` 이 있는지, (b) 폴더가 `/docs` 로 지정됐는지, (c) 게시 후 1~3분 기다렸는지 확인.
- **스타일이 깨진다 / 페이지가 안 뜬다**: `docs/.nojekyll` 이 소스 브랜치에 포함됐는지 확인(정적 HTML 을 Jekyll 처리 없이 서빙).
- **최신 변경이 반영 안 됨**: Pages 는 소스 브랜치의 최신 커밋을 기준으로 재배포합니다. 변경을 소스 브랜치에 push(또는 병합)했는지 확인.
