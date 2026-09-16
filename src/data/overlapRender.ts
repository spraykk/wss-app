// 겹침 영역(렌즈) 렌더링 보조 - 버그 #4 (MED) 수정용 순수 로직
//
// 배경: app/map.tsx 는 겹치는 위험구역 쌍마다 "겹치는 부분(렌즈 모양)"을 보라색
// <Polygon fillColor="rgba(147,51,234,0.55)"> 로 그린다. 그런데 3개 이상의 원이
// 한 지점에서 겹치면 그 지점에는 여러 렌즈 폴리곤이 포개져 그려지고, 반투명
// fill 의 alpha(0.55)가 겹친 개수만큼 누적 합성되어 그 지점만 과도하게 진해진다
// (예: 3-겹침 지점은 1-겹침 렌즈보다 훨씬 어둡게 보임). 이는 "겹치면 위험도가 더
// 높다"는 의미와 무관한 순수 시각화 오류다(점수 계산과 무관).
//
// FIX 전략: 렌즈들을 "연결 요소(group)"로 묶고, 한 group 은 하나의 레이어처럼
// 취급한다. 같은 group 안에서는 대표 렌즈 하나만 채우고(fill) 나머지는 외곽선만
// 그리므로, 3개 이상이 겹치는 지점에서도 fill alpha 가 누적되지 않고 균일하게
// 유지된다. 두 렌즈는 "공통 위험구역(zone)을 공유"하면 같은 group 으로 본다.
// (렌즈 (A,B) 와 (A,C) 는 zone A 를 공유 -> A 주변에서 서로 근접/포개질 수 있으므로
//  하나의 group. union-find 로 zone 공유 그래프의 연결 요소를 계산한다.)
//
// 이 모듈은 React Native 없이 순수 배열/인덱스만 다루므로
// `node --experimental-strip-types` 로 검증 가능하다(scripts/verify-overlap-render.ts).

// 겹치는 zone 쌍(인덱스). accidentZones.computeOverlapPairs 의 반환 형태와 동일.
export interface OverlapPair {
  i: number;
  j: number;
}

// 렌즈 하나의 렌더링 지시. fill=true 인 렌즈만 반투명 채움을 그리고,
// fill=false 인 렌즈는 외곽선(stroke)만 그린다. groupId 는 디버깅/키 용도.
export interface LensRenderPlan {
  /** overlapPairs 배열에서의 원래 인덱스(렌즈 region 배열과 1:1로 대응) */
  index: number;
  /** 이 렌즈가 속한 group 대표(연결 요소 루트 인덱스) */
  groupId: number;
  /** 이 렌즈에 반투명 fill 을 적용할지 여부(group 당 정확히 하나만 true) */
  fill: boolean;
}

// 겹치는 쌍 목록으로부터 "렌즈 그룹핑 + group 당 1회 fill" 렌더 계획을 만드는 순수 함수.
// - 두 렌즈(pair)가 공통 zone 인덱스를 하나라도 공유하면 같은 group(union).
// - group 마다 첫 번째(가장 작은 pair 인덱스) 렌즈만 fill=true, 나머지는 fill=false.
// 반환 배열은 입력 pairs 와 같은 순서/길이이므로, 렌즈 region 배열과 인덱스로 대응한다.
export function planLensRendering(pairs: OverlapPair[]): LensRenderPlan[] {
  const n = pairs.length;
  const parent = pairs.map((_, i) => i);

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

  // 공통 zone 을 공유하는 렌즈끼리 union.
  for (let a = 0; a < n; a += 1) {
    for (let b = a + 1; b < n; b += 1) {
      const pa = pairs[a];
      const pb = pairs[b];
      if (pa.i === pb.i || pa.i === pb.j || pa.j === pb.i || pa.j === pb.j) {
        union(a, b);
      }
    }
  }

  // group 당 아직 fill 을 배정하지 않았으면 이 렌즈가 대표(fill=true)가 된다.
  const filledRoots = new Set<number>();
  const plans: LensRenderPlan[] = [];
  for (let idx = 0; idx < n; idx += 1) {
    const root = find(idx);
    const isFirstOfGroup = !filledRoots.has(root);
    if (isFirstOfGroup) filledRoots.add(root);
    plans.push({ index: idx, groupId: root, fill: isFirstOfGroup });
  }
  return plans;
}
