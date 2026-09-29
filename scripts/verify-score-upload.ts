// 점수 업로드 유효성(validateScoreUpload) 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-score-upload.ts
//
// 목적: "wss_scores count 0" 무증상 실패의 진단 기반이 되는 순수 유효성 함수
// validateScoreUpload 를 뮤테이션 민감하게 고정한다. 이 함수는 서버로 나가기 전
// 페이로드를 스키마와 동일한 규칙으로 검증한다(페이로드 모양은 불변).
//   - age_band 는 5개 밴드 또는 null/undefined 만 허용('unknown'/'60s'/'' 는 거부)
//     => 앱이 서버에 'unknown' 같은 값을 보내 check 제약에 걸리는 일이 없음을 증명.
//   - displayScore 는 유한수 0..100 (NaN/-1/101 거부)
//   - dateISO 는 yyyy-mm-dd (빈 문자열 거부)
//   - deviceId 는 비어있지 않은 문자열(값 자체는 detail 에 절대 노출 안 함)
//   - 위반이 없으면 null 반환(유효), 위반이면 { ok:false, reason:'invalid', detail } 반환.
//
// validateScoreUpload 는 @supabase/supabase-js / expo-constants 를 건드리지 않는 순수
// 함수이므로 node_modules 없는 샌드박스에서도 실제 src 모듈을 그대로 import 해 검증한다
// (Supabase 왕복은 불가능/불필요). verify-walk-gate.ts 와 동일하게 트랜스파일 훅을
// 먼저 등록한다.
import { register } from 'node:module';
register('./ts-transpile-hook.mjs', import.meta.url);

const { validateScoreUpload } = await import('../src/data/supabase.ts');

type AgeBandValue = '10s' | '20s' | '30s' | '40s' | '50plus';
interface WssScoreUpload {
  deviceId: string;
  displayScore: number;
  dateISO: string;
  ageBand?: AgeBandValue | null;
}

let failures = 0;
function assert(label: string, cond: boolean): void {
  if (cond) {
    console.log(`PASS ${label}`);
  } else {
    console.log(`FAIL ${label}`);
    failures += 1;
  }
}

// 유효한 기준 페이로드(항상 통과해야 하는 값).
const base: WssScoreUpload = {
  deviceId: 'dev-abc',
  displayScore: 72,
  dateISO: '2026-09-27',
  ageBand: null,
};

// 유효(위반 없음)면 validateScoreUpload 는 null 을 반환한다.
function isValid(payload: WssScoreUpload): boolean {
  return validateScoreUpload(payload) === null;
}

// invalid 이면 { ok:false, reason:'invalid', detail } 를 반환하고 detail 은 위반 필드명을 담는다.
function isInvalid(payload: WssScoreUpload, detailSubstr?: string): boolean {
  const r = validateScoreUpload(payload);
  if (r === null || r.ok || r.reason !== 'invalid') return false;
  if (detailSubstr === undefined) return true;
  return typeof r.detail === 'string' && r.detail.includes(detailSubstr);
}

// (0) 기준 페이로드는 유효.
assert('기준 유효 페이로드 -> 통과(null)', isValid(base));

// (1) age_band: 5개 밴드는 모두 유효.
for (const b of ['10s', '20s', '30s', '40s', '50plus'] as AgeBandValue[]) {
  assert(`ageBand ${b} -> 유효`, isValid({ ...base, ageBand: b }));
}
// null / undefined(미선택)도 유효.
assert('ageBand null -> 유효', isValid({ ...base, ageBand: null }));
assert('ageBand undefined(미지정) -> 유효', isValid({ deviceId: 'd', displayScore: 50, dateISO: '2026-01-01' }));

// (2) age_band: 허용되지 않은 값은 invalid(스키마 check 위반을 앱 단에서 차단).
assert("ageBand 'unknown' -> invalid(ageBand)", isInvalid({ ...base, ageBand: 'unknown' as AgeBandValue }, 'ageBand'));
assert("ageBand '60s' -> invalid(ageBand)", isInvalid({ ...base, ageBand: '60s' as AgeBandValue }, 'ageBand'));
assert("ageBand '' -> invalid(ageBand)", isInvalid({ ...base, ageBand: '' as AgeBandValue }, 'ageBand'));

// (3) displayScore: 유한수 0..100 만 유효. 경계 0/100 은 유효.
assert('displayScore 0 -> 유효', isValid({ ...base, displayScore: 0 }));
assert('displayScore 100 -> 유효', isValid({ ...base, displayScore: 100 }));
assert('displayScore NaN -> invalid(displayScore)', isInvalid({ ...base, displayScore: NaN }, 'displayScore'));
assert('displayScore -1 -> invalid(displayScore)', isInvalid({ ...base, displayScore: -1 }, 'displayScore'));
assert('displayScore 101 -> invalid(displayScore)', isInvalid({ ...base, displayScore: 101 }, 'displayScore'));
assert('displayScore Infinity -> invalid(displayScore)', isInvalid({ ...base, displayScore: Infinity }, 'displayScore'));

// (4) dateISO: yyyy-mm-dd 만 유효. 빈 문자열/형식 위반은 invalid.
assert('dateISO 빈 문자열 -> invalid(dateISO)', isInvalid({ ...base, dateISO: '' }, 'dateISO'));
assert('dateISO 형식 위반 -> invalid(dateISO)', isInvalid({ ...base, dateISO: '2026/09/27' }, 'dateISO'));

// (5) deviceId: 비어있지 않은 문자열만 유효. 값 자체는 detail 에 노출하지 않는다.
assert('deviceId 빈 문자열 -> invalid(deviceId)', isInvalid({ ...base, deviceId: '' }, 'deviceId'));
assert('deviceId 공백만 -> invalid(deviceId)', isInvalid({ ...base, deviceId: '   ' }, 'deviceId'));

// (6) 민감정보 비노출: deviceId 값이 detail 에 절대 담기지 않아야 한다.
const secretDeviceId = 'SECRET-DEVICE-9999';
const invalidWithSecret = validateScoreUpload({ ...base, deviceId: secretDeviceId, displayScore: -1 });
assert(
  'detail 에 deviceId 원본값이 노출되지 않음',
  invalidWithSecret !== null &&
    !invalidWithSecret.ok &&
    typeof invalidWithSecret.detail === 'string' &&
    !invalidWithSecret.detail.includes(secretDeviceId)
);

// (7) invalid 결과에는 사람이 읽을 수 있는 detail 이 반드시 있어야 한다(진단용).
const invalidResult = validateScoreUpload({ ...base, dateISO: '' });
assert(
  'invalid 결과에 detail 문자열 존재',
  invalidResult !== null &&
    !invalidResult.ok &&
    invalidResult.reason === 'invalid' &&
    typeof invalidResult.detail === 'string' &&
    invalidResult.detail.length > 0
);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll score-upload assertions PASSED');
