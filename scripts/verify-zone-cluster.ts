// 위험구역 밀집 클러스터 판정 검증 스크립트 (FEAT-003)
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-zone-cluster.ts
//
// 검증 대상(순수 함수/상수, src/data/zoneCluster.ts):
//  - DENSE_ZONE_COUNT_THRESHOLD 경계(뮤테이션 민감): K-1(미만)=미밀집, K/K+1(이상)=밀집.
//  - computeDenseClusterAt:
//    (a) 겹치는 구역이 임계 미만 => isDense=false, 임계 이상 => true.
//    (b) 같은 위치/같은 클러스터 => 항상 같은 clusterId(결정성, 입력 순서 무관).
//    (c) 서로 다른 클러스터 => 다른 clusterId.
//    (d) 위치가 어떤 구역에도 안 들어감 => clusterId=null, zoneCount=0, isDense=false.
//    (e) 입력 배열 불변(순수).
//  - shouldNotifyDenseCluster: 같은 클러스터=false, 새 클러스터=true, 밀집 아님=false,
//    클러스터 밖(null)=false.
//
// 합성 데이터 설계(결정적): 위도 37.5 고정, 경도를 미터 단위로 조금씩 옮겨 배치한다.
// 위도 37.5 에서 경도 1도 ≈ 111320 * cos(37.5deg) ≈ 88318 m. metersToLonDeg 로 미터->도 환산.
// 원이 겹치는 조건: 두 중심 거리 < r1 + r2. 점을 감싸는(enclose) 조건: 중심까지 거리 <= 반경.
// 한 클러스터의 구역들을 아주 가깝게(중심 간 수 m) 두고 반경을 넉넉히(수십 m) 주면 서로 모두
// 겹치고, 그 근처의 한 점을 모두가 감싼다 -> 위치가 그 클러스터에 속한다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { computeDenseClusterAt, shouldNotifyDenseCluster, DENSE_ZONE_COUNT_THRESHOLD } =
  await import('../src/data/zoneCluster.ts');

type AccidentZone = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  accidentCount3y: number;
  source: 'TAAS_STANDARD' | 'SAMPLE_PLACEHOLDER';
};

