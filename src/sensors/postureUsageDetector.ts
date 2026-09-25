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
