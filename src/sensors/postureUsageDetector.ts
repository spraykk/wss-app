// 자세 기반 "보행 중 스마트폰 사용" 감지기 - 순수 함수/상수 모듈
//
// 목적: 보행 중 화면을 들여다보는(viewing-while-walking) 자세를 사용(use)으로,
// 그 외 모든 자세/상태를 미사용(no-use)으로 판정한다. 판정의 유일한 근거는 사용자
// 1인의 실측 데이터에서 "화면을 보며 걷는" 자세만 pitch(기기 앞뒤 기울기)가 뚜렷하게
// 양(+)이었다는 사실이다. 다른 어떤 자세(주머니/재킷/손에 들고 화면 반대 등)도 pitch
// 중앙값이 모두 음(-)이었다. 따라서 pitch 하나로 깔끔하게 분리된다. roll 은 분리력이
// 약해 사용하지 않는다.
//
// [정직성] 아래 상수(PITCH_USE_THRESHOLD_DEG, USE_SUSTAIN_MS)는
// "사용자 1인 실측 기반 설계값 · 실제 사고 예측 아님"이다. 이는 튜닝 가능한 설계값이며,
// 확정된(frozen) 채점 파라미터(k=4 / 0.3 / 40 / 60, weights.ts)와는 다르다.
//
// 실측 근거(사용자 1인 단말 측정, pitch deg 중앙값):
//   - viewing-while-walking(화면 보며 걷기): +19.9 (평균 +20.3, 범위 -0.2..+51.6, 명확히 양)
//   - back-pocket(뒷주머니): -70.0
//   - front-pocket(앞주머니): -73.7
//   - jacket-inner(재킷 안주머니): -13.5
//   - jacket-outer(재킷 바깥주머니): -22.1
//   - in-hand-screen-facing(손에 들고 화면 위): -51.7
//   - in-hand-screen-away(손에 들고 화면 반대): -54.4
// => 사용 자세만 pitch 가 명확히 양수이며, pitch >= 10deg 에서 깔끔하게 분리된다.
//
// 이 모듈은 React Native / Expo / node:* 를 전혀 import 하지 않는 순수 모듈이다.
// erasable-only TS(enum/parameter property/namespace 미사용)라
// `node --experimental-strip-types` 로 검증된다(scripts/verify-posture-usage.ts).
// pitch 값 자체는 src/sensors/postureMath.ts 의 gravityToPitchRoll 로 호출부(FEAT-003)에서
// 계산해 주입한다. 이 모듈은 이미 계산된 pitchDeg 를 받아 순수/검증 가능성을 유지한다.

// [설계값 · 사용자 1인 실측 기반 · 실제 사고 예측 아님]
// 화면을 보며 걷는 자세로 인정하는 pitch 하한(도). 실측상 사용 자세 중앙값 +19.9 vs
// 모든 비사용 자세 음수(-70.0 ~ -13.5)라 10도면 명확히 분리된다. 튜닝 가능한 설계값이며
// 확정된 채점 파라미터가 아니다.
export const PITCH_USE_THRESHOLD_DEG = 10;

// [설계값 · 사용자 1인 실측 기반 · 실제 사고 예측 아님]
// pitch 가 임계 이상으로 "지속"되어야 사용으로 인정하는 최소 유지 시간(ms). 순간적으로
// 기기를 들었다 놓는(3초 미만) 튐은 사용으로 세지 않기 위한 램프업(ramp-up) 구간이다.
// 튜닝 가능한 설계값이며 확정된 채점 파라미터가 아니다.
export const USE_SUSTAIN_MS = 3000;

// 감지기의 지속 상태(순수). 샘플 사이에서 "임계를 계속 넘고 있는 구간"의 시작 시각을
// 기억해, 3초 지속 여부를 판단한다.
export interface PostureUsageState {
  // 걷는 중 pitch 가 임계를 처음 넘은 시각(ms epoch). 현재 지속 구간이 끊기면(걷지 않음,
  // pitch 임계 미만, 센서 공백 등) null 로 리셋한다.
  sustainedSinceMs: number | null;
}

// 초기 상태 팩토리(순수).
export function createInitialPostureUsageState(): PostureUsageState {
  return { sustainedSinceMs: null };
}

// 한 개의 자세 샘플. pitchDeg 는 postureMath.gravityToPitchRoll 로 계산된 pitch(도),
// walking 은 보행 감지 결과, nowMs 는 관측 시각(테스트 결정성을 위해 주입).
export interface PostureSample {
  pitchDeg: number;
  walking: boolean;
  nowMs: number;
}

// step 함수의 결과. 이 구간(elapsedMinutes)이 use/no-use 중 어디로 귀속되는지와 다음 상태.
export interface PostureIntervalResult {
  useMinutes: number;
  noUseMinutes: number;
  next: PostureUsageState;
}

