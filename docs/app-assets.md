# 앱 아이콘 / 스플래시 에셋 가이드 (제출 전 필수)

App Store 제출에는 실제 아이콘·스플래시 에셋(PNG 바이너리)이 필요합니다. 현재 리포지토리에는 최종 PNG 에셋이 포함되어 있지 않으며, 임시 **SVG 시안**만 제공합니다:

- `assets/icon-placeholder.svg` — 앱 아이콘 시안 (1024×1024, 불투명 배경, 보행자 + 경고 링).
- `assets/splash-placeholder.svg` — 스플래시 시안 (#1a7f37 배경 위 중앙 로고).

**이 SVG 들은 제출용이 아니며, 아래 사양의 PNG 로 교체해야 합니다.**

> **왜 PNG 가 저장소에 없나요?**
> 이 작업 환경(샌드박스)에는 SVG→PNG 변환 도구(rsvg-convert / Inkscape / ImageMagick / cairosvg / Pillow)가 하나도 설치되어 있지 않고, 외부망이 차단되어 설치도 불가능합니다. 따라서 **PNG 바이너리를 여기서 직접 생성할 수 없습니다.** 아래 "PNG 만드는 방법"을 사용자 로컬(또는 온라인 도구)에서 수행하세요.

`app.json` 에는 아직 `icon`/`splash` 경로를 연결하지 않았습니다. 존재하지 않는 PNG 를 참조하면 빌드가 실패하므로, **실제 PNG 를 추가한 뒤에** 아래 절차대로 경로를 연결하세요.

## 필요한 에셋 사양

| 용도 | 파일(권장 경로) | 사양 |
|---|---|---|
| App Store 아이콘 | `assets/icon.png` | **1024×1024 PNG, 알파(투명도) 없음**, 둥근 모서리 미적용(시스템이 처리) |
| 앱 아이콘(런타임) | `assets/icon.png` | Expo 가 위 1024 아이콘에서 파생 |
| 스플래시 이미지 | `assets/splash.png` | 최소 1242×2688 권장, 단색 배경(#1a7f37) 위 중앙 로고 |
| Android 적응형 아이콘 foreground | `assets/adaptive-icon.png` | 1024×1024, 안전 영역 고려한 여백 |

## PNG 만드는 방법 (시안 SVG 활용)

> **알파(투명도) 제거가 핵심**: App Store 아이콘은 **알파 채널이 없어야** 심사를 통과합니다. 배경을 불투명 단색(#1a7f37)으로 유지하고, 내보낼 때 투명 배경 옵션을 끄세요. (시안 SVG 는 이미 불투명 배경으로 만들어져 있습니다.)

### 방법 A — 온라인 변환 (가장 쉬움, 설치 불필요)

1. [CloudConvert SVG→PNG](https://cloudconvert.com/svg-to-png) 같은 온라인 변환기 접속.
2. `assets/icon-placeholder.svg` 업로드 → 출력 크기 **Width 1024 / Height 1024** 로 지정.
3. **알파/투명 배경 옵션을 끄기**(불투명 배경 유지). 변환 후 다운로드 → `assets/icon.png` 로 저장.
4. `assets/splash-placeholder.svg` 도 동일하게 변환(권장 1242×2688) → `assets/splash.png` 로 저장.

### 방법 B — 로컬 CLI (rsvg-convert)

```bash
# 아이콘 (1024x1024, 불투명 배경 위 렌더)
rsvg-convert -w 1024 -h 1024 -b "#1a7f37" assets/icon-placeholder.svg -o assets/icon.png

# 스플래시 (권장 1242x2688)
rsvg-convert -w 1242 -h 2688 -b "#1a7f37" assets/splash-placeholder.svg -o assets/splash.png
```

- `-b "#1a7f37"` 로 배경을 불투명하게 채워 알파를 제거합니다.
- Android 적응형 아이콘 foreground(`assets/adaptive-icon.png`)는 안전 영역 여백을 고려해 별도로 만드세요.

### 방법 C — Figma / Illustrator export

시안 SVG 를 열어 1024×1024 프레임에 배치하고 **PNG (배경 포함, 투명도 끄기)** 로 내보냅니다.

> 최종 브랜딩이 확정되면 이 임시 시안을 정식 디자인으로 교체하세요.

## app.json 연결 (PNG 추가 후)

실제 PNG 를 넣은 뒤 `app.json` 의 `expo` 블록에 아래를 추가합니다.

```json
{
  "expo": {
    "icon": "./assets/icon.png",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#1a7f37"
    },
    "ios": { "...": "기존 유지" },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#1a7f37"
      }
    }
  }
}
```

## 요약

- **현재 상태**: 최종 아이콘/스플래시 PNG 없음(임시 SVG 시안 `icon-placeholder.svg` / `splash-placeholder.svg` 만 존재). `app.json` 에 icon/splash 미연결(빌드 안전).
- **왜 PNG 가 없나**: 샌드박스에 SVG→PNG 변환 도구가 없고 외부망 차단으로 설치 불가.
- **제출 전 필수(사용자 로컬)**: 위 방법 A/B/C 중 하나로 PNG 생성(알파 끄기) → `assets/` 에 추가 → `app.json` 에 경로 연결 → EAS 빌드로 확인.
