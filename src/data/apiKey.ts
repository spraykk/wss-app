// 환경변수 API 키 접근 헬퍼
//
// EXPO_PUBLIC_ 접두사가 붙은 변수는 Expo 가 빌드 시 클라이언트 번들에 주입하므로
// process.env 로 읽을 수 있다. 런타임 환경에 따라 expo-constants 의 extra 로도
// 노출될 수 있어, 두 경로를 모두 확인한다. 키가 없으면 null 을 반환한다.
//
// 버그 수정: 예전에는 Constants.expoConfig.extra 한 경로만 확인해, OTA(expo-updates)
// 활성 런타임에서 expoConfig 가 null 이면(설정이 manifest2/레거시 manifest 로 옴)
// app.json extra 의 키를 못 읽었다. 이제 세 경로를 병합하는 공용 리더(readPublicEnv,
// src/data/expoExtra.ts)를 재사용해 견고화한다(Supabase 리더와 동일한 근본 원인).
//
// expoExtra 는 expo-constants 를 "지연 require" 로만 쓰는 순수 헬퍼라, 여기서 정적
// import 해도 순수 함수(normalizeApiKey)만 쓰는 코드/검증 스크립트의 샌드박스
// 안전성을 깨지 않는다.
import { readPublicEnv } from './expoExtra';

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
// process.env -> 병합된 expo extra(expoConfig/manifest2/manifest) 순으로 확인한다.
export function getKmaApiKey(): string | null {
  return readPublicEnv('EXPO_PUBLIC_KMA_API_KEY');
}