// 이 샘플 시점에 "사용(지속된 기울임)"이 확정되었는지 판정하는 순수 헬퍼.
// - 걷지 않거나 pitch 가 임계 미만이거나 nowMs 가 비유한이면 지속 구간이 아니다(false).
// - 걷는 중 + pitch>=임계이며, 지속 시작 시각이 있고 (nowMs - 시작) >= USE_SUSTAIN_MS 이면
//   사용 확정(true). 경계값(정확히 3000ms)은 포함(>=)한다.
// prevState.sustainedSinceMs 는 "이 샘플 이전까지" 유지되던 시작 시각이다. 이 헬퍼는
// 상태를 갱신하지 않고 판정만 한다(순수/독립 테스트 가능).
export function isSustainedUse(prevState: PostureUsageState, sample: PostureSample): boolean {
  const { pitchDeg, walking, nowMs } = sample;
  if (!walking) return false;
  if (!Number.isFinite(nowMs)) return false;
  if (!Number.isFinite(pitchDeg) || pitchDeg < PITCH_USE_THRESHOLD_DEG) return false;
  const since = prevState.sustainedSinceMs;
  if (since === null) return false;
  // 시계 되감김(rewind) 방어: nowMs 가 시작보다 이전이면 지속으로 보지 않는다.
  const held = nowMs - since;
  return held >= USE_SUSTAIN_MS;
}

