# EAS 개발 빌드 가이드 (Expo Go → Dev Build 전환)

이 문서는 보행안전 WSS 앱을 **Expo Go** 에서 **EAS development build** 로 전환하는 정확한 절차와,
어떤 기능이 왜 dev build 를 강제하는지 설명한다.

> **핵심 전환점**: WSS 점수 계산·오디오 차음 판정·세션 리듀서 등 **순수 로직**은 Expo Go(또는 `node`
> 검증 스크립트)로 테스트할 수 있다. 그러나 **지오펜스·백그라운드 세션·실제 오디오 경로 감지의
> 온디바이스 첫 테스트**는 커스텀 네이티브 모듈이 필요하므로 **반드시 EAS development build** 에서만
> 가능하다. 이 앱에 `modules/audio-environment` 로컬 네이티브 모듈이 추가된 순간부터 **Expo Go 로는
> 앱을 실행할 수 없다.**

---

## 1. Expo Go 로 테스트 가능한 것 vs Dev Build 필수인 것

| 기능 | Expo Go | EAS dev build |
|---|---|---|
| WSS 점수 계산(engine/weights) | ✅ (순수 로직) | ✅ |
| 오디오 차음 판정 `isEarEffectivelyOccluded` | ✅ (순수 로직) | ✅ |
| 세션 리듀서 / 세그먼트 누적 | ✅ (순수 로직) | ✅ |
| 날씨 캐시 / 구역 dedup·geometry | ✅ (순수 로직) | ✅ |
| **다른 앱 재생 감지** (`AVAudioSession.isOtherAudioPlaying`) | ❌ | ✅ (`AudioEnvironment` 네이티브 모듈) |
| **블루투스 출력 경로 감지** (`currentRoute.outputs[].portType`) | ❌ | ✅ (`AudioEnvironment` 네이티브 모듈) |
| route 변경 이벤트 (`routeChangeNotification`) | ❌ | ✅ |
| **백그라운드 지오펜스** (`expo-location` region 이벤트) | ❌ | ✅ |
| **백그라운드 위치 업데이트** (`startLocationUpdatesAsync` + TaskManager) | ❌ | ✅ |
| **로컬 알림** (`expo-notifications`) | 일부 제약 | ✅ |
| 노이즈 캔슬링(ANC) 활성 여부 | ❌ 원천 불가(공개 API 없음) | ❌ 원천 불가 |

즉 **네이티브가 필요한 기능(오디오 경로/타앱 재생, 백그라운드/지오펜스)은 Expo Go 로 검증할 수 없고
dev build 가 최초 강제 시점**이다. 순수 로직은 다음으로 샌드박스에서 검증한다:

```bash
env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-wss-example.ts
# 그 외 scripts/verify-*.ts 전부
```

Expo Go / 미빌드 / Android 에서 `AudioEnvironment` 네이티브 모듈이 없으면, JS 브리지
(`modules/audio-environment/index.ts`)와 `src/sensors/useAudioEnvironment.ts` 가 **open-ear 로 안전
축소**한다(`{ bluetoothAudioRouteConnected:false, otherAudioPlaying:false }`). 따라서 허위 감점(오탐)은
발생하지 않으며, WSS 회귀 오라클(8.2875 / 91.7125 / 2.5 / 1.0)은 그대로 유지된다.

---

## 2. 사전 준비 (Apple 개발자 계정 / 프로비저닝)

iOS development build 에는 다음이 필요하다:

- **Apple Developer Program 멤버십** (연 $99). 계정 등록 후 아래 진행. *(현재 미등록 상태이며 사용자가 곧 등록 예정.)*
- 앱 식별자는 이미 설정됨: **`bundleIdentifier: com.wssapp.walkingsafety`** (`app.json`).
- EAS 는 development build 를 위한 **ad-hoc 프로비저닝 프로파일과 디바이스 등록**을 대화형으로 처리해준다.
  실기기 UDID 등록이 필요하며 `eas device:create` 로 진행한다.
- macOS 는 iOS 시뮬레이터/기기 실행에 필요하다(클라우드 빌드 자체는 EAS 서버에서 수행).

---

## 3. 사용자 로컬에서 실행할 정확한 명령

> 이 단계들은 **네트워크 + Apple 자격증명**이 필요하므로 샌드박스에서 실행할 수 없다.
> 아래는 사용자의 로컬 macOS 에서 순서대로 실행한다.

