// expo-constants "extra" / 앱 버전 견고 리더 (OTA/프로덕션 런타임 호환)
//
// 배경(버그): app.json 의 expo.extra 에만 넣어 둔 공개 설정값
// (EXPO_PUBLIC_SUPABASE_URL/KEY, EXPO_PUBLIC_KMA_API_KEY 등)을 런타임에 읽을 때,
// 기존 코드는 `Constants.expoConfig.extra` 한 경로만 확인했다. 그런데 이 앱은
// expo-updates(OTA)가 활성(app.json 의 updates.url + runtimeVersion)이라, 런타임에
// 매니페스트가 다음 세 형태 중 어느 것으로도 올 수 있다:
//   1) Constants.expoConfig.extra                       (개발/일부 빌드)
//   2) Constants.manifest2.extra.expoClient.extra       (신형 OTA 매니페스트)
//   3) Constants.manifest.extra                         (레거시 매니페스트)
// expoConfig 가 null 이 되는 런타임에서는 extra 가 {} 가 되어 Supabase 설정이
// "미설정"으로 오인되고, uploadScore 가 조용히 no-op 하여 "보행 시간은 잡히는데
// 서버 전송이 안 됨" 증상이 발생했다. feedback.tsx 가 이미 앱 버전에서
// expoConfig ?? manifest 폴백을 쓰던 것이 이 런타임 편차의 방증이다.
//
// 이 모듈은 세 경로를 모두 병합해 하나의 extra 객체로 돌려주는 단일 소스이며,
// supabase.ts / apiKey.ts / feedback.tsx 가 공유한다. expo-constants 는 정적 import
// 하지 않고 지연 require 로 로드해, 순수 코드/검증 스크립트가 node_modules 없는
// 샌드박스에서 모듈 해석 오류를 일으키지 않게 한다(기존 apiKey.ts 패턴 계승).

// 여러 매니페스트 경로에서 extra 를 모아 하나로 병합해 반환한다. 앞선(우선순위 높은)
// 경로의 값이 뒤 경로를 덮어쓴다. expo-constants 미존재/오류면 빈 객체를 반환한다.
export function getExpoExtra(): Record<string, unknown> {
  let Constants: {
    expoConfig?: { extra?: unknown } | null;
    manifest2?: { extra?: { expoClient?: { extra?: unknown } } } | null;
    manifest?: { extra?: unknown } | null;
  } | null = null;
  try {
    Constants = require('expo-constants').default;
  } catch {
    return {};
  }
  if (!Constants) return {};

  const fromExpoConfig = asRecord(Constants.expoConfig?.extra);
  const fromManifest2 = asRecord(Constants.manifest2?.extra?.expoClient?.extra);
  const fromManifest = asRecord(Constants.manifest?.extra);

  // 병합 우선순위: expoConfig > manifest2 > manifest. 어느 하나에만 값이 있어도 잡힌다.
  return { ...fromManifest, ...fromManifest2, ...fromExpoConfig };
}

// EXPO_PUBLIC_ 계열 문자열 설정값을 읽는다. 우선순위:
//   1) process.env[name]        (빌드 시 인라인되는 정식 경로)
//   2) 병합된 expo extra[name]  (app.json 의 expo.extra 폴백; 위 getExpoExtra)
// 값이 없거나 빈 문자열이면 null 을 반환한다(호출부가 "미설정"으로 처리).
export function readPublicEnv(name: string): string | null {
  const fromEnv = process.env[name];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  const extra = getExpoExtra();
  const fromExtra = extra[name];
  if (typeof fromExtra === 'string' && fromExtra.trim().length > 0) {
    return fromExtra.trim();
  }
  return null;
}

// 앱 버전을 견고하게 읽는다(expoConfig.version -> manifest.version). 없으면 null.
// feedback.tsx 의 readAppVersion 이 재사용한다.
export function readAppVersion(): string | null {
  let Constants: {
    expoConfig?: { version?: unknown } | null;
    manifest?: { version?: unknown } | null;
  } | null = null;
  try {
    Constants = require('expo-constants').default;
  } catch {
    return null;
  }
  const version = Constants?.expoConfig?.version ?? Constants?.manifest?.version ?? null;
  if (typeof version === 'string' && version.trim().length > 0) {
    return version.trim();
  }
  return null;
}

// unknown 을 안전하게 문자열 키 레코드로 좁힌다(배열/원시/ null 은 빈 객체로).
function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
