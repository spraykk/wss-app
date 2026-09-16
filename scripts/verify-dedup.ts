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
register('./ts-transpile-hook.mjs', import.meta.url);

const { loadRawAccidentZones, mergeNearbyZones, postProcessZones, haversineMeters } =
  await import('../src/data/accidentZones.ts');
const { computeRiskIntensity, computeZoneSeverity, computeLocationWeight } =
  await import('../src/wss/weights.ts');

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
const merged = postProcessZones(raw);

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

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
