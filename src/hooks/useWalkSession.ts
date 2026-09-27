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
import type { WalkSegment, WSSResult } from '../types';
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
  startPostureSensors,
  stopPostureSensors,
  startSessionLocationUpdates,
  stopSessionLocationUpdates,
} from '../session/backgroundTask';
// FEAT-003: 세션 간 인앱 상호작용 증거가 새지 않도록 start()/stop() 에서 초기화한다.
import { resetInteractions } from '../session/interactionTracker';
import {
  requestNotificationPermission,
  presentTrackingNotification,
  dismissTrackingNotification,
} from '../notifications/alerts';
import { saveResult } from '../storage/history';
import { getOrCreateDeviceId } from '../storage/deviceId';
import { getAgeBand } from '../storage/ageBand';
import { uploadScore } from '../data/supabase';

// 로컬 날짜를 yyyy-mm-dd 로 만든다(시각/타임존은 서버에 보내지 않는다).
function toDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// WalkContextSample 계약은 순수 리듀서 모듈에 단일 소스로 둔다(중복 정의 제거).
export type { WalkContextSample } from '../session/sessionReducer';

// VIEW 새로고침 주기(ms). 지속된 세션을 화면에 반영하기 위한 UI 폴링일 뿐,
// 측정(샘플링) 루프가 아니다. 실제 측정은 백그라운드 지오펜스/위치 이벤트로만 일어난다.
const VIEW_REFRESH_MS = 1000;

export interface UseWalkSession {
  segments: WalkSegment[];
  isTracking: boolean;
  start: () => Promise<void>;
  // stop 은 방금 종료한 보행의 최종 결과(WSSResult)를 반환한다. 세그먼트가 0이면
  // 저장/표시할 결과가 없으므로 null 을 반환한다. 홈 화면이 이 값으로 '이번 보행의
  // 점수는 X점입니다'를 안내한다(진행 중 실시간 점수 미표시).
  stop: () => Promise<WSSResult | null>;
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
    resetInteractions();
    // FEAT-003: 세션 동안 자세(pitch) 센서를 구독해 "보행 중 화면 보기" 사용을 감지한다.
    // UIBackgroundModes:location 로 프로세스가 살아있는 동안 읽힌다(iOS 백그라운드 연속성은
    // 보장 불가 - backgroundTask.startPostureSensors 주석 참고). 실패해도 세션 시작을 깨지 않는다.
    startPostureSensors();
    // 핵심 결함 수정: 세션 동안 "연속 백그라운드 위치 업데이트"를 실제로 시작해 프로세스를
    // 살려둔다. 그래야 위험구역 밖에서 폰을 보며 걸을 때도 iOS 가 프로세스를 재우지 않아
    // 자이로 리스너가 계속 콜백을 받고 자세 평가·감점이 세션 내내 지속된다(지오펜스만 있으면
    // 위험구역 안에서만 위치 이벤트가 와 자이로가 멈출 수 있었다). Always 권한이 없으면
    // 포그라운드 한정으로 동작한다. 실패해도 세션 시작을 깨지 않도록 best-effort(내부 try/catch).
    await startSessionLocationUpdates();
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

  const stop = useCallback(async (): Promise<WSSResult | null> => {
    // 지오펜스/정밀 추적 해제.
    await stopGeofencing();
    // 핵심 결함 수정: 세션 동안 켜둔 연속 위치 업데이트를 반드시 중지한다(배터리/프라이버시).
    // 실행 중일 때만 중지하며 실패는 조용히 삼켜 종료 흐름을 깨지 않는다(내부 try/catch).
    await stopSessionLocationUpdates();
    // FEAT-003: 자세 센서 구독 해제(세션 종료). resetSessionTaskState 는 지속 상태를 리셋한다.
    stopPostureSensors();
    resetSessionTaskState();
    resetInteractions();

    // "측정 중" 지속 알림을 제거한다(실패해도 종료 흐름을 막지 않는다).
    void dismissTrackingNotification().catch(() => {});

    // 최종 세션을 읽어 WSS 결과를 history 에 저장(로컬 저장은 항상 우선이므로 await).
    // FEAT-002: 방금 종료한 보행 결과를 호출부(홈)로 반환하기 위해 바깥 변수에 담는다.
    // 세그먼트가 0이면 결과가 없으므로 null 을 유지한다.
    let finishedResult: WSSResult | null = null;
    const finalSession = await loadActiveSession();
    if (finalSession.segments.length > 0) {
      const computed = computeWSS(finalSession.segments);
      // 보행이 끝난 로컬 날짜를 결과에 도장 찍는다(업로드 date_iso 와 동일 값).
      // 주간 일별 막대그래프가 이 날짜로 하루별 대표 점수를 집계한다.
      const dateISO = toDateISO(new Date());
      // computed 스프레드가 computeWSS(FEAT-002)의 totalWalkMinutes(확정 보행 시간 합)까지
      // 그대로 result 에 실어 saveResult 로 history 에 저장한다. 이 값이 (1) 주간 일별 대표
      // 점수의 보행 시간 가중평균(weekly.ts) 가중치와 (2) 리포트 이력의 총 보행 시간 표기에
      // 쓰인다. 별도 대입이 필요 없으며(스프레드로 충분), 업로드 payload 에는 추가하지 않는다.
      const result = { ...computed, dateISO };
      finishedResult = result;
      await saveResult(result);

      // 익명 통계 서버로 최소 데이터만 업로드한다: displayScore(0~100), 날짜, 익명 deviceId.
      // 위치·경로·rawScore 등은 전송하지 않는다.
      //
      // 중요(렉 방지): 업로드는 부가기능이므로 종료 흐름에서 "기다리지 않는다"(fire-and-forget).
      // 예전엔 여기서 `await uploadScore(...)` 로 네트워크 왕복을 동기 대기했는데, Supabase
      // 업로드가 느리거나 실패하면 그 시간만큼 stop 핸들러 → UI 가 멈췄다("보행 종료" 렉).
      // 이제 deviceId 취득 + 업로드를 백그라운드로 던지고(void) stop 은 이를 기다리지 않는다.
      // 실패/타임아웃은 조용히 무시한다(로컬 저장이 항상 우선, 종료를 절대 깨지 않는다).
      const displayScore = result.displayScore;
      void (async () => {
        try {
          const deviceId = await getOrCreateDeviceId();
          // 온보딩에서 1회 선택한 연령대 밴드를 함께 보낸다(미선택이면 null).
          // 그룹 비교 통계 용도이며, 위치·경로 등은 여전히 전송하지 않는다.
          const ageBand = await getAgeBand();
          await uploadScore({ deviceId, displayScore, dateISO, ageBand });
        } catch {
          // 업로드 실패는 조용히 무시한다(부가기능).
        }
      })();
    }

    // 진행 중 세션 파기.
    await clearActiveSession();
    const cleared = emptyActiveSession();
    if (isMountedRef.current) setSession(cleared);

    // 방금 종료한 보행 결과를 반환한다(세그먼트 0이면 null). 홈이 이 값으로 점수를 안내한다.
    return finishedResult;
  }, []);

  return {
    segments: session.segments,
    isTracking: session.isTracking,
    start,
    stop,
  };
}
