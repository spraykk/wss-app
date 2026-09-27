// formatRelativeTime / formatRelativeDateISO 순수 유도 함수 검증 (FEAT-003)
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-relative-time.ts
//
// 검증 내용(경계에 mutation-sensitive: 임계값 오변경 또는 floor->ceil 변경 시 어긋난다):
//  (a) 1분 경계: 59s -> '방금', 60s -> '1분 전'.
//  (b) 시간 경계: 59min -> '59분 전', 60min -> '1시간 전'.
//  (c) 일 경계: 23h -> '23시간 전', 24h -> '1일 전'.
//  (d) 다일: 3일 -> '3일 전'.
//  (e) 미래/음수 델타 -> '방금'(방어적).
//  (f) 비유한(NaN/Infinity)한 fromMs 또는 nowMs -> '-'.
//  (g) floor 규칙 검증: 90s -> '1분 전'(반올림/올림이면 '2분 전' 으로 어긋난다).
//  (h) 날짜 전용 폴백(formatRelativeDateISO): 같은 날 -> '방금', 3일 전 날짜 -> '3일 전',
//      형식 오류/빈 문자열 -> '-'.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { formatRelativeTime, formatRelativeDateISO } = await import('../src/wss/relativeTime.ts');

let failures = 0;
function assertEq(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`PASS ${label}: ${String(actual)}`);
  } else {
    console.log(`FAIL ${label}: got ${String(actual)}, expected ${String(expected)}`);
    failures += 1;
  }
}

const NOW = 1_700_000_000_000; // 고정 기준 시각(ms epoch). 순수성 위해 주입.

// (a) 1분 경계.
assertEq('(a) 59s -> 방금', formatRelativeTime(NOW - 59_000, NOW), '방금');
assertEq('(a) 60s -> 1분 전', formatRelativeTime(NOW - 60_000, NOW), '1분 전');

// (b) 시간 경계.
assertEq('(b) 59min -> 59분 전', formatRelativeTime(NOW - 59 * 60_000, NOW), '59분 전');
assertEq('(b) 60min -> 1시간 전', formatRelativeTime(NOW - 60 * 60_000, NOW), '1시간 전');

// (c) 일 경계.
assertEq('(c) 23h -> 23시간 전', formatRelativeTime(NOW - 23 * 3_600_000, NOW), '23시간 전');
assertEq('(c) 24h -> 1일 전', formatRelativeTime(NOW - 24 * 3_600_000, NOW), '1일 전');

// (d) 다일.
assertEq('(d) 3일 -> 3일 전', formatRelativeTime(NOW - 3 * 86_400_000, NOW), '3일 전');
assertEq('(d) 10일 -> 10일 전', formatRelativeTime(NOW - 10 * 86_400_000, NOW), '10일 전');

// (e) 미래/음수 델타 -> 방금.
assertEq('(e) 미래 60s -> 방금', formatRelativeTime(NOW + 60_000, NOW), '방금');
assertEq('(e) 같은 시각(0) -> 방금', formatRelativeTime(NOW, NOW), '방금');

// (f) 비유한 입력 -> '-'.
assertEq('(f) NaN fromMs -> -', formatRelativeTime(Number.NaN, NOW), '-');
assertEq('(f) Infinity fromMs -> -', formatRelativeTime(Number.POSITIVE_INFINITY, NOW), '-');
assertEq('(f) NaN nowMs -> -', formatRelativeTime(NOW, Number.NaN), '-');
assertEq('(f) -Infinity nowMs -> -', formatRelativeTime(NOW, Number.NEGATIVE_INFINITY), '-');

// (g) floor 규칙(반올림/올림이면 어긋난다).
assertEq('(g) 90s -> 1분 전 (floor)', formatRelativeTime(NOW - 90_000, NOW), '1분 전');
assertEq('(g) 119min -> 1시간 전 (floor)', formatRelativeTime(NOW - 119 * 60_000, NOW), '1시간 전');

// (h) 날짜 전용 폴백.
// 로컬 자정 기준으로 계산하므로, now 를 특정 로컬 날짜의 정오로 잡아 안정적으로 검증한다.
const localNoon = new Date(2023, 10, 15, 12, 0, 0, 0).getTime(); // 2023-11-15 12:00 local
assertEq('(h) 같은 날 -> 방금', formatRelativeDateISO('2023-11-15', localNoon), '방금');
assertEq('(h) 어제 -> 1일 전', formatRelativeDateISO('2023-11-14', localNoon), '1일 전');
assertEq('(h) 3일 전 -> 3일 전', formatRelativeDateISO('2023-11-12', localNoon), '3일 전');
assertEq('(h) 형식 오류 -> -', formatRelativeDateISO('2023/11/12', localNoon), '-');
assertEq('(h) 빈 문자열 -> -', formatRelativeDateISO('', localNoon), '-');
assertEq('(h) 비유한 now -> -', formatRelativeDateISO('2023-11-12', Number.NaN), '-');

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
