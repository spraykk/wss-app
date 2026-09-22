// 오디오 환경 구독 훅 (FEAT-002) - RN/Expo 런타임 전용
//
// RN/Expo runtime only; not executed in sandbox.
//
// FEAT-001의 신호 소스(iOS: AVAudioSession.isOtherAudioPlaying 및
// currentRoute.outputs[].portType == .bluetoothA2DP/.bluetoothHFP)를 읽는 커스텀
// 네이티브 모듈을 구독/폴링해 현재 AudioEnvironment 를 반환한다.
//
// 현재 상태: 네이티브 모듈(FEAT-005에서 배선 예정)이 아직 없으므로 안전 축소 스텁이다.
// Expo Go/미지원 플랫폼/네이티브 미탑재에서는 { false, false }(open ear)로 축소하여
// 허위 감점(오탐)이 발생하지 않도록 한다. 인터페이스는 여기서 확정한다.
import { useEffect, useState } from 'react';
import type { AudioEnvironment } from './audioState';
import { OPEN_EAR_ENVIRONMENT } from './audioState';

// TODO(FEAT-005): EAS dev build에서 커스텀 Expo 모듈("AudioEnvironment")을 배선한다.
//   - getEnvironment(): { bluetoothAudioRouteConnected, otherAudioPlaying } 스냅샷
//   - onAudioEnvironmentChange 이벤트(routeChangeNotification 기반) 구독으로 실시간 갱신
//   네이티브 모듈이 없거나 로드 실패 시 아래처럼 OPEN_EAR_ENVIRONMENT 로 안전 축소한다.
function readAudioEnvironmentSafe(): AudioEnvironment {
  // 네이티브 모듈 미탑재(Expo Go 포함) -> open ear 로 안전 축소.
  return OPEN_EAR_ENVIRONMENT;
}

/**
 * 훅이 아닌 곳(백그라운드 태스크 등)에서 현재 오디오 환경을 1회 읽는 동기 스냅샷.
 * FEAT-004: 백그라운드 세션 파이프라인이 React 훅을 쓸 수 없으므로 순간값이 필요하다.
 * FEAT-001 한계: 딥 백그라운드에서는 네이티브 오디오 세션이 비활성이라 값이 stale/미지원일
 * 수 있다 -> 그 경우 안전 축소값(open ear)을 반환한다(best-effort, 오탐 없음).
 */
export function readAudioEnvironmentSnapshot(): AudioEnvironment {
  return readAudioEnvironmentSafe();
}

/**
 * 현재 오디오 환경을 반환하는 훅. 자동 감지 결과를 그대로 노출한다.
 * 수동 토글/사용자 입력은 제공하지 않는다(감지 전용).
 */
export function useAudioEnvironment(pollIntervalMs: number = 2000): AudioEnvironment {
  const [env, setEnv] = useState<AudioEnvironment>(OPEN_EAR_ENVIRONMENT);

  useEffect(() => {
    // 초기 스냅샷.
    setEnv(readAudioEnvironmentSafe());

    // TODO(FEAT-005): 네이티브 이벤트 구독으로 교체(폴링 대신). 그때까지는
    // 안전 축소값을 주기적으로 재확인하는 폴링 스텁을 둔다.
    const timer = setInterval(() => {
      setEnv(readAudioEnvironmentSafe());
    }, pollIntervalMs);

    return () => clearInterval(timer);
  }, [pollIntervalMs]);

  return env;
}