// 핵심: 이전 상태 + 새 샘플 + 이 구간에 귀속되는 경과 분(elapsedMinutes)으로부터
// (useMinutes, noUseMinutes, 다음 상태)를 계산하는 순수 step 함수.
//
// elapsedMinutes 는 파이프라인(FEAT-003)이 "직전 샘플 이후 이 구간에 귀속하는 시간"으로
// 계산해 넘기는 값이다. 음수/비유한이면 0 으로 취급(사용/미사용 어느 쪽도 뻥튀기 금지).
//
// 규칙:
//  (1) 걷지 않음 OR pitch < 임계 OR nowMs 비유한 => 지속 구간 끊김(next.sustainedSinceMs=null),
//      경과 시간 전부 no-use.
//  (2) 걷는 중 AND pitch >= 임계:
//      - 지속 시작 시각(sustainedSinceMs)이 null 이면 nowMs 로 시작(아직 3초 미충족 => no-use).
//      - 시작 시각이 있고 (nowMs - 시작) >= USE_SUSTAIN_MS 이면 use, 아니면(램프업 중) no-use.
//      - 시계 되감김(nowMs < 시작)은 보수적으로 지속 시작을 nowMs 로 재설정하고 no-use.
//  sustainedSinceMs 를 구간 간에 유지하므로, 임계 아래로 떨어지는 순간 리셋되어 순간적
//  튐(3초 미만)은 절대 use 로 세지 않는다.
//
// [센서 공백 정책(사용자 결정 '가')] 샘플이 도착하지 않는 공백 구간은 정직한 기본값으로
// no-use 다. 파이프라인(FEAT-003)은 공백을 walking=false 로 넘기거나 경과를 누적하지 않는데,
// 어느 쪽이든 여기서는 no-use 로 귀속된다. "모르면 사용으로 감점하지 않는다"는 보수적 태도.
export function classifyPostureInterval(
  prevState: PostureUsageState,
  sample: PostureSample,
  elapsedMinutes: number
): PostureIntervalResult {
  const minutes =
    Number.isFinite(elapsedMinutes) && elapsedMinutes > 0 ? elapsedMinutes : 0;

  const { pitchDeg, walking, nowMs } = sample;

  // (1) 지속 구간을 끊는 조건들 => 전부 no-use, 시작 시각 리셋.
  const breaksRun =
    !walking ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(pitchDeg) ||
    pitchDeg < PITCH_USE_THRESHOLD_DEG;

  if (breaksRun) {
    return {
      useMinutes: 0,
      noUseMinutes: minutes,
      next: { sustainedSinceMs: null },
    };
  }

  // (2) 걷는 중 + pitch >= 임계.
  let sustainedSinceMs = prevState.sustainedSinceMs;

  // 지속 시작이 없으면 지금부터 시작(아직 3초 미충족). 시계 되감김이면 보수적으로 재시작.
  if (sustainedSinceMs === null || nowMs < sustainedSinceMs) {
    sustainedSinceMs = nowMs;
  }

  const held = nowMs - sustainedSinceMs;
  const isUse = held >= USE_SUSTAIN_MS;

  return {
    useMinutes: isUse ? minutes : 0,
    noUseMinutes: isUse ? 0 : minutes,
    next: { sustainedSinceMs },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 고빈도(약 200ms) 자이로 스트림용 지속 추적기 (FEAT-001 핵심 결함 수정)
//
// 배경/결함: 기존 classifyPostureInterval 는 "위치 이벤트가 오는 순간"(timeInterval:5000,
// 약 5초마다)의 pitch 한 점으로만 지속을 갱신했다. 그래서 5초 간격 스냅샷 중 하나라도
// pitch<10(팔 흔들림/순간 자세 변화)이면 지속이 끊겨 '사용'이 거의 잡히지 않았다
// (사용자 증상: 점수가 안 떨어짐). 실제로는 DeviceMotion/Accelerometer 가 약 200ms 마다
// pitch 를 갱신하므로, 이 고빈도 스트림 자체에서 "pitch>=10 이 연속 유지된 시간"을 추적하면
// 5초 스냅샷의 착시 없이 3초 지속을 정직하게 판정할 수 있다.
//
// [불변] 임계값은 그대로다: pitch 하한 PITCH_USE_THRESHOLD_DEG=10, 지속 USE_SUSTAIN_MS=3000.
// 바뀌는 것은 "어느 신호(5초 위치 스냅샷 대신 200ms 자이로)에서 지속을 추적하느냐"뿐이다.

// 고빈도 지속 추적 상태(순수). classifyPostureInterval 의 PostureUsageState 와 별개로 둔다
// (하위호환: 기존 상태/함수 시그니처를 건드리지 않는다). lastSampleMs 는 진단/디버깅용으로
// 마지막으로 처리한 샘플 시각을 보관한다(판정 로직에는 sustainedSinceMs 만 쓰인다).
export interface PostureContinuityState {
  // 걷는 중 pitch 가 임계를 처음 넘은 시각(ms epoch). 지속이 끊기면 null.
  sustainedSinceMs: number | null;
  // 마지막으로 step 한 샘플의 시각(ms epoch). 아직 없으면 null(진단용).
  lastSampleMs: number | null;
}

// 초기 상태 팩토리(순수).
export function createInitialPostureContinuityState(): PostureContinuityState {
  return { sustainedSinceMs: null, lastSampleMs: null };
}

// step 결과: 다음 상태 + 현재 지속 시간(ms) + 현재 '사용 중'(isUse) 여부.
export interface PostureContinuityResult {
  next: PostureContinuityState;
  // 현재 pitch>=10 이 연속 유지된 시간(ms). 지속 중이 아니면 0.
  sustainedMs: number;
  // sustainedMs >= USE_SUSTAIN_MS 이면 true(경계 3000 포함, >=).
  isUse: boolean;
}

// 핵심: 이전 지속 상태 + 한 개의 고빈도 자이로 샘플({pitchDeg, walking, nowMs})로부터
// (다음 상태, 지속 시간 ms, isUse)를 계산하는 순수 함수. 매 자이로 콜백(약 200ms)마다 호출한다.
//
// 규칙(임계 불변):
//  - walking=true AND Number.isFinite(pitchDeg) AND pitchDeg>=PITCH_USE_THRESHOLD_DEG:
//    지속 유지. sustainedSinceMs 가 null 이면 nowMs 로 시작. 단 nowMs 비유한이면 아래 리셋 경로.
//    sustainedMs = nowMs - sustainedSinceMs, isUse = sustainedMs >= USE_SUSTAIN_MS.
//  - 그 외(안 걸음 / pitch<10 / pitch 또는 nowMs 비유한): sustainedSinceMs=null 로 리셋,
//    sustainedMs=0, isUse=false.
//  - 시계 되감김(nowMs < sustainedSinceMs)은 보수적으로 nowMs 로 재시작(그 샘플은 sustainedMs=0).
//  - 순수: prev 를 변형하지 않고 새 객체를 반환한다.
export function stepPostureContinuity(
  prev: PostureContinuityState,
  sample: PostureSample
): PostureContinuityResult {
  const { pitchDeg, walking, nowMs } = sample;

  // 지속을 끊는 조건들 => 리셋. nowMs 가 비유한이면 lastSampleMs 는 갱신하지 않는다
  // (진단 시각의 의미를 유지). 그 외 리셋은 lastSampleMs 를 nowMs 로 갱신한다.
  const breaksRun =
    !walking ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(pitchDeg) ||
    pitchDeg < PITCH_USE_THRESHOLD_DEG;

  if (breaksRun) {
    return {
      next: {
        sustainedSinceMs: null,
        lastSampleMs: Number.isFinite(nowMs) ? nowMs : prev.lastSampleMs,
      },
      sustainedMs: 0,
      isUse: false,
    };
  }

  // 걷는 중 + pitch>=임계 + nowMs 유한.
  let sustainedSinceMs = prev.sustainedSinceMs;
  if (sustainedSinceMs === null || nowMs < sustainedSinceMs) {
    // 지속 시작이 없거나 시계 되감김 => 지금부터 재시작.
    sustainedSinceMs = nowMs;
  }

  const sustainedMs = nowMs - sustainedSinceMs;
  const isUse = sustainedMs >= USE_SUSTAIN_MS;

  return {
    next: { sustainedSinceMs, lastSampleMs: nowMs },
    sustainedMs,
    isUse,
  };
}
