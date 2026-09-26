// 위험구역 밀집 클러스터 판정 (순수 함수) - FEAT-003
//
// 목적: 사용자가 사고다발구역이 "꽤 밀집된 구간"에 처음 진입할 때 한 번만 간단한
// 로컬 알림('사고 다발 구간이에요!')을 보내기 위한 순수 판정 로직. 매 원(zone)마다
// 알림을 보내면 번거로우므로, 현재 위치가 속한 겹침 클러스터(연결 요소)의 구역 수가
// 임계(DENSE_ZONE_COUNT_THRESHOLD) 이상일 때만 '밀집'으로 본다.
//
// 순수성/검증(중요): 이 모듈은 node 표준 라이브러리를 import 하지 않고, 배열/값을 주입받는
// 순수 함수만 노출한다. 따라서 React Native 없이 `node --experimental-strip-types` 로
// scripts/verify-zone-cluster.ts 가 그대로 검증할 수 있다. 위치/경로를 서버로 전송하지 않으며
// 밀집 판정은 전적으로 온디바이스 순수 계산이다.
//
// 기존 순수 헬퍼(accidentZones.ts)를 재사용한다: findEnclosingZones(위치를 감싸는 구역),
// computeOverlapPairs(원이 실제로 겹치는 zone 쌍). 클러스터링은 mergeNearbyZones 와 동일한
// union-find(연결 요소) 패턴을 따르되, "병합"이 아니라 "현재 위치가 속한 겹침 그래프의 연결
// 요소"를 식별하는 데 쓴다.
import type { AccidentZone } from '../types';
import { findEnclosingZones, computeOverlapPairs } from './accidentZones';

// [설계값 · 튜닝 가능] 밀집으로 판정하는 클러스터 최소 구역 수. 현재 위치가 속한 겹침 클러스터의
// 구역 수가 이 값 이상이면 isDense=true. 확정 채점 파라미터(k=4/60/0.3/40/pitch10/3000)가 아니라
// 알림 UX 를 위한 새 설계 상수이므로 실증/피드백에 따라 조정할 수 있다. 3 = "세 개 이상의 위험
// 구역이 서로 겹쳐 뭉친 지점"을 밀집으로 본다(단일/이중 겹침은 흔하므로 알림 남발을 피한다).
export const DENSE_ZONE_COUNT_THRESHOLD = 3;

export interface DenseClusterResult {
  /** 현재 위치가 속한 겹침 클러스터의 결정적 식별자. 어떤 구역에도 속하지 않으면 null. */
  clusterId: string | null;
  /** 그 클러스터에 속한 구역 수(위치를 감싸는 구역들의 연결 요소 크기). 구역 밖이면 0. */
  zoneCount: number;
  /** zoneCount >= DENSE_ZONE_COUNT_THRESHOLD 이면 true. */
  isDense: boolean;
}

export interface DenseClusterOptions {
  /** 밀집 임계(기본 DENSE_ZONE_COUNT_THRESHOLD). 테스트/튜닝 주입용. */
  denseThreshold?: number;
}

// 겹침 그래프의 연결 요소(클러스터)를 union-find 로 계산해, 각 zone 인덱스가 속한
// 클러스터의 대표 루트를 담은 parent 배열을 반환하는 내부 헬퍼(mergeNearbyZones 와 동일 패턴).
// 겹침 판정은 computeOverlapPairs(원이 실제로 겹치는 쌍)를 그대로 재사용하므로 판정 규칙이 일관된다.
function buildOverlapComponents(zones: AccidentZone[]): number[] {
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

  // computeOverlapPairs 는 (i<j) 오름차순 쌍을 반환하므로 union 순서가 결정적이다.
  for (const { i, j } of computeOverlapPairs(zones)) {
    union(i, j);
  }

  // 경로 압축을 마무리해 모든 원소가 최종 루트를 가리키게 한다.
  return zones.map((_, i) => find(i));
}

