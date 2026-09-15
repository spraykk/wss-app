// 원-원 겹침 기하(버그 #4) 검증 스크립트 - 자기 일관성(self-consistency) 불변식
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-overlap-geometry.ts
//
// 중요: 원본의 6개 참조 케이스 값은 전달되지 않았다. 따라서 임의로 지어낸 고정
// 숫자 대신, 기하적으로 반드시 성립해야 하는 불변식으로 검증한다(가이드.md 참조):
//  (a) 동일 원(r1=r2=r, d=0)  -> 렌즈 면적 == 원 면적(πr²)     (1% 이내)
//  (b) 완전 분리(d >= r1+r2)   -> 면적 0
//  (c) 대칭성 area(r1,r2,d) == area(r2,r1,d)                    (1% 이내)
//  (d) 단조성: d 가 0->r1+r2 로 증가하면 렌즈 면적은 비증가(non-increasing)
//  (e) 완전 포함(d <= |r1-r2|) -> 면적 == π*min(r)²             (1% 이내)
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { circleIntersectionArea, groupOverlappingCircles, circlesOverlap } = await import(
  '../src/data/overlapGeometry.ts'
);

let failures = 0;
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`PASS ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
    failures += 1;
  }
}
// 1% 상대 오차 이내 비교 (0 기대값은 절대 오차로 처리)
function assertWithin1pct(label: string, actual: number, expected: number): void {
  const tol = expected === 0 ? 1e-9 : Math.abs(expected) * 0.01;
  assert(label, Math.abs(actual - expected) <= tol, `got ${actual}, expected ${expected}`);
}

// (a) 동일 원, d=0 -> 원 면적
const r = 50;
assertWithin1pct('(a) 동일 원 렌즈 == 원 면적', circleIntersectionArea(r, r, 0), Math.PI * r * r);

// (b) 완전 분리 -> 0
assertWithin1pct('(b) 분리(d=r1+r2) -> 0', circleIntersectionArea(30, 40, 70), 0);
assertWithin1pct('(b2) 분리(d>r1+r2) -> 0', circleIntersectionArea(30, 40, 100), 0);

// (c) 대칭성
const sym1 = circleIntersectionArea(30, 50, 40);
const sym2 = circleIntersectionArea(50, 30, 40);
assertWithin1pct('(c) 대칭성 area(r1,r2,d)==area(r2,r1,d)', sym1, sym2);

// (d) 단조성: d 증가 시 면적 비증가
let prev = Infinity;
let monotone = true;
const rr1 = 40;
const rr2 = 30;
for (let d = 0; d <= rr1 + rr2; d += 1) {
  const area = circleIntersectionArea(rr1, rr2, d);
  if (area > prev + 1e-6) {
    monotone = false;
    break;
  }
  prev = area;
}
assert('(d) d 증가 시 렌즈 면적 비증가(단조)', monotone);

// (e) 완전 포함 -> 작은 원 면적
const rBig = 60;
const rSmall = 20;
assertWithin1pct(
  '(e) 완전 포함 -> π*min(r)²',
  circleIntersectionArea(rBig, rSmall, 30), // 30 <= |60-20|=40 이므로 완전 포함
  Math.PI * rSmall * rSmall
);

// (f) 렌더링 보조: 3개가 서로 겹치면 하나의 그룹으로 묶여 알파 누적을 방지.
const circles = [
  { id: 'c1', x: 0, y: 0, radiusMeters: 50 },
  { id: 'c2', x: 40, y: 0, radiusMeters: 50 },
  { id: 'c3', x: 20, y: 30, radiusMeters: 50 },
  { id: 'c4', x: 1000, y: 1000, radiusMeters: 20 }, // 멀리 떨어진 독립 원
];
const groups = groupOverlappingCircles(circles);
// 겹치는 c1,c2,c3 -> 1개 그룹, 독립 c4 -> 1개 그룹 = 총 2개 그룹
assert('(f) 3개 겹침 + 1개 독립 -> 2개 그룹', groups.length === 2, `${groups.length}개`);
const bigGroup = groups.find((g) => g.length === 3);
assert('(f2) 겹치는 3개가 한 그룹', !!bigGroup && bigGroup.length === 3, `${bigGroup?.length}`);
assert('(f3) 독립 원 c4 는 겹치지 않음', !circlesOverlap(circles[0], circles[3]));

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
