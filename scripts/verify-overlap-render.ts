// 겹침 렌즈 렌더링 계획(버그 #4) 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-overlap-render.ts
//
// planLensRendering 은 "공통 위험구역(zone)을 공유하는" 렌즈들을 하나의 group 으로 묶고,
// group 당 정확히 하나의 렌즈에만 반투명 fill 을 적용한다(나머지는 외곽선만). 이렇게 하면
// 3개 이상의 원이 한 지점에서 겹쳐도 fill alpha 가 누적되지 않는다(버그 #4의 핵심 불변식).
// segmentKey.ts 처럼 이 모듈도 순수하지만, 다른 검증 스크립트와 동일하게 트랜스파일 훅을
// 먼저 등록한 뒤 동적 import 한다(안전).
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { planLensRendering } = await import('../src/data/overlapRender.ts');

interface Pair {
  i: number;
  j: number;
}

let failures = 0;
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`PASS ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
    failures += 1;
  }
}

function fillCountPerGroup(plans: { groupId: number; fill: boolean }[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of plans) {
    if (p.fill) m.set(p.groupId, (m.get(p.groupId) ?? 0) + 1);
  }
  return m;
}

// (1) 3개 원 A,B,C 가 서로 겹침 -> 쌍 (A,B),(A,C),(B,C) 는 zone 을 공유하므로 한 group.
//     따라서 fill 은 정확히 1개여야 한다(3개 렌즈가 다 채워져 alpha 누적되면 실패).
const triangle: Pair[] = [
  { i: 0, j: 1 },
  { i: 0, j: 2 },
  { i: 1, j: 2 },
];
const triPlans = planLensRendering(triangle);
assert('3-겹침(A,B,C): 렌즈 계획 개수 = 쌍 개수', triPlans.length === 3, `${triPlans.length}`);
const triFill = triPlans.filter((p) => p.fill).length;
assert('3-겹침(A,B,C): fill 렌즈가 정확히 1개(alpha 누적 방지)', triFill === 1, `${triFill}개`);
const triGroups = new Set(triPlans.map((p) => p.groupId));
assert('3-겹침(A,B,C): 하나의 group 으로 묶임', triGroups.size === 1, `${triGroups.size}개 group`);

// (2) 서로 무관한 두 쌍 (A,B)=(0,1) 과 (C,D)=(2,3): zone 을 공유하지 않으므로 별개 group,
//     각 group 은 자기 렌즈를 채운다 -> fill 2개.
const disjoint: Pair[] = [
  { i: 0, j: 1 },
  { i: 2, j: 3 },
];
const disjPlans = planLensRendering(disjoint);
const disjFill = disjPlans.filter((p) => p.fill).length;
assert('무관한 두 쌍: 별개 group 이라 fill 2개', disjFill === 2, `${disjFill}개`);
assert(
  '무관한 두 쌍: group 이 2개',
  new Set(disjPlans.map((p) => p.groupId)).size === 2
);

// (3) 일반 불변식: 어떤 입력이든 group 당 fill 은 정확히 1개여야 한다.
const mixed: Pair[] = [
  { i: 0, j: 1 },
  { i: 1, j: 2 }, // 0-1-2 사슬로 첫 group 과 연결
  { i: 5, j: 6 },
  { i: 6, j: 7 },
  { i: 7, j: 5 }, // 5-6-7 삼각형 -> 두 번째 group
  { i: 9, j: 10 }, // 고립 쌍 -> 세 번째 group
];
const mixedPlans = planLensRendering(mixed);
const perGroupFill = fillCountPerGroup(mixedPlans);
const everyGroupExactlyOne = Array.from(perGroupFill.values()).every((c) => c === 1);
assert(
  '일반 불변식: 모든 group 의 fill 개수가 정확히 1',
  everyGroupExactlyOne,
  `group별 fill=[${Array.from(perGroupFill.values()).join(',')}]`
);
assert('일반 불변식: group 3개', perGroupFill.size === 3, `${perGroupFill.size}개`);

// (4) 빈 입력은 빈 계획.
assert('빈 입력 -> 빈 계획', planLensRendering([]).length === 0);

// (5) 순수성: 입력 배열을 변형하지 않는다.
const input: Pair[] = [{ i: 0, j: 1 }, { i: 0, j: 2 }];
const before = JSON.stringify(input);
planLensRendering(input);
assert('planLensRendering 은 입력을 변형하지 않음(순수)', JSON.stringify(input) === before);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
