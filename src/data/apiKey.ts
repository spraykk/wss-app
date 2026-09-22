// 환경변수 API 키 접근 헬퍼
//
// EXPO_PUBLIC_ 접두사가 붙은 변수는 Expo 가 빌드 시 클라이언트 번들에 주입하므로
// process.env 로 읽을 수 있다. 런타임 환경에 따라 expo-constants 의 extra 로도
// 노출될 수 있어, 두 경로를 모두 확인한다. 키가 없으면 null 을 반환한다.
//
// 주의: expo-constants 는 정적 import 하지 않고 getKmaApiKey 안에서 require 로
// 지연 로드한다. 이렇게 해야 이 모듈에서 순수 함수(normalizeApiKey)만 import 하는
// 코드(예: src/data/accidentZones.ts → fetchAccidentZonesFromTAAS, 검증 스크립트)가
// expo-constants 런타임 의존을 끌어오지 않는다. Metro/RN 은 require 를 지원한다.

// data.go.kr(공공데이터포털) serviceKey 정규화 헬퍼.
//
// data.go.kr 발급 키에는 '+', '/', '=' 같은 문자가 포함될 수 있고, 이들은 URL
// 쿼리에서 각각 %2B, %2F, %3D 로 인코딩되어야 한다. 포털은 "Encoding" 키(이미
// URL 인코딩된 형태)와 "Decoding" 키(원시 형태)를 함께 제공한다.
//
// 성공하는 요청은 "이미 인코딩된 키"를 그대로 넣은 경우다. 만약 이미 인코딩된
// 키를 다시 encodeURIComponent 하면 %2B 가 %252B 로 이중 인코딩되어 서버가
// HTTP 400 을 반환한다. 반대로 원시 키를 인코딩 없이 넣어도 '+' 등이 깨진다.
//
// 이 함수는 입력이 인코딩됐든 원시든 항상 "정확히 한 번 인코딩된" 형태를 만든다:
//  - decodeURIComponent 로 먼저 원시 형태로 되돌린 뒤 encodeURIComponent 로
//    한 번만 인코딩한다. 따라서 이미 인코딩된 'a%2Bb' -> 'a%2Bb'(불변),
//    원시 'a+b' -> 'a%2Bb'. 이중 인코딩을 방지한다.
//  - decode 가 실패(잘못된 %-시퀀스 등)하면 원시로 간주하고 그대로 인코딩한다.
export function normalizeApiKey(rawKey: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(rawKey));
  } catch {
    return encodeURIComponent(rawKey);
  }
}

// KMA(기상청) 단기예보 API 키를 반환한다. 없으면 null (날씨는 '맑음' 폴백).
export function getKmaApiKey(): string | null {
  const fromEnv = process.env.EXPO_PUBLIC_KMA_API_KEY;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();

  let extra: Record<string, unknown> = {};
  try {
    // expo-constants 지연 로드(위 주석 참고). 네이티브/Expo 런타임에서만 존재한다.
    const Constants = require('expo-constants').default;
    extra = (Constants?.expoConfig?.extra ?? {}) as Record<string, unknown>;
  } catch {
    extra = {};
  }
  const fromExtra = extra.EXPO_PUBLIC_KMA_API_KEY;
  if (typeof fromExtra === 'string' && fromExtra.trim().length > 0) {
    return fromExtra.trim();
  }
  return null;
}
