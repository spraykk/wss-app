// 이동수단 분류기 (차량 탑승 오인 방지) - 순수 함수 모듈
//
// 배경: 기존 walkingDetector 는 GPS 속도만 0.5~2.5 m/s 범위인지 보고 보행을 판정했다.
// 그런데 버스/자동차로 이동 중 신호대기·정체로 잠깐 도보 속도(0.5~2.5 m/s)가 관측되면
// 보행으로 오인해 WSS 세그먼트를 잘못 쌓을 수 있다. 이를 막기 위해 "차량 모드" 상태와
// 쿨다운(cooldown)을 두어, 최근 고속(차량 수준) 관측이 있으면 일정 시간 보행 판정을
// 잠근다. 또 Pedometer 걸음수 증가를 함께 보아 "걸음 없이 이동"이면 차량 쪽에 가중한다.
//
// 이 모듈은 React/Expo 런타임 의존이 전혀 없는 순수 함수/상수만 담아
// `node --experimental-strip-types` 로 검증 가능하다(scripts/verify-motion-classifier.ts).
// 훅(useWalkingDetector)이 이 순수 함수를 사용하고, 센서/타이머 배선만 담당한다.

// 분류 결과. 'idle'=정지에 가까움, 'walking'=보행, 'vehicle'=차량 탑승(측정 제외 대상).
export type MotionMode = 'walking' | 'vehicle' | 'idle';

// 보행으로 간주하는 속도 범위(m/s). 대략 0.5~2.5 m/s(약 1.8~9 km/h).
export const WALK_MIN_SPEED_MPS = 0.5;
export const WALK_MAX_SPEED_MPS = 2.5;

// 차량 수준으로 보는 속도 임계(m/s). 4.2 m/s ≈ 15 km/h.
// 이 이상이 관측되면 "차량 모드"로 전환하고 쿨다운 동안 보행 판정을 잠근다.
export const VEHICLE_SPEED_MPS = 4.2;

// 차량 모드 쿨다운(ms). 마지막 고속 관측 후 이 시간 동안은 저속이어도 차량으로 유지한다
// (버스 신호대기/정체로 잠깐 도보 속도가 나와도 보행으로 오인하지 않게).
export const VEHICLE_COOLDOWN_MS = 60000; // 60초

// 차량 쿨다운 해제 후 "확실한 보행"으로 인정해 보행을 재개하기 위한 최소 연속 걸음 증가.
// 걸음 없이 도보 속도만 나오는 경우(예: 차 안에서 흔들림)엔 보행으로 복귀하지 않는다.
export const MIN_STEP_DELTA_FOR_WALK = 1;

// 분류기의 지속 상태(순수). 훅이 이 상태를 보관하고 매 샘플마다 갱신한다.
export interface MotionState {
  // 마지막으로 차량 수준 고속을 관측한 시각(ms epoch). 없으면 null.
  lastVehicleObservedAt: number | null;
  // 마지막으로 본 누적 걸음 수(Pedometer). 걸음 증가(delta) 계산용. 없으면 null.
  lastStepCount: number | null;
  // 현재 분류 모드(직전 결과). 히스테리시스/디버깅용.
  mode: MotionMode;
}

// 초기 상태 팩토리(순수).
export function createInitialMotionState(): MotionState {
  return { lastVehicleObservedAt: null, lastStepCount: null, mode: 'idle' };
}

// 한 개의 센서 샘플. speedMps 는 GPS 속도, stepCount 는 Pedometer 누적 걸음(없으면 undefined),
// nowMs 는 관측 시각(테스트 결정성을 위해 주입).
export interface MotionSample {
  speedMps: number;
  stepCount?: number;
  nowMs: number;
}

// 속도만으로 보행 속도 범위인지 판정하는 순수 헬퍼(하위호환: 기존 isWalkingSpeed 대체).
export function isWalkingSpeed(
  speedMps: number,
  minMps: number = WALK_MIN_SPEED_MPS,
  maxMps: number = WALK_MAX_SPEED_MPS
): boolean {
  return speedMps >= minMps && speedMps <= maxMps;
}

