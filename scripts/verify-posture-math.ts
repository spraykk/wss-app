// 자세(각도) 측정 순수 수학 모듈 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-posture-math.ts
//
// 검증 대상(순수 함수, src/sensors/postureMath.ts):
//  - gravityToPitchRoll: 대표 자세(수평/수직/45도/좌우 눕힘)의 pitch/roll 각도 계산
//  - summarizeAxis / summarizePosture: 요약 통계(개수, min/max/mean/median)
//
// 다른 verify 스크립트와 동일하게 tsc 트랜스파일 로더 훅을 먼저 등록한 뒤 동적 import 한다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { gravityToPitchRoll, summarizeAxis, summarizePosture } = await import(
  '../src/sensors/postureMath.ts'
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

// 부동소수 비교용 근사 동등(허용오차 0.5도).
function approx(a: number, b: number, tol: number = 0.5): boolean {
  return Math.abs(a - b) <= tol;
}

const SQRT_HALF = Math.SQRT1_2; // 0.7071...

// ── (1) 화면 위로 평평(수평): g≈(0,0,-1) => pitch≈0, roll≈0 ─────────────────
{
  const r = gravityToPitchRoll({ x: 0, y: 0, z: -1 });
  assert('수평(화면 위) => pitch≈0', approx(r.pitchDeg, 0), `pitch=${r.pitchDeg.toFixed(2)}`);
  assert('수평(화면 위) => roll≈0', approx(r.rollDeg, 0), `roll=${r.rollDeg.toFixed(2)}`);
}

// ── (2) 세로로 똑바로 세움(위쪽이 하늘): g≈(0,-1,0) => pitch≈+90 ─────────────
{
  const r = gravityToPitchRoll({ x: 0, y: -1, z: 0 });
  assert('수직으로 세움 => pitch≈+90', approx(r.pitchDeg, 90), `pitch=${r.pitchDeg.toFixed(2)}`);
}

// ── (3) 얼굴 앞 45도로 기울임: g≈(0,-0.707,-0.707) => pitch≈+45 ─────────────
{
  const r = gravityToPitchRoll({ x: 0, y: -SQRT_HALF, z: -SQRT_HALF });
  assert('얼굴 앞 45도 => pitch≈+45', approx(r.pitchDeg, 45), `pitch=${r.pitchDeg.toFixed(2)}`);
  assert('얼굴 앞 45도 => roll≈0', approx(r.rollDeg, 0), `roll=${r.rollDeg.toFixed(2)}`);
}

// ── (4) 좌로 90도 눕힘: g≈(1,0,0) => roll≈+90 ───────────────────────────────
{
  const r = gravityToPitchRoll({ x: 1, y: 0, z: 0 });
  assert('좌로 90도 눕힘 => roll≈+90', approx(r.rollDeg, 90), `roll=${r.rollDeg.toFixed(2)}`);
  assert('좌로 90도 눕힘 => pitch≈0', approx(r.pitchDeg, 0), `pitch=${r.pitchDeg.toFixed(2)}`);
}

// ── (5) 우로 90도 눕힘: g≈(-1,0,0) => roll≈-90 ──────────────────────────────
{
  const r = gravityToPitchRoll({ x: -1, y: 0, z: 0 });
  assert('우로 90도 눕힘 => roll≈-90', approx(r.rollDeg, -90), `roll=${r.rollDeg.toFixed(2)}`);
}

// ── (6) summarizeAxis: min/max/mean/median (홀수 개) ────────────────────────
{
  const s = summarizeAxis([10, 20, 30]);
  assert('축요약 min=10', s.min === 10, String(s.min));
  assert('축요약 max=30', s.max === 30, String(s.max));
  assert('축요약 mean=20', approx(s.mean, 20, 1e-9), String(s.mean));
  assert('축요약 median(홀수)=20', s.median === 20, String(s.median));
}

// ── (7) summarizeAxis: median (짝수 개 => 가운데 두 값 평균) ─────────────────
{
  const s = summarizeAxis([10, 20, 30, 40]);
  assert('축요약 median(짝수)=25', s.median === 25, String(s.median));
  assert('축요약 min=10 max=40', s.min === 10 && s.max === 40);
}

// ── (8) summarizeAxis: 정렬 안 된 입력도 정확한 median ───────────────────────
{
  const s = summarizeAxis([30, 10, 20]);
  assert('비정렬 입력 median=20', s.median === 20, String(s.median));
  assert('비정렬 입력 min=10 max=30', s.min === 10 && s.max === 30);
}

// ── (9) summarizeAxis 가 입력 배열을 변형하지 않음(순수) ─────────────────────
{
  const input = [30, 10, 20];
  const snapshot = JSON.stringify(input);
  summarizeAxis(input);
  assert('summarizeAxis 순수(입력 불변)', JSON.stringify(input) === snapshot);
}

// ── (10) summarizePosture: pitch/roll 동시 요약 + count ─────────────────────
{
  const s = summarizePosture([0, 45, 90], [-10, 0, 10]);
  assert('포스처요약 count=3', s.count === 3, String(s.count));
  assert('포스처요약 pitch.mean=45', approx(s.pitch.mean, 45, 1e-9), String(s.pitch.mean));
  assert('포스처요약 pitch.median=45', s.pitch.median === 45, String(s.pitch.median));
  assert('포스처요약 roll.min=-10', s.roll.min === -10, String(s.roll.min));
  assert('포스처요약 roll.max=10', s.roll.max === 10, String(s.roll.max));
}

// ── (11) summarizePosture: 길이 다르면 짧은 쪽 기준(방어적) ─────────────────
{
  const s = summarizePosture([1, 2, 3, 4], [5, 6]);
  assert('길이 불일치 => count=짧은쪽(2)', s.count === 2, String(s.count));
  assert('길이 불일치 => pitch.max=2', s.pitch.max === 2, String(s.pitch.max));
}

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
