// 온보딩 완료 플래그 저장 (AsyncStorage)
//
// 최초 실행 시 단계적 권한 온보딩을 보여주고, 완료되면 플래그를 저장해 이후 실행에서는
// 곧바로 홈으로 진입한다. RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
//
// 저장하는 것은 "온보딩을 끝냈는지"의 boolean 플래그 하나뿐이다. 개인정보/위치/오디오
// 데이터는 여기에 저장하지 않는다(개인정보 처리방침 docs/privacy-policy.md 참조).
import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_DONE_KEY = 'wss.onboarding.completed.v1';

/** 온보딩을 이미 완료했는지 조회한다. 값이 없으면 false(최초 실행). */
export async function isOnboardingComplete(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(ONBOARDING_DONE_KEY);
  return raw === 'true';
}

/** 온보딩 완료를 저장한다(권한 요청 단계까지 끝난 뒤 호출). */
export async function markOnboardingComplete(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_DONE_KEY, 'true');
}
