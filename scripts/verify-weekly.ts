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

const EPS = 1e-9;
function assertClose(label: string, actual: number | null, expected: number): void {
  if (actual !== null && Math.abs(actual - expected) <= EPS) {
    console.log(`PASS ${label}: ${actual} ~= ${expected}`);
  } else {
    console.log(`FAIL ${label}: got ${actual}, expected ${expected}`);
    failures += 1;
  }
}

// (핵심/뮤테이션 민감) 보행시간 가중평균이 last-of-day 와 단순 평균 둘 다와 다른 케이스.
// 점수 90(walk 1분) + 30(walk 9분) -> 가중평균 = (90*1 + 30*9)/10 = 360/10 = 36.
//   last-of-day 였다면 90(또는 순서에 따라 30), 단순 평균이면 60 이 되어 모두 36 과 다르다.
const weighted = computeWeeklyDaily(
  [
    { dateISO: '2026-03-15', displayScore: 90, totalWalkMinutes: 1 },
    { dateISO: '2026-03-15', displayScore: 30, totalWalkMinutes: 9 },
  ],
  TODAY
);
assertClose('보행시간 가중평균 = 36 (last=90/simple=60 과 다름)', weighted[6].score, 36);
assert('가중평균이 last-of-day(90) 이 아님', weighted[6].score !== 90);
assert('가중평균이 단순 평균(60) 이 아님', weighted[6].score !== 60);

// (핵심/실배선 가드) 저장 이력 행은 WSSResult 형태이며 가중치를 totalWalkMinutes 에 담는다.
// app/report.tsx 는 이 WSSResult[] 를 그대로 computeWeeklyDaily 에 넘긴다. 이 케이스는 그 실제
// 배선을 그대로 재현한다: 리더가 존재하지 않는 walkMinutes 필드를 읽도록 되돌아가면(회귀),
// 가중치가 전부 0 이 되어 단순 평균 60 으로 폴백하므로 아래 36 단언이 FAIL 한다(뮤테이션 민감).
// WSSResult 의 다른 필수 필드(rawScore 등)까지 채워 실제 저장 행과 동일한 초과 필드를 갖게 한다.
interface WSSResultLikeRow {
  dateISO: string;
  displayScore: number;
  rawScore: number;
  totalWalkMinutes?: number;
}
const wssShapedRows: WSSResultLikeRow[] = [
  { dateISO: '2026-03-15', displayScore: 90, rawScore: 90, totalWalkMinutes: 1 },
  { dateISO: '2026-03-15', displayScore: 30, rawScore: 30, totalWalkMinutes: 9 },
];
const wssShaped = computeWeeklyDaily(wssShapedRows, TODAY);
assertClose(
  'WSSResult 형태(totalWalkMinutes 가중) 실배선 -> 가중평균 36 (walkMinutes 리더면 60 으로 폴백)',
  wssShaped[6].score,
  36
);
assert('실배선 가중평균이 단순 평균(60) 이 아님', wssShaped[6].score !== 60);

// (i) 단일 보행 -> 그 보행 점수 자체가 대표.
const single = computeWeeklyDaily(
  [{ dateISO: '2026-03-15', displayScore: 73, totalWalkMinutes: 5 }],
  TODAY
);
assertClose('단일 보행 -> 그 점수 73', single[6].score, 73);

// (ii) 두 보행 등가중(같은 totalWalkMinutes) -> 단순 평균.
const equalWeights = computeWeeklyDaily(
  [
    { dateISO: '2026-03-15', displayScore: 80, totalWalkMinutes: 4 },
    { dateISO: '2026-03-15', displayScore: 40, totalWalkMinutes: 4 },
  ],
  TODAY
);
assertClose('등가중 두 보행 -> 단순 평균 60', equalWeights[6].score, 60);

// (iii) 레거시: totalWalkMinutes 가 모든 항목에 없음 -> 등가중 폴백(단순 평균).
const legacy = computeWeeklyDaily(
  [
    { dateISO: '2026-03-15', displayScore: 90 }, // totalWalkMinutes 없음
    { dateISO: '2026-03-15', displayScore: 30 }, // totalWalkMinutes 없음
  ],
  TODAY
);
assertClose('레거시(totalWalkMinutes 없음) -> 단순 평균 60 폴백', legacy[6].score, 60);

