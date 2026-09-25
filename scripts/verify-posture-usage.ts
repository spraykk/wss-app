// 자세 기반 "보행 중 스마트폰 사용" 감지기 검증 스크립트 (FEAT-002)
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-posture-usage.ts
//
// 검증 대상(순수 함수/상수, src/sensors/postureUsageDetector.ts):
//  - 상수 PITCH_USE_THRESHOLD_DEG === 10, USE_SUSTAIN_MS === 3000 (돌연변이 민감).
//  - classifyPostureInterval:
//    (a) pitch>=10 을 3초 미만 유지(보행 중) => 전부 no-use.
//    (b) pitch>=10 을 3초 이상 유지(보행 중) => 3초 경과 후 구간은 use.
//    (c) walking=false 이면 pitch 가 높아도 no-use.
//    (d) 순간적 튐(한 샘플만 >=10 뒤 다시 <10) => 지속 리셋, 절대 use 아님.
//    (e) 경계값(nowMs-sustainedSinceMs == 3000) => use(>= 경계 포함).
//    (f) 센서 공백을 walking=false 로 시뮬레이션 => no-use.
//  - src/session/usageClassification.ts 의 computeUsageFromSegments 집계 헬퍼.
//
// 코어 파일과 동일한 로더 패턴을 위해 트랜스파일 훅을 등록한 뒤 동적 import 한다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const {
  PITCH_USE_THRESHOLD_DEG,
  USE_SUSTAIN_MS,
  createInitialPostureUsageState,
  classifyPostureInterval,
  isSustainedUse,
} = await import('../src/sensors/postureUsageDetector.ts');

const { computeUsageFromSegments } = await import('../src/session/usageClassification.ts');

