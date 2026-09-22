// 단계적 위치/알림 권한 요청 헬퍼 (FEAT-006 온보딩)
//
// Apple 가이드(Human Interface Guidelines / App Review)에 따라 권한은 "맥락에서 단계적으로"
// 요청한다: 먼저 When-In-Use(사용 중 위치)만 요청해 안전 가치를 이해시킨 뒤, 실제로
// 백그라운드 경고가 필요한 맥락에서 Always(항상 위치)와 알림 권한으로 상향 요청한다.
// 앱 최초 실행에서 모든 권한을 한 번에 요청하지 않는다.
//
// RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다(타입 정합만 보장).
// requestNotificationPermission 은 알림 래퍼(src/notifications/alerts.ts)를 재사용한다.
import * as Location from 'expo-location';
import { requestNotificationPermission } from '../notifications/alerts';

/** 1단계: When-In-Use(사용 중) 위치 권한만 요청한다. 승인 여부를 반환. */
export async function requestWhenInUseLocation(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  return fg.status === 'granted';
}

/**
 * 2단계: Always(항상) 위치 권한을 맥락에서 상향 요청한다.
 * When-In-Use 가 먼저 승인되어 있어야 iOS 가 Always 승격 프롬프트를 노출한다.
 * 미지원/거부 시에도 앱은 포그라운드/지오펜스로 부분 동작하므로 예외를 삼켜 best-effort 로 둔다.
 */
export async function requestAlwaysLocation(): Promise<boolean> {
  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    return bg.status === 'granted';
  } catch {
    return false;
  }
}

/** 3단계: 알림 권한을 요청한다(고위험 구역 진입 경고 표시용). */
export async function requestAlerts(): Promise<boolean> {
  return requestNotificationPermission();
}
