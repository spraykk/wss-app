// useRatioPercent / formatUseRatioPercent 순수 유도 함수 검증 (FEAT-004)
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-use-ratio.ts
//
// 검증 내용:
//  (a) 일반 비율은 0~100 정수 백분율로 반올림된다(0.5 반올림 포함).
//  (b) 0/음수/NaN/Infinity 는 방어적으로 0% 로 접힌다.
//  (c) 1 이상은 100% 로 클램프된다.
//  (d) formatUseRatioPercent 는 useRatioPercent 에 '%' 를 붙인 문자열이다.
//  (e) 정수 반올림 규칙이 실제로 exercised 되어(0.366 -> 37%) 상수 변경에 민감하다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { useRatioPercent, formatUseRatioPercent } = await import('../src/wss/useRatio.ts');

let failures = 0;
function assertEq(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`PASS ${label}: ${String(actual)}`);
  } else {
    console.log(`FAIL ${label}: got ${String(actual)}, expected ${String(expected)}`);
    failures += 1;
  }
}

// (a) 일반 비율 반올림.
assertEq('(a) 0.37 -> 37', useRatioPercent(0.37), 37);
assertEq('(a) 0.5 -> 50', useRatioPercent(0.5), 50);
assertEq('(a) 0.005 rounds to 1', useRatioPercent(0.005), 1);
assertEq('(a) 0.004 rounds to 0', useRatioPercent(0.004), 0);

// (b) 방어적 0% 폴백.
assertEq('(b) 0 -> 0', useRatioPercent(0), 0);
assertEq('(b) negative -> 0', useRatioPercent(-0.2), 0);
assertEq('(b) NaN -> 0', useRatioPercent(Number.NaN), 0);
// Infinity 는 유한하지 않으므로 방어적으로 0% 로 접힌다(비유한 입력은 신뢰하지 않는다).
assertEq('(b) Infinity -> 0', useRatioPercent(Number.POSITIVE_INFINITY), 0);

// (c) 1 이상 클램프.
assertEq('(c) 1 -> 100', useRatioPercent(1), 100);
assertEq('(c) 1.5 -> 100', useRatioPercent(1.5), 100);

// (d) 문자열 포맷.
assertEq('(d) format 0.37 -> "37%"', formatUseRatioPercent(0.37), '37%');
assertEq('(d) format 0 -> "0%"', formatUseRatioPercent(0), '0%');
assertEq('(d) format 1 -> "100%"', formatUseRatioPercent(1), '100%');

// (e) 반올림이 실제로 exercised: 0.366 -> 37 (floor 였다면 36, 상수/공식 변경에 민감).
assertEq('(e) 0.366 rounds to 37 (mutation-sensitive)', useRatioPercent(0.366), 37);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
