// TAAS 사고다발지역 데이터 1회성 수집 스크립트 (수동 실행 전용)
//
// 도로교통공단 TAAS(교통사고분석시스템) 표준 API 로 사고다발지역을 받아
// assets/accident-zones.json 을 재생성한다. 실제 수집 로직은
// src/data/accidentZones.ts 의 fetchAccidentZonesFromTAAS 에 있고, 이 파일은
// 그것을 호출해 결과를 파일로 저장하는 "얇은 CLI"이다.
//
// 이 스크립트는 외부망이 필요하므로 이 샌드박스(레지스트리/외부망 차단)에서는
// 실행되지 않는다. 로컬(node_modules 설치 + 인터넷)에서 아래처럼 1회 실행한다:
//
//   # (1) 전국 전체 저장 — 인자 없이 실행하면 필터 없이 전국(약 12,780건)을 저장한다.
//   TAAS_API_KEY=<data.go.kr serviceKey> npx tsx scripts/fetch-real-accident-zones.ts
//
//   # (2) 특정 지역만 저장 — 지역 키워드를 인자로 주면 그 지역만 필터해 저장한다.
//   TAAS_API_KEY=<data.go.kr serviceKey> npx tsx scripts/fetch-real-accident-zones.ts "관악구"
//
// - serviceKey 는 인코딩/원시 어느 형태든 무방하다(fetchAccidentZonesFromTAAS 내부
//   normalizeApiKey 가 "정확히 한 번" 인코딩해 이중 인코딩 400 을 방지한다).
// - 지역 인자(argv[2])를 생략하면 전국 전체를 저장한다(필터 스킵). 인자를 주면
//   ctprvnSignguNm 부분일치로 그 지역만 저장한다(하위호환).
// - 전국 전체를 저장하면 accident-zones.json 이 수 MB 로 커진다(정상). 지오펜스는
//   근처 N개만 등록하므로(selectNearestZones) 런타임 성능/메모리에는 문제가 없다.
//
// 현재 커밋된 assets/accident-zones.json 은 관악구 137행 TAAS 표준 export 이다.
// 전국 데이터로 교체하려면 위 (1) 명령을 로컬에서 실행하면 된다.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchAccidentZonesFromTAAS } from '../src/data/accidentZones.ts';
import type { AccidentZone } from '../src/types.ts';

async function main(): Promise<void> {
  const apiKey = process.env.TAAS_API_KEY;
  // 인자 없음 -> 전국 전체(빈 문자열 = 필터 스킵). 인자 있음 -> 해당 지역만.
  const regionArg = process.argv[2];
  const regionKeyword = (regionArg ?? '').trim();
  const isNationwide = regionKeyword.length === 0;

  if (!apiKey || apiKey.trim().length === 0) {
    // 키가 없으면 명확한 메시지와 함께 아무 것도 하지 않고 종료(no-op).
    console.error(
      '[fetch-real-accident-zones] TAAS_API_KEY 가 없어 실행을 건너뜁니다. ' +
        'data.go.kr 에서 tn_pubr_public_acdnt_area_api 키를 발급받아 ' +
        'TAAS_API_KEY 환경변수로 설정한 뒤 다시 실행하세요. ' +
        '(이 스크립트는 외부망이 필요하며 샌드박스에서는 동작하지 않습니다.)'
    );
    process.exit(0);
    return;
  }

  if (isNationwide) {
    console.log(
      '[fetch-real-accident-zones] TAAS 전국 사고다발지역을 필터 없이 전부 수집합니다 ' +
        '(약 12,000건 이상 예상)...'
    );
  } else {
    console.log(
      `[fetch-real-accident-zones] TAAS 전국 데이터를 순회하며 '${regionKeyword}' 지점을 수집합니다...`
    );
  }

  // regionKeyword 가 빈 문자열이면 fetchAccidentZonesFromTAAS 가 필터를 건너뛴다(전국 전체).
  const zones = await fetchAccidentZonesFromTAAS(apiKey.trim(), regionKeyword);

  // ── 진단 요약 로그 ──────────────────────────────────────────────────────────
  const total = zones.length;
  const totalAccidents = zones.reduce((s, z) => s + z.accidentCount3y, 0);

  console.log(`[진단] 저장 대상 지점 총 ${total}건`);
  console.log(`[진단] 사고건수 합계: ${totalAccidents}건`);
  if (isNationwide && total < 12000) {
    console.warn(
      `[진단][경고] 전국 모드인데 ${total}건으로 예상(12,000+)보다 적습니다. ` +
        'API 페이지네이션/키/응답을 확인하세요.'
    );
  }

  // 전국 모드: 시도별 대략 분포를 name prefix(첫 공백 앞 토큰) 기준 상위 몇 개로 요약한다.
  // (AccidentZone 에는 ctprvnSignguNm 원본이 없으므로 name 의 접두 토큰으로 근사한다.)
  if (isNationwide) {
    const prefixCounts = new Map<string, number>();
    for (const z of zones) {
      const prefix = (z.name.split(/\s+/)[0] ?? '(미상)').slice(0, 6);
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
    const topPrefixes = Array.from(prefixCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);
    console.log('[진단] name 접두 토큰 상위 분포(대략적 지역 감 잡기용):');
    for (const [prefix, count] of topPrefixes) {
      console.log(`        - ${prefix}: ${count}건`);
    }
  } else {
    // 지역 모드: 서울대/관악 포함 지점 유무를 바로 확인할 수 있게 요약한다.
    const seoulNatUniv = zones.filter((z) => z.name.includes('서울대'));
    const gwanak = zones.filter((z) => z.name.includes('관악'));
    console.log(`[진단] name 에 '관악' 포함: ${gwanak.length}건`);
    console.log(`[진단] name 에 '서울대' 포함: ${seoulNatUniv.length}건`);
    if (seoulNatUniv.length > 0) {
      console.log('[진단] 서울대 포함 지점 목록:');
      for (const z of seoulNatUniv) {
        console.log(
          `        - ${z.name} (사고 ${z.accidentCount3y}건, ${z.latitude}, ${z.longitude})`
        );
      }
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  if (total === 0) {
    console.error(
      isNationwide
        ? '[fetch-real-accident-zones] 전국 모드인데 0건입니다. API 키/응답을 확인하세요. ' +
            'assets/accident-zones.json 은 변경하지 않았습니다.'
        : `[fetch-real-accident-zones] '${regionKeyword}' 매칭 지점이 0건입니다. ` +
            '지역 키워드를 확인하세요. assets/accident-zones.json 은 변경하지 않았습니다.'
    );
    process.exit(1);
    return;
  }

  const sorted: AccidentZone[] = [...zones].sort(
    (a, b) => b.accidentCount3y - a.accidentCount3y
  );

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = join(here, '..', 'assets', 'accident-zones.json');
  writeFileSync(outPath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  console.log(`[fetch-real-accident-zones] ${total}개 zone 을 ${outPath} 에 저장했습니다.`);
}

void main();
