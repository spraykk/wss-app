// 보행 감지기 (버그 #2, LOW + 차량 탑승 오인 방지) - expo-sensors + 속도/걸음 판정
//
// 배경(#2): setInterval 콜백이 currentSpeedMps 를 읽는데, 이 값은 별도의 setState 로만
// 갱신되었다. setState 는 비동기이고 인터벌 콜백은 "생성 시점의 클로저"에 갇힌
// 값을 읽으므로, 속도 판정이 한 틱(tick) 지연된(stale) 값을 사용했다.
// FIX: 최신 속도/걸음을 useRef 에 setState 와 "동기적으로 함께" 저장하고, 인터벌은
// ref.current 를 읽게 한다. ref 는 렌더와 무관하게 항상 최신 값을 가리키므로
// 클로저 stale 문제가 사라진다.
//
// 배경(차량 오인): 속도만으로 보행을 판정하면 버스/자동차 이동 중 신호대기·정체로
// 잠깐 도보 속도가 나올 때 보행으로 오인한다. 그래서 순수 분류기(motionClassifier)의
// classifyMotion 을 사용해 "차량 모드 + 쿨다운" 을 반영한다. 걸음 증가(Pedometer)를 함께
// 넘기면 "걸음 없이 이동"은 차량 쪽으로 가중된다. isWalking 은 mode==='walking' 일 때만 true.
import { useEffect, useRef, useState } from 'react';
import { Accelerometer } from 'expo-sensors';
import {
  classifyMotion,
  createInitialMotionState,
  isWalkingSpeed,
  WALK_MIN_SPEED_MPS,
  WALK_MAX_SPEED_MPS,
} from './motionClassifier';
import type { MotionMode, MotionState } from './motionClassifier';

// 하위호환 재노출: 기존에 walkingDetector 에서 import 하던 심볼을 그대로 유지한다.
export { isWalkingSpeed, WALK_MIN_SPEED_MPS, WALK_MAX_SPEED_MPS };
export type { MotionMode } from './motionClassifier';

export interface WalkingDetectorState {
  isWalking: boolean;
  speedMps: number;
  // 현재 분류 모드('walking'|'vehicle'|'idle'). 차량 구간을 UI/세션에서 제외하는 데 쓴다.
  mode: MotionMode;
}

// 현재 속도(m/s)/걸음 수를 외부에서 주입받아 이동수단을 분류하는 훅.
// setSpeed 로 최신 속도를, setStepCount 로 최신 누적 걸음을 넘기면 ref 를 동기적으로 갱신한다.
export function useWalkingDetector(intervalMs: number = 1000): {
  state: WalkingDetectorState;
  setSpeed: (speedMps: number) => void;
  setStepCount: (stepCount: number) => void;
} {
  const [state, setState] = useState<WalkingDetectorState>({
    isWalking: false,
    speedMps: 0,
    mode: 'idle',
  });

  // 최신 속도/걸음을 담는 ref. 인터벌 콜백이 stale 클로저 대신 이 ref 를 읽는다.
  const speedRef = useRef<number>(0);
  const stepRef = useRef<number | undefined>(undefined);
  // 분류기의 지속 상태(차량 쿨다운/직전 걸음). 렌더와 무관하게 ref 로 보관한다.
  const motionRef = useRef<MotionState>(createInitialMotionState());

  // 외부(GPS 등)에서 속도를 갱신할 때 ref 와 state 를 "동시에" 갱신한다.
  const setSpeed = (speedMps: number): void => {
    speedRef.current = speedMps; // 동기적으로 즉시 최신값 반영
    setState((prev) => (prev.speedMps === speedMps ? prev : { ...prev, speedMps }));
  };

  // 외부(Pedometer)에서 누적 걸음 수를 갱신한다.
  const setStepCount = (stepCount: number): void => {
    stepRef.current = stepCount;
  };

  useEffect(() => {
    const timer = setInterval(() => {
      // stale setState 값이 아니라 ref 의 최신 속도/걸음을 읽어 분류한다.
      const latestSpeed = speedRef.current;
      const { mode, next } = classifyMotion(motionRef.current, {
        speedMps: latestSpeed,
        stepCount: stepRef.current,
        nowMs: Date.now(),
      });
      motionRef.current = next;
      const walking = mode === 'walking';
      setState((prev) =>
        prev.isWalking === walking && prev.speedMps === latestSpeed && prev.mode === mode
          ? prev
          : { isWalking: walking, speedMps: latestSpeed, mode }
      );
    }, intervalMs);

    return () => clearInterval(timer);
  }, [intervalMs]);

  return { state, setSpeed, setStepCount };
}

// (선택) 가속도 센서 구독 헬퍼. 실제 앱에서 흔들림 세기를 관찰할 때 사용.
export function subscribeAccelerometer(
  onSample: (magnitude: number) => void,
  updateIntervalMs: number = 200
): () => void {
  Accelerometer.setUpdateInterval(updateIntervalMs);
  const sub = Accelerometer.addListener(({ x, y, z }) => {
    onSample(Math.sqrt(x * x + y * y + z * z));
  });
  return () => sub.remove();
}
