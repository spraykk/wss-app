# 앱 아이콘 / 스플래시 에셋 가이드 (제출 전 필수)

App Store 제출에는 실제 아이콘·스플래시 에셋(PNG 바이너리)이 필요합니다. 현재 리포지토리에는 최종 PNG 에셋이 포함되어 있지 않으며, 정식 SVG 는 **파스텔 스카이블루 배경 + 흰색 발자국** 디자인입니다.

> ✅ **발자국 디자인 채택됨.** `assets/icon.svg` / `assets/splash.svg` 가 정식본입니다(불투명 **파스텔 스카이블루 `#BFE3F5`** 배경 + 중앙 **흰색 발자국 한 쌍**, 스플래시에는 앱 이름 `보행 개선` 텍스트 포함). PNG 변환 시 **배경 불투명 `#BFE3F5`, 아이콘 1024×1024, 알파(투명) 끄기**. 변환 후 `assets/icon.png` / `assets/splash.png` 로 저장하고 `app.json` 에 연결하세요. 지금은 PNG 가 없으므로 `app.json` 의 `icon` 경로는 유지하되(사용자가 새 PNG 로 교체) `splash` 는 미연결(빌드 안전) 상태를 유지합니다.

- **정식 아이콘**: `assets/icon.svg` (1024×1024, 불투명 파스텔 스카이블루 `#BFE3F5` 배경 + 흰색 발자국).
- **정식 스플래시**: `assets/splash.svg` (1242×2688 권장, 동일 톤 + `보행 개선` 텍스트).
- 이전 시안(레이더/틸, 위치 핀, 방패 등)은 `assets/icon-candidates/` · `assets/splash-candidates/` 에 보관(참고용).
- 시안 설명·채택 이력: [`assets/ICON_CANDIDATES.md`](../assets/ICON_CANDIDATES.md).

**이 SVG 는 제출용이 아니며, 아래 사양의 PNG 로 교체해야 합니다.**

> **왜 PNG 가 저장소에 없나요?**
> 이 작업 환경(샌드박스)에는 SVG→PNG 변환 도구(rsvg-convert / Inkscape / ImageMagick / cairosvg / Pillow)가 하나도 설치되어 있지 않고, 외부망이 차단되어 설치도 불가능합니다. 따라서 **PNG 바이너리를 여기서 직접 생성할 수 없습니다.** 아래 "PNG 만드는 방법"을 사용자 로컬(또는 온라인 도구)에서 수행하세요.

`app.json` 의 `icon` 경로는 `./assets/icon.png` 로 유지되어 있습니다(사용자가 새 발자국 PNG 를 이 경로에 저장하면 그대로 반영). `splash` 는 아직 연결하지 않았습니다 — 존재하지 않는 PNG 를 참조하면 빌드가 실패하므로, **실제 PNG 를 추가한 뒤에** 아래 절차대로 `splash` 경로를 연결하세요.

## 필요한 에셋 사양

| 용도 | 파일(권장 경로) | 사양 |
|---|---|---|
| App Store 아이콘 | `assets/icon.png` | **1024×1024 PNG, 알파(투명도) 없음**, 배경 `#BFE3F5`, 둥근 모서리 미적용(시스템이 처리) |
| 앱 아이콘(런타임) | `assets/icon.png` | Expo 가 위 1024 아이콘에서 파생 |
| 스플래시 이미지 | `assets/splash.png` | 최소 1242×2688 권장, 단색 배경(`#BFE3F5`) 위 중앙 발자국 로고 |
| Android 적응형 아이콘 foreground | `assets/adaptive-icon.png` | 1024×1024, 안전 영역 고려한 여백 |

## PNG 만드는 방법 (정식 SVG 활용)

> **알파(투명도) 제거가 핵심**: App Store 아이콘은 **알파 채널이 없어야** 심사를 통과합니다. 배경을 불투명하게 유지하고, 내보낼 때 투명 배경 옵션을 끄세요. (정식 SVG 는 이미 불투명 배경으로 만들어져 있습니다.) 배경색은 **`#BFE3F5`**(파스텔 스카이블루)입니다. 정식본 `assets/icon.svg` / `assets/splash.svg` 를 사용하세요.

### 방법 A — 온라인 변환 (가장 쉬움, 설치 불필요)

1. [CloudConvert SVG→PNG](https://cloudconvert.com/svg-to-png) 같은 온라인 변환기 접속.
2. 정식본 `assets/icon.svg` 업로드 → 출력 크기 **Width 1024 / Height 1024** 로 지정.
3. **알파/투명 배경 옵션을 끄기**(불투명 배경 유지). 변환 후 다운로드 → `assets/icon.png` 로 저장.
4. 대응 스플래시 `assets/splash.svg` 도 동일하게 변환(권장 1242×2688) → `assets/splash.png` 로 저장.

### 방법 B — 로컬 CLI (rsvg-convert)

```bash
# 아이콘 (1024x1024, 불투명 배경 위 렌더) — 파스텔 스카이블루 #BFE3F5
rsvg-convert -w 1024 -h 1024 -b "#BFE3F5" assets/icon.svg -o assets/icon.png

# 스플래시 (권장 1242x2688)
rsvg-convert -w 1242 -h 2688 -b "#BFE3F5" assets/splash.svg -o assets/splash.png
```

- `-b "#BFE3F5"` 로 배경을 불투명하게 채워 알파를 제거합니다.
- Android 적응형 아이콘 foreground(`assets/adaptive-icon.png`)는 안전 영역 여백을 고려해 별도로 만드세요.

### 방법 C — Figma / Illustrator export

정식본 SVG(`assets/icon.svg`)를 열어 1024×1024 프레임에 배치하고 **PNG (배경 포함, 투명도 끄기)** 로 내보냅니다.

> 최종 브랜딩이 확정되면 이 임시 시안을 정식 디자인으로 교체하세요.

## app.json 연결 (PNG 추가 후)

`icon` 은 이미 `./assets/icon.png` 로 연결되어 있으니 새 발자국 PNG 를 이 경로에 저장하면 반영됩니다. `splash` 는 실제 PNG 를 넣은 뒤 `app.json` 의 `expo` 블록에 아래를 추가합니다(`backgroundColor` 는 파스텔 스카이블루 `#BFE3F5`). **지금은 splash PNG 가 없으므로 splash 연결을 추가하지 마세요 — 없는 PNG 를 참조하면 빌드가 실패합니다.**

```json
{
  "expo": {
    "icon": "./assets/icon.png",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#BFE3F5"
    },
    "ios": { "...": "기존 유지" },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#BFE3F5"
      }
    }
  }
}
```

## 요약

- **현재 상태**: **발자국 디자인 채택 완료** — 정식본 `assets/icon.svg` / `assets/splash.svg` 존재(파스텔 스카이블루 `#BFE3F5` 배경 + 흰색 발자국). 최종 PNG 는 아직 없음. `app.json` 의 `icon` 은 `./assets/icon.png` 경로 유지, `splash` 미연결(빌드 안전). `adaptiveIcon.backgroundColor` 는 `#BFE3F5` 로 갱신됨.
- **왜 PNG 가 없나**: 샌드박스에 SVG→PNG 변환 도구가 없고 외부망 차단으로 설치 불가.
- **제출 전 필수(사용자 로컬)**: 위 방법 A/B/C 중 하나로 `assets/icon.svg` / `assets/splash.svg` 를 PNG 생성(배경 `#BFE3F5`, 알파 끄기) → `assets/icon.png` / `assets/splash.png` 로 추가 → `app.json` 에 splash 경로 연결(`backgroundColor` `#BFE3F5`) → EAS 빌드로 확인.
