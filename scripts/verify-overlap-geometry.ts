// computeOverlapRegion()이 만든 렌즈 폴리곤의 넓이가, 두 원의 교차 넓이를 구하는
// 표준 closed-form 공식(analytical formula)과 실제로 일치하는지 검증하는 스크립트.
// 지도에서 눈으로 확인하기 전에, 순수 수학적으로 "이 도형이 맞는 도형인가"를 먼저 확인한다.
//
// overlapGeometry.ts 는 확장자 없는 상대 경로 import 와 타입 전용 이름(LatLng)을
// 모듈 간에 쓰므로, Node 의 `--experimental-strip-types` 만으로는 해석/실행되지 않는다.
// 다른 검증 스크립트(FEAT-001 이후)와 동일하게 tsc 트랜스파일 로더 훅을 먼저 등록한 뒤
// 동적 import 로 불러온다(정적 import 는 훅 등록보다 먼저 hoist 되어 실패하므로 동적 import 사용).
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { computeOverlapRegion, fromLocalXY, toLocalXY } = await import('../src/data/overlapGeometry.ts');
type LatLng = { latitude: number; longitude: number };

// 두 원(반지름 r1, r2, 중심 거리 d)의 교차 넓이 - 표준 closed-form 공식
function analyticalLensArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const part1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const part2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const part3 = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return part1 + part2 - part3;
}

// 위경도 폴리곤의 넓이(㎡) - computeOverlapRegion과 같은 방식(중점 기준 평면 근사)으로
// 되돌려 투영한 뒤 신발끈 공식(shoelace formula)으로 계산
function polygonAreaM2(polygon: LatLng[]): number {
  if (polygon.length < 3) return 0;
  const refLat = polygon.reduce((s, p) => s + p.latitude, 0) / polygon.length;
  const refLon = polygon.reduce((s, p) => s + p.longitude, 0) / polygon.length;
  const pts = polygon.map((p) => toLocalXY(refLat, refLon, p.latitude, p.longitude));
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(sum) / 2;
}

// 기준 좌표(관악구 인근)에서 동쪽으로 dxMeters, 북쪽으로 dyMeters 떨어진 지점
const BASE_LAT = 37.48;
const BASE_LON = 126.95;
function offsetPoint(dxMeters: number, dyMeters: number): LatLng {
  return fromLocalXY(BASE_LAT, BASE_LON, dxMeters, dyMeters);
}

interface Case {
  label: string;
  r1: number;
  r2: number;
  d: number;
  expectKind: 'lens' | 'contains' | 'none';
}

const cases: Case[] = [
  { label: '같은 반지름, 중간 정도 겹침', r1: 100, r2: 100, d: 120, expectKind: 'lens' },
  { label: '다른 반지름, 살짝 겹침(접선 근처)', r1: 90, r2: 60, d: 145, expectKind: 'lens' },
  { label: '다른 반지름, 많이 겹침', r1: 90, r2: 90, d: 30, expectKind: 'lens' },
  { label: '한쪽이 완전 포함', r1: 100, r2: 20, d: 10, expectKind: 'contains' },
  { label: '안 겹침', r1: 50, r2: 50, d: 200, expectKind: 'none' },
  { label: '작은 반지름끼리 아슬아슬하게 겹침', r1: 40, r2: 45, d: 80, expectKind: 'lens' },
];

let allOk = true;

for (const c of cases) {
  const centerA = offsetPoint(0, 0);
  const centerB = offsetPoint(c.d, 0);
  const region = computeOverlapRegion(centerA, c.r1, centerB, c.r2);

  if (c.expectKind === 'none') {
    const ok = region === null;
    console.log(`[${c.label}] expect null -> ${ok ? 'OK' : 'FAIL (' + JSON.stringify(region) + ')'}`);
    if (!ok) allOk = false;
    continue;
  }

  if (region === null) {
    console.log(`[${c.label}] FAIL - null 반환됨 (겹쳐야 하는 케이스)`);
    allOk = false;
    continue;
  }

  if (c.expectKind === 'contains') {
    const ok = region.kind === 'contains';
    console.log(`[${c.label}] expect contains -> ${ok ? 'OK' : 'FAIL (kind=' + region.kind + ')'}`);
    if (!ok) allOk = false;
    continue;
  }

  // lens 케이스: 폴리곤 넓이 vs 이론값 비교
  const ok1 = region.kind === 'lens';
  if (!ok1) {
    console.log(`[${c.label}] FAIL - kind가 lens가 아님 (${region.kind})`);
    allOk = false;
    continue;
  }
  const polygonArea = polygonAreaM2(region.polygon);
  const expectedArea = analyticalLensArea(c.r1, c.r2, c.d);
  const relError = Math.abs(polygonArea - expectedArea) / expectedArea;
  const areaOk = relError < 0.01; // 1% 이내 오차 허용 (폴리곤이 곡선을 20구간 직선으로 근사하므로)
  console.log(
    `[${c.label}] polygon area=${polygonArea.toFixed(1)}m² expected=${expectedArea.toFixed(1)}m² ` +
      `relError=${(relError * 100).toFixed(3)}% -> ${areaOk ? 'OK' : 'FAIL'}`
  );
  if (!areaOk) allOk = false;

  // 폴리곤 정점들이 실제로 두 원 중 적어도 한쪽 경계 위(또는 안쪽)에 있는지 sanity check:
  // 렌즈 밖으로 크게 벗어난 점이 없어야 한다 (두 원 반지름 중 큰 값보다 center로부터 멀면 이상함)
  const maxDistFromA = Math.max(
    ...region.polygon.map((p) => {
      const local = toLocalXY(centerA.latitude, centerA.longitude, p.latitude, p.longitude);
      return Math.hypot(local.x, local.y);
    })
  );
  const boundsOk = maxDistFromA <= c.r1 + 0.5; // 0.5m 오차 허용
  console.log(`  (sanity: maxDistFromCenterA=${maxDistFromA.toFixed(2)}m <= r1=${c.r1}m -> ${boundsOk ? 'OK' : 'FAIL'})`);
  if (!boundsOk) allOk = false;
}

if (allOk) {
  console.log('✅ PASS - 겹침 영역(렌즈) 기하 계산이 이론값과 일치');
  process.exit(0);
} else {
  console.error('❌ FAIL - 겹침 영역 기하 계산에 문제가 있음');
  process.exit(1);
}
