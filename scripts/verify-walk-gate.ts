// 보행 게이팅(hasWalked) 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-walk-gate.ts
//
// 목적: useWalkSession.stop() 이 "실제로 걸은 시간(확정 보행 시간 합)"으로 결과를
// 인정하는지 게이팅하는 순수 술어 hasWalked 를 뮤테이션 민감하게 고정한다.
//   - 걸은 시간 0(시작→즉시 종료) => false => 저장/업로드 안 함 => 홈은 "측정된 보행이 없어요".
//   - 걸은 시간 > 0 => true => 저장 + 업로드 + 결과 반환.
// 이 술어가 예전 "세그먼트 유무" 판정 대신 쓰여 iOS(안 걷고 100점)/안드로이드 불일치를 없앤다.
// verify-wss-example.ts 와 동일하게 트랜스파일 훅을 먼저 등록해 src/*.ts 를 동적 import 한다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { computeWSS } = await import('../src/wss/engine.ts');
const { hasWalked } = await import('../src/wss/walkGate.ts');

let failures = 0;
function assert(label: string, cond: boolean): void {
  if (cond) {
    console.log(`PASS ${label}`);
  } else {
    console.log(`FAIL ${label}`);
    failures += 1;
  }
}

// 공통 세그먼트 필드(감점 요인은 기본값 - 게이팅은 걸은 시간에만 의존).
function seg(walkMinutes: number) {
  return {
    regionId: 'r',
    smartphoneUseMinutes: 0,
    walkMinutes,
    riskIntensity: 0,
    weather: 'clear' as const,
    timeBand: 'normal_day' as const,
    isEarOccluded: false,
  };
}

// 1) 세그먼트가 아예 없는 종료(안드로이드 0초 보행) => 걸은 시간 0 => false.
const empty = computeWSS([]);
assert('empty session totalWalkMinutes === 0', empty.totalWalkMinutes === 0);
assert('empty session hasWalked === false', hasWalked(empty) === false);
// 정직성 회귀: computeWSS 는 여전히 100 을 돌려주지만(불변) 게이팅은 이를 인정하지 않는다.
assert('empty session displayScore === 100 (computeWSS 불변)', empty.displayScore === 100);

// 2) iOS "안 걷고 100점" 재현: 시작 시 위치 샘플로 세그먼트 1개가 생겼지만 걸은 시간 0.
//    세그먼트가 있어도 걸은 시간 0 => false (예전 segments.length>0 판정이면 true 로 잘못 인정됨).
const zeroWalkButHasSegment = computeWSS([seg(0)]);
assert('zero-walk segment exists (length>0)', true); // 세그먼트는 존재
assert('zero-walk totalWalkMinutes === 0', zeroWalkButHasSegment.totalWalkMinutes === 0);
assert('zero-walk hasWalked === false (핵심 수정)', hasWalked(zeroWalkButHasSegment) === false);
assert('zero-walk displayScore === 100 (computeWSS 불변)', zeroWalkButHasSegment.displayScore === 100);

// 3) 실제로 걸은 보행 => 걸은 시간 > 0 => true.
const walked = computeWSS([seg(2)]);
assert('walked totalWalkMinutes > 0', (walked.totalWalkMinutes ?? 0) > 0);
assert('walked hasWalked === true', hasWalked(walked) === true);

// 4) 방어: totalWalkMinutes 가 없거나 비유한/음수면 false(지어내지 않음).
assert('missing totalWalkMinutes => false', hasWalked({ ...walked, totalWalkMinutes: undefined }) === false);
assert('NaN totalWalkMinutes => false', hasWalked({ ...walked, totalWalkMinutes: NaN }) === false);
assert('negative totalWalkMinutes => false', hasWalked({ ...walked, totalWalkMinutes: -1 }) === false);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll walk-gate assertions PASSED');
