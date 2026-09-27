// 사용 시간 집계 검증 스크립트 (FEAT-003: 자세 기반 use/no-use)
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-usage-classification.ts
//
// 배경: 사용 판정 소스가 인앱 터치(Option A - Step 1)에서 자세(보행 중 화면 보기)로 바뀌면서
// estimatedUse/unknownUse/'측정 불충분'(measurementSufficiency, UNKNOWN_RATIO_INSUFFICIENT_THRESHOLD)
// 및 구간 분류기 classifyInterval 은 은퇴했다. 이 스크립트는 남아 있는 순수 집계 표면을 검증한다:
//   - zeroUsageBands: 모두 0.
//   - computeUsageFromSegments: 세그먼트의 use(confirmedUse)/no-use 합산 + 레거시 폴백(no-use).
//   - usageBandsFromSegments: 리포트 표시용 4필드 UsageBands 로 매핑(estimated/unknown 은 항상 0).
// (자세 상태기계 자체와 그 경계/돌연변이 민감성은 scripts/verify-posture-usage.ts 가 검증한다.)
//
// 코어 파일과 동일한 로더 패턴을 위해 트랜스파일 훅을 등록한 뒤 동적 import 한다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const {
  zeroUsageBands,
  computeUsageFromSegments,
  usageBandsFromSegments,
} = await import('../src/session/usageClassification.ts');

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

// (0) zeroUsageBands 는 모두 0.
{
  const z = zeroUsageBands();
  assert('zeroUsageBands all zero',
    z.confirmedUseMinutes === 0 && z.estimatedUseMinutes === 0 && z.unknownUseMinutes === 0 && z.noUseMinutes === 0);
}

// (1) computeUsageFromSegments: use(confirmedUse)/no-use 합산.
{
  const totals = computeUsageFromSegments([
    { confirmedUseMinutes: 2, noUseMinutes: 8 },
    { confirmedUseMinutes: 1, noUseMinutes: 4 },
    { noUseMinutes: 5 }, // confirmed 없음 => 0 취급
  ]);
  assert('use 합=3', close(totals.confirmedUseMinutes, 3), `${totals.confirmedUseMinutes}`);
  assert('no-use 합=17', close(totals.noUseMinutes, 17), `${totals.noUseMinutes}`);
}

// (1b) 레거시 폴백: 밴드/no-use 필드 없음 + smartphoneUseMinutes>0 => no-use 로 접음(확정 사용 아님).
{
  const totals = computeUsageFromSegments([{ smartphoneUseMinutes: 6 }]);
  assert('레거시 smartphoneUseMinutes => no-use 로 접음', close(totals.confirmedUseMinutes, 0) && close(totals.noUseMinutes, 6));
}

// (1c) 밴드 필드가 있으면 smartphoneUseMinutes 는 무시(이중 계산 방지).
{
  const totals = computeUsageFromSegments([{ confirmedUseMinutes: 2, smartphoneUseMinutes: 99 }]);
  assert('밴드 존재 -> smartphoneUseMinutes 무시', close(totals.confirmedUseMinutes, 2) && close(totals.noUseMinutes, 0));
}

// (2) usageBandsFromSegments: 리포트용 4필드 매핑. use=confirmedUse, no-use=noUse,
//     estimated/unknown 은 항상 0(은퇴 개념).
{
  const bands = usageBandsFromSegments([
    { confirmedUseMinutes: 3, noUseMinutes: 7 },
    { confirmedUseMinutes: 2, noUseMinutes: 1 },
  ]);
  assert('bands.confirmedUseMinutes=5', close(bands.confirmedUseMinutes, 5), `${bands.confirmedUseMinutes}`);
  assert('bands.noUseMinutes=8', close(bands.noUseMinutes, 8), `${bands.noUseMinutes}`);
  assert('bands.estimatedUseMinutes=0 (은퇴)', bands.estimatedUseMinutes === 0);
  assert('bands.unknownUseMinutes=0 (은퇴)', bands.unknownUseMinutes === 0);
}

// (2b) usageBandsFromSegments 레거시 폴백: smartphoneUseMinutes -> no-use, use=0, unknown=0.
{
  const bands = usageBandsFromSegments([{ smartphoneUseMinutes: 4 }]);
  assert('legacy -> no-use=4', close(bands.noUseMinutes, 4));
  assert('legacy -> confirmed=0', bands.confirmedUseMinutes === 0);
  assert('legacy -> unknown=0 (더 이상 unknown 으로 접지 않음)', bands.unknownUseMinutes === 0);
}

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
