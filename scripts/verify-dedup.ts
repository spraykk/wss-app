// 사고다발지역 중복 병합(dedup, 버그 #5) 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-dedup.ts
//
// 배포된 코어 파일(src/wss/weights.ts, src/data/accidentZones.ts -> src/types.ts)은
// 모듈 간 타입 전용 이름을 `type` 키워드 없이 가져오는 경우가 있어, Node 의
// `--experimental-strip-types` 만으로는 런타임 오류가 난다. 그래서 FEAT-001 과
// 동일하게 tsc 트랜스파일 로더 훅을 먼저 등록한 뒤 동적 import 로 불러온다.
//
// 이 검증은 assets/accident-zones.json 의 "원본" TAAS 데이터(관악구, 137행)를
// 대상으로 한다. 원본은 같은 물리적 지점이 연도별로 반복 수록되어 있으며,
// 특히 '뿌리약국 부근'이 9건 등장한다. 실제 좌표는 연도별로 미세하게 흔들려
// 30m 임계값 기준으로는 하나의 사슬이 아니라 (고립 1건 + 인접 8건) 2개
// 클러스터를 이룬다. 따라서 "정확히 1개"가 아니라 "원시보다 확실히 줄어들고,
// 인접 8건 클러스터는 합계로 하나가 된다"를 검증한다. JSON 원본은 수정하지 않고
// 런타임 병합만 검증한다.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
register('./ts-transpile-hook.mjs', import.meta.url);

// 앱 코드(src/data/accidentZones.ts)는 이제 JSON 을 Metro 의 require(...) 로 읽으므로
// 그 로더(loadRawAccidentZones)는 Node 에서 그대로 실행하면 안 된다. 대신 검증 스크립트가
// JSON 을 직접 파일시스템에서 읽어(node:fs) 순수 함수(mergeNearbyZones 등)에 주입한다.
// 이렇게 해서 node:* 의존은 scripts/ 안에만 남고 src/ 에는 0건이 된다.
const { mergeNearbyZones, postProcessZones, haversineMeters } =
  await import('../src/data/accidentZones.ts');
const { computeRiskIntensity, computeZoneSeverity, computeLocationWeight } =
  await import('../src/wss/weights.ts');

interface AccidentZoneRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  accidentCount3y: number;
  source: 'TAAS_STANDARD' | 'SAMPLE_PLACEHOLDER';
}

function loadRawAccidentZones(): AccidentZoneRow[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const jsonPath = join(here, '..', 'assets', 'accident-zones.json');
  return JSON.parse(readFileSync(jsonPath, 'utf8')) as AccidentZoneRow[];
}

const EPS = 1e-9;
const THRESHOLD = 30;
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
// 병합 의미(merge semantics) 검증에는 순수 병합 결과를 그대로 사용한다. postProcessZones 는
// 병합 뒤에 id 고유화(#index)와 반경 스케일(ZONE_RADIUS_SCALE)까지 적용하므로 원본 id/radius
// 기준 비교에는 mergeNearbyZones 를 직접 쓴다. postProcessZones 의 후처리는 (e)에서 별도 검증.
const merged = mergeNearbyZones(raw, THRESHOLD);

// (a) '뿌리약국 부근' 근접 중복이 원본에 9건 존재하고, 병합 후 확실히 줄어드는지.
const rawPpuri = raw.filter((z) => z.name.includes('뿌리약국 부근'));
const mergedPpuri = merged.filter((z) => z.name.includes('뿌리약국 부근'));
assert(
  '원본에 뿌리약국 부근 중복이 8건 이상 존재',
  rawPpuri.length >= 8,
  `${rawPpuri.length}건`
);
assert(
  '뿌리약국 부근 중복이 병합 후 원시보다 확실히 감소',
  mergedPpuri.length < rawPpuri.length,
  `${rawPpuri.length}건 -> ${mergedPpuri.length}개 클러스터`
);

// (a2) 30m 임계값으로 실제 인접한 뿌리약국 점들(8건 사슬)은 하나의 zone 으로
// 병합되고, 그 zone 의 accidentCount3y 는 구성원 count 의 합과 같아야 한다.
// (union-find 연결 요소로 직접 계산해 대표 클러스터를 특정한다.)
function clusterSizes(zones: typeof rawPpuri, threshold: number): number[][] {
  const parent = zones.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < zones.length; i += 1) {
    for (let j = i + 1; j < zones.length; j += 1) {
      const d = haversineMeters(
        zones[i].latitude,
        zones[i].longitude,
        zones[j].latitude,
        zones[j].longitude
      );
      if (d <= threshold) union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < zones.length; i += 1) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }
  return Array.from(groups.values());
}
const ppuriClusters = clusterSizes(rawPpuri, THRESHOLD);
const largest = ppuriClusters.reduce((a, b) => (b.length > a.length ? b : a), []);
const largestSum = largest.reduce((s, idx) => s + rawPpuri[idx].accidentCount3y, 0);
assert(
  '뿌리약국 인접 클러스터(최대)가 2개 이상 지점을 병합',
  largest.length >= 2,
  `${largest.length}개 지점`
);
const mergedLargest = mergedPpuri.find((z) => z.accidentCount3y === largestSum);
assert(
  '병합된 뿌리약국 대표 zone 의 accidentCount3y = 인접 클러스터 구성원 합계',
  !!mergedLargest,
  `기대 합계=${largestSum}, 병합 counts=[${mergedPpuri.map((z) => z.accidentCount3y).join(',')}]`
);

