// 지오펜스 저전력 계층 - 근접 구역 선택/재등록 정책 (FEAT-003, 순수 모듈)
//
// 배경/설계 근거: .agents/tasks/task-bg-audio-wss/GEOFENCE_DESIGN.md
//
// 목표: 상시 고정밀 GPS(BestForNavigation) 대신 OS 의 지오펜스(region-monitoring)
// 서브시스템에 위험구역을 등록해, "구역 진입(ENTER) 이벤트"에만 반응하도록 한다.
// 이렇게 하면 구역 밖에서는 배터리 소모가 매우 낮고, 구역 안에서만 정밀 추적으로
// 상향(escalate)한다.
//
// iOS 제약: iOS 는 한 앱당 동시 모니터링 가능한 region 을 20개로 하드캡한다.
// (초과분은 조용히 무시됨.) 실제 위험구역은 100+개이므로, 사용자 현재 위치에서
// 가장 가까운 N개(maxRegions<20)만 동적으로 등록하고, 사용자가 충분히 이동하면
// 근접 구역을 재선택/재등록한다. maxRegions 는 재중심(re-centering)용 'boundary'
// region 한 칸의 여유를 남기기 위해 20 하드캡보다 낮게(기본 18) 잡는다.
//
// 이 모듈은 haversineMeters 를 src/data/accidentZones.ts 에서 재사용하며 node:* 을
// 쓰지 않는다. 따라서 `node --experimental-strip-types` 로 검증 가능하다(erasable-only TS).

import type { AccidentZone } from '../types';
import { haversineMeters } from '../data/accidentZones';

/** iOS 가 한 앱에 허용하는 동시 모니터링 region 의 하드캡. 초과분은 조용히 무시된다. */
export const IOS_REGION_HARD_CAP = 20;

/**
 * 사용자 현재 위치에서 가장 가까운 maxRegions 개의 구역을 거리 오름차순으로 반환한다.
 * - iOS 20 region 하드캡을 넘지 않도록 클라이언트에서 강제로 상한을 둔다.
 * - maxRegions 기본값 18: 재중심용 boundary region 한 칸 + 여유를 남긴다.
 * - 입력 zones 배열은 변형하지 않는다(순수 함수).
 *
 * @param zones      전체 위험구역 목록(100+개일 수 있음)
 * @param userLat    사용자 현재 위도
 * @param userLon    사용자 현재 경도
 * @param maxRegions 등록할 최대 구역 수(하드캡 20 미만이어야 함, 기본 18)
 */
export function selectNearestZones(
  zones: AccidentZone[],
  userLat: number,
  userLon: number,
  maxRegions: number = 18
): AccidentZone[] {
  // 하드캡 방어: 호출자가 20 이상을 넘겨도 (하드캡 - 1)로 클램프해 boundary region 여유 확보.
  const cap = Math.max(0, Math.min(maxRegions, IOS_REGION_HARD_CAP - 1));

  const withDistance = zones.map((zone) => ({
    zone,
    distance: haversineMeters(userLat, userLon, zone.latitude, zone.longitude),
  }));

  withDistance.sort((a, b) => a.distance - b.distance);

  return withDistance.slice(0, cap).map((entry) => entry.zone);
}

/**
 * 재등록(re-registration) 정책: 사용자가 마지막 등록 중심에서 hysteresisMeters 이상
 * 이동했을 때만 true 를 반환한다. 미세한 위치 흔들림마다 지오펜스를 재등록하면
 * region churn 으로 배터리를 낭비하므로, 이동 거리가 임계값을 "초과"할 때만 재등록한다.
 *
 * boundary region 개념과 연결: 아래 makeBoundaryRegion 이 만드는 큰 원(현재 중심 주변)을
 * 벗어나는 사건이 재선택 트리거이며, 이 함수는 그 판정을 거리 기반으로 근사/보조한다.
 *
 * @param lastCenterLat    마지막으로 근접 구역을 등록한 중심 위도
 * @param lastCenterLon    마지막으로 근접 구역을 등록한 중심 경도
 * @param currentLat       현재 사용자 위도
 * @param currentLon       현재 사용자 경도
 * @param hysteresisMeters 재등록을 트리거하는 최소 이동 거리(m)
 */
export function shouldReRegister(
  lastCenterLat: number,
  lastCenterLon: number,
  currentLat: number,
  currentLon: number,
  hysteresisMeters: number
): boolean {
  const moved = haversineMeters(lastCenterLat, lastCenterLon, currentLat, currentLon);
  return moved > hysteresisMeters;
}

/**
 * 'boundary' region: 현재 중심 주변의 큰 원(반경 radiusMeters)을 하나의 지오펜스로
 * 함께 모니터링한다. 사용자가 이 원을 벗어나면(EXIT boundary) 근접 구역을 재선택해야
 * 한다는 신호로 삼는다. 즉, 근접 구역 N개 + boundary 1개를 함께 등록하므로
 * maxRegions 는 하드캡보다 낮아야 한다(위 selectNearestZones 의 cap 참고).
 *
 * 반경(radiusMeters)은 재등록 hysteresis 와 매칭되게 잡는 것이 좋다: 너무 작으면
 * 자주 재등록(churn), 너무 크면 오래된 구역 집합을 계속 쓰게 된다.
 */
export type BoundaryRegion = {
  identifier: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

/** 현재 중심에서 재선택을 트리거할 boundary region 을 만드는 순수 헬퍼. */
export function makeBoundaryRegion(
  centerLat: number,
  centerLon: number,
  radiusMeters: number,
  identifier: string = 'wss-boundary'
): BoundaryRegion {
  return {
    identifier,
    latitude: centerLat,
    longitude: centerLon,
    radiusMeters,
  };
}
