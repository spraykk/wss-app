# 「보행 개선」 (WSS) 프로젝트 인수인계 / 검토 요청 문서

> **이 문서의 목적**: 다른 AI 또는 개발자가 이 문서만 읽고도 프로젝트의 배경·현재 상태·기술 스택·설계 결정·미해결 과제를 **완벽히 이해**하고, 특히 "미해결 과제 A(스마트폰 사용 추정)"에 대한 **대안 해결책을 제시**할 수 있도록 정리한 스냅샷입니다.
>
> 작성 시점 기준 브랜치: `fix/wss-bugs` (GitHub: `spraykk/wss-app`), HEAD ≈ `25926c8`.

---

## 0. 한 줄 요약

**"보행 중 스마트폰 사용을 억제하기 위한 넛지(nudge) 앱."** 사용자가 걷는 동안 위치(사고다발구역)·날씨·시간대·이어폰 사용·스마트폰 사용 등을 종합해 **보행안전점수(WSS, 0~100)**를 매기고, 위험구역에서 스마트폰을 보며 걸으면 점수가 떨어지고 실시간 경고를 준다. iOS(iPhone) 대상 Expo/React Native 앱이며 앱스토어 출시 직전 단계.

---

## 1. 프로젝트 배경 / 맥락

- 원 출발점: 법학전문대학원 자기소개서에 쓸 아이디어("보행 중 스마트폰 사용 억제를 통한 보행 안전 확보: 로지스틱 회귀모형을 통한 보행안전점수(WSS) 설계 및 넛지")를 **실제 동작하는 앱으로 구현**한 것.
- 개발자: 1인(비전문 개발자에 가까움). AI 페어링으로 개발 중. 실기기(본인 iPhone)에서 EAS dev/preview 빌드로 실행하며 반복 검증.
- **핵심 원칙 (매우 중요, 절대 위반 금지)**:
  1. **정직성**: 가짜/미검증 통계·수치를 만들어내지 않는다. 표본이 부족하면(기준 5명 미만) 숫자를 지어내지 말고 "측정 중"으로 정직하게 표시한다. WSS는 "실제 사고 발생을 예측하는 지표가 아니라 참고 지표"임을 앱/문서에 명시한다.
  2. **근거 구분**: 가중치 중 어떤 것이 실증(실제 통계)이고 어떤 것이 설계값(설계자 판단)인지 코드 주석과 문서에 명확히 구분한다.
  3. **개인정보 최소화**: 위치·경로·원점수 등 민감정보는 서버로 전송하지 않는다. 서버로 나가는 것은 익명 device_id, 표시점수(0~100), 날짜, (신규) 연령대 밴드뿐이다.

---

## 2. 기술 스택 / 실행 환경

| 항목 | 내용 |
|------|------|
| 프레임워크 | Expo (SDK 57), React Native, expo-router, TypeScript |
| 대상 | iOS (iPhone). Android 설정도 있으나 주 타깃은 iOS |
| 빌드 | EAS Build. `preview` 프로필(독립 실행, dev 서버 불필요) / `development`(dev client) / `production` |
| 상태/저장 | AsyncStorage(로컬 이력·세션·플래그), Supabase(익명 통계·피드백) |
| 지도 | react-native-maps (`<Circle>`, `<Marker>`) |
| 센서 | expo-location(GPS/지오펜스), expo-task-manager(백그라운드), Pedometer(걸음), 커스텀 네이티브 오디오 모듈(이어폰 감지) |
| 백엔드 | Supabase (Postgres + RLS + RPC). 익명 anon/publishable 키만 사용 |
| 앱 이름 | "보행 개선" (bundleId: `com.wssapp.walkingsafety`) |

### 개발/검증 환경의 제약 (AI 작업 시 필수 인지)
- **AI 샌드박스는 외부망 차단(INTEGRATIONS_ONLY)** + npm 레지스트리 접근 불가. 따라서 **RN 앱을 실제로 빌드/실행할 수 없고**, 새 npm 패키지도 설치 불가.
- 대신 **순수 로직을 `scripts/verify-*.ts` 검증 스크립트**로 검증한다. 실행: `env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-<name>.ts`. 현재 **22종** 존재, 전부 통과 유지가 필수 조건.
- 그래서 규칙: `src/` 안에서는 node 표준 라이브러리(fs/path/url 등) import 금지(RN 런타임에 없음). JSON은 Metro `require`로만 로드. 순수 함수는 배열/값 주입식으로 설계해 node로 검증 가능하게 한다.
- 실제 앱 동작 검증은 **개발자가 실기기에서 수동으로** 한다(AI는 못 함).

---

## 3. WSS 점수 계산 로직 (핵심 도메인)