// 클러스터 구성원(AccidentZone[])으로부터 '결정적' clusterId 를 만든다. 같은 구성원 집합이면
// 입력 순서와 무관하게 항상 같은 문자열을 반환한다: 구성원 id 를 정렬해 결합한다. 정렬을 쓰므로
// 겹침 그래프 순회 순서나 배열 순서가 달라도 같은 클러스터는 같은 id 가 된다.
function clusterIdFromMembers(members: AccidentZone[]): string {
  const ids = members.map((z) => z.id).slice().sort();
  return `cluster:${ids.join('|')}`;
}

// 현재 위치(lat/lon)가 속한 겹침 클러스터를 판정하는 순수 함수.
//
// 접근:
//  1) findEnclosingZones 로 현재 위치를 원 안에 포함(enclose)하는 구역을 얻는다.
//     하나도 없으면 어떤 클러스터에도 속하지 않으므로 { clusterId:null, zoneCount:0, isDense:false }.
//  2) 전체 zones 의 겹침 그래프 연결 요소(union-find)를 계산한다.
//  3) 위치를 감싸는 구역들이 속한 연결 요소(들)의 합집합을 현재 위치의 "클러스터"로 본다.
//     (겹치는 원들 위에 서 있으면 그 원들은 같은 연결 요소이거나, 서로 다른 요소여도 사용자가
//      동시에 여러 요소 위에 있는 셈이다. 후자를 하나의 밀집 지점으로 합쳐 zoneCount 를 센다.)
//  4) 클러스터 구성원 수 >= denseThreshold 이면 isDense=true.
//  5) clusterId 는 구성원 id 정렬 결합으로 결정적으로 만든다(같은 클러스터 => 항상 같은 id).
//
// 입력 배열을 변형하지 않는다(순수). zones/lat/lon 만 주입받아 검증 가능하다.
export function computeDenseClusterAt(
  zones: AccidentZone[],
  latitude: number,
  longitude: number,
  opts?: DenseClusterOptions
): DenseClusterResult {
  const denseThreshold = opts?.denseThreshold ?? DENSE_ZONE_COUNT_THRESHOLD;

  const enclosing = findEnclosingZones(zones, latitude, longitude);
  if (enclosing.length === 0) {
    return { clusterId: null, zoneCount: 0, isDense: false };
  }

  // 전체 겹침 그래프의 연결 요소 루트.
  const roots = buildOverlapComponents(zones);

  // 위치를 감싸는 구역들이 속한 연결 요소 루트 집합.
  const enclosingIds = new Set(enclosing.map((z) => z.id));
  const memberRoots = new Set<number>();
  for (let i = 0; i < zones.length; i += 1) {
    if (enclosingIds.has(zones[i].id)) memberRoots.add(roots[i]);
  }

  // 그 연결 요소들에 속한 모든 구역을 클러스터 구성원으로 모은다.
  const members: AccidentZone[] = [];
  for (let i = 0; i < zones.length; i += 1) {
    if (memberRoots.has(roots[i])) members.push(zones[i]);
  }

  const zoneCount = members.length;
  const clusterId = clusterIdFromMembers(members);
  const isDense = zoneCount >= denseThreshold;

  return { clusterId, zoneCount, isDense };
}

// '처음 한 번만' 발송 판정을 순수 함수로 분리(검증 가능). backgroundTask 의 모듈 스코프
// lastDenseClusterId 와 현재 판정 결과로 "지금 밀집 알림을 보내야 하는가"를 결정한다.
//
// 규칙: isDense 이고(밀집 구간), 현재 클러스터가 직전에 알린 클러스터와 다를 때만 true.
//  - 같은 클러스터에 머무는 동안(currentClusterId === lastClusterId) => false(재발송 안 함).
//  - 밀집이 아니면(isDense=false, 보통 currentClusterId=null) => false(발송 안 함).
//  - 클러스터를 벗어났다가(=> 호출부가 lastClusterId 를 null 로 리셋) 다시 진입하거나 다른
//    클러스터로 진입하면 currentClusterId !== lastClusterId 가 되어 다시 true.
export function shouldNotifyDenseCluster(
  lastClusterId: string | null,
  currentClusterId: string | null,
  isDense: boolean
): boolean {
  if (!isDense) return false;
  if (currentClusterId === null) return false;
  return currentClusterId !== lastClusterId;
}

