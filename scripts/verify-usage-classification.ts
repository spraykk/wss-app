// 증거 밴드 분류/집계/충분성 검증 스크립트 (FEAT-002, Option A - Step 1)
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-usage-classification.ts
//
// src/session/usageClassification.ts 의 순수 함수들을 검증한다:
//   - classifyInterval: 상호작용 있으면 confirmedUse, 없으면(백그라운드/stale/무신호) unknownUse.
//     Step 1 에서 estimatedUse/noUse 는 항상 0.
//   - aggregateUsageBands: 밴드 합산 및 레거시 smartphoneUseMinutes>0 폴백(unknownUse).
//   - measurementSufficiency: 보행 0 / unknownRatio>=임계 -> insufficient=true, 확인 우세 -> false.
//
// 코어 파일과 동일한 로더 패턴을 위해 트랜스파일 훅을 등록한 뒤 동적 import 한다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const {
  classifyInterval,
  aggregateUsageBands,
  measurementSufficiency,
  zeroUsageBands,
  UNKNOWN_RATIO_INSUFFICIENT_THRESHOLD,
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

// (1) 상호작용 있음 -> 모든 경과 분이 confirmedUse. estimated/unknown/noUse 는 0.
{
  const b = classifyInterval({ hadRecentInteraction: true, appForeground: true, sensorStale: false }, 5);
  assert('interaction -> confirmedUse=5', b.confirmedUseMinutes === 5, `${b.confirmedUseMinutes}`);
  assert('interaction -> unknownUse=0', b.unknownUseMinutes === 0);
  assert('interaction -> estimatedUse=0 (Step 1)', b.estimatedUseMinutes === 0);
  assert('interaction -> noUse=0 (Step 1)', b.noUseMinutes === 0);
}

// (2) 상호작용 없음 + 백그라운드 -> unknownUse(관측 불가).
{
  const b = classifyInterval({ hadRecentInteraction: false, appForeground: false, sensorStale: false }, 3);
  assert('background no-interaction -> unknownUse=3', b.unknownUseMinutes === 3, `${b.unknownUseMinutes}`);
  assert('background no-interaction -> confirmedUse=0', b.confirmedUseMinutes === 0);
  assert('background -> estimatedUse=0', b.estimatedUseMinutes === 0);
  assert('background -> noUse=0', b.noUseMinutes === 0);
}

// (3) 상호작용 없음 + 센서 stale(포그라운드라도) -> unknownUse.
{
  const b = classifyInterval({ hadRecentInteraction: false, appForeground: true, sensorStale: true }, 2);
  assert('stale no-interaction -> unknownUse=2', b.unknownUseMinutes === 2, `${b.unknownUseMinutes}`);
  assert('stale -> confirmedUse=0', b.confirmedUseMinutes === 0);
}

// (3b) 상호작용 없음 + 포그라운드 + 신호 없음(stale 아님) -> 여전히 unknownUse(보수적).
{
  const b = classifyInterval({ hadRecentInteraction: false, appForeground: true, sensorStale: false }, 4);
  assert('no-signal foreground -> unknownUse=4', b.unknownUseMinutes === 4, `${b.unknownUseMinutes}`);
  assert('no-signal -> confirmedUse=0', b.confirmedUseMinutes === 0);
  assert('no-signal -> noUse=0 (folded into unknown)', b.noUseMinutes === 0);
}

// (3c) 경과 분 0/음수/비유한 방어 -> 모두 0.
{
  const b0 = classifyInterval({ hadRecentInteraction: true, appForeground: true, sensorStale: false }, 0);
  assert('elapsed=0 -> all zero', b0.confirmedUseMinutes === 0 && b0.unknownUseMinutes === 0);
  const bn = classifyInterval({ hadRecentInteraction: false, appForeground: false, sensorStale: false }, -5);
  assert('elapsed<0 -> all zero', bn.unknownUseMinutes === 0);
}

