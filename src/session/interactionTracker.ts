// 인앱 상호작용(터치/스크롤) 추적기 (Option A - Step 1) - RN 안전, 순수 검증 가능한 헬퍼 포함
//
// 역할(정직성 원칙): confirmedUse(확인된 사용)의 유일한 증거 소스다. 앱이 포그라운드일 때
// 루트 레이아웃(app/_layout.tsx)의 캡처 단계 터치 핸들러가 recordInteraction() 을 호출해
// "마지막 실제 인앱 상호작용 시각"을 모듈 메모리에 도장 찍는다. 백그라운드 태스크는
// hadRecentInteraction(now) 로 최근 상호작용 여부를 읽어 그 구간을 confirmedUse 로 분류한다.
//
// 중요한 한계(정직한 설명): 이 신호는 본질적으로 "포그라운드에서의 인앱 상호작용" 시각이다.
// 앱이 백그라운드이거나 사용자가 (이 앱이 아닌) 다른 앱을 쓰는 시간은 여기서 볼 수 없다.
// 따라서 confirmedUse 는 "완벽한 스마트폰 사용 감지"가 아니라, 확인 가능한 최소 증거이며,
// 관측하지 못한 시간은 사용/무사용을 단정하지 않고 unknownUse 로 둔다(usageClassification.ts).
//
// 이 모듈은 React Native 를 import 하지 않으며 node:* 도 쓰지 않는다(모듈 스코프 인메모리
// 상태만 사용). 순수 헬퍼 wasRecentInteraction 을 분리해 node 로 단위 검증할 수 있다.

// [설계값] 확인 창(confirmation window, ms). 마지막 인앱 상호작용이 이 창 안이면 해당
// 구간을 confirmedUse 로 본다. 이는 설계값(튜닝 가능)이며 확정된 채점 파라미터가 아니다.
// 값이 클수록 한 번의 터치가 더 긴 구간을 "사용"으로 덮으므로 보수적으로 60초로 둔다.
// 근본적으로 confirmedUse 는 "포그라운드 인앱 상호작용" 시간이라는 한계를 가진다.
export const CONFIRMED_USE_WINDOW_MS = 60_000;

// 마지막 인앱 상호작용 시각(ms epoch). 아직 없으면 null. 모듈 스코프 인메모리 상태.
let lastInteractionAtMs: number | null = null;

// 순수 헬퍼(검증 가능): 마지막 상호작용 시각이 now 기준 window 안에 있었는가.
// lastMs 가 null 이면(상호작용 없음) false. 비유한/미래(now<lastMs) 값은 방어적으로 처리한다.
export function wasRecentInteraction(
  lastMs: number | null,
  nowMs: number,
  windowMs: number = CONFIRMED_USE_WINDOW_MS
): boolean {
  if (lastMs === null) return false;
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs) || !Number.isFinite(windowMs)) {
    return false;
  }
  const delta = nowMs - lastMs;
  // delta<0(시계 되감김 등)이면 최근으로 보지 않는다(보수적). 0<=delta<window 만 최근.
  return delta >= 0 && delta < windowMs;
}

// 실제 인앱 터치/스크롤 발생 시 호출한다(캡처 단계 루트 핸들러). 마지막 상호작용 시각을 갱신.
export function recordInteraction(nowMs: number = Date.now()): void {
  lastInteractionAtMs = nowMs;
}

// 지금 시점(nowMs) 기준으로 확인 창 안에 최근 인앱 상호작용이 있었는지 반환한다.
//
// [의도된 엣지: 확인 창 번짐(window-bleed)] 이 함수는 마지막 상호작용이 창 안이었는지만
// 보고 현재 AppState(포그라운드/백그라운드)는 보지 않는다. 따라서 사용자가 터치한 직후
// 확인 창(예: 60초) 안에 앱이 백그라운드로 넘어가면, 그 백그라운드 구간도 최근 상호작용이
// 있었다고 보고돼 classifyInterval 에서 confirmedUse 로 분류될 수 있다(appForeground=false
// 라도). 이는 의도된 설계다(수십 초 전의 실제 터치는 진짜 증거). 자세한 근거/절충은
// usageClassification.ts 의 classifyInterval 주석 참고.
export function hadRecentInteraction(
  nowMs: number,
  windowMs: number = CONFIRMED_USE_WINDOW_MS
): boolean {
  return wasRecentInteraction(lastInteractionAtMs, nowMs, windowMs);
}

// 세션 시작/종료 시 호출해 상호작용 증거가 세션 간에 새지 않도록 초기화한다.
export function resetInteractions(): void {
  lastInteractionAtMs = null;
}
