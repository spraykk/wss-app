// 오디오 환경 구독 훅 (FEAT-002) - RN/Expo 런타임 전용
//
// RN/Expo runtime only; not executed in sandbox.
//
// FEAT-001의 신호 소스(iOS: AVAudioSession.isOtherAudioPlaying 및
// currentRoute.outputs[].portType == .bluetoothA2DP/.bluetoothHFP)를 읽는 커스텀
// 네이티브 모듈을 구독/폴링해 현재 AudioEnvironment 를 반환한다.
//
// 현재 상태: FEAT-005에서 로컬 Expo 네이티브 모듈(modules/audio-environment)을 배선했다.
// 네이티브가 있으면(EAS dev build) 실제 값을 읽고, 없으면(Expo Go/미지원 플랫폼/미빌드)
// { false, false }(open ear)로 안전 축소해 허위 감점(오탐)을 방지한다.
import { useEffect, useState } from 'react';
import type { AudioEnvironment } from './audioState';
import { OPEN_EAR_ENVIRONMENT } from './audioState';
import {
  getAudioEnvironment,
  addAudioEnvironmentListener,
  isAudioEnvironmentNativeAvailable,
} from '../../modules/audio-environment';

// FEAT-005: EAS dev build 에서 커스텀 로컬 Expo 모듈("AudioEnvironment")을 배선한다.
//   - getAudioEnvironment(): { bluetoothAudioRouteConnected, otherAudioPlaying } 스냅샷
//   - addAudioEnvironmentListener(): onAudioEnvironmentChange(routeChangeNotification) 구독
//   네이티브 모듈이 없거나(Expo Go/Android/미빌드) 로드 실패 시 OPEN_EAR_ENVIRONMENT 로
//   안전 축소한다(허위 감점/오탐 없음). 인터페이스는 audioState.AudioEnvironment 와 매칭.
function readAudioEnvironmentSafe(): AudioEnvironment {
  const native = getAudioEnvironment();
  if (native == null) {
    // 네이티브 모듈 미탑재(Expo Go 포함) 또는 스냅샷 불가 -> open ear 로 안전 축소.
    return OPEN_EAR_ENVIRONMENT;
  }
  return {
    bluetoothAudioRouteConnected: native.bluetoothAudioRouteConnected,
    otherAudioPlaying: native.otherAudioPlaying,
  };
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

    // 네이티브 모듈이 있으면 route 변경 이벤트 구독(폴링 불필요, 배터리 절약).
    if (isAudioEnvironmentNativeAvailable()) {
      const unsubscribe = addAudioEnvironmentListener((native) => {
        setEnv({
          bluetoothAudioRouteConnected: native.bluetoothAudioRouteConnected,
          otherAudioPlaying: native.otherAudioPlaying,
        });
      });
      return unsubscribe;
    }

    // 네이티브 미탑재(Expo Go 등): 안전 축소값을 주기적으로 재확인하는 폴링 폴백.
    const timer = setInterval(() => {
      setEnv(readAudioEnvironmentSafe());
    }, pollIntervalMs);

    return () => clearInterval(timer);
  }, [pollIntervalMs]);

  return env;
}
