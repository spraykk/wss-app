// 연령대 그룹 통계의 "독립 게이팅(independent gating)" 선택 로직 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-agegroup-stats.ts
//
// app/report.tsx 는 '다른 사용자와 비교'에서 (1) 전체 사용자 통계와 (2) 내 연령대 그룹
// 통계를 각각 MIN_STATS_SAMPLE=5 로 "독립적으로" 게이팅한다. 즉 전체는 충분해도 그룹은
// 부족할 수 있고(그 반대도), 각자 따로 판단해 부족한 쪽만 '측정 중'으로 정직하게 표시한다.
//
// supabase.ts 는 node_modules 없는 샌드박스에서 import 하면 실패하므로(지연 require),
// verify-supabase-stats.ts 와 동일하게 report.tsx 의 게이팅 술어(predicate)를 여기서
// 그대로 재현해 계약을 검증한다(로직은 report.tsx 와 반드시 동일하게 유지할 것).

interface WssStats {
  sampleCount: number;
  meanScore: number | null;
  q3Score: number | null;
}

// report.tsx 의 hasEnoughStats 게이팅 술어 재현(전체/그룹 공통 적용).
const MIN_STATS_SAMPLE = 5;
function hasEnoughStats(stats: WssStats | null): boolean {
  return (
    stats !== null &&
    stats.sampleCount >= MIN_STATS_SAMPLE &&
    stats.meanScore !== null &&
    stats.q3Score !== null
  );
}

let failures = 0;
function assert(label: string, cond: boolean): void {
  if (cond) {
    console.log(`PASS ${label}`);
  } else {
    console.log(`FAIL ${label}`);
    failures += 1;
  }
}

const good: WssStats = { sampleCount: 12, meanScore: 78, q3Score: 88 };
const boundary: WssStats = { sampleCount: 5, meanScore: 60, q3Score: 70 };
const few: WssStats = { sampleCount: 4, meanScore: 90, q3Score: 95 };
const nullMean: WssStats = { sampleCount: 10, meanScore: null, q3Score: 80 };
const nullQ3: WssStats = { sampleCount: 10, meanScore: 70, q3Score: null };
const emptyTable: WssStats = { sampleCount: 0, meanScore: null, q3Score: null };

// 기본 술어 동작.
assert('표본 12 -> 표시 가능', hasEnoughStats(good) === true);
assert('경계 표본 5 -> 표시 가능', hasEnoughStats(boundary) === true);
assert('표본 4(<5) -> 표시 불가', hasEnoughStats(few) === false);
assert('mean null -> 표시 불가', hasEnoughStats(nullMean) === false);
assert('q3 null -> 표시 불가', hasEnoughStats(nullQ3) === false);
assert('빈 테이블 -> 표시 불가', hasEnoughStats(emptyTable) === false);
assert('null 통계 -> 표시 불가', hasEnoughStats(null) === false);

// 독립 게이팅: 전체와 그룹을 각각 따로 판단한다. 두 판단은 서로 영향을 주지 않는다.
// (case 1) 전체 충분 + 그룹 부족 -> 전체만 표시, 그룹은 '측정 중'.
{
  const overall = good;
  const group = few;
  const showOverall = hasEnoughStats(overall);
  const showGroup = hasEnoughStats(group);
  assert('전체 충분 + 그룹 부족 -> 전체 표시', showOverall === true);
  assert('전체 충분 + 그룹 부족 -> 그룹 측정중', showGroup === false);
}

// (case 2) 전체 부족 + 그룹 충분 -> 그룹만 표시, 전체는 '측정 중'.
{
  const overall = few;
  const group = good;
  const showOverall = hasEnoughStats(overall);
  const showGroup = hasEnoughStats(group);
  assert('전체 부족 + 그룹 충분 -> 전체 측정중', showOverall === false);
  assert('전체 부족 + 그룹 충분 -> 그룹 표시', showGroup === true);
}

// (case 3) 그룹이 null(밴드 미선택/미설정) -> 전체 판단과 무관하게 그룹은 '측정 중'.
{
  const overall = good;
  const group = null;
  assert('그룹 null -> 그룹 측정중', hasEnoughStats(group) === false);
  assert('그룹 null 이어도 전체는 독립적으로 표시', hasEnoughStats(overall) === true);
}

// (case 4) 둘 다 충분 -> 둘 다 표시. 둘 다 부족 -> 둘 다 측정중.
assert('둘 다 충분 -> 둘 다 표시', hasEnoughStats(good) === true && hasEnoughStats(boundary) === true);
assert('둘 다 부족 -> 둘 다 측정중', hasEnoughStats(few) === false && hasEnoughStats(emptyTable) === false);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
