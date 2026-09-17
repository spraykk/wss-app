// 세그먼트 키 안정화(버그 #1) 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-segment-key.ts
//
// src/hooks/segmentKey.ts 는 타입 전용 import 를 `import type` 으로 쓰므로
// `--experimental-strip-types` 로 바로 실행되지만, 코어 파일과 동일한 패턴을
// 유지하기 위해 트랜스파일 훅을 등록한 뒤 동적 import 한다(안전).
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { buildSegmentKey, bucketizeRiskIntensity, RISK_INTENSITY_BUCKET } = await import(
  '../src/hooks/segmentKey.ts'
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

const base = {
  zoneId: 'zone-A',
  weather: 'clear' as const,
  timeBand: 'normal_day' as const,
  isEarOccluded: false,
};

// (1) GPS 노이즈 수준(같은 0.25 버킷 안)의 riskIntensity 변화는 같은 키.
const keyLow = buildSegmentKey({ ...base, riskIntensity: 1.0 });
const keyNoise = buildSegmentKey({ ...base, riskIntensity: 1.02 });
assert(
  '버킷 내 노이즈(1.00 vs 1.02) -> 같은 키',
  keyLow === keyNoise,
  `${keyLow} === ${keyNoise}`
);

// 경계 근처 추가 확인: 1.10, 1.12 도 같은 버킷(1.0~1.125 -> 1.0)이므로 동일.
const keyA = buildSegmentKey({ ...base, riskIntensity: 1.1 });
const keyB = buildSegmentKey({ ...base, riskIntensity: 1.12 });
assert('버킷 내(1.10 vs 1.12) -> 같은 키', keyA === keyB, `${keyA} === ${keyB}`);

// (2) 버킷을 넘는 변화(1.00 vs 1.40)는 다른 키.
const keyFar = buildSegmentKey({ ...base, riskIntensity: 1.4 });
assert(
  '버킷 초과(1.00 vs 1.40) -> 다른 키',
  keyLow !== keyFar,
  `${keyLow} !== ${keyFar}`
);

// (3) bucketize 자체의 순수 동작 확인.
assert('RISK_INTENSITY_BUCKET === 0.25', RISK_INTENSITY_BUCKET === 0.25, `${RISK_INTENSITY_BUCKET}`);
assert('bucketize(1.02) === 1.0', bucketizeRiskIntensity(1.02) === 1.0, `${bucketizeRiskIntensity(1.02)}`);
assert('bucketize(1.40) === 1.5', bucketizeRiskIntensity(1.4) === 1.5, `${bucketizeRiskIntensity(1.4)}`);
assert('bucketize(1.13) === 1.25', bucketizeRiskIntensity(1.13) === 1.25, `${bucketizeRiskIntensity(1.13)}`);

// (4) 대표 zone id 가 다르면(물리적으로 다른 지역) 같은 버킷이라도 다른 키.
const keyZoneA = buildSegmentKey({ ...base, riskIntensity: 1.0, zoneId: 'zone-A' });
const keyZoneB = buildSegmentKey({ ...base, riskIntensity: 1.0, zoneId: 'zone-B' });
assert('zone id 가 다르면 다른 키', keyZoneA !== keyZoneB, `${keyZoneA} !== ${keyZoneB}`);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
