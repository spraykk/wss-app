// 고위험 구간(빨간 원) 진입 알림 '처음 한 번만' 판정 (순수 함수) - FEAT-002
//
// 목적: 사용자가 고위험 구간에 처음 진입하고 위험 조건(고위험 zone + 휴대폰 사용 / 60점 미만)이
// 충족되면 로컬 알림(presentHighRiskAlert)을 '한 번만' 보내기 위한 순수 판정 로직. 기존에는
// 구간 안에 머무는 동안 매 위치 이벤트마다 알림이 나가 알림이 도배되고 렉이 생겼다. 이 게이트는
// 밀집 클러스터 알림 게이트(zoneCluster.ts#decideDenseClusterAlert / lastDenseClusterId)와 동일한
// 진입 가드 패턴을 따르되, 대표 zoneId 를 기준으로 한다.
//
// 진입 가드 의도:
//  - 진입 시 한 번만: 조건이 충족된 구간에 새로 들어가면 한 번 발송.
//  - 머무는 동안 재발송 없음: 같은 구간에 계속 있는 동안은 다시 보내지 않는다.
//  - 이탈 시 리셋: 구간을 벗어나면(inZone=false / currentZoneId='') 마커를 '' 로 리셋해
//    재진입 시 다시 알릴 수 있게 한다.
//  - 재진입/다른 구간: 같은 구간에 다시 들어오거나 다른 구간으로 들어가면 다시 한 번 발송.
//  - 조건 미충족: 구간 안이지만 아직 위험 조건이 충족되지 않았으면 마커를 전진시키지 않는다.
//    그래야 같은 구간 안에서 나중에 조건이 충족되는 순간 여전히 한 번 발송된다.
//
// 순수성/검증(중요): 이 모듈은 node 표준 라이브러리를 import 하지 않고 부수효과도 없다. 입력을
// 주입받는 순수 함수만 노출하므로 React Native 없이 `node --experimental-strip-types` 로
// scripts/verify-zone-alert-gate.ts 가 그대로 검증할 수 있다. '' 는 어떤 구간에도 속하지 않는
// 상태(구간 밖)를 나타내는 센티넬이다.

/** decideZoneEntryAlert 의 결정: 지금 고위험 진입 알림을 발송할지(fire)와, 발송 후
 *  backgroundTask 가 저장해야 할 다음 lastAlertedZoneId 값(nextZoneId). */
export interface ZoneEntryAlertDecision {
  /** 지금 고위험 진입 알림을 발송해야 하는가. */
  fire: boolean;
  /** 이 판정 후 backgroundTask 의 lastAlertedZoneId 에 저장할 값('' = 구간 밖). */
  nextZoneId: string;
}

// '처음 한 번만' 발송 판정을 순수 함수로 분리(검증 가능). backgroundTask 의 모듈 스코프
// lastAlertedZoneId(직전에 알린 대표 zoneId)와 현재 판정 결과로 "지금 고위험 알림을 보내야
// 하는가"를 결정한다. 밀집 클러스터 게이트(decideDenseClusterAlert)와 같은 진입 가드 규칙이다.
//
// 규칙:
//  (a) 구간 밖(inZone=false, 보통 currentZoneId='') => 발송 안 함, nextZoneId 를 '' 로 리셋
//      (재진입 시 다시 발송하도록).
//  (b) 구간 안 + 조건 충족 + 현재 구간이 직전 구간과 다름(새 구간/재진입) => 발송(fire=true),
//      nextZoneId 를 현재 구간으로 전진.
//  (c) 구간 안 + 현재 구간이 직전에 이미 알린 구간과 같음 => 발송 안 함, nextZoneId 유지
//      (같은 구간에 머무는 동안 재발송 없음).
//  (d) 구간 안 + 조건 미충족 => 발송 안 함, nextZoneId 를 직전 값 그대로 유지(전진 금지).
//      마커를 전진시키지 않아야 같은 구간에서 나중에 조건이 충족되는 순간 여전히 한 번 발송된다.
export function decideZoneEntryAlert(
  prevZoneId: string,
  currentZoneId: string,
  inZone: boolean,
  conditionMet: boolean
): ZoneEntryAlertDecision {
  // (a) 구간 밖: 다음 (재)진입에서 다시 알리도록 마커를 '' 로 리셋.
  if (!inZone || currentZoneId === '') {
    return { fire: false, nextZoneId: '' };
  }
  // (d) 구간 안이지만 조건이 아직 충족되지 않음: 마커를 전진시키지 않는다(전진 금지). 이래야
  // 같은 구간 안에서 나중에 조건이 충족되는 순간 여전히 currentZoneId !== prevZoneId 가 되어
  // 한 번 발송된다.
  if (!conditionMet) {
    return { fire: false, nextZoneId: prevZoneId };
  }
  // (b) 조건 충족 + 새 구간/재진입(현재 구간이 직전 알린 구간과 다름): 발송 + 현재 구간으로 전진.
  if (currentZoneId !== prevZoneId) {
    return { fire: true, nextZoneId: currentZoneId };
  }
  // (c) 조건 충족이지만 이미 알린 같은 구간에 머무는 중: 재발송 없이 현재 구간 기록 유지.
  return { fire: false, nextZoneId: prevZoneId };
}