### 3.1 세그먼트 기반 누적
보행 세션은 여러 **세그먼트(WalkSegment)**로 쪼개진다. 각 세그먼트는 하나의 (지역, 위험강도, 날씨, 시간대, 이어폰상태) 조합 구간이며 다음을 가진다:
- `confirmedUseMinutes`: 이 구간에서 자세 기반으로 감지된 "화면 보며 걷기" 사용 시간(분) - **채점 감점의 소스**(7절). 필드가 없는 레거시 세그먼트는 `smartphoneUseMinutes`로 폴백한다.
- `walkMinutes`: 이 구간 총 보행 시간(분)
- `riskIntensity`: 위치 위험강도(사고다발구역 severity 합, 구역 밖=0)
- `weather`, `timeBand`, `isEarOccluded`

### 3.2 가중치 (`src/wss/weights.ts`)

| 가중치 | 값 | 근거 구분 |
|--------|-----|-----------|
| 위치(사고다발구역) `LOCATION_WEIGHT` | highRisk 1.5 / normal 1.0 | **설계값** |
| 겹침 배수 `OVERLAP_WEIGHT_MULTIPLIER` | 1.15 (구역당 누승) | **설계값** |
| 이어폰 `EAR_WEIGHT` | occluded 1.3 / open 1.0 | **설계값** |
| 날씨 `WEATHER_WEIGHT` | clear 1.0 / rain_or_snow 1.06 / other_not_clear 1.14 / fog 1.62 | **실증**(전국 교통사고 EPDO: 사망12·중상3·경상1·부상신고0.5) |
| 시간대 `TIME_WEIGHT` | normal_day 1.0 / rush_am 0.97 / rush_pm 0.94 / normal_night 1.09 | **실증**(동일 EPDO) |

- 위치 severity: `computeZoneSeverity(count) = max(0.5, log(count+1)/log(6))`, 기준 사고건수 5. 겹치면 severity 합산 → `computeLocationWeight`에서 `1.5 × 1.15^(intensity-1)`.

### 3.3 점수 공식 (`src/wss/engine.ts`)
```
useMinutes = confirmedUseMinutesOf(segment)   // 자세 감지 use 시간(레거시는 smartphoneUseMinutes 폴백)
segment.contribution = combinedWeight × useMinutes
   (combinedWeight = wLocation × wWeather × wTime × wEar)
totalDeduction = Σ contribution
usageRatio = totalUseMinutes / totalWalkMinutes
scaledDeduction = DEDUCTION_SCALE(=4) × totalDeduction
rawScore = clamp(100 - scaledDeduction, 0, 100)
penalty(usageRatio) = usageRatio<0.3 ? 0 : 40 × (usageRatio-0.3) × (walk<3분?0.5:1)
displayScore = usageRatio>=0.3 ? clamp(100 - scaledDeduction - 4×penalty) : rawScore
belowCriticalThreshold = rawScore < 60
```
- **감점의 소스가 자세 기반 감지 사용 시간으로 바뀌었다**(7절): 이제 `useMinutes`는 "걷는 중 pitch>=10도가 3초 이상 지속"으로 감지된 use 시간이다. 다만 **공식의 구조, `DEDUCTION_SCALE`(k=4), 임계점 60, usageRatio 페널티(임계 0.3 / 강도 40 / walk<3분 시 x0.5 등 xk)는 그대로다(변경 없음).** 바뀐 것은 "무엇을 use 로 셀 것인가"뿐이고 그 use 시간을 점수로 환산하는 규칙은 동일하다.
- `DEDUCTION_SCALE = 4` (k=4): 실증 가중치만으로는 점수가 90~98에 몰려 변별력이 없어, 감점을 4배 증폭. 시뮬레이션에서 평균~71, 하위10%~52, 로지스틱 변곡점~58 → **임계점을 60으로 확정**(개발자 결정).
- **k=4, 임계점 60, usageRatio 페널티 파라미터(0.3 / 40)는 확정값 - 변경 금지.**

### 3.4 등급 (`src/wss/grade.ts`)
- 위험(60 미만) / 주의(60~평균) / 양호(평균~Q3) / 우수(Q3 이상) / 측정중(표본 5명 미만·미집계).
- 평균·Q3는 Supabase 익명 통계(다른 사용자 점수)로 계산. 표본 5명 미만이면 "측정 중"으로 정직 폴백.

---

## 4. 백그라운드 측정 파이프라인 (`src/session/backgroundTask.ts`)

