// Supabase 통계 파싱/표본부족 처리 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-supabase-stats.ts
//
// src/data/supabase.ts 의 fetchStats() 는 @supabase/supabase-js / expo-constants 를
// 지연 require 하므로 node_modules 없는 샌드박스에서 그대로 import 하면 실패한다.
// 따라서 verify-api-key.ts 와 동일한 방식으로, RPC 결과 row 를 WssStats 로 변환하는
// "순수 파싱 계약"을 여기서 재현해 검증한다(로직은 supabase.ts 와 동일하게 유지할 것).
//
// 또한 리포트 화면(app/report.tsx)의 "표본 부족" 판단(MIN_STATS_SAMPLE=5)이
// 가짜 숫자를 만들지 않고 null/부족을 정직하게 처리하는지도 확인한다.

interface WssStats {
  sampleCount: number;
  meanScore: number | null;
  q3Score: number | null;
}

// supabase.ts fetchStats 의 row -> WssStats 변환 로직 재현.
function parseStatsRow(data: unknown): WssStats | null {
  const row = (Array.isArray(data) ? data[0] : data) as
    | { sample_count?: unknown; mean_score?: unknown; q3_score?: unknown }
    | null
    | undefined;
  if (!row) return null;
  const sampleCount = Number(row.sample_count ?? 0);
  if (!Number.isFinite(sampleCount)) return null;
  const meanRaw =
    row.mean_score === null || row.mean_score === undefined ? null : Number(row.mean_score);
  const q3Raw =
    row.q3_score === null || row.q3_score === undefined ? null : Number(row.q3_score);
  return {
    sampleCount,
    meanScore: meanRaw !== null && Number.isFinite(meanRaw) ? meanRaw : null,
    q3Score: q3Raw !== null && Number.isFinite(q3Raw) ? q3Raw : null,
  };
}

// report.tsx 의 표본 충분 판단 재현.
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

// (a) 정상 단일 행(배열 형태) 파싱.
const okArray = parseStatsRow([{ sample_count: 12, mean_score: 83.4, q3_score: 91 }]);
assert('배열 단일행 파싱: count=12', okArray?.sampleCount === 12);
assert('배열 단일행 파싱: mean=83.4', okArray?.meanScore === 83.4);
assert('배열 단일행 파싱: q3=91', okArray?.q3Score === 91);
assert('표본 12 -> 통계 표시 가능', hasEnoughStats(okArray) === true);

// (b) 객체 형태(비배열)도 방어적으로 처리.
const okObject = parseStatsRow({ sample_count: 7, mean_score: 70, q3_score: 80 });
assert('객체 형태 파싱: count=7', okObject?.sampleCount === 7);
assert('표본 7 -> 통계 표시 가능', hasEnoughStats(okObject) === true);

// (c) 표본 없음(빈 테이블): count=0, mean/q3=null -> 통계 표시 불가(정직 처리).
const empty = parseStatsRow([{ sample_count: 0, mean_score: null, q3_score: null }]);
assert('빈 표본: count=0', empty?.sampleCount === 0);
assert('빈 표본: mean=null', empty?.meanScore === null);
assert('빈 표본: q3=null', empty?.q3Score === null);
assert('표본 0 -> 통계 표시 불가', hasEnoughStats(empty) === false);

// (d) 표본 부족(<5): 숫자는 있어도 표시하지 않는다(가짜 안심 방지).
const few = parseStatsRow([{ sample_count: 4, mean_score: 88, q3_score: 95 }]);
assert('표본 4 -> 표시 불가(부족)', hasEnoughStats(few) === false);
assert('경계값 표본 5 -> 표시 가능', hasEnoughStats(parseStatsRow([{ sample_count: 5, mean_score: 60, q3_score: 70 }])) === true);

// (e) 잘못된/없는 응답 -> null, 표시 불가.
assert('null 데이터 -> null', parseStatsRow(null) === null);
assert('undefined 데이터 -> null', parseStatsRow(undefined) === null);
assert('빈 배열 -> null', parseStatsRow([]) === null);
assert('null 통계 -> 표시 불가', hasEnoughStats(null) === false);

// (f) 숫자 문자열(예: numeric 이 문자열로 올 때)도 Number 로 정규화.
const stringy = parseStatsRow([{ sample_count: '9', mean_score: '82.5', q3_score: '90' }]);
assert('문자열 숫자 정규화: count=9', stringy?.sampleCount === 9);
assert('문자열 숫자 정규화: mean=82.5', stringy?.meanScore === 82.5);
assert('문자열 표본 9 -> 표시 가능', hasEnoughStats(stringy) === true);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
