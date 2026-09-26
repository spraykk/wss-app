// TAAS 응답 필드 탐색(진단) 스크립트 — 수동 실행 전용 (읽기/출력만, 파일 저장 없음)
//
// 목적: WSS 가중치(날씨/시간대/위치 등)는 현재 임의값이다. TAAS 실데이터로
// 상대위험도 계수를 만들기 위한 1단계로, "전국교통사고다발지역표준데이터"
// (tn_pubr_public_acdnt_area_api) 응답 item 에 **시간대(hour)·기상(weather)**
// 필드가 실제로 존재하는지 사용자가 눈으로 확인하게 돕는다.
//
// ── 중요: 이 데이터셋의 한계와 다음 행동 ──────────────────────────────────────
// 사용자 curl 로 확인된 이 "다발지역" 데이터셋의 item 필드는 다음과 같다:
//   acdntAreaManageNo, acdntYear, acdntTypeSe(사고유형구분, 예 '보행어린이'),
//   lcCode, ctprvnSignguNm, acdntAreaLcNm, occrrncCo(발생건수), casltCo(사상자수),
//   deathCo, swpsnCo, sinjpsnCo, injpsnCo, latitude, longitude,
//   acdntMlttdPynInfo(폴리곤, 미터투영), referenceDate, insttCode.
// → 이 목록에는 시간대(hour)·기상(weather) 필드가 보이지 않는다. 즉 "다발지역"
//   집계 데이터셋에는 시간대별/기상상태별 분해가 없을 가능성이 높다.
//
// 만약 이 스크립트 실행 결과에서도 시간대/기상 관련 필드가 나오지 않는다면,
// TAAS/공공데이터포털(data.go.kr)의 **다른 오픈API**를 별도로 찾아야 한다:
//   - "교통사고 시간대별" 통계 데이터셋 (시간대별 사고 건수/사상자)
//   - "교통사고 기상상태별" 통계 데이터셋 (맑음/비/눈/안개 등 기상상태별 사고)
//   - 사고 "개별건(원시 레코드)" 데이터셋 (발생시각·기상상태 컬럼을 직접 포함할 수 있음)
// data.go.kr 검색창에서 "교통사고 시간대", "교통사고 기상상태" 로 검색해 해당
// 데이터셋의 엔드포인트/필드명을 확보한 뒤, 다음 단계에서 상대위험도 계수 계산
// 스크립트를 작성한다.
//
// ── 실행법 (사용자 로컬: macOS + 인터넷 + node_modules 설치) ────────────────────
//   TAAS_API_KEY=<data.go.kr serviceKey> npx tsx scripts/explore-taas-fields.ts
// 또는 tsx 없이 Node 로:
//   TAAS_API_KEY=<serviceKey> node --experimental-strip-types scripts/explore-taas-fields.ts
//
// - serviceKey 는 인코딩/원시 어느 형태든 무방하다. normalizeApiKey 가 "정확히
//   한 번" 인코딩해 이중 인코딩(%2B -> %252B) 400 오류를 방지한다.
// - 이 스크립트는 외부망이 필요하므로 이 샌드박스(레지스트리/외부망 차단)에서는
//   동작하지 않는다. 반드시 사용자 로컬에서 실행한다.
// - assets/accident-zones.json 은 절대 건드리지 않는다(읽지도 저장하지도 않음).
//   이 스크립트는 오직 API 응답을 콘솔에 덤프한다.
import { normalizeApiKey } from '../src/data/apiKey.ts';

const TAAS_ENDPOINT =
  'https://api.data.go.kr/openapi/tn_pubr_public_acdnt_area_api';

// 시간대/기상 관련으로 "의심되는" 필드 키를 하이라이트하기 위한 정규식.
// 한글/영문 후보를 폭넓게 잡는다(과잡아도 사용자가 눈으로 걸러내면 됨).
const CANDIDATE_KEY_REGEX =
  /time|hour|시간|시각|기상|날씨|weather|dayNght|주야|occrrnc/i;

interface TaasResponse {
  header?: { resultCode?: string; resultMsg?: string };
  body?: {
    items?: { item?: Record<string, unknown>[] };
    numOfRows?: number;
    pageNo?: number;
    totalCount?: number;
  };
}

// TAAS 를 한 페이지 호출해 파싱된 응답을 반환하는 얇은 헬퍼.
async function fetchTaasPage(
  serviceKey: string,
  pageNo: number,
  numOfRows: number
): Promise<TaasResponse> {
  const url =
    `${TAAS_ENDPOINT}?serviceKey=${serviceKey}` +
    `&pageNo=${pageNo}&numOfRows=${numOfRows}&type=json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TAAS 응답 오류: HTTP ${res.status} (page ${pageNo})`);
  }
  const json = (await res.json()) as TaasResponse;
  const resultCode = json.header?.resultCode;
  if (resultCode !== '00') {
    throw new Error(
      `TAAS resultCode=${resultCode ?? '(없음)'} msg=${json.header?.resultMsg ?? ''}`
    );
  }
  return json;
}

