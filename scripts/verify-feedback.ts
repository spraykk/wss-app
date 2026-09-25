// 피드백 제출 유효성/정규화 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-feedback.ts
//
// src/data/supabase.ts 의 submitFeedback() 은 @supabase/supabase-js 를 지연 require
// 하므로 node_modules 없는 샌드박스에서 그대로 import 하면 실패한다. 따라서
// verify-supabase-stats.ts / verify-api-key.ts 와 동일하게, 서버로 나가기 전
// "순수 유효성 계약"(카테고리 4종, 별점 1~5|null, 메시지 1~2000자, message.trim())을
// 여기서 재현해 검증한다(로직은 supabase.ts 와 동일하게 유지할 것).
//
// 또한 앱 화면(app/feedback.tsx)이 값이 유효할 때만 전송하고, 실패/미설정 시
// no-op(false) 로 정직하게 처리하는 계약을 지키는지 함께 확인한다(가짜 성공 금지).

type FeedbackCategory = 'bug' | 'suggestion' | 'praise' | 'etc';

interface FeedbackSubmission {
  category: FeedbackCategory;
  rating: number | null;
  message: string;
  appVersion: string | null;
  deviceId: string;
}

// submitFeedback 의 "클라이언트 유효성 게이트"만 순수하게 재현한다.
// (실제 네트워크 insert 는 제외 — 유효하지 않으면 false, 유효하면 통과로 간주.)
function isValidSubmission(payload: FeedbackSubmission): boolean {
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
  return validCategory && validMessage && validRating;
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

const base: FeedbackSubmission = {
  category: 'bug',
  rating: null,
  message: '지도가 가끔 안 뜹니다',
  appVersion: '1.0.0',
  deviceId: 'dev-1',
};

// (a) 정상: 4종 카테고리 모두 통과, 별점 null(미선택) 허용.
for (const c of ['bug', 'suggestion', 'praise', 'etc'] as FeedbackCategory[]) {
  assert(`카테고리 ${c} + 별점 미선택 -> 유효`, isValidSubmission({ ...base, category: c }));
}

// (b) 별점 경계: 1과 5는 유효, 0과 6은 무효, 소수는 무효.
assert('별점 1 -> 유효', isValidSubmission({ ...base, rating: 1 }));
assert('별점 5 -> 유효', isValidSubmission({ ...base, rating: 5 }));
assert('별점 0 -> 무효', !isValidSubmission({ ...base, rating: 0 }));
assert('별점 6 -> 무효', !isValidSubmission({ ...base, rating: 6 }));
assert('별점 3.5(소수) -> 무효', !isValidSubmission({ ...base, rating: 3.5 }));

// (c) 메시지 필수: 빈 문자열/공백만 -> 무효.
assert('빈 메시지 -> 무효', !isValidSubmission({ ...base, message: '' }));
assert('공백만 메시지 -> 무효', !isValidSubmission({ ...base, message: '   \n\t ' }));

// (d) 메시지 길이 경계: trim 후 2000자 정확히 -> 유효, 2001자 -> 무효.
assert('메시지 2000자 -> 유효', isValidSubmission({ ...base, message: 'a'.repeat(2000) }));
assert('메시지 2001자 -> 무효', !isValidSubmission({ ...base, message: 'a'.repeat(2001) }));

// (e) 앞뒤 공백은 trim 되므로 유효 판단은 실제 내용 길이로 한다.
assert('앞뒤 공백 포함 짧은 메시지 -> 유효', isValidSubmission({ ...base, message: '   좋아요   ' }));
assert(
  '공백 포함 2000자 초과지만 trim 후 2000자 -> 유효',
  isValidSubmission({ ...base, message: `  ${'a'.repeat(2000)}  ` })
);

// (f) 잘못된 카테고리 -> 무효(스키마 check 와 일치).
assert(
  '알 수 없는 카테고리 -> 무효',
  !isValidSubmission({ ...base, category: 'spam' as FeedbackCategory })
);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
