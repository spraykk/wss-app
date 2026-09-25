// 백그라운드 세션 파이프라인 (FEAT-004) - RN/Expo 런타임 전용
//
// RN/Expo runtime only; not executed in sandbox.
//
// 이 모듈이 FEAT-004의 핵심이다: "보행 시작 후 앱을 꺼도 계속 측정"을 이벤트 기반으로
// 구현한다. iOS 는 임의 타이머(setInterval)로 백그라운드 실행을 보장하지 않으므로,
// 신뢰할 수 있는 백그라운드 깨움은 지오펜스 region 이벤트(ENTER)와 유의미한 위치변화
// (구역 내부 정밀 위치 업데이트)에서 온다. 따라서 이 파이프라인은 절대 setInterval 을
// 쓰지 않고, FEAT-003 지오펜스 컨트롤러의 콜백(onEnterZone/onPreciseSample)에만 반응한다.
//
// 각 트리거마다:
//   1) 현재 위치를 감싸는 위험구역 계산(loadAccidentZones + findEnclosingZones)
//      -> riskIntensity(겹친 구역 severity 합), 대표 zoneId
//   2) 날씨 조회(getCachedWeather: TTL 캐시로 배터리/네트워크 절약)
//   3) 오디오 환경 읽기(FEAT-002). 딥 백그라운드에서는 stale/미지원일 수 있어 best-effort.
//   4) 순수 리듀서(reduceSession)로 세그먼트 누적 -> 지속(persist)
//   5) WSS 재계산(computeWSS) 후 고위험+휴대폰사용/임계미만이면 로컬 알림(presentHighRiskAlert)
//
// TaskManager.defineTask 는 Expo 요구상 모듈 전역 스코프에서 등록되어야 하며, 앱이
// 이 모듈을 import 하는 것(app/_layout.tsx)만으로 등록된다.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { AccidentZone } from '../types';
import { loadAccidentZones, findEnclosingZones } from '../data/accidentZones';
import { computeRiskIntensity } from '../wss/weights';
import { getCurrentTimeBand } from '../wss/context';
import { computeWSS } from '../wss/engine';
import { presentHighRiskAlert, presentCriticalScoreAlert } from '../notifications/alerts';
import { getCachedWeather } from './weatherCache';
import { reduceSession } from './sessionReducer';
import type { WalkContextSample } from './sessionReducer';
import { loadActiveSession, saveActiveSession } from './sessionStore';
import type { ActiveSession } from './sessionStore';
import { readAudioEnvironmentSnapshot } from '../sensors/useAudioEnvironment';
import { isEarEffectivelyOccluded } from '../sensors/audioState';
import { classifyMotion, createInitialMotionState } from '../sensors/motionClassifier';
import type { MotionState } from '../sensors/motionClassifier';

// 세션 파이프라인 백그라운드 태스크 이름. TaskManager.defineTask 는 모듈 로드 시 1회만
// 정의되어야 하므로 모듈 스코프 상수로 둔다. 지오펜스 태스크(GEOFENCE_TASK_NAME)와는
// 별개다: 이 태스크는 백그라운드 위치 업데이트(startLocationUpdatesAsync)를 소비한다.
export const SESSION_LOCATION_TASK_NAME = 'wss-session-location-task';

// 위경도->KMA 격자 변환은 이 앱 범위 밖이므로, 서울 관악구 기준 격자를 기본값으로 쓴다.
// (weather.ts 의 fetch 는 키가 없으면 'clear' 로 폴백하므로 기본값이어도 안전하다.)
const DEFAULT_KMA_GRID = { nx: 59, ny: 125 };

