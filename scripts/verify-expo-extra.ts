// expo extra / 공개 env 리더(readPublicEnv, getExpoExtra) 계약 검증 스크립트
// 실행: env -u NODE_OPTIONS node --experimental-strip-types scripts/verify-expo-extra.ts
//
// 배경(버그): app.json 의 expo.extra 에만 넣어 둔 Supabase URL/키(및 KMA 키)를 런타임에
// 읽을 때, 예전 코드는 Constants.expoConfig.extra 한 경로만 확인했다. 그러나 이 앱은
// expo-updates(OTA)가 활성이라 런타임에 매니페스트가 expoConfig / manifest2 / 레거시
// manifest 중 어느 형태로도 올 수 있고, expoConfig 가 null 이 되는 런타임에서는 설정이
// "미설정"으로 오인되어 uploadScore 가 조용히 no-op 했다("보행 시간은 잡히는데 서버 전송
// 안 됨"). src/data/expoExtra.ts 는 세 경로를 병합해 이 문제를 없앤다.
//
// expoExtra.ts 는 expo-constants 를 "지연 require" 로만 쓰므로 이 샌드박스(node_modules
// 없음)에서도 안전하게 import 되지만, 이 스크립트는 실제 Constants 없이도 결정적으로
// 검증하기 위해 세 경로 병합/우선순위 계약을 순수 함수로 재현해 확인한다(로직은
// getExpoExtra 와 동일하게 유지할 것). process.env 우선/trim/빈문자열 무시는 실제
// readPublicEnv 를 직접 호출해 검증한다(그 경로는 Constants 에 의존하지 않는다).
import { readPublicEnv, getExpoExtra } from '../src/data/expoExtra.ts';

let failures = 0;
function assert(label: string, cond: boolean): void {
  if (cond) {
    console.log(`PASS ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL ${label}`);
  }
}

// ── 실제 리더 동작(expo-constants 부재 시 안전 no-op + process.env 경로) ──────────

// expo-constants 가 없는 환경: getExpoExtra 는 빈 객체, readPublicEnv 는 null.
assert('getExpoExtra() -> {} without expo-constants', JSON.stringify(getExpoExtra()) === '{}');
assert('readPublicEnv() -> null when unset', readPublicEnv('EXPO_PUBLIC_SUPABASE_URL') === null);

// process.env 우선 + 앞뒤 공백 trim.
process.env.EXPO_PUBLIC_SUPABASE_URL = '  https://x.supabase.co  ';
assert(
  'readPublicEnv() reads & trims process.env',
  readPublicEnv('EXPO_PUBLIC_SUPABASE_URL') === 'https://x.supabase.co'
);
delete process.env.EXPO_PUBLIC_SUPABASE_URL;

// 공백만 있는 env 는 미설정으로 취급.
process.env.EXPO_PUBLIC_SUPABASE_KEY = '   ';
assert('readPublicEnv() ignores blank env', readPublicEnv('EXPO_PUBLIC_SUPABASE_KEY') === null);
delete process.env.EXPO_PUBLIC_SUPABASE_KEY;

// ── 세 경로 병합/우선순위 계약(getExpoExtra 와 동일 로직을 재현해 검증) ───────────
// 우선순위: expoConfig > manifest2 > manifest. 하나에만 값이 있어도 잡혀야 한다.
function mergeExtra(
  expoConfigExtra: Record<string, unknown> | null,
  manifest2Extra: Record<string, unknown> | null,
  manifestExtra: Record<string, unknown> | null
): Record<string, unknown> {
  const a = expoConfigExtra ?? {};
  const b = manifest2Extra ?? {};
  const c = manifestExtra ?? {};
  return { ...c, ...b, ...a };
}

// 케이스 1: expoConfig 가 null 이고 값이 manifest2 에만 있을 때(핵심 버그 상황) 잡힌다.
{
  const merged = mergeExtra(null, { EXPO_PUBLIC_SUPABASE_URL: 'u2' }, null);
  assert('merge picks value from manifest2 when expoConfig null', merged.EXPO_PUBLIC_SUPABASE_URL === 'u2');
}
// 케이스 2: 값이 레거시 manifest 에만 있을 때도 잡힌다.
{
  const merged = mergeExtra(null, null, { EXPO_PUBLIC_SUPABASE_URL: 'u3' });
  assert('merge picks value from legacy manifest', merged.EXPO_PUBLIC_SUPABASE_URL === 'u3');
}
// 케이스 3: 여러 경로에 있으면 expoConfig 가 최우선.
{
  const merged = mergeExtra(
    { EXPO_PUBLIC_SUPABASE_URL: 'u1' },
    { EXPO_PUBLIC_SUPABASE_URL: 'u2' },
    { EXPO_PUBLIC_SUPABASE_URL: 'u3' }
  );
  assert('merge prefers expoConfig over manifest2/manifest', merged.EXPO_PUBLIC_SUPABASE_URL === 'u1');
}
// 케이스 4: manifest2 는 manifest 보다 우선.
{
  const merged = mergeExtra(null, { K: 'm2' }, { K: 'm1' });
  assert('merge prefers manifest2 over legacy manifest', merged.K === 'm2');
}

if (failures === 0) {
  console.log('\nAll expo-extra reader checks passed.');
  process.exit(0);
} else {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
