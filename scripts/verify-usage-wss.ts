// computeWSS 의 "감지된 사용 시간(자세 기반) 기반 감점" 검증 (FEAT-003)
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-usage-wss.ts
//
// 검증 내용(자세 기반 이분화 이후의 새 진실):
//  (a) confirmedUseMinutes(감지된 사용)가 있으면 그 값으로 감점(smartphoneUseMinutes 가 달라도 이긴다).
//  (b) 레거시 세그먼트(confirmed 없음, smartphoneUseMinutes 만) -> 예전 rawScore 를 그대로 재현(하위호환).
//  (c) confirmed=0(전 구간 no-use) -> 감점 없음(rawScore=100), usageRatio=0.
//  (d) usageRatio 는 use/walk 로 계산되고, >=0.3 이면 penalty 경로를 탄다.
//  (e) WSSResult 는 더 이상 measurementInsufficient/unknownRatio 를 기록하지 않는다(undefined).
//  (f) usageBands 는 use(confirmedUse)/no-use 만 채우고 estimated/unknown 은 0.
//
// 기대값은 하드코딩하지 않고 실증 가중치 + DEDUCTION_SCALE 로 코드에서 재계산한다
// (verify-wss-example.ts 스타일). 코어 파일은 트랜스파일 훅으로 그대로 실행한다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { computeWSS, computeSegmentWeight } = await import('../src/wss/engine.ts');
const { computeZoneSeverity, DEDUCTION_SCALE } = await import('../src/wss/weights.ts');