// ─────────────────────────────────────────────────────────────────────────────
// 한 개의 위치 샘플을 세션 파이프라인에 통과시키는 공용 처리기.
// 지오펜스 ENTER 콜백과 백그라운드 위치 업데이트 태스크가 공유한다(이벤트 기반).
// ─────────────────────────────────────────────────────────────────────────────
export async function processLocationSample(
  latitude: number,
  longitude: number,
  elapsedMinutes: number,
  now: Date = new Date()
): Promise<void> {
  const session = await loadActiveSession();
  // 추적 중이 아니면(사용자가 stop 했거나 미시작) 아무 것도 하지 않는다.
  if (!session.isTracking) return;

  // 1) 현재 위치를 감싸는 위험구역 -> riskIntensity + 대표 zoneId.
  const zones: AccidentZone[] = loadAccidentZones();
  const enclosing = findEnclosingZones(zones, latitude, longitude);
  const riskIntensity =
    enclosing.length > 0
      ? computeRiskIntensity(enclosing.map((z) => z.accidentCount3y))
      : 0;
  // 대표 zoneId: 가장 사고건수가 많은 구역(없으면 빈 문자열 -> 세그먼트 키 안정).
  let zoneId = '';
  let zoneName = '';
  if (enclosing.length > 0) {
    let rep = enclosing[0];
    for (const z of enclosing) if (z.accidentCount3y > rep.accidentCount3y) rep = z;
    zoneId = rep.id;
    zoneName = rep.name;
  }

  // 2) 날씨(TTL 캐시). 3) 오디오 환경(best-effort, 딥 백그라운드에서 stale 가능).
  const weather = await getCachedWeather({ nx: DEFAULT_KMA_GRID.nx, ny: DEFAULT_KMA_GRID.ny, now });
  const audioEnv = readAudioEnvironmentSnapshot();
  const isEarOccluded = isEarEffectivelyOccluded(audioEnv);
  const timeBand = getCurrentTimeBand(now);

  // 스마트폰 사용 시간은 "화면을 보며 걷는" 시간의 근사다. 정밀 스크린온 감지는
  // 커스텀 네이티브(FEAT-005)에서 배선되며, 그때까지는 경과 보행시간 전체를 사용시간의
  // best-effort 로 취급한다(활성 세션 = 사용자가 앱/화면과 상호작용 중일 가능성이 큼).
  const sample: WalkContextSample = {
    zoneId,
    riskIntensity,
    weather,
    isEarOccluded,
    smartphoneUseMinutes: elapsedMinutes,
    walkMinutes: elapsedMinutes,
    timeBand,
  };

  // 4) 순수 리듀서로 누적 -> 지속.
  const nextState = reduceSession(session, sample, { timeBand, isEarOccluded });
  const nextSession: ActiveSession = {
    segments: nextState.segments,
    currentKey: nextState.currentKey,
    startedAt: session.startedAt,
    isTracking: session.isTracking,
  };
  await saveActiveSession(nextSession);

  // 5) WSS 재계산 후 알림 조건 평가.
  const wss = computeWSS(nextSession.segments);
  if (wss.enteredHighRiskZoneWhileUsingPhone || wss.belowCriticalThreshold) {
    await presentHighRiskAlert(zoneName || '위험 구간');
  }
  // 점수 자체가 위험 구간(60점 미만)으로 떨어지면 추가 위험 알림을 보낸다.
  // 세션당 과다발송을 막기 위해 쿨다운 가드를 둔다(구역 진입 경고와 별개 채널의 문구).
  if (wss.belowCriticalThreshold && shouldSendCriticalScoreAlert(now.getTime())) {
    await presentCriticalScoreAlert();
  }
}

// 60점 미만 추가 위험 알림의 세션 내 쿨다운(밀리초). 이벤트 트리거가 잦은 구역에서
// 알림이 도배되지 않도록, 마지막 발송 이후 이 시간이 지나야 다시 보낸다.
const CRITICAL_SCORE_ALERT_COOLDOWN_MS = 5 * 60 * 1000;
let lastCriticalScoreAlertAt: number | null = null;