- iOS는 임의 타이머로 백그라운드 실행을 보장하지 않으므로, **setInterval을 쓰지 않고 이벤트 기반**으로 동작한다.
- 깨움 트리거: (1) **세션 동안 켜두는 연속 백그라운드 위치 업데이트**(핵심), (2) 지오펜스 region ENTER 이벤트, (3) 구역 내 정밀 위치 업데이트.
- 각 트리거마다 `processLocationSample()`: 현재 위치 감싸는 위험구역 계산 → 날씨(TTL 캐시) → 오디오 환경 → 순수 리듀서로 세그먼트 누적 → WSS 재계산 → 조건 충족 시 로컬 알림.
- **왜 연속 위치 업데이트가 필요한가(결함 수정)**: 자세 기반 사용 감지(자이로 pitch → `classifyPostureInterval` → `confirmedUseMinutes` → 감점)는 "위치 이벤트가 오는 순간"의 최신 자세를 읽어 구동된다. 그런데 지오펜스/정밀추적은 **위험구역 안에서만** 위치 이벤트를 만든다. 그래서 위험구역 밖에서 폰을 보며 걸으면 iOS가 프로세스를 재우고 자이로 리스너 콜백까지 멈춰 감점이 중단될 수 있었다. 이를 막기 위해 세션 시작 시 `Location.startLocationUpdatesAsync(SESSION_LOCATION_TASK_NAME, ...)`로 **연속 위치 업데이트를 실제로 시작**해 프로세스를 세션 동안 살려둔다(`useWalkSession.start` → `startSessionLocationUpdates`). 그러면 자이로 리스너가 계속 콜백을 받아 자세 평가·감점이 **위험구역 안팎 무관하게 지속**된다. 세션 종료 시 `stopSessionLocationUpdates`가 반드시 중지한다(배터리/프라이버시).
  - 옵션: `accuracy=Balanced`, `distanceInterval=0`+`timeInterval=5000`(정지 중에도 시간 기반 이벤트 → 멈춰서 폰 봐도 자세 평가), iOS `pausesUpdatesAutomatically=false`(자동 일시정지 방지)·`showsBackgroundLocationIndicator=true`(파란 인디케이터로 정직 노출)·`activityType=Fitness`, Android `foregroundService` 안내 문구. 지오펜스 경로는 보조로 유지되며 둘 다 있어도 `lastProcessedAt` 공유로 elapsedMinutes 이중계산이 방어된다.
  - **권한**: 연속 백그라운드 업데이트는 iOS **Always** 권한이 이상적이다. `start()`는 `requestBackgroundPermissionsAsync`를 best-effort로 요청하지만, 사용자가 "앱 사용 중에만(WhenInUse)"만 허용하면 연속성이 **포그라운드/화면 켜짐에 한정**된다(정직한 한계). `app.json`의 `UIBackgroundModes:location`은 이미 있음.
  - **정직한 한계(OS 보장 아님)**: 연속 위치 업데이트는 세션 동안 프로세스 생존 가능성을 크게 높이는 수단이지 절대 보장이 아니다. iOS는 배터리/메모리 압박 등 극단 상황에서 프로세스를 언제든 종료할 수 있고, 사용자가 앱을 **스와이프로 강제 종료하면 멈춘다(정상)**. 프로세스가 잠들거나 종료되어 자세 샘플이 끊긴 구간은 staleness 판정으로 **no-use로 귀속**되어 감점이 뻥튀기되지 않는다.
- **저전력 전략**: 상시 고정밀 GPS 대신 연속 업데이트는 Balanced 정확도로만 유지하고, 위험구역 정밀 추적(BestForNavigation)은 지오펜스(근접 위험구역 최대 18개 + boundary 1개, iOS 20 region 하드캡 대응) 진입 시에만 상향(escalate), 이탈 시 하향(de-escalate)한다.
- **차량 오인 방지** (`src/sensors/motionClassifier.ts`): GPS 속도로 walking/vehicle/idle 분류. 15km/h 이상이면 vehicle 모드+60초 쿨다운. 차량 구간은 세그먼트로 안 쌓음. Pedometer 걸음 증가를 보조 신호로 사용.

### 온디바이스 검증 항목(샌드박스 실행 불가 - 실기기 필수)
- 세션 시작 후 **화면을 끄고** 위험구역 **밖**에서 폰을 보며(pitch>=10도) 3초 이상 걸을 때, 자세 감지·감점이 계속 누적되는지(연속 위치 업데이트로 프로세스가 살아 자이로가 지속 수신되는지) 확인.
- **다른 앱을 사용하며** 걸을 때도 자세 감지·감점이 이어지는지 확인(백그라운드 연속성).
- iOS 위치 권한을 "앱 사용 중에만"으로 준 경우 백그라운드 연속성이 제한됨을, "항상"으로 준 경우 개선됨을 각각 확인.
- 세션 종료 시 파란 위치 인디케이터가 사라지고(업데이트 중지), 배터리 소모가 상시 고정밀 대비 과하지 않은지 확인.

