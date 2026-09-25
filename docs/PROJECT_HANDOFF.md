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
- 대신 **순수 로직을 `scripts/verify-*.ts` 검증 스크립트**로 검증한다. 실행: `env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-<name>.ts`. 현재 **16종** 존재, 전부 통과 유지가 필수 조건.
- 그래서 규칙: `src/` 안에서는 node 표준 라이브러리(fs/path/url 등) import 금지(RN 런타임에 없음). JSON은 Metro `require`로만 로드. 순수 함수는 배열/값 주입식으로 설계해 node로 검증 가능하게 한다.
- 실제 앱 동작 검증은 **개발자가 실기기에서 수동으로** 한다(AI는 못 함).

---

## 3. WSS 점수 계산 로직 (핵심 도메인)

### 3.1 세그먼트 기반 누적
보행 세션은 여러 **세그먼트(WalkSegment)**로 쪼개진다. 각 세그먼트는 하나의 (지역, 위험강도, 날씨, 시간대, 이어폰상태) 조합 구간이며 다음을 가진다:
- `smartphoneUseMinutes`: 이 구간에서 스마트폰 사용한 시간(분) — **★ 미해결 과제 A의 핵심 변수**
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
segment.contribution = combinedWeight × smartphoneUseMinutes
   (combinedWeight = wLocation × wWeather × wTime × wEar)
