// 주간 일별 대표 점수 집계(computeWeeklyDaily) 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-weekly.ts
//
// src/wss/weekly.ts 는 순수 함수지만, 타입 전용 import 를 스트립하지 못하는 경우를
// 대비해 트랜스파일 로더 훅을 먼저 등록하고 동적 import 로 불러온다(verify-grade.ts 방식).
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { computeWeeklyDaily } = await import('../src/wss/weekly.ts');

let failures = 0;
function assert(label: string, cond: boolean): void {
  if (cond) {
    console.log(`PASS ${label}`);
  } else {
    console.log(`FAIL ${label}`);
    failures += 1;
  }
}

const TODAY = '2026-03-15';
// 기준일과 이전 6일(과거->오늘 순).
const EXPECTED_DATES = [
  '2026-03-09',
  '2026-03-10',
  '2026-03-11',
  '2026-03-12',
  '2026-03-13',
  '2026-03-14',
  '2026-03-15',
];

// (c) 항상 7일을 시간순(과거->오늘)으로, 기준일이 마지막으로 반환한다.
const emptyWeek = computeWeeklyDaily([], TODAY);
assert('빈 이력 -> 길이 7', emptyWeek.length === 7);
assert(
  '빈 이력 -> 날짜가 과거->오늘 순, 기준일이 마지막',
  emptyWeek.every((d, i) => d.dateISO === EXPECTED_DATES[i]) &&
    emptyWeek[6].dateISO === TODAY
);
// (f) 빈 이력 -> 7일 모두 null.
assert('빈 이력 -> 7일 모두 null', emptyWeek.every((d) => d.score === null));

// (a) 같은 날 여러 보행 -> 가장 최근(최신순 배열의 앞쪽) 점수가 대표.
// 이력은 newest-first 이므로 같은 날짜의 첫 항목(=가장 최근)이 대표가 되어야 한다.
const multi = computeWeeklyDaily(
  [
    { dateISO: '2026-03-15', displayScore: 88 }, // 오늘의 가장 최근 -> 대표
    { dateISO: '2026-03-15', displayScore: 42 }, // 오늘의 더 오래된 것 -> 무시
    { dateISO: '2026-03-15', displayScore: 10 },
  ],
  TODAY
);
assert('같은 날 여러 보행 -> 최신 88 이 대표', multi[6].score === 88);

// (b) 보행 없는 날은 null(빈 막대).
const gaps = computeWeeklyDaily(
  [
    { dateISO: '2026-03-15', displayScore: 70 },
    { dateISO: '2026-03-13', displayScore: 55 },
  ],
  TODAY
);
assert('03-15 대표 70', gaps[6].score === 70);
assert('03-14 보행없음 -> null', gaps[5].score === null);
assert('03-13 대표 55', gaps[4].score === 55);
assert('03-09 보행없음 -> null', gaps[0].score === null);

// (d) 창(window) 밖의 날짜는 제외.
const outside = computeWeeklyDaily(
  [
    { dateISO: '2026-03-15', displayScore: 90 },
    { dateISO: '2026-03-08', displayScore: 99 }, // 창 밖(하루 전) -> 제외
    { dateISO: '2026-03-16', displayScore: 99 }, // 미래(창 밖) -> 제외
    { dateISO: '2025-12-01', displayScore: 99 }, // 한참 과거 -> 제외
  ],
  TODAY
);
assert('창 밖 03-08/03-16/2025 제외 -> 오늘만 90', outside[6].score === 90);
assert('창 밖 항목은 7칸 합계에 영향 없음', outside.filter((d) => d.score !== null).length === 1);

// (e) dateISO 없는 항목은 무시(날짜에 배치 불가).
const missing = computeWeeklyDaily(
  [
    { displayScore: 100 }, // dateISO 없음 -> 무시
    { dateISO: '2026-03-14', displayScore: 60 },
  ],
  TODAY
);
assert('dateISO 없는 항목 무시 -> 03-14 만 60', missing[5].score === 60);
assert('dateISO 없는 항목은 어느 날에도 안 들어감', missing.filter((d) => d.score !== null).length === 1);

// (추가) 입력이 newest-first 계약을 지키면, 배열 앞쪽이 더 최근으로 취급된다.
// 다른 날짜가 섞여 있어도 각 날짜의 첫 매칭이 대표가 되는지 확인.
const mixed = computeWeeklyDaily(
  [
    { dateISO: '2026-03-14', displayScore: 30 }, // 03-14 최신 -> 대표
    { dateISO: '2026-03-15', displayScore: 80 }, // 03-15 최신 -> 대표
    { dateISO: '2026-03-14', displayScore: 99 }, // 03-14 더 오래됨 -> 무시
  ],
  TODAY
);
assert('혼합: 03-14 대표 30(첫 매칭)', mixed[5].score === 30);
assert('혼합: 03-15 대표 80', mixed[6].score === 80);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
