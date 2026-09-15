// 원-원 겹침(overlap) 기하 (버그 #4, MED) - 순수/검증 가능 모듈
//
// 배경: 지도에서 위험 zone 을 반투명(alpha) 원으로 그린다. 3개 이상의 원이
// 겹치면, 기존 코드는 "쌍(pair)마다" 렌즈(lens) 폴리곤을 그려서 겹침 영역의
// 알파가 누적(over-darken)되었다. 예: 3개가 한 점에서 겹치면 그 영역에
// pair 렌즈가 3개 겹쳐 3배 어두워진다.
//
// FIX 방향:
//  1) 원-원 렌즈 면적/겹침 판정을 순수 함수로 분리(닫힌 형식/closed-form).
//  2) 겹치는 zone 들을 "그룹(union)"으로 묶어, 렌즈를 쌍마다 겹쳐 그리는 대신
//     그룹 단위로 한 번만(또는 알파를 클램프해) 렌더링하도록 대표 표현을 만든다.
//
// 주의: 원본 scripts/verify-overlap-geometry.ts 의 6개 참조 케이스 값은 전달되지
// 않았다. 따라서 1:1 회귀 재현은 불가능하며, 검증은 "자기 일관성(self-consistency)
// 기하 불변식"으로 대체한다(가이드.md의 재구성 참고 참조).
//
// 좌표계: 여기서는 평면(planar) 근사로 반지름/거리를 같은 단위(미터)로 다룬다.
// 지도 렌더링 시에는 위경도를 미터로 환산해 넘겨준다.

export interface OverlapCircle {
  id: string;
  // 평면 근사용 좌표(미터). 지도에서는 기준점 기준 등거리 투영으로 환산.
  x: number;
  y: number;
  radiusMeters: number;
}

// 두 원의 교차(렌즈) 면적을 닫힌 형식으로 계산하는 순수 함수.
// r1, r2: 두 원의 반지름, d: 두 중심 사이의 거리. 모두 같은 단위.
//
// 케이스:
//  - d >= r1 + r2 : 서로 떨어져 있음 -> 0
//  - d <= |r1 - r2| : 한 원이 다른 원에 완전히 포함 -> 작은 원의 넓이(π*min² )
//  - 그 외 : 표준 원-원 렌즈 면적 공식
export function circleIntersectionArea(r1: number, r2: number, d: number): number {
  if (r1 <= 0 || r2 <= 0) return 0;
  const dd = Math.abs(d);

  // 완전 분리
  if (dd >= r1 + r2) return 0;

  // 완전 포함(동심 포함): 작은 원 전체가 렌즈 면적
  if (dd <= Math.abs(r1 - r2)) {
    const rMin = Math.min(r1, r2);
    return Math.PI * rMin * rMin;
  }

  // 부분 겹침: 표준 렌즈 면적 공식
  //   A = r1² * acos((d²+r1²-r2²)/(2 d r1))
  //     + r2² * acos((d²+r2²-r1²)/(2 d r2))
  //     - 0.5 * sqrt((-d+r1+r2)(d+r1-r2)(d-r1+r2)(d+r1+r2))
  const r1sq = r1 * r1;
  const r2sq = r2 * r2;
  const alpha = Math.acos(clamp((dd * dd + r1sq - r2sq) / (2 * dd * r1), -1, 1));
  const beta = Math.acos(clamp((dd * dd + r2sq - r1sq) / (2 * dd * r2), -1, 1));
  const tri = Math.sqrt(
    Math.max(0, (-dd + r1 + r2) * (dd + r1 - r2) * (dd - r1 + r2) * (dd + r1 + r2))
  );
  return r1sq * alpha + r2sq * beta - 0.5 * tri;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// 두 원의 중심 거리(평면). 순수.
export function planarDistance(a: OverlapCircle, b: OverlapCircle): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// 두 원이 (면적을 가진 형태로) 겹치는지 여부. 접점만 있는 경우는 겹침 아님.
export function circlesOverlap(a: OverlapCircle, b: OverlapCircle): boolean {
  return planarDistance(a, b) < a.radiusMeters + b.radiusMeters;
}

// 서로 겹치는 원들을 하나의 그룹(union component)으로 묶는다.
// 반환: 각 그룹은 원 id 들의 배열. 지도 렌더링에서 그룹 단위로 한 번만
// (또는 알파를 고정해) 그려 3개 이상 겹침의 알파 누적을 방지한다.
//
// 알고리즘: 겹침 그래프의 연결 요소(connected components)를 union-find 로 계산.
export function groupOverlappingCircles(circles: OverlapCircle[]): string[][] {
  const parent = circles.map((_, i) => i);

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

  for (let i = 0; i < circles.length; i += 1) {
    for (let j = i + 1; j < circles.length; j += 1) {
      if (circlesOverlap(circles[i], circles[j])) union(i, j);
    }
  }

  const groups = new Map<number, string[]>();
  for (let i = 0; i < circles.length; i += 1) {
    const root = find(i);
    const bucket = groups.get(root);
    if (bucket) bucket.push(circles[i].id);
    else groups.set(root, [circles[i].id]);
  }
  return Array.from(groups.values());
}

// 단일 세그먼트/그룹에 사용할 유효 알파를 계산하는 순수 헬퍼.
// 겹침 개수에 비례해 알파를 누적하지 않고, base 알파를 상한(maxAlpha)으로 클램프한다.
// 지도에서 그룹 단위로 렌더링할 때 알파 과다 누적을 막는 보조 수단.
export function clampAlpha(baseAlpha: number, maxAlpha: number = 0.5): number {
  return clamp(baseAlpha, 0, maxAlpha);
}
