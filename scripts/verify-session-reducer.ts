// 세션 리듀서 누적/분할 검증 스크립트 (FEAT-004)
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-session-reducer.ts
//
// src/session/sessionReducer.ts 의 순수 상태전이가 기존 useWalkSession.ingestSample 의
// 세그먼트 누적 규칙과 동일함을 검증한다:
//   - 같은 안정화 키(buildSegmentKey) -> 마지막 세그먼트에 누적(과분할 방지, 버그 #1 계승).
//   - 키가 바뀌면 -> 새 세그먼트 시작.
// riskIntensity 버킷(0.25) 내 노이즈는 같은 세그먼트로 흡수되고, 버킷을 넘으면 분할된다.
//
// 코어 파일과 동일한 로더 패턴을 위해 트랜스파일 훅을 등록한 뒤 동적 import 한다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { initialSessionState, reduceSession } = await import('../src/session/sessionReducer.ts');

let failures = 0;
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`PASS ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
    failures += 1;
  }
}

// 공용 맥락(같은 zone/날씨/시간대/차음) - riskIntensity 만 바꿔 버킷 동작을 본다.
const resolved = { timeBand: 'normal_day' as const, isEarOccluded: false };
function sample(riskIntensity: number, use: number, walk: number, zoneId = 'zone-A') {
  return {
    zoneId,
    riskIntensity,
    weather: 'clear' as const,
    smartphoneUseMinutes: use,
    walkMinutes: walk,
  };
}

// (1) 같은 버킷(1.00, 1.02, 1.10)의 연속 샘플 -> 세그먼트 1개, 값 누적.
{
  let state = initialSessionState();
  state = reduceSession(state, sample(1.0, 1, 1), resolved);
  state = reduceSession(state, sample(1.02, 2, 2), resolved);
  state = reduceSession(state, sample(1.1, 3, 3), resolved);
  assert('같은 버킷 연속 3샘플 -> 세그먼트 1개', state.segments.length === 1, `len=${state.segments.length}`);
  const s = state.segments[0];
  assert('누적 smartphoneUseMinutes === 6', s.smartphoneUseMinutes === 6, `${s.smartphoneUseMinutes}`);
  assert('누적 walkMinutes === 6', s.walkMinutes === 6, `${s.walkMinutes}`);
}

// (2) 버킷을 넘는 변화(1.00 -> 1.40) -> 새 세그먼트로 분할.
{
  let state = initialSessionState();
  state = reduceSession(state, sample(1.0, 1, 1), resolved);
  state = reduceSession(state, sample(1.4, 1, 1), resolved);
  assert('버킷 초과 -> 세그먼트 2개', state.segments.length === 2, `len=${state.segments.length}`);
  assert('첫 세그먼트 riskIntensity 보존', state.segments[0].riskIntensity === 1.0, `${state.segments[0].riskIntensity}`);
  assert('둘째 세그먼트 riskIntensity 보존', state.segments[1].riskIntensity === 1.4, `${state.segments[1].riskIntensity}`);
}

// (3) 다른 zone -> 같은 riskIntensity 라도 새 세그먼트(물리적 분리).
{
  let state = initialSessionState();
  state = reduceSession(state, sample(1.0, 1, 1, 'zone-A'), resolved);
  state = reduceSession(state, sample(1.0, 1, 1, 'zone-B'), resolved);
  assert('다른 zone -> 세그먼트 2개', state.segments.length === 2, `len=${state.segments.length}`);
}

// (4) 차음 여부(isEarOccluded) 변화 -> 키가 바뀌어 새 세그먼트.
{
  let state = initialSessionState();
  state = reduceSession(state, sample(1.0, 1, 1), { timeBand: 'normal_day', isEarOccluded: false });
  state = reduceSession(state, sample(1.0, 1, 1), { timeBand: 'normal_day', isEarOccluded: true });
  assert('차음 상태 변화 -> 세그먼트 2개', state.segments.length === 2, `len=${state.segments.length}`);
  assert('둘째 세그먼트 isEarOccluded=true', state.segments[1].isEarOccluded === true, `${state.segments[1].isEarOccluded}`);
}

// (5) 입력 state 불변성(순수성): reduceSession 이 이전 state 를 변형하지 않는다.
{
  const prev = initialSessionState();
  const next = reduceSession(prev, sample(1.0, 1, 1), resolved);
  assert('이전 state 불변(세그먼트 0개 유지)', prev.segments.length === 0, `prev.len=${prev.segments.length}`);
  assert('다음 state 는 세그먼트 1개', next.segments.length === 1, `next.len=${next.segments.length}`);
}

// (6) "1분씩 60샘플, 같은 맥락" -> 세그먼트 1개, walk 60분(과분할 방지 미러).
{
  let state = initialSessionState();
  for (let i = 0; i < 60; i += 1) {
    // GPS 노이즈로 riskIntensity 가 미세하게 흔들려도 같은 버킷이면 1개로 유지되어야 한다.
    const noise = 1.0 + (i % 5) * 0.01; // 1.00~1.04, 모두 1.0 버킷
    state = reduceSession(state, sample(noise, 1, 1), resolved);
  }
  assert('60샘플 같은 버킷 -> 세그먼트 1개(과분할 방지)', state.segments.length === 1, `len=${state.segments.length}`);
  assert('총 walkMinutes === 60', state.segments[0].walkMinutes === 60, `${state.segments[0].walkMinutes}`);
}

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