---

## 5. 서버 (Supabase) 구조 (`supabase/schema.sql`)

- **테이블 `wss_scores`**: id, device_id(익명 UUID), display_score(0~100), date_iso(날짜만), age_band(신규), created_at. (device_id, date_iso) 유니크 → 하루 한 기기 한 점(upsert).
- **테이블 `feedback`**: id, device_id, category(bug/suggestion/praise/etc), rating(1~5 null허용), message(≤2000자), app_version, age_band(신규), created_at.
- **RLS**: anon은 insert/upsert만 가능. 원시 행 select 불가(다른 사용자 데이터 열람 차단).
- **RPC(집계만 노출)**: `get_wss_stats()`(전체 count/mean/q3), `get_wss_stats_by_age(band)`(신규, 연령대별), `list_feedback()`(device_id는 익명 anon_ref로만), `get_feedback_summary()`, `get_feedback_summary_by_age()`(신규). 전부 security definer + search_path 고정.
- **연령대 밴드**: `'10s'|'20s'|'30s'|'40s'|'50plus'` + 미선택(null/'미상'). 기존 행은 age_band=null 허용(하위호환).
- **웹 대시보드** `docs/feedback.html`: 로컬 HTML 파일. Supabase anon 키로 list_feedback/summary RPC 호출해 피드백을 (전체+연령대별) 표시. 서버 배포 불필요, 브라우저로 열면 됨(증빙/자소서용).

---

## 6. 지금까지 완료한 작업 (시간순 요약)