// (4) aggregateUsageBands: 밴드 필드가 있는 세그먼트 합산.
{
  const totals = aggregateUsageBands([
    { confirmedUseMinutes: 2, unknownUseMinutes: 1 },
    { confirmedUseMinutes: 3, estimatedUseMinutes: 0, unknownUseMinutes: 4, noUseMinutes: 0 },
  ]);
  assert('aggregate confirmed=5', totals.confirmedUseMinutes === 5, `${totals.confirmedUseMinutes}`);
  assert('aggregate unknown=5', totals.unknownUseMinutes === 5, `${totals.unknownUseMinutes}`);
  assert('aggregate estimated=0', totals.estimatedUseMinutes === 0);
  assert('aggregate noUse=0', totals.noUseMinutes === 0);
}

// (4b) 레거시 폴백: 밴드 필드가 전혀 없고 smartphoneUseMinutes>0 -> unknownUse 로 접힘.
{
  const totals = aggregateUsageBands([
    { smartphoneUseMinutes: 7 }, // 레거시 세그먼트(밴드 없음)
    { confirmedUseMinutes: 1 },  // 신규 세그먼트
  ]);
  assert('legacy smartphoneUseMinutes -> unknownUse=7', totals.unknownUseMinutes === 7, `${totals.unknownUseMinutes}`);
  assert('legacy fold does not become confirmed', totals.confirmedUseMinutes === 1, `${totals.confirmedUseMinutes}`);
}

// (4c) 밴드 필드가 있으면 smartphoneUseMinutes 는 무시(이중 계산 방지).
{
  const totals = aggregateUsageBands([
    { confirmedUseMinutes: 2, smartphoneUseMinutes: 99 },
  ]);
  assert('band present -> smartphoneUseMinutes ignored', totals.confirmedUseMinutes === 2 && totals.unknownUseMinutes === 0);
}

// (5) measurementSufficiency: 보행 0 -> insufficient=true, ratio=0.
{
  const r = measurementSufficiency(zeroUsageBands(), 0);
  assert('walk=0 -> insufficient', r.measurementInsufficient === true);
  assert('walk=0 -> unknownRatio=0', close(r.unknownRatio, 0), `${r.unknownRatio}`);
}

// (5b) unknownRatio >= 임계 -> insufficient=true.
{
  const totals = { confirmedUseMinutes: 1, estimatedUseMinutes: 0, unknownUseMinutes: 8, noUseMinutes: 0 };
  const walk = 10;
  const r = measurementSufficiency(totals, walk);
  assert('high unknown ratio -> insufficient', r.measurementInsufficient === true, `ratio=${r.unknownRatio}`);
  assert('unknownRatio = 8/10 = 0.8', close(r.unknownRatio, 0.8), `${r.unknownRatio}`);
  assert('ratio >= threshold', r.unknownRatio >= UNKNOWN_RATIO_INSUFFICIENT_THRESHOLD);
}

// (5c) 확인 우세(낮은 unknownRatio) -> insufficient=false.
{
  const totals = { confirmedUseMinutes: 9, estimatedUseMinutes: 0, unknownUseMinutes: 1, noUseMinutes: 0 };
  const walk = 10;
  const r = measurementSufficiency(totals, walk);
  assert('confirmed-dominated low unknown -> sufficient', r.measurementInsufficient === false, `ratio=${r.unknownRatio}`);
  assert('unknownRatio = 1/10 = 0.1', close(r.unknownRatio, 0.1), `${r.unknownRatio}`);
}

// (6) UNKNOWN_RATIO_INSUFFICIENT_THRESHOLD 는 노출된 설계값(0.5).
{
  assert('threshold exported = 0.5', UNKNOWN_RATIO_INSUFFICIENT_THRESHOLD === 0.5, `${UNKNOWN_RATIO_INSUFFICIENT_THRESHOLD}`);
  // 정확히 임계와 같으면(>=) insufficient=true 여야 한다.
  const totals = { confirmedUseMinutes: 5, estimatedUseMinutes: 0, unknownUseMinutes: 5, noUseMinutes: 0 };
  const r = measurementSufficiency(totals, 10);
  assert('ratio == threshold -> insufficient', r.measurementInsufficient === true, `ratio=${r.unknownRatio}`);
}

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
