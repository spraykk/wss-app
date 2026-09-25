// WSS 등급 분류(classifyGrade) 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-grade.ts
//
// src/wss/grade.ts 는 순수 함수라 그대로 import 가능하지만, 다른 코어 파일들처럼
// `import type { ... } from '../types'` 같은 타입 전용 import 를 스트립하지 못하는
// 경우를 대비해 트랜스파일 로더 훅을 먼저 등록하고 동적 import 로 불러온다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { classifyGrade } = await import('../src/wss/grade.ts');

const CRITICAL = 60; // WSS_CRITICAL
const MIN_SAMPLE = 5; // MIN_STATS_SAMPLE

let failures = 0;
function assert(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`PASS ${label}: ${String(actual)}`);
  } else {
    console.log(`FAIL ${label}: got ${String(actual)}, expected ${String(expected)}`);
    failures += 1;
  }
}

// 통계가 충분한 표준 케이스(표본 10, 평균 70, Q3 82).
const fullStats = { count: 10, mean: 70, q3: 82 };

// (a) 경계값 59 -> danger (절대기준 우선, 통계 무관).
assert('59점 -> danger', classifyGrade(59, fullStats, CRITICAL, MIN_SAMPLE), 'danger');
assert('0점 -> danger', classifyGrade(0, fullStats, CRITICAL, MIN_SAMPLE), 'danger');

// (b) 60점 이상 + 표본부족(<5) -> insufficient.
assert(
  '60점 + 표본4 -> insufficient',
  classifyGrade(60, { count: 4, mean: 70, q3: 82 }, CRITICAL, MIN_SAMPLE),
  'insufficient'
);
assert(
  '90점 + mean null -> insufficient',
  classifyGrade(90, { count: 10, mean: null, q3: 82 }, CRITICAL, MIN_SAMPLE),
  'insufficient'
);
assert(
  '90점 + q3 null -> insufficient',
  classifyGrade(90, { count: 10, mean: 70, q3: null }, CRITICAL, MIN_SAMPLE),
  'insufficient'
);

// (c) 절대기준 우선: 59점이면 표본부족이어도 danger(위험이 insufficient 를 앞선다).
assert(
  '59점 + 표본부족 -> danger(절대기준 우선)',
  classifyGrade(59, { count: 0, mean: null, q3: null }, CRITICAL, MIN_SAMPLE),
  'danger'
);

// (d) 평균 미만(60~mean) -> caution.
assert('60점(평균70 미만) -> caution', classifyGrade(60, fullStats, CRITICAL, MIN_SAMPLE), 'caution');
assert('69점(평균70 미만) -> caution', classifyGrade(69, fullStats, CRITICAL, MIN_SAMPLE), 'caution');

// (e) 평균 이상 Q3 미만 -> good (경계: score===mean 은 good, score===q3 은 excellent).
assert('70점(=평균) -> good', classifyGrade(70, fullStats, CRITICAL, MIN_SAMPLE), 'good');
assert('81점(Q3 미만) -> good', classifyGrade(81, fullStats, CRITICAL, MIN_SAMPLE), 'good');

// (f) Q3 이상 -> excellent.
assert('82점(=Q3) -> excellent', classifyGrade(82, fullStats, CRITICAL, MIN_SAMPLE), 'excellent');
assert('100점 -> excellent', classifyGrade(100, fullStats, CRITICAL, MIN_SAMPLE), 'excellent');

// (g) 경계 표본 5 -> insufficient 가 아니라 정상 상대등급으로 진입.
assert(
  '표본5 경계 + 85점 -> excellent',
  classifyGrade(85, { count: 5, mean: 70, q3: 82 }, CRITICAL, MIN_SAMPLE),
  'excellent'
);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
