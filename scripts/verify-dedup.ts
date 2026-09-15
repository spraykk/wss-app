// 사고다발지역 중복 병합(dedup, 버그 #5) 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-dedup.ts
//
// 배포된 코어 파일(src/wss/weights.ts, src/data/accidentZones.ts -> src/types.ts)은
// 모듈 간 타입 전용 이름을 `type` 키워드 없이 가져오는 경우가 있어, Node 의
// `--experimental-strip-types` 만으로는 런타임 오류가 난다. 그래서 FEAT-001 과
// 동일하게 tsc 트랜스파일 로더 훅을 먼저 등록한 뒤 동적 import 로 불러온다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { loadRawAccidentZones, mergeNearbyZones, postProcessZones } = await import(
  '../src/data/accidentZones.ts'
);
const { computeRiskIntensity, computeZoneSeverity, computeLocationWeight } =
  await import('../src/wss/weights.ts');

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

function assertClose(label: string, actual: number, expected: number): void {
  assert(label, Math.abs(actual - expected) <= EPS, `got ${actual}, expected ${expected}`);
}

const raw = loadRawAccidentZones();
const merged = postProcessZones(raw);

// (a) '뿌리약국 부근' 근접 중복(8건 이상)이 하나의 zone 으로 병합되는지 확인.
const rawPpuri = raw.filter((z) => z.name.includes('뿌리약국 부근'));
const mergedPpuri = merged.filter((z) => z.name.includes('뿌리약국 부근'));
assert(
  '원시 데이터에 뿌리약국 부근 중복이 8건 이상 존재',
  rawPpuri.length >= 8,
  `${rawPpuri.length}건`
);
assert(
  '뿌리약국 부근 중복이 병합 후 정확히 1개 zone',
  mergedPpuri.length === 1,
  `${mergedPpuri.length}개`
);
const ppuriRawSum = rawPpuri.reduce((s, z) => s + z.accidentCount3y, 0);
assert(
  '병합된 뿌리약국 zone 의 accidentCount3y = 구성원 합계',
  mergedPpuri.length === 1 && mergedPpuri[0].accidentCount3y === ppuriRawSum,
  `병합 count=${mergedPpuri[0]?.accidentCount3y}, 원시 합계=${ppuriRawSum}`
);

// (b) 임계값 내 이웃이 없는 고립 count-5 기준 지점은 불변 (보정 안전성).
const loneRaw = raw.find((z) => z.id === 'z-ref-lone5');
const loneMerged = merged.find((z) => z.id === 'z-ref-lone5');
assert('원시 데이터에 고립 기준 지점(z-ref-lone5) 존재', !!loneRaw, `count=${loneRaw?.accidentCount3y}`);
assert(
  '고립 기준 지점이 병합 후에도 그대로 존재',
  !!loneMerged,
  loneMerged ? `count=${loneMerged.accidentCount3y}` : '없음'
);
assert(
  '고립 기준 지점 accidentCount3y 가 5로 불변',
  !!loneMerged && loneMerged.accidentCount3y === 5,
  `count=${loneMerged?.accidentCount3y}`
);
if (loneMerged) {
  assertClose('고립 기준 지점 computeZoneSeverity === 1.0', computeZoneSeverity(loneMerged.accidentCount3y), 1.0);
  assertClose('computeLocationWeight(1.0) === 2.5', computeLocationWeight(computeZoneSeverity(loneMerged.accidentCount3y)), 2.5);
}

// (c) 병합 후 riskIntensity < 원시 riskIntensity (중복 과대계상 해소 입증).
const rawIntensity = computeRiskIntensity(raw.map((z) => z.accidentCount3y));
const mergedIntensity = computeRiskIntensity(merged.map((z) => z.accidentCount3y));
assert(
  '병합 riskIntensity < 원시 riskIntensity',
  mergedIntensity < rawIntensity - EPS,
  `merged=${mergedIntensity}, raw=${rawIntensity}`
);

// 추가 확인: mergeNearbyZones 는 순수 함수 (원본 배열 개수 감소, 입력 불변).
const rawLenBefore = raw.length;
const mergedDirect = mergeNearbyZones(raw, 30);
assert('mergeNearbyZones 가 입력 배열 길이를 변경하지 않음', raw.length === rawLenBefore);
assert('병합 결과 zone 수 < 원시 zone 수', mergedDirect.length < raw.length, `${mergedDirect.length} < ${raw.length}`);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