totalDeduction = Σ contribution
usageRatio = totalUseMinutes / totalWalkMinutes
scaledDeduction = DEDUCTION_SCALE(=4) × totalDeduction
rawScore = clamp(100 - scaledDeduction, 0, 100)
penalty(usageRatio) = usageRatio<0.3 ? 0 : 40 × (usageRatio-0.3) × (walk<3분?0.5:1)
displayScore = usageRatio>=0.3 ? clamp(100 - scaledDeduction - 4×penalty) : rawScore
belowCriticalThreshold = rawScore < 60
```
- `DEDUCTION_SCALE = 4` (k=4): 실증 가중치만으로는 점수가 90~98에 몰려 변별력이 없어, 감점을 4배 증폭. 시뮬레이션에서 평균~71, 하위10%~52, 로지스틱 변곡점~58 → **임계점을 60으로 확정**(개발자 결정).
- **k=4, 임계점 60은 확정값 — 변경 금지.**

### 3.4 등급 (`src/wss/grade.ts`)
- 위험(60 미만) / 주의(60~평균) / 양호(평균~Q3) / 우수(Q3 이상) / 측정중(표본 5명 미만·미집계).
- 평균·Q3는 Supabase 익명 통계(다른 사용자 점수)로 계산. 표본 5명 미만이면 "측정 중"으로 정직 폴백.

---

## 4. 백그라운드 측정 파이프라인 (`src/session/backgroundTask.ts`)

- iOS는 임의 타이머로 백그라운드 실행을 보장하지 않으므로, **setInterval을 쓰지 않고 이벤트 기반**으로 동작한다.
- 깨움 트리거: (1) 지오펜스 region ENTER 이벤트, (2) 구역 내 정밀 위치 업데이트.
- 각 트리거마다 `processLocationSample()`: 현재 위치 감싸는 위험구역 계산 → 날씨(TTL 캐시) → 오디오 환경 → 순수 리듀서로 세그먼트 누적 → WSS 재계산 → 조건 충족 시 로컬 알림.
- **저전력 전략**: 상시 고정밀 GPS 대신 지오펜스(근접 위험구역 최대 18개 + boundary 1개, iOS 20 region 하드캡 대응)만 등록. 구역 진입 시에만 정밀 추적 상향(escalate), 이탈 시 하향(de-escalate).
- **차량 오인 방지** (`src/sensors/motionClassifier.ts`): GPS 속도로 walking/vehicle/idle 분류. 15km/h 이상이면 vehicle 모드+60초 쿨다운. 차량 구간은 세그먼트로 안 쌓음. Pedometer 걸음 증가를 보조 신호로 사용.

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

## 7. ★ 미해결 과제 A — 스마트폰 사용(화면 보며 걷기) 추정 [핵심 검토 요청]

### 7.1 현재 상태 (Step 1 구현됨 — 과거 근사 제거)
**과거 문제(제거됨)**: 예전 `backgroundTask.ts`는 스마트폰 사용 시간을 이렇게 근사했다.
```ts
smartphoneUseMinutes: elapsedMinutes,   // = 걸은 시간 전체 (제거됨)
walkMinutes: elapsedMinutes,
```
즉 **"보행 측정을 시작한 뒤 걷는 시간 전체를 무조건 '스마트폰 사용 중'으로 간주"**했다. 주머니에 넣고 걷는 사람도 전 구간이 감점되는 명백한 오류였다("이걸 누가 쓰냐").

**Step 1 (구현 완료 — Option A 증거 밴드 분류)**: 이제 걷는 각 구간의 경과 시간을 "증거 강도"에 따라 네 밴드(confirmedUse/estimatedUse/unknownUse/noUse) 중 정확히 하나로 배정한다(`src/session/usageClassification.ts`). 채점은 **confirmedUse(확인된 사용)만 감점**한다.
- **confirmedUse = 실제 인앱 터치/스크롤 시간**: 루트 레이아웃(`app/_layout.tsx`)의 캡처 단계 터치 핸들러가 실제 상호작용 시각을 기록하고(`src/session/interactionTracker.ts`, 확인 창 `CONFIRMED_USE_WINDOW_MS`=60초), 백그라운드 태스크가 그 구간을 confirmedUse 로 분류한다.
- **한계(정직성)**: confirmedUse 는 본질적으로 **"우리 앱이 포그라운드일 때의 인앱 상호작용" 시간**이다. 앱이 백그라운드이거나 사용자가 다른 앱을 보는 시간은 iOS 제약상 관측할 수 없어 **unknownUse**(모름)로 둔다. 사용/무사용을 단정하지 않는다.
- **'측정 불충분' 정직성 정책**: 보행 중 미관측(unknown) 비율이 높으면(`UNKNOWN_RATIO_INSUFFICIENT_THRESHOLD`=0.5, 설계값) `measurementInsufficient`=true 로 표시하고, 리포트(`app/report.tsx`)에 '측정 불충분' 안내를 띄운다. 관측하지 못한 시간을 "안전하게 걸었다"고 가정해 좋은 점수를 주지 않는다.
- **estimatedUse(자세 추정)는 Step 1 에서 감점하지 않는다**: 필드/파이프라인만 준비되어 있고 항상 0 이다. 자세 기반 추정은 아래 **Step 2 (별도 향후 과제)**이다.

**목표(남은 부분 = Step 2)**: 인앱 상호작용만으로는 "다른 앱을 보며 걷는" 사용을 못 잡는다. 보행자가 화면을 보며 걷는지를 모션 자세 등 여러 단서로 추정해 `estimatedUse`를 채우는 것이 **Step 2** 이며, 이는 아직 감점에 반영되지 않는 별도 과제다.

### 7.2 iOS의 근본 제약 (반드시 고려)
- iOS는 **백그라운드 앱에게 "화면이 켜져 있는지(스크린 온/오프)"를 알려주지 않는다.** 개인정보 보호 정책상 지속 조회 API가 막혀 있다.
- iOS는 **"사용자가 지금 다른 앱(인스타/유튜브 등)을 보고 있는지"도 절대 알려주지 않는다.**
- 우리 앱이 확실히 아는 것은 기껏해야 **"내 앱이 지금 포그라운드/백그라운드인지"(AppState)** 정도.
- **`UIScreen.brightness`(밝기)는 우리 앱이 포그라운드일 때만 신뢰 가능**하고, 백그라운드에서는 갱신이 안 되거나 마지막 값이 굳는다.
- **Always-On Display(AOD, iPhone 14 Pro+)** 때문에 "밝기 > 0 = 화면 켜짐" 판정은 오판이 난다(꺼진 상태에서도 저휘도로 켜져 있음). → **밝기 단독 판정은 부적절.**

### 7.3 Step 2 방향 (자세 추정 estimatedUse — 아직 감점하지 않는 별도 과제)
Step 1(인앱 상호작용 = confirmedUse)은 구현되었으나, 직접 화면 감지가 막혀 있으니 **"화면을 보며 걷는 사람의 행동 패턴"을 여러 신호로 조합해 추정**해 `estimatedUse`를 채우는 것이 Step 2 이다(현재는 항상 0, 감점 안 함):

| 단서 | 활용 | 신뢰도 |
|------|------|--------|
| ① 우리 앱이 포그라운드(AppState) | 우리 앱을 보며 걷는 중 = 확실한 사용 | 높음(확실) |
| ② 걷는 중 폰 자세(가속도계 pitch): 보는 자세(수평~45도)로 안정 유지 | 주머니(수직/뒤집힘/흔들림) vs 보는 자세 구분 | 중간 |
| ③ 걸음은 계속되는데 폰 방향이 안정적으로 "보는 각도" 유지 | 흔들리는 주머니와 달리 화면이 얼굴 향해 안정 | 중간 |
| ④ 이어폰 사용 중(이미 구현) | 콘텐츠 소비 확률↑(보조) | 낮음(보조) |

- **핵심 아이디어**: "폰이 보는 자세(수평~45도)로 안정적으로 유지되며 걸음이 지속되는 시간"을 사용 중으로 추정. 밝기는 AOD/백그라운드 문제로 단독 사용하지 않고 기껏해야 보조.
- 기존 `motionClassifier`(walking/vehicle/idle 판정)를 확장하거나 별도 자세 분류기 순수 모듈을 추가하는 방식 검토 중.
- **정직성**: 완벽한 감지가 아니라 "행동 패턴 기반 추정(휴리스틱)"임을 앱/문서에 명시할 것.

### 7.4 다른 AI에게 바라는 검토 포인트
1. 위 방향(모션 자세 + 앱 포그라운드 조합)의 타당성·정확도 개선안.
2. iOS에서 우리가 놓친 **합법적으로 가능한 다른 신호**가 있는가? (예: Core Motion의 device motion/attitude, proximity sensor, Screen Time API의 가능/불가 범위, activity type, `UIApplication` 상태 전이, 오디오 세션 상태 등)
3. 밝기·프록시미티·attitude 등을 **어떻게 조합**해야 오탐(주머니 속인데 사용으로 판정)과 미탐(보는데 미사용으로 판정)을 최소화할지.
4. iOS 제약상 정말 불가능한 것과 가능한 것의 경계를 명확히.
5. 정직성 원칙(휴리스틱임을 인정)을 지키면서도 사용자가 납득할 UX 설계.

> 제약 재확인: 새 npm 패키지 추가는 신중히(가능하면 expo 기본 제공 모듈: expo-sensors의 Accelerometer/DeviceMotion, expo-brightness 등 이미 Expo 생태계에 있는 것 위주). 순수 판정 로직은 `scripts/verify-*.ts`로 검증 가능하게 순수 함수로 분리해야 함.

---

## 8. 앞으로 해야 할 일 (백로그)

### 즉시(개발자 조작 대기)
- [ ] Supabase SQL Editor에서 최신 `schema.sql` 재실행(연령대 컬럼/RPC).
- [ ] 최신 코드로 새 preview 빌드 → 실기기 설치 → 검증(빨간원 절반/온보딩 루프 해소/막대그래프/의견전송/연령대).

### 기능 (이 문서의 주 검토 대상)
- [x] **★ 미해결 과제 A — Step 1: 증거 밴드 분류(confirmedUse = 실제 인앱 터치/스크롤, confirmedUse 만 감점, '측정 불충분' 정책)** (7절) — 구현 완료.
- [ ] **★ 미해결 과제 A — Step 2: 자세/모션 기반 estimatedUse 추정** (7.3절) — 별도 향후 과제(아직 감점 안 함).

### 출시 마무리
- [ ] 앱 아이콘 PNG 확정(현재 SVG. 하늘색 파스텔 배경+흰 발자국 시안 있으나 PNG 변환 보류 상태).
- [ ] production 빌드 + App Store Connect 등록 + 심사 제출.
- [ ] 실전 테스트(실제로 걸으며 점수·업로드·알림·차량제외 동작 확인).

### 알려진 사소한 정리거리 (선택)
- [ ] `app.json`의 `ios.infoPlist.UIBackgroundModes`에 "location" 3회 중복, `android.permissions`에 동일 권한 2회 중복 — 기능엔 무해하나 정리 가능.

---

## 9. 코드 지도 (주요 파일)

```
src/wss/
  weights.ts        가중치 상수·severity·k(=4)·임계점(60)   [실증/설계 구분 주석]
  engine.ts         computeWSS (점수 공식)
  grade.ts          등급 분류(위험/주의/양호/우수/측정중)
  context.ts        시간대(TimeBand) 판정
  weekly.ts         [신규] 주간 일별 대표점수 집계
