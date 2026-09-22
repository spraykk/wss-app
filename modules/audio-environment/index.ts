// AudioEnvironment 로컬 Expo 모듈 - JS 브리지 (FEAT-005) - RN/Expo 런타임 전용
//
// RN/Expo runtime only; not executed in sandbox.
//
// iOS 네이티브(AudioEnvironmentModule.swift)를 requireOptionalNativeModule 로 안전하게
// 로드한다. 네이티브가 없는 환경(Expo Go, Android, 미빌드)에서는 module 이 null 이 되며,
// 소비자(src/sensors/useAudioEnvironment.ts)가 open-ear 로 안전 축소한다.
//
// 반환 payload 는 src/sensors/audioState.ts 의 AudioEnvironment 와 정확히 매칭된다:
//   { bluetoothAudioRouteConnected: boolean, otherAudioPlaying: boolean }
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

export type NativeAudioEnvironment = {
  bluetoothAudioRouteConnected: boolean;
  otherAudioPlaying: boolean;
};

type AudioEnvironmentNativeModule = {
  getEnvironment(): NativeAudioEnvironment;
  addListener(
    eventName: 'onAudioEnvironmentChange',
    listener: (env: NativeAudioEnvironment) => void
  ): EventSubscription;
};

// 네이티브 모듈이 없으면 null. dev build 전(Expo Go)/Android 에서는 항상 null 이다.
const nativeModule = requireOptionalNativeModule<AudioEnvironmentNativeModule>('AudioEnvironment');

/** 네이티브 모듈이 로드되어 실제 감지가 가능한 환경인지. */
export function isAudioEnvironmentNativeAvailable(): boolean {
  return nativeModule != null;
}

/**
 * 현재 오디오 환경 스냅샷. 네이티브 미탑재 시 null 을 반환하며, 소비자가 open-ear 로
 * 안전 축소한다(오탐 없음).
 */
export function getAudioEnvironment(): NativeAudioEnvironment | null {
  if (nativeModule == null) return null;
  return nativeModule.getEnvironment();
}

/**
 * route 변경 이벤트 구독. 네이티브 미탑재 시 no-op 해제 함수를 반환한다.
 */
export function addAudioEnvironmentListener(
  listener: (env: NativeAudioEnvironment) => void
): () => void {
  if (nativeModule == null) return () => {};
  const subscription = nativeModule.addListener('onAudioEnvironmentChange', listener);
  return () => subscription.remove();
}
