// 위치 샘플 "보행 결정" 헬퍼 검증 스크립트 (핵심 결함 수정: 정지(idle) 무감점)
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-location-walking.ts
//
// 검증 대상(순수 함수, src/sensors/motionClassifier.ts):
//  - decideLocationWalking: classifyMotion 의 walking/idle/vehicle 를 그대로 얻어
//    (skipAsVehicle, walking) 를 결정한다.
//    · walking(확정 보행) => skipAsVehicle=false, walking=true  (자세 기반 사용 감점 후보)
//    · idle(정지/신호대기) => skipAsVehicle=false, walking=false (감점 안 함: no-use)
//    · vehicle(차량)        => skipAsVehicle=true,  walking=false (세그먼트 미누적)
//  - 속도 결측(null/undefined/음수/비유한) 처리 · 히스테리시스:
//    · 직전이 walking 이면 단발 결측은 walking 유지, 아니면 walking=false(보수적)
//    · 속도 결측 시 분류기 상태(next)를 흔들지 않는다(next===prev)
//
// [정직성] 이 테스트는 "정지 상태가 감점되던 결함"의 회귀를 막는다. mutation 민감:
//  - decideLocationWalking 이 idle 을 walking=true 로 돌리면 assert 실패(정지 감점 회귀).
//  - 속도 결측을 무조건 walking=true 로 돌리면 assert 실패(확정 안 된 보행 감점 회귀).
//
// 다른 verify 스크립트와 동일하게 tsc 트랜스파일 로더 훅을 먼저 등록한 뒤 동적 import 한다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const {
  decideLocationWalking,
  createInitialMotionState,
  classifyMotion,
  VEHICLE_SPEED_MPS,
  WALK_MIN_SPEED_MPS,
  WALK_MAX_SPEED_MPS,
} = await import('../src/sensors/motionClassifier.ts');

let failures = 0;
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`PASS ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
    failures += 1;
  }
}

// ── (1) 확정 보행(도보 속도, 걸음 정보 없음 => 속도만으로 walking) ───────────
{
  const state = createInitialMotionState();
  const walkSpeed = (WALK_MIN_SPEED_MPS + WALK_MAX_SPEED_MPS) / 2;
  const d = decideLocationWalking(state, walkSpeed, 0);
  assert('walking: mode=walking', d.mode === 'walking', d.mode);
  assert('walking: skipAsVehicle=false', d.skipAsVehicle === false);
  assert('walking: walking=true', d.walking === true);
}

// ── (2) 정지(idle, 속도≈0) => 감점 안 함(walking=false), 스킵 안 함 ──────────
// 사용자 증상 회귀 방지: "가만히 서서 폰 켜놓기만 했는데 점수 떨어짐".
{
  const state = createInitialMotionState();
  const d = decideLocationWalking(state, 0, 0);
  assert('idle: mode=idle', d.mode === 'idle', `0 m/s -> ${d.mode}`);
  assert('idle: skipAsVehicle=false(위치/위험구역 로직은 계속)', d.skipAsVehicle === false);
  assert('idle: walking=false(감점 안 함)', d.walking === false);
}

// ── (2b) 도보 하한 미만 저속(정지에 가까움) => idle => walking=false ─────────
{
  const state = createInitialMotionState();
  const d = decideLocationWalking(state, WALK_MIN_SPEED_MPS / 2, 0);
  assert('저속(도보 하한 미만): idle, walking=false', d.mode === 'idle' && d.walking === false, `${(WALK_MIN_SPEED_MPS / 2).toFixed(2)} m/s`);
}

// ── (3) 차량(고속) => 스킵, walking=false ───────────────────────────────────
{
  const state = createInitialMotionState();
  const d = decideLocationWalking(state, VEHICLE_SPEED_MPS + 3, 0);
  assert('vehicle: mode=vehicle', d.mode === 'vehicle', `${VEHICLE_SPEED_MPS + 3} m/s`);
  assert('vehicle: skipAsVehicle=true(세그먼트 미누적)', d.skipAsVehicle === true);
  assert('vehicle: walking=false', d.walking === false);
}

// ── (4) 속도 결측: 직전이 walking 이 아니면 walking=false, 상태 불변 ─────────
{
  const state = createInitialMotionState(); // mode='idle'
  const snapshot = JSON.stringify(state);
  for (const missing of [null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const d = decideLocationWalking(state, missing as number | null | undefined, 100);
    assert(`속도 결측(${String(missing)}) + 직전 비보행 => walking=false`, d.walking === false, d.mode);
    assert(`속도 결측(${String(missing)}) => 상태 불변(next===prev)`, d.next === state);
  }
  assert('속도 결측 처리 후 입력 상태 원형 유지(순수)', JSON.stringify(state) === snapshot);
}

// ── (5) 속도 결측 히스테리시스: 직전이 walking 이면 단발 결측은 walking 유지 ─
{
  let state = createInitialMotionState();
  const walkSpeed = (WALK_MIN_SPEED_MPS + WALK_MAX_SPEED_MPS) / 2;
  // 먼저 확정 보행으로 상태를 walking 으로 만든다.
  const d1 = decideLocationWalking(state, walkSpeed, 0);
  state = d1.next;
  assert('선행: walking 상태 확립', state.mode === 'walking');
  // 다음 샘플이 속도 결측이면 직전 walking 을 유지(히스테리시스).
  const d2 = decideLocationWalking(state, null, 1000);
  assert('속도 결측 + 직전 walking => walking 유지(히스테리시스)', d2.walking === true, d2.mode);
  assert('속도 결측 히스테리시스도 상태 불변(next===prev)', d2.next === state);
}

// ── (6) next 상태가 classifyMotion 과 일관(속도 있는 경우 위임 정합성) ──────
{
  const state = createInitialMotionState();
  const walkSpeed = (WALK_MIN_SPEED_MPS + WALK_MAX_SPEED_MPS) / 2;
  const d = decideLocationWalking(state, walkSpeed, 0);
  const c = classifyMotion(state, { speedMps: walkSpeed, nowMs: 0 });
  assert('속도 있는 경우 mode 가 classifyMotion 과 동일', d.mode === c.mode, `${d.mode} vs ${c.mode}`);
  assert('속도 있는 경우 next 가 classifyMotion.next 와 동일', JSON.stringify(d.next) === JSON.stringify(c.next));
}

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
