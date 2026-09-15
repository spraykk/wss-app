// 환경변수 API 키 접근 헬퍼
//
// EXPO_PUBLIC_ 접두사가 붙은 변수는 Expo 가 빌드 시 클라이언트 번들에 주입하므로
// process.env 로 읽을 수 있다. 런타임 환경에 따라 expo-constants 의 extra 로도
// 노출될 수 있어, 두 경로를 모두 확인한다. 키가 없으면 null 을 반환한다.
import Constants from 'expo-constants';

// KMA(기상청) 단기예보 API 키를 반환한다. 없으면 null (날씨는 '맑음' 폴백).
export function getKmaApiKey(): string | null {
  const fromEnv = process.env.EXPO_PUBLIC_KMA_API_KEY;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();

  const extra = (Constants?.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const fromExtra = extra.EXPO_PUBLIC_KMA_API_KEY;
  if (typeof fromExtra === 'string' && fromExtra.trim().length > 0) {
    return fromExtra.trim();
  }
  return null;
}