const EPS = 1e-9;
let failures = 0;
function assertClose(label: string, actual: number, expected: number): void {
  if (Math.abs(actual - expected) <= EPS) {
    console.log(`PASS ${label}: ${actual} ~= ${expected}`);
  } else {
    console.log(`FAIL ${label}: got ${actual}, expected ${expected}`);
    failures += 1;
  }
}
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`PASS ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
    failures += 1;
  }
}

// 기준 세그먼트(usageRatio<0.3 이 되도록 walk 를 넉넉히 두어 패널티 경로 회피).
// combined = 1.5(위치) * 1.06(비/눈) * 0.97(오전러시) * 1.3(이어폰).
function baseSegment(overrides: Record<string, unknown>) {
  return {
    regionId: 'ref',
    smartphoneUseMinutes: 0,
    walkMinutes: 100,
    riskIntensity: computeZoneSeverity(5), // = 1.0 -> 위치가중 1.5
    weather: 'rain_or_snow' as const,
    timeBand: 'rush_am' as const,
    isEarOccluded: true,
    ...overrides,
  };
}

// (a) confirmedUseMinutes=M(감지된 사용), smartphoneUseMinutes 는 일부러 다른 값 -> confirmed 로 감점.
{
  const M = 2;
  const seg = baseSegment({ confirmedUseMinutes: M, noUseMinutes: 98, smartphoneUseMinutes: 99 });
  const combined = computeSegmentWeight(seg).combined;
  const res = computeWSS([seg]);
  // 감점은 detected use(M) 로 계산되어야 한다(99 가 아님).
  assertClose('(a) rawScore uses detected use=M', res.rawScore, 100 - DEDUCTION_SCALE * combined * M);
  // usageRatio = use/walk = 2/100.
  assertClose('(a) usageRatio = use/walk', res.usageRatio, M / 100);
  // 위험지역 + use>0 -> 트리거 true.
  assert('(a) enteredHighRiskZoneWhileUsingPhone true', res.enteredHighRiskZoneWhileUsingPhone === true);
  // 밴드 집계에 use=M 반영.
  assert('(a) usageBands.confirmedUseMinutes=M', res.usageBands !== undefined && res.usageBands.confirmedUseMinutes === M, `${res.usageBands?.confirmedUseMinutes}`);
  // totalWalkMinutes = 세그먼트 walkMinutes 합(=100).
  assert('(a) totalWalkMinutes = sum of walkMinutes (100)', res.totalWalkMinutes === 100, `${res.totalWalkMinutes}`);
  // (e) 은퇴한 필드는 기록되지 않는다.
  assert('(a) measurementInsufficient undefined', res.measurementInsufficient === undefined, `${res.measurementInsufficient}`);
  assert('(a) unknownRatio undefined', res.unknownRatio === undefined, `${res.unknownRatio}`);
  // (f) estimated/unknown 밴드는 0.
  assert('(a) usageBands.estimatedUseMinutes=0', res.usageBands !== undefined && res.usageBands.estimatedUseMinutes === 0);
  assert('(a) usageBands.unknownUseMinutes=0', res.usageBands !== undefined && res.usageBands.unknownUseMinutes === 0);
  assert('(a) usageBands.noUseMinutes=98', res.usageBands !== undefined && res.usageBands.noUseMinutes === 98, `${res.usageBands?.noUseMinutes}`);
}

// (b) 레거시 세그먼트(confirmed 없음, smartphoneUseMinutes 만) -> 예전 rawScore 재현.
{
  const use = 1;
  const seg = baseSegment({ smartphoneUseMinutes: use }); // confirmedUseMinutes 미설정
  const combined = computeSegmentWeight(seg).combined;
  const res = computeWSS([seg]);
  // 하위호환: 옛 공식 100 - k*combined*use 그대로.
  assertClose('(b) legacy rawScore == old formula', res.rawScore, 100 - DEDUCTION_SCALE * combined * use);
  assertClose('(b) legacy usageRatio = use/walk', res.usageRatio, use / 100);
  // 레거시는 밴드 폴백으로 no-use 로 접힌다(감점 아님, 집계 표기용). unknown 은 0.
  assert('(b) legacy folds into noUse', res.usageBands !== undefined && res.usageBands.noUseMinutes === use, `${res.usageBands?.noUseMinutes}`);
  assert('(b) legacy unknownUse=0', res.usageBands !== undefined && res.usageBands.unknownUseMinutes === 0);
  assert('(b) measurementInsufficient undefined', res.measurementInsufficient === undefined);
}

// (c) confirmed=0(전 구간 no-use) -> 감점 없음(rawScore=100), usageRatio=0.
{
  const seg = baseSegment({ confirmedUseMinutes: 0, noUseMinutes: 100, walkMinutes: 100, smartphoneUseMinutes: 0 });
  const res = computeWSS([seg]);
  assertClose('(c) no use -> rawScore=100 (no deduction)', res.rawScore, 100);
  assertClose('(c) usageRatio = 0', res.usageRatio, 0);
  assert('(c) not entering risk-zone-use (use=0)', res.enteredHighRiskZoneWhileUsingPhone === false);
  assert('(c) measurementInsufficient undefined', res.measurementInsufficient === undefined);
  assert('(c) unknownRatio undefined', res.unknownRatio === undefined);
}

// (d) usageRatio>=0.3 -> penalty 경로. use=9, walk=10.
{
  const seg = baseSegment({ confirmedUseMinutes: 9, noUseMinutes: 1, walkMinutes: 10, smartphoneUseMinutes: 9 });
  const combined = computeSegmentWeight(seg).combined;
  const res = computeWSS([seg]);
  assertClose('(d) usageRatio = 9/10', res.usageRatio, 9 / 10);
  // usageRatio(0.9) >= 0.3 이므로 displayScore 는 penalty 경로를 타고 rawScore 이하여야 한다.
  const raw = 100 - DEDUCTION_SCALE * combined * 9;
  assertClose('(d) rawScore uses use=9', res.rawScore, Math.max(0, Math.min(100, raw)));
  assert('(d) displayScore <= rawScore (penalty applied)', res.displayScore <= res.rawScore, `disp=${res.displayScore} raw=${res.rawScore}`);
  // totalWalkMinutes = 세그먼트 walkMinutes 합(=10).
  assert('(d) totalWalkMinutes = sum of walkMinutes (10)', res.totalWalkMinutes === 10, `${res.totalWalkMinutes}`);
}

// (g) 여러 세그먼트의 walkMinutes 합이 totalWalkMinutes 에 정확히 반영되는지.
{
  const s1 = baseSegment({ confirmedUseMinutes: 0, noUseMinutes: 40, walkMinutes: 40, smartphoneUseMinutes: 0 });
  const s2 = baseSegment({ regionId: 'ref2', confirmedUseMinutes: 0, noUseMinutes: 60, walkMinutes: 60, smartphoneUseMinutes: 0 });
  const res = computeWSS([s1, s2]);
  assert('(g) totalWalkMinutes = 40+60 = 100', res.totalWalkMinutes === 100, `${res.totalWalkMinutes}`);
}

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
