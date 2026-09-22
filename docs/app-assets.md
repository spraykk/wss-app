# 앱 아이콘 / 스플래시 에셋 가이드 (제출 전 필수)

App Store 제출에는 실제 아이콘·스플래시 에셋(PNG 바이너리)이 필요합니다. 현재 리포지토리에는 최종 PNG 에셋이 포함되어 있지 않으며, 임시 시안으로 `assets/icon-placeholder.svg` 만 제공합니다. **이 SVG 는 제출용이 아니며, 아래 사양의 PNG 로 교체해야 합니다.**

`app.json` 에는 아직 `icon`/`splash` 경로를 연결하지 않았습니다. 존재하지 않는 PNG 를 참조하면 빌드가 실패하므로, **실제 PNG 를 추가한 뒤에** 아래 절차대로 경로를 연결하세요.

## 필요한 에셋 사양

| 용도 | 파일(권장 경로) | 사양 |
|---|---|---|
| App Store 아이콘 | `assets/icon.png` | **1024×1024 PNG, 알파(투명도) 없음**, 둥근 모서리 미적용(시스템이 처리) |
| 앱 아이콘(런타임) | `assets/icon.png` | Expo 가 위 1024 아이콘에서 파생 |
| 스플래시 이미지 | `assets/splash.png` | 최소 1242×2688 권장, 단색 배경 위 중앙 로고 |
| Android 적응형 아이콘 foreground | `assets/adaptive-icon.png` | 1024×1024, 안전 영역 고려한 여백 |

## PNG 만드는 방법 (플레이스홀더 시안 활용)

1. `assets/icon-placeholder.svg` 를 디자인 도구(Figma/Illustrator/Inkscape)나 CLI 로 1024×1024 PNG 로 내보냅니다.
   - 예: `rsvg-convert -w 1024 -h 1024 assets/icon-placeholder.svg -o assets/icon.png` (도구 설치 필요).
   - **알파 채널이 없어야** App Store 심사를 통과합니다. 배경을 불투명 단색으로 유지하세요.
2. 스플래시용으로 배경색(#1a7f37) 위 중앙 로고 형태의 `assets/splash.png` 를 별도로 만듭니다.
3. 최종 브랜딩이 확정되면 이 임시 시안을 정식 디자인으로 교체하세요.

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

- **현재 상태**: 최종 아이콘/스플래시 PNG 없음(임시 SVG 시안만 존재). `app.json` 에 icon/splash 미연결(빌드 안전).
- **제출 전 필수**: 위 사양의 PNG 생성 → `assets/` 에 추가 → `app.json` 에 경로 연결 → EAS 빌드로 확인.