// (iii-2) totalWalkMinutes 가 있어도 <=0/비유한이면 가중치 0 -> 그 날에 양의 가중치가 없으면 단순 평균 폴백.
const nonPositiveWeights = computeWeeklyDaily(
  [
    { dateISO: '2026-03-15', displayScore: 100, totalWalkMinutes: 0 },
    { dateISO: '2026-03-15', displayScore: 50, totalWalkMinutes: Number.NaN },
  ],
  TODAY
);
assertClose('totalWalkMinutes<=0/비유한만 -> 단순 평균 75 폴백', nonPositiveWeights[6].score, 75);

// (iv) 혼합: 한 항목만 양의 totalWalkMinutes, 다른 항목은 누락 -> 양의 가중치 항목만 가중평균을 구동.
// 90(walk 2) + 20(totalWalkMinutes 없음) -> weightedSum=180, weightSum=2 -> 180/2 = 90.
const mixedWeights = computeWeeklyDaily(
  [
    { dateISO: '2026-03-15', displayScore: 90, totalWalkMinutes: 2 },
    { dateISO: '2026-03-15', displayScore: 20 }, // totalWalkMinutes 없음 -> 가중치 0
  ],
  TODAY
);
assertClose('혼합: 양의 가중치 항목만 가중평균 구동 -> 90', mixedWeights[6].score, 90);

// (a) 같은 날 여러 보행 -> 보행시간 가중평균이 대표(순서 무관).
const multi = computeWeeklyDaily(
  [
    { dateISO: '2026-03-15', displayScore: 88, totalWalkMinutes: 3 },
    { dateISO: '2026-03-15', displayScore: 40, totalWalkMinutes: 1 },
  ],
  TODAY
);
// (88*3 + 40*1)/4 = (264+40)/4 = 304/4 = 76.
assertClose('같은 날 여러 보행 -> 가중평균 76', multi[6].score, 76);

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

// (추가) 여러 날짜가 섞여 있어도 날짜별로 독립적으로 가중평균이 계산되는지 확인.
// 03-14: 30(walk 3) + 90(walk 1) -> (90+90)/4 = 45. 03-15: 단일 80(walk 2) -> 80.
const mixed = computeWeeklyDaily(
  [
    { dateISO: '2026-03-14', displayScore: 30, totalWalkMinutes: 3 },
    { dateISO: '2026-03-15', displayScore: 80, totalWalkMinutes: 2 },
    { dateISO: '2026-03-14', displayScore: 90, totalWalkMinutes: 1 },
  ],
  TODAY
);
assertClose('혼합: 03-14 날짜별 가중평균 45', mixed[5].score, 45);
assertClose('혼합: 03-15 단일 80', mixed[6].score, 80);

// (g) 같은 날 한 항목의 점수가 비유한이면 그 항목은 집계에서 제외되고, 같은 날의 유한 점수만
// 대표를 만든다. 여기선 유한 점수가 77 하나뿐이라 대표는 77(가중평균/단순 평균 모두 77).
const nonFiniteNewest = computeWeeklyDaily(
  [
    { dateISO: '2026-03-15', displayScore: Number.NaN }, // 비유한 -> 제외
    { dateISO: '2026-03-15', displayScore: 77 }, // 유한 점수 -> 대표
  ],
  TODAY
);
assertClose('비유한 항목 제외 -> 같은 날 유한 77 이 대표', nonFiniteNewest[6].score, 77);

// (g-2) 점수 필드가 누락된 항목도 마찬가지로 제외되고, 같은 날 유한 점수가 대표.
const missingScoreNewest = computeWeeklyDaily(
  [
    { dateISO: '2026-03-15' } as unknown as { dateISO: string; displayScore: number }, // 점수 누락 -> 제외
    { dateISO: '2026-03-15', displayScore: 63 }, // 유한 점수 -> 대표
  ],
  TODAY
);
assertClose('점수 누락 항목 제외 -> 같은 날 유한 63 이 대표', missingScoreNewest[6].score, 63);

// (g-3) 같은 날 모든 항목이 비유한이면 그 날은 null(빈 막대) 로 남는다.
const allNonFinite = computeWeeklyDaily(
  [
    { dateISO: '2026-03-15', displayScore: Number.NaN },
    { dateISO: '2026-03-15', displayScore: Number.POSITIVE_INFINITY },
  ],
  TODAY
);
assert('같은 날 전부 비유한 -> null', allNonFinite[6].score === null);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
