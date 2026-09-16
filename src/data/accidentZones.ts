// 사고다발지역(accident zone) 로딩 + 중복 병합(dedup) 파이프라인
//
// 배경(버그 #5, HIGH): TAAS 표준 사고다발지 데이터는 "같은 물리적 지점"이
// 연도별로 여러 행(row)으로 반복 수록되어 있다(예: '뿌리약국 부근'이 8건 이상).
// 기존 파이프라인은 각 행을 별개의 zone 으로 취급하여, computeRiskIntensity 가
// 동일 지점의 심각도를 중복 합산 -> riskIntensity 가 과대 계상되었다.
// 이를 바로잡기 위해, 반경 임계값(기본 30m) 이내의 지점들을 하나의 zone 으로
// 병합하는 순수 함수 mergeNearbyZones 를 후처리 단계에 추가한다.
//
// 데이터: assets/accident-zones.json 은 도로교통공단 TAAS 표준 사고다발지
// 원본 export(서울 관악구, 137행)이다. 같은 물리적 지점('뿌리약국 부근' 등)이
// 연도별로 여러 행으로 반복 수록되어 있어 중복 병합(#5) 대상이 된다.
// 이 파일(JSON)은 원본이므로 수정하지 않고, 병합은 아래 런타임 파이프라인
// (loadAccidentZones -> postProcessZones -> mergeNearbyZones)에서만 수행한다.
//
// 순수 함수(postProcessZones / mergeNearbyZones / haversineMeters)는 배열 인자를
// 받아 동작하므로 React Native 없이 `node --experimental-strip-types` 로 검증 가능하다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AccidentZone } from '../types.ts';

const EARTH_RADIUS_METERS = 6371000;

// 두 위경도 좌표 사이의 대권거리(great-circle distance)를 미터로 반환하는 순수 헬퍼.
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const a =
    sinLat * sinLat +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

// 임계값(thresholdMeters) 이내로 서로 인접한 zone 들을 하나로 병합하는 순수 함수.
// - 클러스터링: 진정한 전이적(transitive) 클러스터링 = 겹침 그래프의 연결 요소
//   (connected components). zone i, j 사이의 haversine 거리 <= threshold 이면
//   두 zone 을 잇는 간선(edge)으로 보고, union-find 로 연결 요소를 계산한다.
//   따라서 두 zone 이 직접 이웃이 아니어도 임계값 내 이웃들의 사슬(chain)로
//   연결되면 같은 클러스터가 된다(순서 무관, 전이적). 이 union-find 패턴은
//   src/data/overlapGeometry.ts 의 groupOverlappingCircles 와 동일한 방식이다.
// - 병합 규칙:
//   accidentCount3y = 클러스터 구성원 count 의 "합"(연도별 누적 총합 표현)
//   대표 id/name/coordinate = 최대 count 구성원(동률이면 먼저 등장한 쪽)
//   radiusMeters = 클러스터 내 최대값
//   source = 구성원 중 하나라도 'TAAS_STANDARD' 이면 'TAAS_STANDARD', 아니면 'SAMPLE_PLACEHOLDER'
//
// 보정(calibration) 안전성: 임계값 내 이웃이 없는 고립 zone 은 단일 구성원
// 연결 요소가 되어 그대로 통과한다(합계 = 자기 자신의 count). 따라서 count 5
// 기준 참조 지점은 불변 -> computeZoneSeverity(5)=1.0 -> computeLocationWeight(1.0)=2.5 유지.
// (count 5 를 특수 처리하지 않는다. 일반 알고리즘이 자연히 고립 지점을 보존한다.)
export function mergeNearbyZones(
  zones: AccidentZone[],
  thresholdMeters: number = 30
): AccidentZone[] {
  const parent = zones.map((_, i) => i);

  function find(i: number): number {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  }

  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // 임계값 내에 있는 모든 쌍(i, j)에 대해 간선을 만들어 union.
  for (let i = 0; i < zones.length; i += 1) {
    for (let j = i + 1; j < zones.length; j += 1) {
      if (
        haversineMeters(
          zones[i].latitude,
          zones[i].longitude,
          zones[j].latitude,
          zones[j].longitude
        ) <= thresholdMeters
      ) {
        union(i, j);
      }
    }
  }

  // 연결 요소별로 구성원을 모은다(입력 배열은 변형하지 않는다).
  const components = new Map<number, AccidentZone[]>();
  for (let i = 0; i < zones.length; i += 1) {
    const root = find(i);
    const bucket = components.get(root);
    if (bucket) bucket.push(zones[i]);
    else components.set(root, [zones[i]]);
  }

  return Array.from(components.values()).map((cluster) => {
    if (cluster.length === 1) {
      return cluster[0];
    }

    let representative = cluster[0];
    for (const member of cluster) {
      if (member.accidentCount3y > representative.accidentCount3y) {
        representative = member;
      }
    }

    const totalCount = cluster.reduce((sum, m) => sum + m.accidentCount3y, 0);
    const maxRadius = cluster.reduce(
      (max, m) => Math.max(max, m.radiusMeters),
      0
    );
    const anyTaas = cluster.some((m) => m.source === 'TAAS_STANDARD');

    const merged: AccidentZone = {
      id: representative.id,
      name: representative.name,
      latitude: representative.latitude,
      longitude: representative.longitude,
      radiusMeters: maxRadius,
      accidentCount3y: totalCount,
      source: anyTaas ? 'TAAS_STANDARD' : 'SAMPLE_PLACEHOLDER',
    };
    return merged;
  });
}

// 원시 zone 후처리: 현재는 인접 중복 지점 병합(#5)만 수행한다. 순수/주입 가능.
export function postProcessZones(raw: AccidentZone[]): AccidentZone[] {
  return mergeNearbyZones(raw);
}

// assets/accident-zones.json 을 읽어 AccidentZone[] 로 반환하는 원시 로더.
// 모듈 해석과 분리하기 위해 fs.readFileSync + JSON.parse 를 사용한다.
export function loadRawAccidentZones(): AccidentZone[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const jsonPath = join(here, '..', '..', 'assets', 'accident-zones.json');
  const raw = readFileSync(jsonPath, 'utf8');
  return JSON.parse(raw) as AccidentZone[];
}

// 앱에서 사용하는 진입점: 원시 데이터 로드 후 중복 병합된 zone 목록을 반환한다.
export function loadAccidentZones(): AccidentZone[] {
  return postProcessZones(loadRawAccidentZones());
}
