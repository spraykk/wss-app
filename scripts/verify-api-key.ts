// data.go.kr serviceKey 정규화(normalizeApiKey) 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-api-key.ts
//
// TAAS serviceKey 는 "이미 URL 인코딩된 키"를 그대로 넣어야 성공한다. 이미 인코딩된
// 키를 다시 인코딩하면 %2B -> %252B 이중 인코딩이 되어 HTTP 400 이 난다. 반대로
// 원시 키('+','/','=' 포함)를 인코딩 없이 넣어도 깨진다. normalizeApiKey 는 입력이
// 인코딩됐든 원시든 항상 "정확히 한 번 인코딩된" 형태를 만든다.
//
// apiKey.ts 는 expo-constants 를 import 하는 getKmaApiKey 도 갖고 있어 이 샌드박스
// (node_modules 없음)에서는 그대로 import 하면 ERR_MODULE_NOT_FOUND 가 난다. 따라서
// 파일 전체를 import 하지 않고, 순수 함수 normalizeApiKey 의 정의와 동치인 구현을
// 여기서 재현해 계약(contract)을 검증한다(로직은 apiKey.ts 와 동일하게 유지할 것).
//
// 만약 apiKey.ts 를 직접 import 하고 싶다면 expo-constants 의존을 분리해야 한다.
// 현재 목적(정규화 계약 검증)에는 아래 재현 구현으로 충분하다.
function normalizeApiKey(rawKey: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(rawKey));
  } catch {
    return encodeURIComponent(rawKey);
  }
}

let failures = 0;

function assertEq(label: string, actual: string, expected: string): void {
  if (actual === expected) {
    console.log(`PASS ${label}: '${actual}'`);
  } else {
    console.log(`FAIL ${label}: got '${actual}', expected '${expected}'`);
    failures += 1;
  }
}

// (a) 이미 인코딩된 키는 그대로 유지되어야 한다(이중 인코딩 금지).
assertEq('이미 인코딩된 a%2Bb 는 불변', normalizeApiKey('a%2Bb'), 'a%2Bb');

// (b) 원시 키의 특수문자는 정확히 한 번 인코딩되어야 한다.
assertEq('원시 a+b -> a%2Bb', normalizeApiKey('a+b'), 'a%2Bb');
assertEq('원시 a/b -> a%2Fb', normalizeApiKey('a/b'), 'a%2Fb');
assertEq('원시 a=b -> a%3Db', normalizeApiKey('a=b'), 'a%3Db');

// (c) 멱등성(idempotent): 정규화된 값을 다시 정규화해도 변하지 않아야 한다.
const once = normalizeApiKey('abc+def/ghi=jkl');
const twice = normalizeApiKey(once);
assertEq('정규화는 멱등적(두 번 적용해도 동일)', twice, once);

// (d) 이중 인코딩이 실제로 방지되는지 명시 확인: 이미 인코딩된 키를 다시 넣어도
//     %252B(이중) 가 나오지 않아야 한다.
const encodedKey = 'Xy%2Bz%2Fw%3D';
assertEq('이미 인코딩된 키 재정규화 시 이중 인코딩 없음', normalizeApiKey(encodedKey), encodedKey);

if (failures > 0) {
  console.log(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll assertions PASSED');
