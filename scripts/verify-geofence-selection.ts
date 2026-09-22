// 지오펜스 근접 구역 선택/재등록 정책 검증 스크립트 (FEAT-003)
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-geofence-selection.ts
//
// 검증 대상(순수 함수, src/sensors/geofenceSelection.ts):
//  - selectNearestZones: zones > maxRegions 일 때 정확히 maxRegions 개 반환,
//    거리 오름차순 정렬, iOS 20 region 하드캡 초과 없음.
//  - shouldReRegister: hysteresis 미만 이동엔 false, 초과엔 true.
//
// src 코어 파일은 모듈 간 타입 전용 이름을 `type` 키워드 없이 가져오는 경우가 있어
// Node 의 --experimental-strip-types 만으로는 런타임 오류가 날 수 있다. 그래서
// 다른 verify 스크립트와 동일하게 tsc 트랜스파일 로더 훅을 먼저 등록한 뒤 동적 import 한다.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
register('./ts-transpile-hook.mjs', import.meta.url);

const { selectNearestZones, shouldReRegister, IOS_REGION_HARD_CAP, makeBoundaryRegion } =
  await import('../src/sensors/geofenceSelection.ts');
const { haversineMeters } = await import('../src/data/accidentZones.ts');

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

let failures = 0;
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`PASS ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
    failures += 1;
  }
}

// ── 합성 데이터로 결정적 검증 ────────────────────────────────────────────────
// 사용자 위치(0,0) 기준으로 경도만 늘려 거리가 단조 증가하는 30개 구역을 만든다.
const USER_LAT = 0;
const USER_LON = 0;
const synthetic: AccidentZoneRow[] = [];
for (let i = 1; i <= 30; i += 1) {
  synthetic.push({
    id: `z${i}`,
    name: `zone ${i}`,
    latitude: 0,
    longitude: i * 0.01, // 거리 오름차순(i 증가 = 멀어짐)
    radiusMeters: 150,
    accidentCount3y: 5,
    source: 'SAMPLE_PLACEHOLDER',
  });
}

// (1) zones > maxRegions 일 때 정확히 maxRegions 개 반환.
const maxRegions = 18;
const selected = selectNearestZones(synthetic, USER_LAT, USER_LON, maxRegions);
assert(
  'selectNearestZones 가 정확히 maxRegions 개 반환(zones > maxRegions)',
  selected.length === maxRegions,
  `${selected.length}개 (기대 ${maxRegions})`
);

// (2) iOS 20 region 하드캡 초과 없음.
assert(
  '반환 개수가 iOS 하드캡(20) 미만',
  selected.length < IOS_REGION_HARD_CAP,
  `${selected.length} < ${IOS_REGION_HARD_CAP}`
);

// (3) 거리 오름차순 정렬(nearest-first).
let ascending = true;
for (let i = 1; i < selected.length; i += 1) {
  const dPrev = haversineMeters(USER_LAT, USER_LON, selected[i - 1].latitude, selected[i - 1].longitude);
  const dCur = haversineMeters(USER_LAT, USER_LON, selected[i].latitude, selected[i].longitude);
  if (dCur < dPrev) ascending = false;
}
assert('반환 구역이 거리 오름차순(nearest-first) 정렬', ascending);

// (3b) 가장 가까운 것이 z1(경도 0.01), 가장 먼 선택이 z18 이어야 한다.
assert('첫 선택이 최근접(z1)', selected[0].id === 'z1', selected[0].id);
assert('마지막 선택이 z18(근접 18번째)', selected[selected.length - 1].id === 'z18', selected[selected.length - 1].id);

// (4) maxRegions 가 하드캡 이상이어도 (하드캡-1)로 클램프(boundary 여유).
const overCap = selectNearestZones(synthetic, USER_LAT, USER_LON, 999);
assert(
  'maxRegions 과대 입력 시 하드캡-1 로 클램프',
  overCap.length === IOS_REGION_HARD_CAP - 1,
  `${overCap.length} (기대 ${IOS_REGION_HARD_CAP - 1})`
);

// (5) zones <= maxRegions 이면 전부 반환.
const few = synthetic.slice(0, 5);
const selectedFew = selectNearestZones(few, USER_LAT, USER_LON, maxRegions);
assert('zones <= maxRegions 이면 전부 반환', selectedFew.length === 5, `${selectedFew.length}`);

// (6) 입력 배열 불변(순수 함수).
const before = synthetic.map((z) => z.id).join(',');
selectNearestZones(synthetic, USER_LAT, USER_LON, maxRegions);
const after = synthetic.map((z) => z.id).join(',');
assert('selectNearestZones 가 입력 배열 순서를 변형하지 않음', before === after);

// ── shouldReRegister hysteresis 검증 ─────────────────────────────────────────
// 기준점(0,0)에서 동쪽으로 이동. 위도 0에서 경도 0.001 ~= 111.3m.
const HYST = 1000; // m
// (7) hysteresis 미만 이동 -> false.
const smallMove = shouldReRegister(0, 0, 0, 0.005, HYST); // ~556m
assert('hysteresis 미만 이동엔 재등록 안 함(false)', smallMove === false, `moved ~${Math.round(haversineMeters(0, 0, 0, 0.005))}m`);

// (8) hysteresis 초과 이동 -> true.
const bigMove = shouldReRegister(0, 0, 0, 0.02, HYST); // ~2225m
assert('hysteresis 초과 이동엔 재등록(true)', bigMove === true, `moved ~${Math.round(haversineMeters(0, 0, 0, 0.02))}m`);

// (9) 정확히 같은 위치(이동 0) -> false.
assert('이동 없음(0m)엔 재등록 안 함(false)', shouldReRegister(0, 0, 0, 0, HYST) === false);

// (10) makeBoundaryRegion 이 중심/반경을 그대로 반영.
const boundary = makeBoundaryRegion(37.48, 126.95, 1500);
assert(
  'makeBoundaryRegion 이 중심/반경을 반영',
  boundary.latitude === 37.48 && boundary.longitude === 126.95 && boundary.radiusMeters === 1500,
  JSON.stringify(boundary)
);

// ── 실제 zone 데이터 스모크 체크 ─────────────────────────────────────────────
// 관악구 실데이터(137행 원본)에서 서울대입구역 근처 사용자 기준 근접 18개 선택.
const raw = loadRawAccidentZones();
const REAL_LAT = 37.4812;
const REAL_LON = 126.9528;
const realSelected = selectNearestZones(raw, REAL_LAT, REAL_LON, 18);
assert('실데이터: 선택 개수 <= 18', realSelected.length <= 18, `${realSelected.length}`);
assert('실데이터: 선택 개수 < 하드캡(20)', realSelected.length < IOS_REGION_HARD_CAP, `${realSelected.length}`);
let realAscending = true;
for (let i = 1; i < realSelected.length; i += 1) {
  const dPrev = haversineMeters(REAL_LAT, REAL_LON, realSelected[i - 1].latitude, realSelected[i - 1].longitude);
  const dCur = haversineMeters(REAL_LAT, REAL_LON, realSelected[i].latitude, realSelected[i].longitude);
  if (dCur < dPrev - 1e-6) realAscending = false;
}
assert('실데이터: 거리 오름차순 정렬', realAscending);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
