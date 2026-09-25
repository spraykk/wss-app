// 보행 세션 훅 (FEAT-004 리팩터) - 지속 세션에 대한 "얇은 포그라운드 VIEW"
//
// 이전(FEAT-001~003): 이 훅이 watchPositionAsync 구독과 세그먼트 누적(ingestSample)을
// "소유"하는 포그라운드 전용 샘플링 루프였다. 그래서 앱을 끄면 측정이 멈췄다.
//
// FEAT-004: "보행 시작 후 앱을 꺼도 계속 측정"을 위해 샘플->세그먼트->WSS->알림
// 파이프라인을 백그라운드 태스크(src/session/backgroundTask.ts)로 옮기고, 세션 상태는
// AsyncStorage(src/session/sessionStore.ts)에 지속한다. 이제 이 훅은 더 이상 샘플링
// 루프를 소유하지 않는다:
//   - start(): 위치/알림 권한 요청 + 지오펜싱 시작(FEAT-003 registerNearbyGeofences,
//     백그라운드 세션 콜백 연결) + 스토어에 세션 active 표시.
//   - 훅 본체: 지속된 세션을 주기적으로 읽어(VIEW 새로고침) live WSS 를 렌더한다.
//     이 새로고침은 UI 표시용일 뿐 측정 루프가 아니다(측정은 백그라운드 이벤트 기반).
//   - stop(): 지오펜싱 해제(stopGeofencing) + 세션 종료 확정 + history 저장(saveResult).
//   - 앱 재실행 시: 스토어의 active 세션을 복원해 진행 중 세션을 그대로 보여준다.
//
// expo-location/expo-task-manager/AsyncStorage 를 사용하므로 샌드박스에서는 실행되지
// 않는다(타입 정합만 보장). 세그먼트 누적 규칙은 순수 리듀서(reduceSession)로 검증한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import type { WalkSegment } from '../types';
import { computeWSS } from '../wss/engine';
import { loadAccidentZones } from '../data/accidentZones';
import {
  registerNearbyGeofences,
  stopGeofencing,
} from '../sensors/geofenceController';
import {
  loadActiveSession,
  saveActiveSession,
  clearActiveSession,
  emptyActiveSession,
} from '../session/sessionStore';
import type { ActiveSession } from '../session/sessionStore';
import {
  makeGeofenceSessionCallbacks,
  resetSessionTaskState,
} from '../session/backgroundTask';
import {
  requestNotificationPermission,
  presentTrackingNotification,
  dismissTrackingNotification,
} from '../notifications/alerts';
import { saveResult } from '../storage/history';

// WalkContextSample 계약은 순수 리듀서 모듈에 단일 소스로 둔다(중복 정의 제거).
export type { WalkContextSample } from '../session/sessionReducer';

// VIEW 새로고침 주기(ms). 지속된 세션을 화면에 반영하기 위한 UI 폴링일 뿐,
// 측정(샘플링) 루프가 아니다. 실제 측정은 백그라운드 지오펜스/위치 이벤트로만 일어난다.
const VIEW_REFRESH_MS = 1000;

export interface UseWalkSession {
  segments: WalkSegment[];
  isTracking: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function useWalkSession(): UseWalkSession {
  const [session, setSession] = useState<ActiveSession>(emptyActiveSession());
  const isMountedRef = useRef(true);

  // 지속된 세션을 읽어 상태에 반영(VIEW 새로고침). 측정과 무관한 읽기 전용.
  const refresh = useCallback(async (): Promise<void> => {
    const loaded = await loadActiveSession();
    if (isMountedRef.current) setSession(loaded);
  }, []);

  // 마운트 시(=앱 재실행 포함) active 세션을 복원한다. 진행 중 세션이면 "측정 중"
  // 지속 알림을 다시 띄우고(고정 식별자라 중복 무해), 세션이 없으면 남아 있을 수 있는
  // 알림을 정리한다. 알림은 UI 표시용이라 실패해도 세션 복원을 깨지 않는다.
  const restore = useCallback(async (): Promise<void> => {
    const loaded = await loadActiveSession();
    if (isMountedRef.current) setSession(loaded);
    if (loaded.isTracking) {
      await presentTrackingNotification().catch(() => {});
    } else {
      await dismissTrackingNotification().catch(() => {});
    }
  }, []);

  // 마운트 시 active 세션을 복원하고, 이후에는 주기적으로 VIEW 만 갱신한다.
  useEffect(() => {
    isMountedRef.current = true;
    void restore();
    const timer = setInterval(() => {
      void refresh();
    }, VIEW_REFRESH_MS);
    return () => {
      isMountedRef.current = false;
      clearInterval(timer);
    };
  }, [refresh, restore]);

  const start = useCallback(async (): Promise<void> => {
    // 권한: 백그라운드 측정을 위해 위치(가능하면 Always) + 알림 권한을 요청한다.
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return;
    // 백그라운드 위치는 있으면 좋지만 없어도 포그라운드/지오펜스로 동작하도록 best-effort.
    try {
      await Location.requestBackgroundPermissionsAsync();
    } catch {
      // 미지원/거부 -> 무시(지오펜스는 포그라운드 권한만으로도 부분 동작).
    }
    await requestNotificationPermission();

    // 세션 상태를 active 로 표시하고 지속(재실행 복원의 기준점).
    const startedSession: ActiveSession = {
      ...emptyActiveSession(),
      startedAt: Date.now(),
      isTracking: true,
    };
    resetSessionTaskState();
    await saveActiveSession(startedSession);
    if (isMountedRef.current) setSession(startedSession);

    // 앱을 닫아도 상단에 "측정 중" 지속 알림이 유지되도록 표시한다.
    // 알림 표시 실패가 세션 시작을 깨지 않도록 삼킨다.
    void presentTrackingNotification().catch(() => {});

    // 현재 위치 기준 근접 위험구역에 지오펜스를 등록하고, 백그라운드 세션 콜백을 연결한다.
    // 콜백/지오펜스는 이벤트 기반(region ENTER / 정밀 위치)이며 타이머를 쓰지 않는다.
    try {
      const here = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const zones = loadAccidentZones();
      await registerNearbyGeofences(
        zones,
        { latitude: here.coords.latitude, longitude: here.coords.longitude },
        makeGeofenceSessionCallbacks()
      );
    } catch {
      // 위치 취득/지오펜스 등록 실패 -> 세션은 active 로 유지(다음 위치에서 재시도 가능).
    }
  }, []);

  const stop = useCallback(async (): Promise<void> => {
    // 지오펜스/정밀 추적 해제.
    await stopGeofencing();
    resetSessionTaskState();

    // "측정 중" 지속 알림을 제거한다(실패해도 종료 흐름을 막지 않는다).
    void dismissTrackingNotification().catch(() => {});

    // 최종 세션을 읽어 WSS 결과를 history 에 저장.
    const finalSession = await loadActiveSession();
    if (finalSession.segments.length > 0) {
      const result = computeWSS(finalSession.segments);
      await saveResult(result);
    }

    // 진행 중 세션 파기.
    await clearActiveSession();
    const cleared = emptyActiveSession();
    if (isMountedRef.current) setSession(cleared);
  }, []);

  return {
    segments: session.segments,
    isTracking: session.isTracking,
    start,
    stop,
  };
}