// 핵심: 이전 상태 + 새 샘플로부터 (모드, 다음 상태)를 계산하는 순수 함수.
//
// 규칙:
//  1) 속도가 VEHICLE_SPEED_MPS 이상이면 즉시 'vehicle', lastVehicleObservedAt=now.
//  2) 그렇지 않아도 쿨다운(VEHICLE_COOLDOWN_MS) 내에 고속 관측이 있으면 'vehicle' 유지.
//     단, 쿨다운 중이라도 "확실한 보행 패턴"(도보 속도 + 걸음 증가)이 관측되면 보행으로
//     조기 복귀한다(정체 후 하차해 걷기 시작한 경우를 빠르게 반영).
//  3) 쿨다운도 아니면 속도로 판정: 도보 범위=보행, 아니면 idle.
//     걸음 정보(stepCount)가 있으면 "걸음 없이 도보 속도"는 보행으로 인정하지 않고 idle 로
//     둔다(차량 미세 이동/GPS 흔들림 오인 방지). 걸음 정보가 없으면 속도만으로 보행 인정.
export function classifyMotion(
  prev: MotionState,
  sample: MotionSample
): { mode: MotionMode; next: MotionState } {
  const { speedMps, stepCount, nowMs } = sample;

  // 걸음 증가(delta) 계산. 이전 걸음 수가 없거나 현재 걸음 수가 없으면 판단 보류(null).
  const stepDelta =
    stepCount !== undefined && prev.lastStepCount !== null
      ? stepCount - prev.lastStepCount
      : null;
  const hasStepInfo = stepCount !== undefined;
  const steppingNow = stepDelta !== null && stepDelta >= MIN_STEP_DELTA_FOR_WALK;

  // 다음 상태에 반영할 lastStepCount(현재 값이 있으면 갱신, 없으면 유지).
  const nextStepCount = stepCount !== undefined ? stepCount : prev.lastStepCount;

  // (1) 고속 관측 -> 차량 모드 진입/갱신.
  if (speedMps >= VEHICLE_SPEED_MPS) {
    return {
      mode: 'vehicle',
      next: {
        lastVehicleObservedAt: nowMs,
        lastStepCount: nextStepCount,
        mode: 'vehicle',
      },
    };
  }

  // (2) 쿨다운 판정: 최근 고속 관측이 쿨다운 이내인가?
  const inCooldown =
    prev.lastVehicleObservedAt !== null &&
    nowMs - prev.lastVehicleObservedAt < VEHICLE_COOLDOWN_MS;

  if (inCooldown) {
    // 확실한 보행(도보 속도 + 걸음 증가)이면 쿨다운을 조기 종료하고 보행 복귀.
    if (isWalkingSpeed(speedMps) && steppingNow) {
      return {
        mode: 'walking',
        next: {
          lastVehicleObservedAt: null, // 쿨다운 해제
          lastStepCount: nextStepCount,
          mode: 'walking',
        },
      };
    }
    // 그 외(저속 정체/걸음 없음)엔 차량 유지.
    return {
      mode: 'vehicle',
      next: {
        lastVehicleObservedAt: prev.lastVehicleObservedAt,
        lastStepCount: nextStepCount,
        mode: 'vehicle',
      },
    };
  }

  // (3) 쿨다운 밖 -> 속도(+걸음)로 일반 판정.
  let mode: MotionMode;
  if (isWalkingSpeed(speedMps)) {
    // 걸음 정보가 있으면 걸음 증가가 있어야 보행 인정. 없으면 속도만으로 보행 인정.
    mode = hasStepInfo ? (steppingNow ? 'walking' : 'idle') : 'walking';
  } else {
    mode = 'idle';
  }

  return {
    mode,
    next: {
      lastVehicleObservedAt: null,
      lastStepCount: nextStepCount,
      mode,
    },
  };
}