// (b) 임계값(30m) 내 이웃이 없는 고립 count-5 기준 지점은 불변이어야 한다(보정 안전성).
// 원본에서 실제로 고립된 count-5 지점을 선택: 2018032 신림동(구로전화국사거리 부근).
const REF_ID = '2018032';
const REF_NAME_PART = '구로전화국사거리';
const loneRaw = raw.find(
  (z) => z.id === REF_ID && z.name.includes(REF_NAME_PART) && z.accidentCount3y === 5
);
assert(
  `원본에 고립 기준 지점(${REF_ID} ${REF_NAME_PART}) 존재`,
  !!loneRaw,
  loneRaw ? `count=${loneRaw.accidentCount3y}` : '없음'
);
if (loneRaw) {
  const neighborCount = raw.filter(
    (o) =>
      o !== loneRaw &&
      haversineMeters(loneRaw.latitude, loneRaw.longitude, o.latitude, o.longitude) <= THRESHOLD
  ).length;
  assert('기준 지점이 30m 내 이웃 없이 고립됨', neighborCount === 0, `이웃 ${neighborCount}개`);
}
const loneMerged = merged.find(
  (z) => z.id === REF_ID && z.name.includes(REF_NAME_PART)
);
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
  assertClose(
    '고립 기준 지점 computeZoneSeverity === 1.0',
    computeZoneSeverity(loneMerged.accidentCount3y),
    1.0
  );
  assertClose(
    'computeLocationWeight(severity(5)) === 2.5',
    computeLocationWeight(computeZoneSeverity(loneMerged.accidentCount3y)),
    2.5
  );
}

// (c) 병합 후 riskIntensity < 원시 riskIntensity (중복 과대계상 해소 입증).
const rawIntensity = computeRiskIntensity(raw.map((z) => z.accidentCount3y));
const mergedIntensity = computeRiskIntensity(merged.map((z) => z.accidentCount3y));
assert(
  '병합 riskIntensity < 원시 riskIntensity',
  mergedIntensity < rawIntensity - EPS,
  `merged=${mergedIntensity}, raw=${rawIntensity}`
);

// (d) mergeNearbyZones 는 순수 함수: 입력 배열 불변, 결과 zone 수 감소.
const rawLenBefore = raw.length;
const mergedDirect = mergeNearbyZones(raw, THRESHOLD);
assert('mergeNearbyZones 가 입력 배열 길이를 변경하지 않음', raw.length === rawLenBefore);
assert(
  '병합 결과 zone 수 < 원시 zone 수',
  mergedDirect.length < raw.length,
  `${mergedDirect.length} < ${raw.length}`
);

// (e) postProcessZones 후처리(id 고유화 + 반경 스케일)가 병합 의미(count)를 바꾸지 않고,
//     id 가 모두 고유하며, 반경이 ZONE_RADIUS_SCALE 만큼 축소되는지 검증한다.
const processed = postProcessZones(raw);
assert(
  'postProcessZones zone 수 = mergeNearbyZones zone 수(후처리는 병합 개수를 바꾸지 않음)',
  processed.length === mergedDirect.length,
  `${processed.length} vs ${mergedDirect.length}`
);
const processedIds = new Set(processed.map((z) => z.id));
assert(
  'postProcessZones 결과 id 가 모두 고유함',
  processedIds.size === processed.length,
  `${processedIds.size} unique / ${processed.length} total`
);
const RADIUS_SCALE = 0.6;
const radiusScaledOk = processed.every((z, idx) => {
  const expected = mergedDirect[idx].radiusMeters * RADIUS_SCALE;
  return Math.abs(z.radiusMeters - expected) <= 1e-6;
});
assert('postProcessZones 가 반경을 ZONE_RADIUS_SCALE(0.6)로 축소', radiusScaledOk);
const countsPreserved = processed.every(
  (z, idx) => z.accidentCount3y === mergedDirect[idx].accidentCount3y
);
assert('postProcessZones 가 accidentCount3y(보정값)를 보존', countsPreserved);
// riskIntensity 는 count 기반이므로 후처리 후에도 병합 riskIntensity 와 동일해야 한다.
const processedIntensity = computeRiskIntensity(processed.map((z) => z.accidentCount3y));
assertClose(
  'postProcessZones riskIntensity = 병합 riskIntensity(반경 스케일은 무관)',
  processedIntensity,
  mergedIntensity
);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
