# 앱 아이콘 / 스플래시 시안 (재디자인)

기존 시안(초록 배경 + 보행자 사람 심볼 + 노란 경고 점선 링)이 어색하다는 피드백을 반영해, **사람(보행자) 심볼을 제거**하고 **더 세련된 색상**으로 방향을 바꾼 3개 시안을 준비했습니다. 모두 추상/기하 모티프이며 안전·위치·감지 컨셉을 담았습니다.

> 모든 시안은 **1024×1024, 불투명 배경(알파 없음 — App Store 요구), 둥근 모서리 미적용(시스템이 마스킹)** 입니다. 아이콘에는 앱 이름 텍스트를 넣지 않았습니다(스플래시에만 텍스트 포함).

## 시안 목록

| 시안 | 파일 | 배경 색 | 포인트 색 | 모티프 |
|---|---|---|---|---|
| A | `assets/icon-candidates/icon-a.svg` | 딥 네이비→인디고 선형 그라데이션 (`#1e2a55`→`#2f3f7a`) | 인디고 라이트 (`#8ea2ff`/`#5f79e8`) | 미니멀 **위치 핀** + 은은한 동심원 **펄스** |
| B | `assets/icon-candidates/icon-b.svg` | 딥 틸→청록 세로 그라데이션 (`#0f3b45`→`#14515e`) | 틸/민트 (`#4fd1c5`→`#7ff2e6`) | 하단 원점에서 퍼지는 **레이더 동심 호**(주변 존 스캔) |
| C | `assets/icon-candidates/icon-c.svg` | 그래파이트 (`#23272e`→`#31363f`) | 코랄 `#ff6f5e` + 앰버 `#f0a13a` | 얇은 **방패** 외곽 + 중앙 포인트 도트 & 펄스 링 |

### 시안 A — 딥 네이비/인디고 · 위치 핀 펄스
차분한 네이비→인디고 대각선 그라데이션 위에, 중앙에 미니멀한 물방울형 **위치 핀**(가운데가 뚫린 형태)을 배치. 핀 뒤로 은은한 동심원 두 겹이 "펄스"처럼 퍼져 위치 감지를 암시합니다. 가장 절제되고 앱스토어 친화적인 무드.

### 시안 B — 틸/청록 · 레이더 웨이브
딥 틸 배경에 하단 기준점(현재 위치 도트)에서 위로 퍼지는 **동심 호 3겹**(레이더 스윕). 안쪽으로 갈수록 밝고 선명해져 "주변 위험/안전 존을 스캔"하는 느낌. 기술적이고 신뢰감 있는 톤.

### 시안 C — 그래파이트 + 코랄/앰버 포인트 · 방패 펄스
모노톤 그래파이트 배경에 얇은 **방패**(보호·안전) 외곽선을 두고, 중앙에 코랄 포인트 도트와 앰버 펄스 링을 배치. 모노톤 + 강렬한 포인트 컬러의 대비로 현대적이고 눈에 띄는 무드.

## 스플래시 시안 (아이콘 톤과 매칭)

각 아이콘 톤에 맞춘 세로형(1242×2688) 스플래시 시안을 함께 제공합니다. 배경 단색/그라데이션 + 중앙 로고 마크 + 앱 이름(`보행안전 WSS`) 텍스트.

| 대응 | 파일 | 배경 색 (app.json `backgroundColor`) |
|---|---|---|
| A | `assets/splash-candidates/splash-a.svg` | `#1e2a55` |
| B | `assets/splash-candidates/splash-b.svg` | `#0f3b45` |
| C | `assets/splash-candidates/splash-c.svg` | `#23272e` |

## 하나를 고른 뒤 채택 → PNG 변환 → app.json 연결

> **중요**: 이 샌드박스에는 SVG→PNG 변환 도구가 없고 외부망이 차단되어 **PNG 를 여기서 만들 수 없습니다.** 아래 절차는 사용자 로컬(또는 온라인 도구)에서 수행하세요. 변환 상세는 [`docs/app-assets.md`](../docs/app-assets.md) 참조.

### 1) 시안 채택 (SVG 확정)

고른 시안을 정식 파일명으로 복사합니다(예: 시안 A 선택 시).

```bash
cp assets/icon-candidates/icon-a.svg   assets/icon.svg
cp assets/splash-candidates/splash-a.svg assets/splash.svg
```

### 2) PNG 로 변환 (알파 끄기 필수)

App Store 아이콘은 **알파 채널이 없어야** 심사를 통과합니다. 시안 SVG 는 이미 불투명 배경입니다.

- **온라인**: [CloudConvert SVG→PNG](https://cloudconvert.com/svg-to-png) 에 `assets/icon.svg` 업로드 → **Width 1024 / Height 1024**, 투명 배경 옵션 **끄기** → `assets/icon.png` 로 저장. 스플래시도 동일(권장 1242×2688) → `assets/splash.png`.
- **로컬 CLI (rsvg-convert)** — 배경색은 고른 시안에 맞추세요:

```bash
# 예: 시안 A (#1e2a55)
rsvg-convert -w 1024 -h 1024 -b "#1e2a55" assets/icon.svg   -o assets/icon.png
rsvg-convert -w 1242 -h 2688 -b "#1e2a55" assets/splash.svg -o assets/splash.png
```

Android 적응형 아이콘 foreground(`assets/adaptive-icon.png`)는 안전 영역 여백을 고려해 별도로 만드세요.

### 3) app.json 연결 (PNG 추가 후에만)

실제 PNG 를 넣은 뒤 `app.json` 의 `expo` 블록에 연결합니다(`backgroundColor` 는 고른 시안 색으로). 없는 PNG 를 미리 참조하면 빌드가 실패하므로, **PNG 를 추가한 다음** 연결하세요. 상세 예시는 [`docs/app-assets.md`](../docs/app-assets.md) 참조.

## 기존 플레이스홀더 정리

기존 `assets/icon-placeholder.svg` / `assets/splash-placeholder.svg`(초록 배경 + 보행자 심볼)는 혼동을 피하기 위해 각각 `assets/icon-candidates/legacy-icon-placeholder.svg` / `assets/splash-candidates/legacy-splash-placeholder.svg` 로 이동해 보관합니다(참고용). 최종 채택은 위 A/B/C 중에서 선택하세요.
