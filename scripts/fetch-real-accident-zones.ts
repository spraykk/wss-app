// TAAS 사고다발지역 데이터 1회성 수집 스크립트 (수동 실행 전용)
//
// 도로교통공단 TAAS(교통사고분석시스템) 표준 API 로 보행자 사고다발지역을 받아
// assets/accident-zones.json 을 재생성한다. 네트워크가 필요하므로 이 샌드박스
// (레지스트리/외부망 차단)에서는 실행되지 않는다. 로컬에서 TAAS_API_KEY 를
// 설정한 뒤 수동으로 1회 실행하는 용도이다.
//
// 실행(로컬): TAAS_API_KEY=... node --experimental-strip-types scripts/fetch-real-accident-zones.ts
//
// 주의: 현재 커밋된 assets/accident-zones.json 은 중복 지점 패턴(#5)을 재현하기
// 위한 "대표 재구성 데이터셋"이며 원본 137행 export 가 아니다(가이드.md 참조).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AccidentZone } from '../src/types.ts';

// TAAS 보행자 사고다발지역 조회 엔드포인트(예시). 실제 파라미터/응답 스키마는
// data.go.kr 문서를 참고해 조정한다.
const TAAS_URL =
  'http://apis.data.go.kr/B552061/frequentzoneWalk/getRestFrequentzoneWalk';

interface TaasItem {
  spot_cd?: string;
  spot_nm?: string;
  la_crd?: string; // 위도
  lo_crd?: string; // 경도
  occrrnc_cnt?: string; // 발생 건수
}

async function main(): Promise<void> {
  const apiKey = process.env.TAAS_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    // 키가 없으면 명확한 메시지와 함께 아무 것도 하지 않고 종료(no-op).
    console.error(
      '[fetch-real-accident-zones] TAAS_API_KEY 가 없어 실행을 건너뜁니다. ' +
        'data.go.kr 에서 키를 발급받아 TAAS_API_KEY 환경변수로 설정한 뒤 다시 실행하세요. ' +
        '(이 스크립트는 외부망이 필요하며 샌드박스에서는 동작하지 않습니다.)'
    );
    process.exit(0);
    return;
  }

  const params = new URLSearchParams({
    serviceKey: apiKey,
    searchYearCd: '2023',
    siDo: '11', // 예시: 서울
    guGun: '680', // 예시: 강남구
    type: 'json',
    numOfRows: '200',
    pageNo: '1',
  });

  const res = await fetch(`${TAAS_URL}?${params.toString()}`);
  if (!res.ok) {
    console.error(`[fetch-real-accident-zones] TAAS 응답 오류: HTTP ${res.status}`);
    process.exit(1);
    return;
  }
  const json = (await res.json()) as { items?: { item?: TaasItem[] } };
  const items = json?.items?.item ?? [];

  const zones: AccidentZone[] = items.map((it, i) => ({
    id: it.spot_cd ?? `taas-${i}`,
    name: it.spot_nm ?? `사고다발지역-${i}`,
    latitude: Number(it.la_crd ?? 0),
    longitude: Number(it.lo_crd ?? 0),
    radiusMeters: 50,
    accidentCount3y: Number(it.occrrnc_cnt ?? 0),
    source: 'TAAS_STANDARD',
  }));

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = join(here, '..', 'assets', 'accident-zones.json');
  writeFileSync(outPath, `${JSON.stringify(zones, null, 2)}\n`, 'utf8');
  console.log(`[fetch-real-accident-zones] ${zones.length}개 zone 을 ${outPath} 에 저장했습니다.`);
}

void main();
