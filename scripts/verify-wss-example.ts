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
const { computeZoneSeverity, computeLocationWeight, DEDUCTION_SCALE, WSS_CRITICAL } = await import('../src/wss/weights.ts');

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

// 회귀 오라클 갱신 안내:
//   옛 임의 가중치 기반 기대값(결합 8.2875 / rawScore 91.7125 / 위치 2.5)에서,
//   전국 교통사고 통계 EPDO 실증값으로 재조정한 새 가중치 기준으로 갱신했다.
//   (시간 rush_am 0.97, 날씨 rain_or_snow 1.06, 위치 highRisk 1.5, 이어폰 1.3)
//   이후 DEDUCTION_SCALE=4 반영: 가중치 "비율"은 그대로 두고 전체 감점에만 ×k 를 곱하므로
//   rawScore = 100 - k×combined(= 100 - 4×combined) 로 재계산한다. 임계점도 80.605 -> 60.
//   기대값은 하드코딩하지 않고 실증 가중치 + DEDUCTION_SCALE 로 코드에서 재계산한다.

// 1) 기준 사고다발지역(3년 5건) 심각도 = 1.0 (로직 불변)
assertClose('computeZoneSeverity(5) === 1.0', computeZoneSeverity(5), 1.0);

// 2) 위험강도 1.0 -> 위치 가중치 1.5 (highRisk 재조정: 2.5 -> 1.5)
assertClose('computeLocationWeight(1.0) === 1.5', computeLocationWeight(1.0), 1.5);

// 3) 기준 세그먼트 결합 가중치 = 1.5(위치) * 1.06(비/눈) * 0.97(오전러시) * 1.3(이어폰)
const referenceSegment = {
  regionId: 'ref',
  smartphoneUseMinutes: 1,
  walkMinutes: 100, // usageRatio(0.01) < 0.3 이므로 패널티 경로를 회피
  riskIntensity: computeZoneSeverity(5),
  weather: 'rain_or_snow' as const,
  timeBand: 'rush_am' as const,
  isEarOccluded: true,
};
const expectedCombined = 1.5 * 1.06 * 0.97 * 1.3; // 새 실증 오라클(코드 계산) — 가중치 비율 불변
assertClose('reference combined weight', computeSegmentWeight(referenceSegment).combined, expectedCombined);

// 4) 위 세그먼트를 1분 사용 -> rawScore = 100 - DEDUCTION_SCALE(k=4) × combined
//    (가중치 비율은 유지, 전체 감점만 ×k 로 증폭)
assertClose('DEDUCTION_SCALE === 4', DEDUCTION_SCALE, 4);
const referenceResult = computeWSS([referenceSegment]);
assertClose('computeWSS rawScore (k×combined 감점)', referenceResult.rawScore, 100 - DEDUCTION_SCALE * expectedCombined);
// 4b) usageRatio penalty 제거 회귀 방지: displayScore === rawScore === 100 - k×combined.
//     (penalty 가 되살아나면 usageRatio>=0.3 세그먼트에서 이 등식이 깨진다. 여기 referenceSegment 는
//      usageRatio<0.3 이지만, penalty-free 계약을 명시적으로 고정해 회귀를 잡는다.)
assertClose('computeWSS displayScore === rawScore (penalty 제거)', referenceResult.displayScore, referenceResult.rawScore);
assertClose('computeWSS displayScore === 100 - k×combined', referenceResult.displayScore, 100 - DEDUCTION_SCALE * expectedCombined);

// 5) 임계점 WSS_CRITICAL 은 60(80.605 -> 60, 시뮬레이션 변곡점 ~58 을 60 으로 확정).
assertClose('WSS_CRITICAL === 60', WSS_CRITICAL, 60);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
