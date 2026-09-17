// 보행 감지기 (버그 #2, LOW) - expo-sensors 가속도 + 속도 임계 판정
//
// 배경: setInterval 콜백이 currentSpeedMps 를 읽는데, 이 값은 별도의 setState 로만
// 갱신되었다. setState 는 비동기이고 인터벌 콜백은 "생성 시점의 클로저"에 갇힌
// 값을 읽으므로, 속도 판정이 한 틱(tick) 지연된(stale) 값을 사용했다.
//
// FIX: 최신 속도를 useRef 에 setState 와 "동기적으로 함께" 저장하고, 인터벌은
// ref.current 를 읽게 한다. ref 는 렌더와 무관하게 항상 최신 값을 가리키므로
// 클로저 stale 문제가 사라진다. 임계 판정은 순수 함수 isWalkingSpeed 로 분리한다.
import { useEffect, useRef, useState } from 'react';
import { Accelerometer } from 'expo-sensors';

// 보행으로 간주하는 속도 범위(m/s). 대략 0.5~2.5 m/s(약 1.8~9 km/h).
export const WALK_MIN_SPEED_MPS = 0.5;
export const WALK_MAX_SPEED_MPS = 2.5;

// 속도 임계 판정을 순수 함수로 분리(검증 가능). 보행 속도 범위면 true.
export function isWalkingSpeed(
  speedMps: number,
  minMps: number = WALK_MIN_SPEED_MPS,
  maxMps: number = WALK_MAX_SPEED_MPS
): boolean {
  return speedMps >= minMps && speedMps <= maxMps;
}

export interface WalkingDetectorState {
  isWalking: boolean;
  speedMps: number;
}

// 현재 속도(m/s)를 외부에서 주입받아 보행 여부를 판정하는 훅.
// setSpeed 로 최신 속도를 넘기면 setState 와 ref 를 동기적으로 함께 갱신한다.
export function useWalkingDetector(intervalMs: number = 1000): {
  state: WalkingDetectorState;
  setSpeed: (speedMps: number) => void;
} {
  const [state, setState] = useState<WalkingDetectorState>({ isWalking: false, speedMps: 0 });

  // 최신 속도를 담는 ref. 인터벌 콜백이 stale 클로저 대신 이 ref 를 읽는다.
  const speedRef = useRef<number>(0);

  // 외부(GPS 등)에서 속도를 갱신할 때 ref 와 state 를 "동시에" 갱신한다.
  const setSpeed = (speedMps: number): void => {
    speedRef.current = speedMps; // 동기적으로 즉시 최신값 반영
    setState((prev) => ({ ...prev, speedMps }));
  };

  useEffect(() => {
    const timer = setInterval(() => {
      // stale setState 값이 아니라 ref 의 최신 속도를 읽어 판정한다.
      const latest = speedRef.current;
      const walking = isWalkingSpeed(latest);
      setState((prev) =>
        prev.isWalking === walking && prev.speedMps === latest
          ? prev
          : { isWalking: walking, speedMps: latest }
      );
    }, intervalMs);

    return () => clearInterval(timer);
  }, [intervalMs]);

  return { state, setSpeed };
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