async function main(): Promise<void> {
  const apiKey = process.env.TAAS_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    // 키가 없으면 명확한 안내 후 종료.
    console.error(
      '[explore-taas-fields] TAAS_API_KEY 가 없어 실행을 건너뜁니다.\n' +
        'data.go.kr 에서 tn_pubr_public_acdnt_area_api(전국교통사고다발지역표준데이터)\n' +
        '키를 발급받아 아래처럼 실행하세요:\n' +
        '  TAAS_API_KEY=<serviceKey> npx tsx scripts/explore-taas-fields.ts\n' +
        '(이 스크립트는 외부망이 필요하며 샌드박스에서는 동작하지 않습니다.)'
    );
    process.exit(1);
    return;
  }

  const serviceKey = normalizeApiKey(apiKey.trim());

  // ── (1) 소량 표본을 그대로 덤프: 시간대/기상 필드 존재 여부를 눈으로 확인 ──────
  console.log('════════════════════════════════════════════════════════════');
  console.log('[1] 표본 응답 덤프 (pageNo=1, numOfRows=5)');
  console.log('    tn_pubr_public_acdnt_area_api 응답 item 을 그대로 출력합니다.');
  console.log('════════════════════════════════════════════════════════════');

  const sample = await fetchTaasPage(serviceKey, 1, 5);
  console.log(`totalCount = ${sample.body?.totalCount ?? '(없음)'}`);
  const sampleItems = sample.body?.items?.item ?? [];
  console.log(`이 페이지 item 수 = ${sampleItems.length}\n`);
  console.log(JSON.stringify(sampleItems, null, 2));

  if (sampleItems.length === 0) {
    console.error(
      '\n[explore-taas-fields] item 이 0건이라 필드 분석을 진행할 수 없습니다. ' +
        '키/엔드포인트를 확인하세요.'
    );
    process.exit(1);
    return;
  }

  // ── (2) item[0] 의 모든 키 목록 + 시간대/기상 후보 키 하이라이트 ───────────────
  const firstItem = sampleItems[0];
  const allKeys = Object.keys(firstItem);

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('[2] item[0] 의 전체 필드 키 목록');
  console.log('════════════════════════════════════════════════════════════');
  for (const key of allKeys) {
    const value = firstItem[key];
    console.log(`  - ${key} = ${JSON.stringify(value)}`);
  }

  const candidateKeys = allKeys.filter((k) => CANDIDATE_KEY_REGEX.test(k));
  console.log('\n────────────────────────────────────────────────────────────');
  console.log('[2-후보] 시간대/기상 관련으로 "의심되는" 필드');
  console.log(`         (정규식: ${CANDIDATE_KEY_REGEX})`);
  console.log('────────────────────────────────────────────────────────────');
  if (candidateKeys.length > 0) {
    for (const key of candidateKeys) {
      console.log(`  ⚑ ${key} = ${JSON.stringify(firstItem[key])}`);
    }
    console.log(
      '\n  ↑ 위 후보 필드가 실제로 "시간대별/기상상태별" 분해를 담고 있는지\n' +
        '    (1) 표본 덤프의 값들을 함께 보고 판단하세요. 단순 발생건수(occrrncCo)\n' +
        '    처럼 시간대/기상과 무관한 필드가 정규식에 걸렸을 수 있습니다.'
    );
  } else {
    console.log(
      '  (없음) 이 데이터셋 item 에는 시간대/기상 관련 후보 키가 없습니다.\n' +
        '  → 상단 주석의 안내대로 data.go.kr 에서 "교통사고 시간대" /\n' +
        '    "교통사고 기상상태" 데이터셋(또는 사고 개별건 데이터)을 별도로\n' +
        '    찾아야 합니다. 이 "다발지역" 집계 데이터셋만으로는 시간대/기상\n' +
        '    상대위험도 계수를 만들 수 없습니다.'
    );
  }

  // ── (3) acdntTypeSe(사고유형) distinct 값 집계: 어떤 유형 분류가 있는지 확인 ────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('[3] acdntTypeSe(사고유형구분) distinct 값 집계 (pageNo 1~2, numOfRows=100)');
  console.log('════════════════════════════════════════════════════════════');

  const typeCounts = new Map<string, number>();
  for (let pageNo = 1; pageNo <= 2; pageNo += 1) {
    const page = await fetchTaasPage(serviceKey, pageNo, 100);
    const items = page.body?.items?.item ?? [];
    if (items.length === 0) break;
    for (const row of items) {
      const raw = row.acdntTypeSe;
      const type = typeof raw === 'string' && raw.length > 0 ? raw : '(빈값/없음)';
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    }
  }

  const sortedTypes = Array.from(typeCounts.entries()).sort(
    (a, b) => b[1] - a[1]
  );
  if (sortedTypes.length > 0) {
    console.log(`distinct acdntTypeSe 값 ${sortedTypes.length}종 (표본 최대 200건 기준):`);
    for (const [type, count] of sortedTypes) {
      console.log(`  - ${type}: ${count}건`);
    }
  } else {
    console.log('  acdntTypeSe 값을 수집하지 못했습니다(응답 비어있음).');
  }

  console.log('\n[explore-taas-fields] 탐색 완료. 위 [2-후보]/[3] 결과를 캡처해');
  console.log('공유하면, 다음 단계에서 상대위험도 계수 계산 스크립트를 작성합니다.');
  console.log('(assets/accident-zones.json 은 이 스크립트가 건드리지 않았습니다.)');
}

void main();