let failures = 0;
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`PASS ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
    failures += 1;
  }
}

const BASE_LAT = 37.5;
const METERS_PER_DEG_LAT = 111320;
const cosLat = Math.cos((BASE_LAT * Math.PI) / 180);
function metersToLonDeg(m: number): number {
  return m / (METERS_PER_DEG_LAT * cosLat);
}

// 한 밀집 클러스터를 만든다: count 개의 구역을 중심 경도로부터 stepMeters 간격으로 촘촘히 두고
// 반경을 넉넉히(radius) 준다. 인접/원거리 구성원 모두 서로 겹치도록 radius 를 크게 잡는다.
// 클러스터별로 서로 멀리 떨어뜨리려면 centerLonMeters(기준점에서의 오프셋 미터)를 크게 준다.
function makeCluster(
  prefix: string,
  count: number,
  centerLonMeters: number,
  stepMeters: number,
  radius: number
): AccidentZone[] {
  const zones: AccidentZone[] = [];
  for (let k = 0; k < count; k += 1) {
    const lonMeters = centerLonMeters + k * stepMeters;
    zones.push({
      id: `${prefix}-${k}`,
      name: `${prefix} 구역 ${k}`,
      latitude: BASE_LAT,
      longitude: metersToLonDeg(lonMeters),
      radiusMeters: radius,
      accidentCount3y: 5 + k,
      source: 'TAAS_STANDARD',
    });
  }
  return zones;
}

// 클러스터의 대략적 중심 위치(경도 미터 오프셋)를 점으로 만들어, 모든 구성원이 감싸도록 한다.
function clusterPointLon(centerLonMeters: number, count: number, stepMeters: number): number {
  const midMeters = centerLonMeters + ((count - 1) * stepMeters) / 2;
  return metersToLonDeg(midMeters);
}

// 구역 간 간격 5m, 반경 40m => 어떤 두 구성원도 중심거리 <= (count-1)*5 <= ~35m < 80m(=r1+r2) 로 겹친다.
// 클러스터 중앙 점은 모든 구성원 중심에서 <= ~20m 이내 => 반경 40m 안에 들어와 모두 enclose.
const STEP = 5;
const RADIUS = 40;

// ── (a)/(뮤테이션 민감) 임계 경계 K-1 / K / K+1 ─────────────────────────────
// DENSE_ZONE_COUNT_THRESHOLD 를 바꾸면 이 세 단언 중 하나가 반드시 깨진다.
const K = DENSE_ZONE_COUNT_THRESHOLD;
assert('DENSE_ZONE_COUNT_THRESHOLD === 3 (설계값)', K === 3, String(K));

{
  // K-1 개 클러스터 => 미밀집.
  const zones = makeCluster('below', K - 1, 0, STEP, RADIUS);
  const lon = clusterPointLon(0, K - 1, STEP);
  const r = computeDenseClusterAt(zones, BASE_LAT, lon);
  assert(`K-1(${K - 1})개 클러스터 => zoneCount=${K - 1}`, r.zoneCount === K - 1, `zoneCount=${r.zoneCount}`);
  assert('K-1개 => isDense=false(임계 미만)', r.isDense === false, `isDense=${r.isDense}`);
  assert('K-1개 => clusterId!=null(구역엔 속함)', r.clusterId !== null, `clusterId=${r.clusterId}`);
}
{
  // K 개 클러스터 => 정확히 경계에서 밀집.
  const zones = makeCluster('at', K, 0, STEP, RADIUS);
  const lon = clusterPointLon(0, K, STEP);
  const r = computeDenseClusterAt(zones, BASE_LAT, lon);
  assert(`K(${K})개 클러스터 => zoneCount=${K}`, r.zoneCount === K, `zoneCount=${r.zoneCount}`);
  assert('K개(경계) => isDense=true', r.isDense === true, `isDense=${r.isDense}`);
}
{
  // K+1 개 클러스터 => 밀집.
  const zones = makeCluster('above', K + 1, 0, STEP, RADIUS);
  const lon = clusterPointLon(0, K + 1, STEP);
  const r = computeDenseClusterAt(zones, BASE_LAT, lon);
  assert(`K+1(${K + 1})개 클러스터 => zoneCount=${K + 1}`, r.zoneCount === K + 1, `zoneCount=${r.zoneCount}`);
  assert('K+1개 => isDense=true', r.isDense === true, `isDense=${r.isDense}`);
}

// ── (b) 결정성: 같은 클러스터/같은 위치 => 항상 같은 clusterId(입력 순서 무관) ─
{
  const zones = makeCluster('det', K + 1, 0, STEP, RADIUS);
  const lon = clusterPointLon(0, K + 1, STEP);
  const r1 = computeDenseClusterAt(zones, BASE_LAT, lon);
  const r2 = computeDenseClusterAt(zones, BASE_LAT, lon);
  assert('같은 입력 반복 => 동일 clusterId', r1.clusterId === r2.clusterId && r1.clusterId !== null, `${r1.clusterId}`);
  // 입력 배열 순서를 뒤집어도 같은 clusterId 여야 한다(정렬 결합이므로).
  const reversed = zones.slice().reverse();
  const r3 = computeDenseClusterAt(reversed, BASE_LAT, lon);
  assert('입력 순서 뒤집어도 동일 clusterId(결정성)', r3.clusterId === r1.clusterId, `${r3.clusterId}`);
  assert('뒤집어도 zoneCount/isDense 동일', r3.zoneCount === r1.zoneCount && r3.isDense === r1.isDense);
}

// ── (c) 서로 다른 클러스터 => 다른 clusterId ────────────────────────────────
{
  // 클러스터 A(원점 근처)와 클러스터 B(원점에서 100km 떨어짐)를 한 배열에 넣는다.
  // 100km 오프셋이면 반경 40m 원끼리 절대 겹치지 않아 별개 연결 요소가 된다.
  const clusterA = makeCluster('A', K + 1, 0, STEP, RADIUS);
  const clusterB = makeCluster('B', K + 1, 100000, STEP, RADIUS);
  const zones = [...clusterA, ...clusterB];

  const lonA = clusterPointLon(0, K + 1, STEP);
  const lonB = clusterPointLon(100000, K + 1, STEP);
  const rA = computeDenseClusterAt(zones, BASE_LAT, lonA);
  const rB = computeDenseClusterAt(zones, BASE_LAT, lonB);

  assert('클러스터 A 판정 => isDense=true', rA.isDense === true && rA.clusterId !== null);
  assert('클러스터 B 판정 => isDense=true', rB.isDense === true && rB.clusterId !== null);
  assert('A 클러스터는 B 구역을 포함하지 않음(zoneCount 격리)', rA.zoneCount === K + 1, `zoneCount=${rA.zoneCount}`);
  assert('서로 다른 클러스터 => 다른 clusterId', rA.clusterId !== rB.clusterId, `${rA.clusterId} vs ${rB.clusterId}`);
}

// ── (d) 어떤 구역에도 안 들어감 => clusterId=null, zoneCount=0, isDense=false ─
{
  const zones = makeCluster('far', K + 1, 0, STEP, RADIUS);
  // 위 클러스터에서 아주 멀리(위도로 1도 ≈ 111km) 떨어진 점.
  const r = computeDenseClusterAt(zones, BASE_LAT + 1, metersToLonDeg(0));
  assert('구역 밖 => clusterId=null', r.clusterId === null, `${r.clusterId}`);
  assert('구역 밖 => zoneCount=0', r.zoneCount === 0, `${r.zoneCount}`);
  assert('구역 밖 => isDense=false', r.isDense === false, `${r.isDense}`);
}
{
  // 빈 zones 배열도 안전하게 구역 밖으로 처리.
  const r = computeDenseClusterAt([], BASE_LAT, metersToLonDeg(0));
  assert('빈 zones => clusterId=null, zoneCount=0, isDense=false', r.clusterId === null && r.zoneCount === 0 && r.isDense === false);
}

// ── 단일 구역만 감싸는 경우(고립 zone): 밀집 아님 ───────────────────────────
{
  // 서로 멀리 떨어진 고립 구역들. 점은 그 중 하나만 감싼다 => zoneCount=1, 미밀집.
  const zones: AccidentZone[] = [
    { id: 'iso-0', name: '고립0', latitude: BASE_LAT, longitude: metersToLonDeg(0), radiusMeters: 30, accidentCount3y: 5, source: 'TAAS_STANDARD' },
    { id: 'iso-1', name: '고립1', latitude: BASE_LAT, longitude: metersToLonDeg(100000), radiusMeters: 30, accidentCount3y: 5, source: 'TAAS_STANDARD' },
  ];
  const r = computeDenseClusterAt(zones, BASE_LAT, metersToLonDeg(0));
  assert('고립 단일 구역 감쌈 => zoneCount=1', r.zoneCount === 1, `zoneCount=${r.zoneCount}`);
  assert('고립 단일 구역 => isDense=false', r.isDense === false, `isDense=${r.isDense}`);
}

// ── (e) 순수성: 입력 배열/원소를 변형하지 않는다 ─────────────────────────────
{
  const zones = makeCluster('pure', K + 1, 0, STEP, RADIUS);
  const snapshot = JSON.stringify(zones);
  computeDenseClusterAt(zones, BASE_LAT, clusterPointLon(0, K + 1, STEP));
  assert('computeDenseClusterAt 이 입력 배열을 변형하지 않음(순수)', JSON.stringify(zones) === snapshot);
}

// ── shouldNotifyDenseCluster: '처음 한 번만' 재발송 판정 ─────────────────────
{
  const CID_A = 'cluster:A-0|A-1|A-2';
  const CID_B = 'cluster:B-0|B-1|B-2';

  // 첫 진입(직전 없음) + 밀집 => true.
  assert('첫 진입(last=null) + 밀집 => 발송', shouldNotifyDenseCluster(null, CID_A, true) === true);
  // 같은 클러스터에 머무는 중 => false(재발송 없음).
  assert('같은 클러스터(last==current) => 미발송', shouldNotifyDenseCluster(CID_A, CID_A, true) === false);
  // 다른 클러스터로 진입 => true(재발송).
  assert('다른 클러스터 진입 => 발송', shouldNotifyDenseCluster(CID_A, CID_B, true) === true);
  // 밀집이 아니면(보통 current=null) => false.
  assert('밀집 아님(isDense=false) => 미발송', shouldNotifyDenseCluster(CID_A, null, false) === false);
  assert('밀집 아님 + current 존재해도 => 미발송', shouldNotifyDenseCluster(CID_A, CID_B, false) === false);
  // 클러스터 밖(current=null)이고 밀집=true 라는 모순 입력도 안전하게 미발송(current null 가드).
  assert('current=null 이면(밖) 미발송', shouldNotifyDenseCluster(CID_A, null, true) === false);
  // 밖으로 나갔다(last 를 호출부가 null 로 리셋) 재진입 => 다시 발송.
  assert('밖으로 나갔다 재진입(last=null) => 재발송', shouldNotifyDenseCluster(null, CID_A, true) === true);
}

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
