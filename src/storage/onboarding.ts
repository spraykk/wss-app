// 온보딩 완료 플래그 저장 (AsyncStorage)
//
// 최초 실행 시 단계적 권한 온보딩을 보여주고, 완료되면 플래그를 저장해 이후 실행에서는
// 곧바로 홈으로 진입한다. RN/Expo 런타임에서만 동작하며 샌드박스에서는 실행되지 않는다.
//
// 저장하는 것은 "온보딩을 끝냈는지"의 boolean 플래그 하나뿐이다. 개인정보/위치/오디오
// 데이터는 여기에 저장하지 않는다(개인정보 처리방침 docs/privacy-policy.md 참조).
import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_DONE_KEY = 'wss.onboarding.completed.v1';

// 같은 세션 내에서 온보딩 완료를 즉시 관찰하기 위한 인메모리 신호.
// _layout 은 마운트 시 AsyncStorage 를 1회만 읽으므로, onFinish 가 완료를 저장한 뒤에도
// _layout 의 상태가 갱신되지 않아 홈 진입 직후 다시 온보딩으로 튕기는 루프가 있었다.
// markOnboardingComplete 가 이 플래그를 세우고 리스너를 호출하면 _layout 이 즉시 반영한다.
let completedInSession = false;
const listeners = new Set<() => void>();

/** 이번 세션에서 이미 온보딩 완료가 기록됐는지(인메모리). 재시작 시 false 로 초기화된다. */
export function wasCompletedThisSession(): boolean {
  return completedInSession;
}

/**
 * 온보딩 완료 신호를 구독한다. markOnboardingComplete 호출 시 콜백이 실행된다.
 * 반환된 함수를 호출하면 구독을 해제한다(useEffect cleanup 용).
 */
export function subscribeOnboardingComplete(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 온보딩을 이미 완료했는지 조회한다. 값이 없으면 false(최초 실행). */
export async function isOnboardingComplete(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(ONBOARDING_DONE_KEY);
  return raw === 'true';
}

/** 온보딩 완료를 저장한다(권한 요청 단계까지 끝난 뒤 호출). */
export async function markOnboardingComplete(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_DONE_KEY, 'true');
  // 같은 세션의 게이트(_layout)가 즉시 완료를 관찰하도록 신호를 보낸다.
  completedInSession = true;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // 개별 리스너 오류는 다른 리스너 통지를 막지 않는다.
    }
  });
}