/** decideDenseClusterAlert 의 결정: 지금 알림을 발송할지(fire)와, 발송 후 backgroundTask 가
 *  저장해야 할 다음 lastDenseClusterId 값(nextLastClusterId). */
export interface DenseAlertDecision {
  /** 지금 밀집 진입 알림을 발송해야 하는가. */
  fire: boolean;
  /** 이 판정 후 backgroundTask 의 lastDenseClusterId 에 저장할 값. */
  nextLastClusterId: string | null;
}

// '처음 한 번만' 발송 + 쿨다운을 하나의 순수 결정으로 합친다(검증 가능). backgroundTask 의
// 밀집 분기 결함을 순수 함수로 끌어내 단위 테스트할 수 있게 한 것이다.
//
// 결함(수정 대상): 기존 인라인 로직은 shouldNotifyDenseCluster 가 true(진짜 새 클러스터)라도
// 쿨다운(cooldownReady=false)이 막으면 조건 전체가 false 가 되어, "같은 클러스터 유지" 분기로
// 떨어져 lastDenseClusterId 를 새 클러스터로 갱신해 버렸다. 그 결과 그 새 클러스터는 쿨다운이
// 끝난 뒤에도 currentClusterId === lastClusterId 가 되어 영영 알림이 안 나갔다.
//
// 올바른 규칙:
//  - 새 클러스터(shouldNotifyDenseCluster=true) & 쿨다운 준비됨(cooldownReady=true)
//      => 발송(fire=true), lastDenseClusterId 를 현재 클러스터로 전진.
//  - 새 클러스터지만 쿨다운이 막음(cooldownReady=false)
//      => 발송 안 함(fire=false), lastDenseClusterId 를 '그대로 유지'(전진 금지)해서 쿨다운이
//         끝난 뒤의 샘플이 여전히 currentClusterId !== lastClusterId 를 만족해 발송하게 한다.
//  - 밀집 아님/구역 밖(isDense=false 또는 currentClusterId=null)
//      => 발송 안 함, lastDenseClusterId 를 null 로 리셋(재진입/다른 클러스터에서 재발송).
//  - 같은 이미-알린 클러스터에 머무는 중
//      => 발송 안 함, lastDenseClusterId 를 그대로 유지(재발송 없음).
export function decideDenseClusterAlert(
  lastClusterId: string | null,
  currentClusterId: string | null,
  isDense: boolean,
  cooldownReady: boolean
): DenseAlertDecision {
  // 밀집 구간 밖(또는 클러스터 없음): 다음 (재)진입에서 다시 알리도록 리셋.
  if (!isDense || currentClusterId === null) {
    return { fire: false, nextLastClusterId: null };
  }
  // 새 클러스터인가('처음 한 번만' 판정).
  if (shouldNotifyDenseCluster(lastClusterId, currentClusterId, isDense)) {
    if (cooldownReady) {
      // 발송 + 현재 클러스터로 전진.
      return { fire: true, nextLastClusterId: currentClusterId };
    }
    // 쿨다운이 막음: 발송하지 않고 lastClusterId 를 '그대로' 둔다(전진 금지). 이래야 쿨다운이
    // 끝난 뒤의 샘플이 여전히 새 클러스터로 인식되어 알림이 나간다(결함 수정 핵심).
    return { fire: false, nextLastClusterId: lastClusterId };
  }
  // 같은 이미-알린 클러스터에 머무는 중: 재발송 없이 현재 클러스터 기록 유지.
  return { fire: false, nextLastClusterId: currentClusterId };
}