// 마지막 발송 이후 쿨다운이 지났으면 true 를 반환하고 발송 시각을 갱신한다.
function shouldSendCriticalScoreAlert(nowMs: number): boolean {
  if (lastCriticalScoreAlertAt !== null && nowMs - lastCriticalScoreAlertAt < CRITICAL_SCORE_ALERT_COOLDOWN_MS) {
    return false;
  }
  lastCriticalScoreAlertAt = nowMs;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 백그라운드 위치 업데이트 태스크(선택적 상향 추적용).
// 구역 진입 후 백그라운드에서도 위치 업데이트를 받아 세션을 이어가려면
// Location.startLocationUpdatesAsync(SESSION_LOCATION_TASK_NAME, ...) 로 시작한다.
// 이 태스크는 OS 가 유의미한 위치변화가 있을 때 깨워 실행한다(타이머 아님).
// 마지막 처리 시각을 프로세스 메모리에 두고, 그 사이 경과분을 elapsedMinutes 로 넘긴다.
// ─────────────────────────────────────────────────────────────────────────────
let lastProcessedAt: number | null = null;

// 차량 탑승 오인 방지: 백그라운드 위치 샘플의 속도(coords.speed)를 순수 분류기로 분류해
// 'vehicle' 로 판정되는 구간은 세션 세그먼트로 쌓지 않는다(포그라운드 detector 와 동일 로직).
// Pedometer 걸음은 백그라운드 위치 태스크에 없으므로 속도만으로 분류한다(도보 속도+고속 쿨다운).
let motionState: MotionState = createInitialMotionState();

// 위치 샘플이 차량 구간인지 판정하고, 다음 처리를 스킵해야 하면 true 를 반환한다.
// speed 가 없거나 음수(미측정)면 분류를 건너뛰고 처리를 허용한다(false).
function shouldSkipAsVehicle(sample: Location.LocationObject, nowMs: number): boolean {
  const speed = sample.coords.speed;
  if (speed === null || speed === undefined || speed < 0) return false;
  const { mode, next } = classifyMotion(motionState, { speedMps: speed, nowMs });
  motionState = next;
  return mode === 'vehicle';
}

TaskManager.defineTask(SESSION_LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  const payload = data as { locations?: Location.LocationObject[] } | undefined;
  const locations = payload?.locations ?? [];
  if (locations.length === 0) return;

  const latest = locations[locations.length - 1];
  const nowMs = latest.timestamp ?? Date.now();

  // 차량 구간이면 세그먼트를 쌓지 않고 스킵(경과분 기준점은 유지해 다음 보행 구간 왜곡 방지).
  if (shouldSkipAsVehicle(latest, nowMs)) {
    lastProcessedAt = nowMs;
    return;
  }

  const elapsedMinutes = lastProcessedAt ? Math.max(0, (nowMs - lastProcessedAt) / 60000) : 0;
  lastProcessedAt = nowMs;

  await processLocationSample(
    latest.coords.latitude,
    latest.coords.longitude,
    elapsedMinutes,
    new Date(nowMs)
  );
});

// 지오펜스 컨트롤러(FEAT-003)의 콜백에 연결하는 어댑터.
// registerNearbyGeofences(zones, center, makeGeofenceSessionCallbacks()) 형태로 넘긴다.
// onEnterZone/onPreciseSample 모두 이벤트 기반이며 setInterval 을 쓰지 않는다.
export function makeGeofenceSessionCallbacks(): {
  onEnterZone: (zone: AccidentZone, sample: Location.LocationObject) => void;
  onPreciseSample: (sample: Location.LocationObject) => void;
  onExitAllZones: () => void;
} {
  const handle = (sample: Location.LocationObject): void => {
    const nowMs = sample.timestamp ?? Date.now();
    // 차량 구간이면 세그먼트를 쌓지 않고 스킵(기준점만 갱신).
    if (shouldSkipAsVehicle(sample, nowMs)) {
      lastProcessedAt = nowMs;
      return;
    }
    const elapsedMinutes = lastProcessedAt ? Math.max(0, (nowMs - lastProcessedAt) / 60000) : 0;
    lastProcessedAt = nowMs;
    void processLocationSample(
      sample.coords.latitude,
      sample.coords.longitude,
      elapsedMinutes,
      new Date(nowMs)
    );
  };
  return {
    onEnterZone: (_zone, sample) => handle(sample),
    onPreciseSample: (sample) => handle(sample),
    onExitAllZones: () => {
      // 모든 구역 이탈 -> 다음 처리 경과분 기준점을 리셋(구역 밖은 riskIntensity 0).
      lastProcessedAt = null;
    },
  };
}

// 백그라운드 처리기 상태를 리셋한다(세션 종료 시 호출).
export function resetSessionTaskState(): void {
  lastProcessedAt = null;
  motionState = createInitialMotionState();
  lastCriticalScoreAlertAt = null;
}
