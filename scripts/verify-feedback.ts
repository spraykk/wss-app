// 피드백 제출 유효성/결과 타입 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-feedback.ts
//
// src/data/supabase.ts 의 submitFeedbackDetailed() 은 @supabase/supabase-js 를 지연
// require 하므로 node_modules 없는 샌드박스에서 그대로 import 하면 실패한다. 따라서
// verify-supabase-stats.ts / verify-api-key.ts 와 동일하게, 서버로 나가기 전
// "순수 유효성 계약"과 구조화된 결과(SubmitResult)의 분기를 여기서 재현해 검증한다
// (로직은 supabase.ts 와 동일하게 유지할 것).
//
// 핵심: 실패가 "전송 실패"로만 뭉뚱그려지지 않고 사유(reason)/진단(detail)로
// 구분되는지 확인한다.
//   - 잘못된 카테고리 / 빈 메시지 / 2000자 초과 / 잘못된 별점 -> invalid (+detail)
//   - 유효하지만 Supabase 미설정(순수 환경) -> not_configured
// server/exception 분기는 실제 네트워크가 필요하므로 여기서는 검증하지 않는다.

type FeedbackCategory = 'bug' | 'suggestion' | 'praise' | 'etc';

interface FeedbackSubmission {
  category: FeedbackCategory;
  rating: number | null;
  message: string;
  appVersion: string | null;
  deviceId: string;
}

type SubmitResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'invalid' | 'not_configured' | 'server' | 'exception';
      detail?: string;
    };

// submitFeedbackDetailed 의 "클라이언트 유효성 게이트 + 미설정 분기"만 순수하게
// 재현한다. 순수 환경에는 Supabase 클라이언트가 없으므로, 유효성을 통과하면
// not_configured 로 귀결된다(실제 네트워크 insert 는 제외).
function classifySubmission(payload: FeedbackSubmission): SubmitResult {
  const validCategory =
    payload.category === 'bug' ||
    payload.category === 'suggestion' ||
    payload.category === 'praise' ||
    payload.category === 'etc';
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  const validMessage = message.length > 0 && message.length <= 2000;
  const validRating =
    payload.rating === null ||
    (Number.isInteger(payload.rating) && payload.rating >= 1 && payload.rating <= 5);

  if (!validCategory) {
    return { ok: false, reason: 'invalid', detail: '카테고리가 올바르지 않습니다(버그/제안/칭찬/기타).' };
  }
  if (!validMessage) {
    const detail =
      message.length === 0
        ? '내용을 입력해 주세요.'
        : `내용이 너무 깁니다(${message.length}/2000자).`;
    return { ok: false, reason: 'invalid', detail };
  }
  if (!validRating) {
    return { ok: false, reason: 'invalid', detail: '별점은 1~5 사이 정수이거나 미선택이어야 합니다.' };
  }
  // 유효하지만 순수 환경에는 클라이언트가 없다 -> not_configured.
  return { ok: false, reason: 'not_configured' };
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

function isInvalid(result: SubmitResult, detailSubstr?: string): boolean {
  if (result.ok || result.reason !== 'invalid') return false;
  if (detailSubstr === undefined) return true;
  return typeof result.detail === 'string' && result.detail.includes(detailSubstr);
}

function isNotConfigured(result: SubmitResult): boolean {
  return !result.ok && result.reason === 'not_configured';
}

const base: FeedbackSubmission = {
  category: 'bug',
  rating: null,
  message: '지도가 가끔 안 뜹니다',
  appVersion: '1.0.0',
  deviceId: 'dev-1',
};

// (a) 정상: 4종 카테고리 모두 유효성 통과 -> 순수 환경에서 not_configured.
for (const c of ['bug', 'suggestion', 'praise', 'etc'] as FeedbackCategory[]) {
  assert(
    `카테고리 ${c} + 별점 미선택 -> 유효(not_configured)`,
    isNotConfigured(classifySubmission({ ...base, category: c }))
  );
}

// (b) 별점 경계: 1과 5는 유효, 0과 6은 invalid, 소수는 invalid.
assert('별점 1 -> 유효(not_configured)', isNotConfigured(classifySubmission({ ...base, rating: 1 })));
assert('별점 5 -> 유효(not_configured)', isNotConfigured(classifySubmission({ ...base, rating: 5 })));
assert('별점 0 -> invalid', isInvalid(classifySubmission({ ...base, rating: 0 }), '별점'));
assert('별점 6 -> invalid', isInvalid(classifySubmission({ ...base, rating: 6 }), '별점'));
assert('별점 3.5(소수) -> invalid', isInvalid(classifySubmission({ ...base, rating: 3.5 }), '별점'));

// (c) 메시지 필수: 빈 문자열/공백만 -> invalid(내용 입력 안내).
assert('빈 메시지 -> invalid', isInvalid(classifySubmission({ ...base, message: '' }), '내용'));
assert('공백만 메시지 -> invalid', isInvalid(classifySubmission({ ...base, message: '   \n\t ' }), '내용'));

// (d) 메시지 길이 경계: trim 후 2000자 정확히 -> 유효, 2001자 -> invalid(길이 안내).
assert(
  '메시지 2000자 -> 유효(not_configured)',
  isNotConfigured(classifySubmission({ ...base, message: 'a'.repeat(2000) }))
);
assert(
  '메시지 2001자 -> invalid',
  isInvalid(classifySubmission({ ...base, message: 'a'.repeat(2001) }), '2000자')
);

// (e) 앞뒤 공백은 trim 되므로 유효 판단은 실제 내용 길이로 한다.
assert(
  '앞뒤 공백 포함 짧은 메시지 -> 유효(not_configured)',
  isNotConfigured(classifySubmission({ ...base, message: '   좋아요   ' }))
);
assert(
  '공백 포함 2000자 초과지만 trim 후 2000자 -> 유효(not_configured)',
  isNotConfigured(classifySubmission({ ...base, message: `  ${'a'.repeat(2000)}  ` }))
);

// (f) 잘못된 카테고리 -> invalid(스키마 check 와 일치).
assert(
  '알 수 없는 카테고리 -> invalid',
  isInvalid(classifySubmission({ ...base, category: 'spam' as FeedbackCategory }), '카테고리')
);

// (g) invalid 결과에는 사람이 읽을 수 있는 detail 이 반드시 있어야 한다(진단용).
const invalidResult = classifySubmission({ ...base, message: '' });
assert(
  'invalid 결과에 detail 문자열 존재',
  !invalidResult.ok &&
    invalidResult.reason === 'invalid' &&
    typeof invalidResult.detail === 'string' &&
    invalidResult.detail.length > 0
);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
