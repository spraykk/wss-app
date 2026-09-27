// 이동수단 분류기(차량 탑승 오인 방지) 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-motion-classifier.ts
//
// 검증 대상(순수 함수, src/sensors/motionClassifier.ts):
//  - classifyMotion: 도보속도+걸음 => 'walking'
//  - 고속(>= VEHICLE_SPEED_MPS) => 'vehicle'
//  - 고속 후 쿨다운(VEHICLE_COOLDOWN_MS) 내 저속 => 'vehicle' 유지(신호대기 오인 방지)
//  - 쿨다운 후 도보속도+걸음복귀 => 'walking' 재개
//  - 걸음 없이 도보속도만 => 보행으로 인정하지 않음(idle)
//
// 다른 verify 스크립트와 동일하게 tsc 트랜스파일 로더 훅을 먼저 등록한 뒤 동적 import 한다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const {
  classifyMotion,
  createInitialMotionState,
  VEHICLE_SPEED_MPS,
  VEHICLE_COOLDOWN_MS,
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

// ── (1) 도보 속도 + 걸음 증가 => walking ─────────────────────────────────────
{
  let state = createInitialMotionState();
  // 첫 샘플: 이전 걸음 기준이 없으므로 걸음 증가 판단 보류 -> idle. 걸음 기준을 세운다.
  let r = classifyMotion(state, { speedMps: 1.4, stepCount: 100, nowMs: 0 });
  state = r.next;
  // 두 번째 샘플: 걸음이 증가하고 도보 속도 -> walking.
  r = classifyMotion(state, { speedMps: 1.4, stepCount: 102, nowMs: 1000 });
  state = r.next;
  assert('도보속도 + 걸음증가 => walking', r.mode === 'walking', r.mode);
}

// ── (2) 고속 => vehicle ──────────────────────────────────────────────────────
{
  const state = createInitialMotionState();
  const r = classifyMotion(state, { speedMps: VEHICLE_SPEED_MPS + 2, nowMs: 0 });
  assert('고속(>= VEHICLE_SPEED_MPS) => vehicle', r.mode === 'vehicle', `${VEHICLE_SPEED_MPS + 2} m/s -> ${r.mode}`);
}

// ── (3) 고속 후 쿨다운 내 저속(도보 속도) => vehicle 유지 ─────────────────────
{
  let state = createInitialMotionState();
  // 고속 관측(차량 진입).
  let r = classifyMotion(state, { speedMps: 8.0, nowMs: 0 });
  state = r.next;
  assert('고속 관측 시 vehicle 진입', r.mode === 'vehicle');
  // 쿨다운 내(예: 30초 후) 도보 속도 + 걸음 없음 => 신호대기로 보고 vehicle 유지.
  r = classifyMotion(state, { speedMps: 1.2, nowMs: 30000 });
  state = r.next;
  assert('쿨다운 내 저속(걸음없음) => vehicle 유지', r.mode === 'vehicle', `at 30s(<${VEHICLE_COOLDOWN_MS}ms) -> ${r.mode}`);
  // 쿨다운 내 도보 속도라도 걸음 증가가 없으면(정체 중 차 흔들림) 계속 vehicle.
  r = classifyMotion(state, { speedMps: 2.0, stepCount: 500, nowMs: 45000 });
  state = r.next;
  // stepCount 첫 등장(이전 걸음 null) -> 증가 판단 보류 -> 걸음 조건 불충족 -> vehicle 유지.
  assert('쿨다운 내 걸음기준만 세움 => vehicle 유지', r.mode === 'vehicle', r.mode);
}

// ── (4) 쿨다운 후 도보속도 + 걸음복귀 => walking 재개 ────────────────────────
{
  let state = createInitialMotionState();
  // 고속 관측.
  let r = classifyMotion(state, { speedMps: 10.0, stepCount: 200, nowMs: 0 });
  state = r.next;
  assert('고속 관측 시 vehicle', r.mode === 'vehicle');
  // 쿨다운 경과(60초 이상) 후 도보 속도 + 걸음 증가 => walking.
  const afterCooldown = VEHICLE_COOLDOWN_MS + 5000;
  r = classifyMotion(state, { speedMps: 1.3, stepCount: 205, nowMs: afterCooldown });
  state = r.next;
  assert('쿨다운 후 도보속도+걸음증가 => walking 재개', r.mode === 'walking', `at ${afterCooldown}ms -> ${r.mode}`);
}

// ── (4b) 쿨다운 내라도 확실한 보행(도보속도+걸음증가)이면 조기 복귀 ──────────
{
  let state = createInitialMotionState();
  let r = classifyMotion(state, { speedMps: 9.0, stepCount: 10, nowMs: 0 });
  state = r.next; // vehicle
  // 쿨다운 내(20초)에 도보 속도 + 걸음 증가 관측 => 조기 walking 복귀.
  r = classifyMotion(state, { speedMps: 1.5, stepCount: 14, nowMs: 20000 });
  state = r.next;
  assert('쿨다운 내 확실한 보행 => 조기 walking 복귀', r.mode === 'walking', r.mode);
}

// ── (5) 걸음 없이 도보 속도만 => 보행 인정 안 함(idle) ───────────────────────
{
  let state = createInitialMotionState();
  // 걸음 기준을 세운다(첫 등장).
  let r = classifyMotion(state, { speedMps: 1.4, stepCount: 0, nowMs: 0 });
  state = r.next;
  // 도보 속도지만 걸음 증가 없음 => idle.
  r = classifyMotion(state, { speedMps: 1.4, stepCount: 0, nowMs: 1000 });
  state = r.next;
  assert('걸음 없이 도보속도만 => idle', r.mode === 'idle', r.mode);
}

// ── (6) 걸음 정보가 아예 없으면 속도만으로 보행 인정(하위호환) ───────────────
{
  const state = createInitialMotionState();
  const r = classifyMotion(state, { speedMps: 1.4, nowMs: 0 });
  assert('걸음 정보 없음 + 도보속도 => walking(속도만 판정)', r.mode === 'walking', r.mode);
}

// ── (7) 정지에 가까운 저속(도보 하한 미만) => idle ──────────────────────────
{
  const state = createInitialMotionState();
  const r = classifyMotion(state, { speedMps: 0.1, nowMs: 0 });
  assert('도보 하한 미만 저속 => idle', r.mode === 'idle', r.mode);
}

// ── (8) 도보 상한 초과이지만 차량 임계 미만(예: 뛰기) => idle(보행 아님) ─────
{
  const state = createInitialMotionState();
  const midSpeed = (WALK_MAX_SPEED_MPS + VEHICLE_SPEED_MPS) / 2;
  const r = classifyMotion(state, { speedMps: midSpeed, nowMs: 0 });
  assert('도보 상한~차량 임계 사이 => idle(보행/차량 어느 쪽도 아님)', r.mode === 'idle', `${midSpeed.toFixed(2)} m/s -> ${r.mode}`);
}

// ── (9) 순수성: 입력 상태를 변형하지 않는다 ─────────────────────────────────
{
  const state = createInitialMotionState();
  const snapshot = JSON.stringify(state);
  classifyMotion(state, { speedMps: 9.0, stepCount: 3, nowMs: 100 });
  assert('classifyMotion 이 입력 상태를 변형하지 않음(순수)', JSON.stringify(state) === snapshot);
}

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