```bash
# 1) EAS CLI 설치 (전역)
npm i -g eas-cli

# 2) Expo 계정 로그인
eas login

# 3) (최초 1회) 프로젝트를 EAS 에 연결 + 빌드 설정 점검
#    eas.json 은 이미 development/preview/production 프로파일을 포함한다.
eas build:configure

# 4) (iOS 실기기) 디바이스 등록 — development build 는 ad-hoc 프로비저닝을 쓴다
eas device:create

# 5) iOS development build 생성 (클라우드에서 네이티브 컴파일)
eas build --profile development --platform ios

# 6) 빌드 완료 후 제공되는 링크/QR 로 dev client(.ipa)를 실기기에 설치

# 7) 로컬 dev 서버를 dev client 모드로 실행하고 기기에서 접속
npx expo start --dev-client
```

Android 개발 빌드가 필요하면:

```bash
eas build --profile development --platform android
```

---

## 4. 이 앱에서 dev build 를 강제하는 지점

1. **`modules/audio-environment`** — 로컬 Expo 네이티브 모듈(Swift, `AudioEnvironmentModule`).
   `AVAudioSession.isOtherAudioPlaying` 및 `currentRoute.outputs[].portType`(`.bluetoothA2DP`/`.bluetoothHFP`)
   를 읽어 `{ bluetoothAudioRouteConnected, otherAudioPlaying }` 를 JS 로 노출한다. 이 모듈이 존재하는
   순간부터 Expo Go 실행이 불가능해지고 dev build 가 필요하다.
2. **백그라운드 위치 / 지오펜스** — `expo-location` 의 `startGeofencingAsync` /
   `startLocationUpdatesAsync` 와 `expo-task-manager` 의 백그라운드 태스크는 Expo Go 에서 동작하지 않는다.

### 필요한 npm 패키지 / config plugin

이미 `package.json` 에 존재:

- `expo`, `expo-modules-core` (로컬 네이티브 모듈 브리지)
- `expo-location`, `expo-task-manager` (백그라운드/지오펜스)
- `expo-notifications` (로컬 알림)
- `expo-sensors` (Pedometer/Accelerometer)

Config plugin (`app.json` → `plugins`):

- `expo-router`, `expo-notifications` (기존)
- **`./plugins/withAudioEnvironment`** (신규) — `AudioEnvironment` 로컬 모듈 의존을 명시적으로 선언.
  로컬 모듈은 Expo autolinking 이 자동 링크하므로 소스 주입은 하지 않는다.

별도의 추가 npm 패키지는 필요 없다. 커스텀 오디오 감지는 로컬 모듈 + `expo-modules-core` 로 충분하다.

---

## 5. iOS 백그라운드 모드 / 권한 정책

`app.json` iOS `UIBackgroundModes` 는 **`location` 만** 포함한다.

- **`audio` 백그라운드 모드는 의도적으로 추가하지 않는다.** `AudioEnvironment` 감지는 지오펜스 ENTER /
  위치 업데이트 트리거 시점의 **best-effort 스냅샷**으로 충분하다. 백그라운드에서 오디오 세션을 상시
  활성으로 유지하려고 `audio` 모드를 넣으면, 실제 오디오 재생 앱이 아닌 경우 App Store 심사에서 거부
  위험이 있다. 딥 백그라운드에서 오디오 세션이 비활성이면 스냅샷은 open-ear 로 안전 축소되며(오탐 없음),
  이는 `AUDIO_DETECTION_FINDINGS.md` 의 결론과 일치한다.
- 향후 정말로 백그라운드 오디오 세션 유지가 필요해지면(정당화는 App Store 카피/기능 설명에서),
  `plugins/withAudioEnvironment.js` 의 `addAudioBackgroundMode` 를 활성화해 `audio` 모드를 주입할 수 있다.

Android 권한(`app.json`): `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
**`ACCESS_BACKGROUND_LOCATION`**, `ACTIVITY_RECOGNITION` 이 모두 선언되어 있어 백그라운드 지오펜스에 필요한
권한을 충족한다.

---

## 6. 감지 불가 항목 (제품/마케팅 주의)

노이즈 캔슬링(ANC) 활성 여부는 iOS 공개 API 로 감지할 수 없다. App Store 설명/마케팅에서 "노이즈 캔슬링
감지" 류 기능을 광고하면 안 된다. 이 앱이 감지하는 것은 오직 **"블루투스 출력 경로 연결 + 다른 앱 재생중"**
(둘 다 true 일 때만 차음)이다. 자세한 내용은 `.agents/tasks/task-bg-audio-wss/AUDIO_DETECTION_FINDINGS.md`.
