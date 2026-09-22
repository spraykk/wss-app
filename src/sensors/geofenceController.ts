// 지오펜스 컨트롤러 (FEAT-003) - RN/Expo 런타임 전용
//
// RN/Expo runtime only; not executed in sandbox.
//
// 배경/설계 근거: .agents/tasks/task-bg-audio-wss/GEOFENCE_DESIGN.md
//
// 저전력 전략: 상시 고정밀 GPS 대신 expo-location 의 지오펜스(region-monitoring)에
// 근접 위험구역 N개(+boundary 1개)만 등록한다. OS 의 지오펜스/유의미 위치변화
// 서브시스템은 저전력이다. 구역 진입(ENTER) 시에만 watchPositionAsync(BestForNavigation)
// 로 정밀 추적을 상향(escalate)하고, 이탈(EXIT)/활성 구역 없음이면 정밀 추적을 중지
// (de-escalate)해 배터리를 아낀다.
//
// 실제 네이티브 지오펜싱/백그라운드 태스크는 EAS dev build 에서만 동작한다(Expo Go 불가).
// 여기서는 인터페이스/골격 + 안전한 no-op 폴백만 제공한다. 백그라운드 태스크와의
// 통합(세션 파이프라인)은 FEAT-004, dev build 실기기 검증은 FEAT-005 에서 다룬다.

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { AccidentZone } from '../types';
import type { BoundaryRegion } from './geofenceSelection';
import {
  selectNearestZones,
  shouldReRegister,
  makeBoundaryRegion,
} from './geofenceSelection';

// 지오펜스/백그라운드 태스크 식별자. TaskManager.defineTask 는 모듈 로드 시점에
// 한 번만 정의되어야 하므로 모듈 스코프 상수로 둔다.
export const GEOFENCE_TASK_NAME = 'wss-geofence-task';

// 근접 구역 재선택 트리거용 boundary region 반경(m). 재등록 hysteresis 와 매칭한다.
export const BOUNDARY_RADIUS_METERS = 1500;
// 재등록을 트리거하는 사용자 이동 거리(m). boundary 반경보다 작게 잡아 이탈 전에 갱신.
export const RE_REGISTER_HYSTERESIS_METERS = 1000;

// 정밀 추적 상향/하향을 앱 상단(FEAT-004 백그라운드 태스크/세션)이 구독할 수 있도록
// 콜백을 주입받는다. 컨트롤러 자체는 위치 샘플을 소비하지 않고 이벤트만 브로커링한다.
export type GeofenceCallbacks = {
  /** 위험구역 진입: 정밀 추적 상향 후 위치 샘플을 흘려보낸다. */
  onEnterZone?: (zone: AccidentZone, sample: Location.LocationObject) => void;
  /** 정밀 추적 중 위치 샘플(구역 안에서만 발생). */
  onPreciseSample?: (sample: Location.LocationObject) => void;
  /** 모든 활성 구역에서 이탈: 정밀 추적 하향. */
  onExitAllZones?: () => void;
};

// 현재 등록 상태(모듈 스코프). 재등록 판정과 정밀 추적 중복 시작 방지에 쓴다.
let registeredZones: AccidentZone[] = [];
let lastCenter: { latitude: number; longitude: number } | null = null;
let boundary: BoundaryRegion | null = null;
let preciseSub: Location.LocationSubscription | null = null;
let callbacks: GeofenceCallbacks = {};

// ─────────────────────────────────────────────────────────────────────────────
// 정밀 추적 상향/하향 (구역 안에서만 BestForNavigation)
// ─────────────────────────────────────────────────────────────────────────────

// 위험구역 진입 시 정밀 추적을 상향한다. 이미 상향되어 있으면 중복 시작하지 않는다.
async function escalatePreciseTracking(): Promise<void> {
  if (preciseSub) return; // 이미 정밀 추적 중
  try {
    preciseSub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 5,
        timeInterval: 2000,
      },
      (sample) => {
        callbacks.onPreciseSample?.(sample);
      }
    );
  } catch {
    // 미지원/권한 없음 -> 안전 no-op. 지오펜스만으로 동작.
    preciseSub = null;
  }
}

// 활성 구역이 없을 때 정밀 추적을 하향(중지)해 배터리를 아낀다.
function deEscalatePreciseTracking(): void {
  if (preciseSub) {
    preciseSub.remove();
    preciseSub = null;
  }
  callbacks.onExitAllZones?.();
}

// ─────────────────────────────────────────────────────────────────────────────
// 백그라운드 지오펜스 태스크 (ENTER/EXIT 이벤트 수신)
//
// TaskManager.defineTask 는 모듈 로드 시 정의된다. Expo Go/미지원 환경에서는
// startGeofencingAsync 가 실패하며, 이 경우 컨트롤러는 안전하게 no-op 로 남는다.
// ─────────────────────────────────────────────────────────────────────────────

TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  const payload = data as
    | { eventType: Location.GeofencingEventType; region: Location.LocationRegion }
    | undefined;
  if (!payload) return;

  const { eventType, region } = payload;

  if (eventType === Location.GeofencingEventType.Enter) {
    // boundary region 이탈은 여기서 ENTER 로 잡히지 않는다(EXIT 로 처리).
    const zone = registeredZones.find((z) => z.id === region.identifier);
    if (!zone) return;
    await escalatePreciseTracking();
    try {
      const sample = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      callbacks.onEnterZone?.(zone, sample);
    } catch {
      // 샘플 취득 실패는 무시(다음 watchPosition 콜백에서 이어짐).
    }
    return;
  }

  if (eventType === Location.GeofencingEventType.Exit) {
    if (boundary && region.identifier === boundary.identifier) {
      // boundary 이탈 -> 근접 구역 재선택은 상위 폴링(maybeReRegister)이 담당.
      // TODO(FEAT-004): 백그라운드 태스크에서 현재 위치로 즉시 재등록을 트리거한다.
      return;
    }
    // 개별 위험구역 이탈 -> 다른 활성 구역이 남아있지 않으면 정밀 추적 하향.
    // (OS 가 구역별 상태를 유지하지 않으므로, 보수적으로 현재 위치 기준 재평가한다.)
    // TODO(FEAT-004): 활성 구역 집합을 세션 상태로 추적해 정확히 판정한다.
    deEscalatePreciseTracking();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 등록/재등록 (근접 N개 + boundary 1개)
// ─────────────────────────────────────────────────────────────────────────────

// expo-location 지오펜스에 넘길 region 목록을 만든다(근접 구역 + boundary).
function buildRegions(
  zones: AccidentZone[],
  boundaryRegion: BoundaryRegion
): Location.LocationRegion[] {
  const zoneRegions: Location.LocationRegion[] = zones.map((zone) => ({
    identifier: zone.id,
    latitude: zone.latitude,
    longitude: zone.longitude,
    radius: zone.radiusMeters,
    notifyOnEnter: true,
    notifyOnExit: true,
  }));
  zoneRegions.push({
    identifier: boundaryRegion.identifier,
    latitude: boundaryRegion.latitude,
    longitude: boundaryRegion.longitude,
    radius: boundaryRegion.radiusMeters,
    notifyOnEnter: false,
    notifyOnExit: true,
  });
  return zoneRegions;
}

// 현재 위치 기준 근접 구역 + boundary 를 등록한다(기존 등록은 교체).
export async function registerNearbyGeofences(
  allZones: AccidentZone[],
  center: { latitude: number; longitude: number },
  cb: GeofenceCallbacks = {},
  maxRegions: number = 18
): Promise<void> {
  callbacks = cb;
  const nearest = selectNearestZones(allZones, center.latitude, center.longitude, maxRegions);
  const boundaryRegion = makeBoundaryRegion(
    center.latitude,
    center.longitude,
    BOUNDARY_RADIUS_METERS
  );

  try {
    // 이미 실행 중이면 교체를 위해 먼저 중지한다.
    const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME);
    if (running) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
    }
    await Location.startGeofencingAsync(
      GEOFENCE_TASK_NAME,
      buildRegions(nearest, boundaryRegion)
    );
    registeredZones = nearest;
    boundary = boundaryRegion;
    lastCenter = { ...center };
  } catch {
    // Expo Go/미지원/권한 없음 -> 안전 no-op. 지오펜스 없이 포그라운드만 동작.
    registeredZones = [];
    boundary = null;
    lastCenter = null;
  }
}

// 사용자가 hysteresis 이상 이동했으면 근접 구역을 재선택/재등록한다(churn 방지).
export async function maybeReRegister(
  allZones: AccidentZone[],
  current: { latitude: number; longitude: number },
  cb: GeofenceCallbacks = callbacks,
  maxRegions: number = 18
): Promise<boolean> {
  if (
    lastCenter &&
    !shouldReRegister(
      lastCenter.latitude,
      lastCenter.longitude,
      current.latitude,
      current.longitude,
      RE_REGISTER_HYSTERESIS_METERS
    )
  ) {
    return false;
  }
  await registerNearbyGeofences(allZones, current, cb, maxRegions);
  return true;
}

// 지오펜스+정밀 추적을 모두 중지한다(세션 종료 시).
export async function stopGeofencing(): Promise<void> {
  deEscalatePreciseTracking();
  try {
    const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME);
    if (running) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
    }
  } catch {
    // 미지원/미실행 -> 무시.
  }
  registeredZones = [];
  boundary = null;
  lastCenter = null;
}
