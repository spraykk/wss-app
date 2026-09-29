// 좌표 기반 속도 폴백(안드로이드 speed 결측/0 대응) 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-derived-speed.ts
//
// 배경(버그): 안드로이드 Accuracy.Balanced 위치 모드는 이동 중에도 coords.speed 를
// null/undefined/음수(결측) 또는 정확히 0 으로 주는 경우가 잦다. 분류가 speed 하나에만
// 의존했기에 walking 이 계속 false 로 수렴 -> 보행 시간(walkMinutes)이 전혀 안 쌓였다.
// 이 수정은 좌표(위경도)+시각으로 지상 속도를 직접 유도해 폴백으로 쓴다(iOS 처럼 speed 가
// 양수로 오면 그대로 신뢰하므로 iOS 동작 불변).
//
// 여기서는 순수 함수들의 계약을 검증한다:
//   haversineMeters / deriveSpeedFromCoords / isReportedSpeedTrustworthy / resolveEffectiveSpeed
// 그리고 "안드로이드 speed=0 인데 실제로 걷는" 시나리오가 walking 으로 복구되는지 확인한다
// (decideLocationWalking + resolveEffectiveSpeed 결합).
import {
  haversineMeters,
  deriveSpeedFromCoords,
  isReportedSpeedTrustworthy,
  resolveEffectiveSpeed,
  decideLocationWalking,
  createInitialMotionState,
  MIN_DERIVED_SPEED_INTERVAL_MS,
  MAX_DERIVED_SPEED_INTERVAL_MS,
} from '../src/sensors/motionClassifier.ts';

let failures = 0;
function assert(label: string, cond: boolean): void {
  if (cond) {
    console.log(`PASS ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL ${label}`);
  }
}
function approx(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

// ── haversineMeters ──────────────────────────────────────────────────────────
// 같은 점은 0m.
assert('haversine same point = 0m', haversineMeters(37.5, 127.0, 37.5, 127.0) === 0);
// 위도 0.001도 차이 ≈ 111.1m (위도 1도 ≈ 111.2km).
assert(
  'haversine ~111m for 0.001 deg lat',
  approx(haversineMeters(37.5, 127.0, 37.501, 127.0), 111.2, 3)
);

// ── isReportedSpeedTrustworthy ───────────────────────────────────────────────
// 안드로이드 결측/0 은 신뢰 불가. 양수만 신뢰.
assert('speed null not trustworthy', isReportedSpeedTrustworthy(null) === false);
assert('speed undefined not trustworthy', isReportedSpeedTrustworthy(undefined) === false);
assert('speed 0 not trustworthy (android)', isReportedSpeedTrustworthy(0) === false);
assert('speed -1 not trustworthy', isReportedSpeedTrustworthy(-1) === false);
assert('speed 1.2 trustworthy', isReportedSpeedTrustworthy(1.2) === true);

// ── deriveSpeedFromCoords ────────────────────────────────────────────────────
// 이전 좌표 없으면 null.
assert('derive null when no prev', deriveSpeedFromCoords(null, { latitude: 37.5, longitude: 127, atMs: 1000 }) === null);
// 5초 동안 약 6.9m 이동(0.001도 위도의 절반 정도) -> 도보 속도(약 1.1~1.4 m/s)로 유도.
{
  const prev = { latitude: 37.5, longitude: 127.0, atMs: 0 };
  const curr = { latitude: 37.50006, longitude: 127.0, atMs: 5000 }; // ~6.67m in 5s ≈ 1.33 m/s
  const s = deriveSpeedFromCoords(prev, curr);
  assert('derive ~1.33 m/s walking pace', s !== null && approx(s, 1.33, 0.3));
}
// 간격이 너무 짧으면(<1초) 지터 방지로 null.
{
  const prev = { latitude: 37.5, longitude: 127.0, atMs: 0 };
  const curr = { latitude: 37.50006, longitude: 127.0, atMs: 500 };
  assert('derive null when interval < min', deriveSpeedFromCoords(prev, curr) === null);
}
// 간격이 너무 길면(>30초) 왜곡 방지로 null.
{
  const prev = { latitude: 37.5, longitude: 127.0, atMs: 0 };
  const curr = { latitude: 37.50006, longitude: 127.0, atMs: MAX_DERIVED_SPEED_INTERVAL_MS + 1 };
  assert('derive null when interval > max', deriveSpeedFromCoords(prev, curr) === null);
}

// ── resolveEffectiveSpeed (핵심: GPS speed 우선, 아니면 유도 속도 폴백) ─────────
assert('resolve prefers trustworthy reported', resolveEffectiveSpeed(1.5, 0.2) === 1.5);
assert('resolve falls back to derived when reported=0', resolveEffectiveSpeed(0, 1.3) === 1.3);
assert('resolve falls back to derived when reported=null', resolveEffectiveSpeed(null, 1.3) === 1.3);
assert('resolve null when both missing', resolveEffectiveSpeed(null, null) === null);

// ── 통합 시나리오: "안드로이드 speed=0 인데 실제로 걷는 중" -> walking 복구 ──────
// 예전엔 speed=0 -> idle -> walkMinutes=0 이었다. 이제 유도 속도(도보)로 walking 이 잡혀야 한다.
{
  let state = createInitialMotionState();
  const reported = 0; // 안드로이드가 이동 중에도 0 을 줌
  const derived = 1.3; // 좌표에서 유도한 도보 속도
  const effective = resolveEffectiveSpeed(reported, derived);
  const decision = decideLocationWalking(state, effective, 5000);
  assert('android speed=0 + derived walking pace => walking=true', decision.walking === true);
  assert('android speed=0 + derived walking pace => not skipped', decision.skipAsVehicle === false);
}
// 대조군: speed 도 0 이고 유도도 불가(정지) -> idle 유지(walking=false). 정지 중 오탐 없어야 함.
{
  const state = createInitialMotionState();
  const effective = resolveEffectiveSpeed(0, null);
  const decision = decideLocationWalking(state, effective, 5000);
  assert('truly stationary (no reported, no derived) => walking=false', decision.walking === false);
}

if (failures === 0) {
  console.log(`\nAll derived-speed checks passed. (MIN=${MIN_DERIVED_SPEED_INTERVAL_MS}ms MAX=${MAX_DERIVED_SPEED_INTERVAL_MS}ms)`);
  process.exit(0);
} else {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