const EPS = 1e-9;
let failures = 0;
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`PASS ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
    failures += 1;
  }
}
function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS;
}

// ── (g) 상수 값(돌연변이 민감) ───────────────────────────────────────────────
assert('PITCH_USE_THRESHOLD_DEG === 10', PITCH_USE_THRESHOLD_DEG === 10, String(PITCH_USE_THRESHOLD_DEG));
assert('USE_SUSTAIN_MS === 3000', USE_SUSTAIN_MS === 3000, String(USE_SUSTAIN_MS));

// ── (a) pitch>=10 을 3초 미만 유지(보행 중) => 전부 no-use ────────────────────
{
  let state = createInitialPostureUsageState();
  let useTotal = 0;
  let noUseTotal = 0;
  // t=0,1000,2000 ms (모두 3초 미만 유지). 매 구간 1분 귀속.
  for (const t of [0, 1000, 2000]) {
    const r = classifyPostureInterval(state, { pitchDeg: 20, walking: true, nowMs: t }, 1);
    state = r.next;
    useTotal += r.useMinutes;
    noUseTotal += r.noUseMinutes;
  }
  assert('3초 미만 유지 => use 0', close(useTotal, 0), `use=${useTotal}`);
  assert('3초 미만 유지 => no-use 전부(3)', close(noUseTotal, 3), `noUse=${noUseTotal}`);
}

// ── (b) pitch>=10 을 3초 이상 유지(보행 중) => 3초 경과 후 use ────────────────
{
  let state = createInitialPostureUsageState();
  // t=0: 시작(no-use), t=1000/2000: 램프업(no-use), t=3000: use 시작, t=4000: use.
  const seq = [0, 1000, 2000, 3000, 4000];
  const results = seq.map((t) => {
    const r = classifyPostureInterval(state, { pitchDeg: 25, walking: true, nowMs: t }, 1);
    state = r.next;
    return r;
  });
  assert('t<3000 램프업 구간은 no-use', results.slice(0, 3).every((r) => r.useMinutes === 0));
  assert('t=3000(경계) => use', results[3].useMinutes === 1, `use=${results[3].useMinutes}`);
  assert('t=4000 => use', results[4].useMinutes === 1, `use=${results[4].useMinutes}`);
}

// ── (c) walking=false 이면 pitch 가 높아도 no-use ────────────────────────────
{
  let state = createInitialPostureUsageState();
  // 높은 pitch 이지만 걷지 않음. 여러 구간 지나도 절대 use 아님.
  let useTotal = 0;
  for (const t of [0, 3000, 6000, 9000]) {
    const r = classifyPostureInterval(state, { pitchDeg: 40, walking: false, nowMs: t }, 1);
    state = r.next;
    useTotal += r.useMinutes;
    assert(`walking=false@${t} => sustained 리셋`, r.next.sustainedSinceMs === null);
  }
  assert('walking=false => use 0(고 pitch 무관)', close(useTotal, 0), `use=${useTotal}`);
}

// ── (d) 순간적 튐(한 샘플만 >=10 뒤 다시 <10) => 지속 리셋, 절대 use 아님 ─────
{
  let state = createInitialPostureUsageState();
  // 반복적으로 한 번 튀고 곧바로 내려가는 패턴을 길게 이어도 use 로 세면 안 된다.
  let useTotal = 0;
  const seq: Array<{ pitchDeg: number; nowMs: number }> = [];
  for (let i = 0; i < 6; i += 1) {
    seq.push({ pitchDeg: 30, nowMs: i * 2000 }); // 튐
    seq.push({ pitchDeg: 0, nowMs: i * 2000 + 1000 }); // 곧바로 내려감(리셋)
  }
  for (const s of seq) {
    const r = classifyPostureInterval(state, { pitchDeg: s.pitchDeg, walking: true, nowMs: s.nowMs }, 1);
    state = r.next;
    useTotal += r.useMinutes;
  }
  assert('순간 튐 반복 => use 0(3초 지속 도달 못함)', close(useTotal, 0), `use=${useTotal}`);
}

// ── (e) 경계값 정확히 3000ms => use (돌연변이 민감: 3000 이 바뀌면 실패) ───────
{
  const state = { sustainedSinceMs: 500 };
  // nowMs - sustainedSinceMs == 3000 정확히.
  const r = classifyPostureInterval(state, { pitchDeg: 15, walking: true, nowMs: 3500 }, 1);
  assert('경계 held==3000 => use(포함)', r.useMinutes === 1, `use=${r.useMinutes}`);
  // 경계 바로 아래(2999) => no-use.
  const r2 = classifyPostureInterval(state, { pitchDeg: 15, walking: true, nowMs: 3499 }, 1);
  assert('held==2999 => no-use', r2.useMinutes === 0 && close(r2.noUseMinutes, 1), `use=${r2.useMinutes}`);
}

// ── (돌연변이 민감: 10도 임계) pitch 가 정확히 10 이면 사용 후보, 9.999 면 아님 ─
{
  // 지속 시작이 충분히 과거(held>=3000)라면 pitch>=10 여부가 use 를 가른다.
  const state = { sustainedSinceMs: 0 };
  const rAt10 = classifyPostureInterval(state, { pitchDeg: 10, walking: true, nowMs: 5000 }, 1);
  assert('pitch==10(임계 포함) + 지속충족 => use', rAt10.useMinutes === 1, `use=${rAt10.useMinutes}`);
  const rBelow = classifyPostureInterval(state, { pitchDeg: 9.999, walking: true, nowMs: 5000 }, 1);
  assert('pitch<10 => no-use(지속 리셋)', rBelow.useMinutes === 0 && rBelow.next.sustainedSinceMs === null, `use=${rBelow.useMinutes}`);
}

// ── (f) 센서 공백을 walking=false 로 시뮬레이션 => no-use ─────────────────────
{
  let state = createInitialPostureUsageState();
  // 사용 지속 중이던 상태를 만들고(3초 도달), 이후 공백(walking=false)이 오면 no-use + 리셋.
  state = classifyPostureInterval(state, { pitchDeg: 20, walking: true, nowMs: 0 }, 1).next;
  const used = classifyPostureInterval(state, { pitchDeg: 20, walking: true, nowMs: 3000 }, 1);
  assert('공백 전: 3초 도달 use 확인', used.useMinutes === 1);
  state = used.next;
  // 센서 공백: walking=false.
  const gap = classifyPostureInterval(state, { pitchDeg: 20, walking: false, nowMs: 6000 }, 5);
  assert('센서 공백(walking=false) => no-use 전부', gap.useMinutes === 0 && close(gap.noUseMinutes, 5), `use=${gap.useMinutes}`);
  assert('센서 공백 후 지속 리셋', gap.next.sustainedSinceMs === null);
}

// ── 경과분 방어: 음수/비유한 elapsedMinutes 는 0 으로 취급 ───────────────────
{
  const state = { sustainedSinceMs: 0 };
  const rNeg = classifyPostureInterval(state, { pitchDeg: 20, walking: true, nowMs: 5000 }, -3);
  assert('음수 elapsedMinutes => use/no-use 모두 0', rNeg.useMinutes === 0 && rNeg.noUseMinutes === 0);
  const rNaN = classifyPostureInterval(state, { pitchDeg: 20, walking: true, nowMs: 5000 }, Number.NaN);
  assert('NaN elapsedMinutes => use/no-use 모두 0', rNaN.useMinutes === 0 && rNaN.noUseMinutes === 0);
}

// ── nowMs 비유한 => 지속 끊김, no-use ────────────────────────────────────────
{
  const state = { sustainedSinceMs: 0 };
  const r = classifyPostureInterval(state, { pitchDeg: 20, walking: true, nowMs: Number.NaN }, 2);
  assert('nowMs 비유한 => no-use + 리셋', r.useMinutes === 0 && close(r.noUseMinutes, 2) && r.next.sustainedSinceMs === null);
}

// ── 시계 되감김(rewind) => 보수적으로 지속 재시작, no-use ────────────────────
{
  const state = { sustainedSinceMs: 10000 };
  const r = classifyPostureInterval(state, { pitchDeg: 20, walking: true, nowMs: 2000 }, 1);
  assert('되감김 => 지속 재시작(now)', r.next.sustainedSinceMs === 2000, `since=${r.next.sustainedSinceMs}`);
  assert('되감김 구간은 no-use', r.useMinutes === 0 && close(r.noUseMinutes, 1));
}

// ── 순수성: 입력 상태를 변형하지 않는다 ─────────────────────────────────────
{
  const state = createInitialPostureUsageState();
  const snapshot = JSON.stringify(state);
  classifyPostureInterval(state, { pitchDeg: 20, walking: true, nowMs: 100 }, 1);
  assert('classifyPostureInterval 이 입력 상태를 변형하지 않음(순수)', JSON.stringify(state) === snapshot);
}

// ── isSustainedUse 헬퍼 직접 검증 ───────────────────────────────────────────
{
  assert('isSustainedUse: 지속 없음 => false', isSustainedUse({ sustainedSinceMs: null }, { pitchDeg: 20, walking: true, nowMs: 5000 }) === false);
  assert('isSustainedUse: held>=3000 => true', isSustainedUse({ sustainedSinceMs: 0 }, { pitchDeg: 20, walking: true, nowMs: 3000 }) === true);
  assert('isSustainedUse: held<3000 => false', isSustainedUse({ sustainedSinceMs: 0 }, { pitchDeg: 20, walking: true, nowMs: 2999 }) === false);
  assert('isSustainedUse: pitch<10 => false', isSustainedUse({ sustainedSinceMs: 0 }, { pitchDeg: 9, walking: true, nowMs: 9000 }) === false);
  assert('isSustainedUse: walking=false => false', isSustainedUse({ sustainedSinceMs: 0 }, { pitchDeg: 40, walking: false, nowMs: 9000 }) === false);
}

// ── computeUsageFromSegments 집계 헬퍼 검증 ─────────────────────────────────
{
  const totals = computeUsageFromSegments([
    { confirmedUseMinutes: 2, noUseMinutes: 8 },
    { confirmedUseMinutes: 1, noUseMinutes: 4 },
    { noUseMinutes: 5 }, // confirmed 없음 => 0 취급
  ]);
  assert('집계: confirmedUse 합=3', close(totals.confirmedUseMinutes, 3), `${totals.confirmedUseMinutes}`);
  assert('집계: noUse 합=17', close(totals.noUseMinutes, 17), `${totals.noUseMinutes}`);
}
{
  // 레거시 폴백: 밴드/no-use 필드 없음 + smartphoneUseMinutes>0 => no-use 로 접음(확정 사용 아님).
  const totals = computeUsageFromSegments([{ smartphoneUseMinutes: 6 }]);
  assert('레거시 smartphoneUseMinutes => no-use 로 접음', close(totals.confirmedUseMinutes, 0) && close(totals.noUseMinutes, 6));
}

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
