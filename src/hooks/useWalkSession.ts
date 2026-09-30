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
import { hasWalked } from '../wss/walkGate';
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
import { computeTodayScore } from '../wss/weekly';
import { getOrCreateDeviceId } from '../storage/deviceId';
import { getAgeBand } from '../storage/ageBand';
import { uploadScoreDetailed } from '../data/supabase';

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
  // stop 은 방금 종료한 보행의 최종 결과(WSSResult)를 반환한다. "실제로 걸은 시간
  // (확정 보행 시간 합)"이 0이면 저장/표시할 결과가 없으므로 null 을 반환한다(세그먼트가
  // 있든 없든 동일). 홈 화면이 이 값으로 '이번 보행의 점수는 X점입니다'를 안내한다
  // (진행 중 실시간 점수 미표시). null 이면 홈은 '측정된 보행이 없어요'를 표시한다.
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
    //
    // 판정 기준(플랫폼 일관성 수정): 예전에는 "세그먼트 유무(segments.length>0)"로
    // 저장/표시를 게이팅했다. 그러나 iOS 는 세션 시작 시 현재 위치를 한 번 잡아
    // (걷지 않아도) 세그먼트가 1개 생겨 computeWSS 가 감점 0 => displayScore 100 을
    // 돌려줬고, 결국 "안 걷고 100점"이 떴다. 안드로이드는 그 시작 위치 샘플이 없어
    // 세그먼트 0 => null => "측정된 보행이 없어요"가 떠 플랫폼 간 불일치가 생겼다.
    // 이제 "실제로 걸은 시간(확정 보행 시간 합, computeWSS 의 totalWalkMinutes)"이
    // 0보다 클 때만 결과로 인정한다. 확정 보행 시간은 정지/차량/센서공백을 이미 0으로
    // 처리한 값이라, 0초 보행(시작→즉시 종료)은 세그먼트가 있어도 걸은 시간 0 => null
    // 로 통일된다(양 플랫폼 동일하게 "측정된 보행이 없어요"). computeWSS 자체는 불변이며
    // "저장/표시 여부"만 이 게이팅으로 결정한다. 0초 보행은 history/서버에 남기지 않아
    // 이력/주간그래프/서버통계가 오염되지 않는다.
    let finishedResult: WSSResult | null = null;
    const finalSession = await loadActiveSession();
    const computed = computeWSS(finalSession.segments);
    if (hasWalked(computed)) {
      // (computed 는 위에서 이미 계산해 두었다.)
      // 보행이 끝난 로컬 날짜를 결과에 도장 찍는다(업로드 date_iso 와 동일 값).
      // 주간 일별 막대그래프가 이 날짜로 하루별 대표 점수를 집계한다.
      // 같은 Date 인스턴스로 dateISO 와 recordedAt 을 함께 뽑아 둘이 일관되게 한다.
      const now = new Date();
      const dateISO = toDateISO(now);
      // FEAT-003: 리포트 이력의 상대 시간 표기('N분 전' 등) 전용 로컬 기록 시각(ms epoch).
      // 로컬 표시용일 뿐이며 아래 uploadScore payload 에는 의도적으로 포함하지 않는다.
      const recordedAt = now.getTime();
      // computed 스프레드가 computeWSS(FEAT-002)의 totalWalkMinutes(확정 보행 시간 합)까지
      // 그대로 result 에 실어 saveResult 로 history 에 저장한다. 이 값이 (1) 주간 일별 대표
      // 점수의 보행 시간 가중평균(weekly.ts) 가중치와 (2) 리포트 이력의 총 보행 시간 표기에
      // 쓰인다. 별도 대입이 필요 없으며(스프레드로 충분), 업로드 payload 에는 추가하지 않는다.
      const result = { ...computed, dateISO, recordedAt };
      finishedResult = result;
      // saveResult 는 이 보행을 이력 맨 앞에 추가해 저장하고, 갱신된 전체 이력을 반환한다.
      // 이 전체 이력으로 "오늘의 대표 점수(보행 시간 가중평균)"를 계산해 서버에 올린다.
      const updatedHistory = await saveResult(result);

      // 익명 통계 서버로 최소 데이터만 업로드한다: displayScore(0~100), 날짜, 익명 deviceId.
      // 위치·경로·rawScore 등은 전송하지 않는다.
      //
      // [하루 대표 = 보행 시간 가중평균] 예전엔 "방금 끝난 그 한 번의 보행 점수"를 그대로
      // 올렸다. wss_scores 는 (device_id, date_iso) 로 upsert(덮어쓰기)하므로, 하루에 여러 번
      // 걸으면 마지막 보행 점수만 서버에 남아 그날을 대표하지 못했다(예: 아침 90점·저녁 40점이면
      // 40점만 남음). 앱의 리포트는 이미 하루 대표를 "보행 시간 가중평균"으로 보여주는데
      // (weekly.ts/computeTodayScore) 서버 업로드만 그 설계와 어긋나 있었다. 이제 방금 보행을
      // 이력에 저장한 뒤, computeTodayScore(전체 이력, 오늘)로 오늘의 가중평균을 계산해 그 값을
      // 올린다. 그러면 서버의 하루 값이 로컬 리포트의 '오늘의 총점'과 정확히 일치한다.
      //   - 하루 1회만 걸으면 가중평균 = 그 보행 점수라 값이 같다(정상).
      //   - 계산이 어떤 이유로 null 이면(이론상 없음) 이번 보행 점수로 안전 폴백한다.
      // upsert 덮어쓰기는 그대로 유지한다(덮어쓰는 값이 이제 '그날 가중평균'이라 올바르다).
      //
      // 중요(렉 방지): 업로드는 부가기능이므로 종료 흐름에서 "기다리지 않는다"(fire-and-forget).
      // 예전엔 여기서 `await uploadScore(...)` 로 네트워크 왕복을 동기 대기했는데, Supabase
      // 업로드가 느리거나 실패하면 그 시간만큼 stop 핸들러 → UI 가 멈췄다("보행 종료" 렉).
      // 이제 deviceId 취득 + 업로드를 백그라운드로 던지고(void) stop 은 이를 기다리지 않는다.
      // 실패/타임아웃은 조용히 무시한다(로컬 저장이 항상 우선, 종료를 절대 깨지 않는다).
      const todayWeighted = computeTodayScore(updatedHistory, dateISO);
      const displayScore =
        todayWeighted !== null && Number.isFinite(todayWeighted)
          ? todayWeighted
          : result.displayScore;
      void (async () => {
        try {
          const deviceId = await getOrCreateDeviceId();
          // 온보딩에서 1회 선택한 연령대 밴드를 함께 보낸다(미선택이면 null).
          // 그룹 비교 통계 용도이며, 위치·경로 등은 여전히 전송하지 않는다.
          const ageBand = await getAgeBand();
          // 구조화된 결과를 받아 실패 사유를 관찰 가능하게 한다. 프로덕션은 여전히 조용한
          // fire-and-forget 이지만, 개발 중(__DEV__)에는 사유/진단을 콘솔로 드러내
          // "wss_scores count 0" 같은 무증상 실패의 원인을 바로 알 수 있게 한다.
          const uploadResult = await uploadScoreDetailed({ deviceId, displayScore, dateISO, ageBand });
          if (!uploadResult.ok && __DEV__) {
            console.warn('[wss] score upload failed', uploadResult.reason, uploadResult.detail ?? '');
          }
        } catch (e) {
          // 업로드 실패는 조용히 무시한다(부가기능). 개발 중에만 사유를 드러낸다.
          if (__DEV__) {
            console.warn('[wss] score upload threw', String(e));
          }
        }
      })();
    }

    // 진행 중 세션 파기.
    await clearActiveSession();
    const cleared = emptyActiveSession();
    if (isMountedRef.current) setSession(cleared);

    // 방금 종료한 보행 결과를 반환한다(실제 걸은 시간 0이면 null). 홈이 이 값으로 점수를 안내한다.
    return finishedResult;
  }, []);

  return {
    segments: session.segments,
    isTracking: session.isTracking,
    start,
    stop,
  };
}