src/data/
  accidentZones.ts  사고데이터 로드·dedup(공간격자)·ZONE_RADIUS_SCALE(0.3)·겹침/포함 판정
  supabase.ts       익명 업로드/통계/피드백(타임아웃·연령대·no-op 안전설계)
  weather.ts        KMA 단기예보 + latLonToGrid
  apiKey.ts         API 키 정규화(한 번만 인코딩)
  overlapGeometry.ts / overlapRender.ts  겹침 기하
src/session/
  backgroundTask.ts 백그라운드 세션 파이프라인(★ classifyInterval 로 증거 밴드 분류)
  usageClassification.ts [Step 1] 증거 밴드(confirmed/estimated/unknown/noUse) 순수 분류
  interactionTracker.ts  [Step 1] 인앱 터치/스크롤 시각 기록(confirmedUse 증거 소스)
  sessionReducer.ts 순수 세그먼트 누적 리듀서
  sessionStore.ts   활성 세션 지속(AsyncStorage)
  weatherCache.ts   날씨 TTL 캐시
src/sensors/
  motionClassifier.ts   [순수] walking/vehicle/idle 분류(차량 제외)
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
  onboarding/index.tsx, onboarding/permissions.tsx  온보딩(권한+연령대)
modules/audio-environment/   커스텀 네이티브 오디오 모듈(Swift)
supabase/schema.sql          DB 스키마(테이블·RLS·RPC)
docs/feedback.html           피드백 웹 대시보드(로컬 HTML)
docs/privacy-policy.md/.html 개인정보 처리방침
scripts/verify-*.ts          순수 로직 검증(16종, 전부 통과 필수)
assets/accident-zones.json   전국 사고다발지 12,780건(원본, 수정 금지)
```

## 10. 검증 스크립트 목록(16종)
verify-wss-example, verify-grade, verify-feedback, verify-grid, verify-audio-ear-mapping, verify-geofence-selection, verify-session-reducer, verify-overlap-geometry, verify-dedup, verify-segment-key, verify-overlap-render, verify-api-key, verify-supabase-stats, verify-motion-classifier, verify-weekly, verify-agegroup-stats.
실행: `env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-<name>.ts`

---

## 11. 다른 AI에게 (요청 요약)
이 문서의 **7절(스마트폰 사용 추정)**이 지금 가장 풀고 싶은 문제입니다. iOS 제약 안에서 "보행 측정 시작 후, 사용자가 화면을 보며 걷고 있는지"를 **여러 센서 단서를 조합해 신뢰도 있게 추정**하는 방법을, 우리가 놓친 대안까지 포함해 제안해 주세요. 정직성 원칙(휴리스틱임을 인정, 가짜 데이터·미검증 예측 금지)과 순수 함수 검증 가능성(verify 스크립트)을 지켜야 합니다.
