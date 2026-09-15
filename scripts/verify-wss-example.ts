// WSS 회귀 기준(regression oracle) 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-wss-example.ts
//
// 배경: 배포된 코어 파일(src/wss/*.ts, src/types.ts)은 리뷰 문서 그대로
// `import { TimeBand } from '../types'` 처럼 `type` 키워드 없이 타입 전용 이름을
// 모듈 간에 가져온다. Node 의 `--experimental-strip-types` 는 이런 import 문을
// 그대로 남겨두어 런타임에서 "does not provide an export" 오류가 난다.
// 그래서 코어 파일을 한 글자도 바꾸지 않고 실행하기 위해, tsc 로 각 .ts 모듈을
// 트랜스파일해서(타입 전용 import 를 정확히 제거) 제공하는 로더 훅을 먼저 등록한 뒤
// 동적 import 로 엔진을 불러온다. (동적 import 여야 훅 등록 이후 로딩된다.)
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { computeWSS, computeSegmentWeight } = await import('../src/wss/engine.ts');
const { computeZoneSeverity, computeLocationWeight } = await import('../src/wss/weights.ts');

const EPS = 1e-9;
let failures = 0;

function assertClose(label: string, actual: number, expected: number): void {
  const ok = Math.abs(actual - expected) <= EPS;
  if (ok) {
    console.log(`PASS ${label}: ${actual} ~= ${expected}`);
  } else {
    console.log(`FAIL ${label}: got ${actual}, expected ${expected}`);
    failures += 1;
  }
}

// 1) 기준 사고다발지역(3년 5건) 심각도 = 1.0
assertClose('computeZoneSeverity(5) === 1.0', computeZoneSeverity(5), 1.0);

// 2) 위험강도 1.0 -> 위치 가중치 2.5
assertClose('computeLocationWeight(1.0) === 2.5', computeLocationWeight(1.0), 2.5);

// 3) 기준 세그먼트 결합 가중치 = 2.5 * 1.7 * 1.3 * 1.5 = 8.2875
const referenceSegment = {
  regionId: 'ref',
  smartphoneUseMinutes: 1,
  walkMinutes: 100, // usageRatio(0.01) < 0.3 이므로 패널티 경로를 회피
  riskIntensity: computeZoneSeverity(5),
  weather: 'rain_or_snow' as const,
  timeBand: 'rush_am' as const,
  isEarOccluded: true,
};
assertClose('reference combined weight === 8.2875', computeSegmentWeight(referenceSegment).combined, 8.2875);

// 4) 위 세그먼트를 1분 사용 -> rawScore = 100 - 8.2875 = 91.7125
assertClose('computeWSS rawScore === 91.7125', computeWSS([referenceSegment]).rawScore, 91.7125);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