1. **초기 앱 재구성 + 리뷰 버그 수정(#1~#6)**: 코드 리뷰로 발견한 버그(위험강도 중복합산 등) 수정.
2. **EAS 빌드 성공**: reanimated/expo-av 의존성 문제 제거 후 dev build 실기기 실행.
3. **점수 실증화**: 날씨·시간대 가중치를 전국 교통사고 EPDO 통계로 재조정. k=4, 임계점 60, 4등급 확정.
4. **측정중/위험 알림**: 표본 부족 시 "측정 중" 정직 표시. 위험구역+스마트폰사용/60점미만 시 로컬 알림.
5. **오디오·지오펜스·백그라운드 세션**: 이어폰 감지(네이티브 모듈), 저전력 지오펜스, 앱 꺼도 측정.
6. **백그라운드 날씨 정확화**: 실제 GPS→KMA 격자 변환(전국 어디서나 정확).
7. **전국 사고데이터(12,780건)**: TAAS 표준 사고다발지 API로 수집해 `assets/accident-zones.json` 저장. dedup(중복지점 병합) 파이프라인.
8. **차량 감지**: 속도 기반 모션 분류기로 차/버스 이동 구간 제외.
9. **서버 통계(Supabase)** + **피드백 창구**(앱 화면 + DB + 웹 대시보드).
10. **UI 파스텔톤** + 발자국 아이콘(SVG). 앱 이름 "보행 개선".
11. **성능(렉) 대수술**:
    - 지도: 뷰포트 필터 + 최대 300개 렌더 상한 + raw 로드(무거운 dedup 생략).
    - dedup O(n²)→공간격자 O(n) 최적화 + `loadAccidentZones()` 메모이즈(결과 불변, verify-dedup 통과). **이것이 "보행 종료 렉"의 근본 원인 해결.**
    - 보행 종료 시 서버 업로드를 fire-and-forget으로 분리 + 네트워크 8초 타임아웃. 근접구역 선택 부분정렬.
12. **피드백 실패 해결**: 원인 = `.env` 깨짐 + 앱에 Supabase 키 미주입. → `app.json`의 `extra`에 공개키(URL/anon/KMA) 직접 주입해 빌드/주입 무관하게 동작. (개발자 실기기에서 의견 전송 성공 확인.)
13. **위험구역 빨간 원 반경 축소**: `ZONE_RADIUS_SCALE` 0.6→0.3. 단, 지도는 raw 경로라 스케일 미적용이던 버그를 찾아 `app/map.tsx`에서 `radius = radiusMeters × ZONE_RADIUS_SCALE` 적용(표시·겹침 반경 일치). **← 최신 커밋 25926c8.**
14. **온보딩 루프 버그 수정**: `_layout`이 온보딩 완료를 앱 시작 시 1회만 읽어, 완료 후 홈 가면 다시 온보딩으로 튕기던 루프. 세션 내 완료 신호로 즉시 반영하도록 수정.
15. **연령대 밴드 기능**: 온보딩에서 1회 선택(10/20/30/40/50+), 점수·피드백 업로드에 자동 첨부, 리포트에 전체+내 그룹 통계(각각 5명 미만이면 측정중), DB 스키마·RPC·개인정보처리방침·대시보드 반영.
16. **주간 일별 막대그래프**: `WSSResult.dateISO`(선택 필드) 추가, 하루의 마지막 보행 점수를 그날 대표값으로 최근 7일 막대그래프. 순수 집계 `src/wss/weekly.ts#computeWeeklyDaily` + verify-weekly.

> **개발자 측 남은 조작**: 최신 `supabase/schema.sql`을 Supabase SQL Editor에서 재실행(연령대 컬럼/RPC 반영, idempotent), 그리고 최신 코드로 새 preview 빌드해서 실기기 설치·검증.

---

## 7. ★ 과제 A - 스마트폰 사용(화면 보며 걷기) 추정 [자세 기반 감지 채택됨]

### 7.1 현재 상태 (자세 기반 사용 감지 채택 - WSS 감점을 구동)
**과거 문제(제거됨)**: 예전 `backgroundTask.ts`는 스마트폰 사용 시간을 이렇게 근사했다.
```ts
smartphoneUseMinutes: elapsedMinutes,   // = 걸은 시간 전체 (제거됨)
walkMinutes: elapsedMinutes,
```
즉 **"보행 측정을 시작한 뒤 걷는 시간 전체를 무조건 '스마트폰 사용 중'으로 간주"**했다. 주머니에 넣고 걷는 사람도 전 구간이 감점되는 명백한 오류였다("이걸 누가 쓰냐"). 그 뒤 중간 단계(Option A)에서는 인앱 터치만 confirmedUse 로 인정하고 나머지를 unknownUse('측정 불충분')로 두었으나, "다른 앱을 보며 걷는" 사용을 전혀 못 잡았다.

**현재(채택됨 · 자세 기반 이분화)**: 이제 사용 판정의 **유일한 소스는 보행 중 폰 자세(pitch)**다. 각 구간을 다음 규칙으로 **use(사용) / no-use(미사용)** 둘 중 하나로만 배정한다.
- **use(화면 보며 걷기)**: **걷는 중** + pitch(기기 앞뒤 기울기)가 `PITCH_USE_THRESHOLD_DEG`(=10도) 이상으로 `USE_SUSTAIN_MS`(=3000ms=3초) **이상 지속**될 때.
- **no-use(그 외 전부)**: 걷지 않거나, pitch가 임계 미만이거나, 임계를 넘겨도 3초 미만으로 튄 경우.
- **센서 공백 = no-use(정직성)**: 샘플이 도착하지 않는 공백 구간은 "모르면 사용으로 감점하지 않는다"는 보수적 원칙에 따라 **no-use**로 귀속한다(사용자 결정 '가'). 관측하지 못한 시간을 사용으로 감점하지 않는다.
- 판정은 순수 상태기계 `src/sensors/postureUsageDetector.ts`(`classifyPostureInterval` / `isSustainedUse`)가 담당하고, pitch 값 자체는 `src/sensors/postureMath.ts#gravityToPitchRoll`로 계산해 주입한다. 세그먼트 집계는 `src/session/usageClassification.ts`가 use/no-use 분을 합산한다. 감지된 use 시간은 세그먼트의 `confirmedUseMinutes`에 기록되고 채점(`src/wss/engine.ts#confirmedUseMinutesOf`)이 이것으로 감점한다.

**설계값 (정직성 라벨 필수)**: `PITCH_USE_THRESHOLD_DEG=10`, `USE_SUSTAIN_MS=3000`은 **"사용자 1인 실측 기반 설계값 · 실제 사고 예측 아님"**이다. 이는 튜닝 가능한 설계값이며, 확정된(frozen) 채점 파라미터(k=4 / 임계점 60 / usageRatio 페널티 0.3·40, `weights.ts`)와는 성격이 다르다.

**실측 근거(사용자 1인 단말, pitch deg 중앙값)**: 오직 "화면 보며 걷기"만 pitch가 명확히 양(+)이었고, 나머지 모든 비사용 자세는 중앙값이 음(-)이었다. 따라서 pitch 하나로 깔끔하게 분리되며 roll은 분리력이 약해 사용하지 않는다.

| 자세 | pitch 중앙값(도) | 판정 |
|------|------------------|------|
| viewing-while-walking(화면 보며 걷기) | **+19.9** (평균 +20.3, 범위 -0.2..+51.6, 명확히 양) | use |
| back-pocket(뒷주머니) | -70.0 | no-use |
| front-pocket(앞주머니) | -73.7 | no-use |
| jacket-inner(재킷 안주머니) | -13.5 | no-use |
| jacket-outer(재킷 바깥주머니) | -22.1 | no-use |
| in-hand-screen-facing(손에 들고 화면 위) | -51.7 | no-use |
| in-hand-screen-away(손에 들고 화면 반대) | -54.4 | no-use |

- **unknownUse / measurementInsufficient(측정 불충분)는 제거됨**: 이제 모든 초(second)가 자세 기준으로 use 또는 no-use 로 이분되므로 "모름" 밴드가 존재하지 않는다. `usageClassification.ts`의 `UsageBand` 타입과 세그먼트의 `estimatedUseMinutes`/`unknownUseMinutes` 필드는 **옛 이력·리포트와의 타입 호환을 위해서만 남겨 두고 항상 0**이다(더 이상 기록하지 않음). 리포트의 '측정 불충분' 안내와 그 판정 임계도 제거됐다.
- **인앱 터치(confirmedUse) 소스와의 관계**: 사용 판정의 최종 소스는 자세다. 인앱 상호작용 추적(`interactionTracker.ts`)은 유지되지만 사용 시간을 지배하지 않는다(자세 감지가 이를 대체한다).

**리포트 대표 문구**: 감지된 use 비율(usageRatio)을 사용자가 바로 이해하도록, 리포트(`app/report.tsx`)와 홈(`app/index.tsx`)이 **'이번 보행 중 OO%를 휴대폰 보며 걸었어요'** 형태로 눈에 띄게 표시한다. 백분율 규칙은 순수 유도 함수 `src/wss/useRatio.ts`(`useRatioPercent`/`formatUseRatioPercent`)로 단일화해 홈·리포트가 동일하게 계산한다.

### 7.1a iOS 백그라운드 센서 연속성 (코드로 보장되지 않음 · 온디바이스 검증 항목)
- 실제 "다른 앱을 보며 걷기"까지 잡으려면 우리 앱이 백그라운드일 때도 모션(pitch)을 읽어야 한다. 앱 프로세스는 `UIBackgroundModes:location`으로 살아 있을 수 있으나, **iOS는 백그라운드 모션 연속성을 보장하지 않으며 시스템 판단에 따라 앱이 종료될 수 있다.** 즉 백그라운드에서 pitch 샘플이 계속 들어온다는 보장을 **코드가 제공하지 않는다.**
- 이 한계는 **온디바이스 검증 항목**으로 남긴다(실기기에서 화면 끄고/다른 앱 켠 상태로 걸으며 샘플 연속성 확인). 방어책은 위의 **센서 공백 = no-use** 정책이다: 샘플이 끊기면 사용으로 감점하지 않으므로, 백그라운드 종료가 사용자를 부당하게 감점시키지 않는다.

### 7.2 iOS의 근본 제약 (반드시 고려)
- iOS는 **백그라운드 앱에게 "화면이 켜져 있는지(스크린 온/오프)"를 알려주지 않는다.** 개인정보 보호 정책상 지속 조회 API가 막혀 있다.
- iOS는 **"사용자가 지금 다른 앱(인스타/유튜브 등)을 보고 있는지"도 절대 알려주지 않는다.**
- 우리 앱이 확실히 아는 것은 기껏해야 **"내 앱이 지금 포그라운드/백그라운드인지"(AppState)** 정도.
- **`UIScreen.brightness`(밝기)는 우리 앱이 포그라운드일 때만 신뢰 가능**하고, 백그라운드에서는 갱신이 안 되거나 마지막 값이 굳는다.
- **Always-On Display(AOD, iPhone 14 Pro+)** 때문에 "밝기 > 0 = 화면 켜짐" 판정은 오판이 난다(꺼진 상태에서도 저휘도로 켜져 있음). → **밝기 단독 판정은 부적절.**

### 7.3 채택된 접근 정리 및 향후 개선 여지
현재 사용 판정은 **보행 중 pitch(자세) 단일 신호**로 이분한다(위 7.1). 직접 화면 감지(스크린 온/다른 앱 응시)는 iOS가 막고 있으므로, 관측 가능한 최소 신호인 자세로 "화면 보며 걷기"를 보수적으로 추정한다. 참고로 아래 신호들은 검토했으나 현재는 pitch만 채택했다(정직성: 실측으로 분리력이 확인된 신호만 사용).

| 단서 | 현재 사용 여부 | 비고 |
|------|----------------|------|
| ① 걷는 중 폰 자세(pitch) | **채택(유일 소스)** | 실측상 사용 자세만 pitch 양(+), 10도·3초 지속으로 분리 |
| ② roll(좌우 기울기) | 미사용 | 실측 분리력 약함 |
| ③ 우리 앱 포그라운드(AppState)·인앱 터치 | 보조(비지배) | interactionTracker 유지하나 사용 시간을 지배하지 않음 |
| ④ 이어폰 사용 중(이미 구현) | 위험 가중치 배수 | 사용 시간 판정과는 별개 |

- **핵심 원칙**: "걷는 중 pitch가 임계 이상으로 3초 이상 지속되는 시간"을 사용으로 본다. 밝기는 AOD/백그라운드 문제로 사용하지 않는다.
- **정직성**: 완벽한 감지가 아니라 "사용자 1인 실측 기반의 보수적 자세 휴리스틱"임을 앱/문서/코드 주석에 명시했다. 설계값은 실기기 데이터가 더 모이면 재튜닝할 수 있다(frozen 아님).

### 7.4 다른 AI에게 바라는 검토 포인트
1. 자세(pitch) 단일 신호 채택의 타당성과, 다중 사용자로 일반화할 때의 임계 재보정 방법.
2. iOS에서 우리가 놓친 **합법적으로 가능한 다른 신호**가 있는가? (예: Core Motion의 device motion/attitude 연속성, proximity sensor, Screen Time API의 가능/불가 범위, activity type, `UIApplication` 상태 전이, 오디오 세션 상태 등)
3. pitch·attitude 등을 **어떻게 조합**해야 오탐(주머니 속인데 사용으로 판정)과 미탐(보는데 미사용으로 판정)을 더 줄일지.
4. 백그라운드 모션 연속성(7.1a)을 iOS 제약 안에서 얼마나 개선할 수 있는지, 그리고 센서 공백=no-use 방어가 충분한지.
5. 정직성 원칙(휴리스틱임을 인정)을 지키면서도 사용자가 납득할 UX 설계.

> 제약 재확인: 새 npm 패키지 추가는 신중히(가능하면 expo 기본 제공 모듈: expo-sensors의 Accelerometer/DeviceMotion 등 이미 Expo 생태계에 있는 것 위주). 순수 판정 로직은 `scripts/verify-*.ts`로 검증 가능하게 순수 함수로 분리해야 함.

---

## 8. 앞으로 해야 할 일 (백로그)

### 즉시(개발자 조작 대기)
- [ ] Supabase SQL Editor에서 최신 `schema.sql` 재실행(연령대 컬럼/RPC).
- [ ] 최신 코드로 새 preview 빌드 → 실기기 설치 → 검증(빨간원 절반/온보딩 루프 해소/막대그래프/의견전송/연령대).

### 기능 (이 문서의 주 검토 대상)
- [x] **★ 과제 A - 자세 기반 사용 감지 채택 및 WSS 감점 구동** (7절) - 구현 완료. 걷는 중 pitch>=10도가 3초 이상 지속되면 use, 그 외/센서 공백은 no-use. `PITCH_USE_THRESHOLD_DEG=10`, `USE_SUSTAIN_MS=3000`은 사용자 1인 실측 기반 설계값.
  - [x] 자세 측정/기록 화면(`app/posture-lab.tsx`)으로 자세별 각도 데이터 수집 - 완료(측정 근거 수집용).
  - [x] 수집한 실측(화면 보며 걷기 +19.9 vs 비사용 자세 전부 음수)으로 임계 확정 → 감점 반영 - 완료.
  - [x] unknownUse / '측정 불충분' 개념 제거(모든 초가 use/no-use 로 이분) - 완료.
  - [x] 감지 use 비율을 리포트/홈에 '이번 보행 중 OO%를 휴대폰 보며 걸었어요'로 표시(`src/wss/useRatio.ts`) - 완료.
  - [ ] iOS 백그라운드 모션 연속성은 코드로 보장되지 않음 → **온디바이스 검증 항목**(7.1a). 센서 공백=no-use 로 방어.

### 출시 마무리
- [ ] 앱 아이콘 PNG 확정(현재 SVG. 하늘색 파스텔 배경+흰 발자국 시안 있으나 PNG 변환 보류 상태).
- [ ] production 빌드 + App Store Connect 등록 + 심사 제출.
- [ ] 실전 테스트(실제로 걸으며 점수·업로드·알림·차량제외 동작 확인).

### 알려진 사소한 정리거리 (선택)
- [ ] `app.json`의 `ios.infoPlist.UIBackgroundModes`에 "location" 3회 중복, `android.permissions`에 동일 권한 2회 중복 - 기능엔 무해하나 정리 가능.

---

## 9. 코드 지도 (주요 파일)

```
src/wss/
  weights.ts        가중치 상수·severity·k(=4)·임계점(60)   [실증/설계 구분 주석]
  engine.ts         computeWSS (점수 공식)
  grade.ts          등급 분류(위험/주의/양호/우수/측정중)
  context.ts        시간대(TimeBand) 판정
  weekly.ts         [신규] 주간 일별 대표점수 집계
  useRatio.ts       [신규] usageRatio(감지 사용/총 보행)→백분율 유도(홈·리포트 공용 문구)
src/data/
  accidentZones.ts  사고데이터 로드·dedup(공간격자)·ZONE_RADIUS_SCALE(0.3)·겹침/포함 판정
  supabase.ts       익명 업로드/통계/피드백(타임아웃·연령대·no-op 안전설계)
  weather.ts        KMA 단기예보 + latLonToGrid
  apiKey.ts         API 키 정규화(한 번만 인코딩)
  overlapGeometry.ts / overlapRender.ts  겹침 기하
src/session/
  backgroundTask.ts 백그라운드 세션 파이프라인(★ 자세 pitch 로 use/no-use 판정, classifyPostureInterval 호출)
  usageClassification.ts 세그먼트 배열의 use/no-use 분 집계(UsageBand 타입은 하위호환용, estimated/unknown 은 항상 0=은퇴)
  interactionTracker.ts  인앱 터치/스크롤 시각 기록(보조 신호; 자세 감지가 사용 시간을 지배)
  sessionReducer.ts 순수 세그먼트 누적 리듀서
  sessionStore.ts   활성 세션 지속(AsyncStorage)
  weatherCache.ts   날씨 TTL 캐시
src/sensors/
  motionClassifier.ts   [순수] walking/vehicle/idle 분류(차량 제외)
  postureMath.ts        [순수] 중력벡터→pitch/roll(도), 요약통계(min/max/mean/median)
  postureUsageDetector.ts [순수][신규] 자세 기반 use/no-use 판정 상태기계. PITCH_USE_THRESHOLD_DEG=10, USE_SUSTAIN_MS=3000(사용자 1인 실측 기반 설계값). 센서 공백=no-use
  walkingDetector.ts    센서/타이머 배선
  audioState.ts / useAudioEnvironment.ts  이어폰 차음 감지
  geofenceController.ts / geofenceSelection.ts  저전력 지오펜스
src/storage/
  history.ts        WSSResult[] 로컬 이력
  onboarding.ts     온보딩 완료 플래그(+세션 신호로 루프버그 수정)
  ageBand.ts        [신규] 연령대 밴드 저장
  deviceId.ts       익명 기기 UUID
app/
  _layout.tsx       라우트 가드(온보딩 유도)
  index.tsx         홈(보행 시작/종료)
  map.tsx           위험 지도(뷰포트 필터·반경 스케일 적용)
  report.tsx        리포트(점수·비교·주간 막대그래프·그룹통계)
  feedback.tsx      의견 보내기
  posture-lab.tsx   자세 측정/기록 도구(pitch/roll 실시간+구간요약, 실측 데이터 수집용)
  onboarding/index.tsx, onboarding/permissions.tsx  온보딩(권한+연령대)
modules/audio-environment/   커스텀 네이티브 오디오 모듈(Swift)
supabase/schema.sql          DB 스키마(테이블·RLS·RPC)
docs/feedback.html           피드백 웹 대시보드(로컬 HTML)
docs/privacy-policy.md/.html 개인정보 처리방침
scripts/verify-*.ts          순수 로직 검증(22종, 전부 통과 필수)
assets/accident-zones.json   전국 사고다발지 12,780건(원본, 수정 금지)
```

## 10. 검증 스크립트 목록(22종)
verify-agegroup-stats, verify-api-key, verify-audio-ear-mapping, verify-dedup, verify-feedback, verify-geofence-selection, verify-grade, verify-grid, verify-interaction-tracker, verify-motion-classifier, verify-overlap-geometry, verify-overlap-render, verify-posture-math, verify-posture-usage, verify-segment-key, verify-session-reducer, verify-supabase-stats, verify-usage-classification, verify-usage-wss, verify-use-ratio, verify-weekly, verify-wss-example.
실행: `env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-<name>.ts`

---

## 11. 다른 AI에게 (요청 요약)
이 문서의 **7절(스마트폰 사용 추정)**은 이제 자세 기반 감지(걷는 중 pitch>=10도 3초 지속=use, 그 외/센서 공백=no-use)로 채택되어 WSS 감점을 구동합니다. 남은 검토 포인트는 (1) 자세 단일 신호를 다중 사용자로 일반화할 때의 임계 재보정, (2) iOS 백그라운드 모션 연속성(7.1a, 코드로 미보장 · 온디바이스 검증 항목)의 개선 여지, (3) 오탐/미탐을 더 줄일 추가 신호 조합입니다. 정직성 원칙(휴리스틱임을 인정, 가짜 데이터·미검증 예측 금지)과 순수 함수 검증 가능성(verify 스크립트)을 지켜야 합니다.
