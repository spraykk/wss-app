// 위경도 -> 기상청(KMA) 동네예보 격자 변환 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-grid.ts
//
// 검증 대상(순수 함수, src/data/weather.ts):
//  - latLonToGrid(lat, lon) 이 기상청 표준 LCC(DFS) 격자 변환 공식과 일치하는지.
//    알려진 도시 좌표 -> 알려진 격자 값과 비교(반올림 경계 고려해 ±1 허용).
//  - 서울이 대략 (60, 127) 근방인지 sanity 확인.
//  - 순수성: 같은 입력에 항상 같은 출력.
//
// 다른 verify 스크립트와 동일하게 tsc 트랜스파일 로더 훅을 먼저 등록한 뒤 동적 import 한다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { latLonToGrid } = await import('../src/data/weather.ts');

let failures = 0;
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`PASS ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
    failures += 1;
  }
}

// 두 격자값이 기대치와 ±tol 이내로 일치하는지(반올림 경계 고려).
function near(actual: number, expected: number, tol: number): boolean {
  return Math.abs(actual - expected) <= tol;
}

// ── 알려진 도시 좌표 -> 알려진 격자(기상청 표준 변환표) ────────────────────
// (lat, lon, expectedNx, expectedNy)
const CASES: Array<{ name: string; lat: number; lon: number; nx: number; ny: number }> = [
  { name: '서울(중구 부근)', lat: 37.5665, lon: 126.978, nx: 60, ny: 127 },
  { name: '부산', lat: 35.1796, lon: 129.0756, nx: 98, ny: 76 },
  { name: '대전', lat: 36.3504, lon: 127.3845, nx: 67, ny: 100 },
  { name: '충남 서산', lat: 36.7845, lon: 126.4503, nx: 51, ny: 110 },
];

for (const c of CASES) {
  const g = latLonToGrid(c.lat, c.lon);
  const ok = near(g.nx, c.nx, 1) && near(g.ny, c.ny, 1);
  assert(
    `${c.name} => 격자 근사(±1)`,
    ok,
    `got (${g.nx},${g.ny}) expected ~(${c.nx},${c.ny})`
  );
}

// ── 서울 sanity: 대략 (60,127) 근방(±1) ──────────────────────────────────────
{
  const g = latLonToGrid(37.5665, 126.978);
  assert(
    '서울 sanity: (60,127) 근방',
    near(g.nx, 60, 1) && near(g.ny, 127, 1),
    `(${g.nx},${g.ny})`
  );
}

// ── 서산 != 서울: 지역이 다르면 격자도 달라야 한다(하드코딩 회귀 방지) ───────
{
  const seoul = latLonToGrid(37.5665, 126.978);
  const seosan = latLonToGrid(36.7845, 126.4503);
  assert(
    '서산 격자가 서울 격자와 다름(GPS 반영 확인)',
    seoul.nx !== seosan.nx || seoul.ny !== seosan.ny,
    `서울(${seoul.nx},${seoul.ny}) vs 서산(${seosan.nx},${seosan.ny})`
  );
}

// ── 결과는 정수(반올림) ──────────────────────────────────────────────────────
{
  const g = latLonToGrid(37.5665, 126.978);
  assert(
    '격자 좌표는 정수',
    Number.isInteger(g.nx) && Number.isInteger(g.ny),
    `(${g.nx},${g.ny})`
  );
}

// ── 순수성/결정성: 같은 입력 => 같은 출력 ────────────────────────────────────
{
  const a = latLonToGrid(35.1796, 129.0756);
  const b = latLonToGrid(35.1796, 129.0756);
  assert('결정성: 같은 입력 => 같은 출력', a.nx === b.nx && a.ny === b.ny);
}

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
