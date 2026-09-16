// 두 위험구역 원이 겹치는 "부분(렌즈 모양)"만 지도에 따로 그리기 위한 순수 기하 계산.
// react-native-maps(Google Maps/Apple MapKit)는 원-원 교집합을 그려주는 기능이 없어서,
// 여기서 직접 교차 다각형(렌즈)을 계산한 뒤 <Polygon>으로 그린다.
//
// 계산 방식: 관악구 규모(반경 수백 m)에서는 지구를 평면으로 근사해도 오차가 센티미터 단위로
// 무시할 만하다는 점을 이용해, 두 중심의 중점을 기준으로 위경도를 미터 단위 평면좌표로
// 변환한 뒤 표준적인 "두 원의 교차" 공식을 적용하고, 결과를 다시 위경도로 되돌린다.
// (scripts/verify-overlap-geometry.ts 에서 이 계산이 실제 원-원 교차 넓이 공식과 일치하는지
//  여러 케이스로 검증한다.)

export interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_M = 6371000;

/** 기준점(refLat, refLon) 주변을 평면(미터) 좌표로 근사 변환 */
export function toLocalXY(refLat: number, refLon: number, lat: number, lon: number): { x: number; y: number } {
  const latRad = (refLat * Math.PI) / 180;
  const x = (((lon - refLon) * Math.PI) / 180) * EARTH_RADIUS_M * Math.cos(latRad);
  const y = (((lat - refLat) * Math.PI) / 180) * EARTH_RADIUS_M;
  return { x, y };
}

/** toLocalXY의 역변환 */
export function fromLocalXY(refLat: number, refLon: number, x: number, y: number): LatLng {
  const latRad = (refLat * Math.PI) / 180;
  const latitude = refLat + (y / EARTH_RADIUS_M) * (180 / Math.PI);
  const longitude = refLon + (x / (EARTH_RADIUS_M * Math.cos(latRad))) * (180 / Math.PI);
  return { latitude, longitude };
}

function normalizeAngle(a: number): number {
  let x = a % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x;
}

/** 중심(cx,cy) 원 위에서 fromAngle에서 시작해 throughAngle을 반드시 지나면서 toAngle로
 * 끝나는 호를 steps개 구간으로 나눠 샘플링한다 (렌즈 폴리곤의 한쪽 변을 만드는 데 사용). */
function sampleArcThrough(
  cx: number,
  cy: number,
  r: number,
  fromAngle: number,
  toAngle: number,
  throughAngle: number,
  steps: number
): { x: number; y: number }[] {
  const ccwSpan = normalizeAngle(toAngle - fromAngle); // fromAngle -> toAngle 반시계 방향 각도
  const throughSpan = normalizeAngle(throughAngle - fromAngle);
  // throughAngle이 반시계 경로 위에 있으면 반시계로, 아니면 시계로 이동해야 throughAngle을 지난다
  const goCounterClockwise = throughSpan <= ccwSpan + 1e-9;
  const span = goCounterClockwise ? ccwSpan : ccwSpan - 2 * Math.PI;
  const pts: { x: number; y: number }[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const ang = fromAngle + span * t;
    pts.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
  }
  return pts;
}

export type OverlapRegion =
  | { kind: 'lens'; polygon: LatLng[] }
  /** 한 원이 다른 원을 완전히 포함하는 경우 - 겹치는 부분은 그냥 더 작은 원 전체 */
  | { kind: 'contains'; center: LatLng; radius: number };

/** 두 위험구역 원이 겹치는 부분을 계산한다. 전혀 안 겹치면 null. */
export function computeOverlapRegion(
  centerA: LatLng,
  radiusA: number,
  centerB: LatLng,
  radiusB: number
): OverlapRegion | null {
  const refLat = (centerA.latitude + centerB.latitude) / 2;
  const refLon = (centerA.longitude + centerB.longitude) / 2;
  const A = toLocalXY(refLat, refLon, centerA.latitude, centerA.longitude);
  const B = toLocalXY(refLat, refLon, centerB.latitude, centerB.longitude);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const d = Math.hypot(dx, dy);

  if (d >= radiusA + radiusB) return null; // 안 겹침
  if (d <= Math.abs(radiusA - radiusB) || d === 0) {
    // 한 원이 다른 원을 완전히 포함 (또는 완전히 같은 위치) - 겹치는 부분 = 더 작은 원 전체
    const smaller = radiusA <= radiusB ? { center: centerA, radius: radiusA } : { center: centerB, radius: radiusB };
    return { kind: 'contains', center: smaller.center, radius: smaller.radius };
  }

  // 표준 원-원 교차점 공식
  const a = (d * d - radiusB * radiusB + radiusA * radiusA) / (2 * d);
  const hSq = radiusA * radiusA - a * a;
  const h = Math.sqrt(Math.max(0, hSq));
  const ux = dx / d;
  const uy = dy / d;
  const px = A.x + a * ux;
  const py = A.y + a * uy;
  const i1 = { x: px - h * uy, y: py + h * ux };
  const i2 = { x: px + h * uy, y: py - h * ux };

  const angA1 = Math.atan2(i1.y - A.y, i1.x - A.x);
  const angA2 = Math.atan2(i2.y - A.y, i2.x - A.x);
  const angAThroughB = Math.atan2(dy, dx); // A에서 B 쪽을 바라보는 방향 (B 쪽으로 볼록한 호)

  const angB1 = Math.atan2(i1.y - B.y, i1.x - B.x);
  const angB2 = Math.atan2(i2.y - B.y, i2.x - B.x);
  const angBThroughA = Math.atan2(-dy, -dx); // B에서 A 쪽을 바라보는 방향

  const steps = 20;
  const arcA = sampleArcThrough(A.x, A.y, radiusA, angA1, angA2, angAThroughB, steps); // i1 -> i2
  const arcB = sampleArcThrough(B.x, B.y, radiusB, angB2, angB1, angBThroughA, steps); // i2 -> i1

  // arcB의 첫 점(i2)은 arcA의 마지막 점과 같으므로 중복 제거하고 이어붙인다
  const polygonXY = [...arcA, ...arcB.slice(1)];
  const polygon = polygonXY.map((p) => fromLocalXY(refLat, refLon, p.x, p.y));
  return { kind: 'lens', polygon };
}
