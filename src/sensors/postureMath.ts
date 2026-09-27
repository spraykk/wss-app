// 자세(각도) 측정용 순수 수학 모듈 — 방식1(Step 2 준비)의 "측정/기록" 전용.
//
// 배경(정직성/범위 한정):
//  - 이 모듈과 이를 쓰는 자세 측정 화면(app/posture-lab.tsx)은 "측정 도구"일 뿐이며,
//    여기서 계산한 pitch/roll 각도는 아직 WSS 점수에 전혀 반영되지 않는다.
//  - 목적은 사용자가 실기기에서 여러 자세(화면 보며 걷기 / 주머니 / 손에 들고 앞 보기 등)의
//    각도 데이터를 직접 수집해, 그 데이터를 보고 "사용 중"으로 볼 각도 임계 범위를 정하는 것이다.
//    임계가 정해진 뒤에야(후속 단계) estimatedUse 감점에 반영할 예정이다.
//
// 순수성 규칙(다른 순수 모듈과 동일):
//  - React/Expo/센서 런타임 의존 없음. node:* 표준 라이브러리 import 금지(RN 런타임에 없음).
//  - 값 주입식 순수 함수만 두어 `node --experimental-strip-types` 로 검증 가능하게 한다
//    (scripts/verify-posture-math.ts). 화면(RN 컴포넌트)은 이 함수들을 호출만 한다.

// 라디안 -> 도 변환.
const RAD_TO_DEG = 180 / Math.PI;

// 3축 중력(gravity) 벡터. expo-sensors Accelerometer 는 정지 시 중력을 g 단위(약 ±1)로
// x/y/z 에 담아준다. DeviceMotion 도 accelerationIncludingGravity 를 제공한다.
export interface GravityVector {
  x: number;
  y: number;
  z: number;
}

// 기기 기울기(도 단위).
//  - pitch: 기기가 앞/뒤로 얼마나 기울었는지. 화면이 하늘을 향해 평평(수평)하면 0도에 가깝고,
//           얼굴 앞으로 세울수록(수직) 절댓값이 커진다. 대략 -90 ~ +90 범위.
//  - roll:  기기가 좌/우로 얼마나 기울었는지. 좌우로 눕히면 절댓값이 커진다.
export interface PitchRoll {
  pitchDeg: number;
  rollDeg: number;
}

// 중력 벡터(x,y,z) -> pitch/roll(도) 변환 순수 함수.
//
// 좌표계(expo-sensors / iOS Accelerometer 기준, 세로 방향 폰):
//   +x: 화면 오른쪽,  +y: 화면 위쪽,  +z: 화면 바깥(사용자 쪽).
// 폰이 화면을 위로 하고 평평히 놓이면 중력은 화면 안쪽(-z)으로 향해 (0,0,-1) 근처가 된다.
//
//   pitch = atan2(-y, sqrt(x^2 + z^2))  → 앞/뒤 기울기(위/아래로 세움)
//   roll  = atan2(x, -z)                → 좌/우 기울기
//
// 대표 자세로 검증(verify-posture-math.ts):
//   - 화면 위로 평평(수평): g≈(0,0,-1)  → pitch≈0,  roll≈0
//   - 세로로 똑바로 세움:   g≈(0,-1,0)  → pitch≈+90 (위쪽이 하늘을 향함)
//   - 얼굴 앞 45도로 기울임: g≈(0,-0.707,-0.707) → pitch≈+45
//   - 좌로 90도 눕힘:       g≈(1,0,0)   → roll≈+90
export function gravityToPitchRoll(g: GravityVector): PitchRoll {
  const { x, y, z } = g;
  const pitchDeg = Math.atan2(-y, Math.sqrt(x * x + z * z)) * RAD_TO_DEG;
  const rollDeg = Math.atan2(x, -z) * RAD_TO_DEG;
  return { pitchDeg, rollDeg };
}

// 한 각도 축(pitch 또는 roll)의 요약 통계.
export interface AxisSummary {
  min: number;
  max: number;
  mean: number;
  median: number;
}

// 자세 기록 구간의 요약 통계(순수). 사용자가 "기록 시작~중지" 사이 수집한 pitch/roll
// 샘플 배열을 넣으면 개수와 축별 min/max/mean/median 을 돌려준다.
export interface PostureSummary {
  count: number;
  pitch: AxisSummary;
  roll: AxisSummary;
}

// 수치 배열의 최소값(순수). 빈 배열이면 0(호출부에서 count===0 을 함께 확인해 표시 판단).
function minOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let m = values[0];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] < m) m = values[i];
  }
  return m;
}

// 수치 배열의 최대값(순수).
function maxOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let m = values[0];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > m) m = values[i];
  }
  return m;
}

// 산술 평균(순수).
function meanOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i];
  return sum / values.length;
}

// 중앙값(순수). 원본을 변형하지 않도록 복사 후 정렬한다. 짝수 개면 가운데 두 값의 평균.
function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

// 한 축 배열의 요약을 계산하는 순수 헬퍼.
export function summarizeAxis(values: readonly number[]): AxisSummary {
  return {
    min: minOf(values),
    max: maxOf(values),
    mean: meanOf(values),
    median: medianOf(values),
  };
}

// pitch/roll 샘플 배열 -> 요약 통계(순수). 두 배열 길이가 다르면 짧은 쪽 기준으로 count 를
// 잡되(방어적), 실제 화면에서는 항상 동일 길이로 push 한다.
export function summarizePosture(
  pitchSamples: readonly number[],
  rollSamples: readonly number[]
): PostureSummary {
  const count = Math.min(pitchSamples.length, rollSamples.length);
  return {
    count,
    pitch: summarizeAxis(pitchSamples.slice(0, count)),
    roll: summarizeAxis(rollSamples.slice(0, count)),
  };
}
